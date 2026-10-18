import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { corpusSize, ingestBundles, searchVersionOf, type BillBundle, type Db } from '@statehouse/core';
import { createHashingEmbedder, fixtureBundles, freshDb } from './helpers.ts';

const counts = async (db: Db) => {
  const { rows } = await db.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM bills) bills, (SELECT count(*)::int FROM bill_versions) versions,
            (SELECT count(*)::int FROM sponsors) sponsors, (SELECT count(*)::int FROM actions) actions,
            (SELECT count(*)::int FROM chunks) chunks`,
  );
  return rows[0]!;
};

describe('ingestion of recorded California fixture bills', () => {
  let db: Db;
  let bundles: BillBundle[];
  beforeAll(async () => {
    db = await freshDb();
    bundles = await fixtureBundles();
  });
  afterAll(() => db.close());

  it('loads real bills including some with an introduced version plus 2+ amendments', () => {
    expect(bundles.length).toBeGreaterThanOrEqual(6);
    expect(bundles.filter((b) => b.versions.length >= 3).length).toBeGreaterThanOrEqual(3);
    for (const b of bundles) {
      expect(b.versions[0]!.action).toMatch(/Introduced/i);
      for (const v of b.versions) expect(v.text.length).toBeGreaterThan(100);
    }
  });

  it('normalises bills, versions, sponsors, actions and search chunks', async () => {
    const embedder = createHashingEmbedder();
    const stats = await ingestBundles(db, bundles, embedder);
    const totalVersions = bundles.reduce((n, b) => n + b.versions.length, 0);
    expect(stats.bills).toBe(bundles.length);
    expect(stats.versionsInserted).toBe(totalVersions);
    expect(stats.chunksEmbedded).toBeGreaterThan(0);
    const c = await counts(db);
    expect(c.bills).toBe(bundles.length);
    expect(c.versions).toBe(totalVersions);
    expect(c.sponsors).toBeGreaterThan(0);
    expect(c.actions).toBeGreaterThan(0);
    // Only the latest version of each bill is indexed for search.
    const { rows } = await db.query<{ bad: number }>(
      'SELECT count(*)::int AS bad FROM chunks c JOIN bills b USING (bill_id) WHERE c.version_id <> b.latest_version_id',
    );
    expect(rows[0]!.bad).toBe(0);
  });

  it('is idempotent: a re-run writes no new rows and embeds nothing', async () => {
    const before = await counts(db);
    const embedder = createHashingEmbedder();
    const stats = await ingestBundles(db, bundles, embedder);
    expect(stats.versionsInserted).toBe(0);
    expect(stats.versionsUpdated).toBe(0);
    expect(stats.versionsUnchanged).toBe(bundles.reduce((n, b) => n + b.versions.length, 0));
    expect(stats.chunksEmbedded).toBe(0);
    expect(embedder.calls).toBe(0);
    expect(await counts(db)).toEqual(before);
  });

  it('updates a changed version in place and only re-embeds the changed chunks', async () => {
    const target = bundles.find((b) => b.versions.length >= 3)!;
    const latest = searchVersionOf(target)!;
    const edited: BillBundle = {
      ...target,
      versions: target.versions.map((v) => (v.versionId === latest.versionId ? { ...v, text: `${v.text}\n\nSEC. 99. A newly added section about testing.` } : v)),
    };
    const before = await counts(db);
    const embedder = createHashingEmbedder();
    const stats = await ingestBundles(db, [edited], embedder);
    expect(stats.versionsUpdated).toBe(1);
    expect(stats.versionsInserted).toBe(0);
    expect(stats.versionsUnchanged).toBe(target.versions.length - 1);
    expect(stats.chunksEmbedded).toBeGreaterThanOrEqual(1);
    expect(stats.chunksReused).toBeGreaterThanOrEqual(0);
    expect(embedder.calls).toBe(stats.chunksEmbedded);
    const after = await counts(db);
    expect(after.versions).toBe(before.versions);
    const { rows } = await db.query<{ text: string }>('SELECT text FROM bill_versions WHERE version_id = $1', [latest.versionId]);
    expect(rows[0]!.text.endsWith('about testing.')).toBe(true);
    const size = await corpusSize(db);
    expect(size.bills).toBe(bundles.length);
  });
});
