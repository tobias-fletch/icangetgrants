import { ownerAccess } from './access';

// Owner-only aggregate usage counts. Numbers only: no account ids, names, emails, profile fields or states.
// One D1 statement; malformed workspace rows count as an account with no profiles instead of failing the query.
const DATA = "CASE WHEN json_valid(w.data) THEN w.data ELSE '{}' END";
export const USAGE_SQL = `SELECT
 (SELECT COUNT(*) FROM workspaces) AS accounts,
 (SELECT COUNT(*) FROM workspaces w WHERE json_type(${DATA},'$.profiles')='array' AND json_array_length(${DATA},'$.profiles')>0) AS accountsWithProfiles,
 (SELECT COUNT(*) FROM workspaces w, json_each(${DATA},'$.profiles') p WHERE json_type(${DATA},'$.profiles')='array') AS profiles,
 (SELECT COUNT(*) FROM workspaces w, json_each(${DATA},'$.profiles') p WHERE json_type(${DATA},'$.profiles')='array' AND json_extract(p.value,'$.alerts')=1) AS profilesWithAlerts`;

export type UsageCounts = { accounts: number; accountsWithProfiles: number; profiles: number; profilesWithAlerts: number; note: string };

export const USAGE_NOTE = 'Accounts = signed-in users who have saved a workspace. New-account and new-profile counts for the last 7/30 days are not available: workspaces and profiles have no stored created-at time.';

export function usageCounts(row: Record<string, unknown> | null | undefined): UsageCounts {
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0; };
  return { accounts: n(row?.accounts), accountsWithProfiles: n(row?.accountsWithProfiles), profiles: n(row?.profiles), profilesWithAlerts: n(row?.profilesWithAlerts), note: USAGE_NOTE };
}

// Returns null without touching the database unless the caller is the catalog owner.
export async function ownerUsage(user: { userId: string } | null, development: boolean, first: (sql: string) => Promise<Record<string, unknown> | null>): Promise<UsageCounts | null> {
  if (!ownerAccess(user, development)) return null;
  return usageCounts(await first(USAGE_SQL));
}
