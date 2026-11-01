const test = require('node:test');
const assert = require('node:assert/strict');
const operationModal = require('../renderer/portal/operation-modal');

// "Aprobar" aprueba de una, y "Ver" un retiro revisa las fichas.
//
// Juan, 25/10: "el boton de aceptar solicitud, deberia de aceptarla de una, que mas informacion
// queres despues de desplegar eso" y "en una solicitud de retiro debe de revisar las fichas".
//
// Antes, "Aprobar" abría un cartel que volvía a pedir el monto, la billetera y una observación
// —todo lo que el expediente ya mostraba— y recién el segundo clic aprobaba. Se ejecuta el módulo
// real con la base, el agente y la pantalla reemplazados por registros de lo que se les pide.

function armar(opciones) {
  const o = opciones || {};
  const registro = { ejecuciones: [], toasts: [], modales: [], alertas: [], rpc: [], parciales: [], expedienteCerrado: 0, timers: [] };
  const ventana = Object.assign({
    PANEL_DATA_SECRET: 'x',
    abrirModalPortalSolicitud: (id) => registro.modales.push(id),
    cerrarExpedienteSolicitud: () => { registro.expedienteCerrado++; },
    v154pRegistrarParcial: (id) => registro.parciales.push(id)
  }, o.window || {});
  const modulo = operationModal.create({
    V154P: { solicitudes: o.solicitudes || [] },
    alert: (m) => registro.alertas.push(m),
    billeteras: o.billeteras || [{ ID_BILLETERA: 'b1', NOMBRE_VISIBLE: 'SALVATIERRA X', ACTIVA: 'SI', SALDO: 100 }],
    cargarBilleteras: async () => {},
    cerrarPortalJobModal: () => {},
    document: o.document || { getElementById: () => null, querySelectorAll: () => [] },
    ejecutarSolicitudPortalSimple: o.ejecutor || (async (ctx) => { registro.ejecuciones.push(ctx); }),
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fecha: (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : ''),
    getBilleraLanding: () => null,
    money: (v) => '$ ' + Number(v || 0).toLocaleString('es-AR'),
    normalizar: (v) => String(v || '').toUpperCase(),
    pcAliasesHist: () => ['P2'],
    pcOperativa: 'P2',
    portalCheckDiferencia: () => {},
    // Los temporizadores se juntan y se disparan a mano: así se prueba el "doble clic" sin esperar.
    setTimeout: (fn) => { registro.timers.push(fn); return registro.timers.length; },
    supabaseClient: { rpc: async (nombre, args) => { registro.rpc.push(nombre); return { data: o.promo || { primer_ingreso: false } }; } },
    toast: (m, c) => registro.toasts.push({ m, c }),
    v154pRegistrarParcial: (id) => registro.parciales.push(id),
    window: ventana
  });
  // Lo que el panel instala en window (globals) y lo que el módulo ofrece a los demás módulos.
  const api = Object.assign({}, modulo.globals, modulo);
  return { api, registro, ventana, dispararTimers: () => { while (registro.timers.length) registro.timers.shift()(); } };
}

const CARGA = {
  ID: 501, TIPO: 'CARGA', ESTADO: 'PENDIENTE', USUARIO: 'pruebaxx', MONTO_DECLARADO: 5000,
  TITULAR: 'Neo Test', DESTINO: 'SALVATIERRA X', ID_BILLETERA: 'b1', FECHA_CREACION: '2026-10-25T14:00:00Z'
};
const RETIRO = {
  ID: 502, TIPO: 'RETIRO', ESTADO: 'PENDIENTE', USUARIO: 'jugador_retiro', MONTO_DECLARADO: 50000,
  TITULAR: 'Titular Prueba', CBU: '0000000000000000000000', FECHA_CREACION: '2026-10-25T14:00:00Z'
};

// ── aprobar de una ──────────────────────────────────────────────────────────────────────────
test('Aprobar encola la carga de una, sin abrir el cartel', async () => {
  const t = armar({ solicitudes: [CARGA] });
  await t.api.v154pAprobarSolicitud(501);
  assert.equal(t.registro.ejecuciones.length, 1, 'tiene que ejecutarse en el acto');
  assert.deepEqual(t.registro.modales, [], 'y NO abrir el cartel que pide lo mismo otra vez');
  const c = t.registro.ejecuciones[0];
  assert.equal(c.id, 501);
  assert.equal(c.usuario, 'pruebaxx');
  assert.equal(c.tipo, 'CARGA');
  assert.equal(c.montoAprobado, 5000, 'el monto declarado');
  assert.equal(c.bilId, 'b1', 'la billetera donde entró la plata');
  assert.equal(c.obs, '');
});

test('al aprobar se cierra el expediente que estaba abierto', async () => {
  // El módulo instala SU propia función de cerrar, así que se mira el efecto: el cajón queda escondido.
  const clases = [];
  const overlay = { classList: { add: (c) => clases.push(c), remove: () => {} } };
  const t = armar({
    solicitudes: [CARGA],
    document: { getElementById: (id) => id === 'modalExpedienteOverlay' ? overlay : null, querySelectorAll: () => [] }
  });
  await t.api.v154pAprobarSolicitud(501);
  assert.ok(clases.includes('hidden'), 'el expediente tiene que cerrarse al aprobar');
});

test('dos clics seguidos aprueban UNA sola vez', async () => {
  const t = armar({ solicitudes: [CARGA] });
  await Promise.all([t.api.v154pAprobarSolicitud(501), t.api.v154pAprobarSolicitud(501)]);
  assert.equal(t.registro.ejecuciones.length, 1, 'plata de verdad: no puede salir dos veces');
});

test('pasado el instante, se puede volver a intentar', async () => {
  const t = armar({ solicitudes: [CARGA] });
  await t.api.v154pAprobarSolicitud(501);
  t.dispararTimers();
  await t.api.v154pAprobarSolicitud(501);
  assert.equal(t.registro.ejecuciones.length, 2, 'la cola es la que corta un duplicado real, no este seguro');
});

test('un retiro también se aprueba de una, y no consulta bonos', async () => {
  const t = armar({ solicitudes: [RETIRO] });
  await t.api.v154pAprobarSolicitud(502);
  assert.equal(t.registro.ejecuciones.length, 1);
  assert.equal(t.registro.ejecuciones[0].tipo, 'RETIRO');
  assert.equal(t.registro.ejecuciones[0].montoAprobado, 50000);
  assert.deepEqual(t.registro.rpc, [], 'el bono es de las cargas');
  assert.equal(t.registro.ejecuciones[0].bonoAplicar, false);
});

test('si le toca el bono de primer ingreso, viaja en la misma operación', async () => {
  const t = armar({
    solicitudes: [CARGA],
    promo: { primer_ingreso: true, promo_activa: true, bono_pct: 30, bono_max: 50000, promo_billetera_id: 42, cuenta_compartida: false }
  });
  await t.api.v154pAprobarSolicitud(501);
  const c = t.registro.ejecuciones[0];
  assert.equal(c.bonoAplicar, true);
  assert.equal(c.bonoPct, 30);
  assert.equal(c.bonoMax, 50000);
  assert.equal(c.promoBilleteraId, '42');
});

test('sin bono, la carga sale sin bono', async () => {
  const t = armar({ solicitudes: [CARGA], promo: { primer_ingreso: false } });
  await t.api.v154pAprobarSolicitud(501);
  assert.equal(t.registro.ejecuciones[0].bonoAplicar, false);
  assert.equal(t.registro.ejecuciones[0].bonoPct, 0);
});

test('bono con cuenta compartida: es una decisión, así que ahí SÍ se abre el cartel', async () => {
  // El bono viaja en la misma operación que la carga y no se puede decidir después. El sistema
  // dejó esto en manos del operador a propósito (puede ser familia compartiendo cuenta).
  const t = armar({
    solicitudes: [CARGA],
    promo: { primer_ingreso: true, promo_activa: true, bono_pct: 30, bono_max: 50000, promo_billetera_id: 42, cuenta_compartida: true, otros_con_bono: 2 }
  });
  await t.api.v154pAprobarSolicitud(501);
  assert.equal(t.registro.ejecuciones.length, 0, 'no se aprueba sola');
  assert.deepEqual(t.registro.modales, [501]);
  assert.match(t.registro.toasts.map(x => x.m).join(' '), /decidir el bono/);
});

test('sin monto no hay nada que proponer: abre el cartel para completarlo', async () => {
  const t = armar({ solicitudes: [Object.assign({}, CARGA, { MONTO_DECLARADO: 0 })] });
  await t.api.v154pAprobarSolicitud(501);
  assert.equal(t.registro.ejecuciones.length, 0);
  assert.deepEqual(t.registro.modales, [501]);
});

test('un retiro con parcial en curso NO se aprueba entero: va al parcial', async () => {
  const t = armar({
    solicitudes: [RETIRO],
    window: {
      _retiroParcialSigueAbierto: () => true,
      _retiroParcialInfo: () => ({ pagado: 20000, total: 50000, restante: 30000 })
    }
  });
  await t.api.v154pAprobarSolicitud(502);
  assert.equal(t.registro.ejecuciones.length, 0, 'aprobarlo entero cerraría con plata pendiente');
  assert.deepEqual(t.registro.parciales, [502]);
});

test('una solicitud que no existe avisa y no ejecuta nada', async () => {
  const t = armar({ solicitudes: [] });
  await t.api.v154pAprobarSolicitud(999);
  assert.equal(t.registro.ejecuciones.length, 0);
  assert.equal(t.registro.alertas.length, 1);
});

test('si la ejecución falla, se avisa en rojo', async () => {
  const t = armar({ solicitudes: [CARGA], ejecutor: async () => { throw new Error('el agente no contestó'); } });
  await t.api.v154pAprobarSolicitud(501);
  assert.ok(t.registro.toasts.some(x => x.c === 'red' && /el agente no contestó/.test(x.m)));
});

test('Otro monto sigue abriendo el cartel de siempre', async () => {
  const t = armar({ solicitudes: [CARGA] });
  await t.api.v154pCrearJobSolicitud(501);
  assert.deepEqual(t.registro.modales, [501]);
  assert.equal(t.registro.ejecuciones.length, 0);
});

// ── el expediente ───────────────────────────────────────────────────────────────────────────
const item = (raw, extra) => Object.assign({
  fuente: 'SOLICITUD', id: String(raw.ID), tipo: raw.TIPO, usuario: raw.USUARIO,
  monto: raw.MONTO_DECLARADO, estado: raw.ESTADO, fecha: raw.FECHA_CREACION, _raw: raw
}, extra || {});

test('el botón de copiar se llama por lo que hace', () => {
  const html = armar({}).api.construirDossierCompletoHtml(item(CARGA));
  assert.ok(!/Copiar [Ff]icha/.test(html), 'un operador nuevo no sabe qué es una "ficha"');
  assert.match(html, /Copiar datos de la operación/);
  assert.match(html, /listos para pegar en el chat o en WhatsApp/, 'y el cartel flotante dice para qué sirve');
});

test('el expediente de una solicitud abierta aprueba de una y ofrece Otro monto', () => {
  const html = armar({}).api.construirDossierCompletoHtml(item(CARGA));
  assert.match(html, /v154pAprobarSolicitud\(501\)">✓ Aprobar</);
  assert.match(html, /v154pCrearJobSolicitud\(501\)"[^>]*>✎ Otro monto</);
});

test('una solicitud tomada ofrece Soltar; una sin tomar no', () => {
  const tomada = armar({}).api.construirDossierCompletoHtml(item(Object.assign({}, CARGA, { ESTADO: 'EN_REVISION' })));
  assert.match(tomada, /v154pSoltarSolicitud\(501\)/);
  assert.ok(!/Tomar<\/button>/.test(tomada), 'ya está tomada: no se ofrece tomarla otra vez');
  const libre = armar({}).api.construirDossierCompletoHtml(item(CARGA));
  assert.ok(!/v154pSoltarSolicitud/.test(libre), 'no hay nada que soltar');
  assert.match(libre, /v154pTomarSolicitud\(501\)/);
});

test('"Ver" un retiro abierto muestra la fila de fichas del jugador', () => {
  const html = armar({}).api.construirDossierCompletoHtml(item(RETIRO));
  assert.match(html, /Fichas del jugador/);
  assert.match(html, /data-fichas="1"/, 'es donde se pinta la lectura');
  assert.match(html, /Leyendo las fichas/);
  assert.ok(!/Se leen al ejecutar/.test(html), 'dejó de ser "se leen después": se leen ahora');
});

test('una carga NO lee fichas: no tiene sentido ahí', () => {
  const html = armar({}).api.construirDossierCompletoHtml(item(CARGA));
  assert.ok(!/Fichas del jugador/.test(html));
  assert.ok(!/data-fichas/.test(html));
});

test('un retiro ya pagado no vuelve a leer fichas', () => {
  const html = armar({}).api.construirDossierCompletoHtml(item(Object.assign({}, RETIRO, { ESTADO: 'PAGADA' })));
  assert.ok(!/data-fichas/.test(html), 'está cerrado: lo que importa es lo que ya pasó');
});

function nodosFichas() {
  const nodos = [{ innerHTML: '' }];
  return { nodos, document: { getElementById: () => null, querySelectorAll: (sel) => sel === '[data-fichas]' ? nodos : [] } };
}

test('revisar las fichas pide la lectura del jugador correcto y pinta lo que vuelve', async () => {
  const f = nodosFichas();
  const pedidos = [];
  const t = armar({
    document: f.document,
    window: { revisarFichasRetiro: async (p) => { pedidos.push(p); return { saldo: 50166.7, raw: 'ARS 50,166.70', confiable: true, ts: Date.now() }; } }
  });
  t.api.construirDossierCompletoHtml(item(RETIRO));      // deja armado el expediente actual
  await t.api.revisarFichasExpediente();
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].usuario, 'jugador_retiro');
  assert.equal(pedidos[0].monto, 50000);
  assert.match(f.nodos[0].innerHTML, /ARS 50,166\.70/, 'se ve el saldo leído');
  assert.match(f.nodos[0].innerHTML, /alcanza/, 'y se dice si alcanza');
});

test('si no alcanza, lo dice y avisa que se puede pagar por partes', async () => {
  const f = nodosFichas();
  const t = armar({
    document: f.document,
    window: { revisarFichasRetiro: async () => ({ saldo: 12000, raw: 'ARS 12,000.00', confiable: true, ts: Date.now() }) }
  });
  t.api.construirDossierCompletoHtml(item(RETIRO));
  await t.api.revisarFichasExpediente();
  assert.match(f.nodos[0].innerHTML, /no alcanza/);
  assert.match(f.nodos[0].innerHTML, /por partes/);
});

test('sin fichas, lo dice con todas las letras', async () => {
  const f = nodosFichas();
  const t = armar({
    document: f.document,
    window: { revisarFichasRetiro: async () => ({ saldo: 0, raw: 'ARS 0.00', confiable: true, ts: Date.now() }) }
  });
  t.api.construirDossierCompletoHtml(item(RETIRO));
  await t.api.revisarFichasExpediente();
  assert.match(f.nodos[0].innerHTML, /sin fichas para retirar/);
});

test('si no se pudo leer, dice por qué y deja reintentar', async () => {
  const f = nodosFichas();
  const t = armar({
    document: f.document,
    window: { revisarFichasRetiro: async () => ({ error: 'El agente está ocupado con otra operación.' }) }
  });
  t.api.construirDossierCompletoHtml(item(RETIRO));
  await t.api.revisarFichasExpediente();
  assert.match(f.nodos[0].innerHTML, /El agente está ocupado/);
  assert.match(f.nodos[0].innerHTML, /Reintentar/);
  assert.match(f.nodos[0].innerHTML, /expedienteRevisarFichas\(true\)/);
});

test('una lectura dudosa no se presenta como saldo', async () => {
  const f = nodosFichas();
  const t = armar({
    document: f.document,
    window: { revisarFichasRetiro: async () => ({ saldo: 0, raw: '', confiable: false, ts: Date.now() }) }
  });
  t.api.construirDossierCompletoHtml(item(RETIRO));
  await t.api.revisarFichasExpediente();
  assert.match(f.nodos[0].innerHTML, /No pude leer bien el saldo/);
  assert.ok(!/alcanza/.test(f.nodos[0].innerHTML), 'un 0 por lectura fallida no es "sin fichas"');
});

test('una lectura reciente se reusa; "Volver a leer" fuerza una nueva', async () => {
  const f = nodosFichas();
  let lecturas = 0;
  const t = armar({
    document: f.document,
    window: {
      _retiroSaldoCheck: { jugador_retiro: { saldo: 80000, raw: 'ARS 80,000.00', confiable: true, ts: Date.now() - 30000 } },
      revisarFichasRetiro: async () => { lecturas++; return { saldo: 1, raw: 'ARS 1.00', confiable: true, ts: Date.now() }; }
    }
  });
  t.api.construirDossierCompletoHtml(item(RETIRO));
  await t.api.revisarFichasExpediente();
  assert.equal(lecturas, 0, 'de hace 30 segundos: no se vuelve a molestar al agente');
  assert.match(f.nodos[0].innerHTML, /80,000/);
  await t.api.revisarFichasExpediente(true);
  assert.equal(lecturas, 1, 'forzada: sí');
});

test('si se cierra el expediente mientras lee, no se pisa nada', async () => {
  const f = nodosFichas();
  let soltar;
  const t = armar({
    document: f.document,
    window: { revisarFichasRetiro: () => new Promise((res) => { soltar = res; }) }
  });
  t.api.construirDossierCompletoHtml(item(RETIRO));
  const lectura = t.api.revisarFichasExpediente();
  t.api.cerrarExpedienteSolicitud();
  soltar({ saldo: 5, raw: 'ARS 5.00', confiable: true, ts: Date.now() });
  await lectura;
  assert.ok(!/ARS 5\.00/.test(f.nodos[0].innerHTML), 'el operador ya no está mirando ese retiro');
});
