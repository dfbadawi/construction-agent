CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS bid_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proj_id           TEXT NOT NULL,
  let_dt            DATE,
  county            TEXT,
  item_no           TEXT NOT NULL,
  item_desc         TEXT,
  unit              TEXT,
  qty               NUMERIC,
  eng_est_unit_pr   NUMERIC DEFAULT 0,
  bidder            TEXT NOT NULL,
  bid_rank          INT,
  unit_pr           NUMERIC,
  ext_amt           NUMERIC,
  bid_total         NUMERIC
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source            TEXT NOT NULL CHECK (source IN ('planset', 'specs')),
  source_file       TEXT,
  page_number       INT,
  page_end          INT,
  section_id        TEXT,
  section_title     TEXT,
  content           TEXT NOT NULL,
  embedding         vector(1536),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bid_items_proj_item_idx ON bid_items (proj_id, item_no);
CREATE INDEX IF NOT EXISTS bid_items_bidder_idx ON bid_items (bidder);
CREATE INDEX IF NOT EXISTS document_chunks_source_idx ON document_chunks (source);
