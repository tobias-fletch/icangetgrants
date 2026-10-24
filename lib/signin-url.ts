// The single place that decides where "Sign in" and "Save your profile" send a visitor.
// Today that is Sign in with ChatGPT (an OpenAI Sites route). To switch providers later
// (for example Google), change SIGN_IN_PATH / SIGN_IN_PROVIDER here and nowhere else.
export const SIGN_IN_PATH = '/signin-with-chatgpt';
export const SIGN_IN_PROVIDER = 'ChatGPT';
const AUTH_PATHS = ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'];

/** Same-site relative path only; anything else (absolute, protocol-relative, backslash, auth paths) becomes "/". */
export function safeReturnPath(returnTo: string | null | undefined): string {
  const value = (returnTo || '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  let url: URL;
  try { url = new URL(value, 'https://app.local'); } catch { return '/'; }
  if (url.origin !== 'https://app.local') return '/';
  if (AUTH_PATHS.includes(url.pathname)) return '/';
  return url.pathname + url.search + url.hash;
}

/** Sign-in link that brings the visitor back to `returnTo` (a same-site path) afterwards. */
export function signInUrl(returnTo: string = '/'): string {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}
