// Worker env bindings (Site env vars and secrets) for Google sign-in. Values are never logged.
import { env } from 'cloudflare:workers';
import type { EnvLike } from '@/lib/google-auth';
import { d1LinkStore } from '@/lib/google-links';

export function authEnv(): EnvLike {
  return env as unknown as EnvLike;
}

export function linkStore() {
  return d1LinkStore(env.DB as never);
}
