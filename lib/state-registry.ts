import { STATES, stateName, countryName } from './source-parsers';
import type { Profile } from './grants';
export type StateCategory='business'|'aid'|'arts';
export const STATE_CATEGORIES:StateCategory[]=['business','aid','arts'];
export type StateSource={code:string;state:string;business:{url:string;fallback:string};aid:{url:string;fallback:string};arts:{url:string;fallback:string};localHosts:string[]};
// Official state agencies or state-designated development/aid authorities.
// Deep links have agency-home fallbacks; reachability is checked at runtime.
const rows=[
 ['AL','https://www.madeinalabama.com/','https://www.madeinalabama.com/','https://sp.ache.edu/student-financial-aid/','https://sp.ache.edu/'],
 ['AK','https://www.commerce.alaska.gov/web/ded/DEV/SmallBusinessAssistanceCenter.aspx','https://aksbdc.org/','https://acpe.alaska.gov/Funding-Solutions','https://acpe.alaska.gov/'],
 ['AZ','https://www.azcommerce.com/small-business/','https://www.maricopa-sbdc.com/','https://azregents.edu/','https://highered.az.gov/'],
 ['AR','https://www.arkansasedc.com/business-resources/small-business-entrepreneurship-development','https://www.arkansasedc.com/','https://sams.adhe.edu/','https://adhe.edu/'],
 ['CA','https://business.ca.gov/','https://business.ca.gov/','https://www.csac.ca.gov/financial-aid-programs','https://admission.universityofcalifornia.edu/tuition-financial-aid/apply-for-financial-aid/'],
 ['CO','https://oedit.colorado.gov/programs-and-funding','https://www.coloradoenterprisefund.org/small-business-grants','https://cdhe.colorado.gov/financial-aid','https://thehub.colostate.edu/financial-aid/'],
 ['CT','https://portal.ct.gov/decd','https://portal.ct.gov/decd','https://portal.ct.gov/ohe','https://ohe.ct.gov/'],
 ['DE','https://business.delaware.gov/incentives/','https://business.delaware.gov/','https://education.delaware.gov/?page_id=14584','https://www.udel.edu/students/student-financial-services/undergraduate/'],
 ['FL','https://floridajobs.org/small-business','https://floridasbdc.org/','https://www.floridastudentfinancialaid.org/','https://www.floridastudentfinancialaidsg.org/SAPHome/SAPHome'],
 ['GA','https://georgia.org/small-business','https://georgiasbdc.org/','https://www.gafutures.org/hope-state-aid-programs/','https://www.gafutures.org/'],
 ['HI','https://invest.hawaii.gov/business-programs/','https://dbedt.hawaii.gov/','https://hawaii.edu/costs/financial-aid','https://www.hawaii.edu/tuition/'],
 ['ID','https://commerce.idaho.gov/incentives-and-financing/grants/','https://idahosbdc.org/','https://boardofed.idaho.gov/education-programs/state-aid-tuition-exchange/','https://boardofed.idaho.gov/'],
 ['IL','https://dceo.illinois.gov/aboutdceo/grantopportunities.html','https://dceo.illinois.gov/','https://www.isac.org/students/during-college/types-of-financial-aid/grants/','https://www.osfa.illinois.edu/types-of-aid/grants/'],
 ['IN','https://iedc.in.gov/programs','https://iedc.in.gov/','https://www.in.gov/che/state-financial-aid/state-financial-aid-by-program/','https://www.in.gov/che/'],
 ['IA','https://opportunityiowa.gov/business/small-business-entrepreneurs','https://www.iowaeda.com/','https://educate.iowa.gov/higher-ed/financial-aid','https://educate.iowa.gov/'],
 ['KS','https://www.kansascommerce.gov/program/business-incentives-and-services/','https://www.kansascommerce.gov/','https://kansasregents.gov/students/student_financial_aid/scholarships_and_grants','https://www.kansasregents.org/'],
 ['KY','https://newkentuckyhome.ky.gov/','https://ced.ky.gov/','https://www.kheaa.com/web/scholarships-grants.faces?lv=true','https://www.kheaa.com/'],
 ['LA','https://www.opportunitylouisiana.gov/','https://www.opportunitylouisiana.gov/','https://mylosfa.la.gov/paying-for-college/scholarships-grants/','https://mylosfa.la.gov/'],
 ['ME','https://www.maine.gov/decd/business-development/financial-incentives-resources/resources','https://www.mainesbdc.org/','https://www.famemaine.com/','https://www.famemaine.com/'],
 ['MD','https://commerce.maryland.gov/financial-incentives','https://commerce.maryland.gov/','https://mhec.maryland.gov/preparing/Pages/FinancialAid/descriptions.aspx','https://mhec.maryland.gov/'],
 ['MA','https://www.mass.gov/orgs/executive-office-of-economic-development','https://www.mass.gov/orgs/executive-office-of-economic-development','https://www.mass.edu/osfa/programs/programs.asp','https://www.mass.edu/osfa/'],
 ['MI','https://www.michiganbusiness.org/','https://www.michiganbusiness.org/','https://www.michigan.gov/mistudentaid/programs','https://www.michigan.gov/mistudentaid'],
 ['MN','https://mn.gov/deed/dobusiness/doing-business-here/resources/','https://mn.gov/deed/','https://ohe.mn.gov/','https://www.ohe.state.mn.us/'],
 ['MS','https://mississippi.org/','https://mississippi.org/','https://www.msfinancialaid.org/','https://www.msfinancialaid.org/'],
 ['MO','https://ded.mo.gov/program-lookup','https://ded.mo.gov/','https://dhewd.mo.gov/','https://dhewd.mo.gov/'],
 ['MT','https://commerce.mt.gov/Business/','https://commerce.mt.gov/','https://www.mus.edu/Prepare/Pay/Scholarships/index.html','https://www.mus.edu/'],
 ['NE','https://opportunity.nebraska.gov/programs/','https://opportunity.nebraska.gov/','https://ccpe.nebraska.gov/financial-aid','https://ccpe.nebraska.gov/'],
 ['NV','https://goed.nv.gov/incentives/','https://goed.nv.gov/','https://nshe.nevada.edu/system-administration/departments/asa/students/financial-aid/','https://nshe.nevada.edu/'],
 ['NH','https://www.nheconomy.com/','https://www.nheconomy.com/','https://www.education.nh.gov/','https://www.education.nh.gov/'],
 ['NJ','https://www.njeda.gov/financing-and-incentives/','https://www.njeda.gov/','https://www.hesaa.org/Pages/NJGrantsHome.aspx','https://www.hesaa.org/'],
 ['NM','https://edd.newmexico.gov/','https://edd.newmexico.gov/','https://hed.nm.gov/financial-aid/','https://hed.nm.gov/'],
 ['NY','https://esd.ny.gov/','https://esd.ny.gov/','https://hesc.ny.gov/find-aid/nys-grants-scholarships','https://www.hesc.ny.gov/'],
 ['NC','https://www.commerce.nc.gov/grants-incentives','https://www.commerce.nc.gov/','https://www.cfnc.org/','https://www.cfnc.org/'],
 ['ND','https://www.commerce.nd.gov/economic-development-finance','https://www.commerce.nd.gov/','https://www.nd.gov/dpi/familiescommunity/students/north-dakota-scholarship','https://ndus.edu/'],
 ['OH','https://www.jobsohio.com/incentives-programs/support-for-small-businesses','https://www.jobsohio.com/incentives-programs','https://highered.ohio.gov/students/pay-for-college/ohio-grants-scholarships','https://sfa.osu.edu/current-student/about-aid/types-of-aid/grants'],
 ['OK','https://www.okcommerce.gov/doing-business/business-relocation-expansion/incentives/','https://www.okcommerce.gov/','https://www.okcollegestart.org/','https://www.okcollegestart.org/'],
 ['OR','https://www.oregon.gov/biz/programs/Pages/default.aspx','https://www.oregon.gov/biz/','https://oregonstudentaid.gov/grants/','https://oregonstudentaid.gov/'],
 ['PA','https://dced.pa.gov/programs-funding/','https://dced.pa.gov/','https://www.pheaa.org/grants/state-grant-program','https://www.pheaa.org/'],
 ['RI','https://commerceri.com/financing/','https://commerceri.com/','https://riopc.edu/','https://riopc.edu/'],
 ['SC','https://www.sccommerce.com/why-sc/incentives-taxes','https://www.sccommerce.com/','https://che.sc.gov/','https://che.sc.gov/'],
 ['SD','https://sdgoed.com/financing-incentives/','https://sdgoed.com/','https://sdbor.edu/','https://sdbor.edu/'],
 ['TN','https://tnecd.com/why-tennessee/incentives-grants/','https://tnecd.com/','https://www.collegefortn.org/tennessee-financial-aid/','https://www.collegefortn.org/about-financial-aid/'],
 ['TX','https://gov.texas.gov/business/page/financing-and-capital','https://gov.texas.gov/business','https://www.highered.texas.gov/State%20Financial%20Aid/','https://www.highered.texas.gov/'],
 ['UT','https://business.utah.gov/grants-funding/','https://business.utah.gov/','https://ushe.edu/','https://ushe.edu/'],
 ['VT','https://accd.vermont.gov/economic-development/business-resources','https://accd.vermont.gov/','https://www.vsac.org/','https://www.vsac.org/'],
 ['VA','https://www.vedp.org/incentives-support','https://www.vedp.org/','https://www.schev.edu/financial-aid/financial-aid/federal-state-financial-aid','https://www.schev.edu/'],
 ['WA','https://www.commerce.wa.gov/access-to-capital/','https://www.commerce.wa.gov/','https://wsac.wa.gov/financial-aid','https://wsac.wa.gov/'],
 ['WV','https://westvirginia.gov/incentives-and-programs/','https://westvirginia.gov/','https://www.cfwv.com/','https://www.collegeforwv.com/'],
 ['WI','https://wedc.org/','https://wedc.org/','https://heab.state.wi.us/programs.html','https://heab.state.wi.us/'],
 ['WY','https://wyomingbusiness.org/business/financing/','https://wyomingbusiness.org/','https://edu.wyoming.gov/','https://edu.wyoming.gov/']
];
// Official state arts agencies (the state arts council or its host department), used for Individual and Freelancer
// profiles. Each URL was reachable on 2026-10-23 except AK, GA, NH, NY and VT (403 to server requests) and OH (404 to
// server requests); those report Browser review at runtime and are researched in a normal browser.
const artsRows:Record<string,string>={
 AL:'https://arts.alabama.gov/',
 AK:'https://arts.alaska.gov/',
 AZ:'https://azarts.gov/',
 AR:'https://www.arkansasheritage.com/arkansas-art-council/about/aac-grants',
 CA:'https://arts.ca.gov/',
 CO:'https://oedit.colorado.gov/colorado-creative-industries',
 CT:'https://portal.ct.gov/decdartsportal',
 DE:'https://arts.delaware.gov/',
 FL:'https://dos.fl.gov/cultural/',
 GA:'https://gaarts.org/',
 HI:'https://sfca.hawaii.gov/',
 ID:'https://arts.idaho.gov/',
 IL:'https://arts.illinois.gov/',
 IN:'https://www.in.gov/arts/',
 IA:'https://opportunityiowa.gov/community/arts-culture',
 KS:'https://www.kansascommerce.gov/program/kansas-creative-arts-and-industries-commission-kcaic/',
 KY:'https://artscouncil.ky.gov/',
 LA:'https://www.crt.state.la.us/cultural-development/arts/',
 ME:'https://mainearts.maine.gov/',
 MD:'https://msac.org/',
 MA:'https://massculturalcouncil.org/',
 MI:'https://www.michiganbusiness.org/arts/',
 MN:'https://www.arts.state.mn.us/',
 MS:'https://arts.ms.gov/',
 MO:'https://missouriartscouncil.org/',
 MT:'https://art.mt.gov/',
 NE:'https://www.artscouncil.nebraska.gov/',
 NV:'https://nvculture.org/nevadaartscouncil/',
 NH:'https://www.dncr.nh.gov/arts',
 NJ:'https://nj.gov/state/njsca/',
 NM:'https://nmarts.org/',
 NY:'https://arts.ny.gov/',
 NC:'https://www.ncarts.org/',
 ND:'https://www.arts.nd.gov/',
 OH:'https://oac.ohio.gov/',
 OK:'https://oklahoma.gov/arts.html',
 OR:'https://www.oregon.gov/biz/aboutus/artscommission/Pages/default.aspx',
 PA:'https://www.pa.gov/agencies/coa',
 RI:'https://arts.ri.gov/',
 SC:'https://www.southcarolinaarts.com/',
 SD:'https://www.sd.gov/sdac',
 TN:'https://tnartscommission.org/',
 TX:'https://www.arts.texas.gov/',
 UT:'https://artsandmuseums.utah.gov/',
 VT:'https://www.vermontartscouncil.org/',
 VA:'https://vca.virginia.gov/',
 WA:'https://www.arts.wa.gov/',
 WV:'https://wvculture.org/agencies/arts/',
 WI:'https://artsboard.wisconsin.gov/Pages/home.aspx',
 WY:'https://wyoarts.state.wy.us/'
};
// City and local government hosts, matched as the exact host or a subdomain (www1.nyc.gov matches nyc.gov).
// Lookalikes such as evilnyc.gov or nyc.gov.evil.com do not match. NYC Economic Development Corporation
// (edc.nyc, formerly nycedc.com) administers city business grant programs, so its domains are listed explicitly.
const localHostAllowlist:Record<string,string[]>={NY:['nyc.gov','nyc-business.nyc.gov','edc.nyc','nycedc.com']};
export const stateSources:StateSource[]=rows.map(([code,url,fallback,aid,aidFallback])=>({code,state:STATES[code],business:{url,fallback},aid:{url:aid,fallback:aidFallback},arts:{url:artsRows[code],fallback:artsRows[code]},localHosts:localHostAllowlist[code]||[]}));
// Never show a misleading "0 source routes checked": with no count (signed out, not yet scanned, or unavailable)
// the Sources tab says routes are checked daily instead.
export function sourceRoutesLabel(count:unknown){return typeof count==='number'&&Number.isFinite(count)&&count>0?`${Math.floor(count)} source routes checked`:'Source routes are checked daily';}
export function sourceForState(value:string){return stateSources.find(s=>s.state===stateName(value));}
function hostOf(value:string){try{const u=new URL(value);if(u.protocol!=='http:'&&u.protocol!=='https:')return '';return u.hostname.toLowerCase().replace(/\.$/,'');}catch{return '';}}
function registrable(value:string){const raw=value.trim().toLowerCase().replace(/\.$/,'');if(!raw)return '';const host=raw.includes('://')?hostOf(raw):raw;return host.replace(/^www\./,'');}
function isHostOrChild(host:string,domain:string){const d=registrable(domain);return !!d&&(host===d||host.endsWith('.'+d));}
export function bareHost(value:string){return hostOf(value);}
export function hostMatchesDomain(host:string,domain:string){return isHostOrChild(host.toLowerCase().replace(/\.$/,''),domain);}
// .gov is restricted to U.S. government registrants, so an already-allowed .gov host vouches for its whole
// registered .gov domain (commerce.alaska.gov -> alaska.gov, nyc-business.nyc.gov -> nyc.gov). Other hosts get no widening.
export function govDomain(host:string){const h=registrable(host);if(!h.endsWith('.gov'))return '';const labels=h.split('.');return labels.length>=2?labels.slice(-2).join('.'):'';}
// Configured agency hosts stay exact (leading www. ignored) unless they are .gov, in which case their registered .gov
// domain and its subdomains are accepted. Allowlisted local hosts and official state .gov domains accept the exact host
// or a subdomain. State .gov identity is a suffix (ny.gov, *.ny.gov, new-york.gov), not a ".ny." substring and not a
// mention of the state name anywhere in the URL.
export function evidenceHostAllowed(source:StateSource,sourceUrl:string){
 const host=hostOf(sourceUrl);if(!host)return false;const bare=host.replace(/^www\./,'');
 const configured=[source.business.url,source.business.fallback,source.aid.url,source.aid.fallback,source.arts.url,source.arts.fallback].map(u=>hostOf(u).replace(/^www\./,'')).filter(Boolean);
 if(configured.includes(bare))return true;
 const local=source.localHosts||[];
 if(local.some(domain=>isHostOrChild(host,domain)))return true;
 if([...configured,...local].map(govDomain).filter(Boolean).some(domain=>isHostOrChild(host,domain)))return true;
 const code=source.code.toLowerCase(),hyphen=source.state.toLowerCase().replace(/ /g,'-'),compact=source.state.toLowerCase().replace(/ /g,'');
 const gov=[`${code}.gov`,`${hyphen}.gov`];if(compact!==hyphen)gov.push(`${compact}.gov`);
 return gov.some(domain=>isHostOrChild(host,domain));
}
// Every monitored profile (see monitoredProfiles) gets state routes; alerts only control who is notified.
// Small business, Freelancer and Nonprofit profiles get business tasks, Students get aid, and Individual and
// Freelancer profiles (artists, writers and other creatives) get state arts agency tasks.
export function statePlan(profiles:Profile[]){const tasks=new Map<string,{source:StateSource;category:StateCategory}>();for(const p of profiles){if(countryName(p.country)!=='United States')continue;const source=sourceForState(p.state);if(!source)continue;if(['Small business','Freelancer','Nonprofit'].includes(p.type))tasks.set(source.code+'-business',{source,category:'business'});if(p.type==='Student')tasks.set(source.code+'-aid',{source,category:'aid'});if(['Individual','Freelancer'].includes(p.type))tasks.set(source.code+'-arts',{source,category:'arts'});}return [...tasks.values()];}
