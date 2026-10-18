/**
 * Records a small offline fixture set for the test-suite from the cached pubinfo download: a handful
 * of real bills (several with 3+ versions), restricted table rows and their bill-text XML files.
 *
 *   npm run fixtures:record -- [--year 2025] [--count 8]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTables, logger, parseDat, remoteZipSource, repoRoot, type TableName } from '@statehouse/core';
import { parseArgs } from './args.ts';

const args = parseArgs();
const year = String(args.year ?? '2025');
const count = Number(args.count ?? 8);
const source = await remoteZipSource(`https://downloads.leginfo.legislature.ca.gov/pubinfo_${year}.zip`, join(repoRoot(), 'data', 'raw', year));
const tables = await loadTables(source);

// Pick the smallest bills (by version count x text size proxy) so fixtures stay tiny: 3+ versions first.
const byBill = new Map<string, number>();
for (const v of tables.versions) byBill.set(v.billId, (byBill.get(v.billId) ?? 0) + 1);
const ab = tables.bills.filter((b) => b.measureType === 'AB' || b.measureType === 'SB').sort((a, b) => a.measureNum - b.measureNum);
const multi = ab.filter((b) => (byBill.get(b.billId) ?? 0) >= 3 && (byBill.get(b.billId) ?? 0) <= 5);
const single = ab.filter((b) => byBill.get(b.billId) === 1);
const lobSize = async (billId: string) => {
  let size = 0;
  for (const v of tables.versions.filter((x) => x.billId === billId)) size += (await source.readLob(v.lobFile!)).length;
  return size;
};
const pickSmall = async (list: typeof ab, n: number) => {
  const sized: { id: string; size: number }[] = [];
  for (const b of list.slice(0, 60)) sized.push({ id: b.billId, size: await lobSize(b.billId) });
  return sized.sort((a, b) => a.size - b.size).slice(0, n).map((s) => s.id);
};
const chosen = new Set([...(await pickSmall(multi, count - 2)), ...(await pickSmall(single, 2))]);

const dir = join(repoRoot(), 'apps', 'api', 'test', 'fixtures', 'pubinfo');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'lob'), { recursive: true });
const versionIds = new Set(tables.versions.filter((v) => chosen.has(v.billId)).map((v) => v.versionId));
const keep: Record<TableName, (row: (string | null)[]) => boolean> = {
  'BILL_TBL.dat': (r) => chosen.has(r[0]!),
  'BILL_VERSION_TBL.dat': (r) => chosen.has(r[1]!) && r[15] === 'Y',
  'BILL_VERSION_AUTHORS_TBL.dat': (r) => versionIds.has(r[0]!),
  'BILL_HISTORY_TBL.dat': (r) => chosen.has(r[0]!),
};
const serialize = (row: (string | null)[]) => row.map((v) => (v === null ? 'NULL' : `\`${v}\``)).join('\t');
for (const [name, pred] of Object.entries(keep) as [TableName, (r: (string | null)[]) => boolean][]) {
  const rows = parseDat(await source.readTable(name)).filter(pred);
  writeFileSync(join(dir, name), rows.map(serialize).join('\n') + '\n');
}
for (const v of tables.versions.filter((x) => chosen.has(x.billId))) {
  writeFileSync(join(dir, 'lob', v.lobFile!), await source.readLob(v.lobFile!));
}
logger.info({ bills: [...chosen], versions: versionIds.size, dir }, 'recorded fixtures');
