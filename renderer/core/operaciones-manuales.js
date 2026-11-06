async function soloConsultarUsuario(){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const usuario = (document.getElementById("manualUsuario")?.value||"").trim();
  if(!usuario){ toast("Ingresá un usuario para consultar.","red"); return; }
  const res = document.getElementById("manualResultado");
  if(res) res.innerHTML = '<div class="alert-box">Consultando...</div>';
  try {
    await window.ctrlElectron.openAgentWindow();
    const busqueda = await callDrex("buscarUsuario", usuario);
    if(!busqueda.exists){
      if(res) res.innerHTML = '<div class="err-box">❌ <b>'+escapeHtml(usuario)+'</b> no existe en el casino.</div>';
      return;
    }
    const saldo = busqueda.balance?.raw || "sin datos";
    if(res) res.innerHTML = '<div class="ok-box">✅ <b>'+escapeHtml(usuario)+'</b> — Saldo: <b>'+escapeHtml(saldo)+'</b></div>';
    toast(usuario+": "+saldo, "green");
    await registrarEnHistorial({usuario, tipo:'CONSULTA', monto:0, origen:'MANUAL', estado:'OK', notas:saldo});
  } catch(e) {
    const _m = (e && (e.message||String(e))) || 'sin detalle';
    const _esTimeout = /timeout|tard[oó] demasiado|timed out/i.test(_m);
    const _esIpc = /invoking remote method/i.test(_m);
    const _txt = _esTimeout ? '⏱️ La consulta tardó demasiado (el casino puede estar lento). Reintentá.'
      : _esIpc ? '⚠️ No se pudo consultar (la ventana de agentes no respondió). Revisá que esté abierta y reintentá.'
      : 'Error: '+escapeHtml(_m);
    if(res) res.innerHTML = '<div class="err-box">'+_txt+'</div>';
    toast(_esTimeout?'Consulta lenta · reintentá':'Error al consultar.','red');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ⛔ FLUJO BLINDADO — NO MODIFICAR ⛔
// Esta función y su cadena (buscarUsuario, applyAmount, registrarCargaEnChunior,
// navigateAgentTo, _leerBalancesEnModalDeposito) son el CORE de carga/retiro que
// funciona 100%. Probado y estable (tag git: estable-flujo-carga).
// Para features nuevas: agregar funciones APARTE y llamarlas desde acá si hace
// falta, pero NO reescribir la lógica de este flujo. Si lo rompés, volvé con:
//   git checkout estable-flujo-carga -- "NODO · OPERATIVO LITE.htm" agent-preload.js main.js
// ══════════════════════════════════════════════════════════════════════════════
// ── Candado GLOBAL de automatización en Agentes ───────────────────────────────
// _operacionManualEnCurso, _portalSolicitudOperacionEnCurso, etc. cada uno solo evita
// re-entrar a SU PROPIA función (anti-doble-click) — pero no se enteran entre sí. Eso
// dejaba pasar una carga MANUAL y una aprobación de PORTAL corriendo a la vez contra la
// MISMA ventana de Agentes → colisión real (una se aplica, la otra falla/rechaza, mismo
// usuario, casi el mismo segundo — visto en producción 2026-07-03). Este candado es
// compartido por todos los flujos que tocan la ventana de Agentes.
window._drexGlobalBusy = false;
window._drexGlobalBusyMotivo = null;
window._drexGlobalBusyDesde = 0;
// Un candado sin vencimiento se queda tomado PARA SIEMPRE si la operación que lo tomó muere sin
// soltarlo (una excepción, la ventana cerrada, un preload colgado). Y el panel queda contestando
// "hay otra operación corriendo" sin que haya ninguna — sin forma de salir. Pasó.
// Ahora el candado se anota CUÁNDO se tomó y se suelta solo si quedó viejo.
const _DREX_LOCK_MAX_MS = 150000;   // 2,5 min · más que la tarea más larga (120s de la cola)
function _drexGlobalLock(motivo){
  if(window._drexGlobalBusy){
    const held = Date.now() - (window._drexGlobalBusyDesde||0);
    if(held > _DREX_LOCK_MAX_MS){
      // Candado vencido: lo tomó algo que nunca lo devolvió. Se libera y se avisa, en vez de
      // dejar el panel trabado esperando a alguien que ya no está.
      console.warn('[lock] candado vencido tras '+Math.round(held/1000)+'s ("'+(window._drexGlobalBusyMotivo||'?')+'") → liberado solo');
      try{ toast('🔓 Se destrabó solo: "'+(window._drexGlobalBusyMotivo||'una operación')+'" quedó colgada hace '+Math.round(held/1000)+'s','yellow'); }catch(_e){}
    } else {
      return false;
    }
  }
  window._drexGlobalBusy = true;
  window._drexGlobalBusyMotivo = motivo || '';
  window._drexGlobalBusyDesde = Date.now();
  return true;
}
function _drexGlobalUnlock(){ window._drexGlobalBusy = false; window._drexGlobalBusyMotivo = null; window._drexGlobalBusyDesde = 0; }
// Qué está pasando, en una línea. Para el badge y para poder preguntarlo desde la consola.
// Badge en vivo: qué está haciendo el agente, hace cuánto, y el botón para soltarlo. Aparece solo
// si está tomado más de 2s (para no parpadear en cada operación corta).
function _agentesBadgePintar(){
  try{
    let el = document.getElementById('agentesBadge');
    if(!el){
      el = document.createElement('div'); el.id='agentesBadge';
      el.innerHTML = '<span>⚙️</span><span class="ab-txt"></span><span class="ab-seg"></span>'
        + '<button type="button" onclick="liberarLockAgentes()" title="Soltar el agente a la fuerza">Destrabar</button>';
      document.body.appendChild(el);
    }
    const b = window._drexGlobalBusy;
    const seg = b ? Math.round((Date.now()-(window._drexGlobalBusyDesde||0))/1000) : 0;
    if(!b || seg < 2){ el.style.display='none'; return; }
    const q = (window._drexCola && window._drexCola.pendientes) || 0;
    const nom = (window._drexCola && window._drexCola.activo && window._drexCola.activo.nombre) || window._drexGlobalBusyMotivo || 'operación';
    el.querySelector('.ab-txt').textContent = nom + (q>1 ? (' · '+(q-1)+' en cola') : '');
    el.querySelector('.ab-seg').textContent = seg+'s';
    el.classList.toggle('viejo', seg > 45);
    el.style.display='flex';
  }catch(_e){}
}
try{ setInterval(function(){ if(!document.hidden) _agentesBadgePintar(); }, 1000); }catch(_e){}   // con la ventana abajo no se pinta

window.estadoAgentes = function(){
  const b = window._drexGlobalBusy;
  const seg = b ? Math.round((Date.now()-(window._drexGlobalBusyDesde||0))/1000) : 0;
  const q = (window._drexCola && window._drexCola.pendientes) || 0;
  const info = { ocupado:b, motivo:window._drexGlobalBusyMotivo||null, segundos:seg,
                 enCola:q, tareaActual:(window._drexCola && window._drexCola.activo && window._drexCola.activo.nombre)||null,
                 sinSesion:!!window._drexSinSesion };
  console.log('[agentes]', info);
  return info;
};

// ── Traza de proceso de carga/retiro (visibilidad + cancelar) ──────────────────
// Registra cada paso de una operación con su tiempo, para: (1) mostrarlo EN VIVO en una tira
// visible → si se traba, se ve en qué paso quedó; (2) persistirlo (localStorage) para el botón
// ℹ️ del historial; (3) permitir CANCELAR y liberar el panel. NO toca el motor de carga — solo
// observa y ofrece la salida de emergencia. Todo defensivo (try/catch) para no romper el flujo.
window._traza = { pasos: [], t0: 0, cancelada: false, fin: '', titulo: '' };
function _trazaInit(titulo){
  window._traza = { pasos: [], t0: Date.now(), cancelada: false, fin: '', titulo: titulo||'Proceso' };
  _trazaRender();
}
function _trazaPaso(msg, estado){ // estado: '' en curso | 'ok' | 'err' | 'warn'
  try{
    const seg = window._traza.t0 ? ((Date.now()-window._traza.t0)/1000).toFixed(1) : '0.0';
    window._traza.pasos.push({ t: seg, msg: String(msg||''), estado: estado||'' });
    _trazaRender();
  }catch(_e){}
}
function _trazaFin(estadoFinal, histId){
  try{
    window._traza.fin = estadoFinal||'';
    _trazaRender();
    if(histId){
      const data = { titulo:window._traza.titulo, pasos:window._traza.pasos, fin:estadoFinal||'', ts:Date.now() };
      localStorage.setItem('nodo_traza_hist_'+histId, JSON.stringify(data));
      const idx = JSON.parse(localStorage.getItem('nodo_traza_idx')||'[]');
      idx.push(String(histId));
      while(idx.length>300){ const v=idx.shift(); try{localStorage.removeItem('nodo_traza_hist_'+v);}catch(_e){} }
      localStorage.setItem('nodo_traza_idx', JSON.stringify(idx));
    }
  }catch(_e){}
  setTimeout(_trazaOcultar, estadoFinal==='ok'?3000:12000);
}
function _trazaCancelar(){
  window._traza.cancelada = true;
  _trazaPaso('⛔ Cancelado por el operador · verificá en el casino si la operación llegó a aplicarse', 'warn');
}
function _trazaEl(){
  let el = document.getElementById('trazaStrip');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'trazaStrip';
  // Esquina de abajo a la izquierda, apoyada sobre el badge de Agentes. Antes iba centrada
  // (left:50% + translateX): quedaba flotando en el MEDIO de la pantalla, tapando la tabla y
  // montándose a la barra de desplazamiento. Va a la izquierda a propósito — de ese lado no hay
  // scrollbar ni panel de chat, así que se ve igual con el chat abierto o cerrado.
  el.style.cssText = 'position:fixed;bottom:52px;left:84px;right:auto;transform:none;z-index:9998;'
    + 'width:max-content;max-width:min(460px,calc(100vw - 110px));background:#0e1420;'
    + 'border:1px solid #2a3548;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.5);'
    + 'padding:12px 14px;font-size:12px;color:#c8d2e0;display:none';
  document.body.appendChild(el);
  return el;
}
function _trazaRender(){
  try{
    const el = _trazaEl();
    const pasos = window._traza.pasos||[];
    if(!pasos.length){ el.style.display='none'; return; }
    const ico = e => e==='ok'?'✅':e==='err'?'❌':e==='warn'?'⚠️':'⏳';
    const filas = pasos.map((p,i)=>{
      const ultimo = i===pasos.length-1 && !window._traza.fin;
      return '<div style="display:flex;gap:8px;padding:2px 0;'+(ultimo&&!p.estado?'color:#fde68a;font-weight:700':'')+'">'
        + '<span style="color:#6b7688;min-width:40px">+'+p.t+'s</span>'
        + '<span>'+ico(p.estado)+' '+escapeHtml(p.msg)+'</span></div>';
    }).join('');
    const enCurso = !window._traza.fin && !window._traza.cancelada;
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px">'
      + '<b style="color:#7cc4ff">'+escapeHtml(window._traza.titulo||'Proceso')+'</b>'
      + (enCurso ? '<button onclick="_trazaCancelar()" style="background:#7f1d1d;color:#fca5a5;border:0;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">⛔ Cancelar</button>'
                 : '<button onclick="_trazaOcultar()" style="background:#374151;color:#cbd5e1;border:0;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer">Cerrar</button>')
      + '</div>' + filas;
    el.style.display = 'block';
  }catch(_e){}
}
function _trazaOcultar(){ const el=document.getElementById('trazaStrip'); if(el) el.style.display='none'; }
// Botón ℹ️ del historial: muestra el paso a paso guardado de esa operación.
function verTrazaHistorial(histId){
  let data = null;
  try{ data = JSON.parse(localStorage.getItem('nodo_traza_hist_'+histId)||'null'); }catch(_e){}
  if(!data || !data.pasos || !data.pasos.length){
    if(typeof abrirModal==='function') abrirModal('Detalle del proceso', '<div class="alert-box">No hay traza guardada para esta operación.<br><span class="small">Solo se guarda en la PC donde se ejecutó la carga, y de las últimas ~300 operaciones.</span></div>', null, 'Cerrar');
    return;
  }
  const ico = e => e==='ok'?'✅':e==='err'?'❌':e==='warn'?'⚠️':'•';
  const filas = data.pasos.map(p=>'<div style="display:flex;gap:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="color:#6b7688;min-width:48px">+'+p.t+'s</span><span>'+ico(p.estado)+' '+escapeHtml(p.msg)+'</span></div>').join('');
  const cuando = data.ts ? new Date(data.ts).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}) : '';
  if(typeof abrirModal==='function') abrirModal('🔎 '+(data.titulo||'Proceso'), '<div style="font-size:12px;color:#94a3b8;margin-bottom:8px">'+escapeHtml(cuando)+'</div><div style="max-height:60vh;overflow:auto;font-size:13px">'+filas+'</div>', null, 'Cerrar');
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// DETALLE DE ERROR — por qué falló, con todo lo que se sabía en ese momento.
// Antes un error era una fila roja con ❌ y nada más: el motivo vivía en `notas`, y el render
// SÓLO mostraba `notas` para CONSULTA y RESET_CLAVE. Justo en CARGA y RETIRO —las que mueven
// plata— el operador no veía ni una palabra de por qué falló, y para reconstruir el caso había
// que estar sentado en la PC que operó (la traza es local).
// Ahora cada fallo estampa un contexto estructurado DENTRO de `notas`, con etiqueta [ERR]{...}
// (el mismo truco que ya usa [CHUNIOR_OK_SIN_N]). Va ahí y no en una columna nueva a propósito:
// historial_ops es una tabla compartida por las 9 oficinas y no se le agrega una columna para
// esto. Como viaja en la fila, el detalle se ve desde CUALQUIER PC, no sólo desde la que operó.
// ══════════════════════════════════════════════════════════════════════════════════════════
const _ERR_MOTIVOS = {
  USUARIO_NO_ENCONTRADO: {t:'Usuario inexistente',      plata:false, d:'Agentes no encontró ese usuario. No se tocó plata.'},
  SALDO_INSUFICIENTE:    {t:'Saldo insuficiente',       plata:false, d:'El jugador no tenía fichas suficientes para el retiro pedido.'},
  CANCELADO:             {t:'Cancelado por el operador',plata:false, d:'Se frenó antes de aplicar. No se tocó plata.'},
  SESION_CAIDA:          {t:'Sesión caída',             plata:true,  d:'La sesión de Agentes se cayó durante la operación. NO está confirmado si llegó a aplicarse — verificá en el casino antes de reintentar.'},
  ERROR_PAGINA:          {t:'Error de página',          plata:true,  d:'Agentes devolvió un error de página (403/CDN). NO está confirmado si llegó a aplicarse — verificá en el casino antes de reintentar.'},
  RECHAZO_CASINO:        {t:'Rechazado por el casino',  plata:false, d:'Agentes no dijo "Operación correcta". No se anota en Chunior.'},
  NO_APLICO:             {t:'No se pudo aplicar',       plata:true,  d:'Agentes no aplicó la operación. Verificá en el casino.'},
  EXCEPCION:             {t:'Error inesperado',         plata:true,  d:'Excepción de JavaScript en el panel. El detalle técnico está abajo.'}
};

// Arma el contexto del fallo y devuelve el texto para `notas`: humano + etiqueta [ERR].
function _errNotas(motivo, humano, extra){
  const ctx = Object.assign({ m: motivo }, extra || {});
  try{
    if(window._traza && window._traza.t0) ctx.ms = Date.now() - window._traza.t0;
    // Los últimos pasos viajan EN la fila: la traza completa sólo vive en la PC que operó, así
    // que si el error se mira desde otra máquina esto es lo único que queda del proceso.
    if(window._traza && window._traza.pasos && window._traza.pasos.length){
      ctx.pasos = window._traza.pasos.slice(-6).map(function(p){
        return p.t+'s '+(p.estado==='err'?'✗ ':p.estado==='warn'?'! ':'')+String(p.msg||'');
      });
    }
  }catch(_e){}
  try{ if(typeof pcOperativa!=='undefined' && pcOperativa) ctx.pc = String(pcOperativa); }catch(_e){}
  try{ if(typeof operador!=='undefined' && operador) ctx.op = String(operador.usuario||operador.nombre||''); }catch(_e){}
  // Tope de tamaño. Truncar el JSON a lo bruto lo deja inválido y entonces se pierde TODO el
  // contexto — justo en las operaciones largas, que son las más interesantes cuando fallan.
  // Así que se van soltando campos por orden de menor a mayor valor, y el JSON queda siempre
  // parseable. El motivo (m) es lo último que se suelta: nunca.
  const _ser = function(o){ try{ return '[ERR]'+JSON.stringify(o); }catch(_e){ return null; } };
  let tag = _ser(ctx);
  const _aSoltar = ['stack','pasos','msg','saldoRaw','op'];
  for(let i = 0; tag && tag.length > 1800 && i < _aSoltar.length; i++){
    if(_aSoltar[i] === 'pasos' && ctx.pasos && ctx.pasos.length > 2){
      ctx.pasos = ctx.pasos.slice(-2).map(function(p){ return String(p).slice(0,160); });  // los 2 últimos, recortados
    } else {
      delete ctx[_aSoltar[i]];
    }
    ctx.recortado = true;
    tag = _ser(ctx);
  }
  if(!tag || tag.length > 1800) tag = '[ERR]'+JSON.stringify({m:String(motivo), recortado:true});
  return (String(humano||'').trim()+' '+tag).trim();
}

function _errParse(notas){
  const s = String(notas||''); const i = s.indexOf('[ERR]');
  if(i < 0) return null;
  try{ return JSON.parse(s.slice(i+5)); }catch(_e){ return null; }
}
// El texto para humanos, sin la etiqueta técnica.
function _errTextoLimpio(notas){
  const s = String(notas||''); const i = s.indexOf('[ERR]');
  return (i < 0 ? s : s.slice(0, i)).trim();
}
// Etiqueta corta para la celda Estado de la tabla.
function _errEtiqueta(notas){
  const c = _errParse(notas);
  if(c && c.m && _ERR_MOTIVOS[c.m]) return _ERR_MOTIVOS[c.m].t;
  const t = _errTextoLimpio(notas);
  return t ? (t.length > 30 ? t.slice(0,30)+'…' : t) : '';
}

// Índice de filas del historial por id, para que el modal de detalle tenga la fila entera
// sin volver a consultar Supabase. Lo llena renderHistorial en cada pintada.
window._histPorId = window._histPorId || {};

// Modal de detalle del error: TODO lo que se sabe de esa fila, en un solo lugar.
window.verDetalleError = function(histId){
  const h = (window._histPorId||{})[String(histId)];
  if(!h){ if(typeof toast==='function') toast('No tengo la fila en pantalla · recargá el historial','yellow'); return; }
  const ctx  = _errParse(h.notas);
  const info = (ctx && ctx.m && _ERR_MOTIVOS[ctx.m]) || null;
  const esc  = (typeof escapeHtml==='function') ? escapeHtml : function(x){ return String(x==null?'':x); };
  const fmtM = (typeof money==='function') ? money : function(x){ return String(x); };

  const titulo = info ? info.t : (_errEtiqueta(h.notas) || 'Error');
  let html = '';

  // 1) Qué pasó, en castellano, y si quedó plata en duda.
  html += '<div style="border-radius:10px;padding:10px 12px;margin-bottom:10px;background:rgba(240,68,56,.10);border:1px solid rgba(240,68,56,.40)">'
        +   '<div style="font-weight:900;color:#f87171;font-size:14px">❌ '+esc(titulo)+'</div>'
        +   (info ? '<div style="font-size:12.5px;color:#e6edf3;margin-top:4px">'+esc(info.d)+'</div>' : '')
        +   (_errTextoLimpio(h.notas) ? '<div style="font-size:12.5px;color:#c9d1d9;margin-top:5px">'+esc(_errTextoLimpio(h.notas))+'</div>' : '')
        + '</div>';
  if(info && info.plata){
    html += '<div style="border-radius:10px;padding:9px 11px;margin-bottom:10px;background:rgba(245,197,24,.10);border:1px solid rgba(245,197,24,.45);font-size:12.5px;color:#f5c518;font-weight:700">'
          +   '⚠ No hay confirmación de si la plata se movió. Verificá en el casino ANTES de reintentar — reintentar a ciegas es como se duplica una carga.'
          + '</div>';
  }

  // 2) La fila entera. Todo lo que en la tabla no entra.
  const campos = [
    ['Fecha',        (typeof formatFecha==='function' ? formatFecha(h.created_at) : String(h.created_at||'—'))],
    ['Tipo',         h.tipo||'—'],
    ['Usuario',      h.usuario||'—'],
    ['Monto',        (h.monto ? fmtM(h.monto) : '—')],
    ['Saldo pre',    (h.saldo_pre!=null  && h.saldo_pre!==''  ? fmtM(h.saldo_pre)  : '— (no se pudo leer)')],
    ['Saldo post',   (h.saldo_post!=null && h.saldo_post!=='' ? fmtM(h.saldo_post) : '— (no se pudo leer)')],
    ['Billetera',    h.billetera_nombre||'—'],
    ['Origen',       h.origen||'—'],
    ['Estado',       h.estado||'—'],
    ['Operador',     h.operador || (ctx&&ctx.op) || '—'],
    ['PC',           h.pc_codigo || (ctx&&ctx.pc) || '—'],
    ['Solicitud',    h.solicitud_id ? ('#'+h.solicitud_id) : '—'],
    ['Mov. Chunior', h.chunior_movimiento_id ? ('N° '+h.chunior_movimiento_id) : '— (no se anotó)'],
    ['ID historial', h.id||'—']
  ];
  if(ctx && ctx.ms!=null)      campos.push(['Duró', (ctx.ms/1000).toFixed(1)+'s hasta fallar']);
  if(ctx && ctx.intento!=null) campos.push(['Intento', ctx.intento+' de '+(ctx.maxIntentos!=null?ctx.maxIntentos:'?')]);
  if(ctx && ctx.saldoRaw)      campos.push(['Saldo leído en Agentes', String(ctx.saldoRaw)]);
  if(ctx && ctx.pedido!=null)  campos.push(['Monto pedido', fmtM(ctx.pedido)]);
  if(ctx && ctx.needsLogin)    campos.push(['Sesión', 'caída (needsLogin)']);
  if(ctx && ctx.pageError)     campos.push(['Página', 'error de Agentes (pageError)']);

  html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12.5px;padding:10px 12px;background:#12161d;border:1px solid #262d3a;border-radius:10px;margin-bottom:10px">'
        + campos.map(function(c){
            return '<div style="color:#8b949e;white-space:nowrap">'+esc(c[0])+'</div><div style="color:#e6edf3;font-weight:600;word-break:break-word">'+esc(c[1])+'</div>';
          }).join('')
        + '</div>';

  // 3) El proceso paso a paso. Primero la traza completa (sólo existe en la PC que operó);
  //    si no está, los últimos pasos que viajaron dentro de la propia fila.
  let traza = null;
  try{ traza = JSON.parse(localStorage.getItem('nodo_traza_hist_'+h.id)||'null'); }catch(_e){}
  const ico = function(e){ return e==='ok'?'✅':e==='err'?'❌':e==='warn'?'⚠️':'•'; };
  if(traza && traza.pasos && traza.pasos.length){
    html += '<div style="font-weight:800;font-size:12px;color:#c9d1d9;margin-bottom:4px">Proceso completo ('+traza.pasos.length+' pasos)</div>'
          + '<div style="max-height:34vh;overflow:auto;font-size:12.5px;background:#12161d;border:1px solid #262d3a;border-radius:10px;padding:8px 10px">'
          + traza.pasos.map(function(p){
              return '<div style="display:flex;gap:10px;padding:2px 0"><span style="color:#6b7688;min-width:46px">+'+esc(p.t)+'s</span><span>'+ico(p.estado)+' '+esc(p.msg)+'</span></div>';
            }).join('')
          + '</div>';
  } else if(ctx && ctx.pasos && ctx.pasos.length){
    html += '<div style="font-weight:800;font-size:12px;color:#c9d1d9;margin-bottom:4px">Últimos pasos antes de fallar</div>'
          + '<div style="font-size:12.5px;background:#12161d;border:1px solid #262d3a;border-radius:10px;padding:8px 10px">'
          + ctx.pasos.map(function(p){ return '<div style="padding:2px 0;color:#e6edf3">'+esc(p)+'</div>'; }).join('')
          + '<div class="small" style="color:#8b949e;margin-top:6px">El paso a paso completo quedó en la PC que operó'+(ctx.pc?(' ('+esc(ctx.pc)+')'):'')+'.</div>'
          + '</div>';
  } else {
    html += '<div class="small" style="color:#8b949e">Sin paso a paso guardado. La traza completa sólo se guarda en la PC que ejecutó la operación, y de las últimas ~300.</div>';
  }

  // 4) Crudo, para copiar y pasarle a soporte.
  html += '<details style="margin-top:10px"><summary style="cursor:pointer;color:#8b949e;font-size:12px">Detalle técnico (crudo)</summary>'
        + '<pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;color:#9aa7bd;background:#0d1117;border:1px solid #262d3a;border-radius:8px;padding:8px;margin-top:6px">'
        + esc(String(h.notas||'(sin notas)')) + '</pre></details>'
        + '<div style="margin-top:10px"><button class="mini-btn" style="background:#1e3a5f;color:#7cc4ff;border:1px solid rgba(124,196,255,.45)" onclick="copiarDetalleError(&#39;'+esc(String(h.id))+'&#39;)">📋 Copiar todo</button></div>';

  if(typeof abrirModal==='function') abrirModal('🔎 Detalle del error', html, null, 'Cerrar');
};

// Copia el caso entero como texto plano, para pegarlo en un chat o un ticket.
window.copiarDetalleError = function(histId){
  const h = (window._histPorId||{})[String(histId)];
  if(!h) return;
  const ctx = _errParse(h.notas);
  let traza = null;
  try{ traza = JSON.parse(localStorage.getItem('nodo_traza_hist_'+h.id)||'null'); }catch(_e){}
  const L = [];
  L.push('NODO · detalle de error');
  L.push('motivo:    '+((ctx&&ctx.m&&_ERR_MOTIVOS[ctx.m]&&_ERR_MOTIVOS[ctx.m].t) || _errEtiqueta(h.notas) || '?'));
  L.push('mensaje:   '+(_errTextoLimpio(h.notas)||'—'));
  L.push('fecha:     '+(h.created_at||'—'));
  L.push('tipo:      '+(h.tipo||'—')+'   usuario: '+(h.usuario||'—')+'   monto: '+(h.monto||'—'));
  L.push('saldos:    pre='+(h.saldo_pre!=null&&h.saldo_pre!==''?h.saldo_pre:'—')+'  post='+(h.saldo_post!=null&&h.saldo_post!==''?h.saldo_post:'—'));
  L.push('billetera: '+(h.billetera_nombre||'—')+'   chunior: '+(h.chunior_movimiento_id||'—'));
  L.push('origen:    '+(h.origen||'—')+'   estado: '+(h.estado||'—')+'   operador: '+(h.operador||'—'));
  L.push('pc:        '+(h.pc_codigo||(ctx&&ctx.pc)||'—')+'   solicitud: '+(h.solicitud_id||'—')+'   hist_id: '+(h.id||'—'));
  if(ctx && ctx.ms!=null) L.push('duracion:  '+(ctx.ms/1000).toFixed(1)+'s');
  const pasos = (traza && traza.pasos && traza.pasos.length)
    ? traza.pasos.map(function(p){ return '  +'+p.t+'s '+(p.estado==='err'?'X ':p.estado==='warn'?'! ':'')+p.msg; })
    : ((ctx && ctx.pasos) ? ctx.pasos.map(function(p){ return '  '+p; }) : []);
  if(pasos.length){ L.push('proceso:'); L.push(pasos.join('\n')); }
  L.push('notas crudas: '+(h.notas||'—'));
  const txt = L.join('\n');
  const ok = function(){ if(typeof toast==='function') toast('📋 Detalle copiado','green'); };
  try{
    navigator.clipboard.writeText(txt).then(ok, function(){
      const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); ok(); }catch(_e2){ if(typeof toast==='function') toast('No se pudo copiar','red'); }
      ta.remove();
    });
  }catch(_e){
    if(typeof toast==='function') toast('No se pudo copiar','red');
  }
};

// ── Operación manual automatizada ─────────────────────────────────────────────
// ⛔ Cancelar (freno real): pide al agent-preload que corte la operación en curso. El freno solo
// actúa ANTES de "Aplicar" (nunca después — la plata ya se movió). Portado de NexoBetaChan.
function _mostrarBtnAbort(show){ try{ const b=document.getElementById('btnAbortarOp'); if(b) b.style.display = show ? 'inline-block' : 'none'; }catch(_e){} }
async function abortarOperacionActual(){
  window.NodoSalud?.begin('AUTOMATISMOS')?.record('EFFECT','OK','MANUAL_ABORT_REQUESTED');
  try{
    if(window.ctrlElectron && ctrlElectron.drexAutomation){
      await ctrlElectron.drexAutomation('abortarOperacion');
      toast('⛔ Freno solicitado — si la operación no aplicó plata, se corta.','yellow');
    }
  }catch(_e){}
}
let _operacionManualEnCurso = false;
async function ejecutarOperacionManual(){
  // Anti-doble-click: si ya hay una operación corriendo, ignorar
  if(_operacionManualEnCurso){
    toast("Ya hay una operación en curso, esperá que termine.", "yellow");
    return;
  }
  if(!_drexGlobalLock('manual')){
    toast("Hay otra operación corriendo en Agentes ahora mismo (portal u otra). Esperá a que termine.", "yellow");
    return;
  }
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const usuario    = (document.getElementById("manualUsuario")?.value||"").trim();
  const montoRaw   = (document.getElementById("manualMonto")?.value||"").trim();
  const bilId      = document.getElementById("manualBilletera")?.value||"";
  const res        = document.getElementById("manualResultado");
  const btnEjecutar = document.querySelector('button.btn-primary[onclick="ejecutarOperacionManual()"]');

  if(!usuario){ toast("Ingresá un usuario.","red"); return; }

  // Activar el lock + deshabilitar el botón visualmente
  _operacionManualEnCurso = true;
  if(btnEjecutar){ btnEjecutar.disabled = true; btnEjecutar.style.opacity = '0.6'; btnEjecutar.textContent = 'Procesando...'; }
  _mostrarBtnAbort(true);

  let _lockLiberado = false;
  // Timeout de seguridad SOLO para un cuelgue real (un await que nunca resuelve / IPC muerto).
  // DEBE ser mayor que la suma de los timeouts del proceso main de un mismo flujo:
  // buscarUsuario (45s) + cargarSaldo/retirarSaldo (180s) = 225s. Si es menor, salta a mitad
  // de una operación lenta (proxy) y marca "se colgó" aunque en el casino SÍ se completó (error ciego).
  // El timeout del main (línea ~3162) ya maneja el caso lento verificando saldo; este es el último recurso.
  const _safetyTimer = setTimeout(() => {
    if(_lockLiberado) return;
    _lockLiberado = true;
    _operacionManualEnCurso = false;
    _drexGlobalUnlock();
    _wdForceUnlock(); // reset duro: por si quedó el watchdog bloqueado (no importa cuántos _wdLock anidados)
    if(btnEjecutar){ btnEjecutar.disabled = false; btnEjecutar.style.opacity = ''; btnEjecutar.textContent = 'Ejecutar'; }
    _mostrarBtnAbort(false);
    if(res) res.innerHTML = '<div class="err-box">⏱️ La operación no respondió a tiempo.<br>Revisá que la ventana de agentes esté abierta y verificá en el casino antes de reintentar.</div>';
    toast('⏱️ Operación sin respuesta · verificá antes de reintentar', 'red');
  }, 90000);

  // Asegurar que se libere SIEMPRE al final, pase lo que pase
  const _liberarLock = () => {
    if(_lockLiberado) return;
    _lockLiberado = true;
    clearTimeout(_safetyTimer);
    _operacionManualEnCurso = false;
    _drexGlobalUnlock();
    _wdForceUnlock(); // libera el candado del watchdog que se tomó al arrancar (ver más abajo)
    if(btnEjecutar){ btnEjecutar.disabled = false; btnEjecutar.style.opacity = ''; btnEjecutar.textContent = 'Ejecutar'; }
    _mostrarBtnAbort(false);
  };

  if(!montoRaw){
    try { await soloConsultarUsuario(); } finally { _liberarLock(); }
    return;
  }

  const monto = Number(montoRaw);
  if(isNaN(monto)||monto===0){ toast("Monto inválido.","red"); _liberarLock(); return; }

  const tipo    = monto > 0 ? "CARGA" : "RETIRO";
  const montoAbs= Math.abs(monto);
  // Respetar la billetera ELEGIDA en el selector (comparar como String: el value del <select> es
  // string y ID_BILLETERA es número → con === no matcheaba nunca y caía a la del portal). Si no se
  // eligió ninguna, por defecto va la del portal (getBilleraLanding).
  const bil     = (bilId ? billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); }) : null) || getBilleraLanding();

  _trazaInit((tipo==="CARGA"?"Carga":"Retiro")+' manual · '+usuario+' · '+money(montoAbs));
  if(res) res.innerHTML = '<div class="alert-box">Procesando...</div>';

  if(tipo==="RETIRO"){
    const check = await verificarRetiro24h(usuario);
    if(check.bloqueado){
      if(res) res.innerHTML = '<div class="alert-box">⚠️ <b>'+escapeHtml(usuario)+'</b> tiene un retiro reciente.<br><span class="small">'+escapeHtml(check.mensaje)+'</span></div>';
      const proceder = await confirmarRetiroDuplicado(check);
      if(!proceder){ if(res) res.innerHTML = ''; _liberarLock(); return; }
    }
  }

  try {
    // Candado del watchdog para TODA la secuencia (sesión + búsqueda + carga), sin huecos.
    // Antes solo se bloqueaba alrededor de buscarUsuario y, por separado, alrededor de
    // cargarSaldo/retirarSaldo — el hueco intermedio (y sobre todo el tiempo de
    // ensureDrexSession, que puede tardar) quedaba desprotegido. Si el watchdog tenía un
    // chequeo ya programado (_watchdogTrigger de la operación anterior) y caía justo ahí,
    // navegaba/refrescaba la página de Agentes a mitad de camino — cortando la carga en curso
    // (bug real reportado: "pega el usuario y está por cargar, refresca y corta"). _wdLock es
    // un contador (_watchdog.busy++), así que anidar los candados de abajo es seguro.
    _wdLock();
    toast("Abriendo backoffice...","blue");
    _trazaPaso('Abriendo sesión de Agentes...');
    if(!await ensureDrexSession()){ _trazaPaso('Falta sesión de Agentes','err'); _trazaFin('err'); toast("Sesión de backoffice requerida.","red"); return; }
    _trazaPaso('Sesión de Agentes lista','ok');

    // ── BUSCAR + OPERAR con reintento ACOTADO ante error de página (403/CDN) o sesión caída ──
    // Adoptado del NODO hermano (la parte REAL de su bucle — su señal 'needsRetry' es lógica
    // muerta, no la produce nadie). Nosotros SÍ tenemos pageError/needsLogin desde agent-preload.js
    // (status()/openMovementModal las propagan). Dos mejoras juntas:
    //   1) Antes, si buscarUsuario volvía por un 403/CDN o sesión caída, busqueda.exists salía
    //      falsy y el operador veía "el usuario no existe" — mensaje ENGAÑOSO. Ahora se distingue.
    //   2) Ante un error transitorio de página/sesión, se refresca UNA vez y se reintenta (tope 2).
    //      NO se reintenta a ciegas cuando la op pudo haberse aplicado (timeout → timeoutVerificar).
    const MAX_REINTENTOS = 2;
    let busqueda, resultado, intentoOp = 0;

    while(intentoOp < MAX_REINTENTOS){
      intentoOp++;

      // ── BUSCAR ──
      toast(intentoOp>1 ? ("↻ Reintento "+intentoOp+" · "+usuario+"...") : ("Buscando "+usuario+"..."),"blue");
      _trazaPaso(intentoOp>1 ? ('Reintento '+intentoOp+' · buscando '+usuario+'...') : ('Buscando '+usuario+' en Agentes...'));
      _wdLock();
      try {
        // CARGA: skipBalance → NO abrimos el modal acá. applyAmount (cargarSaldo)
        //        abre el modal UNA sola vez y lee pre (input 0) + post (input 1).
        // RETIRO: necesitamos el saldo antes para validar suficiencia → sin skip.
        busqueda = await callDrex("buscarUsuario", usuario, { skipBalance: tipo === "CARGA" });
      } finally {
        _wdUnlock();
      }

      // Página de error del CDN (403/404) en la BÚSQUEDA → refrescar y reintentar
      if(busqueda && busqueda.pageError){
        if(intentoOp < MAX_REINTENTOS){
          if(res) res.innerHTML = '<div class="alert-box">↻ Agentes devolvió un error de página · reintentando ('+intentoOp+'/'+MAX_REINTENTOS+')...</div>';
          try{ await window.ctrlElectron.navigateAgent(); }catch(_e){}
          continue;
        }
        if(res) res.innerHTML = '<div class="err-box">❌ Agentes devolvió una página de error (403/CDN). No se operó · cerrá y reabrí la ventana de Agentes, o reintentá.</div>';
        _trazaPaso('Agentes devolvió error de página (403/CDN) · no se operó','err'); _trazaFin('err');
        toast('Agentes devolvió error de página · reintentá', 'red'); return;
      }

      // Sesión caída en la BÚSQUEDA → login y reintentar
      if(busqueda && busqueda.needsLogin){
        if(res) res.innerHTML = '<div class="alert-box">🔐 Sesión de agentes caída · reingresá credenciales.</div>';
        _trazaPaso('Sesión de Agentes caída · reingresando...','warn');
        const reconectado = await ensureDrexSession();
        if(!reconectado){ _trazaPaso('No se reingresó a Agentes','err'); _trazaFin('err'); toast("Sesión de agentes requerida.","red"); return; }
        continue;
      }

      if(!busqueda.exists){
        const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas('USUARIO_NO_ENCONTRADO','Usuario no encontrado',{paso:'buscar usuario', pedido:montoAbs})});
        if(res) res.innerHTML = '<div class="err-box">❌ <b>'+escapeHtml(usuario)+'</b> no existe en el casino.</div>';
        _trazaPaso(usuario+' NO existe en Agentes','err'); _trazaFin('err', _fh&&_fh.id);
        toast(usuario+" no encontrado","red"); return;
      }

      // RETIRO: chequeo de saldo previo
      // V15.2: si Agentes devuelve sólo "ARS" sin número, NO lo tomamos como saldo 0.
      // Eso era un falso bloqueo. Sólo bloqueamos cuando el saldo leído tiene dígitos reales.
      if(tipo === "RETIRO"){
        const saldoRaw = String(busqueda.balance?.raw || "");
        const saldo = busqueda.balance?.value ?? null;
        const saldoConfiable = /\d/.test(saldoRaw) && typeof saldo === "number" && Number.isFinite(saldo);
        if(saldoConfiable && saldo >= 0 && saldo < montoAbs){
          const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas('SALDO_INSUFICIENTE','Saldo insuficiente',{paso:'chequeo de saldo', pedido:montoAbs, saldoRaw:saldoRaw, saldo:saldo})});
          if(res) res.innerHTML = '<div class="err-box">⚠️ Saldo insuficiente: '+escapeHtml(busqueda.balance?.raw||'')+'</div>';
          _trazaPaso('Saldo insuficiente ('+(busqueda.balance?.raw||'').trim()+')','err'); _trazaFin('err', _fh&&_fh.id);
          toast("Saldo insuficiente","red"); return;
        }
      }

      _trazaPaso(usuario+' encontrado'+(busqueda.balance?.raw?(' · saldo '+busqueda.balance.raw.trim()):''), 'ok');

      // Punto de CANCELACIÓN seguro: si el operador canceló mientras buscábamos, NO aplicamos
      // la carga (todavía no se tocó plata). Libera el panel y avisa.
      if(window._traza && window._traza.cancelada){
        await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas('CANCELADO','Cancelado por el operador antes de aplicar',{paso:'antes de aplicar', pedido:montoAbs})});
        _trazaFin('warn');
        if(res) res.innerHTML = '<div class="alert-box">⛔ '+tipo+' cancelada antes de aplicar. No se tocó nada en el casino.</div>';
        toast(tipo+' cancelada', 'yellow'); return;
      }

      // ── OPERAR ── (esperamos confirmación antes de marcar como completada)
      toast(tipo === "CARGA" ? "Cargando "+money(montoAbs)+"..." : "Retirando "+money(montoAbs)+"...", "blue");
      _trazaPaso((tipo==="CARGA"?"Cargando ":"Retirando ")+money(montoAbs)+' en Agentes...');
      _wdLock(); // bloqueamos watchdog para que no navegue agentes mientras opera
      try {
        resultado = tipo === "CARGA"
          ? await callDrex("cargarSaldo",  montoAbs)
          : await callDrex("retirarSaldo", montoAbs);
      } catch(e){
        const msgTimeout = e && (e.message || String(e)) || 'Error en Drex';
        if(/timeout|tard[oó] demasiado|timed out/i.test(msgTimeout)){
          // El worker puede terminar la carga en Agentes/Chunior pero cortar por timeout al volver.
          // No marcamos error ciego: intentamos leer saldo post; si no se puede, queda OK a verificar.
          resultado = { ok:true, message:'Timeout posterior a la operación · verificar saldo', timeoutVerificar:true };
          try{
            const postRead = await callDrex("buscarUsuario", usuario, { skipBalance:false });
            if(postRead && postRead.exists && typeof postRead.balance?.value === 'number'){
              resultado.newBalance = postRead.balance;
              resultado.message = 'Timeout, pero saldo post leído';
            }
          }catch(_e){}
        }else{
          resultado = { ok:false, message: msgTimeout };
        }
      } finally {
        _wdUnlock();
      }

      // Error de página / sesión caída DURANTE la operación → refrescar/login y reintentar.
      // OJO: el timeout (timeoutVerificar) NO entra acá — puede haberse aplicado en el casino,
      // no reintentamos a ciegas (evita duplicar). Solo reintentamos si el modal ni se abrió.
      if(resultado && !resultado.timeoutVerificar && (resultado.pageError || resultado.needsLogin)){
        if(intentoOp < MAX_REINTENTOS){
          if(resultado.needsLogin){
            if(res) res.innerHTML = '<div class="alert-box">🔐 Sesión caída durante la operación · reingresá credenciales.</div>';
            const recon = await ensureDrexSession();
            if(!recon){ toast('Sesión de agentes requerida.','red'); return; }
          } else {
            if(res) res.innerHTML = '<div class="alert-box">↻ Error de página al operar · refrescando y reintentando ('+intentoOp+'/'+MAX_REINTENTOS+')...</div>';
            try{ await window.ctrlElectron.navigateAgent(); }catch(_e){}
          }
          continue;
        }
        // Sin más reintentos → error claro (no operamos a ciegas)
        const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas(resultado.needsLogin?'SESION_CAIDA':'ERROR_PAGINA',(resultado.needsLogin?'Sesión caída':'Error de página')+' al operar · no confirmado',{paso:'aplicar', pedido:montoAbs, intento:intentoOp, maxIntentos:MAX_REINTENTOS, needsLogin:!!resultado.needsLogin, pageError:!!resultado.pageError, msg:(resultado&&resultado.message)||null})});
        if(res) res.innerHTML = '<div class="err-box">❌ '+tipo+' no confirmada: '+(resultado.needsLogin?'sesión caída':'error de página en Agentes')+'. Verificá en el casino antes de reintentar.</div>';
        _trazaPaso((resultado.needsLogin?'Sesión caída':'Error de página')+' al operar · no confirmado','err'); _trazaFin('err', _fh&&_fh.id);
        toast(tipo+' no confirmada · verificá', 'red'); return;
      }

      break; // el script corrió (o timeout que puede haberse aplicado) → salimos del loop
    }

    const ok    = resultado && resultado.ok !== false;

    // Saldo PRE: lo leemos siempre (ya sea del casino o de la búsqueda inicial).
    // Saldo POST: SIEMPRE lo calculamos (pre + monto). Es lo más confiable.
    // La lectura post del casino se usa SOLO para detectar duplicados como bonus.
    const saldoPreCasino = (typeof resultado?.previousBalance?.value === 'number' && !resultado?.previousBalance?.unchanged) ? resultado.previousBalance.value : null;
    const saldoPostCasino = (typeof resultado?.newBalance?.value === 'number' && !resultado?.newBalance?.unchanged) ? resultado.newBalance.value : null;
    let saldoPre  = saldoPreCasino !== null ? saldoPreCasino : ((typeof busqueda.balance?.value === 'number') ? busqueda.balance.value : null);
    let saldoPost = saldoPostCasino !== null ? saldoPostCasino : ((ok && saldoPre !== null) ? saldoPre + (tipo === "CARGA" ? montoAbs : -montoAbs) : null);
    if(ok && saldoPost === null){
      const ultimoSaldo = (typeof ultimoSaldoPostUsuarioHistorial === 'function') ? ultimoSaldoPostUsuarioHistorial(usuario) : null;
      if(ultimoSaldo !== null){
        saldoPre = ultimoSaldo;
        saldoPost = tipo === "CARGA" ? ultimoSaldo + montoAbs : ultimoSaldo - montoAbs;
      }
    }

    // ── CONFIRMACIÓN estilo NODO hermano (simple, SIN re-leer el saldo, SIN estado "sin confirmar") ──
    // El script CORRIÓ (pasó el gate de página/saldo previo → ok!==false) → la operación SE APLICÓ.
    // Confiamos en que el script corrió limpio (igual que el hermano); NO exigimos "Operación correcta"
    // ni delta de saldo para anotar en Chunior. Solo frenamos en dos casos CLAROS: (a) RECHAZO explícito
    // (el modal apareció y dijo que NO, exito===false) y (b) DUPLICADO (el saldo saltó 2-6x el monto).
    // Trade-off aceptado (pedido explícito 2026-07-02): si el casino rechazó pero el modal no llegó a
    // verse (exito===null), se anota igual — prioriza velocidad/simpleza sobre el 100% de certeza.
    const _signo = tipo === "CARGA" ? 1 : -1;
    const _postEnModal = saldoPostCasino; // post REAL del modal (null si no se leyó)
    let _confianza = 'confirmado', _vecesDup = 0;
    if(ok && saldoPreCasino !== null && _postEnModal !== null){
      const _movido = _postEnModal - saldoPreCasino;
      if(Math.sign(_movido) === _signo && Math.abs(_movido) >= montoAbs * 1.5){
        const _veces = Math.round(_movido / (_signo * montoAbs));
        if(_veces >= 2 && _veces <= 6 && Math.abs(_movido - _veces * _signo * montoAbs) < 1){ _confianza = 'duplicado'; _vecesDup = _veces; }
      }
    }
    const _rechazoCasino = ok && resultado && resultado.exito === false; // modal apareció y NO confirmó → rechazo CLARO
    const cargaConfirmada = ok && !_rechazoCasino; // script corrió y no hubo rechazo explícito → se confía
    const aplicadoLimpio = cargaConfirmada && _confianza !== 'duplicado';
    const est2  = !ok ? "ERROR" : (_rechazoCasino ? "ERROR" : "OK");
    const notas = !ok ? _errNotas('NO_APLICO', ((resultado && resultado.message) || "error"), {paso:'aplicar', pedido:montoAbs, saldoRaw:(resultado?.previousBalance?.raw || busqueda.balance?.raw || null), needsLogin:!!(resultado&&resultado.needsLogin), pageError:!!(resultado&&resultado.pageError), timeoutVerificar:!!(resultado&&resultado.timeoutVerificar)})
                : _rechazoCasino ? _errNotas('RECHAZO_CASINO', "El casino NO confirmó 'Operación correcta' (rechazo) · NO anotado en Chunior", {paso:'confirmación', pedido:montoAbs, saldoPre:saldoPre, saldoPost:saldoPost, msg:(resultado&&resultado.message)||null})
                : _confianza === 'duplicado' ? ('🚨 DUPLICADO x'+(_vecesDup||'?')+' · saldo '+money(saldoPre)+'→'+money(saldoPost))
                : (resultado?.previousBalance?.raw || busqueda.balance?.raw || null);
    if(_confianza === 'duplicado'){
      toast('🚨 '+tipo+' DUPLICADA ('+(_vecesDup||'?')+'x) en agentes · saldo '+money(saldoPre)+' → '+money(saldoPost)+'. Revisá y corregí.', 'red');
    }

    // NOTA: el saldo pre YA se resolvió arriba (modal → busqueda.balance → último saldo post
    // conocido del usuario). NO re-derivar pre desde post acá: si post vino de una lectura
    // espuria (0 transitorio del modal en una PC lenta), "pre = post - monto" da NEGATIVO
    // (bug real visto en producción, PC piloto). Mejor dejar pre/post en null (se muestra "—")
    // que mostrar un saldo negativo falso.

    // Registramos en historial AHORA con chunior_movimiento_id=null (se actualiza
    // después cuando Chunior responda en background).
    const filaHist = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:est2, notas, chunior_movimiento_id:null, saldo_post:saldoPost, saldo_pre:saldoPre});

    // Traza del resultado en Agentes + persistir ligada a la fila del historial (botón ℹ️).
    if(!ok){ _trazaPaso('Agentes: no se pudo aplicar · '+((resultado&&resultado.message)||'error'), 'err'); _trazaFin('err', filaHist&&filaHist.id); }
    else if(_rechazoCasino){ _trazaPaso('Agentes RECHAZÓ (no dijo "Operación correcta") · no se anota en Chunior', 'err'); _trazaFin('err', filaHist&&filaHist.id); }
    else if(_confianza==='duplicado'){ _trazaPaso('🚨 DUPLICADO ('+(_vecesDup||'?')+'x) en Agentes · revisá', 'warn'); _trazaFin('warn', filaHist&&filaHist.id); }
    else { _trazaPaso((tipo==="CARGA"?"Carga":"Retiro")+' aplicado en Agentes'+(saldoPost!=null?(' · saldo '+money(saldoPost)):''), 'ok'); _trazaFin('ok', filaHist&&filaHist.id); }
    // Referencia estable de esta traza para poder anexar el resultado de Chunior (async) sin
    // que una operación posterior lo pise.
    const _trazaPasosRef = (window._traza && window._traza.pasos) || [];
    const _trazaTituloRef = (window._traza && window._traza.titulo) || '';
    const _histIdRef = filaHist && filaHist.id;
    const _guardarTraza = function(fin){ try{ if(_histIdRef) localStorage.setItem('nodo_traza_hist_'+_histIdRef, JSON.stringify({titulo:_trazaTituloRef, pasos:_trazaPasosRef, fin:fin||'', ts:Date.now()})); }catch(_e){} };

    // ── Chunior EN BACKGROUND ── SOLO si la operación quedó APLICADA LIMPIA (script corrió, sin rechazo ni duplicado)
    const debeChunior = aplicadoLimpio && !!(bil && bil.CHUNIOR_UID);
    if(debeChunior){
      _trazaPasosRef.push({ t:((Date.now()-(window._traza.t0||Date.now()))/1000).toFixed(1), msg:'Anotando en Chunior (2° plano)...', estado:'' }); _trazaRender(); _guardarTraza('ok');
      const chuPromise = tipo === "CARGA"
        ? registrarCargaEnChunior (bil.CHUNIOR_UID, montoAbs, usuario)
        : registrarRetiroEnChunior(bil.CHUNIOR_UID, montoAbs, usuario);

      const _chuPaso = function(msg, estado){ try{ _trazaPasosRef.push({ t:((Date.now()-(window._traza.t0||Date.now()))/1000).toFixed(1), msg:msg, estado:estado||'' }); _guardarTraza(estado==='err'?'warn':'ok'); }catch(_e){} };
      chuPromise
        .then(async function(rChu){
          if(rChu && rChu.ok && rChu.movimientoId){
            toast("📋 "+tipo+" Chunior N° "+rChu.movimientoId, 'blue');
            _chuPaso('Chunior anotó · N° '+rChu.movimientoId, 'ok');
            // Actualizar el historial con el chunior_movimiento_id real
            if(filaHist && filaHist.id){
              try {
                await supabaseClient.from('historial_ops')
                  .update({ chunior_movimiento_id: rChu.movimientoId })
                  .eq('id', filaHist.id);
                if(typeof cargarHistorial === 'function') await cargarHistorial();
              } catch(e){ console.warn('update chunior_movimiento_id falló:', e); }
            }
            // Recién acá comparamos fichas: Chunior YA confirmó su movimiento.
            _watchdogTrigger(1500);
          } else if(rChu && rChu.ok && !rChu.movimientoId){
            // Chunior ACEPTÓ el movimiento (sin error) pero no pudimos leer su N° en la
            // respuesta (parseo flaky de esa página). Antes esto no entraba en NINGUNA
            // rama: no se avisaba, no se marcaba nada, y la fila quedaba para siempre
            // como "NO registrado" pese a estar anotada de verdad — false alarm real.
            // Marcamos en notas (sin inventar un chunior_movimiento_id falso, que se usa
            // para "Cambiar billetera" y otras acciones que necesitan un N° real).
            toast("📋 "+tipo+" anotado en Chunior (sin N° confirmado)", 'blue');
            _chuPaso('Chunior anotó (sin N° confirmado)', 'ok');
            if(filaHist && filaHist.id){
              try {
                const notaMarca = (String(notas||'').trim()+' [CHUNIOR_OK_SIN_N]').trim();
                await supabaseClient.from('historial_ops')
                  .update({ notas: notaMarca })
                  .eq('id', filaHist.id);
                if(typeof cargarHistorial === 'function') await cargarHistorial();
              } catch(e){ console.warn('update notas [CHUNIOR_OK_SIN_N] falló:', e); }
            }
            _watchdogTrigger(1500);
          } else if(rChu && rChu.error){
            toast('⚠️ '+tipo+' OK en casino pero falló en Chunior: '+rChu.error, 'red');
            _chuPaso('Chunior FALLÓ: '+rChu.error+' · verificá/reintentá', 'err');
            // Chunior falló → NO chequeamos fichas (sabríamos que hay diferencia,
            // no aporta info nueva).
          }
        })
        .catch(function(e){ _chuPaso('Error anotando en Chunior: '+(e.message||''), 'err'); toast('⚠️ Error registrando en Chunior: '+(e.message||''), 'red'); });
    }
    // Si no hay Chunior involucrado (billetera sin CHUNIOR_UID), NO disparamos
    // el watchdog: sabemos que va a haber diferencia (Drex cambió, Chunior no).

    if(ok){
      if(bil && bil.ID_BILLETERA) await ajustarSaldoBilletera(bil.ID_BILLETERA, tipo==="CARGA" ? montoAbs : -montoAbs);
      if(res){
        if(_rechazoCasino){
          // El modal de resultado apareció pero NO dijo "Operación correcta" → rechazo. NO se anotó en Chunior.
          res.innerHTML = '<div class="err-box">❌ '+tipo+' de '+money(montoAbs)+' → <b>'+escapeHtml(usuario)+'</b>: el casino <b>NO confirmó "Operación correcta"</b> (rechazo).<br><span class="small">NO se anotó en Chunior. Verificá en el casino antes de reintentar.</span></div>';
        } else if(_confianza === 'duplicado'){
          // El saldo saltó un múltiplo del monto → se aplicó de más. NO se anota en Chunior; el operador corrige.
          res.innerHTML = '<div class="alert-box">🚨 '+tipo+' DUPLICADA ('+(_vecesDup||'?')+'x) → <b>'+escapeHtml(usuario)+'</b> · saldo '+money(saldoPre)+'→'+money(saldoPost)+'.<br><span class="small">NO se anotó en Chunior. Revisá/corregí en el casino.</span></div>';
        } else {
          // El N° de Chunior se actualiza después si llega — por ahora mostramos OK directo
          res.innerHTML = '<div class="ok-box">✅ '+tipo+' de '+money(montoAbs)+' → <b>'+escapeHtml(usuario)+'</b> completada</div>';
        }
      }
      toast(_rechazoCasino ? ('❌ '+tipo+' rechazada por el casino · no anotada') : _confianza === 'duplicado' ? ('🚨 '+tipo+' duplicada · revisá') : (tipo+" completada: "+usuario+" · "+money(montoAbs)), (_rechazoCasino||_confianza==='duplicado') ? "red" : "green");
      // Auto-registrar al usuario en NODO si vino de una CARGA y no existe en la base (segundo plano)
      if(tipo === "CARGA" && busqueda?.user){
        _autoregistrarUsuarioSiFalta(busqueda.user);
      }
      // Limpiar campos de entrada después de la operación exitosa
      const manualUsuarioEl = document.getElementById("manualUsuario");
      const manualMontoEl   = document.getElementById("manualMonto");
      if(manualUsuarioEl) manualUsuarioEl.value = "";
      if(manualMontoEl)   manualMontoEl.value   = "";
    } else {
      if(res) res.innerHTML = '<div class="err-box">❌ '+tipo+' falló: '+escapeHtml(resultado?.message||'sin detalle')+'</div>';
      toast("Error: "+(resultado?.message||"falló"),"red");
    }

    await window.ctrlElectron.navigateAgent();
    await cargarHistorial();
    renderBillerasInicio();
    poblarManualBilletera();
  } catch(e) {
    const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, origen:'MANUAL', estado:'ERROR', notas:_errNotas('EXCEPCION', e.message||'excepción', {paso:'excepción', stack:String((e&&e.stack)||'').split('\n').slice(0,3).join(' | ')})});
    if(res) res.innerHTML = '<div class="err-box">Error inesperado: '+escapeHtml(e.message||'sin detalle')+'</div>';
    _trazaPaso('Error inesperado: '+(e.message||'sin detalle'),'err'); _trazaFin('err', _fh&&_fh.id);
    toast("Error: "+(e.message||"sin detalle"),"red");
  } finally {
    // Red de seguridad: si algún camino no finalizó la traza, cerrarla como error.
    try{ if(window._traza && !window._traza.fin && window._traza.pasos && window._traza.pasos.length){ _trazaFin('err'); } }catch(_e){}
    _liberarLock();
  }
}

// ── Blanquear clave: motor compartido ─────────────────────────────────────────
// Devuelve {ok, message}. Si onResultHtml viene, también lo escribe en ese div.
async function _ejecutarBlanqueoClave(usuario, opciones){
  opciones = opciones || {};
  const clave = opciones.clave || "12345a";
  const resEl = opciones.resultEl || null;
  if(!window.ctrlElectron){ alert("Solo disponible en la app de escritorio."); return { ok:false }; }
  if(!usuario){ toast("Usuario inválido.", "red"); return { ok:false }; }

  if(resEl) resEl.innerHTML = '<div class="alert-box">Buscando '+escapeHtml(usuario)+'...</div>';
  try {
    if(!await ensureDrexSession()){ if(resEl) resEl.innerHTML = ''; return { ok:false }; }
    toast("Buscando "+usuario+"...", "blue");
    const b = await callDrex("buscarUsuario", usuario);
    if(!b.exists){
      if(resEl) resEl.innerHTML = '<div class="err-box">❌ <b>'+escapeHtml(usuario)+'</b> no existe en el casino.</div>';
      toast(usuario+" no encontrado", "red");
      return { ok:false };
    }
    toast("Cambiando clave de "+usuario+"...", "blue");
    const r = await callDrex("cambiarClave", clave);
    const ok = r && r.ok !== false;
    await registrarEnHistorial({usuario, tipo:'RESET_CLAVE', monto:0, origen:'MANUAL', estado: ok ? 'OK' : 'ERROR', notas:'clave → '+clave});
    if(ok){
      // Tocarlo copia usuario y clave, listos para pegarle al jugador (pedido de Juan). El handler se
      // asigna por JS y no en un onclick="" armado con el texto: un usuario con comillas lo rompía.
      if(resEl){
        resEl.innerHTML = '<div class="ok-box" role="button" tabindex="0" title="Tocá para copiar usuario y clave" style="cursor:pointer">🔑 Clave de <b>'+escapeHtml(usuario)+'</b> blanqueada → <b>'+escapeHtml(clave)+'</b> <span style="opacity:.65;font-size:11px">· tocá para copiar</span></div>';
        const _caja = resEl.firstElementChild || resEl.firstChild;
        if(_caja) _caja.onclick = function(){ window.nodoCopiar('Usuario: '+usuario+'\nClave: '+clave, { etiqueta:'Usuario y clave copiados' }); };
      }
      toast("Clave de "+usuario+" blanqueada → "+clave, "green");
    } else {
      if(resEl) resEl.innerHTML = '<div class="err-box">❌ Error al cambiar clave: '+escapeHtml(r?.message||'falló')+'</div>';
      toast("Error: "+(r?.message||"falló"), "red");
    }
    await cargarHistorial();
    return { ok };
  } catch(e){
    if(resEl) resEl.innerHTML = '<div class="err-box">Error: '+escapeHtml(e.message||'sin detalle')+'</div>';
    toast("Error: "+(e.message||"sin detalle"), "red");
    return { ok:false };
  }
}

// Botón del form manual (toma el usuario del input)
async function blanquearClaveManual(){
  const usuario = (document.getElementById("manualUsuario")?.value || "").trim();
  const res     = document.getElementById("manualResultado");
  if(!usuario){ toast("Ingresá un usuario para blanquear la clave.", "red"); return; }
  if(!confirm('¿Blanquear la clave de "'+usuario+'" → 12345a?')) return;
  const r = await _ejecutarBlanqueoClave(usuario, { resultEl: res });
  if(r.ok){
    // Limpiar inputs después del éxito
    const mu = document.getElementById("manualUsuario"); if(mu) mu.value = "";
    const mm = document.getElementById("manualMonto");   if(mm) mm.value = "";
  }
}

// Botón de cada fila del historial (toma el usuario directamente)
async function blanquearClaveUsuario(usuario){
  if(!usuario){ toast("Usuario inválido.", "red"); return; }
  if(!confirm('¿Blanquear la clave de "'+usuario+'" → 12345a?')) return;
  await _ejecutarBlanqueoClave(usuario, {});
}

// ── Consulta en tiempo real de retiros del usuario (cuando no hay monto) ─────
let _consultaRetirosDebounce = null;
let _consultaRetirosTokenActual = 0;

async function consultarRetirosUsuarioRealtime(){
  const usuario  = (document.getElementById("manualUsuario")?.value || "").trim();
  const montoRaw = (document.getElementById("manualMonto")?.value || "").trim();
  const res = document.getElementById("manualResultado");
  if(!res) return;

  // Si hay monto o no hay usuario → limpiar solo si lo que estaba era nuestra consulta
  if(!usuario || montoRaw){
    if(res.dataset.modo === 'consultaRetiros'){
      res.innerHTML = '';
      delete res.dataset.modo;
    }
    return;
  }

  // Token para descartar respuestas viejas si el operador sigue tecleando
  const miToken = ++_consultaRetirosTokenActual;
  res.dataset.modo = 'consultaRetiros';
  res.innerHTML = '<div class="alert-box" style="padding:10px"><span class="small">Buscando retiros de <b>'+escapeHtml(usuario)+'</b>...</span></div>';

  try {
    // Ventana de 24hs exactas — la política de retiro es 1 cada 24hs
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Match EXACTO pero sin distinguir mayúsculas (mismo criterio que verificarRetiro24h): los
    // retiros se guardan a veces "Cristina0735" y a veces "cristina0735". Escapamos %/_ del patrón.
    const _uPat = String(usuario||'').replace(/[\\%_]/g, function(c){ return '\\'+c; });
    // No filtramos por pc_codigo: queremos detectar si el usuario retiró desde OTRA oficina
    const { data } = await supabaseClient
      .from("historial_ops")
      .select("created_at, monto, billetera_nombre, estado, origen, chunior_movimiento_id, pc_codigo, notas")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      // Los CIERRES de un retiro parcial se anotan como RETIRO de $0. No son un retiro: son una
      // decisión administrativa. Salían acá como "$ 0 · —" sin decir qué eran y, con el tope de 10
      // filas, TAPABAN retiros de verdad — Maria6981x tenía 6 de 10 filas ocupadas por cierres.
      .gt("monto", 0)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(10);

    if(miToken !== _consultaRetirosTokenActual) return; // se quedó obsoleto
    if(res.dataset.modo !== 'consultaRetiros') return;  // el operador ya escribió monto u operó

    if(!data || !data.length){
      res.innerHTML = '<div class="alert-box" style="padding:10px"><span class="small">📭 <b>'+escapeHtml(usuario)+'</b> no tiene retiros en las últimas 24hs.</span></div>';
      return;
    }

    // ¿Hay alguno de otra oficina?
    const otrasOficinas = data
      .map(r => r.pc_codigo)
      .filter(pc => pc && pc !== pcOperativa);
    const tagCrossOficina = otrasOficinas.length > 0
      ? '<div style="background:#3a2515;color:#ffa066;padding:6px 10px;border-radius:8px;margin-top:6px;font-size:12px">' +
        '🚨 <b>Atención:</b> hay retiros de este usuario en otra oficina ('+escapeHtml([...new Set(otrasOficinas)].join(', '))+'). Verificá antes de proceder.' +
        '</div>'
      : '';

    // Etiqueta de ORIGEN: aclara de dónde viene cada retiro.
    //   LANDING = importado del CSV de operaciones de agentes (retiro real del jugador en la plataforma)
    //   PANEL/AUTO/MANUAL/CHAT = procesado por NODO
    const origenLabel = function(o){
      const map = {
        LANDING: { txt: 'CSV agentes', color: '#9aa4b2' },
        PANEL:   { txt: 'NODO panel',  color: '#7aa2ff' },
        AUTO:    { txt: 'NODO auto',   color: '#7aa2ff' },
        MANUAL:  { txt: 'NODO manual', color: '#7aa2ff' },
        CHAT:    { txt: 'NODO chat',   color: '#7aa2ff' },
        CIERRE:  { txt: 'cierre',      color: '#c084fc' }
      };
      const m = map[o] || { txt: (o||'?'), color: '#9aa4b2' };
      return '<span style="font-size:9px;color:'+m.color+';border:1px solid '+m.color+'55;border-radius:4px;padding:1px 5px;margin-left:4px">'+escapeHtml(m.txt)+'</span>';
    };

    let filas = '';
    data.forEach(function(r){
      const fecha     = formatFecha(r.created_at);
      const billetera = r.billetera_nombre || '—';
      const tagErr    = r.estado === 'ERROR' ? ' <span style="color:var(--red)">❌</span>' : '';
      const esExterna = r.pc_codigo && r.pc_codigo !== pcOperativa;
      const pcBadge   = r.pc_codigo
        ? '<span class="badge '+(esExterna?'badge-danger':'badge-muted')+'" style="font-size:9px;padding:2px 6px;margin-left:4px">'+escapeHtml(r.pc_codigo)+'</span>'
        : '';
      // Un tramo de un retiro grande NO es un retiro aparte: es el mismo criterio con el que la
      // regla de 24hs los descarta (_blEsParcial). Sin decirlo, la lista parece cinco retiros.
      const tagParcial = (typeof _blEsParcial === "function" && _blEsParcial(r))
        ? ' <span style="font-size:9px;color:#c084fc;border:1px solid #c084fc55;border-radius:4px;padding:1px 5px;margin-left:4px">parte de un retiro</span>'
        : '';
      filas += '<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid rgba(255,255,255,.08);font-size:12px">'
        +   '<span style="color:#c0cad8;white-space:nowrap">'+escapeHtml(fecha)+tagErr+pcBadge+origenLabel(r.origen)+tagParcial+'</span>'
        +   '<span style="text-align:right"><b>'+money(r.monto)+'</b> <span class="small">· '+escapeHtml(billetera)+'</span></span>'
        + '</div>';
    });
    res.innerHTML = '<div class="alert-box" style="padding:10px;line-height:1.4">'
      + '<b>⚠️ Retiros de '+escapeHtml(usuario)+' en las últimas 24hs</b>'
      + tagCrossOficina
      + '<div style="margin-top:4px">'+filas+'</div>'
      + '</div>';
  } catch(e){
    if(miToken !== _consultaRetirosTokenActual) return;
    res.innerHTML = '<div class="alert-box" style="padding:10px"><span class="small">Error consultando retiros: '+escapeHtml(e.message||'')+'</span></div>';
  }
}

function _configurarConsultaRetirosLive(){
  const inputUsuario = document.getElementById("manualUsuario");
  const inputMonto   = document.getElementById("manualMonto");
  if(!inputUsuario || !inputMonto) return;
  const onChange = function(){
    clearTimeout(_consultaRetirosDebounce);
    _consultaRetirosDebounce = setTimeout(consultarRetirosUsuarioRealtime, 450);
  };
  inputUsuario.addEventListener("input", onChange);
  inputMonto.addEventListener("input", onChange);
}

// Copia solo el usuario (para pasárselo al cliente junto con su teléfono → login al portal de cargas).
async function _copiarSoloUsuario(usuario){
  try{ await navigator.clipboard.writeText(usuario); toast("Usuario copiado: " + usuario, "green"); }
  catch(_e){ toast("No se pudo copiar", "red"); }
}
// Mensaje prolijo y completo para pegar en el chat del cliente: usuario+clave y la aclaración
// de los DOS logins distintos (portal de cargas con usuario+teléfono vs. plataforma con usuario+clave).
async function _copiarMensajeClienteNuevo(usuario, clave){
  const msg = "¡Listo! Tu usuario ya está creado ✅\n\n" +
    "Usuario: " + usuario + "\n" +
    "Clave: " + clave + "\n\n" +
    "🔹 Para CARGAR o RETIRAR fichas: entrá al portal de cargas con tu usuario + tu teléfono.\n" +
    "🔹 Para JUGAR en la plataforma: entrá con tu usuario + la clave de arriba.";
  try{ await navigator.clipboard.writeText(msg); toast("Mensaje copiado · pegalo en el chat", "green"); }
  catch(_e){ toast("No se pudo copiar", "red"); }
}
// ── Auto-actualización: chequeo/descarga/instalación MANUAL (botón en el sidebar) ──
// Nunca automática: mientras seguimos iterando, cada oficina actualiza cuando el
// operador lo decide, no sola al abrir la app.
// Saca la cajita del modo plegado SIN guardar la preferencia: si hay una versión nueva el
// operador tiene que verla aunque la haya minimizado, pero si la vuelve a plegar se queda
// plegada hasta el próximo chequeo. Avisar sí; hinchar, no.
