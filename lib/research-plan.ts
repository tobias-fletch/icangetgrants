import { statePlan, stateSources } from './state-registry';
import type { StateCategory } from './state-registry';
import { citySources, cityHosts, CITY_REVISIT_DAYS } from './city-registry';
import type { CitySource, CityCategory } from './city-registry';
import { countryName, stateName } from './source-parsers';
import type { Profile } from './grants';
export const RESEARCH_LIMIT_DEFAULT=5,RESEARCH_LIMIT_MAX=20,STATE_REVISIT_DAYS=1;
const DAY=24*3600000;
export function researchLimit(value:unknown){return typeof value==='number'&&Number.isInteger(value)&&value>=1?Math.min(RESEARCH_LIMIT_MAX,value):RESEARCH_LIMIT_DEFAULT;}
export function stateResearchKey(code:string,category:string){return 'research-'+code+'-'+category;}
export function cityResearchKey(cityId:string,category:string){return 'research-city-'+cityId+'-'+category;}
type Stored={checkedAt?:string;status?:string;records?:number};
export type ResearchInput={profiles:Profile[];reports:Map<string,Stored>;research:Map<string,Stored>;now?:number;limit?:unknown};
function inState(p:Profile,code:string,state:string){return countryName(p.country)==='United States'&&(stateName(p.state)===state||String(p.state||'').toUpperCase()===code);}
function inCity(p:Profile,city:CitySource,state:string){return inState(p,city.stateCode,state)&&!!p.city&&p.city.trim().toLowerCase()===city.city.toLowerCase();}
function keywords(list:Profile[]){return [...new Set(list.flatMap(p=>String(p.keywords||'').split(',').map(x=>x.trim()).filter(Boolean)))].slice(0,8);}
function cityCategories(city:CitySource,people:Profile[]):CityCategory[]{
 const all=(Object.keys(city.sources) as CityCategory[]).filter(c=>city.sources[c]);if(city.wave===1)return all;
 return all.filter(c=>people.some(p=>c==='business'?['Small business','Freelancer','Nonprofit'].includes(p.type):['Individual','Freelancer'].includes(p.type)));
}
const STATE_QUERY:Record<StateCategory,string>={business:'small business grant programs',aid:'state scholarships student aid grants',arts:'state arts council grants and fellowships for individual artists'};
const CITY_QUERY:Record<CityCategory,string>={business:'city small business grant programs',arts:'city arts and culture grants for artists'};
// Rotation: a task is due when never researched or when lastResearch + revisitDays has passed (states daily,
// Wave 1 cities every 7 days, Wave 2 every 14, Wave 3 every 30). Due tasks are ranked by priority, then by the
// oldest nextDueAt, and the top `limit` (default 5, max 20) are returned; the rest wait for a later run.
// Priority: base 50 for a profiled state, 40 for a profiled city, 20 for an unprofiled Wave 1 city; +15 never
// researched; +10 when the automatic scan found no program leads or was blocked; up to +15 for being overdue
// (5 per revisit interval); up to +10 for profiles in that geography.
export function planResearchTasks({profiles,reports,research,now=Date.now(),limit}:ResearchInput){
 const max=researchLimit(limit),candidates:any[]=[];
 const score=(base:number,last:string|null,days:number,needs:boolean,people:number)=>{const lastMs=last?Date.parse(last):NaN;const overdue=Number.isFinite(lastMs)?Math.max(0,(now-lastMs-days*DAY)/(days*DAY)):0;return base+(last?0:15)+(needs?10:0)+Math.min(3,overdue)*5+Math.min(10,people);};
 const due=(last:string|null,days:number)=>{const lastMs=last?Date.parse(last):NaN;const next=Number.isFinite(lastMs)?lastMs+days*DAY:null;return {nextDueAt:next===null?null:new Date(next).toISOString(),due:next===null||next<=now};};
 for(const t of statePlan(profiles)){
  const report=reports.get('state-'+t.source.code+'-'+t.category),last=research.get(stateResearchKey(t.source.code,t.category))?.checkedAt||null;const people=profiles.filter(p=>inState(p,t.source.code,t.source.state));
  const needsResearch=!report?.records||report?.status==='Browser review';const timing=due(last,STATE_REVISIT_DAYS);
  candidates.push({scope:'state',taskId:'state-'+t.source.code+'-'+t.category,state:t.source.state,code:t.source.code,category:t.category,source:t.source[t.category].url,fallback:t.source[t.category].fallback,localHosts:t.source.localHosts,sourceStatus:report?.status||'Not checked',lastResearch:last,interests:keywords(people),query:`${t.source.state} ${STATE_QUERY[t.category]} current application eligibility`,needsResearch,revisitDays:STATE_REVISIT_DAYS,...timing,priority:score(50,last,STATE_REVISIT_DAYS,needsResearch,people.length)});
 }
 const pendingCities:{cityId:string;city:string;state:string;note?:string}[]=[];
 for(const city of citySources){
  const state=stateSources.find(s=>s.code===city.stateCode);if(!state)continue;const people=profiles.filter(p=>inCity(p,city,state.state));
  if(city.wave!==1&&!people.length)continue;
  if(city.status!=='verified'||!cityHosts(city).length){pendingCities.push({cityId:city.id,city:city.city,state:state.state,note:city.note});continue;}
  const days=CITY_REVISIT_DAYS[city.wave],statePeople=profiles.filter(p=>inState(p,city.stateCode,state.state));
  for(const category of cityCategories(city,people)){
   const last=research.get(cityResearchKey(city.id,category))?.checkedAt||null;const timing=due(last,days);
   candidates.push({scope:'city',taskId:'city-'+city.id+'-'+category,cityId:city.id,city:city.city,rank:city.rank,wave:city.wave,state:state.state,code:state.code,category,source:city.sources[category],fallback:city.sources[category],localHosts:cityHosts(city),partnerHosts:city.partnerHosts,sourceStatus:'Research only',lastResearch:last,interests:keywords(people.length?people:statePeople),query:`${city.city} ${state.state} ${CITY_QUERY[category]} current application eligibility`,needsResearch:true,revisitDays:days,...timing,priority:score(people.length?40:20,last,days,true,people.length)});
  }
 }
 const dueTasks=candidates.filter(t=>t.due).sort((a,b)=>b.priority-a.priority||(a.scope===b.scope?0:a.scope==='state'?-1:1)||String(a.nextDueAt||'').localeCompare(String(b.nextDueAt||''))||a.taskId.localeCompare(b.taskId));
 const tasks=dueTasks.slice(0,max).map(({due,...t})=>t);
 return {tasks,limit:max,totalDue:dueTasks.length,deferred:dueTasks.length-tasks.length,upcoming:candidates.filter(t=>!t.due).length,pendingCities};
}
