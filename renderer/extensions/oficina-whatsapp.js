/* ══════════════════════════════════════════════════════════════════════════════════════════
   EL WHATSAPP QUE VE EL JUGADOR · lectura, rotación y constancia (13/11)

   El Portal muestra un botón de WhatsApp. Si la línea que está publicada se cae, el botón
   sigue ahí y manda a un número muerto: el jugador escribe y nadie le contesta nunca. Esto
   es lo que se encarga de que el número publicado sea siempre uno que esté andando.

   Quién decide qué: el servidor. panel_oficina_wsp_estado contesta de una lectura qué hay que
   hacer ahora (campo `pide`) y esta pantalla sólo muestra eso y ofrece el botón que
   corresponde. Acá no hay reglas duplicadas: si mañana cambia el criterio, cambia en un solo
   lugar y todas las PCs lo ven sin actualizar NODO.

   Lo que WTK puede y lo que no (verificado contra la API el 13/11): dice cuántas líneas hay,
   cómo se llaman y cuál está arriba. El TELÉFONO de cada línea no está en la API —
   GET /whatsapps devuelve sólo id, name, status y channel, y el detalle de una línea da 404.
   Por eso el número de cada línea se carga una vez a mano, y de ahí en adelante la rotación
   se hace sola.

   Se engancha en el aviso de líneas caídas (renderer/core/configuracion-y-estado.js): cuando
   aparece ese cartel es justo el momento de revisar si la que se cayó es la publicada.
   Pedido de Juan, 13/11.
   ══════════════════════════════════════════════════════════════════════════════════════════ */
(function(){
  "use strict";

  var ESTADO = null;          // lo último que contestó el servidor
  var ULTIMA_ROTACION = null;
  var TRABAJANDO = false;
  var BACKOFFICE = null;      // lo último que dijo la pantalla de Integraciones
  var BACKOFFICE_AT = 0;
  var REVISANDO = false;

  function _pc(){
    try{
      return (typeof pcOperativa !== "undefined" ? pcOperativa : "") || window.pcOperativa || "";
    }catch(_e){ return window.pcOperativa || ""; }
  }
  function _operador(){
    try{
      var o = window.operador || (typeof operador !== "undefined" ? operador : null);
      return (o && (o.usuario || o.nombre)) || "";
    }catch(_e){ return ""; }
  }
  function _esc(v){
    try{ return window.escapeHtml ? window.escapeHtml(String(v == null ? "" : v)) : String(v == null ? "" : v); }
    catch(_e){ return String(v == null ? "" : v); }
  }
  // 5491123456789 → 11 2345-6789  ·  5492236700367 → 223 670-0367
  // El código de área tiene 2 dígitos SOLO en el 11; en el resto del país son 3 (en algunos
  // pueblos 4, que se muestran como 3: los dígitos están todos y en orden igual). Antes se
  // partía siempre de a 2 y un número de Mar del Plata se leía "22 3670-0367".
  function _lindo(num){
    var d = String(num || "").replace(/[^0-9]/g, "");
    if(d.length === 13 && d.slice(0, 3) === "549") d = d.slice(3);
    else if(d.length === 12 && d.slice(0, 2) === "54") d = d.slice(2);
    if(d.length !== 10) return String(num || "");
    var area = d.slice(0, 2) === "11" ? 2 : 3;
    var resto = d.slice(area);
    return d.slice(0, area) + " " + resto.slice(0, resto.length - 4) + "-" + resto.slice(-4);
  }
  // Para comparar dos números escritos distinto: los últimos 10 dígitos son el número de verdad,
  // esté con 549, con 54, con 0 adelante o pelado.
  function _clave(num){
    var d = String(num || "").replace(/[^0-9]/g, "");
    return d.length >= 10 ? d.slice(-10) : "";
  }
  async function _rpc(fn, extra){
    var params = { p_secret: window.PANEL_DATA_SECRET, p_pc: _pc() };
    if(extra){ for(var k in extra){ if(Object.prototype.hasOwnProperty.call(extra, k)) params[k] = extra[k]; } }
    var r = await supabaseClient.rpc(fn, params);
    if(r.error) throw r.error;
    var d = r.data;
    try{ if(typeof d === "string") d = JSON.parse(d); }catch(_e){}
    return d;
  }
  function _avisar(txt){
    try{ if(window.toast) window.toast(txt); else console.log("[wsp]", txt); }catch(_e){}
  }

  // ── Revisión ────────────────────────────────────────────────────────────────────────────
  // Lee el estado y actúa sola en los dos casos que no necesitan a nadie: rotar la línea que
  // se cayó, y dejar la señal del número que no es de ninguna línea.
  // En Integraciones del backoffice está el número que la oficina configuró para sus propios
  // jugadores. Si se puede leer, se lee: preguntarle al operador algo que la máquina puede
  // averiguar sola es exactamente lo que no queremos. No se consulta en cada vuelta (abre la
  // pantalla en un iframe): una vez cada 20 minutos alcanza, y cuando hace falta se fuerza.
  // Cada cuánto se puede mover la pantalla del operador para ir a mirar el número.
  var CADA_CUANTO_NAVEGAR = 6 * 60 * 60 * 1000;
  function _ultimaNavegada(){ try{ return Number(localStorage.getItem("nodoWspNavegadaAt")) || 0; }catch(_e){ return 0; } }
  function _anotarNavegada(){ try{ localStorage.setItem("nodoWspNavegadaAt", String(Date.now())); }catch(_e){} }
  // La misma cola que usa el watchdog para leer las fichas. Es la que evita que una lectura de
  // fondo navegue la ventana en medio de una carga o un retiro y le vuele el modal al operador.
  function _colaOcupada(){
    var c = window._drexCola;
    return !!(c && (c.activo || c.pendientes > 0));
  }
  function _pedirLectura(navegar){
    var llamar = function(){ return window.ctrlElectron.drexAutomation("leerWhatsappOficina", { navegar: navegar }); };
    if(typeof window._drexEncolar === "function")
      return window._drexEncolar("leerWhatsappOficina(wsp)", llamar, { silencioso: true });
    return llamar();
  }

  // forzar = true: además de leer, se le pide a main que lleve la ventana de Agentes a
  // Funcionalidades y permisos. La pantalla del operador se mueve poco y por algo: cuando no hay
  // número guardado, cuando lo pide él con el botón, o una vez cada seis horas — si no, un
  // número cambiado en el backoffice no se entera nunca (pasó: el panel mostraba uno viejo).
  // En el medio lee gratis: si la ventana ya está en esa pantalla, aprovecha y no navega nada.
  async function _mirarBackoffice(forzar){
    if(!forzar && (Date.now() - BACKOFFICE_AT) < 20 * 60 * 1000) return BACKOFFICE;
    if(!window.ctrlElectron || !window.ctrlElectron.drexAutomation) return BACKOFFICE;
    if(_colaOcupada()) return BACKOFFICE;       // hay una operación en curso: este dato espera
    var navegar = !!forzar || (Date.now() - _ultimaNavegada()) > CADA_CUANTO_NAVEGAR;
    try{
      if(navegar) _anotarNavegada();            // se anota aunque falle: no se reintenta en loop
      var r = await _pedirLectura(navegar);
      if(r && r.ok === true){
        BACKOFFICE = { numero: String(r.numero || "").trim(), habilitado: r.habilitado };
        BACKOFFICE_AT = Date.now();
      }else if(r && (r.ocupado || r.needsLogin || r.motivo === "OTRA_PANTALLA")){
        // Está operando, se cayó la sesión, o la ventana está en otra pantalla: NO es que la
        // oficina no tenga número. No se guarda nada y se vuelve a intentar en el próximo paso.
        BACKOFFICE_AT = 0;
      }else{
        BACKOFFICE = null; BACKOFFICE_AT = Date.now();
      }
    }catch(_e){ BACKOFFICE_AT = 0; }
    return BACKOFFICE;
  }

  async function revisar(){
    if(!_pc()) return null;
    if(REVISANDO) return ESTADO;          // _guardarPublicado vuelve acá: no reentrar
    if(window.nodoArranqueHabilitado && !window.nodoArranqueHabilitado("lineas")) return null;
    REVISANDO = true;
    try{
      var d = await _rpc("panel_oficina_wsp_estado");
      if(!d || d.ok !== true) return null;
      ESTADO = d;

      // ESTO VA ANTES QUE PREGUNTARLE NADA A NADIE. La primera versión sólo miraba el backoffice
      // si el operador apretaba un botón, y ese botón aparecía únicamente cuando no había ningún
      // número publicado. Resultado: en una oficina con número y sin lectura de WTK, NODO le
      // preguntaba al operador "¿sigue andando?" con el backoffice abierto al lado mostrando
      // OTRO número, y nunca lo comparó. (Juan, 14/11)
      if(d.pide === "CARGAR_NUMERO"){
        // Sin número publicado el jugador no tiene botón para escribir. El del backoffice es el
        // que la oficina eligió justamente para eso: ponerlo es mejor que dejarlo apagado, y no
        // hace falta que nadie lo escriba a mano.
        var bo = await _mirarBackoffice(true);
        if(bo && bo.numero){
          await _guardarPublicado(bo.numero, "traído del backoffice");
          ESTADO = await _rpc("panel_oficina_wsp_estado");
          pintarTilde(); pintar();
          return ESTADO;
        }
      }else if(d.numero_pagina){
        await _mirarBackoffice(false);
      }

      if(d.pide === "ROTAR"){
        var rot = await _rpc("panel_oficina_wsp_rotar", { p_operador: _operador() });
        if(rot && rot.cambio === true){
          ULTIMA_ROTACION = rot;
          ESTADO = await _rpc("panel_oficina_wsp_estado");
          _avisar("El WhatsApp publicado se había caído: ahora sale " + (rot.a || "otra línea") + ".");
        }
      }else if(d.desajuste === true){
        // No lo arregla el operador y no se le muestra: queda colgado para quien quiera mirarlo.
        try{ await _rpc("panel_oficina_wsp_desajuste"); }catch(_e){}
      }

      pintarTilde();
      pintar();
      return ESTADO;
    }catch(_e){ return null; }   // informativo: no puede trabar la operación
    finally{ REVISANDO = false; }
  }

  // ── El tilde de la ruedita ──────────────────────────────────────────────────────────────
  // Sólo cuando hay algo que el operador tiene que hacer. Un tilde que está siempre no se mira.
  function pintarTilde(){
    var b = document.getElementById("navAjustesTilde");
    if(!b) return;
    var pide = ESTADO && ESTADO.pide;
    var hay = pide === "CARGAR_NUMERO" || pide === "MAPEAR" || pide === "CONFIRMAR";
    b.className = hay ? "nav-tilde" : "nav-tilde hidden";
    b.title = hay ? (pide === "CONFIRMAR" ? "Revisá el WhatsApp publicado" : "Falta configurar el WhatsApp") : "";
  }

  // ── La pantalla ─────────────────────────────────────────────────────────────────────────
  function pintar(){
    var box = document.getElementById("ajustesWhatsapp");
    if(!box) return;
    if(!ESTADO){
      box.innerHTML = '<div class="small" style="color:#64748b">Leyendo…</div>';
      return;
    }
    var d = ESTADO, pide = d.pide, wtk = d.wtk || {}, lineas = d.lineas || [];
    var publicado = d.numero_pagina ? _lindo(d.numero_pagina) : null;

    // El backoffice manda sobre cualquier otra pregunta: no tiene sentido preguntar si el
    // número sigue andando cuando ni siquiera es el que la oficina tiene configurado.
    var boNum = (BACKOFFICE && BACKOFFICE.numero) ? BACKOFFICE.numero : "";
    var desacuerdo = !!(boNum && d.numero_pagina && _clave(boNum) !== _clave(d.numero_pagina));

    // 1) Qué pasa, en una línea, y el botón que corresponde a este momento.
    var titulo = "", color = "#94a3b8", acciones = "";
    if(desacuerdo){
      color = "#f87171";
      titulo = "El número de la página no es el que tenés puesto en el backoffice.";
      acciones = '<button class="mini-btn blue" onclick="nodoWspUsarBackoffice()" style="padding:9px">⬇️ Poner el del backoffice</button>'
               + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Escribir otro</button>';
    }else if(pide === "CARGAR_NUMERO"){
      color = "#f87171";
      titulo = "No hay WhatsApp publicado: al jugador no le aparece el botón para escribirte.";
      acciones = '<button class="mini-btn blue" onclick="nodoWspLeerBackoffice()" style="padding:9px">📄 Traerlo del backoffice</button>'
               + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Escribirlo a mano</button>';
    }else if(pide === "MAPEAR"){
      color = "#facc15";
      titulo = "¿Cuál de tus líneas es el número publicado? Con eso lo puedo cambiar solo cuando se caiga.";
    }else if(pide === "CONFIRMAR"){
      color = "#facc15";
      titulo = "¿El WhatsApp publicado sigue andando? Lo preguntamos una vez por día, en un turno distinto cada día.";
      acciones = '<button class="mini-btn green" onclick="nodoWspConfirmar()" style="padding:9px">✅ Sí, sigue andando</button>'
               + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>';
    }else{
      color = "#22c55e";
      titulo = publicado ? "El WhatsApp publicado está andando." : "Sin novedades.";
      acciones = '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>';
    }

    var html = '<div style="font-size:12px;font-weight:800;color:' + color + ';margin-bottom:6px">' + _esc(titulo) + '</div>';

    if(publicado){
      html += '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0">'
            + '<span style="color:#94a3b8">Lo que ve el jugador</span>'
            + '<span style="color:' + (desacuerdo ? "#f87171" : "#e2e8f0") + ';font-weight:700">' + _esc(publicado)
            + (d.linea_pagina ? ' <span style="color:#64748b;font-weight:400">· ' + _esc(d.linea_pagina.nombre || "") + '</span>' : '')
            + '</span></div>';
    }
    if(boNum){
      html += '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0">'
            + '<span style="color:#94a3b8">En el backoffice</span>'
            + '<span style="color:' + (desacuerdo ? "#facc15" : "#22c55e") + ';font-weight:700">' + _esc(_lindo(boNum))
            + (desacuerdo ? '' : ' <span style="font-weight:400">· coincide</span>') + '</span></div>';
      if(BACKOFFICE.habilitado === false){
        html += '<div class="alert-box" style="background:#2a2416;color:#f0d99b;border-left:3px solid #c9a227;margin:8px 0">'
              + 'En el backoffice el contacto por WhatsApp está <b>apagado</b>: por más que el número esté bien, '
              + 'al jugador no le aparece el botón. Tildalo en Funcionalidades y permisos.</div>';
      }
    }

    if(ULTIMA_ROTACION && ULTIMA_ROTACION.cambio){
      html += '<div class="alert-box" style="background:#16261a;color:#b9f6ca;border-left:3px solid #22c55e;margin:8px 0">'
            + 'Lo cambié solo: <b>' + _esc(ULTIMA_ROTACION.de || "la anterior") + '</b> se había caído, '
            + 'ahora sale <b>' + _esc(ULTIMA_ROTACION.a || "") + '</b> (' + _esc(_lindo(ULTIMA_ROTACION.numero)) + ').</div>';
    }

    // 2) Las líneas. Sólo tiene sentido mostrarlas si hay lectura de WhatsApp.
    if(wtk.responde){
      var conNum = Number(wtk.activas_con_numero || 0);
      html += '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:10px;padding-top:8px;border-top:1px solid #1e293b">'
            + '<span class="small" style="color:#94a3b8">Tus líneas</span>'
            + '<span class="small" style="color:#64748b">' + Number(wtk.activas || 0) + ' de ' + Number(wtk.lineas || 0) + ' andando'
            + ' · ' + conNum + ' con número</span></div>';

      html += lineas.map(function(l){
        var activa = l.activa === true;
        var esta = d.numero_pagina && l.numero === d.numero_pagina;
        var boton = '<button class="mini-btn ' + (l.numero ? "gray" : "blue") + '" style="padding:2px 8px;font-size:11px"'
                  + ' onclick="nodoWspNumeroLinea(&quot;' + _esc(l.id) + '&quot;)">'
                  + (l.numero ? "cambiar" : "poner número") + '</button>';
        var der = (l.numero ? '<span style="color:#cbd5e1">' + _esc(_lindo(l.numero)) + '</span>'
                            + (esta ? ' <span style="color:#22c55e;font-weight:700">· publicada</span>' : '') + ' ' : '')
                + boton;
        return '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:3px 0">'
             + '<span style="color:#cbd5e1">' + (activa ? "🟢" : "🔴") + " " + _esc(l.nombre || "sin nombre")
             + (activa ? '' : ' <span style="color:#f87171;font-size:11px">caída</span>') + '</span>'
             + '<span style="font-size:12px;white-space:nowrap">' + der + '</span></div>';
      }).join("");

      if(conNum < 4){
        html += '<div class="small" style="color:#64748b;margin-top:6px">Con el número de 4 líneas que estén andando ya lo cambio solo cuando una se caiga'
              + (conNum ? ' (van ' + conNum + ').' : '.') + '</div>';
      }
    }else{
      html += '<div class="small" style="color:#64748b;margin-top:10px;padding-top:8px;border-top:1px solid #1e293b">'
            + 'No tengo lectura de tus líneas de WhatsApp, así que no lo puedo revisar solo: por eso te pregunto.</div>';
    }

    if(acciones){
      html += '<div style="display:flex;gap:8px;margin-top:12px">' + acciones + '</div>';
    }
    box.innerHTML = html;
  }

  // ── Botones ─────────────────────────────────────────────────────────────────────────────
  async function _unaSola(fn){
    if(TRABAJANDO) return;
    TRABAJANDO = true;
    try{ await fn(); }
    finally{ TRABAJANDO = false; }
  }

  // Lo trae de la pantalla de Integraciones del backoffice, sin moverle la ventana al operador.
  // Vuelve a leer Integraciones ahora mismo y cuenta qué encontró.
  window.nodoWspLeerBackoffice = function(){
    return _unaSola(async function(){
      var box = document.getElementById("ajustesWhatsapp");
      if(box) box.innerHTML = '<div class="small" style="color:#94a3b8">Buscándolo en el backoffice…</div>';
      BACKOFFICE_AT = 0;
      var bo = await _mirarBackoffice(true);
      if(!bo){
        _avisar("No pude leer el backoffice. Si la ventana de Agentes está operando o hay que entrar de nuevo, probá en un rato.");
      }else if(!bo.numero){
        _avisar("En el backoffice no hay ningún número cargado. Escribilo a mano.");
      }
      await revisar();
    });
  };

  // Publica el número que la oficina tiene en el backoffice.
  window.nodoWspUsarBackoffice = function(){
    return _unaSola(async function(){
      var bo = await _mirarBackoffice(false);
      if(!bo || !bo.numero){ _avisar("Ahora no tengo el número del backoffice."); return; }
      await _guardarPublicado(bo.numero, "traído del backoffice");
    });
  };

  window.nodoWspEscribirNumero = function(){
    return _unaSola(async function(){
      var v = await window.nodoPedirTexto({
        titulo: "WhatsApp que ve el jugador",
        texto: "Código de área y número, sin el 0 ni el 15. Por ejemplo: 11 2345 6789.",
        valor: ESTADO && ESTADO.numero_pagina ? _lindo(ESTADO.numero_pagina) : "",
        confirmar: "Guardar", requerido: true
      });
      if(v == null) return;
      await _guardarPublicado(v, "cargado a mano");
    });
  };

  async function _guardarPublicado(numero, como){
    try{
      var r = await _rpc("panel_oficina_whatsapp_registrar",
        { p_numero: String(numero), p_operador: _operador(), p_motivo: como });
      if(!r || r.ok !== true) _avisar((r && r.mensaje) || "No pude guardarlo.");
      else _avisar(r.cambio ? "Listo: ahora el jugador ve " + _lindo(r.whatsapp_numero) + "." : "Ya estaba ese número.");
    }catch(e){
      _avisar("No pude guardarlo: " + ((e && e.message) || "error"));
    }
    await revisar();
  }

  window.nodoWspNumeroLinea = function(id){
    return _unaSola(async function(){
      var l = (ESTADO && (ESTADO.lineas || []).filter(function(x){ return x.id === id; })[0]) || null;
      var v = await window.nodoPedirTexto({
        titulo: "Número de " + ((l && l.nombre) || "la línea"),
        texto: "El teléfono de esta línea, con código de área y sin el 0 ni el 15. Dejalo vacío si no sabés cuál es.",
        valor: l && l.numero ? _lindo(l.numero) : "",
        confirmar: "Guardar"
      });
      if(v == null) return;
      try{
        var r = await _rpc("panel_oficina_wsp_linea_numero",
          { p_linea_id: id, p_numero: String(v), p_operador: _operador() });
        if(!r || r.ok !== true) _avisar((r && r.mensaje) || "No pude guardarlo.");
      }catch(e){
        _avisar("No pude guardarlo: " + ((e && e.message) || "error"));
      }
      await revisar();
    });
  };

  window.nodoWspConfirmar = function(){
    return _unaSola(async function(){
      try{
        var r = await _rpc("panel_oficina_wsp_confirmar", { p_operador: _operador() });
        if(r && r.ok === true) _avisar("Gracias: queda anotado que lo revisaste.");
        else _avisar((r && r.mensaje) || "No pude anotarlo.");
      }catch(e){
        _avisar("No pude anotarlo: " + ((e && e.message) || "error"));
      }
      await revisar();
    });
  };

  window.NodoWsp = { revisar: revisar, pintar: pintar, estado: function(){ return ESTADO; } };

  // Primera lectura después del arranque; de ahí en adelante va colgada del aviso de líneas.
  setTimeout(function(){ try{ revisar(); }catch(_e){} }, 14000);
})();
