import { extname } from "node:path";
import * as embeddings from "../storage/embeddings";
import { assertReadableFile, resolveInputPath } from "../utils/path";
import { ingestCSV } from "./csv";
import { ingestPlanSet } from "./pdf-planset";
import { ingestSpecs } from "./pdf-specs";

export interface IngestFilesParams {
  file_path: string;
  file_type?: "csv" | "planset" | "specs" | "auto";
  pages?: number[];
}

export interface IngestFilesResult {
  file_type: "csv" | "planset" | "specs";
  rows_inserted: number;
  chunks_created: number;
}

export function resolveFileType(
  filePath: string,
  explicit: "csv" | "planset" | "specs" | "auto" = "auto",
): "csv" | "planset" | "specs" {
  const ext = extname(filePath).toLowerCase();

  if (ext !== ".csv" && ext !== ".pdf") {
    throw new Error(
      `Unsupported file type: ${ext || "(no extension)"}. Only .csv and .pdf files are supported.`,
    );
  }

  if (explicit !== "auto") {
    return explicit;
  }

  if (ext === ".csv") {
    return "csv";
  }

  throw new Error(
    'PDF files require an explicit file type. Use --pdf-type planset or --pdf-type specs.',
  );
}

export async function ingestFiles(params: IngestFilesParams): Promise<IngestFilesResult> {
  const filePath = resolveInputPath(params.file_path);
  await assertReadableFile(filePath);

  const fileType = resolveFileType(filePath, params.file_type ?? "auto");

  let rowsInserted = 0;
  let chunksCreated = 0;

  if (fileType === "csv") {
    const result = await ingestCSV(filePath);
    rowsInserted = result.rowsInserted;
  } else if (fileType === "planset") {
    const chunks = await ingestPlanSet(filePath, { pages: params.pages });
    console.log(`Embedding and storing ${chunks.length} plan chunks...`);
    await embeddings.storeChunks(chunks);
    chunksCreated = chunks.length;
  } else {
    const chunks = await ingestSpecs(filePath);
    console.log(`Embedding and storing ${chunks.length} specification chunks...`);
    await embeddings.storeChunks(chunks);
    chunksCreated = chunks.length;
  }

  return {
    file_type: fileType,
    rows_inserted: rowsInserted,
    chunks_created: chunksCreated,
  };
}
