import type { Annotation, ProjectedAnnotation, SearchResponse } from '@statehouse/core/types';
import type { DiffSegment, DiffStats, SideBySideRow } from '@statehouse/core/diff';

export interface Facets {
  sessions: string[];
  statuses: { value: string; count: number }[];
}

export interface BillDetail {
  billId: string;
  label: string;
  session: string;
  status: string;
  currentStatus: string | null;
  currentLocation: string | null;
  title: string | null;
  subject: string | null;
  latestVersionId: string | null;
  versions: { versionId: string; versionNum: number; actionDate: string | null; action: string; words: number }[];
  sponsors: { name: string; house: string; contribution: string; versionId: string }[];
  actions: { actionId: string; actionDate: string | null; action: string; sequence: number | null }[];
}

export interface DiffResponse {
  billId: string;
  from: string;
  to: string;
  stats: DiffStats;
  segments: DiffSegment[];
  rows: SideBySideRow[];
}

export interface ActivityPoint {
  month: string;
  actions: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface SearchQuery {
  q: string;
  session?: string;
  status?: string;
  sponsor?: string;
  subject?: string;
}

export function searchBills(query: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  return request(`/api/search?${params}`, { signal });
}

export const getFacets = () => request<Facets>('/api/facets');
export const getActivity = (billId?: string) => request<ActivityPoint[]>(`/api/activity${billId ? `?billId=${encodeURIComponent(billId)}` : ''}`);
export const getBill = (billId: string) => request<BillDetail>(`/api/bills/${encodeURIComponent(billId)}`);
export const getVersionText = (billId: string, versionId: string) =>
  request<{ versionId: string; text: string }>(`/api/bills/${encodeURIComponent(billId)}/versions/${encodeURIComponent(versionId)}`);
export const getDiff = (billId: string, from: string, to: string) =>
  request<DiffResponse>(`/api/bills/${encodeURIComponent(billId)}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
export const listAnnotations = (billId: string, versionId: string) =>
  request<ProjectedAnnotation[]>(`/api/bills/${encodeURIComponent(billId)}/annotations?versionId=${encodeURIComponent(versionId)}`);
export const createAnnotation = (
  billId: string,
  body: { versionId: string; startOffset: number; endOffset: number; note: string; author: string },
) => request<Annotation>(`/api/bills/${encodeURIComponent(billId)}/annotations`, { method: 'POST', body: JSON.stringify(body) });
export const deleteAnnotation = (id: string) => request<{ ok: boolean }>(`/api/annotations/${encodeURIComponent(id)}`, { method: 'DELETE', headers: {} });
