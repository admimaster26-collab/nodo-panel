const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// La base local de jugadores se siembra por tandas: una lectura y una escritura del almacén.
//
// En la PC de Sánchez (6/11), después de entrar a Chunior la pantalla quedaba 36 s sin mandar nada
// al servidor y Electron la recargaba; el ciclo se repitió diez veces seguidas, una cada 70 s. Al
// arrancar se siembran cientos de filas del historial y de las solicitudes, y cada una leía,
// interpretaba y reescribía el almacén entero. Se ejecuta el archivo real con un almacén que cuenta.

const fuente = fs.readFileSync(path.join(__dirname, '../renderer/core/jugadores-bloqueos.js'), 'utf8');

function armar(inicial) {
  const datos = new Map(Object.entries(inicial || { nodo_jugadores_local_v2: '{}' }));
  const cuenta = { get: 0, set: 0 };
  const localStorage = {
    getItem: (k) => { if (k === 'nodo_jugadores_local_v2') cuenta.get++; return datos.has(k) ? datos.get(k) : null; },
    setItem: (k, v) => { if (k === 'nodo_jugadores_local_v2') cuenta.set++; datos.set(k, String(v)); },
    removeItem: (k) => datos.delete(k)
  };
  const ctx = { console, localStorage, toast() {}, _movStoreAll: () => ({}), billeteras: [] };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx);
  cuenta.get = 0; cuenta.set = 0;
  return { ctx, cuenta, base: () => JSON.parse(datos.get('nodo_jugadores_local_v2')) };
}

const tanda = [
  ['Pepe12', { cbu: '0000003100012345678901', titular: 'Pepe Uno', fecha: '2026-11-06T09:00:00Z' }],
  ['pepe12', { telefono: '11 2233-4455', fecha: '2026-11-06T09:01:00Z' }],
  ['ana7', { titular: 'Ana Siete', fecha: '2026-11-06T09:02:00Z' }]
];

test('una tanda lee y escribe el almacén una sola vez', () => {
  const { ctx, cuenta } = armar();
  ctx.jugadorRegistrarDatos(tanda);
  assert.equal(cuenta.get, 1);
  assert.equal(cuenta.set, 1);
});

test('la tanda deja la misma base que registrar uno por uno', () => {
  const uno = armar();
  tanda.forEach(([u, d]) => uno.ctx.jugadorRegistrarDato(u, d));
  assert.equal(uno.cuenta.set, 3);
  const otro = armar();
  otro.ctx.jugadorRegistrarDatos(tanda);
  const sinCreado = (b) => JSON.parse(JSON.stringify(b, (k, v) => (k === 'creado' ? undefined : v)));
  assert.deepEqual(sinCreado(otro.base()), sinCreado(uno.base()));
  const pepe = otro.base().pepe12;
  assert.equal(Object.keys(pepe.cbus).length, 1);
  assert.equal(pepe.telefonos['1122334455'].veces, 1);
});

test('una tanda vacía o con filas rotas no rompe ni escribe de más', () => {
  const { ctx, cuenta } = armar();
  ctx.jugadorRegistrarDatos([]);
  assert.equal(cuenta.set, 0);
  ctx.jugadorRegistrarDatos([null, ['', { titular: 'x' }], ['ok1', { titular: 'Ok Uno' }]]);
  assert.equal(cuenta.set, 1);
});
