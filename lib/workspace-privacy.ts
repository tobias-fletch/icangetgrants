import { statePlan } from './state-registry';
import type { Grant, Profile } from './grants';

// What GET /api/workspace (and the home page render) may show to someone who is not the catalog owner.
// The last-refresh job is built from every account's monitored profiles: per-source status ("Not needed"),
// record/request counts, notes ("2 state routes checked") and the total checked all reveal what is monitored.
// Visitors and regular accounts get freshness plus the static coverage statement only.

export type VisitorRefresh = { checkedAt?: string; coverage?: string } | null;

export function visitorRefresh(value: any): VisitorRefresh {
  if (!value || typeof value !== 'object') return null;
  const out: { checkedAt?: string; coverage?: string } = {};
  if (typeof value.checkedAt === 'string') out.checkedAt = value.checkedAt;
  if (typeof value.coverage === 'string') out.coverage = value.coverage;
  return out;
}

export type StateCoverageReport = { code: string; category: string; [key: string]: unknown };

// State scan reports exist because some account saved a profile in that state. Signed-out visitors get none;
// a signed-in account gets only the routes its own profiles would schedule; the owner gets all of them.
export function visibleStateCoverage<T extends StateCoverageReport>(reports: T[], profiles: Profile[] | null | undefined, owner = false): T[] {
  if (owner) return reports;
  if (!profiles?.length) return [];
  const own = new Set(statePlan(profiles).map(t => t.source.code + '-' + t.category));
  return reports.filter(r => own.has(r.code + '-' + r.category));
}

// CareerOneStop detail links keep the query string of the search that found them (a monitored profile's
// interest keyword and residency state). The detail page needs only scholarshipId.
const SEARCH_CONTEXT = new Set(['keyword', 'georestrictionfilter', 'pagesize', 'curpage']);

export function stripSearchContext(url: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)careeronestop\.org$/i.test(u.hostname)) return url;
    let changed = false;
    for (const key of [...u.searchParams.keys()]) if (SEARCH_CONTEXT.has(key.toLowerCase())) { u.searchParams.delete(key); changed = true; }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

export function visitorGrants(grants: Grant[]): Grant[] {
  return grants.map(g => {
    const url = typeof g.url === 'string' ? stripSearchContext(g.url) : g.url;
    return url === g.url ? g : { ...g, url };
  });
}
