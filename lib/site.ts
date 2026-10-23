export const SITE_HOSTNAME = "icangetgrants.com";
export const SITE_ORIGIN = `https://${SITE_HOSTNAME}`;
export const WWW_HOSTNAME = `www.${SITE_HOSTNAME}`;
export const SITE_NAME = "I Can Get Grants";
export const SITE_TITLE = "I Can Get Grants — Find funding that fits you";
export const SITE_DESCRIPTION =
  "Search grants, scholarships and student aid for free during beta. No account required to search; sign in to save your funding workspace.";

export function normalizeRequestHost(hostHeader: string | null): string {
  if (!hostHeader) return "";
  let host = hostHeader.split(",")[0]?.trim().toLowerCase() ?? "";
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  const colon = host.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) {
    host = host.slice(0, colon);
  }
  return host;
}

/** 301 target for the www host only. Other hosts, including previews and the apex, return null. */
export function apexRedirectLocation(
  hostHeader: string | null,
  pathname: string,
  search: string,
): string | null {
  if (normalizeRequestHost(hostHeader) !== WWW_HOSTNAME) return null;

  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("\\") || pathname.includes("\0")) {
    return `${SITE_ORIGIN}/`;
  }
  const query = search === "" || search.startsWith("?") ? search : `?${search}`;

  let destination: URL;
  try {
    destination = new URL(pathname + query, SITE_ORIGIN);
  } catch {
    return `${SITE_ORIGIN}/`;
  }
  if (destination.origin !== SITE_ORIGIN || destination.username || destination.password) {
    return `${SITE_ORIGIN}/`;
  }
  return destination.href;
}
