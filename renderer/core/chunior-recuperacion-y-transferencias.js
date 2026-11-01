// DESTRABAR DE VERDAD. Antes soltaba cuatro cosas y dejaba tomadas otras cuatro — entre ellas el
// guard del portal, que es el que contesta "hay una operación en curso". Por eso se apretaba
// Destrabar, decía "destrabado", y el panel seguía sin dejar operar. Ahora se sueltan TODOS los
// candados: si el operador pide destrabar, es porque ya no hay nada corriendo.
window.liberarLockAgentes = function(){
  const m = window._drexGlobalBusyMotivo || (window._drexCola && window._drexCola.activo && window._drexCola.activo.nombre);
  try{ if(typeof _drexGlobalUnlock==='function') _drexGlobalUnlock(); }catch(_e){}
  try{ if(typeof _wdForceUnlock==='function') _wdForceUnlock(); }catch(_e){}
  try{ window._v154pParcialBusy = false; }catch(_e){}
  try{ window._retiroSaldoLastRun = 0; }catch(_e){}
  // Los que faltaban:
  try{ window._portalSolicitudOperacionEnCurso = false; }catch(_e){}   // el que decía "operación portal en curso"
  try{ window._operacionManualEnCurso = false; }catch(_e){}
  try{ window._cotejoDeclarando = false; }catch(_e){}
  try{ window._drexSinSesion = false; }catch(_e){}                     // el cortacircuitos de sesión
  try{ if(window._drexCola){ window._drexCola.activo = null; window._drexCola.pendientes = 0; } }catch(_e){}
  try{ document.body.classList.remove('op-portal-en-curso'); delete document.body.dataset.opSolicitud; }catch(_e){}
  try{ if(typeof _wdUnlock==='function'){ let g=0; while(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0 && g++<20) _wdUnlock(); } }catch(_e){}
  try{ _agentesBadgePintar(); }catch(_e){}
  try{ toast('🔓 Agente destrabado'+(m?(' · lo tenía: '+m):'')+'. Ya podés reintentar.', 'green'); }catch(_e){}
  console.log('[lock] destrabado a mano · todos los candados liberados');
};
// Reiniciar Chunior cuando muestra 403/CSRF. Recargar NO sirve (re-envía el POST fallido → mismo
// 403); esto NAVEGA a la base (GET) → token CSRF fresco. hard=true limpia las cookies de Chunior
// (NO Supabase) y fuerza un login nuevo.
window.reiniciarChunior = async function(hard){
  if(!window.chunior || !window.chunior.reset){ try{ toast('Solo disponible en la app de escritorio.','yellow'); }catch(_e){} return; }
  try{ toast(hard?'🧹 Reiniciando Chunior con login limpio…':'🔄 Recuperando Chunior…','blue'); }catch(_e){}
  try{
    await window.chunior.reset(hard?{hard:true}:undefined);
    try{ if(window.chunior.focus) window.chunior.focus(); }catch(_e){}
    try{ toast('✅ Chunior recargado desde la base. Si pide login, ingresá de nuevo.','green'); }catch(_e){}
  }catch(e){ try{ toast('No se pudo reiniciar Chunior: '+(e.message||e),'red'); }catch(_e){} }
};
async function verificarSaldoRetiroOcioso(){
  try{
    try{ if(localStorage.getItem('nodo_saldo_ocioso_off')==='1') return; }catch(_e){}
    if(window._drexGlobalBusy) return; // candado maestro: cualquier operación lo toma
    if(typeof _loteEnCurso!=='undefined' && _loteEnCurso) return;
    if(typeof _operacionManualEnCurso!=='undefined' && _operacionManualEnCurso) return;
    if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return;
    if(window._v154pParcialBusy) return;
    if(typeof colaPendientesAll==='function' && colaPendientesAll().length>0) return;
    if(!window.ctrlElectron) return;
    // Cooldown global: como mucho UNA verificación cada 4 min. Sin esto, con varios retiros abiertos el
    // scanner entraba a Agentes una y otra vez (bucle) y dejaba el agente ocupado → el panel no operaba.
    if(window._retiroSaldoLastRun && (Date.now()-window._retiroSaldoLastRun) < 4*60*1000) return;
    const _MAX_EDAD_MS = 2*60*60*1000; // solo auto-escaneamos retiros RECIENTES (últimas 2 h); los viejos los maneja el operador
    window._retiroSaldoDone = window._retiroSaldoDone || {};
    const pend = ((window.V154P&&window.V154P.solicitudes)||[]).filter(function(s){
      const tipo = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase();
      if(tipo!=='RETIRO') return false;
      if(window._estadoYaCerrado && window._estadoYaCerrado(s.ESTADO)) return false;
      // Retiro YA en curso / parcial en progreso → lo maneja el operador; NO re-escanear
      // (si no, mientras un parcial queda EN_PROCESO el scanner re-entraba al agente y lo trababa).
      if(/EN_PROCESO|EN_REVISION|PROCESANDO|TOMAD/.test(String(s.ESTADO||'').toUpperCase())) return false;
      // Con CUALQUIER pago parcial hecho, el retiro NO se auto-rechaza: la plata ya salió y el
      // usuario está esperando el resto. Se miran TODAS las claves donde puede quedar el progreso
      // (retiro_parcial / retiro_progreso / progreso / monto_pagado suelto): mirando solo una,
      // un retiro con 250k ya pagados terminó AUTO_RECHAZADO.
      try{
        const m=(typeof s.METADATA==='object'?s.METADATA:JSON.parse(s.METADATA||'{}'))||{};
        const _rp = m.retiro_parcial || m.retiro_progreso || m.progreso || {};
        const _pag = Number(_rp.pagado!=null ? _rp.pagado
                          : (_rp.acumulado!=null ? _rp.acumulado
                          : (m.monto_pagado!=null ? m.monto_pagado
                          : (m.pagado_parcial!=null ? m.pagado_parcial : 0)))) || 0;
        if(_pag > 0) return false;
      }catch(_e){}
      return true;
    });
    const objetivo = pend.find(function(s){
      const sid = String(s.ID||s.SOLICITUD_ID||s.ID_SOLICITUD||'');
      const u = String(s.USUARIO||'').toLowerCase();
      if(!u || !sid) return false;
      const fc = Date.parse(s.FECHA_CREACION||s.created_at||s.FECHA||'') || 0;
      if(fc && (Date.now()-fc) > _MAX_EDAD_MS) return false;        // retiro VIEJO → no auto-escanear (corta el bucle)
      const d = window._retiroSaldoDone[sid];
      if(d && d.confiable) return false;                           // ya verificado BIEN → una sola vez, nunca más
      if(d && d.intentos>=3) return false;                         // 3 lecturas fallidas → basta, lo ve el operador
      if(d && (Date.now()-d.ts) < 5*60*1000) return false;         // espaciar reintentos de lecturas fallidas
      return true;
    });
    if(!objetivo) return;
    const usuario = String(objetivo.USUARIO||'');
    const sid = String(objetivo.ID||objetivo.SOLICITUD_ID||objetivo.ID_SOLICITUD||'');
    const monto = Math.abs(Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0));
    if(!_drexGlobalLock('retiro-saldo-check')) return;
    window._retiroSaldoLastRun = Date.now();
    // Registrar el intento YA (aunque la lectura falle) para no reintentar en bucle.
    { const _p = window._retiroSaldoDone[sid] || {intentos:0}; window._retiroSaldoDone[sid] = {confiable:false, intentos:_p.intentos+1, ts:Date.now()}; }
    _wdLock();
    try{
      const lectura = await leerFichasJugador(usuario);
      if(typeof lectura.saldo === 'number'){
        const saldo = lectura.saldo;
        const saldoConfiable = lectura.confiable === true; // se leyó DE VERDAD (no un 0 por lectura fallida/lenta)
        const suficiente = saldo + 0.5 >= monto;
        window._retiroSaldoCheck[usuario.toLowerCase()] = { saldo:saldo, monto:monto, suficiente:suficiente, confiable:saldoConfiable, ts:Date.now(), raw:lectura.raw };
        try{ if(window._retiroSaldoDone && window._retiroSaldoDone[sid]) window._retiroSaldoDone[sid].confiable = saldoConfiable; }catch(_e){} // lectura confiable → no re-escanear este retiro
        try{ if(typeof window.v154pRenderSolicitudesPortalEnInicio==='function') window.v154pRenderSolicitudesPortalEnInicio(); }catch(_e){}
        // Auto-rechazo ANTI-FRAUDE — SOLO el caso INEQUÍVOCO: el usuario NO tiene fichas (saldo ~0).
        // ⚠ Antes rechazábamos con "saldo < $5.000 y < monto": eso rechazaba a un usuario que SÍ tenía
        // fichas (ej. 4.000 fichas pidiendo 50.000) tratándolo como falso. MAL: si tiene ALGUNAS fichas,
        // corresponde un retiro PARCIAL, no un rechazo. Ahora solo se rechaza si está prácticamente
        // vacío (< _PISO_SIN_FICHAS) y ADEMÁS lo confirmamos con una 2ª lectura independiente (descarta
        // el 0 transitorio por proxy lento). Con fichas reales ⇒ NUNCA se auto-rechaza.
        const _PISO_SIN_FICHAS = 500; // por debajo de esto no hay fichas reales ni para un parcial
        if(saldoConfiable && saldo < _PISO_SIN_FICHAS && saldo < monto){
          // 2ª lectura de confirmación: re-entra a Agentes y vuelve a leer. Solo rechazamos si TAMBIÉN
          // la ve casi vacía. Si la 2ª no confirma (o no se pudo leer), NO se rechaza.
          let confirmado = false, saldo2 = saldo, raw2 = lectura.raw;
          const lectura2 = await leerFichasJugador(usuario);
          if(lectura2.confiable === true){
            saldo2 = lectura2.saldo; raw2 = lectura2.raw;
            confirmado = saldo2 < _PISO_SIN_FICHAS;
          }
          if(confirmado){
            const sid = objetivo.ID || objetivo.SOLICITUD_ID || objetivo.ID_SOLICITUD;
            const _saldoTxt = (raw2||money(saldo2)).trim();
            try{
              await window.actualizarSolicitudPortal(sid, 'RECHAZADA', {
                etapa: 'AUTO_RECHAZO_SIN_SALDO',
                motivo: 'Sin fichas para retirar (saldo '+_saldoTxt+', confirmado x2)'
              });
              // Al historial. Antes esto sólo salía como toast: se veía tres segundos y se perdía,
              // y después no había forma de saber por qué se le habia rechazado el retiro a alguien.
              try{ await registrarEnHistorial({
                usuario: usuario, tipo:'RETIRO', monto: Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0),
                origen:'AUTO', estado:'RECHAZADA', solicitud_id: sid,
                // Con TODO el detalle: qué pidió, qué tenía, cómo se leyó, y qué se le dijo. Un
                // "rechazado" a secas obliga a reconstruir el caso de memoria cuando el cliente
                // reclama tres días después.
                notas:'AUTO-RECHAZO · SIN FICHAS'
                  + ' · pidió '+money(Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0))
                  + ' · saldo leído '+_saldoTxt+' (2 lecturas: "'+lectura.raw+'" y "'+raw2+'")'
                  + ' · piso '+money(_PISO_SIN_FICHAS)
                  + (objetivo.TITULAR?(' · titular declarado: '+objetivo.TITULAR):'')
                  + ' · se le avisó por el chat'
              }); }catch(_e){}
              try{ await notificarUsuarioEnChat(usuario, '❌ No pudimos procesar tu retiro: no figurás con fichas disponibles para retirar. Si creés que es un error, escribinos por acá.'); }catch(_e){}
              toast('❌ Retiro de '+usuario+' rechazado · SIN fichas (saldo '+_saldoTxt+', confirmado x2)', 'red');
            }catch(_e){}
          } else {
            toast('⚠ '+usuario+': 1ª lectura casi vacía ('+ lectura.raw +') NO confirmada en 2ª ('+raw2+') · NO auto-rechazo', 'yellow');
          }
        } else if(!saldoConfiable){
          toast('⚠ No pude leer bien el saldo de '+usuario+' — NO auto-rechazo. Revisalo a mano.', 'yellow');
        } else {
          toast((suficiente?'✓':'⚠')+' Retiro '+usuario+': saldo '+(lectura.raw||money(saldo)).trim()+(suficiente?' (alcanza)':' · tiene fichas pero menos que lo pedido → retiro PARCIAL'), suficiente?'blue':'red');
        }
      }
    }catch(_e){}
    finally{ _wdUnlock(); _drexGlobalUnlock(); }
  }catch(_e){}
}
window.verificarSaldoRetiroOcioso = verificarSaldoRetiroOcioso;

// ── Fichas de UN jugador, a pedido ──────────────────────────────────────────────────────────
// El "Ver" de un retiro lee las fichas que tiene el jugador AHORA (Juan, 25/10): es lo que decide si
// se paga entero, por partes o no se paga. El escaneo de arriba hace lo mismo solo, pero espera a que
// el agente esté ocioso, sólo mira retiros de las últimas 2 h y lee una vez cada 4 minutos. Esto lo
// pidió una persona mirando la pantalla: lee ya (esperando unos segundos si el agente está en otra
// cosa) y deja el resultado donde lo lee el resto del panel (_retiroSaldoCheck), así la tarjeta
// también muestra "saldo … ✓/⚠".
//
// Sólo LEE. No rechaza nada: el auto-rechazo del escaneo sigue siendo cosa del escaneo.
//
// La lista de cargas para reintentar no cuenta como "ocupado": es trabajo guardado, no algo que esté
// usando el agente ahora. Contándola, una carga vieja sin resolver dejaba todas las lecturas en
// "agente ocupado" para siempre.
function _fichasAgenteOcupado(){
  try{
    if(window._drexGlobalBusy) return true;
    if(typeof _loteEnCurso!=='undefined' && _loteEnCurso) return true;
    if(typeof _operacionManualEnCurso!=='undefined' && _operacionManualEnCurso) return true;
    if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return true;
    if(window._v154pParcialBusy) return true;
  }catch(_e){}
  return false;
}
window._fichasLeyendo = window._fichasLeyendo || {};
window.revisarFichasRetiro = function(opciones){
  const o = opciones || {};
  const usuario = String(o.usuario || '').trim();
  if(!usuario) return Promise.resolve({ error: 'Falta el usuario' });
  if(!window.ctrlElectron) return Promise.resolve({ error: 'Las fichas sólo se pueden leer desde la app de escritorio' });
  const clave = usuario.toLowerCase();
  window._retiroSaldoCheck = window._retiroSaldoCheck || {};
  const previo = window._retiroSaldoCheck[clave];
  if(!o.forzar && previo && previo.confiable && (Date.now() - previo.ts) < 3*60*1000) return Promise.resolve(previo);
  // Dos "Ver" seguidos sobre el mismo jugador comparten UNA lectura: el agente es uno solo.
  if(window._fichasLeyendo[clave]) return window._fichasLeyendo[clave];

  const lectura = (async function(){
    // El agente puede estar cargando otra cosa: se espera hasta ~20 s a que se libere en vez de
    // fallar de entrada. Pasado ese tiempo se dice la verdad y queda el botón para reintentar.
    const limite = Date.now() + 20000;
    while(_fichasAgenteOcupado() || !_drexGlobalLock('revisar-fichas')){
      if(Date.now() > limite){
        window.NodoSalud?.record('RETIROS', 'CONNECTED', 'DEGRADED', { code:'AGENTE_OCUPADO' });
        return { error: 'El agente está ocupado con otra operación. Probá de nuevo en un momento.', ocupado: true, motivo: 'ocupado' };
      }
      await new Promise(function(r){ setTimeout(r, 1500); });
    }
    _wdLock();
    try{
      const l = await leerFichasJugador(usuario);
      if(typeof l.saldo !== 'number') return { error: l.error, motivo: l.motivo };
      const monto = Math.abs(Number(o.monto || 0));
      const confiable = l.confiable === true;
      const reg = { saldo:l.saldo, monto:monto, suficiente: l.saldo + 0.5 >= monto, confiable:confiable, ts:Date.now(), raw:l.raw };
      // Una lectura dudosa se le dice al que mira, pero NO se guarda: la tarjeta de la lista mostraría
      // "saldo ⚠ no alcanza" con un 0 que en realidad es una lectura fallida.
      if(confiable){
        window._retiroSaldoCheck[clave] = reg;
        // La tarjeta de la lista muestra "saldo … ✓/⚠" con este mismo dato.
        try{ if(typeof window.v154pRenderSolicitudesPortalEnInicio==='function') window.v154pRenderSolicitudesPortalEnInicio(); }catch(_e){}
      } else reg.motivo = l.motivo;
      return reg;
    }finally{ _wdUnlock(); _drexGlobalUnlock(); }
  })();
  window._fichasLeyendo[clave] = lectura;
  lectura.then(function(){ delete window._fichasLeyendo[clave]; }, function(){ delete window._fichasLeyendo[clave]; });
  return lectura;
};

// ── LA lectura de fichas ────────────────────────────────────────────────────────────────────
// Todo lo que pregunta "cuántas fichas tiene este jugador" sin mover plata pasa por acá: el modal de
// retiro, el cartel de aprobar, "Ver", el escaneo de fondo, el relevo del watchdog y las cargas para
// reintentar. Eran cinco copias con cinco criterios: el escaneo podía creerle a una lectura con la
// sesión caída y el modal decía "no pudimos leer" cuando el jugador no existe en Agentes (Juan, 1/11:
// "claramente esto esta utilizando otra cosa"). Si el motor se para, se para acá y queda en NodoSalud.
//
// Devuelve { saldo, raw, confiable } o { motivo, error }; una lectura dudosa trae las dos cosas.
// No toma candados: de eso se encarga quien la llama.
async function leerFichasJugador(usuario){
  const salud = window.NodoSalud?.begin('RETIROS');
  let b;
  try{ b = await callDrex('buscarUsuario', usuario, { skipBalance:false }); }
  catch(e){
    salud?.reply(e);
    return { motivo:'sin_respuesta', error:'El casino no contestó. Probá de nuevo.' };
  }
  salud?.reply(null);
  if(!b){
    salud?.record('DATA', 'ERROR', 'FICHAS_SIN_RESPUESTA');
    return { motivo:'sin_respuesta', error:'El casino no contestó. Probá de nuevo.' };
  }
  // Sesión caída o página de error NO es "el usuario no existe".
  if(b.needsLogin || b.pageError){
    salud?.record('DATA', 'ERROR', 'FICHAS_SIN_SESION');
    return { motivo:'sesion', error:'Se cayó la sesión de Agentes: entrá de nuevo y volvé a leer' };
  }
  if(!b.exists){
    salud?.record('DATA', 'OK', 'USUARIO_INEXISTENTE');
    return { motivo:'no_existe', error:'El casino no encuentra al usuario ' + usuario };
  }
  if(typeof b.balance?.value !== 'number'){
    salud?.record('DATA', 'DEGRADED', 'FICHAS_ILEGIBLES');
    return { motivo:'ilegible', error:'No pude leer el saldo del jugador' };
  }
  const saldo = b.balance.value, raw = String(b.balance.raw || '').trim();
  // Se leyó DE VERDAD (no un 0 por lectura fallida o lenta).
  if(!/\d/.test(raw) || !Number.isFinite(saldo)){
    salud?.record('DATA', 'DEGRADED', 'FICHAS_ILEGIBLES');
    return { saldo:saldo, raw:raw, confiable:false, motivo:'ilegible', error:'No pude leer bien el saldo del jugador' };
  }
  salud?.record('DATA', 'OK');
  return { saldo:saldo, raw:raw, confiable:true };
}
window.leerFichasJugador = leerFichasJugador;
// Trigger conservador cada 90s (gated por TODOS los guards + 5 min por usuario).
try{ setInterval(function(){ try{ verificarSaldoRetiroOcioso(); }catch(_e){} }, 90000); }catch(_e){}

function abrirModalTransferirBilleteras(){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  const bilsConUid = billeteras.filter(function(b){ return b.CHUNIOR_UID && normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA'; });
  if(!bilsConUid.length){
    abrirModal('🔀 Transferir entre billeteras',
      '<div class="err-box">No hay billeteras con UID de Chunior. Sincronizá primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  function buildOpts(){
    return bilsConUid.map(function(b){
      return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '">' +
             escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
             '</option>';
    }).join('');
  }

  abrirModal(
    '🔀 Transferir entre billeteras',
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Mover fichas de una billetera a otra (útil para corregir cargas que quedaron en la billetera ERROR).</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">BILLETERA ORIGEN (sale plata)</label>' +
    '<select id="transferOrigen"><option value="">— Elegí origen —</option>' + buildOpts() + '</select>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">BILLETERA DESTINO (entra plata)</label>' +
    '<select id="transferDestino"><option value="">— Elegí destino —</option>' + buildOpts() + '</select>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">MONTO</label>' +
    '<input id="transferMonto" type="number" placeholder="ej: 5000" style="margin-bottom:6px">' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NOTAS (opcional)</label>' +
    '<textarea id="transferNotas" rows="2" placeholder="Ej: corrección de carga al usuario juan777"></textarea>' +
    '<div id="transferRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const origenId  = document.getElementById("transferOrigen")?.value;
      const destinoId = document.getElementById("transferDestino")?.value;
      const monto     = Number(document.getElementById("transferMonto")?.value || 0);
      const notas     = (document.getElementById("transferNotas")?.value || "").trim();
      const resEl     = document.getElementById("transferRes");
      const btn       = document.getElementById("modalSaveBtn");

      if(!origenId || !destinoId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Elegí origen y destino.</span>'; return;
      }
      if(origenId === destinoId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Origen y destino no pueden ser la misma billetera.</span>'; return;
      }
      if(!monto || monto <= 0){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Monto inválido.</span>'; return;
      }

      const bilOrigen  = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(origenId); });
      const bilDestino = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(destinoId); });
      if(!bilOrigen?.CHUNIOR_UID || !bilDestino?.CHUNIOR_UID){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Alguna billetera no tiene UID de Chunior.</span>'; return;
      }

      if(btn){ btn.disabled = true; btn.textContent = "Transfiriendo..."; }
      if(resEl) resEl.innerHTML = '<span class="small">Aplicando en Chunior...</span>';

      try {
        const r = await _transferirEntreBilleterasChunior(bilOrigen.CHUNIOR_UID, bilDestino.CHUNIOR_UID, monto, notas);
        if(r.ok){
          // Los saldos NO se tocan a mano: Chunior es la fuente de verdad y los repinta al
          // sincronizar. (Antes había acá dos llamadas a ajustarSaldoBilletera que no hacían
          // nada — la función está inerte desde que se sacó el contador paralelo.)

          // ASIENTO. Esto faltaba: la plata se movía en Chunior y de este lado no quedaba
          // rastro de quién la movió, entre qué billeteras ni por qué. Mismo formato que
          // tenían los MOV_BILLETERA del 8/8 ("ORIGEN → DESTINO"), más el N° de Chunior.
          // Va en try: si falla el registro, la transferencia ya se hizo y no se toca.
          try{
            await registrarEnHistorial({
              usuario: 'MOV BILLETERA',
              tipo: 'MOV_BILLETERA',
              monto: monto,
              billetera_id: bilOrigen.ID_BILLETERA || null,       // de dónde salió
              billetera_nombre: (bilOrigen.NOMBRE_VISIBLE||'?') + ' → ' + (bilDestino.NOMBRE_VISIBLE||'?'),
              origen: 'MANUAL',
              estado: 'OK',
              notas: 'Transferencia entre billeteras'
                     + (notas ? (' · ' + notas) : '')
                     + (bilDestino.ID_BILLETERA ? (' · destino_id=' + bilDestino.ID_BILLETERA) : '')
                     + (r.movimientoId ? (' · Chunior N° ' + r.movimientoId) : ' [SIN_N_CHUNIOR]'),
              chunior_movimiento_id: r.movimientoId || null
            });
          }catch(eHist){ console.warn('registrar MOV_BILLETERA:', eHist); }

          toast("✅ Transferencia OK · " + money(monto) + " · " + bilOrigen.NOMBRE_VISIBLE + " → " + bilDestino.NOMBRE_VISIBLE, "green");
          cerrarModal();
          renderBillerasInicio();
        } else {
          if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(r.error || 'Error') + '</div>';
          if(btn){ btn.disabled = false; btn.textContent = "Transferir"; }
        }
      } catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'sin detalle') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Transferir"; }
      }
    },
    'Transferir'
  );
}

// Modal NODO para cambiar la billetera de un movimiento ya registrado.
// El operador NUNCA ve Chunior — toda la maniobra se hace en background.

// ── Asiento del cambio de billetera ──────────────────────────────────────────
// Cambiar billetera SOBRESCRIBE: en Chunior pisa la cuenta destino del mismo N° de
// movimiento, y acá hace un update sobre historial_ops. La billetera anterior se perdía
// para siempre — no quedaba desde cuál se cambió, ni quién, ni cuándo.
//
// Esta función NO cambia nada de eso: solo deja el asiento aparte, antes de pisar.
// El update sigue igual. Va en try porque un fallo del registro nunca debe frenar una
// corrección que el operador necesita hacer.
// Corrige, en la solicitud, de DÓNDE salió la plata de ese pago.
// Cada pago de un retiro guarda el titular de la billetera que pagó: es el "te transfirió X" que ve
// el jugador en el portal y el dato con el que se cotea la cuenta. Al cambiar la billetera de un
// movimiento eso quedaba con la billetera vieja, así que la solicitud decía dos cosas distintas
// (arriba la nueva, en el pago la vieja) y el jugador buscaba una transferencia que no existía.
// Caso real: se intenta pagar de una cuenta, la transferencia no entra, se paga de otra (D-106).
async function _rehacerDesdeDelPago(solicitudId, filaAntes, bilNueva){
  if(!solicitudId || !bilNueva) return;
  try{
    const r = await supabaseClient.rpc('landing_retiro_cambiar_billetera_pago', {
      p_id: Number(solicitudId),
      p_monto: Math.abs(Number((filaAntes && filaAntes.monto) || 0)) || null,
      // El jugador ve el TITULAR de la cuenta, no el nombre interno de la billetera.
      p_desde: String(bilNueva.TITULAR || bilNueva.NOMBRE_VISIBLE || '').trim(),
      p_billetera: {
        billetera_id: String(bilNueva.ID_BILLETERA || ''),
        billetera_nombre: bilNueva.NOMBRE_VISIBLE || '',
        billetera_alias: bilNueva.CBU_ALIAS || bilNueva.ALIAS || '',
        billetera_cbu: bilNueva.CBU || '',
        billetera_titular: bilNueva.TITULAR || ''
      },
      p_fecha: (filaAntes && filaAntes.created_at) || null,
      p_operador: (window.operador && (window.operador.usuario || window.operador.nombre)) || 'panel'
    });
    if(r && r.error){
      toast('⚠ La billetera se cambió, pero el jugador sigue viendo la cuenta anterior · '+(r.error.message||'')+' · avisale','red');
      return;
    }
    const d = Array.isArray(r && r.data) ? r.data[0] : (r && r.data);
    if(d && d.pago_actualizado){
      toast('✓ El pago ahora figura desde '+(d.desde_nuevo||bilNueva.NOMBRE_VISIBLE)+' · el jugador ve la cuenta correcta','green');
    }
  }catch(e){
    toast('⚠ La billetera se cambió, pero no se pudo corregir de dónde salió el pago · '+(e.message||''),'red');
  }
}

async function _asentarCambioBilletera(datos){
  try{
    const desde = datos.bilAnteriorNombre || (datos.bilAnteriorId ? ('id ' + datos.bilAnteriorId) : '—');
    const hacia = datos.bilNuevaNombre || (datos.bilNuevaId ? ('id ' + datos.bilNuevaId) : '—');
    await registrarEnHistorial({
      usuario: 'CAMBIO BILLETERA',
      tipo: 'CAMBIO_BILLETERA',
      monto: Number(datos.monto || 0),
      billetera_id: datos.bilAnteriorId || null,     // la que estaba mal anotada
      billetera_nombre: desde + ' → ' + hacia,
      origen: datos.origen || 'MANUAL',
      estado: 'OK',
      notas: 'Cambio de billetera'
             + (datos.movId ? (' · Chunior N° ' + datos.movId) : ' · sin N° de Chunior')
             + (datos.bilNuevaId ? (' · destino_id=' + datos.bilNuevaId) : '')
             + (datos.historialId ? (' · historial_id=' + datos.historialId) : '')
             + (datos.solicitudId ? (' · solicitud=' + datos.solicitudId) : ''),
      chunior_movimiento_id: datos.movId || null
    });
  }catch(e){ console.warn('asentar CAMBIO_BILLETERA:', e); }
}

function cambiarBilleteraHistorialLocal(historialId, currentBilId, solicitudId){
  const bils = billeteras.filter(function(b){
    return normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA';
  });
  const opciones = bils.map(function(b){
    const sel = String(b.ID_BILLETERA) === String(currentBilId) ? ' selected' : '';
    return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '"' + sel + '>' +
           escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
           '</option>';
  }).join('');

  if(!historialId && !solicitudId){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No se pudo identificar la operación.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }
  if(!bils.length){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No hay billeteras activas disponibles.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  abrirModal(
    '💳 Cambiar billetera · Historial',
    '<div class="alert-box" style="padding:10px;font-size:12px">Esta operación no tiene N° de movimiento Chunior. Se corrige la billetera en NODO / historial / portal. Si también hubo movimiento en Chunior, corregilo desde Chunior o usá la fila con N°.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA</label>' +
    '<select id="cambioBilLocalSel">' + opciones + '</select>' +
    '<div id="cambioBilLocalRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const sel   = document.getElementById("cambioBilLocalSel");
      const resEl = document.getElementById("cambioBilLocalRes");
      const btn   = document.getElementById("modalSaveBtn");
      const nuevoBilId = sel?.value;
      const bilNueva = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(nuevoBilId); });
      if(!bilNueva){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Seleccioná una billetera.</span>';
        return;
      }
      if(btn){ btn.disabled = true; btn.textContent = "Guardando..."; }
      // UUID validation: historial_ops.id is uuid — reject numeric/non-uuid strings
      const historialIdUUID = (historialId && /^[0-9a-f-]{32,}$/i.test(historialId) && historialId.includes('-')) ? historialId : '';
      try{
        let _antesLocal = null;
        if(historialIdUUID){
          // Leer antes de pisar, igual que en el camino con N° de Chunior.
          try{
            const q = await supabaseClient.from("historial_ops")
              .select("monto,billetera_id,billetera_nombre,created_at")
              .eq("id", historialIdUUID).maybeSingle();
            _antesLocal = (q && q.data) ? q.data : null;
          }catch(_e){}
          const upd = await supabaseClient.from("historial_ops")
            .update({ billetera_id: nuevoBilId, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
            .eq("id", historialIdUUID);
          if(upd.error) throw new Error(upd.error.message || 'No se pudo actualizar historial_ops');
        }
        await _asentarCambioBilletera({
          movId: null,                                  // este camino es el que NO tiene N°
          historialId: historialIdUUID || null,
          solicitudId: solicitudId || null,
          monto: _antesLocal ? _antesLocal.monto : 0,
          bilAnteriorId: _antesLocal ? _antesLocal.billetera_id : (currentBilId || null),
          bilAnteriorNombre: _antesLocal ? _antesLocal.billetera_nombre : null,
          bilNuevaId: nuevoBilId,
          bilNuevaNombre: bilNueva.NOMBRE_VISIBLE,
          origen: 'MANUAL_LOCAL'
        });

        if(solicitudId){
          try{
            const metaPatch = {
              billetera_id: nuevoBilId,
              billetera_nombre: bilNueva.NOMBRE_VISIBLE,
              billetera_alias: bilNueva.CBU_ALIAS || bilNueva.ALIAS || '',
              billetera_cbu: bilNueva.CBU || '',
              billetera_banco: bilNueva.TIPO || '',
              billetera_cambiada_panel: true
            };
            const solRow = await supabaseClient.from("landing_solicitudes").select("metadata").eq("id", solicitudId).maybeSingle();
            const metaActual = (solRow && solRow.data && solRow.data.metadata) ? solRow.data.metadata : {};
            await supabaseClient.from("landing_solicitudes")
              .update({ metadata: {...metaActual, ...metaPatch} })
              .eq("id", solicitudId);
          }catch(eMeta){ console.warn("update landing_solicitudes metadata local:", eMeta); }
          // Y de DÓNDE salió la plata de ese pago: el dato que ve el jugador y con el que se cotea (D-106).
          await _rehacerDesdeDelPago(solicitudId, _antesLocal, bilNueva);
        }

        toast("✅ Billetera actualizada en historial", "green");
        cerrarModal();
        await cargarHistorial();
      }catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'Error') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Guardar"; }
      }
    },
    'Guardar'
  );
}


function cambiarBilleteraMovimiento(movId, historialId, currentBilId){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  if(!movId){ toast("Esta operación no tiene movimiento de Chunior", "red"); return; }

  // Construir opciones del select: solo billeteras con CHUNIOR_UID configurado
  const bilsConUid = billeteras.filter(function(b){ return b.CHUNIOR_UID && normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA'; });
  const opciones = bilsConUid.map(function(b){
    const sel = String(b.ID_BILLETERA) === String(currentBilId) ? ' selected' : '';
    return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '"' + sel + '>' +
           escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
           '</option>';
  }).join('');

  if(!bilsConUid.length){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No hay billeteras configuradas con UID de Chunior. Sincronizá billeteras primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  abrirModal(
    '💳 Cambiar billetera · Mov. N° ' + escapeHtml(String(movId)),
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Elegí la nueva billetera destino. Se actualiza en Chunior y en el historial automáticamente.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA</label>' +
    '<select id="cambioBilSel">' + opciones + '</select>' +
    '<div id="cambioBilRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const sel   = document.getElementById("cambioBilSel");
      const resEl = document.getElementById("cambioBilRes");
      const btn   = document.getElementById("modalSaveBtn");
      const nuevoBilId = sel?.value;
      if(!nuevoBilId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Seleccioná una billetera.</span>';
        return;
      }
      const bilNueva = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(nuevoBilId); });
      if(!bilNueva || !bilNueva.CHUNIOR_UID){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">La billetera no tiene UID de Chunior.</span>';
        return;
      }
      if(btn){ btn.disabled = true; btn.textContent = "Cambiando..."; }
      if(resEl) resEl.innerHTML = '<span class="small">Aplicando cambio en Chunior...</span>';
      try {
        const r = await _cambiarBilleteraChunior(movId, bilNueva.CHUNIOR_UID);
        if(r.ok){
          // Leer la fila ANTES de pisarla: el update borra la billetera anterior y el
          // monto, que son justo los datos que hacen falta para auditar el cambio.
          let _antes = null;
          if(historialId){
            try{
              const q = await supabaseClient.from("historial_ops")
                .select("monto,billetera_id,billetera_nombre,solicitud_id,created_at")
                .eq("id", historialId).maybeSingle();
              _antes = (q && q.data) ? q.data : null;
            }catch(_e){}
          }
          // Actualizar la fila en historial_ops
          if(historialId){
            try {
              await supabaseClient.from("historial_ops")
                .update({ billetera_id: nuevoBilId, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
                .eq("id", historialId);
            } catch(eUpd){ console.warn("update historial_ops:", eUpd); }
          }
          await _asentarCambioBilletera({
            movId: movId,
            historialId: historialId,
            solicitudId: _antes ? _antes.solicitud_id : null,
            monto: _antes ? _antes.monto : 0,
            bilAnteriorId: _antes ? _antes.billetera_id : (currentBilId || null),
            bilAnteriorNombre: _antes ? _antes.billetera_nombre : null,
            bilNuevaId: nuevoBilId,
            bilNuevaNombre: bilNueva.NOMBRE_VISIBLE
          });
          // De DÓNDE salió la plata, en la solicitud: es lo que ve el jugador ("te transfirió X") y
          // con lo que se cotea la cuenta. Este camino no tocaba la solicitud, así que quedaba
          // nombrando la billetera vieja y el jugador buscaba una transferencia inexistente (D-106).
          await _rehacerDesdeDelPago(_antes ? _antes.solicitud_id : null, _antes, bilNueva);
          const tagMov = r.movId ? ' (N° ' + r.movId + ')' : '';
          toast("✅ Billetera cambiada · " + bilNueva.NOMBRE_VISIBLE + tagMov, "green");
          cerrarModal();
          await cargarHistorial();
        } else {
          if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(r.error || 'Error') + '</div>';
          if(btn){ btn.disabled = false; btn.textContent = "Cambiar billetera"; }
        }
      } catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'sin detalle') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Cambiar billetera"; }
      }
    },
    'Cambiar billetera'
  );
}

async function _crearBilleterasNuevasChunior(nuevas){
  let _err=null;
  for(const w of nuevas){
    const { error } = await supabaseClient.rpc('panel_billetera_insert',{p_secret:window.PANEL_DATA_SECRET,p_patch:{
      nombre_visible: w.nombre,
      chunior_uid: String(w.uid),
      saldo: w.saldo,
      pc_codigo: pcOperativa,
      activa: true,
      cbu_alias: '',
      titular: '',
      tipo: ''
    }});
    if(error) _err=error;
  }
  if(_err){
    toast('Error al crear billeteras: '+_err.message, 'red');
    return;
  }
  toast('🆕 '+nuevas.length+' billetera(s) agregada(s). Completá CBU, titular y alias en Administrar billeteras.', 'blue');
  // Mostrar también una notificación más visible
  const alertas = document.getElementById('alertas');
  if(alertas){
    const lista = nuevas.map(function(w){ return escapeHtml(w.nombre); }).join(', ');
    alertas.innerHTML += '<div class="alert-box" style="background:#1a3a5a;color:#cde0ff">⚠️ Nuevas billeteras de Chunior: <b>'+lista+'</b>. Falta cargar CBU, titular y alias en Administrar billeteras.</div>';
  }
}

function chuniorNav(path){
  if(window.chunior) window.chunior.navigate(CHUNIOR_BASE + path);
}

// ── Macros del chat ───────────────────────────────────────────────────────────
