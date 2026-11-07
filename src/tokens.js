import crypto from 'node:crypto';
import { config } from './config.js';

const mac = (data) => crypto.createHmac('sha256', config.secret).update(data).digest('base64url').slice(0, 32);

/** Signed, tamper-proof token (not encrypted). Used for links in emails. */
export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body)}`;
}

export function verify(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
