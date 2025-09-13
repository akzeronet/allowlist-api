export function toRow(r, decToken) {
  const token = decToken ? decToken(r.token) : r.token;
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    panelUrl: r.panelUrl,
    token,
    active: !!r.active,
    mm_uid: r.mm_uid || null,          // 👈 incluir en respuestas
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function normEmail(e) {
  return (e || '').trim().toLowerCase();
}

// Validación de entrada (creación)
export function validateBody({ username, email, panelUrl, token }) {
  const errors = [];
  if (!username) errors.push('username');
  if (!email) errors.push('email');
  if (!panelUrl) errors.push('panelUrl');
  if (!token) errors.push('token');
  return errors;
}

// Sanitizado simple (anti input-bloat)
export function sanitizeEntryPayload(obj = {}) {
  const out = { ...obj };
  // recorta longitudes exageradas
  const MAX = 4096;
  ['username','email','panelUrl','token','mm_uid'].forEach(k => {
    if (typeof out[k] === 'string') out[k] = out[k].slice(0, MAX);
  });
  return out;
}
