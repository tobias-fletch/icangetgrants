// Home speed fix: the home page renders the first 24 ranked results plus the totals, later pages come from the
// cacheable /api/workspace?public=1 API, and /grants?page=N lists every open listing without JavaScript.
// Data: tests/fixtures/catalog-2026-10-23.json (public catalog export).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/home-pagination-tests'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'listing', 'site', 'access', 'state-registry', 'workspace-privacy', 'fetch-budget', 'state-discovery', 'catalog-sweep', 'seo-taxonomy', 'seo-exclude', 'seo-index', 'home-search', 'catalog-geo', 'home-results', 'home-cache', 'listing-pages']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from ['"](\.\/[^'"]+)['"]/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const load = n => import(pathToFileURL(`${out}/${n}.mjs`).href);
const S = await load('seo-index');
const R = await load('home-results');
const C = await load('home-cache');
const P = await load('listing-pages');
const H = await load('home-search');
const { isOpenGrant, withDeadlineStatus, relevanceScore } = await load('listing');
const { isHiddenListing } = await load('catalog-sweep');
const { visitorGrants } = await load('workspace-privacy');

// Mirrors loadCatalog()/loadPublicCatalog(): visitor view, deadline status, hidden rows dropped, then the junk filter.
const apiList = (grants, now, keep = new Set()) =>
  S.publicCatalog(visitorGrants(grants).map(g => withDeadlineStatus(g, now)).filter(g => !isHiddenListing(g, now.getTime())), keep, now);
const fx = JSON.parse(readFileSync('tests/fixtures/catalog-2026-10-23.json', 'utf8'));
const now = new Date(fx.fetchedAt);
const catalog = apiList(fx.grants, now).filter(g => /^https?:/i.test(g.url || ''));
const site = S.computeSeoSite(S.buildSeoIndex(fx.grants, fx.refresh, now), now);
const read = f => readFileSync(f, 'utf8');

test('pages of 24 cover every ranked result exactly once, in order', () => {
  const ranked = R.rankGrants(catalog, R.NO_FILTERS, [], undefined, now);
  const first = R.pageOf(ranked, 1);
  assert.equal(R.HOME_PAGE_SIZE, 24);
  assert.equal(first.grants.length, 24);
  assert.equal(first.total, ranked.length);
  assert.equal(first.pages, Math.ceil(ranked.length / 24));
  const all = [];
  for (let p = 1; p <= first.pages; p++) all.push(...R.pageOf(ranked, p).grants.map(g => g.id));
  assert.deepEqual(all, ranked.map(x => x.g.id));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(R.pageOf(ranked, first.pages + 1).grants, []);
  assert.equal(R.pageOf([], 1).pages, 1);
});

test('home, the page API and /grants count the same open listings (junk filter included)', () => {
  const total = R.pageOf(R.rankGrants(catalog, R.NO_FILTERS, [], undefined, now), 1).total;
  assert.equal(total, site.open.length);
  assert.equal(total, S.hubContent(site).openCount);
  assert.equal(total, R.homeListable(catalog, now).length);
  // /grants?page=N lists the same set
  const lp1 = P.listingPage(site, 1);
  const ids = [];
  for (let p = 1; p <= lp1.pages; p++) ids.push(...P.listingPage(site, p).items.map(l => l.id));
  assert.equal(lp1.total, total);
  assert.deepEqual([...ids].sort(), R.homeListable(catalog, now).map(g => g.id).sort());
  for (const id of ['state-la-aid-bf175ec8', 'state-la-aid-6d3d1e8', 'state-la-aid-f451965a']) { assert.ok(!ids.includes(id), id); assert.ok(!catalog.some(g => g.id === id), id); }
  // a junk row kept for an account's tracker is marked searchHidden and never paged
  const kept = apiList(fx.grants, now, new Set(['state-la-aid-bf175ec8']));
  assert.ok(kept.find(g => g.id === 'state-la-aid-bf175ec8')?.searchHidden);
  assert.ok(!R.rankGrants(kept, R.NO_FILTERS, [], undefined, now).some(x => x.g.id === 'state-la-aid-bf175ec8'));
});

test('ranking matches the dashboard rules: keyword relevance first, filters, sorts, state', () => {
  const q = R.rankGrants(catalog, { query: 'scholarship' }, [], undefined, now);
  assert.ok(q.length > 0 && q.length < R.homeListable(catalog, now).length);
  for (let i = 1; i < q.length; i++) assert.ok(q[i - 1].relevance >= q[i].relevance);
  assert.equal(q.length, R.homeListable(catalog, now).filter(g => relevanceScore(g, 'scholarship') > 0).length);
  const big = R.rankGrants(catalog, { sort: 'Largest award', min: 5000 }, [], undefined, now);
  for (const x of big) assert.ok((x.g.amount || 0) >= 5000);
  for (let i = 1; i < big.length; i++) assert.ok((big[i - 1].g.amount || 0) >= (big[i].g.amount || 0));
  const kind = R.rankGrants(catalog, { kind: 'Scholarship' }, [], undefined, now);
  assert.ok(kind.length && kind.every(x => x.g.kind === 'Scholarship'));
  const state = H.searchStates(R.homeListable(catalog, now))[0];
  const st = R.rankGrants(catalog, { state }, [], undefined, now);
  assert.ok(st.length && st.every(x => H.availableInState(x.g, state)));
  // the dashboard's in-browser ranking (used once the whole catalog is loaded) keeps the same clauses
  const dash = read('app/dashboard.tsx'), lib = read('lib/home-results.ts');
  for (const clause of ['(!terms.length||x.relevance>0)', "(kind==='All funding'||x.g.kind===kind)", '(!min||(x.g.amount||0)>=min)', 'matchesPlace(x.g,cityFilter,countyFilter)', 'availableInState(x.g,stateFilter)', 'if(terms.length&&a.relevance!==b.relevance)return b.relevance-a.relevance;', "if(sort==='Largest award')return (b.g.amount||0)-(a.g.amount||0);", "if(sort==='Deadline')return deadlineSortKey(a.g.deadline,now).localeCompare(deadlineSortKey(b.g.deadline,now));"]) {
    assert.ok(dash.includes(clause), 'dashboard: ' + clause);
  }
  const lib2 = lib.replace(/\s+/g, '');
  for (const clause of ['(!terms.length||x.relevance>0)', "(o.kind==='Allfunding'||x.g.kind===o.kind)", '(!o.min||(x.g.amount||0)>=o.min)', 'matchesPlace(x.g,o.city,o.county)', 'availableInState(x.g,o.state)', 'if(terms.length&&a.relevance!==b.relevance)returnb.relevance-a.relevance;', "if(o.sort==='Largestaward')return(b.g.amount||0)-(a.g.amount||0);", "if(o.sort==='Deadline')returndeadlineSortKey(a.g.deadline,now).localeCompare(deadlineSortKey(b.g.deadline,now));", 'return(b.fit?.score||0)-(a.fit?.score||0);'])
    assert.ok(lib2.includes(clause), 'lib: ' + clause);
});

test("'Opens soon' listings stay in the paged results with their marking", () => {
  const base = catalog.find(g => g.status === 'Open') || catalog[0];
  const opens = withDeadlineStatus({ ...base, id: 'opens-soon-x', status: 'Opens soon', opensOn: '2026-11-10', deadline: '2026-12-15' }, now);
  const list = [opens, ...catalog];
  if (isOpenGrant(opens, now)) {
    const all = R.rankGrants(list, R.NO_FILTERS, [], undefined, now).map(x => x.g);
    const hit = all.find(g => g.id === 'opens-soon-x');
    assert.ok(hit);
    assert.equal(hit.status, opens.status);
  }
  const dash = read('app/dashboard.tsx');
  assert.equal(dash.split("status==='Opens soon'&&<span className=\"opens-soon-badge\">").length - 1, 2);
});

test('the page API query is sanitized and round-trips', () => {
  const f = { query: 'scholarship', kind: 'Scholarship', min: 500, sort: 'Deadline', city: 'Austin, TX', county: '', state: 'Texas' };
  const qs = R.resultsQueryString(f, 3);
  const back = R.parseResultsQuery(new URLSearchParams(qs));
  assert.deepEqual({ ...back, page: undefined, pageSize: undefined }, { ...f, page: undefined, pageSize: undefined });
  assert.equal(back.page, 3); assert.equal(back.pageSize, 24);
  assert.match(qs, /^public=1&page=3&pageSize=24/);
  assert.equal(R.resultsQueryString(R.NO_FILTERS, 1), 'public=1&page=1&pageSize=24');
  const bad = R.parseResultsQuery(new URLSearchParams('public=1&page=-2&pageSize=100000&sort=DROP&kind=<x>&min=abc&q=' + 'a'.repeat(999)));
  assert.equal(bad.page, 1); assert.equal(bad.pageSize, R.MAX_PAGE_SIZE); assert.equal(bad.sort, 'Best fit'); assert.equal(bad.kind, 'All funding'); assert.equal(bad.min, 0);
  assert.equal(bad.query.length, H.MAX_QUERY);
  assert.equal(R.parseResultsQuery(new URLSearchParams('page=5000&pageSize=500')).pageSize, R.MAX_PAGE_SIZE);
  assert.equal(R.parseResultsQuery(new URLSearchParams('page=5000')).page, R.MAX_PAGE);
  assert.notEqual(R.filtersKey(f), R.filtersKey({ ...f, query: 'grant' }));
  assert.equal(R.filtersKey(f), R.filtersKey({ ...f, query: ' scholarship ' }));
});

test('cache headers: guest home and the public API are briefly cacheable; signed-in is never cached', () => {
  const h = o => ({ get: n => o[n.toLowerCase()] ?? null });
  assert.equal(C.GUEST_HTML_CACHE_CONTROL, 'public, s-maxage=300, stale-while-revalidate=600');
  assert.equal(C.PUBLIC_API_CACHE_CONTROL, 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  assert.equal(C.homeCacheControl(h({})), C.GUEST_HTML_CACHE_CONTROL);
  assert.equal(C.homeCacheControl(h({ cookie: '_ga=1; theme=dark' })), C.GUEST_HTML_CACHE_CONTROL);
  assert.equal(C.homeCacheControl(h({ 'oai-authenticated-user-id': 'user-1' })), 'private, no-store');
  assert.equal(C.homeCacheControl(h({ 'oai-authenticated-user-email': 'a@b.c' })), 'private, no-store');
  assert.equal(C.homeCacheControl(h({ cookie: '_ga=1; __Host-icgg_session=abc.def' })), 'private, no-store');
  assert.equal(C.homeCacheControl(h({ cookie: '__Host-icgg_session=garbage' })), 'private, no-store'); // even an invalid one
  assert.doesNotMatch(C.GUEST_HTML_CACHE_CONTROL, /max-age=(?!.*s-maxage)/); // no browser max-age on the HTML
  assert.match(read('lib/session.ts'), /SESSION_COOKIE = '__Host-icgg_session'/); // same cookie the session uses
  // wiring
  const proxy = read('proxy.ts');
  assert.match(proxy, /if \(pathname === "\/"\) \{\s*response\.headers\.set\("Cache-Control", homeCacheControl\(request\.headers\)\);\s*response\.headers\.append\("Vary", "Cookie, oai-authenticated-user-id"\);/);
  const route = read('app/api/workspace/route.ts');
  const pub = route.slice(route.indexOf('async function publicResults'), route.indexOf('export async function GET'));
  assert.match(pub, /'Cache-Control':loaded\.error\?'no-store':PUBLIC_API_CACHE_CONTROL/);
  assert.match(pub, /loadPublicCatalog\(\)/);
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function PUT'));
  assert.match(get, /\{headers:\{'Cache-Control':'private, no-store'\}\}/); // the workspace itself stays private
  // the memo never keeps an error or the built-in fallback
  assert.match(read('lib/catalog.ts'), /publicMemo = value\.source === 'd1' && !value\.error \? \{ at, value \} : null;/);
});

test('/grants?page=N: crawlable pages, self-canonical titles, prev/next links and 404 cache for bad pages', () => {
  assert.equal(P.parseListingPage(undefined), undefined);
  assert.equal(P.parseListingPage('2'), 2);
  for (const bad of ['0', '-1', 'abc', '1.5', '', '01']) assert.equal(P.parseListingPage(bad), null, bad);
  const pages = P.listingPageCount(site);
  const p1 = P.listingPage(site, 1), last = P.listingPage(site, pages);
  assert.equal(p1.items.length, Math.min(24, site.open.length));
  assert.equal(p1.prev, null); assert.equal(p1.next, pages > 1 ? '/grants?page=2' : null);
  assert.equal(last.next, null);
  assert.equal(P.listingPage(site, pages + 1), null);
  assert.equal(p1.path, '/grants?page=1');
  assert.match(p1.title, /^All open grant listings, page 1 of \d+ · I Can Get Grants$/);
  assert.deepEqual(p1.items.map(l => l.id), S.sortListings(site.open, site.now).slice(0, 24).map(l => l.id));
  assert.equal(P.listingPageCacheControl(site, '1'), S.SEO_CACHE_CONTROL);
  assert.equal(P.listingPageCacheControl(site, String(pages + 1)), S.SEO_NOT_FOUND_CACHE_CONTROL);
  assert.equal(P.listingPageCacheControl(site, 'abc'), S.SEO_NOT_FOUND_CACHE_CONTROL);
  assert.equal(P.listingPageCacheControl(null, '1'), S.SEO_NOT_FOUND_CACHE_CONTROL);
  const hub = read('app/grants/page.tsx');
  assert.match(hub, /<a rel="prev" href=\{lp\.prev\}>/); assert.match(hub, /<a rel="next" href=\{lp\.next\}>/);
  assert.match(hub, /href=\{listingPagePath\(1\)\}/);
  assert.match(hub, /if \(!lp\) notFound\(\);/);
  assert.match(read('app/grants/seo-data.ts'), /metadataFor\(lp\.path, lp\.title, lp\.description, true\)/);
  assert.match(read('app/dashboard.tsx'), /<a className="browse-all-link" href="\/grants\?page=1">/);
  assert.match(read('proxy.ts'), /listingPageCacheControl\(site, request\.nextUrl\.searchParams\.get\("page"\)\)/);
});

test('home renders one page and the totals, not the whole catalog', () => {
  const page = read('app/page.tsx');
  assert.match(page, /pageOf\(rankGrants\(catalog\.grants, \{ query: search\.q, state: search\.state \}, \[\], undefined, now\), 1, HOME_PAGE_SIZE\)/);
  assert.match(page, /initialGrants=\{first\.grants\}/);
  assert.match(page, /initialComplete=\{false\}/);
  assert.match(page, /initialTotal=\{first\.total\}/);
  assert.doesNotMatch(page, /initialGrants=\{catalog\.grants\}/);
  const dash = read('app/dashboard.tsx');
  assert.match(dash, /<span className="count">\{resultCount\}<\/span>/);
  assert.match(dash, /const resultCount=usePaged\?paged\.total:listed\.length;/);
  assert.match(dash, /fetch\('\/api\/workspace\?lite=1'\)/);
  assert.match(dash, /initialComplete\|\|initialAuthenticated\?load\(\):loadLite\(\)/);
  // sign-in buttons unchanged
  assert.match(dash, /auth\.googleEnabled&&<a className="account-link" href="\/auth\/google\/start\?return_to=%2F">Continue with Google<\/a>/);
  assert.match(dash, /auth\.googleEnabled\?'Sign in with ChatGPT':'Sign in \/ Create account'/);
});
