import { env } from 'cloudflare:workers';
import { recordUsage, sameSiteUsageRequest, usageEvent } from '@/lib/usage-events';
// Public, fire-and-forget usage counter. Always 204, whatever happens. Reads only the body (an event name);
// no cookies, headers other than the same-site check, IP addresses or user agents are read or stored.
export async function POST(request: Request) {
  try {
    if (sameSiteUsageRequest(request)) {
      const body = await request.text();
      await recordUsage(usageEvent(body), (sql, day, event) => env.DB!.prepare(sql).bind(day, event).run());
    }
  } catch { /* silent */ }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
