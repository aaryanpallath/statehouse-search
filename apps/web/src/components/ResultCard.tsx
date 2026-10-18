import type { SearchResult } from '@statehouse/core/types';

export interface ResultCardProps {
  result: SearchResult;
  href: string;
}

/** One ranked bill with its highlighted snippet and which retriever(s) found it. */
export function ResultCard({ result, href }: ResultCardProps) {
  return (
    <li className="card result-card">
      <h3>
        <a href={href}>
          {result.label}
          {result.title ? ` — ${result.title}` : ''}
        </a>
      </h3>
      <div className="result-meta">
        <span className="badge">{result.status}</span>
        {result.subject && <span className="muted">{result.subject}</span>}
      </div>
      {result.snippet.length > 0 && (
        <p className="snippet">
          {result.snippet.map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
        </p>
      )}
      <div className="result-meta muted">
        {result.sponsors.length > 0 && <span>By {result.sponsors.join(', ')}</span>}
        <span title="Reciprocal rank fusion score">RRF {result.score.toFixed(4)}</span>
        <span>
          {result.ftsRank ? `keyword #${result.ftsRank}` : 'no keyword match'}
          {' · '}
          {result.vectorRank ? `semantic #${result.vectorRank}` : 'semantic —'}
        </span>
      </div>
    </li>
  );
}
