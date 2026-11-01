
/* ============================================================
   NODO · CHAT STEP 7 NO FLICKER SAFE
   Estabiliza visualmente badges/lista:
   - evita parpadeo de contador 1 -> 0 -> 1
   - no repinta bandeja si el contenido no cambió
   - mantiene notificaciones
   No toca datos, historial, billeteras ni motor.
   ============================================================ */
(function(){
  const metrics = NodoChatMetrics.create({
    getTickets: () => { try { return window.ticketsAgrupados?.() || []; } catch(_) { return []; } },
    readMarks: () => { try { return JSON.parse(localStorage.getItem('nodo_chat_read_marks_v1') || '{}'); } catch(_) { return {}; } }
  });
  let lastListSignature = '';
  let lastRenderAt = 0;
  function signatureTickets(){ return metrics.read().signature; }

  function updateStableBadges(){ window.nodoChatRefreshUnread?.(); }

  // Reemplaza el render completo por render controlado cuando no cambió nada.
  const oldRenderList = window.renderChatListStep2;
  if(typeof oldRenderList === "function"){
    window.renderChatListStep2 = function(){
      const sig = signatureTickets();
      const now = Date.now();
      const list=document.getElementById("chatList")||document.getElementById("v15ChatList");

      // Si la firma no cambió y ya existe la bandeja, no la repinto entera.
      if(list && list.innerHTML && sig === lastListSignature && now - lastRenderAt < 3500){
        updateStableBadges();
        return;
      }

      lastListSignature = sig;
      lastRenderAt = now;
      const r = oldRenderList.apply(this,arguments);
      setTimeout(updateStableBadges,60);
      return r;
    };
  }


  setTimeout(function(){
    try{lastListSignature=signatureTickets();updateStableBadges()}catch(_e){}
  },800);
})();
