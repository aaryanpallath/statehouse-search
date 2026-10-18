import type { Annotation } from './types.ts';

/**
 * Transport-agnostic room/broadcast logic for live annotation sync. The API wires real `ws` sockets
 * into it; tests use in-memory fakes. Each browser tab subscribes to the bill it has open and receives
 * every annotation created or deleted on that bill (from any tab, including its own, so all tabs
 * converge on the same server-confirmed state).
 */
export interface HubSocket {
  send(data: string): void;
  /** 1 === OPEN in the WebSocket spec. */
  readonly readyState: number;
}

export type ClientMessage =
  | { type: 'subscribe'; billId: string }
  | { type: 'unsubscribe'; billId: string }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'subscribed'; billId: string; peers: number }
  | { type: 'presence'; billId: string; peers: number }
  | { type: 'annotation.created'; billId: string; annotation: Annotation }
  | { type: 'annotation.deleted'; billId: string; id: string; versionId: string }
  | { type: 'pong' }
  | { type: 'error'; message: string };

const OPEN = 1;
const MAX_ROOMS_PER_SOCKET = 20;

export function parseClientMessage(raw: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (m.type === 'ping') return { type: 'ping' };
  if ((m.type === 'subscribe' || m.type === 'unsubscribe') && typeof m.billId === 'string' && /^[\w-]{1,64}$/.test(m.billId)) {
    return { type: m.type, billId: m.billId };
  }
  return null;
}

export class AnnotationHub {
  private rooms = new Map<string, Set<HubSocket>>();
  private memberships = new Map<HubSocket, Set<string>>();

  peers(billId: string): number {
    return this.rooms.get(billId)?.size ?? 0;
  }

  subscribe(socket: HubSocket, billId: string): void {
    const mine = this.memberships.get(socket) ?? new Set<string>();
    if (!mine.has(billId) && mine.size >= MAX_ROOMS_PER_SOCKET) {
      this.sendTo(socket, { type: 'error', message: 'too many subscriptions' });
      return;
    }
    mine.add(billId);
    this.memberships.set(socket, mine);
    const room = this.rooms.get(billId) ?? new Set<HubSocket>();
    room.add(socket);
    this.rooms.set(billId, room);
    this.sendTo(socket, { type: 'subscribed', billId, peers: room.size });
    this.broadcast(billId, { type: 'presence', billId, peers: room.size }, socket);
  }

  unsubscribe(socket: HubSocket, billId: string): void {
    this.memberships.get(socket)?.delete(billId);
    const room = this.rooms.get(billId);
    if (!room?.delete(socket)) return;
    if (room.size === 0) this.rooms.delete(billId);
    else this.broadcast(billId, { type: 'presence', billId, peers: room.size });
  }

  /** Call when a socket closes. */
  remove(socket: HubSocket): void {
    for (const billId of [...(this.memberships.get(socket) ?? [])]) this.unsubscribe(socket, billId);
    this.memberships.delete(socket);
  }

  handleMessage(socket: HubSocket, raw: string): void {
    const msg = parseClientMessage(raw);
    if (!msg) return this.sendTo(socket, { type: 'error', message: 'invalid message' });
    if (msg.type === 'ping') return this.sendTo(socket, { type: 'pong' });
    if (msg.type === 'subscribe') return this.subscribe(socket, msg.billId);
    this.unsubscribe(socket, msg.billId);
  }

  /** Sends a message to every open socket subscribed to the bill; returns the number delivered. */
  broadcast(billId: string, message: ServerMessage, except?: HubSocket): number {
    const room = this.rooms.get(billId);
    if (!room) return 0;
    const data = JSON.stringify(message);
    let delivered = 0;
    for (const socket of room) {
      if (socket === except || socket.readyState !== OPEN) continue;
      socket.send(data);
      delivered++;
    }
    return delivered;
  }

  annotationCreated(annotation: Annotation): number {
    return this.broadcast(annotation.billId, { type: 'annotation.created', billId: annotation.billId, annotation });
  }

  annotationDeleted(annotation: Annotation): number {
    return this.broadcast(annotation.billId, {
      type: 'annotation.deleted',
      billId: annotation.billId,
      id: annotation.id,
      versionId: annotation.versionId,
    });
  }

  private sendTo(socket: HubSocket, message: ServerMessage): void {
    if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
  }
}
