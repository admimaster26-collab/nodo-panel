'use strict';
// Puente mínimo del visor de imágenes. Lo único que necesita la ventana es enterarse de qué
// imagen tiene que mostrar; no toca la base, no hace RPC, no sabe nada del panel.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visorImagen', {
  alCargar: (cb) => ipcRenderer.on('visor:cargar', (_e, payload) => { try { cb(payload); } catch (_) {} }),
  cerrar:   () => ipcRenderer.send('visor:cerrar')
});
