import type { Grant, Profile } from './grants';
import { countryName, stateName, clean, explicitDate } from './source-parsers';
import { refusalKind, DAY_MS } from './catalog-sweep';
import { formatDay } from './listing';
export type Program={id:string;title:string;funder:string;url:string;state?:string;levels?:string[];tags:string[];description:string;requirements:string[];marker:RegExp};
export const aidPrograms:Program[]=[
 {id:'pell',title:'Federal Pell Grant',funder:'Federal Student Aid',url:'https://studentaid.gov/understand-aid/types/grants/pell',levels:['Undergraduate','Vocational / certificate'],tags:['education','tuition','college'],description:'Need-based education aid for eligible undergraduate students through the FAFSA and a participating school.',requirements:['Financial need, citizenship/eligible noncitizen status, and enrollment rules apply.','Confirm the award year, school participation, application deadlines, and award amount.'],marker:/pell/i},
 {id:'fseog',title:'Federal Supplemental Educational Opportunity Grant (FSEOG)',funder:'Federal Student Aid',url:'https://studentaid.gov/understand-aid/types/grants/fseog',levels:['Undergraduate'],tags:['education','tuition','financial need'],description:'Additional need-based grant aid administered by participating college financial aid offices. School funding is limited.',requirements:['Exceptional financial need and undergraduate eligibility apply.','Complete FAFSA and ask the school about its application priority date and remaining funding.'],marker:/fseog|supplemental educational/i},
 {id:'teach',title:'TEACH Grant',funder:'Federal Student Aid',url:'https://studentaid.gov/understand-aid/types/grants/teach',levels:['Undergraduate','Graduate'],tags:['education','teaching','teacher','tuition'],description:'Education funding tied to an eligible teacher preparation program and a qualifying teaching service obligation.',requirements:['School and program participation rules apply.','Failure to satisfy the service obligation can cause conversion to a loan; review official terms before accepting.'],marker:/teach grant/i},
 {id:'ny-tap',title:'New York Tuition Assistance Program (TAP)',funder:'New York State',url:'https://www.ny.gov/services/apply-new-york-state-tap',state:'New York',levels:['Undergraduate'],tags:['education','tuition','college'],description:'State tuition assistance for eligible New York residents at approved schools.',requirements:['Residency, income, enrollment, and academic requirements apply.','Complete the applicable FAFSA/TAP or DREAM Act process and check the current academic year.'],marker:/tuition assistance|TAP/},
 {id:'cal-grant',title:'California Cal Grants',funder:'California Student Aid Commission',url:'https://csac.ca.gov/programs',state:'California',levels:['Undergraduate','Vocational / certificate'],tags:['education','tuition','training','college'],description:'California education grant programs for eligible students, including academic and career training routes.',requirements:['State residency or qualifying exemption, financial need, GPA, and program rules apply.','Confirm the correct Cal Grant program, FAFSA/Dream Act application, and priority deadlines.'],marker:/Cal Grant/i},
 {id:'pa-state-grant',title:'PA State Grant Program',funder:'PHEAA',url:'https://www.pheaa.org/grants/state-grant-program',state:'Pennsylvania',levels:['Undergraduate'],tags:['education','tuition','college'],description:'Pennsylvania need-based student grant program administered by PHEAA.',requirements:['Pennsylvania residency, financial need, and eligible enrollment apply.','Complete FAFSA and the PA State Grant process; check the current award year.'],marker:/PA State Grant/i},
 {id:'pa-grow',title:'Grow PA Scholarship Grant Program',funder:'PHEAA',url:'https://www.pheaa.org/funding-opportunities/grow-pa-scholarship-grant-program',state:'Pennsylvania',levels:['Undergraduate'],tags:['education','tuition','workforce','training'],description:'State scholarship grant tied to eligible study programs and Pennsylvania workforce commitments.',requirements:['Eligible program and post-graduation work obligations apply.','Review service and repayment terms and the current application cycle with PHEAA.'],marker:/Grow PA/i},
 {id:'wa-college',title:'Washington College Grant',funder:'Washington Student Achievement Council',url:'https://wsac.wa.gov/wcg-awards',state:'Washington',levels:['Undergraduate','Vocational / certificate'],tags:['education','tuition','training','apprenticeship'],description:'Washington need-based education support for eligible college, training, and apprenticeship pathways.',requirements:['Residency, financial need, participating provider, and program eligibility apply.','Confirm current year award limits and school or apprenticeship deadlines.'],marker:/Washington College Grant|WA Grant/i}
];
export function relevantPrograms(profiles:Profile[]){return aidPrograms.filter(program=>profiles.some(p=>p.type==='Student'&&countryName(p.country)==='United States'&&(!program.state||stateName(p.state)===program.state)));}
export function checkedProgram(program:Program,html:string,now:string):Grant {
 const text=clean(html),contentVerified=program.marker.test(text);const shell=/enable JavaScript|<app-root|<noscript/i.test(html)&&!contentVerified;
 return {id:program.id,title:program.title,funder:program.funder,description:program.description,types:['Student'],countries:['United States'],states:program.state?[program.state]:[],studyLevels:program.levels,tags:program.tags,amount:null,deadline:null,deadlineLabel:'Academic year and school deadlines vary',url:program.url,source:program.funder,sourceUrl:program.url,requirements:[...program.requirements,...(shell||!contentVerified?['The official page was reachable, but its program content requires browser review. Automated rules verification is unavailable.']:['Official program page retrieved; awards and eligibility still require provider confirmation.'])],checked:now,discovered:now,kind:'Student aid',live:contentVerified,status:'Verify academic year',sourceMode:contentVerified?'Official program page':'Link check only'};
}

// ---------- Weekly federal aid checks ----------
// Federal Student Aid pages (Pell, FSEOG, TEACH Grant) change rarely, and studentaid.gov refuses, resets or times
// out automated requests from our honest ICanGetGrants/1.2 user agent. We do not disguise the user agent. Instead:
// - Weekly cadence: a studentaid.gov page is skipped while its last ATTEMPT is under 7 days old. Attempts are
//   successful checks and refused checks (refused, reset, timed out, HTTP 403/429, or any HTTP 5xx such as
//   Cloudflare's 520), so a site that refuses us is asked at most once a week. Any other error (HTTP 404, a page
//   that needs a browser, a changed page) is not recorded as an attempt, so it is retried on the next run and keeps
//   the source failed until fixed.
// - A refused check is a health warning, not a failure: overall health stays ok and the warning is listed apart.
// - The listing is never retired or hidden by a failed or skipped check: the stored row (with its studentaid.gov
//   link) is left as it is, or a link-only record is stored when there is no row yet.
export const WEEKLY_CHECK_DAYS=7;
export const PROGRAM_CHECKS_JOB='program-checks';
export const weeklyProgram=(p:{url:string})=>{try{return /(?:^|\.)studentaid\.gov$/i.test(new URL(p.url).hostname);}catch{return false;}};
export type ProgramCheck={lastAttempt:string;lastSuccess?:string;lastError?:string};
export function programCheckDue(state:ProgramCheck|undefined,now:string){if(!state)return true;const last=Date.parse(state.lastAttempt);return !Number.isFinite(last)||Date.parse(now)-last>=WEEKLY_CHECK_DAYS*DAY_MS;}
const nextCheck=(state:ProgramCheck)=>formatDay(new Date(Date.parse(state.lastAttempt)+WEEKLY_CHECK_DAYS*DAY_MS).toISOString().slice(0,10));
const refusedWarning=(program:Program,state:ProgramCheck)=>`${program.title}: ${new URL(program.url).hostname} ${state.lastError} on ${formatDay(state.lastAttempt.slice(0,10))}. Listing kept; next check after ${nextCheck(state)}.`;
/** Link-only record for a program page that could not be checked and has no stored row yet. */
export function uncheckedProgram(program:Program,now:string):Grant{const g=checkedProgram(program,'',now);return {...g,requirements:[...program.requirements,'The official page could not be checked automatically; confirm current rules and deadlines on the official page.'],live:false,sourceMode:'Link check only'};}
export type ProgramCheckResult={records:Grant[];kept:number;queries:number;deferred:number;linkOnly:boolean;warnings:string[];errors:string[];skipped:string[];checks:Record<string,ProgramCheck>};
export async function checkOfficialPrograms(o:{programs:Program[];fetchHtml:(url:string)=>Promise<string>;existing:Map<string,Grant>;checks:Record<string,ProgramCheck>;now:string;isBudgetError:(e:unknown)=>boolean;concurrency?:number}):Promise<ProgramCheckResult>{
 const r:ProgramCheckResult={records:[],kept:0,queries:0,deferred:0,linkOnly:false,warnings:[],errors:[],skipped:[],checks:{...o.checks}};
 const keep=(program:Program)=>{if(o.existing.has(program.id))r.kept++;else r.records.push(uncheckedProgram(program,o.now));};
 const one=async(program:Program)=>{
  const weekly=weeklyProgram(program),state=r.checks[program.id];
  if(weekly&&!programCheckDue(state,o.now)){keep(program);r.skipped.push(program.title);if(state!.lastError)r.warnings.push(refusedWarning(program,state!));return;}
  try{const html=await o.fetchHtml(program.url);r.queries++;const g=checkedProgram(program,html,o.now);r.records.push(g);if(!g.live)r.linkOnly=true;if(weekly)r.checks[program.id]={lastAttempt:o.now,lastSuccess:o.now};}
  catch(e){if(o.isBudgetError(e)){r.deferred++;keep(program);return;}r.queries++;const kind=weekly?refusalKind(e):null;keep(program);
   if(kind){const next={lastAttempt:o.now,lastSuccess:state?.lastSuccess,lastError:kind};r.checks[program.id]=next;r.warnings.push(refusedWarning(program,next));console.warn('official program check refused',program.id,kind);}
   else r.errors.push(program.title+': '+String((e as Error)?.message||e).slice(0,200));}
 };
 const n=o.concurrency||3;for(let i=0;i<o.programs.length;i+=n)await Promise.all(o.programs.slice(i,i+n).map(one));
 return r;
}
