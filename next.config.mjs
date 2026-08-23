/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
