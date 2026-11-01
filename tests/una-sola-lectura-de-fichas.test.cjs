const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vista = require('../renderer/portal/withdrawals-view.js');
const ejecucion = require('../renderer/portal/withdrawals-execution.js');
const cartel = require('../renderer/portal/operation-modal.js');

// Una sola lectura de fichas.
//
// Juan, 1/11: "la revision de fichas funciona sin drama alguno asique claramente esto esta utilizando
// otra cosa". Había cinco copias de la misma pregunta al casino: el modal de retiro decía "no pudimos
// leer" cuando el jugador no existe en Agentes y no tenía cómo reintentar, y el escaneo de fondo podía
// creerle a una lectura con la sesión caída. El cartel de aprobar directamente no mostraba las fichas.

const RAIZ = path.join(__dirname, '..', 'renderer');
const FUENTE = fs.readFileSync(path.join(RAIZ, 'core', 'chunior-recuperacion-y-transferencias.js'), 'utf8');
function cortar(desde, hasta) {
  const i = FUENTE.indexOf(desde), j = FUENTE.indexOf(hasta, i);
  assert.ok(i !== -1 && j !== -1, 'no está: ' + desde);
  return FUENTE.slice(i, j);
}

function archivosRenderer(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'generated') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivosRenderer(p, salida);
    else if (e.name.endsWith('.js')) salida.push(p);
  }
  return salida;
}

test('nadie vuelve a copiar la lectura de fichas', () => {
  // Las operaciones que mueven fichas leen adentro de su propio candado: ese saldo es parte del
  // movimiento. Todo lo que sólo pregunta "cuántas tiene" pasa por leerFichasJugador.
  const permitidas = {
    'core/chunior-recuperacion-y-transferencias.js': 1,
    'portal/operation-execution.js': 2,
    'core/operaciones-manuales.js': 1
  };
  const encontradas = {};
  for (const f of archivosRenderer(RAIZ)) {
    const n = (fs.readFileSync(f, 'utf8').match(/callDrex\(\s*['"]buscarUsuario['"][^)]*skipBalance:\s*false/g) || []).length;
    if (n) encontradas[path.relative(RAIZ, f).split(path.sep).join('/')] = n;
  }
  assert.deepEqual(encontradas, permitidas);
});

function armarEscaneo(lecturas) {
  const reg = { rechazos: 0, toasts: [] };
  const solicitud = { ID: 7, TIPO: 'RETIRO', ESTADO: 'PENDIENTE', USUARIO: 'jugador_retiro', MONTO_DECLARADO: 50000, FECHA_CREACION: new Date(Date.now() - 60000).toISOString() };
  const ventana = {
    V154P: { solicitudes: [solicitud] }, ctrlElectron: {}, _retiroSaldoCheck: {},
    actualizarSolicitudPortal: async () => { reg.rechazos++; }
  };
  const ctx = {
    window: ventana, localStorage: { getItem: () => null },
    callDrex: async () => lecturas.shift(),
    _drexGlobalLock: () => true, _drexGlobalUnlock: () => {}, _wdLock: () => {}, _wdUnlock: () => {},
    toast: (m) => reg.toasts.push(m), money: (v) => '$' + v, registrarEnHistorial: async () => {},
    notificarUsuarioEnChat: async () => {}, Date, JSON, Number, String, Math
  };
  vm.createContext(ctx);
  vm.runInContext(
    cortar('async function verificarSaldoRetiroOcioso(){', 'window.verificarSaldoRetiroOcioso =')
    + cortar('async function leerFichasJugador(usuario){', 'window.leerFichasJugador ='), ctx);
  return { correr: () => ctx.verificarSaldoRetiroOcioso(), reg, ventana };
}

test('el escaneo de fondo no rechaza un retiro por una sesión caída', async () => {
  // Con la sesión caída el casino deja la lista de fondo y el saldo viene en 0.
  const t = armarEscaneo([{ exists: true, needsLogin: true, balance: { value: 0, raw: 'ARS 0.00' } }]);
  await t.correr();
  assert.equal(t.reg.rechazos, 0, 'plata de verdad: un 0 sin sesión no es un jugador sin fichas');
  assert.equal(t.ventana._retiroSaldoCheck.jugador_retiro, undefined);
});

test('el escaneo de fondo sigue rechazando al que no tiene fichas, con dos lecturas', async () => {
  const cero = { exists: true, balance: { value: 0, raw: 'ARS 0.00' } };
  const t = armarEscaneo([cero, cero]);
  await t.correr();
  assert.equal(t.reg.rechazos, 1);
});

test('si la segunda lectura no confirma, no se rechaza', async () => {
  const t = armarEscaneo([{ exists: true, balance: { value: 0, raw: 'ARS 0.00' } }, { needsLogin: true }]);
  await t.correr();
  assert.equal(t.reg.rechazos, 0);
});

// ── el modal de retiro ──────────────────────────────────────────────────────────────────────
function armarModal(opciones) {
  const o = opciones || {};
  const nodos = {};
  const nodo = (id) => (nodos[id] = nodos[id] || { id, innerHTML: '', textContent: '', style: {}, value: '' });
  const estado = { current: null };
  const solicitud = { ID: 396716, USUARIO: 'ZZ_dup_prueba', TITULAR: 'pepeton', CBU: 'pepe.mp', MONTO_DECLARADO: 10000, ESTADO: 'PENDIENTE' };
  const pedidos = [];
  const ventana = {
    V154P: { solicitudes: [solicitud] },
    revisarFichasRetiro: async (p) => { pedidos.push(p); return o.respuestas.shift(); },
    _retiroMontoSugerido: () => null
  };
  const comun = {
    window: ventana, V154P: ventana.V154P, withdrawalState: estado, money: (v) => '$ ' + v,
    escapeHtml: (v) => String(v == null ? '' : v), toast: () => {}, confirm: () => true, setTimeout: () => 0,
    billeteras: [], recomendarRepartoRetiro: () => ({ reparto: [] }), _rv2RenderConfirmar: () => {},
    document: {
      getElementById: (id) => (id === 'retiroV2Modal' ? nodo(id) : nodos[id] || null),
      createElement: () => nodo('retiroV2Modal'),
      body: { appendChild: () => {} }, querySelector: () => null, activeElement: null
    }
  };
  const lector = {};
  const v = vista.create(Object.assign({}, comun, {
    _rv2LeerSaldo: (...a) => lector.leer(...a),
    abrirModalRetiroV2: (...a) => v.globals.abrirModalRetiroV2(...a)
  }));
  const reg = { sesiones: 0, callDrex: 0 };
  const e = ejecucion.create(Object.assign({}, comun, {
    _rv2PintarVeredicto: () => v._rv2PintarVeredicto(),
    _rv2ActualizarBotonAprobar: () => v._rv2ActualizarBotonAprobar(),
    _rv2TotalSel: () => 0, _rv2BilsUsables: () => [], _rv2Render: () => v._rv2Render(), _rv2Modal: () => v._rv2Modal(),
    ensureDrexSession: async () => { reg.sesiones++; return o.sesionOk !== false; },
    callDrex: async () => { reg.callDrex++; return {}; }
  }));
  lector.leer = e._rv2LeerSaldo;
  // withdrawals-view dibuja adentro del modal: se vuelca lo que se pintó en el contenedor del veredicto.
  const veredicto = () => nodos.rv2SaldoReal ? nodos.rv2SaldoReal.innerHTML : '';
  return {
    abrir: async () => { v.globals.abrirModalRetiroV2(396716); await new Promise((r) => setImmediate(r)); nodoVisible(); },
    reintentar: () => e.globals._rv2ReleerFichas(),
    estado, pedidos, reg, veredicto, modal: () => nodos.retiroV2Modal.innerHTML
  };
  function nodoVisible() {
    // El modal arma su html en un string: se simulan los dos contenedores que repinta después.
    nodo('rv2SaldoReal'); nodo('rv2Total'); nodo('rv2Resumen'); nodo('rv2BtnAprobar');
    v._rv2PintarVeredicto();
  }
}

test('el modal lee con la lectura común, y fresca: nunca por su cuenta', async () => {
  const t = armarModal({ respuestas: [{ saldo: 20000, raw: 'ARS 20,000.00', confiable: true }] });
  await t.abrir();
  assert.equal(t.pedidos.length, 1);
  assert.equal(t.pedidos[0].usuario, 'ZZ_dup_prueba');
  assert.equal(t.pedidos[0].forzar, true, 'para pagar no sirve una lectura vieja');
  assert.equal(t.reg.callDrex, 0, 'el modal ya no le pregunta al casino por su lado');
  assert.equal(t.estado.current.saldoReal, 20000);
  assert.match(t.veredicto(), /Cotejo de fichas/);
});

test('un jugador que no está en Agentes se dice como tal, con botón de reintentar', async () => {
  const t = armarModal({ respuestas: [{ error: 'El casino no encuentra al usuario ZZ_dup_prueba', motivo: 'no_existe' }] });
  await t.abrir();
  assert.match(t.veredicto(), /ESTE USUARIO NO ESTÁ EN AGENTES/);
  assert.match(t.veredicto(), /ZZ_dup_prueba/);
  assert.match(t.veredicto(), /_rv2ReleerFichas\(\)/);
  assert.ok(!/a ciegas/.test(t.veredicto()), 'no invita a pagar sin saber');
});

test('reintentar vuelve a leer y limpia el error', async () => {
  const t = armarModal({ respuestas: [{ error: 'ocupado', motivo: 'ocupado', ocupado: true }, { saldo: 15000, raw: 'ARS 15,000.00', confiable: true }] });
  await t.abrir();
  assert.match(t.veredicto(), /NO PUDIMOS LEER SUS FICHAS/);
  await t.reintentar();
  assert.equal(t.pedidos.length, 2);
  assert.equal(t.estado.current.saldoReal, 15000);
  assert.ok(!/NO PUDIMOS LEER/.test(t.veredicto()));
});

test('con la sesión caída, reintentar primero hace entrar a Agentes', async () => {
  const t = armarModal({ respuestas: [{ error: 'sesión', motivo: 'sesion' }, { saldo: 15000, raw: 'ARS 15,000.00', confiable: true }] });
  await t.abrir();
  await t.reintentar();
  assert.equal(t.reg.sesiones, 1);
  assert.equal(t.estado.current.saldoReal, 15000);
});

test('si no se puede entrar a Agentes, no se vuelve a leer', async () => {
  const t = armarModal({ sesionOk: false, respuestas: [{ error: 'sesión', motivo: 'sesion' }] });
  await t.abrir();
  await t.reintentar();
  assert.equal(t.pedidos.length, 1);
});

test('un fallo de lectura no borra un saldo ya leído', async () => {
  const t = armarModal({ respuestas: [{ saldo: 15000, raw: 'ARS 15,000.00', confiable: true }, { error: 'x', motivo: 'ilegible' }] });
  await t.abrir();
  await t.reintentar();
  assert.equal(t.estado.current.saldoReal, 15000);
  assert.ok(!/NO PUDIMOS LEER/.test(t.veredicto()));
});

test('el CBU se muestra una sola vez', async () => {
  const t = armarModal({ respuestas: [{ saldo: 1, raw: '1', confiable: true }] });
  await t.abrir();
  assert.equal((t.modal().match(/portalCopiarCbu/g) || []).length, 1);
});

// ── el cartel de aprobar ────────────────────────────────────────────────────────────────────
function armarCartel(solicitud, leer) {
  const caja = { style: {}, innerHTML: '' }, modal = { dataset: { solicitudId: String(solicitud.ID) } };
  const pedidos = [];
  const m = cartel.create({
    V154P: { solicitudes: [solicitud] }, alert: () => {}, billeteras: [], cargarBilleteras: async () => {},
    cerrarPortalJobModal: () => {}, ejecutarSolicitudPortalSimple: async () => {},
    document: { getElementById: (id) => (id === 'portalJobFichas' ? caja : id === 'portalJobModal' ? modal : null), querySelectorAll: () => [] },
    esc: (v) => String(v == null ? '' : v), fecha: () => '', getBilleraLanding: () => null, money: (v) => '$ ' + v,
    normalizar: (v) => String(v || '').toUpperCase(), pcAliasesHist: () => ['P1'], pcOperativa: 'P1', portalCheckDiferencia: () => {},
    setTimeout: () => 0, supabaseClient: null, toast: () => {}, v154pRegistrarParcial: () => {},
    window: { revisarFichasRetiro: async (p) => { pedidos.push(p); return leer(p); } }
  });
  const api = Object.assign({}, m.globals, m);
  return { revisar: (f) => api.portalJobRevisarFichas(f), caja, modal, pedidos };
}

test('el cartel de un retiro coteja las fichas con la misma lectura que "Ver"', async () => {
  const t = armarCartel({ ID: 60, TIPO: 'RETIRO', USUARIO: 'jugador_retiro', MONTO_DECLARADO: 50000 },
    () => ({ saldo: 80000, raw: 'ARS 80,000.00', confiable: true, ts: Date.now() }));
  await t.revisar();
  assert.equal(t.caja.style.display, '');
  assert.match(t.caja.innerHTML, /Cotejo de fichas/);
  assert.match(t.caja.innerHTML, /ARS 80,000\.00/);
  assert.match(t.caja.innerHTML, /alcanza/);
});

test('si el cotejo del cartel falla, dice por qué y deja reintentar ahí mismo', async () => {
  const t = armarCartel({ ID: 60, TIPO: 'RETIRO', USUARIO: 'jugador_retiro', MONTO_DECLARADO: 50000 },
    () => ({ error: 'Se cayó la sesión de Agentes: entrá de nuevo y volvé a leer', motivo: 'sesion' }));
  await t.revisar();
  assert.match(t.caja.innerHTML, /sesión de Agentes/);
  assert.match(t.caja.innerHTML, /portalJobRevisarFichas\(true\)/);
  await t.revisar(true);
  assert.equal(t.pedidos[1].forzar, true);
});

test('una carga no muestra fichas en el cartel', async () => {
  const t = armarCartel({ ID: 61, TIPO: 'CARGA', USUARIO: 'pruebaxx', MONTO_DECLARADO: 5000 }, () => ({}));
  await t.revisar();
  assert.equal(t.caja.style.display, 'none');
  assert.equal(t.pedidos.length, 0);
});

test('si mientras lee se pasa a otra solicitud, no se pisa lo que está en pantalla', async () => {
  let soltar;
  const t = armarCartel({ ID: 60, TIPO: 'RETIRO', USUARIO: 'jugador_retiro', MONTO_DECLARADO: 50000 }, () => new Promise((r) => { soltar = r; }));
  const lectura = t.revisar();
  await new Promise((r) => setImmediate(r));
  t.modal.dataset.solicitudId = '61';
  soltar({ saldo: 5, raw: 'ARS 5.00', confiable: true });
  await lectura;
  assert.ok(!/ARS 5\.00/.test(t.caja.innerHTML));
});

// ── por dónde se aprueba ────────────────────────────────────────────────────────────────────
test('adentro de "Ver" se aprueba de una; en las listas siempre pasa por el cartel', () => {
  const requests = fs.readFileSync(path.join(RAIZ, 'portal', 'requests-view.js'), 'utf8');
  const enProceso = fs.readFileSync(path.join(RAIZ, 'core', 'archivo-historial.js'), 'utf8');
  assert.ok(!requests.includes('v154pAprobarSolicitud'), 'la lista de Inicio no aprueba de una');
  assert.ok(!enProceso.includes('v154pAprobarSolicitud'), 'la lista de En proceso tampoco');
  assert.ok(!requests.includes('Otro monto') && !enProceso.includes('Otro monto'));
});
