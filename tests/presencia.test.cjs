const test = require('node:test');
const assert = require('node:assert/strict');
const presencia = require('../renderer/domain/presencia.js');

const AHORA = new Date('2026-09-26T18:00:00Z').getTime();
const hace = (min) => new Date(AHORA - min * 60000).toISOString();

const armar = (solicitudes, extra) => presencia.armar(Object.assign(
  { solicitudes, ahora: AHORA, version: '2.1.3', pc: 'P4' }, extra || {}));

test('cuenta las pendientes y dice cuándo fue la última carga', () => {
  const r = armar([
    { TIPO: 'CARGA',  ESTADO: 'PENDIENTE',   FECHA_CREACION: hace(1) },
    { TIPO: 'RETIRO', ESTADO: 'PENDIENTE',   FECHA_CREACION: hace(2) },
    { TIPO: 'CARGA',  ESTADO: 'EN_PROCESO',  FECHA_CREACION: hace(3) },
    { TIPO: 'CARGA',  ESTADO: 'ACREDITADA',  FECHA_CREACION: hace(3) }
  ]);
  assert.equal(r.details, '3 solicitudes pendientes');
  assert.equal(r.state, 'Última carga hace 3 min');
  assert.equal(r.largeText, 'NODO 2.1.3 · P4');
});

test('los retiros pagándose por partes NO cuentan como pendientes', () => {
  // Ya se aceptaron y se están trabajando: no están esperando que alguien las agarre.
  const parcial = { ID: 1, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO', FECHA_CREACION: hace(5) };
  const nueva   = { ID: 2, TIPO: 'RETIRO', ESTADO: 'PENDIENTE',  FECHA_CREACION: hace(1) };
  const r = armar([parcial, nueva], { esParcial: (s) => s.ID === 1 });
  assert.equal(r.details, '1 solicitud pendiente');
  assert.equal(r.pendientes, 1);
});

test('lo cerrado no cuenta, y el soporte tampoco', () => {
  const r = armar([
    { TIPO: 'CARGA',   ESTADO: 'ACREDITADA', FECHA_CREACION: hace(10) },
    { TIPO: 'RETIRO',  ESTADO: 'PAGADA',     FECHA_CREACION: hace(10) },
    { TIPO: 'RETIRO',  ESTADO: 'RECHAZADA',  FECHA_CREACION: hace(10) },
    { TIPO: 'SOPORTE', ESTADO: 'PENDIENTE',  FECHA_CREACION: hace(1) }
  ]);
  assert.equal(r.details, 'Sin solicitudes pendientes');
});

test('sin cargas lo dice, en vez de mentir con un tiempo', () => {
  const r = armar([{ TIPO: 'RETIRO', ESTADO: 'PENDIENTE', FECHA_CREACION: hace(1) }]);
  assert.equal(r.state, 'Sin cargas todavía');
});

test('los tiempos se leen como los diría una persona', () => {
  assert.equal(presencia.hace(0), 'recién');
  assert.equal(presencia.hace(59 * 1000), 'recién');
  assert.equal(presencia.hace(3 * 60000), 'hace 3 min');
  assert.equal(presencia.hace(60 * 60000), 'hace 1 h');
  assert.equal(presencia.hace(65 * 60000), 'hace 1 h 5 min');
  assert.equal(presencia.hace(49 * 60 * 60000), 'hace 2 d');
});

test('sólo se publica si cambió algo: Discord limita los updates', () => {
  const a = armar([{ TIPO: 'CARGA', ESTADO: 'PENDIENTE', FECHA_CREACION: hace(1) }]);
  const b = armar([{ TIPO: 'CARGA', ESTADO: 'PENDIENTE', FECHA_CREACION: hace(1) }]);
  assert.equal(presencia.distinta(a, b), false, 'lo mismo dos veces no se manda');
  const c = armar([
    { TIPO: 'CARGA', ESTADO: 'PENDIENTE', FECHA_CREACION: hace(1) },
    { TIPO: 'CARGA', ESTADO: 'PENDIENTE', FECHA_CREACION: hace(1) }
  ]);
  assert.equal(presencia.distinta(a, c), true);
  assert.equal(presencia.distinta(null, a), true);
});

test('sin datos no explota', () => {
  const r = presencia.armar();
  assert.equal(r.details, 'Sin solicitudes pendientes');
  assert.equal(r.state, 'Sin cargas todavía');
  assert.equal(presencia.armar({ solicitudes: [{}, null] }).pendientes, 2,
    'una solicitud sin estado sigue estando pendiente de alguien');
});

test('el número de la lista de Inicio manda sobre la cuenta propia', () => {
  const tres = [1, 2, 3].map(() => ({ TIPO: 'CARGA', ESTADO: 'PENDIENTE', FECHA_CREACION: hace(1) }));
  assert.equal(armar(tres, { pendientes: 0 }).details, 'Sin solicitudes pendientes');
  assert.equal(armar(tres, { pendientes: 2 }).details, '2 solicitudes pendientes');
  assert.equal(armar(tres).details, '3 solicitudes pendientes', 'sin número de la pantalla, cuenta');
  assert.equal(armar(tres, { pendientes: 'x' }).details, '3 solicitudes pendientes');
});

test('sin datos frescos lo dice, en vez de dar un número', () => {
  const r = armar([{ TIPO: 'CARGA', ESTADO: 'PENDIENTE', FECHA_CREACION: hace(1) }], { sinDatos: true });
  assert.equal(r.details, 'Sin datos: no se pudo consultar');
});
