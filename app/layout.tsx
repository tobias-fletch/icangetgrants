import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, SITE_TITLE } from "@/lib/site";
import { GOOGLE_SITE_VERIFICATION, cloudflareBeaconAttributes, validSiteVerification } from "@/lib/analytics";
import "./globals.css";

const socialImage = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} — Find funding that fits you`,
};

const googleSiteVerification = validSiteVerification(GOOGLE_SITE_VERIFICATION);
const cloudflareBeacon = cloudflareBeaconAttributes();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    type: "website",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [socialImage],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
  },
  ...(googleSiteVerification ? { verification: { google: googleSiteVerification } } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {cloudflareBeacon ? <script {...cloudflareBeacon} /> : null}
      </body>
    </html>
  );
}
