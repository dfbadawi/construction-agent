import postgres from "postgres";
import { config } from "../config";

export const db = postgres({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  username: config.postgres.username,
  password: config.postgres.password,
  ssl: config.postgres.ssl,
});

export async function closeDb(): Promise<void> {
  await db.end({ timeout: 5 });
}
