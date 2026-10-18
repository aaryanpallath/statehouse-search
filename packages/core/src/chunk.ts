export interface Chunk {
  index: number;
  start: number;
  end: number;
  content: string;
}

export interface ChunkOptions {
  /** Words per chunk. all-MiniLM-L6-v2 truncates at 256 word-pieces, so ~120 words fits comfortably. */
  maxWords?: number;
  /** Words shared between consecutive chunks so phrases spanning a boundary stay searchable. */
  overlap?: number;
  /** Hard cap per document; very long budget bills are truncated (documented limitation). */
  maxChunks?: number;
}

/** Splits text into overlapping word windows, keeping exact character offsets into the source. */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxWords = opts.maxWords ?? 120;
  const overlap = Math.min(opts.overlap ?? 20, maxWords - 1);
  const maxChunks = opts.maxChunks ?? Number.POSITIVE_INFINITY;
  const words: { start: number; end: number }[] = [];
  for (const m of text.matchAll(/\S+/g)) words.push({ start: m.index, end: m.index + m[0].length });
  const chunks: Chunk[] = [];
  const step = maxWords - overlap;
  for (let w = 0; w < words.length && chunks.length < maxChunks; w += step) {
    const last = Math.min(w + maxWords, words.length) - 1;
    const start = words[w]!.start;
    const end = words[last]!.end;
    chunks.push({ index: chunks.length, start, end, content: text.slice(start, end) });
    if (last === words.length - 1) break;
  }
  return chunks;
}
