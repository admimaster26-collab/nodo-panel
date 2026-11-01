'use strict';
// Test-only loopback adapter: exercises the production client and IPC bridge against real SQL.
// It is NOT PostgREST, Electron UI, a deployment or a credential provisioner.
const http=require('node:http');
const assert=require('node:assert/strict');
const {registerPanelIpc}=require('../main/panel-rpc');
const {loadBetaConfig}=require('../main/beta-config');
const {create:createChat}=require('../renderer/chat/beta-chat');
const {create:createHealth}=require('../renderer/runtime/integration-health');
async function verifyTransport({rpc,query,token,build,portalToken}){
  const specs={
    nodo_beta_capacidades_v1:[['p_token'],['p_pc_codigo'],['p_build',null],['p_activate',false]],
    nodo_beta_chat_lista_v1:[['p_token'],['p_pc_codigo'],['p_usuario',null],['p_estado',null],['p_limit',50],['p_before_id',null]],
    nodo_beta_chat_mensajes_v1:[['p_token'],['p_pc_codigo'],['p_chat_id'],['p_limit',50],['p_before_id',null]],
    nodo_beta_chat_leido_v1:[['p_token'],['p_pc_codigo'],['p_chat_id'],['p_message_ids']],
    nodo_beta_chat_enviar_v1:[['p_token'],['p_pc_codigo'],['p_chat_id'],['p_mensaje'],['p_imagen_url',null],['p_emisor','panel'],['p_request_id']],
    nodo_beta_salud_v1:[['p_token'],['p_pc_codigo'],['p_muestras',null],['p_build',null]]
  };
  let requests=0;
  const publicKey='public-key-isolated-test';
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    try{
      const fn=req.url?.split('/rest/v1/rpc/')[1];
      assert.equal(req.method,'POST');assert.equal(req.headers.apikey,publicKey);
      assert.ok(Object.hasOwn(specs,fn));
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw new Error('BETA_TEST_BODY_LIMIT');}
      const body=JSON.parse(raw);requests++;
      const result=await rpc(fn,specs[fn].map(([key,fallback])=>body[key]===undefined?fallback:body[key]));
      res.end(JSON.stringify(result));
    }catch(error){res.statusCode=400;res.end(JSON.stringify({message:/^BETA_[A-Z0-9_]+$/.test(error.message)?error.message:'BETA_TEST_FAILURE'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const config=loadBetaConfig({env:{NODO_BETA_CONFIG:'memory-only'},readFile:()=>Buffer.from(JSON.stringify({
      url:'http://127.0.0.1:'+server.address().port,public_key:publicKey,credentials:{P1:token},build}))});
    assert.equal(config.enabled,true);
    const handlers=new Map();
    registerPanelIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},env:{},betaConfig:config});
    const invoke=(name,...args)=>handlers.get(name)({},...args);
    const root={pcOperativa:'P1',innerHeight:600,innerWidth:800,
      panelAPI:{rpc:(fn,args)=>invoke('panel:rpc',fn,args),getContext:()=>invoke('panel:get-context')},
      setTimeout,clearTimeout,requestAnimationFrame:()=>{},
      addEventListener:()=>{},getComputedStyle:()=>({display:'block',visibility:'visible'}),
      document:{hidden:false,visibilityState:'visible',hasFocus:()=>true,addEventListener:()=>{},getElementById:()=>null,
        body:{classList:{contains:()=>true}}}};
    root.NodoSalud=createHealth(root);
    const chat=createChat(root);
    const ctx=await root.panelAPI.getContext();
    assert.equal(JSON.stringify(ctx).includes(token),false);
    const list=await chat.lista();assert.equal(list.total,3);assert.equal(list.unread_total,5);
    const page=await chat.mensajes('alpha');assert.equal(page.rows.some(m=>m.id==='109'),false);
    root.__nodoChatCurrentTicket={_beta:true,_betaPc:'P1',_chatId:'alpha'};
    const rect=()=>({top:0,bottom:100,left:0,right:100,width:100,height:100});
    const body={dataset:{},isConnected:true,addEventListener:()=>{},getBoundingClientRect:rect,
      querySelectorAll:()=>['100','104'].map(id=>({dataset:{betaMessageId:id,betaRole:'USUARIO'},getBoundingClientRect:rect}))};
    chat.observeRendered(root.__nodoChatCurrentTicket,[body],page.rows);
    await chat.flushVisible();assert.equal(chat.count('alpha'),3);assert.equal(chat.total(),4);
    const seen=await rpc('landing_chat_vistos_v1',[10,portalToken,['100','102','104']]);
    assert.deepEqual(seen.seen.map(m=>m.message_id),['100','104']);
    const request={mensaje:'respuesta demo',operador:'OPERADOR_DEMO',request_id:'1c100a3b-1c02-4027-b648-05e15b30fa8a'};
    const first=await chat.enviar('alpha',request),second=await chat.enviar('alpha',request);
    assert.equal(first.id,second.id);
    await root.NodoSalud.flush();
    assert.equal(root.NodoSalud.snapshot().transport,'OK');
    const persisted=await query("select stage,state from observabilidad.salud_actual where integration='CHAT' order by stage");
    assert.deepEqual(persisted.map(r=>r.stage),['CONNECTED','DATA','EFFECT','RENDER']);
    assert.ok(persisted.every(r=>r.state==='OK'));
    assert.ok(requests>=8);
    return {requests,stages:persisted.map(r=>r.stage)};
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}
module.exports={verifyTransport};
