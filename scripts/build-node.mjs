// Builds the self-hosted Node.js server (AWS EC2, any Linux VM) into dist/standalone.
// Start it with: node dist/standalone/server.js   (see deploy/ and docs/DEPLOY-AWS.md)
//
// vinext refuses a non-Cloudflare build while wrangler.jsonc is present, so the
// file is moved aside for the duration of the build and always restored.
import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wrangler = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const hidden = `${wrangler}.node-build`;

// Recover from an interrupted earlier build.
if (existsSync(hidden) && !existsSync(wrangler)) renameSync(hidden, wrangler);

const env = { ...process.env, SHIFTGO_TARGET: "node" };
const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

let status = run("./generate-dark-theme.mjs");
if (status === 0) {
  const moved = existsSync(wrangler);
  if (moved) renameSync(wrangler, hidden);
  const restore = () => {
    if (moved && existsSync(hidden)) renameSync(hidden, wrangler);
  };
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
  try {
    status = run("../node_modules/vinext/dist/cli.js", ["build", ...process.argv.slice(2)]);
  } finally {
    restore();
  }
}
process.exit(status);
