import { getDb } from '@/db';
import { catalog, jobs, workspaces } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { Grant, Profile, Workspace, seeds } from './grants';
const clean=(s:unknown)=>String(s??'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
export async function allGrants():Promise<Grant[]> {return [...seeds,...(await getDb().select().from(catalog)).map(x=>JSON.parse(x.data))];}
export async function getWorkspace(owner:string):Promise<Workspace>{const rows=await getDb().select().from(workspaces).where(eq(workspaces.owner,owner));return rows[0]?JSON.parse(rows[0].data):{profiles:[],saved:[],seen:''};}
export async function saveWorkspace(owner:string,data:Workspace){await getDb().insert(workspaces).values({owner,data:JSON.stringify(data)}).onConflictDoUpdate({target:workspaces.owner,set:{data:JSON.stringify(data)}});}
const codes:Record<string,string>={'Student':'21','Individual':'21','Freelancer':'21|23','Small business':'23','Nonprofit':'12|13'};
async function api(path:string,body:unknown){const r=await fetch('https://api.grants.gov/v1/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Grants.gov returned '+r.status);const j=await r.json() as any;if(j.errorcode!==0 || !j.data)throw new Error('Grants.gov did not return valid results');return j.data;}
export async function discover(profiles:Profile[]){
 const db=getDb(), now=new Date().toISOString();let count=0, added=0;const errors:string[]=[];const existing=new Map((await db.select().from(catalog)).map(x=>[x.id,JSON.parse(x.data) as Grant]));
 const queries=new Map<string,{keyword:string;eligibilities:string}>();
 for(const p of profiles.filter(x=>x.alerts)){
  if(p.country!=='United States')continue;
  const keyword=p.keywords.split(',').map(x=>x.trim()).filter(Boolean)[0]||'';
  const q={keyword:keyword.slice(0,100),eligibilities:codes[p.type]||'21'};queries.set(JSON.stringify(q),q);
 }
 for(const q of Array.from(queries.values()).slice(0,20)){
  try{
   const results=await api('search2',{...q,rows:12,oppStatuses:'posted',fundingInstruments:'G',sortBy:'openDate|desc'});
   const hits=results.oppHits||[];
   for(let start=0;start<hits.length;start+=4){
    await Promise.all(hits.slice(start,start+4).map(async(h:any)=>{
     try{
      const d=await api('fetchOpportunity',{opportunityId:Number(h.id)});const s=d.synopsis;if(!s)return;
      const applicantCodes=(s.applicantTypes||[]).map((a:any)=>String(a.id));
      const types=Object.keys(codes).filter(t=>codes[t].split('|').some(c=>applicantCodes.includes(c))||applicantCodes.includes('99'));
      if(!types.length)return;
      const raw=h.closeDate;const date=raw?new Date(raw):null;const deadline=date&&!isNaN(date.getTime())?date.toISOString().slice(0,10):null;
      if(deadline && deadline<now.slice(0,10))return;
      const id='gov-'+h.id;
      const g:Grant={id,title:clean(h.title),funder:clean(s.agencyName||h.agency||h.agencyName),description:clean(s.synopsisDesc).slice(0,1600),types,countries:['United States'],tags:(s.fundingActivityCategories||[]).map((x:any)=>clean(x.description)),amount:Number(s.awardCeiling)||null,deadline,url:'https://www.grants.gov/search-results-detail/'+h.id,source:'Grants.gov',requirements:[clean(s.applicantEligibilityDesc||'Read the full notice for additional applicant restrictions.'),...(s.costSharing?['Cost sharing or matching funds are required.']:[])],checked:now,discovered:existing.get(id)?.discovered||now,kind:'Federal grant',live:true,applicantCodes};
      await db.insert(catalog).values({id,data:JSON.stringify(g)}).onConflictDoUpdate({target:catalog.id,set:{data:JSON.stringify(g)}});count++;if(!existing.has(id)){added++;existing.set(id,g);}
     }catch{errors.push('Could not retrieve details for '+h.id);}
    }));
   }
  }catch(e){errors.push(e instanceof Error?e.message:'Source unavailable');}
 }
 const result={checkedAt:now,checked:count,newGrants:added,queries:queries.size,errors,coverage:'Live federal discovery: United States. Other countries and private/student sources require additional feeds or source review.'};
 await db.insert(jobs).values({id:'last-refresh',data:JSON.stringify(result)}).onConflictDoUpdate({target:jobs.id,set:{data:JSON.stringify(result)}});
 return result;
}
