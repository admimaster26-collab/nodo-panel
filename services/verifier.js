const { wait } = require("../shared/utils");

class VerifierService {
  constructor({ BrowserWindow, path, config, pendingVerification }) {
    this.BrowserWindow = BrowserWindow;
    this.path = path;
    this.config = config;
    this.pendingVerification = pendingVerification;
    this.window = null;
    this.SEARCH_URL = config.agentSearchUrl || "https://bo.casinodrex.com/agents/user_search";
  }

  create() {
    this.window = new this.BrowserWindow({
      width: 1200,
      height: 800,
      title: `Verificación · ${this.config.pcCodigo}`,
      show: false,
      webPreferences: {
        preload: this.path.join(__dirname, "..", "agent-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    this.window.loadURL(this.SEARCH_URL);
    this.window.on("closed", () => {
      this.window = null;
      this.pendingVerification.clear();
    });

    return this.window;
  }

  get() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    return this.create();
  }

  async whenReady(win) {
    if (!win.webContents.isLoading()) return;
    await new Promise(resolve => win.webContents.once("did-finish-load", resolve));
  }

  async verifyUser(usuario) {
    const win = this.get();
    const current = win.webContents.getURL();
    if (!current.includes("user_search")) {
      win.loadURL(this.SEARCH_URL);
      await this.whenReady(win);
      await wait(900);
    } else {
      await this.whenReady(win);
    }

    const requestId = `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingVerification.delete(requestId);
        reject(new Error("Timeout en verificación."));
      }, Number(this.config.buscarUsuarioTimeoutMs || 60000));

      this.pendingVerification.set(requestId, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      });

      win.webContents.send("nodo:verify:run", { requestId, method: "buscarUsuario", args: [usuario] });
    });
  }
}

module.exports = { VerifierService };
