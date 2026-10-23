/**
 * Site verification and cookieless analytics config.
 * Both values are public (not secrets). Leave a value empty and nothing renders.
 */

/** Cloudflare Web Analytics site token for icangetgrants.com (public). Empty = no beacon loads. */
export const CF_ANALYTICS_TOKEN = "641ab131ef6442d5911c1881c5fe7d65";

/** Google Search Console URL-prefix verification for https://icangetgrants.com/: the content value of the google-site-verification meta tag. Empty = no tag. Keep it after verifying (Google re-checks). */
export const GOOGLE_SITE_VERIFICATION = "u3x-wOrf_imKdhDSSEKkmc67G5m1Cddn1F2xHGLnKDo";

export const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

export function validAnalyticsToken(value: string | null | undefined): string | null {
  const token = (value ?? "").trim();
  return /^[A-Za-z0-9]{16,64}$/.test(token) ? token : null;
}

export function validSiteVerification(value: string | null | undefined): string | null {
  const token = (value ?? "").trim();
  return /^[A-Za-z0-9_-]{10,100}$/.test(token) ? token : null;
}

/** Attributes for the beacon script tag, or null when no valid token is configured. */
export function cloudflareBeaconAttributes(value: string | null | undefined = CF_ANALYTICS_TOKEN) {
  const token = validAnalyticsToken(value);
  return token ? { defer: true, src: CF_BEACON_SRC, "data-cf-beacon": JSON.stringify({ token }) } : null;
}

export const ANALYTICS_PRIVACY_LINE =
  "We count visits with Cloudflare Web Analytics, which uses no cookies and doesn’t track you across sites.";

/** Privacy-page sentence, shown only when a valid token is configured (so it ships with the token). */
export function analyticsPrivacyLine(value: string | null | undefined = CF_ANALYTICS_TOKEN): string | null {
  return validAnalyticsToken(value) ? ANALYTICS_PRIVACY_LINE : null;
}

/** What the privacy page says the app does not include; drops "or analytics" only when the beacon actually ships. */
export function excludedLibrariesPhrase(value: string | null | undefined = CF_ANALYTICS_TOKEN): string {
  return validAnalyticsToken(value) ? "an advertising library" : "an advertising or analytics library";
}
