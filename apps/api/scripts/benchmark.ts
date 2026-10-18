/**
 * Search latency benchmark: runs 200 queries against the loaded corpus through the same hybridSearch
 * code path the API uses (query embedding + full-text + vector retrieval + RRF + snippet hydration)
 * and writes results/search_latency.json.
 *
 *   npm run benchmark -- [--queries 200]
 *
 * Queries are the subject lines of bills in the corpus (deterministically shuffled), so they are
 * realistic legislative phrasing. Each query runs once in hybrid mode and once with the semantic
 * half disabled (the FEATURE_SEMANTIC_SEARCH=false path).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, platform, arch } from 'node:os';
import { corpusSize, createMiniLmEmbedder, hybridSearch, loadConfig, logger, openDb, repoRoot, MINILM_MODEL } from '@statehouse/core';
import { parseArgs } from './args.ts';

const args = parseArgs();
const n = Number(args.queries ?? 200);
const config = loadConfig();
const db = await openDb(config);
const corpus = await corpusSize(db);
if (corpus.chunks === 0) throw new Error('corpus is empty: run `npm run ingest` first');
const embedder = await createMiniLmEmbedder(config.modelCacheDir);

// Deterministic Fisher–Yates with a fixed LCG seed.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const { rows } = await db.query<{ subject: string }>("SELECT DISTINCT subject FROM bills WHERE subject IS NOT NULL AND subject <> '' ORDER BY subject");
const pool = rows.map((r) => r.subject.replace(/[.;:]+$/, ''));
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [pool[i], pool[j]] = [pool[j]!, pool[i]!];
}
const queries = Array.from({ length: n }, (_, i) => pool[i % pool.length]!);

const percentile = (sorted: number[], p: number) => {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]! * 100) / 100;
};

async function run(semantic: boolean) {
  for (const q of queries.slice(0, 5)) await hybridSearch({ db, embedder, semantic }, { q, limit: 20 }); // warm-up, untimed
  const times: number[] = [];
  let nonEmpty = 0;
  for (const q of queries) {
    const t0 = performance.now();
    const res = await hybridSearch({ db, embedder, semantic }, { q, limit: 20 });
    times.push(performance.now() - t0);
    if (res.results.length > 0) nonEmpty++;
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { queries: times.length, p50_ms: percentile(sorted, 50), p95_ms: percentile(sorted, 95), queries_with_results: nonEmpty };
}

const hybrid = await run(true);
const ftsOnly = await run(false);
const result = {
  generated_at: new Date().toISOString(),
  database: db.kind === 'pglite' ? 'PGlite (PostgreSQL 18 WASM) + pgvector, in-process' : 'PostgreSQL + pgvector',
  embedding_model: MINILM_MODEL,
  corpus,
  hybrid,
  fts_only: ftsOnly,
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', node: process.version },
  method: 'End-to-end hybridSearch() latency per query (embedding + FTS + vector + RRF + snippets), limit 20, 5 untimed warm-up queries, queries = shuffled bill subject lines.',
};
mkdirSync(join(repoRoot(), 'results'), { recursive: true });
writeFileSync(join(repoRoot(), 'results', 'search_latency.json'), JSON.stringify(result, null, 2) + '\n');
logger.info({ event: 'benchmark.complete', hybrid, ftsOnly, corpus });
await db.close();
