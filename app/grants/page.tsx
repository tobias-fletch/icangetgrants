import { SeoShell, JsonLd, Breadcrumbs, RefreshLine, ListingList, LinkGrid } from '@/components/seo-page';
import { SaveProfileCta } from '@/components/seo-session';
import { hubContent, seoJsonLd, saveProfileReturn } from '@/lib/seo-index';
import { loadSite, hubMetadata } from './seo-data';

export const dynamic = 'force-dynamic';
export const generateMetadata = hubMetadata;

export default async function GrantsHub() {
  const site = await loadSite();
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
        <p className="seo-more"><a href="/">Search all {h.openCount} listings in the app</a></p>
      </section>
      <p className="seo-disclaimer">Listings come from public sources and may match your situation, but eligibility, amounts and deadlines are set by each funder. Check eligibility on the funder&apos;s page before applying.</p>
    </SeoShell>
  );
}
