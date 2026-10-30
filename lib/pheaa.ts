import type { Grant } from './grants';
import { formatDay } from './listing';
import { listingDue, HESC_WEEKLY_DAYS, type HescCheck } from './hesc';
import { refusalKind, DAY_MS } from './catalog-sweep';

// ---------- Pennsylvania PHEAA state grant programs ----------
// Official source: PHEAA's own site navigation (https://www.pheaa.org/grants and
// https://www.pheaa.org/funding-opportunities). pheaa.org is a single-page app: every page URL returns the same
// small HTML shell, and the page list lives in the route table of the site's one JavaScript bundle
// (`{label:"PA State Grant Program",path:"state-grant-program",children:[...]}`). One read is two fetches:
// the shell (to find the current, content-hashed bundle name) and the bundle. Both use the honest
// ICanGetGrants/1.2 user agent. robots.txt disallows /documents/ and PDFs; neither is ever fetched.
// - Re-read when the last successful read is LISTING_REFRESH_DAYS old (as HESC); the stored list is reused between
//   reads, and a refusal is a weekly-recheck health warning (as HESC and studentaid.gov).
// - Program pages render in the browser, so no deadline is claimed: status is "Verify cycle" and the card says to
//   check PHEAA's page. Program entries only: FAQ, apply, prepare, forms, partner and school lists, loan
//   forgiveness/relief, work-study (a job) and the GrantUs portal are left out.
// - A read that yields fewer than PHEAA_MIN_PROGRAMS programs is treated as a changed format: an error, the stored
//   list is kept and nothing is retired.
export const PHEAA_ORIGIN='https://www.pheaa.org';
export const PHEAA_SHELL_URL=PHEAA_ORIGIN+'/funding-opportunities';
export const PHEAA_CHECKS_JOB='pheaa-checks';
export const PHEAA_FUNDER='Pennsylvania Higher Education Assistance Agency (PHEAA)';
export const PHEAA_MIN_PROGRAMS=5;
export type PheaaProgram={title:string;url:string;section:string};
export type PheaaState={bundleUrl?:string;listing?:HescCheck&{programs?:PheaaProgram[]}};
const SECTIONS=['grants','funding-opportunities'];
const HELPER=/\b(?:FAQ|apply|renew|prepare|forms|documents|participating|partners|repayment|eligible schools|service commitment|issue alerts)\b|\b(?:student & family resources|school training)\b/i;
const NOT_AID=/loan forgiveness|loan relief|work-?study|\bPA HELPS\b|\bGrantUs\b/i;

/** Same-origin /assets/*.js module bundle named in the pheaa.org HTML shell; null when absent. */
export function pheaaBundleUrl(html:string):string|null{
 const src=html.match(/<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/i)?.[1]||html.match(/<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/i)?.[1];if(!src)return null;
 try{const u=new URL(src,PHEAA_ORIGIN+'/');return u.origin===PHEAA_ORIGIN&&/^\/assets\/[\w.-]+\.js$/.test(u.pathname)?u.toString():null;}catch{return null;}
}
type Node={label?:string;path?:string;children:Node[]};
/** Parses the object-literal route tree that starts at `start` (an index of "{"). Strings are skipped safely. */
function routeTree(js:string,start:number):Node|null{
 const stack:Node[]=[];let root:Node|null=null;
 for(let i=start;i<js.length;i++){const c=js[i];
  if(c==='"'||c==="'"||c==='`'){const q=c;i++;while(i<js.length&&js[i]!==q){if(js[i]==='\\')i++;i++;}continue;}
  if(c==='{'){const n:Node={children:[]};if(stack.length)stack[stack.length-1].children.push(n);else root=n;stack.push(n);
   const head=js.slice(i+1,i+400);const label=head.match(/^(?:[^{}]*?[,{\s])?label:"((?:[^"\\]|\\.)*)"/)?.[1];const path=head.match(/^(?:[^{}]*?[,{\s])?path:"((?:[^"\\]|\\.)*)"/)?.[1];
   if(label!==undefined)n.label=label.replace(/\\(.)/g,'$1').replace(/\s+/g,' ').trim();if(path!==undefined)n.path=path;continue;}
  if(c==='}'){stack.pop();if(!stack.length)return root;}
 }
 return null;
}
const isProgram=(n:Node)=>!!n.label&&!!n.path&&!HELPER.test(n.label);
/** PHEAA grant and aid programs from the route table in the pheaa.org bundle. */
export function parsePheaaRoutes(js:string):PheaaProgram[]{
 const out:PheaaProgram[]=[],seenUrl=new Set<string>(),seenTitle=new Set<string>();
 for(const section of SECTIONS){
  const at=js.search(new RegExp(`\\{(?:label:"[^"]*",)?path:"${section}"(?:,label:"[^"]*")?,children:\\[`));if(at<0)continue;
  const tree=routeTree(js,at);if(!tree)continue;
  const walk=(n:Node,base:string)=>{for(const c of n.children){if(!c.path)continue;const url=base+'/'+c.path;
   if(!isProgram(c)||NOT_AID.test(c.label!))continue;
   // A category (e.g. "Aid for Military and Pennsylvania National Guard") groups two or more programs.
   const kids=c.children.filter(isProgram);
   if(kids.length<2){const key=c.label!.toLowerCase().replace(/^pennsylvania\b/,'pa').replace(/[^a-z0-9]+/g,' ').trim();
    if(!seenUrl.has(url)&&!seenTitle.has(key)){seenUrl.add(url);seenTitle.add(key);out.push({title:c.label!,url:PHEAA_ORIGIN+url,section});}}
   walk(c,url);}};
  walk(tree,'/'+section);
 }
 return out;
}
const slug=(url:string)=>new URL(url).pathname.replace(/\/+$/,'').split('/').pop()!.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'program';
export const pheaaId=(url:string)=>'pheaa-'+slug(url);
export function pheaaRecord(p:PheaaProgram,listingAt:string|undefined,now:string):Grant{
 const military=/national guard|military|pow|mia\b/i.test(p.title)||/aid-for-military/.test(p.url);
 return {id:pheaaId(p.url),title:p.title,funder:PHEAA_FUNDER,description:'Pennsylvania student aid program administered by PHEAA. Eligibility, award amounts and the current deadline are on the PHEAA program page.',types:['Student'],countries:['United States'],states:['Pennsylvania'],tags:['education','tuition','college',...(military?['military']:[])],amount:null,deadline:null,deadlineLabel:'Check PHEAA for the current deadline',url:p.url,source:'PHEAA',sourceUrl:PHEAA_SHELL_URL,requirements:['Pennsylvania residency and program-specific eligibility apply.','Confirm current rules, award amounts and deadlines on the official PHEAA page.',listingAt?`Listed in PHEAA's program list, read ${formatDay(listingAt.slice(0,10))}.`:"From PHEAA's program list."],checked:now,discovered:now,kind:'Student aid',live:true,status:'Verify cycle',sourceMode:'Official program list'};
}
const nextCheck=(c:HescCheck)=>formatDay(new Date(Date.parse(c.lastAttempt)+HESC_WEEKLY_DAYS*DAY_MS).toISOString().slice(0,10));
export const pheaaRefusedWarning=(c:HescCheck)=>`PHEAA program list: pheaa.org ${c.lastError} on ${formatDay(c.lastAttempt.slice(0,10))}. Listing kept; next check after ${nextCheck(c)}.`;
export type PheaaRunResult={records:Grant[];seen:boolean;complete:boolean;queries:number;deferred:number;warnings:string[];errors:string[];notes:string[];state:PheaaState};
/** One PHEAA run inside `fetchCap` fetches (1 per run once the bundle name is known). fetchHtml must use the
 *  honest user agent and the run budget, and throw "HTTP <status>" errors. */
export async function runPheaa(o:{fetchHtml:(url:string)=>Promise<string>;state:PheaaState|null|undefined;now:string;fetchCap:number;isBudgetError:(e:unknown)=>boolean}):Promise<PheaaRunResult>{
 const state:PheaaState={bundleUrl:o.state?.bundleUrl,listing:o.state?.listing?{...o.state.listing}:undefined};
 const r:PheaaRunResult={records:[],seen:false,complete:false,queries:0,deferred:0,warnings:[],errors:[],notes:[],state};
 let left=o.fetchCap;
 const failed=(what:string,e:unknown)=>{if(o.isBudgetError(e)){r.deferred++;return;}r.queries++;const kind=refusalKind(e);
  if(kind){state.listing={...(state.listing||{}),lastAttempt:o.now,lastError:kind};console.warn('pheaa refused',kind);}
  else r.errors.push(what+': '+String((e as Error)?.message||e).slice(0,200));};
 if(listingDue(state.listing,o.now)){
  if(!state.bundleUrl&&left>0){left--;
   try{const shell=await o.fetchHtml(PHEAA_SHELL_URL);r.queries++;const bundle=pheaaBundleUrl(shell);
    if(bundle){state.bundleUrl=bundle;r.notes.push('Site bundle located.');}else r.errors.push('PHEAA program list: no site bundle found in the page shell; verify the page format.');}
   catch(e){failed('PHEAA page shell',e);}}
  if(state.bundleUrl&&left>0){left--;
   try{const js=await o.fetchHtml(state.bundleUrl);r.queries++;const programs=parsePheaaRoutes(js);
    if(programs.length<PHEAA_MIN_PROGRAMS)r.errors.push(`PHEAA program list: ${programs.length} programs parsed (under ${PHEAA_MIN_PROGRAMS}); verify the page format.`);
    else{state.listing={lastAttempt:o.now,lastSuccess:o.now,programs};r.seen=true;r.complete=true;}}
   catch(e){if(!o.isBudgetError(e)&&/\bHTTP 404\b/.test(String((e as Error)?.message||e))){r.queries++;state.bundleUrl=undefined;r.notes.push('PHEAA published a new site bundle; it is located on the next run and the stored list is kept until then.');}
    else failed('PHEAA program list',e);}}
  else if(state.bundleUrl&&left<1)r.deferred++;
 }
 if(state.listing?.lastError)r.warnings.push(pheaaRefusedWarning(state.listing));
 r.records=(state.listing?.programs||[]).map(p=>pheaaRecord(p,state.listing?.lastSuccess,o.now));
 return r;
}
