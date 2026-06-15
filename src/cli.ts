import * as readline from "node:readline/promises";
import { runAgent, type AgentMessage } from "./agent/index";
import { ingestFiles, type IngestFilesParams } from "./ingestion/ingest";
import { closeDb } from "./storage/db";
import { parsePages } from "./utils/path";

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log(`Usage:
  bun ingest --csv <path>
  bun ingest --pdf <path> [--pdf-type planset|specs] [--pages 1-5,12]
  bun ask [question]`);
}

function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseIngestCommandArgs(args: string[]): IngestFilesParams {
  let csvPath: string | undefined;
  let pdfPath: string | undefined;
  let pdfType: "planset" | "specs" | undefined;
  let pagesSpec: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--csv") {
      csvPath = args[++index];
      if (!csvPath) {
        throw new Error("Missing path after --csv.");
      }
      continue;
    }
    if (arg === "--pdf") {
      pdfPath = args[++index];
      if (!pdfPath) {
        throw new Error("Missing path after --pdf.");
      }
      continue;
    }
    if (arg === "--pdf-type") {
      const value = args[++index];
      if (value === "planset" || value === "specs") {
        pdfType = value;
      } else {
        throw new Error(`Invalid --pdf-type: ${value ?? "(missing)"}. Use planset or specs.`);
      }
      continue;
    }
    if (arg === "--pages") {
      pagesSpec = args[++index];
      if (!pagesSpec) {
        throw new Error("Missing page spec after --pages.");
      }
      continue;
    }
    throw new Error(`Unknown ingest flag: ${arg}`);
  }

  if (csvPath && pdfPath) {
    throw new Error("Provide either --csv or --pdf, not both.");
  }
  if (!csvPath && !pdfPath) {
    throw new Error("Missing file path. Use --csv <path> or --pdf <path>.");
  }

  if (csvPath) {
    return { file_path: csvPath, file_type: "csv" };
  }

  if (!pdfType) {
    throw new Error("PDF ingestion requires --pdf-type planset or --pdf-type specs.");
  }

  const params: IngestFilesParams = {
    file_path: pdfPath!,
    file_type: pdfType,
  };

  if (pagesSpec) {
    params.pages = parsePages(pagesSpec);
  }

  return params;
}

async function runIngest(args: string[]): Promise<void> {
  const params = parseIngestCommandArgs(args);
  console.log(`Starting ingestion: ${params.file_path}`);

  const result = await ingestFiles(params);

  console.log(`Detected file type: ${result.file_type}`);
  console.log(`Rows inserted: ${result.rows_inserted}`);
  console.log(`Chunks created: ${result.chunks_created}`);
  console.log("Status: completed");
}

async function runAskInteractive(): Promise<void> {
  console.log("Construction Estimating Agent - ready");
  console.log("Type your question or 'exit' to quit");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const history: AgentMessage[] = [];

  try {
    while (true) {
      let question: string;
      try {
        question = await rl.question("> ");
      } catch {
        break;
      }

      const trimmed = question.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        break;
      }

      try {
        const answer = await runAgent(trimmed, history);
        console.log(answer);
        history.push({ role: "user", content: trimmed });
        history.push({ role: "assistant", content: answer });
      } catch (error) {
        console.error(formatCliError(error));
      }
    }
  } finally {
    rl.close();
  }
}

async function runAskSingleShot(question: string): Promise<void> {
  try {
    const answer = await runAgent(question);
    console.log(answer);
  } catch (error) {
    console.error(formatCliError(error));
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  if (command === "ingest") {
    try {
      await runIngest(args.slice(1));
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "ask") {
    const question = args.slice(1).join(" ").trim();
    if (question) {
      await runAskSingleShot(question);
    } else {
      await runAskInteractive();
    }
    return;
  }

  printUsage();
  process.exitCode = command ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
