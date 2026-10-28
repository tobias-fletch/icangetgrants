import Dashboard from './dashboard';
import { loadCatalog } from '@/lib/catalog';
import { getCurrentUser } from './current-user';
import { hubContent } from '@/lib/seo-index';
import { homeQuickLinks, NO_QUICK_LINKS, parseHomeSearch, searchStates } from '@/lib/home-search';
import { loadSite } from './grants/seo-data';
import { isOpenGrant } from '@/lib/listing';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  // Reading the sign-in headers costs no D1 query; it lets guests get the beta-search form in the first paint
  // instead of after the workspace loads (that late insert was part of the 0.314 mobile CLS).
  // getCurrentUser() also recognizes a signed Google session (one D1 link lookup only when that cookie is present).
  // Quick links come from the same seo-index the /grants hub reads (memoized per isolate), so every link is a live page.
  const [catalog, user, site, params] = await Promise.all([
    loadCatalog(),
    getCurrentUser().catch(() => null),
    loadSite().catch(() => null),
    Promise.resolve(searchParams).then(p => p ?? {}).catch(() => ({})),
  ]);
  const now = new Date();
  const searchStateOptions = searchStates(catalog.grants.filter(g => isOpenGrant(g, now)));
  const search = parseHomeSearch(params, searchStateOptions);
  return (
    <Dashboard
      initialGrants={catalog.grants}
      initialRefresh={catalog.refresh}
      catalogError={catalog.error}
      catalogSource={catalog.source}
      renderedAt={now.toISOString()}
      initialAuthenticated={!!user}
      quickLinks={site ? homeQuickLinks(hubContent(site)) : NO_QUICK_LINKS}
      initialQuery={search.q}
      initialStateFilter={search.state}
    />
  );
}
