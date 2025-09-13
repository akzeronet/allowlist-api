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
const selByUser  = db.prepare('SELECT * FROM entries WHERE lower(username)=lower(?)');
const selByUid   = db.prepare('SELECT * FROM entries WHERE mm_uid=?');

const insertStmt = db.prepare(`
  INSERT INTO entries (username, email, panelUrl, token, active, mm_uid)
  VALUES (@username, @lowerEmail, @panelUrl, @token, @active, @mm_uid)
  ON CONFLICT(email) DO UPDATE SET
    username=excluded.username,
    panelUrl=excluded.panelUrl,
    token=excluded.token,
    active=excluded.active,
    mm_uid=COALESCE(excluded.mm_uid, entries.mm_uid),
    updatedAt=datetime('now')
`);

const updateStmt = db.prepare(`
  UPDATE entries
     SET username = COALESCE(@username, username),
         email    = COALESCE(@lowerEmail, email),
         panelUrl = COALESCE(@panelUrl, panelUrl),
         token    = COALESCE(@token, token),
         active   = COALESCE(@active, active),
         mm_uid   = COALESCE(@mm_uid, mm_uid),
         updatedAt = datetime('now')
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
  // ignora cualquier id suministrado
  const { id, ...raw } = req.body || {};
  const body = sanitizeEntryPayload(raw);

  const { username, email, panelUrl, token } = body;
  const errors = validateBody({ username, email, panelUrl, token });
  if (errors.length) return res.status(400).json({ error: 'missing fields', fields: errors });

  const lowerEmail = normEmail(email);
  const wrapped = enc(token);

  const payload = {
    username,
    lowerEmail,
    panelUrl,
    token: wrapped,
    active: body.active ? 1 : 0,
    mm_uid: body.mm_uid ?? null,  // 👈 opcional
  };

  const info = insertStmt.run(payload);
  const row = selByEmail.get(lowerEmail);
  return res.status(info.changes ? 201 : 200).json({ upsert: true, entry: toRow(row, dec) });
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

  const body = sanitizeEntryPayload(req.body);
  const payload = {
    id: req.params.id,
    username: body.username ?? null,
    lowerEmail: body.email ? normEmail(body.email) : null,
    panelUrl: body.panelUrl ?? null,
    token: body.token ? enc(body.token) : null,
    active: typeof body.active === 'boolean' ? (body.active ? 1 : 0) : null,
    mm_uid: body.mm_uid ?? null,  // 👈 se puede cambiar
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
  const mm_uid = (req.query.mm_uid || '').trim();

  let row = null;

  if (mm_uid) row = selByUid.get(mm_uid);
  else if (email) row = selByEmail.get(email);
  else if (username) row = selByUser.get(username);

  if (!row) return res.json({ ok: false, reason: 'not_found' });
  if (!row.active) return res.json({ ok: false, reason: 'inactive' });

  if (email && row.email.toLowerCase() !== email)
    return res.json({ ok: false, reason: 'email_mismatch' });

  if (username && row.username.toLowerCase() !== username.toLowerCase())
    return res.json({ ok: false, reason: 'username_mismatch' });

  res.json({ ok: true, match: toRow(row, dec) });
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
  res.json({ entry: toRow(row, dec) });
});

app.listen(PORT, () => {
  console.log(`Allowlist API listening on :${PORT}`);
});
