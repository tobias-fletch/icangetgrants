import Link from 'next/link';
import { SeoShell, JsonLd, Breadcrumbs, RefreshLine, ListingList, LinkGrid } from '@/components/seo-page';
import { SaveProfileCta } from '@/components/seo-session';
import { seoJsonLd, type SeoContent, type SeoPage, type SeoSite } from '@/lib/seo-index';

export function SeoLanding({ site, page, content: c }: { site: SeoSite; page: SeoPage; content: SeoContent }) {
  const items = c.listings;
  return (
    <SeoShell path={page.path}>
      <JsonLd data={seoJsonLd({ path: page.path, name: c.h1, description: c.description, crumbs: c.crumbs, items: items.map(l => ({ name: l.title, url: l.url })), dateModified: site.refreshedAt })} />
      <Breadcrumbs crumbs={c.crumbs} />
      <section className="seo-hero">
        <p className="eyebrow">{page.type === 'category' ? 'Funding by topic' : page.type === 'state' ? 'Funding by state' : `${page.stateName} · by topic`}</p>
        <h1>{c.h1}</h1>
        {c.intro.map((s, i) => <p key={i} className={i === 0 ? 'seo-lede' : undefined}>{s}</p>)}
        <RefreshLine line={c.refreshedLine} stale={c.stale} />
        {c.thinNote && <p className="seo-thin" role="note">{c.thinNote}</p>}
      </section>
      <SaveProfileCta returnTo={c.ctaReturn} label={c.ctaLabel} place="top" />
      <section aria-labelledby="listings-h">
        <h2 id="listings-h">{page.type === 'category' ? `${c.total} listings that aren't closed` : `${c.total} ${page.stateName}-specific listings`}</h2>
        <ListingList items={items} now={site.now} />
        {c.total > items.length && <p className="seo-more"><Link href="/">See all {c.total} in the search app</Link></p>}
      </section>
      {c.nationwide && c.nationwide.sample.length > 0 && (
        <section className="seo-nationwide" aria-labelledby="nationwide-h">
          <h2 id="nationwide-h">Also open nationwide</h2>
          <p>
            Another {c.nationwide.count} nationwide listings are also open to {page.stateName} residents. Here are the {c.nationwide.sample.length} with the soonest deadlines
            {c.nationwide.link ? <>; see <Link href={c.nationwide.link}>all of them</Link>.</> : <>; browse the <Link href="/grants">topic pages</Link> for the rest.</>}
          </p>
          <ListingList items={c.nationwide.sample} now={site.now} />
        </section>
      )}
      <SaveProfileCta returnTo={c.ctaReturn} label={c.ctaLabel} place="bottom" />
      <LinkGrid title={`${page.stateName} pages by topic`} links={c.stateCategories} />
      <LinkGrid title="Related pages" links={c.related} />
      <p className="seo-disclaimer">Listings come from public sources and may match your situation, but eligibility, amounts and deadlines are set by each funder. Check eligibility on the funder&apos;s page before applying.</p>
    </SeoShell>
  );
}
