import type { ActionRecord, BillRecord, SponsorRecord } from './types.ts';

/**
 * Parser for the California Legislative Information "pubinfo" table dumps (*.dat). Rows are
 * newline-terminated, fields are tab-separated, string fields are enclosed in backticks and SQL NULL
 * is written as the bare word NULL. Backtick-enclosed fields may contain tabs and newlines.
 */
export function parseDat(content: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    let value: string | null;
    if (content[i] === '`') {
      const close = findClosingBacktick(content, i + 1);
      value = content.slice(i + 1, close);
      i = close + 1;
    } else {
      let j = i;
      while (j < n && content[j] !== '\t' && content[j] !== '\n' && content[j] !== '\r') j++;
      const raw = content.slice(i, j);
      value = raw === 'NULL' ? null : raw;
      i = j;
    }
    row.push(value);
    if (content[i] === '\r') i++;
    if (i >= n || content[i] === '\n') {
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
      i++;
    } else if (content[i] === '\t') {
      i++;
    }
  }
  return rows;
}

function findClosingBacktick(s: string, from: number): number {
  let k = from;
  for (;;) {
    const idx = s.indexOf('`', k);
    if (idx < 0) return s.length;
    const next = s[idx + 1];
    if (next === undefined || next === '\t' || next === '\n' || next === '\r') return idx;
    k = idx + 1;
  }
}

/** Raw BILL_VERSION_TBL row (columns per pubinfo_load/bill_version_tbl.sql). */
export interface VersionRow {
  versionId: string;
  billId: string;
  versionNum: number;
  actionDate: string | null;
  action: string;
  subject: string | null;
  lobFile: string | null;
  active: boolean;
}

const dateOnly = (v: string | null | undefined): string | null => (v ? v.slice(0, 10) : null);

export function toBillRecords(rows: (string | null)[][]): BillRecord[] {
  // BILL_ID, SESSION_YEAR, SESSION_NUM, MEASURE_TYPE, MEASURE_NUM, MEASURE_STATE, CHAPTER_YEAR,
  // CHAPTER_TYPE, CHAPTER_SESSION_NUM, CHAPTER_NUM, LATEST_BILL_VERSION_ID, ACTIVE_FLG, TRANS_UID,
  // TRANS_UPDATE, CURRENT_LOCATION, CURRENT_SECONDARY_LOC, CURRENT_HOUSE, CURRENT_STATUS, DAYS_31ST
  return rows.map((r) => ({
    billId: r[0]!,
    session: r[1]!,
    measureType: r[3]!,
    measureNum: Number(r[4]),
    measureState: r[5] ?? 'Unknown',
    latestVersionId: r[10] ?? null,
    currentLocation: r[14] ?? null,
    currentStatus: r[17] ?? null,
  }));
}

export function toVersionRows(rows: (string | null)[][]): VersionRow[] {
  // BILL_VERSION_ID, BILL_ID, VERSION_NUM, ACTION_DATE, ACTION, REQUEST_NUM, SUBJECT, VOTE_REQUIRED,
  // APPROPRIATION, FISCAL_COMMITTEE, LOCAL_PROGRAM, SUBSTANTIVE_CHANGES, URGENCY, TAXLEVY, BILL_XML(lob),
  // ACTIVE_FLG, TRANS_UID, TRANS_UPDATE
  return rows.map((r) => ({
    versionId: r[0]!,
    billId: r[1]!,
    versionNum: Number(r[2]),
    actionDate: dateOnly(r[3]),
    action: r[4] ?? '',
    subject: r[6] ?? null,
    lobFile: r[14] ?? null,
    active: r[15] === 'Y',
  }));
}

export function toSponsorRecords(rows: (string | null)[][]): SponsorRecord[] {
  // BILL_VERSION_ID, TYPE, HOUSE, NAME, CONTRIBUTION, COMMITTEE_MEMBERS, ACTIVE_FLG, TRANS_UID,
  // TRANS_UPDATE, PRIMARY_AUTHOR_FLG
  return rows
    .filter((r) => r[6] !== 'N')
    .map((r) => ({
      versionId: r[0]!,
      authorType: r[1] ?? null,
      house: r[2] ?? null,
      name: (r[3] ?? '').trim(),
      contribution: r[4] ?? null,
      isPrimary: r[9] === 'Y',
    }))
    .filter((s) => s.name.length > 0);
}

export function toActionRecords(rows: (string | null)[][]): ActionRecord[] {
  // BILL_ID, BILL_HISTORY_ID, ACTION_DATE, ACTION, TRANS_UID, TRANS_UPDATE_DT, ACTION_SEQUENCE,
  // ACTION_CODE, ACTION_STATUS, PRIMARY_LOCATION, SECONDARY_LOCATION, TERNARY_LOCATION, END_STATUS
  return rows.map((r) => ({
    billId: r[0]!,
    actionId: r[1]!,
    actionDate: dateOnly(r[2]),
    action: (r[3] ?? '').trim(),
    sequence: r[6] == null ? null : Number(r[6]),
    status: r[12] ?? null,
  }));
}

/** Human label for a bill id such as "202520260AB76" -> "AB 76". */
export function billLabel(measureType: string, measureNum: number): string {
  return `${measureType} ${measureNum}`;
}
