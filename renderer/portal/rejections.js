/* Portal: rejections. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRejections = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","abrirModal","actualizarSolicitudPortal","alert","callDrex","supabaseClient","cargarSolicitudesPortal","cerrarModal","document","escapeHtml","localStorage","notificarUsuarioEnChat","registrarEnHistorial","toast","window"]);
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
    // En una carga el titular es el de la cuenta DESDE la que transfirió; en un retiro, el de la cuenta
    // DONDE cobra. Antes los dos decían "desde la que transferís" (docs/FLUJOS.md).
    const laCuenta = tipo==='RETIRO' ? 'de la cuenta donde cobrás' : 'de la cuenta desde la que transferís';
    // 1) Datos nuestros
    const propio = deps.window.esDatoPropioBilletera ? deps.window.esDatoPropioBilletera(titular) : null;
    if(propio) return { motivo:'DATO_PROPIO',
      texto:'El titular que pusiste ("'+titular+'") es el de NUESTRA cuenta, no el tuyo. Poné el nombre completo del titular '+laCuenta+'.' };
    // 2) Sin una sola letra → no es el nombre de una persona
    if(!/[a-záéíóúñü]/i.test(titular)) return { motivo:'SOLO_NUMEROS',
      texto:'El titular tiene que ser un NOMBRE Y APELLIDO, no números. Escribí el nombre del titular '+laCuenta+'.' };
    // 3) Puso su PROPIO USUARIO como titular. Es el caso más común de "completé cualquier cosa":
    //    "usuariobet", "maria112x1". Ningún banco tiene una cuenta a nombre de un alias de casino,
    //    así que el comprobante nunca va a coincidir y el depósito no se puede cotejar.
    if(deps.window._normNombre(titular) === deps.window._normNombre(usuario)) return { motivo:'USUARIO_COMO_TITULAR',
      texto:'Pusiste tu usuario ("'+titular+'") en vez del titular de la cuenta. Necesitamos el NOMBRE Y APELLIDO del titular '+laCuenta+', tal como figura en el banco.' };
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
        // Si no tiene conversación se le abre una (Juan, 2/11): antes se frenaba por D-92 y el
        // motivo del rechazo no le llegaba.
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
  // ── Cotejo de una carga cerrada como "ya cargada" (Juan, 18/11) ─────────────────────────────────
  // Cerrar así no cargaba nada ni dejaba rastro: 9 de 12 de los últimos días no tenían ninguna fila en el
  // historial de NODO y "desaparecían". Antes de cerrar se mira dónde quedó la carga:
  //   · historial de NODO: una carga del mismo usuario y monto desde 2 h antes del pedido (hecha a mano, por
  //     depósito reclamado…). Si no está atada a ningún pedido, se la ata a éste; si está atada a otro, éste
  //     es un pedido repetido.
  //   · AdminOnline, "Movimientos de crédito": un "Deposito de un jugador" por ese monto a ese alias.
  // El operador ve las dos respuestas antes de cerrar. Chunior ya se coteja con el botón Cotejo.
  api._yaCargadaCotejo = async function(s, id){
    const usuario = String((s&&(s.USUARIO||s.USUARIO_JUGADOR))||'').trim();
    const monto = Math.round(Number((s&&(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO))||0));
    const pedidoMs = Date.parse((s&&(s.FECHA_CREACION||s.CREATED_AT||s.created_at))||'') || (Date.now() - 24*3600000);
    const desdeMs = pedidoMs - 2*3600000;
    const out = { usuario, monto, historial:null, repetidoDe:null, historialError:false, agentes:null, agentesEstado:'sin_revisar' };
    try{
      const pat = usuario.replace(/[\\%_]/g, function(c){ return '\\'+c; });
      const r = await deps.supabaseClient.from('historial_ops')
        .select('id,created_at,monto,origen,solicitud_id').ilike('usuario', pat).eq('tipo','CARGA').eq('estado','OK')
        .gte('created_at', new Date(desdeMs).toISOString()).order('created_at',{ascending:true}).limit(30);
      if(r.error || !Array.isArray(r.data)) out.historialError = true;
      else{
        const mismas = r.data.filter(function(h){ return Math.round(Number(h.monto)||0) === monto; });
        out.historial = mismas.find(function(h){ return !h.solicitud_id || String(h.solicitud_id) === String(id); }) || null;
        if(!out.historial){ const otra = mismas.find(function(h){ return h.solicitud_id; }); if(otra) out.repetidoDe = otra; }
      }
    }catch(_e){ out.historialError = true; }
    try{
      if(typeof deps.callDrex === 'function' && deps.window.ctrlElectron){
        const m = await deps.callDrex('leerMovimientosCredito', { desdeMs: desdeMs, alias: usuario });
        if(m && m.ok){
          out.agentes = (m.filas||[]).find(function(f){ return /dep[oó]sito de un jugador/i.test(f.tipo) && /DONE/i.test(f.estado) && Math.round(f.cantidad) === monto; }) || null;
          out.agentesEstado = out.agentes ? 'encontrada' : (m.completo ? 'no_esta' : 'incompleto');
        }else out.agentesEstado = (m && m.needsLogin) ? 'sin_sesion' : 'no_se_pudo';
      }
    }catch(e){ out.agentesEstado = /no permitido|not a function|desconocid/i.test(String(e&&e.message||'')) ? 'no_disponible' : 'no_se_pudo'; }
    return out;
  };
  api._yaCargadaCotejoHtml = function(c){
    const E = deps.escapeHtml, plata = function(n){ return '$' + Number(n||0).toLocaleString('es-AR'); };
    const hora = function(v){ try{ return new Date(v).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(_e){ return String(v||''); } };
    const linea = function(ok, txt){ return '<div style="margin:3px 0;color:'+(ok===true?'#86efac':ok===false?'#fca5a5':'#fde68a')+'">'+(ok===true?'✔ ':ok===false?'✖ ':'⚠ ')+txt+'</div>'; };
    let h = '';
    if(c.historial) h += linea(true, 'Historial de NODO: cargada '+E(plata(c.historial.monto))+' el '+E(hora(c.historial.created_at))+(c.historial.solicitud_id?'':' (sin pedido: se ata a éste)'));
    else if(c.repetidoDe) h += linea(null, 'Pedido repetido: esa carga ya se hizo con el pedido #'+E(String(c.repetidoDe.solicitud_id))+' el '+E(hora(c.repetidoDe.created_at))+'. Al cerrar no se suma otra.');
    else if(c.historialError) h += linea(null, 'No se pudo leer el historial de NODO.');
    else h += linea(false, 'Historial de NODO: no hay ninguna carga de '+E(plata(c.monto))+' a '+E(c.usuario)+' desde 2 h antes del pedido.');
    const ag = { encontrada: c.agentes ? linea(true, 'AdminOnline: '+E(plata(c.agentes.cantidad))+' a '+E(c.agentes.alias)+' el '+E(c.agentes.fecha)) : '',
      no_esta: linea(false, 'AdminOnline: no aparece ninguna carga de '+E(plata(c.monto))+' a '+E(c.usuario)+' desde 2 h antes del pedido.'),
      incompleto: linea(null, 'AdminOnline: no la encontré en las páginas que revisé (hay muchos movimientos). Mirala a mano en Movimientos de crédito.'),
      sin_sesion: linea(null, 'AdminOnline: la sesión está cerrada, no se pudo revisar.'),
      no_disponible: linea(null, 'AdminOnline: esta versión o este casino no tiene ese informe; revisalo a mano.'),
      no_se_pudo: linea(null, 'AdminOnline: no se pudo revisar Movimientos de crédito.'),
      sin_revisar: linea(null, 'AdminOnline: sólo se revisa desde la aplicación de escritorio.') };
    h += ag[c.agentesEstado] || '';
    if(!c.historial && !c.repetidoDe && c.agentesEstado !== 'encontrada')
      h += '<div style="margin-top:6px;color:#fca5a5;font-weight:700">No encontré la carga en ningún lado. Si igual la cerrás, queda en el historial como "sin comprobar".</div>';
    return h;
  };

  api.v154pYaCargada = function(id){
    const s = (deps.V154P.solicitudes||[]).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
    // Sólo cargas: un retiro no se "carga" (docs/FLUJOS.md). Cerrarlo así lo dejaba ACREDITADO y le
    // decía al jugador "Tu carga ya está acreditada".
    if(String((s&&(s.TIPO||s.TIPO_SOLICITUD))||'').toUpperCase()==='RETIRO'){
      try{ deps.toast('Eso es sólo para cargas. Un retiro se aprueba o se rechaza.','yellow'); }catch(_e){}
      return;
    }
    const usuario = String((s&&(s.USUARIO||s.USUARIO_JUGADOR))||'').trim();
    const monto = Number((s&&(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO))||0);

    deps.abrirModal("Marcar como ya cargada · #"+id,
      '<div style="padding:9px 11px;border-radius:9px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.4);color:#bbf7d0;font-size:12.5px;margin-bottom:10px">'
      + 'Se cierra como <b>acreditada</b>, no como rechazo. '
      + (usuario ? ('A <b>'+deps.escapeHtml(usuario)+'</b> le va a figurar la carga confirmada.') : '')
      + '</div>'
      + '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Usala cuando ya le cargaste las fichas por otro lado '
      + '(a mano, por el chat) y esta solicitud quedó dando vueltas. <b>No carga nada:</b> sólo cierra la solicitud.</div>'
      + '<div id="v154pYaCargCotejo" style="padding:8px 10px;border-radius:8px;background:#0d1117;border:1px solid #30363d;font-size:12px;margin-bottom:10px">🔎 Buscando la carga en el historial de NODO y en AdminOnline…</div>'
      + '<label>Aclaración <span style="color:#8b949e;font-weight:400">· opcional, la ve el jugador</span></label>'
      + '<textarea id="v154pYaCargObs" placeholder="Ej: te la cargué a mano recién"></textarea>',
      async function(){
        const obs = ((deps.document.getElementById("v154pYaCargObs")||{}).value||"").trim();
        const c = cotejo ? await cotejo : null;   // si todavía estaba buscando, se espera
        deps.cerrarModal();
        try{
          await deps.actualizarSolicitudPortal(id, "ACREDITADA", {
            etapa: "YA_CARGADA_MANUAL",
            cerrada_como: "YA_CARGADA",
            obs: obs || null,
            operador: (deps.window.operador && (deps.window.operador.usuario||deps.window.operador.nombre)) || 'panel',
            cotejo_ya_cargada: c ? { historial_id: c.historial ? c.historial.id : null, repetido_de: c.repetidoDe ? c.repetidoDe.solicitud_id : null,
              adminonline: c.agentesEstado, adminonline_fecha: c.agentes ? c.agentes.fecha : null } : null
          });
          // Que no desaparezca del historial: se ata la carga encontrada o se anota una fila nueva.
          try{
            if(c && c.historial && !c.historial.solicitud_id){
              await deps.supabaseClient.from('historial_ops').update({ solicitud_id: Number(id) }).eq('id', c.historial.id);
            }else if(c && !c.historial && !c.repetidoDe && typeof deps.registrarEnHistorial === 'function'){
              await deps.registrarEnHistorial({ usuario, tipo:'CARGA', monto, origen:'YA_CARGADA', solicitud_id:Number(id),
                estado: c.agentesEstado === 'encontrada' ? 'OK' : 'SIN_COMPROBAR',
                notas: (c.agentesEstado === 'encontrada' ? 'Cargada por fuera de NODO · AdminOnline '+c.agentes.fecha : 'Cerrada como ya cargada sin encontrarla en NODO ni en AdminOnline')
                  + ' · pedido #'+id + (obs ? ' · '+obs : '') });
            }
          }catch(e){ deps.toast("#"+id+" se cerró, pero no se pudo anotar en el historial: "+(e.message||e), "yellow"); }
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
    const cotejo = api._yaCargadaCotejo(s, id).then(function(c){
      const box = deps.document.getElementById('v154pYaCargCotejo');
      if(box) box.innerHTML = api._yaCargadaCotejoHtml(c);
      return c;
    }).catch(function(){ return null; });
  };

  api.v154pRechazarSolicitud = function(id){
    const s = (deps.V154P.solicitudes||[]).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
    // Motivos rápidos: el usuario los VE en el portal (pantalla Estado), así que tienen que servirle.
    // El textarea arranca VACÍO (antes venía precargado "Rechazada desde panel" → todos veían ese texto inútil).
    // Cada tipo con SUS motivos: un retiro no tiene transferencia ni comprobante del jugador (pide la cuenta
    // donde cobra), así que "no nos llegó tu transferencia" no tiene sentido ahí (docs/FLUJOS.md).
    const _esRetiro = String((s&&(s.TIPO||s.TIPO_SOLICITUD))||'').toUpperCase()==='RETIRO';
    const _rap = _esRetiro ? [
      "Las fichas de tu usuario no alcanzan para ese monto.",
      "El titular de la cuenta donde cobrás no coincide. Escribinos por el chat.",
      "La cuenta de cobro (alias o CBU) no es válida. Revisala y volvé a pedir el retiro.",
      "No pudimos procesar el retiro ahora. Escribinos por el chat y lo resolvemos."
    ] : [
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
      // Si ya se la cargó, esto NO es un rechazo. Sale del rechazo y la cierra bien. SÓLO en cargas: en un
      // retiro lo cerraba como ACREDITADA y le decía al jugador "Tu carga ya está acreditada" (docs/FLUJOS.md).
      (_esRetiro ? '' :
      '<div style="padding:8px 10px;border-radius:9px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.35);margin-bottom:10px;font-size:12.5px;color:#bbf7d0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span>¿Ya se la cargaste por otro lado?</span>'+
      '<button type="button" class="mini-btn green" style="font-size:11.5px" onclick="cerrarModal();v154pYaCargada(\''+id+'\')">✅ Ya se la cargué</button>'+
      '</div>')+
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
