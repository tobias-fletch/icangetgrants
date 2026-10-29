// Search-first home page: the search box at the top of / filters the existing Opportunities results on the
// same page (the app's search). /grants itself takes no query parameters, so the box submits to /?q=…&state=….
// Pure module, relative imports only, so tests can transpile it.
import type { Grant } from './grants';

export type QuickLink = { path: string; label: string };
export type HomeQuickLinks = { topics: QuickLink[]; states: QuickLink[] };
export const NO_QUICK_LINKS: HomeQuickLinks = { topics: [], states: [] };

/** Longest keyword accepted from the URL; longer input is cut, not rejected. */
export const MAX_QUERY = 200;

// Same rule as isNationwide() in seo-index.ts (kept local so the client bundle does not pull in the SEO index).
const NATIONWIDE_COUNTRIES = new Set(['United States', 'Worldwide', 'Unspecified']);
export function openNationwide(g: Pick<Grant, 'states' | 'countries'>): boolean {
  if ((g.states || []).length) return false;
  const countries = g.countries || [];
  return !countries.length || countries.some(c => NATIONWIDE_COUNTRIES.has(c));
}

/** A listing is available in a state when it is limited to that state or open nationwide (as on the state pages). */
export function availableInState(g: Pick<Grant, 'states' | 'countries'>, state: string): boolean {
  if (!state) return true;
  return (g.states || []).includes(state) || openNationwide(g);
}

/** The state picker offers only states that have state-specific listings in the catalog, A–Z. */
export function searchStates(grants: Pick<Grant, 'states'>[]): string[] {
  return [...new Set(grants.flatMap(g => g.states || []))].filter(s => typeof s === 'string' && s.trim()).sort((a, b) => a.localeCompare(b));
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Reads ?q= and ?state= from the home URL. A state outside the picker is ignored. */
export function parseHomeSearch(params: Record<string, unknown> | URLSearchParams | null | undefined, states: string[]): { q: string; state: string } {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : first(params?.[k]));
  const q = typeof get('q') === 'string' ? (get('q') as string).trim().slice(0, MAX_QUERY) : '';
  const raw = typeof get('state') === 'string' ? (get('state') as string).trim().toLowerCase() : '';
  const state = states.find(s => s.toLowerCase() === raw) || '';
  return { q, state };
}

/** "/?q=…&state=…" for a search, or "/" when both are empty. */
export function homeSearchHref(q: string, state: string): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (state) p.set('state', state);
  const s = p.toString();
  return s ? '/?' + s : '/';
}

// Topic quick links lead with the applicant types visitors pick most (small business, nonprofit), then follow the
// /grants hub order. Only pages the hub lists (indexable, so they return 200) are passed in.
const TOPIC_FIRST = ['/grants/small-business', '/grants/nonprofit', '/grants/scholarships'];
// State chips: every state that has a /grants/<state> page in the /grants hub's "By state" list (the same list
// the sitemap uses), so a new state page shows up on the home page by itself. The three original chips keep their
// place at the front; every other state page follows in the hub's order (A–Z).
export const HOME_STATE_FIRST = ['/grants/new-york', '/grants/pennsylvania', '/grants/louisiana'];

export function homeStateLinks(states: QuickLink[]): QuickLink[] {
  const rank = (p: string) => { const i = HOME_STATE_FIRST.indexOf(p); return i < 0 ? HOME_STATE_FIRST.length : i; };
  return states.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l.path) - rank(b.l.path) || a.i - b.i).map(x => x.l);
}

export function homeQuickLinks(hub: { categories: QuickLink[]; states: QuickLink[] } | null | undefined): HomeQuickLinks {
  // Only path and label go to the client; the counts stay on /grants.
  if (!hub) return NO_QUICK_LINKS;
  const rank = (p: string) => { const i = TOPIC_FIRST.indexOf(p); return i < 0 ? TOPIC_FIRST.length : i; };
  const topics = hub.categories.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l.path) - rank(b.l.path) || a.i - b.i).map(x => x.l);
  const states = homeStateLinks(hub.states);
  const pick = (l: QuickLink) => ({ path: l.path, label: l.label });
  return { topics: topics.map(pick), states: states.map(pick) };
}
