// Pennsylvania PHEAA and Washington WSAC state aid sources: parsed from real pheaa.org and wsac.wa.gov captures
// (tests/fixtures/pheaa, tests/fixtures/wsac, 2026-10-30), honest status mapping, 1-fetch caps inside the 45-fetch
// run cap, and weekly-recheck warnings on refusal (the HESC pattern, lib/hesc.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out=resolve('.sites-runtime/tests-pa-wa');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','listing','state-registry','fetch-budget','state-discovery','catalog-sweep','programs','hesc','pheaa','wsac']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '\.\/([^']+)'/g,"from './$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const PH=await import(pathToFileURL(`${out}/pheaa.mjs`).href);
const W=await import(pathToFileURL(`${out}/wsac.mjs`).href);
const B=await import(pathToFileURL(`${out}/fetch-budget.mjs`).href);
const S=await import(pathToFileURL(`${out}/catalog-sweep.mjs`).href);
const PR=await import(pathToFileURL(`${out}/programs.mjs`).href);
const L=await import(pathToFileURL(`${out}/listing.mjs`).href);

const ROUTES=readFileSync('tests/fixtures/pheaa/routes-2026-10-30.js','utf8');
const SHELL=readFileSync('tests/fixtures/pheaa/funding-opportunities-shell.html','utf8');
const wfx=name=>readFileSync(`tests/fixtures/wsac/${name}.html`,'utf8');
const LISTING=wfx('sfa-overview');
const NOW='2026-10-30T13:00:00.000Z';
const day=d=>new Date(Date.parse(NOW)+d*86400000).toISOString();
const BUNDLE='https://www.pheaa.org/assets/index-3bu9DQV1.js';
const httpError=status=>new Error('HTTP '+status);
const refused=()=>{const e=new Error('fetch failed');e.cause={code:'ECONNRESET'};return e;};
// A fetchHtml that enforces a real child cap like discovery.ts does.
const capped=(cap,impl)=>{const c=new B.FetchBudget(B.RUN_FETCH_LIMIT).child(cap);const calls=[];return {calls,c,fetchHtml:async url=>{if(!c.take())throw new B.FetchBudgetError();calls.push(url);return impl(url);}};};

test('PHEAA: 18 state grant and aid programs from the pheaa.org route table, no loans, work-study or helper pages',()=>{
 const ps=PH.parsePheaaRoutes(ROUTES);
 assert.equal(ps.length,18);
 for(const p of ps)assert.match(p.url,/^https:\/\/www\.pheaa\.org\/(?:grants|funding-opportunities)\//);
 const titles=ps.map(p=>p.title);
 for(const t of ['PA State Grant Program','Summer PA State Grant Program','Chafee Education & Training Grant (Chafee ETG) Program','Grow PA Scholarship Grant Program','PA Targeted Industry Program (PA-TIP)','PA National Guard Educational Assistance Program (EAP)'])assert.ok(titles.includes(t),t);
 assert.equal(ps.find(p=>p.title==='PA State Grant Program').url,'https://www.pheaa.org/grants/state-grant-program');
 for(const t of titles)assert.doesNotMatch(t,/loan forgiveness|work-?study|PA HELPS|GrantUs|FAQ|\bapply\b|\bforms\b/i,t);
 assert.equal(new Set(ps.map(p=>p.url)).size,18);assert.equal(new Set(ps.map(p=>PH.pheaaId(p.url))).size,18);
 assert.equal(PH.parsePheaaRoutes('export default 1;').length,0);
});

test('PHEAA: only a same-origin /assets bundle is accepted from the page shell',()=>{
 assert.equal(PH.pheaaBundleUrl(SHELL),BUNDLE);
 assert.equal(PH.pheaaBundleUrl('<script type="module" src="https://evil.example/assets/x.js"></script>'),null);
 assert.equal(PH.pheaaBundleUrl('<html></html>'),null);
});

test('PHEAA records: Pennsylvania student aid, Verify cycle (never a claimed deadline), open on state pages',()=>{
 const g=PH.pheaaRecord(PH.parsePheaaRoutes(ROUTES)[0],NOW,NOW);
 assert.deepEqual(g.states,['Pennsylvania']);assert.equal(g.status,'Verify cycle');assert.equal(g.deadline,null);assert.equal(g.source,'PHEAA');
 assert.equal(g.id,'pheaa-state-grant-program');assert.ok(L.isOpenGrant(g,new Date(NOW)));
 assert.ok(PH.pheaaRecord({title:'PA National Guard Educational Assistance Program (EAP)',url:'https://www.pheaa.org/funding-opportunities/aid-for-military-national-guard/national-guard-eap',section:'funding-opportunities'},NOW,NOW).tags.includes('military'));
});

test('PHEAA run with cap 1: shell once, then the stored bundle; list every 3 days; 404 re-locates the bundle',async()=>{
 const site=url=>url===PH.PHEAA_SHELL_URL?SHELL:url===BUNDLE?ROUTES:(()=>{throw httpError(404);})();
 // Run 1: no stored bundle, so the one fetch reads the shell.
 let f=capped(B.SOURCE_FETCH_CAPS.pheaa,site);let r=await PH.runPheaa({fetchHtml:f.fetchHtml,state:null,now:NOW,fetchCap:1,isBudgetError:B.isBudgetError});
 assert.deepEqual(f.calls,[PH.PHEAA_SHELL_URL]);assert.equal(r.state.bundleUrl,BUNDLE);assert.equal(r.records.length,0);assert.equal(r.complete,false);assert.equal(r.deferred,1);
 // Run 2: the stored bundle is the one fetch.
 f=capped(1,site);r=await PH.runPheaa({fetchHtml:f.fetchHtml,state:r.state,now:day(1),fetchCap:1,isBudgetError:B.isBudgetError});
 assert.deepEqual(f.calls,[BUNDLE]);assert.equal(r.records.length,18);assert.equal(r.complete,true);assert.equal(r.seen,true);assert.equal(f.c.used,1);
 // Run 3: list not due, stored rows reused with no fetch and no retirement.
 f=capped(1,site);const r3=await PH.runPheaa({fetchHtml:f.fetchHtml,state:r.state,now:day(2),fetchCap:1,isBudgetError:B.isBudgetError});
 assert.deepEqual(f.calls,[]);assert.equal(r3.records.length,18);assert.equal(r3.seen,false);assert.equal(r3.complete,false);
 // PHEAA publishes a new bundle: 404 clears the stored name (a note, not an error), rows kept, shell read next run.
 f=capped(1,url=>{throw httpError(404);});const r4=await PH.runPheaa({fetchHtml:f.fetchHtml,state:r.state,now:day(4),fetchCap:1,isBudgetError:B.isBudgetError});
 assert.equal(r4.state.bundleUrl,undefined);assert.deepEqual(r4.errors,[]);assert.equal(r4.records.length,18);assert.equal(r4.complete,false);assert.match(r4.notes.join(' '),/new site bundle/);
});

test('PHEAA: refusal is a weekly-recheck warning with rows kept; a short or changed list is an error and retires nothing',async()=>{
 const base={bundleUrl:BUNDLE,listing:{lastAttempt:day(-5),lastSuccess:day(-5),programs:PH.parsePheaaRoutes(ROUTES)}};
 let r=await PH.runPheaa({fetchHtml:async()=>{throw refused();},state:base,now:NOW,fetchCap:1,isBudgetError:B.isBudgetError});
 assert.equal(r.records.length,18);assert.deepEqual(r.errors,[]);assert.equal(r.warnings.length,1);assert.match(r.warnings[0],/pheaa\.org reset the connection.*Listing kept; next check after/);assert.equal(r.complete,false);
 r=await PH.runPheaa({fetchHtml:async()=>'export const x={label:"Grants",path:"grants",children:[{label:"One",path:"one"}]};',state:base,now:NOW,fetchCap:1,isBudgetError:B.isBudgetError});
 assert.equal(r.errors.length,1);assert.equal(r.complete,false);assert.equal(r.records.length,18);
});

test('WSAC list: 9 state aid programs, work study and loan programs excluded, other agencies linked to their own sites',()=>{
 const ps=W.parseWsacListing(LISTING);
 assert.equal(ps.length,9);
 assert.deepEqual(ps.map(p=>p.title),['Washington College Grant (WA Grant)','College Bound','Passport to Careers','Washington State Opportunity Scholarship','Opportunity Grant','American Indian Endowed Scholarship','Teacher Programs','Washington Health Corps','National Guard Grant']);
 for(const p of ps)assert.doesNotMatch(p.title,/work study|loan/i);
 assert.equal(ps[0].url,'https://wsac.wa.gov/wcg');
 const own=ps.filter(p=>p.wsacPage);assert.equal(own.length,7);for(const p of own)assert.match(p.url,/^https:\/\/wsac\.wa\.gov\//);
 const ext=ps.filter(p=>!p.wsacPage);assert.deepEqual(ext.map(p=>p.funder),['WSOS (listed by WSAC)','SBCTC (listed by WSAC)']);
 assert.equal(new Set(ps.map(W.wsacId)).size,9);assert.equal(W.wsacId(ps[0]),'wsac-washington-college-grant');
});

test('WSAC page status: closed, rolling, mixed, or unstated, as WSAC states it',()=>{
 assert.deepEqual(W.parseWsacStatus(wfx('washington-health-corps')),{kind:'closed',label:'Applications closed per WSAC; next cycle early 2027'});
 assert.deepEqual(W.parseWsacStatus(wfx('american-indian-endowed-scholarship')),{kind:'closed',label:'Applications closed per WSAC; next cycle December 2026'});
 assert.equal(W.parseWsacStatus(wfx('national-guard')).kind,'rolling');
 assert.equal(W.parseWsacStatus(wfx('teachers')).kind,'mixed');
 for(const n of ['wcg','college-bound','passport-guide'])assert.equal(W.parseWsacStatus(wfx(n)),null,n);
 const ps=W.parseWsacListing(LISTING),rec=(t,f)=>W.wsacRecord(ps.find(p=>p.title===t),{lastAttempt:NOW,lastSuccess:NOW,result:W.parseWsacStatus(wfx(f))},NOW);
 assert.equal(rec('Washington Health Corps','washington-health-corps').status,'Closed');assert.equal(L.isOpenGrant(rec('Washington Health Corps','washington-health-corps'),new Date(NOW)),false);
 assert.equal(rec('National Guard Grant','national-guard').status,'Rolling');
 assert.equal(rec('Teacher Programs','teachers').status,'Verify cycle');
 const wcg=rec('Washington College Grant (WA Grant)','wcg');assert.equal(wcg.status,'Verify cycle');assert.deepEqual(wcg.states,['Washington']);assert.ok(L.isOpenGrant(wcg,new Date(NOW)));
});

test('WSAC run with cap 1: list every 3 days, otherwise one WSAC page; other agencies never fetched; pages at most weekly',async()=>{
 const site=url=>{if(url===W.WSAC_LISTING_URL)return LISTING;const n=new URL(url).pathname.replace(/^\//,'').replace('/','-');return wfx(n==='passport-guide'?'passport-guide':n);};
 let state=null;const fetched=[];
 for(let d=0;d<14;d++){const f=capped(B.SOURCE_FETCH_CAPS.wsac,site);const r=await W.runWsac({fetchHtml:f.fetchHtml,state,now:day(d),fetchCap:1,isBudgetError:B.isBudgetError});
  assert.ok(f.c.used<=1);assert.deepEqual(r.errors,[]);assert.equal(r.records.length,9);fetched.push(...f.calls.map(u=>({d,u})));state=r.state;
  if(d===0)assert.deepEqual(f.calls,[W.WSAC_LISTING_URL]);}
 for(const {u} of fetched)assert.match(u,/^https:\/\/wsac\.wa\.gov\//);
 const pages=fetched.filter(x=>x.u!==W.WSAC_LISTING_URL);
 assert.equal(new Set(pages.map(x=>x.u)).size,7,'all seven WSAC-hosted pages read within two weeks');
 const byUrl={};for(const x of pages)(byUrl[x.u]||=[]).push(x.d);for(const ds of Object.values(byUrl))for(let i=1;i<ds.length;i++)assert.ok(ds[i]-ds[i-1]>=7);
 assert.deepEqual(fetched.filter(x=>x.u===W.WSAC_LISTING_URL).map(x=>x.d),[0,3,6,9,12]);
});

test('WSAC: a refused list is a weekly-recheck warning with rows kept; too few programs is an error',async()=>{
 const base={listing:{lastAttempt:day(-4),lastSuccess:day(-4),programs:W.parseWsacListing(LISTING)},pages:{}};
 let r=await W.runWsac({fetchHtml:async()=>{throw refused();},state:base,now:NOW,fetchCap:1,isBudgetError:B.isBudgetError});
 assert.equal(r.records.length,9);assert.deepEqual(r.errors,[]);assert.match(r.warnings.join(' '),/wsac\.wa\.gov reset the connection/);assert.equal(r.complete,false);
 r=await W.runWsac({fetchHtml:async()=>'<html><main><h2>Programs</h2></main></html>',state:base,now:NOW,fetchCap:1,isBudgetError:B.isBudgetError});
 assert.equal(r.errors.length,1);assert.equal(r.complete,false);assert.equal(r.records.length,9);
});

test('budget: PHEAA 1 + WSAC 1 come from studentAid and CareerOneStop; fixed caps stay 35, page scans keep 10, run stays 45',()=>{
 const c=B.SOURCE_FETCH_CAPS;
 assert.deepEqual({...c},{grantsGovSweep:3,grantsGovDetail:8,careerOneStop:5,california:2,waFundHub:3,poetsWriters:2,chamber:1,studentAid:3,seedPrograms:2,hesc:4,pheaa:1,wsac:1});
 assert.equal(B.FIXED_SOURCE_FETCHES,35);assert.equal(B.PAGE_SCAN_MIN_FETCHES,10);assert.equal(B.RUN_FETCH_LIMIT,45);
 assert.equal(B.FIXED_SOURCE_FETCHES+B.PAGE_SCAN_MIN_FETCHES,B.RUN_FETCH_LIMIT);
 // A full run where every source spends its whole cap still ends at 45.
 const run=new B.FetchBudget(B.RUN_FETCH_LIMIT);for(const n of Object.values(c)){const ch=run.child(n);while(ch.take());}let scans=0;while(run.take())scans++;
 assert.equal(scans,10);assert.equal(run.used,45);
 // studentAid 3: the three weekly studentaid.gov pages plus California (the only remaining non-weekly page) never exceed one wait.
 assert.ok(c.studentAid>=PR.aidPrograms.filter(p=>!p.replacedBy&&PR.weeklyProgram(p)).length);
 // CareerOneStop 5: one student profile's national + state + 3 interest searches all fit each run.
 assert.equal(c.careerOneStop,5);
});

test('wiring: honest user agent, own caps and jobs rows, retirement only after a complete list; no double listing',()=>{
 const d=readFileSync('lib/discovery.ts','utf8');
 assert.match(d,/runPheaa\(\{fetchHtml:url=>text\(url,caps\.pheaa\)/);assert.match(d,/pheaa:budget\.child\(SOURCE_FETCH_CAPS\.pheaa\)/);
 assert.match(d,/runWsac\(\{fetchHtml:url=>text\(url,caps\.wsac\)/);assert.match(d,/wsac:budget\.child\(SOURCE_FETCH_CAPS\.wsac\)/);
 assert.match(d,/'User-Agent':'ICanGetGrants\/1\.2 \(funding source discovery; \+https:\/\/icangetgrants\.com\)'/);
 assert.match(d,/if\(r\.complete\)retire\(report,'pheaa-'/);assert.match(d,/if\(r\.complete\)retire\(report,'wsac-'/);
 const sweep=d.slice(d.indexOf('const sweepSources=['),d.indexOf('if(profiles.length)await Promise.all'));
 assert.match(sweep,/source\('Pennsylvania PHEAA state grant programs'/);assert.match(sweep,/source\('Washington WSAC state financial aid programs'/);
 assert.equal(new Set([PH.PHEAA_CHECKS_JOB,W.WSAC_CHECKS_JOB,PR.PROGRAM_CHECKS_JOB,'hesc-checks']).size,4);
 // PA State Grant, Grow PA and the Washington College Grant come from the dedicated sources only.
 const ids=st=>PR.relevantPrograms([{id:'p',type:'Student',country:'United States',state:st}]).map(p=>p.id);
 for(const id of ['pa-state-grant','pa-grow'])assert.ok(!ids('Pennsylvania').includes(id),id);assert.ok(!ids('Washington').includes('wa-college'));
 for(const f of ['lib/pheaa.ts','lib/wsac.ts'])assert.doesNotMatch(readFileSync(f,'utf8'),/Mozilla|Chrome\//);
});

test('dedupe: a PHEAA row and an older row for the same official page collapse to one listing',()=>{
 const g=PH.pheaaRecord(PH.parsePheaaRoutes(ROUTES)[0],NOW,NOW);
 const twin={...g,id:'state-pa-dup',source:'Pennsylvania state research',sourceMode:'Researched lead'};
 const r=S.crossSourceDedupe(new Map([[g.id,g]]),new Map([[twin.id,{...twin,discovered:day(-30)}]]));
 assert.equal(r.dropNew.length+r.markExisting.length,1,'exactly one of the pair is hidden');
});
