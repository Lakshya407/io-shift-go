import handler from "vinext/server/fetch-handler";
import { tick } from "../lib/notifications";

// All Drizzle migrations, bundled as raw SQL. Applied in filename order on first request.
const migrationFiles = import.meta.glob("../drizzle/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

let schemaReady = false;
let lastTick = 0;
const TICK_INTERVAL_MS = 60_000;

async function migrate(db: D1Database) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS nightshift_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)",
    )
    .run();
  const applied = new Set(
    ((await db.prepare("SELECT name FROM nightshift_migrations").all()).results as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const files = Object.keys(migrationFiles).sort();

  // Databases created earlier with `wrangler d1 execute --file drizzle/0000_*.sql`
  // already have the tables but no tracking row: adopt the initial migration.
  if (!applied.size && files.length) {
    const existing = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'")
      .first();
    if (existing) {
      const first = files[0].split("/").pop()!;
      await db
        .prepare("INSERT INTO nightshift_migrations (name, applied_at) VALUES (?, ?)")
        .bind(first, new Date().toISOString())
        .run();
      applied.add(first);
    }
  }

  for (const file of files) {
    const name = file.split("/").pop()!;
    if (applied.has(name)) continue;
    const statements = migrationFiles[file]
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s));
    statements.push(
      db.prepare("INSERT INTO nightshift_migrations (name, applied_at) VALUES (?, ?)").bind(name, new Date().toISOString()),
    );
    await db.batch(statements);
    console.log(`ShiftGo: applied migration ${name}`);
  }
}

// A boolean (not a shared Promise): workerd must not await promises created by
// another request's I/O context. Concurrent first requests may both migrate;
// a losing request re-checks and succeeds if the winner already applied it.
async function ensureSchema(env: Cloudflare.Env) {
  if (schemaReady || !env.DB) return;
  try {
    await migrate(env.DB);
  } catch (error) {
    if (!String(error).match(/already exists|UNIQUE/i)) throw error;
    await migrate(env.DB);
  }
  schemaReady = true;
}

/** Runs SOS reminder escalation and daily report generation. Idempotent. */
async function runMaintenance(env: Cloudflare.Env) {
  await ensureSchema(env);
  if (!env.DB) return;
  lastTick = Date.now();
  await tick();
}

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    await ensureSchema(env);
    // Opportunistic maintenance so reminders/reports also run where no cron
    // trigger fires (local dev, or if the cron is not configured).
    if (Date.now() - lastTick > TICK_INTERVAL_MS) {
      lastTick = Date.now();
      ctx.waitUntil(runMaintenance(env).catch((e) => console.error("ShiftGo maintenance failed", e)));
    }
    return handler.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(runMaintenance(env));
  },
};

export default worker;
