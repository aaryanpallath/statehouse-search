import type { Db } from './db.ts';
import { NotFoundError, versionText } from './annotations.ts';
import { billLabel } from './pubinfo.ts';

export interface BillDetail {
  billId: string;
  label: string;
  session: string;
  status: string;
  currentStatus: string | null;
  currentLocation: string | null;
  title: string | null;
  subject: string | null;
  latestVersionId: string | null;
  versions: { versionId: string; versionNum: number; actionDate: string | null; action: string; words: number }[];
  sponsors: { name: string; house: string; contribution: string; versionId: string }[];
  actions: { actionId: string; actionDate: string | null; action: string; sequence: number | null }[];
}

// Dates are formatted in SQL (to_char) so drivers never convert them through JS time zones.
const isoDate = (d: string | null): string | null => d;

export async function getBill(db: Db, billId: string): Promise<BillDetail> {
  const bill = await db.query<{
    bill_id: string; session: string; measure_type: string; measure_num: number; measure_state: string;
    current_status: string | null; current_location: string | null; title: string | null; subject: string | null;
    latest_version_id: string | null;
  }>('SELECT * FROM bills WHERE bill_id = $1', [billId]);
  const b = bill.rows[0];
  if (!b) throw new NotFoundError(`bill ${billId} not found`);
  const versions = await db.query<{ version_id: string; version_num: number; action_date: string | null; action: string; words: number }>(
    `SELECT version_id, version_num, to_char(action_date, 'YYYY-MM-DD') AS action_date, action, array_length(regexp_split_to_array(trim(text), '\\s+'), 1) AS words
     FROM bill_versions WHERE bill_id = $1 ORDER BY version_num DESC, action_date`,
    [billId],
  );
  const sponsors = await db.query<{ name: string; house: string; contribution: string; version_id: string }>(
    `SELECT name, house, contribution, version_id FROM sponsors WHERE bill_id = $1 AND version_id = $2
     ORDER BY is_primary DESC, contribution, name`,
    [billId, b.latest_version_id],
  );
  const actions = await db.query<{ action_id: string; action_date: string | null; action: string; sequence: number | null }>(
    "SELECT action_id, to_char(action_date, 'YYYY-MM-DD') AS action_date, action, sequence FROM actions WHERE bill_id = $1 ORDER BY actions.action_date, sequence, action_id",
    [billId],
  );
  return {
    billId: b.bill_id,
    label: billLabel(b.measure_type, b.measure_num),
    session: b.session,
    status: b.measure_state,
    currentStatus: b.current_status,
    currentLocation: b.current_location,
    title: b.title,
    subject: b.subject,
    latestVersionId: b.latest_version_id,
    versions: versions.rows.map((v) => ({ versionId: v.version_id, versionNum: v.version_num, actionDate: isoDate(v.action_date), action: v.action, words: v.words ?? 0 })),
    sponsors: sponsors.rows.map((s) => ({ name: s.name, house: s.house, contribution: s.contribution, versionId: s.version_id })),
    actions: actions.rows.map((a) => ({ actionId: a.action_id, actionDate: isoDate(a.action_date), action: a.action, sequence: a.sequence })),
  };
}

export async function getVersion(db: Db, billId: string, versionId: string): Promise<{ versionId: string; text: string }> {
  return { versionId, text: await versionText(db, billId, versionId) };
}

/** Number of recorded legislative actions per month, for one bill or the whole corpus. */
export async function activityByMonth(db: Db, billId?: string): Promise<{ month: string; actions: number }[]> {
  const { rows } = await db.query<{ month: string; actions: number }>(
    `SELECT to_char(date_trunc('month', action_date), 'YYYY-MM') AS month, count(*)::int AS actions
     FROM actions WHERE action_date IS NOT NULL AND ($1::text IS NULL OR bill_id = $1)
     GROUP BY 1 ORDER BY 1`,
    [billId ?? null],
  );
  return rows;
}
