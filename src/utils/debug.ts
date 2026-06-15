import { isDebugMode } from "../config";

export { isDebugMode };

export function debugSection(title: string, payload: unknown): void {
  if (!isDebugMode()) {
    return;
  }

  const separator = "─".repeat(60);
  console.error(`\n[debug] ${title}\n${separator}`);

  if (typeof payload === "string") {
    console.error(payload);
  } else {
    console.error(JSON.stringify(payload, null, 2));
  }

  console.error(separator);
}
