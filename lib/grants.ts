export type Profile = { id:string; name:string; type:string; country:string; state:string; keywords:string; goal:number; education:string; details:string; alerts:boolean };
export type Grant = { id:string; title:string; funder:string; description:string; types:string[]; countries:string[]; tags:string[]; amount:number|null; deadline:string|null; url:string; source:string; requirements:string[]; checked:string; discovered:string; kind:string; live:boolean; applicantCodes?:string[] };
export type Saved = { profileId:string; grantId:string; status:string; notes:string };
export type Workspace = { profiles:Profile[]; saved:Saved[]; seen:string };
export const empty:Workspace = {profiles:[], saved:[], seen:''};
export const seeds:Grant[] = [
 {id:'awesome',title:'Awesome Foundation microgrants',funder:'The Awesome Foundation',description:'Small grants for projects that make a community more awesome. Apply through a relevant local or topic chapter.',types:['Individual','Freelancer','Small business','Student'],countries:['Worldwide'],tags:['community','arts','education','creative'],amount:1000,deadline:null,url:'https://www.awesomefoundation.org/en',source:'Awesome Foundation',requirements:['Chapter-specific location and project rules apply.','Deadlines and active funding vary by chapter.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Microgrant',live:false},
 {id:'nase',title:'NASE Growth Grants',funder:'National Association for the Self-Employed',description:'Business growth funding for marketing, equipment, hiring, training, and other expansion needs.',types:['Freelancer','Small business'],countries:['United States'],tags:['business','equipment','marketing','training','technology'],amount:4000,deadline:null,url:'https://www.nase.org/become-a-member/member-benefits/business-resources/growth-grants',source:'NASE',requirements:['Eligible paid NASE membership is required; some monthly members must wait 90 days.','Funds cannot pay existing debt or rent/mortgage.','Confirm current award cycle and membership terms.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Business grant',live:false},
 {id:'amber',title:'WomensNet Amber Grant',funder:'WomensNet',description:'Monthly awards for women-owned businesses, with additional startup, category, and annual award opportunities.',types:['Freelancer','Small business'],countries:['United States','Canada'],tags:['business','startup','equipment','creative'],amount:15000,deadline:'2026-10-31',url:'https://ambergrantsforwomen.com/get-an-amber-grant/',source:'WomensNet',requirements:['Women-owned business eligibility must be confirmed.','An application fee applies; check the provider for the amount and waiver options.','Confirm residency, ownership rules, and the current monthly deadline.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Business grant',live:false},
 {id:'pell',title:'Federal Pell Grant',funder:'Federal Student Aid',description:'Need-based education funding for eligible undergraduate students. Apply through the FAFSA and your school, rather than a business grant application.',types:['Student'],countries:['United States'],tags:['education','tuition','college','training'],amount:null,deadline:null,url:'https://studentaid.gov/understand-aid/types/grants/pell',source:'Federal Student Aid',requirements:['Financial need, eligible citizenship status, and enrollment rules apply.','Usually for undergraduates who have not earned a bachelor’s or professional degree.','Award limits and FAFSA deadlines depend on the award year and school.'],checked:'2026-10-18',discovered:'2026-10-18',kind:'Student aid',live:false}
];
export function match(g:Grant,p:Profile) {
 const reasons:string[]=[]; const gaps=[...g.requirements];
 if(!g.types.includes(p.type)) return {score:0,reasons:['Applicant type does not match'],gaps};
 if(p.country && !g.countries.includes('Worldwide') && !g.countries.includes(p.country)) return {score:0,reasons:['Country does not match'],gaps};
 let score=40; reasons.push(p.type+' applicant category aligns');
 if(p.country){score+=15;reasons.push(g.countries.includes('Worldwide')?'International chapter network':'Country is within the source coverage');} else gaps.push('Add your country to check geographic fit.');
 const words=p.keywords.toLowerCase().split(/[,\s]+/).filter(w=>w.length>2);
 const hay=(g.title+' '+g.description+' '+g.tags.join(' ')).toLowerCase();
 const hits=words.filter(w=>hay.includes(w));
 if(hits.length){score+=Math.min(25,hits.length*10);reasons.push('Relevant to '+hits.slice(0,3).join(', '));}else gaps.push('Project or field alignment needs review.');
 if(p.goal && g.amount && g.amount>=p.goal){score+=10;reasons.push('Published maximum covers your funding goal');}
 if(!p.state) gaps.push('State and local restrictions have not been checked.');
 if(g.live) gaps.push('Federal category match is preliminary; review the full notice for location, project, and other restrictions.');
 if(g.deadline && new Date(g.deadline+'T23:59:59Z')<new Date()) return {score:0,reasons:['Deadline has passed'],gaps};
 return {score:Math.min(90,score),reasons,gaps};
}
