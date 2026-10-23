import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";
import { loadSite } from "@/app/grants/seo-data";
import { seoSitemapPaths } from "@/lib/seo-index";

// Dynamic so the /grants pages follow the catalog. One D1 query (the stored seo-index row).
// Only indexable /grants pages are listed; noindexed (thin, duplicate, under review) pages never are.
export const dynamic = "force-dynamic";

const PUBLIC_PAGES: Array<{
  path: string;
  changeFrequency: "weekly" | "yearly";
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_PAGES.map((page) => ({
    url: new URL(page.path, SITE_ORIGIN).href,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
  try {
    const site = await loadSite();
    for (const path of seoSitemapPaths(site)) {
      pages.push({ url: new URL(path, SITE_ORIGIN).href, lastModified: site.builtAt, changeFrequency: "daily", priority: path === "/grants" ? 0.8 : 0.6 });
    }
  } catch {
    // Catalog unavailable: keep the static pages so the sitemap still answers.
  }
  return pages;
}
