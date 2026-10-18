import { describe, expect, it } from 'vitest';
import { AnnotationHub, parseClientMessage, type HubSocket, type ServerMessage } from '../src/hub.ts';
import type { Annotation } from '../src/types.ts';

class FakeSocket implements HubSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

const annotation = (billId: string): Annotation => ({
  id: '00000000-0000-0000-0000-000000000001', billId, versionId: 'v1', startOffset: 0, endOffset: 4, quote: 'text',
  prefix: '', suffix: '', note: 'n', author: 'a', createdAt: '2026-01-01T00:00:00.000Z',
});

describe('AnnotationHub', () => {
  it('broadcasts annotation events only to sockets subscribed to that bill', () => {
    const hub = new AnnotationHub();
    const [a, b, c] = [new FakeSocket(), new FakeSocket(), new FakeSocket()];
    hub.handleMessage(a, JSON.stringify({ type: 'subscribe', billId: 'AB1' }));
    hub.handleMessage(b, JSON.stringify({ type: 'subscribe', billId: 'AB1' }));
    hub.handleMessage(c, JSON.stringify({ type: 'subscribe', billId: 'SB2' }));
    expect(hub.annotationCreated(annotation('AB1'))).toBe(2);
    expect(a.last()).toMatchObject({ type: 'annotation.created', billId: 'AB1' });
    expect(b.last()).toMatchObject({ type: 'annotation.created', billId: 'AB1' });
    expect(c.sent.some((m) => m.type === 'annotation.created')).toBe(false);
  });

  it('tracks presence and announces joins and leaves to peers', () => {
    const hub = new AnnotationHub();
    const [a, b] = [new FakeSocket(), new FakeSocket()];
    hub.subscribe(a, 'AB1');
    expect(a.last()).toEqual({ type: 'subscribed', billId: 'AB1', peers: 1 });
    hub.subscribe(b, 'AB1');
    expect(a.last()).toEqual({ type: 'presence', billId: 'AB1', peers: 2 });
    expect(hub.peers('AB1')).toBe(2);
    hub.remove(b);
    expect(a.last()).toEqual({ type: 'presence', billId: 'AB1', peers: 1 });
    hub.remove(a);
    expect(hub.peers('AB1')).toBe(0);
    expect(hub.annotationCreated(annotation('AB1'))).toBe(0);
  });

  it('skips sockets that are not open and stops delivering after unsubscribe', () => {
    const hub = new AnnotationHub();
    const [a, b] = [new FakeSocket(), new FakeSocket()];
    hub.subscribe(a, 'AB1');
    hub.subscribe(b, 'AB1');
    b.readyState = 3; // CLOSED
    expect(hub.annotationDeleted(annotation('AB1'))).toBe(1);
    hub.handleMessage(a, JSON.stringify({ type: 'unsubscribe', billId: 'AB1' }));
    expect(hub.annotationCreated(annotation('AB1'))).toBe(0);
  });

  it('answers pings and rejects malformed messages', () => {
    const hub = new AnnotationHub();
    const a = new FakeSocket();
    hub.handleMessage(a, '{"type":"ping"}');
    expect(a.last()).toEqual({ type: 'pong' });
    hub.handleMessage(a, 'not json');
    expect(a.last()).toEqual({ type: 'error', message: 'invalid message' });
    expect(parseClientMessage(JSON.stringify({ type: 'subscribe', billId: 'bad id; drop' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'subscribe' }))).toBeNull();
  });

  it('limits the number of rooms per socket', () => {
    const hub = new AnnotationHub();
    const a = new FakeSocket();
    for (let i = 0; i < 21; i++) hub.subscribe(a, `B${i}`);
    expect(a.last()).toEqual({ type: 'error', message: 'too many subscriptions' });
    expect(hub.peers('B20')).toBe(0);
  });
});
