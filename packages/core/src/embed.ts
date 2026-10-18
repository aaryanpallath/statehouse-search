import { createHash } from 'node:crypto';

export const EMBEDDING_DIM = 384;
export const MINILM_MODEL = 'Xenova/all-MiniLM-L6-v2';

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Local sentence embeddings with all-MiniLM-L6-v2 via @xenova/transformers (ONNX runtime, CPU).
 * Weights are downloaded once from the Hugging Face hub into `cacheDir` (git-ignored).
 */
export async function createMiniLmEmbedder(cacheDir: string): Promise<Embedder> {
  const { pipeline, env } = await import('@xenova/transformers');
  env.cacheDir = cacheDir;
  env.allowLocalModels = false;
  const extractor = await pipeline('feature-extraction', MINILM_MODEL, { quantized: true });
  return {
    name: MINILM_MODEL,
    async embed(texts) {
      if (texts.length === 0) return [];
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      const data = output.data as Float32Array;
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i++) {
        vectors.push(Array.from(data.subarray(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM)));
      }
      return vectors;
    },
  };
}

/**
 * Deterministic feature-hashing embedder (bag of lowercase word stems hashed into 384 dims,
 * L2-normalised). Used ONLY by the offline test-suite so tests never download model weights.
 */
export function createHashingEmbedder(): Embedder & { calls: number } {
  const embedder = {
    name: 'hashing-test-embedder',
    calls: 0,
    async embed(texts: string[]) {
      embedder.calls += texts.length;
      return texts.map((text) => {
        const v = new Array<number>(EMBEDDING_DIM).fill(0);
        for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          const stem = word.slice(0, 6);
          const h = createHash('md5').update(stem).digest();
          const idx = h.readUInt16BE(0) % EMBEDDING_DIM;
          v[idx] = (v[idx] ?? 0) + ((h[2] ?? 0) & 1 ? 1 : -1);
        }
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
    },
  };
  return embedder;
}

export function toPgVector(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
}
