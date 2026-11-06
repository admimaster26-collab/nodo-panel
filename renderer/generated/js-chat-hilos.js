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
  let _pc = '';
  let _page = null;
  let _query = '';
  let _revision = 0;
  let _moreLoaded = false;
  const _mensajes = new Map();
  const VIVE_MS = 15000;                   // no se pide más seguido que el reloj de la lista

  function syncOffice(){
    const pc = U(window.pcOperativa || '');
    if(_pc !== pc){
      _pc=pc; _sesiones=[]; _page=null; _query=''; _ultima=0; _enCurso=null;
      _moreLoaded=false; _revision++; _mensajes.clear();
    }
    return pc;
  }

  async function pedirSesiones(pc, query){
    if(!pc) return {rows:[],page:null};
    if(window.NodoBetaChat && await window.NodoBetaChat.ready()){
      const page = await window.NodoBetaChat.lista({usuario:query || null});
      return {rows:page.rows.map(row=>({...row,_beta:true,_betaPc:pc})),page};
    }
    try{
      const r = await window.panelAPI.rpc('panel_core_get_chat_sesiones_json', { p_pc_codigo: pc });
      if(r && r.error){ console.warn('[canal nuevo] no se pudieron leer las sesiones', r.error); return {rows:_sesiones,page:null}; }
      let filas = r && r.data;
      if(typeof filas === 'string'){ try{ filas = JSON.parse(filas); }catch(_e){ return {rows:_sesiones,page:null}; } }
      if(filas && !Array.isArray(filas) && Array.isArray(filas.rows)) filas = filas.rows;
      return {rows:Array.isArray(filas) ? filas : [],page:null};
    }catch(e){
      console.warn('[canal nuevo] no se pudieron leer las sesiones', e);
      return {rows:_sesiones,page:null};
    }
  }

  async function cargarSesiones(forzar){
    const pc = syncOffice(), revision = _revision;
    const ahora = Date.now();
    if(!forzar && (ahora - _ultima) < VIVE_MS) return _sesiones;
    if(_enCurso) return _enCurso;
    const flight = pedirSesiones(pc,_query).then(function(result){
      if(_pc === pc && revision === _revision && U(window.pcOperativa) === pc){
        if(result.page && _moreLoaded){
          const map=new Map(_sesiones.map(row=>[S(row.chat_id),row]));
          result.rows.forEach(row=>map.set(S(row.chat_id),row));
          _sesiones=[...map.values()];
          _page={...result.page,has_more:_page.has_more,next_before_id:_page.next_before_id};
        }else{ _sesiones=result.rows; _page=result.page; }
        _ultima = Date.now();
      }
      return _sesiones;
    }).finally(function(){ if(_enCurso === flight) _enCurso = null; });
    _enCurso=flight;
    return flight;
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
    const cerrado = ['CERRADO','RESUELTA'].includes(U(s.estado || ''));
    // Antes decía `accepted: !cerrado`, o sea: toda conversación abierta nacía ya aceptada.
    // Consecuencia: nunca pasaba por "En espera", que es de donde sale el aviso de chat nuevo —
    // así que una consulta del portal entraba sin que sonara ni se encendiera nada, y el operador
    // sólo se enteraba si miraba la lista. (Juan, 3/10: "sin notificacion de nuevos chats".)
    // Ahora se pregunta lo mismo que para el resto: ¿este operador la aceptó?
    const aceptada = !!(window._wq2IsAccepted && window._wq2IsAccepted(usuario));
    return {
      id: s._beta ? 'BETA_' + S(s.sesion_id) : 'CANAL_' + clave,
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
      _chatId: S(s.chat_id || s.id || ''),
      _beta: s._beta === true,
      _betaPc: s._betaPc,
      _unreadServidor: s._beta ? (window.NodoBetaChat?.count(s.chat_id) ?? Number(s.sin_leer)) : undefined
    };
  }

  // Los mensajes de una conversación del canal nuevo. Una llamada, sólo al abrirla.
  async function mensajesDe(chatId, options={}){
    if(!chatId) return [];
    const pc=syncOffice();
    if(window.NodoBetaChat && await window.NodoBetaChat.ready()){
      const page = await window.NodoBetaChat.mensajes(S(chatId),options);
      if(pc!==syncOffice()) return [];
      const cached = _mensajes.get(S(chatId));
      const previous = cached?.rows || [];
      const byId = new Map(previous.map(m=>[String(m.id),m]));
      page.rows.forEach(m=>byId.set(String(m.id),NodoChatMessage.normalize(m)));
      const rows = [...byId.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
      const expanded = !!options.beforeId || cached?._expanded;
      const tail = !options.beforeId && cached?._expanded ? cached : page;
      _mensajes.set(S(chatId), {...page,rows,_expanded:expanded,
        has_more:tail.has_more,next_before_id:tail.next_before_id,
        legacy_thread:NodoChatMessage.sinCopias(options.beforeId ? (cached?.legacy_thread || page.legacy_thread || []) : (page.legacy_thread || []),rows)});
      return rows;
    }
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
      .filter(function(s){ return incluirCerrados || !['CERRADO','RESUELTA'].includes(U(s.estado || '')); })
      .filter(function(s){
        if(s._beta) return true; // La página ya fue resuelta por servidor; no volver a recortarla.
        const t = new Date(s.fecha_ultimo || s.updated_at || s.created_at || 0).getTime();
        return isNaN(t) ? false : t >= corte;         // nada viejo vuelve a la bandeja
      })
      .map(comoTicket);
  }

  window._chatCanalNuevo = {
    cargar: cargarSesiones,
    tickets: ticketsDelCanalNuevo,
    mensajesDe: mensajesDe,
    paginaMensajes: chatId => _mensajes.get(S(chatId)),
    pagina: () => _page,
    async mas(){
      syncOffice();
      if(!_page?.has_more || !window.NodoBetaChat?.active()) return _sesiones;
      const pc=_pc, revision=_revision;
      const page=await window.NodoBetaChat.lista({usuario:_query || null,beforeId:_page.next_before_id});
      if(pc!==syncOffice() || revision!==_revision) return _sesiones;
      const map=new Map(_sesiones.map(row=>[S(row.chat_id),row]));
      page.rows.forEach(row=>map.set(S(row.chat_id),{...row,_beta:true,_betaPc:pc}));
      _sesiones=[...map.values()]; _page=page; _moreLoaded=true;
      return _sesiones;
    },
    async buscarUsuario(usuario){
      syncOffice();
      if(!await window.NodoBetaChat?.ready()) return false;
      // La lista que se ve queda como está hasta que llega la respuesta. Vaciarla primero dejaba
      // la bandeja en blanco en cada búsqueda, y en blanco para siempre si la conexión se cortaba
      // en el medio. Lo único que se descarta ya es la paginación: era de la consulta anterior.
      _query=S(usuario).trim(); _ultima=0; _revision++; _enCurso=null;
      _page=null; _moreLoaded=false;
      await cargarSesiones(true); return true;
    },
    // Con qué usuario está filtrada la lista ahora ('' = la lista de siempre).
    consulta: () => _query,
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

  function storageKey(ticket){
    if(ticket?._beta)return 'nodo_chat_local_beta_'+encodeURIComponent(JSON.stringify([ticket._betaPc,ticket._chatId]));
    return "nodo_chat_local_master_"+String(ticket?.masterId||ticket?.usuario||"x").replace(/[^A-Z0-9]/gi,"_");
  }
  function getSavedMsgs(ticket){try{return JSON.parse(localStorage.getItem(storageKey(ticket))||"[]")}catch(_e){return[]}}
  function setSavedMsgs(ticket,msgs){try{localStorage.setItem(storageKey(ticket),JSON.stringify(msgs||[]));return true;}catch(_e){return false;}}
  const betaRetries=new Map(), betaCargando=new Set();
  function freshTicket(ticket){
    if(!ticket) return null;
    return ticketsAgrupadosFinal().find(t=>ticket._chatId ? t._chatId===ticket._chatId : ticket.id ? t.id===ticket.id : U(t.usuario)===U(ticket.usuario))||ticket;
  }

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
      // Todo hilo que se dibuja o se guarda pasa por acá: lo inventado no se ve y no se vuelve a
      // escribir (D-130).
      if(NodoChatMessage.isFiller(m))return;
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

  // ── Store LOCAL de chats CERRADOS (Con aislamiento por oficina y TTL 7 días) ────────
  const CHATS_CERRADOS_KEY='nodo_chats_cerrados_v1';
  function _pcActualChat(){
    return String((typeof pcOperativa!=="undefined"&&pcOperativa)||window.pcOperativa||"").toUpperCase().trim();
  }
  function _chatsCerradosAll(){
    try{
      const map = JSON.parse(localStorage.getItem(CHATS_CERRADOS_KEY)||'{}')||{};
      const pc = _pcActualChat();
      const corte7Dias = Date.now() - (7 * 24 * 3600 * 1000);
      let cambio = false;
      for(const k of Object.keys(map)){
        const c = map[k];
        if(!c){ delete map[k]; cambio = true; continue; }
        const f = toDate(c.fecha || c._cachedAt || 0).getTime();
        // 1) Si tiene más de 7 días, se purga para evitar consumo desmedido de RAM/disco
        if(f > 0 && f < corte7Dias){
          delete map[k]; cambio = true; continue;
        }
        // 2) Si tiene oficina asignada y no coincide con la oficina actual del nodo, se descarta
        if(c.pc_codigo && pc && String(c.pc_codigo).toUpperCase().trim() !== pc){
          delete map[k]; cambio = true; continue;
        }
      }
      if(cambio) _chatsCerradosSave(map);
      return map;
    }catch(_e){ return {}; }
  }
  function _chatsCerradosSave(map){
    try{
      const keys=Object.keys(map);
      if(keys.length>300){ keys.map(k=>({k,f:toDate(map[k].fecha||0)})).sort((a,b)=>a.f-b.f).slice(0,keys.length-300).forEach(x=>delete map[x.k]); }
      localStorage.setItem(CHATS_CERRADOS_KEY, JSON.stringify(map));
    }catch(_e){}
  }
  function _chatsCerradosGuardar(list){
    try{
      const map=_chatsCerradosAll(); let cambio=false;
      const pc = _pcActualChat();
      (list||[]).forEach(g=>{
        if(!g || !g.cerrado) return;
        const key=U(g.usuario||''); if(!key) return;
        map[key]={ id:g.id, usuario:g.usuario, telefono:g.telefono||'', thread:(g.thread||[]).slice(-200),
          masterId:g.masterId||null, solicitudId:g.solicitudId||'', fecha:g.fecha||'', mensaje:g.mensaje||'',
          items:(g.items||[]).map(s=>({ID:idSol(s)})).filter(x=>x.ID), _cachedAt:new Date().toISOString(),
          pc_codigo: pc };
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
      g._legacyOwner=true;
      const linkedChat=S(m0.chat_id||s.chat_id||s.CHAT_ID||'');
      if(linkedChat){ g._chatId=linkedChat; g._betaLinked=window.NodoBetaChat?.active()===true; }
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
          if(t._beta){
            // A user name is not a conversation identity. Only an explicit bridge
            // may reuse legacy ownership; two episodes of the same user stay separate.
            // El puente también se reconoce por la solicitud que guarda el chat: la solicitud no guarda
            // el número del chat, y el mismo chat salía dos veces en la lista (Juan, 2/11).
            const sid=Number(t.solicitudId||0);
            const index=list.findIndex(g=>(g._chatId && g._chatId===t._chatId) || (!g._beta && sid && (g.items||[]).some(s=>idSol(s)===sid)));
            if(index<0){list.push(t);return;}
            const old=list[index];
            list[index]={...old,...t,items:old.items,masterId:old.masterId,_legacyThread:old.thread,
              solicitudId:old.solicitudId,_legacyOwner:true,_betaLinked:true};
            return;
          }
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
      /* Cuando el mensaje ES una imagen, la burbuja se ensancha: el comprobante es el mensaje,
         no un adorno al costado del texto. Con el 70% de las burbujas de texto la foto quedaba
         en unos 250px de ancho y no se leía nada. */
      .wq2-bubble:has(.wq2-img){max-width:92%}
      .wq2-row.user .wq2-bubble{background:#1f2937;color:#e5e7eb}
      .wq2-row.op .wq2-bubble{background:#14532d;color:#dcfce7}
      .wq2-row.bot{justify-content:flex-end}
      .wq2-row.bot .wq2-bubble{background:#25204a;color:#eee7ff;border:1px solid #6558a4}
      .wq2-row.system{justify-content:center}
      .wq2-row.system .wq2-bubble{background:#17212d;color:#b7c3d2;border:1px dashed #657387}
      .wq2-author{font-size:11px;font-weight:700;margin-bottom:5px;letter-spacing:.02em}
      .wq2-time{font-size:10px;color:#9ca3af;margin-top:4px;text-align:right}
      /* Lista de chats. La línea de estado sólo existe cuando hay un problema (vacía no ocupa
         lugar) y "Cargar más" es el mismo botón de las solapas, no uno sin estilo. */
      .wq2-wrap .wq2-estado{padding:7px 14px;font-size:11px;font-weight:700;color:#fca5a5;background:rgba(127,29,29,.28);border-bottom:1px solid rgba(248,113,113,.22)}
      .wq2-wrap .wq2-estado:empty{display:none}
      .wq2-wrap .wq2-mas{padding:12px;text-align:center}
      .wq2-wrap .wq2-mas .wq2-tab{cursor:pointer}
      .wq2-wrap .wq2-mas .wq2-tab:hover:not(:disabled){background:#273449}
      .wq2-wrap .wq2-mas .wq2-tab:disabled{opacity:.6;cursor:default}
    `;
    document.head.appendChild(st);
  }

  window.wq2SetTab=function(tab){window.__wq2ActiveTab=tab;renderChatListStep2Final();}
  function tabActual(){return window.__wq2ActiveTab||"espera"}

  // ── Buscador de la lista ───────────────────────────────────────────────────
  // Hay UN solo buscador (#wq2Search). Al escribir filtra lo que ya está en la lista. Si el chat
  // nuevo está andando, hay 3 letras o más y acá no aparece nada, a los 400 ms le pregunta al
  // servidor por ese usuario (la lista cargada trae sólo las últimas conversaciones). Al vaciar
  // el cuadro, la lista vuelve a ser la de siempre.
  const BUSQUEDA_MIN=3, BUSQUEDA_ESPERA_MS=400, BUSQUEDA_REINTENTO_MS=15000;
  const SIN_CONEXION="Sin conexión con el chat. Reintentando…";   // el mismo texto que escribe beta-chat.js
  // timer: la espera de los 400 ms · activas: preguntas al servidor en camino · mas: "Cargar más"
  // en camino · noAntesDe: tope para que la vuelta a la lista de siempre no se reintente sin pausa.
  const busqueda={timer:0,activas:0,mas:false,noAntesDe:0};
  function textoBuscado(){return S(document.getElementById("wq2Search")?.value).toLowerCase().trim()}
  function coincideBusqueda(t,q){return (S(t.usuario)+" "+S(t.telefono)+" "+S(t.mensaje)).toLowerCase().includes(q)}
  function consultaDelServidor(){
    try{return S(window._chatCanalNuevo?.consulta?.()).toLowerCase()}catch(_e){return ""}
  }
  function avisarError(texto){try{toast(texto,"red")}catch(_e){}}
  // Para repintar desde lo que termina tarde (una respuesta del servidor): si el repintado
  // tropieza, que no se convierta en un error suelto de una promesa que nadie espera.
  function repintarLista(){try{renderChatListStep2Final()}catch(e){console.warn("lista de chats",e)}}

  // Lo llama el cuadro de búsqueda en cada tecla: filtra al instante lo que ya está, y deja
  // programada la consulta al servidor para cuando se deje de escribir.
  window.wq2Buscar=function(){
    // Primero la espera y después el repintado: la lista tiene que saber que hay una búsqueda en
    // camino para decir "Buscando…" y no "No encontramos…" durante esos 400 ms.
    clearTimeout(busqueda.timer);
    busqueda.timer=setTimeout(()=>{busqueda.timer=0;void sincronizarBusqueda();},BUSQUEDA_ESPERA_MS);
    renderChatListStep2Final();
  };

  async function sincronizarBusqueda(){
    if(!window._chatCanalNuevo||!window.NodoBetaChat?.active?.())return;
    busqueda.activas++;
    try{
      const q=textoBuscado();
      const aplicada=consultaDelServidor();
      // El servidor quedó filtrado por algo que ya no se está escribiendo (o el cuadro quedó
      // vacío): primero se vuelve a la lista de siempre y recién ahí se mira qué falta.
      if(aplicada&&!(q.length>=BUSQUEDA_MIN&&aplicada.includes(q))){
        if(!await window.nodoBuscarChatBeta(""))return;
        if(textoBuscado()!==q)return;              // siguió escribiendo: lo ve la pasada que sigue
      }
      if(q.length<BUSQUEDA_MIN||consultaDelServidor()===q)return;
      if(ticketsAgrupadosFinal(true).some(t=>coincideBusqueda(t,q)))return;   // ya está a la vista
      await window.nodoBuscarChatBeta(q);
    }finally{
      busqueda.activas--;
      repintarLista();
    }
  }

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

    // Lo escrito vuelve al cuadro tal cual (mayúsculas, espacios): sólo para comparar se normaliza.
    const entrada=document.getElementById("wq2Search");
    const escrito=entrada?S(entrada.value):"";
    const q=escrito.toLowerCase().trim();
    let pool=tab==="cerrados"?cerrados:tab==="abiertos"?abiertos:espera;
    if(q)pool=pool.filter(t=>coincideBusqueda(t,q));

    try{
      window.nodoChatRefreshUnread?.();
      try{ window.__wq2EnEspera=espera.length; }catch(_e){} // fuente ACTUAL de "sin leer" (el banner de Inicio la usa)
    }catch(_e){}

    const tabBtn=(id,label,count,active)=>`<button class="wq2-tab${active?" active":""}" onclick="wq2SetTab('${id}')">${label}${count?` <span class="wq2-count">${count}</span>`:""}</button>`;
    const beta=window.NodoBetaChat?.active();
    // Estado del chat: nada cuando anda bien. Con un problema, una sola línea corta y sin códigos
    // (el código ya queda en el semáforo). El nodo existe aunque esté vacío para que beta-chat.js
    // lo pueda llenar apenas cambie el estado, sin esperar al próximo repintado.
    const estadoChat=window.NodoBetaChat?.status?.();
    const lineaEstado=estadoChat&&estadoChat.enabled?`<div id="nodoBetaChatEstado" class="wq2-estado" role="status">${estadoChat.code?SIN_CONEXION:""}</div>`:"";
    let html=`<div class="wq2-wrap">
      <div class="wq2-search"><input id="wq2Search" placeholder="Nombre, número o usuario..." oninput="wq2Buscar()" value="${E(escrito)}"></div>
      ${lineaEstado}
      <div class="wq2-tabs">
        ${tabBtn("espera","En espera",espera.length,tab==="espera")}
        ${tabBtn("abiertos","Abiertos",abiertos.length,tab==="abiertos")}
        ${tabBtn("cerrados","Cerrados",cerrados.length,tab==="cerrados")}
      </div>`;

    if(!pool.length){
      let vacio;
      if(!q){
        vacio=tab==="cerrados"?"No hay chats cerrados recientes.":tab==="abiertos"?"No hay chats abiertos.":tab==="interno"?"Sin mensajes internos.":"No hay consultas en espera.";
      }else{
        // Buscando algo que no está en ESTA solapa: antes de decir que no existe se mira en las otras.
        const enOtras=[["espera","En espera",espera],["abiertos","Abiertos",abiertos],["cerrados","Cerrados",cerrados]]
          .filter(x=>x[0]!==tab).map(x=>[x[1],x[2].filter(t=>coincideBusqueda(t,q)).length]).filter(x=>x[1]>0);
        if(enOtras.length) vacio="Nada en esta solapa. Hay resultados en: "+enOtras.map(x=>x[0]+" ("+x[1]+")").join(", ")+".";
        // "Buscando…" mientras la pregunta está en camino o esperando sus 400 ms; si el servidor ya
        // estaba filtrado por este mismo texto no hay nada que esperar.
        else if(beta&&q.length>=BUSQUEDA_MIN&&(busqueda.activas>0||(busqueda.timer&&consultaDelServidor()!==q))) vacio="Buscando…";
        else vacio="No encontramos a ese usuario.";
      }
      html+=`<div class="wq2-empty">${E(vacio)}</div>`;
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
        html+=`<div data-ticket-id="${E(t.id)}" class="wq2-item ${active?"active":""} ${accepted?"chat-open-final":""}"
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
    // "Cargar más" es el mismo botón de las solapas, centrado al pie de la lista.
    if(beta && window._chatCanalNuevo?.pagina()?.has_more) html+=`<div class="wq2-mas"><button class="wq2-tab" onclick="nodoMasChatsBeta()"${busqueda.mas?" disabled":""}>${busqueda.mas?"Cargando…":"Cargar más conversaciones"}</button></div>`;
    html+=`</div>`;

    // Poner el html nuevo destruye el cuadro de búsqueda (y la lista que se venía bajando). Se
    // anota dónde estaba el cursor y cuánto se había bajado, y se deja todo como estaba: si no,
    // cada tecla —y cada repintado automático— sacaba al operador del cuadro en medio de lo que
    // escribía.
    const teniaFoco=!!entrada&&document.activeElement===entrada;
    const selIni=teniaFoco?entrada.selectionStart:null, selFin=teniaFoco?entrada.selectionEnd:null;
    const selDir=teniaFoco?entrada.selectionDirection:null;
    const envoltorio=box.querySelector(".wq2-wrap");
    const bajadoWrap=envoltorio?envoltorio.scrollTop:0, bajadoBox=box.scrollTop;
    box.innerHTML=html;
    if(bajadoBox)box.scrollTop=bajadoBox;
    const envoltorioNuevo=bajadoWrap?box.querySelector(".wq2-wrap"):null;
    if(envoltorioNuevo)envoltorioNuevo.scrollTop=bajadoWrap;
    if(teniaFoco){
      const nueva=document.getElementById("wq2Search");
      if(nueva){
        try{nueva.focus({preventScroll:true});}catch(_e){}
        try{nueva.setSelectionRange(selIni,selFin,selDir||"none");}catch(_e){}
      }
    }
    window.nodoChatRefreshUnread?.();

    // El cuadro quedó vacío pero el servidor sigue filtrado por una búsqueda anterior (por ejemplo
    // se cortó la conexión justo al borrar): se vuelve a la lista de siempre, sin insistir más de
    // una vez cada 15 s.
    if(beta&&!q&&!busqueda.timer&&busqueda.activas===0&&consultaDelServidor()&&Date.now()>=busqueda.noAntesDe){
      busqueda.noAntesDe=Date.now()+BUSQUEDA_REINTENTO_MS;
      void window.nodoBuscarChatBeta("",true);
    }
  }

  window.renderChatListStep2=renderChatListStep2Final;
  window.v15RenderChatList=renderChatListStep2Final;
  window.cargarChats=async function(){renderChatListStep2Final();return{ok:true,data:ticketsAgrupadosFinal()}};
  window.v15CargarChatsCompacto=window.cargarChats;
  // Le pregunta al servidor por un usuario ("" = volver a la lista de siempre) y repinta la lista.
  // Devuelve true si el servidor contestó. Si falla, el operador lee una frase corta: el motivo
  // técnico no le sirve y queda en el semáforo (NodoSalud).
  window.nodoBuscarChatBeta=async function(texto,silencioso){
    const canal=window._chatCanalNuevo;
    if(!canal)return false;
    let contesto=false;
    busqueda.activas++;
    try{
      repintarLista();                              // mientras tanto la lista dice "Buscando…"
      contesto=(await canal.buscarUsuario(S(texto).trim()))!==false;
    }catch(_e){
      if(!silencioso)avisarError("No pudimos buscar. Probá de nuevo en un momento.");
    }finally{
      busqueda.activas--;
      if(!contesto)busqueda.noAntesDe=Date.now()+BUSQUEDA_REINTENTO_MS;
    }
    repintarLista();
    return contesto;
  };
  window.nodoMasChatsBeta=async function(){
    if(busqueda.mas)return;
    busqueda.mas=true;
    try{
      repintarLista();                              // el botón pasa a "Cargando…" y no se aprieta dos veces
      await window._chatCanalNuevo.mas();
    }catch(_e){avisarError("No pudimos cargar más conversaciones. Probá de nuevo en un momento.");}
    finally{busqueda.mas=false;}
    repintarLista();
  };
  window.nodoMasMensajesBeta=async function(){
    const t=window.__nodoChatCurrentTicket;
    const page=window._chatCanalNuevo?.paginaMensajes(t?._chatId);
    if(!t?._beta || !page?.has_more) return;
    try{await window._chatCanalNuevo.mensajesDe(t._chatId,{beforeId:page.next_before_id});
      if(window.__nodoChatCurrentTicket?._chatId===t._chatId)renderChatConversationStep5();
    }catch(_e){avisarError("No pudimos cargar los mensajes anteriores. Probá de nuevo en un momento.");}
  };

  window.aceptarTicketLocalStep2=function(ticketId){
    let ticket=ticketsAgrupadosFinal().find(t=>t.id===ticketId);
    if(!ticket){
      // Si no está entre las activas, chequear si es un ticket de cerrados cacheados
      ticket = (ticketsAgrupadosFinal(true)||[]).find(t=>t.id===ticketId);
    }
    if(!ticket){
      // Era un residuo fantasma de otra sesión / oficina: purgarlo de una vez para que no estorbe
      try{
        const store = _chatsCerradosAll();
        let encontrado = false;
        for(const k of Object.keys(store)){
          if(store[k].id === ticketId || ("TICKET_" + k.replace(/[^A-Z0-9]/g,"_")) === ticketId || k === ticketId){
            delete store[k];
            encontrado = true;
          }
        }
        if(encontrado){
          _chatsCerradosSave(store);
          renderChatListStep2Final();
          try{ if(typeof toast==='function') toast("Consulta de otra sesión removida del historial local.","blue"); }catch(_e){}
          return;
        }
      }catch(_e){}
      renderChatListStep2Final();
      try{ if(typeof toast==='function') toast("No se encontró la consulta activa en esta oficina.","amber"); }catch(_e){}
      return;
    }
    setAccepted(ticket.usuario,ticket.masterId);
    ticket.accepted=true;
    window.__nodoChatCurrentUser=ticket.usuario;
    window.__nodoChatCurrentTicket=ticket;
    document.body.classList.add("nodo-chat-open");
    // Cargar chat_mensajes para obtener imagen_url de mensajes de usuarios y canal nuevo
    try{
      const sol=(ticket.items||[]).find(s=>metaObj(s).chat_id||s.chat_id||s.CHAT_ID);
      const chatId=ticket._chatId||ticket.chatId||(sol&&(sol.CHAT_ID||sol.chat_id||metaObj(sol).chat_id))||"";
      if(chatId){
        window.chatActualId=String(chatId);
        ticket._chatId=String(chatId);
        if(window.V154P)window.V154P.chatActual=String(chatId);
        if(typeof window._v154pCargarChat==="function")setTimeout(()=>window._v154pCargarChat(true),200);
        else if(window._chatCanalNuevo && typeof window._chatCanalNuevo.mensajesDe==="function"){
          window._chatCanalNuevo.mensajesDe(chatId).then(nuevos=>{
            if(nuevos && nuevos.length){
              ticket.thread = uniqThread((ticket.thread||[]).concat(nuevos));
              if(window.__nodoChatCurrentTicket?._chatId===String(chatId))renderChatConversationStep5();
            }
          }).catch(()=>{});
        }
      }
      else { window.chatActualId=''; if(window.V154P)window.V154P.chatActual=''; }
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
    const fresh=freshTicket(ticket);
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
    }catch(_e){}

    // Mezclamos el thread del SERVIDOR con la copia LOCAL (localStorage). Antes el render leía
    // solo fresh.thread → el mensaje recién enviado desaparecía hasta el próximo poll (~15s), que
    // se percibía como "no guarda los mensajes". El localStorage ya se escribe al enviar; uniqThread
    // dedup-ea (mismo origen+fecha+mensaje), así el server y el local no se duplican, y los mensajes
    // aún-no-propagados al server igual se ven y sobreviven una recarga.
    const betaPage=fresh._beta?window._chatCanalNuevo?.paginaMensajes(fresh._chatId):null;
    // Sin los mensajes en memoria se dibujaba la conversación vacía y nadie los volvía a pedir.
    if(fresh._beta&&!betaPage&&fresh._chatId&&!betaCargando.has(S(fresh._chatId))){
      const id=S(fresh._chatId);betaCargando.add(id);
      Promise.resolve(window._chatCanalNuevo?.mensajesDe?.(id))
        .then(()=>{if(S(window.__nodoChatCurrentTicket?._chatId)===id&&window._chatCanalNuevo?.paginaMensajes(id))renderChatConversationStep5();},e=>console.warn('mensajes del chat:',e))
        .finally(()=>betaCargando.delete(id));
    }
    if(fresh._beta) fresh.thread=(betaPage?.rows||[]).concat((betaPage?.legacy_thread||[]).map(m=>({...m,id:null,_legacy:true})));
    const combined=(fresh.thread||[]).concat(getSavedMsgs(fresh));
    // Canonical IDs identify messages. Equal text/time does not prove two
    // historical messages or a legacy projection are the same event.
    const msgs=fresh._beta ? [...combined.reduce((map,raw,index)=>{
      const m=normalizeThreadRow(raw);
      const key=m.id?'id:'+m.id:m.portal_key?'legacy:'+m.portal_key:m.request_id?'request:'+m.request_id:'local:'+index;
      map.set(key,map.has(key)?NodoChatMessage.merge(map.get(key),m):m);return map;
    },new Map()).values()].filter(m=>!NodoChatMessage.isFiller(m)).sort((a,b)=>toDate(a.fecha)-toDate(b.fecha)) : uniqThread(combined);
    // La tarjeta de cotejo mira la conversación entera. Antes, en el canal nuevo, veía sólo el último
    // mensaje: cambiaba con cada mensaje y se redibujaba con el botón debajo del clic.
    try{ if(window._altaCotejoConsulta) window._altaCotejoConsulta({...fresh,thread:msgs}); }catch(_e){}
    // Parchear imagen_url desde window.chatMensajes cuando el RPC no lo incluye en chat_thread.
    // Matching por timestamp más cercano (diferencia < 5 min) para evitar asignar imagen incorrecta
    // cuando hay múltiples mensajes con imagen.
    const cmArr=(window.chatMensajes||window.V154P?.chatMensajes||[]);
    const usedCm=new Set();
    if(cmArr.length && !fresh._beta){
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
    if(fresh._beta && betaPage?.has_more) html+=`<div style="text-align:center;margin:0 0 10px"><button class="mini-btn gray" onclick="nodoMasMensajesBeta()">Cargar mensajes anteriores</button></div>`;
    // Con _chatId los mensajes llegan después de abrir: hilo vacío ahí no significa que no escribió.
    if(!msgs.length && !fresh._chatId) html+=`<div class="wq2-row system"><div class="wq2-bubble">El jugador todavía no escribió nada.</div></div>`;
    msgs.forEach(m=>{
      const op=NodoChatMessage.role(m)==="OPERADOR";
      const imgSrc=m.imagen_url||m.imagen||"";
      // La vista previa ya no recorta. Antes era una caja de 220×180 con `object-fit:cover`, que
      // recorta: de un comprobante de transferencia —que es alto— se veía un pedazo del medio.
      // Juan, 25/10: "no se aprecia un carajo lo que mierda envia el usuario".
      // Ahora ocupa el ancho de la burbuja y conserva la proporción, así que se lee de una.
      //
      // Ni la url ni el nombre se meten adentro del onclick: van por atributos y el handler los
      // lee de `this`. E() escribe las comillas como &#39;, que el navegador vuelve a convertir
      // en comilla ANTES de que lo lea el JavaScript — un titular "D'Angelo" partía el botón.
      const imgHtml = imgSrc ? `<div class="wq2-img" style="margin-top:6px"><img src="${E(imgSrc)}" data-titulo="${E(NodoChatMessage.author(m,fresh.usuario))}" style="max-width:100%;height:auto;max-height:min(46vh,420px);border-radius:8px;display:block;cursor:zoom-in;object-fit:contain;background:#0b0f16;border:1px solid rgba(255,255,255,0.12)" title="Clic para verla en una ventana aparte" onclick="if(window.nodoVerImagenCompleta){window.nodoVerImagenCompleta(this.src,this.dataset.titulo||'');}else{window.open(this.src,'_blank');}" onerror="this.onerror=null;this.style.opacity='0.6';this.alt='No se pudo cargar la imagen';"></div>` : "";
      const editBtn=(op && !imgSrc && m.fecha && !fresh._beta)?`<button class="wq2-edit" onclick="editarMensajeOperador('${E(m.fecha)}')" title="Editar este mensaje (también se actualiza para el cliente)">✏️</button>`:"";
      const editedTag=m.editado?`<span class="wq2-edited" title="Mensaje editado">· editado</span>`:"";
      const retryBtn=fresh._beta && m.request_id && !m.persisted ?
        `<button type="button" data-beta-request-id="${E(m.request_id)}" onclick="nodoReintentarMensajeBeta(this.dataset.betaRequestId)">Confirmación pendiente · Reintentar</button>`:'';
      const receipt=fresh._beta && m.id?` data-beta-message-id="${E(m.id)}" data-beta-role="${E(NodoChatMessage.role(m))}"`:'';
      html+=`<div${receipt} class="wq2-row ${NodoChatMessage.className(m)}"><div class="wq2-bubble"><div class="wq2-author">${E(NodoChatMessage.author(m,fresh.usuario))}</div>${E(NodoChatMessage.visibleText(m)).replace(/\n/g,"<br>")}${imgHtml}<div class="wq2-time" title="${E(m.fecha)}">${hora(m.fecha)}${editedTag}${editBtn}${retryBtn}</div></div></div>`;
    });
    html+=`</div>`;
    bodies.forEach((box,i)=>{
      if(box.innerHTML!==html){
        box.innerHTML=html;
        if(atBottom[i])box.scrollTop=box.scrollHeight;
      }
    });
    if(fresh._beta) window.NodoBetaChat?.observeRendered(fresh,bodies,msgs);
  }
  window.renderChatMensajes=renderChatConversationStep5;
  window.v15RenderChatMensajes=renderChatConversationStep5;
  window.cargarChatActual=async function(){renderChatConversationStep5();return{ok:true}};

  // Editar un mensaje ya enviado por el operador (por si se equivocó). Actualiza la copia local +
  // el chat_thread del servidor → el cliente ve el texto corregido en el portal. Modal (no prompt,
  // que en Electron no anda). Marca el mensaje como "editado".
  window.editarMensajeOperador=function(fechaIso){
    const ticket=window.__nodoChatCurrentTicket; if(!ticket) return;
    if(ticket._beta) return; // Editing needs its own authenticated server contract.
    const fresh=freshTicket(ticket);
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
    const operador=(window.operador?.usuario||window.operador?.nombre||"panel");
    const fresh=freshTicket(ticket);
    // Una conversación, un solo escritor, nunca los dos a la vez: ver NodoChatMessage.escritor.
    let caeAlHilo=false;
    // Un chat que el jugador ya no lee, como uno de mayo que sigue abierto: el mensaje va al hilo de
    // su usuario, que el Portal lee siempre. Escribir en ese chat era decir "enviado" a nadie.
    const texto=S(extraMsg?.mensaje).trim();
    const sesiones=window._chatCanalNuevo?.crudas?.()||[];
    if(fresh._beta&&texto&&!extraMsg.imagen_url&&sesiones.some(s=>S(s.chat_id)===S(fresh._chatId))&&S(fresh._chatId)!==NodoChatMessage.chatVigente(sesiones,fresh.usuario,Date.now())){
      const {data,error}=await supabaseClient.rpc('panel_chat_iniciar',{p_secret:window.PANEL_DATA_SECRET,p_pc_codigo:_pcActualChat(),p_usuario:fresh.usuario,p_mensaje:texto,p_operador:operador});
      if(error||data?.ok!==true)throw new Error(error?.message||data?.error||'El servidor no confirmó el mensaje');
      return;
    }
    if(NodoChatMessage.escritor(fresh,!!extraMsg)==='CANAL'){
      if(!extraMsg) return; // Accepting locally is neither a message nor a read receipt.
      const chatId=S(fresh._chatId);
      if(!chatId)throw new Error('No se identificó la conversación');
      if(fresh._beta){
        if(fresh._betaPc!==_pcActualChat())throw new Error('BETA_CONTEXT_CHANGED');
        if(!extraMsg.request_id)extraMsg.request_id=window.crypto.randomUUID();
        const pending=getSavedMsgs(fresh).filter(m=>m.fecha!==extraMsg.fecha || m.request_id && m.request_id!==extraMsg.request_id);
        pending.push(extraMsg);
        if(!setSavedMsgs(fresh,pending))throw new Error('No se pudo conservar el identificador para reintentar el mensaje');
        let confirmed=null;
        try{confirmed=await window.NodoBetaChat.enviar(chatId,extraMsg);}
        catch(e){
          // Lo cerraron recién y este NODO todavía no se enteró: por el hilo igual le llega al jugador.
          if(!fresh._legacyOwner||!/BETA_CHAT_CLOSED/.test(e?.message||''))throw e;
          setSavedMsgs(fresh,getSavedMsgs(fresh).filter(m=>m.request_id!==extraMsg.request_id));
          caeAlHilo=true;
        }
        if(!caeAlHilo){
          const saved=getSavedMsgs(fresh).map(m=>m.request_id===extraMsg.request_id?{...m,...NodoChatMessage.normalize(confirmed),persisted:true}:m);
          setSavedMsgs(fresh,saved);
          // Copia en el hilo, igual que la de los mensajes del jugador: es lo único que el Portal puede
          // leer cuando este chat se cierre, y lo que ven las PCs sin actualizar. Se agrega en el
          // servidor, sin pisar el hilo, y deja la bandeja al día. Portal y NODO no la muestran doble.
          const copia=S(extraMsg.mensaje).trim();
          if((fresh._legacyOwner||fresh.solicitudId)&&copia&&window.PANEL_DATA_SECRET){
            supabaseClient.rpc('panel_chat_iniciar',{p_secret:window.PANEL_DATA_SECRET,p_pc_codigo:_pcActualChat(),p_usuario:fresh.usuario,p_mensaje:copia,p_operador:operador})
              .then(r=>{if(r?.error||r?.data?.ok===false)console.warn('copia en el hilo:',r?.error||r?.data?.error);},e=>console.warn('copia en el hilo:',e));
          }
          return;
        }
      }
      if(!caeAlHilo){
      if(typeof window.panelAPI?.rpc!=='function')throw new Error('Canal de chat no disponible');
      const _chatHealth=window.NodoSalud?.begin?.('CHAT');
      const result=await window.panelAPI.rpc(extraMsg.imagen_url?'panel_nodo_send_chat_message':'panel_core_enviar_chat_json',{
        p_chat_id:chatId,p_mensaje:extraMsg.mensaje||(extraMsg.imagen_url?'[Imagen adjunta]':''),p_emisor:operador,
        ...(extraMsg.imagen_url?{p_imagen_url:extraMsg.imagen_url,p_pc_codigo:_pcActualChat()}: {})
      });
      _chatHealth?.reply?.(result?.error);
      let data=result?.data;
      if(typeof data==='string'){try{data=JSON.parse(data);}catch(_){}}
      if(result?.error || !data || data.ok===false || data.exito===false){
        _chatHealth?.record?.('EFFECT','ERROR','CHAT_LEGACY_SEND_ERROR');
        throw new Error(result?.error?.message||data?.error||'El servidor no confirmó el mensaje');
      }
      _chatHealth?.record?.('EFFECT','OK');
      return;
      }
    }
    if(typeof actualizarSolicitudPortal!=="function")throw new Error("actualizarSolicitudPortal no disponible");
    const thread=uniqThread(fresh._legacyThread||fresh.thread);
    // Si localStorage falló al guardar (ej. imagen base64 grande), incluir el mensaje directamente
    if(extraMsg){
      const yaEsta=thread.some(m=>m.fecha===extraMsg.fecha&&U(m.origen)==="OPERADOR");
      if(!yaEsta)thread.push(extraMsg);
    }
    const masterId=Number(fresh.masterId||fresh.solicitudId||0);

    if(!masterId)throw new Error('No se identificó la solicitud de la conversación');
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

    const fresh=freshTicket(ticket);
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
      const errTxt = String(e?.message || e || '');
      let humano = 'No se pudo guardar la respuesta en el servidor. Tu mensaje quedó acá para reintentar.';
      if (/BETA_CHAT_CLOSED|cerrad/i.test(errTxt)) {
        humano = 'Esta consulta figuraba como cerrada. La reabrimos en el sistema; probá enviar de nuevo.';
        try { if (typeof window.reabrirConsultaWq2 === 'function') window.reabrirConsultaWq2(fresh.id); } catch(_re) {}
      } else if (/NETWORK|fetch failed|econn|timeout|sin conexi/i.test(errTxt)) {
        humano = 'Sin conexión con el servidor. Tu mensaje quedó guardado para enviarse al volver internet.';
      } else if (/BETA_CONTEXT_CHANGED/i.test(errTxt)) {
        humano = 'Cambió la oficina seleccionada. Reabrí la conversación para enviar.';
      }
      try { if (typeof toast === 'function') toast(humano, 'amber'); else alert(humano); } catch(_a) { alert(humano); }
      renderChatConversationStep5();
      return{ok:false,error:e};
    }
  };
  window.v15EnviarChatCompacto=function(){return window.enviarChat("v15ChatInput");};

  window.nodoReintentarMensajeBeta=async function(requestId){
    const ticket=window.__nodoChatCurrentTicket;
    if(!ticket?._beta || ticket._betaPc!==_pcActualChat())return{ok:false,error:'BETA_CONTEXT_CHANGED'};
    const key=ticket._betaPc+'|'+ticket._chatId+'|'+requestId;
    if(betaRetries.has(key))return betaRetries.get(key);
    const message=getSavedMsgs(ticket).find(m=>m.request_id===requestId && !m.persisted);
    if(!message)return{ok:false,error:'BETA_PENDING_MESSAGE_MISSING'};
    const pending=(async()=>{
      try{await persistirChatStep5(ticket,'RESPONDIDO_PANEL',message);return{ok:true};}
      catch(e){try{toast('Sigue pendiente: '+e.message,'red');}catch(_){}return{ok:false,error:e.message};}
      finally{betaRetries.delete(key);renderChatConversationStep5();}
    })();
    betaRetries.set(key,pending);return pending;
  };

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
    // Por el canal nuevo, sólo al chat que el jugador está leyendo. Con un chat viejo abierto, esto
    // agarraba el primero que encontraba: NODO decía "enviado" y al jugador no le llegaba nada.
    const elegir=nombre=>{
      const u=U(nombre),propios=u?ticketsAgrupadosFinal().filter(t=>U(t.usuario)===u):[];
      const vigente=NodoChatMessage.chatVigente(window._chatCanalNuevo?.crudas?.(),u,Date.now());
      return propios.find(t=>t._beta&&S(t._chatId)===vigente)||propios.find(t=>!t._beta)||null;
    };
    const actual=preferirTicketAbierto?window.__nodoChatCurrentTicket:null;
    let fresh=actual?(elegir(actual.usuario)||(actual._beta?null:actual)):null;
    if(!fresh) fresh=elegir(usuario);
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
  window.nodoIniciarChat=async function(usuario,texto,preferirTicketAbierto){
    const u=S(usuario).trim(); texto=S(texto).trim();
    if(!u||!texto) return {ok:false,error:"faltan-datos"};
    // Si ya tiene conversación en la bandeja, va por el camino de siempre.
    try{
      const r0=await window.nodoEnviarMensajePortal(u,texto,!!preferirTicketAbierto);
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
        for(const chat of NodoChatMessage.chatsDeLaConsulta(ticket,window._chatCanalNuevo?.tickets?.(false))){
          // Motivo vacío a propósito: se cierra en silencio. Con el motivo puesto, la base le
          // escribe al JUGADOR "Cerrado manualmente desde panel" — texto nuestro, interno.
          const r = await window.panelAPI.rpc('panel_v14_cerrar_chat_json',
            { p_session_id:null, p_chat_id:String(chat._chatId), p_motivo:'' });
          if(r && r.error) throw new Error(r.error.message || 'no se pudo cerrar la conversación');
          algoSeCerro=true;
          // Sólo la solicitud puente. Un chat también puede estar atado a una carga o un retiro de
          // verdad: cerrarlo acá la sacaba de la fila, o le pisaba el ACREDITADA.
          const sid = Number(chat.solicitudId||0);
          if(sid && soporteRows(true).some(s=>Number(idSol(s))===sid)) await actualizarSolicitudPortal(sid,"CERRADO",{chat_estado:"CERRADO"});
        }
        try{ await window._chatCanalNuevo?.cargar?.(true); }catch(e){ console.warn('refrescar chats al cerrar:',e); }
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
    if(!t){
      // Si no existe, limpiar del cache de cerrados y refrescar
      try{
        const store = _chatsCerradosAll();
        for(const k of Object.keys(store)){
          if(store[k].id === ticketId || U(store[k].usuario) === U(ticketId) || k === ticketId){
            delete store[k];
          }
        }
        _chatsCerradosSave(store);
        renderChatListStep2Final();
      }catch(_e){}
      try{toast('Consulta de otra sesión removida.','blue');}catch(_e){}
      return;
    }
    try{
      let actualizado = false;
      for(const s of (t.items||[])){
        const sid=idSol(s);
        if(sid){
          await actualizarSolicitudPortal(sid,"EN_REVISION",{chat_estado:"RESPONDIDO_PANEL",chat_master_id:t.masterId||t.solicitudId||sid});
          actualizado = true;
        }
      }
      setAccepted(t.usuario, t.masterId);       // vuelve a "Abiertos"
      window.__wq2ActiveTab="abiertos";
      if(typeof cargarSolicitudesPortal==="function")await cargarSolicitudesPortal(true);
      renderChatListStep2Final();
      const _abrir = window.aceptarTicketLocalStep2 || (typeof aceptarTicketLocalStep2==="function"?aceptarTicketLocalStep2:null);
      if(_abrir){ try{ _abrir(t.id); }catch(_e){} }
      try{toast('↩ Consulta reabierta: '+E(t.usuario)+' · seguí escribiéndole','green');}catch(_e){}
    }catch(e){
      // A network/auth failure is not proof that the conversation is obsolete.
      try{toast('No se pudo reabrir: '+(e.message||e)+'. La consulta se conserva.','yellow');}catch(_e){}
    }
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

  // ── Saneamiento y Limpieza preventiva de datos locales y memoria ────────────
  window.nodoLimpiarDatosAntiguosLocal = function(){
    try{
      let removidos = 0;
      const pc = _pcActualChat();
      const corte7Dias = Date.now() - (7 * 24 * 3600 * 1000);

      // 1. Limpiar nodo_chats_cerrados_v1
      const cerrados = _chatsCerradosAll();
      for(const k of Object.keys(cerrados)){
        const c = cerrados[k];
        const f = toDate(c?.fecha || c?._cachedAt || 0).getTime();
        if((f > 0 && f < corte7Dias) || (c?.pc_codigo && pc && String(c.pc_codigo).toUpperCase().trim() !== pc)){
          delete cerrados[k];
          removidos++;
        }
      }
      _chatsCerradosSave(cerrados);

      // 2. Limpiar marcas de aceptación antiguas (> 7 días)
      const accepted = getAccepted();
      for(const u of Object.keys(accepted)){
        const at = toDate(accepted[u]?.at || 0).getTime();
        if(at > 0 && at < corte7Dias){
          delete accepted[u];
          removidos++;
        }
      }
      localStorage.setItem(ACCEPT_KEY, JSON.stringify(accepted));

      // 3. Limpiar claves huérfanas nodo_chat_local_master_* y nodo_chat_local_*
      for(let i = localStorage.length - 1; i >= 0; i--){
        const key = localStorage.key(i);
        if(key && (key.startsWith('nodo_chat_local_master_') || key.startsWith('nodo_chat_local_'))){
          try{
            const val = JSON.parse(localStorage.getItem(key) || '[]');
            if(Array.isArray(val) && val.length > 0){
              const lastDate = toDate(val[val.length - 1]?.fecha || 0).getTime();
              // Never discard a reply merely because it is old: it may still be
              // pending persistence after a network failure.
              if(val.every(m=>m.persisted===true) && lastDate > 0 && lastDate < corte7Dias){
                localStorage.removeItem(key);
                removidos++;
              }
            } else {
              localStorage.removeItem(key);
              removidos++;
            }
          }catch(_e){ /* Preserve unreadable local evidence for diagnostics. */ }
        }
      }

      renderChatListStep2Final();
      if(removidos > 0){
        console.log(`[NODO Limpieza] Se purgaron ${removidos} datos obsoletos de sesiones/oficinas anteriores.`);
        try{ if(typeof toast === 'function') toast(`🧹 Se limpiaron ${removidos} datos obsoletos de sesiones anteriores`, 'blue'); }catch(_e){}
      }
      return { ok: true, removidos };
    }catch(err){
      console.warn('[NODO Limpieza] Error en saneamiento local:', err);
      return { ok: false, error: err.message };
    }
  };

  setTimeout(()=>{renderChatListStep2Final();},700);
  // Limpieza inicial preventiva a los 3 segundos
  setTimeout(()=>{ try{ window.nodoLimpiarDatosAntiguosLocal(); }catch(_e){} }, 3000);
  // Primer auto-close 90s después del inicio (cuando los tickets ya cargaron)
  setTimeout(()=>autoCloseTicketsViejos(true), 90000);
  // Luego cada 30 minutos
  setInterval(()=>autoCloseTicketsViejos(), 30*60*1000);

  setInterval(()=>{
    try{
      // Con el chat minimizado, la ventana abajo o todavía en el login no se repinta nada: el
      // contador de no leídos no depende de esto (chat-no-leidos.js lee los datos, no la lista).
      if(window.nodoSeVe&&!window.nodoSeVe(document.getElementById("chatList")||document.getElementById("v15ChatList")))return;
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
    const sMeta = (s.metadata && typeof s.metadata === 'object') ? s.metadata : ((s.METADATA && typeof s.METADATA === 'object') ? s.METADATA : {});
    const tieneImgDirecta = Boolean(s.COMPROBANTE_URL || s.comprobante_url || s.IMAGEN_URL || s.imagen_url || sMeta.comprobante_url || sMeta.imagen_url);

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
        window.NodoSalud?.begin('CHAT')?.record('DATA', resp?.ok ? 'OK' : 'ERROR', 'CHAT_PREVIEW_FETCH');
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
    const solMeta = (sol.metadata && typeof sol.metadata === 'object') ? sol.metadata : ((sol.METADATA && typeof sol.METADATA === 'object') ? sol.METADATA : {});
    let comprobanteUrl = sol.COMPROBANTE_URL || sol.comprobante_url || sol.IMAGEN_URL || sol.imagen_url || solMeta.comprobante_url || solMeta.imagen_url || null;
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
      ? 'rgba(239, 68, 68, 0.45)'
      : (semaforo === 'ambar'
          ? 'rgba(234, 179, 8, 0.35)'
          : (semaforo === 'azul' ? 'rgba(56, 189, 248, 0.35)' : 'rgba(34, 197, 94, 0.35)'));

    const colorMonto = semaforo === 'rojo'
      ? '#fca5a5'
      : (semaforo === 'verde' ? '#4ade80' : '#facc15');

    const colorEstado = semaforo === 'rojo'
      ? '#ef4444'
      : (semaforo === 'verde' ? '#22c55e' : (semaforo === 'azul' ? '#38bdf8' : '#eab308'));

    const iconTipo = tipo === 'RETIRO' ? '🏧' : '💳';
    const labelTipo = tipo === 'RETIRO' ? 'Retiro' : 'Carga';
    const labelDestino = tipo === 'RETIRO' ? 'Retiro a:' : 'Transferiste a:';

    let fechaFormatted = '';
    if(fechaSolStr){
      try{
        const d = new Date(fechaSolStr);
        if(!isNaN(d.getTime())){
          fechaFormatted = d.toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit'}) + ' ' + d.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
        }
      }catch(_e){}
    }
    if(!fechaFormatted) fechaFormatted = 'Reciente';

    let html = `
      <div class="nodo-sol-pill" style="border:1px solid ${colorBorder}">
        <div class="nodo-sol-tag-header">
          <span>${tipo === 'RETIRO' ? '⬇️ SOLICITUD RETIRO' : '💳 SOLICITUD CARGA'} #${esc(solId)}</span>
          <div style="display:flex;align-items:center;gap:6px" onclick="event.stopPropagation()">
            ${sol._isDemo ? `
              <div class="nodo-dev-sol-tester">
                <button class="mini-btn green" type="button" onclick="window.nodoDemoPreview('verde')" title="Verde: OK">🟢</button>
                <button class="mini-btn yellow" type="button" onclick="window.nodoDemoPreview('ambar')" title="Ámbar: Horario">🟡</button>
                <button class="mini-btn red" type="button" onclick="window.nodoDemoPreview('rojo')" title="Rojo: Duplicado">🔴</button>
                <button class="mini-btn gray" type="button" onclick="window.nodoDemoPreview('off')" title="Cerrar demo">✕</button>
              </div>
            ` : ''}
            <button class="nodo-sol-btn-toggle" type="button" onclick="window.nodoToggleSolBanner('${contenedorId}','${esc(usuarioActual)}')">
              ${desplegado ? '▲ Ocultar detalle' : '▼ Ver detalle'}
            </button>
          </div>
        </div>

        <div class="nodo-sol-hero" onclick="window.nodoToggleSolBanner('${contenedorId}','${esc(usuarioActual)}')">
          <div class="nodo-sol-hero-left">
            <div class="nodo-sol-hero-icon">${iconTipo}</div>
            <div>
              <div class="nodo-sol-hero-title">${labelTipo}</div>
              <div class="nodo-sol-hero-date">${fechaFormatted}</div>
            </div>
          </div>
          <div class="nodo-sol-hero-right">
            <div class="nodo-sol-hero-monto" style="color:${colorMonto}">${fmtMoney(monto)}</div>
            <div class="nodo-sol-hero-estado" style="color:${colorEstado}">${esc(resumenEstado)}</div>
          </div>
        </div>

        <div class="nodo-sol-meta-rows">
          ${billetera && billetera !== '—' ? `
            <div class="nodo-sol-meta-row">
              <span class="lbl">${labelDestino}</span>
              <span class="val">${esc(billetera)}</span>
            </div>
          ` : ''}
          ${titular && titular !== '—' ? `
            <div class="nodo-sol-meta-row">
              <span class="lbl">Titular:</span>
              <span class="val">${esc(titular)}</span>
            </div>
          ` : ''}
          ${cbu ? `
            <div class="nodo-sol-meta-row">
              <span class="lbl">CBU / Alias:</span>
              <span class="cbu">${esc(cbu)}</span>
            </div>
          ` : ''}
        </div>

        ${prev ? `
          <div class="nodo-sol-alerta-roja">
            ⛔ CUIDADO: Este usuario ya recibió una carga de ${fmtMoney(prev.monto)} hoy a las ${prev.hora} (Op #${prev.opId}).
          </div>
        ` : ''}

        ${desplegado && comprobanteUrl ? `
          <div class="nodo-sol-panel-body">
            <div class="nodo-sol-col-img">
              <a href="${esc(comprobanteUrl)}" onclick="if(window.nodoVerImagenCompleta){window.nodoVerImagenCompleta('${esc(comprobanteUrl)}');return false;}" target="_blank" title="Clic para abrir en tamaño completo">
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
          </div>
        ` : ''}

        <div class="nodo-sol-actions-bar">
          <div style="font-size:11px;color:#94a3b8">
            ${comprobanteUrl ? '📎 Comprobante adjunto' : 'Sin comprobante adjunto'}
          </div>
          <div style="display:flex;gap:8px">
            <button class="nodo-sol-btn-rechazar" type="button" onclick="window.nodoRechazarSolDesdeChat('${solId}')">
              ✕ Rechazar
            </button>
            <button class="nodo-sol-btn-aprobar" type="button" onclick="window.nodoAprobarSolDesdeChat('${solId}', ${monto}, '${esc(titular)}')" ${prev ? 'style="border-color:#ef4444;background:#b91c1c"' : ''}>
              ${prev ? '⚠ Forzar Aprobación' : `⚡ Aprobar (${fmtMoney(monto)})`}
            </button>
          </div>
        </div>
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
