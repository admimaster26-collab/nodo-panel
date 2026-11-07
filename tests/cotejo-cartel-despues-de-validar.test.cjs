const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const identidad = require('../renderer/domain/identidad.js');

// El cartel de la tarjeta de cotejo tiene que CAMBIAR cuando se termina de validar.
//
// Juan, 19/10, con la pantalla a la vista: "revisa tambien que la proxima version cambie el
// cartel de revisar cuando se termine de validar para que aparezca todo joya, por como esta en
// la version actual sigue siendo incongruente".
//
// El caso de su captura, tal cual:
//
//     el cliente escribió     "Usuario: laugoat66. Tel: 1100000003."
//     su cuenta real es        lauggoat66, con ese mismo teléfono, VINCULADO
//
// El operador aprieta "Validar y vincular", sale el modal "✅ Usuario validado y agendado"...
// y detrás la tarjeta sigue diciendo ⚠️ REVISAR, con "no figura así", "es de lauggoat66" y el
// botón "usar lauggoat66" — las mismas tres cosas que antes de validar.
//
// Y no se arregla con datos: el cotejo compara lo DECLARADO contra el padrón, y "laugoat66" no
// va a existir nunca, haya vínculo o no. Fijate en la prueba de abajo que el padrón que se le
// pasa es EL MISMO antes y después. Lo único que cambia es que ahora la tarjeta se acuerda de
// la decisión que tomó el operador.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'cotejo-alta.js'), 'utf8');

// ── El padrón, igual antes y después de validar ───────────────────────────────────────────
// lauggoat66 YA era el dueño del teléfono antes de que el operador tocara nada: por eso la
// tarjeta decía "es de lauggoat66". Validar no mueve este dato.
const LAUGGOAT = {
  usuario: 'lauggoat66', telefonos: ['1100000003'], titular: '',
  vinculo: 'VINCULADO', pc: 'P2', confiable: true
};
const PADRON = () => ({
  usuario:  { exacto: null, similares: [LAUGGOAT] },
  telefono: { exacto: Object.assign({ _tel: '1100000003' }, LAUGGOAT), similares: [],
              otros: [{ usuario: 'lauggoat66', pc: 'P2', vinculo: 'VINCULADO' }] }
});

const TICKET = {
  usuario: 'laugoat66', telefono: '1100000003',
  thread: [{ mensaje: 'Hola 👋 Quiero validar mi acceso para operar. Usuario: laugoat66. Tel: 1100000003.' }]
};

// ── La oficina: un panel de mentira, pero que CORRE el archivo de verdad ──────────────────
function abrirPanel(cotejo) {
  const caja = { innerHTML: '', dataset: {} };
  const guardado = {};
  const llamadas = { vinculados: [] };

  const ctx = {
    console, setTimeout, clearTimeout, JSON, Date, Object, String, Array, Math,
    document: { getElementById: (id) => (id === 'altaCotejoConsulta' ? caja : null) },
    localStorage: {
      getItem: (k) => (k in guardado ? guardado[k] : null),
      setItem: (k, v) => { guardado[k] = String(v); },
      removeItem: (k) => { delete guardado[k]; }
    },
    escapeHtml: (s) => String(s == null ? '' : s)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    pcOperativa: 'P2',
    operador: { usuario: 'juan' },
    toast: () => {},
    alert: () => {},
    confirm: () => true,
    abrirModal: () => {},
    cerrarModal: () => {},
    ensureDrexSession: async () => true,
    // El casino dice que la cuenta existe: si dijera que no, ejecutarVincular ni vincula.
    callDrex: async () => ({ exists: true }),
    supabaseClient: {
      rpc: async (nombre, args) => {
        if (nombre === 'panel_vincular_usuario' || nombre === 'panel_vincular_usuario_v2') {
          llamadas.vinculados.push({ usuario: args.p_usuario, telefono: args.p_telefono });
          return { data: { ok: true } };
        }
        return { data: {} };
      }
    }
  };
  vm.createContext(ctx);
  ctx.window = ctx;                       // como en el navegador: window ES el global
  vm.runInContext(SRC, ctx);
  ctx.NodoDomain = { identidad };
  ctx._tel = (v) => String(v || '');
  ctx.altaCotejarDatos = async () => cotejo();   // el padrón, congelado

  return {
    ctx, caja, llamadas,
    // Repintar la consulta como lo hace el chat en cada vuelta.
    dibujar: async () => { caja.dataset.key = ''; await ctx._altaCotejoConsulta(TICKET); return caja.innerHTML; },
    cartel: () => (caja.innerHTML.match(/text-transform:uppercase;color:#[0-9a-f]{6}">([^<]+)</) || [])[1]
  };
}

test('antes de validar el cartel avisa, como tiene que ser', async () => {
  const p = abrirPanel(PADRON);
  await p.dibujar();
  assert.equal(p.cartel(), 'Revisar');
  assert.match(p.caja.innerHTML, /no figura así/);
  assert.match(p.caja.innerHTML, /usar lauggoat66/, 'el botón para corregir tiene que estar');
});

test('despues de validar el cartel dice Validado y se va el REVISAR', async () => {
  const p = abrirPanel(PADRON);
  await p.dibujar();
  assert.equal(p.cartel(), 'Revisar', 'arranca avisando');

  // El operador aprieta "Validar y vincular" con el alias corregido.
  await p.ctx.ejecutarVincular('lauggoat66', '1100000003', true);
  assert.deepEqual(p.llamadas.vinculados, [{ usuario: 'lauggoat66', telefono: '1100000003' }]);

  const html = await p.dibujar();
  assert.equal(p.cartel(), 'Validado');
  assert.doesNotMatch(html, /no figura así/, 'ya no "no figura": el operador resolvió cuál era');
  assert.doesNotMatch(html, /usar lauggoat66/, 'no queda nada que elegir, el botón sobra');
  assert.match(html, /lauggoat66/, 'tiene que decir con QUÉ cuenta quedó');
  assert.match(html, /El cliente había escrito/, 'y qué había escrito el cliente, para poder explicarle');
});

test('se acuerda aunque se reinicie el panel', async () => {
  const p1 = abrirPanel(PADRON);
  await p1.dibujar();
  await p1.ctx.ejecutarVincular('lauggoat66', '1100000003', true);
  const disco = JSON.parse(p1.ctx.localStorage.getItem('nodo.cotejo.resueltos'));
  assert.equal(disco[Object.keys(disco)[0]].usuario, 'lauggoat66');
});

test('validar a OTRO jugador no pinta de verde la consulta abierta', async () => {
  const p = abrirPanel(PADRON);
  await p.dibujar();
  // Misma sesión, otra pantalla: el operador valida a alguien que no tiene nada que ver.
  await p.ctx.ejecutarVincular('martin2024', '1133445566', true);
  await p.dibujar();
  assert.equal(p.cartel(), 'Revisar', 'la consulta de laugoat66 sigue sin resolverse');
});

test('si el padron ya no lo respalda, no se muestra el verde', async () => {
  const p = abrirPanel(PADRON);
  await p.dibujar();
  await p.ctx.ejecutarVincular('lauggoat66', '1100000003', true);

  // Alguien reasignó el teléfono a otra cuenta después de validar. La marca vieja no alcanza:
  // el verde se confirma contra el padrón de AHORA o no se pinta.
  const OTRO = { usuario: 'jugador02', telefonos: ['1100000003'], vinculo: 'VINCULADO', pc: 'P2', confiable: true };
  p.ctx.altaCotejarDatos = async () => ({
    usuario:  { exacto: null, similares: [] },
    telefono: { exacto: Object.assign({ _tel: '1100000003' }, OTRO), similares: [],
                otros: [{ usuario: 'jugador02', pc: 'P2', vinculo: 'VINCULADO' }] }
  });
  await p.dibujar();
  assert.notEqual(p.cartel(), 'Validado', 'el teléfono cambió de dueño: hay que volver a avisar');
  assert.match(p.caja.innerHTML, /jugador02/);
});
