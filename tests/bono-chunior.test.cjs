const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Juan, 2/11: en el historial de Inicio el bono quedaba mucho rato con el botón de Chunior, y a
// veces para siempre. Su anotación tiene que seguir el mismo camino que la de la carga del jugador.
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer/portal/operation-execution.js'), 'utf8');
const inicio = src.indexOf('if(bilPromo.CHUNIOR_UID){');
const bloque = src.slice(inicio, src.indexOf('} else {', inicio));

test('el bono vuelve a dibujar el historial cuando llega el número de Chunior', () => {
  assert.ok(inicio > 0, 'existe la anotación del bono');
  const conNumero = bloque.slice(bloque.indexOf('rChu.movimientoId && filaBono'), bloque.indexOf('[CHUNIOR_OK_SIN_N]'));
  assert.match(conNumero, /chunior_movimiento_id[\s\S]*cargarHistorial\(\)/);
  const sinNumero = bloque.slice(bloque.indexOf('[CHUNIOR_OK_SIN_N]'), bloque.indexOf('rChu.error'));
  assert.match(sinNumero, /cargarHistorial\(\)/);
});

test('si la anotación del bono falla, queda en la cola que se reintenta sola', () => {
  assert.match(bloque, /rChu && rChu\.error\)\{[\s\S]*_bonoPendiente\(rChu\.error\)/);
  assert.match(bloque, /\.catch\(function\(e\)\{ _bonoPendiente\(/);
  assert.match(bloque, /chuniorPendienteAdd\(\{ tipo:'CARGA', uid:bilPromo\.CHUNIOR_UID, monto:bonoMonto, usuario:usuario, histId:filaBono\?\.id\|\|null/);
  assert.doesNotMatch(bloque, /\.catch\(function\(\)\{\}\)/, 'ningún error se traga en silencio');
});
