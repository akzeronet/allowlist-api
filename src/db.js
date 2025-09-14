// src/db.js
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || 'data/data.db';
const db = new Database(DB_PATH, { readonly: false, fileMustExist: false });

// Rendimiento/consistencia
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 4000');
db.pragma('foreign_keys = ON');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('cache_size = -20000');

// Esquema entries (como lo tenías)
db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL UNIQUE,
  email     TEXT NOT NULL UNIQUE,
  panelUrl  TEXT NOT NULL,
  token     TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  mm_uid    TEXT UNIQUE,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_username ON entries(username);
CREATE INDEX IF NOT EXISTS idx_entries_email    ON entries(email);
CREATE INDEX IF NOT EXISTS idx_entries_mm_uid   ON entries(mm_uid);
`);

// Esquema api_keys (multi-keys con scopes)
db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kid        TEXT NOT NULL UNIQUE,            -- identificador público (p.ej. ak_xxx)
  secretHash TEXT NOT NULL,                   -- sha256 del secreto (no se guarda en claro)
  scopes     TEXT NOT NULL,                   -- CSV: "read,write"
  active     INTEGER NOT NULL DEFAULT 1,
  createdAt  TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_kid ON api_keys(kid);
`);

// Exports para api_keys
export const keySelectByKid = db.prepare('SELECT * FROM api_keys WHERE kid=?');
export const keyInsert = db.prepare(`
  INSERT INTO api_keys (name, kid, secretHash, scopes, active)
  VALUES (@name, @kid, @secretHash, @scopes, @active)
`);
export const keyUpdate = db.prepare(`
  UPDATE api_keys SET
    name    = COALESCE(@name, name),
    scopes  = COALESCE(@scopes, scopes),
    active  = COALESCE(@active, active),
    updatedAt = datetime('now')
  WHERE id=@id
`);
export const keyList = db.prepare('SELECT id,name,kid,scopes,active,createdAt,updatedAt FROM api_keys ORDER BY createdAt DESC');
export const keyDelete = db.prepare('DELETE FROM api_keys WHERE id=?');

export default db;
