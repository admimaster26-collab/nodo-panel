const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { registerUpdaterIpc } = require('../main/updater');

// P10C, 8/11: GitHub contestó 504 al buscar versiones y el error de electron-updater traía adentro el
// feed entero de releases (todas las versiones con sus notas). La 2.1.5 lo pintaba en el cartel de
// actualización hasta tapar toda la pantalla, y el operador no lo podía cerrar. Juan: "el chavón tiene
// que ver que diga 'fallo al actualizar', listo".

const GIGANTE = 'Cannot parse releases feed: HttpError: 504 Gateway Time-out\n'
  + '"method: GET url: https://github.com/dueno/repo/releases/latest\n\nData:\n <html><body><h1>504 Gateway Time-out</h1>\n'
  + 'The server didn\'t respond in time.\n</body></html>\n",\nXML:\n<?xml version="1.0"?><feed>'
  + '<entry><title>v1.1.80</title><content>notas de la versión con mucho texto</content></entry>'.repeat(400) + '</feed>';

function ipcFalso() {
  const h = {};
  return { handle: (n, fn) => { h[n] = fn; }, invoke: (n, arg) => h[n]({ sender: {} }, arg) };
}

test('al panel viaja una línea corta, nunca el feed de versiones', async () => {
  const ipcMain = ipcFalso();
  const enviados = [];
  const win = { webContents: { send: (canal, p) => enviados.push(p) } };
  const updater = new EventEmitter();
  Object.assign(updater, {
    setFeedURL() {},
    async checkForUpdates() { const e = new Error(GIGANTE); updater.emit('error', e); throw e; },
    async downloadUpdate() { throw new Error(GIGANTE); }
  });
  const avisos = [];
  const warnOriginal = console.warn; console.warn = (...a) => avisos.push(a.join(' '));
  try {
    registerUpdaterIpc({ ipcMain, autoUpdater: updater, app: { isPackaged: true, getVersion: () => '2' },
      BrowserWindow: { fromWebContents: () => win }, shell: {}, panel: {}, env: {} });
    const r = await ipcMain.invoke('updater:check');
    const d = await ipcMain.invoke('updater:download');
    const error = enviados.find((p) => p.state === 'error');
    for (const msg of [error.message, r.message, d.message, ...avisos]) {
      assert.ok(msg.length <= 260, 'corto: ' + msg.length + ' caracteres');
      assert.doesNotMatch(msg, /<feed|<entry|<html|v1\.1\.80/);
    }
    assert.match(error.message, /504/);
  } finally { console.warn = warnOriginal; }
});

function armarPanel() {
  const status = { innerHTML: '', textContent: '' };
  const nodos = { updaterStatusTxt: status, updaterBox: { style: {} } };
  const consola = [];
  const ctx = {
    document: { getElementById: (id) => nodos[id] || null, addEventListener() {}, querySelectorAll: () => [], readyState: 'loading', hidden: false },
    addEventListener() {}, setTimeout: () => 0, setInterval: () => 0, innerWidth: 1440,
    getComputedStyle: () => ({ display: 'none', visibility: 'hidden' }),
    localStorage: { getItem: () => null, setItem() {} },
    escapeHtml: (v) => String(v == null ? '' : v),
    console: { warn: (...a) => consola.push(a.join(' ')), log() {}, error() {} },
    Math, Number, String, Array, Promise
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'actualizaciones.js'), 'utf8'), ctx);
  return { ctx, status, consola };
}
const soloTexto = (html) => html.replace(/<[^>]*>/g, '');

test('el operador ve "Fallo al actualizar" y nada técnico, ni al pasar el mouse', () => {
  const p = armarPanel();
  p.ctx.nodoUpdaterStatus({ state: 'error', message: GIGANTE });
  assert.equal(soloTexto(p.status.innerHTML), 'Fallo al actualizar');
  assert.doesNotMatch(p.status.innerHTML, /title=|504|github|Error/i);
  assert.ok(p.consola.every((l) => l.length <= 220), 'a la consola va corto');
});

test('el botón 🔄 y la descarga fallidos dicen lo mismo', async () => {
  const p = armarPanel();
  p.ctx.updaterAPI = { check: async () => ({ ok: false, reason: 'error', message: GIGANTE }), download: async () => ({ ok: false, message: 'x' }) };
  await p.ctx.nodoBuscarActualizacion();
  assert.equal(soloTexto(p.status.innerHTML), 'Fallo al actualizar');
  p.status.innerHTML = '';
  await p.ctx.nodoDescargarActualizacion();
  assert.equal(soloTexto(p.status.innerHTML), 'Fallo al actualizar');
  p.ctx.updaterAPI.download = async () => { throw new Error(GIGANTE); };
  p.status.innerHTML = '';
  await p.ctx.nodoDescargarActualizacion();
  assert.equal(soloTexto(p.status.innerHTML), 'Fallo al actualizar');
});

test('el cartel tiene tope: una línea, nunca más ancho que la pantalla', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'panel.template.html'), 'utf8');
  const caja = html.match(/<div id="updaterBox"[^>]*>/)[0];
  const texto = html.match(/<span id="updaterStatusTxt"[^>]*>/)[0];
  assert.match(caja, /max-width:calc\(100vw - 24px\)/); assert.match(caja, /overflow:hidden/);
  assert.match(texto, /max-width:220px/); assert.match(texto, /overflow:hidden/);
  assert.match(texto, /white-space:nowrap/); assert.match(texto, /text-overflow:ellipsis/);
});
