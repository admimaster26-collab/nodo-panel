const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// La caja "En proceso" y los botones Tomar / Soltar.
//
// Juan, 25/10: al tomar una solicitud o un retiro se tiene que volcar al apartado donde están los
// retiros pagándose por partes. Esa caja era sólo de parciales: filas con "falta $X" y "Pagar más".
// Ahora tiene dos clases de fila y cada una ofrece lo que se puede hacer CON ella.

const RAIZ = path.join(__dirname, '..', 'renderer');

// ═══ la caja ════════════════════════════════════════════════════════════════════════════════
const HISTORIAL = fs.readFileSync(path.join(RAIZ, 'core', 'archivo-historial.js'), 'utf8');
function cortarCaja() {
  const i = HISTORIAL.indexOf('function _enProcesoFilaParcial(s){');
  const j = HISTORIAL.indexOf('// ── La historia de un retiro pagado en partes (D-90)', i);
  assert.notEqual(i, -1, 'no está la caja');
  assert.notEqual(j, -1);
  return HISTORIAL.slice(i, j);
}

function armarCaja(opciones) {
  const o = opciones || {};
  const salida = { modales: [], toasts: [] };
  const ventana = Object.assign({
    _parcialesEnProceso: [], _tomadasEnProceso: [],
    _retiroParcialInfo: (s) => s._pp || { hasProg: false, total: 0, pagado: 0, restante: 0 },
    _retiroSaldoCheck: {}, operador: { usuario: 'xprueba' }
  }, o.window || {});
  const ctx = {
    window: ventana,
    escapeHtml: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v) => '$' + Number(v || 0).toLocaleString('es-AR'),
    formatFecha: () => '25/10',
    abrirModal: (titulo, cuerpo) => salida.modales.push({ titulo, cuerpo }),
    toast: (m) => salida.toasts.push(m),
    String, Number, Math
  };
  vm.createContext(ctx);
  vm.runInContext(cortarCaja() + '\nwindow.verRetirosParciales = window.verRetirosParciales || verRetirosParciales;', ctx);
  return { abrir: () => ctx.window.verRetirosParciales(), salida, ventana };
}

const TOMADA_CARGA = { ID: 11, TIPO: 'CARGA', ESTADO: 'EN_REVISION', USUARIO: 'pruebaxx', TITULAR: 'Neo Test', MONTO_DECLARADO: 5000, OPERADOR: 'xprueba' };
const TOMADA_RETIRO = { ID: 12, TIPO: 'RETIRO', ESTADO: 'EN_REVISION', USUARIO: 'jugador_retiro', TITULAR: 'Titular Prueba', MONTO_DECLARADO: 50000, OPERADOR: 'lucastradi' };
const PARCIAL = { ID: 13, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', USUARIO: 'jugador_parcial', MONTO_DECLARADO: 500000,
  _pp: { hasProg: true, total: 500000, pagado: 200000, restante: 300000 } };

test('sin nada en proceso, avisa y no abre una caja vacía', () => {
  const c = armarCaja();
  c.abrir();
  assert.equal(c.salida.modales.length, 0);
  assert.match(c.salida.toasts.join(' '), /nada en proceso/);
});

test('una carga tomada aparece con sus acciones: aprobar, ver, rechazar, soltar', () => {
  const c = armarCaja({ window: { _tomadasEnProceso: [TOMADA_CARGA] } });
  c.abrir();
  const { titulo, cuerpo } = c.salida.modales[0];
  assert.match(titulo, /Tomadas · 1/);
  assert.match(cuerpo, /pruebaxx/);
  assert.match(cuerpo, /\$5\.000/);
  assert.match(cuerpo, /cerrarModal\(\);v154pCrearJobSolicitud\(11\)">✓ Aprobar</, 'cierra la caja y abre el cartel para cotejar');
  assert.ok(!/Otro monto/.test(cuerpo), 'el cartel ya deja cambiar el monto');
  assert.match(cuerpo, /v154pRechazarSolicitud\(11\)/);
  assert.match(cuerpo, /v154pSoltarSolicitud\(11\)/);
  assert.match(cuerpo, /v154pDetalleSolicitud\(11,true\)/, '"Ver" abre el cajón, igual que en la lista');
});

test('una CARGA no ofrece pagar por partes; un RETIRO sí', () => {
  const carga = armarCaja({ window: { _tomadasEnProceso: [TOMADA_CARGA] } });
  carga.abrir();
  assert.ok(!/v154pRegistrarParcial/.test(carga.salida.modales[0].cuerpo), 'una carga no se paga por partes');
  const retiro = armarCaja({ window: { _tomadasEnProceso: [TOMADA_RETIRO] } });
  retiro.abrir();
  assert.match(retiro.salida.modales[0].cuerpo, /v154pRegistrarParcial\(12\)/);
});

test('dice quién la tiene, para que dos operadores no trabajen la misma', () => {
  const c = armarCaja({ window: { _tomadasEnProceso: [TOMADA_CARGA, TOMADA_RETIRO] } });
  c.abrir();
  const cuerpo = c.salida.modales[0].cuerpo;
  assert.match(cuerpo, /La tomaste vos/, 'la de xprueba, que es quien mira');
  assert.match(cuerpo, /La tiene <b>lucastradi<\/b>/, 'la del otro operador');
});

test('en un retiro tomado se ven las fichas, si ya se leyeron', () => {
  const c = armarCaja({ window: {
    _tomadasEnProceso: [TOMADA_RETIRO],
    _retiroSaldoCheck: { jugador_retiro: { saldo: 12000, raw: 'ARS 12,000.00', confiable: true, ts: Date.now() } }
  } });
  c.abrir();
  assert.match(c.salida.modales[0].cuerpo, /fichas ARS 12,000\.00 ⚠ no alcanza/);
});

test('una lectura dudosa de fichas no se muestra', () => {
  const c = armarCaja({ window: {
    _tomadasEnProceso: [TOMADA_RETIRO],
    _retiroSaldoCheck: { jugador_retiro: { saldo: 0, raw: '', confiable: false, ts: Date.now() } }
  } });
  c.abrir();
  assert.ok(!/fichas ARS/.test(c.salida.modales[0].cuerpo));
  assert.ok(!/no alcanza/.test(c.salida.modales[0].cuerpo));
});

test('sólo parciales: la caja queda como era (título, falta $X, Pagar más, Cerrar)', () => {
  const c = armarCaja({ window: { _parcialesEnProceso: [PARCIAL] } });
  c.abrir();
  const { titulo, cuerpo } = c.salida.modales[0];
  assert.match(titulo, /Retiros pagándose por partes · 1/);
  assert.match(cuerpo, /falta \$300\.000/);
  assert.match(cuerpo, /\$200\.000 de \$500\.000/);
  assert.match(cuerpo, /Pagar más/);
  assert.match(cuerpo, /cerrarRetiroSaldado\(13\)/);
});

test('con las dos clases: título único y una sección para cada una', () => {
  const c = armarCaja({ window: { _tomadasEnProceso: [TOMADA_CARGA], _parcialesEnProceso: [PARCIAL] } });
  c.abrir();
  const { titulo, cuerpo } = c.salida.modales[0];
  assert.match(titulo, /En proceso · 2/);
  assert.match(cuerpo, /Tomadas · esperando que las termines · 1/);
  assert.match(cuerpo, /Pagándose por partes · 1/);
  assert.ok(cuerpo.indexOf('Tomadas') < cuerpo.indexOf('Pagándose por partes'), 'lo que espera una decisión va arriba');
});

test('los nombres se escapan: un usuario no puede meter HTML en la caja', () => {
  const c = armarCaja({ window: { _tomadasEnProceso: [Object.assign({}, TOMADA_CARGA, { USUARIO: '<img src=x onerror=alert(1)>' })] } });
  c.abrir();
  assert.ok(!/<img src=x/.test(c.salida.modales[0].cuerpo));
  assert.match(c.salida.modales[0].cuerpo, /&lt;img/);
});

// ═══ Tomar y Soltar ═════════════════════════════════════════════════════════════════════════
const PUENTE = fs.readFileSync(path.join(RAIZ, 'extensions', 'portal-bridge.js'), 'utf8');
function armarPuente(respuesta) {
  const i = PUENTE.indexOf('function _estadoLocal(id, estado){');
  const j = PUENTE.indexOf('window.v154pDetalleSolicitud = operationModal.abrirExpedienteSolicitud;', i);
  assert.notEqual(i, -1, 'no está _estadoLocal');
  assert.notEqual(j, -1);
  const reg = { llamadas: [], toasts: [], repintados: 0, expedienteCerrado: 0 };
  const solicitud = { ID: 77, TIPO: 'CARGA', ESTADO: 'PENDIENTE', USUARIO: 'pepito' };
  const V154P = { solicitudes: [solicitud] };
  const window = { operador: { usuario: 'xprueba' }, cerrarExpedienteSolicitud: () => { reg.expedienteCerrado++; } };
  const ctx = {
    window, V154P, Number, Promise,
    requests: { actualizarSolicitudPortal: async (id, estado, meta) => { reg.llamadas.push({ id, estado, meta }); return respuesta; } },
    requestsView: { renderSolicitudesPortalEnInicio: () => { reg.repintados++; } },
    deps: { toast: (m, c) => reg.toasts.push({ m, c }) }
  };
  vm.createContext(ctx);
  vm.runInContext(PUENTE.slice(i, j), ctx);
  return { ctx, reg, solicitud, window };
}

test('Tomar marca la solicitud al instante y avisa adónde fue', async () => {
  const p = armarPuente({ data: {} });
  await p.window.v154pTomarSolicitud(77);
  assert.deepEqual(p.reg.llamadas.map((x) => [x.id, x.estado]), [[77, 'EN_REVISION']]);
  assert.equal(p.solicitud.ESTADO, 'EN_REVISION', 'no espera al próximo refresco para moverse');
  assert.equal(p.solicitud.OPERADOR, 'xprueba', 'y queda dicho quién la tiene');
  assert.equal(p.reg.repintados, 1);
  assert.match(p.reg.toasts[0].m, /En proceso/, 'si la tarjeta desaparece sin decir nada, parece que algo se rompió');
});

test('si la base rechaza Tomar, la solicitud NO cambia de lugar', async () => {
  const p = armarPuente({ error: { message: 'sin permiso' } });
  await p.window.v154pTomarSolicitud(77);
  assert.equal(p.solicitud.ESTADO, 'PENDIENTE');
  assert.equal(p.reg.toasts.length, 0, 'no se festeja lo que no pasó');
  assert.equal(p.reg.repintados, 0);
});

test('Soltar la devuelve a pendientes, cierra el expediente y no deja a nadie como dueño', async () => {
  const p = armarPuente({ data: {} });
  p.solicitud.ESTADO = 'EN_REVISION'; p.solicitud.OPERADOR = 'lucastradi';
  await p.window.v154pSoltarSolicitud(77);
  assert.deepEqual(p.reg.llamadas.map((x) => [x.id, x.estado]), [[77, 'PENDIENTE']]);
  assert.equal(p.solicitud.ESTADO, 'PENDIENTE');
  assert.equal(p.solicitud.OPERADOR, 'lucastradi', 'no se la pone a nombre de quien la soltó');
  assert.equal(p.reg.expedienteCerrado, 1);
  assert.match(p.reg.toasts[0].m, /pendientes/);
});

test('si la base rechaza Soltar, sigue tomada', async () => {
  const p = armarPuente({ error: { message: 'no' } });
  p.solicitud.ESTADO = 'EN_REVISION';
  await p.window.v154pSoltarSolicitud(77);
  assert.equal(p.solicitud.ESTADO, 'EN_REVISION');
});
