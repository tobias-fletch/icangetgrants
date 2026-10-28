import { match, isOpenOpportunity, missingInboxFields, profileMatches } from './grants';
import { easternDay } from './source-parsers';
import type { Grant, Profile } from './grants';
export function inboxMatches(grants:Grant[],profiles:Profile[],seen:string,now=new Date().toISOString()){
 const monitored=profiles.filter(p=>p.alerts);
 const today=easternDay(now);
 return grants.filter(g=>g.status!=='Closed'&&(!g.deadline||g.deadline>=today)&&!missingInboxFields(g).length&&g.discovered.includes('T')&&Number.isFinite(Date.parse(g.discovered))&&(!seen||Date.parse(g.discovered)>Date.parse(seen))).map(g=>{const fits=monitored.map(p=>({p,...match(g,p)})).filter(f=>f.score>0).sort((a,b)=>b.score-a.score);return {g,fit:fits[0],profiles:fits};}).filter(x=>!!x.fit).sort((a,b)=>Date.parse(b.g.discovered)-Date.parse(a.g.discovered));
}
export function reviewedThrough(items:{g:Grant}[],prior=''){return items.reduce((latest,x)=>!latest||Date.parse(x.g.discovered)>Date.parse(latest)?x.g.discovered:latest,prior);}
export const UPCOMING_DEFAULT_DAYS=30,UPCOMING_MAX_DAYS=90,UPCOMING_ITEM_LIMIT=100;
// Open records matched to any alert-enabled profile with a fixed deadline from today through today+days, soonest first.
export function upcomingDeadlines(grants:Grant[],profiles:Profile[],days?:unknown,now:string|Date=new Date()){
 const requested=typeof days==='string'&&days.trim()?Number(days):days;const window=Math.min(UPCOMING_MAX_DAYS,Math.max(1,Math.floor(typeof requested==='number'&&Number.isFinite(requested)?requested:UPCOMING_DEFAULT_DAYS)));
 const today=easternDay(now),start=Date.parse(today+'T00:00:00Z'),end=new Date(start+window*86400000).toISOString().slice(0,10);
 const items=grants.filter(g=>!g.duplicateOf&&typeof g.deadline==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(g.deadline)&&g.deadline>=today&&g.deadline<=end&&isOpenOpportunity(g,today)).map(g=>({g,fits:profileMatches(g,profiles)})).filter(x=>x.fits.length).map(({g,fits})=>({title:g.title,url:g.url,funder:g.funder,deadline:g.deadline as string,daysLeft:Math.round((Date.parse(g.deadline+'T00:00:00Z')-start)/86400000),profile:fits[0].profile,profileId:fits[0].profileId,score:fits[0].score,matches:fits})).sort((a,b)=>a.deadline.localeCompare(b.deadline)||b.score-a.score||a.title.localeCompare(b.title));
 return {days:window,asOf:today,total:items.length,items:items.slice(0,UPCOMING_ITEM_LIMIT)};
}
