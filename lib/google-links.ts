// D1 storage for Google account links (table google_links, migration drizzle/0001_google_links.sql).
// One Google account per ChatGPT account and vice versa.
import type { LinkStore } from './google-auth';

type Stmt = { bind(...values: unknown[]): Stmt; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<{ meta?: { changes?: number } }> };
export type D1Like = { prepare(sql: string): Stmt };

export function d1LinkStore(db: D1Like | undefined): LinkStore {
  return {
    async chatgptIdForSub(sub) {
      if (!db) return null;
      const row = await db.prepare('SELECT chatgpt_user_id FROM google_links WHERE google_sub = ?').bind(sub).first<{ chatgpt_user_id: string }>();
      return row?.chatgpt_user_id ?? null;
    },
    async subForChatGPT(chatgptUserId) {
      if (!db) return null;
      const row = await db.prepare('SELECT google_sub FROM google_links WHERE chatgpt_user_id = ?').bind(chatgptUserId).first<{ google_sub: string }>();
      return row?.google_sub ?? null;
    },
    async link(sub, chatgptUserId) {
      if (!db) throw new Error('Database unavailable');
      await db.prepare('INSERT INTO google_links (google_sub, chatgpt_user_id, linked_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(sub, chatgptUserId, new Date().toISOString()).run();
      const row = await db.prepare('SELECT chatgpt_user_id FROM google_links WHERE google_sub = ?').bind(sub).first<{ chatgpt_user_id: string }>();
      if (row?.chatgpt_user_id !== chatgptUserId) throw new Error('Link conflict');
    },
    async unlink(chatgptUserId) {
      if (!db) return false;
      const res = await db.prepare('DELETE FROM google_links WHERE chatgpt_user_id = ?').bind(chatgptUserId).run();
      return (res.meta?.changes ?? 0) > 0;
    },
  };
}
