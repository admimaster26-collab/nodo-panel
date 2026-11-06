const test = require('node:test');
const assert = require('node:assert/strict');
const crear = require('../renderer/runtime/pruebas-sistema.js').create;
const crearSalud = require('../renderer/runtime/integration-health.js').create;

// "Probar ahora": las pruebas llaman a la función principal de cada parte y dicen cuál se cortó.
//
// Juan, 1/11: "muy lindo pero tampoco permite correr pruebas ni tampoco detecta los cambios de
// billetera". Se ejecuta el motor real de salud con funciones de mentira que anotan como las reales.

function armar(extra) {
  const llamadas = [];
  const root = Object.assign({ pcOperativa: 'P1', setTimeout, clearTimeout }, extra);
  root.NodoSalud = crearSalud(root);
  const anota = (nombre, rama, codigo) => async (...a) => {
    llamadas.push([nombre, ...a]);
    const h = root.NodoSalud.begin(rama);
    if (codigo) h.record('DATA', 'ERROR', codigo); else h.record('DATA', 'OK');
  };
  root.cargarBilleteras = async (...a) => { llamadas.push(['billeteras', ...a]); return root.falla?.billeteras ? [] : [{ ID_BILLETERA: 1 }]; };
  root.cargarSolicitudesPortal = anota('solicitudes', 'BANDEJA');
  root.cargarHistorial = anota('historial', 'HISTORIAL');
  return { pruebas: crear(root), root, llamadas };
}

test('prueba cada parte con su función principal, sin repintar de más', async () => {
  const t = armar();
  await t.pruebas.correr();
  assert.deepEqual(t.llamadas, [['billeteras', false], ['solicitudes', true], ['historial']]);
  for (const parte of ['Billeteras', 'Solicitudes', 'Historial']) assert.equal(t.pruebas.vigente(parte).ok, true, parte);
});

test('dice qué parte se cortó, en castellano', async () => {
  const t = armar({ falla: { billeteras: 'BILLETERAS_LOAD_FAILED' } });
  await t.pruebas.correr();
  assert.deepEqual({ ok: t.pruebas.vigente('Billeteras').ok, detalle: t.pruebas.vigente('Billeteras').detalle },
    { ok: false, detalle: 'No se pudieron leer las billeteras' });
  assert.equal(t.pruebas.vigente('Solicitudes').ok, true, 'una falla no frena las pruebas que siguen');
});

test('si una función revienta o no anota nada, no se da por buena', async () => {
  const t = armar();
  t.root.cargarSolicitudesPortal = async () => { throw new Error('private token'); };
  t.root.cargarHistorial = async () => {};
  await t.pruebas.correr();
  assert.deepEqual([t.pruebas.vigente('Solicitudes').ok, t.pruebas.vigente('Solicitudes').detalle], [false, 'No respondió']);
  assert.equal(t.pruebas.vigente('Historial').ok, false);
});

test('una parte colgada no deja colgadas las pruebas', async () => {
  const t = armar({ setTimeout: (fn) => { setImmediate(fn); return 1; } });
  t.root.cargarSolicitudesPortal = () => new Promise(() => {});
  await t.pruebas.correr();
  assert.equal(t.pruebas.vigente('Solicitudes').ok, false);
  assert.equal(t.pruebas.vigente('Historial').ok, true);
});

test('Agentes: sesión caída se dice y no se lee nada', async () => {
  const pedidos = [];
  const t = armar({ ctrlElectron: {}, callDrex: async (m) => { pedidos.push(m); return { needsLogin: true }; } });
  await t.pruebas.correr();
  assert.deepEqual(pedidos, ['estadoPagina'], 'sólo mira el estado: ninguna operación');
  assert.equal(t.pruebas.vigente('Lectura de fichas').detalle, 'Se cayó la sesión de Agentes');
  assert.equal(t.pruebas.vigente('Automatismos').ok, false);
});

test('Agentes: «Lectura de fichas» sólo queda verde si obtuvo un saldo numérico', async () => {
  const pedidos = [];
  const t = armar({ ctrlElectron: {}, callDrex: async (metodo) => {
    pedidos.push(metodo);
    return metodo === 'estadoPagina' ? { ok:true } : { balance:{ raw:'$ 25.000', value:25000 } };
  }});
  await t.pruebas.correr();
  assert.deepEqual(pedidos,['estadoPagina','obtenerSaldoAgente']);
  assert.equal(t.pruebas.vigente('Lectura de fichas').ok,true);
  const muestra=t.root.NodoSalud.snapshot().rows.find(row=>row.integration==='RETIROS'&&row.stage==='DATA');
  assert.equal(muestra.code,'FICHAS_SALDO_LEIDO');

  const invalida=armar({ ctrlElectron:{}, callDrex:async metodo=>metodo==='estadoPagina'?{}:{balance:{raw:'',value:null}} });
  await invalida.pruebas.correr();
  assert.equal(invalida.pruebas.vigente('Lectura de fichas').ok,false);
  assert.equal(invalida.pruebas.vigente('Lectura de fichas').detalle,'El casino no devolvió el saldo');
});

test('Agentes ocupado: no se lo molesta', async () => {
  const pedidos = [];
  const t = armar({ ctrlElectron: {}, _drexGlobalBusy: true, callDrex: async (m) => { pedidos.push(m); return {}; } });
  await t.pruebas.correr();
  assert.deepEqual(pedidos, []);
  assert.equal(t.pruebas.vigente('Lectura de fichas').detalle, 'El agente está ocupado');
});

test('Control de fichas necesita leer los dos lados', async () => {
  const t = armar({ ctrlElectron: {}, callDrex: async () => ({}), _watchdogLeer: async () => ({ drexFichas: 100, chuniorFichas: null }) });
  await t.pruebas.correr();
  assert.equal(t.pruebas.vigente('Control de fichas').ok, false);
  t.root._watchdogLeer = async () => ({ drexFichas: 100, chuniorFichas: 100 });
  await t.pruebas.correr();
  assert.equal(t.pruebas.vigente('Control de fichas').ok, true);
});

test('avisa qué está probando y cuándo terminó', async () => {
  const t = armar();
  const vistos = [];
  await t.pruebas.correr((parte) => vistos.push(parte));
  assert.deepEqual(vistos, ['Billeteras', 'Solicitudes', 'Historial', null]);
});

test('dos clics corren una sola vez', async () => {
  const t = armar();
  await Promise.all([t.pruebas.correr(), t.pruebas.correr()]);
  assert.equal(t.llamadas.length, 3);
});

test('el semáforo de billeteras está en la carga que corre, no en la copia pisada', () => {
  // billeteras-oficina.js reemplaza a la de core/vistas-y-billeteras.js. Marcar sólo la de core dejaba
  // la fila en "Sin actividad" con las billeteras cargando bien.
  const fuente = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'extensions', 'billeteras-oficina.js'), 'utf8');
  assert.match(fuente, /window\.cargarBilleteras = cargarBilleteras = async function\(render=true\)\{\s+const health = window\.NodoSalud\?\.begin\('BILLETERAS'\)/);
});

test('las pruebas no nombran nada que mueva plata o escriba', () => {
  const fuente = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'runtime', 'pruebas-sistema.js'), 'utf8');
  for (const prohibido of ['retirarSaldo', 'cargarSaldo', 'buscarUsuario', 'enviar', 'chat_leido', 'flushVisible', 'actualizarSolicitudPortal']) {
    assert.ok(!fuente.includes(prohibido), prohibido);
  }
});
