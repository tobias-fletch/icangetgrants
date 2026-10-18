# Grantwell

Private funding workspace for individuals, students, freelancers, businesses, and nonprofits. Each signed-in account owns its profiles and application notes. Educators can manage separate student profiles.

## Implemented

- D1 persistence for account-scoped profiles, saved opportunities, application status, and notes.
- Explained applicant-category/country/keyword/award alignment scores, with unresolved eligibility requirements.
- Official Grants.gov API discovery: original links, deadlines, applicant categories, award ceilings.
- Shared catalog refreshed manually or by a private scheduled task; in-app new-match inbox.
- Responsive interface, filters, sorting, and JSON workspace export.
- Private Site MCP tools `refresh_grants` and `grant_refresh_status` for unattended updates.

## Coverage and limits

Live discovery supports U.S. federal grants. It uses the first comma-separated interest and applicant category, retrieves up to 12 recent results per search, and caps distinct searches at 20 per run. It is not exhaustive. Citizenship, local restrictions, ownership, enrollment, memberships, and project eligibility need provider review. Notes and study level are retained for review, not automatically verified. Scores are not funding probabilities.

Four curated private/student programs were reviewed October 18, 2026. They are not a live scholarship/private feed. International and local feeds need additional adapters. Email delivery is not configured. Scheduled tasks update the catalog and can report meaningful changes through ChatGPT.

Keep this Site owner-private: `/api/refresh` and `/mcp` rely on the platform access boundary. Restrict writers to an owner/admin role before expanding access. Workspace routes require signed-in identity; mutations check origin. No credentials are placed in client storage.

## Research

- Instrumentl matching and workflow: https://help.instrumentl.com/en/articles/8218918-what-are-matches
- Broad applicant categories: https://www.grantwatch.com/
- Student matching: https://www.scholarships.com/support/frequently-asked-questions
- API documentation: https://www.grants.gov/api/common/search2 and https://www.grants.gov/api/common/fetchopportunity
- Curated sources: https://www.nase.org/become-a-member/member-benefits/business-resources/growth-grants , https://www.awesomefoundation.org/en , https://ambergrantsforwomen.com/get-an-amber-grant/ , https://studentaid.gov/understand-aid/types/grants/pell
- Further student search: https://www.careeronestop.org/toolkit/training/find-scholarships.aspx

## Development

Node 22.13+, `npm run install:ci`, `npm run db:generate` after schema changes, and the Sites build helper for production. Apply generated SQL to local D1 before preview. `npm run dev` serves port 5173. Use local sign-in for preview identity; production identity comes from Sites headers.

Validation covers TypeScript, production build, matching boundaries, browser profile creation/save/tracker, and live discovery with persisted readback. Scheduling is configured separately through the linked Sites schedule.
