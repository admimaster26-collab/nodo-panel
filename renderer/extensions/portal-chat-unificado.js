
// ============================================================
// SAFE PATCH · Portal + Chat unificado
// - Billetera EN PORTAL: usa RPC nodo_seleccionar_billetera_portal.
// - Chat: usa chat_sesiones + chat_mensajes vía RPC panel_core_*.
// No toca motor de carga/retiro/worker.
// ============================================================
(function(){
  function _n(v){ return String(v||'').trim().toUpperCase(); }
  function _rows(data){
    try{ if(typeof data === 'string') data = JSON.parse(data); }catch(_e){}
    if(Array.isArray(data)) return data;
    if(data && Array.isArray(data.rows)) return data.rows;
    if(data && data.data && Array.isArray(data.data.rows)) return data.data.rows;
    return [];
  }
  function _chatScope(){ try{return pcOperativa || 'P1';}catch(_e){return 'P1';} }
  function _opName(){
    try{ return (window.operador && (operador.usuario || operador.nombre)) || 'panel'; }catch(_e){ return 'panel'; }
  }

  // Selección de billetera para portal: nunca más update directo desde el front.
  window.seleccionarBilletera = seleccionarBilletera = async function(ref){
    try{
      const billeteraRef = String(ref || '').trim();
      if(!billeteraRef){ alert('No se pudo identificar la billetera.'); return; }

      const r = await supabaseClient.rpc('nodo_seleccionar_billetera_portal', {
        p_billetera_ref: billeteraRef,
        p_codigo_origen: _chatScope()
      });

      if(r.error){
        const msg = r.error.message || '';
        if(msg.includes('nodo_seleccionar_billetera_portal') || msg.includes('schema cache')){
          alert('Falta ejecutar/recargar la RPC nodo_seleccionar_billetera_portal en Supabase. Ejecutá el SQL incluido en este patch y reabrí NODO.');
          return;
        }
        alert(msg || 'Error seleccionando billetera para portal');
        return;
      }

      let data = r.data;
      try{ if(typeof data === 'string') data = JSON.parse(data); }catch(_e){}
      if(data && data.ok === false){
        alert(data.error || data.mensaje || 'No se pudo marcar la billetera para portal.');
        return;
      }

      toast('Billetera marcada para portal', 'green');
      await new Promise(r=>setTimeout(r,650));
      await cargarBilleteras(false);
      try{ renderBilleteras(); }catch(_e){}
      try{ renderBillerasInicio(); }catch(_e){}
      try{ poblarManualBilletera(); }catch(_e){}
      try{ renderEstadoLanding(); }catch(_e){}
      try{ renderInicio(); }catch(_e){}
    }catch(e){
      alert(e.message || 'Error seleccionando billetera para portal');
    }
  };

  function _mapChat(c){
    const id = c.chat_id || c.id || c.ID || '';
    return {
      ID_CHAT: String(id),
      USUARIO: c.usuario || c.USUARIO || 'Usuario',
      NOMBRE_COMPLETO: c.nombre_completo || c.NOMBRE_COMPLETO || '',
      TELEFONO: c.telefono || c.TELEFONO || '',
      SOLICITUD_ID: c.solicitud_id || c.SOLICITUD_ID || '',
      SIN_LEER: Number(c.sin_leer || c.SIN_LEER || 0),
      ULTIMO_MENSAJE: c.ultimo_mensaje || c.mensaje || c.ULTIMO_MENSAJE || '',
      FECHA_ULTIMO: c.fecha_ultimo || c.updated_at || c.created_at || c.FECHA_ULTIMO || '',
      FECHA: c.fecha_ultimo || c.updated_at || c.created_at || c.FECHA || '',
      ESTADO: c.estado || c.ESTADO || 'ABIERTO',
      SOL_TIPO: c.sol_tipo || '',
      SOL_MONTO: c.sol_monto || '',
      SOL_ESTADO: c.sol_estado || ''
    };
  }

  window.cargarChats = cargarChats = async function(silencioso=false){
    // Delegar a cargarChatsPortal que usa el IPC bridge y tiene fallback correcto
    if(typeof cargarChatsPortal === 'function') return cargarChatsPortal(silencioso);
    const r = await supabaseClient.rpc('panel_core_get_chat_sesiones_json', {
      p_pc_codigo: _chatScope()
    });

    if(r.error){
      console.warn('chat sesiones error', r.error);
      if(!silencioso) setBox('chatList','<div class="alert-box" style="margin:12px">Error cargando chat: '+escapeHtml(r.error.message||'')+'</div>');
      return;
    }

    chats = _rows(r.data).map(_mapChat);
    try{ window.chats = chats; }catch(_e){}

    renderChatList();
    try{ renderInicio(); }catch(_e){}
    try{ verificarChats(silencioso); }catch(_e){}
  };

  window.abrirChat = abrirChat = async function(id){
    chatActualId = String(id || '');
    try{ window.chatActualId = chatActualId; }catch(_e){}
    abrirChatExpandido();
    renderChatList();
    if(enElectron) document.getElementById('chatAccionesRapidas')?.classList.remove('hidden');
    await cargarChatActual(false);
  };

  window.cargarChatActual = cargarChatActual = async function(silencioso=false){
    if(!chatActualId) return;

    const r = await supabaseClient.rpc('panel_core_get_chat_mensajes_json', {
      p_chat_id: Number(chatActualId),
      p_pc_codigo: _chatScope()
    });

    if(r.error){
      console.warn('chat mensajes error', r.error);
      setBox('chatBody','<div class="alert-box">Error cargando mensajes: '+escapeHtml(r.error.message||'')+'</div>');
      return;
    }

    chatMensajes = _rows(r.data).map(function(m){
      return {
        ...m,
        MENSAJE: m.mensaje || '',
        IMAGEN_URL: m.imagen_url || '',
        TIPO_EMISOR: m.tipo_emisor || '',
        EMISOR: m.emisor || '',
        FECHA: m.created_at || ''
      };
    });
    try{ window.chatMensajes = chatMensajes; }catch(_e){}

    renderChatMensajes();
    await cargarChats(true);
  };

  window.enviarChat = enviarChat = async function(){
    if(!chatActualId){ alert('Seleccioná un chat primero.'); return; }
    const input = document.getElementById('chatInput');
    const mensaje = (input?.value || '').trim();
    if(!mensaje && !window.chatImagenBase64) return;

    const r = await supabaseClient.rpc('panel_core_enviar_chat_json', {
      p_chat_id: String(chatActualId),
      p_mensaje: mensaje || '',
      p_emisor: _opName()
    });

    if(r.error){ alert(r.error.message || 'Error al enviar mensaje'); return; }
    let data = r.data;
    try{ if(typeof data === 'string') data = JSON.parse(data); }catch(_e){}
    if(data && data.ok === false){ alert(data.error || 'Error al enviar mensaje'); return; }

    if(input) input.value = '';
    try{ chatImagenBase64 = ''; quitarImagenChat(); }catch(_e){}
    await cargarChatActual(false);
  };

  // Compatibilidad con chat compacto si existe.
  window.v15CargarChatsCompacto = window.cargarChats;
  window.v15EnviarChatCompacto = window.enviarChat;
  window.v15AbrirChatCompacto = async function(id){
    window.chatActualId = String(id||'');
    try{ window.v15ChatActualId = String(id||''); }catch(_e){}
    await window.abrirChat(id);
  };

  // Recarga inicial segura.
  setTimeout(function(){ try{ cargarChats(true); }catch(_e){} }, 1200);
})();



// ============================================================
// SAFE PATCH FINAL · usar solo RPCs EXISTENTES / REST mínimo
// - Billetera portal: NO usa RPC nueva. Update mínimo por id/pc_codigo.
// - Chat: NO usa panel_core_*. Usa solo panel_nodo_list_* existentes.
// ============================================================
(function(){
  const SCOPE_PC  = () => String(window.pcOperativa || 'XGENERALENUSO').trim().toUpperCase();
  const COMPAT_PC = () => String(window.pcOperativa || 'P1').trim().toUpperCase();

  function _safeEsc(v){
    try{ if(typeof escapeHtml === 'function') return escapeHtml(v); }catch(_e){}
    return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }
  function _rows(data){
    try{ if(typeof data === 'string') data = JSON.parse(data); }catch(_e){}
    if(Array.isArray(data)) return data;
    if(data && Array.isArray(data.rows)) return data.rows;
    if(data && data.data && Array.isArray(data.data.rows)) return data.data.rows;
    if(data && data.data && Array.isArray(data.data)) return data.data;
    return [];
  }
  function _opName(){
    try{ return (window.operador && (operador.usuario || operador.nombre)) || 'panel'; }catch(_e){ return 'panel'; }
  }
  function _normChat(c){
    const id = c.chat_id || c.id || c.ID_CHAT || c.ID || '';
    return {
      ID_CHAT: String(id),
      USUARIO: c.usuario || c.USUARIO || 'Usuario',
      NOMBRE_COMPLETO: c.nombre_completo || c.nombre || c.NOMBRE_COMPLETO || '',
      TELEFONO: c.telefono || c.TELEFONO || '',
      SOLICITUD_ID: c.solicitud_id || c.SOLICITUD_ID || c.solicitud || '',
      SIN_LEER: Number(c.sin_leer || c.SIN_LEER || c.no_leidos || 0),
      ULTIMO_MENSAJE: c.ultimo_mensaje || c.mensaje || c.ULTIMO_MENSAJE || 'Sin mensajes todavía',
      FECHA_ULTIMO: c.fecha_ultimo || c.ultimo_mensaje_at || c.updated_at || c.created_at || c.FECHA_ULTIMO || '',
      FECHA: c.fecha_ultimo || c.ultimo_mensaje_at || c.updated_at || c.created_at || c.FECHA || '',
      ESTADO: c.estado || c.ESTADO || 'ABIERTO'
    };
  }

  async function _resolveBilleteraRealId(ref){
    const raw = String(ref || '').trim();
    if(!raw) throw new Error('No se pudo identificar la billetera.');

    const local = (window.billeteras || billeteras || []).find(x =>
      String(x.ID_BILLETERA || x.id || '') === raw ||
      String(x.CHUNIOR_UID || x.chunior_uid || '') === raw.replace(/^CH_/i,'')
    );

    // Si ya es id real numérico y además existe como ID_BILLETERA local real, usarlo.
    if(/^\d+$/.test(raw) && local && String(local.ID_BILLETERA || local.id || '') === raw && !String(raw).startsWith('CH_')){
      // Ojo: puede ser UID numérico también. Confirmamos que exista como id.
      const q = await supabaseClient.from('billeteras').select('id').eq('id', Number(raw)).limit(1);
      if(!q.error && q.data && q.data.length) return Number(raw);
    }

    let uid = '';
    if(/^CH_/i.test(raw)) uid = raw.replace(/^CH_/i,'');
    if(!uid && local && (local.CHUNIOR_UID || local.chunior_uid)) uid = String(local.CHUNIOR_UID || local.chunior_uid);
    if(!uid && /^\d+$/.test(raw)) uid = raw;

    if(uid){
      const r = await supabaseClient
        .from('billeteras')
        .select('id,chunior_uid,activa,seleccionada_manual')
        .eq('chunior_uid', uid)
        .eq('activa', true)
        .order('seleccionada_manual',{ascending:false})
        .limit(1);
      if(r.error) throw new Error(r.error.message || 'Error buscando billetera por UID.');
      if(r.data && r.data.length) return Number(r.data[0].id);
    }

    // Último intento: si era numérico, usarlo como id.
    if(/^\d+$/.test(raw)) return Number(raw);
    throw new Error('No encontré la billetera real en NODO. Sincronizá y probá nuevamente.');
  }

  window.seleccionarBilletera = seleccionarBilletera = async function(ref){
    try{
      const realId = await _resolveBilleteraRealId(ref);

      // Escritura BLINDADA: la RLS no deja UPDATE directo a billeteras (filtraba a 0 filas sin error).
      // Va por RPC SECURITY DEFINER que limpia la selección de la oficina y marca la elegida.
      const r = await supabaseClient.rpc('nodo_seleccionar_billetera_portal',{
        p_secret: window.PANEL_DATA_SECRET,
        p_id: Number(realId),
        p_pc_codigo: (pcOperativa || window.pcOperativa || (typeof COMPAT_PC==='function'?COMPAT_PC():'') || '')
      });
      if(r.error) throw new Error(r.error.message || 'No se pudo marcar la billetera para portal.');
      const d = (r && r.data) || {};
      if(d.ok===false) throw new Error(d.mensaje || 'No se pudo marcar la billetera para portal.');

      try{ toast('Billetera marcada para portal', 'green'); }catch(_e){}
      try{ await cargarBilleteras(false); }catch(_e){}
      try{ renderBilleteras(); }catch(_e){}
      try{ renderBillerasInicio(); }catch(_e){}
      try{ poblarManualBilletera(); }catch(_e){}
      try{ renderEstadoLanding(); }catch(_e){}
      try{ renderInicio(); }catch(_e){}
    }catch(e){
      alert(e.message || 'Error seleccionando billetera para portal');
    }
  };

  window.abrirChat = abrirChat = async function(id){
    window.chatActualId = String(id || '');
    try{ chatActualId = window.chatActualId; }catch(_e){}
    try{ window.v15ChatActualId = window.chatActualId; }catch(_e){}
    try{ if(typeof abrirChatExpandido === 'function') abrirChatExpandido(); }catch(_e){}
    try{ renderChatList(); }catch(_e){}
    await cargarChatActual(false);
  };

  window.cargarChatActual = cargarChatActual = async function(silencioso=false){
    const chatId = String(window.chatActualId || chatActualId || window.v15ChatActualId || '').trim();
    if(!chatId) return;

    const r = await supabaseClient.rpc('panel_core_get_chat_mensajes_json', {
      p_chat_id: Number(chatId),
      p_pc_codigo: (typeof _chatScope === 'function' ? _chatScope() : (window._chatScope ? window._chatScope() : 'P1'))
    });

    if(r.error){
      console.warn('panel_core_get_chat_mensajes_json error', r.error);
      if(!silencioso){
        const body = document.getElementById('chatBody') || document.getElementById('v15ChatBody');
        if(body) body.innerHTML = '<div class="alert-box">No se pudieron cargar los mensajes.</div>';
      }
      return;
    }

    let _nuevos = _rows(r.data).map(function(m){
      return {
        ...m,
        ID: m.id || m.ID || '',
        MENSAJE: m.mensaje || m.MENSAJE || '',
        IMAGEN_URL: m.imagen_url || m.IMAGEN_URL || '',
        TIPO_EMISOR: m.tipo_emisor || m.TIPO_EMISOR || '',
        EMISOR: m.emisor || m.EMISOR || '',
        FECHA: m.created_at || m.FECHA || ''
      };
    });
    // Dedup por contenido+fecha: el mismo mensaje puede venir de 2 fuentes con IDs distintos → no duplicar.
    (function(){ const seen=new Map(), out=[]; for(const m of _nuevos){ const k=NodoChatMessage.key(m); if(seen.has(k)){ const i=seen.get(k); out[i]=NodoChatMessage.merge(out[i],m); continue; } seen.set(k,out.length); out.push(m); } _nuevos=out; })();
    // No borrar el chat si el fetch vino vacío pero ya teníamos mensajes del MISMO chat (evita "vacío" transitorio).
    if(_nuevos.length===0 && window._chatMsgsForId===chatId && Array.isArray(window.chatMensajes) && window.chatMensajes.length>0){
      try{ renderChatMensajes(); }catch(_e){}
      return;
    }
    window.chatMensajes = _nuevos;
    window._chatMsgsForId = chatId;
    try{ chatMensajes = window.chatMensajes.slice(); }catch(_e){}
    try{ V154P.chatMensajes = window.chatMensajes.slice(); }catch(_e){}

    try{ renderChatMensajes(); }catch(e){ console.warn('renderChatMensajes', e); }
    try{ if(typeof v15RenderChatMensajes === 'function') v15RenderChatMensajes(); }catch(_e){}
    try{ await cargarChats(true); }catch(_e){}
  };

  window.enviarChat = enviarChat = async function(){
    const chatId = String(window.chatActualId || chatActualId || window.v15ChatActualId || '').trim();
    if(!chatId){ alert('Seleccioná un chat primero.'); return; }
    let input = document.getElementById('chatInput') || document.getElementById('v15ChatInput');
    const mensaje = (input?.value || '').trim();
    const imagen = window.chatImagenBase64 || '';
    if(!mensaje && !imagen) return;

    const r = await supabaseClient.rpc('panel_core_enviar_chat_json', {
      p_chat_id: chatId,
      p_mensaje: mensaje || '',
      p_emisor: _opName()
    });

    if(r.error){ alert(r.error.message || 'Error al enviar mensaje'); return; }
    let data = r.data;
    try{ if(typeof data === 'string') data = JSON.parse(data); }catch(_e){}
    if(data && data.ok === false){ alert(data.error || data.mensaje || 'Error al enviar mensaje'); return; }

    if(input) input.value = '';
    try{ chatImagenBase64 = ''; window.chatImagenBase64 = ''; quitarImagenChat(); }catch(_e){}
    await cargarChatActual(false);
  };

  window.v15CargarChatsCompacto = window.cargarChats;
  window.v15EnviarChatCompacto = window.enviarChat;
  window.v15AbrirChatCompacto = async function(id){ await window.abrirChat(id); };

  setTimeout(function(){ try{ cargarChats(true); }catch(_e){} }, 1000);
})();

