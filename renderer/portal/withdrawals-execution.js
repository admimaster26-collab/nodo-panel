/* Portal: withdrawals-execution. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalWithdrawalsExecution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["_drexGlobalLock","_drexGlobalUnlock","_rv2ActualizarBotonAprobar","_rv2BilsUsables","_rv2Finalizar","_rv2Modal","_rv2PintarVeredicto","_rv2Render","_rv2TotalSel","_trazaFin","_trazaInit","_trazaPaso","_wdLock","_wdUnlock","ajustarSaldoBilletera","alert","callDrex","cargarHistorial","cargarSolicitudesPortal","cerrarExpedienteSolicitud","cerrarPortalJobModal","cerrarRetiroV2","confirm","document","ensureDrexSession","escapeHtml","fetch","localStorage","money","notificarUsuarioEnChat","pcOperativa","registrarEnHistorial","registrarRetiroEnChunior","renderBillerasInicio","setTimeout","sincronizarBilleterasChunior","supabaseClient","toast","window"]);
  function create(deps){
const api = {};
async function notificarRetiroParcialPortal(solicitudId, montoPago, pagadoAcum, restante, montoTotal, saldoPost, desde){
  // El semáforo marcaba OK antes de llamar a la base: un parcial sin registrar se veía en verde.
  const _salud = deps.window.NodoSalud?.begin('RETIROS');
  const _marca = function(estado, codigo, duracion){ try{ _salud?.record('EFFECT', estado, codigo, duracion); }catch(_e){} };
  const _dato = function(estado,codigo,duracion){
    const lento=estado==='OK'&&duracion>3000;
    try{ _salud?.record('DATA',lento?'DEGRADED':estado,lento?'RETIRO_RPC_LENTO':codigo,duracion); }catch(_e){}
  };
  if(!deps.window.panelAPI || !deps.window.panelAPI.rpc || !solicitudId){ _marca('ERROR','RETIRO_PARCIAL_SIN_CLIENTE',0); return { ok:false, detail:'sin panelAPI/id' }; }
  const op = (deps.window.operador && (deps.window.operador.usuario||deps.window.operador.nombre)) || 'panel';
  const sid = Number(solicitudId);
  const formas = [
    // Firma REAL (verificada contra Supabase y usada por el camino original del panel):
    //   landing_retiro_registrar_parcial(p_id, p_monto_parcial, p_operador)
    // Las A/B/C eran conjeturas y NINGUNA coincidía → el parcial se pagaba pero nunca se
    // registraba el progreso. Va primera.
    // Con DESDE qué billetera salió (D-90): el portal le dice al jugador "te transfirió X". Si la
    // base no conociera p_desde devuelve error de firma y se prueba la de abajo, sin él: el pago
    // nunca queda sin registrar por el orden en que se publica cada cosa.
    { k:'ND', p:{ p_id:sid, p_monto_parcial:Number(montoPago)||0, p_operador:op,
                  p_saldo_post:(saldoPost!=null?Number(saldoPost):null), p_desde:(String(desde||'').trim()||null) } },
    { k:'N', p:{ p_id:sid, p_monto_parcial:Number(montoPago)||0, p_operador:op,
                 p_saldo_post:(saldoPost!=null?Number(saldoPost):null) } },
    { k:'A', p:{ p_solicitud_id:sid, p_monto_pagado:Number(pagadoAcum)||0, p_monto_restante:Number(restante)||0, p_monto_total:Number(montoTotal)||0, p_operador:op } },
    { k:'B', p:{ p_solicitud_id:sid, p_monto:Number(montoPago)||0, p_operador:op } },
    { k:'C', p:{ p_solicitud_id:sid, p_monto:Number(montoPago)||0 } }
  ];
  // La firma real va siempre primero. Un error de transporte puede llegar después
  // de confirmar el pago en la base: jamás se prueba otra firma en ese caso.
  for(const f of formas){
    let r;const _inicio=Date.now();
    try{
      r = await deps.window.panelAPI.rpc('landing_retiro_registrar_parcial', f.p);
    }catch(e){
      const detail = String(e.message || e);
      console.warn('[retiro-parcial-portal] resultado incierto; no se reintenta:', detail);
      const duracion=Math.max(0,Date.now()-_inicio);
      try{ _salud?.reply(e,duracion); }catch(_e){}
      _marca('DEGRADED','RETIRO_PARCIAL_INCIERTO',duracion);
      return { ok:false, uncertain:true, detail };
    }
    const _duracion=Math.max(0,Date.now()-_inicio);
    if(!r){
      try{ _salud?.reply({code:'NETWORK'},_duracion); }catch(_e){}
      _marca('DEGRADED','RETIRO_PARCIAL_INCIERTO',_duracion);
      return { ok:false, uncertain:true, detail:'sin respuesta al registrar el parcial' };
    }
    try{ _salud?.reply(r.error||null,_duracion); }catch(_e){}
    if(!r.error){
      let _datoRpc=Array.isArray(r.data)?r.data[0]:r.data;
      if(typeof _datoRpc==='string'){try{_datoRpc=JSON.parse(_datoRpc);}catch(_e){_datoRpc=null;}}
      const _pagadoRpc=Number(_datoRpc&&_datoRpc.pagado);
      if(!_datoRpc||typeof _datoRpc!=='object'||_datoRpc.ok!==true||!Number.isFinite(_pagadoRpc)
          ||_pagadoRpc<Number(pagadoAcum)-0.5){
        _dato('DEGRADED','RETIRO_PARCIAL_RESPUESTA_INVALIDA',_duracion);
        _marca('DEGRADED','RETIRO_PARCIAL_INCIERTO',_duracion);
        return { ok:false, uncertain:true, detail:'el servidor no confirmó el acumulado del retiro' };
      }
      // Guardar una preferencia local no forma parte de la transacción. Si falla,
      // el pago sigue confirmado y no debe enviarse otra vez.
      try{ deps.localStorage.setItem('nodo_rpc_parcial_shape', f.k); }catch(_e){}
      // Se devuelve lo que contestó la base: con eso el que llama comprueba que el pago ENTRÓ.
      _dato('OK','RETIRO_PARCIAL_RESPUESTA_CONFIRMADA',_duracion);
      _marca('OK','RETIRO_PARCIAL_CONFIRMADO',_duracion);
      return { ok:true, detail:'forma '+f.k, data:(r && r.data) || null };
    }
    const msg = String(r.error.message||'');
    const esFirma = /PGRST202|Could not find the function|function .* does not exist/i.test(
      String(r.error.code||'')+' '+msg+' '+String(r.error.details||''));
    if(!esFirma){ _marca('ERROR','RETIRO_PARCIAL_RECHAZADO',_duracion); return { ok:false, detail:msg }; }
  }
  _marca('ERROR','RETIRO_PARCIAL_SIN_FIRMA',0);
  return { ok:false, detail:'ninguna firma coincidió — mirá el hint en consola y avisá para ajustarla' };
}
api.notificarRetiroParcialPortal = notificarRetiroParcialPortal;

// Las fichas del modal salen de la misma lectura que "Ver" y la tarjeta de la lista: espera al agente
// si está ocupado y deja el resultado donde lo lee el resto del panel. Antes este modal tenía su
// propia copia y fallaba distinto que todo lo demás.
async function _rv2LeerSaldo(){
  const st = deps.withdrawalState.current; if(!st) return;
  const pintar=function(){ try{ deps._rv2PintarVeredicto(); deps._rv2ActualizarBotonAprobar(); }catch(_e){} };
  st.saldoFallo = null; pintar();
  let r = null;
  try{ r = await deps.window.revisarFichasRetiro({ usuario:st.usuario, monto:st.objetivo||st.declarado, forzar:true }); }
  catch(_e){}
  if(deps.withdrawalState.current!==st) return;
  // Sólo se cree un saldo LEÍDO de verdad: un 0 por sesión caída decía "NO TIENE FICHAS" con el
  // jugador teniendo $35.020.
  if(r && r.confiable===true){ st.saldoReal = r.saldo; st.saldoFallo = null; }
  else { st.saldoFallo = (r && r.motivo) || 'ilegible'; }
  pintar();
}
// Botón "Reintentar" del cotejo de fichas. Con la sesión caída, primero se entra de nuevo.
api._rv2ReleerFichas = async function(){
  const st = deps.withdrawalState.current; if(!st) return;
  if(st.saldoFallo==='sesion'){
    let ok = false; try{ ok = await deps.ensureDrexSession(); }catch(_e){}
    if(!ok || deps.withdrawalState.current!==st) return;
  }
  await _rv2LeerSaldo();
};

// APROBAR: valida, extrae las fichas UPFRONT (para que no se las jueguen) y pasa a
// la fase de confirmar cada transferencia.
api._rv2Aprobar = async function(){
  const st = deps.withdrawalState.current; if(!st) return;
  const total = deps._rv2TotalSel();
  const seleccionadas = deps._rv2BilsUsables()
    .filter(function(b){ return st.sel[String(b.ID_BILLETERA)] && Number(st.montos[String(b.ID_BILLETERA)])>0; })
    .map(function(b){ return { id:String(b.ID_BILLETERA), nombre:b.NOMBRE_VISIBLE||'—', titular:String(b.TITULAR||'').trim(), chunior:b.CHUNIOR_UID, saldo:Number(b.SALDO||0), monto:Number(st.montos[String(b.ID_BILLETERA)]||0) }; });
  if(!seleccionadas.length){ deps.toast('Tildá al menos una billetera con monto.','red'); return; }
  if(total<=0){ deps.toast('El total a pagar es 0.','red'); return; }
  // Se compara contra LO QUE FALTA de la deuda (totalReal − yaPagado), igual que el botón. Antes
  // comparaba contra st.objetivo, que es un valor que se lee al abrir el modal y puede venir del
  // metadata podrido: el botón te habilitaba y esta validación te rechazaba con "supera el monto
  // real ($200.000)" cuando en pantalla decía claramente que faltaban $250.000. Y no corta el
  // flujo: pagar de más se pregunta, no se prohíbe — el que sabe cuánto se debe es el operador.
  // Pagar de más ya NO se frena con un confirm: el modal lo avisa en rojo ("te pasaste") y el botón
  // dice cuánto de más. El que sabe cuánto se debe es el operador (Juan, 12/09).
  for(const b of seleccionadas){ if(b.monto > b.saldo+0.5){ deps.toast(b.nombre+' no tiene '+deps.money(b.monto)+' (saldo '+deps.money(b.saldo)+').','red'); return; } }
  // Chequeo de fichas. Si no se pudo leer al abrir el modal, se intenta AHORA — antes se salteaba
  // en silencio (la condición pedía saldoReal!=null) y el retiro salía sin verificar nada.
  if(st.saldoReal==null){
    deps.toast('Leyendo las fichas de '+st.usuario+' antes de pagar…','blue');
    try{ await _rv2LeerSaldo(); }catch(_e){}
    // Se cayó la sesión (PCs con poca actividad): se abre el login y, al entrar, se vuelve a leer
    // y se sigue. Antes decía "reabrí el retiro" y había que arrancar todo de nuevo.
    if(st.saldoReal==null && st.saldoFallo==='sesion'){
      deps.toast('Se cayó la sesión de Agentes · entrá y sigo con el retiro','yellow');
      let _okSes = false; try{ _okSes = await deps.ensureDrexSession(); }catch(_e){}
      if(!_okSes || deps.withdrawalState.current!==st) return;
      try{ await _rv2LeerSaldo(); }catch(_e){}
    }
  }
  if(st.saldoReal==null){
    if(!deps.confirm('No se pudieron leer las fichas de '+st.usuario+'.\n\nSi seguís, el retiro sale A CIEGAS: no sabemos si tiene el saldo.\n\n¿Continuar igual?')) return;
  } else if(total > Math.floor(Number(st.saldoReal) + 1e-9) + 0.001){
    // Contra las fichas ENTERAS: Agentes no retira centavos.
    if(!deps.confirm('El usuario tiene '+deps.money(st.saldoReal)+' de fichas (como mucho se le pueden sacar '+deps.money(Math.floor(Number(st.saldoReal)+1e-9))+') y vas a retirar '+deps.money(total)+'. ¿Seguir igual?')) return;
  }
  st.obs = (deps.document.getElementById('rv2Obs')?deps.document.getElementById('rv2Obs').value:'').trim();
  st.pagar = seleccionadas; st.totalPagar = total;

  // El botón ya dice "Pagar $X ahora · quedan $Y": esa ES la confirmación. Antes había además un
  // tilde "confirmo retiro parcial" que sólo repetía lo que el operador acababa de armar a mano.
  const esParcial = total < st.objetivo - 0.5;
  // En modo parcial explícito no se pide confirmar que es parcial: ya se eligió ese camino.
  if(esParcial && !st.parcialAceptado && !st.modoParcial){
    deps.toast('Tildá "Confirmo retiro PARCIAL" para continuar (o completá el monto).','yellow');
    try{ const t=deps.document.getElementById('rv2Total'); if(t){ t.style.outline='2px solid #f5c518'; deps.setTimeout(function(){ t.style.outline=''; },1500); t.scrollIntoView({block:'center'}); } }catch(_e){}
    return;
  }
  // (Acá había un confirm "el retiro queda COMPLETO, no parcial" que frenaba el pago del resto de un
  //  parcial — la única forma de cerrarlo. Queda el aviso visible del modal; el operador decide.)
  const confirmarCada = !!(deps.document.getElementById('rv2ConfCada') && deps.document.getElementById('rv2ConfCada').checked);
  // Un pago a la vez: el modal queda abierto mientras se busca al usuario y un segundo clic pagaba dos veces.
  if(st._pagando) return;

  // Sólo la solicitud beta marcada por el servidor usa el nuevo control. Las solicitudes
  // antiguas/manuales siguen su recorrido; una beta sin consumidor no llega a retirar fichas.
  let _retiroInstrumento = null;
  try{
    const _meta = st.metadata || (st.solicitud && (st.solicitud.METADATA || st.solicitud.metadata)) || {};
    _retiroInstrumento = typeof _meta === 'string' ? JSON.parse(_meta).retiro_instrumento_v1 : _meta.retiro_instrumento_v1;
  }catch(_e){ _retiroInstrumento = null; }
  if(st.id && _retiroInstrumento && _retiroInstrumento.instrumento_id){
    if(typeof deps.window.nodoRetiroCuentaValidada !== 'function'){
      try{ deps.window.NodoSalud?.begin('RETIROS')?.record('DATA','ERROR','RETIRO_VALIDADOR_NO_CARGADO'); }catch(_e){}
      deps.toast('No se cargó la validación de cuenta de este retiro. No se movió saldo.','red');
      return;
    }
    st._pagando = true;
    let _cuenta = null;
    try{
      _cuenta = await deps.window.nodoRetiroCuentaValidada(st.id, {
        usuario:st.usuario, monto:total, destino:st.destino || st.cbu, titular:st.titular,
        solicitud:st.solicitud || {metadata:st.metadata}
      });
    }finally{ st._pagando = false; }
    if(!_cuenta || !_cuenta.seguir){
      if(_cuenta && _cuenta.cerrar){ try{ deps.cerrarRetiroV2(); }catch(_e){} }
      return;
    }
    if(deps.withdrawalState.current !== st) return;
  }

  // 1) ANTES de cerrar el modal: candado, sesión y búsqueda. Si algo de esto falla no se movió
  //    plata y el modal queda como estaba para reintentar. Antes se cerraba primero, y cualquier
  //    falla (sesión caída, otra operación en curso) dejaba al operador sin nada: "el retiro
  //    parcial no continúa" (Juan, 12/09).
  if(!deps._drexGlobalLock('rv2-retiro')){ deps.toast('Hay otra operación en curso. Esperá y tocá Pagar de nuevo.','yellow'); return; }
  st._pagando = true;
  const _btn = deps.document.getElementById('rv2BtnAprobar');
  const _btnTxt = _btn ? _btn.textContent : '';
  if(_btn){ _btn.disabled = true; _btn.textContent = 'Buscando a '+st.usuario+' en Agentes…'; }
  deps._wdLock();
  deps._trazaInit('Retiro '+(esParcial?'PARCIAL':'')+' · '+st.usuario+' · '+deps.money(total)+(st.id?(' (sol. #'+st.id+')'):''));
  let fichasOk=false, _cerrado=false;
  try{
    deps._trazaPaso('Abriendo sesión de Agentes...');
    if(!await deps.ensureDrexSession()){
      deps.toast('Sesión de Agentes requerida · no se sacó nada','red');
      deps._trazaPaso('Falta sesión de Agentes','err');
      deps._trazaFin('err');
      return;
    }
    deps._trazaPaso('Sesión de Agentes lista','ok');

    deps._trazaPaso('Buscando '+st.usuario+' en Agentes...');
    let bb = await deps.callDrex('buscarUsuario', st.usuario, { skipBalance:true });
    // Se cayó en el medio: login y se reintenta UNA vez. Todavía no se sacó nada, es seguro.
    if(bb && bb.needsLogin){
      deps._trazaPaso('Se cayó la sesión de Agentes · pidiendo login','warn');
      deps.toast('Se cayó la sesión de Agentes · entrá y sigo con el retiro','yellow');
      let _okSes = false; try{ _okSes = await deps.ensureDrexSession(); }catch(_e){}
      if(_okSes && deps.withdrawalState.current===st) bb = await deps.callDrex('buscarUsuario', st.usuario, { skipBalance:true });
    }
    if(bb && (bb.needsLogin || bb.pageError)){
      const _mot = bb.needsLogin ? 'Se cayó la sesión de Agentes' : 'Agentes devolvió una página de error';
      deps.toast(_mot+' · no se sacó nada. Entrá de nuevo y tocá Pagar.','red');
      deps._trazaPaso(_mot+' · no se operó','err');
      deps._trazaFin('err');
      return;
    }
    if(!bb || !bb.exists){
      deps.toast('Usuario '+st.usuario+' no encontrado en Agentes · no se sacó nada.','red');
      deps._trazaPaso(st.usuario+' no existe en Agentes','err');
      deps._trazaFin('err');
      return;
    }
    // Cerrar el modal mientras se buscaba es la forma de frenar: no se paga.
    if(deps.withdrawalState.current !== st){
      deps.toast('Cancelaste el retiro · no se sacó nada','yellow');
      deps._trazaPaso('Cancelado por el operador antes de retirar','warn');
      deps._trazaFin('err');
      return;
    }
    deps._trazaPaso(st.usuario+' encontrado'+(bb.balance?.raw?(' · saldo '+bb.balance.raw.trim()):''), 'ok');

    // 2) Punto sin vuelta: recién ahora se cierra el modal y se retira.
    _cerrado = true;
    if(!confirmarCada){
      deps.cerrarRetiroV2();
      try{ if(typeof deps.cerrarExpedienteSolicitud === 'function') deps.cerrarExpedienteSolicitud(); else if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
      try{ if(typeof deps.cerrarPortalJobModal === 'function') deps.cerrarPortalJobModal(); else if(deps.window.cerrarPortalJobModal) deps.window.cerrarPortalJobModal(); }catch(_e){}
    }
    deps.toast('Portal: retirando '+deps.money(total)+'...', 'blue');
    deps._trazaPaso('Retirando '+deps.money(total)+' en Agentes...');
    const rr = await deps.callDrex('retirarSaldo', total);
    if(!(rr && rr.ok!==false)){
      deps.toast('No se pudo extraer las fichas: '+((rr&&rr.message)||'error')+' — no se transfirió nada.','red');
      deps._trazaPaso('Falló extracción: '+((rr&&rr.message)||'error'),'err');
      deps._trazaFin('err');
      // Un ok:false del preload es SIEMPRE antes de tocar Aplicar (saldo insuficiente, sesión, campo
      // de monto): no se movió plata, así que el modal vuelve tal cual para corregir y reintentar.
      if(rr && rr.ok === false){
        _cerrado = false;
        deps.withdrawalState.current = st;
        try{ deps._rv2Render(); }catch(_e){}
      }
      return;
    }
    // El casino RECHAZÓ el retiro: apareció el modal y NO dijo "Operación correcta"
    // (bet300 lo manda escrito: "RETIRO RECHAZADO por BET300"). Las fichas NO salieron de la
    // cuenta del jugador, así que no hay NADA que transferirle.
    //
    // Hasta acá se miraba sólo `ok`, que es "la automatización corrió y contestó" — y es true
    // igual cuando el casino dice que no. Con un rechazo se seguía de largo: se transfería la
    // plata, se descontaba la billetera, se anotaba el historial en OK y se marcaba PAGADA.
    //
    // El criterio es el mismo que ya usan las operaciones manuales y los lotes:
    // exito === false es rechazo CLARO; null (no se vio el modal) se confía, como allá.
    const _rechazoCasino = rr && rr.exito === false;
    if(_rechazoCasino){
      deps.toast('El casino RECHAZÓ el retiro — no se transfirió nada.','red');
      deps._trazaPaso('Agentes RECHAZÓ el retiro (no dijo "Operación correcta") · '
        + ((rr&&rr.resultado)||(rr&&rr.message)||'sin detalle'), 'err');
      deps._trazaFin('err');
      try{ deps.alert('⛔ El casino RECHAZÓ el retiro de '+deps.money(total)+'.\n\n'
        + ((rr&&rr.resultado)||(rr&&rr.message)||'') + '\n\n'
        + 'Las fichas NO salieron de la cuenta del jugador y NO se transfirió nada.\n'
        + 'Revisá en Agentes y volvé a intentar.'); }catch(_e){}
      // No se movió plata: el modal vuelve tal cual para corregir y reintentar, igual que un ok:false.
      _cerrado = false;
      deps.withdrawalState.current = st;
      try{ deps._rv2Render(); }catch(_e){}
      return;
    }
    st.saldoPost = (typeof rr?.newBalance?.value==='number' && !rr?.newBalance?.unchanged) ? rr.newBalance.value : null;
    fichasOk=true;
    deps._trazaPaso('Retiro aplicado en Agentes'+(st.saldoPost!=null?(' · saldo '+deps.money(st.saldoPost)):''), 'ok');
    deps.toast('Retiro '+(esParcial?'parcial ':'')+'OK: '+st.usuario+' · '+deps.money(total), 'green');
  }catch(e){
    deps.toast('Error en retiro: '+(e.message||''),'red');
    deps._trazaPaso('Error: '+(e.message||String(e)),'err');
    deps._trazaFin('err');
  }finally{
    deps._wdUnlock();
    deps._drexGlobalUnlock();
    st._pagando = false;
    // Si el modal sigue abierto (no se llegó a mover plata), el botón vuelve para reintentar.
    if(!_cerrado && _btn){ _btn.disabled = false; _btn.textContent = _btnTxt; }
  }
  if(!fichasOk) return;

  // 2) Registrar las transferencias
  if(confirmarCada){ st.fase='confirmar'; _rv2RenderConfirmar(); return; } // fase de confirmar una x una
  // RÁPIDO (default): debita cada billetera + registra su retiro en Chunior con notificación y traza, y finaliza.
  st.chuMovs = st.chuMovs || [];
  for(const b of st.pagar){
    if(b.chunior){
      deps._trazaPaso('Registrando en Chunior ('+b.nombre+' · '+deps.money(b.monto)+')...');
      try{
        const _rc = await deps.registrarRetiroEnChunior(b.chunior, b.monto, st.usuario);
        if(_rc && _rc.ok && _rc.movimientoId){
          st.chuMovs.push(String(_rc.movimientoId));
          deps.toast('📋 Retiro Chunior N° '+_rc.movimientoId+' ('+b.nombre+')', 'blue');
          deps._trazaPaso('Registrado en Chunior (N° '+_rc.movimientoId+' · '+b.nombre+')', 'ok');
        } else if(_rc && _rc.ok && !_rc.movimientoId){
          deps.toast('📋 Retiro anotado en Chunior ('+b.nombre+', sin N° confirmado)', 'blue');
          deps._trazaPaso('Anotado en Chunior ('+b.nombre+')', 'ok');
        } else if(_rc && _rc.error){
          deps.toast('⚠️ Retiro OK pero falló Chunior ('+b.nombre+'): '+_rc.error, 'red');
          deps._trazaPaso('Falló Chunior ('+b.nombre+'): '+_rc.error, 'warn');
          try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_rc.error }); }catch(_e){}
        }
      }catch(_e){
        console.warn('[rv2] chunior', _e);
        deps.toast('⚠️ Error Chunior ('+b.nombre+'): '+(_e.message||''), 'red');
        deps._trazaPaso('Error Chunior ('+b.nombre+')', 'warn');
        try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_e.message||'excepción' }); }catch(_e2){}
      }
    }
    try{ await deps.ajustarSaldoBilletera(b.id, -b.monto); }catch(_e){}
    st.hechas[b.id]=true;
    try{ deps._trazaPaso('Billetera '+b.nombre+' debitada ('+deps.money(b.monto)+')', 'ok'); }catch(_e){}
  }
  // Sin try/catch, una excepción acá se perdía en un unhandled rejection: la plata YA salió,
  // el modal quedaba congelado en el último paso de la traza y no se registraba nada — ni en
  // historial_ops ni en la solicitud. Pasó con un parcial de $500.000 (sol. #198680).
  try{
    // CON el estado: el modal ya se cerró arriba (cerrarRetiroV2) y el global está en null.
    await deps._rv2Finalizar(st);
  }catch(e){
    const _d = (e && e.message) || String(e);
    try{ deps._trazaPaso('FALLÓ EL CIERRE: '+_d, 'err'); }catch(_e){}
    try{ deps.toast('⚠ Se pagó pero NO se cerró la solicitud · anotalo', 'red'); }catch(_e){}
    try{ deps.alert('⚠️ El retiro SE PAGÓ pero falló el cierre.\n\n' + _d
      + '\n\nLa plata ya salió y la solicitud quedó con el estado anterior.'
      + '\nAnotalo y cerralo desde 💸 En proceso.'); }catch(_e){}
  }
};

function _rv2RenderConfirmar(){
  const st = deps.withdrawalState.current; if(!st) return;
  const el = deps._rv2Modal();
  const filas = st.pagar.map(function(b){
    const done = st.hechas[b.id]===true; const proc = st.hechas[b.id]==='procesando';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;background:'+(done?'#12261a':'#161b22')+';border:1px solid '+(done?'rgba(34,197,94,.4)':'#30363d')+';margin-top:7px">'
      + '<div style="flex:1"><div style="font-weight:800;color:#f0f6fc">💳 '+deps.escapeHtml(b.nombre)+' → '+deps.money(b.monto)+'</div>'
      +   '<div class="small" style="color:#8b949e">'+(done?'✓ transferido y registrado':(proc?'registrando…':'Hacé la transferencia real y tocá Listo'))+'</div></div>'
      + (done?'<span style="color:#22c55e;font-weight:800">✓</span>':(proc?'<span class="small" style="color:#8b949e">…</span>':'<button class="mini-btn green" style="font-size:11px" onclick="_rv2Confirmar(\''+b.id+'\')">✅ Transferí, listo</button>'))
      + '</div>';
  }).join('');
  const faltan = st.pagar.filter(function(b){ return st.hechas[b.id]!==true; }).length;
  el.innerHTML =
    '<div style="max-height:82vh;overflow:auto;background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.55);padding:16px;color:#e6edf3">'
    + '<div style="font-size:17px;font-weight:900;color:#fb923c;margin-bottom:4px">⬆ Confirmá las transferencias</div>'
    + '<div class="small" style="color:#8b949e;margin-bottom:8px">Las fichas ('+deps.money(st.totalPagar)+') YA se extrajeron. Transferí desde cada billetera al CBU <b>'+deps.escapeHtml(st.cbu||'—')+'</b> y confirmá cada una.</div>'
    + filas
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    // Con todas confirmadas el cierre ya salió solo (ver _rv2Confirmar). El botón queda como
    // reintento manual por si ese cierre automático falló, no como paso obligatorio.
    +   (faltan===0
         ? '<button class="mini-btn green" style="font-weight:800" onclick="this.disabled=true;_rv2Finalizar()">Cerrar el retiro</button>'
         : '<span class="small" style="color:#8b949e;align-self:center">Faltan '+faltan+' transferencia(s)</span>')
    + '</div></div>';
  el.style.display='block';
}

// Confirma UNA transferencia: registra el retiro en Chunior por esa billetera y la debita.
api._rv2Confirmar = async function(bid){
  const st = deps.withdrawalState.current; if(!st) return;
  bid = String(bid);
  const b = st.pagar.find(function(x){ return x.id===bid; });
  if(!b || st.hechas[bid]===true || st.hechas[bid]==='procesando') return;
  st.hechas[bid]='procesando'; _rv2RenderConfirmar();
  try{
    st.chuMovs = st.chuMovs || [];
    if(b.chunior){
      try{
        const _rc = await deps.registrarRetiroEnChunior(b.chunior, b.monto, st.usuario);
        if(_rc && _rc.ok && _rc.movimientoId){
          st.chuMovs.push(String(_rc.movimientoId));
          deps.toast('📋 Retiro Chunior N° '+_rc.movimientoId+' ('+b.nombre+')', 'blue');
          deps._trazaPaso('Registrado en Chunior (N° '+_rc.movimientoId+' · '+b.nombre+')', 'ok');
        } else if(_rc && _rc.ok && !_rc.movimientoId){
          deps.toast('📋 Retiro anotado en Chunior ('+b.nombre+', sin N° confirmado)', 'blue');
          deps._trazaPaso('Anotado en Chunior ('+b.nombre+')', 'ok');
        } else if(_rc && _rc.error){
          deps.toast('⚠️ Falló Chunior ('+b.nombre+'): '+_rc.error, 'red');
          deps._trazaPaso('Falló Chunior ('+b.nombre+'): '+_rc.error, 'warn');
          try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_rc.error }); }catch(_e){}
        }
      }catch(_e){
        console.warn('[rv2] chunior', _e);
        deps.toast('⚠️ Error Chunior ('+b.nombre+'): '+(_e.message||''), 'red');
        deps._trazaPaso('Error Chunior ('+b.nombre+')', 'warn');
        try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_e.message||'excepción' }); }catch(_e2){}
      }
    }
    try{ await deps.ajustarSaldoBilletera(b.id, -b.monto); }catch(_e){}
    st.hechas[bid]=true;
    try{ deps._trazaPaso('Transferido '+b.nombre+' · '+deps.money(b.monto),'ok'); }catch(_e){}
    deps.toast('✓ '+b.nombre+': '+deps.money(b.monto),'green');
  }catch(e){ st.hechas[bid]=false; deps.toast('Error en '+b.nombre+': '+(e.message||''),'red'); }
  _rv2RenderConfirmar();
  // CIERRE AUTOMÁTICO. Con la última billetera confirmada ya está TODO hecho: las fichas salieron,
  // los movimientos están anotados en Chunior y la plata se transfirió. Lo único que faltaba era
  // apretar "Finalizar retiro", que no decide nada — sólo registra. Y si el operador cerraba el
  // modal ahí (o se le colgaba la ventana), la plata YA se había movido pero no quedaba ni la fila
  // en el historial ni la solicitud actualizada: el retiro existía en Chunior y en ningún lado más.
  // Pasó de verdad con un parcial. Ahora cierra solo.
  if(st.pagar.every(function(x){ return st.hechas[x.id]===true; })){
    try{ await deps._rv2Finalizar(st); }catch(e){
      try{ deps.toast('⚠ Se transfirió todo pero falló el cierre: '+(e.message||'')+' — revisá el historial','red'); }catch(_e){}
    }
  }
};

// Finaliza: marca la solicitud (parcial/completa), avisa al usuario y registra el historial.
// Candado de reentrada. El botón "Cerrar el retiro" no tenía ninguno: cada clic escribía una
// fila en historial_ops y volvía a notificar al usuario. En la solicitud 84401 quedaron ONCE
// filas de $500.000 en 20 segundos —con intervalos de hasta 1 ms, imposibles para una persona—
// todas SIN número de Chunior: la transferencia fue una sola, el registro se disparó once
// veces. Si además cada clic ajustó el saldo de la billetera, ese saldo quedó mal (D-64).
let _rv2Cerrando = false;
const _rv2FinalizarInterno = async function(stCapturado){
  // El cierre automático le pasa el estado que ya tenía; el botón manual no pasa nada y usa el global.
  const st = (stCapturado && typeof stCapturado === 'object' && stCapturado.id != null)
    ? stCapturado : deps.withdrawalState.current;
  // Este return existía y era silencioso. Se llega acá DESPUÉS de haber extraído las fichas y
  // debitado la billetera: irse sin hacer nada y sin decir nada deja la plata afuera y la
  // solicitud intacta, que es como quedó el parcial de $500.000 (sol. #198680).
  if(!st){
    try{ deps._trazaPaso('Se perdió el estado del retiro antes de cerrarlo', 'err'); }catch(_e){}
    try{ deps.alert('⚠️ Se perdió el estado del retiro justo antes de cerrarlo.\n\n'
      + 'Si ya transferiste, la plata salió y la solicitud NO se actualizó.'
      + '\nRevisá el historial y cerrala desde 💸 En proceso.'); }catch(_e){}
    return;
  }
  try{ deps._trazaPaso('Cerrando la solicitud...'); }catch(_e){}
  const total = st.totalPagar;
  // Total REAL del retiro (la deuda). En modo parcial NO puede salir del objetivo: ahí el objetivo
  // es "lo que falta", y tomarlo como total cerraba el retiro con la mitad pagada.
  // En modo parcial manda st.totalReal (la deuda, editable arriba). El objetivo es "lo que falta",
  // tomarlo como total cerraba el retiro con una parte pagada.
  const montoTotal = st.modoParcial
    ? (Number(st.totalReal) || st._metaTotal || st.declarado || st.objetivo)
    : (st._metaTotal!=null ? st._metaTotal : st.objetivo);
  const pagadoAcum = (st.yaPagado||0) + total;
  const restante = Math.max(0, montoTotal - pagadoAcum);
  // Si al usuario no le quedan fichas, el retiro está terminado aunque no se haya llegado
  // al monto pedido: esa plata no existe. Antes quedaba EN_PROCESO para siempre y había
  // que cerrarlo a mano (meli1804 pidió 28.000, tenía 26.002, quedó con 0,48 de saldo).
  const _sinFichas = (st.saldoPost != null && Number(st.saldoPost) < 1);
  const completo = (restante <= 0.5) || _sinFichas;
  const listaBil = st.pagar.map(function(b){ return b.nombre+' '+deps.money(b.monto); }).join(' + ');
  // N° de movimiento de Chunior: el historial marca "⚠ Falta Chunior" cuando esta columna está
  // vacía. Se anotaba bien pero el número se descartaba. Con varias billeteras va el primero y
  // los demás quedan en las notas (la columna guarda uno solo).
  const _chuMovs = (st.chuMovs||[]).filter(Boolean);
  const _notaChu = _chuMovs.length>1 ? (' · Chunior: '+_chuMovs.join(' + ')) : '';
  const _notaHistorial = 'Retiro'+(completo?'':' PARCIAL')+' · pagado '+deps.money(total)+' desde: '+listaBil+(completo?'':(' · restan '+deps.money(restante)))
    +(String(st.titular||'').trim()?(' · Titular: '+String(st.titular).trim()):'')
    +(String(st.destino||st.cbu||'').trim()?(' · Alias: '+String(st.destino||st.cbu).trim()):'')
    +(st.obs?(' · Obs: '+st.obs):'')+_notaChu;
  let filaHist = null;
  try{
    filaHist = await deps.registrarEnHistorial({
      usuario:st.usuario, tipo:'RETIRO', monto:total,
      billetera_id: st.pagar[0]?st.pagar[0].id:null, billetera_nombre: listaBil,
      origen:'LANDING', estado:'OK',
      // Titular y Alias, como en portalNotasBase: sin ellos el parcial quedaba en el historial con
      // "👤 —" y su destino no llegaba a la ficha del jugador (detector de datos, 6/11).
      notas:_notaHistorial,
      // saldo_pre: las fichas que tenía ANTES de retirar (st.saldoReal, leído al abrir el modal).
      // Sin esto la columna "Saldo pre" del historial salía vacía en todos los parciales.
      saldo_pre: (st.saldoReal!=null ? st.saldoReal : null),
      saldo_post: st.saldoPost, solicitud_id: st.id,
      chunior_movimiento_id: _chuMovs[0] || null
    });
  }catch(_e){
    // Sin fila en historial_ops la operación no existe para el cotejo, para la regla de 24 h
    // ni para el jugador. Callarlo es perder el rastro de plata que ya salió.
    try{ deps._trazaPaso('No se pudo registrar en el historial: '+((_e&&_e.message)||_e), 'err'); }catch(_x){}
    try{ deps.toast('⚠ El retiro se pagó pero NO quedó en el historial · anotalo','red'); }catch(_x){}
  }
  // El titular y el CBU del retiro son el dato más fuerte que tenemos de esa persona:
  // vienen del banco. Hasta ahora quedaban sepultados en las notas y había que rescatarlos
  // con un backfill. Se guardan en el vínculo para que estén a mano en la ficha.
  // Va en try/catch y sin await bloqueante: si falla, el retiro NO se ve afectado.
  try{
    const _titRet = String(st.titular||'').trim();
    const _cbuRet = String(st.destino||st.cbu||'').replace(/\D/g,'');
    if(_titRet || _cbuRet.length >= 18){
      deps.supabaseClient.rpc('panel_guardar_datos_retiro',{
        p_secret: deps.window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof deps.pcOperativa!=='undefined'?deps.pcOperativa:'')||deps.window.pcOperativa||'',
        p_usuario: st.usuario, p_titular: _titRet||null, p_cbu: _cbuRet||null
      }).catch(function(){});
    }
  }catch(_e){}
  // Un parcial va a EN_PROCESO, NO a EN_REVISION: son bandejas distintas (EN_REVISION es "algo
  // falló / revisar") y además el portal muestra "💸 Te estamos pagando por partes" SOLO con
  // EN_PROCESO — con EN_REVISION el usuario veía "⏳ En verificación" y sin barra de progreso.
  const _estadoFinal = completo ? 'PAGADA' : 'EN_PROCESO';

  // ORDEN IMPORTANTE: primero la RPC, después el estado.
  // metadata.retiro_parcial la escribe SOLO landing_retiro_registrar_parcial, que ACUMULA sobre lo
  // que ya haya. Cuando el panel también la escribía, el pago se contaba DOS veces (pagabas 250k de
  // 500k y quedaba pagado=500k → la RPC lo daba por completo y cerraba el retiro con la mitad).
  // El panel solo la escribe como respaldo si la RPC no pudo registrar.
  let _rp = null;
  // También hay que registrar el pago que CIERRA el retiro. Con `if(!completo)` el último pago no
  // se anotaba: retiro_parcial se quedaba en el valor anterior (350.000 de 450.000) mientras
  // monto_pagado sí llegaba a 450.000 → los dos registros discrepaban y los 100.000 finales
  // figuraban como no pagos aunque estuvieran abonados.
  const _hayProgreso = (Number(st.yaPagado)||0) > 0;
  // El TITULAR de la billetera: es el nombre que el jugador ve en su cuenta cuando le llega la plata.
  // Va ACÁ AFUERA, no adentro del if: el respaldo de más abajo también lo usa, y declarado adentro
  // no existe allá. Cuando la RPC de progreso fallaba y entraba el respaldo, reventaba con
  // "_desde is not defined", lo agarraba el catch de la actualización y la solicitud NUNCA se
  // actualizaba: el jugador ya tenía la plata y el retiro quedaba con el estado viejo. Falla sobre
  // falla, justo en el camino que ya estaba degradado.
  const _desde = (st.pagar||[]).map(function(b){ return String(b.titular || b.nombre || '').trim(); })
    .filter(function(v, i, a){ return v && a.indexOf(v) === i; }).join(' + ');
  if(!completo || _hayProgreso){
    try{ _rp = await notificarRetiroParcialPortal(st.id, total, pagadoAcum, restante, montoTotal, st.saldoPost, _desde); }
    catch(e){ _rp = { ok:false, uncertain:true, detail:(e&&e.message)||String(e) }; }
    // ¿El progreso AVANZÓ de verdad? La base devuelve cuánto quedó pagado. Si contesta bien pero el
    // acumulado no se movió, el pago no entró y el retiro queda colgado en la caja pidiendo un monto
    // que ya se pagó (D-100). Se trata como fallo para que entre el respaldo de abajo.
    const _pagRpc = Number((( _rp && _rp.data) || {}).pagado);
    if(_rp && _rp.ok && Number.isFinite(_pagRpc) && _pagRpc < pagadoAcum - 0.5){
      _rp = { ok:false, detail:'la base quedó en '+deps.money(_pagRpc)+' y este pago de '+deps.money(total)+' no entró' };
    }
    if(!_rp || !_rp.ok){
      try{ deps.toast('⚠ Parcial PAGADO pero sin registrar el progreso · revisalo','red'); }catch(_e){}
      try{ deps.alert('⚠️ El retiro parcial SÍ se pagó ('+deps.money(total)+'), pero NO se pudo registrar el progreso.\n\n'
        + ((_rp&&_rp.detail)||'') + '\n\nEl usuario no va a ver el descuento hasta que se registre. Anotalo a mano.'); }catch(_e){}
    }
  }
  // Monto ajustado: el total quedó distinto de lo que PIDIÓ el jugador. Va la corrección con su
  // MOTIVO, que el portal le muestra debajo del progreso y se le avisa una vez por chat (D-88).
  const _decOrig = Number(st.declaradoOriginal || st.declarado || 0);
  const _ajustado = _decOrig > 0 && Math.abs(Number(montoTotal||0) - _decOrig) > 0.5;
  const _motivoAjuste = _ajustado
    ? (String(st.motivoAjuste||'').trim() || ('Pediste '+deps.money(_decOrig)+' y el retiro quedó en '+deps.money(montoTotal)+'.'))
    : '';
  // Hora exacta, con segundos (Juan: "en el aprobado agregá el horario de aprobación, creeme,
  // importa"). Ante un "me transferiste hace media hora" es la constancia.
  const _ahora = new Date();
  let _metaInstrumento = st.metadata || (st.solicitud && (st.solicitud.METADATA || st.solicitud.metadata)) || {};
  try{ if(typeof _metaInstrumento==='string') _metaInstrumento=JSON.parse(_metaInstrumento); }catch(_e){ _metaInstrumento={}; }
  const _esRetiroInstrumento = !!(_metaInstrumento.retiro_instrumento_v1 && _metaInstrumento.retiro_instrumento_v1.instrumento_id);
  let _selloRetiro = null;
  // El sello final se escribe cuando ya se completaron las transferencias. Si el movimiento ya
  // ocurrió y el RPC falla, se conserva el cierre para no duplicar dinero y se deja la auditoría
  // remota marcada como pendiente.
  if(completo && _esRetiroInstrumento){
    if(typeof deps.window.nodoSellarRetiroAprobado === 'function'){
      try{
        _selloRetiro = await deps.window.nodoSellarRetiroAprobado(st.id,{
          solicitud:st.solicitud || {metadata:_metaInstrumento},usuario:st.usuario,monto:pagadoAcum
        });
      }catch(_e){ _selloRetiro={ok:false}; }
    }else _selloRetiro={ok:false};
    if(!_selloRetiro || !_selloRetiro.ok){
      try{ deps.window.NodoSalud?.begin('RETIROS')?.record('DATA','ERROR','RETIRO_SELLO_NO_CONFIRMADO'); }catch(_e){}
      try{ deps.toast('El retiro ya se transfirió, pero faltó guardar la hora en el servidor. No lo vuelvas a pagar; revisá el historial.','red'); }catch(_e){}
    }
  }
  const _hora = _selloRetiro && _selloRetiro.ok
    ? _selloRetiro.horaExacta
    : (typeof deps.window.nodoHoraExacta === 'function' ? deps.window.nodoHoraExacta(_ahora) : _ahora.toLocaleTimeString('es-AR'));
  const _horaAt = _selloRetiro && _selloRetiro.ok && _selloRetiro.aprobadoAt ? _selloRetiro.aprobadoAt : _ahora.toISOString();
  try{
    const _extra = {
      aprobado_at: _horaAt, aprobado_hora: _hora,
      etapa: completo?'RETIRO_V2_COMPLETO':'RETIRO_V2_PARCIAL',
      parcial:!completo, monto_pagado:pagadoAcum, monto_restante:restante, monto_total:montoTotal,
      operador:(deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel'
    };
    if(completo && _esRetiroInstrumento){
      _extra.retiro_aprobado_hora_exacta = _hora;
      _extra.retiro_aprobado_servidor = !!(_selloRetiro && _selloRetiro.ok);
      _extra.observacion = 'Retiro transferido a las '+_hora+' hs.';
    }
    if(_ajustado){
      _extra.monto_corregido = montoTotal;
      _extra.monto_declarado_original = _decOrig;
      _extra.motivo_ajuste = _motivoAjuste;
    }
    // Respaldo SOLO si la RPC falló: si no, duplicaríamos el progreso.
    if((!completo || _hayProgreso) && (!_rp || (!_rp.ok && !_rp.uncertain))){
      // CONSERVANDO los pagos ya anotados: el respaldo los pisaba y se perdía el detalle de lo cobrado.
      let _rpPrev = {};
      try{
        const _sol = ((deps.window.V154P && deps.V154P.solicitudes) || []).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(st.id); });
        let _mPrev = (_sol && (_sol.METADATA!==undefined ? _sol.METADATA : _sol.metadata)) || {};
        if(typeof _mPrev==='string'){ try{ _mPrev = JSON.parse(_mPrev); }catch(_e){ _mPrev = {}; } }
        _rpPrev = (_mPrev && _mPrev.retiro_parcial) || {};
      }catch(_e){}
      const _pagosPrev = Array.isArray(_rpPrev.pagos) ? _rpPrev.pagos.slice() : [];
      _pagosPrev.push({ monto: total, fecha: new Date().toISOString(),
        operador: (deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel',
        desde: _desde || null, respaldo_panel: true });
      _extra.retiro_parcial = Object.assign({}, _rpPrev, { pagado:pagadoAcum, total:montoTotal, restante:restante, pagos:_pagosPrev });
    }
    if(completo && filaHist && filaHist.id){
      try{
        await deps.supabaseClient.from('historial_ops').update({
          notas:_notaHistorial+' · Transferido a las '+_hora+' hs.'+(_selloRetiro&&_selloRetiro.ok?'':' · sello servidor pendiente')
        }).eq('id',filaHist.id);
      }catch(_e){}
    }
    // Va DESPUÉS de la RPC a propósito: deja el estado correcto aunque la RPC lo haya marcado completo.
    const _ru = await deps.window.actualizarSolicitudPortal(String(st.id), _estadoFinal, _extra);
    // NO silencioso: si esto falla el retiro queda con el estado VIEJO. Un retiro ya saldado que
    // no llega a marcarse PAGADA se queda "en proceso" para siempre y nadie se entera.
    if(!_ru || _ru.error){
      try{ deps.toast('⚠ El retiro se pagó pero la solicitud quedó con el estado anterior','red'); }catch(_e){}
      try{ deps.alert('⚠️ Se pagó '+deps.money(total)+', pero la solicitud NO pasó a '+_estadoFinal+'.\n\n'
        + 'Va a seguir figurando con el estado viejo (por eso a veces un retiro ya saldado queda "en proceso").\n\n'
        + 'Cerralo desde el botón 💸 En proceso cuando puedas.'); }catch(_e){}
    }
  }catch(e){
    try{ deps.toast('⚠ El retiro se pagó pero falló actualizar la solicitud · revisalo','red'); }catch(_e){}
    try{ deps.alert('⚠️ El retiro se pagó ('+deps.money(total)+') pero falló actualizar la solicitud:\n\n'
      + ((e&&e.message)||String(e)) + '\n\nQuedó con el estado anterior — revisalo en 💸 En proceso.'); }catch(_e){}
  }
  try{
    const msg = completo
      ? '✅ Completamos tu retiro. Te transferimos '+deps.money(total)+' a las '+_hora+' hs. ¡Listo!'
      : '💸 Te transferimos '+deps.money(total)+' de tu retiro a las '+_hora+' hs · restan '+deps.money(restante)+'. El resto en cuanto se libere otra billetera.';
    // La solicitud ya está en su estado final (PAGADA/EN_PROCESO) → se lo pasamos explícito.
    // El motivo va UNA vez: si ya se le dijo este mismo motivo, no se repite en cada cuota.
    const _avisarAjuste = _ajustado && _motivoAjuste && _motivoAjuste !== String(st._motivoAvisado||'');
    const _pre = _avisarAjuste ? ('📝 Ajustamos tu retiro a '+deps.money(montoTotal)+'. '+_motivoAjuste+'\n') : '';
    // Al chat VIVO del portal (D-99): antes iba a la generación de chat que el portal ya no lee, o
    // sea a ningún lado. Si no tiene conversación abierta se le abre una (Juan, 2/11).
    const _txtAviso = _pre+(st.obs?st.obs+'\n':'')+msg;
    if(typeof deps.window.avisarJugadorEnChat === 'function') await deps.window.avisarJugadorEnChat(st.usuario, _txtAviso);
    else await deps.notificarUsuarioEnChat(st.usuario, _txtAviso, st.id, _estadoFinal);
  }catch(_e){}
  // Canal EXTRA: push directo con título/cuerpo claros del parcial (no depende del chat_thread).
  try{ notificarRetiroParcialPush(st.usuario, total, pagadoAcum, montoTotal, completo); }catch(_e){}
  try{ deps._trazaFin('ok', filaHist?.id); }catch(_e){}
  deps.toast(completo?('✅ Retiro completo · '+deps.money(total)):('💸 Parcial '+deps.money(total)+' · restan '+deps.money(restante)), completo?'green':'yellow');
  try{ await deps.sincronizarBilleterasChunior(true); }catch(_e){}
  try{ await deps.cargarHistorial(); }catch(_e){}
  try{ deps.renderBillerasInicio(); }catch(_e){}
  try{ if(typeof deps.cargarSolicitudesPortal==='function') await deps.cargarSolicitudesPortal(true); }catch(_e){}
  deps.cerrarRetiroV2();
  try{ if(typeof deps.cerrarExpedienteSolicitud === 'function') deps.cerrarExpedienteSolicitud(); else if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
  try{ if(typeof deps.cerrarPortalJobModal === 'function') deps.cerrarPortalJobModal(); else if(deps.window.cerrarPortalJobModal) deps.window.cerrarPortalJobModal(); }catch(_e){}
};
api._rv2Finalizar = async function(){
  if(_rv2Cerrando){
    try{ deps.toast('El retiro ya se está cerrando · esperá','yellow'); }catch(_e){}
    return;
  }
  _rv2Cerrando = true;
  try{ return await _rv2FinalizarInterno.apply(this, arguments); }
  finally{ _rv2Cerrando = false; }
};


  // Aviso de retiro parcial al usuario por PUSH (si tiene push suscripto). Reemplaza el chat, que no siempre llega.
  function notificarRetiroParcialPush(usuario, montoParcial, pagado, total, completado){
    if(!usuario || !deps.window.PUSH_API_URL) return;
    const title = completado ? "BET300 · ¡Retiro completado! 🎉" : "BET300 · Pago de tu retiro 💸";
    const body = completado
      ? ("¡Listo! Te pagamos "+deps.money(montoParcial)+". Total: "+deps.money(pagado)+". Revisá tu cuenta.")
      : ("Te transferimos "+deps.money(montoParcial)+". Vas "+deps.money(pagado)+" de "+deps.money(total)+".");
    try{
      deps.fetch(deps.window.PUSH_API_URL,{ method:"POST",
        headers:{"Content-Type":"application/json","x-push-secret":deps.window.PUSH_SECRET||""},
        // tag COMPARTIDO con la notificación local del portal ("¡Retiro procesado!"): al usar el
        // mismo tag el SO las colapsa en UNA sola en vez de mostrar dos avisos del mismo pago.
        // Se mantienen los dos canales porque el push llega aunque el portal esté cerrado.
        body:JSON.stringify({usuario:usuario, title:title, body:body, url:"/", tag:"bet300-retiro"}) }).catch(function(){});
    }catch(_e){}
  }

api.v154pRegistrarParcial = function(id){ return deps.window.abrirModalRetiroV2(id, {modoParcial:true}); };

    return { globals: api, notificarRetiroParcialPortal, _rv2LeerSaldo, notificarRetiroParcialPush, _rv2RenderConfirmar };
  }
  return Object.freeze({ create, dependencies });
});
