# Construction Agent

## Requirements

- Bun 1.3.x
- Docker and Docker Compose
- OpenAI API key

## Install Bun

**macOS / Linux**

```bash
curl -fsSL https://bun.sh/install | bash
```

## Setup

```bash
bun install
cp .env.example .env
```

Add your `OPENAI_API_KEY` to `.env`, then start the database and run migrations:

```bash
docker compose up -d
bun run migrate
```

To reset the database completely (drops all tables and data, then recreates the schema):

```bash
bun run migrate -- --destroy
```

## Ingest Data

Place your files in `data/` (gitignored), then ingest:

```bash
# Bid tabulation CSV
bun ingest --csv ./data/sample_bid_tabulation.csv

# Plan set PDF (OCR; optional page range)
bun ingest --pdf ./data/plans.pdf --pdf-type planset --pages 1-5,12

# Specifications PDF (text extraction)
bun ingest --pdf ./data/specifications-vol-1.pdf --pdf-type specs
```

## Ask Questions

**Single-shot** — pass the question on the command line:

```bash
bun ask "What are the top 5 most expensive bid items?"
bun ask "How much asphalt pavement is to be removed from Runway 13-31 on the demolition plan?"
bun ask "What does D-705 say about underdrains?"
```

**REPL** — run with no arguments for an interactive session (type `exit` or `quit` to leave):

```bash
bun ask
```

## Architecture

For architecture, design decisions, and out-of-scope items intentionally omitted for simplicity, see [ARCHITECTURE.md](ARCHITECTURE.md).
