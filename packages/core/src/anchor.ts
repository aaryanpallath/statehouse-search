import type { AnchorStatus } from './types.ts';
import { diffWords, mapOffset, rangeChanged, type DiffSegment } from './diff.ts';

/**
 * Text-position annotation anchors. An annotation stores the exact offsets it was created at in one
 * bill version, plus the quoted passage and a little surrounding context. When the annotation is
 * viewed against another version we try, in order:
 *   1. the quote occurs (unchanged) in the new text -> 'exact' (same offsets) or 'moved';
 *   2. the diff maps the old range to a non-empty new range -> 'changed' (flagged for review);
 *   3. otherwise the passage was deleted -> 'orphaned' (flagged).
 */
export const CONTEXT_CHARS = 32;

export interface TextAnchor {
  startOffset: number;
  endOffset: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface ResolvedAnchor {
  status: AnchorStatus;
  start: number | null;
  end: number | null;
  currentText: string | null;
}

export function makeAnchor(text: string, start: number, end: number): TextAnchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) {
    throw new RangeError(`invalid anchor range [${start}, ${end}) for text of length ${text.length}`);
  }
  return {
    startOffset: start,
    endOffset: end,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
  };
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) found.push(i);
  return found;
}

export function reanchor(
  anchor: TextAnchor,
  oldText: string,
  newText: string,
  segments: DiffSegment[] = diffWords(oldText, newText),
): ResolvedAnchor {
  const { startOffset: start, endOffset: end, quote } = anchor;
  const mappedStart = mapOffset(segments, start, 'start');
  const mappedEnd = mapOffset(segments, end, 'end');

  // An unchanged passage that the diff maps cleanly is the strongest signal.
  if (!rangeChanged(segments, start, end) && newText.slice(mappedStart, mappedEnd) === quote) {
    return { status: mappedStart === start ? 'exact' : 'moved', start: mappedStart, end: mappedEnd, currentText: quote };
  }

  // The quote may still exist verbatim (e.g. a paragraph was moved). Pick the best occurrence by
  // context similarity, breaking ties by proximity to where the diff says the passage went.
  const candidates = occurrences(newText, quote);
  if (candidates.length > 0) {
    let best = candidates[0]!;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const ctx =
        commonSuffixLen(anchor.prefix, newText.slice(Math.max(0, c - CONTEXT_CHARS), c)) +
        commonPrefixLen(anchor.suffix, newText.slice(c + quote.length, c + quote.length + CONTEXT_CHARS));
      const score = ctx * 1e6 - Math.abs(c - mappedStart);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return { status: best === start ? 'exact' : 'moved', start: best, end: best + quote.length, currentText: quote };
  }

  if (mappedEnd > mappedStart && newText.slice(mappedStart, mappedEnd).trim().length > 0) {
    return { status: 'changed', start: mappedStart, end: mappedEnd, currentText: newText.slice(mappedStart, mappedEnd) };
  }
  return { status: 'orphaned', start: null, end: null, currentText: null };
}
