import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apexRedirectLocation } from "@/lib/site";
import { seoCanonicalRedirect } from "@/lib/seo-taxonomy";
import { seoCacheControl, seoRouteImpossible, type SeoSite } from "@/lib/seo-index";
import { loadSite } from "@/app/grants/seo-data";
import { homeCacheControl } from "@/lib/home-cache";
import { listingPageCacheControl } from "@/lib/listing-pages";

// Public /grants pages and the sitemap render the same HTML for every visitor (sign-in state is checked
// client-side via /api/session), so they can be cached at the edge. 404s get a 5-minute cache instead of
// 1 hour (lib/seo-index.ts). The proxy can't see the response status, so it asks the same memoised data
// the page uses: the page render then reuses the memo, so a request still costs at most 1 D1 query.
const isSeoPath = (p: string) => p === "/grants" || p.startsWith("/grants/") || p === "/sitemap.xml";

async function seoSiteFor(pathname: string): Promise<SeoSite | null> {
  if (!pathname.startsWith("/grants/") || seoRouteImpossible(pathname)) return null;
  try {
    return await loadSite();
  } catch {
    return null; // the page will fail too; keep any cached copy short
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const location = apexRedirectLocation(request.headers.get("host"), pathname, search);
  if (location) {
    const response = NextResponse.redirect(location, 301);
    response.headers.set("Cache-Control", "public, max-age=3600");
    response.headers.set("Vary", "Host");
    return response;
  }

  // One canonical URL per /grants page: lowercase, full state slug (/grants/NY → /grants/new-york), no trailing slash.
  const canonical = pathname === "/grants/" ? "/grants" : seoCanonicalRedirect(pathname);
  if (canonical) {
    const url = request.nextUrl.clone();
    url.pathname = canonical;
    const response = NextResponse.redirect(url, 301);
    response.headers.set("Cache-Control", "public, max-age=3600");
    return response;
  }

  const response = NextResponse.next();
  if (isSeoPath(pathname)) response.headers.set("Cache-Control", seoCacheControl(await seoSiteFor(pathname), pathname));
  // /grants?page=N (all listings, paged): same cache as /grants, or the short 404 cache for a page that doesn't exist.
  if (pathname === "/grants" && request.nextUrl.searchParams.has("page")) {
    let site: SeoSite | null = null;
    try { site = await loadSite(); } catch { site = null; }
    response.headers.set("Cache-Control", listingPageCacheControl(site, request.nextUrl.searchParams.get("page")));
  }
  // Home: guests share one short-lived cached copy; anything that may be signed in is never cached (lib/home-cache.ts).
  if (pathname === "/") {
    response.headers.set("Cache-Control", homeCacheControl(request.headers));
    response.headers.append("Vary", "Cookie, oai-authenticated-user-id");
  }
  return response;
}
