const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../renderer/chat/beta-chat.js');
const CONTRACT='nodo.beta.v1';
function harness(overrides={}){
  const calls=[],timers=[],frames=[],events={};
  const root={pcOperativa:'DEMO',innerHeight:600,innerWidth:800,
    crypto:{randomUUID:()=> '01234567-89ab-4def-8123-456789abcdef'},
    requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    addEventListener:(key,fn)=>{events[key]=fn;},
    getComputedStyle:()=>({display:'block',visibility:'visible'}),
    document:{hidden:false,visibilityState:'visible',hasFocus:()=>true,
      body:{classList:{contains:()=>true}},addEventListener:(key,fn)=>{events[key]=fn;},getElementById:()=>null},
    panelAPI:{getContext:async()=>({beta:{enabled:true,offices:['DEMO'],build:'2.1.5-beta-test'}}),
      rpc:async(fn,args)=>{
        calls.push({fn,args});
        if(overrides[fn])return overrides[fn](args);
        if(fn==='nodo_beta_capacidades_v1')return {data:{ok:true,contract:CONTRACT,scope:{pc_codigo:args.p_pc_codigo},capabilities:['chat.list.v1','chat.messages.v1','chat.read.v1'],active:args.p_activate,build:args.p_build}};
        if(fn==='nodo_beta_chat_lista_v1')return {data:{ok:true,contract:CONTRACT,rows:[{chat_id:'A',sin_leer:8}],total:200,unread_total:25,has_more:true,next_before_id:'10'}};
        if(fn==='nodo_beta_chat_mensajes_v1')return {data:{ok:true,contract:CONTRACT,chat_id:args.p_chat_id,rows:[{id:'9007199254740993',tipo_emisor:'USUARIO',mensaje:'hola'}],counts:{unread:8},has_more:true,next_before_id:'9007199254740993'}};
        if(fn==='nodo_beta_chat_leido_v1')return {data:{ok:true,contract:CONTRACT,chat_id:args.p_chat_id,acknowledged_ids:args.p_message_ids,unread:7}};
        if(fn==='nodo_beta_chat_enviar_v1')return {data:{ok:true,contract:CONTRACT,message:{id:'9007199254740994',mensaje:args.p_mensaje}}};
        throw new Error('Unexpected RPC '+fn);
      }}
  };
  const api=create(root);
  function view(ids=['9007199254740993'],chatId='A'){
    const ticket={_beta:true,_chatId:chatId,_betaPc:root.pcOperativa,usuario:'demo'};
    root.__nodoChatCurrentTicket=ticket;
    const nodes=ids.map((id,i)=>({dataset:{betaMessageId:id,betaRole:'USUARIO'},
      getBoundingClientRect:()=>({top:i*30,bottom:i*30+20,left:0,right:200,width:200,height:20})}));
    const body={dataset:{},isConnected:true,addEventListener:()=>{},
      getBoundingClientRect:()=>({top:0,bottom:300,left:0,right:400,width:400,height:300}),querySelectorAll:()=>nodes};
    api.observeRendered(ticket,[body],ids.map(id=>({id,origen:'USUARIO'})));
    return {ticket,body,nodes};
  }
  return {root,api,calls,timers,frames,events,view};
}
test('beta deshabilitada conserva legacy y no consulta RPC beta',async()=>{
  const h=harness();h.root.panelAPI.getContext=async()=>({beta:{enabled:false,offices:['DEMO']}});
  assert.equal(await h.api.ready(),false);assert.equal(h.calls.length,0);assert.equal(h.api.status().stage,'LEGACY');
});
test('oferta no activa Portal; se confirma contrato después de recibir datos',async()=>{
  const h=harness();assert.equal(await h.api.ready(),true);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_activate,false);
  const page=await h.api.lista();
  assert.equal(page.total,200);assert.equal(h.api.total(),25);
  assert.deepEqual(h.calls.map(c=>c.fn),['nodo_beta_capacidades_v1','nodo_beta_chat_lista_v1','nodo_beta_capacidades_v1']);
  assert.equal(h.calls[2].args.p_activate,true);
  assert.ok(h.calls.every(c=>!Object.hasOwn(c.args,'p_token')),'el token permanece en main');
});
test('un contrato sin read-v1 no se activa',async()=>{
  const h=harness({nodo_beta_capacidades_v1:async()=>({data:{ok:true,contract:CONTRACT,scope:{pc_codigo:'DEMO'},capabilities:['chat.list.v1']}})});
  await assert.rejects(h.api.ready(),/BETA_CONTRACT_MISMATCH/);assert.equal(h.api.status().code,'BETA_CONTRACT_MISMATCH');
});
test('ACK sólo confirma ID bigint visible; excluye fuera de viewport, operador y documento oculto',async()=>{
  const h=harness();await h.api.lista();
  const v=h.view(['9007199254740993','9007199254740994','9007199254740995']);
  v.nodes[1].getBoundingClientRect=()=>({top:700,bottom:730,left:0,right:200,width:200,height:30});
  v.nodes[2].dataset.betaRole='OPERADOR';
  h.root.document.hidden=true;await h.api.flushVisible();
  assert.equal(h.calls.filter(c=>c.fn.includes('leido')).length,0);
  h.root.document.hidden=false;await h.api.flushVisible();
  assert.deepEqual(h.calls.find(c=>c.fn.includes('leido')).args.p_message_ids,['9007199254740993']);
  assert.equal(h.api.count('A'),7);assert.equal(h.api.total(),24,'ajusta respuesta sin descargar otra lista');
  await h.api.flushVisible();assert.equal(h.calls.filter(c=>c.fn.includes('leido')).length,1);
});
test('cambiar conversación antes del frame evita ACK de la anterior',async()=>{
  const h=harness();await h.api.lista();h.view();h.root.__nodoChatCurrentTicket={_beta:true,_betaPc:'DEMO',_chatId:'B'};
  await h.api.flushVisible();assert.equal(h.calls.filter(c=>c.fn.includes('leido')).length,0);
});
test('cambiar oficina invalida página y no confirma IDs con la identidad nueva',async()=>{
  const h=harness();await h.api.lista();h.view();h.root.pcOperativa='OTRA';
  await h.api.flushVisible();assert.equal(h.api.total(),undefined);assert.equal(h.api.active(),false);
  assert.equal(h.calls.filter(c=>c.fn.includes('leido')).length,0);
});
test('error de ACK es visible, conserva contador y tiene máximo tres intentos automáticos',async()=>{
  const h=harness({nodo_beta_chat_leido_v1:async()=>({error:{code:'OFFLINE'}})});
  await h.api.lista();h.view();
  for(let i=0;i<5;i++)await h.api.flushVisible();
  assert.equal(h.calls.filter(c=>c.fn.includes('leido')).length,3);assert.equal(h.api.total(),25);
  assert.equal(h.api.status().code,'OFFLINE');assert.equal(h.api.status().stage,'ERROR');
  assert.ok(h.calls.every(c=>c.fn!=='panel_chat_ack_leido'));
});
test('ACK no confirmado no convierte error lógico en leído',async()=>{
  const h=harness({nodo_beta_chat_leido_v1:async()=>({data:{ok:true,contract:CONTRACT,acknowledged_ids:[],unread:0}})});
  const health=[];h.root.NodoSalud={record:(...sample)=>health.push(sample)};
  await h.api.lista();h.view();await h.api.flushVisible();
  assert.equal(h.api.total(),25);assert.equal(h.api.status().code,'BETA_ACK_INCOMPLETE');
  assert.equal(health.some(([,stage,state])=>stage==='EFFECT'&&state==='OK'),false,'HTTP OK no acredita el efecto');
  assert.ok(health.some(([,stage,state])=>stage==='EFFECT'&&state==='ERROR'));
});
test('fallo de lista activa no dispara RPC legacy ni borra total conocido',async()=>{
  const h=harness();await h.api.lista();
  h.root.panelAPI.rpc=async(fn,args)=>{h.calls.push({fn,args});return {error:{code:'OFFLINE'}};};
  await assert.rejects(h.api.lista(),/OFFLINE/);assert.equal(h.api.total(),25);assert.equal(h.api.active(),true);
  assert.ok(h.calls.every(c=>c.fn.startsWith('nodo_beta_')));
});
test('dos lectores simultáneos del mismo chat comparten una sola petición',async()=>{
  const h=harness();await h.api.lista();await Promise.all([h.api.mensajes('A'),h.api.mensajes('A')]);
  assert.equal(h.calls.filter(c=>c.fn==='nodo_beta_chat_mensajes_v1').length,1);
});
test('buscar usuario manda filtro exacto sin recalcular total global con la página filtrada',async()=>{
  const h=harness();await h.api.lista();await h.api.lista({usuario:'ana',beforeId:'10'});
  const args=h.calls.filter(c=>c.fn==='nodo_beta_chat_lista_v1').at(-1).args;
  assert.equal(args.p_usuario,'ana');assert.equal(args.p_before_id,'10');assert.equal(h.api.total(),25);
});
test('reintento explícito del envío reutiliza request_id y no llama otro writer',async()=>{
  const h=harness();await h.api.lista();const message={mensaje:'hola',operador:'demo'};
  await h.api.enviar('A',message);await h.api.enviar('A',message);
  const sends=h.calls.filter(c=>c.fn==='nodo_beta_chat_enviar_v1');
  assert.equal(sends.length,2);assert.equal(sends[0].args.p_request_id,sends[1].args.p_request_id);
  assert.ok(h.calls.every(c=>c.fn.startsWith('nodo_beta_')));
});

test('fallo de negociación y su enfriamiento no habilitan un getter legacy',async()=>{
  const h=harness({nodo_beta_capacidades_v1:async()=>({error:{code:'OFFLINE'}})});
  await assert.rejects(h.api.ready(),/OFFLINE/);
  await assert.rejects(h.api.ready(),/OFFLINE/);
  assert.equal(h.calls.length,1);
  assert.equal(h.api.active(),false);
});

test('refrescar datos no oculta ACK fallido; la confirmación exacta sí lo resuelve',async()=>{
  let fail=true;
  const h=harness({nodo_beta_chat_leido_v1:async args=>fail?{error:{code:'OFFLINE'}}:
    {data:{ok:true,contract:CONTRACT,chat_id:args.p_chat_id,acknowledged_ids:args.p_message_ids,unread:7}}});
  await h.api.lista();h.view();await h.api.flushVisible();
  await h.api.lista();await h.api.mensajes('A');
  assert.equal(h.api.status().code,'OFFLINE');
  fail=false;await h.api.flushVisible();
  assert.equal(h.api.status().stage,'READY');assert.equal(h.api.status().code,'');
});

function canalHarness(beta){
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const calls=[];
  const root={console,Date,pcOperativa:'DEMO',NodoBetaChat:beta,
    panelAPI:{rpc:async fn=>{calls.push(fn);return {data:[]};}},
    NodoChatMessage:require('../renderer/chat/message-model.js')};
  root.window=root;vm.createContext(root);
  new vm.Script(fs.readFileSync(path.join(__dirname,'../renderer/chat/chat-canal-nuevo.js'),'utf8')).runInContext(root);
  return {root,canal:root._chatCanalNuevo,calls};
}

test('coordinador conserva páginas anteriores y proyección legacy durante polling',async()=>{
  const beta={ready:async()=>true,active:()=>true,count:()=>0,mensajes:async(id,options)=>({
    rows:options.beforeId?[{id:'1',tipo_emisor:'USUARIO'}]:[{id:'3',tipo_emisor:'USUARIO'}],
    legacy_thread:options.beforeId?[]:[{portal_key:'legacy:7:1',mensaje:'histórico'}],
    has_more:!options.beforeId,next_before_id:options.beforeId?null:'3'})};
  const h=canalHarness(beta);
  await h.canal.mensajesDe('A');await h.canal.mensajesDe('A',{beforeId:'3'});
  assert.equal(h.canal.paginaMensajes('A').legacy_thread.length,1);
  await h.canal.mensajesDe('A');
  assert.deepEqual(Array.from(h.canal.paginaMensajes('A').rows,m=>m.id),['1','3']);
  assert.equal(h.canal.paginaMensajes('A').has_more,false);
});

test('coordinador conserva conversaciones paginadas al actualizar la primera página',async()=>{
  const beta={ready:async()=>true,active:()=>true,count:()=>0,lista:async options=>({
    rows:[{chat_id:options.beforeId?'B':'A',sesion_id:options.beforeId?'1':'2',usuario:'demo',sin_leer:0}],
    has_more:!options.beforeId,next_before_id:options.beforeId?null:'2'})};
  const h=canalHarness(beta);
  await h.canal.cargar(true);await h.canal.mas();await h.canal.cargar(true);
  assert.deepEqual(Array.from(h.canal.crudas(),m=>m.chat_id),['A','B']);
  assert.equal(h.canal.pagina().has_more,false);
});

test('búsqueda nueva no adopta una respuesta tardía del filtro anterior',async()=>{
  let release;
  const beta={ready:async()=>true,active:()=>true,count:()=>0,lista:options=>options.usuario==='ana'?
    new Promise(resolve=>{release=()=>resolve({rows:[{chat_id:'A',usuario:'ana'}],has_more:false});}):
    Promise.resolve({rows:[{chat_id:'B',usuario:'bea'}],has_more:false})};
  const h=canalHarness(beta),first=h.canal.buscarUsuario('ana');
  while(!release)await Promise.resolve();
  await h.canal.buscarUsuario('bea');release();await first;
  assert.deepEqual(Array.from(h.canal.crudas(),m=>m.usuario),['bea']);
});

test('coordinador no cae a RPC legacy cuando falla contrato beta',async()=>{
  const h=canalHarness({ready:async()=>{throw new Error('OFFLINE');}});
  await assert.rejects(h.canal.cargar(true),/OFFLINE/);
  await assert.rejects(h.canal.mensajesDe('A'),/OFFLINE/);
  assert.deepEqual(h.calls,[]);
});

test('coordinador Portal conserva datos confirmados ante fallo de negociación sin fallback',async()=>{
  const {create}=require('../renderer/portal/chat.js'),calls=[];
  const deps={getCanal:async()=>'DEMO',window:{chatActualId:'A',NodoBetaChat:{ready:async()=>{throw new Error('OFFLINE');}}},
    V154P:{chats:[{ID_CHAT:'A'}],chatMensajes:[{id:'9'}]},document:{getElementById:()=>null},normArr:value=>value||[],
    rpc:async fn=>{calls.push(fn);return {data:[]};}};
  const portal=create(deps);
  assert.equal((await portal.cargarChatsPortal(true)).error.message,'OFFLINE');
  assert.equal((await portal.cargarChatPortalActual(true)).error.message,'OFFLINE');
  assert.deepEqual(calls,[]);assert.equal(deps.V154P.chats.length,1);assert.equal(deps.V154P.chatMensajes.length,1);
});

test('historial legacy sin ID degrada cobertura sin sumar pendientes ni inventar vistos',async()=>{
  let legacy=[{origen:'USUARIO',mensaje:'anterior',portal_key:'legacy:1:1',visto_confirmado:false}];
  const health=[];
  const h=harness({nodo_beta_chat_mensajes_v1:async args=>({data:{ok:true,contract:CONTRACT,chat_id:args.p_chat_id,
    rows:[{id:'9',tipo_emisor:'USUARIO'}],counts:{unread:8},legacy_thread:args.p_before_id?[]:legacy}})});
  h.root.NodoSalud={record:(...sample)=>health.push(sample)};
  await h.api.lista();await h.api.mensajes('A');
  assert.equal(h.api.total(),25);assert.equal(h.api.status().stage,'DEGRADED');
  assert.deepEqual(h.api.legacyDiagnostic('A'),{code:'LEGACY_MESSAGE_IDENTITY_UNKNOWN',user_messages:1,unread_scope:'canonical'});
  await h.api.lista();await h.api.mensajes('A',{beforeId:'9'});
  assert.equal(h.api.legacyDiagnostic('A').user_messages,1,'otra página no borra diagnóstico de primera página');
  assert.equal(health.filter(([,stage])=>stage==='DATA').at(-1)[2],'DEGRADED');
  assert.equal(h.calls.some(c=>c.fn.includes('leido')),false);
  legacy=[];await h.api.mensajes('A');
  assert.equal(h.api.legacyDiagnostic('A'),null);assert.equal(h.api.status().stage,'READY');
});

test('ACK de otra conversación no oculta un error pendiente',async()=>{
  const health=[];
  const h=harness({nodo_beta_chat_leido_v1:async args=>args.p_chat_id==='A'?{error:{code:'OFFLINE'}}:
    {data:{ok:true,contract:CONTRACT,chat_id:args.p_chat_id,acknowledged_ids:args.p_message_ids,unread:0}}});
  h.root.NodoSalud={record:(...sample)=>health.push(sample)};
  await h.api.lista();h.view();await h.api.flushVisible();
  h.view(['12'],'B');await h.api.flushVisible();
  assert.equal(h.api.status().code,'OFFLINE');assert.deepEqual(h.api.status().pending_ack_chats,['A']);
  assert.equal(health.filter(([,stage])=>stage==='EFFECT').at(-1)[2],'DEGRADED');
});

test('ACK en vuelo de oficina anterior no bloquea ni contamina la oficina nueva',async()=>{
  const pending=[];
  const h=harness({nodo_beta_chat_leido_v1:args=>new Promise(resolve=>pending.push({args,resolve}))});
  h.root.panelAPI.getContext=async()=>({beta:{enabled:true,offices:['DEMO','OTRA'],build:'2.1.5-beta-test'}});
  await h.api.lista();h.view();const old=h.api.flushVisible();
  assert.equal(pending.length,1);
  h.root.pcOperativa='OTRA';await h.api.lista();h.view(['15']);const fresh=h.api.flushVisible();
  assert.equal(pending.length,2,'la oficina actual no espera el ACK viejo');
  pending[0].resolve({error:{code:'OFFLINE'}});await old;
  await h.api.flushVisible();assert.equal(pending.length,2,'el finally viejo no libera el vuelo actual');
  assert.equal(h.api.status().code,'');
  pending[1].resolve({data:{ok:true,contract:CONTRACT,chat_id:'A',acknowledged_ids:['15'],unread:3}});await fresh;
  assert.equal(h.api.count('A'),3);assert.equal(h.api.status().code,'');
  assert.deepEqual(h.api.status().pending_ack_chats,[]);
});

test('al terminar un ACK se programa la conversación abierta durante su vuelo',async()=>{
  let finish;
  const h=harness({nodo_beta_chat_leido_v1:args=>new Promise(resolve=>{finish=()=>resolve({data:{ok:true,contract:CONTRACT,
    chat_id:args.p_chat_id,acknowledged_ids:args.p_message_ids,unread:0}});})});
  await h.api.lista();h.view();const pending=h.api.flushVisible();
  h.view(['12'],'B');await h.api.flushVisible();
  const frames=h.frames.length;finish();await pending;
  assert.equal(h.frames.length,frames+1,'hay un nuevo frame para ACK de B sin otro poll');
});

test('ACK con otro chat o IDs extra no acredita lectura',async()=>{
  const h=harness({nodo_beta_chat_leido_v1:async args=>({data:{ok:true,contract:CONTRACT,chat_id:'OTHER',
    acknowledged_ids:[...args.p_message_ids,'99'],unread:0}})});
  await h.api.lista();h.view();await h.api.flushVisible();
  assert.equal(h.api.total(),25);assert.equal(h.api.status().code,'BETA_ACK_INCOMPLETE');
});

test('lista y página iniciadas antes del ACK no restauran un contador ya confirmado',async()=>{
  let first=true,finishList,finishMessages;
  const list={data:{ok:true,contract:CONTRACT,rows:[{chat_id:'A',sin_leer:8}],total:200,unread_total:25}};
  const h=harness({
    nodo_beta_chat_lista_v1:()=>{if(first){first=false;return list;}return new Promise(resolve=>{finishList=()=>resolve(list);});},
    nodo_beta_chat_mensajes_v1:()=>new Promise(resolve=>{finishMessages=()=>resolve({data:{ok:true,contract:CONTRACT,
      chat_id:'A',rows:[{id:'9007199254740993',tipo_emisor:'USUARIO'}],counts:{unread:8}}});})
  });
  await h.api.lista();h.view();
  const staleList=h.api.lista(),stalePage=h.api.mensajes('A');
  while(!finishList||!finishMessages)await Promise.resolve();
  await h.api.flushVisible();assert.equal(h.api.total(),24);
  finishList();finishMessages();await Promise.all([staleList,stalePage]);
  assert.equal(h.api.count('A'),7);assert.equal(h.api.total(),24);
  const current=h.api.lista();while(!finishList)await Promise.resolve();
  await Promise.resolve();finishList();await current;
  assert.equal(h.api.count('A'),8,'un refresco posterior al ACK sí puede incorporar nuevos mensajes');
  assert.equal(h.api.total(),25);
});
test('el modelo de mensajes saca del hilo sólo las copias de lo que ya llegó por el canal nuevo',()=>{
  const {sinCopias}=require('../renderer/chat/message-model.js');
  const filas=[{id:'1',tipo_emisor:'USUARIO',mensaje:'hola',created_at:'2026-11-01T20:03:59.461861+00:00'},{id:'2',tipo_emisor:'OPERADOR',emisor:'NODO',mensaje:'recibido',created_at:'2026-11-01T20:03:59.484+00:00'}];
  const hilo=[{origen:'USUARIO',mensaje:'hola',fecha:'2026-11-01T20:03:59Z'},{origen:'OPERADOR',operador:'NODO',auto:true,mensaje:'recibido',fecha:'2026-11-01T20:03:59.484Z'},{origen:'OPERADOR',operador:'Ana',mensaje:'hola',fecha:'2026-11-01T20:03:59Z'},{origen:'OPERADOR',operador:'Ana',mensaje:'validado',fecha:'2026-11-01T20:04:10Z'},{origen:'USUARIO',mensaje:'hola',fecha:'2026-11-01T20:30:00Z'},{origen:'OPERADOR',mensaje:'sin fecha'}];
  assert.deepEqual(sinCopias(hilo,filas).map(m=>m.mensaje+'/'+(m.fecha||'-').slice(11,16)),['hola/20:03','validado/20:04','hola/20:30','sin fecha/']);
  assert.deepEqual(sinCopias(null,filas),[]);assert.equal(sinCopias(hilo,null).length,hilo.length);
});
// Todo chat del Portal tiene su solicitud puente. Si el puente decidía, el canal nuevo no escribía
// nunca: una sola vez en 24 horas el 1/11, y los avisos de validación y rechazo iban al hilo viejo.
test('con NODO en el canal nuevo escribe ese canal aunque el chat tenga solicitud puente',()=>{
  const {escritor}=require('../renderer/chat/message-model.js');
  assert.equal(escritor({_canalNuevo:true,_beta:true,_legacyOwner:true},true),'CANAL','el caso de todos los días');
  assert.equal(escritor({_canalNuevo:true,_beta:true},true),'CANAL');
  assert.equal(escritor({_canalNuevo:true,_beta:true,_legacyOwner:true,cerrado:true},true),'HILO','cerrado: el hilo igual le llega');
  assert.equal(escritor({_canalNuevo:true,_beta:true,_legacyOwner:true},false),'HILO','aceptar un chat no es un mensaje: guarda el estado');
  assert.equal(escritor({_canalNuevo:true,_legacyOwner:true},true),'HILO','oficina sin canal nuevo: como siempre');
  assert.equal(escritor({_legacyOwner:true},true),'HILO');assert.equal(escritor({},true),'HILO');assert.equal(escritor(null,true),'HILO');
});
// Juan, 1/11: «tampoco puedo cerrar consultas». Cerraba: quedaban chats de mayo del mismo jugador y
// al irse uno aparecía el siguiente con el mismo nombre.
test('cerrar una consulta incluye todos los chats abiertos de ese jugador, sin tocar los de otro',()=>{
  const {chatsDeLaConsulta}=require('../renderer/chat/message-model.js');
  const actual={usuario:'pruebaxx',_chatId:'A',solicitudId:'1'};
  const abiertos=[{usuario:'PruebaXX',_chatId:'B',solicitudId:'62'},{usuario:'pruebaxx',_chatId:'A'},{usuario:'otro',_chatId:'C'},{usuario:'pruebaxx'}];
  assert.deepEqual(chatsDeLaConsulta(actual,abiertos).map(t=>t._chatId),['A','B']);
  assert.deepEqual(chatsDeLaConsulta(actual,undefined).map(t=>t._chatId),['A']);
  assert.deepEqual(chatsDeLaConsulta({usuario:'x'},abiertos),[]);
});
test('el botón de cerrar sólo toca solicitudes puente, nunca una carga o un retiro',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','renderer/chat/chat-hilos.js'),'utf8');
  const f=src.slice(src.indexOf('window.cerrarConsultaWq2='),src.indexOf('window.reabrirConsultaWq2='));
  assert.ok(f.includes('soporteRows(true).some(s=>Number(idSol(s))===sid)) await actualizarSolicitudPortal(sid,"CERRADO"'));
  assert.ok(!/sidPuente/.test(f),'sin el camino que cerraba cualquier solicitud atada al chat');
});

// Juan, 1/11: NODO dijo «Mensaje enviado» y fue a parar a un chat del 17 de mayo que nadie lee.
test('sólo cuenta como vigente el último chat del jugador, abierto y con movimiento',()=>{
  const {chatVigente}=require('../renderer/chat/message-model.js');
  const ahora=Date.parse('2026-11-01T21:00:00Z'),s=(id,chat,estado,fecha,usuario='pruebaxx')=>({sesion_id:String(id),chat_id:chat,estado,updated_at:fecha,usuario});
  const viejos=[s(24,'mayo','ABIERTO','2026-05-24T13:58:00Z'),s(23,'mayo2','ABIERTO','2026-05-17T21:06:00Z')];
  assert.equal(chatVigente(viejos,'pruebaxx',ahora),'','un chat de mayo abierto no se lee: el caso real');
  assert.equal(chatVigente([...viejos,s(1242223,'hoy','CERRADO','2026-11-01T20:52:00Z')],'PruebaXX',ahora),'','el último está cerrado: no se cae a uno viejo');
  assert.equal(chatVigente([...viejos,s(1242231,'nuevo','ABIERTO','2026-11-01T20:52:00Z')],'pruebaxx',ahora),'nuevo');
  assert.equal(chatVigente([s(1242231,'nuevo','ABIERTO','2026-11-01T20:52:00Z','otro')],'pruebaxx',ahora),'','de otro jugador nunca');
  assert.equal(chatVigente(null,'pruebaxx',ahora),'');
});
test('la copia con unos segundos de diferencia se reconoce; el mismo texto más tarde es otro mensaje',()=>{
  const {sinCopias}=require('../renderer/chat/message-model.js');
  const filas=[{tipo_emisor:'OPERADOR',emisor:'Ana',mensaje:'ya te ayudo',created_at:'2026-11-01T20:03:59.461861+00:00'}];
  assert.equal(sinCopias([{origen:'OPERADOR',mensaje:'ya te ayudo',fecha:'2026-11-01T20:04:01.900Z'}],filas).length,0);
  assert.equal(sinCopias([{origen:'OPERADOR',mensaje:'ya te ayudo',fecha:'2026-11-01T20:05:00.000Z'}],filas).length,1);
});
