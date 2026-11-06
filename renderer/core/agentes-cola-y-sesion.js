const _RE_DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
const _RE_SEPARADORES = new RegExp('[\\s.,;:¿?¡!\\-_/\\\\]', 'g');
function normalizarUsuarioCasino(u){
  if(u === null || u === undefined) return u;
  return String(u)
    .normalize('NFD')              // descompone caracteres acentuados (á → a + ́)
    .replace(_RE_DIACRITICOS, '')  // quita marcas diacríticas (tildes, diéresis)
    .replace(_RE_SEPARADORES, '')  // quita espacios, puntos, comas, guiones, slashes
    .toLowerCase();
}

// Decide qué alias mandar al casino:
//   - Si el alias NO tiene caracteres "raros" (acentos/puntos/etc) → lo manda tal cual (cero overhead).
//   - Si tiene caracteres raros → chequea en NUESTRA base de "usuarios":
//       · Si existe exactamente con esos caracteres → el casino también lo tiene así → mandar EXACTO.
//       · Si NO existe exactamente → asumimos que se subió normalizado al casino → mandar NORMALIZADO.
//
// El happy-path normal (alias sin chars especiales) NO hace ninguna query extra → no afecta la carga.
async function _resolverAliasParaCasino(usuario){
  if(!usuario) return usuario;
  const norm = normalizarUsuarioCasino(usuario);
  if(norm === usuario) return usuario; // sin caracteres raros, nada que decidir
  try {
    const { data, error } = await supabaseClient
      .from('usuarios')
      .select('usuario')
      .eq('usuario', usuario)
      .limit(1);
    // Si NO pudimos verificar en NODO (ej. 401 del blindaje: la tabla usuarios no se lee directo),
    // NO adivinamos normalizando: mandamos el alias TAL CUAL lo tipeó el operador. Normalizar a ciegas
    // mandaba un alias equivocado al casino → la búsqueda se trababa (cuelgue).
    if(error){ return usuario; }
    if(data && data.length){
      // Match exacto en NODO con esos caracteres → el casino también lo tiene así
      return usuario;
    }
    // No hay match exacto (y SÍ pudimos consultar) → probablemente el casino lo tiene normalizado
    console.log('[alias normalizado] "'+usuario+'" no está exacto en NODO · casino recibe "'+norm+'"');
    return norm;
  } catch(e){
    return usuario; // ante cualquier error, original
  }
}

// ══════════════════════════════════════════════════════════════════════════
// COLA SERIAL DE AGENTES — una sola ventana, un solo script a la vez.
// Antes cada flujo disparaba su automatización cuando se le cantaba y se pisaban: el watchdog de
// fichas (obtenerSaldoAgente) navegaba la ventana en medio de un retiro y le volaba el modal
// → "No se encontró el botón Enviar", y la operación quedaba a medias sin retomar.
// Ahora TODO pasa por acá y se ejecuta de a uno, en orden de llegada.
//   · Un fallo NO rompe la cadena (la siguiente tarea arranca igual).
//   · Tope por tarea: si una se cuelga, se destraba la cola en vez de bloquear el panel para siempre.
//   · ⛔ Cancelar NO se encola: es el freno de emergencia, tiene que pasar por encima.
// Estado visible en consola: window._drexCola  → {activo, pendientes}
// ══════════════════════════════════════════════════════════════════════════
window._drexCola = { activo:null, pendientes:0 };
let _drexColaP = Promise.resolve();
const _DREX_TAREA_MAX_MS = 120000;
// El puente del portal (V15.4) vive en OTRO bloque <script>: se expone para que pueda encolar.
setTimeout(function(){ try{ window._drexEncolar = _drexEncolar; }catch(_e){} },0);
// Nombres lindos para el operador (los métodos internos no le dicen nada).
const _DREX_NOMBRE = { buscarUsuario:'buscar usuario', cargarSaldo:'carga', retirarSaldo:'retiro',
  crearUsuario:'crear usuario', cambiarClave:'cambiar clave', obtenerSaldoAgente:'leer fichas',
  iniciarSesion:'iniciar sesión', verifyUser:'verificar usuario' };
// ── Cortacircuitos por sesión caída ─────────────────────────────────────────────────────────
// Si la sesión de Agentes se cae con la cola llena, cada tarea igual se ejecuta y se queda
// esperando su timeout de 120s. Con 10 encoladas son 20 minutos de panel trabado, y al final
// ninguna hizo nada. Peor: el operador ve "10 esperando" y no sabe que ya está todo perdido.
// Cuando una tarea detecta que no hay sesión, se levanta esta bandera y las que siguen se
// rechazan AL INSTANTE, sin tocar el agente. Se baja sola al reponer la sesión.
window._drexSinSesion = false;
window._drexCanceladas = [];      // qué quedó sin ejecutar, para poder decirlo al reponer
window._drexMarcarSinSesion = function(motivo){
  // NO se sale de entrada si ya estaba marcado. Antes sí, y eso dejaba al panel encerrado: si el
  // operador cerraba el modal, la bandera quedaba en true, nadie se lo volvía a pedir, y encima la
  // cola cancelaba la lectura del watchdog sin tocar Agentes — asi que tampoco se volvía a
  // detectar. El panel se quedaba con la sesión cerrada mostrando «Sin lectura de Drex» en un
  // widget chico y nada más (Juan, 26/9).
  const _yaEstaba = window._drexSinSesion;
  window._drexSinSesion = true;
  if(!_yaEstaba){
    const q = (window._drexCola && window._drexCola.pendientes) || 0;
    window._drexCanceladas = [];
    try{ toast('🔒 Sesión de Agentes caída'+(q>1?(' · se cancelan '+(q-1)+' en cola'):'')+' — abriendo el login…','red'); }catch(_e){}
    console.warn('[cola] sesión caída → se cancela lo encolado ('+q+')');
  }
  window._drexAvisarSinSesion();
  window._drexPedirLogin();
};

// Cartel FIJO mientras la sesión esté caída. El modal se puede cerrar; esto no se va hasta que se
// entra de verdad. Es el «cartel de sesión cerrada como mínimo» que faltaba.
window._drexAvisarSinSesion = function(){
  try{
    let b = document.getElementById('drexSinSesionBanner');
    if(!window._drexSinSesion){ if(b) b.remove(); return; }
    if(!b){
      b = document.createElement('div');
      b.id = 'drexSinSesionBanner';
      b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#7f1d1d;'
        + 'color:#fff;padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;'
        + 'font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.45)';
      document.body.appendChild(b);
    }
    b.innerHTML = '<span style="font-size:18px">🔒</span>'
      + '<b>La sesión de Agentes está cerrada</b>'
      + '<span style="font-weight:400;opacity:.9">No se puede cargar ni retirar hasta entrar.</span>'
      + '<button onclick="_mostrarModalLoginDrex()" style="margin-left:auto;background:#fff;'
      + 'color:#7f1d1d;border:0;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer">'
      + 'Entrar a Agentes</button>';
  }catch(_e){}
};

// Vuelve a ofrecer el login, con espacio entre pedidos: se insiste, pero no se acosa.
window._drexPedirLogin = function(){
  setTimeout(function(){
    try{
      if(!window._drexSinSesion) return;                              // se repuso en el interín
      if(document.getElementById('drexLUser')) return;                 // ya está abierto
      if(Date.now() - (window._drexLoginPedidoEn||0) < 45000) return;  // recién se lo pedimos
      window._drexLoginPedidoEn = Date.now();
      if(typeof _mostrarModalLoginDrex==='function') _mostrarModalLoginDrex();
    }catch(_e){}
  }, 600);
};
window._drexSesionRepuesta = function(){
  if(!window._drexSinSesion) return;
  window._drexSinSesion = false;
  window._drexLoginPedidoEn = 0;
  try{ window._drexAvisarSinSesion(); }catch(_e){}      // saca el cartel
  // Al reponer, se dice QUÉ quedó sin hacer. "Ya podés reintentar" a secas obliga al operador a
  // acordarse de memoria qué estaba haciendo cuando se cayó.
  const c = (window._drexCanceladas||[]).slice(0,4);
  window._drexCanceladas = [];
  try{
    toast('🔓 Sesión repuesta'+(c.length?(' · quedó sin hacer: '+c.join(', ')+' — reintentalo'):' · ya podés seguir'), c.length?'yellow':'green');
  }catch(_e){}
};
function _drexEncolar(nombre, fn, opts){
  const st = window._drexCola;
  const silencioso = !!(opts && opts.silencioso);
  // FEEDBACK: si entra detrás de otra cosa, avisamos que está EN COLA (no trabado). Sin esto el
  // operador aprieta, no pasa nada visible y parece que la app se colgó.
  if(!silencioso && st.activo){
    const enCurso = _DREX_NOMBRE[st.activo.nombre] || st.activo.nombre;
    const mio = _DREX_NOMBRE[nombre] || nombre;
    try{ toast('⏳ "'+mio+'" queda en cola · terminando "'+enCurso+'"'+(st.pendientes>1?(' · '+st.pendientes+' esperando'):''), 'blue'); }catch(_e){}
  }
  st.pendientes++;
  const correr = function(){
    // Si la sesión se cayó mientras esta tarea esperaba, se descarta sin tocar el agente. Antes se
    // ejecutaba igual y se comía sus 120s de timeout, una atrás de otra.
    // Los chequeos de sesión y el login NUNCA se cancelan: son justamente los que la reponen. Si se
    // cancelaran, el cortacircuitos no se podría apagar nunca — quedaba trabado para siempre.
    if(window._drexSinSesion && nombre!=='estadoPagina' && nombre!=='iniciarSesion'){
      if(st.pendientes > 0) st.pendientes--;
      try{ (window._drexCanceladas||[]).push(_DREX_NOMBRE[nombre] || nombre); }catch(_e){}
      try{ if(window._cnFalla) window._cnFalla(nombre, 'no se ejecutó: la sesión ya estaba caída', { capa:'panel' }); }catch(_e){}
      return Promise.reject(new Error('Sesión de Agentes caída — "'+(_DREX_NOMBRE[nombre]||nombre)+'" no se ejecutó. Se abrió el login: entrá y reintentá.'));
    }
    st.activo = { nombre:nombre, desde:Date.now() };
    const t0 = Date.now();
    let _to = null;
    return Promise.race([
      Promise.resolve().then(fn),
      new Promise(function(_res, rej){
        _to = setTimeout(function(){
          rej(new Error('La tarea "'+nombre+'" superó '+Math.round(_DREX_TAREA_MAX_MS/1000)+'s · se destrabó la cola'));
        }, _DREX_TAREA_MAX_MS);
      })
    ]).finally(function(){
      if(_to) clearTimeout(_to);
      const ms = Date.now()-t0;
      if(ms > 8000) console.warn('[cola] '+nombre+' tardó '+ms+'ms · pendientes: '+(st.pendientes-1));
      st.activo = null;
      if(st.pendientes > 0) st.pendientes--;
      // Avisar que la cola sigue con lo que quedó (así el operador ve que retoma solo).
      if(!silencioso && st.pendientes > 0){
        try{ toast('▶ Sigo con lo que quedó · '+st.pendientes+' en cola', 'blue'); }catch(_e){}
      }
    });
  };
  const p = _drexColaP.then(correr, correr);   // corre igual si la anterior falló
  _drexColaP = p.then(function(){}, function(){});  // la cadena nunca se corta
  return p;
}
async function callDrex(method, ...args){
  // El freno de emergencia NO espera en la cola (si no, no frenaría nada).
  if(method === 'abortarOperacion') return window.ctrlElectron.drexAutomation(method, ...args);
  return _drexEncolar(method, async function(){
    // Caja negra: por acá pasan TODAS las llamadas al preload, así que es el lugar donde anotar
    // el camino sin tocar cada operación. No se anotan los argumentos (en iniciarSesion viaja la
    // clave): sólo el método y dónde quedó la pantalla.
    const _cnT0 = Date.now();
    const _wHealth = window.NodoSalud?.begin('WORKERS');
    try{ if(window._cnPaso) window._cnPaso(method, 'inicio'); }catch(_e){}
    // Solo buscarUsuario resuelve el alias inteligentemente.
    // crearUsuario / cambiarClave NO se tocan.
    let _r;
    try{
    if(method === 'buscarUsuario' && args.length > 0 && typeof args[0] === 'string'){
      const aliasFinal = await _resolverAliasParaCasino(args[0]);
      // Reenviamos los args extra (ej: options { skipBalance: true })
      _r = await window.ctrlElectron.drexAutomation('buscarUsuario', aliasFinal, ...args.slice(1));
    } else {
      _r = await window.ctrlElectron.drexAutomation(method, ...args);
    }
    }catch(_cnE){
      _wHealth?.reply(_cnE);
      // El corte puede venir de main (timeout, recarga, ventana cerrada) o del preload. De quién
      // fue lo deduce la caja negra por la firma del mensaje: lo que no reconoce queda
      // 'desconocida' en vez de colgárselo a alguien.
      try{ if(window._cnFalla) window._cnFalla(method, _cnE && (_cnE.message || String(_cnE)), { ms: Date.now()-_cnT0 }); }catch(_e){}
      throw _cnE;
    }
    try{
      const _cnMs = Date.now()-_cnT0;
      const _cnPant = (window._cnPantallaDe && window._cnPantallaDe(_r)) || '';
      // estadoPagina e iniciarSesion devuelven needsLogin como parte NORMAL de su trabajo: eso no
      // es una falla (mismo criterio que _esChequeo, unas líneas más abajo).
      const _cnChequeo = (method==='estadoPagina' || method==='iniciarSesion');
      _wHealth?.record('EFFECT', (_r && _r.ok === false && !_cnChequeo) ? 'ERROR' : 'OK', (_r && _r.ok === false && !_cnChequeo) ? 'WORKER_DREX_FAILED' : 'WORKER_DREX_OK');
      if(_r && _r.ok === false && !_cnChequeo){
        if(window._cnFalla) window._cnFalla(method, _r.message || 'devolvió ok:false', { ms:_cnMs, pantalla:_cnPant, capa:'preload' });
      } else if(window._cnPaso){
        window._cnPaso(method, (_r && _r.needsLogin) ? 'pide-login' : 'ok', { ms:_cnMs, pantalla:_cnPant });
      }
    }catch(_e){}
    // Punto único donde se ve el estado de la sesión: TODO pasa por acá. Si la página pide login,
    // se levanta la bandera y lo que quedó en cola se cancela solo en vez de morir de a 120s.
    // El login exitoso la baja — así se retoma sin tener que reiniciar nada.
    try{
      // OJO con qué se considera "sesión caída". estadoPagina e iniciarSesion devuelven needsLogin
      // como parte NORMAL de su trabajo: ensureDrexSession justamente los usa para decidir si hay
      // que mostrar el login. Tomarlos como caída hacía que el cortacircuitos se disparara en pleno
      // arranque de una carga y cancelara todo lo que venía atrás — con la sesión perfectamente
      // viva. Solicitudes que quedaron en ERROR_OPERATIVO por eso.
      // Sólo cuenta si el que se encontró sin sesión fue una operación REAL, que ya daba por hecho
      // que había sesión.
      const _esChequeo = (method==='estadoPagina' || method==='iniciarSesion');
      // Reloj de la sonda: cualquier operación real que NO pidió login prueba que la sesión
      // está viva. Mientras se opere, no hace falta sondear nada.
      if(!_esChequeo && _r && !_r.needsLogin){ try{ window._drexUltimaOpOk = Date.now(); }catch(_e){} }
      if(_r && _r.needsLogin && !_esChequeo) window._drexMarcarSinSesion(method);
      else if(_r && _r.needsLogin === false) window._drexSesionRepuesta();
      else if(_r && _r.ok === true && method === 'iniciarSesion') window._drexSesionRepuesta();
    }catch(_e){}
    return _r;
  });
}

// Auto-registra o reconoce un usuario después de una operación exitosa.
// Estrategia:
//   1) Buscar el alias en TODA la tabla usuarios (sin filtrar por pc_codigo)
//   2) Si existe en CUALQUIER pc → NO duplicar. Si la pc es distinta a la actual,
//      avisar al operador con un toast informativo (cross-oficina detectado).
//   3) Si NO existe en ninguna → crear en la pc actual con origen 'AUTO_CARGA'.
// Corre en SEGUNDO PLANO: nunca usar await desde el flujo de carga.
// ══════════════════════════════════════════════════════════════════════════════
// AUTO-REGISTRO — DESACTIVADO (2026-08-15). No borrar sin leer esto.
//
// Escribía directo en la tabla `usuarios` con supabaseClient.from().insert(), y eso
// va contra el modelo de seguridad del portal: el anon NO escribe directo, las
// escrituras van por RPC. Verificado en la base: `usuarios` tiene RLS activo y CERO
// políticas, así que para el panel está todo denegado — el INSERT y también el SELECT.
//
// Consecuencia: la función no hacía NINGUNA de sus dos cosas.
//   · El alta nunca insertó: 0 filas con origen='AUTO_CARGA' en toda la base.
//   · El aviso "está registrado en oficina P3" nunca se mostró, porque el SELECT
//     vuelve vacío (RLS no da error al leer, solo devuelve nada) y el código
//     concluía "no existe en ninguna oficina".
// Y el error se tragaba en silencio: solo logueaba si NO había error.
//
// El costo era real: ~5.400 errores 42501 por día en Postgres, cada uno escrito al
// log. Con la base en una instancia chica, eso consume E/S que hace falta para operar.
//
// Se deja como no-op en vez de borrar las 5 llamadas: no cambia nada en los puntos
// que la invocan y queda un solo lugar donde revivirla.
//
// PARA REACTIVARLA hace falta una RPC SECURITY DEFINER con el guard de siempre
// (_panel_data_auth(p_secret)), igual que el resto de las escrituras del panel.
// Antes de escribirla conviene preguntarse si sirve: `usuarios` tiene 149 filas en
// total y la base real de jugadores es usuarios_portal_vinculos (172.000). Todo lo
// que el panel lee de `usuarios` también viene vacío por lo mismo.
// ══════════════════════════════════════════════════════════════════════════════
async function _autoregistrarUsuarioSiFalta(aliasCasino){
  return;   // ver el bloque de arriba
}

// ── Login modal de Casinodrex ─────────────────────────────────────────────────
// Abre el modal si hay que loguearse. Devuelve true si la sesión quedó lista,
// false si el operador canceló o las credenciales fallaron.
// NO guarda credenciales en disco ni en memoria persistente.
let _drexLoginResolve = null;

function _mostrarModalLoginDrex() {
  return new Promise(async function(resolve) {
    _drexLoginResolve = resolve;
    // Auto-login BLINDADO primero: si la oficina tiene credenciales guardadas, la clave se
    // resuelve en el proceso main (nunca en el renderer) y logueamos sin pedirle nada al operador.
    let _autoReason='';
    try{
      if(window.ctrlElectron && window.ctrlElectron.drexAutoLogin){
        try{ toast('Conectando al backoffice…','blue'); }catch(_t){}
        const _pc=(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'';
        const _r=await window.ctrlElectron.drexAutoLogin(_pc);
        if(_r && _r.ok){ _drexLoginResolve=null; try{ toast('Backoffice conectado','green'); }catch(_t){} return resolve(true); }
        _autoReason=(_r && _r.reason) ? String(_r.reason) : 'desconocido';
      } else { _autoReason='sin-puente'; }
    }catch(_e){ _autoReason='excepcion'; console.warn('[drex] auto-login falló, pido credenciales manual:', _e); }
    // Diagnóstico visible: por qué no entró solo (credenciales en admi vs. login fallido vs. falta secret).
    const _autoMsg = _autoReason==='no-creds' ? '⚠️ Auto-login: no hay credenciales de agente cargadas en el admi para esta oficina (cargalas en Oficinas → Guardar agente).'
      : _autoReason==='login-fail' ? '⚠️ Auto-login: las credenciales del admi no pudieron loguear (revisá usuario/clave en el admi).'
      : _autoReason==='missing-secret' ? '⚠️ Auto-login: esta PC no tiene la clave de la oficina (se configura desde NODO ADMIN).'
      : _autoReason==='config' ? '⚠️ Auto-login: config incompleta (oficina/URL).'
      : (_autoReason && _autoReason!=='sin-puente' && _autoReason!=='desconocido') ? ('⚠️ Auto-login no disponible ('+_autoReason+').') : '';
    abrirModal(
      '🔐 Login — Casinodrex Agentes',
      (_autoMsg?('<div style="margin-bottom:8px;color:#fbbf24;font-size:12px;background:rgba(120,90,10,.22);border:1px solid rgba(251,191,36,.4);border-radius:8px;padding:7px 9px">'+_autoMsg+'</div>'):'') +
      '<div style="margin-bottom:10px;color:#c0cad8;font-size:13px">La sesión del backoffice expiró o no está abierta.<br>Ingresá tus credenciales de agente para continuar.</div>' +
      '<label style="color:#c0cad8;font-size:12px;font-weight:700">USUARIO</label>' +
      '<input id="drexLUser" type="text" autocomplete="off" placeholder="(tu usuario de agente)" style="margin-bottom:12px" value="">' +
      '<label style="color:#c0cad8;font-size:12px;font-weight:700">CONTRASEÑA</label>' +
      '<input id="drexLPass" type="password" autocomplete="off" placeholder="(tu clave)" value="">' +
      '<div id="drexLErr" style="color:var(--red);font-size:12px;margin-top:8px;min-height:16px"></div>',
      null,
      'Conectar'
    );
    // Sobrescribir el botón Guardar con lógica propia
    var btn = document.getElementById("modalSaveBtn");
    if(btn) btn.onclick = _ejecutarLoginDrex;
    // Cancelar → resolver false
    var cancelBtn = document.querySelector('#modalOverlay .btn-gray');
    if(cancelBtn) cancelBtn.onclick = function(){ cerrarModal(); if(_drexLoginResolve){ _drexLoginResolve(false); _drexLoginResolve=null; } };
    // Auto-focus + Enter handlers
    setTimeout(function(){
      var u = document.getElementById("drexLUser");
      var p = document.getElementById("drexLPass");
      if(u){
        u.value = ''; u.focus(); u.select();
        u.addEventListener("keydown", function(e){
          if(e.key==="Enter"){ e.preventDefault(); document.getElementById("drexLPass")?.focus(); }
        });
      }
      if(p){
        p.value = '';
        p.addEventListener("keydown", function(e){
          if(e.key==="Enter"){ e.preventDefault(); _ejecutarLoginDrex(); }
        });
      }
    }, 120);
  });
}

async function _ejecutarLoginDrex() {
  var user = (document.getElementById("drexLUser")?.value || "").trim();
  var pass = (document.getElementById("drexLPass")?.value || "").trim();
  var errEl = document.getElementById("drexLErr");
  if(!user || !pass){
    if(errEl) errEl.textContent = "Completá usuario y contraseña.";
    return;
  }
  var btn = document.getElementById("modalSaveBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Conectando..."; }
  if(errEl) errEl.textContent = "";
  try {
    var r = await callDrex("iniciarSesion", user, pass);
    if(r && r.ok){
      // Limpiar handlers ANTES de cerrar para que el próximo modal arranque limpio
      const saveB = document.getElementById('modalSaveBtn');
      if(saveB){ saveB.onclick = null; saveB.disabled = false; saveB.textContent = 'Guardar'; }
      cerrarModal();
      if(_drexLoginResolve){ _drexLoginResolve(true); _drexLoginResolve=null; }
    } else {
      if(errEl) errEl.textContent = r?.message || "Credenciales incorrectas. Verificá y volvé a intentar.";
      if(btn){ btn.disabled = false; btn.textContent = "Conectar"; }
      // No resolver — el modal queda abierto para reintentar
    }
  } catch(e){
    if(errEl) errEl.textContent = "Error: " + (e.message || "sin detalle");
    if(btn){ btn.disabled = false; btn.textContent = "Conectar"; }
  }
}

// Helper usado en TODAS las operaciones automáticas.
// Abre la ventana, verifica sesión, y si falta → modal de login.
// Devuelve true si la sesión está lista para operar.
async function ensureDrexSession() {
  await window.ctrlElectron.openAgentWindow();
  var estado = await callDrex("estadoPagina");
  if(!estado.needsLogin) return true;
  toast("Se requiere iniciar sesión en el backoffice.", "yellow");
  return await _mostrarModalLoginDrex();
}

function autoResBox(id, ok, texto){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerHTML = `<div class="${ok?"ok-box":"err-box"}" style="margin-top:8px">${texto}</div>`;
}

async function abrirBackoffice(){
  if(!enElectron) return;
  // Esta es la ÚNICA función que muestra la ventana de agentes (botón manual del operador)
  await window.ctrlElectron.showAgentWindow();
  await verificarEstadoBackoffice();
}

async function verificarEstadoBackoffice(){
  if(!enElectron) return;
  try{
    const e = await callDrex("estadoPagina");
    const ok = !e.needsLogin;
    document.getElementById("autoEstadoVal").textContent = ok ? "✅ Listo" : "🔐 Requiere login";
    document.getElementById("autoEstadoVal").style.color  = ok ? "var(--green)" : "var(--yellow)";
    document.getElementById("autoEstadoMsg").textContent  = e.message || e.url || "";
  }catch(err){
    document.getElementById("autoEstadoVal").textContent = "⚠ Sin conexión";
    document.getElementById("autoEstadoMsg").textContent = "Abrí el backoffice primero";
  }
}

// ── Switch de backend de Agentes (Casinodrex ⇄ BET300) ───────────────────────
// El proxy de la oficina NO cambia: vive en la sesión persist:nodo-agentes (misma partición
// para ambos backends). Cambiar de backend solo relanza la ventana de agentes con el preload/URL
// del casino elegido; la salida de red (proxy) queda igual. Se PERSISTE en userData (sobrevive updates).
window._agentBackendState = null;
async function nodoCargarBackendAgentes(){
  if(!enElectron || !window.ctrlElectron || !window.ctrlElectron.getAgentBackend) return;
  try{
    const st = await window.ctrlElectron.getAgentBackend();
    window._agentBackendState = st;
    const btn = document.getElementById('agentBackendBtn');
    if(btn && st && st.ok){ btn.textContent = '🎰 Backoffice: '+st.label; btn.dataset.backend = st.backend; }
  }catch(_e){}
}
async function nodoCambiarBackendAgentes(){
  if(!enElectron || !window.ctrlElectron || !window.ctrlElectron.setAgentBackend){ toast('Solo en la app de escritorio','yellow'); return; }
  const st = window._agentBackendState;
  const ops = (st && st.opciones) || [{id:'casinodrex',label:'Casinodrex'},{id:'bet300',label:'BET300 (agentesbet.io)'}];
  const actual = (st && st.backend) || 'casinodrex';
  const otro = ops.find(function(o){ return o.id!==actual; }) || ops[0];
  if(!confirm('¿Cambiar el backoffice de Agentes a "'+otro.label+'"?\n\nSe RELANZA la ventana de agentes (el proxy de la oficina NO cambia). Si no tenés la sesión guardada de ese backoffice, vas a tener que iniciar sesión de nuevo.')) return;
  const btn=document.getElementById('agentBackendBtn'); if(btn){ btn.disabled=true; btn.textContent='🎰 Relanzando…'; }
  try{
    const r = await window.ctrlElectron.setAgentBackend(otro.id);
    if(r && r.ok){
      toast('🎰 Backoffice: '+(r.label||otro.label)+' · ventana relanzada','green');
      await nodoCargarBackendAgentes();
      try{ setTimeout(verificarEstadoBackoffice, 1800); }catch(_e){}
    } else { toast('No se pudo cambiar: '+((r&&r.error)||'error'),'red'); await nodoCargarBackendAgentes(); }
  }catch(e){ toast('Error: '+(e.message||e),'red'); await nodoCargarBackendAgentes(); }
  finally{ if(btn) btn.disabled=false; }
}
window.nodoCargarBackendAgentes = nodoCargarBackendAgentes;
window.nodoCambiarBackendAgentes = nodoCambiarBackendAgentes;

async function testBuscar(){
  if(!enElectron) return;
  const usuario = document.getElementById("autoUsuario").value.trim();
  if(!usuario){ autoResBox("autoBuscarRes", false, "Ingresá un usuario."); return; }
  autoResBox("autoBuscarRes", true, "Buscando...");
  try{
    await window.ctrlElectron.openAgentWindow();
    const r = await callDrex("buscarUsuario", usuario);
    if(r.exists){
      const bal = r.balance ? ` · Saldo: ${r.balance.raw}` : "";
      autoResBox("autoBuscarRes", true, `✅ Encontrado: <b>${r.user}</b>${bal}`);
    } else {
      autoResBox("autoBuscarRes", false, `❌ Usuario "${usuario}" no encontrado.`);
    }
  }catch(err){ autoResBox("autoBuscarRes", false, "Error: " + err.message); }
}

async function testCargar(){
  if(!enElectron) return;
  const usuario = document.getElementById("autoCargarUsuario").value.trim();
  const monto   = Number(document.getElementById("autoCargarMonto").value);
  if(!usuario || !monto){ autoResBox("autoCargarRes", false, "Completá usuario y monto."); return; }
  autoResBox("autoCargarRes", true, "Buscando usuario...");
  try{
    await window.ctrlElectron.openAgentWindow();
    const b = await callDrex("buscarUsuario", usuario); // navega y busca en página limpia
    if(!b.exists){ autoResBox("autoCargarRes", false, `❌ Usuario "${usuario}" no encontrado.`); return; }
    autoResBox("autoCargarRes", true, "Cargando saldo...");
    const r = await callDrex("cargarSaldo", monto);
    document.getElementById("autoResultVal").textContent = `CARGA · ${usuario} · $${monto.toLocaleString("es-AR")}`;
    autoResBox("autoCargarRes", true, `✅ ${r.message || "Carga realizada."}`);
    await window.ctrlElectron.navigateAgent(); // refresca después de cargar
  }catch(err){ autoResBox("autoCargarRes", false, "Error: " + err.message); }
}

async function testRetirar(){
  if(!enElectron) return;
  const usuario = document.getElementById("autoRetirarUsuario").value.trim();
  const monto   = Number(document.getElementById("autoRetirarMonto").value);
  if(!usuario || !monto){ autoResBox("autoRetirarRes", false, "Completá usuario y monto."); return; }

  autoResBox("autoRetirarRes", true, "Verificando política 24hs...");
  const check = await verificarRetiro24h(usuario);
  if(check.bloqueado){
    autoResBox("autoRetirarRes", false, `⚠️ ${check.mensaje}`);
    const proceder = await confirmarRetiroDuplicado(check);
    if(!proceder) return;
  }

  autoResBox("autoRetirarRes", true, "Buscando usuario...");
  try{
    await window.ctrlElectron.openAgentWindow();
    const b = await callDrex("buscarUsuario", usuario);
    if(!b.exists){ autoResBox("autoRetirarRes", false, `❌ Usuario "${usuario}" no encontrado.`); return; }
    const saldo = b.balance?.value ?? -1;
    if(saldo >= 0 && saldo < monto){
      autoResBox("autoRetirarRes", false, `⛔ Saldo insuficiente: ${b.balance.raw.trim()} disponible, se solicitaron $${monto.toLocaleString("es-AR")}.`);
      await window.ctrlElectron.navigateAgent();
      return;
    }
    autoResBox("autoRetirarRes", true, `Encontrado · Saldo: ${b.balance?.raw?.trim() || "—"} · Retirando...`);
    const r = await callDrex("retirarSaldo", monto);
    document.getElementById("autoResultVal").textContent = `RETIRO · ${usuario} · $${monto.toLocaleString("es-AR")}`;
    autoResBox("autoRetirarRes", true, `✅ ${r.message || "Retiro realizado."}`);
    
    // Iba a la tabla `solicitudes`, muerta desde mayo: el retiro no quedaba en el historial ni
    // lo veía la regla de 24 h. Se registra donde se mira de verdad.
    try{
      await registrarEnHistorial({ usuario, tipo:'RETIRO', monto, billetera_id:null,
        billetera_nombre:null, origen:'MANUAL', estado:'OK', notas:'Retiro desde el panel de agentes' });
    }catch(_e){}
    await supabaseClient.from("solicitudes").insert({
      tipo: "RETIRO",
      usuario: usuario,
      monto: monto,
      estado: "PAGADA",
      pc_codigo: pcOperativa,
      origen: "MANUAL",
      operador_usuario: operador?.usuario || operador?.nombre || "Sistema"
    }).catch(err => console.error("Error registrando retiro en Supabase:", err));
    
    await window.ctrlElectron.navigateAgent();
  }catch(err){ autoResBox("autoRetirarRes", false, "Error: " + err.message); }
}

// ── Notificación al usuario por chat ──────────────────────────────────────────
// Le manda un mensaje al chat del usuario (en el portal) para que sepa el resultado de su solicitud.
// Prioriza la búsqueda en el caché local (poblado por el portal RPC) para respetar el pc_codigo
// del portal y evitar duplicados. Usa panel_core_enviar_chat_json cuando el chat ya existe.

// ── Sonda de sesión: enterarse ANTES de que lo descubra una carga ────────────
// En algunas oficinas la sesión de Agentes se cae sola y NODO se entera recién cuando va a
// cargar: justo con un cliente esperando y la plata ya transferida. La sonda hace lo mismo que
// haría una carga —una operación REAL contra el agente— cada tanto, cuando no hay nada en curso.
// Si la sesión está muerta, salta el mismo cortacircuitos de siempre y aparece el login, pero
// con el mostrador vacío en vez de en medio de una operación.
//
// Por qué NO se cambia la clave de un usuario de prueba, que fue la idea original: para detectar
// la caída alcanza con una operación real, y buscarUsuario ES la primera que hace toda carga —
// si la sesión murió, falla igual. Cambiar una clave cada 6 minutos escribe en el sistema de
// juego sin necesidad, y si ese usuario alguna vez resulta ser de alguien real, lo deja afuera.
// El diagnóstico es idéntico y no toca nada.
const SONDA_MINUTOS = 6;
const SONDA_CADA_MS = 60 * 1000;          // se fija cada minuto; sondea sólo si corresponde
window._drexUltimaOpOk = window._drexUltimaOpOk || Date.now();
let _sondaCorriendo = false;

function _sondaAgenteOcupado(){
  try{
    return !!(window._drexGlobalBusy
      || (typeof _watchdog !== 'undefined' && _watchdog && _watchdog.busy > 0)
      || window._v154pParcialBusy
      || window._operacionManualEnCurso
      || window._portalSolicitudOperacionEnCurso
      || (window._drexCola && (window._drexCola.activo || window._drexCola.pendientes > 0)));
  }catch(_e){ return true; }        // ante la duda, NO sondear
}

async function _sondaSesionTick(){
  if(_sondaCorriendo) return;
  if(!window.ctrlElectron) return;                    // sólo en la app de escritorio
  // Sin puesto elegido no hay sesión que cuidar: seis minutos en el login abrían Agentes y
  // refrescaban el panel para ninguna oficina.
  if(window.nodoOficinaLista && !window.nodoOficinaLista()) return;
  if(window._drexSinSesion) return;                   // ya está el login en pantalla
  if(_sondaAgenteOcupado()) return;                   // hay algo operando: eso ya prueba la sesión

  const inactivo = Date.now() - (window._drexUltimaOpOk || 0);
  if(inactivo < SONDA_MINUTOS * 60 * 1000) return;

  _sondaCorriendo = true;
  try{
    // Usuario de prueba de la oficina. Sin uno configurado se cae a ensureDrexSession, que
    // navega y muestra el login si hace falta: detecta menos casos, pero no queda a ciegas.
    const prueba = String(localStorage.getItem('nodo_sonda_usuario') || '').trim();
    if(prueba){
      // Operación REAL: pasa por el mismo camino que la primera parte de una carga, así que
      // si la sesión se cayó, callDrex levanta la bandera y salta el login solo.
      await callDrex('buscarUsuario', prueba);
    }else{
      await ensureDrexSession();
    }
    if(!window._drexSinSesion){
      window._drexUltimaOpOk = Date.now();
      // Refrescar el panel, como pediste: si estuvo quieto seis minutos, lo que muestra ya
      // envejeció. Silencioso: nadie quiere un toast cada seis minutos.
      try{ await refrescarTodo(false); }catch(_e){}
    }
  }catch(e){
    // Si falló por sesión, _drexMarcarSinSesion ya hizo su trabajo desde callDrex.
    console.warn('[sonda sesión]', e && e.message);
  }finally{
    _sondaCorriendo = false;
  }
}

// Configurar el usuario de prueba desde el panel.
window.sondaSesionUsuario = function(u){
  const v = String(u == null ? '' : u).trim();
  try{
    if(v) localStorage.setItem('nodo_sonda_usuario', v);
    else localStorage.removeItem('nodo_sonda_usuario');
  }catch(_e){}
  try{ toast(v ? ('Sonda de sesión: se va a chequear con "' + v + '"') : 'Sonda de sesión sin usuario de prueba', 'blue'); }catch(_e){}
  return v;
};

try{ setInterval(_sondaSesionTick, SONDA_CADA_MS); }catch(_e){}
