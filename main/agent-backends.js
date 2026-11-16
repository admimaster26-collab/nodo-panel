'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createAgentBackends({ app, rootDir, env = process.env }) {
  const AGENT_BACKENDS = {
    casinodrex: {
      url:        'https://bo.casinodrex.com/agents/user_search',
      newUserUrl: 'https://bo.casinodrex.com/agents/new_user',
      // Funcionalidades y permisos: ahí vive el WhatsApp que el jugador ve en el Portal.
      whatsappUrl:'https://bo.casinodrex.com/agents/features',
      preload:    'agent-preload.js',
      spa:        false,
      label:      'Casinodrex',
      appSel:     '#searchButton, input.validationField, input[name="amount"], input[type="password"], input[name="alias"], [data-agenttree-user-type], span.hideUserBalance, .crmpam_no_data_found'
    },
    bet300: {
      url:        'https://agentesbet.io/',
      newUserUrl: 'https://agentesbet.io/',
      whatsappUrl:null,          // este backoffice no tiene esa pantalla
      preload:    'agent-preload-bet300.js',
      spa:        true,
      label:      'BET300 (agentesbet.io)',
      appSel:     'input[placeholder="Buscar usuario"], input[placeholder="Alias"], .v-navigation-drawer .v-list-item, .v-list-item--link'
    },
    adminonline: {
      url:        'https://www.adminonline.me/agents/control',
      newUserUrl: 'https://www.adminonline.me/agents/control',
      // AdminOnline pone este formulario en Personalizar página; /whatsapp es otra pantalla.
      whatsappUrl:'https://www.adminonline.me/config/socials',
      preload:    'agent-preload-adminonline.js',
      spa:        true,
      spaPathAware: true,        // AdminOnline es SPA; control y personalización son rutas distintas
      label:      'AdminOnline (adminonline.me)',
      appSel:     'input[placeholder="Buscar por alias o ID"], input[type="tel"][placeholder="Ingrese número de WhatsApp"], input#alias, input#password'
    }
  };
  function _agentBackendFile(){ try { return path.join(app.getPath('userData'), 'nodo-agent-backend'); } catch (_e) { return ''; } }
  function _leerBackendGuardado(){
    // 1) Lo que eligió el operador desde el panel (archivo persistido) manda.
    try { const f = _agentBackendFile(); if (f && fs.existsSync(f)) { const v = String(fs.readFileSync(f, 'utf8')).trim().toLowerCase(); if (AGENT_BACKENDS[v]) return v; } } catch (_e) {}
    // 2) Fallback al .env (AGENT_PLATFORM) para oficinas configuradas. Default: casinodrex (intacto).
    const plataforma = String(env.AGENT_PLATFORM || '').trim().toLowerCase();
    return Object.hasOwn(AGENT_BACKENDS, plataforma) ? plataforma : 'casinodrex';
  }

  let selected = _leerBackendGuardado();
  function current() { return { ...AGENT_BACKENDS[selected], preload: path.join(rootDir, AGENT_BACKENDS[selected].preload) }; }
  function info() { return { ok: true, backend: selected, label: AGENT_BACKENDS[selected].label, url: current().url, opciones: Object.keys(AGENT_BACKENDS).map(id => ({ id, label: AGENT_BACKENDS[id].label })) }; }
  function select(id) {
    if (!Object.hasOwn(AGENT_BACKENDS, id)) return { ok: false, error: 'backend desconocido: ' + id };
    if (id === selected) return { ok: true, backend: id, sinCambio: true, label: AGENT_BACKENDS[id].label };
    selected = id;
    try { const file = _agentBackendFile(); if (file) fs.writeFileSync(file, id, 'utf8'); } catch (_) {}
    return { ok: true, backend: id, label: AGENT_BACKENDS[id].label, url: current().url };
  }
  console.log('[agente] backend =', selected, '·', current().label);

  return { get current() { return current(); }, info, select };
}

module.exports = { createAgentBackends };
