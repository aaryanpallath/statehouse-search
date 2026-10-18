import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../src/styles/tokens.css';
import '../src/styles/components.css';

export const metadata: Metadata = {
  title: 'Statehouse — California legislation search',
  description: 'Hybrid semantic search, version diffs and collaborative annotations over California bills.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page">
          <header className="site-header">
            <h1>
              <a href="/">Statehouse</a>
            </h1>
            <span className="muted">California bills · hybrid search · version diffs · live annotations</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
