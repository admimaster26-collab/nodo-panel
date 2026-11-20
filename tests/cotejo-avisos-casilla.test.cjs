// Los cartelitos del cotejo sobre el historial se veían con letras encimadas: la casilla "Lo vi" heredaba la regla
// general input{width:100%;padding:11px;margin…} y empujaba el texto encima del título (20/11).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'cotejo-cargas.js'), 'utf8');

test('la casilla "Lo vi" pisa la regla general de los inputs (ancho, alto, relleno)', () => {
  const m = src.match(/<input type="checkbox" style="([^"]*)" onchange="nodoCotejoReconocer/);
  assert.ok(m, 'no se encontró la casilla del aviso');
  assert.match(m[1], /width:auto/);
  assert.match(m[1], /height:auto/);
  assert.match(m[1], /padding:0/);
  assert.match(m[1], /margin:0 4px 0 0/);
});
