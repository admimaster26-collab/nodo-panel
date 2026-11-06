
/* ============================================================
   NODO · CHAT WHATICKET STEP 2 LOCAL SAFE
   - Sin chat_sesiones
   - Sin RPCs nuevas
   - Sin tocar historial/billeteras/motor
   - Aceptar abre conversación local en panel
   - Corta parpadeo de render viejo
   ============================================================ */
(function(){
  function S(v){ return String(v ?? ""); }
  function U(v){ return S(v).trim().toUpperCase(); }
  function E(v){
    try{ return escapeHtml(S(v)); }catch(_e){
      return S(v).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  }
  // Misma corrección que en chat-hilos.js: sin la fecha, un mensaje de ayer se lee como si fuera
  // de recién. Las dos listas dibujan lo mismo y las dos lo escondían (D-71, D-74).
  function hora(v){
    try{
      if(!v) return "";
      const d = new Date(v);
      if(isNaN(d.getTime())) return "";
      const hh = d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"});
      const hoy = new Date();
      const mismoDia = (a,b) => a.getDate()===b.getDate() && a.getMonth()===b.getMonth() && a.getFullYear()===b.getFullYear();
      if(mismoDia(d,hoy)) return hh;
      if(mismoDia(d,new Date(hoy.getTime()-86400000))) return "ayer "+hh;
      return d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"})+" "+hh;
    }catch(_e){ return ""; }
  }
  function avatarColor(u){
    const s=S(u||"U"); let n=0;
    for(let i=0;i<s.length;i++) n=(n+s.charCodeAt(i))%360;
    return `hsl(${n} 68% 45%)`;
  }
  function iniciales(u){
    const p=S(u||"Usuario").trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0]||"U")+(p[1]?.[0]||"")).toUpperCase();
  }
  let wq2ActiveTab = 'espera'; // 'espera' | 'abiertos' | 'interno'
  window.wq2SetTab = function(tab){ wq2ActiveTab = tab; renderChatListStep2(); };

  // Clave por solicitudId para aislar conversaciones entre sesiones
  function storageKey(id){ return "nodo_chat_local_" + String(id||"x").replace(/[^A-Z0-9]/gi,"_"); }
  function getSavedMsgs(id){ try{ return JSON.parse(localStorage.getItem(storageKey(id)) || "[]"); }catch(_e){ return []; } }
  function setSavedMsgs(id, msgs){ try{ localStorage.setItem(storageKey(id), JSON.stringify(msgs||[])); }catch(_e){} }

  function installCss(){
    if(document.getElementById("nodoStep2Css")) return;
    const st=document.createElement("style");
    st.id="nodoStep2Css";
    st.textContent = `

      body.nodo-chat-open #viewChat .chat-layout{grid-template-columns:280px minmax(0,1fr)!important}
      body:not(.nodo-chat-open) #viewChat .chat-layout{grid-template-columns:1fr!important}
      body:not(.nodo-chat-open) #viewChat .chat-panel{display:none!important}
      #viewChat .chat-layout{gap:0!important;background:#0b0f17!important;border:1px solid #252b38!important;border-radius:16px!important;overflow:hidden!important;flex:1!important;min-height:0!important}
      #viewChat .chat-list,#viewChat .chat-panel{background:#0b0f17!important;border:0!important;border-radius:0!important;min-height:0!important}
      #viewChat .chat-list-head,#viewChat .chat-head{background:#111827!important;border-bottom:1px solid #252b38!important;flex-shrink:0!important}
      #viewChat .chat-panel{display:flex!important;flex-direction:column!important;min-height:0!important}
      #chatList{background:#0f1722!important;color:#e5e7eb!important;min-height:0!important;flex:1!important;overflow-y:auto!important}
      #chatBody{background:#0b0f17!important;color:#e5e7eb!important;min-height:0!important;flex:1!important;overflow-y:auto!important}
      #viewChat .chat-compose{flex-shrink:0!important}

      .wq2-wrap{height:100%;background:#0f1722;color:#e5e7eb;overflow:auto}
      .wq2-search{padding:12px;border-bottom:1px solid #263244;background:#0f1722}
      .wq2-search input{width:100%;border:1px solid #334155;border-radius:18px;padding:10px 14px;font-size:13px;background:#111827;color:#e5e7eb;outline:none}
      .wq2-tabs{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #263244;background:#0f1722;align-items:center}
      .wq2-tab{border:0;border-radius:16px;padding:7px 12px;font-size:12px;font-weight:900;background:#1f2937;color:#cbd5e1}
      .wq2-tab.active{background:#1d4ed8;color:white}
      .wq2-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;border-radius:999px;background:#16a34a;color:#fff;font-size:11px;margin-left:6px}
      .wq2-item{display:grid;grid-template-columns:44px minmax(0,1fr) 92px;gap:10px;padding:12px;border-bottom:1px solid #1f2937;background:#0f1722;align-items:center}
      .wq2-item:hover,.wq2-item.active{background:#172033}
      .wq2-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px}
      .wq2-name{font-weight:900;font-size:15px;color:#f8fafc;line-height:1.1}
      .wq2-msg{font-size:13px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
      .wq2-state{display:inline-block;margin-top:6px;border-radius:10px;padding:4px 8px;font-size:10px;font-weight:900;background:#0c4a6e;color:#bae6fd}
      .wq2-meta{font-size:11px;color:#94a3b8;text-align:right}
      .wq2-accept{background:#3157ff;color:white;border:0;border-radius:10px;padding:9px 10px;font-size:12px;font-weight:900;cursor:pointer}
      .wq2-empty{margin:18px;border:1px dashed #334155;border-radius:14px;padding:22px;text-align:center;color:#94a3b8;background:#111827}
      .wq2-chat-bg{min-height:100%;padding:14px;background:#0b0f17;color:#e5e7eb}
      .wq2-row{display:flex;margin:7px 0}
      .wq2-row.op{justify-content:flex-end}
      .wq2-bubble{max-width:76%;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.35;box-shadow:0 1px 1px #0006;word-break:break-word}
      .wq2-bubble:has(.wq2-img){max-width:92%}
      .wq2-row.user .wq2-bubble{background:#1f2937;color:#e5e7eb}
      .wq2-row.op .wq2-bubble{background:#14532d;color:#dcfce7}
      .wq2-time{font-size:10px;color:#9ca3af;margin-top:4px;text-align:right}
      .wq2-note{margin:12px;border:1px solid #334155;border-radius:14px;padding:12px;background:#111827;color:#94a3b8;font-size:12px;line-height:1.45}
    `;
    document.head.appendChild(st);
  }

  function soporteAbierto(s){
    const tipo=U(s.TIPO||s.TIPO_SOLICITUD||s.tipo);
    const estado=U(s.ESTADO||s.estado);
    return tipo==="SOPORTE" && !["CERRADO","CANCELADO","RECHAZADA","RESUELTA","CHAT_ABIERTO","ATENDIDO","RESPONDIDO","RESPONDIDO_PANEL"].includes(estado);
  }

  function solicitudesSoporte(){
    const arr=(window.V154P && Array.isArray(V154P.solicitudes)) ? V154P.solicitudes : (Array.isArray(window.solicitudes)?window.solicitudes:[]);
    return arr.filter(soporteAbierto);
  }

  function ticketsAgrupados(){
    const map = new Map();
    // El alta de usuario NUEVO (portal → "Sos nuevo") manda el teléfono DENTRO de metadata
    // (landing_portal_v16_crear_solicitud no tiene columna TELEFONO propia para SOPORTE) —
    // por eso hacía falta este fallback, si no el modal de vincular quedaba con el tel vacío.
    const _telSol=function(s){ const m=s?.METADATA??s?.metadata??{}; return S(s.TELEFONO||s.telefono||m.telefono||m.TELEFONO||""); };
    solicitudesSoporte().forEach(s=>{
      const usuario=S(s.USUARIO||s.USUARIO_JUGADOR||s.usuario||"Usuario").trim() || "Usuario";
      const key=U(usuario);
      if(!map.has(key)){
        map.set(key,{id:"TICKET_"+key.replace(/[^A-Z0-9]/g,"_"), usuario, telefono:_telSol(s), items:[], unread:0, fecha:"", mensaje:"", solicitudId:""});
      }
      const g=map.get(key);
      g.items.push(s);
      g.unread += 1;
      const f=s.FECHA_CREACION||s.FECHA||s.created_at||s.updated_at||"";
      if(!g.fecha || new Date(f).getTime() > new Date(g.fecha||0).getTime()) g.fecha=f;
      g.mensaje=s.MENSAJE_INICIAL||s.mensaje_inicial||s.DESTINO||s.destino||"Consulta desde portal";
      g.solicitudId=S(s.ID||s.SOLICITUD_ID||s.id||"");
      if(!g.telefono) g.telefono=_telSol(s);
    });
    return Array.from(map.values()).sort((a,b)=>new Date(b.fecha||0)-new Date(a.fecha||0));
  }

  function ticketToMessages(ticket){
    const msgs=[];
    (ticket.items||[]).slice().sort((a,b)=>new Date(a.FECHA_CREACION||a.FECHA||a.created_at||0)-new Date(b.FECHA_CREACION||b.FECHA||b.created_at||0)).forEach(s=>{
      msgs.push({
        tipo:"USUARIO",
        mensaje:s.MENSAJE_INICIAL||s.mensaje_inicial||s.DESTINO||s.destino||"Consulta desde portal",
        fecha:s.FECHA_CREACION||s.FECHA||s.created_at||s.updated_at||new Date().toISOString(),
        solicitudId:S(s.ID||s.SOLICITUD_ID||s.id||"")
      });
    });
    return msgs.concat(getSavedMsgs(ticket.solicitudId || ticket.usuario));
  }

  function isAcceptedExt(usuario){ return !!(window._wq2IsAccepted && window._wq2IsAccepted(usuario)); }

  function renderChatListStep2(){
    installCss();
    const box=document.getElementById("chatList") || document.getElementById("v15ChatList");
    if(!box) return;
    const todos=ticketsAgrupados();
    const q=(document.getElementById("wq2Search")?.value||"").toLowerCase().trim();
    const current=window.__nodoChatCurrentUser || "";

    // Separar por estado de aceptación
    const espera=todos.filter(t=>!isAcceptedExt(t.usuario));
    const abiertos=todos.filter(t=>isAcceptedExt(t.usuario));
    const tab=wq2ActiveTab;

    let pool = tab==='abiertos' ? abiertos : espera;
    if(q) pool=pool.filter(t=>(t.usuario+" "+t.telefono+" "+t.mensaje).toLowerCase().includes(q));

    // Actualizar badge del chat con total en espera
    try{
      window.nodoChatRefreshUnread?.();
    }catch(_e){}

    const tabBtn=(id,label,count,active)=>
      `<button class="wq2-tab${active?" active":""}" onclick="wq2SetTab('${id}')">${label}${count?` <span class="wq2-count">${count}</span>`:""}</button>`;

    let html=`<div class="wq2-wrap">
      <div class="wq2-search"><input id="wq2Search" placeholder="Nombre, número o usuario..." oninput="renderChatListStep2()" value="${E(q)}"></div>
      <div class="wq2-tabs">
        ${tabBtn('espera','En espera',espera.length,tab==='espera')}
        ${tabBtn('abiertos','Abiertos',abiertos.length,tab==='abiertos')}
        ${tabBtn('interno','Interno',0,tab==='interno')}
      </div>`;

    if(!pool.length){
      html += `<div class="wq2-empty">${tab==='interno'?'Sin mensajes internos.':tab==='abiertos'?'No hay chats abiertos.':'No hay consultas en espera.'}</div>`;
    }else{
      pool.forEach(t=>{
        const active=U(current)===U(t.usuario);
        const accepted=isAcceptedExt(t.usuario);
        const stateLabel=accepted?'ABIERTO':'EN ESPERA';
        const stateColor=accepted?'background:#14532d;color:#dcfce7':'';
        const btnLabel=accepted?'Abrir':'Aceptar';
        const btnColor=accepted?'background:#16a34a':'';
        html += `<div class="wq2-item ${active?"active":""}">
          <div class="wq2-avatar" style="background:${avatarColor(t.usuario)}">${iniciales(t.usuario)}</div>
          <div style="min-width:0">
            <div class="wq2-name">${E(t.usuario)}</div>
            <div class="wq2-msg">${E(t.mensaje)}</div>
            <div class="wq2-state" style="${stateColor}">${stateLabel}${t.items&&t.items.length>1?" · "+t.items.length+" msj":""}${t.solicitudId?" · Sol. "+E(t.solicitudId):""}</div>
          </div>
          <div>
            <div class="wq2-meta">${hora(t.fecha)}</div>
            <button class="wq2-accept" style="${btnColor}" onclick="aceptarTicketLocalStep2('${E(t.id)}')">${btnLabel}</button>
          </div>
        </div>`;
      });
    }
    html += `</div>`;
    box.innerHTML=html;
    window.nodoChatRefreshUnread?.();
  }

  window.aceptarTicketLocalStep2=function(ticketId){
    const ticket=ticketsAgrupados().find(t=>t.id===ticketId);
    if(!ticket){ alert("No encontré la consulta. Actualizá chats."); return; }
    window.__nodoChatCurrentUser=ticket.usuario;
    window.__nodoChatCurrentTicket=ticket;
    document.body.classList.add("nodo-chat-open");
    // Limpiar mensajes Supabase previos para que no mezcle conversaciones
    if(window.V154P) window.V154P.chatMensajes=[];
    window.chatMensajes=[];
    // Conectar con Supabase: buscar chatId de la solicitud para cargar mensajes reales
    try{
      const sol=(window.V154P&&window.V154P.solicitudes||[]).find(s=>String(s.SOLICITUD_ID||s.ID)===String(ticket.solicitudId));
      const chatId=sol&&(sol.chat_id||sol.CHAT_ID||sol.chatId);
      if(chatId){
        window.chatActualId=String(chatId);
        if(window.V154P) window.V154P.chatActual=String(chatId);
        if(typeof cargarChatPortalActual==="function") setTimeout(()=>cargarChatPortalActual(false),300);
      }
    }catch(_e){}
    renderChatListStep2();
    renderChatConversationStep2();
  };

  function renderChatConversationStep2(){
    installCss();
    const body=document.getElementById("chatBody") || document.getElementById("v15ChatBody");
    if(!body) return;
    const ticket=window.__nodoChatCurrentTicket;

    // Actualizar header siempre
    const titulo=document.getElementById("chatTitulo");
    const subtitulo=document.getElementById("chatSubtitulo");
    if(!ticket){
      if(titulo) titulo.textContent="Seleccioná un chat";
      if(subtitulo) subtitulo.textContent="Sin conversación abierta";
      body.innerHTML=`<div class="alert-box">Aceptá una consulta para abrir conversación.</div>`;
      return;
    }
    if(titulo) titulo.textContent=ticket.usuario||"Usuario";
    if(subtitulo){
      subtitulo.innerHTML=(ticket.solicitudId?"Sol. "+ticket.solicitudId+" · ":"")+"Consulta portal"
        +` <button onclick="vincularDesdeConsulta()" style="margin-left:8px;background:#1e3a5f;color:#7cc4ff;border:0;border-radius:8px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer">🔗 Validar y vincular</button>`
        +` <button onclick="cerrarConsultaWq2()" style="margin-left:6px;background:#7f1d1d;color:#fca5a5;border:0;border-radius:8px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer">✕ Cerrar consulta</button>`;
    }

    // Mensajes de Supabase tienen prioridad; localStorage es fallback
    const supaMsgs=(window.V154P&&window.V154P.chatMensajes&&window.V154P.chatMensajes.length)?window.V154P.chatMensajes:null;
    let msgs;
    if(supaMsgs){
      msgs=supaMsgs.map(m=>({
        tipo:/PANEL|OPERADOR/i.test(m.TIPO_EMISOR||"")?"OPERADOR":"PORTAL",
        mensaje:m.MENSAJE||"",
        imagen:m.IMAGEN_URL||"",
        fecha:m.FECHA||""
      }));
    } else {
      msgs=ticketToMessages(ticket);
    }

    let html=`<div class="wq2-chat-bg">`;
    if(!msgs.length) html+=`<div style="text-align:center;color:#64748b;padding:24px;font-size:13px">Sin mensajes todavía.</div>`;
    msgs.forEach(m=>{
      const op=U(m.tipo)==="OPERADOR";
      const imgSrc=m.imagen||"";
      // Mismo criterio que el chat de hilos: sin recortar, ancho de burbuja, y que se pueda
      // abrir en la ventana aparte. Acá además la imagen NO tenía clic: se veía el recorte de
      // 220px y no había forma de agrandarla. Y la url iba sin escapar al atributo.
      const imgHtml=imgSrc?`<div class="wq2-img" style="margin-top:6px"><img src="${E(imgSrc)}" style="max-width:100%;height:auto;max-height:min(46vh,420px);border-radius:8px;display:block;cursor:zoom-in;object-fit:contain;background:#0b0f16;border:1px solid rgba(255,255,255,0.12)" title="Clic para verla en una ventana aparte" onclick="if(window.nodoVerImagenCompleta){window.nodoVerImagenCompleta(this.src,'');}else{window.open(this.src,'_blank');}" onerror="this.onerror=null;this.style.opacity='0.6';this.alt='No se pudo cargar la imagen';"></div>`:"";
      html+=`<div class="wq2-row ${op?"op":"user"}"><div class="wq2-bubble">${E(m.mensaje||"").replace(/\n/g,"<br>")}${imgHtml}<div class="wq2-time">${hora(m.fecha||"")}</div></div></div>`;
    });
    html+=`</div>`;
    body.innerHTML=html;
    body.scrollTop=body.scrollHeight;
  }

  window.cerrarConsultaWq2 = async function(){
    const ticket=window.__nodoChatCurrentTicket;
    if(!ticket) return;
    if(!confirm("¿Cerrar esta consulta de "+E(ticket.usuario)+"? No se puede deshacer desde el panel.")) return;
    try{
      if(typeof actualizarSolicitudPortal === "function"){
        for(const s of (ticket.items||[])){
          const sid=Number(s.ID||s.SOLICITUD_ID||s.id||0);
          if(sid) await actualizarSolicitudPortal(sid,"CERRADO",{chat_estado:"CERRADO"});
        }
      }
      window.__nodoChatCurrentTicket=null;
      window.__nodoChatCurrentUser="";
      document.body.classList.remove("nodo-chat-open");
      if(typeof cargarSolicitudesPortal==="function") cargarSolicitudesPortal(true);
      if(typeof renderChatListStep2==="function") renderChatListStep2();
      renderChatConversationStep2();
    }catch(err){ alert("Error al cerrar: "+(err.message||err)); }
  };

  function enviarChatStep2(){
    const ticket=window.__nodoChatCurrentTicket;
    if(!ticket){ alert("Aceptá una consulta primero."); return; }
    const input=document.getElementById("chatInput") || document.getElementById("v15ChatInput");
    const msg=S(input?.value).trim();
    const imagen=window.chatImagenBase64||"";
    if(!msg && !imagen) return;
    const saved=getSavedMsgs(ticket.solicitudId || ticket.usuario);
    saved.push({tipo:"OPERADOR", mensaje:msg||(imagen?"[imagen]":""), fecha:new Date().toISOString(), imagen:imagen||undefined});
    setSavedMsgs(ticket.solicitudId || ticket.usuario, saved);
    if(input) input.value="";
    try{ window.chatImagenBase64=""; if(typeof quitarImagenChat==="function") quitarImagenChat(); }catch(_e){}
    renderChatConversationStep2();
  }

  window.renderChatListStep2=renderChatListStep2;
  window.renderChatMensajes=renderChatConversationStep2;
  window.ticketsAgrupados=ticketsAgrupados;
  window.cargarChats = async function(){ renderChatListStep2(); return {ok:true,data:ticketsAgrupados()}; };
  window.cargarChatActual = async function(){ renderChatConversationStep2(); return {ok:true,data:[]}; };
  window.enviarChat = async function(){ enviarChatStep2(); return {ok:true}; };
  // Este bundle carga DESPUÉS de portal-bridge y portal-chat-unificado, así que esta línea
  // pisaba la implementación que sí abre el chat. Y ésta ignoraba el id: sólo repintaba la
  // lista, o sea que hacer clic en una conversación no abría nada (D-70). Ahora delega cuando
  // le pasan un id, y conserva el repintado cuando la llaman sin argumentos.
  const _abrirChatPrevio = (typeof window.abrirChat === 'function') ? window.abrirChat : null;
  window.abrirChat = async function(id){
    if(id != null && _abrirChatPrevio) return _abrirChatPrevio.call(this, id);
    renderChatListStep2();
  };
  window.v15RenderChatList = renderChatListStep2;
  window.v15RenderChatMensajes = renderChatConversationStep2;
  window.v15CargarChatsCompacto = window.cargarChats;
  window.v15EnviarChatCompacto = window.enviarChat;
  window.v15AbrirChatCompacto = window.abrirChat;
  // asegurarChatsSoportePortal: usa la función real de BLQ2 (no stub)

  setTimeout(function(){
    try{
      document.querySelectorAll("*").forEach(function(el){
        if(el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3){
          el.textContent = el.textContent
            .replace(/Consultas portal/g, "Consultas portal")
            .replace(/Billetera en portal/g, "Billetera en portal");
        }
      });
    }catch(_e){}
    renderChatListStep2();
  }, 700);

  // Anti-parpadeo: si la lista queda sin render, repintar con el ACTIVO (Final). Antes usaba
  // renderChatListStep2 (viejo) → si la red de seguridad disparaba, reaparecía la lista vieja
  // (con el tab Interno muerto y datos de otro módulo).
  setInterval(function(){
    const box=document.getElementById("chatList") || document.getElementById("v15ChatList");
    // Leer innerHTML arma de nuevo el texto de toda la lista: con la lista fuera de la vista, no.
    if(window.nodoSeVe && !window.nodoSeVe(box)) return;
    if(box && !box.innerHTML.includes("wq2-wrap")){
      if(typeof renderChatListStep2Final === "function") renderChatListStep2Final();
      else renderChatListStep2();
    }
  }, 1200);
})();
