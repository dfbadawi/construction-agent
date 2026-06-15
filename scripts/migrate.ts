import { db, closeDb } from "../src/storage/db";

const args = process.argv.slice(2);
const destroy = args.includes("--destroy");

async function destroyDatabase(): Promise<void> {
  console.log("Dropping all application objects...");
  await db.unsafe(`
    DROP TABLE IF EXISTS document_chunks CASCADE;
    DROP TABLE IF EXISTS bid_items CASCADE;
    DROP EXTENSION IF EXISTS vector CASCADE;
    DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
  `);
  console.log("Database cleared.");
}

if (args.some((arg) => arg !== "--destroy")) {
  console.error("Usage: bun run migrate [-- --destroy]");
  process.exitCode = 1;
} else {
  try {
    if (destroy) {
      await destroyDatabase();
    }

    const schema = await Bun.file("schema.sql").text();
    await db.unsafe(schema);

    console.log(destroy ? "Fresh database created." : "Database migration completed.");
  } catch (error) {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
