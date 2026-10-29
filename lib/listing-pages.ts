// /grants?page=N: every open listing, 24 per page, soonest deadline first. The no-JavaScript, crawlable
// counterpart of the home "Show more" button. Same data and visibility rule as the /grants hub (SeoSite.open),
// so page counts agree with "Search all N listings". Pure module, relative imports only.
import { SEO_CACHE_CONTROL, SEO_NOT_FOUND_CACHE_CONTROL, sortListings, type SeoListing, type SeoSite } from './seo-index';
import { SITE_NAME } from './site';

export const LISTING_PAGE_SIZE = 24;

/** undefined: no ?page (the hub). null: present but not a page number (404). */
export function parseListingPage(raw: string | string[] | null | undefined): number | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && /^[1-9]\d{0,4}$/.test(v) ? Number(v) : null;
}

export const listingPagePath = (n: number) => `/grants?page=${n}`;
export const listingPageCount = (site: SeoSite) => Math.max(1, Math.ceil(site.open.length / LISTING_PAGE_SIZE));

export type ListingPage = { page: number; pages: number; total: number; items: SeoListing[]; title: string; description: string; h1: string; path: string; prev: string | null; next: string | null };

/** null when the page is out of range (404). */
export function listingPage(site: SeoSite, page: number): ListingPage | null {
  const pages = listingPageCount(site), total = site.open.length;
  if (!Number.isInteger(page) || page < 1 || page > pages) return null;
  const items = sortListings(site.open, site.now).slice((page - 1) * LISTING_PAGE_SIZE, page * LISTING_PAGE_SIZE);
  const from = total ? (page - 1) * LISTING_PAGE_SIZE + 1 : 0, to = (page - 1) * LISTING_PAGE_SIZE + items.length;
  return {
    page, pages, total, items,
    path: listingPagePath(page),
    h1: `All open grant listings: page ${page} of ${pages}`,
    title: `All open grant listings, page ${page} of ${pages} · ${SITE_NAME}`,
    description: `Open grants, scholarships and funding listings ${from}–${to} of ${total}, soonest deadline first. Check eligibility with each funder before applying.`,
    prev: page > 1 ? listingPagePath(page - 1) : null,
    next: page < pages ? listingPagePath(page + 1) : null,
  };
}

/** Cache-Control for /grants?page=…: the normal /grants cache, or the short 404 cache when there is no such page. */
export function listingPageCacheControl(site: SeoSite | null, raw: string | null): string {
  const n = parseListingPage(raw);
  if (n === undefined) return SEO_CACHE_CONTROL;
  return site && n !== null && listingPage(site, n) ? SEO_CACHE_CONTROL : SEO_NOT_FOUND_CACHE_CONTROL;
}
