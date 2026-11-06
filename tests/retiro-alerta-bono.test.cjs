const test = require('node:test');
const assert = require('node:assert/strict');
const withdrawalAlerts = require('../renderer/portal/withdrawal-alerts');

// El aviso de bono sale sólo si el retiro se lleva justo la carga más el bono.
//
// Juan, 4/11: "si el cuanto se lleva de mas es mayor al bono en si y a la carga anterior cual es
// el chiste de decir que se lleva de mas? el tema es si retira el mismo bono y el mismo monto de
// la carga redondo". Antes salía "BONO SIN LIBERAR" en todo retiro con bono de la semana, también
// en el de quien cargó 8.000, recibió 1.600 y pedía 18.000: ese jugó y ganó.

function alerta(fila, opts) {
  const ventana = { _retiroAlertas: { 7: Object.assign({ solicitud_id: 7, cbu_cuentas: 0 }, fila) } };
  const { globals } = withdrawalAlerts.create({
    esc: (s) => String(s),
    money: (n) => '$ ' + Number(n).toLocaleString('es-AR'),
    window: ventana
  });
  return globals._alertaRetiroHtml(7, opts);
}

const conBono = { bono_monto: 1600, bono_horas: 0.2, cargado_real: 8000, retirado_previo: 0 };

test('carga 8.000 + bono 1.600 y pide 9.600: avisa', () => {
  const html = alerta(conBono, { monto: 9600, expandido: true });
  assert.match(html, /RETIRA LA CARGA Y EL BONO/);
  assert.match(html, /cargó \$ 8\.000 \+ bono \$ 1\.600/);
  assert.match(html, /pide \$ 9\.600/);
  assert.doesNotMatch(html, /verificá|se lleva|SIN LIBERAR/);
});

test('pide 18.000: jugó y ganó, no avisa', () => {
  assert.equal(alerta(conBono, { monto: 18000, expandido: true }), '');
  assert.equal(alerta(conBono, { monto: 18000 }), '');
});

test('pide menos que carga + bono: no avisa', () => {
  assert.equal(alerta(conBono, { monto: 9000, expandido: true }), '');
  assert.equal(alerta(conBono, { monto: 8000, expandido: true }), '');
});

test('lo ya retirado cuenta: retiró 5.000 y pide 4.600, avisa', () => {
  const html = alerta(Object.assign({}, conBono, { retirado_previo: 5000 }), { monto: 4600, expandido: true });
  assert.match(html, /RETIRA LA CARGA Y EL BONO/);
  assert.match(html, /ya retiró \$ 5\.000/);
});

test('la tarjeta lleva el renglón corto', () => {
  const html = alerta(conBono, { monto: 9600 });
  assert.match(html, /RETIRA LA CARGA Y EL BONO/);
  assert.doesNotMatch(html, /pide/);
});

test('bono de hace más de 7 días o sin monto pedido: no avisa', () => {
  assert.equal(alerta(Object.assign({}, conBono, { bono_horas: 8 * 24 }), { monto: 9600 }), '');
  assert.equal(alerta(conBono, {}), '');
});

test('el CBU compartido sigue saliendo aunque no haya aviso de bono', () => {
  const html = alerta(Object.assign({}, conBono, { cbu_cuentas: 3, cbu: '000123', cbu_usuarios: 'a · b · c' }), { monto: 18000, expandido: true });
  assert.match(html, /CBU COMPARTIDO/);
  assert.doesNotMatch(html, /BONO/);
});
