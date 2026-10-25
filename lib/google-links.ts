// D1 storage for Google account links (table google_links, migration drizzle/0001_google_links.sql).
// One Google account per ChatGPT account and vice versa.
//
// Linking merges any existing 'google:<sub>' workspace into the ChatGPT workspace (rules in workspace-merge.ts)
// and deletes the Google one. The link row, the merged ChatGPT workspace and the delete are one D1 batch, which
// D1 runs as a single transaction: an error in any statement rolls back all of them. The batch is also guarded
// against concurrent edits: the link row is inserted only if both workspaces still hold exactly the data the merge
// was computed from, and the other two statements only run if that link row (with this attempt's timestamp)
// exists. A lost race changes nothing and is retried.
import type { LinkStore } from './google-auth';
import { googleUserKey } from './current-user';
import { mergeWorkspaces, MergeError } from './workspace-merge';

type RunResult = { meta?: { changes?: number } };
type Stmt = { bind(...values: unknown[]): Stmt; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<RunResult> };
export type D1Like = { prepare(sql: string): Stmt; batch?(statements: Stmt[]): Promise<RunResult[]> };

export type LinkFailure = 'unavailable' | 'conflict' | 'too_large' | 'busy';
export class LinkError extends Error {
  constructor(public reason: LinkFailure) { super(`Link failed: ${reason}`); }
}
export type LinkResult = { merged: boolean; profilesAdded: number; savedAdded: number };

const ATTEMPTS = 3;
const OUR_LINK = 'EXISTS (SELECT 1 FROM google_links WHERE google_sub = ? AND chatgpt_user_id = ? AND linked_at = ?)';

export function d1LinkStore(db: D1Like | undefined): LinkStore & { link(sub: string, chatgptUserId: string): Promise<LinkResult> } {
  async function chatgptIdForSub(sub: string) {
    if (!db) return null;
    const row = await db.prepare('SELECT chatgpt_user_id FROM google_links WHERE google_sub = ?').bind(sub).first<{ chatgpt_user_id: string }>();
    return row?.chatgpt_user_id ?? null;
  }
  async function subForChatGPT(chatgptUserId: string) {
    if (!db) return null;
    const row = await db.prepare('SELECT google_sub FROM google_links WHERE chatgpt_user_id = ?').bind(chatgptUserId).first<{ google_sub: string }>();
    return row?.google_sub ?? null;
  }
  async function workspaceData(owner: string): Promise<string | null> {
    const row = await db!.prepare('SELECT data FROM workspaces WHERE owner = ?').bind(owner).first<{ data: string }>();
    return row?.data ?? null;
  }
  return {
    chatgptIdForSub,
    subForChatGPT,
    async link(sub, chatgptUserId) {
      if (!db || typeof db.batch !== 'function') throw new LinkError('unavailable');
      const googleKey = googleUserKey(sub);
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const linkedTo = await chatgptIdForSub(sub);
        if (linkedTo === chatgptUserId) return { merged: false, profilesAdded: 0, savedAdded: 0 };
        if (linkedTo) throw new LinkError('conflict');
        if (await subForChatGPT(chatgptUserId)) throw new LinkError('conflict');

        const googleData = await workspaceData(googleKey);
        const chatgptData = googleData === null ? null : await workspaceData(chatgptUserId);
        let merge: ReturnType<typeof mergeWorkspaces> | null = null;
        if (googleData !== null) {
          let parsedGoogle: unknown, parsedChatGPT: unknown = null;
          try { parsedGoogle = JSON.parse(googleData); parsedChatGPT = chatgptData === null ? null : JSON.parse(chatgptData); } catch { throw new LinkError('unavailable'); }
          try { merge = mergeWorkspaces(parsedChatGPT, parsedGoogle); } catch (e) { if (e instanceof MergeError) throw new LinkError('too_large'); throw e; }
        }

        const linkedAt = new Date().toISOString();
        const statements: Stmt[] = [];
        if (merge) {
          statements.push(
            db.prepare(`INSERT INTO google_links (google_sub, chatgpt_user_id, linked_at) SELECT ?, ?, ? WHERE (SELECT data FROM workspaces WHERE owner = ?) IS ? AND (SELECT data FROM workspaces WHERE owner = ?) IS ? ON CONFLICT DO NOTHING`)
              .bind(sub, chatgptUserId, linkedAt, googleKey, googleData, chatgptUserId, chatgptData),
            db.prepare(`INSERT INTO workspaces (owner, data) SELECT ?, ? WHERE ${OUR_LINK} ON CONFLICT (owner) DO UPDATE SET data = excluded.data`)
              .bind(chatgptUserId, JSON.stringify(merge.merged), sub, chatgptUserId, linkedAt),
            db.prepare(`DELETE FROM workspaces WHERE owner = ? AND ${OUR_LINK}`).bind(googleKey, sub, chatgptUserId, linkedAt),
          );
        } else {
          // No Google workspace: nothing to merge, but make sure one wasn't created meanwhile.
          statements.push(
            db.prepare(`INSERT INTO google_links (google_sub, chatgpt_user_id, linked_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE owner = ?) ON CONFLICT DO NOTHING`)
              .bind(sub, chatgptUserId, linkedAt, googleKey),
          );
        }
        const results = await db.batch(statements);
        if ((results[0]?.meta?.changes ?? 0) === 1) {
          return { merged: !!merge, profilesAdded: merge?.profilesAdded ?? 0, savedAdded: merge?.savedAdded ?? 0 };
        }
        // Lost a race (a concurrent edit or link). Nothing was written; re-read and try again.
      }
      throw new LinkError('busy');
    },
    async unlink(chatgptUserId) {
      if (!db) return false;
      const res = await db.prepare('DELETE FROM google_links WHERE chatgpt_user_id = ?').bind(chatgptUserId).run();
      return (res.meta?.changes ?? 0) > 0;
    },
  };
}
