// Search-first home: the search box at the top of / filters the existing Opportunities results (/grants has no
// query parameters), the state picker lists only states in the data, quick links come from the /grants hub, and
// the existing hero, match form, sign-in and alerts call to action stay in place below the search block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/home-search-tests'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'listing', 'site', 'access', 'state-registry', 'workspace-privacy', 'fetch-budget', 'state-discovery', 'catalog-sweep', 'seo-taxonomy', 'seo-exclude', 'seo-index', 'home-search']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from ['"](\.\/[^'"]+)['"]/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const load = n => import(pathToFileURL(`${out}/${n}.mjs`).href);
const H = await load('home-search');
const S = await load('seo-index');
const L = await load('listing');

const fx = JSON.parse(readFileSync('tests/fixtures/catalog-2026-10-23.json', 'utf8'));
const now = new Date(fx.fetchedAt);
const open = fx.grants.filter(g => L.isOpenGrant(g, now));
const site = S.computeSeoSite(S.buildSeoIndex(fx.grants, fx.refresh, now), now);
const hub = S.hubContent(site);
const dashboard = readFileSync('app/dashboard.tsx', 'utf8');
const page = readFileSync('app/page.tsx', 'utf8');

test('state picker lists only states that have listings, A–Z', () => {
  const states = H.searchStates(open);
  assert.ok(states.length > 0);
  assert.deepEqual(states, [...states].sort((a, b) => a.localeCompare(b)));
  for (const s of states) assert.ok(open.some(g => (g.states || []).includes(s)), s);
  assert.equal(new Set(states).size, states.length);
});

test('nationwide rule matches the /grants state pages', () => {
  for (const g of fx.grants) assert.equal(H.openNationwide(g), S.isNationwide(g), g.id);
  const st = H.searchStates(open)[0];
  for (const g of open) assert.equal(H.availableInState(g, st), (g.states || []).includes(st) || S.isNationwide(g));
  assert.ok(open.every(g => H.availableInState(g, '')));
});

test('URL parsing trims, caps the keyword, and ignores unknown states', () => {
  const states = ['Louisiana', 'New York'];
  assert.deepEqual(H.parseHomeSearch({ q: '  nursing ', state: 'new york' }, states), { q: 'nursing', state: 'New York' });
  assert.deepEqual(H.parseHomeSearch({ q: ['arts', 'x'], state: 'Atlantis' }, states), { q: 'arts', state: '' });
  assert.deepEqual(H.parseHomeSearch(new URLSearchParams('q=scholarship&state=Louisiana'), states), { q: 'scholarship', state: 'Louisiana' });
  assert.deepEqual(H.parseHomeSearch(undefined, states), { q: '', state: '' });
  assert.equal(H.parseHomeSearch({ q: 'a'.repeat(500) }, states).q.length, H.MAX_QUERY);
  assert.equal(H.homeSearchHref('small business', 'New York'), '/?q=small+business&state=New+York');
  assert.equal(H.homeSearchHref(' ', ''), '/');
});

test('quick links are real hub pages: small business and nonprofit first, then NY, PA, LA', () => {
  const links = H.homeQuickLinks(hub);
  const hubPaths = new Set([...hub.categories, ...hub.states].map(l => l.path));
  for (const l of [...links.topics, ...links.states]) { assert.ok(hubPaths.has(l.path), l.path); assert.equal(site.pages.get(l.path)?.status, 'indexable', l.path); }
  assert.equal(links.topics.length, hub.categories.length);
  const at = p => links.topics.findIndex(l => l.path === p);
  if (at('/grants/small-business') >= 0 && at('/grants/nonprofit') >= 0) assert.ok(at('/grants/small-business') < at('/grants/nonprofit'));
  assert.deepEqual(links.states.map(l => l.path), H.HOME_STATE_PAGES.filter(p => hubPaths.has(p)));
  assert.deepEqual(H.homeQuickLinks(null), H.NO_QUICK_LINKS);
});

test('home search block comes first and feeds the existing results; hero, match form and alerts CTA follow unchanged', () => {
  const main = dashboard.slice(dashboard.indexOf('<main>'));
  const iSearch = main.indexOf('className="beta-search home-search"');
  const iQuick = main.indexOf('className="quick-links"');
  const iHero = main.indexOf("<h1>{view==='discover'?'Find funding.'");
  const iMatch = main.indexOf('Match funding to you');
  const iSave = main.indexOf('<HomeSaveCta');
  assert.ok(iSearch >= 0 && iSearch < iQuick && iQuick < iHero && iHero < iMatch && iMatch < iSave);
  assert.ok(dashboard.includes('Grants, scholarships, and student aid. All in one search.'));
  assert.match(dashboard, /action="\/#opportunities" method="get"/);
  assert.match(dashboard, /name="q"/); assert.match(dashboard, /name="state"/);
  assert.match(dashboard, /<a className="btn secondary" href="\/grants">Browse grants<\/a>/);
  assert.match(dashboard, /id="opportunities"/);
  assert.match(dashboard, /availableInState\(x\.g,stateFilter\)/);
  assert.match(page, /parseHomeSearch\(params, searchStateOptions\)/);
  assert.match(page, /homeQuickLinks\(hubContent\(site\)\)/);
});

test('no retired product name in the new code', () => {
  for (const f of ['lib/home-search.ts', 'app/page.tsx', 'app/dashboard.tsx']) assert.doesNotMatch(readFileSync(f, 'utf8'), /GrantOS/i, f);
});
