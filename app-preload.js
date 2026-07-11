const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_AUTOMATION_METHODS = new Set([
  'estadoPagina',
  'irABusquedaUsuarios',
  'buscarUsuario',
  'cargarSaldo',
  'retirarSaldo',
  'cambiarClave',
  'crearUsuario',
  'obtenerSaldoAgente',
  'iniciarSesion',
  'recuperarFlujo',
  'abortarOperacion'
]);

contextBridge.exposeInMainWorld('ctrlElectron', {
  openAgentWindow: () => ipcRenderer.invoke('drex:open-agent-window'),
  showAgentWindow: () => ipcRenderer.invoke('drex:show-agent-window'),
  navigateAgent:   (url) => ipcRenderer.invoke('drex:navigate', url),
  drexAutomation: (method, ...args) => {
    if (!ALLOWED_AUTOMATION_METHODS.has(method)) {
      return Promise.reject(new Error(`Método no permitido: ${method}`));
    }
    return ipcRenderer.invoke('drex:automation', { method, args });
  },
  // Auto-login del agente con credenciales blindadas (la clave se resuelve en main, no acá).
  drexAutoLogin: (pcCodigo) => ipcRenderer.invoke('drex:auto-login', { pcCodigo }),
  verifyUser: (usuario) => ipcRenderer.invoke('drex:verify-user', { usuario }),
  // Aplica el proxy de la oficina (la config/clave se resuelve en main, no acá).
  proxyApply: (pcCodigo) => ipcRenderer.invoke('proxy:apply', { pcCodigo }),
  // Recupera el foco de teclado tras un confirm() nativo (bug Electron: la ventana queda sin input).
  refocus: () => ipcRenderer.invoke('panel:refocus')
});

// Acceso a la ventana separada de Chunior (visible, backoffice secundario)
contextBridge.exposeInMainWorld('chunior', {
  exec:     (script) => ipcRenderer.invoke('chunior:exec', script),
  getUrl:   ()       => ipcRenderer.invoke('chunior:get-url'),
  navigate: (url)    => ipcRenderer.invoke('chunior:navigate', url),
  reload:   ()       => ipcRenderer.invoke('chunior:reload'),
  focus:    ()       => ipcRenderer.invoke('chunior:focus'),
});


// ============================================================
// PANEL V15 · panelAPI
// ============================================================
// Puente seguro para RPC Supabase desde main.js.
// No reemplaza ctrlElectron ni chunior.
// ============================================================
contextBridge.exposeInMainWorld('panelAPI', {
  rpc: (fn, params = {}) => ipcRenderer.invoke('panel:rpc', { fn, params }),
  ping: () => ipcRenderer.invoke('panel:ping'),
  getContext: () => ipcRenderer.invoke('panel:get-context')
});

// ============================================================
// Auto-actualización · chequeo/descarga/instalación MANUAL
// ============================================================
contextBridge.exposeInMainWorld('updaterAPI', {
  getVersion: () => ipcRenderer.invoke('updater:version'),
  check:      () => ipcRenderer.invoke('updater:check'),
  download:   () => ipcRenderer.invoke('updater:download'),
  install:    () => ipcRenderer.invoke('updater:install'),
  openReleases: () => ipcRenderer.invoke('updater:open-releases'),
  onStatus:   (cb) => ipcRenderer.on('updater:status', (_event, payload) => cb(payload))
});
