import type { NextConfig } from 'next';

// REST calls go through same-origin /api/* and are proxied to the Node API; the WebSocket connects
// to the API directly (NEXT_PUBLIC_WS_URL).
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
