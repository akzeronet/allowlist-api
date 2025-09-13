export function toRow(r, decTokenFn) {
  // si el token está cifrado y no se puede descifrar (rotación fallida), devolvemos null
  const token = decTokenFn ? decTokenFn(r.token) : r.token;
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    panelUrl: r.panelUrl,
    token: token ?? null,
    active: !!r.active,
    mm_uid: r.mm_uid || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function normEmail(e) {
  return (e || '').trim().toLowerCase();
}

export function validateBody({ username, email, panelUrl, token }) {
  const errors = [];
  if (!username) errors.push('username');
  if (!email) errors.push('email');
  if (!panelUrl) errors.push('panelUrl');
  if (!token) errors.push('token');
  return errors;
}

export function sanitizeEntryPayload(obj = {}) {
  const out = { ...obj };
  const MAX = 4096;
  ['username','email','panelUrl','token','mm_uid'].forEach(k => {
    if (typeof out[k] === 'string') out[k] = out[k].slice(0, MAX);
  });
  return out;
}
