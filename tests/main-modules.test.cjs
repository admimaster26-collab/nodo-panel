const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { configureEnvironment } = require('../main/config');
const { createAgentBackends } = require('../main/agent-backends');
const { createProxyService } = require('../main/proxy');
const { createSessionHeaders } = require('../main/session-headers');
const { createRequestRegistry } = require('../main/request-registry');
const { whenWindowReady, waitForWindowLoad } = require('../main/window-ready');
const { createAutomationService } = require('../main/automation');
const { createAgentWindowService } = require('../main/agent-window');
const { createVerificationService } = require('../main/verification');
const { createChuniorWindowService } = require('../main/chunior-window');
const { registerAgentIpc } = require('../main/agent-ipc');
const { registerPanelIpc } = require('../main/panel-rpc');
const { registerOfficeCredentialsIpc } = require('../main/office-credentials');
const { registerUpdaterIpc } = require('../main/updater');
const { registerNexoIpc } = require('../main/nexo-files');
 const { CSS_SIN_CARTELES, taparCarteles } = require('../main/carteles');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodo-main-test-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('nodo-main-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function ipcFake() {
  const ipc = new EventEmitter();
  ipc.handlers = new Map();
  ipc.handle = (channel, fn) => {
    assert.ok(!ipc.handlers.has(channel), 'duplicate IPC: ' + channel);
    ipc.handlers.set(channel, fn);
  };
  ipc.invoke = (channel, ...args) => ipc.handlers.get(channel)({}, ...args);
  return ipc;
}

function timersFake() {
  let id = 0;
  const callbacks = new Map();
  return {
    callbacks,
    setTimer(fn) { callbacks.set(++id, fn); return id; },
    clearTimer(id) { callbacks.delete(id); },
    expire() { for (const fn of [...callbacks.values()]) fn(); }
  };
}

function windowFakes() {
  const windows = [];
  const makeSession = () => ({
    webRequest: { onBeforeSendHeaders() {} },
    cookies: { async get() { return []; }, async remove() {} },
    async clearCache() {},
    async clearStorageData() {}
  });
  const defaultSession = makeSession();
  const partitionSessions = new Map();
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.loaded = [];
      this.dead = false;
      const partition = options && options.webPreferences && options.webPreferences.partition;
      let windowSession = defaultSession;
      if (partition) {
        if (!partitionSessions.has(partition)) partitionSessions.set(partition, makeSession());
        windowSession = partitionSessions.get(partition);
      }
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        sent: [], session: windowSession, isLoading: () => false,
        getURL: () => this.loaded.at(-1) || '', getTitle: () => '',
        getUserAgent: () => 'Chrome/128.0.0.0 Electron/32', setUserAgent() {},
        setVisualZoomLevelLimits() {}, reload() {},
        css: [], insertCSS: (hoja) => { this.webContents.css.push(hoja); return Promise.resolve('k'); },
        executeJavaScript: async source => source.includes("return 'ready'") ? 'ready' : false,
        send: (channel, payload) => this.webContents.sent.push({ channel, payload })
      });
      windows.push(this);
    }
    loadURL(url) { this.loaded.push(url); return Promise.resolve(); }
    loadFile(file) { this.file = file; return Promise.resolve(); }
    isDestroyed() { return this.dead; }
    destroy() { this.dead = true; this.webContents.emit('destroyed'); this.emit('closed'); }
    show() { this.shown = true; }
    focus() {}
    blur() {}
    reload() {}
    static getAllWindows() { return windows.filter(w => !w.dead); }
    static fromWebContents(contents) { return windows.find(w => w.webContents === contents); }
  }
  return { Window, windows, defaultSession, partitionSessions };
}

test('configuration preserves OS overrides and loads UTF-16 office file before application defaults', t => {
  const dir = tempDir(t);
  const userDir = path.join(dir, 'user');
  const appDir = path.join(dir, 'app');
  fs.mkdirSync(userDir); fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(userDir, '.env.p4'), Buffer.from('\ufeffPC_CODIGO=P4\nUPDATER_BETA="owner/repo"\nPANEL_DATA_SECRET=example\n', 'utf16le'));
  fs.writeFileSync(path.join(appDir, '.env'), 'PC_CODIGO=wrong');
  const env = { NODO_ENV: 'P4', PC_CODIGO: 'OS' };
  configureEnvironment({ app: { getPath: () => userDir }, rootDir: appDir, execPath: path.join(appDir, 'app.exe'), env });
  assert.equal(env.PC_CODIGO, 'OS');
  assert.equal(env.UPDATER_BETA, 'owner/repo');
  assert.equal(env.PANEL_DATA_SECRET, 'example');
  assert.ok(env.SUPABASE_URL.startsWith('https://'));
});

test('configuration loads per-office secrets from LocalAppData NODO outside the workspace', t => {
  const dir = tempDir(t);
  const localDir = path.join(dir, 'local');
  const credentialsDir = path.join(localDir, 'NODO');
  const userDir = path.join(dir, 'user');
  const appDir = path.join(dir, 'app');
  fs.mkdirSync(credentialsDir, { recursive: true });
  fs.mkdirSync(userDir); fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(credentialsDir, '.env.p4'), 'PC_CODIGO=P4\nPANEL_DATA_SECRET=secret\n');
  const env = { NODO_ENV: 'P4', LOCALAPPDATA: localDir };
  configureEnvironment({ app: { getPath: () => userDir }, rootDir: appDir, execPath: path.join(appDir, 'app.exe'), env });
  assert.equal(env.PC_CODIGO, 'P4');
  assert.equal(env.PANEL_DATA_SECRET, 'secret');
});

test('backend selection persists across instances and resolves preloads from app root', t => {
  const dir = tempDir(t);
  const options = { app: { getPath: () => dir }, rootDir: dir, env: {} };
  const backends = createAgentBackends(options);
  assert.equal(backends.current.spa, false);
  assert.equal(backends.select('__proto__').ok, false);
  assert.equal(backends.select('bet300').ok, true);
  assert.equal(backends.current.preload, path.join(dir, 'agent-preload-bet300.js'));
  assert.equal(createAgentBackends(options).info().backend, 'bet300');
  assert.equal(backends.select('bet300').sinCambio, true);
});

test('startup and runtime proxy only change the dedicated partition, including direct reset', async () => {
  const app = new EventEmitter();
  const calls = [];
  const sessions = new Map();
  const makeSession = partition => ({
    async setProxy(config) { calls.push([partition, config]); },
    async closeAllConnections() { calls.push([partition, 'close']); }
  });
  const proxy = createProxyService({
    app, env: { PROXY_ENABLED: '1', PROXY_HOST: 'office', PROXY_PORT: '8000' },
    session: {
      fromPartition(partition) {
        assert.ok(['persist:nodo-agentes', 'nodo-chunior'].includes(partition));
        if (!sessions.has(partition)) sessions.set(partition, makeSession(partition));
        return sessions.get(partition);
      },
      get defaultSession() { assert.fail('default session must remain untouched'); }
    }
  });
  await proxy.configure();
  await proxy.apply(null);
  assert.deepEqual(calls, [
    ['persist:nodo-agentes', { mode: 'fixed_servers', proxyRules: 'http=office:8000;https=office:8000', proxyBypassRules: '<local>' }],
    ['persist:nodo-agentes', 'close'],
    ['persist:nodo-agentes', { mode: 'direct' }], ['nodo-chunior', { mode: 'direct' }],
    ['persist:nodo-agentes', 'close'], ['nodo-chunior', 'close']
  ]);
  await proxy.apply(null);
  assert.equal(calls.length, 6, 'already direct does not close healthy connections');
  await proxy.apply({ enabled: true, host: 'runtime', port: 1080, protocol: 'socks5', username: 'u', password: 'p' });
  assert.deepEqual(calls.slice(6), [
    ['persist:nodo-agentes', { mode: 'fixed_servers', proxyRules: 'socks=runtime:1080', proxyBypassRules: '<local>' }],
    ['nodo-chunior', { mode: 'fixed_servers', proxyRules: 'socks=runtime:1080', proxyBypassRules: '<local>' }],
    ['persist:nodo-agentes', 'close'], ['nodo-chunior', 'close']
  ]);
  let prevented = 0;
  let auth;
  const event = { preventDefault() { prevented++; } };
  app.emit('login', event, {}, {}, { isProxy: false }, () => assert.fail('website login must stay untouched'));
  app.emit('login', event, {}, {}, { isProxy: true }, (...args) => { auth = args; });
  assert.equal(prevented, 1);
  assert.deepEqual(auth, ['u', 'p']);
});

test('proxy strips protocol scheme and path from host on startup and runtime config', async () => {
  const app = new EventEmitter();
  const calls = [];
  const sessions = new Map();
  const makeSession = partition => ({
    async setProxy(config) { calls.push([partition, config]); },
    async closeAllConnections() {}
  });
  const proxy = createProxyService({
    app,
    env: { PROXY_ENABLED: '1', PROXY_HOST: 'https://office.proxy.local/', PROXY_PORT: '8000' },
    session: {
      fromPartition(partition) {
        if (!sessions.has(partition)) sessions.set(partition, makeSession(partition));
        return sessions.get(partition);
      }
    }
  });
  await proxy.configure();
  await proxy.apply({ enabled: true, host: 'https://ar86.proxy.nordvpn.com/', port: '89', protocol: 'http' });
  const bad = await proxy.apply({ enabled: true, host: 'https://', port: '89', protocol: 'http' });
  assert.deepEqual(calls, [
    ['persist:nodo-agentes', { mode: 'fixed_servers', proxyRules: 'http=office.proxy.local:8000;https=office.proxy.local:8000', proxyBypassRules: '<local>' }],
    ['persist:nodo-agentes', { mode: 'fixed_servers', proxyRules: 'http=ar86.proxy.nordvpn.com:89;https=ar86.proxy.nordvpn.com:89', proxyBypassRules: '<local>' }],
    ['nodo-chunior', { mode: 'fixed_servers', proxyRules: 'http=ar86.proxy.nordvpn.com:89;https=ar86.proxy.nordvpn.com:89', proxyBypassRules: '<local>' }],
    ['persist:nodo-agentes', { mode: 'direct' }],
    ['nodo-chunior', { mode: 'direct' }]
  ]);
  assert.deepEqual(bad, { ok: true, enabled: false });
});

test('partition failure never falls back to proxying the default session', async () => {
  let touched = false;
  const proxy = createProxyService({ app: new EventEmitter(), env: {}, session: {
    fromPartition() { throw new Error('partition unavailable'); },
    defaultSession: { async setProxy() { touched = true; } }
  } });
  const result = await proxy.apply({ enabled: true, host: 'office', port: 80 });
  assert.equal(result.ok, false);
  assert.equal(touched, false);
});

test('isolated Chunior and BET300 hooks do not affect unrelated requests', () => {
  const defaultHooks = [], agentHooks = [], chuniorHooks = [];
  const defaultSession = { webRequest: { onBeforeSendHeaders(fn) { defaultHooks.push(fn); } } };
  const agentSession = { webRequest: { onBeforeSendHeaders(fn) { agentHooks.push(fn); } } };
  const chuniorSession = { webRequest: { onBeforeSendHeaders(fn) { chuniorHooks.push(fn); } } };
  const headers = createSessionHeaders({ session: { defaultSession }, backends: { current: { spa: true } } });
  const win = ses => ({ webContents: { session: ses, getUserAgent: () => 'Chrome/128.0 Electron/32', setUserAgent() {} } });
  headers.configure(win(chuniorSession), { chunior: true });
  headers.configure(win(agentSession));
  headers.configure(win(chuniorSession), { chunior: true });
  assert.equal(defaultHooks.length, 0);
  assert.equal(agentHooks.length, 1);
  assert.equal(chuniorHooks.length, 1);
  const request = (hook, url) => {
    let output;
    hook({ url, requestHeaders: { Existing: 'kept' } }, result => { output = result.requestHeaders; });
    return output;
  };
  assert.ok(request(chuniorHooks[0], 'https://bo.chunior.com/transacciones/')['sec-ch-ua']);
  assert.ok(request(agentHooks[0], 'https://agentesbet.io/')['sec-ch-ua']);
  for (const hook of [chuniorHooks[0], agentHooks[0]]) {
    assert.deepEqual(request(hook, 'https://example.supabase.co/rest/v1'), { Existing: 'kept' });
    assert.deepEqual(request(hook, 'https://example.com/chunior.com/agentesbet.io'), { Existing: 'kept' });
  }
});

test('window readiness releases event listeners and deadline on load, timeout and destruction', async () => {
  for (const cause of ['load', 'timeout', 'destroy']) {
    const timers = timersFake();
    const webContents = new EventEmitter();
    webContents.isLoading = () => true;
    const waiting = whenWindowReady({ webContents }, 10, timers);
    if (cause === 'load') webContents.emit('did-finish-load');
    if (cause === 'destroy') webContents.emit('destroyed');
    if (cause === 'timeout') timers.expire();
    await waiting;
    assert.equal(webContents.listenerCount('did-finish-load'), 0);
    assert.equal(webContents.listenerCount('destroyed'), 0);
    assert.equal(timers.callbacks.size, 0);
  }
});

test('navigation load failure releases readiness deadline without an unhandled rejection', async () => {
  const timers = timersFake();
  const webContents = new EventEmitter();
  await waitForWindowLoad({ webContents }, 10, () => Promise.reject(new Error('offline')), timers);
  assert.equal(timers.callbacks.size, 0);
  assert.equal(webContents.listenerCount('did-finish-load'), 0);
});

test('request registry resolves once and clears timers on result, timeout and send failure', async () => {
  const timers = timersFake();
  const requests = createRequestRegistry({ ...timers, makeId: () => 'request' });
  let sends = 0;
  const contents = { send() { sends++; } };
  const success = requests.run(contents, 'run', { method: 'cargarSaldo' }, 10, 'timeout');
  requests.settle({ requestId: 'request', result: { ok: true } });
  requests.settle({ requestId: 'request', ok: false });
  assert.deepEqual(await success, { ok: true });
  assert.equal(timers.callbacks.size, 0);
  const timeout = requests.run(contents, 'run', {}, 10, 'expired');
  const rejected = assert.rejects(timeout, /expired/);
  timers.expire();
  await rejected;
  assert.equal(sends, 2, 'timeout must never resend');
  await assert.rejects(requests.run({ send() { throw new Error('closed'); } }, 'run', {}, 10, 'timeout'), /closed/);
  assert.equal(requests.pending.size, 0);
  assert.equal(timers.callbacks.size, 0);
});

test('money automation sends once, never navigates, and rejects promptly when window closes', async () => {
  for (const method of ['cargarSaldo', 'retirarSaldo']) {
    const timers = timersFake();
    const requests = createRequestRegistry(timers);
    let sends = 0;
    const service = createAutomationService({
      agents: { get: () => ({ webContents: { send() { sends++; } } }), ready: async () => {}, navigate() { assert.fail('money movement must not navigate'); } },
      backends: { current: { url: 'https://agents.test/' } }, requests, env: {}
    });
    const operation = service.send(method, 'user', 100);
    const rejected = assert.rejects(operation, /closed/);
    await Promise.resolve();
    assert.equal(sends, 1);
    requests.rejectAll(new Error('closed'));
    await rejected;
    assert.equal(timers.callbacks.size, 0);
    assert.equal(service.timeoutFor(method), 45000);
  }
});

test('loaded agent page is reused for searches without refresh; unexpected navigation rejects pending request', async () => {
  const { Window, windows } = windowFakes();
  const requests = createRequestRegistry(timersFake());
  const backends = { current: { url: 'https://agents.test/search', appSel: 'input', spa: false, preload: 'agent.js' } };
  const agents = createAgentWindowService({ BrowserWindow: Window, icon: 'icon', partition: 'persist:nodo-agentes', backends, headers: { configure() {} }, requests });
  await agents.navigate();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].loaded.length, 1, 'existing operational page should not reload');
  const operation = requests.run(windows[0].webContents, 'run', {}, 10, 'timeout');
  const rejected = assert.rejects(operation, /recargó durante la operación/);
  windows[0].webContents.emit('did-navigate', {}, 'https://agents.test/login');
  await rejected;
  assert.equal(requests.pending.size, 0);
});

test('agent window follows the selected preload and waits for pending operations before replacement', async () => {
  const { Window, windows } = windowFakes();
  const requests = createRequestRegistry(timersFake());
  const backends = {
    current: { url: 'https://agentesbet.io/', appSel: 'input', spa: true, preload: 'agent-preload-bet300.js' }
  };
  const agents = createAgentWindowService({
    BrowserWindow: Window, icon: 'icon', partition: 'persist:nodo-agentes', backends,
    headers: { configure() {} }, requests
  });
  const bet300 = agents.get();

  backends.current = {
    url: 'https://www.adminonline.me/agents/control', appSel: 'input', spa: true,
    spaPathAware: true, preload: 'agent-preload-adminonline.js'
  };

  const operation = requests.run(bet300.webContents, 'run', {}, 10, 'timeout');
  const rejected = assert.rejects(operation, /cleanup/);
  assert.throws(() => agents.get(), /operación en curso/,
    'no debe cerrar la ventana equivocada mientras hay una automatización pendiente');
  assert.equal(bet300.isDestroyed(), false);
  requests.rejectAll(new Error('cleanup'));
  await rejected;

  const adminonline = agents.get();
  assert.equal(windows.length, 2);
  assert.equal(bet300.isDestroyed(), true);
  assert.equal(adminonline.options.webPreferences.preload, 'agent-preload-adminonline.js');
  assert.deepEqual(adminonline.loaded, ['https://www.adminonline.me/agents/control']);
});

test('AdminOnline navigation distinguishes SPA routes and reuses the requested route', async () => {
  const { Window, windows } = windowFakes();
  const requests = createRequestRegistry(timersFake());
  const controlUrl = 'https://www.adminonline.me/agents/control';
  const whatsappUrl = 'https://www.adminonline.me/config/socials';
  const backends = { current: { url: controlUrl, appSel: 'input', spa: true, spaPathAware: true, preload: 'adminonline.js' } };
  const agents = createAgentWindowService({ BrowserWindow: Window, icon: 'icon', partition: 'persist:nodo-agentes', backends, headers: { configure() {} }, requests });

  await agents.navigate(controlUrl);
  assert.deepEqual(windows[0].loaded, [controlUrl]);
  await agents.navigate(whatsappUrl);
  assert.deepEqual(windows[0].loaded, [controlUrl, whatsappUrl], 'ruta de Personalizar pagina dentro del mismo dominio debe abrir el formulario');
  await agents.navigate(whatsappUrl);
  assert.equal(windows[0].loaded.length, 2, 'la misma ruta debe reutilizar la página ya cargada');
});

test('backend switch closes agent and verification windows and keeps the same proxy partition', async t => {
  const dir = tempDir(t);
  const { Window, windows } = windowFakes();
  const backends = createAgentBackends({ app: { getPath: () => dir }, rootDir: dir, env: {} });
  const automationRequests = createRequestRegistry(timersFake());
  const verificationRequests = createRequestRegistry(timersFake());
  const common = { BrowserWindow: Window, icon: 'icon', partition: 'persist:nodo-agentes', backends };
  const agents = createAgentWindowService({ ...common, headers: { configure() {} }, requests: automationRequests });
  const verification = createVerificationService({ ...common, requests: verificationRequests });
  const ipcMain = ipcFake();
  registerAgentIpc({ ipcMain, agents, automation: {}, verification, backends, automationRequests, verificationRequests });
  const agent = agents.get();
  const operation = automationRequests.run(agent.webContents, 'run', {}, 10, 'timeout');
  const rejectedOperation = assert.rejects(operation, /se cerró/);
  const check = verification.send('user');
  const rejectedCheck = assert.rejects(check, /se cerró/);
  await Promise.resolve();
  const result = ipcMain.invoke('agent:set-backend', { backend: 'bet300' });
  assert.equal(result.ok, true);
  await Promise.all([rejectedOperation, rejectedCheck]);
  assert.equal(windows.length, 3);
  assert.equal(windows[0].dead, true);
  assert.equal(windows[1].dead, true);
  assert.ok(windows[2].options.webPreferences.preload.endsWith('agent-preload-bet300.js'));
  assert.equal(windows[2].shown, true);
  for (const win of windows) assert.equal(win.options.webPreferences.partition, 'persist:nodo-agentes');
});

test('panel RPC allowlist rejects unexpected procedures before network; write RPC has no retry', async () => {
  const ipcMain = ipcFake();
  const calls = [];
  registerPanelIpc({ ipcMain, env: { SUPABASE_URL: 'https://db.test/', SUPABASE_ANON_KEY: 'public' }, fetch: async (...args) => { calls.push(args); return { ok: false, status: 409, text: async () => '{"message":"conflict"}' }; } });
  assert.match((await ipcMain.invoke('panel:rpc', 'unlisted')).error.message, /RPC_NO_PERMITIDA/);
  assert.equal(calls.length, 0);
  const result = await ipcMain.invoke('panel:rpc', { procedure: 'panel_nodo_send_chat_message', args: { text: 'hello' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://db.test/rest/v1/rpc/panel_nodo_send_chat_message');
  assert.equal(calls[0][1].body, '{"text":"hello"}');
  assert.equal(result.error.status, 409);
  assert.equal(result.error.message, 'conflict');
  assert.ok(!Object.hasOwn(await ipcMain.invoke('panel:get-context'), 'supabase_key'));
});

test('missing office secret performs no network or login and clears runtime proxy', async () => {
  const ipcMain = ipcFake();
  const applied = [];
  registerOfficeCredentialsIpc({ ipcMain, env: {}, fetch() { assert.fail('missing secret'); }, automation: { send() { assert.fail('missing secret'); } }, proxy: { async apply(config) { applied.push(config); } } });
  assert.equal((await ipcMain.invoke('drex:auto-login', { pcCodigo: 'P1' })).reason, 'missing-secret');
  assert.equal((await ipcMain.invoke('proxy:apply', { pcCodigo: 'P1' })).reason, 'missing-secret');
  assert.deepEqual(applied, [null]);
});

test('office proxy lookup applies the server configuration without exposing credentials', async () => {
  const ipcMain = ipcFake();
  let request;
  const applied = [];
  const credentials = registerOfficeCredentialsIpc({
    ipcMain,
    env: { SUPABASE_URL: 'https://db.test/', SUPABASE_ANON_KEY: 'public', PANEL_DATA_SECRET: 'secret' },
    fetch: async (...args) => {
      request = args;
      return { json: async () => ({ ok: true, enabled: true, protocol: 'http', host: 'office-proxy', port: 8080, username: 'user', password: 'pass' }) };
    },
    automation: {},
    proxy: { async apply(config) { applied.push(config); return { ok: true, enabled: true }; } }
  });
  assert.deepEqual(await credentials.applyProxyForOffice('P4', { timeoutMs: 1000 }), { ok: true, enabled: true });
  assert.equal(request[0], 'https://db.test/rest/v1/rpc/panel_get_proxy');
  assert.ok(request[1].signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(request[1].body), { p_secret: 'secret', p_pc_codigo: 'P4' });
  assert.deepEqual(applied, [{ enabled: true, protocol: 'http', host: 'office-proxy', port: 8080, username: 'user', password: 'pass', bypass: undefined }]);
});

test('office credentials are passed directly to automation and are absent from renderer response', async () => {
  const ipcMain = ipcFake();
  let sent;
  registerOfficeCredentialsIpc({
    ipcMain, env: { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'public', PANEL_DATA_SECRET: 'secret', PC_CODIGO: 'P1' }, proxy: {},
    fetch: async (_url, options) => { assert.equal(JSON.parse(options.body).p_secret, 'secret'); return { json: async () => ({ ok: true, usuario: 'agent', clave: 'password' }) }; },
    automation: { async send(...args) { sent = args; return { ok: true }; } }
  });
  assert.deepEqual(await ipcMain.invoke('drex:auto-login', {}), { ok: true });
  assert.deepEqual(sent, ['iniciarSesion', 'agent', 'password']);
});

test('Chunior clears legacy site data, then uses a non-persistent isolated session', async () => {
  const { Window, defaultSession } = windowFakes();
  const removed = [];
  const cleared = [];
  defaultSession.cookies.get = async () => [
    { domain: '.chunior.com', name: 'session', secure: true, path: '/' },
    { domain: 'notchunior.com', name: 'foreign', secure: true },
    { domain: 'db.supabase.co', name: 'auth', secure: true }
  ];
  defaultSession.cookies.remove = async (...args) => { removed.push(args); };
  defaultSession.clearCache = async () => { cleared.push('cache'); };
  defaultSession.clearStorageData = async options => { cleared.push(options); };
  const chunior = createChuniorWindowService({
    BrowserWindow: Window, icon: 'icon', headers: { configure() {} }, panel: { refocus() {} },
    session: { defaultSession }, env: {}
  });

  await chunior.limpiarDatosLegados();
  const win = chunior.create();
  assert.equal(win.options.webPreferences.partition, 'nodo-chunior');
  assert.equal(win.loaded[0], 'https://bo.chunior.com/transacciones/');
  assert.deepEqual(removed, [['https://chunior.com/', 'session']]);
  assert.equal(cleared[0], 'cache');
  assert.deepEqual(cleared.slice(1).map(x => x.origin), ['https://bo.chunior.com', 'https://chunior.com']);
  assert.ok(cleared.slice(1).every(x => x.storages.includes('localstorage') && x.storages.includes('cachestorage')));
});

test('Chunior hard reset only clears its own cookies and execution gate preserves production setting', async () => {
  const { Window, defaultSession, partitionSessions } = windowFakes();
  const removed = [];
  const ipcMain = ipcFake();
  const chunior = createChuniorWindowService({
    BrowserWindow: Window, icon: 'icon', headers: { configure() {} }, panel: { refocus() {} },
    session: { defaultSession }, env: { NODO_PROD: '1' }
  });
  chunior.registerIpc(ipcMain);
  chunior.create();
  const chuniorSession = partitionSessions.get('nodo-chunior');
  chuniorSession.cookies.get = async () => [
    { domain: '.chunior.com', name: 'session', secure: true, path: '/' },
    { domain: 'notchunior.com', name: 'foreign', secure: true },
    { domain: 'db.supabase.co', name: 'auth', secure: true }
  ];
  chuniorSession.cookies.remove = async (...args) => { removed.push(args); };
  assert.equal((await ipcMain.invoke('chunior:exec', 'anything')).reason, 'chunior_exec_disabled');
  assert.equal((await ipcMain.invoke('chunior:reset', { hard: true })).ok, true);
  assert.deepEqual(removed, [['https://chunior.com/', 'session']]);
});

test('updater is entirely manual and loads channel repository overrides', async () => {
  const ipcMain = ipcFake();
  const updater = new EventEmitter();
  let checks = 0, downloads = 0, installs = 0, feed;
  Object.assign(updater, { setFeedURL(value) { feed = value; }, async checkForUpdates() { checks++; return { updateInfo: { version: '2' } }; }, async downloadUpdate() { downloads++; }, quitAndInstall() { installs++; } });
  registerUpdaterIpc({ ipcMain, autoUpdater: updater, app: { isPackaged: true, getVersion: () => '1' }, BrowserWindow: { fromWebContents() {} }, shell: {}, panel: {}, env: { UPDATER_BETA: 'office/test-release' } });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(checks + downloads + installs, 0);
  assert.equal((await ipcMain.invoke('updater:check', { channel: 'beta' })).repo, 'office/test-release');
  assert.deepEqual(feed, { provider: 'github', owner: 'office', repo: 'test-release' });
  assert.equal(checks, 1);
  assert.equal(downloads + installs, 0);
  await ipcMain.invoke('updater:download');
  ipcMain.invoke('updater:install');
  assert.equal(downloads, 1);
  assert.equal(installs, 1);
});

test('Nexo atomic export leaves inbound orders unchanged and never creates an absent installation', async t => {
  const dir = tempDir(t);
  const ipcMain = ipcFake();
  registerNexoIpc({ ipcMain, app: { getPath: () => dir } });
  assert.equal((await ipcMain.invoke('nexo:write', { content: '{}' })).instalado, false);
  assert.equal(fs.existsSync(path.join(dir, 'nexo-desktop')), false);
  const shared = path.join(dir, 'nexo-desktop', 'shared');
  fs.mkdirSync(shared, { recursive: true });
  const inbound = '{"pedidos":[{"id":7}],"pc_codigo":"P1"}';
  fs.writeFileSync(path.join(shared, 'nexo-pedidos.json'), inbound);
  assert.deepEqual((await ipcMain.invoke('nexo:pedidos')).pedidos, [{ id: 7 }]);
  assert.equal((await ipcMain.invoke('nexo:write', { content: '{"ok":true}' })).ok, true);
  assert.equal(fs.readFileSync(path.join(shared, 'nodo-datos.json'), 'utf8'), '{"ok":true}');
  assert.equal(fs.readFileSync(path.join(shared, 'nexo-pedidos.json'), 'utf8'), inbound);
  assert.equal(fs.existsSync(path.join(shared, 'nodo-datos.json.tmp-nodo')), false);
});

test('main composition boots with Electron fakes and registers the complete preload IPC contract', async t => {
  const dir = tempDir(t);
  const rootDir = path.resolve(__dirname, '..');
  const { Window, windows, defaultSession } = windowFakes();
  const ipcMain = ipcFake();
  const app = new EventEmitter();
  let ready;
  Object.assign(app, { getPath: () => dir, whenReady: () => ({ then(fn) { ready = fn; } }), setAppUserModelId() {}, quit() {}, getVersion: () => 'test', isPackaged: false });
  const electron = { app, ipcMain, BrowserWindow: Window, session: { defaultSession }, shell: {} };
  const requireForMain = id => {
    if (id === 'electron') return electron;
    if (id === 'node:path') return path;
    const exported = require(path.join(rootDir, id));
    return Object.fromEntries(Object.entries(exported).map(([name, value]) => [name, typeof value === 'function' ? options => value({
      ...options, env: {}, ...(id === './main/config' ? { rootDir: dir, execPath: path.join(dir, 'app.exe') } : {}),
      ...(id === './main/updater' ? { loadUpdater() { throw new Error('test updater absent'); } } : {})
    }) : value]));
  };
  vm.runInNewContext(fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8'), {
    require: requireForMain, __dirname: rootDir, process: { env: {}, platform: process.platform }, console, global: {}
  }, { filename: 'main.js' });
  await ready();
  assert.equal(windows.length, 2);
  assert.equal(windows[0].file, 'NODO · OPERATIVO LITE.htm');
  assert.equal(windows[1].loaded[0], 'https://bo.chunior.com/transacciones/');
  const preload = fs.readFileSync(path.join(rootDir, 'app-preload.js'), 'utf8');
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)/g)].map(match => match[1]);
  assert.ok(channels.length > 20);
  for (const channel of channels) assert.ok(ipcMain.handlers.has(channel), 'missing handler: ' + channel);
  assert.equal(ipcMain.listenerCount('drex:automation:result'), 1);
  assert.equal(ipcMain.listenerCount('drex:verify:result'), 1);
});

// La consola de la ventana de Agentes no salía nunca de la PC, y ahí estaba la prueba del loop del
// /logout: el error salía de logout:1 y la misma url se repetía en cada vuelta. Para verlo había
// que pedirle al operador una foto del devtools. Se captura desde main a propósito: el preload
// corre aislado y no ve la consola de la página.
test('the agent window console is captured so a failure can carry what actually happened', async () => {
  const { Window, windows } = windowFakes();
  const requests = createRequestRegistry(timersFake());
  const backends = { current: { url: 'https://agents.test/search', appSel: 'input', spa: false,
                                preload: 'agent.js', label: 'drex' } };
  const agents = createAgentWindowService({ BrowserWindow: Window, icon: 'icon',
    partition: 'persist:nodo-agentes', backends, headers: { configure() {} }, requests });
  const win = agents.get();
  const wc = win.webContents;

  wc.emit('console-message', {}, 0, 'ruido de depuración', 12, 'verbose.js');
  wc.emit('console-message', {}, 1, 'un info cualquiera', 13, 'info.js');
  wc.emit('console-message', {}, 2, '[agent] sesión de Agentes caída', 523, 'VM179');
  wc.emit('console-message', {}, 3, 'blocked by CORS policy', 1, 'logout:1');
  wc.emit('did-fail-load', {}, -10, 'ERR_FAILED', 'https://wallet.casinoenvivo.club/api/admin/loadActiveStyles');

  const d = agents.consola();
  const msgs = d.consola.map(c => c.msg);
  assert.ok(!msgs.some(m => /ruido de depuración|un info cualquiera/.test(m)),
    'lo verboso se descarta: si no, la consola útil queda enterrada · ' + JSON.stringify(msgs));
  assert.ok(msgs.some(m => /CORS policy/.test(m)), 'el error que destrabó el diagnóstico tiene que estar');
  assert.ok(d.consola.some(c => /logout:1/.test(c.fuente)), 'con su fuente: de ahí salió que la página era /logout');
  assert.ok(msgs.some(m => /no cargó \(-10 ERR_FAILED\)/.test(m)), 'una carga fallida también se anota');

  // El loop se reconoce por la MISMA url repitiéndose, así que cada navegación queda anotada.
  wc.emit('did-navigate', {}, 'https://bo.casinodrex.com/logout');
  wc.emit('did-navigate', {}, 'https://bo.casinodrex.com/logout');
  const nav = agents.consola().consola.filter(c => /navegó a/.test(c.msg));
  assert.equal(nav.length, 2, 'dos vueltas a la misma url es exactamente la firma del loop');
  assert.equal(windows.length, 1);
});

// Los carteles promocionales del backoffice aparecen encima de todo y se comen los clicks: frenan
// al operador y a la automatización detrás de una publicidad de un torneo. Cerrarlos desde el
// preload llega tarde — para cuando se los ve, ya taparon la pantalla.
test('promo popups are hidden before they paint, without touching the real work dialogs', () => {
  const { Window } = windowFakes();
  const requests = createRequestRegistry(timersFake());
  const backends = { current: { url: 'https://agents.test/search', appSel: 'input', spa: true, preload: 'agent.js' } };
  const agents = createAgentWindowService({ BrowserWindow: Window, icon: 'icon',
    partition: 'persist:nodo-agentes', backends, headers: { configure() {} }, requests });
  const wc = agents.get().webContents;

  wc.emit('dom-ready');
  assert.equal(wc.css.length, 1, 'se tapa apenas hay DOM, antes de que pinte');
  const hoja = wc.css[0];

  // Lo que Juan vio en el backoffice.
  assert.match(hoja, /tournament-popup/, 'el contenedor del cartel');
  assert.match(hoja, /\/images\/tournaments\//, 'y la imagen del torneo');
  assert.match(hoja, /display: none !important/);

  // Lo que NO puede hacer: los modales de carga y retiro son .v-dialog igual que el cartel.
  // Esconderlos a todos rompe las operaciones.
  assert.ok(!/^\s*\.v-dialog\s*\{/m.test(hoja), 'no puede esconder TODOS los diálogos');
  assert.ok(!/^\s*\.v-overlay\s*\{/m.test(hoja), 'ni todos los overlays');
  for (const selector of hoja.split(',')) {
    if (/v-dialog|v-overlay/.test(selector)) {
      assert.match(selector, /:has\(/, 'un diálogo sólo se esconde si TIENE el cartel adentro: ' + selector);
    }
  }

  // El backoffice es una SPA: cambia de ruta sin recargar y el CSS se pierde.
  wc.emit('did-navigate-in-page');
  assert.equal(wc.css.length, 2, 'se vuelve a poner al cambiar de ruta');
  wc.emit('did-navigate');
  assert.equal(wc.css.length, 3, 'y al navegar de verdad también');
});

// La ventana de verificación carga el MISMO backoffice, así que le entran los mismos carteles.
// Tener dos copias del selector es como quedaron desincronizados los dos preloads (H-7).
test('both windows that open the backoffice share one popup rule', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = path.join(__dirname, '..');
  for (const archivo of ['agent-window.js', 'verification.js']) {
    const src = fs.readFileSync(path.join(raiz, 'main', archivo), 'utf8');
    assert.match(src, /require\('\.\/carteles'\)/, archivo + ' tiene que usar el módulo compartido');
    assert.match(src, /taparCarteles\(/, archivo + ' tiene que aplicarlo');
    assert.ok(!/tournament-popup/.test(src), archivo + ' no puede tener su propia copia del selector');
  }
  assert.match(CSS_SIN_CARTELES, /tournament-popup/);
});

// loadURL() es asíncrono: justo después de crear la ventana isLoading() puede dar false, main daba
// la ventana por lista y mandaba la orden cuando el preload todavía no había registrado ningún
// listener. El mensaje se perdía y la llamada moría en el timeout. Pasaba al pedir una búsqueda o
// una carga mientras la ventana recién se levantaba (Juan, 26/9).
function agentesConPreload() {
  const { Window, windows } = windowFakes();
  const requests = createRequestRegistry();
  const backends = { current: { url: 'https://agents.test/search', appSel: 'input', spa: true, preload: 'agent.js' } };
  const agents = createAgentWindowService({ BrowserWindow: Window, icon: 'icon',
    partition: 'persist:nodo-agentes', backends, headers: { configure() {} }, requests });
  const automation = createAutomationService({ agents, backends, requests, env: {} });
  const win = agents.get();
  // Contestar lo que salga, para no dejar la llamada esperando su timeout de 40 s.
  const contestar = () => {
    for (const m of win.webContents.sent) {
      if (m.channel === 'drex:automation:run') requests.settle({ requestId: m.payload.requestId, ok: true, result: {} });
    }
  };
  const pedir = (metodo) => automation.send(metodo).catch(() => {});
  return { agents, automation, requests, windows, win, contestar, pedir };
}
const tic = () => new Promise(r => setImmediate(r));

test('no automation is sent until the preload says it is listening', async () => {
  const { win, windows, contestar, pedir } = agentesConPreload();
  const llamada = pedir('estadoPagina');
  await tic(); await tic();
  assert.equal(win.webContents.sent.length, 0,
    'mandarla acá es tirarla al vacío: del otro lado todavía no hay listener');

  win.webContents.emit('ipc-message', {}, 'drex:preload-listo');
  await tic(); await tic();
  assert.equal(win.webContents.sent.length, 1, 'con el saludo, recién ahí sale');
  assert.equal(win.webContents.sent[0].channel, 'drex:automation:run');
  assert.equal(windows.length, 1);
  contestar(); await llamada;
});

test('a new document means a new preload, so the handshake is awaited again', async () => {
  const { win, contestar, pedir } = agentesConPreload();
  win.webContents.emit('ipc-message', {}, 'drex:preload-listo');
  await tic();

  // Navegación de documento: el preload se destruye y viene otro.
  win.webContents.emit('did-start-navigation', {}, 'https://agents.test/otra', false, false);
  const llamada = pedir('estadoPagina');
  await tic(); await tic();
  assert.equal(win.webContents.sent.length, 0, 'hay que esperar al preload nuevo');

  win.webContents.emit('ipc-message', {}, 'drex:preload-listo');
  await tic(); await tic();
  assert.equal(win.webContents.sent.length, 1);
  contestar(); await llamada;
});

test('an in-page route change keeps the same preload: no extra wait', async () => {
  const { win, contestar, pedir } = agentesConPreload();
  win.webContents.emit('ipc-message', {}, 'drex:preload-listo');
  await tic();

  // El backoffice es una SPA: cambia de ruta sin recargar y el preload sigue siendo el mismo.
  win.webContents.emit('did-start-navigation', {}, 'https://agents.test/otra', true, true);
  const llamada = pedir('estadoPagina');
  await tic(); await tic();
  assert.equal(win.webContents.sent.length, 1, 'no tiene por qué esperar de nuevo');
  contestar(); await llamada;
});

test('if the handshake never arrives it gives up waiting instead of hanging', async () => {
  const { agents } = agentesConPreload();
  // Nunca rechaza: si el saludo no llega, se sigue como antes en vez de romper la operación.
  assert.equal(await agents.preloadReady(10), false);
});

test('if the window dies while waiting, the wait ends at once and says there is no preload', async () => {
  const { vigilarPreload } = require('../main/preload-listo.js');
  const { Window } = windowFakes();
  const win = new Window({});
  const preload = vigilarPreload(win);

  const espera = preload.esperar(60000);        // un timeout largo: si no cortara, quedaría colgado
  win.destroy();
  assert.equal(await espera, false, 'no hubo saludo: decir true sería mentir');
  assert.equal(await preload.esperar(60000), false, 'y sigue diciendo que no, sin esperar de nuevo');
});

test('the handshake resolves true only when the preload actually greets', async () => {
  const { vigilarPreload } = require('../main/preload-listo.js');
  const { Window } = windowFakes();
  const win = new Window({});
  const preload = vigilarPreload(win);
  const espera = preload.esperar(60000);
  win.webContents.emit('ipc-message', {}, 'drex:preload-listo');
  assert.equal(await espera, true);
  assert.equal(preload.listo, true);
});

test('cerrar el panel cierra NODO y recargarlo recrea las ventanas ocultas sin cortar operaciones', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const f = src.slice(src.indexOf('function atarVentanasAlPanel'), src.indexOf('app.whenReady()'));
  assert.match(f, /on\('closed', \(\) => \{ app\.quit\(\); \}\)/, 'el panel cerrado no puede dejar NODO corriendo de fondo');
  assert.match(f, /automationRequests\.pending\.size/, 'espera a que termine la operacion en curso');
  assert.match(f, /agents\.close\(\)/);
  assert.match(f, /verification\.close\(\)/);
  assert.doesNotMatch(f, /chunior/i.test(f.replace(/\/\/.*$/gm, '')) ? /chunior\./ : /^$/, 'Chunior no se recrea: perderia la sesion');
  assert.match(src, /panel\.create\(\);\s*atarVentanasAlPanel\(\);/);
});
