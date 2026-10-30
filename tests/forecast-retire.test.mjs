// 2026-10-30: the 9:05 AM refresh closed ACL/NIDILRR SBIR Phase I (HHS-2027-ACL-NIDILRR-BISA-0308, gov-363966)
// although Grants.gov still lists it as a forecast with an estimated close of Dec 16, 2026. Cause: its detail lookup
// returned an estimated posting date (Oct 16, 2026) that had passed, and staleForecastReason closed any forecast
// whose posting estimate had passed. Phase II (posting est. Dec 1) stayed. The same rule closed NIDILRR Field
// Initiated Projects (Development/Research) on Oct 29. Fixtures are real Grants.gov responses captured 2026-10-30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out=resolve('.sites-runtime/tests-forecast-retire');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','listing','state-registry','fetch-budget','state-discovery','catalog-sweep','programs']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const S=await import(pathToFileURL(`${out}/catalog-sweep.mjs`).href);
const fx=JSON.parse(readFileSync('tests/fixtures/catalog-sweep/grants-gov-nidilrr-forecasts-2026-10-30.json','utf8'));
const NOW='2026-10-30T13:05:03.122Z'; // the 9:05 AM ET refresh that closed Phase I
const DAY=86400000,at=(iso,d)=>new Date(Date.parse(iso)+d*DAY).toISOString();
const search=async body=>body.eligibilities==='23|99'?{hitCount:fx.searchHits.length,oppHits:fx.searchHits}:{hitCount:0,oppHits:[]};
const PHASE1='gov-363966',PHASE2='gov-363967';

/** One Grants.gov refresh as runDiscovery does it (sweep, records, detail lookups, retirement, dedupe), pure. */
async function refresh(existing,now,{details=true}={}){
 const sweep=await S.sweepGrantsGov(search);
 const records=new Map([...sweep.hits.values()].map(h=>{const g=S.grantsGovRecord(h,existing.get('gov-'+h.id),now);return [g.id,g];}));
 if(details)for(const g of S.detailQueue([...records.values()],now,8))records.set(g.id,S.applyGrantsGovDetail(g,fx.details[g.grantsGovId],now));
 const staged=new Map(records);
 const r=S.retireMissing({prefix:'gov-',existing:existing.values(),seenIds:new Set(records.keys()),complete:sweep.complete,reason:'No longer posted or forecasted on Grants.gov',now});
 for(const g of r.retired)if(!staged.has(g.id))staged.set(g.id,g);
 const d=S.crossSourceDedupe(staged,existing);for(const id of d.dropNew)staged.delete(id);for(const g of [...d.markExisting,...d.clearExisting])staged.set(g.id,g);
 const catalog=new Map(existing);for(const [id,g] of staged)catalog.set(id,g);
 return {catalog,visible:new Set(S.visibleListings([...catalog.values()],now).map(g=>g.id)),retired:r.retired.map(g=>g.id)};
}

test('regression: a forecast still listed on Grants.gov with a future estimated close is never closed or retired',async()=>{
 // First sight (detail lookup this run), exactly the 2026-10-30 case: posting est. Oct 16 passed, close est. Dec 16.
 const first=await refresh(new Map(),NOW);
 for(const id of [PHASE1,PHASE2,'gov-363971','gov-363972']){
  const g=first.catalog.get(id);assert.equal(g.status,'Opens soon',id);assert.equal(g.live,true,id);assert.equal(g.closedReason,undefined,id);assert.ok(first.visible.has(id),id+' is listed');
 }
 assert.equal(first.catalog.get(PHASE1).deadlineLabel,'Forecast: estimated application deadline Dec 16, 2026');
 assert.equal(first.catalog.get(PHASE1).estPostingDate,'2026-10-16');assert.equal(first.catalog.get(PHASE1).opensOn,null,'a passed posting estimate is not shown as "expected"');
 // Every later daily run up to the estimated close keeps it listed, with or without a detail lookup.
 let catalog=first.catalog;
 for(let day=1;day<=47;day++){const now=at(NOW,day);const r=await refresh(catalog,now,{details:day%14===0});catalog=r.catalog;
  assert.deepEqual(r.retired,[],'nothing still on Grants.gov is retired');
  for(const id of fx.searchHits.map(h=>'gov-'+h.id)){const g=catalog.get(id);if(g.estDueDate>=now.slice(0,10))assert.ok(r.visible.has(id),`${id} hidden on day ${day}`);}
 }
 // After the estimated application date has passed the forecast is closed (row kept), as before.
 const late=await refresh(catalog,'2026-12-18T14:00:00.000Z',{details:false});
 assert.equal(late.catalog.get(PHASE1).status,'Closed');assert.match(late.catalog.get(PHASE1).closedReason,/application date has passed/);
 assert.ok(late.visible.has(PHASE2),'Phase II (close est. Feb 1, 2027) stays');
});

test('restore: the row closed by the old rule comes back on the next refresh with no detail fetch and no manual write',async()=>{
 // The stored row as the 9:05 AM ET refresh left it (old rule): enriched, Closed, posting date passed.
 const hit=fx.searchHits.find(h=>String(h.id)==='363966');
 const enriched=S.applyGrantsGovDetail(S.grantsGovRecord({id:'363966',number:hit.number,title:hit.title,agency:hit.agency,agencyCode:hit.agencyCode,openDate:hit.openDate,closeDate:'',oppStatus:'forecasted',types:['Small business']},undefined,NOW),fx.details['363966'],NOW);
 const stored={...enriched,status:'Closed',live:false,closedReason:'Forecast estimated posting date has passed'};
 const existing=new Map([[PHASE1,stored]]);
 const next=await refresh(existing,'2026-10-31T13:05:00.000Z',{details:false});
 const g=next.catalog.get(PHASE1);
 assert.equal(g.status,'Opens soon');assert.equal(g.live,true);assert.equal(g.closedReason,undefined);assert.equal(g.retiredAt,undefined);
 assert.ok(next.visible.has(PHASE1));assert.equal(g.description,stored.description,'enriched text is kept');assert.equal(g.estDueDate,'2026-12-16');
 assert.equal(g.opportunityNumber,'HHS-2027-ACL-NIDILRR-BISA-0308');
});

test('mechanism: a passed posting estimate alone never makes a forecast stale',()=>{
 const today='2026-10-30T13:05:03.122Z';
 assert.equal(S.staleForecastReason({estPostingDate:'2026-10-16',estDueDate:'2026-12-16'},today),null,'slipped posting date, close still ahead');
 assert.equal(S.staleForecastReason({estPostingDate:'2026-10-16',estDueDate:'2026-10-30'},today),null,'close estimate is today');
 assert.equal(S.staleForecastReason({estPostingDate:'2026-12-01',estDueDate:'2027-02-01'},today),null,'Phase II');
 assert.match(S.staleForecastReason({estPostingDate:'2026-09-01',estDueDate:'2026-10-29'},today),/application date has passed/);
 // No application estimate: only a posting estimate over FORECAST_POSTING_GRACE_DAYS past is stale.
 assert.equal(S.FORECAST_POSTING_GRACE_DAYS,90);
 assert.equal(S.staleForecastReason({estPostingDate:'2026-09-01'},today),null);
 assert.match(S.staleForecastReason({estPostingDate:'2026-07-01'},today),/posting date has passed/);
 assert.match(S.staleForecastReason({estPostingDate:'2026-10-16',estDueDate:'2026-12-16',forecastPostedOn:'2024-09-01'},today),/over two years old/);
});

test('mechanism: forecasts closed on an estimate that Grants.gov still lists are re-checked every 14 days',()=>{
 const base={id:'gov-1',grantsGovId:'1',title:'X',url:'https://www.grants.gov/search-results-detail/1',status:'Closed',live:false,description:'x',discovered:NOW};
 const closedOnEstimate={...base,closedReason:'Forecast estimated application date has passed',detailChecked:at(NOW,-15)};
 assert.deepEqual(S.detailQueue([closedOnEstimate],NOW,8).map(g=>g.id),['gov-1']);
 assert.deepEqual(S.detailQueue([{...closedOnEstimate,detailChecked:at(NOW,-3)}],NOW,8),[],'not before 14 days');
 assert.deepEqual(S.detailQueue([{...base,closedReason:'Forecast is over two years old',detailChecked:at(NOW,-30)}],NOW,8),[],'two-year-old forecasts stay closed');
 assert.deepEqual(S.detailQueue([{...base,detailChecked:at(NOW,-30)}],NOW,8),[],'posted notices past their deadline are not re-checked');
 // Open records waiting on a first lookup still go first.
 const pending={id:'gov-2',grantsGovId:'2',title:'Y',url:'https://www.grants.gov/search-results-detail/2',status:'Opens soon',live:true,detailPending:true,forecastPostedOn:'2026-10-01'};
 assert.deepEqual(S.detailQueue([closedOnEstimate,pending],NOW,1).map(g=>g.id),['gov-2']);
});
