const _HIST_FULL_MAX = 5000;
function _histFullKey(){ return "nodo_historial_full_"+(pcOperativa||"sin_pc"); }
function _archivoHistorialCargar(){
  try{ const raw = localStorage.getItem(_histFullKey()); const o = raw?JSON.parse(raw):null; return (o && Array.isArray(o.rows)) ? o.rows : []; }
  catch(_e){ return []; }
}
function _archivoHistorialGuardar(rows){
  try{ localStorage.setItem(_histFullKey(), JSON.stringify({ ts:Date.now(), rows: rows.slice(0, _HIST_FULL_MAX) })); }
  catch(_e){
    try{ localStorage.setItem(_histFullKey(), JSON.stringify({ ts:Date.now(), rows: rows.slice(0, Math.floor(_HIST_FULL_MAX/2)) })); }catch(_e2){}
  }
}
function _movStoreToHistRows(){
  try{
    if(typeof _movStoreAll !== 'function') return [];
    const map = _movStoreAll();
    return Object.keys(map).map(function(k){
      const m = map[k] || {};
      return {
        id: (m.id!=null ? m.id : ('mov_'+k)),
        usuario: m.usuario||'', tipo: m.tipo||'', monto: m.monto!=null?m.monto:0,
        billetera_id: null, billetera_nombre: m.billeteraNombre||null,
        origen: m.origen||'MANUAL', estado: m.estado||'OK',
        notas: m.notas||null, chunior_movimiento_id: m.chuniorId||null,
        saldo_pre: (m.saldoPre!=null?m.saldoPre:null), saldo_post: (m.saldoPost!=null?m.saldoPost:null),
        operador: m.operador||null, solicitud_id: m.solicitudId||null,
        created_at: m._fecha || (m._ts?new Date(m._ts).toISOString():null)
      };
    }).filter(function(r){ return r.usuario || r.monto; });
  }catch(_e){ return []; }
}
function _archivoHistorialMerge(nuevas){
  const map = {};
  _archivoHistorialCargar().forEach(function(r){ if(r && r.id!=null) map[String(r.id)] = r; });
  (nuevas||[]).forEach(function(r){ if(r && r.id!=null) map[String(r.id)] = r; });
  const arr = Object.values(map).sort(function(a,b){ return new Date(b.created_at||0)-new Date(a.created_at||0); });
  _archivoHistorialGuardar(arr);
  return arr;
}
// Resumen compacto del árbol de un usuario (para embeber en el modal de retiro parcial):
// totales + últimas operaciones. Devuelve '' si no hay historial.
function _arbolResumenHtml(usuario){
  try{
    if(typeof arbolUsuario!=='function') return '';
    const perfil = window.NodoPerfilConsulta?.snapshot(usuario);
    const resumen = perfil?.mode==='beta' ? perfil.resumen : null;
    const arbol = arbolUsuario(usuario);
    if(!arbol.length && !resumen) return '';
    let totC=0, totR=0;
    const disponible = (!!resumen && !resumen.requiere_revision) || !perfil || perfil.mode==='legacy';
    if(resumen){ totC=resumen.montoCargas; totR=resumen.montoRetiros; }
    else if(disponible) arbol.forEach(function(o){ const m=Math.abs(Number(o.monto||0)); const t=String(o.tipo||'').toUpperCase(); if(t==='CARGA')totC+=m; else if(t==='RETIRO')totR+=m; });
    const titulo = resumen ? resumen.totalOps+' registros'+(resumen.requiere_revision?'':' · importes confirmados') : arbol.length+' registros cargados';
    const importes = disponible
      ? '<span style="color:#22c55e">⬆️ '+money(totC)+'</span><span style="color:#fb923c">⬇️ '+money(totR)+'</span><span style="color:#e6edf3">neto <b>'+money(resumen ? resumen.neto : totC-totR)+'</b></span>'
      : '<span>'+(resumen?.requiere_revision?'Reversiones pendientes de cotejo':'Resumen del servidor pendiente')+'</span>';
    const ult = arbol.slice(0,6).map(function(o){
      const t=String(o.tipo||'').toUpperCase(); const ico=t==='CARGA'?'⬆️':t==='RETIRO'?'⬇️':'•';
      return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#94a3b8"><span>'+ico+' '+escapeHtml(t||'—')+' · '+formatFecha(o.fecha)+'</span><span style="font-weight:700;color:'+(t==='RETIRO'?'#fb923c':'#22c55e')+'">'+money(Math.abs(Number(o.monto||0)))+'</span></div>';
    }).join('');
    return '<div style="margin-top:10px;padding:8px 10px;background:#0d1117;border:1px solid #21262d;border-radius:9px">'
      + '<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;margin-bottom:4px;flex-wrap:wrap"><b style="color:#c9d1d9">🌳 '+titulo+'</b>'+importes+'</div>'
      + (perfil?.mode==='beta' ? '<div class="small">Detalle cargado: '+arbol.length+(perfil.error?' · actualización pendiente':'')+'</div>' : '')
      + ult + '</div>';
  }catch(_e){ return ''; }
}
// Progreso de un retiro PARCIAL: cuánto se pagó ya (metadata.retiro_parcial.pagado) y cuánto resta.
// Se usa para que la tarjeta y el modal muestren el RESTANTE (no el total original) a medida que se paga.
// ── Cuánto se pagó REALMENTE de un retiro ────────────────────────────────────────────────────
// Se SUMA DEL HISTORIAL, no se lee de un contador. Cada transferencia real escribe su fila con
// solicitud_id, monto y billetera: ese es el libro, y es el único registro que existe porque
// hubo plata moviéndose. metadata.monto_pagado es un acumulado que se le suma a ciegas en cada
// pago — se conto doble una vez y quedaron solicitudes diciendo "pagado 450.000" cuando habian
// salido 250.000, sin forma de corregirlo desde el panel (la RPC solo suma, no fija).
// Derivarlo del historial lo hace AUTOCORREGIBLE: si el numero guardado esta podrido, el proximo
// pago lo pisa con la suma real. Mismo criterio que con Chunior y el saldo de las billeteras:
// la verdad es el registro de los movimientos, no un contador paralelo.
window._retiroPagadoDelHistorial = function(solicitudId){
  const sid = String(solicitudId||''); if(!sid) return null;
  let filas = [];
  // OJO con el "||" y con Array.isArray: una lista VACÍA es "verdadera" en JS, así que ganaba la
  // vacía y el respaldo no se usaba NUNCA. Gana la que tenga filas.
  try{
    const _lex = (typeof _historialData!=='undefined' && Array.isArray(_historialData)) ? _historialData : null;
    const _win = Array.isArray(window._historialData) ? window._historialData : null;
    filas = (_lex && _lex.length) ? _lex : (_win || _lex || []);
  }catch(_e){ return null; }
  if(!filas.length) return null;                       // historial no cargado → no afirmamos nada
  let suma = 0, n = 0, desde = Infinity;
  filas.forEach(function(h){
    // Hasta dónde llega ATRÁS lo que hay cargado. El historial en pantalla es de un período: si
    // el retiro empezó antes, faltan pagos y la suma NO se puede comparar con nada.
    const t = new Date((h && h.created_at) || 0).getTime();
    if(Number.isFinite(t) && t > 0 && t < desde) desde = t;
    if(!h || String(h.solicitud_id||'')!==sid) return;
    if(normalizar(h.tipo)!=='RETIRO') return;
    if(normalizar(h.estado)!=='OK') return;            // sólo las efectivas
    suma += Math.abs(Number(h.monto||0)) || 0; n++;
  });
  // `desde` viaja siempre: sin él no se sabe si la suma está completa.
  return n ? { pagado:suma, filas:n, desde:desde } : null;   // sin filas → todavía no se pagó nada
};

window._retiroParcialInfo = function(s){
  // El total salía SIEMPRE del monto de la solicitud, ignorando el que registró la RPC de
  // parciales. Con un monto mal cargado —hay solicitudes que entraron del portal con un cero
  // de más (D-65)— la caja mostraba cifras delirantes y "cuánto falta" quedaba sin sentido.
  // Manda el total que usó el motor de pagos; el de la solicitud queda de respaldo (D-66).
  let total = 0;
  let pagado = 0, pagadoAlt = 0;
  let _pagosRp = [];   // los pagos del contador, para saber desde cuándo corre este retiro
  try{
    let m = (s&&(s.METADATA!==undefined?s.METADATA:s.metadata))||{};
    if(typeof m==='string'){ try{ m=JSON.parse(m); }catch(_e){ m={}; } }
    const rp = (m&&(m.retiro_parcial||m.retiro_progreso||m.progreso))||{};
    _pagosRp = Array.isArray(rp.pagos) ? rp.pagos : [];
    pagado = Math.abs(Number((rp.pagado!=null?rp.pagado:(rp.acumulado!=null?rp.acumulado:(m.pagado_parcial!=null?m.pagado_parcial:0))))||0);
    // El progreso vive en DOS lugares: retiro_parcial (lo escribe la RPC) y monto_pagado suelto (lo
    // escribe el panel). Si un pago quedó registrado en uno solo, los números no coinciden y el
    // retiro se ve "a medio pagar" aunque esté saldado. Guardamos el otro para poder avisarlo.
    pagadoAlt = Math.abs(Number(m.monto_pagado!=null ? m.monto_pagado : pagado)||0);
    // Si el operador CORRIGIÓ el monto ("pagarle todo lo que tiene"), esa es la deuda. La RPC
    // guardaba el total viejo y la caja decía "falta $45.000 de $50.000" con la solicitud ya
    // corregida a $35.019 (D-86). La corrección manda; la RPC ya se arregló igual.
    const _corr = Number(m.monto_corregido)||0;
    total = _corr > 0 ? _corr : (Number(rp.total)||0);
  }catch(_e){}
  if(!(total>0)) total = Number((s&&(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO))||0);
  if(total>0 && pagado>total) pagado=total;
  const _alt = (total>0 && pagadoAlt>total) ? total : pagadoAlt;
  // TERCERA fuente, y la única que NO es un contador: la suma de las transferencias que realmente
  // salieron (historial_ops). Si un pago no llegó a anotarse en el progreso —le pasó al último pago
  // de un retiro, D-100— el libro igual lo tiene y el retiro deja de figurar colgado para siempre.
  let _hist = 0, _histCompleto = false;
  try{
    const _h = window._retiroPagadoDelHistorial
      ? window._retiroPagadoDelHistorial(s && (s.ID || s.SOLICITUD_ID || s.solicitud_id || s.id)) : null;
    if(_h && _h.pagado > 0) _hist = (total>0 && _h.pagado>total) ? total : _h.pagado;
    // ¿La suma del historial se puede COMPARAR? Sólo si lo cargado llega más atrás que el primer
    // pago: el historial en pantalla es de un período, y si el retiro empezó antes faltan pagos.
    // Sin esto, el panel gritaba «el progreso no coincide» con los dos registros perfectamente
    // iguales — le pasó al #275413 (normaacdc), donde el pago más viejo quedaba fuera del período
    // cargado y la resta daba justo ese pago (Juan, 28/9). Mandar a revisar algo que está bien
    // cuesta el tiempo del operador y le saca valor al aviso cuando el descuadre es de verdad.
    if(_h && Number.isFinite(_h.desde)){
      let _primerPago = Infinity;
      const _pagos = _pagosRp;
      _pagos.forEach(function(pg){
        const t = new Date((pg && pg.fecha) || 0).getTime();
        if(Number.isFinite(t) && t > 0 && t < _primerPago) _primerPago = t;
      });
      if(!Number.isFinite(_primerPago)){
        const t = new Date((s && (s.FECHA_CREACION || s.created_at || s.FECHA)) || 0).getTime();
        if(Number.isFinite(t) && t > 0) _primerPago = t;
      }
      _histCompleto = Number.isFinite(_primerPago) && _h.desde <= _primerPago;
    }
  }catch(_e){}
  // "Esto es un retiro EN PARTES" lo dice SÓLO la máquina de parciales (retiro_parcial). El
  // historial dice CUÁNTO se pagó, que es otra cosa: todo retiro pagado tiene su fila ahí, así que
  // usarlo para decidir "hay progreso" convertía en parcial a TODOS los retiros comunes — salían
  // como "Parcial 100%" con monto $0 (D-103). Y monto_pagado tampoco sirve: el panel lo escribe en
  // cada retiro, parcial o no.
  const hayParcial = pagado > 0.5;
  // Con progreso real, lo cobrado es lo más alto: un pago puede faltar en un contador, pero si salió, salió.
  const _cobrado = hayParcial ? Math.max(pagado, _alt, _hist) : pagado;
  return {
    total:total, pagado:_cobrado, restante:Math.max(0, total - _cobrado),
    hasProg:hayParcial,
    // Las otras fuentes + si discrepan: NO se decide por una, se avisa al operador para que resuelva.
    pagadoRpc:pagado, pagadoAlt:_alt, pagadoHistorial:_hist,
    discrepa: (Math.abs(_alt - pagado) > 1) || (_histCompleto && _hist > 0.5 && Math.abs(_hist - pagado) > 1),
    histCompleto: _histCompleto,
    saldadoPorAlguna: (total>0 && _cobrado >= total-0.5)
  };
};
// Un RETIRO con progreso PARCIAL (se pagó algo pero NO todo) sigue PENDIENTE hasta cobrar el total,
// aunque la RPC lo haya marcado PAGADA/completo. Solo debe desaparecer si se retiró por COMPLETO
// (pagado >= total) o si es un cierre deliberado (RECHAZADA/CANCELADA). Red de seguridad del panel.
// Caja de retiros pagándose por partes. Portado de la línea de la encargada (5405ff9): los
// parciales salían mezclados con las solicitudes nuevas y se perdían de vista — de hecho pasamos
// media sesión peleando con uno que "desaparecía". La lista la arma el render del Inicio en
// window._parcialesEnProceso.
// Recalcula la caja con lo que hay AHORA en memoria. Antes leía window._parcialesEnProceso, que es
// una foto que sólo se rearma cuando el Inicio se repinta: un retiro cobrado entero (o cerrado
// desde otra PC) seguía apareciendo con «falta $X» aunque en la base ya no faltara nada (D-108).
window._parcialesAhora = function(){
  try{
    const dom = window.NodoDomain && window.NodoDomain.parciales;
    const todas = (window.V154P && window.V154P.solicitudes) || [];
    if(!dom || !todas.length) return (window._parcialesEnProceso || []).slice();
    const vivos = todas.filter(function(s){
      return dom.enProceso(s, {
        info: window._retiroParcialInfo, cerrado: window._retiroCerradoAMano,
        sigueAbierto: window._retiroParcialSigueAbierto
      });
    });
    window._parcialesEnProceso = vivos;   // que el contador y la caja digan lo mismo
    try{
      ['btnParcialesCount','btnParcialesCCCount'].forEach(function(id){
        const el = document.getElementById(id); if(el) el.textContent = String(vivos.length);
      });
      ['btnParcialesEnProceso','btnParcialesCC'].forEach(function(id){
        const el = document.getElementById(id); if(el) el.style.display = vivos.length ? '' : 'none';
      });
    }catch(_e){}
    return vivos.slice();
  }catch(_e){ return (window._parcialesEnProceso || []).slice(); }
};
window.verRetirosParciales = function(){
  const arr = window._parcialesAhora();
  if(!arr.length){ try{ toast('No hay retiros pagándose por partes.','blue'); }catch(_e){} return; }
  const filas = arr.map(function(s){
    const id  = Number(s.ID || s.SOLICITUD_ID || 0);
    const pp  = window._retiroParcialInfo ? window._retiroParcialInfo(s) : {total:0,pagado:0,restante:0};
    const pct = pp.total > 0 ? Math.min(100, Math.round(pp.pagado * 100 / pp.total)) : 0;
    const usuario = escapeHtml(String(s.USUARIO || s.USUARIO_JUGADOR || ''));
    const titular = escapeHtml(String(s.TITULAR || s.NOMBRE_COMPLETO || ''));
    const fecha   = s.FECHA_CREACION || s.created_at || s.FECHA || '';
    return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #7c3aed;border-radius:10px;padding:10px 12px;margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
      +   '<div style="min-width:0"><b style="font-size:15px;color:#f0f6fc">'+usuario+'</b>'
      +     (titular ? '<div class="small" style="color:#8b949e">'+titular+'</div>' : '') + '</div>'
      +   '<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:#a78bfa">falta '+money(pp.restante)+'</div>'
      +     '<div class="small" style="color:#8b949e">'+money(pp.pagado)+' de '+money(pp.total)+'</div></div>'
      + '</div>'
      + '<div style="height:6px;background:#0d1117;border-radius:999px;overflow:hidden;margin-top:8px">'
      +   '<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#7c3aed,#a78bfa)"></div></div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px">'
      +   '<span class="small" style="color:#8b949e">#'+id+(fecha ? ' · '+escapeHtml(String(formatFecha(fecha))) : '')+'</span>'
      +   '<button class="mini-btn" style="background:#7c3aed;color:#fff;border:none;font-size:11px" '
      +     'onclick="cerrarModal();v154pRegistrarParcial('+id+')">💸 Pagar más</button>'
      + '</div></div>';
  }).join('');
  abrirModal('💸 Retiros pagándose por partes · '+arr.length, filas, null, '');
};

// ¿Este retiro cerrado lo cerró el operador A MANO desde la caja de Parciales?
// El cierre a mano es DEFINITIVO: es una decisión del operador y no la revierte nadie.
//
// Vivía en `etapa`, y ese campo lo pisa CADA pago parcial (withdrawals-execution: etapa =
// RETIRO_V2_PARCIAL). O sea que un pago posterior borraba el cierre y el retiro volvía a la caja.
// El #266250 de Maria6981x se cerró SIETE veces por esto (25-26/9). Ahora la marca va en su
// propia llave, que no escribe ningún otro camino.
// Se sigue aceptando la marca vieja en `etapa` para los retiros que ya se cerraron así.
function _retiroCerradoAMano(s){
  try{
    let m = (s&&(s.METADATA!==undefined?s.METADATA:s.metadata))||{};
    if(typeof m==='string'){ try{ m=JSON.parse(m); }catch(_e){ m={}; } }
    if(m && m.cierre_manual) return true;
    return String((m&&m.etapa)||'').toUpperCase()==='RETIRO_CIERRE_MANUAL';
  }catch(_e){ return false; }
}
window._retiroCerradoAMano = _retiroCerradoAMano;
window._retiroParcialSigueAbierto = function(s){
  try{
    if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='RETIRO') return false;
    const est = String(s.ESTADO||'').toUpperCase();
    if(/RECHAZ|CANCEL/.test(est)) return false;   // cierre deliberado del operador → respetar
    // Cerrado a mano ("✔ ya cobró todo"). Sin esto el retiro volvía a la caja en el
    // siguiente refresco: se podía cerrar infinitas veces y el contador nunca bajaba de 1.
    if(_retiroCerradoAMano(s)) return false;
    const pp = window._retiroParcialInfo ? window._retiroParcialInfo(s) : null;
    if(!pp) return false;
    // Si CUALQUIERA de las dos fuentes del progreso dice que ya está pago, no se reabre.
    // Es el MISMO criterio con el que la caja imprime "✔ saldado" — antes esta función usaba
    // otro (sólo retiro_parcial.pagado) y las dos mitades del panel se contradecían: la caja
    // decía "saldado" y este filtro lo devolvía a la lista.
    if(pp.saldadoPorAlguna) return false;
    return !!(pp.hasProg && pp.total>0 && pp.pagado < pp.total - 0.5);
  }catch(_e){ return false; }
};
// Caja "En proceso": lo que YA tiene alguien trabajando, separado de lo que nadie tocó.
//   · TOMADAS: cargas y retiros que alguien tomó con el botón Tomar y todavía no se terminaron.
//   · PAGÁNDOSE POR PARTES: retiros que se están pagando en pagos parciales.
// Las dos salen de "Solicitudes pendientes": ahí quedan sólo las que nadie agarró, que es lo que hace
// falta ver cuando entran tres o cinco juntas (Juan, 25/10). Los parciales además podían quedar
// abiertos días y tapaban las nuevas. La lista la arma el render del Inicio
// (window._tomadasEnProceso y window._parcialesEnProceso).
function _enProcesoFilaParcial(s){
  const id  = Number(s.ID || s.SOLICITUD_ID || 0);
  const pp  = window._retiroParcialInfo ? window._retiroParcialInfo(s) : {total:0,pagado:0,restante:0};
  const pct = pp.total > 0 ? Math.min(100, Math.round(pp.pagado * 100 / pp.total)) : 0;
  const usuario = escapeHtml(String(s.USUARIO || s.USUARIO_JUGADOR || ''));
  const titular = escapeHtml(String(s.TITULAR || s.NOMBRE_COMPLETO || ''));
  const fecha   = s.FECHA_CREACION || s.created_at || s.FECHA || '';
  // Ya cobró todo pero la solicitud quedó abierta → se ofrece cerrarla, no pagar más.
  // "saldadoPorAlguna": una de las dos fuentes del progreso dice que ya está pago.
  const saldado = pp.restante <= 0.5 || pp.saldadoPorAlguna;
  const acento  = saldado ? '#22c55e' : '#7c3aed';
  return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid '+acento+';border-radius:10px;padding:10px 12px;margin-bottom:8px">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
    +   '<div style="min-width:0"><b style="font-size:15px;color:#f0f6fc">'+usuario+'</b>'
    +     (titular ? '<div class="small" style="color:#8b949e">'+titular+'</div>' : '') + '</div>'
    +   '<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:'+acento+'">'
    +       (saldado ? '✔ saldado' : 'falta '+money(pp.restante))+'</div>'
    +     '<div class="small" style="color:#8b949e">'+money(pp.pagado)+' de '+money(pp.total)+'</div></div>'
    + '</div>'
    + '<div style="height:6px;background:#0d1117;border-radius:999px;overflow:hidden;margin-top:8px">'
    +   '<div style="height:100%;width:'+pct+'%;background:'+(saldado?'#22c55e':'linear-gradient(90deg,#7c3aed,#a78bfa)')+'"></div></div>'
    // Las dos fuentes del progreso no coinciden → no se decide por una: se muestran las dos y el
    // operador elige (cobró todo → Cerrar · falta → Pagar más).
    + (pp.discrepa
        ? ('<div style="margin-top:8px;padding:6px 9px;border-radius:8px;background:rgba(245,197,24,.10);border:1px solid rgba(245,197,24,.35);font-size:11.5px;color:#fde68a">'
           + '⚠ El progreso no coincide: <b>'+money(pp.pagadoRpc)+'</b> según el contador de parciales'
           + (pp.pagadoAlt>0.5 && Math.abs(pp.pagadoAlt-pp.pagadoRpc)>1 ? ', <b>'+money(pp.pagadoAlt)+'</b> según el retiro normal' : '')
           + (pp.histCompleto && pp.pagadoHistorial>0.5 && Math.abs(pp.pagadoHistorial-pp.pagadoRpc)>1 ? ', <b>'+money(pp.pagadoHistorial)+'</b> sumando el historial' : '')
           + '. '
           + 'Fijate en el historial cuánto cobró y elegí.</div>')
        : '')
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap">'
    +   '<span class="small" style="color:#8b949e">#'+id+(fecha ? ' · '+escapeHtml(String(formatFecha(fecha))) : '')+'</span>'
    +   '<span style="display:flex;gap:6px">'
    // El "Cerrar" está SIEMPRE disponible: sin esa salida, un retiro con el progreso mal
    // registrado quedaba trabado en la bandeja sin forma de sacarlo.
    +     '<button class="mini-btn" style="background:'+(saldado?'#12b76a':'transparent')+';color:'+(saldado?'#fff':'#8b949e')+';border:'+(saldado?'none':'1px solid #30363d')+';font-size:11px" title="Marcar la solicitud como pagada (no mueve fichas ni plata)" onclick="cerrarRetiroSaldado('+id+')">✔ Cerrar'+(saldado?' · ya cobró todo':'')+'</button>'
    +     (saldado ? '' : '<button class="mini-btn" style="background:#7c3aed;color:#fff;border:none;font-size:11px" onclick="cerrarModal();v154pRegistrarParcial('+id+')">💸 Pagar más</button>')
    +   '</span>'
    + '</div></div>';
}

// Una solicitud TOMADA: lo que hace falta para terminarla sin volver a la lista. Cada botón es algo
// que se puede hacer CON esta fila: aprobarla, cambiarle el monto, pagarla por partes (sólo retiro),
// verla, rechazarla, o soltarla si se tomó por error.
function _enProcesoFilaTomada(s){
  const id  = Number(s.ID || s.SOLICITUD_ID || 0);
  const tipo = String(s.TIPO || s.TIPO_SOLICITUD || '').toUpperCase();
  const esRet = tipo === 'RETIRO';
  const acento = esRet ? '#fb923c' : '#22c55e';
  const usuario = escapeHtml(String(s.USUARIO || s.USUARIO_JUGADOR || ''));
  const titular = escapeHtml(String(s.TITULAR || s.NOMBRE_COMPLETO || ''));
  const fecha   = s.FECHA_CREACION || s.created_at || s.FECHA || '';
  const monto   = Number(s.MONTO_REAL || s.MONTO_DECLARADO || 0);
  // Quién la tiene: evita que dos operadores trabajen la misma.
  const quien = String(s.OPERADOR || '').trim();
  const yo = String((window.operador && (window.operador.usuario || window.operador.nombre)) || '').trim().toLowerCase();
  const suya = quien && yo && quien.toLowerCase() === yo;
  const lineaQuien = quien
    ? '<div class="small" style="color:'+(suya?'#7cc4ff':'#fbbf24')+'">'+(suya ? 'La tomaste vos' : 'La tiene <b>'+escapeHtml(quien)+'</b>')+'</div>'
    : '';
  // Las fichas del jugador, si ya se leyeron (en un retiro es lo que decide cómo se paga).
  let fichas = '';
  if(esRet){
    try{
      const c = (window._retiroSaldoCheck || {})[String(s.USUARIO || '').toLowerCase()];
      if(c && c.confiable !== false){
        const alcanza = c.saldo + 0.5 >= Math.abs(monto);
        fichas = '<div style="font-size:10.5px;font-weight:800;margin-top:2px;color:'+(alcanza?'#22c55e':'#ef4444')+'">fichas '+escapeHtml(String(c.raw || money(c.saldo)))+(alcanza?' ✓':' ⚠ no alcanza')+'</div>';
      }
    }catch(_e){}
  }
  const btn = function(txt, llamada, estilo, titulo){
    return '<button class="mini-btn" style="font-size:11px;'+estilo+'"'+(titulo?' title="'+escapeHtml(titulo)+'"':'')
      + ' onclick="cerrarModal();'+llamada.replace('#', id)+'">'+txt+'</button>';
  };
  const gris = 'background:transparent;color:#8b949e;border:1px solid #30363d';
  return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid '+acento+';border-radius:10px;padding:10px 12px;margin-bottom:8px">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
    +   '<div style="min-width:0"><b style="font-size:15px;color:#f0f6fc">'+usuario+'</b> '
    +     '<span style="font-size:10px;font-weight:900;border-radius:999px;padding:1px 8px;background:'+acento+'22;color:'+acento+';border:1px solid '+acento+'66">'+escapeHtml(tipo)+'</span>'
    +     (titular ? '<div class="small" style="color:#8b949e">'+titular+'</div>' : '') + lineaQuien + '</div>'
    +   '<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:'+acento+'">'+money(monto)+'</div>'+fichas+'</div>'
    + '</div>'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap">'
    +   '<span class="small" style="color:#8b949e">#'+id+(fecha ? ' · '+escapeHtml(String(formatFecha(fecha))) : '')+'</span>'
    +   '<span style="display:flex;gap:6px;flex-wrap:wrap">'
    +     btn('Soltar', 'v154pSoltarSolicitud(#)', gris, 'La devuelve a la lista de pendientes para que otro operador la tome')
    +     btn('Ver', 'v154pDetalleSolicitud(#,true)', gris)
    +     btn('Rechazar', 'v154pRechazarSolicitud(#)', 'background:transparent;color:#fca5a5;border:1px solid #7f1d1d')
    +     (esRet ? btn('💸 Parcial', 'v154pRegistrarParcial(#)', 'background:#7c3aed;color:#fff;border:none') : '')
    // Igual que en la lista de Inicio: Aprobar abre el cartel para cotejar. De una, sólo desde "Ver".
    +     btn('✓ Aprobar', 'v154pCrearJobSolicitud(#)', 'background:#12b76a;color:#fff;border:none')
    +   '</span>'
    + '</div></div>';
}

window.verRetirosParciales = function(){
  const parc = (window._parcialesEnProceso || []).slice();
  const tom  = (window._tomadasEnProceso || []).slice();
  if(!parc.length && !tom.length){ try{ toast('No hay nada en proceso.','blue'); }catch(_e){} return; }
  // Los títulos de sección sólo aparecen si hay de las dos clases: con una sola, el título del
  // cartel ya lo dice.
  const mixta = parc.length && tom.length;
  const sec = function(txt, n){
    return '<div style="font-size:11px;font-weight:800;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin:'+(mixta?'4px':'0')+' 2px 7px">'+txt+' · '+n+'</div>';
  };
  let cuerpo = '';
  if(tom.length)  cuerpo += (mixta ? sec('Tomadas · esperando que las termines', tom.length) : '') + tom.map(_enProcesoFilaTomada).join('');
  if(parc.length) cuerpo += (mixta ? sec('Pagándose por partes', parc.length) : '') + parc.map(_enProcesoFilaParcial).join('');
  const _sald = parc.filter(function(s){ const p=window._retiroParcialInfo?window._retiroParcialInfo(s):null; return p && p.restante<=0.5; }).length;
  const titulo = !parc.length ? '💸 Tomadas · '+tom.length
               : !tom.length  ? '💸 Retiros pagándose por partes · '+parc.length
               : '💸 En proceso · '+(tom.length+parc.length);
  abrirModal(titulo
    + (_sald ? ' <span style="font-size:12px;color:#22c55e">('+_sald+' ya saldado'+(_sald>1?'s':'')+')</span>' : ''), cuerpo, null, '');
};
// ── La historia de un retiro pagado en partes (D-90) ─────────────────────────────────────────
// Pedido, ajuste con su motivo, cada pago y el cierre. Se pinta en cualquier
// <div class="nodo-retiro-historia" data-sid="…" data-hist="…"> que haya en pantalla.
window._retiroHistoriaCache = window._retiroHistoriaCache || {};
window.nodoRetiroHistoriaHtml = function(sid, histId){
  return '<div class="nodo-retiro-historia" data-sid="'+escapeHtml(String(sid||''))+'" data-hist="'+escapeHtml(String(histId||''))+'" style="margin-top:10px"></div>';
};
window.nodoRetiroHistoriaLlenar = async function(root){
  const els = Array.from(((root || document).querySelectorAll && (root || document).querySelectorAll('.nodo-retiro-historia[data-sid]')) || []);
  for(const el of els){
    const sid = el.getAttribute('data-sid'); if(!sid) continue;
    let prog = window._retiroHistoriaCache[sid];
    if(!prog || Date.now() - prog._ts > 30000){
      try{
        const _retHealth = window.NodoSalud?.begin('RETIROS');
        const r = await supabaseClient.rpc('landing_retiro_progreso', { p_solicitud_id: Number(sid) });
        _retHealth?.reply(r?.error);
        const row = Array.isArray(r.data) ? r.data[0] : r.data;
        if(r.error || !row || row.ok === false) continue;
        prog = Object.assign({ _ts: Date.now() }, row);
        window._retiroHistoriaCache[sid] = prog;
      }catch(_e){ continue; }
    }
    el.innerHTML = window.nodoRetiroHistoriaPintar(prog, sid, el.getAttribute('data-hist'));
  }
};
window.nodoRetiroHistoriaPintar = function(p, sid, histId){
  const j = function(v){ if(typeof v === 'string'){ try{ return JSON.parse(v); }catch(_e){ return null; } } return v; };
  let pagos = j(p.pagos); if(!Array.isArray(pagos)) pagos = [];
  const cierre = j(p.cierre), ajuste = j(p.ajuste);
  const total = Number(p.total)||0, pagado = Number(p.pagado)||0, resta = Math.max(0, total - pagado);
  if(!pagos.length && !cierre && !ajuste) return '';
  const fF = (typeof formatFecha === 'function') ? formatFecha : function(x){ return String(x||''); };
  // Qué pago es ESTA fila del historial: mismo monto y a menos de 3 minutos.
  // OJO con el "||": una lista VACÍA es verdadera en JS, así que ganaba la vacía y nunca se usaba
  // el respaldo. Se mira la cantidad, igual que en _parteRetiro.
  const H = (typeof _historialData !== 'undefined' && _historialData && _historialData.length)
    ? _historialData : (window._historialData || []);
  const hRow = histId ? H.find(function(h){ return String(h.id) === String(histId); }) : null;
  const esEste = function(x){
    if(!hRow) return false;
    return Number(x.monto) === Number(hRow.monto) && Math.abs(new Date(x.fecha) - new Date(hRow.created_at)) < 180000;
  };
  let h = '<div style="border-radius:10px;padding:10px 12px;background:rgba(168,85,247,.07);border:1px solid rgba(192,132,252,.35);font-size:12.5px;color:#e6edf3">'
    + '<div style="font-weight:900;color:#c084fc;margin-bottom:5px">💸 Retiro #'+escapeHtml(String(sid))+(pagos.length > 1 || cierre ? ' · pagado por partes' : '')+'</div>';
  if(ajuste && ajuste.declarado != null){
    h += '<div>Pidió <b>'+money(Number(ajuste.declarado)||0)+'</b> → se paga <b style="color:#f5c518">'+money(Number(ajuste.corregido)||total)+'</b></div>';
    if(ajuste.motivo) h += '<div style="color:#fde68a">📝 '+escapeHtml(ajuste.motivo)+'</div>';
  }
  // El "pagado X de Y · falta Z" sale SÓLO si hay pagos anotados. Sin pagos por partes, ese contador
  // está en cero aunque la plata haya salido entera, y decía "falta $67.208" de un retiro ya pagado.
  if(pagos.length){
    h += '<div style="margin-top:4px;color:#8b949e">Pagado <b style="color:#e6edf3">'+money(pagado)+'</b> de <b style="color:#e6edf3">'+money(total)+'</b>'
      + (resta > 0.5 ? (' · falta <b style="color:#f5c518">'+money(resta)+'</b>') : ' · completo')+'</div>';
  }
  // Cada pago con SU movimiento de Chunior y SUS fichas: un retiro en partes tiene un movimiento
  // por pago y la ficha tenía un solo casillero, así que no entraba ninguno (Juan, 13/09).
  const delaSolicitud = H.filter(function(r){
    return String(r.solicitud_id || '') === String(sid) && String(r.tipo || '').toUpperCase() === 'RETIRO'
      && Number(r.monto || 0) > 0 && String(r.estado || '').toUpperCase() !== 'ERROR';
  }).sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });
  const usadas = {};
  const filaDelPago = function(x, i){
    for(let k = 0; k < delaSolicitud.length; k++){
      if(usadas[k]) continue;
      const r = delaSolicitud[k];
      if(Number(r.monto) === Number(x.monto) && Math.abs(new Date(x.fecha) - new Date(r.created_at)) < 180000){ usadas[k] = true; return r; }
    }
    const porOrden = delaSolicitud[i];
    if(porOrden && !usadas[i] && Number(porOrden.monto) === Number(x.monto)){ usadas[i] = true; return porOrden; }
    return null;
  };
  let acum = 0, faltanMovs = 0;
  pagos.forEach(function(x, i){
    const monto = Number(x.monto) || 0;
    const desdePct = total > 0 ? Math.round(acum * 100 / total) : 0;
    acum += monto;
    const hastaPct = total > 0 ? Math.min(100, Math.round(acum * 100 / total)) : 0;
    const fila = filaDelPago(x, i);
    const este = esEste(x);
    const mov = (fila && fila.chunior_movimiento_id) ? String(fila.chunior_movimiento_id) : '';
    if(!mov) faltanMovs++;
    const fichas = (fila && (fila.saldo_pre != null || fila.saldo_post != null))
      ? ('🎰 ' + (fila.saldo_pre != null ? money(fila.saldo_pre) : '—') + ' → ' + (fila.saldo_post != null ? money(fila.saldo_post) : '—'))
      : '';
    const botonMov = mov
      ? '<b class="mono" style="color:#86efac">N° ' + escapeHtml(mov) + '</b>'
        + ' <button type="button" class="mini-btn" style="font-size:10px;padding:2px 6px" onclick="expedienteCopiarTexto(\'' + escapeHtml(mov) + '\')">Copiar</button>'
      : (fila
          ? '<span style="color:#f59e0b">sin N°</span>'
            + ' <button type="button" class="mini-btn yellow" style="font-size:10px;padding:2px 6px" title="Busca en Chunior el movimiento de ESTE pago y lo guarda"'
            + ' onclick="expedienteBuscarMovChunior(\'' + escapeHtml(String(fila.id)) + '\',\'' + escapeHtml(String(fila.usuario || '')) + '\',\'' + monto + '\',\'' + escapeHtml(String(fila.created_at || x.fecha || '')) + '\')">🔎 Buscar en Chunior</button>'
          : '<span style="color:#8b949e">sin operación registrada</span>');
    h += '<div style="margin-top:4px;padding:5px 8px;border-radius:7px;background:' + (este ? 'rgba(245,197,24,.10)' : '#0d1117') + ';border:1px solid ' + (este ? 'rgba(245,197,24,.4)' : '#21262d') + '">'
      + '<div style="display:flex;justify-content:space-between;gap:8px">'
      +   '<span><b style="color:#c084fc">' + desdePct + '–' + hastaPct + '%</b> · <b style="color:#fb923c">' + money(monto) + '</b>'
      +     (x.desde ? (' · desde ' + escapeHtml(x.desde)) : '') + (x.operador ? (' · ' + escapeHtml(x.operador)) : '')
      +     (este ? ' <span style="color:#f5c518;font-size:10.5px">(este)</span>' : '') + '</span>'
      +   '<span style="color:#8b949e;white-space:nowrap">' + escapeHtml(fF(x.fecha)) + '</span>'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;margin-top:2px">'
      +   '<span>' + botonMov + '</span>'
      +   '<span style="color:#8b949e;white-space:nowrap">' + fichas + '</span>'
      + '</div></div>';
  });
  if(faltanMovs) h += '<div style="margin-top:4px;font-size:11.5px;color:#f59e0b">⚠ ' + faltanMovs + ' pago' + (faltanMovs === 1 ? '' : 's') + ' sin N° de Chunior.</div>';
  if(cierre){
    h += '<div style="margin-top:6px;padding:6px 8px;border-radius:7px;background:rgba(124,58,237,.12);border:1px solid #7c3aed55">'
      + '🔒 <b>Cerrado</b>'+(cierre.etiqueta ? (': '+escapeHtml(cierre.etiqueta)) : '')
      + (Number(cierre.faltante) > 0.5 ? (' · quedó sin pagar <b>'+money(Number(cierre.faltante))+'</b>') : '')
      + (cierre.nota ? ('<div style="font-style:italic;color:#c9d1d9;margin-top:2px">"'+escapeHtml(cierre.nota)+'"</div>') : '')
      + '<div style="color:#8b949e;font-size:11px;margin-top:2px">'+escapeHtml([cierre.operador, cierre.fecha ? fF(cierre.fecha) : ''].filter(Boolean).join(' · '))+'</div>'
      + '</div>';
  }
  return h + '</div>';
};
// Cierra un retiro parcial. Antes era un confirm() y listo: la operación quedaba PAGADA con
// plata sin pagar y NADIE sabía por qué. En el caso que disparó esto: 50% pagado, $25.000 sin
// pagar, estado PAGADA, cero explicación ni acá ni en el portal.
// Ahora la nota es obligatoria y viaja al portal, así el cliente deja de ver "faltan $25.000"
// para siempre. La lista de motivos es un punto de partida: son los que aparecen en la
// operación, y quedan para ajustar.
window._MOTIVOS_CIERRE_PARCIAL = [
  { k:'COBRO_TODO',       t:'Ya cobró el total (el último pago no lo marcó)' },
  { k:'SIN_FICHAS',       t:'No tenía las fichas al reintentar' },
  { k:'SE_LO_JUGO',       t:'Se jugó el saldo antes de terminar de cobrar' },
  { k:'CLIENTE_DESISTIO', t:'El cliente no quiso el resto' },
  { k:'MONTO_MAL',        t:'El monto estaba mal cargado' },
  { k:'OTRO',             t:'Otro (explicar abajo)' }
];

// ── Cierre automático: el jugador volvió a cargar con el retiro a medio pagar ────────────────
// Decisión de Juan (26/9): se cierra SOLO, sin confirmar. El caso: Maria6981x se jugó las fichas
// del retiro, volvió a cargar, y el parcial siguió pidiendo una plata que ya no correspondía.
// Esto NO mueve plata: cierra la solicitud y anota por qué. Lo pagado queda pagado.
// El operador se entera igual — el aviso es a propósito bien visible.
window._parcialesCerradosAuto = window._parcialesCerradosAuto || new Set();
window._cerrandoParcialesAuto = false;
window.cerrarParcialesPorCarga = async function(){
  // Al final recarga, y la recarga vuelve a llamar acá. El Set ya corta el reproceso, pero esto
  // lo deja explícito: una sola pasada por vez.
  if(window._cerrandoParcialesAuto) return 0;
  window._cerrandoParcialesAuto = true;
  try{
    if(!window.NodoDomain || !NodoDomain.parciales) return 0;
    const casos = NodoDomain.parciales.aCerrarPorCarga({
      solicitudes: (window.V154P && window.V154P.solicitudes) || [],
      info: window._retiroParcialInfo,
      cerrado: window._retiroCerradoAMano,
      yaVistos: window._parcialesCerradosAuto
    });
    let hechos = 0;
    for(const caso of casos){
      // Se marca ANTES de escribir: si la escritura falla, no se reintenta en cada refresco.
      window._parcialesCerradosAuto.add(caso.id);
      const nota = NodoDomain.parciales.notaCierre(caso, money);
      let rpPrevio = {};
      try{
        let m = (caso.solicitud && (caso.solicitud.METADATA!==undefined ? caso.solicitud.METADATA : caso.solicitud.metadata)) || {};
        if(typeof m === "string"){ try{ m = JSON.parse(m); }catch(_e){ m = {}; } }
        rpPrevio = (m && m.retiro_parcial) || {};
      }catch(_e){}
      const cierre = {
        motivo: caso.motivo, etiqueta: caso.etiqueta, nota: nota,
        operador: "automático", fecha: new Date().toISOString(),
        pagado: caso.pagado, total: caso.total, faltante: caso.restante,
        carga_id: caso.cargaId, carga_monto: caso.cargaMonto
      };
      try{
        await window.actualizarSolicitudPortal(String(caso.id), "PAGADA", {
          etapa: "RETIRO_CIERRE_AUTO",
          // Misma llave que el cierre a mano: definitivo, no lo pisa un pago posterior.
          cierre_manual: { fecha: cierre.fecha, operador: "automático", motivo: caso.motivo, auto: true },
          cierre_motivo: caso.motivo,
          cierre_nota: nota,
          retiro_parcial: Object.assign({}, rpPrevio, { cierre: cierre })
        });
        hechos++;
        try{
          await registrarEnHistorial({
            usuario: String((caso.solicitud && (caso.solicitud.USUARIO || caso.solicitud.USUARIO_JUGADOR)) || ""),
            tipo: "RETIRO", monto: 0, origen: "CIERRE", estado: "OK", solicitud_id: String(caso.id),
            notas: "Cierre automático de retiro parcial · " + caso.etiqueta + " · " + nota
          });
        }catch(_e){}
        // Que NO pase desapercibido: es una solicitud que se cerró sin que nadie la toque.
        try{ toast("💸 Retiro #"+caso.id+" cerrado solo · "+caso.etiqueta+" · quedaron sin pagar "+money(caso.restante), "yellow"); }catch(_e){}
      }catch(e){
        try{ toast("No se pudo cerrar solo el retiro #"+caso.id+": "+(e.message||e), "red"); }catch(_e){}
      }
    }
    // Se repinta con lo que ya está en memoria: recargar acá volvería a entrar por el mismo camino.
    if(hechos){ try{ if(typeof cargarSolicitudesPortal==="function") await cargarSolicitudesPortal(true); }catch(_e){} }
    return hechos;
  }catch(_e){ return 0; }
  finally{ window._cerrandoParcialesAuto = false; }
};
window.cerrarRetiroSaldado = async function(id){
  const s = (window._parcialesEnProceso||[]).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
  const pp = (s && window._retiroParcialInfo) ? window._retiroParcialInfo(s) : null;
  const faltante = pp ? Math.max(0, pp.restante) : 0;
  const quedaPlata = faltante > 0.5;

  const opciones = window._MOTIVOS_CIERRE_PARCIAL
    .filter(function(m){ return quedaPlata ? m.k !== 'COBRO_TODO' : true; })
    .map(function(m){ return '<option value="'+m.k+'">'+escapeHtml(m.t)+'</option>'; }).join('');

  abrirModal('✔ Cerrar el retiro #'+id,
    (pp
      ? '<div style="padding:8px 10px;border-radius:8px;margin-bottom:10px;'
        + (quedaPlata
            ? 'background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.4);color:#fde68a">'
              + '⚠ Cobró <b>'+money(pp.pagado)+'</b> de <b>'+money(pp.total)+'</b>. '
              + 'Queda sin pagar <b>'+money(faltante)+'</b>.'
            : 'background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.4);color:#bbf7d0">'
              + 'Cobró el total: <b>'+money(pp.pagado)+'</b>.')
        + '</div>'
      : '')
    + '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Esto <b>no</b> transfiere ni retira nada: cierra la solicitud. '
    + 'Lo que anotes lo ve el jugador en el portal.</div>'
    + '<label>¿Qué pasó?</label>'
    + '<select id="cierreParcialMotivo">'+opciones+'</select>'
    + '<label style="margin-top:8px">Nota <span class="small" style="color:#8b949e;font-weight:400">· obligatoria</span></label>'
    + '<textarea id="cierreParcialNota" rows="3" placeholder="Qué pasó, en una línea. Lo lee el jugador."'
    + ' style="width:100%;border-radius:10px;padding:10px;background:#0e1525;color:#fff;border:1px solid #2d3342;resize:vertical"></textarea>',
    async function(){
      const motivo = String((document.getElementById('cierreParcialMotivo')||{}).value || '').trim();
      const nota   = String((document.getElementById('cierreParcialNota')||{}).value || '').trim();
      // Sin chance de cerrar sin anotar: es el único registro de por qué quedó a medias.
      if(nota.length < 8){ toast('Escribí qué pasó (al menos una línea). Es lo único que queda registrado.','red'); return; }

      const etiqueta = (window._MOTIVOS_CIERRE_PARCIAL.find(function(m){ return m.k===motivo; })||{}).t || motivo;
      const opNombre = (window.operador && (window.operador.usuario||window.operador.nombre)) || 'panel';

      // p_metadata hace merge SHALLOW: si mandamos retiro_parcial suelto pisamos pagos y pagado.
      // Se arma el objeto completo con lo que ya estaba + el cierre.
      let rpPrevio = {};
      try{
        let m = (s && (s.METADATA!==undefined ? s.METADATA : s.metadata)) || {};
        if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ m = {}; } }
        rpPrevio = (m && m.retiro_parcial) || {};
      }catch(_e){}

      const cierre = {
        motivo: motivo, etiqueta: etiqueta, nota: nota,
        operador: opNombre, fecha: new Date().toISOString(),
        pagado: pp ? pp.pagado : null, total: pp ? pp.total : null, faltante: faltante
      };

      try{
        await window.actualizarSolicitudPortal(String(id), 'PAGADA', {
          etapa:'RETIRO_CIERRE_MANUAL',
          // Llave propia: `etapa` la pisa cada pago parcial y el cierre se perdía. Esto no lo
          // escribe ningún otro camino, así que el cierre a mano queda firme.
          cierre_manual: { fecha: new Date().toISOString(), operador: opNombre, motivo: motivo },
          operador: opNombre,
          cierre_motivo: motivo,
          cierre_nota: nota,
          retiro_parcial: Object.assign({}, rpPrevio, { cierre: cierre })
        });
        try{ cerrarModal(); }catch(_e){}
        toast('✔ Retiro #'+id+' cerrado · '+etiqueta,'green');
        // El motivo también queda del lado nuestro, no sólo en la solicitud del portal.
        try{
          await registrarEnHistorial({
            usuario: String((s && (s.USUARIO||s.USUARIO_JUGADOR)) || ''),
            // origen CIERRE: no es un retiro, es una decisión administrativa. Así la lista de
            // retiros de 24hs puede dejarlo afuera sin adivinar por el monto.
            tipo:'RETIRO', monto: 0, origen:'CIERRE', estado:'OK', solicitud_id:String(id),
            notas:'Cierre de retiro parcial · '+etiqueta+' · '+nota
                  + (quedaPlata ? (' · quedó sin pagar '+money(faltante)) : '')
          });
        }catch(_e){}
        try{ await cargarSolicitudesPortal(true); }catch(_e){}
      }catch(e){ toast('No se pudo cerrar: '+(e.message||e),'red'); }
    }, 'Cerrar retiro');
};
// Copiar CBU/alias al portapapeles (usado por el detalle del árbol).
// Copiar el CBU/alias. El bug que tenía: navigator.clipboard.writeText() falla en Electron sobre
// file:// (no es contexto seguro), el .catch() se comía el error EN SILENCIO, y aun así pintaba
// el ✅ y toasteaba "Copiado". El operador pegaba y no había nada — o peor, quedaba lo anterior
// del portapapeles, que puede ser el alias de OTRO retiro. Ahora: si el modo moderno falla, cae
// al textarea + execCommand, y sólo se canta "copiado" cuando de verdad se copió.
function portalCopiarCbu(btn){
  const val = (btn && btn.getAttribute('data-valor')) || '';
  if(!val){ if(typeof toast==='function') toast('No hay alias/CBU para copiar','red'); return; }
  const ok = function(){
    try{
      const ico = btn.querySelector('.pcopy-ico');
      if(ico){ const prev=ico.textContent; ico.textContent='✅'; setTimeout(function(){ ico.textContent=prev; }, 1200); }
    }catch(_e){}
    if(typeof toast==='function') toast('Copiado: '+val,'green');
  };
  const fallo = function(){
    // El alias va en el aviso: si no se pudo copiar, al menos se puede leer y tipear.
    if(typeof toast==='function') toast('No se pudo copiar — copialo a mano: '+val,'red');
  };
  const porTextarea = function(){
    try{
      const ta=document.createElement('textarea');
      ta.value=val;
      // Fuera de pantalla pero SELECCIONABLE: un textarea display:none no se puede copiar.
      ta.setAttribute('readonly','');
      ta.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select(); ta.setSelectionRange(0, val.length);
      let r=false; try{ r=document.execCommand('copy'); }catch(_e){}
      document.body.removeChild(ta);
      r ? ok() : fallo();
    }catch(_e){ fallo(); }
  };
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(val).then(ok).catch(porTextarea);
    } else porTextarea();
  }catch(_e){ porTextarea(); }
}

// Copiar de verdad, aunque el panel esté operando.
// Dos cosas lo rompían. Una: navigator.clipboard.writeText() EXIGE que la ventana tenga el foco,
// y mientras el panel opera abre y enfoca la ventana del backoffice o la de Chunior
// (main/agent-ipc.js hace show()+focus()), así que el portapapeles rechaza la escritura — de ahí
// que "mientras hace algo no te deja copiar el enlace". La otra: el respaldo del enlace de acceso
// era prompt(), que en Electron NO existe (ya está dicho en conciliacion.js:697): fallaba el
// primero, el segundo no hacía nada, y el operador se quedaba sin el enlace y sin aviso.
// Orden: recuperar el foco → portapapeles → textarea+execCommand → mostrarlo para copiar a mano.
// Nunca prompt(), y nunca cantar "copiado" sin haber copiado.
window.nodoCopiar = async function(texto, opciones){
  const txt = String(texto == null ? '' : texto);
  const etiqueta = (opciones && opciones.etiqueta) || 'Copiado';
  if(!txt){ try{ toast('No hay nada para copiar','yellow'); }catch(_e){} return false; }

  // 1) El foco vuelve al panel. Sin esto el portapapeles rechaza mientras opera el backoffice.
  try{
    if(window.ctrlElectron && window.ctrlElectron.refocus) await window.ctrlElectron.refocus();
  }catch(_e){}

  // 2) Camino moderno.
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(txt);
      try{ toast(etiqueta,'green'); }catch(_e){}
      return true;
    }
  }catch(_e){}

  // 3) Respaldo clásico: fuera de pantalla pero SELECCIONABLE (un display:none no se copia).
  try{
    const ta = document.createElement('textarea');
    ta.value = txt; ta.setAttribute('readonly','');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try{ ta.setSelectionRange(0, txt.length); }catch(_e){}
    let copiado = false; try{ copiado = document.execCommand('copy'); }catch(_e){}
    try{ ta.remove(); }catch(_e){}
    if(copiado){ try{ toast(etiqueta,'green'); }catch(_e){} return true; }
  }catch(_e){}

  // 4) Último recurso: mostrarlo. Poder seleccionarlo a mano es mucho mejor que perderlo.
  try{
    abrirModal('📋 Copialo a mano',
      '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">No se pudo copiar solo — pasa '
      + 'cuando el panel está operando en otra ventana. Seleccionalo y copialo:</div>'
      + '<textarea readonly onclick="this.select()" style="width:100%;min-height:120px;border-radius:10px;'
      + 'padding:10px;background:#0e1525;color:#fff;border:1px solid #2d3342;resize:vertical;'
      + 'font-family:ui-monospace,monospace;font-size:12px">' + escapeHtml(txt) + '</textarea>',
      null, '');
  }catch(_e){
    try{ toast('No se pudo copiar — copialo a mano: '+txt,'red'); }catch(_x){}
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════
