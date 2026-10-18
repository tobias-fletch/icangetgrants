import { isOwner } from '@/lib/admin';
import { getDb } from '@/db';
import { workspaces, jobs, catalog } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { discover } from '@/lib/discovery';
import { Profile } from '@/lib/grants';
// Global profile aggregation and refresh status are owner-only, including MCP callers.
export async function POST(request?:Request){if(request&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});if(!await isOwner())return Response.json({error:'Owner access required'},{status:403});const rows=await getDb().select().from(workspaces);const profiles:Profile[]=rows.flatMap(x=>JSON.parse(x.data).profiles).filter((p:Profile)=>p.alerts);return Response.json(await discover(profiles));}
export async function GET(){if(!await isOwner())return Response.json({error:'Owner access required'},{status:403});const db=getDb();const last=await db.select().from(jobs).where(eq(jobs.id,'last-refresh'));const records=await db.select({id:catalog.id}).from(catalog);return Response.json({lastRefresh:last[0]?JSON.parse(last[0].data):null,catalogSize:records.length});}
