import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const out=resolve('.sites-runtime/tests-usage');mkdirSync(out,{recursive:true});
for(const name of ['access','usage']){const source=readFileSync(`lib/${name}.ts`,'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");writeFileSync(`${out}/${name}.mjs`,js);}
const usage=await import(pathToFileURL(`${out}/usage.mjs`).href);
const access=await import(pathToFileURL(`${out}/access.mjs`).href);

const profile=(id,alerts,extra={})=>({id,name:'Private name '+id,type:'Student',country:'United States',state:'LA',keywords:'secret keyword',goal:0,education:'',details:'',alerts,...extra});
const rows=[
 ['user-a',JSON.stringify({profiles:[profile('1',true),profile('2',false)],saved:['x'],seen:''})],
 ['user-b',JSON.stringify({profiles:[profile('3',true)],saved:[],seen:''})],
 ['user-c',JSON.stringify({profiles:[],saved:[],seen:''})],
 ['user-d',JSON.stringify({saved:[]})],
 ['user-e','not json'],
 ['user-f',JSON.stringify({profiles:{alerts:true}})],
];

let sqlite=null;try{sqlite=await import('node:sqlite');}catch{}
test('usage SQL counts accounts, profiles and alerting profiles in one statement',{skip:!sqlite&&'node:sqlite unavailable'},()=>{
 const db=new sqlite.DatabaseSync(':memory:');db.exec('CREATE TABLE workspaces (owner text PRIMARY KEY NOT NULL, data text NOT NULL)');
 const insert=db.prepare('INSERT INTO workspaces (owner,data) VALUES (?,?)');for(const r of rows)insert.run(...r);
 const counts=usage.usageCounts(db.prepare(usage.USAGE_SQL).get());
 assert.deepEqual({...counts,note:undefined},{accounts:6,accountsWithProfiles:2,profiles:3,profilesWithAlerts:2,note:undefined});
 const empty=new sqlite.DatabaseSync(':memory:');empty.exec('CREATE TABLE workspaces (owner text PRIMARY KEY NOT NULL, data text NOT NULL)');
 assert.deepEqual({...usage.usageCounts(empty.prepare(usage.USAGE_SQL).get()),note:undefined},{accounts:0,accountsWithProfiles:0,profiles:0,profilesWithAlerts:0,note:undefined});
});

test('usage payload is numbers plus a fixed note, never row data',()=>{
 const counts=usage.usageCounts({accounts:2,profiles:'3',profilesWithAlerts:null,accountsWithProfiles:-1,owner:'user-a',data:'{"name":"x"}'});
 assert.deepEqual(Object.keys(counts).sort(),['accounts','accountsWithProfiles','note','profiles','profilesWithAlerts']);
 assert.deepEqual([counts.accounts,counts.profiles,counts.profilesWithAlerts,counts.accountsWithProfiles],[2,3,0,0]);
 assert.equal(counts.note,usage.USAGE_NOTE);assert.equal(usage.usageCounts(null).accounts,0);
});

test('non-owners get no usage and the database is never queried',async()=>{
 let calls=0;const first=async()=>{calls++;return {accounts:5};};
 assert.equal(await usage.ownerUsage(null,false,first),null);
 assert.equal(await usage.ownerUsage({userId:'some-other-account'},false,first),null);
 assert.equal(await usage.ownerUsage({userId:'local_seedy'},false,first),null);
 assert.equal(calls,0);
 assert.equal((await usage.ownerUsage({userId:access.OWNER_USER_ID},false,first)).accounts,5);
 assert.equal((await usage.ownerUsage({userId:'local_seedy'},true,first)).accounts,5);assert.equal(calls,2);
});

test('refresh status route returns 403 before computing usage',()=>{
 const route=readFileSync('app/api/refresh/route.ts','utf8');const get=route.slice(route.indexOf('export async function GET'));
 const gate=get.indexOf("if(!await isOwner())return Response.json({error:'Owner access required'},{status:403});");
 assert.ok(gate>0);assert.ok(get.indexOf('ownerUsage(')>gate);
 assert.match(get,/ownerUsage\(await getChatGPTUser\(\),import\.meta\.env\.DEV,/);
 const mcp=readFileSync('app/mcp/route.ts','utf8');assert.match(mcp,/GET as status \} from '@\/app\/api\/refresh\/route'/);
});
