import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hybridSearch, ingestBundles, type BillBundle, type Db } from '@statehouse/core';
import { createHashingEmbedder, fixtureBundles, freshDb } from './helpers.ts';

describe('hybridSearch over PGlite + pgvector', () => {
  let db: Db;
  let bundles: BillBundle[];
  const embedder = createHashingEmbedder();
  beforeAll(async () => {
    db = await freshDb();
    bundles = await fixtureBundles();
    await ingestBundles(db, bundles, embedder);
  });
  afterAll(() => db.close());

  // Use a distinctive word from a fixture bill's own title as the query.
  const titleQuery = (b: BillBundle) => {
    const words = (b.versions.at(-1)!.title ?? '').match(/[A-Za-z]{7,}/g) ?? [];
    return words.find((w) => !/^(relating|Section|Sections|amend|repeal|Government|addition)$/i.test(w)) ?? words[0]!;
  };

  it('finds a bill by a word from its title, with highlighted snippet and both retriever ranks', async () => {
    const target = bundles[0]!;
    const q = titleQuery(target);
    const res = await hybridSearch({ db, embedder, semantic: true }, { q, limit: 10 });
    expect(res.semantic).toBe(true);
    const hit = res.results.find((r) => r.billId === target.bill.billId);
    expect(hit, `query "${q}"`).toBeDefined();
    expect(hit!.ftsRank).not.toBeNull();
    expect(hit!.vectorRank).not.toBeNull();
    expect(hit!.snippet.some((p) => p.hit)).toBe(true);
    // Scores are RRF scores, sorted descending.
    const scores = res.results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('fuses lexical and vector lists: a bill in both outranks bills in only one', async () => {
    const q = titleQuery(bundles[1]!);
    const res = await hybridSearch({ db, embedder, semantic: true }, { q, limit: 20 });
    const both = res.results.filter((r) => r.ftsRank && r.vectorRank);
    const single = res.results.filter((r) => !(r.ftsRank && r.vectorRank));
    if (both.length && single.length) {
      const bestSingle = Math.max(...single.map((r) => r.score));
      expect(both.some((r) => r.score > bestSingle)).toBe(true);
    }
    expect(both.length).toBeGreaterThan(0);
  });

  it('feature flag off: only full-text ranking is used and the embedder is not called', async () => {
    const calls = embedder.calls;
    const res = await hybridSearch({ db, embedder, semantic: false }, { q: titleQuery(bundles[0]!) });
    expect(res.semantic).toBe(false);
    expect(embedder.calls).toBe(calls);
    expect(res.results.length).toBeGreaterThan(0);
    for (const r of res.results) expect(r.vectorRank).toBeNull();
  });

  it('applies session, status, sponsor and subject filters', async () => {
    const target = bundles.find((b) => b.sponsors.length > 0)!;
    const q = titleQuery(target);
    const status = await hybridSearch({ db, embedder, semantic: true }, { q, status: target.bill.measureState });
    expect(status.results.every((r) => r.status === target.bill.measureState)).toBe(true);
    const lead = target.sponsors.find((s) => s.versionId === target.bill.latestVersionId && s.contribution === 'LEAD_AUTHOR') ?? target.sponsors[0]!;
    const bySponsor = await hybridSearch({ db, embedder, semantic: true }, { q, sponsor: lead.name });
    expect(bySponsor.results.map((r) => r.billId)).toContain(target.bill.billId);
    const none = await hybridSearch({ db, embedder, semantic: true }, { q, session: '19991900' });
    expect(none.results).toEqual([]);
    const subject = target.versions.at(-1)!.subject!;
    const bySubject = await hybridSearch({ db, embedder, semantic: true }, { q: '', subject: subject.slice(0, 12) });
    expect(bySubject.results.map((r) => r.billId)).toContain(target.bill.billId);
  });
});
