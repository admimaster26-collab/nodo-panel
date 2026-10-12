// NODO escuchando los DOS caminos del chat a la vez.
//
// Hoy una consulta del portal se guarda como SOLICITUD, y de ahí sale todo lo que venimos
// arrastrando: la bandeja llena de chats, una conversación partida en 25 solicitudes, el peso que
// le corta la conexión a la oficina más cargada. El camino que corresponde —`chat_sesiones` /
// `chat_mensajes`, con `panel_core_get_chat_sesiones_json` de este lado— existe entero y está
// permitido, pero nadie lo usa.
//
// El plan es el de Juan (2/10): la página nueva manda al canal que corresponde, y mientras tanto
// NODO lee LOS DOS. Durante el cambio va a haber jugadores con la página vieja en el teléfono que
// no la refrescan —y si la refrescan va a ser tarde—, así que ninguna consulta puede quedar sin
// que alguien la vea por estar del lado equivocado.
//
// Esto SÓLO LEE y SÓLO SUMA. Si el canal nuevo no contesta o viene vacío, la bandeja queda
// exactamente como hoy. Cuando `verCaminos()` muestre que ya no llega nadie por el viejo, se apaga
// el viejo y esto queda como el único camino.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  const S = (v) => String(v == null ? '' : v);
  const U = (v) => S(v).trim().toUpperCase();

  // Siempre escuchando. Llegó a estar detrás de un interruptor, por miedo a que aparecieran de
  // golpe en la bandeja las 42 conversaciones de MAYO que viven en chat_sesiones de cuando se
  // probó este camino. Pero el interruptor no hacía falta: el que las deja afuera es el filtro de
  // abajo. Con los 7 días puestos, hoy aparecen DOS conversaciones y las dos son de P1, la oficina
  // de pruebas. Cero en todas las demás (verificado en la base, 3/10).
  //
  // Y tiene razón Juan: el portal nuevo va a escribir acá y el viejo sigue andando — un canal que
  // hay que acordarse de prender es un canal donde algún día no va a estar prendido.
  //
  // Lo que SÍ queda es el filtro: lo de mayo no vuelve nunca.
  const DIAS_UTILES = 7;

  let _sesiones = [];
  let _ultima = 0;
  let _enCurso = null;
  const VIVE_MS = 15000;                   // no se pide más seguido que el reloj de la lista

  async function pedirSesiones(){
    const pc = S(window.pcOperativa || '');
    if(!pc) return [];
    try{
      const r = await window.panelAPI.rpc('panel_core_get_chat_sesiones_json', { p_pc_codigo: pc });
      if(r && r.error){ console.warn('[canal nuevo] no se pudieron leer las sesiones', r.error); return _sesiones; }
      let filas = r && r.data;
      if(typeof filas === 'string'){ try{ filas = JSON.parse(filas); }catch(_e){ return _sesiones; } }
      if(filas && !Array.isArray(filas) && Array.isArray(filas.rows)) filas = filas.rows;
      return Array.isArray(filas) ? filas : [];
    }catch(e){
      console.warn('[canal nuevo] no se pudieron leer las sesiones', e);
      return _sesiones;
    }
  }

  async function cargarSesiones(forzar){
    const ahora = Date.now();
    if(!forzar && (ahora - _ultima) < VIVE_MS) return _sesiones;
    if(_enCurso) return _enCurso;
    _enCurso = pedirSesiones().then(function(filas){
      _sesiones = filas; _ultima = Date.now(); return _sesiones;
    }).finally(function(){ _enCurso = null; });
    return _enCurso;
  }

  // Una sesión del canal nuevo, con la forma que usa la lista de chats del panel.
  // El hilo completo NO se trae acá: son una llamada por conversación y la lista muestra sólo el
  // último mensaje. Se pide al abrir la conversación (mensajesDe).
  function comoTicket(s){
    const usuario = S(s.usuario || s.USUARIO || '');
    const clave = U(usuario).replace(/[^A-Z0-9]/g, '_');
    // Dos horas distintas, y hacen falta las dos:
    //   fechaUsuario = cuándo escribió por última vez EL JUGADOR → decide si hay algo sin leer
    //   fechaActiva  = última actividad de cualquiera            → ordena la lista
    const fechaUsuario = S(s.fecha_ultimo || s.updated_at || s.created_at || '');
    const fechaActiva  = S(s.updated_at || s.fecha_ultimo || s.created_at || '');
    const ultimo = S(s.ultimo_mensaje || '');
    // De quién es el texto que se muestra de adelanto. Antes esto no venía y acá se daba por
    // sentado que era del jugador: cada respuesta del operador —o del bot— se contaba como
    // mensaje nuevo, el chat volvía a "no leído" y saltaba el cartel "Nuevo mensaje de fulano"
    // con el texto de nuestra propia respuesta. (Juan, 4/10.)
    const ultimoDe = U(s.ultimo_de || 'USUARIO');
    const deOperador = /OPER|PANEL|ADMIN|BOT|ASISTENTE|SIST/.test(ultimoDe);
    const fechaUltimo = deOperador ? (fechaActiva || fechaUsuario) : fechaUsuario;
    const cerrado = U(s.estado || '') === 'CERRADO';
    // Antes decía `accepted: !cerrado`, o sea: toda conversación abierta nacía ya aceptada.
    // Consecuencia: nunca pasaba por "En espera", que es de donde sale el aviso de chat nuevo —
    // así que una consulta del portal entraba sin que sonara ni se encendiera nada, y el operador
    // sólo se enteraba si miraba la lista. (Juan, 3/10: "sin notificacion de nuevos chats".)
    // Ahora se pregunta lo mismo que para el resto: ¿este operador la aceptó?
    const aceptada = !!(window._wq2IsAccepted && window._wq2IsAccepted(usuario));
    return {
      id: 'CANAL_' + clave,
      usuario: usuario,
      telefono: S(s.telefono || ''),
      items: [],
      fecha: fechaActiva,
      mensaje: ultimo,
      solicitudId: S(s.solicitud_id || ''),
      masterId: null,
      accepted: !cerrado && aceptada,
      cerrado: cerrado,
      thread: ultimo ? [{ origen: deOperador ? ultimoDe : 'USUARIO', auto:s.ultimo_auto, operador:s.ultimo_operador||'', usuario: usuario, mensaje: ultimo, fecha: fechaUltimo }] : [],
      unread: Number(s.sin_leer) || 0,
      last: ultimo ? { origen: deOperador ? ultimoDe : 'USUARIO', auto:s.ultimo_auto, operador:s.ultimo_operador||'', usuario: usuario, mensaje: ultimo, fecha: fechaUltimo } : null,
      _canalNuevo: true,
      _chatId: S(s.chat_id || s.id || '')
    };
  }

  // Los mensajes de una conversación del canal nuevo. Una llamada, sólo al abrirla.
  async function mensajesDe(chatId){
    if(!chatId) return [];
    try{
      const r = await window.panelAPI.rpc('panel_core_get_chat_mensajes_json', { p_chat_id: S(chatId) });
      if(r && r.error){ console.warn('[canal nuevo] no se pudieron leer los mensajes', r.error); return []; }
      let filas = r && r.data;
      if(typeof filas === 'string'){ try{ filas = JSON.parse(filas); }catch(_e){ return []; } }
      if(filas && !Array.isArray(filas) && Array.isArray(filas.rows)) filas = filas.rows;
      if(!Array.isArray(filas)) return [];
      return filas.map(function(m){
        return NodoChatMessage.normalize(m);
      });
    }catch(e){ console.warn('[canal nuevo] no se pudieron leer los mensajes', e); return []; }
  }

  // Lo que consume la lista: las conversaciones del canal nuevo listas para mezclar.
  function ticketsDelCanalNuevo(incluirCerrados){
    const corte = Date.now() - DIAS_UTILES * 24 * 3600 * 1000;
    return (_sesiones || [])
      .filter(function(s){ return S(s.usuario || s.USUARIO || '').trim() !== ''; })
      .filter(function(s){ return incluirCerrados || U(s.estado || '') !== 'CERRADO'; })
      .filter(function(s){
        const t = new Date(s.fecha_ultimo || s.updated_at || s.created_at || 0).getTime();
        return isNaN(t) ? false : t >= corte;         // nada viejo vuelve a la bandeja
      })
      .map(comoTicket);
  }

  window._chatCanalNuevo = {
    cargar: cargarSesiones,
    tickets: ticketsDelCanalNuevo,
    mensajesDe: mensajesDe,
    crudas: function(){ return _sesiones.slice(); }
  };
})();

/* ============================================================
   NODO · CHAT STEP 5 THREAD FLOW FINAL SAFE
   Base: HTML actual de Noe.
   Corrige:
   - SOPORTE nuevo de usuario ya aceptado NO vuelve a En espera.
   - Abiertos/Abrir fluye como conversación.
   - Orden real por fecha de chat_thread + solicitudes nuevas.
   - Respuesta persiste en una conversación cabecera, no como ticket eterno.
   No toca historial, billeteras, cargas/retiros ni worker.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}
  function E(v){
    try{return escapeHtml(S(v))}catch(_e){
      return S(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  }
  function toDate(v){
    const d=new Date(v||0);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  // Un mensaje de ayer se veía igual que uno de hace veinte minutos: sólo la hora, nunca la fecha.
  // El 29/9 una consulta de P4 mostraba "11:13 a. m." y era del día anterior — 24 horas, y no había
  // forma de darse cuenta mirando la pantalla. Si no es de hoy, la fecha va adelante.
  function hora(v){
    const d=toDate(v);
    if(!d.getTime())return "";
    const hh=d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"});
    const hoy=new Date();
    if(d.getDate()===hoy.getDate() && d.getMonth()===hoy.getMonth() && d.getFullYear()===hoy.getFullYear())
      return hh;
    const ayer=new Date(hoy.getTime()-86400000);
    if(d.getDate()===ayer.getDate() && d.getMonth()===ayer.getMonth() && d.getFullYear()===ayer.getFullYear())
      return "ayer "+hh;
    return d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"})+" "+hh;
  }
  function iniciales(u){
    const p=S(u||"Usuario").trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0]||"U")+(p[1]?.[0]||"")).toUpperCase();
  }
  function avatarColor(u){
    const s=S(u||"U");let n=0;
    for(let i=0;i<s.length;i++) n=(n+s.charCodeAt(i))%360;
    return `hsl(${n} 68% 45%)`;
  }
  function metaObj(s){
    let m=s?.METADATA??s?.metadata??{};
    if(typeof m==="string"){try{m=JSON.parse(m)}catch(_e){m={}}}
    return (m&&typeof m==="object")?m:{};
  }
  function idSol(s){return Number(s?.ID||s?.SOLICITUD_ID||s?.id||0)}
  function usuarioSol(s){return S(s?.USUARIO||s?.USUARIO_JUGADOR||s?.usuario||"Usuario").trim()||"Usuario"}
  function msgSol(s){return s?.MENSAJE_INICIAL||s?.mensaje_inicial||s?.DESTINO||s?.destino||"Consulta desde portal"}
  function fechaSol(s){return s?.FECHA_CREACION||s?.FECHA||s?.created_at||s?.updated_at||new Date().toISOString()}
  function estadoSol(s){return U(s?.ESTADO||s?.estado)}
  function tipoSol(s){return U(s?.TIPO||s?.TIPO_SOLICITUD||s?.tipo)}

  const ACCEPT_KEY="nodo_chat_accepted_users_v2";
  function getAccepted(){try{return JSON.parse(localStorage.getItem(ACCEPT_KEY)||"{}")}catch(_e){return{}}}
  function setAccepted(usuario, masterId){
    const map=getAccepted();
    map[U(usuario)]={accepted:true,masterId:Number(masterId||0)||null,at:new Date().toISOString()};
    localStorage.setItem(ACCEPT_KEY,JSON.stringify(map));
  }
  function accInfo(usuario){return getAccepted()[U(usuario)]||null}
  function isAccepted(usuario){return !!accInfo(usuario)?.accepted}
  window._wq2IsAccepted=isAccepted;

  function storageKey(ticket){return "nodo_chat_local_master_"+String(ticket?.masterId||ticket?.usuario||"x").replace(/[^A-Z0-9]/gi,"_")}
  function getSavedMsgs(ticket){try{return JSON.parse(localStorage.getItem(storageKey(ticket))||"[]")}catch(_e){return[]}}
  function setSavedMsgs(ticket,msgs){try{localStorage.setItem(storageKey(ticket),JSON.stringify(msgs||[]))}catch(_e){}}

  function soporteRows(incluirCerrados){
    const arr=(window.V154P&&Array.isArray(V154P.solicitudes))?V154P.solicitudes:(Array.isArray(window.solicitudes)?window.solicitudes:[]);
    return arr.filter(s=>{
      if(tipoSol(s)!=="SOPORTE")return false;
      const e=estadoSol(s);
      if(["CANCELADO","RECHAZADA"].includes(e))return false;              // esos nunca
      if(!incluirCerrados && ["CERRADO","RESUELTA"].includes(e))return false; // cerrados solo si se piden
      return true;
    });
  }

  function normalizeThreadRow(m){
    return NodoChatMessage.normalize(m);
  }
  function uniqThread(arr){
    const seen=new Map();
    const out=[];
    (arr||[]).forEach(raw=>{
      const m=normalizeThreadRow(raw);
      // La copia local y la del servidor comparten autor, fecha, texto e imagen. No usamos
      // solicitud_id porque la copia local puede no tenerlo; combinamos sus datos sin perderlo.
      const k=NodoChatMessage.key(m);
      if(seen.has(k)){
        const index=seen.get(k);
        out[index]=NodoChatMessage.merge(out[index],m);
        return;
      }
      seen.set(k,out.length);out.push(m);
    });
    out.sort((a,b)=>toDate(a.fecha)-toDate(b.fecha));
    return out;
  }

  // ── Store LOCAL de chats CERRADOS ──────────────────────────────────────────
  // La RPC de solicitudes solo trae una ventana reciente → un chat cerrado viejo se cae de
  // V154P.solicitudes y desaparecía de la pestaña "Cerrados". Acá los persistimos (con su hilo)
  // en localStorage para que "Cerrados" muestre TODOS, sobrevivan reinicios y a la ventana del server.
  const CHATS_CERRADOS_KEY='nodo_chats_cerrados_v1';
  function _chatsCerradosAll(){ try{ return JSON.parse(localStorage.getItem(CHATS_CERRADOS_KEY)||'{}')||{}; }catch(_e){ return {}; } }
  function _chatsCerradosSave(map){
    try{
      const keys=Object.keys(map);
      if(keys.length>600){ keys.map(k=>({k,f:toDate(map[k].fecha||0)})).sort((a,b)=>a.f-b.f).slice(0,keys.length-600).forEach(x=>delete map[x.k]); }
      localStorage.setItem(CHATS_CERRADOS_KEY, JSON.stringify(map));
    }catch(_e){}
  }
  function _chatsCerradosGuardar(list){
    try{
      const map=_chatsCerradosAll(); let cambio=false;
      (list||[]).forEach(g=>{
        if(!g || !g.cerrado) return;
        const key=U(g.usuario||''); if(!key) return;
        map[key]={ id:g.id, usuario:g.usuario, telefono:g.telefono||'', thread:(g.thread||[]).slice(-200),
          masterId:g.masterId||null, solicitudId:g.solicitudId||'', fecha:g.fecha||'', mensaje:g.mensaje||'',
          items:(g.items||[]).map(s=>({ID:idSol(s)})).filter(x=>x.ID), _cachedAt:new Date().toISOString() };
        cambio=true;
      });
      if(cambio) _chatsCerradosSave(map);
    }catch(_e){}
  }
  function ticketsAgrupadosFinal(incluirCerrados){
    const map=new Map();
    // El alta de usuario NUEVO (portal → "Sos nuevo") manda el teléfono DENTRO de metadata
    // (landing_portal_v16_crear_solicitud no tiene columna TELEFONO propia para SOPORTE) —
    // fallback a metadata.telefono, si no el modal de vincular queda con el tel vacío.
    soporteRows(incluirCerrados).forEach(s=>{
      const usuario=usuarioSol(s);
      const key=U(usuario);
      const m0=metaObj(s);
      const tel0=S(s.TELEFONO||s.telefono||m0.telefono||m0.TELEFONO||"");
      if(!map.has(key)){
        map.set(key,{id:"TICKET_"+key.replace(/[^A-Z0-9]/g,"_"),usuario,telefono:tel0,items:[],fecha:"",mensaje:"",solicitudId:"",masterId:null,accepted:false,thread:[]});
      }
      const g=map.get(key);
      g.items.push(s);
      const sid=idSol(s);
      const m=m0;
      if(!g.telefono)g.telefono=tel0;
      const f=fechaSol(s);
      if(!g.fecha||toDate(f)>toDate(g.fecha))g.fecha=f;
      g.mensaje=msgSol(s);
      g.solicitudId=S(sid||"");
      if(Array.isArray(m.chat_thread)&&m.chat_thread.length){
        g.thread = uniqThread(g.thread.concat(m.chat_thread));
        g.accepted=true;
        g.masterId = Number(m.chat_master_id||m.master_id||sid||g.masterId||0)||g.masterId;
      }
      const ce=U(m.chat_estado||"");
      if(["ABIERTO_PANEL","RESPONDIDO_PANEL","CHAT_ABIERTO","ABIERTO"].includes(ce)){
        g.accepted=true;
        g.masterId = Number(m.chat_master_id||m.master_id||sid||g.masterId||0)||g.masterId;
      }
    });

    const list=Array.from(map.values()).map(g=>{
      const acc=accInfo(g.usuario);
      if(acc?.accepted){g.accepted=true;if(acc.masterId)g.masterId=acc.masterId}
      // Cerrado = TODAS sus solicitudes están en CERRADO/RESUELTA (el hilo sigue guardado en metadata).
      g.cerrado = g.items.length>0 && g.items.every(s=>["CERRADO","RESUELTA"].includes(estadoSol(s)));
      if(g.cerrado) g.accepted=false; // un cerrado no cuenta como "abierto"
      if(!g.masterId){
        // Cabecera: solicitud más reciente del usuario.
        const sorted=g.items.slice().sort((a,b)=>idSol(b)-idSol(a));
        g.masterId=idSol(sorted[0])||Number(g.solicitudId)||0;
      }
      // Mensajes de solicitudes no presentes aún en thread.
      const base=g.thread.slice();
      g.items.forEach(s=>{
        const sid=idSol(s);
        const mm=metaObj(s);
        const existing=base.find(m=>String(m.solicitud_id||"")===String(sid)&&U(m.origen)==="USUARIO");
        if(!existing&&sid){
          const entry={origen:"USUARIO",usuario:g.usuario,mensaje:msgSol(s),fecha:fechaSol(s),solicitud_id:sid};
          if(mm.imagen_url)entry.imagen_url=mm.imagen_url;
          base.push(entry);
        } else if(existing&&!existing.imagen_url&&mm.imagen_url){
          // La entrada ya existe en chat_thread pero sin imagen_url — parchear desde metadata
          existing.imagen_url=mm.imagen_url;
        }
      });
      // Mensajes locales no persistidos todavía.
      base.push(...getSavedMsgs(g).map(m=>normalizeThreadRow(m)));
      g.thread=uniqThread(base);
      g.unread=g.thread.filter(m=>U(m.origen)==="USUARIO").length;
      g.last=g.thread[g.thread.length-1]||null;
      if(g.last){g.fecha=g.last.fecha;g.mensaje=g.last.mensaje}
      return g;
    }).sort((a,b)=>toDate(b.fecha)-toDate(a.fecha));

    // ── El otro camino ────────────────────────────────────────────────────────
    // Mientras dura el cambio, NODO escucha los DOS: las consultas que llegan como solicitud (lo
    // de siempre, y lo que sigue mandando la página vieja que el jugador no refrescó) y las que
    // llegan al canal que corresponde. Ninguna puede quedar sin que alguien la vea por estar del
    // lado equivocado (Juan, 2/10).
    //
    // Sólo SUMA: el que ya está por solicitudes manda, porque trae el hilo completo y el estado
    // de atención. Del canal nuevo entran únicamente los que no aparecían por ningún lado.
    try{
      if(window._chatCanalNuevo){
        const porUsuario = new Map();
        list.forEach(g => { const k = U(g.usuario || ''); if(k) porUsuario.set(k, g); });
        window._chatCanalNuevo.tickets(incluirCerrados).forEach(function(t){
          const k = U(t.usuario || '');
          if(!k) return;
          const ya = porUsuario.get(k);
          if(!ya){ porUsuario.set(k, t); list.push(t); return; }
          // La conversación SIGUE ABIERTA pero por solicitudes el usuario figura cerrado.
          //
          // Pasa por la solicitud puente: es una solicitud de mentira que se crea para que las
          // PCs viejas vean los chats del portal nuevo. Cuando el operador cierra la consulta se
          // cierra el puente, y como acá un usuario se da por cerrado cuando TODAS sus
          // solicitudes lo están, el usuario entero salía de "Abiertos" — con la conversación
          // todavía viva del otro lado. En pantalla: "No hay chats abiertos" con el contador
          // marcando 2. Eran 69 conversaciones en 10 oficinas (Juan, 3/10).
          //
          // La conversación manda sobre el espejo: si ella está abierta, el ticket está abierto.
          if(ya.cerrado && !t.cerrado){
            ya.cerrado = false;
            ya.accepted = !!t.accepted;
            ya._canalNuevo = true;
            ya._chatId = t._chatId || ya._chatId;
            if(toDate(t.fecha) > toDate(ya.fecha)){ ya.fecha = t.fecha; ya.mensaje = t.mensaje; }
          }
        });
        list.sort((a,b)=>toDate(b.fecha)-toDate(a.fecha));
      }
    }catch(_e){}

    if(incluirCerrados){
      // 1) Persistir los cerrados que SÍ vinieron del server (con su hilo actualizado).
      try{ _chatsCerradosGuardar(list); }catch(_e){}
      // 2) Sumar los cerrados CACHEADOS que ya NO están en la ventana del server (el vivo gana).
      try{
        const presentes=new Set(list.map(g=>U(g.usuario||'')));
        const store=_chatsCerradosAll();
        Object.keys(store).forEach(k=>{
          if(presentes.has(k)) return;
          const c=store[k]||{};
          const items=(c.items||[]).map(it=>({ID:it.ID,SOLICITUD_ID:it.ID,ESTADO:"CERRADO",TIPO:"SOPORTE",metadata:{}}));
          const thread=Array.isArray(c.thread)?c.thread:[];
          list.push({ id:c.id||("TICKET_"+k.replace(/[^A-Z0-9]/g,"_")), usuario:c.usuario||k, telefono:c.telefono||"",
            items:items, fecha:c.fecha||"", mensaje:c.mensaje||"", solicitudId:c.solicitudId||"",
            masterId:c.masterId||null, accepted:false, thread:thread, cerrado:true,
            unread:0, last:(thread.length?thread[thread.length-1]:null), _localCerrado:true });
        });
        list.sort((a,b)=>toDate(b.fecha)-toDate(a.fecha));
      }catch(_e){}
    }

    return list;
  }

  window.ticketsAgrupados=ticketsAgrupadosFinal;

  const _chatImgFailed=new Set();
  window._chatImgError=function(src){_chatImgFailed.add(src);};

  function ensureCss(){
    if(document.getElementById("chatStep5FlowCss"))return;
    const st=document.createElement("style");
    st.id="chatStep5FlowCss";
    st.textContent=`
      .wq2-item.chat-open-final{background:#102018!important;border-left:3px solid #16a34a!important}
      .wq2-item.chat-open-final:hover{background:#12301f!important}
      .wq2-state.open-final{background:#14532d!important;color:#dcfce7!important}
      body.nodo-chat-open #viewChat .chat-layout{display:block!important;width:100%!important}
      body.nodo-chat-open #viewChat .chat-list{display:none!important}
      body.nodo-chat-open #viewChat .chat-panel{display:flex!important;flex-direction:column!important;width:100%!important}
      body.nodo-chat-open #chatBody{width:100%!important;max-width:none!important}
      .wq2-chat-bg{min-height:100%;padding:14px;background:#0b0f17;color:#e5e7eb}
      .wq2-row{display:flex;margin:7px 0;width:100%}
      .wq2-row.op{justify-content:flex-end}
      .wq2-bubble{max-width:70%;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.35;box-shadow:0 1px 1px #0006;word-break:break-word}
      .wq2-row.user .wq2-bubble{background:#1f2937;color:#e5e7eb}
      .wq2-row.op .wq2-bubble{background:#14532d;color:#dcfce7}
      .wq2-row.bot{justify-content:flex-end}
      .wq2-row.bot .wq2-bubble{background:#25204a;color:#eee7ff;border:1px solid #6558a4}
      .wq2-row.system{justify-content:center}
      .wq2-row.system .wq2-bubble{background:#17212d;color:#b7c3d2;border:1px dashed #657387}
      .wq2-author{font-size:11px;font-weight:700;margin-bottom:5px;letter-spacing:.02em}
      .wq2-time{font-size:10px;color:#9ca3af;margin-top:4px;text-align:right}
    `;
    document.head.appendChild(st);
  }

  window.wq2SetTab=function(tab){window.__wq2ActiveTab=tab;renderChatListStep2Final();}
  function tabActual(){return window.__wq2ActiveTab||"espera"}

  function renderChatListStep2Final(){
    ensureCss();
    const box=document.getElementById("chatList")||document.getElementById("v15ChatList");
    if(!box)return;

    const all=ticketsAgrupadosFinal(true);
    const espera=all.filter(t=>!t.accepted&&!t.cerrado);
    const abiertos=all.filter(t=>t.accepted&&!t.cerrado);
    const cerrados=all.filter(t=>t.cerrado);
    let tab=tabActual();
    if(tab==="espera"&&!espera.length&&abiertos.length)tab=window.__wq2ActiveTab="abiertos";

    const q=(document.getElementById("wq2Search")?.value||"").toLowerCase().trim();
    let pool=tab==="cerrados"?cerrados:tab==="abiertos"?abiertos:espera;
    if(q)pool=pool.filter(t=>(t.usuario+" "+t.telefono+" "+t.mensaje).toLowerCase().includes(q));

    try{
      const bc=document.getElementById("badgeChat");
      if(bc){ if(espera.length){bc.classList.remove("hidden");bc.textContent=String(espera.length)}else bc.classList.add("hidden");}
      const stat=document.getElementById("statChats");
      if(stat)stat.textContent=String(espera.length);
      try{ window.__wq2EnEspera=espera.length; }catch(_e){} // fuente ACTUAL de "sin leer" (el banner de Inicio la usa)
    }catch(_e){}

    const tabBtn=(id,label,count,active)=>`<button class="wq2-tab${active?" active":""}" onclick="wq2SetTab('${id}')">${label}${count?` <span class="wq2-count">${count}</span>`:""}</button>`;
    let html=`<div class="wq2-wrap">
      <div class="wq2-search"><input id="wq2Search" placeholder="Nombre, número o usuario..." oninput="renderChatListStep2Final()" value="${E(q)}"></div>
      <div class="wq2-tabs">
        ${tabBtn("espera","En espera",espera.length,tab==="espera")}
        ${tabBtn("abiertos","Abiertos",abiertos.length,tab==="abiertos")}
        ${tabBtn("cerrados","Cerrados",cerrados.length,tab==="cerrados")}
      </div>`;

    if(!pool.length){
      html+=`<div class="wq2-empty">${tab==="cerrados"?"No hay chats cerrados recientes.":tab==="abiertos"?"No hay chats abiertos.":tab==="interno"?"Sin mensajes internos.":"No hay consultas en espera."}</div>`;
    }else{
      pool.forEach(t=>{
        const active=U(window.__nodoChatCurrentUser||"")===U(t.usuario);
        const accepted=!!t.accepted;
        // La consulta ya tomada se abre tocando la tarjeta: el botón "Abrir" duplicaba el gesto.
        // "Aceptar" SÍ sigue siendo botón — toma el ticket a tu nombre, no es sólo mirar.
        const clickeable = accepted && !t.cerrado;
        // Sin linea de estado: "ABIERTO" ya lo dice la solapa donde estás, y ni el contador de
        // mensajes ni el N° de solicitud se usan para nada acá — el operador no decide con eso.
        // Quedan avatar, usuario, último mensaje y hora, que es lo que se mira para elegir un chat.
        html+=`<div class="wq2-item ${active?"active":""} ${accepted?"chat-open-final":""}"
            ${clickeable?`onclick="aceptarTicketLocalStep2('${E(t.id)}')" style="cursor:pointer" title="Abrir la conversación"`:""}>
          <div class="wq2-avatar" style="background:${avatarColor(t.usuario)}">${iniciales(t.usuario)}</div>
          <div style="min-width:0">
            <div class="wq2-name">${E(t.usuario)}</div>
            <div class="wq2-msg">${E(t.mensaje||"")}</div>
          </div>
          <div>
            <div class="wq2-meta">${hora(t.fecha)}</div>
            ${t.cerrado
              ? `<button class="wq2-accept" style="background:#7c3aed" onclick="event.stopPropagation();reabrirConsultaWq2('${E(t.id)}')" title="Reabrir esta consulta para seguir escribiéndole al cliente">↩ Reabrir</button>`
              : accepted
                ? ``
                : `<button class="wq2-accept" onclick="event.stopPropagation();aceptarTicketLocalStep2('${E(t.id)}')">Aceptar</button>`}
          </div>
        </div>`;
      });
    }
    html+=`</div>`;
    box.innerHTML=html;
  }

  window.renderChatListStep2=renderChatListStep2Final;
  window.v15RenderChatList=renderChatListStep2Final;
  window.cargarChats=async function(){renderChatListStep2Final();return{ok:true,data:ticketsAgrupadosFinal()}};
  window.v15CargarChatsCompacto=window.cargarChats;

  window.aceptarTicketLocalStep2=function(ticketId){
    const ticket=ticketsAgrupadosFinal().find(t=>t.id===ticketId);
    if(!ticket){alert("No encontré la consulta. Actualizá chats.");return;}
    setAccepted(ticket.usuario,ticket.masterId);
    ticket.accepted=true;
    window.__nodoChatCurrentUser=ticket.usuario;
    window.__nodoChatCurrentTicket=ticket;
    document.body.classList.add("nodo-chat-open");
    // Cargar chat_mensajes para obtener imagen_url de mensajes de usuarios
    try{
      const sol=(ticket.items||[]).find(s=>metaObj(s).chat_id||s.chat_id||s.CHAT_ID);
      const chatId=sol&&(sol.CHAT_ID||sol.chat_id||metaObj(sol).chat_id||"");
      if(chatId){
        window.chatActualId=String(chatId);
        if(window.V154P)window.V154P.chatActual=String(chatId);
        if(typeof window._v154pCargarChat==="function")setTimeout(()=>window._v154pCargarChat(true),400);
      }
    }catch(_e){}
    renderChatListStep2Final();
    renderChatConversationStep5();
    persistirChatStep5(ticket,"ABIERTO_PANEL").catch(e=>console.warn("persist accept step5",e));
  };

  function renderChatConversationStep5(){
    ensureCss();
    const bodies=[document.getElementById("chatBody"),document.getElementById("v15ChatBody")].filter(Boolean);
    if(!bodies.length)return;
    // Smart scroll: solo bajar automático si ya estaba cerca del final
    const atBottom=bodies.map(box=>(box.scrollHeight-box.scrollTop-box.clientHeight)<100);
    const ticket=window.__nodoChatCurrentTicket;
    const titulo=document.getElementById("chatTitulo");
    const sub=document.getElementById("chatSubtitulo");

    if(!ticket){
      if(titulo)titulo.textContent="Seleccioná un chat";
      if(sub)sub.textContent="Sin conversación abierta";
      bodies.forEach(box=>box.innerHTML=`<div class="alert-box">Seleccioná un chat para responder.</div>`);
      const compactTitle=document.getElementById("v15ChatTitulo");
      if(compactTitle)compactTitle.textContent="Seleccioná un chat";
      try{ if(typeof window.actualizarPreviewSolicitudChat==='function') window.actualizarPreviewSolicitudChat(null); }catch(_e){}
      return;
    }
    // refrescar ticket con últimos datos
    const fresh=ticketsAgrupadosFinal().find(t=>U(t.usuario)===U(ticket.usuario))||ticket;
    window.__nodoChatCurrentTicket=fresh;
    try{ if(typeof window.actualizarPreviewSolicitudChat==='function') window.actualizarPreviewSolicitudChat(fresh.usuario); }catch(_e){}
    if(titulo)titulo.textContent=fresh.usuario;
    const compactTitle=document.getElementById("v15ChatTitulo");
    const compactSub=document.getElementById("v15ChatSubtitulo");
    if(compactTitle)compactTitle.textContent=fresh.usuario;
    if(compactSub)compactSub.textContent="Conversación con usuario, asistente y operador";
    if(sub)sub.innerHTML=`Sol. ${E(fresh.masterId||fresh.solicitudId||"")} · Consulta portal <button onclick="vincularDesdeConsulta()" style="margin-left:8px;background:#1e3a5f;color:#7cc4ff;border:0;border-radius:8px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer">🔗 Validar y vincular</button> <button onclick="cerrarConsultaWq2()" style="margin-left:6px;background:#7f1d1d;color:#fca5a5;border:0;border-radius:8px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer">✕ Cerrar consulta</button>`;
    // COTEJO PREVIO: apenas se abre la consulta verificamos usuario y teléfono DECLARADOS contra la
    // base, ANTES de apretar "Validar y vincular" (panel insertado debajo del subtítulo).
    try{
      let _cot=document.getElementById("altaCotejoConsulta");
      if(!_cot && sub && sub.parentNode){
        _cot=document.createElement("div"); _cot.id="altaCotejoConsulta";
        sub.parentNode.insertBefore(_cot, sub.nextSibling);
      }
      if(window._altaCotejoConsulta) window._altaCotejoConsulta(fresh);
    }catch(_e){}

    // Mezclamos el thread del SERVIDOR con la copia LOCAL (localStorage). Antes el render leía
    // solo fresh.thread → el mensaje recién enviado desaparecía hasta el próximo poll (~15s), que
    // se percibía como "no guarda los mensajes". El localStorage ya se escribe al enviar; uniqThread
    // dedup-ea (mismo origen+fecha+mensaje), así el server y el local no se duplican, y los mensajes
    // aún-no-propagados al server igual se ven y sobreviven una recarga.
    const msgs=uniqThread((fresh.thread||[]).concat(getSavedMsgs(fresh)));
    // Parchear imagen_url desde window.chatMensajes cuando el RPC no lo incluye en chat_thread.
    // Matching por timestamp más cercano (diferencia < 5 min) para evitar asignar imagen incorrecta
    // cuando hay múltiples mensajes con imagen.
    const cmArr=(window.chatMensajes||window.V154P?.chatMensajes||[]);
    const usedCm=new Set();
    if(cmArr.length){
      msgs.forEach(m=>{
        if(m.imagen_url||NodoChatMessage.role(m)!=="USUARIO")return;
        const mts=toDate(m.fecha).getTime();
        let best=null,bestDiff=5*60*1000;
        cmArr.forEach((c,i)=>{
          if(usedCm.has(i)||!c.IMAGEN_URL)return;
          if(NodoChatMessage.role(c)!=="USUARIO")return;
          const diff=Math.abs(toDate(c.FECHA).getTime()-mts);
          if(diff<bestDiff){bestDiff=diff;best=i;}
        });
        if(best!==null){m.imagen_url=cmArr[best].IMAGEN_URL;usedCm.add(best);}
      });
    }
    let html=`<div class="wq2-chat-bg">`;
    msgs.forEach(m=>{
      const op=NodoChatMessage.role(m)==="OPERADOR";
      const imgSrc=m.imagen_url||m.imagen||"";
      const imgHtml=(imgSrc&&!_chatImgFailed.has(imgSrc))?`<img src="${E(imgSrc)}" style="max-width:220px;border-radius:8px;margin-top:6px;display:block;cursor:pointer" title="Ver imagen" onclick="window.open(this.src,'_blank')" onerror="window._chatImgError('${E(imgSrc)}')">` : "";
      const editBtn=(op && !imgSrc && m.fecha)?`<button class="wq2-edit" onclick="editarMensajeOperador('${E(m.fecha)}')" title="Editar este mensaje (también se actualiza para el cliente)">✏️</button>`:"";
      const editedTag=m.editado?`<span class="wq2-edited" title="Mensaje editado">· editado</span>`:"";
      html+=`<div class="wq2-row ${NodoChatMessage.className(m)}"><div class="wq2-bubble"><div class="wq2-author">${E(NodoChatMessage.author(m,fresh.usuario))}</div>${E(NodoChatMessage.visibleText(m)).replace(/\n/g,"<br>")}${imgHtml}<div class="wq2-time" title="${E(m.fecha)}">${hora(m.fecha)}${editedTag}${editBtn}</div></div></div>`;
    });
    html+=`</div>`;
    bodies.forEach((box,i)=>{
      if(box.innerHTML!==html){
        box.innerHTML=html;
        if(atBottom[i])box.scrollTop=box.scrollHeight;
      }
    });
  }
  window.renderChatMensajes=renderChatConversationStep5;
  window.v15RenderChatMensajes=renderChatConversationStep5;
  window.cargarChatActual=async function(){renderChatConversationStep5();return{ok:true}};

  // Editar un mensaje ya enviado por el operador (por si se equivocó). Actualiza la copia local +
  // el chat_thread del servidor → el cliente ve el texto corregido en el portal. Modal (no prompt,
  // que en Electron no anda). Marca el mensaje como "editado".
  window.editarMensajeOperador=function(fechaIso){
    const ticket=window.__nodoChatCurrentTicket; if(!ticket) return;
    const fresh=ticketsAgrupadosFinal().find(t=>U(t.usuario)===U(ticket.usuario))||ticket;
    const merged=uniqThread((fresh.thread||[]).concat(getSavedMsgs(fresh)));
    const m=merged.find(x=>String(x.fecha)===String(fechaIso)&&NodoChatMessage.role(x)==="OPERADOR");
    if(!m){ try{toast('No encontré el mensaje.','red');}catch(_e){} return; }
    if(typeof abrirModal!=="function"){ return; }
    abrirModal('✏️ Editar mensaje',
      '<div class="small" style="margin-bottom:6px;color:#8b949e">El mensaje se actualiza también para el cliente en el portal.</div>'+
      '<textarea id="editMsgTxt" rows="3" style="width:100%">'+E(m.mensaje||'')+'</textarea>',
      async function(){
        const texto=String((document.getElementById('editMsgTxt')||{}).value||'').trim();
        try{ cerrarModal(); }catch(_e){}
        if(!texto || texto===String(m.mensaje||'')) return;
        // 1) copia local
        try{ const saved=getSavedMsgs(fresh); let ch=false; saved.forEach(x=>{ if(String(x.fecha)===String(fechaIso)&&NodoChatMessage.role(x)==="OPERADOR"){ x.mensaje=texto; x.editado=true; ch=true; } }); if(ch) setSavedMsgs(fresh,saved); }catch(_e){}
        // 2) chat_thread del servidor (lo que lee el portal)
        try{
          const masterId=Number(fresh.masterId||fresh.solicitudId||0);
          const edited=(fresh.thread||[]).map(x=> (String(x.fecha)===String(fechaIso)&&NodoChatMessage.role(x)==="OPERADOR") ? Object.assign({},x,{mensaje:texto,editado:true}) : x);
          fresh.thread=edited;
          if(masterId && typeof actualizarSolicitudPortal==="function"){
            await actualizarSolicitudPortal(masterId,"EN_REVISION",{chat_estado:"RESPONDIDO_PANEL",chat_master_id:masterId,chat_thread:edited});
          }
        }catch(e){ try{toast('No se pudo guardar la edición: '+(e.message||e),'red');}catch(_e){} }
        try{ renderChatConversationStep5(); }catch(_e){}
        try{ toast('✏️ Mensaje editado','green'); }catch(_e){}
      }, 'Guardar');
  };

  async function persistirChatStep5(ticket,estadoChat,extraMsg=null){
    if(typeof actualizarSolicitudPortal!=="function")throw new Error("actualizarSolicitudPortal no disponible");
    const operador=(window.operador?.usuario||window.operador?.nombre||"panel");
    const fresh=ticketsAgrupadosFinal().find(t=>U(t.usuario)===U(ticket.usuario))||ticket;
    const thread=uniqThread(fresh.thread);
    // Si localStorage falló al guardar (ej. imagen base64 grande), incluir el mensaje directamente
    if(extraMsg){
      const yaEsta=thread.some(m=>m.fecha===extraMsg.fecha&&U(m.origen)==="OPERADOR");
      if(!yaEsta)thread.push(extraMsg);
    }
    const masterId=Number(fresh.masterId||fresh.solicitudId||0);

    if(masterId){
      await actualizarSolicitudPortal(masterId,"EN_REVISION",{
        chat_estado:estadoChat||"ABIERTO_PANEL",
        chat_master_id:masterId,
        chat_operador:operador,
        chat_ultimo_operador:operador,
        chat_ultima_respuesta_at:new Date().toISOString(),
        chat_thread:thread
      });
    }

    // Absorber nuevas SOPORTE del mismo usuario para que no vuelvan a En espera. Esto es bookkeeping:
    // NO lo esperamos (era la causa de que "el mensaje tarde en enviarse" cuando el usuario tenía
    // varias solicitudes). Corre en background; el mensaje ya quedó guardado en el thread del master.
    (async()=>{
      for(const s of (fresh.items||[])){
        const sid=idSol(s);
        if(!sid||sid===masterId)continue;
        const m=metaObj(s);
        if(U(m.chat_estado)!=="ABSORBIDO_PANEL"){
          try{
            await actualizarSolicitudPortal(sid,"EN_REVISION",{
              chat_estado:"ABSORBIDO_PANEL",
              chat_master_id:masterId,
              chat_thread_ref:masterId
            });
          }catch(e){ console.warn("absorber SOPORTE bg:",e); }
        }
      }
    })();
  }

  window.enviarChat=async function(inputId){
    const ticket=window.__nodoChatCurrentTicket;
    if(!ticket){alert("Abrí un chat primero.");return{ok:false}}
    const input=document.getElementById(inputId==="v15ChatInput"?inputId:"chatInput")||document.getElementById("v15ChatInput");
    const msg=S(input?.value).trim();
    // Si hay una imagen subiendo, esperar a que termine para mandar la URL liviana (no el base64 pesado)
    if(window.chatImagenBase64 && !window.chatImagenUrl && window._chatImgUploadPromise){
      try{ await window._chatImgUploadPromise; }catch(_e){}
    }
    const imagen=window.chatImagenUrl||window.chatImagenBase64||"";
    if(!msg&&!imagen)return{ok:true};

    const fresh=ticketsAgrupadosFinal().find(t=>U(t.usuario)===U(ticket.usuario))||ticket;
    const saved=getSavedMsgs(fresh);
    const msgObj={origen:"OPERADOR",tipo:"OPERADOR",usuario:fresh.usuario,operador:(window.operador?.usuario||window.operador?.nombre||"panel"),mensaje:msg,fecha:new Date().toISOString()};
    if(imagen)msgObj.imagen_url=imagen;
    saved.push(msgObj);
    setSavedMsgs(fresh,saved);
    if(input)input.value="";
    try{window.chatImagenBase64="";window.chatImagenUrl=null;if(typeof quitarImagenChat==="function")quitarImagenChat();}catch(_e){}
    renderChatConversationStep5();

    try{
      await persistirChatStep5(fresh,"RESPONDIDO_PANEL",msgObj);
      // El reply va al chat_thread de la solicitud SOPORTE; el portal lo lee con landing_portal_chat_thread_get (arreglado para usuarios nuevos sin vínculo).
      try{if(typeof toast==="function")toast("Respuesta guardada para portal","green")}catch(_e){}
      // Push al usuario en el portal
      try{
        const _pu=String(fresh.usuario||"").toLowerCase().trim();
        if(_pu){
          const _pb=msg||(imagen?"[Imagen adjunta]":"Mensaje nuevo");
          fetch(window.PUSH_API_URL,{
            method:"POST",
            headers:{"Content-Type":"application/json","x-push-secret":window.PUSH_SECRET},
            body:JSON.stringify({usuario:_pu,title:"BET300 · Operador",body:_pb.substring(0,120),url:"/",tag:"bet300-op"})
          }).catch(()=>{});
        }
      }catch(_p){}
      // Releer y mantener abierto
      setTimeout(()=>{renderChatListStep2Final();renderChatConversationStep5()},600);
      return{ok:true};
    }catch(e){
      console.warn("persist step5 send",e);
      alert("La respuesta quedó local, pero no se pudo guardar: "+(e.message||e));
      return{ok:false,error:e};
    }
  };
  window.v15EnviarChatCompacto=function(){return window.enviarChat("v15ChatInput");};

  // Envía un mensaje del operador al thread del portal para un usuario dado, SIN depender del input
  // ni de tener el chat abierto. Lo usa el flujo de vinculación para avisar "ya podés ingresar" con
  // la info de acceso + la marca ⟦INGRESAR⟧ (el portal la convierte en un botón "Ingresar").
  // Devuelve {ok:false,error:"sin-ticket"} si el usuario no tiene una consulta/soporte abierta.
  window.nodoEnviarMensajePortal=async function(usuario,texto,preferirTicketAbierto){
    texto=S(texto);
    if(!texto) return {ok:false,error:"faltan-datos"};
    // Ruteo: si la acción viene del CHAT/CONSULTA (preferirTicketAbierto=true) preferimos el ticket
    // ABIERTO — en un alta-nueva el usuario CAMBIA (apodo → usuario real) y buscar por el usuario
    // nuevo no encontraría el ticket (sigue bajo el apodo). PERO desde la validación MANUAL (sin
    // chat de por medio) NO usamos el ticket abierto: iría al chat equivocado (bug). Ahí ruteamos
    // por usuario. Fallback en ambos casos: por usuario.
    let fresh = (preferirTicketAbierto && window.__nodoChatCurrentTicket)
      ? (ticketsAgrupadosFinal().find(t=>U(t.usuario)===U(window.__nodoChatCurrentTicket.usuario)) || window.__nodoChatCurrentTicket)
      : null;
    if(!fresh){ const u=U(usuario); if(u) fresh=ticketsAgrupadosFinal().find(t=>U(t.usuario)===u); }
    if(!fresh) return {ok:false,error:"sin-ticket"};
    const msgObj={origen:"OPERADOR",tipo:"OPERADOR",usuario:fresh.usuario,operador:(window.operador?.usuario||window.operador?.nombre||"panel"),mensaje:texto,fecha:new Date().toISOString()};
    const saved=getSavedMsgs(fresh); saved.push(msgObj); setSavedMsgs(fresh,saved);
    try{
      await persistirChatStep5(fresh,"RESPONDIDO_PANEL",msgObj);
      try{
        const _pu=String(fresh.usuario||"").toLowerCase().trim();
        if(_pu&&window.PUSH_API_URL){
          fetch(window.PUSH_API_URL,{method:"POST",headers:{"Content-Type":"application/json","x-push-secret":window.PUSH_SECRET},body:JSON.stringify({usuario:_pu,title:"BET300 · Operador",body:texto.substring(0,120),url:"/",tag:"bet300-op"})}).catch(()=>{});
        }
      }catch(_p){}
      try{ renderChatListStep2Final(); renderChatConversationStep5(); }catch(_r){}
      return {ok:true};
    }catch(e){ return {ok:false,error:e.message||String(e)}; }
  };

  // ── Escribirle a un jugador que no tiene conversación abierta (D-73) ─────────────────────
  // nodoEnviarMensajePortal sólo sabe RESPONDER: sin ticket devuelve "sin-ticket", y el panel no
  // tenía ninguna forma de empezar una conversación. panel_chat_iniciar crea la solicitud de
  // SOPORTE —la misma que lee el portal— con nuestro mensaje como primero del hilo, o lo suma a la
  // que ya exista en esta oficina.
  window.nodoIniciarChat=async function(usuario,texto){
    const u=S(usuario).trim(); texto=S(texto).trim();
    if(!u||!texto) return {ok:false,error:"faltan-datos"};
    // Si ya tiene conversación en la bandeja, va por el camino de siempre.
    try{
      const r0=await window.nodoEnviarMensajePortal(u,texto,false);
      if(r0&&r0.ok) return {ok:true,existente:true};
      if(r0&&r0.error&&r0.error!=="sin-ticket") return r0;
    }catch(_e){}
    const op=(window.operador?.usuario||window.operador?.nombre||"panel");
    const pc=((typeof pcOperativa!=="undefined"&&pcOperativa)||window.pcOperativa||"");
    const {data,error}=await supabaseClient.rpc("panel_chat_iniciar",{
      p_secret:window.PANEL_DATA_SECRET, p_pc_codigo:pc, p_usuario:u, p_mensaje:texto, p_operador:op });
    if(error) return {ok:false,error:error.message||String(error)};
    if(!data||data.ok!==true) return {ok:false,error:(data&&data.error)||"sin-detalle"};
    // El portal muestra el hilo cuando el jugador abre el chat: el push es lo que le avisa que hay algo.
    try{
      if(window.PUSH_API_URL){
        fetch(window.PUSH_API_URL,{method:"POST",headers:{"Content-Type":"application/json","x-push-secret":window.PUSH_SECRET},
          body:JSON.stringify({usuario:S(data.usuario||u).toLowerCase(),title:"BET300 · Operador",body:texto.substring(0,120),url:"/",tag:"bet300-op"})}).catch(()=>{});
      }
    }catch(_p){}
    try{ if(typeof window.cargarSolicitudesPortal==="function") await window.cargarSolicitudesPortal(true); }catch(_e){}
    return {ok:true,solicitudId:data.solicitud_id,usuario:data.usuario||u,creada:!!data.creada};
  };

  window.nodoChatNuevo=function(usuario){
    const u=S(usuario).trim();
    if(!u){ try{ toast("Falta el usuario","red"); }catch(_e){} return; }
    abrirModal("💬 Escribirle a "+escapeHtml(u),
      '<div class="small" style="color:#8b949e;margin-bottom:8px">Le llega al chat del portal y como notificación. Si ya tiene una conversación, se suma ahí.</div>'
      +'<textarea id="chatNuevoTxt" rows="4" maxlength="2000" style="width:100%;border-radius:10px;padding:10px;background:#0e1525;color:#fff;border:1px solid #2d3342;resize:vertical" placeholder="Escribí el mensaje…"></textarea>'
      +'<div id="chatNuevoRes" class="small" style="min-height:16px;margin-top:6px"></div>',
      async function(){
        const txt=S((document.getElementById("chatNuevoTxt")||{}).value).trim();
        const res=document.getElementById("chatNuevoRes");
        if(!txt){ if(res) res.innerHTML='<span style="color:#f87171">Escribí algo.</span>'; return; }
        const btn=document.getElementById("modalSaveBtn");
        if(btn){ btn.disabled=true; btn.textContent="Enviando…"; }
        let r=null;
        try{ r=await window.nodoIniciarChat(u,txt); }catch(e){ r={ok:false,error:e.message||String(e)}; }
        if(!r||!r.ok){
          if(btn){ btn.disabled=false; btn.textContent="Enviar"; }
          if(res) res.innerHTML='<span style="color:#f87171">No se pudo enviar: '+escapeHtml(String((r&&r.error)||"sin detalle"))+'</span>';
          return;
        }
        try{ cerrarModal(); }catch(_e){}
        try{ toast("✉ Mensaje enviado a "+u,"green"); }catch(_e){}
        // Y abrir la conversación, que ya existe.
        try{
          const lista=(typeof window.ticketsAgrupados==="function"?window.ticketsAgrupados():ticketsAgrupadosFinal())||[];
          const t=lista.find(x=>U(x.usuario)===U(r.usuario||u));
          if(t && typeof window.aceptarTicketLocalStep2==="function"){
            if(typeof window.mostrarVista==="function") window.mostrarVista("chat");
            window.aceptarTicketLocalStep2(t.id);
          }
        }catch(_e){}
      }, "Enviar");
    setTimeout(function(){ try{ const t=document.getElementById("chatNuevoTxt"); if(t) t.focus(); }catch(_e){} }, 60);
  };

  window.cerrarConsultaWq2=async function(){
    const ticket=window.__nodoChatCurrentTicket;
    if(!ticket)return;
    if(!confirm("¿Cerrar esta consulta de "+E(ticket.usuario)+"?"))return;
    try{
      let algoSeCerro=false;
      for(const s of (ticket.items||[])){
        const sid=idSol(s);
        if(sid){ await actualizarSolicitudPortal(sid,"CERRADO",{chat_estado:"CERRADO",chat_master_id:ticket.masterId||ticket.solicitudId||sid}); algoSeCerro=true; }
      }
      // Las conversaciones del canal nuevo no son solicitudes: vienen con `items` vacío, así que
      // el bucle de arriba no cerraba NADA. La pantalla se cerraba igual y parecía que había
      // funcionado — y en el refresco siguiente la consulta volvía. (Juan, 3/10: "fallos
      // reportados en cerrar chats".)
      if(ticket._canalNuevo && ticket._chatId){
        // Motivo vacío a propósito: se cierra en silencio. Con el motivo puesto, la base le
        // escribe al JUGADOR "Cerrado manualmente desde panel" — texto nuestro, interno.
        const r = await window.panelAPI.rpc('panel_v14_cerrar_chat_json',
          { p_session_id:null, p_chat_id:String(ticket._chatId), p_motivo:'' });
        if(r && r.error) throw new Error(r.error.message || 'no se pudo cerrar la conversación');
        algoSeCerro=true;
        // Y la solicitud puente que la acompaña, para que no quede abierta en la bandeja.
        const sidPuente = Number(ticket.solicitudId||0);
        if(sidPuente) await actualizarSolicitudPortal(sidPuente,"CERRADO",{chat_estado:"CERRADO"});
      }
      // Cerrar "para la vista" y no en la base es lo peor de los dos mundos: el operador la da
      // por resuelta y le vuelve sola.
      if(!algoSeCerro) throw new Error("no encontré qué cerrar en esta consulta");
      const map=getAccepted(); delete map[U(ticket.usuario)]; localStorage.setItem(ACCEPT_KEY,JSON.stringify(map));
      window.__nodoChatCurrentTicket=null;window.__nodoChatCurrentUser="";
      document.body.classList.remove("nodo-chat-open");
      if(typeof cargarSolicitudesPortal==="function")await cargarSolicitudesPortal(true);
      window.__wq2ActiveTab="espera";
      renderChatListStep2Final();renderChatConversationStep5();
    }catch(e){alert("Error al cerrar: "+(e.message||e))}
  };

  // Reabrir una consulta CERRADA: el hilo (chat_thread) nunca se borró, solo se había filtrado.
  // Vuelve el estado a EN_REVISION + chat_estado abierto, re-acepta al usuario y abre la conversación
  // → el operador puede seguir escribiéndole al cliente sin perder el historial.
  window.reabrirConsultaWq2=async function(ticketId){
    let t=(ticketsAgrupadosFinal(true)||[]).find(x=>String(x.id)===String(ticketId));
    if(!t) t=(ticketsAgrupadosFinal(true)||[]).find(x=>U(x.usuario)===U(ticketId));
    if(!t){ try{toast('No encontré esa consulta.','red');}catch(_e){} return; }
    try{
      for(const s of (t.items||[])){
        const sid=idSol(s);
        if(sid)await actualizarSolicitudPortal(sid,"EN_REVISION",{chat_estado:"RESPONDIDO_PANEL",chat_master_id:t.masterId||t.solicitudId||sid});
      }
      setAccepted(t.usuario, t.masterId);       // vuelve a "Abiertos"
      window.__wq2ActiveTab="abiertos";
      if(typeof cargarSolicitudesPortal==="function")await cargarSolicitudesPortal(true);
      renderChatListStep2Final();
      const _abrir = window.aceptarTicketLocalStep2 || (typeof aceptarTicketLocalStep2==="function"?aceptarTicketLocalStep2:null);
      if(_abrir){ try{ _abrir(t.id); }catch(_e){} }
      try{toast('↩ Consulta reabierta: '+E(t.usuario)+' · seguí escribiéndole','green');}catch(_e){}
    }catch(e){ try{toast('No se pudo reabrir: '+(e.message||e),'red');}catch(_e){} }
  };

  // ── Auto-cierre de consultas sin respuesta ──────────────────────────────
  const AUTOCLOSE_HORAS = 24;
  let _lastAutoClose = 0;

  async function autoCloseTicketsViejos(forzar=false){
    const ahora = Date.now();
    // Ejecutar como máximo una vez cada 20 minutos (salvo forzar)
    if(!forzar && (ahora - _lastAutoClose) < 20*60*1000) return;
    _lastAutoClose = ahora;

    const limite = AUTOCLOSE_HORAS * 60 * 60 * 1000;
    // Antes esto miraba `chat_estado === "RESPONDIDO_PANEL"`, que lo escribe UNA sola de las
    // formas de contestar. Cuando alguien manda varias consultas, el panel responde la principal
    // y marca las otras ABSORBIDO_PANEL; y las que se abren quedan en ABIERTO_PANEL. Ninguna de
    // esas dos se cerraba nunca, aunque tuvieran la respuesta escrita en el hilo.
    //
    // Al 2/10 eran 3.925 consultas abiertas en la red y el auto-cierre veía 163 — el 4%. Las
    // demás volvían a la bandeja para siempre: "ya le contestaron al usuario pero vuelve a
    // aparecer porque se refresca". P2 arrastraba desde el 21 de julio.
    //
    // Ahora decide por el HECHO y no por la marca: si lo último que se dijo en el hilo lo dijo el
    // operador y pasaron 24 h, la consulta terminó — el jugador no volvió. La marca es una
    // anotación que tres de cuatro caminos se olvidan de escribir; el hilo es lo que pasó.
    function ultimoDelHilo(m){
      const hilo = Array.isArray(m && m.chat_thread) ? m.chat_thread : [];
      let ultimo = null, cuando = 0;
      for(const x of hilo){
        const t = new Date((x && x.fecha) || 0).getTime();
        if(!isNaN(t) && t > 0 && t >= cuando){ cuando = t; ultimo = x; }
      }
      return { ultimo, cuando };
    }
    const aVencer = soporteRows().filter(s=>{
      const m = metaObj(s);
      if(U(m.chat_estado||"") === "CERRADO") return false;
      const { ultimo, cuando } = ultimoDelHilo(m);
      if(!ultimo || U(ultimo.origen||"") !== "OPERADOR") return false;   // sin contestar: no se toca
      // Si el hilo no trae fecha usable, se cae a la que guardaba el metadata.
      const ts = cuando || new Date(m.chat_ultima_respuesta_at||0).getTime();
      return !isNaN(ts) && ts > 0 && (ahora - ts) > limite;
    });

    if(!aVencer.length) return;

    let cerrados = 0;
    const nombres = [];
    for(const s of aVencer){
      const sid = idSol(s);
      if(!sid) continue;
      try{
        await actualizarSolicitudPortal(sid,"CERRADO",{
          chat_estado:"CERRADO",
          chat_auto_cerrado_at: new Date().toISOString()
        });
        // Limpiar del mapa de aceptados
        const usuario = usuarioSol(s);
        if(usuario){const map=getAccepted();delete map[U(usuario)];localStorage.setItem(ACCEPT_KEY,JSON.stringify(map));}
        if(usuario) nombres.push(usuario);
        cerrados++;
      }catch(e){console.warn("[auto-close]",sid,e);}
    }

    if(cerrados > 0){
      // QUÉ se cerró y POR QUÉ. "1 consulta cerrada automáticamente" a secas dejaba al operador sin
      // saber qué había pasado: no figura en el historial ni llega a Nexo porque NO es una operación,
      // sólo cambia el estado de ese chat. Los datos ya estaban acá; sólo no se usaban.
      const quien = nombres.slice(0,3).join(", ") + (nombres.length > 3 ? (" y "+(nombres.length-3)+" más") : "");
      const msg = cerrados === 1
        ? `✓ Cerré la consulta de ${quien || "un jugador"} · ya respondida y sin contestar hace ${AUTOCLOSE_HORAS} h`
        : `✓ Cerré ${cerrados} consultas ya respondidas y sin contestar hace ${AUTOCLOSE_HORAS} h${quien ? " · "+quien : ""}`;
      try{if(typeof toast==="function")toast(msg,"blue");}catch(_e){}
      try{if(typeof cargarSolicitudesPortal==="function")await cargarSolicitudesPortal(true);}catch(_e){}
      renderChatListStep2Final();
    }
  }
  window.autoCloseViejos = ()=>autoCloseTicketsViejos(true);

  document.addEventListener("keydown",function(ev){
    if(ev.key==="Escape"&&document.body.classList.contains("nodo-chat-open")){
      ev.preventDefault();
      document.body.classList.remove("nodo-chat-open");
      renderChatListStep2Final();
    }
  },true);

  setTimeout(()=>{renderChatListStep2Final();},700);
  // Primer auto-close 90s después del inicio (cuando los tickets ya cargaron)
  setTimeout(()=>autoCloseTicketsViejos(true), 90000);
  // Luego cada 30 minutos
  setInterval(()=>autoCloseTicketsViejos(), 30*60*1000);

  setInterval(()=>{
    try{
      if(document.body.classList.contains("nodo-chat-open"))renderChatConversationStep5();
      renderChatListStep2Final();
    }catch(_e){}
  },4000);
})();
/* ============================================================
   NODO · VISTA PREVIA Y APROBACIÓN DE SOLICITUDES EN EL CHAT
   - Menú desplegable (modo reducido y modo completo).
   - Semáforo visual estricto:
       * Verde: Comprobante bancario verificado, reciente (<60m),
                sin duplicados hoy y sin transferencia programada.
       * Ámbar: Sin comprobante, comprobante emitido hace horas (>60m),
                o imagen que no parece un comprobante bancario.
       * Rojo: Monto ya procesado hoy para este usuario, monto no coincide,
               o transferencia programada (no debitada).
       * Azul: Analizando comprobante con IA en curso.
   - Extracción con Gemini Vision (con modelos fallback: 3.5-flash / flash-latest / 3.5-flash-lite).
   - Autocompleta Monto y Titular si la solicitud venía con $0 o vacía.
   ============================================================ */
(function(root){
  'use strict';

  // 11/10 · Acá había una clave de API de Google escrita a mano. GitHub frenó el push y con
  // razón: este archivo se empaqueta en la app que va a las 25 PCs y el repo es PÚBLICO. Una
  // clave de API paga en el código es plata de cualquiera que la lea.
  //
  // Mismo criterio que el resto de los secretos del panel: sale de la configuración de la PC.
  // Y SIN valor por defecto: si no está configurada, la lectura con IA no corre y se dice por
  // consola. Prefiero que la función no ande antes que volver a dejar una clave adentro.
  const GEMINI_API_KEY = (function(){
    try{ return String(localStorage.getItem('nodo_gemini_api_key') || '').trim(); }
    catch(_e){ return ''; }
  })();
  const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

  // Cache en memoria por URL de imagen para no volver a consultar a la IA
  const ocrCache = new Map();
  let demoModo = null;
  let desplegado = false;

  function esc(s){
    try{ if(typeof escapeHtml === 'function') return escapeHtml(s); }catch(_e){}
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function fmtMoney(v){
    const n = Math.abs(Number(v || 0));
    return '$' + n.toLocaleString('es-AR');
  }

  // ── 1. Validación estricta de solicitud financiera ──────────────────────────
  function esSolicitudFinancieraValida(s){
    if(!s) return false;

    // Regla A: No admitir tipos que sean explícitamente SOPORTE o consultas generales
    const tipo = String(s.TIPO || s.tipo || s.tipo_solicitud || '').trim().toUpperCase();
    if(tipo && tipo !== 'CARGA' && tipo !== 'RETIRO') return false;

    // Regla B: Estado pendiente de resolver por el cajero
    const est = String(s.ESTADO || s.estado || '').trim().toUpperCase();
    const estadosPendientes = ['PENDIENTE', 'EN_REVISION', 'NUEVA', 'EN_ESPERA', 'ABIERTA'];
    if(!estadosPendientes.includes(est)) return false;

    // Regla C: Monto positivo O comprobante adjunto reciente
    const monto = Number(s.MONTO_REAL || s.MONTO_DECLARADO || s.monto || 0);
    const tieneImgDirecta = Boolean(s.COMPROBANTE_URL || s.comprobante_url || s.IMAGEN_URL || s.imagen_url);

    if((isNaN(monto) || monto <= 0) && !tieneImgDirecta){
      // Si no tiene monto ni foto directa, solo se admite si el chat tiene imagen reciente (< 2 horas)
      const tieneImgChat = window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.thread) &&
        window.__nodoChatCurrentTicket.thread.some(m => {
          const rol = String(m.origen || m.remitente || m.role || '').toUpperCase();
          const mFechaMs = m.fecha ? new Date(m.fecha).getTime() : 0;
          return rol !== 'OPERADOR' && rol !== 'SISTEMA' && Boolean(m.imagen_url) && (!isNaN(mFechaMs) ? (Date.now() - mFechaMs) <= (2 * 3600 * 1000) : true);
        });
      if(!tieneImgChat) return false;
    }

    // Regla D: Límite temporal de vigencia (máximo 48 horas de antigüedad para evitar zombis)
    const fechaStr = s.FECHA_CREACION || s.created_at || s.fecha || null;
    if(fechaStr){
      const fechaMs = new Date(fechaStr).getTime();
      const hace48hs = Date.now() - (48 * 60 * 60 * 1000);
      if(!isNaN(fechaMs) && fechaMs < hace48hs) return false;
    }

    return true;
  }

  // ── 2. Buscar solicitud pendiente para un usuario ───────────────────────────
  function buscarSolicitudPendiente(usuario){
    if(demoModo) return demoSolicitud(demoModo);
    if(!usuario) return null;
    const u = String(usuario).trim().toLowerCase();

    // Prioridad 1: Buscar en la lista oficial de solicitudes del panel
    const lista = (window.V154P && Array.isArray(window.V154P.solicitudes))
      ? window.V154P.solicitudes
      : (Array.isArray(window.solicitudes) ? window.solicitudes : []);

    const solOficial = lista.find(s => {
      const uSol = String(s.USUARIO || s.usuario || '').trim().toLowerCase();
      return uSol === u && esSolicitudFinancieraValida(s);
    });
    if(solOficial) return solOficial;

    // Prioridad 2: Buscar en los items del ticket actual
    if(window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.items)){
      const solTicket = window.__nodoChatCurrentTicket.items.find(s => esSolicitudFinancieraValida(s));
      if(solTicket) return solTicket;
    }

    // Prioridad 3: Si el ticket actual de chat tiene una imagen reciente enviada por el usuario
    if(window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.thread)){
      const hace2hs = Date.now() - (2 * 3600 * 1000);
      const imgReciente = window.__nodoChatCurrentTicket.thread.find(m => {
        const rol = String(m.origen || m.remitente || m.role || '').toUpperCase();
        const mFechaMs = m.fecha ? new Date(m.fecha).getTime() : 0;
        return rol !== 'OPERADOR' && rol !== 'SISTEMA' && Boolean(m.imagen_url) && (!isNaN(mFechaMs) ? mFechaMs >= hace2hs : true);
      });
      if(imgReciente){
        return {
          ID: window.__nodoChatCurrentTicket.masterId || window.__nodoChatCurrentTicket.solicitudId || 'CHAT',
          USUARIO: usuario,
          TIPO: 'CARGA',
          MONTO_DECLARADO: 0,
          COMPROBANTE_URL: imgReciente.imagen_url,
          FECHA_CREACION: imgReciente.fecha || new Date().toISOString()
        };
      }
    }

    return null;
  }

  // ── 3. Datos de prueba interactivos para modo Dev ───────────────────────────
  function demoSolicitud(tipo){
    const now = new Date();
    if(tipo === 'verde'){
      return {
        _isDemo: true,
        _demoTipo: 'verde',
        ID: 9941,
        USUARIO: 'demo_jugador',
        TIPO: 'CARGA',
        MONTO_REAL: 15000,
        MONTO_DECLARADO: 15000,
        TITULAR: 'JUAN CARLOS PEREZ',
        BILLETERA_NOMBRE: 'BAPRO',
        FECHA_CREACION: new Date(now - 7*60000).toISOString(),
        COMPROBANTE_URL: 'https://placehold.co/600x400/10131a/22c55e?text=Comprobante+Reciente+$15.000',
        _simOcr: {
          esComprobante: true,
          monto: 15000,
          titular: 'JUAN CARLOS PEREZ',
          banco: 'Mercado Pago',
          idOp: '89324823901',
          minutosAtras: 7,
          hora: new Date(now - 7*60000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
          esProgramada: false
        }
      };
    }
    if(tipo === 'ambar'){
      return {
        _isDemo: true,
        _demoTipo: 'ambar',
        ID: 9942,
        USUARIO: 'demo_jugador',
        TIPO: 'CARGA',
        MONTO_REAL: 25000,
        MONTO_DECLARADO: 25000,
        TITULAR: 'MARIA ELENA GONZALEZ',
        BILLETERA_NOMBRE: 'MERCADOPAGO',
        FECHA_CREACION: new Date(now - 250*60000).toISOString(),
        COMPROBANTE_URL: 'https://placehold.co/600x400/10131a/eab308?text=Comprobante+Viejo+(4+Horas)+$25.000',
        _simOcr: {
          esComprobante: true,
          monto: 25000,
          titular: 'MARIA ELENA GONZALEZ',
          banco: 'Cuenta DNI',
          idOp: '48201948201',
          minutosAtras: 245,
          hora: new Date(now - 245*60000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
          esProgramada: false
        }
      };
    }
    if(tipo === 'rojo'){
      return {
        _isDemo: true,
        _demoTipo: 'rojo',
        ID: 9943,
        USUARIO: 'demo_jugador',
        TIPO: 'CARGA',
        MONTO_REAL: 10000,
        MONTO_DECLARADO: 10000,
        TITULAR: 'ROBERTO CARLOS DIAZ',
        BILLETERA_NOMBRE: 'MERCADOPAGO',
        FECHA_CREACION: new Date(now - 12*60000).toISOString(),
        COMPROBANTE_URL: 'https://placehold.co/600x400/10131a/ef4444?text=Transferencia+Programada+$10.000',
        _yaProcesadoPrevio: {
          hora: '14:20',
          opId: '88391',
          monto: 10000
        },
        _simOcr: {
          esComprobante: true,
          monto: 10000,
          titular: 'ROBERTO CARLOS DIAZ',
          banco: 'Mercado Pago',
          idOp: '11029482001',
          minutosAtras: 3,
          hora: new Date(now - 3*60000).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
          esProgramada: true
        }
      };
    }
    return null;
  }

  // ── 4. Chequeo anti-duplicados en historial ──────────────────────────────────
  function verificarSiMontoYaProcesado(usuario, monto, tipo){
    if(!usuario || !monto) return null;
    const u = String(usuario).trim().toLowerCase();
    const t = String(tipo || 'CARGA').toUpperCase();
    const mNum = Math.abs(Number(monto));

    const hist = Array.isArray(window._historialData)
      ? window._historialData
      : (Array.isArray(window._histUnificadoCache) ? window._histUnificadoCache : []);

    const hace12hs = Date.now() - (12 * 60 * 60 * 1000);

    for(const h of hist){
      const uH = String(h.usuario || h.USUARIO || '').trim().toLowerCase();
      const tH = String(h.tipo || h.TIPO || '').toUpperCase();
      const mH = Math.abs(Number(h.monto || h.MONTO || 0));
      const fechaMs = new Date(h.created_at || h.fecha || 0).getTime();

      if(uH === u && tH === t && mH === mNum && fechaMs >= hace12hs){
        const fechaTxt = new Date(fechaMs).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
        return {
          hora: fechaTxt,
          opId: h.id || h.solicitud_id || '—',
          monto: mH
        };
      }
    }
    return null;
  }

  // ── 5. Análisis con Gemini Vision (con fallback automático de modelos) ───────
  async function analizarComprobanteConGemini(urlOBase64){
    // Sin clave configurada no se sale a internet. Esto manda la IMAGEN DEL COMPROBANTE del
    // jugador a Google, así que si la PC no tiene la clave puesta a propósito, no se manda nada.
    if(!GEMINI_API_KEY){
      console.warn("[comprobante] lectura con IA apagada: falta nodo_gemini_api_key en esta PC");
      return { error: "sin_clave" };
    }
    if(!urlOBase64) return null;
    if(ocrCache.has(urlOBase64)) return ocrCache.get(urlOBase64);

    try{
      let base64Data = '';
      let mimeType = 'image/jpeg';

      if(urlOBase64.startsWith('data:')){
        const commaIdx = urlOBase64.indexOf(',');
        if(commaIdx !== -1){
          const header = urlOBase64.slice(0, commaIdx);
          const mimeMatch = header.match(/^data:([^;]+)/);
          mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          base64Data = urlOBase64.slice(commaIdx + 1).replace(/\s+/g, '');
        }
      } else {
        const resp = await fetch(urlOBase64);
        const blob = await resp.blob();
        mimeType = blob.type || 'image/jpeg';
        const buffer = await blob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for(let i = 0; i < len; i++){ binary += String.fromCharCode(bytes[i]); }
        base64Data = btoa(binary);
      }

      if(!base64Data) return null;

      const prompt = `Analiza este comprobante de transferencia bancaria de Argentina.
Responde ÚNICAMENTE un JSON válido (sin markdown, sin bloques de código, sin texto extra) con este esquema exacto:
{
  "es_comprobante": true,
  "monto": 0,
  "titular_origen": "",
  "banco_origen": "",
  "id_transaccion": "",
  "hora_texto": "HH:MM",
  "minutos_hace": 0,
  "es_programada": false,
  "duda_o_sospecha": ""
}`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mimeType, data: base64Data } }
          ]
        }]
      };

      let aiData = null;
      // Probar modelos en orden de disponibilidad
      for(const model of GEMINI_MODELS){
        try{
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
          const aiResp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if(aiResp.ok){
            aiData = await aiResp.json();
            break;
          }
          console.warn(`[Gemini Vision] ${model} respondió ${aiResp.status}, probando siguiente modelo...`);
        }catch(modelErr){
          console.warn(`[Gemini Vision] Error con ${model}:`, modelErr);
        }
      }

      if(!aiData) throw new Error('Todos los modelos de Gemini fallaron o están agotados');

      const rawText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = rawText.replace(/```json/gi,'').replace(/```/g,'').trim();
      const parsed = JSON.parse(cleanJson);

      const resObj = {
        esComprobante: (parsed.es_comprobante === true || parsed.es_comprobante === 'true'),
        monto: Number(parsed.monto || 0),
        titular: parsed.titular_origen || '',
        banco: parsed.banco_origen || '',
        idOp: parsed.id_transaccion || '',
        hora: parsed.hora_texto || '',
        minutosAtras: (parsed.minutos_hace != null && !isNaN(parsed.minutos_hace)) ? Number(parsed.minutos_hace) : null,
        esProgramada: Boolean(parsed.es_programada),
        sospecha: parsed.duda_o_sospecha || null
      };

      ocrCache.set(urlOBase64, resObj);
      return resObj;
    }catch(err){
      console.warn('[Gemini Vision] Error analizando comprobante:', err);
      const errObj = { error: true, esComprobante: false };
      ocrCache.set(urlOBase64, errObj);
      return errObj;
    }
  }

  // ── 6. Renderizado del banner desplegable ────────────────────────────────────
  async function renderBannerSolicitud(contenedorId, usuarioActual){
    const container = document.getElementById(contenedorId);
    if(!container) return;

    const sol = buscarSolicitudPendiente(usuarioActual);
    if(!sol){
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }

    container.classList.remove('hidden');

    const solId = sol.ID || sol.SOLICITUD_ID || sol.id || '—';
    const tipo = String(sol.TIPO || sol.tipo || 'CARGA').toUpperCase();
    const montoDeclarado = Number(sol.MONTO_REAL || sol.MONTO_DECLARADO || sol.monto || 0);
    const titularDeclarado = String(sol.TITULAR || sol.NOMBRE_COMPLETO || '—').trim();
    const cbu = String(sol.CBU || sol.CVU || sol.CBU_ALIAS || sol.ALIAS_CBU || '').trim();
    const billeteraDeclarada = String(sol.BILLETERA_NOMBRE || sol.billetera || sol.DESTINO || '').trim();

    // Obtener comprobante: de la solicitud o del último mensaje reciente con foto del chat
    let comprobanteUrl = sol.COMPROBANTE_URL || sol.comprobante_url || sol.IMAGEN_URL || sol.imagen_url || null;
    if(!comprobanteUrl && window.__nodoChatCurrentTicket && Array.isArray(window.__nodoChatCurrentTicket.thread)){
      const hace2hs = Date.now() - (2 * 3600 * 1000);
      const userImgs = window.__nodoChatCurrentTicket.thread.filter(m => {
        const rol = String(m.origen || m.remitente || m.role || '').toUpperCase();
        const mFechaMs = m.fecha ? new Date(m.fecha).getTime() : 0;
        return rol !== 'OPERADOR' && rol !== 'SISTEMA' && Boolean(m.imagen_url) && (!isNaN(mFechaMs) ? mFechaMs >= hace2hs : true);
      });
      if(userImgs.length){
        comprobanteUrl = userImgs[userImgs.length - 1].imagen_url;
      }
    }

    // Análisis de comprobante (en memoria o dispara consulta)
    let ocr = sol._simOcr || null;
    if(!ocr && comprobanteUrl){
      ocr = ocrCache.get(comprobanteUrl) || null;
      if(!ocr){
        analizarComprobanteConGemini(comprobanteUrl).finally(() => {
          renderBannerSolicitud(contenedorId, usuarioActual);
        });
      }
    }

    // Autocompletar datos usando OCR si la solicitud venía con $0 o sin titular
    const monto = (montoDeclarado > 0) ? montoDeclarado : (ocr && ocr.monto > 0 ? ocr.monto : 0);
    const titular = (titularDeclarado !== '—' && titularDeclarado !== '') ? titularDeclarado : ((ocr && ocr.titular) ? ocr.titular : '—');
    const billetera = (billeteraDeclarada !== '—' && billeteraDeclarada !== '') ? billeteraDeclarada : ((ocr && ocr.banco) ? ocr.banco : '—');

    // Chequeo de duplicados en el día
    const prev = sol._yaProcesadoPrevio || (monto > 0 ? verificarSiMontoYaProcesado(usuarioActual, monto, tipo) : null);

    // Determinar Semáforo (Verde, Ámbar, Rojo, Azul)
    let semaforo = 'ambar';
    let resumenEstado = '⚠️ Pendiente de verificación';

    const fechaSolStr = sol.FECHA_CREACION || sol.created_at || sol.fecha || null;
    const horasDesdeCreacion = fechaSolStr ? (Date.now() - new Date(fechaSolStr).getTime()) / 3600000 : null;

    if(prev){
      semaforo = 'rojo';
      resumenEstado = `⛔ ALERTA: Monto de ${fmtMoney(monto)} ya procesado a las ${prev.hora} (Op #${prev.opId})`;
    } else if(ocr && ocr.esProgramada){
      semaforo = 'rojo';
      resumenEstado = '⛔ ALERTA: Transferencia PROGRAMADA (no debitada)';
    } else if(montoDeclarado > 0 && ocr && ocr.monto && Math.abs(ocr.monto - montoDeclarado) > 10){
      semaforo = 'rojo';
      resumenEstado = `⛔ ALERTA: Comprobante indica ${fmtMoney(ocr.monto)} (declaró ${fmtMoney(montoDeclarado)})`;
    } else if(ocr && ocr.esComprobante === false){
      semaforo = 'ambar';
      resumenEstado = '⚠️ La imagen adjunta no parece un comprobante bancario';
    } else if(ocr && ocr.minutosAtras != null && ocr.minutosAtras > 60){
      semaforo = 'ambar';
      resumenEstado = `⚠️ REVISAR: Comprobante emitido hace ${ocr.minutosAtras > 120 ? Math.round(ocr.minutosAtras/60) + ' horas' : ocr.minutosAtras + ' minutos'}`;
    } else if(horasDesdeCreacion != null && horasDesdeCreacion > 24){
      semaforo = 'ambar';
      resumenEstado = `⚠️ Solicitud demorada (${Math.round(horasDesdeCreacion)} horas atrás)`;
    } else if(!comprobanteUrl){
      semaforo = 'ambar';
      resumenEstado = tipo === 'CARGA'
        ? '⚠️ Sin comprobante adjunto · Verificar cuenta bancaria'
        : 'ℹ️ Retiro pendiente · Verificar fondos antes de transferir';
    } else if(comprobanteUrl && !ocr){
      semaforo = 'azul';
      resumenEstado = '🤖 Analizando comprobante con IA…';
    } else if(ocr && ocr.esComprobante){
      semaforo = 'verde';
      resumenEstado = `🟢 Comprobante verificado (${ocr.hora || 'Reciente'}) · Todo en orden`;
    }

    // Estilos visuales según semáforo
    const colorBorder = semaforo === 'rojo'
      ? '#ef4444'
      : (semaforo === 'ambar'
          ? '#eab308'
          : (semaforo === 'azul' ? '#38bdf8' : '#22c55e'));

    const colorBg = semaforo === 'rojo'
      ? 'rgba(239,68,68,0.12)'
      : (semaforo === 'ambar'
          ? 'rgba(234,179,8,0.12)'
          : (semaforo === 'azul' ? 'rgba(56,189,248,0.10)' : 'rgba(34,197,94,0.10)'));

    const badgeBg = tipo === 'RETIRO' ? 'rgba(251,146,60,0.2)' : 'rgba(34,197,94,0.2)';
    const badgeColor = tipo === 'RETIRO' ? '#fb923c' : '#22c55e';

    let html = `
      <div class="nodo-sol-pill" style="border:1px solid ${colorBorder};background:${colorBg}">
        <div class="nodo-sol-pill-head" onclick="window.nodoToggleSolBanner('${contenedorId}','${esc(usuarioActual)}')">
          <div class="nodo-sol-pill-left">
            <span class="nodo-sol-badge" style="background:${badgeBg};color:${badgeColor}">
              ${tipo === 'RETIRO' ? '⬇️ RETIRO' : '⬆️ CARGA'} #${solId}
            </span>
            <span class="nodo-sol-monto">${fmtMoney(monto)}</span>
            <span class="nodo-sol-resumen">${esc(resumenEstado)}</span>
          </div>
          <div class="nodo-sol-pill-right" onclick="event.stopPropagation()">
            ${sol._isDemo ? `
              <div class="nodo-dev-sol-tester">
                <button class="mini-btn green" type="button" onclick="window.nodoDemoPreview('verde')" title="Verde: OK">🟢</button>
                <button class="mini-btn yellow" type="button" onclick="window.nodoDemoPreview('ambar')" title="Ámbar: Horario">🟡</button>
                <button class="mini-btn red" type="button" onclick="window.nodoDemoPreview('rojo')" title="Rojo: Duplicado">🔴</button>
                <button class="mini-btn gray" type="button" onclick="window.nodoDemoPreview('off')" title="Cerrar demo">✕</button>
              </div>
            ` : ''}
            <button class="mini-btn gray" type="button" onclick="window.nodoToggleSolBanner('${contenedorId}','${esc(usuarioActual)}')">
              ${desplegado ? '▲ Plegar' : '▼ Detalle'}
            </button>
          </div>
        </div>

        ${desplegado ? `
          <div class="nodo-sol-panel-body">
            <div class="nodo-sol-grid">
              <div class="nodo-sol-col">
                <div class="nodo-sol-item"><span class="lbl">Titular:</span> <b>${esc(titular)}</b></div>
                ${cbu ? `<div class="nodo-sol-item"><span class="lbl">CBU/Alias:</span> <span class="cbu">${esc(cbu)}</span></div>` : ''}
                ${billetera ? `<div class="nodo-sol-item"><span class="lbl">Billetera:</span> <span>${esc(billetera)}</span></div>` : ''}
                ${prev ? `<div class="nodo-sol-alerta-roja">⛔ CUIDADO: Este usuario ya recibió una carga de ${fmtMoney(prev.monto)} hoy a las ${prev.hora} (Op #${prev.opId}).</div>` : ''}
              </div>

              ${comprobanteUrl ? `
                <div class="nodo-sol-col-img">
                  <a href="${esc(comprobanteUrl)}" target="_blank" title="Clic para abrir en tamaño completo">
                    <img src="${esc(comprobanteUrl)}" class="nodo-sol-thumb" alt="Comprobante">
                  </a>
                  <div class="nodo-sol-ocr-box">
                    ${ocr ? `
                      ${ocr.esComprobante === false ? '<div class="ocr-line red">⚠️ <b>NO ES UN COMPROBANTE BANCARIO</b></div>' : ''}
                      <div class="ocr-line">🕒 <b>Hora ticket:</b> ${esc(ocr.hora || 'No visible')} ${ocr.minutosAtras != null ? `(${ocr.minutosAtras}m atrás)` : ''}</div>
                      <div class="ocr-line">🏦 <b>Banco:</b> ${esc(ocr.banco || 'Billetera')}</div>
                      ${ocr.idOp ? `<div class="ocr-line">🔢 <b>Op:</b> ${esc(ocr.idOp)}</div>` : ''}
                      ${ocr.monto ? `<div class="ocr-line">💵 <b>Monto en foto:</b> ${fmtMoney(ocr.monto)}</div>` : ''}
                      ${ocr.esProgramada ? `<div class="ocr-line red">⛔ <b>TRANSFERENCIA PROGRAMADA</b></div>` : ''}
                      ${ocr.sospecha ? `<div class="ocr-line red">⚠️ ${esc(ocr.sospecha)}</div>` : ''}
                    ` : '<div style="color:#38bdf8;font-size:11px">🤖 Analizando comprobante con IA…</div>'}
                  </div>
                </div>
              ` : ''}
            </div>

            <div class="nodo-sol-actions">
              <button class="mini-btn green" type="button" onclick="window.nodoAprobarSolDesdeChat('${solId}', ${monto}, '${esc(titular)}')" ${prev ? 'style="border-color:#ef4444"' : ''}>
                ${prev ? '⚠ Forzar Aprobación' : `⚡ Aprobar (${fmtMoney(monto)})`}
              </button>
              <button class="mini-btn red" type="button" onclick="window.nodoRechazarSolDesdeChat('${solId}')">
                ❌ Rechazar
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = html;
  }

  // ── 7. Interacciones y Acciones directas ─────────────────────────────────────
  window.nodoToggleSolBanner = function(contenedorId, usuarioActual){
    desplegado = !desplegado;
    renderBannerSolicitud(contenedorId, usuarioActual);
  };

  window.nodoAprobarSolDesdeChat = function(solId, montoDetectado, titularDetectado){
    if(demoModo){
      if(typeof toast === 'function') toast(`[DEMO PREVIEW] Aprobando solicitud #${solId}`, 'green');
      else alert(`[DEMO PREVIEW] Aprobando solicitud de prueba #${solId}`);
      return;
    }
    // Si la solicitud no traía monto, pre-poblar los datos del OCR en la solicitud en memoria
    if(solId && (montoDetectado > 0 || titularDetectado)){
      try{
        const lista = (window.V154P && Array.isArray(window.V154P.solicitudes)) ? window.V154P.solicitudes : (window.solicitudes || []);
        const s = lista.find(x => String(x.ID || x.SOLICITUD_ID || x.id) === String(solId));
        if(s){
          if((!s.MONTO_REAL && !s.MONTO_DECLARADO) && montoDetectado > 0) s.MONTO_REAL = montoDetectado;
          if(!s.TITULAR && titularDetectado && titularDetectado !== '—') s.TITULAR = titularDetectado;
        }
      }catch(_e){}
    }
    if(typeof abrirModalPortalSolicitud === 'function'){
      abrirModalPortalSolicitud(solId);
    } else {
      if(typeof toast === 'function') toast('Abriendo solicitud #' + solId + ' para aprobación...', 'blue');
      else alert('Abrir solicitud #' + solId + ' para aprobación.');
    }
  };

  window.nodoRechazarSolDesdeChat = function(solId){
    if(demoModo){
      if(typeof toast === 'function') toast(`[DEMO PREVIEW] Rechazando solicitud #${solId}`, 'yellow');
      else alert(`[DEMO PREVIEW] Rechazando solicitud de prueba #${solId}`);
      return;
    }
    if(typeof v154pRechazarSolicitud === 'function'){
      v154pRechazarSolicitud(solId);
    } else {
      if(typeof toast === 'function') toast('Abriendo rechazo de solicitud #' + solId + '...', 'yellow');
      else alert('Abrir rechazo de solicitud #' + solId);
    }
  };

  // ── 8. Hook al abrir o cambiar de chat ───────────────────────────────────────
  window.actualizarPreviewSolicitudChat = function(usuario){
    renderBannerSolicitud('chatSolicitudBanner', usuario);
    renderBannerSolicitud('v15ChatSolicitudBanner', usuario);
  };

  // Interceptar abrirChat clásico
  const oldAbrir = window.abrirChat;
  window.abrirChat = async function(id){
    if(typeof oldAbrir === 'function') await oldAbrir(id);
    const chat = (window.chats || []).find(c => String(c.ID_CHAT || c.id || '') === String(id)) || {};
    window.actualizarPreviewSolicitudChat(chat.USUARIO || chat.usuario || '');
  };

  // ── 9. Switch interactivo para Dev / Demo ────────────────────────────────────
  window.nodoDemoPreview = function(modo){
    demoModo = (modo === 'off' || modo === false) ? null : modo;
    const curUser = (window.__nodoChatCurrentUser || (window.chatActualId && (window.chats || []).find(c => String(c.ID_CHAT || c.id) === String(window.chatActualId))?.USUARIO)) || 'demo_jugador';
    window.actualizarPreviewSolicitudChat(curUser);
    console.log('[NODO Preview] Modo demo:', demoModo || 'APAGADO');
    try{
      if(typeof toast === 'function'){
        toast(demoModo ? `🧪 Preview Demo activo: ${demoModo.toUpperCase()}` : '🧪 Preview Demo desactivado', 'blue');
      }
    }catch(_e){}
  };

  // Atajo de teclado: Ctrl + Shift + S para ciclar Verde -> Ámbar -> Rojo -> Off
  document.addEventListener('keydown', function(e){
    if(e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')){
      e.preventDefault();
      const modos = [null, 'verde', 'ambar', 'rojo'];
      const nextIdx = (modos.indexOf(demoModo) + 1) % modos.length;
      window.nodoDemoPreview(modos[nextIdx]);
    }
  });

})(typeof globalThis !== 'undefined' ? globalThis : window);
