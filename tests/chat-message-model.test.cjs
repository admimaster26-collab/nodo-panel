const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Message = require('../renderer/chat/message-model.js');

test('distingue autores actuales y antiguos sin convertir al usuario NODO en un bot', () => {
  for(const m of [
    { origen:'OPERADOR', auto:true },
    { origen:'OPERADOR', operador:'NODO' },
    { tipo_emisor:'BOT', emisor:'asistente' },
    { tipo:'TEXTO', emisor:'BOT' },
    { TIPO_EMISOR:'OPERADOR', METADATA:'{"auto":true}' },
    { auto:true }
  ]) assert.equal(Message.role(Message.normalize(m)), 'BOT');
  assert.equal(Message.role({ origen:'USUARIO', usuario:'NODO', emisor:'NODO', auto:true }), 'USUARIO');
  assert.equal(Message.role({ origen:'OPERADOR', operador:'Ana' }), 'OPERADOR');
  assert.equal(Message.role(Message.normalize({tipo:'TEXTO',tipo_emisor:'OPERADOR',emisor:'Ana'})), 'OPERADOR');
  assert.equal(Message.role(Message.normalize({tipo:'TEXTO',emisor:'OPERADOR'})), 'OPERADOR');
  assert.equal(Message.normalize({tipo:'TEXTO',tipo_emisor:'OPERADOR'}).tipo, 'TEXTO');
  assert.equal(Message.author({ origen:'OPERADOR', operador:'Ana' }), 'Operador · Ana');
  assert.equal(Message.role({ tipo_emisor:'SISTEMA', emisor:'NODO' }), 'SISTEMA');
});

test('normalizar conserva fecha original, metadatos, id, tipo, auto, caso y edición', () => {
  const original = { id:12, origen:'OPERADOR', tipo:'OPERADOR', operador:'NODO', auto:true,
    auto_caso:'ESTADO_CARGA', fecha:'2026-10-11T09:45:00.000Z', mensaje:'En revisión', editado:true,
    metadata:{ accion:'revisar_envio' } };
  const result = Message.normalize(original);
  for(const k of Object.keys(original)) assert.deepEqual(result[k], original[k], k);
  assert.equal(Message.normalize({ mensaje:'Sin fecha' }).fecha, '', 'no inventar una fecha actual');
  assert.notEqual(Message.key(original), Message.key({ ...original, auto:false, operador:'Ana' }),
    'el mismo texto del bot y del operador son dos mensajes distintos');
  const merged=Message.merge(Message.normalize({...original,solicitud_id:55}),Message.normalize({origen:'OPERADOR',operador:'NODO',fecha:original.fecha,mensaje:original.mensaje}));
  assert.equal(merged.auto,true);
  assert.equal(merged.auto_caso,'ESTADO_CARGA');
  assert.equal(merged.solicitud_id,55,'el fallback local vacío no borra la referencia del servidor');
});

function entorno(){
  const noop=()=>{};
  const elements = new Map();
  const node=()=>({ value:'', innerHTML:'', textContent:'', style:{}, scrollHeight:100, scrollTop:100,
    clientHeight:100, classList:{ add:noop, remove:noop, contains:()=>false }, appendChild:noop,
    insertBefore:noop, focus:noop, dispatchEvent:noop, addEventListener:noop });
  for(const id of ['chatBody','v15ChatBody','chatTitulo','chatSubtitulo','v15ChatTitulo','v15ChatSubtitulo','chatInput','v15ChatInput']) elements.set(id,node());
  const storage=new Map();
  const ctx={ NodoChatMessage:Message, console, document:{
    getElementById:id=>elements.get(id)||null, createElement:node, head:node(), body:node(),
    querySelector:()=>null, addEventListener:noop
  }, localStorage:{ getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v) },
    setTimeout:noop, setInterval:noop, Event:function(){}, alert:noop, toast:noop,
    V154P:{ solicitudes:[] }, escapeHtml:s=>String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])) };
  ctx.window=ctx;
  vm.createContext(ctx);
  const load=file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..','renderer','chat',file),'utf8'),ctx);
  return { ctx, elements, load };
}

test('el render vigente conserva autores y edición en ambos chats y no permite editar bots', () => {
  const env=entorno(), {ctx,elements}=env;
  env.load('chat-hilos.js');
  const fecha='2026-10-11T09:45:00.000Z';
  const hilo=[
    { origen:'USUARIO', usuario:'ana', mensaje:'Ayuda', fecha, solicitud_id:1 },
    { origen:'OPERADOR', operador:'NODO', auto:true, auto_caso:'SALUDO', mensaje:'Elegí una opción', fecha:'2026-10-11T09:46:00.000Z' },
    { origen:'OPERADOR', operador:'Noelia', mensaje:'Ya lo reviso', fecha:'2026-10-11T09:47:00.000Z', editado:true },
    { origen:'SISTEMA', mensaje:'Consulta abierta', fecha:'2026-10-11T09:48:00.000Z' }
  ];
  ctx.V154P.solicitudes=[{ ID:1, TIPO:'SOPORTE', ESTADO:'EN_REVISION', USUARIO:'ana',
    FECHA_CREACION:fecha, MENSAJE_INICIAL:'Ayuda', METADATA:{ chat_thread:hilo } }];
  ctx.__nodoChatCurrentTicket={ usuario:'ana', masterId:1 };
  ctx.renderChatMensajes();
  const html=elements.get('chatBody').innerHTML;
  assert.equal(html,elements.get('v15ChatBody').innerHTML);
  assert.match(html,/wq2-row bot/); assert.match(html,/Asistente automático/);
  assert.match(html,/Operador · Noelia/); assert.match(html,/wq2-row system/);
  assert.equal((html.match(/title="Editar este mensaje/g)||[]).length,1);
  assert.match(html,/· editado/); assert.match(html,/2026-10-11T09:46:00.000Z/);
  const bot=ctx.ticketsAgrupados()[0].thread.find(m=>m.auto);
  assert.equal(bot.auto_caso,'SALUDO');
  let opened=0; ctx.abrirModal=()=>opened++;
  ctx.editarMensajeOperador('2026-10-11T09:46:00.000Z');
  assert.equal(opened,0);
});

test('las ayudas preparan borradores en el input correcto sin enviar ni borrar el existente', () => {
  const env=entorno(), {ctx,elements}=env;
  let sent=0; ctx.enviarChat=()=>sent++;
  env.load('chat-macros.js');
  elements.get('chatInput').value='Mi borrador';
  ctx.nodoMacroRapida('ayuda_inicio');
  assert.match(elements.get('chatInput').value,/^Mi borrador\n/);
  assert.match(elements.get('chatInput').value,/⟦AYUDA:inicio⟧/);
  ctx.nodoMacroRapida('ayuda_envio','v15ChatInput');
  assert.match(elements.get('v15ChatInput').value,/⟦AYUDA:revisar_envio⟧/);
  assert.ok(!elements.get('chatInput').value.includes('revisar_envio'));
  ctx.v15InsertarMacro('Otra respuesta');
  assert.match(elements.get('v15ChatInput').value,/Otra respuesta$/);
  assert.equal(sent,0);
});

test('Inicio envía su borrador aun cuando existe otro borrador en el chat principal', async () => {
  const env=entorno(), {ctx,elements}=env;
  env.load('chat-hilos.js');
  const fecha='2026-10-11T09:45:00.000Z';
  ctx.V154P.solicitudes=[{ ID:1, TIPO:'SOPORTE', ESTADO:'EN_REVISION', USUARIO:'ana', FECHA_CREACION:fecha, MENSAJE_INICIAL:'Ayuda', METADATA:{} }];
  ctx.__nodoChatCurrentTicket={ usuario:'ana', masterId:1 };
  elements.get('chatInput').value='Borrador principal';
  elements.get('v15ChatInput').value='Respuesta desde Inicio ⟦AYUDA:inicio⟧';
  let saved;
  ctx.actualizarSolicitudPortal=async (id,estado,meta)=>{saved=meta;};
  const result=await ctx.v15EnviarChatCompacto();
  assert.equal(result.ok,true);
  assert.equal(elements.get('v15ChatInput').value,'');
  assert.equal(elements.get('chatInput').value,'Borrador principal');
  assert.ok(saved.chat_thread.some(m=>m.mensaje==='Respuesta desde Inicio ⟦AYUDA:inicio⟧'));
});
