(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoChatMetrics = factory();
})(globalThis, function(){
  'use strict';
  const upper = value => String(value ?? '').trim().toUpperCase();
  const date = value => { const d = new Date(value || 0); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); };
  function chatKey(ticket) {
    const id = ticket?.masterId || ticket?.solicitudId || ticket?.usuario || 'chat';
    return upper(ticket?.usuario || 'usuario') + '_' + String(id).replace(/[^A-Z0-9]/gi, '_');
  }
  // Contrato legacy: una respuesta OPERADOR también corta los pendientes locales.
  // No acredita un recibo remoto de visto. La beta puede entregar el total ya resuelto.
  function readCutoff(ticket, marks = {}) {
    let cutoff = date(marks?.[chatKey(ticket)]);
    for(const message of ticket?.thread || []) {
      if(upper(message.origen) === 'OPERADOR') cutoff = Math.max(cutoff, date(message.fecha));
    }
    return cutoff;
  }
  function unreadForTicket(ticket, marks = {}) {
    if(!ticket || ticket.cerrado) return 0;
    // El número que trae el servidor vale también para un chat que todavía nadie aceptó: el total
    // del servidor lo cuenta, así que la fila tiene que mostrarlo o el total queda sin explicar.
    if(Number.isSafeInteger(ticket._unreadServidor) && ticket._unreadServidor >= 0) return ticket._unreadServidor;
    if(!ticket.accepted) return 0;
    const cutoff = readCutoff(ticket, marks);
    return (ticket.thread || []).filter(m => upper(m.origen) === 'USUARIO' && date(m.fecha) > cutoff).length;
  }
  function snapshot(tickets, marks = {}) {
    const byUser = new Map(), unread = new Map(), signatures = [], list = [];
    let total = 0, accepted = 0;
    for(const ticket of tickets) {
      list.push(ticket);
      const name = upper(ticket.usuario);
      if(!byUser.has(name)) byUser.set(name, ticket);
      const count = unreadForTicket(ticket, marks);
      if(ticket.accepted && !ticket.cerrado) accepted++;
      unread.set(ticket, count);
      total += count;
      const thread = ticket.thread || [], last = thread[thread.length - 1] || {};
      signatures.push([ticket.usuario, ticket.accepted ? 'A' : 'E', ticket.masterId || ticket.solicitudId || '',
        thread.length, count, last.fecha || '', last.mensaje || ''].join(':'));
    }
    // `unread` tiene por clave el OBJETO ticket. Quien lo consulte tiene que buscar el ticket en
    // `tickets` (los mismos objetos de esta pasada): pedirlos de nuevo crea objetos distintos y
    // `unread.get()` no encuentra nada, que es lo que dejaba las filas sin su globito.
    return { byUser, unread, tickets: list, total, accepted, signature: signatures.join('||') };
  }
  function create({ getTickets, readMarks, now = Date.now }) {
    let lastTotal = null, lastAt = 0;
    function read() { return snapshot(getTickets() || [], readMarks() || {}); }
    function stableTotal(real) {
      const current = now();
      if(lastTotal > 0 && real === 0 && current - lastAt < 2200) return lastTotal;
      if(real !== lastTotal) { lastTotal = real; lastAt = current; }
      return real;
    }
    return { read, stableTotal };
  }
  return { create, snapshot, chatKey, readCutoff, unreadForTicket };
});
