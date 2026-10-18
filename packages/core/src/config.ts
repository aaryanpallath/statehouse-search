/** Runtime configuration and feature flags, read from environment variables. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Walks up from the cwd to the npm-workspaces root so relative data paths work from any workspace. */
export function repoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && 'workspaces' in JSON.parse(readFileSync(pkg, 'utf8'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function flag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export interface AppConfig {
  /** Postgres connection string. When unset, an embedded PGlite database is used. */
  databaseUrl: string | undefined;
  /** Directory for the embedded PGlite database. */
  pgliteDir: string;
  /** Feature flag: when false the vector (semantic) half of hybrid search is skipped. */
  semanticSearch: boolean;
  port: number;
  modelCacheDir: string;
}

export function loadConfig(): AppConfig {
  const root = repoRoot();
  return {
    databaseUrl: process.env.DATABASE_URL || undefined,
    pgliteDir: resolve(root, process.env.PGLITE_DIR ?? 'data/pglite'),
    semanticSearch: flag('FEATURE_SEMANTIC_SEARCH', true),
    port: Number(process.env.PORT ?? 4000),
    modelCacheDir: resolve(root, process.env.MODEL_CACHE_DIR ?? '.cache/models'),
  };
}
