import { env } from 'cloudflare:workers';
import { mirrorCatalogGeo, grantCity, grantCounty } from './catalog-geo';
import { getDb } from '@/db';
import { catalog, jobs, workspaces } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { match, newOpportunityItems, seeds, isOpenOpportunity, profileMatches, monitoredProfiles, missingInboxFields, inboxFieldsError } from './grants';
import type { Grant, Profile, Workspace } from './grants';
import { clean, countryName, stateName, interests, explicitDate, parseCalifornia, parseScholarships, parsePrivateAwards, parseBusinessGrants } from './source-parsers';
import { relevantPrograms, checkOfficialPrograms, PROGRAM_CHECKS_JOB } from './programs';
import { statePlan } from './state-registry';
import { scanState, leadKey } from './state-discovery';
import { sweepGrantsGov, grantsGovRecord, detailQueue, applyGrantsGovDetail, fetchWaFundHub, fetchPoetsWriters, retireMissing, crossSourceDedupe, disambiguateTitles, isClosedListing, hasTitleAndLink, visibleListings, contentChanged, refreshHealth, type RefreshAttempt } from './catalog-sweep';
import { FetchBudget, budgetedFetch, isBudgetError, orderScanRoutes, RUN_FETCH_LIMIT, SOURCE_FETCH_CAPS, PAGE_SCAN_MIN_FETCHES } from './fetch-budget';
import type { StateReport } from './state-discovery';
import { writeSeoIndex, type D1Like } from './seo-store';
import { publicRefresh } from './access';
export async function allGrants():Promise<Grant[]> {const records=(await getDb().select({id:catalog.id,data:catalog.data}).from(catalog)).map(x=>JSON.parse(x.data) as Grant);const ids=new Set(records.map(x=>x.id));return [...seeds.filter(g=>!ids.has(g.id)),...records];}
export async function getWorkspace(owner:string):Promise<Workspace>{const rows=await getDb().select().from(workspaces).where(eq(workspaces.owner,owner));return rows[0]?JSON.parse(rows[0].data):{profiles:[],saved:[],seen:''};}
export async function saveWorkspace(owner:string,data:Workspace){await getDb().insert(workspaces).values({owner,data:JSON.stringify(data)}).onConflictDoUpdate({target:workspaces.owner,set:{data:JSON.stringify(data)}});}
const codes:Record<string,string>={'Student':'21|99','Individual':'21|99','Freelancer':'21|23|99','Small business':'23|99','Nonprofit':'12|13|99'};
// Every outside request goes through a FetchBudget (see fetch-budget.ts); redirect hops are charged individually.
async function text(url:string,budget:FetchBudget){const {response:r,url:finalUrl}=await budgetedFetch(budget,url,{headers:{Accept:'text/html,application/json,text/csv;q=0.9','User-Agent':'ICanGetGrants/1.2 (funding source discovery; +https://icangetgrants.com)'},signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('HTTP '+r.status);const body=await r.text();if(/just a moment|verify you are human|access denied|bot manager|human verification|captcha/i.test(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||body.slice(0,500)))throw new Error('Source requires browser access');if(/\/(?:20[01]\d|202[0-4])\//.test(new URL(finalUrl).pathname))throw new Error('Source redirected to an old archive; browser review required');return body;}
async function api(path:string,body:unknown,budget:FetchBudget){const {response:r}=await budgetedFetch(budget,'https://api.grants.gov/v1/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('Grants.gov HTTP '+r.status);const j=await r.json() as any;if(j.errorcode!==0||!j.data)throw new Error('Invalid Grants.gov response');return j.data;}
async function pool<T>(items:T[],limit:number,fn:(item:T)=>Promise<void>){for(let i=0;i<items.length;i+=limit)await Promise.all(items.slice(i,i+limit).map(fn));}
export type SourceReport={name:string;status:string;records:number;queries:number;error?:string;note?:string;deferred?:number;retired?:number;warnings?:string[]};
// Coverage runs for every monitored profile (all U.S. profiles, plus alert-enabled ones elsewhere); the alerts flag
// only decides who is notified (newItems matches via profileMatches and upcoming_deadlines).
// Every run's outcome is recorded in jobs 'last-refresh-attempt', so a run that crashes before saving its results
// still shows as failed in the public refresh.health (see refreshHealth in catalog-sweep.ts).
async function saveAttempt(attempt:RefreshAttempt){await getDb().insert(jobs).values({id:'last-refresh-attempt',data:JSON.stringify(attempt)}).onConflictDoUpdate({target:jobs.id,set:{data:JSON.stringify(attempt)}});}
export async function discover(input:Profile[]){
 const at=new Date().toISOString();
 try{const result=await runDiscovery(input);try{await saveAttempt({at,ok:true});}catch{}return result;}
 catch(e){try{await saveAttempt({at,ok:false,error:String((e as Error)?.message||'Unknown error').slice(0,300)});}catch{}throw e;}
}
const CALIFORNIA_CSV='https://publish.data.ca.gov/dataset/e1b1c799-cdd4-4219-af6d-93b79747fffb/resource/111c8c88-21f6-453c-ae2c-b4785a0624f5/download/california-grants-portal-data.csv';
async function runDiscovery(input:Profile[]){
 const profiles=monitoredProfiles(input),db=getDb(),now=new Date().toISOString();const existing=new Map((await db.select({id:catalog.id,data:catalog.data}).from(catalog)).map(x=>[x.id,JSON.parse(x.data) as Grant]));const staged=new Map<string,Grant>();const reports:SourceReport[]=[];const stateReports:StateReport[]=[];let cursor=0;const old=await db.select().from(jobs).where(eq(jobs.id,'last-refresh'));if(old[0])cursor=JSON.parse(old[0].data).cursor||0;const cycleStart=cursor;
 const budget=new FetchBudget(RUN_FETCH_LIMIT),caps={sweep:budget.child(SOURCE_FETCH_CAPS.grantsGovSweep),waFundHub:budget.child(SOURCE_FETCH_CAPS.waFundHub),detail:budget.child(SOURCE_FETCH_CAPS.grantsGovDetail),careerOneStop:budget.child(SOURCE_FETCH_CAPS.careerOneStop),california:budget.child(SOURCE_FETCH_CAPS.california),poetsWriters:budget.child(SOURCE_FETCH_CAPS.poetsWriters),chamber:budget.child(SOURCE_FETCH_CAPS.chamber),studentAid:budget.child(SOURCE_FETCH_CAPS.studentAid),seedPrograms:budget.child(SOURCE_FETCH_CAPS.seedPrograms)};let deferredRoutes:{route:string;code:string;category:string;lastScanned:string|null}[]=[];let pageScanFetches=0;
 // Leads dedupe by normalized URL: a reworded title adopts the existing record's ID instead of creating a new one.
 const leads=new Map<string,string>();for(const g of existing.values()){const key=leadKey(g);if(key&&!leads.has(key))leads.set(key,g.id);}
 // seen=false is for cached reuse (no fetch this run): it must not refresh lastSeen, which drives the 30-day hide.
 function stage(g:Grant,seen=true){if(seen)g.lastSeen=now;const key=leadKey(g);if(key&&!staged.has(g.id)&&!existing.has(g.id)){const twin=leads.get(key);if(twin)g.id=twin;}const prior=staged.get(g.id)||existing.get(g.id);if(prior&&prior.sourceMode==='Primary-source research'&&g.sourceMode!=='Primary-source research')return;if(key&&!leads.has(key))leads.set(key,g.id);if(prior){if(g.source==='U.S. Chamber CO—'&&prior.sourceMode==='Official program page')return;g.discovered=prior.discovered;if(g.id.startsWith('cos-')){g.countries=[...new Set([...prior.countries,...g.countries])];g.states=prior.states?.length&&g.states?.length?[...new Set([...prior.states,...g.states])]:[];}}staged.set(g.id,g);}
 async function source(name:string,run:(report:SourceReport)=>Promise<void>){const report:SourceReport={name,status:'Connected',records:0,queries:0};reports.push(report);try{await run(report);}catch(e){if(isBudgetError(e)){report.status=report.records?'Partial':'Deferred';report.note=(report.note?report.note+' ':'')+'Run fetch budget reached; remaining requests deferred to a later run.';return;}report.status=report.records?'Partial':'Unavailable';report.error=(e as Error).message;}}
 // Retirement runs only after a source's fetch succeeded (a throw skips it), never deletes rows, and is skipped
 // when the listing was incomplete or suspiciously short; see retireMissing.
 const retiredIds=new Set<string>();
 function retire(report:SourceReport,prefix:string,seenIds:Set<string>,complete:boolean,reason:string,explicitlyClosed:string[]=[]){const r=retireMissing({prefix,existing:existing.values(),seenIds,complete,explicitlyClosed,reason,now});for(const g of r.retired){if(staged.has(g.id))continue;staged.set(g.id,g);retiredIds.add(g.id);}report.retired=r.retired.length;if(r.guarded){report.status='Partial';report.error=r.note;}else if(r.note)report.note=(report.note?report.note+' ':'')+r.note;}
 // Keeps CareerOneStop's rotation offset advancing exactly as before (it used the Grants.gov interest-search count).
 const interestPlan=new Set<string>();for(const p of profiles){if(countryName(p.country)!=='United States')continue;for(const keyword of interests(p))interestPlan.add(JSON.stringify({keyword:keyword.slice(0,100),eligibilities:codes[p.type]||'21|99'}));}
 const sweepSources=[
 // Full Grants.gov sweep every run, independent of profiles: posted and forecasted grants ("Opens soon").
 source('Grants.gov',async report=>{
  const sweep=await sweepGrantsGov(body=>api('search2',body,caps.sweep),isBudgetError);report.queries+=sweep.queries;if(sweep.deferred)report.deferred=sweep.deferred;
  if(!sweep.hits.size)throw new Error(sweep.errors[0]||(sweep.deferred?'Run fetch budget reached before the sweep.':'Grants.gov sweep returned no opportunities.'));
  const records=new Map([...sweep.hits.values()].map(h=>{const g=grantsGovRecord(h,existing.get('gov-'+h.id),now);return [g.id,g] as [string,Grant];}));
  const queue=detailQueue([...records.values()],now,SOURCE_FETCH_CAPS.grantsGovDetail);let details=0;const detailErrors:string[]=[];
  await pool(queue,4,async g=>{try{const d=await api('fetchOpportunity',{opportunityId:Number(g.grantsGovId)},caps.detail);report.queries++;details++;records.set(g.id,applyGrantsGovDetail(g,d,now));}catch(e){if(isBudgetError(e)){report.deferred=(report.deferred||0)+1;return;}detailErrors.push((e as Error).message);}});
  for(const g of records.values())stage(g);report.records=records.size;
  const forecasts=[...records.values()].filter(g=>g.status==='Opens soon').length,staleForecasts=[...records.values()].filter(g=>g.closedReason?.startsWith('Forecast')).length;
  report.note=`Full sweep: ${records.size} posted or forecasted grants for individual, business and nonprofit applicants (${forecasts} forecasted, shown as Opens soon; ${staleForecasts} stale forecasts closed and hidden because an estimated date has passed or the forecast is over two years old). ${details} detail lookups this run (cap ${SOURCE_FETCH_CAPS.grantsGovDetail}); award amounts and full text fill in over later runs.`;
  if(sweep.errors.length){report.status='Partial';report.error=sweep.errors.join('; ');}
  else if(detailErrors.length){report.status='Partial';report.error='Detail lookup: '+detailErrors[0];}
  retire(report,'gov-',new Set(records.keys()),sweep.complete&&!sweep.errors.length,'No longer posted or forecasted on Grants.gov');
 }),
 // California's official CSV every run, independent of profiles.
 source('California Grants Portal',async report=>{
  const raw=await text(CALIFORNIA_CSV,caps.california);report.queries=1;const records=parseCalifornia(raw,now);if(!records.length)throw new Error('No active eligible categories parsed; verify state source format.');records.forEach(g=>stage(g));report.records=records.length;report.note='Official daily-updated state CSV; open grants only, excluding loans and government-only applicant categories.';
  retire(report,'ca-',new Set(records.map(g=>g.id)),true,'No longer an active grant for supported applicants in the California Grants Portal data');
 }),
 // Washington FundHub (public WordPress REST API): active grants for businesses, individuals and nonprofits.
 source('Washington FundHub',async report=>{
  const wa=await fetchWaFundHub(url=>text(url,caps.waFundHub),SOURCE_FETCH_CAPS.waFundHub,now);report.queries+=wa.queries;wa.records.forEach(g=>stage(g));const seen=new Set(wa.records.map(g=>g.id)),inactive=wa.inactiveIds,complete=wa.complete;
  report.records=seen.size;report.note=`Active Washington FundHub grants for businesses, individuals and nonprofits (${inactive.length} closed or expired listings skipped).`+(complete?'':' Listing larger than the per-run page cap; only explicitly closed records were retired.');
  retire(report,'wa-',seen,complete,'No longer listed as active on Washington FundHub',inactive);
 }),
 ];
 if(profiles.length)await Promise.all([...sweepSources,
 source('CareerOneStop Scholarship Finder',async report=>{
  const searches=new Map<string,{country:string;state?:string;keyword?:string}>();for(const p of profiles.filter(p=>p.type==='Student')){const country=countryName(p.country);if(country!=='United States')continue;const state=stateName(p.state);const contexts=[{country,state:undefined,keyword:undefined},...(state?[{country,state,keyword:undefined}]:[]),...interests(p).slice(0,3).map(keyword=>({country,state:undefined,keyword}))];for(const c of contexts)searches.set(JSON.stringify(c),c);}
  // National coverage is searched every run; state and interest searches rotate within the per-run fetch cap.
  const all=[...searches.values()],national=all.filter(s=>!s.keyword&&!s.state).slice(0,1),rest=all.filter(s=>s.keyword||s.state),offset=rest.length?cycleStart%rest.length:0,selected=[...national,...[...rest.slice(offset),...rest.slice(0,offset)]].slice(0,SOURCE_FETCH_CAPS.careerOneStop);report.note=`${selected.length}/${all.length} searches this run (national every run; state and interest searches rotate), up to 50 listings each. Recurring dates without a year remain unconfirmed. Full details: CareerOneStop / Gale.`;
  await pool(selected,3,async context=>{for(let page=1;page<=1;page++){const params=new URLSearchParams({pagesize:'50',curPage:String(page),georestrictionfilter:context.state||'US'});if(context.keyword)params.set('keyword',context.keyword);try{const html=await text('https://cloudfront.careeronestop.org/toolkit/training/find-scholarships.aspx?'+params,caps.careerOneStop);report.queries++;const records=parseScholarships(html,now,context);for(const g of records)stage(g);report.records+=records.length;if(records.length<50)break;}catch(e){if(isBudgetError(e)){report.deferred=(report.deferred||0)+1;break;}report.status=report.records?'Partial':'Unavailable';report.error=(e as Error).message;break;}}});
  if(!selected.length){report.status='Not needed';report.note='Add a monitored U.S. student profile for national, state, and interest searches.';}
 }),
 source('Poets & Writers',async report=>{
  if(!profiles.some(p=>['Individual','Freelancer','Student'].includes(p.type))){report.status='Not needed';report.note='Private arts funding and awards for individual applicants.';return;}
  // Pages of 100 listings (upcoming deadlines only). The listing is complete when a page has fewer than 100 rows.
  const pw=await fetchPoetsWriters(url=>text(url,caps.poetsWriters),SOURCE_FETCH_CAPS.poetsWriters,now);report.queries+=pw.queries;pw.records.forEach(g=>stage(g));const seen=new Set(pw.records.map(g=>g.id)),complete=pw.complete;
  report.records=seen.size;report.note='Private writing grants, fellowships, and prizes are labeled separately. Entry fees and residency need review.';
  retire(report,'pw-',seen,complete,'No longer listed with an upcoming deadline on Poets & Writers');
 }),
 source('U.S. Chamber CO—',async report=>{
  if(!profiles.some(p=>['Small business','Freelancer'].includes(p.type)&&countryName(p.country)==='United States')){report.status='Not needed';return;}
  const html=await text('https://www.uschamber.com/co/run/business-financing/small-business-grants-and-programs',caps.chamber);report.queries=1;const records=parseBusinessGrants(html,now);if(!records.length)throw new Error('No business grant leads parsed.');records.forEach(g=>stage(g));report.records=records.length;report.note='Live business funding guide leads with sponsor links. Recurring programs are not assumed open. Loans and investments are excluded.';
 }),
 // studentaid.gov pages are checked at most weekly, and a refused check is a health warning (see checkOfficialPrograms).
 source('Official student aid programs',async report=>{
  const programs=relevantPrograms(profiles);if(!programs.length){report.status='Not needed';report.note='No student profile in a supported program jurisdiction.';return;}
  const row=await db.select().from(jobs).where(eq(jobs.id,PROGRAM_CHECKS_JOB));const checks=row[0]?JSON.parse(row[0].data):{};
  const r=await checkOfficialPrograms({programs,fetchHtml:url=>text(url,caps.studentAid),existing,checks,now,isBudgetError});
  r.records.forEach(g=>stage(g));report.records=r.records.length+r.kept;report.queries=r.queries;if(r.deferred)report.deferred=r.deferred;
  await db.insert(jobs).values({id:PROGRAM_CHECKS_JOB,data:JSON.stringify(r.checks)}).onConflictDoUpdate({target:jobs.id,set:{data:JSON.stringify(r.checks)}});
  const notes=[r.linkOnly?'Some official pages require JavaScript; these show link-check-only status, not live verified rules.':'',r.skipped.length?`Checked weekly, not due this run: ${r.skipped.join(', ')}.`:'',r.warnings.length?'Pages that refused the automated check keep their stored listing.':''].filter(Boolean);if(notes.length)report.note=notes.join(' ');
  if(r.warnings.length)report.warnings=r.warnings;
  if(r.errors.length){report.status='Partial';report.error=r.errors.join('; ');}else if(r.linkOnly)report.status='Partial';
 }),
 source('WomensNet & Awesome Foundation',async report=>{
  const programs=seeds.filter(g=>['amber','awesome'].includes(g.id)&&profiles.some(p=>match(g,p).score>0));await pool(programs,2,async seed=>{try{const html=await text(seed.url,caps.seedPrograms);const content=clean(html);const amount=seed.id==='amber'?Number(content.match(/next\s+\$([\d,]+)\s+Amber Grant/i)?.[1]?.replace(/,/g,''))||null:content.includes('$1,000')?1000:null;const deadline=seed.id==='amber'?explicitDate(content.match(/application cutoff[\s\S]{0,150}/i)?.[0]||''):null;stage({...seed,amount,deadline,checked:now,discovered:now,live:true,status:deadline?'Open':'Verify chapter/cycle',sourceMode:'Official program page',requirements:[...seed.requirements,'Program page checked automatically; confirm full current rules with the provider.']});report.records++;report.queries++;}catch(e){if(isBudgetError(e)){report.deferred=(report.deferred||0)+1;return;}report.status='Partial';report.error=seed.source+': '+(e as Error).message;}});if(!programs.length)report.status='Not needed';
 })
 ]);else await Promise.all(sweepSources);
 if(profiles.length)cursor+=Math.min(3,interestPlan.size);
 // Automatic state page scans (business/aid/arts) run after the fixed sources and use whatever the run budget has
 // left: at least PAGE_SCAN_MIN_FETCHES in the worst case. Routes rotate oldest-first by their stored last-scanned
 // time; recent reports are reused without fetching, and routes the budget cannot cover are deferred, not failed.
 if(profiles.length)await source('50-state funding sources',async report=>{
  const tasks=statePlan(profiles).map(task=>({...task,id:'state-'+task.source.code+'-'+task.category,code:task.source.code,state:task.source.state}));const savedReports=new Map((await db.select().from(jobs)).filter(r=>r.id.startsWith('state-')).map(r=>[r.id,JSON.parse(r.data) as StateReport]));
  const pageBudget=budget.child(budget.remaining),{fresh,due}=orderScanRoutes(tasks,savedReports,Date.now());const cachedFor=(task:{source:{code:string};category:string})=>[...existing.values()].filter(g=>g.id.startsWith('state-'+task.source.code.toLowerCase()+'-'+task.category+'-'));
  for(const task of fresh){const previous=savedReports.get(task.id)!;const cached=cachedFor(task);cached.forEach(g=>stage(g,false));stateReports.push({...previous,queries:0,note:previous.note+' Recent source check reused; no additional fetch.'});report.records+=cached.length;}
  const deferred:typeof due=[];
  await pool(due,5,async item=>{const task=item.route;if(pageBudget.remaining<1){deferred.push(item);return;}const result=await scanState(task.source,task.category,url=>text(url,pageBudget),now);if(result.deferred){deferred.push(item);return;}result.records.forEach(g=>stage(g));stateReports.push(result.report);report.records+=result.records.length;report.queries+=result.report.queries;await db.insert(jobs).values({id:task.id,data:JSON.stringify(result.report)}).onConflictDoUpdate({target:jobs.id,set:{data:JSON.stringify(result.report)}});});
  for(const item of deferred){const cached=cachedFor(item.route);cached.forEach(g=>stage(g,false));report.records+=cached.length;}
  deferredRoutes=deferred.sort((a,b)=>(a.lastScanned===null?-1:0)-(b.lastScanned===null?-1:0)||String(a.lastScanned||'').localeCompare(String(b.lastScanned||''))||a.route.id.localeCompare(b.route.id)).map(d=>({route:`${d.route.state} ${d.route.category}`,code:d.route.code,category:d.route.category,lastScanned:d.lastScanned}));pageScanFetches=pageBudget.used;report.deferred=deferred.length;
  const blocked=stateReports.filter(r=>r.status==='Browser review');report.status=!tasks.length?'Not needed':blocked.length||deferred.length?'Partial':'Connected';report.note=`${tasks.length} state business/aid/arts routes: ${due.length-deferred.length} scanned (${pageBudget.used} fetches), ${fresh.length} reused from the last 20 hours, ${deferred.length} deferred by the run fetch budget (oldest first next run). ${blocked.length} require browser or scheduled research. State directories are not counted as grants. All 50 states are configured.`;
 });
 // Every listing needs a title and an http(s) link. A new record without them is rejected (never saved or sent to
 // an Updates inbox); an update without them is dropped so it never overwrites a good row. Both are named in errors.
 const inboxRejections:string[]=[];for(const g of [...staged.values()]){if(hasTitleAndLink(g))continue;staged.delete(g.id);const missing=missingInboxFields(g);inboxRejections.push(inboxFieldsError(`Rejected ${existing.has(g.id)?'update':'new match'} from ${g.source||'a source'} (${g.id})`,missing.length?missing:['URL']));}
 // Cross-source dedupe (Grants.gov ID or opportunity number, or normalized URL plus title): Grants.gov wins over
 // state feeds, which win over scraped listings. New duplicates are not inserted; existing ones are hidden.
 const dedupe=crossSourceDedupe(staged,existing);for(const id of dedupe.dropNew)staged.delete(id);for(const g of [...dedupe.markExisting,...dedupe.clearExisting])staged.set(g.id,g);
 // Generic titles shared by several visible listings ("Poetry Prize") get their sponsor added, then the number.
 {const pool=new Map(existing);for(const [id,g] of staged)pool.set(id,g);for(const g of disambiguateTitles(visibleListings([...pool.values()],now)))if(staged.has(g.id))staged.set(g.id,g);}
 // Batches keep large source imports within Worker/D1 subrequest limits.
 const records=[...staged.values()];if(!env.DB)throw new Error('Database unavailable');for(let i=0;i<records.length;i+=40){await env.DB.batch(records.slice(i,i+40).map(g=>env.DB!.prepare('INSERT INTO catalog (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(g.id,JSON.stringify(g))));}await mirrorCatalogGeo(env.DB as unknown as D1Like,records.filter(g=>grantCity(g)||grantCounty(g)));
 const created=records.filter(g=>!existing.has(g.id)),newRecords=created.filter(g=>isOpenOpportunity(g,now));const combined=new Map(existing);records.forEach(g=>combined.set(g.id,g));const visible=visibleListings([...combined.values()],now);
 const marked=new Set(dedupe.markExisting.map(g=>g.id));const closedOnArrival=created.filter(g=>isClosedListing(g,now)).length;const counts={added:created.length-closedOnArrival,updated:records.filter(g=>existing.has(g.id)&&!retiredIds.has(g.id)&&!marked.has(g.id)&&contentChanged(existing.get(g.id)!,g)).length,retired:records.filter(g=>retiredIds.has(g.id)).length,deduped:dedupe.deduped};
 const liveMatches=profiles.map(p=>({profileId:p.id,matches:visible.filter(g=>match(g,p).score>0).length,newMatches:newRecords.filter(g=>match(g,p).score>0).length}));
 const matches=new Map(newRecords.map(g=>[g.id,profileMatches(g,profiles)]));const matchedNew=newRecords.filter(g=>matches.get(g.id)!.length);
 const result={checkedAt:now,checked:records.length,newGrants:newRecords.length,newMatchedOpportunities:matchedNew.length,...newOpportunityItems(newRecords,matches),closedNotReported:created.length-newRecords.length,closedOnArrival,queries:reports.reduce((s,r)=>s+r.queries,0),errors:[...reports.filter(r=>r.error).map(r=>r.name+': '+r.error),...inboxRejections],sources:reports,stateReports,profileCoverage:liveMatches,fetchBudget:{limit:RUN_FETCH_LIMIT,used:budget.used,pageScanFetches,pageScanMinimum:PAGE_SCAN_MIN_FETCHES,caps:SOURCE_FETCH_CAPS},deferredRoutes,monitoredProfiles:profiles.length,alertProfiles:profiles.filter(p=>p.alerts).length,cursor,counts,catalogRows:combined.size,visibleListings:visible.length,coverage:'Every run sweeps all posted and forecasted Grants.gov grants for individuals, businesses and nonprofits, the California Grants Portal and Washington FundHub. All 50 states have business-funding, student-aid and state arts council source routes, with per-state scholarship searches. Source-listed program leads, directories, blocked pages, and unconfirmed application cycles are distinguished.'};
 (result as any).health=refreshHealth(result,{at:now,ok:true},Date.parse(now));
 await db.insert(jobs).values({id:'last-refresh',data:JSON.stringify(result)}).onConflictDoUpdate({target:jobs.id,set:{data:JSON.stringify(result)}});
 // One precomputed row for the /grants SEO pages, so each page view is a single D1 read (see lib/seo-store.ts).
 try{await writeSeoIndex(env.DB as unknown as D1Like,visible,publicRefresh(result));}catch(e){console.error('seo-index write failed',e instanceof Error?e.message:'unknown');}
 return result;
}
