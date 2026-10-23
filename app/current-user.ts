// getCurrentUser(): the single identity used for workspace and profile storage.
// ChatGPT headers first (unchanged keys), then a signed Google session. Not for owner checks:
// lib/admin.ts isOwner() keeps using getChatGPTUser() only.
import { headers } from 'next/headers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { resolveCurrentUser, type CurrentUser } from '@/lib/current-user';
import { googleConfig } from '@/lib/google-auth';
import { authEnv, linkStore } from '@/app/auth/google-env';

export type { CurrentUser };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = linkStore();
  return resolveCurrentUser(await getChatGPTUser(), (await headers()).get('cookie'), authEnv(), (sub) => store.chatgptIdForSub(sub));
}

/** Sign-in options for the UI. googleEnabled is false until all three secrets are set. */
export async function authStatus(user: CurrentUser | null) {
  const googleEnabled = !!googleConfig(authEnv());
  let googleLinked = user?.provider === 'google' ? user.linked : false;
  if (googleEnabled && user?.provider === 'chatgpt') googleLinked = !!(await linkStore().subForChatGPT(user.userId).catch(() => null));
  return { provider: user?.provider ?? null, googleEnabled, googleLinked };
}
