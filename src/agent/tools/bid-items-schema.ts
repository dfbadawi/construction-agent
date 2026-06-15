import { db } from "../../storage/db";

export const BID_ITEMS_TABLE_DDL = `Table: bid_items
  id                UUID PRIMARY KEY
  proj_id           TEXT NOT NULL       -- project identifier
  let_dt            DATE                -- letting date
  county            TEXT
  item_no           TEXT NOT NULL       -- bid item number
  item_desc         TEXT                -- item description
  unit              TEXT                -- unit of measure
  qty               NUMERIC
  eng_est_unit_pr   NUMERIC DEFAULT 0   -- engineer estimate unit price
  bidder            TEXT NOT NULL
  bid_rank          INT                 -- 1 = low/winning bid
  unit_pr           NUMERIC
  ext_amt           NUMERIC             -- extended amount (qty * unit_pr)
  bid_total         NUMERIC             -- bidder total for the project`;

export const BID_ITEMS_QUERY_GUIDANCE = `Rules for writing SQL:
- Query ONLY the bid_items table (CTEs referencing bid_items are OK).
- Write a single PostgreSQL SELECT statement (WITH ... SELECT allowed).
- Always include LIMIT (max 50).
- bid_rank = 1 means the winning/low bid line item for that bidder on that item.
- When the user does not specify a project and multiple projects exist, filter to the project with the most recent let_dt (see Available projects below).
- Use ILIKE for description substring filters, e.g. item_desc ILIKE '%asphalt%'.
- Use SUM, AVG, COUNT, GROUP BY for aggregates and comparisons.

Outlier detection pattern (z-score + 3x minimum ratio within proj_id + item_no groups):
WITH stats AS (
  SELECT proj_id, item_no, item_desc,
    AVG(unit_pr) AS avg_price, STDDEV(unit_pr) AS stddev_price,
    COUNT(*) AS bidder_count, MIN(unit_pr) AS min_price
  FROM bid_items
  WHERE unit_pr IS NOT NULL AND proj_id = '<proj_id>'
  GROUP BY proj_id, item_no, item_desc
  HAVING COUNT(*) > 1
)
SELECT b.*, ROUND((ABS(b.unit_pr - s.avg_price) / NULLIF(s.stddev_price, 0))::numeric, 2) AS z_score
FROM bid_items b JOIN stats s ON b.proj_id = s.proj_id AND b.item_no = s.item_no
WHERE s.stddev_price IS NOT NULL AND s.stddev_price <> 0
  AND ((ABS(b.unit_pr - s.avg_price) / NULLIF(s.stddev_price, 0)) > 2
    OR b.unit_pr >= 3 * NULLIF(s.min_price, 0))
ORDER BY z_score DESC LIMIT 50`;

export async function getBidItemsProjectContext(): Promise<string> {
  const projects = await db<
    { proj_id: string; let_dt: Date | null; row_count: number }[]
  >`
    SELECT
      proj_id,
      MAX(let_dt) AS let_dt,
      COUNT(*)::int AS row_count
    FROM bid_items
    GROUP BY proj_id
    ORDER BY MAX(let_dt) DESC NULLS LAST, proj_id ASC
  `;

  if (projects.length === 0) {
    return "Available projects: (none — no bid data ingested yet)";
  }

  const lines = projects.map((project, index) => {
    const letDate =
      project.let_dt instanceof Date
        ? project.let_dt.toISOString().slice(0, 10)
        : "unknown";
    const defaultNote = index === 0 ? " [default when user omits project]" : "";
    return `- ${project.proj_id}: let_dt=${letDate}, ${project.row_count} rows${defaultNote}`;
  });

  return `Available projects (ordered by most recent let_dt):\n${lines.join("\n")}`;
}

export function buildAnalyzeBidDataDescription(projectContext: string): string {
  return [
    "Query structured bid tabulation data by writing a PostgreSQL SELECT against bid_items.",
    "Use for prices, quantities, rankings, bidder comparisons, summaries, and outlier detection.",
    "Do not use this for plan drawing notes or specification text.",
    "",
    BID_ITEMS_TABLE_DDL,
    "",
    BID_ITEMS_QUERY_GUIDANCE,
    "",
    projectContext,
  ].join("\n");
}
