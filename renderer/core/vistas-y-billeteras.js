// ── Qué es la "dife" y qué hacer con ella ───────────────────────────────────
// El número solo no dice nada: el operador ve "-$ 3.462" y no sabe si tiene que hacer algo,
// si es grave, ni de dónde salió. Este cuadro lo explica en los términos de la operación.
window.explicarDiferenciaFichas = function(){
  const drex = (typeof _watchdog !== "undefined") ? _watchdog.drexFichas : null;
  const chu  = (typeof _watchdog !== "undefined") ? _watchdog.chuniorFichas : null;
  const hay  = (typeof drex === "number" && typeof chu === "number");
  const diff = hay ? (drex - chu) : 0;
  const abs  = Math.abs(diff);
  const hora = (typeof _watchdog !== "undefined" && _watchdog.lastCheck)
    ? new Date(_watchdog.lastCheck).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : null;

  // El signo es lo que dice QUÉ pasó, y es lo que nadie tiene memorizado.
  const _lado = diff > 0
    ? { t:'Sobran fichas en el casino', d:'Se cargaron fichas que en Chunior no están anotadas. Suele ser una carga hecha en el agente que no se llegó a registrar.' }
    : { t:'Faltan fichas en el casino',  d:'Hay movimientos anotados en Chunior que no se reflejan en el casino. Suele ser un retiro anotado dos veces, o una anotación de más.' };

  const filaCmp = function(k, v, color){
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #1e293b">'
      + '<span class="small" style="color:#8b949e">'+k+'</span>'
      + '<b style="'+(color?('color:'+color):'')+'">'+v+'</b></div>';
  };

  const cuerpo = !hay
    ? '<div class="alert-box">Todavía no hay una lectura de los dos saldos. Tocá <b>↻ Rechequear</b> y volvé.</div>'
    : (
        filaCmp('Casino (Drex)', money(drex))
      + filaCmp('Anotado (Chunior)', money(chu))
      + filaCmp('Diferencia', (diff>=0?'+':'−')+money(abs), Math.abs(diff)<=1 ? '#22c55e' : '#f59e0b')
      + (hora ? '<div class="small" style="color:#8b949e;margin-top:6px">Leído a las '+escapeHtml(hora)+'</div>' : '')
      + (Math.abs(diff) <= 1
          ? '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.4);color:#bbf7d0;font-size:12.5px">'
            + '<b>Está cuadrado.</b> Lo que hay en el casino y lo anotado en Chunior coinciden. No hay nada que hacer.</div>'
          : '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.45);color:#fde68a;font-size:12.5px;line-height:1.55">'
            + '<b>'+_lado.t+' por '+money(abs)+'.</b><br>'+_lado.d
            + '<div style="margin-top:8px;color:#e6edf3"><b>Qué hacer, en orden:</b></div>'
            + '<div style="margin-top:4px">1. <b>↻ Rechequear</b>. Si venís de operar recién, la diferencia puede ser de un movimiento que todavía no terminó de impactar.</div>'
            + '<div style="margin-top:3px">2. Si sigue, mirá el historial del turno buscando una operación por <b>'+money(abs)+'</b>: casi siempre la dife es UNA operación sola.</div>'
            + '<div style="margin-top:3px">3. Si aparece, corregila donde falte (<b>Reintentar</b> si no se anotó en Chunior, <b>Editar</b> si el monto quedó mal).</div>'
            + '<div style="margin-top:3px">4. Si no la encontrás, dejala anotada en el cierre de turno antes de irte. Una dife sin explicar que pasa de turno no la resuelve nadie.</div>'
            + '</div>')
      );

  abrirModal('📊 Diferencia de fichas', cuerpo, null, '');
  try{ const b=document.getElementById('modalSaveBtn'); if(b) b.style.display='none'; }catch(_e){}
};

function mostrarVista(vista){
  if(vista==="ajustes"){
    try{ window.nodoAbrirAjustes && window.nodoAbrirAjustes(); }catch(_e){}
    return;
  }
  if(vista==="chat" && window.matchMedia && window.matchMedia("(min-width:1101px)").matches){
    try{ window.nodoChatMin && nodoChatMin(false); }catch(_e){} // tocar Chat restaura el panel si estaba minimizado
    document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));
    document.getElementById("navChat")?.classList.add("active");
    cargarChats(true);
    return;
  }
  ["Inicio","Solicitudes","Billeteras","Chat","Jugadores"].forEach(v=>{
    document.getElementById("view"+v)?.classList.add("hidden");
    document.getElementById("nav"+v)?.classList.remove("active");
  });
  const cap=vista.charAt(0).toUpperCase()+vista.slice(1);
  document.getElementById("view"+cap)?.classList.remove("hidden");
  document.getElementById("nav"+cap)?.classList.add("active");
  // El chat ocupa toda la altura de .main sin scroll externo
  const mainEl = document.querySelector('.main');
  if(mainEl) mainEl.classList.toggle('is-chat', vista === 'chat');
  if(vista==="solicitudes")renderSolicitudes();
  if(vista==="billeteras")cargarBilleteras();
  if(vista==="chat")cargarChats();
  if(vista==="jugadores")cargarJugadores();
  if(vista==="ajustes"){
    try{ window.nodoSincronizarAjustesTonos && window.nodoSincronizarAjustesTonos(); }catch(_e){}
    try{ window.nodoCargarBackendAgentes && window.nodoCargarBackendAgentes(); }catch(_e){}
    try{ window.verificarEstadoBackoffice && window.verificarEstadoBackoffice(); }catch(_e){}
  }
  if(vista==="verificaciones")cargarVerificaciones();
  cerrarMenuMobile();
}

async function refrescarTodo(showToast=true){
  await cargarSolicitudes(false);
  await cargarBilleteras(false);
  await cargarChats(false);
  // Recargar historial para que el cross-ref operador/saldo_post esté disponible
  await cargarHistorial();
  renderInicio();
  if(showToast)toast("Panel actualizado","green");
}
async function cargarSolicitudes(silencioso=false){
  // SAFE: si el bridge Portal está disponible, no dejamos que la consulta legacy
  // pinte/limpie el inicio. Delegamos a la fuente real del portal.
  if(window.V154P && window.V154P.portalBridgeReady && typeof window.v154pCargarSolicitudes === "function"){
    return await window.v154pCargarSolicitudes(silencioso);
  }

  const r = await cargarSolicitudesSupabase();

  if(!r.ok){
    toast(r.error || "Error solicitudes Supabase","red");
    return;
  }

  solicitudes = (r.solicitudes || []);

  renderSolicitudes();
  renderInicio();
  verificarSolicitudes(silencioso);
}
async function cargarBilleteras(render=true){
  let rows = [];
  let errorFinal = null;

  function _walletRowsFromRpcData(data){
    try{
      if(typeof data === 'string') data = JSON.parse(data);
    }catch(_e){}
    if(Array.isArray(data)) return data;
    if(data && Array.isArray(data.rows)) return data.rows;
    if(data && data.data && Array.isArray(data.data.rows)) return data.data.rows;
    return [];
  }

  function _normCode(x){
    return String(x||'').trim().toUpperCase().replace(/[\s_\-]+/g,'');
  }

  function _candidateCodes(){
    let out = [];
    const push = v => { v=String(v||'').trim(); if(v && !out.includes(v)) out.push(v); };
    push(pcOperativa);
    push(window.__nodoOficinaDetectada);
    push(window.__nodoPuestoDetectado);
    try{ push(localStorage.getItem('nodo_oficina_id')); }catch(_e){}
    try{ push(localStorage.getItem('nodo_puesto_chunior')); }catch(_e){}

    // Compatibilidad histórica de P1: Chunior muestra XGENERALENUSO / XPLATA y las billeteras
    // viejas quedaron en P1 con oficina_id XPLATA. PERO este fallback SOLO debe aplicar si ESTA
    // oficina ES P1. Antes se agregaba SIEMPRE → una oficina NUEVA (P6) sin billeteras propias
    // cargaba las de P1 (mostraba billeteras ajenas y el sync nunca creaba las suyas → _nuevas vacío).
    if(_esOficinaP1(pcOperativa)){
      push('XGENERALENUSO');
      push('XPLATA');
      push('P1');
    }
    return out;
  }
  // ¿Esta oficina es la histórica P1? (única que debe heredar el fallback XPLATA/XGENERALENUSO/P1)
  function _esOficinaP1(pc){
    const c = String(pc||'').trim().toUpperCase().replace(/[\s_\-]+/g,'');
    return c==='' || ['P1','PC1','XGENERALENUSO','XGENERAL','GENERAL','XPLATA','OFI_1'].includes(c);
  }

  // 1) RPC oficial. Puede devolver {rows:[...]} o string JSON, según cache/API.
  const health = window.NodoSalud?.begin('BILLETERAS');
  const candidates = _candidateCodes();
  for(const code of candidates){
    if(rows.length) break;
    try{
      const r = await supabaseClient.rpc('panel_nodo_list_billeteras',{
        p_pc_codigo: code,
        p_landing_pc_codigo: code
      });
      if(!r.error){
        rows = _walletRowsFromRpcData(r.data);
      }else{
        errorFinal = r.error;
      }
    }catch(e){ errorFinal = e; }
  }

  // 2) Fallback directo por pc_codigo/oficina_id. No depende de la RPC.
  if(!rows.length){
    try{
      const codes = candidates.map(_normCode).filter(Boolean);
      const orParts = [];
      codes.forEach(c=>{
        if(c === 'XGENERALENUSO' || c === 'XPLATA' || c === 'P1'){
          // abajo agregamos condiciones concretas no normalizadas
        }
      });
      // Mismo criterio que _candidateCodes: el OR con P1/XPLATA/XGENERALENUSO SOLO si esta oficina es P1.
      const _orFiltro = _esOficinaP1(pcOperativa)
        ? 'pc_codigo.eq.'+(pcOperativa||'')+',pc_codigo.eq.P1,oficina_id.eq.XPLATA,oficina_id.eq.XGENERALENUSO'
        : 'pc_codigo.eq.'+(pcOperativa||'');
      const r = await supabaseClient
        .from('billeteras')
        .select('*')
        .or(_orFiltro)
        .order('seleccionada_manual',{ascending:false})
        .order('orden',{ascending:true})
        .order('nombre_visible',{ascending:true});
      if(!r.error) rows = r.data || [];
      else errorFinal = r.error;
    }catch(e){ errorFinal = e; }
  }

  // 3) Fallback por UID detectados en Chunior.
  if(!rows.length){
    let uids = [];
    try{ uids = JSON.parse(localStorage.getItem('nodo_chunior_wallet_uids') || '[]'); }catch(_e){ uids=[]; }
    if(Array.isArray(window.__nodoChuniorWalletUids) && window.__nodoChuniorWalletUids.length){
      uids = window.__nodoChuniorWalletUids;
    }
    uids = Array.from(new Set((uids||[]).map(String).filter(Boolean)));
    if(uids.length){
      // Los UID salen de la ventana de Chunior y la MISMA wallet puede existir en varias
      // oficinas. Sin filtrar por pc_codigo, este fallback traia billeteras ajenas y las
      // mezclaba con las propias: en P4 aparecia AVILA MP, que es de P2.
      let qUid = supabaseClient
        .from('billeteras')
        .select('*')
        .in('chunior_uid', uids);
      if(pcOperativa) qUid = qUid.eq('pc_codigo', pcOperativa);
      const rUid = await qUid
        .order('seleccionada_manual',{ascending:false})
        .order('orden',{ascending:true})
        .order('nombre_visible',{ascending:true});
      if(!rUid.error) rows = rUid.data || [];
      else errorFinal = rUid.error;
    }
  }

  if(!rows.length && errorFinal){ health?.reply(errorFinal); health?.record('DATA','ERROR','BILLETERAS_LOAD_FAILED'); console.error('Error billeteras:', errorFinal); }
  else { health?.reply(); health?.record('DATA','OK','BILLETERAS_LOAD_OK'); }

  const saldoByUid = window.__nodoChuniorWalletSaldoByUid || {};
  let nombreByUid = window.__nodoChuniorWalletNombreByUid || {};
  try{
    if(!Object.keys(nombreByUid||{}).length){
      nombreByUid = JSON.parse(localStorage.getItem('nodo_chunior_wallet_nombres') || '{}');
    }
  }catch(_e){ nombreByUid = {}; }
  // Red final: venga de donde venga la fila, si es de OTRA oficina no entra. Los tres
  // caminos de carga (RPC, fallback por pc_codigo, fallback por chunior_uid) pueden traer
  // filas ajenas, y una sola alcanza para que getBilleraLanding devuelva la billetera
  // equivocada y se le ajuste el saldo a otra oficina.
  const _pcAhora = String(pcOperativa||'').trim().toUpperCase();
  let _descartadas = 0;
  billeteras=(rows||[])
    .filter(function(b){
      const activa = (b.activa === true || String(b.activa).toLowerCase()==='true' || String(b.activa).toUpperCase()==='SI');
      const estado = normalizar(b.estado||'ACTIVA');
      if(!(activa && estado !== 'FUSIONADA')) return false;
      const pcBil = String(b.pc_codigo||'').trim().toUpperCase();
      if(_pcAhora && pcBil && pcBil !== _pcAhora){ _descartadas++; return false; }
      return true;
    })
    .map(b=>{
      const uid = b.chunior_uid || '';
      const saldo = (uid && Object.prototype.hasOwnProperty.call(saldoByUid, String(uid))) ? Number(saldoByUid[String(uid)]||0) : Number(b.saldo||0);
      return {
        ID_BILLETERA:b.id,
        NOMBRE_VISIBLE:b.nombre_visible,
        NOMBRE_CHUNIOR:(uid && nombreByUid[String(uid)]) ? nombreByUid[String(uid)] : (b.nombre_chunior || b.nombre_visible),
        TIPO:b.tipo || b.banco || (uid ? 'Chunior' : ''),
        BANCO:b.banco || '',
        PC:b.pc_codigo,
        OFICINA_ID:b.oficina_id || '',
        ACTIVA:(b.activa===true || String(b.activa).toLowerCase()==='true')?'SI':'NO',
        SELECCIONADA_MANUAL:(b.seleccionada_manual===true || String(b.seleccionada_manual).toLowerCase()==='true')?'SI':'NO',
        SALDO:saldo,
        CBU_ALIAS:b.cbu_alias || b.alias || b.cbu || '',
        ALIAS:b.alias || '',
        CBU:b.cbu || '',
        TITULAR:b.titular||'',
        CHUNIOR_UID:uid,
        ESTADO:b.estado||''
      };
    });

  if(_descartadas){
    console.warn('[billeteras] se descartaron '+_descartadas+' billeteras de otra oficina (esta es '+_pcAhora+')');
  }

  // Dedup por CHUNIOR_UID: la misma wallet puede venir repetida (multi-oficina / sync).
  // Conserva la primera ocurrencia (la EN PORTAL queda primera por el orden de la query).
  (function(){
    const seen=new Set(); const out=[];
    for(const b of billeteras){
      const k=String(b.CHUNIOR_UID||'').trim();
      if(k){ if(seen.has(k)) continue; seen.add(k); }
      out.push(b);
    }
    billeteras=out;
  })();

  if(render)renderBilleteras();
  renderInicio();
}

async function cargarChats(silencioso=false){
  // ⛔ INERTE. Consultaba la tabla "chats", que NO EXISTE en la base: cada llamada
  // terminaba en un 404 que el `if(error) return` se tragaba en silencio, así que
  // renderChatList/renderInicio de acá abajo nunca corrían.
  //
  // Con el temporizador de 4,5 s eran ~19.200 pedidos fallidos por día en cada PC —
  // unos 134.000 diarios entre las siete— sin que nadie lo notara.
  //
  // El chat de verdad son las solicitudes tipo SOPORTE (metadata.chat_thread), y las
  // trae otro camino. renderInicio() tiene once llamadores más, así que la pantalla
  // se refresca igual. Se deja la función (hay ~12 callers) y se saca el temporizador.
  return;
  /* eslint-disable no-unreachable */
  const {data,error}=await supabaseClient
    .from("chats")
    .select("*")
    .eq("pc_codigo",pcOperativa)
    .order("fecha_ultimo",{ascending:false});

  if(error){return}

  chats=(data||[]).map(c=>({
    ID_CHAT:c.id,
    USUARIO:c.usuario,
    NOMBRE_COMPLETO:c.nombre_completo||"",
    TELEFONO:c.telefono||"",
    SOLICITUD_ID:c.solicitud_id||"",
    SIN_LEER:c.sin_leer||0,
    ULTIMO_MENSAJE:c.ultimo_mensaje||"",
    FECHA_ULTIMO:c.fecha_ultimo||c.created_at,
    FECHA:c.fecha_ultimo||c.created_at
  }));

  renderChatList();
  renderInicio();
  verificarChats(silencioso);
}
function renderInicio(){
  const fuentePortal = (window.V154P && Array.isArray(window.V154P.solicitudes) && window.V154P.solicitudes.length)
    ? window.V154P.solicitudes
    : solicitudes;
  const portalPendientes = fuentePortal.filter(function(s){ return esPendiente(s) && String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='SOPORTE'; });
  // Sólo lo que nadie tomó: lo tomado vive en 💸 En proceso. Si el portal todavía no cargó, queda
  // la cuenta de siempre (mejor un número de más que ninguno).
  const pendientes = window.nodoSolicitudesSinTocar ? window.nodoSolicitudesSinTocar(portalPendientes) : portalPendientes;
  const retiros=pendientes.filter(s=>normalizar(s.TIPO_SOLICITUD||s.TIPO)==="RETIRO");
  // Mismo significado que el badge: mensajes pendientes, no chats en espera.
  const unread=window.nodoChatUnreadSnapshot?.().total || 0;
  const bil=billeteras.find(b=>normalizar(b.SELECCIONADA_MANUAL)==="SI") || billeteras.find(b=>normalizar(b.ACTIVA)==="SI") || {};
  setBox("statPendientes",pendientes.length);
  setBox("statRetiros","Retiros: "+retiros.length);
  window.nodoChatRefreshUnread?.();
  setBox("statBilletera",bil.NOMBRE_VISIBLE||bil.BILLETERA_NOMBRE||"-");
  setBox("statBilleteraTipo",bil.TIPO?(bil.TIPO+" · "+(bil.PC||pcOperativa)):"-");
  setBox("alertas",
    (pendientes.length?'<div class="alert-box">🔔 Hay '+pendientes.length+' solicitud/es pendiente/s.</div>':"")+
    (unread?'<div class="alert-box">💬 Hay '+unread+' mensaje/s de chat sin leer.</div>':"")
  );
  const inicioLista = pendientes.length ? pendientes.slice(0,8) : fuentePortal.slice(0,8);
  // SAFE: si el bridge Portal V15.4 está activo, la caja de inicio la renderiza
  // una sola función dedicada para evitar parpadeos entre render legacy y portal.
  const portalOwner = !!(window.V154P && window.V154P.portalBridgeReady);
  if(!portalOwner){
    setBox("tablaSolicitudesInicio", inicioLista.length
      ? tablaSolicitudesHTML(inicioLista)
      : '<div class="alert-box">No hay solicitudes Portal para mostrar.</div>');
  }
  renderFichasInicio();
  renderBillerasInicio();
  poblarManualBilletera();
  // El historial lo trae el arranque por etapas, después del primer dibujo: si esto lo pedía, salía
  // junto con las solicitudes (y antes del login, para ninguna oficina).
  if(!_historialCargado && (!window.nodoArranqueHabilitado || window.nodoArranqueHabilitado('historial'))) cargarHistorial();
}
// ── Estado de fichas en Inicio ────────────────────────────────────────────────
function renderFichasInicio(extraEstado, extraTexto){
  const card = document.getElementById("statFichasCard");
  const drexEl = document.getElementById("statDrexFichas");
  const chuEl = document.getElementById("statChuniorFichas");
  const diffEl = document.getElementById("statDiffFichas");
  const estadoEl = document.getElementById("statFichasEstado");
  if(!card || !drexEl || !chuEl || !diffEl || !estadoEl) return;
  const drex = (typeof _watchdog !== "undefined") ? _watchdog.drexFichas : null;
  const chu  = (typeof _watchdog !== "undefined") ? _watchdog.chuniorFichas : null;
  const fmt = v => (typeof v === "number" && !isNaN(v)) ? money(v) : "—";
  drexEl.textContent = fmt(drex);
  chuEl.textContent = fmt(chu);
  card.classList.remove("ok","alerta");
  diffEl.classList.remove("ok","alerta");
  if(typeof drex === "number" && typeof chu === "number"){
    const diff = drex - chu;
    const ok = Math.abs(diff) <= 1;
    diffEl.textContent = (diff >= 0 ? "+" : "−") + money(Math.abs(diff));
    diffEl.classList.add(ok ? "ok" : "alerta");
    card.classList.add(ok ? "ok" : "alerta");
    // SIEMPRE mostrar de CUÁNDO es la lectura: sin la hora, una comparación vieja parece una
    // diferencia actual y el operador desconfía del chequeo entero (portado de NexoBetaChan).
    const _horaLect = (typeof _watchdog !== "undefined" && _watchdog.lastCheck)
      ? new Date(_watchdog.lastCheck).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : null;
    estadoEl.textContent = (extraTexto || (ok ? "Sin diferencia" : "Diferencia detectada"))
      + (_horaLect ? " · leído "+_horaLect : "");
    // El botón de explicación aparece SOLO cuando hay algo que explicar. Un botón que está
    // siempre se vuelve parte del decorado y nadie lo toca el día que hace falta.
    try{
      const _bi = document.getElementById("btnInfoDife");
      if(_bi) _bi.style.display = ok ? "none" : "";
    }catch(_e){}

  }else{
    // Sin lectura de los dos saldos no hay diferencia que explicar.
    try{ const _bi = document.getElementById("btnInfoDife"); if(_bi) _bi.style.display = "none"; }catch(_e){}
    diffEl.textContent = "—";
    estadoEl.textContent = extraTexto || "Esperando lectura de saldos";
  }
  if(extraEstado === "alerta") card.classList.add("alerta");
  if(extraEstado === "ok") card.classList.add("ok");
}

// ── Billeteras en Inicio ──────────────────────────────────────────────────────
function renderBillerasInicio(){
  const el = document.getElementById("billerasInicioGrid");
  if(!el) return;
  const lista = (billeteras||[]).filter(function(b){
    return normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA';
  });
  if(!lista.length){
    // Recién elegido el puesto las billeteras llegan después de las solicitudes: mientras tanto no
    // se dice que no hay.
    const _cargando = typeof window.nodoBilleterasCargando === 'function' && window.nodoBilleterasCargando();
    el.innerHTML = '<div class="small" style="color:var(--muted);padding:8px">'+(_cargando ? 'Cargando billeteras…' : 'Sin billeteras operativas para esta oficina.')+'</div>';
    renderEstadoLanding();
    return;
  }
  const difsMap={}; try{ (window.__bilDifs||[]).forEach(function(d){ difsMap[String(d.id)]=d; }); }catch(_e){}
  // ── Espejo de Chunior ────────────────────────────────────────────────────────────────────
  // Chunior es la verdad del saldo, así que el Inicio muestra su número y su orden, no lo que
  // quedó guardado en la base (que se atrasa) ni el alfabético del RPC. Los dos mapas los llena
  // la lectura del breadcrumb (sincronizarBilleterasChunior + _leerSaldosChuniorPasivo).
  const _saldosCh = window.__nodoChuniorWalletSaldoByUid || {};
  const _ordenCh  = window.__nodoChuniorOrdenUids || [];
  if(_ordenCh.length){
    const _pos = {}; _ordenCh.forEach(function(u,i){ _pos[String(u)] = i; });
    lista.sort(function(a,b){
      const pa=_pos[String(a.CHUNIOR_UID||'')], pb=_pos[String(b.CHUNIOR_UID||'')];
      if(pa===undefined && pb===undefined) return 0;
      if(pa===undefined) return 1;          // las que Chunior no lista van al final
      if(pb===undefined) return -1;
      return pa-pb;
    });
  }
  el.innerHTML = lista.map(function(b){
    const enLanding = normalizar(b.SELECCIONADA_MANUAL)==="SI";
    const _uid = String(b.CHUNIOR_UID||'');
    const saldo = (_uid && _saldosCh[_uid]!==undefined) ? Number(_saldosCh[_uid]) : Number(b.SALDO||0);
    const neg = saldo < 0;
    const tipo = b.TIPO || b.BANCO || (b.CHUNIOR_UID ? 'Chunior' : '—');
    const subt = (enLanding ? 'EN PORTAL · ' : '') + tipo;
    const nombreMostrar = b.NOMBRE_CHUNIOR || b.NOMBRE_VISIBLE || b.BILLETERA_NOMBRE || '—';
    const dif = difsMap[String(b.ID_BILLETERA)];
    const difHtml = dif ? '<div class="bil-mini-dif">⚠ dif '+(dif.diff>0?'+':'')+money(dif.diff)+'</div>' : '';
    const difTitle = dif ? ' · ⚠ Chunior '+money(dif.actual)+' vs esperado '+money(dif.esperado)+' (dif '+(dif.diff>0?'+':'')+money(dif.diff)+') — ¿faltó anotar una operación?' : '';
    return '<div class="bil-mini-card'+(enLanding?' en-landing':'')+(dif?' bil-mini-dif-on':'')+(neg?' bil-card-neg':'')+'" title="'+escapeHtml(nombreMostrar+' · '+money(saldo)+difTitle)+'">'+
      (enLanding?'<span class="bil-landing-badge">LANDING</span>':'')+
      '<div class="bil-mini-nombre">'+escapeHtml(nombreMostrar)+'</div>'+
      '<div class="bil-mini-tipo">'+escapeHtml(subt)+'</div>'+
      '<div class="bil-mini-saldo'+(neg?' bil-neg':'')+'">'+money(saldo)+'</div>'+
      difHtml+
      '</div>';
  }).join('');
  renderEstadoLanding();
}

function poblarManualBilletera(){
  const sel = document.getElementById("manualBilletera");
  if(!sel) return;
  const cur = sel.value;
  const bil = getBilleraLanding();
  const defaultId = cur || (bil ? bil.ID_BILLETERA : '');
  const lista = (billeteras||[]).filter(function(b){
    return normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA';
  });
  sel.innerHTML = lista.map(function(b){
    const selected = String(b.ID_BILLETERA)===String(defaultId);
    const tipo = b.TIPO ? ' · '+b.TIPO : '';
    const nombreMostrar = b.NOMBRE_CHUNIOR || b.NOMBRE_VISIBLE || '—';
    return '<option value="'+b.ID_BILLETERA+'"'+(selected?' selected':'')+'>'+escapeHtml(nombreMostrar)+' — '+money(b.SALDO||0)+escapeHtml(tipo)+'</option>';
  }).join('') || '<option value="">Sin billeteras</option>';
}

// ── Solo consultar saldo ──────────────────────────────────────────────────────
