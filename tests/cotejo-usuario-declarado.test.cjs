const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Juan, 16/11, con la consulta de "Tengo usuario pero no puedo entrar" a la vista: en NODO el usuario
// figuraba como "pero" ("ya vi este caso y es genuinamente raro porque no siempre es la misma palabra").
// El cotejo agarraba la palabra que seguía a "usuario" en cualquier frase. El pedido del Portal empieza
// con "Tengo usuario pero…", así que TODA consulta de ayuda de acceso salía con "pero", y otras frases
// ("usuario nuevo", "usuario bloqueado") daban otras palabras. Además, cuando el jugador no escribe
// usuario, el Portal inventa "ayuda-<teléfono>": eso no es un usuario declarado.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'cotejo-alta.js'), 'utf8');

function cotejoDe(ticket) {
  const caja = { innerHTML: '', dataset: {} };
  const visto = [];
  const ctx = {
    console, setTimeout, clearTimeout, JSON, Date, Object, String, Array, Math,
    document: { getElementById: (id) => (id === 'altaCotejoConsulta' ? caja : null) },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    escapeHtml: (s) => String(s == null ? '' : s),
    pcOperativa: 'P1', toast: () => {}, alert: () => {}
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(SRC, ctx);
  // Lo que el cotejo le pregunta al padrón es justo lo que tomó como declarado.
  ctx.altaCotejarDatos = async (u, t) => { visto.push({ u, t: String(t).replace(/\D/g, '') }); throw new Error('corte de prueba'); };
  return ctx._altaCotejoConsulta(ticket).then(() => ({ visto, decl: ctx.__altaCotejoDecl }));
}
const jugador = (mensaje) => ({ origen: 'USUARIO', mensaje });

test('"Tengo usuario pero no puedo entrar" con usuario escrito: se toma el del rótulo, no "pero"', async () => {
  const r = await cotejoDe({ usuario: 'juan123', thread: [jugador('Hola 👋 Tengo usuario pero no puedo entrar. Usuario: juan123. Tel: 1111111111.')] });
  assert.equal(r.decl.u, 'juan123');
  assert.deepEqual(r.visto, [{ u: 'juan123', t: '1111111111' }]);
});

test('sin usuario escrito, el "ayuda-<teléfono>" que inventa el Portal no se coteja como usuario', async () => {
  const r = await cotejoDe({ usuario: 'ayuda-1111111111', thread: [jugador('Hola 👋 Tengo usuario pero no puedo entrar. Usuario: ayuda-1111111111. Tel: 1111111111.')] });
  assert.equal(r.decl.u, '', 'no dio usuario: queda vacío, y el cotejo va sólo por teléfono');
  assert.equal(r.visto[0].t, '1111111111');
  const nuevo = await cotejoDe({ usuario: 'ayuda-1111111111', thread: [jugador('Hola 👋 No puedo entrar a mi cuenta. No puse mi usuario. Tel: 1111111111.')] });
  assert.equal(nuevo.decl.u, '');
});

test('frases sueltas con la palabra usuario no inventan un usuario', async () => {
  for (const frase of ['tengo usuario nuevo y no me deja', 'el usuario bloqueado otra vez', 'usuario pero no se cual']) {
    const r = await cotejoDe({ usuario: 'carlos99', telefono: '1122334455', thread: [jugador(frase)] });
    assert.equal(r.decl.u, 'carlos99', frase + ': vale el usuario de la consulta');
  }
});

test('"mi usuario es X" y el último rótulo valen', async () => {
  const r = await cotejoDe({ usuario: 'x', thread: [jugador('mi usuario es noex90'), jugador('perdón, Usuario: noex91. Tel: 1100000001')] });
  assert.equal(r.decl.u, 'noex91', 'el más reciente');
  const s = await cotejoDe({ usuario: 'x', thread: [jugador('mi usuario es noex90 y no entra')] });
  assert.equal(s.decl.u, 'noex90');
});
