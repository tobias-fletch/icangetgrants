import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "I Can Get Grants — Find funding that fits you",
  description: "Search grants, scholarships and student aid for free during beta. No account required to search; sign in to save your funding workspace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
