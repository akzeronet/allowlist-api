export function toRow(r, decToken) {
  const token = decToken ? decToken(r.token) : r.token;
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    panelUrl: r.panelUrl,
    token,
    active: !!r.active,   // 👈 convertir a boolean
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
