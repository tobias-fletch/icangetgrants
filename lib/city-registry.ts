import { sourceForState, evidenceHostAllowed, hostMatchesDomain, bareHost } from './state-registry';
import type { StateSource, StateCategory } from './state-registry';
// City coverage registry (Wave 1: the largest U.S. cities by population, Census Vintage 2024 estimates).
// Hosts are evidence allowlists for city research tasks:
//  - govDomains: registered .gov domains; the domain and any subdomain are accepted (lacity.gov, ewdd.lacity.gov).
//  - partnerHosts: city-designated non-.gov partners; matched exactly (a leading www. is ignored), never subdomains.
// Only hosts verified reachable on 2026-10-23 are listed. Held pending browser verification (do not add without review):
// culturela.org (LA Dept. of Cultural Affairs, 403), sa.gov (San Antonio, 403) and any Fort Worth host (403).
// NYC's edc.nyc and nycedc.com remain on the New York state localHosts list from PR #5 and are repeated here unchanged.
export type CityCategory=Extract<StateCategory,'business'|'arts'>;
export type CitySource={id:string;city:string;stateCode:string;rank:number;wave:1|2|3;govDomains:string[];partnerHosts:string[];sources:Partial<Record<CityCategory,string>>;status:'verified'|'pending verification';note?:string};
export const CITY_REVISIT_DAYS:Record<1|2|3,number>={1:7,2:14,3:30};
export const citySources:CitySource[]=[
 {id:'new-york-ny',city:'New York',stateCode:'NY',rank:1,wave:1,govDomains:['nyc.gov'],partnerHosts:['edc.nyc','nycedc.com'],sources:{business:'https://www.nyc.gov/site/sbs/index.page',arts:'https://www.nyc.gov/site/dca/index.page'},status:'verified'},
 {id:'los-angeles-ca',city:'Los Angeles',stateCode:'CA',rank:2,wave:1,govDomains:['lacity.gov'],partnerHosts:[],sources:{business:'https://ewdd.lacity.gov/'},status:'verified',note:'lacity.org now redirects to lacity.gov. Cultural Affairs (culturela.org) is held pending verification.'},
 {id:'chicago-il',city:'Chicago',stateCode:'IL',rank:3,wave:1,govDomains:['chicago.gov'],partnerHosts:[],sources:{business:'https://www.chicago.gov/city/en/depts/bacp/sbc.html',arts:'https://www.chicago.gov/city/en/depts/dca.html'},status:'verified'},
 {id:'houston-tx',city:'Houston',stateCode:'TX',rank:4,wave:1,govDomains:['houstontx.gov'],partnerHosts:['houstonartsalliance.com'],sources:{business:'https://www.houstontx.gov/obo/',arts:'https://www.houstontx.gov/culturalaffairs/'},status:'verified'},
 {id:'phoenix-az',city:'Phoenix',stateCode:'AZ',rank:5,wave:1,govDomains:['phoenix.gov'],partnerHosts:[],sources:{business:'https://www.phoenix.gov/',arts:'https://www.phoenix.gov/administration/departments/arts.html'},status:'verified'},
 {id:'philadelphia-pa',city:'Philadelphia',stateCode:'PA',rank:6,wave:1,govDomains:['phila.gov'],partnerHosts:['creativephl.org'],sources:{business:'https://www.phila.gov/departments/department-of-commerce/',arts:'https://www.phila.gov/departments/creative-philadelphia/'},status:'verified'},
 {id:'san-antonio-tx',city:'San Antonio',stateCode:'TX',rank:7,wave:1,govDomains:[],partnerHosts:[],sources:{},status:'pending verification',note:'sanantonio.gov redirects to sa.gov, which returned 403 to server checks; no hosts until verified in a browser.'},
 {id:'san-diego-ca',city:'San Diego',stateCode:'CA',rank:8,wave:1,govDomains:['sandiego.gov'],partnerHosts:[],sources:{business:'https://www.sandiego.gov/economic-development',arts:'https://www.sandiego.gov/economic-development/cultural-affairs'},status:'verified'},
 {id:'dallas-tx',city:'Dallas',stateCode:'TX',rank:9,wave:1,govDomains:[],partnerHosts:['dallascityhall.com','dallasecodev.org'],sources:{business:'https://dallasecodev.org/',arts:'https://dallascityhall.com/departments/arts-culture/Pages/default.aspx'},status:'verified',note:'Dallas city government uses dallascityhall.com (not .gov), so it is an exact-host partner.'},
 {id:'jacksonville-fl',city:'Jacksonville',stateCode:'FL',rank:10,wave:1,govDomains:['jacksonville.gov'],partnerHosts:[],sources:{business:'https://www.jacksonville.gov/departments/office-of-economic-development'},status:'verified'}
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
