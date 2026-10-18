/** Pure helpers for rendering annotation highlights over bill text and mapping DOM selections to offsets. */

export interface Range {
  id: string;
  start: number;
  end: number;
}

export interface TextSegment {
  start: number;
  end: number;
  /** ids of the ranges covering this segment (empty = plain text). */
  ids: string[];
}

/** Splits [0, length) at every range boundary; overlapping ranges produce segments with several ids. */
export function segmentByRanges(length: number, ranges: Range[]): TextSegment[] {
  const valid = ranges.filter((r) => r.end > r.start && r.start >= 0 && r.end <= length);
  const cuts = new Set<number>([0, length]);
  for (const r of valid) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;
    segments.push({ start, end, ids: valid.filter((r) => r.start < end && r.end > start).map((r) => r.id) });
  }
  return segments;
}

/** Trims whitespace from a selected range so highlights hug the words. */
export function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(text.length, Math.max(start, end));
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  return e > s ? { start: s, end: e } : null;
}

/**
 * Converts a DOM (node, offset) selection endpoint inside a container whose children are elements
 * carrying `data-start` (each holding a single text node) into a character offset in the source text.
 */
export function domOffset(container: Element, node: Node, offset: number): number | null {
  if (!container.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const el = node.parentElement?.closest('[data-start]');
    if (!el || !container.contains(el)) return null;
    return Number((el as HTMLElement).dataset.start) + offset;
  }
  // Element endpoint: offset counts child nodes.
  const el = node as Element;
  const child = el.childNodes[offset] as Element | undefined;
  if (child && child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).dataset?.start) {
    return Number((child as HTMLElement).dataset.start);
  }
  const host = el.closest('[data-start]') as HTMLElement | null;
  if (host && container.contains(host)) return Number(host.dataset.start) + (offset > 0 ? (host.textContent?.length ?? 0) : 0);
  return null;
}
