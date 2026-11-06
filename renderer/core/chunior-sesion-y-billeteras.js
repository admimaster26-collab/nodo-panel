const CHUNIOR_BASE = 'https://bo.chunior.com';
const CHUNIOR_HOME = CHUNIOR_BASE + '/transacciones/';
let _chuniorInited = false;
let _nodoListo    = false;  // true después de finalizarLogin, gatea el modal de puesto

function activarChunior(){
  if(!window.chunior) return;
  if(!_chuniorInited){
    _chuniorInited = true;
    // Polling de status cada 3s: la lógica de Chunior corre en una ventana separada (visible).
    setInterval(async function(){
      try {
        const url = await window.chunior.getUrl();
        if(!url || url.includes('about:blank')) return;
        _setChuniorStatus(!url.includes('/login/'), url);
        if(!_nodoListo) return; // todavía en el login inicial de NODO

        // Inspeccionar el DOM de Chunior: ¿selector de puesto? ¿form de login?
        const estado = await window.chunior.exec(
          '(function(){' +
            'var s=document.getElementById("id_pt");' +
            'if(s){var o=Array.from(s.options).filter(function(x){return x.value!=="";}).map(function(x){return{value:x.value,text:x.text.trim()};});return{tipo:"pt", opts:o};}' +
            // Form de login: #id_username presente (sesión cerrada del todo)
            'if(document.getElementById("id_username")) return {tipo:"login"};' +
            'return {tipo:"ok"};' +
          '})()'
        );

        if(estado && estado.tipo === 'pt' && estado.opts.length > 0 && !window._chuniorPtModalOpen){
          window._chuniorPtModalOpen = true;
          _chuniorElegirPuesto(estado.opts);
        } else if(estado && estado.tipo === 'login'){
          // Sesión de Chunior cerrada del todo → pedir re-login (sin reiniciar NODO)
          _mostrarModalReloginChunior();
        }
      } catch(e){}
    }, 3000);
  }
}

// Después del login, chequear si Chunior está esperando selección de puesto y arrancar el flujo
async function _checkPuestoPostLogin(){
  window.NodoSalud?.begin('CONEXION')?.record('CONNECTED','OK','CHUNIOR_PUESTO_CHECK');
  if(!window.chunior) return;
  await new Promise(function(r){setTimeout(r,500);});
  try {
    const ptData = await window.chunior.exec(
      '(function(){var s=document.getElementById("id_pt");if(!s)return null;var o=Array.from(s.options).filter(function(x){return x.value!=="";}).map(function(x){return{value:x.value,text:x.text.trim()};});return{isPt:true,opts:o};})()'
    );
    if(ptData && ptData.isPt && ptData.opts.length > 0){
      _chuniorElegirPuesto(ptData.opts);
    } else {
      // Ya está en una página normal: sincronizar billeteras directamente
      setTimeout(function(){ sincronizarBilleterasChunior(true).catch(function(){}); }, 800);
    }
  } catch(e){}
}

function chuniorCerrarSesion(){
  if(!confirm('¿Cerrar sesión de Chunior?\n\nEsto también te va a deslogear de NODO.')) return;
  if(window.chunior) window.chunior.navigate(CHUNIOR_BASE + '/accounts/logout/');
  // Cerrar NODO también
  localStorage.removeItem('nodo_operador_lite');
  localStorage.removeItem('nodo_pc_operativa_lite');
  setTimeout(function(){ location.reload(); }, 600);
}

function _setChuniorStatus(loggedIn, url){
  const dot = document.getElementById('chuniorStatus');
  const bar = document.getElementById('chuniorStatusBar');
  if(dot) dot.textContent = loggedIn ? '🟢' : '🔴';
  if(bar) bar.textContent = loggedIn ? 'Sesión activa' : 'Sin sesión';
}

// ── Re-login de Chunior cuando la sesión se cae a mitad de la jornada ──────────
// No guardamos la clave de Chunior (regla de seguridad), así que cuando la sesión
// se cierra le pedimos al operador que la reingrese. Reusa validarLoginChunior.
let _chuniorReloginAbierto = false;
function _mostrarModalReloginChunior(){
  if(_chuniorReloginAbierto) return;           // ya está abierto
  if(window._chuniorPtModalOpen) return;       // el modal de puesto tiene prioridad
  _chuniorReloginAbierto = true;

  abrirModal(
    '🔐 Sesión de Chunior cerrada',
    '<div style="margin-bottom:10px;color:#c0cad8;font-size:13px">La sesión del backoffice de Chunior se cerró.<br>Reingresá tus credenciales para seguir registrando movimientos.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">USUARIO CHUNIOR</label>' +
    '<input id="chuReUser" type="text" autocomplete="off" placeholder="(tu usuario de Chunior)" style="margin-bottom:12px" value="">' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">CONTRASEÑA</label>' +
    '<input id="chuRePass" type="password" autocomplete="off" placeholder="(tu clave)" value="">' +
    '<div id="chuReErr" style="color:var(--red);font-size:12px;margin-top:8px;min-height:16px"></div>',
    null,
    'Reconectar'
  );

  const btn = document.getElementById('modalSaveBtn');
  if(btn) btn.onclick = _ejecutarReloginChunior;
  const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn) cancelBtn.onclick = function(){
    cerrarModal();
    _chuniorReloginAbierto = false;
    toast('Chunior sigue sin sesión · los movimientos no se registrarán', 'red');
  };
  setTimeout(function(){
    const u = document.getElementById('chuReUser');
    const p = document.getElementById('chuRePass');
    if(u){ u.focus(); u.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); p?.focus(); } }); }
    if(p){ p.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); _ejecutarReloginChunior(); } }); }
  }, 80);
}

async function _ejecutarReloginChunior(){
  const user = (document.getElementById('chuReUser')?.value || '').trim();
  const pass = (document.getElementById('chuRePass')?.value || '').trim();
  const errEl = document.getElementById('chuReErr');
  const btn = document.getElementById('modalSaveBtn');
  if(!user || !pass){ if(errEl) errEl.textContent = 'Completá usuario y contraseña.'; return; }
  if(btn){ btn.disabled = true; btn.textContent = 'Reconectando...'; }
  if(errEl) errEl.textContent = '';
  try {
    const ok = await validarLoginChunior(user, pass);
    if(ok){
      const sb = document.getElementById('modalSaveBtn');
      if(sb){ sb.onclick = null; sb.disabled = false; sb.textContent = 'Guardar'; }
      cerrarModal();
      _chuniorReloginAbierto = false;
      toast('✅ Sesión de Chunior reconectada', 'green');
      // Chequear si quedó esperando selección de puesto
      setTimeout(function(){ _checkPuestoPostLogin(); }, 800);
    } else {
      if(errEl) errEl.textContent = 'Usuario o clave incorrectos (rechazado por Chunior).';
      if(btn){ btn.disabled = false; btn.textContent = 'Reconectar'; }
    }
  } catch(e){
    if(errEl) errEl.textContent = 'Error: ' + (e.message || 'sin detalle');
    if(btn){ btn.disabled = false; btn.textContent = 'Reconectar'; }
  }
}

function _chuniorElegirPuesto(opts){
  const optsHtml = opts.map(function(o){
    return '<button class="btn btn-primary" style="margin-bottom:8px" onclick="_chuniorConfirmarPuesto('+_jsonAttr(o.value)+','+_jsonAttr(o.text)+')">'+escapeHtml(o.text)+'</button>';
  }).join('');
  abrirModal('📋 Chunior — Seleccioná tu puesto',
    '<div class="small" style="margin-bottom:14px;color:var(--muted)">Elegí el puesto de trabajo para esta sesión. Si cancelás, NODO se reinicia.</div>'+
    '<div style="display:flex;flex-direction:column;gap:4px">'+optsHtml+'</div>',
    null, null
  );
  // Sobrescribir el botón Cancelar para que recargue la app
  const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn){
    cancelBtn._origOnclick = cancelBtn.onclick;
    cancelBtn.onclick = function(){
      cerrarModal();
      toast('Reiniciando NODO...', 'blue');
      setTimeout(function(){ location.reload(); }, 600);
    };
  }
  // Ocultar el botón Guardar
  const saveBtn = document.getElementById('modalSaveBtn');
  if(saveBtn) saveBtn.style.display = 'none';
}

function _restaurarBotonesModal(){
  const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn && cancelBtn._origOnclick){
    cancelBtn.onclick = cancelBtn._origOnclick;
    delete cancelBtn._origOnclick;
  }
  const saveBtn = document.getElementById('modalSaveBtn');
  if(saveBtn) saveBtn.style.display = '';
}

async function _chuniorConfirmarPuesto(value, text){
  _restaurarBotonesModal();
  cerrarModal();
  window._chuniorPtModalOpen = false;
  if(!window.chunior) return;
  try {
    // 1. Submit del puesto en Chunior
    await window.chunior.exec(
      '(function(){var s=document.getElementById("id_pt");var b=document.querySelector("input[type=\'submit\'],button[type=\'submit\'],.btn");if(s&&b){s.value='+JSON.stringify(value)+';b.click();}})()'
    );
    toast('Chunior: puesto '+text+' seleccionado', 'green');

    // 2. Resolver el puesto → pc_codigo + oficina_id vía nodo_oficina_aliases (sin hardcode)
    let pcCodigoNuevo = normalizarPcCodigo(text);
    let oficinaIdNueva = pcCodigoNuevo;
    try{
      const rr = await supabaseClient.rpc('panel_resolver_puesto', { p_nombre: text, p_secret: window.PANEL_DATA_SECRET });
      const row = rr && rr.data && rr.data[0];
      // Canonicalizar PCx→Px también acá: si el alias en el server devuelve "PC5", igual lo
      // dejamos como "P5" para no volver a stampear billeteras en la oficina fantasma.
      if(row && row.pc_codigo){ pcCodigoNuevo = String(row.pc_codigo).toUpperCase().replace(/^PC(\d+)$/, 'P$1'); oficinaIdNueva = row.oficina_id || pcCodigoNuevo; }
    }catch(_e){ console.warn('resolver puesto falló, uso normalizado:', _e); }
    window.oficinaId = oficinaIdNueva;
    try{ localStorage.setItem('nodo_oficina_id', oficinaIdNueva); }catch(_e){}
    if(!pcCodigoNuevo){
      toast('No pude derivar pc_codigo del puesto "'+text+'"', 'red');
      return;
    }

    // 3. Si NODO ya estaba logueado en OTRA oficina, mejor recargar
    if(_nodoListo && pcOperativa && pcOperativa !== pcCodigoNuevo){
      toast('Cambio de oficina detectado · Reiniciando NODO...', 'blue');
      localStorage.setItem('nodo_pc_operativa_lite', pcCodigoNuevo);
      setTimeout(function(){ location.reload(); }, 800);
      return;
    }

    // 4. Asegurar la oficina en Supabase (crear si es nueva)
    const oficina = await _asegurarOficina(pcCodigoNuevo, text, value);
    pcOperativa = pcCodigoNuevo;
    window.pcOperativa = pcCodigoNuevo;          // espejo para los overrides que leen window
    window.oficinaId   = oficinaIdNueva;

    // Aplicar el proxy de esta oficina (la config/clave se resuelve en el main, blindada).
    // Mostramos el resultado para diagnóstico (antes se ignoraba → no se sabía si aplicó).
    try{
      if(window.ctrlElectron && ctrlElectron.proxyApply){
        Promise.resolve(ctrlElectron.proxyApply(pcCodigoNuevo)).then(function(r){
          if(r && r.ok && r.enabled) toast("🌐 Proxy de oficina aplicado (Agentes saldrá por proxy)","green");
          else if(r && r.reason==="missing-secret") toast("⚠️ Esta PC no tiene la clave de la oficina → proxy NO aplicado. Agentes puede fallar.","red");
          else if(r && r.enabled===false) toast("🌐 Esta oficina no tiene proxy en el admi → salida directa.","blue");
        }).catch(function(){});
      }
    }catch(_e){}

    // En el primer ingreso, historial, titulares bloqueados y billeteras de Chunior los trae el
    // arranque por etapas, de a uno y después de dibujar el Inicio (login-y-realtime.js). Antes
    // salían acá juntos —el historial dos veces— con las solicitudes todavía en camino.
    const _primerIngreso = !_nodoListo;
    if(!_primerIngreso){
      // El historial pudo haberse cargado antes de resolver el puesto (pcOperativa vacío) →
      // recargarlo ahora que la oficina está resuelta, así aparecen las operaciones manuales.
      try{ if(typeof cargarHistorial==="function") setTimeout(function(){ cargarHistorial(); }, 500); }catch(_e){}

      // Los titulares bloqueados los pudo haber marcado OTRA PC: hasta ahora cada máquina sólo
      // conocía los suyos. Se traen de la base ahora que la oficina está resuelta.
      try{ if(typeof sincronizarTitularesBloqueados==="function") setTimeout(function(){ sincronizarTitularesBloqueados(); }, 800); }catch(_e){}
    }

    // 5. Si NODO todavía no se finalizó (primer login), hacerlo ahora
    if(_primerIngreso){
      finalizarLogin(true);
    }

    // 6. Sincronizar billeteras
    //    - Oficina nueva → sync silencioso pero completo (sube todas las que falten)
    //    - Oficina existente → sync silencioso normal (avisa si hay nuevas en Chunior); en el
    //      primer ingreso lo hace el arranque por etapas
    if(oficina.esNueva){
      toast('🏢 Oficina nueva detectada: '+text+' · Sincronizando billeteras...', 'blue');
      setTimeout(function(){
        sincronizarBilleterasChunior(false).catch(function(e){
          console.warn('sync inicial oficina nueva:', e);
        });
      }, 2500);
    } else if(!_primerIngreso){
      setTimeout(function(){
        sincronizarBilleterasChunior(true).catch(function(){});
      }, 2500);
    }
  } catch(e){
    toast('Error al seleccionar puesto: '+(e.message||''), 'red');
  }
}

// ── Sincronización de billeteras con Chunior ──────────────────────────────────
// Lee /transacciones/movimientoficha/add/ y extrae:
//   • opciones del select id_cuenta_destino (uid + nombre)
//   • saldos reales del breadcrumb (.billetera spans)
// Resultado: actualiza saldos en NODO y agrega billeteras nuevas si las encuentra.
async function sincronizarBilleterasChunior(silencioso){
  if(!window.chunior){ if(!silencioso) toast('Ventana de Chunior no disponible.','red'); return; }
  if(!pcOperativa){
    if(!silencioso) toast('Sincronización pospuesta: NODO todavía no terminó de loguear.','red');
    return;
  }

  if(!silencioso) toast('Sincronizando billeteras con Chunior...','blue');
  const salud = window.NodoSalud?.begin('BILLETERAS');

  const addUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/add/';
  const cur = await window.chunior.getUrl();
  if(!cur.includes('/movimientoficha/add')){
    await window.chunior.navigate(addUrl);
    await new Promise(function(r){setTimeout(r,700);});
  }

  let data = null;
  try {
    data = await window.chunior.exec(
      '(function(){' +
      'var sel=document.getElementById("id_cuenta_destino");' +
      'if(!sel)return null;' +
      'var opts=Array.from(sel.options).filter(function(o){return o.value;}).map(function(o){' +
      '  var t=(o.textContent||o.text||"").trim();' +
      '  var m=t.match(/^(\\d+)\\s*-\\s*(.+)$/);' +
      '  return {uid:String(o.value), nombre:(m?m[2].trim():t)};' +
      '});' +
      'var balances={};var orden=[];' +
      'document.querySelectorAll(".breadcrumbs .billetera").forEach(function(sp){' +
      '  var uid=String(sp.id||"");' +
      '  var txt=(sp.textContent||"").trim();' +
      // El signo puede venir ANTES o DESPUÉS del $ ("-$1.500" / "$-1.500"), o entre paréntesis.
      // El regex viejo era ([\d.,]+): se comía el menos y una billetera en rojo se mostraba en verde.
      '  var mm=txt.match(/^(.+?):\\s*(\\()?\\s*(-)?\\s*\\$?\\s*(-)?\\s*([\\d.,]+)/);' +
      '  if(mm){' +
      '    var neg=!!(mm[2]||mm[3]||mm[4]);' +
      '    balances[uid]={nombre:mm[1].trim(), saldo:(neg?-1:1)*parseFloat(mm[5].replace(/\\./g,"").replace(",","."))};' +
      '    orden.push(uid);' +
      '  }' +
      '});' +
      'var body=(document.body&&document.body.innerText)||"";' +
      // orden = el mismo que ve el operador en Chunior. Un objeto no sirve: las claves numéricas
      // ("905","921") se reordenan solas de menor a mayor y perdíamos el orden real.
      'return {opts:opts, balances:balances, orden:orden, body:body.slice(0,500)};' +
      '})()'
    );
  } catch(e){
    salud?.record('EFFECT','ERROR','BILLETERAS_SIN_SINCRONIZAR');
    if(!silencioso) toast('Error leyendo Chunior: '+(e.message||''), 'red');
    return;
  }

  if(!data || !data.opts || !data.opts.length){
    salud?.record('EFFECT','ERROR','BILLETERAS_SIN_SINCRONIZAR');
    if(!silencioso) toast('No se pudieron leer billeteras de Chunior. ¿Estás en la página correcta?', 'red');
    return;
  }

  const walletsChunior = data.opts.map(function(o){
    const b = data.balances[String(o.uid)] || {};
    return {
      chunior_uid: String(o.uid),
      uid: String(o.uid),
      nombre_visible: (b.nombre || o.nombre || 'Billetera Chunior'),
      nombre: (b.nombre || o.nombre || 'Billetera Chunior'),
      saldo: Number(b.saldo || 0),
      estado: 'ACTIVA',
      activa: true
    };
  });

  const uidsDetectados = walletsChunior.map(function(w){ return String(w.chunior_uid || w.uid || ''); }).filter(Boolean);
  const saldoMap = {};
  const nombreMap = {};
  walletsChunior.forEach(function(w){
    const uidKey = String(w.chunior_uid||w.uid);
    saldoMap[uidKey] = Number(w.saldo||0);
    nombreMap[uidKey] = String(w.nombre || w.nombre_visible || ('Chunior '+uidKey)).trim();
  });
  window.__nodoChuniorWalletUids = uidsDetectados;
  window.__nodoChuniorWalletSaldoByUid = saldoMap;
  if(Array.isArray(data.orden) && data.orden.length) window.__nodoChuniorOrdenUids = data.orden.map(String);
  window.__nodoChuniorWalletNombreByUid = nombreMap;
  window.__nodoOficinaDetectada = (window.oficinaId || '');
  window.__nodoPuestoDetectado  = (window.pcOperativa || pcOperativa || '');
  try{ localStorage.setItem('nodo_chunior_wallet_uids', JSON.stringify(uidsDetectados)); }catch(_e){}
  try{ localStorage.setItem('nodo_chunior_wallet_nombres', JSON.stringify(nombreMap)); }catch(_e){}
  try{ localStorage.setItem('nodo_oficina_id', (window.oficinaId || '')); }catch(_e){}
  try{ localStorage.setItem('nodo_puesto_chunior', (window.pcOperativa || pcOperativa || '')); }catch(_e){}

  // Persistir en Supabase via RPC (panel_nodo_sync_chunior_wallets hace upsert correcto con RLS).
  // Fallback: si la RPC falla, intentamos update directo por uid para no perder los saldos.
  try{
    const { error: rpcErr } = await supabaseClient.rpc('panel_nodo_sync_chunior_wallets', {
      p_pc_codigo: (pcOperativa || window.pcOperativa || ''),
      p_wallets: walletsChunior
    });
    if(rpcErr) throw rpcErr;
    salud?.record('EFFECT','OK');
  }catch(e){
    console.warn('panel_nodo_sync_chunior_wallets falló, usando fallback directo:', e);
    try{
      for(const w of walletsChunior){
        const uid = String(w.chunior_uid || w.uid || '').trim();
        if(!uid) continue;
        await supabaseClient
          .from('billeteras')
          .update({ saldo: Number(w.saldo || 0), updated_at: new Date().toISOString() })
          .eq('chunior_uid', uid)
          .neq('estado','FUSIONADA');
      }
      salud?.record('EFFECT','OK');
    }catch(e2){ salud?.record('EFFECT','ERROR','BILLETERAS_SIN_SINCRONIZAR'); console.warn('fallback sync saldo también falló:', e2); }
  }

  await cargarBilleteras(false);

  // Crear en Supabase las billeteras de Chunior que todavía no existen (por UID).
  // Sin esto, una oficina nueva solo mostraría las billeteras ya cargadas.
  try{
    const _existUids = new Set((billeteras||[]).map(function(b){ return String(b.CHUNIOR_UID||''); }).filter(Boolean));
    const _nuevas = walletsChunior.filter(function(w){
      const uid = String(w.chunior_uid||w.uid||'').trim();
      return uid && !_existUids.has(uid);
    });
    if(_nuevas.length){
      await _crearBilleterasNuevasChunior(_nuevas);
      await cargarBilleteras(false);
    }
  }catch(e){ console.warn('crear billeteras nuevas de Chunior falló:', e); }

  renderInicio();
  try{ renderBilleteras(); }catch(_e){}

  if(!silencioso){
    toast('Sincronización OK · billeteras detectadas: '+uidsDetectados.length, 'green');
  }
}

// ── Sync de saldos POST-ANOTACIÓN (debounced) ────────────────────────────────
// Chunior es la VERDAD ABSOLUTA del saldo (el contador interno está muerto). Tras CADA anotación
// (carga/retiro/propina/depo s/r) refrescamos los saldos reales para que NODO dibuje la verdad.
// Es casi gratis: la ventana de Chunior ya queda en /movimientoficha/add/ tras anotar, que es la
// misma página de donde sincronizarBilleterasChunior lee los breadcrumbs (sin navegación extra).
// Debounce 2.5s (una ráfaga de anotaciones = un solo sync) y si hay una operación en curso se
// reprograma (no navegar Chunior en el medio de otra anotación).
let _syncBilTimer = null;
// ── Lectura PASIVA de los saldos de Chunior ───────────────────────────────────────────────
// NO navega, NO recarga, NO pega a ninguna API: sólo lee el breadcrumb de la ventana de Chunior
// tal como está. Cuando el operador anota algo a MANO en Chunior, esa página se recarga sola y
// el panel se entera en la vuelta siguiente. Antes los saldos sólo se movían tras anotaciones
// hechas desde el panel, así que un movimiento manual dejaba el Inicio mintiendo hasta el
// próximo sync completo.
let _bilPasivoFirma = '';
async function _leerSaldosChuniorPasivo(){
  if(!window.chunior || !window.chunior.exec) return;
  if(!_nodoListo) return;
  if(window.nodoArranqueHabilitado && !window.nodoArranqueHabilitado('billeterasChunior')) return; // espera su paso del arranque
  if(window._cotejoDeclarando) return;                                              // declaración ciega en curso
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return;        // no pisar una operación
  if(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes>0)) return;
  let filas=null;
  try{
    filas = await window.chunior.exec(
      '(function(){var o=[];document.querySelectorAll(".breadcrumbs .billetera").forEach(function(sp){'
      + 'var t=(sp.textContent||"").trim();'
      + 'var m=t.match(/^(.+?):\\s*(\\()?\\s*(-)?\\s*\\$?\\s*(-)?\\s*([\\d.,]+)/);'
      + 'if(m)o.push({uid:String(sp.id||""),nombre:m[1].trim(),'
      + '  saldo:((m[2]||m[3]||m[4])?-1:1)*parseFloat(m[5].replace(/\\./g,"").replace(",","."))});'
      + '});return o;})()'
    );
  }catch(_e){ return; }                       // Chunior en otra página o sin breadcrumb: no pasa nada
  if(!Array.isArray(filas) || !filas.length) return;
  const firma = filas.map(function(f){ return f.uid+':'+f.saldo; }).join('|');
  if(firma === _bilPasivoFirma) return;       // nada cambió → no repintamos al pedo
  _bilPasivoFirma = firma;
  const mapa = window.__nodoChuniorWalletSaldoByUid || (window.__nodoChuniorWalletSaldoByUid = {});
  filas.forEach(function(f){ mapa[String(f.uid)] = Number(f.saldo); });
  window.__nodoChuniorOrdenUids = filas.map(function(f){ return String(f.uid); });
  try{ renderBillerasInicio(); }catch(_e){}
}
try{ setInterval(function(){ _leerSaldosChuniorPasivo().catch(function(){}); }, 12000); }catch(_e){}

window._syncBilleterasTrasAnotacion = function(){
  try{ clearTimeout(_syncBilTimer); }catch(_e){}
  _syncBilTimer = setTimeout(function tick(){
    try{
      if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0){ _syncBilTimer = setTimeout(tick, 3000); return; }
      sincronizarBilleterasChunior(true).catch(function(){});
    }catch(_e){}
  }, 2500);
};

// ══════════════════════════════════════════════════════════════════════════
