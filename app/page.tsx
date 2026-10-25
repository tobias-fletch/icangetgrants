import Dashboard from './dashboard';
import { loadCatalog } from '@/lib/catalog';
import { getCurrentUser } from './current-user';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // Reading the sign-in headers costs no D1 query; it lets guests get the beta-search form in the first paint
  // instead of after the workspace loads (that late insert was part of the 0.314 mobile CLS).
  // getCurrentUser() also recognizes a signed Google session (one D1 link lookup only when that cookie is present).
  const [catalog, user] = await Promise.all([loadCatalog(), getCurrentUser().catch(() => null)]);
  return (
    <Dashboard
      initialGrants={catalog.grants}
      initialRefresh={catalog.refresh}
      catalogError={catalog.error}
      catalogSource={catalog.source}
      renderedAt={new Date().toISOString()}
      initialAuthenticated={!!user}
    />
  );
}
