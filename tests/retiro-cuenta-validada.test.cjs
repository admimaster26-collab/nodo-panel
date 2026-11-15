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

test('si no se puede comprobar la cuenta, no se paga: ni "continuar igual" ni seguir por falta de la función', async () => {
  const fallas = [
    { error: { code: 'PGRST202', message: 'x' } },
    { error: { code: 'NETWORK', message: 'x' } },
    new Error('se cortó'),
    { data: { ok: false, motivo: 'SOLICITUD_NO_EXISTE' } }
  ];
  for (const falla of fallas) {
    const h = armar([falla]);
    let preguntado = false;
    h.window.confirm = () => { preguntado = true; return true; };
    assert.deepEqual(await h.gate(10, { usuario: 'p' }), { seguir: false, estado: 'ERROR' });
    assert.equal(preguntado, false, 'no ofrece seguir igual');
    assert.ok(h.salud.includes('CUENTA_COBRO_NO_LEIDA'));
  }
});

test('pendiente: el operador escribe el CUIT de Mercado Pago y, si coincide, sigue', async () => {
  const h = armar([estado('PENDIENTE'), { data: { ok: true, estado: 'VALIDADO' } }]);
  const p = h.gate(10, { usuario: 'pruebaxx', monto: 15000 });
  await tick();
  const html = h.overlay()._html;
  assert.match(html, /alias\.demo\.mp/); assert.match(html, /Fulano Demo/); assert.match(html, /DNI del titular según Mercado Pago/);
  assert.doesNotMatch(html, /CUIT|CUIL/, 'Juan: "poné DNI, no usamos el CUIT ni el CUIL"');
  h.elementos.get('nodoCuentaDni').value = '20-38495012-4';
  await h.elementos.get('nodoCuentaValidar').onclick.call(h.elementos.get('nodoCuentaValidar'));
  assert.deepEqual(await p, { seguir: true, estado: 'VALIDADO' });
  const v = h.llamadas.find(c => c.fn === 'panel_retiro_instrumento_validar');
  assert.equal(v.params.p_dni_banco, '38495012', 'un CUIT pegado se manda como DNI'); assert.equal(v.params.p_operador, 'juancarlos');
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

// Juan, 8/11: detectar menores es "sumamente importante". El servidor estima la edad por el número del
// DNI; el operador la tiene que confirmar antes de validar. Al jugador no se le dice nada.
test('edad que no coincide con el DNI: aviso en rojo y no se valida sin tildar que es mayor', async () => {
  const h = armar([estado('PENDIENTE', { alertas: ['EDAD_NO_COINCIDE'], edad_declarada: 23, edad_min: 12, edad_max: 18, anio_estimado: 2011 }), { data: { ok: true, estado: 'VALIDADO' } }]);
  const p = h.gate(10, { usuario: 'pruebaxx', monto: 15000 });
  await tick();
  const html = h.overlay()._html;
  assert.match(html, /Revisá antes de validar/);
  assert.match(html, /Dijo que tiene 23 años, y un DNI con ese número suele ser de alguien de entre 12 y 18\. Puede pasar si sacó el DNI de grande/);
  assert.match(html, /Lo revisé: es mayor de 18 años/);
  assert.doesNotMatch(html, /mint|miente|falso/i, 'no acusa: puede ser alguien legítimo');
  const btn = h.elementos.get('nodoCuentaValidar'), casilla = h.elementos.get('nodoCuentaEdadOk');
  // Atenuado pero NO deshabilitado: un botón deshabilitado no recibe el clic y el aviso nunca aparecía.
  assert.equal(btn.disabled, false, 'responde al clic'); assert.equal(btn.style.opacity, '.45', 'se ve atenuado');
  h.elementos.get('nodoCuentaDni').value = '48000001';
  await btn.onclick.call(btn);
  assert.ok(!h.llamadas.some(c => c.fn === 'panel_retiro_instrumento_validar'), 'sin tildar no valida');
  assert.match(h.elementos.get('nodoCuentaMsg').textContent, /Primero tildá .*mayor de 18/);
  casilla.checked = true; casilla.onchange();
  assert.equal(btn.style.opacity, '');
  await btn.onclick.call(btn);
  assert.deepEqual(await p, { seguir: true, estado: 'VALIDADO' });
});

test('edad que coincide: aviso en amarillo con lo declarado y el rango', async () => {
  const h = armar([estado('PENDIENTE', { alertas: ['EDAD_COINCIDE'], edad_declarada: 18, edad_min: 12, edad_max: 18 })]);
  h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  assert.match(h.overlay()._html, /Revisá la edad/);
  assert.match(h.overlay()._html, /Dijo que tiene 18 años; por el número del DNI tendría entre 12 y 18/);
  assert.equal(h.elementos.get('nodoCuentaValidar').style.opacity, '.45');
});

test('varios avisos juntos: cada uno en su línea, en rojo, sin acusar', async () => {
  const h = armar([estado('PENDIENTE', { alertas: ['EDAD_COINCIDE', 'EDAD_CAMBIO', 'YA_RECHAZADO'], edad_declarada: 18, edad_previa: 16, edad_min: 12, edad_max: 18 })]);
  h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  const html = h.overlay()._html;
  assert.match(html, /Antes dijo que tenía 16 años \(y no lo dejamos retirar\)\. Ahora dice 18/);
  assert.match(html, /ya se rechazó antes para este jugador/);
  assert.match(html, /Revisá antes de validar/);
  assert.doesNotMatch(html, /mint|miente|falso/i);
});

test('sin aviso de edad, la ventana es la de siempre (sin casilla)', async () => {
  const h = armar([estado('PENDIENTE')]);
  h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  assert.doesNotMatch(h.overlay()._html, /mayor de 18|menor de edad/);
  assert.equal(h.elementos.get('nodoCuentaValidar').disabled, false);
});

test('CUIT mal tipeado: lo dice, no gasta intento y la ventana sigue abierta', async () => {
  const h = armar([estado('PENDIENTE'), { data: { ok: false, motivo: 'CUIT_INVALIDO' } }]);
  h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  const btn = h.elementos.get('nodoCuentaValidar');
  h.elementos.get('nodoCuentaDni').value = '20-38495012-4';
  await btn.onclick.call(btn);
  assert.match(h.elementos.get('nodoCuentaMsg').textContent, /no es válido.*No se gastó ningún intento/);
  assert.equal(h.rechazos.length, 0);
  assert.ok(h.elementos.get('nodoCuentaValidar'), 'sigue abierta');
});

test('el campo es de DNI: un CUIT pegado queda como el DNI del medio, y se corta a 8 números', async () => {
  const h = armar([estado('PENDIENTE')]);
  h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  const campo = h.elementos.get('nodoCuentaDni');
  campo.value = '20-38495012-5'; campo.oninput();
  assert.equal(campo.value, '38495012');
  campo.value = '384950129999'; campo.oninput();
  assert.equal(campo.value, '38495012');
  campo.value = '5.123.456'; campo.oninput();
  assert.equal(campo.value, '5123456', 'DNI de 7 números');
});

test('botón Copiar: copia la cuenta para pegarla en Mercado Pago', async () => {
  const h = armar([estado('PENDIENTE')]);
  const copiadas = [];
  h.window.nodoCopiar = async (t) => { copiadas.push(t); return true; };
  h.gate(10, { usuario: 'pruebaxx' });
  await tick();
  assert.match(h.overlay()._html, /📋 Copiar/);
  await h.elementos.get('nodoCuentaCopiar').onclick();
  assert.deepEqual(copiadas, ['alias.demo.mp']);
  assert.match(h.elementos.get('nodoCuentaMsg').textContent, /Cuenta copiada/);
});
