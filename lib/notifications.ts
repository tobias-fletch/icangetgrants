import { match } from './grants';
import type { Grant, Profile } from './grants';
export function inboxMatches(grants:Grant[],profiles:Profile[],seen:string,now=new Date().toISOString()){
 const monitored=profiles.filter(p=>p.alerts);
 return grants.filter(g=>g.status!=='Closed'&&(!g.deadline||g.deadline>=now.slice(0,10))&&g.discovered.includes('T')&&Number.isFinite(Date.parse(g.discovered))&&(!seen||Date.parse(g.discovered)>Date.parse(seen))).map(g=>{const fits=monitored.map(p=>({p,...match(g,p)})).filter(f=>f.score>0).sort((a,b)=>b.score-a.score);return {g,fit:fits[0],profiles:fits};}).filter(x=>!!x.fit).sort((a,b)=>Date.parse(b.g.discovered)-Date.parse(a.g.discovered));
}
export function reviewedThrough(items:{g:Grant}[],prior=''){return items.reduce((latest,x)=>!latest||Date.parse(x.g.discovered)>Date.parse(latest)?x.g.discovered:latest,prior);}
