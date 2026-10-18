import type { Db } from './db.ts';
import { toPgVector, type Embedder } from './embed.ts';
import type { SearchFilters, SearchParams, SearchResponse, SearchResult, SnippetPart } from './types.ts';
import { billLabel } from './pubinfo.ts';

/** Standard RRF constant from Cormack et al. (2009). */
export const RRF_K = 60;

export interface FusedItem {
  id: string;
  score: number;
  /** 1-based rank of the item in each input list, or null when absent from that list. */
  ranks: (number | null)[];
}

/**
 * Reciprocal rank fusion: score(d) = sum over lists of 1 / (k + rank_list(d)). Ties are broken by the
 * best individual rank, then by id, so the output order is deterministic.
 */
export function reciprocalRankFusion(lists: string[][], k = RRF_K): FusedItem[] {
  const items = new Map<string, FusedItem>();
  lists.forEach((list, li) => {
    const seen = new Set<string>();
    list.forEach((id, idx) => {
      if (seen.has(id)) return; // only the first occurrence of an id in a list counts
      seen.add(id);
      let item = items.get(id);
      if (!item) {
        item = { id, score: 0, ranks: lists.map(() => null) };
        items.set(id, item);
      }
      item.ranks[li] = idx + 1;
      item.score += 1 / (k + idx + 1);
    });
  });
  const bestRank = (it: FusedItem) => Math.min(...it.ranks.map((r) => r ?? Infinity));
  return [...items.values()].sort((a, b) => b.score - a.score || bestRank(a) - bestRank(b) || a.id.localeCompare(b.id));
}

/** Builds the WHERE fragment for the filters over `bills b`, appending bind values to `params`. */
export function filterSql(filters: SearchFilters, params: unknown[]): string {
  const clauses: string[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (filters.session) clauses.push(`b.session = ${bind(filters.session)}`);
  if (filters.status) clauses.push(`b.measure_state = ${bind(filters.status)}`);
  if (filters.subject) clauses.push(`b.subject ILIKE ${bind(`%${escapeLike(filters.subject)}%`)}`);
  if (filters.sponsor) {
    clauses.push(`EXISTS (SELECT 1 FROM sponsors s WHERE s.bill_id = b.bill_id AND s.name ILIKE ${bind(`%${escapeLike(filters.sponsor)}%`)})`);
  }
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// Control characters cannot occur in normalised bill text, so they are safe highlight markers.
const START = '\u0001';
const STOP = '\u0002';
const HEADLINE_OPTIONS = `StartSel=${START}, StopSel=${STOP}, MaxWords=40, MinWords=18, MaxFragments=2, FragmentDelimiter=" … "`;

export function parseHeadline(headline: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const piece of headline.split(START)) {
    const stop = piece.indexOf(STOP);
    if (stop >= 0) {
      if (stop > 0) parts.push({ text: piece.slice(0, stop), hit: true });
      if (stop + 1 < piece.length) parts.push({ text: piece.slice(stop + 1), hit: false });
    } else if (piece) parts.push({ text: piece, hit: false });
  }
  // Merge consecutive hits separated only by whitespace for nicer rendering.
  return parts.reduce<SnippetPart[]>((acc, p) => {
    const last = acc[acc.length - 1];
    if (last && last.hit === p.hit) last.text += p.text;
    else acc.push({ ...p });
    return acc;
  }, []);
}

interface RankedChunk {
  bill_id: string;
  chunk_index: number;
}

export interface SearchDeps {
  db: Db;
  /** Required when semantic search is enabled. */
  embedder?: Embedder;
  /** Feature flag (FEATURE_SEMANTIC_SEARCH): when false only full-text ranking is used. */
  semantic: boolean;
  /** How many bills each retriever contributes to fusion. */
  candidates?: number;
}

export async function ftsCandidates(db: Db, q: string, filters: SearchFilters, limit: number): Promise<RankedChunk[]> {
  const params: unknown[] = [q];
  const where = filterSql(filters, params);
  params.push(limit);
  const { rows } = await db.query<RankedChunk & { rank: number }>(
    `WITH q AS (SELECT websearch_to_tsquery('english', $1) AS tsq),
     best AS (
       SELECT DISTINCT ON (c.bill_id) c.bill_id, c.chunk_index, ts_rank(c.tsv, q.tsq) AS rank
       FROM chunks c JOIN bills b ON b.bill_id = c.bill_id, q
       WHERE c.tsv @@ q.tsq AND ${where}
       ORDER BY c.bill_id, rank DESC, c.chunk_index
     )
     SELECT bill_id, chunk_index, rank FROM best ORDER BY rank DESC, bill_id LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function vectorCandidates(db: Db, embedding: number[], filters: SearchFilters, limit: number): Promise<RankedChunk[]> {
  const params: unknown[] = [toPgVector(embedding)];
  const where = filterSql(filters, params);
  params.push(limit * 4);
  // Nearest chunks by cosine distance (HNSW index), then the best chunk per bill.
  const { rows } = await db.query<RankedChunk & { distance: number }>(
    `SELECT c.bill_id, c.chunk_index, c.embedding <=> $1::vector AS distance
     FROM chunks c JOIN bills b ON b.bill_id = c.bill_id
     WHERE c.embedding IS NOT NULL AND ${where}
     ORDER BY c.embedding <=> $1::vector
     LIMIT $${params.length}`,
    params,
  );
  const seen = new Set<string>();
  const best: RankedChunk[] = [];
  for (const r of rows) {
    if (seen.has(r.bill_id)) continue;
    seen.add(r.bill_id);
    best.push(r);
    if (best.length >= limit) break;
  }
  return best;
}

export async function hybridSearch(deps: SearchDeps, params: SearchParams): Promise<SearchResponse> {
  const started = performance.now();
  const q = params.q.trim();
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const candidates = deps.candidates ?? 50;
  const semantic = deps.semantic && !!deps.embedder && q.length > 0;
  const filters: SearchFilters = { session: params.session, status: params.status, sponsor: params.sponsor, subject: params.subject };

  let fused: FusedItem[];
  const snippetChunk = new Map<string, number>();
  if (!q) {
    // Filter-only browsing: no ranking signal, list matching bills in measure order.
    const p: unknown[] = [];
    const where = filterSql(filters, p);
    p.push(limit);
    const { rows } = await deps.db.query<{ bill_id: string }>(
      `SELECT b.bill_id FROM bills b WHERE ${where} ORDER BY b.measure_type, b.measure_num LIMIT $${p.length}`,
      p,
    );
    fused = rows.map((r) => ({ id: r.bill_id, score: 0, ranks: [null, null] }));
  } else {
    const [fts, vec] = await Promise.all([
      ftsCandidates(deps.db, q, filters, candidates),
      semantic
        ? deps.embedder!.embed([q]).then(([e]) => vectorCandidates(deps.db, e!, filters, candidates))
        : Promise.resolve([] as RankedChunk[]),
    ]);
    // Prefer the lexical best chunk for the snippet (it contains the query terms).
    for (const r of [...vec].reverse()) snippetChunk.set(r.bill_id, r.chunk_index);
    for (const r of [...fts].reverse()) snippetChunk.set(r.bill_id, r.chunk_index);
    fused = reciprocalRankFusion([fts.map((r) => r.bill_id), vec.map((r) => r.bill_id)]).slice(0, limit);
  }

  const results = await hydrate(deps.db, q, fused, snippetChunk);
  return { query: q, semantic, results, tookMs: Math.round((performance.now() - started) * 100) / 100 };
}

async function hydrate(db: Db, q: string, fused: FusedItem[], snippetChunk: Map<string, number>): Promise<SearchResult[]> {
  if (fused.length === 0) return [];
  const ids = fused.map((f) => f.id);
  const chunkIdx = ids.map((id) => snippetChunk.get(id) ?? 0);
  const { rows } = await db.query<{
    bill_id: string;
    measure_type: string;
    measure_num: number;
    title: string | null;
    subject: string | null;
    measure_state: string;
    session: string;
    sponsors: string[] | null;
    headline: string | null;
  }>(
    `WITH wanted AS (SELECT * FROM unnest($1::text[], $2::int[]) AS w(bill_id, chunk_index)),
     q AS (SELECT websearch_to_tsquery('english', $3) AS tsq)
     SELECT b.bill_id, b.measure_type, b.measure_num, b.title, b.subject, b.measure_state, b.session,
       (SELECT array_agg(DISTINCT s.name ORDER BY s.name) FROM sponsors s
         WHERE s.version_id = b.latest_version_id AND s.contribution = 'LEAD_AUTHOR') AS sponsors,
       (SELECT ts_headline('english', c.content, q.tsq, $4)
          FROM chunks c WHERE c.bill_id = b.bill_id AND c.chunk_index = w.chunk_index) AS headline
     FROM wanted w JOIN bills b ON b.bill_id = w.bill_id, q`,
    [ids, chunkIdx, q, HEADLINE_OPTIONS],
  );
  const byId = new Map(rows.map((r) => [r.bill_id, r]));
  return fused.flatMap((f) => {
    const r = byId.get(f.id);
    if (!r) return [];
    return [{
      billId: r.bill_id,
      label: billLabel(r.measure_type, r.measure_num),
      title: r.title,
      subject: r.subject,
      status: r.measure_state,
      session: r.session,
      sponsors: r.sponsors ?? [],
      score: Math.round(f.score * 1e6) / 1e6,
      ftsRank: f.ranks[0] ?? null,
      vectorRank: f.ranks[1] ?? null,
      snippet: r.headline ? parseHeadline(r.headline) : [],
    }];
  });
}

export async function facets(db: Db): Promise<{ sessions: string[]; statuses: { value: string; count: number }[] }> {
  const sessions = await db.query<{ session: string }>('SELECT DISTINCT session FROM bills ORDER BY session DESC');
  const statuses = await db.query<{ value: string; count: number }>(
    'SELECT measure_state AS value, count(*)::int AS count FROM bills GROUP BY measure_state ORDER BY count DESC, value',
  );
  return { sessions: sessions.rows.map((r) => r.session), statuses: statuses.rows };
}
