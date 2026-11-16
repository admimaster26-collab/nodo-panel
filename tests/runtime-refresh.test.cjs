const { test } = require('node:test');
const assert = require('node:assert/strict');
const Refresh = require('../renderer/runtime/refresh-coordinator.js');
const Realtime = require('../renderer/runtime/realtime.js');
const { fakeClock, settle } = require('./helpers/clock.cjs');

test('100 señales simultáneas hacen una lectura, y señales durante ella dejan una lectura final', async () => {
  const timers = fakeClock();
  let count = 0, release;
  const reader = Refresh.create({ requests: () => { count++; return new Promise(r => { release = r; }); } }, { timers });
  for(let i = 0; i < 100; i++) reader.request('requests');
  timers.flush(); await settle();
  assert.equal(count, 1);
  for(let i = 0; i < 100; i++) reader.request('requests');
  timers.flush(); await settle();
  assert.equal(count, 1, 'no se superponen lecturas');
  release(); await settle(); timers.flush(); await settle();
  assert.equal(count, 2, 'no se pierde el cambio que llegó durante la lectura');
  release(); await settle(); reader.dispose();
});

test('un error se informa y no bloquea el próximo evento; dispose cancela pendientes', async () => {
  const timers = fakeClock();
  let errors = 0, count = 0;
  const reader = Refresh.create({ chats: () => { count++; throw Error('offline'); } }, { timers, onError: () => errors++ });
  reader.request('chats'); timers.flush(); await settle();
  assert.equal(errors, 1);
  reader.request('chats'); timers.flush(); await settle();
  assert.equal(count, 2);
  reader.request('chats'); reader.dispose(); timers.flush(); await settle();
  assert.equal(count, 2);
  assert.deepEqual(timers.counts(), { timeouts: 0, intervals: 0 });
});

function setup() {
  const timers = fakeClock(), channels = [], removed = [], reads = { requests: 0, chats: 0, wallets: 0, conversation: 0 };
  const client = {
    channel(name) {
      const channel = { name, on(type, filter, fn) { this.fn = fn; this.filter = filter; return this; }, subscribe() { return this; } };
      channels.push(channel); return channel;
    },
    removeChannel(channel) { removed.push(channel); }
  };
  const service = Realtime.create({ client, timers, getOffice: () => 'P4', getAliases: () => ['P4', 'PC4', 'SANCHEZ'],
    hasOpenChat: () => true, refresh: Object.fromEntries(Object.keys(reads).map(key => [key, () => reads[key]++])) });
  service.subscribeRequests(); service.subscribeRequestBroadcast(); service.subscribeChatBroadcast(); service.startPolling();
  return { timers, channels, removed, reads, service };
}

test('canales filtran oficinas y comparten la misma lectura de solicitudes', async () => {
  const { timers, channels, reads, service } = setup();
  channels[1].fn({ payload: { pc: 'P2' } });
  channels[2].fn({ payload: { pc: 'P2' } });
  timers.flush(); await settle();
  assert.equal(reads.requests + reads.chats, 0);
  channels[0].fn({ eventType: 'UPDATE' });
  channels[1].fn({ payload: { pc: 'PC4' } });
  channels[2].fn({ payload: { pc: 'SANCHEZ' } });
  timers.flush(); await settle();
  assert.deepEqual(reads, { requests: 1, chats: 1, wallets: 0, conversation: 1 });
  service.stop();
});

test('reemplazo y cierre eliminan canales/timers e ignoran eventos de suscripciones antiguas', async () => {
  const { timers, channels, removed, reads, service } = setup();
  service.startPolling();
  // Cuatro relojes: solicitudes, billeteras, la conversación abierta y la lista de chats. La de
  // chats se sumó el 2/10 — era la única que dependía de que llegara un aviso para repintarse.
  assert.equal(timers.counts().intervals, 4, 'iniciar dos veces no duplica polls');
  service.subscribeRequests();
  assert.equal(removed.length, 1);
  channels[0].fn({ eventType: 'UPDATE' }); timers.flush(); await settle();
  assert.equal(reads.requests, 0);
  timers.poll(); service.stop(); service.stop(); timers.flush(); await settle();
  assert.equal(removed.length, 4);
  channels.forEach(ch => ch.fn({ payload: { pc: 'P4' }, eventType: 'UPDATE' }));
  timers.flush(); await settle();
  assert.deepEqual(reads, { requests: 0, chats: 0, wallets: 0, conversation: 0 });
  assert.deepEqual(timers.counts(), { timeouts: 0, intervals: 0 });
});

// ── La señal barata de la bandeja ────────────────────────────────────────────
// Una solicitud tardaba hasta 60 s en aparecer. Bajar ese reloj a 10 s costaria ~700 MB por turno
// en la oficina mas cargada, porque se traeria la bandeja entera (246 kB) cada vez. Entonces cada
// 10 s se pregunta SOLO si cambio algo -- panel_bandeja_senal: 125 bytes, 24 ms -- y la lista se
// baja unicamente cuando hay novedad (Juan, 2/10).

// El reloj de 60 s baja la bandeja igual, y el coordinador junta las dos lecturas si caen en el
// mismo tick: con todos los intervalos disparando a la vez no se puede ver lo que agrega la senal.
// Aca se corre SOLO el intervalo de la senal -- que es el ultimo que registra startPolling -- que
// es como pasa de verdad: la senal va cada 10 s y el reloj grande cada 60.
function setupConSenal(valores) {
  const reloj = fakeClock();
  const deIntervalos = [];
  const timers = {
    setTimeout: (fn, ms) => reloj.setTimeout(fn, ms),
    clearTimeout: (id) => reloj.clearTimeout(id),
    setInterval: (fn, ms) => { deIntervalos.push({ fn, ms }); return reloj.setInterval(fn, ms); },
    clearInterval: (id) => reloj.clearInterval(id)
  };
  const reads = { requests: 0, chats: 0, wallets: 0, conversation: 0 };
  let i = 0; const pedidas = [];
  const client = { channel: () => ({ on(){ return this; }, subscribe(){ return this; } }), removeChannel(){} };
  const service = Realtime.create({
    client, timers, getOffice: () => 'P4', getAliases: () => ['P4'], hasOpenChat: () => false,
    refresh: Object.fromEntries(Object.keys(reads).map(k => [k, () => reads[k]++])),
    senal: async () => { pedidas.push(1); return valores[Math.min(i++, valores.length - 1)]; }
  });
  service.startPolling();
  const elDeLaSenal = deIntervalos.find(x => x.ms === 10000);
  return { reloj, reads, service, pedidas, elDeLaSenal };
}

// Una vuelta de la senal: se dispara su intervalo y se deja correr lo que haya encolado.
// El intervalo se ARRANCA y se espera al final: desde que la senal no se da por consumida hasta
// que la lectura entro, adentro hay un await que solo avanza cuando corre el reloj de aca.
// Esperarlo antes de hacer flush trababa la prueba contra si misma.
async function vuelta(s){
  const enVuelo = s.elDeLaSenal.fn();
  await settle();
  s.reloj.flush(); await settle();
  s.reloj.flush(); await settle();
  await Promise.resolve(enVuelo).catch(() => {});
  s.reloj.flush(); await settle();
}

test('senal · existe su propio reloj, de 10 segundos', () => {
  const s = setupConSenal(['x']);
  assert.ok(s.elDeLaSenal, 'startPolling tiene que registrar el reloj de la senal');
  s.service.stop();
});

test('senal · la primera lectura solo toma la foto, no baja la bandeja', async () => {
  const s = setupConSenal(['3|2026-10-02T10:00:00Z|x']);
  await vuelta(s);
  assert.equal(s.pedidas.length, 1, 'pregunta la senal: 125 bytes');
  assert.equal(s.reads.requests, 0, 'y NO se trae las 246 kB: todavia no sabe si cambio');
  s.service.stop();
});

test('senal · si no cambia nada, NO se baja la bandeja', async () => {
  const igual = '3|2026-10-02T10:00:00Z|x';
  const s = setupConSenal([igual, igual, igual, igual, igual]);
  for(let v = 0; v < 5; v++) await vuelta(s);
  assert.equal(s.pedidas.length, 5, 'pregunto las cinco veces');
  assert.equal(s.reads.requests, 0, 'cinco vueltas sin novedad = cero bajadas de 246 kB');
  s.service.stop();
});

test('senal · si cambia, baja la bandeja una vez y despues para', async () => {
  const s = setupConSenal(['3|A|x', '4|B|y', '4|B|y', '4|B|y']);
  await vuelta(s);
  assert.equal(s.reads.requests, 0, 'la foto inicial no baja nada');
  await vuelta(s);
  assert.equal(s.reads.requests, 1, 'cambio -> una bajada');
  await vuelta(s); await vuelta(s);
  assert.equal(s.reads.requests, 1, 'sigue igual -> no vuelve a bajar');
  s.service.stop();
});

test('senal · si la RPC no esta, no rompe nada', async () => {
  const s = setupConSenal([null, null, null]);
  for(let v = 0; v < 3; v++) await vuelta(s);
  assert.equal(s.reads.requests, 0, 'sin senal no inventa lecturas; queda el reloj de 60 s');
  s.service.stop();
});
// Juan, 16/11: "noté tardanza en el recibo de mensaje del usuario". El aviso del servidor caía dentro de la
// ventana de 15 s de la lista y se ignoraba: ahora avisa (chatChanged) para que la lectura no se saltee.
test('el aviso de mensaje nuevo pide la lista sin esperar el reloj', async () => {
  let cambios = 0;
  const Realtime = require('../renderer/runtime/realtime.js');
  const channels = [];
  const timers = { setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {} };
  const client = { channel: () => { const ch = { on(_t, _f, fn) { ch.fn = fn; return ch; }, subscribe() { return ch; } }; channels.push(ch); return ch; }, removeChannel() {} };
  const service = Realtime.create({ client, timers, getOffice: () => 'P1', getAliases: () => ['P1'], hasOpenChat: () => false,
    refresh: { requests() {}, wallets() {}, chats() {}, conversation() {} }, chatChanged: () => { cambios++; } });
  service.subscribeChatBroadcast();
  channels[0].fn({ payload: { pc: 'P2' } });
  assert.equal(cambios, 0, 'otra oficina: nada');
  channels[0].fn({ payload: { pc: 'P1', op: 'MSG' } });
  assert.equal(cambios, 1);
});
