import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import db from './db.js';
import { encryptWithKey, decryptWithKeys } from './crypto.js';
import { toRow, normEmail, validateBody, sanitizeEntryPayload } from './util.js';
// cambios xD
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';

// ====== Modo / entorno ======
const APP_MODE = process.env.APP_MODE || ''; // "1" prod, "2" dev (opcional)
if (APP_MODE === '1') process.env.NODE_ENV = 'production';
if (APP_MODE === '2') process.env.NODE_ENV = 'development';

// ====== Config ======
const app = express();
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || 'change-me';
const API_KEY_OLD = process.env.API_KEY_OLD || '';
const ENC_KEY = process.env.ENC_KEY || '';            // clave actual (hex 64)
const ENC_KEY_OLD = process.env.ENC_KEY_OLD || '';    // clave anterior (hex 64) para rotación
const VALIDATE_DOMAIN = (process.env.VALIDATE_DOMAIN || '').toLowerCase().trim(); // ej. "empresa.com"
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ====== Middlewares base ======
app.use(helmet());

// CORS estricto (si no configuras, permite todo como antes)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'));
  },
  maxAge: 600,
}));

app.use(express.json({ limit: '256kb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'tiny'));

// Rate limit global (60s ventana / 120 reqs)
const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Request-id + latencia simple (logs)
app.use((req, res, next) => {
  const rid = Math.random().toString(36).slice(2, 10);
  const start = Date.now();
  res.setHeader('X-Request-Id', rid);
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${rid}] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${ms}ms`);
  });
  next();
});

// Timeout por respuesta (12s)
app.use((req, res, next) => {
  res.setTimeout(12_000, () => {
    if (!res.headersSent) res.status(504).json({ error: 'timeout' });
    try { res.end(); } catch {}
  });
  next();
});

// Auth por API key + rotación (salta health y openapi)
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/openapi.json') return next();
  const k = req.header('X-API-Key') || '';
  if (k === API_KEY || (API_KEY_OLD && k === API_KEY_OLD)) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

// ====== Helpers cifrado ======
const encToken = (plain) => encryptWithKey(plain, ENC_KEY).value;
const decToken = (wrapped) => (wrapped == null ? null : decryptWithKeys(wrapped, ENC_KEY, ENC_KEY_OLD));

// ====== Statements ======
const selByEmail = db.prepare('SELECT * FROM entries WHERE lower(email)=lower(?)');
const selById    = db.prepare('SELECT * FROM entries WHERE id=?');
const selByUser  = db.prepare('SELECT * FROM entries WHERE lower(username)=lower(?)');
const selByUid   = db.prepare('SELECT * FROM entries WHERE mm_uid=?');

// 👉 INSERT puro (create-only, SIN upsert)
const insertStmt = db.prepare(`
  INSERT INTO entries (username, email, panelUrl, token, active, mm_uid)
  VALUES (@username, @email, @panelUrl, @token, @active, @mm_uid)
`);

// 👉 UPDATE por id (no toca id)
const updateStmt = db.prepare(`
  UPDATE entries
     SET username = COALESCE(@username, username),
         email    = COALESCE(@email, email),
         panelUrl = COALESCE(@panelUrl, panelUrl),
         token    = COALESCE(@token, token),
         active   = COALESCE(@active, active),
         mm_uid   = COALESCE(@mm_uid, mm_uid),
         updatedAt = datetime('now')
   WHERE id=@id
`);

// 👉 Utilidad para mapear violaciones UNIQUE a 409 Conflict
function conflictFromSqliteError(e) {
  const msg = String(e.message || '').toLowerCase();
  const fields = [];
  if (msg.includes('email'))    fields.push('email');
  if (msg.includes('username')) fields.push('username');
  if (msg.includes('mm_uid'))   fields.push('mm_uid');
  // nombres de índices alternativos
  if (msg.includes('unq_entries_username')) fields.push('username');
  if (msg.includes('unq_entries_mm_uid'))   fields.push('mm_uid');
  return { status: 409, body: { error: 'conflict', fields: [...new Set(fields)] } };
}

// ====== Rutas ======
app.get('/health', (_req, res) => res.json({ ok: true }));

// app.get('/openapi.json', (_req, res) => {
  // respuesta mínima; mantén tu openapi real si ya lo tenías
//  res.json({ openapi: '3.0.3', info: { title: 'Allowlist API', version: '1.1.0' }});
// });

// cambios xD
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga openapi.yaml una vez al arrancar
const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
const openapiDoc = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));

// Sirve JSON para integraciones
app.get('/openapi.json', (_req, res) => res.json(openapiDoc));

// Sirve Swagger UI en /docs
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc, {
  explorer: true,
  swaggerOptions: {
    persistAuthorization: true
  }
}));

app.get('/redoc', (_req, res) => {
  const url = '/openapi.json';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Allowlist API - Redoc</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
  <redoc spec-url="${url}"></redoc>
  <script src="https://cdn.redoc.ly/redoc/stable/bundles/redoc.standalone.js"></script>
</body>
</html>
  `);
});

// CREATE (create-only). Si hay duplicado -> 409
app.post('/entries', (req, res) => {
  const { id, ...raw } = req.body || {};
  const b = sanitizeEntryPayload(raw);
  const missing = validateBody(b);
  if (missing.length) return res.status(400).json({ error: 'missing fields', fields: missing });

  const payload = {
    username: b.username,
    email: normEmail(b.email),
    panelUrl: b.panelUrl,
    token: encToken(b.token),
    active: b.active ? 1 : 0,
    mm_uid: b.mm_uid ?? null,
  };

  try {
    insertStmt.run(payload);
    const row = selByEmail.get(payload.email);
    return res.status(201).json({ created: true, entry: toRow(row, decToken) });
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
      const { status, body } = conflictFromSqliteError(e);
      return res.status(status).json(body);
    }
    throw e; // cae en el middleware de error 500
  }
});

// BULK create-only: intenta crear cada item; si choca -> reporta conflicto en results
app.post('/entries/bulk', (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  if (!list.length) return res.status(400).json({ error: 'empty_array' });

  const tx = db.transaction((rows) => {
    const results = [];
    for (const raw of rows) {
      const b = sanitizeEntryPayload(raw);
      const missing = validateBody(b);
      if (missing.length) {
        results.push({ ok: false, error: 'missing_fields', fields: missing, item: b });
        continue;
      }
      const payload = {
        username: b.username,
        email: normEmail(b.email),
        panelUrl: b.panelUrl,
        token: encToken(b.token),
        active: b.active ? 1 : 0,
        mm_uid: b.mm_uid ?? null,
      };
      try {
        insertStmt.run(payload);
        const row = selByEmail.get(payload.email);
        results.push({ ok: true, entry: toRow(row, decToken) });
      } catch (e) {
        if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
          const { body } = conflictFromSqliteError(e);
          results.push({
            ok: false,
            ...body,
            item: { username: payload.username, email: payload.email, mm_uid: payload.mm_uid }
          });
        } else {
          results.push({ ok: false, error: 'internal_error' });
        }
      }
    }
    return results;
  });

  const results = tx(list);
  const summary = {
    total: results.length,
    created: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
  };
  res.status(207).json({ summary, results });
});

// Listar con filtros/paginación
app.get('/entries', (req, res) => {
  const { email, username, domain } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
  const where = [];
  const params = {};

  if (email)    { where.push('lower(email)=lower(@email)'); params.email = String(email); }
  if (username) { where.push('lower(username)=lower(@username)'); params.username = String(username); }
  if (domain)   { where.push("instr(lower(email), lower(@atDomain))>0"); params.atDomain = '@' + String(domain).toLowerCase(); }

  const whereSql = where.length ? (' WHERE ' + where.join(' AND ')) : '';
  const rows = db.prepare(`SELECT * FROM entries${whereSql} ORDER BY createdAt DESC LIMIT @limit OFFSET @offset`)
                 .all({ ...params, limit, offset });
  const count = db.prepare(`SELECT count(*) as n FROM entries${whereSql}`).get(params).n;

  res.set('Cache-Control', 'public, max-age=30');
  res.json({ total: count, entries: rows.map(r => toRow(r, decToken)) });
});

// Lookup one (id | email | username | mm_uid)
app.get('/entries/lookup', (req, res) => {
  const id = req.query.id ? Number(req.query.id) : null;
  const email = normEmail(req.query.email);
  const username = (req.query.username || '').trim();
  const mm_uid = (req.query.mm_uid || '').trim();

  let row = null;
  if (id) row = selById.get(id);
  else if (mm_uid) row = selByUid.get(mm_uid);
  else if (email) row = selByEmail.get(email);
  else if (username) row = selByUser.get(username);

  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ entry: toRow(row, decToken) });
});

// Read/Update/Delete por id
app.get('/entries/:id', (req, res) => {
  const row = selById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ entry: toRow(row, decToken) });
});

// UPDATE por id (conflictos -> 409)
app.put('/entries/:id', (req, res) => {
  const existing = selById.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const b = sanitizeEntryPayload(req.body);
  const payload = {
    id: req.params.id,
    username: b.username ?? null,
    email: b.email ? normEmail(b.email) : null,
    panelUrl: b.panelUrl ?? null,
    token: b.token ? encToken(b.token) : null,
    active: typeof b.active === 'boolean' ? (b.active ? 1 : 0) : null,
    mm_uid: b.mm_uid ?? null,
  };

  try {
    updateStmt.run(payload);
    const updated = selById.get(req.params.id);
    return res.json({ updated: true, entry: toRow(updated, decToken) });
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
      const { status, body } = conflictFromSqliteError(e);
      return res.status(status).json(body);
    }
    throw e;
  }
});

app.delete('/entries/:id', (req, res) => {
  const info = db.prepare('DELETE FROM entries WHERE id=?').run(req.params.id);
  res.json({ deleted: info.changes > 0 });
});

// VALIDATE con dominio opcional (y soporte mm_uid)
app.get('/validate', (req, res) => {
  const email = normEmail(req.query.email);
  const username = (req.query.username || '').trim();
  const mm_uid = (req.query.mm_uid || '').trim();

  let row = null;
  if (mm_uid)      row = selByUid.get(mm_uid);
  else if (email)  row = selByEmail.get(email);
  else if (username) row = selByUser.get(username);

  if (!row) return res.json({ ok: false, reason: 'not_found' });
  if (!row.active) return res.json({ ok: false, reason: 'inactive' });

  if (email && row.email.toLowerCase() !== email)
    return res.json({ ok: false, reason: 'email_mismatch' });

  if (username && row.username.toLowerCase() !== username.toLowerCase())
    return res.json({ ok: false, reason: 'username_mismatch' });

  if (VALIDATE_DOMAIN) {
    const dom = row.email.split('@')[1]?.toLowerCase() || '';
    if (dom !== VALIDATE_DOMAIN) {
      return res.json({ ok: false, reason: 'domain_forbidden', expected: VALIDATE_DOMAIN, got: dom });
    }
  }

  res.json({ ok: true, match: toRow(row, decToken) });
});

// Diagnóstico
app.get('/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));
app.get('/sleep', async (req, res) => {
  const ms = Math.min(parseInt(req.query.ms || '5000', 10), 30000);
  await new Promise(r => setTimeout(r, ms));
  res.json({ slept: ms });
});

// Errors -> JSON
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Allowlist API listening on :${PORT}`);
});
