import { SeoShell } from '@/components/seo-page';

export default function GrantsNotFound() {
  return (
    <SeoShell path="/grants">
      <section className="seo-hero">
        <p className="eyebrow">Not found</p>
        <h1>No open listings for this page right now</h1>
        <p className="seo-lede">We don&apos;t have a page for that state or topic, or it has no listings that aren&apos;t closed today.</p>
        <p><a href="/grants">Browse grants by state and category</a> or <a href="/">search all listings</a>.</p>
      </section>
    </SeoShell>
  );
}
