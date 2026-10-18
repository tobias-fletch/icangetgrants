import { POST as refresh, GET as status } from '@/app/api/refresh/route';
const toolList=[{name:'refresh_grants',description:'Refresh monitored profiles from federal grants, CareerOneStop scholarship listings, California state grants, U.S. Chamber private-business grant leads, Poets & Writers awards, and official student aid page checks. Persist source health, new matches, and retrieval evidence. Unconfirmed cycles remain marked; awards are separate from grants.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'grant_refresh_status',description:'Read the last persisted multi-source scan, source health, coverage, and number of funding records.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
export async function POST(request:Request){
 let message:any;try{message=await request.json();}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},{status:400});}
 if(message.id===undefined)return new Response(null,{status:202});
 const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id:message.id,result});
 if(message.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(message.method==='initialize')return reply({protocolVersion:message.params?.protocolVersion||'2026-07-28',capabilities:{tools:{}},serverInfo:{name:'grantwell',version:'1.0.0'}});
 if(message.method==='tools/list')return reply({tools:toolList});
 if(message.method==='tools/call'){
  try{const name=message.params?.name;const response=name==='refresh_grants'?await refresh():name==='grant_refresh_status'?await status():null;if(!response)throw new Error('Unknown tool');return reply({content:[{type:'text',text:JSON.stringify(await response.json())}]});}catch(e){return reply({content:[{type:'text',text:(e as Error).message}],isError:true});}
 }
 return Response.json({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}});
}
