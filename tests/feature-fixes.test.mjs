// Fixes from the 2026-10-23 feature check: plain links on legal pages, POST contact form,
// mobile reachability of the side-bottom tabs, and directory title/deadline normalization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out = resolve('.sites-runtime/tests-feature-fixes'); mkdirSync(out, { recursive: true });
for (const name of ['source-parsers', 'grants', 'state-registry', 'listing', 'workspace-privacy']) {
  const source = readFileSync(`lib/${name}.ts`, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  writeFileSync(`${out}/${name}.mjs`, js);
}
const parsers = await import(pathToFileURL(`${out}/source-parsers.mjs`).href);
const listing = await import(pathToFileURL(`${out}/listing.mjs`).href);
const privacy = await import(pathToFileURL(`${out}/workspace-privacy.mjs`).href);

function files(dir) { return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : []; }); }

test('legal pages use plain anchors, not next/link (minified Link throws on vinext beta)', () => {
  for (const file of ['components/legal-page.tsx', 'app/terms/page.tsx', 'app/privacy/page.tsx', 'app/contact/page.tsx']) {
    const src = readFileSync(file, 'utf8');
    assert.equal(/next\/link/.test(src), false, file + ' imports next/link');
    assert.equal(/<Link\b/.test(src), false, file + ' renders <Link>');
  }
  const legal = readFileSync('components/legal-page.tsx', 'utf8');
  for (const href of ['/privacy', '/terms', '/contact', '/']) assert.ok(legal.includes(`href="${href}"`), 'legal header/footer links to ' + href);
  assert.match(readFileSync('app/terms/page.tsx', 'utf8'), /<a href="\/privacy">privacy policy<\/a>/);
});

test('no component or page imports next/link', () => {
  for (const file of [...files('app'), ...files('components')]) assert.equal(/from ["']next\/link["']/.test(readFileSync(file, 'utf8')), false, file);
});

test('contact form declares POST and still submits JSON to the relay with fetch', () => {
  const src = readFileSync('components/contact-form.tsx', 'utf8');
  const form = src.match(/<form\b[^>]*className="contact-form"[^>]*>/)?.[0] || '';
  assert.match(form, /method="post"/i);
  assert.doesNotMatch(form, /method="get"/i);
  assert.match(form, /onSubmit=\{submit\}/);
  assert.match(src, /preventDefault\(\)/);
  assert.match(src, /fetch\(CONTACT_RELAY_URL,\s*\{\s*method:\s*"POST"/);
  assert.doesNotMatch(src, /mailto:/i);
});

test('mobile (<=760px): Preferences & data and How matching works stay reachable', () => {
  const dash = readFileSync('app/dashboard.tsx', 'utf8');
  const bottom = dash.match(/className="side-bottom">([\s\S]*?)<div className="account">/)?.[1] || '';
  assert.match(bottom, /Preferences & data/);
  assert.match(bottom, /How matching works/);
  const css = readFileSync('app/globals.css', 'utf8');
  const blocks = [...css.matchAll(/@media\(max-width:760px\)\{/g)].map(m => {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
    return { start: m.index, body: css.slice(m.index, i + 1) };
  });
  const show = blocks.filter(b => /\.side-bottom\{[^}]*display:flex/.test(b.body));
  assert.ok(show.length, 'a 760px rule shows .side-bottom');
  const lastShow = Math.max(...show.map(b => b.start));
  for (const b of blocks.filter(b => b.start > lastShow)) assert.doesNotMatch(b.body, /side-bottom[^{]*\{[^}]*display:none/, 'later 760px rule hides .side-bottom again');
  const showBody = show.find(b => b.start === lastShow).body;
  assert.match(showBody, /\.side-bottom\{[^}]*overflow-x:auto/);
  assert.match(showBody, /\.side-bottom>button\{[^}]*white-space:nowrap/);
  assert.match(showBody, /\.side-bottom \.account\{display:none\}/);
});

test('mobile tap targets for Sign in, Privacy, Terms, search and Details are at least 44px', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  const tail = css.slice(css.lastIndexOf('@media(max-width:760px){'));
  for (const sel of ['.policy-links .account-link', '.legal-nav a', '.footer-links a', '.searchbox', '.match-row button', '.sidebar nav button']) {
    const rule = tail.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}'))?.[1] || '';
    assert.match(rule, /min-height:44px/, sel);
  }
});

test('directory titles drop trailing colons', () => {
  assert.equal(parsers.tidyTitle('Business Freedom Grant:'), 'Business Freedom Grant');
  assert.equal(parsers.tidyTitle('Breva Thrive Grant: '), 'Breva Thrive Grant');
  assert.equal(parsers.tidyTitle('Skip Instant Grants'), 'Skip Instant Grants');
  assert.equal(parsers.tidyTitle('Grant – '), 'Grant');
  const [g] = privacy.visitorGrants([{ id: 'chamber-breva', title: 'Breva Thrive Grant:', url: 'https://breva.ai/' }]);
  assert.equal(g.title, 'Breva Thrive Grant');
});

test('deadline labels are short phrases, or "See listing" for paragraphs', () => {
  // Live label text from the 2026-10-23 catalog (Skip Instant Grants, cut at 110 chars by the old parser).
  const skip = 'deadlines on Tuesdays and Fridays. Applicants must participate in Skip’s YouTube livestream during the selecti';
  assert.equal(parsers.tidyDeadlineLabel(skip), 'Deadlines on Tuesdays and Fridays');
  // Grants.gov responseDateDesc for the USAFA BAA (gov-330175) is a paragraph; keep only the actual deadline sentence.
  const usafaLabel = 'This announcement remains open until superseded. White papers are reviewed and evaluated as they are received and may be submitted at any time';
  assert.equal(parsers.tidyDeadlineLabel(usafaLabel), 'This announcement remains open until superseded');
  // A program paragraph with no deadline wording falls back to "See listing".
  const usafa = 'The USAFA invests in an active research program for three main reasons. First and foremost, research significantly enhances the cadet learning experience.';
  assert.equal(parsers.tidyDeadlineLabel(usafa), 'See listing');
  assert.equal(parsers.tidyDeadlineLabel('deadline is 3:00 p.m. MT on the 10th of every month.'), '3:00 p.m. MT on the 10th of every month');
  assert.equal(parsers.tidyDeadlineLabel('Proposals accepted anytime'), 'Proposals accepted anytime');
  assert.equal(parsers.tidyDeadlineLabel('Deadline: March 15, 2027'), 'March 15, 2027');
  assert.equal(parsers.tidyDeadlineLabel('Rolling'), 'Rolling');
  assert.equal(parsers.tidyDeadlineLabel('08/31/2027 · confirm year/cycle'), '08/31/2027 · confirm year/cycle');
  assert.equal(parsers.tidyDeadlineLabel('', 'Verify current application cycle'), 'Verify current application cycle');
  assert.ok(parsers.tidyDeadlineLabel('Applications are accepted until the program budget for the year has been fully committed by the agency').length <= parsers.DEADLINE_LABEL_MAX);
  const now = new Date('2026-10-23T12:00:00Z');
  assert.equal(listing.deadlineView({ deadline: null, deadlineLabel: usafa }, now).text, 'See listing');
  assert.equal(listing.deadlineView({ deadline: null, deadlineLabel: skip }, now).text, 'Deadlines on Tuesdays and Fridays');
  assert.equal(listing.deadlineView({ deadline: null, deadlineLabel: null }, now).text, 'Check provider');
});

test('U.S. Chamber parser normalizes titles and deadline labels', () => {
  const html = '<h2>General small business grants</h2><ul>'
    + '<li><strong>Breva Thrive Grant:</strong> Breva offers grants of $5,000 for small businesses. <a href="https://breva.ai/thrive">Apply</a></li>'
    + '<li><strong>Skip Instant Grants.</strong> Skip awards $1,000 grants with deadlines on Tuesdays and Fridays. Applicants must participate in Skip’s YouTube livestream during the selection. <a href="https://helloskip.com/">Skip</a></li>'
    + '</ul><h2>Additional resources</h2>';
  const records = parsers.parseBusinessGrants(html, '2026-10-23T12:00:00Z');
  const breva = records.find(r => r.url.includes('breva'));
  const skip = records.find(r => r.url.includes('helloskip'));
  assert.equal(breva.title, 'Breva Thrive Grant');
  assert.equal(breva.deadlineLabel, 'Verify current application cycle');
  assert.equal(skip.title, 'Skip Instant Grants');
  assert.equal(skip.deadlineLabel, 'Deadlines on Tuesdays and Fridays');
});

test('state registry: replaced dead source links', () => {
  const src = readFileSync('lib/state-registry.ts', 'utf8');
  for (const dead of ["'https://www.ache.edu/'", 'floridajobs.org/smallbusiness', "financial-incentives-resources'", 'pay-for-college/grants-scholarships', 'tn.gov/collegepays/money-for-college.html']) assert.equal(src.includes(dead), false, dead);
  for (const live of ['https://sp.ache.edu/student-financial-aid/', 'https://floridajobs.org/small-business', 'https://www.floridastudentfinancialaid.org/', 'financial-incentives-resources/resources', 'https://www.collegefortn.org/tennessee-financial-aid/']) assert.ok(src.includes(live), live);
});
