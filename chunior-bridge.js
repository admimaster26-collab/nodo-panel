const path = require("node:path");

function cleanText(value) {
  return String(value ?? "").trim();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch (_error) {
    return {};
  }
}

function buildPayload({ job, tipo, usuario, monto, agentesDetalle, agentesResultado }) {
  return {
    worker_job_id: job?.id ? Number(job.id) : null,
    solicitud_id: job?.solicitud_id ? Number(job.solicitud_id) : null,
    pc_codigo: cleanText(job?.pc_codigo),
    operador: cleanText(job?.operador || job?.creado_por),
    usuario,
    tipo_accion: tipo,
    monto,
    billetera_id: job?.billetera_id ? Number(job.billetera_id) : null,
    agentes_resultado: agentesResultado,
    agentes_detalle: jsonSafe(agentesDetalle)
  };
}

async function registrarChuniorSync(supabase, config, payload, estado, extra = {}) {
  if (!supabase?.rpc) return { ok: false, error: "Supabase no disponible" };

  const { data, error } = await supabase.rpc("worker_registrar_chunior_sync", {
    p_worker_id: cleanText(config.workerId),
    p_worker_job_id: payload.worker_job_id,
    p_pc_codigo: cleanText(config.pcCodigo || payload.pc_codigo),
    p_operador: cleanText(payload.operador || config.operador || config.workerId),
    p_usuario: payload.usuario,
    p_tipo_accion: payload.tipo_accion,
    p_monto: payload.monto,
    p_billetera_id: payload.billetera_id,
    p_solicitud_id: payload.solicitud_id,
    p_chunior_estado: estado,
    p_chunior_movimiento_id: extra.chuniorMovimientoId || null,
    p_chunior_payload: jsonSafe({ ...payload, ...extra }),
    p_agentes_resultado: payload.agentes_resultado || null,
    p_error_mensaje: extra.error || null
  });

  if (error) return { ok: false, error: error.message || String(error) };
  return Array.isArray(data) ? data[0] : data;
}

async function registrarMovimientoChunior({ supabase, config, job, tipo, usuario, monto, agentesDetalle, agentesResultado }) {
  const payload = buildPayload({ job, tipo, usuario, monto: asNumber(monto), agentesDetalle, agentesResultado });

  if (!config.chuniorEnabled) {
    // V1.4.7 LIMPIA:
    // Si Chunior está desactivado, NO llamamos RPC de Chunior.
    // Esto evita errores de schema cache cuando la función no existe todavía.
    return {
      ok: true,
      estado: "DESACTIVADO",
      omitido: true,
      mensaje: "Chunior desactivado; sync omitido correctamente.",
      payload
    };
  }

  if (!cleanText(config.chuniorLoginUrl) || !cleanText(config.chuniorMovimientosUrl)) {
    const error = "Falta configurar chuniorLoginUrl/chuniorMovimientosUrl.";
    const sync = await registrarChuniorSync(supabase, config, payload, "PENDIENTE_CONFIG", {
      error,
      userDataDir: path.basename(cleanText(config.chuniorUserDataDir || "user-data-chunior"))
    }).catch(err => ({ ok: false, error: err.message || String(err) }));

    return {
      ok: false,
      estado: "PENDIENTE_CONFIG",
      error,
      sync
    };
  }

  const error = "Automatizacion Chunior pendiente: falta mapear login y formulario de movimientos.";
  const sync = await registrarChuniorSync(supabase, config, payload, "PENDIENTE_AUTOMATIZACION", {
    error,
    chuniorLoginUrl: cleanText(config.chuniorLoginUrl),
    chuniorMovimientosUrl: cleanText(config.chuniorMovimientosUrl),
    userDataDir: path.basename(cleanText(config.chuniorUserDataDir || "user-data-chunior"))
  }).catch(err => ({ ok: false, error: err.message || String(err) }));

  return {
    ok: false,
    estado: "PENDIENTE_AUTOMATIZACION",
    error,
    sync
  };
}

module.exports = {
  registrarMovimientoChunior
};
