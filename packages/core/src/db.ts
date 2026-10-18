import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import pg from 'pg';
import { EMBEDDING_DIM } from './embed.ts';

/**
 * Minimal database interface implemented by both node-postgres (real Postgres + pgvector, e.g. in
 * docker-compose) and PGlite (Postgres compiled to WASM with the pgvector extension, used for tests and
 * for running locally without Docker). All SQL in the project is plain Postgres SQL.
 */
export interface Db {
  readonly kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

function wrapPglite(conn: PgliteLike, root: PGlite): Db {
  return {
    kind: 'pglite',
    query: (sql, params) => conn.query(sql, params),
    exec: async (sql) => {
      await conn.exec(sql);
    },
    transaction: (fn) => root.transaction((tx) => fn(wrapPglite(tx, root))),
    close: () => root.close(),
  };
}

/** Opens an embedded PGlite database. Pass `undefined` for an in-memory database (tests). */
export async function openPglite(dataDir?: string): Promise<Db> {
  const db = await PGlite.create({ dataDir, extensions: { vector } });
  return wrapPglite(db, db);
}

function wrapPgClient(client: pg.PoolClient): Db {
  return {
    kind: 'postgres',
    query: async (sql, params) => ({ rows: (await client.query(sql, params)).rows }),
    exec: async (sql) => {
      await client.query(sql);
    },
    transaction: (fn) => fn(wrapPgClient(client)),
    close: async () => client.release(),
  };
}

export function openPostgres(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    kind: 'postgres',
    query: async (sql, params) => ({ rows: (await pool.query(sql, params)).rows }),
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrapPgClient(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function openDb(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<Db> {
  return opts.databaseUrl ? openPostgres(opts.databaseUrl) : openPglite(opts.pgliteDir);
}

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS bills (
  bill_id            text PRIMARY KEY,
  session            text NOT NULL,
  measure_type       text NOT NULL,
  measure_num        integer NOT NULL,
  measure_state      text NOT NULL,
  current_status     text,
  current_location   text,
  latest_version_id  text,
  title              text,
  subject            text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bills_session_idx ON bills (session);
CREATE INDEX IF NOT EXISTS bills_state_idx ON bills (measure_state);

CREATE TABLE IF NOT EXISTS bill_versions (
  version_id    text PRIMARY KEY,
  bill_id       text NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  version_num   integer NOT NULL,
  action_date   date,
  action        text NOT NULL,
  subject       text,
  title         text,
  digest        text,
  text          text NOT NULL,
  content_hash  text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bill_versions_bill_idx ON bill_versions (bill_id);

CREATE TABLE IF NOT EXISTS sponsors (
  version_id    text NOT NULL REFERENCES bill_versions(version_id) ON DELETE CASCADE,
  bill_id       text NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  name          text NOT NULL,
  house         text NOT NULL DEFAULT '',
  contribution  text NOT NULL DEFAULT '',
  author_type   text,
  is_primary    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (version_id, name, house, contribution)
);
CREATE INDEX IF NOT EXISTS sponsors_bill_idx ON sponsors (bill_id);

CREATE TABLE IF NOT EXISTS actions (
  action_id     text PRIMARY KEY,
  bill_id       text NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  action_date   date,
  action        text NOT NULL,
  sequence      integer,
  status        text
);
CREATE INDEX IF NOT EXISTS actions_bill_idx ON actions (bill_id);

CREATE TABLE IF NOT EXISTS chunks (
  version_id    text NOT NULL REFERENCES bill_versions(version_id) ON DELETE CASCADE,
  chunk_index   integer NOT NULL,
  bill_id       text NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  start_offset  integer NOT NULL,
  end_offset    integer NOT NULL,
  content       text NOT NULL,
  content_hash  text NOT NULL,
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding     vector(${EMBEDDING_DIM}),
  PRIMARY KEY (version_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS chunks_bill_idx ON chunks (bill_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS annotations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id       text NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
  version_id    text NOT NULL REFERENCES bill_versions(version_id) ON DELETE CASCADE,
  start_offset  integer NOT NULL CHECK (start_offset >= 0),
  end_offset    integer NOT NULL CHECK (end_offset > start_offset),
  quote         text NOT NULL,
  prefix        text NOT NULL DEFAULT '',
  suffix        text NOT NULL DEFAULT '',
  note          text NOT NULL,
  author        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotations_bill_idx ON annotations (bill_id);
`;

export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
}
