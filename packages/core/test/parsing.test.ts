import { describe, expect, it } from 'vitest';
import { parseBillXml } from '../src/billXml.ts';
import { chunkText } from '../src/chunk.ts';
import { parseDat, toBillRecords } from '../src/pubinfo.ts';

describe('parseDat', () => {
  it('parses backtick-quoted, tab-separated rows with NULLs and embedded newlines', () => {
    const rows = parseDat('`a`\t`multi\nline`\tNULL\t42\n`b`\t`x`\t`y`\t7\n');
    expect(rows).toEqual([
      ['a', 'multi\nline', null, '42'],
      ['b', 'x', 'y', '7'],
    ]);
  });
  it('maps BILL_TBL columns', () => {
    const row = ['202520260AB13', '20252026', '0', 'AB', '13', 'Amended Senate', null, null, null, null, '20250AB1395AMD', 'Y', 'u', 't', 'CS61', 'Committee', 'Senate', 'In Committee Process', null];
    expect(toBillRecords([row])[0]).toEqual({
      billId: '202520260AB13', session: '20252026', measureType: 'AB', measureNum: 13, measureState: 'Amended Senate',
      latestVersionId: '20250AB1395AMD', currentLocation: 'CS61', currentStatus: 'In Committee Process',
    });
  });
});

describe('parseBillXml', () => {
  it('extracts title, subject, digest and body paragraphs from CAML', () => {
    const xml = `<caml:MeasureDoc><caml:Description><caml:Title> An act relating to <i>fire</i>. </caml:Title>
      <caml:GeneralSubject><caml:Subject>Fire &amp; safety.</caml:Subject></caml:GeneralSubject>
      <caml:DigestText><p>Existing law does X.</p><p>This bill would do Y.</p></caml:DigestText></caml:Description>
      <caml:Bill><caml:BillSection><caml:Num>SECTION 1.</caml:Num><caml:Content><p>The   people enact.</p></caml:Content></caml:BillSection></caml:Bill></caml:MeasureDoc>`;
    const parsed = parseBillXml(xml);
    expect(parsed.title).toBe('An act relating to fire.');
    expect(parsed.subject).toBe('Fire & safety.');
    expect(parsed.digest).toBe('Existing law does X.\n\nThis bill would do Y.');
    expect(parsed.text).toBe("An act relating to fire.\n\nLEGISLATIVE COUNSEL'S DIGEST\n\nExisting law does X.\n\nThis bill would do Y.\n\nSECTION 1.\n\nThe people enact.");
  });
});

describe('chunkText', () => {
  it('produces overlapping windows with exact source offsets', () => {
    const text = Array.from({ length: 250 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText(text, { maxWords: 100, overlap: 20 });
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(text.slice(c.start, c.end)).toBe(c.content);
    expect(chunks[1]!.content.startsWith('w80 ')).toBe(true);
    expect(chunks[2]!.content.endsWith('w249')).toBe(true);
  });
  it('caps the number of chunks', () => {
    const text = Array.from({ length: 1000 }, () => 'word').join(' ');
    expect(chunkText(text, { maxWords: 50, overlap: 0, maxChunks: 4 })).toHaveLength(4);
  });
});
