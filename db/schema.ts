// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', { owner: text('owner').primaryKey(), data: text('data').notNull() });
export const catalog = sqliteTable('catalog', { id: text('id').primaryKey(), data: text('data').notNull() });
export const jobs = sqliteTable('jobs', { id: text('id').primaryKey(), data: text('data').notNull() });
// Google sign-in links: a Google account (sub) linked to an existing ChatGPT user id, so both load one workspace.
export const googleLinks = sqliteTable('google_links', { googleSub: text('google_sub').primaryKey(), chatgptUserId: text('chatgpt_user_id').notNull().unique(), linkedAt: text('linked_at').notNull() });
