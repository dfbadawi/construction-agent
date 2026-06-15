import Papa from "papaparse";
import type { BidItem, IngestResult } from "../types";
import { db } from "../storage/db";
import { chunkArray } from "../utils/chunk";

const KNOWN_COLUMNS: Record<string, string> = {
  PROJ_ID: "proj_id",
  LET_DT: "let_dt",
  CNTY: "county",
  ITEM_NO: "item_no",
  ITEM_DESC: "item_desc",
  UNIT: "unit",
  QTY: "qty",
  ENG_EST_UNIT_PR: "eng_est_unit_pr",
  BIDDER: "bidder",
  BID_RANK: "bid_rank",
  UNIT_PR: "unit_pr",
  EXT_AMT: "ext_amt",
  BID_TOTAL: "bid_total",
};

const REQUIRED_HEADERS = ["PROJ_ID", "ITEM_NO", "BIDDER"] as const;

const INSERT_COLUMNS = [
  "proj_id",
  "let_dt",
  "county",
  "item_no",
  "item_desc",
  "unit",
  "qty",
  "eng_est_unit_pr",
  "bidder",
  "bid_rank",
  "unit_pr",
  "ext_amt",
  "bid_total",
] as const;

const BATCH_SIZE = 100;

function asIdentifierString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function asTrimmedString(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function asNumber(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: unknown): string | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = new Date(String(value).trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function normalizeHeaders(headers: string[]): Record<string, string> {
  const columnMap: Record<string, string> = {};
  for (const header of headers) {
    const known = KNOWN_COLUMNS[header.trim().toUpperCase()];
    if (known) {
      columnMap[header] = known;
    }
  }
  return columnMap;
}

export function normalizeRow(
  row: Record<string, unknown>,
  columnMap: Record<string, string>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [originalKey, value] of Object.entries(row)) {
    const normalizedKey = columnMap[originalKey];
    if (normalizedKey) {
      mapped[normalizedKey] = value;
    }
  }

  return {
    proj_id: asIdentifierString(mapped.proj_id),
    let_dt: asDate(mapped.let_dt),
    county: asTrimmedString(mapped.county),
    item_no: asIdentifierString(mapped.item_no),
    item_desc: asTrimmedString(mapped.item_desc),
    unit: asTrimmedString(mapped.unit),
    qty: asNumber(mapped.qty),
    eng_est_unit_pr: asNumber(mapped.eng_est_unit_pr),
    bidder: asTrimmedString(mapped.bidder),
    bid_rank: asNumber(mapped.bid_rank),
    unit_pr: asNumber(mapped.unit_pr),
    ext_amt: asNumber(mapped.ext_amt),
    bid_total: asNumber(mapped.bid_total),
  };
}

function toBidItem(row: Record<string, unknown>): BidItem {
  return {
    proj_id: row.proj_id as string,
    let_dt: (row.let_dt as string | null) ?? null,
    county: (row.county as string | null) ?? null,
    item_no: row.item_no as string,
    item_desc: (row.item_desc as string | null) ?? null,
    unit: (row.unit as string | null) ?? null,
    qty: (row.qty as number | null) ?? null,
    eng_est_unit_pr: (row.eng_est_unit_pr as number | null) ?? null,
    bidder: row.bidder as string,
    bid_rank: (row.bid_rank as number | null) ?? null,
    unit_pr: (row.unit_pr as number | null) ?? null,
    ext_amt: (row.ext_amt as number | null) ?? null,
    bid_total: (row.bid_total as number | null) ?? null,
  };
}

export async function ingestCSV(filePath: string): Promise<IngestResult> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new Error(`CSV file not found: ${filePath}`);
  }

  const raw = await file.text();
  const parsed = Papa.parse<Record<string, unknown>>(raw, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(
      `Failed to parse CSV ${filePath}: ${firstError.message} (row ${firstError.row ?? "unknown"})`,
    );
  }

  const headers = parsed.meta.fields ?? [];
  const columnMap = normalizeHeaders(headers);

  for (const header of REQUIRED_HEADERS) {
    const normalized = KNOWN_COLUMNS[header];
    if (!Object.values(columnMap).includes(normalized)) {
      throw new Error(`Missing required CSV header: ${header}`);
    }
  }

  const validRows: BidItem[] = [];
  for (const row of parsed.data) {
    const normalized = normalizeRow(row, columnMap);
    if (!normalized.proj_id || !normalized.item_no || !normalized.bidder) {
      continue;
    }
    validRows.push(toBidItem(normalized));
  }

  if (validRows.length === 0) {
    throw new Error(`No valid rows found in CSV: ${filePath}`);
  }

  for (const batch of chunkArray(validRows, BATCH_SIZE)) {
    await db`
      INSERT INTO bid_items ${db(batch, [...INSERT_COLUMNS])}
    `;
  }

  return {
    rowsInserted: validRows.length,
    chunksCreated: 0,
  };
}
