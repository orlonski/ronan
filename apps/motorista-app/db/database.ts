import * as SQLite from "expo-sqlite";

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync("ronan-motorista.db");
  await migrate(dbInstance);
  return dbInstance;
}

async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS cache_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_viagens (
      client_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      foto_uri TEXT,
      foto_mime TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_tried_at INTEGER,
      error_msg TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_pedagios (
      client_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_tried_at INTEGER,
      error_msg TEXT
    );
  `);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM cache_kv WHERE key = ?",
    key,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO cache_kv (key, value, cached_at) VALUES (?, ?, ?)",
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

export async function cacheDelete(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM cache_kv WHERE key = ?", key);
}
