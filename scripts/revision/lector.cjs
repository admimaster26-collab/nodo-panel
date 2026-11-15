'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════
// LECTOR DE TRANSFERENCIAS · AdsPower + CDP, SÓLO LECTURA
//
// Para qué: hoy el saldo real del banco lo declara una persona a mano, así que cuando sobra
// plata se sabe que sobra pero no CUÁL transferencia es. Esto lee la lista de movimientos de
// la cuenta en el navegador que el operador ya tiene abierto, y devuelve cada transferencia
// con su id, quién la mandó, cuánto y a qué hora. Con eso se puede decir "la 2ª de las 20 del
// turno no la reclamó nadie" en vez de "sobran $X".
//
// LO QUE NO HACE, A PROPÓSITO (decisión de Juan, 14/11):
//   · NO abre perfiles de AdsPower. Si el perfil está cerrado, no hay lectura y se informa.
//   · NO navega ni cambia de pestaña. Lee la pestaña que YA está en la página de movimientos.
//   · NO escribe, no clickea, no toca formularios. Es un lector.
// Un operador trabajando no se tiene que enterar de que esto corrió.
//
// CÓMO ENCUENTRA EL NAVEGADOR:
//   1. AdsPower levanta una API local en 127.0.0.1:50325 (sólo con el cliente de escritorio
//      abierto). GET /status dice si está viva.
//   2. GET /api/v1/browser/active?user_id=XXX dice si ese perfil está abierto y devuelve el
//      puerto de depuración.
//   3. Con el puerto: GET http://127.0.0.1:<puerto>/json/list lista las pestañas, y por
//      WebSocket (CDP Runtime.evaluate) se lee el DOM de la que interesa.
// La API de AdsPower pide no más de un request por segundo: hay una espera entre llamadas.
//
// VERIFICADO / NO VERIFICADO: esta PC no tiene AdsPower (ni proceso, ni carpeta, ni el puerto
// 50325 escuchando), así que la forma exacta de las respuestas de AdsPower NO está verificada
// acá. Por eso existe el modo sonda: informa qué contestó cada cosa sin guardar nada, y una
// corrida en P4 confirma todo de una. El CDP y el extractor sí se prueban acá contra Chrome.
// ══════════════════════════════════════════════════════════════════════════════════════════

const ADS = process.env.ADSPOWER_API || 'http://127.0.0.1:50325';
const PAUSA_ADS = 1100;   // la API local pide 1 request/segundo
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function traer(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (_e) {}
    return { ok: r.ok, status: r.status, json: j, texto: j ? null : txt.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String((e && e.message) || e).slice(0, 160) };
  } finally { clearTimeout(t); }
}

// ── AdsPower ───────────────────────────────────────────────────────────────────────────────
async function adsVivo() {
  const r = await traer(ADS + '/status', 5000);
  if (!r.ok || !r.json) {
    return { vivo: false, motivo: r.error ? 'no contesta: ' + r.error : 'respondio ' + r.status };
  }
  // AdsPower contesta { code: 0, msg: "success" } cuando está bien.
  return { vivo: Number(r.json.code) === 0, motivo: String(r.json.msg || ''), crudo: r.json };
}

// Los perfiles que AdsPower tiene cargados. Se queda SÓLO con los campos de identificación:
// la respuesta de AdsPower puede traer contraseñas guardadas y datos del proxy, y eso no se
// loguea, no se guarda y no se manda a ninguna parte.
function perfilLimpio(p) {
  return {
    user_id: String(p.user_id || ''),
    nombre: String(p.name || ''),
    serial: p.serial_number != null ? String(p.serial_number) : '',
    grupo: String(p.group_name || ''),
    nota: String(p.remark || '').slice(0, 120)
  };
}

async function adsPerfiles(maxPaginas = 5) {
  const out = [];
  for (let pag = 1; pag <= maxPaginas; pag++) {
    const r = await traer(ADS + '/api/v1/user/list?page=' + pag + '&page_size=100');
    if (!r.ok || !r.json || Number(r.json.code) !== 0) {
      const motivo = r.json ? String(r.json.msg || ('code ' + r.json.code)) : (r.error || ('status ' + r.status));
      return { ok: false, motivo: motivo, perfiles: out };
    }
    const d = r.json.data || {};
    const lista = Array.isArray(d) ? d : (d.list || []);
    if (!Array.isArray(lista) || !lista.length) break;
    for (const p of lista) out.push(perfilLimpio(p));
    if (lista.length < 100) break;
    await espera(PAUSA_ADS);
  }
  return { ok: true, perfiles: out };
}

// ¿Está abierto ESTE perfil? No lo abre: sólo pregunta.
async function adsActivo(userId) {
  const r = await traer(ADS + '/api/v1/browser/active?user_id=' + encodeURIComponent(userId));
  if (!r.ok || !r.json) return { abierto: false, motivo: r.error || ('status ' + r.status) };
  if (Number(r.json.code) !== 0) return { abierto: false, motivo: String(r.json.msg || ('code ' + r.json.code)) };
  const d = r.json.data || {};
  const abierto = String(d.status || '').toLowerCase() === 'active';
  // El puerto de depuración viene como debug_port, o se saca del ws de puppeteer.
  let puerto = (d.debug_port != null && d.debug_port !== '') ? String(d.debug_port) : '';
  let ws = '';
  if (d.ws && typeof d.ws === 'object') ws = String(d.ws.puppeteer || d.ws.selenium || '');
  else if (typeof d.ws === 'string') ws = d.ws;
  if (!puerto && ws) { const m = ws.match(/:(\d+)\//); if (m) puerto = m[1]; }
  return { abierto: abierto, puerto: puerto, ws: ws, crudo_claves: Object.keys(d) };
}

// ── CDP, con el WebSocket nativo de Node (no hace falta ninguna dependencia) ───────────────
async function pestanas(puerto) {
  const r = await traer('http://127.0.0.1:' + puerto + '/json/list', 6000);
  if (!r.ok || !Array.isArray(r.json)) {
    return { ok: false, motivo: r.error || ('status ' + r.status), pestanas: [] };
  }
  const ps = r.json
    .filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    .map((t) => ({ id: String(t.id || ''), url: String(t.url || ''), titulo: String(t.title || ''), ws: String(t.webSocketDebuggerUrl) }));
  return { ok: true, pestanas: ps };
}

// Evalúa una expresión en una pestaña y devuelve el valor. NO navega ni enfoca la pestaña:
// Runtime.evaluate no mueve nada de lo que el operador está viendo.
function evaluar(wsUrl, expresion, ms = 15000) {
  return new Promise((resolve) => {
    let ws = null, listo = false;
    const cerrar = (res) => {
      if (listo) return;
      listo = true;
      try { if (ws) ws.close(); } catch (_e) {}
      resolve(res);
    };
    const t = setTimeout(() => cerrar({ ok: false, motivo: 'timeout de CDP' }), ms);
    try { ws = new WebSocket(wsUrl); }
    catch (e) { clearTimeout(t); return cerrar({ ok: false, motivo: String((e && e.message) || e) }); }
    ws.onerror = (e) => { clearTimeout(t); cerrar({ ok: false, motivo: 'websocket: ' + String((e && e.message) || 'error') }); };
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1, method: 'Runtime.evaluate',
        params: { expression: expresion, returnByValue: true, awaitPromise: true }
      }));
    };
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch (_e) { return; }
      if (m.id !== 1) return;
      clearTimeout(t);
      if (m.error) return cerrar({ ok: false, motivo: String(m.error.message || 'error de CDP') });
      const r = m.result || {};
      if (r.exceptionDetails) {
        return cerrar({ ok: false, motivo: 'la pagina tiro: ' + String(r.exceptionDetails.text || '').slice(0, 160) });
      }
      cerrar({ ok: true, valor: r.result ? r.result.value : null });
    };
  });
}

module.exports = { ADS, PAUSA_ADS, espera, traer, adsVivo, adsPerfiles, adsActivo, pestanas, evaluar };
