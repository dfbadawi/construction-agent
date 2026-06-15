import { config } from "../../config";
import { db } from "../../storage/db";
import { embedTexts, toPgVector } from "../../storage/embeddings";

export interface SearchKnowledgeParams {
  query: string;
  source_filter?: "planset" | "specs" | null;
  limit?: number;
  min_similarity?: number;
}

export interface SearchResult {
  id: string;
  source: "planset" | "specs";
  source_file: string | null;
  page_number: number | null;
  page_end: number | null;
  section_id: string | null;
  section_title: string | null;
  content: string;
  similarity: number;
  citation: string;
}

export interface SearchKnowledgeResult {
  query: string;
  chunks: SearchResult[];
  sources: string[];
}

interface DbSearchRow {
  id: string;
  source: "planset" | "specs";
  source_file: string | null;
  page_number: number | null;
  page_end: number | null;
  section_id: string | null;
  section_title: string | null;
  content: string;
  similarity: number | string;
}

function formatPageReference(pageNumber: number | null, pageEnd: number | null): string | null {
  if (pageNumber === null) {
    return null;
  }
  if (pageEnd !== null && pageEnd !== pageNumber) {
    return `pages ${pageNumber}\u2013${pageEnd}`;
  }
  return `page ${pageNumber}`;
}

export function formatCitation(row: {
  source: string;
  source_file?: string | null;
  page_number: number | null;
  page_end?: number | null;
  section_id: string | null;
  section_title: string | null;
}): string {
  const parts = [row.source_file ?? "document"];
  const pageRef = formatPageReference(row.page_number, row.page_end ?? row.page_number);
  if (pageRef) {
    parts.push(pageRef);
  }

  if (row.source === "specs") {
    if (row.section_id && row.section_title) {
      parts.push(`section ${row.section_id} \u2013 ${row.section_title}`);
    } else if (row.section_id) {
      parts.push(`section ${row.section_id}`);
    }
  } else if (row.section_title) {
    parts.push(`(${row.section_title})`);
  }

  return parts.join(", ");
}

export async function searchKnowledge(
  params: SearchKnowledgeParams,
): Promise<SearchKnowledgeResult> {
  const query = params.query?.trim() ?? "";
  if (!query) {
    throw new Error("search_knowledge requires a non-empty query string.");
  }

  const limit = params.limit ?? 5;
  const minSimilarity = params.min_similarity ?? config.searchSimilarityThreshold;
  const sourceFilter = params.source_filter ?? null;

  const [queryVector] = await embedTexts([query]);
  const vectorStr = toPgVector(queryVector);

  const rows = await db<DbSearchRow[]>`
    WITH ranked AS (
      SELECT
        id,
        source,
        source_file,
        page_number,
        page_end,
        section_id,
        section_title,
        content,
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM document_chunks
      WHERE embedding IS NOT NULL
        AND (${sourceFilter}::text IS NULL OR source = ${sourceFilter})
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    )
    SELECT *
    FROM ranked
    WHERE similarity >= ${minSimilarity}
    ORDER BY similarity DESC
  `;

  const chunks: SearchResult[] = rows.map((row) => ({
    id: row.id,
    source: row.source,
    source_file: row.source_file,
    page_number: row.page_number,
    page_end: row.page_end,
    section_id: row.section_id,
    section_title: row.section_title,
    content: row.content,
    similarity: Number(row.similarity),
    citation: formatCitation(row),
  }));

  const sources = [...new Set(chunks.map((chunk) => chunk.citation))];

  return { query, chunks, sources };
}
