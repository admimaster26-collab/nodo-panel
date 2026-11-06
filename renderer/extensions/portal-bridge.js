/* Portal composition root. Domain modules receive explicit dependencies; only this adapter
   reads legacy lexical variables and installs the existing HTML event handlers. */
(function(){
  'use strict';
  const V154P = {
    solicitudes: [], chats: [], chatMensajes: [], chatActual: null, pcActual: null,
    portalBridgeReady: true, solicitudesLoading: false, solicitudesQueued: false,
    solicitudesLastHtml: '', solicitudesLastRenderAt: 0
  };
  window.V154P = V154P;
  const withdrawalState = { current: null };
  Object.defineProperty(window, '_retiroV2', {
    configurable: true, get: () => withdrawalState.current,
    set: value => { withdrawalState.current = value; }
  });
  const deps = {
    window, document, localStorage, V154P, withdrawalState,
    get _autoregistrarUsuarioSiFalta(){ return typeof _autoregistrarUsuarioSiFalta === 'undefined' ? undefined : _autoregistrarUsuarioSiFalta; },
    get _drexGlobalLock(){ return typeof _drexGlobalLock === 'undefined' ? undefined : _drexGlobalLock; },
    get _drexGlobalUnlock(){ return typeof _drexGlobalUnlock === 'undefined' ? undefined : _drexGlobalUnlock; },
    get _historialData(){ return typeof _historialData === 'undefined' ? undefined : _historialData; },
    get _rv2Finalizar(){ return window._rv2Finalizar; },
    get _trazaFin(){ return typeof _trazaFin !== 'undefined' ? _trazaFin : window._trazaFin; },
    get _trazaInit(){ return typeof _trazaInit !== 'undefined' ? _trazaInit : window._trazaInit; },
    get _trazaPaso(){ return typeof _trazaPaso !== 'undefined' ? _trazaPaso : window._trazaPaso; },
    get _v154pAvisoDesfasaje(){ return window._v154pAvisoDesfasaje; },
    get _watchdogTrigger(){ return typeof _watchdogTrigger === 'undefined' ? undefined : _watchdogTrigger; },
    get _wdForceUnlock(){ return typeof _wdForceUnlock === 'undefined' ? undefined : _wdForceUnlock; },
    get _wdLock(){ return typeof _wdLock === 'undefined' ? undefined : _wdLock; },
    get _wdUnlock(){ return typeof _wdUnlock === 'undefined' ? undefined : _wdUnlock; },
    get abrirModal(){ return typeof abrirModal === 'undefined' ? undefined : abrirModal; },
    get abrirModalRetiroV2(){ return window.abrirModalRetiroV2; },
    get ajustarSaldoBilletera(){ return typeof ajustarSaldoBilletera === 'undefined' ? undefined : ajustarSaldoBilletera; },
    get alert(){ return typeof alert === 'undefined' ? undefined : alert; },
    get billeteras(){ return typeof billeteras === 'undefined' ? undefined : billeteras; },
    get callDrex(){ return typeof callDrex === 'undefined' ? undefined : callDrex; },
    get cargarBilleteras(){ return typeof cargarBilleteras === 'undefined' ? undefined : cargarBilleteras; },
    get cargarHistorial(){ return typeof cargarHistorial === 'undefined' ? undefined : cargarHistorial; },
    get cerrarExpedienteSolicitud(){ return window.cerrarExpedienteSolicitud; },
    set cerrarExpedienteSolicitud(value){ window.cerrarExpedienteSolicitud = value; },
    get cerrarModal(){ return typeof cerrarModal === 'undefined' ? undefined : cerrarModal; },
    get cerrarPortalJobModal(){ return window.cerrarPortalJobModal; },
    get cerrarRetiroV2(){ return window.cerrarRetiroV2; },
    get chats(){ return typeof chats === 'undefined' ? undefined : chats; },
    set chats(value){ chats = value; },
    get colaPendientesAdd(){ return typeof colaPendientesAdd === 'undefined' ? undefined : colaPendientesAdd; },
    get confirm(){ return typeof confirm === 'undefined' ? undefined : confirm; },
    get confirmarRetiroDuplicado(){ return typeof confirmarRetiroDuplicado === 'undefined' ? undefined : confirmarRetiroDuplicado; },
    get ensureDrexSession(){ return typeof ensureDrexSession === 'undefined' ? undefined : ensureDrexSession; },
    get escapeHtml(){ return typeof escapeHtml === 'undefined' ? undefined : escapeHtml; },
    fetch: window.fetch.bind(window),
    get getBilleraLanding(){ return typeof getBilleraLanding === 'undefined' ? undefined : getBilleraLanding; },
    get normalizar(){ return typeof normalizar === 'undefined' ? undefined : normalizar; },
    get notificarUsuarioEnChat(){ return typeof notificarUsuarioEnChat === 'undefined' ? undefined : notificarUsuarioEnChat; },
    get operador(){ return typeof operador === 'undefined' ? undefined : operador; },
    get pcAliasesHist(){ return typeof pcAliasesHist === 'undefined' ? undefined : pcAliasesHist; },
    get pcOperativa(){ return typeof pcOperativa === 'undefined' ? undefined : pcOperativa; },
    get poblarManualBilletera(){ return typeof poblarManualBilletera === 'undefined' ? undefined : poblarManualBilletera; },
    get portalCheckDiferencia(){ return window.portalCheckDiferencia; },
    get recomendarRepartoRetiro(){ return window.recomendarRepartoRetiro; },
    get refreshAgent(){ return typeof refreshAgent === 'undefined' ? undefined : refreshAgent; },
    get registrarCargaEnChunior(){ return typeof registrarCargaEnChunior === 'undefined' ? undefined : registrarCargaEnChunior; },
    get registrarEnHistorial(){ return typeof registrarEnHistorial === 'undefined' ? undefined : registrarEnHistorial; },
    get registrarRetiroEnChunior(){ return typeof registrarRetiroEnChunior === 'undefined' ? undefined : registrarRetiroEnChunior; },
    get renderBillerasInicio(){ return typeof renderBillerasInicio === 'undefined' ? undefined : renderBillerasInicio; },
    get renderChatList(){ return typeof renderChatList === 'undefined' ? undefined : renderChatList; },
    get renderChatMensajes(){ return typeof renderChatMensajes === 'undefined' ? undefined : renderChatMensajes; },
    get renderHistorialUnificado(){ return typeof renderHistorialUnificado === 'undefined' ? undefined : renderHistorialUnificado; },
    get renderInicio(){ return typeof renderInicio === 'undefined' ? undefined : renderInicio; },
    setTimeout: window.setTimeout.bind(window),
    get sincronizarBilleterasChunior(){ return typeof sincronizarBilleterasChunior === 'undefined' ? undefined : sincronizarBilleterasChunior; },
    get solicitudes(){ return typeof solicitudes === 'undefined' ? undefined : solicitudes; },
    set solicitudes(value){ solicitudes = value; },
    get supabaseClient(){ return typeof supabaseClient === 'undefined' ? undefined : supabaseClient; },
    get toast(){ return typeof toast === 'undefined' ? undefined : toast; },
    get v154pRegistrarParcial(){ return window.v154pRegistrarParcial; },
    get v15RenderChatList(){ return typeof v15RenderChatList === 'undefined' ? undefined : v15RenderChatList; },
    get v15RenderChatMensajes(){ return typeof v15RenderChatMensajes === 'undefined' ? undefined : v15RenderChatMensajes; },
    get verificarRetiro24h(){ return typeof verificarRetiro24h === 'undefined' ? undefined : verificarRetiro24h; },
    get verificarSolicitudes(){ return typeof verificarSolicitudes === 'undefined' ? undefined : verificarSolicitudes; },
  };
  function mount(factory){
    const { globals, ...service } = factory.create(deps);
    Object.assign(deps, service);
    Object.assign(window, globals);
    return service;
  }
  const data = mount(window.NodoPortalData);
  const withdrawalAlerts = mount(window.NodoPortalWithdrawalAlerts);
  const requestsView = mount(window.NodoPortalRequestsView);
  const requests = mount(window.NodoPortalRequests);
  const rejections = mount(window.NodoPortalRejections);
  const withdrawalsView = mount(window.NodoPortalWithdrawalsView);
  const withdrawalsExecution = mount(window.NodoPortalWithdrawalsExecution);
  const operationModal = mount(window.NodoPortalOperationModal);
  const operationExecution = mount(window.NodoPortalOperationExecution);
  const chat = mount(window.NodoPortalChat);

  // Keep the public compatibility names used by HTML and later extensions.
  window.cargarSolicitudesPortal = requests.cargarSolicitudesPortal;
  window.v154pCargarSolicitudes = requests.cargarSolicitudesPortal;
  window.actualizarSolicitudPortal = requests.actualizarSolicitudPortal;
  window.v154pRenderSolicitudesPortalEnInicio = requestsView.renderSolicitudesPortalEnInicio;
  window.v154pRenderSolicitudesPortalCompleto = requestsView.renderSolicitudesPortalCompleto;
  // Tomar saca la solicitud de pendientes y la manda a 💸 En proceso. Se mueve YA —no a los segundos
  // del próximo refresco— y se avisa adónde fue: si la tarjeta desaparece sin decir nada parece que
  // algo se rompió.
  function _estadoLocal(id, estado){
    try{
      const s = (V154P.solicitudes || []).find(x => Number(x.ID || x.SOLICITUD_ID) === Number(id));
      if(!s) return;
      s.ESTADO = estado;
      const op = window.operador && (window.operador.usuario || window.operador.nombre);
      if(op && estado !== 'PENDIENTE') s.OPERADOR = op;
      requestsView.renderSolicitudesPortalEnInicio();
    }catch(_e){}
  }
  window.v154pTomarSolicitud = async function(id){
    const r = await requests.actualizarSolicitudPortal(id, 'EN_REVISION', { etapa: 'TOMADA_PANEL_V15_4_PLUS' });
    if(r && !r.error){
      _estadoLocal(id, 'EN_REVISION');
      try{ deps.toast('Tomada ✓ · la encontrás en 💸 En proceso', 'green'); }catch(_e){}
    }
    return r;
  };
  // Tomada por error, o el que la tomó se fue: vuelve a la lista de pendientes para que otro la agarre.
  window.v154pSoltarSolicitud = async function(id){
    const r = await requests.actualizarSolicitudPortal(id, 'PENDIENTE', { etapa: 'SOLTADA_PANEL' });
    if(r && !r.error){
      _estadoLocal(id, 'PENDIENTE');
      try{ if(window.cerrarExpedienteSolicitud) window.cerrarExpedienteSolicitud(); }catch(_e){}
      try{ deps.toast('Soltada · volvió a la lista de pendientes', 'blue'); }catch(_e){}
    }
    return r;
  };
  window.v154pDetalleSolicitud = operationModal.abrirExpedienteSolicitud;
  window.abrirExpedienteSolicitud = operationModal.abrirExpedienteSolicitud;
  window.mostrarExpedienteEnPane = operationModal.mostrarExpedienteEnPane || window.mostrarExpedienteEnPane;
  window.construirDossierCompletoHtml = operationModal.construirDossierCompletoHtml || window.construirDossierCompletoHtml;
  window.clasificarRechazo = rejections.clasificarRechazo;
  window.cargarSolicitudes = requests.cargarSolicitudesPortal;
  window.cargarChats = chat.cargarChatsPortal;
  window.cargarChatActual = chat.cargarChatPortalActual;
  window._v154pCargarChat = chat.cargarChatPortalActual;
  window.enviarChat = chat.enviarChatPortal;
  window.abrirChat = async function(id){
    window.chatActualId = String(id);
    V154P.chatActual = String(id);
    try{ if(typeof deps.renderChatList === 'function') deps.renderChatList(); }catch(_e){}
    return chat.cargarChatPortalActual(false);
  };
  window.v15CargarChatsCompacto = chat.cargarChatsPortal;
  window.v15AbrirChatCompacto = async function(id){
    window.v15ChatActualId = String(id);
    window.chatActualId = String(id);
    V154P.chatActual = String(id);
    return chat.cargarChatPortalActual(false);
  };
  window.v15EnviarChatCompacto = chat.enviarChatPortal;
  // La que pide la lista de chats al servidor. window.cargarChats la pisan más adelante con un
  // repintado (chat-hilos.js), así que el reloj del panel llama a ésta por su nombre.
  window.nodoCargarChatsPortal = chat.cargarChatsPortal;

  // Acá había un reloj propio: solicitudes a los 0,8 s y cada 60 s, chats a los 1,2 s y cada 15 s,
  // la conversación abierta cada 5 s. Arrancaba con la página, antes del login, y pedía para la
  // oficina de la sesión anterior o para P1. Después del login repetía lo que ya pide NodoRealtime
  // (login-y-realtime.js), que ahora es el único dueño de esas lecturas (Juan, 6/11).

  // El pago parcial lee las billeteras en el momento. Si el operador lo abre recién elegido el
  // puesto, antes de que lleguen, se esperan en vez de mostrar el cartel sin billeteras.
  const _abrirModalRetiroV2 = window.abrirModalRetiroV2;
  if(typeof _abrirModalRetiroV2 === 'function') window.abrirModalRetiroV2 = function(id, opts){
    const espera = typeof window.nodoAsegurarBilleteras === 'function' ? window.nodoAsegurarBilleteras() : null;
    if(espera) return espera.then(() => _abrirModalRetiroV2.call(this, id, opts));
    return _abrirModalRetiroV2.call(this, id, opts);
  };
})();


/* ============================================================
   PATCH 03 SAFE · rescate de inputs manuales
   Mantiene Usuario/Monto/Billetera editables aunque un render anterior
   haya dejado atributos disabled/readonly o haya capturado foco.
   No ejecuta operaciones y no modifica el motor blindado.
   ============================================================ */
(function(){
  function repararInputsOperacionManual(){
    try{
      var ids = ['manualUsuario','manualMonto','manualBilletera'];
      ids.forEach(function(id){
        var el = document.getElementById(id);
        if(!el) return;
        el.disabled = false;
        el.readOnly = false;
        el.removeAttribute('disabled');
        el.removeAttribute('readonly');
        el.style.pointerEvents = 'auto';
        el.style.webkitUserSelect = 'text';
        el.style.userSelect = 'text';
        el.style.webkitAppRegion = 'no-drag';
      });
      var card = document.getElementById('cardOperacionManual');
      if(card){
        card.style.pointerEvents = 'auto';
        card.style.webkitAppRegion = 'no-drag';
      }
    }catch(_e){}
  }

  function instalarFocoManual(){
    try{
      ['manualUsuario','manualMonto'].forEach(function(id){
        var el = document.getElementById(id);
        if(!el || el.__nodoManualFocusFix) return;
        el.__nodoManualFocusFix = true;
        el.setAttribute('autocomplete','off');
        el.addEventListener('mousedown', function(ev){ ev.stopPropagation(); repararInputsOperacionManual(); }, true);
        el.addEventListener('click', function(ev){ ev.stopPropagation(); repararInputsOperacionManual(); try{ el.focus(); }catch(_e){} }, true);
        el.addEventListener('focus', repararInputsOperacionManual, true);
      });
    }catch(_e){}
  }

  window.repararInputsOperacionManual = repararInputsOperacionManual;

  function start(){
    repararInputsOperacionManual();
    instalarFocoManual();
    setInterval(function(){
      // Con la tarjeta fuera de la vista no hay nada que reparar: al tocar un campo se repara igual.
      if(window.nodoSeVe && !window.nodoSeVe(document.getElementById('cardOperacionManual'))) return;
      repararInputsOperacionManual();
      instalarFocoManual();
    }, 2500);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

