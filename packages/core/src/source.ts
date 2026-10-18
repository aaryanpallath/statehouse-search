import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBillXml } from './billXml.ts';
import { parseDat, toActionRecords, toBillRecords, toSponsorRecords, toVersionRows, type VersionRow } from './pubinfo.ts';
import { sortVersionsChronologically } from './ingest.ts';
import type { ActionRecord, BillBundle, BillRecord, SponsorRecord } from './types.ts';
import { httpRangeFetcher, parseCentralDirectory, readCentralDirectory, readEntry, type ZipEntry } from './zipRange.ts';

export const TABLES = ['BILL_TBL.dat', 'BILL_VERSION_TBL.dat', 'BILL_VERSION_AUTHORS_TBL.dat', 'BILL_HISTORY_TBL.dat'] as const;
export type TableName = (typeof TABLES)[number];

/** Somewhere the pubinfo table dumps and bill-text LOB files can be read from. */
export interface PubinfoSource {
  readTable(name: TableName): Promise<string>;
  readLob(name: string): Promise<string>;
}

/** Reads from a directory laid out like the extracted archive (used for the recorded test fixtures). */
export function directorySource(dir: string): PubinfoSource {
  return {
    readTable: async (name) => readFileSync(join(dir, name), 'utf8'),
    readLob: async (name) => readFileSync(join(dir, 'lob', name), 'utf8'),
  };
}

/**
 * Reads members straight out of the remote pubinfo ZIP with HTTP range requests, caching every member
 * on disk so re-runs are offline and cheap.
 */
export async function remoteZipSource(url: string, cacheDir: string, log: (msg: string) => void = () => {}): Promise<PubinfoSource> {
  mkdirSync(join(cacheDir, 'lob'), { recursive: true });
  const fetcher = httpRangeFetcher(url);
  // Memoised promise so concurrent readers share one central-directory fetch; the directory itself
  // (~20 MB for a full session) is cached on disk too.
  let index: Promise<Map<string, ZipEntry>> | undefined;
  const loadIndex = async () => {
    const cdPath = join(cacheDir, 'central-directory.bin');
    let cd: Buffer;
    if (existsSync(cdPath)) cd = readFileSync(cdPath);
    else {
      log(`reading central directory of ${url}`);
      cd = await readCentralDirectory(fetcher, await fetcher.size());
      writeFileSync(cdPath, cd);
    }
    return new Map(parseCentralDirectory(cd).map((e) => [e.name, e]));
  };
  const entry = async (name: string): Promise<ZipEntry> => {
    index ??= loadIndex();
    const e = (await index).get(name);
    if (!e) throw new Error(`${name} not found in ${url}`);
    return e;
  };
  const cached = async (path: string, name: string): Promise<string> => {
    if (existsSync(path)) return readFileSync(path, 'utf8');
    const buf = await readEntry(fetcher, await entry(name));
    writeFileSync(path, buf);
    return buf.toString('utf8');
  };
  return {
    readTable: (name) => cached(join(cacheDir, name), name),
    readLob: (name) => cached(join(cacheDir, 'lob', name), name),
  };
}

export interface PubinfoTables {
  bills: BillRecord[];
  versions: VersionRow[];
  sponsors: SponsorRecord[];
  actions: ActionRecord[];
}

export async function loadTables(source: PubinfoSource): Promise<PubinfoTables> {
  return {
    bills: toBillRecords(parseDat(await source.readTable('BILL_TBL.dat'))),
    versions: toVersionRows(parseDat(await source.readTable('BILL_VERSION_TBL.dat'))).filter((v) => v.active && v.lobFile),
    sponsors: toSponsorRecords(parseDat(await source.readTable('BILL_VERSION_AUTHORS_TBL.dat'))),
    actions: toActionRecords(parseDat(await source.readTable('BILL_HISTORY_TBL.dat'))),
  };
}

export interface SelectOptions {
  /** Total number of bills to select. */
  limit: number;
  /** How many of them must have 3+ versions (introduced plus at least two amendments). */
  minMultiVersion: number;
  measureTypes?: string[];
}

/**
 * Deterministic selection: bills of the requested measure types ordered by type and number; the
 * first `minMultiVersion` bills with 3+ versions, topped up with the lowest-numbered remaining bills.
 */
export function selectBills(tables: PubinfoTables, opts: SelectOptions): BillRecord[] {
  const types = opts.measureTypes ?? ['AB', 'SB'];
  const versionCount = new Map<string, number>();
  for (const v of tables.versions) versionCount.set(v.billId, (versionCount.get(v.billId) ?? 0) + 1);
  const candidates = tables.bills
    .filter((b) => types.includes(b.measureType) && (versionCount.get(b.billId) ?? 0) > 0)
    .sort((a, b) => types.indexOf(a.measureType) - types.indexOf(b.measureType) || a.measureNum - b.measureNum);
  const multi = candidates.filter((b) => (versionCount.get(b.billId) ?? 0) >= 3).slice(0, opts.minMultiVersion);
  const chosen = new Set(multi.map((b) => b.billId));
  for (const b of candidates) {
    if (chosen.size >= opts.limit) break;
    chosen.add(b.billId);
  }
  return candidates.filter((b) => chosen.has(b.billId));
}

/** Joins the tables for the selected bills and parses every version's XML into normalised text. */
export async function buildBundles(
  source: PubinfoSource,
  tables: PubinfoTables,
  bills: BillRecord[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BillBundle[]> {
  const wanted = new Set(bills.map((b) => b.billId));
  const versions = tables.versions.filter((v) => wanted.has(v.billId));
  const texts = new Map<string, ReturnType<typeof parseBillXml>>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < versions.length) {
      const v = versions[next++]!;
      texts.set(v.versionId, parseBillXml(await source.readLob(v.lobFile!)));
      opts.onProgress?.(++done, versions.length);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 8 }, worker));

  const versionToBill = new Map(versions.map((v) => [v.versionId, v.billId]));
  return bills.map((bill) => {
    const own = sortVersionsChronologically(versions.filter((v) => v.billId === bill.billId));
    return {
      bill,
      versions: own.map((v) => {
        const parsed = texts.get(v.versionId)!;
        return {
          versionId: v.versionId,
          billId: v.billId,
          versionNum: v.versionNum,
          actionDate: v.actionDate,
          action: v.action,
          subject: parsed.subject ?? v.subject,
          title: parsed.title,
          digest: parsed.digest,
          text: parsed.text,
        };
      }),
      sponsors: tables.sponsors.filter((s) => versionToBill.get(s.versionId) === bill.billId),
      actions: tables.actions.filter((a) => a.billId === bill.billId),
    };
  });
}
