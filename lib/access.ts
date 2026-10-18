export const OWNER_USER_ID='vUAAbx22VMu4poBLS9fAMFmbhzltnsIdaRGF426EHUmVHJS0TMMj3q';
export function ownerAccess(user:{userId:string}|null,development=false){return !!user&&(user.userId===OWNER_USER_ID||(development&&user.userId==='local_seedy'));}
export function publicRefresh(value:any){if(!value)return null;return {checkedAt:value.checkedAt,checked:value.checked,sources:(value.sources||[]).map((s:any)=>({name:s.name,status:s.status,records:s.records,queries:s.queries,note:s.note})),coverage:value.coverage};}
