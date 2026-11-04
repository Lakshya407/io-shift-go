// D1-compatible adapter over PostgreSQL (node-postgres Pool), used by the
// self-hosted Node build when DATABASE_URL is set (see lib/node-runtime.ts).
//
// The app's SQL (lib/*.ts) is written once and runs unchanged on Cloudflare D1,
// SQLite and PostgreSQL. This adapter bridges the remaining differences:
//   - `?` placeholders            -> `$1, $2, …`
//   - booleans                    -> 1 / 0 (the schema stores flags as integers, as in SQLite)
//   - COUNT()/SUM() (int8/numeric)-> JS numbers instead of strings
//   - unique violations (23505)   -> an error whose text contains "UNIQUE", which the app
//                                    already uses to detect duplicates
//   - batch()                     -> one transaction on one connection
// Text columns use COLLATE "C" (db/migrations-pg), matching SQLite's byte-order
// comparisons, which the app relies on for ISO-8601 timestamp strings.
//
// Only types are imported from 'pg': the Pool is created by the caller, so this
// file can also be loaded by tests/backend.integration.mjs.
import type { Pool, PoolClient, QueryResult } from 'pg';

type Value = null | number | string | Uint8Array;
type Queryable = Pick<Pool | PoolClient, 'query'>;

function bindable(value: unknown): Value {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: Type undefined is not supported as a bind value.');
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return value.toString();
  return value as Value;
}

/** Converts `?` placeholders to `$n`, leaving quoted strings and identifiers untouched. */
export function toPostgresSql(sql: string) {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Postgres error → the same shape of message the app expects from SQLite/D1. */
function translate(error: unknown): unknown {
  const e = error as { code?: string; constraint?: string; message?: string };
  if (e?.code === '23505') {
    const wrapped = new Error(`UNIQUE constraint failed${e.constraint ? `: ${e.constraint}` : ''}`);
    (wrapped as Error & { cause?: unknown }).cause = error;
    return wrapped;
  }
  return error;
}

const cache = new Map<string, string>();
function compiled(sql: string) {
  let text = cache.get(sql);
  if (text === undefined) {
    text = toPostgresSql(sql);
    if (cache.size > 500) cache.clear();
    cache.set(sql, text);
  }
  return text;
}

async function execute(target: Queryable, sql: string, args: Value[]): Promise<QueryResult> {
  try {
    return await target.query({ text: compiled(sql), values: args });
  } catch (error) {
    throw translate(error);
  }
}

function runResult(r: QueryResult) {
  return { results: r.rows, success: true, meta: { changes: r.rowCount ?? 0, last_row_id: 0 } };
}

export class PostgresStatement {
  constructor(private db: PostgresD1, readonly sql: string, readonly args: Value[] = []) {}
  bind(...args: unknown[]) {
    return new PostgresStatement(this.db, this.sql, args.map(bindable));
  }
  async first(column?: string) {
    const r = await this.db.query(this.sql, this.args);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return column ? (row[column] ?? null) : row;
  }
  async all() {
    return runResult(await this.db.query(this.sql, this.args));
  }
  async run() {
    return runResult(await this.db.query(this.sql, this.args));
  }
}

export class PostgresD1 {
  /**
   * @param pool   node-postgres Pool (with int8/numeric parsed as numbers, see configurePgTypes)
   * @param ready  resolves once migrations have been applied; every query waits for it
   */
  constructor(readonly pool: Pool, private ready: Promise<unknown> = Promise.resolve()) {}

  async query(sql: string, args: Value[]) {
    await this.ready;
    return execute(this.pool, sql, args);
  }
  prepare(sql: string) {
    return new PostgresStatement(this, sql);
  }
  /** Runs all statements in one transaction, like D1's batch(). */
  async batch(statements: PostgresStatement[]) {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const s of statements) results.push(runResult(await execute(client, s.sql, s.args)));
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async exec(sql: string) {
    await this.ready;
    await this.pool.query(sql);
    return { count: 0, duration: 0 };
  }
}

/** COUNT(*) is int8 and SUM() may be numeric in Postgres; the app expects JS numbers (as from SQLite). */
export function configurePgTypes(types: { setTypeParser(oid: number, parse: (value: string) => unknown): void }) {
  types.setTypeParser(20, (v) => Number(v)); // int8
  types.setTypeParser(1700, (v) => Number(v)); // numeric
}

/**
 * Applies pending migrations (one transaction each) under an advisory lock, so
 * several app instances starting together never migrate concurrently.
 * Uses the same tracking table name as the SQLite/D1 builds.
 */
export async function migratePostgres(pool: Pool, files: Record<string, string>, log = console.log) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS nightshift_migrations (name TEXT COLLATE "C" PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
    );
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM nightshift_migrations')).rows.map((r) => r.name),
    );
    for (const file of Object.keys(files).sort()) {
      const name = file.split('/').pop()!;
      if (applied.has(name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(files[file]);
        await client.query('INSERT INTO nightshift_migrations (name, applied_at) VALUES ($1, $2)', [name, new Date().toISOString()]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      log(`ShiftGo: applied PostgreSQL migration ${name}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}
