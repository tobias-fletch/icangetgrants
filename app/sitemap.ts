import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

const PUBLIC_PAGES: Array<{
  path: string;
  changeFrequency: "weekly" | "yearly";
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: new URL(page.path, SITE_ORIGIN).href,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
