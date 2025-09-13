import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || 'data/data.db';
const db = new Database(DB_PATH, { readonly: false, fileMustExist: false });

// PRAGMA para lecturas concurrentes (WAL) y escrituras estables
db.pragma('journal_mode = WAL');          // habilita WAL
db.pragma('synchronous = NORMAL');        // mejor balance seguridad/rendimiento
db.pragma('busy_timeout = 4000');         // espera si hay lock de escritura
db.pragma('foreign_keys = ON');
db.pragma('wal_autocheckpoint = 1000');   // checkpoint periódico
db.pragma('cache_size = -20000');         // ~20MB cache (negativo = KB)

db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL,
  email     TEXT NOT NULL UNIQUE,
  panelUrl  TEXT NOT NULL,
  token     TEXT NOT NULL,
  active    INTEGER NOT NULL DEFAULT 1,
  mm_uid    TEXT, UNIQUE,  -- 👈 nuevo (opcional, único no se debe multi-instancias)
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_username ON entries(username);
CREATE INDEX IF NOT EXISTS idx_entries_domain   ON entries(substr(email, instr(email, '@') + 1));
CREATE INDEX IF NOT EXISTS idx_entries_mm_uid   ON entries(mm_uid);
`);

export default db;
