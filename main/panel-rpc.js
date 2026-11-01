'use strict';
const { loadBetaConfig, publicBetaContext, normalizeOffice } = require('./beta-config');

function registerPanelIpc({ ipcMain, env = process.env, fetch = globalThis.fetch,
  betaConfig, readFile, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const resolveBetaConfig = () => typeof betaConfig === 'function'
    ? betaConfig()
    : (betaConfig !== undefined ? betaConfig : loadBetaConfig({ env, ...(readFile ? { readFile } : {}) }));
  const BETA_RPC_PARAMS = new Map([
    ['nodo_beta_capacidades_v1', new Set(['p_pc_codigo', 'p_activate', 'p_build'])],
    ['nodo_beta_chat_lista_v1', new Set(['p_pc_codigo', 'p_usuario', 'p_estado', 'p_limit', 'p_before_id'])],
    ['nodo_beta_chat_mensajes_v1', new Set(['p_pc_codigo', 'p_chat_id', 'p_limit', 'p_before_id'])],
    ['nodo_beta_chat_leido_v1', new Set(['p_pc_codigo', 'p_chat_id', 'p_message_ids'])],
    ['nodo_beta_chat_enviar_v1', new Set(['p_pc_codigo', 'p_chat_id', 'p_mensaje', 'p_imagen_url', 'p_emisor', 'p_request_id'])],
    ['nodo_beta_salud_v1', new Set(['p_pc_codigo', 'p_muestras', 'p_build'])],
    ['nodo_beta_perfil_v1', new Set(['p_pc_codigo', 'p_usuario'])],
    ['nodo_beta_perfil_detalle_v1', new Set(['p_pc_codigo', 'p_usuario', 'p_limit', 'p_cursor'])],
    ['nodo_beta_perfil_identidad_v1', new Set(['p_pc_codigo', 'p_usuario', 'p_limit', 'p_cursor'])],
    ['nodo_beta_persistencia_sync_v1', new Set(['p_pc_codigo', 'p_instalacion', 'p_version', 'p_lote'])],
    ['nodo_beta_persistencia_leer_v1', new Set(['p_pc_codigo', 'p_usuario', 'p_referencia_id', 'p_tipo', 'p_limit', 'p_cursor'])],
    ['nodo_beta_historial_v1', new Set(['p_pc_codigo', 'p_filtros', 'p_limit', 'p_cursor'])],
    ['nodo_beta_bandeja_v1', new Set(['p_pc_codigo', 'p_filtros', 'p_limit', 'p_cursor'])],
    ['nodo_beta_nexo_export_v1', new Set(['p_pc_codigo', 'p_limit', 'p_cursor'])]
  ]);
  const betaError = (message, status) => ({ data: null, error: { code: message, message, ...(status ? { status } : {}) } });
  function sanitizeBetaData(value, currentConfig = resolveBetaConfig()) {
    const secrets = [currentConfig.publicKey, ...Object.values(currentConfig.credentials || {})].filter(Boolean);
    function clean(item, depth = 0) {
      if(depth > 30) return null;
      if(typeof item === 'string') {
        for(const secret of secrets) item = item.split(secret).join('[redacted]');
        return item;
      }
      if(Array.isArray(item)) return item.map(entry => clean(entry, depth + 1));
      if(item && typeof item === 'object') {
        const out = {};
        for(const [key, entry] of Object.entries(item)) {
          if(['p_token', 'token', 'credentials', 'public_key', 'publicKey', '__proto__', 'constructor', 'prototype'].includes(key)) continue;
          out[key] = clean(entry, depth + 1);
        }
        return out;
      }
      return item;
    }
    return clean(value);
  }
  async function betaRpc(fn, params) {
    const currentConfig = resolveBetaConfig();
    if(!currentConfig.enabled) return betaError('BETA_NOT_CONFIGURED');
    if(!params || typeof params !== 'object' || Array.isArray(params)) return betaError('BETA_INVALID_PARAMS');
    const allowed = BETA_RPC_PARAMS.get(fn);
    if(Object.keys(params).some(key => !allowed.has(key))) return betaError('BETA_INVALID_PARAMS');
    const office = normalizeOffice(params.p_pc_codigo);
    if(!office || !Object.hasOwn(currentConfig.credentials, office)) return betaError('BETA_OFFICE_NOT_CONFIGURED');
    if(fn === 'nodo_beta_capacidades_v1' && params.p_activate !== undefined && typeof params.p_activate !== 'boolean') return betaError('BETA_INVALID_PARAMS');
    const payload = { ...params, p_pc_codigo: office, p_token: currentConfig.credentials[office] };
    if(allowed.has('p_build')) payload.p_build = currentConfig.build;
    const controller = new AbortController();
    let timer;
    try {
      const expired = new Promise((_, reject) => {
        timer = setTimer(() => { controller.abort(); reject(new Error('BETA_TIMEOUT')); }, 10000);
      });
      const request = (async () => {
        const response = await fetch(`${currentConfig.url}/rest/v1/rpc/${fn}`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { apikey: currentConfig.publicKey, Authorization: `Bearer ${currentConfig.publicKey}`,
            'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch(_) { return betaError('BETA_INVALID_RESPONSE', response.status); }
        if(!response.ok) {
          const message = /^BETA_[A-Z0-9_]{1,80}$/.test(data?.message || '') ? data.message : 'BETA_HTTP_ERROR';
          return betaError(message, response.status);
        }
        if(!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true) return betaError('BETA_INVALID_RESPONSE');
        return { data: sanitizeBetaData(data, currentConfig), error: null };
      })();
      return await Promise.race([request, expired]);
    } catch(error) {
      return betaError(controller.signal.aborted ? 'BETA_TIMEOUT' : 'BETA_NETWORK_ERROR');
    } finally { if(timer !== undefined) clearTimer(timer); }
  }

  async function panelRpcRestFetchV154Plus(fn, params = {}) {
    const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    const key = String(env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
    if (!url || !key) {
      return { data: null, error: { message: "Falta SUPABASE_URL o SUPABASE_ANON_KEY en .env" } };
    }

    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(params || {})
      });

      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_e) { data = txt; }

      if (!res.ok) {
        return {
          data: null,
          error: {
            message: (data && (data.message || data.error || data.hint)) || `HTTP ${res.status}`,
            status: res.status,
            details: data
          }
        };
      }

      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  // Whitelist de RPC que el HTML puede invocar por panelAPI.rpc (lectura de Portal/Chat).
  // Igual que ALLOWED_AUTOMATION_METHODS: evita que un bug/XSS en el renderer llame RPCs no previstas.
  const PANEL_RPC_ALLOW = new Set([
    'landing_crear_chat_v2',
    'panel_nodo_send_chat_message',
    'panel_v15_5_listar_solicitudes_portal',
    'panel_v15_5_actualizar_solicitud_portal',
    'landing_retiro_registrar_parcial',
    // Sólo lectura: devuelve cómo va un retiro por partes. Faltaba, y el panel la pide para saber
    // si un retiro que dejó de venir en la lista ya se saldó o lo cerraron. Como no estaba, main
    // devolvía RPC_NO_PERMITIDA, el panel se lo comía en un catch vacío y el retiro se conservaba
    // local PARA SIEMPRE: en P1 seguían dando vueltas cuatro de agosto y septiembre, uno con $1
    // pendiente. O sea que el arreglo de D-109 —"antes de sostenerla se le pregunta a la base cómo
    // está"— nunca llegó a preguntar nada en producción (2/10).
    'landing_retiro_progreso',
    // Señal barata de la bandeja: 125 bytes y 24 ms, contra 246 kB y 310 ms de traerla entera.
    // Permite mirar cada 10 s si cambió algo sin bajar la lista: sólo se baja cuando de verdad
    // hay novedad. Sin esto, refrescar cada 10 s serían ~700 MB por turno (2/10).
    'panel_bandeja_senal',
    'panel_core_get_chat_sesiones_json',
    'panel_v154_plus_listar_chat_sesiones',
    'panel_core_get_chat_mensajes_json',
    'panel_chat_ack_leido',
    'panel_v154_plus_get_chat_mensajes',
    'panel_core_enviar_chat_json',
    'panel_v154_plus_enviar_chat',
    // CRM · reconexión y prevalidación (v1.1.61)
    'panel_reconexion_cola',
    'panel_reconexion_marcar',
    'panel_reconexion_unificar',
    'panel_reconexion_limpiar_seguros',
    'panel_dormidos',
    'panel_crm_perfil_v1',
    'panel_telefonos_de_usuario',
    'panel_v14_cerrar_chat_json',
    'panel_v14_reabrir_chat_json',
    'panel_guardar_datos_retiro',
    'panel_usuarios_contacto',
    'panel_prevalidar_usuario'
  ]);

  ipcMain.handle('panel:rpc', async (_event, arg1, arg2 = {}) => {
    let fn = arg1;
    let params = arg2 || {};

    if (arg1 && typeof arg1 === "object") {
      fn = arg1.fn || arg1.function || arg1.rpc || arg1.name || arg1.procedure;
      params = arg1.params || arg1.payload || arg1.args || {};
    }

    if (!fn || typeof fn !== "string") {
      return { data: null, error: { message: "RPC_INVALID_FN", details: { received: arg1 } } };
    }

    if(BETA_RPC_PARAMS.has(fn)) return betaRpc(fn, params);

    if (!PANEL_RPC_ALLOW.has(fn)) {
      console.warn('[panel:rpc] RPC no permitida:', fn);
      return { data: null, error: { message: "RPC_NO_PERMITIDA: " + fn } };
    }

    return await panelRpcRestFetchV154Plus(fn, params || {});
  });

  ipcMain.handle('panel:ping' , async () => ({
    ok: true,
    bridge: "panelAPI",
    version: "V15",
    ts: new Date().toISOString()
  }));

  ipcMain.handle('panel:get-context', async () => ({
    ok: true,
    pc_codigo:     env.PC_CODIGO || env.LANDING_PC_CODIGO || "",
    landing_pc:    env.LANDING_PC_CODIGO || env.PC_CODIGO || "",
    session_id:    Number(env.PANEL_SESSION_ID || 0),
    chunior_pt_id: env.CHUNIOR_PT_ID || null,
    operador_usuario: env.OPERADOR_USUARIO || "",
    operador_nombre:  env.OPERADOR_NOMBRE  || "",
    beta: publicBetaContext(resolveBetaConfig()),
    // PRODUCCIÓN: ya NO se exponen supabase_url/supabase_key acá (el renderer no los usa; tiene su
    // propio cliente con la anon key PÚBLICA). Lo ideal es migrar más lecturas a panelAPI.rpc.
  }));

  return { rpc: panelRpcRestFetchV154Plus };
}

module.exports = { registerPanelIpc };
