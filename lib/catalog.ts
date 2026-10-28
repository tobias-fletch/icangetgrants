import { getDb } from '@/db';
import { catalog, jobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publicRefresh } from './access';
import { allGrants } from './discovery';
import { seeds, type Grant } from './grants';
import { withDeadlineStatus } from './listing';
import { refreshHealth, isHiddenListing, isClosedListing, hasTitleAndLink, type RefreshHealth } from './catalog-sweep';
import { visitorGrants, visitorRefresh } from './workspace-privacy';

export const CATALOG_UNAVAILABLE = 'The live funding catalog could not be loaded. These are built-in listings only, not the full catalog.';
export const CATALOG_EMPTY = 'The live funding catalog has no saved listings yet. Showing built-in listings only.';

export type CatalogPayload = {
  grants: Grant[];
  // health is public for everyone (ok/partial/failed/stale, failed source names and run counts only).
  refresh: (Partial<NonNullable<ReturnType<typeof publicRefresh>>> & { health?: RefreshHealth }) | null;
  error: string | null;
  source: 'd1' | 'builtin';
};

// Only the catalog owner gets the full refresh projection; everyone else gets freshness only.
// keepIds: the signed-in account's own saved grants, kept even when closed so its tracker still shows them.
export async function loadCatalog({ owner = false, keepIds = [] }: { owner?: boolean; keepIds?: string[] } = {}): Promise<CatalogPayload> {
  try {
    const db = getDb();
    const present = await db.select({ id: catalog.id }).from(catalog);
    let refresh: CatalogPayload['refresh'] = null;
    try {
      const job = await db.select().from(jobs).where(eq(jobs.id, 'last-refresh'));
      const last = job[0] ? JSON.parse(job[0].data) : null;
      const view = owner ? publicRefresh(last) : visitorRefresh(last);
      let attempt = null;
      try {
        const row = await db.select().from(jobs).where(eq(jobs.id, 'last-refresh-attempt'));
        attempt = row[0] ? JSON.parse(row[0].data) : null;
      } catch { attempt = null; }
      refresh = { ...(view || {}), health: refreshHealth(last, attempt) };
    } catch {
      refresh = null;
    }
    if (!present.length) return { grants: seeds, refresh, error: CATALOG_EMPTY, source: 'builtin' };
    // Cross-source duplicates, listings without a title or link, scraped listings unseen for 30+ days and closed
    // listings (status Closed or a past deadline, New York date) are hidden; rows are kept. A closed listing the
    // account itself saved is still sent (marked closed) so its tracker entry keeps its details.
    const now = new Date(), keep = new Set(keepIds);
    const visible = (g: Grant) => !isHiddenListing(g, now.getTime()) || (keep.has(g.id) && isClosedListing(g, now.getTime()) && !g.duplicateOf && hasTitleAndLink(g));
    return { grants: visitorGrants(await allGrants()).map(g => withDeadlineStatus(g, now)).filter(visible), refresh, error: null, source: 'd1' };
  } catch {
    return { grants: seeds, refresh: null, error: CATALOG_UNAVAILABLE, source: 'builtin' };
  }
}
