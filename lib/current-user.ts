// One identity for workspace and profile storage. ChatGPT headers win; a Google session is the fallback.
// Internal user key:
//   ChatGPT user            -> their ChatGPT Site-scoped id (unchanged, so existing workspaces keep working)
//   Google user, linked     -> the linked ChatGPT id (same workspace)
//   Google user, not linked -> 'google:<sub>'
// This is for workspace data only. Owner/MCP access never uses it: see lib/access.ts and lib/admin.ts.
import { googleConfig, type EnvLike } from './google-auth';
import { SESSION_COOKIE, readCookie, verifySession } from './session';

export type Provider = 'chatgpt' | 'google';
export type CurrentUser = {
  userId: string;
  provider: Provider;
  chatgptUserId: string | null;
  googleSub: string | null;
  linked: boolean;
  displayName: string;
  email: string | null;
  fullName: string | null;
};
export type ChatGPTIdentity = { userId: string; email: string; fullName: string | null; displayName: string } | null;

export const GOOGLE_KEY_PREFIX = 'google:';
export const googleUserKey = (sub: string) => GOOGLE_KEY_PREFIX + sub;

export async function resolveCurrentUser(chatgpt: ChatGPTIdentity, cookieHeader: string | null | undefined, env: EnvLike, chatgptIdForSub: (sub: string) => Promise<string | null>, nowSeconds?: number): Promise<CurrentUser | null> {
  if (chatgpt) return { userId: chatgpt.userId, provider: 'chatgpt', chatgptUserId: chatgpt.userId, googleSub: null, linked: false, displayName: chatgpt.displayName, email: chatgpt.email, fullName: chatgpt.fullName };
  const cfg = googleConfig(env);
  if (!cfg) return null; // Google sign-in not configured: ignore any Google cookie.
  const session = await verifySession(readCookie(cookieHeader, SESSION_COOKIE), cfg.sessionSecret, nowSeconds);
  if (!session) return null;
  const linkedTo = await chatgptIdForSub(session.sub);
  return { userId: linkedTo ?? googleUserKey(session.sub), provider: 'google', chatgptUserId: null, googleSub: session.sub, linked: !!linkedTo, displayName: 'Google account', email: null, fullName: null };
}
