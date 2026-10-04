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
    const deOperador = U(s.ultimo_de || '') === 'OPERADOR';
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
      thread: ultimo ? [{ origen: deOperador ? 'OPERADOR' : 'USUARIO', usuario: usuario, mensaje: ultimo, fecha: fechaUltimo }] : [],
      unread: Number(s.sin_leer) || 0,
      last: ultimo ? { origen: deOperador ? 'OPERADOR' : 'USUARIO', usuario: usuario, mensaje: ultimo, fecha: fechaUltimo } : null,
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
