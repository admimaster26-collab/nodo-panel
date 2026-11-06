/* Portal: requests. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRequests = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","_portalAutoRechazar","_v154pAvisoDesfasaje","alert","cargarAlertasRetiro","document","esc","getCanal","mapSolicitudPortal","money","normArr","operador","renderInicio","renderSolicitudesPortalCompleto","renderSolicitudesPortalEnInicio","rpc","setTimeout","solicitudes","toast","verificarSolicitudes","window"]);
  function create(deps){
const api = {};
// A successful transport is not evidence that the server supplied a usable list.
// Match the legacy envelopes accepted by data.normArr, without turning null/errors into [].
function _listaSolicitudesValida(data){
  const options=[data,data?.data,data?.data?.data,data?.mensaje,data?.mensajes,data?.chats,
    data?.solicitudes,data?.items,data?.rows];
  let rows=options.find(Array.isArray);
  if(!rows && data && typeof data==='object' && Object.keys(data).length && Object.keys(data).every(k=>/^\d+$/.test(k)))rows=Object.values(data);
  return !!rows && rows.every(row=>row && typeof row==='object' && !Array.isArray(row)
    && (row.id!=null || row.ID!=null || row.solicitud_id!=null));
}
// Leer la bandeja no reintentaba NADA, mientras que escribir (actualizarSolicitudPortal) ya
// reintenta 3 veces ante fallos de red, por "la mirror con proxy que pestañea". En una oficina con
// la red inestable eso deja la bandeja congelada: el operador ve "Esta lista está desactualizada",
// no le entra ninguna carga, y tiene que apretar Reintentar a mano hasta que una pega — y ahí le
// entran todas juntas. Reportado por OFI-SAN el 29/9 a las 21:10, y el cartel no mentía.
//
// Ahora la lectura reintenta igual que la escritura, y si aun así falla se vuelve a intentar sola
// con esperas cada vez más largas. Sin esto, entre intento e intento pasaban los 60 s del reloj de
// la bandeja, que es una eternidad con gente esperando que le carguen.
function _esErrorDeRed(e){
  const m = String((e && (e.message || e)) || '').toLowerCase();
  // "canceling statement due to statement timeout" NO es la red: es el servidor cortando una
  // consulta que tardó más de lo que tiene permitido (el panel entra como anon, con 3 s de tope).
  // Contenía la palabra "timeout" y caía acá, así que el cartel decía "se cortó la conexión" y se
  // reintentaba tres veces seguidas contra una base que ya estaba ahogada — empujando para el lado
  // equivocado. Se vio en la consola de Sánchez el 2/10 con el error desplegado.
  if(/statement timeout|canceling statement/.test(m)) return false;
  return /fetch failed|failed to fetch|network|timeout|econn|socket|load failed|networkerror/.test(m);
}
// Cada cambio de estado se traía la bandeja ENTERA otra vez, y encima la esperaba. En P4 la
// respuesta pesa 427 kB —cuatro veces la de P3, P6, P7 o P9— y una carga hace cuatro o cinco
// cambios de estado. Con 117 cargas en dos horas y media son 195 MB, unos 624 MB en un turno de
// ocho, bajados por una conexión de oficina para repintar una lista que casi nunca cambió.
// Es la explicación más probable de por qué a esa PC se le corta la bandeja y a las otras no.
//
// Ahora se refresca UNA vez cuando la ráfaga termina, y sin esperarla: el resultado de la
// operación no depende de que la lista esté repintada. Donde sí hace falta tenerla fresca, el
// llamador la pide él mismo (operation-execution.js ya lo hace en los puntos que importan).
let _refrescoPedido = null;
function refrescarBandejaPronto(){
  if(_refrescoPedido) return;
  _refrescoPedido = deps.setTimeout(function(){
    _refrescoPedido = null;
    try{ cargarSolicitudesPortal(true); }catch(_e){}
  }, 1200);
}

let _reintentoTimer = null, _reintentoNro = 0;
function _cancelarReintento(){
  if(_reintentoTimer){
    try{ deps.window.clearTimeout(_reintentoTimer); }catch(_e){}
    _reintentoTimer = null;
  }
  _reintentoNro = 0;
}
function _programarReintento(){
  if(_reintentoTimer) return;                                  // ya hay uno en camino
  _reintentoNro = Math.min(_reintentoNro + 1, 4);
  const espera = Math.min(8000 * Math.pow(2, _reintentoNro - 1), 60000);  // 8s · 16s · 32s · 60s
  _reintentoTimer = deps.setTimeout(function(){
    _reintentoTimer = null;
    try{ cargarSolicitudesPortal(true); }catch(_e){}
  }, espera);
}

// Refresco de los retiros sostenidos: corre DESPUÉS de pintar y fuera del cierre anti-solapamiento,
// así no puede clavar la bandeja. Con tope de cuántos y con límite de espera por cada uno — sin el
// límite, una sola llamada colgada volvía a dejar todo esperando, que es lo que se vino a arreglar.
const TOPE_SOSTENIDOS = 8;
const ESPERA_SOSTENIDO_MS = 6000;
let _sostenidosCorriendo = false;
async function refrescarSostenidos(lista){
  if(_sostenidosCorriendo || !lista || !lista.length) return;
  _sostenidosCorriendo = true;
  let cambio = false;
  try{
    for(const c of lista.slice(0, TOPE_SOSTENIDOS)){
      let fresco = null;
      try{
        const rp = await Promise.race([
          deps.rpc('landing_retiro_progreso', { p_solicitud_id: Number(c.id) }),
          new Promise(res => deps.setTimeout(function(){ res({ error:{ message:'timeout' } }); }, ESPERA_SOSTENIDO_MS))
        ]);
        const row = Array.isArray(rp && rp.data) ? rp.data[0] : (rp && rp.data);
        if(!(rp && rp.error) && row && row.ok !== false) fresco = row;
      }catch(_e){}
      // Sin respuesta de la base NO se suelta: un retiro con plata debida no puede perderse de
      // vista por un error de red. Se queda como está y se vuelve a preguntar en el próximo ciclo.
      if(!fresco) continue;
      try{
        let m = (c.v.METADATA !== undefined ? c.v.METADATA : c.v.metadata) || {};
        if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ m = {}; } }
        const rpPrev = (m && m.retiro_parcial) || {};
        const rpNuevo = Object.assign({}, rpPrev, {
          total: Number(fresco.total) || rpPrev.total,
          pagado: Number(fresco.pagado) || 0
        });
        if(fresco.pagos) rpNuevo.pagos = fresco.pagos;
        if(fresco.cierre) rpNuevo.cierre = fresco.cierre;
        const mNuevo = Object.assign({}, m, { retiro_parcial: rpNuevo });
        c.v.metadata = mNuevo; c.v.METADATA = mNuevo;
        if(fresco.estado) c.v.ESTADO = String(fresco.estado);
        cambio = true;
      }catch(_e){}
      // Saldado o cerrado en la base → se suelta. Es lo que antes no podía pasar nunca.
      const restante = Number(fresco.restante);
      if(fresco.cierre || (Number.isFinite(restante) && restante <= 0.5)){
        console.warn('[portal] retiro #'+c.id+' ya está saldado o cerrado en la base — se suelta');
        deps.V154P.solicitudes = (deps.V154P.solicitudes||[])
          .filter(function(x){ return String(x.ID||x.SOLICITUD_ID||'') !== String(c.id); });
        cambio = true;
      }
    }
  }finally{ _sostenidosCorriendo = false; }
  if(cambio){
    deps.window.solicitudes = (deps.V154P.solicitudes||[]).slice();
    try{ deps.renderSolicitudesPortalEnInicio(); }catch(_e){}
    try{ deps.renderSolicitudesPortalCompleto(); }catch(_e){}
  }
}

async function cargarSolicitudesPortal(silencioso=false){
    // SAFE: anti-solapamiento. Si hay una carga en curso, dejamos una sola cola.
    if(deps.V154P.solicitudesLoading){
      deps.V154P.solicitudesQueued = true;
      return {ok:true, skipped:true, reason:"solicitudes_loading"};
    }
    deps.V154P.solicitudesLoading = true;
    const health=deps.window.NodoSalud?.begin('BANDEJA');
    let healthStage='DATA';
    try{
      const canal = await deps.getCanal();
      // Sólo se insiste ante fallos de RED. Si el servidor contesta y rechaza, insistir no arregla
      // nada y sólo demora el aviso.
      let r = null;
      const _pApi = deps.window && deps.window.panelAPI;
      let _useBetaBandeja = false;
      if(_pApi && typeof _pApi.rpc === 'function' && canal){
        try{
          deps.V154P._bandejaCapCache = deps.V154P._bandejaCapCache || {};
          const _pcUp = String(canal).trim().toUpperCase();
          if(typeof _pApi.getContext === 'function'){
            const _rawCtx = await _pApi.getContext();
            const _ctx = (_rawCtx && _rawCtx.beta) ? _rawCtx.beta : _rawCtx;
            if(_ctx && _ctx.enabled === true && (!Array.isArray(_ctx.offices) || _ctx.offices.includes(_pcUp))){
              if(deps.V154P._bandejaCapCache[_pcUp] === undefined){
                const _capRes = await _pApi.rpc('nodo_beta_capacidades_v1', { p_pc_codigo: _pcUp, p_activate: false });
                const _capData = _capRes && _capRes.data;
                const _caps = (_capData && Array.isArray(_capData.capabilities)) ? _capData.capabilities : [];
                deps.V154P._bandejaCapCache[_pcUp] = !!(_capData && _capData.ok === true && _capData.enabled === true && _caps.includes('bandeja.queue.v1'));
              }
              _useBetaBandeja = deps.V154P._bandejaCapCache[_pcUp] === true;
            }
          }
        }catch(_e){ _useBetaBandeja = false; }
      }
      if(_useBetaBandeja){
        const _br = await _pApi.rpc('nodo_beta_bandeja_v1', { p_pc_codigo: String(canal).trim().toUpperCase(), p_filtros: {}, p_limit: 100, p_cursor: null });
        if(_br && !_br.error && _br.data && _br.data.ok === true && Array.isArray(_br.data.operativas)){
          deps.V154P.bandejaTotales = _br.data.totales || null;
          deps.V154P.bandejaHasMore = !!_br.data.has_more;
          deps.V154P.bandejaNextCursor = _br.data.next_cursor || null;
          r = { data: _br.data.operativas, error: null };
          health?.reply(null);
        } else if(_br && _br.error && (_br.error.code === 'PGRST202' || _br.error.code === '42883')){
          _useBetaBandeja = false;
        } else if(_br){
          r = _br;
          health?.reply(r?.error);
        }
      }
      for(let intento = 1; !_useBetaBandeja && intento <= 3; intento++){
        r = await deps.rpc("panel_v15_5_listar_solicitudes_portal", {p_pc_codigo: canal});
        health?.reply(r?.error);
        if(!r?.error || !_esErrorDeRed(r.error)) break;
        if(intento < 3) await new Promise(res => deps.setTimeout(res, 500 * intento));
      }

      if(health && !health.current())return {error:{code:'STALE_OFFICE',message:'La oficina cambió durante la consulta.'}};
      if(!r?.error && !_listaSolicitudesValida(r?.data)){
        r={data:null,error:{code:'BANDEJA_INVALID_DATA',message:'El servidor no devolvió una lista válida de solicitudes.'}};
      }
      if(r?.error){
        health?.record('DATA','ERROR',r.error.code==='BANDEJA_INVALID_DATA'?'BANDEJA_INVALID_DATA':health.errorCode(r.error));
        const msg = r.error.message || JSON.stringify(r.error);
        const box = deps.document.getElementById("tablaSolicitudesInicio");
        if(box && !deps.V154P.solicitudesLastHtml){
          box.innerHTML = `<div class="alert-box">Error solicitudes Portal: ${deps.esc(msg)}</div>`;
        }
        // Si ya había una lista pintada, se deja en pantalla para no vaciar la bandeja —
        // pero AVISANDO que está vieja. Sin esto los datos viejos se ven igual que los
        // frescos, y se puede aprobar dos veces algo que ya se resolvió.
        deps.V154P.solicitudesErrorAt = Date.now();
        deps.V154P.solicitudesEsRed = _esErrorDeRed(r.error);
        try{ deps._v154pAvisoDesfasaje(msg); }catch(_e){}
        // SIEMPRE a la consola, aunque la llamada sea silenciosa. `silencioso` existe para no
        // molestar al operador con carteles, no para tapar el diagnóstico: el reloj de 60 s de la
        // bandeja llama en silencio, así que TODOS los fallos del refresco automático quedaban sin
        // registrar. Cuando OFI-SAN reportó que no le entraban cargas, en su consola no había ni
        // una línea que dijera qué error era — había que adivinar entre red y servidor (29/9).
        console.error("[solicitudes portal] fallo el refresco",
          { silencioso: silencioso, esRed: _esErrorDeRed(r.error), error: r.error });
        _programarReintento();
        return r;
      }
      _cancelarReintento();
      deps.V154P.solicitudesOkAt = Date.now();
      deps.V154P.solicitudesErrorAt = null;
      deps.V154P.solicitudesEsRed = false;
      try{ deps._v154pAvisoDesfasaje(null); }catch(_e){}

      const _nuevas = deps.normArr(r.data).map(deps.mapSolicitudPortal);
      health?.record('DATA','OK','BANDEJA_LIST_VALID');

      // Medir ACÁ y no al dibujar: lo que se quiere saber es cuánto tardó el sistema en traer el
      // mensaje, no cuánto tardó el operador en abrir la conversación. Va a la consola de la PC,
      // el operador no ve nada. Ver renderer/core/latencia-panel.js.
      try{ if(deps.window.nodoLatencia) deps.window.nodoLatencia.medirTanda(_nuevas); }catch(_e){}
      // Un retiro a medio pagar NO puede desaparecer de la lista. La RPC filtra por estado, así que
      // al pasar el parcial a EN_PROCESO deja de devolverlo y el retiro se esfumaba del panel con
      // plata todavía debida — no había forma de terminar de pagarlo. Los que tienen progreso
      // parcial y ya no vienen del server se conservan del ciclo anterior, marcados, hasta que se
      // salden o los cierre alguien a mano.
      // La copia que se sostiene NO se refrescaba nunca: quedaba congelada con los números del
      // momento en que dejó de venir. Se pagaba el resto o se cerraba, y la copia vieja se volvía a
      // empujar en cada ciclo diciendo «falta $X» — no había forma de sacarla. Le pasó a #266250
      // (Maria6981x): pagado entero el 26/9 10:41 y seguía en la caja pidiendo $38.907 (D-109).
      // Ahora, antes de sostenerla, se le pregunta a la base cómo está.
      // Antes esto le preguntaba a la base POR CADA retiro sostenido, con `await`, DENTRO del
      // cargado de la bandeja. Cada sostenido sumaba un viaje a CADA refresco — y mientras corrían,
      // el cierre anti-solapamiento hacía que cualquier otro pedido saliera por "skipped",
      // incluido el botón del operador. Con la red lenta la bandeja queda clavada: se aprieta y no
      // pasa nada, hasta que termina el último viaje y entra todo junto. Es exactamente lo que
      // reportó OFI-SAN, y es de 2.1.3: en 2.1.2 este bloque no existía (ebfeaf3, 26/9).
      //
      // Ahora el sostenido entra a la lista EN EL ACTO — que era el punto, un retiro con plata
      // debida no puede desaparecer — y a la base se le pregunta DESPUÉS de pintar, sin bloquear.
      const _sostenidos = [];
      try{
        const _ids = new Set(_nuevas.map(function(x){ return String(x.ID||x.SOLICITUD_ID||''); }));
        (deps.V154P.solicitudes||[]).forEach(function(v){
          const id = String(v.ID||v.SOLICITUD_ID||'');
          if(!id || _ids.has(id)) return;
          const pp = deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(v) : null;
          if(pp && pp.hasProg && pp.restante > 0.5) _sostenidos.push({ id: id, v: v, pp: pp });
        });
        _sostenidos.forEach(function(c){
          c.v.__soloLocal = true;
          _nuevas.push(c.v);
          console.warn('[portal] retiro #'+c.id+' con '+deps.money(c.pp.restante)+' sin pagar dejó de venir de la RPC — se conserva local');
        });
      }catch(_e){}
      deps.V154P.solicitudes = _nuevas;
      try{ deps._portalAutoRechazar(deps.V154P.solicitudes); }catch(_e){}
      deps.window.solicitudes = deps.V154P.solicitudes.slice();
      try{ deps.solicitudes = deps.V154P.solicitudes.slice(); }catch(_e){}
      // Cosecha pasiva → base LOCAL de jugadores (portado de NexoBetaChan): cada solicitud del portal
      // trae usuario + teléfono y (según tipo) titular/CBU. Se registra UNA vez por solicitud (Set de
      // sesión) → TODO usuario que operó en el portal queda guardado, aunque nadie lo vincule a mano.
      try{
        if(deps.window.jugadorRegistrarDato && Array.isArray(deps.V154P.solicitudes)){
          deps.window.__jugHarvested = deps.window.__jugHarvested || new Set();
          const _tandaJug = [];
          deps.V154P.solicitudes.forEach(function(s){
            const sid = String(s.ID||s.SOLICITUD_ID||''); if(!sid || deps.window.__jugHarvested.has(sid)) return;
            // Una consulta de SOPORTE —y sobre todo un alta nueva ("soy nuevo, apodo X, tel Y")— es lo
            // que el cliente DECLARA, no un dato del sistema. Guardarla como jugador hacía que el cotejo
            // comparara la declaración contra sí misma y dijera "COINCIDEN · en sistema · mismo dueño"
            // para alguien sin cuenta (Juan, 12/09).
            if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='SOPORTE') return;
            const u = String(s.USUARIO||s.USUARIO_JUGADOR||'').trim(); if(!u) return;
            deps.window.__jugHarvested.add(sid);
            let meta = s.METADATA!==undefined?s.METADATA:(s.metadata||{});
            if(typeof meta==='string'){ try{ meta=JSON.parse(meta); }catch(_e){ meta={}; } }
            const esRet = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='RETIRO';
            const dato = {
              telefono: s.TELEFONO || s.telefono || (meta&&meta.telefono) || '',
              titular: s.TITULAR || s.NOMBRE_COMPLETO || (meta&&meta.titular) || '',
              // CBU/alias SOLO de retiros: en una carga ese campo es NUESTRA billetera.
              cbu: esRet ? String(s.CBU||s.CVU||s.CBU_ALIAS||s.DESTINO||(meta&&(meta.cbu||meta.destino))||'').trim() : '',
              fecha: s.FECHA_CREACION || s.FECHA || undefined
            };
            if(dato.telefono || dato.titular || dato.cbu) _tandaJug.push([u, dato]);
          });
          // Una sola lectura y escritura del almacén para toda la tanda (ver jugadorRegistrarDatos).
          if(deps.window.jugadorRegistrarDatos) deps.window.jugadorRegistrarDatos(_tandaJug);
          else _tandaJug.forEach(function(par){ deps.window.jugadorRegistrarDato(par[0], par[1]); });
        }
      }catch(_e){}
      // Actualizamos stats generales, pero la caja de inicio queda en manos del render portal.
      healthStage='RENDER';
      try{ if(typeof deps.renderInicio === "function") deps.renderInicio(); }catch(e){}
      deps.renderSolicitudesPortalEnInicio();
      const healthBox=deps.document.getElementById('tablaSolicitudesInicio');
      health?.record('RENDER',healthBox && healthBox.innerHTML && healthBox.innerHTML===deps.V154P.solicitudesLastHtml?'OK':'UNKNOWN',
        healthBox && healthBox.innerHTML && healthBox.innerHTML===deps.V154P.solicitudesLastHtml?'BANDEJA_DOM_UPDATED':'BANDEJA_DOM_UNCONFIRMED');
      // Si entró una carga con un retiro a medio pagar, ese parcial se cierra solo (Juan, 26/9).
      // Va después del render para no demorar la pantalla, y sin await: si falla, no arrastra nada.
      try{ if(deps.window.cerrarParcialesPorCarga) deps.window.cerrarParcialesPorCarga(); }catch(_e){}
      // NODO en Discord: los renglones se rearman con lo que acaba de llegar.
      try{ if(deps.window.actualizarPresenciaDiscord) deps.window.actualizarPresenciaDiscord(); }catch(_e){}
      // Alertas de retiro (bono sin liberar / CBU compartido): async y cacheadas 60 s.
      // Cuando llegan, vuelven a pintar la lista solas.
      try{ deps.cargarAlertasRetiro(); }catch(_e){}
      deps.renderSolicitudesPortalCompleto();
      // Recién acá, con la bandeja ya en pantalla y sin bloquear nada. Sin await a propósito.
      try{ refrescarSostenidos(_sostenidos); }catch(_e){}
      try{ if(typeof deps.verificarSolicitudes === "function") deps.verificarSolicitudes(silencioso); }catch(e){}

      // Auto-refrescar conversación abierta cuando llegan nuevas solicitudes SOPORTE
      try{
        if(deps.window.__nodoChatCurrentTicket && typeof deps.window.renderChatMensajes === "function"){
          const usr = String(deps.window.__nodoChatCurrentTicket.usuario||"").toUpperCase();
          if(typeof deps.window.ticketsAgrupados === "function"){
            const actualizado = deps.window.ticketsAgrupados().find(t=>String(t.usuario||"").toUpperCase()===usr);
            if(actualizado) deps.window.__nodoChatCurrentTicket = actualizado;
          }
          deps.window.renderChatMensajes();
        }
      }catch(_e){}
      return r;
    }catch(error){
      health?.record(healthStage,'ERROR',healthStage==='RENDER'?'BANDEJA_RENDER_FAILED':health.errorCode(error));
      throw error;
    }finally{
      deps.V154P.solicitudesLoading = false;
      if(deps.V154P.solicitudesQueued){
        deps.V154P.solicitudesQueued = false;
        deps.setTimeout(()=>cargarSolicitudesPortal(true), 350);
      }
    }
  }
  async function actualizarSolicitudPortal(id, estado, extra){
    const payload = {
      p_id: Number(id),
      p_estado: estado,
      p_operador: deps.window.operador?.usuario || deps.window.operador?.nombre
               || (typeof deps.operador!=='undefined' ? (deps.operador?.usuario||deps.operador?.nombre||'') : '')
               || "",
      p_monto: null,
      p_metadata: extra || {}
    };

    // Reintento ante fallos de RED ("fetch failed"/timeout/socket) — típico en la mirror con proxy
    // que pestañea. Setear el estado es IDEMPOTENTE, así que reintentar es seguro (no duplica nada).
    let r, ultimoErr;
    for(let intento = 1; intento <= 3; intento++){
      r = await deps.rpc("panel_v15_5_actualizar_solicitud_portal", payload);
      if(!r?.error){ refrescarBandejaPronto(); return r; }
      ultimoErr = r.error;
      const msg = String(r.error.message || r.error || '').toLowerCase();
      const esRed = /fetch failed|failed to fetch|network|timeout|econn|socket|load failed|networkerror/.test(msg);
      if(!esRed) break; // error real de negocio → no reintentar
      if(intento < 3){
        try{ deps.toast('Red inestable, reintentando actualización ('+intento+'/3)…','yellow'); }catch(_e){}
        await new Promise(res => deps.setTimeout(res, 600 * intento));
      }
    }

    deps.alert("Error actualizando solicitud: " + (ultimoErr?.message || JSON.stringify(ultimoErr)));
    return r;
  }


    return { globals: api, cargarSolicitudesPortal, actualizarSolicitudPortal };
  }
  return Object.freeze({ create, dependencies });
});
