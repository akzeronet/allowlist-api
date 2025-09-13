import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || 'data/data.db';
const db = new Database(DB_PATH, { readonly: false, fileMustExist: false });

// PRAGMA para rendimiento/estabilidad
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 4000');
db.pragma('foreign_keys = ON');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('cache_size = -20000');

// Esquema base
db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL,
  email     TEXT NOT NULL UNIQUE,
  panelUrl  TEXT NOT NULL,
  token     TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  mm_uid    TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_username ON entries(username);
CREATE INDEX IF NOT EXISTS idx_entries_mm_uid   ON entries(mm_uid);
`);

// Migraciones (idempotentes)
try { db.exec(`ALTER TABLE entries ADD COLUMN active INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE entries ADD COLUMN mm_uid TEXT`); } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_mm_uid ON entries(mm_uid)`); } catch {}

export default db;
