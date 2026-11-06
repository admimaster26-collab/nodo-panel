const { test } = require('node:test');
const assert = require('node:assert/strict');
const Metrics = require('../renderer/chat/metrics.js');

test('cuenta sólo mensajes del usuario posteriores a la lectura en tickets aceptados', () => {
  const ticket = { usuario: 'ana', masterId: 1, accepted: true, thread: [
    { origen: 'USUARIO', fecha: '2026-09-05T10:00:00Z' },
    { origen: 'USUARIO', fecha: '2026-09-05T12:00:00Z' },
    { origen: 'PANEL', fecha: '2026-09-05T13:00:00Z' },
    { origen: 'USUARIO', fecha: 'fecha inválida' }
  ] };
  const waiting = { ...ticket, usuario: 'otro', accepted: false };
  const result = Metrics.snapshot([ticket, waiting], { [Metrics.chatKey(ticket)]: '2026-09-05T10:00:00Z' });
  assert.equal(result.total, 1);
  assert.equal(result.accepted, 1);
  assert.equal(result.unread.get(waiting), 0);
  assert.equal(result.byUser.get('ANA'), ticket);
});

test('una pasada obtiene tickets/marcas una vez y no reordena los mensajes', () => {
  const tickets = Array.from({ length: 300 }, (_, i) => ({ usuario: 'u' + i, accepted: true, thread: [
    { origen: 'USUARIO', fecha: '2026-09-05T12:00:00Z', mensaje: 'último en tiempo' },
    { origen: 'USUARIO', fecha: '2026-09-05T10:00:00Z', mensaje: 'último en array' }
  ] }));
  let ticketReads = 0, markReads = 0;
  const model = Metrics.create({ getTickets: () => { ticketReads++; return tickets; }, readMarks: () => { markReads++; return {}; } });
  const result = model.read();
  assert.equal(ticketReads, 1); assert.equal(markReads, 1);
  assert.equal(result.total, 600);
  assert.equal(tickets[0].thread[0].mensaje, 'último en tiempo');
  assert.ok(result.signature.includes('último en array'));
});

test('estabiliza el cero durante 2,2 segundos y conserva el primer ticket por nombre', () => {
  let now = 10;
  const model = Metrics.create({ getTickets: () => [], readMarks: () => ({}), now: () => now });
  assert.equal(model.stableTotal(3), 3);
  now = 2000; assert.equal(model.stableTotal(0), 3);
  now = 2210; assert.equal(model.stableTotal(0), 0);
  const first = { usuario: 'Ana' }, other = { usuario: ' ANA ' };
  assert.equal(Metrics.snapshot([first, other], {}).byUser.get('ANA'), first);
});

// pepe, 6/11: "Recibimos tus datos…" sale con origen OPERADOR y auto:true. Antes contaba como que
// el operador había leído y apagaba el aviso de una consulta que nadie había visto.
test('una respuesta automática no marca como leído lo del jugador', () => {
  const ticket = { usuario: 'pepe', masterId: 9, accepted: true, thread: [
    { origen: 'USUARIO', fecha: '2026-11-06T16:06:51Z' },
    { origen: 'OPERADOR', auto: true, operador: 'NODO', fecha: '2026-11-06T16:06:51.963Z' },
    { origen: 'USUARIO', fecha: '2026-11-06T16:10:40Z' }
  ] };
  assert.equal(Metrics.unreadForTicket(ticket, {}), 2);
  const conOperador = { ...ticket, thread: [...ticket.thread, { origen: 'OPERADOR', fecha: '2026-11-06T16:12:00Z' }] };
  assert.equal(Metrics.unreadForTicket(conOperador, {}), 0, 'una respuesta de una persona sí lo apaga');
});
