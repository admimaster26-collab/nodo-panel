const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const identidad = require('../renderer/domain/identidad.js');

// La tarjeta de cotejo usa el veredicto que YA está guardado.
//
// Juan, 6/10: "mezcla varios usuarios los cuales esta perfecto por que asi es pero aun asi
// estorba visualmente y no entrega informacion lo suficientemente relevante como para poder
// resolver con la informacion que tenes ahi mismo".
//
// El caso de su pantalla, tal como está en la base ese día:
//
//     gracieeela228   tel 2241460009   VINCULADO
//     gracieeeela228  tel 2241460009   DUPLICADO
//     grcieeela228    tel 2241460009   DUPLICADO
//
// La tarjeta decía "lo comparten 3 cuentas" y ofrecía botones para usar las DOS duplicadas —
// que la base ya había resuelto que no eran la cuenta buena. El operador tenía que decidir a
// mano algo que ya estaba decidido, y cada vez que alguien apretaba uno nacía otra cuenta.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'cotejo-alta.js'), 'utf8');

function filtrar(otros, duenoActual){
  const i = SRC.indexOf('const _otrosDuenosTodos');
  assert.notEqual(i, -1, 'no está el filtro de dueños');
  const fin = SRC.indexOf('const _duplicadosYa', i);
  assert.notEqual(fin, -1);
  const codigo = SRC.slice(i, SRC.indexOf('\n', fin) + 1).replace(/\r/g, '');

  const ctx = {
    r: { telefono: { otros } },
    tOk: { usuario: duenoActual },
    _altaNormU: (v) => String(v || '').trim().toLowerCase(),
    window: { NodoDomain: { identidad } },
    __otros: null, __dups: null
  };
  vm.createContext(ctx);
  vm.runInContext(codigo + '\n;__otros=_otrosDuenos; __dups=_duplicadosYa;', ctx);
  return { ofrecidos: ctx.__otros, duplicados: ctx.__dups };
}

const LOS_TRES = [
  { usuario: 'gracieeela228',  pc: 'P4', vinculo: 'VINCULADO' },
  { usuario: 'gracieeeela228', pc: 'P4', vinculo: 'DUPLICADO' },
  { usuario: 'grcieeela228',   pc: 'P4', vinculo: 'DUPLICADO' }
];

test('las cuentas ya marcadas como duplicadas no se ofrecen', () => {
  const r = filtrar(LOS_TRES, 'gracieeela228');
  assert.equal(r.ofrecidos.length, 0, 'no queda nada que preguntar');
  assert.equal(r.duplicados.length, 2);
  assert.deepEqual(r.duplicados.map(o => o.usuario).sort(),
                   ['gracieeeela228', 'grcieeela228']);
});

test('una cuenta sin resolver SI se ofrece', () => {
  const r = filtrar([
    { usuario: 'gracieeela228', pc: 'P4', vinculo: 'VINCULADO' },
    { usuario: 'otra228',       pc: 'P4', vinculo: 'PENDIENTE' },
    { usuario: 'vieja228',      pc: 'P4', vinculo: 'DUPLICADO' }
  ], 'gracieeela228');
  assert.deepEqual(r.ofrecidos.map(o => o.usuario), ['otra228'],
    'la pendiente es la unica que el operador tiene que mirar');
  assert.deepEqual(r.duplicados.map(o => o.usuario), ['vieja228']);
});

test('sin veredicto guardado se ofrece igual: no se esconde nada', () => {
  const r = filtrar([
    { usuario: 'gracieeela228', pc: 'P4', vinculo: 'VINCULADO' },
    { usuario: 'sinpadron',     pc: 'P4' }
  ], 'gracieeela228');
  assert.deepEqual(r.ofrecidos.map(o => o.usuario), ['sinpadron']);
});

test('el dueño actual nunca se ofrece a si mismo', () => {
  const r = filtrar(LOS_TRES, 'gracieeela228');
  assert.ok(!r.ofrecidos.some(o => o.usuario === 'gracieeela228'));
  assert.ok(!r.duplicados.some(o => o.usuario === 'gracieeela228'));
});
