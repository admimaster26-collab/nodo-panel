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
