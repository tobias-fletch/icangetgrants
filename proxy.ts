import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apexRedirectLocation } from "@/lib/site";
import { seoCanonicalRedirect } from "@/lib/seo-taxonomy";
import { seoCacheControl, seoRouteImpossible, type SeoSite } from "@/lib/seo-index";
import { loadSite } from "@/app/grants/seo-data";
import { withSecurityHeaders } from "@/lib/security-headers";

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

// Every response the app renders gets the shared security headers (lib/security-headers.ts).
export async function proxy(request: NextRequest) {
  return withSecurityHeaders(await route(request));
}

async function route(request: NextRequest) {
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
  return response;
}
