const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDiscordPresence, marco, rutasPosibles } = require('../main/discord.js');

// Un Discord de mentira: guarda lo que se le escribe y deja decidir si el pipe existe o no.
function discordFalso({ aceptaEn = 0, nunca = false } = {}) {
  const escrito = [], intentos = [];
  const sockets = [];
  const conectar = (ruta) => {
    intentos.push(ruta);
    const s = new EventEmitter();
    s.write = (b) => { escrito.push(leer(b)); return true; };
    s.destroy = () => { s.destruido = true; };
    sockets.push(s);
    const i = intentos.length - 1;
    queueMicrotask(() => {
      if (nunca || (aceptaEn !== 'todos' && i !== aceptaEn)) s.emit('error', new Error('ENOENT'));
      else s.emit('connect');
    });
    return s;
  };
  const leer = (b) => ({ op: b.readInt32LE(0), datos: JSON.parse(b.slice(8).toString('utf8')) });
  return { conectar, escrito, intentos, sockets };
}
const listo = (s) => s.emit('data', marco(1, { cmd: 'DISPATCH', evt: 'READY', data: {} }));
const esperar = () => new Promise(r => setTimeout(r, 5));

test('sin Application ID no hace absolutamente nada', async () => {
  const d = discordFalso();
  const p = createDiscordPresence({ appId: '', conectar: d.conectar });
  assert.equal(p.habilitado, false);
  p.actualizar({ details: 'algo', state: 'otra cosa' });
  await esperar();
  assert.deepEqual(d.intentos, [], 'ni siquiera intenta conectarse');
  p.apagar();
});

test('hace el handshake y recién después publica el estado', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const p = createDiscordPresence({ appId: '123', version: '2.1.3', conectar: d.conectar });
  p.actualizar({ details: '3 solicitudes pendientes', state: 'Última carga hace 3 min', largeText: 'NODO 2.1.3 · P4' });
  await esperar();

  assert.equal(d.escrito.length, 1, 'primero el handshake, nada más');
  assert.equal(d.escrito[0].op, 0);
  assert.equal(d.escrito[0].datos.client_id, '123');

  listo(d.sockets[0]);
  await esperar();
  const act = d.escrito[1];
  assert.equal(act.op, 1);
  assert.equal(act.datos.cmd, 'SET_ACTIVITY');
  assert.equal(act.datos.args.activity.details, '3 solicitudes pendientes');
  assert.equal(act.datos.args.activity.state, 'Última carga hace 3 min');
  assert.equal(act.datos.args.activity.assets.large_text, 'NODO 2.1.3 · P4');
  p.apagar();
});

test('si Discord no está abierto no molesta a nadie', async () => {
  const d = discordFalso({ nunca: true });
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar });
  p.actualizar({ details: 'x', state: 'y' });
  await esperar();
  assert.equal(d.intentos.length, 10, 'prueba los 10 pipes y se rinde en silencio');
  assert.equal(p.conectado, false);
  p.apagar();
});

test('mientras no está listo guarda el ÚLTIMO estado, no una cola de viejos', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar });
  p.actualizar({ details: '1 solicitud pendiente', state: 'a' });
  p.actualizar({ details: '2 solicitudes pendientes', state: 'b' });
  p.actualizar({ details: '3 solicitudes pendientes', state: 'c' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  const envios = d.escrito.filter(e => e.op === 1 && e.datos.cmd === 'SET_ACTIVITY');
  assert.equal(envios.length, 1, 'un solo envío');
  assert.equal(envios[0].datos.args.activity.details, '3 solicitudes pendientes', 'y el más nuevo');
  p.apagar();
});

test('respeta el límite de Discord: no manda más de uno cada 15 s', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  let t = 1000;
  const timers = [];
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar,
    ahora: () => t, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer() {} });
  p.actualizar({ details: 'uno', state: 'a' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  assert.equal(d.escrito.filter(e => e.datos.cmd === 'SET_ACTIVITY').length, 1);

  p.actualizar({ details: 'dos', state: 'b' });          // enseguida: no sale
  assert.equal(d.escrito.filter(e => e.datos.cmd === 'SET_ACTIVITY').length, 1);
  const espera = timers.find(x => x.ms > 0 && x.ms <= 15000);
  assert.ok(espera, 'tiene que quedar programado para cuando se pueda');

  t += 15000;
  espera.fn();
  const envios = d.escrito.filter(e => e.datos.cmd === 'SET_ACTIVITY');
  assert.equal(envios.length, 2);
  assert.equal(envios[1].datos.args.activity.details, 'dos');
  p.apagar();
});

test('responde el PING de Discord, así no lo da por muerto', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const p = createDiscordPresence({ appId: '123', conectar: d.conectar });
  p.actualizar({ details: 'x', state: 'y' });
  await esperar();
  d.sockets[0].emit('data', marco(3, { hola: 1 }));
  await esperar();
  assert.ok(d.escrito.some(e => e.op === 4), 'tiene que contestar PONG');
  p.apagar();
});

test('los pipes son los que Discord usa', () => {
  const r = rutasPosibles();
  assert.equal(r.length, 10);
  if (process.platform === 'win32') {
    // El named pipe que abre Discord en Windows. Se arma acá en vez de con una expresión regular
    // para que se lea tal cual es, sin barras escapadas de más.
    const esperado = String.fromCharCode(92, 92, 63, 92) + 'pipe' + String.fromCharCode(92) + 'discord-ipc-0';
    assert.equal(r[0], esperado);
    assert.equal(r[9].slice(-1), '9', 'del 0 al 9');
  } else {
    assert.match(r[0], /discord-ipc-0$/);
  }
});

// El Application ID va como CONSTANTE en main.js: no es un secreto (se ve en la presencia de
// cualquiera que la tenga puesta) y es el mismo para las siete oficinas. No pasa por el entorno
// porque el .env no se edita PC por PC (Juan, 26/9).
test('el Application ID es una constante, no una variable de entorno', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raiz = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
  const m = src.match(/const DISCORD_APP_ID = '(\d+)'/);
  assert.ok(m, 'main.js tiene que traer el id como constante');
  assert.match(m[1], /^\d{17,20}$/, 'un id de Discord son 17 a 20 dígitos: ' + m[1]);
  assert.ok(!/process\.env\.DISCORD_APP_ID/.test(src), 'no va por el entorno');
  const env = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
  assert.ok(!/DISCORD/.test(env), 'ni se documenta en el .env, que no se edita');
});

// ── Que no quede un número congelado ───────────────────────────────────────────────────────────
// Juan, 2/11: el cartel de OFIALV decía "13 solicitudes pendientes · Última carga hace 15 min" a las
// 11:51 y lo mismo dos minutos y medio después, con la pantalla de NODO vacía. Discord se quedaba con
// lo último que había aceptado y NODO no se enteraba, porque nunca leía las respuestas.
function reloj() {
  const timers = [];
  let t = 1000;
  return {
    timers,
    avanzar(ms) { t += ms; },
    opciones: {
      ahora: () => t,
      setTimer: (fn, ms) => { const x = { fn, ms, vivo: true }; timers.push(x); return x; },
      clearTimer: (x) => { if (x) x.vivo = false; },
      log: { log() {}, warn() {} }
    },
    disparar(ms) { const x = timers.find(y => y.vivo && y.ms === ms); assert.ok(x, 'falta un timer de ' + ms + ' ms'); x.vivo = false; x.fn(); }
  };
}
const actividades = (d) => d.escrito.filter(e => e.op === 1 && e.datos.cmd === 'SET_ACTIVITY');
const contestar = (s, envio, extra) => s.emit('data', marco(1, Object.assign({ cmd: 'SET_ACTIVITY', evt: null, nonce: envio.datos.nonce, data: {} }, extra || {})));

test('si Discord no contesta, corta, vuelve a conectar y publica lo último', async () => {
  const d = discordFalso({ aceptaEn: 'todos' });
  const r = reloj();
  const p = createDiscordPresence(Object.assign({ appId: '123', conectar: d.conectar }, r.opciones));
  p.actualizar({ details: '8 solicitudes pendientes', state: 'Última carga hace 6 min' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  assert.equal(actividades(d).length, 1);

  r.disparar(20000);                                  // pasaron 20 s sin respuesta
  assert.equal(d.sockets[0].destruido, true, 'la conexión muerta se corta: Discord borra lo viejo');
  assert.equal(p.conectado, false);

  r.disparar(60000);                                  // reintento
  await esperar();
  listo(d.sockets[1]);
  await esperar();
  const envios = actividades(d);
  assert.equal(envios.length, 2, 'al reconectar publica de nuevo');
  assert.equal(envios[1].datos.args.activity.details, '8 solicitudes pendientes');
  p.apagar();
});

test('si Discord contesta, la conexión sigue', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const r = reloj();
  const p = createDiscordPresence(Object.assign({ appId: '123', conectar: d.conectar }, r.opciones));
  p.actualizar({ details: 'Sin solicitudes pendientes', state: 'x' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  contestar(d.sockets[0], actividades(d)[0]);
  await esperar();
  assert.equal(r.timers.filter(x => x.vivo && x.ms === 20000).length, 0, 'la respuesta cancela la espera');
  assert.equal(p.conectado, true);
  assert.notEqual(d.sockets[0].destruido, true);
  p.apagar();
});

test('si Discord rechaza una actualización, se borra la presencia en vez de dejar la anterior', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const r = reloj();
  const p = createDiscordPresence(Object.assign({ appId: '123', conectar: d.conectar }, r.opciones));
  p.actualizar({ details: '3 solicitudes pendientes', state: 'x' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  contestar(d.sockets[0], actividades(d)[0], { evt: 'ERROR', data: { code: 4000, message: 'malo' } });
  await esperar();
  const envios = actividades(d);
  assert.equal(envios.length, 2);
  assert.equal(envios[1].datos.args.activity, undefined, 'sin actividad: Discord deja de mostrar a NODO');
  contestar(d.sockets[0], envios[1], { evt: 'ERROR', data: { code: 4000, message: 'malo' } });
  await esperar();
  assert.equal(actividades(d).length, 2, 'si también rechaza el borrado, no entra en un bucle');
  p.apagar();
});

test('si el panel deja de mandar su estado 5 minutos, se borra la presencia', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const r = reloj();
  const p = createDiscordPresence(Object.assign({ appId: '123', conectar: d.conectar }, r.opciones));
  p.actualizar({ details: '13 solicitudes pendientes', state: 'Última carga hace 15 min' });
  await esperar();
  listo(d.sockets[0]);
  await esperar();
  contestar(d.sockets[0], actividades(d)[0]);

  r.disparar(5 * 60000);
  const envios = actividades(d);
  assert.equal(envios.length, 2);
  assert.equal(envios[1].datos.args.activity, undefined, 'mejor nada que un número viejo');

  // Cuando el panel vuelve a hablar, se publica de nuevo.
  contestar(d.sockets[0], envios[1]);
  r.avanzar(20000);
  p.actualizar({ details: 'Sin solicitudes pendientes', state: 'Última carga hace 1 min' });
  assert.equal(actividades(d)[2].datos.args.activity.details, 'Sin solicitudes pendientes');
  p.apagar();
});

test('cada actualización del panel corre el plazo de silencio', async () => {
  const d = discordFalso({ aceptaEn: 0 });
  const r = reloj();
  const p = createDiscordPresence(Object.assign({ appId: '123', conectar: d.conectar }, r.opciones));
  p.actualizar({ details: 'a', state: 'x' });
  p.actualizar({ details: 'b', state: 'x' });
  assert.equal(r.timers.filter(x => x.vivo && x.ms === 5 * 60000).length, 1, 'un solo plazo, el último');
  p.apagar();
  assert.equal(r.timers.filter(x => x.vivo).length, 0, 'apagar no deja nada corriendo');
});
