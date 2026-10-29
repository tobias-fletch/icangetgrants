// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, index, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { owner: text('owner').primaryKey(), data: text('data').notNull() });
// city/county (migration 0002) are nullable mirrors of the same fields inside `data`, which stays the source of truth.
// Reads select { id, data } explicitly so the app keeps working before 0002 is applied; see lib/catalog-geo.ts.
export const catalog = sqliteTable('catalog', { id: text('id').primaryKey(), data: text('data').notNull(), city: text('city'), county: text('county') }, t => [index('catalog_city_idx').on(t.city), index('catalog_county_idx').on(t.county)]);
export const jobs = sqliteTable('jobs', { id: text('id').primaryKey(), data: text('data').notNull() });
// Google sign-in links: a Google account (sub) linked to an existing ChatGPT user id, so both load one workspace.
export const googleLinks = sqliteTable('google_links', { googleSub: text('google_sub').primaryKey(), chatgptUserId: text('chatgpt_user_id').notNull().unique(), linkedAt: text('linked_at').notNull() });
// First-party usage counter (lib/usage-events.ts): per-day totals only. No query text, ids, cookies, IPs or user agents.
export const usageDaily = sqliteTable('usage_daily', { day: text('day').notNull(), event: text('event').notNull(), count: integer('count').notNull().default(0) }, t => [primaryKey({ columns: [t.day, t.event] })]);
