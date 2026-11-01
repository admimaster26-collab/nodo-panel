const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Dos cosas del panel que no son un módulo y se prueban cargando el archivo de verdad:
//
//  1. El cartel de versión se corre hacia el costado cuando se despliega algo contra la derecha
//     (Juan, 25/10: "el cartel de actualizacion se tiene que desplazar levemente hacia el costado con
//     cada cosa que se despliegue en ese costado que pueda superponerse tanto por encima como por
//     debajo"). Antes sólo conocía el panel de chat, y el cajón del expediente lo pisaba y le tapaba
//     el título.
//
//  2. La lectura de fichas de un jugador a pedido (el "Ver" de un retiro).

const RAIZ = path.join(__dirname, '..', 'renderer');

// ═══ 1 · el cartel de versión ═══════════════════════════════════════════════════════════════
function armarCartel(opciones) {
  const o = opciones || {};
  const ancho = o.ancho || 1440;
  const rect = (r) => r ? { left: r.left, right: r.right, top: r.top == null ? 0 : r.top, width: r.right - r.left, height: r.alto == null ? 900 : r.alto }
                        : { left: 0, right: 0, top: 0, width: 0, height: 0 };
  const el = (r, extra) => Object.assign({ style: {}, getBoundingClientRect: () => rect(r), classList: { contains: () => false } }, extra || {});
  const caja = el(null, { offsetWidth: o.anchoCaja || 190 });
  const chip = el(null, { offsetWidth: o.anchoChip || 70 });
  const chat = o.chat ? el(o.chat) : null;
  const login = el(null, { classList: { contains: (c) => !!(o.login && c !== 'hidden') } });
  const cajones = (o.cajones || []).map((r) => el(r));
  const nodos = { updaterBox: caja, updaterMiniChip: chip, viewChat: chat, loginView: o.login ? login : null };
  const ctx = {
    window: { innerWidth: ancho }, innerWidth: ancho,
    document: {
      getElementById: (id) => nodos[id] || null,
      querySelectorAll: (sel) => sel === '[data-ocupa-derecha]' ? cajones : [],
      addEventListener: () => {}
    },
    // Un elemento escondido por un ancestro mide cero; el display propio sigue en "flex".
    getComputedStyle: () => ({ display: o.login ? 'block' : 'flex', visibility: 'visible' }),
    addEventListener: () => {}, setTimeout: () => 0, setInterval: () => 0,
    localStorage: { getItem: () => null, setItem: () => {} },
    Math, Number, String, Array, Promise, console
  };
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'core', 'actualizaciones.js'), 'utf8'), ctx);
  return { anclar: () => ctx._updaterAnclar(), caja, chip };
}

const CAJON_ABIERTO = { left: 680, right: 1440 };            // 760 px de ancho, pegado a la derecha
const CAJON_CERRADO = null;                                  // dentro de un ancestro display:none mide 0

test('sin nada desplegado, el cartel va en la esquina', () => {
  const c = armarCartel({ cajones: [CAJON_CERRADO] });
  c.anclar();
  assert.equal(c.caja.style.right, '12px');
  assert.equal(c.chip.style.right, '12px');
});

test('el cajón del expediente abierto lo corre hacia el costado, sin pisar el título', () => {
  const c = armarCartel({ cajones: [CAJON_ABIERTO] });
  c.anclar();
  // El cajón empieza en x=680: el cartel se apoya en su borde, con 14 px de aire.
  assert.equal(c.caja.style.right, (1440 - 680 + 14) + 'px');
  assert.equal(c.chip.style.right, (1440 - 680 + 14) + 'px', 'el cartel plegado también');
});

test('al cerrar el cajón, vuelve a la esquina', () => {
  const abierto = armarCartel({ cajones: [CAJON_ABIERTO] });
  abierto.anclar();
  assert.notEqual(abierto.caja.style.right, '12px');
  const cerrado = armarCartel({ cajones: [CAJON_CERRADO] });
  cerrado.anclar();
  assert.equal(cerrado.caja.style.right, '12px');
});

test('mientras el cajón todavía está entrando (desliza .24 s), no salta a cualquier lado', () => {
  // Al primer instante el cajón mide desde x=1440 (fuera de la pantalla): el cartel casi no se mueve
  // y se vuelve a medir cuando el cajón ya llegó.
  const c = armarCartel({ cajones: [{ left: 1440, right: 2200 }] });
  c.anclar();
  assert.equal(c.caja.style.right, '14px');
});

test('el chat pegado a la derecha lo sigue corriendo como antes', () => {
  const c = armarCartel({ chat: { left: 1100, right: 1440, top: 80 } });
  c.anclar();
  assert.equal(c.caja.style.right, (1440 - 1100 + 14) + 'px');
});

test('con el chat Y el cajón abiertos, gana el que se mete más hacia adentro', () => {
  const c = armarCartel({ chat: { left: 1100, right: 1440, top: 80 }, cajones: [CAJON_ABIERTO] });
  c.anclar();
  assert.equal(c.caja.style.right, (1440 - 680 + 14) + 'px');
});

test('da igual si el cajón queda por encima o por debajo del cartel: se corre por posición', () => {
  // El cartel tiene z-index 100000 y el cajón 99999 (el cartel queda arriba y le tapa el título). Si
  // mañana cambia el orden de capas, sigue sin pisarlo: la cuenta no mira capas.
  const c = armarCartel({ cajones: [CAJON_ABIERTO] });
  assert.doesNotThrow(() => c.anclar());
  assert.equal(c.caja.style.right, '774px');
});

test('un cajón que no llega a la franja del cartel no lo mueve', () => {
  const c = armarCartel({ cajones: [{ left: 900, right: 1440, top: 200 }] });
  c.anclar();
  assert.equal(c.caja.style.right, '12px', 'empieza 200 px más abajo: no hay nada que pisar');
});

test('un cajón que NO está pegado a la derecha no lo mueve', () => {
  const c = armarCartel({ cajones: [{ left: 100, right: 700 }] });
  c.anclar();
  assert.equal(c.caja.style.right, '12px');
});

test('cualquier cajón nuevo funciona con sólo llevar el atributo, sin tocar el cartel', () => {
  const c = armarCartel({ cajones: [{ left: 1000, right: 1440 }, CAJON_CERRADO] });
  c.anclar();
  assert.equal(c.caja.style.right, (1440 - 1000 + 14) + 'px');
});

test('el cartel nunca se sale de la pantalla, aunque el cajón ocupe casi todo el ancho', () => {
  // Ventana mínima (900 px) con el cajón de 760: quedan 140 px y la caja completa mide 190.
  const c = armarCartel({ ancho: 900, cajones: [{ left: 140, right: 900 }], anchoCaja: 190, anchoChip: 70 });
  c.anclar();
  const derechaCaja = parseInt(c.caja.style.right, 10);
  assert.ok(900 - derechaCaja - 190 >= 0, 'la caja entera tiene que quedar dentro de la ventana');
  const derechaChip = parseInt(c.chip.style.right, 10);
  assert.equal(derechaChip, 900 - 140 + 14, 'el plegado (70 px) sí entra al costado y lo hace');
});

test('en la pantalla de login el chat no lo engancha: queda en la esquina', () => {
  const c = armarCartel({ login: true, chat: { left: 1100, right: 1440, top: 80 } });
  c.anclar();
  assert.equal(c.caja.style.right, '12px');
});

test('el cajón del expediente de verdad lleva la marca que el cartel busca', () => {
  const plantilla = fs.readFileSync(path.join(RAIZ, 'panel.template.html'), 'utf8');
  const i = plantilla.indexOf('id="modalExpedienteOverlay"');
  assert.notEqual(i, -1);
  assert.match(plantilla.slice(i, i + 300), /class="expediente-drawer" data-ocupa-derecha/, 'sin la marca el cartel no se entera');
  const modulo = fs.readFileSync(path.join(RAIZ, 'portal', 'operation-modal.js'), 'utf8');
  assert.match(modulo, /expediente-drawer" data-ocupa-derecha/, 'el que se arma al vuelo también');
});

// ═══ 2 · leer las fichas de un jugador ══════════════════════════════════════════════════════
const FUENTE = fs.readFileSync(path.join(RAIZ, 'core', 'chunior-recuperacion-y-transferencias.js'), 'utf8');
function cortar(desde, hasta) {
  const i = FUENTE.indexOf(desde), j = FUENTE.indexOf(hasta, i);
  assert.notEqual(i, -1, 'no está: ' + desde);
  assert.notEqual(j, -1, 'no está: ' + hasta);
  return FUENTE.slice(i, j);
}

function armarLector(opciones) {
  const o = opciones || {};
  const reloj = { t: 1_000_000 };
  const reg = { lecturas: [], bloqueos: 0, desbloqueos: 0, wdLock: 0, wdUnlock: 0, repintados: 0 };
  let ocupadoPor = o.ocupadoPor || 0;           // cuántas veces pregunta "ocupado" antes de liberarse
  const ventana = {
    ctrlElectron: o.sinApp ? undefined : {},
    _drexGlobalBusy: false,
    v154pRenderSolicitudesPortalEnInicio: () => { reg.repintados++; }
  };
  const ctx = {
    window: ventana,
    callDrex: async (metodo, usuario, opts) => {
      reg.lecturas.push({ metodo, usuario, opts });
      return o.respuesta === undefined
        ? { exists: true, balance: { value: 50166.7, raw: 'ARS 50,166.70' } } : o.respuesta;
    },
    _drexGlobalLock: () => {
      if (ocupadoPor > 0) { ocupadoPor--; return false; }
      reg.bloqueos++; return true;
    },
    _drexGlobalUnlock: () => { reg.desbloqueos++; },
    _wdLock: () => { reg.wdLock++; }, _wdUnlock: () => { reg.wdUnlock++; },
    // El tiempo avanza solo cuando se espera: así "20 segundos" no tarda 20 segundos.
    setTimeout: (fn, ms) => { reloj.t += ms; Promise.resolve().then(fn); return 1; },
    Date: { now: () => reloj.t },
    Promise, Number, String, Math, Error
  };
  vm.createContext(ctx);
  vm.runInContext(
    cortar('function _fichasAgenteOcupado(){', 'function abrirModalTransferirBilleteras(){')
      .replace('window._fichasLeyendo = window._fichasLeyendo || {};', 'window._fichasLeyendo = window._fichasLeyendo || {};'),
    ctx
  );
  return { leer: (p) => ventana.revisarFichasRetiro(p), reg, ventana, ctx, reloj };
}

test('lee las fichas del jugador y las deja donde las lee el resto del panel', async () => {
  const l = armarLector();
  const r = await l.leer({ usuario: 'Jugador_retiro', monto: 50000 });
  assert.equal(r.saldo, 50166.7);
  assert.equal(r.confiable, true);
  assert.equal(r.suficiente, true, 'alcanza para 50.000');
  assert.deepEqual(l.reg.lecturas.map((x) => [x.metodo, x.usuario, x.opts.skipBalance]), [['buscarUsuario', 'Jugador_retiro', false]]);
  assert.equal(l.ventana._retiroSaldoCheck.jugador_retiro.raw, 'ARS 50,166.70', 'la tarjeta de la lista lee de acá');
  assert.equal(l.reg.repintados, 1, 'y se repinta para mostrar "saldo … ✓"');
});

test('dice cuando NO alcanza', async () => {
  const l = armarLector();
  const r = await l.leer({ usuario: 'jugador_retiro', monto: 200000 });
  assert.equal(r.suficiente, false);
});

test('suelta los candados cuando termina, aunque falle', async () => {
  const bien = armarLector();
  await bien.leer({ usuario: 'a', monto: 1 });
  assert.equal(bien.reg.bloqueos, bien.reg.desbloqueos, 'candado maestro devuelto');
  assert.equal(bien.reg.wdLock, bien.reg.wdUnlock, 'candado del watchdog devuelto');

  const mal = armarLector();
  mal.ctx.callDrex = async () => { throw new Error('se cortó'); };
  const r = await mal.leer({ usuario: 'a', monto: 1 });
  assert.match(r.error, /casino no contestó/, 'el operador lee qué pasó, no el error interno');
  assert.ok(!/se cortó/.test(r.error));
  assert.equal(mal.reg.bloqueos, mal.reg.desbloqueos, 'si no, el agente queda trabado para siempre');
  assert.equal(mal.reg.wdLock, mal.reg.wdUnlock);
});

test('una lectura reciente se reusa sin molestar al agente; forzar vuelve a leer', async () => {
  const l = armarLector();
  await l.leer({ usuario: 'jugador_retiro', monto: 1000 });
  await l.leer({ usuario: 'jugador_retiro', monto: 1000 });
  assert.equal(l.reg.lecturas.length, 1, 'la segunda sale de la memoria');
  await l.leer({ usuario: 'jugador_retiro', monto: 1000, forzar: true });
  assert.equal(l.reg.lecturas.length, 2);
});

test('dos "Ver" a la vez sobre el mismo jugador comparten UNA lectura', async () => {
  const l = armarLector();
  const [a, b] = await Promise.all([l.leer({ usuario: 'jugador_retiro', monto: 1 }), l.leer({ usuario: 'jugador_retiro', monto: 1 })]);
  assert.equal(l.reg.lecturas.length, 1, 'el agente es uno solo');
  assert.equal(a.saldo, b.saldo);
});

test('si el agente está ocupado, espera a que se libere en vez de fallar de entrada', async () => {
  const l = armarLector({ ocupadoPor: 3 });
  const r = await l.leer({ usuario: 'jugador_retiro', monto: 1 });
  assert.equal(r.saldo, 50166.7, 'terminó leyendo');
  assert.equal(l.reg.lecturas.length, 1);
});

test('si el agente no se libera nunca, lo dice (y no se queda colgado)', async () => {
  const l = armarLector({ ocupadoPor: 1e9 });
  const r = await l.leer({ usuario: 'jugador_retiro', monto: 1 });
  assert.equal(r.ocupado, true);
  assert.match(r.error, /ocupado/);
  assert.equal(l.reg.lecturas.length, 0, 'no se tocó el agente');
  assert.equal(l.reg.bloqueos, l.reg.desbloqueos);
});

test('una sesión caída NO se confunde con "el usuario no existe"', async () => {
  const l = armarLector({ respuesta: { needsLogin: true } });
  const r = await l.leer({ usuario: 'jugador_retiro', monto: 1 });
  assert.match(r.error, /sesión de Agentes/);
  assert.equal(l.ventana._retiroSaldoCheck.jugador_retiro, undefined, 'no se guarda nada');
});

test('un usuario que el casino no encuentra se dice con su nombre', async () => {
  const l = armarLector({ respuesta: { exists: false } });
  const r = await l.leer({ usuario: 'fantasma', monto: 1 });
  assert.match(r.error, /fantasma/);
});

test('una lectura sin dígitos no se guarda como saldo', async () => {
  // Un "0" que en realidad es una lectura fallida, mostrado en la tarjeta como "saldo ⚠ no alcanza",
  // es peor que no decir nada.
  const l = armarLector({ respuesta: { exists: true, balance: { value: 0, raw: '' } } });
  const r = await l.leer({ usuario: 'jugador_retiro', monto: 5000 });
  assert.equal(r.confiable, false);
  assert.equal(l.ventana._retiroSaldoCheck.jugador_retiro, undefined);
  assert.equal(l.reg.repintados, 0);
});

test('fuera de la app de escritorio no puede leer y lo dice', async () => {
  const l = armarLector({ sinApp: true });
  const r = await l.leer({ usuario: 'jugador_retiro', monto: 1 });
  assert.match(r.error, /escritorio/);
  assert.equal(l.reg.lecturas.length, 0);
});

test('mirar NO rechaza nada: este camino no toca solicitudes', () => {
  // El auto-rechazo por falta de fichas es del escaneo en segundo plano, que confirma con una 2ª
  // lectura. "Ver" sólo lee: si leyera y rechazara, mirar un retiro lo rechazaría.
  const lector = cortar('window.revisarFichasRetiro = function', 'function abrirModalTransferirBilleteras(){');
  for (const prohibido of ['actualizarSolicitudPortal', 'RECHAZADA', 'registrarEnHistorial', 'notificarUsuarioEnChat']) {
    assert.ok(!lector.includes(prohibido), 'no debería nombrar "' + prohibido + '"');
  }
});
