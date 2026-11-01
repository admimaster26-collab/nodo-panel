function normalizarPcCodigo(textPuesto){
  const base = String(textPuesto||'')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]','g'), '')   // diacríticos
    .replace(/^\s*puesto\s+/i, '')                      // saca "Puesto " del prefijo
    .replace(/[^A-Za-z0-9]/g, '')                       // solo alfanumérico
    .toUpperCase();
  // Canónico: el sistema entero usa P1..P5 (el admi, el snapshot, el proxy, las promos).
  // Si el puesto viene como "PC5", lo dejamos como "P5"; de lo contrario las billeteras y
  // todo lo demás quedan colgados en una oficina fantasma "PC5" que el admi (que filtra por
  // P5) nunca ve. Espeja el normPc del admi.
  return base.replace(/^PC(\d+)$/, 'P$1');
}

// Busca / crea la oficina en Supabase. Devuelve {pc_codigo, nombre, chunior_pt_id, esNueva}.
async function _asegurarOficina(pcCodigo, nombre, chuniorPtId){
  if(!pcCodigo) return { pc_codigo:'', nombre:'', esNueva:false };
  // La tabla 'oficinas' no existe en el Supabase unificado; los datos de oficina
  // viven en nodo_oficina_aliases. Devolvemos sin tocar Supabase (evita 404).
  return { pc_codigo:pcCodigo, nombre, chunior_pt_id:String(chuniorPtId||''), esNueva:false };

}

async function login(){
  const usuario=val("loginUsuario").trim();
  const clave=val("loginClave").trim();
  if(!usuario||!clave){setBox("loginMsg",`<div class="alert-box">Completá usuario y clave.</div>`);return}
  setBox("loginMsg",`<div class="alert-box">Validando en Chunior...</div>`);

  // Validar contra Chunior. No guardamos la clave en ningún lado.
  let okBackoffice = false;
  const _connHealth = window.NodoSalud?.begin('CONEXION');
  try {
    okBackoffice = await validarLoginChunior(usuario, clave);
  } catch(e){
    // Chunior en 403/CSRF → no aparece el formulario de login. Reset DURO (limpia cookies + GET a la
    // base) y reintentamos una vez, así el operador no queda trabado en el login.
    const _esCsrf = /formulario de login|403|csrf|forbidden/i.test(String((e&&e.message)||""));
    if(_esCsrf && window.chunior && window.chunior.reset){
      setBox("loginMsg",`<div class="alert-box">Chunior estaba trabado (CSRF) — reiniciándolo y reintentando…</div>`);
      try{ await window.chunior.reset({hard:true}); }catch(_e){}
      await new Promise(function(r){ setTimeout(r,1400); });
      try{ okBackoffice = await validarLoginChunior(usuario, clave); }
      catch(e2){
        setBox("loginMsg",`<div class="err-box">No se pudo conectar con Chunior tras reiniciarlo. ${escapeHtml(e2.message||"")}<br><span class="small">Cerrá la ventana de Chunior y reabrí la app si persiste.</span></div>`);
        return;
      }
    } else {
      setBox("loginMsg",`<div class="err-box">No se pudo conectar con Chunior. ${escapeHtml(e.message||"")}</div>`);
      return;
    }
  }
  if(!okBackoffice){
    setBox("loginMsg",`<div class="err-box">Usuario o clave incorrectos (rechazado por Chunior).</div>`);
    return;
  }

  // Operador "ligero": solo lo que vino del input. La oficina (pc_codigo) se setea
  // recién cuando el operador elija el puesto en el modal de Chunior.
  operador = {
    usuario,
    nombre:        usuario,
    rol:           "OPERADOR",
    tipoOperador:  "OPERADOR",
    pc:            "",
    pcsDisponibles:[],
    requiereSeleccionPc:false
  };
  // Espejar en window: media docena de módulos (el chat, entre otros) leen window.operador
  // porque están dentro de IIFEs y no ven esta variable. Hasta ahora window.operador se
  // llenaba en UN solo lugar y solo cuando Chunior detectaba un cambio de turno, así que en
  // el caso normal quedaba vacío: el chat firmaba "panel" y 1.833 de 2.334 respuestas humanas
  // no se podían atribuir a nadie.
  try{ window.operador = operador; }catch(_e){}

  setBox("loginMsg",`<div class="alert-box">Chunior OK. Esperando selección de puesto...</div>`);
  // Disparar el flujo de Chunior post-login. _chuniorConfirmarPuesto
  // se encarga de setear pcOperativa, asegurar la oficina y finalizar el login.
  _connHealth?.record('CONNECTED','OK','CHUNIOR_LOGIN_OK');
  _checkPuestoPostLogin();
}

// Inyecta usuario/clave en la VENTANA de Chunior (separada, visible) y verifica si fue aceptado
async function validarLoginChunior(usuario, clave){
  if(!window.chunior || !window.chunior.exec) throw new Error('Ventana de Chunior no disponible (correr en Electron).');

  // 1) ¿Hay sesión activa? Buscar el botón "Cerrar sesión" (presente en TODAS las páginas internas de Chunior).
  //    Si existe → click → esperar a que aparezca el form de login.
  const huboLogout = await window.chunior.exec(
    '(function(){' +
    'var n=document.querySelectorAll("button,a,input[type=\'submit\']");' +
    'for(var i=0;i<n.length;i++){' +
    '  var t=((n[i].textContent||n[i].value||"")+"").trim().toLowerCase();' +
    '  if(t.indexOf("cerrar sesi")>=0||t.indexOf("logout")>=0){' +
    '    n[i].click();' +
    '    return true;' +
    '  }' +
    '}' +
    'return false;' +
    '})()'
  );

  if(huboLogout){
    // Tras logout, Chunior muestra una página intermedia con un link "Identificarse de nuevo".
    // Lo clickeamos para llegar al form de login. Después esperamos a #id_username.
    const t0 = Date.now();
    let yaClickeoIdentificar = false;
    while(Date.now() - t0 < 10000){
      await new Promise(function(r){ setTimeout(r, 300); });
      try {
        const estado = await window.chunior.exec(
          '(function(){' +
          'if(document.getElementById("id_username")) return "login";' +
          // Buscar "Identificarse de nuevo" (link o botón) y clickearlo
          'var n=document.querySelectorAll("a,button,input[type=\'submit\']");' +
          'for(var i=0;i<n.length;i++){' +
          '  var t=((n[i].textContent||n[i].value||"")+"").trim().toLowerCase();' +
          '  if(t.indexOf("identificarse")>=0 || t.indexOf("iniciar sesi")>=0){' +
          '    n[i].click(); return "click";' +
          '  }' +
          '}' +
          'return "wait";' +
          '})()'
        );
        if(estado === 'login') break;
        if(estado === 'click') yaClickeoIdentificar = true;
      } catch(e){}
    }
  } else {
    // No hay sesión activa y tampoco tenemos form de login a la vista → forzar carga del home
    const cur = await window.chunior.getUrl();
    const enLogin = await window.chunior.exec('(function(){return !!document.getElementById("id_username");})()').catch(function(){return false;});
    if(!enLogin && !cur.includes('/login/')) await window.chunior.navigate(CHUNIOR_HOME);
  }

  // 2) Inyectar usuario + clave en la misma pasada y submit
  const inyectado = await window.chunior.exec(
    '(function(){'
    + 'var u=document.getElementById("id_username");'
    + 'var p=document.getElementById("id_password");'
    + 'var b=document.querySelector("input[type=\'submit\'],button[type=\'submit\']");'
    + 'if(!u||!p||!b) return false;'
    + 'u.value='+JSON.stringify(usuario)+';'
    + 'p.value='+JSON.stringify(clave)+';'
    + 'u.dispatchEvent(new Event("input",{bubbles:true}));'
    + 'p.dispatchEvent(new Event("input",{bubbles:true}));'
    + 'b.click();'
    + 'return true;'
    + '})()'
  );
  if(!inyectado) throw new Error('No se encontró el formulario de login en Chunior.');

  // 3) Polling del DOM: el pt selector también está en /login/, por eso miramos el DOM, no la URL
  //    - aparece #id_pt → login OK, hay que elegir puesto
  //    - desaparece #id_username → login OK, sesión completa
  //    - aparece .errornote → clave mala, no esperar más
  //    - sigue #id_username sin error → todavía procesando
  const inicio = Date.now();
  while(Date.now() - inicio < 20000){
    await new Promise(function(r){ setTimeout(r, 400); });
    try {
      const state = await window.chunior.exec(
        '(function(){'
        + 'if(document.getElementById("id_pt")) return "pt";'
        + 'if(document.querySelector("p.errornote, .errornote")) return "error";'
        + 'if(!document.getElementById("id_username")) return "logged";'
        + 'return "login";'
        + '})()'
      );
      if(state === 'pt' || state === 'logged') return true;
      if(state === 'error') return false;
    } catch(e){}
  }
  return false;
}

// finalizarLogin se llama desde _chuniorConfirmarPuesto (ya con pcOperativa seteado).
// Ya no dispara _checkPuestoPostLogin (eso ya pasó antes en el flujo).
function finalizarLogin(guardar=true){
  if(guardar){
    localStorage.setItem("nodo_operador_lite",JSON.stringify(operador));
    localStorage.setItem("nodo_pc_operativa_lite",pcOperativa);
  }
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.body.classList.add("app-lista");
  try{ _updaterAnclar(); }catch(_e){}
  setBox("operadorInfo",`
    <b>${operador.nombre||operador.NOMBRE}</b><br>
    <span class="badge badge-blue">Rol: ${operador.rol||"OPERADOR"}</span>
    <span class="badge badge-ok">Oficina: ${pcOperativa}</span>
  `);
  _nodoListo = true;
  refrescarTodo(false);
  iniciarRealtimeSolicitudes();
  iniciarBroadcastSolicitudes();
  iniciarBroadcastChat();
  _panelRealtime().startPolling();
}

// Adaptador de los handlers existentes. El servicio posee canales, timers y lecturas.
let _realtimeService = null;
function _panelRealtime(){
  if(!_realtimeService) _realtimeService = NodoRealtime.create({
    client: supabaseClient,
    getOffice: () => pcOperativa,
    getAliases: () => typeof pcAliasesHist === 'function' ? pcAliasesHist() : [pcOperativa],
    hasOpenChat: () => !!((window.V154P && window.V154P.chatActual) || window.chatActualId || chatActualId),
    refresh: {
      requests: () => typeof cargarSolicitudesPortal === 'function' ? cargarSolicitudesPortal(true) : cargarSolicitudes(true),
      wallets: () => cargarBilleteras(false),
      chats: () => {
        // Durante el cambio de caminos, el reloj de la lista también trae las conversaciones del
        // canal nuevo. Sin await ni encadenado: si ese lado no contesta, la lista de siempre se
        // dibuja igual (Juan, 2/10).
        try{ if(window._chatCanalNuevo) window._chatCanalNuevo.cargar(); }catch(_e){}
        return typeof cargarChatsPortal === 'function' ? cargarChatsPortal(true) : cargarChats(true);
      },
      conversation: () => typeof cargarChatPortalActual === 'function' ? cargarChatPortalActual(true) : cargarChatActual(true)
    },
    // Devuelve una firma corta de cómo está la bandeja. Mientras no cambie, no se baja la lista.
    // Si la RPC no está (panel viejo contra base vieja) devuelve null y queda sólo el reloj de 60 s.
    senal: async () => {
      try{
        const r = await window.panelAPI.rpc('panel_bandeja_senal', { p_pc_codigo: pcOperativa || '' });
        if(!r || r.error) return null;
        let d = r.data;
        if(typeof d === 'string'){ try{ d = JSON.parse(d); }catch(_e){ return null; } }
        if(Array.isArray(d)) d = d[0];
        if(!d || d.ok !== true) return null;
        return String(d.abiertas) + '|' + String(d.ultima || '') + '|' + String(d.ultima_alta || '');
      }catch(_e){ return null; }
    },
    notify: message => toast(message),
    playSound: type => sonido(type)
  });
  return _realtimeService;
}
function iniciarRealtimeSolicitudes(){ _panelRealtime().subscribeRequests(); }
function iniciarBroadcastSolicitudes(){ _panelRealtime().subscribeRequestBroadcast(); }
function iniciarBroadcastChat(){ _panelRealtime().subscribeChatBroadcast(); }
function _rtEsMiOficina(pc){ return _panelRealtime().isMyOffice(pc); }
function detenerRealtime(){
  if(_realtimeService) _realtimeService.stop();
  _realtimeService = null;
}
window.addEventListener('beforeunload', detenerRealtime);

// Minimizar/restaurar la bandeja de chat (solo desktop). Persiste en localStorage.
// Minimizado: el chat se oculta y el main ocupa todo el ancho (mejor vista del historial).
// Se restaura tocando "Chat" en el menú.
window.nodoChatMin = function(min){
  try{
    if(min){ document.body.classList.add('chat-min'); localStorage.setItem('nodo_chat_min','1'); }
    else { document.body.classList.remove('chat-min'); localStorage.removeItem('nodo_chat_min'); }
  }catch(_e){}
};
try{ if(localStorage.getItem('nodo_chat_min')==='1') document.body.classList.add('chat-min'); }catch(_e){}

