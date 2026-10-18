'use client';
import { useMemo, useRef } from 'react';
import { domOffset, segmentByRanges, trimRange, type Range } from '../lib/highlight';

export interface BillTextProps {
  text: string;
  highlights: Range[];
  activeId?: string | null;
  onSelect: (range: { start: number; end: number } | null) => void;
  onHighlightClick?: (id: string) => void;
}

/**
 * Renders a bill version as spans tagged with their source offsets so a browser selection maps back
 * to exact character offsets (the anchor stored with an annotation).
 */
export function BillText({ text, highlights, activeId, onSelect, onHighlightClick }: BillTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => segmentByRanges(text.length, highlights), [text, highlights]);
  const handleMouseUp = () => {
    const sel = window.getSelection();
    const root = ref.current;
    if (!sel || sel.isCollapsed || !root || sel.rangeCount === 0) return onSelect(null);
    const r = sel.getRangeAt(0);
    const start = domOffset(root, r.startContainer, r.startOffset);
    const end = domOffset(root, r.endContainer, r.endOffset);
    if (start == null || end == null) return onSelect(null);
    onSelect(trimRange(text, start, end));
  };
  return (
    <div ref={ref} className="bill-text card" onMouseUp={handleMouseUp} data-testid="bill-text">
      {segments.map((s) =>
        s.ids.length ? (
          <mark
            key={s.start}
            data-start={s.start}
            className={activeId && s.ids.includes(activeId) ? 'active' : undefined}
            onClick={() => onHighlightClick?.(s.ids[0]!)}
          >
            {text.slice(s.start, s.end)}
          </mark>
        ) : (
          <span key={s.start} data-start={s.start}>
            {text.slice(s.start, s.end)}
          </span>
        ),
      )}
    </div>
  );
}
