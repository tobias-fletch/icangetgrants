import { getCurrentUser } from '@/app/current-user';
import { getWorkspace } from '@/lib/discovery';

// Tiny sign-in check for the cacheable /grants pages: they render the same HTML for everyone and ask here
// client-side. ChatGPT or Google sign-in (getCurrentUser). Signed out: 0 D1 queries. Signed in: 1 query (the visitor's own workspace row, for a profile count).
// Returns no personal data beyond whether the visitor has saved profiles.
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  const user = await getCurrentUser().catch(() => null);
  if (!user) return Response.json({ authenticated: false, profiles: 0 }, { headers });
  let profiles = 0;
  try { profiles = (await getWorkspace(user.userId)).profiles?.length || 0; } catch { profiles = 0; }
  return Response.json({ authenticated: true, profiles }, { headers });
}
