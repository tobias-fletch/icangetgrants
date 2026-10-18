import { getChatGPTUser } from '@/app/chatgpt-auth';
import { ownerAccess } from './access';
export async function isOwner(){return ownerAccess(await getChatGPTUser(),import.meta.env.DEV);}
