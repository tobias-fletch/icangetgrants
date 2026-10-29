import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out=resolve('.sites-runtime/tests-privacy');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','state-registry','access','workspace-privacy']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const privacy=await import(pathToFileURL(`${out}/workspace-privacy.mjs`).href);
const access=await import(pathToFileURL(`${out}/access.mjs`).href);

// Shape of the stored last-refresh job (trimmed from a real run).
const lastRefresh={checkedAt:'2026-10-23T13:01:45.446Z',checked:401,newGrants:3,newMatchedOpportunities:2,cursor:7,
 profileCoverage:[{profileId:'private-profile',matches:12,newMatches:1}],errors:['X: private'],
 coverage:'All 50 states have business-funding and student-aid source routes, with per-state scholarship searches.',
 sources:[{name:'Grants.gov',status:'Connected',records:89,queries:3,note:'2/2 interest searches; up to 100 results each.'},
  {name:'CareerOneStop Scholarship Finder',status:'Connected',records:169,queries:4,note:"Every monitored student's state plus national coverage is searched each run; 3 searches."},
  {name:'50-state funding sources',status:'Connected',records:21,queries:5,note:'2 state business/aid routes checked.'},
  {name:'California Grants Portal',status:'Not needed',records:0,queries:0,note:'Connected state grant feed runs for California profiles.',error:'private'}]};

test('signed-out refresh keeps freshness and static coverage only',()=>{
 const view=privacy.visitorRefresh(lastRefresh);
 assert.deepEqual(Object.keys(view).sort(),['checkedAt','coverage']);
 assert.equal(view.checkedAt,lastRefresh.checkedAt);
 const text=JSON.stringify(view);
 for(const leak of ['Not needed','monitored','interest searches','routes checked','private','401','sources'])assert.equal(text.includes(leak),false,leak);
 assert.equal(privacy.visitorRefresh(null),null);
 assert.deepEqual(privacy.visitorRefresh({checked:4}),{});
});

test('owner projection is unchanged and still drops private run internals',()=>{
 const view=access.publicRefresh(lastRefresh);
 assert.equal(view.sources.length,4);assert.equal(view.profileCoverage,undefined);assert.equal(view.cursor,undefined);assert.equal(view.sources[3].error,undefined);
});

const reports=[{code:'NY',state:'New York',category:'business',status:'Directory checked',records:0},{code:'LA',state:'Louisiana',category:'aid',status:'Program leads found',records:21},{code:'CA',state:'California',category:'arts',status:'Program leads found',records:2}];
const student={id:'a',name:'Me',type:'Student',country:'USA',state:'LA',keywords:'science',goal:0,education:'Undergraduate',details:'',alerts:true};

test('signed-out visitors get no state scan reports',()=>{
 assert.deepEqual(privacy.visibleStateCoverage(reports,[]),[]);
 assert.deepEqual(privacy.visibleStateCoverage(reports,undefined),[]);
});

test('signed-in accounts see only routes their own profiles schedule',()=>{
 assert.deepEqual(privacy.visibleStateCoverage(reports,[student]).map(r=>r.code+'-'+r.category),['LA-aid']);
 assert.deepEqual(privacy.visibleStateCoverage(reports,[{...student,type:'Small business',state:'New York'}]).map(r=>r.code),['NY']);
 assert.deepEqual(privacy.visibleStateCoverage(reports,[{...student,country:'Canada'}]),[]);
});

test('owner sees every state scan report',()=>{assert.equal(privacy.visibleStateCoverage(reports,[],true).length,3);});

test('CareerOneStop links drop the search keyword and residency filter but keep the record',()=>{
 const url='https://www.careeronestop.org/Toolkit/Training/find-scholarships-detail.aspx?keyword=science&pagesize=50&curPage=1&georestrictionfilter=Louisiana&scholarshipId=9990527';
 assert.equal(privacy.stripSearchContext(url),'https://www.careeronestop.org/Toolkit/Training/find-scholarships-detail.aspx?scholarshipId=9990527');
 const gov='https://www.grants.gov/search-results-detail/363728?keyword=x';assert.equal(privacy.stripSearchContext(gov),gov);
 assert.equal(privacy.stripSearchContext('not a url'),'not a url');
 const grants=[{id:'cos-1',url,states:['Louisiana']},{id:'gov-1',url:gov}];const safe=privacy.visitorGrants(grants);
 assert.equal(safe[0].id,'cos-1');assert.deepEqual(safe[0].states,['Louisiana']);assert.equal(safe[0].url.includes('keyword'),false);assert.equal(safe[0].url.includes('Louisiana'),false);
 assert.equal(safe[1],grants[1]);assert.equal(grants[0].url,url);
});

test('workspace API and home page use the visitor projections',()=>{
 const route=readFileSync('app/api/workspace/route.ts','utf8');const get=route.slice(route.indexOf('export async function GET'),route.indexOf('export async function PUT'));
 assert.match(get,/loadCatalog\(\{owner,keepIds:u\?state\.saved\.map\(s=>s\.grantId\):\[\]\}\)/);assert.match(get,/visibleStateCoverage\(reports,state\.profiles,owner\)/);assert.match(get,/const reports=u\?/);
 const catalog=readFileSync('lib/catalog.ts','utf8');assert.match(catalog,/owner \? publicRefresh\(last\) : visitorRefresh\(last\)/);assert.match(catalog,/visitorGrants\(await allGrants\(\)\)/);
 // The home page reads the memoized visitor view: loadPublicCatalog() is readCatalog with no owner and no saved ids.
 const page=readFileSync('app/page.tsx','utf8');assert.match(page,/loadPublicCatalog\(\)/);assert.doesNotMatch(page,/owner/);assert.match(catalog,/const value = await readCatalog\(false, \[\]\)/);
 // The cacheable public API branch runs before any identity read.
 assert.ok(get.indexOf("searchParams.get('public')==='1'")<get.indexOf('getCurrentUser()'));assert.doesNotMatch(route.slice(route.indexOf('async function publicResults'),route.indexOf('export async function GET')),/getCurrentUser|getChatGPTUser|cookie|getWorkspace/);
});
