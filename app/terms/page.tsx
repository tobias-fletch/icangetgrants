import type { Metadata } from "next";
import { Confirm, LegalShell } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of use (draft) — I Can Get Grants",
  description:
    "Draft terms for the I Can Get Grants public beta. Listings are informational; verify eligibility and deadlines with the provider. Pending review. Not legal advice.",
};

export default function TermsPage() {
  return (
    <LegalShell>
      <h1>Terms of use</h1>
      <p>
        These draft terms describe the I Can Get Grants public beta. They are
        pending review and are not legal advice. They are not a substitute for
        a provider’s own application rules.
      </p>
      <p>
        <Confirm>
          the legal name of the operator, the contact email, the governing law,
          the courts that would hear a dispute, and the effective date
        </Confirm>
      </p>
      <p>
        <Confirm>
          whether using the beta will count as acceptance of a future published
          version of these terms. The product does not currently record
          acceptance
        </Confirm>
      </p>

      <h2>The service</h2>
      <p>
        I Can Get Grants lets you search a shared catalog of grants,
        scholarships, and student aid. If you sign in, you can save funding
        profiles, opportunities, application statuses, and notes.
      </p>
      <p>
        You can search without an account. A guest match lasts for the current
        visit only and is not saved on the server.
      </p>
      <p>
        Sign-in is Sign in with ChatGPT, through <code>/signin-with-chatgpt</code>.
        The app does not create a separate password. What that sign-in shares
        with this app is described in the <a href="/privacy">privacy policy</a>.
      </p>
      <p>
        This version has no checkout and does not charge a fee inside the app.
      </p>
      <p>
        <Confirm>whether the operator will charge a fee later</Confirm>
      </p>

      <h2>Listings are informational</h2>
      <p>
        Titles, descriptions, award amounts, deadlines, eligibility notes, and
        fit scores are a starting point for your own review. A fit score
        reflects how a listing lines up with applicant type, location, study
        level, interests, and funding goal. It is not the probability of an
        award and it is not a promise that you will receive funding.
      </p>
      <p>
        You must verify eligibility, deadlines, award amounts, and application
        rules with the provider before you rely on a listing or apply. Some
        dates are recurring or have no confirmed year. Some official pages are
        recorded only as link checks. The default search hides listings the
        catalog marks closed or past their stored deadline, but the catalog is
        not a complete or current copy of every funding program.
      </p>
      <p>
        The service does not submit applications, pay application fees, or
        decide whether a funder will select you. Background notes you store are
        for your reference. They are not an eligibility determination.
      </p>

      <h2>Your profiles and notes</h2>
      <p>
        You are responsible for the profile names, interests, notes, and other
        text you save, including information about a student or anyone else.
        The profile form says student names can be nicknames and that you
        should add only information you have permission to use. The form does
        not ask for age and does not include a parental-consent step.
      </p>
      <p>
        You can delete a profile, remove a saved opportunity, and download the
        workspace loaded in the browser as <code>grantwell-workspace.json</code>.
        Signing out does not erase a saved workspace. There is no in-product
        control that deletes the account itself. The privacy policy describes
        what remains stored.
      </p>
      <p>
        <Confirm>
          the minimum age to create an account, and the process for requesting
          deletion of a workspace
        </Confirm>
      </p>

      <h2>Accounts</h2>
      <p>
        Your saved workspace is tied to the account id supplied by Sign in with
        ChatGPT. Do not attempt to use another person’s account or to read
        another person’s workspace. Catalog administration and the global
        refresh are limited to the site operator.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Use the service to look for funding and to organize a search. Do not
        disrupt the service, bypass sign-in, or send traffic that overloads
        this app or the funding sources it queries. A signed-in source refresh
        is limited to once every 15 minutes for that account.
      </p>
      <p>
        <Confirm>any additional acceptable-use rules</Confirm>
      </p>

      <h2>Other sites</h2>
      <p>
        Source links leave I Can Get Grants. Current discovery uses public
        information from Grants.gov, CareerOneStop, state agency and partner
        pages, the California Grants Portal, Federal Student Aid, the U.S.
        Chamber, Poets &amp; Writers, WomensNet, the Awesome Foundation, and a
        curated NASE listing. Their terms apply on their sites. A listing is
        not an endorsement and not a statement that you qualify.
      </p>

      <h2>Beta availability and alerts</h2>
      <p>
        This is a beta. Sources can be unavailable, pages can require a
        browser, and coverage is not every grant that exists. In-app updates
        appear while you are signed in. Email and push alerts are not enabled.
        Guest searches and paused profiles are not monitored.
      </p>
      <p>
        The interface describes a shared catalog update daily at 9 a.m.
        Eastern for profiles with monitoring turned on. In this codebase that
        update is an owner-only refresh.
      </p>
      <p>
        <Confirm>
          that this is the schedule you operate, and any uptime or support
          commitment. None is stated in the application code
        </Confirm>
      </p>

      <h2>Intellectual property</h2>
      <p>
        Funding text comes from public sources and can be incomplete or
        outdated. Third-party names and listings belong to their owners. The
        interface and application code are the operator’s, aside from
        third-party components and those source materials.
      </p>
      <p>
        <Confirm>
          the license for notes you save, and any trademark notice to display
        </Confirm>
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        Until counsel reviews this draft, treat the beta as an informational
        tool provided as available, without a promise that a listing is
        complete, current, or suitable for a particular application.
      </p>
      <p>
        <Confirm>
          the warranty disclaimer and liability limit to publish, including any
          damages cap, arbitration clause, or class-action waiver. None of
          those are implemented in the product
        </Confirm>
      </p>

      <h2>Changes</h2>
      <p>
        <Confirm>how later terms will be posted</Confirm>
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms:{" "}
        <Confirm>the contact email and mailing address</Confirm>
      </p>
    </LegalShell>
  );
}
