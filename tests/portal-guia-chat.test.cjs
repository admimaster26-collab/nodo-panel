const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const PORTAL=fs.readFileSync(path.join(__dirname,'..','Portal'),'utf8');
const GUIDE=PORTAL.slice(PORTAL.indexOf('// ── Ayuda conversacional local'),PORTAL.indexOf('// ── Push PWA'));
function source(name){
  const match=new RegExp('(?:async )?function '+name+'\\(').exec(PORTAL);
  assert.ok(match,'existe '+name);
  const begin=PORTAL.indexOf('{',match.index);let level=0;
  for(let i=begin;i<PORTAL.length;i++){
    if(PORTAL[i]==='{')level++;
    if(PORTAL[i]==='}'&&!--level)return PORTAL.slice(match.index,i+1);
  }
  throw Error('Función incompleta: '+name);
}
function harness(options={}){
  const elements=new Map(),storage=options.storage||new Map(),messages=[],sent=[],rpcCalls=[],navigation=[];
  function node(){
    const n={value:'',files:[],disabled:false,textContent:'',className:'',children:[],style:{},focus(){this.focused=true;},scrollIntoView(){},remove(){this.removed=true;if(this.id)elements.delete(this.id);}};
    Object.defineProperty(n,'id',{get(){return this._id;},set(v){this._id=v;elements.set(v,this);}});
    Object.defineProperty(n,'innerHTML',{get(){return this._html||'';},set(value){this._html=value;for(const m of String(value).matchAll(/id="([^"]+)"/g)){if(!elements.has(m[1])){const child=node();child.id=m[1];}}}});
    n.classList={add(c){n.className+=' '+c;},remove(c){n.className=n.className.split(' ').filter(x=>x!==c).join(' ');},contains(c){return n.className.split(' ').includes(c);}};
    n.appendChild=function(child){this.children.push(child);return child;};
    return n;
  }
  for(const id of ['messages','chatGuideControls','freeInput','btnEnviarMensaje']){const n=node();n.id=id;}
  const ctx={
    console,Date,Number,String,Object,Array,JSON,Set,Promise,encodeURIComponent,
    state:{publicCode:'ruta-1',pcCodigo:'P1',usuario:'ana',telefono:'1111',chatId:'',chatToken:'',shownTexts:new Set(),composerImage:null},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{createElement:node,querySelectorAll:()=>elements.get('messages').children.filter(x=>x.className.includes('guide-local')&&!x.removed)},
    $:id=>elements.get(id)||null,
    esc:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    escMsg:s=>String(s||''),
    addMsg(text,role,img,meta){messages.push({text,role,img,meta});const n=node();n.className='msg '+role+(meta?.local?' guide-local':'');elements.get('messages').appendChild(n);return n;},
    scrollChat(){},toast(){},startChatPoll(){},startPortalThreadPoll(){},
    goHome(){navigation.push('home');},goEstado(){navigation.push('estado');},goCarga(){navigation.push('carga');},
    async subirImagen(file){return options.upload?options.upload(file):'https://example.test/comprobante.png';},
    async enviarMensajeSoporte(text,img){sent.push({text,img});return options.send?options.send(text,img):{ok:true};},
    async rpc(name,args){rpcCalls.push({name,args});return options.rpc?options.rpc(name,args):{data:{ok:true,chat_id:7,chat_token:'token'}};},
    normalize:data=>Array.isArray(data)?data[0]:data,
    billeteraPayloadPlano:()=>({}),_marcaDeTiempo:()=>({}),location:{host:'portal.test'},
    clearComposerImage(){ctx.state.composerImage=null;}
  };
  vm.createContext(ctx);vm.runInContext(GUIDE,ctx);
  ctx.goChat=()=>ctx.guiaMostrar();
  for(const name of ['chatMessageRole','chatHelpMessage','sendFreeMessage'])vm.runInContext(source(name),ctx);
  if(options.realSender)vm.runInContext(source('enviarMensajeSoporte'),ctx);
  return {ctx,elements,storage,messages,sent,rpcCalls,navigation};
}
test('compila el HTML completo, además de las funciones aisladas',()=>{
  let count=0;
  for(const match of PORTAL.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim()){new vm.Script(match[1]);count++;}
  assert.ok(count>0);
});
test('opciones, regreso y formulario no envían mensajes ni generan operaciones',async()=>{
  const h=harness();h.ctx.guiaMostrar();
  await h.ctx.guiaElegir('revisar_envio');await h.ctx.guiaElegir('formulario');
  assert.ok(h.elements.has('guiaRevisionEnvio'));
  assert.equal(h.ctx.guiaCargar().step,'formulario');
  h.ctx.guiaVolver();assert.equal(h.ctx.guiaCargar().step,'revisar_envio');
  h.ctx.guiaVolver();assert.equal(h.ctx.guiaCargar().step,'inicio');
  assert.equal(h.sent.length,0);assert.equal(h.rpcCalls.length,0);
  assert.equal(h.messages.filter(m=>m.role==='user').length,4);
  assert.ok(h.messages.some(m=>m.role==='guide'&&m.text.includes('no crea otra carga')));
});
test('reingresar y recargar recupera elecciones, sin guardar los campos del formulario',async()=>{
  const h=harness();h.ctx.guiaMostrar();await h.ctx.guiaElegir('revisar_envio');await h.ctx.guiaElegir('formulario');
  h.elements.get('guiaMonto').value='7845';h.elements.get('guiaDetalle').value='dato privado';
  const size=h.messages.length;h.ctx.guiaMostrar();assert.equal(h.messages.length,size);
  const next=harness({storage:h.storage});next.ctx.guiaMostrar();
  assert.equal(next.ctx.guiaCargar().step,'formulario');
  assert.equal(next.ctx.guiaCargar().history.length,2);
  assert.equal(next.elements.get('guiaMonto').value,'');
  assert.ok(![...h.storage.values()].join('').includes('dato privado'));
  assert.ok(![...h.storage.values()].join('').includes('7845'));
});
test('guía aislada por oficina, usuario y conversación; estado inválido vuelve al inicio',async()=>{
  const h=harness();h.ctx.guiaMostrar();await h.ctx.guiaElegir('acceso');
  const first=h.ctx.guiaClave();
  h.ctx.state.usuario='otra';assert.equal(h.ctx.guiaCargar().step,'inicio');
  h.ctx.state.usuario='ana';h.ctx.state.publicCode='ruta-2';assert.equal(h.ctx.guiaCargar().step,'inicio');
  h.ctx.state.publicCode='ruta-1';h.ctx.state.chatId='88';assert.equal(h.ctx.guiaCargar().step,'inicio');
  h.ctx.state.chatId='';assert.equal(h.ctx.guiaCargar().step,'acceso');
  h.storage.set(first,JSON.stringify({version:1,updatedAt:Date.now(),step:'__proto__',history:[]}));
  vm.runInContext('guiaActual=null',h.ctx);assert.equal(h.ctx.guiaCargar().step,'inicio');
});
test('autoría distingue automático, persona, sistema y usuario incluso con nombre NODO',()=>{
  const h=harness();const role=h.ctx.chatMessageRole;
  assert.equal(role({origen:'OPERADOR',operador:'NODO'}),'bot');
  assert.equal(role({origen:'OPERADOR',metadata:{auto:true}}),'bot');
  assert.equal(role({tipo_emisor:'BOT'}),'bot');
  assert.equal(role({origen:'OPERADOR',operador:'Ana'}),'operator');
  assert.equal(role({origen:'SISTEMA',emisor:'NODO'}),'system');
  assert.equal(role({origen:'USUARIO',emisor:'NODO',metadata:{auto:true}}),'user');
});
test('tarjetas AYUDA admiten sólo acciones permitidas y nunca las ejecutan al recibir',()=>{
  const h=harness();const text='Ayuda ⟦AYUDA:inicio⟧ ⟦AYUDA:revisar_envio⟧ ⟦AYUDA:transferir⟧';
  const parsed=h.ctx.chatHelpMessage(text,'operator');
  assert.deepEqual([...parsed.actions],['inicio','revisar_envio']);assert.ok(parsed.text.includes('⟦AYUDA:transferir⟧'));
  assert.equal(h.ctx.chatHelpMessage(text,'user').actions.length,0);
  assert.equal(h.ctx.chatHelpMessage(text,'system').actions.length,0);
  assert.equal(h.navigation.length,0);assert.equal(h.sent.length,0);
  h.ctx.guiaAbrirTarjeta('transferir');assert.equal(h.messages.length,0);
});
test('pedir una persona manda un resumen y bloquea el doble clic mientras envía',async()=>{
  let resolve;const h=harness({send:()=>new Promise(r=>{resolve=r;})});
  h.ctx.guiaMostrar();await h.ctx.guiaElegir('acceso');
  const first=h.ctx.guiaElegir('persona');await h.ctx.guiaElegir('persona');
  assert.equal(h.sent.length,1);assert.ok(h.sent[0].text.startsWith('Resumen de ayuda guiada'));
  assert.ok(h.sent[0].text.includes('No puedo ingresar'));
  assert.notEqual(h.ctx.guiaCargar().step,'enviado');
  resolve({ok:true});await first;assert.equal(h.ctx.guiaCargar().step,'enviado');
});
test('fallo de atención no anuncia éxito y permite reintentar',async()=>{
  let fail=true;const h=harness({send:async()=>fail?{ok:false,error:'Sin conexión'}:{ok:true}});
  h.ctx.guiaMostrar();await h.ctx.guiaElegir('persona');
  assert.equal(h.ctx.guiaCargar().step,'persona');assert.ok(h.messages.some(x=>x.text==='Sin conexión'));
  assert.ok(!h.messages.some(x=>x.text.includes('Tu consulta llegó')));
  fail=false;await h.ctx.guiaElegir('persona');assert.equal(h.ctx.guiaCargar().step,'enviado');
});
test('diagnóstico valida monto y archivo antes de subir o enviar',async()=>{
  let uploads=0;const h=harness({upload:async()=>{uploads++;return 'url';}});
  h.ctx.guiaMostrar();await h.ctx.guiaElegir('revisar_envio');await h.ctx.guiaElegir('formulario');
  h.elements.get('guiaMotivo').value='sin_acreditar';h.elements.get('guiaMonto').value='0';
  await h.ctx.guiaEnviarRevision();assert.equal(h.sent.length,0);assert.equal(uploads,0);
  assert.ok(h.elements.get('guiaError').textContent.includes('mayor a cero'));
  h.elements.get('guiaMonto').value='5000';h.elements.get('guiaComprobante').files=[{type:'text/html',size:4}];
  await h.ctx.guiaEnviarRevision();assert.equal(h.sent.length,0);assert.equal(uploads,0);
});
test('diagnóstico conserva campos en fallo y un éxito envía soporte sin operación monetaria',async()=>{
  let fail=true;const h=harness({send:async()=>fail?{ok:false,error:'Sin confirmar'}:{ok:true}});
  h.ctx.guiaMostrar();await h.ctx.guiaElegir('revisar_envio');await h.ctx.guiaElegir('formulario');
  h.elements.get('guiaMotivo').value='datos_error';h.elements.get('guiaMonto').value='5000';h.elements.get('guiaDetalle').value='Anoté 500';
  await h.ctx.guiaEnviarRevision();assert.equal(h.elements.get('guiaMonto').value,'5000');
  assert.equal(h.elements.get('guiaError').textContent,'Sin confirmar');
  assert.notEqual(h.ctx.guiaCargar().step,'enviado');
  fail=false;await h.ctx.guiaEnviarRevision();
  assert.equal(h.ctx.guiaCargar().step,'enviado');assert.ok(!h.elements.has('guiaRevisionEnvio'));
  assert.equal(h.rpcCalls.length,0);assert.ok(h.sent[1].text.startsWith('Resumen de ayuda guiada'));
  assert.ok(h.sent[1].text.includes('No es una carga nueva'));assert.ok(h.sent[1].text.includes('Anoté 500'));
});
test('resultado lógico ok:false y respuesta vacía no se confunden con éxito ni disparan fallback',async()=>{
  for(const data of [{ok:false,error:'rechazado'},null]){
    const h=harness({realSender:true,rpc:async()=>({data})});h.ctx.state.chatId='7';h.ctx.state.chatToken='tok';
    const result=await h.ctx.enviarMensajeSoporte('hola');assert.equal(result.ok,false);
    assert.deepEqual(h.rpcCalls.map(x=>x.name),['landing_enviar_mensaje_v2']);
  }
});
test('doble envío directo abre una conversación y entrega un mensaje',async()=>{
  const h=harness({realSender:true,rpc:async name=>{await new Promise(r=>setTimeout(r,5));return {data:name==='landing_chat_abrir_v3'?{ok:true,chat_id:7,chat_token:'tok'}:{ok:true}};}});
  await Promise.all([h.ctx.enviarMensajeSoporte('consulta'),h.ctx.enviarMensajeSoporte('consulta')]);
  assert.deepEqual(h.rpcCalls.map(x=>x.name),['landing_chat_abrir_v3','landing_enviar_mensaje_v2']);
});
test('compositor mantiene texto y adjunto al fallar; recién los limpia al confirmar',async()=>{
  let fail=true;const h=harness({send:async()=>({ok:!fail})});const input=h.elements.get('freeInput');
  input.value='Mi consulta';h.ctx.state.composerImage={type:'image/png',size:1};
  await h.ctx.sendFreeMessage();assert.equal(input.value,'Mi consulta');assert.ok(h.ctx.state.composerImage);
  fail=false;await h.ctx.sendFreeMessage();assert.equal(input.value,'');assert.equal(h.ctx.state.composerImage,null);
});
