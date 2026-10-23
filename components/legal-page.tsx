import type { ReactNode } from "react";
import { Leaf } from "lucide-react";

export function LegalShell({ children }: { children: ReactNode }) {
  return (
    <div className="legal-page">
      <header className="legal-top">
        <a className="brand" href="/" aria-label="I Can Get Grants home">
          <span className="brandmark">
            <Leaf size={18} />
          </span>
          I Can Get Grants<span className="branddot">.</span>
        </a>
        <nav className="legal-nav" aria-label="Policies">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/">Back to search</a>
        </nav>
      </header>
      <p className="legal-draft" role="note">
        Draft — pending review. Not legal advice.
      </p>
      <p className="legal-disclaimer">
        Funding listings on I Can Get Grants are informational. You must verify
        eligibility, deadlines, award amounts, and application rules with the
        provider.
      </p>
      <article className="legal-doc">{children}</article>
      <footer>
        <span>
          Public funding sources. Confirm eligibility and deadlines with the
          provider.
        </span>
        <nav className="footer-links" aria-label="Policies">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <span>I Can Get Grants · Beta</span>
      </footer>
    </div>
  );
}

export function Confirm({ children }: { children: ReactNode }) {
  return <strong className="legal-confirm">[TOBIAS TO CONFIRM: {children}]</strong>;
}
