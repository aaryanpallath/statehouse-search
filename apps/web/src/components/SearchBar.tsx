'use client';
import type { ChangeEvent } from 'react';

export interface SearchFiltersValue {
  q: string;
  session: string;
  status: string;
  sponsor: string;
  subject: string;
}

export interface SearchBarProps {
  value: SearchFiltersValue;
  onChange: (value: SearchFiltersValue) => void;
  sessions: string[];
  statuses: { value: string; count: number }[];
  loading?: boolean;
  /** Summary line, e.g. "12 results in 38 ms (hybrid)". */
  summary?: string;
}

export function SearchBar({ value, onChange, sessions, statuses, loading, summary }: SearchBarProps) {
  const set = (key: keyof SearchFiltersValue) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [key]: e.target.value });
  return (
    <div className="searchbar" role="search">
      <input
        className="input searchbar-input"
        type="search"
        placeholder="Search California bills, e.g. wildfire insurance, tenant protections…"
        aria-label="Search bills"
        value={value.q}
        onChange={set('q')}
        autoFocus
      />
      <div className="searchbar-filters">
        <select className="select" aria-label="Session" value={value.session} onChange={set('session')}>
          <option value="">All sessions</option>
          {sessions.map((s) => (
            <option key={s} value={s}>{`${s.slice(0, 4)}–${s.slice(4)}`}</option>
          ))}
        </select>
        <select className="select" aria-label="Status" value={value.status} onChange={set('status')}>
          <option value="">Any status</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>{`${s.value} (${s.count})`}</option>
          ))}
        </select>
        <input className="input" aria-label="Sponsor" placeholder="Sponsor (author)" value={value.sponsor} onChange={set('sponsor')} />
        <input className="input" aria-label="Subject" placeholder="Subject contains…" value={value.subject} onChange={set('subject')} />
      </div>
      <div className="searchbar-meta muted" aria-live="polite">
        <span>{loading ? 'Searching…' : summary}</span>
      </div>
    </div>
  );
}
