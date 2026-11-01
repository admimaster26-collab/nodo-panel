'use strict';
const { whenWindowReady, waitForWindowLoad } = require('./window-ready');
const { taparCarteles } = require('./carteles');
const { vigilarPreload } = require('./preload-listo');

function createAgentWindowService({ BrowserWindow, icon, partition, backends, headers, requests }) {
  let agentWindow = null;
  let navEsperadaDrex = false;
  // D-101 · El operador está entrando a Agentes: NADA navega esta ventana. Navegar descarga la
  // página, el iniciarSesion en vuelo no contesta nunca y el panel lo muestra como "se recargó
  // durante la operación"; el operador reintenta y vuelve a pasar. Eso es el loop.
  // El freno del preload NO alcanza: estas navegaciones salen de main, desde los 21
  // navigateAgent() del panel, que ni pasan por la cola. Por eso el freno va acá, que es el
  // único lugar por donde pasan todas — y así vale para los dos backends.
  // ── Consola de la ventana de Agentes ───────────────────────────────────────────────────────
  // Lo que pasa en ESA consola no salía nunca de la PC, y ahí estaba la prueba del loop del
  // /logout: el error salía de logout:1 y el VM del preload subía en cada vuelta. Para verlo había
  // que pedirle al operador que abriera el devtools y mandara una foto (Juan, 26/9).
  // Se captura desde main a propósito: el preload corre aislado y no ve la consola de la página.
  const consola = [];
  const CONSOLA_TOPE = 150;
  const NIVELES = ['debug', 'info', 'warn', 'error'];
  function anotarConsola(nivel, mensaje, fuente) {
    try {
      const texto = String(mensaje == null ? '' : mensaje).replace(/s+/g, ' ').trim().slice(0, 300);
      if (!texto) return;
      consola.push({ t: new Date().toISOString(), nivel: nivel, msg: texto, fuente: String(fuente || '').slice(0, 120) });
      if (consola.length > CONSOLA_TOPE) consola.splice(0, consola.length - CONSOLA_TOPE);
    } catch (_) {}
  }
  function leerConsola() {
    let url = '';
    try { const w = agentWindow; if (w && !w.isDestroyed()) url = w.webContents.getURL(); } catch (_) {}
    return { url: url, backend: backends.current.label || '', consola: consola.slice(-80) };
  }
  let preload = null;   // el saludo del preload · ver main/preload-listo.js
  let loginDesde = 0;
  const LOGIN_TOPE_MS = 90000;   // un login que nunca contesta no puede dejar la ventana clavada
  function loginEnCurso() { return loginDesde > 0 && Date.now() - loginDesde < LOGIN_TOPE_MS; }
  function marcarLogin(activo) { loginDesde = activo ? Date.now() : 0; }
  function createAgentWindow(url = backends.current.url) {
    agentWindow = new BrowserWindow({
      width:  1400,
      height: 900,
      // Juan, 25/10: "la ventana de agentes si esta visible debe de tener un tamaño minimo fijo
      // pq no se ve el campo de contraseña". No tenía mínimo: achicada a mano —o abierta chica
      // por una resolución baja— el formulario del casino queda cortado y el operador no puede
      // escribir la clave, así que no hay forma de abrir la sesión de Agentes.
      minWidth:  1000,
      minHeight: 700,
      title:  'Agentes — Cargas automáticas',
      icon:   icon,
      show:   false,
      webPreferences: {
        preload:              backends.current.preload,
        partition:            partition, // sesión dedicada → el proxy solo afecta a Agentes
        contextIsolation:     true,
        nodeIntegration:      false,
        sandbox:              true,
        backgroundThrottling: false,
      }
    });

    headers.configure(agentWindow);

    agentWindow.loadURL(url);

    // PATCH 01 · si Agentes se recarga/redirecta solo mientras hay una operación pendiente,
    // abortamos esa espera para que el panel no quede colgado.
    // Los carteles de promo tapan la pantalla y se comen los clicks: ver main/carteles.js.
    taparCarteles(agentWindow);

    // Nada se manda antes de que el preload avise que escucha: ver main/preload-listo.js.
    preload = vigilarPreload(agentWindow);

    // Sólo lo que sirve para diagnosticar: avisos y errores. Lo verboso se descarta.
    agentWindow.webContents.on('console-message', (_e, nivel, mensaje, linea, fuente) => {
      if (Number(nivel) < 2) return;
      anotarConsola(NIVELES[Number(nivel)] || 'info', mensaje, (fuente || '') + (linea ? ':' + linea : ''));
    });
    agentWindow.webContents.on('did-fail-load', (_e, code, desc, urlFallida) => {
      anotarConsola('error', 'no cargó (' + code + ' ' + desc + ')', urlFallida);
    });
    agentWindow.webContents.on('did-navigate', (_e, navUrl) => {
      // Cada navegación queda anotada: el loop se reconoce por la MISMA url repitiéndose.
      anotarConsola('info', 'navegó a ' + navUrl, 'agent-window');
      if (navEsperadaDrex) return;
      if (requests.pending.size) {
        console.warn('[main] navegación inesperada en Agentes durante operación:', navUrl);
        requests.rejectAll(new Error('La página de Agentes se recargó durante la operación. Revisá el resultado antes de reintentar.'));
      }
    });
    agentWindow.on('closed', () => {
      agentWindow = null;
      requests.rejectAll(new Error('La ventana de Agentes se cerró durante la operación. Revisá el resultado antes de reintentar.'));
    });

    return agentWindow;
  }
  function getAgentWindow(url = backends.current.url) {
    if (agentWindow && !agentWindow.isDestroyed()) return agentWindow;
    return createAgentWindow(url);
  }

  const whenAgentReady = (win, timeoutMs = 12000) => whenWindowReady(win, timeoutMs);

  // PATCH 01 · detecta si Agentes devolvió error/bloqueo en vez de la app real.
  // Robustez (evita falsos "bloqueado" que gatillan recargas de más):
  //   • Señal POSITIVA primero: si hay CUALQUIER elemento operable de la app → NO bloqueado.
  //   • Señal negativa SOLO con frases específicas de CDN/WAF, no con un "error" o un número
  //     suelto en el título/cuerpo (eso marcaba páginas válidas como bloqueadas).
  // Selector de "app operable" (señal positiva) y alternación de frases de error de CDN/WAF
  // (señal negativa). Ambos strings SIN backslashes → se inyectan sin problemas en el
  // executeJavaScript de abajo; el bloqueo se arma con new RegExp(..., 'i') en la página.
  // backends.current.appSel (señal positiva de "app operable") se lee del backend vigente
  // según el backend elegido. Los template strings de abajo lo leen en cada llamada → toman el valor
  // vigente aunque se cambie el backend en caliente.
  const _AGENT_BLOCK_ALT = 'request blocked|request could not be satisfied|generated by cloudfront|cloudfront|access denied|forbidden|not authorized|service unavailable|bad gateway|gateway timeout|just a moment|attention required|checking your browser|ray id|algo sali|cannot read propert|errorboundary';
  async function agentPageIsBlockedDrex(win) {
    try {
      return await win.webContents.executeJavaScript(`(function(){
        try {
          if (document.querySelector('${backends.current.appSel}')) return false;
          var re = new RegExp("${_AGENT_BLOCK_ALT}", "i");
          var body = (document.body && (document.body.innerText || document.body.textContent) || '').slice(0,3000);
          return re.test(body) || re.test(document.title || '');
        } catch(e) { return false; }
      })()`, true);
    } catch (_e) { return false; }
  }

  // PATCH 01 · espera a que React/SPA monte algo operable antes de lanzar el preload.
  // Detección más robusta: espera cualquier señal de app montada (incluye el saldo del agente,
  // que aparece apenas hay sesión). Corta temprano SOLO ante una página de error real del CDN.
  async function agentWaitReadyDrex(win, timeoutMs = 9000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const st = await win.webContents.executeJavaScript(`(function(){
        try {
          if (document.querySelector('${backends.current.appSel}')) return 'ready';
          var re = new RegExp("${_AGENT_BLOCK_ALT}", "i");
          var b = (document.body && (document.body.innerText || document.body.textContent) || '');
          if (re.test(b) || re.test(document.title || '')) return 'error';
          return 'wait';
        } catch(e) { return 'wait'; }
      })()`, true).catch(() => 'wait');
      if (st === 'ready') return true;
      if (st === 'error') return false;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  // ⛔ FLUJO BLINDADO — el core de carga/retiro (applyAmount) NO se toca.
  // PATCH 01: mismo flujo + espera real + reintento si Agentes carga bloqueado.
  // PATCH 02 (reduce-refresh): si YA estamos en la URL correcta y la página está operable,
  // NO recargamos. Refrescar casinodrex en cada búsqueda/saldo dispara el 403 de CloudFront;
  // finalizarOperacionAgentes ya deja la página limpia y lista sin refrescar. Solo recargamos
  // si la URL no coincide, la página no está operable, quedó bloqueada, o se pide forceReload
  // (crearUsuario, que necesita el formulario /new_user limpio).
  async function navigateAgentTo(url = backends.current.url, opts = {}) {
    const win = getAgentWindow();
    const forceReload = !!opts.forceReload;
    // Ver loginEnCurso() arriba (D-101). No se navega: la operación que venía atrás va a ver
    // "needsLogin" y el panel ya sabe qué hacer con eso. Matarle el login al operador, no.
    if (loginEnCurso() && !opts.permitirDuranteLogin) {
      console.warn('[main] NO se navega la ventana de Agentes: el operador está entrando (D-101).');
      return;
    }
    // BET300 es una SPA (Vue): la ruta interna cambia (/, /login, rutas del router) pero es LA MISMA
    // app. Comparar por ORIGIN → se reconoce como "misma página" y se REUSA sin recargar (agentesbet.io
    // es más lento que casinodrex; recargar en cada búsqueda hacía que buscarUsuario pasara el timeout).
    const sameUrl = (a, b) => {
      if (backends.current.spa) { try { return new URL(a).origin === new URL(b).origin; } catch (_e) { return false; } }
      return String(a || '').split('#')[0].split('?')[0] === String(b || '').split('#')[0].split('?')[0];
    };
    navEsperadaDrex = true;
    try {
      const MAX = 3;
      for (let intento = 1; intento <= MAX; intento++) {
        let operable = false;
        // Solo en el primer intento intentamos reusar la página ya cargada (sin recargar).
        if (!forceReload && intento === 1) {
          try {
            if (!win.webContents.isLoading() && sameUrl(win.webContents.getURL(), url)) {
              operable = await agentWaitReadyDrex(win, 1800);
            }
          } catch (_) { operable = false; }
        }

        if (!operable) {
          await waitForWindowLoad(win, 8000, () => win.loadURL(url));
          await agentWaitReadyDrex(win);
          await new Promise(r => setTimeout(r, 900));
        }

        const blocked = await agentPageIsBlockedDrex(win);
        if (!blocked) return;
        if (intento < MAX) {
          console.warn('[main] Agentes devolvió pantalla de error/bloqueo. Reintento ' + intento + '/' + MAX);
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    } finally {
      navEsperadaDrex = false;
    }
  }

  function close() { if (agentWindow && !agentWindow.isDestroyed()) agentWindow.destroy(); agentWindow = null; }

  return { get: getAgentWindow, close, navigate: navigateAgentTo, ready: whenAgentReady,
           marcarLogin, loginEnCurso, consola: leerConsola,
           preloadReady: (ms) => (preload ? preload.esperar(ms) : Promise.resolve(false)) };
}

module.exports = { createAgentWindowService };
