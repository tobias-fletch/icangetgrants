// Ongoing catalog sweep: every source parsed from real captured responses (tests/fixtures/catalog-sweep), the
// 45-fetch run cap, safe retirement (a failed fetch never retires anything), cross-source dedupe, the 30-day hide
// for scraped listings, and the public refresh.health summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out=resolve('.sites-runtime/tests-catalog-sweep');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','listing','state-registry','fetch-budget','state-discovery','catalog-sweep','programs']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const S=await import(pathToFileURL(`${out}/catalog-sweep.mjs`).href);
const B=await import(pathToFileURL(`${out}/fetch-budget.mjs`).href);
const P=await import(pathToFileURL(`${out}/source-parsers.mjs`).href);
const L=await import(pathToFileURL(`${out}/listing.mjs`).href);
const PR=await import(pathToFileURL(`${out}/programs.mjs`).href);
const fx=name=>readFileSync(`tests/fixtures/catalog-sweep/${name}`,'utf8');
const search=JSON.parse(fx('grants-gov-search.json')),detailForecast=JSON.parse(fx('grants-gov-detail-forecast.json')),detailPosted=JSON.parse(fx('grants-gov-detail-posted.json'));
const wa=JSON.parse(fx('wa-fundhub.json')).records,pw0=fx('pw-page0.html'),pw1=fx('pw-page1.html'),caCsv=fx('california-grants-portal.csv');
const NOW='2026-10-28T15:00:00.000Z';
const groupOf=body=>body.eligibilities==='21|99'?'individual':body.eligibilities==='23|99'?'business':'nonprofit';
const okSearch=async body=>search[groupOf(body)];
const daysAgo=d=>new Date(Date.parse(NOW)-d*86400000).toISOString();

// ---------- Grants.gov ----------
test('Grants.gov sweep: posted and forecasted hits from all applicant groups, merged types, no profiles needed',async()=>{
 const requests=[];const r=await S.sweepGrantsGov(async body=>{requests.push(body);return okSearch(body);});
 assert.equal(r.queries,3);assert.equal(r.complete,true);assert.deepEqual(r.errors,[]);
 for(const body of requests){assert.equal(body.oppStatuses,'forecasted|posted');assert.equal(body.fundingInstruments,'G');assert.equal(body.rows,S.GRANTS_GOV_ROWS);assert.equal(body.keyword,undefined);}
 assert.equal(r.hits.size,5+2+2);
 const shared=r.hits.get('349554');assert.ok(shared.types.includes('Individual')&&shared.types.includes('Small business'),'a hit in two groups keeps both applicant types');
 const forecast=S.grantsGovRecord(r.hits.get('358676'),undefined,NOW),posted=S.grantsGovRecord(r.hits.get('355417'),undefined,NOW);
 assert.equal(forecast.status,'Opens soon');assert.equal(forecast.deadline,null);assert.match(forecast.deadlineLabel,/^Forecast/);assert.equal(forecast.detailPending,true);
 assert.equal(posted.status,'Open');assert.equal(posted.deadline,'2028-10-26');assert.equal(posted.opportunityNumber,search.individual.oppHits.find(h=>h.id==='355417').number);
 for(const g of [forecast,posted]){assert.equal(g.url,'https://www.grants.gov/search-results-detail/'+g.grantsGovId);assert.ok(S.hasTitleAndLink(g));assert.equal(g.lastSeen,NOW);}
});

test('Grants.gov sweep: a failed, deferred or truncated group makes the sweep incomplete',async()=>{
 const failed=await S.sweepGrantsGov(async body=>{if(groupOf(body)==='business')throw new Error('Grants.gov HTTP 503');return okSearch(body);});
 assert.equal(failed.complete,false);assert.equal(failed.errors.length,1);assert.equal(failed.hits.size,5+2);
 const deferred=await S.sweepGrantsGov(async body=>{if(groupOf(body)==='nonprofit')throw new B.FetchBudgetError();return okSearch(body);},B.isBudgetError);
 assert.equal(deferred.complete,false);assert.equal(deferred.deferred,1);assert.deepEqual(deferred.errors,[]);
 const truncated=await S.sweepGrantsGov(async body=>({...search[groupOf(body)],hitCount:5000}));
 assert.equal(truncated.complete,false);assert.equal(truncated.errors.length,3);
});

test('Grants.gov detail: forecasts get Opens soon dates, posted notices get amounts; costSharing "False" is not a requirement',async()=>{
 const r=await S.sweepGrantsGov(okSearch);
 const forecast=S.applyGrantsGovDetail(S.grantsGovRecord(r.hits.get('358676'),undefined,NOW),detailForecast,NOW);
 assert.equal(forecast.status,'Opens soon');assert.equal(forecast.detailPending,undefined);assert.equal(forecast.detailChecked,NOW);
 assert.ok(forecast.description.length>40);assert.ok(!forecast.requirements.some(x=>/Cost sharing/.test(x)));
 const posted=S.applyGrantsGovDetail(S.grantsGovRecord(r.hits.get('355417'),undefined,NOW),detailPosted,NOW);
 assert.equal(posted.amount,Number(detailPosted.synopsis.awardCeiling));assert.ok(posted.amount>0);assert.equal(posted.deadline,'2028-10-26');
 // A later sweep keeps the enriched fields but refreshes title, deadline and status from the sweep hit.
 const hit={...r.hits.get('355417'),closeDate:'12/01/2028'};const again=S.grantsGovRecord(hit,posted,NOW);
 assert.equal(again.amount,posted.amount);assert.equal(again.description,posted.description);assert.equal(again.deadline,'2028-12-01');assert.equal(again.detailPending,undefined);
 // A forecast that has since been posted gets a fresh detail lookup.
 const nowPosted=S.grantsGovRecord({...r.hits.get('358676'),oppStatus:'posted',closeDate:'12/15/2026'},forecast,NOW);
 assert.equal(nowPosted.status,'Open');assert.equal(nowPosted.detailPending,true);assert.equal(nowPosted.opensOn,undefined);
 // Stale estimated dates already in the past are not shown as "expected".
 const old=S.applyGrantsGovDetail(S.grantsGovRecord(r.hits.get('358676'),undefined,NOW),{forecast:{...detailPosted.forecast}},NOW);
 assert.equal(old.opensOn,null);assert.equal(old.deadlineLabel,'Forecast: application dates not yet published');
 const future=S.applyGrantsGovDetail(S.grantsGovRecord(r.hits.get('358676'),undefined,'2024-06-01T12:00:00Z'),{forecast:{...detailPosted.forecast}},'2024-06-01T12:00:00Z');
 assert.equal(future.opensOn,'2024-08-27');assert.equal(future.deadlineLabel,'Forecast: estimated application deadline Nov 21, 2024');
});

test('Grants.gov detail queue: unenriched posted first, then forecasts, then 14-day re-checks, capped',async()=>{
 // Half of the slots go to forecasts so their estimated dates (expected / stale) are actually checked.
 const r=await S.sweepGrantsGov(okSearch);const records=[...r.hits.values()].map(h=>S.grantsGovRecord(h,undefined,NOW));
 const q=S.detailQueue(records,NOW,4);assert.equal(q.length,4);assert.ok(q.every(g=>g.detailPending));
 const firstForecast=q.findIndex(g=>g.status==='Opens soon');assert.ok(firstForecast===-1||q.slice(firstForecast).every(g=>g.status==='Opens soon'));
 const enriched=records.map(g=>({...g,detailPending:undefined,description:'x',detailChecked:daysAgo(3)}));enriched[0].detailChecked=daysAgo(20);
 assert.deepEqual(S.detailQueue(enriched,NOW,8).map(g=>g.id),[enriched[0].id]);
});

// ---------- California, Washington, Poets & Writers ----------
test('California Grants Portal CSV: active grants for supported applicants only',()=>{
 const records=P.parseCalifornia(caCsv,NOW);assert.ok(records.length>=2);
 for(const g of records){assert.match(g.id,/^ca-/);assert.ok(S.hasTitleAndLink(g));assert.notEqual(g.status,'Closed');}
});

test('Washington FundHub: active grants for businesses, individuals and nonprofits; closed ones reported for retirement',()=>{
 const page=S.parseWaFundHub(wa,NOW);assert.equal(page.count,wa.length);
 assert.deepEqual(page.inactiveIds.sort(),wa.filter(r=>r.acf.funding_status!=='active').map(r=>'wa-'+r.id).sort());
 assert.equal(page.active.length,wa.length-page.inactiveIds.length);
 for(const g of page.active){assert.match(g.id,/^wa-\d+$/);assert.ok(S.hasTitleAndLink(g));assert.ok(g.types.length);assert.doesNotMatch(g.url,/_blank/);assert.equal(g.lastSeen,NOW);}
 const cross=page.active.find(g=>g.id==='wa-1695');assert.equal(cross.grantsGovId,'361169');assert.equal(cross.url,cross.sourceUrl,'the broken "http://_blank" apply link falls back to the FundHub page');
 const stateGrant=page.active.find(g=>g.id==='wa-2231');assert.deepEqual(stateGrant.states,['Washington']);assert.equal(stateGrant.kind,'State grant');assert.equal(stateGrant.deadline,'2026-12-01');
 // Before its application window opens (real open date 2026-10-12) the same record is "Opens soon".
 const early=S.parseWaFundHub(wa,'2026-10-05T15:00:00Z').active.find(g=>g.id==='wa-2231');assert.equal(early.status,'Opens soon');assert.equal(early.opensOn,'2026-10-12');
 assert.throws(()=>S.parseWaFundHub({code:'rest_error'},NOW));
});

test('Washington FundHub paging: stops at a short page, treats page-out-of-range as complete, page-1 failure throws',async()=>{
 const short=await S.fetchWaFundHub(async()=>JSON.stringify(wa),3,NOW);assert.equal(short.queries,1);assert.equal(short.complete,true);
 const urls=[];const full=Array.from({length:S.WA_PAGE_SIZE},(_,i)=>({...wa[i%wa.length],id:100000+i}));
 const outOfRange=await S.fetchWaFundHub(async url=>{urls.push(url);if(urls.length>1)throw new Error('HTTP 400');return JSON.stringify(full);},3,NOW);
 assert.equal(outOfRange.complete,true);assert.match(urls[1],/&page=2&/);
 const capped=await S.fetchWaFundHub(async()=>JSON.stringify(full),3,NOW);assert.equal(capped.queries,3);assert.equal(capped.complete,false);
 await assert.rejects(S.fetchWaFundHub(async()=>{throw new Error('HTTP 503');},3,NOW));
});

test('Poets & Writers paging: a full first page (100 rows) is followed by page 2; a short page completes the listing',async()=>{
 const urls=[];const r=await S.fetchPoetsWriters(async url=>{urls.push(url);return url.includes('&page=1')?pw1:pw0;},2,'2026-10-28T12:00:00Z');
 assert.deepEqual(urls,[S.poetsWritersUrl(0),S.poetsWritersUrl(1)]);assert.equal(r.queries,2);assert.equal(r.complete,true);
 assert.ok(r.records.length>100,'records from both pages');assert.ok(r.records.every(g=>g.id.startsWith('pw-')&&S.hasTitleAndLink(g)));
 const one=await S.fetchPoetsWriters(async()=>pw0,1,'2026-10-28T12:00:00Z');assert.equal(one.complete,false,'cap reached on a full page: incomplete, so nothing is retired');
 await assert.rejects(S.fetchPoetsWriters(async url=>{if(url.includes('&page=1'))throw new Error('HTTP 500');return pw0;},2,NOW),'a later page failing fails the whole source');
});

// ---------- Fetch cap ----------
test('fetch cap: the whole sweep stays inside its per-source caps and the 45-fetch run limit',async()=>{
 assert.equal(B.RUN_FETCH_LIMIT,45);assert.ok(B.FIXED_SOURCE_FETCHES+B.PAGE_SCAN_MIN_FETCHES<=45);
 for(const k of ['grantsGovSweep','grantsGovDetail','california','waFundHub','poetsWriters','careerOneStop'])assert.ok(B.SOURCE_FETCH_CAPS[k]>0,k);
 assert.equal(B.SOURCE_FETCH_CAPS.grantsGovSweep,S.GRANTS_GOV_GROUPS.length,'one search per applicant group');
 const run=new B.FetchBudget(B.RUN_FETCH_LIMIT);let calls=0;
 const respond=async(url,init)=>{calls++;const u=String(url);let body;
  if(u.includes('search2'))body=JSON.stringify({errorcode:0,data:search[groupOf(JSON.parse(init.body))]});
  else if(u.includes('fetchOpportunity'))body=JSON.stringify({errorcode:0,data:detailPosted});
  else if(u.includes('fundhub'))body=JSON.stringify(Array.from({length:S.WA_PAGE_SIZE},(_,i)=>({...wa[i%wa.length],id:200000+i})));
  else if(u.includes('pw.org'))body=pw0;else body=caCsv;
  return new Response(body,{status:200});};
 const get=b=>async url=>{const {response}=await B.budgetedFetch(b,url,{},respond);return response.text();};
 const caps={sweep:run.child(B.SOURCE_FETCH_CAPS.grantsGovSweep),detail:run.child(B.SOURCE_FETCH_CAPS.grantsGovDetail),wa:run.child(B.SOURCE_FETCH_CAPS.waFundHub),pw:run.child(B.SOURCE_FETCH_CAPS.poetsWriters),ca:run.child(B.SOURCE_FETCH_CAPS.california)};
 const sweep=await S.sweepGrantsGov(async body=>{const {response}=await B.budgetedFetch(caps.sweep,'https://api.grants.gov/v1/api/search2',{method:'POST',body:JSON.stringify(body)},respond);return (await response.json()).data;},B.isBudgetError);
 assert.equal(sweep.queries,3);
 // Detail lookups beyond the cap are deferred, never fetched.
 const records=[...sweep.hits.values()].map(h=>S.grantsGovRecord(h,undefined,NOW));let deferred=0;
 for(const g of records){try{await B.budgetedFetch(caps.detail,'https://api.grants.gov/v1/api/fetchOpportunity',{method:'POST',body:'{}'},respond);}catch(e){if(B.isBudgetError(e))deferred++;else throw e;}}
 assert.equal(caps.detail.used,Math.min(records.length,B.SOURCE_FETCH_CAPS.grantsGovDetail));
 // Full FundHub pages forever: the source stops at its cap and reports the listing as incomplete.
 const waRun=await S.fetchWaFundHub(get(caps.wa),B.SOURCE_FETCH_CAPS.waFundHub,NOW);assert.equal(waRun.queries,B.SOURCE_FETCH_CAPS.waFundHub);assert.equal(waRun.complete,false);
 const pwRun=await S.fetchPoetsWriters(get(caps.pw),B.SOURCE_FETCH_CAPS.poetsWriters,NOW);assert.equal(pwRun.queries,B.SOURCE_FETCH_CAPS.poetsWriters);
 await get(caps.ca)('https://publish.data.ca.gov/x.csv');
 // A source can never borrow beyond its cap.
 await assert.rejects(get(caps.wa)(S.waFundHubUrl(4)),e=>B.isBudgetError(e));
 assert.ok(run.used<=B.FIXED_SOURCE_FETCHES);assert.equal(run.used,calls);assert.ok(run.used<=45);
});

// ---------- Retirement ----------
const existingWa=()=>S.parseWaFundHub(wa,daysAgo(1)).active;
test('retirement: records missing from a complete listing are closed (rows kept); explicitly closed always retire',()=>{
 const prev=existingWa(),seen=new Set(prev.slice(1).map(g=>g.id));
 const r=S.retireMissing({prefix:'wa-',existing:prev,seenIds:seen,complete:true,reason:'No longer listed',now:NOW});
 assert.equal(r.retired.length,1);assert.equal(r.retired[0].id,prev[0].id);assert.equal(r.retired[0].status,'Closed');assert.equal(r.retired[0].live,false);assert.equal(r.retired[0].retiredAt,NOW);assert.equal(r.retired[0].closedReason,'No longer listed');
 assert.equal(r.retired[0].title,prev[0].title,'the row keeps its data');
 const partial=S.retireMissing({prefix:'wa-',existing:prev,seenIds:seen,complete:false,explicitlyClosed:[],reason:'x',now:NOW});assert.equal(partial.retired.length,0);
 const explicit=S.retireMissing({prefix:'wa-',existing:prev,seenIds:seen,complete:false,explicitlyClosed:[prev[0].id],reason:'x',now:NOW});assert.equal(explicit.retired.length,1);assert.equal(explicit.retired[0].closedReason,'Marked closed by the source');
 const other=S.retireMissing({prefix:'ca-',existing:prev,seenIds:new Set(),complete:true,reason:'x',now:NOW});assert.equal(other.retired.length,0,'only the fetched source\'s own prefix');
});

test('retirement: a failed fetch retires nothing',async()=>{
 const prev=existingWa();
 // Mirrors discovery.ts: retirement runs after the fetch inside the same source callback, so a throw skips it.
 const runSource=async fetcher=>{try{const r=await fetcher();return S.retireMissing({prefix:'wa-',existing:prev,seenIds:new Set(r.records.map(g=>g.id)),complete:r.complete,explicitlyClosed:r.inactiveIds,reason:'x',now:NOW}).retired;}catch{return [];}};
 assert.deepEqual(await runSource(()=>S.fetchWaFundHub(async()=>{throw new Error('HTTP 503');},3,NOW)),[]);
 assert.deepEqual(await runSource(()=>S.fetchWaFundHub(async()=>'<html>Just a moment...</html>',3,NOW)),[]);
 assert.deepEqual(await runSource(()=>S.fetchWaFundHub(async()=>JSON.stringify({code:'rest_error'}),3,NOW)),[]);
 const gg=await S.sweepGrantsGov(async()=>{throw new Error('Grants.gov HTTP 500');});assert.equal(gg.complete,false);assert.equal(gg.hits.size,0);
 const govPrev=[...(await S.sweepGrantsGov(okSearch)).hits.values()].map(h=>S.grantsGovRecord(h,undefined,daysAgo(1)));
 assert.equal(S.retireMissing({prefix:'gov-',existing:govPrev,seenIds:new Set(),complete:gg.complete,reason:'x',now:NOW}).retired.length,0);
 // And the real discovery source wrapper turns a throw into Unavailable before any retire() call.
 const discovery=readFileSync('lib/discovery.ts','utf8');
 assert.match(discovery,/async function source\(name:string[^\n]*try\{await run\(report\);\}catch\(e\)\{[^\n]*report\.status=report\.records\?'Partial':'Unavailable';report\.error=/);
 for(const prefix of ['gov-','ca-','wa-','pw-']){const at=discovery.indexOf(`retire(report,'${prefix}'`);assert.ok(at>0,prefix);const body=discovery.slice(discovery.lastIndexOf("source('",at),at);assert.match(body,/await /,prefix+' retire() follows the awaited fetch');}
});

test('retirement guard: a listing under half its previous active size retires nothing',()=>{
 const prev=Array.from({length:20},(_,i)=>({...existingWa()[0],id:'wa-'+(9000+i)}));
 const r=S.retireMissing({prefix:'wa-',existing:prev,seenIds:new Set(prev.slice(0,5).map(g=>g.id)),complete:true,reason:'x',now:NOW});
 assert.equal(r.guarded,true);assert.equal(r.retired.length,0);assert.match(r.note,/Retirement skipped/);
 const ok=S.retireMissing({prefix:'wa-',existing:prev,seenIds:new Set(prev.slice(0,15).map(g=>g.id)),complete:true,reason:'x',now:NOW});assert.equal(ok.retired.length,5);
});

// ---------- Dedupe ----------
test('dedupe: a Washington FundHub listing of a Grants.gov opportunity is dropped in favor of Grants.gov',async()=>{
 const gov=S.grantsGovRecord({...search.washingtonCrossListed.hit,types:['Nonprofit']},undefined,NOW);
 const waRec=S.parseWaFundHub(wa,NOW).active.find(g=>g.id==='wa-1695');
 const staged=new Map([[gov.id,gov],[waRec.id,waRec]]);
 const r=S.crossSourceDedupe(staged,new Map());assert.deepEqual(r.dropNew,['wa-1695']);assert.equal(r.deduped,1);
 // Already stored: it is kept but hidden with duplicateOf.
 const r2=S.crossSourceDedupe(new Map([[gov.id,gov]]),new Map([[waRec.id,waRec]]));assert.equal(r2.markExisting[0].duplicateOf,gov.id);assert.ok(S.isHiddenListing(r2.markExisting[0],NOW));
});

test('dedupe: same opportunity number, or same normalized URL plus title, across sources',()=>{
 const base=S.parseWaFundHub(wa,NOW).active.find(g=>g.id==='wa-2231');
 const byNumber=S.crossSourceDedupe(new Map([['gov-1',{...base,id:'gov-1',opportunityNumber:'ABC-2026-01'}],['state-x',{...base,id:'state-x',url:'https://example.org/other',opportunityNumber:'abc 2026 01'}]]),new Map());
 assert.deepEqual(byNumber.dropNew,['state-x']);
 const scraped={...base,id:'pw-copy',url:base.url.replace('https://','http://')+'?utm_source=x',title:base.title.toUpperCase()+' '};
 const byUrl=S.crossSourceDedupe(new Map([[base.id,base],[scraped.id,scraped]]),new Map());assert.deepEqual(byUrl.dropNew,['pw-copy']);
 const distinct=S.crossSourceDedupe(new Map([[base.id,base],['pw-other',{...base,id:'pw-other',title:'A different award'}]]),new Map());assert.equal(distinct.deduped,0);
 // Closed records never claim keys, and a duplicate whose winner closes is shown again.
 const closedWinner=S.crossSourceDedupe(new Map([[base.id,{...base,status:'Closed'}]]),new Map([[scraped.id,{...scraped,duplicateOf:base.id}]]));
 assert.equal(closedWinner.clearExisting.length,1);assert.equal(closedWinner.clearExisting[0].duplicateOf,undefined);
});

// ---------- Visibility ----------
test('title and link are required; scraped listings unseen for 30+ days are hidden but kept',()=>{
 const g=S.parseWaFundHub(wa,NOW).active[0];
 assert.equal(S.hasTitleAndLink({...g,title:'  '}),false);assert.equal(S.hasTitleAndLink({...g,url:''}),false);assert.equal(S.hasTitleAndLink({...g,url:'javascript:alert(1)'}),false);
 const pw=[...new Map(P.parsePrivateAwards(pw0,NOW).map(x=>[x.id,x])).values()][0];
 assert.equal(S.isUnseenScraped({...pw,lastSeen:daysAgo(29)},NOW),false);assert.equal(S.isUnseenScraped({...pw,lastSeen:daysAgo(31)},NOW),true);
 assert.equal(S.isUnseenScraped({...g,lastSeen:daysAgo(90)},NOW),false,'structured feeds retire instead of hiding');
 const list=[{...pw,lastSeen:daysAgo(31)},{...pw,id:'pw-fresh',lastSeen:NOW},{...g,duplicateOf:'gov-1'},{...g,id:'wa-ok'}];
 assert.deepEqual(S.visibleListings(list,NOW).map(x=>x.id),['pw-fresh','wa-ok']);assert.equal(list.length,4);
});

test('content change detection ignores run timestamps',()=>{
 const g=S.parseWaFundHub(wa,NOW).active[0];
 assert.equal(S.contentChanged(g,{...g,checked:'x',lastSeen:'y',discovered:'z',sourceUpdated:'w',detailChecked:'v'}),false);
 assert.equal(S.contentChanged(g,{...g,deadline:'2027-01-01'}),true);assert.equal(S.contentChanged(g,{...g,amount:(g.amount||0)+1}),true);
});

// ---------- Health ----------
const okRun={checkedAt:'2026-10-28T14:00:00.000Z',counts:{added:12,updated:30,retired:2,deduped:3},sources:[{name:'Grants.gov',status:'Connected',records:2100},{name:'Washington FundHub',status:'Connected',records:28}]};
const at=iso=>Date.parse(iso);
test('health: ok, partial, failed and stale',()=>{
 const ok=S.refreshHealth(okRun,{at:okRun.checkedAt,ok:true},at('2026-10-28T15:00:00Z'));
 assert.deepEqual(ok,{status:'ok',checkedAt:okRun.checkedAt,lastAttemptAt:okRun.checkedAt,failedSources:[],warnings:[],added:12,updated:30,retired:2,deduped:3});
 const partial=S.refreshHealth({...okRun,sources:[...okRun.sources,{name:'California Grants Portal',status:'Unavailable',error:'HTTP 503'},{name:'Poets & Writers',status:'Partial',error:'x'},{name:'Official student aid programs',status:'Partial',deferred:2}]},null,at('2026-10-28T15:00:00Z'));
 assert.equal(partial.status,'partial');assert.deepEqual(partial.failedSources,['California Grants Portal','Poets & Writers'],'budget deferrals alone are not failures');
 const failed=S.refreshHealth(okRun,{at:'2026-10-28T16:00:00.000Z',ok:false,error:'D1 batch failed'},at('2026-10-28T16:01:00Z'));
 assert.equal(failed.status,'failed');assert.equal(failed.lastAttemptAt,'2026-10-28T16:00:00.000Z');assert.equal(JSON.stringify(failed).includes('D1 batch'),false,'error text is never public');
 assert.equal(S.refreshHealth(okRun,{at:'2026-10-28T13:00:00.000Z',ok:false},at('2026-10-28T15:00:00Z')).status,'ok','an older failure is superseded by a later success');
 assert.equal(S.refreshHealth(okRun,null,at('2026-10-29T17:00:00Z')).status,'stale');
 assert.equal(S.refreshHealth(null,null).status,'stale');assert.equal(S.refreshHealth(null,{at:NOW,ok:false}).status,'failed','a whole-run failure with no prior success');
});

test('health is public in /api/workspace and the refresh status, and run failures are recorded',()=>{
 const catalog=readFileSync('lib/catalog.ts','utf8');assert.match(catalog,/health: refreshHealth\(last, attempt\)/);assert.match(catalog,/'last-refresh-attempt'/);assert.match(catalog,/isHiddenListing/);
 const discovery=readFileSync('lib/discovery.ts','utf8');assert.match(discovery,/saveAttempt\(\{at,ok:false,error:/);assert.match(discovery,/saveAttempt\(\{at,ok:true\}\)/);assert.match(discovery,/throw e;/);
 assert.match(discovery,/counts=\{added:/);assert.match(readFileSync('app/api/refresh/route.ts','utf8'),/health:refreshHealth\(lastRefresh,lastAttempt\)/);
 // No new scheduled job: the worker still exports only fetch, and wrangler config has no cron trigger.
 const worker=readFileSync('build/sites-worker.ts','utf8');assert.doesNotMatch(worker,/scheduled/);
 for(const f of ['wrangler.jsonc','wrangler.toml','wrangler.json']){try{assert.doesNotMatch(readFileSync(f,'utf8'),/crons|triggers/);}catch(e){if(e.code!=='ENOENT')throw e;}}
 // CareerOneStop is unchanged: no national scholarship list was added.
 assert.doesNotMatch(discovery,/national scholarship list|scholarship-list/i);
});

test('Opens soon is labeled in the UI',()=>{
 const ui=readFileSync('app/dashboard.tsx','utf8');assert.equal((ui.match(/status==='Opens soon'&&<span className="opens-soon-badge">/g)||[]).length,2);
 assert.match(readFileSync('app/globals.css','utf8'),/\.opens-soon-badge\{/);
});

// ---------- 2026-10-28 fixes ----------
const M=list=>new Map(list.map(g=>[g.id,g]));
const gov=(id,o={})=>({id:'gov-'+id,title:'Sample Program',funder:'Department of Example',url:'https://www.grants.gov/search-results-detail/'+id,kind:'Federal grant',status:'Open',live:true,deadline:'2026-12-15',opportunityNumber:'EX-'+id,source:'Grants.gov',lastSeen:NOW,...o});

test('fix 1: same normalized title and deadline across sources is a duplicate; Grants.gov is kept',()=>{
 const g=gov('363833',{title:'FY27 Rural Business Development Grants',deadline:'2027-02-27',opportunityNumber:'RD-RBDG-27'});
 const w={id:'wa-2204',title:'FY27 Rural Business Development Grants.',funder:'USDA Rural Development',url:'https://fundhub.wa.gov/grant/2204',deadline:'2027-02-27',status:'Open',live:true,source:'Washington FundHub',lastSeen:NOW};
 const r=S.crossSourceDedupe(M([w]),M([g]));assert.deepEqual(r.dropNew,['wa-2204']);
 // A different deadline, a short title, or two listings from the same source do not pair up.
 assert.deepEqual(S.crossSourceDedupe(M([{...w,deadline:'2027-03-01'}]),M([g])).dropNew,[]);
 assert.deepEqual(S.crossSourceDedupe(M([{...w,title:'Small Grants'}]),M([{...g,title:'Small Grants'}])).dropNew,[]);
 assert.deepEqual(S.crossSourceDedupe(M([{...w,id:'wa-2205',url:'https://fundhub.wa.gov/grant/2205'}]),M([w])).dropNew,[]);
});

test('fix 2: forecasts whose estimated date passed, or over two years old, are closed and hidden (rows kept)',async()=>{
 const r=await S.sweepGrantsGov(okSearch);const hit=r.hits.get('358676');
 const aeif=S.applyGrantsGovDetail(S.grantsGovRecord(hit,undefined,NOW),{forecast:{...detailForecast.forecast,estSynopsisPostingDateStr:'2022-01-30-00-00-00',estApplicationResponseDateStr:'2022-01-30-00-00-00'}},NOW);
 assert.equal(aeif.status,'Closed');assert.equal(aeif.live,false);assert.match(aeif.closedReason,/estimated application date has passed/);assert.ok(S.isHiddenListing(aeif,NOW));
 const slipped=S.applyGrantsGovDetail(S.grantsGovRecord(hit,undefined,NOW),{forecast:{...detailForecast.forecast,estSynopsisPostingDateStr:'2026-09-01-00-00-00',estApplicationResponseDateStr:'2027-01-15-00-00-00'}},NOW);
 assert.equal(slipped.status,'Closed');assert.match(slipped.closedReason,/posting date has passed/);
 // No detail yet: a forecast posted on Grants.gov over 730 days ago is closed from the sweep alone (AFCP 2020).
 const afcp=S.grantsGovRecord({...hit,openDate:'09/20/2019'},undefined,NOW);assert.equal(afcp.status,'Closed');assert.match(afcp.closedReason,/over two years old/);
 assert.ok(!S.detailQueue([afcp],NOW,8).length,'closed forecasts are not looked up again');
 const fresh=S.grantsGovRecord({...hit,openDate:'10/01/2026'},undefined,NOW);assert.equal(fresh.status,'Opens soon');assert.equal(fresh.forecastPostedOn,'2026-10-01');
 // The estimate survives later sweeps and still closes the record once it passes.
 const kept=S.grantsGovRecord(hit,{...fresh,detailPending:undefined,description:'x',estDueDate:'2026-10-01',estPostingDate:'2026-09-01'},NOW);assert.equal(kept.status,'Closed');
});

test('fix 3: forecasts show "Opens soon, expected <date>" in the site date format',async()=>{
 const r=await S.sweepGrantsGov(okSearch);
 const f=S.applyGrantsGovDetail(S.grantsGovRecord(r.hits.get('358676'),undefined,NOW),{forecast:{...detailForecast.forecast,estSynopsisPostingDateStr:'2027-03-31-00-00-00',estApplicationResponseDateStr:'2027-06-01-00-00-00'}},NOW);
 assert.equal(f.status,'Opens soon');assert.equal(f.opensOn,'2027-03-31');assert.equal(f.deadlineLabel,'Forecast: estimated application deadline Jun 1, 2027');
 assert.equal(L.opensSoonText(f,new Date(NOW)),'Opens soon, expected Mar 31, 2027');
 assert.equal(L.opensSoonText({opensOn:null},new Date(NOW)),'Opens soon');assert.equal(L.opensSoonText({opensOn:'2026-01-01'},new Date(NOW)),'Opens soon');
 assert.equal(L.formatDay('2027-03-31'),'Mar 31, 2027');
 const ui=readFileSync('app/dashboard.tsx','utf8');assert.equal((ui.match(/opensSoonText\(/g)||[]).length>=2,true);assert.doesNotMatch(ui,/' · expected '/);
});

test('fix 4: contact people in the agency field fall back to the agency name or code; real agency names are untouched',async()=>{
 const names=JSON.parse(fx('grants-gov-agency-names.json'));
 for(const a of names.agencies)assert.equal(S.looksLikePerson(a),false,`agency flagged as a person: ${a}`);
 for(const c of names.contacts)assert.equal(S.looksLikePerson(c),true,`contact not flagged: ${c}`);
 const r=await S.sweepGrantsGov(okSearch);const hit=r.hits.get('358676');
 const niac=S.grantsGovRecord({...hit,agency:'Benjamin J Goodman Senior Scientist',agencyCode:'NASA-HQ'},undefined,NOW);assert.equal(niac.funder,'NASA-HQ');
 const detail=S.applyGrantsGovDetail(niac,{forecast:{...detailForecast.forecast,agencyName:'Benjamin J Goodman\nSenior Scientist',agencyCode:'NASA-HQ',agencyDetails:{agencyName:'NASA Headquarters'}}},NOW);assert.equal(detail.funder,'NASA Headquarters');
 const noDetails=S.applyGrantsGovDetail({...niac,funder:'Benjamin J Goodman'},{forecast:{...detailForecast.forecast,agencyName:'Benjamin J Goodman\nSenior Scientist',agencyCode:'NASA-HQ',agencyDetails:undefined}},NOW);assert.equal(noDetails.funder,'NASA-HQ');
});

test('fix 5: generic titles get the sponsor; a forecast with the same title as an open notice is hidden behind it',()=>{
 assert.equal(S.isGenericTitle('Poetry Prize'),true);assert.equal(S.isGenericTitle('Poetry Chapbook Contest'),true);assert.equal(S.isGenericTitle('Brittingham and Pollak Prizes in Poetry'),false);
 assert.equal(S.withSponsor('Poetry Prize','Nightboat Books'),'Poetry Prize, Nightboat Books');assert.equal(S.withSponsor('Nightboat Poetry Prize','Nightboat Books'),'Nightboat Poetry Prize');
 const pw=P.parsePrivateAwards(pw0,NOW);assert.ok(pw.length);
 const forecast=gov('363168',{title:'Ruth L. Kirschstein NRSA Individual Fellowship',funder:'National Institutes of Health',status:'Opens soon',deadline:null});
 const open=gov('360534',{title:'Ruth L. Kirschstein NRSA Individual Fellowship',funder:'National Institutes of Health'});
 const r=S.crossSourceDedupe(M([forecast,open]),M([]));assert.deepEqual(r.dropNew,['gov-363168']);
 assert.deepEqual(S.crossSourceDedupe(M([forecast,{...open,funder:'Department of Energy'}]),M([])).dropNew,[]);
 // Same title still shared by visible listings: sponsor added (scraped), then the number when the sponsor is the same.
 const a={id:'pw-x',title:'Literary Awards',funder:'Arts Council A',url:'https://a.example',status:'Open'},b={id:'pw-y',title:'Literary Awards',funder:'Arts Council B',url:'https://b.example',status:'Open'};
 assert.deepEqual(S.disambiguateTitles([a,b]).map(g=>g.title),['Literary Awards, Arts Council A','Literary Awards, Arts Council B']);
 const sac=['363777','363421','363419'].map(id=>gov(id,{title:'FY 2027 Service Area Competition (SAC)',funder:'Health Resources and Services Administration',opportunityNumber:'HRSA-27-0'+id.slice(-2)}));
 assert.deepEqual(S.disambiguateTitles(sac).map(g=>g.title),sac.map(g=>`FY 2027 Service Area Competition (SAC) (${g.opportunityNumber})`));
});

test('fix 6: closed listings are hidden from public lists, search, counts and the sitemap; rows and saved items kept',()=>{
 assert.equal(S.isHiddenListing(gov('1',{status:'Closed'}),NOW),true);
 assert.equal(S.isHiddenListing(gov('2',{deadline:'2026-10-27'}),NOW),true,'a past deadline (New York date) is closed');
 assert.equal(S.isHiddenListing(gov('3',{deadline:'2026-10-28'}),NOW),false,'due today is still open');
 assert.equal(S.isHiddenListing(gov('4',{status:'Opens soon',deadline:null}),NOW),false);
 assert.deepEqual(S.visibleListings([gov('5',{status:'Closed'}),gov('6')],NOW).map(g=>g.id),['gov-6']);
 const cat=readFileSync('lib/catalog.ts','utf8');assert.match(cat,/keepIds/);assert.match(cat,/isHiddenListing\(g, now\.getTime\(\)\)/);
 assert.match(readFileSync('app/api/workspace/route.ts','utf8'),/loadCatalog\(\{owner,keepIds:u\?state\.saved\.map\(s=>s\.grantId\):\[\]\}\)/);
 assert.match(readFileSync('lib/seo-index.ts','utf8'),/!isHiddenListing\(g, now\.getTime\(\)\)/);
});

// ---------- Weekly studentaid.gov checks ----------
const teach=PR.aidPrograms.find(p=>p.id==='teach'),tap=PR.aidPrograms.find(p=>p.id==='ny-tap');
const teachRow={...PR.checkedProgram(teach,'<html>TEACH Grant</html>','2026-10-18T13:00:00.000Z')};
const refused=(name,message,code)=>{const e=new Error(message);e.name=name;if(code)e.cause={code};return e;};
const runChecks=(o)=>PR.checkOfficialPrograms({programs:[teach],existing:new Map([['teach',teachRow]]),checks:{},now:NOW,isBudgetError:B.isBudgetError,fetchHtml:async()=>'<html>TEACH Grant</html>',...o});
test('studentaid.gov programs are checked at most weekly, by last attempt (success or refusal)',async()=>{
 assert.equal(PR.weeklyProgram(teach),true);assert.equal(PR.weeklyProgram(tap),false);
 let calls=0;const fetchHtml=async()=>{calls++;return '<html>TEACH Grant</html>';};
 let r=await runChecks({fetchHtml,checks:{teach:{lastAttempt:daysAgo(2),lastSuccess:daysAgo(2)}}});
 assert.equal(calls,0,'checked 2 days ago: skipped');assert.deepEqual(r.skipped,['TEACH Grant']);assert.equal(r.kept,1);assert.deepEqual(r.records,[]);assert.deepEqual(r.warnings,[]);assert.equal(r.queries,0);
 r=await runChecks({fetchHtml,checks:{teach:{lastAttempt:daysAgo(6.9),lastError:'timed out'}}});
 assert.equal(calls,0,'a refusal 6.9 days ago also counts as the weekly attempt');assert.equal(r.warnings.length,1,'the refusal stays visible as a warning while skipped');assert.match(r.warnings[0],/^TEACH Grant: studentaid\.gov timed out on Oct 21, 2026\. Listing kept; next check after Oct 28, 2026\.$/);
 r=await runChecks({fetchHtml,checks:{teach:{lastAttempt:daysAgo(7),lastSuccess:daysAgo(7)}}});
 assert.equal(calls,1,'7 days later it is due');assert.equal(r.records[0].id,'teach');assert.equal(r.records[0].live,true);assert.deepEqual(r.checks.teach,{lastAttempt:NOW,lastSuccess:NOW});
 r=await runChecks({fetchHtml});assert.equal(calls,2,'never checked: due');
 // Non-studentaid pages (NY TAP) are still checked every run.
 r=await PR.checkOfficialPrograms({programs:[tap],existing:new Map(),checks:{'ny-tap':{lastAttempt:daysAgo(1)}},now:NOW,isBudgetError:B.isBudgetError,fetchHtml});assert.equal(calls,3);assert.equal(r.checks['ny-tap'].lastAttempt,daysAgo(1),'no weekly state for non-weekly pages');
 // A budget deferral is not an attempt.
 r=await runChecks({fetchHtml:async()=>{throw new B.FetchBudgetError();}});assert.equal(r.deferred,1);assert.equal(r.checks.teach,undefined);assert.equal(r.kept,1);
});
test('studentaid.gov refusing the connection: health stays ok, a warning is shown, the TEACH listing is kept',async()=>{
 for(const [err,kind] of [[refused('TimeoutError','The operation was aborted due to timeout'),'timed out'],[refused('TypeError','fetch failed','ECONNRESET'),'reset the connection'],[new Error('Network connection lost.'),'reset the connection'],[refused('TypeError','fetch failed','ECONNREFUSED'),'refused the connection'],[new Error('HTTP 403'),'refused the request (HTTP 403)']]){
  assert.equal(S.refusalKind(err),kind);
  const r=await runChecks({fetchHtml:async()=>{throw err;}});
  assert.deepEqual(r.errors,[]);assert.equal(r.warnings.length,1);assert.match(r.warnings[0],new RegExp('^TEACH Grant: studentaid\\.gov '+kind.replace(/[()]/g,'\\$&')+' on Oct 28, 2026\\. Listing kept; next check after Nov 4, 2026\\.$'));
  assert.equal(r.kept,1,'the stored row is left untouched');assert.deepEqual(r.records,[]);assert.equal(r.checks.teach.lastAttempt,NOW);assert.equal(r.checks.teach.lastError,kind);
 }
 assert.equal(S.refusalKind(new Error('HTTP 500')),null);assert.equal(S.refusalKind(new Error('Source requires browser access')),null);
 // No stored row yet: a link-only record with the studentaid.gov link is stored, and it is publicly listed.
 const r=await runChecks({existing:new Map(),fetchHtml:async()=>{throw refused('TimeoutError','The operation was aborted due to timeout');}});
 assert.equal(r.records.length,1);const g=r.records[0];assert.equal(g.id,'teach');assert.equal(g.url,'https://studentaid.gov/understand-aid/types/grants/teach');assert.equal(g.sourceMode,'Link check only');assert.equal(S.isHiddenListing(g,NOW),false);assert.equal(S.isHiddenListing(teachRow,NOW),false);
 // The source report discovery builds for this case, and the public health it produces.
 const okRun={checkedAt:NOW,counts:{added:1,updated:0,retired:0,deduped:0},sources:[{name:'Grants.gov',status:'Connected'},{name:'Official student aid programs',status:'Connected',records:2,warnings:r.warnings}]};
 const h=S.refreshHealth(okRun,{at:NOW,ok:true},Date.parse(NOW));
 assert.equal(h.status,'ok');assert.deepEqual(h.failedSources,[]);assert.deepEqual(h.warnings,[{source:'Official student aid programs',message:r.warnings[0]}]);
 const discovery=readFileSync('lib/discovery.ts','utf8');assert.match(discovery,/if\(r\.warnings\.length\)report\.warnings=r\.warnings;/);assert.match(discovery,/if\(r\.errors\.length\)\{report\.status='Partial';report\.error=/);assert.match(discovery,/ICanGetGrants\/1\.2 \(funding source discovery; \+https:\/\/icangetgrants\.com\)/,'honest user agent unchanged');
 assert.match(readFileSync('lib/access.ts','utf8'),/warnings:s\.warnings/);assert.match(readFileSync('app/dashboard.tsx','utf8'),/Refresh health: \{refresh\.health\.status\}/);
});
test('any other failing source still makes health partial, with or without a studentaid.gov warning',async()=>{
 const warn=['TEACH Grant: studentaid.gov timed out on Oct 28, 2026. Listing kept; next check after Nov 4, 2026.'];
 const run=sources=>S.refreshHealth({checkedAt:NOW,counts:{},sources},{at:NOW,ok:true},Date.parse(NOW));
 let h=run([{name:'Official student aid programs',status:'Connected',warnings:warn},{name:'California Grants Portal',status:'Unavailable',error:'HTTP 503'}]);
 assert.equal(h.status,'partial');assert.deepEqual(h.failedSources,['California Grants Portal']);assert.equal(h.warnings.length,1);
 h=run([{name:'Poets & Writers',status:'Partial',error:'Page 2: HTTP 500'}]);assert.equal(h.status,'partial');assert.deepEqual(h.warnings,[]);
 // A studentaid.gov error that is not a refusal (HTTP 500) is a real failure: not an attempt, retried next run.
 const r=await runChecks({fetchHtml:async()=>{throw new Error('HTTP 500');}});
 assert.deepEqual(r.warnings,[]);assert.deepEqual(r.errors,['TEACH Grant: HTTP 500']);assert.equal(r.checks.teach,undefined);assert.equal(r.kept,1);
 h=run([{name:'Official student aid programs',status:'Partial',error:r.errors.join('; ')}]);assert.equal(h.status,'partial');assert.deepEqual(h.failedSources,['Official student aid programs']);
});
