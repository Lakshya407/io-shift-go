import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted Node build (`npm run build:node`) emits a self-contained
  // server in dist/standalone. The Cloudflare build is unaffected.
  ...(process.env.SHIFTGO_TARGET === "node" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
