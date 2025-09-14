// src/db.js
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || 'data/data.db';

// Abre/crea la base
const db = new Database(DB_PATH, { readonly: false, fileMustExist: false });

/**
 * PRAGMAs:
 * - WAL: lectores concurrentes y escrituras no bloquean lecturas.
 * - synchronous=NORMAL: buen balance seguridad/rendimiento.
 * - busy_timeout: espera si hay lock de escritura.
 * - wal_autocheckpoint: checkpoints periódicos.
 * - cache_size: ~20MB (negativo = KB).
 */
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 4000');
db.pragma('foreign_keys = ON');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('cache_size = -20000');

/**
 * Esquema “fresh install”
 * - username UNIQUE
 * - email    UNIQUE
 * - mm_uid   UNIQUE (permite múltiples NULL)
 */
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

-- Índices de apoyo (lookup rápidos)
CREATE INDEX IF NOT EXISTS idx_entries_username ON entries(username);
CREATE INDEX IF NOT EXISTS idx_entries_email    ON entries(email);
CREATE INDEX IF NOT EXISTS idx_entries_mm_uid   ON entries(mm_uid);
`);

export default db;
