// New York HESC state grants and scholarships: parsed from real hesc.ny.gov pages captured 2026-10-29
// (tests/fixtures/hesc), honest status mapping, the 45-fetch run cap, and weekly-recheck warnings on refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out=resolve('.sites-runtime/tests-hesc');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','listing','state-registry','fetch-budget','state-discovery','catalog-sweep','programs','hesc']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '\.\/([^']+)'/g,"from './$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const H=await import(pathToFileURL(`${out}/hesc.mjs`).href);
const B=await import(pathToFileURL(`${out}/fetch-budget.mjs`).href);
const S=await import(pathToFileURL(`${out}/catalog-sweep.mjs`).href);
const PR=await import(pathToFileURL(`${out}/programs.mjs`).href);
const P=await import(pathToFileURL(`${out}/source-parsers.mjs`).href);
const fx=name=>readFileSync(`tests/fixtures/hesc/${name}.html`,'utf8');
const LISTING=fx('nys-grants-scholarships');
const NOW='2026-10-29T12:00:00.000Z';
const daysAgo=d=>new Date(Date.parse(NOW)-d*86400000).toISOString();
const pageFor=url=>{const n=new URL(url).pathname.split('/').pop();try{return fx(n);}catch{return null;}};
const okFetch=calls=>async url=>{calls.push(url);if(url===H.HESC_LISTING_URL)return LISTING;const p=pageFor(url);if(p)return p;throw new Error('HTTP 404');};
const refused=(name,message,code)=>{const e=new Error(message);e.name=name;if(code)e.cause={code};return e;};

test('HESC list: all 19 official programs with absolute https://hesc.ny.gov links and the "Accepting Applications" line',()=>{
 const ps=H.parseHescListing(LISTING);
 assert.equal(ps.length,19);
 for(const p of ps){assert.match(p.url,/^https:\/\/hesc\.ny\.gov\//);assert.ok(p.title&&p.description,p.title);}
 const by=t=>ps.find(p=>p.title===t);
 assert.equal(by('Tuition Assistance Program (TAP)').url,'https://hesc.ny.gov/find-aid/nys-grants-scholarships/tuition-assistance-program-tap');
 assert.equal(by('Tuition Assistance Program (TAP)').accepting,true);
 assert.equal(by('Excelsior Scholarship Program').accepting,false);assert.equal(by('Excelsior Scholarship Program').statusLine,null);
 assert.equal(by('Veterans Tuition Award').url,'https://hesc.ny.gov/vta');
 assert.equal(ps.filter(p=>p.accepting).length,12);
 assert.equal(H.hescUrl('https://example.com/x'),null,'off-site links are dropped');assert.equal(H.hescUrl('http://www.hesc.ny.gov/merit'),'https://hesc.ny.gov/merit');
});

test('program pages: deadline, rolling, closed and school deadlines exactly as HESC states them',()=>{
 assert.deepEqual(H.parseHescDeadline(fx('tuition-assistance-program-tap'),NOW),{kind:'date',deadline:'2027-06-30',label:'Deadline 06/30/2027 for 2026-27',stated:'HESC deadlines: 06/30/2027 for academic year 2026-27; 06/30/2028 for academic year 2027-28.'});
 assert.deepEqual(H.parseHescDeadline(fx('nys-science-technology-engineering-and-mathematics-stem-incentive'),NOW),{kind:'date',deadline:'2027-08-16',label:'Deadline 08/16/2027 for 2027-28',stated:'HESC deadline: 08/16/2027 for academic year 2027-28.'});
 assert.deepEqual(H.parseHescDeadline(fx('excelsior-scholarship-program'),NOW),{kind:'closed',deadline:null,label:'The NYS Excelsior Scholarship program is now closed.'});
 assert.deepEqual(H.parseHescDeadline(fx('senator-patricia-k-mcgee-nursing-faculty-scholarship'),NOW),{kind:'closed',deadline:null,label:'The Senator Patricia K McGee Nursing Faculty Scholarship is closed.'});
 assert.deepEqual(H.parseHescDeadline(fx('world-trade-center-memorial-scholarship'),NOW),{kind:'rolling',deadline:null,label:'Open year-round (per HESC)'});
 assert.deepEqual(H.parseHescDeadline(fx('SAE'),NOW),{kind:'school',deadline:null,label:'Check with your high school for deadline dates.'});
 // After 06/30/2027 the next stated deadline is used; after every stated date the program is closed.
 assert.equal(H.parseHescDeadline(fx('tuition-assistance-program-tap'),'2027-07-15T12:00:00Z').deadline,'2028-06-30');
 assert.equal(H.parseHescDeadline(fx('tuition-assistance-program-tap'),'2028-07-15T12:00:00Z').kind,'closed');
 assert.equal(H.parseHescDeadline('<html><body>No deadline section</body></html>',NOW),null);
});

test('records: honest status, official links, New York student aid; the list line is used only until the page is read',()=>{
 const ps=H.parseHescListing(LISTING),by=t=>ps.find(p=>p.title===t);
 const read=(p)=>({lastAttempt:NOW,lastSuccess:NOW,result:H.parseHescDeadline(pageFor(p.url),NOW)});
 const tap=H.hescRecord(by('Tuition Assistance Program (TAP)'),read(by('Tuition Assistance Program (TAP)')),NOW,NOW);
 assert.equal(tap.id,'hesc-tuition-assistance-program-tap');assert.equal(tap.status,'Open');assert.equal(tap.deadline,'2027-06-30');assert.deepEqual(tap.states,['New York']);assert.deepEqual(tap.types,['Student']);assert.equal(tap.kind,'Student aid');assert.equal(tap.url,'https://hesc.ny.gov/find-aid/nys-grants-scholarships/tuition-assistance-program-tap');assert.equal(tap.sourceMode,'Official program page');assert.equal(tap.amount,null);
 const exc=H.hescRecord(by('Excelsior Scholarship Program'),read(by('Excelsior Scholarship Program')),NOW,NOW);
 assert.equal(exc.status,'Closed');assert.equal(S.isClosedListing(exc,NOW),true,'closed programs are hidden from public lists');
 const wtc=H.hescRecord(by('World Trade Center Memorial Scholarship'),read(by('World Trade Center Memorial Scholarship')),NOW,NOW);
 assert.equal(wtc.status,'Rolling');assert.equal(wtc.deadline,null);assert.equal(wtc.deadlineLabel,'Open year-round (per HESC)');
 const sae=H.hescRecord(by('NYS Scholarships for Academic Excellence'),read(by('NYS Scholarships for Academic Excellence')),NOW,NOW);
 assert.ok(tap.requirements.includes('HESC deadlines: 06/30/2027 for academic year 2026-27; 06/30/2028 for academic year 2027-28.'));
 // Card labels fit the site's 60-character deadline label (lib/source-parsers.ts tidyDeadlineLabel).
 for(const g of [tap,wtc,sae,H.hescRecord(by('Veterans Tuition Award'),undefined,NOW,NOW),H.hescRecord(by('Excelsior Scholarship Program'),undefined,NOW,NOW)])assert.notEqual(P.tidyDeadlineLabel(g.deadlineLabel),'See listing',g.deadlineLabel);
 assert.equal(sae.status,'Verify cycle');assert.equal(sae.deadlineLabel,'Check with your high school for deadline dates.');
 // Not read yet: "Accepting Applications" is Open with no deadline claimed; no line is not called open.
 const unreadOpen=H.hescRecord(by('Veterans Tuition Award'),undefined,NOW,NOW);
 assert.equal(unreadOpen.status,'Open');assert.equal(unreadOpen.deadline,null);assert.equal(unreadOpen.deadlineLabel,'Open: accepting applications per HESC');assert.equal(unreadOpen.sourceMode,'Official program list');
 const unreadNone=H.hescRecord(by('Excelsior Scholarship Program'),undefined,NOW,NOW);
 assert.equal(unreadNone.status,'Verify cycle');assert.doesNotMatch(unreadNone.status,/open/i);
 // A newer list saying "Accepting Applications" beats an older page read saying closed (and that page is re-read first).
 const stale={lastAttempt:daysAgo(5),lastSuccess:daysAgo(5),result:{kind:'closed',deadline:null,label:'closed'}};
 assert.equal(H.hescRecord(by('Veterans Tuition Award'),stale,NOW,NOW).status,'Open');
 assert.equal(H.pagesToCheck(ps,{listing:{lastAttempt:NOW,lastSuccess:NOW},pages:Object.fromEntries(ps.map(p=>[p.url,p.title==='Veterans Tuition Award'?stale:{lastAttempt:daysAgo(1),lastSuccess:daysAgo(1),result:null}]))},NOW,2)[0].title,'Veterans Tuition Award');
});

test('fetch cap: HESC gets 2 of the existing 45 fetches, page scans keep at least 10',()=>{
 assert.equal(B.RUN_FETCH_LIMIT,45);assert.equal(B.SOURCE_FETCH_CAPS.hesc,2);
 assert.equal(B.FIXED_SOURCE_FETCHES,Object.values(B.SOURCE_FETCH_CAPS).reduce((s,n)=>s+n,0));
 assert.equal(B.FIXED_SOURCE_FETCHES+B.PAGE_SCAN_MIN_FETCHES,45);assert.ok(B.PAGE_SCAN_MIN_FETCHES>=10);
 assert.ok(B.SOURCE_FETCH_CAPS.studentAid>=PR.aidPrograms.filter(p=>!p.replacedBy&&!PR.weeklyProgram(p)).length,'non-weekly official aid pages still fit');
});

test('runs: list plus one page, then two pages per run, never more than the cap; pages read at most weekly',async()=>{
 let calls=[];let r=await H.runHesc({fetchHtml:okFetch(calls),state:null,now:NOW,fetchCap:2,isBudgetError:B.isBudgetError});
 assert.equal(calls.length,2);assert.equal(calls[0],H.HESC_LISTING_URL);assert.equal(r.records.length,19);assert.equal(r.seen,true);assert.equal(r.complete,true);assert.deepEqual(r.errors,[]);assert.deepEqual(r.warnings,[]);
 // Unread programs without an "Accepting Applications" line are read first.
 assert.equal(r.pagesRead,1);assert.equal(new URL(calls[1]).pathname,'/find-aid/nys-grants-scholarships/excelsior-scholarship-program');
 assert.equal(r.records.find(g=>g.id==='hesc-excelsior-scholarship-program').status,'Closed');
 let state=r.state;const next=new Date(Date.parse(NOW)+86400000).toISOString();
 calls=[];r=await H.runHesc({fetchHtml:okFetch(calls),state,now:next,fetchCap:2,isBudgetError:B.isBudgetError});
 assert.equal(calls.length,2);assert.ok(!calls.includes(H.HESC_LISTING_URL),'list reused for 3 days');assert.equal(r.seen,false);assert.equal(r.complete,false);assert.equal(r.records.length,19);
 // Budget exhaustion defers, it is not an attempt.
 r=await H.runHesc({fetchHtml:async()=>{throw new B.FetchBudgetError();},state:null,now:NOW,fetchCap:2,isBudgetError:B.isBudgetError});
 assert.equal(r.deferred,1);assert.equal(r.state.listing,undefined);assert.deepEqual(r.records,[]);
 // Every page read within the week: nothing is re-read.
 const all={listing:{lastAttempt:NOW,lastSuccess:NOW,programs:H.parseHescListing(LISTING)},pages:Object.fromEntries(H.parseHescListing(LISTING).map(p=>[p.url,{lastAttempt:daysAgo(6),lastSuccess:daysAgo(6),result:null}]))};
 calls=[];await H.runHesc({fetchHtml:okFetch(calls),state:all,now:NOW,fetchCap:2,isBudgetError:B.isBudgetError});assert.equal(calls.length,0);
});

test('hesc.ny.gov refusing: weekly-recheck warning like studentaid.gov, stored listings kept, nothing retired',async()=>{
 for(const [err,kind] of [[refused('TimeoutError','The operation was aborted due to timeout'),'timed out'],[refused('TypeError','fetch failed','ECONNRESET'),'reset the connection'],[new Error('HTTP 403'),'refused the request (HTTP 403)'],[new Error('HTTP 429'),'refused the request (HTTP 429)'],[new Error('HTTP 503'),'returned a server error (HTTP 503)'],[new Error('HTTP 520'),'returned a server error (HTTP 520)']]){
  let calls=0;const r=await H.runHesc({fetchHtml:async()=>{calls++;throw err;},state:null,now:NOW,fetchCap:2,isBudgetError:B.isBudgetError});
  assert.equal(calls,1,'one attempt, no retry loop');assert.deepEqual(r.errors,[]);assert.deepEqual(r.records,[],'no records staged, stored rows untouched');assert.equal(r.complete,false,'no retirement');
  assert.equal(r.state.listing.lastError,kind);assert.equal(r.state.listing.lastAttempt,NOW);
  assert.deepEqual(r.warnings,[`NYS grants & scholarships list: hesc.ny.gov ${kind} on Oct 29, 2026. Listing kept; next check after Nov 5, 2026.`]);
  const health=S.refreshHealth({checkedAt:NOW,counts:{},sources:[{name:'New York HESC grants & scholarships',status:'Connected',warnings:r.warnings}]},{at:NOW,ok:true},Date.parse(NOW));
  assert.equal(health.status,'ok');assert.equal(health.warnings.length,1);
 }
 // Within the week the refused list is not asked again; the warning stays.
 const state={listing:{lastAttempt:daysAgo(6.9),lastError:'timed out'},pages:{}};let calls=0;
 let r=await H.runHesc({fetchHtml:async()=>{calls++;return LISTING;},state,now:NOW,fetchCap:2,isBudgetError:B.isBudgetError});
 assert.equal(calls,0);assert.equal(r.warnings.length,1);assert.match(r.warnings[0],/timed out on Oct 22, 2026\. Listing kept; next check after Oct 29, 2026\.$/);
 r=await H.runHesc({fetchHtml:async url=>{calls++;return url===H.HESC_LISTING_URL?LISTING:fx('tuition-assistance-program-tap');},state:{...state,listing:{lastAttempt:daysAgo(7),lastError:'timed out'}},now:NOW,fetchCap:2,isBudgetError:B.isBudgetError});
 assert.equal(calls,2,'a week later it is asked again');assert.deepEqual(r.warnings,[]);assert.equal(r.records.length,19);
 // A refused program page keeps its last result and shows a warning; a 404 is an error, not a warning.
 const listed={listing:{lastAttempt:NOW,lastSuccess:NOW,programs:H.parseHescListing(LISTING)},pages:{}};
 r=await H.runHesc({fetchHtml:async()=>{throw new Error('HTTP 503');},state:listed,now:NOW,fetchCap:1,isBudgetError:B.isBudgetError});
 assert.deepEqual(r.errors,[]);assert.equal(r.warnings.length,1);assert.match(r.warnings[0],/hesc\.ny\.gov returned a server error \(HTTP 503\) on Oct 29, 2026/);assert.equal(r.records.length,19);
 r=await H.runHesc({fetchHtml:async()=>{throw new Error('HTTP 404');},state:listed,now:NOW,fetchCap:1,isBudgetError:B.isBudgetError});
 assert.equal(r.errors.length,1);assert.deepEqual(r.warnings,[]);
 // An empty or changed list is an error and retires nothing.
 r=await H.runHesc({fetchHtml:async()=>'<html><title>HESC</title></html>',state:null,now:NOW,fetchCap:2,isBudgetError:B.isBudgetError});
 assert.equal(r.errors.length,1);assert.equal(r.complete,false);
});

test('wiring: honest user agent fetch, own cap, own jobs row, retirement only after a complete list; NY TAP not doubled',()=>{
 const d=readFileSync('lib/discovery.ts','utf8');
 assert.match(d,/runHesc\(\{fetchHtml:url=>text\(url,caps\.hesc\)/);assert.match(d,/hesc:budget\.child\(SOURCE_FETCH_CAPS\.hesc\)/);
 assert.match(d,/'User-Agent':'ICanGetGrants\/1\.2 \(funding source discovery; \+https:\/\/icangetgrants\.com\)'/);
 assert.match(d,/if\(r\.complete\)retire\(report,'hesc-'/);assert.equal(H.HESC_CHECKS_JOB,'hesc-checks');assert.notEqual(H.HESC_CHECKS_JOB,PR.PROGRAM_CHECKS_JOB);
 // The HESC source is in the profile-independent sweep, so New York student aid is listed without any profile.
 const sweep=d.slice(d.indexOf('const sweepSources=['),d.indexOf('if(profiles.length)await Promise.all'));assert.match(sweep,/source\('New York HESC grants & scholarships'/);
 assert.equal(PR.relevantPrograms([{id:'p',type:'Student',country:'United States',state:'New York'}]).some(p=>p.id==='ny-tap'),false,'TAP comes from HESC only');
 assert.ok(PR.relevantPrograms([{id:'p',type:'Student',country:'United States',state:'California'}]).some(p=>p.id==='cal-grant'));
 assert.doesNotMatch(readFileSync('lib/hesc.ts','utf8'),/Mozilla|Chrome\/|GrantOS/);
});
