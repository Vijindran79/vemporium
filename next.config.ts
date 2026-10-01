import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.amazonaws.com' }],
  },
  // three.js is heavy and must stay client-side only.
  transpilePackages: ['three'],
  // Pin the tracing root to this project: a lockfile exists further up the
  // drive, and without this Next traces against the wrong one.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
