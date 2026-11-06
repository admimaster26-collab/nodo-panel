// El resultado de un CAMBIO DE CLAVE va al chat que el jugador tiene abierto: el portal le dice
// "te avisamos por este mismo chat". notificarUsuarioEnChat (abajo) escribe en chat_sesiones /
// chat_mensajes, la generación de chat que el portal ya no lee — la clave se cambiaba y el jugador
// nunca se enteraba (Juan, 12/09). nodoIniciarChat usa su hilo si lo tiene y, si no, lo abre.
// Sólo para la clave: pasar TODOS los avisos por acá marcaría como respondidos chats que esperan a
// un operador, cada vez que se acredita una carga. Eso queda anotado en D-92, sin tocar.
// El aviso va a la conversación que el jugador ve en el portal. notificarUsuarioEnChat (abajo)
// escribe en chat_sesiones / chat_mensajes, la generación de chat que el portal ya no lee.
// Si no tiene conversación abierta se le abre una, también para los avisos automáticos. Antes se
// frenaba para no llenar la bandeja y el aviso se perdía. Juan, 2/11: "no veo necesario trabar
// una característica"; la bandeja ya tiene chats sin contestar que nadie cierra.
async function avisarJugadorEnChat(usuario, texto, opts){
  const crear = true;
  try{
    if(crear && typeof window.nodoIniciarChat === 'function'){
      const r = await window.nodoIniciarChat(usuario, texto);
      if(r && r.ok) return r;
      console.warn('[aviso] no se pudo abrir el chat del portal:', r && r.error);
    } else if(typeof window.nodoEnviarMensajePortal === 'function'){
      const r = await window.nodoEnviarMensajePortal(usuario, texto, false);
      if(r && r.ok) return r;
      // OJO: acá NO salió ningún push. nodoEnviarMensajePortal devuelve 'sin-ticket' ANTES de
      // mandarlo, así que con crearSiNoHay:false y sin conversación abierta el jugador no recibe
      // nada por este camino — se entera por la pantalla de Estado del portal, o no se entera.
      // El comentario anterior decía lo contrario y por eso nadie miraba este caso.
      if(r && r.error === 'sin-ticket') return { ok:false, error:'sin-ticket' };
      console.warn('[aviso] el chat del portal falló:', r && r.error);
    }
  }catch(e){ console.warn('[aviso] chat vivo falló:', e); }
  // El portal ya se intentó arriba: acá se va derecho al camino viejo, sin repetirlo.
  try{ return await notificarUsuarioEnChat(usuario, texto, true); }catch(_e){ return null; }
}
window.avisarJugadorEnChat = avisarJugadorEnChat;
async function _avisarClaveAlJugador(usuario, texto){
  return avisarJugadorEnChat(usuario, texto, { crearSiNoHay:true });
}
window._avisarClaveAlJugador = _avisarClaveAlJugador;

// Diecinueve lugares del panel le avisan algo al jugador llamando acá, y TODOS escribían
// directamente en chat_sesiones / chat_mensajes — la generación de chat que el portal ya no lee.
// El mensaje quedaba guardado en una tabla que nadie mira: ni le llegaba ni se veía el error.
// Se encontró con "marcar como ya cargada" (Juan, 30/9), pero le pasaba a los diecinueve.
//
// En vez de cambiar diecinueve llamadas, el ruteo vive acá: primero se intenta el hilo que el
// portal SÍ lee (y que además dispara el push), y recién si eso no se puede se escribe donde se
// escribía antes. No se abre conversación nueva: eso llenaría la bandeja con un hilo por cada
// aviso automático, que es lo que D-92 vino evitando. Para los avisos que el operador manda a
// propósito está avisarJugadorEnChat(..., {crearSiNoHay:true}).
// Desde el 2/11 también se abre conversación cuando no hay: ver avisarJugadorEnChat.
//
// _sinPortal lo usa avisarJugadorEnChat, que ya probó el portal antes de caer acá: sin esto se
// intentaría dos veces.
async function notificarUsuarioEnChat(usuarioNombre, mensaje, _sinPortal){
  if(!usuarioNombre || !mensaje) return;

  if(!_sinPortal && typeof window.nodoEnviarMensajePortal === 'function'){
    try{
      const r = await (window.nodoIniciarChat || window.nodoEnviarMensajePortal)(usuarioNombre, mensaje, false);
      if(r && r.ok) return r;
      if(!(r && r.error === 'sin-ticket')) console.warn('[aviso] el hilo del portal fallo:', r && r.error);
    }catch(e){ console.warn('[aviso] el hilo del portal fallo:', e); }
  }

  // 1° busca en el caché local de chats (poblado por cargarChats vía RPC del portal)
  let chatId = null;
  const chatLocal = (window.chats || chats || []).find(c=>normalizar(c.USUARIO)===normalizar(usuarioNombre));
  if(chatLocal) chatId = chatLocal.ID_CHAT;

  // 2° si no está en caché, consulta la RPC del portal para encontrar el chat real
  if(!chatId){
    try{
      const r = await supabaseClient.rpc('panel_core_get_chat_sesiones_json', {
        p_pc_codigo: (pcOperativa || window.pcOperativa || '')
      });
      if(!r.error){
        let rows = r.data;
        try{ if(typeof rows === 'string') rows = JSON.parse(rows); }catch(_){}
        if(Array.isArray(rows)){
          const found = rows.find(c=>normalizar(c.usuario||c.USUARIO||'')===normalizar(usuarioNombre));
          if(found) chatId = String(found.chat_id||found.id||found.ID_CHAT||'');
        } else if(rows && Array.isArray(rows.rows)){
          const found = rows.rows.find(c=>normalizar(c.usuario||c.USUARIO||'')===normalizar(usuarioNombre));
          if(found) chatId = String(found.chat_id||found.id||found.ID_CHAT||'');
        }
      }
    }catch(_e){}
  }

  // 3° fallback: busca en la tabla directo (cualquier pc_codigo para este usuario)
  if(!chatId){
    const {data} = await supabaseClient.from("chats")
      .select("id")
      .eq("usuario", usuarioNombre)
      .order("updated_at",{ascending:false})
      .limit(1);
    if(data && data.length) chatId = data[0].id;
  }

  // 4° si aún no hay chat, crea uno (en el scope del portal)
  if(!chatId){
    const {data: usrData} = await supabaseClient.from("usuarios")
      .select("nombre, telefono")
      .eq("usuario", usuarioNombre).maybeSingle();

    const {data: nuevo} = await supabaseClient.from("chats").insert({
      usuario: usuarioNombre,
      nombre_completo: usrData?.nombre || "",
      telefono: usrData?.telefono || "",
      pc_codigo: pcOperativa || window.pcOperativa || '',
      sin_leer: 0
    }).select().single();
    chatId = nuevo?.id;
  }

  if(!chatId) return;

  // 5° envía via RPC (prueba las dos variantes que los patches usan)
  let enviado = false;
  const rpc1 = await supabaseClient.rpc('panel_nodo_send_chat_message', {
    p_chat_id: String(chatId),
    p_mensaje: mensaje,
    p_imagen_url: '',
    p_emisor: 'Sistema',
    p_pc_codigo: (pcOperativa || window.pcOperativa || '')
  });
  if(!rpc1.error){ enviado = true; }

  if(!enviado){
    const rpc2 = await supabaseClient.rpc('panel_core_enviar_chat_json', {
      p_chat_id: String(chatId),
      p_mensaje: mensaje,
      p_emisor: 'Sistema'
    });
    if(!rpc2.error){ enviado = true; }
  }

  if(!enviado){
    // fallback directo si ambos RPCs fallan
    await supabaseClient.from("mensajes_chat").insert({
      chat_id: chatId,
      mensaje,
      tipo_emisor: "OPERADOR",
      emisor: "Sistema",
      pc_codigo: pcOperativa || window.pcOperativa || '',
      leido: false
    });
    await supabaseClient.from("chats").update({
      ultimo_mensaje: mensaje,
      fecha_ultimo: new Date().toISOString()
    }).eq("id", chatId);
  }
}

async function ejecutarAutoClave(id){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s){ alert("Solicitud no encontrada."); return; }

  const usuario     = s.USUARIO || s.USUARIO_JUGADOR || "";
  const claveNueva  = s.PASSWORD_NUEVO || "12345a";

  if(!usuario){ alert("La solicitud no tiene usuario."); return; }

  toast("Abriendo backoffice...","blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  toast(`Buscando ${usuario}...`,"blue");
  const b = await callDrex("buscarUsuario", usuario);
  // Sesión caída o página de error NO es "el usuario no existe": la solicitud queda como estaba.
  if(b && (b.needsLogin || b.pageError)){
    toast('Se cayó la sesión de Agentes · no se tocó la solicitud. Entrá y reintentá.','red');
    throw new Error('sesión de Agentes caída');
  }

  if(!b.exists){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await _avisarClaveAlJugador(usuario,
      `❌ Tu solicitud de cambio de clave fue rechazada: el alias "${usuario}" no se encontró en el sistema de juego. ` +
      `Verificá que sea correcto o contactanos por acá.`);
    toast(`Usuario "${usuario}" no encontrado · rechazada`,"red");
    await refrescarTodo(false);
    return;
  }

  toast(`Cambiando clave a "${claveNueva}"...`,"blue");
  const r = await callDrex("cambiarClave", claveNueva);

  if(r && r.ok === false){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await _avisarClaveAlJugador(usuario,
      `❌ No pudimos cambiar tu clave: ${r.message || "error al ejecutar"}. Contactanos para revisarlo.`);
    toast("Error: "+(r.message||"falló el cambio"),"red");
    await refrescarTodo(false);
    return;
  }

  await actualizarSolicitudSupabase(id, {
    estado: "APROBADA",
    operador_usuario: operador.usuario || operador.nombre || ""
  });

  await _avisarClaveAlJugador(usuario,
    `✅ Tu clave fue actualizada correctamente.\n🔑 Nueva clave: *${claveNueva}*\nIngresá al casino con tu usuario y esta clave.`);

  toast(`Clave cambiada · ${usuario} → ${claveNueva}`, "green");
  await window.ctrlElectron.navigateAgent();
  await refrescarTodo(false);
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMBIO DE CLAVE AUTOMÁTICO
// Un reseteo de clave no necesita criterio del operador: no mueve plata, no hay
// monto que verificar ni comprobante que mirar. Pedir confirmación es hacerlo
// esperar por algo que va a aprobar siempre.
//
// Pero tampoco se dispara a ciegas: entre que la persona pide la clave y que se
// ejecuta puede llegar otra cosa (un retiro del mismo usuario, una carga a medio
// hacer), y el agente es UNO solo. Por eso hay una ventana de gracia con un aviso
// visible y un botón para BLOQUEAR.
//
// Bloqueada, o si la automática falla, la solicitud NO desaparece: queda en la
// bandeja de pendientes con un botón "Realizar" y la clave a la vista. El operador
// la hace cuando puede.
// ══════════════════════════════════════════════════════════════════════════════
const CLAVE_AUTO_SEGUNDOS = 25;   // ventana para bloquear. Si es poco/mucho, se cambia acá.
window._clavesBloqueadas = window._clavesBloqueadas || {};   // id → true (no reintentar sola)
window._clavesEnCuenta   = window._clavesEnCuenta   || {};   // id → timestamp de vencimiento

// El operador frena esta clave. NO la rechaza ni la cancela: la deja para hacerla a mano.
// Se llama "pausar" porque es lo que hace. "Bloquear" no le decía nada a nadie: sonaba a
// bloquear al usuario o a cancelarle el pedido, que es justo lo que no pasa.
window.pausarClaveAuto = function(id){
  window._clavesBloqueadas[String(id)] = true;
  delete window._clavesEnCuenta[String(id)];
  _claveAvisoQuitar(id);
  try{ toast('⏸ En pausa · la clave queda abajo con el botón Realizar','yellow'); }catch(_e){}
  try{ if(typeof renderSolicitudesPortalEnInicio==='function') renderSolicitudesPortalEnInicio(); }catch(_e){}
};
window.bloquearClaveAuto = window.pausarClaveAuto;   // nombre viejo, por si quedó alguna llamada

function _claveAvisoQuitar(id){
  try{ const el=document.getElementById('claveAviso'+id); if(el) el.remove(); }catch(_e){}
}
// El aviso vive arriba de la bandeja, fuera de la tabla: la tabla se repinta sola
// con cada poll y se lo llevaría puesto en el medio de la cuenta regresiva.
function _claveAvisoPintar(id, usuario, clave, restan){
  const cont = document.getElementById('tablaSolicitudesInicio');
  if(!cont || !cont.parentNode) return;
  let el = document.getElementById('claveAviso'+id);
  if(!el){
    el = document.createElement('div');
    el.id = 'claveAviso'+id;
    el.style.cssText = 'background:rgba(124,58,237,.12);border:1px solid #7c3aed66;border-radius:10px;'
      + 'padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    cont.parentNode.insertBefore(el, cont);
  }
  // Lo primero que se lee es QUÉ va a pasar y CUÁNDO, no el detalle. El detalle va abajo.
  // Antes el orden estaba al revés y el botón decía "Bloquear", así que el operador leía
  // los datos, no entendía qué se le pedía, y para cuando ataba cabos ya se había ejecutado.
  el.innerHTML = '<span style="font-size:20px">🔑</span>'
    + '<span style="flex:1;min-width:200px;font-size:13px;color:#c4b5fd">'
    +   '<b style="color:#fff;font-size:14px">Cambiando la clave en '+restan+'s</b>'
    +   '<span style="font-size:11.5px;color:#8b949e"> · se hace solo</span>'
    +   '<br><span style="font-size:12px;color:#c0cad8">'+escapeHtml(usuario)+' → '
    +   '<b style="font-family:ui-monospace,monospace;color:#a78bfa">'+escapeHtml(clave)+'</b></span>'
    + '</span>'
    + '<button class="mini-btn" style="background:#a16207;color:#fff;border:none;font-weight:800;font-size:13px;padding:8px 14px" '
    +   'onclick="pausarClaveAuto('+id+')">⏸ Pausar</button>';
}

// Corre cada segundo: pinta la cuenta regresiva y dispara cuando vence.
let _claveAutoCorriendo = false;
// `estadoCerrado` vive DENTRO del módulo del portal y no existe en el ámbito del panel:
// `typeof estadoCerrado` da 'undefined' acá. Verificado corriendo el bundle entero. Como los
// dos usos estaban escritos como `typeof estadoCerrado==='function' && estadoCerrado(...)`,
// la condición era SIEMPRE falsa y el filtro de "ya cerrada" nunca corría: una solicitud de
// cambio de clave ya aprobada seguía en la lista y el ciclo la volvía a ejecutar cada 25 s.
// Media hora cambiándole la clave al mismo jugador una y otra vez.
const _ESTADOS_CERRADOS = ["ACREDITADA","PAGADA","APROBADA","APROBADA_MANUAL","RECHAZADA",
                           "CANCELADA","CERRADA","CERRADO","FINALIZADA","OK","COMPLETADA","REVERTIDA"];
function _estadoYaCerrado(e){
  return _ESTADOS_CERRADOS.indexOf(String(e||"").trim().toUpperCase()) !== -1;
}
window._estadoYaCerrado = _estadoYaCerrado;

// Segunda red: una solicitud ejecutada NO se vuelve a ejecutar en esta sesión, pase lo que
// pase con el estado. Si el update a la base falla (como pasaba con la tabla muerta), el
// peor caso es que quede en la bandeja — no que se le cambie la clave setenta veces.
window._clavesHechas = window._clavesHechas || {};

async function _claveAutoTick(){
  if(_claveAutoCorriendo) return;
  if(!window.ctrlElectron) return;                       // sólo en la app de escritorio
  let lista = [];
  try{
    lista = ((window.V154P && window.V154P.solicitudes) || []).filter(function(s){
      if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='CAMBIO_CLAVE') return false;
      if(_estadoYaCerrado(s.ESTADO)) return false;
      const id=String(s.ID||s.SOLICITUD_ID||'');
      if(window._clavesHechas[id]) return false;      // ya se ejecutó en esta sesión
      return id && !window._clavesBloqueadas[id];
    });
  }catch(_e){ return; }

  // Limpiar avisos de las que ya no están (se ejecutaron, se rechazaron, se fueron).
  try{
    const vivos = {}; lista.forEach(function(s){ vivos[String(s.ID||s.SOLICITUD_ID)]=1; });
    Object.keys(window._clavesEnCuenta).forEach(function(id){
      if(!vivos[id]){ delete window._clavesEnCuenta[id]; _claveAvisoQuitar(id); }
    });
  }catch(_e){}

  if(!lista.length) return;

  const ahora = Date.now();
  for(const s of lista){
    const id = String(s.ID || s.SOLICITUD_ID || '');
    const usuario = s.USUARIO || s.USUARIO_JUGADOR || '';
    const clave = s.PASSWORD_NUEVO || '12345a';
    if(!usuario) continue;

    if(!window._clavesEnCuenta[id]){
      window._clavesEnCuenta[id] = ahora + CLAVE_AUTO_SEGUNDOS*1000;
      try{ sonido && sonido('nueva'); }catch(_e){}
    }
    const restan = Math.ceil((window._clavesEnCuenta[id]-ahora)/1000);
    if(restan > 0){ _claveAvisoPintar(id, usuario, clave, restan); continue; }

    // Venció la ventana. Si el agente está ocupado NO se fuerza: se deja la cuenta
    // corriendo un poco más. Meterse en el medio de una carga es peor que demorar
    // un reseteo de clave.
    const ocupado = !!(window._drexGlobalBusy
      || (typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0)
      || window._v154pParcialBusy
      || (window._drexCola && (window._drexCola.activo || window._drexCola.pendientes>0)));
    if(ocupado){
      _claveAvisoPintar(id, usuario, clave, 0);
      window._clavesEnCuenta[id] = ahora + 8000;   // reintenta en 8s
      continue;
    }

    _claveAvisoQuitar(id);
    delete window._clavesEnCuenta[id];
    // Se marca ANTES de ejecutar, no después: si el cambio tarda y el tick vuelve a correr,
    // no puede agarrarla de nuevo. Y si falla, tampoco se reintenta sola — el operador tiene
    // el botón "Realizar". Reintentar solo un cambio de clave que quizás ya se hizo es peor.
    window._clavesHechas[id] = Date.now();
    _claveAutoCorriendo = true;
    try{
      await ejecutarAutoClave(id);
    }catch(e){
      // Falló sola → NO se pierde: se marca como bloqueada para que no entre en bucle
      // y quede en la bandeja con el botón "Realizar".
      window._clavesBloqueadas[id] = true;
      try{ toast('No se pudo cambiar la clave sola: '+((e&&e.message)||'')+' · quedó en pendientes','red'); }catch(_e){}
      try{ if(typeof renderSolicitudesPortalEnInicio==='function') renderSolicitudesPortalEnInicio(); }catch(_e){}
    }finally{ _claveAutoCorriendo = false; }
    break;   // de a una por vuelta: el agente es uno solo
  }
}
try{ setInterval(_claveAutoTick, 1000); }catch(_e){}

async function resetClaveRapido(usuario, claveNueva="12345a"){
  if(!window.ctrlElectron){ alert("Solo en la app de escritorio."); return; }
  if(!usuario){ alert("Sin usuario."); return; }

  toast(`Reseteando clave de ${usuario}...`,"blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  const b = await callDrex("buscarUsuario", usuario);
  if(!b.exists){ toast(`Usuario "${usuario}" no encontrado.`,"red"); return; }

  const r = await callDrex("cambiarClave", claveNueva);
  if(r && r.ok === false){ toast("Error: "+(r.message||"falló"),"red"); return; }

  // Sin esto la clave no quedaba en ningún lado: _resetClaveManual sí la registraba, este
  // camino no. Y es el que usan el chat y el perfil, así que después no se le podía decir
  // al jugador cuál es su clave (medido: sólo el 3,9 % de los usuarios la tenía recuperable).
  try{
    await registrarEnHistorial({ usuario, tipo:'RESET_CLAVE', monto:0, origen:'MANUAL',
      estado:'OK', notas:'clave → '+claveNueva });
  }catch(_e){}

  toast(`Clave reseteada a "${claveNueva}"`, "green");
  await window.ctrlElectron.navigateAgent();
}

// Cambiar la clave desde la ficha del jugador, preguntando cuál poner. Va por
// resetClaveRapido porque ese busca al usuario en el agente antes de cambiarla.
window.cambiarClaveJugador = function(usuario){
  const u = String(usuario||"").trim();
  if(!u){ toast("Sin usuario.","red"); return; }
  abrirModal('🔑 Cambiar la clave de '+escapeHtml(u),
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Se la cambiamos en el agente y queda anotada, '
    + 'así después se la podés pasar desde «Datos de ingreso».</div>'
    + '<label>Clave nueva</label>'
    + '<input id="claveNuevaJug" type="text" autocomplete="off" value="12345a">',
    async function(){
      const c = String((document.getElementById("claveNuevaJug")||{}).value||"").trim();
      if(c.length < 6){ toast("La clave tiene que tener al menos 6 caracteres.","red"); return; }
      cerrarModal();
      await resetClaveRapido(u, c);
      try{ pjDatosIngreso(u); }catch(_e){}   // volver a la ficha, ya con la clave
    }, 'Cambiar clave');
};

async function retirarSaldoRapido(usuario, monto){
  if(!window.ctrlElectron){ alert("Solo en la app de escritorio."); return; }
  monto = Number(monto);
  if(!usuario || !monto || monto <= 0){ alert("Usuario y monto requeridos."); return; }

  toast(`Retirando $${monto.toLocaleString("es-AR")} de ${usuario}...`, "blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  const b = await callDrex("buscarUsuario", usuario);
  if(!b.exists){ toast(`Usuario "${usuario}" no encontrado.`,"red"); return; }

  const saldoRawRapido = String(b.balance?.raw || "");
  const saldo = b.balance?.value ?? null;
  const saldoConfiableRapido = /\d/.test(saldoRawRapido) && typeof saldo === "number" && Number.isFinite(saldo);
  if(saldoConfiableRapido && saldo >= 0 && saldo < monto){
    toast(`Saldo insuficiente: ${b.balance.raw.trim()}`, "red");
    await window.ctrlElectron.navigateAgent();
    return;
  }

  const _autoHealth = window.NodoSalud?.begin('AUTOMATISMOS');
  const r = await callDrex("retirarSaldo", monto);
  _autoHealth?.record('EFFECT', (r && r.ok === false) ? 'ERROR' : 'OK', (r && r.ok === false) ? 'AUTO_RETIRO_FAILED' : 'AUTO_RETIRO_OK');
  if(r && r.ok === false){ toast("Error: " + (r.message||"falló"), "red"); return; }

  // Esto insertaba en la tabla `solicitudes`, muerta desde el 30 de mayo: el retiro salía y no
  // quedaba registrado en ningún lado vivo. Y como la regla de 24 h mira historial_ops, este
  // retiro era invisible para ella: la persona podía sacar por acá y volver a sacar por el
  // portal el mismo día. Ahora va al historial de verdad.
  try{
    await registrarEnHistorial({ usuario, tipo:'RETIRO', monto, billetera_id:null,
      billetera_nombre:null, origen:'CHAT', estado:'OK', notas:'Retiro rápido desde el chat' });
  }catch(_e){}
  await supabaseClient.from("solicitudes").insert({
    tipo: "RETIRO",
    usuario: usuario,
    monto: monto,
    estado: "PAGADA",
    pc_codigo: pcOperativa,
    origen: "CHAT",
    operador_usuario: operador?.usuario || operador?.nombre || "Sistema"
  }).catch(err => console.error("Error registrando retiro en solicitudes:", err));

  // Saldo pre / post leídos por el casino (en el mismo modal del retiro)
  const saldoPreCasinoR  = (typeof r?.previousBalance?.value === 'number') ? r.previousBalance.value : null;
  const saldoPostCasinoR = (typeof r?.newBalance?.value === 'number')      ? r.newBalance.value      : null;
  const saldoPreR  = saldoPreCasinoR  !== null ? saldoPreCasinoR  : (b.balance?.value ?? null);
  const saldoPostR = saldoPostCasinoR !== null ? saldoPostCasinoR : (saldoPreR !== null ? saldoPreR - monto : null);

  // Registrar en historial de operaciones para que aparezca en el panel
  const bilR = getBilleraLanding();
  let movChuniorR = null;
  if(bilR && bilR.CHUNIOR_UID){
    try {
      const rChu = await registrarRetiroEnChunior(bilR.CHUNIOR_UID, monto, usuario);
      if(rChu.ok && rChu.movimientoId) movChuniorR = rChu.movimientoId;
      else if(rChu.error) toast('⚠️ Retiro OK en casino pero falló en Chunior: '+rChu.error, 'red');
    } catch(e){ toast('⚠️ Error en Chunior: '+(e.message||''), 'red'); }
  }
  await registrarEnHistorial({
    usuario,
    tipo: 'RETIRO',
    monto,
    billetera_id:        bilR ? bilR.ID_BILLETERA   : null,
    billetera_nombre:    bilR ? bilR.NOMBRE_VISIBLE : null,
    origen: 'CHAT',
    estado: 'OK',
    chunior_movimiento_id: movChuniorR,
    saldo_post: saldoPostR
  });
  // Recién comparamos fichas si Chunior confirmó el movimiento
  if(movChuniorR) _watchdogTrigger(1500);

  toast(`Retiro completado · ${usuario} · $${monto.toLocaleString("es-AR")}`, "green");
  await window.ctrlElectron.navigateAgent();
}

async function cargarSaldoRapido(usuario, monto){
  if(!window.ctrlElectron){ alert("Solo en la app de escritorio."); return; }
  monto = Number(monto);
  if(!usuario || !monto || monto<=0){ alert("Usuario y monto requeridos."); return; }

  toast(`Cargando $${monto} a ${usuario}...`,"blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  // CARGA: no necesitamos balance → skipBalance evita abrir/cerrar modal extra
  const b = await callDrex("buscarUsuario", usuario, { skipBalance: true });
  if(!b.exists){ toast(`Usuario "${usuario}" no encontrado.`,"red"); return; }

  const r = await callDrex("cargarSaldo", monto);
  if(r && r.ok === false){ toast("Error: "+(r.message||"falló"),"red"); return; }

  // Saldo PRE leído del casino o de la búsqueda. POST siempre calculado.
  const saldoPreCasinoC = (typeof r?.previousBalance?.value === 'number') ? r.previousBalance.value : null;
  const saldoPreC  = saldoPreCasinoC !== null ? saldoPreCasinoC : (b.balance?.value ?? null);
  const saldoPostC = (saldoPreC !== null) ? saldoPreC + monto : null;

  // Detección de duplicado SOLO con lectura post confiable
  const saldoPostLeidoC = (typeof r?.newBalance?.value === 'number') ? r.newBalance.value : null;
  const postConfiableC  = saldoPostLeidoC !== null && !r?.newBalance?.unchanged;
  if(saldoPreCasinoC !== null && postConfiableC){
    const movido = saldoPostLeidoC - saldoPreCasinoC;
    const veces  = Math.round(movido / monto);
    if(veces >= 2 && veces <= 4 && Math.abs(movido - veces * monto) < 1){
      toast('🚨 POSIBLE CARGA DUPLICADA ('+veces+'x) · saldo subió de '+money(saldoPreCasinoC)+' a '+money(saldoPostLeidoC), 'red');
    }
  }

  // Auto-registrar al usuario en NODO si no existe (segundo plano)
  if(b?.user) _autoregistrarUsuarioSiFalta(b.user);

  // Registrar en historial de operaciones
  const bilC = getBilleraLanding();
  await registrarEnHistorial({
    usuario,
    tipo: 'CARGA',
    monto,
    billetera_id:     bilC ? bilC.ID_BILLETERA   : null,
    billetera_nombre: bilC ? bilC.NOMBRE_VISIBLE : null,
    origen: 'CHAT',
    estado: 'OK',
    saldo_post: saldoPostC
  });
  // Sin registro en Chunior → no comparamos fichas (daría diferencia segura)

  toast(`Carga completada · ${usuario} · $${monto.toLocaleString("es-AR")}`,"green");
  await window.ctrlElectron.navigateAgent();
}

async function ejecutarAutoRetiro(id){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }

  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s){ alert("Solicitud no encontrada."); return; }

  const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
  const monto   = Number(s.MONTO_REAL || s.MONTO_DECLARADO || s.MONTO || 0);

  if(!usuario){ alert("La solicitud no tiene usuario asociado."); return; }
  if(!monto)  { alert("La solicitud no tiene monto válido."); return; }

  // Las solicitudes nuevas se reconocen por la marca escrita por el RPC beta. Esta ruta de
  // automatización también debe pasar la solicitud completa al mismo control que el pago manual.
  let _retiroMeta = {};
  try{
    const _rawMeta = s.METADATA !== undefined ? s.METADATA : s.metadata;
    _retiroMeta = typeof _rawMeta === 'string' ? JSON.parse(_rawMeta || '{}') : (_rawMeta || {});
  }catch(_e){ _retiroMeta = {}; }
  const _retiroInstrumento = _retiroMeta.retiro_instrumento_v1
    && _retiroMeta.retiro_instrumento_v1.instrumento_id;
  if(_retiroInstrumento){
    if(typeof window.nodoRetiroCuentaValidada !== "function"){
      try{ window.NodoSalud?.begin('RETIROS')?.record('DATA','ERROR','RETIRO_VALIDADOR_NO_CARGADO'); }catch(_e){}
      toast('No se cargó la validación de cuenta de este retiro. No se movió saldo.','red');
      return;
    }
    const _cuenta = await window.nodoRetiroCuentaValidada(id, {
      usuario, monto, destino:s.DESTINO || s.CBU || '', titular:s.TITULAR || s.titular || '', solicitud:s
    });
    if(!_cuenta || !_cuenta.seguir) return;
  }

  // Política de 24hs — advertencia, el operador decide
  const check = await verificarRetiro24h(usuario);
  if(check.bloqueado){
    const proceder = await confirmarRetiroDuplicado(check);
    if(!proceder){
      await notificarUsuarioEnChat(usuario, `⛔ Tu solicitud de retiro fue rechazada: ${check.mensaje}`);
      await actualizarSolicitudSupabase(id, {
        estado: "RECHAZADA",
        operador_usuario: operador.usuario || operador.nombre || ""
      });
      toast(check.mensaje, "red");
      await refrescarTodo(false);
      return;
    }
    // El operador decidió proceder igualmente
  }

  toast("Abriendo backoffice...","blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  toast(`Buscando ${usuario}...`,"blue");
  const b = await callDrex("buscarUsuario", usuario);
  // Sesión caída o página de error NO es "el usuario no existe": la solicitud queda como estaba.
  if(b && (b.needsLogin || b.pageError)){
    toast('Se cayó la sesión de Agentes · no se tocó la solicitud. Entrá y reintentá.','red');
    await refrescarTodo(false); return;
  }
  if(!b.exists){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Tu retiro fue rechazado: el alias "${usuario}" no se encontró en el sistema de juego.`);
    toast(`Usuario "${usuario}" no encontrado · rechazada`,"red");
    await refrescarTodo(false);
    return;
  }

  const saldo = b.balance?.value ?? -1;
  if(saldo >= 0 && saldo < monto){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Tu retiro de $${monto.toLocaleString("es-AR")} fue rechazado: saldo insuficiente (${b.balance.raw.trim()} disponible).`);
    toast(`Saldo insuficiente: ${b.balance.raw.trim()}`,"red");
    await window.ctrlElectron.navigateAgent();
    await refrescarTodo(false);
    return;
  }

  // Confirmación mostrando billetera y saldo antes de ejecutar
  await cargarBilleteras(false);
  const bilConf = getBilleraLanding();
  if(bilConf){
    const saldoBil = Number(bilConf.SALDO||0);
    const confirmMsg = `Retiro automático: $${monto.toLocaleString("es-AR")} para ${usuario}\n\nBilletera: ${bilConf.NOMBRE_VISIBLE}\nSaldo disponible: $${saldoBil.toLocaleString("es-AR")}${saldoBil<monto?" ⚠️ (insuficiente)":""}\n\n¿Confirmar?`;
    if(!confirm(confirmMsg)) return;
  }

  toast(`Retirando $${monto.toLocaleString("es-AR")}...`,"blue");
  const _autoHealth = window.NodoSalud?.begin('AUTOMATISMOS');
  const r = await callDrex("retirarSaldo", monto);
  _autoHealth?.record('EFFECT', (r && r.ok === false) ? 'ERROR' : 'OK', (r && r.ok === false) ? 'AUTO_RETIRO_FAILED' : 'AUTO_RETIRO_OK');

  // Una respuesta ambigua de Agentes no confirma el resultado. No cerrar ni permitir un segundo
  // descuento beta hasta cotejar el historial.
  if(_retiroInstrumento && (!r || (r.ok !== true && r.ok !== false))){
    try{ window.NodoSalud?.begin('RETIROS')?.record('EFFECT','ERROR','RETIRO_PAGO_RESULTADO_AMBIGUO'); }catch(_e){}
    toast('Agentes no confirmó el resultado del retiro. No lo vuelvas a pagar; cotejá el historial.','red');
    await refrescarTodo(false);
    return;
  }

  if(r && r.ok === false){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ No pudimos procesar tu retiro: ${r.message||"falló"}. Contactanos.`);
    toast("Error: "+(r.message||"falló"),"red");
    await refrescarTodo(false);
    return;
  }

  let _selloAuto = null;
  if(_retiroInstrumento){
    if(typeof window.nodoSellarRetiroAprobado === 'function'){
      try{ _selloAuto = await window.nodoSellarRetiroAprobado(id,{solicitud:s,usuario,monto}); }
      catch(_e){ _selloAuto = {ok:false}; }
    }
    if(!_selloAuto || !_selloAuto.ok){
      try{ window.NodoSalud?.begin('RETIROS')?.record('DATA','ERROR','RETIRO_SELLO_NO_CONFIRMADO'); }catch(_e){}
      toast('El retiro ya se ejecutó, pero no se guardó la hora en el servidor. No lo vuelvas a pagar; revisá el historial.','red');
    }
  }

  await actualizarSolicitudSupabase(id, {
    estado: "PAGADA",
    operador_usuario: operador.usuario || operador.nombre || ""
  });

  const bilRetiro = getBilleraLanding();
  if(bilRetiro) await ajustarSaldoBilletera(bilRetiro.ID_BILLETERA, -monto);

  const _hora = _selloAuto && _selloAuto.ok ? _selloAuto.horaExacta
    : (_retiroInstrumento ? '' : (typeof window.nodoHoraExacta === "function" ? window.nodoHoraExacta(new Date()) : new Date().toLocaleTimeString("es-AR")));
  const _mensajePago = _retiroInstrumento && !_hora
    ? `Tu retiro de $${monto.toLocaleString("es-AR")} fue procesado. Estamos revisando el registro del horario; no vuelvas a enviar el retiro. Si tenés dudas, escribinos por este chat.`
    : `✅ Tu retiro de $${monto.toLocaleString("es-AR")} fue procesado a las ${_hora} hs. Lo transferimos a tu CBU/CVU.`;
  await notificarUsuarioEnChat(usuario,_mensajePago);

  toast(`Retiro automático completado · ${usuario} · ${monto.toLocaleString("es-AR")}`, "green");
  {
    const bilR = getBilleraLanding();
    let movChuniorAR = null;
    if(bilR && bilR.CHUNIOR_UID){
      try {
        const rChu = await registrarRetiroEnChunior(bilR.CHUNIOR_UID, monto, usuario);
        if(rChu.ok && rChu.movimientoId) movChuniorAR = rChu.movimientoId;
        else if(rChu.error) toast('⚠️ Retiro OK pero falló en Chunior: '+rChu.error, 'red');
      } catch(e){ toast('⚠️ Error en Chunior: '+(e.message||''), 'red'); }
    }
    const saldoPreCasinoAR  = (typeof r?.previousBalance?.value === 'number') ? r.previousBalance.value : null;
    const saldoPostCasinoAR = (typeof r?.newBalance?.value === 'number')      ? r.newBalance.value      : null;
    const saldoPreAR  = saldoPreCasinoAR  !== null ? saldoPreCasinoAR  : (b.balance?.value ?? null);
    const saldoPostAR = saldoPostCasinoAR !== null ? saldoPostCasinoAR : (saldoPreAR !== null ? saldoPreAR - monto : null);
    await registrarEnHistorial({usuario, tipo:'RETIRO', monto, billetera_id:bilR?bilR.ID_BILLETERA:null, billetera_nombre:bilR?bilR.NOMBRE_VISIBLE:null, origen:'AUTO', estado:'OK', solicitud_id:id, chunior_movimiento_id:movChuniorAR, saldo_post:saldoPostAR});
    if(movChuniorAR) _watchdogTrigger(1500);
  }
  await window.ctrlElectron.navigateAgent();
  await refrescarTodo(false);
}

async function ejecutarAutoCarga(id){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }

  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s){ alert("Solicitud no encontrada."); return; }

  const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
  const monto   = Number(s.MONTO_REAL || s.MONTO_DECLARADO || s.MONTO || 0);

  if(!usuario){ alert("La solicitud no tiene usuario asociado."); return; }
  if(!monto)  { alert("La solicitud no tiene monto válido."); return; }

  toast("Abriendo backoffice...","blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  toast(`Buscando usuario ${usuario}...`,"blue");
  // CARGA auto: no necesitamos balance del jugador → evitamos el abrir/cerrar modal
  const busqueda = await callDrex("buscarUsuario", usuario, { skipBalance: true });
  // Sesión caída o página de error NO es "el usuario no existe": la solicitud queda como estaba.
  if(busqueda && (busqueda.needsLogin || busqueda.pageError)){
    toast('Se cayó la sesión de Agentes · no se tocó la solicitud. Entrá y reintentá.','red');
    await refrescarTodo(false); return;
  }
  if(!busqueda.exists){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Tu carga de $${monto.toLocaleString("es-AR")} fue rechazada: el alias "${usuario}" no se encontró en el sistema de juego. Verificá tu usuario o contactanos.`);
    toast(`Usuario "${usuario}" no encontrado · rechazada`,"red");
    await refrescarTodo(false);
    return;
  }

  toast(`Cargando $${monto.toLocaleString("es-AR")}...`,"blue");
  const resultado = await callDrex("cargarSaldo", monto);

  if(!resultado.ok && resultado.ok !== undefined){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Error al cargar tus $${monto.toLocaleString("es-AR")}: ${resultado.message || "sin detalle"}. Contactanos para revisarlo.`);
    toast("Error al cargar saldo: " + (resultado.message || "sin detalle"), "red");
    await refrescarTodo(false);
    return;
  }

  await actualizarSolicitudSupabase(id, {
    estado: "ACREDITADA",
    operador_usuario: operador.usuario || operador.nombre || ""
  });

  const bilLanding = getBilleraLanding();
  if(bilLanding) await ajustarSaldoBilletera(bilLanding.ID_BILLETERA, monto);

  await notificarUsuarioEnChat(usuario,
    `✅ Tu carga fue acreditada: $${monto.toLocaleString("es-AR")}. ¡Ya podés jugar!`);

  toast(`Carga automática completada · ${usuario} · ${monto.toLocaleString("es-AR")}`, "green");

  // Registrar el movimiento en Chunior (solo si la billetera tiene chunior_uid configurado)
  let movimientoChunior = null;
  const bilL = getBilleraLanding();
  if(bilL && bilL.CHUNIOR_UID){
    try {
      const rChu = await registrarCargaEnChunior(bilL.CHUNIOR_UID, monto, usuario);
      if(rChu.ok && rChu.movimientoId){
        movimientoChunior = rChu.movimientoId;
        toast(`📋 Movimiento Chunior N° ${rChu.movimientoId}`, 'blue');
      } else if(rChu.error){
        // Las fichas YA salieron. Si Chunior no la tomó, la anotación NO se pierde: queda guardada
        // y se reintenta sola cuando Chunior vuelve. Antes acá terminaba todo con un toast rojo y
        // el descuadre aparecía recién al cotejar, horas después.
        toast('⚠️ Carga OK en casino pero falló en Chunior: '+rChu.error, 'red');
        // Las fichas ya salieron: la anotación queda pendiente y se reintenta sola.
        try{ window.chuniorPendienteAdd({ tipo:'CARGA', uid:bilL.CHUNIOR_UID, monto:monto, usuario:usuario, motivo:rChu.error }); }catch(_e){}
      }
    } catch(e){
      toast('⚠️ Error registrando en Chunior: '+(e.message||''), 'red');
      try{ window.chuniorPendienteAdd({ tipo:'CARGA', uid:bilL.CHUNIOR_UID, monto:monto, usuario:usuario, motivo:e.message||'excepción' }); }catch(_e){}
    }
  }

  // Saldo PRE leído del casino o busqueda. POST siempre calculado.
  const saldoPreCasinoAC = (typeof resultado?.previousBalance?.value === 'number' && !resultado?.previousBalance?.unchanged) ? resultado.previousBalance.value : null;
  const saldoPreAC  = saldoPreCasinoAC !== null ? saldoPreCasinoAC : (busqueda.balance?.value ?? null);
  const saldoPostAC = (saldoPreAC !== null) ? saldoPreAC + monto : null;

  // Duplicado: solo si post fue confiable
  const saldoPostLeidoAC = (typeof resultado?.newBalance?.value === 'number') ? resultado.newBalance.value : null;
  const postConfiableAC  = saldoPostLeidoAC !== null && !resultado?.newBalance?.unchanged;
  if(saldoPreCasinoAC !== null && postConfiableAC){
    const movidoAC = saldoPostLeidoAC - saldoPreCasinoAC;
    const vecesAC  = Math.round(movidoAC / monto);
    if(vecesAC >= 2 && vecesAC <= 4 && Math.abs(movidoAC - vecesAC * monto) < 1){
      toast('🚨 POSIBLE CARGA DUPLICADA ('+vecesAC+'x) · saldo subió de '+money(saldoPreCasinoAC)+' a '+money(saldoPostLeidoAC), 'red');
    }
  }
  // Auto-registrar al usuario en NODO si no existe (segundo plano)
  if(busqueda?.user) _autoregistrarUsuarioSiFalta(busqueda.user);
  await registrarEnHistorial({usuario, tipo:'CARGA', monto, billetera_id:bilL?bilL.ID_BILLETERA:null, billetera_nombre:bilL?bilL.NOMBRE_VISIBLE:null, origen:'AUTO', estado:'OK', solicitud_id:id, chunior_movimiento_id:movimientoChunior, saldo_post:saldoPostAC});
  if(movimientoChunior) _watchdogTrigger(1500);
  await window.ctrlElectron.navigateAgent();
  await refrescarTodo(false);
}

