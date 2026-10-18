import { createMiniLmEmbedder, loadConfig, logger, migrate, openDb } from '@statehouse/core';
import { buildServer } from './server.ts';

const config = loadConfig();
const db = await openDb(config);
await migrate(db);
const embedder = config.semanticSearch ? await createMiniLmEmbedder(config.modelCacheDir) : undefined;
const { app } = buildServer({ db, embedder, semanticSearch: config.semanticSearch });

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: '0.0.0.0' });
logger.info({ port: config.port, db: db.kind, semanticSearch: config.semanticSearch }, 'api listening');
