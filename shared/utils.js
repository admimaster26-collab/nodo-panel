function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function upper(value, fallback = "") {
  const v = cleanText(value || fallback);
  return v ? v.toUpperCase() : "";
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (_error) { return {}; }
  }
  return typeof raw === "object" ? raw : {};
}

function jobData(job = {}) {
  const payload = parsePayload(job.payload);
  return {
    payload,
    tipo: upper(job.tipo_job || job.tipo_accion || payload.tipo_job || payload.tipo_accion || payload.accion),
    usuario: cleanText(job.usuario || payload.usuario || payload.username || payload.alias),
    monto: numberOrNull(job.monto ?? payload.monto ?? payload.amount) ?? 0,
    clave: cleanText(payload.clave || payload.password || payload.pass),
    billeteraId: job.billetera_id || payload.billetera_id || payload.billeteraId || null,
    solicitudId: job.solicitud_id || payload.solicitud_id || payload.solicitudId || null
  };
}

function safeError(error) {
  if (!error) return "Error desconocido";
  return error.message || String(error);
}

function withTimeout(promise, ms, label = "operación") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout en ${label} (${ms}ms)`)), ms);
    })
  ]);
}

module.exports = { wait, cleanText, upper, numberOrNull, parsePayload, jobData, safeError, withTimeout };
