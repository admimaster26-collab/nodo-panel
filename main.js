const path    = require('node:path');
const fs      = require('node:fs');
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const { createClient } = require('@supabase/supabase-js');

// Ícono de la app (la N verde). Va en TODAS las ventanas: sin `icon`, Electron le pone su propio
// logo por defecto a cada una y en la barra de tareas aparecían ventanas ajenas al panel.
const APP_ICON = path.join(__dirname, 'icons', 'icon-n.png');

// ── Auto-actualización (electron-updater, chequeo MANUAL desde el panel) ──────
// autoDownload=false: solo busca y avisa; el operador decide bajar/instalar
// desde el botón del panel. Así ninguna oficina se actualiza sola mientras
// seguimos iterando el código.
// Canales de actualización (portado de NexoBetaChan): alpha = repo oficial nuestro,
// beta = repo del colega (pruebas). Son FUENTES distintas (repos distintos), sin cruce.
// Override por .env: UPDATER_ALPHA="owner/repo" · UPDATER_BETA="owner/repo".
const UPDATE_CHANNELS = {
  alpha: { owner: 'admimaster26-collab', repo: 'nodo-panel',   label: 'Alpha · oficial' },
  beta:  { owner: 'zhinouno-ui',         repo: 'NexoBetaChan',  label: 'Beta · pruebas' }
};
(function(){
  const parse = s => { const p = String(s||'').split('/'); return (p[0] && p[1]) ? { owner:p[0], repo:p[1] } : null; };
  const a = parse(process.env.UPDATER_ALPHA), b = parse(process.env.UPDATER_BETA);
  if (a) { UPDATE_CHANNELS.alpha.owner = a.owner; UPDATE_CHANNELS.alpha.repo = a.repo; }
  if (b) { UPDATE_CHANNELS.beta.owner  = b.owner; UPDATE_CHANNELS.beta.repo  = b.repo; }
})();
let _updaterChannel = 'alpha'; // canal activo (lo fija el renderer en cada check)
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
} catch (_e) { console.warn('[updater] electron-updater no disponible:', _e && _e.message); }


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
    // Prioridad: (1) carpeta de datos de usuario de Windows (app.getPath('userData'), típicamente
    // %APPDATA%\nodo-operativo\) — NUNCA la toca el instalador/desinstalador de NSIS, sobrevive
    // a cada actualización. (2) junto al ejecutable instalado (compatibilidad con instalaciones
    // viejas que todavía tienen el .env ahí — pero OJO, ese se pierde en cada update porque el
    // desinstalador de la versión previa borra toda la carpeta de instalación). (3) __dirname (dev).
    const dirs = [];
    try { dirs.push(app.getPath('userData')); } catch (_e) {}
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
    // Tolerante al encoding: si el .env se guardó en UTF-16 (típico con Notepad "Unicode" o con
    // `>`/Out-File de PowerShell), leerlo como UTF-8 da basura y NO se detectaban las variables.
    // Detectamos el BOM y decodificamos bien (UTF-16 LE/BE, UTF-8 con BOM, o UTF-8 plano).
    let raw;
    try {
      const _buf = fs.readFileSync(envPath);
      if (_buf.length >= 2 && _buf[0] === 0xFF && _buf[1] === 0xFE) raw = _buf.toString("utf16le");
      else if (_buf.length >= 2 && _buf[0] === 0xFE && _buf[1] === 0xFF) raw = Buffer.from(_buf).swap16().toString("utf16le");
      else if (_buf.length >= 3 && _buf[0] === 0xEF && _buf[1] === 0xBB && _buf[2] === 0xBF) raw = _buf.slice(3).toString("utf8");
      else raw = _buf.toString("utf8");
    } catch (_e) { raw = fs.readFileSync(envPath, "utf8"); }
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

// ── Plataforma de agentes: casinodrex (default) o BET300 (flag AGENT_PLATFORM=bet300 en .env) ──
// El flag va en el .env junto al exe / userData (como PANEL_DATA_SECRET). Sin flag → casinodrex,
// idéntico a siempre. Ambos preloads viajan en el MISMO build; el flag elige URL + preload.
// BET300 usa la MISMA partición/proxy que casinodrex (sale por el proxy de la oficina igual).
// ── Backend de Agentes SWITCHEABLE en runtime (casinodrex ⇄ bet300) ───────────
// El backend define URL + preload + selectores de "app lista". Se cambia desde el panel
// (botón "🎰 Backoffice"), se PERSISTE en userData/nodo-agent-backend (sobrevive updates)
// y RELANZA la ventana de agentes. IMPORTANTE: el proxy NO se toca — vive en la sesión
// persist:nodo-agentes (MISMA partición para ambos backends), así que la salida de red
// (proxy de la oficina) es idéntica se elija el backend que se elija.
const AGENT_BACKENDS = {
  casinodrex: {
    url:        'https://bo.casinodrex.com/agents/user_search',
    newUserUrl: 'https://bo.casinodrex.com/agents/new_user',
    preload:    'agent-preload.js',
    spa:        false,
    label:      'Casinodrex',
    appSel:     '#searchButton, input.validationField, input[name="amount"], input[type="password"], input[name="alias"], [data-agenttree-user-type], span.hideUserBalance, .crmpam_no_data_found'
  },
  bet300: {
    url:        'https://agentesbet.io/',
    newUserUrl: 'https://agentesbet.io/',
    preload:    'agent-preload-bet300.js',
    spa:        true,
    label:      'BET300 (agentesbet.io)',
    appSel:     'input[placeholder="Buscar usuario"], input[placeholder="Alias"], .v-navigation-drawer .v-list-item, .v-list-item--link'
  }
};
function _agentBackendFile(){ try { return path.join(app.getPath('userData'), 'nodo-agent-backend'); } catch (_e) { return ''; } }
function _leerBackendGuardado(){
  // 1) Lo que eligió el operador desde el panel (archivo persistido) manda.
  try { const f = _agentBackendFile(); if (f && fs.existsSync(f)) { const v = String(fs.readFileSync(f, 'utf8')).trim().toLowerCase(); if (AGENT_BACKENDS[v]) return v; } } catch (_e) {}
  // 2) Fallback al .env (AGENT_PLATFORM) para las PCs que ya lo usan. Default: casinodrex (intacto).
  const env = String(process.env.AGENT_PLATFORM || '').trim().toLowerCase();
  return env === 'bet300' ? 'bet300' : 'casinodrex';
}
let _agentBackend = _leerBackendGuardado();
let AGENT_IS_BET300, AGENT_URL, NEW_USER_URL, AGENT_PRELOAD, _AGENT_APP_SEL;
function _aplicarBackend(b){
  if (!AGENT_BACKENDS[b]) b = 'casinodrex';
  _agentBackend = b;
  const c = AGENT_BACKENDS[b];
  AGENT_IS_BET300 = (b === 'bet300');
  AGENT_URL       = c.url;
  NEW_USER_URL    = c.newUserUrl;
  AGENT_PRELOAD   = path.join(__dirname, c.preload);
  _AGENT_APP_SEL  = c.appSel;
}
_aplicarBackend(_agentBackend);
try { console.log('[agente] backend =', _agentBackend, '·', AGENT_BACKENDS[_agentBackend].label); } catch (_e) {}
const CHUNIOR_URL  = 'https://bo.chunior.com/transacciones/';

let mainWindow    = null;
let agentWindow   = null;
let verifyWindow  = null;
let chuniorWindow = null;
let _chuLastRecover = 0; // anti-loop del auto-recovery de 403/CSRF de Chunior
let _chu403Count = 0;    // escalación: 1er 403 → navegar a base; si persiste → limpiar cookies
// Limpia SOLO las cookies del dominio de Chunior (NO toca Supabase, que vive en la misma sesión default).
async function limpiarCookiesChunior(win){
  try{
    const ses = win.webContents.session;
    const cookies = await ses.cookies.get({ domain: 'chunior.com' });
    for (const c of cookies) {
      const dom = (c.domain && c.domain.startsWith('.')) ? c.domain.slice(1) : (c.domain || '');
      if (!/chunior\.com$/i.test(dom)) continue;
      const url = (c.secure ? 'https://' : 'http://') + dom + (c.path || '/');
      try { await ses.cookies.remove(url, c.name); } catch (_e) {}
    }
  }catch(e){ console.warn('[chunior] limpiar cookies', e && e.message); }
}
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
    icon:  APP_ICON,
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


// PATCH 01 · User-Agent de Chrome real para Agentes/Chunior.
// Sus CDN/WAF (CloudFront/Cloudflare) 404ean/403ean el UA por defecto de Electron porque
// lleva los tokens "nodo-operativo/x" y "Electron/x" (bot detection).
//
// CLAVE (fix del 403 en la 1.0.78): se setea SOLO a nivel webContents (setUserAgent), NUNCA
// sobre la sesión compartida, y NO se forjan client-hints (sec-ch-ua…) a mano.
//   • ses.setUserAgent()/onBeforeSendHeaders sobre la ventana de Chunior pisaba la DEFAULT
//     session → contaminaba Supabase y toda la app (regresión de la 1.0.78).
//   • Inyectar sec-ch-ua a mano choca con el fingerprint real de Chromium → el WAF lo marca
//     como bot y devuelve 403. Dejamos que Chromium mande sus propios client-hints (consistentes).
// Resultado: UA limpio de Chrome, client-hints coherentes, cero pollution de la default session.
// ACTUALIZACIÓN (fix CSRF de Chunior): Chunior detecta Electron NO solo por el UA string (que ya
// reescribimos por-webContents) sino por el client-hint sec-ch-ua, que SIGUE diciendo "Electron" en
// cada request → su WAF rompe la sesión/CSRF (403). Ahora reescribimos UA + sec-ch-ua de Chrome
// limpio SOLO en las requests a chunior.com (filtrado por URL en la default session):
//   • Supabase queda INTACTO (no se reescribe nada suyo) → sin la contaminación de la 1.0.78.
//   • NO se toca la sesión de Agentes (persist:nodo-agentes) → no vuelve el 403 del WAF de casinodrex.
function configurarSesionAgentesDrex(win) {
  try {
    const cur       = win.webContents.getUserAgent();
    const chromeTok = (cur.match(/Chrome\/[\d.]+/) || ['Chrome/124.0.0.0'])[0];
    const major     = (chromeTok.match(/\d+/) || ['124'])[0];
    const ua        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' + chromeTok + ' Safari/537.36';
    const secChUa   = '"Chromium";v="' + major + '", "Google Chrome";v="' + major + '", "Not.A/Brand";v="99"';
    win.webContents.setUserAgent(ua); // por-webContents (Agentes y Chunior)
    const ses = win.webContents.session;
    if (ses === session.defaultSession && !ses.__nodoChuniorHook) {
      ses.__nodoChuniorHook = true;
      ses.webRequest.onBeforeSendHeaders((details, cb) => {
        try {
          const h = details.requestHeaders || {};
          if (/chunior\.com/i.test(details.url || '')) { // SOLO Chunior; Supabase sin tocar
            h['User-Agent']         = ua;
            h['sec-ch-ua']          = secChUa;
            h['sec-ch-ua-mobile']   = '?0';
            h['sec-ch-ua-platform'] = '"Windows"';
            if (!h['Accept-Language']) h['Accept-Language'] = 'es-AR,es;q=0.9,en;q=0.8';
          }
          cb({ requestHeaders: h });
        } catch (_e) { cb({ requestHeaders: (details && details.requestHeaders) || {} }); }
      });
    }

    // BET300: Cloudflare de agentesbet.net bloquea por el client-hint sec-ch-ua "Electron".
    // Reescribimos UA + sec-ch-ua SOLO para agentesbet.net y SOLO con el flag bet300 activo
    // (casinodrex 100% intacto: con casinodrex este hook ni se instala).
    if (AGENT_IS_BET300 && !ses.__nodoBet300Hook) {
      ses.__nodoBet300Hook = true;
      ses.webRequest.onBeforeSendHeaders((details, cb) => {
        try {
          const h = details.requestHeaders || {};
          if (/agentesbet\.(net|io)/i.test(details.url || '')) {
            h['User-Agent']         = ua;
            h['sec-ch-ua']          = secChUa;
            h['sec-ch-ua-mobile']   = '?0';
            h['sec-ch-ua-platform'] = '"Windows"';
            if (!h['Accept-Language']) h['Accept-Language'] = 'es-AR,es;q=0.9,en;q=0.8';
          }
          cb({ requestHeaders: h });
        } catch (_e) { cb({ requestHeaders: (details && details.requestHeaders) || {} }); }
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
    icon:   APP_ICON,
    show:   false,
    webPreferences: {
      preload:              AGENT_PRELOAD,
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
    icon:   APP_ICON,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation:     true,
      nodeIntegration:      false,
      sandbox:              true,
      backgroundThrottling: false, // que Chunior siga refrescando aunque no esté enfocado
    }
  });
  // Chunior 404ea las requests con User-Agent de Electron (bot detection en su CDN). Le ponemos el
  // mismo UA de Chrome real que usa la ventana de Agentes → el login carga como en un navegador normal.
  try { configurarSesionAgentesDrex(chuniorWindow); } catch (_e) {}
  chuniorWindow.loadURL(CHUNIOR_URL);
  // Auto-recovery del 403/CSRF: si Chunior muestra "403 Forbidden" (token CSRF vencido), NO sirve
  // recargar (re-envía el POST fallido → mismo 403). Navegamos a la BASE con un GET nuevo → token
  // fresco. Guarda anti-loop (una vez cada 8s).
  chuniorWindow.webContents.on('did-finish-load', async () => {
    try {
      if (!chuniorWindow || chuniorWindow.isDestroyed()) return;
      const t = chuniorWindow.webContents.getTitle() || '';
      if (/403|forbidden|csrf/i.test(t)) {
        if (Date.now() - _chuLastRecover < 7000) return; // anti-loop
        _chuLastRecover = Date.now();
        _chu403Count++;
        if (_chu403Count >= 2) {
          // El GET a la base TAMBIÉN da 403 → la cookie de sesión está corrupta. Limpiarla y reintentar.
          console.warn('[chunior] 403 persiste → limpiando cookies de Chunior y recargando login limpio');
          _chu403Count = 0;
          try { await limpiarCookiesChunior(chuniorWindow); } catch (_e) {}
        } else {
          console.warn('[chunior] 403/CSRF detectado → navegando a la base (GET) para recuperar el token');
        }
        chuniorWindow.loadURL(CHUNIOR_URL);
      } else {
        _chu403Count = 0; // se recuperó
      }
    } catch (_e) {}
  });
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
// Robustez (evita falsos "bloqueado" que gatillan recargas de más):
//   • Señal POSITIVA primero: si hay CUALQUIER elemento operable de la app → NO bloqueado.
//   • Señal negativa SOLO con frases específicas de CDN/WAF, no con un "error" o un número
//     suelto en el título/cuerpo (eso marcaba páginas válidas como bloqueadas).
// Selector de "app operable" (señal positiva) y alternación de frases de error de CDN/WAF
// (señal negativa). Ambos strings SIN backslashes → se inyectan sin problemas en el
// executeJavaScript de abajo; el bloqueo se arma con new RegExp(..., 'i') en la página.
// _AGENT_APP_SEL (señal positiva de "app operable") ahora es runtime: lo setea _aplicarBackend
// según el backend elegido. Los template strings de abajo lo leen en cada llamada → toman el valor
// vigente aunque se cambie el backend en caliente.
const _AGENT_BLOCK_ALT = 'request blocked|request could not be satisfied|generated by cloudfront|cloudfront|access denied|forbidden|not authorized|service unavailable|bad gateway|gateway timeout|just a moment|attention required|checking your browser|ray id|algo sali|cannot read propert|errorboundary';
async function agentPageIsBlockedDrex(win) {
  try {
    return await win.webContents.executeJavaScript(`(function(){
      try {
        if (document.querySelector('${_AGENT_APP_SEL}')) return false;
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
        if (document.querySelector('${_AGENT_APP_SEL}')) return 'ready';
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
async function navigateAgentTo(url = AGENT_URL, opts = {}) {
  const win = getAgentWindow();
  const forceReload = !!opts.forceReload;
  // BET300 es una SPA (Vue): la ruta interna cambia (/, /login, rutas del router) pero es LA MISMA
  // app. Comparar por ORIGIN → se reconoce como "misma página" y se REUSA sin recargar (agentesbet.io
  // es más lento que casinodrex; recargar en cada búsqueda hacía que buscarUsuario pasara el timeout).
  const sameUrl = (a, b) => {
    if (AGENT_IS_BET300) { try { return new URL(a).origin === new URL(b).origin; } catch (_e) { return false; } }
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
  else if (method === 'crearUsuario')        preNav = navigateAgentTo(NEW_USER_URL, { forceReload: !AGENT_IS_BET300 }); // BET300 crea por modal, sin recargar
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
    icon:   APP_ICON,
    show:   false,
    webPreferences: {
      preload:          AGENT_PRELOAD,
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
  // Windows agrupa por AppUserModelID: sin esto la barra de tareas y las notificaciones del
  // sistema usan el ícono genérico de Electron en vez del de la app.
  try { app.setAppUserModelId('com.nodooperativo.app'); } catch (_e) {}
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
  'landing_retiro_registrar_parcial',
  'panel_core_get_chat_sesiones_json',
  'panel_v154_plus_listar_chat_sesiones',
  'panel_core_get_chat_mensajes_json',
  'panel_v154_plus_get_chat_mensajes',
  'panel_core_enviar_chat_json',
  'panel_v154_plus_enviar_chat',
  // CRM · reconexión y prevalidación (v1.1.61)
  'panel_reconexion_cola',
  'panel_reconexion_marcar',
  'panel_reconexion_unificar',
  'panel_reconexion_limpiar_seguros',
  'panel_dormidos',
  'panel_crm_perfil_v1',
  'panel_usuarios_contacto',
  'panel_prevalidar_usuario'
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

// ── Nexo: integración por ARCHIVO (OPCIONAL, no estricta · portado de NexoBetaChan) ──
// Contrato (verificado contra el código de Nexo): nodo es DUEÑO de
//   %APPDATA%\nexo-desktop\shared\nodo-datos.json
// Lo escribe atómico (tmp+rename); Nexo lo LEE al abrir y fusiona (una dirección, un dueño → cero
// corrupción). NUNCA tocar el shard nexo-db-<pid>.json de Nexo. No estricto: si nexo-desktop NO
// está instalado (no existe la carpeta), no se escribe nada y no es error.
function _nexoDatosPath() {
  return path.join(app.getPath('appData'), 'nexo-desktop', 'shared', 'nodo-datos.json');
}
function _nexoInstalado() {
  try { return fs.existsSync(path.join(app.getPath('appData'), 'nexo-desktop')); } catch (_e) { return false; }
}
ipcMain.handle('nexo:estado', async () => {
  try {
    const p = _nexoDatosPath();
    const instalado = _nexoInstalado();
    let existeArchivo = false, bytes = 0, mtime = null;
    try { if (fs.existsSync(p)) { const st = fs.statSync(p); existeArchivo = true; bytes = st.size; mtime = st.mtime.toISOString(); } } catch (_e) {}
    return { ok:true, instalado, path:p, existeArchivo, bytes, mtime };
  } catch (e) { return { ok:false, error: e.message || String(e) }; }
});
ipcMain.handle('nexo:write', async (_e, arg = {}) => {
  try {
    if (!_nexoInstalado()) return { ok:false, instalado:false }; // Nexo no está → no escribimos (no estricto)
    const p = _nexoDatosPath();
    const dir = path.dirname(p);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) {} // nodo crea su carpeta shared/
    const content = String(arg && arg.content != null ? arg.content : '');
    const tmp = p + '.tmp-nodo';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, p); // atómico en el mismo volumen
    return { ok:true, instalado:true, path:p, bytes: Buffer.byteLength(content, 'utf8') };
  } catch (e) { return { ok:false, error: e.message || String(e) }; }
});

// ── Auto-actualización: chequeo/descarga/instalación MANUAL desde el botón del panel ──
function _sendUpdaterStatus(event, payload) {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win) win.webContents.send('updater:status', payload);
  } catch (_e) {}
}

ipcMain.handle('updater:version', () => ({ ok: true, version: app.getVersion() }));

ipcMain.handle('updater:check', async (event, arg) => {
  if (!autoUpdater) return { ok: false, reason: 'no-updater' };
  if (!app.isPackaged) return { ok: false, reason: 'dev-mode' };
  // Canal elegido por el renderer (persistido en el panel). Default: el último usado.
  const canal = (arg && arg.channel && UPDATE_CHANNELS[arg.channel]) ? arg.channel : _updaterChannel;
  _updaterChannel = canal;
  const repo = UPDATE_CHANNELS[canal];
  try {
    autoUpdater.removeAllListeners();
    autoUpdater.on('checking-for-update', () => _sendUpdaterStatus(event, { state: 'checking', channel: canal }));
    autoUpdater.on('update-available',    (info) => _sendUpdaterStatus(event, { state: 'available', version: info && info.version, channel: canal }));
    autoUpdater.on('update-not-available',() => _sendUpdaterStatus(event, { state: 'not-available', channel: canal }));
    autoUpdater.on('error', (err) => _sendUpdaterStatus(event, { state: 'error', message: String(err && err.message || err), channel: canal }));
    autoUpdater.on('download-progress', (p) => _sendUpdaterStatus(event, { state: 'downloading', percent: Math.round(p && p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => _sendUpdaterStatus(event, { state: 'downloaded', version: info && info.version, channel: canal }));
    // Cada canal es una FUENTE distinta (repo distinto). Sin cruce automático.
    autoUpdater.setFeedURL({ provider: 'github', owner: repo.owner, repo: repo.repo });
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo && r.updateInfo.version, channel: canal, repo: repo.owner + '/' + repo.repo };
  } catch (e) {
    console.warn('[updater] check falló · canal', canal, '(' + repo.owner + '/' + repo.repo + ') ·', e && e.message);
    return { ok: false, reason: 'error', channel: canal, message: String(e && e.message || e) };
  }
});

ipcMain.handle('updater:download', async () => {
  if (!autoUpdater) return { ok: false };
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

ipcMain.handle('updater:install', () => {
  if (!autoUpdater) return { ok: false };
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

// "Volver a la versión anterior": abre la página de releases en el navegador, donde la oficina
// puede bajar cualquier instalador previo si esta versión falla. Es la salida de emergencia
// más confiable (un downgrade automático de electron-updater es frágil).
ipcMain.handle('updater:open-releases', async () => {
  try { const repo = UPDATE_CHANNELS[_updaterChannel] || UPDATE_CHANNELS.alpha; await shell.openExternal('https://github.com/' + repo.owner + '/' + repo.repo + '/releases'); return { ok: true }; }
  catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

// Abrir un link en el navegador del sistema. Lo usa Reconectar para WhatsApp: si se
// abriera dentro de NODO habría que escanear el QR aparte, y encima WhatsApp Web
// rechaza el user-agent de Electron. En el navegador del operador la sesión ya está.
// Allowlist chica a propósito: esto lo dispara el renderer, no le abrimos cualquier URL.
const EXTERNO_OK = new Set(['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'github.com']);
ipcMain.handle('app:abrir-externo', async (_event, url) => {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:') return { ok: false, message: 'SOLO_HTTPS' };
    if (!EXTERNO_OK.has(u.hostname)) return { ok: false, message: 'DOMINIO_NO_PERMITIDO: ' + u.hostname };
    await shell.openExternal(u.toString());
    return { ok: true };
  } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
});

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

// ── Switch de backend de Agentes (casinodrex ⇄ bet300) ───────────────────────
// El panel muestra un botón "🎰 Backoffice" que llama a estos handlers.
ipcMain.handle('agent:get-backend', () => ({
  ok: true,
  backend: _agentBackend,
  label: (AGENT_BACKENDS[_agentBackend] || {}).label || _agentBackend,
  url: AGENT_URL,
  opciones: Object.keys(AGENT_BACKENDS).map(k => ({ id: k, label: AGENT_BACKENDS[k].label }))
}));
// Cambia el backend, lo PERSISTE y RELANZA la ventana de agentes con el preload/URL nuevos.
// NO toca el proxy: la sesión persist:nodo-agentes (misma partición para ambos backends) conserva
// su setProxy + auth → la ventana recreada sale por el MISMO proxy de la oficina, sin re-aplicar nada.
ipcMain.handle('agent:set-backend', (_event, { backend } = {}) => {
  if (!AGENT_BACKENDS[backend]) return { ok: false, error: 'backend desconocido: ' + backend };
  if (backend === _agentBackend) return { ok: true, backend, sinCambio: true, label: AGENT_BACKENDS[backend].label };
  _aplicarBackend(backend);
  try { const f = _agentBackendFile(); if (f) fs.writeFileSync(f, backend, 'utf8'); } catch (_e) {}
  // Cerrar la ventana de agente + la de verificación → se recrean con el preload/URL del backend nuevo.
  try { if (agentWindow && !agentWindow.isDestroyed()) { agentWindow.destroy(); } } catch (_e) {}
  agentWindow = null;
  try { if (verifyWindow && !verifyWindow.isDestroyed()) { verifyWindow.destroy(); } } catch (_e) {}
  verifyWindow = null;
  // Relanzar y mostrar (el operador probablemente tenga que loguearse al backend nuevo la 1ª vez).
  try { const w = getAgentWindow(); w.show(); w.focus(); } catch (_e) {}
  try { console.log('[agent-backend] cambiado a', backend, '→', AGENT_URL, '·', AGENT_PRELOAD); } catch (_e) {}
  return { ok: true, backend, label: AGENT_BACKENDS[backend].label, url: AGENT_URL };
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
// Tras un diálogo nativo (confirm), la ventana queda sin input de teclado en TODOS los campos y
// ni el refresh lo arregla — solo blur+focus de la BrowserWindow lo recupera. (Portado de NexoBetaChan)
ipcMain.handle('panel:refocus', () => {
  try { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.blur(); mainWindow.focus(); } } catch (_e) {}
  return { ok: true };
});

ipcMain.handle('chunior:reload', async () => {
  const win = getChuniorWindow();
  win.reload();
  await whenChuniorReady(win);
  return { ok: true };
});

// Reinicia Chunior (recupera del 403/CSRF). NO recarga (eso re-envía el POST fallido → mismo 403):
// NAVEGA a la base con un GET → token CSRF fresco. Con opts.hard limpia SOLO las cookies del dominio
// de Chunior (NO toca Supabase, que también vive en la sesión default) para forzar un login limpio.
ipcMain.handle('chunior:reset', async (_event, opts) => {
  const win = getChuniorWindow();
  _chu403Count = 0;
  if (opts && opts.hard) { try { await limpiarCookiesChunior(win); } catch (_e) {} }
  try { win.loadURL(CHUNIOR_URL); await whenChuniorReady(win); } catch (_e) {}
  try { win.show(); win.focus(); } catch (_e) {}
  let url = ''; try { url = win.webContents.getURL(); } catch (_e) {}
  return { ok: true, url };
});

// Trae la ventana de Chunior al frente
ipcMain.handle('chunior:focus', () => {
  const win = getChuniorWindow();
  win.show();
  win.focus();
  return { ok: true };
});
