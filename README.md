# Statehouse — Legislation Search & Collaborative Annotation

Full-stack TypeScript platform over California legislation: hybrid semantic + keyword search,
word-level diffs between bill versions, and annotations that sync live across browsers and survive
amendments.

![stack](https://img.shields.io/badge/stack-Next.js%20·%20Fastify%20·%20Postgres%20%2B%20pgvector-informational)

## Overview

Policy analysts track bills that are amended several times before they pass. Statehouse answers three
questions they ask every day:

- **What bills deal with this?** Hybrid search finds bills by meaning ("landlords raising rent") as well
  as by exact terms, with filters for session, status, sponsor and subject.
- **What changed in this amendment?** Pick any two versions of a bill and see insertions and deletions,
  side by side or inline.
- **What does my team think?** Highlight a passage and attach a note. Everyone viewing the bill sees it
  instantly, and notes are re-anchored (or flagged) when a later version rewrites the passage.

The loaded corpus is 300 bills from California's 2025–26 session: 1,179 bill versions (200 bills with
three or more), 8,675 embedded text chunks, 5,729 legislative actions.

## Architecture

```
 leginfo.legislature.ca.gov ──▶ ingest (Node) ──▶ Postgres + pgvector ◀── Fastify API ◀──▶ Next.js app
   pubinfo_2025.zip               parse, chunk,     bills, versions,        /api/search      search page
   (tables + bill XML)            embed, upsert     chunks (GIN + HNSW),    /api/bills/...   bill page: versions,
                                                    annotations             /api/.../diff    diff, annotations,
                                                                            /ws  ◀── WebSocket ──▶ live sync
```

- `packages/core` — domain logic shared by the API and the browser: pubinfo parsing, chunking,
  embeddings, hybrid search, diffing, annotation anchoring, the WebSocket hub.
- `apps/api` — Fastify REST API + WebSocket server, ingestion and benchmark scripts.
- `apps/web` — Next.js (App Router) UI, Storybook stories, shared design tokens.

## Setup

Requires Node 20+. No database server is needed for local use: when `DATABASE_URL` is unset the app
uses [PGlite](https://pglite.dev) (Postgres compiled to WASM, with pgvector) stored in `data/pglite`.

```bash
npm install
cp .env.example .env                       # optional; every variable has a default
npm run ingest -- --limit 300              # downloads CA pubinfo, loads + embeds 300 bills (~20 min on CPU)
```

To use a real Postgres instead: `docker compose up -d db`, set `DATABASE_URL`, and re-run ingest.

## Usage

```bash
npm run dev:api        # API + WebSocket on :4000
npm run dev:web        # web app on http://localhost:3000
npm run storybook      # component library on :6006
npm run benchmark      # writes results/search_latency.json
```

## Design decisions

- **Hybrid retrieval with reciprocal rank fusion.** Postgres full-text search (`ts_rank` over a GIN index)
  and pgvector cosine search (HNSW index) each produce a ranking; they are fused with RRF (k = 60). RRF
  needs no score normalisation between two very different scoring functions, and keeps exact-term
  matches near the top while semantic matches fill in synonyms.
- **Local embeddings.** `all-MiniLM-L6-v2` (384 dims) runs in-process through ONNX
  (`@huggingface/transformers`), so search has no external API dependency or per-query cost.
- **Semantic search behind a feature flag.** `FEATURE_SEMANTIC_SEARCH=false` falls back to keyword-only
  search, which makes the trade-off measurable (see Results) and gives a safe rollback path.
- **Two-pass diff.** Bills run to tens of thousands of words. Paragraphs are aligned first (cheap), then
  only replaced paragraphs are diffed word by word. Every segment keeps character offsets in both texts.
- **Amendment-proof annotations.** An annotation stores its offsets, the quoted passage and surrounding
  context in one version. Viewed against another version it is placed as *exact*, *moved* (quote found
  elsewhere), *changed* (diff maps it to rewritten text — flagged) or *orphaned* (passage deleted — flagged).
- **Live sync via a per-bill WebSocket hub.** Clients subscribe to a bill; creates and deletes are broadcast
  to every subscriber with presence counts. Writes go through REST so they are validated and persisted
  before broadcast.
- **Idempotent ingestion.** Versions are keyed on bill id + version id and chunks on a content hash, so
  re-running ingest skips unchanged text and only re-embeds what changed.

## Results

From `results/search_latency.json`: 200 queries end to end through the same `hybridSearch()` path the
API uses (query embedding + full-text + vector + RRF + snippets), limit 20, on an Apple M4 with the
in-process PGlite database over 8,675 chunks.

| Mode | p50 | p95 | Queries with results |
|---|---|---|---|
| Hybrid (keyword + semantic) | 10.19 ms | 15.06 ms | 200 / 200 |
| Keyword only | 1.79 ms | 7 ms | 156 / 200 |

Semantic retrieval costs about 8 ms per query (mostly embedding the query) and recovers the 44 queries
that keyword search alone could not answer. Queries are subject lines of bills in the corpus, so this
measures latency, not retrieval quality.

## Limitations

- One state (California) and 300 bills; scaling to all states would need batch embedding on a GPU or a
  hosted model, and a server Postgres instead of PGlite.
- No authentication: the annotation author is a free-text name.
- Search relevance has not been evaluated against labelled queries.
- Annotation sync assumes a single API process; multiple instances would need a shared pub/sub
  (e.g. Postgres `LISTEN/NOTIFY` or Redis).

## Testing

```bash
npm test          # 45 tests, fully offline (recorded CA fixture bills, deterministic test embedder)
npm run lint && npm run typecheck
```

Covers pubinfo parsing, ingestion idempotency, RRF ranking, diffing, annotation re-anchoring, the
WebSocket hub, and the REST API. GitHub Actions runs lint, typecheck and tests on every push.

## Data & licensing

Bill data: California Legislative Information (`downloads.leginfo.legislature.ca.gov`), public records of
the State of California. Embedding model: `Xenova/all-MiniLM-L6-v2` (Apache 2.0). Only small test fixtures
are committed; `npm run ingest` downloads the rest. Code is MIT licensed (see `LICENSE`).

## AI assistance disclosure

Built with AI coding tools: much of the code was generated with Claude (Anthropic) via Claude Code and
then reviewed, tested, debugged and completed by me.
