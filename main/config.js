'use strict';
const fs = require('node:fs');
const path = require('node:path');

function configureEnvironment({ app, rootDir, env = process.env, execPath = process.execPath }) {
  function cargarEnvLocalV15() {
    try {
      // NODO_ENV=p4 → lee .env.p4 ; sin NODO_ENV → lee .env.
      const envName = env.NODO_ENV ? (".env." + String(env.NODO_ENV).toLowerCase()) : ".env";
      // PRODUCCIÓN: en la app empaquetada rootDir está dentro del .asar (no se puede dejar un .env ahí).
      // Las credenciales por PC viven fuera del repo, en %LOCALAPPDATA%\NODO.
      // Como respaldo se busca en userData, junto al ejecutable y por último en rootDir (dev).
      const dirs = [];
      if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'NODO'));
      try { dirs.push(app.getPath('userData')); } catch (_e) {}
      try { dirs.push(path.dirname(execPath)); } catch (_e) {}
      dirs.push(rootDir);
      let envPath = "";
      for (const d of dirs) {
        const p1 = path.join(d, envName), p2 = path.join(d, ".env");
        if (fs.existsSync(p1)) { envPath = p1; break; }
        if (fs.existsSync(p2)) { envPath = p2; break; }
      }
      if (!envPath) return;
      console.log("[env] usando", envPath);
      // Tolerante al encoding: si el .env se guardó en UTF-16 (típico con Notepad "Unicode" o con
      // `>`/Out-File de PowerShell), leerlo como UTF-8 da basura y NO se detectaban las variables.
      // Detectamos el BOM y decodificamos bien (UTF-16 LE/BE, UTF-8 con BOM, o UTF-8 plano).
      let raw;
      try {
        const _buf = fs.readFileSync(envPath);
        if (_buf.length >= 2 && _buf[0] === 0xFF && _buf[1] === 0xFE) raw = _buf.toString("utf16le");
        else if (_buf.length >= 2 && _buf[0] === 0xFE && _buf[1] === 0xFF) raw = Buffer.from(_buf).swap16().toString("utf16le");
        else if (_buf.length >= 3 && _buf[0] === 0xEF && _buf[1] === 0xBB && _buf[2] === 0xBF) raw = _buf.slice(3).toString("utf8");
        else raw = _buf.toString("utf8");
      } catch (_e) { raw = fs.readFileSync(envPath, "utf8"); }
      raw.split(/\r?\n/).forEach(line => {
        const clean = String(line || "").trim();
        if (!clean || clean.startsWith("#") || !clean.includes("=")) return;
        const i = clean.indexOf("=");
        const k = clean.slice(0, i).trim();
        let v = clean.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (k && env[k] === undefined) env[k] = v;
      });
    } catch (err) {
      console.warn("[panel-v15] No se pudo leer .env:", err.message);
    }
  }
  cargarEnvLocalV15();

  // Defaults de Supabase (anon key PÚBLICA, igual que en el .htm) para que la app
  // EMPAQUETADA ande sin .env. La oficina sale del login de Chunior; el .env solo
  // se necesita para overrides (proxy, etc.).
  if (!env.SUPABASE_URL)      env.SUPABASE_URL = "https://pjvvyvfcwjoocjqvdror.supabase.co";
  if (!env.SUPABASE_ANON_KEY) env.SUPABASE_ANON_KEY = "sb_publishable_NYqRoKptTgcL90VAVF2kqA_Gl06mEUF";
  // PRODUCCIÓN: PANEL_DATA_SECRET NO tiene default. Va por .env. Sin él, auto-login de agente
  // y proxy devuelven {ok:false, reason:'missing-secret'} (el resto del panel sigue andando:
  // el renderer usa su propio secret para los RPC blindados de lectura).
  if (!env.PANEL_DATA_SECRET) {
    console.warn("[panel] Falta PANEL_DATA_SECRET en .env → auto-login de agente y proxy quedan DESHABILITADOS. El resto del panel (carga/retiro/validación/chat manual) opera normal.");
  } else {
    console.log("[panel] PANEL_DATA_SECRET cargado desde .env (auto-login y proxy habilitados).");
  }

  // Sesiones/datos separados por oficina SOLO cuando se lanza con NODO_ENV (ej. P4).
  // Sin NODO_ENV (P1 por defecto) NO se toca el userData → P1 queda igual que siempre.
  if (env.NODO_ENV && env.USER_DATA_DIR) {
    try { app.setPath('userData', path.join(rootDir, env.USER_DATA_DIR)); console.log('[userData]', env.USER_DATA_DIR); }
    catch (e) { console.warn('[userData]', e && e.message); }
  }

  return { env };
}

module.exports = { configureEnvironment };
