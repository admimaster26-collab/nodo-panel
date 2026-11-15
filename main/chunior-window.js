'use strict';
const { whenWindowReady } = require('./window-ready');

const CHUNIOR_PARTITION = 'nodo-chunior';
const CHUNIOR_ORIGINS = ['https://bo.chunior.com', 'https://chunior.com'];
const CHUNIOR_STORAGES = ['appcache', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'];

function createChuniorWindowService({ BrowserWindow, icon, headers, panel, session, env = process.env }) {
  const CHUNIOR_URL = 'https://bo.chunior.com/transacciones/';
  let chuniorWindow = null;
  let _chuLastRecover = 0;
  let _chu403Count = 0;
  async function limpiarCookiesChunior(ses) {
    const cookies = await ses.cookies.get({ domain: 'chunior.com' });
    for (const c of cookies) {
      const dom = (c.domain && c.domain.startsWith('.')) ? c.domain.slice(1) : (c.domain || '');
      if (!/(^|\.)chunior\.com$/i.test(dom)) continue;
      const url = (c.secure ? 'https://' : 'http://') + dom + (c.path || '/');
      await ses.cookies.remove(url, c.name);
    }
  }
  async function limpiarDatosLegadosChunior() {
    const ses = session.defaultSession;
    const tareas = [
      ['cookies', limpiarCookiesChunior(ses)],
      // Electron no ofrece borrado de cache HTTP por origen; se vacía el cache compartido,
      // pero no se tocan cookies ni almacenamiento local de NODO.
      ['cache HTTP compartida', ses.clearCache()]
    ];
    for (const origin of CHUNIOR_ORIGINS) {
      tareas.push([origin, ses.clearStorageData({
        origin,
        storages: CHUNIOR_STORAGES,
        quotas: ['temporary', 'persistent', 'syncable']
      })]);
    }
    const resultados = await Promise.allSettled(tareas.map(t => t[1]));
    const fallas = resultados.flatMap((r, i) => r.status === 'rejected' ? [tareas[i][0]] : []);
    if (fallas.length) throw new Error('No se pudo limpiar el almacenamiento local heredado de Chunior: ' + fallas.join(', '));
  }
  function createChuniorWindow() {
    chuniorWindow = new BrowserWindow({
      width:  1200,
      height: 800,
      title:  'Chunior — Backoffice',
      icon:   icon,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition:            CHUNIOR_PARTITION,
        contextIsolation:     true,
        nodeIntegration:      false,
        sandbox:              true,
        backgroundThrottling: false, // que Chunior siga refrescando aunque no esté enfocado
      }
    });
    // Chunior 404ea las requests con User-Agent de Electron (bot detection en su CDN). Le ponemos el
    // mismo UA de Chrome real que usa la ventana de Agentes → el login carga como en un navegador normal.
    headers.configure(chuniorWindow, { chunior: true });
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
            try { await limpiarCookiesChunior(chuniorWindow.webContents.session); } catch (e) {
              console.warn('[chunior] no se pudieron limpiar las cookies', e && e.code || 'ERROR');
            }
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

  const whenChuniorReady = (win, timeoutMs = 15000) => whenWindowReady(win, timeoutMs);

  function registerIpc(ipcMain) {
  ipcMain.handle('chunior:exec', async (_event, script) => {
    // Gate SOLO por opt-in explícito NODO_PROD=1 (NO por NODE_ENV, que en la app empaquetada
    // puede venir 'production' y bloquearía el flujo Chunior). Por defecto: habilitado.
    if (env.NODO_PROD === '1' && env.CHUNIOR_EXEC_ENABLED !== '1') {
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
  ipcMain.handle('panel:refocus', panel.refocus);


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
    if (opts && opts.hard) { await limpiarCookiesChunior(win.webContents.session); }
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

  }

  return { create: createChuniorWindow, get: getChuniorWindow, limpiarDatosLegados: limpiarDatosLegadosChunior, registerIpc };
}

module.exports = { createChuniorWindowService };
