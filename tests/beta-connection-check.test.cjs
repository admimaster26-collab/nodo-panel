'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBetaConfig } = require('../main/beta-config');
const { checkConnection } = require('../scripts/beta-connection-check.cjs');
const token = 'ab'.repeat(32);
const betaConfig = loadBetaConfig({ env: { NODO_BETA_CONFIG: 'isolated' }, readFile: () => JSON.stringify({
  url: 'https://demo.supabase.co', public_key: 'public-test-key', credentials: { P1: token }, build: 'test-build'
}) });
const offer = { ok: true, contract: 'nodo.beta.v1', scope: { pc_codigo: 'P1' }, capabilities: ['chat.list.v1'], active: false };
const response = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });

test('conexión: cruza handler productivo con token privado, no activa y no divulga credenciales', async () => {
  let calls = 0;
  const report = await checkConnection({ betaConfig, required: ['chat.list.v1'], fetch: async (url, request) => {
    calls++;
    assert.equal(url, 'https://demo.supabase.co/rest/v1/rpc/nodo_beta_capacidades_v1');
    assert.deepEqual(JSON.parse(request.body), { p_pc_codigo: 'P1', p_activate: false, p_token: token, p_build: 'test-build' });
    return response(offer);
  } });
  assert.equal(calls, 1); assert.equal(report.ok, true);
  assert.equal(report.offices[0].portal_lease_active, false);
  for (const secret of [token, 'public-test-key', 'https://demo.supabase.co']) assert.equal(JSON.stringify(report).includes(secret), false);
});
test('conexión: configuración ausente u oficina ajena no hacen red', async () => {
  const fetch = async () => assert.fail('No debe consultar');
  const absent = await checkConnection({ betaConfig: loadBetaConfig({ env: {} }), fetch });
  assert.equal(absent.ok, false); assert.equal(absent.error, 'BETA_NOT_CONFIGURED');
  const wrongOffice = await checkConnection({ betaConfig, office: 'P2', fetch });
  assert.equal(wrongOffice.error, 'BETA_OFFICE_NOT_CONFIGURED');
});
test('conexión: capacidad ausente no confunde conexión con integración', async () => {
  const report = await checkConnection({ betaConfig, required: ['perfil.identity.v1'], fetch: async () => response(offer) });
  assert.equal(report.ok, false); assert.equal(report.offices[0].authenticated_contract, true);
  assert.deepEqual(report.offices[0].missing_required, ['perfil.identity.v1']);
});
test('conexión: rechaza ámbito, contrato o capacidades incompatibles', async () => {
  for (const change of [{ scope: { pc_codigo: 'P2' } }, { contract: 'other' }, { capabilities: [token] }, { capabilities: null }]) {
    const report = await checkConnection({ betaConfig, fetch: async () => response({ ...offer, ...change }) });
    assert.equal(report.ok, false); assert.equal(report.offices[0].error, 'BETA_CONTRACT_MISMATCH');
  }
});
test('conexión: errores de autorización/red quedan fallidos y saneados', async () => {
  const denied = await checkConnection({ betaConfig, fetch: async () => ({ ok: false, status: 403,
    text: async () => JSON.stringify({ message: 'BETA_NOT_AUTHORIZED' }) }) });
  assert.equal(denied.ok, false); assert.equal(denied.offices[0].error, 'BETA_NOT_AUTHORIZED');
  const network = await checkConnection({ betaConfig, fetch: async () => { throw new Error(token); } });
  assert.equal(network.offices[0].error, 'BETA_NETWORK_ERROR');
  assert.equal(JSON.stringify(network).includes(token), false);
});
