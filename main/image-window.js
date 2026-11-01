'use strict';
const path = require('node:path');

// ── VISOR DE IMÁGENES EN VENTANA APARTE · UNA SOLA, SIEMPRE ──────────────────────────────────
//
// Juan, 25/10: "el visualizador, si queda profesional, el problema es que estorba, cualquier cosa
// que se despliegue asi de esa manera estorba en aceptar otras cargas... es mas logico que se
// despliegue en otra ventana a pesar de que puede llenar la memoria al desplegar varias ventanas,
// deberias de dejar un maximo de 1, que la anterior muera antes de redesplegarse otra."
//
// El visor anterior era un cartel a pantalla completa DENTRO del panel
// (`position:fixed;inset:0;z-index:999999`): mientras el operador miraba un comprobante no podía
// tocar nada más — ni tomar una carga, ni contestar un chat. Por eso sale afuera.
//
// Y el tope de una lo garantiza el código, no la buena voluntad: `abrir()` destruye la ventana
// anterior ANTES de crear la nueva. Veinte comprobantes seguidos dejan una sola ventana viva.
//
// La página del visor vive en `main/` a propósito: `package.json` empaqueta `main/**/*` pero de
// renderer sólo `renderer/generated/**/*`, así que puesta en `renderer/` no viajaría en el
// instalador y el visor abriría en blanco en las oficinas.
function createImageWindowService({ BrowserWindow, ipcMain, rootDir, icon }) {
  let win = null;

  // Lo que llega acá viene del chat, o sea de AFUERA: es una URL que escribió el portal o que
  // quedó guardada en una fila. Si alguna vez entrara un "javascript:" o un "file:", abrirlo en
  // una ventana nuestra sería ejecutarlo. Sólo pasan https y data:image.
  function urlSegura(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]*$/i.test(s)) return s;
    try {
      const u = new URL(s);
      if (u.protocol === 'https:') return u.toString();
    } catch (_) {}
    return null;
  }

  function cerrar() {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
    win = null;
    return { ok: true };
  }

  function abrir(rawUrl, titulo) {
    const url = urlSegura(rawUrl);
    if (!url) return { ok: false, message: 'URL_NO_VALIDA' };

    cerrar();   // la anterior muere antes de que nazca la nueva

    const nombre = String(titulo || '').trim();
    win = new BrowserWindow({
      width: 920, height: 840,
      // Mínimo real: por debajo de esto los controles de zoom se pisan.
      minWidth: 420, minHeight: 360,
      // El nombre del jugador va solo en la barra de título: el visor no tiene barra propia, y un
      // prefijo ("Imagen · ") sólo repetía lo que ya es obvio. Sin nombre, "Imagen" a secas.
      title: nombre || 'Imagen',
      icon: icon,
      backgroundColor: '#0b0f16',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload:          path.join(rootDir, 'main', 'visor-imagen-preload.js'),
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          true,
        webviewTag:       false
      }
    });

    win.loadFile(path.join(rootDir, 'main', 'visor-imagen.html'));

    // La url se manda DESPUÉS de cargar, por IPC, y no pegada en la query de la página: así no
    // hay forma de que termine interpretada como parte del documento.
    win.webContents.once('did-finish-load', () => {
      try { win.webContents.send('visor:cargar', { url: url, titulo: nombre }); } catch (_) {}
      try { win.show(); } catch (_) {}
    });

    // El visor muestra una imagen y nada más: no navega ni abre ventanas hijas.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    win.on('closed', () => { win = null; });
    return { ok: true };
  }

  if (ipcMain) {
    ipcMain.handle('visor:abrir', (_e, payload) => {
      const p = payload || {};
      return abrir(p.url, p.titulo);
    });
    ipcMain.on('visor:cerrar', () => { cerrar(); });
  }

  return { abrir, cerrar, get current() { return win; } };
}

module.exports = { createImageWindowService };
