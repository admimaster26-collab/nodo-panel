const test = require('node:test');
const assert = require('node:assert/strict');
const mod = require('../renderer/portal/withdrawals-execution.js');

// Un retiro que el casino RECHAZA no se paga.
//
// Auditoría del 9/10. El panel miraba sólo `ok`, que quiere decir "la automatización corrió y
// contestó algo" — y es true igual cuando el casino dice que NO. El veredicto del casino viene
// aparte, en `exito`:
//
//     exito === true   el casino confirmó
//     exito === false  el casino lo RECHAZÓ   (bet300 lo manda escrito: "RETIRO RECHAZADO")
//     exito === null   no se vio el modal — se confía, igual que en operaciones manuales
//
// Con un rechazo se seguía de largo: se le transfería la plata al jugador, se descontaba la
// billetera, se anotaba el historial en OK y se marcaba PAGADA. El jugador se quedaba con las
// fichas Y con la transferencia.

function armar(respuestaRetiro, opciones){
  const o = opciones || {};
  const hecho = { chunior:[], historial:[], billetera:[], solicitud:[], chat:[], toasts:[], alerts:[] };
  const st = {
    id: 299001, usuario: 'jugador_prueba',
    objetivo: 10000, totalReal: 10000, yaPagado: 0, declarado: 10000,
    saldoReal: 50000, sel: { b1:true }, montos: { b1: 10000 }, hechas: {}
  };
  const billetera = { ID_BILLETERA:'b1', NOMBRE_VISIBLE:'MATRELO mp', TITULAR:'Juan Perez',
                      CHUNIOR_UID:'u1', SALDO: 500000 };
  const el = () => null;

  const deps = {
    withdrawalState: { current: st },
    V154P: { solicitudes: [] },
    pcOperativa: 'P1',
    money: (v) => '$ ' + v,
    escapeHtml: (v) => String(v == null ? '' : v),
    toast: (t) => hecho.toasts.push(String(t)),
    alert: (t) => hecho.alerts.push(String(t)),
    confirm: () => true,
    document: { getElementById: el },
    setTimeout: (f) => f && 0,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => ({ ok:false }),
    supabaseClient: null,

    _drexGlobalLock: () => true, _drexGlobalUnlock: () => {},
    _wdLock: () => {}, _wdUnlock: () => {},
    _trazaInit: () => {}, _trazaPaso: () => {}, _trazaFin: () => {},
    _rv2TotalSel: () => 10000,
    _rv2BilsUsables: () => [billetera],
    _rv2Render: () => {}, _rv2Modal: () => {}, _rv2PintarVeredicto: () => {},
    _rv2ActualizarBotonAprobar: () => {}, _rv2Finalizar: () => {},
    cerrarRetiroV2: () => {}, cerrarExpedienteSolicitud: () => {}, cerrarPortalJobModal: () => {},
    ensureDrexSession: async () => true,

    // Lo que mueve plata. Todo queda anotado para poder afirmar que NO se tocó.
    callDrex: async (accion) => {
      if(accion === 'buscarUsuario') return { exists:true, balance:{ raw:'50000', value:50000 } };
      if(accion === 'retirarSaldo') return respuestaRetiro;
      return { ok:true };
    },
    registrarRetiroEnChunior: async (...a) => { hecho.chunior.push(a); return { ok:true, movimientoId:'1' }; },
    registrarEnHistorial:     async (f)    => { hecho.historial.push(f); return { id: 1 }; },
    ajustarSaldoBilletera:    async (...a) => { hecho.billetera.push(a); },
    notificarUsuarioEnChat:   async (...a) => { hecho.chat.push(a); },
    cargarHistorial: async () => {}, cargarSolicitudesPortal: async () => {},
    sincronizarBilleterasChunior: async () => {}, renderBillerasInicio: () => {},

    window: {
      operador: { usuario:'tester' },
      actualizarSolicitudPortal: async (...a) => { hecho.solicitud.push(a); return { ok:true }; },
      avisarJugadorEnChat: async (...a) => { hecho.chat.push(a); },
      panelAPI: { rpc: async () => (o.rpcProgresoFalla ? { error:{ message:'sin firma' } } : { data:{ pagado: 10000 } }) },
      V154P: { solicitudes: [] }
    }
  };
  deps.V154P = deps.window.V154P;
  const api = mod.create(deps).globals;
  return { api, hecho, st, deps };
}

const RECHAZADO = { ok:true, exito:false, action:'retiro', amount:10000,
                    resultado:'Operación no permitida', message:'RETIRO RECHAZADO por BET300: Operación no permitida.' };
const CONFIRMADO = { ok:true, exito:true, action:'retiro', amount:10000,
                     newBalance:{ value:40000 }, resultado:'Operación correcta' };
const SIN_MODAL = { ok:true, exito:null, action:'retiro', amount:10000,
                    newBalance:{ value:40000, unchanged:true } };

test('el casino RECHAZA: no se le transfiere nada al jugador', async () => {
  const c = armar(RECHAZADO);
  await c.api._rv2Aprobar();
  assert.deepEqual(c.hecho.billetera, [], 'no se descuenta la billetera');
  assert.deepEqual(c.hecho.chunior,   [], 'no se anota en Chunior');
  assert.deepEqual(c.hecho.historial, [], 'no se escribe historial');
  assert.deepEqual(c.hecho.solicitud, [], 'no se marca PAGADA');
  assert.deepEqual(c.hecho.chat,      [], 'no se le avisa que cobró');
});

test('el casino RECHAZA: se lo dice al operador y deja reintentar', async () => {
  const c = armar(RECHAZADO);
  await c.api._rv2Aprobar();
  assert.ok(c.hecho.toasts.some(t => /RECHAZ/i.test(t)), 'el cartel lo nombra');
  assert.ok(c.hecho.alerts.some(t => /NO salieron|no se transfiri/i.test(t)), 'dice que no se movió plata');
  assert.equal(c.deps.withdrawalState.current, c.st, 'el modal vuelve para reintentar');
});

test('el casino CONFIRMA: el retiro se paga como siempre', async () => {
  const c = armar(CONFIRMADO);
  await c.api._rv2Aprobar();
  assert.equal(c.hecho.chunior.length, 1, 'se anota en Chunior');
  assert.equal(c.hecho.billetera.length, 1, 'se descuenta la billetera');
});

test('sin ver el modal (exito null) se confia, igual que en operaciones manuales', async () => {
  // Criterio que ya existe en el flujo blindado: "no hubo rechazo explícito → se confía".
  // No se inventa un freno nuevo acá.
  const c = armar(SIN_MODAL);
  await c.api._rv2Aprobar();
  assert.equal(c.hecho.billetera.length, 1, 'sigue andando como antes');
});
