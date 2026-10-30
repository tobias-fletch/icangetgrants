import type { Grant } from './grants';
import { clean } from './source-parsers';
import { refusalKind, DAY_MS } from './catalog-sweep';
import { formatDay } from './listing';
import { listingDue, HESC_WEEKLY_DAYS, type HescCheck } from './hesc';

// ---------- Washington WSAC state financial aid programs ----------
// Official source: the Washington Student Achievement Council's "Washington State Financial Aid Programs" page
// (https://wsac.wa.gov/sfa-overview), a server-rendered page with one heading and one paragraph per program,
// and each WSAC-hosted program page. Fetched with the honest ICanGetGrants/1.2 user agent.
// - The list is re-read when its last successful read is LISTING_REFRESH_DAYS old (as HESC); the stored list is
//   reused between reads. State Work Study (a job) and the Aerospace Loan Program (a loan) are left out.
// - WSAC-hosted program pages are read at most weekly, as many per run as the WSAC cap leaves (one with the 1-fetch
//   cap on runs that do not re-read the list), never-read first. Status is
//   what WSAC states: "application period has closed" / "currently closed" is Closed (hidden from public lists),
//   "rolling basis" / "no deadline" is Rolling, anything else is "Verify cycle". Programs WSAC lists but another
//   agency runs (WSOS, Opportunity Grant) link to that agency and are never fetched.
// - Refusals are weekly-recheck health warnings and nothing is retired on a failed or partial read (as HESC).
export const WSAC_ORIGIN='https://wsac.wa.gov';
export const WSAC_LISTING_URL=WSAC_ORIGIN+'/sfa-overview';
export const WSAC_CHECKS_JOB='wsac-checks';
export const WSAC_FUNDER='Washington Student Achievement Council (WSAC)';
export const WSAC_MIN_PROGRAMS=4;
export type WsacProgram={title:string;url:string;description:string;category:string;wsacPage:boolean;funder:string};
export type WsacStatus={kind:'closed'|'rolling'|'mixed';label:string};
export type WsacPageCheck=HescCheck&{result?:WsacStatus|null};
export type WsacState={listing?:HescCheck&{programs?:WsacProgram[]};pages:Record<string,WsacPageCheck>};
const NOT_AID=/\bwork study\b|\bloan program\b/i;
const text=(html:string)=>clean(html).replace(/\s+/g,' ').trim();
/** Absolute https://wsac.wa.gov URL for a WSAC href; null for anything off WSAC. */
export function wsacUrl(href:string):string|null{
 try{const u=new URL(href.trim(),WSAC_ORIGIN+'/');if(!/^(?:www\.)?wsac\.wa\.gov$/i.test(u.hostname))return null;u.protocol='https:';u.hostname='wsac.wa.gov';u.hash='';return u.toString();}catch{return null;}
}
/** Program headings (h3) and their paragraphs on the WSAC state financial aid programs page. */
export function parseWsacListing(html:string):WsacProgram[]{
 const body=html.match(/<div[^>]+property="content:encoded"[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||'';
 const out:WsacProgram[]=[],seen=new Set<string>();let category='';
 for(const m of body.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[23]\b|$)/gi)){
  const title=text(m[2]);if(m[1]==='2'){category=title;continue;}
  if(!title||NOT_AID.test(title)||/learn more/i.test(category))continue;
  const para=m[3].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]||'';const description=text(para);
  const hrefs=[...para.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(a=>({href:a[1],label:text(a[2])}));
  const own=hrefs.map(a=>wsacUrl(a.href)).find(Boolean)||null;
  const outside=/not administered by the Washington Student Achievement Council/i.test(description);
  const ext=outside?hrefs.find(a=>/^https:\/\//i.test(a.href)&&!wsacUrl(a.href)):undefined;
  const url=outside?(ext?.href||null):own;if(!url||seen.has(url))continue;seen.add(url);
  const funder=outside?(ext?.label.replace(/\s*website\s*$/i,'').trim()||'Another Washington agency')+' (listed by WSAC)':WSAC_FUNDER;
  out.push({title,url,description,category,wsacPage:!outside&&!!own,funder});
 }
 return out;
}
/** What a WSAC program page states about applications; null when it states neither closed nor rolling. A page
 *  that says both (Teacher Programs: one grant closed, two scholarships rolling) is "mixed": Verify cycle. */
export function parseWsacStatus(html:string):WsacStatus|null{
 const t=text(html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html);
 const closed=/\b(?:application period has closed|application (?:is|are) (?:now |currently )?closed|applications? (?:is|are) (?:now |currently )?closed)\b/i.test(t);
 const rolling=/\brolling basis\b|\bthere is no deadline\b/i.test(t);
 if(closed&&rolling)return {kind:'mixed',label:'Some closed, some rolling (per WSAC)'};
 if(closed){const when=t.match(/\b(?:will reopen|will be available|reopens?)\s+(?:in\s+|on\s+)?((?:early|late|mid-?)\s+\d{4}|[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/)?.[1];return {kind:'closed',label:'Applications closed per WSAC'+(when?'; next cycle '+when:'')};}
 if(rolling)return {kind:'rolling',label:'Rolling applications (per WSAC)'};
 return null;
}
const slug=(s:string)=>s.toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'program';
export const wsacId=(p:Pick<WsacProgram,'title'>)=>'wsac-'+slug(p.title);
export function wsacRecord(p:WsacProgram,page:WsacPageCheck|undefined,now:string):Grant{
 const use=p.wsacPage?page?.result||null:null;
 const status=use?.kind==='closed'?'Closed':use?.kind==='rolling'?'Rolling':'Verify cycle';
 const label=(use?.label||(p.wsacPage?'Check WSAC for the current application cycle':'Check the program site for the current application cycle')).slice(0,160);
 const note=p.wsacPage&&page?.lastSuccess?`WSAC program page read ${formatDay(page.lastSuccess.slice(0,10))}.`:p.wsacPage?'From the WSAC state financial aid programs list; the program page has not been read yet.':'Listed by WSAC; run by another agency, whose site has the current details.';
 return {id:wsacId(p),title:p.title,funder:p.funder,description:p.description||'Washington State financial aid program listed by WSAC.',types:['Student'],countries:['United States'],states:['Washington'],tags:['education','tuition','college',...(/workforce/i.test(p.category)?['workforce']:[])],amount:null,deadline:null,deadlineLabel:label,url:p.url,source:'WSAC',sourceUrl:WSAC_LISTING_URL,requirements:['Washington residency and program-specific eligibility apply.','Confirm current rules, award amounts and deadlines on the official program page.',note],checked:now,discovered:now,kind:'Student aid',live:true,status,sourceMode:use?'Official program page':'Official program list'};
}
const due=(c:HescCheck|undefined,now:string)=>{if(!c)return true;const last=Date.parse(c.lastAttempt);return !Number.isFinite(last)||Date.parse(now)-last>=HESC_WEEKLY_DAYS*DAY_MS;};
/** WSAC-hosted program pages to read this run, at most `max`: weekly due, never read first, then oldest. */
export function wsacPagesToCheck(programs:WsacProgram[],state:WsacState,now:string,max:number):WsacProgram[]{
 return programs.filter(p=>p.wsacPage&&due(state.pages[p.url],now)).sort((a,b)=>(state.pages[a.url]?1:0)-(state.pages[b.url]?1:0)||String(state.pages[a.url]?.lastAttempt||'').localeCompare(String(state.pages[b.url]?.lastAttempt||''))).slice(0,Math.max(0,max));
}
const nextCheck=(c:HescCheck)=>formatDay(new Date(Date.parse(c.lastAttempt)+HESC_WEEKLY_DAYS*DAY_MS).toISOString().slice(0,10));
export const wsacRefusedWarning=(title:string,c:HescCheck)=>`${title}: wsac.wa.gov ${c.lastError} on ${formatDay(c.lastAttempt.slice(0,10))}. Listing kept; next check after ${nextCheck(c)}.`;
export type WsacRunResult={records:Grant[];seen:boolean;complete:boolean;queries:number;deferred:number;warnings:string[];errors:string[];state:WsacState;pagesRead:number};
/** One WSAC run inside `fetchCap` fetches. fetchHtml must use the honest user agent and the run's fetch budget. */
export async function runWsac(o:{fetchHtml:(url:string)=>Promise<string>;state:WsacState|null|undefined;now:string;fetchCap:number;isBudgetError:(e:unknown)=>boolean}):Promise<WsacRunResult>{
 const state:WsacState={listing:o.state?.listing?{...o.state.listing}:undefined,pages:{...(o.state?.pages||{})}};
 const r:WsacRunResult={records:[],seen:false,complete:false,queries:0,deferred:0,warnings:[],errors:[],state,pagesRead:0};
 let left=o.fetchCap;
 if(listingDue(state.listing,o.now)&&left>0){
  left--;
  try{const html=await o.fetchHtml(WSAC_LISTING_URL);r.queries++;const programs=parseWsacListing(html);
   if(programs.length<WSAC_MIN_PROGRAMS)r.errors.push(`WSAC state financial aid programs list: ${programs.length} programs parsed (under ${WSAC_MIN_PROGRAMS}); verify the page format.`);
   else{state.listing={lastAttempt:o.now,lastSuccess:o.now,programs};r.seen=true;r.complete=true;}}
  catch(e){if(o.isBudgetError(e)){r.deferred++;}else{r.queries++;const kind=refusalKind(e);
   if(kind){state.listing={...(state.listing||{}),lastAttempt:o.now,lastError:kind};console.warn('wsac listing refused',kind);}
   else r.errors.push('WSAC state financial aid programs list: '+String((e as Error)?.message||e).slice(0,200));}}
 }
 if(state.listing?.lastError)r.warnings.push(wsacRefusedWarning('WSAC state financial aid programs list',state.listing));
 const programs=state.listing?.programs||[];
 for(const p of wsacPagesToCheck(programs,state,o.now,left)){
  try{const html=await o.fetchHtml(p.url);r.queries++;r.pagesRead++;state.pages[p.url]={lastAttempt:o.now,lastSuccess:o.now,result:parseWsacStatus(html)};}
  catch(e){if(o.isBudgetError(e)){r.deferred++;break;}r.queries++;const kind=refusalKind(e);
   if(kind)state.pages[p.url]={...(state.pages[p.url]||{}),lastAttempt:o.now,lastError:kind};
   else r.errors.push(p.title+': '+String((e as Error)?.message||e).slice(0,200));}
 }
 for(const p of programs){const c=state.pages[p.url];if(c?.lastError&&!due(c,o.now))r.warnings.push(wsacRefusedWarning(p.title,c));}
 r.records=programs.map(p=>wsacRecord(p,state.pages[p.url],o.now));
 return r;
}
