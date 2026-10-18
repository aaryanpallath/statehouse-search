// Sample data for Storybook stories, shaped exactly like the API responses.
import type { ProjectedAnnotation, SearchResult } from '@statehouse/core/types';
import type { DiffSegment, SideBySideRow } from '@statehouse/core/diff';

export const sampleResult: SearchResult = {
  billId: '202520260SB100',
  label: 'SB 100',
  title: 'An act to amend Section 4291 of the Public Resources Code, relating to fire prevention.',
  subject: 'Fire prevention: defensible space.',
  status: 'Amended Senate',
  session: '20252026',
  sponsors: ['Example'],
  score: 0.032787,
  ftsRank: 1,
  vectorRank: 2,
  snippet: [
    { text: 'A person who owns a structure in a very high ', hit: false },
    { text: 'fire', hit: true },
    { text: ' hazard severity zone shall maintain ', hit: false },
    { text: 'defensible space', hit: true },
    { text: ' of 100 feet from each side of the structure…', hit: false },
  ],
};

const oldText = 'The department shall adopt regulations on or before January 1, 2026.\n\nThis act shall take effect immediately.';
const newText = 'The department shall adopt emergency regulations on or before July 1, 2027.\n\nThis act shall take effect immediately.';
export const sampleDiff: { segments: DiffSegment[]; rows: SideBySideRow[]; oldText: string; newText: string } = {
  oldText,
  newText,
  segments: [
    { op: 'equal', text: 'The department shall adopt ', aStart: 0, aEnd: 27, bStart: 0, bEnd: 27 },
    { op: 'insert', text: 'emergency ', aStart: 27, aEnd: 27, bStart: 27, bEnd: 37 },
    { op: 'equal', text: 'regulations on or before ', aStart: 27, aEnd: 52, bStart: 37, bEnd: 62 },
    { op: 'delete', text: 'January 1, 2026', aStart: 52, aEnd: 67, bStart: 62, bEnd: 62 },
    { op: 'insert', text: 'July 1, 2027', aStart: 67, aEnd: 67, bStart: 62, bEnd: 74 },
    { op: 'equal', text: '.\n\nThis act shall take effect immediately.', aStart: 67, aEnd: 109, bStart: 74, bEnd: 116 },
  ],
  rows: [
    {
      left: [{ op: 'equal', text: 'The department shall adopt ' }, { op: 'equal', text: 'regulations on or before ' }, { op: 'delete', text: 'January 1, 2026' }, { op: 'equal', text: '.\n\n' }],
      right: [{ op: 'equal', text: 'The department shall adopt ' }, { op: 'insert', text: 'emergency ' }, { op: 'equal', text: 'regulations on or before ' }, { op: 'insert', text: 'July 1, 2027' }, { op: 'equal', text: '.\n\n' }],
    },
    { left: [{ op: 'equal', text: 'This act shall take effect immediately.' }], right: [{ op: 'equal', text: 'This act shall take effect immediately.' }] },
  ],
};

const base = { billId: '202520260SB100', prefix: '', suffix: '', createdAt: '2026-01-15T10:00:00.000Z', viewVersionId: 'v2' };
export const sampleAnnotations: ProjectedAnnotation[] = [
  { ...base, id: 'a1', versionId: 'v2', startOffset: 0, endOffset: 14, quote: 'The department', note: 'Which department? CAL FIRE presumably.', author: 'Sam', anchor: { status: 'exact', start: 0, end: 14, currentText: 'The department' } },
  { ...base, id: 'a2', versionId: 'v1', startOffset: 69, endOffset: 109, quote: 'This act shall take effect immediately.', note: 'Urgency clause — needs 2/3 vote.', author: 'Alex', anchor: { status: 'moved', start: 76, end: 116, currentText: 'This act shall take effect immediately.' } },
  { ...base, id: 'a3', versionId: 'v1', startOffset: 52, endOffset: 67, quote: 'January 1, 2026', note: 'Deadline seems tight.', author: 'Sam', anchor: { status: 'changed', start: 62, end: 74, currentText: 'July 1, 2027' } },
  { ...base, id: 'a4', versionId: 'v1', startOffset: 10, endOffset: 20, quote: 'old clause', note: 'This was struck entirely.', author: 'Robin', anchor: { status: 'orphaned', start: null, end: null, currentText: null } },
];
