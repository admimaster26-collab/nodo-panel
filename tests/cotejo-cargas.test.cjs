// Cotejo de cargas Agentes ↔ NODO ↔ Chunior (Juan, 18/11). Se prueba el núcleo real del módulo y los
// lectores de los reportes de Drex y agentesbet.io con las filas que pasó Juan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const fuente = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'cotejo-cargas.js'), 'utf8');
const win = {};
vm.runInNewContext(fuente, { window: win, console, Date, Math, Number, String, JSON, setTimeout, setInterval });
const { emparejar } = win.NodoCotejoCargas;

const ms = (s) => { const m = s.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/); return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime(); };
const mov = (fecha, alias, cantidad, tipo = 'Deposito de un jugador') => ({ fecha, ms: ms(fecha), tipo, estado: 'DONE', cantidad, alias });
const fila = (id, fecha, usuario, monto, extra = {}) => ({ id, created_at: new Date(ms(fecha)).toISOString(), usuario, monto, estado: 'OK', ...extra });

test('Agentes y NODO a menos de 3 minutos son la misma carga; con Chunior queda enlazada', () => {
  const r = emparejar([mov('18/11/2026 13:33:38', 'pruebaxx', 10000)],
    [fila(1, '18/11/2026 13:33:20', 'PruebaXX', 10000, { chunior_movimiento_id: '555' })]);
  assert.equal(r.pares[0].caso, 'enlazada');
  assert.equal(r.pares[0].fila.id, 1);
});

test('en NODO pero sin Chunior: hay que subirla', () => {
  const r = emparejar([mov('18/11/2026 13:33:38', 'pruebaxx', 10000)], [fila(1, '18/11/2026 13:34:10', 'pruebaxx', 10000)]);
  assert.equal(r.pares[0].caso, 'nodo_sin_chunior');
});

test('sólo en Agentes: sin NODO', () => {
  const r = emparejar([mov('18/11/2026 13:33:38', 'pruebaxx', 10000)], []);
  assert.equal(r.pares[0].caso, 'sin_nodo');
});

test('los retiros, los movimientos con agentes y lo que no está DONE no son cargas', () => {
  const r = emparejar([
    mov('18/11/2026 13:33:38', 'pruebaxx', -5000),                         // signo menos: retiro
    mov('18/11/2026 04:55:16', 'donplata', 180000, 'Pérdida de tokens'),
    mov('16/11/2026 08:43:51', 'xpc02', 520, 'Descargaste saldo a un Agente'),
    { ...mov('18/11/2026 13:00:00', 'pruebaxx', 10000), estado: 'PENDING' }
  ], []);
  assert.equal(r.pares.length, 0);
});

test('dos cargas iguales en NODO para un movimiento: no se elige, queda en duda', () => {
  const r = emparejar([mov('18/11/2026 13:33:38', 'pruebaxx', 10000)],
    [fila(1, '18/11/2026 13:32:50', 'pruebaxx', 10000), fila(2, '18/11/2026 13:34:30', 'pruebaxx', 10000)]);
  assert.equal(r.pares[0].caso, 'ambiguo');
});

test('la fila que ya lleva la fecha del movimiento en las notas es esa, aunque el horario no cierre', () => {
  const r = emparejar([mov('18/11/2026 13:33:38', 'pruebaxx', 10000)],
    [fila(9, '18/11/2026 14:10:00', 'pruebaxx', 10000, { notas: 'Hecha fuera de NODO · Agentes 18/11/2026 13:33:38', chunior_movimiento_id: '7' })]);
  assert.equal(r.pares[0].caso, 'enlazada');
  assert.equal(r.pares[0].fila.id, 9);
});

test('reloj corrido: una fila igual suelta a menos de una hora no se toca ni se anota dos veces', () => {
  const r = emparejar([mov('18/11/2026 13:33:38', 'pruebaxx', 10000)],
    [fila(1, '18/11/2026 13:45:00', 'pruebaxx', 10000, { chunior_movimiento_id: '5' })],
    { desdeLeidoMs: ms('18/11/2026 08:00:00'), ahora: ms('18/11/2026 15:00:00') });
  assert.equal(r.pares[0].caso, 'ambiguo', 'no es "sin NODO": se anotaría de nuevo en Chunior');
  assert.equal(r.sobrantes.length, 0, 'ni "sin carga en Agentes"');
});

test('anotada en NODO/Chunior y sin carga en Agentes: se avisa, pero sólo si la lectura cubre su horario y ya pasó la gracia', () => {
  const filas = [
    fila(1, '18/11/2026 12:00:00', 'pruebaxx', 7000, { chunior_movimiento_id: '9' }),
    fila(2, '18/11/2026 14:55:00', 'pruebaxx', 3000),                         // muy nueva: todavía no
    fila(3, '18/11/2026 06:00:00', 'pruebaxx', 2000),                         // antes de lo leído
    fila(4, '18/11/2026 12:30:00', 'pruebaxx', 1000, { origen: 'COTEJO' })    // la puso el cotejo
  ];
  const r = emparejar([], filas, { desdeLeidoMs: ms('18/11/2026 08:00:00'), ahora: ms('18/11/2026 15:00:00'),
    esNuestra: h => h.origen !== 'COTEJO' });
  assert.deepEqual(r.sobrantes.map(h => h.id), [1]);
});

test('sin saber hasta dónde se leyó Agentes, no se acusa a nadie', () => {
  const r = emparejar([], [fila(1, '18/11/2026 12:00:00', 'pruebaxx', 7000)], { ahora: ms('18/11/2026 15:00:00') });
  assert.equal(r.sobrantes.length, 0);
});

// ── Lectores de los reportes ─────────────────────────────────────────────────────────────
test('Drex: el monto viene en formato inglés con el signo adelante', () => {
  const src = fs.readFileSync(path.join(ROOT, 'agent-preload.js'), 'latin1');
  const f = src.match(/function _montoMovDrex\(t\) \{[\s\S]*?\r?\n\}/)[0];
  const monto = new Function(f + '\nreturn _montoMovDrex;')();
  assert.equal(monto('-ARS 5,000.00'), -5000);
  assert.equal(monto('ARS 10,000.00'), 10000);
  assert.equal(monto('ARS 180,520.00'), 180520);
  assert.equal(monto('ARS 520.00'), 520);
  assert.equal(monto('ARS 17,929.36'), 17929.36);
  const fe = src.match(/function _fechaMovDrex\(t\) \{[\s\S]*?\r?\n\}/)[0];
  const fecha = new Function(fe + '\nreturn _fechaMovDrex;')();
  assert.equal(fecha('18/11/2026 13:33:38'), ms('18/11/2026 13:33:38'));
});

test('Drex: se aprieta la pestaña "Movimientos de crédito" y main abre la pantalla', () => {
  const src = fs.readFileSync(path.join(ROOT, 'agent-preload.js'), 'latin1');
  const api = src.slice(src.indexOf('const api = {'), src.indexOf('const api = {') + 400);
  assert.match(api, /leerMovimientosCredito,/);
  assert.match(src, /movimientos de cr\/i/);
  const backends = fs.readFileSync(path.join(ROOT, 'main', 'agent-backends.js'), 'utf8');
  assert.match(backends, /movimientosUrl:'https:\/\/bo\.casinodrex\.com\/agents\/activity'/);
  const automation = fs.readFileSync(path.join(ROOT, 'main', 'automation.js'), 'utf8');
  assert.match(automation, /method === 'leerMovimientosCredito'\) preNav = backends\.current\.movimientosUrl/);
});

test('agentesbet.io: lee el reporte por el menú, saltea la fila de Totales y el monto argentino', () => {
  const src = fs.readFileSync(path.join(ROOT, 'agent-preload-bet300.js'), 'utf8');
  const api = src.slice(src.indexOf('const api = {'), src.indexOf('const api = {') + 600);
  assert.match(api, /leerMovimientosCredito,/);
  assert.match(src, /findMenuItem\(\/reporte de carga\|carga y descarga\/i\)/);
  assert.match(src, /td\.length < 5\) return null;\s+\/\/ la fila de "Totales" tiene 4/);
  const pm = src.match(/function parseMoney\(v\) \{[\s\S]*?\n\}/)[0];
  const parseMoney = new Function(pm + '\nreturn parseMoney;')();
  assert.equal(parseMoney('-5.000 ARS'), 5000, 'el signo lo pone _filasReporte');
  assert.equal(parseMoney('10.000 ARS'), 10000);
});

test('el botón Recargar del historial coteja después de dibujar', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'renderer', 'panel.template.html'), 'utf8');
  assert.match(tpl, /onclick="nodoHistorialRecargar\(this\)"/);
  const manifest = fs.readFileSync(path.join(ROOT, 'renderer', 'manifest.json'), 'utf8');
  assert.match(manifest, /"core\/cotejo-cargas\.js"/);
  const boton = fuente.slice(fuente.indexOf('window.nodoHistorialRecargar'));
  assert.ok(boton.indexOf('await cargarHistorial()') >= 0 && boton.indexOf('await cargarHistorial()') < boton.indexOf('revisar("recargar")'),
    'primero se dibuja el historial, después se coteja');
  // Agentes + Chunior no avisa: su nota no puede llevar la marca de "fuera de NODO".
  assert.doesNotMatch(fuente, /notas: "[^"]*fuera de NODO[^"]*ya anotada/);
});
