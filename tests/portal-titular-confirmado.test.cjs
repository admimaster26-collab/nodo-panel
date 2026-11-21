// Portal: el cuadro "titular" de la carga se rellena con el titular que NODO ya confirmó (Noelia, 21/11).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PORTAL = fs.readFileSync(path.join(__dirname, '..', 'Portal'), 'utf8').replace(/\r\n/g, '\n');
const ini = PORTAL.indexOf('async function _titularConfirmadoRellenar');
const fin = PORTAL.indexOf('\nfunction setMonto', ini);
const fuente = PORTAL.slice(ini, fin);

function armar({ respuesta, valorInicial = '' }) {
  const elementos = { titularCambiar: { style: { display: 'none' } }, titularPie: { innerHTML: '' } };
  const campo = { value: valorInicial, isConnected: true, dataset: {}, classList: { add() {}, remove() {} } };
  const guardados = [];
  const llamadas = [];
  const ctx = {
    state: { usuario: 'jugador1', publicCode: 'rt-abc12', telefono: '1100000001' },
    location: { host: 'vip.ejemplo.com' },
    rpc: async (nombre, args) => { llamadas.push([nombre, args]); return respuesta(); },
    normalize: (d) => d,
    $: (id) => elementos[id] || null,
    _guardarTitularPrevio: (v) => guardados.push(v),
    _titularAviso: () => {},
  };
  vm.runInNewContext(fuente + '\nthis.f=_titularConfirmadoRellenar;', ctx);
  return { f: ctx.f, campo, elementos, guardados, llamadas };
}

test('con titular confirmado: rellena, lo marca, deja "Cambiar" y lo guarda', async () => {
  const h = armar({ respuesta: () => ({ data: { ok: true, titular: 'Juan Perez' } }) });
  await h.f(h.campo);
  assert.equal(h.campo.value, 'Juan Perez');
  assert.equal(h.campo.dataset.previo, 'Juan Perez');
  assert.equal(h.elementos.titularCambiar.style.display, '');
  assert.match(h.elementos.titularPie.innerHTML, /confirmado/);
  assert.deepEqual(h.guardados, ['Juan Perez']);
  assert.equal(h.llamadas[0][0], 'landing_portal_titular_confirmado_v1');
  assert.deepEqual(Object.keys(h.llamadas[0][1]).sort(), ['p_host', 'p_public_code', 'p_telefono', 'p_usuario']);
});

test('si el jugador ya escribió mientras se consultaba, no se pisa', async () => {
  const h = armar({ respuesta: () => { return { data: { ok: true, titular: 'Juan Perez' } }; } });
  const p = h.f(h.campo);
  h.campo.value = 'Maria Gomez';
  await p;
  assert.equal(h.campo.value, 'Maria Gomez');
});

test('sin titular confirmado, con error o sin la función en el servidor: queda como estaba', async () => {
  for (const respuesta of [() => ({ data: { ok: true, titular: null } }), () => ({ error: { message: 'function does not exist' } }),
                           () => { throw new Error('sin red'); }]) {
    const h = armar({ respuesta, valorInicial: 'Lo de antes' });
    await h.f(h.campo);
    assert.equal(h.campo.value, 'Lo de antes');
    assert.deepEqual(h.guardados, []);
  }
});
