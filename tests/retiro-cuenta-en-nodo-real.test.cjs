const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// La ventana del DNI cargada COMO LA CARGA NODO: el módulo se monta solo en la página, y la conexión al
// servidor y el operador son `const`/`let` del script principal (se ven por su nombre, pero no están en
// window). Juan, 8/11, primer retiro real con DNI: el módulo los buscaba sólo en window, no consultaba
// nunca al servidor y salía "No se pudo comprobar la cuenta de cobro… ¿Continuar igual?", que deja pagar
// sin validar. Las otras pruebas pasaban porque le daban la conexión a mano.

const MODULO = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'portal', 'withdrawal-instrument.js'), 'utf8');

function armarNodo(respuestas) {
  const llamadas = [];
  const elementos = new Map();
  const elemento = (id) => ({ id, value: '', disabled: false, checked: false, textContent: '', style: {}, focus() {}, select() {}, remove() { elementos.delete(id); } });
  const ctx = {
    console, Promise, setTimeout, clearTimeout, JSON, Date, Math, Number, String, Object, Array,
    PANEL_DATA_SECRET: 's', confirm: () => { throw new Error('no tiene que preguntar si continuar sin comprobar'); },
    toast() {},
    document: {
      body: { appendChild(e) { elementos.set(e.id, e); } },
      createElement() {
        const e = elemento('');
        Object.defineProperty(e, 'innerHTML', { set(html) { e._html = html; [...html.matchAll(/id="([^"]+)"/g)].forEach((m) => elementos.set(m[1], elemento(m[1]))); }, get() { return e._html; } });
        return e;
      },
      getElementById: (id) => elementos.get(id) || null
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ctx.__respuestas = respuestas.slice();
  ctx.__llamadas = llamadas;
  // Como en renderer/core/configuracion-y-estado.js y el login: declarados con const/let, NO en window.
  vm.runInContext(`
    const supabaseClient = { rpc: async (fn, params) => { __llamadas.push({ fn, params }); return __respuestas.shift(); } };
    let operador = { usuario: 'juancarlos' };
  `, ctx);
  vm.runInContext(MODULO, ctx); // se monta solo, igual que en el panel armado
  assert.equal(ctx.supabaseClient, undefined, 'la conexión NO está en window, como en NODO');
  return { ctx, llamadas, elementos };
}
const tick = () => new Promise((r) => setImmediate(r));

test('en NODO real la ventana encuentra la conexión al servidor y consulta (no pregunta "¿continuar igual?")', async () => {
  const h = armarNodo([{ data: { ok: true, estado: 'VALIDADO' } }]);
  const r = await h.ctx.nodoRetiroCuentaValidada(457415, { usuario: 'pruebaxx' });
  assert.equal(r.seguir, true); assert.equal(r.estado, 'VALIDADO');
  assert.equal(h.llamadas[0].fn, 'panel_retiro_instrumento');
  assert.equal(h.llamadas[0].params.p_secret, 's');
});

test('en NODO real la validación queda a nombre del operador, no de "panel"', async () => {
  const h = armarNodo([{ data: { ok: true, estado: 'PENDIENTE', destino: 'alias.demo.mp', titular: 'Fulano Demo' } }, { data: { ok: true, estado: 'VALIDADO' } }]);
  const p = h.ctx.nodoRetiroCuentaValidada(457415, { usuario: 'pruebaxx' });
  await tick();
  h.elementos.get('nodoCuentaDni').value = '20-38495012-5';
  const btn = h.elementos.get('nodoCuentaValidar');
  await btn.onclick.call(btn);
  const r = await p;
  assert.equal(r.seguir, true); assert.equal(r.estado, 'VALIDADO');
  assert.equal(h.llamadas[1].fn, 'panel_retiro_instrumento_validar');
  assert.equal(h.llamadas[1].params.p_operador, 'juancarlos');
});
