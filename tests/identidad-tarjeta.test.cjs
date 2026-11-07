const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// La tarjeta de identidad de NODO: busca por usuario Y teléfono, muestra el veredicto del servidor y
// deja decidir al operador. Juan, 6/11: jugador01 perdió su número y la tarjeta dijo "no hay cuenta
// con este usuario"; y "redirigir la información al operador, nunca la identidad del usuario".

const fuente = fs.readFileSync(path.join(__dirname, '../renderer/core/cotejo-alta.js'), 'utf8');

function armar(identidad, extra) {
  const llamadas = [], toasts = [], prompts = [];
  const ctx = {
    console, setTimeout, clearTimeout, Promise, JSON, Date, Object, Array, String, Number, Math,
    escapeHtml: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    toast: (m) => toasts.push(m), prompt: (q, def) => { prompts.push(q); return extra && 'respuesta' in extra ? extra.respuesta : def; },
    confirm: () => { throw new Error('no tiene que volver a preguntar'); },
    pcOperativa: 'P4', operador: { usuario: 'juancarlos' }, localStorage: { getItem: () => null, setItem() {} },
    _jugStoreAll: () => ({}), _historialData: [],
    ensureDrexSession: async () => true, callDrex: async () => ({ exists: true }),
    supabaseClient: { rpc: (fn, p) => ({ then: (ok, mal) => (async () => {
      llamadas.push({ fn, p });
      if (fn === 'panel_identidad_cotejo') return { data: identidad };
      if (fn === 'panel_crm_vinculos_buscar') return { data: p.p_query === 'jugador01' ? [{ usuario: 'jugador01', telefono_canon: '1100000001', estado_vinculo: 'VINCULADO', pc_codigo: 'P4' }] : [] };
      if (fn === 'panel_vincular_usuario_v2') return { data: { ok: true, cambio_telefono: { anterior: '1100000001', nuevo: '1100000002' } } };
      if (fn === 'panel_identidad_decision') return { data: { ok: true } };
      return { data: { ok: true } };
    })().then(ok, mal) }) },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }
  };
  ctx.window = ctx;
  ctx.window.PANEL_DATA_SECRET = 's';
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx);
  return { ctx, llamadas, toasts, prompts };
}

const cambio = {
  ok: true, veredicto: 'CAMBIO_TELEFONO', pc_codigo: 'P4',
  usuario: { usuario: 'jugador01', estado: 'VINCULADO', telefono: '1100000001', desde: '2026-06-24T13:53:36Z', operaciones: 2, ultima_operacion: '2026-10-31T13:03:05Z', tiene_cbu: false },
  telefono: { telefono: '1100000002', dueno: null }, telefonos_anteriores: [], usuarios_anteriores: []
};

test('busca por teléfono Y por usuario, y trae el veredicto del servidor', async () => {
  const h = armar(cambio);
  const r = await h.ctx.altaCotejarDatos('jugador01', '+54 9 1100 00-0002');
  const buscadas = h.llamadas.filter(c => c.fn === 'panel_crm_vinculos_buscar').map(c => c.p.p_query).sort();
  assert.deepEqual(buscadas, ['1100000002', 'jugador01']);
  assert.ok(r.usuario.exacto, 'el usuario aparece aunque el número sea nuevo');
  assert.equal(r.identidad.veredicto, 'CAMBIO_TELEFONO');
});

test('cambio de número: la tarjeta lo dice con los datos y ofrece las tres decisiones', async () => {
  const h = armar(cambio);
  const r = await h.ctx.altaCotejarDatos('jugador01', '1100000002');
  const out = h.ctx._altaCotejoHtml('jugador01', '1100000002', r, '_x', 'declaró el cliente', null);
  assert.match(out.html, /Cambio de número · revisión humana/);
  assert.match(out.html, /existe desde el 24\/06\/26 · 2 operaciones, la última el 31\/10\/26/);
  assert.match(out.html, /registrado es <b[^>]*>1100000001<\/b>.*viene con <b[^>]*>1100000002<\/b>, que no figura en ninguna cuenta/);
  assert.match(out.html, /No se redirecciona automáticamente/);
  for (const d of ['MISMA', 'OTRA', 'PENDIENTE']) assert.match(out.html, new RegExp("altaIdentidadDecidir\\(\\\\x27" + d + "|altaIdentidadDecidir\\('" + d));
  assert.doesNotMatch(out.html, /no hay cuenta con este usuario/);
});

test('usuario antiguo con historia: alerta fuerte, y el vigente es sólo un dato', async () => {
  const h = armar({ ok: true, veredicto: 'USUARIO_REEMPLAZADO', usuario: { usuario: 'jugador02', telefono: '1122334455', operaciones: 7, tiene_cbu: true, vigente: 'jugador03' },
    telefono: { telefono: '1199999999', dueno: null }, telefonos_anteriores: [], usuarios_anteriores: [] });
  const r = await h.ctx.altaCotejarDatos('jugador02', '1199999999');
  const html = h.ctx._altaCotejoHtml('jugador02', '1199999999', r, '_x', '', null).html;
  assert.match(html, /Este usuario es antiguo\. Anteriormente estaba asociado al teléfono <b[^>]*>1122334455/);
  assert.match(html, /Actualmente ese teléfono figura con <b>jugador03<\/b>\. El teléfono de esta consulta es <b[^>]*>1199999999/);
  assert.match(html, /tiene 7 operaciones y cuenta de cobro: decidí vos/);
  assert.match(html, /Es un dato, no se aplica solo/);
  assert.match(html, /🚨/);
});

test('lo ya validado se ve como siempre, sin bloque de identidad', async () => {
  const h = armar(cambio);
  const r = await h.ctx.altaCotejarDatos('jugador01', '1100000002');
  const html = h.ctx._altaCotejoHtml('jugador01', '1100000002', r, '_x', '', { usuario: 'jugador01' }).html;
  assert.doesNotMatch(html, /revisión humana/);
});

test('"es la misma persona" valida con el motivo y no vuelve a preguntar; "sin evidencia" no toca vínculos', async () => {
  const h = armar(cambio, { respuesta: 'perdió el número' });
  const boton = { getAttribute: (k) => ({ 'data-u': 'jugador01', 'data-t': '1100000002', 'data-v': 'CAMBIO_TELEFONO' }[k]) };
  await h.ctx.altaIdentidadDecidir('MISMA', boton);
  const v = h.llamadas.find(c => c.fn === 'panel_vincular_usuario_v2');
  assert.ok(v, 'vincula con la v2');
  assert.equal(v.p.p_motivo, 'perdió el número'); assert.equal(v.p.p_usuario, 'jugador01'); assert.equal(v.p.p_telefono, '1100000002');
  const h2 = armar(cambio);
  await h2.ctx.altaIdentidadDecidir('PENDIENTE', boton);
  assert.ok(!h2.llamadas.some(c => /vincular/.test(c.fn)), 'sin evidencia no vincula');
  const dec = h2.llamadas.find(c => c.fn === 'panel_identidad_decision');
  assert.equal(dec.p.p_decision, 'SIN_EVIDENCIA');
  assert.match(h2.toasts.join(' '), /pendiente, sin acceso/);
});
