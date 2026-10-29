import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ownerUsageReport, usageDays } from '@/lib/usage-events';
// Owner-only JSON of the daily usage totals (same owner check as /api/refresh). ?days=1..366, default 30.
export async function GET(request: Request) {
  const days = usageDays(new URL(request.url).searchParams.get('days'));
  const report = await ownerUsageReport(await getChatGPTUser(), import.meta.env.DEV, days, async (sql, since) => (await env.DB!.prepare(sql).bind(since).all()).results as Array<Record<string, unknown>>);
  if (!report) return Response.json({ error: 'Owner access required' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  return Response.json(report, { headers: { 'cache-control': 'no-store' } });
}
