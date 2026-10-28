# I Can Get Grants

> The MCP server still reports `serverInfo.name: "grantwell"` (see `app/mcp/route.ts`). That identifier is intentionally unchanged so the connected ChatGPT plugin keeps working.

Public beta funding search with private signed-in workspaces for individuals, students, freelancers, businesses, and nonprofits. Each signed-in account owns its profiles and application notes. Educators can manage separate student profiles.

## Implemented

- D1 persistence for account-scoped profiles, saved opportunities, application status, and notes.
- Explained applicant-category/country/state/study-level/keyword/award alignment scores, with unresolved eligibility requirements. Whole-word interest matching avoids false substring matches.
- Full Grants.gov sweep every run (posted and forecasted grants for individuals, businesses and nonprofits; forecasts are labeled "Opens soon"), with rotating detail enrichment.
- Ongoing catalog maintenance: per-source retirement, cross-source dedupe, a 30-day hide for unseen scraped listings, and a public `refresh.health` summary.
- Live CareerOneStop public scholarship listing facts, California state open-data grants, U.S. Chamber business grant leads, Poets & Writers fellowships/prizes, original private program pages, and relevant official student aid page checks.
- Per-source health, record counts, retrieval timestamps, deadline confidence, and distinct grant/fellowship/competition labels.
- Shared catalog refreshed manually or by a private scheduled task; in-app new-match inbox.
- Responsive interface, filters, sorting, and JSON workspace export.
- Private Site MCP tools `refresh_grants` and `grant_refresh_status` for unattended updates.

## Coverage and limits

Every run, independent of profiles, sweeps all posted and forecasted Grants.gov grants (funding instrument G) for three applicant groups (individuals 21|99, businesses 23|99, nonprofits 12|13|99) at up to 2,000 results each (3 fetches), the California Grants Portal CSV (open grants, no loans or government-only applicants), and Washington FundHub (active grants for businesses, individuals and nonprofits, up to 3 pages of 100). Forecasted Grants.gov opportunities carry `status: "Opens soon"` and, after their detail lookup, an `opensOn` date. Up to 8 Grants.gov detail lookups per run fill in award amounts and full text (unenriched posted grants first, then forecasts, then 14-day re-checks). Poets & Writers pages through its upcoming-deadline listing (100 per page, up to 2 pages). Deadlines, amounts and status are rewritten from each source on every run.

Retirement: a record that drops off a source is marked `Closed` (with `retiredAt` and `closedReason`; the row is kept) only when that source's fetch succeeded and its listing was complete. A failed or partial fetch never closes anything, and a listing that shrinks below half of its previously active records retires nothing. Records the source marks closed are always closed. Scraped listings (CareerOneStop, Poets & Writers, U.S. Chamber, state page scans) not seen for 30+ days are hidden but kept. Cross-source duplicates (same Grants.gov ID or opportunity number, or same normalized URL plus title) keep the Grants.gov record, then state feeds, then scraped listings; existing duplicates are hidden with `duplicateOf`. Every listing needs a title and link.

Fetch budget: one run makes at most 45 outside fetches (`RUN_FETCH_LIMIT`), with per-source caps in `lib/fetch-budget.ts` (Grants.gov sweep 3, Grants.gov detail 8, CareerOneStop 6, California 2, Washington FundHub 3, Poets & Writers 2, U.S. Chamber 1, student aid 8, program pages 2). State page scans use what remains, at least 10. Redirect hops count as fetches. There is no cron or scheduled handler in this app; refreshes run through `refresh_grants` (owner) and signed-in discovery.

`/api/workspace` returns `refresh.health`: `status` (`ok`, `partial` when a source failed, `failed` when the latest run crashed, `stale` after 26 hours without a successful run), `failedSources` (names only), and the last run's `added`, `updated`, `retired` and `deduped` counts. Every run's outcome is recorded in the `jobs` row `last-refresh-attempt`; no schema migration is needed.

Scholarship discovery uses CareerOneStop's public official CDN (the primary public hostname rejects server fetches). It combines national, profile-state, and up to three interest searches; all monitored student-state searches run each time, while up to 16 interest searches rotate with two pages of 50 listings each. Study levels and source state scope filter profiles. Listing facts are attributed to CareerOneStop / Gale. Full rules remain at the linked directory record and sponsor. No paid/token API is accessed. Month-only or recurring dates never acquire an invented current year.

All 50 states have business-funding and student-aid routes using official agencies and designated partner or university fallbacks. Monitored profiles select sources automatically by normalized state and applicant type; saving a monitored profile starts discovery. Each state/category uses at most three requests per run, with successful reports cached for 20 hours. CareerOneStop adds state scholarships, and California retains its live CSV.

Named programs become conditional leads, with unconfirmed eligibility/cycles and scores capped at 65. Directories, loans and administration documents are excluded. University and regional programs may require a specific institution or locality. Sources lists all 50 states and retrieval status, including blocked sources needing browser review.

Private MCP tools provide state research plans, primary-source evidence-backed imports, and research timestamps for fair rotation. Plans omit names, emails and background notes. New imports preserve discovery dates and distinguish new matched records for notification deduplication.

U.S. Chamber CO— supplies private-business grant leads and sponsor links; loans/investments are excluded. Poets & Writers supplies its upcoming writing listings (paged); grants, fellowships, and prizes are distinct. WomensNet and Awesome Foundation program pages are checked live. NASE remains curated if its original page blocks automation. Guide listings and recurring programs are not automatically assumed open. Citizenship, local restrictions, ownership, financial need, memberships, and detailed project eligibility require provider review. Profile background notes are not automatically verified. Scores are not award probabilities.

International and further city/county feeds need additional adapters. Email delivery is not configured. The existing daily 9 a.m. Eastern task invokes the multi-source updater without republishing.

Public beta: anyone may browse the shared catalog and perform state/type/interest matching without signing in. Guest profiles are held in React state for the current visit only; they do not join scheduled discovery. Sign in with ChatGPT creates an isolated workspace for saved profiles, opportunities and application notes. Guest saves and server-side discovery require sign-in. Signed-in source refreshes have an atomic D1 fifteen-minute cooldown per account.

Public access must use the hardened routes in this version. Global refresh/status and all MCP administrative calls require the pinned site-scoped owner ID; the local test owner exception is development-only. Public workspace responses omit global profile coverage/IDs, research plans and search cursor, and use private/no-store caching. Workspace writes require authenticated identity plus same origin. The scheduled task remains owner-authenticated. Never expose owner secrets in client storage.

## Research

- Instrumentl matching and workflow: https://help.instrumentl.com/en/articles/8218918-what-are-matches
- Broad applicant categories: https://www.grantwatch.com/
- Student matching: https://www.scholarships.com/support/frequently-asked-questions
- API documentation: https://www.grants.gov/api/common/search2 and https://www.grants.gov/api/common/fetchopportunity
- California data: https://data.ca.gov/dataset/california-grants-portal (official daily CSV)
- Private business leads: https://www.uschamber.com/co/run/business-financing/small-business-grants-and-programs
- Writing funding/awards: https://www.pw.org/grants
- Curated sources: https://www.nase.org/become-a-member/member-benefits/business-resources/growth-grants , https://www.awesomefoundation.org/en , https://ambergrantsforwomen.com/get-an-amber-grant/ , https://studentaid.gov/understand-aid/types/grants/pell
- Further student search: https://www.careeronestop.org/toolkit/training/find-scholarships.aspx

## Development

Node 22.13+, `npm run install:ci`, `npm run db:generate` after schema changes, and the Sites build helper for production. Apply generated SQL to local D1 before preview. `npm run dev` serves port 5173. Use local sign-in for preview identity; production identity comes from Sites headers.

Run `node --test tests/funding.test.mjs` for parser, geographic, study-level, closed/deadline, URL, investment exclusion, and keyword-boundary checks. Type-check with `node node_modules/typescript/bin/tsc --noEmit`.

Expanded local integration test (October 18, 2026): 763 distinct records refreshed across seven source groups, 368 scholarship rows fetched across searches, 118 active California grants, 24 business grant leads, and 100 writing awards/fellowships. Synthetic profiles returned 48 California business, 354 NY undergraduate, and 125 freelance writing potential matches. Counts include unconfirmed recurring cycles and prizes and do not indicate eligibility or award likelihood. Some federal student aid pages correctly reported link-check-only status. No synthetic profiles are placed in production.

Nationwide validation: all 100 state/category routes exercised against public sources. Regression checks cover normalized routing, deduplication, geography, conditional scores, bounded requests, directory/admin exclusion and blocked-source behavior.

In-app alert audit: inbox matching is independent of search filters and selected profile, includes only monitored profiles for the signed-in account, and lists each matching profile. Review marks only the loaded inbox watermark so later arrivals remain unread. Visible signed-in pages sync the catalog every 60 seconds and on focus, pausing while editing, saving, refreshing, or writing application notes. Guest searches and paused profiles do not receive alerts. Email and browser push remain disabled for beta.
