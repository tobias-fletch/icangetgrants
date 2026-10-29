import { ownerAccess } from './access';

// First-party usage counter: per-day totals only (D1 table usage_daily, migration 0003).
// Stored per row: the America/New_York day, the event name and a count. Nothing else:
// no query text, grant ids, cookies, IP addresses, user agents, user ids or referrers.
export const USAGE_EVENTS = ['search', 'card_click', 'apply_click'] as const;
export type UsageEvent = typeof USAGE_EVENTS[number];
export const USAGE_TIME_ZONE = 'America/New_York';
export const USAGE_DEFAULT_DAYS = 30;
export const USAGE_MAX_DAYS = 366;
export const USAGE_NOTE = 'Daily totals only (America/New_York days): home searches (count only, no search text), grant-card clicks and outbound apply/source clicks. No cookies, IP addresses, user agents or user ids are stored. Bots and blocked beacons can skew counts.';

export const RECORD_USAGE_SQL = 'INSERT INTO usage_daily (day, event, count) VALUES (?, ?, 1) ON CONFLICT(day, event) DO UPDATE SET count = count + 1';
export const DAILY_USAGE_SQL = 'SELECT day, event, count FROM usage_daily WHERE day >= ? ORDER BY day DESC, event';

// The beacon body is just the event name (text/plain). Anything else is ignored.
export function usageEvent(body: unknown): UsageEvent | null {
  if (typeof body !== 'string' || body.length > 32) return null;
  const v = body.trim();
  return (USAGE_EVENTS as readonly string[]).includes(v) ? v as UsageEvent : null;
}

export function usageDay(now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: USAGE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function usageDays(value: string | null | undefined): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, USAGE_MAX_DAYS) : USAGE_DEFAULT_DAYS;
}

// First day included in a window of `days` days ending today (America/New_York).
export function usageSince(days: number, now = new Date()): string {
  const [y, m, d] = usageDay(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - (days - 1))).toISOString().slice(0, 10);
}

// Same-site check for the public POST: a cross-site Origin or Sec-Fetch-Site is not counted.
export function sameSiteUsageRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return false;
  return true;
}

export type UsageDay = { day: string } & Record<UsageEvent, number>;
export type UsageReport = { timeZone: string; since: string; through: string; days: UsageDay[]; totals: Record<UsageEvent, number>; note: string };

const zero = () => ({ search: 0, card_click: 0, apply_click: 0 }) as Record<UsageEvent, number>;

// Every day in the window, newest first, zero-filled so a missing day reads as 0.
export function usageReport(rows: Array<Record<string, unknown>>, days: number, now = new Date()): UsageReport {
  const since = usageSince(days, now), through = usageDay(now);
  const byDay = new Map<string, Record<UsageEvent, number>>();
  const totals = zero();
  for (const r of rows) {
    const day = String(r.day ?? ''), event = usageEvent(String(r.event ?? '')), n = Math.floor(Number(r.count));
    if (!event || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < since || day > through || !Number.isFinite(n) || n < 0) continue;
    const t = byDay.get(day) ?? zero(); t[event] += n; byDay.set(day, t); totals[event] += n;
  }
  const out: UsageDay[] = [];
  const [y, m, d] = through.split('-').map(Number);
  for (let i = 0; i < days; i++) { const day = new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10); out.push({ day, ...(byDay.get(day) ?? zero()) }); }
  return { timeZone: USAGE_TIME_ZONE, since, through, days: out, totals, note: USAGE_NOTE };
}

// Never throws: a missing table or a D1 error just means the event is not counted.
export async function recordUsage(event: UsageEvent | null, run: (sql: string, day: string, event: UsageEvent) => Promise<unknown>, now = new Date()): Promise<boolean> {
  if (!event) return false;
  try { await run(RECORD_USAGE_SQL, usageDay(now), event); return true; } catch { return false; }
}

// Returns null without touching the database unless the caller is the owner.
export async function ownerUsageReport(user: { userId: string; provider?: string } | null, development: boolean, days: number, all: (sql: string, since: string) => Promise<Array<Record<string, unknown>>>, now = new Date()): Promise<UsageReport | null> {
  if (!ownerAccess(user, development)) return null;
  let rows: Array<Record<string, unknown>> = [];
  try { rows = await all(DAILY_USAGE_SQL, usageSince(days, now)); } catch { rows = []; }
  return usageReport(rows, days, now);
}
