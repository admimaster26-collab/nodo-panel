const { jobData, safeError, withTimeout } = require("../shared/utils");

class WorkerOperativo {
  constructor({ config, jobs, agentes, emitStatus }) {
    this.config = config;
    this.jobs = jobs;
    this.agentes = agentes;
    this.emitStatus = emitStatus || (() => {});
    this.timer = null;
    this.busy = false;
    this.currentRun = null;
    this.workerId = config.workerOperativoId || "pc4-operativo-01";
    this.lastNoJobsAt = 0;
    this.busySince = null;
    this.stage = "IDLE";
    this.maxBusyMs = Number(config.maxBusyMsOperativo || 25000);
  }

  start() {
    if (this.timer) return { ok: true, mensaje: "Worker Operativo ya iniciado" };
    const interval = Number(this.config.intervalMsOperativo || 4000);
    this.timer = setInterval(() => this.tick("auto").catch(console.error), interval);
    setTimeout(() => this.tick("auto").catch(console.error), 800);
    this.emit("ACTIVO", "Worker Operativo iniciado");
    return { ok: true, mensaje: "Worker Operativo iniciado", interval };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit("DETENIDO", "Worker Operativo detenido");
    return { ok: true, mensaje: "Worker Operativo detenido" };
  }

  resetBusy(motivo = "reset manual") {
    this.busy = false;
    this.currentRun = null;
    this.busySince = null;
    this.stage = "IDLE_RESET";
    this.emit("BUSY_RESET", `Busy reseteado: ${motivo}`);
    return { ok: true, mensaje: "Busy Operativo reseteado", motivo };
  }

  estadoInterno() {
    return {
      ok: true,
      worker: "OPERATIVO",
      workerId: this.workerId,
      activo: !!this.timer,
      busy: this.busy,
      busySince: this.busySince,
      busyMs: this.busySince ? Date.now() - this.busySince : 0,
      stage: this.stage,
      maxBusyMs: this.maxBusyMs
    };
  }

  emit(estado, mensaje, extra = {}) {
    this.emitStatus({ worker: "OPERATIVO", workerId: this.workerId, estado, mensaje, stage: this.stage, ...extra });
  }

  async tick(origen = "manual") {
    if (this.busy) {
      const busyMs = this.busySince ? Date.now() - this.busySince : 0;
      if (busyMs > this.maxBusyMs) {
        this.emit("BUSY_VENCIDO", `Worker ocupado ${busyMs}ms en ${this.stage}. Se libera para evitar cuelgue.`);
        this.busy = false;
        this.currentRun = null;
        this.busySince = null;
        this.stage = "IDLE_AFTER_BUSY_TIMEOUT";
      } else {
        return { ok: false, mensaje: "Worker Operativo ocupado en ciclo actual", busy: true, busyMs, stage: this.stage, origen };
      }
    }

    this.busy = true;
    this.busySince = Date.now();
    this.currentRun = this._tickInterno(origen);

    try {
      return await this.currentRun;
    } finally {
      this.busy = false;
      this.currentRun = null;
      this.busySince = null;
      this.stage = "IDLE";
    }
  }

  async _tickInterno(origen) {
    try {
      this.stage = "LIBERAR_VENCIDOS";
      await withTimeout(this.jobs.liberarVencidos(), 8000, "liberar jobs vencidos");

      this.stage = "HEARTBEAT";
      await withTimeout(this.jobs.heartbeat(this.workerId, "OPERATIVO", null, { loop: "operativo", origen }), 8000, "heartbeat operativo");

      this.stage = "CHECK_SESSION_AGENTES";
      const session = await withTimeout(this.agentes.checkSession(), 12000, "check sesión Agentes");
      if (!session.ok) {
        this.emit("ESPERANDO_LOGIN_AGENTES", session.mensaje);
        return { ok: false, mensaje: session.mensaje, stage: this.stage };
      }

      this.stage = "TOMAR_JOB_OPERATIVO";
      const job = await withTimeout(this.jobs.tomarOperativo(), 12000, "tomar job operativo");

      if (!job) {
        const now = Date.now();
        if (now - this.lastNoJobsAt > 8000 || origen === "manual") {
          this.emit("SIN_JOBS", "Sin jobs operativos pendientes");
          this.lastNoJobsAt = now;
        }
        return { ok: true, mensaje: "Sin jobs operativos pendientes", stage: this.stage };
      }

      this.stage = `PROCESAR_JOB_${job.id}`;
      this.emit("PROCESANDO", `Job operativo ${job.id}`, { jobId: job.id, tipo: job.tipo_job });
      const result = await this.procesar(job);
      this.emit("CICLO_OK", `Job operativo ${job.id} procesado`, { jobId: job.id });
      return { ok: true, jobId: job.id, result };

    } catch (error) {
      this.emit("ERROR", safeError(error), { stage: this.stage });
      return { ok: false, error: safeError(error), stage: this.stage };
    }
  }

  async procesar(job) {
    const data = jobData(job);
    const { tipo, usuario, monto, clave } = data;

    if (!usuario) throw new Error("Job operativo sin usuario");

    const esCarga = ["CARGA_MANUAL", "CARGAR_FICHAS", "PROCESAR_CARGA", "CARGA_LANDING_APROBADA"].includes(tipo);
    const esRetiro = ["RETIRO_MANUAL", "RETIRO", "PROCESAR_RETIRO", "RETIRO_LANDING_APROBADO"].includes(tipo);
    const esMonetario = esCarga || esRetiro;

    try {
      const etapaInicial = tipo === "VALIDAR_USUARIO" ? "VALIDANDO_USUARIO_EN_AGENTES" : "ACCION_EN_AGENTES_INICIADA";
      await withTimeout(this.jobs.procesando(job.id, this.workerId, etapaInicial), 8000, "marcar acción iniciada");

      let r;
      let accionPrincipal = "";

      if (tipo === "VALIDAR_USUARIO") {
        this.stage = `VALIDAR_USUARIO_${job.id}`;
        r = await withTimeout(this.agentes.run("buscarUsuario", usuario), Number(this.config.buscarUsuarioTimeoutMs || 60000), "buscar usuario");
        if (!r?.existe) throw new Error(`Usuario no encontrado en Agentes: ${usuario}`);
        accionPrincipal = "VALIDAR_USUARIO_OK";
        await this.jobs.ok(job.id, this.workerId, { accionPrincipal, agentes: r }, "FINALIZADO");
        return { ok: true, accionPrincipal, agentes: r };
      }

      if (tipo === "CREAR_USUARIO") {
        if (!clave) throw new Error("Job CREAR_USUARIO sin clave");
        r = await withTimeout(this.agentes.runAt(this.agentes.NEW_USER_URL, "crearUsuario", usuario, clave), Number(this.config.automationTimeoutMs || 45000), "crear usuario");
        accionPrincipal = "CREAR_USUARIO_OK";
        await this.jobs.ok(job.id, this.workerId, { accionPrincipal, agentes: safePublicResult(r) }, "FINALIZADO");
        return { ok: true, accionPrincipal, agentes: safePublicResult(r) };
      }

      if (tipo === "CAMBIAR_CLAVE") {
        if (!clave) throw new Error("Job CAMBIAR_CLAVE sin clave");
        r = await withTimeout(this.agentes.run("cambiarClave", usuario, clave), Number(this.config.automationTimeoutMs || 45000), "cambiar clave");
        accionPrincipal = "CAMBIAR_CLAVE_OK";
        await this.jobs.ok(job.id, this.workerId, { accionPrincipal, agentes: safePublicResult(r) }, "FINALIZADO");
        return { ok: true, accionPrincipal, agentes: safePublicResult(r) };
      }

      if (esCarga) {
        if (!monto || monto <= 0) throw new Error("Monto inválido para carga");

        // Blindaje: desde este punto, si hay timeout/error, NO se reintenta automático.
        this.stage = `CARGA_EN_AGENTES_${job.id}`;
        r = await withTimeout(this.agentes.run("cargarFichas", usuario, monto), Number(this.config.automationTimeoutMs || 45000), "cargar fichas");
        accionPrincipal = "CARGA_OK_EN_AGENTES";

        const syncJobId = await this.jobs.crearSyncDesdeOperativo(job.id, "REGISTRAR_CHUNIOR", {
          accion_principal: accionPrincipal,
          usuario,
          monto,
          agentes_resultado: r || {}
        });

        await this.jobs.okParcial(
          job.id,
          this.workerId,
          { accionPrincipal, syncJobId, agentes: r || {} },
          "Acción principal OK; sync pendiente",
          "La carga fue ejecutada en Agentes. Worker Sync debe registrar Chunior/saldos.",
          "ACCION_OK_SYNC_PENDIENTE"
        );

        return { ok: true, accionPrincipal, syncJobId, agentes: r };
      }

      if (esRetiro) {
        const montoAbs = Math.abs(monto);
        if (!montoAbs || montoAbs <= 0) throw new Error("Monto inválido para retiro");

        // Blindaje: desde este punto, si hay timeout/error, NO se reintenta automático.
        this.stage = `RETIRO_EN_AGENTES_${job.id}`;
        r = await withTimeout(this.agentes.run("retirarFichas", usuario, montoAbs), Number(this.config.automationTimeoutMs || 45000), "retirar fichas");
        accionPrincipal = "RETIRO_OK_EN_AGENTES";

        const syncJobId = await this.jobs.crearSyncDesdeOperativo(job.id, "REGISTRAR_CHUNIOR", {
          accion_principal: accionPrincipal,
          usuario,
          monto: montoAbs,
          agentes_resultado: r || {}
        });

        await this.jobs.okParcial(
          job.id,
          this.workerId,
          { accionPrincipal, syncJobId, agentes: r || {} },
          "Acción principal OK; sync pendiente",
          "El retiro fue ejecutado en Agentes. Worker Sync debe registrar Chunior/saldos.",
          "ACCION_OK_SYNC_PENDIENTE"
        );

        return { ok: true, accionPrincipal, syncJobId, agentes: r };
      }

      throw new Error(`Tipo de job operativo no soportado: ${tipo}`);

    } catch (error) {
      if (esMonetario) {
        // Seguridad: si era carga/retiro, NO vuelve a cola.
        await this.jobs.errorFinal(
          job.id,
          this.workerId,
          error,
          "ERROR_CONTROL_MANUAL_NO_REINTENTAR_ACCION_MONETARIA"
        );
      } else {
        await this.jobs.error(job.id, this.workerId, error, "ERROR_OPERATIVO");
      }
      throw error;
    }
  }
}

function safePublicResult(r) {
  if (!r || typeof r !== "object") return r || null;
  const { password, clave, pass, ...rest } = r;
  return rest;
}

module.exports = { WorkerOperativo };
