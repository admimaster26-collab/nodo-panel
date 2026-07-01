const path    = require('node:path');
const fs      = require('node:fs');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createClient } = require('@supabase/supabase-js');


// ============================================================
// PANEL V15 · RPC BRIDGE
// ============================================================
// Permite que el panel use las RPC reales del sistema operativo
// sin poner claves sensibles dentro del HTML.
// Lee SUPABASE_URL y SUPABASE_ANON_KEY desde .env o variables de entorno.
// ============================================================
function cargarEnvLocalV15() {
  try {
    // NODO_ENV=p4 → lee .env.p4 ; sin NODO_ENV → lee .env.
    const envName = process.env.NODO_ENV ? (".env." + String(process.env.NODO_ENV).toLowerCase()) : ".env";
    // PRODUCCIÓN: en la app empaquetada __dirname está dentro del .asar (no se puede dejar un .env ahí).
    // Buscamos el .env PRIMERO junto al ejecutable instalado (process.execPath) y después en __dirname (dev).
    const dirs = [];
    try { dirs.push(path.dirname(process.execPath)); } catch (_e) {}
    dirs.push(__dirname);
    let envPath = "";
    for (const d of dirs) {
      const p1 = path.join(d, envName), p2 = path.join(d, ".env");
      if (fs.existsSync(p1)) { envPath = p1; break; }
      if (fs.existsSync(p2)) { envPath = p2; break; }
    }
    if (!envPath) return;
    console.log("[env] usando", envPath);
    const raw = fs.readFileSync(envPath, "utf8");
    raw.split(/\r?\n/).forEach(line => {
      const clean = String(line || "").trim();
      if (!clean || clean.startsWith("#") || !clean.includes("=")) return;
      const i = clean.indexOf("=");
      const k = clean.slice(0, i).trim();
      let v = clean.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    });
  } catch (err) {
    console.warn("[panel-v15] No se pudo leer .env:", err.message);
  }
}
cargarEnvLocalV15();

// Defaults de Supabase (anon key PÚBLICA, igual que en el .htm) para que la app
// EMPAQUETADA ande sin .env. La oficina sale del login de Chunior; el .env solo
// se necesita para overrides (proxy, etc.).
if (!process.env.SUPABASE_URL)      process.env.SUPABASE_URL = "https://pjvvyvfcwjoocjqvdror.supabase.co";
if (!process.env.SUPABASE_ANON_KEY) process.env.SUPABASE_ANON_KEY = "sb_publishable_NYqRoKptTgcL90VAVF2kqA_Gl06mEUF";
// PRODUCCIÓN: PANEL_DATA_SECRET NO tiene default. Va por .env. Sin él, auto-login de agente
// y proxy devuelven {ok:false, reason:'missing-secret'} (el resto del panel sigue andando:
// el renderer usa su propio secret para los RPC blindados de lectura).
if (!process.env.PANEL_DATA_SECRET) {
  console.warn("[panel] Falta PANEL_DATA_SECRET en .env → auto-login de agente y proxy quedan DESHABILITADOS. El resto del panel (carga/retiro/validación/chat manual) opera normal.");
} else {
  console.log("[panel] PANEL_DATA_SECRET cargado desde .env (auto-login y proxy habilitados).");
}

// Sesiones/datos separados por oficina SOLO cuando se lanza con NODO_ENV (ej. P4).
// Sin NODO_ENV (P1 por defecto) NO se toca el userData → P1 queda igual que siempre.
if (process.env.NODO_ENV && process.env.USER_DATA_DIR) {
  try { app.setPath('userData', path.join(__dirname, process.env.USER_DATA_DIR)); console.log('[userData]', process.env.USER_DATA_DIR); }
  catch (e) { console.warn('[userData]', e && e.message); }
}

// ============================================================
// V15.1 · PROXY POR PC
// ============================================================
// Cada PC puede salir con su propio proxy desde .env.
// Variables:
// PROXY_ENABLED=1
// PROXY_PROTOCOL=http | socks5
// PROXY_HOST=host
// PROXY_PORT=puerto
// PROXY_USERNAME=usuario
// PROXY_PASSWORD=clave
// PROXY_BYPASS_RULES=<local>
// ============================================================
function envBoolV15(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "si", "sí", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function proxyRulesFromEnvV15() {
  const enabled = envBoolV15(process.env.PROXY_ENABLED, false);
  if (!enabled) return "";

  const host = String(process.env.PROXY_HOST || "").trim();
  const port = String(process.env.PROXY_PORT || "").trim();
  const protocol = String(process.env.PROXY_PROTOCOL || "http").trim().toLowerCase();

  if (!host || !port) return "";

  if (protocol.startsWith("socks")) return `socks=${host}:${port}`;
  return `http=${host}:${port};https=${host}:${port}`;
}

// Sesión DEDICADA de Agentes (casinodrex). El proxy se aplica SOLO acá; Chunior, Supabase y el
// resto (sesión default) NUNCA se ven afectados por el proxy ni por el closeAllConnections
// (antes cortaba las conexiones de Chunior → pestaña en blanco / fallo). Igual que el NODO hermano.
const AGENT_PARTITION = 'persist:nodo-agentes';
function agentSes(){ try { return session.fromPartition(AGENT_PARTITION); } catch(_e){ return session.defaultSession; } }

async function configurarProxyElectronV15() {
  const enabled = envBoolV15(process.env.PROXY_ENABLED, false);
  if (!enabled) {
    console.log("[proxy] DESACTIVADO");
    return { ok: true, enabled: false };
  }

  const proxyRules = proxyRulesFromEnvV15();
  if (!proxyRules) {
    console.warn("[proxy] Activado, pero falta PROXY_HOST / PROXY_PORT.");
    return { ok: false, enabled: true, error: "Falta PROXY_HOST / PROXY_PORT" };
  }

  // Proxy SOLO en la sesión de Agentes → no toca Chunior/Supabase.
  await agentSes().setProxy({
    mode: "fixed_servers",
    proxyRules,
    proxyBypassRules: process.env.PROXY_BYPASS_RULES || "<local>"
  });

  try { await agentSes().closeAllConnections(); } catch (_e) {}

  console.log("[proxy] ACTIVADO (sesión agentes):", proxyRules);
  return { ok: true, enabled: true, proxyRules };
}

// Proxy aplicado en RUNTIME: config por oficina, traída del admi tras el login en Chunior.
let _runtimeProxyAuth = null; // {username, password} para el evento "login" del proxy
let _proxyApplied = false;    // si hay un proxy fixed_servers activo
async function aplicarProxyRuntime(cfg) {
  try {
    cfg = cfg || {};
    if (!cfg.enabled || !cfg.host || !cfg.port) {
      _runtimeProxyAuth = null;
      // Sin proxy: SOLO limpiamos si antes había uno activo (solo la sesión de Agentes).
      if (_proxyApplied) {
        await agentSes().setProxy({ mode: "direct" });
        try { await agentSes().closeAllConnections(); } catch (_e) {}
        _proxyApplied = false;
        console.log("[proxy] runtime: limpiado (salida directa)");
      }
      return { ok: true, enabled: false };
    }
    const protocol = String(cfg.protocol || "http").toLowerCase();
    const rules = protocol.startsWith("socks")
      ? `socks=${cfg.host}:${cfg.port}`
      : `http=${cfg.host}:${cfg.port};https=${cfg.host}:${cfg.port}`;
    // Proxy SOLO en la sesión de Agentes → Chunior y Supabase (sesión default) intactos.
    await agentSes().setProxy({
      mode: "fixed_servers",
      proxyRules: rules,
      proxyBypassRules: cfg.bypass || "<local>"
    });
    try { await agentSes().closeAllConnections(); } catch (_e) {}
    _proxyApplied = true;
    _runtimeProxyAuth = cfg.username ? { username: String(cfg.username), password: String(cfg.password || "") } : null;
    console.log("[proxy] runtime ACTIVADO:", rules);
    return { ok: true, enabled: true, proxyRules: rules };
  } catch (e) {
    console.warn("[proxy] runtime error:", e.message);
    return { ok: false, error: e.message };
  }
}

app.on("login", (event, webContents, request, authInfo, callback) => {
  if (!authInfo?.isProxy) return;
  // Prioridad: creds de runtime (por oficina, traídas del admi). Fallback: .env.
  if (_runtimeProxyAuth && _runtimeProxyAuth.username) {
    event.preventDefault();
    callback(_runtimeProxyAuth.username, _runtimeProxyAuth.password || "");
    return;
  }
  if (envBoolV15(process.env.PROXY_ENABLED, false) && process.env.PROXY_USERNAME) {
    event.preventDefault();
    callback(String(process.env.PROXY_USERNAME || ""), String(process.env.PROXY_PASSWORD || ""));
  }
});


let panelSupabaseV15 = null;
function getPanelSupabaseV15() {
  if (panelSupabaseV15) return panelSupabaseV15;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_ANON_KEY en .env para panelAPI.");
  }
  panelSupabaseV15 = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return panelSupabaseV15;
}

const AGENT_URL    = 'https://bo.casinodrex.com/agents/user_search';
const NEW_USER_URL = 'https://bo.casinodrex.com/agents/new_user';
const CHUNIOR_URL  = 'https://bo.chunior.com/transacciones/';

let mainWindow    = null;
let agentWindow   = null;
let verifyWindow  = null;
let chuniorWindow = null;
const pendingAutomation   = new Map();
const pendingVerification = new Map();

// PATCH 01 · estabilidad Agentes Drex
// true mientras navigateAgentTo recarga a propósito. Si la ventana se recarga sola
// en medio de una operación, cortamos el pending en vez de dejar el panel colgado.
let navEsperadaDrex = false;

// ── Ventana principal (NODO panel) ────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:    1440,
    height:   900,
    minWidth: 900,
    minHeight:600,
    title: 'NODO · OPERATIVO',
    backgroundColor: '#0e1014', // evita el flash blanco mientras carga / al despertar
    webPreferences: {
      preload:               path.join(__dirname, 'app-preload.js'),
      contextIsolation:      true,
      nodeIntegration:       false,
      webviewTag:            true,
      backgroundThrottling:  false, // que JS siga corriendo aunque la ventana no esté enfocada
    }
  });

  mainWindow.loadFile('NODO · OPERATIVO LITE.htm');
  mainWindow.on('closed', () => { mainWindow = null; });

  // Recovery: si el renderer se cuelga / crashea (esto causa la pantalla blanca)
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone:', details);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[main] renderer unresponsive — forcing reload');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  });

  // Zoom Ctrl+= / Ctrl+- / Ctrl+0 (teclado)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.type !== 'keyDown') return;
    const key = input.key;
    if (key === '=' || key === '+' || key === 'NumpadAdd') {
      const f = mainWindow.webContents.getZoomFactor();
      mainWindow.webContents.setZoomFactor(Math.min(parseFloat((f + 0.1).toFixed(1)), 3.0));
      event.preventDefault();
    } else if (key === '-' || key === 'NumpadSubtract') {
      const f = mainWindow.webContents.getZoomFactor();
      mainWindow.webContents.setZoomFactor(Math.max(parseFloat((f - 0.1).toFixed(1)), 0.3));
      event.preventDefault();
    } else if (key === '0') {
      mainWindow.webContents.setZoomFactor(1.0);
      event.preventDefault();
    }
  });

  // Zoom Ctrl+Rueda del mouse
  mainWindow.webContents.on('zoom-changed', (_event, direction) => {
    const f = mainWindow.webContents.getZoomFactor();
    if (direction === 'in')
      mainWindow.webContents.setZoomFactor(Math.min(parseFloat((f + 0.1).toFixed(1)), 3.0));
    else
      mainWindow.webContents.setZoomFactor(Math.max(parseFloat((f - 0.1).toFixed(1)), 0.3));
  });

  // Habilitar zoom visual (trackpad pinch)
  mainWindow.webContents.setVisualZoomLevelLimits(1, 5);
}


// PATCH 01 · User-Agent realista para la ventana de Agentes Drex.
// Se aplica sobre la misma sesión actual para no romper proxy/defaultSession ni Supabase.
function configurarSesionAgentesDrex(win) {
  try {
    const cur       = win.webContents.getUserAgent();
    const chromeTok = (cur.match(/Chrome\/[\d.]+/) || ['Chrome/124.0.0.0'])[0];
    const major     = (chromeTok.match(/\d+/) || ['124'])[0];
    const ua        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' + chromeTok + ' Safari/537.36';
    const secChUa   = '"Chromium";v="' + major + '", "Google Chrome";v="' + major + '", "Not.A/Brand";v="99"';

    win.webContents.setUserAgent(ua);
    const ses = win.webContents.session || session.defaultSession;
    try { ses.setUserAgent(ua); } catch (_e) {}

    if (!ses.__nodoDrexUaHook) {
      ses.__nodoDrexUaHook = true;
      ses.webRequest.onBeforeSendHeaders((details, cb) => {
        const h = details.requestHeaders || {};
        h['User-Agent']         = ua;
        h['sec-ch-ua']          = secChUa;
        h['sec-ch-ua-mobile']   = '?0';
        h['sec-ch-ua-platform'] = '"Windows"';
        if (!h['Accept-Language']) h['Accept-Language'] = 'es-AR,es;q=0.9,en;q=0.8';
        cb({ requestHeaders: h });
      });
    }
  } catch (e) {
    console.warn('[main] configurarSesionAgentesDrex:', e && e.message);
  }
}

// ── Ventana del backoffice del casino (Casinodrex) ────────────────────────────
// OCULTA por defecto: contiene la lógica de cargas automáticas pero no se muestra.
function createAgentWindow(url = AGENT_URL) {
  agentWindow = new BrowserWindow({
    width:  1400,
    height: 900,
    title:  'Agentes — Cargas automáticas',
    show:   false,
    webPreferences: {
      preload:              path.join(__dirname, 'agent-preload.js'),
      partition:            AGENT_PARTITION, // sesión dedicada → el proxy solo afecta a Agentes
      contextIsolation:     true,
      nodeIntegration:      false,
      sandbox:              true,
      backgroundThrottling: false,
    }
  });

  configurarSesionAgentesDrex(agentWindow);

  agentWindow.loadURL(url);

  // PATCH 01 · si Agentes se recarga/redirecta solo mientras hay una operación pendiente,
  // abortamos esa espera para que el panel no quede colgado.
  agentWindow.webContents.on('did-navigate', (_e, navUrl) => {
    if (navEsperadaDrex) return;
    if (pendingAutomation.size) {
      console.warn('[main] navegación inesperada en Agentes durante operación:', navUrl);
      for (const [, p] of pendingAutomation) {
        try { p.reject(new Error('La página de Agentes se recargó durante la operación. Reintentá.')); } catch (_) {}
      }
      pendingAutomation.clear();
    }
  });
  agentWindow.on('closed', () => {
    agentWindow = null;
    pendingAutomation.clear();
  });

  return agentWindow;
}

// ── Ventana de Chunior (backoffice secundario, VISIBLE) ───────────────────────
// Contiene la lógica de login + sync de billeteras + registro de cargas.
// El operador puede ver el flujo en vivo en esta ventana.
function createChuniorWindow() {
  chuniorWindow = new BrowserWindow({
    width:  1200,
    height: 800,
    title:  'Chunior — Backoffice',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation:     true,
      nodeIntegration:      false,
      sandbox:              true,
      backgroundThrottling: false, // que Chunior siga refrescando aunque no esté enfocado
    }
  });
  chuniorWindow.loadURL(CHUNIOR_URL);
  chuniorWindow.on('closed', () => { chuniorWindow = null; });
  return chuniorWindow;
}

function getChuniorWindow() {
  if (chuniorWindow && !chuniorWindow.isDestroyed()) return chuniorWindow;
  return createChuniorWindow();
}

function whenChuniorReady(win, timeoutMs = 15000) {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    win.webContents.once('did-finish-load', finish);
    setTimeout(finish, timeoutMs);
  });
}

function getAgentWindow(url = AGENT_URL) {
  if (agentWindow && !agentWindow.isDestroyed()) return agentWindow;
  return createAgentWindow(url);
}

function whenAgentReady(win, timeoutMs = 12000) {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    win.webContents.once('did-finish-load', finish);
    setTimeout(finish, timeoutMs);
  });
}

// PATCH 01 · detecta si Agentes devolvió error/bloqueo en vez de la app real.
async function agentPageIsBlockedDrex(win) {
  try {
    return await win.webContents.executeJavaScript(`(function(){
      try {
        var hasApp = !!(document.querySelector('#searchButton') || document.querySelector('input[name="amount"]') || document.querySelector('[data-agenttree-user-type]') || document.querySelector('input[type="password"]') || document.querySelector('input[name="alias"]'));
        if (hasApp) return false;
        var body = (document.body && (document.body.innerText || document.body.textContent) || '').slice(0,2000).toLowerCase();
        var title = (document.title || '').toLowerCase();
        return /(40[0-9]|50[0-9])\s*error|request blocked|request could not be satisfied|generated by cloudfront|service unavailable|bad gateway|gateway timeout|access denied|forbidden|algo sali|cannot read properties|errorboundary/.test(body) || /\b(403|404|500|502|503|error)\b/.test(title);
      } catch(e) { return false; }
    })()`, true);
  } catch (_e) { return false; }
}

// PATCH 01 · espera a que React/SPA monte algo operable antes de lanzar el preload.
async function agentWaitReadyDrex(win, timeoutMs = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await win.webContents.executeJavaScript(`(function(){
      try {
        if (document.querySelector('#searchButton') || document.querySelector('input.validationField') || document.querySelector('input[name="amount"]') || document.querySelector('input[type="password"]') || document.querySelector('input[name="alias"]') || document.querySelector('[data-agenttree-user-type]')) return 'ready';
        var b = (document.body && (document.body.innerText || document.body.textContent) || '').toLowerCase();
        if (/algo sali|cannot read properties|errorboundary|request blocked|generated by cloudfront|forbidden|\b(403|404|50[0-9])\b/.test(b)) return 'error';
        return 'wait';
      } catch(e) { return 'wait'; }
    })()`, true).catch(() => 'wait');
    if (st === 'ready') return true;
    if (st === 'error') return false;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

// ⛔ FLUJO BLINDADO — NO MODIFICAR (core de carga/retiro estable).
// PATCH 01: mantiene el mismo flujo, solo agrega espera real + reintento si Agentes carga bloqueado.
async function navigateAgentTo(url = AGENT_URL) {
  const win = getAgentWindow();
  navEsperadaDrex = true;
  try {
    const MAX = 3;
    for (let intento = 1; intento <= MAX; intento++) {
      await new Promise((resolve) => {
        let resuelto = false;
        const finish = () => {
          if (resuelto) return;
          resuelto = true;
          win.webContents.removeListener('did-finish-load', finish);
          resolve();
        };
        win.webContents.once('did-finish-load', finish);
        setTimeout(finish, 8000);
        try { win.loadURL(url); } catch (_) { finish(); }
      });
      await agentWaitReadyDrex(win);
      await new Promise(r => setTimeout(r, 900));
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

function automationTimeoutFor(method) {
  const envTimeout = Number(process.env.DREX_AUTOMATION_TIMEOUT_MS || 0);
  if (envTimeout > 0) return envTimeout;
  // Timeouts ajustados para que un CUELGUE se resuelva rápido y libere al operador (demanda alta).
  // Una carga normal tarda ~10-15s; si pasa de 45s está colgada → abortar y reintentar.
  if (method === 'cargarSaldo' || method === 'retirarSaldo') return 45000;   // antes 180s
  if (method === 'crearUsuario' || method === 'cambiarClave') return 55000;  // antes 90s
  if (method === 'buscarUsuario' || method === 'obtenerSaldoAgente') return 28000; // antes 45s
  return 40000; // antes 60s
}

function sendAutomation(method, ...args) {
  const win = getAgentWindow();
  // Algunos métodos requieren estar en una URL específica → navegamos primero
  let preNav;
  if      (method === 'buscarUsuario')       preNav = navigateAgentTo(AGENT_URL);
  else if (method === 'crearUsuario')        preNav = navigateAgentTo(NEW_USER_URL);
  else if (method === 'obtenerSaldoAgente')  preNav = navigateAgentTo(AGENT_URL);
  else                                       preNav = whenAgentReady(win);
  return preNav.then(() => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeoutMs = automationTimeoutFor(method);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingAutomation.delete(requestId);
        reject(new Error('Timeout: la automatización tardó demasiado.'));
      }, timeoutMs);

      pendingAutomation.set(requestId, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject:  e => { clearTimeout(timer); reject(e);  }
      });

      win.webContents.send('drex:automation:run', { requestId, method, args });
    });
  });
}

// ── Ventana de verificación (separada, corre en background) ──────────────────
function createVerifyWindow() {
  verifyWindow = new BrowserWindow({
    width:  1200,
    height: 800,
    title:  'Verificación — Login usuarios',
    show:   false,
    webPreferences: {
      preload:          path.join(__dirname, 'agent-preload.js'),
      partition:        AGENT_PARTITION, // misma sesión que Agentes (comparte login + proxy)
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
    }
  });
  verifyWindow.loadURL(AGENT_URL);
  verifyWindow.on('closed', () => { verifyWindow = null; pendingVerification.clear(); });
  return verifyWindow;
}

function getVerifyWindow() {
  if (verifyWindow && !verifyWindow.isDestroyed()) return verifyWindow;
  return createVerifyWindow();
}

async function sendVerification(usuario) {
  const win = getVerifyWindow();
  const currentUrl = win.webContents.getURL();
  if (!currentUrl.includes('user_search')) {
    win.loadURL(AGENT_URL);
    await whenAgentReady(win);
    await new Promise(r => setTimeout(r, 900));
  } else {
    await whenAgentReady(win);
  }
  const requestId = `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingVerification.delete(requestId);
      reject(new Error('Timeout en verificación.'));
    }, 30000);
    pendingVerification.set(requestId, {
      resolve: v => { clearTimeout(timer); resolve(v); },
      reject:  e => { clearTimeout(timer); reject(e);  }
    });
    win.webContents.send('drex:verify:run', { requestId, method: 'buscarUsuario', args: [usuario] });
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await configurarProxyElectronV15();
  createMainWindow();
  createChuniorWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  // ── Worker de cola (DORMIDO por defecto) ──────────────────────────────────
  // Solo se inicializa si WORKERS_ENABLED=1 en .env. Aislado: cualquier fallo
  // del worker NO afecta al panel ni al flujo on-demand existente.
  try {
    if (String(process.env.WORKERS_ENABLED || "0") === "1") {
      const { initWorkers } = require('./services/worker-bootstrap');
      global.__nodoWorkers = initWorkers({ BrowserWindow, path, env: process.env, pendingAutomation });
      console.log('[workers]', global.__nodoWorkers && global.__nodoWorkers.resumen);
    } else {
      console.log('[workers] desactivados (WORKERS_ENABLED!=1)');
    }
  } catch (e) {
    console.error('[workers] init falló (no afecta al panel):', e && e.message);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC handlers ──────────────────────────────────────────────────────────────


// ============================================================
// PANEL V15 · RPC BRIDGE
// ============================================================
// ============================================================
// V15.4 PLUS · RPC Supabase por REST fetch
// ============================================================
// Mantiene intacto Agentes/Chunior/operación rápida.
// Solo mejora panelAPI.rpc para poder leer Portal/Chat sin claves en HTML.
async function panelRpcRestFetchV154Plus(fn, params = {}) {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  if (!url || !key) {
    return { data: null, error: { message: "Falta SUPABASE_URL o SUPABASE_ANON_KEY en .env" } };
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(params || {})
    });

    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_e) { data = txt; }

    if (!res.ok) {
      return {
        data: null,
        error: {
          message: (data && (data.message || data.error || data.hint)) || `HTTP ${res.status}`,
          status: res.status,
          details: data
        }
      };
    }

    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: e.message || String(e) } };
  }
}

// Whitelist de RPC que el HTML puede invocar por panelAPI.rpc (lectura de Portal/Chat).
// Igual que ALLOWED_AUTOMATION_METHODS: evita que un bug/XSS en el renderer llame RPCs no previstas.
const PANEL_RPC_ALLOW = new Set([
  'landing_crear_chat_v2',
  'panel_nodo_send_chat_message',
  'panel_v15_5_listar_solicitudes_portal',
  'panel_v15_5_actualizar_solicitud_portal',
  'panel_core_get_chat_sesiones_json',
  'panel_v154_plus_listar_chat_sesiones',
  'panel_core_get_chat_mensajes_json',
  'panel_v154_plus_get_chat_mensajes',
  'panel_core_enviar_chat_json',
  'panel_v154_plus_enviar_chat'
]);

ipcMain.handle('panel:rpc', async (_event, arg1, arg2 = {}) => {
  let fn = arg1;
  let params = arg2 || {};

  if (arg1 && typeof arg1 === "object") {
    fn = arg1.fn || arg1.function || arg1.rpc || arg1.name || arg1.procedure;
    params = arg1.params || arg1.payload || arg1.args || {};
  }

  if (!fn || typeof fn !== "string") {
    return { data: null, error: { message: "RPC_INVALID_FN", details: { received: arg1 } } };
  }

  if (!PANEL_RPC_ALLOW.has(fn)) {
    console.warn('[panel:rpc] RPC no permitida:', fn);
    return { data: null, error: { message: "RPC_NO_PERMITIDA: " + fn } };
  }

  return await panelRpcRestFetchV154Plus(fn, params || {});
});

ipcMain.handle('panel:ping' , async () => ({
  ok: true,
  bridge: "panelAPI",
  version: "V15",
  ts: new Date().toISOString()
}));

ipcMain.handle('panel:get-context', async () => ({
  ok: true,
  pc_codigo:     process.env.PC_CODIGO || process.env.LANDING_PC_CODIGO || "",
  landing_pc:    process.env.LANDING_PC_CODIGO || process.env.PC_CODIGO || "",
  session_id:    Number(process.env.PANEL_SESSION_ID || 0),
  chunior_pt_id: process.env.CHUNIOR_PT_ID || null,
  operador_usuario: process.env.OPERADOR_USUARIO || "",
  operador_nombre:  process.env.OPERADOR_NOMBRE  || "",
  // PRODUCCIÓN: ya NO se exponen supabase_url/supabase_key acá (el renderer no los usa; tiene su
  // propio cliente con la anon key PÚBLICA). Lo ideal es migrar más lecturas a panelAPI.rpc.
}));

// Abre/enfoca la ventana del backoffice
// Navega la ventana del backoffice a la URL de búsqueda y espera a que cargue
ipcMain.handle('drex:navigate', async (_event, url) => {
  await navigateAgentTo(url || AGENT_URL);
  return { ok: true };
});

// Asegura que la ventana de agentes EXISTE (creándola hidden si hace falta) pero NO la muestra.
// Usado por automatizaciones (cargas, búsquedas) que solo necesitan que el webContents esté cargado.
ipcMain.handle('drex:open-agent-window', (_event, url) => {
  const win = getAgentWindow(url || AGENT_URL);
  if (url && win.webContents.getURL() !== url) win.loadURL(url);
  return { ok: true };
});

// Trae al frente la ventana de agentes (uso manual: botón "Abrir backoffice").
ipcMain.handle('drex:show-agent-window', (_event, url) => {
  const win = getAgentWindow(url || AGENT_URL);
  if (url && win.webContents.getURL() !== url) win.loadURL(url);
  win.show();
  win.focus();
  return { ok: true };
});

// Ejecuta un método de automatización en el backoffice
ipcMain.handle('drex:automation', async (_event, { method, args = [] } = {}) => {
  return sendAutomation(method, ...args);
});

// Auto-login del agente con credenciales BLINDADAS: la clave se trae acá (proceso main)
// vía RPC con el secreto del panel y se inyecta en el backoffice. NUNCA pasa por el renderer.
ipcMain.handle('drex:auto-login', async (_event, { pcCodigo } = {}) => {
  try {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
    const secret = process.env.PANEL_DATA_SECRET;
    if (!secret) { console.warn("[panel] Auto-login no disponible por missing-secret (falta PANEL_DATA_SECRET en .env). El panel sigue operativo para uso manual."); return { ok: false, reason: 'missing-secret' }; }
    const pc = String(pcCodigo || process.env.PC_CODIGO || '').trim();
    if (!url || !anon || !pc) return { ok: false, reason: 'config' };
    const resp = await fetch(`${url}/rest/v1/rpc/panel_get_agente_credenciales`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: secret, p_pc_codigo: pc })
    });
    const data = await resp.json().catch(() => null);
    if (!data || data.ok !== true || !data.usuario || !data.clave) return { ok: false, reason: 'no-creds' };
    const r = await sendAutomation('iniciarSesion', data.usuario, data.clave);
    return (r && r.ok !== false) ? { ok: true } : { ok: false, reason: 'login-fail', detail: r };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
});

// Aplica el proxy de la oficina. La config (incluida la clave) se trae acá, en el main,
// vía RPC con el secret del panel. NUNCA pasa por el renderer.
ipcMain.handle('proxy:apply', async (_event, { pcCodigo } = {}) => {
  try {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
    const secret = process.env.PANEL_DATA_SECRET;
    if (!secret) { console.warn("[panel] Proxy no aplicado por missing-secret (falta PANEL_DATA_SECRET en .env). Salida directa; el panel sigue operativo."); await aplicarProxyRuntime(null); return { ok: false, reason: 'missing-secret' }; } // sin secret → salida directa
    const pc = String(pcCodigo || process.env.PC_CODIGO || '').trim();
    if (!url || !anon || !pc) return { ok: false, reason: 'config' };
    const resp = await fetch(`${url}/rest/v1/rpc/panel_get_proxy`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: secret, p_pc_codigo: pc })
    });
    const data = await resp.json().catch(() => null);
    if (!data || data.ok !== true) return await aplicarProxyRuntime(null); // sin config → salida directa
    return await aplicarProxyRuntime({
      enabled: data.enabled === true,
      protocol: data.protocol, host: data.host, port: data.port,
      username: data.username, password: data.password, bypass: data.bypass
    });
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
});

// Recibe el resultado de la automatización desde agent-preload.js
ipcMain.on('drex:automation:result', (_event, response = {}) => {
  const pending = pendingAutomation.get(response.requestId);
  if (!pending) return;
  pendingAutomation.delete(response.requestId);
  if (response.ok !== false) pending.resolve(response.result ?? response);
  else pending.reject(new Error(response.error || 'Error en automatización.'));
});

// Verifica si un usuario existe en el casino (ventana separada, no interfiere con cargas)
ipcMain.handle('drex:verify-user', async (_event, { usuario } = {}) => {
  return sendVerification(usuario);
});

// Recibe resultado de verificación desde la verifyWindow
ipcMain.on('drex:verify:result', (_event, response = {}) => {
  const pending = pendingVerification.get(response.requestId);
  if (!pending) return;
  pendingVerification.delete(response.requestId);
  if (response.ok !== false) pending.resolve(response.result ?? response);
  else pending.reject(new Error(response.error || 'Error en verificación.'));
});

// ── IPC handlers para Chunior (ventana visible separada) ─────────────────────
// Ejecuta JS arbitrario en la ventana de Chunior.
// PRODUCCIÓN: en prod (NODE_ENV=production o NODO_PROD=1) queda BLOQUEADO salvo CHUNIOR_EXEC_ENABLED=1.
// Por defecto la app empaquetada NO setea NODE_ENV/NODO_PROD, así que el flujo Chunior sigue igual.
ipcMain.handle('chunior:exec', async (_event, script) => {
  // Gate SOLO por opt-in explícito NODO_PROD=1 (NO por NODE_ENV, que en la app empaquetada
  // puede venir 'production' y bloquearía el flujo Chunior). Por defecto: habilitado.
  if (process.env.NODO_PROD === '1' && process.env.CHUNIOR_EXEC_ENABLED !== '1') {
    return { ok: false, reason: 'chunior_exec_disabled' };
  }
  const win = getChuniorWindow();
  if (win.webContents.isLoading()) await whenChuniorReady(win);
  return win.webContents.executeJavaScript(script, true);
});

// Devuelve la URL actual de la ventana de Chunior
ipcMain.handle('chunior:get-url', () => {
  const win = getChuniorWindow();
  return win.webContents.getURL();
});

// Navega la ventana de Chunior a una URL nueva y espera a que cargue
ipcMain.handle('chunior:navigate', async (_event, url) => {
  const win = getChuniorWindow();
  win.loadURL(url);
  await whenChuniorReady(win);
  return { ok: true, url: win.webContents.getURL() };
});

// Recarga la ventana de Chunior
ipcMain.handle('chunior:reload', async () => {
  const win = getChuniorWindow();
  win.reload();
  await whenChuniorReady(win);
  return { ok: true };
});

// Trae la ventana de Chunior al frente
ipcMain.handle('chunior:focus', () => {
  const win = getChuniorWindow();
  win.show();
  win.focus();
  return { ok: true };
});
