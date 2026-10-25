// Community foundations: a funder/source type for local grant and scholarship leads, researched outside the
// worker (ChatGPT scheduled research) so the refresh run's 45-fetch cap is unchanged; this module makes no requests.
// Curated: the foundation that serves each Wave 1/Wave 2 city (plus Cleveland), with its official domain and grants
// page. Every grantsUrl was checked with a server request on 2026-10-24 (HTTP 200 after redirects).
// Evidence for a foundation lead must come from one of `domains`, matched by exact host (a leading www. is ignored;
// other subdomains are not accepted, because foundation domains are not .gov registrations).
// Held pending browser verification (no domains listed): The New York Community Trust (nycommunitytrust.org, 404 to
// server checks), The Chicago Community Trust (cct.org, 403) and Arizona Community Foundation (azfoundation.org,
// bot challenge). The Community Foundation for the National Capital Region is not listed because DC is not in the
// state registry.
import { bareHost } from './state-registry';
import type { StateCategory } from './state-registry';
import type { Grant } from './grants';
export const FOUNDATION_REVISIT_DAYS=14;
export const FOUNDATION_KIND='Community foundation grant';
export const FOUNDATION_SOURCE_TYPE='community-foundation';
export type CommunityFoundation={id:string;name:string;city:string;county:string|null;stateCode:string;domains:string[];grantsUrl:string;status:'verified'|'pending verification';note?:string};
const f=(id:string,name:string,city:string,county:string|null,stateCode:string,domains:string[],grantsUrl:string,note?:string):CommunityFoundation=>({id,name,city,county,stateCode,domains,grantsUrl,status:'verified',...(note?{note}:{})});
const held=(id:string,name:string,city:string,county:string|null,stateCode:string,note:string):CommunityFoundation=>({id,name,city,county,stateCode,domains:[],grantsUrl:'',status:'pending verification',note});
export const communityFoundations:CommunityFoundation[]=[
 held('ny-community-trust','The New York Community Trust','New York',null,'NY','nycommunitytrust.org returned 404 to server checks.'),
 f('california-community-foundation','California Community Foundation','Los Angeles','Los Angeles County','CA',['calfund.org'],'https://www.calfund.org/','No stable grants path found by server checks; the homepage is the source.'),
 held('chicago-community-trust','The Chicago Community Trust','Chicago','Cook County','IL','cct.org returned 403 to server checks.'),
 f('greater-houston-cf','Greater Houston Community Foundation','Houston','Harris County','TX',['ghcf.org'],'https://ghcf.org/community-impact/high-impact-grantmaking/'),
 held('arizona-community-foundation','Arizona Community Foundation','Phoenix','Maricopa County','AZ','azfoundation.org served a bot challenge to server checks.'),
 f('philadelphia-foundation','The Philadelphia Foundation','Philadelphia','Philadelphia County','PA',['philafound.org'],'https://www.philafound.org/nonprofits/'),
 f('san-antonio-area-foundation','San Antonio Area Foundation','San Antonio','Bexar County','TX',['saafdn.org'],'https://saafdn.org/nonprofits/grants/'),
 f('san-diego-foundation','The San Diego Foundation','San Diego','San Diego County','CA',['sdfoundation.org'],'https://www.sdfoundation.org/nonprofits/apply-for-a-grant/'),
 f('communities-foundation-of-texas','Communities Foundation of Texas','Dallas','Dallas County','TX',['cftexas.org'],'https://www.cftexas.org/nonprofits/grants/'),
 f('community-foundation-ne-florida','The Community Foundation for Northeast Florida','Jacksonville','Duval County','FL',['jaxcf.org'],'https://www.jaxcf.org/apply-for-grants-or-scholarships/'),
 f('north-texas-cf','North Texas Community Foundation','Fort Worth','Tarrant County','TX',['northtexascf.org'],'https://northtexascf.org/nonprofits/'),
 f('silicon-valley-cf','Silicon Valley Community Foundation','San Jose','Santa Clara County','CA',['svcf.org','siliconvalleycf.org'],'https://www.svcf.org/nonprofits','siliconvalleycf.org redirects to svcf.org.'),
 f('austin-community-foundation','Austin Community Foundation','Austin','Travis County','TX',['austincf.org'],'https://www.austincf.org/apply-for-funding/grants/'),
 f('foundation-for-the-carolinas','Foundation For The Carolinas','Charlotte','Mecklenburg County','NC',['fftc.org'],'https://www.fftc.org/apply-grant'),
 f('columbus-foundation','The Columbus Foundation','Columbus','Franklin County','OH',['columbusfoundation.org'],'https://columbusfoundation.org/nonprofit-center/grant-opportunities'),
 f('central-indiana-cf','Central Indiana Community Foundation','Indianapolis','Marion County','IN',['cicf.org'],'https://www.cicf.org/nonprofit-resources/'),
 f('san-francisco-foundation','The San Francisco Foundation','San Francisco','San Francisco County','CA',['sff.org'],'https://sff.org/'),
 f('seattle-foundation','Seattle Foundation','Seattle','King County','WA',['seattlefoundation.org'],'https://www.seattlefoundation.org/current-grant-opportunities/'),
 f('denver-foundation','The Denver Foundation','Denver','Denver County','CO',['denverfoundation.org'],'https://denverfoundation.org/our-grants-program/'),
 f('oklahoma-city-cf','Oklahoma City Community Foundation','Oklahoma City','Oklahoma County','OK',['occf.org'],'https://occf.org/nonprofits/grants/'),
 f('cf-middle-tennessee','The Community Foundation of Middle Tennessee','Nashville','Davidson County','TN',['cfmt.org'],'https://www.cfmt.org/nonprofits/'),
 f('el-paso-cf','El Paso Community Foundation','El Paso','El Paso County','TX',['epcf.org'],'https://epcf.org/grants-and-scholarships/apply-for-a-grant'),
 f('nevada-community-foundation','Nevada Community Foundation','Las Vegas','Clark County','NV',['nevadacf.org'],'https://www.nevadacf.org/','No stable grants path found by server checks; the homepage is the source.'),
 f('boston-foundation','The Boston Foundation','Boston','Suffolk County','MA',['tbf.org'],'https://www.tbf.org/nonprofits'),
 f('cleveland-foundation','Cleveland Foundation','Cleveland','Cuyahoga County','OH',['clevelandfoundation.org'],'https://www.clevelandfoundation.org/grants')
];
export function foundationById(id:unknown){return typeof id==='string'?communityFoundations.find(x=>x.id===id):undefined;}
export const verifiedFoundationIds=()=>communityFoundations.filter(x=>x.status==='verified'&&x.domains.length).map(x=>x.id);
export function foundationEvidenceHostAllowed(foundation:CommunityFoundation,sourceUrl:string){
 if(foundation.status!=='verified')return false;const host=bareHost(sourceUrl);if(!host)return false;
 const h=host.replace(/^www\./,'');return foundation.domains.some(d=>h===d.toLowerCase().replace(/^www\./,''));
}
// Who a foundation lead is for, by research category. Community foundations mostly fund nonprofits.
export const FOUNDATION_TYPES:Record<StateCategory,string[]>={business:['Nonprofit','Small business'],aid:['Student'],arts:['Individual','Freelancer','Nonprofit']};
export function foundationCategoriesFor(types:string[]):StateCategory[]{
 const out:StateCategory[]=[];if(types.some(t=>['Nonprofit','Small business'].includes(t)))out.push('business');if(types.includes('Student'))out.push('aid');if(types.some(t=>['Individual','Freelancer'].includes(t)))out.push('arts');return out;
}
// Re-labels a state-shaped lead as a community foundation lead (funder, source type, audience, id prefix).
export function foundationize(g:Grant,foundation:{id:string;name:string;city:string},stateName:string,category:'business'|'aid'|'arts'){
 const hash=g.id.split('-').pop();g.id=`cf-${foundation.id}-${hash}`;g.funder=foundation.name;g.source=`${foundation.name} · Community foundation`;g.sourceType=FOUNDATION_SOURCE_TYPE;g.types=[...FOUNDATION_TYPES[category]];
 g.kind=category==='aid'?(/scholarship/i.test(g.title)?'Scholarship':'Student aid'):FOUNDATION_KIND;if(!g.tags.includes('community foundation'))g.tags.push('community foundation');
 g.description=`Potential ${foundation.city}, ${stateName} community foundation ${category==='aid'?'scholarship or student funding':category==='arts'?'arts grant':'grant'} found on ${foundation.name}'s official site. Confirm the current cycle, eligibility and service area with the foundation.`;
 g.requirements=['Source-listed program lead; applicant eligibility and current availability are unverified.','Community foundation programs often limit eligibility by county or region, nonprofit status, or a fund\'s criteria.','Confirm the application window and any letter-of-inquiry or invitation step with the foundation.'];
 return g;
}
