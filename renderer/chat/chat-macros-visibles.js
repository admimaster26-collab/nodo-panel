
/* ============================================================
   NODO · CHAT MACROS VISIBLES FIX SAFE
   Corrige que en modo chat abierto/full se ocultaba el botón 📋.
   No toca datos, historial, billeteras, motor ni Supabase.
   ============================================================ */
(function(){
  function ensureVisibleMacroButton(){
    const compose = document.querySelector("#viewChat .chat-compose");
    const row = document.querySelector("#viewChat .chat-row");
    if(!compose || !row) return;

    let btn = document.getElementById("nodoMacroBtnVisible");
    if(!btn){
      btn = document.createElement("button");
      btn.id = "nodoMacroBtnVisible";
      btn.type = "button";
      btn.className = "mini-btn gray";
      btn.innerHTML = "📋 Respuestas rápidas";
      btn.title = "Respuestas rápidas";
      btn.onclick = function(ev){
        if(ev) ev.preventDefault();
        if(typeof toggleMacrosPanel === "function") toggleMacrosPanel(ev);
      };

      const bar = document.createElement("div");
      bar.id = "nodoMacroVisibleBar";
      bar.appendChild(btn);
      compose.insertBefore(bar, compose.firstChild);
    }

    // Desplegable con las operaciones del jugador de ESTE chat (pedido de Juan). Elegís una y el
    // expediente queda escrito en el cuadro, para revisarlo o editarlo antes de mandarlo. Así no hay
    // que ir al historial, abrir la operación y copiar — y la carga original y su bono de PROMOS
    // aparecen como dos opciones distintas.
    const bar2 = document.getElementById("nodoMacroVisibleBar");
    if(bar2 && !document.getElementById("nodoChatCargasSel")){
      const sel = document.createElement("select");
      sel.id = "nodoChatCargasSel";
      sel.title = "Escribir en el chat el expediente de una operación de este jugador";
      sel.innerHTML = '<option value="">📄 Expediente de una operación…</option>';
      sel.onmousedown = sel.onfocus = function(){ try{ window.nodoChatCargasLlenar(sel); }catch(_e){} };
      sel.onchange = function(){ try{ window.nodoChatCargaElegida(sel.value); }catch(_e){} sel.selectedIndex = 0; };
      bar2.appendChild(sel);
    }

    // El cuadro crece con el texto: se engancha una sola vez a cada uno.
    ["chatInput","v15ChatInput"].forEach(function(id){
      const inp = document.getElementById(id);
      if(inp && !inp.__nodoAutoAlto){
        inp.__nodoAutoAlto = true;
        ["input","keyup","focus"].forEach(function(ev){ inp.addEventListener(ev, function(){ window.nodoChatInputAjustar(inp); }); });
      }
      if(inp) window.nodoChatInputAjustar(inp);   // también después de un macro, que cambia .value sin evento
    });

    // Traer las operaciones del jugador cuando cambia el chat abierto (no sólo las del período
    // cargado en el historial, que puede ser sólo el turno).
    const u = _usuarioChatActual();
    if(u && u !== window.__nodoChatCargasUsuario){ window.__nodoChatCargasUsuario = u; _prefetchCargas(u); }
  }

  function _usuarioChatActual(){
    return String(window.__nodoChatCurrentUser
      || (window.__nodoChatCurrentTicket && window.__nodoChatCurrentTicket.usuario) || '').toLowerCase().trim();
  }
  window._chatCargasCache = window._chatCargasCache || {};
  async function _prefetchCargas(u){
    window.NodoSalud?.begin('CHAT')?.record('DATA','OK','CHAT_MACROS_PREFETCH');
    try{
      if(typeof supabaseClient === 'undefined' || !supabaseClient || typeof pcAliasesHist !== 'function') return;
      const { data, error } = await supabaseClient.from('historial_ops').select('*')
        .in('pc_codigo', pcAliasesHist()).ilike('usuario', u)
        .in('tipo', ['CARGA','RETIRO']).order('created_at', { ascending:false }).limit(25);
      if(!error && Array.isArray(data)) window._chatCargasCache[u] = data;
    }catch(_e){}
  }
  function _operacionesDe(u){
    const vistas = {}, out = [];
    (window._chatCargasCache[u] || []).concat(window._historialData || []).forEach(function(h){
      const t = String(h.tipo || '').toUpperCase();
      if((t !== 'CARGA' && t !== 'RETIRO') || String(h.usuario || '').toLowerCase().trim() !== u) return;
      if(vistas[h.id]) return; vistas[h.id] = true; out.push(h);
    });
    out.sort(function(a, b){ return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    return out.slice(0, 25);
  }

  window.nodoChatCargasLlenar = function(sel){
    const u = _usuarioChatActual();
    if(!u){ sel.innerHTML = '<option value="">📄 Abrí un chat para ver sus operaciones</option>'; return; }
    const ops = _operacionesDe(u);
    let html = '<option value="">📄 Expediente de una operación…</option>';
    if(!ops.length) html += '<option value="" disabled>Sin operaciones de ' + escapeHtml(u) + ' todavía</option>';
    ops.forEach(function(h){
      const t = String(h.tipo || '').toUpperCase();
      const esBono = String(h.origen || '').toUpperCase() === 'PROMO_BONO';
      let f = ''; try{ f = new Date(h.created_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }catch(_e){}
      const lbl = (t === 'CARGA' ? (esBono ? '🎁 Bono ' : '⬆ Carga ') : '⬇ Retiro ')
        + money(h.monto || 0) + ' · ' + f
        + (h.solicitud_id ? ' · #' + h.solicitud_id : '')
        + (String(h.estado || '').toUpperCase() !== 'OK' ? ' · ' + h.estado : '');
      html += '<option value="' + escapeHtml(String(h.id)) + '">' + escapeHtml(lbl) + '</option>';
    });
    sel.innerHTML = html;
  };

  window.nodoChatCargaElegida = function(histId){
    if(!histId) return;
    const u = _usuarioChatActual();
    const row = _operacionesDe(u).find(function(h){ return String(h.id) === String(histId); });
    if(!row){ try{ toast('No encontré esa operación', 'yellow'); }catch(_e){} return; }
    const txt = (typeof window.expedienteTextoDe === 'function') ? window.expedienteTextoDe(row) : '';
    if(!txt){ try{ toast('No se pudo armar el expediente', 'yellow'); }catch(_e){} return; }
    const inp = document.getElementById('chatInput');
    if(!inp) return;
    // Se ESCRIBE en el cuadro, no se manda: Juan quiere poder editarlo antes.
    inp.value = String(inp.value || '').trim() ? (String(inp.value).replace(/\s+$/, '') + '\n\n' + txt) : txt;
    try{ inp.focus(); }catch(_e){}
    window.nodoChatInputAjustar(inp);
  };

  // Alto según el contenido, hasta casi media pantalla; más que eso, scroll adentro del cuadro.
  window.nodoChatInputAjustar = function(inp){
    inp = inp || document.getElementById('chatInput');
    if(!inp || !inp.style) return;
    const max = Math.round((window.innerHeight || 800) * 0.45);
    inp.style.height = 'auto';
    inp.style.height = Math.min((Number(inp.scrollHeight) || 0) + 2, max) + 'px';
  };

  function installCss(){
    if(document.getElementById("nodoMacrosVisibleCss")) return;
    const st = document.createElement("style");
    st.id = "nodoMacrosVisibleCss";
    st.textContent = `
      #nodoMacroVisibleBar{
        display:flex!important;
        gap:8px;
        align-items:center;
        justify-content:flex-start;
        margin-bottom:8px;
      }
      #nodoChatCargasSel{
        max-width:340px;height:34px;border-radius:11px;background:#1e293b;color:#e2e8f0;
        border:1px solid #334155;font-size:12px;padding:0 8px;cursor:pointer;
      }
      #nodoMacroBtnVisible{
        display:inline-flex!important;
        width:auto!important;
        min-width:0!important;
        align-items:center;
        justify-content:center;
        padding:8px 11px!important;
        border-radius:11px!important;
        font-size:12px!important;
        background:#334155!important;
        color:#fff!important;
      }

      /* Rehabilita macros aun cuando el full chat ocultaba botones del composer */
      body.nodo-chat-open #nodoMacroVisibleBar,
      body.chat-expanded #nodoMacroVisibleBar{
        display:flex!important;
      }

      body.nodo-chat-open #macrosPanel,
      body.chat-expanded #macrosPanel{
        display:grid;
        left:10px!important;
        right:10px!important;
        bottom:calc(100% + 8px)!important;
        max-height:360px!important;
        overflow:auto!important;
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        z-index:9999!important;
      }

      body.nodo-chat-open #macrosPanel.hidden,
      body.chat-expanded #macrosPanel.hidden{
        display:none!important;
      }

      @media(max-width:900px){
        body.nodo-chat-open #macrosPanel,
        body.chat-expanded #macrosPanel{
          grid-template-columns:1fr!important;
        }
      }
    `;
    document.head.appendChild(st);
  }

  const oldToggle = window.toggleMacrosPanel;
  window.toggleMacrosPanel = function(ev){
    installCss();
    ensureVisibleMacroButton();
    if(typeof oldToggle === "function"){
      oldToggle(ev);
    }else{
      const panel = document.getElementById("macrosPanel");
      if(panel) panel.classList.toggle("hidden");
    }
  };

  setTimeout(function(){
    installCss();
    ensureVisibleMacroButton();
  },700);

  setInterval(function(){
    try{
      installCss();
      ensureVisibleMacroButton();
    }catch(_e){}
  },2500);
})();
