'use client';
import { useEffect, useState } from 'react';
import type { SearchResponse } from '@statehouse/core/types';
import { SearchBar, type SearchFiltersValue } from '../src/components/SearchBar';
import { ResultCard } from '../src/components/ResultCard';
import { ActivityChart } from '../src/components/ActivityChart';
import { getActivity, getFacets, searchBills, type ActivityPoint, type Facets } from '../src/lib/api';
import { useDebounced } from '../src/lib/useDebounced';

const EMPTY: SearchFiltersValue = { q: '', session: '', status: '', sponsor: '', subject: '' };

export default function SearchPage() {
  const [filters, setFilters] = useState<SearchFiltersValue>(EMPTY);
  const debounced = useDebounced(filters, 250);
  const [facets, setFacets] = useState<Facets>({ sessions: [], statuses: [] });
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('q');
    if (initial) setFilters((f) => ({ ...f, q: initial }));
    getFacets().then(setFacets).catch((e: Error) => setError(e.message));
    getActivity().then(setActivity).catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    searchBills(debounced, ctrl.signal)
      .then((r) => {
        setResponse(r);
        setError(null);
        const url = debounced.q ? `?q=${encodeURIComponent(debounced.q)}` : window.location.pathname;
        window.history.replaceState(null, '', url);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced]);

  const summary = response
    ? `${response.results.length} result${response.results.length === 1 ? '' : 's'} in ${response.tookMs} ms · ${
        response.query ? (response.semantic ? 'hybrid (keyword + semantic, RRF)' : 'keyword only') : 'browsing'
      }`
    : '';

  return (
    <main className="grid-2">
      <section>
        <SearchBar value={filters} onChange={setFilters} sessions={facets.sessions} statuses={facets.statuses} loading={loading} summary={summary} />
        {error && <p className="badge badge-danger" role="alert">{error}</p>}
        <ul className="result-list">
          {response?.results.map((r) => (
            <ResultCard key={r.billId} result={r} href={`/bills/${r.billId}${response.query ? `?q=${encodeURIComponent(response.query)}` : ''}`} />
          ))}
        </ul>
      </section>
      <aside>
        <ActivityChart data={activity} title="Corpus activity: legislative actions per month" />
      </aside>
    </main>
  );
}
