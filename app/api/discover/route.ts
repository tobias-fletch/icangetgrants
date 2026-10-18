import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getWorkspace, discover } from '@/lib/discovery';
export async function POST(request:Request){const u=await getChatGPTUser();if(!u)return Response.json({error:'Sign in required'},{status:401});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});const w=await getWorkspace(u.userId);return Response.json(await discover(w.profiles));}
