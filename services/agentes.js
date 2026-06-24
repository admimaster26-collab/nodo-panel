const { wait } = require("../shared/utils");

class AgentesService {
  constructor({ BrowserWindow, path, config, pendingAutomation }) {
    this.BrowserWindow = BrowserWindow;
    this.path = path;
    this.config = config;
    this.pendingAutomation = pendingAutomation;
    this.window = null;
    this.LOGIN_URL = config.agentLoginUrl || "https://bo.casinodrex.com/login";
    this.SEARCH_URL = config.agentSearchUrl || "https://bo.casinodrex.com/agents/user_search";
    this.NEW_USER_URL = config.agentNewUserUrl || new URL("/agents/new_user", this.LOGIN_URL).href;
  }

  create(url = this.LOGIN_URL, show = false) {
    this.window = new this.BrowserWindow({
      width: 1400,
      height: 900,
      title: `Agentes · ${this.config.pcCodigo}`,
      show,
      webPreferences: {
        preload: this.path.join(__dirname, "..", "agent-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false
      }
    });

    this.window.loadURL(url);

    this.window.on("closed", () => {
      this.window = null;
      this.pendingAutomation.clear();
    });

    return this.window;
  }

  get(url = this.LOGIN_URL) {
    if (this.window && !this.window.isDestroyed()) return this.window;
    return this.create(url, false);
  }

  async whenReady(win, timeoutMs = 15000) {
    if (!win.webContents.isLoading()) return;

    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      win.webContents.once("did-finish-load", finish);
      win.webContents.once("did-stop-loading", finish);
      setTimeout(finish, timeoutMs);
    });
  }

  async navigate(url) {
    const win = this.get();
    const current = win.webContents.getURL();

    if (!current || current !== url) {
      win.loadURL(url);
      await this.whenReady(win);
      await wait(700);
    }

    return win;
  }

  showLogin() {
    const win = this.get(this.LOGIN_URL);
    win.loadURL(this.LOGIN_URL);
    win.show();
    win.focus();
    return { ok: true, mensaje: "Login Agentes abierto" };
  }

  showBackoffice(url = this.SEARCH_URL) {
    const win = this.get(url);
    if (url && win.webContents.getURL() !== url) win.loadURL(url);
    win.show();
    win.focus();
    return { ok: true, mensaje: "Backoffice Agentes visible" };
  }

  async runCurrent(method, ...args) {
    const win = this.get();

    await this.whenReady(win);
    await wait(250);

    return this.send(win, method, args);
  }

  async runAt(url, method, ...args) {
    const win = await this.navigate(url);
    return this.send(win, method, args);
  }

  async run(method, ...args) {
    if (method === "crearUsuario") return this.runAt(this.NEW_USER_URL, method, ...args);
    return this.runAt(this.SEARCH_URL, method, ...args);
  }

  send(win, method, args = []) {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const timeoutMs =
      method === "buscarUsuario"
        ? Number(this.config.buscarUsuarioTimeoutMs || 60000)
        : Number(this.config.automationTimeoutMs || 45000);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAutomation.delete(requestId);
        reject(new Error(`Timeout ejecutando ${method}.`));
      }, timeoutMs);

      this.pendingAutomation.set(requestId, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        }
      });

      win.webContents.send("nodo:automation:run", { requestId, method, args });
    });
  }

  async checkSession() {
    try {
      const win = this.get();

      if (win.webContents.isLoading()) {
        await this.whenReady(win);
        await wait(500);
      }

      const result = await this.runCurrent("checkSession");

      if (result && result.loggedIn === false) {
        return {
          ok: false,
          sesionAgentes: "VENCIDA",
          mensaje: "Sesión Agentes no iniciada o vencida.",
          detalle: result
        };
      }

      return {
        ok: true,
        sesionAgentes: "OK",
        mensaje: "Sesión Agentes OK",
        detalle: result
      };
    } catch (error) {
      return {
        ok: false,
        sesionAgentes: "ERROR_CHECK",
        mensaje: error.message || String(error)
      };
    }
  }
}

module.exports = { AgentesService };
