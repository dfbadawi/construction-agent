import "dotenv/config";

export function isDebugMode(): boolean {
  return process.env.DEBUG_MODE === "true";
}

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  chatModel: process.env.CHAT_MODEL ?? "gpt-4.1-mini",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  searchSimilarityThreshold: Number(process.env.SEARCH_SIMILARITY_THRESHOLD ?? "0.35"),
  ingestPlanPages: process.env.INGEST_PLAN_PAGES ?? "1-5,12",
  postgres: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DB ?? "construction_agent",
    username: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
    ssl: process.env.POSTGRES_SSL === "true",
  },
};

export function requireOpenAIKey(): string {
  if (!config.openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY. Copy .env.example to .env and set OPENAI_API_KEY.");
  }
  return config.openaiApiKey;
}
