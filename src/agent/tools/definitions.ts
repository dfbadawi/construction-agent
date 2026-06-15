import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { buildAnalyzeBidDataDescription } from "./bid-items-schema";

const SEARCH_KNOWLEDGE_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_knowledge",
    description:
      "Semantic search over embedded plan sets and specifications. Use for plan notes, drawing callouts, spec sections, contract provisions, demolition quantities, and topics like drainage or underdrains. Results include a sources array with ready-to-cite strings (file name, page or page range, section ID/title) — the assistant must copy these into a Sources section at the end of the answer. Do not use for bid prices, rankings, or quantities from the CSV.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query over embedded documents.",
        },
        source_filter: {
          type: "string",
          enum: ["planset", "specs"],
          description:
            'Optional filter: "planset" for plans/drawings, "specs" for specifications and section IDs like D-705.',
        },
      },
      required: ["query"],
    },
  },
};

function buildAnalyzeBidDataTool(projectContext: string): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: "analyze_bid_data",
      description: buildAnalyzeBidDataDescription(projectContext),
      parameters: {
        type: "object",
        properties: {
          query_type: {
            type: "string",
            description: 'Short label, e.g. "top_items", "outliers", "bidder_comparison".',
          },
          sql: {
            type: "string",
            description:
              "PostgreSQL SELECT (or WITH ... SELECT) against bid_items only. Must include LIMIT (max 50).",
          },
          explanation: {
            type: "string",
            description: "Optional one-sentence description of what the SQL returns.",
          },
        },
        required: ["query_type", "sql"],
      },
    },
  };
}

export function buildToolDefinitions(projectContext = ""): ChatCompletionTool[] {
  return [buildAnalyzeBidDataTool(projectContext), SEARCH_KNOWLEDGE_TOOL];
}

/** Static tool definitions without runtime project context (tests). */
export const TOOL_DEFINITIONS: ChatCompletionTool[] = buildToolDefinitions(
  "Available projects: (not loaded — query bid_items or rely on user-specified proj_id)",
);
