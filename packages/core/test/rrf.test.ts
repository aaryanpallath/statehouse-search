import { describe, expect, it } from 'vitest';
import { RRF_K, filterSql, parseHeadline, reciprocalRankFusion } from '../src/search.ts';

describe('reciprocalRankFusion', () => {
  it('scores items as the sum of 1/(k + rank) across lists', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c'], ['c', 'a']]);
    const byId = Object.fromEntries(fused.map((f) => [f.id, f]));
    expect(byId.a!.score).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2));
    expect(byId.c!.score).toBeCloseTo(1 / (RRF_K + 3) + 1 / (RRF_K + 1));
    expect(byId.b!.score).toBeCloseTo(1 / (RRF_K + 2));
    expect(byId.b!.ranks).toEqual([2, null]);
    expect(fused.map((f) => f.id)).toEqual(['a', 'c', 'b']);
  });

  it('rewards agreement between retrievers over a single top rank', () => {
    // "both" is 3rd in each list; "fts-top" is 1st in one list only.
    const fused = reciprocalRankFusion([['fts-top', 'x', 'both'], ['vec-top', 'y', 'both']]);
    expect(fused[0]!.id).toBe('both');
  });

  it('breaks ties deterministically and ignores duplicate ids within a list', () => {
    const fused = reciprocalRankFusion([['b', 'b', 'a'], ['a', 'b']]);
    expect(fused.find((f) => f.id === 'b')!.ranks).toEqual([1, 2]);
    const tie = reciprocalRankFusion([['z'], ['y']]);
    expect(tie.map((f) => f.id)).toEqual(['y', 'z']);
  });

  it('respects the k parameter and handles empty input', () => {
    expect(reciprocalRankFusion([['a']], 0)[0]!.score).toBe(1);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});

describe('filterSql', () => {
  it('builds parameterised clauses and escapes LIKE wildcards', () => {
    const params: unknown[] = ['q'];
    const sql = filterSql({ session: '20252026', status: 'Chaptered', sponsor: 'Wie%ner', subject: 'fire' }, params);
    expect(sql).toContain('b.session = $2');
    expect(sql).toContain('b.measure_state = $3');
    expect(sql).toContain('b.subject ILIKE $4');
    expect(sql).toContain('s.name ILIKE $5');
    expect(params).toEqual(['q', '20252026', 'Chaptered', '%fire%', '%Wie\\%ner%']);
    expect(filterSql({}, [])).toBe('TRUE');
  });
});

describe('parseHeadline', () => {
  it('splits ts_headline output on control-character markers', () => {
    expect(parseHeadline('a \u0001fire\u0002 and \u0001insurance\u0002.')).toEqual([
      { text: 'a ', hit: false },
      { text: 'fire', hit: true },
      { text: ' and ', hit: false },
      { text: 'insurance', hit: true },
      { text: '.', hit: false },
    ]);
    expect(parseHeadline('no hits')).toEqual([{ text: 'no hits', hit: false }]);
  });
});
