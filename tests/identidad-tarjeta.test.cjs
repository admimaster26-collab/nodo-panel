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
    // SIN prompt: en Electron no existe. Si alguien lo vuelve a usar, la prueba revienta igual que NODO.
    toast: (m) => toasts.push(m),
    nodoPedirTexto: async (o) => { prompts.push(o.titulo); return extra && 'respuesta' in extra ? extra.respuesta : o.valor; },
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

// Juan, 8/11, con la captura de "Número de otro usuario": la tarjeta nueva reemplazaba a la vieja y el
// operador dejó de ver lo que veía en la 2.1.5. Las dos van juntas: nada de lo viejo se pierde.
test('número de otro usuario: la tarjeta de siempre completa, con la revisión adentro', () => {
  const h = armar(null);
  const r = {
    usuario: { exacto: { usuario: 'pruebaxx', telefonos: [], vinculo: 'VINCULADO', pc: 'P4' }, similares: [] },
    telefono: { exacto: { usuario: 'jugador07', telefonos: ['1100000009'], vinculo: 'VINCULADO', pc: 'P2' },
                similares: [], otros: [{ usuario: 'jugador07', pc: 'P2', vinculo: 'VINCULADO' }], varios: false },
    identidad: { ok: true, veredicto: 'TELEFONO_DE_OTRO', usuario: { usuario: 'pruebaxx', telefono: null, operaciones: 0 },
                 telefono: { telefono: '1100000009', dueno: { usuario: 'jugador07', operaciones: 8, ultima_operacion: '2026-08-07T15:00:00Z' } },
                 telefonos_anteriores: [], usuarios_anteriores: [] }
  };
  const html = h.ctx._altaCotejoHtml('pruebaxx', '1100000009', r, '_altaAbrirVincular', 'declaró el cliente', null).html;
  const texto = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  // Lo de la 2.1.5:
  assert.match(texto, /Usuario pruebaxx ✓ en sistema/);
  assert.match(texto, /No ve el CBU hasta que lo valides/);
  assert.match(texto, /sin teléfono registrado/);
  assert.match(texto, /Teléfono 1100000009 ⚠ es de jugador07 · oficina P2/);
  assert.match(texto, /Está tomado en OTRA oficina/);
  assert.match(texto, /usar jugador07/);
  assert.match(texto, /pruebaxx y el teléfono de jugador07 son personas distintas/);
  assert.match(texto, /seguir con pruebaxx/); assert.match(texto, /seguir con jugador07/);
  // Lo nuevo, adentro de la misma tarjeta:
  assert.match(texto, /Número de otro usuario · revisión humana/);
  assert.match(texto, /pruebaxx no tiene teléfono registrado · sin operaciones/);
  assert.match(texto, /hoy figura con jugador07 · 8 operaciones, la última el 07\/08\/26/);
  assert.doesNotMatch(texto, /teléfono — /, 'sin el guion suelto de "asociado al teléfono —"');
  const bs = botonesDe(html).map(b => b.texto);
  for (const t of ['Es pruebaxx: 1100000009 pasa a ser su número', 'Es otra persona', 'Sin evidencia: queda pendiente'])
    assert.ok(bs.includes(t), 'falta el botón: ' + t);
  assert.equal((html.match(/border-radius:10px;background:#0d1117/g) || []).length, 1, 'una sola tarjeta, no dos');
});

test('con revisión, la búsqueda vieja no contradice al servidor: ni "no hay cuenta" ni "crear la cuenta"', () => {
  const h = armar(null);
  const r = { usuario: { exacto: null, similares: [] }, telefono: { exacto: null, similares: [], otros: [], varios: false },
    identidad: { ok: true, veredicto: 'USUARIO_REEMPLAZADO', usuario: { usuario: 'jugador02', telefono: '1122334455', operaciones: 7, tiene_cbu: true, vigente: 'jugador03' },
                 telefono: { telefono: '1199999999', dueno: null }, telefonos_anteriores: [], usuarios_anteriores: [] } };
  const html = h.ctx._altaCotejoHtml('jugador02', '1199999999', r, '_x', '', null).html;
  assert.doesNotMatch(html, /no hay cuenta con este usuario/);
  assert.doesNotMatch(html, /Crear la cuenta/);
  assert.doesNotMatch(html, /Es un alta nueva/);
  assert.match(html, /Este usuario es antiguo/);
});

test('lo ya validado se ve como siempre, sin bloque de identidad', async () => {
  const h = armar(cambio);
  const r = await h.ctx.altaCotejarDatos('jugador01', '1100000002');
  const html = h.ctx._altaCotejoHtml('jugador01', '1100000002', r, '_x', '', { usuario: 'jugador01' }).html;
  assert.doesNotMatch(html, /revisión humana/);
});

// Aprieta el botón como lo aprieta NODO: saca del HTML de la tarjeta el onclick y los data-* tal
// cual salieron, y corre ese onclick con `this` = el botón. Nada armado a mano (docs/BOTONES.md).
const desHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function botonesDe(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, texto]) => {
    const at = {};
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) at[k] = desHtml(v);
    return { texto: desHtml(texto.replace(/<[^>]*>/g, '')), onclick: at.onclick, el: { disabled: false, getAttribute: (k) => (k in at ? at[k] : null) } };
  });
}
async function apretar(h, b) {
  h.ctx.__el = b.el;
  await vm.runInContext('(function(){ return ' + b.onclick + '; }).call(__el)', h.ctx);
}

test('los tres botones de la tarjeta andan apretados tal como salen en pantalla', async () => {
  const h = armar(cambio, { respuesta: 'perdió el número' });
  const r = await h.ctx.altaCotejarDatos('jugador01', '1100000002');
  const bs = botonesDe(h.ctx._altaCotejoHtml('jugador01', '1100000002', r, '_x', '', null).html);
  const misma = bs.find(b => /pasa a ser su número/.test(b.texto));
  assert.ok(misma && misma.onclick, 'está el botón y tiene onclick');
  await apretar(h, misma);
  const v = h.llamadas.find(c => c.fn === 'panel_vincular_usuario_v2');
  assert.ok(v, 'vincula con la v2');
  assert.equal(v.p.p_motivo, 'perdió el número'); assert.equal(v.p.p_usuario, 'jugador01'); assert.equal(v.p.p_telefono, '1100000002');
  assert.equal(h.prompts.length, 1, 'pidió el motivo dentro de NODO');

  const h2 = armar(cambio);
  const r2 = await h2.ctx.altaCotejarDatos('jugador01', '1100000002');
  const bs2 = botonesDe(h2.ctx._altaCotejoHtml('jugador01', '1100000002', r2, '_x', '', null).html);
  await apretar(h2, bs2.find(b => /Sin evidencia/.test(b.texto)));
  assert.ok(!h2.llamadas.some(c => /vincular/.test(c.fn)), 'sin evidencia no vincula');
  assert.equal(h2.llamadas.find(c => c.fn === 'panel_identidad_decision').p.p_decision, 'SIN_EVIDENCIA');
  assert.match(h2.toasts.join(' '), /pendiente, sin acceso/);

  const h3 = armar(cambio);
  const r3 = await h3.ctx.altaCotejarDatos('jugador01', '1100000002');
  const bs3 = botonesDe(h3.ctx._altaCotejoHtml('jugador01', '1100000002', r3, '_x', '', null).html);
  await apretar(h3, bs3.find(b => /otra persona/.test(b.texto)));
  assert.equal(h3.llamadas.find(c => c.fn === 'panel_identidad_decision').p.p_decision, 'OTRA_PERSONA');
});

test('cancelar no hace nada y no deja el botón trabado', async () => {
  const h = armar(cambio, { respuesta: null });
  const r = await h.ctx.altaCotejarDatos('jugador01', '1100000002');
  const bs = botonesDe(h.ctx._altaCotejoHtml('jugador01', '1100000002', r, '_x', '', null).html)
    .filter(b => /altaIdentidadDecidir/.test(b.onclick || ''));
  assert.equal(bs.length, 3);
  for (const b of bs) { await apretar(h, b); assert.equal(b.el.disabled, false); }
  assert.ok(!h.llamadas.some(c => /vincular|decision/.test(c.fn)), 'cancelado no toca nada');
});
