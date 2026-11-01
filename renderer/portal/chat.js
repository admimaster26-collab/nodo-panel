/* Portal: chat. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalChat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","alert","chats","document","esc","getCanal","normArr","renderChatList","renderChatMensajes","rpc","setTimeout","v15RenderChatList","v15RenderChatMensajes","window"]);
  function create(deps){
const api = {};
  function mapChatSesion(c){
    const id = c.chat_id || c.id || c.ID || "";
    return {
      ID_CHAT: String(id),
      USUARIO: c.usuario || c.USUARIO || "Usuario",
      NOMBRE_COMPLETO: c.nombre || c.nombre_completo || "",
      TELEFONO: c.telefono || "",
      SOLICITUD_ID: c.solicitud_id || "",
      SIN_LEER: Number(c.sin_leer || 0),
      ULTIMO_MENSAJE: c.ultimo_mensaje || c.mensaje || "",
      FECHA_ULTIMO: c.updated_at || c.created_at || c.fecha_ultimo,
      FECHA: c.updated_at || c.created_at || c.fecha_ultimo,
      ESTADO: c.estado || "ABIERTO"
    };
  }

  async function cargarChatsPortal(silencioso=false){
    const canal = await deps.getCanal();
    let r;
    const beta = deps.window.NodoBetaChat;
    let betaActive=false,betaError=false;
    try{betaActive=beta && await beta.ready();}
    catch(e){betaError=true;r={data:null,error:{message:e.message}};}
    if(betaActive){
      try { r={data:await deps.window._chatCanalNuevo.cargar(),error:null}; }
      catch(e) { r={data:null,error:{message:e.message}}; }
    }else if(!betaError) r = await deps.rpc("panel_core_get_chat_sesiones_json", {p_pc_codigo: canal});
    if(!betaActive && !betaError && (r?.error || !deps.normArr(r?.data).length)){
      const fb = await deps.rpc("panel_v154_plus_listar_chat_sesiones", {p_pc_codigo: canal});
      if(!fb?.error) r = fb;
    }

    if(r?.error){
      console.warn('cargarChatsPortal error', r.error);
      if(!silencioso){
        const msg = r.error.message || JSON.stringify(r.error);
        const box1 = deps.document.getElementById("v15ChatList");
        const box2 = deps.document.getElementById("chatList");
        if(box1) box1.innerHTML = `<div class="v154p-chat-note">Error chat: ${deps.esc(msg)}</div>`;
        if(box2) box2.innerHTML = `<div class="alert-box">Error chat: ${deps.esc(msg)}</div>`;
      }
      return r;
    }

    const _nuevosChats = deps.normArr(r.data).map(mapChatSesion);
    // ANTI-PARPADEO (contador 0↔N): si la RPC devolvió VACÍO pero ya teníamos chats cargados, NO pisamos
    // con 0 — casi siempre es un timeout/vacío transitorio de la RPC (no "0 sin leer" real). Mantenemos
    // lo último bueno. Un 0 legítimo (todo leído) igual pasa: ahí la RPC devuelve las sesiones con SIN_LEER=0
    // (array NO vacío), así que este guard no se activa.
    if(betaActive || !(_nuevosChats.length === 0 && Array.isArray(deps.V154P.chats) && deps.V154P.chats.length > 0)){
      deps.V154P.chats = _nuevosChats;
      deps.window.chats = deps.V154P.chats.slice();
      try{ deps.chats = deps.V154P.chats.slice(); }catch(_e){}
    }

    if(typeof deps.v15RenderChatList === "function") deps.v15RenderChatList();
    else if(typeof deps.renderChatList === "function") deps.renderChatList();

    // Auto-refrescar conversación abierta si hay un ticket activo
    try{
      if(deps.window.__nodoChatCurrentTicket && typeof deps.window.renderChatMensajes === "function"){
        deps.window.renderChatMensajes();
      }
    }catch(_e){}

    try{
      const count = deps.V154P.chats.filter(c => String(c.ESTADO || "").toUpperCase() !== "CERRADO").length;
      const badge = deps.document.getElementById("v15ChatCount");
      if(badge) badge.textContent = String(count);
      deps.window.nodoChatRefreshUnread?.();
    }catch(e){}

    return r;
  }

  async function cargarChatPortalActual(silencioso=false){
    const chatId = deps.window.chatActualId || deps.window.v15ChatActualId || deps.V154P.chatActual;
    if(!chatId) return;

    deps.V154P.chatActual = String(chatId);
    let r;
    const beta = deps.window.NodoBetaChat;
    let betaActive=false,betaError=false;
    try{betaActive=beta && await beta.ready();}
    catch(e){betaError=true;r={data:null,error:{message:e.message}};}
    if(betaActive){
      const current=deps.window.__nodoChatCurrentTicket;
      // A stale five-second timer must not fetch or mark a previous conversation.
      if(!current?._beta || String(current._chatId)!==String(chatId)) return;
      try { r={data:await deps.window._chatCanalNuevo.mensajesDe(String(chatId)),error:null}; }
      catch(e) { r={data:null,error:{message:e.message}}; }
      if(String(deps.window.__nodoChatCurrentTicket?._chatId)!==String(chatId)) return;
    }else if(!betaError) r = await deps.rpc("panel_core_get_chat_mensajes_json", {p_chat_id: String(chatId)});
    if(!betaActive && !betaError && (r?.error || !deps.normArr(r.data).length)){
      const fb = await deps.rpc("panel_v154_plus_get_chat_mensajes", {p_chat_id: String(chatId)});
      if(!fb?.error) r = fb;
    }

    if(r?.error){
      if(betaActive || betaError) return r; // Keep the last confirmed page; the beta status exposes the error.
      const msg = r.error.message || JSON.stringify(r.error);
      const b1 = deps.document.getElementById("chatBody");
      const b2 = deps.document.getElementById("v15ChatBody");
      if(b1) b1.innerHTML = `<div class="alert-box">Error mensajes: ${deps.esc(msg)}</div>`;
      if(b2) b2.innerHTML = `<div class="v154p-chat-note">Error mensajes: ${deps.esc(msg)}</div>`;
      return r;
    }

    deps.V154P.chatMensajes = deps.normArr(r.data).map(m => ({
      ...m,
      MENSAJE: m.mensaje || "",
      IMAGEN_URL: m.imagen_url || "",
      TIPO_EMISOR: m.tipo_emisor || m.emisor_tipo || "",
      EMISOR: m.emisor || "",
      FECHA: m.created_at
    }));
    deps.window.chatMensajes = deps.V154P.chatMensajes.slice();

    if(typeof deps.renderChatMensajes === "function") deps.renderChatMensajes();
    if(typeof deps.v15RenderChatMensajes === "function") deps.v15RenderChatMensajes();

    return r;
  }

  async function enviarChatPortal(){
    const chatId = deps.window.chatActualId || deps.window.v15ChatActualId || deps.V154P.chatActual;
    if(!chatId){
      deps.alert("Seleccioná un chat primero.");
      return;
    }

    let input = deps.document.getElementById("chatInput");
    let msg = input ? input.value.trim() : "";
    if(!msg){
      input = deps.document.getElementById("v15ChatInput");
      msg = input ? input.value.trim() : "";
    }
    if(!msg) return;

    let r = await deps.rpc("panel_core_enviar_chat_json", {
      p_chat_id: String(chatId),
      p_mensaje: msg,
      p_emisor: (deps.window.operador?.usuario || deps.window.operador?.nombre || "panel")
    });
    if(r?.error || r?.data?.ok === false){
      const fb = await deps.rpc("panel_v154_plus_enviar_chat", {
        p_chat_id: String(chatId),
        p_mensaje: msg,
        p_emisor: (deps.window.operador?.usuario || deps.window.operador?.nombre || "panel")
      });
      if(!fb?.error && fb?.data?.ok !== false) r = fb;
    }

    if(r?.error || r?.data?.ok === false){
      deps.alert("Error enviando chat: " + (r?.error?.message || r?.data?.error || JSON.stringify(r)));
      return r;
    }

    if(input) input.value = "";
    await cargarChatPortalActual(false);
    deps.setTimeout(()=>cargarChatPortalActual(true), 800);
    return r;
  }

    return { globals: api, mapChatSesion, cargarChatsPortal, cargarChatPortalActual, enviarChatPortal };
  }
  return Object.freeze({ create, dependencies });
});
