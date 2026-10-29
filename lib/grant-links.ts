// Links back to icangetgrants.com for every grant an MCP tool returns, so people who find a grant through ChatGPT
// land on this site: siteUrl opens the home search on that grant, pageUrl is the matching /grants state or topic page.
// Pure module, relative imports only, so tests can transpile it.
import { SITE_ORIGIN } from './site';
import { STATES } from './source-parsers';
import { SEO_CATEGORIES, categoriesFor, seoPath, slugify } from './seo-taxonomy';
import type { Grant } from './grants';

export type GrantLinkSource = Pick<Grant, 'title'> & Partial<Pick<Grant, 'id' | 'kind' | 'types' | 'tags' | 'studyLevels' | 'states' | 'url'>>;
export type GrantLinks = { siteUrl: string; pageUrl: string; pageLabel: string };

const STATE_NAMES = new Set(Object.values(STATES));
const CATEGORY_LABEL = new Map(SEO_CATEGORIES.map(c => [c.slug, c.label]));

/** Home search for this grant's title, e.g. https://icangetgrants.com/?q=Excelsior%20Scholarship. */
export function grantSiteUrl(title: string): string {
  const q = (title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  // ( ) ' ! * are escaped too so the URL is safe inside a markdown link.
  return q ? `${SITE_ORIGIN}/?q=${encodeURIComponent(q).replace(/[()'!*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}` : `${SITE_ORIGIN}/`;
}

/** Candidate /grants pages, best first: the state page for a single-state grant, then its topic pages, then the hub. */
export function grantPageCandidates(g: GrantLinkSource): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [];
  const states = (g.states || []).filter(s => STATE_NAMES.has(s));
  if (states.length === 1) out.push({ path: seoPath.state(slugify(states[0])), label: `${states[0]} grants` });
  const cats = categoriesFor({ id: g.id || '', title: g.title || '', kind: g.kind || '', types: g.types || [], tags: g.tags || [], studyLevels: g.studyLevels || [] });
  for (const c of cats) out.push({ path: seoPath.category(c), label: CATEGORY_LABEL.get(c) || c });
  return out;
}

/** Links for one grant. When `pages` (paths that exist on /grants) is given, only an existing page is chosen. */
export function grantLinks(g: GrantLinkSource, pages?: ReadonlySet<string> | null): GrantLinks {
  const pick = grantPageCandidates(g).find(c => !pages || pages.has(c.path)) || { path: seoPath.hub(), label: 'All grants' };
  return { siteUrl: grantSiteUrl(g.title), pageUrl: SITE_ORIGIN + pick.path, pageLabel: pick.label };
}

type ItemLike = { title?: unknown; url?: unknown; [k: string]: unknown };
const LIST_KEYS = ['newItems', 'items'] as const;
// grant_refresh_status nests the stored scan one level down.
const NESTED_KEYS = ['lastRefresh', 'lastAttempt'] as const;

/** Adds siteUrl, pageUrl and pageLabel to each item in result.newItems / result.items (and the same lists inside
 *  result.lastRefresh / result.lastAttempt, as grant_refresh_status returns). Matches each item to its
 *  catalog record by title and source URL, then title, then URL; an unmatched item still gets siteUrl and the hub page. Other fields
 *  are untouched, so existing readers keep working. */
export function withGrantLinks<T>(result: T, grants: GrantLinkSource[], pages?: ReadonlySet<string> | null): T {
  if (!result || typeof result !== 'object') return result;
  // Several records can share one source URL (e.g. a portal page), so title+URL is tried first, then title, then URL.
  const byBoth = new Map<string, GrantLinkSource>(), byUrl = new Map<string, GrantLinkSource>(), byTitle = new Map<string, GrantLinkSource>();
  for (const g of grants) { const both = g.title + '\n' + (g.url || ''); if (!byBoth.has(both)) byBoth.set(both, g); if (g.url && !byUrl.has(g.url)) byUrl.set(g.url, g); if (g.title && !byTitle.has(g.title)) byTitle.set(g.title, g); }
  const out: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  for (const key of LIST_KEYS) {
    const list = out[key];
    if (!Array.isArray(list)) continue;
    out[key] = list.map((item: ItemLike) => {
      if (!item || typeof item !== 'object' || typeof item.title !== 'string') return item;
      const g = byBoth.get(item.title + '\n' + (typeof item.url === 'string' ? item.url : '')) || byTitle.get(item.title) || (typeof item.url === 'string' && byUrl.get(item.url)) || { title: item.title };
      return { ...item, ...grantLinks({ ...g, title: item.title }, pages) };
    });
  }
  for (const key of NESTED_KEYS) { const v = out[key]; if (v && typeof v === 'object' && !Array.isArray(v)) out[key] = withGrantLinks(v, grants, pages); }
  return out as T;
}

const md = (s: string) => s.replace(/([\[\]\\])/g, '\\$1');

/** Plain-text link list for the tool's text content, or null when the result lists no grants. */
export function grantLinksText(result: unknown, max = 25): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const lists = (o: unknown) => (o && typeof o === 'object' ? LIST_KEYS.flatMap(k => { const v = (o as Record<string, unknown>)[k]; return Array.isArray(v) ? v : []; }) : []);
  const seen = new Set<string>();
  const items = [...lists(r), ...NESTED_KEYS.flatMap(k => lists(r[k]))]
    .filter(i => { const key = i && typeof i === 'object' ? `${i.title}\n${i.url}` : ''; if (!key || seen.has(key)) return false; seen.add(key); return true; })
    .filter((i): i is GrantLinks & { title: string; url?: string } => !!i && typeof i.title === 'string' && typeof i.siteUrl === 'string');
  if (!items.length) return null;
  const lines = items.slice(0, max).map(i => `- [${md(i.title)}](${i.siteUrl}) · more: [${md(i.pageLabel)}](${i.pageUrl})${typeof i.url === 'string' ? ` · official source: ${i.url}` : ''}`);
  const more = items.length > max ? [`…and ${items.length - max} more at ${SITE_ORIGIN}/grants`] : [];
  return ['View these grants on I Can Get Grants:', ...lines, ...more].join('\n');
}

/** Output-schema properties for the three link fields (all optional, so older readers and stored results still validate). */
export const grantLinkSchemaProperties = {
  siteUrl: { type: 'string', description: 'This grant on https://icangetgrants.com (home search for its title).' },
  pageUrl: { type: 'string', description: 'The matching https://icangetgrants.com/grants state or topic page (the /grants hub when none applies).' },
  pageLabel: { type: 'string', description: 'Label for pageUrl, e.g. "New York grants" or "Scholarships".' },
};
