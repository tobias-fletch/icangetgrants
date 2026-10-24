// PM fixes, Oct 24 2026: NYC SBS evidence host, past deadlines not live (New York date), Updates inbox title/URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const out = resolve('.sites-runtime/tests-pm-1024'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'listing', 'state-registry', 'city-registry', 'notifications']) {
  const js = ts.transpileModule(readFileSync(`lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const load = name => import(pathToFileURL(`${out}/${name}.mjs`).href);
const { easternDay } = await load('source-parsers');
const { isOpenOpportunity, newOpportunityItems, missingInboxFields } = await load('grants');
const { isOpenGrant, withDeadlineStatus, calendarDay } = await load('listing');
const { stateSources, evidenceHostAllowed } = await load('state-registry');
const { cityById, cityEvidenceHostAllowed } = await load('city-registry');
const { inboxMatches, upcomingDeadlines } = await load('notifications');

// (a) NYC SBS
const SBS = [
  'https://nyc-business.nyc.gov/nycbusiness/business-services/incentives/customized-training',
  'https://nyc-business.nyc.gov/nycbusiness/description/gowanus-business-relocation-grant',
];
test('(a) NYC SBS (nyc-business.nyc.gov) is an approved source for New York state and New York City leads', () => {
  const ny = stateSources.find(s => s.code === 'NY'); const nyc = cityById('new-york-ny');
  assert.ok(ny.localHosts.includes('nyc-business.nyc.gov'));
  for (const url of [...SBS, 'https://www.nyc-business.nyc.gov/x', 'https://NYC-Business.nyc.gov/y']) {
    assert.equal(evidenceHostAllowed(ny, url), true, url);
    assert.equal(cityEvidenceHostAllowed(nyc, ny, url), true, url);
  }
  // Nothing else is loosened: lookalikes and other states still fail.
  for (const url of ['https://nyc-business.nyc.gov.evil.com/x', 'https://evil-nyc-business.nyc.gov.example/x', 'https://nyc-business.example.com/x', 'https://nyc-business.gov/x']) {
    assert.equal(evidenceHostAllowed(ny, url), false, url);
    assert.equal(cityEvidenceHostAllowed(nyc, ny, url), false, url);
  }
  assert.equal(evidenceHostAllowed(stateSources.find(s => s.code === 'NJ'), SBS[0]), false);
});

// (b) Past deadlines, New York date
const fixture = JSON.parse(readFileSync('tests/fixtures/catalog-2026-10-23.json', 'utf8')).grants;
const EXPIRED = ['pw-short_story_competition_2', 'gov-362254', 'gov-362248', 'gov-362252', 'gov-362531', 'gov-362529', 'gov-362530', 'gov-362174', 'gov-362171', 'gov-362177', 'gov-362175'];
test('(b) today is the America/New_York calendar day', () => {
  assert.equal(easternDay(new Date('2026-10-23T02:00:00Z')), '2026-10-22'); // 10 PM ET Oct 22
  assert.equal(easternDay(new Date('2026-10-23T04:30:00Z')), '2026-10-23'); // 12:30 AM ET Oct 23
  assert.equal(easternDay(new Date('2026-12-01T04:59:00Z')), '2026-11-30'); // EST (UTC-5)
  assert.equal(easternDay('2026-10-22'), '2026-10-22');
  assert.equal(calendarDay(new Date('2026-10-23T02:00:00Z')), '2026-10-22');
});
test('(b) the deadline day itself is live; the next New York day it is not', () => {
  const g = { id: 'x', title: 'Deadline grant', url: 'https://example.gov/x', status: 'Open', live: true, deadline: '2026-10-22' };
  for (const now of ['2026-10-22T04:01:00Z', '2026-10-22T16:00:00Z', '2026-10-23T03:59:00Z']) {
    assert.equal(isOpenGrant(g, new Date(now)), true, now);
    assert.equal(isOpenOpportunity(g, new Date(now)), true, now);
    assert.equal(withDeadlineStatus(g, new Date(now)), g, now);
  }
  const after = new Date('2026-10-23T04:01:00Z');
  assert.equal(isOpenGrant(g, after), false);
  assert.equal(isOpenOpportunity(g, after), false);
  assert.deepEqual(withDeadlineStatus(g, after), { ...g, status: 'Closed', live: false });
  assert.equal(g.status, 'Open'); assert.equal(g.live, true); // stored record is not mutated
});
test('(b) the 11 listings with Oct 21-22 deadlines are hidden and not live on Oct 24; rolling listings unchanged', () => {
  const now = new Date('2026-10-24T14:00:00Z');
  const byId = new Map(fixture.map(g => [g.id, g]));
  for (const id of EXPIRED) {
    const g = byId.get(id); assert.ok(g, id); assert.equal(g.live, true, id);
    const v = withDeadlineStatus(g, now);
    assert.equal(v.live, false, id); assert.equal(v.status, 'Closed', id);
    assert.equal(isOpenGrant(v, now), false, id); assert.equal(isOpenGrant(g, now), false, id);
  }
  const pastLive = fixture.filter(g => g.live && /^\d{4}-\d{2}-\d{2}$/.test(g.deadline || '') && g.deadline < '2026-10-24' && g.status !== 'Closed');
  assert.deepEqual(pastLive.map(g => g.id).sort(), [...EXPIRED].sort());
  const rolling = fixture.filter(g => !g.deadline);
  assert.ok(rolling.length > 0);
  for (const g of rolling) assert.equal(withDeadlineStatus(g, now), g, g.id);
  const future = fixture.filter(g => g.deadline && g.deadline >= '2026-10-24');
  for (const g of future) assert.equal(withDeadlineStatus(g, now), g, g.id);
  // Far-future placeholder deadlines count as "no fixed deadline" and stay as they are.
  const far = { id: 'far', status: 'Open', live: true, deadline: '2099-12-31' };
  assert.equal(withDeadlineStatus(far, now), far);
});
test('(b) the catalog read path applies the computed status (no stored data rewrite)', () => {
  const src = readFileSync('lib/catalog.ts', 'utf8');
  assert.match(src, /visitorGrants\(await allGrants\(\)\)\.map\(g => withDeadlineStatus\(g, now\)\)/);
  assert.doesNotMatch(src, /insert\(|update\(/);
});
test('(b) Updates inbox and upcoming deadlines use the New York date', () => {
  const p = { id: 'p', name: 'Shop', type: 'Small business', country: 'United States', state: 'New York', keywords: '', goal: 0, education: '', details: '', alerts: true };
  const g = { id: 'g', title: 'Small business grant', url: 'https://example.gov/g', funder: 'City', description: 'Small business grant', types: ['Small business'], countries: ['United States'], states: [], kind: 'Grant', status: 'Open', deadline: '2026-10-22', discovered: '2026-10-21T12:00:00.000Z', amount: 0, requirements: [], tags: [] };
  assert.equal(inboxMatches([g], [p], '', '2026-10-23T05:00:00Z').length, 0);
  assert.equal(upcomingDeadlines([g], [p], 30, '2026-10-23T02:00:00Z').asOf, '2026-10-22'); // 10 PM ET
  assert.equal(upcomingDeadlines([g], [p], 30, '2026-10-23T05:00:00Z').asOf, '2026-10-23');
  assert.equal(upcomingDeadlines([g], [p], 30, '2026-10-23T05:00:00Z').items.length, 0);
});

// (c) Updates inbox needs title and URL
test('(c) new matches without a title or URL are rejected with a clear error; results carry both', () => {
  assert.deepEqual(missingInboxFields({ title: 'Grant', url: 'https://nyc.gov/g' }), []);
  assert.deepEqual(missingInboxFields({}), ['title', 'URL']);
  assert.deepEqual(missingInboxFields({ title: '  ', url: 'https://nyc.gov/g' }), ['title']);
  assert.deepEqual(missingInboxFields({ title: 'Grant', url: '/relative' }), ['URL']);
  assert.throws(() => newOpportunityItems([{ id: 'w1', title: '', url: '', funder: 'NYC', deadline: null }], ['w1']), /missing a title and a URL\. Every match sent to the Updates inbox needs both a title and a URL\./);
  assert.throws(() => newOpportunityItems([{ id: 'w2', title: 'Wednesday grant', funder: 'NYC', deadline: null }], ['w2']), /New match "Wednesday grant" is missing a URL/);
  const ok = newOpportunityItems([{ id: 'ok', title: 'Good grant', url: 'https://nyc.gov/good', funder: 'NYC', deadline: null }], ['ok']);
  assert.deepEqual(ok.newItems.map(i => [i.title, i.url]), [['Good grant', 'https://nyc.gov/good']]);
});
test('(c) inbox skips stored records missing a title or URL', () => {
  const p = { id: 'p', name: 'Shop', type: 'Small business', country: 'United States', state: '', keywords: '', goal: 0, education: '', details: '', alerts: true };
  const base = { funder: 'City', description: 'Small business grant', types: ['Small business'], countries: ['United States'], states: [], kind: 'Grant', status: 'Open', deadline: null, discovered: '2026-10-21T12:00:00.000Z', amount: 0, requirements: [], tags: [] };
  const items = inboxMatches([{ ...base, id: 'a', title: '', url: '' }, { ...base, id: 'b', title: 'Small business grant', url: 'https://nyc.gov/b' }], [p], '', '2026-10-22T12:00:00Z');
  assert.ok(items.every(x => x.g.title && x.g.url));
  assert.ok(!items.some(x => x.g.id === 'a'));
});
test('(c) refresh and record tools check title and URL before saving or reporting', () => {
  const rec = readFileSync('lib/state-research.ts', 'utf8');
  const check = rec.indexOf('missingInboxFields(r||{})'), firstWrite = rec.indexOf('db.insert(catalog)');
  assert.ok(check > 0 && check < firstWrite, 'record_state_opportunities validates the batch before any write');
  assert.match(rec, /\.\.\.newOpportunityItems\(newRecords,matches\)/);
  const disc = readFileSync('lib/discovery.ts', 'utf8');
  const dcheck = disc.indexOf('missingInboxFields(g)'), dwrite = disc.indexOf('INSERT INTO catalog');
  assert.ok(dcheck > 0 && dcheck < dwrite, 'refresh_grants drops untitled/URL-less new records before saving');
  assert.match(disc, /\.\.\.inboxRejections\]/);
  const route = readFileSync('app/mcp/route.ts', 'utf8');
  assert.match(route, /isError:true/);
  assert.match(route, /name:'grantwell'/);
});
