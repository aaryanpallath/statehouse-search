import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnnotation, ingestBundles, listAnnotations, ValidationError, type BillBundle, type Db } from '@statehouse/core';
import { createHashingEmbedder, fixtureBundles, freshDb } from './helpers.ts';

describe('annotations persisted in Postgres and re-anchored across real bill versions', () => {
  let db: Db;
  let bill: BillBundle;
  beforeAll(async () => {
    db = await freshDb();
    const bundles = await fixtureBundles();
    await ingestBundles(db, bundles, createHashingEmbedder());
    bill = bundles.find((b) => b.versions.length >= 3)!;
  });
  afterAll(() => db.close());

  it('derives the quote server-side and validates offsets', async () => {
    const v = bill.versions[0]!;
    const start = v.text.indexOf('SECTION 1.');
    const a = await createAnnotation(db, { billId: bill.bill.billId, versionId: v.versionId, startOffset: start, endOffset: start + 10, note: ' check ', author: 'Tester' });
    expect(a.quote).toBe('SECTION 1.');
    expect(a.note).toBe('check');
    await expect(
      createAnnotation(db, { billId: bill.bill.billId, versionId: v.versionId, startOffset: 5, endOffset: 5, note: 'x', author: 'y' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createAnnotation(db, { billId: bill.bill.billId, versionId: v.versionId, startOffset: 0, endOffset: v.text.length + 10, note: 'x', author: 'y' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('re-anchors unchanged passages and flags edited/removed ones when viewing a newer version', async () => {
    const introduced = bill.versions[0]!;
    const latest = bill.versions.at(-1)!;
    // Title paragraph usually changes between versions; the enacting clause never does.
    const enacting = 'The people of the State of California do enact as follows:';
    const s = introduced.text.indexOf(enacting);
    expect(s).toBeGreaterThan(0);
    const kept = await createAnnotation(db, { billId: bill.bill.billId, versionId: introduced.versionId, startOffset: s, endOffset: s + enacting.length, note: 'enacting clause', author: 'A' });

    // A passage of the introduced text that does not survive verbatim in the latest version.
    const words = introduced.text.split(/(?<=\s)/);
    let offset = 0;
    let gone: { start: number; end: number } | null = null;
    for (let i = 0; i + 8 < words.length && !gone; i++) {
      const phrase = words.slice(i, i + 8).join('').trimEnd();
      if (phrase.length > 30 && !latest.text.includes(phrase)) gone = { start: offset, end: offset + phrase.length };
      offset += words[i]!.length;
    }
    expect(gone).not.toBeNull();
    const edited = await createAnnotation(db, { billId: bill.bill.billId, versionId: introduced.versionId, startOffset: gone!.start, endOffset: gone!.end, note: 'edited later', author: 'B' });

    const view = await listAnnotations(db, bill.bill.billId, latest.versionId);
    const keptView = view.find((a) => a.id === kept.id)!;
    expect(['exact', 'moved']).toContain(keptView.anchor.status);
    expect(latest.text.slice(keptView.anchor.start!, keptView.anchor.end!)).toBe(enacting);
    const editedView = view.find((a) => a.id === edited.id)!;
    expect(['changed', 'orphaned']).toContain(editedView.anchor.status);
    expect(editedView.viewVersionId).toBe(latest.versionId);

    // Viewed on its own version, every annotation is exact.
    const own = await listAnnotations(db, bill.bill.billId, introduced.versionId);
    expect(own.every((a) => a.versionId !== introduced.versionId || a.anchor.status === 'exact')).toBe(true);
  });
});
