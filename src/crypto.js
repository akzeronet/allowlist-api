import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

// Encripta SI hay key (actual). Siempre usa la clave "nueva".
export function encryptWithKey(plain, keyHex) {
  if (!keyHex) return { enc: false, value: plain };
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: true, value: Buffer.concat([iv, tag, enc]).toString('base64') };
}

// Desencripta probando ENC_KEY y, si falla, ENC_KEY_OLD (rotación)
export function decryptWithKeys(wrapped, keyHex, oldKeyHex) {
  if (!keyHex && !oldKeyHex) return wrapped;
  const tryKeys = [keyHex, oldKeyHex].filter(Boolean);
  for (const k of tryKeys) {
    try {
      const key = Buffer.from(k, 'hex');
      const buf = Buffer.from(wrapped, 'base64');
      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(IV_LEN, IV_LEN + 16);
      const data = buf.subarray(IV_LEN + 16);
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(data), decipher.final()]);
      return dec.toString('utf8');
    } catch { /* intenta con la siguiente */ }
  }
  // si ninguna clave funcionó, devuelve null (el servidor no podrá mostrar el token en claro)
  return null;
}
