// COLA DE PENDIENTES (portado de NexoBetaChan 1.0.82) — una carga que quedó incierta
// (timeout/error) NO se pierde en un toast: queda en una tarjeta arriba de las solicitudes,
// sobrevive reinicios (localStorage), con Ver saldo / Descartar / Reintentar.
// ══════════════════════════════════════════════════════════════════════════
(function(){
  const COLA_PEND_KEY = 'nodo_cola_pendientes_v1';
  function colaPendientesAll(){ try{ return JSON.parse(localStorage.getItem(COLA_PEND_KEY)||'[]')||[]; }catch(_e){ return []; } }
  function colaPendientesSave(items){ try{ localStorage.setItem(COLA_PEND_KEY, JSON.stringify((items||[]).slice(0,60))); }catch(_e){} }
  window.colaPendientesAdd = function colaPendientesAdd(item){
    try{
      const items = colaPendientesAll();
      item.qid = 'q'+Date.now()+Math.random().toString(16).slice(2,6);
      item.creado = new Date().toISOString(); item.intentos = 0;
      items.unshift(item); colaPendientesSave(items); renderColaPendientes();
      toast('⏳ Quedó en la cola de pendientes: '+money(item.monto)+' a '+item.usuario, 'yellow');
    }catch(e){ console.warn('[cola]', e); }
  };
  function colaPendientesRemove(qid){ colaPendientesSave(colaPendientesAll().filter(function(x){ return x.qid !== qid; })); renderColaPendientes(); }
  function colaPendientesGet(qid){ return colaPendientesAll().find(function(x){ return x.qid === qid; }) || null; }
  function colaPendientesPatch(qid, patch){ const items=colaPendientesAll(); const it=items.find(function(x){ return x.qid===qid; }); if(it){ Object.assign(it, patch); colaPendientesSave(items); } renderColaPendientes(); }
  function colaEnsureBox(){
    let box = document.getElementById('colaPendientesBox'); if(box) return box;
    const anchor = document.getElementById('tablaSolicitudesInicio'); if(!anchor || !anchor.parentElement) return null;
    box = document.createElement('div'); box.id='colaPendientesBox'; box.style.cssText='margin-bottom:10px';
    anchor.parentElement.insertBefore(box, anchor); return box;
  }
  window.renderColaPendientes = function renderColaPendientes(){
    const box = colaEnsureBox(); if(!box) return;
    const items = colaPendientesAll();
    if(!items.length){ box.innerHTML=''; box.style.display='none'; return; }
    box.style.display='block';
    const filas = items.map(function(it){
      const esBono = it.clase === 'BONO';
      const badge = esBono
        ? '<span style="background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.35);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:900">🎁 BONO '+(it.bonoPct||'')+'%</span>'
        : '<span style="background:rgba(245,197,24,.12);color:#f5c518;border:1px solid rgba(245,197,24,.35);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:900">CARGA</span>';
      const aviso = it.posibleAplicada ? '<div style="margin-top:5px;font-size:11px;font-weight:800;color:#fbbf24">⚠ Pudo haberse aplicado (cortó por timeout) — usá "Ver saldo" antes de reintentar</div>' : '';
      const saldoLeido = (it.saldoLeido!==undefined && it.saldoLeido!==null) ? '<div style="margin-top:4px;font-size:11px;color:#7cc4ff">Saldo actual leído: <b>'+esc(String(it.saldoLeido))+'</b> ('+esc(it.saldoLeidoHora||'')+')</div>' : '';
      return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #f5c518;border-radius:10px;padding:10px 12px;margin-top:8px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'
        +   '<div style="display:flex;align-items:center;gap:8px">'+badge+'<b style="font-size:15px;color:#f0f6fc">'+esc(it.usuario||'—')+'</b><b style="font-size:16px;color:#f5c518">'+money(it.monto||0)+'</b></div>'
        +   '<span style="font-size:11px;color:#8b949e">'+fecha(it.creado)+(it.intentos?(' · '+it.intentos+' reintento/s'):'')+'</span>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;margin-top:6px;font-size:12px;color:#c9d1d9">'
        +   (it.titular ? '<div><span style="color:#8b949e">A nombre de:</span> <b>'+esc(it.titular)+'</b></div>' : '')
        +   (esBono && it.baseMonto ? '<div><span style="color:#8b949e">Sobre carga de:</span> '+money(it.baseMonto)+'</div>'
               : (it.declarado ? '<div><span style="color:#8b949e">Declaró:</span> '+money(it.declarado)+'</div>' : ''))
        +   (it.destino ? '<div style="grid-column:1/-1"><span style="color:#8b949e">Destino:</span> '+esc(it.destino)+'</div>' : '')
        +   (it.cbu ? '<div style="grid-column:1/-1"><span style="color:#8b949e">CBU/CVU:</span> '+esc(it.cbu)+'</div>' : '')
        +   (it.obs ? '<div style="grid-column:1/-1"><span style="color:#8b949e">Obs:</span> '+esc(it.obs)+'</div>' : '')
        +   (it.solicitudId ? '<div><span style="color:#8b949e">Solicitud:</span> #'+esc(String(it.solicitudId))+'</div>' : '')
        +   (it.billeteraNombre ? '<div><span style="color:#8b949e">Billetera:</span> '+esc(it.billeteraNombre)+'</div>' : '')
        + '</div>'
        + '<div style="margin-top:5px;font-size:11px;color:#fca5a5">Falló: '+esc(it.motivo||'sin detalle')+'</div>'
        + aviso + saldoLeido
        + '<div style="display:flex;gap:7px;justify-content:flex-end;margin-top:8px">'
        +   '<button class="mini-btn" style="background:transparent;border:1px solid #30363d;color:#c9d1d9;font-size:11px" onclick="verSaldoPendienteCola(\''+it.qid+'\')">👁 Ver saldo</button>'
        +   '<button class="mini-btn" style="background:transparent;border:1px solid #7f1d1d;color:#fca5a5;font-size:11px" onclick="descartarPendienteCola(\''+it.qid+'\', this)">Descartar</button>'
        +   '<button class="mini-btn" style="background:#b45309;color:#fff;font-weight:800;font-size:11px" onclick="reintentarPendienteCola(\''+it.qid+'\')">↻ Reintentar</button>'
        + '</div></div>';
    }).join('');
    box.innerHTML = '<div style="background:#0d1117;border:1px solid rgba(245,197,24,.35);border-radius:12px;padding:11px 13px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center"><b style="color:#f5c518;font-size:13px">⏳ Cargas pendientes de reintento ('+items.length+')</b><span style="font-size:11px;color:#8b949e">quedan guardadas aunque se reinicie el panel</span></div>'
      + filas + '</div>';
  };
  window.descartarPendienteCola = function(qid, btn){
    if(btn && btn.dataset.armado === '1'){ colaPendientesRemove(qid); toast('Pendiente descartado', 'yellow'); return; }
    if(btn){ btn.dataset.armado='1'; btn.textContent='¿Seguro?'; btn.style.background='#7f1d1d'; btn.style.color='#fff';
      setTimeout(function(){ try{ btn.dataset.armado=''; btn.textContent='Descartar'; btn.style.background='transparent'; btn.style.color='#fca5a5'; }catch(_e){} }, 3000); }
  };
  window.verSaldoPendienteCola = async function(qid){
    const it = colaPendientesGet(qid); if(!it) return;
    if(!_drexGlobalLock('cola-saldo')){ toast('Hay otra operación en curso en Agentes. Esperá.', 'yellow'); return; }
    _wdLock();
    try{
      toast('Leyendo saldo de '+it.usuario+'...', 'blue');
      const lectura = await window.leerFichasJugador(it.usuario);
      if(lectura.confiable === true){
        colaPendientesPatch(qid, { saldoLeido: lectura.raw, saldoLeidoHora: new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}) });
        toast('Saldo de '+it.usuario+': '+lectura.raw, 'blue');
      } else { toast(lectura.error, 'red'); }
    }catch(_e){ toast('No se pudo leer el saldo. Probá de nuevo.', 'red'); }
    finally{ _wdUnlock(); _drexGlobalUnlock(); }
  };
  // Reintentar SEGURO (nuestro): en vez de re-ejecutar la carga a ciegas, PRECARGA el formulario
  // de "Operación manual" (usuario + monto) y hace scroll → el operador revisa y toca "Ejecutar"
  // (que ya maneja billetera/Chunior/historial). Evita el riesgo de un auto-reintento money-op.
  window.reintentarPendienteCola = function(qid){
    const it = colaPendientesGet(qid); if(!it) return;
    try{
      const u = document.getElementById('manualUsuario'); if(u) u.value = it.usuario||'';
      const m = document.getElementById('manualMonto');   if(m) m.value = String(it.monto||'');
      if(u){ u.scrollIntoView({behavior:'smooth', block:'center'}); u.focus(); }
      toast('↻ Cargué '+it.usuario+' · '+money(it.monto)+' en la operación manual. Revisá y tocá Ejecutar.', 'blue');
    }catch(e){ toast('No pude precargar: '+(e.message||''), 'red'); }
  };
  setTimeout(function(){ try{ renderColaPendientes(); }catch(_e){} }, 3500); // pendientes de una sesión anterior
})();

// ── Ledger de billeteras: saldo ESPERADO por operaciones vs REAL de Chunior ─────────────
// Cada operación (carga +, retiro/parcial -) que pasa por registrarEnHistorial suma/resta al "ops"
// de su billetera. Al sincronizar con Chunior comparamos esperado(base+ops) vs real → si difieren,
// aviso LEVE (ej: una carga que no se anotó en Chunior) + se re-basa al valor real. Todo LOCAL.
const BIL_LEDGER_KEY = 'nodo_bil_ledger_v1';
const _BIL_DIF_UMBRAL = 1; // pesos
function _bilLedgerAll(){ try{ return JSON.parse(localStorage.getItem(BIL_LEDGER_KEY)||'{}')||{}; }catch(_e){ return {}; } }
function _bilLedgerSave(m){ try{ localStorage.setItem(BIL_LEDGER_KEY, JSON.stringify(m)); }catch(_e){} }
function _bilLedgerAdd(bilId, tipo, monto, estado){
  // ⛔ CONTADOR INTERNO DESACTIVADO: este ledger (base+ops del panel) era el "tercer contador".
  // Solo intervienen CHUNIOR (lo anotado) y el SALDO REAL del banco (lo declarado en el Cotejo).
  // El operador tiene la obligación del 1 a 1 entre lo anotado y la billetera → el cotejo es la
  // herramienta para verificarlo, no un acumulador paralelo que se desincronizaba y avisaba al pedo.
  return;
}
window._bilLedgerAdd = _bilLedgerAdd;
// Compara esperado vs real (llamar DESPUÉS de sincronizar Chunior, con billeteras[].SALDO ya real)
// y avisa las diferencias. Re-basa el ledger al valor real actual. Devuelve la lista de diferencias.
window._chequearDiferenciasBilletera = function(){
  // ⛔ DESACTIVADO junto con el ledger: comparaba el acumulado del panel contra Chunior y tiraba
  // "⚠ dif" en la tarjeta + toast, con falsos constantes. La comparación válida es banco vs Chunior
  // y la hace el módulo de COTEJO (declaración ciega). Se limpia el ledger viejo de localStorage.
  try{ localStorage.removeItem(BIL_LEDGER_KEY); }catch(_e){}
  window.__bilDifs = [];
  return [];
};
// ── Atribución por turno (portado del colega, v1.1.39) ───────────────────────
// Toma el operador REALMENTE logueado en Chunior (#user-tools strong) y actualiza operador.usuario
// antes de cada registro + cada 90s → cubre el cambio de turno sin re-login del panel. NO fabrica
// un operador si no hay (respeta el gating de login/multi-oficina) y NO toca pc/rol/scope (eso lo
// define el login del panel, atado a la PC física). Guard de 20s para no golpear Chunior de más.
let _operadorChuniorTs = 0;
async function refrescarOperadorDesdeChunior(force){
  try{
    if(!force && (Date.now() - _operadorChuniorTs) < 20000) return (typeof operador!=='undefined' && operador && operador.usuario) || null;
    if(!window.chunior || !window.chunior.exec) return (typeof operador!=='undefined' && operador && operador.usuario) || null;
    const u = await window.chunior.exec('(function(){var e=document.querySelector("#user-tools strong");return e?(e.textContent||"").trim():"";})()');
    _operadorChuniorTs = Date.now();
    const nombre = String(u||'').trim();
    // Solo actualizamos el NOMBRE si ya hay un operador logueado (no fabricamos uno).
    if(nombre && typeof operador!=='undefined' && operador && String(operador.usuario||'').toLowerCase() !== nombre.toLowerCase()){
      console.log('[operador] cambió de puesto en Chunior:', operador.usuario, '→', nombre);
      operador.usuario = nombre; operador.nombre = nombre;
    }
    // El espejo va AFUERA del if. Estaba adentro, así que window.operador solo se llenaba
    // cuando el nombre de Chunior difería del del panel — o sea, únicamente en un cambio de
    // turno. En el caso normal los nombres coinciden, el if no entra y window.operador quedaba
    // sin definir toda la sesión.
    try{ if(typeof operador!=='undefined' && operador) window.operador = operador; }catch(_e){}
    return (typeof operador!=='undefined' && operador && operador.usuario) || nombre || null;
  }catch(_e){ return (typeof operador!=='undefined' && operador && operador.usuario) || null; }
}
window.refrescarOperadorDesdeChunior = refrescarOperadorDesdeChunior;
// Refresco periódico: cubre el cambio de turno aunque no se opere (Chunior ya se re-logueó).
try{ setInterval(function(){ refrescarOperadorDesdeChunior(true); }, 90000); }catch(_e){}

async function registrarEnHistorial(op){
  // Antes de estampar, aseguramos que el operador sea el que está en Chunior AHORA (cambio de turno).
  try{ await refrescarOperadorDesdeChunior(); }catch(_e){}
  const {
    usuario, tipo, monto=0, billetera_id=null, billetera_nombre=null,
    origen='MANUAL', estado='OK', notas=null, solicitud_id=null,
    reversion_de=null, chunior_movimiento_id=null,
    saldo_post=null, saldo_pre=null, created_at=null, pc_codigo:pc_override=null
  } = op || {};

  const baseRow = {
    usuario, tipo, monto, billetera_id, billetera_nombre,
    operador: operador?.usuario || operador?.nombre || "",
    origen: window._v154pPortalJobActivo ? "PORTAL" : origen,
    estado,
    notas: window._v154pPortalJobActivo ? ((notas?notas+" · ":"") + "Solicitud portal #" + window._v154pPortalJobActivo) : notas,
    solicitud_id: window._v154pPortalJobActivo || solicitud_id,
    reversion_de,
    chunior_movimiento_id,
    saldo_post,
    saldo_pre,
    pc_codigo: pc_override || pcOperativa
  };
  if(created_at) baseRow.created_at = created_at;

  // Quitar undefined para no ensuciar Supabase.
  Object.keys(baseRow).forEach(k => { if(baseRow[k] === undefined) delete baseRow[k]; });

  // Intento 1: completo, quitando columnas ya detectadas como inexistentes.
  let intento = { ...baseRow };
  window.NodoSalud?.begin('HISTORIAL')?.record('EFFECT','OK','HISTORIAL_REGISTRO');
  _HISTORIAL_COLS_INEXISTENTES.forEach(c => delete intento[c]);

  for(let i = 0; i <= _HISTORIAL_COLS_OPCIONALES.length; i++){
    try{
      const { data, error } = await supabaseClient
        .from("historial_ops")
        .insert(intento)
        .select()
        .single();

      if(!error){ try{ _capturarMovimientoDesdeHistorial(baseRow, data); }catch(_e){} try{ _bilLedgerAdd(baseRow.billetera_id, baseRow.tipo, baseRow.monto, baseRow.estado); }catch(_e){} return data; }

      const msg = (error.message || "") + " " + (error.details || "") + " " + (error.hint || "");
      const colMencionada = _HISTORIAL_COLS_OPCIONALES.find(c => msg.includes(c) && (c in intento));

      if(colMencionada){
        console.warn('historial_ops: columna "'+colMencionada+'" no disponible en schema/cache → reintento sin esa columna');
        _HISTORIAL_COLS_INEXISTENTES.add(colMencionada);
        delete intento[colMencionada];
        continue;
      }

      console.warn("historial_ops insert completo falló:", error);
      break;
    }catch(e){
      console.warn("historial_ops write failed:", e);
      break;
    }
  }

  // Fallback FINAL: fila mínima con columnas históricas.
  // Esto evita que una solicitud portal quede ACREDITADA sin historial_id.
  try{
    const minimo = {
      usuario, tipo, monto,
      origen: window._v154pPortalJobActivo ? "PORTAL" : origen,
      estado,
      operador: operador?.usuario || operador?.nombre || "",
      notas: window._v154pPortalJobActivo ? ((notas?notas+" · ":"") + "Solicitud portal #" + window._v154pPortalJobActivo) : notas,
      pc_codigo: pc_override || pcOperativa,
      billetera_id,
      billetera_nombre,
      solicitud_id: window._v154pPortalJobActivo || solicitud_id,
      saldo_post,
      saldo_pre
    };
    if(created_at) minimo.created_at = created_at;

    const { data, error } = await supabaseClient
      .from("historial_ops")
      .insert(minimo)
      .select()
      .single();

    if(!error) return data;
    console.warn("historial_ops insert mínimo falló:", error);
  }catch(e){
    console.warn("historial_ops fallback mínimo falló:", e);
  }

  return null;
}

// El puesto de Chunior puede resolver distinto entre sesiones (XGENERALENUSO / XGENERAL / GENERAL…)
// y las operaciones quedan guardadas con ese string. Para que el historial sea consistente
// SIEMPRE, leemos por TODOS los alias de la oficina, no por el string exacto de esta sesión.
