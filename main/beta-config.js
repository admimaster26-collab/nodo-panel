'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BUILD = 'nodo-beta-v1';
const MAX_CONFIG_BYTES = 65536;
const OFFICE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const BUILD = /^[A-Za-z0-9._+/-]{1,128}$/;

function normalizeOffice(value) {
  if(typeof value !== 'string') return '';
  const office = value.trim().toUpperCase();
  return OFFICE.test(office) ? office : '';
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if(url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    const hosted = url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) && !url.port;
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return hosted || local ? url.origin : null;
  } catch(_) { return null; }
}

function isPublicKey(value) {
  if(typeof value !== 'string' || !value || value.length > 8192 || /\s/.test(value) || value.startsWith('sb_secret_')) return false;
  // A service-role key is never a client key, even if a private config is mislabelled.
  if(value.split('.').length === 3) {
    try { if(JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')).role === 'service_role') return false; }
    catch(_) { return false; }
  }
  return true;
}

function disabled(reason = 'BETA_NOT_CONFIGURED') {
  return Object.freeze({ enabled: false, offices: Object.freeze([]), build: DEFAULT_BUILD, reason });
}

function loadBetaConfig({ env = process.env, readFile = fs.readFileSync } = {}) {
  const file = env.NODO_BETA_CONFIG || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'NODO', 'beta', 'connection.json'));
  if(!file) return disabled();
  try {
    const raw = readFile(file);
    if(Buffer.byteLength(raw) > MAX_CONFIG_BYTES) return disabled('BETA_CONFIG_INVALID');
    const config = JSON.parse(String(raw).replace(/^\uFEFF/, ''));
    if(!config || typeof config !== 'object' || Array.isArray(config)) return disabled('BETA_CONFIG_INVALID');
    if(config.enabled === false) return disabled('BETA_CONFIG_DISABLED');
    const url = safeUrl(config.url);
    const build = config.build || DEFAULT_BUILD;
    if(!url || !isPublicKey(config.public_key) || typeof build !== 'string' || !BUILD.test(build)) return disabled('BETA_CONFIG_INVALID');
    if(!config.credentials || typeof config.credentials !== 'object' || Array.isArray(config.credentials)) return disabled('BETA_CONFIG_INVALID');
    const credentials = Object.create(null);
    const entries = Object.entries(config.credentials);
    if(!entries.length || entries.length > 128) return disabled('BETA_CONFIG_INVALID');
    for(const [rawOffice, token] of entries) {
      const office = normalizeOffice(rawOffice);
      if(!office || Object.hasOwn(credentials, office) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return disabled('BETA_CONFIG_INVALID');
      credentials[office] = token;
    }
    return Object.freeze({ enabled: true, url, publicKey: config.public_key, credentials: Object.freeze(credentials),
      offices: Object.freeze(Object.keys(credentials).sort()), build });
  } catch(error) {
    return disabled(error?.code === 'ENOENT' ? 'BETA_NOT_CONFIGURED' : 'BETA_CONFIG_INVALID');
  }
}

function publicBetaContext(config) {
  return { enabled: config.enabled === true, offices: [...config.offices], build: config.build };
}

module.exports = { loadBetaConfig, publicBetaContext, normalizeOffice };
