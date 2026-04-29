import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    styledComponents: true,
  },
  allowedDevOrigins: ['10.50.70.91', 'localhost', '127.0.0.1'],
};

export default nextConfig;
