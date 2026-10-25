// Google sign-in: signed cookies, OAuth state/PKCE/nonce, id_token checks, identity precedence, linking,
// ChatGPT-only owner access, not-configured behavior, and a user-facing brand-name check.
// All credentials here are fake test values; no real client secret is used anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/tests-google');
mkdirSync(out, { recursive: true });
for (const name of ['session', 'google-auth', 'current-user', 'workspace-merge', 'google-links', 'access']) {
  const source = readFileSync(`lib/${name}.ts`, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const load = (n) => import(pathToFileURL(`${out}/${n}.mjs`).href);
const session = await load('session');
const g = await load('google-auth');
const cu = await load('current-user');
const { d1LinkStore } = await load('google-links');
const wm = await load('workspace-merge');
const access = await load('access');

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const CLIENT_SECRET = 'fake-client-secret-for-tests-only';
const SESSION_SECRET = 'x'.repeat(48);
const ENV = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, SESSION_SECRET };
const NO_PROC = {}; // never fall back to the real process.env in tests
const ORIGIN = 'https://site.example';
const CHATGPT_HEADERS = { 'oai-authenticated-user-id': 'chatgpt-user-1', 'oai-authenticated-user-email': 'a@example.com' };
const now = () => Math.floor(Date.now() / 1000);

// Make googleConfig() ignore process.env so "not configured" tests are deterministic.
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']) delete process.env[k];

function memoryLinks() {
  const bySub = new Map();
  return {
    bySub,
    async chatgptIdForSub(sub) { return bySub.get(sub) ?? null; },
    async subForChatGPT(id) { for (const [s, c] of bySub) if (c === id) return s; return null; },
    async link(sub, id) { if (bySub.has(sub)) throw new Error('conflict'); bySub.set(sub, id); },
    async unlink(id) { for (const [s, c] of bySub) if (c === id) { bySub.delete(s); return true; } return false; },
  };
}
const setCookies = (res) => res.headers.getSetCookie();
const cookieValue = (res, name) => setCookies(res).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);

// ---------- RSA key + fake Google endpoints ----------
const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const otherPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
const enc = new TextEncoder();
const part = (o) => session.b64url(enc.encode(JSON.stringify(o)));
async function makeIdToken(claims, { key = keyPair.privateKey, kid = 'kid-1', alg = 'RS256' } = {}) {
  const head = part({ alg, kid, typ: 'JWT' }), body = part(claims);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${session.b64url(sig)}`;
}
const goodClaims = (nonce, extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, azp: CLIENT_ID, sub: '1234567890', email: 'g@example.com', email_verified: true, iat: now(), exp: now() + 3600, nonce, ...extra });

/** Fake Google: JWKS plus a token endpoint that enforces PKCE S256 against the challenge from /start. */
function fakeGoogle({ challenge, claims, tokenStatus = 200 }) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url === g.GOOGLE_JWKS_URL) return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'max-age=60' } });
    if (url === g.GOOGLE_TOKEN_URL) {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) return Response.json({ error: 'invalid_client' }, { status: 401 });
      if ((await g.pkceChallenge(form.get('code_verifier') || '')) !== challenge) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (tokenStatus !== 200) return Response.json({ error: 'server_error' }, { status: tokenStatus });
      return Response.json({ id_token: await makeIdToken(claims(form)), access_token: 'unused' });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

async function start(query = '', headers = {}) {
  const res = await g.handleStart(new Request(`${ORIGIN}/auth/google/start${query}`, { headers }), ENV);
  const loc = res.headers.get('location') ? new URL(res.headers.get('location')) : null;
  return { res, loc, cookie: cookieValue(res, session.OAUTH_COOKIE) };
}
function callback({ state, code = 'auth-code', cookie, headers = {}, extra = '' }) {
  const q = new URLSearchParams({ ...(state !== undefined ? { state } : {}), ...(code ? { code } : {}) }).toString();
  return new Request(`${ORIGIN}/auth/google/callback?${q}${extra}`, { headers: { ...(cookie ? { cookie: `${session.OAUTH_COOKIE}=${cookie}` } : {}), ...headers } });
}

// ---------- signed cookies ----------
test('session cookie signs and verifies, and rejects tampering, wrong key, wrong purpose and expiry', async () => {
  const t = now();
  const v = await session.signSession('sub-1', SESSION_SECRET, t);
  const p = await session.verifySession(v, SESSION_SECRET, t);
  assert.equal(p.sub, 'sub-1');
  assert.equal(p.exp, t + 30 * 24 * 3600);
  const [ver, body, sig] = v.split('.');
  const forged = session.b64url(enc.encode(JSON.stringify({ sub: 'attacker', exp: t + 999999 })));
  assert.equal(await session.verifySession(`${ver}.${forged}.${sig}`, SESSION_SECRET, t), null, 'tampered payload');
  assert.equal(await session.verifySession(`${ver}.${body}.${sig.slice(0, -2)}AA`, SESSION_SECRET, t), null, 'tampered signature');
  assert.equal(await session.verifySession(v, 'y'.repeat(48), t), null, 'other key');
  assert.equal(await session.verifySession(`v2.${body}.${sig}`, SESSION_SECRET, t), null, 'version');
  assert.equal(await session.verifySession('garbage', SESSION_SECRET, t), null);
  assert.equal(await session.verifySession(undefined, SESSION_SECRET, t), null);
  assert.equal(await session.verifySession(v, SESSION_SECRET, t + 30 * 24 * 3600), null, 'expired at exp');
  assert.ok(await session.verifySession(v, SESSION_SECRET, t + 30 * 24 * 3600 - 1));
  const oauth = await session.signValue('oauth', { sub: 'sub-1', exp: t + 600 }, SESSION_SECRET);
  assert.equal(await session.verifySession(oauth, SESSION_SECRET, t), null, 'an oauth cookie is not a session');
});

test('cookies are __Host-, HttpOnly, Secure, SameSite=Lax with the right lifetimes', () => {
  const c = session.setCookie(session.SESSION_COOKIE, 'v', session.SESSION_MAX_AGE);
  assert.match(c, /^__Host-icgg_session=v; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
  assert.doesNotMatch(c, /Domain=/i);
  assert.match(session.clearCookie(session.OAUTH_COOKIE), /^__Host-icgg_google_oauth=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(session.readCookie('a=1; __Host-icgg_session=abc.def; b=2', session.SESSION_COOKIE), 'abc.def');
  assert.equal(session.readCookie('x__Host-icgg_session=nope', session.SESSION_COOKIE), undefined);
});

// ---------- config / 503 ----------
test('config needs all three values and a 32+ char SESSION_SECRET', () => {
  assert.ok(g.googleConfig(ENV, NO_PROC));
  assert.equal(g.googleConfig({}, NO_PROC), null);
  assert.equal(g.googleConfig({ ...ENV, GOOGLE_CLIENT_SECRET: '' }, NO_PROC), null);
  assert.equal(g.googleConfig({ ...ENV, GOOGLE_CLIENT_ID: undefined }, NO_PROC), null);
  assert.equal(g.googleConfig({ ...ENV, SESSION_SECRET: 'short' }, NO_PROC), null);
  assert.ok(g.googleConfig({}, ENV), 'falls back to process env for local dev');
});

test('every Google route returns a clear 503 when not configured, without leaking config', async () => {
  const links = memoryLinks();
  for (const env of [{}, { GOOGLE_CLIENT_ID: CLIENT_ID }, { ...ENV, SESSION_SECRET: 'short' }]) {
    const responses = [
      await g.handleStart(new Request(`${ORIGIN}/auth/google/start`), env),
      await g.handleCallback(new Request(`${ORIGIN}/auth/google/callback?code=x&state=y`), env, links, async () => { throw new Error('must not fetch'); }),
      g.handleSignout(new Request(`${ORIGIN}/auth/google/signout`), env),
      await g.handleUnlink(new Request(`${ORIGIN}/auth/google/unlink`, { method: 'POST', headers: { origin: ORIGIN, ...CHATGPT_HEADERS } }), env, links),
    ];
    for (const r of responses) {
      assert.equal(r.status, 503);
      const text = await r.text();
      assert.match(text, /Google sign-in is not available yet/);
      assert.ok(!text.includes(CLIENT_ID));
      assert.equal(r.headers.get('set-cookie'), null);
    }
  }
  assert.equal(await cu.resolveCurrentUser(null, `${session.SESSION_COOKIE}=${await session.signSession('s', SESSION_SECRET)}`, {}, async () => null), null, 'a Google cookie is ignored when not configured');
});

// ---------- start ----------
test('start redirects to Google with code flow, minimal scopes, state, nonce and PKCE S256', async () => {
  const { res, loc, cookie } = await start('?return_to=%2Fprivacy%3Fa%3D1');
  assert.equal(res.status, 302);
  assert.equal(loc.origin + loc.pathname, g.GOOGLE_AUTH_URL);
  const p = loc.searchParams;
  assert.equal(p.get('client_id'), CLIENT_ID);
  assert.equal(p.get('redirect_uri'), `${ORIGIN}/auth/google/callback`);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('scope'), 'openid email profile');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.ok(p.get('state').length >= 40 && p.get('nonce').length >= 40 && p.get('code_challenge').length === 43);
  assert.ok(!loc.toString().includes(CLIENT_SECRET), 'secret never leaves the server');
  const saved = await session.verifyValue('oauth', cookie, SESSION_SECRET);
  assert.equal(saved.state, p.get('state'));
  assert.equal(saved.nonce, p.get('nonce'));
  assert.equal(await g.pkceChallenge(saved.verifier), p.get('code_challenge'));
  assert.equal(saved.intent, 'login');
  assert.equal(saved.rt, '/privacy?a=1');
  assert.ok(saved.exp <= now() + 600 && saved.exp > now() + 590);
  assert.match(setCookies(res)[0], /^__Host-icgg_google_oauth=.+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('callback URL and return paths stay on this origin and off reserved paths', () => {
  assert.equal(g.callbackUrl('http://localhost:5173/auth/google/start'), 'http://localhost:5173/auth/google/callback');
  assert.equal(g.callbackUrl('http://site.example/auth/google/start'), 'https://site.example/auth/google/callback');
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback', '/auth/google/start', '', null]) assert.equal(g.safeReturnPath(bad), '/', String(bad));
  assert.equal(g.safeReturnPath('/grants?x=1#y'), '/grants?x=1#y');
});

// ---------- callback: state, PKCE, tokens ----------
test('a full sign-in sets a 30-day session for the Google sub and clears the oauth cookie', async () => {
  const { loc, cookie } = await start('?return_to=%2Fprivacy');
  const google = fakeGoogle({ challenge: loc.searchParams.get('code_challenge'), claims: () => goodClaims(loc.searchParams.get('nonce')) });
  g.resetJwksCache();
  const res = await g.handleCallback(callback({ state: loc.searchParams.get('state'), cookie }), ENV, memoryLinks(), google.fetcher);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/privacy');
  const sc = setCookies(res);
  assert.ok(sc.some((c) => c.startsWith('__Host-icgg_google_oauth=; ') && c.includes('Max-Age=0')));
  const sess = cookieValue(res, session.SESSION_COOKIE);
  assert.equal((await session.verifySession(sess, SESSION_SECRET)).sub, '1234567890');
  assert.ok(sc.find((c) => c.startsWith('__Host-icgg_session=')).includes('Max-Age=2592000'));
  const tokenCall = google.calls.find((c) => c.url === g.GOOGLE_TOKEN_URL);
  assert.equal(tokenCall.init.method, 'POST');
  assert.equal(new URLSearchParams(tokenCall.init.body).get('redirect_uri'), `${ORIGIN}/auth/google/callback`);
});

test('state mismatch, missing or tampered oauth cookie, and Google errors are rejected before any token exchange', async () => {
  const { loc, cookie } = await start();
  const state = loc.searchParams.get('state');
  const noFetch = async () => { throw new Error('must not fetch'); };
  const links = memoryLinks();
  const cases = [
    callback({ state: 'wrong-state', cookie }),
    callback({ state: undefined, cookie }),
    callback({ state }),
    callback({ state, cookie: cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }),
    callback({ state, cookie: await session.signValue('oauth', { state, verifier: 'v', nonce: 'n', intent: 'login', rt: '/', exp: now() - 1 }, SESSION_SECRET) }),
    callback({ state, cookie: await session.signValue('session', { state, verifier: 'v', nonce: 'n', intent: 'login', rt: '/', exp: now() + 60 }, SESSION_SECRET) }),
    callback({ state, cookie, code: '', extra: '&error=access_denied' }),
    callback({ state, cookie, code: '' }),
  ];
  for (const req of cases) {
    const res = await g.handleCallback(req, ENV, links, noFetch);
    assert.equal(res.status, 400, req.url);
    assert.equal(cookieValue(res, session.SESSION_COOKIE), undefined);
    assert.ok(setCookies(res).some((c) => c.startsWith('__Host-icgg_google_oauth=;')));
  }
});

test('PKCE: a verifier from a different flow fails the code exchange', async () => {
  const a = await start(), b = await start();
  // Cookie and state from flow A, but Google issued the code against flow B's challenge.
  const google = fakeGoogle({ challenge: b.loc.searchParams.get('code_challenge'), claims: () => goodClaims(a.loc.searchParams.get('nonce')) });
  const res = await g.handleCallback(callback({ state: a.loc.searchParams.get('state'), cookie: a.cookie }), ENV, memoryLinks(), google.fetcher);
  assert.equal(res.status, 502);
  assert.equal(cookieValue(res, session.SESSION_COOKIE), undefined);
  const body = await res.text();
  assert.ok(!body.includes(CLIENT_SECRET) && !body.includes('invalid_grant'));
});

test('a token endpoint failure or network error does not sign in', async () => {
  const { loc, cookie } = await start();
  const state = loc.searchParams.get('state');
  const google = fakeGoogle({ challenge: loc.searchParams.get('code_challenge'), claims: () => goodClaims(loc.searchParams.get('nonce')), tokenStatus: 500 });
  assert.equal((await g.handleCallback(callback({ state, cookie }), ENV, memoryLinks(), google.fetcher)).status, 502);
  assert.equal((await g.handleCallback(callback({ state, cookie }), ENV, memoryLinks(), async () => { throw new Error('offline'); })).status, 502);
});

// ---------- id_token ----------
test('id_token claims: iss, aud, azp, exp, iat, nonce, email_verified and sub', () => {
  const t = now(), n = 'nonce-1';
  assert.ok(g.checkClaims(goodClaims(n), CLIENT_ID, n, t));
  assert.ok(g.checkClaims(goodClaims(n, { iss: 'accounts.google.com', email_verified: 'true' }), CLIENT_ID, n, t));
  assert.ok(g.checkClaims(goodClaims(n, { aud: [CLIENT_ID, 'other'], azp: CLIENT_ID }), CLIENT_ID, n, t));
  const bad = {
    iss: { iss: 'https://evil.example' },
    aud: { aud: 'other-client' },
    'aud-azp': { aud: [CLIENT_ID, 'other'], azp: 'other' },
    'aud-azp-only': { azp: 'other' },
    exp: { exp: t - 61 },
    'exp-missing': { exp: undefined },
    iat: { iat: t + 3600 },
    nonce: { nonce: 'other-nonce' },
    'nonce-missing': { nonce: undefined },
    email_verified: { email_verified: false },
    'email_verified-missing': { email_verified: undefined },
    sub: { sub: '' },
  };
  for (const [reason, extra] of Object.entries(bad)) {
    assert.throws(() => g.checkClaims(goodClaims(n, extra), CLIENT_ID, n, t), (e) => e instanceof g.IdTokenError && e.reason === reason.split('-')[0], reason);
  }
  assert.ok(g.checkClaims(goodClaims(n, { exp: t - 30 }), CLIENT_ID, n, t), '60s clock skew');
});

test('id_token signature is verified against Google JWKS', async () => {
  g.resetJwksCache();
  const fetcher = async (url) => (url === g.GOOGLE_JWKS_URL ? Response.json({ keys: [jwk] }) : new Response('', { status: 404 }));
  const n = 'nonce-2';
  assert.equal((await g.verifyIdToken(await makeIdToken(goodClaims(n)), CLIENT_ID, n, fetcher)).sub, '1234567890');
  const reject = async (tok, reason) => assert.rejects(g.verifyIdToken(tok, CLIENT_ID, n, fetcher), (e) => e.reason === reason, reason);
  await reject(await makeIdToken(goodClaims(n), { key: otherPair.privateKey }), 'signature');
  await reject(await makeIdToken(goodClaims(n), { kid: 'unknown' }), 'kid');
  await reject(await makeIdToken(goodClaims(n), { alg: 'HS256' }), 'alg');
  const good = await makeIdToken(goodClaims(n));
  const [h, , s] = good.split('.');
  await reject(`${h}.${part(goodClaims(n, { sub: 'attacker' }))}.${s}`, 'signature');
  await reject(`${part({ alg: 'none', kid: 'kid-1' })}.${part(goodClaims(n))}.`, 'alg');
  await reject('not.a.jwt.at.all', 'malformed');
  await reject(undefined, 'missing');
  await reject(await makeIdToken(goodClaims(n, { email_verified: false })), 'email_verified');
});

test('callback refuses an unverified email or wrong nonce', async () => {
  for (const [extra, msg] of [[{ email_verified: false }, /not verified/], [{ nonce: 'replayed' }, /could not be verified/]]) {
    g.resetJwksCache();
    const { loc, cookie } = await start();
    const google = fakeGoogle({ challenge: loc.searchParams.get('code_challenge'), claims: () => goodClaims(loc.searchParams.get('nonce'), extra) });
    const res = await g.handleCallback(callback({ state: loc.searchParams.get('state'), cookie }), ENV, memoryLinks(), google.fetcher);
    assert.equal(res.status, 401);
    assert.match(await res.text(), msg);
    assert.equal(cookieValue(res, session.SESSION_COOKIE), undefined);
  }
});

// ---------- getCurrentUser precedence ----------
test('getCurrentUser: ChatGPT headers first, then the Google session (linked id or google:<sub>)', async () => {
  const chatgpt = { userId: 'chatgpt-user-1', email: 'a@example.com', fullName: 'A', displayName: 'A' };
  const cookie = `${session.SESSION_COOKIE}=${await session.signSession('sub-9', SESSION_SECRET)}`;
  const links = memoryLinks();
  const byChatGPT = await cu.resolveCurrentUser(chatgpt, cookie, ENV, links.chatgptIdForSub);
  assert.deepEqual([byChatGPT.userId, byChatGPT.provider], ['chatgpt-user-1', 'chatgpt']);
  const google = await cu.resolveCurrentUser(null, cookie, ENV, links.chatgptIdForSub);
  assert.deepEqual([google.userId, google.provider, google.linked, google.email], ['google:sub-9', 'google', false, null]);
  await links.link('sub-9', 'chatgpt-user-1');
  const linked = await cu.resolveCurrentUser(null, cookie, ENV, links.chatgptIdForSub);
  assert.deepEqual([linked.userId, linked.provider, linked.linked, linked.chatgptUserId], ['chatgpt-user-1', 'google', true, null]);
  assert.equal(await cu.resolveCurrentUser(null, `${session.SESSION_COOKIE}=tampered`, ENV, links.chatgptIdForSub), null);
  assert.equal(await cu.resolveCurrentUser(null, `${session.SESSION_COOKIE}=${await session.signSession('sub-9', SESSION_SECRET, now() - 31 * 24 * 3600)}`, ENV, links.chatgptIdForSub), null, 'expired');
  assert.equal(await cu.resolveCurrentUser(null, null, ENV, links.chatgptIdForSub), null);
  const src = readFileSync('app/current-user.ts', 'utf8');
  assert.match(src, /resolveCurrentUser\(await getChatGPTUser\(\)/, 'app getCurrentUser passes the ChatGPT identity first');
});

test('workspace and discover routes store data under getCurrentUser()', () => {
  for (const f of ['app/api/workspace/route.ts', 'app/api/discover/route.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /const u=await getCurrentUser\(\)/, f);
    assert.doesNotMatch(src, /const u=await getChatGPTUser\(\)/, f);
  }
});

// ---------- linking ----------
async function linkFlow(links, { startHeaders = CHATGPT_HEADERS, callbackHeaders = CHATGPT_HEADERS, sub = '1234567890' } = {}) {
  g.resetJwksCache();
  const { res: startRes, loc, cookie } = await start('?intent=link&return_to=%2F', startHeaders);
  if (!loc) return startRes;
  const google = fakeGoogle({ challenge: loc.searchParams.get('code_challenge'), claims: () => goodClaims(loc.searchParams.get('nonce'), { sub }) });
  return g.handleCallback(callback({ state: loc.searchParams.get('state'), cookie, headers: callbackHeaders }), ENV, links, google.fetcher);
}

test('link: a ChatGPT user links one Google account; no Google session is created', async () => {
  const links = memoryLinks();
  const res = await linkFlow(links);
  assert.equal(res.status, 302);
  assert.equal(links.bySub.get('1234567890'), 'chatgpt-user-1');
  assert.equal(cookieValue(res, session.SESSION_COOKIE), undefined);
  assert.equal((await linkFlow(links)).status, 302, 'relinking the same pair is a no-op');
});

test('link: requires ChatGPT at start and the same ChatGPT account at callback; conflicts are 409', async () => {
  assert.equal((await linkFlow(memoryLinks(), { startHeaders: {} })).status, 401);
  assert.equal((await linkFlow(memoryLinks(), { startHeaders: { 'oai-authenticated-user-id': 'x' } })).status, 401, 'id without email is not signed in');
  const links = memoryLinks();
  assert.equal((await linkFlow(links, { callbackHeaders: {} })).status, 403);
  assert.equal((await linkFlow(links, { callbackHeaders: { ...CHATGPT_HEADERS, 'oai-authenticated-user-id': 'someone-else' } })).status, 403);
  assert.equal(links.bySub.size, 0);
  await links.link('1234567890', 'other-chatgpt');
  assert.equal((await linkFlow(links)).status, 409, 'Google account already linked elsewhere');
  const links2 = memoryLinks();
  await links2.link('first-sub', 'chatgpt-user-1');
  assert.equal((await linkFlow(links2, { sub: 'second-sub' })).status, 409, 'workspace already has a different Google account');
  const racing = { ...memoryLinks(), async link() { throw new Error('Link conflict'); } };
  for (const [reason, status] of [['busy', 409], ['too_large', 409], ['unavailable', 503]]) assert.equal((await linkFlow({ ...memoryLinks(), async link() { throw Object.assign(new Error('x'), { reason }); } })).status, status, reason);
  assert.equal((await linkFlow(racing)).status, 409, 'a race at insert is a 409, not a 500');
});

test('unlink: POST, same origin, ChatGPT only', async () => {
  const links = memoryLinks();
  await links.link('1234567890', 'chatgpt-user-1');
  const req = (init) => new Request(`${ORIGIN}/auth/google/unlink`, init);
  assert.equal((await g.handleUnlink(req({ method: 'GET', headers: CHATGPT_HEADERS }), ENV, links)).status, 405);
  assert.equal((await g.handleUnlink(req({ method: 'POST', headers: { ...CHATGPT_HEADERS, origin: 'https://evil.example' } }), ENV, links)).status, 403);
  assert.equal((await g.handleUnlink(req({ method: 'POST', headers: { origin: ORIGIN, cookie: `${session.SESSION_COOKIE}=${await session.signSession('1234567890', SESSION_SECRET)}` } }), ENV, links)).status, 401, 'a Google session cannot unlink');
  const ok = await g.handleUnlink(req({ method: 'POST', headers: { ...CHATGPT_HEADERS, origin: ORIGIN } }), ENV, links);
  assert.deepEqual(await ok.json(), { ok: true, removed: true });
  assert.equal(links.bySub.size, 0);
});

// ---------- D1 (node:sqlite running the real migrations) ----------
let sqlite = null; try { sqlite = await import('node:sqlite'); } catch {}
/** A small D1 stand-in over node:sqlite. batch() is one transaction, like D1; failOn makes a matching statement throw. */
function sqliteD1({ failOn = null, beforeBatch = null } = {}) {
  const db = new sqlite.DatabaseSync(':memory:');
  for (const f of readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort()) for (const stmt of readFileSync(join('drizzle', f), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) db.exec(stmt);
  const d1 = {
    raw: db,
    prepare(sql) {
      let args = [];
      const exec = () => { if (failOn && failOn.test(sql)) throw new Error('D1_ERROR: injected failure'); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; };
      const api = { sql, bind(...a) { args = a; return api; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { return exec(); }, exec };
      return api;
    },
    async batch(stmts) {
      if (beforeBatch) await beforeBatch(d1);
      db.exec('BEGIN');
      try { const out = stmts.map((st) => st.exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  return d1;
}
const putWs = (d1, owner, ws) => d1.raw.prepare('INSERT INTO workspaces (owner, data) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data').run(owner, JSON.stringify(ws));
const getWs = (d1, owner) => { const r = d1.raw.prepare('SELECT data FROM workspaces WHERE owner = ?').get(owner); return r ? JSON.parse(r.data) : null; };
const linkRows = (d1) => d1.raw.prepare('SELECT google_sub, chatgpt_user_id FROM google_links').all().map((r) => ({ ...r }));
const prof = (id, name, extra = {}) => ({ id, name, type: 'Student', country: 'United States', state: 'New York', keywords: 'design', goal: 5000, education: '', details: '', alerts: true, ...extra });
const sv = (profileId, grantId, extra = {}) => ({ profileId, grantId, status: 'Considering', notes: '', ...extra });

test('D1 link store enforces one-to-one links with the real migration SQL', async (t) => {
  if (!sqlite) return t.skip('node:sqlite unavailable');
  const d1 = sqliteD1();
  const store = d1LinkStore(d1);
  await store.link('sub-a', 'chatgpt-a');
  assert.equal(await store.chatgptIdForSub('sub-a'), 'chatgpt-a');
  assert.equal(await store.subForChatGPT('chatgpt-a'), 'sub-a');
  assert.deepEqual(await store.link('sub-a', 'chatgpt-a'), { merged: false, profilesAdded: 0, savedAdded: 0 }, 'relinking the same pair is a no-op');
  await assert.rejects(store.link('sub-a', 'chatgpt-b'), (e) => e.reason === 'conflict');
  await assert.rejects(store.link('sub-b', 'chatgpt-a'), (e) => e.reason === 'conflict');
  assert.equal(await store.unlink('chatgpt-a'), true);
  assert.equal(await store.unlink('chatgpt-a'), false);
  assert.equal(await store.chatgptIdForSub('sub-a'), null);
  const none = d1LinkStore(undefined);
  assert.equal(await none.chatgptIdForSub('x'), null);
  await assert.rejects(none.link('x', 'y'), (e) => e.reason === 'unavailable');
});

// ---------- merge on link ----------
test('merge rules: dedupe by id, identical profiles keep the ChatGPT one, saved/seen union, ChatGPT preferences win', () => {
  const chatgpt = { profiles: [prof('p1', 'Studio'), prof('p2', 'Kid', { keywords: 'Robotics, art' })], saved: [sv('p1', 'g1', { status: 'Submitted', notes: 'mine' }), sv('p2', 'g2')], seen: '2026-10-01T00:00:00.000Z', theme: 'light' };
  const google = {
    profiles: [prof('p1', 'Studio renamed'), prof('px', '  kid ', { keywords: 'robotics,  ART'.replace(',  ', ', '), alerts: false }), prof('p3', 'New biz', { type: 'Small business' })],
    saved: [sv('p1', 'g1', { status: 'Preparing', notes: 'theirs' }), sv('px', 'g2'), sv('px', 'g9'), sv('p3', 'g3')],
    seen: '2026-10-20T00:00:00.000Z', theme: 'dark', digest: 'weekly',
  };
  const { merged, profilesAdded, profilesMatched, savedAdded } = wm.mergeWorkspaces(chatgpt, google);
  assert.deepEqual(merged.profiles.map((p) => [p.id, p.name]), [['p1', 'Studio'], ['p2', 'Kid'], ['p3', 'New biz']], 'same id keeps ChatGPT; identical content (px) keeps ChatGPT p2; new appended');
  assert.equal(profilesAdded, 1); assert.equal(profilesMatched, 2);
  assert.deepEqual(merged.saved.map((s) => [s.profileId, s.grantId, s.status]), [['p1', 'g1', 'Submitted'], ['p2', 'g2', 'Considering'], ['p2', 'g9', 'Considering'], ['p3', 'g3', 'Considering']], 'saved union; px items move to p2; ChatGPT entry wins');
  assert.equal(merged.saved[0].notes, 'mine');
  assert.equal(savedAdded, 2);
  assert.equal(merged.seen, '2026-10-20T00:00:00.000Z', 'seen: union of what was reviewed = later time');
  assert.equal(merged.theme, 'light', 'ChatGPT preference wins'); assert.equal(merged.digest, 'weekly', 'non-conflicting preference kept');
  assert.equal(wm.mergeWorkspaces({ ...chatgpt, seen: '2026-10-25T00:00:00.000Z' }, google).merged.seen, '2026-10-25T00:00:00.000Z');
  assert.equal(wm.mergeWorkspaces({ ...chatgpt, seen: '' }, google).merged.seen, google.seen);
});

test('merge into an empty or missing ChatGPT workspace keeps all Google data; limits are enforced', () => {
  const google = { profiles: [prof('a', 'A'), prof('b', 'B')], saved: [sv('a', 'g1')], seen: '2026-10-20T00:00:00.000Z' };
  for (const base of [null, { profiles: [], saved: [], seen: '' }]) {
    const { merged } = wm.mergeWorkspaces(base, google);
    assert.deepEqual(merged, google);
  }
  const many = { profiles: Array.from({ length: 30 }, (_, i) => prof('c' + i, 'C' + i, { keywords: 'k' + i })), saved: [], seen: '' };
  const more = { profiles: Array.from({ length: 30 }, (_, i) => prof('g' + i, 'G' + i, { keywords: 'q' + i })), saved: [], seen: '' };
  assert.throws(() => wm.mergeWorkspaces(many, more), (e) => e.reason === 'too_large');
});

test('link merges the google:<sub> workspace into the ChatGPT one and deletes it, atomically (with overlap)', async (t) => {
  if (!sqlite) return t.skip('node:sqlite unavailable');
  const d1 = sqliteD1();
  putWs(d1, 'chatgpt-user-1', { profiles: [prof('p1', 'Studio')], saved: [sv('p1', 'g1', { notes: 'keep' })], seen: '2026-10-01T00:00:00.000Z' });
  putWs(d1, 'google:1234567890', { profiles: [prof('p1', 'Other'), prof('p2', 'Kid')], saved: [sv('p1', 'g1', { notes: 'drop' }), sv('p2', 'g2')], seen: '2026-10-02T00:00:00.000Z' });
  putWs(d1, 'someone-else', { profiles: [prof('z', 'Z')], saved: [], seen: '' });
  const res = await linkFlow(d1LinkStore(d1));
  assert.equal(res.status, 302);
  assert.deepEqual(linkRows(d1), [{ google_sub: '1234567890', chatgpt_user_id: 'chatgpt-user-1' }]);
  const ws = getWs(d1, 'chatgpt-user-1');
  assert.deepEqual(ws.profiles.map((p) => p.name), ['Studio', 'Kid']);
  assert.deepEqual(ws.saved.map((s) => `${s.profileId}/${s.grantId}/${s.notes}`), ['p1/g1/keep', 'p2/g2/']);
  assert.equal(ws.seen, '2026-10-02T00:00:00.000Z');
  assert.equal(getWs(d1, 'google:1234567890'), null, 'orphaned Google workspace deleted');
  assert.equal(getWs(d1, 'someone-else').profiles.length, 1, 'other workspaces untouched');
  // After linking, a Google session for that sub opens the merged ChatGPT workspace.
  const u = await cu.resolveCurrentUser(null, `${session.SESSION_COOKIE}=${await session.signSession('1234567890', SESSION_SECRET)}`, ENV, d1LinkStore(d1).chatgptIdForSub);
  assert.equal(u.userId, 'chatgpt-user-1');
});

test('link merges into a ChatGPT account that has no workspace yet', async (t) => {
  if (!sqlite) return t.skip('node:sqlite unavailable');
  const d1 = sqliteD1();
  const google = { profiles: [prof('p2', 'Kid')], saved: [sv('p2', 'g2')], seen: '2026-10-02T00:00:00.000Z' };
  putWs(d1, 'google:1234567890', google);
  const r = await d1LinkStore(d1).link('1234567890', 'chatgpt-user-1');
  assert.deepEqual(r, { merged: true, profilesAdded: 1, savedAdded: 1 });
  assert.deepEqual(getWs(d1, 'chatgpt-user-1'), google);
  assert.equal(getWs(d1, 'google:1234567890'), null);
});

test('link with no Google workspace is a plain link: the ChatGPT workspace is not rewritten', async (t) => {
  if (!sqlite) return t.skip('node:sqlite unavailable');
  const d1 = sqliteD1();
  const raw = '{"profiles":[],"saved":[],"seen":"","custom":1}';
  d1.raw.prepare('INSERT INTO workspaces (owner, data) VALUES (?, ?)').run('chatgpt-user-1', raw);
  assert.deepEqual(await d1LinkStore(d1).link('1234567890', 'chatgpt-user-1'), { merged: false, profilesAdded: 0, savedAdded: 0 });
  assert.equal(d1.raw.prepare('SELECT data FROM workspaces WHERE owner = ?').get('chatgpt-user-1').data, raw, 'byte-for-byte unchanged');
  assert.equal(d1.raw.prepare('SELECT count(*) AS n FROM workspaces').get().n, 1);
  assert.equal(linkRows(d1).length, 1);
});

test('a failure during the link batch rolls back: both workspaces intact and no link', async (t) => {
  if (!sqlite) return t.skip('node:sqlite unavailable');
  const chatgpt = { profiles: [prof('p1', 'Studio')], saved: [], seen: '' };
  const google = { profiles: [prof('p2', 'Kid')], saved: [sv('p2', 'g2')], seen: '' };
  for (const failOn of [/^DELETE FROM workspaces/, /^INSERT INTO workspaces/]) {
    const d1 = sqliteD1({ failOn });
    putWs(d1, 'chatgpt-user-1', chatgpt); putWs(d1, 'google:1234567890', google);
    const res = await linkFlow(d1LinkStore(d1));
    assert.equal(res.status, 409);
    assert.match(await res.text(), /Nothing was changed/);
    assert.deepEqual(getWs(d1, 'chatgpt-user-1'), chatgpt, String(failOn));
    assert.deepEqual(getWs(d1, 'google:1234567890'), google, String(failOn));
    assert.equal(linkRows(d1).length, 0, String(failOn));
  }
  // Too large to merge: refused before any write.
  const d1 = sqliteD1();
  const big = (p) => ({ profiles: Array.from({ length: 30 }, (_, i) => prof(p + i, p + i, { keywords: p + i })), saved: [], seen: '' });
  putWs(d1, 'chatgpt-user-1', big('c')); putWs(d1, 'google:1234567890', big('g'));
  const res = await linkFlow(d1LinkStore(d1));
  assert.equal(res.status, 409); assert.match(await res.text(), /over the limit/);
  assert.equal(getWs(d1, 'chatgpt-user-1').profiles.length, 30); assert.equal(getWs(d1, 'google:1234567890').profiles.length, 30); assert.equal(linkRows(d1).length, 0);
});

test('a concurrent edit during linking never loses data: the guarded batch writes nothing and retries', async (t) => {
  if (!sqlite) return t.skip('node:sqlite unavailable');
  // Every attempt sees the Google workspace change between read and batch: link gives up, nothing written.
  let n = 0;
  const d1 = sqliteD1({ beforeBatch: (db) => { putWs(db, 'google:1234567890', { profiles: [prof('p2', 'Kid'), prof('n' + n, 'Added ' + n++)], saved: [], seen: '' }); } });
  putWs(d1, 'chatgpt-user-1', { profiles: [prof('p1', 'Studio')], saved: [], seen: '' });
  putWs(d1, 'google:1234567890', { profiles: [prof('p2', 'Kid')], saved: [], seen: '' });
  await assert.rejects(d1LinkStore(d1).link('1234567890', 'chatgpt-user-1'), (e) => e.reason === 'busy');
  assert.deepEqual(getWs(d1, 'chatgpt-user-1').profiles.map((p) => p.id), ['p1']);
  assert.equal(getWs(d1, 'google:1234567890').profiles.length, 2);
  assert.equal(linkRows(d1).length, 0);
  // One concurrent edit, then quiet: the retry merges the newest data.
  let once = true;
  const d2 = sqliteD1({ beforeBatch: (db) => { if (once) { once = false; putWs(db, 'chatgpt-user-1', { profiles: [prof('p1', 'Studio'), prof('p9', 'Late')], saved: [], seen: '' }); } } });
  putWs(d2, 'chatgpt-user-1', { profiles: [prof('p1', 'Studio')], saved: [], seen: '' });
  putWs(d2, 'google:1234567890', { profiles: [prof('p2', 'Kid')], saved: [], seen: '' });
  await d2LinkCheck(d2);
});
async function d2LinkCheck(d2) {
  const r = await d1LinkStore(d2).link('1234567890', 'chatgpt-user-1');
  assert.equal(r.merged, true);
  assert.deepEqual(getWs(d2, 'chatgpt-user-1').profiles.map((p) => p.id), ['p1', 'p9', 'p2'], 'retry used the concurrent edit');
  assert.equal(getWs(d2, 'google:1234567890'), null);
}

// ---------- owner / MCP stay ChatGPT-only ----------
test('owner access rejects every Google identity, even one linked to the owner', async () => {
  const OWNER = access.OWNER_USER_ID;
  assert.equal(access.ownerAccess({ userId: OWNER }), true, 'ChatGPT owner, as returned by getChatGPTUser()');
  assert.equal(access.ownerAccess({ userId: OWNER, provider: 'chatgpt' }), true);
  const links = memoryLinks();
  await links.link('owner-google-sub', OWNER);
  const linkedOwner = await cu.resolveCurrentUser(null, `${session.SESSION_COOKIE}=${await session.signSession('owner-google-sub', SESSION_SECRET)}`, ENV, links.chatgptIdForSub);
  assert.equal(linkedOwner.userId, OWNER, 'linked Google opens the owner workspace...');
  assert.equal(access.ownerAccess(linkedOwner), false, '...but is never the owner');
  assert.equal(access.ownerAccess(linkedOwner, true), false);
  assert.equal(access.ownerAccess({ userId: 'google:' + OWNER }), false);
  assert.equal(access.ownerAccess({ userId: 'local_seedy', provider: 'google' }, true), false);
  assert.equal(access.ownerAccess(null), false);
});

test('admin, MCP and refresh never consult the Google session', () => {
  for (const f of ['lib/admin.ts', 'lib/access.ts', 'app/mcp/route.ts', 'app/api/refresh/route.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /from\s+['"][^'"]*(current-user|google|session)[^'"]*['"]/i, f);
    assert.doesNotMatch(src, /getCurrentUser|verifySession|__Host-icgg/, f);
  }
  assert.match(readFileSync('lib/admin.ts', 'utf8'), /ownerAccess\(await getChatGPTUser\(\)/);
  assert.match(readFileSync('app/mcp/route.ts', 'utf8'), /isOwner\(\)/);
  assert.match(readFileSync('app/api/workspace/route.ts', 'utf8'), /const owner=ownerAccess\(await getChatGPTUser\(\)/, 'workspace owner view uses ChatGPT only');
});

// ---------- signout / leakage / UI ----------
test('signout clears both cookies and can continue to the ChatGPT sign-out', () => {
  const r = g.handleSignout(new Request(`${ORIGIN}/auth/google/signout?return_to=%2Fterms`), ENV);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/terms');
  assert.deepEqual(setCookies(r).map((c) => c.split('=')[0]).sort(), ['__Host-icgg_google_oauth', '__Host-icgg_session']);
  assert.ok(setCookies(r).every((c) => c.includes('Max-Age=0')));
  const chained = g.handleSignout(new Request(`${ORIGIN}/auth/google/signout?chatgpt=1&return_to=%2F`, { method: 'POST' }), ENV);
  assert.equal(chained.status, 303);
  assert.equal(chained.headers.get('location'), '/signout-with-chatgpt?return_to=%2F');
  assert.equal(g.handleSignout(new Request(`${ORIGIN}/auth/google/signout?return_to=https://evil.example`), ENV).headers.get('location'), '/');
});

test('the client secret and session secret never appear in source, tests output or responses', async () => {
  const { loc, cookie, res } = await start();
  for (const s of [loc.toString(), cookie, JSON.stringify([...res.headers])]) {
    assert.ok(!s.includes(CLIENT_SECRET) && !s.includes(SESSION_SECRET));
  }
  const files = ['lib/google-auth.ts', 'lib/session.ts', 'lib/current-user.ts', 'lib/google-links.ts', 'app/current-user.ts', 'app/auth/google-env.ts'];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /GOCSPX-/, f);
    assert.doesNotMatch(src, /console\.(log|info|warn|error|debug)/, f);
  }
});

test('the Google button only renders when Google sign-in is enabled', () => {
  const src = readFileSync('app/dashboard.tsx', 'utf8');
  assert.match(src, /auth\.googleEnabled&&<a className="account-link" href="\/auth\/google\/start\?return_to=%2F">Continue with Google<\/a>/);
  // ChatGPT sign-in still goes through the shared helper (lib/signin-url.ts -> /signin-with-chatgpt).
  assert.match(src, /auth\.googleEnabled\?'Sign in with ChatGPT':'Sign in \/ Create account'/, 'ChatGPT sign-in is unchanged');
  assert.match(src, /<a className="account-link" href=\{signInUrl\('\/'\)\}>/, 'ChatGPT sign-in uses signInUrl');
  assert.match(readFileSync('lib/signin-url.ts', 'utf8'), /SIGN_IN_PATH = '\/signin-with-chatgpt'/);
  assert.match(src, /\/auth\/google\/start\?intent=link&return_to=%2F/);
  assert.match(readFileSync('app/robots.ts', 'utf8'), /"\/auth\/"/);
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
test('no user-facing GrantOS or Grantwell (MCP serverInfo name excepted)', () => {
  const files = ['app', 'components', 'public', 'lib'].flatMap(walk).filter((f) => /\.(tsx?|mjs|js|css|html|svg|json|txt|md)$/.test(f));
  assert.ok(files.length > 10);
  const hits = [];
  for (const f of files) {
    let src = readFileSync(f, 'utf8');
    if (f === join('app', 'mcp', 'route.ts')) {
      assert.match(src, /serverInfo:\{name:'grantwell'/, 'MCP serverInfo name is kept');
      src = src.replace("serverInfo:{name:'grantwell'", '');
    }
    if (/grant\s*os|grantwell/i.test(src)) hits.push(f);
  }
  assert.deepEqual(hits, []);
});

test('home first paint and /api/session (used by /grants pages) recognize a Google session too', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.match(page, /getCurrentUser\(\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(page, /getChatGPTUser/);
  const session = readFileSync('app/api/session/route.ts', 'utf8');
  assert.match(session, /const user = await getCurrentUser\(\)\.catch\(\(\) => null\);/);
  assert.doesNotMatch(session, /getChatGPTUser/);
});
