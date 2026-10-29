// Guest page views on the ChatGPT Sites host (SITES_HOSTNAMES below) get a 301 to the same
// path and query on https://icangetgrants.com. The same Worker serves both hosts, and the Sites host must keep
// working for the ChatGPT plugin (/mcp and its OAuth metadata), Sign in with ChatGPT and Google sign-in (their
// redirect URIs are built from the request host), the API, static assets, and anything ChatGPT loads in a frame.
// Pure module, relative imports only, so tests can transpile it.
import { SITE_ORIGIN, normalizeRequestHost } from './site';

/** Hosts whose guest page views move to SITE_ORIGIN. Exact match only (no wildcard), so other Sites projects and previews are untouched. */
export const SITES_HOSTNAMES: ReadonlySet<string> = new Set(['grantwell-match.tobias-fletch.chatgpt.site']);

const SITES_AUTH_PATHS = new Set(['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback']);
// Exact paths and path prefixes that are never redirected.
const EXCLUDED_PREFIXES = ['/mcp/', '/.well-known/', '/api/', '/auth/', '/_next/', '/_vinext/', '/assets/', '/cdn-cgi/', '/@'];
// Signed-in identity: Sites injects oai-authenticated-user-* on signed-in requests; Google sign-in uses these cookies.
// Both are host-only, so moving a signed-in visitor to the other host would sign them out.
const SESSION_COOKIES = ['__Host-icgg_session', '__Host-icgg_google_oauth'];
// User agents of ChatGPT / OpenAI fetchers (ChatGPT-User, OAI-SearchBot, GPTBot, OpenAI app/plugin fetchers).
const OPENAI_AGENT = /chatgpt|openai|\boai-|gptbot/i;

/** True for paths the redirect must never touch: plugin, OAuth, sign-in, API, framework and static files. */
export function isExcludedPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (p === '/mcp' || SITES_AUTH_PATHS.has(p) || p === '/.well-known') return true;
  if (EXCLUDED_PREFIXES.some(prefix => p.startsWith(prefix))) return true;
  // Any file-like last segment (favicon.ico, og.png, robots.txt, sitemap.xml, *.js, *.css, widget HTML, ...).
  const last = p.slice(p.lastIndexOf('/') + 1);
  return /\.[a-z0-9]{1,8}$/.test(last);
}

type HeaderReader = { get(name: string): string | null };
type RequestLike = { method: string; headers: HeaderReader };

function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some(part => {
    const name = part.split('=')[0]?.trim();
    return !!name && SESSION_COOKIES.includes(name);
  });
}

// Belt and braces only: vinext strips the RSC/prefetch headers and the .rsc suffix before proxy.ts runs (seen in local
// preview), so the primary guard for client navigations is Sec-Fetch-Dest ("empty"), which every current browser sends.
function isPrefetchOrRsc(h: HeaderReader): boolean {
  if (h.get('rsc') !== null || h.get('next-router-prefetch') !== null || h.get('next-router-state-tree') !== null) return true;
  if (h.get('x-middleware-prefetch') === '1') return true;
  return [h.get('purpose'), h.get('sec-purpose')].some(v => typeof v === 'string' && v.split(/[;,]/).some(part => part.trim().toLowerCase() === 'prefetch'));
}

/**
 * 301 target on SITE_ORIGIN for a guest page view on the Sites host, or null to serve the request as is.
 * Redirects only GET/HEAD top-level page loads (Sec-Fetch-Dest "document" or absent, as for crawlers) from visitors with no
 * signed-in identity and no Authorization header, outside the excluded paths, and not from a ChatGPT/OpenAI user agent.
 */
export function sitesHostRedirectLocation(request: RequestLike, pathname: string, search: string): string | null {
  const h = request.headers;
  if (!SITES_HOSTNAMES.has(normalizeRequestHost(h.get('host')))) return null;
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (isExcludedPath(pathname)) return null;
  // Embedded loads (the ChatGPT Sites preview pane, widgets) and fetch()/RSC navigations stay on this host.
  const dest = h.get('sec-fetch-dest');
  if (dest !== null && dest !== '' && dest.toLowerCase() !== 'document') return null;
  if (isPrefetchOrRsc(h)) return null;
  if (h.get('authorization') !== null) return null;
  if (h.get('oai-authenticated-user-id') !== null || h.get('oai-authenticated-user-email') !== null) return null;
  if (hasSessionCookie(h.get('cookie'))) return null;
  if (OPENAI_AGENT.test(h.get('user-agent') || '')) return null;

  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.includes('\0')) return `${SITE_ORIGIN}/`;
  const query = search === '' || search.startsWith('?') ? search : `?${search}`;
  let destination: URL;
  try {
    destination = new URL(pathname + query, SITE_ORIGIN);
  } catch {
    return `${SITE_ORIGIN}/`;
  }
  if (destination.origin !== SITE_ORIGIN || destination.username || destination.password) return `${SITE_ORIGIN}/`;
  return destination.href;
}
