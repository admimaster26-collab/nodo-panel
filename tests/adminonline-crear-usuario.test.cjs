// Crear jugador en AdminOnline (Juan, 18/11: "queda ahí clavado"). La página tiene tres pasos: el panel
// "Crear jugador" (alias y una contraseña al azar ya puesta), "Creación de jugador · Verifique la
// información" con Aceptar, y "Usuario creado" con Cerrar. NODO no apretaba Aceptar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'agent-preload-adminonline.js'), 'utf8');
const f = src.slice(src.indexOf('async function crearUsuario'), src.indexOf('// ── Saldo del agente'));

test('aprieta Aceptar en "Verifique la información" y toma la contraseña que muestra', () => {
  assert.match(f, /verifique la informaci\[oó\]n/);
  assert.match(f, /findByText\(\/\^aceptar\$\/i, 'button', v\)/);
  assert.match(f, /claveVerificada = m\[1\]/);
  assert.ok(f.indexOf('clickElement(guardar)') < f.indexOf('clickElement(aceptar)'), 'primero Crear jugador, después Aceptar');
});

test('con la contraseña al azar de la página: se usa ésa si el operador no eligió otra', () => {
  assert.match(f, /if \(passInput && \(!elegida \|\| elegida === CLAVE_ESTANDAR\)\)/);
  assert.match(f, /if \(passInput && !propuesta\) await setFieldAndVerify\(passInput, clave, 5\)/);
  assert.match(f, /password: claveVerificada \|\| clave/);
});

test('mira todos los diálogos abiertos, no sólo el primero', () => {
  assert.match(f, /visibleElements\('\[role="dialog"\]'\)/);
});

test('"Balance actualizado exitosamente" no cuenta como jugador creado', () => {
  assert.match(f, /capt\.resultado\.tipo === 'ok' && !\/cread\|usuario\|jugador\/i\.test/);
});

test('"Usuario creado" se cierra con su propio Cerrar', () => {
  assert.match(f, /findByText\(\/\^cerrar\$\/i, 'button', creadoEn\)/);
});
