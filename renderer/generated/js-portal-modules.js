/* Portal: data. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","localStorage","window"]);
  function create(deps){
const api = {};
  function esc(v){
    return String(v ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function money(v){
    try{return Number(v||0).toLocaleString("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});}
    catch(e){return "$"+String(v||0);}
  }

  function fecha(v){
    if(!v) return "";
    try{
      return new Date(v).toLocaleString("es-AR",{
        timeZone:"America/Argentina/Buenos_Aires",
        day:"2-digit",
        month:"2-digit",
        hour:"2-digit",
        minute:"2-digit"
      }).replace(","," ·");
    }catch(e){return String(v||"");}
  }

  function normArr(data){
    if(Array.isArray(data)) return data;
    if(Array.isArray(data?.data)) return data.data;
    if(Array.isArray(data?.data?.data)) return data.data.data;
    if(Array.isArray(data?.mensaje)) return data.mensaje;
    if(Array.isArray(data?.mensajes)) return data.mensajes;
    if(Array.isArray(data?.chats)) return data.chats;
    if(Array.isArray(data?.solicitudes)) return data.solicitudes;
    if(Array.isArray(data?.items)) return data.items;
    if(Array.isArray(data?.rows)) return data.rows;
    if(data && typeof data === "object" && Object.keys(data).every(k => /^\d+$/.test(k))) return Object.values(data);
    return [];
  }

  async function getCanal(){
    // MULTI-OFICINA: la oficina la MANDA pcOperativa (resuelto del login de Chunior).
    // El ctx viene del .env y trae default "P1" fijo, así que NO debe pisar a la oficina dinámica.
    try{
      let pc = String(deps.window.pcOperativa || deps.window.landingPcCodigo || "").toUpperCase();
      if(!pc){
        const ctx = await deps.window.panelAPI?.getContext?.();
        pc = String(ctx?.landing_pc || ctx?.LANDING_PC_CODIGO || deps.localStorage.getItem("panel_v154_landing_pc") || "").toUpperCase();
      }
      if(pc){ deps.V154P.pcActual = pc; return pc; }
    }catch(e){}
    const pc = String(deps.window.pcOperativa || deps.window.landingPcCodigo || deps.localStorage.getItem("panel_v154_landing_pc") || "P1").toUpperCase();
    deps.V154P.pcActual = pc;
    return pc;
  }

  async function rpc(fn, params){
    const health = deps.window.NodoSalud?.begin('PORTAL');
    try{
      if(deps.window.panelAPI?.rpc){
        const res = await deps.window.panelAPI.rpc(fn, params || {});
        health?.reply(res?.error);
        if(!res?.error) health?.record('DATA', 'OK', 'PORTAL_RPC_OK');
        return res;
      }
    }catch(e){
      health?.reply(e);
      return {data:null,error:{message:e.message || String(e),code:e.code}};
    }
    health?.reply({message:"panelAPI.rpc no disponible"});
    return {data:null,error:{message:"panelAPI.rpc no disponible"}};
  }

  function estadoCerrado(e){
    e = String(e || "").toUpperCase();
    return ["ACREDITADA","PAGADA","APROBADA","RECHAZADA","CANCELADA","CERRADA","FINALIZADA"].includes(e);
  }

  function mapSolicitudPortal(s){
    const meta = s.metadata || {};
    const id = s.id || s.ID || s.solicitud_id || "";
    const compUrl = meta.comprobante_url || meta.imagen_url || s.comprobante_url || s.imagen_url || s.COMPROBANTE_URL || s.IMAGEN_URL || "";
    return {
      ID: id,
      SOLICITUD_ID: id,
      COMPROBANTE_URL: compUrl,
      IMAGEN_URL: compUrl,
      FECHA_CREACION: s.created_at || s.FECHA_CREACION || s.fecha,
      FECHA: s.created_at || s.FECHA || s.fecha,
      TIPO_SOLICITUD: String(s.tipo || s.TIPO || "").toUpperCase(),
      TIPO: String(s.tipo || s.TIPO || "").toUpperCase(),
      USUARIO: s.usuario || s.USUARIO || "",
      USUARIO_JUGADOR: s.usuario || s.USUARIO || "",
      NOMBRE_COMPLETO: meta.titular || s.titular || s.nombre_completo || "",
      // El portal V16 manda el teléfono DENTRO de p_metadata, no como columna: la columna llega
      // vacía en todas las solicitudes del portal (verificado contra la base). Sin este fallback
      // el panel perdía el teléfono de cada carga/retiro — y con él el cotejo del alta, la ficha
      // del CRM y lo que se le manda a Nexo.
      TELEFONO: s.telefono || meta.telefono || "",
      // IP pública desde la que se mandó la solicitud. NODO no la guarda en ningún lado propio:
      // se lee de la solicitud que ya está en memoria y se reenvía a Nexo, que es la base donde
      // esto se acumula. Acá es de paso, a propósito.
      IP: meta.ip || "",
      PC: s.pc_codigo || s.PC || "",
      MONTO_DECLARADO: Number(s.monto || s.MONTO || 0),   // lo que tecleó el cliente, no se pisa
      // MONTO_REAL = lo que realmente se va a pagar. Si el operador corrigió un cero de más
      // (_retiroAjustarASaldo), ese monto manda: de acá lo toman la tarjeta, el modal y el historial.
      MONTO_REAL: Number(meta.monto_corregido != null ? meta.monto_corregido : (s.monto || s.MONTO || 0)),
      ESTADO: s.estado || s.ESTADO || "",
      BILLETERA_NOMBRE: meta.billetera_nombre || meta.billetera || meta.destino || "",
      ID_BILLETERA: meta.billetera_id || "",
      CHAT_ID: s.chat_id || meta.chat_id || "",
      OPERADOR: s.tomada_por_operador_nombre || s.operador_usuario || s.operador || meta.operador || "",
      // Mismo caso que TELEFONO: el portal manda la clave DENTRO de p_metadata, y
      // landing_solicitudes no tiene columna password_nuevo. Leyendo sólo la columna, la clave
      // que eligió la persona se perdía siempre y el cambio caía al default "12345a".
      PASSWORD_NUEVO: s.password_nuevo || meta.password_nuevo || "",
      ORIGEN: s.origen || "PORTAL_V16",
      TITULAR: meta.titular || "",
      DESTINO: meta.destino || "",
      SALDO_PRE: meta.saldo_pre ?? meta.saldoPre ?? null,
      SALDO_POST: meta.saldo_post ?? meta.saldoPost ?? null,
      HISTORIAL_ID: meta.historial_id || meta.historialId || null,
      MENSAJE_INICIAL: s.mensaje_inicial || "",
      // Datos de la cuenta EXACTA a la que el cliente dice haber transferido. Ya venían en el
      // metadata del portal y nadie los leía: sirven para cotejar el depósito contra el banco
      // y para responder "¿a qué alias mandaste?" sin abrir la solicitud.
      BILLETERA_ALIAS: meta.billetera_alias || "",
      BILLETERA_CBU: meta.billetera_cbu || "",
      BILLETERA_TITULAR: meta.billetera_titular || "",
      NAVEGADOR: meta.navegador || "",      // dispositivo/navegador del cliente (soporte)
      metadata: s.metadata || {},
      METADATA: s.metadata || {}
    };
  }

    return { globals: api, esc, money, fecha, normArr, getCanal, rpc, estadoCerrado, mapSolicitudPortal };
  }
  return Object.freeze({ create, dependencies });
});
/* Portal: withdrawal-alerts. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalWithdrawalAlerts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["esc","estadoCerrado","money","pcOperativa","renderSolicitudesPortalEnInicio","supabaseClient","window"]);
  function create(deps){
const api = {};
  // ══════════════════════════════════════════════════════════════════════════
  // ALERTAS DE RETIRO · SOLO INFORMAN, NO BLOQUEAN
  // Dos datos que el operador no tenía forma de ver al aprobar un retiro:
  //   1. BONO SIN LIBERAR — el usuario cobró bono de primer ingreso hace poco. El bono
  //      no es retirable hasta jugarlo 2x, pero para la plataforma son fichas comunes.
  //      Clave: en el 67% de los casos el retiro lo paga OTRO turno, que no sabe del bono.
  //   2. CBU REPETIDO — ese CBU ya lo usaron otras cuentas (multicuenta). El CBU es el
  //      único dato que no se puede falsear: la plata tiene que caer en una cuenta real.
  // NINGUNA deshabilita botones ni corta el flujo. El operador ve el aviso y decide.
  // Fuente: RPC panel_retiro_alertas — una sola llamada para toda la lista pendiente.
  // ══════════════════════════════════════════════════════════════════════════
  deps.window._retiroAlertas   = deps.window._retiroAlertas || {};   // { [solicitudId]: fila }
  deps.window._retiroAlertasAt = deps.window._retiroAlertasAt || 0;
  const _ALERTA_BONO_HS   = 7*24;  // el aviso de bono vive 7 días; después es ruido
  const _ALERTA_CBU_ROJO  = 3;     // 2 cuentas suele ser familia; 3 ya no

  async function cargarAlertasRetiro(force){
    try{
      if(typeof deps.supabaseClient === 'undefined' || !deps.supabaseClient) return;
      // Cada 5 min, no cada minuto. Con varias PCs por oficina el minuto daba ~30
      // consultas/minuto sobre landing_solicitudes (97k filas + lateral join) y la RPC
      // empezó a dar statement timeout. Un retiro pendiente no cambia de estado en 60 s,
      // así que refrescar tan seguido no aportaba nada. Al abrir el modal se pide con
      // force:true, que es el momento donde el dato tiene que estar fresco de verdad.
      if(!force && (Date.now() - deps.window._retiroAlertasAt) < 5*60*1000) return;
      const ids = ((deps.window.V154P && deps.window.V154P.solicitudes) || [])
        .filter(function(s){
          if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase() !== 'RETIRO') return false;
          if(typeof deps.estadoCerrado === 'function' && deps.estadoCerrado(s.ESTADO)) return false;
          return true;
        })
        .map(function(s){ return Number(s.ID || s.SOLICITUD_ID || 0); })
        .filter(function(n){ return n > 0; })
        .slice(0, 60);
      deps.window._retiroAlertasAt = Date.now();
      if(!ids.length){ deps.window._retiroAlertas = {}; return; }
      const { data, error } = await deps.supabaseClient.rpc('panel_retiro_alertas', {
        p_secret: deps.window.PANEL_DATA_SECRET,
        p_pc_codigo: (typeof deps.pcOperativa !== 'undefined' ? deps.pcOperativa : '') || deps.window.pcOperativa || '',
        p_solicitud_ids: ids
      });
      if(error){ console.warn('[alertas retiro]', error.message || error); return; }
      const m = {};
      (data||[]).forEach(function(r){ m[String(r.solicitud_id)] = r; });
      deps.window._retiroAlertas = m;
      try{ deps.renderSolicitudesPortalEnInicio(); }catch(_e){}
    }catch(e){ console.warn('[alertas retiro]', e); }
  }
  api.cargarAlertasRetiro = cargarAlertasRetiro;

  // HTML de las alertas de UNA solicitud. Devuelve '' si no hay nada que avisar.
  // opts.monto     → monto de este retiro, para calcular cuánto se lleva de más
  // opts.expandido → versión detallada (modal) en vez de la compacta (tarjeta)
  api._alertaRetiroHtml = function(solicitudId, opts){
    try{
      const a = (deps.window._retiroAlertas||{})[String(solicitudId)];
      if(!a) return '';
      opts = opts || {};
      const exp = !!opts.expandido;
      const chips = [];

      // ── 1 · Bono sin liberar ──────────────────────────────────────────
      const bono = Number(a.bono_monto||0);
      const hs   = Number(a.bono_horas||0);
      if(bono > 0 && hs <= _ALERTA_BONO_HS){
        const cargado  = Number(a.cargado_real||0);
        const retirado = Number(a.retirado_previo||0);
        const pedido   = Math.abs(Number(opts.monto||0));
        const deMas    = (retirado + pedido) - cargado;
        const cuando   = hs < 24 ? (hs.toFixed(1)+' h') : (Math.round(hs/24)+' d');
        let txt = '🎁 <b>BONO SIN LIBERAR</b> · '+deps.esc(deps.money(bono))+' hace '+cuando;
        if(exp){
          txt += '<div style="margin-top:4px;font-weight:600">Cargó '+deps.esc(deps.money(cargado))
               + ' · ya retiró '+deps.esc(deps.money(retirado))
               + (pedido ? (' · pide '+deps.esc(deps.money(pedido))) : '')
               + (deMas > 0 ? ('<br><b style="color:#fbbf24">Con este retiro se lleva '+deps.esc(deps.money(deMas))+' por encima de lo que cargó</b>') : '')
               + '<br><span style="opacity:.8">El bono debe jugarse 2× antes de retirarse — verificá antes de aprobar.</span></div>';
        } else if(deMas > 0){
          txt += ' · se lleva <b>'+deps.esc(deps.money(deMas))+'</b> de más';
        }
        chips.push({ txt: txt, color: '#fbbf24', bg: 'rgba(251,191,36,.12)', bd: 'rgba(251,191,36,.4)' });
      }

      // ── 2 · CBU repetido ──────────────────────────────────────────────
      const cuentas = Number(a.cbu_cuentas||0);
      if(cuentas >= 2){
        const rojo  = cuentas >= _ALERTA_CBU_ROJO;
        const otras = cuentas - 1;
        let txt = '🔗 <b>CBU COMPARTIDO</b> · '+otras+' cuenta'+(otras===1?'':'s')+' más cobra'+(otras===1?'':'n')+' a este CBU';
        if(a.cbu_titular) txt += ' · <b>'+deps.esc(String(a.cbu_titular))+'</b>';
        if(exp){
          txt += '<div style="margin-top:4px;font-weight:600;word-break:break-all">'+deps.esc(String(a.cbu_usuarios||''))+'</div>'
               + '<div style="margin-top:3px;opacity:.8;font-weight:600">CBU '+deps.esc(String(a.cbu||''))+'</div>'
               + (rojo ? '<div style="margin-top:3px;opacity:.8;font-weight:600">3 o más cuentas al mismo CBU no se explica por familia.</div>'
                       : '<div style="margin-top:3px;opacity:.8;font-weight:600">2 cuentas puede ser familia o pareja — revisá antes de decidir.</div>');
        }
        chips.push(rojo
          ? { txt: txt, color: '#fca5a5', bg: 'rgba(239,68,68,.14)', bd: 'rgba(239,68,68,.45)' }
          : { txt: txt, color: '#fde68a', bg: 'rgba(234,179,8,.10)', bd: 'rgba(234,179,8,.35)' });
      }

      if(!chips.length) return '';
      const est = exp ? 'display:block;margin:6px 0;padding:9px 11px;font-size:12px'
                      : 'display:block;margin-top:3px;padding:5px 8px;font-size:11px';
      return chips.map(function(c){
        return '<span style="'+est+';border-radius:9px;background:'+c.bg+';border:1px solid '+c.bd+';color:'+c.color+';font-weight:800;line-height:1.4">'+c.txt+'</span>';
      }).join('');
    }catch(_e){ return ''; }
  };

    return { globals: api, cargarAlertasRetiro };
  }
  return Object.freeze({ create, dependencies });
});
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
/* Portal: requests. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRequests = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","_portalAutoRechazar","_v154pAvisoDesfasaje","alert","cargarAlertasRetiro","document","esc","getCanal","mapSolicitudPortal","money","normArr","operador","renderInicio","renderSolicitudesPortalCompleto","renderSolicitudesPortalEnInicio","rpc","setTimeout","solicitudes","toast","verificarSolicitudes","window"]);
  function create(deps){
const api = {};
// A successful transport is not evidence that the server supplied a usable list.
// Match the legacy envelopes accepted by data.normArr, without turning null/errors into [].
function _listaSolicitudesValida(data){
  const options=[data,data?.data,data?.data?.data,data?.mensaje,data?.mensajes,data?.chats,
    data?.solicitudes,data?.items,data?.rows];
  let rows=options.find(Array.isArray);
  if(!rows && data && typeof data==='object' && Object.keys(data).length && Object.keys(data).every(k=>/^\d+$/.test(k)))rows=Object.values(data);
  return !!rows && rows.every(row=>row && typeof row==='object' && !Array.isArray(row)
    && (row.id!=null || row.ID!=null || row.solicitud_id!=null));
}
// Leer la bandeja no reintentaba NADA, mientras que escribir (actualizarSolicitudPortal) ya
// reintenta 3 veces ante fallos de red, por "la mirror con proxy que pestañea". En una oficina con
// la red inestable eso deja la bandeja congelada: el operador ve "Esta lista está desactualizada",
// no le entra ninguna carga, y tiene que apretar Reintentar a mano hasta que una pega — y ahí le
// entran todas juntas. Reportado por OFI-SAN el 29/9 a las 21:10, y el cartel no mentía.
//
// Ahora la lectura reintenta igual que la escritura, y si aun así falla se vuelve a intentar sola
// con esperas cada vez más largas. Sin esto, entre intento e intento pasaban los 60 s del reloj de
// la bandeja, que es una eternidad con gente esperando que le carguen.
function _esErrorDeRed(e){
  const m = String((e && (e.message || e)) || '').toLowerCase();
  // "canceling statement due to statement timeout" NO es la red: es el servidor cortando una
  // consulta que tardó más de lo que tiene permitido (el panel entra como anon, con 3 s de tope).
  // Contenía la palabra "timeout" y caía acá, así que el cartel decía "se cortó la conexión" y se
  // reintentaba tres veces seguidas contra una base que ya estaba ahogada — empujando para el lado
  // equivocado. Se vio en la consola de Sánchez el 2/10 con el error desplegado.
  if(/statement timeout|canceling statement/.test(m)) return false;
  return /fetch failed|failed to fetch|network|timeout|econn|socket|load failed|networkerror/.test(m);
}
// Cada cambio de estado se traía la bandeja ENTERA otra vez, y encima la esperaba. En P4 la
// respuesta pesa 427 kB —cuatro veces la de P3, P6, P7 o P9— y una carga hace cuatro o cinco
// cambios de estado. Con 117 cargas en dos horas y media son 195 MB, unos 624 MB en un turno de
// ocho, bajados por una conexión de oficina para repintar una lista que casi nunca cambió.
// Es la explicación más probable de por qué a esa PC se le corta la bandeja y a las otras no.
//
// Ahora se refresca UNA vez cuando la ráfaga termina, y sin esperarla: el resultado de la
// operación no depende de que la lista esté repintada. Donde sí hace falta tenerla fresca, el
// llamador la pide él mismo (operation-execution.js ya lo hace en los puntos que importan).
let _refrescoPedido = null;
function refrescarBandejaPronto(){
  if(_refrescoPedido) return;
  _refrescoPedido = deps.setTimeout(function(){
    _refrescoPedido = null;
    try{ cargarSolicitudesPortal(true); }catch(_e){}
  }, 1200);
}

let _reintentoTimer = null, _reintentoNro = 0;
function _cancelarReintento(){
  if(_reintentoTimer){
    try{ deps.window.clearTimeout(_reintentoTimer); }catch(_e){}
    _reintentoTimer = null;
  }
  _reintentoNro = 0;
}
function _programarReintento(){
  if(_reintentoTimer) return;                                  // ya hay uno en camino
  _reintentoNro = Math.min(_reintentoNro + 1, 4);
  const espera = Math.min(8000 * Math.pow(2, _reintentoNro - 1), 60000);  // 8s · 16s · 32s · 60s
  _reintentoTimer = deps.setTimeout(function(){
    _reintentoTimer = null;
    try{ cargarSolicitudesPortal(true); }catch(_e){}
  }, espera);
}

// Refresco de los retiros sostenidos: corre DESPUÉS de pintar y fuera del cierre anti-solapamiento,
// así no puede clavar la bandeja. Con tope de cuántos y con límite de espera por cada uno — sin el
// límite, una sola llamada colgada volvía a dejar todo esperando, que es lo que se vino a arreglar.
const TOPE_SOSTENIDOS = 8;
const ESPERA_SOSTENIDO_MS = 6000;
let _sostenidosCorriendo = false;
async function refrescarSostenidos(lista){
  if(_sostenidosCorriendo || !lista || !lista.length) return;
  _sostenidosCorriendo = true;
  let cambio = false;
  try{
    for(const c of lista.slice(0, TOPE_SOSTENIDOS)){
      let fresco = null;
      try{
        const rp = await Promise.race([
          deps.rpc('landing_retiro_progreso', { p_solicitud_id: Number(c.id) }),
          new Promise(res => deps.setTimeout(function(){ res({ error:{ message:'timeout' } }); }, ESPERA_SOSTENIDO_MS))
        ]);
        const row = Array.isArray(rp && rp.data) ? rp.data[0] : (rp && rp.data);
        if(!(rp && rp.error) && row && row.ok !== false) fresco = row;
      }catch(_e){}
      // Sin respuesta de la base NO se suelta: un retiro con plata debida no puede perderse de
      // vista por un error de red. Se queda como está y se vuelve a preguntar en el próximo ciclo.
      if(!fresco) continue;
      try{
        let m = (c.v.METADATA !== undefined ? c.v.METADATA : c.v.metadata) || {};
        if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ m = {}; } }
        const rpPrev = (m && m.retiro_parcial) || {};
        const rpNuevo = Object.assign({}, rpPrev, {
          total: Number(fresco.total) || rpPrev.total,
          pagado: Number(fresco.pagado) || 0
        });
        if(fresco.pagos) rpNuevo.pagos = fresco.pagos;
        if(fresco.cierre) rpNuevo.cierre = fresco.cierre;
        const mNuevo = Object.assign({}, m, { retiro_parcial: rpNuevo });
        c.v.metadata = mNuevo; c.v.METADATA = mNuevo;
        if(fresco.estado) c.v.ESTADO = String(fresco.estado);
        cambio = true;
      }catch(_e){}
      // Saldado o cerrado en la base → se suelta. Es lo que antes no podía pasar nunca.
      const restante = Number(fresco.restante);
      if(fresco.cierre || (Number.isFinite(restante) && restante <= 0.5)){
        console.warn('[portal] retiro #'+c.id+' ya está saldado o cerrado en la base — se suelta');
        deps.V154P.solicitudes = (deps.V154P.solicitudes||[])
          .filter(function(x){ return String(x.ID||x.SOLICITUD_ID||'') !== String(c.id); });
        cambio = true;
      }
    }
  }finally{ _sostenidosCorriendo = false; }
  if(cambio){
    deps.window.solicitudes = (deps.V154P.solicitudes||[]).slice();
    try{ deps.renderSolicitudesPortalEnInicio(); }catch(_e){}
    try{ deps.renderSolicitudesPortalCompleto(); }catch(_e){}
  }
}

async function cargarSolicitudesPortal(silencioso=false){
    // SAFE: anti-solapamiento. Si hay una carga en curso, dejamos una sola cola.
    if(deps.V154P.solicitudesLoading){
      deps.V154P.solicitudesQueued = true;
      return {ok:true, skipped:true, reason:"solicitudes_loading"};
    }
    deps.V154P.solicitudesLoading = true;
    const health=deps.window.NodoSalud?.begin('BANDEJA');
    let healthStage='DATA';
    try{
      const canal = await deps.getCanal();
      // Sólo se insiste ante fallos de RED. Si el servidor contesta y rechaza, insistir no arregla
      // nada y sólo demora el aviso.
      let r = null;
      const _pApi = deps.window && deps.window.panelAPI;
      let _useBetaBandeja = false;
      if(_pApi && typeof _pApi.rpc === 'function' && canal){
        try{
          deps.V154P._bandejaCapCache = deps.V154P._bandejaCapCache || {};
          const _pcUp = String(canal).trim().toUpperCase();
          if(typeof _pApi.getContext === 'function'){
            const _rawCtx = await _pApi.getContext();
            const _ctx = (_rawCtx && _rawCtx.beta) ? _rawCtx.beta : _rawCtx;
            if(_ctx && _ctx.enabled === true && (!Array.isArray(_ctx.offices) || _ctx.offices.includes(_pcUp))){
              if(deps.V154P._bandejaCapCache[_pcUp] === undefined){
                const _capRes = await _pApi.rpc('nodo_beta_capacidades_v1', { p_pc_codigo: _pcUp, p_activate: false });
                const _capData = _capRes && _capRes.data;
                const _caps = (_capData && Array.isArray(_capData.capabilities)) ? _capData.capabilities : [];
                deps.V154P._bandejaCapCache[_pcUp] = !!(_capData && _capData.ok === true && _capData.enabled === true && _caps.includes('bandeja.queue.v1'));
              }
              _useBetaBandeja = deps.V154P._bandejaCapCache[_pcUp] === true;
            }
          }
        }catch(_e){ _useBetaBandeja = false; }
      }
      if(_useBetaBandeja){
        const _br = await _pApi.rpc('nodo_beta_bandeja_v1', { p_pc_codigo: String(canal).trim().toUpperCase(), p_filtros: {}, p_limit: 100, p_cursor: null });
        if(_br && !_br.error && _br.data && _br.data.ok === true && Array.isArray(_br.data.operativas)){
          deps.V154P.bandejaTotales = _br.data.totales || null;
          deps.V154P.bandejaHasMore = !!_br.data.has_more;
          deps.V154P.bandejaNextCursor = _br.data.next_cursor || null;
          r = { data: _br.data.operativas, error: null };
          health?.reply(null);
        } else if(_br && _br.error && (_br.error.code === 'PGRST202' || _br.error.code === '42883')){
          _useBetaBandeja = false;
        } else if(_br){
          r = _br;
          health?.reply(r?.error);
        }
      }
      for(let intento = 1; !_useBetaBandeja && intento <= 3; intento++){
        r = await deps.rpc("panel_v15_5_listar_solicitudes_portal", {p_pc_codigo: canal});
        health?.reply(r?.error);
        if(!r?.error || !_esErrorDeRed(r.error)) break;
        if(intento < 3) await new Promise(res => deps.setTimeout(res, 500 * intento));
      }

      if(health && !health.current())return {error:{code:'STALE_OFFICE',message:'La oficina cambió durante la consulta.'}};
      if(!r?.error && !_listaSolicitudesValida(r?.data)){
        r={data:null,error:{code:'BANDEJA_INVALID_DATA',message:'El servidor no devolvió una lista válida de solicitudes.'}};
      }
      if(r?.error){
        health?.record('DATA','ERROR',r.error.code==='BANDEJA_INVALID_DATA'?'BANDEJA_INVALID_DATA':health.errorCode(r.error));
        const msg = r.error.message || JSON.stringify(r.error);
        const box = deps.document.getElementById("tablaSolicitudesInicio");
        if(box && !deps.V154P.solicitudesLastHtml){
          box.innerHTML = `<div class="alert-box">Error solicitudes Portal: ${deps.esc(msg)}</div>`;
        }
        // Si ya había una lista pintada, se deja en pantalla para no vaciar la bandeja —
        // pero AVISANDO que está vieja. Sin esto los datos viejos se ven igual que los
        // frescos, y se puede aprobar dos veces algo que ya se resolvió.
        deps.V154P.solicitudesErrorAt = Date.now();
        deps.V154P.solicitudesEsRed = _esErrorDeRed(r.error);
        try{ deps._v154pAvisoDesfasaje(msg); }catch(_e){}
        // SIEMPRE a la consola, aunque la llamada sea silenciosa. `silencioso` existe para no
        // molestar al operador con carteles, no para tapar el diagnóstico: el reloj de 60 s de la
        // bandeja llama en silencio, así que TODOS los fallos del refresco automático quedaban sin
        // registrar. Cuando OFI-SAN reportó que no le entraban cargas, en su consola no había ni
        // una línea que dijera qué error era — había que adivinar entre red y servidor (29/9).
        console.error("[solicitudes portal] fallo el refresco",
          { silencioso: silencioso, esRed: _esErrorDeRed(r.error), error: r.error });
        _programarReintento();
        return r;
      }
      _cancelarReintento();
      deps.V154P.solicitudesOkAt = Date.now();
      deps.V154P.solicitudesErrorAt = null;
      deps.V154P.solicitudesEsRed = false;
      try{ deps._v154pAvisoDesfasaje(null); }catch(_e){}

      const _nuevas = deps.normArr(r.data).map(deps.mapSolicitudPortal);
      health?.record('DATA','OK','BANDEJA_LIST_VALID');

      // Medir ACÁ y no al dibujar: lo que se quiere saber es cuánto tardó el sistema en traer el
      // mensaje, no cuánto tardó el operador en abrir la conversación. Va a la consola de la PC,
      // el operador no ve nada. Ver renderer/core/latencia-panel.js.
      try{ if(deps.window.nodoLatencia) deps.window.nodoLatencia.medirTanda(_nuevas); }catch(_e){}
      // Un retiro a medio pagar NO puede desaparecer de la lista. La RPC filtra por estado, así que
      // al pasar el parcial a EN_PROCESO deja de devolverlo y el retiro se esfumaba del panel con
      // plata todavía debida — no había forma de terminar de pagarlo. Los que tienen progreso
      // parcial y ya no vienen del server se conservan del ciclo anterior, marcados, hasta que se
      // salden o los cierre alguien a mano.
      // La copia que se sostiene NO se refrescaba nunca: quedaba congelada con los números del
      // momento en que dejó de venir. Se pagaba el resto o se cerraba, y la copia vieja se volvía a
      // empujar en cada ciclo diciendo «falta $X» — no había forma de sacarla. Le pasó a #266250
      // (Maria6981x): pagado entero el 26/9 10:41 y seguía en la caja pidiendo $38.907 (D-109).
      // Ahora, antes de sostenerla, se le pregunta a la base cómo está.
      // Antes esto le preguntaba a la base POR CADA retiro sostenido, con `await`, DENTRO del
      // cargado de la bandeja. Cada sostenido sumaba un viaje a CADA refresco — y mientras corrían,
      // el cierre anti-solapamiento hacía que cualquier otro pedido saliera por "skipped",
      // incluido el botón del operador. Con la red lenta la bandeja queda clavada: se aprieta y no
      // pasa nada, hasta que termina el último viaje y entra todo junto. Es exactamente lo que
      // reportó OFI-SAN, y es de 2.1.3: en 2.1.2 este bloque no existía (ebfeaf3, 26/9).
      //
      // Ahora el sostenido entra a la lista EN EL ACTO — que era el punto, un retiro con plata
      // debida no puede desaparecer — y a la base se le pregunta DESPUÉS de pintar, sin bloquear.
      const _sostenidos = [];
      try{
        const _ids = new Set(_nuevas.map(function(x){ return String(x.ID||x.SOLICITUD_ID||''); }));
        (deps.V154P.solicitudes||[]).forEach(function(v){
          const id = String(v.ID||v.SOLICITUD_ID||'');
          if(!id || _ids.has(id)) return;
          const pp = deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(v) : null;
          if(pp && pp.hasProg && pp.restante > 0.5) _sostenidos.push({ id: id, v: v, pp: pp });
        });
        _sostenidos.forEach(function(c){
          c.v.__soloLocal = true;
          _nuevas.push(c.v);
          console.warn('[portal] retiro #'+c.id+' con '+deps.money(c.pp.restante)+' sin pagar dejó de venir de la RPC — se conserva local');
        });
      }catch(_e){}
      deps.V154P.solicitudes = _nuevas;
      try{ deps._portalAutoRechazar(deps.V154P.solicitudes); }catch(_e){}
      deps.window.solicitudes = deps.V154P.solicitudes.slice();
      try{ deps.solicitudes = deps.V154P.solicitudes.slice(); }catch(_e){}
      // Cosecha pasiva → base LOCAL de jugadores (portado de NexoBetaChan): cada solicitud del portal
      // trae usuario + teléfono y (según tipo) titular/CBU. Se registra UNA vez por solicitud (Set de
      // sesión) → TODO usuario que operó en el portal queda guardado, aunque nadie lo vincule a mano.
      try{
        if(deps.window.jugadorRegistrarDato && Array.isArray(deps.V154P.solicitudes)){
          deps.window.__jugHarvested = deps.window.__jugHarvested || new Set();
          deps.V154P.solicitudes.forEach(function(s){
            const sid = String(s.ID||s.SOLICITUD_ID||''); if(!sid || deps.window.__jugHarvested.has(sid)) return;
            // Una consulta de SOPORTE —y sobre todo un alta nueva ("soy nuevo, apodo X, tel Y")— es lo
            // que el cliente DECLARA, no un dato del sistema. Guardarla como jugador hacía que el cotejo
            // comparara la declaración contra sí misma y dijera "COINCIDEN · en sistema · mismo dueño"
            // para alguien sin cuenta (Juan, 12/09).
            if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='SOPORTE') return;
            const u = String(s.USUARIO||s.USUARIO_JUGADOR||'').trim(); if(!u) return;
            deps.window.__jugHarvested.add(sid);
            let meta = s.METADATA!==undefined?s.METADATA:(s.metadata||{});
            if(typeof meta==='string'){ try{ meta=JSON.parse(meta); }catch(_e){ meta={}; } }
            const esRet = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='RETIRO';
            const dato = {
              telefono: s.TELEFONO || s.telefono || (meta&&meta.telefono) || '',
              titular: s.TITULAR || s.NOMBRE_COMPLETO || (meta&&meta.titular) || '',
              // CBU/alias SOLO de retiros: en una carga ese campo es NUESTRA billetera.
              cbu: esRet ? String(s.CBU||s.CVU||s.CBU_ALIAS||s.DESTINO||(meta&&(meta.cbu||meta.destino))||'').trim() : '',
              fecha: s.FECHA_CREACION || s.FECHA || undefined
            };
            if(dato.telefono || dato.titular || dato.cbu) deps.window.jugadorRegistrarDato(u, dato);
          });
        }
      }catch(_e){}
      // Actualizamos stats generales, pero la caja de inicio queda en manos del render portal.
      healthStage='RENDER';
      try{ if(typeof deps.renderInicio === "function") deps.renderInicio(); }catch(e){}
      deps.renderSolicitudesPortalEnInicio();
      const healthBox=deps.document.getElementById('tablaSolicitudesInicio');
      health?.record('RENDER',healthBox && healthBox.innerHTML && healthBox.innerHTML===deps.V154P.solicitudesLastHtml?'OK':'UNKNOWN',
        healthBox && healthBox.innerHTML && healthBox.innerHTML===deps.V154P.solicitudesLastHtml?'BANDEJA_DOM_UPDATED':'BANDEJA_DOM_UNCONFIRMED');
      // Si entró una carga con un retiro a medio pagar, ese parcial se cierra solo (Juan, 26/9).
      // Va después del render para no demorar la pantalla, y sin await: si falla, no arrastra nada.
      try{ if(deps.window.cerrarParcialesPorCarga) deps.window.cerrarParcialesPorCarga(); }catch(_e){}
      // NODO en Discord: los renglones se rearman con lo que acaba de llegar.
      try{ if(deps.window.actualizarPresenciaDiscord) deps.window.actualizarPresenciaDiscord(); }catch(_e){}
      // Alertas de retiro (bono sin liberar / CBU compartido): async y cacheadas 60 s.
      // Cuando llegan, vuelven a pintar la lista solas.
      try{ deps.cargarAlertasRetiro(); }catch(_e){}
      deps.renderSolicitudesPortalCompleto();
      // Recién acá, con la bandeja ya en pantalla y sin bloquear nada. Sin await a propósito.
      try{ refrescarSostenidos(_sostenidos); }catch(_e){}
      try{ if(typeof deps.verificarSolicitudes === "function") deps.verificarSolicitudes(silencioso); }catch(e){}

      // Auto-refrescar conversación abierta cuando llegan nuevas solicitudes SOPORTE
      try{
        if(deps.window.__nodoChatCurrentTicket && typeof deps.window.renderChatMensajes === "function"){
          const usr = String(deps.window.__nodoChatCurrentTicket.usuario||"").toUpperCase();
          if(typeof deps.window.ticketsAgrupados === "function"){
            const actualizado = deps.window.ticketsAgrupados().find(t=>String(t.usuario||"").toUpperCase()===usr);
            if(actualizado) deps.window.__nodoChatCurrentTicket = actualizado;
          }
          deps.window.renderChatMensajes();
        }
      }catch(_e){}
      return r;
    }catch(error){
      health?.record(healthStage,'ERROR',healthStage==='RENDER'?'BANDEJA_RENDER_FAILED':health.errorCode(error));
      throw error;
    }finally{
      deps.V154P.solicitudesLoading = false;
      if(deps.V154P.solicitudesQueued){
        deps.V154P.solicitudesQueued = false;
        deps.setTimeout(()=>cargarSolicitudesPortal(true), 350);
      }
    }
  }
  async function actualizarSolicitudPortal(id, estado, extra){
    const payload = {
      p_id: Number(id),
      p_estado: estado,
      p_operador: deps.window.operador?.usuario || deps.window.operador?.nombre
               || (typeof deps.operador!=='undefined' ? (deps.operador?.usuario||deps.operador?.nombre||'') : '')
               || "",
      p_monto: null,
      p_metadata: extra || {}
    };

    // Reintento ante fallos de RED ("fetch failed"/timeout/socket) — típico en la mirror con proxy
    // que pestañea. Setear el estado es IDEMPOTENTE, así que reintentar es seguro (no duplica nada).
    let r, ultimoErr;
    for(let intento = 1; intento <= 3; intento++){
      r = await deps.rpc("panel_v15_5_actualizar_solicitud_portal", payload);
      if(!r?.error){ refrescarBandejaPronto(); return r; }
      ultimoErr = r.error;
      const msg = String(r.error.message || r.error || '').toLowerCase();
      const esRed = /fetch failed|failed to fetch|network|timeout|econn|socket|load failed|networkerror/.test(msg);
      if(!esRed) break; // error real de negocio → no reintentar
      if(intento < 3){
        try{ deps.toast('Red inestable, reintentando actualización ('+intento+'/3)…','yellow'); }catch(_e){}
        await new Promise(res => deps.setTimeout(res, 600 * intento));
      }
    }

    deps.alert("Error actualizando solicitud: " + (ultimoErr?.message || JSON.stringify(ultimoErr)));
    return r;
  }


    return { globals: api, cargarSolicitudesPortal, actualizarSolicitudPortal };
  }
  return Object.freeze({ create, dependencies });
});
/* Portal: rejections. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRejections = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","abrirModal","actualizarSolicitudPortal","alert","cargarSolicitudesPortal","cerrarModal","document","escapeHtml","localStorage","notificarUsuarioEnChat","registrarEnHistorial","toast","window"]);
  function create(deps){
const api = {};
  api._portalMotivoRechazo = function(s){
    const tipo = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase();
    if(tipo!=='CARGA' && tipo!=='RETIRO') return null;             // soporte/clave no declaran titular
    const est = String(s.ESTADO||'').toUpperCase();
    if(est && !/PENDIENTE|NUEVA|EN_ESPERA/.test(est)) return null;  // ya la tocó alguien
    const titular = String(s.TITULAR||s.NOMBRE_COMPLETO||'').trim();
    if(!titular) return null;                                       // sin titular no inventamos nada
    const usuario = String(s.USUARIO||'').trim();
    // 1) Datos nuestros
    const propio = deps.window.esDatoPropioBilletera ? deps.window.esDatoPropioBilletera(titular) : null;
    if(propio) return { motivo:'DATO_PROPIO',
      texto:'El titular que pusiste ("'+titular+'") es el de NUESTRA cuenta, no el tuyo. Poné el nombre completo del titular de la cuenta desde la que transferís.' };
    // 2) Sin una sola letra → no es el nombre de una persona
    if(!/[a-záéíóúñü]/i.test(titular)) return { motivo:'SOLO_NUMEROS',
      texto:'El titular tiene que ser un NOMBRE Y APELLIDO, no números. Escribí el nombre del titular de la cuenta desde la que transferís.' };
    // 3) Puso su PROPIO USUARIO como titular. Es el caso más común de "completé cualquier cosa":
    //    "usuariobet", "maria112x1". Ningún banco tiene una cuenta a nombre de un alias de casino,
    //    así que el comprobante nunca va a coincidir y el depósito no se puede cotejar.
    if(deps.window._normNombre(titular) === deps.window._normNombre(usuario)) return { motivo:'USUARIO_COMO_TITULAR',
      texto:'Pusiste tu usuario ("'+titular+'") en vez del titular de la cuenta. Necesitamos el NOMBRE Y APELLIDO de la persona desde cuya cuenta transferís, tal como figura en el banco.' };
    // 3) Reincidencia
    if(deps.window.titularYaRechazado(usuario, titular)) return { motivo:'REINCIDENTE',
      texto:'Ya te rechazamos ese mismo titular ("'+titular+'"). Poné el nombre completo real del titular de la cuenta, o escribinos por soporte.' };
    return null;
  };
  // Interruptor de apagado. Esto rechaza SOLO y le escribe al cliente: si alguna vez se equivoca,
  // tiene que poder frenarse en el momento y no esperar a una release.
  //   apagar  → window.autoRechazoPortal(false)      (queda apagado también al reiniciar)
  //   prender → window.autoRechazoPortal(true)
  api.autoRechazoPortal = function(on){
    try{ deps.localStorage.setItem('nodo_auto_rechazo', on===false?'0':'1'); }catch(_e){}
    deps.toast(on===false?'⛔ Auto-rechazo APAGADO':'✅ Auto-rechazo prendido', on===false?'yellow':'green');
  };
  function _autoRechazoActivo(){ try{ return deps.localStorage.getItem('nodo_auto_rechazo')!=='0'; }catch(_e){ return true; } }

  async function _portalAutoRechazar(lista){
    if(!_autoRechazoActivo()) return;
    if(!Array.isArray(lista) || !lista.length) return;
    // Sin billeteras cargadas no se puede decidir el criterio 1 → no rechazamos nada a ciegas.
    if(!(deps.window.billeteras||[]).length) return;
    for(const s of lista){
      let r=null; try{ r=deps.window._portalMotivoRechazo(s); }catch(_e){ continue; }
      if(!r) continue;
      const id = s.ID||s.SOLICITUD_ID; if(!id) continue;
      if(deps.window.__autoRechDone && deps.window.__autoRechDone[String(id)]) continue;
      deps.window.__autoRechDone = deps.window.__autoRechDone || {};
      deps.window.__autoRechDone[String(id)] = true;
      const titular = String(s.TITULAR||s.NOMBRE_COMPLETO||'').trim();
      try{
        await deps.actualizarSolicitudPortal(String(id), 'RECHAZADA', {
          etapa:'AUTO_RECHAZO', motivo_rechazo:r.motivo, observacion:r.texto, operador:'AUTO'
        });
        deps.window.marcarTitularRechazado(s.USUARIO, titular, r.motivo);
        s.ESTADO='RECHAZADA';
        // Iba a notificarUsuarioEnChat, que escribe en la generación de chat que el portal ya no
        // lee: el mensaje moría ahí. Además se llamaba con cuatro argumentos a una función de dos,
        // así que el id y 'RECHAZADA' nunca se usaron — señal de que nadie lo había revisado.
        // crearSiNoHay en FALSE a propósito: esto es automático y abrir un hilo por cada rechazo
        // llenaría la bandeja (D-92). Si ya tiene conversación, le llega ahí y con push; si no, el
        // motivo igual lo ve en la pantalla de Estado del portal, que es donde lo va a buscar.
        try{ await deps.window.avisarJugadorEnChat(s.USUARIO, '❌ '+r.texto, { crearSiNoHay:false }); }catch(_e){}
        // Detalle completo: por qué se rechazó, qué había declarado y qué se le respondió. Sin esto
        // el historial dice "RECHAZADA" y nadie puede reconstruir el caso cuando el cliente vuelve.
        try{ await deps.registrarEnHistorial({ usuario:s.USUARIO, tipo:String(s.TIPO||'CARGA'), monto:Number(s.MONTO_DECLARADO||0),
          origen:'PORTAL', estado:'RECHAZADA', solicitud_id:id,
          notas:'AUTO-RECHAZO · '+r.motivo
            + ' · titular declarado: "'+titular+'"'
            + (s.TELEFONO?(' · tel '+s.TELEFONO):'')
            + (s.DESTINO?(' · destino '+s.DESTINO):'')
            + ' · se le respondió: '+String(r.texto||'').slice(0,140)
        }); }catch(_e){}
        try{ deps.toast('⛔ Auto-rechazo · '+s.USUARIO+' · '+r.motivo,'yellow'); }catch(_e){}
        console.warn('[auto-rechazo] #'+id+' '+s.USUARIO+' · '+r.motivo+' · titular: "'+titular+'"');
      }catch(e){ console.warn('[auto-rechazo] falló #'+id, e); }
    }
  }
  api._portalAutoRechazar = _portalAutoRechazar;

  // ── "Ya se la cargué" ───────────────────────────────────────────────────────
  // Medido en 30 días: 124 solicitudes rechazadas con el motivo escrito a mano como "CARGADO",
  // "YA FUE CARGADO", "FICHAS CARGADAS", "YA SE TE CARGO", "CARGADAS", "FUE CARGADO RECIEN".
  // Seis formas de decir lo mismo. Eso NO es un rechazo: el operador ya le cargó y usa
  // "Rechazar" para sacarla de la bandeja. El jugador queda viendo "Rechazada" en rojo con la
  // plata adentro, y encima el motivo suena a que hizo algo mal.
  //
  // Esto la cierra como ACREDITADA —que es lo que pasó— y le avisa en consecuencia.
  api.v154pYaCargada = function(id){
    const s = (deps.V154P.solicitudes||[]).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
    const usuario = String((s&&(s.USUARIO||s.USUARIO_JUGADOR))||'').trim();
    const monto = Number((s&&(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO))||0);

    deps.abrirModal("Marcar como ya cargada · #"+id,
      '<div style="padding:9px 11px;border-radius:9px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.4);color:#bbf7d0;font-size:12.5px;margin-bottom:10px">'
      + 'Se cierra como <b>acreditada</b>, no como rechazo. '
      + (usuario ? ('A <b>'+deps.escapeHtml(usuario)+'</b> le va a figurar la carga confirmada.') : '')
      + '</div>'
      + '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Usala cuando ya le cargaste las fichas por otro lado '
      + '(a mano, por el chat) y esta solicitud quedó dando vueltas. <b>No carga nada:</b> sólo cierra la solicitud.</div>'
      + '<label>Aclaración <span style="color:#8b949e;font-weight:400">· opcional, la ve el jugador</span></label>'
      + '<textarea id="v154pYaCargObs" placeholder="Ej: te la cargué a mano recién"></textarea>',
      async function(){
        const obs = ((deps.document.getElementById("v154pYaCargObs")||{}).value||"").trim();
        deps.cerrarModal();
        try{
          await deps.actualizarSolicitudPortal(id, "ACREDITADA", {
            etapa: "YA_CARGADA_MANUAL",
            cerrada_como: "YA_CARGADA",
            obs: obs || null,
            operador: (deps.window.operador && (deps.window.operador.usuario||deps.window.operador.nombre)) || 'panel'
          });
          // El aviso iba por notificarUsuarioEnChat, que escribe en chat_sesiones / chat_mensajes —
          // la generación de chat que el portal YA NO LEE. El mensaje se guardaba y moría ahí: ni
          // le llegaba al jugador ni quedaba a la vista de nadie. Era el mismo agujero del cambio
          // de clave (12/09), que se tapó sólo para la clave y quedó anotado en D-92.
          //
          // avisarJugadorEnChat sí va al hilo que el portal lee, y manda el push. crearSiNoHay en
          // true porque esto es un mensaje que el operador decidió mandar: si el jugador no tiene
          // conversación abierta, se le abre. (Lo que D-92 evitaba era hacer esto en los avisos
          // AUTOMÁTICOS, que llenarían la bandeja; éste lo dispara una persona a propósito.)
          let avisado = null;
          if(usuario){
            try{
              avisado = await deps.window.avisarJugadorEnChat(usuario,
                "✅ Tu carga" + (monto ? (" de $" + monto.toLocaleString("es-AR")) : "") + " ya está acreditada."
                + (obs ? ("\n📝 " + obs) : "")
                + "\nRevisá tu saldo. Si no la ves, escribinos por acá.",
                { crearSiNoHay: true });
            }catch(e){ avisado = { ok:false, error: e.message || String(e) }; }
          }
          // Si el aviso no salió, el operador tiene que enterarse ACÁ. Antes se lo tragaba un catch
          // vacío y la solicitud se cerraba igual, con el jugador sin saber nada.
          if(usuario && !(avisado && avisado.ok)){
            deps.toast("#"+id+" se cerró, pero NO se le pudo avisar a "+usuario+". Escribile por el chat.", "yellow");
          }else{
            deps.toast("✔ #"+id+" cerrada como ya cargada", "green");
          }
        }catch(e){
          deps.toast("No se pudo cerrar: "+(e.message||e), "red");
        }
      }, "Cerrar como cargada");
  };

  api.v154pRechazarSolicitud = function(id){
    const s = (deps.V154P.solicitudes||[]).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
    // Motivos rápidos: el usuario los VE en el portal (pantalla Estado), así que tienen que servirle.
    // El textarea arranca VACÍO (antes venía precargado "Rechazada desde panel" → todos veían ese texto inútil).
    const _rap = [
      "No nos llegó tu transferencia. Revisá el comprobante y volvé a intentar.",
      "El comprobante no coincide con el monto o la cuenta.",
      "Comprobante repetido / ya usado.",
      "Los datos del titular no coinciden. Escribinos por el chat."
    ];
    const _rapHtml = _rap.map(function(t){
      return '<button type="button" class="mini-btn" style="margin:2px;font-size:11px" data-t="'+t.replace(/"/g,'&quot;')+'" onclick="var e=document.getElementById(\'v154pRechObs\'); if(e) e.value=this.getAttribute(\'data-t\');">'+deps.escapeHtml(t.split(".")[0])+'</button>';
    }).join("");
    // Bloquear el titular a mano. El auto-rechazo cubre sólo criterios DUROS (datos nuestros, sin
    // letras, el propio usuario, reincidencia). Todo lo demás —"asdasd", un nombre inventado, el
    // apodo del cliente— lo tiene que ver un operador, y hasta ahora no tenía cómo dejarlo
    // bloqueado: lo rechazaba y el cliente lo volvía a mandar igual.
    const _tit = String((s&&(s.TITULAR||s.NOMBRE_COMPLETO))||'').trim();
    const _usr = String((s&&s.USUARIO)||'').trim();
    const _yaBloq = (_tit && deps.window.titularYaRechazado) ? deps.window.titularYaRechazado(_usr,_tit) : false;
    const _bloqHtml = _tit
      ? ('<label style="display:flex;align-items:flex-start;gap:8px;margin-top:10px;padding-top:9px;border-top:1px solid #30363d;font-size:12px;cursor:pointer;color:#e6edf3">'
         + '<input type="checkbox" id="v154pBloqTitular" '+(_yaBloq?'checked disabled':'')+' style="width:16px;height:16px;margin-top:1px;flex-shrink:0">'
         + '<span>Bloquear el titular <b>"'+deps.escapeHtml(_tit)+'"</b> para <b>'+deps.escapeHtml(_usr)+'</b>'
         + '<div style="color:#8b949e;font-size:11px;margin-top:1px">'
         + (_yaBloq ? 'Ya está bloqueado — si lo vuelve a mandar, se le rechaza solo.'
                    : 'Si lo vuelve a mandar igual, se le rechaza solo y no te llega.')+'</div></span></label>')
      : '';
    deps.abrirModal("Rechazar solicitud #"+id,
      // Si ya se la cargó, esto NO es un rechazo. Sale del rechazo y la cierra bien.
      '<div style="padding:8px 10px;border-radius:9px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.35);margin-bottom:10px;font-size:12.5px;color:#bbf7d0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span>¿Ya se la cargaste por otro lado?</span>'+
      '<button type="button" class="mini-btn green" style="font-size:11.5px" onclick="cerrarModal();v154pYaCargada(\''+id+'\')">✅ Ya se la cargué</button>'+
      '</div>'+
      '<label>Motivo (se envía al usuario y lo ve en el portal)</label>'+

      '<textarea id="v154pRechObs" placeholder="Explicale al usuario por qué se rechaza (lo va a ver en su portal)"></textarea>'+
      '<div style="margin-top:6px;font-size:11px;color:#93a3b8">Motivos rápidos (tocá para usar):</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:3px">'+_rapHtml+'</div>'+
      _bloqHtml,
      async function(){
        const motivo = ((deps.document.getElementById("v154pRechObs")||{}).value||"").trim()
          || "No pudimos procesar tu solicitud. Escribinos por el chat y lo resolvemos.";
        // Se lee ANTES de cerrar el modal: después el checkbox ya no existe en el DOM.
        const _bloq = !!(deps.document.getElementById("v154pBloqTitular") && deps.document.getElementById("v154pBloqTitular").checked);
        deps.cerrarModal();
        try{
          await deps.actualizarSolicitudPortal(id, "RECHAZADA", {etapa:"RECHAZADA_PANEL", motivo});
          const usuario = s&&(s.USUARIO||s.USUARIO_JUGADOR||"");
          if(_bloq && _tit && deps.window.marcarTitularRechazado){
            deps.window.marcarTitularRechazado(usuario, _tit, 'BLOQUEADO_POR_OPERADOR');
            try{ deps.toast('🚫 Titular "'+_tit+'" bloqueado para '+usuario,'yellow'); }catch(_e){}
          }
          if(usuario) await deps.notificarUsuarioEnChat(usuario, "❌ Tu solicitud fue rechazada.\n📝 Motivo: "+motivo);
          deps.toast("Solicitud rechazada","red");
          try{ await deps.cargarSolicitudesPortal(true); }catch(_e){}
        }catch(e){ deps.alert(e.message||"Error al rechazar"); }
      }, "Rechazar");
  };

  api.clasificarRechazo = function(s){
    if(!s) return null;
    const est = String(s.ESTADO || s.estado || '').toUpperCase();
    const esRech = /RECHAZ|CANCEL/.test(est);
    const esErr  = /ERROR/.test(est);
    if(!esRech && !esErr) return null;

    let meta = s.METADATA !== undefined ? s.METADATA : (s.metadata || {});
    if(typeof meta === 'string'){ try{ meta = JSON.parse(meta); }catch(_e){ meta = {}; } }
    const notas = String((s._raw && s._raw.notas) || s.notas || '');
    const observacion = String(meta.observacion || meta.motivo || meta.motivo_rechazo || s.observacion || '').trim();
    const etapa = String(meta.etapa || '').toUpperCase();
    const mot = String(meta.motivo_rechazo || meta.motivo || '').toUpperCase();

    // 0) La canceló EL JUGADOR desde el portal. No es un rechazo nuestro y no hay nada que
    //    revisar: hasta ahora caía en el caso genérico y se pintaba en rojo como 'Rechazada',
    //    o directamente desaparecía de la bandeja sin dejar ninguna explicación de por qué.
    if(String(meta.cancelada_por || '').toUpperCase() === 'JUGADOR'){
      let cuando = '';
      try{ if(meta.cancelada_at) cuando = new Date(meta.cancelada_at).toLocaleString('es-AR'); }catch(_e){}
      return {
        esRechazo: true, esAuto: false, categoria: 'CANCELADA_JUGADOR', codigo: 'CANCELADA_JUGADOR',
        badge: 'La canceló el jugador',
        titulo: 'Cancelada por el jugador desde el portal',
        icono: '🚫', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)',
        mensajeCliente: 'La cancelaste vos desde el portal' + (cuando ? (' el ' + cuando) : '') + '.',
        etapa: etapa || 'CANCELADA_PORTAL',
        accionSugerida: 'No hay nada que hacer: la dio de baja la persona antes de que nadie la tomara. Si vuelve a mandarla, va a entrar como una solicitud nueva.'
      };
    }

    // 1) Auto-rechazos de titular duro
    if(/AUTO_RECHAZO/.test(etapa) || /AUTO-RECHAZO/.test(notas) || /DATO_PROPIO|SOLO_NUMEROS|USUARIO_COMO_TITULAR|REINCIDENTE/.test(mot)){
      if(/DATO_PROPIO/.test(mot) || /DATO_PROPIO/.test(notas)){
        return {
          esRechazo: true, esAuto: true, categoria: 'AUTO_RECHAZO', codigo: 'DATO_PROPIO',
          badge: 'Titular propio',
          titulo: 'Auto-rechazo: Titular propio de nuestra cuenta',
          icono: '⛔', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',
          mensajeCliente: observacion || 'El titular que pusiste es el de NUESTRA cuenta, no el tuyo. Poné el nombre completo del titular de la cuenta desde la que transferís.',
          etapa: etapa || 'AUTO_RECHAZO',
          accionSugerida: 'El usuario copió los datos de nuestra billetera en vez de la suya. Explicarle por chat que declare el titular de su propio banco.'
        };
      }
      if(/SOLO_NUMEROS/.test(mot) || /SOLO_NUMEROS/.test(notas)){
        return {
          esRechazo: true, esAuto: true, categoria: 'AUTO_RECHAZO', codigo: 'SOLO_NUMEROS',
          badge: 'Solo números',
          titulo: 'Auto-rechazo: Titular sin letras (números/DNI)',
          icono: '⛔', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',
          mensajeCliente: observacion || 'El titular tiene que ser un NOMBRE Y APELLIDO, no números. Escribí el nombre del titular de la cuenta desde la que transferís.',
          etapa: etapa || 'AUTO_RECHAZO',
          accionSugerida: 'El cliente puso un DNI o CBU en el campo titular. Indicarle que declare nombre y apellido.'
        };
      }
      if(/USUARIO_COMO_TITULAR/.test(mot) || /USUARIO_COMO_TITULAR/.test(notas)){
        return {
          esRechazo: true, esAuto: true, categoria: 'AUTO_RECHAZO', codigo: 'USUARIO_COMO_TITULAR',
          badge: 'Usuario como titular',
          titulo: 'Auto-rechazo: Puso su usuario de casino como titular',
          icono: '⛔', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',
          mensajeCliente: observacion || 'Pusiste tu usuario en vez del titular de la cuenta. Necesitamos el NOMBRE Y APELLIDO de la persona desde cuya cuenta transferís.',
          etapa: etapa || 'AUTO_RECHAZO',
          accionSugerida: 'Ningún banco emite a nombre de alias de casino. Pedirle el titular real de la cuenta bancaria emisora.'
        };
      }
      if(/REINCIDENTE/.test(mot) || /REINCIDENTE/.test(notas)){
        return {
          esRechazo: true, esAuto: true, categoria: 'AUTO_RECHAZO', codigo: 'REINCIDENTE',
          badge: 'Titular reincidente',
          titulo: 'Auto-rechazo: Titular ya rechazado previamente',
          icono: '⛔', color: '#dc2626', bg: 'rgba(220,38,38,0.18)',
          mensajeCliente: observacion || 'Ya te rechazamos ese mismo titular. Poné el nombre completo real del titular de la cuenta, o escribinos por soporte.',
          etapa: etapa || 'AUTO_RECHAZO',
          accionSugerida: 'El usuario insiste con un titular rechazado. Revisar su historial o contactarlo por chat.'
        };
      }
    }

    // 2) Bloqueado por operador
    if(/BLOQUEADO_POR_OPERADOR|TITULAR_BLOQUEADO/.test(mot) || /BLOQUEADO_POR_OPERADOR/.test(notas)){
      return {
        esRechazo: true, esAuto: false, categoria: 'OPERADOR', codigo: 'TITULAR_BLOQUEADO',
        badge: 'Titular bloqueado',
        titulo: 'Rechazo operador: Titular bloqueado manualmente',
        icono: '🚫', color: '#b91c1c', bg: 'rgba(185,28,28,0.18)',
        mensajeCliente: observacion || 'Titular no habilitado para operar.',
        etapa: etapa || 'RECHAZADA_PANEL',
        accionSugerida: 'Un operador bloqueó este titular para este jugador. Si acredita identidad con DNI, se puede desbloquear.'
      };
    }

    // 3) Motivos clásicos de operador en panel
    const obsNorm = observacion.toLowerCase();
    if(obsNorm.includes('no nos llegó') || obsNorm.includes('no llego') || obsNorm.includes('transferencia')){
      return {
        esRechazo: true, esAuto: false, categoria: 'OPERADOR', codigo: 'SIN_TRANSFERENCIA',
        badge: 'No llegó transferencia',
        titulo: 'Rechazo operador: Transferencia no acreditada en banco',
        icono: '❌', color: '#f87171', bg: 'rgba(248,113,113,0.15)',
        mensajeCliente: observacion,
        etapa: etapa || 'RECHAZADA_PANEL',
        accionSugerida: 'Revisar extracto bancario de la billetera receptora o solicitar comprobante con número de operación.'
      };
    }
    if(obsNorm.includes('no coincide') || obsNorm.includes('monto o la cuenta')){
      return {
        esRechazo: true, esAuto: false, categoria: 'OPERADOR', codigo: 'COMPROBANTE_NO_COINCIDE',
        badge: 'Comprobante no coincide',
        titulo: 'Rechazo operador: Comprobante no coincide con monto o cuenta',
        icono: '❌', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',
        mensajeCliente: observacion,
        etapa: etapa || 'RECHAZADA_PANEL',
        accionSugerida: 'El comprobante enviado difiere en importe o cuenta con lo declarado en la solicitud.'
      };
    }
    if(obsNorm.includes('repetido') || obsNorm.includes('ya usado')){
      return {
        esRechazo: true, esAuto: false, categoria: 'OPERADOR', codigo: 'COMPROBANTE_REPETIDO',
        badge: 'Comprobante repetido',
        titulo: 'Rechazo operador: Comprobante ya utilizado previamente',
        icono: '🚨', color: '#dc2626', bg: 'rgba(220,38,38,0.18)',
        mensajeCliente: observacion,
        etapa: etapa || 'RECHAZADA_PANEL',
        accionSugerida: 'Posible intento de duplicación de saldo con el mismo recibo. Verificar contra el historial de cargas.'
      };
    }
    if(obsNorm.includes('datos del titular') || obsNorm.includes('titular no coinciden')){
      return {
        esRechazo: true, esAuto: false, categoria: 'OPERADOR', codigo: 'DATOS_NO_COINCIDEN',
        badge: 'Titular no coincide',
        titulo: 'Rechazo operador: Datos del titular no coinciden',
        icono: '❌', color: '#f97316', bg: 'rgba(249,115,22,0.15)',
        mensajeCliente: observacion,
        etapa: etapa || 'RECHAZADA_PANEL',
        accionSugerida: 'El titular de la cuenta bancaria de origen difiere del declarado.'
      };
    }

    // 4) Errores operativos / de sistema
    if(etapa === 'PORTAL_SALDO_INSUFICIENTE' || obsNorm.includes('saldo insuficiente') || /SALDO_INSUFICIENTE/.test(notas)){
      return {
        esRechazo: false, esAuto: true, categoria: 'ERROR_OPERATIVO', codigo: 'SALDO_INSUFICIENTE',
        badge: 'Saldo insuficiente',
        titulo: 'Error operativo: Saldo insuficiente en el casino',
        icono: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',
        mensajeCliente: 'Saldo insuficiente en casino para procesar el retiro.',
        etapa: etapa,
        accionSugerida: 'El jugador no cuenta con las fichas suficientes. Usar el botón de Retiro Parcial o ajustar al saldo real.'
      };
    }
    if(etapa === 'PORTAL_CANCELADA_RETIRO_24H' || /24H/.test(notas)){
      return {
        esRechazo: true, esAuto: true, categoria: 'SISTEMA', codigo: 'RETIRO_24H',
        badge: 'Retiro en 24h',
        titulo: 'Políticas: Límite de retiros cada 24hs',
        icono: '🚫', color: '#eab308', bg: 'rgba(234,179,8,0.15)',
        mensajeCliente: 'Ya realizaste un retiro en las últimas 24 horas.',
        etapa: etapa,
        accionSugerida: 'Verificar en Blacklist 24hs si corresponde excepción de turno.'
      };
    }
    if(etapa === 'PORTAL_USUARIO_NO_ENCONTRADO' || obsNorm.includes('usuario no encontrado')){
      return {
        esRechazo: false, esAuto: true, categoria: 'ERROR_OPERATIVO', codigo: 'USUARIO_NO_EXISTE',
        badge: 'Usuario inexistente',
        titulo: 'Error operativo: Usuario no encontrado en backoffice',
        icono: '⚠️', color: '#f87171', bg: 'rgba(248,113,113,0.15)',
        mensajeCliente: 'El usuario especificado no existe en la plataforma.',
        etapa: etapa,
        accionSugerida: 'Validar si el usuario fue creado en el casino o si se ingresó con un error tipográfico.'
      };
    }

    // 5) Fallback general
    return {
      esRechazo: esRech, esAuto: false, categoria: esRech ? 'OPERADOR' : 'ERROR_OPERATIVO',
      codigo: mot || (esRech ? 'RECHAZADA_GENERAL' : 'ERROR_GENERAL'),
      badge: esRech ? (observacion ? (observacion.length > 22 ? observacion.slice(0, 20)+'…' : observacion) : 'Rechazada') : 'Error operativo',
      titulo: esRech ? 'Solicitud rechazada' : 'Error en la operación',
      icono: esRech ? '❌' : '⚠️', color: esRech ? '#ef4444' : '#f59e0b',
      bg: esRech ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
      mensajeCliente: observacion || (esRech ? 'Tu solicitud fue rechazada.' : 'Ocurrió un error al procesar.'),
      etapa: etapa || (esRech ? 'RECHAZADA' : 'ERROR'),
      accionSugerida: 'Revisar las notas y contactar al usuario mediante el chat.'
    };
  };

    return { globals: api, _portalAutoRechazar, clasificarRechazo: api.clasificarRechazo };
  }
  return Object.freeze({ create, dependencies });
});
/* Portal: withdrawals-view. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalWithdrawalsView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","_rv2LeerSaldo","_rv2RenderConfirmar","abrirModalRetiroV2","billeteras","confirm","document","escapeHtml","money","recomendarRepartoRetiro","setTimeout","toast","window"]);
  function create(deps){
const api = {};
  // ── Sugerencia + selección de billetera de pago (fusión con el parcial del colega 1.0.85) ──
  // Base = NUESTRO flujo (un monto + progreso portal + push). Le sumamos el asistente del colega:
  // sugiere con qué billetera(s) pagar (greedy por saldo, redondeado) y deja editar el reparto.
  // Sin checkbox: la billetera "cuenta" si su monto > 0 (edición directa, sin re-render frágil).
  function _montoRedondo(v){ v=Math.abs(Number(v)||0); if(v>=100000)return Math.floor(v/100000)*100000; if(v>=10000)return Math.floor(v/10000)*10000; if(v>=1000)return Math.floor(v/1000)*1000; return Math.floor(v/100)*100; }
  api._montoRedondo = deps.window._montoRedondo || _montoRedondo;
  api.recomendarRepartoRetiro = function(monto, maxBils){
    maxBils = maxBils || 3;
    const objetivo = Math.abs(Number(monto)||0);
    const conSaldo = (deps.billeteras||[])
      .filter(function(b){ return Number(b.SALDO||0) >= 200000 && !/promo|referid/i.test(String(b.NOMBRE_VISIBLE||'')); })
      .map(function(b){ return { id:b.ID_BILLETERA, nombre:b.NOMBRE_VISIBLE||'—', saldo:Number(b.SALDO||0), chunior:b.CHUNIOR_UID }; })
      .sort(function(a,b){ return b.saldo - a.saldo; });
    if(!objetivo || !conSaldo.length) return { reparto:[], pagable:0, objetivo:objetivo };
    const reparto = []; let acum = 0;
    for(const b of conSaldo){
      if(acum >= objetivo - 0.5 || reparto.length >= maxBils) break;
      // Sin redondear: el reparto tiene que sumar el objetivo EXACTO. Redondeando hacia abajo
      // quedaba siempre un resto y el retiro salía parcial sin que nadie lo pidiera.
      let usar = Math.min(b.saldo, objetivo - acum);
      if(usar <= 0) continue;
      reparto.push({ id:b.id, nombre:b.nombre, saldo:b.saldo, usar:usar, chunior:b.chunior });
      acum += usar;
    }
    const pagable = reparto.reduce(function(s,x){ return s+x.usar; }, 0);
    return { reparto:reparto, pagable:pagable, objetivo:objetivo, cubre:pagable>=objetivo-0.5 };
  };
  // Pinta la caja de sugerencia/edición de billeteras según el monto del modal parcial.
  api.v154pReparto = function(){
    const box = deps.document.getElementById('v154pRepartoBox'); if(!box) return;
    const monto = Math.abs(Number((deps.document.getElementById('v154pParcialMonto')||{}).value||0));
    if(!monto){ box.innerHTML='<div class="small" style="color:#8b949e;margin-top:6px">Ingresá el monto para ver la sugerencia de billeteras.</div>'; return; }
    const rep = deps.window.recomendarRepartoRetiro(monto);
    const sug = {}; (rep.reparto||[]).forEach(function(x){ sug[String(x.id)]=x.usar; });
    const usables = (deps.billeteras||[]).filter(function(b){ return Number(b.SALDO||0)>=200000 && !/promo|referid/i.test(String(b.NOMBRE_VISIBLE||'')); }).sort(function(a,b){ return Number(b.SALDO||0)-Number(a.SALDO||0); });
    let html = '<div style="margin-top:10px;font-weight:800;color:#c9d1d9;font-size:13px">¿Con qué billetera(s) pagás? <span class="small" style="color:#8b949e;font-weight:400">· sugerido por saldo · editá o dejá en 0</span></div>';
    if(!usables.length){ box.innerHTML = html + '<div class="small" style="color:#fca5a5;margin-top:5px">⚠ Sin billeteras con saldo (≥$200k, sin promo/referido). Se usará la billetera por defecto.</div>'; return; }
    html += usables.slice(0,8).map(function(b){
      const bid=String(b.ID_BILLETERA); const m=Number(sug[bid]||0);
      return '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">'
        + '<span style="flex:1;min-width:0;font-size:12px"><b>'+deps.escapeHtml(b.NOMBRE_VISIBLE||'—')+'</b> <span style="color:#8b949e">· '+deps.money(b.SALDO||0)+'</span></span>'
        + '<input type="number" inputmode="numeric" class="v154pRepInp" data-bil="'+bid+'" value="'+(m||'')+'" oninput="v154pRepartoTotal()" placeholder="0" style="width:120px;text-align:right;font-weight:700">'
        + '</div>';
    }).join('');
    html += '<div id="v154pRepartoTotal" style="margin-top:8px;font-size:12px"></div>';
    box.innerHTML = html;
    deps.window.v154pRepartoTotal();
  };
  api.v154pRepartoTotal = function(){
    const monto = Math.abs(Number((deps.document.getElementById('v154pParcialMonto')||{}).value||0));
    let tot=0; deps.document.querySelectorAll('.v154pRepInp').forEach(function(inp){ tot += Math.abs(Number(inp.value)||0); });
    const el=deps.document.getElementById('v154pRepartoTotal'); if(!el) return;
    const dif = monto - tot;
    el.innerHTML = 'Repartido: <b style="color:'+(Math.abs(dif)<=0.5?'#22c55e':'#f5c518')+'">'+deps.money(tot)+'</b> / '+deps.money(monto)
      + (Math.abs(dif)<=0.5 ? ' ✓' : (dif>0 ? ' · faltan '+deps.money(dif) : ' · te pasaste '+deps.money(-dif)));
  };
  api.v154pLeerRepartoSel = function(){
    const out=[]; deps.document.querySelectorAll('.v154pRepInp').forEach(function(inp){
      const m=Math.abs(Number(inp.value)||0);
      if(m>0){ const bid=inp.getAttribute('data-bil'); const b=(deps.billeteras||[]).find(function(x){return String(x.ID_BILLETERA)===bid;}); if(b) out.push({id:b.ID_BILLETERA, chunior:b.CHUNIOR_UID, nombre:b.NOMBRE_VISIBLE, monto:m}); }
    });
    return out;
  };

  // Retiros parciales (punto 3, opción 2 · "se retiran las fichas"): "Parcial" EJECUTA el retiro
  // real por el monto parcial (descuenta las fichas en casinodrex, mismos primitivos blindados que
  // retirarSaldoRapido) y SOLO si salió bien registra el progreso (landing_retiro_registrar_parcial)
  // y avisa al usuario por PUSH (el chat no siempre llega).

// ══════════════════════════════════════════════════════════════════════════
// RETIRO PARCIAL V2 (_rv2*) — portado de NexoBetaChan. Modal SEPARADO del retiro común.
// v154pRegistrarParcial delega acá (abrirModalRetiroV2). Ejecución propia:
// _rv2Aprobar→_rv2Confirmar→_rv2Finalizar (registra historial + actualiza solicitud + PUSH).
// Comparte recomendarRepartoRetiro/_montoRedondo con el madre. Incluye notificarRetiroParcialPortal.
// ══════════════════════════════════════════════════════════════════════════
deps.withdrawalState.current = null;
function _rv2Modal(){
  let el = deps.document.getElementById('retiroV2Modal');
  if(el) return el;
  el = deps.document.createElement('div');
  el.id = 'retiroV2Modal';
  el.style.cssText = 'display:none;position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:99999;width:min(460px,calc(100vw - 24px))';
  deps.document.body.appendChild(el);
  return el;
}
api.cerrarRetiroV2 = function(){ const el=deps.document.getElementById('retiroV2Modal'); if(el) el.style.display='none'; deps.withdrawalState.current=null; };

// opts.modoParcial: se abrió por el botón "💸 Parcial" → el operador YA declaró que va a pagar de
// menos, así que no se le vuelve a pedir que tilde "Confirmo retiro PARCIAL". En el retiro completo
// el tilde se mantiene, porque ahí sí es un freno útil (evita pagar de menos sin darse cuenta).
api.abrirModalRetiroV2 = function(id, opts){
  const S = (deps.window.V154P && Array.isArray(deps.V154P.solicitudes)) ? deps.V154P.solicitudes : [];
  const s = S.find(function(x){ return String(x.ID||x.SOLICITUD_ID||x.ID_SOLICITUD)===String(id); });
  if(!s){ deps.toast('Solicitud no encontrada','red'); return; }
  let meta={}; try{ meta=(typeof s.METADATA==='object'?s.METADATA:JSON.parse(s.METADATA||'{}'))||{}; }catch(_e){}
  const declarado = Math.abs(Number(String(s.MONTO_REAL||s.MONTO_DECLARADO||0).toString().replace(/[^\d.-]/g,''))||0);
  const restante = (meta.monto_restante!=null) ? Number(meta.monto_restante) : declarado;
  // SIN redondear: el objetivo es la deuda real. _montoRedondo redondea hacia abajo (1.430.000 →
  // 1.400.000), así que aplicado acá se "perdían" pesos del total. El redondeo es solo para SUGERIR.
  // OJO con el 0: si monto_restante existe y vale 0, el retiro está SALDADO. El `restante>0?:`
  // lo tomaba como "sin dato" y volvía a mostrar la deuda entera → el retiro quedaba en proceso
  // pidiendo de nuevo lo que ya se pagó.
  const objetivo = (meta.monto_restante!=null) ? Math.max(0, Number(meta.monto_restante)||0) : declarado;
  deps.withdrawalState.current = {
    id:id, usuario:String(s.USUARIO||''), titular:String(s.TITULAR||s.NOMBRE_COMPLETO||''),
    cbu:String(s.CBU||s.CVU||s.CBU_ALIAS||s.DESTINO||'').trim(),
    declarado:declarado, objetivo:objetivo, yaPagado:Number(meta.monto_pagado||0)||0,
    _metaTotal:(meta.monto_total!=null?Number(meta.monto_total):null), // total real de un parcial previo
    // Total de la DEUDA, editable (si la solicitud entró con un monto mal cargado hay que poder
    // corregirlo). "Falta pagar" = totalReal - yaPagado, y se recalcula al editarlo.
    totalReal:(meta.monto_total!=null?Number(meta.monto_total):declarado),
    fase:'setup', saldoReal:null, sel:{}, montos:{}, hechas:{},
    // Modo parcial explícito: por el botón "Parcial" o porque ya hay un parcial en curso.
    modoParcial: !!((opts&&opts.modoParcial) || Number(meta.monto_pagado||0) > 0),
    // Lo que el jugador PIDIÓ, sin corregir: MONTO_REAL ya viene con la corrección aplicada. Con esto
    // se sabe si el monto quedó ajustado y hay que decirle por qué (D-88).
    declaradoOriginal: Number(meta.monto_declarado_original) || Number(s.MONTO_DECLARADO) || declarado,
    motivoAjuste: (meta.motivo_ajuste != null && String(meta.motivo_ajuste).trim()) ? String(meta.motivo_ajuste) : null,
    _motivoEditado: !!(meta.motivo_ajuste != null && String(meta.motivo_ajuste).trim()),
    _motivoAvisado: String(meta.motivo_ajuste || '')
  };
  // SIN pre-selección: los montos arrancan en 0 y los pone el operador. Pre-seleccionar el reparto
  // sugerido hacía que se pagara de más sin querer — un retiro de 1M salió por 821.778 porque el
  // modal ya venía con una segunda billetera tildada en 321.778 que nadie eligió.
  _rv2Render();
  deps._rv2LeerSaldo();
};

// Billeteras utilizables para pagar: excluye error/promos/REFERIDOS, y oculta las que
// NO aportan al total (saldo < 5% del objetivo) — no tiene sentido mostrar $38k para un
// retiro de $5M. Siempre deja al menos las 4 más grandes por si hace falta.
const RV2_MIN_RETIRABLE = 5000;   // con 5.000 fichas o más, el retiro es viable (criterio operativo)
// Qué monto ofrecer cuando el usuario declaró MÁS de lo que tiene.
// Criterio del operador: se respeta lo que el usuario QUISO teclear, no se le da todo el saldo.
//   pidió 200.000 y tiene 203.015 → quiso 20.000... no: 200.000/10 = 20.000 entra → SÍ, 20.000.
//   Dicho de otra forma: si hubiera querido TODO habría tecleado 250 (con el cero de más);
//   como tecleó 200, quiere 20 — le sacamos el cero al DECLARADO, no lo capamos al saldo.
// Si sacando ceros nunca entra, recién ahí se ofrece todo lo que tiene.
// Lo MÁXIMO que se le puede sacar: sus fichas enteras (sin centavos, que Agentes no retira), y
// sólo si llegan al mínimo operativo. Es lo que ofrece el botón de la tarjeta de pendientes.
api._retiroMaxRetirable = function(saldo){
  const s = Math.floor(Math.abs(Number(saldo) || 0) + 1e-9);
  return s >= RV2_MIN_RETIRABLE ? s : 0;
};
api._retiroMontoSugerido = function(declarado, saldo){
  declarado = Math.abs(Number(declarado)||0); saldo = Math.abs(Number(saldo)||0);
  if(!(declarado>0) || !(saldo>0)) return null;
  if(declarado <= saldo + 0.5) return null;                 // alcanza → no hay nada que ajustar
  // El "cero de más" solo es creíble si lo declarado es MUY superior al saldo (≥3x). Si declaró
  // 60.000 y tiene 55.000 no se comió un cero: quiso ~todo, y ofrecerle 6.000 sería 10x menos.
  const unCero = declarado/10;
  if(declarado >= saldo*3 && unCero <= saldo + 0.5 && unCero >= RV2_MIN_RETIRABLE && Number.isInteger(unCero))
    return { monto:unCero, motivo:'ceros', ceros:1 };
  if(saldo >= RV2_MIN_RETIRABLE) return { monto:Math.floor(saldo), motivo:'todo' };
  return null;                                              // ni con todo el saldo llega al mínimo
};
const _RV2_EXCL = /error|promo|referid/i;
const _RV2_MIN_SALDO = 200000; // billeteras con menos de $200k no se usan para retiros
// TODAS las billeteras operables, ordenadas por saldo. Solo se excluyen las que no son de pago
// (error/promo/referidos). Antes se escondían las de saldo bajo y las que no "aportaban al total":
// eso rompía el parcial, porque muchas veces se quiere pagar justo desde una chica. La elección
// es del operador; el panel solo SUGIERE (ver _rv2BilsSugeridas).
function _rv2BilsUsables(objetivo){
  return (deps.billeteras||[])
    .filter(function(b){ return !_RV2_EXCL.test(String(b.NOMBRE_VISIBLE||'')); })
    .sort(function(a,b){ return Number(b.SALDO||0)-Number(a.SALDO||0); });
}
// Las que el panel recomienda para cubrir el objetivo. NO filtra la lista: devuelve un Set de IDs
// que el render marca con el chip "sugerida".
function _rv2BilsSugeridas(objetivo){
  let conSaldo = (deps.billeteras||[]).filter(function(b){
    return !_RV2_EXCL.test(String(b.NOMBRE_VISIBLE||'')) && Number(b.SALDO||0) >= _RV2_MIN_SALDO;
  }).sort(function(a,b){ return Number(b.SALDO||0)-Number(a.SALDO||0); });
  const obj = Math.abs(Number(objetivo)||0);
  if(obj > 0 && conSaldo.length > 4){
    const umbral = obj * 0.05;
    const relevantes = conSaldo.filter(function(b){ return Number(b.SALDO||0) >= umbral; });
    conSaldo = relevantes.length >= 2 ? relevantes : conSaldo.slice(0, 4);
  }
  return new Set(conSaldo.map(function(b){ return String(b.ID_BILLETERA); }));
}
function _rv2TotalSel(){
  const st = deps.withdrawalState.current; if(!st) return 0;
  return Object.keys(st.sel).reduce(function(acc,bid){ return acc + (st.sel[bid] ? (Number(st.montos[bid])||0) : 0); }, 0);
}
// Pre-relleno al tildar una billetera: SIEMPRE el RESTANTE que falta para llegar al objetivo,
// nunca el saldo completo de la billetera. Antes `falta||saldo` caía al saldo completo cuando
// `falta` daba 0 (JS trata 0 como falsy) → tildabas una billetera de más y te "pasabas" solo.
// Al tildar se completa con el monto EXACTO que cubre esa billetera: min(saldo, lo que falta).
// Antes pasaba por _montoRedondo, que redondea hacia ABAJO al múltiplo de 10k → tildabas para
// pagar 25.000 y te ponía 20.000. El redondeo sirve para SUGERIR, no para el auto-relleno.
api._rv2Toggle = function(bid){ const st=deps.withdrawalState.current; if(!st) return; bid=String(bid); st.sel[bid]=!st.sel[bid]; if(st.sel[bid] && !st.montos[bid]){ const b=(deps.billeteras||[]).find(function(x){return String(x.ID_BILLETERA)===bid;}); const falta=Math.max(0, st.objetivo - _rv2TotalSel()); st.montos[bid]= Math.min(Number(b&&b.SALDO||0), falta); } else if(!st.sel[bid]){ delete st.montos[bid]; } _rv2Render(); };
// Agregar una billetera desde el DESPLEGABLE. Le pone lo que cubre: min(saldo, lo que falta).
// Si el objetivo ya está cubierto entra en 0 (el operador reparte a mano) — así agregar una de
// más no infla el total sin querer. Siempre recalcula: sacarla y volver a elegirla no arrastra
// el monto viejo.
api._rv2AgregarBil = function(bid){
  const st = deps.withdrawalState.current; if(!st || !bid) return;
  bid = String(bid);
  const b = (deps.billeteras||[]).find(function(x){ return String(x.ID_BILLETERA)===bid; });
  if(!b) return;
  st.sel[bid] = true;
  st.montos[bid] = 0;   // el monto lo pone el operador — auto-llenar hacía pagar de más sin querer
  _rv2Render();
  // Foco en el campo de esa billetera para tipear el monto de una.
  try{ deps.setTimeout(function(){ const i=deps.document.querySelector('[data-rv2monto="'+bid+'"]'); if(i){ i.focus(); i.select(); } }, 40); }catch(_e){}
};
api._rv2SetMonto = function(bid, val){ const st=deps.withdrawalState.current; if(!st) return; st.montos[String(bid)] = Math.abs(Number(String(val).replace(/[^\d.-]/g,''))||0); _rv2ActualizarTotal(); };
api._rv2SetParcialOk = function(v){ if(deps.withdrawalState.current) deps.withdrawalState.current.parcialAceptado = !!v; };
// Fija el retiro al SALDO REAL del usuario (declaró de más). Al mover el objetivo, `montoTotal`
// del cierre pasa a ser ese monto → el retiro cierra COMPLETO, sin dejar un parcial fantasma por
// la diferencia mal declarada. Re-sugiere las billeteras para el monto nuevo.
// Atajo desde la card de pendientes: abre el modal de retiro YA ajustado al saldo real del usuario.
api._retiroAjustarASaldo = async function(id){
  const S=(deps.window.V154P&&deps.V154P.solicitudes)||[];
  const s=S.find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
  if(!s){ deps.toast('No encuentro la solicitud #'+id+' en pantalla.','red'); return; }
  const u=String(s.USUARIO||'').toLowerCase();
  const saldo=Number(((deps.window._retiroSaldoCheck||{})[u]||{}).saldo||0);
  const declarado=Number(s.MONTO_REAL||s.MONTO_DECLARADO||0);
  // Lo que se le deja pedido es TODO lo que tiene para retirar. Antes se ofrecía el monto "sin el
  // cero de más", que le dejaba fichas adentro (Juan, 14/09).
  const monto = deps.window._retiroMaxRetirable ? deps.window._retiroMaxRetirable(saldo) : 0;
  if(!saldo){ deps.toast('Todavía no se leyó el saldo de '+(s.USUARIO||'ese usuario')+'. Abrí el retiro y se lee.','yellow'); return; }
  if(!monto){ deps.toast(s.USUARIO+' tiene '+deps.money(saldo)+': menos del mínimo retirable ('+deps.money(RV2_MIN_RETIRABLE)+').','yellow'); return; }
  // SIN preguntar: el botón dice el monto y lo hace. El confirm que había acá frenaba todo — si no
  // se aceptaba (o no llegaba a aparecer) el botón parecía muerto.
  s.MONTO_REAL = monto;                               // en memoria, para que repinte ya
  if(s.metadata) s.metadata.monto_corregido = monto;
  // El monto corregido se escribe EN LA SOLICITUD, que es el único lugar donde tiene que cambiar:
  // de ahí sale MONTO_REAL y con eso quedan bien la tarjeta, el modal, el historial y lo que ve el
  // cliente. El error ya no se descarta en silencio: si no se guardó, hay que saberlo.
  try{
    await deps.window.actualizarSolicitudPortal(String(id), String(s.ESTADO||'PENDIENTE'), {
      monto_corregido: monto,
      monto_declarado_original: declarado,
      motivo_correccion: (declarado >= saldo*3 ? 'ceros' : 'todo'),
      motivo_ajuste: 'Tenías '+deps.money(saldo)+' en fichas y pediste '+deps.money(declarado)+': te pagamos todo lo que tenías.',
      operador: (deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel'
    });
    deps.toast('Retiro #'+id+' ajustado a '+deps.money(monto)+' (todo lo que tiene).','green');
  }catch(e){
    deps.toast('No se pudo guardar el monto: '+((e&&e.message)||e)+' · reintentá.','red');
    return;
  }
  if(typeof deps.abrirModalRetiroV2!=='function'){ deps.toast('Modal de retiro no disponible.','red'); return; }
  deps.abrirModalRetiroV2(id);
  const sug={ monto:monto };
  // Cuando el modal terminó de montar, fijamos el objetivo al monto sugerido.
  let _intentos = 0;
  (function _ajustar(){
    const st = deps.withdrawalState.current;
    if(st && String(st.id) === String(id)){
      try{ st.saldoReal = saldo; deps.window._rv2AjustarASaldo(sug.monto); }catch(_e){}
      return;
    }
    if(++_intentos < 30) deps.setTimeout(_ajustar, 100);
  })();
};
api._rv2AjustarASaldo = function(montoFijo){
  const st=deps.withdrawalState.current; if(!st) return;
  let nuevo = Math.abs(Number(montoFijo)||0);
  if(!nuevo){                                    // sin monto explícito → lo calculamos
    const s = deps.window._retiroMontoSugerido(st.objetivo, st.saldoReal||0);
    nuevo = s ? s.monto : 0;
  }
  if(!(nuevo>0)) return;
  st.objetivo = nuevo;
  // Esto cambia la DEUDA, no sólo lo que se paga ahora. El total quedaba en lo declarado
  // ($50.000): el cierre calculaba contra eso y dejaba un parcial fantasma por la diferencia que el
  // jugador no tiene. Se corrige el total y se escribe en la solicitud, igual que el atajo de la
  // tarjeta — que era el único que lo hacía.
  st.totalReal = (Number(st.yaPagado)||0) + nuevo;
  st._metaTotal = st.totalReal;
  st._motivoEditado = false;      // el motivo sugerido se recalcula con el total nuevo
  try{
    const S=(deps.window.V154P&&deps.V154P.solicitudes)||[];
    const s=S.find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(st.id); });
    if(s) s.MONTO_REAL = st.totalReal;
    const _p = deps.window.actualizarSolicitudPortal(String(st.id), String((s&&s.ESTADO)||'PENDIENTE'), {
      monto_corregido: st.totalReal, monto_declarado_original: (st.declaradoOriginal||st.declarado), motivo_correccion: 'todo',
      motivo_ajuste: _rv2MotivoSugerido(st),
      operador: (deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel'
    });
    if(_p && typeof _p.catch === 'function') _p.catch(function(){});
  }catch(_e){}
  st.sel={}; st.montos={};
  try{
    const rep = deps.recomendarRepartoRetiro(nuevo);
    (rep.reparto||[]).forEach(function(x){ st.sel[String(x.id)]=true; st.montos[String(x.id)]=x.usar; });
  }catch(_e){}
  if(!Object.keys(st.sel).length){
    let falta = nuevo, usadas = 0;
    _rv2BilsUsables(nuevo).forEach(function(b){
      if(falta <= 0.5 || usadas >= 3) return;
      const usar = Math.min(Math.max(0, Number(b.SALDO||0)), falta);
      if(usar <= 0) return;
      st.sel[String(b.ID_BILLETERA)] = true; st.montos[String(b.ID_BILLETERA)] = usar;
      falta -= usar; usadas++;
    });
  }
  _rv2Render();
  try{ deps.toast('Retiro ajustado a '+deps.money(nuevo)+' (lo que el usuario tiene)','blue'); }catch(_e){}
  deps._rv2LeerSaldo();
};
// Línea derivada del total: ya pagado / falta pagar. No se edita, se calcula.
function _rv2DeudaTxt(){
  const st=deps.withdrawalState.current; if(!st) return '';
  const ya=Number(st.yaPagado||0), tot=Number(st.totalReal||0);
  const falta=Math.max(0, tot-ya);
  if(ya<=0.5) return 'Sin pagos todavía · falta pagar <b style="color:#e6edf3">'+deps.money(falta)+'</b>';
  return 'Ya pagado <b style="color:#22c55e">'+deps.money(ya)+'</b> · falta pagar <b style="color:#f5c518">'+deps.money(falta)+'</b>';
}
// Editar el TOTAL cambia la deuda: se recalcula lo que falta y, con eso, lo que se paga ahora.
api._rv2InputTotal = function(el){
  const st=deps.withdrawalState.current; if(!st) return;
  const raw=Math.abs(Number(String(el.value).replace(/[^\d]/g,''))||0);
  st.totalReal=raw;
  el.value=_rv2FmtMiles(raw);
  const falta=Math.max(0, raw-Number(st.yaPagado||0));
  st.objetivo=falta;                                   // lo que se paga ahora sigue a la deuda
  try{ const d=deps.document.getElementById('rv2Deuda'); if(d) d.innerHTML=_rv2DeudaTxt(); }catch(_e){}
  _rv2PintarMotivo();
  _rv2ActualizarTotal();
};
api._rv2SetObjetivo = function(val){ const st=deps.withdrawalState.current; if(!st) return; st.objetivo = Math.abs(Number(String(val).replace(/[^\d.-]/g,''))||0); _rv2ActualizarTotal(); };
// Formato de miles en vivo (5.000.000) para que no marean los ceros. Parsea solo dígitos.
// OJO con los centavos: si llega un NÚMERO (538395.01) no se puede limpiar con replace(/[^\d]/),
// porque se come el punto decimal y pega los centavos → 53.839.501. Los números se redondean;
// el strip de no-dígitos es solo para lo que TIPEA el operador (donde el punto es de miles).
function _rv2FmtMiles(n){
  const v = (typeof n === 'number')
    ? Math.abs(Math.round(n))
    : Math.abs(Number(String(n).replace(/[^\d]/g,''))||0);
  return v ? v.toLocaleString('es-AR') : '';
}
api._rv2InputObjetivo = function(el){ const st=deps.withdrawalState.current; if(!st) return; const raw=Math.abs(Number(String(el.value).replace(/[^\d]/g,''))||0); st.objetivo=raw; el.value=_rv2FmtMiles(raw); _rv2ActualizarTotal(); };
api._rv2InputMonto = function(el, bid){ const st=deps.withdrawalState.current; if(!st) return; const raw=Math.abs(Number(String(el.value).replace(/[^\d]/g,''))||0); st.montos[String(bid)]=raw; el.value=_rv2FmtMiles(String(raw)); _rv2ActualizarTotal(); };
// (Acá había una SEGUNDA definición de _rv2InputTotal que pisaba a la de arriba y llamaba a
// _rv2Render(): redibujaba el modal entero en cada tecla y el campo perdía el foco — había que
// hacer clic de nuevo para escribir cada dígito. Se sacó; queda la de arriba, que actualiza sólo
// lo que cambia.)
function _rv2ActualizarTotal(){
  const st=deps.withdrawalState.current; if(!st) return;
  const tot=_rv2TotalSel(); const el=deps.document.getElementById('rv2Total');
  if(!el) return;
  // Se mide contra LO QUE FALTA de la deuda (totalReal − yaPagado), no contra st.objetivo, que se
  // lee al abrir y puede venir del metadata podrido. Si no, esta línea decía "/ $200.000" mientras
  // el campo de arriba mostraba que faltaban $250.000.
  const falta = Math.max(0, Number(st.totalReal||0) - Number(st.yaPagado||0));
  const parcial = tot < falta-0.5;
  const paso    = tot > falta+0.5;
  const ok = tot>0 && !paso;
  let html = 'Seleccionado: <b style="color:'+(ok?'#22c55e':'#f87171')+'">'+deps.money(tot)+'</b> / '+deps.money(st.objetivo)
    + (parcial?' · <span style="color:#f5c518">parcial</span>':(paso?' · <span style="color:#f87171">¡te pasaste!</span>':' ✓'));
  // Aviso VISIBLE (no solo el confirm al aprobar): entraste por "Parcial" pero el monto cubre todo.
  if(st.modoParcial && !parcial && !paso && tot > 0){
    // En la SEGUNDA cuota pagar el resto es lo normal (es la única forma de cerrar un parcial):
    // ahí no es una advertencia. En la primera sí, porque suele ser la billetera que se autocompletó.
    html += (Number(st.yaPagado||0) > 0)
      ? '<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.40);font-size:12px;font-weight:800;color:#22c55e">'
          + '✓ Con este pago se completa el retiro y se cierra.</div>'
      : '<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(240,68,56,.10);border:1px solid rgba(240,68,56,.40);font-size:12px;font-weight:800;color:#f87171">'
          + '⚠ Con este monto el retiro queda COMPLETO, no parcial — bajá el monto de la billetera si querías abonar solo una parte.</div>';
  }
  // Pagar de más no se frena, pero se ve (Juan, 12/09: "mientras dé un aviso de 'te pasaste' y sea visible").
  if(paso){
    html += '<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(240,68,56,.10);border:1px solid rgba(240,68,56,.40);font-size:12px;font-weight:800;color:#f87171">'
          + '⚠ Te pasaste: vas a pagar '+deps.money(tot)+' y faltan '+deps.money(falta)+' — son '+deps.money(tot-falta)+' de más. Si el total está mal, corregilo arriba.</div>';
  }
  // Retiro PARCIAL → tilde de aceptación (sin él, no deja aprobar). El tilde no pregunta "¿es
  // parcial?" (obvio, ya lo estás armando así) — confirma que quedan $X SIN pagar y la solicitud
  // sigue abierta para el resto (no se cierra como terminada).
  if(parcial){
    html += st.modoParcial
      // Modo parcial explícito: NO se pide tilde (ya se eligió pagar de a partes). Solo se informa
      // cuánto queda pendiente, para que el operador lo vea antes de confirmar.
      ? ('<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(245,197,24,.25);font-size:12px;color:#f5c518;font-weight:700">'
         + '💸 Quedan '+deps.money(st.objetivo-tot)+' pendientes · la solicitud sigue abierta para pagarlos después</div>')
      : ('<label style="display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(245,197,24,.25);font-size:12px;color:#f5c518;font-weight:700;cursor:pointer">'
         + '<input type="checkbox" '+(st.parcialAceptado?'checked':'')+' onchange="_rv2SetParcialOk(this.checked)" style="width:16px;height:16px">'
         + 'Sí, transfiero solo esto ahora — quedan '+deps.money(st.objetivo-tot)+' PENDIENTES (la solicitud sigue abierta para pagarlos después)</label>');
  }
  el.innerHTML = html;
  _rv2ActualizarBotonAprobar();
  try{
    const nSel=Object.keys(st.sel||{}).filter(function(k){ return st.sel[k] && Number(st.montos[k])>0; }).length;
    const modo=deps.document.getElementById('rv2ModoCada');
    if(modo) modo.style.display = nSel>1 ? 'block' : 'none';
    // El veredicto y el resumen de arriba tienen que seguir a lo que se toca abajo.
    _rv2PintarVeredicto();
    const r=deps.document.getElementById('rv2Resumen');  if(r) r.innerHTML=_rv2ResumenPago();
  }catch(_e){}
}
// El botón dice exactamente lo que va a hacer. Antes decía siempre "Aprobar" y la diferencia
// entre pagar todo y pagar una parte quedaba escondida en un tilde.
function _rv2ActualizarBotonAprobar(){
  const st=deps.withdrawalState.current; if(!st) return;
  const btn=deps.document.getElementById('rv2BtnAprobar'); if(!btn) return;
  if(st._pagando){ btn.disabled=true; btn.style.opacity=.7; return; }   // buscando en Agentes
  const tot=_rv2TotalSel();
  // Lo único que TRABA es no haber elegido de dónde pagar. Antes se bloqueaba cuando el monto
  // superaba "lo que falta", y eso dejaba el botón muerto en "Te pasaste de $0" —sin salida—
  // cuando el progreso guardado venía mal o el operador todavía no había corregido la deuda.
  // Pagar de más SÍ importa, pero es un aviso: el que sabe cuánto se debe es el operador.
  if(tot<=0){ btn.textContent='Elegí de qué billetera pagar'; btn.disabled=true; btn.style.opacity=.55; return; }
  btn.disabled=false; btn.style.opacity=1;
  const falta = Math.max(0, Number(st.totalReal||0) - Number(st.yaPagado||0));
  const deMas = tot - falta;
  if(deMas > 0.5){
    btn.textContent = 'Pagar '+deps.money(tot)+' · ' + (falta<=0.5
      ? 'el retiro ya figura saldado — corregí el total arriba'
      : deps.money(deMas)+' MÁS de lo que falta');
    btn.style.background = '#b45309';
    return;
  }
  btn.style.background = '#ea580c';
  btn.textContent = (falta - tot > 0.5)
    ? ('Pagar '+deps.money(tot)+' ahora · quedan '+deps.money(falta-tot))
    : ('Pagar y cerrar el retiro · '+deps.money(tot));
}

// ── Veredicto: lo PRIMERO que se lee, antes de cualquier planilla ──────────────────────────
// El modal mostraba nueve bloques del mismo peso y el dato que decide todo — si el usuario tiene
// las fichas — era un subtítulo gris que además cargaba tarde. Acá se resuelve en una línea.
function _rv2Veredicto(){
  const st=deps.withdrawalState.current; if(!st) return null;
  const tot=_rv2TotalSel(), falta=Math.max(0, st.objetivo-tot);
  if(st.saldoReal==null && st.saldoFallo==='no_existe')
    return {n:'mal', c:'#f87171', ico:'🚫', tit:'ESTE USUARIO NO ESTÁ EN AGENTES', reintentar:true,
      det:'Buscamos a '+deps.escapeHtml(st.usuario)+' y no aparece. Revisá el nombre antes de pagar.'};
  if(st.saldoReal==null && st.saldoFallo)
    return {n:'espera', c:'#f59e0b', ico:'❓', tit:'NO PUDIMOS LEER SUS FICHAS', reintentar:true,
      det: st.saldoFallo==='ocupado' ? 'Hay otra operación en curso. Esperá un momento y reintentá.'
         : st.saldoFallo==='sesion'  ? 'Se cayó la sesión de Agentes. Tocá Reintentar: se abre el login y sigo desde acá.'
                                     : 'El casino no devolvió el saldo. Reintentá antes de pagar.'};
  if(st.saldoReal==null)
    return {n:'espera', c:'#8b949e', ico:'⏳', tit:'LEYENDO LAS FICHAS DEL USUARIO', det:'Un segundo…'};
  if(st.saldoReal<=0.5)
    return {n:'mal', c:'#f87171', ico:'🚫', tit:'NO TIENE FICHAS', det:'El saldo en Agentes es '+deps.money(0)+'. No hay nada para retirar.'};
  if(st.saldoReal < st.objetivo-0.5){
    const sug = deps.window._retiroMontoSugerido ? deps.window._retiroMontoSugerido(st.objetivo, st.saldoReal) : null;
    return {n:'mal', c:'#f87171', ico:'🚫', tit:'NO TIENE LAS FICHAS',
      det:'Pidió '+deps.money(st.objetivo)+' y tiene '+deps.money(st.saldoReal)+'.', sug:sug};
  }
  if(falta<=0.5)
    return {n:'ok', c:'#22c55e', ico:'✅',
      tit: st.yaPagado>0 ? 'SE PUEDE CERRAR EL RETIRO' : 'SE PUEDE PAGAR COMPLETO',
      det: st.yaPagado>0 ? ('Pagando '+deps.money(tot)+' queda saldado. Tiene '+deps.money(st.saldoReal)+' en fichas.')
                         : ('Tiene '+deps.money(st.saldoReal)+' en fichas.')};
  if(tot <= 0.5){
    const disp = _rv2BilsUsables(st.objetivo)
      .reduce(function(a,b){ return a + Math.max(0, Number(b.SALDO||0)); }, 0);
    return (disp >= falta - 0.5)
      ? {n:'medio', c:'#58a6ff', ico:'👇', tit:'ELEGÍ DE QUÉ BILLETERA PAGAR',
         det:'Hay '+deps.money(disp)+' en billeteras. Elegí abajo de cuál sale.'}
      : {n:'medio', c:'#f5c518', ico:'⚠️', tit:'LAS BILLETERAS NO ALCANZAN',
         det:'Entre todas hay '+deps.money(disp)+' y faltan '+deps.money(falta)+'. Se puede pagar una parte.'};
  }
  return {n:'medio', c:'#f5c518', ico:'⚠️', tit:'LO ELEGIDO NO CUBRE EL TOTAL',
    det:'Se paga '+deps.money(tot)+' ahora · quedan '+deps.money(falta)+' para después.'};
}
// Conviven dos modales de retiro segun de donde se abra el retiro: uno tiene #rv2Veredicto y el
// otro #rv2SaldoReal. Hay que pintar en el que exista — buscando solo el primero, en el modal que
// quedo tras el merge el saldo se leia (consulta real a Agentes, con reintentos) y no se mostraba
// en ningun lado: el if(v) lo hacia fallar en silencio, justo en la pantalla que mueve plata.
function _rv2PintarVeredicto(){
  try{
    const v = deps.document.getElementById('rv2Veredicto') || deps.document.getElementById('rv2SaldoReal');
    if(v) v.innerHTML = _rv2VeredictoHtml();
  }catch(_e){}
}
function _rv2VeredictoHtml(){
  const v=_rv2Veredicto(); if(!v) return '';
  const st=deps.withdrawalState.current;
  return '<div style="border-radius:12px;padding:12px 14px;border:1.5px solid '+v.c+'55;background:'+v.c+'12">'
    + '<div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#8b949e;margin-bottom:3px">Cotejo de fichas</div>'
    + '<div style="font-size:14px;font-weight:900;color:'+v.c+';letter-spacing:.02em">'+v.ico+' '+v.tit+'</div>'
    + '<div style="font-size:13px;color:#e6edf3;margin-top:3px">'+v.det+'</div>'
    + (v.reintentar ? '<button class="mini-btn" style="margin-top:8px;background:#21262d;border:1px solid #30363d;color:#e6edf3;font-weight:800;font-size:12px" onclick="_rv2ReleerFichas()">🔄 Reintentar</button>' : '')
    + (v.sug ? '<button class="mini-btn" style="margin-top:8px;background:#ea580c;color:#fff;font-weight:800;font-size:12px" onclick="_rv2AjustarASaldo('+v.sug.monto+')">'
        + (v.sug.motivo==='ceros' ? ('✔ Le sobró un cero — pagar '+deps.money(v.sug.monto)) : ('✔ Pagarle todo lo que tiene · '+deps.money(v.sug.monto)))
        + '</button>' : '')
    + (st.yaPagado>0 ? '<div style="margin-top:8px;padding-top:7px;border-top:1px solid '+v.c+'33;font-size:12px;color:#f5c518;font-weight:700">'
        + '🔄 Segunda cuota · ya le transferiste '+deps.money(st.yaPagado)+(st._metaTotal!=null?(' de '+deps.money(st._metaTotal)):'')
        + ' — abajo va lo que FALTA, no el total</div>' : '')
    + '</div>';
}
// Resumen de UNA línea de con qué se paga. El detalle (elegir/editar) va plegado.
function _rv2ResumenPago(){
  const st=deps.withdrawalState.current; if(!st) return '';
  const sel=_rv2BilsUsables().filter(function(b){ return st.sel[String(b.ID_BILLETERA)] && Number(st.montos[String(b.ID_BILLETERA)])>0; });
  if(!sel.length) return '<div class="small" style="color:#f87171;margin-top:2px">Ninguna billetera elegida — abrí "cambiar" acá abajo.</div>';
  return sel.map(function(b){
    return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0">'
      + '<span style="color:#c9d1d9">💳 '+deps.escapeHtml(b.NOMBRE_VISIBLE||'—')+'</span>'
      + '<b style="color:#e6edf3">'+deps.money(Number(st.montos[String(b.ID_BILLETERA)])||0)+'</b></div>';
  }).join('');
}
api._rv2ToggleDetalle=function(){
  const d=deps.document.getElementById('rv2Detalle'), t=deps.document.getElementById('rv2DetalleTog');
  if(!d) return;
  const abierto = d.style.display!=='none';
  d.style.display = abierto ? 'none' : 'block';
  if(t) t.textContent = abierto ? '▸ Cambiar billeteras, monto o pagar sólo una parte' : '▾ Ocultar el detalle';
};
// ── Motivo del ajuste del monto (D-88) ─────────────────────────────────────────────────────
// Cuando el total queda distinto de lo que pidió el jugador, el operador escribe (o acepta) el
// motivo. Se guarda en la solicitud, el portal lo muestra debajo del progreso y va UNA vez por chat.
function _rv2MotivoSugerido(st){
  const dec = Number(st.declaradoOriginal||0), tot = Number(st.totalReal||0);
  if(!(dec>0) || !(tot>0)) return '';
  if(dec > tot && Math.abs(dec - tot*10) <= 0.5)
    return 'Al monto le sobraba un cero: pediste '+deps.money(dec)+' y es '+deps.money(tot)+'.';
  const fichas = (st.saldoReal!=null) ? Number(st.saldoReal) + Number(st.yaPagado||0) : null;
  if(fichas!=null && tot < dec && Math.abs(fichas - tot) <= 0.5)
    return 'Tenías '+deps.money(fichas)+' en fichas y pediste '+deps.money(dec)+': te pagamos todo lo que tenías.';
  return 'Pediste '+deps.money(dec)+' y el retiro quedó en '+deps.money(tot)+'.';
}
function _rv2AjusteVisible(st){
  const dec = Number(st.declaradoOriginal||0), tot = Number(st.totalReal||0);
  return dec > 0 && tot > 0 && Math.abs(tot - dec) > 0.5;
}
function _rv2MotivoAjusteHtml(){
  const st = deps.withdrawalState.current; if(!st || !_rv2AjusteVisible(st)) return '';
  if(!st._motivoEditado) st.motivoAjuste = _rv2MotivoSugerido(st);
  return '<div style="margin-top:8px"><label style="font-weight:800">MOTIVO DEL AJUSTE '
    + '<span class="small" style="color:#8b949e;font-weight:600">(lo ve el jugador · había pedido '+deps.money(st.declaradoOriginal)+')</span></label>'
    + '<input id="rv2MotivoAjuste" type="text" maxlength="200" value="'+deps.escapeHtml(st.motivoAjuste||'')+'" oninput="_rv2SetMotivoAjuste(this.value)" '
    + 'placeholder="Por qué cambia el monto" style="width:100%;height:40px;background:#161b22;border:1.5px solid rgba(245,197,24,.45);color:#f0f6fc;border-radius:9px;font-size:13px;padding:0 11px;margin-top:4px"></div>';
}
// Sólo repinta la caja del motivo, y nunca mientras el operador está escribiendo en ella.
function _rv2PintarMotivo(){
  try{
    const mb = deps.document.getElementById('rv2MotivoBox'); if(!mb) return;
    const ae = deps.document.activeElement;
    if(ae && ae.id === 'rv2MotivoAjuste') return;
    mb.innerHTML = _rv2MotivoAjusteHtml();
  }catch(_e){}
}
api._rv2SetMotivoAjuste = function(v){
  const st = deps.withdrawalState.current; if(!st) return;
  st.motivoAjuste = String(v||'').slice(0,200);
  st._motivoEditado = true;
};

function _rv2Render(){
  const st = deps.withdrawalState.current; if(!st) return;
  const el = _rv2Modal();
  if(st.fase==='confirmar'){ deps._rv2RenderConfirmar(); return; }
  const bils = _rv2BilsUsables(st.objetivo);
  const _sug = _rv2BilsSugeridas(st.objetivo);   // solo marca visual, no filtra la lista
  // ── Selector de billeteras: DESPLEGABLE (como la operación manual) ──────────────────────────
  // Antes era una lista de 10+ checkboxes que había que recorrer con la vista. Ahora se elige del
  // desplegable (ordenado de MAYOR a MENOR saldo) y la billetera pasa abajo con su monto. Se
  // pueden agregar varias: para un retiro grande se reparte, para un parcial se usa una sola.
  const _elegidas = bils.filter(function(b){ return !!st.sel[String(b.ID_BILLETERA)]; });
  const _libres   = bils.filter(function(b){ return  !st.sel[String(b.ID_BILLETERA)]; });
  const _faltaAun = Math.max(0, st.objetivo - _rv2TotalSel());

  const selectBil = '<select onchange="_rv2AgregarBil(this.value); this.selectedIndex=0;" '
    + 'style="width:100%;height:40px;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:9px;font-size:13px;font-weight:600;padding:0 10px;margin-top:5px;cursor:pointer">'
    + '<option value="">'+(_libres.length ? '+ Elegí una billetera…' : '— no quedan billeteras —')+'</option>'
    + _libres.map(function(b){
        return '<option value="'+deps.escapeHtml(String(b.ID_BILLETERA))+'">'
          + deps.escapeHtml(b.NOMBRE_VISIBLE||'—') + ' — ' + deps.money(b.SALDO||0)
          + (_sug.has(String(b.ID_BILLETERA)) ? '  ★ sugerida' : '')
          + '</option>';
      }).join('')
    + '</select>';

  const filasBil = selectBil + (_elegidas.length
    ? _elegidas.map(function(b){
        const bid=String(b.ID_BILLETERA); const monto=Number(st.montos[bid]||0);
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:#12261a;border:1px solid rgba(34,197,94,.4);margin-top:6px">'
          + '<div style="flex:1;min-width:0;line-height:1.2"><span style="font-weight:700;color:#e6edf3;font-size:13px">'+deps.escapeHtml(b.NOMBRE_VISIBLE||'—')+'</span>'
          +   '<div style="color:#8b949e;font-size:11px">saldo '+deps.money(b.SALDO||0)+'</div></div>'
          // El monto se completa solo con min(saldo, lo que falta); se puede tocar para cambiarlo.
          + '<input type="text" inputmode="numeric" data-rv2monto="'+bid+'" value="'+_rv2FmtMiles(monto)+'" oninput="_rv2InputMonto(this,\''+bid+'\')" placeholder="0" title="Escribí cuánto pagás desde esta billetera" style="width:110px;text-align:right;background:transparent;border:none;border-bottom:1px dashed '+(monto>0?'rgba(34,197,94,.45)':'rgba(248,113,113,.55)')+';border-radius:0;color:'+(monto>0?'#22c55e':'#f87171')+';padding:4px;font-weight:800;font-size:15px">'
          + '<button type="button" onclick="_rv2Toggle(\''+bid+'\')" title="Sacar" style="background:transparent;border:none;color:#f87171;cursor:pointer;font-size:15px;padding:0 2px;flex-shrink:0">✕</button>'
          + '</div>';
      }).join('')
    : '<div class="small" style="color:#5a6474;margin-top:6px;text-align:center;padding:8px;border:1px dashed #262d3a;border-radius:8px">Todavía no elegiste con qué pagar</div>')
    + (_elegidas.length && _faltaAun > 0.5
        ? '<div class="small" style="color:#8b949e;margin-top:5px">Podés agregar otra billetera para cubrir los '+deps.money(_faltaAun)+' que faltan.</div>'
        : '');
  const cbuHtml = st.cbu ? ('<button type="button" onclick="portalCopiarCbu(this)" data-valor="'+deps.escapeHtml(st.cbu)+'" title="Tocá para copiar" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;cursor:pointer;background:#161b22;border:1px solid rgba(251,146,60,.45);border-radius:9px;padding:8px 11px;color:#e6edf3;margin-top:8px"><span style="min-width:0;flex:1"><span style="display:block;font-size:10px;font-weight:800;text-transform:uppercase;color:#8b949e">CBU / Alias destino · tocá para copiar</span><span style="display:block;font-family:ui-monospace,monospace;font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+deps.escapeHtml(st.cbu)+'</span></span><span class="pcopy-ico" style="font-size:15px">📋</span></button>') : '';
  el.innerHTML =
    '<div style="max-height:82vh;overflow:auto;background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.55);padding:16px;color:#e6edf3">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">'
    +   '<div><div style="font-size:17px;font-weight:900;color:#fb923c">⬆ Aprobar retiro</div>'
    +     '<div class="small" style="color:#8b949e">#'+deps.escapeHtml(String(st.id))+' · '+deps.escapeHtml(st.usuario)+'</div></div>'
    +   '<button class="mini-btn" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:7px 10px" onclick="cerrarRetiroV2()">Cerrar</button>'
    + '</div>'
    // Banner GRANDE si ya se pagó una parte antes: antes era un subtítulo chico y gris que
    // pasaba desapercibido ("no se entiende, no cambia el monto") — ahora no se puede no ver.
    + (st.yaPagado>0
      ? '<div style="border-radius:11px;padding:10px 12px;margin-bottom:10px;background:rgba(245,197,24,.1);border:1.5px solid rgba(245,197,24,.5);text-align:center">'
        +   '<div style="font-size:12px;font-weight:900;color:#f5c518;text-transform:uppercase;letter-spacing:.03em">🔄 Retiro parcial en curso</div>'
        +   '<div style="font-size:13px;color:#e6edf3;margin-top:3px">Ya le transferiste <b style="color:#22c55e">'+deps.money(st.yaPagado)+'</b>'+(st._metaTotal!=null?(' de '+deps.money(st._metaTotal)):'')+' · el monto de abajo es lo que <b>FALTA</b>, no el total original</div>'
        + '</div>'
      : '')
    // Avisos de bono sin liberar / CBU compartido, arriba de todo y antes de la plata.
    // SOLO INFORMAN: no deshabilitan nada, la decisión sigue siendo del operador.
    + ((deps.window._alertaRetiroHtml ? deps.window._alertaRetiroHtml(st.id, {monto: st.objetivo, expandido:true}) : '') || '')
    + '<div style="border-radius:11px;padding:11px;text-align:center;border:1px solid rgba(251,146,60,.35);background:rgba(251,146,60,.06)">'
    +   '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#8b949e">Transferir a</div>'
    +   '<div style="font-size:19px;font-weight:900;color:#f0f6fc;line-height:1.2">'+deps.escapeHtml(st.titular||st.usuario)+'</div>'
    +   '<div id="rv2SaldoReal" class="small" style="color:#8b949e;margin-top:3px">💰 leyendo saldo real…</div>'
    +   cbuHtml
    +   '<div style="margin-top:9px;padding-top:8px;border-top:1px solid #262d3a">'
    +     '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#8b949e;margin-bottom:2px">Sale de</div>'
    +     '<div id="rv2Resumen">'+_rv2ResumenPago()+'</div>'
    +   '</div>'
    + '</div>'
    // En modo PARCIAL este campo es lo que FALTA pagar y va bloqueado. Editable, se prestaba a un
    // error grave: el operador ponía acá "lo que pago ahora" (ej. 25.000 de un retiro de 50.000) y
    // el cierre tomaba ese número como TOTAL del retiro → lo daba por PAGADO con la mitad. Lo que
    // se paga ahora lo define la billetera, no este campo. En el retiro completo sigue editable,
    // porque ahí sí sirve para corregir un monto mal declarado.
    + (st.modoParcial
        // El TOTAL de la deuda es editable (si la solicitud entró con un monto mal cargado hay que
        // poder corregirlo). "Falta pagar" se deriva: total − ya pagado. Lo que se paga AHORA lo
        // define la billetera, no este campo.
        ? ('<div style="margin-top:12px"><label style="font-weight:800">TOTAL DEL RETIRO <span class="small" style="color:#8b949e;font-weight:600">(corregilo si vino mal)</span></label>'
           + '<input id="rv2TotalReal" type="text" inputmode="numeric" value="'+_rv2FmtMiles(st.totalReal)+'" oninput="_rv2InputTotal(this)" style="width:100%;height:44px;background:#161b22;border:1.5px solid #30363d;color:#f0f6fc;border-radius:9px;font-weight:900;font-size:20px;padding:0 12px;margin-top:4px">'
           + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:12.5px">'
           +   '<span style="color:#8b949e">Ya pagado <b style="color:#a78bfa">'+deps.money(st.yaPagado||0)+'</b></span>'
           +   '<span style="color:#8b949e">FALTA PAGAR <b style="color:#f5c518">'+deps.money(st.objetivo)+'</b></span>'
           + '</div>'
           + '<div class="small" style="color:#8b949e;margin-top:3px">Elegí abajo con qué billetera pagás y escribí cuánto — el resto queda pendiente.</div></div>')
        : ('<div style="margin-top:12px"><label style="font-weight:800">MONTO REAL A RETIRAR</label>'
           + '<input id="rv2Objetivo" type="text" inputmode="numeric" value="'+_rv2FmtMiles(st.objetivo)+'" oninput="_rv2InputObjetivo(this)" style="width:100%;height:44px;background:#161b22;border:1.5px solid #fb923c;color:#f0f6fc;border-radius:9px;font-weight:900;font-size:20px;padding:0 12px;margin-top:4px"></div>'))
    + '<div style="margin-top:12px;font-weight:800;color:#c9d1d9">¿Con qué billetera pagás? <span class="small" style="color:#8b949e;font-weight:400">(elegí la que quieras · <span style="color:#f5c518">sugerida</span> = la que recomienda el panel)</span></div>'
    + filasBil
    + '<div id="rv2MotivoBox">'+_rv2MotivoAjusteHtml()+'</div>'
    + '<div id="rv2Total" style="margin-top:10px;padding:8px 10px;background:#161b22;border-radius:9px;font-size:13px"></div>'
    + '<div style="margin-top:10px"><label>💬 Mensaje al usuario <span class="small" style="color:#8b949e">(opcional · se le envía al pagar)</span></label>'
    +   '<textarea id="rv2Obs" rows="2" style="width:100%;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:9px;margin-top:3px" placeholder="Ej: te transferimos 400.000, el resto en cuanto se libere otra billetera"></textarea></div>'
    // ("Confirmar una por una" se sacó a pedido de Juan: no aportaba y era un segundo camino de
    //  código para lo mismo — un arreglo cubría uno y el otro seguía roto.)
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">'
    +   '<button class="mini-btn" style="background:transparent;border:1px solid #30363d;color:#c9d1d9" onclick="cerrarRetiroV2()">Cancelar</button>'
    +   '<button id="rv2BtnAprobar" class="mini-btn" style="background:#ea580c;color:#fff;font-weight:800" onclick="_rv2Aprobar()">Aprobar y transferir</button>'
    + '</div></div>';
  el.style.display='block';
  _rv2ActualizarTotal();
}

// Sólo LEE el saldo y refresca el veredicto. Antes armaba acá adentro su propio cartel con su
// propio botón de ajuste, en paralelo al de la tarjeta del pendiente: dos lugares distintos
// diciendo lo mismo con textos distintos. Ahora hay un solo veredicto y él decide qué mostrar.

    return { globals: api, _rv2TotalSel, _rv2BilsUsables, _rv2PintarVeredicto, _rv2ActualizarBotonAprobar, _rv2Modal, _rv2FmtMiles, _rv2Veredicto, _rv2Render };
  }
  return Object.freeze({ create, dependencies });
});
/* Portal: withdrawals-execution. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalWithdrawalsExecution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["_drexGlobalLock","_drexGlobalUnlock","_rv2ActualizarBotonAprobar","_rv2BilsUsables","_rv2Finalizar","_rv2Modal","_rv2PintarVeredicto","_rv2Render","_rv2TotalSel","_trazaFin","_trazaInit","_trazaPaso","_wdLock","_wdUnlock","ajustarSaldoBilletera","alert","callDrex","cargarHistorial","cargarSolicitudesPortal","cerrarExpedienteSolicitud","cerrarPortalJobModal","cerrarRetiroV2","confirm","document","ensureDrexSession","escapeHtml","fetch","localStorage","money","notificarUsuarioEnChat","pcOperativa","registrarEnHistorial","registrarRetiroEnChunior","renderBillerasInicio","setTimeout","sincronizarBilleterasChunior","supabaseClient","toast","window"]);
  function create(deps){
const api = {};
async function notificarRetiroParcialPortal(solicitudId, montoPago, pagadoAcum, restante, montoTotal, saldoPost, desde){
  deps.window.NodoSalud?.begin('RETIROS')?.record('EFFECT','OK','RETIRO_PARCIAL_NOTIFY');
  if(!deps.window.panelAPI || !deps.window.panelAPI.rpc || !solicitudId) return { ok:false, detail:'sin panelAPI/id' };
  const op = (deps.window.operador && (deps.window.operador.usuario||deps.window.operador.nombre)) || 'panel';
  const sid = Number(solicitudId);
  const formas = [
    // Firma REAL (verificada contra Supabase y usada por el camino original del panel):
    //   landing_retiro_registrar_parcial(p_id, p_monto_parcial, p_operador)
    // Las A/B/C eran conjeturas y NINGUNA coincidía → el parcial se pagaba pero nunca se
    // registraba el progreso. Va primera.
    // Con DESDE qué billetera salió (D-90): el portal le dice al jugador "te transfirió X". Si la
    // base no conociera p_desde devuelve error de firma y se prueba la de abajo, sin él: el pago
    // nunca queda sin registrar por el orden en que se publica cada cosa.
    { k:'ND', p:{ p_id:sid, p_monto_parcial:Number(montoPago)||0, p_operador:op,
                  p_saldo_post:(saldoPost!=null?Number(saldoPost):null), p_desde:(String(desde||'').trim()||null) } },
    { k:'N', p:{ p_id:sid, p_monto_parcial:Number(montoPago)||0, p_operador:op,
                 p_saldo_post:(saldoPost!=null?Number(saldoPost):null) } },
    { k:'A', p:{ p_solicitud_id:sid, p_monto_pagado:Number(pagadoAcum)||0, p_monto_restante:Number(restante)||0, p_monto_total:Number(montoTotal)||0, p_operador:op } },
    { k:'B', p:{ p_solicitud_id:sid, p_monto:Number(montoPago)||0, p_operador:op } },
    { k:'C', p:{ p_solicitud_id:sid, p_monto:Number(montoPago)||0 } }
  ];
  // La firma real va siempre primero. Un error de transporte puede llegar después
  // de confirmar el pago en la base: jamás se prueba otra firma en ese caso.
  for(const f of formas){
    let r;
    try{
      r = await deps.window.panelAPI.rpc('landing_retiro_registrar_parcial', f.p);
    }catch(e){
      const detail = String(e.message || e);
      console.warn('[retiro-parcial-portal] resultado incierto; no se reintenta:', detail);
      return { ok:false, uncertain:true, detail };
    }
    if(!r) return { ok:false, uncertain:true, detail:'sin respuesta al registrar el parcial' };
    if(!r.error){
      // Guardar una preferencia local no forma parte de la transacción. Si falla,
      // el pago sigue confirmado y no debe enviarse otra vez.
      try{ deps.localStorage.setItem('nodo_rpc_parcial_shape', f.k); }catch(_e){}
      // Se devuelve lo que contestó la base: con eso el que llama comprueba que el pago ENTRÓ.
      return { ok:true, detail:'forma '+f.k, data:(r && r.data) || null };
    }
    const msg = String(r.error.message||'');
    const esFirma = /PGRST202|Could not find the function|function .* does not exist/i.test(
      String(r.error.code||'')+' '+msg+' '+String(r.error.details||''));
    if(!esFirma) return { ok:false, detail:msg };
  }
  return { ok:false, detail:'ninguna firma coincidió — mirá el hint en consola y avisá para ajustarla' };
}
api.notificarRetiroParcialPortal = notificarRetiroParcialPortal;

// Las fichas del modal salen de la misma lectura que "Ver" y la tarjeta de la lista: espera al agente
// si está ocupado y deja el resultado donde lo lee el resto del panel. Antes este modal tenía su
// propia copia y fallaba distinto que todo lo demás.
async function _rv2LeerSaldo(){
  const st = deps.withdrawalState.current; if(!st) return;
  const pintar=function(){ try{ deps._rv2PintarVeredicto(); deps._rv2ActualizarBotonAprobar(); }catch(_e){} };
  st.saldoFallo = null; pintar();
  let r = null;
  try{ r = await deps.window.revisarFichasRetiro({ usuario:st.usuario, monto:st.objetivo||st.declarado, forzar:true }); }
  catch(_e){}
  if(deps.withdrawalState.current!==st) return;
  // Sólo se cree un saldo LEÍDO de verdad: un 0 por sesión caída decía "NO TIENE FICHAS" con el
  // jugador teniendo $35.020.
  if(r && r.confiable===true){ st.saldoReal = r.saldo; st.saldoFallo = null; }
  else { st.saldoFallo = (r && r.motivo) || 'ilegible'; }
  pintar();
}
// Botón "Reintentar" del cotejo de fichas. Con la sesión caída, primero se entra de nuevo.
api._rv2ReleerFichas = async function(){
  const st = deps.withdrawalState.current; if(!st) return;
  if(st.saldoFallo==='sesion'){
    let ok = false; try{ ok = await deps.ensureDrexSession(); }catch(_e){}
    if(!ok || deps.withdrawalState.current!==st) return;
  }
  await _rv2LeerSaldo();
};

// APROBAR: valida, extrae las fichas UPFRONT (para que no se las jueguen) y pasa a
// la fase de confirmar cada transferencia.
api._rv2Aprobar = async function(){
  const st = deps.withdrawalState.current; if(!st) return;
  const total = deps._rv2TotalSel();
  const seleccionadas = deps._rv2BilsUsables()
    .filter(function(b){ return st.sel[String(b.ID_BILLETERA)] && Number(st.montos[String(b.ID_BILLETERA)])>0; })
    .map(function(b){ return { id:String(b.ID_BILLETERA), nombre:b.NOMBRE_VISIBLE||'—', titular:String(b.TITULAR||'').trim(), chunior:b.CHUNIOR_UID, saldo:Number(b.SALDO||0), monto:Number(st.montos[String(b.ID_BILLETERA)]||0) }; });
  if(!seleccionadas.length){ deps.toast('Tildá al menos una billetera con monto.','red'); return; }
  if(total<=0){ deps.toast('El total a pagar es 0.','red'); return; }
  // Se compara contra LO QUE FALTA de la deuda (totalReal − yaPagado), igual que el botón. Antes
  // comparaba contra st.objetivo, que es un valor que se lee al abrir el modal y puede venir del
  // metadata podrido: el botón te habilitaba y esta validación te rechazaba con "supera el monto
  // real ($200.000)" cuando en pantalla decía claramente que faltaban $250.000. Y no corta el
  // flujo: pagar de más se pregunta, no se prohíbe — el que sabe cuánto se debe es el operador.
  // Pagar de más ya NO se frena con un confirm: el modal lo avisa en rojo ("te pasaste") y el botón
  // dice cuánto de más. El que sabe cuánto se debe es el operador (Juan, 12/09).
  for(const b of seleccionadas){ if(b.monto > b.saldo+0.5){ deps.toast(b.nombre+' no tiene '+deps.money(b.monto)+' (saldo '+deps.money(b.saldo)+').','red'); return; } }
  // Chequeo de fichas. Si no se pudo leer al abrir el modal, se intenta AHORA — antes se salteaba
  // en silencio (la condición pedía saldoReal!=null) y el retiro salía sin verificar nada.
  if(st.saldoReal==null){
    deps.toast('Leyendo las fichas de '+st.usuario+' antes de pagar…','blue');
    try{ await _rv2LeerSaldo(); }catch(_e){}
    // Se cayó la sesión (PCs con poca actividad): se abre el login y, al entrar, se vuelve a leer
    // y se sigue. Antes decía "reabrí el retiro" y había que arrancar todo de nuevo.
    if(st.saldoReal==null && st.saldoFallo==='sesion'){
      deps.toast('Se cayó la sesión de Agentes · entrá y sigo con el retiro','yellow');
      let _okSes = false; try{ _okSes = await deps.ensureDrexSession(); }catch(_e){}
      if(!_okSes || deps.withdrawalState.current!==st) return;
      try{ await _rv2LeerSaldo(); }catch(_e){}
    }
  }
  if(st.saldoReal==null){
    if(!deps.confirm('No se pudieron leer las fichas de '+st.usuario+'.\n\nSi seguís, el retiro sale A CIEGAS: no sabemos si tiene el saldo.\n\n¿Continuar igual?')) return;
  } else if(total > Math.floor(Number(st.saldoReal) + 1e-9) + 0.001){
    // Contra las fichas ENTERAS: Agentes no retira centavos.
    if(!deps.confirm('El usuario tiene '+deps.money(st.saldoReal)+' de fichas (como mucho se le pueden sacar '+deps.money(Math.floor(Number(st.saldoReal)+1e-9))+') y vas a retirar '+deps.money(total)+'. ¿Seguir igual?')) return;
  }
  st.obs = (deps.document.getElementById('rv2Obs')?deps.document.getElementById('rv2Obs').value:'').trim();
  st.pagar = seleccionadas; st.totalPagar = total;

  // El botón ya dice "Pagar $X ahora · quedan $Y": esa ES la confirmación. Antes había además un
  // tilde "confirmo retiro parcial" que sólo repetía lo que el operador acababa de armar a mano.
  const esParcial = total < st.objetivo - 0.5;
  // En modo parcial explícito no se pide confirmar que es parcial: ya se eligió ese camino.
  if(esParcial && !st.parcialAceptado && !st.modoParcial){
    deps.toast('Tildá "Confirmo retiro PARCIAL" para continuar (o completá el monto).','yellow');
    try{ const t=deps.document.getElementById('rv2Total'); if(t){ t.style.outline='2px solid #f5c518'; deps.setTimeout(function(){ t.style.outline=''; },1500); t.scrollIntoView({block:'center'}); } }catch(_e){}
    return;
  }
  // (Acá había un confirm "el retiro queda COMPLETO, no parcial" que frenaba el pago del resto de un
  //  parcial — la única forma de cerrarlo. Queda el aviso visible del modal; el operador decide.)
  const confirmarCada = !!(deps.document.getElementById('rv2ConfCada') && deps.document.getElementById('rv2ConfCada').checked);
  // Un pago a la vez: el modal queda abierto mientras se busca al usuario y un segundo clic pagaba dos veces.
  if(st._pagando) return;

  // 1) ANTES de cerrar el modal: candado, sesión y búsqueda. Si algo de esto falla no se movió
  //    plata y el modal queda como estaba para reintentar. Antes se cerraba primero, y cualquier
  //    falla (sesión caída, otra operación en curso) dejaba al operador sin nada: "el retiro
  //    parcial no continúa" (Juan, 12/09).
  if(!deps._drexGlobalLock('rv2-retiro')){ deps.toast('Hay otra operación en curso. Esperá y tocá Pagar de nuevo.','yellow'); return; }
  st._pagando = true;
  const _btn = deps.document.getElementById('rv2BtnAprobar');
  const _btnTxt = _btn ? _btn.textContent : '';
  if(_btn){ _btn.disabled = true; _btn.textContent = 'Buscando a '+st.usuario+' en Agentes…'; }
  deps._wdLock();
  deps._trazaInit('Retiro '+(esParcial?'PARCIAL':'')+' · '+st.usuario+' · '+deps.money(total)+(st.id?(' (sol. #'+st.id+')'):''));
  let fichasOk=false, _cerrado=false;
  try{
    deps._trazaPaso('Abriendo sesión de Agentes...');
    if(!await deps.ensureDrexSession()){
      deps.toast('Sesión de Agentes requerida · no se sacó nada','red');
      deps._trazaPaso('Falta sesión de Agentes','err');
      deps._trazaFin('err');
      return;
    }
    deps._trazaPaso('Sesión de Agentes lista','ok');

    deps._trazaPaso('Buscando '+st.usuario+' en Agentes...');
    let bb = await deps.callDrex('buscarUsuario', st.usuario, { skipBalance:true });
    // Se cayó en el medio: login y se reintenta UNA vez. Todavía no se sacó nada, es seguro.
    if(bb && bb.needsLogin){
      deps._trazaPaso('Se cayó la sesión de Agentes · pidiendo login','warn');
      deps.toast('Se cayó la sesión de Agentes · entrá y sigo con el retiro','yellow');
      let _okSes = false; try{ _okSes = await deps.ensureDrexSession(); }catch(_e){}
      if(_okSes && deps.withdrawalState.current===st) bb = await deps.callDrex('buscarUsuario', st.usuario, { skipBalance:true });
    }
    if(bb && (bb.needsLogin || bb.pageError)){
      const _mot = bb.needsLogin ? 'Se cayó la sesión de Agentes' : 'Agentes devolvió una página de error';
      deps.toast(_mot+' · no se sacó nada. Entrá de nuevo y tocá Pagar.','red');
      deps._trazaPaso(_mot+' · no se operó','err');
      deps._trazaFin('err');
      return;
    }
    if(!bb || !bb.exists){
      deps.toast('Usuario '+st.usuario+' no encontrado en Agentes · no se sacó nada.','red');
      deps._trazaPaso(st.usuario+' no existe en Agentes','err');
      deps._trazaFin('err');
      return;
    }
    // Cerrar el modal mientras se buscaba es la forma de frenar: no se paga.
    if(deps.withdrawalState.current !== st){
      deps.toast('Cancelaste el retiro · no se sacó nada','yellow');
      deps._trazaPaso('Cancelado por el operador antes de retirar','warn');
      deps._trazaFin('err');
      return;
    }
    deps._trazaPaso(st.usuario+' encontrado'+(bb.balance?.raw?(' · saldo '+bb.balance.raw.trim()):''), 'ok');

    // 2) Punto sin vuelta: recién ahora se cierra el modal y se retira.
    _cerrado = true;
    if(!confirmarCada){
      deps.cerrarRetiroV2();
      try{ if(typeof deps.cerrarExpedienteSolicitud === 'function') deps.cerrarExpedienteSolicitud(); else if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
      try{ if(typeof deps.cerrarPortalJobModal === 'function') deps.cerrarPortalJobModal(); else if(deps.window.cerrarPortalJobModal) deps.window.cerrarPortalJobModal(); }catch(_e){}
    }
    deps.toast('Portal: retirando '+deps.money(total)+'...', 'blue');
    deps._trazaPaso('Retirando '+deps.money(total)+' en Agentes...');
    const rr = await deps.callDrex('retirarSaldo', total);
    if(!(rr && rr.ok!==false)){
      deps.toast('No se pudo extraer las fichas: '+((rr&&rr.message)||'error')+' — no se transfirió nada.','red');
      deps._trazaPaso('Falló extracción: '+((rr&&rr.message)||'error'),'err');
      deps._trazaFin('err');
      // Un ok:false del preload es SIEMPRE antes de tocar Aplicar (saldo insuficiente, sesión, campo
      // de monto): no se movió plata, así que el modal vuelve tal cual para corregir y reintentar.
      if(rr && rr.ok === false){
        _cerrado = false;
        deps.withdrawalState.current = st;
        try{ deps._rv2Render(); }catch(_e){}
      }
      return;
    }
    // El casino RECHAZÓ el retiro: apareció el modal y NO dijo "Operación correcta"
    // (bet300 lo manda escrito: "RETIRO RECHAZADO por BET300"). Las fichas NO salieron de la
    // cuenta del jugador, así que no hay NADA que transferirle.
    //
    // Hasta acá se miraba sólo `ok`, que es "la automatización corrió y contestó" — y es true
    // igual cuando el casino dice que no. Con un rechazo se seguía de largo: se transfería la
    // plata, se descontaba la billetera, se anotaba el historial en OK y se marcaba PAGADA.
    //
    // El criterio es el mismo que ya usan las operaciones manuales y los lotes:
    // exito === false es rechazo CLARO; null (no se vio el modal) se confía, como allá.
    const _rechazoCasino = rr && rr.exito === false;
    if(_rechazoCasino){
      deps.toast('El casino RECHAZÓ el retiro — no se transfirió nada.','red');
      deps._trazaPaso('Agentes RECHAZÓ el retiro (no dijo "Operación correcta") · '
        + ((rr&&rr.resultado)||(rr&&rr.message)||'sin detalle'), 'err');
      deps._trazaFin('err');
      try{ deps.alert('⛔ El casino RECHAZÓ el retiro de '+deps.money(total)+'.\n\n'
        + ((rr&&rr.resultado)||(rr&&rr.message)||'') + '\n\n'
        + 'Las fichas NO salieron de la cuenta del jugador y NO se transfirió nada.\n'
        + 'Revisá en Agentes y volvé a intentar.'); }catch(_e){}
      // No se movió plata: el modal vuelve tal cual para corregir y reintentar, igual que un ok:false.
      _cerrado = false;
      deps.withdrawalState.current = st;
      try{ deps._rv2Render(); }catch(_e){}
      return;
    }
    st.saldoPost = (typeof rr?.newBalance?.value==='number' && !rr?.newBalance?.unchanged) ? rr.newBalance.value : null;
    fichasOk=true;
    deps._trazaPaso('Retiro aplicado en Agentes'+(st.saldoPost!=null?(' · saldo '+deps.money(st.saldoPost)):''), 'ok');
    deps.toast('Retiro '+(esParcial?'parcial ':'')+'OK: '+st.usuario+' · '+deps.money(total), 'green');
  }catch(e){
    deps.toast('Error en retiro: '+(e.message||''),'red');
    deps._trazaPaso('Error: '+(e.message||String(e)),'err');
    deps._trazaFin('err');
  }finally{
    deps._wdUnlock();
    deps._drexGlobalUnlock();
    st._pagando = false;
    // Si el modal sigue abierto (no se llegó a mover plata), el botón vuelve para reintentar.
    if(!_cerrado && _btn){ _btn.disabled = false; _btn.textContent = _btnTxt; }
  }
  if(!fichasOk) return;

  // 2) Registrar las transferencias
  if(confirmarCada){ st.fase='confirmar'; _rv2RenderConfirmar(); return; } // fase de confirmar una x una
  // RÁPIDO (default): debita cada billetera + registra su retiro en Chunior con notificación y traza, y finaliza.
  st.chuMovs = st.chuMovs || [];
  for(const b of st.pagar){
    if(b.chunior){
      deps._trazaPaso('Registrando en Chunior ('+b.nombre+' · '+deps.money(b.monto)+')...');
      try{
        const _rc = await deps.registrarRetiroEnChunior(b.chunior, b.monto, st.usuario);
        if(_rc && _rc.ok && _rc.movimientoId){
          st.chuMovs.push(String(_rc.movimientoId));
          deps.toast('📋 Retiro Chunior N° '+_rc.movimientoId+' ('+b.nombre+')', 'blue');
          deps._trazaPaso('Registrado en Chunior (N° '+_rc.movimientoId+' · '+b.nombre+')', 'ok');
        } else if(_rc && _rc.ok && !_rc.movimientoId){
          deps.toast('📋 Retiro anotado en Chunior ('+b.nombre+', sin N° confirmado)', 'blue');
          deps._trazaPaso('Anotado en Chunior ('+b.nombre+')', 'ok');
        } else if(_rc && _rc.error){
          deps.toast('⚠️ Retiro OK pero falló Chunior ('+b.nombre+'): '+_rc.error, 'red');
          deps._trazaPaso('Falló Chunior ('+b.nombre+'): '+_rc.error, 'warn');
          try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_rc.error }); }catch(_e){}
        }
      }catch(_e){
        console.warn('[rv2] chunior', _e);
        deps.toast('⚠️ Error Chunior ('+b.nombre+'): '+(_e.message||''), 'red');
        deps._trazaPaso('Error Chunior ('+b.nombre+')', 'warn');
        try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_e.message||'excepción' }); }catch(_e2){}
      }
    }
    try{ await deps.ajustarSaldoBilletera(b.id, -b.monto); }catch(_e){}
    st.hechas[b.id]=true;
    try{ deps._trazaPaso('Billetera '+b.nombre+' debitada ('+deps.money(b.monto)+')', 'ok'); }catch(_e){}
  }
  // Sin try/catch, una excepción acá se perdía en un unhandled rejection: la plata YA salió,
  // el modal quedaba congelado en el último paso de la traza y no se registraba nada — ni en
  // historial_ops ni en la solicitud. Pasó con un parcial de $500.000 (sol. #198680).
  try{
    // CON el estado: el modal ya se cerró arriba (cerrarRetiroV2) y el global está en null.
    await deps._rv2Finalizar(st);
  }catch(e){
    const _d = (e && e.message) || String(e);
    try{ deps._trazaPaso('FALLÓ EL CIERRE: '+_d, 'err'); }catch(_e){}
    try{ deps.toast('⚠ Se pagó pero NO se cerró la solicitud · anotalo', 'red'); }catch(_e){}
    try{ deps.alert('⚠️ El retiro SE PAGÓ pero falló el cierre.\n\n' + _d
      + '\n\nLa plata ya salió y la solicitud quedó con el estado anterior.'
      + '\nAnotalo y cerralo desde 💸 En proceso.'); }catch(_e){}
  }
};

function _rv2RenderConfirmar(){
  const st = deps.withdrawalState.current; if(!st) return;
  const el = deps._rv2Modal();
  const filas = st.pagar.map(function(b){
    const done = st.hechas[b.id]===true; const proc = st.hechas[b.id]==='procesando';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;background:'+(done?'#12261a':'#161b22')+';border:1px solid '+(done?'rgba(34,197,94,.4)':'#30363d')+';margin-top:7px">'
      + '<div style="flex:1"><div style="font-weight:800;color:#f0f6fc">💳 '+deps.escapeHtml(b.nombre)+' → '+deps.money(b.monto)+'</div>'
      +   '<div class="small" style="color:#8b949e">'+(done?'✓ transferido y registrado':(proc?'registrando…':'Hacé la transferencia real y tocá Listo'))+'</div></div>'
      + (done?'<span style="color:#22c55e;font-weight:800">✓</span>':(proc?'<span class="small" style="color:#8b949e">…</span>':'<button class="mini-btn green" style="font-size:11px" onclick="_rv2Confirmar(\''+b.id+'\')">✅ Transferí, listo</button>'))
      + '</div>';
  }).join('');
  const faltan = st.pagar.filter(function(b){ return st.hechas[b.id]!==true; }).length;
  el.innerHTML =
    '<div style="max-height:82vh;overflow:auto;background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.55);padding:16px;color:#e6edf3">'
    + '<div style="font-size:17px;font-weight:900;color:#fb923c;margin-bottom:4px">⬆ Confirmá las transferencias</div>'
    + '<div class="small" style="color:#8b949e;margin-bottom:8px">Las fichas ('+deps.money(st.totalPagar)+') YA se extrajeron. Transferí desde cada billetera al CBU <b>'+deps.escapeHtml(st.cbu||'—')+'</b> y confirmá cada una.</div>'
    + filas
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    // Con todas confirmadas el cierre ya salió solo (ver _rv2Confirmar). El botón queda como
    // reintento manual por si ese cierre automático falló, no como paso obligatorio.
    +   (faltan===0
         ? '<button class="mini-btn green" style="font-weight:800" onclick="this.disabled=true;_rv2Finalizar()">Cerrar el retiro</button>'
         : '<span class="small" style="color:#8b949e;align-self:center">Faltan '+faltan+' transferencia(s)</span>')
    + '</div></div>';
  el.style.display='block';
}

// Confirma UNA transferencia: registra el retiro en Chunior por esa billetera y la debita.
api._rv2Confirmar = async function(bid){
  const st = deps.withdrawalState.current; if(!st) return;
  bid = String(bid);
  const b = st.pagar.find(function(x){ return x.id===bid; });
  if(!b || st.hechas[bid]===true || st.hechas[bid]==='procesando') return;
  st.hechas[bid]='procesando'; _rv2RenderConfirmar();
  try{
    st.chuMovs = st.chuMovs || [];
    if(b.chunior){
      try{
        const _rc = await deps.registrarRetiroEnChunior(b.chunior, b.monto, st.usuario);
        if(_rc && _rc.ok && _rc.movimientoId){
          st.chuMovs.push(String(_rc.movimientoId));
          deps.toast('📋 Retiro Chunior N° '+_rc.movimientoId+' ('+b.nombre+')', 'blue');
          deps._trazaPaso('Registrado en Chunior (N° '+_rc.movimientoId+' · '+b.nombre+')', 'ok');
        } else if(_rc && _rc.ok && !_rc.movimientoId){
          deps.toast('📋 Retiro anotado en Chunior ('+b.nombre+', sin N° confirmado)', 'blue');
          deps._trazaPaso('Anotado en Chunior ('+b.nombre+')', 'ok');
        } else if(_rc && _rc.error){
          deps.toast('⚠️ Falló Chunior ('+b.nombre+'): '+_rc.error, 'red');
          deps._trazaPaso('Falló Chunior ('+b.nombre+'): '+_rc.error, 'warn');
          try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_rc.error }); }catch(_e){}
        }
      }catch(_e){
        console.warn('[rv2] chunior', _e);
        deps.toast('⚠️ Error Chunior ('+b.nombre+'): '+(_e.message||''), 'red');
        deps._trazaPaso('Error Chunior ('+b.nombre+')', 'warn');
        try{ if(deps.window.chuniorPendienteAdd) deps.window.chuniorPendienteAdd({ tipo:'RETIRO', uid:b.chunior, monto:b.monto, usuario:st.usuario, histId:null, motivo:_e.message||'excepción' }); }catch(_e2){}
      }
    }
    try{ await deps.ajustarSaldoBilletera(b.id, -b.monto); }catch(_e){}
    st.hechas[bid]=true;
    try{ deps._trazaPaso('Transferido '+b.nombre+' · '+deps.money(b.monto),'ok'); }catch(_e){}
    deps.toast('✓ '+b.nombre+': '+deps.money(b.monto),'green');
  }catch(e){ st.hechas[bid]=false; deps.toast('Error en '+b.nombre+': '+(e.message||''),'red'); }
  _rv2RenderConfirmar();
  // CIERRE AUTOMÁTICO. Con la última billetera confirmada ya está TODO hecho: las fichas salieron,
  // los movimientos están anotados en Chunior y la plata se transfirió. Lo único que faltaba era
  // apretar "Finalizar retiro", que no decide nada — sólo registra. Y si el operador cerraba el
  // modal ahí (o se le colgaba la ventana), la plata YA se había movido pero no quedaba ni la fila
  // en el historial ni la solicitud actualizada: el retiro existía en Chunior y en ningún lado más.
  // Pasó de verdad con un parcial. Ahora cierra solo.
  if(st.pagar.every(function(x){ return st.hechas[x.id]===true; })){
    try{ await deps._rv2Finalizar(st); }catch(e){
      try{ deps.toast('⚠ Se transfirió todo pero falló el cierre: '+(e.message||'')+' — revisá el historial','red'); }catch(_e){}
    }
  }
};

// Finaliza: marca la solicitud (parcial/completa), avisa al usuario y registra el historial.
// Candado de reentrada. El botón "Cerrar el retiro" no tenía ninguno: cada clic escribía una
// fila en historial_ops y volvía a notificar al usuario. En la solicitud 84401 quedaron ONCE
// filas de $500.000 en 20 segundos —con intervalos de hasta 1 ms, imposibles para una persona—
// todas SIN número de Chunior: la transferencia fue una sola, el registro se disparó once
// veces. Si además cada clic ajustó el saldo de la billetera, ese saldo quedó mal (D-64).
let _rv2Cerrando = false;
const _rv2FinalizarInterno = async function(stCapturado){
  // El cierre automático le pasa el estado que ya tenía; el botón manual no pasa nada y usa el global.
  const st = (stCapturado && typeof stCapturado === 'object' && stCapturado.id != null)
    ? stCapturado : deps.withdrawalState.current;
  // Este return existía y era silencioso. Se llega acá DESPUÉS de haber extraído las fichas y
  // debitado la billetera: irse sin hacer nada y sin decir nada deja la plata afuera y la
  // solicitud intacta, que es como quedó el parcial de $500.000 (sol. #198680).
  if(!st){
    try{ deps._trazaPaso('Se perdió el estado del retiro antes de cerrarlo', 'err'); }catch(_e){}
    try{ deps.alert('⚠️ Se perdió el estado del retiro justo antes de cerrarlo.\n\n'
      + 'Si ya transferiste, la plata salió y la solicitud NO se actualizó.'
      + '\nRevisá el historial y cerrala desde 💸 En proceso.'); }catch(_e){}
    return;
  }
  try{ deps._trazaPaso('Cerrando la solicitud...'); }catch(_e){}
  const total = st.totalPagar;
  // Total REAL del retiro (la deuda). En modo parcial NO puede salir del objetivo: ahí el objetivo
  // es "lo que falta", y tomarlo como total cerraba el retiro con la mitad pagada.
  // En modo parcial manda st.totalReal (la deuda, editable arriba). El objetivo es "lo que falta",
  // tomarlo como total cerraba el retiro con una parte pagada.
  const montoTotal = st.modoParcial
    ? (Number(st.totalReal) || st._metaTotal || st.declarado || st.objetivo)
    : (st._metaTotal!=null ? st._metaTotal : st.objetivo);
  const pagadoAcum = (st.yaPagado||0) + total;
  const restante = Math.max(0, montoTotal - pagadoAcum);
  // Si al usuario no le quedan fichas, el retiro está terminado aunque no se haya llegado
  // al monto pedido: esa plata no existe. Antes quedaba EN_PROCESO para siempre y había
  // que cerrarlo a mano (meli1804 pidió 28.000, tenía 26.002, quedó con 0,48 de saldo).
  const _sinFichas = (st.saldoPost != null && Number(st.saldoPost) < 1);
  const completo = (restante <= 0.5) || _sinFichas;
  const listaBil = st.pagar.map(function(b){ return b.nombre+' '+deps.money(b.monto); }).join(' + ');
  // N° de movimiento de Chunior: el historial marca "⚠ Falta Chunior" cuando esta columna está
  // vacía. Se anotaba bien pero el número se descartaba. Con varias billeteras va el primero y
  // los demás quedan en las notas (la columna guarda uno solo).
  const _chuMovs = (st.chuMovs||[]).filter(Boolean);
  const _notaChu = _chuMovs.length>1 ? (' · Chunior: '+_chuMovs.join(' + ')) : '';
  let filaHist = null;
  try{
    filaHist = await deps.registrarEnHistorial({
      usuario:st.usuario, tipo:'RETIRO', monto:total,
      billetera_id: st.pagar[0]?st.pagar[0].id:null, billetera_nombre: listaBil,
      origen:'LANDING', estado:'OK',
      notas:'Retiro'+(completo?'':' PARCIAL')+' · pagado '+deps.money(total)+' desde: '+listaBil+(completo?'':(' · restan '+deps.money(restante)))+(st.obs?(' · Obs: '+st.obs):'')+_notaChu,
      // saldo_pre: las fichas que tenía ANTES de retirar (st.saldoReal, leído al abrir el modal).
      // Sin esto la columna "Saldo pre" del historial salía vacía en todos los parciales.
      saldo_pre: (st.saldoReal!=null ? st.saldoReal : null),
      saldo_post: st.saldoPost, solicitud_id: st.id,
      chunior_movimiento_id: _chuMovs[0] || null
    });
  }catch(_e){
    // Sin fila en historial_ops la operación no existe para el cotejo, para la regla de 24 h
    // ni para el jugador. Callarlo es perder el rastro de plata que ya salió.
    try{ deps._trazaPaso('No se pudo registrar en el historial: '+((_e&&_e.message)||_e), 'err'); }catch(_x){}
    try{ deps.toast('⚠ El retiro se pagó pero NO quedó en el historial · anotalo','red'); }catch(_x){}
  }
  // El titular y el CBU del retiro son el dato más fuerte que tenemos de esa persona:
  // vienen del banco. Hasta ahora quedaban sepultados en las notas y había que rescatarlos
  // con un backfill. Se guardan en el vínculo para que estén a mano en la ficha.
  // Va en try/catch y sin await bloqueante: si falla, el retiro NO se ve afectado.
  try{
    const _titRet = String(st.titular||'').trim();
    const _cbuRet = String(st.destino||st.cbu||'').replace(/\D/g,'');
    if(_titRet || _cbuRet.length >= 18){
      deps.supabaseClient.rpc('panel_guardar_datos_retiro',{
        p_secret: deps.window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof deps.pcOperativa!=='undefined'?deps.pcOperativa:'')||deps.window.pcOperativa||'',
        p_usuario: st.usuario, p_titular: _titRet||null, p_cbu: _cbuRet||null
      }).catch(function(){});
    }
  }catch(_e){}
  // Un parcial va a EN_PROCESO, NO a EN_REVISION: son bandejas distintas (EN_REVISION es "algo
  // falló / revisar") y además el portal muestra "💸 Te estamos pagando por partes" SOLO con
  // EN_PROCESO — con EN_REVISION el usuario veía "⏳ En verificación" y sin barra de progreso.
  const _estadoFinal = completo ? 'PAGADA' : 'EN_PROCESO';

  // ORDEN IMPORTANTE: primero la RPC, después el estado.
  // metadata.retiro_parcial la escribe SOLO landing_retiro_registrar_parcial, que ACUMULA sobre lo
  // que ya haya. Cuando el panel también la escribía, el pago se contaba DOS veces (pagabas 250k de
  // 500k y quedaba pagado=500k → la RPC lo daba por completo y cerraba el retiro con la mitad).
  // El panel solo la escribe como respaldo si la RPC no pudo registrar.
  let _rp = null;
  // También hay que registrar el pago que CIERRA el retiro. Con `if(!completo)` el último pago no
  // se anotaba: retiro_parcial se quedaba en el valor anterior (350.000 de 450.000) mientras
  // monto_pagado sí llegaba a 450.000 → los dos registros discrepaban y los 100.000 finales
  // figuraban como no pagos aunque estuvieran abonados.
  const _hayProgreso = (Number(st.yaPagado)||0) > 0;
  // El TITULAR de la billetera: es el nombre que el jugador ve en su cuenta cuando le llega la plata.
  // Va ACÁ AFUERA, no adentro del if: el respaldo de más abajo también lo usa, y declarado adentro
  // no existe allá. Cuando la RPC de progreso fallaba y entraba el respaldo, reventaba con
  // "_desde is not defined", lo agarraba el catch de la actualización y la solicitud NUNCA se
  // actualizaba: el jugador ya tenía la plata y el retiro quedaba con el estado viejo. Falla sobre
  // falla, justo en el camino que ya estaba degradado.
  const _desde = (st.pagar||[]).map(function(b){ return String(b.titular || b.nombre || '').trim(); })
    .filter(function(v, i, a){ return v && a.indexOf(v) === i; }).join(' + ');
  if(!completo || _hayProgreso){
    try{ _rp = await notificarRetiroParcialPortal(st.id, total, pagadoAcum, restante, montoTotal, st.saldoPost, _desde); }
    catch(e){ _rp = { ok:false, detail:(e&&e.message)||String(e) }; }
    // ¿El progreso AVANZÓ de verdad? La base devuelve cuánto quedó pagado. Si contesta bien pero el
    // acumulado no se movió, el pago no entró y el retiro queda colgado en la caja pidiendo un monto
    // que ya se pagó (D-100). Se trata como fallo para que entre el respaldo de abajo.
    const _pagRpc = Number((( _rp && _rp.data) || {}).pagado);
    if(_rp && _rp.ok && Number.isFinite(_pagRpc) && _pagRpc < pagadoAcum - 0.5){
      _rp = { ok:false, detail:'la base quedó en '+deps.money(_pagRpc)+' y este pago de '+deps.money(total)+' no entró' };
    }
    if(!_rp || !_rp.ok){
      try{ deps.toast('⚠ Parcial PAGADO pero sin registrar el progreso · revisalo','red'); }catch(_e){}
      try{ deps.alert('⚠️ El retiro parcial SÍ se pagó ('+deps.money(total)+'), pero NO se pudo registrar el progreso.\n\n'
        + ((_rp&&_rp.detail)||'') + '\n\nEl usuario no va a ver el descuento hasta que se registre. Anotalo a mano.'); }catch(_e){}
    }
  }
  // Monto ajustado: el total quedó distinto de lo que PIDIÓ el jugador. Va la corrección con su
  // MOTIVO, que el portal le muestra debajo del progreso y se le avisa una vez por chat (D-88).
  const _decOrig = Number(st.declaradoOriginal || st.declarado || 0);
  const _ajustado = _decOrig > 0 && Math.abs(Number(montoTotal||0) - _decOrig) > 0.5;
  const _motivoAjuste = _ajustado
    ? (String(st.motivoAjuste||'').trim() || ('Pediste '+deps.money(_decOrig)+' y el retiro quedó en '+deps.money(montoTotal)+'.'))
    : '';
  try{
    const _extra = {
      etapa: completo?'RETIRO_V2_COMPLETO':'RETIRO_V2_PARCIAL',
      parcial:!completo, monto_pagado:pagadoAcum, monto_restante:restante, monto_total:montoTotal,
      operador:(deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel'
    };
    if(_ajustado){
      _extra.monto_corregido = montoTotal;
      _extra.monto_declarado_original = _decOrig;
      _extra.motivo_ajuste = _motivoAjuste;
    }
    // Respaldo SOLO si la RPC falló: si no, duplicaríamos el progreso.
    if((!completo || _hayProgreso) && (!_rp || !_rp.ok)){
      // CONSERVANDO los pagos ya anotados: el respaldo los pisaba y se perdía el detalle de lo cobrado.
      let _rpPrev = {};
      try{
        const _sol = ((deps.window.V154P && deps.V154P.solicitudes) || []).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(st.id); });
        let _mPrev = (_sol && (_sol.METADATA!==undefined ? _sol.METADATA : _sol.metadata)) || {};
        if(typeof _mPrev==='string'){ try{ _mPrev = JSON.parse(_mPrev); }catch(_e){ _mPrev = {}; } }
        _rpPrev = (_mPrev && _mPrev.retiro_parcial) || {};
      }catch(_e){}
      const _pagosPrev = Array.isArray(_rpPrev.pagos) ? _rpPrev.pagos.slice() : [];
      _pagosPrev.push({ monto: total, fecha: new Date().toISOString(),
        operador: (deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel',
        desde: _desde || null, respaldo_panel: true });
      _extra.retiro_parcial = Object.assign({}, _rpPrev, { pagado:pagadoAcum, total:montoTotal, restante:restante, pagos:_pagosPrev });
    }
    // Va DESPUÉS de la RPC a propósito: deja el estado correcto aunque la RPC lo haya marcado completo.
    const _ru = await deps.window.actualizarSolicitudPortal(String(st.id), _estadoFinal, _extra);
    // NO silencioso: si esto falla el retiro queda con el estado VIEJO. Un retiro ya saldado que
    // no llega a marcarse PAGADA se queda "en proceso" para siempre y nadie se entera.
    if(!_ru || _ru.error){
      try{ deps.toast('⚠ El retiro se pagó pero la solicitud quedó con el estado anterior','red'); }catch(_e){}
      try{ deps.alert('⚠️ Se pagó '+deps.money(total)+', pero la solicitud NO pasó a '+_estadoFinal+'.\n\n'
        + 'Va a seguir figurando con el estado viejo (por eso a veces un retiro ya saldado queda "en proceso").\n\n'
        + 'Cerralo desde el botón 💸 En proceso cuando puedas.'); }catch(_e){}
    }
  }catch(e){
    try{ deps.toast('⚠ El retiro se pagó pero falló actualizar la solicitud · revisalo','red'); }catch(_e){}
    try{ deps.alert('⚠️ El retiro se pagó ('+deps.money(total)+') pero falló actualizar la solicitud:\n\n'
      + ((e&&e.message)||String(e)) + '\n\nQuedó con el estado anterior — revisalo en 💸 En proceso.'); }catch(_e){}
  }
  try{
    const msg = completo
      ? '✅ Completamos tu retiro. Te transferimos '+deps.money(total)+'. ¡Listo!'
      : '💸 Te transferimos '+deps.money(total)+' de tu retiro · restan '+deps.money(restante)+'. El resto en cuanto se libere otra billetera.';
    // La solicitud ya está en su estado final (PAGADA/EN_PROCESO) → se lo pasamos explícito.
    // El motivo va UNA vez: si ya se le dijo este mismo motivo, no se repite en cada cuota.
    const _avisarAjuste = _ajustado && _motivoAjuste && _motivoAjuste !== String(st._motivoAvisado||'');
    const _pre = _avisarAjuste ? ('📝 Ajustamos tu retiro a '+deps.money(montoTotal)+'. '+_motivoAjuste+'\n') : '';
    // Al chat VIVO del portal (D-99): antes iba a la generación de chat que el portal ya no lee, o
    // sea a ningún lado. Si no tiene conversación abierta no se le abre una por cada pago: para ese
    // caso ya sale el push de acá abajo.
    const _txtAviso = _pre+(st.obs?st.obs+'\n':'')+msg;
    if(typeof deps.window.avisarJugadorEnChat === 'function') await deps.window.avisarJugadorEnChat(st.usuario, _txtAviso);
    else await deps.notificarUsuarioEnChat(st.usuario, _txtAviso, st.id, _estadoFinal);
  }catch(_e){}
  // Canal EXTRA: push directo con título/cuerpo claros del parcial (no depende del chat_thread).
  try{ notificarRetiroParcialPush(st.usuario, total, pagadoAcum, montoTotal, completo); }catch(_e){}
  try{ deps._trazaFin('ok', filaHist?.id); }catch(_e){}
  deps.toast(completo?('✅ Retiro completo · '+deps.money(total)):('💸 Parcial '+deps.money(total)+' · restan '+deps.money(restante)), completo?'green':'yellow');
  try{ await deps.sincronizarBilleterasChunior(true); }catch(_e){}
  try{ await deps.cargarHistorial(); }catch(_e){}
  try{ deps.renderBillerasInicio(); }catch(_e){}
  try{ if(typeof deps.cargarSolicitudesPortal==='function') await deps.cargarSolicitudesPortal(true); }catch(_e){}
  deps.cerrarRetiroV2();
  try{ if(typeof deps.cerrarExpedienteSolicitud === 'function') deps.cerrarExpedienteSolicitud(); else if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
  try{ if(typeof deps.cerrarPortalJobModal === 'function') deps.cerrarPortalJobModal(); else if(deps.window.cerrarPortalJobModal) deps.window.cerrarPortalJobModal(); }catch(_e){}
};
api._rv2Finalizar = async function(){
  if(_rv2Cerrando){
    try{ deps.toast('El retiro ya se está cerrando · esperá','yellow'); }catch(_e){}
    return;
  }
  _rv2Cerrando = true;
  try{ return await _rv2FinalizarInterno.apply(this, arguments); }
  finally{ _rv2Cerrando = false; }
};


  // Aviso de retiro parcial al usuario por PUSH (si tiene push suscripto). Reemplaza el chat, que no siempre llega.
  function notificarRetiroParcialPush(usuario, montoParcial, pagado, total, completado){
    if(!usuario || !deps.window.PUSH_API_URL) return;
    const title = completado ? "BET300 · ¡Retiro completado! 🎉" : "BET300 · Pago de tu retiro 💸";
    const body = completado
      ? ("¡Listo! Te pagamos "+deps.money(montoParcial)+". Total: "+deps.money(pagado)+". Revisá tu cuenta.")
      : ("Te transferimos "+deps.money(montoParcial)+". Vas "+deps.money(pagado)+" de "+deps.money(total)+".");
    try{
      deps.fetch(deps.window.PUSH_API_URL,{ method:"POST",
        headers:{"Content-Type":"application/json","x-push-secret":deps.window.PUSH_SECRET||""},
        // tag COMPARTIDO con la notificación local del portal ("¡Retiro procesado!"): al usar el
        // mismo tag el SO las colapsa en UNA sola en vez de mostrar dos avisos del mismo pago.
        // Se mantienen los dos canales porque el push llega aunque el portal esté cerrado.
        body:JSON.stringify({usuario:usuario, title:title, body:body, url:"/", tag:"bet300-retiro"}) }).catch(function(){});
    }catch(_e){}
  }

api.v154pRegistrarParcial = function(id){ return deps.window.abrirModalRetiroV2(id, {modoParcial:true}); };

    return { globals: api, notificarRetiroParcialPortal, _rv2LeerSaldo, notificarRetiroParcialPush, _rv2RenderConfirmar };
  }
  return Object.freeze({ create, dependencies });
});
/* Portal: operation-modal. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalOperationModal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","alert","billeteras","cargarBilleteras","cerrarPortalJobModal","document","ejecutarSolicitudPortalSimple","esc","fecha","getBilleraLanding","money","normalizar","pcAliasesHist","pcOperativa","portalCheckDiferencia","setTimeout","supabaseClient","toast","v154pRegistrarParcial","window"]);
  function create(deps){
const api = {};

  function esc(v){
    if(typeof deps.escapeHtml === 'function') return deps.escapeHtml(v);
    if(typeof deps.window?.escapeHtml === 'function') return deps.window.escapeHtml(v);
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtMoney(v){
    if(typeof deps.money === 'function') return deps.money(v);
    if(typeof deps.window?.money === 'function') return deps.window.money(v);
    return '$' + Math.abs(Number(v || 0)).toLocaleString('es-AR');
  }
  function fmtFecha(v){
    if(typeof deps.fecha === 'function') return deps.fecha(v);
    if(typeof deps.window?.formatFecha === 'function') return deps.window.formatFecha(v);
    return v ? new Date(v).toLocaleString('es-AR') : '—';
  }
  // fmtFecha da "16/7 · 01:34 p. m.". El flujo quiere SOLO la hora: cortar los últimos 8
  // caracteres dejaba "34 p. m." (el minuto suelto). Se saca la hora de verdad.
  function soloHora(v){
    if(!v) return "";
    try{
      return new Date(v).toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit", minute: "2-digit", hour12: false
      });
    }catch(_e){ return String(fmtFecha(v)).trim(); }
  }

  function portalParseMonto(v){
    const raw = String(v ?? '').trim().replace(/\$/g,'').replace(/\s/g,'');
    if(!raw) return 0;
    // Acepta 2000, 2.000, 2,000.50 o 2000,50 sin romper edición.
    let s = raw;
    if(s.includes(',') && s.includes('.')) s = s.replace(/\./g,'').replace(',', '.');
    else if(s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function portalInputVal(id){ return (deps.document.getElementById(id)?.value || '').trim(); }
  function portalSolicitudById(id){
    return deps.V154P.solicitudes.find(x => Number(x.ID || x.SOLICITUD_ID) === Number(id));
  }
  function portalBilleteraPreferida(s){
    const id = s?.ID_BILLETERA || s?.BILLETERA_ID || '';
    let b = id ? (deps.billeteras || []).find(x => String(x.ID_BILLETERA) === String(id)) : null;
    if(!b && typeof deps.getBilleraLanding === 'function') b = deps.getBilleraLanding();
    if(!b) b = (deps.billeteras || []).find(x => deps.normalizar(x.ACTIVA)==='SI') || (deps.billeteras || [])[0] || null;
    return b;
  }
  function portalEnsureModal(){
    let el = deps.document.getElementById('portalJobModal');
    if(el) return el;
    el = deps.document.createElement('div');
    el.id = 'portalJobModal';
    el.style.cssText = 'display:none;position:fixed;top:82px;left:50%;transform:translateX(-50%);z-index:99999;width:min(420px,calc(100vw - 26px));';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;max-height:68vh;background:#111827;border:1px solid #2b3446;border-radius:18px;box-shadow:0 18px 55px rgba(0,0,0,.45);padding:14px;color:#fff">
        <div style="flex:0 0 auto;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px">
          <div>
            <div style="font-size:17px;font-weight:900">Aprobar portal</div>
            <div id="portalJobSub" class="small" style="color:#94a3b8;margin-top:3px"></div>
          </div>
          <button class="mini-btn" style="background:#374151;padding:7px 10px" type="button" onclick="cerrarPortalJobModal()">Cerrar</button>
        </div>
        <!-- Sólo esta parte scrollea: es la que crece sola cuando llegan el vínculo, el bono y
             las alertas. Lo de abajo (monto, billetera, botones) queda fijo. -->
        <div id="portalJobScroll" style="flex:1 1 auto;overflow-y:auto;overflow-x:hidden;min-height:0">
        <!-- Lo que declaró el usuario (referencia, solo lectura) -->
        <div style="background:#0d1320;border:1px solid #243049;border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:13px">
          <div style="color:#64748b;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin-bottom:7px">Lo que declaró el usuario</div>
          <div id="portalJobRef" style="display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;color:#cbd5e1"></div>
          <div id="portalJobVinculo" style="margin-top:8px;padding-top:8px;border-top:1px solid #243049;font-size:13px"></div>
          <div id="portalJobPromo" style="margin-top:8px"></div>
          <div id="portalJobAlertas" style="margin-top:6px"></div>
          <div id="portalJobFichas" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #243049;font-size:13px"></div>
        </div>

        </div><!-- /portalJobScroll -->

        <!-- Acción del operador -->
        <div style="flex:0 0 auto;display:grid;grid-template-columns:1fr 1fr;gap:11px;align-items:end">
          <div>
            <label style="font-weight:800">Monto a procesar</label>
            <input id="portalJobMontoAprobado" type="text" inputmode="numeric" autocomplete="off" oninput="portalCheckDiferencia()" style="width:100%;height:44px;border-color:#22c55e;font-weight:900;font-size:21px">
          </div>
          <div>
            <label>Billetera destino</label>
            <select id="portalJobBilletera" style="width:100%;height:44px"></select>
          </div>
          <div id="portalJobDiferencia" style="display:none;grid-column:1/-1;background:#3b0d0d;border:1px solid #7f1d1d;color:#fca5a5;border-radius:9px;padding:8px 11px;font-size:12px;font-weight:800"></div>
          <div style="grid-column:1/-1">
            <label>Obs. <span class="small" style="color:#64748b">(opcional)</span></label>
            <textarea id="portalJobObs" rows="2" style="width:100%;resize:vertical" placeholder="Ej: declaró 10.000 pero el comprobante real es 2.000"></textarea>
          </div>
        </div>
        <div id="portalJobResultado" style="flex:0 0 auto;margin-top:9px"></div>
        <div style="flex:0 0 auto;display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
          <button id="portalJobParcialBtn" class="mini-btn" style="background:#7c3aed;display:none" type="button" onclick="portalJobIrParcial()" title="Pagar el retiro por partes / desde varias billeteras">💸 Parcial</button>
          <button class="mini-btn" style="background:#374151" type="button" onclick="cerrarPortalJobModal()">Cancelar</button>
          <button id="portalJobEnviarBtn" class="mini-btn green" type="button" onclick="confirmarPortalJobModal()">Aprobar</button>
        </div>
      </div>`;
    deps.document.body.appendChild(el);
    return el;
  }
  function portalPoblarBilleteras(sel, s){
    if(!sel) return;
    const pref = portalBilleteraPreferida(s);
    const opts = (deps.billeteras || []).map(b => {
      const selected = pref && String(pref.ID_BILLETERA) === String(b.ID_BILLETERA) ? ' selected' : '';
      const nombre = deps.esc(b.NOMBRE_VISIBLE || b.ID_BILLETERA || 'Billetera');
      return `<option value="${deps.esc(b.ID_BILLETERA)}"${selected}>${nombre} — ${deps.money(b.SALDO||0)}</option>`;
    }).join('');
    sel.innerHTML = opts || '<option value="">Sin billeteras disponibles</option>';
  }
  api.cerrarPortalJobModal = function(){
    const el = deps.document.getElementById('portalJobModal');
    if(el) el.style.display = 'none';
  };
  api.portalCheckDiferencia = function(){
    const modal = deps.document.getElementById('portalJobModal');
    const inp = deps.document.getElementById('portalJobMontoAprobado');
    const box = deps.document.getElementById('portalJobDiferencia');
    if(!modal || !inp || !box) return;
    const declarado = Math.abs(portalParseMonto(modal.dataset.montoDeclarado || '0'));
    const actual = Math.abs(portalParseMonto(inp.value || '0'));
    if(actual && declarado && actual !== declarado){
      box.style.display = 'block';
      box.textContent = '⚠ Distinto de lo declarado (' + deps.money(declarado) + ' → ' + deps.money(actual) + '). Anotá el motivo en Obs.';
      inp.style.borderColor = '#ef4444';
    } else {
      box.style.display = 'none';
      inp.style.borderColor = '#22c55e';
    }
    // Vista previa del bono con el tope ya aplicado: el operador ve el monto REAL que
    // se va a acreditar antes de aprobar, no solo el porcentaje.
    try{
      const pel = deps.document.getElementById('portalJobPromo');
      const pv  = deps.document.getElementById('portalJobBonoPreview');
      if(pel && pv){
        const pct  = Number(pel.dataset.bonoPct||0);
        const tope = Number(pel.dataset.bonoMax||0);
        if(pct > 0 && actual > 0){
          const bruto = Math.round(actual * pct / 100);
          const real  = tope > 0 ? Math.min(bruto, tope) : bruto;
          pv.innerHTML = real < bruto
            ? 'Se acreditan <b style="color:#fbbf24">'+deps.esc(deps.money(real))+'</b> (el '+pct+'% daba '+deps.esc(deps.money(bruto))+' — <b>tope aplicado</b>)'
            : 'Se acreditan <b style="color:#22c55e">'+deps.esc(deps.money(real))+'</b>';
        } else pv.textContent = '';
      }
    }catch(_e){}
  };
  async function portalRenderPromo(usuario){
    const el = deps.document.getElementById('portalJobPromo');
    if(!el) return;
    el.innerHTML=''; el.dataset.bonoPct='0'; el.dataset.bonoMax='0'; el.dataset.promoBilleteraId=''; el.dataset.promoBilleteraNombre='';
    const u = String(usuario||'').trim();
    if(!u) return;
    try{
      const r = await deps.supabaseClient.rpc('panel_promo_primer_ingreso',{p_secret:deps.window.PANEL_DATA_SECRET,p_pc_codigo:(deps.pcOperativa||deps.window.pcOperativa||''),p_usuario:u});
      const d = (r && r.data) || {};
      if(!d.primer_ingreso || !d.promo_activa || !(Number(d.bono_pct)>0)) return; // no aplica
      el.dataset.bonoPct=String(d.bono_pct);
      // TOPE del bono (lo fija la RPC, hoy $50.000). Sin esto una carga de $520.000
      // regalaba $260.000: el bono se calculaba como % puro, sin techo.
      el.dataset.bonoMax=String(Number(d.bono_max)||0);
      el.dataset.promoBilleteraId=String(d.promo_billetera_id||'');
      el.dataset.promoBilleteraNombre=String(d.promo_billetera_nombre||'');
      const reqs = '🔔 Push '+(d.push?'✅':'❌')+' &nbsp;·&nbsp; 📱 App '+(d.app?'✅':'❌');
      const _bmax = Number(d.bono_max)||0;
      const _topeTxt = _bmax ? ` <span style="color:#fbbf24">· tope ${deps.esc(deps.money(_bmax))}</span>` : '';
      // El bono se controla por USUARIO, pero la misma persona puede abrir otro usuario y volver
      // a cobrarlo. Lo único que no puede cambiar es la cuenta donde cobra. Si esa cuenta ya
      // recibió el bono con otro usuario, avisamos y dejamos el tilde APAGADO: no lo bloqueamos
      // (puede ser familia compartiendo cuenta) pero que sea una decisión y no el default.
      const _cuentaRepetida = !!d.cuenta_compartida;
      const _avisoCuenta = _cuentaRepetida ? `
        <div style="background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.42);border-radius:9px;padding:7px 9px;margin-top:8px">
          <div style="font-weight:800;color:#fbbf24;font-size:12.5px">⚠️ La cuenta donde cobra ya recibió el bono con ${Number(d.otros_con_bono)||0} usuario${(Number(d.otros_con_bono)||0)===1?'':'s'} más</div>
          <div style="font-size:11px;color:#cbd5e1;margin-top:3px;word-break:break-word">${deps.esc(String(d.otros_usuarios||''))}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px">Puede ser familia o pareja compartiendo cuenta. Si corresponde darlo, tildá el bono.</div>
        </div>` : '';
      el.innerHTML = `<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.35);border-radius:10px;padding:9px 11px">
        <div style="font-weight:900;color:#22c55e">🎁 PRIMER INGRESO — bono ${d.bono_pct}%${_topeTxt}</div>
        <div style="font-size:12px;color:#cbd5e1;margin-top:3px">${reqs}</div>
        ${_avisoCuenta}
        <label style="display:flex;align-items:center;gap:7px;margin-top:7px;font-size:13px;font-weight:700;cursor:pointer">
          <input type="checkbox" id="portalJobBonoChk" ${_cuentaRepetida?'':'checked'}> Cargar con bono (+${d.bono_pct}% en billetera ${deps.esc(d.promo_billetera_nombre||'PROMO')})
        </label>
        <div id="portalJobBonoPreview" style="font-size:11px;color:#94a3b8;margin-top:4px"></div>
        ${(!d.promo_billetera_id)?'<div style="font-size:11px;color:#fca5a5;margin-top:4px">⚠ No encontré la billetera PROMO de esta oficina (revisá que exista una con \"PROMO\" en el nombre).</div>':''}
      </div>`;
      // La tarjeta llega async (después de que el modal ya pintó el monto) → recalcular
      // la vista previa del bono ahora que ya sabemos el % y el tope.
      try{ deps.portalCheckDiferencia(); }catch(_e){}
    }catch(e){ console.warn('[promo]',e); }
  }
  async function portalRenderVinculo(usuario){
    const el = deps.document.getElementById('portalJobVinculo');
    if(!el) return;
    const u = String(usuario||'').toLowerCase().trim();
    if(!u){ el.innerHTML=''; return; }
    el.dataset.usuario = u;
    el.innerHTML = '<span style="color:#64748b">Vínculo usuario/teléfono:</span> <span style="color:#94a3b8">consultando…</span>';
    try{
      const pcs = (typeof deps.pcAliasesHist==='function') ? deps.pcAliasesHist() : [String(deps.pcOperativa||'')];
      deps.window.NodoSalud?.begin('IDENTIDAD')?.record('DATA','OK','PORTAL_VINCULO_READ');
      const { data } = await deps.supabaseClient.from('usuarios_portal_vinculos')
        .select('id,estado_vinculo,telefono_canon,fuente')
        .in('pc_codigo', pcs).eq('usuario', u).limit(1);
      const v = (data && data[0]) || null;
      if(!v){
        el.innerHTML = '<span style="color:#64748b">Vínculo:</span> <b style="color:#fbbf24">⚪ no registrado</b> <span style="color:#64748b">— se vincula cuando el usuario ingrese al portal</span>';
        return;
      }
      el.dataset.vinculoId = v.id;
      const est = String(v.estado_vinculo||'');
      const color = est==='VINCULADO'?'#22c55e':est==='BLOQUEADO'?'#ef4444':'#fbbf24';
      const icon  = est==='VINCULADO'?'🟢':est==='BLOQUEADO'?'🔴':'🟡';
      let html = '<span style="color:#64748b">Vínculo:</span> <b style="color:'+color+'">'+icon+' '+deps.esc(est)+'</b>';
      if(v.telefono_canon) html += ' <span style="color:#64748b">· tel '+deps.esc(deps.window._tel ? deps.window._tel(v.telefono_canon) : v.telefono_canon)+'</span>';
      if(v.fuente) html += ' <span style="color:#64748b">· '+deps.esc(v.fuente)+'</span>';
      if(est==='PENDIENTE') html += ' <button class="mini-btn green" style="font-size:11px;margin-left:8px" onclick="portalConfirmarVinculo()">✓ Confirmar vínculo</button>';
      el.innerHTML = html;
    }catch(e){ el.innerHTML=''; }
  }
  api.portalConfirmarVinculo = async function(){
    const el = deps.document.getElementById('portalJobVinculo');
    const id = el && el.dataset.vinculoId;
    if(!id) return;
    try{
      const operador = (deps.window.operador?.usuario || deps.window.operador?.nombre || 'panel');
      const { error } = await deps.supabaseClient.rpc('panel_vinculo_confirmar',{p_secret:deps.window.PANEL_DATA_SECRET,p_id:Number(id),p_operador:operador});
      if(error) throw error;
      if(typeof deps.toast==='function') deps.toast('Vínculo confirmado','green');
      portalRenderVinculo(el.dataset.usuario || '');
    }catch(e){ deps.alert('No se pudo confirmar el vínculo: '+(e.message||e)); }
  };
  api.abrirModalPortalSolicitud = async function(id){
    const s = portalSolicitudById(id);
    if(!s) return deps.alert('Solicitud no encontrada');
    try{ await deps.cargarBilleteras(false); }catch(e){}
    const el = portalEnsureModal();
    el.dataset.solicitudId = String(id);
    const tipo = String(s.TIPO || s.TIPO_SOLICITUD || '').toUpperCase() || 'CARGA';
    const monto = Number(s.MONTO_REAL || s.MONTO_DECLARADO || 0);
    const _titular = s.TITULAR || s.NOMBRE_COMPLETO || '—';
    const _destino = s.DESTINO || s.BILLETERA_NOMBRE || '—';
    deps.document.getElementById('portalJobSub').textContent = '#'+id+' · '+(s.USUARIO||'')+' · '+tipo+' · '+deps.fecha(s.FECHA_CREACION || s.FECHA);
    // Info del retiro más clara (importado del nodo del colega): en RETIRO, titular GRANDE + CBU
    // del que solicita con botón de copiar; en carga se mantiene compacto.
    const _esRetiroJob = tipo==='RETIRO';
    const _cbuJob = _esRetiroJob ? String(s.CBU||s.CVU||s.CBU_ALIAS||s.RETIRO_ALIAS_CBU||s.ALIAS_CBU||(_destino!=='—'?_destino:'')||'').trim() : '';
    // Badge de tipo (prioriza la vista): verde CARGA ⬆️ · naranja RETIRO ⬇️ + monto declarado.
    const _tipoBadge = _esRetiroJob
      ? '<span style="display:inline-block;background:rgba(251,146,60,.15);color:#fb923c;border:1px solid rgba(251,146,60,.4);border-radius:999px;padding:2px 10px;font-size:11px;font-weight:900">⬇️ RETIRO</span>'
      : '<span style="display:inline-block;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.4);border-radius:999px;padding:2px 10px;font-size:11px;font-weight:900">⬆️ CARGA</span>';
    let _refHtml = '<div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">'+_tipoBadge+'<span style="font-size:16px;font-weight:900;color:#fff">'+deps.esc(deps.money(monto))+'</span></div>';
    if(_esRetiroJob){
      _refHtml += '<div style="grid-column:1/-1"><span style="color:#64748b;font-size:11px;text-transform:uppercase;font-weight:800">Titular</span>'
        + '<div style="font-size:19px;font-weight:900;color:#fff;line-height:1.15">'+deps.esc(_titular)+'</div></div>';
      if(_cbuJob){
        _refHtml += '<div style="grid-column:1/-1"><button type="button" onclick="portalCopiarCbu(this)" data-valor="'+deps.esc(_cbuJob)+'" title="Tocá para copiar" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;cursor:pointer;background:#0d1117;border:1px solid rgba(251,146,60,.5);border-radius:9px;padding:8px 11px;color:#e6edf3;margin-top:6px"><span style="min-width:0;flex:1"><span style="display:block;font-size:10px;font-weight:800;text-transform:uppercase;color:#8b949e">CBU / Alias del que retira · tocá para copiar</span><span style="display:block;font-family:ui-monospace,monospace;font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+deps.esc(_cbuJob)+'</span></span><span class="pcopy-ico" style="font-size:15px">📋</span></button></div>';
      }
    } else {
      // CARGA prolijo: titular (quien transfiere) prominente + destino declarado (billetera que usó).
      _refHtml += '<div style="grid-column:1/-1"><span style="color:#64748b;font-size:11px;text-transform:uppercase;font-weight:800">Titular que transfiere</span>'
        + '<div style="font-size:17px;font-weight:900;color:#fff;line-height:1.15">'+deps.esc(_titular)+'</div></div>'
        + ((_destino&&_destino!=='—') ? '<div style="grid-column:1/-1;margin-top:3px"><span style="color:#64748b">Destino declarado:</span> <b style="color:#e6edf3">'+deps.esc(_destino)+'</b></div>' : '')
        // El jugador no refrescó el portal: transfirió a la billetera que estaba antes.
        // Va acá arriba y en ámbar porque es el dato que cambia la decisión.
        + (function(){
            try{
              const bv = deps.window._billeteraVieja ? deps.window._billeteraVieja(s) : null;
              if(!bv) return '';
              return '<div style="grid-column:1/-1;margin-top:6px;padding:8px 10px;border-radius:8px;'
                + 'background:rgba(245,158,11,.14);border:1px solid #f59e0b;color:#fde68a;font-size:12.5px;line-height:1.5">'
                + '<b>⚠ No refrescó el portal.</b> Transfirió a <b>'+deps.esc(bv.vieja)+'</b>, '
                + 'pero la billetera activa ahora es <b>'+deps.esc(bv.actual)+'</b>. '
                + 'Revisá en cuál entró la plata antes de aprobar.</div>';
            }catch(_e){ return ''; }
          })()
    }
    deps.document.getElementById('portalJobRef').innerHTML = _refHtml;
    // Avisos de bono sin liberar / CBU compartido (solo en RETIRO). Informan, no bloquean.
    try{
      const _alEl = deps.document.getElementById('portalJobAlertas');
      if(_alEl) _alEl.innerHTML = (_esRetiroJob && deps.window._alertaRetiroHtml)
        ? (deps.window._alertaRetiroHtml(id, {monto: Math.abs(monto||0), expandido:true}) || '')
        : '';
      // Acá es donde el dato importa: pedimos una lectura fresca y repintamos cuando llega.
      // En la lista el refresco es cada 5 min; en el modal, al abrirlo.
      if(_esRetiroJob && deps.window.cargarAlertasRetiro){
        deps.window.cargarAlertasRetiro(true).then(function(){
          try{
            const el2 = deps.document.getElementById('portalJobAlertas');
            if(el2) el2.innerHTML = deps.window._alertaRetiroHtml(id, {monto: Math.abs(monto||0), expandido:true}) || '';
          }catch(_e){}
        }).catch(function(){});
      }
    }catch(_e){}
    el.dataset.montoDeclarado = String(Math.abs(monto || 0));
    deps.document.getElementById('portalJobMontoAprobado').value = String(Math.abs(monto || 0));
    deps.document.getElementById('portalJobObs').value = '';
    try{ deps.portalCheckDiferencia(); }catch(_e){}
    try{ portalRenderVinculo(s.USUARIO); }catch(_e){}
    try{ portalRenderPromo(s.USUARIO); }catch(_e){}
    const res = deps.document.getElementById('portalJobResultado');
    if(res) res.innerHTML = '';
    portalPoblarBilleteras(deps.document.getElementById('portalJobBilletera'), s);
    const btn = deps.document.getElementById('portalJobEnviarBtn');
    if(btn){ btn.disabled=false; btn.style.opacity=''; btn.textContent='Aprobar'; }
    // Botón "Parcial" solo en RETIROS (unifica: desde el mismo modal se puede aprobar completo o parcial).
    const _pb=deps.document.getElementById('portalJobParcialBtn'); if(_pb) _pb.style.display = _esRetiroJob ? '' : 'none';
    try{ api.portalJobRevisarFichas(); }catch(_e){}
    el.style.display = 'block';
    deps.setTimeout(()=>{ const inp = deps.document.getElementById('portalJobMontoAprobado'); if(inp){ inp.focus(); inp.select(); } }, 80);
  };
  // Desde el modal de aprobar un RETIRO → ir al pago parcial (mismo id). Unifica el flujo.
  api.portalJobIrParcial = function(){
    const modal=deps.document.getElementById('portalJobModal');
    const id=Number(modal?.dataset?.solicitudId||0);
    if(!id) return;
    try{ deps.cerrarPortalJobModal(); }catch(_e){}
    try{ if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
    if(typeof deps.v154pRegistrarParcial==="function") deps.v154pRegistrarParcial(id);
    else if(deps.window.v154pRegistrarParcial) deps.window.v154pRegistrarParcial(id);
  };
  api.confirmarPortalJobModal = async function(){
    const modal = deps.document.getElementById('portalJobModal');
    const id = Number(modal?.dataset?.solicitudId || 0);
    const s = portalSolicitudById(id);
    if(!s) return deps.alert('Solicitud no encontrada');
    const usuario = s.USUARIO || '';
    const tipo = String(s.TIPO || s.TIPO_SOLICITUD || 'CARGA').toUpperCase();
    const montoAprobado = Math.abs(portalParseMonto(portalInputVal('portalJobMontoAprobado')));
    const bilId = portalInputVal('portalJobBilletera');
    const titular = s.TITULAR || s.NOMBRE_COMPLETO || '';
    const destino = s.DESTINO || s.BILLETERA_NOMBRE || '';
    const cbu = s.CBU || s.CVU || s.CBU_ALIAS || '';
    const obs = portalInputVal('portalJobObs');
    // Bono de primer ingreso (lo leemos antes de ocultar el modal)
    const _promoEl = deps.document.getElementById('portalJobPromo');
    const _bonoChk = deps.document.getElementById('portalJobBonoChk');
    const _bonoPct = Number((_promoEl && _promoEl.dataset.bonoPct) || 0);
    const _bonoMax = Number((_promoEl && _promoEl.dataset.bonoMax) || 0);
    const bonoAplicar = !!(_bonoChk && _bonoChk.checked && _bonoPct>0 && tipo==='CARGA');
    const promoBilleteraId = (_promoEl && _promoEl.dataset.promoBilleteraId) || '';
    if(!usuario) return deps.toast('Falta usuario', 'red');
    if(!montoAprobado || montoAprobado <= 0) return deps.toast('Monto aprobado inválido', 'red');
    if(!bilId) return deps.toast('Seleccioná una billetera', 'red');
    const modalEl = deps.document.getElementById('portalJobModal');
    if(modalEl) modalEl.style.display = 'none';
    try{ if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
    deps.toast('Portal: operación enviada. Podés seguir usando el panel.', 'blue');
    // No dejamos el modal bloqueando la pantalla: el flujo continúa en segundo plano
    // y al terminar actualiza Solicitudes/Historial como LANDING.
    deps.ejecutarSolicitudPortalSimple({id, solicitud:s, usuario, tipo, montoAprobado, bilId, titular, destino, cbu, obs, bonoAplicar, bonoPct:_bonoPct, bonoMax:_bonoMax, promoBilleteraId})
      .catch(function(e){ console.error('portal job error:', e); deps.toast('Portal con error: '+(e.message||''), 'red'); });
  };

  // La nota lleva SOLO lo que no está en las columnas de la tabla. El monto ya se ve en su columna
  // y la billetera en la suya: repetirlos hacía que la línea de detalle fuera casi toda ruido, y
  // lo único que se quería leer —el titular, el alias del cliente— quedaba enterrado al final.
  // Si el retiro YA tiene un parcial en curso (pagado>0 y < total), "Aprobar" NO debe hacer un
  // retiro COMPLETO: eso marcaría PAGADA ignorando lo ya pagado (y sin tocar metadata.retiro_parcial),
  // cerrando el retiro con saldo real pendiente. En ese caso, redirigimos al flujo Parcial por lo que
  // falta → el cierre lo decide SOLO la RPC del parcial cuando pagado>=total.
  // Devuelve true si redirigió (y entonces el que llama no sigue).
  function _irAParcialSiCorresponde(id){
    try{
      const s = (deps.V154P.solicitudes||[]).find(x=>Number(x.ID||x.SOLICITUD_ID)===Number(id));
      if(s && deps.window._retiroParcialSigueAbierto && deps.window._retiroParcialSigueAbierto(s)){
        const pp = deps.window._retiroParcialInfo(s);
        try{ deps.toast('Este retiro tiene un parcial en curso · pagado '+deps.money(pp.pagado)+' de '+deps.money(pp.total)+'. Abro "Parcial" por lo que falta ('+deps.money(pp.restante)+').','yellow'); }catch(_e){}
        if(typeof deps.window.v154pRegistrarParcial==='function'){ deps.window.v154pRegistrarParcial(id); return true; }
      }
    }catch(_e){}
    return false;
  }

  // Abre el cartel de aprobar: para cuando hay que cambiar el monto, la billetera o dejar una
  // observación. El botón "Aprobar" común ya no pasa por acá (ver v154pAprobarSolicitud).
  api.v154pCrearJobSolicitud = async function(id){
    if(_irAParcialSiCorresponde(id)) return;
    return deps.window.abrirModalPortalSolicitud(id);
  };

  // El bono de primer ingreso de este usuario, sin dibujar nada: lo mismo que lee el cartel
  // (portalRenderPromo) pero como dato. Devuelve null si no le toca ninguno.
  async function portalPromoDe(usuario){
    const u = String(usuario||'').trim();
    if(!u) return null;
    try{
      const r = await deps.supabaseClient.rpc('panel_promo_primer_ingreso',{p_secret:deps.window.PANEL_DATA_SECRET,p_pc_codigo:(deps.pcOperativa||deps.window.pcOperativa||''),p_usuario:u});
      const d = (r && r.data) || {};
      if(!d.primer_ingreso || !d.promo_activa || !(Number(d.bono_pct)>0)) return null;
      return {
        pct: Number(d.bono_pct)||0,
        max: Number(d.bono_max)||0,
        billeteraId: String(d.promo_billetera_id||''),
        // La cuenta donde cobra ya recibió el bono con otro usuario: el cartel deja el tilde
        // APAGADO para que sea una decisión y no el default.
        compartida: !!d.cuenta_compartida,
        otros: Number(d.otros_con_bono)||0
      };
    }catch(e){ console.warn('[promo]', e); return null; }
  }

  // APROBAR DE UNA. El operador ya miró el expediente: acá no se le pide nada más. Se usa lo que el
  // propio cartel proponía de entrada —el monto declarado, la billetera donde entró la plata y el
  // bono si le toca— y se encola igual que cuando se confirmaba desde el cartel (misma cola, que
  // además no deja encolar dos veces la misma solicitud).
  //
  // Hay UN caso en que el cartel se abre igual: el bono con cuenta compartida. Es una decisión que
  // el sistema dejó explícitamente en manos del operador (puede ser familia), y no se puede tomar
  // después: el bono viaja en la misma operación que la carga.
  const _aprobando = new Set();
  api.v154pAprobarSolicitud = async function(id){
    const nid = Number(id);
    if(!nid || _aprobando.has(nid)) return;                    // doble clic: una sola vez
    _aprobando.add(nid);
    try{
      if(_irAParcialSiCorresponde(nid)) return;
      const s = portalSolicitudById(nid);
      if(!s) return deps.alert('Solicitud no encontrada');
      try{ await deps.cargarBilleteras(false); }catch(_e){}

      const usuario = s.USUARIO || '';
      const tipo = String(s.TIPO || s.TIPO_SOLICITUD || 'CARGA').toUpperCase();
      const montoAprobado = Math.abs(Number(s.MONTO_REAL || s.MONTO_DECLARADO || 0));
      const bil = portalBilleteraPreferida(s);
      // Sin monto o sin billetera no hay nada que proponer: ahí SÍ hace falta el cartel.
      if(!usuario || !montoAprobado || !bil || !bil.ID_BILLETERA){
        try{ deps.toast('Falta el monto o la billetera: completalo en el cartel.', 'yellow'); }catch(_e){}
        return deps.window.abrirModalPortalSolicitud(nid);
      }

      let promo = null;
      if(tipo === 'CARGA'){
        promo = await portalPromoDe(usuario);
        if(promo && promo.compartida){
          try{ deps.toast('Hay que decidir el bono: esa cuenta ya cobró el bono con '+promo.otros+' usuario'+(promo.otros===1?'':'s')+' más.', 'yellow'); }catch(_e){}
          return deps.window.abrirModalPortalSolicitud(nid);
        }
      }

      try{ if(deps.window.cerrarExpedienteSolicitud) deps.window.cerrarExpedienteSolicitud(); }catch(_e){}
      return Promise.resolve(deps.ejecutarSolicitudPortalSimple({
        id: nid, solicitud: s, usuario, tipo, montoAprobado,
        bilId: bil.ID_BILLETERA,
        titular: s.TITULAR || s.NOMBRE_COMPLETO || '',
        destino: s.DESTINO || s.BILLETERA_NOMBRE || '',
        cbu: s.CBU || s.CVU || s.CBU_ALIAS || '',
        obs: '',
        bonoAplicar: !!promo, bonoPct: promo ? promo.pct : 0, bonoMax: promo ? promo.max : 0,
        promoBilleteraId: promo ? promo.billeteraId : ''
      })).catch(function(e){ console.error('portal job error:', e); deps.toast('Portal con error: '+(e.message||''), 'red'); });
    } finally {
      // Se suelta recién cuando el clic ya hizo su efecto (encolado, o cartel abierto): así dos
      // clics seguidos no se pisan, pero tampoco queda trabada para siempre si algo falla.
      deps.setTimeout(function(){ _aprobando.delete(nid); }, 1500);
    }
  };

  let _expedienteActualData = null;

  function expedienteEnsureModal(){
    let el = deps.document.getElementById('modalExpedienteOverlay');
    if(el) return el;
    el = deps.document.createElement('div');
    el.id = 'modalExpedienteOverlay';
    el.className = 'expediente-overlay hidden';
    el.innerHTML = `
      <div class="expediente-drawer" data-ocupa-derecha onclick="event.stopPropagation()">
        <div class="expediente-head">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            <div id="expedienteTipoIco" class="expediente-ico">📋</div>
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <h2 id="expedienteTitulo" class="expediente-title">Expediente #0</h2>
                <span id="expedienteEstadoBadge" class="exp-badge">-</span>
              </div>
              <div id="expedienteSubtitulo" class="expediente-sub">Cargando detalles...</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <button class="mini-btn gray" type="button" onclick="copiarResumenExpediente()" title="Copia los datos de esta operación (jugador, monto, estado, billetera y titular) listos para pegar en el chat o en WhatsApp">📋 Copiar datos</button>
            <button class="expediente-close-btn" type="button" onclick="cerrarExpedienteSolicitud()" title="Cerrar (Esc)">✕</button>
          </div>
        </div>
        <div id="expedienteBody" class="expediente-body"></div>
        <div id="expedienteFooter" class="expediente-footer"></div>
      </div>
    `;
    el.addEventListener('click', function(e){
      if(e.target === el) api.cerrarExpedienteSolicitud();
    });
    deps.document.body.appendChild(el);
    return el;
  }

  api.cerrarExpedienteSolicitud = function(){
    const el = deps.document.getElementById('modalExpedienteOverlay');
    if(el) el.classList.add('hidden');
    _expedienteActualData = null;
    _anclarCartel();
  };

  // El cartel de versión vive arriba a la derecha, que es justo donde se abre el cajón del
  // expediente: lo pisaba y tapaba el título. Se corre hacia el costado mientras el cajón esté
  // abierto y vuelve cuando se cierra (la cuenta la hace _updaterAnclar, en core/actualizaciones.js).
  function _anclarCartel(){
    try{
      const f = deps.window && deps.window._updaterAnclar;
      if(typeof f !== 'function') return;
      f();
      // El cajón entra deslizándose (.24 s): se vuelve a medir cuando ya llegó a su lugar.
      deps.setTimeout(f, 320);
    }catch(_e){}
  }

  deps.window.cerrarExpedienteSolicitud = api.cerrarExpedienteSolicitud;

  // El expediente que se le MANDA al jugador, con el formato que pidió Juan (12/09): sin "Origen"
  // (vocabulario nuestro que del otro lado no significa nada), y sin titular → "No pudo ser extraído."
  // en vez de un "—" que parece un error. El número es el de la solicitud: es el que ve el jugador.
  function _textoExpediente(d){
    const tit = d.titular || 'No pudo ser extraído.';
    const rechTxt = d.rechazo
      ? ('\n⛔ RECHAZO / INCIDENCIA: [' + d.rechazo.codigo + '] ' + d.rechazo.titulo
         + '\n📝 Mensaje enviado: ' + d.rechazo.mensajeCliente)
      : '';
    return '📋 EXPEDIENTE #' + (d.solicitudId || d.id) + ' · ' + d.tipo + '\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + '👤 Jugador: ' + (d.usuario || '—') + '\n'
      + '📱 Teléfono: ' + (d.telefono || 'No informado') + '\n'
      + '💰 Monto: ' + fmtMoney(d.montoDeclarado) + '\n'
      + '📊 Estado: ' + d.estado + '\n'
      + '🏢 Billetera: ' + (d.billeteraNombre || '—') + '\n'
      + (d.tipo === 'RETIRO' ? ('💳 CBU/Destino: ' + (d.destino || '—') + '\n') : '')
      + '👤 Titular: ' + tit
      + (d.mensaje ? ('\n💬 Mensaje: "' + d.mensaje + '"') : '')
      + rechTxt + '\n'
      + '━━━━━━━━━━━━━━━━━━━━\n'
      + 'Fecha: ' + fmtFecha(d.fecha);
  }
  // El mismo texto para CUALQUIER operación, sin tocar el expediente que esté abierto en pantalla.
  // Lo usa el desplegable del chat.
  deps.window.expedienteTextoDe = function(row){
    const _prev = _expedienteActualData;
    try{
      api.construirDossierCompletoHtml(row);
      return _expedienteActualData ? _textoExpediente(_expedienteActualData) : '';
    }catch(_e){ return ''; }
    finally{ _expedienteActualData = _prev; }
  };

  deps.window.copiarResumenExpediente = function(){
    if(!_expedienteActualData){
      try{ deps.toast('No hay datos de la solicitud cargados', 'red'); }catch(_e){}
      return;
    }
    const txt = _textoExpediente(_expedienteActualData);

    // Por nodoCopiar: recupera el foco antes de copiar (el panel puede estar operando en la
    // ventana del backoffice) y, si aun así no puede, muestra el texto en vez de perderlo.
    try{ deps.window.nodoCopiar(txt, { etiqueta: '✓ Datos de la operación copiados' }); }
    catch(_e){ deps.toast('No se pudo copiar automáticamente', 'yellow'); }
  };

  api.construirDossierCompletoHtml = function(idOrObj){
    let s = null;
    let itemUnified = null;
    if(typeof idOrObj === 'object' && idOrObj !== null){
      itemUnified = idOrObj;
      s = idOrObj._raw || idOrObj;
    } else {
      const idStr = String(idOrObj);
      // "h<id>" = una fila puntual de historial_ops (la clave de las tarjetas, ver _claveStream).
      // Buscando por solicitud, un retiro pagado en partes devolvía siempre la misma fila.
      const _hId = /^h\d+$/.test(idStr) ? idStr.slice(1) : null;
      if(_hId){
        const _c = (deps.window && deps.window._histUnificadoCache) || [];
        itemUnified = _c.find(x => x.fuente === 'OPERACION' && String(x.historial_id || x.id) === _hId) || null;
        if(itemUnified) s = itemUnified._raw || itemUnified;
        if(!s) s = ((deps.window && deps.window._historialData) || []).find(x => String(x.id) === _hId) || null;
      }
      if(!s && !_hId && deps.window && deps.window._histUnificadoCache){
        // La carga y su bono de PROMOS comparten solicitud_id. Ganaba el PRIMERO de la lista —el bono,
        // que se registra después y el historial viene de más nuevo a más viejo— y la carga original
        // no se podía abrir (Juan, 12/09). Gana la original; el bono se elige aparte desde el chat.
        const _cands = deps.window._histUnificadoCache.filter(x => String(x.solicitud_id || x.id || x.historial_id) === idStr);
        itemUnified = _cands.find(x => String((x._raw && x._raw.origen) || '').toUpperCase() !== 'PROMO_BONO') || _cands[0];
        if(itemUnified) s = itemUnified._raw || itemUnified;
      }
      if(!s && deps.V154P && deps.V154P.solicitudes){
        s = deps.V154P.solicitudes.find(x => String(x.ID || x.SOLICITUD_ID || x.id) === idStr);
      }
      if(!s && deps.window && deps.window.solicitudes){
        s = deps.window.solicitudes.find(x => String(x.ID || x.SOLICITUD_ID || x.id) === idStr);
      }
      if(!s && deps.window && deps.window._historialData){
        const _hs = deps.window._historialData.filter(x => String(x.solicitud_id || x.id) === idStr);
        s = _hs.find(x => String(x.origen || '').toUpperCase() !== 'PROMO_BONO') || _hs[0];
      }
    }

    if(!s){
      return `
        <div class="sol-empty-dossier">
          <span class="sol-empty-icon">📂</span>
          <h3>Solicitud no seleccionada</h3>
          <p>Hacé clic en cualquier tarjeta de la lista para ver el expediente completo.</p>
        </div>`;
    }

    let meta = s.METADATA !== undefined ? s.METADATA : (s.metadata || {});
    if(typeof meta === 'string'){ try{ meta = JSON.parse(meta); }catch(_e){ meta = {}; } }

    const id = s.ID || s.SOLICITUD_ID || s.id || (typeof idOrObj !== 'object' ? idOrObj : 0);
    const tipo = String(s.TIPO || s.TIPO_SOLICITUD || s.tipo || (itemUnified && itemUnified.tipo) || 'OPERACION').toUpperCase();
    const usuario = String(s.USUARIO || s.USUARIO_JUGADOR || s.usuario || (itemUnified && itemUnified.usuario) || '').trim();
    const notas = String(s.notas || s.NOTAS || (meta && meta.notas) || '').trim();
    // Una operación MANUAL no tiene columna TITULAR: el titular viaja DENTRO de notas, tal como
    // lo escribe portalNotasBase ("#206911 · Titular: Fulano De Tal · Alias: ..."). Sin leerlo de
    // ahí, la ficha mostraba "Titular: —" con el dato a la vista dos renglones más abajo.
    let titular = String(s.TITULAR || s.NOMBRE_COMPLETO || s.titular || (meta && meta.titular)
      || ((notas.match(/Titular:\s*([^·\n]+)/i) || [])[1] || '')).trim();
    // Una fila sin titular propio —el bono de PROMOS, cuyas notas dicen "Bono primer ingreso…"— lo
    // toma de su solicitud o de la carga original, que comparten solicitud_id. Juan copió un
    // expediente desde la fila del bono y salió sin titular.
    if(!titular){
      const _sidT = String(s.solicitud_id || s.SOLICITUD_ID || '');
      if(_sidT){
        try{
          const _S = (deps.V154P && deps.V154P.solicitudes) || [];
          const _sol = _S.find(function(x){ return String(x.ID || x.SOLICITUD_ID || '') === _sidT; });
          if(_sol) titular = String(_sol.TITULAR || _sol.NOMBRE_COMPLETO || '').trim();
        }catch(_e){}
        if(!titular){
          try{
            for(const _h of ((deps.window && deps.window._historialData) || [])){
              if(String(_h.solicitud_id || '') !== _sidT) continue;
              const _m = String(_h.notas || '').match(/Titular:\s*([^·\n]+)/i);
              if(_m){ titular = _m[1].trim(); break; }
            }
          }catch(_e){}
        }
      }
    }
    const destino = String(s.DESTINO || s.CBU || s.cbu || s.destino || (meta && (meta.destino || meta.cbu)) || '').trim();
    const montoDecl = Number(s.MONTO_DECLARADO != null ? s.MONTO_DECLARADO : (s.monto != null ? s.monto : (itemUnified ? itemUnified.monto : 0)));
    const montoReal = Number(s.MONTO_REAL != null ? s.MONTO_REAL : (meta.monto_corregido != null ? meta.monto_corregido : montoDecl));
    const estado = String(s.ESTADO || s.estado || (itemUnified && itemUnified.estado) || 'OK').toUpperCase();
    const fechaCreacion = s.FECHA_CREACION || s.FECHA || s.created_at || s.fecha || (itemUnified && itemUnified.fecha) || null;
    // 6/10 · Acá decía "Teléfono: No informado" con el número a la vista en la MISMA pantalla.
    //
    // La cadena empezaba por la columna `telefono`, que está vacía en el 100% de las cargas,
    // los retiros y los cambios de clave (medido: 29.360 solicitudes en 7 días). Y si el
    // expediente se abría desde el historial de operaciones —que nunca tuvo teléfono— no había
    // de dónde sacarlo, aunque el padrón lo tuviera.
    //
    // Ahora la cadena es UNA sola y vive en NodoDomain.identidad, y el padrón que consulta ya
    // está en memoria: no agrega ni un viaje a la base.
    const telefono = (function(){
      try{
        const _id = deps.window.NodoDomain && deps.window.NodoDomain.identidad;
        if(_id) return _id.telefono(s, deps.window.padronTelefono) || _id.telefono({ metadata: meta });
      }catch(_e){}
      return String(s.TELEFONO || s.telefono || (meta && meta.telefono) || '').trim();
    })();
    const operador = String(s.OPERADOR || s.operador || (meta && meta.operador) || (itemUnified && itemUnified.operador) || '').trim();
    const origen = String(s.ORIGEN || s.origen || (itemUnified && itemUnified.fuente === 'OPERACION' ? 'MANUAL' : 'PORTAL')).toUpperCase();
    const movId = s.chunior_movimiento_id || (meta && meta.chunior_movimiento_id) || (itemUnified && itemUnified.chunior_movimiento_id) || null;
    const bilNombre = String(s.BILLETERA_NOMBRE || s.billetera_nombre || (meta && meta.billetera_nombre) || (itemUnified && itemUnified.billetera_nombre) || '').trim();
    const bilAlias = String(s.BILLETERA_ALIAS || (meta && meta.billetera_alias) || '').trim();
    const bilCbu = String(s.BILLETERA_CBU || (meta && meta.billetera_cbu) || '').trim();
    const bilTitular = String(s.BILLETERA_TITULAR || (meta && meta.billetera_titular) || '').trim();
    const saldoPre = s.SALDO_PRE != null ? s.SALDO_PRE : (meta.saldo_pre ?? (s.saldo_pre ?? (itemUnified && itemUnified.saldo_pre)));
    const saldoPost = s.SALDO_POST != null ? s.SALDO_POST : (meta.saldo_post ?? (s.saldo_post ?? (itemUnified && itemUnified.saldo_post)));
    const mensaje = String(s.MENSAJE_INICIAL || (meta && meta.mensaje_inicial) || s.mensaje || '').trim();
    const chatId = s.CHAT_ID || s.chat_id || (meta && meta.chat_id) || null;
    const comprobanteUrl = s.COMPROBANTE_URL || s.comprobante_url || (meta && meta.comprobante_url) || null;

    const esManual = origen === 'MANUAL' || origen === 'PANEL' || (itemUnified && itemUnified.fuente === 'OPERACION');
    // Un retiro pagado en partes tiene un movimiento de Chunior y un par de saldos POR PAGO: no
    // entran en un casillero. Van abajo, en el detalle del retiro (Juan, 13/09).
    const _partesRetiro = ((deps.window && deps.window._historialData) || []).filter(function(h){
      const sid = String((s && s.solicitud_id) || (itemUnified && itemUnified.solicitud_id) || '');
      return sid && String(h.solicitud_id || '') === sid
        && String(h.tipo || '').toUpperCase() === 'RETIRO' && Number(h.monto || 0) > 0;
    }).length;
    const esRetiro = tipo === 'RETIRO';
    const esCarga = tipo === 'CARGA';
    const esRechazo = ['RECHAZADA', 'CANCELADA'].includes(estado);

    // Cada tipo de operacion tiene datos DISTINTOS. Antes se pintaba la misma ficha de
    // carga/retiro para todo, asi que un CAMBIO_CLAVE mostraba monto $0, billetera "Sin
    // billetera", saldos vacios y un paso "2. Chunior · Pendiente" que no se completa nunca:
    // el cambio de clave se ejecuta con callDrex("cambiarClave"), NO genera movimiento en
    // Chunior. Medido: 744 RESET_CLAVE en 30 dias, 0 con numero de movimiento.
    const TIPOS_MOV_CHUNIOR = ['MOV_BILLETERA','CAMBIO_BILLETERA','DEPOSITO_SR','PROPINA','RECARGA_FICHAS'];
    const esClave      = tipo === 'CAMBIO_CLAVE' || tipo === 'RESET_CLAVE';
    const esConsulta   = tipo === 'CONSULTA';
    const esMovChunior = TIPOS_MOV_CHUNIOR.includes(tipo);
    const tieneMonto   = !esClave && !esConsulta;
    const usaChunior   = esCarga || esRetiro || esMovChunior;
    const esJugador    = esCarga || esRetiro || esClave || esConsulta;

    // El jugador no refresco el portal y transfirio a la billetera anterior.
    const bilVieja = (typeof deps.window._billeteraVieja === 'function' && itemUnified)
      ? deps.window._billeteraVieja(itemUnified) : null;

    // La ficha mostraba "Cuenta de transferencia" y "Billetera asignada" con el MISMO valor:
    // en una carga el destino declarado es NUESTRA billetera, asi que se leia dos veces lo
    // mismo. El dato que sirve es cuando NO coinciden: ahi el jugador transfirio a otra
    // billetera nuestra y el operador, que solo ve la activa, no tiene como enterarse.
    const _normCuenta = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const _huellasBilletera = [bilNombre, bilAlias, bilCbu].map(_normCuenta).filter(Boolean);
    const _destinoNorm = _normCuenta(destino);
    const destinoDifiere = !!_destinoNorm && _huellasBilletera.length > 0 &&
      !_huellasBilletera.some(function(h){ return h === _destinoNorm || h.indexOf(_destinoNorm) !== -1 || _destinoNorm.indexOf(h) !== -1; });

    // (notas se declara más arriba: el titular de las manuales sale de ahí)
    // Fila de historial_ops donde hay que escribir el N si lo encontramos en Chunior.
    const histIdParaMov = String(s.historial_id || (itemUnified && itemUnified.historial_id) || (!itemUnified || itemUnified.fuente === 'OPERACION' ? (s.id || '') : '') || '');
    // La clave nueva viaja en el metadata del portal o, en las manuales, dentro de notas
    // como "clave → xxxx" (asi la escribe registrarEnHistorial).
    const claveNueva = String(s.PASSWORD_NUEVO || (meta && meta.password_nuevo) || '').trim()
      || ((notas.match(/clave\s*(?:→|->|:)\s*(\S+)/i) || [])[1] || '');

    let rechazo = (typeof deps.window?.clasificarRechazo === 'function')
      ? deps.window.clasificarRechazo(s)
      : null;

    if(!rechazo && esRechazo){
      const mot = s.MOTIVO_RECHAZO || s.motivo_rechazo || (meta && meta.motivo_rechazo) || 'Rechazada por el operador o sistema';
      rechazo = {
        esRechazo: true,
        codigo: 'RECHAZADA',
        titulo: 'Solicitud rechazada',
        badge: 'Rechazada',
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.12)',
        icono: '⛔',
        mensajeCliente: mot,
        accionSugerida: 'Revisar datos o contactar al jugador.'
      };
    }

    _expedienteActualData = {
      solicitudId: (s.solicitud_id || s.SOLICITUD_ID || s.ID || null),
      id, tipo, usuario, titular, destino, montoDeclarado: montoDecl, montoReal, estado,
      fecha: fechaCreacion, telefono, operador, origen, pc: 'Local', mensaje, billeteraNombre: bilNombre,
      billeteraAlias: bilAlias, billeteraCbu: bilCbu, billeteraTitular: bilTitular,
      saldoPre, saldoPost, movId, chatId, metadata: meta, rechazo, raw: s
    };

    const tipoIco = esCarga ? '⬆️' : (esRetiro ? '⬇️'
      : (esClave ? '🔑' : (esConsulta ? '🔍'
      : (tipo === 'MOV_BILLETERA' ? '🔀' : (tipo === 'CAMBIO_BILLETERA' ? '💳'
      : (tipo === 'DEPOSITO_SR' ? '💜' : (tipo === 'PROPINA' ? '🎁'
      : (tipo === 'RECARGA_FICHAS' ? '🎰' : '📋'))))))));
    const tipoNombre = esClave ? 'CAMBIO DE CLAVE'
      : (tipo === 'MOV_BILLETERA' ? 'TRANSFERENCIA ENTRE BILLETERAS'
      : (tipo === 'CAMBIO_BILLETERA' ? 'CAMBIO DE BILLETERA'
      : (tipo === 'DEPOSITO_SR' ? 'DEPÓSITO SIN RECLAMAR'
      : (tipo === 'RECARGA_FICHAS' ? 'RECARGA DE FICHAS' : tipo))));
    const tipoColor = esRetiro ? '#fb923c' : (esCarga ? '#34d399'
      : (esClave ? '#facc15' : (esMovChunior ? '#c084fc' : '#38bdf8')));

    const estadoCls = ['OK','ACREDITADA','PAGADA','APROBADA'].includes(estado) ? 'green'
      : (esRechazo ? 'red'
      : (['ERROR','ERROR_OPERATIVO'].includes(estado) ? 'yellow' : 'blue'));

    const tomada = ['EN_REVISION', 'EN_PROCESO'].includes(estado);
    // OK y COMPLETADA faltaban en esta lista. Son los estados finales de historial_ops (los
    // manuales y los automaticos cierran en OK, no en ACREDITADA), asi que toda operacion
    // manual terminada figuraba "4. En proceso" y decia "todavia no se ejecuto" donde faltaba
    // el N de Chunior. El badge verde ya las contaba como cerradas: quedaban las dos cosas
    // contradiciendose en la misma ficha.
    const abierta = !['ACREDITADA', 'PAGADA', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'OK', 'COMPLETADA', 'REVERTIDA'].includes(estado);
    // Un retiro del portal que todavía no se pagó: al abrir el expediente se leen las fichas del
    // jugador (ver revisarFichasExpediente). En las cargas, los manuales y los ya cerrados no aplica.
    _expedienteActualData.fichasPendientes = !!(esRetiro && abierta && !esManual && usuario);

    // 1. Cabecera y Botones de Acción
    let actionsHtml = '';
    if(esManual){
      actionsHtml = `
        <div class="sol-manual-notice">
          <span>⚡ Operación registrada en Chunior</span>
          ${movId ? `<span class="sol-mov-tag">Movimiento: <b>N° ${esc(movId)}</b></span>` : ''}
        </div>`;
    } else if(abierta){
      if(!tomada){
        actionsHtml += `<button class="mini-btn yellow" type="button" onclick="window.v154pTomarSolicitud && window.v154pTomarSolicitud(${id})">Tomar</button>`;
      }
      // Aprobar aprueba DE UNA: acá ya está todo el expediente a la vista. Para cambiar el monto,
      // la billetera o dejar una observación está el botón de al lado.
      actionsHtml += `<button class="mini-btn green" type="button" onclick="window.v154pAprobarSolicitud && window.v154pAprobarSolicitud(${id})">✓ Aprobar</button>`;
      actionsHtml += `<button class="mini-btn" type="button" onclick="window.v154pCrearJobSolicitud && window.v154pCrearJobSolicitud(${id})" title="Aprobar cambiando el monto, la billetera o dejando una observación">✎ Otro monto</button>`;
      if(esRetiro){
        actionsHtml += `<button class="mini-btn purple" type="button" onclick="window.v154pRegistrarParcial && window.v154pRegistrarParcial(${id})">💸 Parcial</button>`;
      }
      actionsHtml += `<button class="mini-btn red" type="button" onclick="window.v154pRechazarSolicitud && window.v154pRechazarSolicitud(${id})">✕ Rechazar</button>`;
      // Tomada por error, o el que la tomó se fue: vuelve a la lista de pendientes para que otro la agarre.
      if(tomada){
        actionsHtml += `<button class="mini-btn" type="button" onclick="window.v154pSoltarSolicitud && window.v154pSoltarSolicitud(${id})" title="La devuelve a la lista de pendientes para que otro operador la tome">↩ Soltar</button>`;
      }
    } else if(esRechazo){
      actionsHtml = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:12px;color:#f87171;font-weight:700">⛔ Solicitud rechazada</span>
          <button class="mini-btn blue" type="button" onclick="window.v154pTomarSolicitud && window.v154pTomarSolicitud(${id})" title="Reabrir solicitud en cola de revisión">🔄 Reabrir para revisión</button>
        </div>`;
    } else {
      actionsHtml = `<span style="font-size:12px;color:#86efac;font-weight:700">✓ Operación procesada (${esc(estado)})</span>`;
    }

    const telClean = telefono ? telefono.replace(/\D/g, '') : '';
    const waLink = telClean ? `https://wa.me/${telClean}` : '';

    // Flujo REAL segun el tipo. Un cambio de clave no pasa por Chunior ni por una billetera;
    // decir "2. Chunior Pendiente" en esa ficha es informar un paso que no existe.
    let stepperHtml;
    if(esClave){
      stepperHtml = `
          <div class="sol-step-item done">
            ✓ 1. Pedido
            <div style="font-size:9.5px;opacity:.8">${soloHora(fechaCreacion)}</div>
          </div>
          <div class="sol-step-item ${abierta ? 'idle' : 'done'}">
            ${abierta ? '·' : '✓'} 2. Agente
            <div style="font-size:9.5px;opacity:.8">${abierta ? 'Sin aplicar' : 'Clave cambiada'}</div>
          </div>
          <div class="sol-step-item ${claveNueva ? 'done' : 'idle'}">
            ${claveNueva ? '✓' : '·'} 3. Clave nueva
            <div style="font-size:9.5px;opacity:.8">${claveNueva ? esc(claveNueva) : 'Sin definir'}</div>
          </div>
          <div class="sol-step-item ${esRechazo ? 'error' : (abierta ? 'idle' : 'done')}">
            ${esRechazo ? '✕ Rechazada' : (abierta ? '4. En proceso' : '✓ Finalizada')}
            <div style="font-size:9.5px;opacity:.8">${esc(estado)}</div>
          </div>`;
    } else if(esConsulta){
      stepperHtml = `
          <div class="sol-step-item done">
            ✓ 1. Pedido
            <div style="font-size:9.5px;opacity:.8">${soloHora(fechaCreacion)}</div>
          </div>
          <div class="sol-step-item ${abierta ? 'idle' : 'done'}">
            ${abierta ? '·' : '✓'} 2. Consultado
            <div style="font-size:9.5px;opacity:.8">${abierta ? 'Pendiente' : 'Respondida'}</div>
          </div>
          <div class="sol-step-item ${esRechazo ? 'error' : (abierta ? 'idle' : 'done')}">
            ${esRechazo ? '✕ Rechazada' : (abierta ? '3. En proceso' : '✓ Finalizada')}
            <div style="font-size:9.5px;opacity:.8">${esc(estado)}</div>
          </div>`;
    } else {
      stepperHtml = `
          <div class="sol-step-item done">
            ✓ 1. Registro
            <div style="font-size:9.5px;opacity:.8">${soloHora(fechaCreacion)}</div>
          </div>
          <div class="sol-step-item ${movId ? 'done' : (saldoPre != null ? 'done' : 'idle')}">
            ${movId ? '✓' : '·'} 2. Chunior
            <div style="font-size:9.5px;opacity:.8">${movId ? `N° ${esc(movId)}` : (abierta ? 'Sin ejecutar' : 'Sin N° anotado')}</div>
          </div>
          <div class="sol-step-item ${bilNombre ? 'done' : 'idle'}">
            ${bilNombre ? '✓' : '·'} 3. Billetera
            <div style="font-size:9.5px;opacity:.8">${esc(bilNombre || 'Sin asignar')}</div>
          </div>
          <div class="sol-step-item ${esRechazo ? 'error' : (abierta ? 'idle' : 'done')}">
            ${esRechazo ? '✕ Rechazada' : (abierta ? '4. En proceso' : '✓ Finalizada')}
            <div style="font-size:9.5px;opacity:.8">${esc(estado)}</div>
          </div>`;
    }

    let html = `
      <div class="sol-dossier-head">
        <div class="sol-dossier-top-meta">
          <span class="sol-dossier-id">${esManual && movId ? `#MOV-${esc(movId)}` : `#SOL-${esc(id)}`}</span>
          <span class="exp-badge ${estadoCls}">${esc(estado)}</span>
          <span class="sol-origin-badge ${esManual ? 'manual' : 'portal'}">${esManual ? 'Manual' : 'Portal'}</span>
          <span style="font-size:11.5px;color:#94a3b8">${fmtFecha(fechaCreacion)}</span>
          ${operador ? `<span style="font-size:11.5px;color:#cbd5e1">· Op: <b>${esc(operador)}</b></span>` : ''}
        </div>

        <div class="sol-dossier-title">
          <span>${tipoIco} ${esc(tipoNombre)}${tieneMonto ? ` de <span style="color:${tipoColor}">${fmtMoney(montoDecl)}</span>` : ''}</span>
          <span style="font-size:16px;color:#94a3b8;font-weight:600">· ${esc(usuario || '—')}</span>
        </div>

        <div class="sol-dossier-actions">
          ${actionsHtml}
        </div>
      </div>

      <!-- Barra de Comunicaciones Inmediatas -->
      <div class="sol-comm-bar">
        <button type="button" class="sol-comm-btn chat" onclick="expedienteAbrirChatJugador('${esc(usuario)}', '${esc(chatId||'')}')" title="Abrir chat con el cliente">
          <span>💬</span> Chat Jugador
        </button>
        ${waLink ? `
          <a class="sol-comm-btn whatsapp" href="${waLink}" target="_blank" title="Contactar por WhatsApp">
            <span>📱</span> WhatsApp Directo
          </a>` : ''}
        <button type="button" class="sol-comm-btn" onclick="window.abrirPerfilJugador && window.abrirPerfilJugador('${esc(usuario)}')" title="Ver historial y perfil CRM del jugador">
          <span>👤</span> Ficha CRM
        </button>
        <button type="button" class="sol-comm-btn" onclick="copiarResumenExpediente()" title="Copia los datos de esta operación (jugador, monto, estado, billetera y titular) listos para pegar en el chat o en WhatsApp">
          <span>📋</span> Copiar datos de la operación
        </button>
      </div>

      <!-- Stepper / Timeline -->
      <div class="sol-stepper">
        <div class="sol-stepper-label">Flujo de la Operación</div>
        <div class="sol-stepper-grid">
${stepperHtml}
        </div>
      </div>
    `;

    // Banner de Rechazo
    if(rechazo){
      html += `
        <div class="sol-rej-banner" style="border-color:${rechazo.color};background:${rechazo.bg}">
          <div class="sol-rej-title" style="color:${rechazo.color}">
            <span>${rechazo.icono}</span>
            <span>Incidencia: [${esc(rechazo.codigo)}] ${esc(rechazo.titulo)}</span>
          </div>
          <div class="sol-rej-msg">
            <b>Mensaje informado:</b><br>
            <i>"${esc(rechazo.mensajeCliente)}"</i>
          </div>
          <div class="sol-rej-action">
            <b>💡 Acción sugerida:</b> ${esc(rechazo.accionSugerida)}
          </div>
          ${titular ? `
            <div style="margin-top:8px">
              <button type="button" class="mini-btn yellow" onclick="expedienteToggleBloqueoTitular('${esc(usuario)}', '${esc(titular)}')">🚫 Bloquear / Desbloquear titular en lista negra</button>
            </div>` : ''}
        </div>
      `;
    }

    // Retiro Parcial (si aplica)
    if(esRetiro){
      const pp = (typeof deps.window?.retiroParcialInfo === 'function')
        ? deps.window.retiroParcialInfo(s)
        : (deps.window?._retiroParcialInfo ? deps.window._retiroParcialInfo(s) : null);
      if(pp && pp.hasProg){
        const pct = Math.min(100, Math.round((pp.pagado / (pp.total || 1)) * 100));
        html += `
          <div style="background:#0e1524;border:1px solid #7c3aed;border-radius:12px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:6px">
              <span style="font-weight:900;color:#c084fc">💸 Progreso de Retiro Parcial:</span>
              <b style="color:#fff">${pct}%</b>
            </div>
            <div style="height:6px;background:#1e293b;border-radius:999px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#a855f7,#ec4899);border-radius:999px"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:6px;color:#94a3b8">
              <span>Pagado: <b style="color:#22c55e">${fmtMoney(pp.pagado)}</b></span>
              <span>Restante: <b style="color:#f59e0b">${fmtMoney(pp.restante)}</b></span>
              <span>Total: <b style="color:#fff">${fmtMoney(pp.total)}</b></span>
            </div>
          </div>
        `;
      }
    }

    // Grid de Datos en 2 Columnas
    html += `
      <div class="sol-cotejo-grid">
        <!-- Columna 1: quien / que -->
        <div class="sol-cotejo-card">
          <div class="sol-cotejo-card-title">
            <span>${esMovChunior ? '🧾 Detalle del movimiento' : '👤 Datos del Jugador'}</span>
            <span class="sol-origin-badge ${esManual ? 'manual' : 'portal'}">${esManual ? 'Manual' : 'Portal'}</span>
          </div>

          <div class="sol-cotejo-row">
            <span class="sol-cotejo-lbl">${esMovChunior ? 'Concepto:' : 'Usuario Casino:'}</span>
            <div class="sol-cotejo-val">
              <b style="color:#fff">${esc(usuario || '—')}</b>
              ${usuario && !esMovChunior ? `<button type="button" class="sol-copy-btn" onclick="expedienteCopiarTexto('${esc(usuario)}')">Copiar</button>` : ''}
            </div>
          </div>

          ${esClave ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Clave nueva:</span>
              <div class="sol-cotejo-val">
                ${claveNueva
                  ? `<b class="mono" style="color:#facc15;font-size:15px">${esc(claveNueva)}</b>
                     <button type="button" class="sol-copy-btn" onclick="expedienteCopiarTexto('${esc(claveNueva)}')">Copiar</button>`
                  : `<span style="color:#f87171">No llegó ninguna clave — se aplica la del sistema</span>`}
              </div>
            </div>` : ''}

          ${esJugador && !esClave ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Titular de cuenta:</span>
              <div class="sol-cotejo-val">
                <span>${esc(titular || '—')}</span>
                ${titular ? `<button type="button" class="sol-copy-btn" onclick="expedienteCopiarTexto('${esc(titular)}')">Copiar</button>` : ''}
              </div>
            </div>` : ''}

          ${esRetiro && destinoDifiere ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Cuenta de cobro del jugador:</span>
              <div class="sol-cotejo-val" style="color:#6ee7b7">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(destino)}</span>
                <button type="button" class="sol-copy-btn" onclick="expedienteCopiarTexto('${esc(destino)}')">Copiar</button>
              </div>
            </div>` : ''}
          ${esCarga && destinoDifiere ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl" style="color:#f59e0b">⚠ Transfirió a otra billetera:</span>
              <div class="sol-cotejo-val" style="color:#fbbf24;border-color:#f59e0b55">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(destino)}</span>
                <button type="button" class="sol-copy-btn" onclick="expedienteCopiarTexto('${esc(destino)}')">Copiar</button>
              </div>
            </div>` : ''}

          ${tieneMonto ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Monto de la operación:</span>
              <div class="sol-cotejo-val" style="color:${tipoColor};font-size:13px;font-weight:900">
                ${fmtMoney(montoDecl)}
              </div>
            </div>` : ''}

          ${telefono ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Teléfono registrado:</span>
              <div class="sol-cotejo-val">
                <span>${esc(deps.window._tel ? deps.window._tel(telefono) : telefono)}</span>
                ${waLink ? `<a href="${waLink}" target="_blank" style="color:#22c55e;font-size:11px;text-decoration:none;font-weight:700">📱 WhatsApp</a>` : ''}
              </div>
            </div>` : ''}

          ${esRetiro && deps.window && deps.window.nodoRetiroHistoriaHtml && (s.solicitud_id || (!esManual && id))
            ? deps.window.nodoRetiroHistoriaHtml(s.solicitud_id || id, esManual ? (s.id || '') : '') : ''}

          ${notas ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Notas de la operación:</span>
              <div style="background:#0b0f19;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;font-size:11px;color:#f1f5f9">
                ${esc(notas)}
              </div>
            </div>` : ''}

          ${mensaje ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Mensaje / Nota:</span>
              <div style="background:#0b0f19;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;font-size:11px;color:#f1f5f9;font-style:italic">
                "${esc(mensaje)}"
              </div>
            </div>` : ''}

          ${comprobanteUrl ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Comprobante adjunto:</span>
              <div class="sol-cotejo-val">
                <a href="${esc(comprobanteUrl)}" target="_blank" class="mini-btn blue" style="text-decoration:none;font-size:10.5px">🖼️ Ver Comprobante</a>
              </div>
            </div>` : ''}
        </div>

        <!-- Columna 2: donde se ejecuto de verdad -->
        <div class="sol-cotejo-card">
          <div class="sol-cotejo-card-title">
            <span>${usaChunior ? '🏢 Billetera & Chunior' : '⚙️ Ejecución'}</span>
            <span style="color:#86efac;font-size:9.5px">Auditoría Operativa</span>
          </div>

          ${usaChunior ? `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Billetera asignada:</span>
              <div class="sol-cotejo-val"${bilVieja ? ' style="border-color:#f59e0b55"' : ''}>
                <b${bilVieja ? ' style="color:#fbbf24"' : ''}>${esc(bilNombre || 'Sin billetera')}</b>
                ${bilAlias ? `<span style="color:#94a3b8;font-size:10.5px">(${esc(bilAlias)})</span>` : ''}
              </div>
            </div>
            ${bilVieja ? `
              <div class="sol-cotejo-row">
                <span class="sol-cotejo-lbl" style="color:#f59e0b">⚠ No refrescó el portal:</span>
                <div class="sol-cotejo-val" style="color:#fbbf24;border-color:#f59e0b55">
                  <span>transfirió a <b>${esc(bilVieja.vieja)}</b>, la activa ahora es <b>${esc(bilVieja.actual)}</b></span>
                </div>
              </div>` : ''}

            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">N° Movimiento Chunior:</span>
              <div class="sol-cotejo-val">
                ${_partesRetiro > 1
                  ? `<span style="color:#c084fc;font-size:11.5px">Uno por cada pago · abajo, en el detalle del retiro</span>`
                  : movId
                  ? `<b class="mono" style="color:#86efac;font-size:13px">N° ${esc(movId)}</b>
                     <button type="button" class="sol-copy-btn" onclick="expedienteCopiarTexto('${esc(movId)}')">Copiar</button>
                     ${histIdParaMov ? `<button type="button" class="mini-btn yellow" style="font-size:10.5px"
                       onclick="expedienteEditarMovimiento('${esc(histIdParaMov)}')"
                       title="Corregir monto o nota. Sólo puede hacerlo el operador que lo anotó, y queda registrado.">✏️ Editar</button>` : ''}`
                  : (abierta
                      ? `<span style="color:#64748b">Todavía no se ejecutó</span>`
                      : `<span style="color:#f59e0b">Sin N° anotado</span>
                         <button type="button" class="mini-btn yellow" style="font-size:10.5px"
                           onclick="expedienteBuscarMovChunior('${esc(histIdParaMov)}','${esc(usuario)}','${montoDecl}','${esc(fechaCreacion||'')}')"
                           title="Busca el movimiento en Chunior por usuario, monto y horario (±2 min) y lo guarda">🔎 Buscar en Chunior</button>`)}
              </div>
            </div>

            ${(_expedienteActualData.fichasPendientes && _partesRetiro <= 1 && saldoPre == null && saldoPost == null) ? `
              <div class="sol-cotejo-row">
                <span class="sol-cotejo-lbl">Fichas del jugador:</span>
                <div class="sol-cotejo-val">
                  <span data-fichas="1">${fichasHtml(fichasEnCache(usuario), montoDecl)}</span>
                </div>
              </div>` : (esCarga || esRetiro) ? `
              <div class="sol-cotejo-row">
                <span class="sol-cotejo-lbl">Saldos en casino:</span>
                <div class="sol-cotejo-val">
                  ${_partesRetiro > 1
                    ? `<span style="color:#c084fc;font-size:11.5px">Los de cada pago · abajo, en el detalle del retiro</span>`
                    : (saldoPre != null || saldoPost != null)
                    ? `<span>Prev: ${saldoPre != null ? fmtMoney(saldoPre) : '—'}</span>
                       <span style="color:#34d399">Post: ${saldoPost != null ? fmtMoney(saldoPost) : '—'}</span>`
                    : (abierta ? `<span style="color:#64748b">Se leen al ejecutar</span>`
                               : `<span style="color:#f59e0b">No quedaron registrados</span>`)}
                </div>
              </div>` : ''}
          ` : `
            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Se ejecuta en:</span>
              <div class="sol-cotejo-val">
                <b style="color:#facc15">${esClave ? 'Agente / Drex' : 'Panel'}</b>
              </div>
            </div>

            <div class="sol-cotejo-row">
              <span class="sol-cotejo-lbl">Movimiento en Chunior:</span>
              <div class="sol-cotejo-val">
                <span style="color:#64748b">No corresponde · ${esClave ? 'un cambio de clave no mueve plata' : 'una consulta no mueve plata'}</span>
              </div>
            </div>
          `}

          <div class="sol-cotejo-row">
            <span class="sol-cotejo-lbl">Operador responsable:</span>
            <div class="sol-cotejo-val">
              <span style="color:#cbd5e1">${esc(operador || 'Sistema')}</span>
            </div>
          </div>

          <div class="sol-cotejo-row">
            <span class="sol-cotejo-lbl">Tipo de origen:</span>
            <div class="sol-cotejo-val">
              <span class="sol-origin-badge ${esManual ? 'manual' : 'portal'}">${esManual ? (esMovChunior ? 'Movimiento Chunior' : 'Operación Manual') : 'Portal Clientes'}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Metadatos Técnicos: solo si hay algo adentro. Un "{}" ocupa lugar y no dice nada. -->
      ${(meta && typeof meta === "object" && Object.keys(meta).length) ? `
        <details style="background:#0b0f19;border:1px solid #1e293b;border-radius:10px;padding:8px 12px;font-size:11px;color:#94a3b8">
          <summary style="cursor:pointer;font-weight:700;color:#cbd5e1">🔧 Contexto técnico (Metadata)</summary>
          <pre class="exp-code-box" style="margin-top:8px">${esc(JSON.stringify(meta, null, 2))}</pre>
        </details>` : ''}
    `;

    return html;
  };

  // ── Fichas del jugador, en el expediente de un RETIRO ───────────────────────────────────────
  // "Ver" en un retiro tiene que decir cuántas fichas tiene el jugador AHORA: es lo que decide si se
  // paga entero, por partes o no se paga (Juan, 25/10). Se lee del casino al abrir, sin tocar nada.
  // La lectura la hace revisarFichasRetiro (core/chunior-recuperacion-y-transferencias.js), la misma
  // que usa el escaneo en segundo plano y que alimenta el "saldo … ✓/⚠" de la tarjeta.
  const _FICHAS_VIVA_MS = 3 * 60 * 1000;           // una lectura de hace menos de 3 min se reusa
  function fichasEnCache(usuario){
    try{
      const c = (deps.window._retiroSaldoCheck || {})[String(usuario||'').toLowerCase()];
      return (c && c.ts && (Date.now() - c.ts) < _FICHAS_VIVA_MS) ? c : null;
    }catch(_e){ return null; }
  }
  function fichasHtml(r, monto, releer){
    const boton = function(texto){
      return '<button type="button" class="sol-copy-btn" onclick="' + (releer || 'expedienteRevisarFichas') + '(true)" title="Vuelve a consultar el saldo en el casino">🔄 ' + texto + '</button>';
    };
    const _btnFichas = boton('Volver a leer');
    if(!r) return '<span style="color:#64748b">Leyendo las fichas…</span>';
    if(r.confiable === false) return '<span style="color:#f59e0b">No pude leer bien el saldo</span> ' + _btnFichas;
    if(r.error) return '<span style="color:#f59e0b">' + esc(r.error) + '</span> ' + boton('Reintentar');
    const pidio = Math.abs(Number(monto || 0));
    const saldo = Number(r.saldo || 0);
    const alcanza = saldo + 0.5 >= pidio;
    const color = alcanza ? '#34d399' : '#f87171';
    return '<b style="color:' + color + ';font-size:13px">' + esc(r.raw || fmtMoney(saldo)) + '</b> '
      + '<span style="color:' + color + '">' + (alcanza
          ? '✓ alcanza para lo que pidió (' + fmtMoney(pidio) + ')'
          : (saldo >= 0.5
              ? '⚠ no alcanza para ' + fmtMoney(pidio) + ' · se puede pagar por partes'
              : '⚠ sin fichas para retirar')) + '</span> ' + _btnFichas;
  }
  function _pintarFichas(html){
    try{
      const nodos = deps.document.querySelectorAll ? deps.document.querySelectorAll('[data-fichas]') : [];
      Array.prototype.forEach.call(nodos, function(n){ n.innerHTML = html; });
    }catch(_e){}
  }
  api.revisarFichasExpediente = async function(forzar){
    const d = _expedienteActualData;
    if(!d || !d.fichasPendientes) return null;
    const leer = deps.window && deps.window.revisarFichasRetiro;
    if(typeof leer !== 'function') return null;
    const monto = Math.abs(Number(d.montoDeclarado || 0));
    const previa = forzar ? null : fichasEnCache(d.usuario);
    if(previa){ _pintarFichas(fichasHtml(previa, monto)); return previa; }
    _pintarFichas(fichasHtml(null, monto));
    let r;
    try{ r = await leer({ usuario: d.usuario, solicitudId: d.id, monto: monto, forzar: !!forzar }); }
    catch(_e){ r = { error: 'No se pudieron leer las fichas. Probá de nuevo.' }; }
    // Mientras leía, el operador pudo cerrar el expediente o abrir otro: no se pisa lo que ve ahora.
    if(!_expedienteActualData || String(_expedienteActualData.id) !== String(d.id)) return r;
    _pintarFichas(fichasHtml(r, monto));
    return r;
  };
  if(deps.window) deps.window.expedienteRevisarFichas = function(forzar){ return api.revisarFichasExpediente(!!forzar); };

  // El cartel de aprobar un retiro coteja las fichas igual que "Ver": misma lectura, mismo texto y
  // botón de reintento. Antes no mostraba ninguna y se aprobaba sin saber si las tenía.
  api.portalJobRevisarFichas = async function(forzar){
    const modal = deps.document.getElementById('portalJobModal');
    const box = deps.document.getElementById('portalJobFichas');
    if(!modal || !box) return null;
    const id = modal.dataset.solicitudId;
    const s = portalSolicitudById(Number(id));
    const esRetiro = !!s && String(s.TIPO || s.TIPO_SOLICITUD || '').toUpperCase() === 'RETIRO';
    box.style.display = esRetiro ? '' : 'none';
    if(!esRetiro) return null;
    const monto = Math.abs(Number(s.MONTO_REAL || s.MONTO_DECLARADO || 0));
    const pintar = function(r){
      box.innerHTML = '<span style="color:#64748b">Cotejo de fichas:</span> ' + fichasHtml(r, monto, 'portalJobRevisarFichas');
    };
    const previa = forzar ? null : fichasEnCache(s.USUARIO);
    if(previa){ pintar(previa); return previa; }
    pintar(null);
    let r;
    try{ r = await deps.window.revisarFichasRetiro({ usuario: s.USUARIO, solicitudId: id, monto: monto, forzar: !!forzar }); }
    catch(_e){ r = { error: 'No se pudieron leer las fichas. Probá de nuevo.' }; }
    // Mientras leía, el operador pudo pasar a otra solicitud: no se pisa lo que ve ahora.
    if(modal.dataset.solicitudId === id) pintar(r);
    return r;
  };

  api.mostrarExpedienteEnPane = function(idOrObj){
    const html = api.construirDossierCompletoHtml(idOrObj);
    const pane = deps.document.getElementById('solicitudesDossierPane');
    if(pane && html){
      pane.innerHTML = html;
      try{ if(deps.window && deps.window.nodoRetiroHistoriaLlenar) deps.window.nodoRetiroHistoriaLlenar(pane); }catch(_e){}
    }
  };

  api.abrirExpedienteSolicitud = function(idOrObj, forzarModal){
    api.mostrarExpedienteEnPane(idOrObj);
    const isMobile = (deps.window?.innerWidth || 1200) < 1080;
    if(forzarModal || isMobile){ try{ expedienteEnsureModal(); }catch(_e){} }
    const modalEl = deps.document.getElementById('modalExpedienteOverlay');
    if(modalEl && (forzarModal || isMobile)){
      const bodyEl = deps.document.getElementById('expedienteBody');
      if(bodyEl){
        bodyEl.innerHTML = api.construirDossierCompletoHtml(idOrObj) || '';
        try{ if(deps.window && deps.window.nodoRetiroHistoriaLlenar) deps.window.nodoRetiroHistoriaLlenar(bodyEl); }catch(_e){}
      }
      modalEl.classList.remove('hidden');
    }
    _anclarCartel();
    // Si es un retiro abierto, "Ver" también revisa las fichas del jugador. Sin await: el expediente
    // ya está a la vista y la lectura se pinta cuando llega.
    try{ api.revisarFichasExpediente(); }catch(_e){}
  };

  api.v154pDetalleSolicitud = api.abrirExpedienteSolicitud;

  if(deps.window){
    deps.window.expedienteCopiarTexto = function(txt){
      // Antes no tenía .catch(): si el portapapeles rechazaba, no copiaba y no avisaba.
      try{ deps.window.nodoCopiar(txt, { etiqueta: '✓ Copiado al portapapeles' }); }catch(_e){}
    };

    deps.window.expedienteAbrirChatJugador = async function(usuario, chatId){
      api.cerrarExpedienteSolicitud();
      const u = String(usuario||'').toLowerCase().trim();
      // Primero ir a la vista de chat: abrir la conversación sin estar en la bandeja deja la
      // pantalla igual y parece que el botón no hizo nada.
      try{ if(typeof deps.window.mostrarVista === 'function') deps.window.mostrarVista('chat'); }catch(_e){}
      // La conversación se busca POR USUARIO. Antes sólo se abría si la solicitud traía chat_id,
      // y las manuales (y muchas del portal) no lo traen: se cambiaba de pantalla, se escribía el
      // nombre en un filtro y ahí terminaba todo. Reportado tal cual: "toco chat del jugador y me
      // abre el apartado pero no me abre el chat con el usuario".
      try{
        if(u && typeof deps.window.ticketsAgrupados === 'function'){
          const t = (deps.window.ticketsAgrupados() || []).find(function(x){
            return String(x.usuario||'').toLowerCase().trim() === u;
          });
          if(t && typeof deps.window.aceptarTicketLocalStep2 === 'function'){
            return deps.window.aceptarTicketLocalStep2(t.id);
          }
        }
      }catch(_e){}
      if(chatId && typeof deps.window.abrirChat === 'function'){
        return deps.window.abrirChat(chatId);
      }
      // No tiene conversación abierta: se le escribe una nueva (D-73). Antes esto terminaba en un
      // cartel de "todavía no se puede", que es lo único que el operador no necesitaba leer.
      if(typeof deps.window.nodoChatNuevo === 'function') return deps.window.nodoChatNuevo(usuario);
      try{ deps.toast((usuario||'Ese jugador') + ' no tiene ninguna conversación abierta', 'yellow'); }catch(_e){}
    };

    deps.window.expedienteToggleBloqueoTitular = function(usuario, titular){
      if(!usuario || !titular) return;
      const bloq = deps.window.titularYaRechazado ? deps.window.titularYaRechazado(usuario, titular) : false;
      if(bloq){
        if(deps.window.desmarcarTitularRechazado) deps.window.desmarcarTitularRechazado(usuario, titular);
        deps.toast(`Desbloqueado titular "${titular}" para ${usuario}`, 'blue');
      } else {
        if(deps.window.marcarTitularRechazado) deps.window.marcarTitularRechazado(usuario, titular, 'BLOQUEADO_POR_OPERADOR');
        deps.toast(`🚫 Titular "${titular}" bloqueado para ${usuario}`, 'yellow');
      }
      api.abrirExpedienteSolicitud(_expedienteActualData ? _expedienteActualData.id : 0);
    };
  }

  return {
    globals: api,
    mostrarExpedienteEnPane: api.mostrarExpedienteEnPane,
    construirDossierCompletoHtml: api.construirDossierCompletoHtml,
    abrirExpedienteSolicitud: api.abrirExpedienteSolicitud,
    cerrarExpedienteSolicitud: api.cerrarExpedienteSolicitud,
    portalParseMonto,
    portalBilleteraPreferida
  };
}
return Object.freeze({ create, dependencies });
});
/* Portal: operation-execution. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalOperationExecution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["_autoregistrarUsuarioSiFalta","_drexGlobalLock","_drexGlobalUnlock","_historialData","_trazaFin","_trazaInit","_trazaPaso","_watchdogTrigger","_wdForceUnlock","_wdLock","_wdUnlock","actualizarSolicitudPortal","ajustarSaldoBilletera","alert","billeteras","callDrex","cargarHistorial","cargarSolicitudesPortal","cerrarPortalJobModal","colaPendientesAdd","confirmarRetiroDuplicado","document","ensureDrexSession","esc","money","normalizar","operador","poblarManualBilletera","portalBilleteraPreferida","refreshAgent","registrarCargaEnChunior","registrarEnHistorial","registrarRetiroEnChunior","renderBillerasInicio","renderSolicitudesPortalEnInicio","setTimeout","supabaseClient","toast","verificarRetiro24h","window"]);
  function create(deps){
const api = {};
  let _portalSolicitudOperacionEnCurso = false;

  function portalNotasBase(ctx){
    const {id, solicitud:s, montoAprobado, titular, destino, cbu, obs} = ctx;
    const notas = ['#'+id];
    // El monto va SOLO si el aprobado difiere del declarado. Cuando son iguales —el 95% de los
    // casos— "Declarado $6.000 / aprobado $6.000" no aporta nada.
    const _dec = Number(s.MONTO_DECLARADO||s.MONTO_REAL||0);
    if(Math.abs(_dec - Number(montoAprobado||0)) > 0.5) notas.push('pidió '+deps.money(_dec)+' · se aprobó '+deps.money(montoAprobado));
    if(titular) notas.push('Titular: '+titular);
    // destino suele traer "BILLETERA · alias". La billetera ya está en su columna: va sólo el alias.
    if(destino){
      const _d = String(destino).split('·').map(function(x){ return x.trim(); }).filter(Boolean);
      notas.push('Alias: '+(_d.length>1 ? _d.slice(1).join(' · ') : _d[0]));
    }
    if(cbu && String(cbu).trim() !== String(destino||'').trim()) notas.push('CBU/CVU: '+cbu);
    if(obs) notas.push('Obs: '+obs);
    return notas.join(' · ');
  }

  async function portalUpdateHistorial(id, patch){
    deps.window.NodoSalud?.begin('PORTAL')?.record('EFFECT','OK','PORTAL_HIST_UPDATE');
    if(!id) return;
    try{ await deps.supabaseClient.from('historial_ops').update(patch).eq('id', id); }
    catch(e){ console.warn('portal historial update falló:', e); }
  }

  
function ultimoSaldoPostUsuarioHistorial(usuario){
  const u = deps.normalizar(usuario || '');
  if(!u) return null;
  // Una pasada, sin copiar y ordenar todo el historial en cada operación.
  let latest = null;
  let latestTime = -Infinity;
  for(const row of deps._historialData || []){
    if(deps.normalizar(row.usuario || '') !== u || row.saldo_post === null
      || row.saldo_post === undefined || row.saldo_post === '' || isNaN(Number(row.saldo_post))) continue;
    const timestamp = new Date(row.created_at || 0).getTime();
    const time = Number.isFinite(timestamp) ? timestamp : 0;
    if(latest === null || time > latestTime){ latest = row; latestTime = time; }
  }
  return latest === null ? null : Number(latest.saldo_post);
}

// ══════════════════════════════════════════════════════════════════════════════
// COLA DE CARGA
// Aprobar y ejecutar eran lo mismo: si el agente estaba ocupado, el panel contestaba
// "esperá a que termine" y no pasaba NADA — el operador tenía que acordarse de volver
// y apretar de nuevo. Y cuando sí salía, no quedaba nada visible entre el clic y el
// resultado: si tardaba, no se sabía si estaba corriendo o si el clic se había perdido.
//
// Ahora aprobar SIEMPRE encola, y la cola se drena sola cuando el agente se libera.
// Un solo camino, siempre a la vista. Como el agente es uno, la cola además serializa:
// es el orden explícito que hoy intentan sostener nueve candados sueltos.
//
// Vive en memoria a propósito: el ctx trae la solicitud entera y serializarla a
// localStorage es frágil. Si se cierra la app con cosas encoladas no se pierde nada —
// la solicitud sigue PENDIENTE en el portal y vuelve a aparecer en la bandeja.
// ══════════════════════════════════════════════════════════════════════════════
  const _colaCarga = [];          // [{cid, ctx, estado:'espera'|'corriendo'}]
  let _colaCargaTimer = null;

  function _colaCargaBox(){
    let box = deps.document.getElementById('colaCargaBox');
    if(box) return box;
    const anchor = deps.document.getElementById('tablaSolicitudesInicio');
    if(!anchor || !anchor.parentElement) return null;
    box = deps.document.createElement('div');
    box.id = 'colaCargaBox';
    box.style.cssText = 'margin-bottom:10px';
    anchor.parentElement.insertBefore(box, anchor);
    return box;
  }
  function _colaCargaRender(){
    // Estado público de la cola: la tarjeta de la solicitud lo muestra EN SU LUGAR, en vez de que
    // la misma carga aparezca dos veces (una acá y otra en pendientes). Esa duplicación es lo que
    // daba la sensación de que la app no estaba haciendo nada hasta que la fila se borraba sola.
    const estado = {};
    _colaCarga.forEach(function(it, i){
      const sid = String((it.ctx && it.ctx.id) || '');
      if(sid) estado[sid] = { estado: it.estado, pos: i+1, cid: it.cid };
    });
    try{ deps.window._colaCargaEstado = estado; }catch(_e){}
    // Repintar la lista para que las tarjetas tomen el estado nuevo. No agrega parpadeo: el render
    // de la lista ya no repinta si el HTML le queda igual.
    // Por deps, no por window: el bridge lo deja acá (Object.assign(deps, service)) y requests-view
    // se monta ANTES que este módulo, así que ya está disponible. En window vive con otro nombre.
    try{
      const _repintar = deps.renderSolicitudesPortalEnInicio
                     || deps.window.v154pRenderSolicitudesPortalEnInicio;
      if(typeof _repintar === 'function') _repintar();
    }catch(_e){}

    const box = _colaCargaBox(); if(!box) return;
    // Acá abajo sólo quedan las que NO están a la vista en pendientes (la lista muestra 8). Antes
    // se dibujaban TODAS, y este bloque —que vive ARRIBA de la lista— aparecía y desaparecía
    // empujando todo hacia abajo y de vuelta arriba, justo cuando el operador iba a apretar
    // "Aprobar" en la tarjeta de al lado. De ahí que el clic terminara desfasado.
    const sueltas = _colaCarga.filter(function(it){
      const sid = String((it.ctx && it.ctx.id) || '');
      return !(sid && deps.document.getElementById('v154pCard' + sid));
    });
    if(!sueltas.length){ box.innerHTML=''; box.style.display='none'; return; }
    box.style.display='block';
    const filas = sueltas.map(function(it){
      const i = _colaCarga.indexOf(it);
      const c = it.ctx || {};
      const corriendo = it.estado==='corriendo';
      const tipo = String(c.tipo||'CARGA').toUpperCase();
      return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid '
        + (corriendo?'#22c55e':'#7cc4ff') + ';border-radius:10px;padding:9px 12px;margin-top:6px;'
        + 'display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
        + '<span style="font-size:11px;font-weight:900;border-radius:999px;padding:2px 9px;'
        +   (corriendo
              ? 'background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.35)">⚙ Cargando…'
              : 'background:rgba(124,196,255,.12);color:#7cc4ff;border:1px solid rgba(124,196,255,.35)">🕒 '+(i+1)+'º en la cola')
        + '</span>'
        + '<b style="font-size:14px;color:#f0f6fc">'+deps.esc(c.usuario||'—')+'</b>'
        + '<b style="font-size:15px;color:#f5c518">'+deps.money(c.montoAprobado||0)+'</b>'
        + '<span style="font-size:11px;color:#8b949e">'+tipo+' · sol. #'+deps.esc(String(c.id||''))+'</span>'
        + (corriendo ? '' :
            '<button class="mini-btn" style="margin-left:auto;background:transparent;border:1px solid #7f1d1d;'
            + 'color:#fca5a5;font-size:11px" onclick="colaCargaQuitar(\''+it.cid+'\')">Sacar de la cola</button>')
        + '</div>';
    }).join('');
    box.innerHTML = '<div style="font-size:11px;font-weight:800;color:#8b949e;text-transform:uppercase;'
      + 'letter-spacing:.5px;margin:2px 2px 0">En cola para cargar · '+sueltas.length+'</div>' + filas;
  }
  // Sacar de la cola NO rechaza la solicitud: sólo la desencola. Vuelve a quedar en la
  // bandeja como estaba, para aprobarla de nuevo cuando se quiera.
  api.colaCargaQuitar = function(cid){
    const i = _colaCarga.findIndex(function(x){ return x.cid===cid; });
    if(i<0) return;
    if(_colaCarga[i].estado==='corriendo'){ deps.toast('Esa ya está corriendo, no se puede sacar.','yellow'); return; }
    const it = _colaCarga.splice(i,1)[0];
    _colaCargaRender();
    deps.toast('Sacada de la cola · '+((it.ctx&&it.ctx.usuario)||''),'yellow');
  };

  function _agenteLibre(){
    try{
      if(_portalSolicitudOperacionEnCurso) return false;
      if(deps.window._drexGlobalBusy) return false;
      if(deps.window._v154pParcialBusy) return false;
      if(deps.window._operacionManualEnCurso) return false;
      const w = deps.window._watchdog;
      if(w && w.busy > 0) return false;
      const cola = deps.window._drexCola;
      if(cola && (cola.activo || cola.pendientes > 0)) return false;
    }catch(_e){}
    return true;
  }
  async function _colaCargaTick(){
    if(!_colaCarga.length) return;
    if(_colaCarga.some(function(x){ return x.estado==='corriendo'; })) return;   // de a una
    if(!_agenteLibre()) return;                                                  // el agente es uno solo
    const it = _colaCarga[0];
    it.estado = 'corriendo';
    _colaCargaRender();
    try{ await _ejecutarSolicitudAhora(it.ctx); }
    catch(e){ console.warn('[cola carga]', e); }
    finally{
      const i = _colaCarga.indexOf(it);
      if(i>=0) _colaCarga.splice(i,1);
      _colaCargaRender();
    }
  }
  function _colaCargaArrancar(){
    if(_colaCargaTimer) return;
    _colaCargaTimer = setInterval(function(){ _colaCargaTick(); }, 2500);
  }

  // Punto de entrada de "Aprobar": encola y devuelve enseguida. El operador puede seguir
  // trabajando; la cola se ocupa del resto.
  async function ejecutarSolicitudPortalSimple(ctx){
    if(!deps.window.ctrlElectron){ deps.alert('La automatización solo funciona en la app de escritorio.'); return; }
    const _id = String((ctx&&ctx.id)||'');
    if(_colaCarga.some(function(x){ return String((x.ctx&&x.ctx.id)||'')===_id; })){
      deps.toast('Esa solicitud ya está en la cola.','yellow');
      return;
    }
    _colaCarga.push({ cid:'cc'+Date.now()+Math.random().toString(36).slice(2,6), ctx:ctx, estado:'espera' });
    _colaCargaRender();
    _colaCargaArrancar();
    try{ deps.cerrarPortalJobModal && deps.cerrarPortalJobModal(); }catch(_e){}
    deps.toast(_colaCarga.length>1
      ? ('🕒 En cola · '+(_colaCarga.length-1)+' adelante')
      : '🕒 En cola · se carga en un momento', 'blue');
    _colaCargaTick();     // si el agente está libre, arranca ya
  }

async function _ejecutarSolicitudAhora(ctx){
    // PORTAL SAFE V3: mismo motor estable que operación manual, pero origen LANDING.
    // No usa buscarUsuarioDrex ni funciones nuevas. Usa callDrex(), registrarEnHistorial(),
    // registrarCarga/RetiroEnChunior() y ajustarSaldoBilletera() ya probadas.
    if(_portalSolicitudOperacionEnCurso){ deps.toast('Hay una operación portal en curso. Esperá que termine.', 'yellow'); return; }
    if(!deps.window.ctrlElectron){ deps.alert('La automatización solo funciona en la app de escritorio.'); return; }
    if(!deps._drexGlobalLock('portal')){
      deps.toast('Hay otra operación corriendo en Agentes ahora mismo (manual u otra). Esperá a que termine.', 'yellow');
      return;
    }

    const {id, usuario, tipo, montoAprobado:montoAbs, bilId} = ctx;
    const bil = (deps.billeteras || []).find(b => String(b.ID_BILLETERA) === String(bilId)) || deps.portalBilleteraPreferida(ctx.solicitud);
    const _esMiModal = function(){
      try{
        const m = deps.document.getElementById('portalJobModal');
        return !!(m && m.style.display !== 'none'
               && Number(m.dataset && m.dataset.solicitudId) === Number(id));
      }catch(_e){ return false; }
    };
    const _pintarEn = function(idEl, html){
      if(!_esMiModal()) return;
      const e = deps.document.getElementById(idEl);
      if(e) e.innerHTML = html;
    };
    const res = { set innerHTML(v){ _pintarEn('portalJobResultado', v); } };
    const _btnEl = function(){ return _esMiModal() ? deps.document.getElementById('portalJobEnviarBtn') : null; };
    const btn = {
      set disabled(v){ const e=_btnEl(); if(e) e.disabled = v; },
      set textContent(v){ const e=_btnEl(); if(e) e.textContent = v; },
      get style(){ const e=_btnEl(); return e ? e.style : {}; }
    };

    _portalSolicitudOperacionEnCurso = true;
    if(btn){ btn.disabled = true; btn.style.opacity = '.65'; btn.textContent = 'Operando...'; }
    // Marcar la fila QUE SE ESTÁ OPERANDO y bloquear las demás. El guard ya evitaba la doble
    // ejecución, pero no se veía: apretabas, no pasaba nada visible, apretabas de nuevo y recién
    // ahí te saltaba un toast amarillo. Ahora la tarjeta muestra que está trabajando y las otras
    // acciones quedan apagadas mientras tanto.
    try{
      deps.document.body.classList.add('op-portal-en-curso');
      deps.document.body.dataset.opSolicitud = String(id);
    }catch(_e){}
    deps._trazaInit((tipo==='CARGA'?'Carga':'Retiro')+' PORTAL · '+usuario+' · '+deps.money(montoAbs)+' (sol. #'+id+')');

    const liberar = () => {
      _portalSolicitudOperacionEnCurso = false;
      try{ deps.document.body.classList.remove('op-portal-en-curso'); delete deps.document.body.dataset.opSolicitud; }catch(_e){}
      deps._drexGlobalUnlock();
      deps._wdForceUnlock(); // libera el candado del watchdog tomado al arrancar (mismo fix que en manual)
      if(btn){ btn.disabled = false; btn.style.opacity = ''; btn.textContent = 'Aprobar'; }
      try{ if(deps.window._traza && !deps.window._traza.fin && deps.window._traza.pasos && deps.window._traza.pasos.length){ deps._trazaFin('err'); } }catch(_e){}
    };

    try{
      // Mismo fix que en la carga manual: candado del watchdog para TODA la secuencia
      // (sesión + búsqueda + carga), sin huecos — evita que un check ya programado del
      // watchdog refresque la página de Agentes justo cuando se está por aplicar.
      deps._wdLock();
      if(res) res.innerHTML = '<div class="alert-box" style="padding:8px 10px">Operando en Agentes...</div>';
      await deps.actualizarSolicitudPortal(id, 'EN_PROCESO', {etapa:'PORTAL_OPERANDO_PANEL', monto_aprobado:montoAbs, titular:ctx.titular, destino:ctx.destino, cbu:ctx.cbu, observacion:ctx.obs});

      if(tipo === 'RETIRO'){
        const check = await deps.verificarRetiro24h(usuario);
        if(check.bloqueado){
          const proceder = await deps.confirmarRetiroDuplicado(check);
          if(!proceder){
            await deps.actualizarSolicitudPortal(id, 'EN_REVISION', {etapa:'PORTAL_CANCELADA_RETIRO_24H'});
            if(res) res.innerHTML = '<div class="alert-box" style="padding:8px 10px">Retiro detenido para revisión.</div>';
            return;
          }
        }
      }

      deps.toast('Portal: abriendo backoffice...', 'blue');
      deps._trazaPaso('Abriendo sesión de Agentes...');
      if(!await deps.ensureDrexSession()){
        await deps.actualizarSolicitudPortal(id, 'EN_REVISION', {etapa:'PORTAL_SIN_SESION_AGENTES'});
        if(res) res.innerHTML = '<div class="err-box" style="padding:8px 10px">Abrí la sesión de Agentes y reintentá.</div>';
        deps._trazaPaso('Falta sesión de Agentes','err'); deps._trazaFin('err');
        return;
      }
      deps._trazaPaso('Sesión de Agentes lista','ok');

      deps.toast('Portal: buscando '+usuario+'...', 'blue');
      deps._trazaPaso('Buscando '+usuario+' en Agentes...');
      deps._wdLock();
      let busqueda;
      try{
        busqueda = await deps.callDrex('buscarUsuario', usuario, { skipBalance: false });
      }finally{
        deps._wdUnlock();
      }

      // Distinguir un error de página (403/CDN) o sesión caída de un "usuario no existe" real.
      // Antes ambos caían en el mismo mensaje engañoso "Usuario no encontrado". Acá la solicitud
      // queda EN_REVISION (no ERROR_OPERATIVO) para que se pueda reintentar sin marcarla mal.
      if(busqueda && (busqueda.pageError || busqueda.needsLogin)){
        const _motivo = busqueda.pageError ? 'Error de página en Agentes (403/CDN)' : 'Sesión de agentes caída';
        await deps.actualizarSolicitudPortal(id, 'EN_REVISION', {etapa: busqueda.pageError ? 'PORTAL_PAGE_ERROR_BUSCAR' : 'PORTAL_SESION_CAIDA_BUSCAR'});
        if(res) res.innerHTML = '<div class="err-box" style="padding:8px 10px">'+deps.esc(_motivo)+' · no se operó. '+(busqueda.needsLogin?'Reingresá credenciales':'Reintentá')+' y volvé a aprobar.</div>';
        deps.toast('Portal: '+_motivo+' · reintentá', 'red');
        deps._trazaPaso(_motivo+' · no se operó','err'); deps._trazaFin('err');
        await deps.cargarSolicitudesPortal(true);
        return;
      }

      if(!busqueda || !busqueda.exists){
        const _fh = await deps.registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'LANDING', estado:'ERROR', notas:portalNotasBase(ctx)+' · Usuario no encontrado'});
        await deps.actualizarSolicitudPortal(id, 'ERROR_OPERATIVO', {etapa:'PORTAL_USUARIO_NO_ENCONTRADO', monto_aprobado:montoAbs});
        if(res) res.innerHTML = '<div class="err-box" style="padding:8px 10px">Usuario no encontrado.</div>';
        deps._trazaPaso(usuario+' NO existe en Agentes','err'); deps._trazaFin('err', _fh&&_fh.id);
        await deps.cargarHistorial();
        await deps.cargarSolicitudesPortal(true);
        return;
      }
      deps._trazaPaso(usuario+' encontrado'+(busqueda.balance?.raw?(' · saldo '+busqueda.balance.raw.trim()):''), 'ok');
      // Cancelación segura antes de aplicar (todavía no se tocó plata).
      if(deps.window._traza && deps.window._traza.cancelada){
        await deps.actualizarSolicitudPortal(id, 'EN_REVISION', {etapa:'PORTAL_CANCELADA_OPERADOR'});
        if(res) res.innerHTML = '<div class="alert-box" style="padding:8px 10px">⛔ Cancelada antes de aplicar. No se tocó nada en el casino.</div>';
        deps._trazaFin('warn'); deps.toast('Portal: cancelada', 'yellow');
        await deps.cargarSolicitudesPortal(true); return;
      }

      // Mismo criterio que operación manual: para retiro solo bloqueamos si el saldo leído es confiable.
      if(tipo === 'RETIRO'){
        const saldoRaw = String(busqueda.balance?.raw || '');
        const saldo = busqueda.balance?.value ?? null;
        const saldoConfiable = /\d/.test(saldoRaw) && typeof saldo === 'number' && Number.isFinite(saldo);
        if(saldoConfiable && saldo >= 0 && saldo < montoAbs){
          await deps.registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'LANDING', estado:'ERROR', notas:portalNotasBase(ctx)+' · Saldo insuficiente'});
          await deps.actualizarSolicitudPortal(id, 'ERROR_OPERATIVO', {etapa:'PORTAL_SALDO_INSUFICIENTE', monto_aprobado:montoAbs});
          if(res) res.innerHTML = '<div class="err-box" style="padding:8px 10px">Saldo insuficiente: '+deps.esc(busqueda.balance?.raw||'')+'</div>';
          await deps.cargarHistorial();
          await deps.cargarSolicitudesPortal(true);
          return;
        }
      }

      // BONO: se calcula ANTES de la carga para poder mandarlo en la MISMA operación.
      // BET300 tiene un campo "Bono" propio y lo registra como "Bono jugador" (distinto de
      // "Deposito de un jugador"). Casinodrex no lo tiene → ahí el preload ignora la opción,
      // devuelve bonoAplicado:0 y se sigue haciendo la segunda carga de siempre.
      const _bonoCalc = (function(){
        if(tipo !== 'CARGA' || !ctx.bonoAplicar || !(Number(ctx.bonoPct) > 0)) return { monto:0 };
        // Sin billetera PROMO no podríamos anotar el bono en Chunior ni en historial_ops. Si
        // igual lo mandáramos en el campo Bono, entraría plata sin registrar → mejor no mandarlo
        // y que el bloque de abajo avise, que es el comportamiento que ya existía.
        const _hayPromo = (deps.billeteras||[]).some(b => String(b.ID_BILLETERA) === String(ctx.promoBilleteraId))
                       || (deps.billeteras||[]).some(b => /promo/i.test(String(b.NOMBRE_VISIBLE||'')));
        if(!_hayPromo) return { monto:0 };
        const sinTope = Math.round(montoAbs * Number(ctx.bonoPct) / 100);
        const tope    = Number(ctx.bonoMax) || 0;
        const monto   = (tope > 0) ? Math.min(sinTope, tope) : sinTope;
        return { monto, sinTope, tope, topeAplicado: monto < sinTope };
      })();

      deps.toast(tipo === 'CARGA' ? 'Portal: cargando '+deps.money(montoAbs)+'...' : 'Portal: retirando '+deps.money(montoAbs)+'...', 'blue');
      deps._trazaPaso((tipo==='CARGA'?'Cargando ':'Retirando ')+deps.money(montoAbs)+' en Agentes...');
      deps._wdLock();
      let resultado;
      try{
        resultado = tipo === 'CARGA'
          ? await deps.callDrex('cargarSaldo', montoAbs, { bono: _bonoCalc.monto })
          : await deps.callDrex('retirarSaldo', montoAbs);
      }catch(e){
        resultado = {ok:false, message:e.message || 'Error en Agentes'};
      }finally{
        deps._wdUnlock();
      }

      const ok = resultado && resultado.ok !== false;
      const saldoPreCasino = (typeof resultado?.previousBalance?.value === 'number' && !resultado?.previousBalance?.unchanged) ? resultado.previousBalance.value : null;
      const saldoPostCasino = (typeof resultado?.newBalance?.value === 'number' && !resultado?.newBalance?.unchanged) ? resultado.newBalance.value : null;
      let saldoPre = saldoPreCasino !== null ? saldoPreCasino : ((typeof busqueda.balance?.value === 'number') ? busqueda.balance.value : null);
      let saldoPost = saldoPostCasino !== null ? saldoPostCasino : ((ok && saldoPre !== null) ? saldoPre + (tipo === 'CARGA' ? montoAbs : -montoAbs) : null);
      let saldoFuente = saldoPost !== null ? 'DREX' : '';

      // Si Drex no devolvió saldo confiable, hacemos una lectura fresca post-operación.
      if(ok && saldoPost === null){
        try{
          const postRead = await deps.callDrex('buscarUsuario', usuario, { skipBalance:false });
          if(typeof postRead?.balance?.value === 'number'){
            saldoPost = postRead.balance.value;
            saldoPre = tipo === 'CARGA' ? saldoPost - montoAbs : saldoPost + montoAbs;
            saldoFuente = 'LECTURA_POST';
          }
        }catch(_e){}
      }

      // Último resguardo: si Agentes no devolvió saldo pero el historial tiene saldo previo
      // para el mismo usuario, calculamos igual para que el flujo PORTAL quede limpio.
      if(ok && saldoPost === null){
        const ultimoSaldo = ultimoSaldoPostUsuarioHistorial(usuario);
        if(ultimoSaldo !== null){
          saldoPre = ultimoSaldo;
          saldoPost = tipo === 'CARGA' ? ultimoSaldo + montoAbs : ultimoSaldo - montoAbs;
          saldoFuente = 'HISTORIAL_PREVIO';
        }
      }

      const notas = ok ? (portalNotasBase(ctx)+' · '+(resultado?.previousBalance?.raw || resultado?.newBalance?.raw || busqueda.balance?.raw || (saldoFuente ? 'Saldo '+saldoFuente : 'OK Agentes'))) : (portalNotasBase(ctx)+' · '+(resultado?.message || 'error'));

      const filaHist = await deps.registrarEnHistorial({
        usuario, tipo, monto:montoAbs,
        billetera_id:bil?bil.ID_BILLETERA:null,
        billetera_nombre:bil?bil.NOMBRE_VISIBLE:null,
        origen:'LANDING',
        estado:ok?'OK':'ERROR',
        notas,
        chunior_movimiento_id:null,
        saldo_post:saldoPost,
        saldo_pre:saldoPre,
        solicitud_id:id
      });

      if(ok){
        // Si el insert mínimo del historial salió sin saldo_post por schema/cache,
        // intentamos completar la fila por update directo.
        if(filaHist && filaHist.id){
          try{
            await deps.supabaseClient.from('historial_ops')
              .update({
                saldo_pre:saldoPre,
                saldo_post:saldoPost,
                solicitud_id:id,
                operador: deps.operador?.usuario || deps.operador?.nombre || 'panel',
                billetera_id: bil?bil.ID_BILLETERA:null,
                billetera_nombre: bil?bil.NOMBRE_VISIBLE:null
              })
              .eq('id', filaHist.id);
          }catch(_e){}
        }
        if(bil && bil.ID_BILLETERA) await deps.ajustarSaldoBilletera(bil.ID_BILLETERA, tipo === 'CARGA' ? montoAbs : -montoAbs);
        const estadoFinal = tipo === 'RETIRO' ? 'PAGADA' : 'ACREDITADA';
        await deps.actualizarSolicitudPortal(id, estadoFinal, {
          etapa:'PORTAL_COMPLETADA_PANEL',
          monto_aprobado:montoAbs,
          historial_id:filaHist?.id||null,
          saldo_pre:saldoPre,
          saldo_post:saldoPost,
          operador: deps.operador?.usuario || deps.operador?.nombre || 'panel',
          billetera_id: bil?bil.ID_BILLETERA:null,
          billetera_nombre: bil?bil.NOMBRE_VISIBLE:null
        });
        if(res) res.innerHTML = '<div class="ok-box" style="padding:8px 10px">✅ '+tipo+' portal de '+deps.money(montoAbs)+' completada. Historial: LANDING.</div>';
        deps.toast(tipo+' portal OK: '+usuario+' · '+deps.money(montoAbs), 'green');
        deps._trazaPaso((tipo==='CARGA'?'Carga':'Retiro')+' aplicado en Agentes'+(saldoPost!=null?(' · saldo '+deps.money(saldoPost)):''), 'ok'); deps._trazaFin('ok', filaHist&&filaHist.id);

        // Chunior en background, igual que manual: no bloquea el flujo ni la próxima operación.
        if(bil && bil.CHUNIOR_UID){
          const chuPromise = tipo === 'CARGA'
            ? deps.registrarCargaEnChunior(bil.CHUNIOR_UID, montoAbs, usuario)
            : deps.registrarRetiroEnChunior(bil.CHUNIOR_UID, montoAbs, usuario);
          chuPromise.then(async function(rChu){
            if(rChu && rChu.ok && rChu.movimientoId){
              deps.toast('📋 '+tipo+' Chunior N° '+rChu.movimientoId, 'blue');
              if(filaHist && filaHist.id){
                try{
                  await deps.supabaseClient.from('historial_ops').update({chunior_movimiento_id:rChu.movimientoId}).eq('id', filaHist.id);
                  if(typeof deps.cargarHistorial === 'function') await deps.cargarHistorial();
                }catch(e){ console.warn('update chunior_movimiento_id portal falló:', e); }
              }
              deps._watchdogTrigger(1500);
            }else if(rChu && rChu.ok && !rChu.movimientoId){
              // Igual que en manual: Chunior aceptó pero no pudimos leer el N° — marcar en
              // notas para no dejar una false alarm de "no registrado" en el historial.
              deps.toast('📋 '+tipo+' anotado en Chunior (sin N° confirmado)', 'blue');
              if(filaHist && filaHist.id){
                try{
                  const notaMarcaP = (String(notas||'').trim()+' [CHUNIOR_OK_SIN_N]').trim();
                  await deps.supabaseClient.from('historial_ops').update({notas:notaMarcaP}).eq('id', filaHist.id);
                  if(typeof deps.cargarHistorial === 'function') await deps.cargarHistorial();
                }catch(e){ console.warn('update notas [CHUNIOR_OK_SIN_N] portal falló:', e); }
              }
              deps._watchdogTrigger(1500);
            }else if(rChu && rChu.error){
              deps.toast('⚠️ '+tipo+' OK en Agentes pero falló Chunior: '+rChu.error, 'red');
              // La plata ya se movió: la anotación queda pendiente y se reintenta sola cuando
              // Chunior vuelva. Antes se perdía y el operador se enteraba recién al cotejar.
              try{ deps.window.chuniorPendienteAdd({ tipo:tipo, uid:bil.CHUNIOR_UID, monto:montoAbs, usuario:usuario, histId:filaHist?.id||null, motivo:rChu.error }); }catch(_e){}
            }
          }).catch(function(e){
            deps.toast('⚠️ Error registrando en Chunior: '+(e.message||''), 'red');
            try{ deps.window.chuniorPendienteAdd({ tipo:tipo, uid:bil.CHUNIOR_UID, monto:montoAbs, usuario:usuario, histId:filaHist?.id||null, motivo:e.message||'excepción' }); }catch(_e){}
          });
        }
        // ── Bono de primer ingreso: 2da carga en la billetera PROMO (Chunior la audita aparte) ──
        if(tipo === 'CARGA' && ctx.bonoAplicar && Number(ctx.bonoPct)>0){
          try{
            // TOPE del bono: el % se lo gana el usuario (push/app), pero el MONTO tiene techo.
            // Sin esto una carga de $520.000 al 50% regalaba $260.000 — el % se aplicaba puro.
            // El tope lo manda la RPC (bono_max); si no viene, se respeta el comportamiento viejo.
            // El cálculo ya se hizo ANTES de la carga (_bonoCalc) para poder mandarlo en la misma
            // operación; acá solo se reusa para no calcularlo dos veces y que no puedan divergir.
            const bonoMonto     = _bonoCalc.monto;
            const _topeAplicado = !!_bonoCalc.topeAplicado;
            // ¿El bono ya viajó en la carga principal (campo "Bono" de BET300)? Entonces NO hay
            // que hacer la segunda carga en Agentes — pero sí se sigue anotando por separado en
            // Chunior y en historial_ops, que es como se lleva la contabilidad.
            const _bonoNativo   = Number(resultado && resultado.bonoAplicado) || 0;
            const _notaBono     = 'Bono primer ingreso '+ctx.bonoPct+'% sobre '+deps.money(montoAbs)
                                + (_topeAplicado ? (' · TOPE '+deps.money(_bonoCalc.tope)+' (sin tope hubiera sido '+deps.money(_bonoCalc.sinTope)+')') : '')
                                + (_bonoNativo > 0 ? ' · campo Bono' : '')
                                + ' · solicitud #'+id;
            const bilPromo = (deps.billeteras||[]).find(b => String(b.ID_BILLETERA) === String(ctx.promoBilleteraId))
                           || (deps.billeteras||[]).find(b => /promo/i.test(String(b.NOMBRE_VISIBLE||'')));
            if(bonoMonto>0 && bilPromo){
              let rb, _bonoPre = null, _bonoPost = null;
              if(_bonoNativo > 0){
                // Ya entró junto con la carga: nada que pedirle al agente.
                deps.toast('🎁 Bono '+ctx.bonoPct+'% ('+deps.money(bonoMonto)+')'+(_topeAplicado?' — TOPE aplicado':'')+' incluido en la carga', 'green');
                deps._trazaPaso('Bono '+deps.money(bonoMonto)+' incluido en la misma operación (campo Bono)');
                rb = { ok:true, incluido:true };
                // El saldo post de la operación ya trae monto + bono; el "pre" del bono es ese
                // total menos el bono. Si no hay lectura confiable, quedan en null (no inventamos).
                if(typeof resultado?.newBalance?.value === 'number' && !resultado?.newBalance?.unchanged){
                  _bonoPost = resultado.newBalance.value;
                  _bonoPre  = _bonoPost - bonoMonto;
                }
              } else {
                deps.toast('🎁 Cargando bono '+ctx.bonoPct+'% ('+deps.money(bonoMonto)+')'+(_topeAplicado?' — TOPE aplicado':'')+' en '+(bilPromo.NOMBRE_VISIBLE||'PROMO')+'...', 'blue');
                deps._wdLock();
                try{
                  await deps.callDrex('buscarUsuario', usuario, { skipBalance: true });   // re-seleccionar al jugador
                  rb = await deps.callDrex('cargarSaldo', bonoMonto);
                }catch(eb){ rb = {ok:false, message:eb.message}; }
                finally{ deps._wdUnlock(); }
                _bonoPre = (typeof rb?.previousBalance?.value === 'number') ? rb.previousBalance.value : null;
                _bonoPost = (typeof rb?.newBalance?.value === 'number' && !rb?.newBalance?.unchanged)
                  ? rb.newBalance.value
                  : ((rb && rb.ok !== false) && _bonoPre!==null ? _bonoPre + bonoMonto : null);
              }
              const okBono = rb && rb.ok !== false;
              // El saldo_post de ESTA fila es la línea de base para detectar el bono no jugado
              // (Δ entre este saldo y el que haya al pedir el retiro). Dejamos anotado si salió
              // de una LECTURA real o de una cuenta: una base estimada arrastra su error al Δ,
              // y ese error puede liberar un bono que nunca se jugó. Sin esta marca, después no
              // hay forma de saber de qué filas fiarse.
              const _fuenteSaldo = (_bonoNativo > 0) ? (resultado && resultado.newBalance) : (rb && rb.newBalance);
              const _marcaBase = (_bonoPost == null) ? ' [BASE_SIN_DATO]'
                               : (_fuenteSaldo && _fuenteSaldo.leido) ? ' [BASE_LEIDA]'
                               : (_fuenteSaldo && _fuenteSaldo.estimated) ? ' [BASE_ESTIMADA]' : '';
              const filaBono = await deps.registrarEnHistorial({
                usuario, tipo:'CARGA', monto:bonoMonto,
                billetera_id: bilPromo.ID_BILLETERA, billetera_nombre: bilPromo.NOMBRE_VISIBLE||'PROMO',
                origen:'PROMO_BONO', estado: okBono?'OK':'ERROR',
                notas:_notaBono+_marcaBase,
                solicitud_id:id, saldo_pre:_bonoPre, saldo_post:_bonoPost
              });
              if(okBono){
                if(filaBono && filaBono.id){ try{ await deps.supabaseClient.from('historial_ops').update({saldo_pre:_bonoPre, saldo_post:_bonoPost}).eq('id', filaBono.id); }catch(_e){} }
                try{ await deps.ajustarSaldoBilletera(bilPromo.ID_BILLETERA, bonoMonto); }catch(_e){}
                try{ if(deps.window.jugadorRegistrarDato) deps.window.jugadorRegistrarDato(usuario, { bono:{estado:'APLICADO', pct:ctx.bonoPct, monto:bonoMonto} }); }catch(_e){}
                deps.toast('🎁 Bono '+ctx.bonoPct+'% acreditado: '+deps.money(bonoMonto), 'green');
                if(bilPromo.CHUNIOR_UID){
                  deps.registrarCargaEnChunior(bilPromo.CHUNIOR_UID, bonoMonto, usuario).then(async function(rChu){
                    if(rChu && rChu.ok && rChu.movimientoId && filaBono && filaBono.id){
                      try{ await deps.supabaseClient.from('historial_ops').update({chunior_movimiento_id:rChu.movimientoId}).eq('id', filaBono.id); }catch(_e){}
                    } else if(rChu && rChu.ok && !rChu.movimientoId && filaBono && filaBono.id){
                      // Chunior aceptó el bono pero no pudimos leer el N° → marcar [CHUNIOR_OK_SIN_N] para que el
                      // historial NO lo muestre como "no registrado" (mismo criterio que la carga del jugador).
                      try{ await deps.supabaseClient.from('historial_ops').update({notas:_notaBono+' [CHUNIOR_OK_SIN_N]'}).eq('id', filaBono.id); }catch(_e){}
                    }
                  }).catch(function(){});
                }
              } else {
                deps.toast('⚠️ El bono no se cargó en Agentes: '+((rb&&rb.message)||'sin detalle')+' — cargalo a mano.', 'red');
              }
            } else if(!bilPromo){
              deps.toast('⚠️ No encontré la billetera PROMO — el bono no se cargó.', 'red');
            }
          }catch(eb){ console.warn('[bono]', eb); deps.toast('⚠️ Error con el bono: '+(eb.message||''), 'red'); }
        }
        if(tipo === 'CARGA' && busqueda?.user){ try{ deps._autoregistrarUsuarioSiFalta(busqueda.user); }catch(_e){} }
        // Cerrar SOLO si el modal sigue siendo el de ESTA solicitud. La operación corre en segundo
        // plano: para cuando esto dispara, el operador ya abrió el modal de la SIGUIENTE carga —
        // y le cerrábamos ese, en la cara, mientras lo estaba completando.
        deps.setTimeout(()=>{
          try{
            const _m = deps.document.getElementById('portalJobModal');
            if(_m && Number(_m.dataset && _m.dataset.solicitudId) === Number(id)) deps.cerrarPortalJobModal();
          }catch(_e){}
        }, 450);
      }else{
        await deps.actualizarSolicitudPortal(id, 'ERROR_OPERATIVO', {etapa:'PORTAL_ERROR_AGENTES', monto_aprobado:montoAbs, historial_id:filaHist?.id||null, error:resultado?.message||'error'});
        try{ if(typeof deps.colaPendientesAdd==='function') deps.colaPendientesAdd({ clase:'CARGA', usuario, monto:montoAbs, motivo:resultado?.message||'error', solicitudId:id, billeteraNombre:(bil&&(bil.NOMBRE_VISIBLE||bil.NOMBRE))||'', titular:ctx.titular||'', destino:ctx.destino||'', cbu:ctx.cbu||'', obs:ctx.obs||'', posibleAplicada:/timeout|tard[oó] demasiado/i.test(String(resultado?.message||'')) }); }catch(_e){}
        if(res) res.innerHTML = '<div class="err-box" style="padding:8px 10px">Error en Agentes: '+deps.esc(resultado?.message||'sin detalle')+'</div>';
        deps._trazaPaso('Agentes: no se pudo aplicar · '+(resultado?.message||'error'),'err'); deps._trazaFin('err', filaHist&&filaHist.id);
        deps.toast('Portal con error · revisar', 'red');
      }

      try{ await deps.window.ctrlElectron.navigateAgent(); }catch(e){}
      await deps.cargarHistorial();
      await deps.cargarSolicitudesPortal(true);
      try{ await deps.refreshAgent(); }catch(e){}
      try{ deps.renderBillerasInicio(); deps.poblarManualBilletera(); }catch(e){}
    }catch(e){
      const _fh = await deps.registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'LANDING', estado:'ERROR', notas:'Solicitud portal #'+id+' · '+(e.message||'excepción'), solicitud_id:id});
      await deps.actualizarSolicitudPortal(id, 'ERROR_OPERATIVO', {etapa:'PORTAL_EXCEPCION', error:e.message||String(e), monto_aprobado:montoAbs});
      try{ if(typeof deps.colaPendientesAdd==='function' && tipo==='CARGA') deps.colaPendientesAdd({ clase:'CARGA', usuario, monto:montoAbs, motivo:e.message||'excepción', solicitudId:id, billeteraNombre:(bil&&(bil.NOMBRE_VISIBLE||bil.NOMBRE))||'', titular:ctx.titular||'', destino:ctx.destino||'', cbu:ctx.cbu||'', obs:ctx.obs||'', posibleAplicada:/timeout|tard[oó] demasiado/i.test(String(e.message||'')) }); }catch(_e){}
      if(res) res.innerHTML = '<div class="err-box" style="padding:8px 10px">Error: '+deps.esc(e.message||String(e))+'</div>';
      deps._trazaPaso('Error inesperado: '+(e.message||String(e)),'err'); deps._trazaFin('err', _fh&&_fh.id);
      await deps.cargarHistorial();
      await deps.cargarSolicitudesPortal(true);
      deps.toast('Portal con error', 'red');
    }finally{
      liberar();
    }
  }


    return { globals: api, ejecutarSolicitudPortalSimple, portalNotasBase, ultimoSaldoPostUsuarioHistorial, isBusy: () => _portalSolicitudOperacionEnCurso };
  }
  return Object.freeze({ create, dependencies });
});
/* Portal: chat. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalChat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","alert","chats","document","esc","getCanal","normArr","renderChatList","renderChatMensajes","rpc","setTimeout","v15RenderChatList","v15RenderChatMensajes","window"]);
  function create(deps){
const api = {};
  function mapChatSesion(c){
    const id = c.chat_id || c.id || c.ID || "";
    return {
      ID_CHAT: String(id),
      USUARIO: c.usuario || c.USUARIO || "Usuario",
      NOMBRE_COMPLETO: c.nombre || c.nombre_completo || "",
      TELEFONO: c.telefono || "",
      SOLICITUD_ID: c.solicitud_id || "",
      SIN_LEER: Number(c.sin_leer || 0),
      ULTIMO_MENSAJE: c.ultimo_mensaje || c.mensaje || "",
      FECHA_ULTIMO: c.updated_at || c.created_at || c.fecha_ultimo,
      FECHA: c.updated_at || c.created_at || c.fecha_ultimo,
      ESTADO: c.estado || "ABIERTO"
    };
  }

  async function cargarChatsPortal(silencioso=false){
    const canal = await deps.getCanal();
    let r;
    const beta = deps.window.NodoBetaChat;
    let betaActive=false,betaError=false;
    try{betaActive=beta && await beta.ready();}
    catch(e){betaError=true;r={data:null,error:{message:e.message}};}
    if(betaActive){
      try { r={data:await deps.window._chatCanalNuevo.cargar(),error:null}; }
      catch(e) { r={data:null,error:{message:e.message}}; }
    }else if(!betaError) r = await deps.rpc("panel_core_get_chat_sesiones_json", {p_pc_codigo: canal});
    if(!betaActive && !betaError && (r?.error || !deps.normArr(r?.data).length)){
      const fb = await deps.rpc("panel_v154_plus_listar_chat_sesiones", {p_pc_codigo: canal});
      if(!fb?.error) r = fb;
    }

    if(r?.error){
      console.warn('cargarChatsPortal error', r.error);
      if(!silencioso){
        const msg = r.error.message || JSON.stringify(r.error);
        const box1 = deps.document.getElementById("v15ChatList");
        const box2 = deps.document.getElementById("chatList");
        if(box1) box1.innerHTML = `<div class="v154p-chat-note">Error chat: ${deps.esc(msg)}</div>`;
        if(box2) box2.innerHTML = `<div class="alert-box">Error chat: ${deps.esc(msg)}</div>`;
      }
      return r;
    }

    const _nuevosChats = deps.normArr(r.data).map(mapChatSesion);
    // ANTI-PARPADEO (contador 0↔N): si la RPC devolvió VACÍO pero ya teníamos chats cargados, NO pisamos
    // con 0 — casi siempre es un timeout/vacío transitorio de la RPC (no "0 sin leer" real). Mantenemos
    // lo último bueno. Un 0 legítimo (todo leído) igual pasa: ahí la RPC devuelve las sesiones con SIN_LEER=0
    // (array NO vacío), así que este guard no se activa.
    if(betaActive || !(_nuevosChats.length === 0 && Array.isArray(deps.V154P.chats) && deps.V154P.chats.length > 0)){
      deps.V154P.chats = _nuevosChats;
      deps.window.chats = deps.V154P.chats.slice();
      try{ deps.chats = deps.V154P.chats.slice(); }catch(_e){}
    }

    if(typeof deps.v15RenderChatList === "function") deps.v15RenderChatList();
    else if(typeof deps.renderChatList === "function") deps.renderChatList();

    // Auto-refrescar conversación abierta si hay un ticket activo
    try{
      if(deps.window.__nodoChatCurrentTicket && typeof deps.window.renderChatMensajes === "function"){
        deps.window.renderChatMensajes();
      }
    }catch(_e){}

    try{
      const count = deps.V154P.chats.filter(c => String(c.ESTADO || "").toUpperCase() !== "CERRADO").length;
      const badge = deps.document.getElementById("v15ChatCount");
      if(badge) badge.textContent = String(count);
      deps.window.nodoChatRefreshUnread?.();
    }catch(e){}

    return r;
  }

  async function cargarChatPortalActual(silencioso=false){
    const chatId = deps.window.chatActualId || deps.window.v15ChatActualId || deps.V154P.chatActual;
    if(!chatId) return;

    deps.V154P.chatActual = String(chatId);
    let r;
    const beta = deps.window.NodoBetaChat;
    let betaActive=false,betaError=false;
    try{betaActive=beta && await beta.ready();}
    catch(e){betaError=true;r={data:null,error:{message:e.message}};}
    if(betaActive){
      const current=deps.window.__nodoChatCurrentTicket;
      // A stale five-second timer must not fetch or mark a previous conversation.
      if(!current?._beta || String(current._chatId)!==String(chatId)) return;
      try { r={data:await deps.window._chatCanalNuevo.mensajesDe(String(chatId)),error:null}; }
      catch(e) { r={data:null,error:{message:e.message}}; }
      if(String(deps.window.__nodoChatCurrentTicket?._chatId)!==String(chatId)) return;
    }else if(!betaError) r = await deps.rpc("panel_core_get_chat_mensajes_json", {p_chat_id: String(chatId)});
    if(!betaActive && !betaError && (r?.error || !deps.normArr(r.data).length)){
      const fb = await deps.rpc("panel_v154_plus_get_chat_mensajes", {p_chat_id: String(chatId)});
      if(!fb?.error) r = fb;
    }

    if(r?.error){
      if(betaActive || betaError) return r; // Keep the last confirmed page; the beta status exposes the error.
      const msg = r.error.message || JSON.stringify(r.error);
      const b1 = deps.document.getElementById("chatBody");
      const b2 = deps.document.getElementById("v15ChatBody");
      if(b1) b1.innerHTML = `<div class="alert-box">Error mensajes: ${deps.esc(msg)}</div>`;
      if(b2) b2.innerHTML = `<div class="v154p-chat-note">Error mensajes: ${deps.esc(msg)}</div>`;
      return r;
    }

    deps.V154P.chatMensajes = deps.normArr(r.data).map(m => ({
      ...m,
      MENSAJE: m.mensaje || "",
      IMAGEN_URL: m.imagen_url || "",
      TIPO_EMISOR: m.tipo_emisor || m.emisor_tipo || "",
      EMISOR: m.emisor || "",
      FECHA: m.created_at
    }));
    deps.window.chatMensajes = deps.V154P.chatMensajes.slice();

    if(typeof deps.renderChatMensajes === "function") deps.renderChatMensajes();
    if(typeof deps.v15RenderChatMensajes === "function") deps.v15RenderChatMensajes();

    return r;
  }

  async function enviarChatPortal(){
    const chatId = deps.window.chatActualId || deps.window.v15ChatActualId || deps.V154P.chatActual;
    if(!chatId){
      deps.alert("Seleccioná un chat primero.");
      return;
    }

    let input = deps.document.getElementById("chatInput");
    let msg = input ? input.value.trim() : "";
    if(!msg){
      input = deps.document.getElementById("v15ChatInput");
      msg = input ? input.value.trim() : "";
    }
    if(!msg) return;

    let r = await deps.rpc("panel_core_enviar_chat_json", {
      p_chat_id: String(chatId),
      p_mensaje: msg,
      p_emisor: (deps.window.operador?.usuario || deps.window.operador?.nombre || "panel")
    });
    if(r?.error || r?.data?.ok === false){
      const fb = await deps.rpc("panel_v154_plus_enviar_chat", {
        p_chat_id: String(chatId),
        p_mensaje: msg,
        p_emisor: (deps.window.operador?.usuario || deps.window.operador?.nombre || "panel")
      });
      if(!fb?.error && fb?.data?.ok !== false) r = fb;
    }

    if(r?.error || r?.data?.ok === false){
      deps.alert("Error enviando chat: " + (r?.error?.message || r?.data?.error || JSON.stringify(r)));
      return r;
    }

    if(input) input.value = "";
    await cargarChatPortalActual(false);
    deps.setTimeout(()=>cargarChatPortalActual(true), 800);
    return r;
  }

    return { globals: api, mapChatSesion, cargarChatsPortal, cargarChatPortalActual, enviarChatPortal };
  }
  return Object.freeze({ create, dependencies });
});
