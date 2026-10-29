# I Can Get Grants: developer guide

A plain-language map of this repo for a developer new to it, built from the repo (package.json, `.openai/hosting.json`, `drizzle/`, `proxy.ts`, `lib/`, `tests/`, README). Anything not in the repo or not verified is marked **to confirm**. Only environment variable *names* appear here, never values.

Name note: the product is **I Can Get Grants** (icangetgrants.com). Do not call it "GrantOS"; that was the retired old version.

## 1. What this is

A public grant and scholarship finder. Anyone can browse the shared catalog and match by state, type and interest without signing in. Signed-in users (Google sign-in) get saved profiles, saved opportunities, application status, notes and an in-app new-match inbox. A private owner-only MCP endpoint lets a scheduled task refresh the catalog.

## 2. Stack

| Part | What it uses |
| --- | --- |
| App | Next.js App Router running on **vinext** (Vite-based Next runtime) as a Cloudflare Worker. Package name `site-creator-vinext-starter` (from the template). |
| Hosting | ChatGPT Sites (Codex publishes numbered versions onto Cloudflare) |
| Data | Cloudflare D1 (binding `DB`), Drizzle ORM, schema in `db/`, migrations in `drizzle/` |
| Files | Optional R2 bucket (binding `BUCKET`) |
| Node | 22.13+ |

`.openai/hosting.json` declares the D1 and R2 bindings and the `mcp` capability.

## 3. Repo layout

```
app/              routes: home, /grants (listing pages), dashboard, /auth, /contact, /privacy, /terms,
                  /api/*, /mcp (owner-only MCP server), robots.ts, sitemap.ts
components/       UI components
db/               Drizzle schema
drizzle/          SQL migrations 0000–0003 + meta/
lib/              catalog, source parsers, fetch budget, matching, Google auth, sessions,
                  access control (lib/access.ts), contact, SEO helpers
proxy.ts          request proxy: www → apex redirect and /grants canonical redirects
scripts/          install and build helpers (run-framework.mjs, install-ci.mjs, sites-env.mjs, ...)
tests/            node:test files (*.test.mjs) + fixtures
vendor/, build/   vendored/built helpers used by the Sites build
.openai/hosting.json   ChatGPT Sites hosting config (bindings, capabilities)
```

## 4. Local setup

```bash
npm run install:ci        # install exactly what CI/Sites uses
npm run db:generate       # only after editing the Drizzle schema
npm run dev               # http://localhost:5173
npm run start             # local wrangler dev of the built Worker (uses --inspector-port 0)
```

Apply generated SQL to a **local** D1 before testing a schema change. Never run migrations against the hosted D1 by hand.

### Commands

| Command | What it does |
| --- | --- |
| `npm run install:ci` | Clean install via `scripts/install-ci.mjs` |
| `npm run dev` | Vite/vinext dev server on port 5173 |
| `npm run build` | Production build (`scripts/run-framework.mjs`) |
| `npm run start` | Serve the build locally with wrangler |
| `npm run lint` | ESLint |
| `npm run db:generate` | `drizzle-kit generate` (SQLite dialect) |
| `node --test tests/*.test.mjs` | All tests (there is no `npm test` script) |
| `node node_modules/typescript/bin/tsc --noEmit` | Type-check |

If you run `wrangler dev` yourself, pass an explicit `--inspector-port` (the start script uses `0`) so it doesn't collide with other local tools.

## 5. Environment variables and bindings (names only)

- **Bindings:** `DB` (D1), `BUCKET` (R2, optional)
- **Google sign-in:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`. Sign-in stays off until all three are set.
- **Build and tooling (set by the Sites/Codex tooling, not by hand):** `CONNECTORS`, `CLOUDFLARE_CF_FETCH_ENABLED`, `SITES_*`, `WRANGLER_*`
- Fetch limits are constants in code (`RUN_FETCH_LIMIT`, `lib/fetch-budget.ts`), not env vars.

## 6. Branches and deploy flow

- **Live branch: `main`.** There is no git-triggered deploy.
- Flow: feature branch → PR into `main` → merge → **Codex publishes a new numbered version** through ChatGPT Sites. Merging alone does not change the live site.
- Live version at the time of writing: **v28** (deployment `appgdep_6ae35774e6c481919490fd6a2bf23190`).
- **Rollback:** re-publish the previous version (v27) from ChatGPT Sites/Codex. Then fix forward in git with `git revert -m 1 <merge-commit>` on a branch and a PR. Never force-push.
- D1 migrations on the hosted database are applied by the Sites publish step (**to confirm** exactly how).

## 7. Data and database

- Hosted D1 (binding `DB`) holds the shared catalog, refresh runs, user profiles, saved items, notes, Google account links and daily usage counters. Migrations: `0000_huge_taskmaster`, `0001_google_links`, `0002_catalog_city_county`, `0003_usage_daily`.
- **Grants refresh:** a private scheduled task runs daily at 9 a.m. Eastern and calls the owner-only MCP tools `refresh_grants` / `grant_refresh_status`. It updates the catalog in place and does not republish the site. One run makes at most 45 outside fetches, with per-source caps in `lib/fetch-budget.ts`.
- `/api/workspace` returns `refresh.health` (`ok`, `partial`, `failed`, or `stale` after 26 hours with no successful run).

## 8. Hosting and DNS

- Hosting: ChatGPT Sites (Cloudflare Worker managed by Codex). The MCP endpoint is `/mcp` on the site's chatgpt.site host.
- Domain: icangetgrants.com. **DNS is at IONOS.** `proxy.ts` redirects www to the apex.

## 9. Email

- The site sends no email of its own ("Email delivery is not configured" in README).
- The contact form posts to the shared contact relay at `https://tobiasfletcher.com/api/contact` (a Cloudflare Worker in the `portfolio-current` repo).

## 10. Tests and CI

- Tests: `node --test tests/*.test.mjs` (README highlights `tests/funding.test.mjs`). Type-check with `tsc --noEmit`.
- **No CI:** there is no `.github/workflows` folder. Run tests locally before every PR.

## 11. Security notes and safeguards

- Global refresh/status and every MCP admin call require the pinned owner ID in `lib/access.ts`. Don't loosen that check or add a second owner without Tobias.
- The MCP `serverInfo.name` is intentionally still `"grantwell"`. Don't rename it; connected clients rely on it.
- Google sign-in secrets live only in the Sites environment, never in git.
- Guest profiles stay in browser memory for the visit only.
- Never merge, publish or deploy without Tobias's okay. Never force-push.

## 12. Known gotchas

- **Flaky test:** the Google cookie-tamper test in `tests/google-signin.test.mjs` sometimes gets 400 instead of the expected 502. Re-run before assuming a real failure.
- Merging to `main` is not publishing. Someone has to publish a new version through Codex.
- The package name and some scripts come from the Sites starter template; that's expected.
- Never call the product GrantOS.

## 13. To confirm

- How hosted D1 migrations are applied during a Codex publish.
- Whether v28 is still the live version when you read this.

## Changelog

- 2026-10-29: guide created
