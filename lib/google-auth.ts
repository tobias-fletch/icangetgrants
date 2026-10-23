// App-owned Google sign-in (OpenID Connect, authorization code + PKCE S256 + state + nonce).
// Runs beside the platform's Sign in with ChatGPT; it never touches the reserved
// /signin-with-chatgpt, /signout-with-chatgpt or /callback paths.
// Owner and MCP access stay ChatGPT-only: nothing here is consulted by lib/access.ts or lib/admin.ts.
// Pure module: request, env, fetch and the link store are passed in, so it is testable without Workers.
import { OAUTH_COOKIE, OAUTH_MAX_AGE, SESSION_COOKIE, SESSION_MAX_AGE, b64url, clearCookie, fromB64url, randomToken, readCookie, setCookie, signSession, signValue, verifyValue } from './session';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
export const GOOGLE_SCOPES = 'openid email profile';
export const MIN_SESSION_SECRET_LENGTH = 32;
const CHATGPT_ID_HEADER = 'oai-authenticated-user-id';
const CHATGPT_EMAIL_HEADER = 'oai-authenticated-user-email';
const CLOCK_SKEW = 60;

export type EnvLike = Record<string, unknown> | undefined;
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type GoogleConfig = { clientId: string; clientSecret: string; sessionSecret: string };
export type Intent = 'login' | 'link';
export type OAuthState = { state: string; verifier: string; nonce: string; intent: Intent; link?: string; rt: string; exp: number };
export type LinkStore = {
  chatgptIdForSub(sub: string): Promise<string | null>;
  subForChatGPT(chatgptUserId: string): Promise<string | null>;
  link(sub: string, chatgptUserId: string): Promise<void>;
  unlink(chatgptUserId: string): Promise<boolean>;
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Worker env binding (Site env vars and secrets) first, then process.env for local dev. */
export function readVar(name: string, env: EnvLike, procEnv: EnvLike = typeof process !== 'undefined' ? (process.env as EnvLike) : undefined): string | undefined {
  return str(env?.[name]) ?? str(procEnv?.[name]);
}

/** Null unless GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a SESSION_SECRET of at least 32 chars are all set. */
export function googleConfig(env: EnvLike, procEnv?: EnvLike): GoogleConfig | null {
  const clientId = readVar('GOOGLE_CLIENT_ID', env, procEnv);
  const clientSecret = readVar('GOOGLE_CLIENT_SECRET', env, procEnv);
  const sessionSecret = readVar('SESSION_SECRET', env, procEnv);
  if (!clientId || !clientSecret || !sessionSecret || sessionSecret.length < MIN_SESSION_SECRET_LENGTH) return null;
  return { clientId, clientSecret, sessionSecret };
}

/** Mirrors app/chatgpt-auth.ts: signed in with ChatGPT only when both id and email headers are present. */
export function chatGPTUserId(headers: Headers): string | null {
  const id = headers.get(CHATGPT_ID_HEADER);
  return id && headers.get(CHATGPT_EMAIL_HEADER) ? id : null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https://<host>/auth/google/callback; plain http only for loopback dev, which Google allows. */
export function callbackUrl(requestUrl: string): string {
  const u = new URL(requestUrl);
  const scheme = LOOPBACK.has(u.hostname) && u.protocol === 'http:' ? 'http' : 'https';
  return `${scheme}://${u.host}/auth/google/callback`;
}

const RESERVED = new Set(['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback']);

/** Same-origin relative path only; never a platform auth path or one of our own /auth/ routes. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  let url: URL;
  try { url = new URL(value, 'https://app.local'); } catch { return '/'; }
  if (url.origin !== 'https://app.local' || RESERVED.has(url.pathname) || url.pathname.startsWith('/auth/')) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string, nonce: string, challenge: string): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- id_token validation ----------

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; until: number } | null = null;
export function resetJwksCache() { jwksCache = null; }

async function googleKeys(fetcher: Fetcher, force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && jwksCache.until > Date.now()) return jwksCache.keys;
  const res = await fetcher(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new IdTokenError('jwks_unavailable');
  const body = (await res.json()) as { keys?: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]) || 3600;
  jwksCache = { keys: Array.isArray(body.keys) ? body.keys : [], until: Date.now() + Math.min(maxAge, 86400) * 1000 };
  return jwksCache.keys;
}

export class IdTokenError extends Error {
  constructor(public reason: string) { super(reason); }
}

export type IdClaims = { sub: string; email?: string; email_verified?: boolean | string; name?: string; iss: string; aud: string | string[]; azp?: string; exp: number; iat?: number; nonce?: string };

function decodePart(part: string): Record<string, unknown> {
  try { return JSON.parse(new TextDecoder().decode(fromB64url(part))); } catch { throw new IdTokenError('malformed'); }
}

/** Claim checks: iss, aud (and azp when present) = client id, exp, iat, nonce, email_verified, sub. */
export function checkClaims(claims: IdClaims, clientId: string, nonce: string, nowSeconds = Math.floor(Date.now() / 1000)): IdClaims {
  if (!claims || typeof claims !== 'object') throw new IdTokenError('malformed');
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new IdTokenError('iss');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId) || (aud.length > 1 && claims.azp !== clientId)) throw new IdTokenError('aud');
  if (claims.azp !== undefined && claims.azp !== clientId) throw new IdTokenError('aud');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW <= nowSeconds) throw new IdTokenError('exp');
  if (claims.iat !== undefined && (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW > nowSeconds)) throw new IdTokenError('iat');
  if (!safeEqual(claims.nonce, nonce)) throw new IdTokenError('nonce');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new IdTokenError('email_verified');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new IdTokenError('sub');
  return claims;
}

/** Verifies the RS256 signature against Google's JWKS (refetched once on unknown kid), then the claims. */
export async function verifyIdToken(idToken: unknown, clientId: string, nonce: string, fetcher: Fetcher, nowSeconds?: number): Promise<IdClaims> {
  if (typeof idToken !== 'string') throw new IdTokenError('missing');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new IdTokenError('malformed');
  const header = decodePart(parts[0]);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw new IdTokenError('alg');
  let jwk = (await googleKeys(fetcher, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(fetcher, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new IdTokenError('kid');
  let valid = false;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { valid = false; }
  if (!valid) throw new IdTokenError('signature');
  return checkClaims(decodePart(parts[1]) as IdClaims, clientId, nonce, nowSeconds);
}

// ---------- responses ----------

const noStore = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Plain page with a fixed message. Never echoes query values, tokens or secrets. */
export function messagePage(status: number, message: string, setCookies: string[] = []): Response {
  const headers = new Headers(noStore);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  for (const c of setCookies) headers.append('Set-Cookie', c);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign-in | I Can Get Grants</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><p>${escapeHtml(message)}</p><p><a href="/">Back to I Can Get Grants</a></p></body></html>`;
  return new Response(html, { status, headers });
}

export const NOT_CONFIGURED_MESSAGE = 'Google sign-in is not available yet. Please use Sign in with ChatGPT.';
export function notConfigured(): Response {
  return messagePage(503, NOT_CONFIGURED_MESSAGE);
}

function redirect(location: string, setCookies: string[], status = 302): Response {
  const headers = new Headers(noStore);
  headers.set('Location', location);
  for (const c of setCookies) headers.append('Set-Cookie', c);
  return new Response(null, { status, headers });
}

// ---------- route handlers ----------

/** GET /auth/google/start?intent=login|link&return_to=/path */
export async function handleStart(request: Request, env: EnvLike): Promise<Response> {
  const cfg = googleConfig(env);
  if (!cfg) return notConfigured();
  const url = new URL(request.url);
  const intent: Intent = url.searchParams.get('intent') === 'link' ? 'link' : 'login';
  const chatgptId = chatGPTUserId(request.headers);
  if (intent === 'link' && !chatgptId) return messagePage(401, 'Sign in with ChatGPT first, then link your Google account.');
  const state = randomToken(), nonce = randomToken(), verifier = randomToken(48);
  const payload: OAuthState = { state, verifier, nonce, intent, rt: safeReturnPath(url.searchParams.get('return_to')), exp: Math.floor(Date.now() / 1000) + OAUTH_MAX_AGE, ...(intent === 'link' ? { link: chatgptId! } : {}) };
  const cookie = await signValue('oauth', payload, cfg.sessionSecret);
  const location = buildAuthUrl(cfg.clientId, callbackUrl(request.url), state, nonce, await pkceChallenge(verifier));
  return redirect(location, [setCookie(OAUTH_COOKIE, cookie, OAUTH_MAX_AGE)]);
}

/** GET /auth/google/callback?code=…&state=… */
export async function handleCallback(request: Request, env: EnvLike, links: LinkStore, fetcher: Fetcher = fetch): Promise<Response> {
  const cfg = googleConfig(env);
  if (!cfg) return notConfigured();
  const clear = [clearCookie(OAUTH_COOKIE)];
  const url = new URL(request.url);
  const saved = await verifyValue<OAuthState>('oauth', readCookie(request.headers.get('cookie'), OAUTH_COOKIE), cfg.sessionSecret);
  if (!saved || typeof saved.state !== 'string' || typeof saved.verifier !== 'string' || typeof saved.nonce !== 'string') {
    return messagePage(400, 'Your Google sign-in expired or was started in another browser. Please try again.', clear);
  }
  if (!safeEqual(url.searchParams.get('state'), saved.state)) return messagePage(400, 'Google sign-in could not be verified (state mismatch). Please try again.', clear);
  if (url.searchParams.get('error')) return messagePage(400, 'Google sign-in was cancelled or declined.', clear);
  const code = url.searchParams.get('code');
  if (!code) return messagePage(400, 'Google did not return a sign-in code. Please try again.', clear);

  let idToken: unknown;
  try {
    const res = await fetcher(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: callbackUrl(request.url), grant_type: 'authorization_code', code_verifier: saved.verifier }).toString(),
    });
    if (!res.ok) return messagePage(502, 'Google sign-in could not be completed. Please try again.', clear);
    idToken = ((await res.json()) as { id_token?: unknown }).id_token;
  } catch {
    return messagePage(502, 'Google sign-in could not reach Google. Please try again.', clear);
  }

  let claims: IdClaims;
  try {
    claims = await verifyIdToken(idToken, cfg.clientId, saved.nonce, fetcher);
  } catch (e) {
    const reason = e instanceof IdTokenError ? e.reason : 'invalid';
    return messagePage(401, reason === 'email_verified' ? 'Your Google account email is not verified, so it cannot be used to sign in.' : 'Google sign-in could not be verified. Please try again.', clear);
  }

  const rt = safeReturnPath(saved.rt);
  if (saved.intent === 'link') {
    const chatgptId = chatGPTUserId(request.headers);
    if (!chatgptId || !safeEqual(chatgptId, saved.link)) return messagePage(403, 'Sign in with ChatGPT with the same account you started linking from, then try again.', clear);
    const existing = await links.chatgptIdForSub(claims.sub);
    if (existing && existing !== chatgptId) return messagePage(409, 'This Google account is already linked to a different workspace.', clear);
    const current = await links.subForChatGPT(chatgptId);
    if (current && current !== claims.sub) return messagePage(409, 'A different Google account is already linked to this workspace. Unlink it first.', clear);
    if (!existing) {
      try { await links.link(claims.sub, chatgptId); } catch { return messagePage(409, 'This Google account could not be linked. Please try again.', clear); }
    }
    return redirect(rt, clear);
  }
  const session = await signSession(claims.sub, cfg.sessionSecret);
  return redirect(rt, [...clear, setCookie(SESSION_COOKIE, session, SESSION_MAX_AGE)]);
}

/** GET or POST /auth/google/signout?return_to=/  (add chatgpt=1 to continue to the platform sign-out). */
export function handleSignout(request: Request, env: EnvLike): Response {
  if (!googleConfig(env)) return notConfigured();
  const url = new URL(request.url);
  const rt = safeReturnPath(url.searchParams.get('return_to'));
  const next = url.searchParams.get('chatgpt') === '1' ? `/signout-with-chatgpt?return_to=${encodeURIComponent(rt)}` : rt;
  return redirect(next, [clearCookie(SESSION_COOKIE), clearCookie(OAUTH_COOKIE)], request.method === 'POST' ? 303 : 302);
}

/** POST /auth/google/unlink (same-origin, signed in with ChatGPT). */
export async function handleUnlink(request: Request, env: EnvLike, links: LinkStore): Promise<Response> {
  if (!googleConfig(env)) return Response.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503, headers: noStore });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...noStore, Allow: 'POST' } });
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid origin' }, { status: 403, headers: noStore });
  const chatgptId = chatGPTUserId(request.headers);
  if (!chatgptId) return Response.json({ error: 'Sign in with ChatGPT to manage linked accounts.' }, { status: 401, headers: noStore });
  const removed = await links.unlink(chatgptId);
  return Response.json({ ok: true, removed }, { headers: noStore });
}
