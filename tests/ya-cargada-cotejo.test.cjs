const test = require('node:test');
const assert = require('node:assert/strict');
const modulo = require('../renderer/portal/rejections');

// Juan, 18/11: "las cargas rechazadas y marcadas como aprobadas para el usuario desaparecen del historial".
// "Marcar como ya cargada" cerraba el pedido como acreditado sin dejar ninguna fila en el historial de NODO
// (9 de 12 en los últimos días). Ahora, antes de cerrar, se busca la carga en el historial de NODO y en
// "Movimientos de crédito" de AdminOnline, y al cerrar se ata la que se encontró o se anota una fila.

const PEDIDO = { ID: 900, TIPO: 'CARGA', USUARIO: 'jugador1', MONTO_DECLARADO: 5000, FECHA_CREACION: new Date(Date.now() - 3600000).toISOString() };

function armar({ historial = [], adminonline = { ok: true, filas: [], completo: true }, sinEscritorio = false } = {}) {
  const r = { updates: [], filas: [], cierres: [], avisos: [], modal: null, toasts: [] };
  const caja = { innerHTML: '' };
  const consulta = () => {
    const q = { select: () => q, ilike: () => q, eq: () => q, gte: () => q, order: () => q, limit: async () => ({ data: historial, error: null }) };
    return q;
  };
  const deps = {
    V154P: { solicitudes: [PEDIDO] },
    escapeHtml: (s) => String(s == null ? '' : s),
    toast: (t) => r.toasts.push(t),
    abrirModal: (titulo, cuerpo, guardar) => { r.modal = { titulo, cuerpo, guardar }; },
    cerrarModal: () => {},
    actualizarSolicitudPortal: async (id, estado, extra) => { r.cierres.push({ id, estado, extra }); },
    registrarEnHistorial: async (fila) => { r.filas.push(fila); },
    callDrex: async (metodo) => { assert.equal(metodo, 'leerMovimientosCredito'); return adminonline; },
    supabaseClient: { from: () => ({ ...consulta(), update: (v) => ({ eq: async (_c, id) => { r.updates.push({ id, ...v }); return {}; } }) }) },
    document: { getElementById: (id) => (id === 'v154pYaCargCotejo' ? caja : (id === 'v154pYaCargObs' ? { value: '' } : null)) },
    window: { ctrlElectron: sinEscritorio ? undefined : {}, operador: { usuario: 'op1' }, avisarJugadorEnChat: async () => ({ ok: true }) }
  };
  const api = modulo.create(deps);
  const servicio = Object.assign({}, api, api.globals || {});
  return { r, caja, abrir: () => (servicio.v154pYaCargada || api.v154pYaCargada)(900) };
}
const espera = () => new Promise((res) => setTimeout(res, 20));

test('la carga hecha a mano (sin pedido) se encuentra y se ata a este pedido', async () => {
  const h = armar({ historial: [{ id: 71, monto: 5000, created_at: new Date().toISOString(), solicitud_id: null }] });
  h.abrir(); await espera();
  assert.match(h.caja.innerHTML, /Historial de NODO: cargada \$5\.000/);
  await h.r.modal.guardar();
  assert.equal(h.r.cierres[0].estado, 'ACREDITADA');
  assert.deepEqual(h.r.updates, [{ id: 71, solicitud_id: 900 }], 'queda atada: ya no desaparece del historial');
  assert.equal(h.r.filas.length, 0, 'no se anota otra carga');
});

test('si esa carga ya era de otro pedido, es un pedido repetido: no se suma nada', async () => {
  const h = armar({ historial: [{ id: 72, monto: 5000, created_at: new Date().toISOString(), solicitud_id: 899 }] });
  h.abrir(); await espera();
  assert.match(h.caja.innerHTML, /Pedido repetido: esa carga ya se hizo con el pedido #899/);
  await h.r.modal.guardar();
  assert.equal(h.r.filas.length, 0); assert.equal(h.r.updates.length, 0);
});

test('cargada por fuera de NODO y confirmada en AdminOnline: se anota en el historial como hecha', async () => {
  const h = armar({ adminonline: { ok: true, completo: true, filas: [
    { fecha: '18/11/2026 07:43:01', tipo: 'Deposito de un jugador', estado: 'DONE', cantidad: -5000, alias: 'jugador1' },
    { fecha: '18/11/2026 07:50:10', tipo: 'Deposito de un jugador', estado: 'DONE', cantidad: 5000, alias: 'jugador1' }] } });
  h.abrir(); await espera();
  assert.match(h.caja.innerHTML, /AdminOnline: \$5\.000 a jugador1 el 18\/11\/2026 07:50:10/, 'un retiro del mismo monto (negativo) no cuenta');
  await h.r.modal.guardar();
  assert.equal(h.r.filas.length, 1);
  assert.equal(h.r.filas[0].estado, 'OK'); assert.equal(h.r.filas[0].origen, 'YA_CARGADA'); assert.equal(h.r.filas[0].solicitud_id, 900);
});

test('sin rastro en ningún lado: se avisa y queda en el historial "sin comprobar"', async () => {
  const h = armar();
  h.abrir(); await espera();
  assert.match(h.caja.innerHTML, /No encontré la carga en ningún lado/);
  await h.r.modal.guardar();
  assert.equal(h.r.filas[0].estado, 'SIN_COMPROBAR');
});

test('con muchos movimientos o sin el informe, lo dice en palabras y no inventa', async () => {
  const muchos = armar({ adminonline: { ok: true, completo: false, filas: [] } });
  muchos.abrir(); await espera();
  assert.match(muchos.caja.innerHTML, /no la encontré en las páginas que revisé/);
  const web = armar({ sinEscritorio: true });
  web.abrir(); await espera();
  assert.match(web.caja.innerHTML, /sólo se revisa desde la aplicación de escritorio/);
});
