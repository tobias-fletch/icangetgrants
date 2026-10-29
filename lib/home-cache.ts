// Cache-Control for the home page and the public results API. Pure module, relative imports only.
//
// Guests all get the same home HTML (first page of results, counts, no personal data), so it may be cached for
// a short time by a shared cache: 5 minutes fresh, then served stale for up to 10 more while it refreshes.
// No max-age: a browser always revalidates, so after signing in a visitor never sees a stored guest page.
// Signed-in requests (a ChatGPT identity header from the platform, or our Google session cookie, even an
// invalid one) are never cached anywhere.
export const GUEST_HTML_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
export const PRIVATE_CACHE_CONTROL = 'private, no-store';
// /api/workspace?public=1 never reads cookies or identity headers, so its response depends only on the URL.
// One minute in browsers (repeat "Show more" and back/forward), 5 minutes at a shared cache.
export const PUBLIC_API_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

const CHATGPT_USER_HEADER = 'oai-authenticated-user-id';
const GOOGLE_SESSION_COOKIE = '__Host-icgg_session';

type HeaderLike = { get(name: string): string | null };

/** True when the request may belong to a signed-in visitor. Errs on the side of "signed in". */
export function maybeSignedIn(headers: HeaderLike): boolean {
  if (headers.get(CHATGPT_USER_HEADER) || headers.get('oai-authenticated-user-email')) return true;
  const cookie = headers.get('cookie') || '';
  return cookie.split(';').some(c => c.trim().startsWith(GOOGLE_SESSION_COOKIE + '='));
}

export function homeCacheControl(headers: HeaderLike): string {
  return maybeSignedIn(headers) ? PRIVATE_CACHE_CONTROL : GUEST_HTML_CACHE_CONTROL;
}
