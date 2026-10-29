import type { Grant } from './grants';
import { clean } from './source-parsers';
import { refusalKind, DAY_MS } from './catalog-sweep';
import { formatDay, calendarDay } from './listing';

// ---------- New York HESC state grants and scholarships ----------
// Official source: the NYS Higher Education Services Corporation list of state grants and scholarships
// (https://hesc.ny.gov/find-aid/nys-grants-scholarships) and each program's own page on hesc.ny.gov.
// Fetched with the site's honest ICanGetGrants/1.2 user agent, never a disguised one.
// - The listing (one page, all programs, with HESC's "Accepting Applications" line) is re-read when its last
//   successful read is LISTING_REFRESH_DAYS old; on other runs the stored listing is reused.
// - Each program page states its deadline ("Deadline 06/30/2027 For Academic Year 2026-27", "Deadline Open
//   Year-Round", "... is now closed"). Pages are re-read at most weekly, a few per run inside the HESC fetch cap,
//   unchecked and conflicting pages first.
// - Status is exactly what HESC states: a program page deadline date (Open, with that deadline), "Open
//   Year-Round" (Rolling), "closed" (Closed, hidden from public lists). Until a program page has been read, the
//   listing line decides: "Accepting Applications" is Open with no deadline claimed; no line is "Verify cycle".
// - A refusal (refused, reset, timed out, HTTP 403/429 or any 5xx, see refusalKind) is recorded as that
//   page's weekly attempt and shown as a health warning, exactly like the weekly studentaid.gov check. Stored
//   listings are kept and nothing is retired. Other errors (404, changed page) are source errors.
export const HESC_ORIGIN='https://hesc.ny.gov';
export const HESC_LISTING_URL=HESC_ORIGIN+'/find-aid/nys-grants-scholarships';
export const HESC_CHECKS_JOB='hesc-checks';
export const HESC_FUNDER='NYS Higher Education Services Corporation (HESC)';
export const HESC_WEEKLY_DAYS=7;
export const LISTING_REFRESH_DAYS=3;
export type HescProgram={title:string;url:string;description:string;accepting:boolean;statusLine:string|null};
// label is the short card text (the site shows at most 60 characters); stated lists every date HESC gives.
export type HescDeadline={kind:'date'|'rolling'|'closed'|'school';deadline:string|null;label:string;stated?:string};
export type HescCheck={lastAttempt:string;lastSuccess?:string;lastError?:string};
export type HescPageCheck=HescCheck&{result?:HescDeadline|null};
export type HescState={listing?:HescCheck&{programs?:HescProgram[]};pages:Record<string,HescPageCheck>};

const text=(html:string)=>clean(html).replace(/\s+/g,' ').trim();
/** Absolute https://hesc.ny.gov URL for a listing href; null for anything off the official site. */
export function hescUrl(href:string):string|null{
 try{const u=new URL(href.trim(),HESC_ORIGIN+'/');if(!/^(?:www\.)?hesc\.ny\.gov$/i.test(u.hostname))return null;u.protocol='https:';u.hostname='hesc.ny.gov';u.hash='';return u.toString();}catch{return null;}
}
/** Program cards on the HESC grants & scholarships page. */
export function parseHescListing(html:string):HescProgram[]{
 const out:HescProgram[]=[],seen=new Set<string>();
 const parts=html.split(/<div[^>]+class="[^"]*\bscholarship-grant-loan-callout\b(?![_-])[^"]*"[^>]*>/i).slice(1);
 for(const part of parts){
  const link=part.match(/class="[^"]*scholarship-grant-loan-callout__link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)||part.match(/href="([^"]+)"[^>]*class="[^"]*scholarship-grant-loan-callout__link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if(!link)continue;const url=hescUrl(link[1]);const title=text(link[2]);if(!url||!title||seen.has(url))continue;seen.add(url);
  const description=text(part.match(/scholarship-grant-loan-callout__description[^>]*>([\s\S]*?)<\/(?:p|div)>/i)?.[1]||'');
  const statusLine=text(part.match(/scholarship-grant-loan-callout__status"[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'')||null;
  out.push({title,url,description,statusLine,accepting:/accepting applications/i.test(statusLine||'')});
 }
 return out;
}
const isoDay=(m:string,d:string,y:string)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
/** The "Deadline & Application" section of a HESC program page, as HESC states it. null when absent or unclear. */
export function parseHescDeadline(html:string,now:string|Date=new Date()):HescDeadline|null{
 const t=text(html);const today=calendarDay(typeof now==='string'?new Date(now):now);
 // The first "Deadline & Application" is the page's tab menu ("Deadline & Application Award Eligibility ...").
 const sections=[...t.matchAll(/Deadline & Application\b/g)].map(m=>t.slice(m.index!+22,m.index!+22+600).trim()).filter(s=>!/^Award\b/.test(s));
 const raw=sections[0];if(!raw)return null;const s=raw.split(/\s(?:Award|Eligibility|Help & Resources)\b/)[0].trim();
 if(/\b(?:is|are) (?:now )?closed\b|no longer accepting/i.test(s)){const sentence=s.match(/[^.]*\b(?:is|are) (?:now )?closed\b[^.]*\./i)?.[0]||s.match(/[^.]*no longer accepting[^.]*\./i)?.[0]||'Closed';return {kind:'closed',deadline:null,label:sentence.trim()};}
 if(/^Deadline\s+Open Year[- ]Round\b/i.test(s))return {kind:'rolling',deadline:null,label:'Open year-round (per HESC)'};
 const dates=[...s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b(?:\s+For (?:the )?(?:Academic Year )?(\d{4}-\d{2})(?: Academic Year)?)?/gi)].map(m=>({day:isoDay(m[1],m[2],m[3]),shown:`${m[1]}/${m[2]}/${m[3]}`,year:m[4]||null}));
 if(/^Deadline\b/i.test(s)&&dates.length){
  const upcoming=dates.filter(d=>d.day>=today).sort((a,b)=>a.day.localeCompare(b.day));
  const stated='HESC deadline'+(dates.length>1?'s':'')+': '+dates.map(d=>d.shown+(d.year?' for academic year '+d.year:'')).join('; ')+'.';
  if(!upcoming.length)return {kind:'closed',deadline:dates.map(d=>d.day).sort().pop()!,label:'Deadline passed',stated};
  return {kind:'date',deadline:upcoming[0].day,label:'Deadline '+upcoming[0].shown+(upcoming[0].year?' for '+upcoming[0].year:''),stated};
 }
 const school=s.match(/[^.]*\b(?:check with|contact) your (?:high )?school\b[^.]*\./i)?.[0];
 if(school)return {kind:'school',deadline:null,label:school.trim()};
 return null;
}
const slug=(url:string)=>new URL(url).pathname.replace(/\/+$/,'').split('/').pop()!.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'program';
export const hescId=(url:string)=>'hesc-'+slug(url);
/** Uses the program page result when it was read after the listing or agrees with it; otherwise the listing line. */
export function hescRecord(p:HescProgram,page:HescPageCheck|undefined,listingAt:string|undefined,now:string):Grant{
 const result=page?.result||null;
 const pageAt=page?.lastSuccess,conflict=!!result&&p.accepting&&result.kind==='closed'&&!!listingAt&&(!pageAt||listingAt>pageAt);
 const use=result&&!conflict?result:null;
 const status=use?(use.kind==='date'?'Open':use.kind==='rolling'?'Rolling':use.kind==='closed'?'Closed':'Verify cycle'):(p.accepting?'Open':'Verify cycle');
 const deadlineLabel=use?use.label:p.accepting?'Open: accepting applications per HESC':'No application status on the HESC list; verify';
 const checkedNote=use&&pageAt?`HESC program page read ${formatDay(pageAt.slice(0,10))}.`:'From the HESC grants & scholarships list; the program page has not been read yet.';
 return {id:hescId(p.url),title:p.title,funder:HESC_FUNDER,description:p.description||'New York State grant or scholarship administered by HESC.',types:['Student'],countries:['United States'],states:['New York'],tags:['education','tuition','college','scholarship'],amount:null,deadline:use?.kind==='date'||use?.kind==='closed'?use.deadline:null,deadlineLabel,url:p.url,source:'NYS HESC',sourceUrl:HESC_LISTING_URL,requirements:['New York State residency and program-specific eligibility apply.','Confirm current rules, award amounts and deadlines on the official HESC page.',...(use?.stated?[use.stated]:[]),checkedNote],checked:now,discovered:now,kind:'Student aid',live:true,status,sourceMode:use?'Official program page':'Official program list'};
}
const due=(c:HescCheck|undefined,days:number,now:string)=>{if(!c)return true;const last=Date.parse(c.lastAttempt);return !Number.isFinite(last)||Date.parse(now)-last>=days*DAY_MS;};
/** Listing due: never read, a successful read LISTING_REFRESH_DAYS old, or a refusal at least a week old. */
export function listingDue(c:HescCheck|undefined,now:string){if(!c)return true;return c.lastError?due(c,HESC_WEEKLY_DAYS,now):due(c,LISTING_REFRESH_DAYS,now);}
/** Program pages to read this run, at most `max`: weekly due, listing/page conflicts first, then never read, then oldest. */
export function pagesToCheck(programs:HescProgram[],state:HescState,now:string,max:number):HescProgram[]{
 const listingAt=state.listing?.lastSuccess;
 const rank=(p:HescProgram)=>{const c=state.pages[p.url];if(c?.result&&p.accepting&&c.result.kind==='closed'&&listingAt&&(!c.lastSuccess||listingAt>c.lastSuccess))return 0;if(!c)return p.accepting?2:1;return 3;};
 return programs.filter(p=>{const c=state.pages[p.url];return rank(p)===0?(!c?.lastError||due(c,HESC_WEEKLY_DAYS,now)):due(c,HESC_WEEKLY_DAYS,now);}).sort((a,b)=>rank(a)-rank(b)||String(state.pages[a.url]?.lastAttempt||'').localeCompare(String(state.pages[b.url]?.lastAttempt||''))).slice(0,Math.max(0,max));
}
const nextCheck=(c:HescCheck)=>formatDay(new Date(Date.parse(c.lastAttempt)+HESC_WEEKLY_DAYS*DAY_MS).toISOString().slice(0,10));
export const hescRefusedWarning=(title:string,c:HescCheck)=>`${title}: hesc.ny.gov ${c.lastError} on ${formatDay(c.lastAttempt.slice(0,10))}. Listing kept; next check after ${nextCheck(c)}.`;
export type HescRunResult={records:Grant[];seen:boolean;complete:boolean;queries:number;deferred:number;warnings:string[];errors:string[];state:HescState;pagesRead:number};
/** One HESC run inside `fetchCap` fetches. fetchHtml must use the honest user agent and the run's fetch budget. */
export async function runHesc(o:{fetchHtml:(url:string)=>Promise<string>;state:HescState|null|undefined;now:string;fetchCap:number;isBudgetError:(e:unknown)=>boolean}):Promise<HescRunResult>{
 const state:HescState={listing:o.state?.listing?{...o.state.listing}:undefined,pages:{...(o.state?.pages||{})}};
 const r:HescRunResult={records:[],seen:false,complete:false,queries:0,deferred:0,warnings:[],errors:[],state,pagesRead:0};
 let left=o.fetchCap;
 if(listingDue(state.listing,o.now)&&left>0){
  left--;
  try{const html=await o.fetchHtml(HESC_LISTING_URL);r.queries++;const programs=parseHescListing(html);
   if(!programs.length)r.errors.push('HESC grants & scholarships list: no programs parsed; verify the page format.');
   else{state.listing={lastAttempt:o.now,lastSuccess:o.now,programs};r.seen=true;r.complete=true;}}
  catch(e){if(o.isBudgetError(e)){r.deferred++;}else{r.queries++;const kind=refusalKind(e);
   if(kind){state.listing={...(state.listing||{}),lastAttempt:o.now,lastError:kind};console.warn('hesc listing refused',kind);}
   else r.errors.push('HESC grants & scholarships list: '+String((e as Error)?.message||e).slice(0,200));}}
 }
 if(state.listing?.lastError)r.warnings.push(hescRefusedWarning('NYS grants & scholarships list',state.listing));
 const programs=state.listing?.programs||[];
 for(const p of pagesToCheck(programs,state,o.now,left)){
  try{const html=await o.fetchHtml(p.url);r.queries++;r.pagesRead++;const result=parseHescDeadline(html,o.now);state.pages[p.url]={lastAttempt:o.now,lastSuccess:o.now,result};}
  catch(e){if(o.isBudgetError(e)){r.deferred++;break;}r.queries++;const kind=refusalKind(e);
   if(kind){state.pages[p.url]={...(state.pages[p.url]||{}),lastAttempt:o.now,lastError:kind};}
   else r.errors.push(p.title+': '+String((e as Error)?.message||e).slice(0,200));}
 }
 for(const p of programs){const c=state.pages[p.url];if(c?.lastError&&!due(c,HESC_WEEKLY_DAYS,o.now))r.warnings.push(hescRefusedWarning(p.title,c));}
 r.records=programs.map(p=>hescRecord(p,state.pages[p.url],state.listing?.lastSuccess,o.now));
 return r;
}
