const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Los avisos de chat no vuelven a sonar por mensajes viejos.
//
// Juan, 3/10: "de a ratos te marca mensaje ya viejos" — cuatro avisos en el mismo segundo,
// de cuatro jugadores distintos, por mensajes de hace rato.
//
// Por qué pasaba: el aviso se anotaba como "ya avisado" SOLO cuando además había algo sin leer.
// Un mensaje que pasaba por ahí con la conversación al día (porque el operador ya había
// contestado) no quedaba anotado nunca. El día que el jugador volvía a escribir, el ticket pasaba
// a tener 1 sin leer y el recorrido avisaba por ESE y por TODOS los viejos que nunca se habían
// anotado, de golpe.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chat', 'chat-no-leidos.js'), 'utf8');

function trozo(desde, hasta){
  const i = SRC.indexOf(desde);
  assert.notEqual(i, -1, 'no está: ' + desde);
  const j = SRC.indexOf(hasta, i);
  assert.notEqual(j, -1, 'no está: ' + hasta);
  // hasta el cierre de esa función
  let n = 0, fin = -1;
  for(let k = SRC.indexOf('{', j); k < SRC.length; k++){
    if(SRC[k] === '{') n++;
    else if(SRC[k] === '}'){ n--; if(!n){ fin = k + 1; break; } }
  }
  assert.notEqual(fin, -1);
  return SRC.slice(i, fin);
}

function armar(){
  const avisos = [];
  const guardado = {};
  const ctx = {
    console, Date, String, Number, Math, JSON, Object, Array, isNaN,
    localStorage: {
      getItem: (k) => (k in guardado ? guardado[k] : null),
      setItem: (k, v) => { guardado[k] = String(v); }
    },
    document: { body: { classList: { contains: () => false } } },
    toast: (txt) => { avisos.push(txt); },
    window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(trozo('function S(v)', 'function notifyNewMessages('), ctx);
  return { ctx, avisos, guardado };
}

function hora(minutosAtras){
  return new Date(Date.now() - minutosAtras * 60000).toISOString();
}

// Una conversación vieja, ya contestada por el operador, y un mensaje nuevo recién llegado.
function ticketConHistoria(){
  const thread = [];
  for(let i = 0; i < 10; i++){
    thread.push({ origen: 'USUARIO', mensaje: 'viejo ' + i, fecha: hora(300 - i) });
  }
  thread.push({ origen: 'OPERADOR', mensaje: 'ya está', fecha: hora(280) });
  return { usuario: 'luiis900', solicitudId: 299001, accepted: true, thread };
}

test('un mensaje nuevo avisa UNA vez, y los viejos no', () => {
  const a = armar();
  const t = ticketConHistoria();
  a.ctx.window.ticketsAgrupados = () => [t];

  a.ctx.notifyNewMessages();            // primera vuelta: todo es historia contestada
  assert.deepEqual(a.avisos, [], 'nada que avisar: el operador ya contestó');

  t.thread.push({ origen: 'USUARIO', mensaje: 'hola de nuevo', fecha: new Date().toISOString() });
  a.ctx.notifyNewMessages();
  assert.equal(a.avisos.length, 1, 'tiene que avisar por el nuevo y por ninguno más');
  assert.match(a.avisos[0], /luiis900/);
});

test('el mismo mensaje no vuelve a avisar en las vueltas siguientes', () => {
  const a = armar();
  const t = ticketConHistoria();
  a.ctx.window.ticketsAgrupados = () => [t];
  a.ctx.notifyNewMessages();
  t.thread.push({ origen: 'USUARIO', mensaje: 'hola de nuevo', fecha: new Date().toISOString() });
  a.ctx.notifyNewMessages();
  a.ctx.notifyNewMessages();
  a.ctx.notifyNewMessages();
  assert.equal(a.avisos.length, 1, 'una sola vez');
});

test('una conversación SIN contestar avisa una vez por mensaje, no cuatro de golpe', () => {
  const a = armar();
  const t = { usuario: 'pruebasan', solicitudId: 300236, accepted: true,
              thread: [{ origen: 'USUARIO', mensaje: 'hola', fecha: hora(2) }] };
  a.ctx.window.ticketsAgrupados = () => [t];
  a.ctx.notifyNewMessages();
  assert.equal(a.avisos.length, 1);
  t.thread.push({ origen: 'USUARIO', mensaje: 'alguien?', fecha: hora(1) });
  a.ctx.notifyNewMessages();
  assert.equal(a.avisos.length, 2, 'el segundo mensaje avisa; el primero no repite');
});

test('una conversación que todavía nadie aceptó no avisa por acá', () => {
  const a = armar();
  const t = { usuario: 'joelgoat', solicitudId: 1, accepted: false,
              thread: [{ origen: 'USUARIO', mensaje: 'hola', fecha: hora(1) }] };
  a.ctx.window.ticketsAgrupados = () => [t];
  a.ctx.notifyNewMessages();
  assert.deepEqual(a.avisos, [], 'el aviso de chat nuevo es el de "En espera", no este');
});
