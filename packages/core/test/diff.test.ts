import { describe, expect, it } from 'vitest';
import { diffStats, diffWords, mapOffset, rangeChanged, toSideBySide, tokenize } from '../src/diff.ts';

const reconstruct = (segments: ReturnType<typeof diffWords>, side: 'a' | 'b') =>
  segments.filter((s) => s.op === 'equal' || s.op === (side === 'a' ? 'delete' : 'insert')).map((s) => s.text).join('');

describe('diffWords', () => {
  it('returns a single equal segment for identical texts', () => {
    const segs = diffWords('same text\n\nhere', 'same text\n\nhere');
    expect(segs).toEqual([{ op: 'equal', text: 'same text\n\nhere', aStart: 0, aEnd: 15, bStart: 0, bEnd: 15 }]);
  });

  it('finds word-level insertions and deletions inside a changed paragraph', () => {
    const a = 'The department shall adopt regulations by January 1, 2026.';
    const b = 'The department shall adopt emergency regulations by July 1, 2027.';
    const segs = diffWords(a, b);
    expect(segs.filter((s) => s.op === 'insert').map((s) => s.text.trim())).toEqual(['emergency', 'July', '2027.']);
    expect(segs.filter((s) => s.op === 'delete').map((s) => s.text.trim())).toEqual(['January', '2026.']);
    expect(diffStats(segs)).toEqual({ insertedWords: 3, deletedWords: 2, unchangedWords: 7 });
  });

  it('reconstructs both texts exactly and keeps consistent offsets', () => {
    const a = 'SECTION 1. Intro.\n\nSEC. 2. Old paragraph that is removed.\n\nSEC. 3. Keep me.\n\n';
    const b = 'SECTION 1. Intro, amended.\n\nSEC. 3. Keep me.\n\nSEC. 4. Brand new paragraph.';
    const segs = diffWords(a, b);
    expect(reconstruct(segs, 'a')).toBe(a);
    expect(reconstruct(segs, 'b')).toBe(b);
    for (const s of segs) {
      if (s.op !== 'insert') expect(a.slice(s.aStart, s.aEnd)).toBe(s.text);
      if (s.op !== 'delete') expect(b.slice(s.bStart, s.bEnd)).toBe(s.text);
    }
  });

  it('handles empty inputs', () => {
    expect(reconstruct(diffWords('', 'new words'), 'b')).toBe('new words');
    expect(reconstruct(diffWords('old words', ''), 'a')).toBe('old words');
  });

  it('tokenizes into words and whitespace that concatenate back', () => {
    const t = 'a  b\n\nc';
    expect(tokenize(t)).toEqual(['a', '  ', 'b', '\n\n', 'c']);
  });
});

describe('toSideBySide', () => {
  it('aligns unchanged paragraphs on the same row and puts changes on both sides', () => {
    const a = 'Para one.\n\nPara two old.\n\nPara three.';
    const b = 'Para one.\n\nPara two new.\n\nPara three.';
    const rows = toSideBySide(diffWords(a, b));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.left.map((p) => p.text).join('')).toBe('Para one.\n\n');
    expect(rows[1]!.left.some((p) => p.op === 'delete' && p.text.includes('old'))).toBe(true);
    expect(rows[1]!.right.some((p) => p.op === 'insert' && p.text.includes('new'))).toBe(true);
    expect(rows[2]!.right.map((p) => p.text).join('')).toBe('Para three.');
  });
});

describe('mapOffset / rangeChanged', () => {
  const a = 'alpha beta gamma delta';
  const b = 'alpha NEW beta gamma';
  const segs = diffWords(a, b);
  it('maps offsets in unchanged text through insertions', () => {
    expect(mapOffset(segs, a.indexOf('beta'), 'start')).toBe(b.indexOf('beta'));
    expect(mapOffset(segs, a.indexOf('gamma') + 5, 'end')).toBe(b.indexOf('gamma') + 5);
  });
  it('detects whether a range overlaps a change', () => {
    expect(rangeChanged(segs, a.indexOf('beta'), a.indexOf('beta') + 4)).toBe(false);
    expect(rangeChanged(segs, a.indexOf('delta'), a.length)).toBe(true);
  });
});
