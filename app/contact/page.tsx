import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-page";
import { ContactForm } from "@/components/contact-form";
import { CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Contact — I Can Get Grants",
  description:
    "Questions, a funding source we should add, or a listing that looks wrong? Send a message to I Can Get Grants.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <LegalShell legal={false}>
      <h1>Contact us</h1>
      <p>
        Questions about a listing, a funding source we should add, or something that isn’t working? Send a note and
        we’ll reply by email. We can’t confirm eligibility or deadlines for a program; please check those with the
        provider.
      </p>
      <ContactForm />
      <p className="contact-alt">
        Prefer email? Write to {CONTACT_EMAIL}.
      </p>
    </LegalShell>
  );
}
