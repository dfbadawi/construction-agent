import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { config, requireOpenAIKey } from "../config";
import { debugSection } from "../utils/debug";
import { analyzeBidData, type AnalyzeBidDataParams } from "./tools/analyze";
import { getBidItemsProjectContext } from "./tools/bid-items-schema";
import { buildToolDefinitions } from "./tools/definitions";
import { searchKnowledge, type SearchKnowledgeParams } from "./tools/search";

export type AgentMessage = ChatCompletionMessageParam;

const MAX_TOOL_ITERATIONS = 4;

export const AGENT_SYSTEM_PROMPT = `You are a construction estimating assistant with access to bid tabulation data and project documents.

Use the available tools when a question depends on uploaded project data.

Tool routing:
- Prices, totals, quantities, rankings, bidder comparisons, summaries, outliers → analyze_bid_data
- Plan notes, drawings, specifications, contract provisions → search_knowledge
- Questions needing both → use both tools and synthesize

When calling analyze_bid_data:
- Read the bid_items schema and available projects in the tool description
- Write a PostgreSQL SELECT with LIMIT (max 50)
- Default to the project with the most recent let_dt when the user omits a project

Examples:
- "top 5 most expensive bid items" → analyze_bid_data: bid_rank = 1 ORDER BY ext_amt DESC LIMIT 5
- "what does D-705 say" → search_knowledge with source_filter "specs"
- "what does the plan say about drainage" → search_knowledge with source_filter "planset"

Anti-rules:
- Do not use search_knowledge for exact price math, rankings, or outliers
- Do not use analyze_bid_data for plan or specification prose
- Do not answer from memory when a tool can answer from project data

Grounding:
- For bid data answers, cite item codes, bidder names, project IDs, and units from tool results
- For document answers, state the finding directly in the opening sentence with quantities and units when present
- When search_knowledge returns results, always end your answer with a "Sources" section
- In Sources, list each entry from the tool's sources array as a bullet: file name, page or page range, and section ID/title when available
- Example Sources format:
  Sources:
  - plans.pdf, page 12, (DEMOLITION PLAN)
- For plan set answers, use source_file, page number, and section title from tool results (not vague references like "the demolition plan sheet")
- For specification answers, use source_file, page or page range, and section ID/title from tool results
- You may add a brief clarifying note if the tool results distinguish related items (e.g. asphalt vs concrete on the same sheet), but keep it factual
- Never invent prices, quantities, bidders, file names, page numbers, or specification requirements
- If the available data is insufficient, say exactly what is missing

Style:
- Be concise and direct. Answer the question, then Sources — nothing else
- Do not add closing offers such as "Let me know if...", "Feel free to ask...", or similar follow-up prompts
- Do not embed citations inline instead of the Sources section when search_knowledge was used
- Prefer bullet lists for ranked bid items or comparisons
- Include enough numeric detail for an estimator to verify the answer`;

let openaiClient: OpenAI | null = null;
let openaiClientOverride: OpenAI | null = null;
let executeToolOverride: ((name: string, args: unknown) => Promise<unknown>) | null = null;

function getOpenAI(): OpenAI {
  if (openaiClientOverride) {
    return openaiClientOverride;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: requireOpenAIKey() });
  }
  return openaiClient;
}

/** Test hook: inject a mock OpenAI client. Pass null to reset. */
export function setOpenAIClientForTests(client: OpenAI | null): void {
  openaiClientOverride = client;
}

/** Test hook: inject a mock tool executor. Pass null to reset. */
export function setExecuteToolForTests(
  fn: ((name: string, args: unknown) => Promise<unknown>) | null,
): void {
  executeToolOverride = fn;
}

function parseToolArgs(args: unknown, toolName: string): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`${toolName} requires a JSON object.`);
  }
  return args as Record<string, unknown>;
}

function parseAnalyzeArgs(args: unknown): AnalyzeBidDataParams {
  const record = parseToolArgs(args, "analyze_bid_data");
  const sql = typeof record.sql === "string" ? record.sql.trim() : "";
  const queryType = typeof record.query_type === "string" ? record.query_type.trim() : "";

  if (!queryType) {
    throw new Error("analyze_bid_data requires a non-empty query_type string.");
  }
  if (!sql) {
    throw new Error("analyze_bid_data requires a non-empty sql string.");
  }

  const params: AnalyzeBidDataParams = { query_type: queryType, sql };
  if (typeof record.explanation === "string") {
    params.explanation = record.explanation;
  }
  return params;
}

function parseSearchArgs(args: unknown): SearchKnowledgeParams {
  const record = parseToolArgs(args, "search_knowledge");
  const query = typeof record.query === "string" ? record.query.trim() : "";

  if (!query) {
    throw new Error("search_knowledge requires a non-empty query string.");
  }

  const params: SearchKnowledgeParams = { query };
  if (record.source_filter === "planset" || record.source_filter === "specs") {
    params.source_filter = record.source_filter;
  }
  return params;
}

export async function executeTool(name: string, args: unknown): Promise<unknown> {
  if (executeToolOverride) {
    return executeToolOverride(name, args);
  }

  switch (name) {
    case "analyze_bid_data":
      return analyzeBidData(parseAnalyzeArgs(args));
    case "search_knowledge":
      return searchKnowledge(parseSearchArgs(args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function executeToolCall(call: ChatCompletionMessageFunctionToolCall): Promise<unknown> {
  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(call.function.arguments);
  } catch {
    throw new Error(`Invalid JSON in ${call.function.name} arguments.`);
  }

  debugSection(`Tool call: ${call.function.name}`, parsedArgs);
  const result = await executeTool(call.function.name, parsedArgs);
  debugSection(`Tool result: ${call.function.name}`, result);
  return result;
}

export async function runAgent(
  userMessage: string,
  history: AgentMessage[] = [],
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  const openai = getOpenAI();
  const projectContext = await getBidItemsProjectContext();
  const tools = buildToolDefinitions(projectContext);

  debugSection("Agent run: initial LLM context", {
    model: config.chatModel,
    user_message: userMessage,
    history_message_count: history.length,
    project_context: projectContext,
    messages,
  });

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step++) {
    debugSection(`LLM request (step ${step + 1})`, {
      model: config.chatModel,
      message_count: messages.length,
      tool_count: tools.length,
      messages,
    });

    const response: ChatCompletion = await openai.chat.completions.create({
      model: config.chatModel,
      messages,
      tools,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("OpenAI returned no message.");
    }

    const { message } = choice;

    debugSection(`LLM response (step ${step + 1})`, {
      finish_reason: choice.finish_reason,
      content: message.content,
      tool_calls: message.tool_calls,
    });

    if (choice.finish_reason === "stop") {
      return message.content ?? "";
    }

    if (choice.finish_reason === "tool_calls") {
      messages.push(message);

      for (const call of message.tool_calls ?? []) {
        const result = await executeToolCall(call as ChatCompletionMessageFunctionToolCall);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      continue;
    }

    throw new Error(`Unsupported finish_reason: ${choice.finish_reason}`);
  }

  throw new Error("Agent exceeded maximum tool-call iterations.");
}
