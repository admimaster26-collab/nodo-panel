const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Los botones de una fila tienen que ser lo que se puede hacer CON ESA fila.
//
// Juan, 6/10, por quinta vez: "no hay billetera registrada si no se realizo la carga... si hay
// cosas que involucran a otra cosa relacionada... una solicitud con todo lo que se puede hacer
// en base a eso... y ahora que tenemos lo de recuperar solicitudes eliminadas, ponelo ahi".
//
// La fila de su foto: 6/10 11:37 · CARGA · gracieeela228 · $10.000 · saldo pre — · saldo post —
// · GIORDANO · PORTAL · ✖ rechazada. Y los botones eran lupa, "Cambiar billetera" y "Clave".
// Cambiar billetera ahí no corrige nada: no hay operación, no hay billetera anotada.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'historial-operaciones.js'), 'utf8');

function botonesDe(h){
  const i = SRC.indexOf('    const rowClass =');
  assert.notEqual(i, -1, 'no está el armado de la fila');
  const fin = SRC.indexOf('const acciones = [', i);
  assert.notEqual(fin, -1);
  const codigo = SRC.slice(i, SRC.indexOf('\n', fin) + 1).replace(/\r/g, '');

  const ctx = {
    h, billeteras: [],
    escapeHtml: (v) => String(v == null ? '' : v),
    money: (v) => '$ ' + v,
    _errTextoLimpio: () => '', _errEtiqueta: () => '',
    localStorage: { getItem: () => null },
    String, Number, Boolean,
    acciones: ''
  };
  vm.createContext(ctx);
  vm.runInContext(codigo + '\n;__out = acciones;', ctx);
  return ctx.__out;
}

const RECHAZADA = {            // la fila de la foto
  id: 311564, usuario: 'gracieeela228', tipo: 'CARGA', monto: 10000,
  estado: 'RECHAZADA', origen: 'PORTAL', _fuente: 'SOLICITUD',
  solicitud_id: 311564, historial_id: null,   // como llega de verdad: la solicitud se identifica
  saldo_pre: null, saldo_post: null, chunior_movimiento_id: null, billetera_id: 'b1'
};
const HECHA_CON_CHUNIOR = {
  id: 303566, usuario: 'vero8goat', tipo: 'CARGA', monto: 4000,
  estado: 'OK', origen: 'PORTAL', _fuente: 'HISTORIAL', historial_id: 303566,
  saldo_pre: 17, saldo_post: 4017, chunior_movimiento_id: '9815985', billetera_id: 'b1'
};
const HECHA_SIN_CHUNIOR = {
  id: 303567, usuario: 'otro', tipo: 'CARGA', monto: 2000,
  estado: 'OK', origen: 'PORTAL', _fuente: 'HISTORIAL', historial_id: 303567,
  saldo_pre: 8, saldo_post: 2008, chunior_movimiento_id: null, billetera_id: 'b1'
};
const PENDIENTE = {
  id: 311600, usuario: 'alguien', tipo: 'CARGA', monto: 5000,
  estado: 'PENDIENTE', origen: 'PORTAL', _fuente: 'SOLICITUD', solicitud_id: 311600, solicitud_id: 311600,
  saldo_pre: null, saldo_post: null, chunior_movimiento_id: null, billetera_id: 'b1'
};

test('una RECHAZADA no ofrece cambiar billetera: no hay operacion que corregir', () => {
  const b = botonesDe(RECHAZADA);
  assert.ok(!b.includes('Cambiar billetera'), 'la plata nunca se movio');
});

test('una RECHAZADA ofrece Recuperar, que es lo que SI se puede hacer', () => {
  const b = botonesDe(RECHAZADA);
  assert.ok(b.includes('Recuperar'));
  assert.ok(b.includes('recuperarSolicitudRechazada(\x27311564\x27'),
    'con el numero de la SOLICITUD, no el del movimiento');
});

test('una carga hecha SI ofrece cambiar billetera', () => {
  assert.ok(botonesDe(HECHA_CON_CHUNIOR).includes('Cambiar billetera'));
  assert.ok(botonesDe(HECHA_SIN_CHUNIOR).includes('Cambiar billetera'),
    'sin N° de Chunior pero con saldos: la operacion ocurrio');
});

test('una carga hecha NO ofrece Recuperar', () => {
  assert.ok(!botonesDe(HECHA_CON_CHUNIOR).includes('Recuperar'));
});

test('una PENDIENTE no ofrece ninguna de las dos', () => {
  const b = botonesDe(PENDIENTE);
  assert.ok(!b.includes('Cambiar billetera'), 'todavia no se movio nada');
  assert.ok(!b.includes('Recuperar'), 'no hay nada que recuperar: no se rechazo');
});

test('la clave sigue estando: es del usuario, no de la operacion', () => {
  assert.ok(botonesDe(RECHAZADA).includes('Clave'));
  assert.ok(botonesDe(HECHA_CON_CHUNIOR).includes('Clave'));
});

test('Deshacer solo donde hubo plata movida', () => {
  assert.ok(botonesDe(HECHA_CON_CHUNIOR).includes('Deshacer'));
  assert.ok(!botonesDe(RECHAZADA).includes('Deshacer'));
  assert.ok(!botonesDe(PENDIENTE).includes('Deshacer'));
});

// ── Copiar la cuenta desde la fila ──────────────────────────────────────────────────────────
// Juan, 6/10: el usuario se copia fácil y ya casi no sirve; el CBU/alias, que es lo que se pega
// en el banco, había que ir a buscarlo abriendo la ficha.

function celdaBilletera(h){
  const i = SRC.indexOf('    const _cuenta = (window.NodoDomain');
  assert.notEqual(i, -1, 'no está el chip de la cuenta');
  const fin = SRC.indexOf('      : \'\';', i);
  assert.notEqual(fin, -1);
  const codigo = SRC.slice(i, SRC.indexOf('\n', fin) + 1).replace(/\r/g, '');
  const ctx = {
    h, escapeHtml: (v) => String(v == null ? '' : v),
    window: { NodoDomain: { identidad: require('../renderer/domain/identidad.js') } },
    String, _cuentaChip: ''
  };
  vm.createContext(ctx);
  vm.runInContext(codigo + '\n;__out = _cuentaChip;', ctx);
  return ctx.__out;
}

test('un RETIRO deja copiar el CBU del jugador desde la fila', () => {
  const chip = celdaBilletera({ tipo:'RETIRO', usuario:'juan', metadata:{ destino:'juan.perez.mp' } });
  assert.ok(chip.includes('portalCopiarCbu'), 'usa el copiado que ya existe');
  assert.ok(chip.includes('data-valor="juan.perez.mp"'));
  assert.ok(chip.includes('CBU'), 'rotulado: es la cuenta del jugador');
});

test('una CARGA no ofrece copiar nada: la cuenta es nuestra', () => {
  // Juan, 6/10: "la cuenta nuestra no necesitamos el cbu, para que lo quiero". El operador no
  // la pega en ningun lado y la tiene arriba en las billeteras.
  const chip = celdaBilletera({ tipo:'CARGA', usuario:'juan', metadata:{ billetera_alias:'giordano.mp' } });
  assert.equal(chip, '');
});

test('sin cuenta no aparece ningun boton', () => {
  assert.equal(celdaBilletera({ tipo:'CARGA', usuario:'juan' }), '');
  assert.equal(celdaBilletera({ tipo:'RETIRO', usuario:'juan' }), '');
});

// ── Deshacer sólo donde se sabe QUÉ se revierte ─────────────────────────────────────────────
// Auditoría del 9/10. Una solicitud acreditada no tiene número de movimiento, y el botón salía
// igual: deshacerOperacion arrancaba con el id vacío, sacaba las fichas, después intentaba
// marcar REVERTIDA una fila que no existe —sin mirar el resultado— y anotaba una reversión
// colgada de la nada. La solicitud tampoco se reabría.

const SOLICITUD_ACREDITADA_SIN_MOVIMIENTO = {
  id: 311900, usuario: 'jugador', tipo: 'CARGA', monto: 5000,
  estado: 'ACREDITADA', origen: 'PORTAL', _fuente: 'SOLICITUD',
  solicitud_id: 311900, historial_id: null,
  saldo_pre: null, saldo_post: null, chunior_movimiento_id: null, billetera_id: 'b1'
};

test('una solicitud acreditada SIN movimiento no ofrece Deshacer', () => {
  const b = botonesDe(SOLICITUD_ACREDITADA_SIN_MOVIMIENTO);
  assert.ok(!b.includes('Deshacer'), 'no hay movimiento que revertir ni donde anotarlo');
});

test('un movimiento de verdad SI ofrece Deshacer', () => {
  const b = botonesDe({ id: 303567, usuario: 'otro', tipo: 'CARGA', monto: 2000,
    estado: 'OK', origen: 'PORTAL', _fuente: 'HISTORIAL', historial_id: 303567,
    saldo_pre: 8, saldo_post: 2008, billetera_id: 'b1' });
  assert.ok(b.includes('Deshacer'));
  assert.ok(b.includes('deshacerOperacion(\x27303567\x27'), 'con el numero del movimiento');
});
