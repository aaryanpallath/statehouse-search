/**
 * Converts a CAML bill document (California Legislative Counsel XML) into normalised plain text.
 * The plain text is the canonical representation used for chunking, diffing and annotation offsets,
 * so this function must be deterministic. Paragraphs are separated by a blank line.
 */
export interface ParsedBillXml {
  title: string | null;
  subject: string | null;
  digest: string | null;
  body: string;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? m;
  });
}

function firstMatch(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? m[1]! : null;
}

const BLOCK_END = /<\/(?:p|h\d?|tr|caml:Num|caml:ActionLine|caml:Preamble|caml:LawHeadingText|caml:Whereas|caml:Resolved)>/g;

/** Turns an XML fragment into paragraphs of whitespace-normalised text. */
export function fragmentToParagraphs(fragment: string): string[] {
  const withBreaks = fragment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<span class="(?:EnSpace|ThinSpace|EmSpace)"\s*\/>/g, ' ')
    .replace(BLOCK_END, '\n')
    .replace(/<\/td>/g, ' ')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

export function parseBillXml(xml: string): ParsedBillXml {
  const titleRaw = firstMatch(xml, 'caml:Title');
  const subjectRaw = firstMatch(xml, 'caml:Subject');
  const digestRaw = firstMatch(xml, 'caml:DigestText');
  const bodyRaw = firstMatch(xml, 'caml:Bill') ?? firstMatch(xml, 'caml:Resolution') ?? '';
  const title = titleRaw ? fragmentToParagraphs(titleRaw).join(' ') : null;
  const subject = subjectRaw ? fragmentToParagraphs(subjectRaw).join(' ') : null;
  const digestParas = digestRaw ? fragmentToParagraphs(digestRaw) : [];
  const bodyParas = fragmentToParagraphs(bodyRaw);
  const sections: string[] = [];
  if (title) sections.push(title);
  if (digestParas.length) sections.push("LEGISLATIVE COUNSEL'S DIGEST", ...digestParas);
  sections.push(...bodyParas);
  return {
    title,
    subject,
    digest: digestParas.length ? digestParas.join('\n\n') : null,
    body: bodyParas.join('\n\n'),
    text: sections.join('\n\n'),
  };
}
