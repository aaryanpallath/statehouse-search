'use client';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectedAnnotation } from '@statehouse/core/types';
import { ActivityChart } from '../../../src/components/ActivityChart';
import { AnnotationPanel, type PendingSelection } from '../../../src/components/AnnotationPanel';
import { BillText } from '../../../src/components/BillText';
import { DiffView } from '../../../src/components/DiffView';
import {
  createAnnotation,
  deleteAnnotation,
  getActivity,
  getBill,
  getDiff,
  getVersionText,
  listAnnotations,
  type ActivityPoint,
  type BillDetail,
  type DiffResponse,
} from '../../../src/lib/api';
import { useAnnotationSync } from '../../../src/lib/useAnnotationSync';

const versionLabel = (v: BillDetail['versions'][number]) => `${v.action}${v.actionDate ? ` (${v.actionDate})` : ''}`;

export default function BillPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = use(params);
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [tab, setTab] = useState<'text' | 'diff'>('text');
  const [versionId, setVersionId] = useState<string>('');
  const [text, setText] = useState('');
  const [annotations, setAnnotations] = useState<ProjectedAnnotation[]>([]);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [author, setAuthor] = useState('');
  const [diffFrom, setDiffFrom] = useState('');
  const [diffTo, setDiffTo] = useState('');
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAuthor(window.localStorage.getItem('statehouse.author') ?? '');
    getBill(billId)
      .then((b) => {
        setBill(b);
        const latest = b.latestVersionId ?? b.versions.at(-1)?.versionId ?? '';
        setVersionId(latest);
        setDiffFrom(b.versions[0]?.versionId ?? '');
        setDiffTo(latest);
      })
      .catch((e: Error) => setError(e.message));
    getActivity(billId).then(setActivity).catch(() => {});
  }, [billId]);

  useEffect(() => {
    if (!versionId) return;
    setSelection(null);
    getVersionText(billId, versionId).then((v) => setText(v.text)).catch((e: Error) => setError(e.message));
  }, [billId, versionId]);

  const refreshAnnotations = useCallback(() => {
    if (!versionId) return;
    listAnnotations(billId, versionId).then(setAnnotations).catch((e: Error) => setError(e.message));
  }, [billId, versionId]);
  useEffect(refreshAnnotations, [refreshAnnotations]);

  // Live sync: any tab's create/delete triggers a re-fetch so annotations are re-anchored for this view.
  const { connected, peers } = useAnnotationSync(billId, refreshAnnotations);

  useEffect(() => {
    if (tab !== 'diff' || !diffFrom || !diffTo) return;
    getDiff(billId, diffFrom, diffTo).then(setDiff).catch((e: Error) => setError(e.message));
  }, [tab, billId, diffFrom, diffTo]);

  const highlights = useMemo(
    () => annotations.filter((a) => a.anchor.start != null && a.anchor.end != null).map((a) => ({ id: a.id, start: a.anchor.start!, end: a.anchor.end! })),
    [annotations],
  );

  const onSelect = (range: { start: number; end: number } | null) =>
    setSelection(range ? { ...range, quote: text.slice(range.start, range.end) } : null);

  const onCreate = async (note: string) => {
    if (!selection) return;
    try {
      await createAnnotation(billId, { versionId, startOffset: selection.start, endOffset: selection.end, note, author });
      setSelection(null);
      setError(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onAuthorChange = (a: string) => {
    setAuthor(a);
    window.localStorage.setItem('statehouse.author', a);
  };

  const onFocus = (id: string) => {
    setActiveId(id);
    const ann = annotations.find((a) => a.id === id);
    if (ann?.anchor.start != null) document.querySelector(`[data-start="${ann.anchor.start}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (error && !bill) return <p className="badge badge-danger" role="alert">{error}</p>;
  if (!bill) return <p className="muted">Loading…</p>;
  const labelOf = (id: string) => {
    const v = bill.versions.find((x) => x.versionId === id);
    return v ? versionLabel(v) : id;
  };

  return (
    <main>
      <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h2 style={{ marginTop: 0 }}>
          {bill.label} — {bill.title}
        </h2>
        <div className="result-meta">
          <span className="badge">{bill.status}</span>
          {bill.currentStatus && <span className="muted">{bill.currentStatus}</span>}
          {bill.subject && <span className="muted">Subject: {bill.subject}</span>}
          <span className="muted">{bill.versions.length} versions</span>
        </div>
        {bill.sponsors.length > 0 && (
          <p className="muted">Authors: {bill.sponsors.filter((s) => s.contribution === 'LEAD_AUTHOR').map((s) => s.name).join(', ') || bill.sponsors[0]!.name}</p>
        )}
        <ActivityChart data={activity} title="Bill activity: recorded actions per month" />
      </section>

      <div className="tabs" role="tablist">
        <button className="btn tab" role="tab" aria-selected={tab === 'text'} onClick={() => setTab('text')}>
          Text &amp; annotations
        </button>
        <button className="btn tab" role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')} disabled={bill.versions.length < 2}>
          Compare versions
        </button>
      </div>

      {tab === 'text' ? (
        <div className="grid-2">
          <section>
            <label className="muted">
              Version{' '}
              <select className="select" style={{ width: 'auto' }} value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                {bill.versions.map((v) => (
                  <option key={v.versionId} value={v.versionId}>
                    {versionLabel(v)}
                  </option>
                ))}
              </select>
            </label>
            <BillText text={text} highlights={highlights} activeId={activeId} onSelect={onSelect} onHighlightClick={onFocus} />
          </section>
          <AnnotationPanel
            annotations={annotations}
            selection={selection}
            author={author}
            onAuthorChange={onAuthorChange}
            onCreate={onCreate}
            onDelete={(id) => void deleteAnnotation(id).catch((e: Error) => setError(e.message))}
            onFocus={onFocus}
            activeId={activeId}
            connected={connected}
            peers={peers}
            error={error}
          />
        </div>
      ) : (
        <section>
          <div className="diff-toolbar">
            <label className="muted">
              From{' '}
              <select className="select" style={{ width: 'auto' }} value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)}>
                {bill.versions.map((v) => (
                  <option key={v.versionId} value={v.versionId}>{versionLabel(v)}</option>
                ))}
              </select>
            </label>
            <label className="muted">
              To{' '}
              <select className="select" style={{ width: 'auto' }} value={diffTo} onChange={(e) => setDiffTo(e.target.value)}>
                {bill.versions.map((v) => (
                  <option key={v.versionId} value={v.versionId}>{versionLabel(v)}</option>
                ))}
              </select>
            </label>
          </div>
          {diff ? (
            <DiffView segments={diff.segments} rows={diff.rows} stats={diff.stats} fromLabel={labelOf(diff.from)} toLabel={labelOf(diff.to)} />
          ) : (
            <p className="muted">Computing diff…</p>
          )}
        </section>
      )}
    </main>
  );
}
