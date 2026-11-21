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

test('el signo menos es retiro; los movimientos con agentes y lo que no está DONE no se cotejan', () => {
  const r = emparejar([
    mov('18/11/2026 13:33:38', 'pruebaxx', -5000),                         // signo menos: retiro
    mov('18/11/2026 04:55:16', 'donplata', 180000, 'Pérdida de tokens'),
    mov('16/11/2026 08:43:51', 'xpc02', 520, 'Descargaste saldo a un Agente'),
    { ...mov('18/11/2026 13:00:00', 'pruebaxx', 10000), estado: 'PENDING' }
  ], []);
  assert.equal(r.pares.map(p => p.tipo + ' ' + p.mov.alias).join(','), 'RETIRO pruebaxx');
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

test('lectura vieja o cortada: lo más nuevo que lo leído en Agentes no se acusa (P4, 21/11)', () => {
  const filas = [
    fila(1, '21/11/2026 07:10:00', 'cliente1', 5000, { chunior_movimiento_id: '1' }),   // dentro de lo leído y sin par: se avisa
    fila(2, '21/11/2026 07:28:00', 'cliente2', 9000, { chunior_movimiento_id: '2' }),   // posterior a lo leído: no
    fila(3, '21/11/2026 07:42:00', 'cliente3', 20000, { chunior_movimiento_id: '3' })   // posterior a lo leído: no
  ];
  const leidos = [mov('21/11/2026 07:20:00', 'otro', 1000), mov('21/11/2026 06:00:00', 'otro2', 2000)];
  const r = emparejar(leidos, filas, { desdeLeidoMs: ms('21/11/2026 05:00:00'), hastaLeidoMs: ms('21/11/2026 07:20:00'),
    ahora: ms('21/11/2026 08:30:00') });
  assert.deepEqual(r.sobrantes.map(h => h.id), [1]);
});

test('si se pide techo y la lectura no trajo nada, no se acusa a nadie', () => {
  const r = emparejar([], [fila(1, '21/11/2026 07:10:00', 'cliente1', 5000)],
    { desdeLeidoMs: ms('21/11/2026 05:00:00'), hastaLeidoMs: NaN, ahora: ms('21/11/2026 08:30:00') });
  assert.equal(r.sobrantes.length, 0);
});

test('revisar() pasa el techo (lo más nuevo leído) y deja afuera los bonos', () => {
  assert.match(fuente, /hastaLeidoMs: Number\.isFinite\(masNuevo\) \? masNuevo : NaN/);
  assert.match(fuente, /o !== "COTEJO" && o !== "PROMO_BONO"/);
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
  assert.ok(boton.indexOf('await cargarHistorial()') >= 0 && boton.indexOf('await cargarHistorial()') < boton.indexOf('revisionesFondo({ forzar: true'),
    'primero se dibuja el historial, después se coteja');
  // Agentes + Chunior no avisa: su nota no puede llevar la marca de "fuera de NODO".
  assert.doesNotMatch(fuente, /notas: "[^"]*fuera de NODO[^"]*ya anotada/);
});

// ── Retiros (Juan, 18/11: "fijate también los retiros") ────────────────────────────────────
test('un retiro en Agentes (monto con signo menos) se ata con un RETIRO de NODO, nunca con una carga', () => {
  const r = emparejar([mov('18/11/2026 17:39:11', 'pruebaxx', -15), mov('18/11/2026 17:37:01', 'pruebaxx', 15)], [
    fila(1, '18/11/2026 17:37:05', 'pruebaxx', 15, { tipo: 'CARGA', chunior_movimiento_id: '10183925' }),
    fila(2, '18/11/2026 17:39:20', 'pruebaxx', 15, { tipo: 'RETIRO' })
  ]);
  const carga = r.pares.find(p => p.tipo === 'CARGA'), retiro = r.pares.find(p => p.tipo === 'RETIRO');
  assert.equal(carga.fila.id, 1);
  assert.equal(carga.caso, 'enlazada');
  assert.equal(retiro.fila.id, 2);
  assert.equal(retiro.caso, 'nodo_sin_chunior');
});

test('un retiro solo en Agentes queda como retiro sin NODO, y la carga igual de NODO no lo tapa', () => {
  const r = emparejar([mov('18/11/2026 17:39:11', 'pruebaxx', -15)],
    [fila(1, '18/11/2026 17:39:00', 'pruebaxx', 15, { tipo: 'CARGA', chunior_movimiento_id: '1' })]);
  assert.equal(r.pares[0].tipo, 'RETIRO');
  assert.equal(r.pares[0].caso, 'sin_nodo');
});

test('el módulo lee y avisa cargas y retiros, y a Chunior le pasa el signo', () => {
  assert.match(fuente, /\.in\("tipo", \["CARGA", "RETIRO"\]\)/);
  assert.match(fuente, /registrarRetiroEnChunior\(uid, monto, usuario\)/);
  assert.match(fuente, /verificarMovimientoEnChunior\(usuario, monto, tMs, VENTANA_CHUNIOR_MS, _yaLigadosChunior\(filas\), _signo\(tipo\)\)/);
  const chu = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'chunior-verificacion-y-registro.js'), 'utf8');
  const neg = new Function('return ' + chu.match(/const _neg = (function\(r\)\{[^\n]*\});/)[1])();
  assert.equal(neg({ montoTxt: '$ 12,00' }), false);
  assert.equal(neg({ montoTxt: '$ -15,00' }), true);
  assert.equal(neg({ montoTxt: '-$ 15,00' }), true);
  assert.equal(neg({ montoTxt: '$ 1.500,00' }), false);
  assert.match(chu, /if\(signo > 0 && _neg\(r\)\) continue;/);
});

test('el cartel: la casilla Lo vi va a la izquierda (a la derecha se cortaba) y avisa también lo anotado directo en Chunior', () => {
  const cartel = fuente.slice(fuente.indexOf('async function pintarAvisos'));
  assert.ok(cartel.indexOf('Lo vi</label>') < cartel.indexOf('<b>'), 'la casilla antes que el texto');
  assert.match(cartel, /overflow-wrap:anywhere/);
  assert.match(fuente, /MARCA_CHUNIOR      = "no estaba en NODO"/);
  assert.ok(fuente.includes('"*,notas.ilike.*" + MARCA_CHUNIOR + "*"'), 'la consulta de avisos trae lo de Chunior');
});

// 18/11: "que no haya dos revisiones separadas esperando a que no haya ninguna solicitud".
test('cotejo con Agentes y pasada por Chunior van en UNA fila, detrás del watchdog y nunca encimados', () => {
  const chu = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'cotejo-chunior.js'), 'utf8');
  const wd = fs.readFileSync(path.join(ROOT, 'renderer', 'core', 'modal-y-watchdog.js'), 'utf8');
  // Un solo reloj, el de la fila; ni el cotejo ni la pasada tienen el suyo.
  assert.doesNotMatch(fuente, /setInterval\(function\(\)\{ revisar\(/);
  assert.doesNotMatch(chu, /setInterval\(function\(\)\{ pasada\(/);
  assert.match(fuente, /setInterval\(function\(\)\{ revisionesFondo\(\)/);
  // Uno detrás del otro dentro de la fila.
  const f = fuente.slice(fuente.indexOf('async function revisionesFondo'));
  assert.ok(f.indexOf('await revisar(') < f.indexOf('await window.NodoPasadaChunior.pasada('));
  assert.match(f, /if\(FONDO\.corriendo\) return/);
  assert.match(f, /_operadorTrabajando\(\)\) return/, 'no arranca en medio de lo que hace el operador');
  // El watchdog no lee mientras corre la fila, y al terminar le pasa la posta.
  assert.match(wd, /if\(window\._revisionFondoCorriendo\)\{ _watchdogTrigger\(15000\); return; \}/);
  assert.match(wd, /_revisarFichasRetirosTrasWatchdog\(\); \}catch\(_e\)\{\}\s+\/\/[^\n]*\n\s+try\{ if\(window\._revisionesFondo\)/);
});
