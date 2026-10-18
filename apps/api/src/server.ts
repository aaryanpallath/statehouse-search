import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  AnnotationHub,
  NotFoundError,
  ValidationError,
  activityByMonth,
  createAnnotation,
  deleteAnnotation,
  diffStats,
  diffWords,
  facets,
  getBill,
  getVersion,
  hybridSearch,
  listAnnotations,
  logger as rootLogger,
  toSideBySide,
  type Db,
  type Embedder,
  type Logger,
} from '@statehouse/core';

export interface ServerDeps {
  db: Db;
  embedder?: Embedder;
  /** FEATURE_SEMANTIC_SEARCH flag. */
  semanticSearch: boolean;
  logger?: Logger;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function buildServer(deps: ServerDeps): { app: FastifyInstance; hub: AnnotationHub; wss: WebSocketServer } {
  const log = deps.logger ?? rootLogger;
  const app: FastifyInstance = Fastify({ loggerInstance: log as FastifyBaseLogger });
  const hub = new AnnotationHub();

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'internal error' });
  });

  app.get('/health', async () => ({ ok: true, semanticSearch: deps.semanticSearch, db: deps.db.kind }));

  app.get('/api/search', async (req) => {
    const q = req.query as Record<string, unknown>;
    const limit = Number(q.limit ?? 20);
    const response = await hybridSearch(
      { db: deps.db, embedder: deps.embedder, semantic: deps.semanticSearch },
      {
        q: str(q.q) ?? '',
        limit: Number.isFinite(limit) ? limit : 20,
        session: str(q.session),
        status: str(q.status),
        sponsor: str(q.sponsor),
        subject: str(q.subject),
      },
    );
    req.log.info({ event: 'search', q: response.query, results: response.results.length, tookMs: response.tookMs, semantic: response.semantic });
    return response;
  });

  app.get('/api/facets', async () => facets(deps.db));

  app.get('/api/activity', async (req) => activityByMonth(deps.db, str((req.query as Record<string, unknown>).billId)));

  app.get('/api/bills/:billId', async (req) => getBill(deps.db, (req.params as { billId: string }).billId));

  app.get('/api/bills/:billId/versions/:versionId', async (req) => {
    const p = req.params as { billId: string; versionId: string };
    return getVersion(deps.db, p.billId, p.versionId);
  });

  app.get('/api/bills/:billId/diff', async (req) => {
    const { billId } = req.params as { billId: string };
    const q = req.query as Record<string, unknown>;
    const from = str(q.from);
    const to = str(q.to);
    if (!from || !to) throw new ValidationError('from and to version ids are required');
    const [a, b] = await Promise.all([getVersion(deps.db, billId, from), getVersion(deps.db, billId, to)]);
    const segments = diffWords(a.text, b.text);
    return { billId, from, to, stats: diffStats(segments), segments, rows: toSideBySide(segments) };
  });

  app.get('/api/bills/:billId/annotations', async (req) => {
    const { billId } = req.params as { billId: string };
    const versionId = str((req.query as Record<string, unknown>).versionId);
    if (!versionId) throw new ValidationError('versionId is required');
    return listAnnotations(deps.db, billId, versionId);
  });

  app.post('/api/bills/:billId/annotations', async (req, reply) => {
    const { billId } = req.params as { billId: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const annotation = await createAnnotation(deps.db, {
      billId,
      versionId: String(body.versionId ?? ''),
      startOffset: Number(body.startOffset),
      endOffset: Number(body.endOffset),
      note: String(body.note ?? ''),
      author: String(body.author ?? ''),
    });
    const delivered = hub.annotationCreated(annotation);
    req.log.info({ event: 'annotation.created', billId, id: annotation.id, delivered });
    return reply.code(201).send(annotation);
  });

  app.delete('/api/annotations/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError(`annotation ${id} not found`);
    const annotation = await deleteAnnotation(deps.db, id);
    const delivered = hub.annotationDeleted(annotation);
    req.log.info({ event: 'annotation.deleted', billId: annotation.billId, id, delivered });
    return { ok: true, id };
  });

  // WebSocket endpoint for live annotation sync, sharing the HTTP server.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  app.server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws: WebSocket) => {
    log.info({ event: 'ws.connected', clients: wss.clients.size });
    ws.on('message', (data) => hub.handleMessage(ws, data.toString()));
    ws.on('close', () => {
      hub.remove(ws);
      log.info({ event: 'ws.closed', clients: wss.clients.size });
    });
    ws.on('error', (err) => log.warn({ err }, 'ws error'));
  });
  app.addHook('onClose', async () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  });

  return { app, hub, wss };
}
