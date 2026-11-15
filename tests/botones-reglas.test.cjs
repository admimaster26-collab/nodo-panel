const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Guardia de docs/BOTONES.md. Juan, 8/11: "ya es la octava vez que tengo que remarcarte esos botones".
// Estas reglas se rompieron una y otra vez y cada vez el síntoma fue el mismo: el operador aprieta y
// no pasa nada. Esta prueba recorre TODO el código de NODO (no sólo lo que se tocó hoy).

const RAIZ = path.join(__dirname, '..', 'renderer');

function fuentes(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'generated') out.push(...fuentes(p)); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
// Saca comentarios de bloque y de línea (sin confundir "https://" con un comentario).
function sinComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split(/\r?\n/).map((l) => l.replace(/(^|[^:"'\\])\/\/.*$/, '$1')).join('\n');
}
function buscar(re) {
  const hallados = [];
  for (const f of fuentes(RAIZ)) {
    sinComentarios(fs.readFileSync(f, 'utf8')).split(/\r?\n/).forEach((l, i) => {
      if (re.test(l)) hallados.push(path.relative(RAIZ, f) + ':' + (i + 1) + '  ' + l.trim().slice(0, 120));
    });
  }
  return hallados;
}

test('regla 1: nadie usa prompt() en NODO (en Electron no existe y el botón queda muerto)', () => {
  const hallados = buscar(/(^|[^.\w$])prompt\s*\(|\bwindow\.prompt\s*\(/);
  assert.deepEqual(hallados, [], 'Usar window.nodoPedirTexto (docs/BOTONES.md):\n' + hallados.join('\n'));
});

test('regla 5: ninguna consulta a Supabase lleva .catch pegado (el builder no lo tiene y revienta)', () => {
  const hallados = buscar(/\.rpc\(.*\)\s*\.catch\(/).filter((l) => !/Promise\.resolve\(/.test(l));
  assert.deepEqual(hallados, [], 'Usar await dentro de try/catch, o Promise.resolve(...).catch (docs/BOTONES.md):\n' + hallados.join('\n'));
});

// ── nodoPedirTexto: lo que reemplaza a prompt() ───────────────────────────────────────────────
function armar() {
  const src = fs.readFileSync(path.join(RAIZ, 'core', 'utilidades-interfaz.js'), 'utf8');
  const bloque = src.slice(src.indexOf('window.nodoPedirTexto'));
  const capas = [];
  const nuevo = () => ({ value: '', textContent: '', focus() {}, select() {} });
  const ctx = {
    setTimeout: (fn) => fn(), Promise, String,
    document: {
      getElementById: () => null,
      createElement: () => {
        const partes = { input: nuevo(), '[data-si]': nuevo(), '[data-no]': nuevo(), '[data-msg]': nuevo() };
        const capa = { style: {}, innerHTML: '', quitada: false, remove() { this.quitada = true; }, querySelector: (s) => partes[s], partes };
        capas.push(capa); return capa;
      },
      body: { appendChild() {} }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(bloque, ctx);
  return { pedir: (o) => ctx.nodoPedirTexto(o), capas };
}

test('nodoPedirTexto: trae el valor sugerido, Enter/confirmar devuelve lo escrito y se cierra', async () => {
  const a = armar();
  const p = a.pedir({ titulo: 'Motivo', valor: 'perdió el número', confirmar: 'Confirmar' });
  const c = a.capas[0];
  assert.equal(c.partes.input.value, 'perdió el número');
  c.partes.input.value = '  cambió de chip  ';
  c.partes.input.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(await p, 'cambió de chip');
  assert.equal(c.quitada, true);
});

test('nodoPedirTexto: obligatorio vacío avisa y no cierra; Cancelar y Esc devuelven null', async () => {
  const a = armar();
  const p = a.pedir({ requerido: true, faltaTexto: 'Escribí el motivo' });
  const c = a.capas[0];
  c.partes['[data-si]'].onclick();
  assert.equal(c.partes['[data-msg]'].textContent, 'Escribí el motivo');
  assert.equal(c.quitada, false);
  c.partes['[data-no]'].onclick();
  assert.equal(await p, null);
  const p2 = a.pedir({});
  a.capas[1].partes.input.onkeydown({ key: 'Escape', preventDefault() {} });
  assert.equal(await p2, null);
});

test('nodoPedirTexto: lo que se muestra va escapado', () => {
  const a = armar();
  a.pedir({ titulo: '<img src=x onerror=alert(1)>', texto: 'a & b' });
  assert.doesNotMatch(a.capas[0].innerHTML, /<img/);
  assert.match(a.capas[0].innerHTML, /&lt;img/);
});
