const { registrarMovimientoChunior } = require("../chunior-bridge");
const { parsePayload, safeError } = require("../shared/utils");

class WorkerSync {
  constructor({ config, supabase, jobs, chunior, emitStatus }) {
    this.config = config;
    this.supabase = supabase;
    this.jobs = jobs;
    this.chunior = chunior;
    this.emitStatus = emitStatus || (() => {});
    this.timer = null;
    this.busy = false;
    this.workerId = config.workerSyncId || "pc4-sync-01";
  }

  start() {
    if (this.timer) return { ok: true, mensaje: "Worker Sync ya iniciado" };
    const interval = Number(this.config.intervalMsSync || 2500);
    this.timer = setInterval(() => this.tick().catch(console.error), interval);
    setTimeout(() => this.tick().catch(console.error), 600);
    this.emit("ACTIVO", "Worker Sync iniciado");
    return { ok: true, mensaje: "Worker Sync iniciado", interval };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit("DETENIDO", "Worker Sync detenido");
    return { ok: true, mensaje: "Worker Sync detenido" };
  }

  emit(estado, mensaje, extra = {}) {
    this.emitStatus({ worker: "SYNC", workerId: this.workerId, estado, mensaje, ...extra });
  }

  async tick() {
    if (this.busy) return { ok: false, mensaje: "Worker Sync ocupado" };
    this.busy = true;

    try {
      await this.jobs.heartbeat(this.workerId, "SYNC", null, { loop: "sync" });

      const job = await this.jobs.tomarSync();
      if (!job) {
        this.emit("SIN_JOBS", "Sin jobs sync pendientes");
        return { ok: true, mensaje: "Sin jobs sync pendientes" };
      }

      this.emit("PROCESANDO", `Job sync ${job.id}`, { jobId: job.id, tipo: job.tipo_job });
      const result = await this.procesar(job);
      return { ok: true, jobId: job.id, result };

    } catch (error) {
      this.emit("ERROR", safeError(error));
      return { ok: false, error: safeError(error) };
    } finally {
      this.busy = false;
    }
  }

  async procesar(job) {
    const payload = parsePayload(job.payload);
    const tipo = String(job.tipo_job || payload.tipo_job || "").toUpperCase();

    try {
      await this.jobs.procesando(job.id, this.workerId, "SYNC_PROCESANDO");

      if (tipo === "REGISTRAR_CHUNIOR") {
        const origen = payload.payload_origen || {};
        const resultadoOrigen = payload.resultado_origen || {};
        const usuario = payload.usuario || origen.usuario || origen.alias || "";
        const monto = Number(payload.monto ?? origen.monto ?? origen.amount ?? 0);
        const tipoAccion = payload.tipo_accion || payload.tipo_job_origen || origen.tipo_accion || origen.accion || "REGISTRAR_CHUNIOR";

        const r = await registrarMovimientoChunior({
          supabase: this.supabase,
          config: {
            ...this.config,
            workerId: this.workerId
          },
          job: {
            ...job,
            ...origen,
            solicitud_id: payload.solicitud_id || origen.solicitud_id || null,
            billetera_id: payload.billetera_id || origen.billetera_id || null
          },
          tipo: tipoAccion,
          usuario,
          monto,
          agentesDetalle: payload.agentes_resultado || resultadoOrigen?.agentes || {},
          agentesResultado: resultadoOrigen?.accionPrincipal || payload.accion_principal || null
        });

        const etapaFinal = r?.estado === "DESACTIVADO" ? "SYNC_CHUNIOR_DESACTIVADO" : "SYNC_CHUNIOR_OK";
        await this.jobs.ok(job.id, this.workerId, { chunior: r, origen: payload.job_origen_id || null }, etapaFinal);
        return { ok: true, tipo, chunior: r, etapaFinal };
      }

      if (tipo === "SYNC_SALDO_BILLETERA") {
        const saldoAgente = Number(payload.saldo_agente ?? payload.saldoAgente ?? 0);
        const saldoFichas = Number(payload.saldo_fichas ?? payload.saldoFichas ?? saldoAgente);
        const saldoTexto  = String(payload.saldo_texto ?? payload.saldoTexto ?? saldoAgente ?? "");
        const usuarioJugador = payload.usuario ?? payload.usuario_jugador ?? null;

        const r = await this.jobs.guardarSaldoAgente({
          jobId: job.id,
          solicitudId: job.solicitud_id,
          tipoJob: "SYNC_SALDO_BILLETERA",
          usuarioJugador,
          saldoAgente,
          saldoFichas,
          saldoTexto,
          estado: "OK"
        });

        await this.jobs.ok(job.id, this.workerId, { saldoAgente, saldoFichas, r }, "SYNC_SALDO_OK");
        return { ok: true, tipo, saldoAgente, saldoFichas };
      }

      if (tipo === "SYNC_MASIVO_BILLETERAS") {
        const wallets = Array.isArray(payload.wallets) ? payload.wallets : [];
        if (!wallets.length) {
          await this.jobs.ok(job.id, this.workerId, {
            mensaje: "Sin wallets en payload; sync omitido."
          }, "SYNC_MASIVO_SIN_DATOS");
          return { ok: true, tipo, sinDatos: true };
        }

        const r = await this.jobs.syncChuniorWallets(wallets);
        await this.jobs.ok(job.id, this.workerId, { wallets: wallets.length, r }, "SYNC_MASIVO_OK");
        return { ok: true, tipo, wallets: wallets.length };
      }

      if (tipo === "CONCILIACION_GENERAL") {
        // La conciliación completa requiere session_token del panel (panel_operativo_conciliar_movimientos_worker).
        // El worker registra los jobs recientes para auditoría y marca como completado.
        const recientes = await this.jobs.listarJobsRecientes(50);
        await this.jobs.ok(job.id, this.workerId, {
          jobs_auditados: Array.isArray(recientes) ? recientes.length : 0,
          nota: "Conciliación de auditoría OK. Para conciliación monetaria completa usar panel_operativo_conciliar_movimientos_worker desde el panel."
        }, "CONCILIACION_AUDITORIA_OK");
        return { ok: true, tipo, jobsAuditados: Array.isArray(recientes) ? recientes.length : 0 };
      }

      if (tipo === "ACTUALIZAR_HISTORIAL") {
        const recientes = await this.jobs.listarJobsRecientes(Number(payload.limit ?? 30));
        await this.jobs.ok(job.id, this.workerId, {
          historial_jobs: Array.isArray(recientes) ? recientes.length : 0
        }, "HISTORIAL_OK");
        return { ok: true, tipo, historialJobs: Array.isArray(recientes) ? recientes.length : 0 };
      }

      throw new Error(`Tipo de job sync no soportado: ${tipo}`);

    } catch (error) {
      await this.jobs.error(job.id, this.workerId, error, "ERROR_SYNC");
      throw error;
    }
  }
}

module.exports = { WorkerSync };
