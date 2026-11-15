'use strict';

function createProxyService({ app, session, env = process.env }) {
  function envBoolV15(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return ["1", "true", "si", "sí", "yes", "on"].includes(String(value).trim().toLowerCase());
  }

  function cleanProxyHost(rawHost) {
    return String(rawHost || "")
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim();
  }

  function buildProxyRules(rawHost, rawPort, rawProtocol) {
    const host = cleanProxyHost(rawHost);
    const port = String(rawPort || "").trim();
    const protocol = String(rawProtocol || "http").trim().toLowerCase();

    if (!host || !port) return "";

    if (protocol.startsWith("socks")) return `socks=${host}:${port}`;
    return `http=${host}:${port};https=${host}:${port}`;
  }

  function proxyRulesFromEnvV15() {
    if (!envBoolV15(env.PROXY_ENABLED, false)) return "";
    return buildProxyRules(env.PROXY_HOST, env.PROXY_PORT, env.PROXY_PROTOCOL || "http");
  }

  // El proxy está aislado de Supabase y de la sesión default. La config estática sigue siendo
  // exclusiva de Agentes; la config de oficina en runtime se aplica también a Chunior.
  const AGENT_PARTITION = 'persist:nodo-agentes';
  function agentSes() { return session.fromPartition(AGENT_PARTITION); }
  const CHUNIOR_PARTITION = 'nodo-chunior';
  function chuniorSes() { return session.fromPartition(CHUNIOR_PARTITION); }

  async function configurarProxyElectronV15() {
    const enabled = envBoolV15(env.PROXY_ENABLED, false);
    if (!enabled) {
      console.log("[proxy] DESACTIVADO");
      return { ok: true, enabled: false };
    }

    const proxyRules = proxyRulesFromEnvV15();
    if (!proxyRules) {
      console.warn("[proxy] Activado, pero falta PROXY_HOST / PROXY_PORT.");
      return { ok: false, enabled: true, error: "Falta PROXY_HOST / PROXY_PORT" };
    }

    // Proxy SOLO en la sesión de Agentes → no toca Chunior/Supabase.
    await agentSes().setProxy({
      mode: "fixed_servers",
      proxyRules,
      proxyBypassRules: env.PROXY_BYPASS_RULES || "<local>"
    });
    _proxyApplied = true;

    try { await agentSes().closeAllConnections(); } catch (_e) {}

    console.log("[proxy] ACTIVADO (sesión agentes):", proxyRules);
    return { ok: true, enabled: true, proxyRules };
  }

  // Proxy aplicado en RUNTIME: config por oficina, traída del admi tras el login en Chunior.
  let _runtimeProxyAuth = null; // {username, password} para el evento "login" del proxy
  let _proxyApplied = false;    // si hay un proxy fixed_servers activo
  async function aplicarProxyRuntime(cfg) {
    try {
      cfg = cfg || {};
      const rules = cfg.enabled ? buildProxyRules(cfg.host, cfg.port, cfg.protocol || "http") : "";
      if (!rules) {
        _runtimeProxyAuth = null;
        // Sin proxy: limpiamos ambas sesiones sólo si antes había uno activo.
        if (_proxyApplied) {
          const sessions = [agentSes(), chuniorSes()];
          await Promise.all(sessions.map(ses => ses.setProxy({ mode: "direct" })));
          await Promise.all(sessions.map(ses => ses.closeAllConnections().catch(() => {})));
          _proxyApplied = false;
          console.log("[proxy] runtime: limpiado (salida directa)");
        }
        return { ok: true, enabled: false };
      }
      // La config de oficina se comparte entre Agentes y Chunior, nunca con la sesión default.
      const sessions = [agentSes(), chuniorSes()];
      await Promise.all(sessions.map(ses => ses.setProxy({
        mode: "fixed_servers",
        proxyRules: rules,
        proxyBypassRules: cfg.bypass || "<local>"
      })));
      await Promise.all(sessions.map(ses => ses.closeAllConnections().catch(() => {})));
      _proxyApplied = true;
      _runtimeProxyAuth = cfg.username ? { username: String(cfg.username), password: String(cfg.password || "") } : null;
      console.log("[proxy] runtime ACTIVADO (Agentes y Chunior):", rules);
      return { ok: true, enabled: true, proxyRules: rules };
    } catch (e) {
      console.warn("[proxy] runtime error:", e.message);
      return { ok: false, error: e.message };
    }
  }

  app.on("login", (event, webContents, request, authInfo, callback) => {
    if (!authInfo?.isProxy) return;
    // Prioridad: creds de runtime (por oficina, traídas del admi). Fallback: .env.
    if (_runtimeProxyAuth && _runtimeProxyAuth.username) {
      event.preventDefault();
      callback(_runtimeProxyAuth.username, _runtimeProxyAuth.password || "");
      return;
    }
    if (envBoolV15(env.PROXY_ENABLED, false) && env.PROXY_USERNAME) {
      event.preventDefault();
      callback(String(env.PROXY_USERNAME || ""), String(env.PROXY_PASSWORD || ""));
    }
  });

  return { configure: configurarProxyElectronV15, apply: aplicarProxyRuntime, getSession: agentSes, partition: AGENT_PARTITION };
}

module.exports = { createProxyService };
