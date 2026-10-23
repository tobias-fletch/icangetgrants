export type Profile = { id:string; name:string; type:string; country:string; state:string; keywords:string; goal:number; education:string; details:string; alerts:boolean; city?:string };
import { countryName, stateName, tidyDeadlineLabel } from './source-parsers';
export type Grant = { id:string; title:string; funder:string; description:string; types:string[]; countries:string[]; tags:string[]; amount:number|null; deadline:string|null; url:string; source:string; requirements:string[]; checked:string; discovered:string; kind:string; live:boolean; applicantCodes?:string[]; states?:string[]; studyLevels?:string[]; deadlineLabel?:string; status?:string; sourceUrl?:string; sourceUpdated?:string; attribution?:string; sourceMode?:string; eligibilityVerified?:boolean; cities?:string[] };
export type Saved = { profileId:string; grantId:string; status:string; notes:string };
export type Workspace = { profiles:Profile[]; saved:Saved[]; seen:string };
export const empty:Workspace = {profiles:[], saved:[], seen:''};
export const seeds:Grant[] = [
 {id:'awesome',title:'Awesome Foundation microgrants',funder:'The Awesome Foundation',description:'Small grants for projects that make a community more awesome. Apply through a relevant local or topic chapter.',types:['Individual','Freelancer','Small business','Student'],countries:['Worldwide'],tags:['community','arts','education','creative'],amount:1000,deadline:null,url:'https://www.awesomefoundation.org/en',source:'Awesome Foundation',requirements:['Chapter-specific location and project rules apply.','Deadlines and active funding vary by chapter.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Microgrant',live:false},
 {id:'nase',title:'NASE Growth Grants',funder:'National Association for the Self-Employed',description:'Business growth funding for marketing, equipment, hiring, training, and other expansion needs.',types:['Freelancer','Small business'],countries:['United States'],tags:['business','equipment','marketing','training','technology'],amount:4000,deadline:null,url:'https://www.nase.org/become-a-member/member-benefits/business-resources/growth-grants',source:'NASE',requirements:['Eligible paid NASE membership is required; some monthly members must wait 90 days.','Funds cannot pay existing debt or rent/mortgage.','Confirm current award cycle and membership terms.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Business grant',live:false},
 {id:'amber',title:'WomensNet Amber Grant',funder:'WomensNet',description:'Monthly awards for women-owned businesses, with additional startup, category, and annual award opportunities.',types:['Freelancer','Small business'],countries:['United States','Canada'],tags:['business','startup','equipment','creative'],amount:15000,deadline:'2026-10-31',url:'https://ambergrantsforwomen.com/get-an-amber-grant/',source:'WomensNet',requirements:['Women-owned business eligibility must be confirmed.','An application fee applies; check the provider for the amount and waiver options.','Confirm residency, ownership rules, and the current monthly deadline.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Business grant',live:false},
 {id:'pell',title:'Federal Pell Grant',funder:'Federal Student Aid',description:'Need-based education funding for eligible undergraduate students. Apply through the FAFSA and your school, rather than a business grant application.',types:['Student'],countries:['United States'],tags:['education','tuition','college','training'],amount:null,deadline:null,url:'https://studentaid.gov/understand-aid/types/grants/pell',source:'Federal Student Aid',requirements:['Financial need, eligible citizenship status, and enrollment rules apply.','Usually for undergraduates who have not earned a bachelor’s or professional degree.','Award limits and FAFSA deadlines depend on the award year and school.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Student aid',live:false}
];
export function match(g:Grant,p:Profile) {
 const reasons:string[]=[]; const gaps=[...g.requirements];
 if(!g.types.includes(p.type)) return {score:0,reasons:['Applicant type does not match'],gaps};
 const country=countryName(p.country),state=stateName(p.state);
 if(country && !g.countries.includes('Worldwide') && !g.countries.includes('Unspecified') && !g.countries.includes(country)) return {score:0,reasons:['Country does not match'],gaps};
 if(g.states?.length && (!state||!g.states.some(s=>stateName(s)===state)))return {score:0,reasons:['State or region does not match the source scope'],gaps};
 if(g.studyLevels?.length&&p.education&&!g.studyLevels.includes(p.education))return {score:0,reasons:['Study level does not match'],gaps};
 if(g.status==='Closed')return {score:0,reasons:['Applications closed'],gaps};
 let score=g.eligibilityVerified===false?25:40; reasons.push(g.eligibilityVerified===false?'Potential '+p.type.toLowerCase()+' lead; applicant rules need checking':p.type+' applicant category aligns');
 if(country&&!g.countries.includes('Unspecified')){score+=15;reasons.push(g.countries.includes('Worldwide')?'International chapter network':'Country is within the source coverage');} else gaps.push('Geographic eligibility must be confirmed with the provider.');
 if(g.states?.length){score+=5;reasons.push('Found in '+state+' source coverage');}
 if(g.studyLevels?.includes(p.education)){score+=5;reasons.push('Study level aligns');}
 const words=p.keywords.toLowerCase().split(/[,\s]+/).filter(w=>w.length>2);
 const hay=(g.title+' '+g.description+' '+g.tags.join(' ')).toLowerCase();
 const hits=words.filter(w=>new RegExp('(?:^|[^a-z0-9])'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:s|al|ing)?(?=$|[^a-z0-9])','i').test(hay));
 if(!hits.length&&['Federal grant','State grant','Fellowship','Award / competition'].includes(g.kind))return {score:0,reasons:['No project or field alignment found'],gaps};
 if(hits.length){score+=Math.min(25,hits.length*10);reasons.push('Relevant to '+hits.slice(0,3).join(', '));}else gaps.push('Project or field alignment needs review.');
 if(p.goal && g.amount && g.amount>=p.goal){score+=10;reasons.push('Published maximum covers your funding goal');}
 if(!p.state) gaps.push('State and local restrictions have not been checked.');
 if(g.kind==='Federal grant') gaps.push('Federal category match is preliminary; review the full notice for location, project, and other restrictions.');
 if(g.deadlineLabel&&!g.deadline)gaps.push('Published window: '+tidyDeadlineLabel(g.deadlineLabel)+'. No exact year-specific deadline is confirmed.');
 if(g.deadline && new Date(g.deadline+'T23:59:59Z')<new Date()) return {score:0,reasons:['Deadline has passed'],gaps};
 return {score:Math.min(g.eligibilityVerified===false?65:90,score),reasons,gaps};
}
export const NEW_ITEM_LIMIT=25;
// Closed records may be stored, but they are never reported as new or as matches.
export function isOpenOpportunity(g:Pick<Grant,'deadline'|'status'>,now:string|Date=new Date()){
 const today=(typeof now==='string'?now:now.toISOString()).slice(0,10);
 if(/\bclosed\b/i.test(g.status||''))return false;
 return !g.deadline||g.deadline>=today;
}
// Profiles watched by discovery, research planning and coverage: every U.S. profile, plus any alert-enabled profile
// elsewhere so nothing that was monitored before drops out. Alerts only decide who is notified (profileMatches).
export function monitoredProfiles(profiles:Profile[]){return (profiles||[]).filter(p=>p&&(p.alerts||countryName(p.country)==='United States'));}
export type ProfileMatch={profileId:string;profile:string;type:string;score:number};
export function profileMatches(g:Grant,profiles:Profile[]):ProfileMatch[]{
 return profiles.filter(p=>p.alerts).map(p=>({profileId:p.id,profile:p.name,type:p.type,score:match(g,p).score})).filter(m=>m.score>0).sort((a,b)=>b.score-a.score);
}
export type NewOpportunityItem={title:string;url:string;funder:string;deadline:string|null;matched:boolean;matches:ProfileMatch[]};
// matchedIds may be a list of matched IDs or a map of ID -> profile matches (best score first).
export function newOpportunityItems(grants:Pick<Grant,'id'|'title'|'url'|'funder'|'deadline'>[],matchedIds:Iterable<string>|Map<string,ProfileMatch[]>=[],limit=NEW_ITEM_LIMIT){
 const details=matchedIds instanceof Map?matchedIds:new Map([...matchedIds].map(id=>[id,[] as ProfileMatch[]]));
 const isMatched=(id:string)=>details.has(id)&&(!(matchedIds instanceof Map)||(details.get(id)||[]).length>0);
 const best=(id:string)=>details.get(id)?.[0]?.score||0;
 const ordered=[...grants.filter(g=>isMatched(g.id)).sort((a,b)=>best(b.id)-best(a.id)),...grants.filter(g=>!isMatched(g.id))];
 const items:NewOpportunityItem[]=ordered.map(g=>({title:g.title,url:g.url,funder:g.funder,deadline:g.deadline||null,matched:isMatched(g.id),matches:isMatched(g.id)?details.get(g.id)||[]:[]}));
 return {newItems:items.slice(0,limit),newItemsTotal:items.length};
}
export const profileMatchSchema={type:'object',additionalProperties:false,required:['profileId','profile','type','score'],properties:{profileId:{type:'string'},profile:{type:'string',description:'Monitored profile name.'},type:{type:'string'},score:{type:'number',description:'Match score (higher is better).'}}};
export const newOpportunityItemSchema={type:'object',additionalProperties:false,required:['title','url','funder','deadline','matched','matches'],properties:{title:{type:'string'},url:{type:'string'},funder:{type:'string'},deadline:{type:['string','null'],description:'Source-published date, or null when unknown.'},matched:{type:'boolean',description:'True when at least one alert-enabled profile matches.'},matches:{type:'array',description:'Matched profiles with scores, best first. Empty when unmatched.',items:profileMatchSchema}}};
export const newItemsSchemaProperties={
 newItems:{type:'array',maxItems:NEW_ITEM_LIMIT,description:`Newly discovered or newly persisted open opportunities (closed or past-deadline records are never listed). Profile matches come first. Each item is title, url, funder, deadline (null when unknown), matched, and matches (profile, profileId, type, score). At most ${NEW_ITEM_LIMIT} items.`,items:newOpportunityItemSchema},
 newItemsTotal:{type:'number',minimum:0,description:'Uncapped number of those new open opportunities. Existing count and ID fields are unchanged.'}
};
