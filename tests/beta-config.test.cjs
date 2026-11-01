'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadBetaConfig, publicBetaContext, normalizeOffice } = require('../main/beta-config');
const { registerPanelIpc } = require('../main/panel-rpc');

const token = 'ab'.repeat(32), token2 = 'cd'.repeat(32), publicKey = 'public-anon-for-isolated-tests';
function fixture(changes = {}) {
  return { url: 'https://demo.supabase.co/', public_key: publicKey, credentials: { P1: token }, build: 'nodo-beta-v1', ...changes };
}
function load(config = fixture(), options = {}) {
  return loadBetaConfig({ env: { NODO_BETA_CONFIG: 'test-only.json' }, readFile: () => Buffer.from(JSON.stringify(config)), ...options });
}
function harness({ betaConfig = load(), fetch, timers } = {}) {
  const handlers = new Map(), calls = [];
  const ipcMain = { handle(name, fn) { handlers.set(name, fn); } };
  registerPanelIpc({ ipcMain, env: { SUPABASE_URL: 'https://legacy.test', SUPABASE_ANON_KEY: 'legacy-public' }, betaConfig,
    fetch: fetch || (async (url, request) => { calls.push({ url, request }); return response({ ok: true }); }),
    ...(timers || {}) });
  return { calls, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}
function response(data, status = 200) { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) }; }

test('beta: configuración ausente o inválida deshabilita beta sin exponer ruta ni credenciales', () => {
  const absent = loadBetaConfig({ env: {}, readFile: () => assert.fail('sin ruta no se lee') });
  assert.deepEqual(publicBetaContext(absent), { enabled: false, offices: [], build: 'nodo-beta-v1' });
  const malformed = load(null, { readFile: () => { throw new Error('private-path-and-token'); } });
  assert.equal(malformed.enabled, false);
  assert.equal(JSON.stringify(malformed).includes('private-path-and-token'), false);
  assert.equal(load(fixture({ enabled: false })).enabled, false);
  assert.equal(load(null).enabled, false);
  assert.equal(load(null, { readFile: () => Buffer.alloc(65537) }).enabled, false);
});

test('beta: ruta privada por LOCALAPPDATA y override explícito, BOM UTF8 admitido', () => {
  const seen = [];
  const readFile = file => { seen.push(file); return Buffer.from('\uFEFF' + JSON.stringify(fixture())); };
  assert.equal(loadBetaConfig({ env: { LOCALAPPDATA: 'private-data' }, readFile }).enabled, true);
  assert.equal(seen[0], path.join('private-data', 'NODO', 'beta', 'connection.json'));
  loadBetaConfig({ env: { LOCALAPPDATA: 'ignored', NODO_BETA_CONFIG: 'selected.json' }, readFile });
  assert.equal(seen[1], 'selected.json');
});

test('beta: acepta Supabase HTTPS y loopback HTTP, rechaza otros destinos y credenciales en URL', () => {
  for(const url of ['https://demo.supabase.co', 'http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) assert.equal(load(fixture({ url })).enabled, true, url);
  for(const url of ['http://demo.supabase.co', 'https://demo.supabase.co.evil.test', 'https://evil.test',
    'https://demo.supabase.co:444', 'https://demo.supabase.co/path', 'https://demo.supabase.co?x=1',
    'https://secret@demo.supabase.co', 'http://192.168.1.2:54321', 'file:///private', 'javascript:alert(1)']) assert.equal(load(fixture({ url })).enabled, false, url);
});

test('beta: rechaza service role, claves secretas y tokens incompatibles; oficinas normalizadas sin duplicados', () => {
  const serviceRole = 'e30.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.signature';
  for(const public_key of [serviceRole, 'sb_secret_private', 'key\nheader', '']) assert.equal(load(fixture({ public_key })).enabled, false);
  for(const credentials of [{ P1: 'short' }, { P1: token.toUpperCase() }, { ' p1 ': token, P1: token2 }, {}, []]) assert.equal(load(fixture({ credentials })).enabled, false);
  const config = load(fixture({ credentials: { ' p2 ': token2, P1: token } }));
  assert.deepEqual(publicBetaContext(config), { enabled: true, offices: ['P1', 'P2'], build: 'nodo-beta-v1' });
  assert.equal(normalizeOffice(' p1 '), 'P1');
  assert.equal(normalizeOffice({ toString: () => 'P1' }), '');
  assert.equal(Object.isFrozen(config.credentials), true);
});

test('beta IPC: context sólo expone enabled, oficinas y build; ausencia conserva RPC legacy', async () => {
  const h = harness();
  const context = await h.invoke('panel:get-context');
  assert.deepEqual(context.beta, { enabled: true, offices: ['P1'], build: 'nodo-beta-v1' });
  for(const secret of [token, publicKey, 'demo.supabase.co', 'credentials']) assert.equal(JSON.stringify(context).includes(secret), false);
  const old = harness({ betaConfig: loadBetaConfig({ env: {} }) });
  assert.equal((await old.invoke('panel:rpc', 'nodo_beta_chat_lista_v1', { p_pc_codigo: 'P1' })).error.message, 'BETA_NOT_CONFIGURED');
  assert.equal(old.calls.length, 0);
  await old.invoke('panel:rpc', 'panel_nodo_send_chat_message', { text: 'test' });
  assert.equal(old.calls[0].url, 'https://legacy.test/rest/v1/rpc/panel_nodo_send_chat_message');
  assert.deepEqual(JSON.parse(old.calls[0].request.body), { text: 'test' });
});

test('beta IPC: inyecta token privado por oficina y build propio; niega token y parámetros arbitrarios del renderer', async () => {
  const h = harness({ betaConfig: load(fixture({ credentials: { P1: token, P2: token2 } })) });
  const result = await h.invoke('panel:rpc', { fn: 'nodo_beta_capacidades_v1', params: { p_pc_codigo: ' p2 ', p_build: 'renderer-forged-build', p_activate: true } });
  assert.equal(result.error, null);
  const sent = JSON.parse(h.calls[0].request.body);
  assert.deepEqual(sent, { p_pc_codigo: 'P2', p_build: 'nodo-beta-v1', p_activate: true, p_token: token2 });
  assert.equal(h.calls[0].request.redirect, 'error');
  assert.equal(h.calls[0].request.headers.apikey, publicKey);
  for(const params of [{ p_pc_codigo: 'P1', p_token: token }, { p_pc_codigo: 'P1', arbitrary: true }, { p_pc_codigo: 'P1', p_activate: 'true' }]) {
    assert.equal((await h.invoke('panel:rpc', 'nodo_beta_capacidades_v1', params)).error.message, 'BETA_INVALID_PARAMS');
  }
  assert.equal((await h.invoke('panel:rpc', 'nodo_beta_capacidades_v1', { p_pc_codigo: 'P9' })).error.message, 'BETA_OFFICE_NOT_CONFIGURED');
  assert.equal((await h.invoke('panel:rpc', 'nodo_beta_capacidades_v1', {})).error.message, 'BETA_OFFICE_NOT_CONFIGURED');
  assert.equal(h.calls.length, 1);
});

test('beta IPC: lista/mensajes/lectura/salud/envío pasan por la ruta beta y preservan parámetros de negocio', async () => {
  const h = harness();
  const cases = [
    ['nodo_beta_chat_lista_v1', { p_usuario: 'DEMO', p_estado: 'ABIERTO', p_limit: 20, p_before_id: '9007199254740999' }],
    ['nodo_beta_chat_mensajes_v1', { p_chat_id: 'chat-demo', p_limit: 25 }],
    ['nodo_beta_chat_leido_v1', { p_chat_id: 'chat-demo', p_message_ids: ['9007199254740999'] }],
    ['nodo_beta_salud_v1', { p_muestras: [{ integration: 'CHAT', stage: 'DATA', state: 'OK' }] }],
    ['nodo_beta_chat_enviar_v1', { p_chat_id: 'chat-demo', p_mensaje: 'Demo', p_imagen_url: null, p_emisor: 'DEMO', p_request_id: '8c100a3b-1c02-4027-b648-05e15b30fa8a' }]
  ];
  for(const [fn, params] of cases) {
    assert.equal((await h.invoke('panel:rpc', fn, { p_pc_codigo: 'P1', ...params })).error, null);
    const call = h.calls.at(-1), body = JSON.parse(call.request.body);
    assert.equal(call.url, `https://demo.supabase.co/rest/v1/rpc/${fn}`);
    for(const [key, value] of Object.entries(params)) assert.deepEqual(body[key], value);
    assert.equal(body.p_token, token);
    if(fn === 'nodo_beta_salud_v1') assert.equal(body.p_build, 'nodo-beta-v1');
  }
});

test('beta IPC: no autoriza RPCs beta desconocidas ni reintenta escrituras con error', async () => {
  let calls = 0;
  const h = harness({ fetch: async () => { calls++; return response({ message: 'BETA_ACK_OUT_OF_SCOPE' }, 403); } });
  assert.match((await h.invoke('panel:rpc', 'nodo_beta_admin_v1', { p_pc_codigo: 'P1' })).error.message, /RPC_NO_PERMITIDA/);
  assert.equal(calls, 0);
  const result = await h.invoke('panel:rpc', 'nodo_beta_chat_enviar_v1', { p_pc_codigo: 'P1', p_chat_id: 'demo', p_request_id: 'id' });
  assert.deepEqual(result, { data: null, error: { code: 'BETA_ACK_OUT_OF_SCOPE', message: 'BETA_ACK_OUT_OF_SCOPE', status: 403 } });
  assert.equal(calls, 1);
});

test('beta IPC: errores de HTTP/red y respuestas malformadas no devuelven claves ni texto privado', async () => {
  const cases = [
    [async () => response({ message: 'private ' + token, details: publicKey }, 500), 'BETA_HTTP_ERROR'],
    [async () => { throw new Error('private ' + token); }, 'BETA_NETWORK_ERROR'],
    [async () => ({ ok: true, status: 200, text: async () => token }), 'BETA_INVALID_RESPONSE'],
    [async () => response({ ok: false, message: token }), 'BETA_INVALID_RESPONSE'],
    [async () => response([]), 'BETA_INVALID_RESPONSE']
  ];
  for(const [fetch, message] of cases) {
    const result = await harness({ fetch }).invoke('panel:rpc', 'nodo_beta_chat_lista_v1', { p_pc_codigo: 'P1' });
    assert.equal(result.error.message, message);
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal(JSON.stringify(result).includes(publicKey), false);
  }
});

test('beta IPC: un eco accidental del servidor tampoco expone las credenciales al renderer', async () => {
  const h = harness({ fetch: async () => response({ ok: true, p_token: token, nested: { credentials: { P1: token }, value: 'echo=' + token }, message: publicKey }) });
  const result = await h.invoke('panel:rpc', 'nodo_beta_chat_lista_v1', { p_pc_codigo: 'P1' });
  assert.equal(result.error, null);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(JSON.stringify(result).includes(publicKey), false);
  assert.deepEqual(result.data.nested, { value: 'echo=[redacted]' });
});

test('beta IPC: timeout de 10s aborta la petición y limpia timer, incluso si fetch no coopera', async () => {
  let expire, delay, signal, cleared;
  const h = harness({ fetch: async (_url, request) => { signal = request.signal; return new Promise(() => {}); },
    timers: { setTimer: (fn, ms) => { expire = fn; delay = ms; return 42; }, clearTimer: id => { cleared = id; } } });
  const pending = h.invoke('panel:rpc', 'nodo_beta_chat_lista_v1', { p_pc_codigo: 'P1' });
  assert.equal(delay, 10000);
  expire();
  const result = await pending;
  assert.equal(result.error.message, 'BETA_TIMEOUT');
  assert.equal(signal.aborted, true);
  assert.equal(cleared, 42);
});

test('beta IPC: completar respuesta también limpia deadline', async () => {
  let cleared;
  const h = harness({ timers: { setTimer: () => 99, clearTimer: id => { cleared = id; } } });
  assert.equal((await h.invoke('panel:rpc', 'nodo_beta_chat_lista_v1', { p_pc_codigo: 'P1' })).error, null);
  assert.equal(cleared, 99);
});

test('beta IPC: recarga en caliente de connection.json y allowlist de RPCs de dominio nuevas', async () => {
  let currentFile = { enabled: false };
  const handlers = new Map(), calls = [];
  registerPanelIpc({
    ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
    env: { NODO_BETA_CONFIG: 'hot.json', SUPABASE_URL: 'https://legacy.test', SUPABASE_ANON_KEY: 'legacy-public' },
    readFile: () => Buffer.from(JSON.stringify(currentFile)),
    fetch: async (url, request) => { calls.push({ url, request }); return response({ ok: true }); }
  });
  const invoke = (name, ...args) => handlers.get(name)({}, ...args);
  assert.equal((await invoke('panel:get-context')).beta.enabled, false);
  assert.equal((await invoke('panel:rpc', 'nodo_beta_perfil_identidad_v1', { p_pc_codigo: 'P1', p_usuario: 'demo' })).error.message, 'BETA_NOT_CONFIGURED');

  currentFile = fixture({ credentials: { P1: token } });
  assert.equal((await invoke('panel:get-context')).beta.enabled, true);

  const newRpcs = [
    ['nodo_beta_perfil_identidad_v1', { p_usuario: 'demo', p_limit: 50, p_cursor: null }],
    ['nodo_beta_persistencia_sync_v1', { p_instalacion: 'pc-p1', p_version: '2.1.5', p_lote: { jugadores: [], movimientos: [], cotejos: [], colas: [] } }],
    ['nodo_beta_persistencia_leer_v1', { p_usuario: 'demo', p_tipo: 'TODO', p_limit: 50 }],
    ['nodo_beta_historial_v1', { p_filtros: { tipo: 'CARGA' }, p_limit: 50, p_cursor: null }],
    ['nodo_beta_bandeja_v1', { p_filtros: {}, p_limit: 50, p_cursor: null }],
    ['nodo_beta_nexo_export_v1', { p_limit: 500, p_cursor: null }]
  ];
  for (const [fn, params] of newRpcs) {
    const res = await invoke('panel:rpc', fn, { p_pc_codigo: 'P1', ...params });
    assert.equal(res.error, null, fn);
    const last = calls.at(-1);
    assert.equal(last.url, `https://demo.supabase.co/rest/v1/rpc/${fn}`);
    assert.equal(JSON.parse(last.request.body).p_token, token);
  }
});
