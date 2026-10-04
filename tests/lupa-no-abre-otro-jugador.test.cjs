const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// La lupa del historial no puede abrir la ficha de otro jugador.
//
// Juan, 4/10: apretó la lupa en la fila de juijuh y se abrió la ficha de vero8goat — con el
// titular de ella, sus saldos y su árbol de operaciones. "es un error, se repitio".
//
// POR QUÉ: el historial muestra dos cosas mezcladas, movimientos (historial_ops) y solicitudes
// del portal (landing_solicitudes). Cada tabla numera por su cuenta y las dos ya van por el
// 300.000, así que los números se pisan. Verificado contra la base ese mismo día:
//
//     solicitud  303566 → juijuh,    CARGA $ 2.000
//     movimiento 303566 → vero8goat, CARGA $ 4.000
//
// El botón mandaba el número de la fila a secas; si la fila era una solicitud, el detalle lo
// buscaba entre los movimientos y encontraba el de otra persona.

const HIST = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'historial-operaciones.js'), 'utf8');
const PERF = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'perfil-jugador.js'), 'utf8');

function trozo(src, desde, hasta){
  const i = src.indexOf(desde);
  assert.notEqual(i, -1, 'no está: ' + desde);
  const j = src.indexOf(hasta, i);
  assert.notEqual(j, -1, 'no está: ' + hasta);
  return src.slice(i, j + hasta.length);
}

// ── El botón ────────────────────────────────────────────────────────────────────────────────
function boton(h){
  const codigo = trozo(HIST, 'const _histIdSeguro', "title=\"Ver el detalle de esta operación\">🔍</button>';");
  const ctx = { h, escapeHtml: (v) => String(v == null ? '' : v), String, __out: '',
                _tipoConMovimiento: ['CARGA','RETIRO','MOV_BILLETERA','CAMBIO_BILLETERA',
                                     'DEPOSITO_SR','PROPINA','RECARGA_FICHAS','GASTO'] };
  vm.createContext(ctx);
  vm.runInContext(codigo + ';__out = detalleBtn;', ctx);
  return ctx.__out;
}

const FILA_SOLICITUD = { id: 303566, usuario: 'juijuh', tipo: 'CARGA', monto: 2000,
                         _fuente: 'SOLICITUD', historial_id: null, solicitud_id: null };
const FILA_MOVIMIENTO = { id: 303566, usuario: 'vero8goat', tipo: 'CARGA', monto: 4000,
                          _fuente: 'HISTORIAL', historial_id: 303566, solicitud_id: null };

test('la fila de una SOLICITUD no manda su numero como si fuera un movimiento', () => {
  const html = boton(FILA_SOLICITUD);
  const args = html.match(/verDetalleMovimiento\(\x27(.*?)\x27,\x27(.*?)\x27,\x27(.*?)\x27\)/);
  assert.ok(args, 'el boton tiene que llamar con los tres datos');
  assert.equal(args[1], '', 'ese numero NO es de un movimiento: va vacio');
  assert.equal(args[2], 'juijuh');
  assert.equal(args[3], '303566', 'el numero viaja como solicitud, que es lo que es');
});

test('la fila de un MOVIMIENTO sigue mandando su numero', () => {
  const html = boton(FILA_MOVIMIENTO);
  const args = html.match(/verDetalleMovimiento\(\x27(.*?)\x27,\x27(.*?)\x27,\x27(.*?)\x27\)/);
  assert.ok(args);
  assert.equal(args[1], '303566');
  assert.equal(args[2], 'vero8goat');
});

test('las dos filas comparten el numero y aun asi no se confunden', () => {
  const a = boton(FILA_SOLICITUD), b = boton(FILA_MOVIMIENTO);
  assert.equal(FILA_SOLICITUD.id, FILA_MOVIMIENTO.id, 'el caso real: el mismo numero');
  assert.notEqual(a, b, 'pero los botones no pueden abrir lo mismo');
});

// ── La guarda del detalle ───────────────────────────────────────────────────────────────────
// Segunda red: aunque llegara un numero equivocado, la ficha no adopta al jugador del guardado
// local. La fila que tocó el operador manda.
function resolver(mov, hRow, usuarioArg){
  const codigo = trozo(PERF, '  const _norm = function(v)', '    mov = null;\r\n  }')
    .replace(/\r\n/g, '\n');
  const ctx = { mov, hRow, usuarioArg, histId: '303566', String,
                console: { warn(){} }, usuario: null };
  vm.createContext(ctx);
  vm.runInContext(codigo + '\n;usuario = usuarioArg || (hRow&&hRow.usuario) || (mov&&mov.usuario) || "";', ctx);
  return { usuario: ctx.usuario, mov: ctx.mov };
}

test('lo guardado con ese numero es de OTRO jugador: se descarta', () => {
  const guardado = { usuario: 'vero8goat', tipo: 'CARGA', monto: 4000, titular: 'Verónica Cecilia Moyano' };
  const r = resolver(guardado, null, 'juijuh');
  assert.equal(r.mov, null, 'no es de esta fila');
  assert.equal(r.usuario, 'juijuh', 'la ficha es del jugador de la fila');
});

test('lo guardado que SI es del mismo jugador se usa', () => {
  const guardado = { usuario: 'vero8goat', tipo: 'CARGA', monto: 4000 };
  const r = resolver(guardado, null, 'vero8goat');
  assert.notEqual(r.mov, null);
  assert.equal(r.usuario, 'vero8goat');
});

test('el nombre no se pierde por mayusculas o espacios', () => {
  const r = resolver({ usuario: ' VeRo8Goat ' }, null, 'vero8goat');
  assert.notEqual(r.mov, null, 'es la misma persona');
});
