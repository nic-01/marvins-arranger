import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: {
    // We'll fix types incrementally
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
