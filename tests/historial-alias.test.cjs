const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// El alias del retiro se lee con las notas viejas ("Destino:") y con las nuevas ("Alias:").
//
// Juan, 6/11: "me gusta como se ve el alias asi de la persona pero en la proxima solicitud ya no se
// ve mas asi". Desde el 10/09 portalNotasBase escribe "Alias:"; el lector sólo buscaba "Destino:",
// así que el alias seguía en la nota pero el perfil no lo mostraba y no llegaba a la ficha.

const fuente = fs.readFileSync(path.join(__dirname, '../renderer/core/historial-movimientos.js'), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem() {} } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fuente, ctx);

test('nota vieja: Destino', () => {
  const n = ctx._movParseNotas('Solicitud portal #198224 · Declarado $ 160.000 / aprobado $ 160.000 · Titular: Fulano Demo · Destino: alias.demo · ARS 1');
  assert.equal(n.destino, 'alias.demo');
  assert.equal(n.titular, 'Fulano Demo');
});

test('nota nueva: Alias', () => {
  const n = ctx._movParseNotas('#202315 · Titular: Fulano Demo · Alias: alias.demo · ARS 160,056.52');
  assert.equal(n.destino, 'alias.demo');
  assert.equal(n.titular, 'Fulano Demo');
});

test('si están los dos, manda Destino', () => {
  assert.equal(ctx._movParseNotas('Destino: uno · Alias: dos').destino, 'uno');
});
