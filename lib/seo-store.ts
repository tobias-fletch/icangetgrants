// D1 access for the SEO pages. Pure (the D1 binding is passed in), relative imports only, so tests can
// run it against a fake database that counts queries.
//   Normal path: 1 query  — SELECT data FROM jobs WHERE id = 'seo-index'
//   Fallback:    2 queries — the above, then one UNION query over catalog + the last-refresh row
//   Memo hit:    0 queries — the parsed index is kept per Worker isolate for SEO_MEMO_MS
// No outbound fetches anywhere in this module.
import { buildSeoIndex, isSeoIndex, mergeWithSeeds, SEO_INDEX_JOB_ID, type SeoIndex } from './seo-index';
import { publicRefresh } from './access';
import type { Grant } from './grants';

export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
export type D1Like = { prepare(sql: string): D1Statement };

export const SEO_MEMO_MS = 5 * 60 * 1000;
export const SEO_INDEX_SQL = 'SELECT data FROM jobs WHERE id = ?';
export const SEO_FALLBACK_SQL = "SELECT 'c' AS t, data FROM catalog UNION ALL SELECT 'r' AS t, data FROM jobs WHERE id = 'last-refresh'";
const UPSERT_SQL = 'INSERT INTO jobs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data';

export type SeoIndexRead = { index: SeoIndex; source: 'seo-index' | 'catalog-fallback'; d1Queries: number; cacheHit: boolean };

let memo: { at: number; index: SeoIndex; source: SeoIndexRead['source'] } | null = null;
let inflight: Promise<SeoIndexRead> | null = null;

export function resetSeoMemo() { memo = null; inflight = null; }

async function fromCatalog(db: D1Like, now: Date): Promise<SeoIndex> {
  const { results } = await db.prepare(SEO_FALLBACK_SQL).all<{ t: string; data: string }>();
  const records: Grant[] = [];
  let refresh: { checkedAt?: string } | null = null;
  for (const row of results || []) {
    try {
      const value = JSON.parse(row.data);
      if (row.t === 'r') refresh = publicRefresh(value);
      else records.push(value as Grant);
    } catch { /* skip a corrupt row */ }
  }
  return buildSeoIndex(mergeWithSeeds(records), refresh, now);
}

/** Reads the stored index (1 query). Never writes from a GET. */
export async function readSeoIndex(db: D1Like, nowMs = Date.now()): Promise<SeoIndexRead> {
  if (memo && nowMs - memo.at < SEO_MEMO_MS) return { index: memo.index, source: memo.source, d1Queries: 0, cacheHit: true };
  if (inflight) return inflight.then(r => ({ ...r, d1Queries: 0, cacheHit: true }));
  inflight = (async () => {
    let queries = 1;
    let index: SeoIndex | null = null;
    try {
      const row = await db.prepare(SEO_INDEX_SQL).bind(SEO_INDEX_JOB_ID).first<{ data: string }>();
      const parsed = row ? JSON.parse(row.data) : null;
      if (isSeoIndex(parsed)) index = parsed;
    } catch { index = null; }
    let source: SeoIndexRead['source'] = 'seo-index';
    if (!index) { queries++; source = 'catalog-fallback'; index = await fromCatalog(db, new Date(nowMs)); }
    memo = { at: nowMs, index, source };
    return { index, source, d1Queries: queries, cacheHit: false };
  })();
  try { return await inflight; } finally { inflight = null; }
}

/** One upsert. Called once per refresh (end of discover() and recordStateOpportunities()). */
export async function writeSeoIndex(db: D1Like, grants: Grant[], refresh: { checkedAt?: string } | null, now = new Date()): Promise<SeoIndex> {
  const index = buildSeoIndex(mergeWithSeeds(grants), refresh, now);
  await db.prepare(UPSERT_SQL).bind(SEO_INDEX_JOB_ID, JSON.stringify(index)).run();
  memo = null;
  return index;
}

/** Rebuilds from what is stored (1 read + 1 write). Used after state research writes to the catalog. */
export async function rebuildSeoIndex(db: D1Like, now = new Date()): Promise<SeoIndex> {
  const index = await fromCatalog(db, now);
  await db.prepare(UPSERT_SQL).bind(SEO_INDEX_JOB_ID, JSON.stringify(index)).run();
  memo = null;
  return index;
}
