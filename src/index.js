import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';

import db from './db.js';
import { encryptWithKey, decryptWithKeys } from './crypto.js';
import { toRow, normEmail, validateBody, sanitizeEntryPayload } from './util.js';

// ===== Modo/entorno
const APP_MODE = process.env.APP_MODE || ''; // "1" prod, "2" dev
if (APP_MODE === '1') process.env.NODE_ENV = 'production';
if (APP_MODE === '2') process.env.NODE_ENV = 'development';
const IS_DEV = process.env.NODE_ENV === 'development';

// ===== Config
const app = express();
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || 'change-me';
const API_KEY_OLD = process.env.API_KEY_OLD || '';
const ENC_KEY = process.env.ENC_KEY || '';
const ENC_KEY_OLD = process.env.ENC_KEY_OLD || '';
const VALIDATE_DOMAIN = (process.env.VALIDATE_DOMAIN || '').toLowerCase().trim();
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// Docs
const DOCS_ENABLED = String(process.env.DOCS_ENABLED ?? 'true').toLowerCase() === 'true';
const DOCS_RELAX = String(process.env.DOCS_RELAX ?? (IS_DEV ? 'true' : 'false')).toLowerCase() === 'true';

// Paths / OpenAPI
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let openapiDoc = null;
try {
  const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
  if (fs.existsSync(openapiPath)) {
    openapiDoc = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));
  }
} catch (e) {
  console.warn('[openapi] no se pudo cargar openapi.yaml:', e.message);
}

// ===== Middlewares base
const DOCS_RE = /^\/(?:docs(?:\/.*)?|redoc|openapi\.json)$/;
const helmetBase = helmet();
app.use((req, res, next) => {
  if (DOCS_ENABLED && DOCS_RELAX && DOCS_RE.test(req.path || '')) return next();
  return helmetBase(req, res, next);
});

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'));
  },
  maxAge: 600,
}));

// app.use(express.json({ limit: '256kb' }));
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buf) => { req.rawBody = buf; } // crudo disponible para HMAC si lo activas
}));

app.use(morgan(IS_DEV ? 'dev' : 'tiny'));

app.use(rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

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

app.use((req, res, next) => {
  res.setTimeout(12_000, () => {
    if (!res.headersSent) res.status(504).json({ error: 'timeout' });
    try { res.end(); } catch {}
  });
  next();
});

// Static /assets (para redoc offline)
app.use('/assets', express.static(
  path.join(__dirname, '..', 'public'),
  { etag: true, maxAge: IS_DEV ? 0 : '7d' }
));

// ===== Docs (Swagger/Redoc)
const relaxDocsHeaders = (req, res, next) => {
  const isRedoc = req.path === '/redoc';
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data:",
    "font-src 'self' https: data:",
    "style-src 'self' https: 'unsafe-inline'",
    isRedoc
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
};

if (DOCS_ENABLED) {
  const docsMw = DOCS_RELAX ? [relaxDocsHeaders] : [];
  if (openapiDoc) {
    app.get('/openapi.json', ...docsMw, (_req, res) => res.json(openapiDoc));
    app.use('/docs', ...docsMw, swaggerUi.serve, swaggerUi.setup(openapiDoc, {
      explorer: true,
      swaggerOptions: { persistAuthorization: true },
    }));
  } else {
    app.get('/openapi.json', ...docsMw, (_req, res) =>
      res.json({ openapi: '3.0.3', info: { title: 'Allowlist API', version: '1.2.0' } })
    );
  }
  app.get('/redoc', ...docsMw, (_req, res) => {
    const url = '/openapi.json';
    const localJs = '/assets/redoc/redoc.standalone.js';
    res.type('html').send(`<!doctype html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Allowlist API - Redoc</title><style>html,body{height:100%;margin:0}</style></head>
<body>
  <redoc spec-url="${url}"></redoc>
  <script src="${localJs}"></script>
</body>
</html>`);
  });
}

// .env: HMAC_SECRET="super-secreto-compartido"
const HMAC_SECRET = process.env.HMAC_SECRET || '';

import crypto from 'crypto';
function verifyHmac(req) {
  if (!HMAC_SECRET) return false;
  const ts = req.header('X-Timestamp') || '';
  const sig = req.header('X-Signature') || '';
  if (!ts || !sig) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) return false; // 5 min ventana

  const body = req.rawBody || JSON.stringify(req.body || '');
//  const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
  const bodyHash = crypto.createHash('sha256')
  .update(req.rawBody ? req.rawBody : Buffer.from(''))
  .digest('hex');
  const base = `${req.method}\n${req.originalUrl}\n${ts}\n${bodyHash}`;
  const expect = crypto.createHmac('sha256', HMAC_SECRET).update(base).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
}

// Guarda raw body para hash exacto
app.use((req, res, next) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => { req.rawBody = data; next(); });
});

// Auth combinada: API key o HMAC
const PUBLIC_RE = /^\/(?:health|openapi\.json|redoc|docs(?:\/.*)?|favicon\.ico)$/;
app.use((req, res, next) => {
  if (PUBLIC_RE.test(req.path || '')) return next();
  const key = req.header('X-API-Key') || '';
  if (key === API_KEY || (API_KEY_OLD && key === API_KEY_OLD)) return next();
  if (verifyHmac(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

// ===== Auth por API key (public: health, docs, redoc, openapi, favicon)
// const PUBLIC_RE = /^\/(?:health|openapi\.json|redoc|docs(?:\/.*)?|favicon\.ico)$/;
// app.use((req, res, next) => {
//  if (PUBLIC_RE.test(req.path || '')) return next();
//  const k = req.header('X-API-Key') || '';
//  if (k === API_KEY || (API_KEY_OLD && k === API_KEY_OLD)) return next();
//  res.status(401).json({ error: 'unauthorized' });
// });

// ===== Cifrado helpers
const encToken = (plain) => encryptWithKey(plain, ENC_KEY).value;
const decToken = (wrapped) => (wrapped == null ? null : decryptWithKeys(wrapped, ENC_KEY, ENC_KEY_OLD));

// ===== Statements
const selByEmail = db.prepare('SELECT * FROM entries WHERE lower(email)=lower(?)');
const selById    = db.prepare('SELECT * FROM entries WHERE id=?');
const selByUser  = db.prepare('SELECT * FROM entries WHERE lower(username)=lower(?)');
const selByUid   = db.prepare('SELECT * FROM entries WHERE mm_uid=?');

const insertStmt = db.prepare(`
  INSERT INTO entries (username, email, panelUrl, token, active, mm_uid)
  VALUES (@username, @email, @panelUrl, @token, @active, @mm_uid)
`);

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

function conflictFromSqliteError(e) {
  const msg = String(e.message || '').toLowerCase();
  const fields = [];
  if (msg.includes('email'))    fields.push('email');
  if (msg.includes('username')) fields.push('username');
  if (msg.includes('mm_uid'))   fields.push('mm_uid');
  if (msg.includes('unq_entries_username')) fields.push('username');
  if (msg.includes('unq_entries_mm_uid'))   fields.push('mm_uid');
  return { status: 409, body: { error: 'conflict', fields: [...new Set(fields)] } };
}

// ===== Rutas
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

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
    throw e;
  }
});

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
          results.push({ ok: false, ...body, item: { username: payload.username, email: payload.email, mm_uid: payload.mm_uid } });
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

app.get('/entries/:id', (req, res) => {
  const row = selById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ entry: toRow(row, decToken) });
});

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
  console.log(`Allowlist API listening on :${PORT} (env: ${process.env.NODE_ENV || 'unknown'})`);
  console.log(`Docs: ${DOCS_ENABLED ? '/docs (enabled)' : 'disabled'} | Relax: ${DOCS_RELAX}`);
});
