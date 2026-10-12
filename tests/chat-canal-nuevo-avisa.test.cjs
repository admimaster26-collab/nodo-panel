const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Una consulta nueva del portal tiene que avisar.
//
// Juan, 3/10: "fallos reportados en cerrar chats y sin notificacion de nuevos chats".
//
// El aviso de chat nuevo sale de la pestaña "En espera", que son los tickets con accepted = false.
// Las conversaciones del canal nuevo nacían con `accepted: !cerrado`: toda conversación abierta
// entraba ya como aceptada, nunca pasaba por "En espera", y el operador no se enteraba de nada —
// sólo lo veía si miraba la lista a mano.
//
// Ahora se pregunta lo mismo que para el resto: ¿este operador la aceptó? (el mapa local).

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat', 'chat-canal-nuevo.js'), 'utf8');

function sacar(firma){
  const i = SRC.indexOf(firma);
  assert.notEqual(i, -1, 'no está: ' + firma);
  const j = SRC.indexOf('{', i);
  let n = 0, fin = -1;
  for(let k = j; k < SRC.length; k++){
    if(SRC[k] === '{') n++;
    else if(SRC[k] === '}'){ n--; if(!n){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1, 'no cierra: ' + firma);
  return SRC.slice(i, fin);
}

function armar(aceptados){
  const ctx = {
    S: (v) => String(v == null ? '' : v),
    U: (v) => String(v == null ? '' : v).toUpperCase(),
    Number, String,
    window: { _wq2IsAccepted: (u) => (aceptados || []).includes(String(u || '').toUpperCase()) }
  };
  vm.createContext(ctx);
  vm.runInContext(sacar('function comoTicket('), ctx);
  return ctx.comoTicket;
}

const SESION_ABIERTA = {
  usuario: 'joelgoat', telefono: '1158956858', estado: 'ABIERTO',
  chat_id: 'CHAT_abc', solicitud_id: 299698,
  ultimo_mensaje: 'No me aparece ningun alias', fecha_ultimo: new Date().toISOString(), sin_leer: 1
};

test('una consulta nueva entra SIN aceptar: es lo que dispara el aviso', () => {
  const comoTicket = armar([]);                 // el operador no acepto nada
  const t = comoTicket(SESION_ABIERTA);
  assert.equal(t.accepted, false, 'tiene que caer en "En espera"');
  assert.equal(t.cerrado, false);
});

test('una que el operador YA acepto no vuelve a avisar', () => {
  const comoTicket = armar(['JOELGOAT']);
  const t = comoTicket(SESION_ABIERTA);
  assert.equal(t.accepted, true, 'ya la tomo: no molesta de nuevo');
});

test('una cerrada no avisa aunque no este aceptada', () => {
  const comoTicket = armar([]);
  const t = comoTicket(Object.assign({}, SESION_ABIERTA, { estado: 'CERRADO' }));
  assert.equal(t.cerrado, true);
  assert.equal(t.accepted, false);
});

test('el ticket lleva con que cerrarse de verdad', () => {
  // Sin estos dos datos el cierre no tiene a que agarrarse: la pantalla se cerraba y en la base
  // no se cerraba nada.
  const comoTicket = armar([]);
  const t = comoTicket(SESION_ABIERTA);
  assert.equal(t._canalNuevo, true);
  assert.equal(t._chatId, 'CHAT_abc', 'el id de la conversacion');
  assert.equal(t.solicitudId, '299698', 'y la solicitud puente, para cerrarla tambien');
});

// ── 4/10 · El aviso no puede dispararlo NUESTRA propia respuesta ──────────────────────────────
//
// Juan: "al cerrar los mensajes algunos chats se vuelven a marcar como no leidos y hasta marcar
// como que llegan mensajes aun". El adelanto que muestra la lista es el ultimo mensaje de
// CUALQUIERA, y aca se daba por sentado que lo habia escrito el jugador. Asi, cada respuesta del
// operador —o del bot— entraba como mensaje nuevo del jugador: el chat volvia a "no leido" y
// saltaba el cartel con el texto de nuestra propia contestacion.
// Caso real: noemiacdc, con el cartel "Nuevo mensaje de noemiacdc" mostrando
// "Vemos tu carga de $3.000 registrada hace 1 minutos" — que lo escribio el bot.

const SESION_CONTESTADA = {
  usuario: 'noemiacdc', telefono: '1158956858', estado: 'ABIERTO',
  chat_id: 'CHAT_50ee', solicitud_id: 302487,
  ultimo_mensaje: 'Vemos tu carga de $3.000 registrada hace 1 minutos.',
  ultimo_de: 'OPERADOR',
  fecha_ultimo: '2026-10-04T04:05:12.978Z',   // cuando escribio el jugador
  updated_at:   '2026-10-04T04:05:40.000Z',   // cuando contesto el bot
  sin_leer: 0
};

test('lo ultimo que dijo el bot NO figura como mensaje del jugador', () => {
  const comoTicket = armar(['NOEMIACDC']);
  const t = comoTicket(SESION_CONTESTADA);
  const delUsuario = t.thread.filter(m => m.origen === 'USUARIO');
  assert.equal(delUsuario.length, 0, 'esa linea la escribio el bot, no el jugador');
  assert.equal(t.last.origen, 'OPERADOR');
});

test('la respuesta del operador queda con SU hora, no con la del jugador', () => {
  const comoTicket = armar(['NOEMIACDC']);
  const t = comoTicket(SESION_CONTESTADA);
  assert.equal(t.last.fecha, '2026-10-04T04:05:40.000Z');
});

test('si el ultimo que hablo fue el jugador, sigue contando como suyo', () => {
  const comoTicket = armar([]);
  const t = comoTicket(Object.assign({}, SESION_CONTESTADA, {
    ultimo_de: 'USUARIO', ultimo_mensaje: 'Ya cargue', sin_leer: 1 }));
  assert.equal(t.thread[0].origen, 'USUARIO');
  assert.equal(t.thread[0].fecha, '2026-10-04T04:05:12.978Z', 'con la hora del jugador');
  assert.equal(t.unread, 1);
});

test('sin el dato de quien hablo (servidor viejo) se asume el jugador, como antes', () => {
  const comoTicket = armar([]);
  const t = comoTicket(Object.assign({}, SESION_CONTESTADA, { ultimo_de: undefined }));
  assert.equal(t.thread[0].origen, 'USUARIO');
});

test('autores BOT y SISTEMA explícitos no se convierten en mensajes del usuario', () => {
  const comoTicket=armar(['NOEMIACDC']);
  for(const autor of ['BOT','SISTEMA']){
    const t=comoTicket({...SESION_CONTESTADA,ultimo_de:autor});
    assert.equal(t.last.origen,autor);
    assert.equal(t.last.fecha,SESION_CONTESTADA.updated_at);
    const Metrics=require('../renderer/chat/metrics.js');
    assert.equal(Metrics.snapshot([t],{}).total,0);
  }
});
