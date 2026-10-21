/** Bun SQLite adapter. Async operations share a queue so a transaction owns the connection across awaits. */
import { Database } from 'bun:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getDatabaseFilePath } from '../config/paths'
import { logger } from '../logger'

export interface RunResult {
  lastID: number
  changes: number
}

export interface AsyncStatement {
  run: (params?: unknown) => Promise<RunResult>
  get: <T = unknown>(params?: unknown) => Promise<T | undefined>
  all: <T = unknown>(params?: unknown) => Promise<T[]>
  finalize: () => Promise<void>
}

export interface AsyncDatabase {
  prepare: (sql: string) => AsyncStatement
  exec: (sql: string) => Promise<void>
  run: (sql: string, params?: unknown) => Promise<RunResult>
  get: <T = unknown>(sql: string, params?: unknown) => Promise<T | undefined>
  all: <T = unknown>(sql: string, params?: unknown) => Promise<T[]>
  transaction: <T>(fn: () => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

function wrapDatabase(raw: Database): AsyncDatabase {
  const context = new AsyncLocalStorage<{ active: boolean }>()
  let tail: Promise<unknown> = Promise.resolve()
  function schedule<T>(fn: () => T | Promise<T>): Promise<T> {
    if (context.getStore()?.active)
      return Promise.resolve().then(fn)
    const result = tail.then(fn)
    tail = result.catch(() => {})
    return result
  }
  function statement(sql: string): AsyncStatement {
    // Preparation also happens on the connection queue, after any pending schema changes.
    let stmt: ReturnType<Database['prepare']> | undefined
    let finalized = false
    function invoke(method: 'run' | 'get' | 'all', params?: unknown): any {
      if (finalized) throw new Error('Statement already finalized')
      stmt ??= raw.prepare(sql)
      const args = params === undefined ? [] : Array.isArray(params) ? params : [params]
      return (stmt[method] as Function).apply(stmt, args)
    }
    return {
      run: params => schedule(() => {
        const result = invoke('run', params)
        return { lastID: Number(result.lastInsertRowid), changes: result.changes }
      }),
      get: <T>(params?: unknown) => schedule(() => (invoke('get', params) ?? undefined) as T | undefined),
      all: <T>(params?: unknown) => schedule(() => invoke('all', params) as T[]),
      finalize: () => schedule(() => { stmt?.finalize(); finalized = true }),
    }
  }
  async function once<T>(sql: string, fn: (stmt: AsyncStatement) => Promise<T>): Promise<T> {
    const stmt = statement(sql)
    try { return await fn(stmt) }
    finally { await stmt.finalize() }
  }
  const db: AsyncDatabase = {
    prepare: statement,
    exec: sql => schedule(() => { raw.exec(sql) }),
    run: (sql, params) => once(sql, stmt => stmt.run(params)),
    get: <T>(sql: string, params?: unknown) => once(sql, stmt => stmt.get<T>(params)),
    all: <T>(sql: string, params?: unknown) => once(sql, stmt => stmt.all<T>(params)),
    transaction: <T>(fn: () => Promise<T>): Promise<T> => {
      if (context.getStore()?.active)
        return Promise.reject(new Error('Nested transactions are not supported'))
      return schedule(() => context.run({ active: true }, async () => {
        const owner = context.getStore()!
        raw.exec('BEGIN')
        try {
          const result = await fn()
          raw.exec('COMMIT')
          return result
        }
        catch (error) {
          raw.exec('ROLLBACK')
          throw error
        }
        finally { owner.active = false }
      }))
    },
    close: () => schedule(() => { raw.close() }),
  }
  return db
}

let db: AsyncDatabase | null = null
let dbPath: string | null = null

export function resolveAgentDatabasePath(): string {
  return getDatabaseFilePath()
}

async function initializeSchema(database: AsyncDatabase): Promise<void> {
  // WAL 模式 + 性能 pragmas
  await database.exec('PRAGMA journal_mode = WAL')
  await database.exec('PRAGMA synchronous = NORMAL')
  await database.exec('PRAGMA foreign_keys = ON')
  await database.exec('PRAGMA busy_timeout = 5000')

  await database.exec(`
    CREATE TABLE IF NOT EXISTS agent_blobs (
      blob_id TEXT PRIMARY KEY,
      blob_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_checkpoints (
      conversation_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'committed',
      root_blob_ids_json TEXT NOT NULL,
      turn_blob_ids_json TEXT NOT NULL DEFAULT '[]',
      summary_archive_ids_json TEXT NOT NULL,
      used_tokens INTEGER NOT NULL,
      max_tokens INTEGER NOT NULL,
      mode TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_blobs_last_accessed_at
      ON agent_blobs(last_accessed_at);

    CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_updated_at
      ON conversation_checkpoints(updated_at);

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      truncation_bubble_id_inclusive TEXT NOT NULL,
      resume_bubble_id_inclusive TEXT NOT NULL,
      previous_summary_bubble_id TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      includes_tool_results INTEGER NOT NULL,
      strategy TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, kind, truncation_bubble_id_inclusive)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_lookup
      ON conversation_summaries(conversation_id, kind, updated_at DESC);
  `)

  // ── Schema 迁移: conversation_checkpoints 新增 kind 列 ──
  // 旧表 PRIMARY KEY 是 conversation_id (单列), 新表需要 (conversation_id, kind) 复合键。
  // SQLite 不支持 ALTER PRIMARY KEY, 只能重建表。
  try {
    await database.get(`SELECT kind FROM conversation_checkpoints LIMIT 1`)
  }
  catch {
    // kind 列不存在 → 旧 schema, 需要迁移
    await database.exec(`
      ALTER TABLE conversation_checkpoints RENAME TO conversation_checkpoints_old;
      CREATE TABLE conversation_checkpoints (
        conversation_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'committed',
        root_blob_ids_json TEXT NOT NULL,
        turn_blob_ids_json TEXT NOT NULL DEFAULT '[]',
        summary_archive_ids_json TEXT NOT NULL,
        used_tokens INTEGER NOT NULL,
        max_tokens INTEGER NOT NULL,
        mode TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, kind)
      );
      INSERT INTO conversation_checkpoints
        SELECT conversation_id, 'committed', root_blob_ids_json, '[]', summary_archive_ids_json,
               used_tokens, max_tokens, mode, updated_at
        FROM conversation_checkpoints_old;
      DROP TABLE conversation_checkpoints_old;
    `)
  }

  // ── Schema 迁移: conversation_checkpoints 新增 turn_blob_ids_json 列 ──
  try {
    await database.get(`SELECT turn_blob_ids_json FROM conversation_checkpoints LIMIT 1`)
  }
  catch {
    await database.exec(`
      ALTER TABLE conversation_checkpoints
      ADD COLUMN turn_blob_ids_json TEXT NOT NULL DEFAULT '[]';
    `)
  }
}

export async function initDatabase(): Promise<void> {
  const nextPath = resolveAgentDatabasePath()
  if (db && dbPath === nextPath) return
  await closeAgentDatabase()
  mkdirSync(dirname(nextPath), { recursive: true })
  const next = wrapDatabase(new Database(nextPath, { create: true }))
  try { await initializeSchema(next) }
  catch (error) { await next.close(); throw error }
  db = next
  dbPath = nextPath
  logger.info({ agentDbPath: nextPath }, '[DB] agent sqlite persistence ready')
}

export function getAgentDatabase(): AsyncDatabase {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}

export async function closeAgentDatabase(): Promise<void> {
  if (!db) return
  const current = db
  db = null
  dbPath = null
  await current.close()
}

export async function resetAgentDatabaseForTests(): Promise<void> {
  await closeAgentDatabase()
  await initDatabase()
}
