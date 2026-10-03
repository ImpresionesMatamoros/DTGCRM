import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `pg` is server-only; keep it out of the bundler graph.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
