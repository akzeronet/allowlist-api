import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

export function maybeEncrypt(plain, key) {
  if (!key) return { enc: false, value: plain };
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, Buffer.from(key, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: true,
    value: Buffer.concat([iv, tag, enc]).toString('base64'),
  };
}

export function maybeDecrypt(wrapped, key) {
  if (!key) return wrapped;
  try {
    const buf = Buffer.from(wrapped, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + 16);
    const data = buf.subarray(IV_LEN + 16);
    const decipher = crypto.createDecipheriv(ALGO, Buffer.from(key, 'hex'), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
