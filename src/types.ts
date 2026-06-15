export type FileType = "csv" | "planset" | "specs";
export type ChunkSource = "planset" | "specs";

export interface Chunk {
  source: ChunkSource;
  content: string;
  source_file?: string;
  page_number?: number;
  page_end?: number;
  section_id?: string;
  section_title?: string;
}

export interface IngestResult {
  rowsInserted: number;
  chunksCreated: number;
}

export interface BidItem {
  proj_id: string;
  let_dt: string | Date | null;
  county: string | null;
  item_no: string;
  item_desc: string | null;
  unit: string | null;
  qty: number | null;
  eng_est_unit_pr: number | null;
  bidder: string;
  bid_rank: number | null;
  unit_pr: number | null;
  ext_amt: number | null;
  bid_total: number | null;
}
