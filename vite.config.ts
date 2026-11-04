import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig } from "vite";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";

// Two build targets:
//   default            → Cloudflare Workers (worker name, D1 binding, cron in ./wrangler.jsonc)
//   SHIFTGO_TARGET=node → self-hosted Node.js server (AWS EC2 etc.), see `npm run build:node`.
//                        `cloudflare:workers` is replaced by lib/node-runtime.ts (SQLite + process.env).
const nodeTarget = process.env.SHIFTGO_TARGET === "node";

export default defineConfig(async () => {
  if (nodeTarget) {
    return {
      server: { host: process.env.HOST || "127.0.0.1" },
      resolve: {
        alias: {
          "cloudflare:workers": fileURLToPath(new URL("./lib/node-runtime.ts", import.meta.url)),
        },
      },
      plugins: [vinext()],
    };
  }

  configureToolEnvironment(process.cwd());

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: { host: process.env.HOST || "127.0.0.1" },
    plugins: [
      vinext(),
      cloudflare({
        configPath: "./wrangler.jsonc",
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
      }),
    ],
  };
});
