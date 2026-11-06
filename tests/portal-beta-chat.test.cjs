const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','Portal'),'utf8');
function fn(name){
  const match=new RegExp('(?:async )?function '+name+'\\(').exec(source);
  assert.ok(match,name);
  const start=source.indexOf('{',match.index);let depth=0;
  for(let i=start;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&!--depth)return source.slice(match.index,i+1);
  }
  throw Error(name);
}
const block=source.slice(source.indexOf("const PORTAL_CHAT_BETA_RPC="),source.indexOf('// ── Adaptador de respuestas'));
function beta(rows=[],extra={}){
  return {data:{ok:true,available:true,contract:'nodo.beta.v1',chat_id:'70',capabilities:['portal.thread.v1','portal.seen.v1'],rows,legacy_thread:[],has_more:false,next_before_id:null,...extra}};
}
function message(id,extra={}){return {id:String(id),tipo_emisor:'USUARIO',mensaje:'igual',created_at:'2026-10-25T12:00:00Z',...extra};}
function harness(handler=async()=>beta()){
  const elements=new Map(),calls=[],intervals=new Map();let nextTimer=0;
  function node(){
    const n={children:[],parent:null,scrollTop:0,disabled:false,style:{},className:''};
    Object.defineProperties(n,{
      id:{get(){return this._id;},set(v){this._id=v;elements.set(v,this);}},
      firstChild:{get(){return this.children[0]||null;}},
      scrollHeight:{get(){return this.children.length*20;}},
      innerHTML:{get(){return this._html||'';},set(v){this._html=v;if(v.includes('class="visto"')){this.tick=node();this.tick.className='visto';this.tick.textContent='✓';}}}
    });
    n.classList={contains:c=>n.className.split(' ').includes(c),add:c=>{n.className+=' '+c;}};
    n.setAttribute=(k,v)=>{n[k]=v;};n.querySelector=s=>s==='.visto'?n.tick||null:null;
    n.remove=()=>{if(n.parent)n.parent.children=n.parent.children.filter(c=>c!==n);if(n.id)elements.delete(n.id);n.parent=null;};
    n.appendChild=c=>{c.remove();c.parent=n;n.children.push(c);if(c.id)elements.set(c.id,c);return c;};
    n.insertBefore=(c,before)=>{if(!before)return n.appendChild(c);c.remove();const i=n.children.indexOf(before);assert.notEqual(i,-1);c.parent=n;n.children.splice(i,0,c);if(c.id)elements.set(c.id,c);return c;};
    return n;
  }
  for(const id of ['messages','widget']){const n=node();n.id=id;}
  elements.get('widget').className='open';
  const state={usuario:'demo',telefono:'1111',publicCode:'route',pcCodigo:'P_DEMO',chatId:'70',chatToken:'token-long-enough',nivelAcceso:'OK',screen:'chat',misGlobos:new Map(),seenMsgIds:new Set(),shownTexts:new Set(),portalThreadSeen:new Set()};
  const ctx={state,Map,Set,JSON,Date,Promise,Number,String,Object,Array,Infinity,console,
    document:{createElement:node},$:id=>elements.get(id)||null,
    chatPollTimer:null,portalThreadTimer:null,
    setInterval(callback,ms){const id=++nextTimer;intervals.set(id,{callback,ms});return id;},clearInterval:id=>intervals.delete(id),
    rpc:async(name,args)=>{calls.push({name,args});return handler(name,args);},
    normalize:x=>Array.isArray(x)?x[0]:x,
    _onPollOk(){ctx.successes++;},_onPollFail(){ctx.failures++;},successes:0,failures:0,
    autoChequeoValidacion(){},bumpUnread(){ctx.unread++;},unread:0,showOperatorBubble(){},notificarLocal(){},mostrarBotonIngresar(){},
    scrollChat(){},_fechaCorta:()=>'',now:()=>'',esc:x=>String(x||''),escMsg:x=>String(x||''),parseTransferCard:()=>null,renderTransferCardHtml:()=>'',
    localStorage:{setItem(){}},setTimeout,CLAVES_CHAT:['bet300_chat_id','bet300_chat_token'],_borrar(claves){ctx.borradas=claves;}
  };
  vm.createContext(ctx);
  vm.runInContext(block,ctx);
  for(const name of ['chatAgregar','chatMessageRole','chatHelpMessage','addMsg','savePortalThreadSeen','threadKey','renderThreadMsg','portalChatRenderLegacy','incomingOperatorMsg'])vm.runInContext(fn(name),ctx);
  return {ctx,calls,elements,intervals,messages:()=>elements.get('messages').children.filter(n=>n.className.startsWith('msg ')),ticks:()=>elements.get('messages').children.filter(n=>n.tick).map(n=>n.tick.textContent)};
}
test('beta resuelta y dos entradas de arranque comparten un timer y un vuelo',async()=>{
  let done;const h=harness(()=>new Promise(r=>{done=r;}));
  h.ctx.startChatPoll();h.ctx.startPortalThreadPoll();assert.equal(h.intervals.size,1);
  const first=h.ctx.pollOperatorMessages(),second=h.ctx.pollPortalThread();assert.equal(h.calls.length,1);
  done(beta([message(1)]));await Promise.all([first,second]);
  assert.deepEqual(h.calls.map(c=>c.name),['landing_beta_chat_leer_v1']);
  assert.equal(h.ctx.portalChatEstado().contrato,'nodo.beta.v1');assert.equal(h.messages().length,1);
  h.ctx.stopPortalThreadPoll();assert.equal(h.intervals.size,0);
});
// 9 de cada 10 chats terminan cerrados. Sin esto el poll tiraba error cada 5 segundos, aparecía el
// cartel de sin conexión y no se leía nada más: el jugador que volvía quedaba ciego.
for(const [nombre,error] of [['canal nuevo',{code:'42501',message:'BETA_CHAT_NOT_AUTHORIZED'}],['canal viejo',{code:'P0001',message:'Chat no autorizado'}]]){
  test('un chat cerrado no es una falla: sigue leyendo el hilo y no insiste cada 5 segundos: '+nombre,async()=>{
    const h=harness(async name=>{
      if(name==='landing_portal_chat_thread_get')return {data:{chat_thread:[]}};
      if(error.code==='42501')return {error};
      if(name==='landing_beta_chat_leer_v1')return {data:{ok:true,available:false,contract:'legacy',reason:'NO_ACTIVE_NODE'}};
      return {error};
    });
    await h.ctx.pollPortalThread();
    assert.equal(h.ctx.state.chatId,'70','se conserva: desde NODO se puede reabrir');
    assert.equal(h.ctx.failures,0,'no es una caída de conexión');
    assert.equal(h.calls.at(-1).name,'landing_portal_chat_thread_get','sigue leyendo el hilo del jugador');
    const antes=h.calls.filter(c=>c.name!=='landing_portal_chat_thread_get').length;
    await h.ctx.pollPortalThread();
    assert.equal(h.calls.filter(c=>c.name!=='landing_portal_chat_thread_get').length,antes,'no vuelve a golpear el chat cerrado enseguida');
  });
}
// Juan, 1/11: el mismo mensaje se veía dos veces. Una solicitud no se duplica porque vive en un solo
// lugar; el chat se guarda en dos, y por el canal nuevo llegaban los dos.
test('con NODO en el canal nuevo la copia del hilo viejo no se muestra, y lo que está sólo ahí sí',async()=>{
  const fila=(id,extra)=>({id:String(id),created_at:'2026-11-01T20:03:59.461861+00:00',...extra});
  const h=harness(async()=>beta([
    fila(17244,{tipo_emisor:'USUARIO',emisor:'demo',mensaje:'hola'}),
    fila(17245,{tipo_emisor:'OPERADOR',emisor:'OPERADOR',auto:true,mensaje:'Tu carga fue rechazada'})
  ],{legacy_thread:[
    {portal_key:'legacy:1:1',origen:'USUARIO',mensaje:'hola',fecha:'2026-11-01T20:03:59Z'},
    {portal_key:'legacy:1:2',origen:'OPERADOR',auto:true,mensaje:'Tu carga fue rechazada',fecha:'2026-11-01T20:04:01.484Z'},
    {portal_key:'legacy:1:3',origen:'OPERADOR',mensaje:'Ya validamos tu cuenta',fecha:'2026-11-01T20:03:59.900Z'},
    {portal_key:'legacy:1:4',origen:'USUARIO',mensaje:'hola',fecha:'2026-11-01T20:10:00Z'}
  ]}));
  await h.ctx.pollPortalThread();
  const textos=h.messages().map(n=>n.innerHTML.match(/class="bubble">([^<]*)/)[1]);
  assert.deepEqual(textos,['hola','Tu carga fue rechazada','Ya validamos tu cuenta','hola'],'cada mensaje una vez; el mismo texto en otro momento es otro mensaje');
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,4);
});
test('al cerrarse el chat lo conversado se queda, sin repetirse ni contar como nuevo',async()=>{
  let cerrado=false;
  const h=harness(async name=>{
    if(name==='landing_portal_chat_thread_get')return {data:{chat_thread:[
      {origen:'USUARIO',mensaje:'igual',fecha:'2026-10-25T12:00:00Z'},
      {origen:'OPERADOR',operador:'Ana',mensaje:'te contesto',fecha:'2026-10-25T12:00:01Z'},
      {origen:'OPERADOR',operador:'Ana',mensaje:'tu solicitud fue rechazada',fecha:'2026-10-25T12:00:02Z'}]}};
    if(cerrado)return {error:{code:'42501',message:'BETA_CHAT_NOT_AUTHORIZED'}};
    return beta([message(1),message(2,{tipo_emisor:'OPERADOR',emisor:'OPERADOR',mensaje:'te contesto'})]);
  });
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,2);
  h.ctx.state.screen='home';cerrado=true;
  await h.ctx.pollPortalThread();
  assert.equal(h.messages().length,3,'los dos de antes siguen y entra sólo lo nuevo del hilo');
  assert.equal(h.ctx.unread,1,'lo viejo no cuenta como nuevo');
});
test('si NODO reabre el chat, el jugador vuelve a leerlo solo',async()=>{
  let cerrado=true;
  const h=harness(async name=>{
    if(name==='landing_portal_chat_thread_get')return {data:{chat_thread:[]}};
    return cerrado?{error:{code:'42501',message:'BETA_CHAT_NOT_AUTHORIZED'}}:beta([message(5,{tipo_emisor:'OPERADOR',emisor:'OPERADOR',mensaje:'reabrí'})]);
  });
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,0);
  cerrado=false;vm.runInContext('portalChatCerradoHasta=0',h.ctx);
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,1);
});
test('al salir del canal nuevo no se repinta lo que ya estaba',async()=>{
  let nuevo=true;
  const h=harness(async name=>{
    if(name==='landing_beta_chat_leer_v1')return nuevo?beta([message(1)]):{data:{ok:true,available:false,contract:'legacy',reason:'NO_ACTIVE_NODE'}};
    if(name==='landing_leer_chat_v2')return {data:[{...message(1)}]};
    return {data:{chat_thread:[{origen:'USUARIO',mensaje:'igual',fecha:'2026-10-25T12:00:00Z'}]}};
  });
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,1);
  nuevo=false;await h.ctx.pollPortalThread();
  assert.equal(h.messages().length,1,'un solo globo por mensaje');
  vm.runInContext('portalChatRevisarEn=Infinity',h.ctx);await h.ctx.pollPortalThread();
  assert.equal(h.messages().length,1,'y sigue en uno');
});
test('al pasar al canal nuevo, lo recién enviado se queda en su lugar y no se repite',async()=>{
  const h=harness(async()=>beta([message(701,{mensaje:'hola'})]));
  h.ctx.portalChatRuta='probe';
  const propio=h.ctx.addMsg('hola','user',null,{id:'701',tipo_emisor:'USUARIO'});
  const respuesta=h.ctx.addMsg('te contesto','guide',null,{local:true});
  await h.ctx.pollPortalThread();
  const lista=h.elements.get('messages').children;
  assert.equal(h.messages().filter(n=>n.className==='msg user').length,1,'un solo globo');
  assert.ok(lista.indexOf(lista.find(n=>n.className==='msg user'))<lista.indexOf(respuesta),'antes de la respuesta');
  assert.equal(propio.parent,null,'el eco se reemplaza por el del servidor, en el mismo lugar');
});
test('texto repetido conserva globos separados y sólo el ID confirmado recibe visto',async()=>{
  const h=harness(async()=>beta([message('9007199254740993',{leido:true}),message('9007199254740994',{leido:false,visto_confirmado:true})]));
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,2);assert.deepEqual(h.ticks(),['✓','✓✓']);
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,2);assert.deepEqual(h.ticks(),['✓','✓✓']);
});
test('legado sin mapping tiene identidad propia y jamás fabrica visto',async()=>{
  const h=harness(async()=>beta([message(1)],{legacy_thread:[{portal_key:'l:22:1',id:'evil',origen:'USUARIO',mensaje:'igual',leido:true,visto_confirmado:true}]}));
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,2);assert.deepEqual(h.ticks(),['✓','✓']);
  await h.ctx.pollPortalThread();assert.equal(h.messages().length,2);
});
test('bot mantiene autoría y una edición reemplaza un globo en vez de notificar otro',async()=>{
  let text='inicial';const h=harness(async()=>beta([message(1,{tipo_emisor:'OPERADOR',auto:true,mensaje:text})]));
  await h.ctx.pollPortalThread();assert.match(h.messages()[0].innerHTML,/Asistente automático/);
  text='corregido';await h.ctx.pollPortalThread();assert.equal(h.messages().length,1);assert.match(h.messages()[0].innerHTML,/corregido/);assert.equal(h.ctx.unread,0);
});
test('un timeout no abre otro lector ni oculta el fallo',async()=>{
  const h=harness(async()=>({error:{code:'TIMEOUT'}}));await h.ctx.pollPortalThread();
  assert.equal(h.calls.length,1);assert.equal(h.ctx.failures,1);assert.equal(h.ctx.portalChatEstado().estado,'error');
});
test('función exacta ausente selecciona legacy; no vuelve a negociar cada tick',async()=>{
  const h=harness(async name=>name==='landing_beta_chat_leer_v1'?{error:{code:'PGRST202',message:name+' missing'}}:name==='landing_leer_chat_v2'?{data:[]}:{data:{chat_thread:[]}});
  await h.ctx.pollPortalThread();await h.ctx.pollOperatorMessages();
  assert.deepEqual(h.calls.map(c=>c.name),['landing_beta_chat_leer_v1','landing_leer_chat_v2','landing_portal_chat_thread_get','landing_leer_chat_v2','landing_portal_chat_thread_get']);
  assert.equal(h.ctx.portalChatEstado().ruta,'legacy');
});
test('función ajena ausente y contrato incompleto no autorizan fallback',async()=>{
  for(const response of [{error:{code:'42883',message:'other_function missing'}},beta([],{capabilities:['portal.seen.v1']})]){
    const h=harness(async()=>response);await h.ctx.pollPortalThread();assert.equal(h.calls.length,1);assert.equal(h.ctx.failures,1);
  }
});
test('oficina sin NODO beta activo conserva ambas lecturas y espera antes de negociar',async()=>{
  const h=harness(async name=>name==='landing_beta_chat_leer_v1'?{data:{ok:true,available:false,contract:'legacy',reason:'NO_ACTIVE_NODE'}}:name==='landing_leer_chat_v2'?{data:[]}:{data:{chat_thread:[]}});
  await h.ctx.pollPortalThread();await h.ctx.pollPortalThread();assert.equal(h.calls.length,5);assert.equal(h.ctx.successes,2);
});
test('respuesta tardía de otra conversación no pinta ni acredita éxito',async()=>{
  let done;const h=harness(()=>new Promise(r=>{done=r;}));const waiting=h.ctx.pollPortalThread();
  h.ctx.state.chatId='71';h.ctx.state.chatToken='other-token';done(beta([message(1,{visto_confirmado:true})]));await waiting;
  assert.equal(h.messages().length,0);assert.equal(h.ctx.successes,0);assert.equal(h.calls.length,1);
});
test('página anterior usa cursor sin saltar a otro canal y sin pedir todo el historial',async()=>{
  const h=harness(async(_name,args)=>args.p_before_id?beta([message(1)]):beta([message(2)],{has_more:true,next_before_id:'2'}));
  await h.ctx.pollPortalThread();assert.ok(h.elements.get('chatEarlier'));
  await h.ctx.portalCargarMensajesAnteriores();
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].args.p_before_id,'2');assert.equal(h.calls[1].args.p_limit,50);
  assert.equal(h.messages().length,2);assert.equal(h.elements.get('chatEarlier'),undefined);assert.deepEqual(h.ticks(),['✓','✓']);
});
test('fallo al paginar conserva la página y deja reintento visible',async()=>{
  const h=harness(async(_name,args)=>args.p_before_id?{error:{code:'TIMEOUT'}}:beta([message(2)],{has_more:true,next_before_id:'2'}));
  await h.ctx.pollPortalThread();await h.ctx.portalCargarMensajesAnteriores();
  assert.equal(h.messages().length,1);assert.equal(h.elements.get('chatEarlier').disabled,false);assert.match(h.elements.get('chatEarlier').textContent,/Reintentar/);assert.equal(h.calls.length,2);
});
test('ID grande de conversación se conserva como texto en RPC',async()=>{
  const h=harness();h.ctx.state.chatId='9007199254740993';await h.ctx.pollPortalThread();assert.equal(h.calls[0].args.p_chat_id,'9007199254740993');
});
test('un mensaje de guía local no muestra tilde de envío ni de visto',()=>{
  const h=harness();const node=h.ctx.addMsg('opción','user',null,{local:true});assert.equal(node.tick,undefined);
});
