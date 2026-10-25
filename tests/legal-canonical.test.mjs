// /privacy and /terms must not inherit the layout's canonical "/" (that told search engines they were the homepage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const page of ['privacy', 'terms']) {
  test(`/${page} has its own absolute canonical URL`, () => {
    const src = readFileSync(`app/${page}/page.tsx`, 'utf8');
    const meta = src.slice(src.indexOf('export const metadata'), src.indexOf('\n};', src.indexOf('export const metadata')));
    assert.match(meta, new RegExp(`alternates: \\{ canonical: "https://icangetgrants\\.com/${page}" \\}`));
  });
  test(`/${page} og:url matches its canonical`, () => {
    const src = readFileSync(`app/${page}/page.tsx`, 'utf8');
    assert.match(src, new RegExp(`openGraph: \\{[\\s\\S]*url: "https://icangetgrants\\.com/${page}"`));
  });
}
