const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parciales = require('../renderer/domain/parciales');
const requestsView = require('../renderer/portal/requests-view');

// Los números de la pantalla tienen que decir lo mismo.
//
// Juan, 25/10: al tomar una solicitud se va a 💸 En proceso. La lista de Inicio ya contaba sólo lo
// que nadie tocó, pero el cartel amarillo ("Hay N solicitudes pendientes") y el número del menú
// lateral seguían contando también las tomadas — y como el número del menú se repinta DESPUÉS de la
// lista, ganaba el viejo. Todo se prueba corriendo el código de verdad.

const RAIZ = path.join(__dirname, '..', 'renderer');
const S = (id, tipo, estado, extra) => Object.assign({
  ID: id, TIPO: tipo, ESTADO: estado, USUARIO: 'user' + id, MONTO_DECLARADO: 5000
}, extra || {});

// La función compartida, la del módulo real.
function sinTocarDe(extraWindow) {
  const window = Object.assign({
    NodoDomain: { parciales },
    _retiroParcialInfo: () => ({ hasProg: false, total: 0, pagado: 0, restante: 0 }),
    _colaCargaEstado: {}
  }, extraWindow || {});
  const api = requestsView.create({
    V154P: { solicitudes: [] }, document: { getElementById: () => null }, esc: String,
    estadoCerrado: () => false, fecha: () => '', money: String, renderHistorialUnificado: () => {}, window
  });
  return api.globals.nodoSolicitudesSinTocar;
}

test('la cuenta compartida deja afuera lo tomado', () => {
  const sinTocar = sinTocarDe();
  const r = sinTocar([S(1, 'CARGA', 'PENDIENTE'), S(2, 'CARGA', 'EN_REVISION'), S(3, 'RETIRO', 'EN_REVISION'), S(4, 'RETIRO', 'PENDIENTE')]);
  assert.deepEqual(r.map((s) => s.ID), [1, 4]);
});

test('la tomada que está en la cola de carga sigue contando: se ve en la lista', () => {
  const sinTocar = sinTocarDe({ _colaCargaEstado: { '2': { estado: 'espera', pos: 1, cid: 'c' } } });
  assert.deepEqual(sinTocar([S(2, 'CARGA', 'EN_REVISION')]).map((s) => s.ID), [2]);
});

test('si la cuenta falla, devuelve todo: nunca esconde una solicitud', () => {
  const sinTocar = sinTocarDe({ NodoDomain: { parciales: { enProceso: () => { throw new Error('x'); }, repartirAbiertas: () => { throw new Error('boom'); } } } });
  assert.equal(sinTocar([S(1, 'CARGA', 'EN_REVISION'), S(2, 'CARGA', 'PENDIENTE')]).length, 2);
});

test('sin el módulo de reparto, devuelve todo', () => {
  const sinTocar = sinTocarDe({ NodoDomain: {} });
  assert.equal(sinTocar([S(1, 'CARGA', 'EN_REVISION')]).length, 1);
});

// ── el número del menú lateral ──────────────────────────────────────────────────────────────
function armarMenu(solicitudes, conCuentaCompartida, silencioso) {
  const fuente = fs.readFileSync(path.join(RAIZ, 'core', 'avisos-y-watchdog.js'), 'utf8');
  const i = fuente.indexOf('function verificarSolicitudes(');
  const j = fuente.indexOf('function verificarChats(');
  assert.notEqual(i, -1);
  assert.notEqual(j, -1);
  const badge = { texto: '', oculto: true, innerText: '', classList: { add() { badge.oculto = true; }, remove() { badge.oculto = false; } } };
  const avisos = [];
  const window = conCuentaCompartida ? { nodoSolicitudesSinTocar: sinTocarDe() } : {};
  const ctx = {
    window, solicitudes, lastPendientesIds: new Set(), Set, String,
    document: { getElementById: () => badge },
    esPendiente: (s) => /PENDIENTE|EN_REVISION/.test(s.ESTADO),
    toast: (m) => avisos.push(m), sonido: () => avisos.push('sonido')
  };
  vm.createContext(ctx);
  vm.runInContext(fuente.slice(i, j) + '\nwindow.__verificar = verificarSolicitudes;', ctx);
  window.__verificar(!!silencioso);
  return { badge, avisos, ctx };
}

test('el número del menú cuenta sólo lo que nadie tomó', () => {
  const m = armarMenu([S(1, 'CARGA', 'PENDIENTE'), S(2, 'CARGA', 'EN_REVISION'), S(3, 'RETIRO', 'EN_REVISION')], true);
  assert.equal(m.badge.innerText, 1);
  assert.equal(m.badge.oculto, false);
});

test('si todo está tomado, el número del menú se apaga', () => {
  const m = armarMenu([S(2, 'CARGA', 'EN_REVISION')], true);
  assert.equal(m.badge.oculto, true);
});

test('sin la cuenta compartida (portal sin cargar) queda el número de siempre', () => {
  const m = armarMenu([S(1, 'CARGA', 'PENDIENTE'), S(2, 'CARGA', 'EN_REVISION')], false);
  assert.equal(m.badge.innerText, 2);
});

test('soltar una solicitud no hace sonar "nueva solicitud"', () => {
  // Primera pasada: la solicitud está tomada. Segunda: la soltaron. Para el aviso sonoro sigue
  // siendo la misma solicitud de antes, no una que acaba de entrar.
  const sol = [S(5, 'CARGA', 'EN_REVISION')];
  const m = armarMenu(sol, true);
  sol[0].ESTADO = 'PENDIENTE';
  m.ctx.window.__verificar(true);
  assert.deepEqual(m.avisos, []);
  assert.equal(m.badge.innerText, 1, 'pero en el número del menú vuelve a contar');
});

// ── el cartel amarillo de Inicio ────────────────────────────────────────────────────────────
function armarInicio(solicitudes, conCuentaCompartida) {
  const lealtad = fs.readFileSync(path.join(RAIZ, 'core', 'retiros-y-lealtad.js'), 'utf8');
  const lineaPend = lealtad.split('\n').find((l) => l.startsWith('function esPendiente('));
  assert.ok(lineaPend, 'no está esPendiente');
  const vistas = fs.readFileSync(path.join(RAIZ, 'core', 'vistas-y-billeteras.js'), 'utf8');
  const i = vistas.indexOf('function renderInicio(){');
  const j = vistas.indexOf('// ── Estado de fichas en Inicio', i);
  assert.notEqual(i, -1);
  assert.notEqual(j, -1);
  const cajas = {};
  const window = {
    V154P: { solicitudes, portalBridgeReady: true },
    nodoChatUnreadSnapshot: () => ({ total: 0 })
  };
  if (conCuentaCompartida) window.nodoSolicitudesSinTocar = sinTocarDe();
  const ctx = {
    window, solicitudes: [], billeteras: [], pcOperativa: 'P4', _historialCargado: true, String, Array,
    normalizar: (v) => String(v == null ? '' : v).toUpperCase().trim(),
    setBox: (id, v) => { cajas[id] = v; },
    renderFichasInicio: () => {}, renderBillerasInicio: () => {}, poblarManualBilletera: () => {},
    tablaSolicitudesHTML: () => '', cargarHistorial: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(lineaPend + '\n' + vistas.slice(i, j) + '\nwindow.__inicio = renderInicio;', ctx);
  window.__inicio();
  return cajas;
}

test('el cartel amarillo y el cuadrito de Inicio cuentan lo que nadie tomó', () => {
  const c = armarInicio([S(1, 'CARGA', 'PENDIENTE'), S(2, 'CARGA', 'EN_REVISION'), S(3, 'RETIRO', 'PENDIENTE'), S(4, 'RETIRO', 'EN_REVISION')], true);
  assert.equal(c.statPendientes, 2);
  assert.match(c.alertas, /Hay 2 solicitud/);
  assert.equal(c.statRetiros, 'Retiros: 1');
});

test('si no queda nada sin tomar, el cartel amarillo no aparece', () => {
  const c = armarInicio([S(2, 'CARGA', 'EN_REVISION')], true);
  assert.equal(c.statPendientes, 0);
  assert.ok(!/Hay \d+ solicitud/.test(c.alertas));
});

test('sin la cuenta compartida (portal sin cargar) el cartel cuenta como siempre', () => {
  const c = armarInicio([S(1, 'CARGA', 'PENDIENTE'), S(2, 'CARGA', 'EN_REVISION')], false);
  assert.equal(c.statPendientes, 2);
});
