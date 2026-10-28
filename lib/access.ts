export const OWNER_USER_ID='vUAAbx22VMu4poBLS9fAMFmbhzltnsIdaRGF426EHUmVHJS0TMMj3q';
// Owner access is ChatGPT-only. Callers pass getChatGPTUser(); a Google session (linked or not) is always refused,
// even when a linked Google user's workspace key equals the owner's ChatGPT id.
export function ownerAccess(user:{userId:string;provider?:string}|null,development=false){if(!user||(user.provider!==undefined&&user.provider!=='chatgpt')||user.userId.startsWith('google:'))return false;return user.userId===OWNER_USER_ID||(development&&user.userId==='local_seedy');}
export function publicRefresh(value:any){if(!value)return null;return {checkedAt:value.checkedAt,checked:value.checked,sources:(value.sources||[]).map((s:any)=>({name:s.name,status:s.status,records:s.records,queries:s.queries,note:s.note,...(Array.isArray(s.warnings)&&s.warnings.length?{warnings:s.warnings}:{})})),coverage:value.coverage};}
