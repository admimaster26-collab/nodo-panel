#!/usr/bin/env node
'use strict';
// Revision de transferencias. Comando:
//
//   node scripts/revision.cjs              estado
//   node scripts/revision.cjs on           prender (local)
//   node scripts/revision.cjs off          apagar  (local)
//   node scripts/revision.cjs sonda        mirar sin guardar nada
//   node scripts/revision.cjs ahora        una pasada: leer -> guardar -> enganchar
//   node scripts/revision.cjs cierre       las listas del turno
//
// El interruptor del servidor manda: OFF corta todo y es el default. ON corre siempre.
// LOCAL deja decidir al archivo de esta PC. Si el servidor no contesta se usa la ultima
// respuesta que dio; si nunca dio ninguna, no corre. Asi "apagar de remoto" es confiable.
// No muestra nada en NODO ni en el navegador: se entera el que corre el comando y nadie mas.

const fs = require('node:fs');
const path = require('node:path');
const lector = require('./revision/lector.cjs');
const extractor = require('./revision/extractor.cjs');

// ── env, igual que main/config.js (incluye .env en UTF-16, que es como lo deja PowerShell) ──
function cargarEnv() {
  const env = process.env;
  const nombre = env.NODO_ENV ? '.env.' + String(env.NODO_ENV).toLowerCase() : '.env';
  const dirs = [];
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'NODO'));
  dirs.push(path.join(__dirname, '..'));
  for (const d of dirs) {
    for (const f of [path.join(d, nombre), path.join(d, '.env')]) {
      if (!fs.existsSync(f)) continue;
      let raw;
      try {
        const b = fs.readFileSync(f);
        if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) raw = b.toString('utf16le');
        else if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) raw = Buffer.from(b).swap16().toString('utf16le');
        else if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) raw = b.slice(3).toString('utf8');
        else raw = b.toString('utf8');
      } catch (_e) { continue; }
      for (const linea of raw.split(/\r?\n/)) {
        const s = String(linea || '').trim();
        if (!s || s.startsWith('#') || !s.includes('=')) continue;
        const i = s.indexOf('=');
        const k = s.slice(0, i).trim();
        let v = s.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k && env[k] === undefined) env[k] = v;
      }
      return f;
    }
  }
  return '';
}

const ENV_USADO = cargarEnv();
const SB_URL = process.env.SUPABASE_URL || 'https://pjvvyvfcwjoocjqvdror.supabase.co';
// Misma clave publicable que usa main/config.js cuando el .env no la define.
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_NYqRoKptTgcL90VAVF2kqA_Gl06mEUF';
const SECRETO = process.env.PANEL_DATA_SECRET || '';

function argumento(nombre) {
  const i = process.argv.indexOf('--' + nombre);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
}
const PC = String(argumento('pc') || process.env.NODO_PC || process.env.PC_CODIGO ||
                   (process.env.NODO_ENV || '')).toUpperCase().replace(/[^P0-9]/g, '');

const DIR_ESTADO = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'NODO') : __dirname;
const ARCHIVO = path.join(DIR_ESTADO, 'revision.json');

function leerLocal() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); } catch (_e) { return {}; }
}
function guardarLocal(obj) {
  try {
    fs.mkdirSync(DIR_ESTADO, { recursive: true });
    fs.writeFileSync(ARCHIVO, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) { console.error('No se pudo guardar ' + ARCHIVO + ': ' + e.message); return false; }
}

async function rpc(fn, params) {
  if (!SB_KEY || !SECRETO) return { ok: false, motivo: 'faltan SUPABASE_ANON_KEY o PANEL_DATA_SECRET en el .env' };
  try {
    const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_secret: SECRETO }, params || {})),
      signal: AbortSignal.timeout(15000)
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (_e) {}
    if (!r.ok) return { ok: false, motivo: 'servidor ' + r.status + ' ' + String(t).slice(0, 160) };
    return { ok: true, datos: j };
  } catch (e) { return { ok: false, motivo: String((e && e.message) || e).slice(0, 160) }; }
}

// ── El interruptor ─────────────────────────────────────────────────────────────────────────
async function resolverEncendido() {
  const local = leerLocal();
  const r = await rpc('panel_revision_modo', { p_pc: PC });
  let modo = null, desde = 'servidor';

  if (r.ok && r.datos && r.datos.modo) {
    modo = String(r.datos.modo);
    const nuevo = Object.assign({}, local, { modo_servidor: modo, modo_servidor_at: new Date().toISOString() });
    guardarLocal(nuevo);
  } else if (local.modo_servidor) {
    modo = String(local.modo_servidor);
    desde = 'ultima respuesta guardada (' + String(local.modo_servidor_at || '').slice(0, 16) + ')';
  } else {
    // Nunca se pudo preguntar: no corre. Apagado por defecto.
    return { encendido: false, modo: 'OFF', desde: 'sin respuesta del servidor y sin respuesta previa',
             motivo: r.motivo || '' };
  }

  if (modo === 'OFF') return { encendido: false, modo: modo, desde: desde };
  if (modo === 'ON')  return { encendido: true,  modo: modo, desde: desde };
  return { encendido: local.activa === true, modo: 'LOCAL', desde: desde + ' + archivo de esta PC' };
}

// ── Leer el banco ──────────────────────────────────────────────────────────────────────────
async function leerBanco() {
  const salida = { ads: null, perfiles: [], lecturas: [], avisos: [] };

  const vivo = await lector.adsVivo();
  salida.ads = vivo;
  if (!vivo.vivo) {
    salida.avisos.push('AdsPower no contesta en ' + lector.ADS + ' (' + vivo.motivo + '). ' +
      'Tiene que estar abierto el programa de AdsPower, no solo el navegador.');
    return salida;
  }

  await lector.espera(lector.PAUSA_ADS);
  const ps = await lector.adsPerfiles();
  if (!ps.ok) salida.avisos.push('No se pudo listar perfiles: ' + ps.motivo);
  salida.perfiles = ps.perfiles;

  for (const p of ps.perfiles) {
    await lector.espera(lector.PAUSA_ADS);
    const act = await lector.adsActivo(p.user_id);
    if (!act.abierto) continue;          // cerrado: no se abre, se informa y listo
    if (!act.puerto) { salida.avisos.push('Perfil ' + p.nombre + ' abierto pero sin puerto de depuracion.'); continue; }

    const tabs = await lector.pestanas(act.puerto);
    if (!tabs.ok) { salida.avisos.push('Perfil ' + p.nombre + ': ' + tabs.motivo); continue; }

    const dePago = tabs.pestanas.filter((t) => /mercadopago\.com|mercadolibre\.com/i.test(t.url));
    const enMovimientos = dePago.filter((t) => /\/banking\/balance\/movements|\/activities/i.test(t.url));

    if (!dePago.length) continue;
    if (!enMovimientos.length) {
      salida.avisos.push('Perfil ' + p.nombre + ': hay Mercado Pago abierto pero ninguna pestana en movimientos. ' +
        'No se navega nada, asi que no se lee.');
      continue;
    }

    for (const t of enMovimientos) {
      const r = await lector.evaluar(t.ws, extractor.EXPRESION);
      if (!r.ok) { salida.avisos.push('Perfil ' + p.nombre + ': ' + r.motivo); continue; }
      salida.lecturas.push({ perfil: p.nombre, user_id: p.user_id, datos: r.valor });
    }
  }

  if (!salida.lecturas.length && !salida.avisos.length) {
    salida.avisos.push('Ningun perfil abierto tenia una pestana de movimientos.');
  }
  return salida;
}

// ── Comandos ───────────────────────────────────────────────────────────────────────────────
async function cmdEstado() {
  const sw = await resolverEncendido();
  const local = leerLocal();
  console.log('Oficina:      ' + (PC || '(sin definir: usa --pc P4 o NODO_PC)'));
  console.log('Encendida:    ' + (sw.encendido ? 'SI' : 'NO') + '   (modo ' + sw.modo + ' · ' + sw.desde + ')');
  if (sw.motivo) console.log('              ' + sw.motivo);
  console.log('Archivo:      ' + ARCHIVO + (local.activa === true ? '  [local: prendida]' : '  [local: apagada]'));
  console.log('.env:         ' + (ENV_USADO || '(ninguno encontrado)') + (SECRETO ? '' : '   FALTA PANEL_DATA_SECRET'));
  const vivo = await lector.adsVivo();
  console.log('AdsPower:     ' + (vivo.vivo ? 'contesta en ' + lector.ADS : 'no contesta (' + vivo.motivo + ')'));
  return 0;
}

async function cmdInterruptor(prender) {
  const local = leerLocal();
  guardarLocal(Object.assign({}, local, { activa: !!prender, cambiado_at: new Date().toISOString() }));
  const sw = await resolverEncendido();
  console.log((prender ? 'Prendida' : 'Apagada') + ' en esta PC. Efectivo: ' +
    (sw.encendido ? 'SI' : 'NO') + ' (el servidor dice ' + sw.modo + ')');
  if (!prender && sw.encendido) console.log('Ojo: el servidor la tiene en ON, asi que sigue corriendo igual.');
  if (prender && !sw.encendido) console.log('Ojo: el servidor la tiene en ' + sw.modo + ', asi que no corre.');
  return 0;
}

async function cmdSonda() {
  const r = await leerBanco();
  console.log('AdsPower: ' + (r.ads && r.ads.vivo ? 'contesta' : 'no contesta'));
  console.log('Perfiles cargados: ' + r.perfiles.length);
  for (const p of r.perfiles) console.log('  - ' + (p.nombre || '(sin nombre)') + '  [' + p.user_id + ']' + (p.grupo ? '  grupo ' + p.grupo : ''));
  console.log('Lecturas: ' + r.lecturas.length);
  for (const l of r.lecturas) {
    const d = l.datos || {};
    console.log('  * ' + l.perfil + ' -> ' + d.pagina + '  filas=' + ((d.filas || []).length));
    console.log('    cuenta:      ' + JSON.stringify(d.cuenta || {}));
    console.log('    diagnostico: ' + JSON.stringify(d.diagnostico || {}));
  }
  for (const a of r.avisos) console.log('  ! ' + a);
  console.log('\nNo se guardo nada.');
  return 0;
}

async function cmdAhora(ver) {
  const sw = await resolverEncendido();
  if (!sw.encendido) { if (ver) console.log('Apagada (modo ' + sw.modo + '): no corre.'); return 0; }
  if (!PC) { if (ver) console.log('Falta la oficina: --pc P4'); return 1; }

  const r = await leerBanco();
  let leidos = 0, nuevos = 0;
  for (const l of r.lecturas) {
    const d = l.datos || {};
    const filas = (d.filas || []).filter((f) => f && f.id && f.centavos !== null);
    if (!filas.length) continue;
    const g = await rpc('panel_revision_guardar', {
      p_pc: PC,
      p_movs: filas.map((f) => ({
        id: f.id, fuente: f.fuente, nombre: f.nombre,
        centavos: String(f.centavos), datetime: f.datetime, hora: f.hora,
        posicion: String(f.posicion), descripcion: f.descripcion
      })),
      p_cuenta: d.cuenta || {}
    });
    if (!g.ok) { if (ver) console.log('No se pudo guardar: ' + g.motivo); continue; }
    leidos += Number((g.datos && g.datos.leidos) || 0);
    nuevos += Number((g.datos && g.datos.nuevos) || 0);
  }

  let eng = null;
  if (leidos) {
    const e = await rpc('panel_revision_enganchar', { p_pc: PC, p_horas: 48 });
    eng = e.ok ? e.datos : { error: e.motivo };
  }

  if (ver) {
    console.log('Leidos: ' + leidos + '  nuevos: ' + nuevos);
    if (eng) console.log('Enganche: ' + JSON.stringify(eng));
    for (const a of r.avisos) console.log('  ! ' + a);
  }
  return 0;
}

async function cmdCierre() {
  const r = await rpc('panel_revision_cierre', { p_pc: PC, p_turno: argumento('turno') || null });
  if (!r.ok) { console.log('No se pudo: ' + r.motivo); return 1; }
  const d = r.datos || {};
  console.log('Turno ' + d.turno + ' · ' + d.pc);
  console.log('  sin reclamar:  ' + d.sin_reclamar);
  console.log('  pueden volver: ' + d.pueden_volver);
  console.log('  ambiguas:      ' + d.ambiguas);
  console.log('  cargas sin movimiento: ' + ((d.cargas_sin_movimiento || []).length));
  for (const m of (d.movimientos || [])) {
    if (m.vinculo === 'RECLAMADA') continue;
    console.log('  [' + m.vinculo + '] #' + m.pos + ' $' + m.pesos + '  ' + (m.nombre || '(sin nombre)') + '  ' + String(m.cuando || '').slice(0, 16));
  }
  return 0;
}

(async () => {
  const cmd = (process.argv[2] || 'estado').toLowerCase();
  let code = 0;
  if (cmd === 'estado')      code = await cmdEstado();
  else if (cmd === 'on')     code = await cmdInterruptor(true);
  else if (cmd === 'off')    code = await cmdInterruptor(false);
  else if (cmd === 'sonda')  code = await cmdSonda();
  else if (cmd === 'ahora')  code = await cmdAhora(process.argv.includes('--callado') ? false : true);
  else if (cmd === 'cierre') code = await cmdCierre();
  else { console.log('Comandos: estado | on | off | sonda | ahora | cierre     (--pc P4)'); code = 1; }
  // process.exit() con sockets de fetch todavia cerrandose rompe libuv en Windows
  // (Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), async.c:94). Se deja salir solo.
  process.exitCode = code;
})();
