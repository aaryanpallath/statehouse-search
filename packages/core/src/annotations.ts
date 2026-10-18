import type { Db } from './db.ts';
import { makeAnchor, reanchor } from './anchor.ts';
import { diffWords, type DiffSegment } from './diff.ts';
import type { Annotation, ProjectedAnnotation } from './types.ts';

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export interface NewAnnotation {
  billId: string;
  versionId: string;
  startOffset: number;
  endOffset: number;
  note: string;
  author: string;
}

interface AnnotationRow {
  id: string;
  bill_id: string;
  version_id: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  prefix: string;
  suffix: string;
  note: string;
  author: string;
  created_at: Date | string;
}

const fromRow = (r: AnnotationRow): Annotation => ({
  id: r.id,
  billId: r.bill_id,
  versionId: r.version_id,
  startOffset: r.start_offset,
  endOffset: r.end_offset,
  quote: r.quote,
  prefix: r.prefix,
  suffix: r.suffix,
  note: r.note,
  author: r.author,
  createdAt: new Date(r.created_at).toISOString(),
});

export async function versionText(db: Db, billId: string, versionId: string): Promise<string> {
  const { rows } = await db.query<{ text: string }>('SELECT text FROM bill_versions WHERE bill_id = $1 AND version_id = $2', [billId, versionId]);
  if (!rows[0]) throw new NotFoundError(`version ${versionId} of bill ${billId} not found`);
  return rows[0].text;
}

/** Persists an annotation. The quote and context are derived server-side from the stored version text. */
export async function createAnnotation(db: Db, input: NewAnnotation): Promise<Annotation> {
  const note = input.note.trim();
  const author = input.author.trim();
  if (!note) throw new ValidationError('note must not be empty');
  if (!author) throw new ValidationError('author must not be empty');
  if (note.length > 5000) throw new ValidationError('note is too long (max 5000 characters)');
  const text = await versionText(db, input.billId, input.versionId);
  let anchor;
  try {
    anchor = makeAnchor(text, input.startOffset, input.endOffset);
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  const { rows } = await db.query<AnnotationRow>(
    `INSERT INTO annotations (bill_id, version_id, start_offset, end_offset, quote, prefix, suffix, note, author)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [input.billId, input.versionId, anchor.startOffset, anchor.endOffset, anchor.quote, anchor.prefix, anchor.suffix, note, author.slice(0, 80)],
  );
  return fromRow(rows[0]!);
}

export async function deleteAnnotation(db: Db, id: string): Promise<Annotation> {
  const { rows } = await db.query<AnnotationRow>('DELETE FROM annotations WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) throw new NotFoundError(`annotation ${id} not found`);
  return fromRow(rows[0]);
}

/**
 * Lists every annotation on a bill, positioned against `viewVersionId`. Annotations made on other
 * versions are re-anchored through a word diff (one diff per source version, cached per call).
 */
export async function listAnnotations(db: Db, billId: string, viewVersionId: string): Promise<ProjectedAnnotation[]> {
  const viewText = await versionText(db, billId, viewVersionId);
  const { rows } = await db.query<AnnotationRow>('SELECT * FROM annotations WHERE bill_id = $1 ORDER BY created_at, id', [billId]);
  const diffs = new Map<string, { text: string; segments: DiffSegment[] }>();
  const projected: ProjectedAnnotation[] = [];
  for (const row of rows) {
    const a = fromRow(row);
    if (a.versionId === viewVersionId) {
      projected.push({ ...a, viewVersionId, anchor: { status: 'exact', start: a.startOffset, end: a.endOffset, currentText: a.quote } });
      continue;
    }
    let d = diffs.get(a.versionId);
    if (!d) {
      const text = await versionText(db, billId, a.versionId);
      d = { text, segments: diffWords(text, viewText) };
      diffs.set(a.versionId, d);
    }
    projected.push({ ...a, viewVersionId, anchor: reanchor(a, d.text, viewText, d.segments) });
  }
  return projected.sort((x, y) => (x.anchor.start ?? Infinity) - (y.anchor.start ?? Infinity) || x.createdAt.localeCompare(y.createdAt));
}
