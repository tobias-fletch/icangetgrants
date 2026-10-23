import type { Grant } from './grants';
import { isBudgetError } from './fetch-budget';
import type { StateSource, StateCategory } from './state-registry';
import { clean, safeUrl, explicitDate } from './source-parsers';
export type StateReport={code:string;state:string;category:StateCategory;status:string;checkedAt:string;url:string;records:number;queries:number;directories:number;error?:string;note:string};
const TRACKING_PARAM=/^(?:utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|ref|ref_src)$/i;
// Dedupe key for a lead URL: scheme and leading www. ignored, lowercase host, no fragment, no tracking params,
// remaining query params sorted, no trailing slash. Returns '' for non-http(s) or invalid URLs.
export function normalizeLeadUrl(value:string){
 try{const u=new URL(String(value||'').trim());if(u.protocol!=='http:'&&u.protocol!=='https:')return '';
  const host=u.hostname.toLowerCase().replace(/\.$/,'').replace(/^www\./,'');const port=u.port&&!['80','443'].includes(u.port)?':'+u.port:'';
  const params=[...u.searchParams.entries()].filter(([k])=>!TRACKING_PARAM.test(k)).sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
  const query=params.length?'?'+new URLSearchParams(params).toString():'';const path=u.pathname.replace(/\/+$/,'');
  return host+port+path+query;}catch{return '';}
}
// Leads (state scans, state research, U.S. Chamber guide) dedupe by normalized URL so reworded titles update one record.
// Exception: headings scanned from a single page all share that page URL, so they also key on the heading title.
export function leadKey(g:Pick<Grant,'id'|'url'|'title'|'sourceUrl'|'sourceMode'>){
 if(!/^(?:state|chamber)-/.test(g.id))return '';const url=normalizeLeadUrl(g.url);if(!url)return '';
 if(g.sourceMode==='State-source program lead'&&url===normalizeLeadUrl(g.sourceUrl||''))return url+'|'+g.title.toLowerCase().replace(/\s+/g,' ').trim();
 return url;
}
export function administrativeTitle(title:string){return /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(title)||/\b(?:memo|allocations?|reporting|handbook|manual|regulations?|administrators?|webinars?|applications?|Perkins|institutional|budget|calendar|guidance|advisor|forms?|processing|rule changes|grant initiatives division|notice of funding|return of funds|financial aid office|financial aid counselor)\b/i.test(title);}
export function pageContent(html:string){const raw=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html;return raw.replace(/<(?:nav|header|footer|script|style)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer|script|style)>/gi,' ');}
export function fundingHub(title:string){return /^(?:all\s+)?(?:grants?|scholarships?|funding|financial aid|financial assistance|incentives|state aid|programs?)(?:\s+(?:and|&|or)\s+(?:grants?|scholarships?|funding|financial aid|incentives|programs?))?(?:\s+(?:programs?|opportunities|resources|information|overview|available|options|for students|for businesses))?[.!]?$/i.test(title)||/^(?:apply for|find|search|explore|view|browse|learn about|types of|available|business|state|student)\s+(?:all\s+)?(?:grants?|scholarships?|funding|financial aid|incentives)(?:\s|$)/i.test(title)||/grants?\s+(?:and|&)\s+(?:loans?|incentives|scholarships)|funding opportunities|grant opportunities|program (?:directory|finder|lookup)|scholarship (?:directory|finder|search)/i.test(title);}
export function extractStateLinks(html:string,pageUrl:string,category:StateCategory){
 const navigation=[...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)].map(m=>m[0]).join(' ');const main=pageContent(html),content=main+' <!--state-navigation--> '+navigation,navStart=main.length,links=new Map<string,{url:string;title:string;context:string;hub:boolean}>();
 for(const m of content.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const title=clean(m[2].match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]||m[2]).replace(/^-->\s*/,'');if(title.length<4||title.length>180||administrativeTitle(title))continue;const url=safeUrl(clean(m[1]),pageUrl);if(!url)continue;const parsed=new URL(url);parsed.hash='';for(const key of [...parsed.searchParams.keys()])if(/^utm_|^ref$|^fbclid$/i.test(key))parsed.searchParams.delete(key);
  const mixedLoanHub=/\bloans?\b/i.test(title)&&/\bgrants?\b/i.test(title);
  if((!mixedLoanHub&&/\b(?:loan|loans|tax credit|tax credits|procurement|contracting|bond|venture capital|investment fund|RFP archive|recipients|awardees|award winners|press release|annual report|grant writing|grant management|login|sign in|Federal Pell|FSEOG|TEACH Grant|memo|allocations?|reporting|handbook|manual|regulations?|administrators?|webinars?|advisory committee|applications?)\b/i.test(title))||/\b(?:studentaid|sba|grants)\.gov$/i.test(parsed.hostname))continue;
  if(/\/(?:news|newsroom|press|archives?|wp-content\/uploads\/20(?:0\d|1\d|2[0-4]))\//i.test(parsed.pathname)||/\/20(?:[01]\d|2[0-4])\//.test(parsed.pathname))continue;
  const resourceLink=category==='business'?/funding|financing|financial assistance|incentives|small business|access to capital/i.test(title):category==='arts'?/funding|opportunities|grants and programs|for artists|artist resources/i.test(title):/financial aid|paying for college|student financial assistance|state aid|college costs/i.test(title);
  const relevant=category==='business'?/\b(?:grant|grants|STEP|SBIR|STTR)\b/i.test(title):category==='arts'?/\b(?:grant|grants|fellowship|fellowships|residenc(?:y|ies)|artist awards?)\b/i.test(title):/\b(?:grant|grants|scholarship|scholarships|tuition assistance|promise|HOPE|TAP|KEES|financial aid)\b/i.test(title);if(!relevant&&!resourceLink)continue;
  // Keep crawl requests on the selected public source. Cross-domain program
  // links may be shown as leads, but are never fetched by the crawler.
  const context=clean(content.slice(Math.max(0,(m.index||0)-180),Math.min(content.length,(m.index||0)+m[0].length+400)));
  if(category==='business'&&/\b(?:municipalit|county governments?|local governments?|public agencies|nonprofit organizations only|community development block)\b/i.test(title+' '+context)&&!/small business|entrepreneur|businesses may apply/i.test(title+' '+context))continue;
  const hub=fundingHub(title)||mixedLoanHub||!relevant||(m.index||0)>navStart;const previous=links.get(parsed.href);if(!previous||previous.hub)links.set(parsed.href,{url:parsed.href,title,context,hub});
 }
 return [...links.values()];
}
const CATEGORY_LABELS:Record<StateCategory,{funder:string;noun:string;source:string;types:string[];tag:string}>={
 business:{funder:'business funding source',noun:'business grant',source:'Business grants',types:['Small business','Freelancer','Nonprofit'],tag:'business'},
 aid:{funder:'student aid source',noun:'student funding',source:'Student aid',types:['Student'],tag:'education'},
 arts:{funder:'arts agency source',noun:'arts grant or fellowship',source:'Arts grants',types:['Individual','Freelancer'],tag:'arts'}
};
// city is set for leads from a city registry task: labels name the city and the record carries cities:[city].
export function stateRecord(source:StateSource,category:StateCategory,link:{url:string;title:string;context:string},sourceUrl:string,now:string,city?:{city:string}):Grant {
 const label=CATEGORY_LABELS[category],place=city?`${city.city}, ${source.state}`:source.state;
 let hash=2166136261;for(const c of link.url+'|'+link.title.toLowerCase()){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}const title=link.title;
 const topics=['education','technology','equipment','training','marketing','manufacturing','rural','arts','agriculture','export','research','innovation','tuition','nursing','teaching','workforce'].filter(t=>new RegExp('\\b'+t+'\\b','i').test(title+' '+link.context));
 return {id:`state-${source.code.toLowerCase()}-${category}-${(hash>>>0).toString(16)}`,title,funder:`${city?city.city:source.state} ${label.funder}`,description:`Potential ${place} ${label.noun} program found on an official agency or designated partner page. ${topics.length?'Themes: '+topics.join(', ')+'. ':''}Confirm the current cycle, applicant eligibility, and location or institution requirements with the provider.`,types:[...label.types],countries:['United States'],states:[source.state],...(city?{cities:[city.city]}:{}),tags:[label.tag,...topics],amount:null,deadline:null,deadlineLabel:'Current cycle requires provider confirmation',url:link.url,source:`${place} · ${label.source}`,sourceUrl,requirements:['Source-listed program lead; applicant eligibility and current availability are unverified.','Confirm residency, business ownership or school enrollment, permitted expenses, and any matching funds.','State programs can have city/county, institution, industry, income, or other restrictions.'],checked:now,discovered:now,kind:category!=='aid'?'State grant':/scholarship|promise|HOPE|KEES/i.test(title)?'Scholarship':'Student aid',live:true,status:'Verify eligibility/cycle',sourceMode:'State-source program lead',eligibilityVerified:false};
}
// fetchPage may throw FetchBudgetError: before the first page the route is returned as deferred (nothing saved), and
// during linked-directory fetches the scan stops cleanly with what it already has.
export async function scanState(source:StateSource,category:StateCategory,fetchPage:(url:string)=>Promise<string>,now:string):Promise<{records:Grant[];report:StateReport;deferred?:boolean}>{
 const config=source[category],report:StateReport={code:source.code,state:source.state,category,status:'Not checked',checkedAt:now,url:config.url,records:0,queries:0,directories:0,note:'Official agency and designated-partner listings. Program leads are not confirmed open awards.'};
 let html='',pageUrl='',error='';const visited=new Set<string>();const budget=3;
 for(const url of [...new Set([config.url,config.fallback])]){if(report.queries>=budget)break;try{report.queries++;const body=await fetchPage(url);const title=clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');if(/404|page not found|access denied|just a moment|human verification|request rejected/i.test(title))throw new Error('Source requires browser review');html=body;pageUrl=url;visited.add(url);break;}catch(e){if(isBudgetError(e)){report.queries--;report.status='Deferred';report.note='Run fetch budget reached before this route was fetched; it is first in line for the next run.';return {records:[],report,deferred:true};}error=(e as Error).message;}}
 const records=new Map<string,Grant>();if(!html){report.status='Browser review';report.error=error||'Source unavailable';return {records:[],report};}
 report.url=pageUrl;report.status='Checked';
 const initial=extractStateLinks(html,pageUrl,category);const pages=[{html,url:pageUrl}];const origin=new URL(pageUrl).origin;
 const hubs=initial.filter(l=>l.hub&&new URL(l.url).origin===origin&&!/\.pdf(?:\?|$)/i.test(l.url)).slice(0,2);
 for(const hub of hubs){if(report.queries>=budget||visited.has(hub.url))continue;try{report.queries++;visited.add(hub.url);pages.push({html:await fetchPage(hub.url),url:hub.url});}catch(e){if(isBudgetError(e)){report.queries--;report.note+=' Run fetch budget reached; linked directories were not fetched.';break;}report.note+=' A linked funding directory could not be fetched.';}}
 for(const page of pages){for(const link of extractStateLinks(page.html,page.url,category)){if(link.hub){report.directories++;continue;}const g=stateRecord(source,category,link,page.url,now);records.set(g.id,g);}
  const headings=[...pageContent(page.html).matchAll(category!=='business'?/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi:/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];for(const h of headings){const heading=clean(h[1]);if(heading.length>4&&heading.length<150&&/\b(?:grant|scholarship|fellowship|residency)\b/i.test(heading)&&!fundingHub(heading)&&!administrativeTitle(heading)&&!/Federal Pell|FSEOG|TEACH Grant/i.test(heading)){const g=stateRecord(source,category,{url:page.url,title:heading,context:clean(pageContent(page.html)).slice(0,1500)},page.url,now);records.set(g.id,g);}}
 }
 const distinct=[...new Map([...records.values()].map(g=>[g.title.toLowerCase().replace(/\s+/g,' ').trim(),g])).values()].slice(0,60);report.records=distinct.length;report.status=distinct.length?'Program leads found':'Directory checked';if(!distinct.length)report.note+=' No distinct program leads parsed; use the source link or scheduled research. Directories are not counted as grants.';
 return {records:distinct,report};
}
