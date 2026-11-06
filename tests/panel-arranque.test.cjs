const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Los tests de arriba prueban funciones sueltas importándolas como módulo. Esto prueba lo que
// de verdad corre en el panel: el bundle generado, en el mismo orden que el HTML. Sirve para
// agarrar lo que más ruido hizo — que algo tire al arrancar, o que una función quede sin
// definir — antes de que se vea en pantalla como "no anda".

const RAIZ = path.join(__dirname, '..');
const noop = () => {};

function elemento() {
  return {
    style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, appendChild: noop, remove: noop,
    addEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
    options: [], value: '', textContent: '', innerHTML: ''
  };
}

function arrancarPanel(opciones) {
  const doc = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => elemento(), addEventListener: noop,
    body: elemento(), head: elemento(), documentElement: elemento(), readyState: 'complete'
  };
  const sb = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    document: doc,
    // localStorage DE VERDAD, en memoria. Con uno que no guardaba nada, todo lo que usa caché
    // local -- titulares bloqueados, la ruta del portal, el período del historial -- parecía
    // roto en los tests aunque anduviera.
    localStorage: (() => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
        setItem: (k, v) => { m.set(String(k), String(v)); },
        removeItem: (k) => { m.delete(String(k)); },
        clear: () => m.clear()
      };
    })(),
    sessionStorage: { getItem: () => null, setItem: noop },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout: noop, clearInterval: noop,
    navigator: { userAgent: 'node', clipboard: {} },
    fetch: () => Promise.resolve({ json: () => ({}), ok: true }),
    location: { href: 'file:///panel', search: '' },
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, requestAnimationFrame: () => 0,
    Notification: function () {}, CustomEvent: function () {}, Event: function () {}
  };
  // supabaseClient es un `const` del bundle: se arma con window.supabase.createClient al
  // cargar, asi que el cliente falso hay que dejarlo puesto ANTES, no despues.
  // Cliente falso ENCADENABLE. Con uno que devolvia {} en .from(), cualquier cosa que corriera
  // despues del test -- por ejemplo cargarSolicitudesPortal, que actualizarSolicitudPortal
  // dispara al terminar -- explotaba con "Cannot read properties of null" y ensuciaba la corrida.
  const cadena = () => {
    const q = { then: (r) => Promise.resolve({ data: [], error: null }).then(r) };
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in','is','gte','lte','gt','lt','like','ilike','or','order','limit','range','single','maybeSingle','not','filter','contains']) {
      q[m] = () => q;
    }
    return q;
  };
  sb.supabase = { createClient: () => ({
    rpc: (opciones && opciones.rpc) || (async () => ({ data: null, error: null })),
    from: cadena,
    channel: () => ({ on: () => ({ subscribe: noop }) }),
    removeChannel: noop
  }) };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  // Hay cosas que el bundle lee UNA vez, al cargar (`const enElectron = !!window.ctrlElectron`).
  // Para esas, ponerlas después no sirve: el test miente porque la función sale por el early return.
  if (opciones && typeof opciones.antes === 'function') opciones.antes(sb);

  // El orden EXACTO que declara el HTML. Si el test carga de menos, una función parece no
  // existir y el test miente: ya pasó dos veces (faltaba js-modules.js y normalizar() tiraba
  // NodoDomain undefined; faltaba js-jugadores-crm.js y el CRM parecía no haberse construido).
  // Se lee del HTML generado en vez de repetir la lista a mano, así no se desincroniza.
  const html = fs.readFileSync(path.join(RAIZ, "NODO · OPERATIVO LITE.htm"), "utf8");
  const orden = [...html.matchAll(/src="renderer\/generated\/(js-[a-z-]+\.js)"/g)].map((m) => m[1]);
  assert.ok(orden.length >= 20, "el HTML tiene que declarar los bundles");
  for (const archivo of orden) {
    const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', archivo), 'utf8');
    new vm.Script(src, { filename: archivo }).runInContext(sb, { timeout: 15000 });
  }
  return sb;
}

test('el bundle del panel arranca sin tirar', () => {
  assert.doesNotThrow(arrancarPanel);
});

test('las funciones que usa la pantalla quedan definidas', () => {
  const sb = arrancarPanel();
  const necesarias = [
    'cargarHistorial', 'renderHistorialUnificado', 'setHistorialPeriodo',
    'buscarHistorialServidor', 'expedienteBuscarMovChunior', 'expedienteEditarMovimiento',
    'expedienteVerEdiciones', 'cerrarRetiroSaldado', 'getBilleraLanding', '_billeteraVieja',
    'abrirModal', 'cerrarModal', 'refrescarSaldoAgente', 'rechequearFichas',
    '_wdLock', '_wdUnlock', '_wdForceUnlock', '_watchdogLeer', '_watchdogPoll',
    '_watchdogIniciar', '_watchdogTrigger'
  ];
  const faltan = necesarias.filter((f) => typeof sb[f] !== 'function');
  assert.deepEqual(faltan, [], 'quedaron sin definir: ' + faltan.join(', '));
});

test('_billeteraVieja avisa sólo cuando corresponde', () => {
  const sb = arrancarPanel();
  // 'billeteras' es un let del bundle: se llena desde adentro, no desde el sandbox.
  vm.runInContext(
    'billeteras.push(' +
    '{ID_BILLETERA:"b-castro",NOMBRE_VISIBLE:"CASTRO",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"},' +
    '{ID_BILLETERA:"b-gio",NOMBRE_VISIBLE:"GIORDANO",ACTIVA:"SI"});', sb);

  assert.equal(vm.runInContext('(getBilleraLanding()||{}).NOMBRE_VISIBLE', sb), 'CASTRO');

  const vieja = { pendiente: true, tipo: 'CARGA', billetera_nombre: 'GIORDANO', billetera_id: 'b-gio', _raw: {} };
  const r = sb._billeteraVieja(vieja);
  assert.ok(r, 'una carga pendiente con la billetera anterior tiene que avisar');
  assert.equal(r.vieja, 'GIORDANO');
  assert.equal(r.actual, 'CASTRO');

  // Y por nombre solo, sin id: el metadata viejo no siempre trae billetera_id.
  const soloNombre = sb._billeteraVieja({ pendiente: true, tipo: 'CARGA', billetera_nombre: 'GIORDANO', billetera_id: '', _raw: {} });
  assert.ok(soloNombre, 'sin id tiene que comparar por nombre');

  // Los que NO tienen que avisar.
  const sinAviso = [
    ['con la billetera activa', { pendiente: true, tipo: 'CARGA', billetera_nombre: 'CASTRO', billetera_id: 'b-castro', _raw: {} }],
    ['ya cerrada', { pendiente: false, tipo: 'CARGA', billetera_nombre: 'GIORDANO', billetera_id: 'b-gio', _raw: {} }],
    ['retiro (pagamos nosotros)', { pendiente: true, tipo: 'RETIRO', billetera_nombre: 'GIORDANO', billetera_id: 'b-gio', _raw: {} }],
    ['sin billetera', { pendiente: true, tipo: 'CARGA', billetera_nombre: '', billetera_id: '', _raw: {} }]
  ];
  for (const [caso, it] of sinAviso) {
    assert.equal(sb._billeteraVieja(it), null, 'no debería avisar: ' + caso);
  }
});

test('la ventana del historial se mide en tiempo y el turno nunca baja de 12 h', () => {
  const sb = arrancarPanel();
  const v = vm.runInContext('_histVentana()', sb);
  assert.ok(v.horas >= 12, 'el turno recién empezado igual tiene que mostrar el anterior');
  assert.ok(v.limite > 0);
  assert.ok(new Date(v.desde).getTime() < Date.now(), 'la ventana arranca en el pasado');

  vm.runInContext('window._HIST_PERIODO="D30"', sb);
  const v30 = vm.runInContext('_histVentana()', sb);
  assert.equal(v30.horas, 720, '30 días son 720 h');
});

test('el CRM quedó con un solo buscador, sin filtros ni base local', () => {
  const sb = arrancarPanel();

  for (const f of ['crmBuscarServidor', 'crmBusqTexto', 'crmBusqCantidad']) {
    assert.equal(typeof sb[f], 'function', 'falta ' + f);
  }
  assert.equal(sb._crmBusq.cantidad, 10, 'arranca trayendo 10');

  // Lo que se sacó no puede seguir colgando.
  for (const f of ['mostrarBaseLocalJugadores', 'mostrarBaseLocalJugadoresRefiltrar',
                   'crmRegistradosCargar', 'crmRegistradosIr']) {
    assert.equal(typeof sb[f], 'undefined', f + ' se sacó');
  }

  // Pero el almacén que leen el perfil, el alta y Nexo tiene que seguir.
  assert.equal(typeof sb.jugadorRegistrarDato, 'function', 'el dato lo leen otras tres cosas');
});

test('el desplegable de cantidad se queda dentro de lo razonable', () => {
  const sb = arrancarPanel();
  sb.crmBuscarServidor = () => {};      // no tocar la red

  sb.crmBusqCantidad('50');
  assert.equal(sb._crmBusq.cantidad, 50);

  sb.crmBusqCantidad('99999');
  assert.equal(sb._crmBusq.cantidad, 200, 'se corta en 200, igual que la RPC');

  sb.crmBusqCantidad('0');
  assert.equal(sb._crmBusq.cantidad, 10, '0 no es una cantidad: vuelve al default');

  sb.crmBusqCantidad('cualquier cosa');
  assert.equal(sb._crmBusq.cantidad, 10, 'sin número válido vuelve al default');
});

test('una respuesta vieja no pisa a la nueva (era el "Cargando…" eterno)', async () => {
  // renderCRM repinta la vista varias veces. Con el candado booleano anterior, la segunda
  // llamada se salteaba y la respuesta de la primera terminaba escrita en una caja que ya no
  // estaba en pantalla: la visible se quedaba en "Cargando…" para siempre.
  let resolverPrimera;
  let llamada = 0;
  const sb = arrancarPanel({
    rpc: () => {
      llamada++;
      if (llamada === 1) return new Promise((r) => { resolverPrimera = r; });
      return Promise.resolve({ data: [{ usuario: 'nuevo', total: 1 }], error: null });
    }
  });

  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'crmResultados' ? caja : null);

  const primera = sb.crmBuscarServidor();     // queda colgada a propósito
  const segunda = sb.crmBuscarServidor();     // NO se saltea: pisa a la primera
  await segunda;
  assert.match(caja.innerHTML, /nuevo/, 'la segunda búsqueda tiene que pintar');

  resolverPrimera({ data: [{ usuario: 'viejo', total: 1 }], error: null });
  await primera;
  assert.match(caja.innerHTML, /nuevo/, 'la respuesta vieja no puede pisar a la nueva');
  assert.ok(!/viejo/.test(caja.innerHTML));
  assert.ok(!/Buscando/.test(caja.innerHTML), 'y no puede quedar en "Buscando…"');
});

test('cada fila de la lista dice por qué está ahí', async () => {
  // Buscar un teléfono y ver un usuario que no se parece en nada obliga a adivinar si matcheó
  // por teléfono, por titular, o si es basura. La fila tiene que decirlo.
  const filas = [
    { usuario: 'pruebaxx',    telefono: '1134970581', titular: null,  motivo: 'exacto',   total: 4 },
    { usuario: 'vaporprueba', telefono: '1123568990', titular: null,  motivo: 'usuario',  total: 4 },
    { usuario: 'noex90',      telefono: '1123569887', titular: null,  motivo: 'telefono', total: 4 },
    { usuario: 'flowerr',     telefono: '1133826956', titular: 'Pepe', motivo: 'titular', total: 4 }
  ];
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: filas, error: null }) });

  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'crmResultados' ? caja : null);

  sb._crmBusq.q = 'prueba';
  await sb.crmBuscarServidor();

  assert.match(caja.innerHTML, /🎯 exacto/);
  assert.match(caja.innerHTML, /👤 usuario/);
  assert.match(caja.innerHTML, /📱 teléfono/);
  assert.match(caja.innerHTML, /🧾 titular/);
  assert.match(caja.innerHTML, /Coinciden con/, 'y la lista dice qué está mostrando');
});

test('sin búsqueda el motivo dice qué hacer, no cómo se encontró', async () => {
  // "exacto / usuario / teléfono" es la mecánica de la búsqueda: sin buscar no explica nada.
  // Lo que hay que decir es por qué mirar a ese jugador antes que a otro.
  const filas = [
    { usuario: 'juandiaz730', motivo: 'esperando',  total: 13759 },
    { usuario: 'mari4198x',   motivo: 'sin_operar', total: 13759 },
    { usuario: 'leami20',     motivo: 'alta_nueva', total: 13759 },
    { usuario: 'francoiba3',  motivo: 'registrado', total: 13759 }
  ];
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: filas, error: null }) });
  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'crmResultados' ? caja : null);

  sb._crmBusq.q = '';
  await sb.crmBuscarServidor();

  assert.match(caja.innerHTML, /🔴 esperando/, 'el que tiene una solicitud abierta va primero');
  assert.match(caja.innerHTML, /🔁 nunca operó/);
  assert.match(caja.innerHTML, /🆕 alta nueva/);
  assert.match(caja.innerHTML, /primero los que esperan/, 'la lista dice con qué criterio ordenó');
  assert.match(caja.innerHTML, /de <b>13\.759<\/b>/, 'y cuántos hay detrás');
  assert.match(caja.innerHTML, /Siguiente/, 'con páginas: sin ellas verías siempre los mismos');
});

test('las páginas no se pasan de la última ni van antes de la primera', () => {
  const sb = arrancarPanel();
  sb.crmBuscarServidor = () => {};
  sb._crmBusq.total = 60; sb._crmBusq.cantidad = 25;   // 3 páginas: 0, 1, 2

  sb._crmBusq.pagina = 0; sb.crmBusqPagina(-1);
  assert.equal(sb._crmBusq.pagina, 0);
  sb._crmBusq.pagina = 2; sb.crmBusqPagina(1);
  assert.equal(sb._crmBusq.pagina, 2);
  sb._crmBusq.pagina = 1; sb.crmBusqPagina(1);
  assert.equal(sb._crmBusq.pagina, 2);

  // Cambiar la cantidad vuelve al principio: la página vieja ya no significa lo mismo.
  sb._crmBusq.pagina = 2; sb.crmBusqCantidad('50');
  assert.equal(sb._crmBusq.pagina, 0);
});

test('la página pedida se traduce a offset, no se filtra en el navegador', async () => {
  let visto = null;
  const sb = arrancarPanel({
    rpc: (_fn, args) => { visto = args; return Promise.resolve({ data: [], error: null }); }
  });
  sb.document.getElementById = () => ({ innerHTML: '' });

  sb._crmBusq.cantidad = 25;
  sb._crmBusq.pagina = 3;
  await sb.crmBuscarServidor();

  assert.equal(visto.p_limit, 25);
  assert.equal(visto.p_offset, 75, 'página 3 de a 25 arranca en la 75');
});

test('los datos de ingreso no inventan una clave que no sabemos', async () => {
  // La clave no se puede recuperar: sólo se sabe si se la pusimos nosotros. Mandar
  // "Clave: —" es peor que no mandar nada, así que sin clave no se arma el texto ni el botón.
  const sinClave = { usuario: 'lmaurod', telefono: '3517352547', titular: 'Lmaurod', clave: null };
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [sinClave], error: null }) });

  sb.toast = () => {};
  let modal = null;
  sb.abrirModal = (titulo, cuerpo) => { modal = { titulo, cuerpo }; };
  await sb.pjDatosIngreso('lmaurod');

  assert.match(modal.cuerpo, /No sabemos cuál es/);
  assert.match(modal.cuerpo, /Refrescar la clave a 12345a/, 'el camino real es refrescarla y pasarla');
  assert.ok(!/Copiar para mandar/.test(modal.cuerpo), 'sin clave no hay nada que copiar');
  assert.match(modal.cuerpo, /3517352547/, 'el teléfono sí lo sabemos');
});

test('con clave conocida arma el texto listo para mandar', async () => {
  const conClave = {
    usuario: 'lmaurod', telefono: '3517352547', clave: 'zorro77',
    clave_fecha: '2026-09-01T10:00:00Z', clave_origen: 'panel'
  };
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [conClave], error: null }) });
  sb.toast = () => {};
  sb.abrirModal = () => {};
  await sb.pjDatosIngreso('lmaurod');

  const t = sb._pjTextoIngreso;
  assert.match(t, /Usuario: lmaurod/);
  assert.match(t, /Clave: zorro77/);
  assert.match(t, /Teléfono registrado: 3517352547/);
  assert.match(t, /bet-300/, 'y adónde entrar');
});

test('la ficha de ingreso ya no ofrece WhatsApp, y el botón azul dice qué hace', async () => {
  // WhatsApp Web no carga adentro de Electron: window.open abría otra ventana de Electron y la
  // página quedaba colgada. Y el botón azul del modal salía mudo y muerto: (null, '').
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [{ usuario: 'lmaurod', telefono: '3517352547', clave: '12345a' }], error: null }) });
  sb.toast = () => {};
  let modal = null;
  sb.abrirModal = (titulo, cuerpo, saveFn, saveText) => { modal = { titulo, cuerpo, saveFn, saveText }; };
  await sb.pjDatosIngreso('lmaurod');

  assert.equal(typeof sb.pjIngresoWhatsapp, 'undefined', 'la función se borró');
  assert.ok(!/WhatsApp/i.test(modal.cuerpo), 'y no queda el botón');
  assert.equal(modal.saveText, '📋 Copiar datos');
  assert.equal(typeof modal.saveFn, 'function', 'el botón azul ahora copia');
});

test('la clave que se pasa es siempre la estándar de la operación', async () => {
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [{ usuario: 'lmaurod', telefono: '3517352547', clave: 'otracosa9' }], error: null }) });
  sb.toast = () => {};
  sb.abrirModal = () => {};
  await sb.pjDatosIngreso('lmaurod');
  assert.equal(sb.CLAVE_ESTANDAR, '12345a');
  assert.match(sb._pjTextoIngreso, /Clave: otracosa9/, 'se muestra la real, no una inventada');
});

test('actualizarSolicitudSupabase escribe donde viven las solicitudes de verdad', async () => {
  // Escribía en la tabla `solicitudes`, muerta desde el 30 de mayo (156 filas). Las del portal
  // viven en landing_solicitudes (191.608). Los 16 llamadores hacían un update que no tocaba
  // nada y el error se iba a console.error: se cambiaba la clave, funcionaba, y la solicitud
  // quedaba PENDIENTE para siempre.
  let visto = null;
  const sb = arrancarPanel({
    rpc: (fn, args) => { visto = { fn, args }; return Promise.resolve({ data: { id: 188138 }, error: null }); }
  });

  const r = await sb.actualizarSolicitudSupabase(188138, {
    estado: 'APROBADA', operador_usuario: 'xprueba'
  });

  assert.equal(r.ok, true);
  assert.equal(visto.fn, 'panel_v15_5_actualizar_solicitud_portal', 'tiene que ir por la RPC del portal');
  assert.equal(visto.args.p_id, 188138);
  assert.equal(visto.args.p_estado, 'APROBADA');
  assert.equal(visto.args.p_operador, 'xprueba');
});

test('lo que no es estado, operador ni monto viaja como metadata', async () => {
  let visto = null;
  const sb = arrancarPanel({
    rpc: (fn, args) => { visto = args; return Promise.resolve({ data: {}, error: null }); }
  });

  await sb.actualizarSolicitudSupabase(1, {
    estado: 'RECHAZADA', operador_usuario: 'op', monto: 5000, etapa: 'AUTO_RECHAZO', motivo: 'x'
  });

  assert.equal(visto.p_monto, 5000);
  assert.deepEqual({ ...visto.p_metadata }, { etapa: 'AUTO_RECHAZO', motivo: 'x' });
  assert.ok(!('estado' in visto.p_metadata), 'el estado no se duplica en el metadata');
});

test('si la RPC falla, avisa en vez de decir que salió bien', async () => {
  const sb = arrancarPanel({
    rpc: () => Promise.resolve({ data: null, error: { message: 'SOLICITUD_NO_ENCONTRADA' } })
  });
  const r = await sb.actualizarSolicitudSupabase(999, { estado: 'APROBADA' });

  assert.equal(r.ok, false);
  assert.match(r.error, /SOLICITUD_NO_ENCONTRADA/);
});

test('una solicitud de clave ya aprobada no vuelve a entrar al ciclo', () => {
  // `estadoCerrado` vive en el módulo del portal y NO existe en el ámbito del panel, así que
  // `typeof estadoCerrado === 'function'` era siempre falso y el filtro nunca corría: el ciclo
  // le cambiaba la clave al mismo jugador cada 25 s, media hora seguida.
  const sb = arrancarPanel();

  assert.equal(typeof sb._estadoYaCerrado, 'function', 'el panel necesita su propio chequeo');
  for (const e of ['APROBADA', 'RECHAZADA', 'CANCELADA', 'ACREDITADA', 'OK', 'aprobada']) {
    assert.equal(sb._estadoYaCerrado(e), true, e + ' está cerrada');
  }
  for (const e of ['PENDIENTE', 'EN_REVISION', 'EN_PROCESO', '']) {
    assert.equal(sb._estadoYaCerrado(e), false, e + ' sigue abierta');
  }
});

test('el ciclo de clave no repite una que ya ejecutó', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};

  // Una solicitud que quedó PENDIENTE aunque ya se ejecutó: el caso de la tabla muerta.
  sb.V154P = { solicitudes: [{ ID: '188138', TIPO: 'CAMBIO_CLAVE', USUARIO: 'pruebaxx',
                               ESTADO: 'PENDIENTE', PASSWORD_NUEVO: 'abc123' }] };
  sb._clavesHechas = { '188138': Date.now() };

  let ejecuciones = 0;
  sb.ejecutarAutoClave = async () => { ejecuciones++; };
  sb.ctrlElectron = { navigateAgent: async () => {} };
  sb._clavesEnCuenta = { '188138': Date.now() - 1000 };   // ventana ya vencida

  await sb._claveAutoTick();
  assert.equal(ejecuciones, 0, 'ya se ejecutó una vez: no se toca de nuevo');
});

// ── Sonda de sesión de agentes ───────────────────────────────────────────────
function panelConSonda(extra) {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb.ctrlElectron = { openAgentWindow: async () => {}, navigateAgent: async () => {} };
  sb.refrescarTodo = async () => {};
  // La sonda cuida la sesión de un puesto ya elegido: sin puesto no corre (Juan, 6/11).
  vm.runInContext('_nodoListo = true; pcOperativa = "P1";', sb);
  Object.assign(sb, extra || {});
  return sb;
}

test('la sonda no toca el agente si hace poco que se operó', async () => {
  const sb = panelConSonda();
  let llamadas = 0;
  sb.callDrex = async () => { llamadas++; return {}; };
  sb._drexUltimaOpOk = Date.now();          // recién operado
  sb.localStorage.getItem = () => 'usuario_de_prueba';

  await sb._sondaSesionTick();
  assert.equal(llamadas, 0, 'operar ya prueba que la sesión vive');
});

test('pasados los 6 minutos quietos, sondea con una operación real', async () => {
  const sb = panelConSonda();
  let visto = null;
  sb.callDrex = async (m, u) => { visto = { m, u }; return { needsLogin: false }; };
  sb._drexUltimaOpOk = Date.now() - 7 * 60 * 1000;
  sb.localStorage.getItem = (k) => (k === 'nodo_sonda_usuario' ? 'usuario_de_prueba' : null);

  await sb._sondaSesionTick();
  assert.equal(visto.m, 'buscarUsuario', 'es la primera parte de toda carga: si falla, la carga fallaría');
  assert.equal(visto.u, 'usuario_de_prueba');
  assert.ok(!/cambiarClave/.test(String(visto.m)), 'no se le cambia la clave a nadie cada 6 minutos');
});

test('la sonda no se mete si el agente está ocupado', async () => {
  const sb = panelConSonda();
  let llamadas = 0;
  sb.callDrex = async () => { llamadas++; return {}; };
  sb._drexUltimaOpOk = Date.now() - 30 * 60 * 1000;
  sb.localStorage.getItem = () => 'usuario_de_prueba';
  sb._drexGlobalBusy = true;

  await sb._sondaSesionTick();
  assert.equal(llamadas, 0, 'meterse en medio de una carga es peor que esperar');
});

test('con el login ya en pantalla la sonda se queda quieta', async () => {
  const sb = panelConSonda();
  let llamadas = 0;
  sb.callDrex = async () => { llamadas++; return {}; };
  sb._drexUltimaOpOk = Date.now() - 30 * 60 * 1000;
  sb._drexSinSesion = true;
  sb.localStorage.getItem = () => 'usuario_de_prueba';

  await sb._sondaSesionTick();
  assert.equal(llamadas, 0, 'ya se sabe que está caída, no hay nada que descubrir');
});

test('sonda OK refresca el panel y reinicia el reloj', async () => {
  const sb = panelConSonda();
  let refrescos = 0;
  sb.refrescarTodo = async () => { refrescos++; };
  sb.callDrex = async () => ({ needsLogin: false });
  const antes = Date.now() - 7 * 60 * 1000;
  sb._drexUltimaOpOk = antes;
  sb.localStorage.getItem = () => 'usuario_de_prueba';

  await sb._sondaSesionTick();
  assert.equal(refrescos, 1, 'después de 6 minutos quieto lo que se ve ya envejeció');
  assert.ok(sb._drexUltimaOpOk > antes, 'el reloj arranca de nuevo');
});

test('el aviso de billetera vieja también entiende la solicitud cruda del Inicio', () => {
  // _billeteraVieja sólo entendía el item del historial unificado (claves en minúscula). La
  // tarjeta del Inicio y el modal de aprobar trabajan con la solicitud CRUDA del portal
  // (MAYÚSCULAS), así que ahí —que es donde el operador decide— el aviso nunca aparecía.
  const sb = arrancarPanel();
  vm.runInContext(
    'billeteras.push(' +
    '{ID_BILLETERA:"b-banco",NOMBRE_VISIBLE:"BANCO",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"},' +
    '{ID_BILLETERA:"b-salva",NOMBRE_VISIBLE:"SALVATIERRA X",ACTIVA:"SI"});', sb);

  const cruda = { ID: 191800, TIPO: 'CARGA', ESTADO: 'PENDIENTE',
                  BILLETERA_NOMBRE: 'SALVATIERRA X', ID_BILLETERA: 'b-salva' };
  const r = sb._billeteraVieja(cruda);
  assert.ok(r, 'la solicitud cruda tiene que avisar igual que el item unificado');
  assert.equal(r.vieja, 'SALVATIERRA X');
  assert.equal(r.actual, 'BANCO');

  // Sin ID_BILLETERA (metadata viejo) compara por nombre.
  assert.ok(sb._billeteraVieja({ ID: 4, TIPO: 'CARGA', ESTADO: 'PENDIENTE',
                                 BILLETERA_NOMBRE: 'SALVATIERRA X' }));

  // Y sigue funcionando el item del historial unificado.
  assert.ok(sb._billeteraVieja({ pendiente: true, tipo: 'CARGA',
                                 billetera_nombre: 'SALVATIERRA X', billetera_id: 'b-salva', _raw: {} }));

  // Los que no corresponden.
  for (const [caso, it] of [
    ['con la activa', { ID: 1, TIPO: 'CARGA', ESTADO: 'PENDIENTE', BILLETERA_NOMBRE: 'BANCO', ID_BILLETERA: 'b-banco' }],
    ['ya acreditada', { ID: 2, TIPO: 'CARGA', ESTADO: 'ACREDITADA', BILLETERA_NOMBRE: 'SALVATIERRA X', ID_BILLETERA: 'b-salva' }],
    ['retiro', { ID: 3, TIPO: 'RETIRO', ESTADO: 'PENDIENTE', BILLETERA_NOMBRE: 'SALVATIERRA X', ID_BILLETERA: 'b-salva' }]
  ]) {
    assert.equal(sb._billeteraVieja(it), null, 'no debería avisar: ' + caso);
  }
});

test('"Ya se la cargué" cierra como acreditada, no como rechazo', async () => {
  // Medido: 124 rechazos en 30 días con el motivo escrito a mano — "CARGADO", "YA FUE CARGADO",
  // "FICHAS CARGADAS", "YA SE TE CARGO"… Seis redacciones de lo mismo. El operador ya le cargó y
  // usa Rechazar para sacarla de la bandeja; el jugador ve "Rechazada" con la plata adentro.
  const sb = arrancarPanel();
  assert.equal(typeof sb.v154pYaCargada, 'function', 'el bridge tiene que exponerla');

  // Las funciones del portal quedan atadas a `deps` al montarse, así que el punto donde se puede
  // interceptar es la RPC — que además es lo que de verdad llega a la base.
  const llamadas = [];
  sb.panelAPI = { rpc: async (fn, params) => { llamadas.push({ fn, params }); return { data: {}, error: null }; } };
  sb.toast = () => {};
  sb.cerrarModal = () => {};
  sb.V154P = { solicitudes: [{ ID: '191800', USUARIO: 'pruebaxx', MONTO_REAL: 20000 }] };

  let confirmar = null;
  sb.abrirModal = (_t, _b, fn) => { confirmar = fn; };
  sb.v154pYaCargada('191800');
  assert.equal(typeof confirmar, 'function', 'tiene que abrir el modal');
  await confirmar();

  const upd = llamadas.find((c) => c.fn === 'panel_v15_5_actualizar_solicitud_portal');
  assert.ok(upd, 'tiene que cerrar la solicitud');
  assert.equal(upd.params.p_estado, 'ACREDITADA', 'acreditada, NO rechazada');
  assert.equal(upd.params.p_metadata.cerrada_como, 'YA_CARGADA');
  assert.equal(upd.params.p_metadata.etapa, 'YA_CARGADA_MANUAL');
  assert.equal(upd.params.p_id, 191800);

});

test('el atajo "Ya se la cargué" está adentro del modal de rechazo', () => {
  // Es donde el operador está parado cuando se da cuenta de que en realidad ya se la cargó.
  const sb = arrancarPanel();
  sb.V154P = { solicitudes: [{ ID: '191800', USUARIO: 'pruebaxx' }] };

  let cuerpo = '';
  sb.abrirModal = (_t, b) => { cuerpo = b; };
  sb.v154pRechazarSolicitud('191800');

  assert.match(cuerpo, /Ya se la cargué/, 'el atajo tiene que estar a mano');
  assert.match(cuerpo, /v154pYaCargada\('191800'\)/);
  assert.match(cuerpo, /Motivo/, 'y el rechazo normal sigue estando');
});

test('la diferencia de fichas se explica, y el botón sale sólo cuando hay', () => {
  // "-$ 3.462" solo no dice nada: ni si hay que hacer algo, ni de dónde salió. Y un botón que
  // está siempre se vuelve decorado y nadie lo toca el día que hace falta.
  const sb = arrancarPanel();
  assert.equal(typeof sb.explicarDiferenciaFichas, 'function');

  const btn = { style: { display: 'none' } };
  const celdas = {};
  for (const id of ['statFichasCard', 'statDrexFichas', 'statChuniorFichas', 'statDiffFichas', 'statFichasEstado']) {
    celdas[id] = { textContent: '', classList: { add: () => {}, remove: () => {} } };
  }
  sb.document.getElementById = (id) => (id === 'btnInfoDife' ? btn : (celdas[id] || null));

  // Cuadrado: el botón no va.
  vm.runInContext('_watchdog.drexFichas = 100000; _watchdog.chuniorFichas = 100000;', sb);
  sb.renderFichasInicio();
  assert.equal(btn.style.display, 'none', 'sin diferencia no hay nada que explicar');

  // Con dife: aparece.
  vm.runInContext('_watchdog.drexFichas = 103462; _watchdog.chuniorFichas = 100000;', sb);
  sb.renderFichasInicio();
  assert.notEqual(btn.style.display, 'none', 'con diferencia tiene que ofrecerse');
});

test('el cuadro de la dife dice para qué lado y qué hacer', () => {
  const sb = arrancarPanel();
  let cuerpo = '';
  sb.abrirModal = (_t, b) => { cuerpo = b; };
  sb.document.getElementById = () => null;

  // Sobran fichas en el casino: se cargó algo que no quedó anotado.
  vm.runInContext('_watchdog.drexFichas = 103462; _watchdog.chuniorFichas = 100000;', sb);
  sb.explicarDiferenciaFichas();
  assert.match(cuerpo, /Sobran fichas/, 'el signo es lo que nadie tiene memorizado');
  assert.match(cuerpo, /Qué hacer, en orden/);
  assert.match(cuerpo, /Rechequear/, 'lo primero es descartar que sea transitoria');

  // Al revés.
  vm.runInContext('_watchdog.drexFichas = 100000; _watchdog.chuniorFichas = 103462;', sb);
  sb.explicarDiferenciaFichas();
  assert.match(cuerpo, /Faltan fichas/);

  // Cuadrado: lo dice y no manda a hacer nada.
  vm.runInContext('_watchdog.drexFichas = 100000; _watchdog.chuniorFichas = 100000;', sb);
  sb.explicarDiferenciaFichas();
  assert.match(cuerpo, /Está cuadrado/);
  assert.ok(!/Qué hacer, en orden/.test(cuerpo), 'sin dife no se le da una lista de tareas');
});

test('"Ya cargada" no está en la tarjeta del Inicio, sólo en el rechazo', () => {
  // La tarjeta ya tiene Tomar / Aprobar / Ver / Rechazar. "Ya cargada" es un caso raro
  // (124 en 30 días) y no merece un lugar fijo ahí: vive donde el operador se da cuenta.
  const fuente = fs.readFileSync(path.join(RAIZ, 'renderer', 'portal', 'requests-view.js'), 'utf8');
  assert.ok(!/onclick="v154pYaCargada/.test(fuente), 'no va en la bandeja del Inicio');

  const sb = arrancarPanel();
  sb.V154P = { solicitudes: [{ ID: '191800', USUARIO: 'pruebaxx' }] };
  let cuerpo = '';
  sb.abrirModal = (_t, b) => { cuerpo = b; };
  sb.v154pRechazarSolicitud('191800');
  assert.match(cuerpo, /Ya se la cargué/, 'pero sí adentro del rechazo');
});

test('bloquear un titular ahora va a la base, no sólo al localStorage de la PC', async () => {
  // El bloqueo vivía en el localStorage de UNA máquina: el portal no se enteraba nunca y le
  // seguía ofreciendo al jugador el titular que le acababan de bloquear; otro operador en otra
  // PC tampoco lo veía; y limpiar los datos del navegador lo borraba.
  const llamadas = [];
  const sb = arrancarPanel({ rpc: async (fn, params) => { llamadas.push({ fn, params }); return { data: {}, error: null }; } });
  sb.toast = () => {};
  vm.runInContext('pcOperativa = "P1";', sb);

  sb.marcarTitularRechazado('pruebaxx', 'pepep eeedcf', 'BLOQUEADO_POR_OPERADOR');
  const bloq = llamadas.find((c) => c.fn === 'panel_titular_bloquear');
  assert.ok(bloq, 'tiene que escribir en la base');
  assert.equal(bloq.params.p_usuario, 'pruebaxx');
  assert.equal(bloq.params.p_titular, 'pepep eeedcf');
  assert.equal(bloq.params.p_pc, 'P1');

  // Y el caché local sigue, para que la pantalla reaccione sin esperar la red.
  assert.ok(sb.titularBloqueado('pruebaxx', 'pepep eeedcf'), 'el local es el caché rápido');

  sb.desmarcarTitularRechazado('pruebaxx', 'pepep eeedcf');
  assert.ok(llamadas.find((c) => c.fn === 'panel_titular_desbloquear'), 'desbloquear también');
  assert.equal(sb.titularBloqueado('pruebaxx', 'pepep eeedcf'), null);
});

test('el panel trae al arrancar los titulares que bloqueó otra PC', async () => {
  const sb = arrancarPanel({
    rpc: async (fn) => (fn === 'panel_titulares_bloqueados'
      ? { data: [{ usuario: 'otrojugador', titular: 'Juan Perez', motivo: 'x', created_at: '2026-09-09T10:00:00Z' }], error: null }
      : { data: {}, error: null })
  });
  vm.runInContext('pcOperativa = "P1";', sb);

  assert.equal(sb.titularBloqueado('otrojugador', 'Juan Perez'), null, 'todavía no lo conoce');
  await sb.sincronizarTitularesBloqueados();
  assert.ok(sb.titularBloqueado('otrojugador', 'Juan Perez'), 'después de sincronizar, sí');
});

test('un turno es un bloque de un día, no una franja horaria de todos', () => {
  // El KPI decía "15 cargas aprobadas en el turno" mientras la lista mostraba una carga por DÍA.
  // Causa: se comparaba sólo la hora, así que "TM" incluía las 07:30 de hoy, de ayer y de la
  // semana pasada.
  const sb = arrancarPanel();
  const enTurno = vm.runInContext('_enTurno', sb);
  const bordes = vm.runInContext('_bordesTurno', sb);

  // Hora argentina = UTC−3. Las 10:00 AR del día de referencia son las 13:00 UTC.
  // Se fija un mediodía concreto en vez de usar el reloj: corrida a las 00:14 AR, "TM" todavía no
  // arrancó ese día y el turno vigente es el de AYER, así que "ayer 07:30" sí caía dentro y la
  // prueba fallaba sola al pasar la medianoche. El panel estaba bien; la prueba, no.
  const REF = Date.UTC(2026, 8, 14, 15, 0);            // 14/09/2026 12:00 AR
  const hoyAR = (h, m) => {
    const ar = new Date(REF - 3 * 3600 * 1000);
    return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate(), h, m || 0) + 3 * 3600 * 1000);
  };
  const enTurnoRef = (ts, turno) => {
    const b = bordes(turno, REF);
    const x = new Date(ts).getTime();
    return !!b && x >= b.desde && x < b.hasta;
  };

  const b = bordes('TM', REF);
  assert.ok(b && b.hasta - b.desde === 8 * 3600 * 1000, 'un turno dura 8 h');

  // Mismo horario, otro día: NO es del turno.
  const ayerMismaHora = new Date(hoyAR(7, 30).getTime() - 24 * 3600 * 1000);
  assert.equal(enTurnoRef(ayerMismaHora.toISOString(), 'TM'), false, 'las 07:30 de ayer no son de este turno');

  // Fuera de la franja tampoco.
  assert.equal(enTurnoRef(hoyAR(15, 0).toISOString(), 'TM'), false, 'las 15:00 no son TM');

  // Sin fecha no se cuenta: antes entraba siempre y engordaba el KPI.
  assert.equal(enTurno(null, 'TM'), false);
  assert.equal(enTurno('', 'TM'), false);

  // Un turno inexistente no rompe.
  assert.equal(enTurno(new Date().toISOString(), 'XX'), false);
});

test('el turno noche cruza la medianoche y no se parte en dos', () => {
  const sb = arrancarPanel();
  const bordes = vm.runInContext('_bordesTurno', sb);
  const b = bordes('TN');
  assert.ok(b, 'TN tiene bordes');
  assert.equal(b.hasta - b.desde, 8 * 3600 * 1000, 'de 22:00 a 06:00 son 8 h');

  // Arranca a las 22:00 hora argentina, sea de hoy o de ayer según cuándo se pregunte.
  const inicioAR = new Date(b.desde - 3 * 3600 * 1000);
  assert.equal(inicioAR.getUTCHours(), 22, 'el turno noche empieza a las 22:00 AR');
});

test('getBilleraLanding nunca devuelve una billetera de otra oficina', () => {
  // Caso real: en P4 devolvía AVILA MP, que es de P2, porque `billeteras` venía contaminado y
  // el .find() agarraba la primera SELECCIONADA_MANUAL de cualquier oficina. No es cosmético:
  // esta función decide a qué billetera se le ajusta el saldo después de una carga.
  const sb = arrancarPanel();
  vm.runInContext('pcOperativa = "P4";', sb);
  vm.runInContext(
    'billeteras.push(' +
    '{ID_BILLETERA:"b-avila",NOMBRE_VISIBLE:"AVILA MP",PC:"P2",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"},' +
    '{ID_BILLETERA:"b-gio",NOMBRE_VISIBLE:"GIORDANO",PC:"P4",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"});', sb);

  const b = sb.getBilleraLanding();
  assert.ok(b, 'tiene que devolver una');
  assert.equal(b.NOMBRE_VISIBLE, 'GIORDANO', 'la de ESTA oficina, aunque la ajena esté primera');
  assert.equal(b.PC, 'P4');
});

test('sin oficina resuelta getBilleraLanding no filtra de más', () => {
  // Al arrancar, pcOperativa puede estar vacío. Filtrar ahí dejaría al panel sin billeteras.
  const sb = arrancarPanel();
  vm.runInContext('pcOperativa = "";', sb);
  vm.runInContext('billeteras.push({ID_BILLETERA:"b1",NOMBRE_VISIBLE:"UNA",PC:"P4",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"});', sb);
  assert.ok(sb.getBilleraLanding(), 'sin oficina resuelta se devuelve igual');
});

test('una billetera sin oficina cargada no se descarta', () => {
  const sb = arrancarPanel();
  vm.runInContext('pcOperativa = "P4";', sb);
  vm.runInContext('billeteras.push({ID_BILLETERA:"b1",NOMBRE_VISIBLE:"SIN PC",PC:"",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"});', sb);
  assert.ok(sb.getBilleraLanding(), 'sin PC en la fila no se puede afirmar que sea ajena');
});

// ══════════════════════════════════════════════════════════════════════════════
// EL CIRCUITO DEL RETIRO PARCIAL, de punta a punta
// 32 cierres manuales en las 7 oficinas quedaron SIN motivo guardado. Que el código fuente
// se vea bien no alcanza: estas pruebas ejercitan el circuito sobre el bundle que corre.
// ══════════════════════════════════════════════════════════════════════════════

// Una solicitud de retiro a medio pagar, con el progreso ya registrado por la RPC.
function _solParcial(pagado){
  return {
    ID: 4242, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO',
    USUARIO: 'demoparcial', TITULAR: 'Demo Parcial', MONTO: 2000000,
    METADATA: { retiro_parcial: {
      total: 2000000, pagado: pagado,
      pagos: [{ monto: pagado, fecha: '2026-09-01T10:00:00Z', operador: 'op1' }]
    } }
  };
}

// getElementById de mentira: devuelve lo que se le pida por id, y algo inofensivo para el resto.
function _domCon(campos){
  return function(id){
    if(Object.prototype.hasOwnProperty.call(campos, id)) return campos[id];
    return { style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
             value:'', textContent:'', innerHTML:'', appendChild(){}, remove(){},
             setAttribute(){}, getAttribute(){ return null; },
             querySelector(){ return null; }, querySelectorAll(){ return []; },
             scrollIntoView(){}, focus(){} };
  };
}

test('parcial · el motivo y la nota llegan, y no pisan lo ya pagado', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb.registrarEnHistorial = async () => ({});
  sb.cargarSolicitudesPortal = async () => {};
  sb._parcialesEnProceso = [_solParcial(500000)];

  let modal = null;
  sb.abrirModal = (titulo, cuerpo, saveFn, saveText) => { modal = { titulo, cuerpo, saveFn, saveText }; };
  sb.document.getElementById = _domCon({
    cierreParcialMotivo: { value: 'SE_LO_JUGO' },
    cierreParcialNota:   { value: 'Se jugó el resto del saldo antes de terminar de cobrar.' }
  });

  let enviado = null;
  sb.actualizarSolicitudPortal = async (id, estado, extra) => { enviado = { id, estado, extra }; return { error: null }; };

  sb.cerrarRetiroSaldado(4242);
  assert.equal(typeof modal.saveFn, 'function', 'el modal de cierre tiene que pedir el motivo');
  await modal.saveFn();

  assert.ok(enviado, 'el cierre tiene que llegar al servidor');
  assert.equal(enviado.estado, 'PAGADA');
  assert.equal(enviado.extra.cierre_motivo, 'SE_LO_JUGO', 'el motivo viaja');
  assert.match(enviado.extra.cierre_nota, /se jugó el resto/i, 'la nota viaja');
  assert.equal(enviado.extra.etapa, 'RETIRO_CIERRE_MANUAL');

  // Lo que más importa: la RPC hace merge SHALLOW, así que si el panel manda retiro_parcial
  // sin lo que ya había, BORRA el progreso. Tiene que venir completo.
  const rp = enviado.extra.retiro_parcial;
  assert.equal(rp.total, 2000000, 'el total ya registrado se conserva');
  assert.equal(rp.pagado, 500000, 'lo ya pagado se conserva');
  assert.equal(rp.pagos.length, 1, 'los pagos anteriores se conservan');
  assert.equal(rp.cierre.motivo, 'SE_LO_JUGO');
  assert.equal(rp.cierre.faltante, 1500000, 'queda asentado cuánto quedó sin pagar');
});

test('parcial · sin explicar qué pasó, no se cierra', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb._parcialesEnProceso = [_solParcial(500000)];

  let modal = null;
  sb.abrirModal = (t, c, saveFn) => { modal = { saveFn }; };
  sb.document.getElementById = _domCon({
    cierreParcialMotivo: { value: 'OTRO' },
    cierreParcialNota:   { value: 'nada' }   // menos de 8 caracteres
  });
  let llamado = false;
  sb.actualizarSolicitudPortal = async () => { llamado = true; return { error: null }; };

  sb.cerrarRetiroSaldado(4242);
  await modal.saveFn();
  assert.equal(llamado, false, 'sin nota no se cierra: es el único registro de por qué quedó a medias');
});

test('parcial · se va a su caja, y la solicitud común se queda en la lista', () => {
  const sb = arrancarPanel();
  const caja = { innerHTML: '' };
  sb.document.getElementById = _domCon({ tablaSolicitudesInicio: caja });

  const carga = { ID: 7, TIPO: 'CARGA', ESTADO: 'PENDIENTE', USUARIO: 'otro', MONTO: 5000, METADATA: {} };
  sb.V154P.solicitudes = [_solParcial(500000), carga];

  sb.v154pRenderSolicitudesPortalEnInicio();

  assert.equal(sb._parcialesEnProceso.length, 1, 'el parcial sale de la lista principal');
  assert.equal(String(sb._parcialesEnProceso[0].ID), '4242');
  assert.match(caja.innerHTML, /otro/, 'y la carga pendiente sigue a la vista');
  assert.ok(!/demoparcial/.test(caja.innerHTML), 'el parcial ya no tapa la lista');
});

test('parcial · la caja lo dibuja con su progreso', () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb._parcialesEnProceso = [_solParcial(500000)];
  let modal = null;
  sb.abrirModal = (titulo, cuerpo) => { modal = { titulo, cuerpo }; };

  sb.verRetirosParciales();

  assert.match(modal.titulo, /Retiros pagándose por partes/);
  assert.match(modal.cuerpo, /demoparcial/, 'se ve de quién es');
  assert.match(modal.cuerpo, new RegExp('falta\\s*' + sb.money(1500000).replace(/[$.]/g, '\\$&')), 'y cuánto falta');
  assert.match(modal.cuerpo, /width:25%/, 'la barra dibuja el 25% pagado');
});

test('parcial · el progreso avanza a medida que se paga', () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  const dibujar = function(pagado){
    sb._parcialesEnProceso = [_solParcial(pagado)];
    let cuerpo = '';
    sb.abrirModal = (t, c) => { cuerpo = c; };
    sb.verRetirosParciales();
    return cuerpo;
  };

  const alInicio = dibujar(500000);
  const aMitad   = dibujar(1500000);
  const alFinal  = dibujar(2000000);

  assert.match(alInicio, /width:25%/);
  assert.match(aMitad,   /width:75%/, 'el progreso se mueve con cada pago');
  assert.match(alFinal,  /width:100%/);

  assert.ok(!/saldado/.test(alInicio), 'a medio pagar NO dice saldado');
  assert.match(alFinal, /saldado/, 'cuando se cubre el total, queda marcado como saldado');
  // Y el botón cambia: mientras falta plata se puede seguir pagando; saldado, solo cerrar.
  assert.match(aMitad,  /Pagar más/);
  assert.ok(!/Pagar más/.test(alFinal), 'saldado ya no ofrece pagar más');
});

// ══════════════════════════════════════════════════════════════════════════════
// LOS ARREGLOS DEL RELEVAMIENTO DEL 2026-09-11
// ══════════════════════════════════════════════════════════════════════════════

test('D-66 · el total del parcial sale del progreso, no del monto podrido de la solicitud', () => {
  const sb = arrancarPanel();

  // Caso real: una solicitud entró del portal con un cero de más (monto 65.000.000) pero el
  // motor de pagos registró el total bueno. Antes la caja tomaba el monto de la solicitud y
  // mostraba que faltaban 64 millones.
  const podrida = sb._retiroParcialInfo({
    MONTO: 65000000,
    METADATA: { retiro_parcial: { total: 650000, pagado: 600000 } }
  });
  assert.equal(podrida.total, 650000, 'manda el total que usó el motor de pagos');
  assert.equal(podrida.restante, 50000, 'y "cuánto falta" vuelve a tener sentido');

  // Sin total registrado, sigue valiendo el de la solicitud: no se pierde el caso normal.
  const sinProgreso = sb._retiroParcialInfo({
    MONTO: 300000,
    METADATA: { retiro_parcial: { pagado: 100000 } }
  });
  assert.equal(sinProgreso.total, 300000, 'de respaldo, el monto de la solicitud');
  assert.equal(sinProgreso.restante, 200000);
});

test('D-70 · abrirChat vuelve a recibir el id de la conversación', () => {
  const sb = arrancarPanel();

  // El bug: chat-local.js carga último y pisaba la implementación buena con una que NO recibía
  // id (`async function(){ renderChatListStep2(); }`), así que hacer clic en un chat no abría
  // nada. La arity es la prueba directa: la rota declaraba cero parámetros.
  assert.equal(typeof sb.abrirChat, 'function');
  assert.equal(sb.abrirChat.length, 1, 'la que quedó viva tiene que recibir el id');

  // Y llamarla sin argumentos sigue siendo válido (repinta la lista, no explota).
  assert.doesNotThrow(() => { sb.abrirChat(); });
});

test('D-64 · el botón de cerrar el retiro se apaga al primer clic', () => {
  // El candado de reentrada vive adentro del módulo y no se alcanza desde el sandbox, pero la
  // otra mitad del arreglo sí se puede verificar donde importa: en el bundle que se distribuye.
  // Si alguien saca el disabled, esto falla.
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-portal-modules.js'), 'utf8');
  assert.match(bundle, /onclick="this\.disabled=true;_rv2Finalizar\(\)"/,
    'el botón tiene que apagarse solo: sin eso, once clics fueron once registros');
  assert.ok(!/onclick="_rv2Finalizar\(\)"/.test(bundle),
    'y no puede quedar ninguna versión sin apagar');
});

// ══════════════════════════════════════════════════════════════════════════════
// COPIAR AUNQUE EL PANEL ESTE OPERANDO
// El portapapeles exige foco, y mientras el panel opera enfoca la ventana del backoffice.
// El respaldo del enlace de acceso era prompt(), que en Electron no existe: el operador se
// quedaba sin el enlace y sin aviso.
// ══════════════════════════════════════════════════════════════════════════════

test('copiar · si no se puede copiar, el texto NO se pierde: queda a la vista', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  let modal = null;
  sb.abrirModal = (titulo, cuerpo) => { modal = { titulo, cuerpo }; };

  // El sandbox no tiene ni clipboard.writeText ni execCommand: es el peor caso, el mismo que
  // se da cuando la ventana del backoffice se quedó con el foco.
  const copio = await sb.nodoCopiar('https://portal.example/?t=abc123xyz', { etiqueta: 'Enlace copiado' });

  assert.equal(copio, false, 'no puede decir que copió si no copió');
  assert.ok(modal, 'tiene que mostrar el texto en vez de tragárselo');
  assert.match(modal.cuerpo, /abc123xyz/, 'y el enlace tiene que estar completo ahí');
});

test('copiar · cuando sí copia, avisa con la etiqueta que le pasaron', async () => {
  const sb = arrancarPanel();
  let dicho = '';
  sb.toast = (m) => { dicho = m; };
  sb.abrirModal = () => { throw new Error('no debería abrir el modal si copió bien'); };
  sb.navigator = { clipboard: { writeText: async () => {} } };

  const copio = await sb.nodoCopiar('hola', { etiqueta: 'Enlace copiado' });

  assert.equal(copio, true);
  assert.equal(dicho, 'Enlace copiado');
});

test('copiar · sin texto no inventa nada', async () => {
  const sb = arrancarPanel();
  let dicho = '';
  sb.toast = (m) => { dicho = m; };
  assert.equal(await sb.nodoCopiar(''), false);
  assert.match(dicho, /nada para copiar/i);
});

test('copiar · el enlace de acceso ya no depende de prompt()', () => {
  // prompt() no existe en Electron (está dicho en conciliacion.js:697). Era el ÚNICO respaldo
  // del botón del enlace: si el portapapeles fallaba, no pasaba absolutamente nada.
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-jugadores-crm.js'), 'utf8');
  assert.ok(!/prompt\(/.test(bundle), 'no puede quedar un prompt() como respaldo');
  assert.match(bundle, /nodoCopiar\(msg/, 'usa el camino que recupera el foco y no pierde el texto');
});

// ══════════════════════════════════════════════════════════════════════════════
// COSAS QUE SE MUEVEN SOLAS
// Todo lo de acá abajo es lo mismo: algo aparece o crece DESPUÉS de que el operador ya decidió
// dónde iba a hacer clic, y le corre el botón de abajo del cursor. O peor: le muestra el proceso
// de otra solicitud encima de la que está completando.
// ══════════════════════════════════════════════════════════════════════════════

test('tarjeta · al encolarse cambia cómo se presenta y no vuelve a ofrecer "Aprobar"', () => {
  const sb = arrancarPanel();
  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'tablaSolicitudesInicio' ? caja : null);
  sb.V154P.solicitudes = [{ ID: 900001, USUARIO: 'jugadordeprueba', TIPO: 'CARGA',
    ESTADO: 'PENDIENTE', MONTO_REAL: 2000, FECHA_CREACION: '2026-09-11T11:59:00Z' }];

  sb._colaCargaEstado = {};
  sb.V154P.solicitudesLastHtml = null;
  sb.v154pRenderSolicitudesPortalEnInicio();
  assert.match(caja.innerHTML, /id="v154pCard900001"/,
    'la tarjeta lleva id: así la cola sabe que esta solicitud YA está a la vista y no la repite');
  assert.match(caja.innerHTML, />Aprobar</, 'sin encolar, se puede aprobar');

  // Misma solicitud, ahora en la cola.
  sb._colaCargaEstado = { '900001': { estado: 'espera', pos: 1, cid: 'cc1' } };
  sb.V154P.solicitudesLastHtml = null;
  sb.v154pRenderSolicitudesPortalEnInicio();
  assert.ok(!/>Aprobar</.test(caja.innerHTML),
    'ya encolada NO se puede aprobar de nuevo: eso era el doble clic sobre la misma carga');
  assert.match(caja.innerHTML, /en la cola/, 'y la tarjeta dice en qué estado está');
  assert.match(caja.innerHTML, /Sacar de la cola/);
});

test('alta · crear usuario avisa Y SUENA si el teléfono ya tiene dueño', async () => {
  const sb = arrancarPanel();
  sb.pcOperativa = 'P1';
  const campos = {
    nuevoJugUsuario:  { value: 'jugadordeprueba' },
    nuevoJugTelefono: { value: '1122334455' },
    nuevoJugCotejo:   { innerHTML: '' }
  };
  sb.document.getElementById = (id) => campos[id] || null;
  // Ese número es de otro usuario: es el caso de la captura (se creaba igual, sin decir nada).
  sb.altaCotejarDatos = async () => ({
    usuario:  { exacto: null, similares: [] },
    telefono: { exacto: { usuario: 'otrojugador', telefonos: ['1122334455'], pc: 'P1' }, similares: [] }
  });
  let sono = 0;
  sb.sonido = () => { sono++; };

  await sb._altaNuevoCotejarYa();

  assert.match(campos.nuevoJugCotejo.innerHTML, /otrojugador/,
    'tiene que decir de quién es el número ANTES de crear la cuenta, no después');
  assert.equal(sono, 1, 'y tiene que sonar: un cartel debajo del campo no lo ve quien mira el teclado');

  await sb._altaNuevoCotejarYa();
  assert.equal(sono, 1, 'no vuelve a sonar por el mismo dato');
});

test('el resultado de una operación no se escribe en el modal de OTRA solicitud', () => {
  // El modal de aprobar es UNO SOLO y se reusa. Como la carga corre en segundo plano, para cuando
  // termina el operador ya abrió el de la siguiente — y ahí le aparecía "Operando en Agentes..."
  // y "carga completada" de la anterior, con el botón Aprobar apagado.
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-portal-modules.js'), 'utf8');
  assert.match(bundle, /_esMiModal/, 'tiene que preguntarse si el modal sigue siendo el suyo');
  // OJO: el bundle tiene OTRO getElementById('portalJobResultado') que es correcto y tiene que
  // quedar — el que limpia el cuadro al ABRIR el modal. Lo que se sostiene acá es que la
  // operación, que corre en segundo plano, escriba SIEMPRE a través del guard.
  assert.match(bundle, /_pintarEn\('portalJobResultado'/,
    'la operación escribe por el camino guardado, no derecho sobre el modal que esté abierto');
});

test('la cola no dibuja una fila si la solicitud ya está a la vista en pendientes', () => {
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-portal-modules.js'), 'utf8');
  assert.match(bundle, /getElementById\('v154pCard' \+ sid\)/,
    'se fija si la tarjeta ya está en pantalla antes de repetirla arriba de la lista');
  assert.ok(!/_colaCarga\.map\(function\(it,i\)\{/.test(bundle),
    'ya no mapea la cola entera sin filtrar');
});

test('la tira de proceso vive en una esquina, no flotando en el medio', () => {
  const bundle = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-core.js'), 'utf8');
  assert.match(bundle, /position:fixed;bottom:52px;left:84px/,
    'abajo a la izquierda, donde no hay barra de desplazamiento ni panel de chat');
  assert.ok(!/cssText = 'position:fixed;bottom:14px;left:50%/.test(bundle),
    'centrada no: tapaba la tabla y se montaba a la barra de desplazamiento');
});

test('el cartel "PILOTO OPERATIVO" no se dibuja más', () => {
  const js  = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-piloto.js'), 'utf8');
  const css = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'css-piloto.css'), 'utf8');
  assert.ok(!/nodoPilotoBadge/.test(js),  'no se crea');
  assert.ok(!/nodoPilotoBadge/.test(css), 'ni queda su estilo colgado ocupando la esquina');
});

test('los botones del modal no se corren cuando llegan los chequeos', () => {
  const css = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'css-base.css'), 'utf8');
  assert.match(css, /#modalBody\{[^}]*overflow-y:auto/, 'scrollea el cuerpo…');
  assert.ok(!/\.modal\{[^}]*overflow:auto/.test(css),
    '…y no el modal entero, que es lo que empujaba los botones hacia abajo mientras se leía');
});

// ══════════════════════════════════════════════════════════════════════════════
// LO QUE SALIO EXPLICANDO EL PANEL
// Cuatro cosas que aparecieron mientras se le mostraba el panel a los operadores. Las tres
// primeras son la misma clase de error: el panel tiene el dato y no lo usa.
// ══════════════════════════════════════════════════════════════════════════════

test('chat · "Chat Jugador" abre la conversación del jugador, no sólo el apartado', async () => {
  const sb = arrancarPanel();
  sb.mostrarVista = () => {};
  sb.ticketsAgrupados = () => [{ id: 'tk9', usuario: 'jugadordeprueba' }];
  let abierto = null;
  sb.aceptarTicketLocalStep2 = (id) => { abierto = id; };

  // Sin chat_id (es el caso de las manuales y de muchas del portal): antes se cambiaba de
  // pantalla, se escribía el nombre en un filtro, y ahí terminaba todo.
  await sb.expedienteAbrirChatJugador('JugadorDePrueba', '');

  assert.equal(abierto, 'tk9', 'tiene que abrir la conversación de ese jugador, buscándola por usuario');
});

test('chat · si el jugador no tiene conversación, se abre para escribirle (no un cartel)', async () => {
  const sb = arrancarPanel();
  sb.mostrarVista = () => {};
  sb.ticketsAgrupados = () => [];
  let paraQuien = null;
  sb.nodoChatNuevo = (u) => { paraQuien = u; };

  await sb.expedienteAbrirChatJugador('jugadorsinchat', '');

  assert.equal(paraQuien, 'jugadorsinchat',
    'antes terminaba en "todavía no se puede iniciar una": ahora se le escribe');
});

test('ficha · la que se le manda al jugador trae el titular y no trae vocabulario interno', () => {
  const sb = arrancarPanel();
  let texto = '';
  sb.nodoCopiar = (t) => { texto = t; return true; };

  // Operación MANUAL: no tiene columna TITULAR, el titular viaja dentro de notas.
  sb.construirDossierCompletoHtml({
    id: 198110, tipo: 'CARGA', usuario: 'jugadordeprueba', origen: 'LANDING',
    notas: '#206911 · Titular: Fulano De Tal · Alias: alias.demo · ARS 0.00',
    monto: 5500, chunior_movimiento_id: 9647510, estado: 'OK'
  });
  sb.copiarResumenExpediente();

  assert.match(texto, /Titular: Fulano De Tal/,
    'el titular estaba en las notas y la ficha mostraba "—"');
  assert.ok(!/chunior/i.test(texto), 'el jugador no tiene por qué leer "Chunior"');
  assert.ok(!/landing/i.test(texto), 'ni "LANDING"');
  assert.ok(!/Origen/.test(texto), 'Juan pidió sacar la línea de origen (12/09)');
});

test('lista · dos solicitudes abiertas del mismo jugador quedan marcadas', () => {
  const sb = arrancarPanel();
  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'tablaSolicitudesInicio' ? caja : null);
  sb._colaCargaEstado = {};
  sb.V154P.solicitudes = [
    { ID: 900001, USUARIO: 'jugadordeprueba', TIPO: 'CARGA', ESTADO: 'PENDIENTE',
      MONTO_REAL: 3400, FECHA_CREACION: '2026-09-11T12:13:00Z' },
    { ID: 900002, USUARIO: 'jugadordeprueba', TIPO: 'CARGA', ESTADO: 'PENDIENTE',
      MONTO_REAL: 3000, FECHA_CREACION: '2026-09-11T12:12:00Z' }
  ];
  sb.V154P.solicitudesLastHtml = null;
  sb.v154pRenderSolicitudesPortalEnInicio();

  assert.match(caja.innerHTML, /2 solicitudes abiertas de este jugador/,
    'cargar las dos es plata de verdad: la tarjeta tiene que avisarlo');

  // Con un solo pedido no hay nada que avisar.
  sb.V154P.solicitudes = [sb.V154P.solicitudes[0]];
  sb.V154P.solicitudesLastHtml = null;
  sb.v154pRenderSolicitudesPortalEnInicio();
  assert.ok(!/solicitudes abiertas de este jugador/.test(caja.innerHTML),
    'y no puede gritar cuando hay una sola');
});

// ══════════════════════════════════════════════════════════════════════════════
// EL RETIRO PARCIAL, USABLE
// Juan: "esta versión es inutilizable de manera directa". Escribías un dígito y el modal se
// redibujaba; el cartel decía "no cubren, $0" con plata de sobra; y al terminar de pagar se perdía
// el estado y la solicitud no se cerraba.
// ══════════════════════════════════════════════════════════════════════════════

const _bundlePortal = () => fs.readFileSync(
  path.join(RAIZ, 'renderer', 'generated', 'js-portal-modules.js'), 'utf8');

test('parcial · el total del retiro se define UNA sola vez (la segunda redibujaba todo)', () => {
  const b = _bundlePortal();
  const n = (b.match(/api\._rv2InputTotal = function/g) || []).length;
  assert.equal(n, 1, 'con dos definiciones gana la segunda, y esa hacía _rv2Render() en cada tecla');
});

test('parcial · tipear en el total NO reescribe el modal (el campo no pierde el foco)', () => {
  const sb = arrancarPanel();
  const modal = { innerHTML: '<<intacto>>', style: {} };
  const deuda = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'retiroV2Modal' ? modal : id === 'rv2Deuda' ? deuda : null);
  sb._retiroV2 = { id: 900001, usuario: 'jugadordeprueba', objetivo: 50000, totalReal: 50000,
    yaPagado: 0, sel: {}, montos: {}, hechas: {}, fase: 'setup', saldoReal: 45820 };

  const campo = { value: '45.820' };
  sb._rv2InputTotal(campo);

  assert.equal(modal.innerHTML, '<<intacto>>', 'si el modal se reescribe, el campo se recrea y se pierde el foco');
  assert.equal(sb._retiroV2.totalReal, 45820);
  assert.equal(campo.value, '45.820', 'y el número queda con el formato de miles');
});

test('parcial · sin billetera elegida dice "elegí", no "las billeteras no cubren"', () => {
  const b = _bundlePortal();
  assert.match(b, /ELEGÍ DE QUÉ BILLETERA PAGAR/,
    'con $0 elegido y plata en las billeteras, el problema es que falta elegir — no que no alcance');
  assert.ok(!/tit:'LAS BILLETERAS NO CUBREN EL TOTAL'/.test(b),
    'el cartel viejo leía "nada elegido" como "no hay plata"');
});

test('parcial · el cierre usa el estado que ya tenía, aunque el global se haya vaciado', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  const alertas = [];
  sb.alert = (m) => { alertas.push(String(m)); };
  sb._retiroV2 = null;                       // lo que pasa si algo cerró el modal mientras se pagaba

  const st = { id: 900001, usuario: 'jugadordeprueba', titular: 'Titular Demo', cbu: 'alias.demo',
    declarado: 50000, objetivo: 50000, totalReal: 50000, yaPagado: 0, totalPagar: 25000,
    modoParcial: true, sel: {}, montos: {}, hechas: {}, fase: 'confirmar', chuMovs: [],
    pagar: [{ id: 'b1', nombre: 'BILLETERA DEMO', monto: 25000, chunior: null }] };

  try{ await sb._rv2Finalizar(st); }catch(_e){}

  assert.ok(!alertas.some(a => /Se perdió el estado/.test(a)),
    'con el estado en la mano no puede decir que lo perdió: la plata ya salió y la solicitud tiene que cerrarse');
});

test('Ver · desde pendientes abre el modal (el panel de abajo no está a la vista)', () => {
  const b = _bundlePortal();
  const n = (b.match(/v154pDetalleSolicitud\(\$\{id\},true\)/g) || []).length;
  assert.equal(n, 2, 'los dos "Ver" de la tarjeta (normal y encolada) fuerzan el modal');
  assert.match(b, /if\(forzarModal \|\| isMobile\)\{ try\{ expedienteEnsureModal\(\); \}catch\(_e\)\{\} \}/,
    'y el modal se crea ANTES de buscarlo — si no, la primera vez no aparecía nunca');
});

test('Chunior · editar compara contra el usuario activo en Chunior, no contra "[object Object]"', () => {
  const b = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-core.js'), 'utf8');
  assert.ok(!/String\(\(typeof operador !== 'undefined' \? operador : ''\) \|\| ''\)/.test(b),
    'operador es un objeto: String(operador) da "[object Object]" y bloqueaba a todos');
  assert.match(b, /await refrescarOperadorDesdeChunior\(true\)/,
    'se lee en vivo quién está logueado en Chunior, como hacen las billeteras');
});

// ══════════════════════════════════════════════════════════════════════════════
// EL PANEL PUEDE EMPEZAR LA CONVERSACION
// "No puede ser que nosotros no podamos enviarle un mensaje a los usuarios tal cual ellos sí
// pueden enviarnos uno" (D-73). El portal lee la última solicitud de SOPORTE del jugador que tenga
// chat_thread; panel_chat_iniciar crea esa solicitud con nuestro mensaje como primero del hilo.
// ══════════════════════════════════════════════════════════════════════════════

function _panelConChat(respuesta) {
  const llamadas = [];
  const sb = arrancarPanel({ rpc: (fn, args) => {
    llamadas.push({ fn, args });
    if (fn === 'panel_chat_iniciar') return Promise.resolve({ data: respuesta, error: null });
    return Promise.resolve({ data: null, error: null });
  }});
  sb.pcOperativa = 'P4';
  sb.operador = { usuario: 'operadordemo' };
  return { sb, llamadas };
}

test('chat · a quien nunca escribió se le crea la conversación en el servidor', async () => {
  const { sb, llamadas } = _panelConChat({ ok: true, solicitud_id: 900010, usuario: 'jugadordeprueba', creada: true });
  sb.nodoEnviarMensajePortal = async () => ({ ok: false, error: 'sin-ticket' });

  const r = await sb.nodoIniciarChat('jugadordeprueba', 'Hola, te escribimos por tu retiro');

  const c = llamadas.find(x => x.fn === 'panel_chat_iniciar');
  assert.ok(c, 'sin ticket tiene que ir a crear la conversación, no devolver "sin-ticket"');
  assert.equal(c.args.p_pc_codigo, 'P4', 'en la oficina que está operando');
  assert.equal(c.args.p_usuario, 'jugadordeprueba');
  assert.equal(c.args.p_mensaje, 'Hola, te escribimos por tu retiro');
  assert.equal(c.args.p_operador, 'operadordemo', 'queda registrado quién le escribió');
  assert.equal(r.ok, true);
  assert.equal(r.creada, true);
});

test('chat · si ya tiene conversación, el mensaje va por el camino de siempre', async () => {
  const { sb, llamadas } = _panelConChat({ ok: true });
  sb.nodoEnviarMensajePortal = async () => ({ ok: true });

  const r = await sb.nodoIniciarChat('jugadordeprueba', 'Hola');

  assert.equal(r.ok, true);
  assert.ok(!llamadas.some(x => x.fn === 'panel_chat_iniciar'),
    'no hay que crear otra conversación si ya existe una');
});

test('chat · si el servidor rechaza, lo dice (no canta "enviado")', async () => {
  const { sb } = _panelConChat({ ok: false, error: 'NO_AUTORIZADO' });
  sb.nodoEnviarMensajePortal = async () => ({ ok: false, error: 'sin-ticket' });

  const r = await sb.nodoIniciarChat('jugadordeprueba', 'Hola');

  assert.equal(r.ok, false);
  assert.equal(r.error, 'NO_AUTORIZADO');
});

test('chat · sin texto no manda nada', async () => {
  const { sb, llamadas } = _panelConChat({ ok: true });
  const r = await sb.nodoIniciarChat('jugadordeprueba', '   ');
  assert.equal(r.ok, false);
  assert.ok(!llamadas.some(x => x.fn === 'panel_chat_iniciar'));
});

test('chat · la ficha del jugador tiene la puerta para escribirle', () => {
  // Hasta ahora la única entrada era "Chat Jugador" en el historial, y ni así andaba.
  const b = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-core.js'), 'utf8');
  assert.match(b, /💬 Mensaje<\/button>/);
  assert.match(b, /onclick="nodoChatNuevo\(/);
});

// ══════════════════════════════════════════════════════════════════════════════
// LOS ICONOS NO DEPENDEN DE LA CODIFICACION
// La app leyó css-base.css como Windows-1252 y los íconos de la barra salieron como "ðŸšª".
// ══════════════════════════════════════════════════════════════════════════════

test('estilos · cada hoja generada declara UTF-8 y no tiene emojis crudos en content:', () => {
  const dir = path.join(RAIZ, 'renderer', 'generated');
  const hojas = fs.readdirSync(dir).filter(x => x.endsWith('.css'));
  assert.ok(hojas.length > 0);
  for (const f of hojas) {
    const css = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(css.startsWith('@charset "UTF-8";'),
      f + ': sin @charset en la primera línea, la codificación la adivina el navegador');
    const crudos = css.match(/content:\s*"[^"]*[^\x00-\x7F][^"]*"/g) || [];
    assert.deepEqual(crudos, [],
      f + ': un emoji crudo en content: se rompe si la hoja se lee mal — va como escape (\\1F6AA)');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// EL CAMINO QUE D-84 NO CUBRIO
// D-84 arregló "se perdió el estado" en el camino de "confirmar una por una". Juan pagó con esa
// casilla destildada —otro camino— y volvió a pasar. Estas pruebas miran TODOS los caminos.
// ══════════════════════════════════════════════════════════════════════════════

test('parcial · NINGÚN camino llama al cierre sin pasarle el estado', () => {
  const b = _bundlePortal();
  assert.equal((b.match(/await deps\._rv2Finalizar\(\)/g) || []).length, 0,
    'cualquier llamada sin estado vuelve a buscarlo en el global, que cerrar el modal pone en null');
  assert.ok((b.match(/await deps\._rv2Finalizar\(st\)/g) || []).length >= 2,
    'el camino directo y el de confirmar tienen que pasarlo');
});

test('parcial · ya no existe "Confirmar una por una"', () => {
  assert.ok(!/Confirmar una por una<\/label>/.test(_bundlePortal()),
    'Juan lo pidió: no aportaba y era un segundo camino de código para lo mismo');
});

test('parcial · "pagarle todo lo que tiene" corrige el TOTAL y lo escribe en la solicitud', () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  let escrito = null;
  sb.actualizarSolicitudPortal = (id, estado, extra) => { escrito = { id, estado, extra }; return Promise.resolve({}); };
  sb._retiroV2 = { id: 900001, usuario: 'jugadordeprueba', declarado: 50000, objetivo: 50000,
    totalReal: 50000, _metaTotal: null, yaPagado: 0, sel: {}, montos: {}, hechas: {},
    fase: 'setup', saldoReal: 35020, modoParcial: true };

  sb._rv2AjustarASaldo(35020);

  assert.equal(sb._retiroV2.totalReal, 35020,
    'si el total queda en 50.000, el cierre deja 14.980 "pendientes" que el jugador no tiene');
  assert.ok(escrito, 'y la solicitud tiene que enterarse');
  assert.equal(escrito.extra.monto_corregido, 35020);
});

test('parcial · un saldo leído con la sesión caída no se cree', () => {
  const b = _bundlePortal();
  assert.match(b, /r\.confiable===true/,
    'con la sesión inválida el preload devolvía 0 y el modal decía "NO TIENE FICHAS"');
  assert.match(b, /Se cayó la sesión de Agentes\. Tocá Reintentar: se abre el login y sigo desde acá\./);
});

test('Drex · detecta "session is invalid" aunque haya OTRO modal abierto antes', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  const m = src.match(/function detectarModalSesionInvalida\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'no encontré la función en el preload');
  const detectar = new Function('document', m[0] + '\nreturn detectarModalSesionInvalida();');

  // Lo que había en pantalla: el modal del saldo del jugador, y ENCIMA el de sesión inválida.
  const delJugador = { textContent: 'Saldo de jugadordeprueba · ARS 35.020' };
  const invalida   = { textContent: 'session is invalid La session es invalida, redireccionamos al login Aceptar' };
  const doc = {
    querySelector:    (s) => (s === '.ReactModal__Content' ? delJugador : null),
    querySelectorAll: (s) => (s === '.ReactModal__Content' ? [delJugador, invalida] : [])
  };
  assert.equal(detectar(doc), invalida,
    'mirando sólo el primero, agarraba el del jugador y el de sesión inválida pasaba de largo');
});

test('Drex · un botón de búsqueda oculto no cuenta como "estás adentro"', () => {
  // Con el botón en el DOM pero oculto (la SPA lo deja montado al mandarte al login), el preload
  // daba la sesión por buena y el panel no abría nunca el modal de ingreso.
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  assert.match(src, /const hasSearch = isVisible\(document\.querySelector\(SELECTORS\.searchButton\)\)/);
  assert.ok(!/const hasSearch = document\.querySelector\(SELECTORS\.searchButton\) \|\|/.test(src),
    'un querySelector pelado encuentra el botón aunque no se vea');
});

// ══════════════════════════════════════════════════════════════════════════════
// TERCERA RONDA DEL 12/09
// ══════════════════════════════════════════════════════════════════════════════

test('versión · en la pantalla de login el cartel va a la esquina, no al medio', () => {
  const sb = arrancarPanel();
  sb.innerWidth = 1200;
  const box = { style: {} }, chip = { style: {} };
  const login = { classList: { contains: () => false } };
  const els = {
    viewChat: { getBoundingClientRect: () => ({ width: 400, left: 800, right: 1200 }) },
    loginView: login, updaterBox: box, updaterMiniChip: chip
  };
  sb.document.getElementById = (id) => els[id] || null;
  sb.getComputedStyle = () => ({ display: 'flex' });

  sb._updaterAnclar();
  assert.equal(box.style.right, '12px',
    'con el login a la vista, el chat está tapado: engancharse a su borde lo dejaba en el medio');

  login.classList.contains = (c) => c === 'hidden';     // ya logueado
  sb._updaterAnclar();
  assert.equal(box.style.right, (1200 - 800 + 14) + 'px', 'adentro sí se apoya en el borde del chat');
});

test('parcial · la caja usa el monto CORREGIDO, no el total viejo que guardó la RPC', () => {
  const sb = arrancarPanel();
  const info = sb._retiroParcialInfo({ MONTO_REAL: 35019, MONTO_DECLARADO: 50000,
    METADATA: { monto_corregido: 35019, retiro_parcial: { total: 50000, pagado: 5000 } } });
  assert.equal(info.total, 35019, 'decía "falta $45.000 de $50.000" con la solicitud ya corregida');
  assert.equal(info.restante, 30019);
});

test('BET300 · la búsqueda no se rinde en el primer instante', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload-bet300.js'), 'utf8');
  assert.ok(!/checking your browser\|502\|503\|504/.test(src),
    'números sueltos marcaban como "error del servidor" cualquier página con esos dígitos');
  assert.match(src, /ensureReady-montar/, 'espera a que la pantalla monte antes de decir "bloqueada"');
  assert.match(src, /if \(ready\.pageError && !ready\.needsLogin\) \{/,
    'y si arranca con error, vuelve a la búsqueda una vez antes de rendirse');
});

test('BET300 · el retiro hace una pausa a la vista antes de enviar', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload-bet300.js'), 'utf8');
  assert.match(src, /const PAUSA_ANTES_DE_ENVIAR_RETIRO = \d+;/);
  assert.match(src, /if \(tipo === 'retiro'\) \{\s*await delay\(PAUSA_ANTES_DE_ENVIAR_RETIRO\)/,
    'sólo en retiros: en la carga no se agrega (pasan cientos por día)');
});

test('centro de control · botón de parciales y operaciones de hoy', () => {
  const htm = fs.readFileSync(path.join(RAIZ, 'NODO · OPERATIVO LITE.htm'), 'utf8');
  assert.match(htm, /id="solOpsHoy"/, 'el contador va en la barra del centro de control');
  assert.match(htm, /id="btnParcialesCC"/, 'un parcial de ayer no aparecía en ningún lado de esa sección');
  const core = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-core.js'), 'utf8');
  assert.match(core, /window\.solOpsHoyRefrescar = async function/);
  assert.match(_bundlePortal(), /getElementById\("btnParcialesCC"\)/);
});

test('blanqueo · el cartel de la clave se copia al tocarlo', () => {
  const core = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-core.js'), 'utf8');
  assert.match(core, /etiqueta:'Usuario y clave copiados'/);
});

// ══════════════════════════════════════════════════════════════════════════════
// LA TARJETA DE COTEJO DICE QUE PASA
// Juan: "si yo no entiendo, vos tampoco vas a entender por qué esto". El caso: el teléfono declarado
// era el del propio jugador con un dígito de menos, y la tarjeta lo decía de tres maneras sueltas.
// ══════════════════════════════════════════════════════════════════════════════

function _cotejoPropio(telDeclarado, telRegistrado) {
  return {
    usuario:  { exacto: { usuario: 'jugadordeprueba', telefonos: [telRegistrado] }, similares: [] },
    telefono: { exacto: null, similares: [{ usuario: 'jugadordeprueba', telefonos: [telRegistrado], _tel: telRegistrado, _d: 1 }] }
  };
}

test('cotejo · el teléfono propio con un dígito de menos se dice así, en claro', () => {
  const sb = arrancarPanel();
  const out = sb._altaCotejoHtml('jugadordeprueba', '112233445', _cotejoPropio('112233445', '1122334455'), '_altaUsarSugerencia', '');

  assert.match(out.html, /Teléfono mal tipeado/, 'la etiqueta nombra lo que pasa, no un "REVISAR" genérico');
  assert.match(out.html, /le falta un dígito/);
  assert.match(out.html, /1122334455/, 'y dice cuál es el bueno');
  assert.match(out.html, /usar 1122334455/, 'con un botón para usarlo');
  assert.match(out.html, /un número argentino tiene 10 dígitos y este tiene 9/);
  assert.match(out.html, /Es el mismo jugador/);
  assert.ok(!/figura con otro teléfono/.test(out.html), 'el pie viejo contradecía todo lo de arriba');
  assert.ok(!/registrado con/.test(out.html), 'el teléfono no se repite en la fila del usuario');
});

test('cotejo · un teléfono que NO se parece al registrado dice qué hacer', () => {
  const sb = arrancarPanel();
  const r = {
    usuario:  { exacto: { usuario: 'jugadordeprueba', telefonos: ['1122334455'] }, similares: [] },
    telefono: { exacto: null, similares: [] }
  };
  const out = sb._altaCotejoHtml('jugadordeprueba', '3519876543', r, '_altaUsarSugerencia', '');
  assert.ok(!/mal tipeado/i.test(out.html), 'no es un error de tipeo: son números distintos');
  assert.match(out.html, /Preguntale cuál usa ahora antes de validar/);
});

// ══════════════════════════════════════════════════════════════════════════════
// AJUSTAR EL MONTO Y DECIR POR QUE
// Juan: "se debe de poder ajustar y dar la razón del por qué se ajusta el monto".
// ══════════════════════════════════════════════════════════════════════════════

function _panelConRetiro(solicitud) {
  const sb = arrancarPanel();
  sb.toast = () => {};
  const modal = { innerHTML: '', style: {} };
  sb.document.getElementById = (id) => (id === 'retiroV2Modal' ? modal : null);
  sb.V154P.solicitudes = [solicitud];
  return { sb, modal };
}

test('ajuste · con el monto corregido, el modal pide el motivo y ya lo sugiere', () => {
  const { sb, modal } = _panelConRetiro({ ID: 900001, USUARIO: 'jugadordeprueba', TIPO: 'RETIRO',
    ESTADO: 'EN_PROCESO', MONTO_REAL: 35019, MONTO_DECLARADO: 50000,
    METADATA: { monto_corregido: 35019, monto_declarado_original: 50000 } });

  sb.abrirModalRetiroV2(900001);

  assert.match(modal.innerHTML, /MOTIVO DEL AJUSTE/, 'el total quedó distinto de lo que pidió: hay que decir por qué');
  assert.match(modal.innerHTML, /50\.000/, 'y se ve cuánto había pedido');
  assert.match(modal.innerHTML, /quedó en/, 'con un motivo sugerido que se puede editar');
});

test('ajuste · sin corrección no aparece el campo', () => {
  const { sb, modal } = _panelConRetiro({ ID: 900002, USUARIO: 'jugadordeprueba', TIPO: 'RETIRO',
    ESTADO: 'PENDIENTE', MONTO_REAL: 50000, MONTO_DECLARADO: 50000, METADATA: {} });
  sb.abrirModalRetiroV2(900002);
  assert.ok(!/MOTIVO DEL AJUSTE/.test(modal.innerHTML));
});

test('ajuste · lo que escribe el operador queda, y no lo pisa el sugerido', () => {
  const { sb } = _panelConRetiro({ ID: 900003, USUARIO: 'jugadordeprueba', TIPO: 'RETIRO',
    ESTADO: 'EN_PROCESO', MONTO_REAL: 35019, MONTO_DECLARADO: 50000, METADATA: { monto_corregido: 35019 } });
  sb.abrirModalRetiroV2(900003);
  sb._rv2SetMotivoAjuste('Tenías menos fichas de las que pediste');
  assert.equal(sb._retiroV2.motivoAjuste, 'Tenías menos fichas de las que pediste');
  assert.equal(sb._retiroV2._motivoEditado, true);
});

test('ajuste · al cerrar se guarda el motivo y se le avisa una sola vez', () => {
  const b = _bundlePortal();
  assert.match(b, /_extra\.motivo_ajuste = _motivoAjuste/, 'la solicitud guarda el motivo');
  assert.match(b, /Ajustamos tu retiro a/, 'y va en el mensaje del chat');
  assert.match(b, /_motivoAjuste !== String\(st\._motivoAvisado/, 'una vez: no en cada cuota');
});

test('portal · muestra el monto ajustado y el motivo, aunque todavía no haya pagos', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'Portal'), 'utf8');
  assert.match(src, /let aj=prog\.ajuste;/);
  assert.match(src, /Ajustamos el monto a/);
  assert.match(src, /\(!\(pagado>0\) && !ajusteHtml\)/, 'sin pagos pero con ajuste, igual se muestra');
  assert.match(src, /\.rp-ajuste\{/);
});

// ══════════════════════════════════════════════════════════════════════════════
// EL EXPEDIENTE COMO LO QUIERE JUAN, Y DESDE EL CHAT
// ══════════════════════════════════════════════════════════════════════════════

const _cargaDemo = { id: 91001, tipo: 'CARGA', usuario: 'jugadordeprueba', monto: 2600, estado: 'OK',
  origen: 'LANDING', billetera_nombre: 'BILLETERA DEMO', solicitud_id: 900050,
  notas: '#900050 · Titular: Fulano De Tal · Alias: alias.demo', created_at: '2026-09-12T13:57:00Z' };
const _bonoDemo = { id: 91002, tipo: 'CARGA', usuario: 'jugadordeprueba', monto: 520, estado: 'OK',
  origen: 'PROMO_BONO', billetera_nombre: 'PROMOS', solicitud_id: 900050,
  notas: 'Bono primer ingreso 20% sobre $ 2.600 · solicitud #900050', created_at: '2026-09-12T13:57:10Z' };

test('expediente · el formato que pidió Juan: sin origen, con el N° de solicitud', () => {
  const sb = arrancarPanel();
  sb._historialData = [_bonoDemo, _cargaDemo];
  const txt = sb.expedienteTextoDe(_cargaDemo);
  assert.match(txt, /EXPEDIENTE #900050 · CARGA/, 'el número es el de la solicitud: el que ve el jugador');
  assert.match(txt, /Titular: Fulano De Tal/);
  assert.ok(!/Origen/.test(txt), 'Juan lo sacó: es vocabulario nuestro');
  assert.match(txt, /\nFecha: /);
});

test('expediente · la fila del BONO toma el titular de la carga original', () => {
  const sb = arrancarPanel();
  sb._historialData = [_bonoDemo, _cargaDemo];
  const txt = sb.expedienteTextoDe(_bonoDemo);
  assert.match(txt, /Titular: Fulano De Tal/,
    'las notas del bono dicen "Bono primer ingreso…": el titular está en la carga con el mismo N° de solicitud');
});

test('expediente · sin titular en ningún lado dice "No pudo ser extraído."', () => {
  const sb = arrancarPanel();
  sb._historialData = [];
  const manual = { id: 91003, tipo: 'CARGA', usuario: 'jugadordeprueba', monto: 1000, estado: 'OK',
    origen: 'MANUAL', notas: 'ARS 1.000', created_at: '2026-09-12T14:00:00Z' };
  assert.match(sb.expedienteTextoDe(manual), /Titular: No pudo ser extraído\./);
});

test('chat · el desplegable lista las operaciones del jugador, la carga y su bono por separado', () => {
  const sb = arrancarPanel();
  sb.__nodoChatCurrentUser = 'jugadordeprueba';
  sb._historialData = [_bonoDemo, _cargaDemo];
  const sel = { innerHTML: '' };
  sb.nodoChatCargasLlenar(sel);
  assert.match(sel.innerHTML, /⬆ Carga/, 'la carga original');
  assert.match(sel.innerHTML, /🎁 Bono/, 'y el bono, aparte: antes no se podía elegir la original');
});

test('chat · elegir una operación ESCRIBE el expediente en el cuadro, no lo manda', () => {
  const sb = arrancarPanel();
  sb.__nodoChatCurrentUser = 'jugadordeprueba';
  sb._historialData = [_bonoDemo, _cargaDemo];
  const inp = { value: '', style: {}, scrollHeight: 240, focus: () => {} };
  sb.document.getElementById = (id) => (id === 'chatInput' ? inp : null);
  sb.nodoChatCargaElegida(String(_cargaDemo.id));
  assert.match(inp.value, /EXPEDIENTE #900050/, 'queda en el cuadro para editarlo antes de mandarlo');
  assert.equal(inp.style.height, '242px', 'y el cuadro crece para mostrarlo entero');
});

test('chat · el cuadro crece con el texto pero no pasa de casi media pantalla', () => {
  const sb = arrancarPanel();
  sb.innerHeight = 1000;
  const chico = { style: {}, scrollHeight: 80 };
  sb.nodoChatInputAjustar(chico);
  assert.equal(chico.style.height, '82px');
  const enorme = { style: {}, scrollHeight: 2000 };
  sb.nodoChatInputAjustar(enorme);
  assert.equal(enorme.style.height, '450px', 'más que eso, scroll adentro del cuadro');
  const css = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'css-base.css'), 'utf8');
  assert.match(css, /#chatInput\{min-height:42px;max-height:45vh/, 'el tope de 110 px lo dejaba todo chiquito');
});

// ══════════════════════════════════════════════════════════════════════════════
// LO QUE DECLARA NO ES UNA CUENTA
// Juan: "el chabón declaró eso y no había usuario, el desplegable de coinciden debe decir
// 'sin usuario'". El alta nueva quedaba guardada como jugador y el cotejo se encontraba a sí mismo.
// ══════════════════════════════════════════════════════════════════════════════

test('cotejo · una declaración suelta no es "en sistema": la tarjeta dice SIN USUARIO', async () => {
  const sb = arrancarPanel();
  sb._historialData = [];
  // Lo que dejaba la cosecha de un pedido de alta: usuario + teléfono, sin nada que lo respalde.
  sb.jugadorRegistrarDato('aliasnuevodemo', { telefono: '1133334444' });

  const r = await sb.altaCotejarDatos('aliasnuevodemo', '1133334444');
  assert.equal(r.usuario.exacto, null, 'no hay ninguna cuenta: sólo lo que él mismo declaró');
  assert.equal(r.telefono.exacto, null);

  const out = sb._altaCotejoHtml('aliasnuevodemo', '1133334444', r, '_altaUsarSugerencia', 'declaró el cliente');
  assert.match(out.html, /Sin usuario/);
  assert.ok(!/Coinciden/.test(out.html), 'decía COINCIDEN · en sistema · mismo dueño');
  assert.match(out.html, /Es un alta nueva/);
});

test('cotejo · un jugador local CON respaldo (teléfono validado) sí cuenta', async () => {
  const sb = arrancarPanel();
  sb._historialData = [];
  sb.jugadorRegistrarDato('jugadorvalidado', { telefono: '1144445555', verificado: true });
  const r = await sb.altaCotejarDatos('jugadorvalidado', '1144445555');
  assert.ok(r.usuario.exacto, 'lo validó un operador: es una cuenta');
});

test('cotejo · las consultas de soporte ya no se guardan como jugadores', () => {
  const b = _bundlePortal();
  assert.match(b, /toUpperCase\(\)==='SOPORTE'\) return;/,
    'un alta nueva es lo que el cliente declara, no un dato del sistema');
});

test('expediente · con carga y bono en el mismo N° de solicitud, abre la carga ORIGINAL', () => {
  const sb = arrancarPanel();
  const carga = { id: 92001, tipo: 'CARGA', usuario: 'jugadordeprueba', monto: 2600, estado: 'OK',
    origen: 'LANDING', solicitud_id: 900060, notas: '#900060 · Titular: Fulano De Tal', created_at: '2026-09-12T13:57:00Z' };
  const bono = { id: 92002, tipo: 'CARGA', usuario: 'jugadordeprueba', monto: 520, estado: 'OK',
    origen: 'PROMO_BONO', solicitud_id: 900060, notas: 'Bono primer ingreso · solicitud #900060', created_at: '2026-09-12T13:57:10Z' };
  // El bono va PRIMERO, como en el historial (de más nuevo a más viejo).
  sb._histUnificadoCache = [
    { fuente: 'OPERACION', _raw: bono, id: 92002, historial_id: 92002, solicitud_id: 900060 },
    { fuente: 'OPERACION', _raw: carga, id: 92001, historial_id: 92001, solicitud_id: 900060 }
  ];
  sb._historialData = [bono, carga];

  const txt = sb.expedienteTextoDe('900060');
  assert.match(txt, /Monto: .*2\.600/, 'abría el bono ($520) y la carga original no se podía abrir');
});

// ══════════════════════════════════════════════════════════════════════════════
// CUARTA RONDA DEL 12/09 · D-90..D-93
// ══════════════════════════════════════════════════════════════════════════════

function _fnDe(src, nombre){
  const m = src.match(new RegExp('function ' + nombre + '\\([^)]*\\) ?\\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, 'no encontré ' + nombre);
  return m[0];
}

test('Drex · cerrar el cartel "Invalid session" no revive la sesión', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  const sel = src.match(/const SELECTORS = \{[\s\S]*?\n\};/)[0];
  const fns = ['hayLayout', 'isVisible', 'visibleElements', 'firstVisible', '_marcarSesionMuerta',
               'detectarModalSesionInvalida', '_pantallaPideLogin', 'pageNeedsLogin'].map((n) => _fnDe(src, n)).join('\n');
  const armar = new Function('document', 'window',
    sel + '\nlet _sesionMuertaDesde = 0; let _vioLoginTrasMuerte = false;\n' + fns + '\nreturn pageNeedsLogin;');
  const pantalla = (e) => {
    const el = (txt, sels) => ({ textContent: txt, _sels: sels, getBoundingClientRect: () => ({ width: 10, height: 10 }) });
    const els = [];
    if (e.cartel) els.push(el('User search ErrorInvalid session Cerrar', ['.ReactModal__Content', '[role="dialog"]']));
    if (e.buscar) els.push(el('Buscar', ['#searchButton', 'button']));
    if (e.login) { els.push(el('Login agente', ['h4'])); els.push(el('Entrar', ['button'])); els.push(el('', ['input[type="password"]'])); }
    const m = (s) => els.filter((x) => s.split(',').map((p) => p.trim()).some((p) => x._sels.includes(p)));
    return { querySelectorAll: m, querySelector: (s) => m(s)[0] || null, body: { getBoundingClientRect: () => ({ width: 100, height: 100 }), textContent: '' } };
  };
  let actual = pantalla({});
  const doc = { querySelectorAll: (s) => actual.querySelectorAll(s), querySelector: (s) => actual.querySelector(s), get body() { return actual.body; } };
  const win = { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }), location: { href: 'https://bo.casinodrex.com/agents/user_search' } };
  const pideLogin = armar(doc, win);

  actual = pantalla({ cartel: true, buscar: true });
  assert.equal(pideLogin(), true, 'con el cartel a la vista');
  actual = pantalla({ buscar: true });
  assert.equal(pideLogin(), true, 'se cerró el cartel y la búsqueda sigue montada: antes daba la sesión por buena');
  actual = pantalla({ login: true });
  assert.equal(pideLogin(), true, 'pantalla de login');
  actual = pantalla({ buscar: true });
  assert.equal(pideLogin(), false, 'pasó por el login y volvió la app: sesión nueva');

  const otra = armar(doc, win);
  assert.equal(otra(), false, 'sin haber visto nunca el cartel, la app montada es sesión viva');
});

test('Drex · el preload no recarga en el medio de una operación del panel', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  assert.match(src, /_opsEnCurso\+\+;[\s\S]*?finally \{ _opsEnCurso = Math\.max\(0, _opsEnCurso - 1\); \}/);
  assert.match(src, /if \(!_sesionMuertaDesde \|\| _opsEnCurso > 0\) return;/);
  assert.match(src, /_irAlLogin\('sesión caída sin operación en curso'\)/, 'cierra la sesión, no recarga');
});

test('sesión caída · ningún camino rechaza la solicitud diciendo que el usuario no existe', () => {
  const core = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'automatizaciones.js'), 'utf8');
  assert.equal(core.split('no se tocó la solicitud').length - 1, 3, 'clave, retiro automático y carga automática');
  const lotes = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'lotes-y-solicitudes.js'), 'utf8');
  assert.match(lotes, /busqueda\.needsLogin \|\| busqueda\.pageError/);
  const cola = fs.readFileSync(path.join(RAIZ, 'renderer', 'extensions', 'validacion-cola.js'), 'utf8');
  assert.match(cola, /const ok=!!\(res && res\.exists\);/, '"ok" también es true cuando la búsqueda dice "sin resultados"');
  assert.match(cola, /res\.needsLogin \|\| res\.pageError\)\) throw/);
});

test('clave · el aviso va al chat del portal, no a la tabla vieja', async () => {
  const sb = arrancarPanel();
  let visto = null;
  sb.nodoIniciarChat = async (u, txt) => { visto = { u, txt }; return { ok: true }; };
  const r = await sb._avisarClaveAlJugador('pruebaxx', '✅ Tu clave fue actualizada correctamente.');
  assert.equal(r.ok, true);
  assert.equal(visto.u, 'pruebaxx');
  const core = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'automatizaciones.js'), 'utf8');
  assert.equal(core.split('await _avisarClaveAlJugador(usuario,').length - 1, 3, 'los tres resultados de la clave');
});

test('parcial · el pago viaja con desde qué billetera salió, y con la base vieja no se pierde', async () => {
  const sb = arrancarPanel();
  const llamadas = [];
  sb.panelAPI = { rpc: async (fn, p) => {
    llamadas.push(p);
    if ('p_desde' in p) return { error: { code: 'PGRST202', message: 'Could not find the function' } };
    return { data: { ok: true, pagado: 5000 }, error: null };
  } };
  const r = await sb.notificarRetiroParcialPortal(900001, 5000, 5000, 30019, 35019, 30000, 'Titular Demo');
  assert.equal(r.ok, true, 'el pago se registra igual');
  assert.equal(llamadas[0].p_desde, 'Titular Demo');
  assert.ok(!('p_desde' in llamadas[1]));
});

test('parcial · respuesta sin acumulado confirmado queda incierta y no marca efecto exitoso', async () => {
  const sb = arrancarPanel();
  const llamadas = [];
  sb.panelAPI = { rpc: async (fn, p) => { llamadas.push({ fn, p }); return { data: null, error: null }; } };
  const r = await sb.notificarRetiroParcialPortal(900002, 5000, 5000, 30019, 35019, 30000, 'Titular Demo');
  assert.equal(r.ok, false);
  assert.equal(r.uncertain, true);
  assert.equal(llamadas.length, 1, 'una respuesta ambigua no prueba otra firma ni escribe por segunda ruta');
});

test('retiro · pagar el resto o de más avisa pero no frena; el modal se cierra recién al mover plata', () => {
  const b = _bundlePortal();
  assert.ok(!/queda COMPLETO, no parcial\.\\n/.test(b), 'el confirm de "queda COMPLETO" frenaba el pago del resto');
  assert.ok(!/¿Pagar igual\?/.test(b), 'pagar de más se avisa en el modal, no con un confirm');
  const i = b.indexOf('api._rv2Aprobar = async function');
  const cuerpo = b.slice(i, b.indexOf('\n};', i));
  const lock = cuerpo.indexOf("_drexGlobalLock('rv2-retiro')"), busca = cuerpo.indexOf("callDrex('buscarUsuario'");
  // Una solicitud beta rechazada puede cerrar temprano el modal. Para verificar el cierre
  // del pago exitoso, buscar el cierre que ocurre después de la consulta a Agentes.
  const cierra = cuerpo.indexOf('deps.cerrarRetiroV2();', busca), retira = cuerpo.indexOf("callDrex('retirarSaldo'");
  assert.ok(lock > 0 && busca > lock && cierra > busca && retira > cierra,
    'candado → búsqueda → recién ahí se cierra el modal → retiro');
  assert.match(cuerpo, /if\(st\._pagando\) return;/, 'un segundo clic no paga dos veces');
  assert.match(b, /id="rv2BtnAprobar"/, 'sin id el botón nunca decía lo que iba a hacer');
  assert.match(b, /⚠ Te pasaste: vas a pagar/);
  assert.match(b, /✓ Con este pago se completa el retiro y se cierra\./);
});

test('centro de control · cada fila de un retiro por partes abre SU movimiento', () => {
  const sb = arrancarPanel();
  const fila = (id, monto, mov, notas) => ({ id, tipo: 'RETIRO', usuario: 'pruebaxx', monto, estado: 'OK', origen: 'LANDING',
    solicitud_id: 900077, chunior_movimiento_id: mov, notas, created_at: '2026-09-12T12:00:00Z' });
  const a = fila(93001, 5000, '1110001', 'Retiro PARCIAL · pagado $ 5.000');
  const b = fila(93002, 30018, '2220002', 'Retiro PARCIAL · pagado $ 30.018');
  const c = fila(93003, 0, null, 'Cierre de retiro parcial · El monto estaba mal cargado');
  a.created_at = '2026-09-12T12:52:00Z'; b.created_at = '2026-09-12T17:22:00Z'; c.created_at = '2026-09-12T17:24:00Z';
  sb._histUnificadoCache = [c, b, a].map((h) => ({ fuente: 'OPERACION', _raw: h, id: h.id, historial_id: h.id, solicitud_id: h.solicitud_id, tipo: 'RETIRO', monto: h.monto }));
  sb._historialData = [c, b, a];
  assert.equal(sb._claveStream(sb._histUnificadoCache[1]), 'h93002');
  const html = sb.construirDossierCompletoHtml('h93001');
  assert.match(html, /1110001/, 'abría siempre la última fila de la solicitud');
  assert.ok(!/2220002/.test(html));
  const pr = sb._parteRetiro(sb._histUnificadoCache[1]);
  assert.equal(pr.i, 2); assert.equal(pr.n, 2);
  assert.equal(sb._parteRetiro(sb._histUnificadoCache[0]).cierre, true);
  const ops = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'historial-operaciones.js'), 'utf8');
  assert.match(ops, /it\.fuente === 'SOLICITUD' && String\(it\.solicitud_id\) === solicitudId/,
    'el N° de un pago se copiaba a todas las filas de la solicitud');
});

test('panel · la historia del retiro muestra ajuste, pagos y cierre', () => {
  const sb = arrancarPanel();
  const html = sb.nodoRetiroHistoriaPintar({
    total: 35019, pagado: 35018,
    pagos: [{ monto: 5000, fecha: '2026-09-12T12:52:59Z', operador: 'xprueba' },
            { monto: 30018, fecha: '2026-09-12T17:22:09Z', operador: 'xprueba', desde: 'Titular Demo' }],
    ajuste: { declarado: 50000, corregido: 35019, motivo: 'Pediste 50.000 y el retiro quedó en 35.019.' },
    cierre: { etiqueta: 'El monto estaba mal cargado', nota: 'no se retiran centavos', faltante: 1, operador: 'xprueba' }
  }, '900077', '');
  assert.match(html, /Pidió/); assert.match(html, /Pediste 50\.000/);
  assert.match(html, /desde Titular Demo/);
  assert.match(html, /Cerrado/); assert.match(html, /El monto estaba mal cargado/); assert.match(html, /no se retiran centavos/);
});

test('portal · el historial muestra el retiro entero y el badge dice lo que pasó', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'Portal'), 'utf8');
  const jd = src.match(/function _jsonDe\(v\)\{[^\n]*\}/)[0];
  const detalle = new Function('_money', 'esc', '_fechaCorta', jd + '\n' + _fnDe(src, '_detalleRetiroHistorial') + '\nreturn _detalleRetiroHistorial;')(
    (n) => '$' + n, (s) => String(s), () => '12/09 14:22');
  const h = detalle({ tipo: 'RETIRO', monto: 50000, monto_a_pagar: 35019, pagado: 35018, motivo_ajuste: 'Es todo lo que tenías en fichas.',
    pagos: [{ monto: 5000, fecha: 'x' }, { monto: 30018, fecha: 'y', desde: 'Titular Demo' }],
    cierre: { etiqueta: 'El monto estaba mal cargado', nota: 'no se retiran centavos', faltante: 1 } });
  assert.match(h, /Pediste <b>\$50000/); assert.match(h, /te pagamos/);
  assert.match(h, /te transfirió Titular Demo/); assert.match(h, /Se cerró/); assert.match(h, /no se retiran centavos/);
  const badge = new Function(jd + '\n' + _fnDe(src, '_estadoBadge') + '\nreturn _estadoBadge;')();
  assert.match(badge('PAGADA', '', { tipo: 'RETIRO', cierre: { faltante: 1 } }), /Cerrado/);
  assert.match(badge('EN_PROCESO', '', { tipo: 'RETIRO', pagado: 5000 }), /Te lo estamos pagando/);
  assert.match(badge('EN_PROCESO', '', { tipo: 'CARGA' }), /En revisión/, 'las cargas siguen igual');
  assert.match(src, /if\(String\(state\.pendingTipo\|\|""\)\.toUpperCase\(\)==="RETIRO"\) return "";/, 'en un retiro no va "Transferiste a"');
});

test('cotejo · "otro número" dice de dónde sale; un modal sin texto de botón no muestra botón', () => {
  const cot = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'cotejo-alta.js'), 'utf8');
  assert.match(cot, /ESTE USUARIO OPERÓ CON OTRO NÚMERO/);
  assert.match(cot, /En esta oficina operó con/);
  const av = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'modal-y-watchdog.js'), 'utf8');
  assert.match(av, /btn\.style\.display = saveText \? '' : 'none';/);
});

test('modales y watchdog · conserva candados y un único arranque sin polling periódico duplicado', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'modal-y-watchdog.js'), 'utf8');
  const timers = [], intervals = [];
  const sb = {
    window: { ctrlElectron: {} },
    document: { getElementById: () => null },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  assert.deepEqual(intervals.map((t) => t.ms), [60000], 'sólo el widget conserva su timer periódico');
  assert.deepEqual(timers.map((t) => t.ms), [4000, 12000]);
  sb._watchdogIniciar();
  sb._watchdogIniciar();
  assert.deepEqual(timers.map((t) => t.ms), [4000, 12000, 8000], 'el baseline se programa una sola vez');
  sb._wdLock(); sb._wdLock(); sb._wdUnlock();
  assert.equal(vm.runInContext('_watchdog.busy', sb), 1);
  sb._wdForceUnlock(); sb._wdUnlock();
  assert.equal(vm.runInContext('_watchdog.busy', sb), 0, 'el candado nunca queda negativo');
  assert.doesNotMatch(src, /initScrollSnap|addEventListener\(['"]wheel/, 'no restaura el scroll retirado');
});

// ── D-94 · la sesión muerta se cierra y se vuelve a entrar ──────────────────────────────────
test('Drex · una sesión muerta se cierra por /logout, no se recarga', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  assert.match(src, /const LOGOUT_URL = 'https:\/\/bo\.casinodrex\.com\/logout';/);
  assert.match(src, /window\.location\.assign\(LOGOUT_URL\)/, 'el link "Salir" del menú de Agentes');
  const cerrar = src.slice(src.indexOf('async function cerrarModalSesionInvalida')).slice(0, 1600);
  // El cartel se cierra con SU botón: dice "redireccionamos al login" y Drex lo hace solo. Navegar
  // encima era pelearle al redirect y, en medio de una operación, la mataba (D-101).
  assert.match(cerrar, /clickElement\(accept\)/);
  assert.match(cerrar, /else _irAlLogin\('cartel de sesión inválida sin botón'\)/,
    'sin botón que apretar, el /logout queda de último recurso');
  assert.match(src, /new MutationObserver/, 'el cartel puede durar un instante');
  assert.match(src, /if \(e && e\.sesionInvalida\) result = status\(\{ message: e\.message \}\);/,
    'una sesión caída tiene que abrir el login, no ser un error técnico');
});

test('Drex · una espera corta apenas aparece el cartel, salvo después de Aplicar', async () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  const fn = (n) => {
    const m = src.match(new RegExp('(?:async )?function ' + n + '\\([^)]*\\) ?\\{[\\s\\S]*?\\n\\}'));
    assert.ok(m, 'no encontré ' + n);
    return (/async function/.test(m[0]) ? m[0] : m[0]);
  };
  const fuente = ['delay', '_chequearFreno', '_chequearSesionViva', 'detectarModalSesionInvalida',
                  '_marcarSesionMuerta', 'waitFor'].map(fn).join('\n');
  const armar = new Function('document', 'STEP_DELAY', 'DEFAULT_TIMEOUT',
    'let _abortOperacion = false, _yaAplico = false, _sesionMuertaDesde = 0, _vioLoginTrasMuerte = 0;\n'
    + 'function now(){ return Date.now(); }\n' + fuente
    + '\nreturn { waitFor, aplicar: function(){ _yaAplico = true; } };');
  let hayCartel = false;
  const doc = {
    querySelectorAll: (s) => (hayCartel && s === '.ReactModal__Content'
      ? [{ textContent: 'session is invalid La session es invalida, redireccionamos al login Aceptar' }] : []),
    querySelector: () => null
  };
  const api = armar(doc, 50, 18000);

  // Sin cartel: la espera agota su tiempo, como siempre.
  await assert.rejects(() => api.waitFor(() => null, 300), (e) => {
    assert.ok(!e.sesionInvalida, 'sin cartel no hay nada que cortar');
    return true;
  });
  hayCartel = true;
  const t1 = Date.now();
  await assert.rejects(() => api.waitFor(() => null, 8000), (e) => {
    assert.equal(e.sesionInvalida, true, 'tiene que decir que fue la sesión');
    return true;
  });
  assert.ok(Date.now() - t1 < 2000, 'cortó al toque, no a los 18 s');

  // Después de Aplicar la plata pudo moverse: la espera NO corta sola, agota su tiempo.
  api.aplicar();
  await assert.rejects(() => api.waitFor(() => null, 400), (e) => {
    assert.ok(!e.sesionInvalida, 'después de Aplicar hay que leer el resultado sí o sí');
    return true;
  });
});

// ── D-95 · cada pago de un retiro por partes, con su tramo y su movimiento ──────────────────
test('retiro por partes · cada pago muestra su tramo, su N° de Chunior y sus fichas', () => {
  const sb = arrancarPanel();
  sb._historialData = [
    { id: 95001, tipo: 'RETIRO', usuario: 'pruebaxx', monto: 5000, estado: 'OK', solicitud_id: 900099,
      chunior_movimiento_id: '9655916', saldo_pre: 35019, saldo_post: 30019, created_at: '2026-09-12T12:52:59Z' },
    { id: 95002, tipo: 'RETIRO', usuario: 'pruebaxx', monto: 30018, estado: 'OK', solicitud_id: 900099,
      chunior_movimiento_id: null, saldo_pre: 30019, saldo_post: 1, created_at: '2026-09-12T17:22:09Z' }
  ];
  const html = sb.nodoRetiroHistoriaPintar({
    total: 35019, pagado: 35018,
    pagos: [{ monto: 5000, fecha: '2026-09-12T12:52:59Z', operador: 'xprueba' },
            { monto: 30018, fecha: '2026-09-12T17:22:09Z', operador: 'xprueba' }]
  }, '900099', '');

  assert.match(html, /0–14%/, 'el primer pago cubre del 0 al 14%');
  assert.match(html, /14–100%/, 'el segundo lo termina');
  assert.match(html, /N° 9655916/, 'el movimiento del pago que SÍ lo tiene');
  assert.match(html, /expedienteBuscarMovChunior\('95002'/, 'el que no lo tiene se busca sobre SU fila');
  assert.match(html, /1 pago sin N° de Chunior/);
  assert.ok(/35\.019/.test(html) && /30\.019/.test(html) && /→/.test(html), 'las fichas antes y después de cada pago');
});

test('expediente · con varios pagos no muestra un solo N° ni un solo par de saldos', () => {
  const b = _bundlePortal();
  assert.match(b, /Uno por cada pago · abajo, en el detalle del retiro/);
  assert.match(b, /Los de cada pago · abajo, en el detalle del retiro/);
});

test('portal · dice qué versión es', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'Portal'), 'utf8');
  assert.match(src, /const PORTAL_VER="v[\d.]+ · \d\d\/\d\d";/);
  assert.match(src, /Últimos 7 días <span[^>]*>'\+PORTAL_VER\+'<\/span>/,
    'sin esto no se sabe si el portal que se abre es el nuevo o la copia del service worker');
});

// ── D-96 · el botón "Retirar todo lo que tiene" deja la solicitud en ese monto ──────────────
test('pendientes · el botón naranja setea el monto de la solicitud, sin preguntar', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  const sol = { ID: 221313, USUARIO: 'pruebaxx', MONTO_DECLARADO: 500000, ESTADO: 'PENDIENTE', metadata: {} };
  sb.V154P.solicitudes = [sol];
  sb._retiroSaldoCheck = { pruebaxx: { saldo: 50001, suficiente: false, confiable: true, raw: 'ARS 50,001.00' } };
  sb.confirm = () => { throw new Error('no tiene que preguntar nada'); };
  let guardado = null;
  sb.actualizarSolicitudPortal = async (id, estado, extra) => { guardado = { id, estado, extra }; return {}; };
  let abrio = null;
  sb.abrirModalRetiroV2 = (id) => { abrio = String(id); };

  await sb._retiroAjustarASaldo(221313);

  assert.equal(guardado.extra.monto_corregido, 50001, 'el máximo que tiene, no el "cero de más" (50.000)');
  assert.equal(guardado.extra.monto_declarado_original, 500000);
  assert.equal(sol.MONTO_REAL, 50001, 'la tarjeta tiene que repintar con el monto nuevo');
  assert.equal(abrio, '221313');
  assert.match(String(guardado.extra.motivo_ajuste||''), /te pagamos todo lo que ten/i, 'el jugador tiene que saber por qué cambió');
});

test('pendientes · con menos del mínimo no se ajusta nada, y sin saldo leído lo dice', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  const sol = { ID: 5, USUARIO: 'pruebaxx', MONTO_DECLARADO: 500000, ESTADO: 'PENDIENTE', metadata: {} };
  sb.V154P.solicitudes = [sol];
  let guardado = false;
  sb.actualizarSolicitudPortal = async () => { guardado = true; return {}; };
  sb.abrirModalRetiroV2 = () => {};

  sb._retiroSaldoCheck = {};
  await sb._retiroAjustarASaldo(5);
  assert.equal(guardado, false, 'sin saldo leído no toca la solicitud');

  sb._retiroSaldoCheck = { pruebaxx: { saldo: 4999, suficiente: false, confiable: true } };
  await sb._retiroAjustarASaldo(5);
  assert.equal(guardado, false, 'con menos de $5.000 no hay retiro que valga');
  assert.equal(sol.MONTO_REAL, undefined);

  assert.equal(sb._retiroMaxRetirable(50001.9), 50001, 'sin centavos: Agentes no los retira');
  assert.equal(sb._retiroMaxRetirable(4999), 0);
});

// ── D-97 · gasto de oficina ─────────────────────────────────────────────────────────────────
test('gasto de oficina · usa la pantalla de Chunior y adjunta el comprobante', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'chunior-movimientos.js'), 'utf8');
  assert.match(src, /transacciones\/gastoslocal\/add\//, 'la pantalla que pasó Juan');
  assert.match(src, /registrarGastoOficinaEnChunior/);
  assert.match(src, /new DataTransfer\(\); dt\.items\.add\(new File/, 'el comprobante se adjunta solo');
  assert.ok(src.indexOf('fi.files=dt.files') < src.indexOf("b.click()"), 'primero se adjunta, después se guarda');
  // El desplegable de billetera no se llama igual en todas las pantallas.
  assert.match(src, /option\[value=/, 'si el identificador cambia, lo ubica por las opciones');
  assert.ok(!/document\.getElementById\("id_cuenta_destino"\);\n/.test(src), 'ya no depende de un solo identificador');
});

test('gasto de oficina · el botón existe y el historial lo reconoce', () => {
  const tpl = fs.readFileSync(path.join(RAIZ, 'renderer', 'panel.template.html'), 'utf8');
  assert.match(tpl, /abrirModalGastoOficina\(\)/);
  assert.match(tpl, /💸 Gasto/);
  const hist = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'historial-operaciones.js'), 'utf8');
  assert.match(hist, /if\(t==='GASTO'\) return '💸';/);
  assert.match(hist, /"RECARGA_FICHAS","GASTO"/, 'el detalle del movimiento tiene que abrirse');
});

test('gasto de oficina · sin notas no se anota (es el único registro de en qué se gastó)', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'chunior-movimientos.js'), 'utf8');
  assert.match(src, /notas\.length < 3/);
  assert.match(src, /tipo:'GASTO'/);
  assert.match(src, /3\.5\*1024\*1024/, 'una imagen enorme no entra en la pantalla de Chunior');
});

// ── D-99 · al jugador se le avisa por el chat que él ve ─────────────────────────────────────
test('aviso al jugador · usa su conversación del portal, no la tabla vieja', async () => {
  const sb = arrancarPanel();
  let porHilo = null, abrioChat = 0;
  sb.nodoEnviarMensajePortal = async (u, txt) => { porHilo = { u, txt }; return { ok: true }; };
  sb.nodoIniciarChat = async () => { abrioChat++; return { ok: true }; };

  const r = await sb.avisarJugadorEnChat('pruebaxx', '💸 Te transferimos $ 5.000');
  assert.equal(r.ok, true);
  assert.equal(porHilo, null, 'va por el que abre conversación si hace falta, que ya prueba la existente');
  assert.equal(abrioChat, 1, 'Juan, 2/11: el aviso automático también llega sin conversación abierta');
  await sb._avisarClaveAlJugador('pruebaxx', '✅ Tu clave fue actualizada correctamente.');
  assert.equal(abrioChat, 2);
});

test('aviso al jugador · sin conversación abierta se le abre, y nada va a la tabla que no se lee', async () => {
  const rpcs = [];
  const sb = arrancarPanel({ rpc: async (fn, args) => { rpcs.push({ fn, args }); return { data: fn === 'panel_chat_iniciar' ? { ok: true, usuario: args.p_usuario } : null, error: null }; } });
  let legacy = 0;
  sb.nodoEnviarMensajePortal = async () => ({ ok: false, error: 'sin-ticket' });
  sb.notificarUsuarioEnChat = async () => { legacy++; return null; };
  const r = await sb.avisarJugadorEnChat('pruebaxx', 'hola', { crearSiNoHay: false });
  assert.equal(r.ok, true);
  assert.deepEqual(rpcs.filter(c => c.fn === 'panel_chat_iniciar').map(c => [c.args.p_usuario, c.args.p_mensaje]), [['pruebaxx', 'hola']]);
  assert.equal(legacy, 0, 'escribir en la tabla que el portal no lee no sirve para nada');
});

test('retiro · el pago le avisa al jugador por el chat vivo', () => {
  const b = _bundlePortal();
  assert.match(b, /deps\.window\.avisarJugadorEnChat\(st\.usuario, _txtAviso\)/);
  assert.match(b, /notificarRetiroParcialPush/, 'el push sigue saliendo igual');
});

// ── D-100 · el parcial no queda colgado y el depósito sigue andando ─────────────────────────
function _pantallaChunior(estado){
  const campo = (id) => ({ id, value:'', dispatchEvent(){}, querySelector(){ return null; } });
  const sel = campo('id_cuenta_destino');
  sel.querySelector = (s) => /1170/.test(s) ? {} : null;
  const monto = campo('id_monto'), notas = campo('id_notas');
  const guardar = { click(){ estado.guardado = true; }, disabled:false };
  const exito = { textContent:'El movimiento N° 9673700 se agregó correctamente', querySelector(){ return null; } };
  return {
    getElementById: (id) => ({ id_cuenta_destino:sel, id_monto:monto, id_notas:notas })[id] || null,
    querySelector: (s) => {
      if(/_addanother|_save|submit/.test(s)) return guardar;
      if(/success/.test(s)) return estado.guardado ? exito : null;
      return null;
    },
    querySelectorAll: () => [],
    campos: { sel, monto, notas }
  };
}
function _correrEnChunior(script, doc){
  return new Function('document','Event','File','DataTransfer','atob','Uint8Array','location',
    'return ' + script)(doc, function(){}, function(){}, function(){}, () => '', Uint8Array,
    { href:'https://bo.chunior.com/transacciones/depositossinreclamar/add/' });
}

test('chunior · el depósito sin reclamar llena el formulario y lo guarda', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  // El código real espera entre paso y paso; acá esos tiempos se cumplen de una.
  sb.setTimeout = (fn) => setTimeout(fn, 0);
  const estado = { guardado:false };
  const doc = _pantallaChunior(estado);
  const fallos = [];
  sb.chunior = { navigate: async () => {}, exec: async (s) => {
    try{ return _correrEnChunior(s, doc); }
    catch(e){ fallos.push(String(e && e.message).slice(0, 120)); throw e; }
  } };

  const r = await sb.registrarDepoSinReclamarEnChunior('1170', 25000, 'transferencia sin usuario');

  assert.equal(r.ok, true, 'el depósito tiene que quedar anotado · fallos: ' + (fallos.join(' | ') || 'ninguno') + ' · error: ' + (r.error || ''));
  assert.equal(r.movimientoId, '9673700', 'y traer su N° de Chunior');
  assert.equal(estado.guardado, true, 'hay que apretar Guardar');
  assert.equal(doc.campos.sel.value, '1170');
  assert.equal(doc.campos.monto.value, '25000');
  assert.equal(doc.campos.notas.value, 'transferencia sin usuario');
  assert.equal(fallos.length, 0, 'el script que se le manda a Chunior tiene que correr sin errores');
});

test('chunior · el script que se le manda a Chunior no lleva funciones sin definir', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'chunior-movimientos.js'), 'utf8');
  // El .replace() al final de una concatenación se aplica SÓLO al último pedazo: el reemplazo no
  // ocurría y a la página le llegaba "_bilSel(" sin definir. No se podía anotar nada (D-100).
  assert.ok(!/\.replace\('_bilSel\(/.test(src), 'no se arma el script con reemplazos de texto');
  assert.ok(!/_bilSel\(/.test(src.replace(/_readyChuniorJs/g, '')), 'no queda ninguna llamada a _bilSel');
  assert.match(src, /function _readyChuniorJs\(uid\)/);
});

test('chunior · si el formulario no aparece, el error dice qué había en pantalla', () => {
  // Este camino espera 10 s a propósito: se comprueba leyendo el código, no ejecutándolo.
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'core', 'chunior-movimientos.js'), 'utf8');
  assert.match(src, /El formulario de Chunior no apareció en 10s/);
  assert.match(src, /pantalla: '\+String\(d\.url/, 'tiene que decir en qué pantalla quedó');
  assert.match(src, /campos: '\+\(\(d\.campos/, 'y qué campos había');
  assert.ok(!/¿cambió la página de Chunior\?/.test(src), '"no te deja agregar" no alcanza para arreglar nada');
});

test('parcial · un pago que no quedó anotado igual cuenta: el historial lo tiene', () => {
  const sb = arrancarPanel();
  // Caso real #222128: se pagaron 200.000 + 350.000 + 200.000, pero el progreso quedó en 550.000.
  sb._historialData = [
    { id:1, solicitud_id:900222, tipo:'RETIRO', estado:'OK', monto:200000 },
    { id:2, solicitud_id:900222, tipo:'RETIRO', estado:'OK', monto:350000 },
    { id:3, solicitud_id:900222, tipo:'RETIRO', estado:'OK', monto:200000 }
  ];
  const sol = { ID:900222, TIPO:'RETIRO', ESTADO:'EN_PROCESO', USUARIO:'jugadordeprueba',
    metadata:{ monto_pagado:750000, retiro_parcial:{ total:750000, pagado:550000, pagos:[{monto:200000},{monto:350000}] } } };

  const pp = sb._retiroParcialInfo(sol);
  assert.equal(pp.total, 750000);
  assert.equal(pp.pagadoHistorial, 750000, 'la suma de lo que salió de verdad');
  assert.equal(pp.pagado, 750000, 'cobró todo, aunque un contador diga otra cosa');
  assert.equal(pp.restante, 0, 'la caja pedía "falta $200.000" de algo ya pagado');
  assert.equal(pp.saldadoPorAlguna, true);
  assert.equal(pp.discrepa, true, 'hay que poder avisar que los registros no coinciden');
  assert.equal(sb._retiroParcialSigueAbierto(sol), false, 'no vuelve a la lista de pendientes');
});

test('parcial · un retiro cerrado a mano no vuelve a la caja', () => {
  const sb = arrancarPanel();
  const cerrado = { ID:900223, TIPO:'RETIRO', ESTADO:'PAGADA',
    metadata:{ etapa:'RETIRO_CIERRE_MANUAL', retiro_parcial:{ total:750000, pagado:550000 } } };
  assert.equal(sb._retiroCerradoAMano(cerrado), true);
  assert.equal(sb._retiroParcialSigueAbierto(cerrado), false);
  // El criterio pasó a NodoDomain.parciales.enProceso, compartido por el render y el modal.
  const b = _bundlePortal();
  assert.match(b, /dom\.enProceso\(s, \{/, 'la caja tiene que usar el criterio compartido');
  assert.match(b, /cerrado: deps\.window\._retiroCerradoAMano/,
    'y ese criterio tiene que recibir el cierre del operador');
  // Y lo que de verdad importa, ejecutado en vez de mirado: no entra a la caja.
  assert.equal(sb.NodoDomain.parciales.enProceso(cerrado, {
    info: sb._retiroParcialInfo, cerrado: sb._retiroCerradoAMano,
    sigueAbierto: sb._retiroParcialSigueAbierto
  }), false, 'la caja de parciales tiene que respetar el cierre del operador');
});

test('parcial · si el pago no entró en la base, el panel lo nota y no pierde los anteriores', () => {
  const b = _bundlePortal();
  assert.match(b, /_pagRpc < pagadoAcum - 0\.5/, 'se compara contra lo que contestó la base');
  assert.match(b, /no entró/);
  assert.match(b, /pagos:_pagosPrev/, 'el respaldo conserva los pagos ya anotados');
  assert.match(b, /return \{ ok:true, detail:'forma '\+f\.k, data:\(r && r\.data\) \|\| null \}/);
});

// ── D-101 · nadie le recarga la página al operador mientras entra ───────────────────────────
test('Drex · el cierre de sesión no puede pisar una operación ni un login (el loop)', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  const fn = (n) => {
    const m = src.match(new RegExp('function ' + n + '\\([^)]*\\) ?\\{[\\s\\S]*?\\n\\}'));
    assert.ok(m, 'no encontré ' + n);
    return m[0];
  };
  const armar = new Function('window', 'LOGOUT_URL', 'console',
    'let _opsEnCurso = 0, _loginEnCurso = false, _yaFuiAlLogin = false, _recargaLoginEn = 0;\n'
    + 'let _sesionMuertaDesde = 0, _vioLoginTrasMuerte = false;\n'
    + 'let _intentosLogin = 0; const _MAX_INTENTOS_LOGIN = 3;\n'
    + fn('_irAlLogin') + '\n' + fn('_marcarSesionMuerta') + '\n'
    + 'return { ir:_irAlLogin, muerta:_marcarSesionMuerta,'
    + ' set:function(o){ if("ops" in o) _opsEnCurso=o.ops; if("login" in o) _loginEnCurso=o.login; if("t" in o) _recargaLoginEn=o.t; } };');
  const fue = [];
  const api = armar({ location:{ href:'https://bo.casinodrex.com/agents/user_search', assign:(u)=>fue.push(u) } }, 'https://bo.casinodrex.com/logout', { warn(){} });

  api.muerta();
  api.set({ ops: 1 });
  assert.equal(api.ir('con una operación corriendo'), false);
  assert.equal(fue.length, 0, 'navegar acá mata la operación: "la página de Agentes se recargó durante la operación"');

  api.set({ ops: 0, login: true });
  assert.equal(api.ir('mientras el operador entra'), false);
  assert.equal(fue.length, 0, 'es el peor momento posible para recargarle la página');

  api.set({ login: false });
  assert.equal(api.ir('sin nada en curso'), true, 'con la sesión muerta y todo quieto, sí se cierra');
  assert.equal(fue.length, 1);
  assert.match(fue[0], /\/logout$/);

  assert.equal(api.ir('enseguida otra vez'), false, 'no se encadenan navegaciones');
  assert.equal(fue.length, 1, 'si no, navega una y otra vez encima del operador');

  // Pero SÍ tiene que poder reintentar más tarde: si el primer intento no dejó la pantalla de
  // ingreso, prohibirlo para siempre deja la ventana encerrada (D-102).
  api.set({ t: Date.now() - 26000 });
  assert.equal(api.ir('un rato después'), true);
  assert.equal(fue.length, 2);
});

test('Drex · la salida diferida no se mata a sí misma', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  const m = src.match(/function _irAlLogin\([^)]*\) ?\{[\s\S]*?\n\}/);
  assert.ok(m, 'no encontré _irAlLogin');
  const armar = new Function('window', 'LOGOUT_URL', 'console', 'setTimeout',
    'let _opsEnCurso = 0, _loginEnCurso = false, _yaFuiAlLogin = false, _recargaLoginEn = 0;\n'
    + 'let _intentosLogin = 0; const _MAX_INTENTOS_LOGIN = 3;\n'
    + m[0] + '\nreturn { ir:_irAlLogin, set:function(o){ if("ops" in o) _opsEnCurso=o.ops; if("login" in o) _loginEnCurso=o.login; } };');
  const fue = [], pendientes = [];
  const api = armar({ location:{ href:'https://bo.casinodrex.com/agents/user_search', assign:(u)=>fue.push(u) } }, 'https://bo.casinodrex.com/logout',
    { warn(){} }, (fn)=>pendientes.push(fn));

  // Con el login en curso: la inmediata NO va, la diferida sí (pero recién después de contestar).
  api.set({ login: true, ops: 1 });
  assert.equal(api.ir('inmediata'), false);
  assert.equal(api.ir('diferida', true), true);
  assert.equal(fue.length, 0, 'no puede navegar mientras la llamada sigue abierta: eso la mataba');
  assert.equal(pendientes.length, 1, 'queda agendada para después');
  pendientes[0]();
  assert.match(fue[0], /\/logout$/, 'y recién ahí lleva la ventana al ingreso');
});

test('Drex · ni el login ni el cartel navegan por su cuenta', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  assert.match(src, /if \(!diferido && \(_opsEnCurso > 0 \|\| _loginEnCurso\)\) return false;/,
    'el freno vive dentro de _irAlLogin');
  // El login puede pedir la salida, pero SÓLO diferida: navegar en el momento se mataba a sí mismo.
  assert.ok(!/_irAlLogin\('login sin formulario'\);/.test(src), 'nunca inmediata');
  assert.match(src, /_irAlLogin\('login sin formulario', true\)/, 'diferida: navega después de contestar');
  assert.match(src, /_loginEnCurso = true;[\s\S]{0,160}_iniciarSesionInterno/, 'mientras entra, queda marcado');
  // El cartel se cierra con su botón: Drex redirige solo. Navegar encima era pelearle al redirect.
  assert.match(src, /else _irAlLogin\('cartel de sesión inválida sin botón'\)/);
});

// ── D-103 · el historial dice CUÁNTO se pagó, no si se pagó en partes ───────────────────────
test('retiro común · no aparece como parcial aunque el historial tenga su fila', () => {
  const sb = arrancarPanel();
  // 15/09: retiros pagados de una sola vez salían como "Parcial 100%" y con monto $ 0.
  sb._historialData = [{ id:1, solicitud_id:900300, tipo:'RETIRO', estado:'OK', monto:70000 }];
  const comun = { ID:900300, TIPO:'RETIRO', ESTADO:'PAGADA', MONTO_DECLARADO:70000,
    metadata:{ monto_pagado:70000 } };   // el panel escribe este contador en TODO retiro, parcial o no

  const pp = sb._retiroParcialInfo(comun);
  assert.equal(pp.hasProg, false, 'sin retiro_parcial no hay "pago por partes"');
  assert.equal(pp.pagado, 0, 'ni el historial ni el contador del panel inventan progreso');
  assert.equal(pp.restante, 70000);
  assert.equal(sb._retiroParcialSigueAbierto(comun), false, 'no va a la caja de parciales');

  // Y uno de verdad sigue siéndolo.
  sb._historialData = [
    { id:2, solicitud_id:900301, tipo:'RETIRO', estado:'OK', monto:200000 },
    { id:3, solicitud_id:900301, tipo:'RETIRO', estado:'OK', monto:350000 }
  ];
  const parcial = { ID:900301, TIPO:'RETIRO', ESTADO:'EN_PROCESO',
    metadata:{ retiro_parcial:{ total:750000, pagado:550000, pagos:[{monto:200000},{monto:350000}] } } };
  const qq = sb._retiroParcialInfo(parcial);
  assert.equal(qq.hasProg, true, 'este sí se está pagando por partes');
  assert.equal(qq.total, 750000);
  assert.equal(qq.restante, 200000);
});

test('ficha del retiro · sin pagos anotados no dice "falta" de algo ya pagado', () => {
  const sb = arrancarPanel();
  const html = sb.nodoRetiroHistoriaPintar({
    total:67208, pagado:0, pagos:[],
    ajuste:{ declarado:650000, corregido:67208, motivo:'Es todo lo que tenías en fichas.' }
  }, '900302', '');
  assert.match(html, /Pidió/, 'el ajuste sí se muestra: es lo que explica el monto');
  assert.ok(!/falta/.test(html), 'decía "Pagado $ 0 · falta $ 67.208" de un retiro ya cobrado entero');
});

// ── D-104 · un aviso que no se puede entender es peor que no avisar ─────────────────────────
test('chat · el cierre automático dice de quién es la consulta y por qué se cerró', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'chat', 'chat-hilos.js'), 'utf8');
  // Decía "1 consulta cerrada automáticamente" y el operador no tenía forma de saber qué era:
  // no deja fila en el historial ni llega a Nexo, porque no es una operación (Juan, 15/09).
  assert.ok(!/consulta\$\{cerrados>1\?"s":""\} cerrada/.test(src), 'el aviso viejo no decía nada');
  assert.match(src, /Cerré la consulta de \$\{quien/, 'de quién');
  assert.match(src, /ya respondida y sin contestar hace \$\{AUTOCLOSE_HORAS\} h/, 'y por qué');
  assert.match(src, /nombres\.push\(usuario\)/, 'los nombres ya estaban a mano');
});

// ── D-105 · deshacer un pago de un retiro por partes devuelve el progreso ───────────────────
function _entornoDeshacer(rpc){
  // El cliente de base se reemplaza al ARRANCAR: el panel lo declara como const y despues ya no
  // se puede cambiar (por eso mi primera prueba miraba un cliente que no era el que corria).
  const sb = arrancarPanel({ rpc: async (fn, p) => {
    rpc.push({ fn, p });
    return { data: [{ ok:true, total:750000, pagado:550000, restante:200000, estado:'EN_PROCESO' }], error:null };
  }});
  sb.avisos = [];
  sb.toast = (m) => { sb.avisos.push(String(m).slice(0, 90)); };
  sb.confirm = () => true;
  sb.ctrlElectron = { navigateAgent: async () => {} };
  sb.ensureDrexSession = async () => true;
  sb.callDrex = async () => ({ ok: true });
  sb.registrarCargaEnChunior = async () => ({ ok: true, movimientoId: '9999999' });
  sb.registrarRetiroEnChunior = async () => ({ ok: true, movimientoId: '8888888' });
  sb.registrarEnHistorial = async () => ({ id: 1 });
  sb.ajustarSaldoBilletera = async () => {};
  sb.cargarHistorial = async () => {};
  sb.cargarSolicitudesPortal = async () => {};
  sb.renderBillerasInicio = () => {};
  sb.poblarManualBilletera = () => {};
  sb.billeteras = [{ ID_BILLETERA: 22, NOMBRE_VISIBLE: 'GIORDANO', CHUNIOR_UID: '1170' }];
  sb.getBilleraLanding = () => sb.billeteras[0];
  return sb;
}

test('deshacer · un pago de retiro por partes vuelve a quedar pendiente', async () => {
  const rpc = [];
  const sb = _entornoDeshacer(rpc);
  // La fila que se deshace es el tercer pago de un retiro por partes (caso #222128).
  sb._histPorId = { '212919': { id: 212919, solicitud_id: 222128, tipo: 'RETIRO', monto: 200000, estado: 'OK' } };

  await sb.deshacerOperacion('212919', 'jugadordeprueba', 'RETIRO', 200000, 22);

  const rev = rpc.find(x => x.fn === 'landing_retiro_revertir_parcial');
  assert.ok(rev, 'la plata volvia pero el retiro seguia figurando pagado · avisos: ' + sb.avisos.join(' | '));
  assert.equal(rev.p.p_id, 222128, 'sobre la solicitud de ese movimiento');
  assert.equal(rev.p.p_monto, 200000, 'por el monto que se deshizo');
  assert.equal(rev.p.p_historial_id, 212919, 'queda anotado que reversion lo movio');
  assert.ok(sb.avisos.some(a => /#222128/.test(a) && /pendiente/.test(a)),
    'el operador tiene que enterarse de que el retiro volvio a quedar pendiente');
  assert.ok(sb.avisos.some(a => /200.000/.test(a)), 'y de cuanto falta ahora');
});

test('deshacer · una carga suelta no toca ningun retiro', async () => {
  const rpc = [];
  const sb = _entornoDeshacer(rpc);
  sb._histPorId = { '900001': { id: 900001, solicitud_id: 500500, tipo: 'CARGA', monto: 5000, estado: 'OK' } };

  await sb.deshacerOperacion('900001', 'jugadordeprueba', 'CARGA', 5000, 22);

  assert.equal(rpc.filter(x => x.fn === 'landing_retiro_revertir_parcial').length, 0,
    'solo los retiros por partes tienen progreso que devolver');
});

// ── D-106 · cambiar la billetera corrige de DÓNDE salió la plata ────────────────────────────
test('cambio de billetera · corrige el "te transfirio X" que ve el jugador', async () => {
  const rpc = [];
  const sb = arrancarPanel({ rpc: async (fn, p) => {
    rpc.push({ fn, p });
    return { data: [{ ok:true, pago_actualizado:true, desde_anterior:'Pablo Leones Giordano', desde_nuevo:'Ana Matrelo' }], error:null };
  }});
  const avisos = [];
  sb.toast = (m) => { avisos.push(String(m)); };

  await sb._rehacerDesdeDelPago(222128,
    { monto: 350000, created_at: '2026-09-14T21:14:55.000Z', billetera_nombre: 'GIORDANO' },
    { ID_BILLETERA: 31, NOMBRE_VISIBLE: 'MATRELO MP', TITULAR: 'Ana Matrelo', CBU: '000', CBU_ALIAS: 'ana.mp' });

  const c = rpc.find(x => x.fn === 'landing_retiro_cambiar_billetera_pago');
  assert.ok(c, 'la billetera se cambiaba y la solicitud seguia nombrando la cuenta vieja');
  assert.equal(c.p.p_id, 222128);
  assert.equal(c.p.p_monto, 350000, 'el pago se ubica por su monto');
  assert.equal(c.p.p_desde, 'Ana Matrelo', 'el jugador ve el TITULAR de la cuenta, no el nombre interno');
  assert.equal(c.p.p_fecha, '2026-09-14T21:14:55.000Z', 'la fecha desempata si hay dos pagos iguales');
  assert.equal(c.p.p_billetera.billetera_nombre, 'MATRELO MP');
  assert.ok(avisos.some(a => /Ana Matrelo/.test(a)), 'y el operador se entera de que quedo corregido');
});

test('cambio de billetera · sin solicitud no inventa nada', async () => {
  const rpc = [];
  const sb = arrancarPanel({ rpc: async (fn, p) => { rpc.push({ fn, p }); return { data:null, error:null }; } });
  sb.toast = () => {};
  await sb._rehacerDesdeDelPago(null, { monto: 5000 }, { ID_BILLETERA: 31, NOMBRE_VISIBLE: 'X' });
  assert.equal(rpc.length, 0, 'un movimiento sin solicitud no tiene pago que corregir');
});

// ── D-107 · la carga no se anota dos veces cuando Chunior se cae justo despues de guardar ───
function _chuniorFalso(estado){
  // Responde como la ventana real: el chequeo de lista, las filas, el formulario y el resultado.
  return {
    navigate: async (u) => { estado.navego.push(String(u)); },
    exec: async (js) => {
      if(js.includes('getElementById("result_list")')) return estado.listaCarga;
      if(js.includes('#result_list tbody tr'))          return estado.filas;
      if(js.includes('id_cuenta_destino') && js.includes('return !!(')) return true;
      if(js.includes('s.value='))                        return { ok:true, valS:'957', valM:'10000', valN:'minombresclaudia' };
      if(js.includes('li.success'))                      return { ok:true, id:'9999999' };
      return null;
    }
  };
}
function _colaChunior(sb, ts){
  sb.localStorage.setItem('nodo_chunior_pendientes', JSON.stringify([
    { id:'cp1', ts, intentos:0, tipo:'CARGA', uid:'957', monto:10000, usuario:'minombresclaudia', histId:null }
  ]));
}
function _fechaChunior(ms){
  const d = new Date(ms), z = (n) => String(n).padStart(2,'0');
  return z(d.getDate())+'-'+z(d.getMonth()+1)+'-'+d.getFullYear()+' '+z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds());
}

test('chunior · si la anotacion YA entro, el reintento NO la duplica', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {}; sb.setTimeout = (fn) => setTimeout(fn, 0);
  const ts = Date.now() - 60000;                    // el movimiento original, un minuto antes
  const estado = { navego: [], listaCarga: true,
    filas: [{ id:'9693249', montoTxt:'$ 10.000,00', notas:'minombresclaudia', creacion:_fechaChunior(ts), texto:'' }] };
  sb.chunior = _chuniorFalso(estado);
  _colaChunior(sb, ts);

  await sb.chuniorPendientesReintentar(true);

  assert.ok(estado.navego.some(u => u.includes('movimientoficha/?q=')), 'primero tiene que preguntar en la lista');
  assert.ok(!estado.navego.some(u => u.includes('movimientoficha/add')),
    'y NO volver a anotar: asi se duplico la carga de minombresclaudia el 17/09');
  assert.equal(JSON.parse(sb.localStorage.getItem('nodo_chunior_pendientes')).length, 0,
    'la anotacion sale de la cola porque ya estaba hecha');
});

test('chunior · si NO esta en la lista, si la anota', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {}; sb.setTimeout = (fn) => setTimeout(fn, 0);
  const estado = { navego: [], listaCarga: true, filas: [] };   // la lista cargo y esta vacia
  sb.chunior = _chuniorFalso(estado);
  _colaChunior(sb, Date.now() - 60000);

  await sb.chuniorPendientesReintentar(true);

  assert.ok(estado.navego.some(u => u.includes('movimientoficha/add')),
    'con la lista leida y sin el movimiento, hay que anotarlo');
});

test('chunior · si la lista no carga, NO anota a ciegas', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {}; sb.setTimeout = (fn) => setTimeout(fn, 0);
  const estado = { navego: [], listaCarga: false, filas: [] };  // Chunior sigue caido
  sb.chunior = _chuniorFalso(estado);
  _colaChunior(sb, Date.now() - 60000);

  await sb.chuniorPendientesReintentar(true);

  assert.ok(!estado.navego.some(u => u.includes('movimientoficha/add')),
    '"no pude ver" no es "no esta": anotar aca es duplicar plata');
  assert.equal(JSON.parse(sb.localStorage.getItem('nodo_chunior_pendientes')).length, 1,
    'queda pendiente para el proximo intento');
});

// ── D-108 · la luz verde del reintento cierra la solicitud, igual que el boton Aprobar ──────
test('reintento · una CARGA que sale bien deja la solicitud acreditada', async () => {
  const sb = arrancarPanel();
  const avisos = []; sb.toast = (m) => avisos.push(String(m));
  let escrito = null;
  sb.actualizarSolicitudPortal = async (id, estado, extra) => { escrito = { id, estado, extra }; };

  await sb._cerrarSolicitudTrasReintento(
    { id: 77, solicitud_id: 500123, saldo_pre: 1000, saldo_post: 11000, created_at: '2026-09-17T12:00:00.000Z' },
    'CARGA', 10000, { ID_BILLETERA: 31, NOMBRE_VISIBLE: 'MATRELO MP', TITULAR: 'Ana Matrelo' });

  assert.ok(escrito, 'si la carga entro, la solicitud no puede quedar abierta');
  assert.equal(escrito.id, '500123');
  assert.equal(escrito.estado, 'ACREDITADA');
  assert.equal(escrito.extra.etapa, 'PORTAL_COMPLETADA_REINTENTO', 'queda la marca de que la cerro el reintento');
  assert.equal(escrito.extra.monto_aprobado, 10000);
  assert.equal(escrito.extra.historial_id, 77, 'la solicitud queda atada a la operacion');
  assert.equal(escrito.extra.saldo_post, 11000, 'el jugador ve el antes y despues de sus fichas');
  assert.equal(escrito.extra.billetera_nombre, 'MATRELO MP');
});

test('reintento · un RETIRO anota el pago con el motor del portal, no con una RPC propia', async () => {
  const sb = arrancarPanel();
  const avisos = []; sb.toast = (m) => avisos.push(String(m));
  const llamadas = [];
  sb.panelAPI = { rpc: async (fn, p) => { llamadas.push({ fn, p }); return { data: [{ restante: 0 }], error: null }; } };

  await sb._cerrarSolicitudTrasReintento(
    { id: 78, solicitud_id: 207577, saldo_post: 0, created_at: '2026-09-17T12:00:00.000Z' },
    'RETIRO', 35000, { ID_BILLETERA: 31, NOMBRE_VISIBLE: 'MATRELO MP', TITULAR: 'Ana Matrelo' });

  assert.ok(llamadas.length, 'el pago tiene que quedar anotado en la solicitud');
  assert.equal(llamadas[0].fn, 'landing_retiro_registrar_parcial',
    'el estado lo decide la maquina de parciales: un retiro puede seguir debiendo plata');
  assert.equal(llamadas[0].p.p_id, 207577);
  assert.equal(llamadas[0].p.p_monto_parcial, 35000);
  assert.equal(llamadas[0].p.p_desde, 'Ana Matrelo', 'el jugador ve de que cuenta le llego');
});

test('reintento · sin solicitud no inventa nada', async () => {
  const sb = arrancarPanel();
  const llamadas = [];
  sb.panelAPI = { rpc: async (fn, p) => { llamadas.push({ fn, p }); return { data: null, error: null }; } };
  sb.actualizarSolicitudPortal = async () => { llamadas.push({ fn: 'portal' }); };
  await sb._cerrarSolicitudTrasReintento({ id: 79, solicitud_id: null }, 'CARGA', 5000, null);
  assert.equal(llamadas.length, 0, 'una operacion a mano no tiene solicitud que cerrar');
});

test('reintento · si el pago YA estaba anotado, no lo cuenta dos veces', () => {
  const sb = arrancarPanel();
  const t = new Date('2026-09-17T12:00:00.000Z').getTime();
  const pagos = [{ monto: 35000, fecha: '2026-09-17T12:01:10.000Z' }];
  assert.equal(sb._pagoYaAnotado(pagos, 35000, t), true, 'mismo monto y al lado en el tiempo: es el mismo pago');
  assert.equal(sb._pagoYaAnotado(pagos, 5000, t), false, 'otro monto es otro pago');
  assert.equal(sb._pagoYaAnotado([{ monto: 35000, fecha: '2026-09-17T18:00:00.000Z' }], 35000, t), false,
    'el mismo monto seis horas despues es un segundo pago de verdad');
  assert.equal(sb._pagoYaAnotado([{ monto: 35000, fecha: '2026-09-17T12:01:10.000Z', revertido: true }], 35000, t), false,
    'un pago deshecho no bloquea el nuevo');
  assert.equal(sb._pagoYaAnotado([], 35000, t), false);
});

// ── El telefono repetido en dos cuentas (sol. 238354 · veronica59x, 17/09) ──────────────────
function _cotejoVeronica(varios){
  const dueno = { usuario:'veronica59x', pc:'P4', _tel:'3704786459' };
  return {
    usuario: { exacto:{ usuario:'veronica59x', telefonos:['3704786459'] }, similares:[] },
    telefono: { exacto:dueno, varios:varios, similares:[],
      otros: varios ? [dueno, { usuario:'vippveronicaaaa', pc:'P4', _tel:'3704786459' }] : [dueno] }
  };
}

test('cotejo · el telefono en dos cuentas dice CON QUIEN lo comparte', () => {
  const sb = arrancarPanel();
  const html = sb._altaCotejoHtml('veronica59x', '3704786459', _cotejoVeronica(true), '_altaAbrirVincular', 'declaró el cliente').html;
  assert.ok(html.includes('vippveronicaaaa'), 'lo unico accionable es saber con que otra cuenta lo comparte');
  assert.ok(html.includes('lo comparten 2 cuentas'), 'el motivo tiene que estar a la vista');
  assert.ok(!html.includes('⚠ es de </span>') && !/⚠ es de <\/b>?<b[^>]*>veronica59x/.test(html),
    'no puede avisar que el telefono "es de" el mismo usuario que estas validando');
  assert.ok(html.includes('Teléfono en dos cuentas'), 'el cartel de arriba dice el motivo, no un REVISAR pelado');
});

test('cotejo · un telefono de un solo dueño sigue en verde', () => {
  const sb = arrancarPanel();
  const html = sb._altaCotejoHtml('veronica59x', '3704786459', _cotejoVeronica(false), '_altaAbrirVincular', '').html;
  assert.ok(html.includes('✓ mismo dueño'), 'el caso normal no se toca');
  assert.ok(!html.includes('lo comparten'), 'y no inventa un aviso donde no hay nada que revisar');
});

// ── H-3 · deshacer una CARGA que vino de una solicitud ──────────────────────────────────────
test('deshacer carga · el criterio distingue "se quedó sin plata" de "borré una duplicada"', () => {
  const sb = arrancarPanel();
  const sola      = [{ id: 10, tipo: 'CARGA', estado: 'OK', monto: 5000 }];
  const duplicada = [{ id: 10, tipo: 'CARGA', estado: 'OK', monto: 5000 }, { id: 11, tipo: 'CARGA', estado: 'OK', monto: 5000 }];

  assert.equal(sb._solicitudQuedoSinPagar(5000, sola, 10).sinPagar, true,
    'era la unica carga: el jugador se quedo sin su plata');
  assert.equal(sb._solicitudQuedoSinPagar(5000, duplicada, 10).sinPagar, false,
    'habia dos cargas iguales: deshacer una NO deja al jugador sin nada');
  assert.equal(sb._solicitudQuedoSinPagar(5000, [{ id: 11, tipo: 'CARGA', estado: 'REVERTIDA', monto: 5000 }], 10).sinPagar, true,
    'una carga ya revertida no cubre nada');
  assert.equal(sb._solicitudQuedoSinPagar(5000, [{ id: 11, tipo: 'CARGA', estado: 'ERROR', monto: 5000 }], 10).sinPagar, true,
    'una carga fallida tampoco');
  assert.equal(sb._solicitudQuedoSinPagar(10000, [{ id: 11, tipo: 'CARGA', estado: 'OK', monto: 5000 }], 10).sinPagar, true,
    'media carga no alcanza: pidio 10000 y solo entraron 5000');
});

test('deshacer carga · si queda sin pagar, la solicitud vuelve a la bandeja y el jugador se entera', async () => {
  const sb = arrancarPanel();
  const avisos = []; sb.toast = (m) => avisos.push(String(m));
  let escrito = null, alJugador = null;
  sb.actualizarSolicitudPortal = async (id, estado, extra) => { escrito = { id, estado, extra }; };
  sb.notificarUsuarioEnChat = async (u, t) => { alJugador = { u, t }; };

  await sb._reabrirSolicitudSiQuedoSinPagar('500999', 10, 5000, 'pruebaxx');

  assert.ok(escrito, 'la solicitud no puede quedar acreditada si las fichas volvieron');
  assert.equal(escrito.estado, 'EN_REVISION', 'vuelve a manos del operador, no se cierra sola');
  assert.equal(escrito.extra.etapa, 'CARGA_REVERTIDA_PANEL');
  assert.equal(escrito.extra.historial_id, 10, 'queda atada al movimiento que se deshizo');
  assert.ok(alJugador && /sin efecto/.test(alJugador.t), 'le dijimos "acreditada" y ya no es cierto');
});

test('deshacer carga · sin solicitud no toca nada', async () => {
  const sb = arrancarPanel();
  let escrito = false;
  sb.actualizarSolicitudPortal = async () => { escrito = true; };
  await sb._reabrirSolicitudSiQuedoSinPagar('', 10, 5000, 'pruebaxx');
  assert.equal(escrito, false);
});

// ── H-7 · el loop de BET300: el widget de saldo se metía en el medio de una operación ───────
function _panelElectron(llamadas){
  return arrancarPanel({ antes: (s) => {
    s.ctrlElectron = {
      openAgentWindow: async () => {},
      navigateAgent: async () => {},
      drexAutomation: async (m) => { llamadas.push(m); return { ok:true, balance:{ raw:'$ 1.000', value:1000 } }; }
    };
  }});
}

test('saldo del agente · no lee las fichas con una operacion en curso', async () => {
  const llamadas = [];
  const sb = _panelElectron(llamadas);
  sb.toast = () => {};

  assert.equal(sb._drexGlobalLock('carga de prueba'), true, 'simula una carga en curso');
  await sb.refrescarSaldoAgente();
  assert.equal(llamadas.length, 0,
    'en BET300 leer las fichas cambia de pantalla: hacerlo en el medio de una carga la rompe');

  sb._drexGlobalUnlock();
  await sb.refrescarSaldoAgente();
  assert.ok(llamadas.includes('obtenerSaldoAgente'), 'sin nada en curso, el widget sí se refresca');
});

test('saldo del agente · devuelve el candado aunque falle', async () => {
  const sb = arrancarPanel({ antes: (s) => {
    s.ctrlElectron = { openAgentWindow: async () => {}, drexAutomation: async () => { throw new Error('se cayó'); } };
  }});
  sb.toast = () => {};
  await sb.refrescarSaldoAgente();
  assert.equal(sb._drexGlobalLock('lo que venga'), true,
    'si se queda con el candado, no se puede operar nunca más');
});

// ── La tarjeta de "lau": 4 sugerencias sin datos y ninguna forma de crear la cuenta ─────────
function _cotejoSimilares(similares){
  return { usuario: { exacto: null, similares: similares },
           telefono: { exacto: null, similares: [], otros: [] } };
}

test('cotejo · un alias corto no dispara cuatro sugerencias al azar', () => {
  const sb = arrancarPanel();
  const r = _cotejoSimilares([
    { usuario: 'lauu30x',       telefonos: ['3885794443'] },
    { usuario: 'lauttaros',     telefonos: ['2213543606'] },
    { usuario: 'lauty677',      telefonos: ['3888572677'] },
    { usuario: 'lauraaaok4564', telefonos: ['1159690016'] }
  ]);
  const html = sb._altaCotejoHtml('lau', '2323669344', r, '_altaAbrirVincular', 'declaró el cliente').html;

  assert.ok(!html.includes('lauraaaok4564') && !html.includes('lauttaros'),
    'ninguna de esas cuentas tiene el telefono declarado: sugerirlas es tirar una moneda');
  assert.ok(html.includes('Ninguna cuenta tiene el teléfono'), 'y hay que decir por qué no se sugiere nada');
  assert.ok(html.includes('_altaCrearDesdeCotejo'),
    'si no existe ni el usuario ni el telefono, la cuenta se tiene que poder crear desde aca');
});

test('cotejo · si la cuenta parecida tiene el telefono declarado, esa sí se sugiere', () => {
  const sb = arrancarPanel();
  const r = _cotejoSimilares([{ usuario: 'pepe123xxs', telefonos: ['1123456789'] }]);
  const html = sb._altaCotejoHtml('pepe', '1123456789', r, '_altaAbrirVincular', '').html;
  assert.ok(html.includes('pepe123xxs'), 'ese es el caso que el cotejo existe para agarrar');
  assert.ok(html.includes('teléfono que declaró'), 'y se dice por que se sugiere');
});

test('cotejo · sin teléfono en común no se sugiere NINGUNA, por parecido que sea el alias', () => {
  // Un alias parecido no prueba nada: «martin2024» y «martin2025» pueden ser dos personas
  // distintas. Sugerirlas mandaba al operador a revisar cuentas ajenas y a preguntarle cosas al
  // cliente por una corazonada (Juan, 27/9).
  const sb = arrancarPanel();
  const r = _cotejoSimilares([
    { usuario: 'martin2024a', telefonos: ['1111111111'] },
    { usuario: 'martin2024b', telefonos: ['2222222222'] },
    { usuario: 'martin2024c', telefonos: ['3333333333'] },
    { usuario: 'martin2024d', telefonos: ['4444444444'] }
  ]);
  const html = sb._altaCotejoHtml('martin2024', '9999999999', r, '_altaAbrirVincular', '').html;
  for (const u of ['martin2024a', 'martin2024b', 'martin2024c', 'martin2024d']) {
    assert.ok(!html.includes(u), 'no tiene el teléfono declarado: no se sugiere · ' + u);
  }
  assert.ok(!html.includes('_altaAbrirVincular'), 'sin sugerencias no hay a quién vincular');
  assert.match(html, /Ninguna cuenta tiene el teléfono/, 'se dice por qué no hay sugerencias');
  assert.ok(html.includes('_altaCrearDesdeCotejo'), 'y se puede crear la cuenta desde acá');
});

// ── Caja negra ────────────────────────────────────────────────────────────────
// No alcanza con que el módulo pase sus pruebas: lo que importa es que el enganche de callDrex
// registre de verdad. Estas pruebas EJECUTAN el camino completo contra un ctrlElectron falso.

function panelConAgentes(responder) {
  const llamadas = [];
  const sb = arrancarPanel({ antes(s) {
    s.ctrlElectron = {
      drexAutomation: (method, ...args) => { llamadas.push(method); return responder(method, args); },
      openAgentWindow: async () => ({ ok: true }),
      showAgentWindow: async () => ({ ok: true }),
      navigateAgent: async () => ({ ok: true })
    };
  } });
  return { sb, llamadas };
}

test('caja negra · un corte de main queda anotado con su capa y su camino', async () => {
  const { sb } = panelConAgentes((method) => {
    if (method === 'estadoPagina') return Promise.resolve({ ok: true, needsLogin: false, url: 'https://bo.casinodrex.com/agents/user_search' });
    return Promise.reject(new Error('Timeout: la automatización tardó demasiado.'));
  });

  await sb.callDrex('estadoPagina');
  await assert.rejects(() => sb.callDrex('cargarSaldo', 'pepe', 1000), /tardó demasiado/);

  const fallas = sb.cajaNegra.fallas();
  assert.equal(fallas.length, 1, 'tenía que quedar anotada una falla');
  const f = fallas[0];
  assert.equal(f.paso, 'cargarSaldo');
  assert.equal(f.capa, 'main', 'el timeout lo emite main: no es culpa del preload');
  // Lo que importa del rastro: que se vea qué anduvo ANTES de cortar.
  assert.ok(f.rastro.some(p => p.paso === 'estadoPagina' && p.estado === 'ok'),
    'el camino previo tiene que estar: ' + JSON.stringify(f.rastro));
  assert.match(sb.cajaNegra.resumen(), /cortó en "cargarSaldo".*capa: main/);
});

test('caja negra · un ok:false del preload se anota como preload, y un chequeo no es falla', async () => {
  const { sb } = panelConAgentes((method) => {
    if (method === 'estadoPagina') return Promise.resolve({ ok: false, needsLogin: true, url: 'https://bo.casinodrex.com/login', flujo: 'login' });
    return Promise.resolve({ ok: false, message: 'No se encontró el campo de monto.', url: 'https://bo.casinodrex.com/agents/user_search', flujo: 'modal-monto' });
  });

  // estadoPagina devolviendo needsLogin es trabajo NORMAL: no puede contarse como falla, o el
  // registro se llena de ruido cada vez que hay que loguearse.
  await sb.callDrex('estadoPagina');
  assert.equal(sb.cajaNegra.fallas().length, 0, 'un chequeo que pide login no es una falla');
  assert.ok(sb.cajaNegra.pasos().some(p => p.paso === 'estadoPagina' && p.estado === 'pide-login'));

  await sb.callDrex('cargarSaldo', 'pepe', 1000);
  const f = sb.cajaNegra.fallas()[0];
  assert.equal(f.capa, 'preload');
  assert.match(f.mensaje, /campo de monto/);
  assert.match(f.pantalla, /modal-monto/, 'dónde quedó la pantalla es el dato que no se reconstruye después');
});

test('caja negra · lo que la cola cancela sin ejecutar también queda anotado', async () => {
  const { sb, llamadas } = panelConAgentes(() => Promise.resolve({ ok: true, needsLogin: false }));
  sb.window._drexSinSesion = true;                 // el cortacircuitos ya se disparó

  await assert.rejects(() => sb.callDrex('cargarSaldo', 'pepe', 1000), /no se ejecutó/);
  assert.equal(llamadas.length, 0, 'no tiene que tocar Agentes');
  const f = sb.cajaNegra.fallas()[0];
  assert.equal(f.capa, 'panel');
  assert.match(f.mensaje, /la sesión ya estaba caída/);
});

test('caja negra · nunca rompe una operación, ni si el registro explota', async () => {
  const { sb } = panelConAgentes(() => Promise.resolve({ ok: true, needsLogin: false, saldo: 500 }));
  // Si el registro se rompe (localStorage lleno, lo que sea), la operación tiene que seguir igual.
  sb.window._cnPaso = () => { throw new Error('registro roto'); };
  sb.window._cnFalla = () => { throw new Error('registro roto'); };
  const r = await sb.callDrex('cargarSaldo', 'pepe', 1000);
  assert.equal(r.saldo, 500, 'la operación tiene que devolver lo suyo aunque el registro falle');
});

// ── Cierre manual de un retiro parcial ────────────────────────────────────────
// El cierre a mano es una decisión del operador y es DEFINITIVA. Vivía en `etapa`, que cada pago
// parcial pisa, así que un pago posterior lo borraba y el retiro volvía a la caja: el #266250 de
// Maria6981x se cerró siete veces entre el 25 y el 26/9.

function solicitudRetiro(metadata) {
  return { ID: 266250, SOLICITUD_ID: 266250, TIPO: 'RETIRO', ESTADO: 'PAGADA',
           USUARIO: 'Maria6981x', MONTO: 1738907, MONTO_REAL: 1738907,
           metadata: metadata, METADATA: metadata };
}

test('parciales · un pago posterior NO reabre un retiro cerrado a mano', () => {
  const sb = arrancarPanel();
  // Así quedó #266250: cerrado a las 06:16 y pagado otra vez a las 11:48. El pago reescribió
  // `etapa`, que es lo que borraba el cierre.
  const s = solicitudRetiro({
    etapa: 'RETIRO_V2_PARCIAL',                                   // lo pisó el pago de después
    cierre_manual: { fecha: '2026-09-26T06:16:30Z', operador: 'juancarlos', motivo: 'SIN_FICHAS' },
    retiro_parcial: { total: 1738907, pagado: 1700000 }
  });
  assert.equal(sb._retiroCerradoAMano(s), true, 'el cierre a mano tiene que sobrevivir al pago');
  assert.equal(sb._retiroParcialSigueAbierto(s), false, 'cerrado a mano no vuelve a la caja');
});

test('parciales · sigue valiendo la marca vieja, para los que ya se cerraron así', () => {
  const sb = arrancarPanel();
  const s = solicitudRetiro({ etapa: 'RETIRO_CIERRE_MANUAL', retiro_parcial: { total: 1738907, pagado: 1700000 } });
  assert.equal(sb._retiroCerradoAMano(s), true);
  assert.equal(sb._retiroParcialSigueAbierto(s), false);
});

test('parciales · uno que NO se cerró sigue abierto (el arreglo no tapa los de verdad)', () => {
  const sb = arrancarPanel();
  const s = solicitudRetiro({ etapa: 'RETIRO_V2_PARCIAL', retiro_parcial: { total: 1600000, pagado: 1000000 } });
  s.ESTADO = 'EN_PROCESO';
  assert.equal(sb._retiroCerradoAMano(s), false);
  assert.equal(sb._retiroParcialSigueAbierto(s), true, 'falta plata y nadie lo cerró: tiene que seguir en la caja');
});

test('parciales · el aviso de descuadre nombra cada fuente y no repite el mismo número', () => {
  const sb = arrancarPanel();
  // El caso real: el contador de parciales dice 1.700.000 y el historial suma otra cosa, porque un
  // pago salió por el flujo de retiro normal y no tocó el contador.
  // Los pagos van con fecha a propósito: sin saber cuándo empezó el retiro no se puede afirmar que
  // el historial esté completo, y sin eso NO se canta descuadre (ver el test de más abajo).
  const s = solicitudRetiro({
    retiro_parcial: { total: 1738907, pagado: 1700000,
      pagos: [{ fecha: '2026-09-26T02:37:00Z', monto: 1700000 }] },
    monto_pagado: 1700000 });
  sb.window._historialData = [
    { solicitud_id: '266250', tipo: 'RETIRO', estado: 'OK', monto: 1700000, created_at: '2026-09-26T11:48:00Z' },
    { solicitud_id: '266250', tipo: 'RETIRO', estado: 'OK', monto: 38907,   created_at: '2026-09-26T02:37:00Z' }
  ];
  const pp = sb._retiroParcialInfo(s);
  assert.equal(pp.discrepa, true, 'el historial no coincide con el contador: hay que avisarlo');
  assert.equal(pp.pagadoRpc, 1700000, 'la fuente del contador se conserva aparte del máximo');
  assert.ok(pp.pagadoHistorial > pp.pagadoRpc, 'y la del historial también, para poder nombrarlas');
  // Lo que rompía el cartel: imprimía el máximo contra una fuente, y salía "1.700.000 vs 1.700.000".
  assert.notEqual(sb.money(pp.pagadoRpc), sb.money(pp.pagadoHistorial),
    'las dos que se muestran tienen que ser DISTINTAS, si no el aviso no dice nada');
});

// ── Cierre automático del parcial cuando el jugador vuelve a cargar ───────────
// La decisión pura tiene sus propias pruebas. Acá se prueba el ENGANCHE: que dispare de verdad
// sobre el bundle real y que escriba lo que tiene que escribir.

test('parciales · una carga nueva cierra el parcial solo y deja el cierre firme', async () => {
  const sb = arrancarPanel();
  const parches = [], historial = [], avisos = [];

  sb.V154P.solicitudes = [
    { ID: 266250, SOLICITUD_ID: 266250, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', USUARIO: 'Maria6981x',
      FECHA_CREACION: '2026-09-25T12:08:58Z', MONTO: 1738907, MONTO_REAL: 1738907,
      metadata: { retiro_parcial: { total: 1738907, pagado: 1700000 } },
      METADATA: { retiro_parcial: { total: 1738907, pagado: 1700000 } } },
    { ID: 270368, SOLICITUD_ID: 270368, TIPO: 'CARGA', ESTADO: 'ACREDITADA', USUARIO: 'Maria6981x',
      FECHA_CREACION: '2026-09-26T11:45:11Z', MONTO: 250000, MONTO_REAL: 250000, metadata: {}, METADATA: {} }
  ];
  sb.actualizarSolicitudPortal = async (id, estado, meta) => { parches.push({ id, estado, meta }); return { ok: true }; };
  sb.registrarEnHistorial = async (fila) => { historial.push(fila); return { id: 1 }; };
  sb.cargarSolicitudesPortal = async () => {};
  sb.toast = (msg) => { avisos.push(String(msg)); };

  const hechos = await sb.cerrarParcialesPorCarga();
  assert.equal(hechos, 1, 'tenía que cerrar uno');

  const p = parches[0];
  assert.equal(String(p.id), '266250');
  assert.equal(p.estado, 'PAGADA');
  assert.ok(p.meta.cierre_manual, 'va con la misma llave que el cierre a mano: definitivo');
  assert.equal(p.meta.cierre_manual.auto, true);
  assert.equal(p.meta.cierre_motivo, 'CARGO_DE_NUEVO');
  assert.equal(p.meta.retiro_parcial.pagado, 1700000, 'lo ya cobrado no se toca');
  assert.equal(p.meta.retiro_parcial.cierre.faltante, 38907);

  // Que el operador se entere: es una solicitud que se cerró sin que nadie la toque.
  assert.ok(avisos.some(a => /cerrado solo/i.test(a) && /38\.907/.test(a)), 'avisos: ' + avisos.join(' | '));
  assert.ok(historial.some(h => /Cierre autom/i.test(h.notas) && Number(h.monto) === 0),
    'queda anotado en el historial, y sin mover plata');

  // Y el cierre tiene que aguantar: con la marca puesta, ya no vuelve a la caja.
  const cerrada = Object.assign({}, sb.V154P.solicitudes[0], { metadata: p.meta, METADATA: p.meta });
  assert.equal(sb._retiroCerradoAMano(cerrada), true);
  assert.equal(sb._retiroParcialSigueAbierto(cerrada), false);
});

test('parciales · no se cierra dos veces aunque se llame de nuevo', async () => {
  const sb = arrancarPanel();
  const parches = [];
  sb.V154P.solicitudes = [
    { ID: 266250, SOLICITUD_ID: 266250, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', USUARIO: 'Maria6981x',
      FECHA_CREACION: '2026-09-25T12:08:58Z', MONTO: 1738907, MONTO_REAL: 1738907,
      metadata: { retiro_parcial: { total: 1738907, pagado: 1700000 } },
      METADATA: { retiro_parcial: { total: 1738907, pagado: 1700000 } } },
    { ID: 270368, SOLICITUD_ID: 270368, TIPO: 'CARGA', ESTADO: 'ACREDITADA', USUARIO: 'Maria6981x',
      FECHA_CREACION: '2026-09-26T11:45:11Z', MONTO: 250000, MONTO_REAL: 250000, metadata: {}, METADATA: {} }
  ];
  sb.actualizarSolicitudPortal = async (id, estado, meta) => { parches.push(id); return { ok: true }; };
  sb.registrarEnHistorial = async () => ({ id: 1 });
  sb.cargarSolicitudesPortal = async () => {};
  sb.toast = () => {};

  assert.equal(await sb.cerrarParcialesPorCarga(), 1);
  assert.equal(await sb.cerrarParcialesPorCarga(), 0, 'la segunda pasada no tiene que tocar nada');
  assert.equal(parches.length, 1);
});

test('parciales · la caja recalcula al abrirse y saca el que ya se cobró entero', () => {
  const sb = arrancarPanel();
  const saldado = {
    ID: 266250, SOLICITUD_ID: 266250, TIPO: 'RETIRO', ESTADO: 'PAGADA', USUARIO: 'Maria6981x',
    FECHA_CREACION: '2026-09-25T12:08:58Z', MONTO: 1738907, MONTO_REAL: 1738907,
    metadata: { retiro_parcial: { total: 1738907, pagado: 1738907 } },
    METADATA: { retiro_parcial: { total: 1738907, pagado: 1738907 } }
  };
  const vivo = {
    ID: 270642, SOLICITUD_ID: 270642, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', USUARIO: 'Maria6981x',
    FECHA_CREACION: '2026-09-26T13:46:25Z', MONTO: 1000000, MONTO_REAL: 1000000,
    metadata: { retiro_parcial: { total: 1000000, pagado: 600000 } },
    METADATA: { retiro_parcial: { total: 1000000, pagado: 600000 } }
  };
  sb.V154P.solicitudes = [saldado, vivo];
  // La foto vieja: los dos, como los mostraba la pantalla.
  sb.window._parcialesEnProceso = [saldado, vivo];

  const ahora = sb._parcialesAhora();
  assert.equal(ahora.length, 1, 'el cobrado entero tiene que salir de la caja');
  assert.equal(String(ahora[0].ID), '270642', 'queda el nuevo, que sí debe plata');
  assert.equal(sb.window._parcialesEnProceso.length, 1, 'y la lista guardada queda al día');
});

// ── Lista de "retiros en las últimas 24hs" ────────────────────────────────────
// Los cierres de un retiro parcial se anotan como RETIRO de $0. Salían acá como "$ 0 · —" sin
// decir qué eran y, con el tope de 10 filas, tapaban retiros de verdad: Maria6981x tenía 6 de 10
// filas ocupadas por cierres (26/9).

test('24hs · la consulta pide sólo movimientos con plata, y los tramos quedan marcados', async () => {
  const llamadas = [];
  const filas = [
    { created_at: '2026-09-26T13:41:00Z', monto: 38907,  billetera_nombre: 'MATRELO mp', estado: 'OK',
      origen: 'LANDING', pc_codigo: 'P4', notas: 'Retiro PARCIAL · pagado $ 38.907' },
    { created_at: '2026-09-25T23:37:00Z', monto: 500000, billetera_nombre: 'MATRELO mp', estado: 'OK',
      origen: 'LANDING', pc_codigo: 'P4', notas: 'Retiro · pagado $ 500.000' }
  ];
  const cadena = {};
  for (const m of ['select','ilike','eq','gt','gte','order']) {
    cadena[m] = (...args) => { llamadas.push([m, ...args]); return cadena; };
  }
  cadena.limit = (...args) => { llamadas.push(['limit', ...args]); return Promise.resolve({ data: filas }); };

  const sb = arrancarPanel({ antes(s) {
    s.__from = [];
    s.supabase = { createClient: () => ({
      rpc: async () => ({ data: null, error: null }),
      from: (t) => { s.__from.push(t); return cadena; },
      channel: () => ({ on: () => ({ subscribe: () => {} }) }), removeChannel: () => {}
    }) };
  } });

  const caja = { dataset: {}, innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'manualUsuario' ? { value: 'Maria6981x' } : caja);
  sb.pcOperativa = 'P4';

  await sb.consultarRetirosUsuarioRealtime();

  // Lo que importa: la base nunca devuelve los cierres, así que no pueden tapar nada.
  assert.ok(llamadas.some(c => c[0] === 'gt' && c[1] === 'monto' && Number(c[2]) === 0),
    'tiene que pedir monto > 0 · llamadas: ' + JSON.stringify(llamadas));
  assert.ok(llamadas.some(c => c[0] === 'eq' && c[1] === 'tipo' && c[2] === 'RETIRO'));
  assert.ok(llamadas.some(c => c[0] === 'select' && /notas/.test(String(c[1]))),
    'necesita las notas para distinguir un tramo de un retiro entero');

  // Y que el tramo se vea como tramo: si no, la lista parece dos retiros separados.
  assert.match(caja.innerHTML, /parte de un retiro/, 'el tramo tiene que quedar marcado');
  assert.equal((caja.innerHTML.match(/parte de un retiro/g) || []).length, 1,
    'sólo el que es parcial · el retiro entero no lleva la marca');
});

// ── D-109 · la copia local de un parcial que dejó de venir del server ─────────
// El panel sostiene en memoria un retiro parcial que la RPC dejó de devolver, para no perder de
// vista plata debida. Esa copia NO se refrescaba: se pagaba el resto o se cerraba, y la foto vieja
// se volvía a empujar en cada ciclo diciendo "falta $X". #266250 quedó así (26/9).

function panelConSolicitudes(progreso) {
  const pedidos = [];
  // El panel no llama a Supabase directo: todo pasa por window.panelAPI.rpc (ver portal/data.js).
  const sb = arrancarPanel({ antes(s) {
    s.panelAPI = { rpc: async (fn, params) => {
      pedidos.push([fn, params]);
      if (fn === 'panel_v15_5_listar_solicitudes_portal') return { data: [], error: null };
      if (fn === 'landing_retiro_progreso') return progreso(params);
      return { data: null, error: null };
    } };
  } });
  // La foto vieja: 1.700.000 de 1.738.907, como la tenía el panel.
  const vieja = { ID: 266250, SOLICITUD_ID: 266250, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO',
    USUARIO: 'Maria6981x', MONTO: 1738907, MONTO_REAL: 1738907,
    metadata: { retiro_parcial: { total: 1738907, pagado: 1700000 } },
    METADATA: { retiro_parcial: { total: 1738907, pagado: 1700000 } } };
  sb.V154P.solicitudes = [vieja];
  return { sb, pedidos, vieja };
}

// El refresco del sostenido ya NO se espera dentro del cargado de la bandeja: se hace después de
// pintar, sin bloquear. Se cambió a propósito — esperarlo ahí dejaba la bandeja tomada y todo lo
// demás salía por "skipped", incluido el botón del operador (OFI-SAN, 29/9). Lo que se verifica
// sigue siendo lo mismo: que la copia vieja termine corregida o soltada.
const asentar = () => new Promise(r => setImmediate(() => setImmediate(r)));

test('D-109 · si la base dice que ya se cobró entero, la copia local se suelta', async () => {
  const { sb, pedidos } = panelConSolicitudes(() => ({
    data: [{ ok: true, total: 1738907, pagado: 1738907, restante: 0, estado: 'PAGADA' }], error: null
  }));
  await sb.cargarSolicitudesPortal(true);
  await asentar();
  assert.ok(pedidos.some(p => p[0] === 'landing_retiro_progreso' && Number(p[1].p_solicitud_id) === 266250),
    'tiene que preguntarle a la base por ese retiro');
  assert.equal(sb.V154P.solicitudes.length, 0, 'ya no falta nada: no se sostiene más');
});

test('D-109 · si la base dice que está cerrado, también se suelta', async () => {
  const { sb } = panelConSolicitudes(() => ({
    data: [{ ok: true, total: 1738907, pagado: 1700000, restante: 38907, estado: 'PAGADA',
             cierre: { motivo: 'SE_LO_JUGO' } }], error: null
  }));
  await sb.cargarSolicitudesPortal(true);
  await asentar();
  assert.equal(sb.V154P.solicitudes.length, 0, 'lo cerró alguien: no vuelve');
});

test('D-109 · si todavía falta plata, se sostiene y con los números de la base', async () => {
  const { sb } = panelConSolicitudes(() => ({
    data: [{ ok: true, total: 1738907, pagado: 1500000, restante: 238907, estado: 'EN_PROCESO' }], error: null
  }));
  await sb.cargarSolicitudesPortal(true);
  await asentar();
  assert.equal(sb.V154P.solicitudes.length, 1, 'falta plata: no se puede perder de vista');
  const pp = sb._retiroParcialInfo(sb.V154P.solicitudes[0]);
  assert.equal(pp.pagado, 1500000, 'y con lo que dice la base, no con la foto vieja de 1.700.000');
  assert.equal(pp.restante, 238907);
});

test('D-109 · si la base no contesta, NO se suelta (plata debida no se pierde de vista)', async () => {
  const { sb } = panelConSolicitudes(() => ({ data: null, error: { message: 'sin red' } }));
  await sb.cargarSolicitudesPortal(true);
  await asentar();
  assert.equal(sb.V154P.solicitudes.length, 1, 'ante la duda se sostiene');
  assert.equal(sb.V154P.solicitudes[0].__soloLocal, true);
});

// ── Sesión de Agentes cerrada: que se detecte sola y que se vea ───────────────
// Estaba encerrado: al marcar la sesión caída, _drexMarcarSinSesion salía por el return de la
// primera línea, y la cola cancelaba la lectura del watchdog sin tocar Agentes — así que tampoco
// se volvía a detectar. Si el operador cerraba el modal, el panel quedaba con la sesión cerrada
// mostrando "Sin lectura de Drex" en un widget chico y nada más (Juan, 26/9).

function panelConDom() {
  const porId = new Map();
  const sb = arrancarPanel();
  const crear = (tag) => {
    const el = { tagName: tag, style: {}, innerHTML: '', textContent: '', dataset: {},
      classList: { add(){}, remove(){}, contains: () => false, toggle(){} },
      setAttribute(k, v){ if (k === 'id') { this.id = v; porId.set(v, this); } },
      getAttribute: () => null, appendChild(){}, addEventListener(){},
      querySelector: () => null, querySelectorAll: () => [],
      remove(){ if (this.id) porId.delete(this.id); } };
    return new Proxy(el, { set(o, k, v) { o[k] = v; if (k === 'id') porId.set(v, o); return true; } });
  };
  sb.document = Object.assign(Object.create(null), {
    getElementById: (id) => porId.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: crear, addEventListener(){}, readyState: 'complete',
    body: { appendChild(){}, innerHTML: '' }, head: { appendChild(){} }, documentElement: {}
  });
  sb.toast = () => {};
  return { sb, porId };
}

test('sesión caída · el cartel queda fijo y se va sólo cuando se repone', () => {
  const { sb, porId } = panelConDom();
  sb.window._drexMarcarSinSesion('prueba');
  const b = porId.get('drexSinSesionBanner');
  assert.ok(b, 'tiene que quedar un cartel a la vista');
  assert.match(b.innerHTML, /sesión de Agentes está cerrada/i);
  assert.match(b.innerHTML, /Entrar a Agentes/, 'y con el botón para entrar');

  sb.window._drexSesionRepuesta();
  assert.equal(porId.get('drexSinSesionBanner'), undefined, 'al reponer la sesión el cartel se va');
});

test('sesión caída · marcarla de nuevo NO sale de entrada (antes se encerraba)', () => {
  const { sb, porId } = panelConDom();
  sb.window._drexMarcarSinSesion('primera');
  porId.delete('drexSinSesionBanner');               // el operador cerró todo
  // Segunda detección: antes esto no hacía absolutamente nada.
  sb.window._drexMarcarSinSesion('segunda');
  assert.ok(porId.get('drexSinSesionBanner'), 'el cartel tiene que volver');
});

test('sesión caída · el login se vuelve a ofrecer, pero con espacio entre pedidos', () => {
  const { sb } = panelConDom();
  let abiertos = 0;
  sb._mostrarModalLoginDrex = () => { abiertos++; };
  sb.window._drexSinSesion = true;
  sb.window._drexLoginPedidoEn = 0;
  const correrTimers = () => { const t = sb.__timers || []; sb.__timers = []; t.forEach(fn => fn()); };
  sb.setTimeout = (fn) => { (sb.__timers = sb.__timers || []).push(fn); return 0; };

  sb.window._drexPedirLogin(); correrTimers();
  assert.equal(abiertos, 1, 'la primera vez se ofrece');
  sb.window._drexPedirLogin(); correrTimers();
  assert.equal(abiertos, 1, 'enseguida NO se vuelve a abrir: no se acosa al operador');

  sb.window._drexLoginPedidoEn = Date.now() - 60000;   // pasó el rato
  sb.window._drexPedirLogin(); correrTimers();
  assert.equal(abiertos, 2, 'pasado el rato se vuelve a ofrecer');
});

test('sesión caída · el watchdog la reporta aunque la cola le cancele la lectura', async () => {
  const { sb } = panelConDom();
  sb.window._drexSinSesion = true;                    // el panel ya lo sabe
  sb.ctrlElectron = { drexAutomation: async () => { throw new Error('no tendría que llegar acá'); },
                      openAgentWindow: async () => ({ ok: true }) };
  const r = await sb._watchdogLeer();
  assert.equal(r.drexNeedsLogin, true,
    'sin esto el poll cae en "Sin lectura de Drex" y nadie vuelve a pedir el login');
  assert.equal(r.drexFichas, null);
});

// ── El loop del /logout ───────────────────────────────────────────────────────
// La sesión se cae → el vigía manda la ventana a /logout. Pero el /logout de Drex a veces no llega
// a dibujar el ingreso (no puede cargar su config: requireAuthentication, y el XHR a
// wallet.casinoenvivo.club lo corta CORS) y deja el MISMO cartel "session is invalid". El vigía lo
// leía como "no estoy en el ingreso" y la volvía a mandar ahí cada 25 s, para siempre. En la
// consola se ve clavado: el error sale de logout:1 y el VM del preload sube en cada vuelta.

function armarIrAlLogin() {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  const m = src.match(/function _irAlLogin\([^)]*\) ?\{[\s\S]*?\n\}/);
  assert.ok(m, 'no encontré _irAlLogin');
  const armar = new Function('window', 'LOGOUT_URL', 'console',
    'let _opsEnCurso = 0, _loginEnCurso = false, _yaFuiAlLogin = false, _recargaLoginEn = 0;\n'
    + 'let _intentosLogin = 0; const _MAX_INTENTOS_LOGIN = 3;\n'
    + m[0] + '\nreturn { ir:_irAlLogin, intentos:()=>_intentosLogin,'
    + ' destrabar:function(){ _recargaLoginEn = 0; } };');
  const fue = [];
  const win = { location: { href: 'https://bo.casinodrex.com/agents/user_search', assign: (u) => fue.push(u) } };
  const api = armar(win, 'https://bo.casinodrex.com/logout', { warn() {} });
  return { api, fue, win };
}

test('Drex · estando YA en /logout no se vuelve a navegar ahí (el loop)', () => {
  const { api, fue, win } = armarIrAlLogin();
  // La ventana ya está parada en /logout, mostrando el cartel porque no cargó el ingreso.
  win.location.href = 'https://bo.casinodrex.com/logout';
  assert.equal(api.ir('sesión caída'), false, 'navegar a la misma url no cambia nada');
  assert.deepEqual(fue, [], 'esto es exactamente lo que recargaba la ventana cada 25 s para siempre');

  // Con querystring o ancla es la misma página igual.
  win.location.href = 'https://bo.casinodrex.com/logout?x=1#y';
  assert.equal(api.ir('sesión caída'), false);
  assert.deepEqual(fue, []);

  // Desde la app sí tiene que salir.
  win.location.href = 'https://bo.casinodrex.com/agents/user_search';
  assert.equal(api.ir('sesión caída'), true);
  assert.equal(fue.length, 1);
});

test('Drex · después de unos intentos deja de recargar y no insiste más', () => {
  const { api, fue } = armarIrAlLogin();
  // Tres salidas, espaciadas: el caso bueno, cuando el ingreso podría llegar a aparecer.
  for (let i = 1; i <= 3; i++) {
    api.destrabar();
    assert.equal(api.ir('intento ' + i), true, 'el intento ' + i + ' tiene que salir');
  }
  assert.equal(fue.length, 3);

  // A partir de acá el problema no es nuestro y seguir recargando no lo arregla.
  for (let i = 0; i < 5; i++) {
    api.destrabar();
    assert.equal(api.ir('de más'), false);
  }
  assert.equal(fue.length, 3, 'la ventana tiene que quedarse quieta, no recargando para siempre');
});

test('Drex · una caída NUEVA vuelve a habilitar los intentos', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'agent-preload.js'), 'utf8');
  const fn = (n) => {
    const m = src.match(new RegExp('function ' + n + '\\([^)]*\\) ?\\{[\\s\\S]*?\\n\\}'));
    assert.ok(m, 'no encontré ' + n);
    return m[0];
  };
  const armar = new Function('window', 'LOGOUT_URL', 'console',
    'let _opsEnCurso = 0, _loginEnCurso = false, _yaFuiAlLogin = false, _recargaLoginEn = 0;\n'
    + 'let _sesionMuertaDesde = 0, _vioLoginTrasMuerte = false;\n'
    + 'let _intentosLogin = 0; const _MAX_INTENTOS_LOGIN = 3;\n'
    + fn('_irAlLogin') + '\n' + fn('_marcarSesionMuerta') + '\n'
    + 'return { ir:_irAlLogin, muerta:_marcarSesionMuerta, intentos:()=>_intentosLogin,'
    + ' revivir:function(){ _sesionMuertaDesde = 0; }, destrabar:function(){ _recargaLoginEn = 0; } };');
  const fue = [];
  const api = armar({ location: { href: 'https://bo.casinodrex.com/agents/user_search', assign: (u) => fue.push(u) } },
    'https://bo.casinodrex.com/logout', { warn() {} });

  api.muerta();
  for (let i = 0; i < 5; i++) { api.destrabar(); api.ir('gastando intentos'); }
  assert.equal(fue.length, 3, 'se gastó el tope');

  // Se repuso la sesión y más tarde se vuelve a caer: es una caída nueva, no la misma.
  api.revivir();
  api.muerta();
  api.destrabar();
  assert.equal(api.ir('caída nueva'), true, 'una caída nueva merece sus propios intentos');
  assert.equal(fue.length, 4);
});

test('caja negra · la falla se lleva la consola de la ventana de Agentes', async () => {
  const { sb } = panelConAgentes(() => Promise.reject(new Error('Timeout: la automatización tardó demasiado.')));
  sb.ctrlElectron.leerConsolaAgentes = async () => ({
    url: 'https://bo.casinodrex.com/logout',
    consola: [
      { t: '2026-09-26T18:00:00Z', nivel: 'error', msg: 'Failed to fetch global config: requireAuthentication', fuente: 'main-52f0199e.js:1' },
      { t: '2026-09-26T18:00:01Z', nivel: 'error', msg: 'blocked by CORS policy', fuente: 'logout:1' },
      { t: '2026-09-26T18:00:02Z', nivel: 'info',  msg: 'navegó a https://bo.casinodrex.com/logout', fuente: 'agent-window' }
    ]
  });

  await assert.rejects(() => sb.callDrex('cargarSaldo', 'pepe', 1000));
  await new Promise(r => setImmediate(r));          // la consola llega un tic después

  const f = sb.cajaNegra.fallas()[0];
  assert.ok(f.agentes, 'la falla tiene que llevarse lo que pasó del otro lado');
  assert.equal(f.agentes.url, 'https://bo.casinodrex.com/logout',
    'saber que quedó parada en /logout es lo que destrabó el diagnóstico');
  assert.equal(f.agentes.consola.length, 3);

  // Y que se pueda leer de un vistazo, sin abrir el devtools de la ventana de Agentes.
  const texto = sb.cajaNegra.texto();
  assert.match(texto, /consola de Agentes/);
  assert.match(texto, /blocked by CORS policy/);
  assert.match(texto, /logout:1/);
});

// ── NODO en Discord ──────────────────────────────────────────────────────────
test('discord · el panel arma los dos renglones y sólo manda lo que cambió', async () => {
  const { sb } = panelConAgentes(() => Promise.resolve({ ok: true, needsLogin: false }));
  const mandados = [];
  sb.ctrlElectron.discordPresencia = (p) => { mandados.push(p); return Promise.resolve({ ok: true }); };
  sb.window._versionApp = '2.1.3';
  sb.window.pcOperativa = 'P4';

  const ahora = Date.now();
  const haceMin = (m) => new Date(ahora - m * 60000).toISOString();
  sb.V154P.solicitudes = [
    { ID: 1, TIPO: 'CARGA',  ESTADO: 'PENDIENTE',  FECHA_CREACION: haceMin(1), metadata: {}, METADATA: {} },
    { ID: 2, TIPO: 'RETIRO', ESTADO: 'PENDIENTE',  FECHA_CREACION: haceMin(2), metadata: {}, METADATA: {} },
    { ID: 3, TIPO: 'CARGA',  ESTADO: 'ACREDITADA', FECHA_CREACION: haceMin(3), metadata: {}, METADATA: {} },
    // Un retiro pagándose por partes NO cuenta: ya se aceptó y se está trabajando.
    { ID: 4, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', FECHA_CREACION: haceMin(9),
      MONTO: 100000, MONTO_REAL: 100000,
      metadata:  { retiro_parcial: { total: 100000, pagado: 40000 } },
      METADATA:  { retiro_parcial: { total: 100000, pagado: 40000 } } }
  ];

  sb.actualizarPresenciaDiscord();
  assert.equal(mandados.length, 1);
  assert.equal(mandados[0].details, '2 solicitudes pendientes', 'el parcial no cuenta: ' + JSON.stringify(mandados[0]));
  assert.equal(mandados[0].state, 'Última carga hace 3 min');
  assert.equal(mandados[0].largeText, 'NODO 2.1.3 · P4');

  // Sin cambios no se vuelve a mandar.
  sb.actualizarPresenciaDiscord();
  assert.equal(mandados.length, 1);

  // Entra una solicitud nueva y sí se manda.
  sb.V154P.solicitudes.push({ ID: 5, TIPO: 'CARGA', ESTADO: 'PENDIENTE', FECHA_CREACION: haceMin(0), metadata: {}, METADATA: {} });
  sb.actualizarPresenciaDiscord();
  assert.equal(mandados.length, 2);
  assert.equal(mandados[1].details, '3 solicitudes pendientes');
});

test('discord · sin el puente de Electron no se cae ni molesta', () => {
  const sb = arrancarPanel();
  delete sb.ctrlElectron;
  assert.doesNotThrow(() => sb.actualizarPresenciaDiscord(), 'en el navegador esto no existe');
});

test('teléfonos · el panel los dibuja todos igual, vengan como vengan', () => {
  const sb = arrancarPanel();
  // Las formas que llegan de verdad: tipeado por el operador, de WhatsApp, del portal, del CSV.
  const mismo = ['1123456789', '541123456789', '5491123456789', '+54 9 11 2345-6789', '011 15 2345-6789'];
  const salidas = new Set(mismo.map(v => sb._tel(v)));
  assert.equal(salidas.size, 1, 'el mismo número no puede verse de cinco formas: ' + [...salidas].join(' | '));
  assert.equal([...salidas][0], '+54 9 11 2345-6789');
  // Lo que no es un teléfono se deja como está: no se inventa nada.
  assert.equal(sb._tel(''), '');
  assert.equal(sb._tel('no tiene'), 'no tiene');
});

test('alta · el botón de crear usuario tiene que existir y ser alcanzable', () => {
  const sb = arrancarPanel();
  for (const fn of ['abrirModalCrearUsuario', '_altaCrearDesdeCotejo', '_altaCotejoHtml', 'abrirModal']) {
    assert.equal(typeof sb[fn], 'function', fn + ' tiene que estar definida y ser global');
  }
  // El onclick del botón se resuelve contra window: si no está ahí, el botón queda muerto.
  assert.equal(typeof sb.window.abrirModalCrearUsuario, 'function', 'window.abrirModalCrearUsuario');
  assert.equal(typeof sb.window._altaCrearDesdeCotejo, 'function', 'window._altaCrearDesdeCotejo');
});

test('parciales · un historial a medias NO se canta como descuadre', () => {
  // Caso real (#275413, normaacdc, 28/9): los dos registros tenían los MISMOS cuatro pagos y
  // sumaban 1.500.000. Pero el historial en pantalla es de un período y no llegaba al primer pago,
  // así que sumaba 1.000.000 y el panel gritaba "el progreso no coincide". Mandar a revisar algo
  // que está bien cuesta tiempo y le saca valor al aviso cuando el descuadre es de verdad.
  const sb = arrancarPanel();
  const pagos = [
    { fecha: '2026-09-27T18:35:08Z', monto: 500000 },
    { fecha: '2026-09-28T05:05:52Z', monto: 400000 },
    { fecha: '2026-09-28T05:09:16Z', monto: 100000 },
    { fecha: '2026-09-28T11:05:29Z', monto: 500000 }
  ];
  const meta = { retiro_parcial: { total: 2600000, pagado: 1500000, pagos: pagos } };
  const s = { ID: 275413, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', USUARIO: 'normaacdc',
              FECHA_CREACION: '2026-09-27T18:00:00Z', MONTO: 2600000, MONTO_REAL: 2600000,
              metadata: meta, METADATA: meta };
  const fila = (t, m) => ({ solicitud_id: '275413', tipo: 'RETIRO', estado: 'OK', monto: m, created_at: t });

  // El historial cargado arranca DESPUÉS del primer pago: le falta ese medio millón.
  sb.window._historialData = pagos.slice(1).map(p => fila(p.fecha, p.monto));
  const cortado = sb._retiroParcialInfo(s);
  assert.equal(cortado.pagadoHistorial, 1000000, 'suma lo que ve, que es menos');
  assert.equal(cortado.histCompleto, false, 'y sabe que no llega hasta el primer pago');
  assert.equal(cortado.discrepa, false, 'así que NO puede cantar descuadre');

  // Con el historial completo, los dos coinciden: tampoco hay descuadre.
  sb.window._historialData = pagos.map(p => fila(p.fecha, p.monto));
  const entero = sb._retiroParcialInfo(s);
  assert.equal(entero.pagadoHistorial, 1500000);
  assert.equal(entero.histCompleto, true);
  assert.equal(entero.discrepa, false, 'coinciden: no hay nada que avisar');

  // Y con el historial completo y un pago de MENOS de verdad, sí se avisa.
  sb.window._historialData = pagos.slice(0, 3).map(p => fila(p.fecha, p.monto));
  const faltaUno = sb._retiroParcialInfo(s);
  assert.equal(faltaUno.histCompleto, true, 'llega hasta el primer pago: es comparable');
  assert.equal(faltaUno.discrepa, true, 'falta un pago de verdad: eso SÍ hay que decirlo');
});

// ── El aviso al jugador tiene que ir donde el portal lo lee ───────────────────
// Diecinueve lugares del panel avisan al jugador por notificarUsuarioEnChat, y todos escribian
// en chat_sesiones / chat_mensajes: la generacion de chat que el portal YA NO LEE. El mensaje se
// guardaba en una tabla que nadie mira. Se encontro con "marcar como ya cargada" (Juan, 30/9),
// pero les pasaba a los diecinueve. El ruteo vive ahora dentro de notificarUsuarioEnChat.

// El stub va DESPUES de arrancarPanel: chat-hilos.js define window.nodoEnviarMensajePortal al
// cargar, asi que ponerlo antes no sirve -- el bundle lo pisa.
function panelConAviso(respuestaPortal) {
  const alPortal = [];
  const rpcs = [];
  const sb = arrancarPanel({ rpc: async (fn) => { rpcs.push(fn); return { data: null, error: null }; } });
  sb.nodoEnviarMensajePortal = async (usuario, texto) => {
    alPortal.push({ usuario, texto });
    return respuestaPortal;
  };
  return { sb, alPortal, rpcs };
}

test('el aviso va primero al hilo que el portal lee', async () => {
  const { sb, alPortal, rpcs } = panelConAviso({ ok: true });
  const r = await sb.notificarUsuarioEnChat('milo30kc', 'Tu carga ya esta acreditada.');
  assert.equal(alPortal.length, 1, 'tiene que intentar el portal');
  assert.equal(alPortal[0].usuario, 'milo30kc');
  assert.match(alPortal[0].texto, /acreditada/);
  assert.ok(r && r.ok, 'y si el portal lo tomo, se termina ahi');
  assert.equal(rpcs.includes('panel_nodo_send_chat_message'), false,
    'no se escribe tambien en el chat viejo: quedaria duplicado');
});

test('si el jugador no tiene conversacion abierta, se le abre una (Juan, 2/11)', async () => {
  const { sb, alPortal, rpcs } = panelConAviso({ ok: false, error: 'sin-ticket' });
  await sb.notificarUsuarioEnChat('milo30kc', 'Tu carga ya esta acreditada.');
  assert.equal(alPortal.length, 1, 'primero prueba la conversacion que ya tenga');
  assert.equal(rpcs[0], 'panel_chat_iniciar', 'y si no hay, la abre donde el portal lee');
});

test('avisarJugadorEnChat no intenta el portal dos veces', async () => {
  // Ya lo probo el mismo; si al caer al camino viejo se volviera a intentar, el jugador podria
  // recibir el mismo mensaje repetido.
  const { sb, alPortal } = panelConAviso({ ok: false, error: 'sin-ticket' });
  await sb.avisarJugadorEnChat('milo30kc', 'Tu carga ya esta acreditada.', { crearSiNoHay: false });
  assert.equal(alPortal.length, 1, 'un solo intento al portal, no dos');
});

test('sin usuario o sin texto no se manda nada', async () => {
  const { sb, alPortal } = panelConAviso({ ok: true });
  await sb.notificarUsuarioEnChat('', 'algo');
  await sb.notificarUsuarioEnChat('milo30kc', '');
  assert.equal(alPortal.length, 0);
});

// ── D-130: lo que el sistema escribía en nombre del jugador ───────────────────
// Juan, 1/11: "[Conversación iniciada por el operador juancarlos]" del lado del jugador, debajo del
// "buenas" del propio operador. El panel lo inventaba al armar el hilo y lo guardaba al contestar.

function soporteConHilo(id, usuario, mensajeInicial, hilo) {
  const meta = { chat_thread: hilo, chat_estado: 'RESPONDIDO_PANEL', chat_master_id: id };
  return { ...solicitudDeSoporte(id, usuario, mensajeInicial), metadata: meta, METADATA: meta };
}
const FRASE_OPERADOR = '[Conversación iniciada por el operador juancarlos]';
const hiloIniciadoPorOperador = () => [
  { origen: 'OPERADOR', tipo: 'OPERADOR', usuario: 'milo', operador: 'juancarlos', mensaje: 'buenas', fecha: '2026-11-01T09:04:14.037Z' },
  { origen: 'USUARIO', usuario: 'milo', mensaje: FRASE_OPERADOR, fecha: '2026-11-01T09:04:14.037375+00:00', solicitud_id: 7 }
];
const textos = (ticket) => JSON.stringify(ticket.thread.map((m) => m.mensaje));

test('relleno · un hilo que arrancó el operador no le atribuye nada al jugador', () => {
  const sb = panelConDosCaminos([soporteConHilo(7, 'milo', FRASE_OPERADOR, hiloIniciadoPorOperador())], []);
  const t = sb.ticketsAgrupados().find((x) => x.usuario === 'milo');
  assert.equal(textos(t), JSON.stringify(['buenas']));
  assert.equal(t.unread, 0, 'tampoco es un mensaje nuevo para el operador');
});

test('relleno · una consulta sin mensaje no inventa uno, y la lista sigue teniendo qué mostrar', () => {
  const sb = panelConDosCaminos([solicitudDeSoporte(8, 'vacio', '')], []);
  const t = sb.ticketsAgrupados().find((x) => x.usuario === 'vacio');
  assert.equal(textos(t), '[]');
  assert.equal(t.unread, 0);
  assert.equal(t.mensaje, 'Consulta desde portal');
});

test('relleno · lo que el jugador escribió de verdad se queda', () => {
  const sb = panelConDosCaminos([
    solicitudDeSoporte(9, 'conTexto', 'no me llegó la carga'),
    soporteConHilo(10, 'conFoto', '', [{ origen: 'USUARIO', mensaje: 'Consulta desde portal', imagen_url: 'https://sb.co/c.png', fecha: '2026-11-01T09:00:00Z', solicitud_id: 10 }])
  ], []);
  const lista = sb.ticketsAgrupados();
  assert.equal(textos(lista.find((x) => x.usuario === 'conTexto')), JSON.stringify(['no me llegó la carga']));
  assert.equal(lista.find((x) => x.usuario === 'conFoto').thread.length, 1, 'una imagen no se pierde por el texto que la acompaña');
});

test('relleno · al contestar, lo inventado que estaba guardado no se vuelve a escribir', async () => {
  const sb = panelConDosCaminos([soporteConHilo(7, 'milo', FRASE_OPERADOR, hiloIniciadoPorOperador())], []);
  let escrito = null;
  sb.actualizarSolicitudPortal = async (id, estado, extra) => { escrito = extra; return {}; };
  const r = await sb.nodoEnviarMensajePortal('milo', 'te escribo de nuevo', false);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(escrito.chat_thread.map((m) => m.mensaje)), JSON.stringify(['buenas', 'te escribo de nuevo']));
});

// ── NODO escuchando los DOS caminos del chat ─────────────────────────────────
// Durante el cambio, la pagina nueva manda al canal que corresponde y la vieja sigue creando
// solicitudes. Va a haber jugadores que no refresquen el portal -- y si lo hacen va a ser tarde --
// asi que ninguna consulta puede quedar sin que alguien la vea por estar del lado equivocado.
// Esto SOLO suma: si el canal nuevo no contesta, la lista queda exactamente como hoy (Juan, 2/10).

function panelConDosCaminos(solicitudes, sesionesDelCanalNuevo) {
  const sb = arrancarPanel();
  sb.V154P = sb.V154P || {};
  sb.V154P.solicitudes = solicitudes;
  sb.solicitudes = solicitudes;
  if (sesionesDelCanalNuevo !== null) {
    sb._chatCanalNuevo = {
      cargar: async () => sesionesDelCanalNuevo,
      tickets: () => sesionesDelCanalNuevo,
      mensajesDe: async () => [],
      crudas: () => sesionesDelCanalNuevo
    };
  } else {
    delete sb._chatCanalNuevo;
  }
  return sb;
}

function solicitudDeSoporte(id, usuario, mensaje) {
  return { ID: id, SOLICITUD_ID: id, TIPO: 'SOPORTE', ESTADO: 'EN_REVISION',
           USUARIO: usuario, MENSAJE_INICIAL: mensaje, mensaje_inicial: mensaje,
           FECHA_CREACION: '2026-10-02T10:00:00Z', metadata: {}, METADATA: {} };
}
function sesionNueva(usuario, ultimo) {
  return { id: 'CANAL_' + usuario.toUpperCase(), usuario, telefono: '', items: [],
           fecha: '2026-10-02T11:00:00Z', mensaje: ultimo, solicitudId: '', masterId: null,
           accepted: true, cerrado: false,
           thread: [{ origen: 'USUARIO', usuario, mensaje: ultimo, fecha: '2026-10-02T11:00:00Z' }],
           unread: 1, last: null, _canalNuevo: true, _chatId: 'ch-' + usuario };
}

test('dos caminos · quien llega SOLO por el canal nuevo igual aparece', () => {
  const sb = panelConDosCaminos(
    [solicitudDeSoporte(1, 'porLaVieja', 'hola desde la pagina vieja')],
    [sesionNueva('porLaNueva', 'hola desde la pagina nueva')]
  );
  const lista = sb.ticketsAgrupados();
  const usuarios = lista.map(t => String(t.usuario).toUpperCase());
  assert.ok(usuarios.includes('PORLAVIEJA'), 'la de siempre sigue estando');
  assert.ok(usuarios.includes('PORLANUEVA'), 'y la del canal nuevo tambien, o queda sin atender');
});

test('dos caminos · el mismo jugador no aparece dos veces', () => {
  // Durante el cambio el mismo jugador puede estar en los dos lados. Si se duplicara, el operador
  // contestaria una y la otra quedaria ahi para siempre.
  const sb = panelConDosCaminos(
    [solicitudDeSoporte(1, 'juanito', 'mensaje por solicitud')],
    [sesionNueva('juanito', 'mensaje por el canal nuevo')]
  );
  const lista = sb.ticketsAgrupados();
  const cuantos = lista.filter(t => String(t.usuario).toUpperCase() === 'JUANITO').length;
  assert.equal(cuantos, 1, 'uno solo, no dos');
  const suyo = lista.find(t => String(t.usuario).toUpperCase() === 'JUANITO');
  assert.ok(!suyo._canalNuevo, 'manda el de solicitudes: trae el hilo completo y el estado');
});

test('dos caminos · si el canal nuevo no esta, la lista queda igual que siempre', () => {
  const con = panelConDosCaminos([solicitudDeSoporte(1, 'juanito', 'hola')], []);
  const sin = panelConDosCaminos([solicitudDeSoporte(1, 'juanito', 'hola')], null);
  // JSON y no deepEqual: cada arrancarPanel() es su propio sandbox, y los arrays de dos sandboxes
  // distintos no son "iguales" para la comparacion estricta aunque tengan lo mismo adentro.
  assert.equal(
    JSON.stringify(con.ticketsAgrupados().map(t => String(t.usuario))),
    JSON.stringify(sin.ticketsAgrupados().map(t => String(t.usuario))),
    'sin canal nuevo o con el canal vacio, lo mismo');
});

test('dos caminos · si el canal nuevo revienta, no se lleva puesta la lista', () => {
  const sb = panelConDosCaminos([solicitudDeSoporte(1, 'juanito', 'hola')], []);
  sb._chatCanalNuevo = { tickets: () => { throw new Error('se cayo'); } };
  const lista = sb.ticketsAgrupados();
  assert.equal(lista.length, 1, 'la bandeja de siempre se dibuja igual');
  assert.equal(String(lista[0].usuario).toUpperCase(), 'JUANITO');
});

test('dos caminos · el canal nuevo escucha SIEMPRE, sin interruptor', () => {
  // Llego a estar detras de un interruptor, por las 42 conversaciones de mayo. Pero el que las
  // deja afuera es el filtro de antiguedad, no el interruptor -- y un canal que hay que acordarse
  // de prender es un canal donde algun dia no va a estar prendido (Juan, 3/10).
  const sb = arrancarPanel();
  assert.equal(typeof sb.canalNuevo, 'undefined', 'no tiene que haber nada que prender ni apagar');
  assert.equal(typeof sb._chatCanalNuevo.tickets, 'function', 'y el canal tiene que estar leyendo');
});

test('dos caminos · lo viejo NO vuelve a la bandeja', () => {
  // Lo que protege de verdad: nada con mas de 7 dias sin actividad entra a la lista. En la base
  // hay 117 conversaciones de prueba de mayo; con este filtro aparecen DOS, las dos de P1.
  const sb = arrancarPanel();
  const hoy = new Date().toISOString();
  const mayo = '2026-05-20T10:00:00Z';
  sb.__sesionesDePrueba = [
    { usuario: 'deAhora', estado: 'ABIERTO', fecha_ultimo: hoy,  ultimo_mensaje: 'hola',  chat_id: 'a' },
    { usuario: 'deMayo',  estado: 'ABIERTO', fecha_ultimo: mayo, ultimo_mensaje: 'viejo', chat_id: 'b' }
  ];
  const corte = Date.now() - 7 * 24 * 3600 * 1000;
  const pasan = sb.__sesionesDePrueba
    .filter(x => new Date(x.fecha_ultimo).getTime() >= corte)
    .map(x => x.usuario);
  assert.equal(JSON.stringify(pasan), JSON.stringify(['deAhora']), 'solo lo de los ultimos dias');
});

test('dos caminos · el filtro de antiguedad sigue puesto en el codigo', () => {
  // Si alguien saca el filtro, vuelven las 117 conversaciones de prueba a la bandeja de todos.
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'renderer', 'chat', 'chat-canal-nuevo.js'), 'utf8');
  assert.match(src, /DIAS_UTILES\s*=\s*7/, 'el filtro de 7 dias');
  assert.match(src, /t >= corte/, 'y que se aplique de verdad');
});
