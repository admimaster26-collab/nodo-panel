'use strict';
// Ensayo REAL IPC -> HTTPS -> PostgREST -> SQL, sólo con fixture aislada BETA_DEMO_27.
// No inicia Electron ni certifica su representación visual. Nunca imprime respuestas de negocio.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {registerPanelIpc}=require('../main/panel-rpc');
const {loadBetaConfig}=require('../main/beta-config');
async function run(){
 const dir=process.argv[2];if(!dir||!path.isAbsolute(dir))throw Error('Falta directorio privado absoluto');
 const config=loadBetaConfig({env:{NODO_BETA_CONFIG:path.join(dir,'probe-config.json')}});
 assert.deepEqual(config.offices,['BETA_DEMO_27']);assert.equal(config.enabled,true);
 const seed=JSON.parse(fs.readFileSync(path.join(dir,'probe-seed.json'),'utf8'));
 assert.equal(seed.pc_codigo,'BETA_DEMO_27');assert.ok(seed.chat_id.startsWith('beta-probe-'));
 const handlers=new Map();registerPanelIpc({ipcMain:{handle:(k,v)=>handlers.set(k,v)},betaConfig:config,env:{}});
 const report={started_at:new Date().toISOString(),target:'PostgREST remoto',office:seed.pc_codigo,tests:[],limitations:['No inicia Electron ni prueba UI humana','Fixture aislada; no equivale a piloto con carga real']};
 async function check(name,fn){const start=performance.now();await fn();report.tests.push({name,ok:true,duration_ms:Math.round((performance.now()-start)*100)/100});}
 async function node(fn,args={}){const r=await handlers.get('panel:rpc')({},'nodo_beta_'+fn+'_v1',{...args,p_pc_codigo:seed.pc_codigo});assert.equal(r.error,null,r.error?.code);assert.equal(r.data.contract,'nodo.beta.v1');return r.data;}
 async function portal(){const r=await fetch(config.url+'/rest/v1/rpc/landing_beta_chat_leer_v1',{method:'POST',headers:{apikey:config.publicKey,Authorization:'Bearer '+config.publicKey,'Content-Type':'application/json'},body:JSON.stringify({p_chat_id:seed.sesion_id,p_chat_token:seed.portal_token})});assert.equal(r.status,200);return r.json();}
 const msg={p_chat_id:seed.chat_id};
 await check('contexto sin credenciales',async()=>{const c=await handlers.get('panel:get-context')({});assert.equal(JSON.stringify(c).includes(config.credentials.BETA_DEMO_27),false);});
 await check('oficina sin activacion mantiene Portal legacy',async()=>{assert.equal((await node('capacidades',{p_activate:false})).active,false);assert.equal((await portal()).available,false);});
 await check('lista y detalle autorizados sin marcar leido',async()=>{const list=await node('chat_lista');assert.equal(list.total,1);assert.equal(list.unread_total,2);const r=await node('chat_mensajes',msg);assert.equal(r.rows.length,2);assert.ok(r.rows.every(m=>!m.leido&&!m.visto_confirmado));});
 await check('negociacion habilita Portal por oficina/build',async()=>{assert.equal((await node('capacidades',{p_activate:true})).active,true);assert.equal((await portal()).available,true);});
 await check('ACK exacto e idempotente y visto Portal',async()=>{const ids=[String(seed.message_ids[0])];const a=await node('chat_leido',{...msg,p_message_ids:ids});assert.deepEqual(a.acknowledged_ids,ids);assert.equal(a.unread,1);assert.equal((await node('chat_leido',{...msg,p_message_ids:ids})).inserted,0);const r=await portal();assert.deepEqual(r.rows.filter(m=>m.visto_confirmado).map(m=>m.id),ids);});
 await check('envio concurrente repetido produce un mensaje',async()=>{const payload={...msg,p_mensaje:'Ensayo automatico aislado',p_imagen_url:null,p_emisor:'BETA_TEST',p_request_id:crypto.randomUUID()};const responses=await Promise.all([node('chat_enviar',payload),node('chat_enviar',payload)]);assert.equal(responses[0].message.id,responses[1].message.id);});
 await check('dos envios simultaneos distintos no bloquean',async()=>{await Promise.all([1,2].map(i=>node('chat_enviar',{...msg,p_mensaje:'Ensayo concurrente '+i,p_imagen_url:null,p_emisor:'BETA_TEST',p_request_id:crypto.randomUUID()})));const r=await node('chat_mensajes',msg);assert.equal(r.rows.filter(m=>m.tipo_emisor==='OPERADOR').length,3);});
 await check('salud persiste y devuelve etapa con alcance',async()=>{const r=await node('salud',{p_muestras:[{integration:'CHAT',stage:'CONNECTED',state:'OK',count:1,errors:0,duration_ms:1,code:'REMOTE_PROBE',observed_at:new Date().toISOString()}]});assert.equal(r.accepted,1);assert.ok(r.rows.some(x=>x.code==='REMOTE_PROBE'&&x.state==='OK'));});
 await check('IPC rechaza otra oficina y token del renderer',async()=>{for(const args of [{p_pc_codigo:'P1'},{p_pc_codigo:seed.pc_codigo,p_token:'fake'}]){const r=await handlers.get('panel:rpc')({},'nodo_beta_chat_lista_v1',args);assert.ok(r.error);}});
 report.ok=true;report.finished_at=new Date().toISOString();
 fs.writeFileSync(path.join(dir,'remote-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
run().catch(error=>{console.error('Ensayo remoto fallido:',String(error.message).replace(/[a-f0-9]{64}/g,'[redacted]').slice(0,300));process.exitCode=1;});
