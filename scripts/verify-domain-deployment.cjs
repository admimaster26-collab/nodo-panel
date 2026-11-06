'use strict';
// Rehearsal against captured remote column types/auth definition, with fake rows only.
// No network. Snapshot and restore remain outside the repository.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {resolvePGlite}=require('./verify-beta-server.cjs');
const ROOT=path.resolve(__dirname,'..');
const files=['perfil-v1.sql','persistencia-local-v1.sql','identidad-observaciones-v1.sql','lecturas-operativas-v1.sql','capacidades-v1.sql'].map(f=>'servidor/dominios/'+f);
const ident=s=>'"'+String(s).replaceAll('"','""')+'"';
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
const digest=(s,kind='sha256')=>crypto.createHash(kind).update(s).digest('hex');
function opt(name){const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];}
async function verify(){
 const snapshotPath=opt('--snapshot'),restorePath=opt('--restore'),reportPath=opt('--report');
 if(!snapshotPath||!restorePath)throw Error('Use --snapshot PRIVATE.json --restore PRIVATE.sql [--report report.json]');
 if(!path.relative(ROOT,path.resolve(restorePath)).startsWith('..'))throw Error('Restore must stay outside repo');
 const raw=fs.readFileSync(snapshotPath,'utf8').replace(/^\uFEFF/,''),snapshot=JSON.parse(raw);
 const old=snapshot.functions.find(x=>x.name==='nodo_beta_capacidades_v1');
 const auth=snapshot.functions.find(x=>x.schema==='nodo_beta'&&x.name==='autorizar');
 assert.ok(old&&auth&&snapshot.columns.length);
 const PGlite=resolvePGlite(),db=new PGlite();
 const report={started_at:new Date().toISOString(),snapshot_sha256:digest(raw),source_hashes:{},tests:[],limitations:['Column types and auth copied from remote catalog; isolated synthetic data. No deployed/runtime proof.']};
 const texts=files.map(f=>{const s=fs.readFileSync(path.join(ROOT,f),'utf8');report.source_hashes[f]=digest(s);return s;});
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 async function check(name,fn){await fn();report.tests.push({name,ok:true});}
 async function call(name,args){
   await db.exec('begin;set local role anon');
   try{return (await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;}
   finally{await db.exec('rollback');}
 }
 const capSig='public.nodo_beta_capacidades_v1(text,text,text,boolean)';
 const catalog=async()=>q(`select md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.proacl::text acl from pg_proc p where p.oid=to_regprocedure($1)`,[capSig]);
 try{
   await db.exec('create role anon;create role authenticated;');
   const tables=new Map();
   for(const c of snapshot.columns){const key=c.table_schema+'.'+c.table_name;if(!tables.has(key))tables.set(key,[]);tables.get(key).push(c);}
   for(const schema of new Set(snapshot.columns.map(c=>c.table_schema)))await db.exec('create schema if not exists '+ident(schema));
   for(const cols of tables.values()){
     const c=cols[0];
     // Defaults/constraints on existing tables are unnecessary for empty-read compilation.
     await db.exec('create table '+ident(c.table_schema)+'.'+ident(c.table_name)+'('+cols.map(c=>ident(c.column_name)+' '+ident(c.udt_name)).join(',')+')');
   }
   await db.exec(auth.definition);await db.exec(old.definition);
   await db.exec('revoke all on function '+capSig+' from public,anon,authenticated');
   for(const g of old.grants)await db.exec('grant '+g.privilege+' on function '+capSig+' to '+(g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee))+(g.grantable?' with grant option':''));
   const before=await catalog();assert.equal(before[0].md5,old.md5);
   const token='de'.repeat(32),pc='P1',usuario='fixture_deployment';
   await q("insert into nodo_beta.beta_clientes(id,token_hash,pc_codigo,enabled) values ('11111111-1111-4111-8111-111111111111',encode(sha256(convert_to($1,'UTF8')),'hex'),$2,true)",[token,pc]);
   await check('5 scripts install on captured remote column types and nodo_beta authority',async()=>{for(const s of texts)await db.exec(s);});
   const domains=['perfil.summary.v1','perfil.detail.v1','perfil.identity.v1','persistence.local.v1','historial.filters.v1','bandeja.queue.v1','nexo.export.v1'];
   await check('only installed capabilities announced; no phantom chat RPCs',async()=>{
     const r=await call('nodo_beta_capacidades_v1',[token,pc,'fixture-test',false]);assert.equal(r.scope.pc_codigo,pc);assert.deepEqual([...r.capabilities].sort(),domains.sort());
   });
   for(const [fn,args] of [
     ['nodo_beta_perfil_v1',[token,pc,usuario]],
     ['nodo_beta_perfil_detalle_v1',[token,pc,usuario,2,null]],
     ['nodo_beta_perfil_identidad_v1',[token,pc,usuario,2,null]],
     ['nodo_beta_historial_v1',[token,pc,{},2,null]],
     ['nodo_beta_bandeja_v1',[token,pc,{},2,null]],
     ['nodo_beta_nexo_export_v1',[token,pc,2,null]],
     ['nodo_beta_persistencia_leer_v1',[token,pc,usuario,null,'TODO',2,null]],
     ['nodo_beta_persistencia_sync_v1',[token,pc,'fixture-install','fixture-test',{}]]
   ])await check(fn+': compiles and authenticates on real schema shape',async()=>{const r=await call(fn,args);assert.equal(r.ok,true);assert.equal(r.contract,'nodo.beta.v1');assert.equal(r.scope.pc_codigo,pc);});
   await check('wrong office rejected using exact deployed authorization',async()=>{await assert.rejects(call('nodo_beta_perfil_v1',[token,'P2',usuario]),/BETA_NOT_AUTHORIZED/);});
   const after=(await catalog())[0];report.before_md5=old.md5;report.after_md5=after.md5;
   const grants=old.grants.map(g=>'grant '+g.privilege+' on function '+capSig+' to '+(g.grantee==='PUBLIC'?'PUBLIC':ident(g.grantee))+(g.grantable?' with grant option':'')+';').join('\n');
   const restore=`-- Owner of rollback decision: Juan; executor: deployment operator.\n-- Trigger: wrong scope, totals disagreement, lost/duplicate records, or new contract errors.\n-- Stops new capability negotiation. Cached clients require refresh/restart; data retained.\n-- Never drop persistence tables or replay observed queues.\nbegin;\nset local lock_timeout='5s';\ndo $guard$ begin\n if coalesce(md5(pg_get_functiondef(to_regprocedure(${literal(capSig)}))),'ABSENT') not in (${literal(old.md5)},${literal(after.md5)}) then raise exception 'RESTORE_DOMAIN_DRIFT'; end if;\nend $guard$;\n${old.definition};\nalter function ${capSig} owner to ${ident(old.owner)};\nrevoke all on function ${capSig} from public,anon,authenticated;\n${grants}\nnotify pgrst,'reload schema';\ncommit;\n`;
   await check('exact previous capability definition/owner/ACL restored; repeated rollback safe',async()=>{await db.exec(restore);assert.deepEqual(await catalog(),before);await db.exec(restore);assert.deepEqual(await catalog(),before);});
   await check('rollback aborts on unrelated later change',async()=>{
     await db.exec("comment on function "+capSig+" is 'fixture';create or replace function public.nodo_beta_capacidades_v1(p_token text,p_pc_codigo text,p_build text default null,p_activate boolean default false) returns jsonb language sql as 'select ''{}''::jsonb';");
     const drift=await catalog();await assert.rejects(db.exec(restore),/RESTORE_DOMAIN_DRIFT/);await db.exec('rollback');assert.deepEqual(await catalog(),drift);
   });
   assert.ok(files.every((f,i)=>fs.readFileSync(path.join(ROOT,f),'utf8')===texts[i]),'SQL changed during rehearsal');
   fs.mkdirSync(path.dirname(path.resolve(restorePath)),{recursive:true});fs.writeFileSync(restorePath,restore,{flag:'wx'});
   report.restore_sha256=digest(restore);report.ok=true;
 }catch(e){report.ok=false;report.error={code:e.code||null,message:String(e.message).slice(0,400)};}
 finally{await db.close();}
 report.finished_at=new Date().toISOString();if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;return report;
}
if(require.main===module)verify().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verify};
