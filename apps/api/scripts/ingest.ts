/**
 * Downloads California bills (all text versions, authors and history) from the official pubinfo
 * archive and loads them into Postgres/PGlite, embedding search chunks with all-MiniLM-L6-v2.
 *
 *   npm run ingest -- [--year 2025] [--limit 300] [--multi 200] [--source <dir>]
 *
 * Re-running is idempotent: rows are upserted by bill id / version id and unchanged chunks keep their
 * embeddings. Downloaded archive members are cached under data/raw/<year>/.
 */
import { join } from 'node:path';
import {
  buildBundles,
  corpusSize,
  createMiniLmEmbedder,
  directorySource,
  ingestBundles,
  loadConfig,
  loadTables,
  logger,
  migrate,
  openDb,
  remoteZipSource,
  repoRoot,
  selectBills,
} from '@statehouse/core';
import { parseArgs } from './args.ts';

const args = parseArgs();
const year = String(args.year ?? '2025');
const limit = Number(args.limit ?? 300);
const multi = Number(args.multi ?? 200);
const config = loadConfig();
const url = `https://downloads.leginfo.legislature.ca.gov/pubinfo_${year}.zip`;

const started = Date.now();
const source = typeof args.source === 'string'
  ? directorySource(args.source)
  : await remoteZipSource(url, join(repoRoot(), 'data', 'raw', year), (msg) => logger.info(msg));
const tables = await loadTables(source);
logger.info({ bills: tables.bills.length, versions: tables.versions.length }, 'loaded pubinfo tables');
const selected = selectBills(tables, { limit, minMultiVersion: multi });
const bundles = await buildBundles(source, tables, selected, {
  onProgress: (done, total) => {
    if (done % 100 === 0 || done === total) logger.info({ done, total }, 'parsed bill versions');
  },
});

const db = await openDb(config);
await migrate(db);
const embedder = await createMiniLmEmbedder(config.modelCacheDir);
const stats = await ingestBundles(db, bundles, embedder, {
  onProgress: (done, total, s) => {
    if (done % 25 === 0 || done === total) logger.info({ done, total, chunksEmbedded: s.chunksEmbedded }, 'ingested bills');
  },
});
const corpus = await corpusSize(db);
logger.info({ event: 'ingest.complete', source: typeof args.source === 'string' ? args.source : url, stats, corpus, seconds: (Date.now() - started) / 1000 });
await db.close();
