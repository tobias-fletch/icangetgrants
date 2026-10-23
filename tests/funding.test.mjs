import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const out=resolve('.sites-runtime/tests');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','programs','state-registry','state-discovery','access','notifications']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const parser=await import(pathToFileURL(`${out}/source-parsers.mjs`).href);
const {match,seeds,newOpportunityItems,NEW_ITEM_LIMIT,newItemsSchemaProperties}=await import(pathToFileURL(`${out}/grants.mjs`).href);
const now='2026-10-18T21:00:00Z';
const p={id:'test',name:'Synthetic student',type:'Student',country:'USA',state:'NY',keywords:'engineering, technology',goal:5000,education:'Undergraduate',details:'',alerts:true};
test('state and country aliases normalize without substring matching',()=>{assert.equal(parser.stateName('ny'),'New York');assert.equal(parser.countryName('USA'),'United States');assert.equal(parser.stateName('california'),'California');assert.ok(match(seeds[3],p).score>0);});
test('state, education, applicant and expired deadlines are exclusions',()=>{const g={...seeds[3],states:['California'],studyLevels:['Undergraduate']};assert.equal(match(g,p).score,0);assert.equal(match({...g,states:['New York'],studyLevels:['Graduate']},p).score,0);assert.equal(match(seeds[1],p).score,0);assert.equal(match({...seeds[3],deadline:'2000-01-01'},p).score,0);});
test('no keyword substring matches inside unrelated words',()=>{const g={...seeds[0],kind:'Federal grant',title:'Department support',description:'Department infrastructure',tags:[]};assert.equal(match(g,{...p,type:'Individual',keywords:'art'}).score,0);});
test('CSV supports embedded commas, escaped quotes and newlines',()=>{const rows=parser.csvRows('Title,Description\r\n"A, B","Line 1\nLine ""2"""\r\n');assert.equal(rows[0].Title,'A, B');assert.equal(rows[0].Description,'Line 1\nLine "2"');});
test('state feed excludes loans, closed programs and public-agency-only applicants',()=>{const csv='PortalID,Status,Type,ApplicantType,Title,ApplicationDeadline,GrantURL\n1,active,Grant,Business,Equipment grant,2026-12-01,https://example.org/a\n2,active,Loan,Business,Loan,2026-12-01,https://example.org/b\n3,closed,Grant,Business,Closed,2026-12-01,https://example.org/c\n4,active,Grant,Public Agency,Government only,2026-12-01,https://example.org/d';const rows=parser.parseCalifornia(csv,now);assert.equal(rows.length,1);assert.deepEqual(rows[0].states,['California']);});
test('scholarship recurring month gets no invented year and preserves study level',()=>{const html='<table class="cos-table-responsive"><tr><td headers="thAN"><a href="/Toolkit/Training/find-scholarships-detail.aspx?scholarshipId=123">Engineering Scholarship</a>Organization:<div>Example Foundation</div></td><td headers="thLOS">Bachelor\'s Degree</td><td headers="thAT">Scholarship</td><td headers="thAA">$1,000</td><td headers="thD">October</td></tr></table>';const g=parser.parseScholarships(html,now,{country:'United States',state:'NY'})[0];assert.equal(g.deadline,null);assert.equal(g.status,'Verify cycle');assert.deepEqual(g.studyLevels,['Undergraduate']);assert.deepEqual(g.states,['New York']);assert.equal(g.amount,1000);assert.throws(()=>parser.parseScholarships('<html>Changed</html>',now,{country:'United States'}));});
test('URL schemes and competition labels remain distinct',()=>{assert.equal(parser.safeUrl('javascript:alert(1)','https://example.org'),null);const html='<div class="views-row views-row-1"><div class="views-field views-field-field-award-issuer">Example Foundation</div><div class="views-field views-field-title"><a href="/writing_contests/example">Poetry Prize</a></div><div class="views-field views-field-field-deadline">Application Deadline: 10/31/26</div>';const g=parser.parsePrivateAwards(html,now)[0];assert.equal(g.kind,'Award / competition');assert.equal(g.deadline,'2026-10-31');});
test('business guide excludes investments and keeps state funding jurisdiction',()=>{const html='<h2>General small business grants</h2><ul><li><strong>37 Angels</strong><a href="https://example.org">Invest</a>Investment, not grant funding.</li><li><strong>Global NY Grant Program</strong><a href="https://esd.ny.gov/global-ny">Grant program</a>Small business grant program.</li></ul><h2>Additional resources</h2>';const rows=parser.parseBusinessGrants(html,now);assert.equal(rows.length,1);assert.equal(rows[0].kind,'State grant');assert.deepEqual(rows[0].states,['New York']);assert.equal(match(rows[0],{...p,type:'Small business',state:'CA',keywords:'business'}).score,0);});
test('multi-interest search expands and caps terms',()=>{const terms=parser.interests({...p,keywords:'education, technology, writing'});assert.ok(terms.includes('training'));assert.ok(terms.includes('innovation'));assert.ok(terms.length<=6);});

const stateModule=await import(pathToFileURL(out+'/state-registry.mjs').href);
const stateScan=await import(pathToFileURL(out+'/state-discovery.mjs').href);
test('all 50 states have both business and aid routes and normalized routing',()=>{assert.equal(stateModule.stateSources.length,50);assert.equal(new Set(stateModule.stateSources.map(s=>s.code)).size,50);for(const s of stateModule.stateSources){assert.ok(s.state);assert.ok(Array.isArray(s.localHosts));assert.ok(new URL(s.business.url));assert.ok(new URL(s.aid.url));assert.equal(stateModule.sourceForState(s.code.toLowerCase()).state,s.state);assert.equal(stateModule.sourceForState(s.state.toLowerCase()).code,s.code);}});
test('New York city hosts and configured state hosts are accepted; lookalikes are not',()=>{
 const ny=stateModule.sourceForState('NY');
 assert.deepEqual(ny.localHosts,['nyc.gov','nyc-business.nyc.gov']);
 assert.deepEqual(stateModule.stateSources.filter(s=>s.localHosts.length).map(s=>s.code),['NY']);
 for(const host of ['nyc-business.nyc.gov','nyc.gov','www1.nyc.gov','www.nyc.gov','esd.ny.gov','www.hesc.ny.gov','hesc.ny.gov','health.ny.gov','www.ny.gov','NYC-BUSINESS.NYC.GOV'])assert.equal(stateModule.evidenceHostAllowed(ny,`https://${host}/program`),true,host);
 assert.equal(stateModule.evidenceHostAllowed(ny,'http://programs.nyc-business.nyc.gov/apply'),true);
 for(const host of ['evilnyc.gov','nyc.gov.evil.com','example.com','notnyc.gov','fake.ny.example.gov','esd.ny.gov.evil.com'])assert.equal(stateModule.evidenceHostAllowed(ny,`https://${host}/new-york`),false,host);
 assert.equal(stateModule.evidenceHostAllowed(ny,'https://evil.gov/grants/new-york-business'),false);
 assert.equal(stateModule.evidenceHostAllowed(ny,'javascript:alert(1)//nyc.gov'),false);
 const ak=stateModule.sourceForState('AK');
 assert.equal(stateModule.evidenceHostAllowed(ak,'https://www.aksbdc.org/help'),true);
 assert.equal(stateModule.evidenceHostAllowed(ak,'https://evil.aksbdc.org/help'),false);
 assert.equal(stateModule.evidenceHostAllowed(ak,'https://nyc.gov/'),false);
});
test('new opportunity items keep title, url, funder, and null deadlines, with matches first and a cap',()=>{
 const rows=[{id:'a',title:'Alpha grant',url:'https://esd.ny.gov/a',funder:'Empire State Development',deadline:undefined},{id:'b',title:'Beta grant',url:'https://nyc.gov/b',funder:'NYC',deadline:null},{id:'c',title:'Gamma grant',url:'https://nyc-business.nyc.gov/c',funder:'NYC SBS',deadline:'2026-12-01'}];
 const capped=newOpportunityItems(rows,['c','missing'],2);
 assert.equal(capped.newItemsTotal,3);
 assert.deepEqual(capped.newItems,[{title:'Gamma grant',url:'https://nyc-business.nyc.gov/c',funder:'NYC SBS',deadline:'2026-12-01'},{title:'Alpha grant',url:'https://esd.ny.gov/a',funder:'Empire State Development',deadline:null}]);
 assert.deepEqual(Object.keys(capped.newItems[0]).sort(),['deadline','funder','title','url']);
 const many=Array.from({length:NEW_ITEM_LIMIT+5},(_,i)=>({id:'n'+i,title:'Grant '+i,url:'https://ny.gov/'+i,funder:'New York',deadline:i===NEW_ITEM_LIMIT+4?'2026-11-01':null}));
 const listed=newOpportunityItems(many,['n'+(NEW_ITEM_LIMIT+4)]);
 assert.equal(listed.newItemsTotal,many.length);
 assert.equal(listed.newItems.length,NEW_ITEM_LIMIT);
 assert.equal(listed.newItems[0].title,'Grant '+(NEW_ITEM_LIMIT+4));
 assert.equal(listed.newItems[0].deadline,'2026-11-01');
 assert.ok(listed.newItems.slice(1).every(item=>item.deadline===null));
 assert.equal(newItemsSchemaProperties.newItems.maxItems,NEW_ITEM_LIMIT);
 assert.deepEqual(newItemsSchemaProperties.newItems.items.required,['title','url','funder','deadline']);
 assert.deepEqual(newItemsSchemaProperties.newItems.items.properties.deadline.type,['string','null']);
 assert.equal(newItemsSchemaProperties.newItems.items.additionalProperties,false);
});
test('refresh and record tools keep their names and publish the new item fields',()=>{
 const route=readFileSync('app/mcp/route.ts','utf8');
 const research=readFileSync('lib/state-research.ts','utf8');
 const discovery=readFileSync('lib/discovery.ts','utf8');
 assert.match(route,/name:'refresh_grants'/);
 assert.match(route,/name:'record_state_opportunities'/);
 assert.match(route,/outputSchema:refreshOutput/);
 assert.match(route,/outputSchema:recordOutput/);
 assert.match(route,/newItemsSchemaProperties/);
 assert.match(route,/newGrants/);
 assert.match(route,/persistedIds/);
 assert.match(research,/evidenceHostAllowed\(state,sourceUrl\)/);
 assert.match(research,/localHosts:t\.source\.localHosts/);
 assert.match(research,/newOpportunityItems\(newRecords,matchedNew\.map\(g=>g\.id\)\)/);
 assert.match(discovery,/newOpportunityItems\(newRecords,matchedNew\.map\(g=>g\.id\)\)/);
 assert.match(discovery,/newGrants:newRecords\.length,newMatchedOpportunities:matchedNew\.length/);
 assert.doesNotMatch(research,/host\.includes\('\.'\+state\.code/);
});
test('all 50 locations plan business and aid checks without duplicates',()=>{const profiles=stateModule.stateSources.flatMap(s=>[{...p,id:s.code+'b',type:'Small business',state:s.code},{...p,id:s.code+'a',state:s.state}]);assert.equal(stateModule.statePlan(profiles).length,100);assert.equal(stateModule.statePlan([...profiles,...profiles]).length,100);assert.equal(stateModule.statePlan(profiles.map(p=>({...p,alerts:false}))).length,0);});
test('directories, loan programs, administrative memos and national aid are not state grants',()=>{const html='<main><a href="/grants">Grants and Scholarships</a><a href="/loans">Business Loan</a><a href="/memo">10/01/2026 TEXAS Grant Allocations Memo</a><a href="https://studentaid.gov/pell">Federal Pell Grant</a><a href="/equipment">Ohio Equipment Grant</a></main>';const links=stateScan.extractStateLinks(html,'https://example.gov/','business');assert.equal(links.filter(l=>!l.hub).length,1);assert.equal(links.filter(l=>!l.hub)[0].title,'Ohio Equipment Grant');assert.ok(links.find(l=>l.title==='Grants and Scholarships').hub);});
test('state scanner follows funding hubs within request budget and keeps programs conditional',async()=>{const source=stateModule.sourceForState('OH');let calls=0;const fake=async url=>{calls++;return url===source.business.url?'<main><a href="/funding">Funding</a></main>':'<main><a href="/equipment-grant">Equipment Grant</a></main>';};const result=await stateScan.scanState(source,'business',fake,now);assert.ok(calls<=3);assert.equal(result.records.length,1);const g=result.records[0];assert.deepEqual(g.states,['Ohio']);assert.equal(g.eligibilityVerified,false);assert.equal(g.amount,null);assert.equal(g.deadline,null);assert.equal(match(g,{...p,type:'Small business',state:'NY',keywords:'equipment'}).score,0);assert.ok(match(g,{...p,type:'Small business',state:'OH',keywords:'equipment'}).score<=65);});
test('blocked state source reports browser review and creates no placeholder opportunity',async()=>{const result=await stateScan.scanState(stateModule.sourceForState('DE'),'aid',async()=>{throw Error('HTTP 403');},now);assert.equal(result.records.length,0);assert.equal(result.report.status,'Browser review');});

test('accordion programs keep distinct IDs and exclude administration',async()=>{const html='<main><h2>College Access Grant</h2><h2>Teaching Scholarship</h2><h2>Grant Calendar</h2><a href="/admin">TEXAS Grant Reporting Forms</a></main>';const result=await stateScan.scanState(stateModule.sourceForState('KY'),'aid',async()=>html,now);assert.deepEqual(result.records.map(g=>g.title).sort(),['College Access Grant','Teaching Scholarship']);assert.equal(new Set(result.records.map(g=>g.id)).size,2);});

test('repeated program headings across linked pages deduplicate',async()=>{const result=await stateScan.scanState(stateModule.sourceForState('KY'),'aid',async()=>'<main><a href="/grants">Grants and Scholarships</a><h2>College Access Grant</h2></main>',now);assert.equal(result.records.length,1);assert.equal(result.report.records,1);});

const access=await import(pathToFileURL(out+'/access.mjs').href);
test('catalog administration allows only pinned owner and never production local identities',()=>{assert.equal(access.ownerAccess(null),false);assert.equal(access.ownerAccess({userId:'some-other-account'}),false);assert.equal(access.ownerAccess({userId:access.OWNER_USER_ID}),true);assert.equal(access.ownerAccess({userId:'local_seedy'}),false);assert.equal(access.ownerAccess({userId:'local_seedy'},true),true);});
test('public refresh projection excludes profile IDs, counts and internal search cursor',()=>{const view=access.publicRefresh({checkedAt:now,checked:4,profileCoverage:[{profileId:'private-id'}],cursor:12,newMatchedOpportunities:3,sources:[{name:'State source',records:4,note:'Public programs',error:'private metadata'}]});assert.equal(view.profileCoverage,undefined);assert.equal(view.cursor,undefined);assert.equal(view.newMatchedOpportunities,undefined);assert.equal(view.sources[0].error,undefined);assert.equal(view.sources[0].records,4);assert.equal(access.publicRefresh(null),null);});

const notifications=await import(pathToFileURL(out+'/notifications.mjs').href);
const alertGrant={...seeds[3],id:'alert-test',states:['New York'],deadline:null,discovered:'2026-10-19T15:00:00.000Z'};
test('inbox includes all matching monitored profiles and excludes paused or wrong-state profiles',()=>{const profiles=[{...p,id:'one',state:'NY'},{...p,id:'two',state:'New York'},{...p,id:'paused',alerts:false},{...p,id:'other',state:'LA'}];const inbox=notifications.inboxMatches([alertGrant],profiles,'','2026-10-19T16:00:00Z');assert.equal(inbox.length,1);assert.deepEqual(inbox[0].profiles.map(f=>f.p.id),['one','two']);assert.equal(notifications.inboxMatches([alertGrant],[{...p,alerts:false}],'').length,0);});
test('inbox is scoped to provided account profiles and excludes closed, old and reviewed records',()=>{assert.equal(notifications.inboxMatches([alertGrant],[{...p,state:'LA'}],'').length,0);assert.equal(notifications.inboxMatches([alertGrant],[p],'2026-10-19T15:00:00.000Z').length,0);assert.equal(notifications.inboxMatches([{...alertGrant,status:'Closed'}],[p],'').length,0);assert.equal(notifications.inboxMatches([{...alertGrant,discovered:'2026-10-18'}],[p],'').length,0);assert.equal(notifications.inboxMatches([{...alertGrant,deadline:'2000-01-01'}],[p],'').length,0);});
test('review watermark covers visible inbox records without hiding later arrivals',()=>{const items=notifications.inboxMatches([alertGrant],[p],'');const seen=notifications.reviewedThrough(items,'');assert.equal(seen,alertGrant.discovered);assert.equal(notifications.inboxMatches([alertGrant,{...alertGrant,id:'later',discovered:'2026-10-19T15:01:00.000Z'}],[p],seen).length,1);assert.equal(notifications.reviewedThrough([],seen),seen);});
