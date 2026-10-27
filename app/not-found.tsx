import type { Metadata } from "next";

// Root 404: same message as the framework default, plus its own title.
// The framework already adds <meta name="robots" content="noindex"> to 404 responses.
export const metadata: Metadata = {
  title: "Page not found — I Can Get Grants",
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        textAlign: "center",
        padding: "2rem 1rem",
      }}
    >
      <h1 style={{ margin: 0, fontSize: "2rem" }}>404</h1>
      <p style={{ margin: 0 }}>This page could not be found.</p>
    </main>
  );
}
