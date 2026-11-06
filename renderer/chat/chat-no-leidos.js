
/* ============================================================
   NODO · CHAT STEP 6 UNREAD BADGES SAFE
   Agrega notificaciones de nuevos mensajes:
   - Badge lateral Chat
   - Contador en Inicio
   - Badge en pestaña Abiertos
   - "nuevo" en fila del chat abierto
   No toca historial, billeteras, cargas/retiros ni worker.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}
  function toDate(v){const d=new Date(v||0);return isNaN(d.getTime())?new Date(0):d}
  function nowIso(){return new Date().toISOString()}
  function readKey(){return "nodo_chat_read_marks_v1"}
  function notifyKey(){return "nodo_chat_notified_keys_v1"}
  function getJson(key,def){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(def))}catch(_e){return def}}
  function setJson(key,val){try{localStorage.setItem(key,JSON.stringify(val))}catch(_e){}}
  function chatKey(t){ return NodoChatMetrics.chatKey(t); }
  function userMsgs(t){
    return (t?.thread||[]).filter(m=>U(m.origen)==="USUARIO").sort((a,b)=>toDate(a.fecha)-toDate(b.fecha));
  }
  function lastUserMsgTime(t){
    const msgs=userMsgs(t);
    return msgs.length ? (msgs[msgs.length-1].fecha||"") : "";
  }
  function unreadForTicket(t){ return NodoChatMetrics.unreadForTicket(t, getJson(readKey(),{})); }
  function allTickets(){
    try{
      if(typeof window.ticketsAgrupados==="function") return window.ticketsAgrupados()||[];
    }catch(_e){}
    return [];
  }
  function unreadSnapshot(){
    const tickets=allTickets(), marks=getJson(readKey(),{});
    for(const t of tickets){
      if(t._beta){
        const cutoff=toDate(marks[chatKey(t)]||0).getTime();
        const lastMsgTime=toDate(lastUserMsgTime(t)||0).getTime();
        if(cutoff && lastMsgTime && cutoff >= lastMsgTime){
          t._unreadServidor = 0;
        } else {
          const count=window.NodoBetaChat?.count(t._chatId);
          if(Number.isSafeInteger(count))t._unreadServidor=count;
        }
      }
    }
    const snapshot=NodoChatMetrics.snapshot(tickets,marks);
    const serverTotal=window.NodoBetaChat?.total();
    const hasUnreadLocally=snapshot.total > 0;
    if(window.NodoBetaChat?.active() && Number.isSafeInteger(serverTotal)){
      if(!hasUnreadLocally && Object.keys(marks).length > 0){
        snapshot.total = 0;
      } else {
        snapshot.total=serverTotal+NodoChatMetrics.snapshot(tickets.filter(t=>!t._beta&&!t._betaLinked),marks).total;
      }
    }
    return snapshot;
  }
  window.nodoChatUnreadSnapshot = unreadSnapshot;
  function markRead(t){
    if(!t) return;
    const last=lastUserMsgTime(t) || nowIso();
    const marks=getJson(readKey(),{});
    marks[chatKey(t)] = last;
    setJson(readKey(),marks);
    if(t._beta){
      t._unreadServidor = 0;
      void window.NodoBetaChat?.flushVisible();
    }
    updateChatUnreadBadges();
  }
  window.nodoChatMarkReadCurrent=function(){
    const t=window.__nodoChatCurrentTicket;
    if(t) markRead(t);
  };
  // Marcar TODAS las conversaciones como leídas (local, mismo mecanismo que markRead por ticket).
  window.nodoChatMarkAllRead=function(){
    try{
      const tickets=allTickets().filter(t=>t.accepted);
      const marks=getJson(readKey(),{});
      tickets.forEach(t=>{
        marks[chatKey(t)] = lastUserMsgTime(t) || nowIso();
        if(t._beta) t._unreadServidor = 0;
      });
      setJson(readKey(),marks);
      if(window.NodoBetaChat?.flushVisible) void window.NodoBetaChat.flushVisible();
      updateChatUnreadBadges();
      if(typeof renderChatListStep2Final==="function") renderChatListStep2Final();
      try{
        if(typeof toast==="function") toast("✓ Todas marcadas como leídas","green");
      }catch(_e){}
    }catch(_e){ console.warn("markAllRead",_e); }
  };

  // Hasta dónde está leído: la marca de esta PC o la última vez que contestó el operador,
  // lo que sea más nuevo. Es el mismo corte que usa unreadForTicket.
  function corteLeido(t){ return NodoChatMetrics.readCutoff(t, getJson(readKey(),{})); }

  // La lista de avisados no se limpiaba nunca: una clave por mensaje, para siempre, en el
  // localStorage de la PC. Se queda con las últimas 4000 y tira el resto.
  function podar(obj){
    try{
      const ks=Object.keys(obj);
      if(ks.length<=4000) return obj;
      const out={};
      ks.slice(ks.length-4000).forEach(k=>{ out[k]=true; });
      return out;
    }catch(_e){ return obj; }
  }

  function notifyNewMessages(){
    const tickets=allTickets().filter(t=>t.accepted);
    const notified=getJson(notifyKey(),{});
    let changed=false;

    tickets.forEach(t=>{
      const corte=corteLeido(t);
      const isCurrent = document.body.classList.contains("nodo-chat-open") && U(window.__nodoChatCurrentUser||"")===U(t.usuario);
      userMsgs(t).forEach(m=>{
        const k=[chatKey(t),m.solicitud_id||"",m.fecha||"",m.mensaje||""].join("|");
        if(notified[k]) return;

        // SIEMPRE se anota que este mensaje ya pasó por acá, avise o no.
        //
        // Antes sólo se anotaba cuando además había algo sin leer. Un mensaje visto con la
        // conversación al día no quedaba anotado nunca — y el día que el jugador volvía a
        // escribir, el aviso salía por ESE y por todos los viejos que nunca se habían anotado,
        // todos juntos y de golpe. Eso es lo que vio Juan el 3/10: "de a ratos te marca
        // mensajes ya viejos", cuatro avisos en el mismo segundo.
        notified[k]=true; changed=true;

        // Y el aviso mira ESTE mensaje, no el total del ticket: si es posterior a lo leído,
        // es nuevo de verdad.
        const esNuevo = toDate(m.fecha).getTime() > corte;
        if(esNuevo && !isCurrent){
          try{ if(typeof toast==="function") toast("💬 Nuevo mensaje de "+(t.usuario||"usuario"),"blue"); }catch(_e){}
        }
      });
    });
    if(changed) setJson(notifyKey(),podar(notified));
  }

  function updateChatUnreadBadges(){
    const snapshot=unreadSnapshot();
    const total=snapshot.total;

    // Badge lateral Chat
    const badge=document.getElementById("badgeChat");
    if(badge){
      if(total>0){badge.classList.remove("hidden");badge.textContent=String(total)}
      else{badge.classList.add("hidden");badge.textContent="0"}
    }

    // Stat Inicio
    const stat=document.getElementById("statChats");
    if(stat) stat.textContent=String(total);

    const sub=stat?.parentElement?.querySelector(".stat-mini-sub, .stat-sub");
    if(sub) sub.textContent = total>0 ? "Mensajes nuevos portal" : "Consultas portal";

    // Botón nav chat highlight
    const nav=document.getElementById("navChat");
    if(nav){
      nav.style.boxShadow = total>0 ? "0 0 0 1px rgba(18,183,106,.65),0 0 18px rgba(18,183,106,.25)" : "";
    }

    // Tabs y filas visuales
    const list=document.getElementById("chatList")||document.getElementById("v15ChatList");
    if(list){
      const tabs=list.querySelectorAll(".wq2-tab");
      if(tabs && tabs.length>=2){
        // Cada solapa cuenta lo de SUS filas. "Abiertos" mostraba el total de toda la oficina,
        // con lo que los mensajes de los chats que esperan aparecían en la solapa equivocada y
        // la suma de lo que se ve no daba con ese número. El total de todo sigue en el costado.
        let enEspera=0, enEsperaSinLeer=0, abiertos=0, abiertosSinLeer=0;
        for(const x of snapshot.tickets){
          if(x.cerrado) continue;
          const n=snapshot.unread.get(x)||0;
          if(x.accepted){ abiertos++; abiertosSinLeer+=n; }
          else{ enEspera++; enEsperaSinLeer+=n; }
        }
        const solapa=(nombre,cuantos,sinLeer)=>`${nombre} ${cuantos?`<span class="wq2-count">${cuantos}</span>`:""}${sinLeer?` <span class="wq2-count" style="background:#ef4444">${sinLeer}</span>`:""}`;
        tabs[0].innerHTML = solapa("En espera",enEspera,enEsperaSinLeer);
        tabs[1].innerHTML = solapa("Abiertos",abiertos,abiertosSinLeer);
      }

      // El ticket de cada fila se busca entre los de ESTA pasada (snapshot.tickets). Antes se
      // pedían de nuevo con allTickets(): salen objetos nuevos, `snapshot.unread.get(t)` no
      // encontraba nada y ninguna fila mostraba su número aunque el total del costado dijera 25.
      const porId=new Map();
      for(const x of snapshot.tickets){ if(!porId.has(x.id)) porId.set(x.id,x); }
      list.querySelectorAll(".wq2-item").forEach(item=>{
        const name=item.querySelector(".wq2-name")?.textContent?.trim();
        const ticketId=item.dataset?.ticketId;
        const t=ticketId?porId.get(ticketId):snapshot.byUser.get(U(name));
        if(!t) return;
        const u=snapshot.unread.get(t)||0;
        let marker=item.querySelector(".wq2-unread-final");
        if(u>0){
          if(!marker){
            marker=document.createElement("span");
            marker.className="wq2-unread-final";
            const meta=item.querySelector(".wq2-meta") || item;
            meta.appendChild(marker);
          }
          marker.textContent=String(u);
        }else if(marker){marker.remove();}
        const state=item.querySelector(".wq2-state");
        if(state){
          const base=state.textContent.replace(/ · \d+ nuevos?$/, "");
          state.textContent=base+(u>0?` · ${u} nuevo${u>1?"s":""}`:"");
        }
      });
    }
  }

  window.nodoChatRefreshUnread = updateChatUnreadBadges;

  function ensureCss(){
    if(document.getElementById("chatStep6UnreadCss"))return;
    const st=document.createElement("style");
    st.id="chatStep6UnreadCss";
    st.textContent=`
      .wq2-unread-final{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:20px;
        height:20px;
        border-radius:999px;
        background:#ef4444;
        color:#fff;
        font-size:11px;
        font-weight:950;
        margin-left:6px;
        box-shadow:0 0 0 2px rgba(239,68,68,.15);
      }
      .wq2-item:has(.wq2-unread-final){
        box-shadow:inset 0 0 0 1px rgba(239,68,68,.22);
      }
      /* En la lista, el globito va debajo de la hora y pegado a la derecha, como en cualquier
         bandeja de mensajes. La columna de la hora mide 92 px y "7/8 11:27 a. m." ya la llena:
         al lado no entra. */
      .wq2-meta .wq2-unread-final{
        display:flex;
        width:max-content;
        margin:4px 0 0 auto;
        padding:0 6px;
      }
    `;
    document.head.appendChild(st);
  }

  // Wrap render lista para agregar badges después del render.
  const oldRenderList=window.renderChatListStep2;
  if(typeof oldRenderList==="function"){
    window.renderChatListStep2=function(){
      const r=oldRenderList.apply(this,arguments);
      setTimeout(()=>{ensureCss();updateChatUnreadBadges();},40);
      return r;
    };
  }

  // Wrap abrir/aceptar: si estoy abriendo el chat, queda leído.
  const oldAccept=window.aceptarTicketLocalStep2;
  if(typeof oldAccept==="function"){
    window.aceptarTicketLocalStep2=function(ticketId){
      const r=oldAccept.apply(this,arguments);
      setTimeout(()=>{
        const t=window.__nodoChatCurrentTicket;
        if(t) markRead(t);
        updateChatUnreadBadges();
      },450);
      return r;
    };
  }

  // Wrap conversación: si estoy dentro del chat, marco leído.
  const oldRenderMsg=window.renderChatMensajes;
  if(typeof oldRenderMsg==="function"){
    window.renderChatMensajes=function(){
      const r=oldRenderMsg.apply(this,arguments);
      setTimeout(()=>{
        if(document.body.classList.contains("nodo-chat-open")){
          const t=window.__nodoChatCurrentTicket;
          if(t) markRead(t);
        }
      },120);
      return r;
    };
  }

  // Al volver a bandeja NO marca leído; solo muestra contador.
  document.addEventListener("keydown",function(ev){
    if(ev.key==="Escape") setTimeout(updateChatUnreadBadges,250);
  },true);

  ensureCss();
  // Este reloj reescribía pestañas y marcadores cada 1,8 s sobre la MISMA lista que recargan
  // otros dos (los chats cada 15 s, el chat abierto cada 5 s). Los marcadores desaparecían con
  // cada repintado y volvían a aparecer acá: de ahí el parpadeo y el contador saltando 0↔N.
  // Ahora sólo se toca el DOM si cambió algo de verdad. La firma incluye cuántos marcadores
  // hay puestos, así que si un repintado se los llevó, se vuelven a poner UNA vez.
  // Es una MITIGACIÓN: el problema de fondo es que dos sistemas son dueños de la misma lista
  // y eso se resuelve al unificar el chat (D-71, D-74).
  let _firmaNoLeidos = '';
  setInterval(function(){
    try{
      // Este sí corre con el chat minimizado o la ventana abajo: es el contador y el aviso de
      // mensaje nuevo. Lo único que espera es el puesto: antes no hay chats de ninguna oficina.
      if(window.nodoOficinaLista && !window.nodoOficinaLista()) return;
      notifyNewMessages();
      const puestos = (document.querySelectorAll('.wq2-unread-final')||[]).length;
      // Entran también los que esperan: ahora su fila muestra el número que trae el servidor.
      const firma = allTickets().filter(t=>!t.cerrado)
        .map(function(t){ return chatKey(t)+':'+unreadForTicket(t); }).join('|') + '#' + puestos;
      if(firma === _firmaNoLeidos) return;
      _firmaNoLeidos = firma;
      updateChatUnreadBadges();
    }catch(_e){}
  },4000);

  setTimeout(function(){
    try{updateChatUnreadBadges()}catch(_e){}
  },900);
})();
