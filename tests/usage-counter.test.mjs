import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// First-party usage counter (PR c): per-day totals of home searches, grant-card clicks and outbound apply clicks.
const out=resolve('.sites-runtime/tests-usage-counter');mkdirSync(out,{recursive:true});
for(const name of ['access','usage-events','usage-beacon']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const U=await import(pathToFileURL(`${out}/usage-events.mjs`).href);
const B=await import(pathToFileURL(`${out}/usage-beacon.mjs`).href);
const OWNER=readFileSync('lib/access.ts','utf8').match(/OWNER_USER_ID='([^']+)'/)[1];
const NOW=new Date('2026-10-29T12:00:00Z');

test('only the three event names are accepted; search text and anything else is dropped',()=>{
 assert.deepEqual([...U.USAGE_EVENTS],['search','card_click','apply_click']);
 for(const e of U.USAGE_EVENTS)assert.equal(U.usageEvent(e),e);
 assert.equal(U.usageEvent(' search\n'),'search');
 for(const bad of ['nursing scholarships','search:nursing','{"event":"search","q":"nursing"}','SEARCH','',null,undefined,42,{event:'search'},'x'.repeat(40)])assert.equal(U.usageEvent(bad),null,String(bad));
});

test('days are America/New_York calendar days',()=>{
 assert.equal(U.usageDay(new Date('2026-10-30T03:30:00Z')),'2026-10-29');
 assert.equal(U.usageDay(new Date('2026-10-30T04:30:00Z')),'2026-10-30');
 assert.equal(U.usageDay(new Date('2026-03-08T04:59:00Z')),'2026-03-07');
 assert.equal(U.usageSince(1,NOW),'2026-10-29');
 assert.equal(U.usageSince(30,NOW),'2026-09-30');
 assert.equal(U.usageDays(null),30);assert.equal(U.usageDays('7'),7);assert.equal(U.usageDays('0'),30);assert.equal(U.usageDays('-3'),30);assert.equal(U.usageDays('abc'),30);assert.equal(U.usageDays('9999'),366);
});

test('recording stores only the day, the event name and +1; failures are silent',async()=>{
 const calls=[];
 assert.equal(await U.recordUsage('search',async(...a)=>{calls.push(a);},NOW),true);
 assert.deepEqual(calls,[[U.RECORD_USAGE_SQL,'2026-10-29','search']]);
 assert.match(U.RECORD_USAGE_SQL,/^INSERT INTO usage_daily \(day, event, count\) VALUES \(\?, \?, 1\) ON CONFLICT\(day, event\) DO UPDATE SET count = count \+ 1$/);
 assert.equal(await U.recordUsage(null,async()=>{throw new Error('must not run');},NOW),false);
 assert.equal(await U.recordUsage('apply_click',async()=>{throw new Error('no such table: usage_daily');},NOW),false);
});

test('daily report: zero-filled window, newest first, totals, bad rows ignored',()=>{
 const rows=[{day:'2026-10-29',event:'search',count:5},{day:'2026-10-29',event:'apply_click',count:2},{day:'2026-10-27',event:'card_click',count:3},
  {day:'2026-10-20',event:'search',count:99},{day:'2026-10-29',event:'pageview',count:7},{day:'bad',event:'search',count:1},{day:'2026-10-28',event:'search',count:-4},{day:'2026-10-30',event:'search',count:1}];
 const r=U.usageReport(rows,3,NOW);
 assert.equal(r.timeZone,'America/New_York');assert.equal(r.since,'2026-10-27');assert.equal(r.through,'2026-10-29');
 assert.deepEqual(r.days,[{day:'2026-10-29',search:5,card_click:0,apply_click:2},{day:'2026-10-28',search:0,card_click:0,apply_click:0},{day:'2026-10-27',search:0,card_click:3,apply_click:0}]);
 assert.deepEqual(r.totals,{search:5,card_click:3,apply_click:2});
 assert.match(r.note,/no search text/);
});

test('owner-only report: non-owners never reach the database',async()=>{
 let touched=0;const all=async(sql,since)=>{touched++;assert.equal(sql,U.DAILY_USAGE_SQL);assert.equal(since,'2026-10-23');return [{day:'2026-10-29',event:'card_click',count:4}];};
 for(const user of [null,{userId:'someone-else'},{userId:OWNER,provider:'google'},{userId:'google:'+OWNER},{userId:'local_seedy'}])assert.equal(await U.ownerUsageReport(user,false,7,all,NOW),null);
 assert.equal(touched,0);
 const r=await U.ownerUsageReport({userId:OWNER},false,7,all,NOW);
 assert.equal(touched,1);assert.equal(r.days.length,7);assert.deepEqual(r.totals,{search:0,card_click:4,apply_click:0});
 assert.ok(await U.ownerUsageReport({userId:'local_seedy'},true,7,all,NOW),'local development owner');
 const empty=await U.ownerUsageReport({userId:OWNER},false,2,async()=>{throw new Error('no such table');},NOW);
 assert.deepEqual(empty.totals,{search:0,card_click:0,apply_click:0});
});

test('cross-site posts are not counted',()=>{
 const req=(h)=>new Request('https://icangetgrants.com/api/usage-event',{method:'POST',headers:h,body:'search'});
 assert.equal(U.sameSiteUsageRequest(req({origin:'https://icangetgrants.com','sec-fetch-site':'same-origin'})),true);
 assert.equal(U.sameSiteUsageRequest(req({})),true);
 assert.equal(U.sameSiteUsageRequest(req({origin:'https://evil.example'})),false);
 assert.equal(U.sameSiteUsageRequest(req({'sec-fetch-site':'cross-site'})),false);
});

test('browser beacon sends only the event name and never throws',async()=>{
 const sent=[];const nav=globalThis.navigator;const f=globalThis.fetch;
 try{
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{sendBeacon:(url,blob)=>{sent.push([url,blob]);return true;}}});
  B.sendUsage('card_click');
  assert.equal(sent.length,1);assert.equal(sent[0][0],'/api/usage-event');assert.equal(await sent[0][1].text(),'card_click');assert.equal(sent[0][1].type,'text/plain');
  const posts=[];Object.defineProperty(globalThis,'navigator',{configurable:true,value:{sendBeacon:()=>false}});
  globalThis.fetch=(url,init)=>{posts.push([url,init]);return Promise.reject(new Error('offline'));};
  B.sendUsage('apply_click');
  assert.deepEqual(posts.map(([u,i])=>[u,i.method,i.body,i.credentials,i.keepalive]),[['/api/usage-event','POST','apply_click','omit',true]]);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{sendBeacon:()=>{throw new Error('blocked');}}});
  assert.doesNotThrow(()=>B.sendUsage('search'));
 }finally{Object.defineProperty(globalThis,'navigator',{configurable:true,value:nav});globalThis.fetch=f;}
});

test('migration and schema: one table of day, event, count and nothing personal',()=>{
 const sql=readFileSync('drizzle/0003_usage_daily.sql','utf8');
 assert.match(sql,/CREATE TABLE `usage_daily`/);
 assert.deepEqual([...sql.matchAll(/^\s*`(\w+)`/gm)].map(m=>m[1]),['day','event','count']);
 assert.match(sql,/PRIMARY KEY\(`day`, `event`\)/);
 assert.ok(JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries.some(e=>e.tag==='0003_usage_daily'));
 assert.match(readFileSync('db/schema.ts','utf8'),/usageDaily = sqliteTable\('usage_daily'/);
});

test('routes: public POST is always 204 and reads no identifying headers; daily JSON is owner-only',()=>{
 const post=readFileSync('app/api/usage-event/route.ts','utf8').replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.match(post,/status: 204/);assert.match(post,/catch \{/);
 assert.doesNotMatch(post,/cookie|cf-connecting-ip|x-forwarded-for|user-agent|x-real-ip|getChatGPTUser|Set-Cookie/i);
 const get=readFileSync('app/api/usage-daily/route.ts','utf8');
 assert.match(get,/ownerUsageReport\(await getChatGPTUser\(\), import\.meta\.env\.DEV/);assert.match(get,/status: 403/);
 const all=readFileSync('lib/usage-events.ts','utf8')+readFileSync('lib/usage-beacon.ts','utf8');
 assert.doesNotMatch(all,/https?:\/\/|document\.cookie|localStorage|GrantOS/);
});

test('client hooks: home search, grant card and apply link; sign-in buttons untouched',()=>{
 const d=readFileSync('app/dashboard.tsx','utf8');
 assert.match(d,/function submitSearch\(e:FormEvent<HTMLFormElement>\)\{e\.preventDefault\(\);sendUsage\('search'\);/);
 assert.equal((d.match(/sendUsage\('card_click'\);setDetail\(g\)/g)||[]).length,2);
 assert.match(d,/href=\{detail\.url\} target="_blank" rel="noopener noreferrer" onClick=\{\(\)=>sendUsage\('apply_click'\)\}>Visit source listing/);
 // Only the event name is ever passed: no query text or grant data.
 for(const m of d.matchAll(/sendUsage\(([^)]*)\)/g))assert.match(m[1],/^'(search|card_click|apply_click)'$/);
 for(const [s,n] of [['Continue with Google',3],['Sign in with',3],['signInUrl(',3]])assert.equal(d.split(s).length-1,n,s);
 const seo=readFileSync('components/seo-page.tsx','utf8');
 assert.match(seo,/rel="nofollow noopener" data-usage="apply_click">\{l\.title\}/);assert.match(seo,/<UsageClicks \/>/);
 assert.match(readFileSync('components/usage-clicks.tsx','utf8'),/closest\?\.\('a\[data-usage="apply_click"\]'\)/);
});

test('privacy page describes the counter honestly',()=>{
 const p=readFileSync('app/privacy/page.tsx','utf8').replace(/\s+/g,' ');
 assert.match(p,/first-party daily totals/);assert.match(p,/search words are not sent or stored/);
 assert.match(p,/No cookies, IP addresses, browser details or account ids are stored/);assert.match(p,/only the site owner can see the totals/);
});
