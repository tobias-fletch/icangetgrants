// Security response headers, matched to the set Tobias's other sites already serve
// (portfolio-current, fletcherofficiates, brass-soul-website, TaleSpyre). proxy.ts adds them to every
// response the app renders (pages, /api/*, /auth/*, /sitemap.xml, redirects); public/_headers carries the
// same values for static files in case the host serves those without running the app.
//
// - HSTS starts at 1 day with no includeSubDomains and no preload, on purpose (a pending decision).
// - The CSP is Report-Only: violations show in the browser console and nothing is blocked.
//   It lists only what the app loads today:
//     script-src  'unsafe-inline' for the inline scripts vinext/React write into each page (RSC payload,
//                 hydration bootstrap); static.cloudflareinsights.com for the Web Analytics beacon (lib/analytics.ts).
//     connect-src cloudflareinsights.com (beacon reports) and tobiasfletcher.com (contact relay, lib/contact.ts).
//   Google sign-in is a top-level redirect (/auth/google/start -> accounts.google.com, lib/google-auth.ts),
//   and Sign in with ChatGPT is a platform redirect, so neither needs a CSP entry; the token and JWKS calls
//   (oauth2.googleapis.com, www.googleapis.com) run server-side. Fonts are system fonts (app/globals.css).
// Keep public/_headers in sync with this file (tests/security-headers.test.mjs checks it).

export const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://tobiasfletcher.com https://cloudflareinsights.com",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Strict-Transport-Security": "max-age=86400",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
  "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
});

/** Sets any security header the response does not already carry, and returns the same response. */
export function withSecurityHeaders<T extends { headers: Headers }>(response: T): T {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  return response;
}
