import { db } from "../../storage/db";
import { debugSection } from "../../utils/debug";

export interface AnalyzeBidDataParams {
  query_type: string;
  sql: string;
  explanation?: string;
}

export interface AnalyzeBidDataResult {
  query_type: string;
  results: Record<string, unknown>[];
  explanation: string;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      result[key] = value.toISOString().slice(0, 10);
    } else if (typeof value === "bigint") {
      result[key] = Number(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function serializeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(serializeRow);
}

function buildSuccessExplanation(
  queryType: string,
  rowCount: number,
  agentExplanation?: string,
): string {
  if (agentExplanation && agentExplanation.trim().length > 0) {
    return agentExplanation.trim();
  }

  return `Returned ${rowCount} row(s) for query_type "${queryType}".`;
}

function formatExecutionError(error: unknown): string {
  if (error instanceof Error) {
    return `SQL execution failed: ${error.message}`;
  }
  return "SQL execution failed with an unknown error.";
}

export async function analyzeBidData(
  input: AnalyzeBidDataParams,
): Promise<AnalyzeBidDataResult> {
  const queryType = input.query_type.trim();
  const sql = input.sql.trim();

  debugSection("analyze_bid_data: agent SQL", {
    query_type: queryType,
    sql,
    explanation: input.explanation ?? null,
  });

  if (sql.length === 0) {
    const explanation = "SQL query is empty.";
    debugSection("analyze_bid_data: execution failed", explanation);
    return {
      query_type: queryType,
      results: [],
      explanation,
    };
  }

  try {
    const rows = (await db.unsafe(sql)) as Record<string, unknown>[];
    const results = serializeRows(rows);

    debugSection("analyze_bid_data: database results", {
      row_count: results.length,
      rows: results,
    });

    return {
      query_type: queryType,
      results,
      explanation: buildSuccessExplanation(queryType, results.length, input.explanation),
    };
  } catch (error) {
    const explanation = formatExecutionError(error);
    debugSection("analyze_bid_data: execution failed", explanation);
    return {
      query_type: queryType,
      results: [],
      explanation,
    };
  }
}
