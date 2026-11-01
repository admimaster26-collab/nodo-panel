'use strict';
// Comprobación real de configuración -> handler IPC productivo -> HTTPS -> RPC.
// Sólo negocia capacidades con p_activate:false. No prueba datos, efectos ni UI.
const fs = require('node:fs');
const path = require('node:path');
const { loadBetaConfig, normalizeOffice } = require('../main/beta-config');
const { registerPanelIpc } = require('../main/panel-rpc');
const EXPECTED_DOMAIN_CAPABILITIES = Object.freeze([
  'perfil.summary.v1',
  'perfil.detail.v1',
  'perfil.identity.v1',
  'persistence.local.v1',
  'historial.filters.v1',
  'bandeja.queue.v1',
  'nexo.export.v1'
]);

async function checkConnection({ betaConfig = loadBetaConfig(), fetch = globalThis.fetch,
  office, required = [], now = () => new Date().toISOString() } = {}) {
  const report = { checked_at: now(), configuration: betaConfig.enabled ? 'VALID' : 'DISABLED',
    transport: 'panel:rpc -> HTTPS -> nodo_beta_capacidades_v1',
    activation_requested: false, offices: [], ok: false,
    limits: ['Comprueba autenticación, ámbito y contrato de capacidades.',
      'No acredita lectura de datos, escrituras, render ni uso por una instancia Electron abierta.'] };
  if (!betaConfig.enabled) { report.error = betaConfig.reason || 'BETA_NOT_CONFIGURED'; return report; }
  const selected = office === undefined ? betaConfig.offices : [normalizeOffice(office)];
  if (!selected.length || selected.some(pc => !pc || !betaConfig.offices.includes(pc))) {
    report.error = 'BETA_OFFICE_NOT_CONFIGURED'; return report;
  }
  const validCapability = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,79}$/.test(value);
  if (!Array.isArray(required) || required.length > 128 || !required.every(validCapability)) {
    report.error = 'BETA_INVALID_REQUIRED_CAPABILITIES'; return report;
  }
  const handlers = new Map();
  registerPanelIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    env: {}, betaConfig, fetch });
  for (const pc of selected) {
    const result = await handlers.get('panel:rpc')({}, 'nodo_beta_capacidades_v1',
      { p_pc_codigo: pc, p_activate: false });
    const row = { office: pc, authenticated_contract: false, capabilities: [], missing_required: [...required] };
    const data = result?.data;
    if (result?.error) {
      row.error = /^BETA_[A-Z0-9_]{1,80}$/.test(result.error.code || '') ? result.error.code : 'BETA_CONNECTION_FAILED';
    } else if (data?.ok !== true || data.contract !== 'nodo.beta.v1' || data.scope?.pc_codigo !== pc ||
      !Array.isArray(data.capabilities) || data.capabilities.length > 128 || !data.capabilities.every(validCapability)) {
      row.error = 'BETA_CONTRACT_MISMATCH';
    } else {
      row.authenticated_contract = true;
      row.capabilities = [...new Set(data.capabilities)].sort();
      row.missing_required = required.filter(capability => !row.capabilities.includes(capability));
      row.missing_domain_capabilities = EXPECTED_DOMAIN_CAPABILITIES.filter(capability => !row.capabilities.includes(capability));
      row.portal_lease_active = data.active === true;
    }
    report.offices.push(row);
  }
  report.ok = report.offices.every(row => row.authenticated_contract && !row.missing_required.length);
  return report;
}

async function main(args = process.argv.slice(2)) {
  const options = {}, required = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!['--office', '--require', '--report'].includes(flag) || !value || value.startsWith('--')) {
      throw new Error('Uso: node scripts/beta-connection-check.cjs [--office P1] [--require capability] [--report ruta.json]');
    }
    if (flag === '--require') required.push(value);
    else options[flag.slice(2)] = value;
  }
  const report = await checkConnection({ office: options.office, required });
  if (options.report) {
    const file = path.resolve(options.report);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // No sobrescribir archivos existentes: tampoco el archivo de credenciales.
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

module.exports = { checkConnection };
if (require.main === module) main().catch(error => {
  // No imprimir excepciones que puedan incluir rutas privadas o respuestas HTTP.
  console.error(error.message.startsWith('Uso:') ? error.message : 'BETA_CONNECTION_CHECK_FAILED');
  process.exitCode = 1;
});
