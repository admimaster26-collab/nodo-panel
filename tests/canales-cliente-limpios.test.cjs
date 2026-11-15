'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { assemble } = require('../scripts/build-panel.cjs');

const RAIZ = path.join(__dirname, '..');
const noop = () => {};
const BASE = Date.UTC(2026, 10, 9, 15, 0, 0);

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
    classList: {
      add: (...c) => c.forEach((x) => clases.add(x)),
      remove: (...c) => c.forEach((x) => clases.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !clases.has(c) : f; on ? clases.add(c) : clases.delete(c); return on; },
      contains: (c) => clases.has(c)
    },
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop, appendChild: (x) => x, remove: noop,
    addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus: noop, getClientRects: () => [], options: []
  };
}

function crearPanel(opts = {}) {
  const t = reloj();
  const pedidos = [];
  const anota = (x) => pedidos.push(x);
  const cadena = (tabla) => {
    let sel = '';
    const q = {
      then: (ok, mal) => {
        anota('from:' + tabla + ':' + sel);
        const rows = opts.fromData && opts.fromData[tabla] ? opts.fromData[tabla] : [];
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok, mal);
      }
    };
    for (const m of ['insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'or', 'order', 'limit', 'range', 'single', 'maybeSingle', 'not', 'filter', 'contains']) q[m] = () => q;
    q.select = (s) => { sel = String(s || ''); return q; };
    return q;
  };
  const nodos = new Map(['loginView', 'appView', 'operadorInfo', 'historialTable'].map((id) => [id, elemento(id)]));
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
  const responderRpc = async (fn, args) => {
    anota('rpc:' + fn);
    if (opts.rpcData && Object.hasOwn(opts.rpcData, fn)) {
      const v = opts.rpcData[fn];
      return typeof v === 'function' ? v(args) : v;
    }
    return { data: [], error: null };
  };
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
      rpc: responderRpc,
      getContext: async () => ({})
    },
    ctrlElectron: {
      openAgentWindow: async () => {},
      drexAutomation: async () => ({ ok: true }),
      navigateAgent: async () => {}, proxyApply: async () => ({ ok: true }),
      discordPresencia: async () => {}, verifyUser: async () => ({ exists: false })
    },
    nexoFile: opts.nexoFile || undefined
  };
  sb.supabase = {
    createClient: () => ({
      rpc: responderRpc,
      from: cadena,
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: noop
    })
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  const armado = assemble(RAIZ);
  const orden = [...armado.html.matchAll(/src="(renderer\/generated\/js-[a-z-]+\.js)"/g)].map((m) => m[1]);
  for (const rel of orden) {
    const src = armado.assets.get(path.join(RAIZ, rel));
    new vm.Script(src, { filename: rel }).runInContext(sb, { timeout: 15000 });
  }
  async function elegirPuesto(pc) {
    vm.runInContext('operador = { usuario: "op", nombre: "op", rol: "OPERADOR" }; pcOperativa = ' + JSON.stringify(pc) + ';', sb);
    sb.pcOperativa = pc;
    sb.finalizarLogin(false);
  }
  return { sb, t, pedidos, elegirPuesto, nodos, body };
}

test('Paso 1.1: sin #viewVerificaciones ni #badgeVerif, los relojes de 5s/10s/15s no consultan verificaciones ni validaciones_usuario', async () => {
  const p = crearPanel();
  await p.elegirPuesto('P4');
  await p.t.avanzar(60000);
  const verifCalls = p.pedidos.filter((x) => x.startsWith('from:verificaciones:') || x.startsWith('from:validaciones_usuario:'));
  assert.deepEqual(verifCalls, [], 'no debe salir ninguna consulta fantasma a verificaciones ni validaciones_usuario');
});

test('Paso 1.2: cargarHistorial no dispara las 4 RPCs del CRM salvo que el operador haya abierto la lista (_crmCargado)', async () => {
  const p = crearPanel();
  await p.elegirPuesto('P4');
  await p.t.avanzar(15000);
  const crmSinAbrir = p.pedidos.filter((x) => x === 'rpc:panel_crm_agente_resumen');
  assert.deepEqual(crmSinAbrir, [], 'sin abrir Cargar lista, cargarHistorial no pide panel_crm_agente_resumen');

  p.sb._crmCargado = true;
  await p.sb.cargarHistorial();
  await p.t.settle();
  const crmAbierto = p.pedidos.filter((x) => x === 'rpc:panel_crm_agente_resumen');
  assert.equal(crmAbierto.length, 1, 'con _crmCargado activo, cargarHistorial refresca el resumen del CRM');
});

test('Paso 1.3: nexoSync verifica nexoFile.estado() antes de bajar 8.000 filas de historial_ops', async () => {
  let escrituras = 0;
  const p = crearPanel({
    fromData: { historial_ops: [{ id: 1, usuario: 'demo', monto: 1000, pc_codigo: 'P4' }] },
    nexoFile: {
      estado: async () => ({ instalado: false, path: 'C:\\fake\\nodo-sync.json' }),
      write: async () => { escrituras++; return { ok: true }; }
    }
  });
  p.sb.pcOperativa = 'P4';
  p.PedidosAntes = p.pedidos.length;
  await p.sb.nexoSync(false);
  const nuevos = p.pedidos.slice(p.PedidosAntes);
  assert.deepEqual(
    nuevos.filter((x) => x.startsWith('from:historial_ops:')),
    [],
    'si Nexo no está instalado en la PC, nexoSync no descarga historial_ops'
  );
  assert.equal(escrituras, 0);
});

test('Paso 1.4: la lista de chats pide panel_core_get_chat_sesiones_json una sola vez por vuelta y la comparte con _chatCanalNuevo', async () => {
  const ahoraIso = new Date(BASE).toISOString();
  const p = crearPanel({
    rpcData: {
      panel_core_get_chat_sesiones_json: () => ({
        data: [{ chat_id: 'c-1', usuario: 'jugador1', estado: 'ABIERTO', ultimo_mensaje: 'hola', updated_at: ahoraIso }],
        error: null
      })
    }
  });
  await p.elegirPuesto('P4');
  await p.t.avanzar(31000); // arranque (0s) + 15s + 30s = 3 vueltas
  const llamadasSesiones = p.pedidos.filter((x) => x === 'rpc:panel_core_get_chat_sesiones_json');
  assert.equal(llamadasSesiones.length, 3, 'una sola llamada por vuelta de 15 s (antes eran 6 en 30 s)');
  const ticketsCanal = p.sb._chatCanalNuevo.tickets(false);
  assert.equal(ticketsCanal.length, 1, '_chatCanalNuevo recibe las sesiones de esa misma lectura');
  assert.equal(ticketsCanal[0].usuario, 'jugador1');
});

test('Paso 5 (Portal): corta el reloj de historial fuera de Estado, anota ingresos con respaldo legacy y no duplica solicitudes', () => {
  const fs = require('node:fs');
  const portalSrc = fs.readFileSync(path.join(RAIZ, 'Portal'), 'utf8');
  assert.match(portalSrc, /if\(name!=="estado"\)\{try\{stopHistPoll\(\);\}catch\(_e\)\{\}\}/, 'showScreen corta stopHistPoll al salir de Estado');
  assert.ok(!portalSrc.includes('rpc("landing_crear_solicitud_v3_blindado"'), 'sin segunda escritura v3_blindado que duplique pedidos');
  assert.ok(!portalSrc.includes('rpc("landing_crear_chat_v2_blindado"'), 'sin tercera escritura chat_v2_blindado que deje solicitudes fantasma');
  assert.match(portalSrc, /landing_portal_ingreso_v1.*p_origen:"FORMULARIO"/, 'ingresarJugador usa landing_portal_ingreso_v1 con respaldo legacy');
  assert.match(portalSrc, /landing_portal_ingreso_v1.*p_origen:"CORREGIDO"/, 'confirmarIngresoValidado usa landing_portal_ingreso_v1 con respaldo legacy');
  assert.match(portalSrc, /landing_portal_ingreso_v1.*p_origen:"REINTENTO"/, 'reintentarValidacion usa landing_portal_ingreso_v1 con respaldo legacy');
});

test('Paso 3 (Canales por oficina): prevalidar, ingresos y revisiones usan nodo_beta_*_v1 si la oficina los anuncia y caen al camino viejo si no', async () => {
  // 1) Oficina sin beta (legacy): nodoPrevalidarConsultar usa panel_prevalidar_usuario y no muestra pestañas nuevas
  const pLeg = crearPanel({
    rpcData: {
      panel_prevalidar_usuario: () => ({ data: { ok: true, veredicto: 'LIBRE', motivos: [], cuentas: [] }, error: null })
    }
  });
  await pLeg.elegirPuesto('P4');
  const prevLeg = await pLeg.sb.nodoPrevalidarConsultar('1144445555', 'pepe', 'P4');
  assert.equal(prevLeg.data.veredicto, 'LIBRE');
  assert.ok(pLeg.pedidos.includes('rpc:panel_prevalidar_usuario'), 'sin capacidad beta usa panel_prevalidar_usuario');
  assert.ok(!pLeg.pedidos.includes('rpc:nodo_beta_prevalidar_v1'));
  assert.equal(pLeg.sb.crmRxTabsExtra('cola'), '', 'sin capacidad beta no agrega pestañas de Ingresos ni Revisiones');

  // 2) Oficina con beta activa y capacidades anunciadas (ej. P1)
  const pBeta = crearPanel({
    rpcData: {
      nodo_beta_capacidades_v1: () => ({
        data: {
          ok: true,
          contract: 'nodo.beta.v1',
          scope: { pc_codigo: 'P1' },
          capabilities: ['ingresos.v1', 'revisiones.v1', 'prevalidar.v1', 'health.v2']
        },
        error: null
      }),
      nodo_beta_prevalidar_v1: () => ({
        data: {
          ok: true,
          contract: 'prevalidar.v1',
          pc_codigo: 'P1',
          veredicto: 'YA_EXISTE',
          motivos: [{ nivel: 'ALTO', texto: 'Ese teléfono ya tiene 1 usuario(s) en esta oficina.' }],
          cuentas: [{ usuario: 'pepe', estado: 'VINCULADO', misma_oficina: true }]
        },
        error: null
      }),
      nodo_beta_ingresos_v1: () => ({
        data: {
          ok: true,
          contract: 'ingresos.v1',
          pc_codigo: 'P1',
          dias: 7,
          resumen: { pedidos: 2, corrigieron: 1, operan: 0, validados: 0, es_otro_usuario: 0, otro_telefono: 0, bloqueados: 0, en_curso: 0, esperando: 1, abandonos: 0, vinculos_pendientes: 1, vinculos_pendientes_opera: 0 },
          casos: [{ usuario: 'nuevo1', telefonos: ['…1111'], resultado: 'ESPERANDO', respuestas: ['NO_REGISTRADO'], veces: 1, ultima: new Date(BASE).toISOString() }],
          pendientes: [{ usuario: 'pend1', dias: 3, opera: false, otro_usuario: null }]
        },
        error: null
      }),
      nodo_beta_revisiones_v1: () => ({
        data: {
          ok: true,
          contract: 'revisiones.v1',
          pc_codigo: 'P1',
          items: [{ clave: 'VALIDACION_PENDIENTE', grupo: 'Usuarios', titulo: 'Pendientes de validación', explicacion: 'Pidieron entrar y no están validados.', cantidad: 2, nivel: 'MEDIO', ejemplos: [{ usuario: 'pend1', dato: '3 días' }] }]
        },
        error: null
      })
    }
  });
  pBeta.sb.panelAPI.getContext = async () => ({ beta: { enabled: true, offices: ['P1'], build: 'test' } });
  await pBeta.elegirPuesto('P1');

  const prevBeta = await pBeta.sb.nodoPrevalidarConsultar('1122223333', null, 'P1');
  assert.equal(prevBeta.data.veredicto, 'YA_EXISTE');
  assert.equal(prevBeta.data.cuentas[0].pc, 'P1');
  assert.ok(pBeta.pedidos.includes('rpc:nodo_beta_prevalidar_v1'), 'con prevalidar.v1 usa nodo_beta_prevalidar_v1');
  assert.ok(!pBeta.pedidos.includes('rpc:panel_prevalidar_usuario'), 'no toca panel_prevalidar_usuario de 259k filas');

  const ing = await pBeta.sb.crmCargarIngresos(true);
  const rev = await pBeta.sb.crmCargarRevisiones(true);
  assert.equal(ing.resumen.esperando, 1);
  assert.equal(rev.items[0].cantidad, 2);

  const tabsHtml = pBeta.sb.crmRxTabsExtra('ing');
  assert.match(tabsHtml, /Ingresos.*<b>2<\/b>/);
  assert.match(tabsHtml, /Revisiones.*<b>1<\/b>/);

  // El semáforo registra las 3 ramas nuevas en castellano
  pBeta.sb._crmCargado = true;
  await pBeta.sb.cargarOperacionesAgente(true);
  const partes = pBeta.sb.NodoSalud.resumen().partes;
  assert.equal(partes.find((x) => x.nombre === 'CRM')?.estado, 'anda');
  assert.equal(partes.find((x) => x.nombre === 'Ingresos al Portal')?.estado, 'anda');
  assert.equal(partes.find((x) => x.nombre === 'Revisiones')?.estado, 'anda');
});

