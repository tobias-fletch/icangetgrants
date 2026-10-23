// Conservative junk filter for the public /grants pages, applied when the seo-index row is built.
// It never deletes catalog rows; the search app still shows everything. Two rules only:
//  1. "not-a-program": the title is a site-navigation or form action ("Submit a Scholarship",
//     "Click here", "Learn more"), i.e. the scraper picked up a link label instead of a program name.
//  2. "duplicate-link": two listings point at the same page (same normalized URL) and one title is
//     contained in the other ("GO Grant" vs "Louisiana GO Grant"); the more specific (longer) title is kept.
// Pure module, relative imports only, so tests can transpile it.
import type { Grant } from './grants';
import { stripSearchContext } from './workspace-privacy';

export type SeoExclusion = { id: string; title: string; funder: string; url: string; reason: string; keptId?: string };

// "Submit ..." as the first word is always a form label. Everything else must be the whole title
// ("Learn more", "Apply now"), so real names like "Home Depot Foundation Grant" or "Search for ... Fellowship" stay.
const SUBMIT_TITLE = /^submit\b/i;
const LINK_LABEL = /^(click here|learn more|read more|view (all|more)|see (all|more)|sign in|sign up|log ?in|register( here| now)?|contact( us)?|home( ?page)?|search|browse|more info(rmation)?|apply( here| now| online)?|details|here)[.!:\s]*$/i;

export function isActionTitle(title: string): boolean {
  const t = (title || '').trim();
  return SUBMIT_TITLE.test(t) || LINK_LABEL.test(t);
}

export function normalizedLink(url: string): string {
  try {
    const u = new URL(stripSearchContext(url));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k.toLowerCase()}=${v}`).join('&');
    return `${host}${path}${params ? '?' + params : ''}`;
  } catch {
    return url;
  }
}

const words = (t: string) => (t || '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Returns the listings to leave off the SEO pages, each with a reason. Input order does not matter. */
export function seoExclusions(grants: Grant[]): SeoExclusion[] {
  const out: SeoExclusion[] = [];
  const dropped = new Set<string>();
  const row = (g: Grant, reason: string, keptId?: string): SeoExclusion => {
    const e: SeoExclusion = { id: g.id, title: g.title, funder: g.funder || '', url: g.url, reason };
    if (keptId) e.keptId = keptId;
    return e;
  };
  for (const g of grants) {
    if (g && isActionTitle(g.title)) { out.push(row(g, 'not-a-program: title is a site link or form action, not a program name')); dropped.add(g.id); }
  }
  const byLink = new Map<string, Grant[]>();
  for (const g of grants) {
    if (!g || dropped.has(g.id) || typeof g.url !== 'string') continue;
    const k = normalizedLink(g.url);
    byLink.set(k, [...(byLink.get(k) || []), g]);
  }
  for (const group of byLink.values()) {
    if (group.length < 2) continue;
    // Longest title first (most specific); ties broken by id so the result is stable.
    const sorted = [...group].sort((a, b) => words(b.title).length - words(a.title).length || a.id.localeCompare(b.id));
    const kept: Grant[] = [];
    for (const g of sorted) {
      const w = words(g.title);
      const keeper = w && kept.find(k => ` ${words(k.title)} `.includes(` ${w} `));
      if (keeper) out.push(row(g, `duplicate-link: same page as "${keeper.title}", which is kept`, keeper.id));
      else kept.push(g);
    }
  }
  return out;
}
