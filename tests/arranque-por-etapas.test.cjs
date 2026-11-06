const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { assemble } = require('../scripts/build-panel.cjs');

// Juan, 6/11: "debería de cargar un toque más modular, sí o sí lo que necesitamos rápido es la
// pantalla principal, que lleguen las solicitudes y los mensajes; el resto de la aplicación, si
// debe esperar, puede esperar". En una PC lenta, después del login la pantalla quedaba trabada
// ~36 s: todo salía junto, y una parte ya corría desde el login contra una oficina cualquiera.
//
// Esto corre el panel ARMADO DESDE LAS FUENTES (sin escribir renderer/generated), con un reloj
// propio y una base falsa que anota cada pedido en orden.

const RAIZ = path.join(__dirname, '..');
const noop = () => {};
const BASE = Date.UTC(2026, 10, 6, 13, 0, 0);

function reloj() {
  let ahora = 0, sec = 0;
  const cola = [], errores = [];
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  return {
    errores, settle,
    get ahora() { return ahora; },
    setTimeout(fn, ms) { const t = { id: ++sec, fn, at: ahora + Math.max(0, Number(ms) || 0), cada: 0 }; cola.push(t); return t.id; },
    setInterval(fn, ms) { const c = Math.max(1, Number(ms) || 0); const t = { id: ++sec, fn, at: ahora + c, cada: c }; cola.push(t); return t.id; },
    clear(id) { const i = cola.findIndex((t) => t.id === id); if (i >= 0) cola.splice(i, 1); },
    async avanzar(ms) {
      const fin = ahora + ms;
      for (;;) {
        await settle();
        cola.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = cola[0];
        if (!t || t.at > fin) break;
        ahora = t.at;
        if (t.cada) t.at += t.cada; else cola.shift();
        try { const r = t.fn(); if (r && typeof r.catch === 'function') r.catch((e) => errores.push(e)); }
        catch (e) { errores.push(e); }
      }
      ahora = fin;
      await settle();
    }
  };
}

function elemento(id) {
  const clases = new Set();
  return {
    id, style: {}, dataset: {}, children: [], innerHTML: '', textContent: '', value: '',
    classList: { add: (...c) => c.forEach((x) => clases.add(x)), remove: (...c) => c.forEach((x) => clases.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !clases.has(c) : f; on ? clases.add(c) : clases.delete(c); return on; },
      contains: (c) => clases.has(c) },
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop, appendChild: (x) => x, remove: noop,
    addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus: noop, getClientRects: () => [], options: []
  };
}

function panel() {
  const t = reloj();
  const pedidos = [];          // en orden: 'rpc:nombre' o 'from:tabla:select'
  const ventanas = [];         // lo que tocó la ventana de Agentes
  const anota = (x) => pedidos.push(x);
  const cadena = (tabla) => {
    let sel = '';
    const q = { then: (ok, mal) => { anota('from:' + tabla + ':' + sel); return Promise.resolve({ data: [], error: null, count: 0 }).then(ok, mal); } };
    for (const m of ['insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'or', 'order', 'limit', 'range', 'single', 'maybeSingle', 'not', 'filter', 'contains']) q[m] = () => q;
    q.select = (s) => { sel = String(s || ''); return q; };
    return q;
  };
  // Lo que se ve: sólo los nodos que el login necesita. El resto da null, como en panel-arranque.
  const nodos = new Map(['loginView', 'appView', 'operadorInfo'].map((id) => [id, elemento(id)]));
  const body = elemento('body');
  const doc = {
    getElementById: (id) => nodos.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => elemento(''), addEventListener: noop, body, head: elemento('head'),
    documentElement: elemento('html'), readyState: 'complete', hidden: false
  };
  const almacen = new Map();
  class FechaFalsa extends Date {
    constructor(...a) { if (a.length) super(...a); else super(BASE + t.ahora); }
    static now() { return BASE + t.ahora; }
  }
  const sb = {
    console: { log: noop, warn: noop, error: noop, info: noop, table: noop },
    document: doc, Date: FechaFalsa,
    localStorage: { getItem: (k) => (almacen.has(k) ? almacen.get(k) : null), setItem: (k, v) => almacen.set(k, String(v)), removeItem: (k) => almacen.delete(k), clear: () => almacen.clear() },
    sessionStorage: { getItem: () => null, setItem: noop },
    setTimeout: t.setTimeout, setInterval: t.setInterval, clearTimeout: t.clear, clearInterval: t.clear,
    navigator: { userAgent: 'node', clipboard: {} },
    fetch: () => Promise.reject(new Error('sin red en la prueba')),
    location: { href: 'file:///panel', search: '', reload: noop },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }), getComputedStyle: () => ({}),
    alert: noop, confirm: () => false, requestAnimationFrame: () => 0, innerWidth: 1400,
    Notification: function () {}, CustomEvent: function () {}, Event: function () {},
    panelAPI: {
      rpc: async (fn) => { anota('rpc:' + fn); return { data: [], error: null }; },
      getContext: async () => ({})
    },
    // La ventana de Agentes: abrirla antes de elegir el puesto es justo lo que no tiene que pasar.
    ctrlElectron: {
      openAgentWindow: async () => { ventanas.push('abrir'); },
      drexAutomation: async (m) => { ventanas.push(m); return { ok: true }; },
      navigateAgent: async () => {}, proxyApply: async () => ({ ok: true }),
      discordPresencia: async () => {}, verifyUser: async () => ({ exists: false })
    }
  };
  sb.supabase = { createClient: () => ({
    rpc: async (fn) => { anota('rpc:' + fn); return { data: [], error: null }; },
    from: cadena,
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: noop
  }) };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  const armado = assemble(RAIZ);
  const orden = [...armado.html.matchAll(/src="(renderer\/generated\/js-[a-z-]+\.js)"/g)].map((m) => m[1]);
  assert.ok(orden.length >= 20, 'el HTML tiene que declarar los bundles');
  for (const rel of orden) {
    const src = armado.assets.get(path.join(RAIZ, rel));
    assert.ok(src, 'falta ' + rel);
    new vm.Script(src, { filename: rel }).runInContext(sb, { timeout: 15000 });
  }
  async function elegirPuesto(pc) {
    vm.runInContext('operador = { usuario: "op", nombre: "op", rol: "OPERADOR" }; pcOperativa = ' + JSON.stringify(pc) + ';', sb);
    sb.pcOperativa = pc;
    sb.finalizarLogin(false);
  }
  return { sb, t, pedidos, ventanas, elegirPuesto, body };
}

const SOLICITUDES = 'rpc:panel_v15_5_listar_solicitudes_portal';
const CHATS = 'rpc:panel_core_get_chat_sesiones_json';
const BILLETERAS = 'rpc:panel_nodo_list_billeteras';
const HISTORIAL = 'from:historial_ops:*';
const datos = (p) => p.filter((x) => x.startsWith('rpc:') || x.startsWith('from:'));

test('sin puesto elegido no se pide nada de ninguna oficina ni se abre Agentes', async () => {
  const p = panel();
  // La sesión anterior dejó su oficina guardada: validacion-pc.js la copia a window.pcOperativa.
  p.sb.localStorage.setItem('nodo_pc_operativa_lite', 'P4');
  await p.t.avanzar(7 * 60 * 1000);   // siete minutos en la pantalla de login
  assert.deepEqual(datos(p.pedidos), [], 'antes del puesto no sale ningún pedido');
  assert.deepEqual(p.ventanas, [], 'ni se abre la ventana de Agentes');
});

test('con el puesto: solicitudes y chats primero y juntos; después lo demás, de a uno', async () => {
  const p = panel();
  await p.t.avanzar(5000);
  await p.elegirPuesto('P4');
  await p.t.settle();
  const primeros = datos(p.pedidos);
  assert.ok(primeros.includes(SOLICITUDES), 'las solicitudes salen enseguida: ' + primeros.join(', '));
  assert.ok(primeros.includes(CHATS), 'los chats también, sin esperar a las solicitudes');
  assert.ok(!primeros.includes(BILLETERAS) && !primeros.some((x) => x.startsWith('from:historial_ops')),
    'billeteras e historial todavía no');
  assert.deepEqual(p.ventanas, [], 'Agentes tampoco');

  await p.t.avanzar(30000);
  const todo = datos(p.pedidos);
  const i = (x) => todo.indexOf(x);
  assert.ok(i(BILLETERAS) > i(SOLICITUDES) && i(BILLETERAS) > i(CHATS), 'las billeteras llegan después del Inicio');
  assert.ok(i(HISTORIAL) > i(BILLETERAS), 'el historial, después de las billeteras');
  assert.equal(todo.filter((x) => x === HISTORIAL).length, 1, 'el historial se pide UNA vez (antes eran dos)');
  assert.ok(todo.includes('rpc:panel_titulares_bloqueados'), 'los titulares bloqueados entran en la segunda etapa');
  assert.ok(todo.includes('rpc:panel_registrar_actividad'), 'el latido sale con la oficina ya elegida');
  assert.ok(p.ventanas.length > 0, 'y recién al final se abre Agentes');
  assert.equal(typeof p.sb.nexoArrancar, 'function');
});

test('cada dato tiene un solo reloj: las solicitudes no se piden dos veces', async () => {
  const p = panel();
  await p.t.avanzar(5000);
  await p.elegirPuesto('P4');
  await p.t.avanzar(61000);
  // Una al entrar y una del reloj de 60 s. El puente del portal tenía otro reloj de 60 s propio.
  assert.equal(datos(p.pedidos).filter((x) => x === SOLICITUDES).length, 2);
  // La lista de chats: al entrar y cada 15 s (el respaldo sólo lo pide la carga de la lista).
  const p2 = panel();
  await p2.t.avanzar(5000);
  await p2.elegirPuesto('P4');
  await p2.t.avanzar(31000);
  assert.equal(datos(p2.pedidos).filter((x) => x === 'rpc:panel_v154_plus_listar_chat_sesiones').length, 3);
});

test('la conversación abierta se pide al servidor cada 5 s, con el reloj de NodoRealtime', async () => {
  const p = panel();
  await p.t.avanzar(5000);
  await p.elegirPuesto('P4');
  await p.t.avanzar(1000);
  p.sb.V154P.chatActual = '77';
  const antes = datos(p.pedidos).filter((x) => x === 'rpc:panel_core_get_chat_mensajes_json').length;
  await p.t.avanzar(10100);
  const despues = datos(p.pedidos).filter((x) => x === 'rpc:panel_core_get_chat_mensajes_json').length;
  assert.equal(despues - antes, 2, 'dos vueltas en 10 s: una sola por reloj');
});

test('un pago parcial abierto antes de que lleguen las billeteras las espera', async () => {
  const p = panel();
  await p.t.avanzar(5000);
  await p.elegirPuesto('P4');
  await p.t.settle();
  assert.ok(!datos(p.pedidos).includes(BILLETERAS), 'todavía no se pidieron');
  let abrio = 0;
  const espera = p.sb.nodoAsegurarBilleteras();
  assert.ok(espera && typeof espera.then === 'function', 'hay una carga que esperar');
  p.sb.nodoAsegurarBilleteras().then(() => { abrio++; });
  await p.t.settle();
  assert.ok(datos(p.pedidos).includes(BILLETERAS), 'el que las necesita las pide en el momento');
  assert.equal(abrio, 1);
  assert.equal(p.sb.nodoAsegurarBilleteras(), null, 'ya cargadas: no hay nada que esperar');
  // El paso de billeteras del arranque (a los 0,5 s) usa esa misma carga. La que viene después es la
  // de la sincronización con Chunior, que siempre relee al terminar.
  await p.t.avanzar(1200);
  assert.equal(datos(p.pedidos).filter((x) => x === BILLETERAS).length, 1, 'y el arranque no las vuelve a pedir');
});
