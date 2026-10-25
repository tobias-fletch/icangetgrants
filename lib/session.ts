// Signed cookies for Google sign-in. HMAC-SHA256 via WebCrypto, keyed by the SESSION_SECRET env secret.
// Format: v1.<base64url(JSON payload)>.<base64url(HMAC(purpose + "." + payload))>
// The purpose ("session" or "oauth") separates the two cookie types, so one can never be replayed as the other.

export const SESSION_COOKIE = '__Host-icgg_session';
export const OAUTH_COOKIE = '__Host-icgg_google_oauth';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, in seconds
export const OAUTH_MAX_AGE = 600; // 10 minutes, in seconds

export type SessionPayload = { sub: string; exp: number };

const enc = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, key);
  }
  return key;
}

export async function signValue(purpose: string, payload: object, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${purpose}.${body}`)));
  return `v1.${body}.${b64url(sig)}`;
}

/** Returns the payload only when the signature is valid and `exp` (unix seconds) is in the future. */
export async function verifyValue<T extends { exp: number }>(purpose: string, value: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<T | null> {
  if (!value || !secret) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  let sig: Uint8Array<ArrayBuffer>;
  try { sig = fromB64url(parts[2]); } catch { return null; }
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(`${purpose}.${parts[1]}`));
  if (!ok) return null;
  let payload: T;
  try { payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); } catch { return null; }
  if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  return payload;
}

export function signSession(sub: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  return signValue('session', { sub, exp: nowSeconds + SESSION_MAX_AGE } satisfies SessionPayload, secret);
}

export async function verifySession(value: string | undefined, secret: string, nowSeconds?: number): Promise<SessionPayload | null> {
  const p = await verifyValue<SessionPayload>('session', value, secret, nowSeconds);
  return p && typeof p.sub === 'string' && p.sub ? p : null;
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// __Host- prefix: Secure, Path=/, no Domain, so the cookie is bound to this exact host.
export function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
