'use strict';
// ── Salida de consola a prueba de tuberías rotas ─────────────────────────────
// Cuando quien lanzó la app cierra su salida (arrancarla con `| head`, cerrar la
// terminal, un lanzador que no lee stdout), el SIGUIENTE console.log del proceso
// principal tira EPIPE. Como nadie lo atrapa, Electron lo toma como excepción no
// capturada y mata la app con el cartel rojo "A JavaScript error occurred in the
// main process" — con un stack que apunta a un console.warn cualquiera y no dice
// nada del problema real.
//
// Hay 28 console.* repartidos por main/: guardar cada uno sería absurdo. Se tapa
// una sola vez, en la fuente. Perder un log no es motivo para tirar abajo la app
// del operador en medio de una operación.
// Todo va entre try/catch y comprobando que exista: los tests cargan main.js en un
// sandbox de vm donde `process` está recortado y no tiene ni .on ni los streams.
try {
  for (const flujo of [process.stdout, process.stderr]) {
    if (flujo && typeof flujo.on === 'function') {
      flujo.on('error', (e) => { if (!e || e.code !== 'EPIPE') throw e; });
    }
  }
} catch (_e) {}
try {
  if (typeof process.on === 'function') {
    process.on('uncaughtException', (e) => {
      if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) return;  // salida cerrada: se ignora
      throw e;                                                                     // cualquier otra cosa, comportamiento normal
    });
  }
} catch (_e) {}

// Composition root: domain state and IPC handlers live in main/.
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const { configureEnvironment } = require('./main/config');
const { createProxyService } = require('./main/proxy');
const { createAgentBackends } = require('./main/agent-backends');
const { createSessionHeaders } = require('./main/session-headers');
const { createPanelWindow, anotarFalla } = require('./main/panel-window');
const { createChuniorWindowService } = require('./main/chunior-window');
const { createRequestRegistry } = require('./main/request-registry');
const { createAgentWindowService } = require('./main/agent-window');
const { createAutomationService } = require('./main/automation');
const { createVerificationService } = require('./main/verification');
const { registerPanelIpc } = require('./main/panel-rpc');
const { registerNexoIpc } = require('./main/nexo-files');
const { registerUpdaterIpc } = require('./main/updater');
const { registerExternalLinksIpc } = require('./main/external-links');
const { createImageWindowService } = require('./main/image-window');
const { registerAgentIpc } = require('./main/agent-ipc');
const { registerOfficeCredentialsIpc } = require('./main/office-credentials');
const { createDiscordPresence } = require('./main/discord');

const rootDir = __dirname;
const icon = path.join(rootDir, 'icons', 'icon-n.png');
configureEnvironment({ app, rootDir });
const proxy = createProxyService({ app, session });
const backends = createAgentBackends({ app, rootDir });
const headers = createSessionHeaders({ session, backends });
// Cierres y trabas de la pantalla y de los procesos de Electron, uno por línea, en cada PC.
const fallasLog = path.join(app.getPath('userData'), 'nodo-fallas.log');
app.on('child-process-gone', (_e, d) => anotarFalla(fallasLog, 'se cerro un proceso: ' + JSON.stringify(d)));
const panel = createPanelWindow({ BrowserWindow, rootDir, icon, logPath: fallasLog });
const chunior = createChuniorWindowService({ BrowserWindow, icon, headers, panel, session });
// Visor de imágenes del chat: ventana aparte y una sola. Se registra solo sus IPC.
const visorImagen = createImageWindowService({ BrowserWindow, ipcMain, rootDir, icon });
const automationRequests = createRequestRegistry();
const verificationRequests = createRequestRegistry();
const agents = createAgentWindowService({ BrowserWindow, icon, partition: proxy.partition, backends, headers, requests: automationRequests });
const automation = createAutomationService({ agents, backends, requests: automationRequests });
const verification = createVerificationService({ BrowserWindow, icon, partition: proxy.partition, backends, requests: verificationRequests });
// NODO en Discord. El Application ID NO es un secreto — se ve en la presencia de cualquiera que la
// tenga puesta — y es el mismo para las siete oficinas, así que va como constante y no por el
// entorno: el .env no se edita PC por PC. Si Discord no está abierto, no pasa nada: es un no-op
// silencioso que no puede frenar ni romper el panel.
const DISCORD_APP_ID = '1553460302849249351';
const discord = createDiscordPresence({
  appId: DISCORD_APP_ID,
  version: (function(){ try { return app.getVersion(); } catch (_e) { return ''; } })()
});

registerPanelIpc({ ipcMain });
registerNexoIpc({ ipcMain, app });
registerUpdaterIpc({ ipcMain, app, BrowserWindow, shell, panel });
registerExternalLinksIpc({ ipcMain, shell });
registerAgentIpc({ ipcMain, agents, automation, verification, backends, automationRequests, verificationRequests });
const officeCredentials = registerOfficeCredentialsIpc({ ipcMain, automation, proxy });
// El panel manda lo que hay que mostrar; decidir QUE mostrar es del panel, no de main.
ipcMain.handle('nodo:discord', (_e, estado) => {
  try { discord.actualizar(estado); } catch (_err) {}
  return { ok: true, habilitado: discord.habilitado, conectado: discord.conectado };
});
chunior.registerIpc(ipcMain);
// La ventana de Agentes avisa en el momento que vio "session is invalid" (18/11): se le pasa al panel, que
// pone el cartel y pide el ingreso. Antes NODO se enteraba recién en la próxima operación.
ipcMain.on('drex:sesion-caida', (_e, datos) => {
  try {
    const w = panel.current;
    if (w && !w.isDestroyed()) w.webContents.send('drex:sesion-caida', datos || {});
  } catch (_) {}
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
// El panel ES NODO. Las ventanas de Agentes y de verificacion estan ocultas: cerrando el panel con la
// X, ellas mantenian vivo el proceso con la sesion del backoffice abierta, y NODO "cerrado" seguia
// corriendo de fondo con el codigo viejo. Ahora cerrar el panel cierra todo. Y recargar el panel
// recrea esas dos ventanas, para que tomen el preload y el estado nuevos; si hay una carga, un retiro
// o una verificacion en curso, se espera a que termine: no se corta nada a la mitad (Juan, 16/11).
// Chunior no se toca al recargar: su sesion no persiste y habria que volver a entrar.
function atarVentanasAlPanel() {
  const win = panel.current;
  if (!win) return;
  win.on('closed', () => { app.quit(); });
  let cargas = 0;
  win.webContents.on('did-finish-load', async () => {
    if (++cargas === 1) return;   // la primera carga es el arranque
    // Sin tope: cerrar la ventana de Agentes con una carga o un retiro a la mitad podía dejarlo hecho en el
    // casino y sin anotar (revisión del 18/11). Si tarda, se avisa una vez y se sigue esperando.
    const desde = Date.now(); let avisado = false;
    while (automationRequests.pending.size || verificationRequests.pending.size) {
      if (!avisado && Date.now() - desde > 120000) {
        avisado = true;
        console.warn('[main] panel recargado: sigue una operación en Agentes; las ventanas se recrean cuando termine');
      }
      await new Promise(r => setTimeout(r, 500));
    }
    try { verification.close(); } catch (_e) {}
    try { agents.close(); } catch (_e) {}
    console.log('[main] panel recargado: ventanas de Agentes y verificacion recreadas con el codigo actual');
  });
}

app.whenReady().then(async () => {
  // Windows agrupa por AppUserModelID: sin esto la barra de tareas y las notificaciones del
  // sistema usan el ícono genérico de Electron en vez del de la app.
  try { app.setAppUserModelId('com.nodooperativo.app'); } catch (_e) {}
  await proxy.configure();
  panel.create();
  atarVentanasAlPanel();
  const pcCodigoInicial = String(process.env.PC_CODIGO || '').trim();
  const proxyConfigurableAntesDeChunior = pcCodigoInicial &&
    process.env.PANEL_DATA_SECRET &&
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY);
  if (proxyConfigurableAntesDeChunior) {
    const resultado = await officeCredentials.applyProxyForOffice(pcCodigoInicial, { resetOnMissing: false, timeoutMs: 8000 });
    if (!resultado.ok) console.warn('[proxy] no se pudo resolver el proxy inicial de Chunior:', resultado.reason || 'ERROR');
    else if (resultado.enabled) console.log('[proxy] proxy de oficina listo antes de abrir Chunior');
    else console.log('[proxy] sin proxy de oficina configurado; Chunior abrirá con salida directa');
  } else {
    console.warn('[proxy] sin código de oficina o credenciales del servidor; Chunior abrirá con salida directa');
  }
  try {
    await chunior.limpiarDatosLegados();
    console.log('[chunior] datos locales heredados borrados; sesión no persistente');
  }
  catch (e) { console.error('[chunior] no se pudo limpiar el almacenamiento local heredado:', e && e.message || 'ERROR'); }
  chunior.create();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) panel.create();
  });

  // ── Worker de cola (DORMIDO por defecto) ──────────────────────────────────
  // Solo se inicializa si WORKERS_ENABLED=1 en .env. Aislado: cualquier fallo
  // del worker NO afecta al panel ni al flujo on-demand existente.
  try {
    if (String(process.env.WORKERS_ENABLED || "0") === "1") {
      const { initWorkers } = require('./services/worker-bootstrap');
      global.__nodoWorkers = initWorkers({ BrowserWindow, path, env: process.env, pendingAutomation: automationRequests.pending });
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
