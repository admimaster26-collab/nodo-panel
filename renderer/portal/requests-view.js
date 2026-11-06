/* Portal: requests-view. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRequestsView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","document","esc","estadoCerrado","fecha","money","renderHistorialUnificado","window"]);
  function create(deps){
const api = {};
  // Los retiros que se están pagando POR PARTES salen de la lista principal y se agrupan en su
  // propio botón: son trabajo en curso (a veces por días) y tapaban las solicitudes nuevas.
  // Al botón 💸 van los retiros CON PROGRESO parcial, estén a medio pagar o ya saldados pero sin
  // cerrar (esos últimos quedaban tapando la lista principal sin forma de sacarlos).
  // UN solo criterio, el mismo que usa el modal al abrirse (NodoDomain.parciales.enProceso).
  // Estaban escritos aparte: el modal decía «saldado» y este filtro lo devolvía a la caja, y al
  // revés — un retiro ya cobrado entero seguía figurando con «falta $38.907» (D-108).
  function esParcial(s){
    try{
      const dom = deps.window.NodoDomain && deps.window.NodoDomain.parciales;
      if(!dom) return false;
      return dom.enProceso(s, {
        info: deps.window._retiroParcialInfo,
        cerrado: deps.window._retiroCerradoAMano,
        estadoCerrado: deps.estadoCerrado,
        sigueAbierto: deps.window._retiroParcialSigueAbierto
      });
    }catch(_e){ return false; }
  }
  // Tres lugares: pagándose por partes, TOMADAS (alguien ya las agarró) y sin tocar. Las dos
  // primeras van al botón 💸 En proceso; la lista principal queda sólo con lo que nadie tocó.
  // La que está en la cola de carga se queda acá: es donde se ve "2º en la cola" / "Cargando…".
  function repartir(abiertas){
    const dom = deps.window.NodoDomain && deps.window.NodoDomain.parciales;
    if(!dom || !dom.repartirAbiertas) return { parciales: [], tomadas: [], pendientes: (abiertas || []).slice() };
    return dom.repartirAbiertas(abiertas, {
      esParcial: esParcial,
      enCola: function(s){ return !!(deps.window._colaCargaEstado || {})[String(s.ID || s.SOLICITUD_ID || '')]; }
    });
  }
  // Lo que nadie tocó, de cualquier lista de solicitudes abiertas. Es la misma cuenta de la lista
  // de Inicio, y la usan el cartel amarillo y el número del menú: si cada uno contaba a su manera,
  // el menú decía 5 y la lista mostraba 2.
  api.nodoSolicitudesSinTocar = function(abiertas){
    try{ return repartir(abiertas).pendientes; }catch(_e){ return (abiertas || []).slice(); }
  };
  function renderSolicitudesPortalEnInicio(){
    const box = deps.document.getElementById("tablaSolicitudesInicio");
    if(!box) return;

    const all = (deps.V154P.solicitudes || []).slice();
    // INICIO: solo muestra CARGA y RETIRO pendientes. SOPORTE va al chat inbox, no acá.
    const abiertas = all.filter(s => (!deps.estadoCerrado(s.ESTADO) || (deps.window._retiroParcialSigueAbierto && deps.window._retiroParcialSigueAbierto(s))) && String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()!=="SOPORTE");
    const _rep = repartir(abiertas);
    const parciales = _rep.parciales, tomadas = _rep.tomadas, pendientes = _rep.pendientes;
    deps.window._parcialesEnProceso = parciales;
    deps.window._tomadasEnProceso = tomadas;
    // El número que ve el operador. Discord muestra ESTE, no uno contado aparte (Juan, 2/11).
    // Va con la lista de la que salió, para no usarlo si la lista cambió y todavía no se redibujó.
    deps.window._nodoPendientesPantalla = { n: pendientes.length, lista: deps.V154P.solicitudes, largo: all.length };
    const _enProceso = parciales.length + tomadas.length;
    try{
      const bp = deps.document.getElementById("btnParcialesEnProceso");
      const bc = deps.document.getElementById("btnParcialesCount");
      if(bc) bc.textContent = String(_enProceso);
      if(bp) bp.style.display = _enProceso ? "" : "none";
      // El mismo botón en el centro de control, que trae sólo el turno actual: un parcial de ayer no
      // aparecía en ningún lado ("tenía una parte para el retiro parcial, no sé por qué no aparece más").
      const bcc = deps.document.getElementById("btnParcialesCC");
      const bccN = deps.document.getElementById("btnParcialesCCCount");
      if(bccN) bccN.textContent = String(_enProceso);
      if(bcc) bcc.style.display = _enProceso ? "" : "none";
    }catch(_e){}
    const visibles = pendientes.slice(0,8);
    // Un mismo jugador con DOS solicitudes abiertas del mismo tipo. El portal lo permitía (se está
    // corrigiendo del lado del portal), pero acá se veían como dos tarjetas sin relación entre sí
    // — y cargar las dos es plata de verdad. La tarjeta ahora lo dice; no bloquea nada, porque a
    // veces son dos transferencias reales.
    const _abiertasPorJugador = {};
    pendientes.forEach(function(x){
      const u = String(x.USUARIO||'').toLowerCase().trim();
      if(!u) return;
      const k = u + '|' + String(x.TIPO||x.TIPO_SOLICITUD||'').toUpperCase();
      _abiertasPorJugador[k] = (_abiertasPorJugador[k]||0) + 1;
    });

    try{
      const stat = deps.document.getElementById("statPendientes");
      if(stat) stat.textContent = String(pendientes.length);
      const badge = deps.document.getElementById("badgeSolicitudes");
      if(badge){
        if(pendientes.length){ badge.classList.remove("hidden"); badge.textContent = String(pendientes.length); }
        else badge.classList.add("hidden");
      }
      const sub = deps.document.getElementById("statRetiros");
      if(sub){
        const retiros = pendientes.filter(s => String(s.TIPO || s.TIPO_SOLICITUD || "").toUpperCase()==="RETIRO").length;
        sub.textContent = "Retiros: " + retiros;
      }
    }catch(e){}

    let html = "";
    if(!visibles.length){
      // "No hay" y "no pude preguntar" NO son lo mismo. Si el último refresco falló, la lista está
      // vacía porque no se pudo traer nada — y afirmarle al operador que no hay solicitudes lo deja
      // tranquilo mientras se le acumulan. El aviso de arriba avisaba, pero esta línea lo tapaba
      // igual, que es justo lo que no puede hacer un motor de verificación (Juan, 30/9).
      const noSePudo = !!(deps.window.V154P && deps.V154P.solicitudesErrorAt);
      html = noSePudo
        ? '<div class="alert-box">No se pudo consultar. <b>Puede haber solicitudes esperando</b> — no es que no haya.</div>'
        : '<div class="alert-box">No hay solicitudes Portal pendientes.</div>';
    }else{
      html = `<div class="small" style="margin:0 0 8px;color:#98a2b3">Mostrando ${pendientes.length} solicitud/es pendiente/s del portal.</div>` + visibles.map(s => {
        const id = Number(s.ID || s.SOLICITUD_ID || 0);
        const tomada = ["EN_REVISION","EN_PROCESO"].includes(String(s.ESTADO||"").toUpperCase());
        const _esRet = String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="RETIRO";
        // Los enums de la base no le dicen nada al operador ("¿ERROR_OPERATIVO qué es?"). Se
        // traducen a lo que significan para él. Lo que no esté mapeado se muestra tal cual, en
        // minúscula, para que se note que falta traducir en vez de gritarle en mayúsculas.
        function _estadoLegible(e){
          const k = String(e||'').toUpperCase().trim();
          // EN_PROCESO es el estado GENERAL de "tomada y trabajándose" — no significa parcial.
          // Sólo se dice "por partes" cuando esta solicitud REALMENTE tiene pagos parciales.
          if(k==='EN_PROCESO'){
            try{
              const pp = deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(s) : null;
              if(pp && pp.hasProg && pp.restante > 0.5) return 'Pagando por partes';
            }catch(_e){}
            return 'En proceso';
          }
          const M = { PENDIENTE:'Sin tomar', NUEVA:'Sin tomar', EN_ESPERA:'Sin tomar',
                      TOMADA:'Tomada', TOMADO:'Tomada', EN_REVISION:'En revisión',
                      PROCESANDO:'Procesando',
                      ERROR_OPERATIVO:'Falló · reintentar', PAGADA:'Pagada', ACREDITADA:'Acreditada',
                      APROBADA:'Aprobada', RECHAZADA:'Rechazada', CANCELADA:'Cancelada' };
          return M[k] || (k ? k.toLowerCase().replace(/_/g,' ') : '—');
        }
        const _saldoChk = (deps.window._retiroSaldoCheck||{})[String(s.USUARIO||"").toLowerCase()];
        const _esRetiroS = String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="RETIRO";
        const _accS = _esRetiroS ? '#fb923c' : (String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="CARGA" ? '#22c55e' : ''); // 🟠 retiro · 🟢 carga
        // Si declaró MÁS de lo que tiene pero igual hay fichas retirables, ofrecemos el retiro por
        // lo que HAY (típico: un cero de más) → abre el modal de parcial ya ajustado al saldo real.
        // Lo MÁXIMO que tiene para retirar. El botón deja la solicitud en ese monto (D-96).
        const _maxS = (_esRetiroS && _saldoChk && !_saldoChk.suficiente && _saldoChk.confiable && deps.window._retiroMaxRetirable)
          ? deps.window._retiroMaxRetirable(_saldoChk.saldo) : 0;
        const _saldoBadge = (_esRetiroS && _saldoChk) ? `<div style="font-size:10px;font-weight:800;margin-top:2px;color:${_saldoChk.suficiente?'#22c55e':'#ef4444'}">saldo ${deps.esc(_saldoChk.raw||"")}${_saldoChk.suficiente?' ✓':' ⚠ no alcanza'}</div>`
          + (_maxS ? `<button class="mini-btn" style="margin-top:3px;background:#ea580c;color:#fff;font-weight:800;font-size:10px" onclick="_retiroAjustarASaldo(${id})" title="Deja la solicitud en ${deps.esc(deps.money(_maxS))}, que es todo lo que tiene para retirar">✔ Retirar ${deps.esc(deps.money(_maxS))}</button>` : "") : "";
        const _pp = (deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(s) : {restante:Number(s.MONTO_REAL||s.MONTO_DECLARADO||0),pagado:0,total:Number(s.MONTO_REAL||s.MONTO_DECLARADO||0),hasProg:false});
        const _montoCell = (_esRetiroS && _pp.hasProg)
          ? `${deps.money(_pp.restante)}<div style="font-size:10px;font-weight:800;margin-top:2px;color:#a78bfa">parcial · pagado ${deps.money(_pp.pagado)} de ${deps.money(_pp.total)}</div>`
          : deps.money(s.MONTO_REAL || s.MONTO_DECLARADO || 0);
        // Avisos de bono sin liberar / CBU compartido. Informativos: no tocan los botones.
        const _alertaHtml = (_esRetiroS && deps.window._alertaRetiroHtml)
          ? deps.window._alertaRetiroHtml(id, { monto: (_pp.hasProg ? _pp.restante : Number(s.MONTO_REAL || s.MONTO_DECLARADO || 0)) })
          : "";
        // ── CAMBIO DE CLAVE ──────────────────────────────────────────────────
        // No es una carga ni un retiro: no hay monto, no hay billetera, no hay "Tomar" ni
        // "Parcial". Lo único que el operador necesita es QUIÉN pidió, QUÉ clave, y un botón
        // para hacerlo. Todo lo demás en esta tarjeta sería ruido.
        // Normalmente ya se ejecutó sola (ver _claveAutoTick en automatizaciones.js): si llegó
        // hasta acá es porque el operador la bloqueó o porque la automática falló.
        if(String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()==="CAMBIO_CLAVE"){
          const _clave = s.PASSWORD_NUEVO || "12345a";
          const _bloq  = !!(deps.window._clavesBloqueadas && deps.window._clavesBloqueadas[String(id)]);
          return `<div class="v154p-card">
            <div>
              <div class="v154p-main">${deps.esc(s.USUARIO || "-")}</div>
              <div class="v154p-small">#${id} · ${deps.fecha(s.FECHA_CREACION)} · ${deps.esc(s.ORIGEN || "PORTAL")}</div>
              <div class="v154p-small" style="color:#c0cad8">pidió cambio de clave</div>
            </div>
            <div><span class="v154p-badge" style="background:#7c3aed22;color:#a78bfa;border:1px solid #7c3aed66">🔑 CLAVE</span></div>
            <div class="v154p-main" style="color:#a78bfa;font-family:ui-monospace,monospace">${deps.esc(_clave)}</div>
            <div><span class="v154p-badge">${_bloq ? "⏸ En pausa" : deps.esc(_estadoLegible(s.ESTADO))}</span></div>
            <div class="v154p-actions">
              <button class="v154p-btn green" onclick="ejecutarAutoClave(${id})">▶ Realizar</button>
            </div>
          </div>`;
        }
        // El jugador no refrescó el portal y transfirió a la billetera anterior. Tiene que
        // verse ACÁ, en la tarjeta, sin desplegar nada: es lo que decide a qué billetera
        // mirar antes de aprobar.
        const _bv = deps.window._billeteraVieja ? deps.window._billeteraVieja(s) : null;
        // ¿Ya está en la cola de carga? Se dice ACÁ y las acciones cambian. Antes la aprobabas,
        // la tarjeta quedaba EXACTAMENTE igual que antes, y se aprobaba de nuevo pensando que el
        // clic se había perdido. Lo único que tiene que cambiar al aceptar es cómo se presenta.
        const _cola = (deps.window._colaCargaEstado || {})[String(id)] || null;
        const _colaCorre = !!(_cola && _cola.estado === 'corriendo');
        const _colaCol = _colaCorre ? '#22c55e' : '#7cc4ff';
        const _borde = _cola
          ? ` style="border-color:${_colaCol};box-shadow:inset 3px 0 0 ${_colaCol}"`
          : (_bv ? ' style="border-color:#f59e0b;box-shadow:inset 3px 0 0 #f59e0b"' : '');
        // "Ya cargada" NO va en la tarjeta: ya tiene cinco botones y es un caso raro (124 en 30
        // días). Vive dentro del modal de rechazo, que es cuando el operador se da cuenta.
        const _acciones = _cola
          ? ((_colaCorre
                ? `<button class="v154p-btn" disabled style="opacity:.55;cursor:default">⚙ Cargando…</button>`
                : `<button class="v154p-btn" onclick="colaCargaQuitar('${_cola.cid}')" style="background:transparent;border:1px solid #7f1d1d;color:#fca5a5">Sacar de la cola</button>`)
             + `<button class="v154p-btn" onclick="v154pDetalleSolicitud(${id},true)">Ver</button>`)
          : ((tomada ? `<button class="v154p-btn yellow" disabled>Tomada</button>`
                     : `<button class="v154p-btn yellow" onclick="v154pTomarSolicitud(${id})">Tomar</button>`)
             // Desde la lista, Aprobar abre el cartel con el monto ya seleccionado para cotejar antes
             // de aprobar. Aprobar de una es sólo adentro de "Ver", donde ya se revisó todo (Juan, 1/11).
             + `<button class="v154p-btn green" onclick="v154pCrearJobSolicitud(${id})">Aprobar</button>`
             + (_esRet ? `<button class="v154p-btn blue" onclick="v154pRegistrarParcial(${id})">💸 Parcial</button>` : "")
             + `<button class="v154p-btn" onclick="v154pDetalleSolicitud(${id},true)">Ver</button>`
             + `<button class="v154p-btn red" onclick="v154pRechazarSolicitud(${id})">Rechazar</button>`);
        const _dup = _abiertasPorJugador[String(s.USUARIO||'').toLowerCase().trim() + '|'
                   + String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()] || 0;
        return `<div class="v154p-card" id="v154pCard${id}"${_borde}>
          <div>
            <div class="v154p-main">${deps.esc(s.USUARIO || "-")}</div>
            ${_dup > 1 ? `<div style="margin:3px 0;font-size:10.5px;font-weight:900;color:#fca5a5;background:rgba(239,68,68,.12);border:1px solid #ef444455;border-radius:6px;padding:2px 6px;display:inline-block">⚠ ${_dup} solicitudes abiertas de este jugador — mirá que no sea la misma transferencia</div>` : ""}
            ${_bv ? `<div style="margin:3px 0;font-size:10.5px;font-weight:900;color:#fbbf24;background:rgba(245,158,11,.12);border:1px solid #f59e0b55;border-radius:6px;padding:2px 6px;display:inline-block">⚠ Transfirió a ${deps.esc(_bv.vieja)} · ahora ${deps.esc(_bv.actual)}</div>` : ""}

            <div class="v154p-small">#${id} · ${deps.fecha(s.FECHA_CREACION)} · ${deps.esc(s.ORIGEN || "PORTAL")}</div>
            ${s.TITULAR ? `<div class="v154p-small" style="color:#fde68a">Titular: ${deps.esc(s.TITULAR)}${(function(){
              // Si ese titular está bloqueado (ficha del jugador), que se vea ACÁ, que es donde
              // el operador decide. Informa: no deshabilita ni rechaza nada por su cuenta.
              try{
                const b = deps.window.titularBloqueado ? deps.window.titularBloqueado(s.USUARIO||'', s.TITULAR) : null;
                if(!b) return '';
                return ' <span title="'+deps.esc(b.motivo||'')+'" style="background:#7f1d1d;color:#fecaca;border-radius:999px;padding:1px 7px;font-size:9px;font-weight:900">🚫 '+(b.global?'BLOQUEADO · TODAS':'BLOQUEADO')+'</span>';
              }catch(_e){ return ''; }
            })()}</div>` : ""}
          </div>
          <div><span class="v154p-badge"${_accS?` style="background:${_accS}22;color:${_accS};border:1px solid ${_accS}66"`:``}>${deps.esc(s.TIPO || "-")}</span></div>
          <div class="v154p-main"${_accS?` style="color:${_accS}"`:``}>${_montoCell}${_saldoBadge}</div>
          <div>${_cola
            ? `<span class="v154p-badge" style="background:${_colaCorre?'rgba(34,197,94,.15)':'rgba(124,196,255,.12)'};color:${_colaCol};border:1px solid ${_colaCorre?'rgba(34,197,94,.35)':'rgba(124,196,255,.35)'}">${_colaCorre?'⚙ Cargando…':'🕒 '+_cola.pos+'º en la cola'}</span>`
            : `<span class="v154p-badge">${deps.esc(_estadoLegible(s.ESTADO))}</span>`}</div>
          <div class="v154p-actions">${_acciones}</div>
          ${_alertaHtml ? `<div style="grid-column:1/-1">${_alertaHtml}</div>` : ""}
        </div>`;
      }).join("");
    }

    // No repintar si el HTML no cambió: evita el parpadeo de intervalos/realtime.
    if(deps.V154P.solicitudesLastHtml !== html){
      box.innerHTML = html;
      deps.V154P.solicitudesLastHtml = html;
      deps.V154P.solicitudesLastRenderAt = Date.now();
    }
  }

  function renderSolicitudesPortalCompleto(){
    const box = deps.document.getElementById("tablaSolicitudesCompleta");
    if(!box) return;
    // ⛔ La tabla propia de solicitudes SE INTERPONÍA al Historial completo: cada poll del portal
    // re-pintaba este contenedor con la vista vieja (Titular + Ver) pisando la tabla unificada
    // (con multi-select + cambio de billetera en lote). Las PENDIENTES ya viven en el Inicio →
    // acá SIEMPRE delegamos en el historial unificado (portado de NexoBetaChan · "tal cual mi nodo").
    try{ if(typeof deps.renderHistorialUnificado === 'function'){ deps.renderHistorialUnificado(); return; } }catch(_e){}
    return;
  }


// Cartel de "esto está viejo". Vive FUERA de la tabla porque la tabla se repinta entera
// y se lo llevaría puesto. Se define acá arriba porque la primera carga puede fallar
// antes de que el render haya corrido una sola vez — y ese es justo el caso que importa.
// El cartel ya no se dibuja: va a la CONSOLA. Decía la verdad — sólo aparece cuando la consulta
// falla de verdad — pero el operador se pasaba el turno mirándolo y apretando el botón por algo
// que no podía resolver. Lo que hace falta es que el dato esté donde yo lo pueda ir a buscar sin
// preguntarle a nadie (Juan, 2/10). `verDesfasaje()` en la consola de cualquier PC lo devuelve.
//
// Lo que SÍ queda en pantalla es que la caja vacía no mienta: si no se pudo consultar, no puede
// decir "no hay solicitudes". Eso no es un cartel que moleste, es la lista diciendo la verdad.
const _desfasajes = [];
api._v154pAvisoDesfasaje = function(motivo){
  if(!motivo) return;
  const desde = (deps.window.V154P && (deps.V154P.solicitudesOkAt || deps.V154P.solicitudesLastRenderAt)) || 0;
  const min = desde ? Math.round((Date.now()-desde)/60000) : null;
  // Escrito para el que está atendiendo, no para nosotros. Decía "no la tomes como la foto de
  // ahora" y "el servidor rechazó la consulta": nadie en una oficina sabe qué hacer con eso.
  // Lo que el operador necesita saber son tres cosas, en este orden:
  //   qué le falta (puede haber solicitudes que no ve) · desde cuándo · que no tiene que hacer nada.
  // Sin lo último apretaba el botón una y otra vez creyendo que era la única forma de destrabarlo.
  const esRed = !!(deps.window.V154P && deps.V154P.solicitudesEsRed);
  const reg = {
    t: new Date().toISOString(),
    pc: String(deps.window.pcOperativa || ''),
    causa: esRed ? 'conexion' : 'servidor',
    minutosSinActualizar: min,
    motivo: String(motivo).slice(0, 300)
  };
  _desfasajes.push(reg);
  if(_desfasajes.length > 200) _desfasajes.shift();
  console.warn('[bandeja] no se pudo refrescar', reg);
};
// Para leerlo desde la consola de cualquier PC, sin molestar a quien esté atendiendo.
api.verDesfasaje = function(){
  if(!_desfasajes.length){ console.log('[bandeja] sin fallas registradas'); return []; }
  console.table(_desfasajes.slice(-50));
  return _desfasajes.slice();
};

    return { globals: api, renderSolicitudesPortalEnInicio, renderSolicitudesPortalCompleto };
  }
  return Object.freeze({ create, dependencies });
});
