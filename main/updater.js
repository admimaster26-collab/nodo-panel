'use strict';

function registerUpdaterIpc({ ipcMain, app, BrowserWindow, shell, panel, env = process.env, autoUpdater = null, loadUpdater = () => require('electron-updater').autoUpdater }) {
  // Repositorio oficial unificado (sin dicotomía alpha/beta ni canales redundantes)
  const parse = s => { const p = String(s||'').split('/'); return (p[0] && p[1]) ? { owner: p[0], repo: p[1] } : null; };
  const repoOverride = parse(env.UPDATER_REPO || env.UPDATER_BETA || env.UPDATER_ALPHA);
  const DEFAULT_REPO = repoOverride || { owner: 'zhinouno-ui', repo: 'NexoBetaChan' };

  try {
    if (!autoUpdater) autoUpdater = loadUpdater();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
  } catch (_e) { console.warn('[updater] electron-updater no disponible:', _e && _e.message); }

  // El error de electron-updater puede traer adentro el feed entero de releases (con un 504 de GitHub
  // venía la lista completa de versiones con sus notas, decenas de miles de caracteres) y la 2.1.5 lo
  // pintaba en el cartel hasta tapar toda la pantalla (P10C, 8/11). Al panel viaja sólo la primera
  // línea, cortada; el operador ve "Fallo al actualizar" y el detalle queda en la consola.
  function _corto(err) {
    const s = String((err && err.message) || err || '');
    return s.split(/\r?\n/)[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function _sendUpdaterStatus(event, payload) {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) || panel.current;
      if (win) win.webContents.send('updater:status', payload);
    } catch (_e) {}
  }

  ipcMain.handle('updater:version', () => ({ ok: true, version: app.getVersion() }));

  ipcMain.handle('updater:check', async (event, _arg) => {
    if (!autoUpdater) return { ok: false, reason: 'no-updater' };
    if (!app.isPackaged) return { ok: false, reason: 'dev-mode' };
    const repo = DEFAULT_REPO;
    try {
      autoUpdater.removeAllListeners();
      autoUpdater.on('checking-for-update', () => _sendUpdaterStatus(event, { state: 'checking' }));
      autoUpdater.on('update-available',    (info) => _sendUpdaterStatus(event, { state: 'available', version: info && info.version }));
      autoUpdater.on('update-not-available',() => _sendUpdaterStatus(event, { state: 'not-available' }));
      autoUpdater.on('error', (err) => _sendUpdaterStatus(event, { state: 'error', message: _corto(err) }));
      autoUpdater.on('download-progress', (p) => _sendUpdaterStatus(event, { state: 'downloading', percent: Math.round(p && p.percent || 0) }));
      autoUpdater.on('update-downloaded', (info) => _sendUpdaterStatus(event, { state: 'downloaded', version: info && info.version }));
      autoUpdater.setFeedURL({ provider: 'github', owner: repo.owner, repo: repo.repo });
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, version: r && r.updateInfo && r.updateInfo.version, repo: repo.owner + '/' + repo.repo };
    } catch (e) {
      console.warn('[updater] check falló (' + repo.owner + '/' + repo.repo + ') ·', _corto(e));
      return { ok: false, reason: 'error', message: _corto(e) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    if (!autoUpdater) return { ok: false };
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { return { ok: false, message: _corto(e) }; }
  });

  ipcMain.handle('updater:install', () => {
    if (!autoUpdater) return { ok: false };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  // Salida directa a la página oficial de releases
  ipcMain.handle('updater:open-releases', async () => {
    try {
      const repo = DEFAULT_REPO;
      await shell.openExternal('https://github.com/' + repo.owner + '/' + repo.repo + '/releases');
      return { ok: true };
    } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
  });

  return {  };
}

module.exports = { registerUpdaterIpc };
