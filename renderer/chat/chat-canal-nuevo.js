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
        legacy_thread:options.beforeId ? (cached?.legacy_thread || page.legacy_thread || []) : (page.legacy_thread || [])});
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
