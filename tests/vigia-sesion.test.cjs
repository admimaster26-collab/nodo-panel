const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 18/11 · AdminOnline: el panel quedó con "La sesión de Agentes está cerrada" con la ventana adentro y
// operando. La bandera de sesión caída sólo se bajaba si una respuesta llegaba POR EL PANEL diciendo que
// había sesión, y la sonda no corre con la bandera arriba. Si el operador entraba desde la ventana o
// entraba la entrada automática (que va por main), nadie avisaba y la cola descartaba todo: el saldo,
// la lectura del WhatsApp, todo.
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'agentes-cola-y-sesion.js'), 'utf8');

test('con la sesión marcada caída, el panel vuelve a preguntarle a la página y se repone solo', () => {
  const marcar = src.slice(src.indexOf('window._drexMarcarSinSesion = function'), src.indexOf('function _drexAvisoAltura'));
  assert.ok(marcar.length > 0, 'no encontré _drexMarcarSinSesion');
  assert.match(marcar, /setInterval\(/, 'mientras esté caída, se pregunta cada tanto');
  assert.match(marcar, /callDrex\('estadoPagina'\)/, 'pregunta con estadoPagina, que sólo mira y no navega');
  assert.match(marcar, /clearInterval/, 'apenas se repone, deja de preguntar');
});

test('estadoPagina pasa la cola aunque la sesión esté caída: si no, el vigía nunca llega a la página', () => {
  assert.match(src, /nombre!=='estadoPagina'/);
  // y una respuesta con needsLogin:false es la que repone la sesión
  assert.match(src, /needsLogin === false\) window\._drexSesionRepuesta\(\)/);
});
