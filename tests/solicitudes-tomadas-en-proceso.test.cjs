const test = require('node:test');
const assert = require('node:assert/strict');
const parciales = require('../renderer/domain/parciales');
const requestsView = require('../renderer/portal/requests-view');

// Tomar una solicitud la manda al apartado "En proceso".
//
// Juan, 25/10: "al tomar una solicitud o retiro esta se volcara al apartado donde van las
// solicitudes parciales". La lista de pendientes tiene que quedar sólo con lo que NADIE tocó —que es
// lo que hace falta ver cuando entran tres o cinco juntas— y lo que ya tiene alguien va al botón
// 💸 En proceso, junto con los retiros pagándose por partes.
//
// Todo se prueba ejecutando el código de verdad: el reparto (puro) y el render de la lista.

const S = (id, tipo, estado, extra) => Object.assign({
  ID: id, TIPO: tipo, ESTADO: estado, USUARIO: 'user' + id, MONTO_DECLARADO: 5000,
  FECHA_CREACION: '2026-10-25T14:00:00Z', ORIGEN: 'PORTAL'
}, extra || {});

// ── el reparto, solo ────────────────────────────────────────────────────────────────────────
test('una carga o un retiro en revisión cuentan como tomados', () => {
  assert.equal(parciales.tomada(S(1, 'CARGA', 'EN_REVISION')), true);
  assert.equal(parciales.tomada(S(2, 'RETIRO', 'EN_PROCESO')), true);
});

test('lo que nadie tomó NO es tomado', () => {
  assert.equal(parciales.tomada(S(3, 'CARGA', 'PENDIENTE')), false);
  assert.equal(parciales.tomada(S(4, 'RETIRO', 'ERROR_OPERATIVO')), false, 'falló: vuelve a la lista para reintentar');
});

test('un cambio de clave no se toma, aunque diga EN_REVISION', () => {
  assert.equal(parciales.tomada(S(5, 'CAMBIO_CLAVE', 'EN_REVISION')), false);
});

test('el reparto separa parciales, tomadas y sin tocar', () => {
  const abiertas = [
    S(1, 'CARGA', 'PENDIENTE'),
    S(2, 'CARGA', 'EN_REVISION'),
    S(3, 'RETIRO', 'EN_PROCESO'),
    S(4, 'RETIRO', 'EN_PROCESO'),          // éste además va por partes
    S(5, 'RETIRO', 'PENDIENTE')
  ];
  const r = parciales.repartirAbiertas(abiertas, { esParcial: (s) => s.ID === 4, enCola: () => false });
  assert.deepEqual(r.pendientes.map(s => s.ID), [1, 5]);
  assert.deepEqual(r.tomadas.map(s => s.ID), [2, 3]);
  assert.deepEqual(r.parciales.map(s => s.ID), [4]);
});

test('un parcial no se cuenta dos veces: va a parciales, no a tomadas', () => {
  const r = parciales.repartirAbiertas([S(1, 'RETIRO', 'EN_PROCESO')], { esParcial: () => true, enCola: () => false });
  assert.equal(r.parciales.length, 1);
  assert.equal(r.tomadas.length, 0);
});

test('la que está en la cola de carga se queda en la lista principal', () => {
  // Ahí es donde la tarjeta dice "2º en la cola" / "Cargando…". Si desapareciera, el operador
  // apretaría de nuevo creyendo que el clic se perdió.
  const r = parciales.repartirAbiertas([S(1, 'CARGA', 'EN_REVISION')], { esParcial: () => false, enCola: () => true });
  assert.deepEqual(r.pendientes.map(s => s.ID), [1]);
  assert.equal(r.tomadas.length, 0);
});

test('si un criterio falla, la solicitud queda a la vista: nunca se esconde', () => {
  const rompe = () => { throw new Error('boom'); };
  const a = parciales.repartirAbiertas([S(1, 'CARGA', 'EN_REVISION')], { esParcial: rompe, enCola: () => false });
  assert.deepEqual(a.pendientes.map(s => s.ID), [1], 'si falla "es parcial", va a la lista principal');
  const b = parciales.repartirAbiertas([S(2, 'CARGA', 'EN_REVISION')], { esParcial: () => false, enCola: rompe });
  assert.deepEqual(b.pendientes.map(s => s.ID), [2], 'si falla "está en cola", va a la lista principal');
});

test('sin lista, no explota', () => {
  const r = parciales.repartirAbiertas(null, {});
  assert.deepEqual(r, { parciales: [], tomadas: [], pendientes: [] });
});

// ── la lista de pendientes, de verdad ───────────────────────────────────────────────────────
function armarLista(solicitudes, extraWindow) {
  const nodos = {
    tablaSolicitudesInicio: { innerHTML: '' },
    btnParcialesEnProceso: { style: {} },
    btnParcialesCount: { textContent: '' },
    btnParcialesCC: { style: {} },
    btnParcialesCCCount: { textContent: '' },
    statPendientes: { textContent: '' },
    badgeSolicitudes: { textContent: '', classList: { add() {}, remove() {} } },
    statRetiros: { textContent: '' }
  };
  const window = Object.assign({
    NodoDomain: { parciales },
    _retiroParcialInfo: () => ({ hasProg: false, total: 0, pagado: 0, restante: 0 }),
    _colaCargaEstado: {}
  }, extraWindow || {});
  const api = requestsView.create({
    V154P: { solicitudes },
    document: { getElementById: (id) => nodos[id] || null },
    esc: (v) => String(v == null ? '' : v),
    estadoCerrado: (e) => ['ACREDITADA', 'PAGADA', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'CERRADA', 'FINALIZADA'].includes(String(e).toUpperCase()),
    fecha: () => '25/10', money: (v) => '$' + v,
    renderHistorialUnificado: () => {},
    window
  });
  api.renderSolicitudesPortalEnInicio();
  return { nodos, window, html: nodos.tablaSolicitudesInicio.innerHTML };
}

test('tomar una solicitud la saca de la lista y la cuenta en 💸 En proceso', () => {
  const r = armarLista([S(10, 'CARGA', 'PENDIENTE'), S(11, 'CARGA', 'EN_REVISION')]);
  assert.match(r.html, /v154pCard10/, 'la que nadie tocó sigue en la lista');
  assert.ok(!/v154pCard11/.test(r.html), 'la tomada ya no está en la lista principal');
  assert.equal(r.nodos.btnParcialesCount.textContent, '1', 'el botón cuenta la tomada');
  assert.notEqual(r.nodos.btnParcialesEnProceso.style.display, 'none', 'y aparece');
  assert.deepEqual(r.window._tomadasEnProceso.map(s => s.ID), [11]);
});

test('el contador suma tomadas y retiros por partes', () => {
  const r = armarLista(
    [S(20, 'CARGA', 'EN_REVISION'), S(21, 'RETIRO', 'EN_PROCESO'), S(22, 'CARGA', 'PENDIENTE')],
    { _retiroParcialInfo: (s) => s.ID === 21 ? { hasProg: true, total: 10000, pagado: 4000, restante: 6000 } : { hasProg: false } }
  );
  assert.equal(r.nodos.btnParcialesCount.textContent, '2', '1 tomada + 1 pagándose por partes');
  assert.equal(r.nodos.btnParcialesCCCount.textContent, '2', 'el botón del centro de control dice lo mismo');
  assert.equal(r.window._parcialesEnProceso.length, 1);
  assert.equal(r.window._tomadasEnProceso.length, 1);
});

test('la lista de pendientes cuenta sólo lo que nadie tocó', () => {
  const r = armarLista([S(30, 'CARGA', 'PENDIENTE'), S(31, 'CARGA', 'EN_REVISION'), S(32, 'RETIRO', 'EN_REVISION')]);
  assert.equal(r.nodos.statPendientes.textContent, '1');
});

test('sin nada tomado el botón no aparece', () => {
  const r = armarLista([S(40, 'CARGA', 'PENDIENTE')]);
  assert.equal(r.nodos.btnParcialesEnProceso.style.display, 'none');
});

test('una tomada que está en la cola de carga se queda donde se ve su estado', () => {
  const r = armarLista([S(50, 'CARGA', 'EN_REVISION')], { _colaCargaEstado: { '50': { estado: 'espera', pos: 2, cid: 'cc1' } } });
  assert.match(r.html, /v154pCard50/, 'sigue en la lista principal');
  assert.match(r.html, /2º en la cola/, 'diciendo en qué lugar de la cola está');
  assert.equal(r.nodos.btnParcialesCount.textContent, '0');
});

test('en la lista, Aprobar abre el cartel para cotejar: aprobar de una es sólo adentro de "Ver"', () => {
  // Juan, 1/11: "si se abria el modal de ver se apruebe sin desplegar el cartel, NO QUE EN LA PAGINA
  // PRINCIPAL HAGA LA MISMA". El cartel ya trae el monto seleccionado para cambiarlo.
  const r = armarLista([S(60, 'CARGA', 'PENDIENTE')]);
  assert.match(r.html, /onclick="v154pCrearJobSolicitud\(60\)">Aprobar</);
  assert.ok(!/v154pAprobarSolicitud/.test(r.html), 'desde la lista nunca se aprueba sin ver el cartel');
  assert.ok(!/Otro monto/.test(r.html), 'el cartel ya deja cambiar el monto: el botón sobraba');
});

test('una solicitud sin tomar sigue ofreciendo Tomar', () => {
  const r = armarLista([S(70, 'RETIRO', 'PENDIENTE')]);
  assert.match(r.html, /v154pTomarSolicitud\(70\)/);
  assert.match(r.html, /v154pRegistrarParcial\(70\)/, 'el retiro conserva su botón de parcial');
});

// ── Discord tiene que decir lo mismo que la pantalla ────────────────────────────────────────
// La presencia de Discord ("3 solicitudes pendientes") se armaba con el criterio viejo: sólo los
// retiros por partes quedaban afuera. Con las tomadas fuera de la lista, Discord decía 5 y la
// pantalla 2 — el propio módulo dice que "no puede opinar distinto que la pantalla".
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const presencia = require('../renderer/domain/presencia');

function presenciaDe(solicitudes, extraWindow) {
  const enviados = [];
  const window = Object.assign({
    NodoDomain: { parciales, presencia },
    V154P: { solicitudes },
    _versionApp: '2.1.5', pcOperativa: 'P4',
    _retiroParcialInfo: () => ({ hasProg: false }),
    _colaCargaEstado: {},
    ctrlElectron: { discordPresencia: (p) => { enviados.push(p); return Promise.resolve(); } }
  }, extraWindow || {});
  const ctx = { window, setInterval: () => 0, Promise, Date, String, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'discord-presencia.js'), 'utf8'), ctx);
  window.actualizarPresenciaDiscord(true);
  return enviados[0];
}

test('Discord no cuenta como pendientes las que ya están tomadas', () => {
  const p = presenciaDe([S(1, 'CARGA', 'PENDIENTE'), S(2, 'CARGA', 'EN_REVISION'), S(3, 'RETIRO', 'EN_REVISION'), S(4, 'CARGA', 'PENDIENTE')]);
  assert.equal(p.pendientes, 2);
  assert.match(p.details, /2 solicitudes pendientes/);
});

test('Discord y la lista coinciden: la tomada que está en la cola sigue contando', () => {
  const p = presenciaDe([S(1, 'CARGA', 'EN_REVISION')], { _colaCargaEstado: { '1': { estado: 'espera', pos: 1, cid: 'c' } } });
  assert.equal(p.pendientes, 1, 'en la lista principal se ve; Discord tiene que contarla igual');
});

// Juan, 2/11: Discord decía "8 solicitudes pendientes" y la lista de Inicio "No hay solicitudes".
// Discord publica el número que dibujó la lista, no uno contado aparte.
test('Discord publica el mismo número que dibujó la lista de Inicio', () => {
  // CERRADO: la lista no lo tiene entre los estados cerrados y lo muestra; la cuenta propia de
  // Discord sí lo descartaba. Dos criterios, dos números.
  const lista = [S(1, 'CARGA', 'PENDIENTE'), S(2, 'CARGA', 'CERRADO')];
  const r = armarLista(lista);
  assert.equal(r.nodos.statPendientes.textContent, '2');
  assert.equal(presenciaDe(lista).pendientes, 1, 'sin el número de la pantalla, Discord opinaba distinto');
  const p = presenciaDe(lista, { _nodoPendientesPantalla: r.window._nodoPendientesPantalla });
  assert.equal(p.details, '2 solicitudes pendientes', 'manda lo que se ve en pantalla');
});

test('si la lista cambió y todavía no se dibujó, Discord cuenta con el mismo criterio', () => {
  const lista = [S(1, 'CARGA', 'PENDIENTE')];
  const r = armarLista(lista);
  assert.equal(r.window._nodoPendientesPantalla.n, 1);
  lista.push(S(2, 'CARGA', 'PENDIENTE'));
  const p = presenciaDe(lista, { _nodoPendientesPantalla: r.window._nodoPendientesPantalla });
  assert.equal(p.pendientes, 2, 'el número guardado es de una lista más corta: no se usa');
});

test('si no se pudo consultar, Discord no publica un número que puede ser viejo', () => {
  const lista = [S(1, 'CARGA', 'PENDIENTE')];
  const enviados = [];
  const window = {
    NodoDomain: { parciales, presencia }, V154P: { solicitudes: lista, solicitudesErrorAt: Date.now() },
    _retiroParcialInfo: () => ({ hasProg: false }), _colaCargaEstado: {},
    ctrlElectron: { discordPresencia: (p) => { enviados.push(p); return Promise.resolve(); } }
  };
  const ctx = { window, setInterval: () => 0, Promise, Date, String, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'discord-presencia.js'), 'utf8'), ctx);
  window.actualizarPresenciaDiscord(true);
  assert.equal(enviados[0].details, 'Sin datos: no se pudo consultar');
});

test('cada minuto le avisa a main que el panel sigue vivo, aunque nada haya cambiado', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'discord-presencia.js'), 'utf8');
  assert.match(src, /setInterval\(function\(\)\{ window\.actualizarPresenciaDiscord\(true\); \}, 60000\)/);
});
