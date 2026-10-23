import type { ReactNode } from "react";
import Link from "next/link";
import { Leaf } from "lucide-react";

export function LegalShell({ children, legal = true }: { children: ReactNode; legal?: boolean }) {
  return (
    <div className="legal-page">
      <header className="legal-top">
        <Link className="brand" href="/" aria-label="I Can Get Grants home">
          <span className="brandmark">
            <Leaf size={18} />
          </span>
          I Can Get Grants<span className="branddot">.</span>
        </Link>
        <nav className="legal-nav" aria-label="Policies">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/">Back to search</Link>
        </nav>
      </header>
      {legal && (
        <>
          <p className="legal-draft" role="note">
            Draft — pending review. Not legal advice.
          </p>
          <p className="legal-disclaimer">
            Funding listings on I Can Get Grants are informational. You must verify
            eligibility, deadlines, award amounts, and application rules with the
            provider.
          </p>
        </>
      )}
      <article className="legal-doc">{children}</article>
      <footer>
        <span>
          Public funding sources. Confirm eligibility and deadlines with the
          provider.
        </span>
        <nav className="footer-links" aria-label="Policies and contact">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <span>I Can Get Grants · Beta</span>
      </footer>
    </div>
  );
}

export function Confirm({ children }: { children: ReactNode }) {
  return <strong className="legal-confirm">[TOBIAS TO CONFIRM: {children}]</strong>;
}
