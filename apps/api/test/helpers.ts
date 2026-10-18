import { fileURLToPath } from 'node:url';
import {
  buildBundles,
  createHashingEmbedder,
  directorySource,
  loadTables,
  migrate,
  openPglite,
  selectBills,
  type BillBundle,
  type Db,
} from '@statehouse/core';

export const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/pubinfo', import.meta.url));

/** Real California bills recorded by `npm run fixtures:record` (see fixtures/pubinfo). */
export async function fixtureBundles(): Promise<BillBundle[]> {
  const source = directorySource(FIXTURE_DIR);
  const tables = await loadTables(source);
  const bills = selectBills(tables, { limit: 1000, minMultiVersion: 1000 });
  return buildBundles(source, tables, bills);
}

/** Fresh in-memory PGlite (Postgres + pgvector) with the schema applied. */
export async function freshDb(): Promise<Db> {
  const db = await openPglite();
  await migrate(db);
  return db;
}

export { createHashingEmbedder };
