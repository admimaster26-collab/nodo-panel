const test = require('node:test');
const assert = require('node:assert/strict');
const modulo = require('../renderer/portal/rejections');

// Juan, 18/11: "las cargas rechazadas y marcadas como aprobadas para el usuario desaparecen del historial".
// "Marcar como ya cargada" cerraba el pedido como acreditado sin dejar ninguna fila en el historial de NODO
// (9 de 12 en los últimos días). Criterio de Juan: simple — mismo usuario, mismo monto, mismo horario; la hora
// con segundos es la identidad del movimiento (no tienen id). Ante la duda no se ata nada: "no se pudo extraer
// más información" y queda "sin comprobar" (se ve, no suma).

const PEDIDO = { ID: 900, TIPO: 'CARGA', USUARIO: 'jugador1', MONTO_DECLARADO: 5000, FECHA_CREACION: '2026-11-18T10:00:00Z' };
const AR = (iso) => { const d = new Date(Date.parse(iso) - 3 * 3600000); const p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()); };
const mov = (iso, cantidad = 5000, alias = 'jugador1') => ({ fecha: AR(iso), ms: Date.parse(iso), tipo: 'Deposito de un jugador', estado: 'DONE', cantidad, alias });
const fila = (id, iso, extra = {}) => ({ id, created_at: iso, monto: 5000, estado: 'OK', solicitud_id: null, notas: '', ...extra });

function armar({ historial = [], adminonline = { ok: true, filas: [], completo: true }, sinEscritorio = false } = {}) {
  const r = { updates: [], filas: [], cierres: [], modal: null, toasts: [] };
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
    registrarEnHistorial: async (f) => { r.filas.push(f); },
    callDrex: async (metodo) => { assert.equal(metodo, 'leerMovimientosCredito'); if (adminonline instanceof Error) throw adminonline; return adminonline; },
    supabaseClient: { from: () => ({ ...consulta(), update: (v) => ({ eq: async (_c, id) => { r.updates.push({ id, ...v }); return {}; } }) }) },
    document: { getElementById: (id) => (id === 'v154pYaCargCotejo' ? caja : (id === 'v154pYaCargObs' ? { value: '' } : null)) },
    window: { ctrlElectron: sinEscritorio ? undefined : {}, operador: { usuario: 'op1' }, avisarJugadorEnChat: async () => ({ ok: true }) }
  };
  const api = modulo.create(deps);
  const servicio = Object.assign({}, api, api.globals || {});
  return { r, caja, abrir: async () => { (servicio.v154pYaCargada || api.v154pYaCargada)(900); await new Promise((res) => setTimeout(res, 20)); } };
}

test('la carga hecha a mano y la de AdminOnline a la misma hora: comprobada en los dos y se ata al pedido', async () => {
  const h = armar({ historial: [fila(71, '2026-11-18T10:05:12Z')], adminonline: { ok: true, completo: true, filas: [mov('2026-11-18T10:05:10Z')] } });
  await h.abrir();
  assert.match(h.caja.innerHTML, /NODO: cargada \$5\.000/);
  assert.match(h.caja.innerHTML, /AdminOnline: \$5\.000 a jugador1 el 18\/11\/2026 07:05:10 · misma hora que en NODO/);
  await h.r.modal.guardar();
  assert.equal(h.r.cierres[0].extra.cotejo_ya_cargada.decision, 'nodo_y_agentes');
  assert.deepEqual(h.r.updates, [{ id: 71, solicitud_id: 900 }], 'queda atada: ya no desaparece del historial');
  assert.equal(h.r.filas.length, 0, 'no se anota otra carga');
});

test('dos cargas iguales en NODO sin pedido: no se adivina, no se ata ninguna', async () => {
  const h = armar({ historial: [fila(71, '2026-11-18T10:05:12Z'), fila(72, '2026-11-18T10:20:00Z')] });
  await h.abrir();
  assert.match(h.caja.innerHTML, /No se pudo extraer más información: hay 2 cargas iguales en NODO/);
  await h.r.modal.guardar();
  assert.equal(h.r.updates.length, 0);
  assert.equal(h.r.filas[0].estado, 'SIN_COMPROBAR');
});

test('si esa carga ya era de otro pedido, es un pedido repetido: no se suma nada', async () => {
  const h = armar({ historial: [fila(72, '2026-11-18T09:59:00Z', { solicitud_id: 899 })], adminonline: { ok: true, completo: true, filas: [mov('2026-11-18T09:59:01Z')] } });
  await h.abrir();
  assert.match(h.caja.innerHTML, /Pedido repetido: esa carga ya se hizo con el pedido #899/);
  await h.r.modal.guardar();
  assert.equal(h.r.filas.length, 0); assert.equal(h.r.updates.length, 0);
});

test('sólo en AdminOnline: se anota como hecha, con la hora como identidad; un retiro del mismo monto no cuenta', async () => {
  const h = armar({ adminonline: { ok: true, completo: true, filas: [mov('2026-11-18T10:30:00Z', -5000), mov('2026-11-18T10:50:10Z')] } });
  await h.abrir();
  await h.r.modal.guardar();
  assert.equal(h.r.filas.length, 1);
  assert.equal(h.r.filas[0].estado, 'OK'); assert.equal(h.r.filas[0].origen, 'YA_CARGADA');
  assert.match(h.r.filas[0].notas, /AdminOnline 18\/11\/2026 07:50:10/);
});

test('un movimiento de AdminOnline ya usado para cerrar otro pedido no se vuelve a usar', async () => {
  const h = armar({ historial: [fila(80, '2026-11-18T11:00:00Z', { solicitud_id: 850, estado: 'OK', notas: 'Cargada por fuera de NODO · AdminOnline 18/11/2026 07:50:10 · pedido #850' })],
    adminonline: { ok: true, completo: true, filas: [mov('2026-11-18T10:50:10Z')] } });
  await h.abrir();
  assert.match(h.caja.innerHTML, /Ya usadas para cerrar otro pedido: 18\/11\/2026 07:50:10/);
  await h.r.modal.guardar();
  assert.ok(!h.r.filas.some((f) => f.estado === 'OK'), 'no se suma dos veces la misma carga');
});

test('dos cargas iguales en AdminOnline: no se puede saber cuál, queda sin comprobar con las dos horas', async () => {
  const h = armar({ adminonline: { ok: true, completo: true, filas: [mov('2026-11-18T10:10:00Z'), mov('2026-11-18T10:40:00Z')] } });
  await h.abrir();
  assert.match(h.caja.innerHTML, /hay 2 cargas iguales en AdminOnline/);
  await h.r.modal.guardar();
  assert.equal(h.r.filas[0].estado, 'SIN_COMPROBAR');
  assert.match(h.r.filas[0].notas, /07:10:00.*07:40:00/);
});

test('ante un error o sin informe: "no se pudo extraer más información", nunca una carga inventada', async () => {
  for (const caso of [{ adminonline: new Error('se cortó') }, { adminonline: { ok: false, needsLogin: true } }, { sinEscritorio: true }, { adminonline: { ok: true, completo: false, filas: [] } }]) {
    const h = armar(caso);
    await h.abrir();
    assert.match(h.caja.innerHTML, /No se pudo extraer más información/);
    await h.r.modal.guardar();
    assert.equal(h.r.filas[0].estado, 'SIN_COMPROBAR');
  }
  const nada = armar();
  await nada.abrir();
  assert.match(nada.caja.innerHTML, /No está en NODO ni en AdminOnline/);
});
