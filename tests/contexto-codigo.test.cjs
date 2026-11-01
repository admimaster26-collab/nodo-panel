'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { buildIndex, query, format, graph } = require('../scripts/contexto-codigo.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodo-context-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('nodo-context-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const cacheDir = path.join(root, '.cache');
  const index = () => buildIndex({ root, cacheDir });
  write('renderer/manifest.json', JSON.stringify({ output: 'panel.htm', blocks: [{ id: 'js:core', type: 'script', sources: ['one.js', 'two.js'] }] }));
  write('renderer/one.js', `function begin(value) { return helper(value); }\nfunction shadow(helper) { return helper(); }\nfunction misleading(other) { other.helper(); return 'helper()'; }\n// helper() is not a call\n`);
  write('renderer/two.js', 'function helper(value) { return client.rpc("rpc_example", { p_value: value }); }');
  write('renderer/generated/js-core.js', 'function generatedOnly(){} function helper(){ return 100; }');
  write('panel.htm', '<script>function generatedPanelOnly(){}</script>');
  write('server.sql', `-- create function public.fake() returns void as $$fake$$;\ncreate or replace function public.rpc_example(p_value text default 'private default') returns jsonb language sql as $fn$ select public.inner_call(p_value); $fn$;\ncreate function public.inner_call(p text) returns jsonb language sql as $$select '{}'::jsonb$$;`);
  write('tests/begin.test.cjs', `const fs = require('node:fs'); fs.readFileSync('renderer/one.js'); function check(){ begin('value'); }`);
  write('docs/contract.md', 'El contrato rpc_example se revisa con begin y helper.');
  return { root, write, index, cacheDir };
}

test('AST distingue referencias léxicas de strings, comentarios, métodos ajenos y parámetros', t => {
  const f = fixture(t), index = f.index(), result = query(index, 'symbol', 'helper');
  assert.equal(result.definiciones.length, 1);
  assert.deepEqual(result.entrantes.map(e => e.desde), ['begin']);
  assert.equal(result.entrantes[0].estado, 'única');
  assert.equal(result.rpc[0].destinos[0], 'server.sql:2');
  assert.equal(result.definiciones[0].fuente.editable, 'renderer/two.js');
  assert.equal(result.definiciones[0].fuente.generado, 'renderer/generated/js-core.js');
  assert.ok(!graph(index).symbols.some(s => s.name.startsWith('generated')));
  assert.ok(!graph(index).symbols.some(s => s.name === 'public.fake'));
});

test('flow cruza JS -> RPC -> SQL y señala pruebas por evidencia local', t => {
  const f = fixture(t), index = f.index(), result = query(index, 'flow', 'begin', { depth: 3, limit: 20 });
  assert.ok(result.recorrido.some(e => e.llama === 'rpc_example' && e.destinos[0] === 'server.sql:2'));
  assert.ok(result.recorrido.some(e => e.llama === 'public.inner_call'));
  assert.ok(result.pruebas.some(e => e.archivo === 'tests/begin.test.cjs' && e.evidencia === 'referencia de ruta'));
  assert.ok(result.documentos.some(e => e.archivo === 'docs/contract.md'));
  const impact = query(index, 'impact', 'rpc_example', { depth: 3, limit: 20 });
  assert.ok(impact.recorrido.some(e => e.desde === 'begin'));
});

test('hash invalida caché aunque tamaño y mtime no cambien; borrar archivo elimina símbolos', t => {
  const f = fixture(t), a = f.index(), b = f.index();
  assert.equal(b.stats.parsed, 0);
  assert.equal(b.stats.reused, Object.keys(a.files).length);
  const file = path.join(f.root, 'renderer/two.js'), stat = fs.statSync(file);
  const before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, before.replace('helper', 'rename'));
  fs.utimesSync(file, stat.atime, stat.mtime);
  const c = f.index();
  assert.equal(c.stats.parsed, 1);
  assert.notEqual(c.fingerprint, b.fingerprint);
  assert.equal(query(c, 'symbol', 'rename').definiciones.length, 1);
  fs.unlinkSync(file);
  const d = f.index();
  assert.equal(d.stats.removed, 1);
  assert.equal(query(d, 'symbol', 'rename').definiciones, undefined);
});

test('Portal extensionless interpreta sólo scripts JavaScript y preserva líneas y bloque exacto', t => {
  const f = fixture(t);
  f.write('Portal', '<!doctype html>\n<button onclick="phantom()">function phantom(){}</button>\n<!-- <script>function commentOnly(){}</script> -->\n<script type="application/json">{"not": "javascript"}</script>\n<script>\nfunction portalEntry(x) { return x + 1; }\n</script>');
  const index = f.index(), result = query(index, 'symbol', 'Portal::portalEntry', { code: true });
  assert.equal(result.definiciones[0].ubicacion, 'Portal:6');
  assert.equal(result.codigo.contenido, 'function portalEntry(x) { return x + 1; }');
  assert.ok(!graph(index).symbols.some(s => ['phantom', 'commentOnly'].includes(s.name)));
  assert.ok(result.avisos.some(a => a.includes('HTML')));
});

test('wrapper RPC de un salto y definición duplicada se reportan sin elegir despliegue', t => {
  const f = fixture(t);
  f.write('wrapper.js', 'function request(name, args) { return client.rpc(name, args); } function entry(){ return request("rpc_example", {}); }');
  f.write('other.sql', 'create function public.rpc_example(p text) returns jsonb language sql as $$select null$$;');
  const index = f.index(), result = query(index, 'symbol', 'entry');
  assert.equal(result.rpc[0].tipo, 'literal a wrapper RPC (1 salto)');
  assert.equal(result.rpc[0].estado, 'ambigua');
  assert.equal(result.rpc[0].destinos.length, 2);
  const sql = query(index, 'symbol', 'rpc_example');
  assert.equal(sql.definiciones.length, 2);
  assert.ok(sql.avisos.some(a => a.includes('Varias definiciones')));
});

test('cache y salida por defecto excluyen cuerpos, secretos, valores de argumentos y comentarios', t => {
  const f = fixture(t), secret = 'secret-value-for-context-test';
  f.write('private.js', `function privateFunction(){ const password = '${secret}'; // private-comment-value\n return transport('private-argument-value'); }`);
  f.write('docs/private.md', 'example secret PRIVATE_DOCUMENT_LITERAL_ONLY');
  const index = f.index(), cache = fs.readFileSync(path.join(f.cacheDir, 'index.json'), 'utf8');
  const result = query(index, 'symbol', 'privateFunction', { code: true });
  for (const value of [secret, 'private-comment-value', 'private-argument-value', 'PRIVATE_DOCUMENT_LITERAL_ONLY']) assert.ok(!cache.includes(value));
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.codigo, undefined);
  assert.ok(result.avisos.some(a => a.includes('secreto')));
});

test('imports locales se resuelven y símbolos de otros módulos no se unen por nombre', t => {
  const f = fixture(t);
  f.write('module.js', 'function moduleHelper(){} module.exports={moduleHelper};');
  f.write('consumer.js', 'const { moduleHelper } = require("./module"); function consume(){moduleHelper();}');
  f.write('stranger.js', 'function stranger(){ moduleHelper(); }');
  const result = query(f.index(), 'symbol', 'moduleHelper');
  assert.deepEqual(result.entrantes.map(e => e.desde), ['consume']);
});

test('no resuelve una importación no exportada ni un var local contra un global', t => {
  const f = fixture(t);
  f.write('module.js', 'function hidden(){} module.exports={};');
  f.write('consumer.js', 'const { hidden } = require("./module"); function consume(){hidden();}');
  f.write('renderer/one.js', 'function localVar(){ if (true) { var helper = external; } helper(); }');
  const index = f.index();
  assert.equal(query(index, 'symbol', 'hidden').entrantes.length, 0);
  assert.equal(query(index, 'symbol', 'helper').entrantes.length, 0);
});

test('salida es JSON válido acotado con omisiones explícitas y no corta código silenciosamente', t => {
  const f = fixture(t);
  f.write('many.js', Array.from({ length: 70 }, (_, i) => `function caller${i}(){ many(); }`).join('\n') + '\nfunction many(){}');
  const result = query(f.index(), 'symbol', 'many', { limit: 30, code: true });
  const output = format(result, 2200), parsed = JSON.parse(output);
  assert.ok(output.length <= 2200);
  assert.ok(parsed.omitidos.entrantes >= 40);
  assert.ok(parsed.limiteSalida || parsed.aviso);
});

test('changes incluye staged, unstaged y untracked y redirige generado a su fuente', t => {
  const f = fixture(t);
  const git = args => cp.execFileSync('git', ['-C', f.root, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--quiet']); f.write('.gitignore', '.cache/\n'); git(['add', '.']);
  git(['-c', 'user.name=Context Test', '-c', 'user.email=context@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  f.write('renderer/generated/js-core.js', 'generated changed');
  f.write('new.js', 'function newlyAdded(){}');
  const result = query(f.index(), 'changes', null, { limit: 30 });
  assert.ok(result.cambios.some(c => c.archivo === 'new.js'));
  assert.deepEqual(result.cambios.find(c => c.archivo === 'renderer/generated/js-core.js').editar, ['renderer/one.js', 'renderer/two.js']);
});
