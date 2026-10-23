import { getDb } from '@/db';
import { workspaces, jobs, catalog } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { evidenceHostAllowed, stateSources, STATE_CATEGORIES } from './state-registry';
import { stateRecord } from './state-discovery';
import { fundingHub, administrativeTitle, leadKey } from './state-discovery';
import { safeUrl } from './source-parsers';
import { isOpenOpportunity, newOpportunityItems, profileMatches, monitoredProfiles } from './grants';
import { cityById, cityEvidenceHostAllowed } from './city-registry';
import { planResearchTasks, stateResearchKey, cityResearchKey } from './research-plan';
import type { Grant, Profile } from './grants';
// Plans state and city research for every monitored profile (not only alert-enabled ones) plus Wave 1 cities.
// Returns at most `limit` due tasks (default 5, max 20), rotated by priority and nextDueAt; see research-plan.ts.
// Task fields from earlier versions (state, code, category, source, fallback, localHosts, sourceStatus, lastResearch,
// interests, query, needsResearch) are unchanged; scope, taskId, cityId, city, nextDueAt and priority are added.
export async function stateResearchPlan(input?:any){
 const db=getDb(),rows=await db.select().from(workspaces);const profiles:Profile[]=monitoredProfiles(rows.flatMap(r=>JSON.parse(r.data).profiles||[]));const stored=await db.select().from(jobs);const reports=new Map(stored.filter(r=>r.id.startsWith('state-')).map(r=>[r.id,JSON.parse(r.data)]));const research=new Map(stored.filter(r=>r.id.startsWith('research-')).map(r=>[r.id,JSON.parse(r.data)]));
 const plan=planResearchTasks({profiles,reports,research,limit:input?.limit});
 return {...plan,scope:'Research the states of monitored profiles and the listed cities. Use official agencies, state-designated partners, allowlisted city and local government hosts from localHosts (.gov domains include subdomains; partnerHosts match exactly), and original university/program pages. Do not infer active grants from directories or loans. Submit source-backed program leads with record_state_opportunities (pass cityId for city tasks), then mark each completed task with mark_state_researched (stateCode, category, and cityId for city tasks). Normal browser access or search indexes may help when a source blocks server requests; do not bypass access controls.'};
}
// Evidence that says applications are over marks the lead closed even when no exact deadline was supplied.
export const CLOSED_EVIDENCE=/\b(?:applications?\s+(?:are\s+|is\s+)?(?:now\s+)?closed|(?:no\s+longer|not\s+currently)\s+accepting|deadline\s+(?:has\s+)?passed|(?:program|cycle|application\s+period)\s+(?:has\s+)?(?:ended|closed))\b/i;
export async function recordStateOpportunities(input:any){
 if(!input||!Array.isArray(input.opportunities)||input.opportunities.length>100)throw new Error('Provide at most 100 source-backed opportunities.');
 const now=new Date().toISOString(),db=getDb(),staged=new Map<string,Grant>(),newIds=new Set<string>();
 // Existing leads are indexed by normalized URL, so a reworded title updates the same record instead of adding a duplicate.
 const known=new Map<string,Grant>();for(const row of await db.select().from(catalog)){const g=JSON.parse(row.data) as Grant;const key=leadKey(g);if(key&&!known.has(key))known.set(key,g);}const byKey=new Map<string,string>();let updatedExisting=0;
 for(const r of input.opportunities){const state=stateSources.find(s=>s.code===r.stateCode);if(!state||!STATE_CATEGORIES.includes(r.category))throw new Error('Invalid state or category.');const city=r.cityId==null?undefined:cityById(r.cityId);if(r.cityId!=null&&(!city||city.stateCode!==state.code||city.status!=='verified'||r.category==='aid'))throw new Error('Invalid city for this state or category.');if(typeof r.title!=='string'||r.title.length<5||r.title.length>180||fundingHub(r.title)||administrativeTitle(r.title)||/\b(?:loans?|tax credits?|investments?|directory|grant writing)\b/i.test(r.title))throw new Error('Only distinct grant/scholarship/aid programs are accepted.');
  const url=safeUrl(r.url||'','https://invalid.local'),sourceUrl=safeUrl(r.sourceUrl||'','https://invalid.local');if(!url||!sourceUrl||new URL(url).hostname==='invalid.local'||new URL(sourceUrl).hostname==='invalid.local')throw new Error('Absolute public source and program URLs are required.');
  if(!(city?cityEvidenceHostAllowed(city,state,sourceUrl):evidenceHostAllowed(state,sourceUrl)))throw new Error(city?'Evidence for a city lead must come from that city\'s allowlisted .gov domain, an exact designated partner host, or an accepted state source.':'Evidence must come from the configured state source, an allowlisted city or local government host, or an identifiable official state government page.');
  if(typeof r.evidence!=='string'||r.evidence.length<30||r.evidence.length>1200)throw new Error('A concise source-backed evidence summary is required.');const g=stateRecord(state,r.category,{url,title:r.title,context:r.evidence},sourceUrl,now,city);g.live=false;g.sourceMode='Primary-source research';g.status='Researched lead · verify cycle';g.requirements.unshift('Research evidence: '+r.evidence);
  if(r.amount!=null){if(typeof r.amount!=='number'||!Number.isFinite(r.amount)||r.amount<=0||r.amount>1e10)throw new Error('Invalid award amount.');g.amount=r.amount;}
  if(r.deadline!=null){if(typeof r.deadline!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(r.deadline)||isNaN(Date.parse(r.deadline))||new Date(r.deadline).toISOString().slice(0,10)!==r.deadline)throw new Error('Provide an exact source-published date, including year.');g.deadline=r.deadline;g.deadlineLabel=r.deadline;if(r.deadline<now.slice(0,10))g.status='Closed';}
  if(CLOSED_EVIDENCE.test(r.title+' '+r.evidence))g.status='Closed';
  const key=leadKey(g),twinId=key?byKey.get(key):undefined,twin=twinId?staged.get(twinId):key?known.get(key):undefined;
  if(twin){if(twinId)staged.delete(twinId);g.id=twin.id;g.discovered=twin.discovered;}else{const previous=await db.select().from(catalog).where(eq(catalog.id,g.id));if(previous[0])g.discovered=JSON.parse(previous[0].data).discovered;else newIds.add(g.id);}
  if(!newIds.has(g.id)&&!twinId)updatedExisting++;staged.set(g.id,g);if(key)byKey.set(key,g.id);
 }
 for(const g of staged.values()){await db.insert(catalog).values({id:g.id,data:JSON.stringify(g)}).onConflictDoUpdate({target:catalog.id,set:{data:JSON.stringify(g)}});}
 const owners=await db.select().from(workspaces);const profiles:Profile[]=owners.flatMap(r=>JSON.parse(r.data).profiles).filter((p:Profile)=>p.alerts);const ids=[...staged.keys()];const verified=[];for(const id of ids){const row=await db.select().from(catalog).where(eq(catalog.id,id));if(row[0])verified.push(id);}
 // Closed or past-deadline records are stored for completeness but never counted or listed as new.
 const created=[...staged.values()].filter(g=>newIds.has(g.id)),newRecords=created.filter(g=>isOpenOpportunity(g,now));const matches=new Map(newRecords.map(g=>[g.id,profileMatches(g,profiles)]));const matchedNew=newRecords.filter(g=>matches.get(g.id)!.length);
 return {persistedIds:verified,newOpportunities:newRecords.length,newMatchedOpportunities:matchedNew.length,...newOpportunityItems(newRecords,matches),updatedExisting,closedNotReported:created.length-newRecords.length,checkedAt:now};
}
export async function markStateResearched(input:any){const state=stateSources.find(s=>s.code===input?.stateCode);if(!state||!STATE_CATEGORIES.includes(input?.category)||typeof input?.summary!=='string'||input.summary.length>1200)throw new Error('Provide stateCode, category and a brief research summary.');const city=input?.cityId==null?undefined:cityById(input.cityId);if(input?.cityId!=null&&(!city||city.stateCode!==state.code||input.category==='aid'))throw new Error('Invalid city for this state or category.');const record:any={checkedAt:new Date().toISOString(),summary:input.summary};if(city)record.cityId=city.id;const id=city?cityResearchKey(city.id,input.category):stateResearchKey(state.code,input.category);await getDb().insert(jobs).values({id,data:JSON.stringify(record)}).onConflictDoUpdate({target:jobs.id,set:{data:JSON.stringify(record)}});return record;}
