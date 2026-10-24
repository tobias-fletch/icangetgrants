import { env } from 'cloudflare:workers';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readSeoIndex, type D1Like } from '@/lib/seo-store';
import { computeSeoSite, findSeoPage, seoContent, hubContent, type SeoSite } from '@/lib/seo-index';
import { SITE_NAME, SITE_ORIGIN } from '@/lib/site';

// Every /grants page: at most 1 D1 query (2 if the seo-index row is missing), no outbound fetches,
// and no per-visitor data, so the HTML is identical for everyone and cacheable (see proxy.ts).
export async function loadSite(): Promise<SeoSite> {
  const read = await readSeoIndex(env.DB as unknown as D1Like);
  // Local verification only (wrangler dev --var SEO_DEBUG:1): logs the source and D1 query count, nothing personal.
  if ((env as unknown as { SEO_DEBUG?: string }).SEO_DEBUG) console.log(`[seo] ${read.source} d1Queries=${read.d1Queries} cacheHit=${read.cacheHit}`);
  return computeSeoSite(read.index, new Date());
}

export async function pageData(segments: string[]) {
  const site = await loadSite();
  const page = findSeoPage(site, segments);
  if (!page) notFound();
  return { site, page, content: seoContent(site, page) };
}

export function metadataFor(path: string, title: string, description: string, indexable: boolean): Metadata {
  const url = SITE_ORIGIN + path;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, url, siteName: SITE_NAME, type: 'website', images: [{ url: '/og.png', width: 1200, height: 630, alt: `${SITE_NAME} — Find funding that fits you` }] },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  };
}

export async function segmentMetadata(segments: string[]): Promise<Metadata> {
  const site = await loadSite();
  const page = findSeoPage(site, segments);
  if (!page) return { title: { absolute: `Page not found · ${SITE_NAME}` }, robots: { index: false, follow: true } };
  const c = seoContent(site, page);
  return metadataFor(page.path, c.title, c.description, c.indexable);
}

export async function hubMetadata(): Promise<Metadata> {
  const h = hubContent(await loadSite());
  return metadataFor('/grants', h.title, h.description, true);
}
