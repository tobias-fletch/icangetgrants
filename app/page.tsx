import Dashboard from './dashboard';
import { loadCatalog } from '@/lib/catalog';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const catalog = await loadCatalog();
  return (
    <Dashboard
      initialGrants={catalog.grants}
      initialRefresh={catalog.refresh}
      catalogError={catalog.error}
      catalogSource={catalog.source}
      renderedAt={new Date().toISOString()}
    />
  );
}
