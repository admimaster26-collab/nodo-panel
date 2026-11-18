'use strict';

function createAutomationService({ agents, backends, requests, env = process.env }) {
  function automationTimeoutFor(method) {
    const envTimeout = Number(env.DREX_AUTOMATION_TIMEOUT_MS || 0);
    if (envTimeout > 0) return envTimeout;
    // Timeouts ajustados para que un CUELGUE se resuelva rápido y libere al operador (demanda alta).
    // Una carga normal tarda ~10-15s; el timeout libera la espera sin reenviar el movimiento.
    if (method === 'cargarSaldo' || method === 'retirarSaldo') return 45000;   // antes 180s
    if (method === 'crearUsuario' || method === 'cambiarClave') return 55000;  // antes 90s
    if (method === 'buscarUsuario' || method === 'obtenerSaldoAgente') return 28000; // antes 45s
    if (method === 'leerMovimientosCredito') return 90000;   // puede pasar varias páginas del reporte
    return 40000; // antes 60s
  }

  function sendAutomation(method, ...args) {
    const win = agents.get();
    // Mientras el login está en vuelo, la ventana no se navega (D-101, ver agent-window.js).
    // Se marca acá porque es el único lugar por donde pasan todas las llamadas al preload, así
    // sirve igual para casinodrex y para BET300.
    const esLogin = method === 'iniciarSesion';
    if (esLogin) agents.marcarLogin(true);
    // Algunos métodos requieren estar en una URL específica → navegamos primero
    let preNav;
    if      (method === 'buscarUsuario')       preNav = agents.navigate(backends.current.url);
    else if (method === 'crearUsuario')        preNav = agents.navigate(backends.current.newUserUrl, { forceReload: !backends.current.spa }); // BET300 crea por modal, sin recargar
    else if (method === 'obtenerSaldoAgente')  preNav = agents.navigate(backends.current.url);
    // El WhatsApp se administra desde Personalizar página. El preload no navega por su cuenta
    // (D-101): main va a esa ruta sólo si la lectura/escritura explícita lo pide con navegar:true.
    else if (method === 'leerWhatsappOficina' || method === 'guardarWhatsappOficina') preNav = (args[0] && args[0].navegar && backends.current.whatsappUrl && !backends.current.spaPathAware)
      ? agents.navigate(backends.current.whatsappUrl, { mismaRuta: true })
      : agents.ready(win);
    // Cotejo de cargas (18/11): Drex no es SPA y el reporte es otra página → main la abre. agentesbet.io y
    // AdminOnline llegan por su menú, sin recargar.
    else if (method === 'leerMovimientosCredito') preNav = backends.current.movimientosUrl
      ? agents.navigate(backends.current.movimientosUrl, { mismaRuta: true })
      : agents.ready(win);
    else                                       preNav = agents.ready(win);
    // Antes de mandar nada, esperar a que el preload de esa ventana avise que ya escucha: si no,
    // la orden se manda al vacio y muere en el timeout. No rechaza nunca — si el saludo no llega,
    // se sigue igual que antes.
    const corrida = preNav.then(async () => {
      if (agents.preloadReady) await agents.preloadReady();
      return requests.run(win.webContents, 'drex:automation:run', { method, args }, automationTimeoutFor(method), 'Timeout: la automatización tardó demasiado.');
    });
    return esLogin ? corrida.finally(() => agents.marcarLogin(false)) : corrida;
  }

  return { send: sendAutomation, timeoutFor: automationTimeoutFor };
}

module.exports = { createAutomationService };
