import { diffArrays } from 'diff';

/**
 * Word-level diff between two versions of a bill's normalised text.
 *
 * Bills can run to tens of thousands of words, so the diff is computed in two passes: first over
 * paragraphs (cheap, aligns unchanged paragraphs), then word-by-word inside each run of replaced
 * paragraphs. Every segment carries exact character offsets in both texts, which is what annotation
 * re-anchoring relies on. This module is dependency-light and safe to import in the browser.
 */
export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffSegment {
  op: DiffOp;
  text: string;
  /** Offsets into the old text (for inserts aStart === aEnd). */
  aStart: number;
  aEnd: number;
  /** Offsets into the new text (for deletes bStart === bEnd). */
  bStart: number;
  bEnd: number;
}

export interface DiffStats {
  insertedWords: number;
  deletedWords: number;
  unchangedWords: number;
}

export interface SideBySideRow {
  left: { op: 'equal' | 'delete'; text: string }[];
  right: { op: 'equal' | 'insert'; text: string }[];
}

/** Splits text into paragraph units, each keeping its trailing separator, so units concatenate back exactly. */
function paragraphs(text: string): string[] {
  return text.match(/[\s\S]*?(?:\n\n+|$)/g)?.filter((p) => p.length > 0) ?? [];
}

/** Word and whitespace tokens; concatenating them reproduces the input exactly. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

class SegmentBuilder {
  readonly segments: DiffSegment[] = [];
  private a = 0;
  private b = 0;

  push(op: DiffOp, text: string): void {
    if (!text) return;
    const aLen = op === 'insert' ? 0 : text.length;
    const bLen = op === 'delete' ? 0 : text.length;
    const last = this.segments[this.segments.length - 1];
    if (last && last.op === op) {
      last.text += text;
      last.aEnd += aLen;
      last.bEnd += bLen;
    } else {
      this.segments.push({ op, text, aStart: this.a, aEnd: this.a + aLen, bStart: this.b, bEnd: this.b + bLen });
    }
    this.a += aLen;
    this.b += bLen;
  }
}

function wordDiffInto(out: SegmentBuilder, oldText: string, newText: string): void {
  for (const change of diffArrays(tokenize(oldText), tokenize(newText))) {
    const text = change.value.join('');
    out.push(change.added ? 'insert' : change.removed ? 'delete' : 'equal', text);
  }
}

export function diffWords(oldText: string, newText: string): DiffSegment[] {
  const out = new SegmentBuilder();
  if (oldText === newText) {
    out.push('equal', oldText);
    return out.segments;
  }
  const changes = diffArrays(paragraphs(oldText), paragraphs(newText));
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!;
    const text = change.value.join('');
    if (!change.added && !change.removed) {
      out.push('equal', text);
      continue;
    }
    // A removed block followed by an added block (or vice versa) is a replacement: diff it word by word.
    const next = changes[i + 1];
    if (next && (next.added || next.removed) && next.added !== change.added) {
      const removed = change.removed ? text : next.value.join('');
      const added = change.added ? text : next.value.join('');
      wordDiffInto(out, removed, added);
      i++;
    } else {
      out.push(change.added ? 'insert' : 'delete', text);
    }
  }
  return out.segments;
}

const countWords = (s: string): number => s.match(/\S+/g)?.length ?? 0;

export function diffStats(segments: DiffSegment[]): DiffStats {
  const stats: DiffStats = { insertedWords: 0, deletedWords: 0, unchangedWords: 0 };
  for (const s of segments) {
    const n = countWords(s.text);
    if (s.op === 'insert') stats.insertedWords += n;
    else if (s.op === 'delete') stats.deletedWords += n;
    else stats.unchangedWords += n;
  }
  return stats;
}

/**
 * Groups segments into rows for a side-by-side view. Rows break at paragraph boundaries that both
 * versions share (inside equal segments), so corresponding paragraphs line up horizontally.
 */
export function toSideBySide(segments: DiffSegment[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let row: SideBySideRow = { left: [], right: [] };
  const flush = () => {
    if (row.left.length || row.right.length) rows.push(row);
    row = { left: [], right: [] };
  };
  for (const s of segments) {
    if (s.op === 'delete') row.left.push({ op: 'delete', text: s.text });
    else if (s.op === 'insert') row.right.push({ op: 'insert', text: s.text });
    else {
      const pieces = s.text.split(/(?<=\n\n)/);
      pieces.forEach((piece, idx) => {
        row.left.push({ op: 'equal', text: piece });
        row.right.push({ op: 'equal', text: piece });
        if (idx < pieces.length - 1 || piece.endsWith('\n\n')) flush();
      });
    }
  }
  flush();
  return rows;
}

/**
 * Maps a character offset in the old text to the new text. Offsets inside deleted text collapse to
 * the edge of the deletion; `bias` decides whether an adjacent replacement insert is included
 * ('end' extends past it, 'start' stays before it).
 */
export function mapOffset(segments: DiffSegment[], offset: number, bias: 'start' | 'end'): number {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (s.op === 'insert') continue;
    const inside = bias === 'start' ? offset >= s.aStart && offset < s.aEnd : offset > s.aStart && offset <= s.aEnd;
    if (!inside) continue;
    if (s.op === 'equal') return s.bStart + (offset - s.aStart);
    if (bias === 'start') return s.bStart;
    // End inside a deletion: include any insertion that directly replaces it.
    const next = segments[i + 1];
    return next && next.op === 'insert' ? next.bEnd : s.bStart;
  }
  // Offset at the very end (or empty old text): map to the end of the new text.
  const last = segments[segments.length - 1];
  return last ? last.bEnd : 0;
}

/** True when any non-equal segment touches the old-text range [start, end). */
export function rangeChanged(segments: DiffSegment[], start: number, end: number): boolean {
  return segments.some((s) => {
    if (s.op === 'equal') return false;
    if (s.op === 'delete') return s.aStart < end && s.aEnd > start;
    return s.aStart > start && s.aStart < end; // insertion strictly inside the range
  });
}
