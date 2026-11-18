const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Se extrae la función REAL del preload y se ejecuta, en vez de mirarla con una expresión regular.
const src = fs.readFileSync(path.join(__dirname, '..', 'agent-preload-bet300.js'), 'utf8');
const m = src.match(/function _puedeConcluirQueNoExiste\([^)]*\) ?\{[\s\S]*?\n\}/);
assert.ok(m, 'no encontré _puedeConcluirQueNoExiste en el preload');
const puede = new Function(m[0] + '\nreturn _puedeConcluirQueNoExiste;')();

const completo = { refresco: true, textoOk: true, estable: true, vistaOk: true };

test('con las cuatro condiciones sí se puede decir que no existe', () => {
  assert.equal(puede(completo), true);
});

test('sin haber llegado a la lista de JUGADORES no se puede concluir nada', () => {
  // El caso de pruebaxx (26/9): la lista quedó quieta y vacía, pero era la vista de AGENTES.
  // El usuario existía y venía cargando hacía una hora.
  assert.equal(puede({ ...completo, vistaOk: false }), false,
    'esto es lo que hacía que dijera "no existe en el casino" sin haber buscado');
});

test('falta cualquiera de las otras tres y tampoco', () => {
  assert.equal(puede({ ...completo, refresco: false }), false, 'nunca llegó una respuesta');
  assert.equal(puede({ ...completo, textoOk: false }), false, 'el alias no quedó escrito');
  assert.equal(puede({ ...completo, estable: false }), false, 'la lista seguía moviéndose');
});

test('sin datos no dice que no existe', () => {
  for (const r of [undefined, null, {}, { refresco: true }]) {
    assert.equal(puede(r), false, 'ante la duda, falla técnica y se reintenta: ' + JSON.stringify(r));
  }
});

test('el preload usa esta función y no repite la condición suelta', () => {
  assert.match(src, /if \(_puedeConcluirQueNoExiste\(r\)\) \{/, 'la decisión tiene que pasar por acá');
  // Fuera del cuerpo de la propia función, la condición no puede aparecer en ningún lado: si se
  // copia, una de las dos copias se va a quedar atrás. Es lo que pasó con los dos preloads (H-7).
  const afuera = src.replace(m[0], '');
  const sueltas = afuera.match(/r\.refresco && r\.textoOk && r\.estable/g) || [];
  assert.equal(sueltas.length, 0, 'la condición no puede quedar copiada en otro lado');
});

// ── La opción del menú que deja JUGADORES en la lista ────────────────────────
// Se llamaba "Todos los jugadores" y pasó a ser "Agentes y jugadores directos" (26/9). El preload
// la buscaba por texto EXACTO: dejó de encontrarla, esperaba 6 s, se rendía, y la búsqueda corría
// en la vista de AGENTES. De ahí el "pruebaxx no existe en el casino" con cargas de hacía una hora.

const mOpcion = src.match(/function _esOpcionJugadores\([^)]*\) ?\{[\s\S]*?\n\}/);
assert.ok(mOpcion, 'no encontré _esOpcionJugadores en el preload');
const esOpcion = new Function(mOpcion[0] + '\nreturn _esOpcionJugadores;')();

test('reconoce el nombre nuevo y el viejo', () => {
  assert.equal(esOpcion('Agentes y jugadores directos'), true, 'el de ahora');
  assert.equal(esOpcion('Todos los jugadores'), true, 'el de antes, por si vuelve');
  // Tal cual viene del DOM, con espacios y saltos de Vuetify.
  assert.equal(esOpcion('  Agentes y jugadores   directos \n'), true);
  assert.equal(esOpcion('AGENTES Y JUGADORES DIRECTOS'), true);
});

test('NO elige las opciones que esconden a los jugadores', () => {
  // Clickear una de estas sería el tiro en el pie: la lista quedaría sin jugadores y volveríamos
  // a concluir "no existe".
  for (const t of ['Sin jugadores', 'Ocultar jugadores', 'Excluir jugadores', 'No mostrar jugadores']) {
    assert.equal(esOpcion(t), false, t);
  }
});

test('no se cuelga de cualquier cosa del menú', () => {
  for (const t of ['Agentes', 'Cerrar sesión', 'Estadísticas', 'Reporte global', '', null, undefined]) {
    assert.equal(esOpcion(t), false, String(t));
  }
  // Un texto larguísimo no es una opción de menú: es la página entera colándose.
  assert.equal(esOpcion('jugadores ' + 'x'.repeat(200)), false);
});

test('el preload ya no busca el texto exacto viejo', () => {
  // El patrón viejo, tal cual estaba escrito en el preload: /^\s*todos\s+los\s+jugadores\s*$/i
  assert.ok(!src.includes('todos\\s+los\\s+jugadores'),
    'si vuelve el texto exacto, vuelve el bug en cuanto le cambien el nombre');
  assert.match(src, /_esOpcionJugadores\(normalizeText/, 'la elección tiene que pasar por la función');
});

// 18/11: agentesbet.io pasó la lista de jugadores a una tabla y el preload no veía ninguna fila
// ("no aprieta la lupa", "no cambia la clave").
test('el diseño nuevo de agentesbet.io: tabla, la lupa por su id y la llave aunque esté oculta', () => {
  assert.match(src, /document\.getElementById\('ac-search-menu-btn'\)/, 'la lupa es el botón #ac-search-menu-btn');
  assert.doesNotMatch(src.replace(/function _lupaBusqueda\(\) \{[\s\S]*?\n\}/, ''), /iconBtn\('mdi-magnify'\)/,
    'nadie más busca la lupa por el ícono: agarraba la del campo');
  assert.match(src, /td\.ac-td--ops/, 'las filas nuevas son <tr> con la celda de operaciones');
  assert.match(src, /aria-label\^="Acciones "/, 'el alias sale del botón "Acciones <alias>"');
  assert.match(src, /fila\.querySelector\('i\.mdi-key'\)/, 'la llave vive en un div d-none: se toma igual');
});
