// MCP grant links: every tool result that lists grants also links back to icangetgrants.com (siteUrl + the matching
// /grants state or topic page), in the JSON text, a readable link block and structuredContent. Tool names and input
// schemas must stay exactly as on main (a scheduled task depends on them). Data: tests/fixtures/catalog-2026-10-23.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/grant-links-tests'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'listing', 'site', 'access', 'state-registry', 'workspace-privacy', 'fetch-budget', 'state-discovery', 'catalog-sweep', 'seo-taxonomy', 'seo-exclude', 'seo-index', 'grant-links', 'notifications']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from ['"](\.\/[^'"]+)['"]/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const load = n => import(pathToFileURL(`${out}/${n}.mjs`).href);
const L = await load('grant-links');
const S = await load('seo-index');
const G = await load('grants');
const N = await load('notifications');
const fx = JSON.parse(readFileSync('tests/fixtures/catalog-2026-10-23.json', 'utf8'));
const now = new Date(fx.fetchedAt);
const site = S.computeSeoSite(S.buildSeoIndex(fx.grants, fx.refresh, now), now);
const pages = new Set(site.pages.keys());
const ORIGIN = 'https://icangetgrants.com';
const route = readFileSync('app/mcp/route.ts', 'utf8');

test('a single-state grant links to its state page; a nationwide one to its topic page; otherwise the hub', () => {
  const ny = { title: 'Excelsior Scholarship', kind: 'Student aid', types: ['Student'], tags: [], states: ['New York'] };
  assert.deepEqual(L.grantLinks(ny), { siteUrl: `${ORIGIN}/?q=Excelsior%20Scholarship`, pageUrl: `${ORIGIN}/grants/new-york`, pageLabel: 'New York grants' });
  const sch = { title: 'A national scholarship', kind: 'Scholarship', types: ['Student'], tags: [], states: [] };
  assert.equal(L.grantLinks(sch).pageUrl, `${ORIGIN}/grants/scholarships`);
  assert.equal(L.grantLinks(sch).pageLabel, 'Scholarships');
  assert.equal(L.grantLinks({ title: 'Plain', kind: 'Other' }).pageUrl, `${ORIGIN}/grants`);
  assert.equal(L.grantSiteUrl('Research Program (iPOP)'), `${ORIGIN}/?q=Research%20Program%20%28iPOP%29`);
  assert.equal(new URL(L.grantSiteUrl("Women's (Fund)")).searchParams.get('q'), "Women's (Fund)");
  // With the live page set, a page that does not exist is skipped rather than linked.
  assert.equal(L.grantLinks(ny, new Set(['/grants/student-aid'])).pageUrl, `${ORIGIN}/grants/student-aid`);
  assert.equal(L.grantLinks(ny, new Set()).pageUrl, `${ORIGIN}/grants`);
});

test('every open catalog grant gets https icangetgrants.com links to a page that exists', () => {
  let state = 0, topic = 0;
  for (const g of site.open) {
    const full = fx.grants.find(x => x.id === g.id);
    const l = L.grantLinks(full, pages);
    assert.ok(l.siteUrl.startsWith(`${ORIGIN}/?q=`), l.siteUrl);
    assert.equal(new URL(l.siteUrl).searchParams.get('q'), full.title.replace(/\s+/g, ' ').trim().slice(0, 200));
    const path = l.pageUrl.slice(ORIGIN.length);
    assert.ok(path === '/grants' || pages.has(path), path);
    if (/^\/grants\/[a-z-]+$/.test(path) && site.pages.get(path)?.type === 'state') state++; else if (path !== '/grants') topic++;
    if (site.pages.get(path)?.ids) assert.ok(site.pages.get(path).ids.includes(g.id), `${g.id} is listed on ${path}`);
  }
  assert.ok(state > 0 && topic > 0, `state ${state} topic ${topic}`);
});

test('withGrantLinks adds links to newItems and items and keeps every existing field', () => {
  const grants = fx.grants.slice(0, 40);
  const { newItems, newItemsTotal } = G.newOpportunityItems(grants.filter(g => G.missingInboxFields(g).length === 0).slice(0, 5));
  const refresh = { checkedAt: 'x', checked: 5, newGrants: 5, newMatchedOpportunities: 0, newItems, newItemsTotal, errors: [] };
  const linked = L.withGrantLinks(refresh, grants, pages);
  assert.equal(linked.newItems.length, newItems.length);
  linked.newItems.forEach((it, i) => {
    for (const [k, v] of Object.entries(newItems[i])) assert.deepEqual(it[k], v, k);
    assert.ok(it.siteUrl.startsWith(ORIGIN) && it.pageUrl.startsWith(ORIGIN + '/grants') && it.pageLabel);
  });
  for (const k of Object.keys(refresh)) if (k !== 'newItems') assert.deepEqual(linked[k], refresh[k]);
  // upcoming_deadlines shape (items) and an item not in the catalog.
  const up = L.withGrantLinks({ days: 30, total: 2, items: [{ title: newItems[0].title, url: newItems[0].url, deadline: '2026-11-01' }, { title: 'Not in catalog', url: 'https://example.org/x' }] }, grants, pages);
  assert.equal(up.items[0].pageUrl, linked.newItems[0].pageUrl);
  assert.deepEqual(up.items[1], { title: 'Not in catalog', url: 'https://example.org/x', siteUrl: `${ORIGIN}/?q=Not%20in%20catalog`, pageUrl: `${ORIGIN}/grants`, pageLabel: 'All grants' });
  assert.equal(L.withGrantLinks(null, grants), null);
  assert.deepEqual(L.withGrantLinks({ checkedAt: 'x' }, grants), { checkedAt: 'x' });
});

test('upcoming_deadlines output gets links too', () => {
  const profile = { id: 'p', name: 'Local test profile', type: 'Small business', country: 'United States', state: '', keywords: '', goal: 0, education: '', details: '', alerts: true };
  const full = fx.grants.map(g => ({ requirements: [], description: '', ...g }));
  const r = N.upcomingDeadlines(full, [profile], 90); // match() reads the real clock
  const linked = L.withGrantLinks(r, full, pages);
  assert.ok(linked.items.length > 0);
  for (const it of linked.items) assert.ok(it.siteUrl && it.pageUrl && it.pageLabel);
});

test('records that share one source URL are matched by title first', () => {
  const grants = [{ title: 'Program A', url: 'https://example.gov/p', kind: 'Scholarship', states: [] }, { title: 'Program B', url: 'https://example.gov/p', kind: 'Business grant', types: ['Small business'], states: ['California'] }];
  const r = L.withGrantLinks({ newItems: [{ title: 'Program B', url: 'https://example.gov/p' }] }, grants);
  assert.equal(r.newItems[0].pageUrl, `${ORIGIN}/grants/california`);
  assert.equal(r.newItems[0].siteUrl, `${ORIGIN}/?q=Program%20B`);
});

test('grant_refresh_status: the stored scan under lastRefresh / lastAttempt gets links too', () => {
  const item = { title: 'Program B', url: 'https://example.gov/p', funder: 'X', deadline: null, matched: false, matches: [] };
  const grants = [{ title: 'Program B', url: 'https://example.gov/p', kind: 'Business grant', types: ['Small business'], states: ['California'] }];
  const r = L.withGrantLinks({ lastRefresh: { checkedAt: 'x', newItems: [item], newItemsTotal: 1 }, lastAttempt: { newItems: [item] }, health: { status: 'ok' }, catalogSize: 1 }, grants);
  assert.equal(r.lastRefresh.newItems[0].pageUrl, `${ORIGIN}/grants/california`);
  assert.equal(r.lastRefresh.newItemsTotal, 1);
  assert.equal(r.lastAttempt.newItems[0].pageLabel, 'California grants');
  assert.deepEqual(r.health, { status: 'ok' });
  const text = L.grantLinksText(r);
  assert.equal(text.split('\n').length, 2, 'the same grant is listed once');
  assert.equal(L.grantLinksText({ lastRefresh: { newItems: [] }, lastAttempt: null }), null);
});

test('the link text block lists each grant as a markdown link plus its page and official source', () => {
  const r = L.withGrantLinks({ newItems: [{ title: 'Excelsior [NY] Scholarship', url: 'https://www.hesc.ny.gov/x', funder: 'HESC', deadline: null, matched: false, matches: [] }] }, [{ title: 'Excelsior [NY] Scholarship', url: 'https://www.hesc.ny.gov/x', kind: 'Student aid', states: ['New York'] }], new Set(['/grants/new-york']));
  const text = L.grantLinksText(r);
  assert.match(text, /^View these grants on I Can Get Grants:/);
  assert.ok(text.includes('[Excelsior \\[NY\\] Scholarship](https://icangetgrants.com/?q=Excelsior%20%5BNY%5D%20Scholarship)'));
  assert.ok(text.includes('more: [New York grants](https://icangetgrants.com/grants/new-york)'));
  assert.ok(text.includes('official source: https://www.hesc.ny.gov/x'));
  assert.equal(L.grantLinksText({ newItems: [] }), null);
  assert.equal(L.grantLinksText({ checkedAt: 'x' }), null);
  const many = L.withGrantLinks({ items: Array.from({ length: 30 }, (_, i) => ({ title: 'T' + i })) }, []);
  assert.match(L.grantLinksText(many), /…and 5 more at https:\/\/icangetgrants\.com\/grants$/);
});

// Balanced-brace slice starting at `inputSchema:{`.
function inputSchemas(src) {
  const outList = []; let i = 0;
  while ((i = src.indexOf('inputSchema:{', i)) >= 0) {
    let j = i + 'inputSchema:'.length, depth = 0;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    outList.push(src.slice(i, j + 1)); i = j;
  }
  return outList;
}

test('MCP tool names and input schemas are unchanged from main', () => {
  const snap = JSON.parse(readFileSync('tests/fixtures/mcp-tools-main-0ac3a17.json', 'utf8'));
  assert.deepEqual([...route.matchAll(/\{name:'([a-z_]+)',description:/g)].map(m => m[1]), snap.names);
  assert.deepEqual(inputSchemas(route), snap.inputSchemas);
  assert.match(route, /serverInfo:\{name:'grantwell',version:'1\.0\.0'\}/);
});

test('every grant-listing tool replies through grantReply (text JSON first, link block, structuredContent)', () => {
  assert.match(route, /name==='record_state_opportunities'\)return grantReply\(/);
  assert.match(route, /return grantReply\(upcomingDeadlines\(await allGrants\(\),profiles,message\.params\?\.arguments\?\.days\)\)/);
  assert.match(route, /name==='refresh_grants'\?await refresh\(\):name==='grant_refresh_status'\?await status\(\):null;if\(!response\)throw new Error\('Unknown tool'\);return grantReply\(await response\.json\(\)\);/);
  assert.match(route, /content:\[\{type:'text',text:JSON\.stringify\(linked\)\},\.\.\.\(text\?\[\{type:'text',text\}\]:\[\]\)\]/);
  assert.match(route, /structuredContent:linked/);
  // Output schemas allow the new fields (items had additionalProperties:false).
  assert.match(route, /\.\.\.grantLinkSchemaProperties/);
  assert.equal((route.match(/\.\.\.linkedItemsSchema\}\}/g) || []).length, 2);
});
