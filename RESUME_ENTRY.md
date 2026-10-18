# Statehouse — Legislation Search & Collaborative Annotation
Tech: TypeScript, Next.js, React, Node.js, Fastify, PostgreSQL, pgvector, WebSockets, Docker, GitHub Actions
- Built a full-stack TypeScript platform over 300 California bills (1,179 versions) with hybrid keyword + semantic search on Postgres/pgvector, fusing rankings with reciprocal rank fusion.
- Reached 15 ms p95 end-to-end search latency over 8,675 embedded chunks; semantic retrieval answered 44 of 200 benchmark queries that keyword search alone missed.
- Implemented word-level diffs between bill versions and real-time collaborative annotations over WebSockets that re-anchor or flag notes when an amendment rewrites the passage.
- Shipped with 45 offline tests, a Storybook component library with shared design tokens, Docker Compose, and GitHub Actions CI.
