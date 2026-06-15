import { join } from "node:path";
import { db } from "../../src/storage/db";

export const postgresAvailable = await (async (): Promise<boolean> => {
  try {
    await db`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

export async function applySchema(): Promise<void> {
  if (!postgresAvailable) {
    return;
  }
  const schema = await Bun.file(join(import.meta.dir, "../../schema.sql")).text();
  await db.unsafe(schema);
}
