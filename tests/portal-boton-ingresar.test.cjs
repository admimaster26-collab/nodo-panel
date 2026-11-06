const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// El botón "Ingresar" que manda el operador se muestra SIEMPRE.
//
// Juan, 3/10: "deberia de mostrarse igual, no tiene sentido que este el bloqueo".
//
// La página lo escondía cuando se creía que el jugador ya estaba adentro. El problema es
// justamente cuando se lo cree y no lo está: marcado de una sesión anterior, de otra oficina, o
// de un dato viejo. Ahí el jugador ve que no le aparece la billetera Y se queda sin el único
// botón que lo destraba. Que sobre un botón no le rompe nada a nadie; que falte, sí.

const PORTAL = fs.readFileSync(process.env.PORTAL_A_PROBAR || path.join(__dirname, '..', 'Portal'), 'utf8');

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
  return PORTAL.slice(i, fin);
}

// Pantalla de mentira: alcanza con saber si el botón se agregó o no.
function armar(nivelAcceso){
  const agregados = [];
  const nodo = () => ({ className:'', innerHTML:'', closest(){ return null; } });
  const ctx = {
    state: { usuario:'joelgoat', nivelAcceso: nivelAcceso, screen:'chat' },
    document: { createElement(){ return nodo(); } },
    $: (id) => {
      if(id === 'messages') return { appendChild(n){ agregados.push(n); } };
      if(id === 'btnIngresarValidado') return null;      // todavía no hay ninguno puesto
      if(id === 'widget') return { classList:{ contains(){ return true; } } };
      return null;
    },
    esc: (s) => String(s==null?'':s),
    now: () => '12:00',
    scrollChat(){}, bumpUnread(){}, showOperatorBubble(){},
    String, Object
  };
  vm.createContext(ctx);
  vm.runInContext(sacar('function chatAgregar('), ctx);
  vm.runInContext(sacar('function mostrarBotonIngresar('), ctx);
  return { ctx, seDibujo: () => agregados.length > 0 };
}

test('el jugador que NO esta adentro recibe el boton', () => {
  const c = armar('SOPORTE');
  c.ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.ok(c.seDibujo(), 'es el caso de siempre: tiene que aparecer');
});

test('el que la pagina CREE que ya esta adentro, tambien', () => {
  // Este es el que fallaba. Si ese "OK" esta mal —sesion vieja, otra oficina, dato viejo— el
  // jugador no ve la billetera y encima no le aparece el boton que lo arregla.
  const c = armar('OK');
  c.ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.ok(c.seDibujo(), 'el operador lo mando: se muestra');
});

test('sin nivel de acceso guardado, tambien', () => {
  const c = armar('');
  c.ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.ok(c.seDibujo());
});

test('no se duplica si ya hay uno puesto', () => {
  const agregados = [];
  const ctx = {
    state: { usuario:'joelgoat', nivelAcceso:'SOPORTE', screen:'chat', _ingresarUserShown:'joelgoat' },
    document: { createElement: () => ({ className:'', innerHTML:'', closest(){ return null; } }) },
    $: (id) => {
      if(id === 'messages') return { appendChild(n){ agregados.push(n); } };
      if(id === 'btnIngresarValidado') return { closest(){ return null; } };  // ya hay uno
      if(id === 'widget') return { classList:{ contains(){ return true; } } };
      return null;
    },
    esc: (s) => String(s==null?'':s), now: () => '12:00',
    scrollChat(){}, bumpUnread(){}, showOperatorBubble(){}, String, Object
  };
  vm.createContext(ctx);
  vm.runInContext(sacar('function mostrarBotonIngresar('), ctx);
  ctx.mostrarBotonIngresar('joelgoat', '1158956858');
  assert.equal(agregados.length, 0, 'uno solo alcanza');
});

// Juan, 2/11: el botón confiaba en el operador aunque el servidor dijera que la cuenta no figura.
// El jugador quedaba "adentro", veía la cuenta, transfería y el servidor le rechazaba la carga.
function ingresar(veredicto, extra){
  const storage = new Map(Object.entries((extra && extra.storage) || {}));
  const hechos = { toasts:[], enviados:[], home:0, chat:0, dijo:[], corrio:[] };
  const boton = { disabled:false, textContent:'Ingresar ›' };
  const ctx = {
    state: { usuario:'joelgoat', telefono:'1158956858', pcCodigo:'P1', nivelAcceso:'SOPORTE', motivoSoporte:'x' },
    localStorage: { getItem:k=>storage.has(k)?storage.get(k):null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k) },
    $: (id) => id === 'btnIngresarValidado' ? boton : null,
    async rpc(){ return veredicto === null ? { data:null, error:{ message:'sin señal' } } : { data:{ verdict:veredicto, mensaje:'no figura' } }; },
    normalize: d => d,
    toast: t => hechos.toasts.push(t),
    async enviarMensajeSoporte(t){ hechos.enviados.push(t); return { ok:true }; },
    mostrarMensajePropio(){},
    toggleWidget(){}, goHome(){ hechos.home++; }, goChat(){ hechos.chat++; },
    guiaDecir: t => hechos.dijo.push(t),
    guiaCorrer: p => { hechos.corrio.push(p); },
    GUIA_DESPUES: { carga: function carga(){} },
    String, Object, JSON, Date, Number
  };
  vm.createContext(ctx);
  vm.runInContext(PORTAL.match(/const VINCULO_OPERA=.*/)[0] + '\n' + PORTAL.match(/const VINCULO_NO_OPERA=.*/)[0], ctx);
  vm.runInContext(sacar('function despuesDeValidar('), ctx);
  vm.runInContext(sacar('function despuesPendiente('), ctx);
  vm.runInContext(sacar('async function confirmarIngresoValidado('), ctx);
  return { ctx, hechos, storage, boton };
}

test('Ingresar no deja adentro a quien el servidor dice que no figura, y le avisa al operador una vez', async () => {
  const c = ingresar('NO_REGISTRADO');
  await c.ctx.confirmarIngresoValidado('joelgoat', '1158956858');
  assert.equal(c.ctx.state.nivelAcceso, 'SOPORTE', 'no se lo marca habilitado');
  assert.equal(c.hechos.home, 0);
  assert.equal(c.hechos.enviados.length, 1, 'el operador se entera');
  assert.equal(c.boton.disabled, false, 'puede volver a probar');
  await c.ctx.confirmarIngresoValidado('joelgoat', '1158956858');
  assert.equal(c.hechos.enviados.length, 1, 'una sola vez');
});

test('Ingresar sin señal confía en el operador, como antes: el servidor controla al recibir el pedido', async () => {
  const c = ingresar(null);
  await c.ctx.confirmarIngresoValidado('joelgoat', '1158956858');
  assert.equal(c.ctx.state.nivelAcceso, 'OK');
  assert.equal(c.hechos.home, 1);
});

test('si venía a cargar cuando le faltaba validar, Ingresar lo lleva a la carga', async () => {
  const c = ingresar('ACCESO', { storage: { bet300_despues_validar: JSON.stringify({ que:'carga', at:Date.now() }) } });
  await c.ctx.confirmarIngresoValidado('joelgoat', '1158956858');
  assert.equal(c.ctx.state.nivelAcceso, 'OK');
  assert.equal(c.hechos.chat, 1, 'se queda en el chat');
  assert.equal(c.hechos.home, 0);
  assert.equal(c.hechos.corrio[0].name, 'carga', 'y sigue con la carga');
  assert.equal(c.storage.has('bet300_despues_validar'), false);
});
