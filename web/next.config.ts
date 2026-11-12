import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    agentUpgrade: 'security',
  },
  headers: async () => [
    {
      source: '/data/latest.json',
      headers: [{ key: 'Cache-Control', value: 'no-cache' }],
    },
    {
      source: '/data/:snapshot/:file',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      source: '/data/:snapshot/:dir/:file',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};

export default nextConfig;
