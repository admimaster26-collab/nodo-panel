// El asistente del chat del Portal. Se reescribió el 1/11 desde el árbol del 21/10: la guía anterior
// nunca le hizo llegar un pedido a NODO. Estas pruebas EJECUTAN el código real con una pantalla y
// un servidor falsos; las de escritorio y celular de verdad están en scripts/smoke-chat.cjs.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const PORTAL=fs.readFileSync(path.join(__dirname,'..','Portal'),'utf8');
const GUIDE=PORTAL.slice(PORTAL.indexOf('// ── Asistente del chat'),PORTAL.indexOf('// ── Push PWA'));
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
const CARGA_PENDIENTE={tipo:'CARGA',estado:'PENDIENTE',monto:5000,fecha:new Date().toISOString(),solicitud_id:378404};
// Un número de ejemplo, como se guarda en la ruta de la oficina. No es de nadie.
const WA_OFICINA='5491123456789';
const WA_PEDIDO='https://wa.me/5491123456789?text='+encodeURIComponent('Hola, ¿me pasás mi usuario y el enlace para poder cargar, por favor?');
test('Portal: rejection button opens beta correction form after a fresh contract read',async()=>{
  const llamadas=[],vistas=[];
  const ctx={state:{_retiroProtocolo:null},
    async _consultarRetiroProtocolo(forzar){llamadas.push(forzar);return {mode:'beta',instrumento:null};},
    showScreen(nombre){vistas.push('screen:'+nombre);},renderRetiro(){vistas.push('render');},toast(){}};
  vm.createContext(ctx);vm.runInContext(source('corregirDatosRetiroDesdeEstado'),ctx);
  assert.equal(await ctx.corregirDatosRetiroDesdeEstado(),true);
  assert.deepEqual(llamadas,[true]);
  assert.equal(ctx.state._retiroProtocolo.cambiarCuenta,true);
  assert.deepEqual(vistas,['screen:retiro','render']);
});
test('Portal: beta correction stays closed when the contract is unavailable',async()=>{
  let renders=0,avisos=0;
  const ctx={state:{},async _consultarRetiroProtocolo(){return {mode:'error'};},
    showScreen(){renders++;},renderRetiro(){renders++;},toast(){avisos++;}};
  vm.createContext(ctx);vm.runInContext(source('corregirDatosRetiroDesdeEstado'),ctx);
  assert.equal(await ctx.corregirDatosRetiroDesdeEstado(),false);
  assert.equal(renders,0);assert.equal(avisos,1);
});
function harness(options={}){
  const elements=new Map(),storage=options.storage||new Map(),messages=[],sent=[],rpcCalls=[],creadas=[],navigation=[],vueltas=[];
  function node(){
    const n={value:'',files:[],disabled:false,textContent:'',className:'',children:[],style:{},_ids:[],dataset:{},
      focus(){this.focused=true;},scrollIntoView(){},querySelector(){return null;},
      remove(){this.removed=true;if(this.id)elements.delete(this.id);this._ids.forEach(i=>elements.delete(i));},
      removeAttribute(k){if(k==='id'){elements.delete(this._id);this._id=undefined;}}};
    Object.defineProperty(n,'id',{get(){return this._id;},set(v){this._id=v;elements.set(v,this);}});
    Object.defineProperty(n,'innerHTML',{get(){return this._html||'';},set(value){
      this._ids.forEach(i=>elements.delete(i));this._ids=[];this._html=value;
      for(const m of String(value).matchAll(/<[a-z]+[^>]*\bid="([^"]+)"[^>]*>/g)){
        const child=node();child.id=m[1];this._ids.push(m[1]);
        child.value=(m[0].match(/\bvalue="([^"]*)"/)||[])[1]||'';
      }
    }});
    n.classList={add(c){n.className+=' '+c;},remove(c){n.className=n.className.split(' ').filter(x=>x!==c).join(' ');},contains(c){return n.className.split(' ').includes(c);}};
    n.appendChild=function(child){child.parentNode=this;this.children.push(child);return child;};
    n.insertBefore=function(child,antes){child.parentNode=this;this.children.splice(this.children.indexOf(antes),0,child);return child;};
    return n;
  }
  for(const id of ['messages','freeInput','btnEnviarMensaje']){const n=node();n.id=id;}
  const ctx={
    console:{warn(){},log(){}},Date,Number,String,Object,Array,JSON,Set,Promise,Math,encodeURIComponent,setTimeout,
    state:{publicCode:'ruta-1',pcCodigo:'P1',usuario:'ana',telefono:'1111',nivelAcceso:'OK',motivoSoporte:'',chatId:'',chatToken:'',shownTexts:new Set(),composerImage:null,pendingTipo:'',...options.state},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{createElement:node,querySelectorAll:()=>elements.get('messages').children.filter(x=>x.className.includes('guide-local')&&!x.removed)},
    $:id=>elements.get(id)||null,
    esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    escMsg:s=>String(s??''),
    addMsg(text,role,img,meta){messages.push({text,role,img,meta});const n=node();n.className='msg '+role+(meta?.local?' guide-local':'');ctx.chatAgregar(n);return n;},
    chatAgregar(n){const host=elements.get('messages'),accion=elements.get('guiaAccion');if(accion&&accion.parentNode===host)host.insertBefore(n,accion);else host.appendChild(n);},
    scrollChat(){},toast(){},haptic(){},startChatPoll(){},startPortalThreadPoll(){},startEstadoPoll(){},subscribePush(){},renderHome(){},_marcarToque(){},clearComposerImage(){ctx.state.composerImage=null;},
    goHome(){navigation.push('home');},goEstado(){navigation.push('estado');},goChat(){ctx.guiaMostrar();},
    _money:v=>'$'+Number(v).toLocaleString('es-AR'),_minCarga:()=>1000,_minRetiro:()=>5000,_fechaCorta:()=>'01/11 14:32',_fmtRestante:()=>'3h',_titularPrevio:()=>'',
    _jsonDe:v=>v,solicitudIdValido:()=>378404,retiroCooldownRestanteMs:()=>options.cooldown||0,
    validarTitular:()=>options.titularMalo||'',
    async revisarTitularCarga(){return options.titularMalo?{aviso:options.titularMalo}:null;},
    async cargarResumenHistorial(){return options.historial?options.historial():{ok:true,rows:options.rows||[]};},
    async _sincronizarSolicitudActiva(){return !!options.enCurso;},
    async _leerSolicitudActiva(){return options.leerActiva||{ok:true,fila:options.enCurso?{solicitud_id:1}:null};},
    limpiarPendienteSilencioso(){ctx.state.pendingTipo='';ctx.state.solicitudId='';},_soloLetras:v=>String(v||'').replace(/[^\p{L}\s]/gu,''),
    async obtenerBilletera(){ctx.state.billetera=options.billetera===undefined?{alias:'alias.demo',cbu:'0000000000000000000000',titular:'Titular Demo'}:options.billetera;return ctx.state.billetera;},
    async leerDatosRetiro(){return options.datosRetiro||null;},
    async crearSolicitudCarga(u,m,t){creadas.push({tipo:'CARGA',u,m,t});return options.crear?options.crear():{ok:true,solicitudId:'378404'};},
    async crearSolicitudRetiro(u,m,d,t){creadas.push({tipo:'RETIRO',u,m,d,t});return options.crear?options.crear():{ok:true,solicitudId:'378405'};},
    async crearSolicitudClave(c){creadas.push({tipo:'CLAVE',c});return {ok:true};},
    async ingresarJugador(u,t){if(options.ingreso)return options.ingreso(u,t);ctx.state.usuario=u;ctx.state.telefono=t;return {acceso:true};},
    pedirRegistroCon(n,t){ctx.state.usuario=n||'nuevo-'+t;ctx.state.telefono=t;ctx.state.nivelAcceso='SOPORTE';return {};},
    pedirAyudaCon(u,t){if(!t)return {error:'Dejanos tu teléfono.'};ctx.state.usuario=u||'ayuda-'+t;ctx.state.telefono=t;ctx.state.nivelAcceso='SOPORTE';return {};},
    async enviarAltaSoporte(tipo,tema){sent.push({alta:tipo,tema});return options.send?options.send():{ok:true};},
    async reintentarValidacion(){},
    async subirImagen(file){return options.upload?options.upload(file):'https://example.test/comprobante.png';},
    async enviarMensajeSoporte(text,img,pedido){sent.push({text,img,pedido});return options.send?options.send(text,img):{ok:true,message_id:9,chat_id:'7'};},
    async rpc(name,args){
      rpcCalls.push({name,args});
      // La ruta de la oficina trae su WhatsApp: options.whatsapp lo cambia ('' = no tiene), options.ruta toda la respuesta.
      if(name==='landing_resolver_ruta_publica')return options.ruta?options.ruta(args):{data:[{ok:true,pc_codigo:'P1',whatsapp_numero:options.whatsapp===undefined?WA_OFICINA:options.whatsapp}]};
      if(name==='landing_portal_retiro_contexto_v1'&&!options.rpc)return {error:{code:'PGRST202',message:'function does not exist'}};
      return options.rpc?options.rpc(name,args):{data:{ok:true,chat_id:7,chat_token:'token'}};
    },
    normalize:data=>Array.isArray(data)?data[0]:data,
    billeteraPayloadPlano:()=>({}),_marcaDeTiempo:()=>({}),location:{host:'portal.test'},
    CLAVES_CHAT:['bet300_chat_id','bet300_chat_token'],_borrar(claves){claves.forEach(k=>storage.delete(k));}
  };
  vm.createContext(ctx);vm.runInContext(GUIDE,ctx);
  vm.runInContext('guiaPausaMs=0',ctx);
  for(const name of ['chatMessageRole','chatHelpMessage','sendFreeMessage','mostrarMensajePropio','estadoNormalizado','_tomarEnvio','_soltarEnvio','_restaurarBoton','tieneSolicitudPendiente','chatCerradoEnServidor','olvidarChatCerrado'])vm.runInContext(source(name),ctx);
  vm.runInContext(source('_retiroRpcInexistente'),ctx);
  vm.runInContext(source('_consultarRetiroProtocolo'),ctx);
  vm.runInContext(source('_mostrarDniRetiro'),ctx);
  vm.runInContext('let _enviando=false;',ctx);
  // La pregunta al servidor antes de mostrar la cuenta y el WhatsApp de la oficina viven afuera del
  // asistente (son de las pantallas). Corren los de verdad, contra el servidor falso.
  vm.runInContext(PORTAL.match(/const VINCULO_OPERA=.*/)[0]+'\n'+PORTAL.match(/const VINCULO_NO_OPERA=.*/)[0]+'\nlet _vinculoOk=null;',ctx);
  for(const name of ['vinculoPuedeOperar','despuesDeValidar','despuesPendiente','telefonoDiezDigitos','normalizarWhatsApp','whatsappOficina'])vm.runInContext(source(name),ctx);
  ctx.guiaDarVuelta=html=>{vueltas.push(html);elements.get('guiaAccion')?.remove();};
  if(options.realSender)vm.runInContext(source('enviarMensajeSoporte'),ctx);
  const opciones=()=>Array.from(ctx.guiaCargar().lista,o=>o.t);
  const tocar=label=>{const i=ctx.guiaCargar().lista.findIndex(o=>o.t.includes(label));assert.notEqual(i,-1,'no está la opción '+label+' en '+opciones().join(' / '));return ctx.guiaTocar(i);};
  const del=who=>messages.filter(m=>m.role===who).map(m=>m.text);
  const dijo=texto=>del('guide').some(t=>t.includes(texto));
  const campo=(id,valor)=>{elements.get(id).value=valor;};
  return {ctx,elements,storage,messages,sent,rpcCalls,creadas,navigation,vueltas,opciones,tocar,del,dijo,campo};
}
function abierto(options){const h=harness(options);h.ctx.guiaMostrar();return h;}
function retiroV1Rpc(ultima_solicitud,instrumento=null){
  return async name=>name==='landing_portal_retiro_contexto_v1'
    ? {data:{ok:true,contract:'retiro.instrumentos.v1',enabled:true,instrumento,ultima_solicitud}}
    : {data:{ok:true,verdict:'ACCESO',estado:'VINCULADO'}};
}

test('compila el HTML completo, además de las funciones aisladas',()=>{
  let count=0;
  for(const match of PORTAL.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim()){new vm.Script(match[1]);count++;}
  assert.ok(count>0);
});
test('no quedó nada de la guía anterior',()=>{
  for(const viejo of ['Elegí qué necesitás','Reintentar pedido','tu recorrido','Inicio de ayuda','Guía automática','Revisá que hayas','Una cosa a la vez','chatGuideControls','Resumen de ayuda guiada'])
    assert.ok(!PORTAL.includes(viejo),'sigue en el Portal: '+viejo);
});
test('el asistente no tiene un segundo camino: no le habla al servidor por su cuenta',()=>{
  assert.ok(!/\brpc\(/.test(GUIDE),'cargas, retiros, clave y mensajes salen por las funciones de las pantallas');
  assert.ok(!GUIDE.includes('landing_'),'ninguna función del servidor escrita acá');
});

// ── El saludo y el árbol ─────────────────────────────────────────────────────
test('el saludo avisa que es automático y que siempre hay una persona; abre el árbol sin mandar nada',()=>{
  const h=abierto();
  assert.ok(h.dijo('Es automático'));assert.ok(h.dijo('una persona'));assert.ok(h.dijo('¿Con qué te doy una mano?'));
  assert.deepEqual(h.opciones(),['💰 Una carga','🏧 Un retiro','🔑 Entrar a mi cuenta','✍️ Otra cosa','👤 Hablar con una persona']);
  assert.equal(h.sent.length,0);assert.equal(h.rpcCalls.length,0);
});
test('cada lista del árbol tiene una sola persona y una sola vuelta atrás, sin opciones repetidas',()=>{
  for(const usuario of ['ana','']){
    const h=abierto({state:{usuario,telefono:usuario?'1111':''}});
    for(const rama of ['inicio','carga','retiro','cuenta']){
      if(!usuario&&(rama==='carga'||rama==='retiro'))continue;
      h.ctx.guiaIr(rama);
      const o=h.opciones();
      assert.equal(new Set(o).size,o.length,rama+': repetidas');
      assert.equal(o.filter(x=>/persona/i.test(x)).length,1,rama+': una persona');
      assert.equal(o.filter(x=>/Otra consulta|Volver|Inicio de ayuda/.test(x)).length,rama==='inicio'?0:1,rama+': una vuelta');
    }
  }
});
test('al tocar, las opciones se van y lo elegido queda como mensaje del jugador, sin servidor',async()=>{
  const h=abierto();
  await h.tocar('Una carga');
  assert.deepEqual(h.del('user'),['💰 Una carga']);
  assert.ok(h.dijo('¿Qué pasó con la carga?'));
  assert.ok(h.opciones().includes('Transferí y no me apareció'));
  assert.equal(h.elements.get('messages').children.filter(n=>n.id==='guiaAccion'&&!n.removed).length,1,'una sola fila de acciones');
  await h.tocar('Otra consulta');
  assert.ok(h.opciones().includes('💰 Una carga'));
  assert.equal(h.sent.length,0);
  assert.deepEqual(h.rpcCalls.map(x=>x.name),['landing_portal_resolver_vinculo'],'sólo la revisión de la cuenta al abrir el chat');
});

// ── Lo de la captura ─────────────────────────────────────────────────────────
test('sin usuario, pedir una persona pide los datos ACÁ y el pedido sale: nunca el bucle de reintentar',async()=>{
  const h=abierto({state:{usuario:'',telefono:''}});
  await h.tocar('Hablar con una persona');
  assert.equal(h.sent.length,0,'todavía no hay a quién');
  assert.ok(h.elements.get('guiaUsuario'),'la ficha está en el chat');assert.ok(h.elements.get('guiaTelefono'));
  assert.deepEqual(h.navigation,[],'no lo manda a otra pantalla');
  assert.ok(!h.opciones().some(o=>/persona|Reintentar|Probar/.test(o)),'nada que dé vueltas en círculo');
  h.campo('guiaUsuario','prueba1');h.campo('guiaTelefono','1134567890');
  await h.ctx.guiaEnviarIngreso();
  await new Promise(r=>setTimeout(r,5));
  assert.equal(h.sent.length,1,'el pedido salió');
  assert.ok(h.sent[0].text.startsWith('Pido hablar con una persona.'));
  assert.ok(h.dijo('Te paso con un operador'));
});
test('los datos mal escritos se corrigen en la misma ficha y no se pierde lo que venía haciendo',async()=>{
  let intentos=0;
  const h=abierto({state:{usuario:'',telefono:''},ingreso(u,t){if(!intentos++)return {error:'Indicá tu teléfono con código de área (sin 0 ni 15).'};h.ctx.state.usuario=u;h.ctx.state.telefono=t;return {acceso:true};}});
  await h.tocar('Una carga');
  h.campo('guiaUsuario','prueba1');h.campo('guiaTelefono','12');
  await h.ctx.guiaEnviarIngreso();
  assert.match(h.elements.get('guiaError').textContent,/código de área/);
  h.campo('guiaTelefono','1134567890');
  await h.ctx.guiaEnviarIngreso();
  await new Promise(r=>setTimeout(r,5));
  assert.ok(h.dijo('¿Qué pasó con la carga?'),'sigue donde estaba');
});
test('si no se valida solo, sus datos le llegan a una persona UNA vez y se le explica qué sigue',async()=>{
  const h=abierto({state:{usuario:'',telefono:''},ingreso(u,t){h.ctx.state.usuario=u;h.ctx.state.telefono=t;h.ctx.state.nivelAcceso='SOPORTE';return {acceso:false};}});
  await h.tocar('Hablar con una persona');
  h.campo('guiaUsuario','prueba1');h.campo('guiaTelefono','1134567890');
  await h.ctx.guiaEnviarIngreso();
  await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(h.sent.map(s=>s.alta),['validar']);
  assert.ok(h.dijo('Ingresar'));
});
// Juan, 2/11: con un teléfono ajeno se sacaba el usuario de otro, y con usuario y teléfono se carga,
// se retira y se cambia la clave. El usuario no se dice por este chat: lo pide por WhatsApp desde su
// número y la oficina se lo contesta ahí, donde sólo lo lee el dueño del teléfono.
test('no se acuerda el usuario: lo pide por WhatsApp a su oficina, sin dejar datos en el chat',async()=>{
  const h=abierto({state:{usuario:'',telefono:''}});
  await h.tocar('Entrar a mi cuenta');await h.tocar('No me acuerdo el usuario');
  assert.ok(h.dijo('tu usuario no se dice por acá'));assert.ok(h.dijo('desde tu número'));
  assert.ok(!h.elements.get('guiaUsuario')&&!h.elements.get('guiaTelefono'),'no le pide nada');
  const wa=h.ctx.guiaCargar().lista.find(o=>o.href);
  assert.equal(wa.t,'📲 Pedir mi usuario por WhatsApp');assert.equal(wa.href,WA_PEDIDO);
  assert.ok(h.elements.get('guiaAccion').innerHTML.includes('<a class="whatsapp" href="'+WA_PEDIDO+'" target="_blank" rel="noopener">'),
    'un enlace de verdad: el toque abre WhatsApp aunque haya bloqueador');
  assert.ok(h.opciones().includes('👤 Hablar con una persona'));
  assert.equal(h.sent.length,0,'nada a una persona');assert.equal(h.creadas.length,0);
  assert.deepEqual(h.rpcCalls.map(c=>c.name),['landing_resolver_ruta_publica']);
});
test('el "No me acuerdo el usuario" de la ficha de ingreso sale de la ficha y va al mismo WhatsApp',async()=>{
  const h=abierto({state:{usuario:'',telefono:''}});
  await h.tocar('Entrar a mi cuenta');await h.tocar('Ya tengo usuario');
  assert.ok(h.elements.get('guiaTelefono'),'está la ficha');
  await h.ctx.guiaModoIngreso('olvido');
  assert.ok(!h.elements.get('guiaTelefono'),'la ficha se fue');
  assert.deepEqual(h.del('user').slice(-1),['No me acuerdo el usuario']);
  assert.equal(h.ctx.guiaCargar().lista.find(o=>o.href)?.href,WA_PEDIDO);
  assert.equal(h.sent.length,0);
});
test('no se acuerda el usuario y la oficina no tiene un WhatsApp que sirva: se lo dice sin botón y queda una persona',async()=>{
  for(const whatsapp of ['','54911234567']){   // sin cargar, y uno al que le faltan números
    const h=abierto({state:{usuario:'',telefono:''},whatsapp});
    await h.tocar('Entrar a mi cuenta');await h.tocar('No me acuerdo el usuario');
    assert.ok(h.dijo('Pedíselo a tu oficina por WhatsApp'),whatsapp);
    assert.ok(!h.ctx.guiaCargar().lista.some(o=>o.href)&&!h.elements.get('guiaAccion').innerHTML.includes('wa.me'),whatsapp+': sin botón');
    assert.ok(h.opciones().includes('👤 Hablar con una persona'));
    assert.ok(!h.elements.get('guiaTelefono'));assert.equal(h.sent.length,0);
  }
});
test('el WhatsApp de la oficina se arma para wa.me con la misma regla de los teléfonos; mal cargado, no hay botón',()=>{
  const {ctx}=harness();
  for(const [entra,sale] of [
    ['5491123456789','5491123456789'],   // como está guardado
    ['+54 9 11 2345-6789','5491123456789'],
    ['541123456789','5491123456789'],    // sin el 9 de celular
    ['1123456789','5491123456789'],      // sólo los 10 números
    ['011 2345 6789','5491123456789'],
    ['54911234567',''],                  // le faltan números
    ['11 15 2345 6789',''],              // con el 15 no se sabe dónde termina la característica
    ['',''],[null,'']
  ])assert.equal(ctx.normalizarWhatsApp(entra),sale,String(entra));
});
test('el WhatsApp de la oficina se pregunta una vez; sin conexión no se guarda y se vuelve a probar',async()=>{
  let falla=true;
  const h=abierto({state:{usuario:'',telefono:''},ruta:()=>falla?{error:{message:'Failed to fetch'}}:{data:[{ok:true,whatsapp_numero:WA_OFICINA}]}});
  const pedir=async()=>{await h.tocar('Entrar a mi cuenta');await h.tocar('No me acuerdo el usuario');};
  await pedir();
  assert.ok(h.dijo('Pedíselo a tu oficina'),'sin conexión: sin botón');
  falla=false;
  await h.tocar('Otra consulta');await pedir();
  assert.equal(h.ctx.guiaCargar().lista.find(o=>o.href)?.href,WA_PEDIDO);
  await h.tocar('Otra consulta');await pedir();
  assert.equal(h.rpcCalls.filter(c=>c.name==='landing_resolver_ruta_publica').length,2,'la que falló y la que quedó guardada');
  // Si ya vino con la ruta de la oficina, no se pregunta.
  const r=abierto({state:{usuario:'',telefono:'',whatsappOficina:'5491199998888'}});
  await r.tocar('Entrar a mi cuenta');await r.tocar('No me acuerdo el usuario');
  assert.ok(r.ctx.guiaCargar().lista.find(o=>o.href).href.startsWith('https://wa.me/5491199998888?text='));
  assert.equal(r.rpcCalls.length,0);
});
test('soy nuevo: nombre y teléfono, y le llega a una persona',async()=>{
  const h=abierto({state:{usuario:'',telefono:''}});
  await h.tocar('Entrar a mi cuenta');await h.tocar('Soy nuevo');
  h.campo('guiaUsuario','Juan');h.campo('guiaTelefono','1134567890');
  await h.ctx.guiaEnviarIngreso();
  await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(h.sent.map(s=>s.alta),['registro']);
});
test('pedir una persona manda un mensaje claro, con el tema, y dos toques no lo duplican',async()=>{
  let suelta;const h=abierto({send:()=>new Promise(r=>{suelta=()=>r({ok:true,message_id:9,chat_id:'7'});})});
  await h.tocar('Entrar a mi cuenta');
  const primero=h.tocar('No me deja entrar igual');
  h.ctx.guiaTocar(0);h.ctx.guiaTocar(0);
  await new Promise(r=>setTimeout(r,5));
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].text,'Pido hablar con una persona.\nTema: no consigo entrar a mi cuenta.');
  suelta();await primero;
  assert.ok(h.del('user').some(t=>t.startsWith('Pido hablar')),'el jugador ve lo mismo que el operador');
  assert.ok(!h.opciones().some(o=>/persona/.test(o)),'ya está pedido: no se ofrece de nuevo');
});
test('repetir EXACTAMENTE el mismo pedido enseguida no lo manda dos veces, y lo tocado queda escrito',async()=>{
  const h=abierto();
  await h.tocar('Hablar con una persona');
  await h.tocar('Otra consulta');
  assert.ok(h.opciones().some(o=>/persona/.test(o)),'la salida a una persona está siempre');
  await h.tocar('Hablar con una persona');
  assert.equal(h.sent.length,1);
  assert.ok(h.dijo('Ese pedido ya lo tiene una persona'));
  assert.ok(h.del('user').includes('👤 Hablar con una persona'),'el toque no desaparece');
});
// Juan, 1/11: validó, le contestaron y al tocar «No me deja entrar igual» el mensaje desaparecía,
// salía «Ya le avisé» y a NODO no llegaba nada.
test('un pedido con OTRO tema siempre llega, aunque recién haya avisado a una persona',async()=>{
  const h=abierto();
  await h.tocar('Hablar con una persona');
  await h.tocar('Otra consulta');await h.tocar('Entrar a mi cuenta');await h.tocar('No me deja entrar igual');
  assert.equal(h.sent.length,2,'llega');
  assert.equal(h.sent[1].text,'Pido hablar con una persona.\nTema: no consigo entrar a mi cuenta.');
  assert.ok(h.del('user').some(t=>t.includes('no consigo entrar')),'y el jugador lo ve');
});
// Juan, 6/11: con los datos ya en manos de una persona, "Hablar con una persona" no distingue nada y
// "Ya me activaron" afirma algo que el sistema sabe que no pasó. El jugador espera: el Portal se fija
// solo y, apenas lo habilitan, aparece Ingresar.
test('esperando la validación no se le ofrece nada que no sirva',async()=>{
  const h=abierto({state:{usuario:'',telefono:''},ingreso(u,t){h.ctx.state.usuario=u;h.ctx.state.telefono=t;h.ctx.state.nivelAcceso='SOPORTE';return {acceso:false};}});
  await h.tocar('Hablar con una persona');
  h.campo('guiaUsuario','prueba1');h.campo('guiaTelefono','1134567890');
  await h.ctx.guiaEnviarIngreso();
  await new Promise(r=>setTimeout(r,5));
  h.ctx.guiaReponerMenu();
  assert.deepEqual(h.opciones(),[],'ni "Ya me activaron" ni "Hablar con una persona"');
  h.ctx.guiaIr('inicio');
  assert.deepEqual(h.opciones(),[]);
  assert.ok(h.dijo('Una persona ya tiene tus datos'));
});
test('si el operador contestó o el chat se cerró, el mismo pedido vuelve a salir',async()=>{
  const contesto=abierto();
  await contesto.tocar('Hablar con una persona');
  contesto.ctx.guiaCederAPersona(new Date().toISOString());
  await contesto.tocar('Ver opciones');await contesto.tocar('Hablar con una persona');
  assert.equal(contesto.sent.length,2,'contestó: vuelve a salir');
  const cerrado=abierto({state:{chatId:'55',chatToken:'tok'}});
  await cerrado.tocar('Hablar con una persona');
  cerrado.ctx.state.chatId='';cerrado.ctx.state.chatToken='';
  await cerrado.tocar('Otra consulta');await cerrado.tocar('Hablar con una persona');
  assert.equal(cerrado.sent.length,2,'se cerró: vuelve a salir');
});
test('pasados unos minutos, el mismo pedido sin respuesta vuelve a salir',async()=>{
  const h=abierto();
  await h.tocar('Hablar con una persona');
  h.ctx.guiaCargar().pedido.at=Date.now()-6*60*1000;
  await h.tocar('Otra consulta');await h.tocar('Hablar con una persona');
  assert.equal(h.sent.length,2);
});
test('si falla el envío lo dice UNA vez, no apila carteles, y probar de nuevo manda de verdad',async()=>{
  let falla=true,intentos=0;
  const h=abierto({send:async()=>{intentos++;return falla?{ok:false,error:'Sin conexión'}:{ok:true,message_id:9,chat_id:'7'};}});
  const antes=h.messages.length;
  await h.tocar('Hablar con una persona');
  assert.equal(intentos,1);assert.equal(h.messages.length,antes,'sin globos repetidos');
  assert.match(h.elements.get('guiaAccion').innerHTML,/No pude mandarlo/);
  await h.tocar('Probar de nuevo');
  assert.equal(intentos,2,'cada toque es un intento real');assert.equal(h.messages.length,antes);
  assert.match(h.elements.get('guiaAccion').innerHTML,/Sigue sin salir/);
  falla=false;await h.tocar('Probar de nuevo');
  assert.equal(intentos,3);assert.ok(h.dijo('Te paso con un operador'));
  assert.ok(!h.dijo('Sin conexión'),'nunca muestra el texto técnico');
});

// ── Los textos que viajan ────────────────────────────────────────────────────
// Reglas de soporte_auto_mensaje_v1 tal cual estaban en el servidor el 1/11. Si una de estas frases
// matchea, el bot contesta solo encima de un pedido que ya va a una persona.
function elBotContesta(texto){
  const n=texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  const limpio=n.replace(/[^a-z0-9]+/g,' ').trim();
  const reglas=[/imagen adjunta/i.test(texto),
    /ya (te |le |se )?(carg|transfer|tranfer|pas|envi|deposit|mand)/.test(n),/^(te |le )?(carg|transfer|tranfer|envi|mand|pas)[a-z]* (te |le )?[0-9$]/.test(n),
    /^(enviado|transferido|cargado|listo el pago|pagado)$/.test(n),/no me figura|no se me acredit|hice la transferencia|ise la transferencia/.test(n),
    /^(ya |ahi |recien )?(cargue|carge|transferi|tranferi|pague|deposite|envie|mande)\b/.test(n),/(ya |recien )?(ise|hice) (una |la )?(transferencia|tranferencia|carga)/.test(n),/^(la|lo) (envie|mande|pase)\b/.test(n),
    /para cargar|quiero cargar|una recarga|quiero recargar/.test(n),/pasame.*(cbu|alias|numero|num)|mandame.*(cbu|alias)/.test(n),/^(cbu|alias|cargar|carga|recarga)[\s!.?¿]*$/.test(n),/donde (transfiero|deposito|mando)|a que (cuenta|cbu)/.test(n),
    /quiero registrarme|apodo\s*:|me haces un usuario|hacerme un usuario/.test(n),/quiero validar mi acceso|validar mi acceso/.test(n),
    /^(hola+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|holis)\b/.test(n),
    /no me (pag|acredit|carg|lleg|entr|deposit)/.test(n),/demor|tarda|cuanto falta|todavia|aun no|hace rato|falta mucho|sigo esperando/.test(n),/rechaz/.test(n),/(pedi|solicite|mande|hice) (un |el |la )?(retir|cobro)|acabo de pedir/.test(n),
    (/no me deja|no puedo (entrar|cargar|retirar|acceder|ingresar|jugar)/.test(limpio)||/no (anda|funciona|abre|carga la|me abre)|se (me )?cerro|se (traba|cuelga)/.test(limpio)||/no se ve|no aparece nada|me (saca|echa) (de|del) /.test(limpio)),
    /(mi|el) saldo|cuanto (tengo|me queda)|ver.*saldo|no me figura el saldo/.test(n),/cuanto (tarda|demora|falta)|cuanto tiempo|en cuanto se acredit|tardan mucho/.test(n)];
  return reglas.some(Boolean);
}
test('la regla de la prueba reconoce lo que el bot sí contesta',()=>{
  for(const t of ['Transferí y no me apareció','Me la rechazaron','No puedo ingresar','Ya transferí','Hola','quiero cargar'])assert.ok(elBotContesta(t),t);
});
test('ningún texto que manda el asistente activa el bot del servidor',()=>{
  const h=harness();
  const temas=vm.runInContext('Object.values(GUIA_TEMAS)',h.ctx);
  assert.ok(temas.length>=10);
  for(const tema of temas){const t=vm.runInContext('guiaTextoPersona('+JSON.stringify(tema)+')',h.ctx);assert.ok(!elBotContesta(t),t);}
  for(const t of [vm.runInContext('guiaTextoPersona("")',h.ctx),vm.runInContext('guiaTextoComprobante(378404)',h.ctx),vm.runInContext('guiaTextoComprobante("")',h.ctx),vm.runInContext('guiaTextoMonto(8000,5000,378404)',h.ctx)])assert.ok(!elBotContesta(t),t);
});

// ── Lo que el sistema ya sabe ────────────────────────────────────────────────
test('transferí y no apareció: con una en la fila dice cuál es y ofrece el comprobante',async()=>{
  const h=abierto({rows:[CARGA_PENDIENTE]});
  await h.tocar('Una carga');await h.tocar('Transferí y no me apareció');
  assert.ok(h.dijo('$5.000')||h.dijo('5.000'));assert.ok(h.dijo('en la fila'));
  assert.ok(h.dijo('Mandá el comprobante para que un operador revise la carga.'),'el texto que pidió Juan');
  assert.ok(h.elements.get('guiaArchivo'),'el cartel de subir el comprobante');
});
test('transferí y no apareció: rechazada muestra el motivo real',async()=>{
  const h=abierto({rows:[{tipo:'CARGA',estado:'RECHAZADA',monto:3000,fecha:new Date().toISOString(),motivo:'No nos llegó la transferencia',solicitud_id:7}]});
  await h.tocar('Una carga');await h.tocar('Transferí y no me apareció');
  assert.ok(h.dijo('No nos llegó la transferencia'));assert.ok(h.elements.get('guiaArchivo'));
});
test('transferí y no apareció: sin nada le da la ficha ahí mismo',async()=>{
  const h=abierto({rows:[]});
  await h.tocar('Una carga');await h.tocar('Transferí y no me apareció');
  assert.ok(h.elements.get('guiaMonto'));assert.ok(h.elements.get('guiaTitular'));
  assert.deepEqual(h.navigation,[]);
});
test('una carga de hace días no se presenta como la que está reclamando',async()=>{
  const h=abierto({rows:[{tipo:'CARGA',estado:'ACREDITADA',monto:3000,fecha:new Date(Date.now()-3*864e5).toISOString()}]});
  await h.tocar('Una carga');await h.tocar('Transferí y no me apareció');
  assert.ok(!h.dijo('acreditada'));assert.ok(h.elements.get('guiaMonto'));
});
test('si no puede leer la cuenta no inventa: lo dice y probar de nuevo vuelve a leer',async()=>{
  let vuelta=0;const h=abierto({historial:async()=>vuelta++?{ok:true,rows:[CARGA_PENDIENTE]}:{ok:false,code:'SIN_CONEXION',rows:[]}});
  await h.tocar('Una carga');await h.tocar('Transferí y no me apareció');
  assert.match(h.elements.get('guiaAccion').innerHTML,/No pude revisar tu cuenta/);
  assert.ok(!h.dijo('No veo ninguna carga'),'sin datos no afirma que no hay nada');
  await h.tocar('Probar de nuevo');
  assert.ok(h.dijo('en la fila'));
});
test('me la rechazaron: sin rechazos lo dice; con rechazo cuenta cuál',async()=>{
  const nada=abierto({rows:[CARGA_PENDIENTE]});
  await nada.tocar('Una carga');await nada.tocar('Me la rechazaron');
  assert.ok(nada.dijo('No veo cargas rechazadas'));
  const una=abierto({rows:[{tipo:'CARGA',estado:'RECHAZADA',monto:3000,fecha:'2026-10-30T10:00:00Z'}]});
  await una.tocar('Una carga');await una.tocar('Me la rechazaron');
  assert.ok(una.dijo('No tengo guardado el motivo'));
});
test('último retiro: cuenta real, a qué cuenta y cómo quedó, con salida si no lo reconoce',async()=>{
  const h=abierto({rows:[{tipo:'RETIRO',estado:'PAGADA',monto:50000,fecha:'2026-10-03T16:57:00Z',billetera:'0000000000000000006269',titular:'Titular Prueba'}]});
  await h.tocar('Un retiro');await h.tocar('¿Cuál fue mi último retiro?');
  assert.ok(h.dijo('terminada en 6269'));assert.ok(h.dijo('Titular Prueba'));assert.ok(h.dijo('pagado'));
  await h.tocar('Ese no lo pedí yo');
  assert.equal(h.sent[0].text,'Pido hablar con una persona.\nTema: un retiro que no reconozco.');
});
test('pedí y no me pagaron: un retiro parcial dice cuánto se pagó y cuánto falta',async()=>{
  const h=abierto({rows:[{tipo:'RETIRO',estado:'EN_PROCESO',monto:50000,monto_a_pagar:50000,pagado:20000,fecha:new Date().toISOString()}]});
  await h.tocar('Un retiro');await h.tocar('Pedí y no me pagaron');
  assert.ok(h.dijo('20.000'));assert.ok(h.dijo('30.000'));
});
test('sin retiros lo dice sin afirmar más de lo que sabe',async()=>{
  const h=abierto({rows:[CARGA_PENDIENTE]});
  await h.tocar('Un retiro');await h.tocar('Pedí y no me pagaron');
  assert.ok(h.dijo('en los últimos 7 días'));
});
test('retiro beta pendiente: la autoayuda explica la verificación única y no pide otro retiro',async()=>{
  const h=abierto({rpc:retiroV1Rpc({id:378406,estado:'EN_REVISION',estado_validacion:'PENDIENTE',monto:20000,
    creada_at:new Date().toISOString(),actualizada_at:new Date().toISOString()})});
  await h.tocar('Un retiro');await h.tocar('Pedí y no me pagaron');
  assert.ok(h.dijo('verificación de titularidad con el banco'));
  assert.ok(h.dijo('Es por única vez para esta cuenta'));
  assert.ok(!h.elements.get('guiaMonto'),'no crea un segundo retiro mientras se valida');
});
test('retiro beta rechazado: la autoayuda ofrece corregir cuenta y vuelve a pedir DNI',async()=>{
  const h=abierto({rpc:retiroV1Rpc({id:378407,estado:'RECHAZADA',estado_validacion:'RECHAZADO',codigo:'DNI_MISMATCH',monto:20000,
    creada_at:new Date().toISOString(),actualizada_at:new Date().toISOString()}),datosRetiro:{beta:true,validado:false}});
  await h.tocar('Un retiro');await h.tocar('Pedí y no me pagaron');
  assert.ok(h.dijo('el DNI rechazado no se puede volver a enviar'));
  await h.tocar('Corregir DNI o cuenta');
  assert.ok(h.elements.get('guiaDni'),'la corrección vuelve a abrir el campo dentro del chat');
});

// ── Fichas ───────────────────────────────────────────────────────────────────
test('ficha de carga: todo en el chat, sale por la misma función que la pantalla y se da vuelta',async()=>{
  const h=abierto();
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  assert.match(h.elements.get('guiaAccion').innerHTML,/alias\.demo/,'el alias para copiar');
  assert.match(h.elements.get('guiaAccion').innerHTML,/0000000000000000000000/,'el CBU para copiar');
  assert.match(h.elements.get('guiaAccion').innerHTML,/la cuenta desde la que sale la plata/);
  h.campo('guiaMonto','5000');h.campo('guiaTitular','Neo Test');
  await h.ctx.guiaEnviarCarga();
  assert.deepEqual(h.creadas,[{tipo:'CARGA',u:'ana',m:'5000',t:'Neo Test'}]);
  assert.equal(h.vueltas.length,1);
  for(const dato of ['$5.000','alias.demo','Titular Demo','Neo Test','#378404'])assert.ok(h.vueltas[0].includes(dato),dato);
  assert.ok(h.opciones().some(o=>o.includes('Subir el comprobante')));
  assert.ok(h.dijo('Mandá el comprobante para que un operador revise la carga.'));
  assert.ok(!h.del('guide').some(t=>t.includes('Apenas la veamos')),'el ticket ya lo dice: no se repite');
  assert.deepEqual(h.navigation,[],'no lo saca del chat');
});
test('ficha de carga: ocho toques crean una sola solicitud',async()=>{
  const h=abierto();
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  h.campo('guiaMonto','5000');h.campo('guiaTitular','Neo Test');
  await Promise.all(Array.from({length:8},()=>h.ctx.guiaEnviarCarga()));
  assert.equal(h.creadas.length,1);
});
test('ficha de carga: lo que está mal se avisa en la ficha, sin crear nada ni borrar lo escrito',async()=>{
  const h=abierto({titularMalo:'Ese es el titular de NUESTRA cuenta.'});
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  h.campo('guiaMonto','500');h.campo('guiaTitular','Titular Demo');
  await h.ctx.guiaEnviarCarga();
  assert.match(h.elements.get('guiaError').textContent,/mínima/);
  h.campo('guiaMonto','5000');
  await h.ctx.guiaEnviarCarga();
  assert.match(h.elements.get('guiaError').textContent,/NUESTRA/);
  assert.equal(h.creadas.length,0);assert.equal(h.elements.get('guiaMonto').value,'5000');
});
test('si el servidor no toma la carga, los datos siguen ahí para reintentar',async()=>{
  const h=abierto({crear:()=>({ok:false,motivo:'sin_envio'})});
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  h.campo('guiaMonto','5000');h.campo('guiaTitular','Neo Test');
  await h.ctx.guiaEnviarCarga();
  assert.match(h.elements.get('guiaError').textContent,/siguen acá/);
  assert.equal(h.vueltas.length,0);assert.equal(h.elements.get('guiaMonto').value,'5000');
  assert.equal(h.elements.get('guiaEnviar').disabled,false,'el botón no queda trabado');
});
test('con una solicitud en revisión no ofrece otra ficha',async()=>{
  const h=abierto({enCurso:true,state:{pendingTipo:'CARGA'}});
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  assert.ok(h.dijo('en revisión'));assert.ok(!h.elements.get('guiaMonto'));
});
// Juan, 2/11: un jugador sin validar veía la cuenta, transfería, y recién al tocar "Ya transferí ·
// Pedir la carga" le decían que no estaba habilitado. Se iba sin cargar. Ahora el servidor se consulta
// ANTES: sin validar no ve la cuenta, deja sus datos y, validado, sigue con la carga.
function vinculo(veredicto){
  const v={actual:veredicto};
  return {v,rpc:async(name)=>name==='landing_portal_resolver_vinculo'?{data:{ok:v.actual==='ACCESO',verdict:v.actual,mensaje:'Tu usuario no figura en la base de tu oficina.'}}:{data:{ok:true,chat_id:7,chat_token:'token'}}};
}
const tic=()=>new Promise(r=>setTimeout(r,5));
test('al abrir el chat se revisa la cuenta: sin validar, menú corto y nada de cargas ni retiros',async()=>{
  const s=vinculo('NO_REGISTRADO');
  // Como el ingreso de verdad: si el servidor lo reconoce, queda habilitado.
  const h=abierto({rpc:s.rpc,ingreso:(u,tel)=>{Object.assign(h.ctx.state,{usuario:u,telefono:tel,nivelAcceso:'OK'});return {acceso:true};}});   // el teléfono dice OK; el servidor, que no
  await tic();
  assert.equal(h.rpcCalls[0].name,'landing_portal_resolver_vinculo','se pregunta al abrir, antes de elegir nada');
  assert.deepEqual(h.opciones(),['✅ Validar mi cuenta','🆕 Soy nuevo','🔑 No me acuerdo el usuario','👤 Hablar con una persona']);
  assert.ok(h.dijo('Tu cuenta todavía no está validada'));
  assert.equal(h.ctx.state.nivelAcceso,'SOPORTE');
  // Valida desde el menú y le aparece el menú entero.
  await h.tocar('Validar mi cuenta');
  assert.equal(h.elements.get('guiaUsuario').value,'ana','con sus datos ya escritos');
  assert.match(h.elements.get('guiaAccion').innerHTML,/>Validar</);
  s.v.actual='ACCESO';
  await h.ctx.guiaEnviarIngreso();
  assert.ok(h.opciones().includes('💰 Una carga'),'validado, el menú entero');
});
test('un toque antes de que llegue la respuesta la espera: no se cuela una carga',async()=>{
  const s=vinculo('NO_REGISTRADO');
  const h=abierto({rpc:s.rpc});
  await h.tocar('Una carga');   // el menú todavía es el entero
  assert.ok(!h.dijo('¿Qué pasó con la carga?'));
  assert.ok(h.opciones().includes('✅ Validar mi cuenta'));
});
test('si igual llega a la carga (un enlace directo), no ve la cuenta: valida y sigue la carga',async()=>{
  const s=vinculo('NO_REGISTRADO');
  const h=abierto({rpc:s.rpc});
  await tic();
  await h.ctx.guiaFichaCarga();
  assert.ok(!h.elements.get('guiaMonto'),'no hay ficha de carga');
  assert.ok(!/alias\.demo/.test(h.elements.get('guiaAccion')?.innerHTML||''),'ni la cuenta para transferir');
  assert.ok(h.dijo('Todavía falta validar tu cuenta'));assert.ok(h.dijo('te paso para cargar'));
  s.v.actual='ACCESO';
  await h.ctx.guiaEnviarIngreso();
  assert.ok(h.elements.get('guiaMonto'),'validado, aparece la ficha de carga');
  assert.match(h.elements.get('guiaAccion').innerHTML,/alias\.demo/);
  assert.equal(h.storage.get('bet300_despues_validar'),undefined,'lo pendiente se cumplió');
});
test('si no se valida solo, una persona recibe sus datos una vez y, al habilitarlo, sigue lo que había venido a hacer',async()=>{
  const s=vinculo('NO_REGISTRADO');
  const h=abierto({rpc:s.rpc,ingreso:(u,t)=>{h.ctx.state.usuario=u;h.ctx.state.telefono=t;h.ctx.state.nivelAcceso='SOPORTE';return {acceso:false};}});
  await tic();
  await h.ctx.guiaFichaCarga();
  await h.ctx.guiaEnviarIngreso();
  assert.deepEqual(h.sent.filter(x=>x.alta).map(x=>x.alta),['validar'],'le llega a una persona');
  assert.ok(h.dijo('te paso para cargar'));
  h.ctx.state._altaSoporteEnviado=true;
  h.ctx.guiaIr('inicio');
  assert.deepEqual(h.opciones(),[],'no se le vuelven a pedir los datos ni se le ofrece nada que no sirva');
  // El operador lo habilita: el Portal muestra Ingresar y, al tocarlo, sigue con la carga.
  s.v.actual='ACCESO';h.ctx.reintentarValidacion=async()=>{h.ctx.state.nivelAcceso='OK';};
  await h.ctx.guiaRevalidar();
  assert.ok(h.elements.get('guiaMonto'),'sigue con la carga, sin volver a empezar');
});
test('si el servidor ya lo tiene validado, entra aunque el teléfono diga que no',async()=>{
  const s=vinculo('ACCESO');
  const h=abierto({rpc:s.rpc,state:{nivelAcceso:'SOPORTE',motivoSoporte:'Estamos validando tu usuario.'}});
  await tic();
  assert.equal(h.ctx.state.nivelAcceso,'OK');
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  assert.ok(h.elements.get('guiaMonto'));
});
test('una respuesta que no se entiende no frena a nadie: el servidor controla igual al recibir el pedido',async()=>{
  const h=abierto({rpc:async()=>({data:null,error:{message:'sin señal'}})});
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  assert.ok(h.elements.get('guiaMonto'));
});
test('retiro y clave también preguntan antes',async()=>{
  for(const [ficha,campo] of [['guiaFichaRetiro','guiaDestino'],['guiaFichaClave','guiaClaveNueva']]){
    const s=vinculo('NO_REGISTRADO');
    const h=abierto({rpc:s.rpc});
    await tic();
    assert.ok(!h.opciones().some(o=>/retiro|cuenta/i.test(o)&&!/Validar|usuario/.test(o)),ficha+': no está en el menú');
    await h.ctx[ficha]();
    assert.ok(!h.elements.get(campo),ficha+': sin ficha');
    assert.ok(h.dijo('Todavía falta validar tu cuenta'),ficha);
  }
});
test('"Transferí y no me apareció": si no puede cargar, no le dice "completá esto"',async()=>{
  const s=vinculo('NO_REGISTRADO');
  const h=abierto({rpc:s.rpc});
  await tic();
  await h.ctx.guiaNoAparecio();
  assert.ok(!h.dijo('completá esto'),'nada de prometer una ficha que no va a aparecer');
  assert.ok(h.dijo('Todavía falta validar tu cuenta'));
});
test('ficha de retiro: trae los datos del último, valida y sale por la función de la pantalla',async()=>{
  const h=abierto({datosRetiro:{destino:'mi.alias.mp',titular:'Titular Prueba'}});
  await h.tocar('Un retiro');await h.tocar('Quiero retirar');
  assert.equal(h.elements.get('guiaDestino').value,'mi.alias.mp');assert.equal(h.elements.get('guiaTitular').value,'Titular Prueba');
  h.campo('guiaMonto','1000');
  await h.ctx.guiaEnviarRetiro();
  assert.match(h.elements.get('guiaError').textContent,/mínimo/);assert.equal(h.creadas.length,0);
  h.campo('guiaMonto','20000');
  await h.ctx.guiaEnviarRetiro();
  assert.deepEqual(h.creadas,[{tipo:'RETIRO',u:'ana',m:20000,d:'mi.alias.mp',t:'Titular Prueba'}]);
  assert.equal(h.vueltas.length,1);assert.ok(h.vueltas[0].includes('$20.000'));
});
test('un retiro por día: si ya pidió, se lo dice sin mostrar la ficha',async()=>{
  const h=abierto({cooldown:3*3600*1000});
  await h.tocar('Un retiro');await h.tocar('Quiero retirar');
  assert.ok(h.dijo('Ya pediste un retiro hoy'));assert.ok(!h.elements.get('guiaMonto'));
});
test('clave: sale por la función de la pantalla y no promete una clave que todavía no existe',async()=>{
  const h=abierto();
  await h.tocar('Entrar a mi cuenta');await h.tocar('No me acuerdo la clave');
  h.campo('guiaClaveNueva','');
  await h.ctx.guiaEnviarClave();
  assert.deepEqual(h.creadas,[{tipo:'CLAVE',c:''}]);
  assert.ok(h.dijo('Te aviso por acá apenas esté'));
});
// Carlitos y Juan, 2/11: el asistente repetía el usuario que el jugador había escrito al entrar. Si lo
// había escrito mal, le confirmaba el error. Sólo se dice si el servidor confirma la cuenta.
const resolver=(verdict,estado)=>async name=>name==='landing_portal_resolver_vinculo'?{data:{ok:verdict==='ACCESO',verdict,estado}}:{data:{ok:true,chat_id:7,chat_token:'token'}};
test('no me acuerdo el usuario: si el servidor confirma su cuenta, se lo dice',async()=>{
  const h=abierto({rpc:resolver('ACCESO','VINCULADO')});
  await h.tocar('Entrar a mi cuenta');await h.tocar('No me acuerdo el usuario');
  assert.ok(h.dijo('Tu usuario es <b>ana</b>'));assert.equal(h.sent.length,0);
  assert.ok(!h.ctx.guiaCargar().lista.some(o=>o.href),'no hace falta WhatsApp');
  assert.ok(!h.rpcCalls.some(c=>c.name==='landing_resolver_ruta_publica'));
});
test('no me acuerdo el usuario: sin cuenta confirmada no se lo dice ni repite lo que escribió; lo pide por WhatsApp',async()=>{
  for(const [verdict,estado] of [['NO_REGISTRADO',''],['ACCESO','PENDIENTE'],['CONFLICTO_TELEFONO',''],[undefined,undefined]]){
    const h=abierto({state:{usuario:'juan'},rpc:resolver(verdict,estado)});
    await new Promise(r=>setTimeout(r,5));
    // Sin validar está en el menú corto; si no, adentro de "Entrar a mi cuenta".
    if(h.opciones().includes('🔑 Entrar a mi cuenta'))await h.tocar('Entrar a mi cuenta');
    await h.tocar('No me acuerdo el usuario');
    assert.ok(!h.dijo('Tu usuario es'),verdict+': no se lo dice');
    assert.ok(!h.del('guide').some(x=>x.includes('juan')),verdict+': ni repite lo que escribió');
    assert.ok(!h.elements.get('guiaAccion').innerHTML.includes('juan'),verdict+': ni en el botón');
    assert.equal(h.ctx.guiaCargar().lista.find(o=>o.href)?.href,WA_PEDIDO,verdict+': el botón de WhatsApp');
    assert.ok(!h.elements.get('guiaTelefono')&&!h.elements.get('guiaUsuario'),verdict+': no le pide datos');
    assert.equal(h.sent.length,0,verdict+': nada a una persona');
    assert.ok(!h.ctx.state._altaSoporteEnviado,verdict+': ni queda como que una persona tiene sus datos');
  }
});
// Esto es de validar o registrarse: "No me acuerdo el usuario" ya no le pasa datos a una persona.
test('sin validar y con sus datos ya en manos de una persona: no se los vuelve a pedir',async()=>{
  const h=abierto({state:{usuario:'juan',_altaSoporteEnviado:true},rpc:resolver('NO_REGISTRADO','')});
  await new Promise(r=>setTimeout(r,5));
  assert.ok(h.dijo('Una persona ya tiene tus datos'));
  assert.deepEqual(h.opciones(),[]);
  assert.ok(!h.elements.get('guiaTelefono'));
});
test('monto mal: pide el número, le avisa al operador y JAMÁS crea otra solicitud',async()=>{
  const h=abierto({rows:[CARGA_PENDIENTE]});
  await h.tocar('Una carga');await h.tocar('Me equivoqué en el monto');
  assert.ok(h.dijo('no hay ningún problema'));assert.ok(h.dijo('se acredita igual'));
  h.campo('guiaMonto','8000');
  await h.ctx.guiaEnviarMonto();
  assert.equal(h.creadas.length,0,'duplicar el pedido es justo lo que no se quiere');
  assert.match(h.sent[0].text,/transferí \$8\.000/);assert.match(h.sent[0].text,/378404/);
  assert.ok(h.dijo('no hace falta que mandes otro'));
});
test('transferí a otra cuenta: comprobante sin vueltas, con el titular real si puede operar',async()=>{
  const h=abierto();
  await h.tocar('Una carga');await h.tocar('Le transferí a otra cuenta');
  assert.ok(h.dijo('mandá el comprobante para que un operador revise la carga'));
  assert.ok(h.dijo('Titular Demo'));assert.ok(h.elements.get('guiaArchivo'));
  await h.tocar('No lo tengo ahora');
  assert.match(h.sent[0].text,/sin el comprobante a mano/);
});
test('sin validar no se le muestra a quién transferir: ni siquiera hay carga en el menú',async()=>{
  const h=abierto({state:{nivelAcceso:'SOPORTE'}});
  assert.ok(!h.opciones().some(o=>o.includes('Una carga')));
  await h.ctx.guiaOtraCuenta();
  assert.ok(!h.dijo('Titular Demo'));
});
test('comprobante: un fallo no pierde el archivo; al salir llega con su imagen',async()=>{
  let falla=true;const archivo={type:'image/png',size:10};
  const h=abierto({rows:[CARGA_PENDIENTE],upload:async()=>falla?null:'https://example.test/c.png'});
  await h.tocar('Una carga');await h.tocar('Transferí y no me apareció');
  await h.ctx.guiaEnviarComprobante();
  assert.match(h.elements.get('guiaError').textContent,/Elegí/);assert.equal(h.sent.length,0);
  h.elements.get('guiaArchivo').files=[archivo];
  await h.ctx.guiaEnviarComprobante();
  assert.match(h.elements.get('guiaError').textContent,/sigue acá/);assert.equal(h.elements.get('guiaArchivo').files[0],archivo);
  falla=false;await h.ctx.guiaEnviarComprobante();
  assert.deepEqual(h.sent,[{text:'Comprobante de mi transferencia · pedido 378404.',img:'https://example.test/c.png',pedido:378404}],'queda atado a esa carga');
  assert.ok(h.dijo('ya lo tiene el operador'));
});

test('los botones de las fichas vuelven aunque haya una solicitud pendiente',async()=>{
  const h=abierto({state:{pendingTipo:'CARGA',solicitudId:'378404'},rows:[CARGA_PENDIENTE],upload:async()=>null});
  await h.tocar('Una carga');await h.tocar('Transferí y no me apareció');
  h.elements.get('guiaArchivo').files=[{type:'image/png',size:10}];
  await h.ctx.guiaEnviarComprobante();
  assert.equal(h.elements.get('guiaEnviar').disabled,false,'se puede reintentar');
  assert.equal(h.elements.get('guiaEnviar').textContent,'Enviar comprobante');
});
test('con una pendiente en el teléfono y el servidor sin contestar, no se ofrece otra ficha',async()=>{
  for(const accion of ['Quiero cargar']){
    const h=abierto({state:{pendingTipo:'CARGA',solicitudId:'378404'},leerActiva:{ok:false,fila:null}});
    await h.tocar('Una carga');await h.tocar(accion);
    assert.ok(!h.elements.get('guiaMonto'),'sin respuesta no se crea otra a ciegas');
    assert.equal(h.ctx.state.solicitudId,'378404','y no se borra lo que el teléfono sabe');
  }
  const r=abierto({state:{pendingTipo:'RETIRO',solicitudId:'378404'},leerActiva:{ok:false,fila:null}});
  await r.tocar('Un retiro');await r.tocar('Quiero retirar');
  assert.ok(!r.elements.get('guiaMonto'));
});
test('si el servidor confirma que no hay ninguna, la marca vieja se limpia y sale la ficha',async()=>{
  const h=abierto({state:{pendingTipo:'CARGA',solicitudId:'378404'},leerActiva:{ok:true,fila:null}});
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  assert.ok(h.elements.get('guiaMonto'));assert.equal(h.ctx.state.solicitudId,'');
});
test('pedir por el chat conserva la conversación abierta',async()=>{
  const h=abierto();const pedidos=[];
  h.ctx.crearSolicitudCarga=async(...a)=>{pedidos.push(a[3]);return {ok:true,solicitudId:'1'};};
  h.ctx.crearSolicitudRetiro=async(...a)=>{pedidos.push(a[4]);return {ok:true,solicitudId:'2'};};
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  h.campo('guiaMonto','5000');h.campo('guiaTitular','Neo Test');await h.ctx.guiaEnviarCarga();
  await h.tocar('Otra consulta');await h.tocar('Un retiro');await h.tocar('Quiero retirar');
  h.campo('guiaMonto','20000');h.campo('guiaDestino','mi.alias.mp');h.campo('guiaTitular','Neo Test');await h.ctx.guiaEnviarRetiro();
  assert.deepEqual(pedidos,[true,true]);
});
test('mientras una ficha se envía no se puede salir, y el resultado no se pierde',async()=>{
  let suelta;const h=abierto({crear:()=>new Promise(r=>{suelta=()=>r({ok:true,solicitudId:'378404'});})});
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  h.campo('guiaMonto','5000');h.campo('guiaTitular','Neo Test');
  const envio=h.ctx.guiaEnviarCarga();
  await new Promise(r=>setTimeout(r,5));
  await h.tocar('Otra consulta');
  assert.ok(!h.del('user').includes('Otra consulta'),'ese toque no cuenta');
  suelta();await envio;
  assert.equal(h.vueltas.length,1,'y el ticket aparece igual');
});

// ── Con la charla en curso ───────────────────────────────────────────────────
test('lo que llega mientras tanto va arriba de las opciones, y si contesta una persona el menú se repliega',()=>{
  const h=abierto();
  const host=h.elements.get('messages'),accion=()=>h.elements.get('guiaAccion');
  h.ctx.addMsg('Recibimos tu mensaje','bot',null,{id:'1'});
  assert.equal(host.children[host.children.length-1],accion(),'las opciones siguen abajo de todo');
  assert.ok(h.opciones().includes('💰 Una carga'),'un automático no corta el menú');
  h.ctx.guiaCederAPersona();
  assert.deepEqual(h.opciones(),['Ver opciones']);
});
test('un mensaje viejo de un operador en el historial no le saca el menú al que vuelve',()=>{
  const h=abierto();
  h.ctx.guiaCederAPersona(new Date(Date.now()-5*864e5).toISOString());
  assert.ok(h.opciones().includes('💰 Una carga'));
  h.ctx.guiaCederAPersona(new Date().toISOString());
  assert.deepEqual(h.opciones(),['Ver opciones']);
});
test('si contesta una persona con una ficha abierta, la ficha no se pierde',async()=>{
  const h=abierto();
  await h.tocar('Una carga');await h.tocar('Quiero cargar');
  h.campo('guiaMonto','5000');
  h.ctx.guiaCederAPersona();
  assert.equal(h.elements.get('guiaMonto').value,'5000');
});
test('«?», «hola», «3000»: no le llegan al operador, vuelve el menú, y una sola vez',async()=>{
  const h=abierto();const input=h.elements.get('freeInput');
  input.value='3000';await h.ctx.sendFreeMessage();
  assert.equal(h.sent.length,0);assert.equal(input.value,'');
  assert.ok(h.dijo('Elegí una opción'));assert.ok(h.opciones().includes('💰 Una carga'));
  input.value='?';await h.ctx.sendFreeMessage();
  assert.equal(h.sent.length,1,'nadie queda atrapado: el segundo pasa');
});
// La revisión del 1/11: «5000» o «Juan Perez» pueden ser la respuesta a un operador.
test('con una conversación abierta, lo corto llega siempre',async()=>{
  const h=abierto({state:{chatId:'70',chatToken:'tok'}});const input=h.elements.get('freeInput');
  for(const t of ['5000','dale','juan.perez.mp','Juan Perez']){input.value=t;await h.ctx.sendFreeMessage();}
  assert.deepEqual(h.sent.map(s=>s.text),['5000','dale','juan.perez.mp','Juan Perez']);
});
test('una consulta escrita completa le llega a una persona y se le confirma',async()=>{
  const h=abierto();const input=h.elements.get('freeInput');
  input.value='no me deja jugar en la ruleta desde ayer';await h.ctx.sendFreeMessage();
  assert.equal(h.sent.length,1);assert.equal(input.value,'');assert.ok(h.dijo('ya le llegó a una persona'));
});
test('otra cosa: lo primero que escriba va a una persona aunque sea corto',async()=>{
  const h=abierto();const input=h.elements.get('freeInput');
  await h.tocar('Otra cosa');assert.ok(input.focused,'abre el teclado porque eligió escribir');
  input.value='un error';await h.ctx.sendFreeMessage();
  assert.equal(h.sent.length,1);
});
test('con una persona en la charla, todo lo escrito pasa',async()=>{
  const h=abierto();h.ctx.guiaCederAPersona();const input=h.elements.get('freeInput');
  input.value='ok';await h.ctx.sendFreeMessage();
  assert.equal(h.sent.length,1);
});
test('si el operador escribió antes de abrir el chat, no hay saludo ni menú encima',()=>{
  const h=harness();
  h.ctx.guiaCederAPersona(new Date().toISOString());
  h.ctx.guiaMostrar();
  assert.ok(!h.dijo('Es automático'));
  assert.deepEqual(h.opciones(),['Ver opciones']);
});
test('si el asistente falla, el jugador igual puede mandar su mensaje',async()=>{
  const h=abierto();const input=h.elements.get('freeInput');
  h.ctx.guiaFrenarFragmento=()=>{throw Error('roto');};h.ctx.guiaTrasTexto=()=>{throw Error('roto');};
  input.value='hola';await h.ctx.sendFreeMessage();
  assert.equal(h.sent.length,1);assert.equal(input.value,'');
  assert.ok(!h.del('system').length,'no dice que falló un mensaje que salió');
});
test('escribir sin usuario y terminar en validación: lo escrito igual sale',async()=>{
  const h=abierto({state:{usuario:'',telefono:''},ingreso(u,t){h.ctx.state.usuario=u;h.ctx.state.telefono=t;h.ctx.state.nivelAcceso='SOPORTE';return {acceso:false};}});
  const input=h.elements.get('freeInput');
  input.value='no me deja jugar en la ruleta';await h.ctx.sendFreeMessage();
  h.campo('guiaUsuario','prueba1');h.campo('guiaTelefono','1134567890');
  await h.ctx.guiaEnviarIngreso();
  await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(h.sent.map(s=>s.alta||s.text),['validar','no me deja jugar en la ruleta']);
});
test('escribir sin usuario no lo saca del chat ni le borra el texto, y al identificarse sale',async()=>{
  const h=abierto({state:{usuario:'',telefono:''}});const input=h.elements.get('freeInput');
  input.value='no me deja jugar en la ruleta';await h.ctx.sendFreeMessage();
  assert.deepEqual(h.navigation,[]);assert.equal(input.value,'no me deja jugar en la ruleta');
  assert.ok(h.elements.get('guiaTelefono'));
  await h.ctx.sendFreeMessage();
  assert.equal(h.messages.filter(m=>m.role==='guide').length,3,'tocar enviar otra vez no repite la pregunta');
  h.campo('guiaUsuario','prueba1');h.campo('guiaTelefono','1134567890');
  await h.ctx.guiaEnviarIngreso();
  await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(h.sent.map(s=>s.text),['no me deja jugar en la ruleta']);
});
test('el compositor mantiene texto y adjunto al fallar; recién los limpia al confirmar',async()=>{
  let fail=true;const h=abierto({send:async()=>({ok:!fail})});const input=h.elements.get('freeInput');
  input.value='Mi consulta completa de varias palabras';h.ctx.state.composerImage={type:'image/png',size:1};
  await h.ctx.sendFreeMessage();assert.equal(input.value,'Mi consulta completa de varias palabras');assert.ok(h.ctx.state.composerImage);
  fail=false;await h.ctx.sendFreeMessage();assert.equal(input.value,'');assert.equal(h.ctx.state.composerImage,null);
});

// ── Recordar y olvidar ───────────────────────────────────────────────────────
test('recargar recupera la charla y el menú, sin guardar lo que escribió en una ficha',async()=>{
  const h=abierto();await h.tocar('Una carga');await h.tocar('Quiero cargar');
  h.campo('guiaMonto','7845');h.campo('guiaTitular','dato privado');
  const size=h.messages.length;h.ctx.guiaMostrar();assert.equal(h.messages.length,size,'abrir de nuevo no repite');
  const next=abierto({storage:h.storage});
  assert.ok(next.del('user').includes('💰 Una carga'));assert.ok(next.opciones().includes('Transferí y no me apareció'));
  const guardado=[...h.storage.values()].join('');
  assert.ok(!guardado.includes('dato privado'));assert.ok(!guardado.includes('7845'));
});
test('otra cuenta, otra oficina o datos rotos empiezan de cero; identificarse en el chat no corta la charla',async()=>{
  const h=abierto();await h.tocar('Una carga');
  h.ctx.state.usuario='otra';assert.equal(h.ctx.guiaCargar().nodo,'inicio');
  const i=abierto({state:{usuario:'',telefono:''}});await i.tocar('Entrar a mi cuenta');
  i.ctx.state.usuario='nueva';assert.equal(i.ctx.guiaCargar().nodo,'cuenta');
  const r=harness({storage:new Map([['bet300_guia_v2',JSON.stringify({version:2,ruta:'ruta-1',usuario:'ana',nodo:'__proto__',burbujas:[],updatedAt:Date.now()})]])});
  r.ctx.guiaMostrar();assert.equal(r.ctx.guiaCargar().nodo,'inicio');assert.ok(r.dijo('Es automático'));
});
test('olvidar saca todo lo del asistente de la pantalla y del teléfono',async()=>{
  const h=abierto();await h.tocar('Una carga');
  h.ctx.guiaOlvidar();
  assert.equal(h.storage.has('bet300_guia_v2'),false);
  assert.equal(h.ctx.document.querySelectorAll('.guide-local').length,0);
  assert.equal(h.elements.get('guiaAccion'),undefined);
});

// ── Textos que escribió otro ─────────────────────────────────────────────────
function globoReal(){
  const nodos=[];const ctx={$:()=>({appendChild(n){nodos.push(n);}}),document:{createElement:()=>({classList:{add(){}},className:'',innerHTML:''})},scrollChat(){},now:()=>'',_fechaCorta:()=>'',
    esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'),String,JSON,RegExp};
  vm.createContext(ctx);
  for(const name of ['chatAgregar','chatHelpMessage','parseTransferCard','renderTransferCardHtml','addMsg'])vm.runInContext(source(name),ctx);
  return ctx;
}
test('un motivo o un destino con «Alias:» en el asistente sigue siendo texto, no datos para transferir',()=>{
  const n=globoReal().addMsg('Motivo: <b>Transferiste al Alias: viejo.mp, no corresponde</b>','guide',null,{local:true});
  assert.ok(!n.innerHTML.includes('transfer-card'));assert.ok(n.innerHTML.includes('viejo.mp'));
});
test('la tarjeta del operador no arma código con lo que dice el mensaje',()=>{
  const n=globoReal().addMsg("Pasame a alias: x');alert(1);//",'operator',null,{local:true});
  assert.ok(n.innerHTML.includes('transfer-card'),'la tarjeta sigue existiendo');
  assert.ok(!/onclick="copyText\('/.test(n.innerHTML),'el valor no entra al código del botón');
  assert.ok(n.innerHTML.includes('copyText(this.dataset.valor,this)'));
});
test('el Portal no depende de lo que los iPhone viejos no tienen',()=>{
  assert.ok(!PORTAL.includes('Object.hasOwn'));
});

// ── Tarjetas del operador y autoría ──────────────────────────────────────────
test('tarjetas AYUDA admiten sólo acciones permitidas y nunca las ejecutan al recibir',async()=>{
  const h=harness();const text='Ayuda ⟦AYUDA:inicio⟧ ⟦AYUDA:revisar_envio⟧ ⟦AYUDA:transferir⟧';
  const parsed=h.ctx.chatHelpMessage(text,'operator');
  assert.deepEqual([...parsed.actions],['inicio','revisar_envio']);assert.ok(parsed.text.includes('⟦AYUDA:transferir⟧'));
  assert.equal(h.ctx.chatHelpMessage(text,'user').actions.length,0);
  assert.equal(h.ctx.chatHelpMessage(text,'system').actions.length,0);
  assert.equal(h.navigation.length,0);assert.equal(h.sent.length,0);
  h.ctx.guiaAbrirTarjeta('transferir');assert.equal(h.messages.length,0);
  await h.ctx.guiaAbrirTarjeta('revisar_envio');
  assert.ok(h.dijo('No veo ninguna carga'),'las macros del panel siguen andando');
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

// ── El envío de verdad ───────────────────────────────────────────────────────
test('de punta a punta con el envío real: pedir una persona llega al canal de chat',async()=>{
  const h=abierto({realSender:true,rpc:async name=>({data:name==='landing_chat_abrir_v3'?{ok:true,chat_id:7,chat_token:'tok'}:[{ok:true,mensaje_id:101}]})});
  await h.tocar('Hablar con una persona');
  assert.deepEqual(h.rpcCalls.map(x=>x.name),['landing_portal_resolver_vinculo','landing_chat_abrir_v3','landing_enviar_mensaje_v2'],'primero la revisión de la cuenta, al abrir el chat');
  assert.equal(h.rpcCalls[2].args.p_mensaje,'Pido hablar con una persona.\nTema: una consulta.');
  assert.ok(h.dijo('Te paso con un operador'));
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

// Carlitos, 2/11: llegaban pedidos con "Tel: 111234". Alcanzaba con 6 números.
test('el teléfono tiene que tener 10 números con el código de área, en todas las entradas',()=>{
  const ctx={String};vm.createContext(ctx);vm.runInContext(source('telefonoDiezDigitos'),ctx);
  const bien={'11 2345 6789':'1123456789','1123456789':'1123456789','+54 9 11 2345-6789':'1123456789','+54 11 2345 6789':'1123456789',
    '011 2345 6789':'1123456789','0351 456 7890':'3514567890','5491123456789':'1123456789','(0221) 15-456-7890':''};
  for(const [escrito,queda] of Object.entries(bien))assert.equal(ctx.telefonoDiezDigitos(escrito),queda,escrito);
  for(const malo of ['111234','11 2345 678','1234','','11 2345 67890 1'])assert.equal(ctx.telefonoDiezDigitos(malo),'',malo);
  for(const entrada of ['ingresarJugador','pedirRegistroCon','pedirAyudaCon']){
    assert.match(source(entrada),/telefonoDiezDigitos\(telefono\)/,entrada+' usa la misma regla');
    assert.ok(!/length<6/.test(source(entrada)),entrada+': ya no alcanza con 6 números');
  }
});
