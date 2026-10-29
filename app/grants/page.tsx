import { SeoShell, JsonLd, Breadcrumbs, RefreshLine, ListingList, LinkGrid } from '@/components/seo-page';
import { SaveProfileCta } from '@/components/seo-session';
import { hubContent, seoJsonLd, saveProfileReturn } from '@/lib/seo-index';
import { loadSite, hubMetadata } from './seo-data';
import { notFound } from 'next/navigation';
import { listingPage, listingPagePath, parseListingPage } from '@/lib/listing-pages';

export const dynamic = 'force-dynamic';
export const generateMetadata = hubMetadata;

export default async function GrantsHub({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await Promise.resolve(searchParams).then(p => p ?? {}).catch(() => ({} as Record<string, string | string[] | undefined>));
  const site = await loadSite();
  const n = parseListingPage(params.page);
  if (n !== undefined) {
    const lp = n === null ? null : listingPage(site, n);
    if (!lp) notFound();
    return <ListingPageView site={site} lp={lp} />;
  }
  const h = hubContent(site);
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Grants', path: '/grants' }];
  const listed = [...h.categories, ...h.states, ...h.stateCategories];
  return (
    <SeoShell path="/grants">
      <JsonLd data={seoJsonLd({ path: '/grants', name: h.h1, description: h.description, crumbs, items: listed.map(l => ({ name: l.label, url: 'https://icangetgrants.com' + l.path })), dateModified: site.refreshedAt })} />
      <Breadcrumbs crumbs={crumbs} />
      <section className="seo-hero">
        <p className="eyebrow">Browse</p>
        <h1>{h.h1}</h1>
        {h.intro.map((s, i) => <p key={i} className={i === 0 ? 'seo-lede' : undefined}>{s}</p>)}
        <RefreshLine line={h.refreshedLine} stale={h.stale} />
      </section>
      <SaveProfileCta returnTo={saveProfileReturn(null)} label="Save your profile and get new-match alerts" place="top" />
      <LinkGrid title="By topic" links={h.categories} />
      <LinkGrid title="By state" links={h.states} />
      <LinkGrid title="State programs by topic" links={h.stateCategories} />
      <section aria-labelledby="soonest-h">
        <h2 id="soonest-h">Soonest deadlines</h2>
        <ListingList items={h.soonest} now={site.now} />
        <p className="seo-more"><a href="/">Search all {h.openCount} listings in the app</a> · <a href={listingPagePath(1)}>Browse all {h.openCount} listings page by page</a></p>
      </section>
      <p className="seo-disclaimer">Listings come from public sources and may match your situation, but eligibility, amounts and deadlines are set by each funder. Check eligibility on the funder&apos;s page before applying.</p>
    </SeoShell>
  );
}

// /grants?page=N: plain server-rendered list with prev/next links, so every open listing is reachable without JavaScript.
function ListingPageView({ site, lp }: { site: Awaited<ReturnType<typeof loadSite>>; lp: NonNullable<ReturnType<typeof listingPage>> }) {
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Grants', path: '/grants' }, { name: `Page ${lp.page}`, path: lp.path }];
  const pager = (
    <nav className="seo-pager" aria-label="Listing pages">
      {lp.prev && <a rel="prev" href={lp.prev}>← Previous page</a>}
      <span> Page {lp.page} of {lp.pages} </span>
      {lp.next && <a rel="next" href={lp.next}>Next page →</a>}
    </nav>
  );
  return (
    <SeoShell path="/grants">
      <JsonLd data={seoJsonLd({ path: lp.path, name: lp.h1, description: lp.description, crumbs, items: lp.items.map(l => ({ name: l.title, url: l.url })), dateModified: site.refreshedAt })} />
      <Breadcrumbs crumbs={crumbs} />
      <section className="seo-hero">
        <p className="eyebrow">Browse</p>
        <h1>{lp.h1}</h1>
        <p className="seo-lede">{lp.total} open listings, soonest deadline first. <a href="/grants">Browse by state and topic</a> or <a href="/">search them all in the app</a>.</p>
      </section>
      {pager}
      <ListingList items={lp.items} now={site.now} />
      {pager}
      <p className="seo-disclaimer">Listings come from public sources and may match your situation, but eligibility, amounts and deadlines are set by each funder. Check eligibility on the funder&apos;s page before applying.</p>
    </SeoShell>
  );
}
