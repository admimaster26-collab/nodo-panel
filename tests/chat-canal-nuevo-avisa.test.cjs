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
