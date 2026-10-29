import { empty } from '@/lib/grants';
import { countryName, stateName } from '@/lib/source-parsers';
import { sourceForState } from '@/lib/state-registry';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { authStatus, getCurrentUser } from '@/app/current-user';
import { getWorkspace, saveWorkspace } from '@/lib/discovery';
import { loadCatalog, loadPublicCatalog } from '@/lib/catalog';
import { pageOf, parseResultsQuery, rankGrants } from '@/lib/home-results';
import { PUBLIC_API_CACHE_CONTROL } from '@/lib/home-cache';
import { getDb } from '@/db';
import { jobs } from '@/db/schema';
import { ownerAccess } from '@/lib/access';
import { visibleStateCoverage } from '@/lib/workspace-privacy';
// Signed-out visitors get the public catalog and freshness only. Signed-in accounts get their own workspace and
// only the state scan reports their own profiles schedule; monitoring details for other accounts stay owner-only.
// Workspace data is keyed by getCurrentUser() (ChatGPT id, a linked ChatGPT id, or google:<sub>). Owner views use ChatGPT only.
// ?public=1 is the identity-free public results API the home page pages through: it never reads cookies or
// identity headers, so it may be cached (PUBLIC_API_CACHE_CONTROL). With page=N it returns one ranked page
// ({grants,total,page,pageSize,pages}); without page it returns the whole public catalog (guest profile matching).
// ?lite=1 is the normal private response without the catalog (auth status, freshness, the workspace itself).
async function publicResults(url:URL){const loaded=await loadPublicCatalog();const base={refresh:loaded.refresh,catalogError:loaded.error,catalogSource:loaded.source};let body;if(url.searchParams.has('page')){const q=parseResultsQuery(url.searchParams);body={...base,...pageOf(rankGrants(loaded.grants,q),q.page,q.pageSize)};}else body={...base,grants:loaded.grants};return Response.json(body,{headers:{'Cache-Control':loaded.error?'no-store':PUBLIC_API_CACHE_CONTROL}});}
export async function GET(request?:Request){const url=new URL(request?.url||'http://localhost/');if(url.searchParams.get('public')==='1')return publicResults(url);const lite=url.searchParams.get('lite')==='1';const u=await getCurrentUser();const owner=ownerAccess(await getChatGPTUser(),import.meta.env.DEV);const state=u?await getWorkspace(u.userId):empty;const loaded=lite?{...(await loadPublicCatalog()),grants:undefined}:await loadCatalog({owner,keepIds:u?state.saved.map(s=>s.grantId):[]});const reports=u?(await getDb().select().from(jobs)).filter(r=>r.id.startsWith('state-')).map(r=>JSON.parse(r.data)):[];const stateCoverage=visibleStateCoverage(reports,state.profiles,owner);return Response.json({state,stateCoverage,grants:loaded.grants,refresh:loaded.refresh,catalogError:loaded.error,catalogSource:loaded.source,authenticated:!!u,name:u?.fullName|| (u?'Your workspace':'Guest search'),auth:await authStatus(u)},{headers:{'Cache-Control':'private, no-store'}});}
export async function PUT(request:Request){const u=await getCurrentUser();if(!u)return Response.json({error:'Sign in required'},{status:401});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});const raw=await request.text();if(raw.length>150000)return Response.json({error:'Workspace too large'},{status:413});let data;try{data=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400});}if(!Array.isArray(data.profiles)||data.profiles.length>50||!Array.isArray(data.saved)||data.saved.length>500||data.profiles.some((p:any)=>typeof p.id!=='string'||typeof p.name!=='string'||!['Student','Individual','Freelancer','Small business','Nonprofit'].includes(p.type)||typeof p.country!=='string'||typeof p.state!=='string'||typeof p.keywords!=='string'||typeof p.alerts!=='boolean'))return Response.json({error:'Invalid workspace data'},{status:400});for(const p of data.profiles){p.country=countryName(p.country);p.state=stateName(p.state);if(p.country==='United States'&&!sourceForState(p.state)&&p.state!=='District of Columbia')return Response.json({error:'Choose a valid U.S. state name or abbreviation.'},{status:400});}await saveWorkspace(u.userId,data);return Response.json({ok:true});}
