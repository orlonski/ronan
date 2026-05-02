import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // monorepo: rastreia deps a partir da raiz do workspace
  outputFileTracingRoot: path.join(__dirname, "../.."),
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ["@ronan/shared-types"],
};

export default nextConfig;
