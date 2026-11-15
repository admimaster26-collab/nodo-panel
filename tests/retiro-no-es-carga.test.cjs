const test = require('node:test');
const assert = require('node:assert/strict');
const rejections = require('../renderer/portal/rejections');

// Un retiro no es una carga (docs/FLUJOS.md). Juan, 8/11: "como mierda podemos hacer para que te queden
// claras estas cosas del flujo de trabajo". El rechazo de un retiro ofrecía "✅ Ya se la cargué" (lo
// cerraba ACREDITADO y le decía al jugador "Tu carga ya está acreditada"), motivos de transferencia y
// comprobante, y textos de "la cuenta desde la que transferís".

function armar() {
  const modales = [], avisos = [];
  const solicitudes = [
    { ID: 1, TIPO: 'RETIRO', USUARIO: 'pruebaxx', TITULAR: 'Fulano Demo', ESTADO: 'PENDIENTE', MONTO_DECLARADO: 20000 },
    { ID: 2, TIPO: 'CARGA', USUARIO: 'pruebaxx', TITULAR: 'Fulano Demo', ESTADO: 'PENDIENTE', MONTO_DECLARADO: 5000 }
  ];
  const api = rejections.create({ // las funciones que usa NODO vienen en .globals
    V154P: { solicitudes },
    abrirModal: (titulo, html) => modales.push({ titulo, html }),
    toast: (m) => avisos.push(m),
    escapeHtml: (v) => String(v == null ? '' : v),
    document: { getElementById: () => null },
    window: { titularYaRechazado: () => false, esDatoPropioBilletera: () => null, _normNombre: (v) => String(v || '').toLowerCase() },
    actualizarSolicitudPortal: async () => ({}), notificarUsuarioEnChat: async () => {}, cargarSolicitudesPortal: async () => {},
    cerrarModal() {}, alert() {}, localStorage: { getItem: () => null, setItem() {} }, registrarEnHistorial: async () => ({})
  }).globals;
  return { api, modales, avisos };
}

test('rechazar un retiro: sin "Ya se la cargué" y con motivos de retiro, no de transferencia', () => {
  const h = armar();
  h.api.v154pRechazarSolicitud(1);
  const html = h.modales[0].html;
  assert.doesNotMatch(html, /Ya se la cargué/);
  assert.doesNotMatch(html, /transferencia|comprobante/i, 'el retiro no tiene transferencia ni comprobante del jugador');
  assert.match(html, /fichas/); assert.match(html, /cuenta donde cobrás/);
});

test('rechazar una carga: sigue igual (con "Ya se la cargué" y motivos de transferencia)', () => {
  const h = armar();
  h.api.v154pRechazarSolicitud(2);
  const html = h.modales[0].html;
  assert.match(html, /Ya se la cargué/);
  assert.match(html, /No nos llegó tu transferencia/);
});

test('"Ya se la cargué" con un retiro no hace nada y lo explica', () => {
  const h = armar();
  h.api.v154pYaCargada(1);
  assert.equal(h.modales.length, 0, 'no abre el cierre como acreditada');
  assert.match(h.avisos.join(' '), /sólo para cargas/);
  h.api.v154pYaCargada(2);
  assert.equal(h.modales.length, 1, 'en una carga sí');
});

test('rechazo automático: en un retiro habla de la cuenta donde cobra; en una carga, de la que transfirió', () => {
  const h = armar();
  const r = h.api._portalMotivoRechazo({ TIPO: 'RETIRO', ESTADO: 'PENDIENTE', TITULAR: '12345', USUARIO: 'pruebaxx' });
  assert.match(r.texto, /cuenta donde cobrás/); assert.doesNotMatch(r.texto, /transfer/);
  const c = h.api._portalMotivoRechazo({ TIPO: 'CARGA', ESTADO: 'PENDIENTE', TITULAR: '12345', USUARIO: 'pruebaxx' });
  assert.match(c.texto, /desde la que transferís/);
});
