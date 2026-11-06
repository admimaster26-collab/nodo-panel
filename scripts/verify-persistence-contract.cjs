'use strict';
// Real SQL + renderer client in an isolated database. No network or production rows.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {resolvePGlite,fixture}=require('./verify-beta-server.cjs');
const {extension}=require('./verify-domain-server.cjs');
const client=require('../renderer/domain/persistencia-sync.js');
const ROOT=path.resolve(__dirname,'..'),TOKEN='ab'.repeat(32);
const files=['servidor/beta-chat-v1.sql','servidor/dominios/perfil-v1.sql','servidor/dominios/persistencia-local-v1.sql','servidor/dominios/capacidades-v1.sql','renderer/domain/persistencia-sync.js'];
async function verify(){
 const sources=files.map(f=>fs.readFileSync(path.join(ROOT,f),'utf8'));
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const db=new (resolvePGlite())(),report={tests:[],source_hashes:Object.fromEntries(files.map((f,i)=>[f,hash(sources[i])])),limitations:['Synthetic SQL/client integration; no network or real application proof.']};
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 async function rpc(fn,args){await db.exec('begin;set local role anon');try{const r=(await q('select public.'+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const sync=(items,inst='install-a')=>rpc('nodo_beta_persistencia_sync_v1',[TOKEN,'P1',inst,'test',{movimientos:items}]);
 const mov=(id,state='OK',base='0',mutation=id)=>({movimiento_key:id,usuario:'cas_demo',tipo:'CARGA',monto:10,estado:state,fecha:'2026-01-01T00:00:00Z',_sync:{base_revision:base,mutation_id:mutation}});
 const read=(type='TODO',cursor=null,limit=2,user='cas_demo')=>rpc('nodo_beta_persistencia_leer_v1',[TOKEN,'P1',user,null,type,limit,cursor]);
 async function check(name,fn){try{await fn();report.tests.push({name,ok:true});}catch(e){report.tests.push({name,ok:false,error:e.message,code:e.code});}}
 try{
  await db.exec(fixture);await db.exec(extension);for(const s of sources.slice(0,4))await db.exec(s);
  await q("insert into acceso.beta_clientes(token_hash,pc_codigo,enabled) values(encode(sha256(convert_to($1,'UTF8')),'hex'),'P1',true)",[TOKEN]);
  await check('stale other installation cannot overwrite; explicit newer revision may correct same event date',async()=>{
   assert.equal((await sync([mov('cas-m1')])).receipts[0].revision,'1');
   const stale=await sync([mov('cas-m1','PENDIENTE','0','old-copy')],'install-b');assert.equal(stale.conflicts[0].code,'REVISION_CONFLICT');assert.equal(stale.accepted_total,0);
   assert.equal((await read('MOVIMIENTOS')).movimientos[0].estado,'OK');
   assert.equal((await sync([mov('cas-m1','CORREGIDA','1','edit-2')])).receipts[0].revision,'2');
   assert.equal((await read('MOVIMIENTOS')).movimientos[0].estado,'CORREGIDA');
  });
  await check('lost response replay does not rewrite newer state; mutation reuse rejected',async()=>{
   const replay=await sync([mov('cas-m1')]);assert.equal(replay.receipts[0].revision,'1');assert.equal(replay.receipts[0].replay,true);
   assert.equal((await read('MOVIMIENTOS')).movimientos[0].revision,'2');
   assert.equal((await sync([mov('cas-m1','OTHER')])).conflicts[0].code,'MUTATION_REUSED');
  });
  await check('invalid batch rolls back receipts and rows atomically',async()=>{
   const before=(await q('select count(*)::int n from operaciones.persistencia_recibos'))[0].n;
   await assert.rejects(sync([mov('rolled-back'),{movimiento_key:'invalid'}]));
   assert.equal((await q('select count(*)::int n from operaciones.persistencia_recibos'))[0].n,before);
   assert.equal((await q("select count(*)::int n from operaciones.movimientos_locales where movimiento_key='rolled-back'"))[0].n,0);
  });
  await check('pagination beyond limit, composite keys and scope-bound cursor',async()=>{
   const items=Array.from({length:7},(_,i)=>mov('page-'+i));await sync(items);
   const ids=[];let cursor=null;
   do{const r=await read('MOVIMIENTOS',cursor);assert.ok(r.movimientos.length<=2);ids.push(...r.movimientos.map(m=>m.movimiento_key));cursor=r.next_cursor;if(!r.has_more)break;assert.ok(ids.length<30);}while(true);
   assert.equal(new Set(ids).size,8);assert.equal(ids.length,8);
   const first=await read('MOVIMIENTOS');await assert.rejects(read('MOVIMIENTOS',first.next_cursor,2,'other'),/BETA_INVALID_PERSISTENCE_CURSOR/);
  });
  await check('four families page independently; queues are observations',async()=>{
   const lot={jugadores:[],cotejos:[],colas:[]};
   for(let i=0;i<5;i++){
    lot.jugadores.push({source_id:'j'+i,campo:'telefono',usuario:'four_demo',atributo:'telefono',valor:'1000'+i,fuente:'fixture',_sync:{base_revision:'0',mutation_id:'j'+i}});
    lot.cotejos.push({cotejo_key:'c'+i,tipo_cotejo:'ALTA_TELEFONO',usuario:'four_demo',telefono:'1000'+i,_sync:{base_revision:'0',mutation_id:'c'+i}});
    lot.colas.push({cola_tipo:'CHUNIOR_PENDIENTE',item_id:'q'+i,usuario:'four_demo',estado:'PENDIENTE',_sync:{base_revision:'0',mutation_id:'q'+i}});
   }
   const written=await rpc('nodo_beta_persistencia_sync_v1',[TOKEN,'P1','install-four','test',lot]);assert.equal(written.accepted_total,15);
   let cursor=null;const counts={jugadores:0,cotejos:0,colas_observadas:0};
   for(let i=0;i<4;i++){const r=await read('TODO',cursor,2,'four_demo');for(const f of Object.keys(counts))counts[f]+=r[f].length;assert.ok(r.colas_observadas.every(x=>x.re_ejecutar===false));if(!r.has_more)break;cursor=r.next_cursor;}
   assert.deepEqual(counts,{jugadores:5,cotejos:5,colas_observadas:5});
  });
  const values=new Map([['nodo_movimientos_v1',JSON.stringify({'900':{id:'900',pc_codigo:'P1',usuario:'client_demo',tipo:'CARGA',monto:10,estado:'OK',fecha:'2026-01-01T00:00:00Z'}})]]);
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  let drop=false,now=100000,serial=0,caps=true;const calls=[];
  const api={getContext:async()=>({beta:{enabled:true,offices:['P1'],build:'test'}}),rpc:async(fn,a)=>{
   calls.push(fn);
   if(fn==='nodo_beta_capacidades_v1'){const r=await rpc(fn,[TOKEN,a.p_pc_codigo,'test',false]);if(!caps)r.capabilities=[];return {data:r};}
   if(fn==='nodo_beta_persistencia_sync_v1'){const r=await rpc(fn,[TOKEN,a.p_pc_codigo,a.p_instalacion,a.p_version,a.p_lote]);if(drop){drop=false;throw Error('lost response');}return {data:r};}
   if(fn==='nodo_beta_persistencia_leer_v1')return {data:await rpc(fn,[TOKEN,a.p_pc_codigo,a.p_usuario,a.p_referencia_id,a.p_tipo,a.p_limit,a.p_cursor])};
   throw Error('unexpected RPC');
  }};
  const make=()=>client.create({storage,instalacion:'client-fixture',getOffice:()=>'P1',panelAPI:api,now:()=>now,mutationId:()=> 'client-'+ ++serial});let c=make();
  await check('real capability envelope without enabled activates client; lost ACK survives recreation',async()=>{
   drop=true;assert.equal((await c.sync()).synced,false);c=make();const r=await c.sync();assert.equal(r.synced,true);assert.equal(r.acceptedTotal,1);assert.equal((await c.sync()).empty,true);
  });
  await check('later local edit advances revision, concurrent sync shares one flight',async()=>{
   const m=JSON.parse(values.get('nodo_movimientos_v1'));m['900'].estado='CORREGIDA';values.set('nodo_movimientos_v1',JSON.stringify(m));
   const a=c.sync(),b=c.sync();assert.equal(a,b);assert.equal((await a).acceptedTotal,1);
   const row=(await read('MOVIMIENTOS',null,2,'client_demo')).movimientos[0];assert.equal(row.estado,'CORREGIDA');assert.equal(row.revision,'2');
  });
  await check('capability revocation after TTL prevents new sync',async()=>{now+=60001;caps=false;const before=calls.filter(x=>x==='nodo_beta_persistencia_sync_v1').length;assert.equal((await c.sync()).mode,'legacy');assert.equal(calls.filter(x=>x==='nodo_beta_persistencia_sync_v1').length,before);caps=true;now+=60001;});
  await check('hydrate exposes valid next page; observed queues never executed',async()=>{
   const first=await c.hydrate({usuario:'four_demo',tipo:'COLAS',limit:2});assert.equal(first.hydrated,true);assert.equal(first.hasMore,true);
   const second=await c.hydrate({usuario:'four_demo',tipo:'COLAS',limit:2,cursor:first.nextCursor});assert.equal(second.hydrated,true);assert.notEqual(second.colasObservadas[0].item_id,first.colasObservadas[0].item_id);assert.ok(second.colasObservadas.every(x=>x.re_ejecutar===false));
  });
  await check('edit after uncertain send is preserved after replay; no blind rebase of another PC',async()=>{
   const edit=state=>{const m=JSON.parse(values.get('nodo_movimientos_v1'));m['900'].estado=state;values.set('nodo_movimientos_v1',JSON.stringify(m));};
   edit('ANTES_DEL_CORTE');drop=true;assert.equal((await c.sync()).synced,false);
   edit('EDICION_POSTERIOR');c=make();assert.equal((await c.sync()).synced,true);
   assert.equal((await read('MOVIMIENTOS',null,2,'client_demo')).movimientos[0].estado,'ANTES_DEL_CORTE');
   assert.equal((await c.sync()).synced,true);assert.equal((await read('MOVIMIENTOS',null,2,'client_demo')).movimientos[0].estado,'EDICION_POSTERIOR');
   const foreign=new Map([['nodo_movimientos_v1',values.get('nodo_movimientos_v1')]]);
   const other=client.create({storage:{getItem:k=>foreign.get(k)||null,setItem:(k,v)=>foreign.set(k,v)},instalacion:'other-pc',getOffice:()=>'P1',panelAPI:api});
   const conflict=await other.sync();assert.equal(conflict.synced,false);assert.equal(conflict.conflicts[0].code,'REVISION_CONFLICT');
   const before=calls.length;assert.equal((await other.sync()).synced,false);assert.equal(calls.length,before);
  });
  await check('all queue observations beyond first 25 can drain through bounded batches',async()=>{
   values.set('nodo_chu_pendientes',JSON.stringify(Array.from({length:61},(_,i)=>({id:'queue-client-'+i,usuario:'queue_demo',estado:'PENDIENTE'}))));
   for(let i=0;i<3;i++){const r=await c.sync();assert.equal(r.synced,true);assert.equal(r.acceptedTotal,i===2?11:25);}
   assert.equal((await c.sync()).empty,true);
   let n=0,cursor=null;do{const r=await read('COLAS',cursor,20,'queue_demo');n+=r.colas_observadas.length;cursor=r.next_cursor;if(!r.has_more)break;}while(true);assert.equal(n,61);
  });
 }catch(e){report.setup_error={message:e.message,code:e.code};}finally{await db.close();}
 report.changed=files.some((f,i)=>hash(fs.readFileSync(path.join(ROOT,f),'utf8'))!==hash(sources[i]));report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;report.ok=!report.setup_error&&!report.failed&&!report.changed;
 const i=process.argv.indexOf('--report');if(i>=0)fs.writeFileSync(process.argv[i+1],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;return report;
}
if(require.main===module)verify().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verify};
