// Shared domain types used by the API, ingestion scripts and the web app.

export interface BillRecord {
  billId: string;
  session: string;
  measureType: string;
  measureNum: number;
  measureState: string;
  currentStatus: string | null;
  currentLocation: string | null;
  latestVersionId: string | null;
}

export interface SponsorRecord {
  versionId: string;
  name: string;
  house: string | null;
  contribution: string | null;
  authorType: string | null;
  isPrimary: boolean;
}

export interface ActionRecord {
  billId: string;
  actionId: string;
  actionDate: string | null;
  action: string;
  sequence: number | null;
  status: string | null;
}

export interface VersionRecord {
  versionId: string;
  billId: string;
  versionNum: number;
  actionDate: string | null;
  action: string;
  subject: string | null;
  title: string | null;
  digest: string | null;
  text: string;
}

/** Everything the ingestion pipeline needs for one bill. */
export interface BillBundle {
  bill: BillRecord;
  versions: VersionRecord[];
  sponsors: SponsorRecord[];
  actions: ActionRecord[];
}

export interface SearchFilters {
  session?: string;
  status?: string;
  sponsor?: string;
  subject?: string;
}

export interface SearchParams extends SearchFilters {
  q: string;
  limit?: number;
}

export interface SnippetPart {
  text: string;
  hit: boolean;
}

export interface SearchResult {
  billId: string;
  label: string;
  title: string | null;
  subject: string | null;
  status: string;
  session: string;
  sponsors: string[];
  score: number;
  ftsRank: number | null;
  vectorRank: number | null;
  snippet: SnippetPart[];
}

export interface SearchResponse {
  query: string;
  semantic: boolean;
  results: SearchResult[];
  tookMs: number;
}

export type AnchorStatus = 'exact' | 'moved' | 'changed' | 'orphaned';

export interface Annotation {
  id: string;
  billId: string;
  versionId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  prefix: string;
  suffix: string;
  note: string;
  author: string;
  createdAt: string;
}

/** An annotation as positioned within a (possibly different) version of the bill. */
export interface ProjectedAnnotation extends Annotation {
  viewVersionId: string;
  anchor: {
    status: AnchorStatus;
    start: number | null;
    end: number | null;
    currentText: string | null;
  };
}
