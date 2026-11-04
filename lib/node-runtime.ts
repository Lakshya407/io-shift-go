// Node.js stand-in for the `cloudflare:workers` module, used ONLY by the
// self-hosted build (`npm run build:node`, e.g. AWS EC2). vite.config.ts
// aliases `cloudflare:workers` to this file when SHIFTGO_TARGET=node; the
// Cloudflare build never includes it.
//
// It provides:
//   env.DB      – a D1-compatible database adapter:
//                   DATABASE_URL set  → PostgreSQL (lib/postgres.ts, migrations in db/migrations-pg)
//                   otherwise         → a local SQLite file at DATABASE_PATH (node:sqlite)
//   env.<NAME>  – values from process.env (SETUP_TOKEN, SITE_URL, …)
//   waitUntil   – fire-and-forget background work with error logging
// and, once the database is first opened, it applies pending migrations and
// runs the every-minute maintenance tick (replaces the Cloudflare cron).
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { PostgresD1, configurePgTypes, migratePostgres } from './postgres';

// Same migration files and tracking table as worker/index.ts, so a database
// can move between the Cloudflare and Node builds.
const migrationFiles = import.meta.glob('../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const postgresMigrations = import.meta.glob('../db/migrations-pg/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

type Value = null | number | bigint | string | Uint8Array;

function bindable(value: unknown): Value {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: Type undefined is not supported as a bind value.');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as Value;
}

class SqliteD1 {
  private cache = new Map<string, StatementSync>();
  constructor(readonly raw: DatabaseSync) {}
  compiled(sql: string) {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.cache.set(sql, stmt);
    }
    return stmt;
  }
  prepare(sql: string) {
    return new Statement(this, sql);
  }
  /** Runs all statements in one transaction, synchronously, so no other request can interleave. */
  async batch(statements: Statement[]) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((s) => s.runSync());
      this.raw.exec('COMMIT');
      return results;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }
  async exec(sql: string) {
    this.raw.exec(sql);
    return { count: 0, duration: 0 };
  }
}

class Statement {
  constructor(private db: SqliteD1, private sql: string, private args: Value[] = []) {}
  bind(...args: unknown[]) {
    return new Statement(this.db, this.sql, args.map(bindable));
  }
  async first(column?: string) {
    const row = this.db.compiled(this.sql).get(...this.args) as Record<string, unknown> | undefined;
    if (!row) return null;
    return column ? (row[column] ?? null) : row;
  }
  async all() {
    const results = this.db.compiled(this.sql).all(...this.args);
    return { results, success: true, meta: { changes: 0 } };
  }
  async run() {
    return this.runSync();
  }
  runSync() {
    const r = this.db.compiled(this.sql).run(...this.args);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

function migrate(raw: DatabaseSync) {
  raw.exec('CREATE TABLE IF NOT EXISTS nightshift_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (raw.prepare('SELECT name FROM nightshift_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const files = Object.keys(migrationFiles).sort();
  // Adopt databases whose initial schema was created without a tracking row.
  if (!applied.size && files.length) {
    const existing = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'").get();
    if (existing) {
      const first = files[0].split('/').pop()!;
      raw.prepare('INSERT INTO nightshift_migrations (name, applied_at) VALUES (?, ?)').run(first, new Date().toISOString());
      applied.add(first);
    }
  }
  for (const file of files) {
    const name = file.split('/').pop()!;
    if (applied.has(name)) continue;
    const statements = migrationFiles[file]
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    raw.exec('BEGIN IMMEDIATE');
    try {
      for (const sql of statements) raw.exec(sql);
      raw.prepare('INSERT INTO nightshift_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
    console.log(`ShiftGo: applied migration ${name}`);
  }
}

function startMaintenance() {
  if (process.env.SHIFTGO_DISABLE_TICK === '1') return;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    import('./notifications')
      .then((m) => m.tick())
      .catch((e) => console.error('ShiftGo maintenance failed', e))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(run, 5_000).unref();
  setInterval(run, 60_000).unref();
}

type Global = typeof globalThis & { __shiftgoDb?: SqliteD1 | PostgresD1 };

function postgresDatabase(url: string): PostgresD1 {
  configurePgTypes(pg.types);
  const ssl = process.env.DATABASE_SSL;
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // DATABASE_SSL=require → TLS with certificate verification; =no-verify → TLS without it
    // (e.g. managed databases with a private CA). Unset → as given in DATABASE_URL.
    ...(ssl === 'require' ? { ssl: { rejectUnauthorized: true } } : ssl === 'no-verify' ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  pool.on('error', (e) => console.error('ShiftGo: idle PostgreSQL connection error', e.message));
  const ready = migratePostgres(pool, postgresMigrations).then(
    () => {
      console.log('ShiftGo: PostgreSQL database ready');
      startMaintenance();
    },
    (error) => {
      // Let the next request retry instead of keeping a broken adapter forever.
      console.error('ShiftGo: PostgreSQL migration/connection failed', error);
      delete (globalThis as Global).__shiftgoDb;
      void pool.end().catch(() => {});
      throw error;
    },
  );
  ready.catch(() => {});
  return new PostgresD1(pool, ready);
}

function sqliteDatabase(): SqliteD1 {
  const file = resolve(process.env.DATABASE_PATH || 'data/shiftgo.db');
  mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  migrate(raw);
  const db = new SqliteD1(raw);
  console.log(`ShiftGo: SQLite database ready at ${file}`);
  startMaintenance();
  return db;
}

function database(): SqliteD1 | PostgresD1 {
  const g = globalThis as Global;
  if (g.__shiftgoDb) return g.__shiftgoDb;
  const url = process.env.DATABASE_URL?.trim();
  // Kubernetes sets SHIFTGO_REQUIRE_POSTGRES=1: never fall back to a SQLite file inside an
  // ephemeral container. /api/health then fails, so the pod is never marked ready.
  if (!url && process.env.SHIFTGO_REQUIRE_POSTGRES === '1') {
    throw new Error('DATABASE_URL is not set (required because SHIFTGO_REQUIRE_POSTGRES=1).');
  }
  g.__shiftgoDb = url ? postgresDatabase(url) : sqliteDatabase();
  return g.__shiftgoDb;
}

export const env = new Proxy({} as Record<string, unknown>, {
  get(_target, key) {
    if (key === 'DB') return database();
    return typeof key === 'string' ? process.env[key] : undefined;
  },
  has(_target, key) {
    return key === 'DB' || (typeof key === 'string' && key in process.env);
  },
});

export function waitUntil(promise: Promise<unknown>) {
  promise.catch((e) => console.error('ShiftGo background task failed', e));
}
