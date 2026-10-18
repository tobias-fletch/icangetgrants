import { getDb } from '@/db';
import { workspaces, jobs, catalog } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { discover } from '@/lib/discovery';
import { Profile } from '@/lib/grants';
// This shared updater relies on Sites' owner-private access boundary.
export async function POST(){const rows=await getDb().select().from(workspaces);const profiles:Profile[]=rows.flatMap(x=>JSON.parse(x.data).profiles).filter((p:Profile)=>p.alerts);return Response.json(await discover(profiles));}
export async function GET(){const db=getDb();const last=await db.select().from(jobs).where(eq(jobs.id,'last-refresh'));const records=await db.select({id:catalog.id}).from(catalog);return Response.json({lastRefresh:last[0]?JSON.parse(last[0].data):null,catalogSize:records.length});}
