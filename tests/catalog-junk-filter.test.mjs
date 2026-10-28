// One public list: the /grants junk filter (lib/seo-exclude.ts) also applies to the public catalog that feeds
// /api/workspace, home search and the dashboard counts (lib/catalog.ts -> publicCatalog in lib/seo-index.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/junk-tests'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'listing', 'site', 'access', 'state-registry', 'workspace-privacy', 'fetch-budget', 'state-discovery', 'catalog-sweep', 'seo-taxonomy', 'seo-exclude', 'seo-index']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from ['"](\.\/[^'"]+)['"]/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const load = n => import(pathToFileURL(`${out}/${n}.mjs`).href);
const S = await load('seo-index');
const { isOpenGrant, withDeadlineStatus } = await load('listing');
const { isHiddenListing } = await load('catalog-sweep');
const { visitorGrants } = await load('workspace-privacy');

// Mirrors loadCatalog(): visitor view, deadline status, hidden rows dropped, then the junk filter.
const apiList = (grants, now, keep = new Set()) =>
  S.publicCatalog(visitorGrants(grants).map(g => withDeadlineStatus(g, now)).filter(g => !isHiddenListing(g, now.getTime())), keep, now);
// What home search counts ("Opportunities"): open and not searchHidden (app/dashboard.tsx).
const searchList = (list, now) => list.filter(g => isOpenGrant(g, now) && !g.searchHidden);

const fx = JSON.parse(readFileSync('tests/fixtures/catalog-2026-10-23.json', 'utf8'));
const live = JSON.parse(readFileSync('tests/fixtures/live-junk-2026-10-28.json', 'utf8'));
const JUNK = ['state-la-aid-bf175ec8', 'state-la-aid-6d3d1e8', 'state-la-aid-f451965a', 'ca-117480', 'ca-117456', 'ca-66240'];
const KEPT = ['state-la-aid-94be99d7', 'ca-117489', 'ca-66273'];

test('API/home search count equals the /grants count on a catalog with link labels and same-page duplicates', () => {
  const now = new Date(fx.fetchedAt);
  const index = S.buildSeoIndex(fx.grants, fx.refresh, now);
  const site = S.computeSeoSite(index, now);
  const search = searchList(apiList(fx.grants, now), now).filter(g => /^https?:/i.test(g.url || ''));
  assert.ok(fx.grants.some(g => g.title === 'Submit a Scholarship')); // the fixture really has junk
  assert.equal(search.length, site.open.length);
  assert.equal(S.hubContent(site).openCount, search.length);
  assert.deepEqual(search.map(g => g.id).sort(), Object.keys(index.listings).sort());
  for (const id of ['state-la-aid-bf175ec8', 'state-la-aid-6d3d1e8', 'state-la-aid-f451965a']) assert.ok(!search.some(g => g.id === id), id);
  assert.ok(search.some(g => g.id === 'state-la-aid-94be99d7'));
});

test('the 6 live junk listings (v21, Oct 28) are left out of the API; the listings they duplicate stay', () => {
  const now = new Date(live.fetchedAt);
  const list = apiList(live.grants, now);
  assert.deepEqual(list.map(g => g.id).sort(), [...KEPT].sort());
  for (const id of JUNK) assert.ok(!list.some(g => g.id === id), id);
  const index = S.buildSeoIndex(live.grants, null, now);
  assert.deepEqual(Object.keys(index.listings).sort(), [...KEPT].sort());
  // Rows are never deleted: the input catalog is untouched.
  assert.equal(live.grants.length, 9);
});

test("a signed-in account's own saved junk listing still reaches its tracker, but not search or counts", () => {
  const now = new Date(live.fetchedAt);
  const keep = new Set(['state-la-aid-6d3d1e8', 'ca-66240']);
  const list = apiList(live.grants, now, keep);
  for (const id of keep) {
    const g = list.find(x => x.id === id);
    assert.ok(g, id); assert.equal(g.searchHidden, true); assert.ok(g.title && g.url);
  }
  assert.equal(searchList(list, now).length, KEPT.length);
  assert.ok(KEPT.every(id => !list.find(x => x.id === id).searchHidden));
  // Without the account, nothing is marked: plain listings never carry the flag.
  assert.ok(apiList(fx.grants, new Date(fx.fetchedAt)).every(g => !g.searchHidden));
});

test('the junk filter is idempotent, so /grants built from the filtered catalog matches', () => {
  for (const [grants, now] of [[fx.grants, new Date(fx.fetchedAt)], [live.grants, new Date(live.fetchedAt)]]) {
    const once = S.publicCatalog(grants, new Set(), now);
    assert.deepEqual(S.publicCatalog(once, new Set(), now).map(g => g.id), once.map(g => g.id));
    assert.equal(S.publicJunkIds(once, now).size, 0);
    assert.deepEqual(Object.keys(S.buildSeoIndex(once, null, now).listings).sort(), Object.keys(S.buildSeoIndex(grants, null, now).listings).sort());
  }
});

test('wiring: loadCatalog applies publicCatalog with the account keep set; search and state options skip searchHidden', () => {
  const cat = readFileSync('lib/catalog.ts', 'utf8');
  assert.match(cat, /publicCatalog\(visitorGrants\(await allGrants\(\)\)[^]*\.filter\(visible\), keep, now\)/);
  assert.doesNotMatch(cat, /delete|DELETE/);
  const dash = readFileSync('app/dashboard.tsx', 'utf8');
  assert.match(dash, /grants\.filter\(g=>isOpenGrant\(g,now\)&&!g\.searchHidden\)/);
  assert.match(dash, /searchStates\(grants\.filter\(g=>isOpenGrant\(g,new Date\(nowIso\)\)&&!g\.searchHidden\)\)/);
  assert.match(dash, /grants\.find\(g=>g\.id===s\.grantId\)/); // tracker looks saved rows up in the full payload
  assert.match(readFileSync('app/page.tsx', 'utf8'), /isOpenGrant\(g, now\) && !g\.searchHidden/);
  const idx = readFileSync('lib/seo-index.ts', 'utf8');
  assert.match(idx, /const excluded = publicJunkIds\(open, now\)/);
});
