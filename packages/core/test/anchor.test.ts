import { describe, expect, it } from 'vitest';
import { makeAnchor, reanchor } from '../src/anchor.ts';

const v1 = [
  'SECTION 1. The Legislature finds that wildfire risk is increasing.',
  'SEC. 2. The department shall publish a map of very high fire hazard severity zones by January 1, 2026.',
  'SEC. 3. Insurers shall offer a discount for defensible space.',
].join('\n\n');

const anchorOn = (text: string, quote: string) => {
  const start = text.indexOf(quote);
  return makeAnchor(text, start, start + quote.length);
};

describe('makeAnchor', () => {
  it('captures quote and surrounding context', () => {
    const a = anchorOn(v1, 'defensible space');
    expect(a.quote).toBe('defensible space');
    expect(a.prefix.endsWith('discount for ')).toBe(true);
    expect(a.suffix).toBe('.');
  });
  it('rejects invalid ranges', () => {
    expect(() => makeAnchor(v1, 5, 5)).toThrow(RangeError);
    expect(() => makeAnchor(v1, -1, 4)).toThrow(RangeError);
    expect(() => makeAnchor(v1, 0, v1.length + 1)).toThrow(RangeError);
  });
});

describe('reanchor', () => {
  it('is exact when the text is unchanged', () => {
    const a = anchorOn(v1, 'publish a map');
    expect(reanchor(a, v1, v1)).toEqual({ status: 'exact', start: a.startOffset, end: a.endOffset, currentText: 'publish a map' });
  });

  it('moves the anchor when text is inserted before the passage', () => {
    const v2 = v1.replace('SECTION 1. The Legislature', 'SECTION 1. The Legislature of the State of California');
    const a = anchorOn(v1, 'defensible space');
    const r = reanchor(a, v1, v2);
    expect(r.status).toBe('moved');
    expect(v2.slice(r.start!, r.end!)).toBe('defensible space');
    expect(r.start).toBe(v2.indexOf('defensible space'));
  });

  it('follows a passage whose paragraph was relocated', () => {
    const paras = v1.split('\n\n');
    const v2 = [paras[2], paras[0], paras[1]].join('\n\n');
    const a = anchorOn(v1, 'Insurers shall offer a discount');
    const r = reanchor(a, v1, v2);
    expect(r.status).toBe('moved');
    expect(r.start).toBe(v2.indexOf('Insurers shall offer a discount'));
  });

  it('flags a passage that was edited and reports its new wording', () => {
    const v2 = v1.replace('by January 1, 2026', 'by July 1, 2027');
    const a = anchorOn(v1, 'by January 1, 2026');
    const r = reanchor(a, v1, v2);
    expect(r.status).toBe('changed');
    expect(r.currentText).toContain('July 1, 2027');
  });

  it('orphans a passage whose paragraph was deleted', () => {
    const paras = v1.split('\n\n');
    const v2 = [paras[0], paras[1]].join('\n\n');
    const a = anchorOn(v1, 'Insurers shall offer a discount for defensible space.');
    const r = reanchor(a, v1, v2);
    expect(r).toEqual({ status: 'orphaned', start: null, end: null, currentText: null });
  });

  it('uses context to pick the right occurrence of a repeated phrase', () => {
    const text = 'The department shall act. The board shall act. The commission shall act.';
    const start = text.indexOf('shall act', text.indexOf('board'));
    const a = makeAnchor(text, start, start + 'shall act'.length);
    const v2 = 'Preamble added here. ' + text.replace('The department shall act. ', 'The department shall act promptly. ');
    const r = reanchor(a, text, v2);
    expect(r.status).toBe('moved');
    expect(r.start).toBe(v2.indexOf('shall act', v2.indexOf('board')));
  });
});
