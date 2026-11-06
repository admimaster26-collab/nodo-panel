const test = require('node:test');
const assert = require('node:assert/strict');
const modulo = require('../renderer/portal/withdrawal-instrument');

// Compuerta de NODO antes de sacar fichas de un retiro del Portal: la cuenta de cobro se valida por
// DNI una vez. Se corre el módulo real con el servidor y la pantalla reemplazados por registros.

function armar(respuestas) {
  const llamadas = [], rechazos = [], avisos = [], salud = [];
  const elementos = new Map();
  function elemento(id) {
    const e = { id, value: '', disabled: false, textContent: '', style: {}, onclick: null, onkeydown: null,
      focus() {}, select() {}, remove() { for (const k of [...elementos.keys()]) if (e.hijos && e.hijos.includes(k) || k === e.id) elementos.delete(k); } };
    return e;
  }
  const document = {
    body: { appendChild(e) { elementos.set(e.id, e); } },
    createElement() {
      const e = elemento('');
      Object.defineProperty(e, 'innerHTML', { set(html) { e._html = html; e.hijos = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
        e.hijos.forEach(id => elementos.set(id, elemento(id))); }, get() { return e._html; } });
      return e;
    },
    getElementById: id => elementos.get(id) || null
  };
  const window = {
    PANEL_DATA_SECRET: 's', confirm: () => true,
    actualizarSolicitudPortal: async (id, estado, extra) => { rechazos.push({ id, estado, extra }); return {}; },
    avisarJugadorEnChat: async (u, t) => { avisos.push({ u, t }); },
    NodoSalud: { begin: () => ({ record: (stage, state, code) => salud.push(code) }) }
  };
  const cola = respuestas.slice();
  const supabaseClient = { rpc: async (fn, params) => { llamadas.push({ fn, params }); const r = cola.shift(); if (r instanceof Error) throw r; return r; } };
  const { globals } = modulo.create({ supabaseClient, operador: { usuario: 'juancarlos' }, document, window, toast() {}, registrarEnHistorial: async () => ({}) });
  const overlay = () => elementos.get('nodoCuentaCobroOverlay') || [...elementos.values()].find(e => e._html);
  return { gate: globals.nodoRetiroCuentaValidada, llamadas, rechazos, avisos, salud, elementos, overlay, window };
}
const estado = (e, extra = {}) => ({ data: Object.assign({ ok: true, estado: e, destino: 'alias.demo.mp', titular: 'Fulano Demo', otras_validadas: [] }, extra) });
const tick = () => new Promise(r => setImmediate(r));

test('cuenta validada o sin declarar: sigue sin preguntar nada', async () => {
  for (const e of ['VALIDADO', 'SIN_DECLARAR']) {
    const h = armar([estado(e)]);
    assert.deepEqual(await h.gate(10, { usuario: 'pruebaxx' }), { seguir: true, estado: e });
    assert.equal(h.elementos.size, 0, 'no abre nada');
  }
});

test('servidor sin la función: sigue; servidor caído: decide el operador', async () => {
  const sinFn = armar([{ error: { code: 'PGRST202', message: 'x' } }]);
  assert.equal((await sinFn.gate(10, { usuario: 'p' })).seguir, true);
  const caido = armar([{ error: { code: 'NETWORK', message: 'x' } }]);
  caido.window.confirm = () => false;
  assert.equal((await caido.gate(10, { usuario: 'p' })).seguir, false);
  assert.ok(caido.salud.includes('CUENTA_COBRO_NO_LEIDA'));
});

test('pendiente: el operador escribe el CUIT de Mercado Pago y, si coincide, sigue', async () => {
  const h = armar([estado('PENDIENTE'), { data: { ok: true, estado: 'VALIDADO' } }]);
  const p = h.gate(10, { usuario: 'pruebaxx', monto: 15000 });
  await tick();
  const html = h.overlay()._html;
  assert.match(html, /alias\.demo\.mp/); assert.match(html, /Fulano Demo/); assert.match(html, /CUIT\/CUIL del titular/);
  h.elementos.get('nodoCuentaDni').value = '20-38495012-4';
  await h.elementos.get('nodoCuentaValidar').onclick.call(h.elementos.get('nodoCuentaValidar'));
  assert.deepEqual(await p, { seguir: true, estado: 'VALIDADO' });
  const v = h.llamadas.find(c => c.fn === 'panel_retiro_instrumento_validar');
  assert.equal(v.params.p_dni_banco, '20384950124'); assert.equal(v.params.p_operador, 'juancarlos');
  assert.equal(h.rechazos.length, 0);
});

test('no coincide dos veces: no se paga, se rechaza la solicitud y se le avisa al jugador', async () => {
  const h = armar([estado('PENDIENTE'), { data: { ok: false, motivo: 'NO_COINCIDE', intentos_restantes: 1 } }, { data: { ok: false, motivo: 'RECHAZADO' } }]);
  const p = h.gate(10, { usuario: 'pruebaxx', monto: 15000 });
  await tick();
  const btn = h.elementos.get('nodoCuentaValidar');
  h.elementos.get('nodoCuentaDni').value = '38495013';
  await btn.onclick.call(btn);
  assert.match(h.elementos.get('nodoCuentaMsg').textContent, /No coincide/);
  h.elementos.get('nodoCuentaDni').value = '22323877';
  await btn.onclick.call(btn);
  assert.deepEqual(await p, { seguir: false, estado: 'RECHAZADO', cerrar: true });
  assert.equal(h.rechazos[0].estado, 'RECHAZADA');
  assert.equal(h.rechazos[0].extra.motivo_rechazo, 'DNI_NO_COINCIDE');
  assert.match(h.avisos[0].t, /no coincide con el titular/);
  assert.match(h.avisos[0].t, /No se descontó nada/);
});

test('el operador rechaza directo cuando el titular en Mercado Pago es otra persona', async () => {
  const h = armar([estado('PENDIENTE'), { data: { ok: true, estado: 'RECHAZADO' } }]);
  const p = h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  await h.elementos.get('nodoCuentaRechazar').onclick();
  assert.equal((await p).seguir, false);
  assert.ok(h.llamadas.some(c => c.fn === 'panel_retiro_instrumento_rechazar'));
  assert.equal(h.rechazos[0].extra.etapa, 'RETIRO_DNI_NO_COINCIDE');
});

test('"Ahora no" no paga ni rechaza', async () => {
  const h = armar([estado('PENDIENTE')]);
  const p = h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  h.elementos.get('nodoCuentaCancelar').onclick();
  assert.deepEqual(await p, { seguir: false, estado: 'PENDIENTE' });
  assert.equal(h.rechazos.length, 0);
});

test('hora exacta con segundos', () => {
  assert.match(modulo.horaExacta(new Date('2026-11-06T17:32:05Z')), /^14:32:05$/);
});
