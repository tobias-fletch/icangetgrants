import type { ReactNode } from 'react';
import { Leaf } from 'lucide-react';
import { SITE_NAME } from '@/lib/site';
import { listingView, jsonLdScript, type SeoListing, type Crumb } from '@/lib/seo-index';
import { HeaderAccountLink } from '@/components/seo-session';
import { UsageClicks } from '@/components/usage-clicks';

// Server-rendered, plain-HTML layout for the /grants pages. Works without JavaScript; the only client
// pieces are the sign-in aware CTA and header link (components/seo-session.tsx) and the first-party
// outbound-click counter (components/usage-clicks.tsx).

export function SeoShell({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div className="seo-page">
      <header className="legal-top seo-top">
        <a className="brand" href="/" aria-label={`${SITE_NAME} home`}>
          <span className="brandmark"><Leaf size={18} /></span>
          {SITE_NAME}<span className="branddot">.</span>
        </a>
        <nav className="legal-nav seo-nav" aria-label="Site">
          <a href="/">Search funding</a>
          <a href="/grants">Browse by state &amp; category</a>
          <HeaderAccountLink returnTo={path} />
        </nav>
      </header>
      <main className="seo-main">{children}</main>
      <UsageClicks />
      <footer>
        <span>Public funding sources. Confirm eligibility and deadlines with the provider.</span>
        <nav className="footer-links" aria-label="Policies and contact">
          <a href="/grants">Browse by state &amp; category</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/contact">Contact</a>
        </nav>
        <span>{SITE_NAME} · Beta</span>
      </footer>
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="seo-crumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={c.path}>{i === crumbs.length - 1 ? <span aria-current="page">{c.name}</span> : <a href={c.path}>{c.name}</a>}</li>
        ))}
      </ol>
    </nav>
  );
}

export function RefreshLine({ line, stale }: { line: string | null; stale: boolean }) {
  if (!line) return <p className="seo-refresh">Catalog refresh time unavailable. Listings may be out of date.</p>;
  return <p className="seo-refresh">{line}{stale ? '. Listings may be out of date.' : ''}</p>;
}

export function ListingList({ items, now }: { items: SeoListing[]; now: Date }) {
  return (
    <ul className="seo-listings">
      {items.map(l => {
        const v = listingView(l, now);
        return (
          <li key={l.id} className="seo-listing">
            <h3><a href={l.url} target="_blank" rel="nofollow noopener" data-usage="apply_click">{l.title}</a></h3>
            <p className="seo-funder">{l.funder}</p>
            <dl className="seo-facts">
              <div><dt>Award</dt><dd>{v.amount}</dd></div>
              <div><dt>{v.deadlineIsFixed ? 'Deadline' : 'Window'}</dt><dd>{v.deadline}</dd></div>
            </dl>
            <p className="seo-meta">
              <span className="seo-status">{v.status}</span>
              {v.checked && <span>{v.checked}</span>}
            </p>
            {l.attribution && <p className="attribution">{l.attribution}</p>}
          </li>
        );
      })}
    </ul>
  );
}

export function LinkGrid({ title, links }: { title: string; links: { path: string; label: string; count: number }[] }) {
  if (!links.length) return null;
  return (
    <section className="seo-related" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {links.map(l => <li key={l.path}><a href={l.path}>{l.label}</a> <span className="seo-count">{l.count}</span></li>)}
      </ul>
    </section>
  );
}
