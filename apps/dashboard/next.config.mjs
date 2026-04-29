/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ["@ronan/shared-types"],
};

export default nextConfig;
