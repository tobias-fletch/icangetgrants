import type { Metadata } from "next";
import { Confirm, LegalShell } from "@/components/legal-page";
import { analyticsPrivacyLine, excludedLibrariesPhrase } from "@/lib/analytics";

export const metadata: Metadata = {
  title: "Privacy policy (draft) — I Can Get Grants",
  description:
    "Draft privacy policy for the I Can Get Grants public beta: guest search, Sign in with ChatGPT, workspace data stored in Cloudflare D1, and funding-source requests. Pending review. Not legal advice.",
};

export default function PrivacyPage() {
  const analyticsLine = analyticsPrivacyLine();
  return (
    <LegalShell>
      <h1>Privacy policy</h1>
      <p>
        This draft describes what the I Can Get Grants public beta actually
        does with information. It is pending review and is not legal advice.
        The product name in the interface is I Can Get Grants.
      </p>
      <p>
        The operator is Tobias Fletcher, Brooklyn, New York. No street address
        is published. Questions, access requests, and deletion requests go to{" "}
        hello@icangetgrants.com (or use the <a href="/contact">contact form</a>).
      </p>
      <p>Effective date: October 23, 2026.</p>
      <p>
        The law of the State of New York governs this policy. Disputes are
        heard in the state or federal courts located in New York.
      </p>

      <h2>Searching without an account</h2>
      <p>
        You can browse the shared funding catalog and run a match without
        creating an account. The guest form asks for applicant type, a U.S.
        state, interests, and, for students, a study level. That guest profile
        stays in the page for the current visit only. It is not written to the
        database. Reloading or leaving the page clears it. Guest searches are
        not monitored and are not included in scheduled discovery.
      </p>
      <p>
        Opening the app still requests the shared catalog from the server. That
        request does not include the text you type into a guest search.
      </p>

      <h2>Accounts and sign-in</h2>
      <p>
        Saving a workspace uses Sign in with ChatGPT. The sign-in path is{" "}
        <code>/signin-with-chatgpt</code>, the callback path is{" "}
        <code>/callback</code>, and the sign-out path is{" "}
        <code>/signout-with-chatgpt</code>. This application does not collect a
        separate password.
      </p>
      <p>
        After sign-in, each request can include these headers, which the app
        reads and does not store in its database:
      </p>
      <ul>
        <li>
          <code>oai-authenticated-user-id</code> — account identifier
        </li>
        <li>
          <code>oai-authenticated-user-email</code> — email address
        </li>
        <li>
          <code>oai-authenticated-user-full-name</code> — full name, when the
          platform marks it as percent-encoded UTF-8
        </li>
      </ul>
      <p>
        The app treats a visitor as signed in only when both an account id and
        an email are present. The name shown in the header is the full name
        when one is provided, otherwise a generic workspace label. The email
        and full name are not written into the database. The account id is the
        key for the saved workspace described below.
      </p>
      <p>
        Signing out does not delete a saved workspace.
      </p>
      <p>
        <Confirm>
          that production sign-in is completed at auth.openai.com, and what
          account data, cookies, or logs OpenAI keeps for Sign in with ChatGPT.
          This app only reads the headers listed above
        </Confirm>
      </p>
      <p>
        On a local development server, a localhost-only HttpOnly cookie named{" "}
        <code>__sites_local_auth</code> stands in for those headers. That cookie
        is not the production sign-in.
      </p>

      <h2>Workspace stored for a signed-in account</h2>
      <p>
        Signed-in profiles, saved opportunities, and application notes are
        stored in a Cloudflare D1 database, in a <code>workspaces</code> row
        keyed by the account id. The row holds one JSON document. A save must
        come from the same site origin, and the document must be under 150,000
        characters. The product allows up to 50 profiles and 500 saved items.
      </p>
      <p>Each profile can include:</p>
      <ul>
        <li>a profile id created in the browser</li>
        <li>a profile name</li>
        <li>
          applicant type: Student, Individual, Freelancer, Small business, or
          Nonprofit
        </li>
        <li>country and state or region</li>
        <li>interests and keywords</li>
        <li>a funding goal in U.S. dollars</li>
        <li>study level, when you set one</li>
        <li>background and eligibility notes</li>
        <li>whether monitoring is turned on for that profile</li>
      </ul>
      <p>
        Background notes are stored for you to read. They are not used to
        calculate a match score and they are not sent in searches to funding
        sources.
      </p>
      <p>Each saved opportunity can include:</p>
      <ul>
        <li>the profile id and the funding-record id</li>
        <li>
          an application status: Considering, Preparing, Submitted, Awarded, or
          Not selected
        </li>
        <li>notes you type in the application tracker</li>
      </ul>
      <p>
        The workspace also stores a timestamp for in-app updates you have
        marked reviewed.
      </p>
      <p>
        The interface says student names can be nicknames and that you should
        add only information you have permission to use.
      </p>

      <h2>Other records that can identify an account</h2>
      <p>
        A separate <code>jobs</code> table stores operational rows:
      </p>
      <ul>
        <li>
          <code>user-refresh-</code> plus the account id, containing only the
          time of that account’s last source refresh. This enforces a
          15-minute limit. Deleting a profile does not remove this row.
        </li>
        <li>
          <code>last-refresh</code>, a shared scan summary. The copy stored in
          the database can include profile ids and match counts for the
          monitored profiles included in that scan. The response sent to the
          public workspace view removes those profile ids, the search cursor,
          and per-source errors. It keeps the scan time, counts, source name,
          status, record counts, request counts, notes, and a coverage
          sentence.
        </li>
        <li>
          <code>state-</code> and <code>research-</code> rows about source
          checks. They describe sources and retrieval status. They do not store
          profile names, email addresses, or background notes. An owner-only
          research plan can include up to eight interest keywords gathered from
          monitored profiles in a state. That plan omits names, email
          addresses, and background notes.
        </li>
      </ul>
      <p>
        The <code>catalog</code> table stores the shared funding listings
        (titles, funders, descriptions, amounts, deadlines, links, and similar
        public listing fields). It is not your account. A few starter listings
        are also included in the application itself.
      </p>
      <p>
        The site operator can read workspace rows and job rows, because
        owner-only refresh and research tools load them in order to update the
        shared catalog. Those tools are not available to other signed-in
        accounts. A workspace response for a signed-in visitor returns that
        visitor’s own workspace, not someone else’s.
      </p>

      <h2>How workspace information is used</h2>
      <ul>
        <li>to show your profiles, shortlist, application tracker, and in-app updates</li>
        <li>
          to rank listings using applicant type, country, state, study level,
          interests, and funding goal. A score is an alignment score, not the
          chance of receiving an award
        </li>
        <li>
          when monitoring is on, to build funding searches from applicant type,
          country, state, and interests. Names, email addresses, and background
          notes are not included in those outbound searches
        </li>
        <li>
          to show new in-app matches for monitored profiles. This version does
          not send email or browser push alerts
        </li>
      </ul>
      <p>
        While you are signed in and the page is visible, the app reloads your
        workspace about once a minute and when you return to the tab. It pauses
        that reload while you are editing, saving, or refreshing.
      </p>
      <p>
        The interface describes a daily catalog update at 9 a.m. Eastern for
        profiles with monitoring turned on. The application code exposes that
        update as an owner-only refresh. Guest searches and paused profiles are
        not monitored.
      </p>
      <p>
        <Confirm>
          who operates that daily refresh, and any separate logging it creates.
          This draft does not change that task
        </Confirm>
      </p>

      <h2>Hosting and sign-in providers</h2>
      <ul>
        <li>
          The app runs on Cloudflare Workers. Workspace, catalog, and job rows
          are stored in Cloudflare D1 (the <code>DB</code> binding).
        </li>
        <li>
          The site is hosted as an OpenAI Site. Sign-in is Sign in with
          ChatGPT, using the paths listed above.
        </li>
      </ul>
      <p>
        This application does not include {excludedLibrariesPhrase()}, and it
        does not sell workspace records. It also does not
        write its own request log of IP addresses.
      </p>
      {analyticsLine ? <p>{analyticsLine}</p> : null}
      <p>
        <Confirm>
          where the D1 database is located; whether Cloudflare or OpenAI Sites
          keep request logs, IP addresses, or analytics outside this
          application; and OpenAI’s retention of Sign in with ChatGPT data
        </Confirm>
      </p>

      <h2>Funding sources</h2>
      <p>
        When a signed-in refresh or the owner-only catalog refresh runs, the
        server requests public funding pages and APIs. Those requests identify
        the app with the user-agent{" "}
        <code>
          ICanGetGrants/1.2 (funding source discovery; +https://icangetgrants.com)
        </code>. They can include
        search keywords, applicant category, country, or state derived from
        monitored profiles. They do not include your name, email, or background
        notes.
      </p>
      <p>Sources requested by the current discovery code include:</p>
      <ul>
        <li>Grants.gov (<code>api.grants.gov</code>)</li>
        <li>
          CareerOneStop scholarship listings (
          <code>cloudfront.careeronestop.org</code>)
        </li>
        <li>
          business-funding and student-aid pages configured for all 50 states,
          plus the California Grants Portal CSV on <code>data.ca.gov</code>
        </li>
        <li>the U.S. Chamber CO— small-business grant guide</li>
        <li>Poets &amp; Writers grant listings</li>
        <li>
          Federal Student Aid pages on <code>studentaid.gov</code> and named
          state student-aid pages
        </li>
        <li>WomensNet Amber Grant and Awesome Foundation program pages</li>
      </ul>
      <p>
        A curated NASE Growth Grants listing is included even when its page
        cannot be fetched automatically. Choosing “Visit source” leaves this
        site. The provider’s own terms and privacy practices then apply. This
        app does not submit an application to a funder for you.
      </p>

      <h2>Cookies and on-device storage</h2>
      <p>
        The production application code does not set a cookie and does not save
        the workspace in browser local storage. Production sign-in is carried
        by the headers listed above.
      </p>
      <p>
        <Confirm>
          which cookies, if any, auth.openai.com or OpenAI Sites set in the
          browser during sign-in
        </Confirm>
      </p>

      <h2>Export, retention, and deletion</h2>
      <p>
        During the beta there is no automatic retention period and no automatic
        deletion.
      </p>
      <ul>
        <li>
          You can delete a profile from the profile editor. The next successful
          save removes that profile and its saved opportunities from the stored
          workspace.
        </li>
        <li>
          You can remove a saved opportunity from the application tracker.
        </li>
        <li>
          You can download the workspace currently loaded in the browser as{" "}
          <code>icangetgrants-workspace.json</code> from the application tracker
          and from Preferences &amp; data.
        </li>
        <li>
          Signing out does not delete the workspace row or the refresh-time
          row.
        </li>
        <li>
          The app has no button that deletes the account, the workspace row, or
          the refresh-time row.
        </li>
      </ul>
      <p>
        You can ask for access to your workspace data, or for deletion of it,
        by emailing{" "}
        hello@icangetgrants.com (or use the <a href="/contact">contact form</a>).
        Requests are handled manually. A completed deletion removes that
        account’s workspace and the refresh and scan records tied to that
        account or to its profile ids.
      </p>

      <h2>Age and information about other people</h2>
      <p>
        I Can Get Grants is for people 13 and older. If you are under 18, use
        it with a parent or guardian’s involvement. The operator does not
        knowingly collect personal information from children under 13. The app
        does not ask for age, and it has no age gate or parental-consent step.
      </p>
      <p>
        You can create a profile for a student or another person. Study levels
        include high school. The interface says student names can be nicknames.
        Add information about someone else only when you have permission to do
        that. If you believe information about a child under 13 has been saved,
        email{" "}
        hello@icangetgrants.com (or use the <a href="/contact">contact form</a>) so
        it can be deleted.
      </p>

      <h2>Safeguards in this version</h2>
      <ul>
        <li>
          Workspace responses use <code>Cache-Control: private, no-store</code>.
        </li>
        <li>
          Saves and signed-in discovery require the account headers and a
          same-origin request.
        </li>
        <li>Each saved workspace is keyed by that account id.</li>
        <li>
          Catalog administration is limited to the site operator. A local
          development identity is accepted only when the app is running in
          development.
        </li>
        <li>
          The application does not add its own encryption layer.
        </li>
      </ul>
      <p>
        <Confirm>
          encryption in transit and at rest provided by Cloudflare and OpenAI
          Sites, and any breach-notice commitment
        </Confirm>
      </p>

      <h2>Changes to this policy</h2>
      <p>
        Updated versions of this policy are posted at this same address,{" "}
        <code>/privacy</code>, with a new effective date. The product does not
        currently record that a visitor accepted this policy.
      </p>

      <h2>Contact</h2>
      <p>
        Tobias Fletcher, Brooklyn, New York. Email{" "}
        hello@icangetgrants.com or use the{" "}
        <a href="/contact">contact form</a>.
      </p>
      <p>
        The contact form sends only the name, email address, and message you
        type, when you press Send. It goes through a small form handler on
        tobiasfletcher.com, hosted by Netlify, which emails it to the operator
        through Google (Gmail) and sends you one short confirmation with a copy
        of your message. A one-way hash of your IP address and email address
        is used to count messages per day and limit abuse. Messages are used
        only to reply.
      </p>
    </LegalShell>
  );
}
