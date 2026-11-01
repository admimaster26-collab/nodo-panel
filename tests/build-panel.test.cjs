const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { assemble, build } = require('../scripts/build-panel.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodo-panel-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('nodo-panel-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'renderer'));
  const manifest = { output: 'panel.htm', blocks: [
    { id: 'js:core', type: 'script', sources: ['first.js', 'second.js'] },
    { id: 'js:override', type: 'script', sources: ['override.js'] }
  ] };
  const write = (file, value) => fs.writeFileSync(path.join(root, 'renderer', file), value);
  const saveManifest = () => write('manifest.json', JSON.stringify(manifest));
  saveManifest();
  write('panel.template.html', '<script id="core">{{nodo:js:core}}</script><script>{{nodo:js:override}}</script>');
  write('first.js', 'let state = later();\n');
  write('second.js', 'function later() { return 41; }\n');
  write('override.js', 'state++; globalThis.answer = state;');
  return { root, manifest, write, saveManifest };
}

test('preserva hoisting entre fragmentos, alcance entre bloques, ids y orden', t => {
  const { root } = fixture(t);
  const { html } = assemble(root);
  assert.ok(html.startsWith('<script id="core">'));
  const context = vm.createContext({});
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(match[1], context);
  }
  assert.equal(context.answer, 42);
});

test('detecta salida desactualizada sin escribir y genera de forma idempotente', t => {
  const { root, write } = fixture(t);
  assert.throws(() => build({ root, check: true }), /desactualizado/);
  assert.equal(fs.existsSync(path.join(root, 'panel.htm')), false);
  assert.equal(build({ root }).changed, true);
  assert.equal(build({ root }).changed, false);
  write('override.js', 'state += 2;');
  assert.throws(() => build({ root, check: true }), /desactualizado/);
});

test('rechaza referencias desconocidas, repetidas y ausentes', t => {
  const { root, write } = fixture(t);
  write('panel.template.html', '{{nodo:missing}}');
  assert.throws(() => assemble(root), /desconocido/);
  write('panel.template.html', '{{nodo:js:core}}{{nodo:js:core}}{{nodo:js:override}}');
  assert.throws(() => assemble(root), /una vez/);
  write('panel.template.html', '{{nodo:js:core}}');
  assert.throws(() => assemble(root), /una vez/);
});

test('valida sintaxis combinada y evita cierres prematuros del script', t => {
  const { root, write } = fixture(t);
  write('second.js', 'let state = 0;');
  assert.throws(() => assemble(root), SyntaxError);
  write('second.js', 'const text = "</script>";');
  assert.throws(() => assemble(root), /Cierre HTML/);
});

test('rechaza rutas fuera del proyecto y fuentes duplicadas', t => {
  const { root, manifest, saveManifest } = fixture(t);
  manifest.blocks[0].sources = ['../../outside.js'];
  saveManifest();
  assert.throws(() => assemble(root), /fuera del proyecto/);
  manifest.blocks[0].sources = ['first.js', 'first.js'];
  saveManifest();
  assert.throws(() => assemble(root), /Fuente duplicada/);
  manifest.output = '../outside.htm';
  saveManifest();
  assert.throws(() => assemble(root), /fuera del proyecto/);
});

test('el panel versionado coincide con sus fuentes y todos sus scripts compilan', () => {
  const result = build({ check: true });
  assert.equal(result.changed, false);
  // Canario deliberado: si cambia la cantidad de bloques, revisar el manifiesto y subirlo a mano.
  // 25/10 · 34: entró js:chat-redimensionable (la manija para estirar la columna del chat).
  assert.equal(result.blocks, 34);
});
