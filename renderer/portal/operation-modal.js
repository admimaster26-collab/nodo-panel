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
  api.v154pCrearJobSolicitud = async function(id){
    // Si el retiro YA tiene un parcial en curso (pagado>0 y < total), "Aprobar" NO debe hacer un
    // retiro COMPLETO: eso marcaría PAGADA ignorando lo ya pagado (y sin tocar metadata.retiro_parcial),
    // cerrando el retiro con saldo real pendiente. En ese caso, redirigimos al flujo Parcial por lo que
    // falta → el cierre lo decide SOLO la RPC del parcial cuando pagado>=total.
    try{
      const s = (deps.V154P.solicitudes||[]).find(x=>Number(x.ID||x.SOLICITUD_ID)===Number(id));
      if(s && deps.window._retiroParcialSigueAbierto && deps.window._retiroParcialSigueAbierto(s)){
        const pp = deps.window._retiroParcialInfo(s);
        try{ deps.toast('Este retiro tiene un parcial en curso · pagado '+deps.money(pp.pagado)+' de '+deps.money(pp.total)+'. Abro "Parcial" por lo que falta ('+deps.money(pp.restante)+').','yellow'); }catch(_e){}
        if(typeof deps.window.v154pRegistrarParcial==='function'){ deps.window.v154pRegistrarParcial(id); return; }
      }
    }catch(_e){}
    return deps.window.abrirModalPortalSolicitud(id);
  };

  let _expedienteActualData = null;

  function expedienteEnsureModal(){
    let el = deps.document.getElementById('modalExpedienteOverlay');
    if(el) return el;
    el = deps.document.createElement('div');
    el.id = 'modalExpedienteOverlay';
    el.className = 'expediente-overlay hidden';
    el.innerHTML = `
      <div class="expediente-drawer" onclick="event.stopPropagation()">
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
            <button class="mini-btn gray" type="button" onclick="copiarResumenExpediente()" title="Copiar ficha / resumen para soporte o WhatsApp">📋 Copiar ficha</button>
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
  };

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
    try{ deps.window.nodoCopiar(txt, { etiqueta: '✓ Ficha copiada' }); }
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
      actionsHtml += `<button class="mini-btn green" type="button" onclick="window.v154pCrearJobSolicitud && window.v154pCrearJobSolicitud(${id})">✓ Aprobar</button>`;
      if(esRetiro){
        actionsHtml += `<button class="mini-btn purple" type="button" onclick="window.v154pRegistrarParcial && window.v154pRegistrarParcial(${id})">💸 Parcial</button>`;
      }
      actionsHtml += `<button class="mini-btn red" type="button" onclick="window.v154pRechazarSolicitud && window.v154pRechazarSolicitud(${id})">✕ Rechazar</button>`;
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
        <button type="button" class="sol-comm-btn" onclick="copiarResumenExpediente()" title="Copiar ficha de la operación al portapapeles">
          <span>📋</span> Copiar Ficha
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

            ${(esCarga || esRetiro) ? `
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
