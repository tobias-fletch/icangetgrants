import { getDb } from '@/db';
import { catalog, jobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { publicRefresh } from './access';
import { allGrants } from './discovery';
import { seeds, type Grant } from './grants';

export const CATALOG_UNAVAILABLE = 'The live funding catalog could not be loaded. These are built-in listings only, not the full catalog.';
export const CATALOG_EMPTY = 'The live funding catalog has no saved listings yet. Showing built-in listings only.';

export type CatalogPayload = {
  grants: Grant[];
  refresh: ReturnType<typeof publicRefresh>;
  error: string | null;
  source: 'd1' | 'builtin';
};

export async function loadCatalog(): Promise<CatalogPayload> {
  try {
    const db = getDb();
    const present = await db.select({ id: catalog.id }).from(catalog);
    let refresh: CatalogPayload['refresh'] = null;
    try {
      const job = await db.select().from(jobs).where(eq(jobs.id, 'last-refresh'));
      refresh = publicRefresh(job[0] ? JSON.parse(job[0].data) : null);
    } catch {
      refresh = null;
    }
    if (!present.length) return { grants: seeds, refresh, error: CATALOG_EMPTY, source: 'builtin' };
    return { grants: await allGrants(), refresh, error: null, source: 'd1' };
  } catch {
    return { grants: seeds, refresh: null, error: CATALOG_UNAVAILABLE, source: 'builtin' };
  }
}
