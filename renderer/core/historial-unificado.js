// HISTORIAL UNIFICADO + SELECCIÓN EN LOTE + BLACKLIST + CACHÉ LOCAL
// ════════════════════════════════════════════════════════════════════════════
let _seleccionLote = new Set();

// Movimientos que se hacen EN Chunior y no nacen de una solicitud del portal. Hasta ahora sólo
// se veían en el Historial de Inicio y con el tipo crudo en mayúsculas ("DEPOSITO_SR").
// Medido en 30 días: 666 movimientos de estos, de los cuales el panel mostraba 21.
// Los movimientos que se anotan EN Chunior. CONSULTA y RESET_CLAVE quedan afuera a proposito:
// no pasan por Chunior (D-38) y las consultas no hace falta ni guardarlas ni filtrarlas —
// siguen viendose en "Todas" y en el historial de Inicio, que es donde sirven.
const TIPOS_CHUNIOR = ["MOV_BILLETERA","CAMBIO_BILLETERA","DEPOSITO_SR","PROPINA","RECARGA_FICHAS"];
const _ETIQUETA_TIPO = {
  MOV_BILLETERA:    "🔀 TRANSFERENCIA",
  CAMBIO_BILLETERA: "💳 CAMBIO BILLETERA",
  DEPOSITO_SR:      "💜 DEPÓSITO S/RECLAMAR",
  PROPINA:          "🎁 PROPINA",
  RECARGA_FICHAS:   "🎰 RECARGA FICHAS",
  RESET_CLAVE:      "🔑 CAMBIO DE CLAVE",
  CONSULTA:         "🔍 CONSULTA",
  COMBINACION:      "🧩 COMBINACIÓN",
  MOVER_RETIRO:     "📦 MOVER RETIRO",
  FALTANTE:         "⚠️ FALTANTE",
  CREAR_DEPO:       "➕ CREAR DEPÓSITO",
  MANUAL:           "✋ MANUAL"
};
function _tipoEtiqueta(t){
  const k = String(t||"").toUpperCase();
  return _ETIQUETA_TIPO[k] || escapeHtml(k || "—");
}
function _esTipoChunior(t){ return TIPOS_CHUNIOR.includes(String(t||"").toUpperCase()); }
// Hay gente que deja el portal abierto, nosotros cambiamos la billetera activa, y la persona
// manda la solicitud SIN refrescar: transfirió a la billetera anterior. La solicitud llega con
// esa billetera vieja adentro, pero el operador sólo ve la activa y no se entera hasta abrir
// el desplegable. Medido: 271 cargas en 7 días (1,39 %) llegan asi.
// Sólo se avisa mientras la solicitud sigue abierta: es el momento en que sirve. En una ya
// cerrada la billetera activa cambió mil veces y el aviso seria ruido.
function _billeteraVieja(it){
  try{
    if(!it) return null;
    // Sirve para las dos formas que andan dando vueltas: el item del historial unificado
    // (claves en minúscula) y la solicitud cruda del portal (MAYÚSCULAS). Antes sólo
    // entendía la primera, así que la tarjeta del Inicio —que es donde el operador decide—
    // nunca mostraba el aviso.
    const crudo = it._raw || it;
    const tipo = String(it.tipo || it.TIPO || it.TIPO_SOLICITUD ||
                        crudo.TIPO || crudo.TIPO_SOLICITUD || "").toUpperCase();
    if(tipo !== "CARGA") return null;              // en un retiro pagamos nosotros: no aplica

    // Abierta: o lo dice el item, o se deduce del estado.
    const estado = String(it.estado || it.ESTADO || crudo.ESTADO || "").toUpperCase();
    const abierta = (it.pendiente === true) ||
      (it.pendiente === undefined && estado !== "" &&
       ["ACREDITADA","PAGADA","APROBADA","RECHAZADA","CANCELADA","CERRADA","CERRADO",
        "FINALIZADA","OK","COMPLETADA","REVERTIDA"].indexOf(estado) === -1);
    if(!abierta) return null;                      // ya cerrada: la activa cambió mil veces

    if(typeof getBilleraLanding !== "function") return null;
    const activa = getBilleraLanding();
    if(!activa) return null;

    const idSol  = String(it.billetera_id || it.ID_BILLETERA || crudo.ID_BILLETERA || "").trim();
    const nomSol = String(it.billetera_nombre || it.BILLETERA_NOMBRE || crudo.BILLETERA_NOMBRE || "").trim();
    const idAct  = String(activa.ID_BILLETERA || "").trim();
    const nomAct = String(activa.NOMBRE_VISIBLE || "").trim();
    if(!nomSol && !idSol) return null;             // sin dato no se inventa un aviso

    const mismo = (idSol && idAct) ? (idSol === idAct)
                                   : (nomSol.toUpperCase() === nomAct.toUpperCase());
    if(mismo) return null;
    return { vieja: nomSol || idSol, actual: nomAct || idAct };
  }catch(_e){ return null; }
}

window._billeteraVieja = _billeteraVieja;

function _esTipoClave(t){
 const k=String(t||"").toUpperCase(); return k==="CAMBIO_CLAVE" || k==="RESET_CLAVE"; }
// La clave nueva viaja en el metadata del portal o, en las manuales, dentro de notas como
// "clave → xxxx". En la lista es EL dato de la operación: sin eso la tarjeta mostraba un "—".
function _claveDeItem(it){
  try{
    const r = (it && it._raw) || {};
    let meta = r.METADATA !== undefined ? r.METADATA : (r.metadata || {});
    if(typeof meta === "string"){ try{ meta = JSON.parse(meta); }catch(_e){ meta = {}; } }
    const directa = String(r.PASSWORD_NUEVO || (meta && meta.password_nuevo) || "").trim();
    if(directa) return directa;
    const m = String(r.notas || r.NOTAS || "").match(/clave\s*(?:→|->|:)\s*(\S+)/i);
    return m ? m[1] : "";
  }catch(_e){ return ""; }
}

// Filas traídas por la búsqueda contra el servidor (fuera de la ventana cargada).
window._histBusquedaServidor = window._histBusquedaServidor || [];
let _histUnificadoCache = [];

function construirHistorialUnificado(){
  const items = [];
  const rawHist = (typeof _historialData !== 'undefined' && _historialData && _historialData.length)
    ? _historialData
    : ((typeof window !== 'undefined' && window._historialData) || []);
  const rawSol = (typeof solicitudes !== 'undefined' && solicitudes && solicitudes.length)
    ? solicitudes
    : ((typeof window !== 'undefined' && (window.solicitudes || (window.V154P && window.V154P.solicitudes))) || []);

  // Mapas desde historial_ops para relacionar solicitud portal ↔ operación real.
  const _saldoPrePorSolicitud = {};
  const _saldoPostPorSolicitud = {};
  const _operadorPorSolicitud = {};
  const _movPorSolicitud = {};
  const _historialIdPorSolicitud = {};
  const _historialIdSet = new Set();

  rawHist.forEach(function(h){
    if(h && h.id!=null) _historialIdSet.add(String(h.id));
    if(h.solicitud_id==null) return;
    const k = String(h.solicitud_id);
    if(h.saldo_pre!=null)  _saldoPrePorSolicitud[k]  = h.saldo_pre;
    if(h.saldo_post!=null) _saldoPostPorSolicitud[k] = h.saldo_post;
    if(h.operador) _operadorPorSolicitud[k] = h.operador;
    if(h.chunior_movimiento_id) _movPorSolicitud[k] = h.chunior_movimiento_id;
    if(h.id!=null) _historialIdPorSolicitud[k] = h.id;
  });

  rawSol.forEach(function(s){
    const tipo = normalizar(s.TIPO_SOLICITUD||s.TIPO);
    if(tipo === 'SOPORTE') return;
    const sid = String(s.ID||s.SOLICITUD_ID||s.ID_SOLICITUD||'');
    const histId = s.HISTORIAL_ID || s.historial_id || null;

    // Si la solicitud portal ya tiene una fila real en historial_ops,
    // NO pintamos la fila de landing_solicitudes porque genera duplicado:
    // una sin saldo y otra con saldo. Nos quedamos con historial_ops.
    const tieneOperacionReal = (sid && _historialIdPorSolicitud[sid]!=null) ||
                               (histId && _historialIdSet.has(String(histId)));
    if(tieneOperacionReal) return;

    items.push({
      fuente:'SOLICITUD', _raw:s,
      id: sid,
      fecha: s.FECHA_CREACION||s.FECHA||s.created_at||null,
      tipo, usuario: s.USUARIO||s.USUARIO_JUGADOR||'',
      nombre: s.NOMBRE_COMPLETO||'',
      billetera_nombre: s.BILLETERA_NOMBRE||s.NOMBRE_BILLETERA||'',
      monto: s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO||0,
      // Si la fila de historial_ops quedó fuera de la ventana cargada, el N° igual puede estar
      // en la solicitud (lo escribe la búsqueda en Chunior). Sin este respaldo se pisaba con
      // null y la ficha volvía a decir "Sin N° anotado" con el número ya guardado en la base.
      estado: s.ESTADO||'', chunior_movimiento_id: _movPorSolicitud[sid] || s.chunior_movimiento_id || null,
      billetera_id: s.ID_BILLETERA||null,
      historial_id: histId || null,
      solicitud_id: sid || null,
      // Estos tres mapas se armaban arriba y NUNCA se leian: la fila del portal salia
      // siempre sin saldos y sin operador aunque la operacion real ya estuviera anotada
      // en historial_ops. Por eso la ficha decia "No se leyeron" en cargas que si los tienen
      // (84.348 de 85.376 cargas de 30 dias tienen saldo_pre en la base).
      saldo_post: s.SALDO_POST!=null ? s.SALDO_POST : (_saldoPostPorSolicitud[sid]!=null ? _saldoPostPorSolicitud[sid] : null),
      saldo_pre: s.SALDO_PRE!=null ? s.SALDO_PRE : (_saldoPrePorSolicitud[sid]!=null ? _saldoPrePorSolicitud[sid] : null),
      operador: (s.OPERADOR && s.OPERADOR !== 'panel' ? s.OPERADOR : (_operadorPorSolicitud[sid] || '')),
      pendiente: esPendiente(s)
    });
  });

  rawHist.forEach(function(h){
    items.push({
      fuente:'OPERACION', _raw:h,
      id: h.id, fecha: h.created_at||null,
      tipo: normalizar(h.tipo), usuario: h.usuario||'', nombre:'',
      billetera_nombre: h.billetera_nombre||'',
      monto: h.monto||0, estado: h.estado||'',
      chunior_movimiento_id: h.chunior_movimiento_id||null,
      billetera_id: h.billetera_id||null, historial_id: h.id,
      solicitud_id: h.solicitud_id || null,
      saldo_post: h.saldo_post!=null ? h.saldo_post : null,
      saldo_pre: h.saldo_pre!=null ? h.saldo_pre : null,
      operador: h.operador || '',
      pendiente: false
    });
  });

  // Filas que trajo la búsqueda contra el servidor: pueden ser de otro día o de otra oficina.
  // Van marcadas para que en pantalla se vea que NO son de la ventana cargada.
  (window._histBusquedaServidor || []).forEach(function(h){
    if(h && h.id!=null && _historialIdSet.has(String(h.id))) return;   // ya está en la ventana
    items.push({
      fuente:"OPERACION", _raw:h, _remoto:true,
      id: h.id, fecha: h.created_at||null,
      tipo: normalizar(h.tipo), usuario: h.usuario||"", nombre:"",
      billetera_nombre: h.billetera_nombre||"",
      monto: h.monto||0, estado: h.estado||"",
      chunior_movimiento_id: h.chunior_movimiento_id||null,
      billetera_id: h.billetera_id||null, historial_id: h.id,
      solicitud_id: h.solicitud_id || null,
      saldo_post: h.saldo_post!=null ? h.saldo_post : null,
      saldo_pre: h.saldo_pre!=null ? h.saldo_pre : null,
      operador: h.operador || "",
      pc_codigo: h.pc_codigo || "",
      pendiente: false
    });
  });

  items.sort(function(a,b){
    // Primero lo que ESPERA una accion.
    if(!!a.pendiente !== !!b.pendiente) return a.pendiente ? -1 : 1;
    const ta = a.fecha?new Date(a.fecha).getTime():0, tb = b.fecha?new Date(b.fecha).getTime():0;
    // Pendientes: la que espera hace MAS tiempo va primero. Es una cola de trabajo, y el cliente
    // que lleva 40 minutos esperando es el urgente, no el que acaba de entrar.
    if(a.pendiente && b.pendiente) return ta - tb;
    // Lo ya cerrado es historial: lo mas nuevo arriba, como siempre.
    return tb - ta;
  });
  return items;
}

function _coincideEstadoFiltro(it, filtro){
  if(!filtro) return true;
  const e = normalizar(it.estado);
  if(filtro==="PENDIENTE")  return it.pendiente;
  if(filtro==="REALIZADAS") return esRealizada({ESTADO:it.estado}) || e==="OK";
  if(filtro==="RECHAZADA")  return e==="RECHAZADA";
  if(filtro==="ERROR")      return e==="ERROR";
  return true;
}

function _obtenerTurnoDeFecha(ts){
  if(!ts) return null;
  const d = new Date(new Date(ts).getTime() - 3 * 3600 * 1000);
  const h = d.getUTCHours();
  if(h >= 6 && h < 14) return 'TM';
  if(h >= 14 && h < 22) return 'TT';
  return 'TN';
}

// _obtenerTurnoDeFecha clasifica SOLO por hora: devuelve "TM" para las 07:30 de hoy, de ayer
// y de la semana pasada. Filtrar por "turno actual" traía entonces todo lo de esa franja de
// cualquier día — de ahí "15 cargas aprobadas en el turno" con una carga por día en la lista.
//
// Un turno es un bloque de UN día concreto. Estas funciones dan sus bordes reales, en hora
// argentina (UTC−3). El caso complicado es TN, que cruza la medianoche: a la 01:00 el turno
// noche en curso empezó AYER a las 22:00.
const _TURNO_INICIO = { TM: 6, TT: 14, TN: 22 };

function _bordesTurno(turno, ahoraMs){
  const ini = _TURNO_INICIO[String(turno||"").toUpperCase()];
  if(ini === undefined) return null;
  const MS_H = 3600 * 1000;
  const ahora = (ahoraMs == null ? Date.now() : ahoraMs);
  // Se trabaja en "hora AR corrida": se resta el huso y se razona en UTC.
  const ar = new Date(ahora - 3 * MS_H);
  const diaAR = Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate());
  let desdeAR = diaAR + ini * MS_H;
  // Si ese turno todavía no arrancó hoy, el que corresponde es el de ayer.
  if(desdeAR > ar.getTime()) desdeAR -= 24 * MS_H;
  const desde = desdeAR + 3 * MS_H;          // de vuelta a UTC real
  return { desde: desde, hasta: desde + 8 * MS_H };
}

// ¿Esta fecha cae dentro del turno indicado (el bloque concreto, no la franja)?
function _enTurno(ts, turno){
  if(!ts) return false;                      // sin fecha no se puede afirmar que sea del turno
  const b = _bordesTurno(turno);
  if(!b) return false;
  const t = new Date(ts).getTime();
  return !isNaN(t) && t >= b.desde && t < b.hasta;
}

function _turnoActual(){
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  const h = d.getUTCHours();
  if(h >= 6 && h < 14) return 'TM';
  if(h >= 14 && h < 22) return 'TT';
  return 'TN';
}

// El turno en curso ES uno de TM/TT/TN: tener ademas una opcion "turno actual" era elegir
// dos veces lo mismo. Ahora arranca en el turno que corre, marcado "· ahora" en la lista.
let _filtroTurno = _turnoActual();
function _pintarOpcionesTurno(){
  const sel = document.getElementById("filtroTurnoSelect");
  if(!sel) return;
  const hoy = _turnoActual();
  Array.prototype.forEach.call(sel.options, function(op){
    const base = op.textContent.replace(/\s*·\s*ahora$/, "");
    op.textContent = (op.value === hoy) ? (base + " · ahora") : base;
  });
  if(sel.value !== _filtroTurno) sel.value = _filtroTurno;
}

window.setSolicitudesTurno = function(turnoKey){
  _filtroTurno = turnoKey || 'ACTUAL';
  const sel = document.getElementById("filtroTurnoSelect");
  if(sel && sel.value !== _filtroTurno) sel.value = _filtroTurno;
  renderHistorialUnificado();
};

window.cycleTurno = function(){
  const order = ['ACTUAL', 'TM', 'TT', 'TN', 'TODOS'];
  const next = order[(order.indexOf(_filtroTurno) + 1) % order.length];
  window.setSolicitudesTurno(next);
};

function renderSolicitudesKpis(listaCompleta){
  const el = document.getElementById("solicitudesKpiStrip");
  const arr = Array.isArray(listaCompleta) ? listaCompleta : [];
  const turnoEfectivo = _filtroTurno === 'ACTUAL' ? _turnoActual() : _filtroTurno;

  // Antes esto comparaba la FRANJA horaria y contaba lo de esa hora de cualquier día. Y las
  // filas sin fecha entraban siempre, sumando al total sin pertenecer a ningún turno.
  const arrTurno = (turnoEfectivo === 'TODOS')
    ? arr
    : arr.filter(function(x){ return _enTurno(x.fecha, turnoEfectivo); });

  const cargas = arrTurno.filter(function(x){ return x.tipo === 'CARGA'; });
  const retiros = arrTurno.filter(function(x){ return x.tipo === 'RETIRO'; });
  const rechazos = arrTurno.filter(function(x){
    const r = (typeof window.clasificarRechazo === 'function') ? window.clasificarRechazo(x) : null;
    return r ? r.esRechazo : /RECHAZ|CANCEL/.test(String(x.estado||'').toUpperCase());
  });

  let parcialesCount = 0;
  retiros.forEach(function(x){
    try{
      const pp = window._retiroParcialInfo ? window._retiroParcialInfo(x._raw || x) : null;
      if(pp && pp.hasProg && pp.restante > 0.5) parcialesCount++;
    }catch(_e){}
  });

  if(!el) return;

  function turnoNombre(t){
    if(t === 'TM') return 'TM · Mañana';
    if(t === 'TT') return 'TT · Tarde';
    if(t === 'TN') return 'TN · Noche';
    if(t === 'TODOS') return '📅 Todo el día';
    return turnoNombre(_turnoActual());
  }
  function turnoHorario(t){
    if(t === 'TM') return '06:00 a 14:00';
    if(t === 'TT') return '14:00 a 22:00';
    if(t === 'TN') return '22:00 a 06:00';
    if(t === 'TODOS') return 'Todas las operaciones';
    return turnoHorario(_turnoActual());
  }

  el.innerHTML = `
    <div class="kpi-card purple" onclick="cycleTurno()" style="cursor:pointer" title="Hacé clic para cambiar de turno">
      <div class="kpi-head">
        <span class="kpi-title">🕒 Turno Operativo</span>
        <span class="kpi-ico">⏱️</span>
      </div>
      <div class="kpi-num" style="color:#c084fc;font-size:22px">${turnoNombre(turnoEfectivo)}</div>
      <div class="kpi-sub">${turnoHorario(turnoEfectivo)} · <i>Tocar para alternar</i></div>
    </div>

    <div class="kpi-card green" onclick="setSolicitudesFiltroRapido('CARGAS')" title="Ver cargas del turno">
      <div class="kpi-head">
        <span class="kpi-title">⬆️ Cargas Aprobadas</span>
        <span class="kpi-ico">📥</span>
      </div>
      <div class="kpi-num" style="color:#34d399">${cargas.length} <span style="font-size:13px;font-weight:600;color:#94a3b8">operaciones</span></div>
      <div class="kpi-sub">En el turno seleccionado</div>
    </div>

    <div class="kpi-card orange" onclick="setSolicitudesFiltroRapido('RETIROS')" title="Ver retiros del turno">
      <div class="kpi-head">
        <span class="kpi-title">⬇️ Retiros Procesados</span>
        <span class="kpi-ico">📤</span>
      </div>
      <div class="kpi-num" style="color:#fb923c">${retiros.length} <span style="font-size:13px;font-weight:600;color:#94a3b8">retiros</span></div>
      <div class="kpi-sub">${parcialesCount ? `<b>${parcialesCount}</b> parciales · ` : ''}En el turno seleccionado</div>
    </div>

    <div class="kpi-card red" onclick="setSolicitudesFiltroRapido('RECHAZADAS')" title="Ver solicitudes rechazadas del turno">
      <div class="kpi-head">
        <span class="kpi-title">⛔ Rechazos</span>
        <span class="kpi-ico">🚫</span>
      </div>
      <div class="kpi-num" style="color:#f87171">${rechazos.length} <span style="font-size:13px;font-weight:600;color:#94a3b8">incidentes</span></div>
      <div class="kpi-sub">Rechazos en este turno</div>
    </div>
  `;
}

window.setSolicitudesFiltroRapido = function(modo){
  const elEstado = document.getElementById("filtroEstado");
  const elTipo = document.getElementById("filtroTipo");
  const elTexto = document.getElementById("filtroTexto");
  if(elTexto) elTexto.value = "";

  const tabMap = {
    'TODAS': 'tabFiltroTodas',
    'CARGAS': 'tabFiltroCargas',
    'RETIROS': 'tabFiltroRetiros',
    'RECHAZADAS': 'tabFiltroRechazadas',
    'CHUNIOR': 'tabFiltroChunior'
  };
  ['tabFiltroTodas', 'tabFiltroCargas', 'tabFiltroRetiros', 'tabFiltroRechazadas', 'tabFiltroChunior'].forEach(function(tid){
    const tabEl = document.getElementById(tid);
    if(tabEl) tabEl.classList.toggle('active', tid === tabMap[modo]);
  });

  if(modo === 'TODAS'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "";
  } else if(modo === 'CARGAS'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "CARGA";
  } else if(modo === 'RETIROS'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "RETIRO";
  } else if(modo === 'RECHAZADAS'){
    if(elEstado) elEstado.value = "RECHAZADA";
    if(elTipo) elTipo.value = "";
  } else if(modo === 'CHUNIOR'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "__CHUNIOR__";
    // Son ~3 por dia por oficina: filtrarlos ademas por turno los deja casi siempre en cero.
    _filtroTurno = "TODOS";
    const _selT = document.getElementById("filtroTurnoSelect");
    if(_selT) _selT.value = "TODOS";
  }
  renderHistorialUnificado();
};

window.limpiarFiltrosSolicitudes = function(){
  ["filtroEstado","filtroTipo","filtroFuente","filtroMotivoRechazo","filtroTexto"].forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.value = "";
  });
  _filtroTurno = _turnoActual();
  const selTurno = document.getElementById("filtroTurnoSelect");
  if(selTurno) selTurno.value = _filtroTurno;
  window._histBusquedaServidor = [];
  const tabTodas = document.getElementById("tabFiltroTodas");
  if(tabTodas) tabTodas.click();
  else renderHistorialUnificado();
};

let _solicitudActivaId = null;
// Clave de cada tarjeta. Una fila de historial_ops va por SU id ("h" + id): un retiro pagado en
// partes tiene varias filas con la misma solicitud, y con la clave por solicitud eran la misma
// tarjeta — tocabas cualquiera y se abría la última (Juan, 12/09). Las del portal siguen igual.
function _claveStream(it){
  if(it && it.fuente === 'OPERACION') return 'h' + String(it.historial_id || it.id || '');
  return String((it && (it.solicitud_id || it.historial_id || it.id)) || '');
}
window._claveStream = _claveStream;
// Qué parte de un retiro por partes es esta fila ("Parte 2 de 2 · #207577"), o si es el cierre,
// que se registra con $0 y sin eso se leía "RETIRO de $0".
function _parteRetiro(it){
  try{
    if(String((it && it.tipo) || '').toUpperCase() !== 'RETIRO' || !it.solicitud_id) return null;
    const raw = it._raw || {};
    const sid = String(it.solicitud_id);
    const H = (typeof _historialData !== 'undefined' && _historialData && _historialData.length)
      ? _historialData : (window._historialData || []);
    const partes = H.filter(function(h){
      return String(h.solicitud_id || '') === sid && String(h.tipo || '').toUpperCase() === 'RETIRO'
        && Number(h.monto || 0) > 0 && String(h.estado || '').toUpperCase() !== 'ERROR';
    }).sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });
    if(Number(it.monto || 0) === 0 && /^Cierre de retiro parcial/i.test(String(raw.notas || '')))
      return { cierre: true, sid: sid, n: partes.length };
    if(partes.length < 2 && !/PARCIAL/.test(String(raw.notas || ''))) return null;
    const i = partes.findIndex(function(h){ return String(h.id) === String(it.historial_id || it.id); });
    return { cierre: false, sid: sid, i: i + 1, n: partes.length };
  }catch(_e){ return null; }
}
window._parteRetiro = _parteRetiro;
window._parteRetiroTxt = function(pr){
  return pr ? ('💸 ' + (pr.cierre ? 'Cierre del retiro' : ('Parte ' + (pr.i > 0 ? pr.i : '?') + ' de ' + pr.n)) + ' · #' + pr.sid) : '';
};

function renderSolicitudesStream(lista){
  const streamEl = document.getElementById("solicitudesStreamList");
  if(!streamEl) return;
  if(!lista || !lista.length){
    streamEl.innerHTML = `
      <div class="sol-empty-dossier" style="padding:30px 15px">
        <span style="font-size:32px;margin-bottom:8px">🔍</span>
        <h4 style="color:#cbd5e1;font-size:14px;margin:0 0 4px 0">Sin movimientos en la ventana cargada</h4>
        <p style="font-size:11px;color:#64748b">${_textoBuscado()
          ? 'Nada con ese texto en lo que está cargado. Buscalo en todo el historial 👇'
          : 'Probá cambiar los filtros, ampliar el período o consultar otro turno.'}</p>
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px">
          ${_textoBuscado() ? `<button type="button" class="mini-btn green" onclick="buscarHistorialServidor()" style="font-size:11px">🔎 Buscar en todo el historial</button>` : ''}
          <button type="button" class="mini-btn gray" onclick="limpiarFiltrosSolicitudes()" style="font-size:11px">Limpiar filtros</button>
        </div>
      </div>`;
    const dossierPane = document.getElementById("solicitudesDossierPane");
    if(dossierPane){
      dossierPane.innerHTML = `
        <div class="sol-empty-dossier">
          <span class="sol-empty-icon">📂</span>
          <h3>Sin solicitud seleccionada</h3>
          <p>No hay movimientos que coincidan con los filtros seleccionados.</p>
        </div>`;
    }
    return;
  }

  // Auto-seleccionar primer elemento
  const tieneActiva = _solicitudActivaId && lista.some(function(it){
    return _claveStream(it) === String(_solicitudActivaId);
  });
  if(!tieneActiva){
    _solicitudActivaId = _claveStream(lista[0]);
  }

  let html = '';
  lista.forEach(function(it){
    const selId = _claveStream(it);
    const loteId = String(it.historial_id || it.id || '');   // el lote va por fila de historial, igual que en la tabla
    const isActive = String(selId) === String(_solicitudActivaId);
    const checked = _seleccionLote.has(loteId);
    const seleccionable = it.fuente === 'OPERACION' && it.chunior_movimiento_id;

    const u = it.usuario || 'JU';
    const initials = (u.slice(0, 2) || 'JU').toUpperCase();
    const esRetiro = it.tipo === 'RETIRO';
    const esCarga = it.tipo === 'CARGA';
    const tipoClass = esRetiro ? 'retiro' : (esCarga ? 'carga' : 'other');

    const r = (typeof window.clasificarRechazo === 'function') ? window.clasificarRechazo(it) : null;
    const esRech = r ? r.esRechazo : /RECHAZ|CANCEL/.test(String(it.estado||'').toUpperCase());
    let avatarClass = esRech ? 'rechazo' : tipoClass;

    let timeHtml = formatFecha(it.fecha);
    let montoHtml = it.monto ? money(it.monto) : '—';
    if(_esTipoClave(it.tipo)){
      const _cl = _claveDeItem(it);
      montoHtml = _cl
        ? '<span style="font-family:ui-monospace,monospace;color:#facc15;font-size:15px">🔑 ' + escapeHtml(_cl) + '</span>'
        : '<span style="color:#f87171;font-size:13px">sin clave</span>';
    }
    let parcialMini = '';
    if(esRetiro){
      const pp = (typeof window._retiroParcialInfo === 'function') ? window._retiroParcialInfo(it._raw || it) : null;
      if(pp && pp.hasProg){
        const pct = Math.min(100, Math.round((pp.pagado / (pp.total || 1)) * 100));
        montoHtml = money(pp.total);
        parcialMini = `
          <div style="margin-top:5px">
            <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#c084fc;font-weight:700;margin-bottom:2px">
              <span>Parcial ${pct}% (Pagado ${money(pp.pagado)})</span>
              <span>Resta: ${money(pp.restante)}</span>
            </div>
            <div class="sol-mini-prog" style="max-width:100%"><span style="width:${pct}%"></span></div>
          </div>`;
      }
    }

    // Un retiro pagado en partes: qué parte es esta fila, o el cierre.
    const _pr = it.fuente === 'OPERACION' ? _parteRetiro(it) : null;
    if(_pr){
      if(_pr.cierre) montoHtml = '<span style="font-size:13px;color:#c4b5fd">🔒 Cierre</span>';
      parcialMini += `<div style="margin-top:4px;font-size:10px;font-weight:800;color:#c084fc">${escapeHtml(window._parteRetiroTxt(_pr))}</div>`;
    }

    // Va ARRIBA del todo en la tarjeta: es lo que decide a qué billetera mirar.
    let bilPill = '';
    const _bv = _billeteraVieja(it);
    if(_bv){
      bilPill = `
        <div style="margin-top:5px;display:flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:#fbbf24;background:rgba(245,158,11,.12);padding:3px 6px;border-radius:6px;border:1px solid #f59e0b55">
          <span>⚠</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Pagó a ${escapeHtml(_bv.vieja)} · ahora ${escapeHtml(_bv.actual)}</span>
        </div>`;
    }

    let diagPill = '';
    if(esRech){
      const badge = (r && r.badge) ? r.badge : 'Rechazada';
      const col = (r && r.color) ? r.color : '#ef4444';
      const bg = (r && r.bg) ? r.bg : 'rgba(239, 68, 68, 0.12)';
      diagPill = `
        <div style="margin-top:5px;display:flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:${col};background:${bg};padding:3px 6px;border-radius:6px;border:1px solid ${col}44">
          <span>⛔</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(badge)}</span>
        </div>`;
    }

    const chkHtml = seleccionable ? `
      <input type="checkbox"${checked ? ' checked' : ''} onclick="event.stopPropagation();toggleSeleccionLote('${escapeHtml(loteId)}', this.checked)" style="width:15px;height:15px;cursor:pointer;margin-right:6px">
    ` : '';

    const esManual = it.fuente === 'OPERACION';
    const esChu = _esTipoChunior(it.tipo);
    const origenTxt = esManual ? (esChu ? 'Chunior' : 'Manual') : 'Portal';
    // Lo que trajo la busqueda contra el servidor puede ser de otro dia o de otra oficina.
    const remotoTag = it._remoto
      ? `<span class="sol-mov-tag" style="background:rgba(192,132,252,.14);color:#c084fc;border-color:#c084fc44" title="Fuera de la ventana cargada">📅 ${escapeHtml(formatFecha(it.fecha))}${it.pc_codigo ? ' · ' + escapeHtml(it.pc_codigo) : ''}</span>`
      : '';

    html += `
      <div id="solCard-${escapeHtml(selId)}" class="sol-card-item${isActive ? ' is-active' : ''}${checked ? ' is-selected-lote' : ''}" onclick="seleccionarSolicitudStream('${escapeHtml(selId)}')">
        <div class="sol-card-head">
          <div class="sol-card-user-row">
            ${chkHtml}
            <div class="sol-avatar ${avatarClass}">${escapeHtml(initials)}</div>
            <div style="min-width:0">
              <div class="sol-card-username" title="${escapeHtml(it.usuario || '')}">${escapeHtml(it.usuario || 'Sin usuario')}</div>
              <div class="sol-card-time">${timeHtml}</div>
            </div>
          </div>
          <div style="text-align:right">
            <span class="sol-pill-type ${tipoClass}">${esRetiro ? '⬇️ RETIRO' : (esCarga ? '⬆️ CARGA' : _tipoEtiqueta(it.tipo))}</span>
          </div>
        </div>

        <div class="sol-card-amount-row">
          <div class="sol-card-amount ${tipoClass}">${montoHtml}</div>
          <div style="font-size:11px;color:#94a3b8">${escapeHtml(it.billetera_nombre || '')}</div>
        </div>

        ${parcialMini}
        ${bilPill}
        ${diagPill}

        <div class="sol-card-details-box">
          <div class="sol-card-meta-line">
            <span class="sol-origin-badge ${esManual ? 'manual' : 'portal'}">${origenTxt}</span>
            ${it.chunior_movimiento_id ? `<span class="sol-mov-tag">N° ${escapeHtml(it.chunior_movimiento_id)}</span>` : ''}
            ${remotoTag}
          </div>
        </div>
      </div>
    `;
  });

  streamEl.innerHTML = html;
  actualizarDossierActivo(lista);
}

function _textoBuscado(){
  return String((document.getElementById("filtroTexto")||{}).value||"").trim();
}

// Busqueda contra el SERVIDOR, no contra las filas ya cargadas.
// Sin esto el buscador prometia "N° de movimiento" pero solo miraba la ventana en memoria:
// un numero de ayer no aparecia nunca, y eso es justo lo que hace falta para cotejar.
// Un numero de movimiento se busca en TODAS las oficinas a proposito: el numero es de Chunior,
// no de la PC, y cuando se cotea no siempre se sabe en que oficina se cargo.
window.buscarHistorialServidor = async function(){
  const texto = _textoBuscado();
  if(texto.length < 3){ try{ toast("Escribí al menos 3 caracteres para buscar.","yellow"); }catch(_e){} return; }
  const streamEl = document.getElementById("solicitudesStreamList");
  if(streamEl) streamEl.innerHTML = '<div class="sol-empty-dossier" style="padding:30px 15px">Buscando en todo el historial…</div>';
  const soloDigitos = /^[0-9]+$/.test(texto);
  try{
    let q = supabaseClient.from("historial_ops").select("*").order("created_at",{ascending:false}).limit(300);
    if(soloDigitos){
      q = q.or("chunior_movimiento_id.eq." + texto + ",solicitud_id.eq." + texto);
    }else{
      q = q.ilike("usuario", "%" + texto + "%");
    }
    const _huHealth = window.NodoSalud?.begin('HISTORIAL');
    const { data, error } = await q;
    _huHealth?.reply(error);
    if(error) throw error;
    window._histBusquedaServidor = data || [];
    const n = window._histBusquedaServidor.length;
    try{ toast(n ? (n + " resultado" + (n===1?"":"s") + " en todo el historial") : "No hay nada con \"" + texto + "\" en el historial completo.", n ? "green" : "orange"); }catch(_e){}
  }catch(e){
    window._histBusquedaServidor = [];
    try{ toast("Error buscando: " + (e.message||e), "red"); }catch(_e){}
  }
  renderHistorialUnificado();
};

function actualizarDossierActivo(lista){

  const dossierPane = document.getElementById("solicitudesDossierPane");
  if(!dossierPane) return;
  if(!_solicitudActivaId){
    dossierPane.innerHTML = `
      <div class="sol-empty-dossier">
        <span class="sol-empty-icon">📂</span>
        <h3>Seleccioná una solicitud</h3>
        <p>Hacé clic en cualquier tarjeta de la izquierda para ver el detalle completo de la operación o solicitud.</p>
      </div>`;
    return;
  }
  if(typeof window.mostrarExpedienteEnPane === 'function'){
    window.mostrarExpedienteEnPane(_solicitudActivaId);
  }
}

window.seleccionarSolicitudStream = function(id){
  _solicitudActivaId = String(id);
  const streamEl = document.getElementById("solicitudesStreamList");
  if(streamEl){
    streamEl.querySelectorAll(".sol-card-item").forEach(function(card){
      card.classList.remove("is-active");
    });
    const targetCard = document.getElementById("solCard-" + id);
    if(targetCard) targetCard.classList.add("is-active");
  }
  actualizarDossierActivo(_histUnificadoCache);
};

function renderHistorialUnificado(){
  const estado = val("filtroEstado"), tipo = val("filtroTipo"),
        fuente = val("filtroFuente"), texto = normalizar(val("filtroTexto"));

  let listaCompleta = construirHistorialUnificado();
  renderSolicitudesKpis(listaCompleta);

  const turnoEfectivo = _filtroTurno === 'ACTUAL' ? _turnoActual() : _filtroTurno;
  _pintarOpcionesTurno();
  let lista = listaCompleta.slice();

  // Filtrar por turno. Con una busqueda del servidor activa NO se filtra: el operador pidio
  // expresamente algo de otro dia, esconderlo por turno seria devolverle una lista vacia.
  const _hayBusquedaRemota = (window._histBusquedaServidor || []).length > 0;
  if(turnoEfectivo !== 'TODOS' && !_hayBusquedaRemota){
    lista = lista.filter(function(it){ return _enTurno(it.fecha, turnoEfectivo); });
  }

  if(fuente) lista = lista.filter(function(it){ return it.fuente===fuente; });
  if(tipo === "__CHUNIOR__") lista = lista.filter(function(it){ return _esTipoChunior(it.tipo); });
  else if(tipo) lista = lista.filter(function(it){ return it.tipo===tipo; });
  if(estado) lista = lista.filter(function(it){ return _coincideEstadoFiltro(it, estado); });

  if(texto){
    lista = lista.filter(function(it){
      const u = it.usuario || '';
      const nom = it.nombre || (it._raw && (it._raw.titular || it._raw.NOMBRE_COMPLETO)) || '';
      const bil = it.billetera_nombre || '';
      const mov = String(it.chunior_movimiento_id || (it._raw && (it._raw.chunior_movimiento_id || it._raw.movimiento_id)) || '');
      const sid = String(it.solicitud_id || it.id || '');
      const dest = String((it._raw && (it._raw.destino || it._raw.DESTINO || it._raw.cbu || it._raw.CBU)) || '');
      const tel = String((it._raw && (it._raw.telefono || it._raw.TELEFONO)) || '');
      const blob = normalizar(`${u} ${nom} ${bil} ${mov} ${sid} ${dest} ${tel}`);
      return blob.includes(texto);
    });
  }

  // Decir SIEMPRE que ventana se esta mirando. Lo que no esta cargado no existe para los
  // filtros ni para el buscador, y el operador tiene que saberlo antes de concluir "no esta".
  try{
    const _inf = document.getElementById("histVentanaInfo");
    if(_inf && typeof _histVentana === "function"){
      const _v = _histVentana();
      const _rem = (window._histBusquedaServidor || []).length;
      _inf.textContent = _rem
        ? ("🔎 " + _rem + " del historial completo")
        : ("Cargadas últimas " + _v.horas + " h · " + listaCompleta.length + " movimientos");
      _inf.title = _rem
        ? "Resultados traídos del servidor, fuera de la ventana cargada. Limpiá la búsqueda para volver."
        : "Sólo se filtra sobre lo cargado. Para ver más atrás, ampliá el período o usá la búsqueda en todo el historial.";
    }
  }catch(_e){}

  _histUnificadoCache = lista;
  // El expediente (operation-modal) busca la fila en window._histUnificadoCache. Como esto
  // es un `let` de script clasico, NUNCA estuvo en window: por eso las tarjetas que no son
  // del portal (manuales y las de Chunior) abrian "Solicitud no seleccionada" y quedaban
  // como filas muertas.
  try{ window._histUnificadoCache = lista; }catch(_e){}
  _guardarHistorialLocal();
  renderSolicitudesStream(lista);
  setBox("tablaSolicitudesCompleta", tablaHistorialUnificadoHTML(lista));
  actualizarBarraLote();
}

function tablaHistorialUnificadoHTML(lista){
  if(!lista.length) return `<div class="alert-box">No hay movimientos para mostrar con los filtros seleccionados.</div>`;
  function fuentePill(f){
    return f==='SOLICITUD'
      ? '<span class="origen-pill op-panel">Portal</span>'
      : '<span class="origen-pill op-manual">Operación</span>';
  }
  function tipoIco(t){
    if(t==='CARGA') return '⬆️'; if(t==='RETIRO') return '⬇️';
    if(t==='CAMBIO_CLAVE'||t==='RESET_CLAVE') return '🔑'; if(t==='CONSULTA') return '👁'; return '➡️';
  }
  const haySeleccionables = lista.some(function(it){ return it.fuente==='OPERACION' && it.chunior_movimiento_id; });
  const chkHead = haySeleccionables
    ? `<input type="checkbox" id="histCheckAll" onchange="toggleSeleccionTodos(this.checked)" title="Seleccionar / deseleccionar todos">`
    : '';
  const _nPend = lista.filter(function(it){ return !!it.pendiente; }).length;
  let html = _nPend
    ? `<div style="margin-bottom:7px;padding:7px 11px;border-radius:9px;background:rgba(245,197,24,.10);border:1px solid rgba(245,197,24,.45);font-size:12.5px;font-weight:800;color:#f5c518">⚡ ${_nPend} solicitudes esperando atención · haz clic en cualquier fila para ver el expediente completo</div>`
    : `<div style="margin-bottom:7px;padding:7px 11px;border-radius:9px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.35);font-size:12.5px;font-weight:700;color:#22c55e">✓ Bandeja al día · Haz clic en cualquier fila para inspeccionar el expediente</div>`;
  html += `<div class="small" style="color:var(--muted);margin-bottom:6px">💡 Haz clic en una fila para ver el <b>Expediente Completo</b> con WhatsApp, billeteras / comprobantes y auditoría de rechazo.</div>`;
  html += `<div class="table-wrap"><table><thead><tr>`+
    `<th style="width:30px;text-align:center">${chkHead}</th><th>Fecha</th><th>Origen</th><th>Tipo</th><th>Usuario</th>`+
    `<th>Billetera</th><th>Monto</th><th>N° Mov / Destino</th><th>Estado & Diagnóstico</th><th>Acciones</th></tr></thead><tbody>`;
  let _corteHecho = false;
  lista.forEach(function(it){
    if(_nPend && !it.pendiente && !_corteHecho){
      _corteHecho = true;
      html += `<tr><td colspan="10" style="padding:6px 8px;border-top:0">`
            + `<div style="display:flex;align-items:center;gap:9px;color:#6b7688;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em">`
            +   `<span style="flex:1;height:1px;background:#2c3444"></span>ya procesado<span style="flex:1;height:1px;background:#2c3444"></span>`
            + `</div></td></tr>`;
    }
    const seleccionable = it.fuente==='OPERACION' && it.chunior_movimiento_id;
    const selId = String(it.historial_id||it.id||'');
    const checked = seleccionable && _seleccionLote.has(selId);
    const chk = seleccionable
      ? `<input type="checkbox"${checked?' checked':''} onchange="toggleSeleccionLote('${escapeHtml(selId)}', this.checked)" style="width:16px;height:16px;cursor:pointer">`
      : '';

    // Destino / N° Mov
    let movTd = it.chunior_movimiento_id ? `<span class="exp-code-pill" style="color:#86efac;border-color:#14532d">N° ${escapeHtml(String(it.chunior_movimiento_id))}</span>` : '<span class="small" style="color:var(--muted)">—</span>';
    const cbuDest = (it._raw && (it._raw.destino || it._raw.cbu || it._raw.DESTINO || it._raw.CBU)) || '';
    if(it.tipo === 'RETIRO' && cbuDest){
      movTd = `<div style="display:flex;align-items:center;gap:5px">
        <span style="font-family:ui-monospace,monospace;font-size:11px">${escapeHtml(cbuDest.length > 15 ? cbuDest.slice(0,14)+'…' : cbuDest)}</span>
        <button type="button" class="mini-btn gray" style="padding:1px 5px;font-size:10px" onclick="event.stopPropagation();portalCopiarCbu(this)" data-valor="${escapeHtml(cbuDest)}" title="Copiar CBU/Alias">📋</button>
      </div>`;
    }

    const rowAttrs = ` id="histRow-${escapeHtml(selId)}" class="sol-row${checked?' is-selected':''}" onclick="if(!event.target.closest('button,input,a'))abrirExpedienteSolicitud('${escapeHtml(_claveStream(it))}')"` + (checked ? ` style="background:#1c2740"` : ``);
    const esRetiroOp = it.fuente==='OPERACION' && it.tipo==='RETIRO';
    const yaExcluido = it._raw && /\[BL_EXCLUIDO\]/.test(String(it._raw.notas||''));
    const blBtn = esRetiroOp
      ? (yaExcluido
          ? `<button class="mini-btn gray" onclick="event.stopPropagation();reincluirRetiroBlacklist('${escapeHtml(selId)}')" style="font-size:10px" title="Volver a contar en blacklist">↩ En blacklist</button>`
          : `<button class="mini-btn yellow" onclick="event.stopPropagation();excluirRetiroBlacklist('${escapeHtml(selId)}')" style="font-size:10px" title="No contar en blacklist 24hs">🚫 Quitar BL</button>`)
      : '';
    const _accU = it.tipo==='RETIRO' ? '#fb923c' : it.tipo==='CARGA' ? '#22c55e' : '';

    // Acciones de solicitud
    let solBtns = `<button class="mini-btn" style="background:#1e293b;color:#93c5fd;border:1px solid rgba(147,197,253,.4);font-size:10px;padding:3px 8px" onclick="event.stopPropagation();abrirExpedienteSolicitud('${escapeHtml(_claveStream(it))}')" title="Ver expediente detallado">🔎 Ver</button>`;
    if(it.fuente==='SOLICITUD'){
      const _sid = String(it.solicitud_id || it.id || '');
      const _estS = String(it.estado||'').toUpperCase();
      const _pend = !_estS || ['PENDIENTE','EN_PROCESO','EN_REVISION','TOMADA','ERROR_OPERATIVO'].includes(_estS);
      if(_sid && _pend){
        solBtns = `<button class="mini-btn yellow" onclick="event.stopPropagation();v154pTomarSolicitud('${escapeHtml(_sid)}')" style="font-size:10px">Tomar</button>`
          + `<button class="mini-btn green" onclick="event.stopPropagation();v154pCrearJobSolicitud('${escapeHtml(_sid)}')" style="font-size:10px">Aprobar</button>`
          + (it.tipo==='RETIRO' ? `<button class="mini-btn blue" onclick="event.stopPropagation();v154pRegistrarParcial('${escapeHtml(_sid)}')" style="font-size:10px">💸 Parcial</button>` : '')
          + `<button class="mini-btn" style="background:#1e293b;color:#93c5fd;border:1px solid rgba(147,197,253,.4);font-size:10px;padding:3px 8px" onclick="event.stopPropagation();abrirExpedienteSolicitud('${escapeHtml(_sid)}')" title="Ver expediente detallado">🔎 Ver</button>`
          + `<button class="mini-btn red" onclick="event.stopPropagation();v154pRechazarSolicitud('${escapeHtml(_sid)}')" style="font-size:10px">Rechazar</button>`;
      }
    }

    // Teléfono
    const tel = (it._raw && (it._raw.telefono || it._raw.TELEFONO)) || '';

    // Diagnóstico y Estado
    const r = (typeof window.clasificarRechazo === 'function') ? window.clasificarRechazo(it) : null;
    let estadoColHtml = estadoBadge(it.estado);
    if(r){
      estadoColHtml = `<div style="display:flex;flex-direction:column;gap:3px">
        ${estadoBadge(it.estado)}
        <span class="sol-rej-pill" style="color:${r.color};background:${r.bg};border:1px solid ${r.color}55" title="${escapeHtml(r.titulo)}">
          ${r.icono} ${escapeHtml(r.badge)}
        </span>
      </div>`;
    }

    // Monto con progreso parcial si aplica
    let montoCell = it.monto ? money(it.monto) : '—';
    if(it.tipo === 'RETIRO'){
      const pp = (typeof window._retiroParcialInfo === 'function') ? window._retiroParcialInfo(it._raw || it) : null;
      if(pp && pp.hasProg){
        const pct = Math.min(100, Math.round((pp.pagado / (pp.total || 1)) * 100));
        montoCell = `<div>${money(pp.restante)}<div class="sol-mini-prog" title="Pagado ${money(pp.pagado)} de ${money(pp.total)}"><span style="width:${pct}%"></span></div><div style="font-size:9.5px;color:#c084fc;font-weight:700">Parcial ${pct}%</div></div>`;
      }
    }

    html += `<tr${rowAttrs}>`+
      `<td style="text-align:center">${chk}</td>`+
      `<td style="font-size:12px;white-space:nowrap">${formatFecha(it.fecha)}</td>`+
      `<td>${fuentePill(it.fuente)}</td>`+
      `<td style="white-space:nowrap${_accU?';color:'+_accU+';font-weight:800':''}">${tipoIco(it.tipo)} ${escapeHtml(it.tipo||'—')}${yaExcluido?' <span class="small" style="color:#e6a028">🚫</span>':''}</td>`+
      `<td><b>${escapeHtml(it.usuario||'—')}</b>${it.nombre?'<br><span class="small" style="color:#94a3b8">'+escapeHtml(it.nombre)+'</span>':''}${tel?`<br><span class="small" style="color:#60a5fa">📱 ${escapeHtml(tel)}</span>`:''}</td>`+
      `<td style="font-size:12px">${escapeHtml(it.billetera_nombre||'—')}</td>`+
      `<td style="font-weight:700${_accU?';color:'+_accU:''}">${montoCell}</td>`+
      `<td style="font-size:12px">${movTd}</td>`+
      `<td>${estadoColHtml}</td>`+
      `<td style="white-space:nowrap"><div style="display:flex;gap:4px;flex-wrap:wrap">${solBtns}${blBtn}</div></td>`+
      `</tr>`+
      (function(){
        const _crudo = String((it._raw && it._raw.notas) || it.notas || '').replace(/\[BL_EXCLUIDO\]/g,'').trim();
        const _ctxN = _errParse(_crudo);
        const _n = _ctxN
          ? ((_errEtiqueta(_crudo) ? ('❌ ' + _errEtiqueta(_crudo) + (_errTextoLimpio(_crudo) ? ' · ' : '')) : '') + _errTextoLimpio(_crudo))
          : _crudo;
        if(!_n) return '';
        const _e = String(it.estado||'').toUpperCase();
        const _malo = /RECHAZ|ERROR|CANCEL/.test(_e);
        let _btnErr = '';
        try{
          if(_malo && it._raw && it._raw.id){
            window._histPorId[String(it._raw.id)] = it._raw;
            _btnErr = ' <button type="button" onclick="event.stopPropagation();verDetalleError(&#39;'+escapeHtml(String(it._raw.id))+'&#39;)"'
              + ' title="Por qué falló: contexto completo, paso a paso y detalle técnico"'
              + ' style="background:transparent;border:1px solid #7a5a1d;color:#e3b341;border-radius:6px;font-size:10px;padding:1px 6px;cursor:pointer;margin-left:6px">🔎 detalle técnico</button>';
          }
        }catch(_e2){}
        return `<tr class="hist-nota"><td style="border-top:0"></td>`
          + `<td colspan="9" style="border-top:0;padding:0 8px 7px 8px">`
          + `<div style="font-size:11px;line-height:1.4;color:${_malo?'#e3b341':'#8b949e'};`
          + `border-left:2px solid ${_malo?'#7a5a1d':'#2c3444'};padding-left:8px">`
          + escapeHtml(_n) + _btnErr + `</div></td></tr>`;
      })();
  });
  html += `</tbody></table></div>`;
  return html;
}

function _pintarFilaSeleccion(selId){
  const row = document.getElementById("histRow-"+selId);
  if(!row) return;
  const sel = _seleccionLote.has(String(selId));
  row.style.background = sel ? '#1c2740' : '';
  const cb = row.querySelector('input[type=checkbox]');
  if(cb) cb.checked = sel;
}
function toggleSeleccionLote(historialId, checked){
  const id = String(historialId);
  if(checked===undefined) checked = !_seleccionLote.has(id);
  if(checked) _seleccionLote.add(id); else _seleccionLote.delete(id);
  _pintarFilaSeleccion(id);
  actualizarBarraLote();
}
function toggleSeleccionTodos(checked){
  (_histUnificadoCache||[]).forEach(function(it){
    if(it.fuente!=='OPERACION' || !it.chunior_movimiento_id) return;
    const id = String(it.historial_id||it.id||'');
    if(checked) _seleccionLote.add(id); else _seleccionLote.delete(id);
    _pintarFilaSeleccion(id);
  });
  actualizarBarraLote();
}
function limpiarSeleccionLote(){
  const prev = Array.from(_seleccionLote);
  _seleccionLote.clear();
  prev.forEach(_pintarFilaSeleccion);
  const all = document.getElementById("histCheckAll"); if(all) all.checked = false;
  actualizarBarraLote();
}
function actualizarBarraLote(){
  const barra = document.getElementById("barraLoteBilletera");
  const info  = document.getElementById("loteSeleccionInfo");
  const n = _seleccionLote.size;
  if(barra){ barra.classList.toggle("hidden", n===0); if(n>0) barra.style.display='flex'; else barra.style.display=''; }
  if(info)  info.textContent = n+" seleccionado"+(n!==1?"s":"");
  const all = document.getElementById("histCheckAll");
  if(all){
    const totalSel = (_histUnificadoCache||[]).filter(function(it){ return it.fuente==='OPERACION' && it.chunior_movimiento_id; }).length;
    all.checked = totalSel>0 && n>=totalSel;
  }
}

// ── Blacklist 24h ────────────────────────────────────────────────────────────
async function excluirRetiroBlacklist(historialId){
  const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
  if(!h){ toast("No se encontró el retiro.", "red"); return; }
  if(/\[BL_EXCLUIDO\]/.test(String(h.notas||''))){ toast("Ya estaba excluido.", "blue"); return; }
  const nuevasNotas = (String(h.notas||'').trim() + ' [BL_EXCLUIDO]').trim();
  const { error } = await supabaseClient.from("historial_ops").update({ notas: nuevasNotas }).eq("id", h.id);
  if(error){ toast("Error al excluir: "+(error.message||''), "red"); return; }
  h.notas = nuevasNotas;
  toast("🚫 Retiro excluido de la blacklist.", "green");
  renderHistorialUnificado();
}
async function reincluirRetiroBlacklist(historialId){
  const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
  if(!h){ toast("No se encontró el retiro.", "red"); return; }
  const nuevasNotas = String(h.notas||'').replace(/\s*\[BL_EXCLUIDO\]/g,'').trim();
  const { error } = await supabaseClient.from("historial_ops").update({ notas: nuevasNotas }).eq("id", h.id);
  if(error){ toast("Error: "+(error.message||''), "red"); return; }
  h.notas = nuevasNotas;
  toast("↩ Retiro vuelve a contar en la blacklist.", "blue");
  renderHistorialUnificado();
}

// Modal de la Blacklist 24hs — TODOS los usuarios con retiro en las últimas 24hs (todas las
// oficinas, sin filtrar por pcOperativa: buscamos reincidencia CRUZADA entre oficinas), agrupados
// y ordenados por reincidencia. Adoptado del NODO hermano (2026-07-02).
async function mostrarBlacklist24h(dias, diaISO){
  const modoDia = !!(diaISO && /^\d{4}-\d{2}-\d{2}$/.test(String(diaISO)));
  const _dias = Math.max(1, Number(dias)||1);
  window._blState = { dias:_dias, diaISO: modoDia ? String(diaISO) : '' };
  const _lbl = modoDia ? ('día '+String(diaISO)) : (_dias===1 ? 'últimas 24hs' : ('últimos '+_dias+' días'));
  abrirModal('🚫 Blacklist · retiros dobles · '+_lbl,
    '<div style="padding:8px 0;color:var(--muted)">Cargando retiros ('+_lbl+')...</div>', null, 'Cerrar');
  const _sb = document.getElementById('modalSaveBtn'); if(_sb) _sb.style.display = 'none';
  // Misma fuente de flags 🔔/📱 que el CRM (panel_crm_flags, viene del CSV de whaticket/admi) —
  // así el usuario que aparece acá se lee con el mismo contexto que en Jugadores/CRM.
  if(!window._crmFlags && typeof cargarOperacionesAgente === 'function'){
    try{ await cargarOperacionesAgente(); }catch(_e){}
  }

  // Controles (período rodante + día puntual) — se muestran también en el estado vacío.
  const _hoyISO = _blIsoDay(0), _ayerISO = _blIsoDay(1), _anteISO = _blIsoDay(2);
  const _btnDia = function(iso, label){
    const on = modoDia && String(diaISO)===iso;
    return '<button class="mini-btn '+(on?'yellow':'gray')+'" style="font-size:11px" onclick="mostrarBlacklist24h(0,\''+iso+'\')">'+label+'</button>';
  };
  const _controles =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,.08)">'
    +   '<label style="font-size:12px;color:var(--muted)">📅 Período:</label>'
    +   '<select onchange="mostrarBlacklist24h(this.value,\'\')" style="font-size:12px;padding:4px 8px;background:#161b22;border:1px solid #30363d;color:'+(modoDia?'#6b7688':'#e6edf3')+';border-radius:8px">'
    +     [1,2,3,7,15,30].map(function(d){ return '<option value="'+d+'"'+(!modoDia&&_dias===d?' selected':'')+'>'+(d===1?'Últimas 24hs':(d+' días'))+'</option>'; }).join('')
    +   '</select>'
    +   '<span style="color:#3a4356;margin:0 2px">|</span>'
    +   '<label style="font-size:12px;color:var(--muted)">🎯 Día puntual:</label>'
    +   _btnDia(_hoyISO,'Hoy') + _btnDia(_ayerISO,'Ayer') + _btnDia(_anteISO,'Anteayer')
    +   '<input type="date" value="'+(modoDia?String(diaISO):'')+'" max="'+_hoyISO+'" onchange="if(this.value)mostrarBlacklist24h(0,this.value)" style="font-size:12px;padding:3px 6px;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:8px">'
    + '</div>';

  try {
    // Ventana de fetch. En modo día: [día 00:00 − 24h → día 23:59] (retrovisor para el ancla cruzada).
    let desde, hasta, dayStartMs = 0, dayEndMs = 0;
    if(modoDia){
      const p = String(diaISO).split('-').map(Number);
      const ds = new Date(p[0], p[1]-1, p[2], 0, 0, 0, 0);
      const de = new Date(p[0], p[1]-1, p[2], 23, 59, 59, 999);
      dayStartMs = ds.getTime(); dayEndMs = de.getTime();
      desde = new Date(dayStartMs - _BL_H24).toISOString();
      hasta = new Date(dayEndMs).toISOString();
    } else {
      desde = new Date(Date.now() - _dias * _BL_H24).toISOString();
      hasta = new Date().toISOString();
    }

    let { data, error } = await supabaseClient
      .from('historial_ops')
      .select('id, usuario, monto, billetera_nombre, estado, origen, created_at, pc_codigo, notas, chunior_movimiento_id')
      .eq('tipo', 'RETIRO')
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('created_at', { ascending: false })
      .limit(3000);
    if(error) throw error;
    data = (data || []).filter(function(r){
      if(/\[BL_EXCLUIDO\]/.test(String(r.notas||''))) return false;
      if(String(r.estado||'').toUpperCase() === 'REVERTIDA') return false;
      return true;
    });

    const body = document.getElementById('modalBody') || document.querySelector('#modal .modal-body');
    if(!data || !data.length){
      if(body) body.innerHTML = _controles + '<div class="ok-box" style="padding:12px">✅ No hay retiros registrados en '+_lbl+'.</div>';
      return;
    }

    // Agrupar por usuario — clave en MINÚSCULA: "Cristina0735" y "cristina0735" son la misma
    // persona guardada distinto (portal vs manual); si no, el gap pareado no cruza sus retiros.
    const porUsuario = {};
    data.forEach(function(r){
      const u = String(r.usuario || '?');
      const k = u.toLowerCase();
      if(!porUsuario[k]) porUsuario[k] = { usuario:u, count:0, total:0, ultima:r.created_at, pcs:new Set(), retiros:[] };
      const g = porUsuario[k];
      g.count++;
      g.total += Math.abs(Number(r.monto) || 0);
      if(r.created_at > g.ultima) g.ultima = r.created_at;
      if(r.pc_codigo) g.pcs.add(r.pc_codigo);
      g.retiros.push(r);
    });

    // Detección PAREADA de dobles: por usuario, ordenar asc y marcar gap<24h contra el ancla
    // (último retiro NO parcial). Los parciales no anclan ni cuentan.
    Object.values(porUsuario).forEach(function(g){
      g.retiros.sort(function(a,b){ return new Date(a.created_at) - new Date(b.created_at); });
      let anchor = null;
      g.dobles = 0; g.doblesDia = 0;
      g.retiros.forEach(function(r){
        r._t = new Date(r.created_at).getTime();
        r._parcial = _blEsParcial(r);
        r._doble = false; r._gap = null;
        if(r._parcial) return;                 // parcial: no ancla, no doble
        if(anchor){
          r._gap = r._t - anchor._t;
          if(r._gap < _BL_H24){
            r._doble = true; g.dobles++;
            if(!modoDia || (r._t >= dayStartMs && r._t <= dayEndMs)) g.doblesDia++;
          }
        }
        anchor = r;
      });
      g.doblesShow = modoDia ? g.doblesDia : g.dobles;
    });

    let lista = Object.values(porUsuario).sort(function(a,b){
      if(b.doblesShow !== a.doblesShow) return b.doblesShow - a.doblesShow;
      if(b.count !== a.count) return b.count - a.count;
      return b.total - a.total;
    });
    // En modo día solo mostramos usuarios con al menos un doble que aterriza ese día (auditoría).
    let ocultosSingles = 0;
    if(modoDia){
      const conDoble = lista.filter(function(g){ return g.doblesShow >= 1; });
      ocultosSingles = lista.length - conDoble.length;
      lista = conDoble;
    }
    const reincidentes = lista.filter(function(g){ return g.doblesShow >= 1; }).length;

    let filas = '';
    lista.forEach(function(g){
      const dob = g.doblesShow;
      let bg = 'transparent', borde = 'rgba(255,255,255,.08)';
      if(dob >= 2){ bg = 'rgba(220,40,40,.14)';  borde = 'rgba(220,40,40,.5)'; }
      else if(dob === 1){ bg = 'rgba(230,160,40,.12)'; borde = 'rgba(230,160,40,.45)'; }
      const esCross = [...g.pcs].some(function(pc){ return pc && pc !== pcOperativa; });
      const crossBadge = esCross
        ? '<span class="badge badge-danger" style="font-size:9px;padding:2px 6px;margin-left:6px">🚨 otra PC</span>' : '';
      const pcsTxt = [...g.pcs].join(', ') || '—';
      const countBadge = '<span style="display:inline-block;min-width:22px;text-align:center;font-weight:800;border-radius:6px;padding:2px 7px;'
        + (dob>=2?'background:#dc2828;color:#fff':dob===1?'background:#e6a028;color:#1a1205':'background:#2a3344;color:#c0cad8')
        + '">'+dob+'</span>';
      const uKey = 'bl_'+btoa(unescape(encodeURIComponent(g.usuario))).replace(/[^a-zA-Z0-9]/g,'');
      const _fl = (window._crmFlags||{})[String(g.usuario||'').toLowerCase()];
      const flagsTxt = ' <span title="Push: '+(_fl&&_fl.push?'sí':'no')+'" style="opacity:'+(_fl&&_fl.push?1:.28)+'">🔔</span><span title="App instalada: '+(_fl&&_fl.app?'sí':'no')+'" style="opacity:'+(_fl&&_fl.app?1:.28)+'">📱</span>';
      filas += '<tr style="background:'+bg+';border-top:1px solid '+borde+';cursor:pointer" onclick="(function(e){var d=document.getElementById(\''+uKey+'\');if(d)d.classList.toggle(\'hidden\');})()" title="Ver retiros individuales">'
        + '<td style="padding:7px 8px"><span style="color:#7c8aa0">▸</span> <b>'+escapeHtml(g.usuario)+'</b>'+flagsTxt+crossBadge+'</td>'
        + '<td style="padding:7px 8px;text-align:center">'+countBadge+'<div class="small" style="color:#7c8aa0;font-size:10px">'+g.count+' retiros</div></td>'
        + '<td style="padding:7px 8px;text-align:right;white-space:nowrap"><b>'+money(g.total)+'</b></td>'
        + '<td style="padding:7px 8px;font-size:11px;color:#9aa4b2;white-space:nowrap">'+escapeHtml(formatFecha(g.ultima))+'</td>'
        + '<td style="padding:7px 8px;font-size:11px;color:#9aa4b2">'+escapeHtml(pcsTxt)+'</td>'
        + '</tr>';
      let subRetiros = '';
      g.retiros.forEach(function(r){
        // Color: doble = rojo · parcial = azul · normal/ancla = gris. En modo día atenúo el retrovisor.
        const fueraDia = modoDia && (r._t < dayStartMs || r._t > dayEndMs);
        let col = '#c0cad8', barra = 'transparent', tag = '';
        if(r._parcial){ col = '#7aa7ff'; barra = '#3b82f6'; tag = ' <span style="color:#7aa7ff">· parcial (no cuenta)</span>'; }
        else if(r._doble){ col = '#ff9a9a'; barra = '#dc2828'; tag = ' <span style="color:#ff9a9a;font-weight:700">· DOBLE</span>'; }
        const gapTxt = (r._gap!=null)
          ? ' · <span style="color:'+(r._doble?'#ff9a9a':'#7c8aa0')+'">'+_blFmtGap(r._gap)+' del anterior</span>'
          : ' · <span style="color:#7c8aa0">1º del período</span>';
        const nTxt = r.chunior_movimiento_id
          ? '<span style="color:#8fce9b">N° '+escapeHtml(String(r.chunior_movimiento_id))+'</span>'
          : '<span style="color:#7c8aa0">sin N°</span>';
        subRetiros += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0 5px 8px;border-top:1px solid rgba(255,255,255,.06);border-left:3px solid '+barra+';font-size:12px;opacity:'+(fueraDia?'.55':'1')+'">'
          + '<span style="color:'+col+'">'+escapeHtml(formatFecha(r.created_at))+' · <b>'+money(Math.abs(Number(r.monto)||0))+'</b> · '+escapeHtml(r.billetera_nombre||'—')+' · '+nTxt+tag+gapTxt+(fueraDia?' <span style="color:#7c8aa0">(día previo)</span>':'')+'</span>'
          + '<button class="mini-btn yellow" style="font-size:10px" onclick="event.stopPropagation();excluirRetiroBlacklistModal(\''+escapeHtml(String(r.id))+'\',this)">🚫 Quitar</button>'
          + '</div>';
      });
      filas += '<tr id="'+uKey+'" class="hidden"><td colspan="5" style="padding:6px 14px;background:#10141d">'
        + '<div class="small" style="color:var(--muted);margin-bottom:2px">Retiros'+(modoDia?' (incluye 24h previas para el par cruzado)':'')+' — <span style="color:#ff9a9a">DOBLE</span> = &lt;24h del anterior · <span style="color:#7aa7ff">parcial</span> no cuenta · Quitar = excluir:</div>'
        + subRetiros + '</td></tr>';
    });

    if(modoDia && !lista.length){
      if(body) body.innerHTML = _controles
        + '<div class="ok-box" style="padding:12px">✅ Sin retiros dobles el '+String(diaISO)+'.'
        + (ocultosSingles?'<div class="small" style="margin-top:4px;color:var(--muted)">'+ocultosSingles+' usuario(s) con un solo retiro (sin doble).</div>':'')
        + '</div>';
      return;
    }

    if(body) body.innerHTML = _controles
      + '<div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;align-items:center;font-size:13px">'
      +   '<span>👥 <b>'+lista.length+'</b> '+(modoDia?'con doble':'usuarios')+'</span>'
      +   '<span>↩️ <b>'+data.length+'</b> retiros'+(modoDia?' (con retrovisor)':'')+'</span>'
      +   (reincidentes ? '<span style="color:#ffb86b">🔁 <b>'+reincidentes+'</b> con retiro doble</span>' : '')
      +   (modoDia && ocultosSingles ? '<span style="color:#7c8aa0">· '+ocultosSingles+' con 1 solo retiro (ocultos)</span>' : '')
      + '</div>'
      + '<div style="max-height:52vh;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:10px">'
      +   '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      +     '<thead><tr style="position:sticky;top:0;background:#161b26;z-index:1">'
      +       '<th style="padding:8px;text-align:left">Usuario</th>'
      +       '<th style="padding:8px;text-align:center">Dobles</th>'
      +       '<th style="padding:8px;text-align:right">Total</th>'
      +       '<th style="padding:8px;text-align:left">Último</th>'
      +       '<th style="padding:8px;text-align:left">Oficina</th>'
      +     '</tr></thead>'
      +     '<tbody>'+filas+'</tbody>'
      +   '</table>'
      + '</div>';
  } catch(e){
    const body = document.getElementById('modalBody') || document.querySelector('#modal .modal-body');
    if(body) body.innerHTML = '<div class="err-box" style="padding:12px">Error cargando blacklist: '+escapeHtml(e.message||'')+'</div>';
  }
}

// Excluir un retiro desde el modal de blacklist (marca [BL_EXCLUIDO] y recarga el modal).
async function excluirRetiroBlacklistModal(historialId, btn){
  if(btn){ btn.disabled = true; btn.textContent = '...'; }
  try {
    const { data: row } = await supabaseClient.from('historial_ops').select('notas').eq('id', historialId).single();
    const notas = (String(row?.notas||'').trim() + ' [BL_EXCLUIDO]').trim();
    const { error } = await supabaseClient.from('historial_ops').update({ notas }).eq('id', historialId);
    if(error) throw error;
    const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
    if(h) h.notas = notas;
    toast('🚫 Retiro excluido de la blacklist.', 'green');
    const _st = window._blState || { dias:1, diaISO:'' };
    await mostrarBlacklist24h(_st.dias, _st.diaISO);
  } catch(e){
    toast('Error al excluir: '+(e.message||''), 'red');
  }
}

// ── Caché local (por PC) ─────────────────────────────────────────────────────
function _histLocalKey(){ return "nodo_historial_"+(pcOperativa||"sin_pc"); }
function _guardarHistorialLocal(){
  try {
    const full = construirHistorialUnificado().slice(0, 300);
    localStorage.setItem(_histLocalKey(), JSON.stringify({ ts: Date.now(), items: full }));
  } catch(_){}
}
function _cargarHistorialLocal(){
  try {
    const raw = localStorage.getItem(_histLocalKey());
    if(!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && Array.isArray(obj.items)) ? obj.items : null;
  } catch(_){ return null; }
}
function pintarHistorialDesdeCache(){
  const cache = _cargarHistorialLocal();
  if(cache && cache.length) setBox("tablaSolicitudesCompleta", tablaHistorialUnificadoHTML(cache));
}

// ── Cola de cambio de billetera en lote ──────────────────────────────────────
