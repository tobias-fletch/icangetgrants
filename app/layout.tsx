import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grantwell — Find funding that fits you",
  description: "A personal funding workspace for students, independent workers, and growing businesses.",
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
