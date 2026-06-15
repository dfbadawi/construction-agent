import { basename, resolve } from "node:path";

export function resolveInputPath(filePath: string): string {
  return resolve(process.cwd(), filePath);
}

export function sourceFileName(filePath: string): string {
  return basename(resolveInputPath(filePath));
}

export async function assertReadableFile(filePath: string): Promise<void> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`);
  }
}

export function parsePages(spec: string): number[] {
  const pages: number[] = [];

  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > end) {
        throw new Error(`Invalid page range "${trimmed}": start must be <= end`);
      }
      for (let page = start; page <= end; page++) {
        pages.push(page);
      }
      continue;
    }

    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid page spec "${trimmed}" in "${spec}"`);
    }
    pages.push(Number(trimmed));
  }

  return [...new Set(pages)].sort((a, b) => a - b);
}
