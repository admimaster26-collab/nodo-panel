
/* ============================================================
   NODO · INGRESOS AL PORTAL, REVISIONES Y PREVALIDAR POR OFICINA (BETA)
   Se enchufa a 🔁 Recuperación de usuarios (extensions/jugadores-crm.js)
   y al chequeo de teléfono antes de crear cuenta (cotejo-alta.js).
   Sólo activa los canales nuevos en las oficinas que los anuncian en
   nodo_beta_capacidades_v1; las demás siguen por el camino actual.
   ============================================================ */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = { create: factory };
  else factory(root);
})(typeof window !== 'undefined' ? window : globalThis, function(root){
  'use strict';

  const CAP_TTL_MS = 60000;
  const capCache = new Map();
  const estado = {
    pc: '',
    dias: 7,
    filtro: 'TODOS',
    ingresos: null,
    revisiones: null,
    cargandoIng: false,
    cargandoRev: false
  };

  function S(v){ return String(v ?? ''); }
  function E(v){
    const s = S(v);
    if(typeof root.escapeHtml === 'function') return root.escapeHtml(s);
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function pcActual(override){
    const raw = override || (typeof pcOperativa !== 'undefined' ? pcOperativa : '') || root.pcOperativa || '';
    return S(raw).trim().toUpperCase();
  }
  function sbClient(){
    return (typeof supabaseClient !== 'undefined' && supabaseClient) ? supabaseClient : root.supabaseClient;
  }
  function panelSecret(){
    return (typeof PANEL_DATA_SECRET !== 'undefined' && PANEL_DATA_SECRET) ? PANEL_DATA_SECRET : root.PANEL_DATA_SECRET;
  }
  function destinoActual(){
    return root.document?.getElementById?.('rxCuerpo') || null;
  }

  async function capacidadesOficina(pc, forzar){
    sincronizarContexto();
    const codigo = pcActual(pc);
    if(!codigo || !root.panelAPI || typeof root.panelAPI.rpc !== 'function') return null;
    const prev = capCache.get(codigo);
    if(!forzar && prev && (Date.now() - prev.at) < CAP_TTL_MS){
      aplicarFlags(codigo, prev.caps);
      return prev.caps;
    }
    if(prev?.flight && !forzar) return prev.flight;

    const flight = (async () => {
      try{
        if(typeof root.panelAPI.getContext === 'function'){
          const rawCtx = await root.panelAPI.getContext();
          const beta = rawCtx?.beta || rawCtx;
          if(!beta || beta.enabled !== true || (Array.isArray(beta.offices) && !beta.offices.includes(codigo))){
            aplicarFlags(codigo, null);
            return null;
          }
        }
        const res = await root.panelAPI.rpc('nodo_beta_capacidades_v1', { p_pc_codigo: codigo, p_activate: false });
        const data = res?.data;
        if(res?.error || !data || data.ok !== true || data.contract !== 'nodo.beta.v1' || data.scope?.pc_codigo !== codigo){
          return prev?.caps || null;
        }
        const caps = new Set(Array.isArray(data.capabilities) ? data.capabilities : []);
        capCache.set(codigo, { at: Date.now(), caps, flight: null });
        aplicarFlags(codigo, caps);
        return caps;
      }catch(_e){
        return prev?.caps || null;
      }finally{
        const cur = capCache.get(codigo);
        if(cur && cur.flight === flight) cur.flight = null;
      }
    })();

    capCache.set(codigo, { at: prev?.at || 0, caps: prev?.caps || null, flight });
    return flight;
  }

  function aplicarFlags(codigo, caps){
    if(codigo !== pcActual()) return;
    const teniaIng = root._crmCapIngresos === true;
    const teniaRev = root._crmCapRevisiones === true;
    root._crmCapIngresos   = Boolean(caps && caps.has('ingresos.v1'));
    root._crmCapRevisiones = Boolean(caps && caps.has('revisiones.v1'));
    root._crmCapPrevalidar = Boolean(caps && caps.has('prevalidar.v1'));
    root.__nodoHealthV2    = Boolean(caps && caps.has('health.v2'));
    if((root._crmCapIngresos !== teniaIng || root._crmCapRevisiones !== teniaRev) && typeof root.crmRxRefrescarTabs === 'function'){
      try{ root.crmRxRefrescarTabs(); }catch(_e){}
    }
  }

  function sincronizarContexto(){
    const pc = pcActual();
    if(estado.pc !== pc){
      estado.pc = pc;
      estado.ingresos = null;
      estado.revisiones = null;
      root._crmCapIngresos = false;
      root._crmCapRevisiones = false;
      root._crmCapPrevalidar = false;
    }
    return pc;
  }

  // ── 1. Revisar teléfono/usuario antes de crear cuenta (por oficina en beta) ──
  root.nodoPrevalidarConsultar = async function(telefono, usuario, pcOverride){
    const pc = pcActual(pcOverride);
    const tel = S(telefono).trim() || null;
    const usr = S(usuario).trim() || null;
    const caps = await capacidadesOficina(pc, false);
    if(caps && caps.has('prevalidar.v1') && root.panelAPI && typeof root.panelAPI.rpc === 'function'){
      const health = root.NodoSalud?.begin?.('IDENTIDAD');
      const r = await root.panelAPI.rpc('nodo_beta_prevalidar_v1', {
        p_pc_codigo: pc,
        p_telefono: tel,
        p_usuario: usr
      });
      health?.reply?.(r?.error || null);
      if(!r?.error && r?.data && r.data.ok === true && r.data.contract === 'prevalidar.v1'){
        health?.record?.('DATA', 'OK', 'PREVALIDAR_BETA_OK');
        const cuentas = Array.isArray(r.data.cuentas)
          ? r.data.cuentas.map(c => Object.assign({ pc: r.data.pc_codigo || pc }, c))
          : [];
        return { data: Object.assign({}, r.data, { cuentas }), error: null };
      }
      if(r?.error && r.error.code !== 'BETA_NOT_CONFIGURED' && r.error.code !== 'BETA_OFFICE_NOT_CONFIGURED'){
        health?.record?.('DATA', 'DEGRADED', 'PREVALIDAR_BETA_FALLBACK');
      }
    }
    const sb = sbClient();
    if(!sb || typeof sb.rpc !== 'function'){
      return { data: null, error: { message: 'La aplicación no está conectada' } };
    }
    return await sb.rpc('panel_prevalidar_usuario', {
      p_secret: panelSecret(),
      p_pc_codigo: pc,
      p_telefono: tel,
      p_usuario: usr
    });
  };

  // ── 2. Lectura de Ingresos al Portal y Revisiones por oficina ────────────────
  root.crmCargarIngresos = async function(forzar){
    const pc = sincronizarContexto();
    if(!pc) return null;
    if(!forzar && estado.ingresos && estado.ingresos.pc_codigo === pc && estado.ingresos.dias === estado.dias){
      return estado.ingresos;
    }
    const health = root.NodoSalud?.begin?.('INGRESOS');
    estado.cargandoIng = true;
    try{
      const caps = await capacidadesOficina(pc, false);
      if(!caps || !caps.has('ingresos.v1')){
        health?.record?.('DATA', 'UNKNOWN', 'INGRESOS_SIN_CAPACIDAD');
        return null;
      }
      const r = await root.panelAPI.rpc('nodo_beta_ingresos_v1', { p_pc_codigo: pc, p_dias: estado.dias });
      health?.reply?.(r?.error || null);
      if(!health || health.current()){
        if(r?.error || !r?.data || r.data.ok !== true || r.data.contract !== 'ingresos.v1' || r.data.pc_codigo !== pc){
          health?.record?.('DATA', 'ERROR', r?.error ? health.errorCode(r.error) : 'INGRESOS_INVALID_DATA');
          return null;
        }
        health?.record?.('DATA', 'OK', 'INGRESOS_LIST_VALID');
        estado.ingresos = r.data;
        try{ root.crmRxRefrescarTabs?.(); }catch(_e){}
      }
      return estado.ingresos;
    }catch(e){
      health?.record?.('DATA', 'ERROR', health ? health.errorCode(e) : 'RPC_FAILED');
      return null;
    }finally{
      estado.cargandoIng = false;
    }
  };

  root.crmCargarRevisiones = async function(forzar){
    const pc = sincronizarContexto();
    if(!pc) return null;
    if(!forzar && estado.revisiones && estado.revisiones.pc_codigo === pc){
      return estado.revisiones;
    }
    const health = root.NodoSalud?.begin?.('REVISIONES');
    estado.cargandoRev = true;
    try{
      const caps = await capacidadesOficina(pc, false);
      if(!caps || !caps.has('revisiones.v1')){
        health?.record?.('DATA', 'UNKNOWN', 'REVISIONES_SIN_CAPACIDAD');
        return null;
      }
      const r = await root.panelAPI.rpc('nodo_beta_revisiones_v1', { p_pc_codigo: pc });
      health?.reply?.(r?.error || null);
      if(!health || health.current()){
        if(r?.error || !r?.data || r.data.ok !== true || r.data.contract !== 'revisiones.v1' || r.data.pc_codigo !== pc || !Array.isArray(r.data.items)){
          health?.record?.('DATA', 'ERROR', r?.error ? health.errorCode(r.error) : 'REVISIONES_INVALID_DATA');
          return null;
        }
        const conAlerta = r.data.items.some(i => i && i.nivel === 'ALTO' && Number(i.cantidad) > 0);
        health?.record?.('DATA', 'OK', conAlerta ? 'REVISIONES_CON_PENDIENTES' : 'REVISIONES_LIST_VALID');
        estado.revisiones = r.data;
        try{ root.crmRxRefrescarTabs?.(); }catch(_e){}
      }
      return estado.revisiones;
    }catch(e){
      health?.record?.('DATA', 'ERROR', health ? health.errorCode(e) : 'RPC_FAILED');
      return null;
    }finally{
      estado.cargandoRev = false;
    }
  };

  // ── 3. Pestañas en 🔁 Recuperación de usuarios ───────────────────────────────
  root.crmRxTabsExtra = function(tabActual){
    const pc = sincronizarContexto();
    if(!pc) return '';
    void capacidadesOficina(pc, false);
    let html = '';
    if(root._crmCapIngresos === true){
      const res = estado.ingresos?.resumen;
      const nIng = res ? (Number(res.esperando || 0) + Number(res.en_curso || 0) + Number(res.vinculos_pendientes || 0)) : null;
      const cls = tabActual === 'ing' ? 'green' : 'gray';
      html += '<button class="mini-btn ' + cls + '" onclick="crmRxTab(\x27ing\x27)">🚪 Ingresos'
        + (nIng != null ? ' <b>' + nIng + '</b>' : '') + '</button>';
    }
    if(root._crmCapRevisiones === true){
      const items = estado.revisiones?.items;
      const nRev = Array.isArray(items) ? items.filter(i => Number(i?.cantidad) > 0).length : null;
      const cls = tabActual === 'rev' ? 'yellow' : 'gray';
      html += '<button class="mini-btn ' + cls + '" onclick="crmRxTab(\x27rev\x27)">🔍 Revisiones'
        + (nRev != null ? ' <b>' + nRev + '</b>' : '') + '</button>';
    }
    return html;
  };

  root.crmRxPintarExtra = function(tab, destino){
    if(tab !== 'ing' && tab !== 'rev') return false;
    const box = destino || destinoActual();
    if(!box) return true;
    if(tab === 'ing'){
      pintarIngresos(box, false);
      return true;
    }
    pintarRevisiones(box, false);
    return true;
  };

  root.crmIngDias = function(dias){
    const n = Number(dias);
    if(![7, 14, 30].includes(n)) return;
    estado.dias = n;
    estado.ingresos = null;
    const box = destinoActual();
    if(box) pintarIngresos(box, true);
  };

  root.crmIngFiltro = function(f){
    estado.filtro = S(f || 'TODOS').toUpperCase();
    const box = destinoActual();
    if(box) pintarIngresos(box, false);
  };

  root.crmIngRefrescar = function( cual ){
    const box = destinoActual();
    if(!box) return;
    if(cual === 'rev'){
      estado.revisiones = null;
      pintarRevisiones(box, true);
    }else{
      estado.ingresos = null;
      pintarIngresos(box, true);
    }
  };

  // Cumple docs/BOTONES.md: el usuario va en data-u, nunca interpolado dentro del onclick.
  root.crmIngAbrirPerfil = function(el){
    const u = el && typeof el.getAttribute === 'function' ? S(el.getAttribute('data-u')).trim() : '';
    if(!u) return;
    if(typeof root.abrirPerfilJugador === 'function') root.abrirPerfilJugador(u);
  };

  const RESULTADO_ETIQUETA = {
    EN_CURSO:        ['🟡 Probando ahora',          '#fbbf24', 'Intentó entrar hace menos de 2 horas y todavía no entró.'],
    ESPERANDO:       ['🟠 Esperando respuesta',     '#f97316', 'Pidió entrar en las últimas 48 horas y sigue sin poder entrar.'],
    CORRIGIO:        ['🟢 Corrigió y entró',        '#22c55e', 'Al principio le dio error, después corrigió el dato y entró solo.'],
    OPERA:           ['🟢 Ya está operando',        '#22c55e', 'Ya hizo al menos una carga o un retiro en la oficina.'],
    VALIDADO:        ['🟢 Validado por operador',   '#22c55e', 'Un operador vinculó su cuenta después del intento.'],
    ES_OTRO_USUARIO: ['🟣 Su teléfono tiene otro usuario', '#c084fc', 'El número con el que quiso entrar ya pertenece a otra cuenta de esta oficina.'],
    OTRO_TELEFONO:   ['🟣 Tiene otro teléfono',     '#c084fc', 'El usuario existe en la oficina, pero con otro número de teléfono.'],
    BLOQUEADO:       ['🔴 Bloqueado',               '#ef4444', 'El vínculo figura bloqueado en la oficina.'],
    ABANDONO:        ['⚪ No volvió (+48 h)',       '#94a3b8', 'Intentó entrar hace más de 48 horas y no volvió a probar.']
  };

  const RESPUESTA_TEXTO = {
    NO_REGISTRADO:      'no figuraba en la oficina',
    CONFLICTO_TELEFONO: 'usuario con otro teléfono',
    CONFLICTO_USUARIO:  'teléfono de otro usuario',
    BLOQUEADO:          'cuenta bloqueada',
    DATOS_INCOMPLETOS:  'datos incompletos'
  };

  function textoRespuestas(arr){
    if(!Array.isArray(arr) || !arr.length) return '';
    return arr.map(k => RESPUESTA_TEXTO[S(k).toUpperCase()] || 'error de ingreso').join(' · ');
  }

  function fechaCorta(iso){
    const d = new Date(iso || 0);
    if(isNaN(d.getTime())) return '—';
    const mins = Math.max(1, Math.floor((Date.now() - d.getTime()) / 60000));
    if(mins < 60) return 'hace ' + mins + ' min';
    const hs = Math.floor(mins / 60);
    if(hs < 48) return 'hace ' + hs + ' h';
    return 'hace ' + Math.floor(hs / 24) + ' d';
  }

  async function pintarIngresos(box, forzar){
    sincronizarContexto();
    if(!estado.ingresos || forzar){
      box.innerHTML = '<div class="load" style="padding:16px;color:#8b949e">Consultando ingresos de la oficina…</div>';
      const datos = await root.crmCargarIngresos(true);
      if(!datos){
        box.innerHTML = '<div class="err-box" style="padding:12px">No se pudieron leer los ingresos al Portal de esta oficina.</div>';
        return;
      }
    }
    const d = estado.ingresos;
    const r = d.resumen || {};
    const resueltos = Number(r.corrigieron || 0) + Number(r.operan || 0) + Number(r.validados || 0);
    const esperando = Number(r.esperando || 0) + Number(r.en_curso || 0);
    const duplicados = Number(r.es_otro_usuario || 0) + Number(r.otro_telefono || 0);
    const abandonos = Number(r.abandonos || 0);
    const pend = Number(r.vinculos_pendientes || 0);
    const pendOpera = Number(r.vinculos_pendientes_opera || 0);

    const btnDia = n => '<button class="mini-btn ' + (estado.dias === n ? 'green' : 'gray')
      + '" onclick="crmIngDias(' + n + ')">' + n + ' días</button>';
    const btnFil = (k, lbl, n) => '<button class="mini-btn ' + (estado.filtro === k ? 'blue' : 'gray')
      + '" onclick="crmIngFiltro(\x27' + k + '\x27)">' + lbl + (n != null ? ' <b>' + n + '</b>' : '') + '</button>';

    const casos = Array.isArray(d.casos) ? d.casos : [];
    const pendientes = Array.isArray(d.pendientes) ? d.pendientes : [];

    let tablaHtml = '';
    if(estado.filtro === 'PENDIENTES'){
      tablaHtml = !pendientes.length
        ? '<div class="alert-box" style="padding:14px">No hay vínculos pendientes en esta oficina. 👌</div>'
        : '<div style="max-height:54vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
          + '<thead><tr style="position:sticky;top:0;background:#161b26;z-index:1">'
          + '<th style="padding:7px;text-align:left">Usuario</th>'
          + '<th style="padding:7px;text-align:left">Situación real</th>'
          + '<th style="padding:7px">Antigüedad</th>'
          + '<th style="padding:7px;text-align:right">Ficha</th></tr></thead><tbody>'
          + pendientes.map(p => {
              const situacion = p.opera
                ? '<span style="color:#22c55e;font-weight:700">🟢 Ya opera</span> <span class="small" style="color:#8b949e">(quedó el vínculo como pendiente, pero ya cargó)</span>'
                : p.otro_usuario
                  ? '<span style="color:#c084fc;font-weight:700">🟣 Su teléfono ya es de ' + E(p.otro_usuario) + '</span>'
                  : '<span style="color:#fbbf24;font-weight:700">🟡 Sin validar y sin operaciones</span>';
              return '<tr style="border-top:1px solid #21283a">'
                + '<td style="padding:6px 7px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>' + E(p.usuario) + '</b></td>'
                + '<td style="padding:6px 7px">' + situacion + '</td>'
                + '<td style="padding:6px 7px;text-align:center;color:#8b949e">' + Number(p.dias || 0) + ' d</td>'
                + '<td style="padding:6px 7px;text-align:right">'
                + '<button class="mini-btn gray" data-u="' + E(p.usuario) + '" onclick="crmIngAbrirPerfil(this)" title="Abrir ficha">🌳</button>'
                + '</td></tr>';
            }).join('')
          + '</tbody></table></div>';
    }else{
      const filtrados = casos.filter(c => {
        if(estado.filtro === 'ESPERANDO')  return c.resultado === 'EN_CURSO' || c.resultado === 'ESPERANDO';
        if(estado.filtro === 'RESUELTOS')  return c.resultado === 'CORRIGIO' || c.resultado === 'OPERA' || c.resultado === 'VALIDADO';
        if(estado.filtro === 'DUPLICADOS') return c.resultado === 'ES_OTRO_USUARIO' || c.resultado === 'OTRO_TELEFONO';
        if(estado.filtro === 'ABANDONO')   return c.resultado === 'ABANDONO';
        return true;
      });
      tablaHtml = !filtrados.length
        ? '<div class="alert-box" style="padding:14px">No hay casos en este filtro para los últimos ' + estado.dias + ' días. 👌</div>'
        : '<div style="max-height:54vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
          + '<thead><tr style="position:sticky;top:0;background:#161b26;z-index:1">'
          + '<th style="padding:7px;text-align:left">Usuario que escribió</th>'
          + '<th style="padding:7px;text-align:left">Qué pasó después</th>'
          + '<th style="padding:7px">Teléfono</th>'
          + '<th style="padding:7px">Último intento</th>'
          + '<th style="padding:7px;text-align:right">Ficha</th></tr></thead><tbody>'
          + filtrados.map(c => {
              const meta = RESULTADO_ETIQUETA[c.resultado] || ['⚪ En revisión', '#8b949e', ''];
              let detalle = meta[2];
              if(c.resultado === 'CORRIGIO' && c.entro_con && c.entro_con !== c.usuario){
                detalle = 'Entró bien con el usuario ' + E(c.entro_con) + '.';
              }else if(c.resultado === 'ES_OTRO_USUARIO' && c.otro_usuario){
                detalle = 'Su teléfono ya está validado con el usuario ' + E(c.otro_usuario) + '.';
              }
              const resp = textoRespuestas(c.respuestas);
              const tels = Array.isArray(c.telefonos) && c.telefonos.length ? c.telefonos.map(E).join(' · ') : '—';
              const targetUser = (c.resultado === 'ES_OTRO_USUARIO' && c.otro_usuario) ? c.otro_usuario : (c.entro_con || c.usuario);
              return '<tr style="border-top:1px solid #21283a">'
                + '<td style="padding:6px 7px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
                +   '<b>' + E(c.usuario) + '</b>'
                +   (c.por_soporte ? ' <span class="small" style="color:#7dd3fc" title="Abrió ticket de soporte al no poder entrar">· pidió soporte</span>' : '')
                +   (resp ? '<div class="small" style="color:#5a6474">Le salió: ' + E(resp) + (Number(c.veces) > 1 ? ' (' + Number(c.veces) + ' veces)' : '') + '</div>' : '')
                + '</td>'
                + '<td style="padding:6px 7px">'
                +   '<span style="color:' + meta[1] + ';font-weight:700">' + meta[0] + '</span>'
                +   (detalle ? '<div class="small" style="color:#8b949e">' + detalle + '</div>' : '')
                + '</td>'
                + '<td style="padding:6px 7px;text-align:center;font-family:ui-monospace,monospace;color:#8b949e">' + tels + '</td>'
                + '<td style="padding:6px 7px;text-align:center;color:#8b949e">' + E(fechaCorta(c.ultima)) + '</td>'
                + '<td style="padding:6px 7px;text-align:right">'
                +   '<button class="mini-btn gray" data-u="' + E(targetUser) + '" onclick="crmIngAbrirPerfil(this)" title="Abrir ficha">🌳</button>'
                + '</td></tr>';
            }).join('')
          + '</tbody></table></div>';
    }

    box.innerHTML =
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">'
      + btnDia(7) + btnDia(14) + btnDia(30)
      + '<span style="width:10px"></span>'
      + btnFil('TODOS', 'Todos', Number(r.pedidos || 0))
      + btnFil('ESPERANDO', '🟡 Esperando', esperando)
      + btnFil('RESUELTOS', '🟢 Ya entraron / operan', resueltos)
      + btnFil('DUPLICADOS', '🟣 Otro usuario / tel.', duplicados)
      + btnFil('ABANDONO', '⚪ No volvieron', abandonos)
      + btnFil('PENDIENTES', '📋 Vínculos pendientes', pend)
      + '<span style="flex:1"></span>'
      + '<button class="mini-btn gray" onclick="crmIngRefrescar(\x27ing\x27)">🔄 Actualizar</button>'
      + '</div>'
      + '<div class="small" style="color:#8b949e;margin-bottom:10px">'
      +   'Separa quién sigue esperando de quién escribió mal el dato, volvió atrás y entró bien, o ya tenía otra cuenta en esta oficina.'
      +   (pend > 0 ? ' De los <b>' + pend + '</b> vínculos pendientes, <b>' + pendOpera + '</b> ya operan.' : '')
      + '</div>'
      + tablaHtml;
  }

  // ── 4. Vista de Revisiones por oficina ──────────────────────────────────────
  const NIVEL_ESTILO = {
    ALTO:  ['#f04438', 'rgba(240,68,56,.10)',  '🔴 Revisar hoy'],
    MEDIO: ['#f5c518', 'rgba(245,197,24,.10)', '🟡 Para revisar'],
    INFO:  ['#7dd3fc', 'rgba(125,211,252,.08)','🔵 Informativo'],
    OK:    ['#22c55e', 'rgba(34,197,94,.06)',  '🟢 Al día']
  };

  async function pintarRevisiones(box, forzar){
    sincronizarContexto();
    if(!estado.revisiones || forzar){
      box.innerHTML = '<div class="load" style="padding:16px;color:#8b949e">Calculando revisiones de la oficina…</div>';
      const datos = await root.crmCargarRevisiones(true);
      if(!datos){
        box.innerHTML = '<div class="err-box" style="padding:12px">No se pudieron leer las revisiones de esta oficina.</div>';
        return;
      }
    }
    const items = Array.isArray(estado.revisiones?.items) ? estado.revisiones.items : [];
    const orden = { ALTO: 1, MEDIO: 2, INFO: 3, OK: 4 };
    const ordenados = items.slice().sort((a, b) => {
      const ca = Number(a?.cantidad || 0) > 0 ? 0 : 1;
      const cb = Number(b?.cantidad || 0) > 0 ? 0 : 1;
      if(ca !== cb) return ca - cb;
      return (orden[a?.nivel] || 9) - (orden[b?.nivel] || 9);
    });

    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">'
      + '<div class="small" style="color:#8b949e">Cotejos automáticos de esta oficina: usuarios sin validar, cuentas de cobro compartidas, cambios entre operadores y bonos.</div>'
      + '<button class="mini-btn gray" onclick="crmIngRefrescar(\x27rev\x27)">🔄 Actualizar</button>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px">'
      + ordenados.map(it => {
          const n = Number(it.cantidad || 0);
          const est = NIVEL_ESTILO[n > 0 ? it.nivel : 'OK'] || NIVEL_ESTILO.INFO;
          const ejemplos = Array.isArray(it.ejemplos) ? it.ejemplos : [];
          return '<div style="border:1px solid ' + est[0] + '44;background:' + est[1] + ';border-radius:10px;padding:11px 13px">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'
            +   '<span class="small" style="color:' + est[0] + ';font-weight:800">' + E(it.grupo || 'Oficina') + ' · ' + est[2] + '</span>'
            +   '<b style="font-size:18px;color:' + (n > 0 ? est[0] : '#8b949e') + '">' + n + '</b>'
            + '</div>'
            + '<div style="font-weight:800;font-size:14px;color:#e6edf3;margin-top:4px">' + E(it.titulo || '') + '</div>'
            + '<div class="small" style="color:#8b949e;margin-top:3px">' + E(it.explicacion || '') + '</div>'
            + (ejemplos.length
                ? '<div style="display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07)">'
                  + ejemplos.map(ej => {
                      const uRaw = S(ej.usuario || '').trim();
                      const unSoloUsuario = uRaw && !uRaw.includes('·') && !uRaw.includes(' ');
                      const btn = unSoloUsuario
                        ? '<button class="mini-btn gray" style="padding:1px 6px;font-size:11px" data-u="' + E(uRaw) + '" onclick="crmIngAbrirPerfil(this)" title="Abrir ficha">🌳 ' + E(uRaw) + '</button>'
                        : '<b style="color:#e6edf3">' + E(uRaw) + '</b>';
                      return '<div class="small" style="display:flex;justify-content:space-between;align-items:center;gap:6px">'
                        + '<span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + btn + '</span>'
                        + '<span style="color:#8b949e;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + E(ej.dato || '') + '</span>'
                        + '</div>';
                    }).join('')
                  + '</div>'
                : '')
            + '</div>';
        }).join('')
      + '</div>';
  }

  return Object.freeze({
    capacidadesOficina,
    nodoPrevalidarConsultar: root.nodoPrevalidarConsultar,
    crmCargarIngresos: root.crmCargarIngresos,
    crmCargarRevisiones: root.crmCargarRevisiones,
    crmRxTabsExtra: root.crmRxTabsExtra,
    crmRxPintarExtra: root.crmRxPintarExtra
  });
});
