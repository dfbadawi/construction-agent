import { afterEach, describe, expect, mock, test } from "bun:test";
import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import {
  AGENT_SYSTEM_PROMPT,
  runAgent,
  setExecuteToolForTests,
  setOpenAIClientForTests,
} from "../src/agent/index";
import { TOOL_DEFINITIONS } from "../src/agent/tools/definitions";

function makeToolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
): ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Date.now(),
    model: "gpt-4.1-mini",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  } as ChatCompletion;
}

function makeStopResponse(content: string): ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Date.now(),
    model: "gpt-4.1-mini",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content,
          refusal: null,
        },
      },
    ],
  } as ChatCompletion;
}

function makeMockOpenAI(responses: ChatCompletion[]): OpenAI {
  let callIndex = 0;
  const create = mock(async () => {
    const response = responses[callIndex];
    callIndex += 1;
    if (!response) {
      throw new Error("Mock OpenAI has no more queued responses.");
    }
    return response;
  });

  return {
    chat: {
      completions: {
        create,
      },
    },
  } as unknown as OpenAI;
}

async function stubExecuteTool(name: string, args: unknown): Promise<unknown> {
  const record = (args && typeof args === "object" && !Array.isArray(args)
    ? args
    : {}) as Record<string, unknown>;

  switch (name) {
    case "analyze_bid_data":
      return {
        query_type: record.query_type ?? "top_items",
        results: [{ item_no: "001", ext_amt: 1000 }],
        explanation: "Stub analyze_bid_data result.",
      };
    case "search_knowledge":
      return {
        query: record.query ?? "query",
        chunks: [],
        sources: [],
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

afterEach(() => {
  setOpenAIClientForTests(null);
  setExecuteToolForTests(null);
});

describe("agent", () => {
  test("exposes two tools with core routing in the system prompt", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(2);
    expect(
      TOOL_DEFINITIONS.flatMap((tool) =>
        tool.type === "function" ? [tool.function.name] : [],
      ),
    ).toEqual([
      "analyze_bid_data",
      "search_knowledge",
    ]);
    expect(AGENT_SYSTEM_PROMPT).toContain("analyze_bid_data");
    expect(AGENT_SYSTEM_PROMPT).toContain("search_knowledge");
    expect(AGENT_SYSTEM_PROMPT).toContain("Sources");
  });

  test('routes bid analytics questions through analyze_bid_data', async () => {
    const client = makeMockOpenAI([
      makeToolCallResponse("analyze_bid_data", {
        query_type: "top_items",
        sql: "SELECT item_no, ext_amt FROM bid_items WHERE bid_rank = 1 ORDER BY ext_amt DESC LIMIT 5",
      }),
      makeStopResponse("Top items retrieved from bid data."),
    ]);
    setOpenAIClientForTests(client);
    setExecuteToolForTests(stubExecuteTool);

    const answer = await runAgent("What are the top 5 most expensive bid items?");
    expect(answer).toBe("Top items retrieved from bid data.");
  });

  test('routes document questions through search_knowledge', async () => {
    const client = makeMockOpenAI([
      makeToolCallResponse("search_knowledge", {
        query: "drainage",
        source_filter: "planset",
      }),
      makeStopResponse("The plan mentions drainage requirements on page 3."),
    ]);
    setOpenAIClientForTests(client);
    setExecuteToolForTests(stubExecuteTool);

    const answer = await runAgent("What does the plan say about drainage?");
    expect(answer).toBe("The plan mentions drainage requirements on page 3.");
  });
});
