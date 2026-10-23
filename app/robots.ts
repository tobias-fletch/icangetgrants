import type { MetadataRoute } from "next";
import { SITE_HOSTNAME, SITE_ORIGIN } from "@/lib/site";

const PRIVATE_PATHS = [
  "/api/",
  "/mcp",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_PATHS,
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_HOSTNAME,
  };
}
