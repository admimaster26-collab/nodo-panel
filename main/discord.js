'use strict';
// NODO en Discord (Rich Presence), sin dependencias.
//
// Discord escucha en un socket LOCAL de la máquina: en Windows un named pipe
// \\?\pipe\discord-ipc-0..9. No hay internet, ni OAuth, ni bot, ni permisos en ningún servidor —
// sólo el Application ID que se saca del portal de desarrolladores.
//
// El protocolo son marcos de 8 bytes de encabezado (opcode LE + largo LE) y JSON:
//   op 0 HANDSHAKE · op 1 FRAME · op 2 CLOSE · op 3 PING · op 4 PONG
//
// Reglas de esta pieza, en orden de importancia:
//   1) NUNCA puede romper ni frenar la app. Todo va envuelto y se traga sus propios errores.
//   2) Si Discord no está abierto, no pasa nada: se reintenta cada tanto, en silencio.
//   3) Sin Application ID no hace absolutamente nada.
const net = require('node:net');

const OP_HANDSHAKE = 0, OP_FRAME = 1, OP_CLOSE = 2, OP_PING = 3, OP_PONG = 4;
// Discord acepta un update cada ~15 s; más seguido lo descarta igual.
const MIN_ENTRE_UPDATES_MS = 15000;
const REINTENTO_MS = 60000;
// Discord contesta cada SET_ACTIVITY con el mismo nonce. Si no contesta, la conexión quedó muerta
// aunque el pipe siga abierto, y Discord sigue mostrando lo último que aceptó: el "13 solicitudes
// pendientes · hace 15 min" que no cambiaba más (Juan, 2/11). Se corta y se vuelve a conectar.
const ESPERA_RESPUESTA_MS = 20000;
// El panel manda su estado cada minuto. Si deja de hacerlo (se colgó, se cerró la ventana), se
// borra la presencia: mejor nada que un número viejo.
const SILENCIO_PANEL_MS = 5 * 60000;

function rutasPosibles() {
  const rutas = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') rutas.push('\\\\?\\pipe\\discord-ipc-' + i);
    else {
      const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
      rutas.push(base.replace(/\/$/, '') + '/discord-ipc-' + i);
    }
  }
  return rutas;
}

function marco(op, datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos), 'utf8');
  const encabezado = Buffer.alloc(8);
  encabezado.writeInt32LE(op, 0);
  encabezado.writeInt32LE(cuerpo.length, 4);
  return Buffer.concat([encabezado, cuerpo]);
}

function createDiscordPresence({ appId, version = '', log = console, conectar = net.createConnection,
                                 setTimer = setTimeout, clearTimer = clearTimeout, ahora = Date.now } = {}) {
  const id = String(appId || '').trim();
  let socket = null, listo = false, conectando = false;
  let ultimoEnvio = 0, pendiente = null, timerReintento = null, timerEnvio = null;
  // ultimo: lo último que mandó el panel, para volver a publicarlo al reconectar.
  let ultimo = null, nonceEsperado = null, esperaLimpieza = false, timerRespuesta = null, timerSilencio = null;
  const arranque = ahora();
  let apagado = false;

  function cerrar() {
    listo = false; conectando = false;
    nonceEsperado = null;
    if (timerRespuesta) { clearTimer(timerRespuesta); timerRespuesta = null; }
    if (socket) { try { socket.destroy(); } catch (_) {} socket = null; }
  }

  function escribir(datos, esLimpieza) {
    const nonce = String(ahora()) + '-' + Math.random().toString(16).slice(2);
    socket.write(marco(OP_FRAME, Object.assign({ nonce }, datos)));
    nonceEsperado = nonce;
    esperaLimpieza = !!esLimpieza;
    if (timerRespuesta) clearTimer(timerRespuesta);
    timerRespuesta = setTimer(() => {
      timerRespuesta = null;
      if (nonceEsperado !== nonce) return;
      try { log.warn('[discord] Discord no contestó: se vuelve a conectar'); } catch (_) {}
      cerrar();
      reintentarMasTarde();
    }, ESPERA_RESPUESTA_MS);
  }

  // Sin actividad: Discord deja de mostrar a NODO.
  function limpiar() {
    if (!listo || !socket) return;
    try { escribir({ cmd: 'SET_ACTIVITY', args: { pid: process.pid } }, true); } catch (_) { cerrar(); reintentarMasTarde(); }
  }

  function reintentarMasTarde() {
    if (apagado || timerReintento) return;
    timerReintento = setTimer(() => { timerReintento = null; conectar_(); }, REINTENTO_MS);
  }

  function conectar_() {
    if (apagado || !id || listo || conectando) return;
    conectando = true;
    const rutas = rutasPosibles();
    (function probar(i) {
      if (apagado) return;
      if (i >= rutas.length) { conectando = false; reintentarMasTarde(); return; }  // Discord no está abierto
      let s;
      try { s = conectar(rutas[i]); } catch (_) { probar(i + 1); return; }
      let resuelto = false;
      const siguiente = () => { if (resuelto) return; resuelto = true; try { s.destroy(); } catch (_) {} probar(i + 1); };
      s.once('error', siguiente);
      s.once('close', () => { if (resuelto) return; resuelto = true; cerrar(); reintentarMasTarde(); });
      s.once('connect', () => {
        if (resuelto) return;
        resuelto = true;
        socket = s;
        conectando = false;
        s.removeListener('error', siguiente);
        s.on('error', () => { cerrar(); reintentarMasTarde(); });
        s.on('close', () => { cerrar(); reintentarMasTarde(); });
        s.on('data', alLlegar);
        try { s.write(marco(OP_HANDSHAKE, { v: 1, client_id: id })); } catch (_) { cerrar(); reintentarMasTarde(); }
      });
    })(0);
  }

  let resto = Buffer.alloc(0);
  function alLlegar(trozo) {
    try {
      resto = Buffer.concat([resto, trozo]);
      while (resto.length >= 8) {
        const op = resto.readInt32LE(0);
        const largo = resto.readInt32LE(4);
        if (largo < 0 || resto.length < 8 + largo) break;
        const cuerpo = resto.slice(8, 8 + largo);
        resto = resto.slice(8 + largo);
        if (op === OP_PING) { try { socket.write(marco(OP_PONG, JSON.parse(cuerpo.toString('utf8')))); } catch (_) {} continue; }
        if (op === OP_CLOSE) { cerrar(); reintentarMasTarde(); return; }
        if (op !== OP_FRAME) continue;
        let msg = null;
        try { msg = JSON.parse(cuerpo.toString('utf8')); } catch (_) { continue; }
        if (msg && msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
          listo = true;
          try { log.log('[discord] NODO figura en Discord'); } catch (_) {}
          const p = pendiente || ultimo;
          if (p) enviar(p);
          continue;
        }
        // La respuesta a lo último que se mandó: la conexión está viva.
        if (msg && msg.nonce && msg.nonce === nonceEsperado) {
          const eraLimpieza = esperaLimpieza;
          nonceEsperado = null;
          if (timerRespuesta) { clearTimer(timerRespuesta); timerRespuesta = null; }
          // Si Discord lo rechazó, seguiría mostrando el estado anterior: se borra.
          if (msg.evt === 'ERROR') {
            try { log.warn('[discord] Discord rechazó la actualización:', msg.data && msg.data.message); } catch (_) {}
            if (!eraLimpieza) limpiar();
          }
        }
      }
    } catch (_) { cerrar(); reintentarMasTarde(); }
  }

  function enviar(p) {
    if (!listo || !socket) return false;
    try {
      escribir({
        cmd: 'SET_ACTIVITY',
        args: {
          pid: process.pid,
          activity: {
            details: String(p.details || '').slice(0, 128),
            state: String(p.state || '').slice(0, 128),
            timestamps: { start: Math.floor(arranque / 1000) },
            assets: { large_image: 'nodo', large_text: String(p.largeText || ('NODO ' + version)).slice(0, 128) },
            instance: false
          }
        }
      });
      ultimoEnvio = ahora();
      pendiente = null;
      return true;
    } catch (_) { cerrar(); reintentarMasTarde(); return false; }
  }

  // Lo que llama el panel. Si Discord no está o todavía no arrancó, queda guardado: se manda lo
  // ÚLTIMO cuando se pueda, nunca una cola de estados viejos.
  function actualizar(p) {
    if (apagado || !id || !p) return;
    pendiente = p;
    ultimo = p;
    if (timerSilencio) clearTimer(timerSilencio);
    timerSilencio = setTimer(() => {
      timerSilencio = null;
      ultimo = null; pendiente = null;
      try { log.warn('[discord] el panel no manda su estado hace 5 min: se borra la presencia'); } catch (_) {}
      limpiar();
    }, SILENCIO_PANEL_MS);
    conectar_();
    if (!listo) return;
    const falta = MIN_ENTRE_UPDATES_MS - (ahora() - ultimoEnvio);
    if (falta <= 0) { enviar(pendiente); return; }
    if (timerEnvio) return;                       // ya hay uno esperando: pisará el pendiente
    timerEnvio = setTimer(() => { timerEnvio = null; if (pendiente) enviar(pendiente); }, falta);
  }

  function apagar() {
    apagado = true;
    if (timerReintento) { clearTimer(timerReintento); timerReintento = null; }
    if (timerEnvio) { clearTimer(timerEnvio); timerEnvio = null; }
    if (timerSilencio) { clearTimer(timerSilencio); timerSilencio = null; }
    cerrar();
  }

  return { actualizar, apagar, get habilitado() { return !!id; }, get conectado() { return listo; } };
}

module.exports = { createDiscordPresence, marco, rutasPosibles };
