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
    const fecha = S(s.fecha_ultimo || s.updated_at || s.created_at || '');
    const ultimo = S(s.ultimo_mensaje || '');
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
      fecha: fecha,
      mensaje: ultimo,
      solicitudId: S(s.solicitud_id || ''),
      masterId: null,
      accepted: !cerrado && aceptada,
      cerrado: cerrado,
      thread: ultimo ? [{ origen: 'USUARIO', usuario: usuario, mensaje: ultimo, fecha: fecha }] : [],
      unread: Number(s.sin_leer) || 0,
      last: ultimo ? { origen: 'USUARIO', usuario: usuario, mensaje: ultimo, fecha: fecha } : null,
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
        const emisor = U(m.tipo_emisor || m.emisor || '');
        const esOperador = emisor.indexOf('OPER') >= 0 || emisor.indexOf('PANEL') >= 0
                        || emisor.indexOf('SIST') >= 0 || emisor.indexOf('ADMIN') >= 0;
        return {
          origen: esOperador ? 'OPERADOR' : 'USUARIO',
          usuario: S(m.emisor || ''),
          mensaje: S(m.mensaje || ''),
          fecha: S(m.created_at || ''),
          imagen_url: S(m.imagen_url || '') || undefined
        };
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
    const row={
      origen:U(m?.origen||m?.tipo||"USUARIO"),
      usuario:S(m?.usuario||""),
      operador:S(m?.operador||""),
      mensaje:S(m?.mensaje||""),
      fecha:m?.fecha||m?.created_at||new Date().toISOString(),
      solicitud_id:m?.solicitud_id||m?.solicitudId||null
    };
    const img=m?.imagen_url||m?.imagen||"";
    if(img)row.imagen_url=img;
    return row;
  }
  function uniqThread(arr){
    const seen=new Set();
    const out=[];
    (arr||[]).forEach(raw=>{
      const m=normalizeThreadRow(raw);
      // Dedup por origen+fecha+mensaje (SIN solicitud_id): la copia local de un mensaje enviado no
      // tiene solicitud_id y la del servidor sí; incluirlo hacía que el mismo mensaje se viera dos
      // veces al mezclar local+servidor. Origen+fecha(ISO ms)+texto ya identifica un mensaje único.
      const k=[m.origen,m.fecha||"",m.mensaje||""].join("|");
      if(seen.has(k))return;
      seen.add(k);out.push(m);
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
    const body=document.getElementById("chatBody")||document.getElementById("v15ChatBody");
    if(!body)return;
    // Smart scroll: solo bajar automático si ya estaba cerca del final
    const _wasAtBottom=(body.scrollHeight-body.scrollTop-body.clientHeight)<100;
    const ticket=window.__nodoChatCurrentTicket;
    const titulo=document.getElementById("chatTitulo");
    const sub=document.getElementById("chatSubtitulo");

    if(!ticket){
      if(titulo)titulo.textContent="Seleccioná un chat";
      if(sub)sub.textContent="Sin conversación abierta";
      body.innerHTML=`<div class="alert-box">Seleccioná un chat para responder.</div>`;
      return;
    }
    // refrescar ticket con últimos datos
    const fresh=ticketsAgrupadosFinal().find(t=>U(t.usuario)===U(ticket.usuario))||ticket;
    window.__nodoChatCurrentTicket=fresh;
    if(titulo)titulo.textContent=fresh.usuario;
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
        if(m.imagen_url||U(m.origen)==="OPERADOR")return;
        const mts=toDate(m.fecha).getTime();
        let best=null,bestDiff=5*60*1000;
        cmArr.forEach((c,i)=>{
          if(usedCm.has(i)||!c.IMAGEN_URL)return;
          if(String(c.TIPO_EMISOR||c.EMISOR||"").match(/OPER|ADMIN|PANEL|SIST/i))return;
          const diff=Math.abs(toDate(c.FECHA).getTime()-mts);
          if(diff<bestDiff){bestDiff=diff;best=i;}
        });
        if(best!==null){m.imagen_url=cmArr[best].IMAGEN_URL;usedCm.add(best);}
      });
    }
    let html=`<div class="wq2-chat-bg">`;
    msgs.forEach(m=>{
      const op=U(m.origen)==="OPERADOR";
      const imgSrc=m.imagen_url||m.imagen||"";
      const imgHtml=(imgSrc&&!_chatImgFailed.has(imgSrc))?`<img src="${E(imgSrc)}" style="max-width:220px;border-radius:8px;margin-top:6px;display:block;cursor:pointer" title="Ver imagen" onclick="window.open(this.src,'_blank')" onerror="window._chatImgError('${E(imgSrc)}')">` : "";
      const editBtn=(op && !imgSrc && m.fecha)?`<button class="wq2-edit" onclick="editarMensajeOperador('${E(m.fecha)}')" title="Editar este mensaje (también se actualiza para el cliente)">✏️</button>`:"";
      const editedTag=m.editado?`<span class="wq2-edited" title="Mensaje editado">· editado</span>`:"";
      html+=`<div class="wq2-row ${op?"op":"user"}"><div class="wq2-bubble">${E(m.mensaje||"").replace(/\n/g,"<br>")}${imgHtml}<div class="wq2-time">${hora(m.fecha)}${editedTag}${editBtn}</div></div></div>`;
    });
    html+=`</div>`;
    if(body.innerHTML!==html){
      body.innerHTML=html;
      if(_wasAtBottom)body.scrollTop=body.scrollHeight;
    }
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
    const m=merged.find(x=>String(x.fecha)===String(fechaIso)&&U(x.origen||x.tipo)==="OPERADOR");
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
        try{ const saved=getSavedMsgs(fresh); let ch=false; saved.forEach(x=>{ if(String(x.fecha)===String(fechaIso)&&U(x.tipo||x.origen)==="OPERADOR"){ x.mensaje=texto; x.editado=true; ch=true; } }); if(ch) setSavedMsgs(fresh,saved); }catch(_e){}
        // 2) chat_thread del servidor (lo que lee el portal)
        try{
          const masterId=Number(fresh.masterId||fresh.solicitudId||0);
          const edited=(fresh.thread||[]).map(x=> (String(x.fecha)===String(fechaIso)&&U(x.origen)==="OPERADOR") ? Object.assign({},x,{mensaje:texto,editado:true}) : x);
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

  window.enviarChat=async function(){
    const ticket=window.__nodoChatCurrentTicket;
    if(!ticket){alert("Abrí un chat primero.");return{ok:false}}
    const input=document.getElementById("chatInput")||document.getElementById("v15ChatInput");
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
  window.v15EnviarChatCompacto=window.enviarChat;

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
