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
  //   1. RETIRA LA CARGA Y EL BONO — cobró bono de primer ingreso y ahora saca lo que cargó
  //      más el bono, sin ganar nada encima: no lo jugó. Si saca más que carga + bono, jugó
  //      y ganó, y avisar es ruido (Juan, 4/11). Para la plataforma el bono son fichas comunes
  //      y en el 67% de los casos el retiro lo paga OTRO turno, que no sabe del bono.
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

      // ── 1 · Retira la carga y el bono ─────────────────────────────────
      // cargado_real y retirado_previo cuentan desde la carga que recibió el bono.
      // Si lo que se lleva por encima de lo que cargó es justo el bono, no jugó: sacó lo mismo
      // que puso más el bono. Si es más, ganó jugando; menos, perdió jugando o no toca el bono.
      // En la semana al 4/11 fue 1 de 41 retiros de jugadores con bono; "parte del bono" daba
      // también a quien cargó 218.000 y retiró 220.000, que jugó todo.
      const bono = Number(a.bono_monto||0);
      const hs   = Number(a.bono_horas||0);
      const cargado  = Number(a.cargado_real||0);
      const retirado = Number(a.retirado_previo||0);
      const pedido   = Math.abs(Number(opts.monto||0));
      const deMas    = (retirado + pedido) - cargado;
      if(bono > 0 && hs <= _ALERTA_BONO_HS && pedido > 0 && Math.abs(deMas - bono) < 1){
        const cuando = hs < 24 ? (hs.toFixed(1)+' h') : (Math.round(hs/24)+' d');
        let txt = '🎁 <b>RETIRA LA CARGA Y EL BONO</b>'
                + ' · cargó '+deps.esc(deps.money(cargado))+' + bono '+deps.esc(deps.money(bono));
        if(exp){
          txt += '<div style="margin-top:4px;font-weight:600">Bono de hace '+cuando
               + (retirado > 0 ? (' · ya retiró '+deps.esc(deps.money(retirado))) : '')
               + ' · pide '+deps.esc(deps.money(pedido))+'</div>';
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
