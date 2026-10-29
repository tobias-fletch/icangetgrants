// ChatGPT Sites host → icangetgrants.com: guest page views get a 301 to the same path and query; the plugin (/mcp),
// OAuth and sign-in, .well-known, /api, static assets, non-GET/HEAD, signed-in visitors, framed loads (the ChatGPT
// Sites preview), RSC/prefetch fetches and ChatGPT/OpenAI fetchers are never redirected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/host-redirect-tests'); mkdirSync(out, { recursive: true });
for (const name of ['site', 'host-redirect']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from ['"](\.\/[^'"]+)['"]/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const R = await import(pathToFileURL(`${out}/host-redirect.mjs`).href);

const SITES = 'grantwell-match.tobias-fletch.chatgpt.site';
const BROWSER = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' };
const req = (headers = {}, method = 'GET') => {
  const h = new Map(Object.entries({ host: SITES, ...BROWSER, ...headers }).filter(([, v]) => v !== undefined).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, headers: { get: n => (h.has(n.toLowerCase()) ? h.get(n.toLowerCase()) : null) } };
};
const loc = (path, search = '', headers, method) => R.sitesHostRedirectLocation(req(headers, method), path, search);

test('guest page views on the Sites host redirect to the same path on icangetgrants.com', () => {
  assert.equal(loc('/'), 'https://icangetgrants.com/');
  assert.equal(loc('/grants'), 'https://icangetgrants.com/grants');
  assert.equal(loc('/grants/new-york'), 'https://icangetgrants.com/grants/new-york');
  assert.equal(loc('/grants/new-york/scholarships'), 'https://icangetgrants.com/grants/new-york/scholarships');
  for (const p of ['/privacy', '/terms', '/contact']) assert.equal(loc(p), `https://icangetgrants.com${p}`);
});

test('query strings are kept exactly', () => {
  assert.equal(loc('/', '?q=Excelsior%20Scholarship'), 'https://icangetgrants.com/?q=Excelsior%20Scholarship');
  assert.equal(loc('/grants', '?page=2&utm_source=chatgpt.com'), 'https://icangetgrants.com/grants?page=2&utm_source=chatgpt.com');
  assert.equal(loc('/', 'q=pell'), 'https://icangetgrants.com/?q=pell');
});

test('HEAD redirects like GET; every other method is untouched', () => {
  assert.equal(loc('/', '?q=x', {}, 'HEAD'), 'https://icangetgrants.com/?q=x');
  assert.equal(loc('/', '', {}, 'head'), 'https://icangetgrants.com/');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(loc('/', '', {}, m), null, m);
});

test('a crawler or curl with no Sec-Fetch headers is redirected', () => {
  assert.equal(loc('/grants', '', { 'sec-fetch-dest': undefined, 'sec-fetch-mode': undefined, 'user-agent': 'Googlebot/2.1' }), 'https://icangetgrants.com/grants');
  assert.equal(loc('/', '', { 'sec-fetch-dest': undefined, 'user-agent': 'curl/8.5.0' }), 'https://icangetgrants.com/');
});

test('other hosts are never redirected by this rule', () => {
  for (const host of ['icangetgrants.com', 'www.icangetgrants.com', 'localhost:5173', '127.0.0.1:8787', 'other-app.tobias-fletch.chatgpt.site', `${SITES}.evil.example`, `x.${SITES}`])
    assert.equal(loc('/', '', { host }), null, host);
  assert.equal(loc('/', '', { host: 'GRANTWELL-MATCH.tobias-fletch.chatgpt.site:443' }), 'https://icangetgrants.com/');
  assert.equal(loc('/', '', { host: `${SITES}.` }), 'https://icangetgrants.com/');
});

test('the plugin, OAuth, sign-in, .well-known, API and static routes are excluded', () => {
  const excluded = [
    '/mcp', '/mcp/', '/mcp/sse', '/MCP',
    '/.well-known', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/.well-known/openai-apps-challenge',
    '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback',
    '/auth/google/start', '/auth/google/callback', '/auth/google/signout', '/auth/google/unlink',
    '/api/session', '/api/workspace', '/api/refresh', '/api/discover', '/api/usage-event', '/api/usage-daily',
    '/_next/static/chunks/index-7bP9z7Oj.js', '/_next/static/css/index.DrCO_udO.css', '/_vinext/x', '/assets/widget.js', '/cdn-cgi/rum',
    '/favicon.ico', '/favicon.svg', '/og.png', '/robots.txt', '/sitemap.xml', '/file.svg', '/widget.html',
  ];
  for (const p of excluded) {
    assert.equal(R.isExcludedPath(p), true, p);
    assert.equal(loc(p, '?x=1'), null, p);
    assert.equal(loc(p, '', {}, 'HEAD'), null, `HEAD ${p}`);
  }
  for (const p of ['/', '/grants', '/grants/california', '/privacy', '/contact', '/apifoo', '/mcpx', '/authors'])
    assert.equal(R.isExcludedPath(p), false, p);
});

test('signed-in visitors stay on the Sites host (their sessions are host-only)', () => {
  assert.equal(loc('/', '', { 'oai-authenticated-user-id': 'user_123' }), null);
  assert.equal(loc('/', '', { 'oai-authenticated-user-email': 'a@b.test' }), null);
  assert.equal(loc('/', '', { cookie: 'a=1; __Host-icgg_session=abc' }), null);
  assert.equal(loc('/', '', { cookie: '__Host-icgg_google_oauth=abc' }), null);
  assert.equal(loc('/', '', { authorization: 'Bearer abc' }), null);
  // Unrelated cookies (Cloudflare bot management, analytics) do not count as signed in.
  assert.equal(loc('/', '', { cookie: '__cf_bm=x; foo=bar; __Host-icgg_sessionx=1' }), 'https://icangetgrants.com/');
});

test('framed, fetch, RSC and prefetch loads (ChatGPT Sites preview, widgets, client navigation) stay put', () => {
  for (const dest of ['iframe', 'frame', 'embed', 'object', 'empty', 'script', 'style', 'image', 'worker'])
    assert.equal(loc('/', '', { 'sec-fetch-dest': dest, referer: 'https://chatgpt.com/' }), null, dest);
  assert.equal(loc('/grants', '', { rsc: '1' }), null);
  assert.equal(loc('/grants', '', { 'next-router-prefetch': '1' }), null);
  assert.equal(loc('/grants', '', { 'next-router-state-tree': '%5B%5D' }), null);
  assert.equal(loc('/grants', '', { 'x-middleware-prefetch': '1' }), null);
  assert.equal(loc('/grants', '', { 'sec-purpose': 'prefetch;prerender' }), null);
  assert.equal(loc('/grants', '', { purpose: 'prefetch' }), null);
});

test('ChatGPT and OpenAI fetchers are not redirected; a person following a chatgpt.com link is', () => {
  for (const ua of ['Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0; +https://openai.com/bot', 'OAI-SearchBot/1.0', 'GPTBot/1.1', 'OpenAI-MCP/1.0'])
    assert.equal(loc('/', '', { 'user-agent': ua, 'sec-fetch-dest': undefined }), null, ua);
  assert.equal(loc('/', '', { referer: 'https://chatgpt.com/' }), 'https://icangetgrants.com/');
});

test('a path cannot escape icangetgrants.com', () => {
  assert.equal(loc('//evil'), 'https://icangetgrants.com/');
  assert.equal(loc('/\\evil', '?x=1'), 'https://icangetgrants.com/');
  assert.equal(loc('//evil.example'), null); // file-like last segment: served as is, never sent off-site
  assert.equal(new URL(loc('/grants', '?next=https://evil.example')).origin, 'https://icangetgrants.com');
});

test('proxy applies the Sites redirect first, as an uncacheable 301', () => {
  const src = readFileSync('proxy.ts', 'utf8');
  const at = src.indexOf('sitesHostRedirectLocation(request, pathname, search)');
  assert.ok(at > 0 && at < src.indexOf('apexRedirectLocation(request.headers.get("host")'));
  const block = src.slice(at, src.indexOf('return response;', at));
  assert.match(block, /NextResponse\.redirect\(sitesLocation, 301\)/);
  assert.match(block, /"Cache-Control", "private, no-store"/);
});
