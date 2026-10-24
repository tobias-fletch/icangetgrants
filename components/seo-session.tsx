'use client';
import { useEffect, useState } from 'react';
import { signInUrl, SIGN_IN_PROVIDER } from '@/lib/signin-url';

// The /grants pages are cached and identical for every visitor, so sign-in state is checked here, in the browser.
type Session = { authenticated: boolean; profiles: number };
let sessionPromise: Promise<Session | null> | null = null;
function loadSession(): Promise<Session | null> {
  if (!sessionPromise) {
    sessionPromise = fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<Session>) : null))
      .catch(() => null);
  }
  return sessionPromise as Promise<Session | null>;
}
function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => { let live = true; loadSession().then(s => { if (live) setSession(s); }); return () => { live = false; }; }, []);
  return session;
}

/** "Save your profile" call to action. Guests go through the one sign-in helper (lib/signin-url.ts). */
export function SaveProfileCta({ returnTo, label, place }: { returnTo: string; label: string; place: 'top' | 'bottom' | 'home' }) {
  const session = useSession();
  let href = signInUrl(returnTo);
  let text = label;
  let note = `Free during beta. Sign in with ${SIGN_IN_PROVIDER}; alerts appear in your Updates inbox.`;
  if (session?.authenticated) {
    if (session.profiles > 0) { href = '/'; text = 'View your matches'; note = 'New matches for your monitored profiles appear in your Updates inbox.'; }
    else { href = returnTo; text = 'Create your profile'; note = 'Alerts appear in your Updates inbox. Nothing is saved until you press Save profile.'; }
  }
  return (
    <aside className={`save-cta save-cta-${place}`} aria-label="Save your profile">
      <a className="btn primary save-cta-button" href={href} data-cta="save-profile">{text}</a>
      <p>{note}</p>
    </aside>
  );
}

/** Header account link: "Sign in / Create account" for guests, "Your workspace" once signed in. */
export function HeaderAccountLink({ returnTo }: { returnTo: string }) {
  const session = useSession();
  if (session?.authenticated) return <a className="account-link" href="/">Your workspace</a>;
  return <a className="account-link" href={signInUrl(returnTo)}>Sign in / Create account</a>;
}
