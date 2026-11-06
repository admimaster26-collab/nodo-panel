'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ESPERA_TRABADA_MS = 60 * 1000;
const TOPE_LOG_BYTES = 512 * 1024;

// Una línea por evento, con fecha. Si el archivo pasa el tope se empieza de nuevo.
function anotarFalla(logPath, texto) {
  const linea = new Date().toISOString() + ' ' + texto + '\n';
  console.warn('[main] ' + texto);
  if (!logPath) return;
  try {
    let tam = 0;
    try { tam = fs.statSync(logPath).size; } catch (_) {}
    if (tam > TOPE_LOG_BYTES) fs.writeFileSync(logPath, linea);
    else fs.appendFileSync(logPath, linea);
  } catch (_) {}
}

function createPanelWindow({ BrowserWindow, rootDir, icon, logPath }) {
  let mainWindow = null;
  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width:    1440,
      height:   900,
      minWidth: 900,
      minHeight:600,
      title: 'NODO · OPERATIVO',
      icon:  icon,
      backgroundColor: '#0e1014', // evita el flash blanco mientras carga / al despertar
      webPreferences: {
        preload:               path.join(rootDir, 'app-preload.js'),
        contextIsolation:      true,
        nodeIntegration:       false,
        webviewTag:            true,
        backgroundThrottling:  false, // que JS siga corriendo aunque la ventana no esté enfocada
      }
    });

    mainWindow.loadFile('NODO · OPERATIVO LITE.htm');
    mainWindow.on('closed', () => { mainWindow = null; });

    // Recovery: si el renderer se muere (pantalla blanca) se recarga. Si sólo se traba, se espera:
    // antes se recargaba al primer "no responde", y un arranque pesado (el login de Chunior carga
    // todo junto) terminaba en recarga, que volvía a cargar todo. Era el "se traba, se reinicia y
    // seguimos" de la PC de Sánchez (6/11). Todo queda en nodo-fallas.log para poder mirarlo.
    let trabadoTimer = null;
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      anotarFalla(logPath, 'se cerro la pantalla: ' + JSON.stringify(details));
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    });
    mainWindow.webContents.on('unresponsive', () => {
      anotarFalla(logPath, 'pantalla trabada');
      if (trabadoTimer) return;
      trabadoTimer = setTimeout(() => {
        trabadoTimer = null;
        anotarFalla(logPath, 'sigue trabada despues de ' + (ESPERA_TRABADA_MS / 1000) + ' s: se recarga');
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
      }, ESPERA_TRABADA_MS);
    });
    mainWindow.webContents.on('responsive', () => {
      if (!trabadoTimer) return;
      clearTimeout(trabadoTimer);
      trabadoTimer = null;
      anotarFalla(logPath, 'se destrabo sola');
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

  function refocus() { try { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.blur(); mainWindow.focus(); } } catch (_) {} return { ok: true }; }

  return { create: createMainWindow, get current() { return mainWindow; }, refocus };
}

module.exports = { createPanelWindow, anotarFalla };
