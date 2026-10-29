// Home "Opportunities" results: one ranking used by the server render (app/page.tsx), the public page API
// (/api/workspace?public=1) and the client dashboard, so the first page, every later page and the counts agree.
// Pure module, relative imports only, so tests can transpile it.
import { match, type Grant, type Profile } from './grants';
import { deadlineSortKey, isOpenGrant, queryTerms, relevanceScore } from './listing';
import { matchesPlace } from './catalog-geo';
import { availableInState, MAX_QUERY } from './home-search';

/** Cards per page: the home page renders this many and "Show more" adds this many (unchanged from before). */
export const HOME_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 1000;
export const SORTS = ['Best fit', 'Deadline', 'Largest award'] as const;
export const KINDS = ['All funding', 'Scholarship', 'Student aid', 'State grant', 'Private grant', 'Fellowship', 'Award / competition', 'Business grant', 'Community foundation grant', 'Federal grant', 'Microgrant'] as const;

export type ResultFilters = { query: string; kind: string; min: number; sort: string; city: string; county: string; state: string };
export const NO_FILTERS: ResultFilters = { query: '', kind: 'All funding', min: 0, sort: 'Best fit', city: '', county: '', state: '' };
export type ProfileFit = ReturnType<typeof match> & { p: Profile };
export type RankedGrant = { g: Grant; fit?: ProfileFit; profiles: ProfileFit[]; relevance: number };

/** What home search lists and counts: open and not searchHidden (the same rule as the /grants counts). */
export function homeListable(grants: Grant[], now = new Date()): Grant[] {
  return grants.filter(g => isOpenGrant(g, now) && !g.searchHidden);
}

/** The dashboard ranking: relevance first when there is a keyword, then the chosen sort. */
export function rankGrants(grants: Grant[], f: Partial<ResultFilters>, profiles: Profile[] = [], active: Profile | undefined = undefined, now = new Date()): RankedGrant[] {
  const o = { ...NO_FILTERS, ...f };
  const terms = queryTerms(o.query);
  const fitProfiles = active ? [active] : profiles;
  return homeListable(grants, now).map(g => {
    const fits = fitProfiles.map(p => ({ p, ...match(g, p) })).sort((a, b) => b.score - a.score);
    return { g, fit: fits[0], profiles: fits.filter(x => x.score > 0), relevance: terms.length ? relevanceScore(g, o.query) : 0 };
  }).filter(x => (!terms.length || x.relevance > 0) && (!profiles.length || !!x.fit?.score) && (o.kind === 'All funding' || x.g.kind === o.kind) && (!o.min || (x.g.amount || 0) >= o.min) && matchesPlace(x.g, o.city, o.county) && availableInState(x.g, o.state)).sort((a, b) => {
    if (terms.length && a.relevance !== b.relevance) return b.relevance - a.relevance;
    if (o.sort === 'Largest award') return (b.g.amount || 0) - (a.g.amount || 0);
    if (o.sort === 'Deadline') return deadlineSortKey(a.g.deadline, now).localeCompare(deadlineSortKey(b.g.deadline, now));
    return (b.fit?.score || 0) - (a.fit?.score || 0);
  });
}

const str = (v: string | null, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: string | null, lo: number, hi: number, dflt: number) => { if (v === null || !/^\d{1,7}$/.test(v.trim())) return dflt; return Math.min(hi, Math.max(lo, Number(v.trim()))); };

/** Reads the public results query (/api/workspace?public=1&page=…). Unknown values fall back to the defaults. */
export function parseResultsQuery(params: URLSearchParams): ResultFilters & { page: number; pageSize: number } {
  const kind = str(params.get('kind'), 60), sort = str(params.get('sort'), 30);
  return {
    query: str(params.get('q'), MAX_QUERY),
    kind: (KINDS as readonly string[]).includes(kind) ? kind : 'All funding',
    sort: (SORTS as readonly string[]).includes(sort) ? sort : 'Best fit',
    min: int(params.get('min'), 0, 1_000_000_000, 0),
    city: str(params.get('city'), 100), county: str(params.get('county'), 100), state: str(params.get('state'), 60),
    page: int(params.get('page'), 1, MAX_PAGE, 1),
    pageSize: int(params.get('pageSize'), 1, MAX_PAGE_SIZE, HOME_PAGE_SIZE),
  };
}

/** The query string the dashboard sends for a page of results (only non-default filters are included). */
export function resultsQueryString(f: ResultFilters, page: number, pageSize = HOME_PAGE_SIZE): string {
  const p = new URLSearchParams({ public: '1', page: String(page), pageSize: String(pageSize) });
  if (f.query.trim()) p.set('q', f.query.trim());
  if (f.state) p.set('state', f.state);
  if (f.kind && f.kind !== 'All funding') p.set('kind', f.kind);
  if (f.min) p.set('min', String(f.min));
  if (f.sort && f.sort !== 'Best fit') p.set('sort', f.sort);
  if (f.city) p.set('city', f.city);
  if (f.county) p.set('county', f.county);
  return p.toString();
}

/** A stable key for a set of filters, so a page response is only applied to the filters it was asked for. */
export function filtersKey(f: ResultFilters): string {
  return JSON.stringify([f.query.trim(), f.state, f.kind, f.min || 0, f.sort, f.city, f.county]);
}

export type ResultsPage = { grants: Grant[]; total: number; page: number; pageSize: number; pages: number };
export function pageOf(ranked: RankedGrant[], page: number, pageSize = HOME_PAGE_SIZE): ResultsPage {
  const total = ranked.length, pages = Math.max(1, Math.ceil(total / pageSize));
  return { grants: ranked.slice((page - 1) * pageSize, page * pageSize).map(x => x.g), total, page, pageSize, pages };
}
