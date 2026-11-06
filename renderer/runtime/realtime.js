(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory(require('./refresh-coordinator.js'));
  else root.NodoRealtime = factory(root.NodoRefresh);
})(globalThis, function(Refresh){
  'use strict';

  function create({ client, getOffice, getAliases, hasOpenChat, refresh, senal,
    notify = () => {}, playSound = () => {}, logger = console, timers = globalThis }) {
    const channels = new Map();
    const intervals = [];
    let stopped = false;
    let ultimaSenal = null;   // la última foto de la bandeja; mientras no cambie, no se baja nada
    const reads = Refresh.create({
      requests: refresh.requests, wallets: refresh.wallets, chats: refresh.chats,
      conversation: () => { if(hasOpenChat()) return refresh.conversation(); }
    }, { timers, onError: (error, name) => logger.warn('[RT] lectura ' + name, error) });

    function isMyOffice(pc) {
      const eventPc = String(pc || '').toUpperCase().trim();
      if(!eventPc) return true;
      let aliases;
      try { aliases = getAliases(); } catch(_) { aliases = [getOffice()]; }
      aliases = (aliases || []).map(x => String(x).toUpperCase().trim()).filter(Boolean);
      return !aliases.length || aliases.includes(eventPc);
    }
    function remove(key) {
      const channel = channels.get(key);
      channels.delete(key);
      if(channel) {
        try { Promise.resolve(client.removeChannel(channel)).catch(error => logger.warn('[RT] cierre', error)); }
        catch(error) { logger.warn('[RT] cierre', error); }
      }
    }
    function subscribe(key, name, type, filter, handler) {
      if(stopped || !client) return;
      remove(key);
      try {
        // Un callback de una suscripción reemplazada no debe disparar nuevas lecturas.
        const channel = client.channel(name);
        channels.set(key, channel);
        channel.on(type, filter, payload => {
          if(!stopped && channels.get(key) === channel) handler(payload);
        }).subscribe();
      } catch(error) { logger.warn('[RT] suscripción ' + name, error); }
    }
    function inserted() { notify('🔔 Nueva solicitud'); playSound('solicitud'); }
    function subscribeRequests() {
      subscribe('requests', 'solicitudes_' + getOffice(), 'postgres_changes', {
        event: '*', schema: 'public', table: 'solicitudes', filter: 'pc_codigo=eq.' + getOffice()
      }, payload => {
        reads.request('requests');
        if(payload.eventType === 'INSERT') inserted();
      });
    }
    function subscribeRequestBroadcast() {
      subscribe('requestBroadcast', 'nodo:solicitudes', 'broadcast', { event: 'cambio' }, msg => {
        const payload = msg && msg.payload;
        if(!isMyOffice(payload && payload.pc)) return;
        reads.request('requests');
        if(payload && String(payload.op) === 'INSERT') inserted();
      });
    }
    function subscribeChatBroadcast() {
      subscribe('chatBroadcast', 'nodo:chat', 'broadcast', { event: 'cambio' }, msg => {
        if(!isMyOffice(msg && msg.payload && msg.payload.pc)) return;
        reads.request('chats');
        if(hasOpenChat()) reads.request('conversation');
      });
    }
    function startPolling() {
      if(stopped || intervals.length) return;
      intervals.push(timers.setInterval(() => reads.request('requests'), 60000));
      intervals.push(timers.setInterval(() => reads.request('wallets'), 20000));
      // La conversación abierta y la lista de chats las pedía también el puente del portal, con su
      // propio reloj (5 s y 15 s): cada cosa se bajaba dos veces. Ahora este es el único reloj y
      // toma esos tiempos, que eran los que de verdad traían datos (Juan, 6/11).
      intervals.push(timers.setInterval(() => {
        if(hasOpenChat()) reads.request('conversation');
      }, 5000));
      // La lista de chats era la única sin reloj propio: se repintaba sólo cuando llegaba un aviso
      // por el canal `nodo:chat`. Si ese aviso no salía, la bandeja de consultas quedaba con el
      // orden y los contadores de hacía rato aunque los datos ya estuvieran en memoria (Juan, 2/10).
      intervals.push(timers.setInterval(() => reads.request('chats'), 15000));

      // Una solicitud tardaba hasta 60 s en aparecer, y aparecía de golpe. Bajar ese reloj a 10 s
      // costaría ~700 MB por turno en la oficina más cargada —más de lo que acabamos de sacar—
      // porque se traería la bandeja entera cada vez. Así que cada 10 s se pregunta sólo SI CAMBIÓ
      // algo (125 bytes, 24 ms) y la lista se baja únicamente cuando hay novedad de verdad.
      // El reloj de 60 s queda igual, como red de seguridad por si la señal falla (Juan, 2/10).
      if(typeof senal === 'function'){
        intervals.push(timers.setInterval(async () => {
          try{
            const ahora = await senal();
            if(!ahora) return;
            if(ultimaSenal !== null && ahora === ultimaSenal) return;   // nada nuevo: no se baja nada
            if(ultimaSenal === null){ ultimaSenal = ahora; return; }    // primera foto: sólo se guarda
            // La señal se da por consumida SÓLO si la bandeja entró de verdad.
            //
            // Antes se marcaba acá mismo, antes de leer. Si la lectura fallaba —y en P4 la bandeja
            // pesa 382 kB y tarda entre 187 y 1.104 ms, así que falla— esa novedad quedaba
            // consumida: en el tick siguiente la señal ya era igual a la guardada, no se pedía
            // nada, y la solicitud no aparecía hasta que pegara el reintento (8 s, 16 s, 32 s,
            // 60 s) o el reloj de 60 s. Con dos o tres entrando juntas, se acumulaban todas y
            // caían de golpe. Es lo que reportó Juan el 3/10.
            //
            // Ahora, si no entró, la señal queda sin consumir y se vuelve a pedir en el próximo
            // tick: la espera máxima pasa a ser 10 s, pase lo que pase con el reintento.
            // Se retiene SÓLO cuando se sabe que falló. Cualquier otra forma de respuesta se
            // trata como antes: el objetivo es cambiar el caso del error, no inventar reintentos
            // donde no los había. `skipped` es "había otra lectura en curso", no "ya la tengo".
            const r = await reads.request('requests');
            const fallo = !!(r && (r.error || r.skipped));
            if(!fallo) ultimaSenal = ahora;
          }catch(_e){}
        }, 10000));
      }
    }
    function stop() {
      if(stopped) return;
      stopped = true;
      reads.dispose();
      intervals.forEach(id => timers.clearInterval(id));
      intervals.length = 0;
      for(const key of channels.keys()) remove(key);
    }
    return { isMyOffice, subscribeRequests, subscribeRequestBroadcast,
      subscribeChatBroadcast, startPolling, stop };
  }
  return { create };
});
