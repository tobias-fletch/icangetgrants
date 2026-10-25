import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const out=resolve('.sites-runtime/tests');mkdirSync(out,{recursive:true});
for(const name of ['source-parsers','grants','programs','state-registry','state-discovery','access','notifications','listing','city-registry','community-foundations','research-plan','fetch-budget']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const parser=await import(pathToFileURL(`${out}/source-parsers.mjs`).href);
const {match,seeds,newOpportunityItems,NEW_ITEM_LIMIT,newItemsSchemaProperties,isOpenOpportunity,profileMatches}=await import(pathToFileURL(`${out}/grants.mjs`).href);
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
 assert.deepEqual(ny.localHosts,['nyc.gov','nyc-business.nyc.gov','edc.nyc','nycedc.com']);
 assert.deepEqual(stateModule.stateSources.filter(s=>s.localHosts.length).map(s=>s.code),['NY']);
 for(const host of ['nyc-business.nyc.gov','nyc.gov','www1.nyc.gov','www.nyc.gov','esd.ny.gov','www.hesc.ny.gov','hesc.ny.gov','health.ny.gov','www.ny.gov','NYC-BUSINESS.NYC.GOV'])assert.equal(stateModule.evidenceHostAllowed(ny,`https://${host}/program`),true,host);
 assert.equal(stateModule.evidenceHostAllowed(ny,'http://programs.nyc-business.nyc.gov/apply'),true);
 // The 9 AM run's rejected NYC programs: Customized Training Grant and Gowanus Business Relocation Grant.
 assert.equal(stateModule.evidenceHostAllowed(ny,'https://nyc-business.nyc.gov/nycbusiness/business-services/incentives/customized-training'),true);
 assert.equal(stateModule.evidenceHostAllowed(ny,'https://nyc-business.nyc.gov/nycbusiness/description/gowanus-business-relocation-grant'),true);
 for(const host of ['edc.nyc','www.edc.nyc','nycedc.com','www.nycedc.com','sbs.nyc.gov','www1.nyc.gov','portal.esd.ny.gov','dol.ny.gov'])assert.equal(stateModule.evidenceHostAllowed(ny,`https://${host}/grant`),true,host);
 for(const host of ['edc.nyc.evil.com','evil-edc.nyc','nycedc.com.evil.com','fakenycedc.com','nyc.example.com','ny.gov.example.org'])assert.equal(stateModule.evidenceHostAllowed(ny,`https://${host}/grant`),false,host);
 assert.equal(stateModule.govDomain('nyc-business.nyc.gov'),'nyc.gov');
 assert.equal(stateModule.govDomain('www.aksbdc.org'),'');
 // A configured .gov agency host vouches for its registered .gov domain's subdomains; a non-gov configured host stays exact.
 const configuredGov=stateModule.stateSources.find(s=>/\.gov$/.test(new URL(s.business.url).hostname));
 const govHost=stateModule.govDomain(new URL(configuredGov.business.url).hostname);
 assert.equal(stateModule.evidenceHostAllowed(configuredGov,`https://grants-portal.${govHost}/apply`),true);
 assert.equal(stateModule.evidenceHostAllowed(configuredGov,`https://grants-portal.${govHost}.example.com/apply`),false);
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
 assert.deepEqual(capped.newItems,[{title:'Gamma grant',url:'https://nyc-business.nyc.gov/c',funder:'NYC SBS',deadline:'2026-12-01',matched:true,matches:[]},{title:'Alpha grant',url:'https://esd.ny.gov/a',funder:'Empire State Development',deadline:null,matched:false,matches:[]}]);
 assert.deepEqual(Object.keys(capped.newItems[0]).sort(),['deadline','funder','matched','matches','title','url']);
 const details=new Map([['a',[{profileId:'s',profile:'Student',type:'Student',score:40}]],['b',[{profileId:'s',profile:'Student',type:'Student',score:80},{profileId:'biz',profile:'Shop',type:'Small business',score:50}]],['c',[]]]);
 const detailed=newOpportunityItems(rows,details);
 assert.deepEqual(detailed.newItems.map(i=>[i.title,i.matched]),[['Beta grant',true],['Alpha grant',true],['Gamma grant',false]]);
 assert.deepEqual(detailed.newItems[0].matches.map(m=>[m.profile,m.score]),[['Student',80],['Shop',50]]);
 assert.ok(detailed.newItems.every(i=>i.title&&i.url));
 const many=Array.from({length:NEW_ITEM_LIMIT+5},(_,i)=>({id:'n'+i,title:'Grant '+i,url:'https://ny.gov/'+i,funder:'New York',deadline:i===NEW_ITEM_LIMIT+4?'2026-11-01':null}));
 const listed=newOpportunityItems(many,['n'+(NEW_ITEM_LIMIT+4)]);
 assert.equal(listed.newItemsTotal,many.length);
 assert.equal(listed.newItems.length,NEW_ITEM_LIMIT);
 assert.equal(listed.newItems[0].title,'Grant '+(NEW_ITEM_LIMIT+4));
 assert.equal(listed.newItems[0].deadline,'2026-11-01');
 assert.ok(listed.newItems.slice(1).every(item=>item.deadline===null));
 assert.equal(newItemsSchemaProperties.newItems.maxItems,NEW_ITEM_LIMIT);
 assert.deepEqual(newItemsSchemaProperties.newItems.items.required,['title','url','funder','deadline','matched','matches']);
 assert.deepEqual(newItemsSchemaProperties.newItems.items.properties.matches.items.required,['profileId','profile','type','score']);
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
 assert.match(readFileSync('lib/research-plan.ts','utf8'),/localHosts:t\.source\.localHosts/);
 assert.match(research,/newOpportunityItems\(newRecords,matches\)/);
 assert.match(discovery,/newOpportunityItems\(newRecords,matches\)/);
 assert.match(research,/const matches=new Map\(newRecords\.map\(g=>\[g\.id,profileMatches\(g,profiles\)\]\)\)/);
 assert.match(discovery,/const matches=new Map\(newRecords\.map\(g=>\[g\.id,profileMatches\(g,profiles\)\]\)\)/);
 assert.match(discovery,/newGrants:newRecords\.length,newMatchedOpportunities:matchedNew\.length/);
 assert.doesNotMatch(research,/host\.includes\('\.'\+state\.code/);
});
test('all 50 locations plan business and aid checks without duplicates',()=>{const profiles=stateModule.stateSources.flatMap(s=>[{...p,id:s.code+'b',type:'Small business',state:s.code},{...p,id:s.code+'a',state:s.state}]);assert.equal(stateModule.statePlan(profiles).length,100);assert.equal(stateModule.statePlan([...profiles,...profiles]).length,100);// Coverage no longer depends on the alerts flag; alerts only control notifications.
 assert.equal(stateModule.statePlan(profiles.map(p=>({...p,alerts:false}))).length,100);});
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

const listing=await import(pathToFileURL(out+'/listing.mjs').href);
const deadlineNow=new Date('2026-10-23T16:00:00.000Z');
const refreshAt='2026-10-23T13:01:00.000Z';
function sample(partial){return {id:partial.id||'sample',title:'',funder:'',description:'',types:[],countries:[],tags:[],deadline:null,requirements:[],states:[],...partial};}
test('deadlines more than five years out display and sort as no fixed deadline without changing the record',()=>{const stored={deadline:'2076-01-15',deadlineLabel:'2076-01-15'};assert.equal(listing.isFarFutureDeadline('2031-10-23',deadlineNow),false);assert.equal(listing.isFarFutureDeadline('2031-10-24',deadlineNow),true);assert.equal(listing.isFarFutureDeadline('2044-06-01',deadlineNow),true);assert.equal(listing.isFarFutureDeadline('2076-01-15',deadlineNow),true);assert.equal(listing.effectiveDeadline('2044-06-01',deadlineNow),null);assert.equal(listing.effectiveDeadline('2026-11-01',deadlineNow),'2026-11-01');assert.equal(listing.effectiveDeadline(null,deadlineNow),null);assert.equal(listing.deadlineView(stored,deadlineNow).text,'No fixed deadline');assert.equal(listing.deadlineView(stored,deadlineNow).iso,null);assert.equal(stored.deadline,'2076-01-15');assert.equal(listing.deadlineSortKey('2076-01-01',deadlineNow),listing.deadlineSortKey(null,deadlineNow));assert.ok(listing.deadlineSortKey('2026-12-01',deadlineNow)<listing.deadlineSortKey('2044-01-01',deadlineNow));assert.equal(listing.deadlineView({deadline:null,deadlineLabel:'Rolling'},deadlineNow).text,'Rolling');assert.equal(listing.isOpenGrant({status:'Open',deadline:'2044-01-01'},deadlineNow),true);assert.equal(listing.isOpenGrant({status:'Open',deadline:'2020-01-01'},deadlineNow),false);assert.equal(listing.isOpenGrant({status:'Closed',deadline:null},deadlineNow),false);assert.equal(listing.isOpenGrant({deadline:null},deadlineNow),true);});
test('catalog refresh is stale only after 26 hours and labels Eastern Time',()=>{const checked=Date.parse(refreshAt);assert.equal(listing.formatLastUpdatedEt(refreshAt),'Oct 23, 2026, 9:01 AM ET');assert.equal(listing.isRefreshStale(refreshAt,checked+26*60*60*1000),false);assert.equal(listing.isRefreshStale(refreshAt,checked+26*60*60*1000+1),true);assert.equal(listing.isRefreshStale(refreshAt,checked+25*60*60*1000),false);assert.equal(listing.isRefreshStale(null,checked),true);assert.equal(listing.isRefreshStale('not-a-date',checked),true);assert.equal(listing.formatLastUpdatedEt('nope'),'unavailable');});
test('search matches whole words, every term, and related terms, then ranks title matches first',()=>{const grants=[
 sample({id:'bakery-title',title:'Neighborhood bakery equipment'}),
 sample({id:'food-desc',title:'Kitchen award',description:'Support for food business owners'}),
 sample({id:'bridge',title:'Bridge repair'}),
 sample({id:'startup',title:'Main Street',tags:['microenterprise']}),
 sample({id:'sba',funder:'SBA Office of Capital Access',title:'Working capital'}),
 sample({id:'business-hours',description:'Ordinary business hours only'}),
 sample({id:'nyc-state',title:'Storefront improvement',states:['New York']}),
 sample({id:'nyc-title',title:'NYC storefront grant'}),
 sample({id:'many',title:'Many companies and anyone nearby'}),
 sample({id:'women',requirements:['Women-owned firms may apply'],title:'Growth award'}),
 sample({id:'female',description:'Open to female entrepreneurs'}),
 sample({id:'founder',title:'Entrepreneur workshop'}),
 sample({id:'stem',title:'STEM education fellowship'}),
 sample({id:'tech-word',title:'Tech apprenticeship'}),
 sample({id:'biotech',title:'Biotechnology transfer'}),
 sample({id:'art-word',title:'The art of bread'}),
 sample({id:'start',title:'Start chart party'}),
 sample({id:'creative',tags:['creative'],title:'Studio practice'}),
 sample({id:'music',title:'Community music grant'}),
 sample({id:'theater',description:'Support for theater and dance companies'}),
 sample({id:'visual',tags:['visual arts'],title:'Exhibition fund'}),
 sample({id:'both',title:'Bakery technology program'}),
 sample({id:'food-only',title:'Food hall'}),
 sample({id:'tech-only',title:'Innovation lab'}),
];
 const ids=query=>listing.searchGrants(grants,query).map(hit=>hit.grant.id);
 assert.deepEqual(ids(''),grants.map(g=>g.id));
 assert.deepEqual(ids('   '),grants.map(g=>g.id));
 const foodIds=['bakery-title','food-desc','both','food-only'].sort();
 assert.deepEqual(ids('bakery').sort(),foodIds);
 assert.deepEqual(ids('food').sort(),foodIds);
 assert.equal(ids('art').includes('start'),false);
 assert.equal(ids('arts').includes('art-word'),true);
 assert.equal(ids('arts').includes('creative'),false);
 assert.equal(ids('arts').includes('music'),true);
 assert.equal(ids('arts').includes('theater'),true);
 assert.equal(ids('visual arts').includes('visual'),true);
 assert.equal(ids('artist').includes('music'),true);
 assert.equal(listing.searchGrants([sample({id:'writers',tags:['writing','creative','literature'],title:'Poetry prize'})],'arts').length,0);
 assert.equal(ids('technology').includes('biotech'),false);
 assert.equal(ids('TECHNOLOGY').includes('stem'),true);
 assert.equal(ids('technology').includes('tech-word'),true);
 assert.deepEqual(ids('NYC').sort(),['nyc-state','nyc-title'].sort());
 assert.equal(ids('New York City').includes('many'),false);
 assert.equal(ids('nyc').includes('nyc-title'),true);
 assert.equal(ids('small business').includes('startup'),true);
 assert.equal(ids('small business').includes('sba'),true);
 assert.equal(ids('small business').includes('business-hours'),false);
 assert.equal(ids('startups').includes('startup'),true);
 assert.equal(ids('women-owned').includes('women'),true);
 assert.equal(ids('women-owned').includes('female'),true);
 assert.equal(ids('women-owned').includes('founder'),false);
 assert.equal(listing.searchGrants([sample({id:'typed',title:'Marine education',types:['Small business','Nonprofit']})],'small business').length,0);
 assert.equal(listing.searchGrants([sample({id:'req',title:'Marine education',requirements:['Eligible small businesses may apply']})],'small business').length,1);
 assert.deepEqual(ids('bakery technology'),['both']);
 const ranked=listing.searchGrants([
  sample({id:'desc',title:'Kitchen award',description:'Support for food business owners'}),
  sample({id:'title',title:'Neighborhood bakery equipment'}),
 ],'bakery');
 assert.deepEqual(ranked.map(hit=>hit.grant.id),['title','desc']);
 assert.ok(ranked[0].relevance>ranked[1].relevance);
 assert.equal(listing.relevanceScore(ranked[0].grant,'bakery'),ranked[0].relevance);
 const frozen=sample({id:'frozen',title:'Future prize',deadline:'2044-01-01'});
 listing.searchGrants([frozen],'prize');
 assert.equal(frozen.deadline,'2044-01-01');
});

test('closed or past-deadline records are never new, in refresh_grants or record_state_opportunities',()=>{
 const today='2026-10-23T13:00:00Z';
 assert.equal(isOpenOpportunity({status:'Open',deadline:'2026-10-23'},today),true);
 assert.equal(isOpenOpportunity({status:'Researched lead · verify cycle',deadline:null},today),true);
 // Rockefeller State Wildlife Scholarship: Aug 31 deadline had passed when it was reported as new.
 assert.equal(isOpenOpportunity({status:'Researched lead · verify cycle',deadline:'2026-08-31'},today),false);
 assert.equal(isOpenOpportunity({status:'Closed',deadline:'2027-01-01'},today),false);
 assert.equal(isOpenOpportunity({status:'Applications closed',deadline:null},today),false);
 const research=readFileSync('lib/state-research.ts','utf8'),discovery=readFileSync('lib/discovery.ts','utf8');
 for(const source of [research,discovery]){assert.match(source,/newRecords=created\.filter\(g=>isOpenOpportunity\(g,now\)\)/);assert.match(source,/closedNotReported:created\.length-newRecords\.length/);}
 const closed=new RegExp(research.match(/export const CLOSED_EVIDENCE=\/(.+)\/i;/)[1],'i');
 for(const text of ['Applications are now closed for 2026.','The program is no longer accepting applications.','The deadline has passed.','The application period has ended.'])assert.ok(closed.test(text),text);
 for(const text of ['Applications open January 1.','Apply before the deadline on December 1.'])assert.ok(!closed.test(text),text);
});

test('state leads dedupe by normalized URL, not URL plus title',()=>{
 const n=stateScan.normalizeLeadUrl;
 assert.equal(n('https://ESD.NY.gov/global-ny/?utm_source=x&b=2&a=1#apply'),'esd.ny.gov/global-ny?a=1&b=2');
 assert.equal(n('http://www.esd.ny.gov/global-ny'),n('https://esd.ny.gov/global-ny/'));
 assert.equal(n('https://esd.ny.gov/global-ny?fbclid=abc&gclid=1'),'esd.ny.gov/global-ny');
 assert.notEqual(n('https://esd.ny.gov/global-ny?id=1'),n('https://esd.ny.gov/global-ny?id=2'));
 assert.equal(n('javascript:alert(1)'),'');
 assert.equal(n('not a url'),'');
 // 'Global NY Grant Fund' vs existing 'Global NY Grant Program' at the same page share one key.
 const existing={id:'state-ny-business-1',url:'https://esd.ny.gov/global-ny',title:'Global NY Grant Program',sourceUrl:'https://esd.ny.gov/',sourceMode:'Primary-source research'};
 const reworded={id:'state-ny-business-2',url:'https://esd.ny.gov/global-ny/?utm_campaign=daily',title:'Global NY Grant Fund',sourceUrl:'https://esd.ny.gov/',sourceMode:'Primary-source research'};
 assert.equal(stateScan.leadKey(existing),stateScan.leadKey(reworded));
 assert.equal(stateScan.leadKey({...existing,id:'chamber-ny-1',sourceMode:'Small-business guide'}),stateScan.leadKey(existing));
 // Headings scraped from one page share the page URL, so they stay distinct by title.
 const page='https://kheaa.com/aid';
 assert.notEqual(stateScan.leadKey({id:'state-ky-aid-1',url:page,sourceUrl:page,title:'College Access Grant',sourceMode:'State-source program lead'}),stateScan.leadKey({id:'state-ky-aid-2',url:page,sourceUrl:page,title:'Teaching Scholarship',sourceMode:'State-source program lead'}));
 // Records outside state/chamber leads (e.g. Grants.gov, CareerOneStop) are not URL-deduped.
 assert.equal(stateScan.leadKey({id:'grantsgov-1',url:'https://esd.ny.gov/global-ny',title:'X',sourceMode:'Live API'}),'');
 const research=readFileSync('lib/state-research.ts','utf8'),discovery=readFileSync('lib/discovery.ts','utf8');
 assert.match(research,/leadKey\(/);assert.match(research,/updatedExisting/);
 assert.match(discovery,/leadKey\(g\)/);
});

test('new matches carry title, URL, funder, deadline and every matched profile with score',()=>{
 const g={...seeds[3],id:'student-new',states:['New York'],deadline:null};
 const profiles=[{...p,id:'student',name:'Synthetic student'},{...p,id:'paused',name:'Paused',alerts:false},{...p,id:'elsewhere',name:'Elsewhere',state:'LA'}];
 const fits=profileMatches(g,profiles);
 assert.deepEqual(fits.map(f=>f.profileId),['student']);
 assert.equal(fits[0].profile,'Synthetic student');
 assert.ok(fits[0].score>0);
 const {newItems}=newOpportunityItems([g],new Map([[g.id,fits]]));
 assert.equal(newItems[0].title,g.title);assert.equal(newItems[0].url,g.url);assert.equal(newItems[0].funder,g.funder);assert.equal(newItems[0].deadline,null);
 assert.equal(newItems[0].matched,true);assert.equal(newItems[0].matches[0].profile,'Synthetic student');
});

test('grant_refresh_status reports hoursSinceRefresh and a 26-hour stale flag',()=>{
 const checked=Date.parse(refreshAt);
 assert.deepEqual(listing.refreshFreshness(refreshAt,checked+3*3600000),{stale:false,hoursSinceRefresh:3});
 assert.deepEqual(listing.refreshFreshness(refreshAt,checked+26*3600000),{stale:false,hoursSinceRefresh:26});
 assert.deepEqual(listing.refreshFreshness(refreshAt,checked+27.25*3600000),{stale:true,hoursSinceRefresh:27.3});
 assert.deepEqual(listing.refreshFreshness(null,checked),{stale:true,hoursSinceRefresh:null});
 assert.deepEqual(listing.refreshFreshness('garbage',checked),{stale:true,hoursSinceRefresh:null});
 const refresh=readFileSync('app/api/refresh/route.ts','utf8');
 assert.match(refresh,/export async function GET\(\)\{if\(!await isOwner\(\)\)/);
 assert.match(refresh,/\.\.\.refreshFreshness\(lastRefresh\?\.checkedAt\)/);
 assert.match(readFileSync('app/mcp/route.ts','utf8'),/name:'grant_refresh_status'[^}]*stale/);
});

test('upcoming_deadlines lists open matched records within the window, soonest first',()=>{
 // Dates are relative to the real clock: match() checks deadlines against the current time.
 const day=n=>new Date(Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const today=day(0)+'T13:00:00Z';
 const base={...seeds[3],states:['New York'],status:'Open'};
 const grants=[
  {...base,id:'later',title:'Later grant',deadline:day(28)},
  {...base,id:'soon',title:'Soon grant',deadline:day(2)},
  {...base,id:'today',title:'Today grant',deadline:day(0)},
  {...base,id:'past',title:'Past grant',deadline:day(-1)},
  {...base,id:'closed',title:'Closed grant',deadline:day(7),status:'Closed'},
  {...base,id:'far',title:'Far grant',deadline:day(84)},
  {...base,id:'rolling',title:'Rolling grant',deadline:null},
  {...base,id:'la',title:'Louisiana grant',states:['Louisiana'],deadline:day(5)}];
 const profiles=[{...p,id:'student',name:'Synthetic student'},{...p,id:'paused',name:'Paused',alerts:false,state:'LA'}];
 const out=notifications.upcomingDeadlines(grants,profiles,undefined,today);
 assert.equal(out.days,30);assert.equal(out.asOf,day(0));
 assert.deepEqual(out.items.map(i=>[i.title,i.daysLeft]),[['Today grant',0],['Soon grant',2],['Later grant',28]]);
 assert.equal(out.total,3);
 assert.deepEqual(Object.keys(out.items[0]).sort(),['daysLeft','deadline','funder','matches','profile','profileId','score','title','url']);
 assert.equal(out.items[0].profile,'Synthetic student');assert.equal(out.items[0].url,base.url);assert.ok(out.items[0].score>0);
 assert.deepEqual(notifications.upcomingDeadlines(grants,profiles,5,today).items.map(i=>i.title),['Today grant','Soon grant']);
 assert.equal(notifications.upcomingDeadlines(grants,profiles,500,today).days,90);
 assert.equal(notifications.upcomingDeadlines(grants,profiles,0,today).days,1);
 assert.equal(notifications.upcomingDeadlines(grants,profiles,'45',today).days,45);
 assert.equal(notifications.upcomingDeadlines(grants,profiles,'abc',today).days,30);
 assert.equal(notifications.upcomingDeadlines(grants,[{...p,alerts:false}],30,today).total,0);
 const route=readFileSync('app/mcp/route.ts','utf8');
 assert.match(route,/name:'upcoming_deadlines'/);
 assert.match(route,/maximum:UPCOMING_MAX_DAYS,default:UPCOMING_DEFAULT_DAYS/);
 // The owner check runs before any tools/call dispatch, including upcoming_deadlines.
 assert.ok(route.indexOf('if(!await isOwner())')>-1&&route.indexOf('if(!await isOwner())')<route.indexOf("if(name==='upcoming_deadlines')"));
 assert.match(route,/upcomingDeadlines\(await allGrants\(\),profiles,message\.params\?\.arguments\?\.days\)/);
});

const cityModule=await import(pathToFileURL(out+'/city-registry.mjs').href);
const planModule=await import(pathToFileURL(out+'/research-plan.mjs').href);
const {monitoredProfiles}=await import(pathToFileURL(`${out}/grants.mjs`).href);
test('monitoredProfiles covers every U.S. profile regardless of alerts; alerts still gate notifications',()=>{
 const profiles=[{...p,id:'on'},{...p,id:'off',alerts:false},{...p,id:'off-ca',alerts:false,state:'CA',country:'United States'},{...p,id:'abroad-off',alerts:false,country:'Canada',state:''},{...p,id:'abroad-on',country:'Canada',state:''}];
 assert.deepEqual(monitoredProfiles(profiles).map(x=>x.id),['on','off','off-ca','abroad-on']);
 assert.deepEqual(monitoredProfiles(undefined),[]);
 const g={...seeds[3],states:[]};assert.deepEqual(profileMatches(g,monitoredProfiles(profiles)).map(m=>m.profileId).filter(id=>id==='off'),[]);
 const discovery=readFileSync('lib/discovery.ts','utf8'),research=readFileSync('lib/state-research.ts','utf8'),refresh=readFileSync('app/api/refresh/route.ts','utf8');
 assert.match(discovery,/const profiles=monitoredProfiles\(input\)/);assert.doesNotMatch(discovery,/input\.filter\(p=>p\.alerts\)/);
 assert.match(research,/monitoredProfiles\(rows\.flatMap/);assert.doesNotMatch(refresh,/p\.alerts/);
 assert.match(readFileSync('app/mcp/route.ts','utf8'),/name==='upcoming_deadlines'[^;]*;const profiles:Profile\[\]=[^;]*\.filter\(\(p:Profile\)=>p\.alerts\)/);
});
test('individual and freelancer profiles get state arts council tasks; every state has an arts route',()=>{
 for(const s of stateModule.stateSources)assert.ok(new URL(s.arts.url),s.code);
 const tasks=stateModule.statePlan([{...p,type:'Individual',state:'IL'},{...p,id:'f',type:'Freelancer',state:'IL'},{...p,id:'s',type:'Student',state:'IL'}]);
 assert.deepEqual(tasks.map(t=>t.category).sort(),['aid','arts','business']);
 const il=stateModule.sourceForState('IL');assert.equal(stateModule.evidenceHostAllowed(il,il.arts.url),true);
 const g=stateScan.stateRecord(il,'arts',{url:'https://arts.illinois.gov/grants/individual',title:'Artists Fellowship Program',context:'Fellowships for individual artists.'},'https://arts.illinois.gov/grants',now);
 assert.deepEqual(g.types,['Individual','Freelancer']);assert.equal(g.kind,'State grant');assert.ok(g.tags.includes('arts'));assert.equal(g.cities,undefined);
 const c=stateScan.stateRecord(il,'business',{url:'https://www.chicago.gov/grant',title:'Chicago Small Business Improvement Fund',context:'Grants for small businesses.'},'https://www.chicago.gov/grant',now,{city:'Chicago'});
 assert.deepEqual(c.cities,['Chicago']);assert.match(c.source,/^Chicago, Illinois/);
});
test('Wave 1 city hosts pass, lookalikes fail, and held hosts are not added',()=>{
 const byId=id=>cityModule.cityById(id),st=code=>stateModule.sourceForState(code);
 assert.deepEqual(cityModule.citySources.filter(c=>c.wave===1).map(c=>c.id),['new-york-ny','los-angeles-ca','chicago-il','houston-tx','phoenix-az','philadelphia-pa','san-antonio-tx','san-diego-ca','dallas-tx','jacksonville-fl']);
 for(const c of cityModule.citySources.filter(c=>c.wave===1)){assert.ok(c.rank>=1&&c.rank<=10);assert.ok(st(c.stateCode));}
 const ok=[['los-angeles-ca','CA',['lacity.gov','ewdd.lacity.gov','www.lacity.gov']],['chicago-il','IL',['chicago.gov','www.chicago.gov']],['houston-tx','TX',['houstontx.gov','www.houstontx.gov','houstonartsalliance.com','www.houstonartsalliance.com']],['phoenix-az','AZ',['phoenix.gov','www.phoenix.gov']],['philadelphia-pa','PA',['phila.gov','www.phila.gov','creativephl.org']],['san-diego-ca','CA',['sandiego.gov','www.sandiego.gov']],['dallas-tx','TX',['dallasecodev.org','www.dallasecodev.org','dallascityhall.com']],['jacksonville-fl','FL',['jacksonville.gov','www.jacksonville.gov']],['new-york-ny','NY',['nyc.gov','nyc-business.nyc.gov','edc.nyc','nycedc.com']]];
 for(const [id,code,hosts] of ok)for(const host of hosts)assert.equal(cityModule.cityEvidenceHostAllowed(byId(id),st(code),`https://${host}/grant`),true,id+' '+host);
 const bad=[['chicago-il','IL',['chicago.gov.evil.com','evilchicago.gov','chicago.gov.example.org','chicago.com']],['houston-tx','TX',['houstonartsalliance.com.evil.net','grants.houstonartsalliance.com','fakehoustonartsalliance.com']],['philadelphia-pa','PA',['creativephl.org.evil.com','sub.creativephl.org']],['dallas-tx','TX',['dallasecodev.org.evil.com','dallascityhall.com.example.net','sub.dallascityhall.com']],['los-angeles-ca','CA',['lacity.gov.evil.com','culturela.org','www.culturela.org']],['san-antonio-tx','TX',['sa.gov','www.sa.gov','sanantonio.gov']],['dallas-tx','TX',['fortworthtexas.gov','www.fortworthtexas.gov']],['houston-tx','TX',['sa.gov','fortworthtexas.gov']],['chicago-il','IL',['edc.nyc','nycedc.com','nyc.gov']]];
 for(const [id,code,hosts] of bad)for(const host of hosts)assert.equal(cityModule.cityEvidenceHostAllowed(byId(id),st(code),`https://${host}/grant`),false,id+' '+host);
 // State rules still apply inside a city check, and without a cityId nothing new is accepted at state level.
 assert.equal(cityModule.cityEvidenceHostAllowed(byId('chicago-il'),st('IL'),st('IL').business.url),true);
 for(const host of ['chicago.gov','houstonartsalliance.com','creativephl.org','dallasecodev.org','lacity.gov'])for(const code of ['IL','TX','PA','CA'])assert.equal(stateModule.evidenceHostAllowed(st(code),`https://${host}/grant`),false,code+' '+host);
 const held=JSON.stringify(cityModule.citySources.map(c=>[c.govDomains,c.partnerHosts,c.sources]));for(const h of ['culturela.org','sa.gov','fortworth'])assert.ok(!held.includes(h),h);
 const sa=byId('san-antonio-tx');assert.equal(sa.status,'pending verification');assert.deepEqual(cityModule.cityHosts(sa),[]);
 assert.equal(cityModule.cityById('fort-worth-tx').status,'pending verification');assert.deepEqual(cityModule.cityHosts(cityModule.cityById('fort-worth-tx')),[]);assert.deepEqual(st('NY').localHosts,['nyc.gov','nyc-business.nyc.gov','edc.nyc','nycedc.com']);
});
test('research plan covers states and Wave 1 cities with limit and rotation',()=>{
 const profiles=[{...p,id:'il',type:'Individual',state:'IL',alerts:false},{...p,id:'tx',type:'Small business',state:'TX'}];const empty=new Map();const at=Date.parse('2026-10-23T13:00:00Z');
 const def=planModule.planResearchTasks({profiles,reports:empty,research:empty,now:at});
 assert.equal(def.limit,5);assert.equal(def.tasks.length,5);assert.equal(def.deferred,def.totalDue-5);
 assert.deepEqual(def.tasks.slice(0,2).map(t=>t.taskId).sort(),['state-IL-arts','state-TX-business']);assert.ok(def.tasks.slice(2).every(t=>t.scope==='city'));
 for(const t of def.tasks.filter(t=>t.scope==='state'))for(const k of ['state','code','category','source','fallback','localHosts','sourceStatus','lastResearch','interests','query','needsResearch'])assert.ok(k in t,k);
 assert.equal(planModule.planResearchTasks({profiles,reports:empty,research:empty,now:at,limit:99}).limit,20);
 assert.equal(planModule.planResearchTasks({profiles,reports:empty,research:empty,now:at,limit:0}).limit,5);
 assert.equal(planModule.planResearchTasks({profiles,reports:empty,research:empty,now:at,limit:'7'}).limit,5);
 const all=planModule.planResearchTasks({profiles,reports:empty,research:empty,now:at,limit:20});
 const cities=all.tasks.filter(t=>t.scope==='city');assert.ok(cities.length>=9);assert.ok(cities.every(t=>t.revisitDays===7&&t.cityId&&t.localHosts.length));
 assert.deepEqual(all.pendingCities.map(c=>c.cityId),['san-antonio-tx']);assert.ok(!all.tasks.some(t=>t.cityId==='san-antonio-tx'));
 assert.ok(all.tasks.some(t=>t.taskId==='city-houston-tx-arts'));
 // Researched tasks rotate out until their revisit interval passes, then come back.
 const done=new Map(all.tasks.map(t=>[t.scope==='city'?planModule.cityResearchKey(t.cityId,t.category):planModule.stateResearchKey(t.code,t.category),{checkedAt:new Date(at-3600000).toISOString()}]));
 const later=planModule.planResearchTasks({profiles,reports:empty,research:done,now:at,limit:20});assert.equal(later.totalDue,0);
 const day2=planModule.planResearchTasks({profiles,reports:empty,research:done,now:at+2*86400000,limit:20});assert.ok(day2.tasks.length>0);assert.ok(day2.tasks.every(t=>t.scope==='state'));
 const week=planModule.planResearchTasks({profiles,reports:empty,research:done,now:at+7*86400000,limit:20});assert.ok(week.tasks.some(t=>t.scope==='city'));
 // Partial completion: the next call returns the tasks that were deferred, not the ones just finished.
 const first=def.tasks.map(t=>t.taskId),half=new Map(def.tasks.map(t=>[t.scope==='city'?planModule.cityResearchKey(t.cityId,t.category):planModule.stateResearchKey(t.code,t.category),{checkedAt:new Date(at).toISOString()}]));
 const next=planModule.planResearchTasks({profiles,reports:empty,research:half,now:at+60000});assert.ok(next.tasks.length>0);assert.ok(next.tasks.every(t=>!first.includes(t.taskId)));
 assert.equal(planModule.cityResearchKey('chicago-il','arts'),'research-city-chicago-il-arts');assert.equal(planModule.stateResearchKey('IL','arts'),'research-IL-arts');
 const route=readFileSync('app/mcp/route.ts','utf8');assert.match(route,/limit:\{type:'integer',minimum:1,maximum:RESEARCH_LIMIT_MAX,default:RESEARCH_LIMIT_DEFAULT\}/);assert.match(route,/stateResearchPlan\(message\.params\?\.arguments\)/);assert.match(route,/cityId:\{type:'string',enum:researchCityIds\}/);
 const research=readFileSync('lib/state-research.ts','utf8');assert.match(research,/city\?cityEvidenceHostAllowed\(city,state,sourceUrl\):evidenceHostAllowed\(state,sourceUrl\)/);
});
const budgetModule=await import(pathToFileURL(out+'/fetch-budget.mjs').href);
const okResponse=(body='<main></main>')=>new Response(body,{status:200});
const redirect=(to,status=302)=>new Response(null,{status,headers:{location:to}});
test('run fetch budget: fixed caps plus the page-scan floor stay within the free-plan subrequest limit',()=>{
 const {RUN_FETCH_LIMIT,SOURCE_FETCH_CAPS,FIXED_SOURCE_FETCHES,PAGE_SCAN_MIN_FETCHES}=budgetModule;
 assert.ok(RUN_FETCH_LIMIT<=45);assert.equal(FIXED_SOURCE_FETCHES,Object.values(SOURCE_FETCH_CAPS).reduce((s,n)=>s+n,0));
 assert.equal(FIXED_SOURCE_FETCHES+PAGE_SCAN_MIN_FETCHES,RUN_FETCH_LIMIT);assert.ok(PAGE_SCAN_MIN_FETCHES>=10);
 const run=new budgetModule.FetchBudget(RUN_FETCH_LIMIT);const children=Object.values(SOURCE_FETCH_CAPS).map(c=>run.child(c));
 for(const c of children)while(c.take());assert.equal(run.used,FIXED_SOURCE_FETCHES);const pages=run.child(run.remaining);while(pages.take());
 assert.equal(pages.used,PAGE_SCAN_MIN_FETCHES);assert.equal(run.used,RUN_FETCH_LIMIT);assert.equal(run.take(),false);
 // A child cannot exceed its own cap even when the run has room, nor the run when the child has room.
 const big=new budgetModule.FetchBudget(3),c=big.child(10);assert.equal([c.take(),c.take(),c.take(),c.take()].filter(Boolean).length,3);const small=new budgetModule.FetchBudget(10).child(2);assert.equal(small.remaining,2);
 // Every outside request in discovery goes through a budget: no bare fetch(), and every text()/api() call passes one.
 const discovery=readFileSync('lib/discovery.ts','utf8');assert.doesNotMatch(discovery.replace(/budgetedFetch\(/g,''),/\bfetch\(/);
 for(const call of discovery.matchAll(/await (text|api)\(([^;]*?)\)(?:;|\.|,)/g))assert.match(call[2],/,(?:caps\.\w+|pageBudget)\s*$/,call[0]);
 assert.match(discovery,/url=>text\(url,pageBudget\)/);assert.match(discovery,/deferredRoutes,/);
});
test('budgeted fetch charges every redirect hop and stops before overspending',async()=>{
 const seen=[];const impl=async(url,init)=>{seen.push([url,init.method||'GET',init.redirect]);if(url==='https://a.example/start')return redirect('/next');if(url==='https://a.example/next')return redirect('https://b.example/final',303);return okResponse('done');};
 const b=new budgetModule.FetchBudget(5);const {response,url}=await budgetModule.budgetedFetch(b,'https://a.example/start',{method:'POST',body:'x'},impl);
 assert.equal(await response.text(),'done');assert.equal(url,'https://b.example/final');assert.equal(b.used,3);assert.deepEqual(seen.map(s=>s[2]),['manual','manual','manual']);assert.equal(seen[2][1],'GET');
 const tight=new budgetModule.FetchBudget(2);await assert.rejects(budgetModule.budgetedFetch(tight,'https://a.example/start',{},impl),e=>budgetModule.isBudgetError(e));assert.equal(tight.used,2);
 const loop=new budgetModule.FetchBudget(10);await assert.rejects(budgetModule.budgetedFetch(loop,'https://c.example/',{},async()=>redirect('/again')),/Too many redirects/);assert.equal(loop.used,budgetModule.MAX_REDIRECTS+1);
 const none=new budgetModule.FetchBudget(0);let called=0;await assert.rejects(budgetModule.budgetedFetch(none,'https://a.example/',{},async()=>{called++;return okResponse();}),e=>budgetModule.isBudgetError(e));assert.equal(called,0);
});
test('state scan stops cleanly at the budget: deferred before the first page, partial after it',async()=>{
 const source=stateModule.sourceForState('OH');const page=url=>url===source.business.url?'<main><a href="/funding">Funding</a><a href="/grants">Grants</a><h1>Ohio Equipment Grant</h1></main>':'<main><a href="/x-grant">Workforce Training Grant</a></main>';
 const via=b=>async url=>{const {response}=await budgetModule.budgetedFetch(b,url,{},async u=>okResponse(page(u)));return response.text();};
 const empty=await stateScan.scanState(source,'business',via(new budgetModule.FetchBudget(0)),now);assert.equal(empty.deferred,true);assert.equal(empty.report.status,'Deferred');assert.equal(empty.report.queries,0);assert.equal(empty.records.length,0);
 const one=new budgetModule.FetchBudget(1);const partial=await stateScan.scanState(source,'business',via(one),now);assert.equal(partial.deferred,undefined);assert.equal(one.used,1);assert.equal(partial.report.queries,1);assert.match(partial.report.note,/fetch budget reached/);assert.notEqual(partial.report.status,'Browser review');
 const full=new budgetModule.FetchBudget(10);const done=await stateScan.scanState(source,'business',via(full),now);assert.ok(full.used<=3);assert.ok(done.records.length>=partial.records.length);
});
test('page scans rotate oldest first across days, so every arts route is reached within the budget',async()=>{
 const people=stateModule.stateSources.map(s=>({...p,id:s.code,type:'Individual',state:s.code}));
 const routes=stateModule.statePlan(people).map(t=>({...t,id:'state-'+t.source.code+'-'+t.category,code:t.source.code,state:t.source.state}));assert.equal(routes.length,50);assert.ok(routes.every(r=>r.category==='arts'));
 const saved=new Map();const day=86400000,start=Date.parse('2026-10-24T13:00:00Z'),firstScan=new Map();let maxPerRun=0;
 for(let d=0;d<30;d++){const at=start+d*day;const {fresh,due}=budgetModule.orderScanRoutes(routes,saved,at);
  if(d===0){assert.equal(fresh.length,0);assert.equal(due.length,50);}
  const pages=new budgetModule.FetchBudget(budgetModule.PAGE_SCAN_MIN_FETCHES);let deferred=0;
  for(let i=0;i<due.length;i+=5)await Promise.all(due.slice(i,i+5).map(async item=>{if(pages.remaining<1){deferred++;return;}const r=await stateScan.scanState(item.route.source,'arts',async url=>{const {response}=await budgetModule.budgetedFetch(pages,url,{},async()=>okResponse('<main><a href="/grants">Grants</a><a href="/programs">Grant programs</a></main>'));return response.text();},new Date(at).toISOString());if(r.deferred){deferred++;return;}saved.set(item.route.id,{checkedAt:new Date(at).toISOString()});if(!firstScan.has(item.route.id))firstScan.set(item.route.id,d);}));
  assert.ok(pages.used<=budgetModule.PAGE_SCAN_MIN_FETCHES);maxPerRun=Math.max(maxPerRun,pages.used);if(d===0)assert.ok(deferred>0);
 }
 assert.equal(firstScan.size,50,'every arts route scanned at least once');assert.equal(maxPerRun,budgetModule.PAGE_SCAN_MIN_FETCHES);
 // Never-scanned routes come first; then the oldest stored scan; errors are rescanned but not ahead of older routes.
 const m=new Map([['state-AL-arts',{checkedAt:'2026-10-20T00:00:00Z'}],['state-AK-arts',{checkedAt:'2026-10-24T12:00:00Z'}],['state-AZ-arts',{checkedAt:'2026-10-24T12:30:00Z',error:'HTTP 403'}]]);
 const order=budgetModule.orderScanRoutes(routes.slice(0,4),m,start);assert.deepEqual(order.fresh.map(r=>r.id),['state-AK-arts']);assert.deepEqual(order.due.map(d=>d.route.id),['state-AR-arts','state-AL-arts','state-AZ-arts']);
});
