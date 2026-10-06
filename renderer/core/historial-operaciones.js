function pcAliasesHist(){
  const v = String((typeof pcOperativa!=='undefined' ? pcOperativa : '') || '').trim().toUpperCase();
  const grupos = {
    "P1":["P1","PC1","XGENERALENUSO","XGENERAL","GENERAL","OFI_1"],
    "P2":["P2","PC2"], "P3":["P3","PC3"],
    "P4":["P4","PC4","SANCHEZ","SANCHEZPLATA"], "P5":["P5","PC5"]
  };
  for(const k in grupos){ if(grupos[k].includes(v)) return grupos[k]; }
  return v ? [v] : ["P1"];
}
// ── Recuperar el N° de movimiento de una operación que quedó sin él ──────────
// Medido: 1.172 CARGAS y 199 RETIROS de 30 días sin chunior_movimiento_id. La operación se
// hizo, lo que falló fue leer el número del mensaje de éxito de Chunior. El motor para
// encontrarlo ya existía —verificarMovimientoEnChunior busca en la lista real por usuario,
// cruza el monto y descarta los N° ya vinculados a otra fila— pero sólo se usaba dentro de
// "Reintentar". Acá se puede pedir desde la ficha, sin reintentar nada ni tocar saldos.
window.expedienteBuscarMovChunior = async function(historialId, usuario, monto, fechaIso){
  historialId = String(historialId||'').trim();
  usuario = String(usuario||'').trim();
  if(!historialId || !/^\d+$/.test(historialId)){
    toast('Esta fila no tiene operación registrada: no hay dónde guardar el N°.', 'yellow'); return;
  }
  if(!usuario){ toast('Sin usuario no se puede buscar el movimiento.', 'yellow'); return; }
  if(typeof verificarMovimientoEnChunior !== 'function'){ toast('Falta el buscador de Chunior.', 'red'); return; }
  if(!window.chunior){ toast('Ventana de Chunior no disponible.', 'red'); return; }

  const tOpMs = fechaIso ? new Date(fechaIso).getTime() : null;
  // El horario desambigua entre varias cargas iguales del mismo usuario. Para una operación
  // del momento ±2 min alcanza; para una vieja se abre a ±10 min porque el desfase entre el
  // created_at nuestro y la hora que registró Chunior pesa más cuanto más atrás se busca.
  const reciente = tOpMs != null && (Date.now() - tOpMs) < 2*60*60*1000;
  const ventana = reciente ? 2*60*1000 : 10*60*1000;

  // No reclamar un N° que ya es de otra operación.
  const otros = ((typeof _historialData !== 'undefined' && _historialData) || [])
    .filter(function(x){ return String(x.id) !== historialId && x.chunior_movimiento_id; })
    .map(function(x){ return String(x.chunior_movimiento_id); });

  toast('Buscando el movimiento de '+usuario+' en Chunior...', 'blue');
  let r;
  try{
    r = await verificarMovimientoEnChunior(usuario, Number(monto||0), tOpMs, ventana, otros);
  }catch(e){
    toast('Error buscando en Chunior: '+(e.message||e), 'red'); return;
  }

  if(r && r.vinculadoAOtro){
    toast('Encontré el N° '+(r.idVinculado||'?')+' pero ya está usado por otra operación. Revisalo a mano.', 'orange');
    return;
  }
  if(!r || !r.existe || !r.movimientoId){
    toast('No apareció. Puede estar más atrás de las 40 filas que lee Chunior, o anotado con otro monto.', 'orange');
    return;
  }

  // .update() sin match NO devuelve error: si el id no existía, esto cantaba "guardado" igual.
  // Con .select() sabemos si de verdad se tocó una fila.
  let guardadas = [];
  try{
    const { data, error } = await supabaseClient.from('historial_ops')
      .update({ chunior_movimiento_id: String(r.movimientoId) })
      .eq('id', Number(historialId))
      .select('id');
    if(error) throw error;
    guardadas = data || [];
  }catch(e){
    toast('Lo encontré (N° '+r.movimientoId+') pero no pude guardarlo: '+(e.message||e), 'red'); return;
  }
  if(!guardadas.length){
    toast('Encontré el N° '+r.movimientoId+' pero la operación #'+historialId+' no existe en el historial. No se guardó nada.', 'red');
    return;
  }

  // Refrescar EN MEMORIA además de recargar. La operación puede ser de hace semanas y quedar
  // fuera de la ventana cargada: entonces cargarHistorial() no la trae y la ficha seguía
  // diciendo "Sin N° anotado" aunque el número ya estuviera guardado en la base.
  _marcarMovEnMemoria(historialId, String(r.movimientoId));

  toast('✓ Movimiento N° '+r.movimientoId+' vinculado a la operación.', 'green');
  try{ await cargarHistorial(); }catch(_e){}
  try{ _marcarMovEnMemoria(historialId, String(r.movimientoId)); }catch(_e){}
  try{ renderHistorialUnificado(); }catch(_e){}
};

// Escribe el N° recién encontrado en TODAS las copias que hay dando vueltas: la fila del
// historial, la solicitud del portal que la originó y el item ya construido de la vista.
// Sin esto el dato queda sólo en la base y la pantalla sigue mostrando lo viejo.
function _marcarMovEnMemoria(historialId, movId){
  const idStr = String(historialId);
  let solicitudId = null;
  try{
    ((typeof _historialData !== "undefined" && _historialData) || []).forEach(function(h){
      if(String(h.id) === idStr){ h.chunior_movimiento_id = movId; if(h.solicitud_id != null) solicitudId = String(h.solicitud_id); }
    });
  }catch(_e){}
  try{
    (window._histUnificadoCache || []).forEach(function(it){
      // Por solicitud, sólo la tarjeta del PORTAL de esa solicitud. Un retiro pagado en partes
      // tiene varias filas de historial con la misma solicitud y cada una tiene SU número: el del
      // último pago se copiaba a todas y las tres tarjetas decían N° 9657437 (Juan, 12/09).
      const coincide = String(it.historial_id) === idStr ||
        (solicitudId && it.fuente === 'SOLICITUD' && String(it.solicitud_id) === solicitudId);
      if(coincide){
        it.chunior_movimiento_id = movId;
        if(it._raw){ it._raw.chunior_movimiento_id = movId; }
      }
    });
  }catch(_e){}
  // La solicitud del portal es la que arma la ficha cuando la operación es vieja.
  try{
    const sols = (window.V154P && window.V154P.solicitudes) || window.solicitudes || [];
    sols.forEach(function(x){
      const xid = String(x.HISTORIAL_ID || x.historial_id || "");
      const xsol = String(x.ID || x.SOLICITUD_ID || x.id || "");
      if(xid === idStr || (solicitudId && xsol === solicitudId)) x.chunior_movimiento_id = movId;
    });
  }catch(_e){}
}

// ── Ventana del historial ────────────────────────────────────────────────────
// Antes esto era .limit(200) fijo. Medido contra la base, 200 filas son:
//   P4 9,1 h · P2 9,3 h · P3 10,0 h · P7 11,8 h · P6 13,5 h · P5 30,9 h
// O sea que en las oficinas grandes NO alcanzaba ni para el turno en curso, y todo lo de
// ayer quedaba fuera del panel: no había con qué cotejar. Ahora la ventana se mide en
// TIEMPO (que es lo que el operador tiene en la cabeza), no en cantidad de filas.
window._HIST_PERIODO = window._HIST_PERIODO || "TURNO";
const _HIST_PERIODOS = {
  TURNO: { horas: 12,  limite: 1500, nombre: "Turno actual" },
  HOY:   { horas: 24,  limite: 2500, nombre: "Últimas 24 h" },
  D7:    { horas: 168, limite: 5000, nombre: "7 días" },
  D30:   { horas: 720, limite: 8000, nombre: "30 días" }
};
function _histVentana(){
  const cfg = _HIST_PERIODOS[String(window._HIST_PERIODO||"TURNO")] || _HIST_PERIODOS.TURNO;
  let horas = cfg.horas;
  // En TURNO la ventana arranca donde arrancó el turno, pero nunca menos de 12 h: si son las
  // 06:10 y el turno recién empezó, el operador igual necesita ver lo que dejó el turno anterior.
  if(window._HIST_PERIODO==="TURNO" || !window._HIST_PERIODO){
    try{
      const ar = new Date(Date.now() - 3*3600*1000);
      const h = ar.getUTCHours();
      const inicio = h>=6 && h<14 ? 6 : (h>=14 && h<22 ? 14 : 22);
      let desdeTurno = (h - inicio + 24) % 24;
      horas = Math.max(12, desdeTurno + 1);
    }catch(_e){}
  }
  return {
    desde: new Date(Date.now() - horas*3600*1000).toISOString(),
    limite: cfg.limite,
    horas: horas,
    nombre: cfg.nombre
  };
}
// Cambiar el período RECONSULTA al servidor: es la única forma de ver lo que quedó fuera.
window.setHistorialPeriodo = async function(clave){
  window._HIST_PERIODO = String(clave||"TURNO").toUpperCase();
  const sel = document.getElementById("filtroPeriodoSelect");
  if(sel && sel.value !== window._HIST_PERIODO) sel.value = window._HIST_PERIODO;
  try{ toast("Trayendo "+((_HIST_PERIODOS[window._HIST_PERIODO]||{}).nombre||"")+"...", "blue"); }catch(_e){}
  await cargarHistorial();
};

// ── Operaciones de hoy desde las 00 (centro de control) ──────────────────────
// Cuenta con head:true (no trae filas) y con el MISMO filtro de oficina que el historial. No sale
// del historial ya cargado porque esa ventana es "el turno" o "12 h", no "desde las 00".
window.solOpsHoyRefrescar = async function(){
  const el = document.getElementById('solOpsHoy'); if(!el) return;
  try{
    // Sin operador logueado no se cuenta: pcAliasesHist() cae a ["P1"] y contaría otra oficina.
    const op = (window.operador && (window.operador.usuario||window.operador.nombre))
            || (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre));
    if(!op) return;
    const pcs = (typeof pcAliasesHist === 'function') ? pcAliasesHist() : [];
    if(!pcs || !pcs.length) return;
    const desde = inicioDiaArgentina().toISOString();
    const contar = function(tipo){
      return supabaseClient.from('historial_ops').select('id', { count:'exact', head:true })
        .in('pc_codigo', pcs).gte('created_at', desde).eq('estado','OK').eq('tipo', tipo);
    };
    const res = await Promise.all([contar('CARGA'), contar('RETIRO')]);
    if((res[0] && res[0].error) || (res[1] && res[1].error)) return;
    const c = Number(res[0] && res[0].count)||0, r = Number(res[1] && res[1].count)||0;
    el.innerHTML = '📊 <b>'+(c+r)+'</b> operaciones desde las 00'
      + ' <span class="c">⬆ '+c+'</span> <span class="r">⬇ '+r+'</span>';
  }catch(_e){}
};
try{ setInterval(function(){ try{ window.solOpsHoyRefrescar(); }catch(_e){} }, 60000); }catch(_e){}

async function cargarHistorial(){
  _historialCargado = true;
  const el = document.getElementById("historialTable");
  if(el) el.innerHTML = '<div class="small" style="text-align:center;padding:20px;color:var(--muted)">Cargando...</div>';
  // Pintar desde caché al instante mientras Supabase responde
  try{ pintarHistorialDesdeCache(); }catch(_e){}

  // Incluimos LANDING/PORTAL para diferenciar claramente operaciones manuales
  // de operaciones que nacen desde solicitudes del portal.
  const _v = _histVentana();
  const { data, error } = await supabaseClient
    .from("historial_ops")
    .select("*")
    .in("pc_codigo", pcAliasesHist())
    .gte("created_at", _v.desde)
    .order("created_at", { ascending: false })
    .limit(_v.limite);

  if(error){
    if(el) el.innerHTML = '<div class="err-box">Error: '+escapeHtml(error.message||'')+'</div>';
    return;
  }
  _historialData = data || [];
  // Mismo caso: el CRM y el expediente leen window._historialData y siempre les daba undefined.
  try{ window._historialData = _historialData; }catch(_e){}
  try{ window.solOpsHoyRefrescar(); }catch(_e){}

  // CRM · Sembrar la base LOCAL de JUGADORES desde historial_ops (FUENTE PRINCIPAL).
  // Muchos usuarios cargaron desde OTRA máquina/turno, o su solicitud del portal ya salió de la
  // ventana actual → sólo viven en historial_ops. Sin esto NO aparecían en "Jugadores" (arbolito)
  // aunque tuvieran operaciones. Regla igual que en guardarMovimientoLocal: CBU/alias SÓLO de
  // RETIROS (en una carga el destino es NUESTRA billetera, no un dato del usuario); el titular
  // sirve en ambos flujos. El teléfono se sigue tomando de vincular/harvest (historial_ops no lo trae).
  try{
    if(window.jugadorRegistrarDato){
      window.__jugHistSeeded = window.__jugHistSeeded || new Set();
      const _okEstadosJug = ['OK','PAGADA','ACREDITADA','COMPLETADA','APROBADA'];
      _historialData.forEach(function(h){
        if(!h || !h.usuario) return;
        const sid = String(h.id!=null ? h.id : (h.usuario+'_'+(h.created_at||'')));
        if(window.__jugHistSeeded.has(sid)) return;   // ya sembrado → no reprocesar en cada refresh
        window.__jugHistSeeded.add(sid);
        const p = _movParseNotas(h.notas);
        const esRet = String(h.tipo||'').toUpperCase()==='RETIRO';
        const opOk  = _okEstadosJug.includes(String(h.estado||'').toUpperCase());
        // Se registra SIEMPRE (aunque no haya titular/CBU) para que el usuario EXISTA en el arbolito.
        window.jugadorRegistrarDato(h.usuario, {
          cbu: esRet ? (p.cbu||p.destino) : '',
          titular: p.titular,
          instrumentoVerificado: esRet && opOk,   // retiro pagado a ese destino = instrumento verificado
          fecha: h.created_at
        });
      });
    }
  }catch(_e){}

  const bilSel = document.getElementById("filtHistBilletera");
  if(bilSel){
    const bils = [...new Set(_historialData.map(function(h){return h.billetera_nombre;}).filter(Boolean))];
    bilSel.innerHTML = '<option value="">Todas las billeteras</option>' +
      bils.map(function(b){ return '<option value="'+escapeHtml(b)+'">'+escapeHtml(b)+'</option>'; }).join('');
  }
  filtrarHistorial();
  // Refrescar la vista unificada de solicitudes si ya tiene datos cargados
  try{ if(solicitudes.length || _historialData.length) renderHistorialUnificado(); }catch(_e){}
  // Cargar operaciones de agente (CSV) en paralelo → alimentan el CRM/segmentación
  try{ cargarOperacionesAgente(); }catch(_e){}
}

// Operaciones de agentes importadas por CSV (admi) → solo alimentan el CRM, no el historial operativo.
// Agregamos del lado del servidor (cargas/montos/última carga por jugador) para no traer
// decenas de miles de filas ni sesgar por las más recientes.
// Esto son CUATRO consultas pesadas que alimentan el CRM, y se disparaban en CADA carga de
// historial, tenga el operador el CRM abierto o no. panel_crm_agente_resumen sola tarda 3,1 s
// (3.877 filas) y se llamó 5.382 veces el 2/10 entre las quince PCs. Cuando la base está ocupada
// se pasa del tope de tiempo y PostgREST devuelve 500 — que es el error que aparecía en la consola
// de Sánchez junto al de la bandeja. Y el panel se lo comía: `error ? (window._agenteResumen||[])`.
//
// Se guarda el resultado unos minutos. Quien de verdad lo necesite fresco —abrir Jugadores, por
// ejemplo— llama con forzar=true y lo vuelve a pedir.
const _CRM_VIVE_MS = 5 * 60 * 1000;
let _crmUltima = 0, _crmEnCurso = null;
async function cargarOperacionesAgente(forzar){
  const ahora = Date.now();
  if(!forzar && window._agenteResumen && (ahora - _crmUltima) < _CRM_VIVE_MS) return window._agenteResumen;
  if(_crmEnCurso) return _crmEnCurso;                      // no apilar cuatro consultas iguales
  _crmEnCurso = _cargarOperacionesAgenteAhora().finally(function(){
    _crmEnCurso = null; _crmUltima = Date.now();
  });
  return _crmEnCurso;
}
async function _cargarOperacionesAgenteAhora(){
  const pcs = (typeof pcAliasesHist==="function" ? pcAliasesHist() : [String(pcOperativa||"")]);
  try{
    const { data, error } = await supabaseClient.rpc("panel_crm_agente_resumen", { p_pc_codigos: pcs, p_secret: window.PANEL_DATA_SECRET });
    // El error iba derecho a la basura. Es una consulta de 3 segundos y cuando se pasa del tope el
    // servidor devuelve 500: el CRM se quedaba sin datos y nadie se enteraba.
    if(error) console.warn('[crm] agente_resumen fallo', error);
    window._agenteResumen = error ? (window._agenteResumen||[]) : (data||[]);
  }catch(e){ console.warn('[crm] agente_resumen fallo', e); window._agenteResumen = window._agenteResumen||[]; }
  // Flags push/app por jugador → para mostrar 🔔/📱 en el CRM
  try{
    const { data, error } = await supabaseClient.rpc("panel_crm_flags", { p_pc_codigos: pcs, p_secret: window.PANEL_DATA_SECRET });
    const m = {};
    if(!error && Array.isArray(data)){ data.forEach(function(f){ m[String(f.usuario||"").toLowerCase()] = {push:!!f.push, app:!!f.app}; }); }
    window._crmFlags = m;
  }catch(_e){ window._crmFlags = window._crmFlags||{}; }
  // Vínculos de whaticket (usuario+teléfono) → para que el CRM incluya a TODOS los registrados,
  // aunque NO tengan operaciones de agente ni del panel. Aporta teléfono/estado; ops quedan en 0.
  // Requiere la RPC panel_crm_vinculos (SQL). Si no existe, el CRM sigue andando sin esta fuente.
  try{
    const { data, error } = await supabaseClient.rpc("panel_crm_vinculos", { p_pc_codigos: pcs, p_secret: window.PANEL_DATA_SECRET });
    window._crmVinculos = (!error && Array.isArray(data)) ? data : (window._crmVinculos||[]);
  }catch(_e){ window._crmVinculos = window._crmVinculos||[]; }
  // Acá iba el contador global de registrados (las siete oficinas juntas). Se sacó junto con
  // la tarjeta que lo mostraba: el CRM ahora lista los registrados DE LA OFICINA, paginados
  // (panel_crm_vinculos_listar). Una consulta menos cada vez que se abre la pestaña.
  return window._agenteResumen;
}

function filtrarHistorial(){
  const tipo    = document.getElementById("filtHistTipo")?.value||"";
  const estado  = document.getElementById("filtHistEstado")?.value||"";
  const origen  = document.getElementById("filtHistOrigen")?.value||"";
  const bil     = document.getElementById("filtHistBilletera")?.value||"";
  const usuario = normalizar(document.getElementById("filtHistUsuario")?.value||"");

  // Unificar historial_ops + solicitudes del portal
  let lista = [];
  if(typeof construirHistorialUnificado === "function"){
    construirHistorialUnificado().forEach(function(it){
      lista.push({
        id: it.id, tipo: (it.tipo||'').toUpperCase(), usuario: it.usuario,
        billetera_nombre: it.billetera_nombre, billetera_id: it.billetera_id, monto: it.monto,
        estado: it.fuente==='SOLICITUD' ? (it.estado||'PENDIENTE') : (it.estado||''),
        origen: it.fuente==='SOLICITUD' ? 'PORTAL' : (it._raw&&it._raw.origen||'PANEL'),
        operador: it.operador || (it._raw&&it._raw.operador) || '',
        notas: it._raw&&it._raw.notas||'',
        created_at: it.fecha,
        saldo_post: it.saldo_post!=null ? it.saldo_post : null,
        saldo_pre: it.saldo_pre!=null ? it.saldo_pre : null,
        chunior_movimiento_id: it.chunior_movimiento_id,
        solicitud_id: it.solicitud_id || (it._raw&&it._raw.solicitud_id) || null,
        historial_id: it.historial_id || (it.fuente !== 'SOLICITUD' ? it.id : null) || null,
        _fuente: it.fuente
      });
    });
  } else {
    lista = _historialData.slice();
  }

  if(tipo)    lista = lista.filter(function(h){return normalizar(h.tipo)===normalizar(tipo);});
  if(estado)  lista = lista.filter(function(h){return (h.estado||'')===estado;});
  if(origen)  lista = lista.filter(function(h){return (h.origen||'')===origen;});
  if(bil)     lista = lista.filter(function(h){return (h.billetera_nombre||'')===bil;});
  if(usuario) lista = lista.filter(function(h){return normalizar(h.usuario||'').includes(usuario)||normalizar(h.operador||'').includes(usuario);});
  renderHistorial(lista);
}

function renderHistorial(lista){
  const el = document.getElementById("historialTable");
  if(!el) return;
  if(!lista.length){
    el.innerHTML = '<div class="small" style="text-align:center;padding:20px;color:var(--muted)">Sin operaciones para mostrar.</div>';
    return;
  }

  function origenPill(o){
    const map = {MANUAL:'op-manual',AUTO:'op-auto',PANEL:'op-panel',LANDING:'op-landing',PORTAL:'op-landing'};
    const label = o==='PORTAL'?'PORTAL':(o==='LANDING'?'PORTAL':o);
    return '<span class="origen-pill '+(map[o]||'')+'">'+escapeHtml(label||'?')+'</span>';
  }
  function estadoIcon(e){
    if(e==='OK'||e==='ACREDITADA'||e==='PAGADA'||e==='COMPLETADA'||e==='APROBADA') return '<span style="color:var(--green)">✅</span>';
    if(e==='ERROR') return '<span style="color:var(--red)">❌</span>';
    if(e==='REVERTIDA') return '<span style="color:var(--muted)">↩</span>';
    if(e==='RECHAZADA'||e==='CANCELADA') return '<span style="color:var(--red)">✖</span>';
    if(e==='PENDIENTE'||e==='EN_REVISION'||!e) return '<span style="color:var(--muted);font-size:11px">⏳</span>';
    return '<span style="font-size:11px;color:var(--muted)">'+escapeHtml(e)+'</span>';
  }
  function tipoIcon(t){
    if(t==='CARGA') return '⬆️';
    if(t==='RETIRO') return '⬇️';
    if(t==='CONSULTA') return '👁';
    if(t==='RESET_CLAVE') return '🔑';
    if(t==='MOV_BILLETERA') return '🔀';
    if(t==='CAMBIO_BILLETERA') return '💳';
    if(t==='DEPOSITO_SR') return '💜';
    if(t==='PROPINA') return '🎁';
    if(t==='RECARGA_FICHAS') return '🎰';
    if(t==='GASTO') return '💸';
    return '➡️';
  }

  // La tabla se arma entera en un innerHTML: con el periodo en 30 dias serian miles de <tr>
  // de un saque y la vista se cuelga. Se pintan las mas nuevas y se avisa cuantas quedaron.
  const _TOPE_FILAS = 500;
  const _recortada = lista.length > _TOPE_FILAS;
  const _visibles = _recortada ? lista.slice(0, _TOPE_FILAS) : lista;

  let html = (_recortada
    ? '<div class="alert-box">Mostrando las <b>' + _TOPE_FILAS + '</b> más nuevas de <b>' + lista.length + '</b>. Afiná los filtros o buscá por usuario / N° de movimiento para llegar al resto.</div>'
    : '') +
    '<div class="table-wrap"><table><thead><tr>'+
    '<th>Fecha</th><th>Tipo</th><th>Usuario</th><th>Monto</th><th>Saldo pre</th><th>Saldo post</th>'+
    '<th>Billetera</th><th>Origen</th><th>Estado</th><th>Op</th><th></th>'+
    '</tr></thead><tbody>';

  _visibles.forEach(function(h){
    try{ window._histPorId[String(h.id)] = h; }catch(_e){}
    const rowClass = h.estado==='REVERTIDA'?'hrow-revertida':h.estado==='ERROR'?'hrow-error':
      h.origen==='MANUAL'?'hrow-manual':h.origen==='AUTO'?'hrow-auto':h.origen==='PANEL'?'hrow-panel':'hrow-landing';
    const estadoOkVisual = (h.estado==='OK'||h.estado==='ACREDITADA'||h.estado==='PAGADA'||h.estado==='COMPLETADA'||h.estado==='APROBADA');
    const esOperacionDinero = (h.tipo==='CARGA'||h.tipo==='RETIRO');
    const histAccionId = String(h.historial_id || (h._fuente!=='SOLICITUD' ? h.id : '') || '');
    const puedeAccionarHistorial = esOperacionDinero && (!!histAccionId || (h._fuente==='SOLICITUD' && !!h.solicitud_id));
    const canUndo = estadoOkVisual && puedeAccionarHistorial;
    // 6/10 · Juan, por quinta vez: "no hay billetera registrada si no se realizo la carga".
    // Una fila RECHAZADA no tiene saldo pre, ni saldo post, ni N° de Chunior: la plata nunca se
    // movió. Ofrecer "Cambiar billetera" ahí es ofrecer corregir algo que no existe.
    const _huboMovimiento = !!h.chunior_movimiento_id
      || estadoOkVisual
      || (h.saldo_post !== null && h.saldo_post !== undefined && h.saldo_post !== '');
    const _rechazada = ['RECHAZADA','CANCELADA'].indexOf(String(h.estado||'').toUpperCase()) >= 0;
    const _sidFila = String(h.solicitud_id || (h._fuente === 'SOLICITUD' ? (h.id||'') : '') || '');
    const notasTd = (h.estado==='ERROR' && h.notas)
      ? '<br><span class="small" style="color:#f87171">'+escapeHtml(_errTextoLimpio(h.notas)||_errEtiqueta(h.notas)||'sin detalle')+'</span>'
      : ((h.notas && (h.tipo==='CONSULTA'||h.tipo==='RESET_CLAVE'))
          ? '<br><span class="small">'+escapeHtml(h.notas)+'</span>' : '');
    const undoBtn = canUndo
      ? '<button class="mini-btn yellow" onclick="deshacerOperacion(\x27'+escapeHtml(histAccionId)+'\x27,\x27'+escapeHtml(h.usuario||'')+'\x27,\x27'+h.tipo+'\x27,\x27'+h.monto+'\x27,\x27'+(h.billetera_id||'')+'\x27)" style="font-size:11px">&#8629; Deshacer</button>'
      : '';
    const changeLocalArgs = '\x27'+escapeHtml(histAccionId)+'\x27,\x27'+escapeHtml(String(h.billetera_id||''))+'\x27,\x27'+escapeHtml(String(h.solicitud_id||''))+'\x27';
    const chuniorBtn = h.chunior_movimiento_id
      ? '<button class="mini-btn purple" onclick="cambiarBilleteraMovimiento(\x27'+escapeHtml(String(h.chunior_movimiento_id))+'\x27,\x27'+escapeHtml(histAccionId)+'\x27,\x27'+escapeHtml(String(h.billetera_id||''))+'\x27)" style="font-size:11px" title="Cambiar billetera del Mov. N° '+escapeHtml(String(h.chunior_movimiento_id))+'">💳 Cambiar billetera</button>'
      : ((puedeAccionarHistorial && _huboMovimiento) ? '<button class="mini-btn purple" onclick="cambiarBilleteraHistorialLocal('+changeLocalArgs+')" style="font-size:11px" title="Corregir la billetera donde quedó anotada esta operación">💳 Cambiar billetera</button>' : '');
    const claveBtn = (h.usuario && h.tipo !== 'RESET_CLAVE')
      ? '<button class="mini-btn yellow" onclick="blanquearClaveUsuario(\x27'+escapeHtml(String(h.usuario))+'\x27)" style="font-size:11px" title="Blanquear clave de '+escapeHtml(String(h.usuario))+' a 12345a">🔑 Clave</button>'
      : '';
    // Botón de reintento. Aparece en dos casos:
    //   1) estado ERROR → verifica Drex/Chunior y reintenta lo que falte
    //   2) estado OK pero SIN chunior_movimiento_id y la billetera TIENE chunior_uid
    //      → la carga entró en Drex pero NO se anotó en Chunior (queda diferencia)
    const _bilDeFila = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(h.billetera_id); });
    // [CHUNIOR_OK_SIN_N] = Chunior SÍ aceptó el movimiento, solo no pudimos leer el N° de
    // vuelta (parseo flaky) — no es una falta real, no hay que ofrecer reintentar.
    const chuniorPendiente = (h.estado === 'OK')
      && !h.chunior_movimiento_id
      && !/\[CHUNIOR_OK_SIN_N\]/.test(String(h.notas||''))
      && (h.tipo === 'CARGA' || h.tipo === 'RETIRO')
      && _bilDeFila && _bilDeFila.CHUNIOR_UID;
    const necesitaRetry = (h.estado === 'ERROR' && h.usuario && (h.tipo === 'CARGA' || h.tipo === 'RETIRO')) || chuniorPendiente;
    const retryBtn = necesitaRetry
      ? '<button class="mini-btn red" onclick="reintentarOperacionFallida(\x27'+h.id+'\x27)" style="font-size:11px" title="'+(chuniorPendiente?'Falta anotar en Chunior — reintentar':'Verificar Drex/Chunior y reintentar lo que falte')+'">'+(chuniorPendiente?'⚠️ Falta Chunior':'↻ Reintentar')+'</button>'
      : '';
    // Botón ℹ️ de proceso: solo si hay traza guardada de esa operación en ESTA PC.
    let _hayTraza = false; try{ _hayTraza = !!localStorage.getItem('nodo_traza_hist_'+h.id); }catch(_e){}
    const infoBtn = _hayTraza
      ? '<button class="mini-btn" style="font-size:13px;background:#1e3a5f;color:#7cc4ff;border:1px solid rgba(124,196,255,.45);padding:5px 9px;line-height:1" onclick="verTrazaHistorial(\x27'+h.id+'\x27)" title="Ver el paso a paso del proceso (dónde falló)">ℹ️</button>'
      : '';
    // El detalle arma una ficha de CARGA/RETIRO: monto, saldos, destino, árbol de
    // operaciones. Un CAMBIO_CLAVE o una CONSULTA no tienen nada de eso, y abrirlo mostraba
    // "⬆️ Carga · pruebaxx · $ 0" con el árbol de OTRAS operaciones colgando abajo. No es que
    // falte el dato: no existe el movimiento.
    const _tipoConMovimiento = ["CARGA","RETIRO","MOV_BILLETERA","CAMBIO_BILLETERA",
                                "DEPOSITO_SR","PROPINA","RECARGA_FICHAS","GASTO"];
    // 4/10 · Acá se mezclaban DOS numeraciones distintas y el botón abría otro jugador.
    //
    // Esta lista junta dos cosas: movimientos (historial_ops) y solicitudes del portal
    // (landing_solicitudes). Cada tabla numera por su cuenta y las dos ya van por el 300.000,
    // así que los números se pisan. El botón mandaba h.id a secas; si la fila era una
    // SOLICITUD, el detalle buscaba ese número entre los MOVIMIENTOS y abría el de otra persona.
    //
    // Caso de Juan: solicitud 303566 = juijuh, carga de $2.000. Movimiento 303566 = vero8goat,
    // carga de $4.000. Apretó la lupa de juijuh y se abrió la ficha de vero8goat, con su
    // titular y su árbol de operaciones.
    //
    // La fila ya sabía de dónde venía (_fuente) y ya traía historial_id: nadie los usaba.
    const _histIdSeguro = (h._fuente === 'SOLICITUD') ? '' : String(h.historial_id || h.id || '');
    const _solIdFila    = String(h.solicitud_id || (h._fuente === 'SOLICITUD' ? (h.id||'') : '') || '');
    const detalleBtn = _tipoConMovimiento.indexOf(String(h.tipo||"").toUpperCase()) === -1
      ? ''
      : '<button class="mini-btn" style="font-size:13px;background:#3b2a09;color:#fde68a;border:1px solid rgba(253,230,138,.45);padding:5px 9px;line-height:1" onclick="verDetalleMovimiento(\x27'+escapeHtml(_histIdSeguro)+'\x27,\x27'+escapeHtml(String(h.usuario||''))+'\x27,\x27'+escapeHtml(_solIdFila)+'\x27)" title="Ver el detalle de esta operación">🔍</button>';
    // Anular propina (portado de NexoBetaChan): solo en filas PROPINA con N° de Chunior → pone el monto en 0,10.
    const anularPropBtn = (String(h.tipo||'').toUpperCase()==='PROPINA' && h.chunior_movimiento_id && String(h.estado||'').toUpperCase()!=='ANULADA')
      ? '<button class="mini-btn red" style="font-size:11px" onclick="anularPropinaHistorial(\x27'+escapeHtml(String(h.id))+'\x27)" title="Anular esta propina (pone el monto en 0,10 en Chunior)">🚫 Anular</button>'
      : '';
    const errBtn = (h.estado === 'ERROR')
      ? '<button class="mini-btn" style="font-size:12px;background:#3f1d1d;color:#fca5a5;border:1px solid rgba(248,113,113,.45);padding:5px 9px;line-height:1" onclick="verDetalleError(\x27'+escapeHtml(String(h.id||''))+'\x27)" title="Por qué falló: contexto completo, paso a paso y detalle técnico">🔎 Por qué falló</button>'
      : '';
    // Lo que SÍ se puede hacer con una solicitud rechazada: volver a ponerla en revisión.
    // Juan: "ya podemos recuperarlas... ponelo ahi".
    const recuperarBtn = (_rechazada && _sidFila && esOperacionDinero)
      ? '<button class="mini-btn green" onclick="recuperarSolicitudRechazada(\x27'+escapeHtml(_sidFila)+'\x27,\x27'+escapeHtml(String(h.usuario||''))+'\x27)" style="font-size:11px" title="Volver a ponerla en revisión para resolverla">↺ Recuperar</button>'
      : '';
    const acciones = [errBtn, infoBtn, detalleBtn, recuperarBtn, retryBtn, chuniorBtn, claveBtn, undoBtn, anularPropBtn].filter(Boolean).join(' ') || '-';
    const saldoPreTd = (h.saldo_pre !== null && h.saldo_pre !== undefined && h.saldo_pre !== '')
      ? '<span style="color:#9aa7bd">'+money(h.saldo_pre)+'</span>'
      : '<span class="small">—</span>';
    const saldoPostTd = (h.saldo_post !== null && h.saldo_post !== undefined && h.saldo_post !== '')
      ? '<span style="font-weight:700;color:#7ee07e">'+money(h.saldo_post)+'</span>'
      : '<span class="small">—</span>';
    // Diferenciación visual retiro/carga (como el nodo hermano): 🟠 naranja retiro · 🟢 verde carga
    const _accH = h.tipo==='RETIRO' ? '#fb923c' : h.tipo==='CARGA' ? '#22c55e' : '';
    // 6/10 · Juan: "podemos copiar facilmente el usuario, de lo cual ya casi no nos sirve para
    // nada pero no podemos copiar facilmente el cbu u el alias".
    //
    // El usuario está ahí para leerlo; lo que el operador PEGA es la cuenta, y para eso había que
    // abrir la ficha. Ahora se copia de la fila. Va rotulado a propósito: en un RETIRO es la
    // cuenta del jugador —a donde hay que pagarle— y en una CARGA es la nuestra, a la que
    // transfirió. Copiar la que no era es pagarle a la cuenta equivocada.
    const _cuenta = (window.NodoDomain && window.NodoDomain.identidad)
      ? window.NodoDomain.identidad.destino(h) : null;
    const _cuentaChip = _cuenta
      ? '<br><button type="button" class="mini-btn gray" onclick="portalCopiarCbu(this)"'
        + ' data-valor="'+escapeHtml(_cuenta.valor)+'"'
        + ' title="'+escapeHtml(_cuenta.ayuda+' · '+_cuenta.valor)+'"'
        + ' style="font-size:10px;padding:1px 6px;margin-top:3px;white-space:nowrap">'
        + '<span class="pcopy-ico">📋</span> '+escapeHtml(_cuenta.etiqueta)+'</button>'
      : '';
    html += '<tr class="'+rowClass+'">'+
      '<td style="font-size:12px;white-space:nowrap">'+formatFecha(h.created_at)+'</td>'+
      '<td style="white-space:nowrap'+(_accH?';color:'+_accH+';font-weight:800':'')+'">'+tipoIcon(h.tipo)+' '+escapeHtml(h.tipo||'—')+'</td>'+
      '<td><b>'+escapeHtml(h.usuario||'—')+'</b>'+notasTd+'</td>'+
      '<td style="font-weight:700'+(_accH?';color:'+_accH:'')+'">'+(h.monto?money(h.monto):'—')
        +(function(){ const pr = window._parteRetiro ? window._parteRetiro({ fuente:'OPERACION', tipo:h.tipo, solicitud_id:h.solicitud_id, monto:h.monto, historial_id:h.id, id:h.id, _raw:h }) : null;
            return pr ? '<br><span class="small" style="color:#c084fc;font-weight:800">'+escapeHtml(window._parteRetiroTxt(pr))+'</span>' : ''; })()
        +'</td>'+
      '<td style="font-size:12px;white-space:nowrap">'+saldoPreTd+'</td>'+
      '<td style="font-size:12px;white-space:nowrap">'+saldoPostTd+'</td>'+
      '<td style="font-size:12px">'+escapeHtml(String(h.billetera_nombre||'—').split('·')[0].trim()||String(h.billetera_nombre||'—'))+_cuentaChip+'</td>'+
      '<td>'+origenPill(h.origen)+'</td>'+
      '<td style="white-space:nowrap">'+estadoIcon(h.estado)+((h.estado==='ERROR' && _errEtiqueta(h.notas)) ? (' <span style="font-size:10.5px;font-weight:800;color:#f87171">'+escapeHtml(_errEtiqueta(h.notas))+'</span>') : '')+'</td>'+
      '<td style="font-size:11px;color:var(--muted)">'+escapeHtml(h.operador||'—')+'</td>'+
      '<td style="white-space:nowrap">'+acciones+'</td>'+
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// Reintento INTERACTIVO de una operación con problemas.
// En vez de adivinar si la op se hizo (no siempre tenemos datos confiables para eso),
// le mostramos al operador el estado REAL de cada sistema y lo dejamos decidir:
//   - Chunior: detectable por chunior_movimiento_id (null = NO registrado)
//   - Drex/Agentes: leemos el saldo ACTUAL del jugador y lo mostramos. El operador
//     ve el número y decide si la carga ya está reflejada o falta.
// Deshacer una carga NO siempre significa que el jugador se quedó sin su plata: también se usa
// para borrar una carga duplicada, y ahí la solicitud sigue bien acreditada por la otra fila.
// Esto responde la única pregunta que decide: sacando la fila revertida, ¿queda otra CARGA OK que
// cubra lo que pidió?
function _solicitudQuedoSinPagar(total, filas, idRevertido){
  const t = Math.abs(Number(total)) || 0;
  const cubierto = (filas || []).reduce(function(a, h){
    if(!h) return a;
    if(String(h.id) === String(idRevertido)) return a;
    if(String(h.estado || '').toUpperCase() !== 'OK') return a;
    if(String(h.tipo || '').toUpperCase() !== 'CARGA') return a;
    return a + (Math.abs(Number(h.monto)) || 0);
  }, 0);
  return { sinPagar: !(t > 0 && cubierto >= t - 0.5), cubierto: cubierto };
}
window._solicitudQuedoSinPagar = _solicitudQuedoSinPagar;

// Suelta la solicitud cuando la carga revertida era la única que la sostenía (H-3). Antes esto
// pasaba sólo con los retiros: se le sacaban las fichas al jugador y su pedido seguía diciendo
// "acreditada", así que ni él ni el próximo operador se enteraban.
async function _reabrirSolicitudSiQuedoSinPagar(solicitudId, historialIdRevertido, monto, usuario){
  const sid = String(solicitudId || ''); if(!sid) return;
  try{
    let total = 0;
    try{
      const q = await supabaseClient.from('landing_solicitudes').select('monto, estado').eq('id', sid).maybeSingle();
      const f = (q && q.data && !Array.isArray(q.data)) ? q.data : null;
      total = Math.abs(Number(f && f.monto)) || 0;
      const est = String((f && f.estado) || '').toUpperCase();
      // Si ya no figuraba acreditada, no hay nada que soltar.
      if(est && est !== 'ACREDITADA' && est !== 'PAGADA') return;
    }catch(_e){}

    let filas = [];
    try{
      const q2 = await supabaseClient.from('historial_ops').select('id, monto, estado, tipo').eq('solicitud_id', sid);
      filas = (q2 && Array.isArray(q2.data)) ? q2.data : [];
    }catch(_e){}

    const v = _solicitudQuedoSinPagar(total, filas, historialIdRevertido);
    if(!v.sinPagar){
      toast('La solicitud #'+sid+' sigue acreditada · la cubre otro movimiento de '+money(v.cubierto),'blue');
      return;
    }

    const apFn = (typeof actualizarSolicitudPortal === 'function') ? actualizarSolicitudPortal
               : (typeof window.actualizarSolicitudPortal === 'function' ? window.actualizarSolicitudPortal : null);
    if(!apFn) throw new Error('falta el puente con el portal');
    await apFn(sid, 'EN_REVISION', {
      etapa: 'CARGA_REVERTIDA_PANEL',
      operador: (window.operador && (window.operador.usuario || window.operador.nombre)) || 'panel',
      historial_id: Number(historialIdRevertido) || null,
      motivo: 'Se deshizo la carga de ' + money(Math.abs(Number(monto)) || 0)
    });
    toast('↩ La solicitud #'+sid+' volvió a quedar pendiente · el jugador ya no la ve acreditada','yellow');
    // El jugador tenía un "✅ acreditada" nuestro y ya no es cierto: se lo decimos.
    try{
      if(usuario && typeof notificarUsuarioEnChat === 'function'){
        await notificarUsuarioEnChat(usuario,
          '⚠️ Tu carga de $'+(Math.abs(Number(monto))||0).toLocaleString('es-AR')+' quedó sin efecto y la estamos revisando. Cualquier duda escribinos por acá.');
      }
    }catch(_e){}
    try{ if(typeof cargarSolicitudesPortal === 'function') await cargarSolicitudesPortal(true); }catch(_e){}
  }catch(e){
    toast('⚠ Las fichas volvieron, pero la solicitud #'+sid+' sigue figurando acreditada · '+(e.message||'')+' · corregila a mano','red');
  }
}

// ¿Este pago ya está anotado en el progreso del retiro? Mismo monto y a menos de 10 minutos del
// movimiento. Sin esto, cerrar la solicitud desde el reintento contaría el pago dos veces.
function _pagoYaAnotado(pagos, montoAbs, tFilaMs){
  if(!Array.isArray(pagos) || !pagos.length) return false;
  return pagos.some(function(p){
    if(!p || p.revertido) return false;
    const mismoMonto = Math.abs((Math.abs(Number(p.monto)) || 0) - montoAbs) < 1;
    if(!mismoMonto) return false;
    if(!p.fecha) return true;                      // sin fecha, el monto manda
    const t = new Date(p.fecha).getTime();
    return !isNaN(t) && Math.abs(t - tFilaMs) < 10*60*1000;
  });
}
window._pagoYaAnotado = _pagoYaAnotado;

// Cierra la solicitud cuando el reintento terminó BIEN. Usa los mismos motores que el botón
// Aprobar: para una carga, el mismo estado y los mismos datos; para un retiro, la máquina de
// parciales, que es la única que sabe si quedó saldo pendiente (D-108).
async function _cerrarSolicitudTrasReintento(row, tipo, monto, bil){
  const sid = String((row && row.solicitud_id) || '');
  if(!sid) return;
  const montoAbs = Math.abs(Number(monto)) || 0;
  const operador = (window.operador && (window.operador.usuario || window.operador.nombre)) || 'panel';

  if(String(tipo || '').toUpperCase() !== 'RETIRO'){
    // Mismo puente que usa el botón Aprobar; lo pone portal-bridge, así que se resuelve al usarlo.
    const apFn = (typeof actualizarSolicitudPortal === 'function') ? actualizarSolicitudPortal
               : (typeof window.actualizarSolicitudPortal === 'function' ? window.actualizarSolicitudPortal : null);
    try{
      if(!apFn) throw new Error('falta el puente con el portal');
      await apFn(sid, 'ACREDITADA', {
        etapa: 'PORTAL_COMPLETADA_REINTENTO',
        monto_aprobado: montoAbs,
        historial_id: row.id || null,
        saldo_pre: (row.saldo_pre != null ? row.saldo_pre : null),
        saldo_post: (row.saldo_post != null ? row.saldo_post : null),
        operador: operador,
        billetera_id: bil ? bil.ID_BILLETERA : null,
        billetera_nombre: bil ? bil.NOMBRE_VISIBLE : null
      });
      toast('✓ Solicitud #'+sid+' acreditada · el jugador ya la ve resuelta','green');
    }catch(e){
      toast('⚠ La carga entró pero la solicitud #'+sid+' sigue abierta · '+(e.message||'')+' · cerrala a mano','red');
    }
    return;
  }

  // RETIRO: acá NO se elige el estado. Un retiro puede estar pagándose en partes, así que se anota
  // el pago con el MISMO motor que usa el portal (negocia la firma de la RPC y no reintenta cuando
  // el resultado quedó incierto) y la base decide si queda PAGADA o sigue EN_PROCESO.
  let meta = {}, totalSol = 0;
  try{
    const q = await supabaseClient.from('landing_solicitudes').select('metadata, monto').eq('id', sid).maybeSingle();
    const f = (q && q.data && !Array.isArray(q.data)) ? q.data : null;
    meta = (f && f.metadata) || {};
    totalSol = Math.abs(Number(f && f.monto)) || 0;
  }catch(_e){}
  const pagos = (meta.retiro_parcial && Array.isArray(meta.retiro_parcial.pagos)) ? meta.retiro_parcial.pagos : [];
  const tFila = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  if(_pagoYaAnotado(pagos, montoAbs, tFila)){
    toast('El pago ya estaba anotado en el retiro #'+sid+' · no se cuenta dos veces','blue');
    return;
  }

  const yaPagado = pagos.reduce(function(a,x){ return a + (x && !x.revertido ? (Math.abs(Number(x.monto))||0) : 0); }, 0);
  const total = totalSol || (yaPagado + montoAbs);
  const acum  = yaPagado + montoAbs;
  const resta = Math.max(0, total - acum);
  const motor = (typeof notificarRetiroParcialPortal === 'function') ? notificarRetiroParcialPortal
              : (typeof window.notificarRetiroParcialPortal === 'function' ? window.notificarRetiroParcialPortal : null);
  if(!motor){
    toast('⚠ El retiro salió pero no tengo cómo anotar el pago en la solicitud #'+sid+' · anotalo a mano','red');
    return;
  }
  try{
    const rp = await motor(sid, montoAbs, acum, resta, total,
      (row.saldo_post != null ? Number(row.saldo_post) : null),
      (bil && String(bil.TITULAR || bil.NOMBRE_VISIBLE || '').trim()) || null);
    if(!(rp && rp.ok)) throw new Error((rp && rp.detail) || 'no se pudo anotar el pago');
    toast(resta > 0.5
      ? ('✓ Pago anotado en el retiro #'+sid+' · falta '+money(resta))
      : ('✓ Retiro #'+sid+' quedó saldado · el jugador ya lo ve pagado'), 'green');
  }catch(e){
    toast('⚠ El retiro salió pero la solicitud #'+sid+' sigue abierta · '+(e.message||'')+' · anotá el pago a mano','red');
  }
}

async function reintentarOperacionFallida(historialId){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const { data: row, error } = await supabaseClient
    .from('historial_ops').select('*').eq('id', historialId).single();
  if(error || !row){ toast('No se encontró la fila del historial.', 'red'); return; }
  const { usuario, tipo, monto, billetera_id, billetera_nombre, chunior_movimiento_id, saldo_pre, saldo_post, notas } = row;

  // Resolver billetera (ID → nombre → landing) para Chunior
  let bil = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(billetera_id); });
  if(!bil && billetera_nombre) bil = billeteras.find(function(b){ return String(b.NOMBRE_VISIBLE) === String(billetera_nombre); });
  if(!bil) bil = getBilleraLanding();
  const necesitaChunior = !!(bil && bil.CHUNIOR_UID);
  // [CHUNIOR_OK_SIN_N]: Chunior ya aceptó el movimiento, solo no tenemos el N° — contar como
  // "ya hecho" acá también para no ofrecer re-anotar (evita un duplicado real en Chunior).
  const _chuniorMarcadoSinN = /\[CHUNIOR_OK_SIN_N\]/.test(String(notas||''));
  let chuniorYaHecho     = !!chunior_movimiento_id || _chuniorMarcadoSinN;
  let movChuVerificado   = chunior_movimiento_id;

  // 1) Leer agentes (saldo) Y verificar Chunior EN PARALELO.
  //    - Agentes: buscarUsuario (saldo actual)
  //    - Chunior: si NO tenemos chunior_movimiento_id pero la billetera usa Chunior,
  //      buscamos el movimiento en la lista real (cubre "se anotó pero no se guardó el N°")
  toast('Verificando estado de '+usuario+' en agentes y Chunior...', 'blue');
  if(!await ensureDrexSession()){ toast("Sesión backoffice requerida", "red"); return; }

  _wdLock();
  let b, chuVerif = { existe:false, movimientoId:null };
  try {
    // N° de movimiento ya vinculados a OTRAS ops del historial → no reclamarlos como propios
    // (evita que dos cargas del mismo usuario/monto se atribuyan el mismo N°).
    const _otrosMovIds = ((typeof _historialData!=='undefined' && _historialData) || [])
      .filter(function(x){ return String(x.id)!==String(historialId) && x.chunior_movimiento_id; })
      .map(function(x){ return String(x.chunior_movimiento_id); });
    // Horario de la operación (± ventana) para DESAMBIGUAR entre varias cargas del mismo
    // usuario/monto. Sin esto (antes iba null,null) dos cargas iguales matcheaban cualquiera
    // → duplicados y verificaciones erróneas. La carga y su anotación en Chunior pasan casi
    // juntas → ventana CORTA (±2min) = match más preciso, menos falsos. Si la fila no trae
    // created_at, _tOpMs=null y la función vuelve al comportamiento sin filtro (no rompe).
    const _tOpMs = row.created_at ? new Date(row.created_at).getTime() : null;
    const verifChuniorPromise = (necesitaChunior && !chuniorYaHecho)
      ? verificarMovimientoEnChunior(usuario, monto, _tOpMs, 2*60*1000, _otrosMovIds)   // usuario + monto + HORARIO (±2min)
      : Promise.resolve({ existe:false, movimientoId:null });
    // Agentes y Chunior usan ventanas distintas → realmente en paralelo
    const [bRes, chuRes] = await Promise.all([
      callDrex("buscarUsuario", usuario),
      verifChuniorPromise
    ]);
    b = bRes;
    chuVerif = chuRes || { existe:false, movimientoId:null };
  } catch(e){
    _wdUnlock(); toast('Error verificando: '+(e.message||''), 'red'); return;
  }
  _wdUnlock();
  if(!b || !b.exists){ toast('Usuario '+usuario+' no encontrado en agentes', 'red'); return; }
  const saldoActual = (typeof b.balance?.value === 'number') ? b.balance.value : null;

  // Si la verificación en vivo encontró el movimiento → Chunior ya está hecho
  if(chuVerif.existe){
    chuniorYaHecho = true;
    if(chuVerif.movimientoId) movChuVerificado = chuVerif.movimientoId;
  }

  // 2) Inferir si Drex ya hizo la op (solo si tenemos referencia confiable)
  //    saldo esperado si la op se hizo = saldo_pre ± monto
  const m = Number(monto);
  const signo = tipo === 'CARGA' ? 1 : -1;
  let drexInferido = 'desconocido'; // 'hecho' | 'pendiente' | 'desconocido'
  if(saldoActual !== null && saldo_pre !== null && saldo_pre !== undefined){
    const esperadoHecho     = Number(saldo_pre) + signo * m;
    const esperadoPendiente = Number(saldo_pre);
    if(Math.abs(saldoActual - esperadoHecho) < 1)        drexInferido = 'hecho';
    else if(Math.abs(saldoActual - esperadoPendiente) < 1) drexInferido = 'pendiente';
  } else if(saldoActual !== null && saldo_post !== null && saldo_post !== undefined){
    if(Math.abs(saldoActual - Number(saldo_post)) < 1) drexInferido = 'hecho';
  }

  // 3) Modal con el estado real + checkboxes para decidir
  const drexBadge = drexInferido === 'hecho'
      ? '<span style="color:#7ee07e">✓ Parece HECHO</span>'
      : drexInferido === 'pendiente'
        ? '<span style="color:var(--red)">✗ Parece PENDIENTE</span>'
        : '<span style="color:#e0c070">? No se pudo inferir</span>';
  const chuniorBadge = chuniorYaHecho
      ? '<span style="color:#7ee07e">✓ Registrado'+(movChuVerificado?' (N° '+escapeHtml(String(movChuVerificado))+')':' (verificado en lista)')+'</span>'
      : (necesitaChunior ? '<span style="color:var(--red)">✗ NO registrado</span>' : '<span style="color:var(--muted)">N/A (billetera sin Chunior)</span>');

  const body =
    '<div style="font-size:13px;line-height:1.6;color:#c0cad8">' +
      '<b>'+escapeHtml(usuario)+'</b> · '+tipo+' de '+money(m)+'<br><br>' +
      '<div style="background:#0e1525;padding:10px;border-radius:10px;margin-bottom:12px">' +
        '💰 Saldo actual en agentes: <b style="color:#fff">'+(saldoActual!==null?money(saldoActual):'—')+'</b><br>' +
        (saldo_pre!=null ? '↳ Saldo antes de la op: '+money(saldo_pre)+'<br>' : '') +
        '↳ Agentes: '+drexBadge+'<br>' +
        '↳ Chunior: '+chuniorBadge +
      '</div>' +
      '<div style="font-weight:700;margin-bottom:6px">¿Qué querés reintentar?</div>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer">' +
        '<input type="checkbox" id="retryDrex" '+(drexInferido==='pendiente'?'checked':'')+' style="width:16px;height:16px"> ' +
        'Cargar/retirar en <b>agentes</b> '+(drexInferido==='hecho'?'<span style="color:var(--red);font-size:11px">(¡cuidado, parece hecho — duplicaría!)</span>':'')+
      '</label>' +
      (necesitaChunior && !chuniorYaHecho ?
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
        '<input type="checkbox" id="retryChunior" checked style="width:16px;height:16px"> ' +
        'Anotar en <b>Chunior</b> ('+escapeHtml(bil.NOMBRE_VISIBLE||'')+')' +
      '</label>' : '') +
    '</div>';

  abrirModal('↻ Reintentar '+tipo, body, async function(){
    const hacerDrex    = document.getElementById('retryDrex')?.checked;
    const hacerChunior = document.getElementById('retryChunior')?.checked;
    cerrarModal();

    let drexOk = drexInferido === 'hecho', movChu = movChuVerificado;

    // Drex
    if(hacerDrex){
      toast('Reintentando '+tipo+' en agentes...', 'blue');
      _wdLock();
      try {
        // Re-posicionar la página de agentes en una búsqueda FRESCA del usuario
        // justo antes de cargar. Esto replica el flujo normal (buscar → cargar
        // pegados, sin gap) y evita que cargarSaldo corra sobre un estado sucio
        // que quedó de la lectura de saldo al abrir el modal (por eso antes
        // fallaba la 1ª vez y andaba la 2ª).
        const bb = await callDrex("buscarUsuario", usuario, { skipBalance: true });
        if(!bb || !bb.exists){
          toast('✗ Usuario no encontrado al reintentar en agentes', 'red');
        } else {
          const r = (tipo === 'CARGA')
            ? await callDrex("cargarSaldo", m)
            : await callDrex("retirarSaldo", m);
          if(r && r.ok !== false){ drexOk = true; toast('✓ '+tipo+' OK en agentes', 'green'); }
          else toast('✗ Agentes falló: '+(r?.message||''), 'red');
        }
      } catch(e){ toast('Error en agentes: '+(e.message||''), 'red'); }
      finally { _wdUnlock(); }
    }

    // Chunior
    if(hacerChunior && necesitaChunior){
      toast('Anotando en Chunior...', 'blue');
      try {
        const rChu = (tipo === 'CARGA')
          ? await registrarCargaEnChunior(bil.CHUNIOR_UID, m, usuario)
          : await registrarRetiroEnChunior(bil.CHUNIOR_UID, m, usuario);
        if(rChu && rChu.ok && rChu.movimientoId){ movChu = rChu.movimientoId; toast('✓ Chunior N° '+rChu.movimientoId, 'green'); }
        else toast('✗ Chunior: '+(rChu?.error||'falló'), 'red');
      } catch(e){ toast('Error Chunior: '+(e.message||''), 'red'); }
    }

    // Actualizar fila
    const chuOk = !!movChu || !necesitaChunior;
    const nuevoEstado = (drexOk && chuOk) ? 'OK' : 'ERROR';
    try {
      await supabaseClient.from('historial_ops').update({
        estado: nuevoEstado,
        chunior_movimiento_id: movChu,
        notas: 'Reintento manual ['+new Date().toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit'})+']'
      }).eq('id', historialId);
    } catch(e){ console.warn('update reintento:', e); }

    toast(nuevoEstado==='OK' ? '🎉 Reintento OK' : '⚠️ Reintento parcial', nuevoEstado==='OK'?'green':'yellow');
    // MISMO DESENLACE, MISMAS CONSECUENCIAS: la luz verde cierra la solicitud, venga del botón
    // Aprobar o del reintento. Antes el reintento movía la plata y dejaba la solicitud abierta: el
    // jugador seguía viendo su pedido sin resolver y el operador la volvía a trabajar (D-108).
    if(nuevoEstado === 'OK' && row.solicitud_id){
      await _cerrarSolicitudTrasReintento(row, tipo, monto, bil);
    }
    await cargarHistorial();
    if(movChu) _watchdogTrigger(1500);
  }, 'Ejecutar reintento');
}

// ── Recuperar una solicitud rechazada ─────────────────────────────────────────────────────
// Juan, 6/10: "rechazadas con cambio de billetera, inescesario, ya podemos recuperarlas".
//
// Una rechazada no tiene billetera que corregir —nunca se movió plata— pero sí tiene algo que
// hacer: volver a ponerla en revisión y resolverla. Eso es lo que va en esa fila.
//
// NO se borra el motivo del rechazo: queda guardado como `motivo_previo` junto con quién la
// recuperó y cuándo. El historial de por qué se rechazó es justamente lo que faltaba (4/10);
// recuperarla no puede ser la forma de perderlo.
window.recuperarSolicitudRechazada = async function(solicitudId, usuario){
  const sid = Number(solicitudId||0);
  if(!sid){ try{ toast("No pude identificar la solicitud","red"); }catch(_e){} return; }
  const quien = (window.operador && (window.operador.usuario || window.operador.nombre)) || "";

  let motivoPrevio = "";
  try{
    const sols = (window.V154P && window.V154P.solicitudes) || [];
    const sol = sols.find(function(x){ return String(x.ID||x.SOLICITUD_ID||"") === String(sid); });
    const mt = (sol && (sol.metadata || sol.METADATA)) || {};
    motivoPrevio = String(mt.motivo || mt.motivo_rechazo || "").trim();
  }catch(_e){}

  if(!confirm("¿Recuperar la solicitud #"+sid+(usuario?(" de "+usuario):"")+"?\n\n"
      + (motivoPrevio ? ("Se había rechazado: "+motivoPrevio+"\n\n") : "")
      + "Vuelve a la bandeja en revisión para resolverla.")) return;

  const actualizar = (typeof actualizarSolicitudPortal === "function")
    ? actualizarSolicitudPortal
    : (typeof window.actualizarSolicitudPortal === "function" ? window.actualizarSolicitudPortal : null);
  if(!actualizar){ try{ toast("No encontré cómo actualizar la solicitud","red"); }catch(_e){} return; }

  try{
    const r = await actualizar(sid, "EN_REVISION", {
      recuperada_por: quien,
      recuperada_at: new Date().toISOString(),
      motivo_previo: motivoPrevio || null,
      motivo: null,            // deja de estar rechazada: el motivo viejo queda en motivo_previo
      motivo_rechazo: null
    });
    if(r && r.error) throw new Error(r.error.message || "no se pudo");
    try{ toast("↺ Solicitud #"+sid+" recuperada — está en la bandeja","green"); }catch(_e){}
    try{ if(typeof cargarSolicitudesPortal === "function") await cargarSolicitudesPortal(true); }catch(_e){}
    try{ if(typeof filtrarHistorial === "function") filtrarHistorial(); }catch(_e){}
  }catch(e){
    try{ toast("No se pudo recuperar: "+(e.message||e),"red"); }catch(_e){}
  }
};

async function deshacerOperacion(id, usuario, tipoOriginal, monto, bilId){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  if(!confirm("¿Revertir "+tipoOriginal+" de "+money(Number(monto))+" para "+usuario+"?")) return;

  const tipoReversion = tipoOriginal==='CARGA'?'RETIRO':'CARGA';
  const montoNum = Number(monto);
  const bil = billeteras.find(function(b){return String(b.ID_BILLETERA)===String(bilId);})||getBilleraLanding();

  toast("Procesando reversión...","blue");
  try {
    if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

    await callDrex("buscarUsuario", usuario);
    let r;
    if(tipoReversion==='CARGA') r = await callDrex("cargarSaldo", montoNum);
    else r = await callDrex("retirarSaldo", montoNum);

    const ok = r && r.ok !== false;

    // La reversión también genera su movimiento espejo en Chunior para mantener el ledger.
    let movChu = null;
    const usaChunior = !!(bil && bil.CHUNIOR_UID);
    if(ok && usaChunior){
      toast("Anotando reversión en Chunior...","blue");
      try {
        const rChu = (tipoReversion==='CARGA')
          ? await registrarCargaEnChunior(bil.CHUNIOR_UID, montoNum, usuario)
          : await registrarRetiroEnChunior(bil.CHUNIOR_UID, montoNum, usuario);
        if(rChu && rChu.ok && rChu.movimientoId){ movChu = rChu.movimientoId; toast("✓ Chunior N° "+rChu.movimientoId,"green"); }
        else toast("✗ Chunior: "+(rChu?.error||"no se generó el movimiento"),"red");
      } catch(e){ toast("Error Chunior: "+(e.message||""),"red"); }
    }

    const chuOk = !!movChu || !usaChunior;
    await supabaseClient.from("historial_ops").update({estado:"REVERTIDA"}).eq("id", id);
    await registrarEnHistorial({usuario, tipo:tipoReversion, monto:montoNum,
      billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null,
      origen:'MANUAL', estado:(ok&&chuOk)?'OK':'ERROR',
      notas:"Reversión de "+tipoOriginal, reversion_de:id, chunior_movimiento_id:movChu});

    if(ok && bil && bil.ID_BILLETERA) await ajustarSaldoBilletera(bil.ID_BILLETERA, tipoReversion==='CARGA'?montoNum:-montoNum);

    // Es el MISMO movimiento: si se deshace un pago de un retiro por partes, el progreso tiene que
    // retroceder. La reversión devolvía las fichas, el movimiento de Chunior y la plata a la
    // billetera, pero NO tocaba la solicitud: el retiro seguía figurando pagado y la caja mostraba
    // un progreso que ya no existía (D-105). El pago queda marcado como revertido, no se borra.
    let _sidRev = null;
    try{
      const _fila = (window._histPorId||{})[String(id)]
        || ((typeof _historialData!=='undefined' && _historialData) || []).find(function(h){ return String(h.id)===String(id); });
      if(_fila && _fila.solicitud_id) _sidRev = String(_fila.solicitud_id);
    }catch(_e){}
    if(ok && _sidRev && String(tipoOriginal||'').toUpperCase()==='RETIRO'){
      try{
        const rRev = await supabaseClient.rpc('landing_retiro_revertir_parcial', {
          p_id: Number(_sidRev), p_monto: montoNum,
          p_operador: (window.operador&&(window.operador.usuario||window.operador.nombre))||'panel',
          p_historial_id: Number(id)||null
        });
        if(rRev && rRev.error){
          toast('⚠ La plata volvió, pero el retiro #'+_sidRev+' quedó marcado como pagado · '+(rRev.error.message||'')+' · corregilo a mano','red');
        }else{
          const d = Array.isArray(rRev&&rRev.data) ? rRev.data[0] : (rRev&&rRev.data);
          toast('↩ Retiro #'+_sidRev+' volvió a quedar pendiente · falta '+money(Number((d&&d.restante)||0)),'yellow');
          try{ if(typeof cargarSolicitudesPortal==='function') await cargarSolicitudesPortal(true); }catch(_e){}
        }
      }catch(e){
        toast('⚠ La plata volvió, pero no se pudo actualizar el retiro #'+_sidRev+' · '+(e.message||'')+' · corregilo a mano','red');
      }
    }
    // Y la carga, lo mismo: es el MISMO movimiento. Si la revertida era la única que sostenía la
    // solicitud, el pedido del jugador vuelve a quedar abierto (H-3).
    if(ok && _sidRev && String(tipoOriginal||'').toUpperCase()==='CARGA'){
      await _reabrirSolicitudSiQuedoSinPagar(_sidRev, id, montoNum, usuario);
    }
    toast((ok&&chuOk)?'Reversión completada OK':'Reversión con errores — revisar',(ok&&chuOk)?'green':'red');
    await window.ctrlElectron.navigateAgent();
    await cargarHistorial();
    renderBillerasInicio();
    poblarManualBilletera();
  } catch(e) { toast("Error: "+(e.message||"sin detalle"),"red"); }
}
// ════════════════════════════════════════════════════════════════════════════
