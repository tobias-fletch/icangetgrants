// Per-run outside-fetch budget for refresh_grants. Cloudflare Workers Free allows 50 subrequests per invocation and
// counts every hop of a redirect chain, so redirects are followed manually here and every hop is charged.
// RUN_FETCH_LIMIT leaves 5 subrequests of headroom under 50. Each fixed source has a hard cap; the automatic
// state/arts page scans run after the fixed sources and get whatever is left (at least PAGE_SCAN_MIN_FETCHES in the
// worst case, because the fixed caps sum to RUN_FETCH_LIMIT - PAGE_SCAN_MIN_FETCHES).
export const RUN_FETCH_LIMIT=45;
// grantsGovSweep: three profile-independent search2 calls (individual, business, nonprofit eligibility), posted and
// forecasted. waFundHub: up to three 100-record pages. poetsWriters: two 100-listing pages.
export const SOURCE_FETCH_CAPS={grantsGovSweep:3,grantsGovDetail:8,careerOneStop:6,california:2,waFundHub:3,poetsWriters:2,chamber:1,studentAid:8,seedPrograms:2} as const;
export const FIXED_SOURCE_FETCHES=Object.values(SOURCE_FETCH_CAPS).reduce((s,n)=>s+n,0);
export const PAGE_SCAN_MIN_FETCHES=RUN_FETCH_LIMIT-FIXED_SOURCE_FETCHES;
export const MAX_REDIRECTS=2;
export class FetchBudgetError extends Error{constructor(){super('Run fetch budget reached; deferred to a later run');this.name='FetchBudgetError';}}
export function isBudgetError(e:unknown){return e instanceof FetchBudgetError||(e as Error)?.name==='FetchBudgetError';}
export class FetchBudget{
 used=0;
 constructor(readonly limit:number,private parent?:FetchBudget){}
 get remaining():number{const own=Math.max(0,this.limit-this.used);return this.parent?Math.min(own,this.parent.remaining):own;}
 // Synchronous check-and-charge, so concurrent scans in one isolate can never overspend.
 take(){if(this.remaining<1)return false;if(this.parent&&!this.parent.take())return false;this.used++;return true;}
 child(cap:number){return new FetchBudget(cap,this);}
}
type FetchImpl=(url:string,init:RequestInit)=>Promise<Response>;
// Fetch with every request and redirect hop charged to the budget. Throws FetchBudgetError before a request that
// the budget cannot cover, so callers can stop cleanly and defer the remaining work.
export async function budgetedFetch(budget:FetchBudget,url:string,init:RequestInit={},impl:FetchImpl=(u,i)=>fetch(u,i)){
 let current=url,options:RequestInit={...init,redirect:'manual'};
 for(let hop=0;;hop++){
  if(!budget.take())throw new FetchBudgetError();
  const response=await impl(current,options);const location=response.headers.get('location');
  if(response.status>=300&&response.status<400&&location){
   try{await response.body?.cancel();}catch{}
   if(hop>=MAX_REDIRECTS)throw new Error('Too many redirects');
   current=new URL(location,current).toString();if(response.status===303||((response.status===301||response.status===302)&&options.method==='POST'))options={...options,method:'GET',body:undefined};continue;
  }
  return {response,url:current};
 }
}
// Oldest-first rotation for automatic page scans. Routes checked within freshHours without error are reused from
// cache (no fetch). The rest are due: never-scanned routes first, then by their stored last-scanned time.
export type ScanRoute={id:string;code:string;state:string;category:string};
export type SavedScan={checkedAt?:string;error?:string};
export function orderScanRoutes<T extends ScanRoute>(routes:T[],saved:Map<string,SavedScan>,now:number,freshHours=20){
 const fresh:T[]=[],due:{route:T;lastScanned:string|null}[]=[];
 for(const route of routes){const prev=saved.get(route.id);const at=prev?.checkedAt?Date.parse(prev.checkedAt):NaN;if(prev&&!prev.error&&Number.isFinite(at)&&at>now-freshHours*3600000)fresh.push(route);else due.push({route,lastScanned:Number.isFinite(at)?prev!.checkedAt!:null});}
 due.sort((a,b)=>(a.lastScanned===null?-1:0)-(b.lastScanned===null?-1:0)||String(a.lastScanned||'').localeCompare(String(b.lastScanned||''))||a.route.id.localeCompare(b.route.id));
 return {fresh,due};
}
