import Dashboard from './dashboard';
import { loadPublicCatalog } from '@/lib/catalog';
import { HOME_PAGE_SIZE, pageOf, rankGrants } from '@/lib/home-results';
import { placeOptions } from '@/lib/catalog-geo';
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
  // Only the first HOME_PAGE_SIZE ranked results (for the ?q=…&state=… in the URL) and the totals are rendered;
  // the dashboard pages through /api/workspace?public=1 for more. The catalog is the memoized visitor view.
  // Quick links come from the same seo-index the /grants hub reads (memoized per isolate), so every link is a live page.
  const [catalog, user, site, params] = await Promise.all([
    loadPublicCatalog(),
    getCurrentUser().catch(() => null),
    loadSite().catch(() => null),
    Promise.resolve(searchParams).then(p => p ?? {}).catch(() => ({})),
  ]);
  const now = new Date();
  const searchStateOptions = searchStates(catalog.grants.filter(g => isOpenGrant(g, now) && !g.searchHidden));
  const search = parseHomeSearch(params, searchStateOptions);
  const first = pageOf(rankGrants(catalog.grants, { query: search.q, state: search.state }, [], undefined, now), 1, HOME_PAGE_SIZE);
  return (
    <Dashboard
      initialGrants={first.grants}
      initialComplete={false}
      initialTotal={first.total}
      initialPlaces={placeOptions(catalog.grants)}
      initialStateOptions={searchStateOptions}
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
