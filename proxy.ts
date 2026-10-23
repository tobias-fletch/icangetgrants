import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apexRedirectLocation } from "@/lib/site";
import { seoCanonicalRedirect } from "@/lib/seo-taxonomy";

// Public /grants pages and the sitemap render the same HTML for every visitor (sign-in state is checked
// client-side via /api/session), so they can be cached at the edge.
export const SEO_CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const isSeoPath = (p: string) => p === "/grants" || p.startsWith("/grants/") || p === "/sitemap.xml";

export function proxy(request: NextRequest) {
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
  if (isSeoPath(pathname)) response.headers.set("Cache-Control", SEO_CACHE_CONTROL);
  return response;
}
