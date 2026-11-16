const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FUENTE = path.join(ROOT, 'renderer', 'extensions', 'oficina-whatsapp.js');
const codigo = fs.readFileSync(FUENTE, 'utf8');

// DOM mínimo: el módulo sólo necesita dos nodos (el tilde de la ruedita y la caja de Ajustes).
function nodo(id) {
  return { id, innerHTML: '', className: '', title: '' };
}

// Levanta el módulo con un servidor de mentira. `respuestas` dice qué contesta cada RPC;
// `llamadas` queda con todo lo que se le pidió al servidor, en orden.
function montar(respuestas, backoffice) {
  const llamadas = [];
  const alBackoffice = [];
  const opcionesBackoffice = [];
  const tilde = nodo('navAjustesTilde');
  const caja = nodo('ajustesWhatsapp');
  const avisos = [];

  const win = {
    PANEL_DATA_SECRET: 'x',
    pcOperativa: 'P4',
    operador: { usuario: 'tester' },
    escapeHtml: v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    toast: txt => avisos.push(String(txt)),
    document: {
      getElementById: id => (id === 'navAjustesTilde' ? tilde : id === 'ajustesWhatsapp' ? caja : null)
    },
    // El reloj no corre: el módulo programa su primera lectura a los 14 s y acá la llamamos a mano.
    setTimeout: () => 0,
    // La ventana de Agentes. Sin `backoffice` no hay puente, que es como corre en una PC que
    // todavía no abrió el backoffice.
    ctrlElectron: backoffice === undefined ? undefined : {
      drexAutomation: async (metodo, opciones) => {
        alBackoffice.push(metodo);
        opcionesBackoffice.push(opciones || {});
        return typeof backoffice === 'function' ? backoffice(metodo, opciones || {}, alBackoffice.length) : backoffice;
      }
    },
    console,
    supabaseClient: {
      rpc: async (fn, params) => {
        llamadas.push({ fn, params });
        const r = respuestas[fn];
        const data = typeof r === 'function' ? r(llamadas.filter(l => l.fn === fn).length) : r;
        if (data === undefined) return { data: null, error: { message: 'sin respuesta de mentira para ' + fn } };
        return { data, error: null };
      }
    }
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(codigo, win, { filename: FUENTE });
  return { win, llamadas, tilde, caja, avisos, alBackoffice, opcionesBackoffice };
}

const LINEAS_P4 = [
  { id: 'a', nombre: 'PRINCIPAL 1', estado: 'CONNECTED', activa: true, numero: '5491123450001', minutos: 900 },
  { id: 'b', nombre: 'SOPORTE 2', estado: 'CONNECTED', activa: true, numero: '5491123450002', minutos: 400 },
  { id: 'c', nombre: 'SOPORTE 4', estado: 'qrcode', activa: false, numero: null, minutos: 60 }
];

function estado(extra) {
  return Object.assign({
    ok: true, pc: 'P4', pide: 'NADA', numero_pagina: null, desajuste: false,
    wtk: { responde: true, datos_viejos: false, lineas: 3, activas: 2, activas_con_numero: 2, rota_sola: false },
    linea_pagina: null, lineas: LINEAS_P4,
    turno: { actual: 'MANANA', toca_hoy: 'MANANA', hay_que_preguntar: false }
  }, extra || {});
}

test('sin numero publicado: avisa que el jugador no tiene como escribir y prende el tilde', async () => {
  const m = montar({ panel_oficina_wsp_estado: estado({ pide: 'CARGAR_NUMERO' }) });
  await m.win.NodoWsp.revisar();

  assert.equal(m.tilde.className, 'nav-tilde');            // visible
  assert.match(m.caja.innerHTML, /no le aparece el bot/i);
  assert.match(m.caja.innerHTML, /Traerlo del backoffice/);
  assert.match(m.caja.innerHTML, /Escribirlo a mano/);
});

test('el numero publicado se muestra legible, sin el 549 que el operador no tiene por que leer', async () => {
  const m = montar({ panel_oficina_wsp_estado: estado({ numero_pagina: '5491123450002', linea_pagina: LINEAS_P4[1] }) });
  await m.win.NodoWsp.revisar();

  assert.match(m.caja.innerHTML, /11 2345-0002/);
  assert.doesNotMatch(m.caja.innerHTML, /5491123450002/);
  assert.match(m.caja.innerHTML, /SOPORTE 2/);
  assert.equal(m.tilde.className, 'nav-tilde hidden');     // no hay nada que hacer
});

test('cuando la linea publicada se cayo, la cambia sola y cuenta que lo hizo', async () => {
  let vuelta = 0;
  const m = montar({
    panel_oficina_wsp_estado: () => {
      vuelta += 1;
      // Primera lectura: la publicada está caída. Segunda (después de rotar): ya está resuelta.
      return vuelta === 1
        ? estado({ pide: 'ROTAR', numero_pagina: '5491123450009',
                   linea_pagina: { id: 'z', nombre: 'VIEJA', estado: 'qrcode', activa: false, numero: '5491123450009' } })
        : estado({ numero_pagina: '5491123450001', linea_pagina: LINEAS_P4[0] });
    },
    panel_oficina_wsp_rotar: { ok: true, cambio: true, de: 'VIEJA', a: 'PRINCIPAL 1', numero: '5491123450001' }
  });
  await m.win.NodoWsp.revisar();

  const pedidas = m.llamadas.map(l => l.fn);
  assert.deepEqual(pedidas, ['panel_oficina_wsp_estado', 'panel_oficina_wsp_rotar', 'panel_oficina_wsp_estado']);
  assert.equal(m.llamadas[1].params.p_pc, 'P4');
  assert.equal(m.llamadas[1].params.p_operador, 'tester');
  assert.match(m.caja.innerHTML, /Lo cambi/);
  assert.match(m.caja.innerHTML, /VIEJA/);
  assert.match(m.caja.innerHTML, /PRINCIPAL 1/);
  assert.equal(m.tilde.className, 'nav-tilde hidden');     // se resolvió solo: no molesta a nadie
  assert.match(m.avisos.join(' '), /PRINCIPAL 1/);
});

test('el numero que no es de ninguna linea deja la senal y NO se le muestra al operador', async () => {
  const m = montar({
    panel_oficina_wsp_estado: estado({ pide: 'NADA', desajuste: true, numero_pagina: '5491199990000' }),
    panel_oficina_wsp_desajuste: { ok: true, aviso: true, id: 7 }
  });
  await m.win.NodoWsp.revisar();

  assert.ok(m.llamadas.some(l => l.fn === 'panel_oficina_wsp_desajuste'), 'tiene que dejar la señal');
  assert.equal(m.tilde.className, 'nav-tilde hidden');     // no es trabajo del operador
  assert.doesNotMatch(m.caja.innerHTML, /no es ninguna|desajust|revisar el caso/i);
  assert.equal(m.avisos.length, 0, 'no se le avisa nada al operador');
});

test('cuando toca la constancia del turno aparece el boton, y no aparece cuando no toca', async () => {
  const toca = montar({ panel_oficina_wsp_estado: estado({
    pide: 'CONFIRMAR', numero_pagina: '5491123450002',
    wtk: { responde: false, datos_viejos: true, lineas: 0, activas: 0, activas_con_numero: 0, rota_sola: false },
    lineas: [], turno: { actual: 'TARDE', toca_hoy: 'TARDE', hay_que_preguntar: true } }) },
    { ok: true, numero: '5491123450002', numeroValido: true, habilitado: true });
  await toca.win.NodoWsp.revisar();
  assert.match(toca.caja.innerHTML, /sigue andando/);
  assert.equal(toca.tilde.className, 'nav-tilde');

  const noToca = montar({ panel_oficina_wsp_estado: estado({
    pide: 'NADA', numero_pagina: '5491123450002',
    wtk: { responde: false, datos_viejos: true, lineas: 0, activas: 0, activas_con_numero: 0, rota_sola: false },
    lineas: [], turno: { actual: 'MANANA', toca_hoy: 'NOCHE', hay_que_preguntar: false } }) });
  await noToca.win.NodoWsp.revisar();
  assert.doesNotMatch(noToca.caja.innerHTML, /S\u00ed, sigue andando/);
  assert.equal(noToca.tilde.className, 'nav-tilde hidden');
});

test('sin lectura de las lineas no inventa un estado: le dice al operador que lo cambie si deja de contestar', async () => {
  const m = montar({ panel_oficina_wsp_estado: estado({
    pide: 'NADA', numero_pagina: '5491123450002',
    wtk: { responde: false, datos_viejos: true, lineas: 0, activas: 0, activas_con_numero: 0, rota_sola: false },
    lineas: [] }) });
  await m.win.NodoWsp.revisar();
  assert.match(m.caja.innerHTML, /deja de contestar, cambialo/);
  assert.doesNotMatch(m.caja.innerHTML, /andando<\/span>/);  // no lista líneas que no leyó
});

test('un error del servidor no deja la pantalla a medias ni tira la operacion', async () => {
  const m = montar({});   // ninguna respuesta: el rpc contesta error
  const r = await m.win.NodoWsp.revisar();
  assert.equal(r, null);
  assert.equal(m.tilde.className, '');   // no se toca nada
});

test('el modulo no usa prompt(): en Electron no existe (docs/BOTONES.md)', () => {
  assert.doesNotMatch(codigo, /(^|[^.\w])prompt\s*\(/m);
  assert.match(codigo, /nodoPedirTexto/);
});

test('nada de lo que ve el operador nombra oficinas, codigos ni cosas tecnicas', async () => {
  // Se revisa el HTML que realmente se pinta, no el codigo: se recorren todos los estados
  // posibles y se junta todo lo que el operador podria llegar a leer.
  const casos = [
    estado({ pide: 'CARGAR_NUMERO' }),
    estado({ pide: 'MAPEAR', numero_pagina: '5491199990000' }),
    estado({ pide: 'CONFIRMAR', numero_pagina: '5491123450002',
             wtk: { responde: false, datos_viejos: true, lineas: 0, activas: 0, activas_con_numero: 0, rota_sola: false }, lineas: [] }),
    estado({ pide: 'NADA', numero_pagina: '5491123450002', linea_pagina: LINEAS_P4[1] }),
    estado({ pide: 'NADA', desajuste: true, numero_pagina: '5491199990000' })
  ];

  let pintado = '';
  for (const caso of casos) {
    const m = montar({ panel_oficina_wsp_estado: caso, panel_oficina_wsp_desajuste: { ok: true, aviso: true } });
    await m.win.NodoWsp.revisar();
    pintado += '\n' + m.caja.innerHTML + '\n' + m.tilde.title + '\n' + m.avisos.join('\n');
  }

  // Sin texto en ingles, sin codigos de PC, sin nombres de funciones ni estados crudos.
  for (const palabra of ['oficina', 'WTK', 'Whaticket', 'CONNECTED', 'qrcode', 'pc_codigo',
                         'panel_oficina', 'rpc', 'null', 'undefined', 'P4']) {
    assert.doesNotMatch(pintado, new RegExp(palabra, 'i'), 'el operador no tiene que leer "' + palabra + '"');
  }
  // Y si hay algo que hacer, se dice en castellano y de frente.
  assert.match(pintado, /no le aparece el bot/i);
});

// ── Lo que se rompió el 14/11 ────────────────────────────────────────────────────────────
// El backoffice estaba abierto al lado con el número puesto, y NODO le preguntaba al operador
// "¿sigue andando?" sin haberlo mirado nunca. Sólo lo leía si apretaban un botón, y ese botón
// aparecía únicamente cuando NO había ningún número publicado.

test('el codigo de area de 3 digitos se lee bien: 223, no 22', async () => {
  const m = montar({ panel_oficina_wsp_estado: estado({ numero_pagina: '5492236700367' }) });
  await m.win.NodoWsp.revisar();
  assert.match(m.caja.innerHTML, /223 670-0367/);
  assert.doesNotMatch(m.caja.innerHTML, /22 3670-0367/, 'Mar del Plata es 223, no 22');
});

test('mira el backoffice SOLO, antes de preguntarle nada a nadie', async () => {
  const m = montar(
    { panel_oficina_wsp_estado: estado({ pide: 'CONFIRMAR', numero_pagina: '5492235181171',
        wtk: { responde: false, datos_viejos: true, lineas: 0, activas: 0, activas_con_numero: 0, rota_sola: false },
        lineas: [], turno: { actual: 'TARDE', toca_hoy: 'TARDE', hay_que_preguntar: true } }) },
    { ok: true, numero: '5492236700367', habilitado: true });
  await m.win.NodoWsp.revisar();

  assert.deepEqual(m.alBackoffice, ['leerWhatsappOficina'], 'tiene que leerlo sin que nadie apriete nada');
  assert.equal(m.opcionesBackoffice[0].navegar, true, 'la revisión del watchdog debe abrir Personalizar página desde la pantalla actual');
  // Y como no coinciden, la pregunta correcta NO es "¿sigue andando?".
  assert.match(m.caja.innerHTML, /no es el que ten\u00e9s puesto en el backoffice/);
  assert.doesNotMatch(m.caja.innerHTML, /sigue andando\?/);
  assert.match(m.caja.innerHTML, /223 518-1171/);   // lo que ve el jugador
  assert.match(m.caja.innerHTML, /223 670-0367/);   // lo que dice el backoffice
  assert.match(m.caja.innerHTML, /Poner el del backoffice/);
});

test('si coinciden lo dice, y recien ahi pregunta si sigue andando', async () => {
  const m = montar(
    { panel_oficina_wsp_estado: estado({ pide: 'CONFIRMAR', numero_pagina: '5492236700367',
        wtk: { responde: false, datos_viejos: true, lineas: 0, activas: 0, activas_con_numero: 0, rota_sola: false },
        lineas: [], turno: { actual: 'TARDE', toca_hoy: 'TARDE', hay_que_preguntar: true } }) },
    { ok: true, numero: '5492236700367', habilitado: true });
  await m.win.NodoWsp.revisar();

  assert.match(m.caja.innerHTML, /coincide/);
  // Coincidir no prueba que la línea esté viva: la constancia la sigue dando una persona.
  assert.match(m.caja.innerHTML, /sigue andando/);
});

test('si AdminOnline devuelve un formato inválido, nunca lo marca como coincidente ni activo', async () => {
  const m = montar(
    { panel_oficina_wsp_estado: estado({ numero_pagina: '5492236700367' }) },
    { ok: true, numero: '92236700367', numeroValido: false, habilitado: true });
  await m.win.NodoWsp.revisar();

  assert.match(m.caja.innerHTML, /formato inválido/);
  assert.doesNotMatch(m.caja.innerHTML, /· coincide/);
  assert.doesNotMatch(m.caja.innerHTML, /contacto está activo/);
});

test('si la lectura no llega a Personalizar página, informa que el número no está verificado', async () => {
  const m = montar(
    { panel_oficina_wsp_estado: estado({ numero_pagina: '5492236700367' }) },
    { ok: false, motivo: 'OTRA_PANTALLA' });
  await m.win.NodoWsp.revisar();

  assert.match(m.caja.innerHTML, /No pude abrir Personalizar página/);
  assert.match(m.caja.innerHTML, /todavía no está verificado/);
  assert.doesNotMatch(m.caja.innerHTML, /· coincide|contacto está activo|WhatsApp publicado está andando/);
});

test('sin numero publicado se pone el del backoffice solo, sin escribir nada a mano', async () => {
  let vuelta = 0;
  const m = montar({
    panel_oficina_wsp_estado: () => {
      vuelta += 1;
      return vuelta === 1 ? estado({ pide: 'CARGAR_NUMERO' })
                          : estado({ pide: 'NADA', numero_pagina: '5492236700367' });
    },
    panel_oficina_whatsapp_registrar: { ok: true, cambio: true, whatsapp_numero: '5492236700367' }
  }, { ok: true, numero: '5492236700367', habilitado: true });
  await m.win.NodoWsp.revisar();

  const guardado = m.llamadas.find(l => l.fn === 'panel_oficina_whatsapp_registrar');
  assert.ok(guardado, 'tiene que publicarlo solo: sin número, el jugador no tiene botón');
  assert.equal(guardado.params.p_numero, '5492236700367');
  assert.equal(m.tilde.className, 'nav-tilde hidden', 'ya está resuelto: no molesta a nadie');
});

test('el contacto apagado en el backoffice se avisa aunque el numero este bien', async () => {
  const m = montar(
    { panel_oficina_wsp_estado: estado({ pide: 'NADA', numero_pagina: '5492236700367' }) },
    { ok: true, numero: '5492236700367', habilitado: false });
  await m.win.NodoWsp.revisar();
  assert.match(m.caja.innerHTML, /apagado/);
  assert.match(m.caja.innerHTML, /no le aparece el bot/);
});

test('si la ventana de Agentes esta ocupada no se inventa que no hay numero', async () => {
  const m = montar(
    { panel_oficina_wsp_estado: estado({ pide: 'CONFIRMAR', numero_pagina: '5492235181171',
        wtk: { responde: false, datos_viejos: true, lineas: 0, activas: 0, activas_con_numero: 0, rota_sola: false },
        lineas: [], turno: { actual: 'TARDE', toca_hoy: 'TARDE', hay_que_preguntar: true } }) },
    { ok: false, ocupado: true });
  let encoladas = 0;
  m.win._drexCola = { activo: { nombre: 'cargarSaldo' }, pendientes: 1 };
  m.win._drexEncolar = function(){ encoladas++; return Promise.resolve(); };
  await m.win.NodoWsp.revisar();
  assert.equal(encoladas, 0, 'la revisión automática no se mete en una operación en curso');
  assert.doesNotMatch(m.caja.innerHTML, /no es el que ten\u00e9s puesto/, 'no leerlo no es lo mismo que no coincidir');
  assert.match(m.caja.innerHTML, /no está verificado|espera a que termine la operación/i);
  assert.doesNotMatch(m.caja.innerHTML, /sigue andando/);
});

test('la lectura manual se encola detrás de una operación activa y luego verifica AdminOnline', async () => {
  const m = montar(
    { panel_oficina_wsp_estado: estado({ numero_pagina: '5492235181171' }) },
    { ok: true, numero: '92236700367', numeroValido: false, habilitado: true });
  m.win._drexCola = { activo: { nombre: 'obtenerSaldoAgente' }, pendientes: 1 };
  const encoladas = [];
  m.win._drexEncolar = function(nombre, fn, opciones){
    encoladas.push({ nombre, silencioso: opciones && opciones.silencioso });
    m.win._drexCola = { activo: null, pendientes: 0 };
    return Promise.resolve().then(fn);
  };

  await m.win.nodoWspLeerBackoffice();

  assert.equal(encoladas.length, 1);
  assert.equal(encoladas[0].nombre, 'leerWhatsappOficina(wsp)');
  assert.equal(encoladas[0].silencioso, true);
  assert.equal(m.opcionesBackoffice[0].navegar, true);
  assert.match(m.caja.innerHTML, /formato inválido/);
  assert.doesNotMatch(m.caja.innerHTML, /· coincide/);
});
