// Privacy and Terms carry Tobias's approved final answers (2026-10-24) instead of placeholder notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const privacy = readFileSync('app/privacy/page.tsx', 'utf8');
const terms = readFileSync('app/terms/page.tsx', 'utf8');
const shell = readFileSync('components/legal-page.tsx', 'utf8');
const all = privacy + terms + shell;

test('no placeholder notes or draft banner remain on /privacy and /terms', () => {
  assert.doesNotMatch(all, /TOBIAS TO CONFIRM/);
  assert.doesNotMatch(all, /<Confirm\b/);
  assert.doesNotMatch(all, /pending review/i);
  assert.doesNotMatch(all, /\(draft\)/);
  assert.doesNotMatch(all, /grant\s*os|grantwell/i);
});

test('effective date is October 25, 2026 on both pages', () => {
  assert.match(privacy, /Effective date: October 25, 2026\./);
  assert.match(terms, /Effective date: October 25, 2026\./);
});

test('privacy: OpenAI sign-in, refresh task, hosting logs, cookies, security', () => {
  assert.match(privacy, /href="https:\/\/openai\.com\/policies\/privacy-policy\/"/);
  assert.match(privacy, /ChatGPT\s+scheduled task/);
  assert.match(privacy, /creates no extra\s+logs about visitors/);
  assert.match(privacy, /stored on Cloudflare/);
  assert.match(privacy, /may keep their own standard request logs,\s+including IP addresses/);
  assert.doesNotMatch(privacy, /database is located|data location|stored in the (United States|U\.S\.)/i, 'no promised data location');
  assert.match(privacy, /I Can Get Grants sets no cookies of its own\s+for that sign-in/);
  assert.match(privacy, /__Host-icgg_session<\/code> holds the Google account identifier\s+and an expiry time\. It lasts up to 30 days/);
  assert.match(privacy, /encrypted in transit \(HTTPS\)/);
  assert.match(privacy, /encrypted at rest by Cloudflare/);
  assert.match(privacy, /we’ll notify\s+affected users promptly/);
});

test('privacy: Sign in with Google line matches what the code uses', () => {
  assert.match(privacy, /Sign in with Google:/);
  assert.match(privacy, /href="https:\/\/policies\.google\.com\/privacy"/);
  assert.match(privacy, /keeps only the account identifier/);
  assert.match(privacy, /not sold, not used for\s+advertising, and not shared with anyone/);
  // The code keeps only the sub and a 30-day session (lib/session.ts).
  const session = readFileSync('lib/session.ts', 'utf8');
  assert.match(session, /SESSION_COOKIE = '__Host-icgg_session'/);
  assert.match(session, /SESSION_MAX_AGE = 30 \* 24 \* 60 \* 60/);
  assert.match(session, /type SessionPayload = \{ sub: string; exp: number \}/);
});

test('terms: acceptance, schedule/support, note license; free beta kept', () => {
  assert.match(terms, /By using I Can Get Grants, you accept these terms\./);
  assert.match(terms, /refreshes daily at 9 a\.m\. Eastern/);
  assert.match(terms, /There is no uptime guarantee\./);
  assert.match(terms, /Support is\s+available only through the <a href="\/contact">contact form<\/a>/);
  assert.match(terms, /You keep ownership of the notes/);
  assert.match(terms, /license only to store that content and show it back to you/);
  assert.match(terms, /free during the beta/);
  assert.doesNotMatch(terms, /trademark notice/i);
});
