'use client';
import { useState, type FormEvent } from 'react';
import type { AnchorStatus, ProjectedAnnotation } from '@statehouse/core/types';

export interface PendingSelection {
  start: number;
  end: number;
  quote: string;
}

export interface AnnotationPanelProps {
  annotations: ProjectedAnnotation[];
  selection: PendingSelection | null;
  author: string;
  onAuthorChange: (author: string) => void;
  onCreate: (note: string) => Promise<void> | void;
  onDelete: (id: string) => void;
  onFocus: (id: string) => void;
  activeId?: string | null;
  connected: boolean;
  peers: number;
  error?: string | null;
}

const STATUS_LABEL: Record<AnchorStatus, { text: string; cls: string; title: string }> = {
  exact: { text: 'anchored', cls: 'badge-ok', title: 'Passage found at the same position' },
  moved: { text: 're-anchored', cls: 'badge-ok', title: 'Passage unchanged but moved in this version' },
  changed: { text: 'passage changed', cls: 'badge-warning', title: 'The annotated passage was edited in this version — review the note' },
  orphaned: { text: 'passage removed', cls: 'badge-danger', title: 'The annotated passage no longer exists in this version' },
};

/** Sidebar listing annotations (with re-anchoring status) and a form to annotate the current selection. */
export function AnnotationPanel(props: AnnotationPanelProps) {
  const { annotations, selection, author, onAuthorChange, onCreate, onDelete, onFocus, activeId, connected, peers, error } = props;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selection || !note.trim() || !author.trim()) return;
    setBusy(true);
    try {
      await onCreate(note);
      setNote('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="annotation-panel card" aria-label="Annotations">
      <div className="result-meta">
        <strong>Annotations ({annotations.length})</strong>
        <span className="muted" title="Live sync over WebSocket">
          <span className={`live-dot${connected ? ' on' : ''}`} />
          {connected ? `live · ${peers} tab${peers === 1 ? '' : 's'} viewing` : 'offline'}
        </span>
      </div>
      <form className="annotation-form" onSubmit={submit}>
        <input className="input" aria-label="Your name" placeholder="Your name" value={author} onChange={(e) => onAuthorChange(e.target.value)} />
        {selection ? (
          <blockquote className="annotation-quote">{selection.quote.length > 160 ? `${selection.quote.slice(0, 160)}…` : selection.quote}</blockquote>
        ) : (
          <p className="muted">Select a passage in the bill text to annotate it.</p>
        )}
        <textarea className="textarea" rows={3} aria-label="Note" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} disabled={!selection} />
        <button className="btn btn-primary" type="submit" disabled={!selection || !note.trim() || !author.trim() || busy}>
          Add annotation
        </button>
        {error && <p className="badge badge-danger" role="alert">{error}</p>}
      </form>
      <ul className="annotation-list">
        {annotations.map((a) => {
          const s = STATUS_LABEL[a.anchor.status];
          return (
            <li key={a.id} className={`annotation-item${activeId === a.id ? ' active' : ''}`} onClick={() => onFocus(a.id)}>
              <div className="result-meta">
                <strong>{a.author}</strong>
                <span className={`badge ${s.cls}`} title={s.title}>{s.text}</span>
                {a.versionId !== a.viewVersionId && <span className="muted">from another version</span>}
              </div>
              <blockquote className="annotation-quote">{a.quote.length > 140 ? `${a.quote.slice(0, 140)}…` : a.quote}</blockquote>
              {a.anchor.status === 'changed' && a.anchor.currentText && (
                <p className="muted">Now reads: “{a.anchor.currentText.slice(0, 140)}”</p>
              )}
              <p>{a.note}</p>
              <button
                className="btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(a.id);
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
