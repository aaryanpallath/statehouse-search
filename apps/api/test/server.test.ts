import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { ingestBundles, logger, type BillBundle, type Db } from '@statehouse/core';
import { buildServer } from '../src/server.ts';
import { createHashingEmbedder, fixtureBundles, freshDb } from './helpers.ts';

/** Opens a ws client and collects every JSON message it receives. */
function client(url: string) {
  const ws = new WebSocket(url);
  const messages: Record<string, unknown>[] = [];
  const waiters: { pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    messages.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(msg);
    }
  });
  const next = (pred: (m: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const found = messages.find(pred);
      if (found) return resolve(found);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error('timed out waiting for ws message')), 5000);
    });
  const opened = new Promise<void>((resolve) => ws.once('open', () => resolve()));
  return { ws, messages, next, opened };
}

describe('HTTP API + WebSocket live sync', () => {
  let db: Db;
  let bill: BillBundle;
  let server: ReturnType<typeof buildServer>;
  let base: string;
  beforeAll(async () => {
    db = await freshDb();
    const bundles = await fixtureBundles();
    await ingestBundles(db, bundles, createHashingEmbedder());
    bill = bundles.find((b) => b.versions.length >= 3)!;
    server = buildServer({ db, embedder: createHashingEmbedder(), semanticSearch: true, logger: logger.child({}, { level: 'silent' }) });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await server.app.close();
    await db.close();
  });

  it('GET /api/search returns ranked bills with snippets', async () => {
    const word = (bill.versions.at(-1)!.title ?? '').match(/[A-Za-z]{8,}/)![0];
    const res = await server.app.inject({ url: `/api/search?q=${encodeURIComponent(word)}&limit=5` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.semantic).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toHaveProperty('snippet');
  });

  it('GET /api/bills/:id and /diff return versions and a word diff', async () => {
    const detail = (await server.app.inject({ url: `/api/bills/${bill.bill.billId}` })).json();
    expect(detail.versions.length).toBe(bill.versions.length);
    expect(detail.actions.length).toBeGreaterThan(0);
    const from = bill.versions[0]!.versionId;
    const to = bill.versions.at(-1)!.versionId;
    const diff = (await server.app.inject({ url: `/api/bills/${bill.bill.billId}/diff?from=${from}&to=${to}` })).json();
    expect(diff.stats.insertedWords + diff.stats.deletedWords).toBeGreaterThan(0);
    const rebuilt = diff.segments.filter((s: { op: string }) => s.op !== 'delete').map((s: { text: string }) => s.text).join('');
    expect(rebuilt).toBe(bill.versions.at(-1)!.text);
    expect((await server.app.inject({ url: `/api/bills/nope` })).statusCode).toBe(404);
    expect((await server.app.inject({ url: `/api/bills/${bill.bill.billId}/diff?from=${from}` })).statusCode).toBe(400);
  });

  it('broadcasts a created annotation to every tab viewing the bill, but not to other bills', async () => {
    const tab1 = client(`ws://${base}/ws`);
    const tab2 = client(`ws://${base}/ws`);
    const other = client(`ws://${base}/ws`);
    await Promise.all([tab1.opened, tab2.opened, other.opened]);
    tab1.ws.send(JSON.stringify({ type: 'subscribe', billId: bill.bill.billId }));
    await tab1.next((m) => m.type === 'subscribed');
    tab2.ws.send(JSON.stringify({ type: 'subscribe', billId: bill.bill.billId }));
    expect(await tab2.next((m) => m.type === 'subscribed')).toMatchObject({ peers: 2 });
    other.ws.send(JSON.stringify({ type: 'subscribe', billId: 'some-other-bill' }));
    await other.next((m) => m.type === 'subscribed');

    const v = bill.versions.at(-1)!;
    const res = await server.app.inject({
      method: 'POST',
      url: `/api/bills/${bill.bill.billId}/annotations`,
      payload: { versionId: v.versionId, startOffset: 0, endOffset: 12, note: 'live note', author: 'Tab 1' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    const [m1, m2] = await Promise.all([
      tab1.next((m) => m.type === 'annotation.created'),
      tab2.next((m) => m.type === 'annotation.created'),
    ]);
    expect((m1.annotation as { id: string }).id).toBe(created.id);
    expect((m2.annotation as { note: string }).note).toBe('live note');

    const list = (await server.app.inject({ url: `/api/bills/${bill.bill.billId}/annotations?versionId=${v.versionId}` })).json();
    expect(list.map((a: { id: string }) => a.id)).toContain(created.id);

    const del = await server.app.inject({ method: 'DELETE', url: `/api/annotations/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect(await tab2.next((m) => m.type === 'annotation.deleted')).toMatchObject({ id: created.id });
    expect(other.messages.some((m) => String(m.type).startsWith('annotation.'))).toBe(false);

    const bad = await server.app.inject({ method: 'POST', url: `/api/bills/${bill.bill.billId}/annotations`, payload: { versionId: v.versionId, startOffset: 3, endOffset: 1, note: 'x', author: 'y' } });
    expect(bad.statusCode).toBe(400);
    for (const c of [tab1, tab2, other]) c.ws.close();
  });
});
