import { getDb } from '@/db';
import { catalog, jobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publicRefresh } from './access';
import { allGrants } from './discovery';
import { seeds, type Grant } from './grants';
import { withDeadlineStatus } from './listing';
import { visitorGrants, visitorRefresh } from './workspace-privacy';

export const CATALOG_UNAVAILABLE = 'The live funding catalog could not be loaded. These are built-in listings only, not the full catalog.';
export const CATALOG_EMPTY = 'The live funding catalog has no saved listings yet. Showing built-in listings only.';

export type CatalogPayload = {
  grants: Grant[];
  refresh: ReturnType<typeof publicRefresh> | ReturnType<typeof visitorRefresh>;
  error: string | null;
  source: 'd1' | 'builtin';
};

// Only the catalog owner gets the full refresh projection; everyone else gets freshness only.
export async function loadCatalog({ owner = false }: { owner?: boolean } = {}): Promise<CatalogPayload> {
  try {
    const db = getDb();
    const present = await db.select({ id: catalog.id }).from(catalog);
    let refresh: CatalogPayload['refresh'] = null;
    try {
      const job = await db.select().from(jobs).where(eq(jobs.id, 'last-refresh'));
      const last = job[0] ? JSON.parse(job[0].data) : null;
      refresh = owner ? publicRefresh(last) : visitorRefresh(last);
    } catch {
      refresh = null;
    }
    if (!present.length) return { grants: seeds, refresh, error: CATALOG_EMPTY, source: 'builtin' };
    // Past-deadline listings (New York date) are served as closed and not live; stored rows are untouched.
    const now = new Date();
    return { grants: visitorGrants(await allGrants()).map(g => withDeadlineStatus(g, now)), refresh, error: null, source: 'd1' };
  } catch {
    return { grants: seeds, refresh: null, error: CATALOG_UNAVAILABLE, source: 'builtin' };
  }
}
