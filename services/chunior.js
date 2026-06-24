const { wait } = require("../shared/utils");

class ChuniorService {
  constructor({ BrowserWindow, config }) {
    this.BrowserWindow = BrowserWindow;
    this.config = config;
    this.window = null;
    this.CHUNIOR_URL = config.chuniorUrl || config.chuniorMovimientosUrl || "https://bo.chunior.com/transacciones/";
  }

  create(show = true) {
    this.window = new this.BrowserWindow({
      width: 1200,
      height: 800,
      title: `Chunior · ${this.config.pcCodigo}`,
      show,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    this.window.loadURL(this.CHUNIOR_URL);
    this.window.on("closed", () => { this.window = null; });
    return this.window;
  }

  get() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    return this.create(!!this.config.chuniorWindowVisible);
  }

  async whenReady(win, timeoutMs = 15000) {
    if (!win.webContents.isLoading()) return;
    await new Promise(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      win.webContents.once("did-finish-load", finish);
      setTimeout(finish, timeoutMs);
    });
    await wait(300);
  }

  async exec(script) {
    const win = this.get();
    await this.whenReady(win);
    return win.webContents.executeJavaScript(script, true);
  }

  getUrl() {
    return this.get().webContents.getURL();
  }

  async navigate(url) {
    const win = this.get();
    win.loadURL(url);
    await this.whenReady(win);
    return { ok: true, url: win.webContents.getURL() };
  }

  async reload() {
    const win = this.get();
    win.reload();
    await this.whenReady(win);
    return { ok: true };
  }

  focus() {
    const win = this.get();
    win.show();
    win.focus();
    return { ok: true };
  }
}

module.exports = { ChuniorService };
