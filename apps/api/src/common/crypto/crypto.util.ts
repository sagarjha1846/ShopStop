import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * App-level envelope encryption for secrets at rest (docs/11) — e.g. TOTP secrets.
 * AES-256-GCM with a random IV per value; output is base64(iv|tag|ciphertext).
 * The key comes from ENCRYPTION_KEY (hex). In prod this is a KMS-managed key.
 */
const ALGO = 'aes-256-gcm';

function keyFrom(hex: string): Buffer {
  const buf = Buffer.from(hex, 'hex');
  // Normalize to 32 bytes (pad/truncate) so a short dev key still works.
  if (buf.length === 32) return buf;
  const out = Buffer.alloc(32);
  buf.copy(out);
  return out;
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFrom(keyHex), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload: string, keyHex: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv(ALGO, keyFrom(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
