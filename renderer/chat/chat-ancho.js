
/* ============================================================
   NODO · CHAT STEP 2 FULL WIDTH FIX
   Fuerza el chat abierto a ocupar TODO el módulo.
   No toca datos ni Supabase.
   ============================================================ */
(function(){
  function installFullWidthFix(){
    if(document.getElementById("nodoStep2FullWidthFixCss")) return;
    const st=document.createElement("style");
    st.id="nodoStep2FullWidthFixCss";
    st.textContent = `
      body.nodo-chat-open #viewChat .chat-layout{
        display:block!important;
        width:100%!important;
        max-width:none!important;
        min-height:700px!important;
        background:#0b0f17!important;
        overflow:hidden!important;
      }

      body.nodo-chat-open #viewChat .chat-list{
        display:none!important;
        width:0!important;
        min-width:0!important;
        max-width:0!important;
        flex:0 0 0!important;
      }

      body.nodo-chat-open #viewChat .chat-panel{
        display:flex!important;
        flex-direction:column!important;
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
        min-height:700px!important;
        background:#0b0f17!important;
        border:0!important;
      }

      body.nodo-chat-open #viewChat .chat-head{
        width:100%!important;
        min-width:0!important;
        display:flex!important;
        align-items:center!important;
        justify-content:flex-start!important;
        gap:12px!important;
        background:#111827!important;
        border-bottom:1px solid #252b38!important;
        padding:10px 12px!important;
      }

      body.nodo-chat-open #chatBody,
      body.nodo-chat-open #v15ChatBody{
        display:block!important;
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
        flex:1 1 auto!important;
        min-height:560px!important;
        max-height:calc(100vh - 230px)!important;
        overflow:auto!important;
        background:#0b0f17!important;
      }

      body.nodo-chat-open #viewChat .chat-input-row,
      body.nodo-chat-open #viewChat .composer,
      body.nodo-chat-open #viewChat .chat-composer{
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
        display:flex!important;
        background:#0b0f17!important;
        border-top:1px solid #252b38!important;
        padding:10px!important;
      }

      body.nodo-chat-open #chatInput,
      body.nodo-chat-open #v15ChatInput{
        flex:1 1 auto!important;
        width:auto!important;
        max-width:none!important;
      }

      body.nodo-chat-open .wq2-chat-bg{
        width:100%!important;
        max-width:none!important;
        min-height:100%!important;
        box-sizing:border-box!important;
      }

      body.nodo-chat-open .wq2-row{
        width:100%!important;
        box-sizing:border-box!important;
      }

      body.nodo-chat-open .wq2-bubble{
        max-width:68%!important;
      }

      /* La burbuja que lleva un comprobante se ensancha. Esta regla va con !important porque la
         de arriba también lo lleva: sin esto el 68% ganaba y la foto seguía chica justo en la
         vista donde el operador la mira para aprobar la carga. */
      body.nodo-chat-open .wq2-bubble:has(.wq2-img){
        max-width:92%!important;
      }

      /* Por si el HTML viejo metió anchos fijos internos */
      body.nodo-chat-open #viewChat [style*="grid-template-columns"],
      body.nodo-chat-open #viewChat [style*="width: 50"],
      body.nodo-chat-open #viewChat [style*="width:50"]{
        max-width:none!important;
      }
    `;
    document.head.appendChild(st);
  }

  const oldAccept = window.aceptarTicketLocalStep2;
  if(typeof oldAccept === "function"){
    window.aceptarTicketLocalStep2 = function(ticketId){
      oldAccept(ticketId);
      installFullWidthFix();
      document.body.classList.add("nodo-chat-open");
      setTimeout(function(){
        const body=document.getElementById("chatBody") || document.getElementById("v15ChatBody");
        if(body) body.scrollTop = body.scrollHeight;
      }, 150);
    };
  }

  installFullWidthFix();
})();
