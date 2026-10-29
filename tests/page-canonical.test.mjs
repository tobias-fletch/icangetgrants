// Every main page declares an absolute https://icangetgrants.com canonical and og:url (resolved by metadataBase where
// relative), so pages served on the ChatGPT Sites host still point search engines and link previews at icangetgrants.com.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(p, 'utf8');

test('the root layout resolves canonical and og:url against https://icangetgrants.com', () => {
  const src = read('app/layout.tsx');
  assert.match(src, /metadataBase: new URL\(SITE_ORIGIN\)/);
  assert.match(read('lib/site.ts'), /SITE_HOSTNAME = "icangetgrants\.com"/);
  assert.match(src, /alternates: \{\s*canonical: "\/",?\s*\}/);
  assert.match(src, /openGraph: \{[\s\S]*url: "\/"/);
});

for (const page of ['privacy', 'terms', 'contact']) {
  test(`/${page} has an absolute canonical and a matching og:url`, () => {
    const src = read(`app/${page}/page.tsx`);
    assert.match(src, new RegExp(`canonical: "https://icangetgrants\\.com/${page}"`));
    assert.match(src, new RegExp(`openGraph: \\{[\\s\\S]*url: "https://icangetgrants\\.com/${page}"`));
  });
}

test('/grants pages build canonical and og:url from SITE_ORIGIN', () => {
  const src = read('app/grants/seo-data.ts');
  assert.match(src, /const url = SITE_ORIGIN \+ path;/);
  assert.match(src, /alternates: \{ canonical: url \}/);
  assert.match(src, /openGraph: \{[^}]*\burl\b/);
});

test('sitemap and robots name icangetgrants.com only', () => {
  assert.match(read('app/sitemap.ts'), /new URL\(page\.path, SITE_ORIGIN\)/);
  assert.match(read('app/robots.ts'), /sitemap: `\$\{SITE_ORIGIN\}\/sitemap\.xml`/);
});
