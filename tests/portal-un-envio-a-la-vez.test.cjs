const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Un toque, una solicitud.
//
// Juan, 7/10: el mismo jugador mandaba la misma carga 5 y 8 veces seguidas.
//
// No era un jugador insistente. Lo dicen las horas que el propio portal manda en cada solicitud:
//
//   rodrigocuarteto · 8 cargas de $3.000 · #318147 a #318154
//     la 1ª  → toque 01:09:04.520 · envío 01:09:10.824    (6,3 s esperando)
//     las 7  → toque = envío, entre .826 y .848            (22 ms entre todas)
//
// "toque = envío" significa que NO hubo un toque nuevo: el reloj del toque ya se había consumido.
// Los 8 envíos salieron de la misma pantalla con el botón todavía apretable, porque el botón se
// apagaba DESPUÉS de las consultas al servidor.
//
// Desde el 3/10 —el día del portal nuevo— esto pasó de 0 por día a 73.

const PORTAL = fs.readFileSync(process.env.PORTAL_A_PROBAR || path.join(__dirname, '..', 'Portal'), 'utf8');

function sacar(firma){
  const i = PORTAL.indexOf(firma);
  assert.notEqual(i, -1, 'no está en el Portal: ' + firma);
  const j = PORTAL.indexOf('{', i);
  let n = 0, fin = -1;
  for(let k = j; k < PORTAL.length; k++){
    if(PORTAL[k] === '{') n++;
    else if(PORTAL[k] === '}'){ n--; if(!n){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1, 'no cierra: ' + firma);
  return PORTAL.slice(i, fin);
}

// La pantalla de mentira. Lo único que interesa es cuántas veces se manda de verdad.
function armar(opciones){
  const o = opciones || {};
  const enviados = [];
  const boton = { disabled:false, textContent:'Ya transferí · Enviar solicitud', classList:{ add(){}, remove(){} } };
  const campo = (v) => ({ value:v, classList:{ add(){}, remove(){} }, scrollIntoView(){}, focus(){} });

  const ctx = {
    _enviando: false,
    enviados,
    boton,
    $: (id) => {
      if(id === 'btnEnviarCarga') return boton;
      if(id === 'cargaMonto')   return campo(o.monto   != null ? o.monto   : '3000');
      if(id === 'cargaTitular') return campo(o.titular != null ? o.titular : 'DOMINGUEZ RODRIGO LEONEL');
      return null;
    },
    state: { usuario:'rodrigocuarteto' },
    toast: () => {}, haptic: () => {},
    marcarFaltantes: () => false,
    _minCarga: () => 1000,
    _money: (v) => '$ ' + v,
    validarTitular: () => (o.titularMalo || null),
    _titularEsNuestro: () => !!o.titularNuestro,
    _titularAviso: () => {},
    tieneSolicitudPendiente: () => false,
    // Esta es la consulta que dejaba el botón apretable 6 segundos.
    _titularBloqueado: () => new Promise(res => setTimeout(() => res(false), 30)),
    _marcarToque: () => { ctx.toques = (ctx.toques||0) + 1; },
    enviarSolicitudCarga: (u, m, t) => new Promise(res => setTimeout(() => { enviados.push({u,m,t}); res(); }, 20)),
    Number, String, Promise, setTimeout, console
  };
  vm.createContext(ctx);
  vm.runInContext([
    sacar('function _restaurarBoton('),
    sacar('function _tomarEnvio('),
    sacar('function _soltarEnvio('),
    sacar('async function enviarSolicitudCargaDirecta(')
  ].join('\n'), ctx);
  return ctx;
}

test('ocho toques mientras espera el servidor mandan UNA sola solicitud', async () => {
  const c = armar();
  // Tal cual pasó: el jugador toca 8 veces en el mismo segundo, sin esperar.
  await Promise.all(Array.from({ length: 8 }, () => c.enviarSolicitudCargaDirecta()));
  assert.equal(c.enviados.length, 1, 'ocho toques, una carga');
});

test('cinco toques tampoco: el caso de bautistaenbet', async () => {
  const c = armar();
  await Promise.all(Array.from({ length: 5 }, () => c.enviarSolicitudCargaDirecta()));
  assert.equal(c.enviados.length, 1);
});

test('el boton se apaga ANTES de consultar al servidor, no despues', async () => {
  const c = armar();
  const enVuelo = c.enviarSolicitudCargaDirecta();
  // Sin esperar nada: en este punto ya pasó el primer toque y todavía no contestó el servidor.
  assert.equal(c.boton.disabled, true, 'si sigue apretable, el jugador vuelve a tocar');
  assert.equal(c.boton.textContent, 'Enviando...');
  await enVuelo;
});

test('despues de mandar, el boton vuelve: se puede operar de nuevo', async () => {
  const c = armar();
  await c.enviarSolicitudCargaDirecta();
  assert.equal(c.boton.disabled, false);
  assert.equal(c.boton.textContent, 'Ya transferí · Enviar solicitud');
  await c.enviarSolicitudCargaDirecta();
  assert.equal(c.enviados.length, 2, 'dos envios de verdad, uno despues del otro');
});

test('si una validacion corta, el boton NO queda trabado', async () => {
  const c = armar({ titularMalo: 'Poné el nombre completo' });
  await c.enviarSolicitudCargaDirecta();
  assert.equal(c.enviados.length, 0, 'no se mando nada');
  assert.equal(c.boton.disabled, false, 'y el jugador puede corregir y reintentar');
});

test('tampoco queda trabado si el titular es el nuestro', async () => {
  const c = armar({ titularNuestro: true });
  await c.enviarSolicitudCargaDirecta();
  assert.equal(c.enviados.length, 0);
  assert.equal(c.boton.disabled, false);
});
