import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import { chunkText, type ChunkOptions } from './chunk.ts';
import { toPgVector, type Embedder } from './embed.ts';
import type { BillBundle, VersionRecord } from './types.ts';

export interface IngestStats {
  bills: number;
  versionsInserted: number;
  versionsUpdated: number;
  versionsUnchanged: number;
  chunksEmbedded: number;
  chunksReused: number;
  actions: number;
  sponsors: number;
}

export const emptyStats = (): IngestStats => ({
  bills: 0,
  versionsInserted: 0,
  versionsUpdated: 0,
  versionsUnchanged: 0,
  chunksEmbedded: 0,
  chunksReused: 0,
  actions: 0,
  sponsors: 0,
});

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

function versionHash(v: VersionRecord): string {
  return sha256(JSON.stringify([v.versionNum, v.actionDate, v.action, v.subject, v.title, v.digest, v.text]));
}

/**
 * California numbers versions downwards (99 = introduced, 98 = first amendment, ...), so ascending
 * chronological order is descending version_num. Action date is the tie-breaker.
 */
export function sortVersionsChronologically<T extends { versionNum: number; actionDate: string | null }>(versions: T[]): T[] {
  return [...versions].sort((a, b) => b.versionNum - a.versionNum || (a.actionDate ?? '').localeCompare(b.actionDate ?? ''));
}

/** The version whose text is indexed for search: the bill's declared latest version, else the newest one. */
export function searchVersionOf(bundle: BillBundle): VersionRecord | undefined {
  const declared = bundle.versions.find((v) => v.versionId === bundle.bill.latestVersionId);
  return declared ?? sortVersionsChronologically(bundle.versions).at(-1);
}

export interface IngestOptions {
  chunk?: ChunkOptions;
  embedBatchSize?: number;
}

/**
 * Upserts one bill with all of its versions, sponsors, actions and search chunks.
 *
 * Idempotency: rows are keyed on bill_id / version_id (and action_id); a version whose content hash is
 * unchanged is not rewritten, and chunk embeddings are reused whenever a chunk with the same content
 * hash already exists for the bill, so re-running ingestion over the same data embeds nothing.
 */
export async function ingestBundle(db: Db, bundle: BillBundle, embedder: Embedder, opts: IngestOptions = {}): Promise<IngestStats> {
  const stats = emptyStats();
  const { bill } = bundle;
  const searchVersion = searchVersionOf(bundle);
  const latestTitle = searchVersion?.title ?? null;
  const latestSubject = searchVersion?.subject ?? null;

  // Work out which chunks need fresh embeddings before opening the write transaction.
  const chunks = searchVersion ? chunkText(searchVersion.text, opts.chunk ?? { maxChunks: 60 }) : [];
  const existing = await db.query<{ content_hash: string; embedding: string | null }>(
    'SELECT content_hash, embedding::text AS embedding FROM chunks WHERE bill_id = $1',
    [bill.billId],
  );
  const known = new Map(existing.rows.filter((r) => r.embedding).map((r) => [r.content_hash, r.embedding!]));
  const chunkRows = chunks.map((c) => ({ ...c, hash: sha256(c.content), embedding: undefined as string | undefined }));
  const toEmbed = chunkRows.filter((c) => {
    c.embedding = known.get(c.hash);
    return c.embedding === undefined;
  });
  const batch = opts.embedBatchSize ?? 16;
  for (let i = 0; i < toEmbed.length; i += batch) {
    const slice = toEmbed.slice(i, i + batch);
    const vectors = await embedder.embed(slice.map((c) => c.content));
    slice.forEach((c, j) => (c.embedding = toPgVector(vectors[j]!)));
  }
  stats.chunksEmbedded = toEmbed.length;
  stats.chunksReused = chunkRows.length - toEmbed.length;

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO bills (bill_id, session, measure_type, measure_num, measure_state, current_status,
                          current_location, latest_version_id, title, subject, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (bill_id) DO UPDATE SET
         session = EXCLUDED.session, measure_type = EXCLUDED.measure_type, measure_num = EXCLUDED.measure_num,
         measure_state = EXCLUDED.measure_state, current_status = EXCLUDED.current_status,
         current_location = EXCLUDED.current_location, latest_version_id = EXCLUDED.latest_version_id,
         title = EXCLUDED.title, subject = EXCLUDED.subject, updated_at = now()
       WHERE (bills.measure_state, bills.current_status, bills.current_location, bills.latest_version_id, bills.title, bills.subject)
             IS DISTINCT FROM
             (EXCLUDED.measure_state, EXCLUDED.current_status, EXCLUDED.current_location, EXCLUDED.latest_version_id, EXCLUDED.title, EXCLUDED.subject)`,
      [bill.billId, bill.session, bill.measureType, bill.measureNum, bill.measureState, bill.currentStatus,
       bill.currentLocation, searchVersion?.versionId ?? bill.latestVersionId, latestTitle, latestSubject],
    );
    stats.bills = 1;

    const current = await tx.query<{ version_id: string; content_hash: string }>(
      'SELECT version_id, content_hash FROM bill_versions WHERE bill_id = $1',
      [bill.billId],
    );
    const currentHashes = new Map(current.rows.map((r) => [r.version_id, r.content_hash]));
    for (const v of bundle.versions) {
      const hash = versionHash(v);
      const prev = currentHashes.get(v.versionId);
      if (prev === hash) {
        stats.versionsUnchanged++;
        continue;
      }
      await tx.query(
        `INSERT INTO bill_versions (version_id, bill_id, version_num, action_date, action, subject, title, digest, text, content_hash, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (version_id) DO UPDATE SET
           version_num = EXCLUDED.version_num, action_date = EXCLUDED.action_date, action = EXCLUDED.action,
           subject = EXCLUDED.subject, title = EXCLUDED.title, digest = EXCLUDED.digest, text = EXCLUDED.text,
           content_hash = EXCLUDED.content_hash, updated_at = now()`,
        [v.versionId, bill.billId, v.versionNum, v.actionDate, v.action, v.subject, v.title, v.digest, v.text, hash],
      );
      if (prev === undefined) stats.versionsInserted++;
      else stats.versionsUpdated++;
    }

    // Sponsors are a pure function of the source rows: replace them wholesale per bill.
    await tx.query('DELETE FROM sponsors WHERE bill_id = $1', [bill.billId]);
    const versionIds = new Set(bundle.versions.map((v) => v.versionId));
    for (const s of bundle.sponsors) {
      if (!versionIds.has(s.versionId)) continue;
      await tx.query(
        `INSERT INTO sponsors (version_id, bill_id, name, house, contribution, author_type, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [s.versionId, bill.billId, s.name, s.house ?? '', s.contribution ?? '', s.authorType, s.isPrimary],
      );
      stats.sponsors++;
    }

    for (const a of bundle.actions) {
      await tx.query(
        `INSERT INTO actions (action_id, bill_id, action_date, action, sequence, status) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (action_id) DO UPDATE SET action_date = EXCLUDED.action_date, action = EXCLUDED.action,
           sequence = EXCLUDED.sequence, status = EXCLUDED.status`,
        [a.actionId, bill.billId, a.actionDate, a.action, a.sequence, a.status],
      );
      stats.actions++;
    }

    // Chunks: only the search version is indexed. Skip the rewrite entirely when nothing changed.
    const indexed = await tx.query<{ version_id: string; chunk_index: number; content_hash: string }>(
      'SELECT version_id, chunk_index, content_hash FROM chunks WHERE bill_id = $1 ORDER BY chunk_index',
      [bill.billId],
    );
    const unchanged =
      indexed.rows.length === chunkRows.length &&
      indexed.rows.every((r, i) => r.version_id === searchVersion?.versionId && r.content_hash === chunkRows[i]!.hash);
    if (!unchanged) {
      await tx.query('DELETE FROM chunks WHERE bill_id = $1', [bill.billId]);
      for (const c of chunkRows) {
        await tx.query(
          `INSERT INTO chunks (version_id, chunk_index, bill_id, start_offset, end_offset, content, content_hash, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)`,
          [searchVersion!.versionId, c.index, bill.billId, c.start, c.end, c.content, c.hash, c.embedding],
        );
      }
    }
  });
  return stats;
}

export async function ingestBundles(
  db: Db,
  bundles: BillBundle[],
  embedder: Embedder,
  opts: IngestOptions & { onProgress?: (done: number, total: number, stats: IngestStats) => void } = {},
): Promise<IngestStats> {
  const total = emptyStats();
  for (const [i, bundle] of bundles.entries()) {
    const s = await ingestBundle(db, bundle, embedder, opts);
    for (const k of Object.keys(total) as (keyof IngestStats)[]) total[k] += s[k];
    opts.onProgress?.(i + 1, bundles.length, total);
  }
  return total;
}

export async function corpusSize(db: Db): Promise<{ bills: number; versions: number; chunks: number; billsWith3PlusVersions: number }> {
  const { rows } = await db.query<{ bills: number; versions: number; chunks: number; multi: number }>(
    `SELECT (SELECT count(*)::int FROM bills) AS bills,
            (SELECT count(*)::int FROM bill_versions) AS versions,
            (SELECT count(*)::int FROM chunks) AS chunks,
            (SELECT count(*)::int FROM (SELECT bill_id FROM bill_versions GROUP BY bill_id HAVING count(*) >= 3) m) AS multi`,
  );
  const r = rows[0]!;
  return { bills: r.bills, versions: r.versions, chunks: r.chunks, billsWith3PlusVersions: r.multi };
}
