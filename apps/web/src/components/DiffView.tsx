'use client';
import { useState } from 'react';
import type { DiffSegment, DiffStats, SideBySideRow } from '@statehouse/core/diff';

export interface DiffViewProps {
  segments: DiffSegment[];
  rows: SideBySideRow[];
  stats: DiffStats;
  fromLabel: string;
  toLabel: string;
  initialMode?: 'side-by-side' | 'inline';
}

/** Word-level diff between two bill versions, rendered side-by-side or inline. */
export function DiffView({ segments, rows, stats, fromLabel, toLabel, initialMode = 'side-by-side' }: DiffViewProps) {
  const [mode, setMode] = useState(initialMode);
  const [changedOnly, setChangedOnly] = useState(false);
  const visibleRows = changedOnly ? rows.filter((r) => r.left.some((p) => p.op !== 'equal') || r.right.some((p) => p.op !== 'equal')) : rows;
  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <div className="tabs" role="tablist" aria-label="Diff layout">
          <button className="btn tab" role="tab" aria-selected={mode === 'side-by-side'} onClick={() => setMode('side-by-side')}>
            Side by side
          </button>
          <button className="btn tab" role="tab" aria-selected={mode === 'inline'} onClick={() => setMode('inline')}>
            Inline
          </button>
        </div>
        {mode === 'side-by-side' && (
          <label className="muted">
            <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Changed paragraphs only
          </label>
        )}
        <span className="badge badge-ok">+{stats.insertedWords} words</span>
        <span className="badge badge-danger">−{stats.deletedWords} words</span>
        <span className="badge">{stats.unchangedWords} unchanged</span>
      </div>
      {mode === 'inline' ? (
        <div className="card diff-inline" data-testid="diff-inline">
          {segments.map((s, i) =>
            s.op === 'insert' ? (
              <ins key={i} className="diff-ins">{s.text}</ins>
            ) : s.op === 'delete' ? (
              <del key={i} className="diff-del">{s.text}</del>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </div>
      ) : (
        <table className="card diff-table" data-testid="diff-side-by-side">
          <thead>
            <tr>
              <th>{fromLabel}</th>
              <th>{toLabel}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => {
              const changed = row.left.some((p) => p.op !== 'equal') || row.right.some((p) => p.op !== 'equal');
              return (
                <tr key={i} className={changed ? 'diff-row-changed' : undefined}>
                  <td className="diff-cell">
                    {row.left.map((p, j) => (p.op === 'delete' ? <del key={j} className="diff-del">{p.text}</del> : <span key={j}>{p.text}</span>))}
                  </td>
                  <td className="diff-cell">
                    {row.right.map((p, j) => (p.op === 'insert' ? <ins key={j} className="diff-ins">{p.text}</ins> : <span key={j}>{p.text}</span>))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
