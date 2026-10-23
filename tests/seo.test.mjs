// /grants SEO pages: page set, thresholds, canonical URLs, sitemap, JSON-LD, D1 query budget, sign-in helper,
// save-profile hand-off and the brand-name guard. Data: tests/fixtures/catalog-2026-10-23.json (public catalog export).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/seo-tests'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'listing', 'site', 'access', 'seo-taxonomy', 'seo-index', 'seo-store', 'signin-url', 'save-profile']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from ['"](\.\/[^'"]+)['"]/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const load = n => import(pathToFileURL(`${out}/${n}.mjs`).href);
const S = await load('seo-index');
const T = await load('seo-taxonomy');
const Store = await load('seo-store');
const { signInUrl, safeReturnPath, SIGN_IN_PATH } = await load('signin-url');
const SP = await load('save-profile');
const { seeds } = await load('grants');

const fx = JSON.parse(readFileSync('tests/fixtures/catalog-2026-10-23.json', 'utf8'));
const now = new Date(fx.fetchedAt); // 2026-10-23T22:00:00Z
const index = S.buildSeoIndex(fx.grants, fx.refresh, now);
const site = S.computeSeoSite(index, now);
const byStatus = st => [...site.pages.values()].filter(p => p.status === st).map(p => p.path).sort();

test('the spec §2.4 page set is reproduced from the 2026-10-23 catalog', () => {
  const categories = ['scholarships', 'small-business', 'arts-writing', 'nonprofit', 'science-research', 'student-aid', 'graduate', 'undergraduate', 'high-school', 'vocational', 'health', 'women', 'fellowships'];
  const expected = [
    ...categories.map(c => `/grants/${c}`),
    '/grants/louisiana', '/grants/new-york',
    '/grants/louisiana/student-aid', '/grants/louisiana/graduate', '/grants/louisiana/undergraduate', '/grants/louisiana/high-school',
  ].sort();
  assert.deepEqual(byStatus('indexable'), expected);
  assert.deepEqual(byStatus('review'), ['/grants/louisiana/science-research']);
  assert.equal(site.pages.get('/grants/federal').status, 'duplicate');
  assert.equal(site.pages.get('/grants/awards-competitions').status, 'duplicate');
  assert.equal(site.pages.get('/grants/louisiana').count, 44);
  assert.equal(site.pages.get('/grants/new-york').count, 4);
  // 21 pages = hub + 19 indexable + louisiana/science-research (served, noindex)
  assert.equal(1 + expected.length + 1, 21);
  assert.equal(S.seoSitemapPaths(site).length, 20);
});

test('closed and expired listings are excluded, and the threshold is 3 open listings', () => {
  assert.ok(Object.values(index.listings).every(l => /^https?:\/\//.test(l.url)));
  const closed = fx.grants.filter(g => (g.status || '').toLowerCase() === 'closed').map(g => g.id);
  for (const id of closed) assert.equal(index.listings[id], undefined, id);
  // Re-applied at request time: a listing whose deadline passes after the index was built drops out.
  const later = new Date('2027-12-31T12:00:00Z');
  const lateSite = S.computeSeoSite(index, later);
  assert.ok(lateSite.open.length < site.open.length);
  for (const p of site.pages.values()) if (p.count < T.SEO_THRESHOLD) assert.notEqual(p.status, 'indexable', p.path);
  for (const p of byStatus('thin')) assert.ok(site.pages.get(p).count >= 1);
});

test('unknown slugs and pages with 0 open listings 404; thin pages are noindex,follow', () => {
  assert.equal(S.findSeoPage(site, ['not-a-topic']), null);
  assert.equal(S.findSeoPage(site, ['louisiana', 'nope']), null);
  assert.equal(S.findSeoPage(site, ['scholarships', 'graduate']), null);
  assert.equal(S.findSeoPage(site, ['wyoming']), null); // no Wyoming-specific listings today
  const thin = S.findSeoPage(site, ['louisiana', 'arts-writing']);
  assert.ok(thin && thin.status === 'thin');
  const c = S.seoContent(site, thin);
  assert.equal(c.indexable, false);
  assert.ok(c.thinNote);
  const review = S.seoContent(site, S.findSeoPage(site, ['louisiana', 'science-research']));
  assert.equal(review.indexable, false);
});

test('category and state slugs never collide', () => {
  const cats = new Set(T.SEO_CATEGORIES.map(c => c.slug));
  for (const slug of T.STATE_BY_SLUG.keys()) assert.ok(!cats.has(slug), slug);
  assert.equal(T.SEO_CATEGORIES.length, 15);
});

test('one canonical URL per page: lowercase, full state slug, no trailing slash', () => {
  assert.equal(T.seoCanonicalRedirect('/grants/NY'), '/grants/new-york');
  assert.equal(T.seoCanonicalRedirect('/grants/la/Graduate'), '/grants/louisiana/graduate');
  assert.equal(T.seoCanonicalRedirect('/grants/Scholarships'), '/grants/scholarships');
  assert.equal(T.seoCanonicalRedirect('/grants/scholarships/'), '/grants/scholarships');
  assert.equal(T.seoCanonicalRedirect('/grants/scholarships'), null);
  assert.equal(T.seoCanonicalRedirect('/grants/nope'), null);
  assert.equal(T.seoCanonicalRedirect('/privacy'), null);
});

test('titles, descriptions and copy follow the templates and wording rules', () => {
  const pages = [...site.pages.values()];
  const banned = /\b(guarantee[sd]?|eligible for|you qualify|free forever|email alert|sms|push notification|grant ?os|grantwell)\b/i;
  for (const p of pages) {
    const c = S.seoContent(site, p);
    assert.ok(c.title.length <= 60, `${p.path} title ${c.title.length}`);
    assert.ok(c.description.length <= 155, `${p.path} description ${c.description.length}`);
    assert.ok(c.title.endsWith('I Can Get Grants'), p.path);
    assert.ok(c.listings.length <= 100);
    for (const s of [c.title, c.description, c.h1, ...c.intro, c.thinNote || '', c.ctaLabel]) assert.ok(!banned.test(s), `${p.path}: ${s}`);
    assert.ok(c.listings.every(l => !/&(amp|#\d+|quot);/.test(l.title)), 'entities decoded');
  }
  const la = S.seoContent(site, site.pages.get('/grants/louisiana'));
  assert.equal(la.ctaLabel, 'Save a Louisiana profile and get new-match alerts');
  assert.equal(la.nationwide.sample.length, 10);
  assert.deepEqual(la.crumbs.map(c => c.name), ['Home', 'Grants', 'Louisiana']);
  const grad = S.seoContent(site, site.pages.get('/grants/louisiana/graduate'));
  assert.deepEqual(grad.crumbs.map(c => c.name), ['Home', 'Grants', 'Louisiana', 'Graduate & doctoral']);
  assert.equal(grad.ctaReturn, '/?save=1&state=Louisiana&type=Student&cat=graduate');
  assert.match(S.seoContent(site, site.pages.get('/grants/scholarships')).refreshedLine, /^Catalog last refreshed .* ET$/);
});

test('JSON-LD is CollectionPage + BreadcrumbList + ItemList, never Grant markup', () => {
  const page = site.pages.get('/grants/louisiana');
  const c = S.seoContent(site, page);
  const ld = S.seoJsonLd({ path: page.path, name: c.h1, description: c.description, crumbs: c.crumbs, items: c.listings.map(l => ({ name: l.title, url: l.url })), dateModified: site.refreshedAt });
  assert.deepEqual(ld['@graph'].map(n => n['@type']), ['CollectionPage', 'BreadcrumbList', 'ItemList']);
  assert.equal(ld['@graph'][0].url, 'https://icangetgrants.com/grants/louisiana');
  assert.equal(ld['@graph'][0].dateModified, fx.refresh.checkedAt);
  assert.equal(ld['@graph'][2].itemListElement[0].url, c.listings[0].url);
  const text = S.jsonLdScript(ld);
  assert.ok(!/MonetaryGrant|"Grant"/.test(text));
  assert.ok(!text.includes('</script'));
});

test('sitemap lists /grants and indexable pages only', () => {
  const paths = S.seoSitemapPaths(site);
  assert.equal(paths[0], '/grants');
  for (const p of paths.slice(1)) assert.equal(site.pages.get(p).status, 'indexable', p);
  assert.ok(!paths.includes('/grants/louisiana/science-research'));
  assert.ok(!paths.includes('/grants/federal'));
  assert.deepEqual(S.seoSitemapPaths(null), []);
  const src = readFileSync('app/sitemap.ts', 'utf8');
  assert.match(src, /dynamic = "force-dynamic"/);
  assert.match(src, /seoSitemapPaths/);
});

function fakeDb(rows) {
  const calls = [];
  const stmt = sql => ({
    args: [],
    bind(...a) { this.args = a; return this; },
    async first() { calls.push(sql); const id = this.args[0]; return rows.jobs[id] ? { data: rows.jobs[id] } : null; },
    async all() { calls.push(sql); return { results: [...rows.catalog.map(d => ({ t: 'c', data: d })), ...(rows.jobs['last-refresh'] ? [{ t: 'r', data: rows.jobs['last-refresh'] }] : [])] }; },
    async run() { calls.push(sql); rows.jobs[this.args[0]] = this.args[1]; return {}; },
  });
  return { calls, prepare: sql => stmt(sql) };
}

test('page requests cost 1 D1 query (2 on fallback, 0 when memoised) and never write', async () => {
  const catalog = fx.grants.map(g => JSON.stringify(g));
  const refresh = JSON.stringify({ checkedAt: fx.refresh.checkedAt });
  Store.resetSeoMemo();
  const db = fakeDb({ catalog, jobs: { 'seo-index': JSON.stringify(index), 'last-refresh': refresh } });
  const t0 = Date.parse(fx.fetchedAt);
  const r1 = await Store.readSeoIndex(db, t0);
  assert.equal(r1.d1Queries, 1); assert.equal(r1.source, 'seo-index'); assert.equal(db.calls.length, 1);
  const r2 = await Store.readSeoIndex(db, t0 + 1000);
  assert.equal(r2.d1Queries, 0); assert.equal(db.calls.length, 1);
  Store.resetSeoMemo();
  const broken = fakeDb({ catalog, jobs: { 'seo-index': '{"version":0}', 'last-refresh': refresh } });
  const r3 = await Store.readSeoIndex(broken, t0);
  assert.equal(r3.d1Queries, 2); assert.equal(r3.source, 'catalog-fallback'); assert.equal(broken.calls.length, 2);
  assert.ok(broken.calls.every(sql => /^SELECT/.test(sql)), 'no writes from a GET');
  assert.equal(S.computeSeoSite(r3.index, now).pages.get('/grants/louisiana').status, 'indexable');
  Store.resetSeoMemo();
  const missing = fakeDb({ catalog, jobs: { 'last-refresh': refresh } });
  assert.equal((await Store.readSeoIndex(missing, t0)).d1Queries, 2);
  // The refresh writes exactly one row.
  const w = fakeDb({ catalog: [], jobs: {} });
  await Store.writeSeoIndex(w, fx.grants, fx.refresh, now);
  assert.deepEqual(w.calls.length, 1); assert.match(w.calls[0], /^INSERT INTO jobs/);
  Store.resetSeoMemo();
});

test('refresh hooks write the seo-index row once per refresh', () => {
  const discovery = readFileSync('lib/discovery.ts', 'utf8');
  assert.equal((discovery.match(/writeSeoIndex\(/g) || []).length, 1);
  assert.equal((readFileSync('lib/state-research.ts', 'utf8').match(/rebuildSeoIndex\(/g) || []).length, 1);
  assert.ok(!/fetch\(/.test(readFileSync('lib/seo-store.ts', 'utf8')), 'no outbound fetches');
  assert.ok(!/fetch\(/.test(readFileSync('app/grants/seo-data.ts', 'utf8')), 'no outbound fetches');
  assert.ok(!/workspaces/.test(readFileSync('lib/seo-store.ts', 'utf8')), 'never reads private workspaces');
});

test('signInUrl builds the one sign-in link and only accepts same-site return paths', () => {
  assert.equal(signInUrl(), '/signin-with-chatgpt?return_to=%2F');
  assert.equal(signInUrl('/grants/louisiana'), '/signin-with-chatgpt?return_to=%2Fgrants%2Flouisiana');
  assert.equal(signInUrl('/?save=1&state=New York&type=Student&cat=graduate'), '/signin-with-chatgpt?return_to=%2F%3Fsave%3D1%26state%3DNew%2520York%26type%3DStudent%26cat%3Dgraduate');
  for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/signin-with-chatgpt?return_to=/x', '/callback', '']) assert.equal(safeReturnPath(bad), '/', bad);
  assert.equal(SIGN_IN_PATH, '/signin-with-chatgpt');
});

test('every "Save your profile" link goes through signInUrl', () => {
  const files = ['components/seo-session.tsx', 'app/dashboard.tsx', 'app/grants/landing.tsx', 'app/grants/page.tsx'];
  for (const f of files) assert.ok(!readFileSync(f, 'utf8').includes('/signin-with-chatgpt'), `${f} hard-codes the sign-in path`);
  assert.match(readFileSync('components/seo-session.tsx', 'utf8'), /signInUrl\(returnTo\)/);
  assert.match(readFileSync('app/dashboard.tsx', 'utf8'), /signInUrl\(homeSaveReturn\(beta\)\)/);
});

test('save=1 opens a prefilled editor (alerts on, United States) and prefers the stored beta search', () => {
  const base = { id: '', name: '', type: 'Small business', country: '', state: '', keywords: '', goal: 5000, education: '', details: '', alerts: false };
  assert.equal(SP.saveProfilePrefill('?q=1', null, base), null);
  const p = SP.saveProfilePrefill('?save=1&state=Louisiana&type=Student&cat=graduate', null, base);
  assert.equal(p.state, 'Louisiana'); assert.equal(p.type, 'Student'); assert.equal(p.education, 'Graduate');
  assert.equal(p.country, 'United States'); assert.equal(p.alerts, true); assert.equal(p.id, '');
  const q = SP.saveProfilePrefill('?save=1&state=Louisiana&type=Student', JSON.stringify({ type: 'Nonprofit', state: 'NY', keywords: 'arts' }), base);
  assert.equal(q.state, 'New York'); assert.equal(q.type, 'Nonprofit'); assert.equal(q.keywords, 'arts');
  assert.equal(SP.saveProfilePrefill('?save=1&state=Atlantis&type=Hacker', '{bad', base).state, '');
  assert.equal(SP.homeSaveReturn({ state: 'la', type: 'Student' }), '/?save=1&state=Louisiana&type=Student');
  assert.equal(SP.homeSaveReturn(null), '/?save=1');
});

function walk(dir) {
  return readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
test('no user-facing "GrantOS" or "Grantwell" (only the MCP serverInfo name is allowed)', () => {
  const brand = /grant\s?os\b|grantwell/i;
  const allowed = new Set(['app/mcp/route.ts']);
  const hits = [];
  for (const root of ['app', 'components', 'lib', 'public']) {
    for (const file of walk(root)) {
      const rel = relative('.', file).split('\\').join('/');
      if (allowed.has(rel) || /\.(png|ico|jpg|webp)$/.test(rel)) continue;
      if (brand.test(readFileSync(file, 'utf8'))) hits.push(rel);
    }
  }
  assert.deepEqual(hits, []);
  assert.match(readFileSync('app/mcp/route.ts', 'utf8'), /serverInfo:\{name:'grantwell'/);
  for (const g of [...seeds, ...fx.grants]) assert.ok(!brand.test(`${g.title} ${g.funder}`), g.id);
});

test('favicon.ico exists and CLS loading screen is gone', () => {
  const ico = readFileSync('public/favicon.ico');
  assert.equal(ico.readUInt16LE(2), 1); // ICO type
  assert.throws(() => statSync('app/loading.tsx'));
});
