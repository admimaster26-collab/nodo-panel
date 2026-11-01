const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Una conversación, UNA solicitud.
//
// landing_portal_v16_crear_solicitud no devuelve chat_id ni chat_token, y el portal los tomaba
// sólo de ahí. Entonces state.chatId quedaba vacío para siempre y CADA mensaje del jugador volvía
// a crear una solicitud. El 1/10, un solo reclamo dejó 25 ("Borrame", "Jo", "Ko", "No"...). Así se
// juntaron 3.925 consultas abiertas en la red, la más vieja del 21 de julio — y de ahí salen la
// bandeja de 427 kB, los chats contestados que reaparecen y el icono de sin leer titilando.
//
// Estas pruebas EJECUTAN el código real del Portal con una base falsa.

const PORTAL = fs.readFileSync(process.env.PORTAL_A_PROBAR || path.join(__dirname, '..', 'Portal'), 'utf8');
const NL = String.fromCharCode(10);

function sacar(firma){
  const i = PORTAL.indexOf(firma);
  assert.notEqual(i, -1, 'no está en el Portal: ' + firma);
  const j = PORTAL.indexOf('{', i);
  let n = 0, fin = -1;
  for(let k = j; k < PORTAL.length; k++){
    if(PORTAL[k] === '{') n++;
    else if(PORTAL[k] === '}'){ n--; if(!n){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1, 'no cierra: ' + firma);
  // Desde la firma misma. Buscar hacia atrás la palabra "function" se traía la función ANTERIOR
  // cuando la firma empieza con "async", y el pedazo extraído compilaba igual — la prueba parecía
  // andar midiendo otra cosa.
  return PORTAL.slice(i, fin);
}

// Base falsa que se comporta como la de verdad: crear_solicitud NO devuelve el token (igual que en
// producción), crear_chat_v2_blindado SÍ, y enviar_mensaje_v2 exige los dos.
function armar({ chatRota = false, chatAusente = false, envioRoto = false } = {}){
  const llamadas = [];
  let proximaSolicitud = 1000;
  const ctx = {
    console: { warn(){}, log(){} },
    localStorage: { _m:new Map(), getItem(k){ return this._m.has(k)?this._m.get(k):null; },
                    setItem(k,v){ this._m.set(String(k),String(v)); }, removeItem(k){ this._m.delete(String(k)); } },
    location: { host: 'vip.portal-bet-300.com' },
    state: { usuario:'scarymovie871', telefono:'1140388784', pcCodigo:'P4',
             publicCode:'rt-z9p42', chatId:'', chatToken:'' },
    normalize: (d) => (Array.isArray(d) ? d[0] : d),
    billeteraPayloadPlano: () => ({}),
    _marcaDeTiempo: () => ({}),
    addMsg(){}, startChatPoll(){}, startPortalThreadPoll(){},
    Number, String, Object,
    async rpc(nombre, args){
      llamadas.push({ nombre, args });
      if(nombre === 'landing_portal_v16_crear_solicitud'){
        const id = ++proximaSolicitud;
        // Tal cual produccion: ni chat_id ni chat_token.
        return { data: { ok:true, id, solicitud_id:id, estado:'PENDIENTE' } };
      }
      if(nombre === 'landing_chat_abrir_v3'){
        if(chatAusente)return {error:{code:'PGRST202',message:'landing_chat_abrir_v3 not found'}};
        if(chatRota) return { error: { message: 'no se pudo' } };
        // Tal cual la de produccion: ok, y `nueva` para saber si abrio una o reuso la de ESTA
        // consulta. Nunca la del jugador.
        return { data: { ok: true, chat_id: 77, chat_token: 'tok-77', nueva: true } };
      }
      if(nombre === 'landing_enviar_mensaje_v2'){
        if(envioRoto)return {error:{code:'TIMEOUT',message:'respuesta perdida'}};
        if(!args.p_chat_id || !args.p_chat_token) return { error:{ message:'Chat no autorizado' } };
        return { data: { ok:true, mensaje:'Mensaje enviado', mensaje_id: 1 } };
      }
      return { data: null };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(sacar('async function enviarMensajeSoporte('), ctx);
  const creadas = () => llamadas.filter(x => x.nombre === 'landing_portal_v16_crear_solicitud').length;
  const enviados = () => llamadas.filter(x => x.nombre === 'landing_enviar_mensaje_v2').length;
  return { ctx, llamadas, creadas, enviados };
}

test('una consulta va al CANAL DE CHAT, no crea solicitud', async () => {
  // Era lo que faltaba de lo que pidio Juan: redirigir la pagina nueva a los canales que
  // corresponden. Las cargas y retiros ya iban a solicitudes; el chat seguia creando una.
  const c = armar();
  await c.ctx.enviarMensajeSoporte('hola, una consulta');
  assert.equal(c.creadas(), 0, 'NINGUNA solicitud: la consulta no es una solicitud');
  assert.equal(c.enviados(), 1, 'el mensaje va al canal de chat');
  const abrio = c.llamadas.find(x => x.nombre === 'landing_chat_abrir_v3');
  assert.ok(abrio, 'y antes abre la conversacion');
  assert.equal(abrio.args.p_solicitud_id, null, 'sin solicitud atada: es un chat, no una solicitud');
});

test('cinco mensajes = una conversacion, cero solicitudes', async () => {
  const c = armar();
  for(const t of ['Tengo varios usuarios','Y se mezclan','Borrame','Jo','Ko'])
    await c.ctx.enviarMensajeSoporte(t);
  assert.equal(c.creadas(), 0, 'cero solicitudes');
  assert.equal(c.enviados(), 5, 'los cinco al mismo chat');
  const aperturas = c.llamadas.filter(x => x.nombre === 'landing_chat_abrir_v3').length;
  assert.equal(aperturas, 1, 'y UNA sola conversacion, no cinco');
});

test('el chat se guarda en el telefono: no se pierde al recargar', async () => {
  const c = armar();
  await c.ctx.enviarMensajeSoporte('hola');
  assert.equal(c.ctx.localStorage.getItem('bet300_chat_id'), '77');
  assert.equal(c.ctx.localStorage.getItem('bet300_chat_token'), 'tok-77');
});

test('un error ambiguo al abrir conserva el mensaje y no crea otra solicitud', async () => {
  const c = armar({ chatRota: true });
  const result=await c.ctx.enviarMensajeSoporte('hola');
  assert.equal(result.ok,false);
  assert.equal(c.creadas(),0);
  assert.equal(c.enviados(),0);
});

test('función de apertura ausente permite una única escritura legacy',async()=>{
  const c=armar({chatAusente:true});
  const result=await c.ctx.enviarMensajeSoporte('hola');
  assert.equal(result.ok,true);assert.equal(c.creadas(),1);assert.equal(c.enviados(),0);
  assert.equal(result.message_id,null,'un ID de solicitud no identifica un mensaje');
});

test('timeout tras enviar no repite el mensaje como solicitud',async()=>{
  const c=armar({envioRoto:true});
  const result=await c.ctx.enviarMensajeSoporte('hola');
  assert.equal(result.ok,false);assert.equal(c.enviados(),1);assert.equal(c.creadas(),0);
});

test('éxito devuelve el ID confirmado para asociar el visto al globo exacto',async()=>{
  const c=armar();const result=await c.ctx.enviarMensajeSoporte('hola');
  assert.equal(result.message_id,1);assert.equal(result.chat_id,'77');
});

test('no se manda nada vacio', async () => {
  const c = armar();
  await c.ctx.enviarMensajeSoporte('');
  await c.ctx.enviarMensajeSoporte('   ');
  assert.equal(c.llamadas.length, 0);
});

test('cada consulta abre un chat NUEVO, no reutiliza el del jugador', () => {
  assert.ok(PORTAL.includes('landing_chat_abrir_v3'), 'el portal usa la nueva');
  assert.ok(!PORTAL.includes('landing_crear_chat_v2_blindado", {'), 'y no la vieja');
});
