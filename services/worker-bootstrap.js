// ============================================================
// NODO · WORKER BOOTSTRAP (cola de jobs)
// ============================================================
// Cablea los workers de cola (operativo + sync) dentro del proceso
// principal de Electron, SIN tocar el flujo on-demand existente.
//
// SEGURIDAD / DISEÑO:
// - Interruptor maestro: WORKERS_ENABLED=1 en .env. Si no está, NO hace nada.
// - Por worker: AUTO_START_OPERATIVO / AUTO_START_SYNC (1 para arrancar).
// - Todo está envuelto para que un fallo del worker NO afecte al panel.
// - No modifica el agente on-demand; cuando se active, hay que resolver
//   que use UNA sola ventana de backoffice (ver nota WINDOW_SHARING abajo).
// ============================================================

const { createSupabase } = require("./supabase");
const { JobsService } = require("./jobs");
const { AgentesService } = require("./agentes");
const { ChuniorService } = require("./chunior");
const { WorkerOperativo } = require("./worker-operativo");
const { WorkerSync } = require("./worker-sync");

function envBool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  return ["1", "true", "si", "sí", "yes", "on"].includes(String(v).trim().toLowerCase());
}

function buildConfig(env) {
  return {
    supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    panelDataSecret: env.PANEL_DATA_SECRET || "nodo-panel-data-2026",
    pcCodigo: env.PC_CODIGO || env.LANDING_PC_CODIGO || "P1",
    operador: env.OPERADOR || env.PC_CODIGO || "",
    workerOperativoId: env.WORKER_OPERATIVO_ID || "operativo-01",
    workerSyncId: env.WORKER_SYNC_ID || "sync-01",
    intervalMsOperativo: Number(env.INTERVAL_MS_OPERATIVO || 4000),
    intervalMsSync: Number(env.INTERVAL_MS_SYNC || 2500),
    automationTimeoutMs: Number(env.AUTOMATION_TIMEOUT_MS || 45000),
    buscarUsuarioTimeoutMs: Number(env.BUSCAR_USUARIO_TIMEOUT_MS || 60000),
    maxBusyMsOperativo: Number(env.MAX_BUSY_MS_OPERATIVO || 25000),
    agentLoginUrl: env.AGENT_LOGIN_URL || "",
    agentSearchUrl: env.AGENT_SEARCH_URL || "",
    agentNewUserUrl: env.AGENT_NEW_USER_URL || "",
    chuniorUrl: env.CHUNIOR_URL || "",
    chuniorMovimientosUrl: env.CHUNIOR_MOVIMIENTOS_URL || "",
    chuniorWindowVisible: envBool(env.CHUNIOR_WINDOW_VISIBLE, false)
  };
}

/**
 * Inicializa los workers. Devuelve un resumen y handles para control posterior.
 * NO arranca nada si WORKERS_ENABLED != 1.
 */
function initWorkers({ BrowserWindow, path, env = process.env, pendingAutomation } = {}) {
  if (!envBool(env.WORKERS_ENABLED, false)) {
    return { started: false, reason: "WORKERS_ENABLED!=1", resumen: "workers desactivados" };
  }
  if (!BrowserWindow || !path) {
    return { started: false, reason: "faltan BrowserWindow/path", resumen: "no se pudo inicializar" };
  }

  const config = buildConfig(env);
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return { started: false, reason: "falta supabaseUrl/anonKey", resumen: "config Supabase incompleta" };
  }

  const supabase = createSupabase(config);
  const jobs = new JobsService({ supabase, config });

  const emitStatus = (s) => {
    try { console.log("[worker]", s.worker, s.estado, s.mensaje || ""); } catch (_e) {}
  };

  const agentes = new AgentesService({
    BrowserWindow,
    path,
    config,
    pendingAutomation: pendingAutomation || new Map()
  });
  const chunior = new ChuniorService({ BrowserWindow, config });

  const operativo = new WorkerOperativo({ config, jobs, agentes, emitStatus });
  const sync = new WorkerSync({ config, supabase, jobs, chunior, emitStatus });

  const startedList = [];
  if (envBool(env.AUTO_START_OPERATIVO, false)) {
    try { operativo.start(); startedList.push("OPERATIVO"); }
    catch (e) { console.error("[worker] no arrancó OPERATIVO:", e && e.message); }
  }
  if (envBool(env.AUTO_START_SYNC, false)) {
    try { sync.start(); startedList.push("SYNC"); }
    catch (e) { console.error("[worker] no arrancó SYNC:", e && e.message); }
  }

  return {
    started: true,
    resumen: startedList.length ? ("arrancados: " + startedList.join(", ")) : "instanciados, ninguno auto-start",
    config: { pcCodigo: config.pcCodigo, workerOperativoId: config.workerOperativoId, workerSyncId: config.workerSyncId },
    handles: { operativo, sync, jobs, agentes, chunior, supabase }
  };
}

module.exports = { initWorkers, buildConfig };
