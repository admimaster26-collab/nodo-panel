// COTEJO Y AJUSTE ASISTIDO · F1 (núcleo sin UI) — doc de referencia del equipo
// Regla contable única: diferencia = saldo_real_banco − saldo_chunior.
//   >0 sobra → DEPO S/RECLAMAR · <0 falta → ERROR/FALTANTE. Sin tercer contador.
// ══════════════════════════════════════════════════════════════════════════
// Turnos AR fijos: 22-06 / 06-14 / 14-22. El id se ancla al día en que ARRANCA el
// turno (a las 03:00 del viernes seguís en el turno del JUEVES 22-06).
function _cotejoTurnoId(ts){ return NodoDomain.conciliacion.turnoId(ts); }
function _cotejoInicioTurnoMs(ts){ return NodoDomain.conciliacion.inicioTurnoMs(ts); }
// SNAPSHOT: los dos números en el mismo instante lógico. No arranca con operaciones en
// vuelo, sincroniza la verdad desde Chunior y devuelve los saldos congelados + turno.
// Scraper genérico de listas admin de Chunior (#result_list): id, fecha, monto, cuenta, texto.
async function _cotejoScrapeLista(url){
  try{
    await window.chunior.navigate(url);
    const t0=Date.now(); let listo=false;
    while(Date.now()-t0<9000){ listo=await window.chunior.exec('(function(){return !!(document.getElementById("result_list")||document.querySelector(".paginator,#changelist"));})()').catch(function(){return false;}); if(listo)break; await new Promise(function(r){setTimeout(r,300);}); }
    if(!listo) return [];
    // Lee TODAS las celdas con su clase y su texto, y después elige por clase O por patrón de texto
    // (mismo criterio que verDepositosSinReclamar, que sí funciona). Antes se exigía la clase
    // `field-creation` exacta: si esa página la nombraba distinto, la fecha salía null y el filtro
    // por turno descartaba TODAS las filas → el cotejo leía 0 depos y 0 errores.
    const filas = await window.chunior.exec(
      '(function(){var out=[];var trs=document.querySelectorAll("#result_list tbody tr");'+
      'for(var i=0;i<trs.length&&i<80;i++){var tr=trs[i];'+
      ' var a=tr.querySelector("th a[href],td a[href]");var id=null;if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/);if(mh)id=mh[1];}'+
      ' var tds=tr.querySelectorAll("th,td");var cells=[];'+
      ' for(var j=0;j<tds.length;j++){cells.push({c:(tds[j].className||""),t:(tds[j].textContent||"").replace(/\\s+/g," ").trim()});}'+
      ' function pick(clsRe,txtRe){var x=cells.filter(function(y){return clsRe.test(y.c)&&y.t;})[0];'+
      '   if(x)return x.t; if(txtRe){x=cells.filter(function(y){return txtRe.test(y.t);})[0]; if(x)return x.t;} return "";}'+
      ' out.push({id:id,'+
      '   creacion:pick(/creation|fecha|creado|date/i,/\\d{2}[-\\/]\\d{2}[-\\/]\\d{4}/),'+
      '   monto:pick(/monto|money|importe/i,/\\$/),'+
      '   cuenta:pick(/cuenta|destino|billetera|wallet/i,null),'+
      '   texto:(tr.textContent||"").replace(/\\s+/g," ").trim().substring(0,300)});'+
      '}return out;})()'
    ).catch(function(){return [];});
    return Array.isArray(filas)?filas:[];
  }catch(_e){ return []; }
}
window.cotejoSnapshot = async function(){
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0) return { ok:false, error:'operacion-en-curso' };
  try{ await sincronizarBilleterasChunior(true); }catch(_e){ return { ok:false, error:'sync-fallo' }; }
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0) return { ok:false, error:'operacion-en-curso' }; // arrancó algo durante el sync
  const ts = Date.now();
  const iniMs = _cotejoInicioTurnoMs(ts);
  // Billetera ERROR: billetera REAL de Chunior donde se DECLARAN las faltas ("enviar a error" =
  // transferencia contable hacia ella). No tiene banco → NO se declara en la ciega.
  const bilError=(billeteras||[]).find(function(b){ return b.CHUNIOR_UID && /error/i.test(String(b.NOMBRE_VISIBLE||'')); })||null;
  const saldos = (billeteras||[]).filter(function(b){
    return b.CHUNIOR_UID && (!bilError || String(b.ID_BILLETERA)!==String(bilError.ID_BILLETERA));
  }).map(function(b){
    return { wallet_id:String(b.ID_BILLETERA), nombre:String(b.NOMBRE_VISIBLE||''), chunior_uid:String(b.CHUNIOR_UID), saldo_chunior:Number(b.SALDO||0) };
  });
  // Fuentes REALES de Chunior para las guías del cotejo (no solo el historial del panel):
  // depos s/reclamar del TURNO + transferencias a la billetera ERROR del TURNO. Best-effort:
  // si el scraping falla, el cotejo sigue sin guías (no se rompe).
  // Filtra al turno vigente, PERO si ninguna fila trajo fecha parseable no descarta todo en
  // silencio (eso dejaba el cotejo sin guías y parecía que "no revisa nada"): en ese caso las deja
  // pasar y avisa por consola, para que el operador vea las coincidencias igual.
  const _filtrarTurno = function(arr, etiqueta){
    const conFecha = arr.filter(function(x){ return x.ts !== null; });
    if(!arr.length) return [];
    if(!conFecha.length){
      console.warn('[cotejo] '+etiqueta+': '+arr.length+' fila(s) SIN fecha parseable → no se filtra por turno (revisá el formato de la lista en Chunior)');
      return arr.filter(function(x){ return x.monto>0; });
    }
    return conFecha.filter(function(x){ return x.monto>0 && x.ts>=iniMs; });
  };
  let depos=[], errores=[];
  try{
    depos = _filtrarTurno((await _cotejoScrapeLista(CHUNIOR_BASE+'/transacciones/depositossinreclamar/')).map(function(f){
      const t=_chuParsearFechaCreacion(f.creacion);
      return { id:f.id, ts:t, monto:Math.round(_adminChuParseMonto(f.monto||f.texto)||0), cuenta:f.cuenta||'', texto:f.texto };
    }), 'depos s/reclamar');
  }catch(_e){}
  try{
    if(bilError){
      const nomErr=String(bilError.NOMBRE_VISIBLE||'').toLowerCase();
      errores = _filtrarTurno((await _cotejoScrapeLista(CHUNIOR_BASE+'/transacciones/movimientointerno/')).map(function(f){
        const t=_chuParsearFechaCreacion(f.creacion);
        return { id:f.id, ts:t, monto:Math.round(_adminChuParseMonto(f.monto||f.texto)||0), texto:f.texto };
      }), 'movimientos a ERROR').filter(function(m){ return m.texto.toLowerCase().indexOf(nomErr)>=0; });
    }
  }catch(_e){}
  return { ok:true, snapshot_id:'snap_'+ts+'_'+Math.random().toString(36).slice(2,7), turno_id:_cotejoTurnoId(ts), inicio_turno_ms:iniMs, ts:ts, saldos:saldos,
           extra:{ depos:depos, errores:errores, errorWallet: bilError?{ wallet_id:String(bilError.ID_BILLETERA), uid:String(bilError.CHUNIOR_UID), nombre:String(bilError.NOMBRE_VISIBLE||'ERROR'), saldo:Number(bilError.SALDO||0) }:null } };
};
// MOTOR DE COINCIDENCIAS (función PURA, testeable):
//   casos: [{case_id, wallet_id, tipo:'FALTANTE'|'SOBRANTE', monto_disponible}]
//   movs:  [{id, tipo:'RETIRO'|'DEPOSITO_SR'|..., billetera_id, monto, usuario, esTransferenciaInterna, ts}]
// Reglas: candidatos = SOLO retiros del turno (decisión de equipo); transferencias internas
// EXCLUIDAS (ya resuelven su propia diferencia); depo s/r CON usuario pegado NO se ofrece.
// Exacto 1:1 = un clic (mover retiro). Combinaciones: se sugieren, NUNCA se auto-eligen.
// Ambiguo (2+ candidatos): se muestran todos y decide el operador.
function _cotejoMatch(casos, movs){ return NodoDomain.conciliacion.match(casos, movs); }
window._cotejoMatch = _cotejoMatch; window._cotejoTurnoId = _cotejoTurnoId;

// ── COTEJO · F2: persistencia (Supabase con fallback local) + UI ─────────────
// Los casos van a Supabase (SQL_cotejo_casos.sql: cases/allocations/log inmutable). Si el SQL
// todavía no está aplicado, la UI funciona igual con localStorage por turno (flag _local:true)
// y avisa en consola — no se bloquea el cotejo por infraestructura.
// Formateador de miles GLOBAL. OJO: _rv2FmtMiles vive dentro del IIFE del bridge V15.4 (no es
// global) → usarlo desde este script o desde un oninline handler tira ReferenceError y el campo
// "no deja escribir". Este helper es global y self-contained.
window._cotejoFmtMiles = function(n){ return NodoDomain.formatos.cotejoFmtMiles(n); };
window._fmtMilesConSigno = function(v){ return NodoDomain.formatos.fmtMilesConSigno(v); };
window._parseMontoConSigno = function(v){ return NodoDomain.formatos.parseMontoConSigno(v); };
function _cotejoLsKey(turno){ return 'nodo_cotejo_'+turno; }
function _cotejoLsLoad(turno){ try{ return JSON.parse(localStorage.getItem(_cotejoLsKey(turno))||'{"casos":[],"seq":0}'); }catch(_e){ return {casos:[],seq:0}; } }
function _cotejoLsSave(turno, st){ try{ localStorage.setItem(_cotejoLsKey(turno), JSON.stringify(st)); }catch(_e){} }
function _cotejoOp(){ return (window.operador&&(window.operador.usuario||window.operador.nombre))||'panel'; }
async function _cotejoRpc(fn, params){
  const health = window.NodoSalud?.begin('CONCILIACION');
  try{
    const r = await supabaseClient.rpc(fn, Object.assign({p_secret:window.PANEL_DATA_SECRET}, params||{}));
    health?.reply(r.error);
    if(r.error) throw r.error;
    let d=r.data; try{ if(typeof d==='string') d=JSON.parse(d); }catch(_e){}
    health?.record('DATA', 'OK', 'COTEJO_RPC_OK');
    return d;
  }catch(e){ health?.record('DATA', 'ERROR', 'COTEJO_RPC_FAILED'); console.warn('[cotejo] RPC '+fn+' falló (¿SQL_cotejo_casos.sql aplicado?):', e&&e.message); return null; }
}
// Editar el MONTO de un movimiento admin de Chunior (reduce un depo s/reclamar al asignar una parte
// — opción A confirmada) + agrega la nota del caso. Misma mecánica que _anularMovimientoChunior.
window._reducirDepoChunior = async function(movId, nuevoMonto, notaExtra){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const url = CHUNIOR_BASE + '/transacciones/depositossinreclamar/' + encodeURIComponent(movId) + '/change/';
  try{ await window.chunior.navigate(url); }catch(e){ return { ok:false, error:'No se pudo navegar' }; }
  const t0=Date.now(); let ready=false;
  while(Date.now()-t0<10000){ ready = await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;}); if(ready) break; await new Promise(function(r){setTimeout(r,300);}); }
  if(!ready) return { ok:false, error:'Formulario no apareció' };
  const inj = await window.chunior.exec(
    '(function(){var m=document.getElementById("id_monto");'+
    'var n=document.getElementById("id_notas")||document.getElementById("id_nota")||document.querySelector("textarea");'+
    'var b=document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");'+
    'if(!m||!b)return {ok:false};'+
    'm.value='+JSON.stringify(String(nuevoMonto))+'; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));'+
    'if(n){ n.value=(n.value?n.value+" · ":"")+'+JSON.stringify(String(notaExtra||''))+'; n.dispatchEvent(new Event("input",{bubbles:true})); }'+
    'b.click(); return {ok:true};})()'
  ).catch(function(){ return {ok:false}; });
  if(!inj||!inj.ok) return { ok:false, error:'Inyección falló' };
  await new Promise(function(r){setTimeout(r,2200);});
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  return { ok:true };
};
// Movimientos del turno (para el motor): desde _historialData.
function _cotejoMovsTurno(inicioMs){
  const estados=typeof _NEXO_OK_ESTADOS!=='undefined'?_NEXO_OK_ESTADOS:undefined;
  const historial=(typeof _historialData!=='undefined'&&_historialData)||[];
  return NodoDomain.conciliacion.movimientosTurno(historial, inicioMs, estados);
}
function _cotejoUiModal(){
  let el=document.getElementById('cotejoModal');
  if(el) return el;
  el=document.createElement('div'); el.id='cotejoModal';
  el.style.cssText='display:none;position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:99999;width:min(600px,calc(100vw - 24px))';
  document.body.appendChild(el); return el;
}
window.cerrarCotejo=function(){ const el=document.getElementById('cotejoModal'); if(el) el.style.display='none'; window._cotejoDeclarando=false; };
function _cotejoWrap(inner){
  return '<div style="max-height:84vh;overflow:auto;background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.55);padding:16px;color:#e6edf3">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">'
    +   '<div style="font-size:16px;font-weight:900;color:#7dd3fc">⚖️ Cotejo de billeteras <span class="small" style="color:#8b949e;font-weight:400">· '+escapeHtml(window._cotejoState&&window._cotejoState.turno_id||'')+'</span></div>'
    +   '<button class="mini-btn" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9" onclick="cerrarCotejo()">Cerrar</button>'
    + '</div>' + inner + '</div>';
}
window._cotejoState=null;
window.abrirCotejo=async function(){
  const el=_cotejoUiModal();
  el.innerHTML=_cotejoWrap('<div class="small" style="color:#8b949e;padding:18px;text-align:center">⏳ Congelando saldos (snapshot desde Chunior)...</div>');
  el.style.display='block';
  const snap=await window.cotejoSnapshot();
  if(!snap||!snap.ok){
    el.innerHTML=_cotejoWrap('<div class="alert-box">'+(snap&&snap.error==='operacion-en-curso'?'Hay una operación en curso — esperá a que termine y reintentá.':'No se pudieron leer los saldos de Chunior.')+'</div>');
    return;
  }
  const _lsIni=_cotejoLsLoad(snap.turno_id);
  window._cotejoState={ snap:snap, turno_id:snap.turno_id, casos:_lsIni.casos, resumen:_lsIni.resumen||null, match:null };
  if(window._cotejoState.casos.length){ _cotejoRenderCasos(); return; }  // ya hay casos del turno → directo a la pantalla
  _cotejoRenderDeclarar();
};
function _cotejoRenderDeclarar(){
  const st=window._cotejoState, el=_cotejoUiModal();
  window._cotejoDeclarando=true;   // congela anotaciones nuevas hasta confirmar/cerrar (esperan, no fallan)
  const filas=st.snap.saldos.map(function(s,i){
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:#12161d;border:1px solid #262d3a;margin-top:4px">'
      + '<div style="flex:1;font-weight:700;font-size:13px">'+escapeHtml(s.nombre||('#'+s.wallet_id))+'</div>'
      + '<input type="text" inputmode="numeric" id="cotejoDecl_'+i+'" placeholder="lo que VES en el banco" autocomplete="off" oninput="this.value=window._cotejoFmtMiles(this.value)" style="width:170px;text-align:right;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:5px 7px;font-weight:700;font-size:13px">'
      + '</div>';
  }).join('');
  el.innerHTML=_cotejoWrap(
    '<div class="small" style="background:rgba(125,211,252,.07);border:1px solid rgba(125,211,252,.3);border-radius:9px;padding:8px 11px;margin-bottom:8px;color:#c9d1d9">'
    + '🙈 <b>Declaración ciega</b>: ingresá el saldo que VES en cada billetera (banco/MP). No se muestra lo esperado — las diferencias aparecen recién al confirmar. Dejá vacía la que no quieras cotejar.</div>'
    + filas
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">'
    +   '<button class="mini-btn" style="background:transparent;border:1px solid #30363d;color:#c9d1d9" onclick="cerrarCotejo()">Cancelar</button>'
    +   '<button class="mini-btn blue" style="font-weight:800" onclick="_cotejoConfirmarDecl()">Confirmar declaración</button>'
    + '</div>');
  // El snapshot navega la ventana de CHUNIOR → se lleva el foco del teclado y el panel queda "sin
  // poder escribir" (bug conocido de Electron). Recuperamos el foco y enfocamos el primer campo.
  try{ if(window.ctrlElectron && window.ctrlElectron.refocus) window.ctrlElectron.refocus(); }catch(_e){}
  setTimeout(function(){ try{ window.focus(); const p=document.getElementById('cotejoDecl_0'); if(p) p.focus(); }catch(_e){} }, 120);
}
window._cotejoConfirmarDecl=async function(){
  const st=window._cotejoState; if(!st) return;
  window._cotejoDeclarando=false;   // liberar las anotaciones que quedaron esperando
  const nuevos=[]; const resumen=[];
  st.snap.saldos.forEach(function(s,i){
    const inp=document.getElementById('cotejoDecl_'+i); if(!inp||!String(inp.value).trim()) return;
    const fila=NodoDomain.conciliacion.declaracion(s, inp.value);
    const {decl, dif, resid}=fila;
    // Regla única: real − chunior. REDONDEADO a pesos: los centavos de Chunior (anotamos redondo,
    // las transferencias traen centavos) son residuo, NO caso — antes creaban "Falta $0".
    // Residuo de centavos (doc §9): la parte fraccional NO genera caso; se guarda por billetera
    // para que el supervisor la limpie cuando quiera.
    resumen.push(fila);  // TODAS (tabla estilo cage-report)
    if(resid){ try{ const rr=JSON.parse(localStorage.getItem('nodo_cotejo_residuos')||'{}'); rr[s.wallet_id]={nombre:s.nombre,resid:resid,ts:Date.now()}; localStorage.setItem('nodo_cotejo_residuos',JSON.stringify(rr)); }catch(_e){} }
    if(dif===0) return;
    nuevos.push({ wallet_id:s.wallet_id, wallet_nombre:s.nombre, tipo:(dif<0?'FALTANTE':'SOBRANTE'),
      monto:Math.abs(dif), snapshot_id:st.snap.snapshot_id, observaciones:'declarado '+decl+' · chunior '+s.saldo_chunior });
  });
  // Una nueva declaración REEMPLAZA la foto anterior: los casos aún ABIERTOS de las billeteras
  // re-declaradas se anulan (con log) — sin esto se duplicaban en cada declaración (L2 y L6 iguales).
  const _wids=new Set(resumen.map(function(r){ return String(r.wallet_id); }));
  for(const c of (st.casos||[])){
    if(!['RESUELTA','ANULADA','ESCALADA'].includes(c.estado) && _wids.has(String(c.wallet_id))){
      await _cotejoSetEstado(c.case_id,'ANULADA','reemplazado por nueva declaración');
    }
  }
  if(!nuevos.length){
    const lsOk=_cotejoLsLoad(st.turno_id); lsOk.resumen={ts:Date.now(), filas:resumen}; _cotejoLsSave(st.turno_id, lsOk);
    st.resumen=lsOk.resumen; toast('✓ Sin diferencias en lo declarado','green'); _cotejoRenderCasos(); return;
  }
  // Persistir: Supabase (batch, 1 llamado) con fallback local
  let ids=null;
  const r=await _cotejoRpc('panel_cotejo_crear_casos',{ p_pc_codigo:(pcOperativa||''), p_turno_id:st.turno_id, p_operador:_cotejoOp(), p_casos:nuevos });
  if(r&&r.ok&&r.case_ids) ids=r.case_ids;
  const ls=_cotejoLsLoad(st.turno_id);
  nuevos.forEach(function(c,i){
    ls.seq++; c.case_id = ids?ids[i]:('L'+ls.seq); c._local=!ids; c.estado='ABIERTA';
    c.monto_original=c.monto; c.monto_disponible=c.monto; c.created_at=new Date().toISOString(); c.operador=_cotejoOp();
    ls.casos.push(c);
  });
  ls.resumen={ts:Date.now(), filas:resumen};
  _cotejoLsSave(st.turno_id, ls); st.casos=ls.casos; st.resumen=ls.resumen;
  _cotejoRenderCasos();
};
// El badge mostraba el enum crudo de la base (SUGERENCIA_ENCONTRADA, APLICACION_PARCIAL, ESCALADA…).
// El operador no tiene por qué saber qué significan — "no sé qué es escalada" fue textual.
const _COTEJO_ESTADOS={
  ABIERTA:               {t:'Sin resolver',        c:'#f5c518'},
  SUGERENCIA_ENCONTRADA: {t:'Con pista',           c:'#7dd3fc'},
  PARCIAL_ASIGNADA:      {t:'Compensada en parte', c:'#c1b3ff'},
  AJUSTANDO:             {t:'Ajustando',           c:'#7dd3fc'},
  APLICACION_PARCIAL:    {t:'Aplicada a medias',   c:'#fb923c'},
  RESUELTA:              {t:'Resuelta',            c:'#22c55e'},
  ESCALADA:              {t:'Pasada al superior',  c:'#a78bfa'},
  ANULADA:               {t:'Anulada',             c:'#6b7688'}
};
function _cotejoEstadoBadge(e){
  const m=_COTEJO_ESTADOS[e]||{t:String(e||''),c:'#8b949e'};
  return '<span title="'+escapeHtml(String(e||''))+'" style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.06);color:'+m.c+'">'+escapeHtml(m.t)+'</span>';
}
// Tonos de las tiras de pista, por tipo de acción.
const _COTEJO_TONO={
  verde:  {bg:'#122015', bd:'rgba(34,197,94,.32)'},
  violeta:{bg:'#1b1430', bd:'rgba(167,139,250,.30)'},
  rojo:   {bg:'#2a1215', bd:'rgba(248,113,113,.35)'},
  neutro: {bg:'#151a22', bd:'#262d3a'}
};
function _cotejoRenderCasos(){
  const st=window._cotejoState, el=_cotejoUiModal();
  const abiertos=st.casos.filter(function(c){ return !['RESUELTA','ANULADA','ESCALADA'].includes(c.estado); });
  const movimientos=_cotejoMovsTurno(st.snap.inicio_turno_ms);
  const movimientosPorBilletera=NodoDomain.conciliacion.indexarMovimientos(movimientos);
  st.match=_cotejoMatch(abiertos.map(function(c){ return {case_id:c.case_id,wallet_id:c.wallet_id,tipo:c.tipo,monto_disponible:c.monto_disponible}; }), movimientos);
  const sugPorCaso={};
  (st.match.sugerencias||[]).forEach(function(s){ sugPorCaso[s.caso_faltante]=s; });
  (st.match.explicaciones||[]).forEach(function(s){ sugPorCaso[s.caso]=s; });
  const comboPorCaso={};
  (st.match.combinaciones||[]).forEach(function(k){ if(!comboPorCaso[k.caso]) comboPorCaso[k.caso]=k; });
  // Anti-ruido visual: SOLO los casos abiertos llevan tarjeta completa (guías + acciones).
  // Los finalizados (RESUELTA/ANULADA/ESCALADA) van compactos y colapsados abajo.
  const _FIN=['RESUELTA','ANULADA','ESCALADA'];
  const _activos=st.casos.filter(function(c){ return !_FIN.includes(c.estado); });
  const _cerrados=st.casos.filter(function(c){ return _FIN.includes(c.estado); });
  // Qué sobrantes ya están ofrecidos como solución de algún faltante (las sugerencias siempre
  // cuelgan del faltante, así que sin este mapa el sobrante queda "huérfano" en pantalla).
  const contraparte={};
  _activos.forEach(function(c){
    if(c.tipo!=='FALTANTE') return;
    const s=sugPorCaso[c.case_id], k=comboPorCaso[c.case_id];
    if(s && s.caso_sobrante){ contraparte[String(s.caso_sobrante)]=c.wallet_nombre||''; return; }
    if(k){ (k.partes||[]).forEach(function(p){ contraparte[String(p)]=c.wallet_nombre||''; }); return; }
    _activos.forEach(function(s2){                       // los que ofrece la compensación parcial
      if(s2.tipo==='SOBRANTE' && String(s2.wallet_id)!==String(c.wallet_id) && Number(s2.monto_disponible)>0)
        contraparte[String(s2.case_id)]=c.wallet_nombre||'';
    });
  });
  const filas=_activos.map(function(c){
    const col=c.tipo==='FALTANTE'?'#f87171':'#f5c518';
    const cid=escapeHtml(String(c.case_id));
    const _m=Math.round(Number(c.monto_disponible));
    const _ex=(st.snap&&st.snap.extra)||{};
    // ── Las pistas son OPCIONES con peso, no tiras apiladas ────────────────────────────────
    // Antes se dibujaban hasta 8 tiras del mismo tamaño, todas con botón verde, y el operador no
    // tenía cómo saber cuál era LA correcta. Ahora se ordenan por qué tan segura es la explicación
    // y solo la mejor queda a la vista; el resto se despliega si la primera no convence.
    const ops=[];
    const op=function(peso, tono, texto, boton, rot){ ops.push({peso:peso, tono:tono, texto:texto, boton:boton||'', rot:rot||''}); };

    const sug=sugPorCaso[c.case_id];
    if(sug){
      if(sug.tipo==='MOVER_RETIRO' && sug.candidatos.length){
        // Un retiro concreto que explica el descuadre: la explicación más fuerte que hay.
        const exacta=sug.confianza==='EXACTA';
        const lista=sug.candidatos.map(function(cd){
          return '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">'
            + '<span style="flex:1">⬇ Retiro de <b>'+escapeHtml(cd.usuario)+'</b> · '+money(cd.monto)+' anotado en '+escapeHtml(cd.billetera_nombre||'')+(cd.chunior_movimiento_id?' · N° '+escapeHtml(String(cd.chunior_movimiento_id)):'')+'</span>'
            + '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoAplicarMoverRetiro(\''+cid+'\',\''+escapeHtml(String(sug.caso_sobrante))+'\',\''+escapeHtml(String(cd.id))+'\')">Mover acá</button></div>';
        }).join('');
        op(exacta?10:40, 'verde',
          (exacta ? 'Este retiro quedó anotado en la billetera equivocada.'
                  : 'Hay '+sug.candidatos.length+' retiros que podrían explicarlo — elegí cuál.') + lista);
      } else if(sug.tipo==='MOVER_RETIRO' && !sug.candidatos.length){
        // Par 1:1 detectado pero SIN retiro que lo explique → autoajuste genérico: transferencia
        // CONTABLE en Chunior (movimientointerno) de la billetera faltante → sobrante. No mueve
        // plata real: alinea lo anotado con lo que hay (falta en A = chunior alto; sobra en B = bajo).
        const sc=_cotejoCaso(sug.caso_sobrante)||{};
        op(50, 'verde', 'Sobra exactamente lo mismo en <b>'+escapeHtml(sc.wallet_nombre||'')+'</b>, sin ningún retiro que lo explique.',
          '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoCompensar(\''+cid+'\',\''+escapeHtml(String(sug.caso_sobrante))+'\')">⇄ Compensar (transferencia en Chunior)</button>');
      } else if(sug.tipo==='DEPO_EXISTENTE'){
        op(35, 'violeta', 'Concuerda con un depo s/reclamar SIN usuario que <b>ya está anotado</b> — revisalo antes de crear otro.');
      }
    }
    // GUÍAS desde las fuentes REALES de Chunior (leídas en el snapshot): depos s/reclamar del
    // turno y envíos a la billetera ERROR del turno.
    (_ex.depos||[]).filter(function(d){ return d.monto===_m; }).slice(0,2).forEach(function(d){
      op(30, 'violeta',
        'Hay un depo s/reclamar de <b>'+money(d.monto)+'</b> de este turno'+(d.id?' (N° '+escapeHtml(d.id)+')':'')+(d.cuenta?' en '+escapeHtml(d.cuenta):'')
        + (c.tipo==='FALTANTE'?' por el mismo monto — ¿es esa carga?':' por el mismo monto.'),
        d.id?('<button class="mini-btn green" style="font-size:11px" onclick="reclamarDepo(\''+escapeHtml(d.id)+'\',\''+escapeHtml(String(d.monto))+'\',\''+escapeHtml(d.cuenta||'')+'\')">✅ Reclamarlo</button>'):'');
    });
    (_ex.errores||[]).filter(function(e){ return e.monto===_m; }).slice(0,2).forEach(function(e){
      if(c.tipo==='FALTANTE'){
        op(20, 'rojo', 'Mandaste <b>'+money(e.monto)+'</b> a ERROR este turno'+(e.id?' (N° '+escapeHtml(e.id)+')':'')+'. Si esta falta ES ese error, <b>no la reclames</b>: ya está declarada.',
          '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoCerrarPorError(\''+cid+'\',\''+escapeHtml(String(e.id||''))+'\')">Cerrar: error ya declarado</button>');
      } else {
        op(20, 'verde', 'Mandaste <b>'+money(e.monto)+'</b> a ERROR este turno'+(e.id?' (N° '+escapeHtml(e.id)+')':'')+' y ahora sobra acá — la plata reapareció.',
          '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoRecuperarDeError(\''+cid+'\',\''+escapeHtml(String(e.id||''))+'\')">⇄ Recuperar de ERROR</button>');
      }
    });
    // SOBRANTE sin movimiento a ERROR que matchee EXACTO (ej: mandaste 40k juntos y sobran 20k,
    // o el scraping no leyó la lista): si la billetera ERROR tiene saldo suficiente, ofrecemos
    // recuperar IGUAL por el monto del caso — no depende del matching fino.
    const _errW=_ex.errorWallet;
    if(_errW && Number(_errW.saldo||0)>=_m && !(_ex.errores||[]).some(function(e){ return e.monto===_m; })){
      if(c.tipo==='SOBRANTE'){
        op(80, 'verde', '<b>'+escapeHtml(_errW.nombre)+'</b> tiene '+money(_errW.saldo)+' declarados. Si esto es plata que reapareció de un error, recuperá '+money(_m)+' de ahí.',
          '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoRecuperarDeError(\''+cid+'\',\'\')">⇄ Recuperar de ERROR</button>');
      } else {
        op(80, 'rojo', '<b>'+escapeHtml(_errW.nombre)+'</b> ya tiene '+money(_errW.saldo)+' declarados. Si esta falta ya está incluida ahí, cerrala; si es nueva, usá "Enviar a ERROR".',
          '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoCerrarPorError(\''+cid+'\',\'\')">Cerrar: ya declarado</button>');
      }
    }
    // COMPENSACIÓN PARCIAL (montos DISTINTOS): falta 70.800 acá y sobran 90.800 allá → se
    // transfiere el MÍNIMO común y el resto queda como caso vivo (PARCIAL_ASIGNADA). Es el caso
    // que el 1:1 exacto no cubría. Se sugiere, el operador confirma.
    if(c.tipo==='FALTANTE' && !sug && !comboPorCaso[c.case_id]){
      _activos.filter(function(s2){ return s2.tipo==='SOBRANTE' && String(s2.wallet_id)!==String(c.wallet_id) && Number(s2.monto_disponible)>0; })
        .slice(0,3).forEach(function(s2){
          const mm=Math.min(Number(c.monto_disponible), Number(s2.monto_disponible));
          if(!(mm>0)) return;
          const restoF=Number(c.monto_disponible)-mm, restoS=Number(s2.monto_disponible)-mm;
          op(70, 'neutro',
            'Sobran <b>'+money(s2.monto_disponible)+'</b> en <b>'+escapeHtml(s2.wallet_nombre||'')+'</b> — se puede compensar '+money(mm)+'.'
            + (restoS>0?(' Quedarían '+money(restoS)+' sobrando allá.'):'')
            + (restoF>0?(' Quedarían '+money(restoF)+' faltando acá.'):''),
            '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoCompensarParcial(\''+cid+'\',\''+escapeHtml(String(s2.case_id))+'\')">⇄ Compensar '+money(mm)+'</button>');
        });
    }
    // COMBINACIÓN (10+5=15): el motor la sugiere pero NUNCA la auto-elige — el operador confirma.
    const combo=(!sug)?comboPorCaso[c.case_id]:null;
    if(combo){
      const partesTxt=combo.partes.map(function(pid){ const p=_cotejoCaso(pid)||{}; return escapeHtml(p.wallet_nombre||'')+' ('+money(p.monto_disponible||0)+')'; }).join(' + ');
      op(60, 'neutro', 'Se cubre juntando varias: '+partesTxt+'.',
        '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoCompensarCombo(\''+cid+'\',\''+combo.partes.map(String).join(',')+'\')">⇄ Compensar combinación</button>');
    }

    // La tarjeta del SOBRANTE decía "sin pistas" aunque el faltante de al lado ya ofreciera
    // compensarlo con él: las sugerencias cuelgan siempre del faltante. Lo decimos explícito para
    // que el operador no lo lea como "acá no hay nada que hacer".
    if(c.tipo==='SOBRANTE' && !ops.length && contraparte[String(c.case_id)]){
      op(90, 'neutro', 'Es la contraparte de lo que falta en <b>'+escapeHtml(contraparte[String(c.case_id)])+'</b> — se resuelve desde esa tarjeta.', '', 'Dónde se resuelve');
    }

    // ── Render: la mejor pista arriba, el resto plegado ────────────────────────────────────
    ops.sort(function(a,b){ return a.peso-b.peso; });
    const tira=function(o, destacada){
      const t=_COTEJO_TONO[o.tono]||_COTEJO_TONO.neutro;
      return '<div class="small" style="margin-top:'+(destacada?'6':'4')+'px;border:1px solid '+t.bd+';background:'+t.bg+';border-radius:8px;padding:'+(destacada?'7px 9px':'6px 9px')+';color:#c9d1d9;line-height:1.35">'
        + (destacada?'<div style="font-size:9px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#8b949e;margin-bottom:3px">'+(o.rot||'Lo más probable')+'</div>':'')
        + o.texto + (o.boton?('<div style="margin-top:5px">'+o.boton+'</div>'):'')
        + '</div>';
    };
    let pistas='';
    if(!ops.length){
      pistas='<div class="small" style="margin-top:6px;color:#6b7688">Sin pistas automáticas — mirá los movimientos del turno para ubicar el descuadre.</div>';
    } else {
      pistas=tira(ops[0], true);
      if(ops.length>1){
        pistas+='<div class="small" style="margin-top:4px"><a href="javascript:void 0" style="color:#8b949e" onclick="var d=document.getElementById(\'cotejoOps_'+cid+'\');if(d)d.style.display=d.style.display===\'none\'?\'block\':\'none\'">▸ otras '+(ops.length-1)+' posibilidad'+(ops.length>2?'es':'')+'</a></div>'
          + '<div id="cotejoOps_'+cid+'" style="display:none">'+ops.slice(1).map(function(o){ return tira(o,false); }).join('')+'</div>';
      }
    }

    // Acciones manuales: son la salida cuando ninguna pista sirve, así que van al final y en chico.
    let acciones='<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">';
    const _usrPre=(window.__nodoChatCurrentTicket&&window.__nodoChatCurrentTicket.usuario)||'';   // consulta del portal abierta
    if(c.tipo==='SOBRANTE') acciones+='<input type="text" id="cotejoDepoUsr_'+cid+'" value="'+escapeHtml(_usrPre)+'" placeholder="usuario (opcional)" style="width:125px;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:4px 7px;font-size:11px;margin:0">'
      + '<button class="mini-btn purple" style="font-size:11px" onclick="_cotejoCrearDepo(\''+cid+'\')">＋ Anotar depo s/reclamar</button>';
    if(c.tipo==='FALTANTE' && _ex.errorWallet)
      acciones+='<button class="mini-btn red" style="font-size:11px" onclick="_cotejoEnviarAError(\''+cid+'\')" title="Declara la falta: transferencia contable de esta billetera a la billetera ERROR de Chunior (como lo hacés a mano)">🚫 Enviar a ERROR</button>';
    acciones+='<span style="margin-left:auto;display:flex;gap:6px">'
      + '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoIgnorar(\''+cid+'\')">Ignorar</button>'
      + '<button class="mini-btn" style="font-size:11px;background:#3b2a63;color:#d6c9ff" onclick="_cotejoEscalarCaso(\''+cid+'\')" title="Queda marcado para que lo revise el superior del turno siguiente">⏫ Pasar al superior</button>'
      + '</span></div>';

    return '<div style="border:1px solid #262d3a;border-left:3px solid '+col+';border-radius:9px;padding:9px 11px;margin-top:7px;background:#10141b">'
      + '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">'
      +   '<b style="color:'+col+';font-size:14px">'+(c.tipo==='FALTANTE'?'▼ Falta':'▲ Sobra')+' '+money(c.monto_disponible)+'</b>'
      +   '<span class="small" style="color:#8b949e">en <b style="color:#c9d1d9">'+escapeHtml(c.wallet_nombre||c.wallet_id)+'</b></span>'
      +   (c.estado!=='ABIERTA'?_cotejoEstadoBadge(c.estado):'')
      +   '<span class="small" style="margin-left:auto;color:#4d5766;font-size:10px">#'+cid+(c._local?' <span title="Aún no está el SQL en Supabase — caso local">📌</span>':'')+'</span>'
      + '</div>'
      + (c.observaciones?'<div class="small" style="color:#6b7688;margin-top:2px">'+escapeHtml(String(c.observaciones))+'</div>':'')
      + pistas
      + '<div class="small" style="margin-top:5px"><a href="javascript:void 0" style="color:#7dd3fc" onclick="_cotejoToggleMovs(\''+cid+'\')">🔎 Ver movimientos del turno de esta billetera</a></div>'
      + '<div id="cotejoMovs_'+cid+'" style="display:none;margin-top:4px;max-height:170px;overflow:auto;background:#0b0f15;border:1px solid #1e2530;border-radius:7px;padding:6px">'+_cotejoMovsHtml(c.wallet_id, movimientosPorBilletera)+'</div>'
      + acciones
      + '</div>';
  }).join('');
  // Tabla resumen estilo "cage report" (conciliación de caja de casino): fila por billetera,
  // Anotado (Chunior) | Declarado (banco) | Diferencia, con totales. Muestra TODO, incluso las OK.
  let resumenHtml='';
  if(st.resumen && st.resumen.filas && st.resumen.filas.length){
    let tC=0,tD=0,tDif=0;
    const trs=st.resumen.filas.map(function(r){
      tC+=r.chunior; tD+=r.decl; tDif+=r.dif;
      const col=r.dif===0?'#22c55e':(r.dif<0?'#f87171':'#f5c518');
      const difTxt=(r.dif===0?'✓':((r.dif>0?'+':'−')+money(Math.abs(r.dif))))
        + (r.resid?' <span title="residuo de centavos — no genera caso, lo limpia el supervisor" style="color:#6b7688;font-size:10px;font-weight:400">±'+String(Math.abs(r.resid)).replace('.',',')+'</span>':'');
      return '<tr style="border-top:1px solid rgba(255,255,255,.05)"><td style="padding:3px 6px;font-weight:700">'+escapeHtml(r.nombre)+'</td>'
        +'<td style="padding:3px 6px;text-align:right;color:#8b949e">'+money(r.chunior)+'</td>'
        +'<td style="padding:3px 6px;text-align:right">'+money(r.decl)+'</td>'
        +'<td style="padding:3px 6px;text-align:right;font-weight:800;color:'+col+'">'+difTxt+'</td></tr>';
    }).join('');
    resumenHtml='<div class="small" style="color:#8b949e;margin-bottom:3px">Última declaración · '+new Date(st.resumen.ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})+'</div>'
      +'<div style="overflow-x:auto;border:1px solid #262d3a;border-radius:9px"><table style="width:100%;font-size:12px;border-collapse:collapse">'
      +'<thead><tr style="color:#8b949e;background:#10141b"><th style="text-align:left;padding:4px 6px">Billetera</th><th style="text-align:right;padding:4px 6px">Anotado (Chunior)</th><th style="text-align:right;padding:4px 6px">Declarado (banco)</th><th style="text-align:right;padding:4px 6px">Dif</th></tr></thead><tbody>'
      +trs
      +'<tr style="border-top:1px solid rgba(255,255,255,.18);font-weight:800;background:#10141b"><td style="padding:4px 6px;color:#8b949e">TOTAL</td>'
      +'<td style="padding:4px 6px;text-align:right;color:#8b949e">'+money(tC)+'</td><td style="padding:4px 6px;text-align:right">'+money(tD)+'</td>'
      +'<td style="padding:4px 6px;text-align:right;color:'+(tDif===0?'#22c55e':'#f5c518')+'">'+(tDif===0?'✓':((tDif>0?'+':'−')+money(Math.abs(tDif))))+'</td></tr>'
      +'</tbody></table></div><div style="border-top:1px solid #262d3a;margin:10px 0 4px"></div>';
  }
  const cerradosHtml = _cerrados.length ? (
    '<div class="small" style="margin-top:10px"><a href="javascript:void 0" style="color:#8b949e" onclick="var d=document.getElementById(\'cotejoCerrados\');if(d)d.style.display=d.style.display===\'none\'?\'block\':\'none\';">▸ Finalizados del turno ('+_cerrados.length+') — ver/ocultar</a></div>'
    + '<div id="cotejoCerrados" style="display:none">'
    + _cerrados.map(function(c){
        const col=c.tipo==='FALTANTE'?'#f87171':'#f5c518';
        return '<div class="small" style="display:flex;gap:8px;align-items:center;padding:4px 8px;margin-top:4px;border-radius:7px;background:#0e1218;border:1px solid #1c2330;opacity:.65">'
          + '<span style="color:'+col+';font-weight:700">'+(c.tipo==='FALTANTE'?'▼':'▲')+' '+money(c.monto_original||c.monto_disponible)+'</span>'
          + '<span style="flex:1;color:#8b949e">'+escapeHtml(c.wallet_nombre||'')+' · #'+escapeHtml(String(c.case_id))+'</span>'
          + _cotejoEstadoBadge(c.estado)
          + (c.observaciones?'<span style="color:#6b7688" title="'+escapeHtml(String(c.observaciones))+'">📝</span>':'')
          + '</div>';
      }).join('')
    + '</div>') : '';
  // Cabecera de estado: lo primero que tiene que saber el operador es si el turno cierra o no.
  // Antes había que sumar las tarjetas a ojo para saber cuánto quedaba sin explicar.
  const _tFalta=_activos.filter(function(x){ return x.tipo==='FALTANTE'; }).reduce(function(a,b){ return a+Number(b.monto_disponible||0); },0);
  const _tSobra=_activos.filter(function(x){ return x.tipo==='SOBRANTE'; }).reduce(function(a,b){ return a+Number(b.monto_disponible||0); },0);
  const cabecera = _activos.length
    ? '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:7px 11px;border-radius:9px;background:rgba(245,197,24,.09);border:1px solid rgba(245,197,24,.35);margin-bottom:9px">'
      + '<span style="font-size:13px;line-height:1">⚠️</span>'
      + '<b style="font-size:11.5px;letter-spacing:.5px;text-transform:uppercase;color:#f5c518">'+_activos.length+' sin resolver</b>'
      + '<span class="small" style="color:#8b949e">'
      +   (_tFalta?('falta <b style="color:#f87171">'+money(_tFalta)+'</b>'):'')
      +   ((_tFalta&&_tSobra)?' · ':'')
      +   (_tSobra?('sobra <b style="color:#f5c518">'+money(_tSobra)+'</b>'):'')
      + '</span></div>'
    : '<div style="display:flex;align-items:center;gap:9px;padding:7px 11px;border-radius:9px;background:rgba(63,185,80,.10);border:1px solid rgba(63,185,80,.38);margin-bottom:9px">'
      + '<span style="font-size:13px;line-height:1">✅</span>'
      + '<b style="font-size:11.5px;letter-spacing:.5px;text-transform:uppercase;color:#3fb950">Turno cuadrado</b>'
      + '<span class="small" style="color:#8b949e">no queda nada abierto</span></div>';
  el.innerHTML=_cotejoWrap(
    cabecera
    + resumenHtml
    + filas
    + cerradosHtml
    + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap">'
    +   '<span style="display:flex;gap:8px"><button class="mini-btn green" style="font-size:11px;font-weight:800" onclick="_cotejoAutoCompensar()" title="Cruza todos los faltantes con todos los sobrantes y hace las transferencias solo. Lo que quede es lo que realmente falta/sobra en el cierre.">⚡ Auto-cotejar todo</button>'
    +   '<button class="mini-btn blue" style="font-size:11px" onclick="_cotejoRenderDeclarar()">🙈 Nueva declaración</button>'
    +   '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoVerEscalados()">📚 Escalados anteriores</button></span>'
    +   '<button class="mini-btn" style="font-size:11px;background:#3b2a63;color:#d6c9ff" onclick="_cotejoEscalarTurno()" title="Se puede usar en cualquier momento — todo lo no resuelto queda para revisión del superior">⏫ Pasar TODO lo abierto al superior</button>'
    + '</div>');
}
// Mini-guía por caso: movimientos del turno de esa billetera (del historial ya cargado, 0 llamados).
function _cotejoMovsHtml(walletId, movimientosPorBilletera){
  const st=window._cotejoState; if(!st) return '';
  const indice=movimientosPorBilletera||NodoDomain.conciliacion.indexarMovimientos(_cotejoMovsTurno(st.snap.inicio_turno_ms));
  const movs=indice.get(String(walletId))||[];
  if(!movs.length) return '<div class="small" style="color:#6b7688">Sin movimientos de esta billetera en el turno.</div>';
  return movs.map(function(m){
    const hh=m.ts?new Date(m.ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):'—';
    const col=m.tipo==='RETIRO'?'#fb923c':(m.tipo==='CARGA'?'#22c55e':'#8b949e');
    return '<div class="small" style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
      + '<span style="color:#8b949e">'+hh+'</span><span style="color:'+col+';font-weight:700">'+escapeHtml(m.tipo)+'</span>'
      + '<span style="flex:1">'+escapeHtml(m.usuario||'')+'</span><b>'+money(m.monto)+'</b>'
      + (m.chunior_movimiento_id?'<span style="color:#8b949e">N° '+escapeHtml(String(m.chunior_movimiento_id))+'</span>':'')+'</div>';
  }).join('');
}
window._cotejoToggleMovs=function(id){ const d=document.getElementById('cotejoMovs_'+id); if(d) d.style.display = d.style.display==='none'?'block':'none'; };
function _cotejoCaso(id){ return (window._cotejoState.casos||[]).find(function(c){ return String(c.case_id)===String(id); }); }
async function _cotejoSetEstado(id, estado, obs){
  const st=window._cotejoState; const c=_cotejoCaso(id); if(!c) return;
  c.estado=estado; if(obs) c.observaciones=(c.observaciones?c.observaciones+' · ':'')+obs;
  const ls=_cotejoLsLoad(st.turno_id); ls.casos=st.casos; _cotejoLsSave(st.turno_id, ls);
  if(!c._local) _cotejoRpc('panel_cotejo_actualizar',{ p_case_id:Number(c.case_id), p_estado:estado, p_monto_disponible:null, p_observaciones:obs||null, p_operador:_cotejoOp() });
}
window._cotejoAplicarMoverRetiro=async function(casoFalt, casoSobr, movId){
  const st=window._cotejoState; const f=_cotejoCaso(casoFalt);
  const fila=((typeof _historialData!=='undefined'&&_historialData)||[]).find(function(h){ return String(h.id)===String(movId); });
  const bilDestino=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f&&f.wallet_id); });
  if(!fila||!bilDestino||!bilDestino.CHUNIOR_UID){ toast('No encuentro el movimiento o la billetera destino (con UID Chunior).','red'); return; }
  if(!confirm('Mover la anotación del retiro de '+(fila.usuario||'')+' ('+money(fila.monto)+') a la billetera '+(bilDestino.NOMBRE_VISIBLE||'')+' en Chunior?')) return;
  if(typeof procesarColaCambioBilletera==='function'){ procesarColaCambioBilletera([fila], bilDestino); }
  else { toast('Cambio de billetera no disponible — hacelo desde el historial.','yellow'); return; }
  await _cotejoSetEstado(casoFalt,'AJUSTANDO','mover retiro #'+movId+' → '+(bilDestino.NOMBRE_VISIBLE||''));
  await _cotejoSetEstado(casoSobr,'AJUSTANDO','par de #'+casoFalt);
  if(!(_cotejoCaso(casoFalt)||{})._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(casoFalt), p_tipo:'MOVER_RETIRO', p_monto:Number(f.monto_disponible), p_referencia:String(fila.chunior_movimiento_id||movId), p_detalle:'cola cambio billetera → '+(bilDestino.NOMBRE_VISIBLE||''), p_operador:_cotejoOp() });
  toast('🚚 Cola de cambio de billetera lanzada · cuando termine, marcá el caso resuelto','blue');
  _cotejoRenderCasos();
};
window._cotejoCrearDepo=async function(id){
  const c=_cotejoCaso(id); if(!c) return;
  const bil=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(c.wallet_id); });
  if(!bil||!bil.CHUNIOR_UID){ toast('La billetera no tiene UID de Chunior.','red'); return; }
  // Pre-relleno: monto + billetera fijos; usuario opcional desde el input inline del caso
  // (prompt() NO existe en Electron — nunca usarlo).
  const _usrInp=document.getElementById('cotejoDepoUsr_'+c.case_id);
  const usr=String((_usrInp&&_usrInp.value)||'').trim();
  const nota='[COTEJO '+window._cotejoState.turno_id+' · caso #'+c.case_id+' · '+_cotejoOp()+']'+(usr?(' '+usr):'');
  if(!confirm('Anotar depo s/reclamar de '+money(c.monto_disponible)+' en '+(bil.NOMBRE_VISIBLE||'')+' con nota:\n'+nota)) return;
  const r=await registrarDepoSinReclamarEnChunior(bil.CHUNIOR_UID, Number(c.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(id,'RESUELTA','depo s/r anotado'+(r.movimientoId?(' N° '+r.movimientoId):''));
    if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'CREAR_DEPO', p_monto:Number(c.monto_disponible), p_referencia:String(r.movimientoId||''), p_detalle:nota, p_operador:_cotejoOp() });
    toast('✓ Depo anotado y caso resuelto','green');
  } else toast('No se pudo anotar: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// ENVIAR A ERROR (faltante): transferencia contable billetera→ERROR — declara la falta en Chunior
// exactamente como el operador lo hacía a mano. El caso queda RESUELTO (la falta está declarada).
window._cotejoEnviarAError=async function(id){
  const c=_cotejoCaso(id); const ex=(window._cotejoState.snap&&window._cotejoState.snap.extra)||{}; const ew=ex.errorWallet;
  if(!c||!ew){ toast('No hay billetera ERROR detectada en Chunior.','red'); return; }
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(c.wallet_id); });
  if(!bf||!bf.CHUNIOR_UID){ toast('La billetera no tiene UID de Chunior.','red'); return; }
  const nota='[COTEJO '+window._cotejoState.turno_id+' · caso #'+c.case_id+' · '+_cotejoOp()+'] faltante declarado';
  if(!confirm('Declarar el faltante de '+money(c.monto_disponible)+':\n'+(bf.NOMBRE_VISIBLE||'')+' → '+(ew.nombre||'ERROR')+' (transferencia contable en Chunior)\n\nLa falta queda declarada y visible en ERROR. Si después la plata reaparece, el cotejo te va a ofrecer recuperarla.')) return;
  toast('Anotando en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, ew.uid, Number(c.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(id,'RESUELTA','faltante enviado a ERROR');
    if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'MANUAL', p_monto:Number(c.monto_disponible), p_referencia:'ERROR', p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('🚫 Faltante declarado en ERROR · caso resuelto','green');
  } else toast('No se pudo anotar: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// RECUPERAR DE ERROR (sobrante): la plata declarada perdida reapareció → transferencia contable
// ERROR→billetera (sube el chunior bajo, baja ERROR) y ambos quedan 1:1 con el banco.
window._cotejoRecuperarDeError=async function(id, refMov){
  const c=_cotejoCaso(id); const ex=(window._cotejoState.snap&&window._cotejoState.snap.extra)||{}; const ew=ex.errorWallet;
  if(!c||!ew){ toast('No hay billetera ERROR detectada.','red'); return; }
  const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(c.wallet_id); });
  if(!bs||!bs.CHUNIOR_UID){ toast('La billetera no tiene UID de Chunior.','red'); return; }
  const nota='[COTEJO '+window._cotejoState.turno_id+' · caso #'+c.case_id+' · '+_cotejoOp()+'] recuperado de ERROR'+(refMov?(' (mov '+refMov+')'):'');
  if(!confirm('Recuperar '+money(c.monto_disponible)+' de ERROR → '+(bs.NOMBRE_VISIBLE||'')+' (transferencia contable en Chunior)?\n\nLa plata reapareció: el error declarado se revierte.')) return;
  toast('Anotando en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(ew.uid, bs.CHUNIOR_UID, Number(c.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(id,'RESUELTA','recuperado de ERROR'+(refMov?(' · mov '+refMov):''));
    if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'MANUAL', p_monto:Number(c.monto_disponible), p_referencia:'ERROR:'+(refMov||''), p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('⇄ Recuperado de ERROR · caso resuelto','green');
  } else toast('No se pudo anotar: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// CERRAR COMO ERROR YA DECLARADO (faltante que concuerda con un envío a ERROR previo del turno):
// error genuino → NO se reclama; el caso se cierra explicado, sin doble contabilización.
window._cotejoCerrarPorError=async function(id, refMov){
  const c=_cotejoCaso(id); if(!c) return;
  if(!confirm('¿Cerrar este faltante como ERROR YA DECLARADO'+(refMov?(' (mov '+refMov+')'):'')+'?\n\nError genuino: la falta ya está declarada en ERROR, no se reclama ni se vuelve a anotar.')) return;
  await _cotejoSetEstado(id,'RESUELTA','explicado por envío a ERROR previo'+(refMov?(' · mov '+refMov):'')+' (error genuino, sin reclamo)');
  if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'MANUAL', p_monto:Number(c.monto_disponible), p_referencia:'ERROR:'+(refMov||''), p_detalle:'error genuino ya declarado', p_operador:_cotejoOp() });
  toast('Caso cerrado: error ya declarado','green'); _cotejoRenderCasos();
};
// COMPENSACIÓN PARCIAL: transfiere el MÍNIMO entre faltante y sobrante (billetera faltante →
// sobrante, contable) y descuenta el disponible de AMBOS casos (inmutabilidad: asignación, no
// edición). El que llega a 0 → RESUELTA; el que queda con resto → PARCIAL_ASIGNADA y sigue vivo
// para el próximo cruce (depo, ERROR, otra compensación).
window._cotejoCompensarParcial=async function(casoFalt, casoSobr){
  const st=window._cotejoState; const f=_cotejoCaso(casoFalt), s=_cotejoCaso(casoSobr); if(!f||!s) return;
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f.wallet_id); });
  const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(s.wallet_id); });
  if(!bf||!bs||!bf.CHUNIOR_UID||!bs.CHUNIOR_UID){ toast('Falta el UID de Chunior de alguna billetera.','red'); return; }
  const mm=Math.min(Number(f.monto_disponible), Number(s.monto_disponible));
  if(!(mm>0)) return;
  const restoF=Number(f.monto_disponible)-mm, restoS=Number(s.monto_disponible)-mm;
  const nota='[COTEJO '+st.turno_id+' · #'+f.case_id+'/#'+s.case_id+' · '+_cotejoOp()+'] compensación parcial '+(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'');
  if(!confirm('Compensar '+money(mm)+' con una transferencia CONTABLE en Chunior:\n'
    +(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'')+'\n\nDespués queda:\n'
    +'· '+(bf.NOMBRE_VISIBLE||'')+': '+(restoF>0?('faltante de '+money(restoF)):'cuadrada ✓')+'\n'
    +'· '+(bs.NOMBRE_VISIBLE||'')+': '+(restoS>0?('sobrante de '+money(restoS)):'cuadrada ✓'))) return;
  toast('Anotando transferencia en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, mm, nota);
  if(r&&r.ok){
    const _apl=function(c, resto, obs){
      c.monto_disponible=resto;
      c.estado=(resto<=0)?'RESUELTA':'PARCIAL_ASIGNADA';
      c.observaciones=(c.observaciones?c.observaciones+' · ':'')+obs;
    };
    _apl(f, restoF, 'compensado '+money(mm)+' con #'+s.case_id);
    _apl(s, restoS, 'compensado '+money(mm)+' con #'+f.case_id);
    const ls=_cotejoLsLoad(st.turno_id); ls.casos=st.casos; _cotejoLsSave(st.turno_id, ls);
    // El RPC de asignación descuenta y resuelve estado server-side (misma lógica).
    if(!f._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(f.case_id), p_tipo:'COMBINACION', p_monto:mm, p_referencia:String(s.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    if(!s._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(s.case_id), p_tipo:'COMBINACION', p_monto:mm, p_referencia:String(f.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('⇄ Compensados '+money(mm)+(restoF>0||restoS>0?' · el resto quedó como caso vivo':' · ambos cuadrados'),'green');
  } else toast('No se pudo anotar la transferencia: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// AUTO-COTEJO: hace TODA la repartija sola. Cruza faltantes contra sobrantes (greedy, mayor contra
// mayor), transfiere el mínimo de cada par y sigue hasta que no queden cruces posibles. Lo que
// sobra/falta al final es lo que REALMENTE sobra o falta en el cierre de caja.
// No es absoluto: muestra el plan y el residuo antes de ejecutar, y frena si una transferencia falla.
window._cotejoAutoCompensar=async function(){
  const st=window._cotejoState; if(!st) return;
  const FIN=['RESUELTA','ANULADA','ESCALADA'];
  const vivos=st.casos.filter(function(c){ return !FIN.includes(c.estado) && Number(c.monto_disponible)>0; });
  const F=vivos.filter(function(c){ return c.tipo==='FALTANTE'; }).map(function(c){ return {c:c, rem:Number(c.monto_disponible)}; }).sort(function(a,b){ return b.rem-a.rem; });
  const S=vivos.filter(function(c){ return c.tipo==='SOBRANTE'; }).map(function(c){ return {c:c, rem:Number(c.monto_disponible)}; }).sort(function(a,b){ return b.rem-a.rem; });
  if(!F.length || !S.length){ toast('No hay faltantes y sobrantes para cruzar entre sí.','yellow'); return; }
  // PLAN greedy (sin tocar nada todavía)
  const plan=[];
  F.forEach(function(f){
    S.forEach(function(s){
      if(f.rem<=0 || s.rem<=0) return;
      if(String(f.c.wallet_id)===String(s.c.wallet_id)) return;
      const mm=Math.min(f.rem,s.rem);
      plan.push({ f:f.c, s:s.c, monto:mm });
      f.rem-=mm; s.rem-=mm;
    });
  });
  if(!plan.length){ toast('No hay cruces posibles.','yellow'); return; }
  const resid=[].concat(F,S).filter(function(x){ return x.rem>0; })
    .map(function(x){ return '· '+(x.c.tipo==='FALTANTE'?'falta':'sobra')+' '+money(x.rem)+' en '+(x.c.wallet_nombre||''); });
  const txtPlan=plan.map(function(p){ return '· '+money(p.monto)+'  '+(p.f.wallet_nombre||'')+' → '+(p.s.wallet_nombre||''); }).join('\n');
  if(!confirm('AUTO-COTEJO · '+plan.length+' transferencia(s) contable(s) en Chunior:\n\n'+txtPlan
    +'\n\nDespués de la repartija queda:\n'+(resid.length?resid.join('\n'):'· todo cuadrado ✓')
    +'\n\n(eso es lo que realmente sobra/falta en el cierre)')) return;
  let hechas=0;
  for(const p of plan){
    const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(p.f.wallet_id); });
    const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(p.s.wallet_id); });
    if(!bf||!bs||!bf.CHUNIOR_UID||!bs.CHUNIOR_UID){ toast('Falta UID de Chunior en '+((!bf||!bf.CHUNIOR_UID)?(p.f.wallet_nombre||''):(p.s.wallet_nombre||'')),'red'); break; }
    toast('Auto-cotejo '+(hechas+1)+'/'+plan.length+' · '+money(p.monto)+'…','blue');
    const nota='[COTEJO '+st.turno_id+' · #'+p.f.case_id+'/#'+p.s.case_id+' · '+_cotejoOp()+'] auto-cotejo';
    const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, p.monto, nota);
    if(!(r&&r.ok)){ toast('Se cortó en la transferencia '+(hechas+1)+': '+((r&&r.error)||''),'red'); break; }
    [[p.f,p.s],[p.s,p.f]].forEach(function(par){
      const c=par[0], otro=par[1];
      c.monto_disponible=Math.max(0, Number(c.monto_disponible)-p.monto);
      c.estado=(c.monto_disponible<=0)?'RESUELTA':'PARCIAL_ASIGNADA';
      c.observaciones=(c.observaciones?c.observaciones+' · ':'')+'auto-cotejo '+money(p.monto)+' con #'+otro.case_id;
      if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'COMBINACION', p_monto:p.monto, p_referencia:String(otro.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    });
    hechas++;
  }
  const ls=_cotejoLsLoad(st.turno_id); ls.casos=st.casos; _cotejoLsSave(st.turno_id, ls);
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  toast(hechas===plan.length ? ('✅ Auto-cotejo completo · '+hechas+' transferencia(s)') : ('⚠ Auto-cotejo parcial · '+hechas+'/'+plan.length),
        hechas===plan.length?'green':'yellow');
  _cotejoRenderCasos();
};
// ⚠ Electron NO soporta prompt() (tira excepción y el botón "no hace nada") → acciones directas
// con confirm() + toast SIEMPRE como feedback. El motivo/nota queda en el log con operador+fecha.
// Compensación 1:1 SIN retiro candidato: transferencia CONTABLE en Chunior (movimientointerno)
// billetera FALTANTE → SOBRANTE. Baja el chunior alto (A) y sube el bajo (B) → ambos quedan 1:1
// con el banco. Queda anotada en Chunior con la nota del caso (auditable).
window._cotejoCompensar=async function(casoFalt, casoSobr){
  const f=_cotejoCaso(casoFalt), s=_cotejoCaso(casoSobr); if(!f||!s) return;
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f.wallet_id); });
  const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(s.wallet_id); });
  if(!bf||!bs||!bf.CHUNIOR_UID||!bs.CHUNIOR_UID){ toast('Falta el UID de Chunior de alguna de las billeteras.','red'); return; }
  const nota='[COTEJO '+window._cotejoState.turno_id+' · #'+f.case_id+'/#'+s.case_id+' · '+_cotejoOp()+'] compensación '+(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'');
  if(!confirm('Compensar '+money(f.monto_disponible)+' con una transferencia CONTABLE en Chunior:\n'
    +(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'')+'\n\nNo mueve plata real: alinea lo anotado con lo que hay en el banco. Queda en Chunior con la nota del caso.')) return;
  toast('Anotando transferencia en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, Number(f.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(casoFalt,'RESUELTA','compensado por transferencia → '+(bs.NOMBRE_VISIBLE||''));
    await _cotejoSetEstado(casoSobr,'RESUELTA','compensado por transferencia ← '+(bf.NOMBRE_VISIBLE||''));
    if(!f._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(f.case_id), p_tipo:'COMBINACION', p_monto:Number(f.monto_disponible), p_referencia:String(s.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('⇄ Compensado · ambos casos resueltos','green');
  } else toast('No se pudo anotar la transferencia: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// Compensar una COMBINACIÓN (faltante = suma de 2 sobrantes): una transferencia contable por parte.
// Si alguna falla a mitad → APLICACION_PARCIAL (doc §8) y se reintenta después.
window._cotejoCompensarCombo=async function(casoFalt, partesCsv){
  const f=_cotejoCaso(casoFalt); if(!f) return;
  const partes=String(partesCsv||'').split(',').map(function(x){ return _cotejoCaso(x); }).filter(Boolean);
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f.wallet_id); });
  if(!bf||!bf.CHUNIOR_UID||!partes.length){ toast('Faltan datos de billeteras para compensar.','red'); return; }
  const detalle=partes.map(function(p){ return (p.wallet_nombre||'')+' '+money(p.monto_disponible); }).join(' + ');
  if(!confirm('Compensar '+money(f.monto_disponible)+' de '+(bf.NOMBRE_VISIBLE||'')+' con '+partes.length+' transferencias contables en Chunior:\n'+detalle+'\n\nNo mueve plata real: alinea lo anotado con el banco.')) return;
  let hechas=0;
  for(const p of partes){
    const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(p.wallet_id); });
    if(!bs||!bs.CHUNIOR_UID){ break; }
    const nota='[COTEJO '+window._cotejoState.turno_id+' · #'+f.case_id+'/#'+p.case_id+' · '+_cotejoOp()+'] combinación '+(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'');
    toast('Transferencia '+(hechas+1)+'/'+partes.length+'...','blue');
    const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, Number(p.monto_disponible), nota);
    if(!(r&&r.ok)) break;
    await _cotejoSetEstado(p.case_id,'RESUELTA','combinación con #'+f.case_id);
    if(!f._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(f.case_id), p_tipo:'COMBINACION', p_monto:Number(p.monto_disponible), p_referencia:String(p.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    hechas++;
  }
  if(hechas===partes.length){ await _cotejoSetEstado(casoFalt,'RESUELTA','combinación completa: '+detalle); toast('⇄ Combinación compensada · '+(partes.length+1)+' casos resueltos','green'); }
  else { await _cotejoSetEstado(casoFalt,'APLICACION_PARCIAL','falló la parte '+(hechas+1)+' de '+partes.length+' — reintentá'); toast('⚠ Se aplicaron '+hechas+'/'+partes.length+' — el caso quedó en APLICACIÓN PARCIAL, reintentá','yellow'); }
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  _cotejoRenderCasos();
};
// Casos pasados al superior en turnos ANTERIORES de esta PC (solo lectura — la UI central del
// superior vive en el admi cuando el SQL esté aplicado).
window._cotejoVerEscalados=function(){
  const el=_cotejoUiModal(); const cur=window._cotejoState?window._cotejoState.turno_id:'';
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i)||'';
    if(!/^nodo_cotejo_\d{4}/.test(k) || k===_cotejoLsKey(cur)) continue;
    try{ const s=JSON.parse(localStorage.getItem(k)||'{}'); (s.casos||[]).forEach(function(c){ if(c.estado==='ESCALADA') out.push(Object.assign({_turno:k.replace('nodo_cotejo_','')},c)); }); }catch(_e){}
  }
  const rows=out.map(function(c){
    const col=c.tipo==='FALTANTE'?'#f87171':'#f5c518';
    return '<div class="small" style="display:flex;gap:10px;padding:6px 8px;border-radius:8px;background:#10141b;border:1px solid #262d3a;border-left:3px solid '+col+';margin-top:5px;align-items:center">'
      + '<span style="color:#8b949e">'+escapeHtml(c._turno)+'</span>'
      + '<b style="color:'+col+'">'+(c.tipo==='FALTANTE'?'▼':'▲')+' '+money(c.monto_disponible)+'</b>'
      + '<span style="flex:1">'+escapeHtml(c.wallet_nombre||'')+'</span>'
      + '<span style="color:#8b949e">'+escapeHtml(c.operador||'')+'</span>'
      + (c.observaciones?'<span style="color:#6b7688" title="'+escapeHtml(c.observaciones)+'">📝</span>':'')+'</div>';
  }).join('');
  el.innerHTML=_cotejoWrap('<div style="font-weight:800;margin-bottom:4px">📚 Pasados al superior · turnos anteriores (esta PC)</div>'
    + (rows||'<div class="alert-box">No hay casos escalados de turnos anteriores en esta PC.</div>')
    + '<div style="margin-top:10px"><button class="mini-btn blue" style="font-size:11px" onclick="_cotejoRenderCasos()">← Volver a los casos</button></div>');
};
window._cotejoIgnorar=async function(id){
  if(!confirm('¿Ignorar este caso? Queda ANULADO en el registro (no se borra, el superior lo puede ver).')) return;
  await _cotejoSetEstado(id,'ANULADA','ignorado por operador');
  toast('Caso ignorado (queda en el registro)','yellow'); _cotejoRenderCasos();
};
window._cotejoEscalarCaso=async function(id){
  if(!confirm('¿Pasar este caso al SUPERIOR? Queda marcado para que lo revise él (vos ya no lo tocás).')) return;
  await _cotejoSetEstado(id,'ESCALADA','pasado al superior por el operador');
  toast('Caso pasado al superior','blue'); _cotejoRenderCasos();
};
window._cotejoEscalarTurno=async function(){
  if(!confirm('¿Pasar TODO lo no resuelto al SUPERIOR? Se puede usar en cualquier momento (no solo a fin de turno).')) return;
  const st=window._cotejoState; let n=0;
  for(const c of st.casos){ if(!['RESUELTA','ANULADA','ESCALADA'].includes(c.estado)){ await _cotejoSetEstado(c.case_id,'ESCALADA','pasado al superior (lote)'); n++; } }
  _cotejoRpc('panel_cotejo_escalar_turno',{ p_pc_codigo:(pcOperativa||''), p_turno_id:st.turno_id, p_operador:_cotejoOp() });
  toast(n+' caso(s) pasados al superior','blue'); _cotejoRenderCasos();
};

// Verifica DIRECTAMENTE en la lista de movimientos de Chunior si ya existe un
// movimiento que coincida con usuario (notas) + monto, en las últimas horas.
// Esto cubre el caso "se anotó en Chunior pero NODO no guardó el N° de movimiento".
// Usa el buscador del admin (?q=usuario) y lee la tabla #result_list.
// Devuelve { existe:boolean, movimientoId:string|null }.
// "07-07-2026 08:21:49" (DD-MM-YYYY HH:MM:SS, hora local de Chunior) → ms epoch.
