// Catalog expansion (2026-10-25): city/county fields, Wave 2 cities, community foundations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const out=resolve('.sites-runtime/tests-catalog');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','programs','state-registry','state-discovery','access','notifications','listing','city-registry','community-foundations','research-plan','fetch-budget','catalog-geo']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const load=name=>import(pathToFileURL(`${out}/${name}.mjs`).href);
const cities=await load('city-registry'),states=await load('state-registry'),cf=await load('community-foundations'),plan=await load('research-plan'),geo=await load('catalog-geo'),scan=await load('state-discovery'),budget=await load('fetch-budget');
const read=p=>readFileSync(p,'utf8');
const base={id:'p',name:'Synthetic',country:'USA',keywords:'',goal:5000,education:'',details:'',alerts:true};
const at=Date.parse('2026-10-25T13:00:00Z'),empty=new Map();

// Hosts and pages below were each checked with a server request on 2026-10-24 (HTTP 200).
const WAVE2_VERIFIED={'austin-tx':['austintexas.gov'],'charlotte-nc':['artsandscience.org'],'columbus-oh':['gcac.org'],'indianapolis-in':['indy.gov','indyarts.org'],'san-francisco-ca':['sf.gov'],'seattle-wa':['seattle.gov'],'denver-co':['denvergov.org','artsandvenuesdenver.com'],'nashville-tn':['nashville.gov'],'el-paso-tx':['elpasotexas.gov','elpasoeid.com'],'las-vegas-nv':['lasvegasnevada.gov'],'boston-ma':['boston.gov']};
const WAVE2_PENDING=['fort-worth-tx','san-jose-ca','oklahoma-city-ok'];
const HELD=['fortworthtexas.gov','sanjoseca.gov','okc.gov','charlottenc.gov','columbus.gov','sa.gov','culturela.org'];

test('Wave 2 covers Census ranks 11-25 (DC skipped) with only verified hosts',()=>{
 const w2=cities.citySources.filter(c=>c.wave===2);
 assert.deepEqual(w2.map(c=>c.rank),[11,12,13,14,15,16,17,18,19,20,21,23,24,25]);
 assert.equal(new Set(cities.citySources.map(c=>c.id)).size,cities.citySources.length);
 for(const c of w2){assert.ok(states.sourceForState(c.stateCode),c.id);}
 assert.deepEqual(w2.filter(c=>c.status==='verified').map(c=>c.id).sort(),Object.keys(WAVE2_VERIFIED).sort());
 for(const [id,hosts] of Object.entries(WAVE2_VERIFIED)){const c=cities.cityById(id);assert.deepEqual(cities.cityHosts(c),hosts,id);for(const d of c.govDomains)assert.ok(d.endsWith('.gov'),d);
  const urls=Object.values(c.sources);assert.ok(urls.length>=1,id);for(const u of urls){assert.match(u,/^https:\/\//);assert.equal(cities.cityEvidenceHostAllowed(c,cities.cityState(c),u),true,u);}}
 for(const id of WAVE2_PENDING){const c=cities.cityById(id);assert.equal(c.status,'pending verification');assert.deepEqual(cities.cityHosts(c),[]);assert.deepEqual(c.sources,{});}
 const all=JSON.stringify(cities.citySources.map(c=>[c.govDomains,c.partnerHosts,c.sources]));for(const h of HELD)assert.ok(!all.includes('"'+h)&&!all.includes('.'+h)&&!all.includes('/'+h),h);
 assert.equal(cities.cityById('washington-dc'),undefined);
});
test('Wave 2 lookalikes, partner subdomains and other cities are rejected',()=>{
 const c=id=>cities.cityById(id),ok=(id,host)=>cities.cityEvidenceHostAllowed(c(id),cities.cityState(c(id)),`https://${host}/grant`);
 for(const [id,host] of [['austin-tx','www.austintexas.gov'],['austin-tx','library.austintexas.gov'],['denver-co','www.denvergov.org'],['indianapolis-in','indyarts.org'],['boston-ma','www.boston.gov'],['el-paso-tx','elpasoeid.com']])assert.equal(ok(id,host),true,id+' '+host);
 for(const [id,host] of [['austin-tx','austintexas.gov.evil.com'],['austin-tx','fakeaustintexas.gov'],['denver-co','sub.denvergov.org'],['denver-co','denvergov.org.example.net'],['charlotte-nc','grants.artsandscience.org'],['charlotte-nc','charlottenc.gov'],['columbus-oh','columbus.gov'],['seattle-wa','boston.gov'],['fort-worth-tx','fortworthtexas.gov'],['san-jose-ca','sanjoseca.gov'],['oklahoma-city-ok','okc.gov']])assert.equal(ok(id,host),false,id+' '+host);
});
test('every city has a county field; New York spans several counties',()=>{
 for(const c of cities.citySources){assert.ok('county' in c,c.id);if(c.county!==null)assert.match(c.county,/ County$/,c.id);}
 assert.equal(cities.cityById('new-york-ny').county,null);assert.equal(cities.cityById('austin-tx').county,'Travis County');assert.equal(cities.cityById('chicago-il').county,'Cook County');
});

const FOUNDATIONS={'california-community-foundation':['calfund.org'],'greater-houston-cf':['ghcf.org'],'philadelphia-foundation':['philafound.org'],'san-antonio-area-foundation':['saafdn.org'],'san-diego-foundation':['sdfoundation.org'],'communities-foundation-of-texas':['cftexas.org'],'community-foundation-ne-florida':['jaxcf.org'],'north-texas-cf':['northtexascf.org'],'silicon-valley-cf':['svcf.org','siliconvalleycf.org'],'austin-community-foundation':['austincf.org'],'foundation-for-the-carolinas':['fftc.org'],'columbus-foundation':['columbusfoundation.org'],'central-indiana-cf':['cicf.org'],'san-francisco-foundation':['sff.org'],'seattle-foundation':['seattlefoundation.org'],'denver-foundation':['denverfoundation.org'],'oklahoma-city-cf':['occf.org'],'cf-middle-tennessee':['cfmt.org'],'el-paso-cf':['epcf.org'],'nevada-community-foundation':['nevadacf.org'],'boston-foundation':['tbf.org'],'cleveland-foundation':['clevelandfoundation.org']};
test('community foundation registry lists only curl-verified official domains',()=>{
 const verified=cf.communityFoundations.filter(f=>f.status==='verified');
 assert.deepEqual(Object.fromEntries(verified.map(f=>[f.id,f.domains])),FOUNDATIONS);
 assert.deepEqual(cf.verifiedFoundationIds().sort(),Object.keys(FOUNDATIONS).sort());
 assert.equal(new Set(cf.communityFoundations.map(f=>f.id)).size,cf.communityFoundations.length);
 for(const f of cf.communityFoundations){assert.ok(states.sourceForState(f.stateCode),f.id);assert.ok(f.city);if(f.county!==null)assert.match(f.county,/ County$/);}
 for(const f of verified){assert.match(f.grantsUrl,/^https:\/\//);assert.equal(cf.foundationEvidenceHostAllowed(f,f.grantsUrl),true,f.grantsUrl);}
 const held=cf.communityFoundations.filter(f=>f.status!=='verified');assert.deepEqual(held.map(f=>f.id).sort(),['arizona-community-foundation','chicago-community-trust','ny-community-trust']);
 for(const f of held){assert.deepEqual(f.domains,[]);assert.equal(cf.foundationEvidenceHostAllowed(f,'https://www.cct.org/grants'),false);}
 assert.ok(!JSON.stringify(cf.communityFoundations).includes('thecommunityfoundation.org'),'DC foundation is not listed (DC not in the state registry)');
});
test('foundation evidence is exact host only',()=>{
 const f=cf.foundationById('austin-community-foundation');
 for(const u of ['https://austincf.org/x','https://www.austincf.org/apply-for-funding/grants/','https://WWW.AUSTINCF.ORG/a'])assert.equal(cf.foundationEvidenceHostAllowed(f,u),true,u);
 for(const u of ['https://grants.austincf.org/x','https://austincf.org.evil.com/x','https://fakeaustincf.org/','https://www.austintexas.gov/','javascript:alert(1)','not a url'])assert.equal(cf.foundationEvidenceHostAllowed(f,u),false,u);
 const sv=cf.foundationById('silicon-valley-cf');assert.equal(cf.foundationEvidenceHostAllowed(sv,'https://www.siliconvalleycf.org/'),true);
 assert.equal(cf.foundationById('nope'),undefined);assert.equal(cf.foundationById(5),undefined);
});
test('foundationize relabels a state-shaped lead as a community foundation grant',()=>{
 const tx=states.sourceForState('TX'),f=cf.foundationById('austin-community-foundation');
 const g=scan.stateRecord(tx,'business',{url:'https://www.austincf.org/apply-for-funding/grants/',title:'Community Grants Program',context:'Grants for nonprofits.'},'https://www.austincf.org/apply-for-funding/grants/','2026-10-25T12:00:00Z');
 const hash=g.id.split('-').pop();cf.foundationize(g,f,'Texas','business');
 assert.equal(g.id,'cf-austin-community-foundation-'+hash);assert.equal(g.kind,'Community foundation grant');assert.equal(g.funder,'Austin Community Foundation');assert.equal(g.sourceType,'community-foundation');
 assert.deepEqual(g.types,['Nonprofit','Small business']);assert.ok(g.tags.includes('community foundation'));assert.match(g.source,/Community foundation$/);
 const s=cf.foundationize(scan.stateRecord(tx,'aid',{url:'https://www.austincf.org/s',title:'Austin Scholarship Fund',context:'Scholarships.'},'https://www.austincf.org/s','2026-10-25T12:00:00Z'),f,'Texas','aid');assert.equal(s.kind,'Scholarship');assert.deepEqual(s.types,['Student']);
});
test('stateRecord carries city and county for city leads only',()=>{
 const tx=states.sourceForState('TX'),now='2026-10-25T12:00:00Z',link={url:'https://www.austintexas.gov/g',title:'Austin Small Business Grant',context:'Grants.'};
 const c=scan.stateRecord(tx,'business',link,link.url,now,{city:'Austin',county:'Travis County'});assert.equal(c.city,'Austin');assert.equal(c.county,'Travis County');assert.deepEqual(c.cities,['Austin']);
 const s=scan.stateRecord(tx,'business',link,link.url,now);assert.equal(s.city,undefined);assert.equal(s.county,undefined);
});

test('research plan: Wave 2 cities and foundations only for profiles that live there',()=>{
 const austin={...base,id:'a',type:'Small business',state:'TX',city:'Austin'},student={...base,id:'s',type:'Student',state:'TX',city:'austin '},tx={...base,id:'t',type:'Small business',state:'TX'};
 const none=plan.planResearchTasks({profiles:[tx],reports:empty,research:empty,now:at,limit:20});
 assert.ok(!none.tasks.some(t=>t.cityId==='austin-tx'||t.scope==='foundation'));assert.equal(none.pendingFoundations.length,0);
 const r=plan.planResearchTasks({profiles:[austin,student],reports:empty,research:empty,now:at,limit:20});const ids=r.tasks.map(t=>t.taskId);
 for(const id of ['city-austin-tx-business','foundation-austin-community-foundation-business','foundation-austin-community-foundation-aid'])assert.ok(ids.includes(id),id);
 assert.ok(!ids.includes('city-austin-tx-arts'));assert.ok(!ids.some(i=>i.startsWith('foundation-greater-houston')));
 const t=r.tasks.find(t=>t.taskId==='foundation-austin-community-foundation-business');
 assert.deepEqual(t.localHosts,['austincf.org']);assert.equal(t.foundationId,'austin-community-foundation');assert.equal(t.revisitDays,14);assert.equal(t.county,'Travis County');assert.equal(t.source,'https://www.austincf.org/apply-for-funding/grants/');
 assert.equal(r.tasks.find(t=>t.taskId==='city-austin-tx-business').revisitDays,14);
 // Pending sources are listed, never tasked.
 const fw=plan.planResearchTasks({profiles:[{...austin,city:'Fort Worth'},{...base,id:'c',type:'Nonprofit',state:'IL',city:'Chicago'}],reports:empty,research:empty,now:at,limit:20});
 assert.ok(fw.pendingCities.some(c=>c.cityId==='fort-worth-tx'));assert.ok(fw.pendingFoundations.some(f=>f.foundationId==='chicago-community-trust'));
 assert.ok(fw.tasks.some(t=>t.taskId==='foundation-north-texas-cf-business'));assert.ok(!fw.tasks.some(t=>t.foundationId==='chicago-community-trust'||t.cityId==='fort-worth-tx'));
 // Rotation: a researched foundation task waits 14 days.
 const done=new Map([[plan.foundationResearchKey('austin-community-foundation','business'),{checkedAt:new Date(at-3600000).toISOString()}]]);
 assert.ok(!plan.planResearchTasks({profiles:[austin],reports:empty,research:done,now:at,limit:20}).tasks.some(t=>t.taskId==='foundation-austin-community-foundation-business'));
 assert.ok(plan.planResearchTasks({profiles:[austin],reports:empty,research:done,now:at+14*86400000,limit:20}).tasks.some(t=>t.taskId==='foundation-austin-community-foundation-business'));
 assert.equal(plan.foundationResearchKey('x','arts'),'research-foundation-x-arts');
});

test('city and county inputs are validated and normalized',()=>{
 assert.equal(geo.cleanPlace(undefined,'city'),undefined);assert.equal(geo.cleanPlace(null,'county'),null);
 assert.equal(geo.cleanPlace('  San   Antonio ','city'),'San Antonio');assert.equal(geo.cleanPlace("Coeur d'Alene",'city'),"Coeur d'Alene");assert.equal(geo.cleanPlace('Winston-Salem','city'),'Winston-Salem');assert.equal(geo.cleanPlace('St. Louis','city'),'St. Louis');assert.equal(geo.cleanPlace('Española','city'),'Española');
 assert.equal(geo.cleanPlace('Travis','county'),'Travis County');assert.equal(geo.cleanPlace('Travis County','county'),'Travis County');assert.equal(geo.cleanPlace('Orleans Parish','county'),'Orleans Parish');assert.equal(geo.cleanPlace('Juneau City and Borough','county'),'Juneau City and Borough');
 for(const bad of ['', 'A', 'x'.repeat(81), '<script>', 'Austin; DROP TABLE', '123 Main', 'Austin\u0000', 'Aus|tin', '-Austin', 'https://evil.com'])assert.throws(()=>geo.cleanPlace(bad,'city'),geo.PlaceError,JSON.stringify(bad));
 for(const bad of [5,{},[],true])assert.throws(()=>geo.cleanPlace(bad,'county'),geo.PlaceError);
});
test('city/county filter helpers',()=>{
 const g=(id,extra)=>({id,title:id,states:['Texas'],...extra});
 const list=[g('a',{city:'Austin',county:'Travis County'}),g('b',{cities:['Houston']}),g('c',{}),g('d',{city:'Columbus',county:'Franklin County',states:['Ohio']}),g('e',{cities:['Austin','Dallas']}),g('f',{city:null,county:'Travis County'})];
 assert.equal(geo.grantCity(list[1]),'Houston');assert.equal(geo.grantCity(list[4]),null);assert.equal(geo.grantCounty(list[2]),null);
 assert.deepEqual(geo.placeOptions(list),{cities:['Austin, Texas','Columbus, Ohio','Houston, Texas'],counties:['Franklin County, Ohio','Travis County, Texas']});
 assert.deepEqual(list.filter(x=>geo.matchesPlace(x,'Austin, Texas','')).map(x=>x.id),['a']);
 assert.deepEqual(list.filter(x=>geo.matchesPlace(x,'','Travis County, Texas')).map(x=>x.id),['a','f']);
 assert.deepEqual(list.filter(x=>geo.matchesPlace(x,'','')).map(x=>x.id),list.map(x=>x.id));
 assert.deepEqual(list.filter(x=>geo.matchesPlace(x,'Columbus, Texas','')).map(x=>x.id),[]);
});
test('geo mirror is best-effort: missing 0002 columns return false without throwing',async()=>{
 const calls=[];const stmt=sql=>({bind:(...v)=>({sql,v,run:async()=>{calls.push(v);}})});
 const ok={prepare:stmt,batch:async s=>{for(const x of s)calls.push(x.v);}};
 assert.equal(await geo.mirrorCatalogGeo(ok,[{id:'a',city:'Austin',county:'Travis County'},{id:'b',cities:['Houston']}]),true);
 assert.deepEqual(calls,[['Austin','Travis County','a'],['Houston',null,'b']]);
 const missing={prepare:stmt,batch:async()=>{throw new Error('D1_ERROR: no such column: city: SQLITE_ERROR');}};
 assert.equal(await geo.mirrorCatalogGeo(missing,[{id:'a',city:'Austin'}]),false);
 assert.equal(await geo.mirrorCatalogGeo(missing,[]),true);
 assert.equal(geo.GEO_MIRROR_SQL,'UPDATE catalog SET city = ?, county = ? WHERE id = ?');
});

test('migration 0002 is additive and nullable; reads never depend on it',()=>{
 const sql=read('drizzle/0002_catalog_city_county.sql');
 const stmts=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
 assert.deepEqual(stmts,['ALTER TABLE `catalog` ADD `city` text;','ALTER TABLE `catalog` ADD `county` text;','CREATE INDEX `catalog_city_idx` ON `catalog` (`city`);','CREATE INDEX `catalog_county_idx` ON `catalog` (`county`);']);
 assert.doesNotMatch(sql,/DROP|NOT NULL|DEFAULT|RENAME|DELETE|UPDATE/i);
 const journal=JSON.parse(read('drizzle/meta/_journal.json'));assert.ok(journal.entries.some(e=>e.tag==='0002_catalog_city_county'));
 const tags=journal.entries.map(e=>e.tag);assert.deepEqual([...tags].sort(),tags,'journal entries stay in filename order');assert.deepEqual(journal.entries.map(e=>e.idx),tags.map((_,i)=>i));
 const snap=JSON.parse(read('drizzle/meta/0002_snapshot.json'));assert.equal(snap.tables.catalog.columns.city.notNull,false);assert.equal(snap.tables.catalog.columns.county.notNull,false);
 assert.match(read('db/schema.ts'),/city: text\('city'\), county: text\('county'\)/);
 for(const f of ['lib/discovery.ts','lib/state-research.ts','lib/catalog.ts','app/api/workspace/route.ts','app/page.tsx'])assert.doesNotMatch(read(f),/select\(\)\.from\(catalog\)/,f);
});
test('MCP: record/mark accept foundationId, city and county; serverInfo stays grantwell; refresh input unchanged',()=>{
 const route=read('app/mcp/route.ts');
 assert.match(route,/serverInfo:\{name:'grantwell'/);
 assert.match(route,/foundationId:\{type:'string',enum:researchFoundationIds\},city:placeSchema\('city'\),county:placeSchema\('county'\)/);
 assert.match(route,/foundationId:\{type:'string',enum:researchFoundationIds\},category:\{type:'string',enum:\[\.\.\.STATE_CATEGORIES\]\},summary/);
 assert.match(route,/name:'refresh_grants'[\s\S]*?inputSchema:\{type:'object',properties:\{\},additionalProperties:false\}/);
 assert.match(route,/Wave 2 cities/);
 const research=read('lib/state-research.ts');assert.match(research,/cleanPlace\(r\.city,'city'\)/);assert.match(research,/cleanPlace\(r\.county,'county'\)/);assert.match(research,/foundationEvidenceHostAllowed\(foundation,sourceUrl\)/);
});
test('no user-facing Grantwell; the 45-fetch cap is unchanged and new modules make no requests',()=>{
 const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?walk(p):[p];});
 for(const f of [...walk('app'),...walk('components'),...walk('public')].filter(f=>/\.(tsx?|css|html|json|txt|md|svg)$/.test(f)))if(!f.endsWith('app/mcp/route.ts'))assert.doesNotMatch(read(f),/grantwell/i,f);
 assert.equal((read('app/mcp/route.ts').match(/grantwell/gi)||[]).length,1);
 assert.equal(budget.RUN_FETCH_LIMIT,45);
 for(const f of ['lib/community-foundations.ts','lib/catalog-geo.ts','lib/city-registry.ts','lib/research-plan.ts'])assert.doesNotMatch(read(f),/\bfetch\(|budgetedFetch/,f);
});
test('dashboard offers City and County filters that reset with the others',()=>{
 const d=read('app/dashboard.tsx');
 assert.match(d,/aria-label="Filter by city"/);assert.match(d,/aria-label="Filter by county"/);
 assert.match(d,/matchesPlace\(x\.g,cityFilter,countyFilter\)/);assert.match(d,/setCityFilter\(''\);setCountyFilter\(''\);/);
 assert.match(d,/'Community foundation grant'/);
});
