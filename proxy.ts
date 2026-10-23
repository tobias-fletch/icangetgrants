import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apexRedirectLocation } from "@/lib/site";

export function proxy(request: NextRequest) {
  const location = apexRedirectLocation(
    request.headers.get("host"),
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (!location) return NextResponse.next();

  const response = NextResponse.redirect(location, 301);
  response.headers.set("Cache-Control", "public, max-age=3600");
  response.headers.set("Vary", "Host");
  return response;
}
