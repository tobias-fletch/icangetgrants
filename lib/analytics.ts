/**
 * Site verification and cookieless analytics config.
 * Both values are public (not secrets). Leave a value empty and nothing renders.
 */

/** Cloudflare Web Analytics site token. Empty = no beacon loads. */
export const CF_ANALYTICS_TOKEN = "";

/** Google Search Console URL-prefix verification: the content value of the google-site-verification meta tag. Empty = no tag. */
export const GOOGLE_SITE_VERIFICATION = "";

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
