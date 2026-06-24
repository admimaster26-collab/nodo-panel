const { safeError } = require("../shared/utils");

class JobsService {
  constructor({ supabase, config }) {
    this.supabase = supabase;
    this.config = config;
  }

  async heartbeat(workerId, workerTipo, queueName = null, meta = {}) {
    const { data, error } = await this.supabase.rpc("worker_heartbeat", {
      p_worker_id: workerId,
      p_pc_codigo: this.config.pcCodigo,
      p_worker_tipo: workerTipo,
      p_queue_name: queueName,
      p_meta: meta
    });
    if (error) console.warn("[heartbeat]", error.message);
    return data;
  }

  async tomarOperativo() {
    const { data, error } = await this.supabase.rpc("tomar_job_operativo", {
      p_pc_codigo: this.config.pcCodigo,
      p_worker_id: this.config.workerOperativoId,
      p_lock_seconds: 120
    });
    if (error) throw new Error("Error tomando job operativo: " + error.message);
    return Array.isArray(data) ? (data[0] || null) : (data || null);
  }

  async tomarSync() {
    const { data, error } = await this.supabase.rpc("tomar_job_sync", {
      p_pc_codigo: this.config.pcCodigo,
      p_worker_id: this.config.workerSyncId,
      p_lock_seconds: 180
    });
    if (error) throw new Error("Error tomando job sync: " + error.message);
    return Array.isArray(data) ? (data[0] || null) : (data || null);
  }

  async procesando(jobId, workerId, etapa = "EJECUTANDO") {
    const { data, error } = await this.supabase.rpc("marcar_job_procesando", {
      p_job_id: Number(jobId),
      p_worker_id: workerId,
      p_etapa: etapa
    });
    if (error) throw new Error("Error marcando procesando: " + error.message);
    return data;
  }

  async ok(jobId, workerId, resultado = {}, etapa = "FINALIZADO") {
    const { data, error } = await this.supabase.rpc("marcar_job_ok", {
      p_job_id: Number(jobId),
      p_worker_id: workerId,
      p_resultado: resultado,
      p_etapa: etapa
    });
    if (error) throw new Error("Error marcando OK: " + error.message);
    return data;
  }

  async okParcial(jobId, workerId, resultado = {}, resumen = "", detalle = "", etapa = "OK_PARCIAL") {
    const { data, error } = await this.supabase.rpc("marcar_job_ok_parcial", {
      p_job_id: Number(jobId),
      p_worker_id: workerId,
      p_resultado: resultado,
      p_error_resumen: resumen,
      p_error_detalle: detalle,
      p_etapa: etapa
    });
    if (error) throw new Error("Error marcando OK_PARCIAL: " + error.message);
    return data;
  }

  async error(jobId, workerId, error, etapa = "ERROR") {
    const msg = safeError(error);
    const { data, error: rpcError } = await this.supabase.rpc("marcar_job_error", {
      p_job_id: Number(jobId),
      p_worker_id: workerId,
      p_error_resumen: msg.slice(0, 500),
      p_error_detalle: msg,
      p_etapa: etapa
    });
    if (rpcError) throw new Error("Error marcando ERROR: " + rpcError.message);
    return data;
  }

  async crearSyncDesdeOperativo(jobOrigenId, tipoJob = "REGISTRAR_CHUNIOR", payloadExtra = {}, prioridad = 50) {
    const { data, error } = await this.supabase.rpc("crear_job_sync_desde_operativo", {
      p_job_origen_id: Number(jobOrigenId),
      p_tipo_job: tipoJob,
      p_payload_extra: payloadExtra,
      p_prioridad: prioridad
    });
    if (error) throw new Error("Error creando job sync: " + error.message);
    return data;
  }

  async debugTomarOperativo(workerId = "debug-panel") {
    // V1.4.1: debug seguro vía RPC security definer.
    // No toma/lockea jobs reales. Solo lista pendientes.
    const { data, error } = await this.supabase.rpc("debug_listar_jobs_operativos_pendientes", {
      p_pc_codigo: this.config.pcCodigo,
      p_limit: 10
    });

    if (error) {
      return { ok: false, error: error.message, data: null };
    }

    return {
      ok: true,
      modo: "SOLO_LECTURA_RPC_NO_TOMA_JOB",
      pcCodigo: this.config.pcCodigo,
      workerId,
      encontroJob: Array.isArray(data) && data.length > 0,
      cantidad: Array.isArray(data) ? data.length : 0,
      jobs: data || []
    };
  }


  async errorFinal(jobId, workerId, error, etapa = "ERROR_CONTROL_MANUAL") {
    const msg = safeError(error);
    const { data, error: rpcError } = await this.supabase.rpc("marcar_job_error_final", {
      p_job_id: Number(jobId),
      p_worker_id: workerId,
      p_error_resumen: msg.slice(0, 500),
      p_error_detalle: msg,
      p_etapa: etapa
    });
    if (rpcError) throw new Error("Error marcando ERROR FINAL: " + rpcError.message);
    return data;
  }

  async liberarVencidos() {
    const { data, error } = await this.supabase.rpc("liberar_jobs_vencidos", {
      p_pc_codigo: this.config.pcCodigo
    });
    if (error) console.warn("[liberar vencidos]", error.message);
    return data;
  }

  async guardarSaldoAgente({ jobId, solicitudId, tipoJob, usuarioJugador, saldoAgente, saldoFichas, saldoTexto, estado, errorMsg }) {
    const { data, error } = await this.supabase.rpc("worker_guardar_saldo_agente", {
      p_worker_id: this.config.workerSyncId || this.config.workerOperativoId || "worker-01",
      p_pc_codigo: this.config.pcCodigo,
      p_operador: this.config.operador || this.config.pcCodigo,
      p_job_id: jobId ? Number(jobId) : null,
      p_solicitud_id: solicitudId ? Number(solicitudId) : null,
      p_tipo_job: tipoJob || "SYNC_SALDO_BILLETERA",
      p_usuario_jugador: usuarioJugador || null,
      p_saldo_agente: Number(saldoAgente || 0),
      p_saldo_fichas: Number(saldoFichas ?? saldoAgente ?? 0),
      p_saldo_detectado_texto: String(saldoTexto || ""),
      p_estado: estado || "OK",
      p_error: errorMsg || null
    });
    if (error) throw new Error("Error guardando saldo agente: " + error.message);
    return data;
  }

  async syncChuniorWallets(wallets = []) {
    const { data, error } = await this.supabase.rpc("panel_nodo_sync_chunior_wallets", {
      p_pc_codigo: this.config.pcCodigo,
      p_wallets: wallets
    });
    if (error) throw new Error("Error sincronizando wallets Chunior: " + error.message);
    return data;
  }

  async listarJobsRecientes(limit = 20) {
    const { data, error } = await this.supabase.rpc("panel_listar_jobs_recientes", {
      p_pc_codigo: this.config.pcCodigo,
      p_limit: limit
    });
    if (error) throw new Error("Error listando jobs recientes: " + error.message);
    return data;
  }
}

module.exports = { JobsService };
