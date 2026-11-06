function _blEsParcial(r){ return /PARCIAL/i.test(String((r&&r.notas)||'')); }
function _blFmtGap(ms){ if(ms==null) return ''; const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000); return (h>0?h+'h':'')+(m>0?(h>0?' ':'')+m+'min':'')||'0min'; }
function _blIsoDay(offset){ const d=new Date(); d.setDate(d.getDate()-(offset||0)); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// Ventana de 24hs en ms: la usa el fetch (retrovisor del modo día) y el gap pareado.
// var y no const: se referencia desde muy abajo del mismo script; si algo tira arriba,
// var sigue resolviendo por window en vez de quedar muerto en TDZ.
var _BL_H24 = 24*60*60*1000;

async function verificarRetiro24h(usuario) {
  const health = window.NodoSalud?.begin('RETIROS');
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
  const ahora   = Date.now();
  const usuarioNorm = normalizar(usuario);
  const candidatos  = [];
  // ilike sin comodines = match exacto SIN distinguir mayúsculas. Los retiros quedan guardados a
  // veces "Cristina0735" y a veces "cristina0735" (portal vs form manual) — con .eq el bloqueo 24h
  // no los cruzaba y el usuario podía retirar dos veces. Escapamos %/_ del patrón (portado de tu nodo).
  const _uPat = String(usuario).replace(/[\\%_]/g, function(c){ return '\\'+c; });

  // 1. Retiros del PORTAL. Antes esto miraba la tabla `solicitudes`, muerta desde el 30 de mayo:
  //    la fuente 1 del chequeo de 24 h no devolvía nunca nada. La regla igual funcionaba por la
  //    fuente 2 (historial_ops), pero un retiro del portal sin fila en el historial se colaba.
  // Si una fuente no contesta, "no encontré nada" no es "no hay": el semáforo lo tiene que decir.
  let _fuenteFallo = false;
  try {
    const { data: dataSol, error: _eSol } = await supabaseClient
      .from("landing_solicitudes")
      .select("id, created_at, monto")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      .in("estado", ["PAGADA", "APROBADA", "ACREDITADA"])
      .gte("created_at", new Date(hace24h).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if(_eSol || !Array.isArray(dataSol)) _fuenteFallo = true;
    if(Array.isArray(dataSol) && dataSol.length)
      candidatos.push({ created_at: dataSol[0].created_at, monto: dataSol[0].monto, billetera_nombre: null, origen: "SOLICITUD" });
  } catch(_){ _fuenteFallo = true; }

  // 2. Buscar en historial_ops (retiros del form manual, chat rápido)
  try {
    const { data: dataH, error: _eH } = await supabaseClient
      .from("historial_ops")
      .select("id, created_at, monto, billetera_nombre, notas")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      .eq("estado", "OK")
      .gte("created_at", new Date(hace24h).toISOString())
      .order("created_at", { ascending: false })
      .limit(8);
    // Excluir PARCIALES (tramos de un retiro grande) y los marcados [BL_EXCLUIDO]: no son un
    // retiro separado → tomamos el retiro REAL más reciente (no parcial, no excluido).
    const dhReal = (dataH||[]).find(function(r){ return !_blEsParcial(r) && !/\[BL_EXCLUIDO\]/.test(String(r.notas||'')); });
    if(_eH || !Array.isArray(dataH)) _fuenteFallo = true;
    if(dhReal)
      candidatos.push({ created_at: dhReal.created_at, monto: dhReal.monto, billetera_nombre: dhReal.billetera_nombre || null, origen: "HISTORIAL" });
  } catch(_){ _fuenteFallo = true; }

  // 3. Buscar en CSV importado (últimas 24h)
  if(retiros24hCSV && retiros24hCSV.length){
    const retiroCSV = retiros24hCSV.find(r => normalizar(r.alias) === usuarioNorm);
    if(retiroCSV){
      const t = ahora - new Date(retiroCSV.fecha).getTime();
      if(t < 24 * 60 * 60 * 1000)
        candidatos.push({ created_at: retiroCSV.fecha, monto: retiroCSV.monto, billetera_nombre: null, origen: "CSV" });
    }
  }

  if(candidatos.length) health?.record('DATA', _fuenteFallo?'DEGRADED':'OK',
    _fuenteFallo?'RETIRO_24H_MATCH_PARCIAL':'RETIRO_24H_MATCH');
  else health?.record('DATA', _fuenteFallo ? 'DEGRADED' : 'OK', _fuenteFallo ? 'RETIRO_24H_SIN_COMPROBAR' : 'RETIRO_24H_CLEAR');
  if(!candidatos.length) return { bloqueado: false };

  // Tomar el retiro más reciente de cualquier fuente
  candidatos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const retiro = candidatos[0];

  const elapsed       = ahora - new Date(retiro.created_at).getTime();
  const horasElapsed  = Math.floor(elapsed / (60 * 60 * 1000));
  const minsElapsed   = Math.floor((elapsed % (60 * 60 * 1000)) / 60000);
  const horasRestantes= Math.ceil((24 * 60 * 60 * 1000 - elapsed) / (60 * 60 * 1000));
  const proximoRetiro = new Date(new Date(retiro.created_at).getTime() + 24 * 60 * 60 * 1000);

  return {
    bloqueado:        true,
    advertencia:      true,
    usuario,
    horasRestantes,
    monto:            retiro.monto,
    fecha:            retiro.created_at,
    proximoRetiro:    proximoRetiro.toISOString(),
    billetera_nombre: retiro.billetera_nombre || null,
    origen:           retiro.origen,
    mensaje:          `${usuario} ya retiró hace ${horasElapsed}h${minsElapsed > 0 ? ' ' + minsElapsed + 'min' : ''} · puede volver a las ${formatFecha(proximoRetiro.toISOString())}`
  };
}

// Modal de confirmación de retiro duplicado.
// Muestra los detalles del retiro anterior y pregunta si proceder.
// Devuelve Promise<true> si el operador elige proceder, Promise<false> si cancela.
function confirmarRetiroDuplicado(check) {
  return new Promise(function(resolve) {
    const fechaRet  = escapeHtml(formatFecha(check.fecha));
    const horaOk    = escapeHtml(formatFecha(check.proximoRetiro));
    const bilInfo   = check.billetera_nombre
      ? '<br><span class="small" style="color:#e0c070">Billetera: <b>' + escapeHtml(check.billetera_nombre) + '</b></span>'
      : '';

    const body =
      '<div class="alert-box" style="line-height:1.7;margin-bottom:14px">' +
        '<b>⚠️ Retiro en las últimas 24hs</b><br><br>' +
        '<b>' + escapeHtml(check.usuario || '') + '</b> ya realizó un retiro:<br>' +
        '📅 Retiro anterior: <b>' + fechaRet + '</b><br>' +
        '🕐 Habilitado nuevamente: <b>' + horaOk + '</b><br>' +
        '💰 Monto anterior: <b>' + money(check.monto) + '</b>' + bilInfo +
      '</div>' +
      '<p style="color:#c0cad8;font-size:13px">Podés proceder si verificaste el caso del usuario.</p>';

    abrirModal('⚠️ Retiro en 24hs', body, null, 'Proceder igualmente');

    var saveBtn   = document.getElementById('modalSaveBtn');
    var cancelBtn = document.querySelector('#modalOverlay .btn-gray');

    function limpiarHandlers(){
      // Restaurar el modal a estado neutro para que el próximo abrirModal funcione limpio
      if(saveBtn)   saveBtn.onclick   = null;
      if(cancelBtn) cancelBtn.onclick = function(){ cerrarModal(); };
    }

    if(saveBtn) saveBtn.onclick = function(){
      limpiarHandlers();
      cerrarModal();
      resolve(true);
    };
    if(cancelBtn) cancelBtn.onclick = function(){
      limpiarHandlers();
      cerrarModal();
      resolve(false);
    };
  });
}

function esPendiente(s){const e=normalizar(s.ESTADO);return e.includes("PENDIENTE")||e==="NUEVA"||e==="NUEVO"||e==="EN_REVISION"}

// ── Sistema de lealtad ────────────────────────────────────────────────────────
// Lógica: el volumen exitoso pesa más que los rechazos.
// Los rechazos penalizan según su TASA (rechazados/total), no su cantidad absoluta.
// Ejemplo: 500 exitosas + 20 rechazadas → tasa 3.8% → penalización mínima → score alto.
function calcularLealtad(usuarioNombre){
  const todas = solicitudes.filter(s=>normalizar(s.USUARIO||s.USUARIO_JUGADOR||"")===normalizar(usuarioNombre));
  const aprobadas  = todas.filter(esRealizada).length;
  const rechazadas = todas.filter(s=>normalizar(s.ESTADO)==="RECHAZADA").length;
  const totalOps   = aprobadas + rechazadas;
  const totalMonto = todas.filter(esRealizada).reduce((a,s)=>a+Number(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO||0),0);

  if(totalOps===0) return {score:5,nivel:"Nuevo",color:"muted",aprobadas:0,rechazadas:0,tasa:100,totalMonto:0};

  const tasaExito  = aprobadas/totalOps;                        // 0–1

  // Volumen: logarítmico, tope 35 pts. 10 ops → ~17pts, 100 ops → ~35pts, 500 → 35pts
  const volScore   = Math.min(Math.log10(aprobadas+1)*17.5, 35);

  // Tasa de éxito: pesa 45 pts — el factor más importante
  const rateScore  = tasaExito * 45;

  // Monto total operado: logarítmico, tope 20 pts
  const montoScore = Math.min(Math.log10(totalMonto/1000+1)*10, 20);

  const score = Math.round(Math.min(volScore+rateScore+montoScore, 100));

  let nivel,color;
  if(score<15){nivel="Nuevo";color="muted"}
  else if(score<35){nivel="Regular";color="blue"}
  else if(score<55){nivel="Confiable";color="green"}
  else if(score<75){nivel="Preferencial";color="purple"}
  else{nivel="VIP";color="yellow"}

  return {score,nivel,color,aprobadas,rechazadas,tasa:Math.round(tasaExito*100),totalMonto};
}

function scoreBadge(usuarioNombre){
  const l=calcularLealtad(usuarioNombre);
  const colores={muted:"#667085",blue:"#3d5afe",green:"#12b76a",purple:"#7c3aed",yellow:"#fdb022"};
  const bg={muted:"#2a2f3b",blue:"#16235f",green:"#11371f",purple:"#2e1a5e",yellow:"#3d2d00"};
  const color=colores[l.color]||colores.muted;
  const bgc=bg[l.color]||bg.muted;
  return `<span title="${l.aprobadas} aprobadas · ${l.rechazadas} rechazadas · ${l.tasa}% éxito" style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${bgc};color:${color};cursor:help">${l.score}</span>`;
}
function esRealizada(s){const e=normalizar(s.ESTADO);return ["APROBADA_MANUAL","APROBADA_MANUAL_OK","ACREDITADA","PAGADA","APROBADA"].includes(e)}
function estadoBadge(e){const x=normalizar(e);if(esRealizada({ESTADO:e}))return`<span class="badge badge-ok">${e}</span>`;if(["RECHAZADA","ERROR"].includes(x))return`<span class="badge badge-danger">${e}</span>`;return`<span class="badge badge-pending">${e||"-"}</span>`}
function escapeHtml(text){return String(text||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

