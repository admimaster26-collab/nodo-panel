'use strict';

function registerOfficeCredentialsIpc({ ipcMain, automation, proxy, env = process.env, fetch = globalThis.fetch }) {
  async function applyProxyForOffice(pcCodigo, { resetOnMissing = true, timeoutMs = 0 } = {}) {
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
      const anon = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
      const secret = env.PANEL_DATA_SECRET;
      if (!secret) {
        console.warn("[panel] Proxy no aplicado por missing-secret (falta PANEL_DATA_SECRET en .env). Salida directa; el panel sigue operativo.");
        if (resetOnMissing) await proxy.apply(null);
        return { ok: false, reason: 'missing-secret' };
      }
      const pc = String(pcCodigo || env.PC_CODIGO || '').trim();
      if (!url || !anon || !pc) return { ok: false, reason: 'config' };
      const requestOptions = {
        method: 'POST',
        headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_secret: secret, p_pc_codigo: pc })
      };
      if (controller) requestOptions.signal = controller.signal;
      const resp = await fetch(`${url}/rest/v1/rpc/panel_get_proxy`, requestOptions);
      const data = await resp.json().catch(() => null);
      if (!data || data.ok !== true) {
        if (!resetOnMissing) return { ok: false, reason: 'proxy-lookup-failed' };
        return await proxy.apply(null);
      }
      if (data.enabled !== true && !resetOnMissing) {
        return { ok: true, enabled: false, reason: 'unconfigured' };
      }
      return await proxy.apply({
        enabled: data.enabled === true,
        protocol: data.protocol, host: data.host, port: data.port,
        username: data.username, password: data.password, bypass: data.bypass
      });
    } catch (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  ipcMain.handle('drex:auto-login', async (_event, { pcCodigo } = {}) => {
    try {
      const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
      const anon = env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || '';
      const secret = env.PANEL_DATA_SECRET;
      if (!secret) { console.warn("[panel] Auto-login no disponible por missing-secret (falta PANEL_DATA_SECRET en .env). El panel sigue operativo para uso manual."); return { ok: false, reason: 'missing-secret' }; }
      const pc = String(pcCodigo || env.PC_CODIGO || '').trim();
      if (!url || !anon || !pc) return { ok: false, reason: 'config' };
      const resp = await fetch(`${url}/rest/v1/rpc/panel_get_agente_credenciales`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_secret: secret, p_pc_codigo: pc })
      });
      const data = await resp.json().catch(() => null);
      if (!data || data.ok !== true || !data.usuario || !data.clave) return { ok: false, reason: 'no-creds' };
      const r = await automation.send('iniciarSesion', data.usuario, data.clave);
      return (r && r.ok !== false) ? { ok: true } : { ok: false, reason: 'login-fail', detail: r };
    } catch (e) {
      return { ok: false, reason: (e && e.message) || String(e) };
    }
  });

  // Aplica el proxy de la oficina. La config (incluida la clave) se trae acá, en el main,
  // vía RPC con el secret del panel. NUNCA pasa por el renderer.
  ipcMain.handle('proxy:apply', async (_event, { pcCodigo } = {}) => applyProxyForOffice(pcCodigo));

  return { applyProxyForOffice };
}

module.exports = { registerOfficeCredentialsIpc };
