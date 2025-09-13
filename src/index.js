import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import db from './db.js';
import { maybeEncrypt, maybeDecrypt } from './crypto.js';
import { toRow, normEmail, validateBody } from './util.js';
import { openapi } from './openapi.js';

const app = express();
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || 'change-me';
const ENC_KEY = process.env.ENC_KEY || ''; // hex de 32 bytes opcional

// middlewares
app.use(helmet());
app.use(cors({ origin: '*', maxAge: 600 }));
app.use(express.json({ limit: '256kb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'tiny'));

// auth simple por API key
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/openapi.json') return next();
  const key = req.header('X-API-Key');
  if (key !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
});

// helpers token crypto
const enc = (plain) => maybeEncrypt(plain, ENC_KEY).value;
const dec = (wrapped) => (ENC_KEY ? maybeDecrypt(wrapped, ENC_KEY) : wrapped);

// prepared statements
const selByEmail = db.prepare('SELECT * FROM entries WHERE lower(email)=lower(?)');
const selById    = db.prepare('SELECT * FROM entries WHERE id=?');

const insertStmt = db.prepare(`
  INSERT INTO entries (username, email, panelUrl, token)
  VALUES (@username, @lowerEmail, @panelUrl, @token)
  ON CONFLICT(email) DO UPDATE SET
    username=excluded.username,
    panelUrl=excluded.panelUrl,
    token=excluded.token,
    updatedAt=datetime('now')
`);

const updateStmt = db.prepare(`
  UPDATE entries
     SET username=COALESCE(@username, username),
         email=COALESCE(@lowerEmail, email),
         panelUrl=COALESCE(@panelUrl, panelUrl),
         token=COALESCE(@token, token),
         updatedAt=datetime('now')
   WHERE id=@id
`);

const listBase = `
  SELECT * FROM entries
`;
const countBase = `SELECT count(*) as n FROM entries`;

// routes
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/openapi.json', (_req, res) => res.json(openapi));

// CREATE/UPSERT
app.post('/entries', (req, res) => {
  const { username, email, panelUrl, token, active = 1 } = req.body || {};
  const errors = validateBody({ username, email, panelUrl, token });
  if (errors.length) return res.status(400).json({ error: 'missing fields', fields: errors });

  const lowerEmail = normEmail(email);
  const wrapped = enc(token);

  const info = insertStmt.run({ username, lowerEmail, panelUrl, token: wrapped, active: active ? 1 : 0 });
  const row = selByEmail.get(lowerEmail);
  res.status(info.changes ? 201 : 200).json({ upsert: true, entry: toRow(row, dec) });
});

// LIST (con filtros + paginación)
app.get('/entries', (req, res) => {
  const { email, username, domain } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

  const where = [];
  const params = {};

  if (email) { where.push('lower(email)=lower(@email)'); params.email = String(email); }
  if (username) { where.push('lower(username)=lower(@username)'); params.username = String(username); }
  if (domain) { where.push("instr(lower(email), lower(@atDomain))>0"); params.atDomain = '@' + String(domain).toLowerCase(); }

  const whereSql = where.length ? (' WHERE ' + where.join(' AND ')) : '';
  const rows = db.prepare(`${listBase}${whereSql} ORDER BY createdAt DESC LIMIT @limit OFFSET @offset`)
                 .all({ ...params, limit, offset });
  const count = db.prepare(`${countBase}${whereSql}`).get(params).n;

  // hint de caché corto para GET
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ total: count, entries: rows.map(r => toRow(r, dec)) });
});

// READ
app.get('/entries/:id', (req, res) => {
  const row = selById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ entry: toRow(row, dec) });
});

// UPDATE
app.put('/entries/:id', (req, res) => {
  const row = selById.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const payload = {
    id: req.params.id,
    username: req.body.username ?? null,
    lowerEmail: req.body.email ? normEmail(req.body.email) : null,
    panelUrl: req.body.panelUrl ?? null,
    token: req.body.token ? enc(req.body.token) : null,
    active: typeof req.body.active === 'boolean' ? (req.body.active ? 1 : 0) : null
  };
  updateStmt.run(payload);
  const updated = selById.get(req.params.id);
  res.json({ updated: true, entry: toRow(updated, dec) });
});

// DELETE
app.delete('/entries/:id', (req, res) => {
  const info = db.prepare('DELETE FROM entries WHERE id=?').run(req.params.id);
  res.json({ deleted: info.changes > 0 });
});

// VALIDATE
app.get('/validate', (req, res) => {
  const email = normEmail(req.query.email);
  const username = (req.query.username || '').trim();
  if (!email) return res.status(400).json({ ok: false, reason: 'missing_email' });

  const row = selByEmail.get(email);

  if (!row) return res.json({ ok: false, reason: 'not_found' });
  if (!row.active) return res.json({ ok: false, reason: 'inactive' }); // 👈 aquí va la validación

  if (username && username.toLowerCase() !== row.username.toLowerCase())
    return res.json({ ok: false, reason: 'username_mismatch' });

  res.json({ ok: true, match: toRow(row, dec) });
});

app.listen(PORT, () => {
  console.log(`Allowlist API listening on :${PORT}`);
});
