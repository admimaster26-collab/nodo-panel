function abrirModal(title,body,saveFn,saveText="Guardar"){
  setBox("modalTitle",title);setBox("modalBody",body);
  const btn=document.getElementById("modalSaveBtn");
  btn.innerText=saveText;
  btn.disabled=false;
  btn.style.opacity='';
  // Sin texto (abrirModal(…, null, '')) el que llama no quiere botón: quedaba uno azul vacío.
  btn.style.display = saveText ? '' : 'none';
  // Siempre limpiar onclick antes de asignar el nuevo — evita contaminación entre modales
  btn.onclick = saveFn || null;
  // Restaurar el botón Cancelar al comportamiento por defecto
  const cancelBtn=document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn) cancelBtn.onclick=function(){ cerrarModal(); };
  document.getElementById("modalOverlay").classList.remove("hidden");
}
function cerrarModal(){document.getElementById("modalOverlay").classList.add("hidden")}

// ── Automatización (solo disponible en Electron) ──────────────────────────────
const enElectron = !!window.ctrlElectron;

if(enElectron){
  document.getElementById("navAuto")?.classList.remove("hidden");
  document.getElementById("agentBalanceCard")?.classList.remove("hidden");
  // navVerificaciones ya no existe (apartado eliminado) — el ?. lo deja sin efecto igual.
}

// ── Saldo del agente (widget del sidebar) ─────────────────────────────────────
async function refrescarSaldoAgente(){
  if(!enElectron) return;
  const el = document.getElementById("agentBalanceVal");
  // Esto es un WIDGET: no puede meterse en el medio de una operación. La cola de Agentes serializa
  // llamada por llamada, pero una carga son dos llamadas (buscar el usuario y después cargarle), y
  // este refresco de cada 60 s se colaba justo en el medio. En BET300 leer las fichas obliga a irse
  // a "tokens-report" y volver, así que la pantalla se movía abajo de la operación: el panel lo veía
  // como "la página se recargó durante la operación", reintentaba, y al minuto volvía a pasar. Ese
  // es el loop corto que siguen reportando las oficinas de BET300 (H-7).
  const _conCandado = typeof _drexGlobalLock === 'function' && typeof _drexGlobalUnlock === 'function';
  if(_conCandado && !_drexGlobalLock('saldo del agente')){
    if(el && !el.textContent.trim()) el.textContent = "—";
    return;                               // hay algo operando: se lee en el próximo minuto
  }
  if(el) el.textContent = "Cargando...";
  try{
    await window.ctrlElectron.openAgentWindow();
    const r = await callDrex("obtenerSaldoAgente");
    if(r && r.balance && r.balance.raw){ if(el) el.textContent = r.balance.raw.trim(); }
    else if(r && r.needsLogin){ if(el) el.textContent = "🔐 Login"; }
    else { if(el) el.textContent = "—"; }
  }catch(e){
    if(el) el.textContent = "⚠ Error";
  }finally{
    if(_conCandado) _drexGlobalUnlock();
  }
}
if(enElectron){
  // Refresca el saldo del agente cada 60 segundos
  setInterval(refrescarSaldoAgente, 60000);
  setTimeout(refrescarSaldoAgente, 4000); // 4s después del load inicial
}

// Rechequeo MANUAL de fichas (portado de NexoBetaChan): relee Drex + Chunior y compara AHORA.
window.rechequearFichas = async function(){
  if(typeof _watchdogPoll !== 'function') return;
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0){ try{ toast('Hay una operación en curso · se compara al terminar', 'yellow'); }catch(_e){} return; }
  try{ toast('Releyendo fichas de Drex y Chunior...', 'blue'); }catch(_e){}
  try{ await _watchdogPoll(); }catch(_e){}
};
// ── Watchdog de fichas: detecta diferencias entre Drex y Chunior ────────────
// Cada 60s lee ambos saldos y los compara. En operaciones normales se mueven en
// direcciones OPUESTAS con el mismo monto (carga: Drex -X, Chunior +X). Si no
// se cumple, hay alguien moviendo plata fuera de NODO o una carga repetida.
const _watchdog = {
  drexFichas: null,      // último Saldo agente leído de Drex (= fichas del agente)
  chuniorFichas: null,   // último "Saldo Fichas" leído de Chunior (mismo concepto)
  lastCheck: null,
  intervalId: null,
  alertaActiva: false,
  // Recovery
  drexLoginInProgress: false,   // evita abrir el modal de login Drex más de una vez
  chuniorFails: 0,              // contador de polls consecutivos sin Chunior
  chuniorRecoveryScheduled: false,
  // Lock: si una operación está usando la ventana de agentes, el watchdog
  // NO debe hacer su poll (porque navega la página y rompe la operación).
  busy: 0                        // contador (soporta operaciones anidadas)
};

// Helpers para que las operaciones se anuncien al watchdog
// ── Relevo watchdog → revisión de fichas de retiros ──────────────────────────────────────────
// Cuando el watchdog termina de leer, avisa acá: "ya terminé, empezá lo tuyo". Es un RELEVO, no
// paralelismo — corre después del ciclo, nunca encimado. Y sólo si el agente está libre: si hay
// otra solicitud en proceso, esto se saltea y espera al próximo ciclo (pasa cada pocos minutos,
// no hay apuro). Objetivo: confirmar que las fichas del retiro salieron de verdad de Agentes.
let _revFichasUltimo = 0;
function _revisarFichasRetirosTrasWatchdog(){
  if(Date.now() - _revFichasUltimo < 60000) return;          // como mucho una vez por minuto
  if(_watchdog.busy > 0) return;                             // el agente sigue tomado
  if(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes > 0)) return;
  if(window._v154pParcialBusy) return;                       // hay un parcial en curso
  if(window._cotejoDeclarando) return;
  if(window._retiroV2) return;                               // hay un modal de retiro abierto
  const sols = (window.V154P && V154P.solicitudes) || [];
  const pend = sols.filter(function(s){
    if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase() !== 'RETIRO') return false;
    return /EN_PROCESO|EN_REVISION|PROCESANDO|TOMAD/.test(String(s.ESTADO||'').toUpperCase());
  });
  if(!pend.length) return;                                   // no hay retiro que revisar
  _revFichasUltimo = Date.now();
  try{ window._revisarFichasRetiros && window._revisarFichasRetiros(pend); }catch(_e){}
}
window._revisarFichasRetirosTrasWatchdog = _revisarFichasRetirosTrasWatchdog;

// Confirma contra Agentes que las fichas del retiro salieron de verdad. Es SOLO LECTURA: lee el
// saldo del jugador y avisa. No aprueba, no anota, no toca plata — si algo no cuadra decide el
// operador. Revisa de a UN retiro por ciclo para no acaparar el agente.
window._revisarFichasRetiros = async function(pendientes){
  if(!Array.isArray(pendientes) || !pendientes.length) return;
  if(!window.ctrlElectron) return;
  const s = pendientes[0];
  const usuario = String(s.USUARIO||'').trim(); if(!usuario) return;
  if(!_drexGlobalLock('rev-fichas-retiro')) return;   // alguien lo tomó entre medio → al próximo ciclo
  _wdLock();
  try{
    const lectura = await window.leerFichasJugador(usuario);
    if(lectura.confiable !== true) return;
    const saldo = lectura.saldo;
    const pp = window._retiroParcialInfo ? window._retiroParcialInfo(s) : null;
    const falta = pp ? pp.restante : Number(s.MONTO_REAL||s.MONTO_DECLARADO||0);
    // Lo único que importa acá: ¿le quedaron fichas como para cubrir lo que todavía se le debe?
    // Si NO le alcanzan, el retiro no se puede terminar y el operador tiene que saberlo antes de
    // sentarse a transferir.
    if(falta > 0 && saldo + 0.5 < falta){
      try{ toast('⚠ '+usuario+': quedan '+money(falta)+' por pagar pero tiene '+money(saldo)+' en fichas','yellow'); }catch(_e){}
      console.warn('[rev-fichas] '+usuario+' · restan '+falta+' · fichas '+saldo);
    } else {
      console.log('[rev-fichas] '+usuario+' OK · restan '+falta+' · fichas '+saldo);
    }
    s.__fichasRevisadas = { saldo:saldo, ts:Date.now() };
  }catch(e){ console.warn('[rev-fichas] falló:', e.message||e); }
  finally{ _wdUnlock(); _drexGlobalUnlock(); }
};

function _wdLock(){   _watchdog.busy++; }
function _wdUnlock(){ if(_watchdog.busy > 0) _watchdog.busy--; }
// Reset duro a 0 — para los puntos de limpieza GARANTIZADA al final de una operación (o su
// timeout de seguridad), sin depender de contar bien cuántos _wdLock() anidados quedaron
// pendientes. Evita dejar el watchdog trabado para siempre por un desbalance de conteo.
function _wdForceUnlock(){ _watchdog.busy = 0; }

function _wdParseMontoAR(s){
  const m = String(s||'').match(/\$\s*([\d.,]+)/);
  if(!m) return null;
  const n = parseFloat(m[1].replace(/\./g,'').replace(',','.'));
  return isNaN(n) ? null : n;
}

// Lee el saldo de fichas del agente desde los DOS sistemas:
//   - Drex: agentBalance (lo que la página de agentes dice que tiene el agente)
//   - Chunior: "Saldo Fichas: $X" del header (lo que Chunior dice que tiene el agente)
// Estos DOS valores representan LO MISMO desde dos sistemas → deben matchear siempre.
// Las billeteras MP son cash, no fichas — no entran acá.
async function _watchdogLeer(){
  let drexFichas = null, chuniorFichas = null;
  // Si el panel YA sabe que no hay sesión, la cola cancela la lectura de abajo sin tocar Agentes y
  // r queda vacío: el poll caía en «Sin lectura de Drex» en vez de en la rama que abre el login, y
  // como nada más lo detectaba, quedaba encerrado ahí para siempre. Se arranca sabiéndolo.
  let drexNeedsLogin = !!window._drexSinSesion;
  let chuniorReachable = false;
  try {
    // La lectura de fichas es PERIÓDICA: si la cola está ocupada, SALTEA esta vuelta en vez de
    // encolarse (así no se apilan lecturas viejas que después se disparan todas juntas: era el
    // "vuelve a lanzarse"). Y si corre, va POR LA COLA — antes iba directo y se metía en medio de
    // una carga/retiro, navegando la ventana y volándole el modal a la operación en curso.
    const _colaOcupada = !!(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes > 0));
    if(window.ctrlElectron?.drexAutomation && !_colaOcupada){
      const _wdHealth = window.NodoSalud?.begin('WORKERS');
      const r = await _drexEncolar('obtenerSaldoAgente(watchdog)', function(){
        return window.ctrlElectron.drexAutomation('obtenerSaldoAgente');
      }, { silencioso:true });   // tarea de fondo: no molesta al operador con toasts
      _wdHealth?.record('ALIVE', r ? 'OK' : 'DEGRADED', 'WATCHDOG_POLL');
      if(r){
        if(r.needsLogin) drexNeedsLogin = true;
        if(r.balance && typeof r.balance.value === 'number') drexFichas = r.balance.value;
      }
    } else if(_colaOcupada){
      console.log('[watchdog] fichas: hay una operación en curso → se saltea esta vuelta');
    }
  } catch(_){}
  try {
    if(window.chunior){
      const data = await window.chunior.exec(
        '(function(){' +
          // Buscar "Saldo Fichas: $X" (con o sin "Fichas"/"Ficha" y con ":" opcional)
          'var bodyText = document.body.textContent || "";' +
          'var fichas = null;' +
          'var sm = bodyText.match(/Saldo\\s*Fichas?\\s*:?\\s*\\$\\s*([\\d.,]+)/i);' +
          'if(sm){ var n = parseFloat(sm[1].replace(/\\./g,"").replace(",",".")); if(!isNaN(n)) fichas = n; }' +
          'var ok = !!(document.querySelector(".breadcrumbs") || document.getElementById("id_username") || document.getElementById("id_pt"));' +
          'return { fichas: fichas, reachable: ok };' +
        '})()'
      );
      if(data){
        chuniorReachable = !!data.reachable;
        if(typeof data.fichas === 'number') chuniorFichas = data.fichas;
      }
    }
  } catch(_){}
  return { drexFichas, chuniorFichas, drexNeedsLogin, chuniorReachable };
}

function _wdActualizarUI(estado, texto){
  const ind = document.getElementById("watchdogIndicator");
  if(ind){
    ind.className = estado || '';
    ind.textContent = texto;
  }
  try{ renderFichasInicio(estado, texto); }catch(_e){}
}

// Banner para diferencia absoluta (Drex saldo agente != Chunior Saldo Fichas)
function _wdMostrarBannerAbs(info){
  _watchdog.alertaActiva = true;
  _watchdog.drexFichas = info.drex;
  _watchdog.chuniorFichas = info.chunior;
  try{ renderFichasInicio('alerta','Diferencia detectada'); }catch(_e){}
  let banner = document.getElementById("watchdogBanner");
  if(!banner){
    banner = document.createElement('div');
    banner.id = "watchdogBanner";
    document.body.appendChild(banner);
  }
  const drexTxt    = money(info.drex);
  const chuniorTxt = money(info.chunior);
  const diffTxt    = (info.diff >= 0 ? '+' : '−') + money(Math.abs(info.diff));
  banner.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:18px">⚠️</span>' +
      '<span><b>DIFERENCIA de fichas detectada</b><br>' +
        '<span style="font-weight:400;font-size:12px">' +
          'Drex: <b>'+drexTxt+'</b> · Chunior: <b>'+chuniorTxt+'</b> · Diferencia: <b>'+diffTxt+'</b> · '+
          formatFecha(new Date().toISOString()) +
        '</span>' +
      '</span>' +
    '</div>' +
    '<button onclick="_wdDismissBanner()">Entendido</button>';
  toast('⚠️ Drex '+drexTxt+' ≠ Chunior '+chuniorTxt+' (Δ '+diffTxt+')', 'red');
}

function _wdDismissBanner(){
  const b = document.getElementById("watchdogBanner");
  if(b) b.remove();
  _watchdog.alertaActiva = false;
}

async function _watchdogPoll(){
  // Si una operación NODO está usando la ventana de agentes, NO pollear
  // (un obtenerSaldoAgente navega la página y rompe la operación en curso).
  if(_watchdog.busy > 0){
    _wdActualizarUI('', '⏸ Operación en curso · próximo check al terminar');
    return;
  }

  const ahora = await _watchdogLeer();

  // ── Recovery Drex: sesión cerrada → modal de login ──────────────────────
  if(ahora.drexNeedsLogin){
    // Todo por el mismo camino: deja el cartel fijo y vuelve a ofrecer el login con espacio entre
    // pedidos. Antes esto abría el modal por su cuenta y, si el operador lo cerraba,
    // drexLoginInProgress quedaba en true y no se lo pedía nunca más.
    try{ if(window._drexMarcarSinSesion) window._drexMarcarSinSesion('watchdog'); }catch(_e){}
    _wdActualizarUI('alerta', '🔐 Login de agentes requerido');
    return;
  }

  // ── Recovery Chunior: 3 fallos consecutivos ─────────────────────────────
  // ANTES: location.reload() del panel ENTERO a los 4s, sin mirar si había una
  // operación en vuelo → podía matar una carga a mitad de camino, y era otra
  // fuente de refresh automático. AHORA: se recarga SOLO la ventana de Chunior
  // (chunior.reload la recrea si está cerrada). El reload total del panel queda
  // como último recurso, únicamente si tras recargar Chunior sigue inalcanzable
  // y NO hay operación en curso.
  if(!ahora.chuniorReachable){
    _watchdog.chuniorFails++;
    _wdActualizarUI('alerta', '⚠ Chunior inalcanzable ('+_watchdog.chuniorFails+'/3)');
    if(_watchdog.chuniorFails >= 3 && !_watchdog.chuniorRecoveryScheduled){
      _watchdog.chuniorRecoveryScheduled = true;
      toast("⚠️ Chunior no responde · recargando la ventana de Chunior...", "red");
      Promise.resolve(window.chunior && window.chunior.reload()).then(function(){
        _watchdog.chuniorFails = 0;            // darle una nueva ronda de 3 chequeos
        _watchdog.chuniorRecoveryScheduled = false;
      }).catch(function(){
        // La ventana no se pudo recuperar → reinicio total, pero NUNCA con una
        // operación en vuelo (esperamos a que el candado se libere).
        (function reintentarReloadTotal(){
          if(_watchdog.busy > 0){ setTimeout(reintentarReloadTotal, 3000); return; }
          toast("⚠️ Chunior irrecuperable · Reiniciando NODO en 4s...", "red");
          setTimeout(function(){ if(_watchdog.busy > 0){ reintentarReloadTotal(); return; } location.reload(); }, 4000);
        })();
      });
    }
    return;
  }
  _watchdog.chuniorFails = 0;
  _watchdog.chuniorRecoveryScheduled = false;

  // Si falta alguna lectura, mostrar estado pero no comparar
  if(ahora.drexFichas === null || ahora.chuniorFichas === null){
    const falta = ahora.drexFichas === null ? 'Drex' : 'Chunior "Saldo Fichas"';
    _wdActualizarUI('', '⏸ Sin lectura de ' + falta);
    return;
  }

  // ── Comparación ABSOLUTA: Drex saldo agente == Chunior Saldo Fichas ──
  const diff = ahora.drexFichas - ahora.chuniorFichas;
  const TOL  = 1; // $1 de tolerancia para redondeos
  const matchOk = Math.abs(diff) <= TOL;

  _watchdog.drexFichas    = ahora.drexFichas;
  _watchdog.chuniorFichas = ahora.chuniorFichas;
  _watchdog.lastCheck     = Date.now();
  // El watchdog terminó su lectura y suelta el agente. Le pasa la posta a la revisión de fichas
  // de los retiros: DESPUÉS de este, nunca encimado. El watchdog sólo lee, así que no hay riesgo
  // de que dos cosas escriban plata — pero igual va en relevo, no en paralelo.
  try{ _revisarFichasRetirosTrasWatchdog(); }catch(_e){}

  const horaCheck = new Date().toLocaleTimeString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', hour:'2-digit', minute:'2-digit' });
  const fmt = function(v){ return money(v).replace('$ ','$'); };

  if(matchOk){
    if(_watchdog.alertaActiva){ _wdDismissBanner(); }
    _wdActualizarUI('ok',
      '✓ Fichas OK · Drex '+fmt(ahora.drexFichas)+' = Chunior '+fmt(ahora.chuniorFichas)+' · '+horaCheck
    );
    _watchdog.pendingReconfirm = false;
    return;
  }

  // ── Diferencia detectada — puede ser TRANSITORIA ──
  // Chunior tarda en propagar el "Saldo Fichas" del breadcrumb. Re-leemos en 4s.
  // Si en la 2da lectura coinciden, era transitoria. Si siguen sin coincidir → alerta REAL.
  if(!_watchdog.pendingReconfirm){
    _watchdog.pendingReconfirm = true;
    console.log('[watchdog] diferencia detectada · Drex='+ahora.drexFichas+' Chunior='+ahora.chuniorFichas+' diff='+diff+' · re-confirmando en 4s...');
    _wdActualizarUI('', '⏳ Verificando fichas (puede ser transitorio)...');
    setTimeout(async function(){
      const recheck = await _watchdogLeer();
      _watchdog.pendingReconfirm = false;
      if(recheck.drexFichas === null || recheck.chuniorFichas === null){
        _wdActualizarUI('', '⏸ Re-check abortado · sin lectura');
        return;
      }
      const diffR    = recheck.drexFichas - recheck.chuniorFichas;
      const horaR    = new Date().toLocaleTimeString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', hour:'2-digit', minute:'2-digit' });
      if(Math.abs(diffR) <= TOL){
        // Era transitorio
        console.log('[watchdog] diferencia transitoria resuelta · diff_final=' + diffR);
        _watchdog.drexFichas    = recheck.drexFichas;
        _watchdog.chuniorFichas = recheck.chuniorFichas;
        _wdActualizarUI('ok',
          '✓ Fichas OK · Drex '+fmt(recheck.drexFichas)+' = Chunior '+fmt(recheck.chuniorFichas)+' · '+horaR+' (re-confirmado)'
        );
      } else {
        // Diferencia CONFIRMADA después del re-check
        console.warn('[watchdog] DIFERENCIA CONFIRMADA tras re-check · diff=' + diffR);
        _watchdog.drexFichas    = recheck.drexFichas;
        _watchdog.chuniorFichas = recheck.chuniorFichas;
        _wdActualizarUI('alerta',
          '⚠ DIFERENCIA · Drex '+fmt(recheck.drexFichas)+' ≠ Chunior '+fmt(recheck.chuniorFichas)+' (Δ '+fmt(Math.abs(diffR))+')'
        );
        _wdMostrarBannerAbs({
          drex: recheck.drexFichas,
          chunior: recheck.chuniorFichas,
          diff: diffR
        });
      }
    }, 4000);
  }
}

function _watchdogIniciar(){
  if(_watchdog.iniciado) return;
  _watchdog.iniciado = true;
  // Lectura inicial para tener baseline en la UI
  setTimeout(_watchdogPoll, 8000);
  // YA NO hay polling periódico — los saldos solo cambian con cargas/retiros,
  // así que disparamos el check después de cada operación (ver _watchdogTrigger).
}

// Trigger debounced: se llama después de cada operación. Espera unos segundos
// para que Chunior alcance a actualizar su "Saldo Fichas" y después compara.
let _watchdogTriggerTimer = null;
function _watchdogTrigger(delayMs){
  if(_watchdog.busy > 0){
    // Si hay otra operación en curso, postergamos
    clearTimeout(_watchdogTriggerTimer);
    _watchdogTriggerTimer = setTimeout(function(){ _watchdogTrigger(1500); }, 2000);
    return;
  }
  clearTimeout(_watchdogTriggerTimer);
  _watchdogTriggerTimer = setTimeout(_watchdogPoll, delayMs || 3000);
}

if(enElectron){
  // Arranca el watchdog 12s después del load (da tiempo a que la ventana de Chunior esté lista)
  setTimeout(_watchdogIniciar, 12000);
}
