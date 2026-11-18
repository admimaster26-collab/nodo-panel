const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { armar, revisar } = require('../scripts/portal-publicar.cjs');

// Juan, 18/11: "limpieza absoluta del código del portal: hay información de desarrollo que el usuario no debe
// ver". Se subía una copia exacta del archivo Portal, con ~650 líneas de notas internas, console.log y el
// bloque de pruebas con las rutas de todas las oficinas. Lo publicado sale de scripts/portal-publicar.cjs.
const FUENTE = fs.readFileSync(path.join(__dirname, '..', 'Portal'), 'utf8');

for (const produccion of [true, false]) {
  const nombre = produccion ? 'producción' : 'prueba';
  test('el Portal de ' + nombre + ' sale limpio y entero', () => {
    const html = armar(FUENTE, { produccion });
    assert.deepEqual(revisar(html, { produccion }), [], 'sin comentarios, sin console y sin notas internas');
    assert.doesNotMatch(html, /\/\/ ── |\/\* .* \*\/|Ver docs\/|servidor\/[a-z-]+\.sql/, 'ninguna nota de desarrollo');
    for (const f of ['function guiaMostrar(', 'async function enviarMensajeSoporte(', 'async function crearSolicitudRetiro(', 'function renderHome('])
      assert.ok(html.includes(f), 'el código sigue entero: ' + f);
    assert.ok(html.length < FUENTE.length);
  });
}

test('producción no lleva el modo pruebas (rutas de todas las oficinas); la copia de prueba sí', () => {
  const prod = armar(FUENTE, { produccion: true }), prueba = armar(FUENTE, { produccion: false });
  assert.match(prod, /const MODO_PRUEBA = null;/);
  assert.doesNotMatch(prod, /RUTAS_PRUEBA|rt-[a-z0-9]{5}"/);
  assert.match(prueba, /RUTAS_PRUEBA/, 'la copia que va a intento sigue entrando sola como P1');
});
