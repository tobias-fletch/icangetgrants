import { sourceForState, evidenceHostAllowed, hostMatchesDomain, bareHost } from './state-registry';
import type { StateSource, StateCategory } from './state-registry';
// City coverage registry (Wave 1: ranks 1-10, Wave 2: ranks 11-25 of U.S. cities by population, Census Vintage 2024 estimates).
// Hosts are evidence allowlists for city research tasks:
//  - govDomains: registered .gov domains; the domain and any subdomain are accepted (lacity.gov, ewdd.lacity.gov).
//  - partnerHosts: city-designated non-.gov partners; matched exactly (a leading www. is ignored), never subdomains.
// Wave 1 hosts were verified reachable on 2026-10-23, Wave 2 (ranks 11-25) on 2026-10-24 with server checks (HTTP 200).
// Held pending browser verification (do not add without review): culturela.org (LA Dept. of Cultural Affairs, 403),
// sa.gov (San Antonio, 403), fortworthtexas.gov (403), sanjoseca.gov (403), okc.gov (403), charlottenc.gov (403) and
// columbus.gov (403). Washington, DC (rank 22) is not listed because DC is not in the state registry.
// Wave 2 and 3 cities only get research tasks when a monitored profile lives there (see research-plan.ts).
// county: the principal county, used for the catalog county filter; null when a city spans several (New York).
// NYC's edc.nyc and nycedc.com remain on the New York state localHosts list from PR #5 and are repeated here unchanged.
export type CityCategory=Extract<StateCategory,'business'|'arts'>;
export type CitySource={id:string;city:string;stateCode:string;rank:number;wave:1|2|3;govDomains:string[];partnerHosts:string[];sources:Partial<Record<CityCategory,string>>;status:'verified'|'pending verification';county?:string|null;note?:string};
export const CITY_REVISIT_DAYS:Record<1|2|3,number>={1:7,2:14,3:30};
export const citySources:CitySource[]=[
 {id:'new-york-ny',city:'New York',stateCode:'NY',rank:1,wave:1,govDomains:['nyc.gov'],partnerHosts:['edc.nyc','nycedc.com'],sources:{business:'https://www.nyc.gov/site/sbs/index.page',arts:'https://www.nyc.gov/site/dca/index.page'},county:null,status:'verified'},
 {id:'los-angeles-ca',city:'Los Angeles',stateCode:'CA',rank:2,wave:1,govDomains:['lacity.gov'],partnerHosts:[],sources:{business:'https://ewdd.lacity.gov/'},county:'Los Angeles County',status:'verified',note:'lacity.org now redirects to lacity.gov. Cultural Affairs (culturela.org) is held pending verification.'},
 {id:'chicago-il',city:'Chicago',stateCode:'IL',rank:3,wave:1,govDomains:['chicago.gov'],partnerHosts:[],sources:{business:'https://www.chicago.gov/city/en/depts/bacp/sbc.html',arts:'https://www.chicago.gov/city/en/depts/dca.html'},county:'Cook County',status:'verified'},
 {id:'houston-tx',city:'Houston',stateCode:'TX',rank:4,wave:1,govDomains:['houstontx.gov'],partnerHosts:['houstonartsalliance.com'],sources:{business:'https://www.houstontx.gov/obo/',arts:'https://www.houstontx.gov/culturalaffairs/'},county:'Harris County',status:'verified'},
 {id:'phoenix-az',city:'Phoenix',stateCode:'AZ',rank:5,wave:1,govDomains:['phoenix.gov'],partnerHosts:[],sources:{business:'https://www.phoenix.gov/',arts:'https://www.phoenix.gov/administration/departments/arts.html'},county:'Maricopa County',status:'verified'},
 {id:'philadelphia-pa',city:'Philadelphia',stateCode:'PA',rank:6,wave:1,govDomains:['phila.gov'],partnerHosts:['creativephl.org'],sources:{business:'https://www.phila.gov/departments/department-of-commerce/',arts:'https://www.phila.gov/departments/creative-philadelphia/'},county:'Philadelphia County',status:'verified'},
 {id:'san-antonio-tx',city:'San Antonio',stateCode:'TX',rank:7,wave:1,govDomains:[],partnerHosts:[],sources:{},county:'Bexar County',status:'pending verification',note:'sanantonio.gov redirects to sa.gov, which returned 403 to server checks; no hosts until verified in a browser.'},
 {id:'san-diego-ca',city:'San Diego',stateCode:'CA',rank:8,wave:1,govDomains:['sandiego.gov'],partnerHosts:[],sources:{business:'https://www.sandiego.gov/economic-development',arts:'https://www.sandiego.gov/economic-development/cultural-affairs'},county:'San Diego County',status:'verified'},
 {id:'dallas-tx',city:'Dallas',stateCode:'TX',rank:9,wave:1,govDomains:[],partnerHosts:['dallascityhall.com','dallasecodev.org'],sources:{business:'https://dallasecodev.org/',arts:'https://dallascityhall.com/departments/arts-culture/Pages/default.aspx'},county:'Dallas County',status:'verified',note:'Dallas city government uses dallascityhall.com (not .gov), so it is an exact-host partner.'},
 {id:'jacksonville-fl',city:'Jacksonville',stateCode:'FL',rank:10,wave:1,govDomains:['jacksonville.gov'],partnerHosts:[],sources:{business:'https://www.jacksonville.gov/departments/office-of-economic-development'},county:'Duval County',status:'verified'},
 // Wave 2: Census Vintage 2024 ranks 11-25.
 {id:'fort-worth-tx',city:'Fort Worth',stateCode:'TX',rank:11,wave:2,govDomains:[],partnerHosts:[],sources:{},county:'Tarrant County',status:'pending verification',note:'fortworthtexas.gov returned 403 to server checks; no hosts until verified in a browser.'},
 {id:'san-jose-ca',city:'San Jose',stateCode:'CA',rank:12,wave:2,govDomains:[],partnerHosts:[],sources:{},county:'Santa Clara County',status:'pending verification',note:'sanjoseca.gov returned 403 to server checks; no hosts until verified in a browser.'},
 {id:'austin-tx',city:'Austin',stateCode:'TX',rank:13,wave:2,govDomains:['austintexas.gov'],partnerHosts:[],sources:{business:'https://www.austintexas.gov/economic-development',arts:'https://www.austintexas.gov/arts-culture/funding-programs'},county:'Travis County',status:'verified'},
 {id:'charlotte-nc',city:'Charlotte',stateCode:'NC',rank:14,wave:2,govDomains:[],partnerHosts:['artsandscience.org'],sources:{arts:'https://artsandscience.org/artist-support-grants/'},county:'Mecklenburg County',status:'verified',note:'charlottenc.gov returned 403 to server checks; only the Arts & Science Council (city/county-designated arts agency) is listed.'},
 {id:'columbus-oh',city:'Columbus',stateCode:'OH',rank:15,wave:2,govDomains:[],partnerHosts:['gcac.org'],sources:{arts:'https://www.gcac.org/for-artists/artists-grants/'},county:'Franklin County',status:'verified',note:'columbus.gov returned 403 to server checks; only the Greater Columbus Arts Council (city arts grant administrator) is listed.'},
 {id:'indianapolis-in',city:'Indianapolis',stateCode:'IN',rank:16,wave:2,govDomains:['indy.gov'],partnerHosts:['indyarts.org'],sources:{business:'https://www.indy.gov/agency/department-of-metropolitan-development',arts:'https://indyarts.org/grants'},county:'Marion County',status:'verified'},
 {id:'san-francisco-ca',city:'San Francisco',stateCode:'CA',rank:17,wave:2,govDomains:['sf.gov'],partnerHosts:[],sources:{business:'https://www.sf.gov/departments--office-economic-and-workforce-development',arts:'https://www.sf.gov/departments--arts-commission'},county:'San Francisco County',status:'verified'},
 {id:'seattle-wa',city:'Seattle',stateCode:'WA',rank:18,wave:2,govDomains:['seattle.gov'],partnerHosts:[],sources:{business:'https://www.seattle.gov/economic-development',arts:'https://www.seattle.gov/arts'},county:'King County',status:'verified'},
 {id:'denver-co',city:'Denver',stateCode:'CO',rank:19,wave:2,govDomains:[],partnerHosts:['denvergov.org','artsandvenuesdenver.com'],sources:{business:'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Economic-Development-Opportunity/Business-Support/Grow-Your-Business',arts:'https://www.artsandvenuesdenver.com/grants-cultural-investments/grants'},county:'Denver County',status:'verified',note:'Denver city government uses denvergov.org (not .gov), so it is an exact-host partner.'},
 {id:'oklahoma-city-ok',city:'Oklahoma City',stateCode:'OK',rank:20,wave:2,govDomains:[],partnerHosts:[],sources:{},county:'Oklahoma County',status:'pending verification',note:'okc.gov returned 403 to server checks; no hosts until verified in a browser.'},
 {id:'nashville-tn',city:'Nashville',stateCode:'TN',rank:21,wave:2,govDomains:['nashville.gov'],partnerHosts:[],sources:{arts:'https://www.nashville.gov/departments/arts'},county:'Davidson County',status:'verified',note:'Metro Nashville economic-development pages returned 404; only Metro Arts is listed.'},
 {id:'el-paso-tx',city:'El Paso',stateCode:'TX',rank:23,wave:2,govDomains:['elpasotexas.gov'],partnerHosts:['elpasoeid.com'],sources:{business:'https://elpasoeid.com/'},county:'El Paso County',status:'verified',note:'elpasotexas.gov/economic-development redirects to elpasoeid.com (city Economic & International Development).'},
 {id:'las-vegas-nv',city:'Las Vegas',stateCode:'NV',rank:24,wave:2,govDomains:['lasvegasnevada.gov'],partnerHosts:[],sources:{business:'https://www.lasvegasnevada.gov/Business/Economic-Development',arts:'https://www.lasvegasnevada.gov/Residents/Arts-Culture'},county:'Clark County',status:'verified'},
 {id:'boston-ma',city:'Boston',stateCode:'MA',rank:25,wave:2,govDomains:['boston.gov'],partnerHosts:[],sources:{business:'https://www.boston.gov/government/cabinets/economic-opportunity-and-inclusion',arts:'https://www.boston.gov/departments/arts-and-culture'},county:'Suffolk County',status:'verified'}
];
export function cityById(id:unknown){return typeof id==='string'?citySources.find(c=>c.id===id):undefined;}
export function cityHosts(city:CitySource){return [...city.govDomains,...city.partnerHosts];}
// City evidence: anything the state accepts, plus the city's own .gov domains (with subdomains) and exact partner hosts.
export function cityEvidenceHostAllowed(city:CitySource,state:StateSource,sourceUrl:string){
 if(evidenceHostAllowed(state,sourceUrl))return true;
 const host=bareHost(sourceUrl);if(!host)return false;
 if(city.govDomains.some(domain=>domain.endsWith('.gov')&&hostMatchesDomain(host,domain)))return true;
 return city.partnerHosts.some(partner=>host.replace(/^www\./,'')===partner.toLowerCase().replace(/^www\./,''));
}
export function cityState(city:CitySource){return sourceForState(city.stateCode);}
