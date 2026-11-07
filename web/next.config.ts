import type { NextConfig } from 'next';

const backend = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  // Self-contained build for the Docker image (node .next/standalone/server.js).
  output: 'standalone',
  // Proxy the Express API under the same origin as the site, so the session cookie
  // is first-party and there's no CORS to configure.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
