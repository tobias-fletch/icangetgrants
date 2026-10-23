import { isOwner } from '@/lib/admin';
import { getDb } from '@/db';
import { workspaces, jobs, catalog } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { discover } from '@/lib/discovery';
import { Profile } from '@/lib/grants';
import { refreshFreshness } from '@/lib/listing';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ownerUsage } from '@/lib/usage';
// discover() selects monitored profiles itself; alerts only control notifications.
// Global profile aggregation, refresh status and usage counts are owner-only, including MCP callers (grant_refresh_status).
export async function POST(request?:Request){if(request&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});if(!await isOwner())return Response.json({error:'Owner access required'},{status:403});const rows=await getDb().select().from(workspaces);const profiles:Profile[]=rows.flatMap(x=>JSON.parse(x.data).profiles||[]);return Response.json(await discover(profiles));}
export async function GET(){if(!await isOwner())return Response.json({error:'Owner access required'},{status:403});const db=getDb();const last=await db.select().from(jobs).where(eq(jobs.id,'last-refresh'));const records=await db.select({id:catalog.id}).from(catalog);const lastRefresh=last[0]?JSON.parse(last[0].data):null;const usage=await ownerUsage(await getChatGPTUser(),import.meta.env.DEV,sql=>env.DB!.prepare(sql).first());return Response.json({lastRefresh,catalogSize:records.length,...refreshFreshness(lastRefresh?.checkedAt),usage});}
