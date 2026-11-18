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
  var BACKOFFICE = null;      // último estado de WhatsApp del backoffice
  var BACKOFFICE_AT = 0;
  var BACKOFFICE_VERIFICADO = false;
  var BACKOFFICE_ERROR = "";
  var REVISANDO = false;
  var SYNC_FALLO = null;      // último guardado automático en el backoffice que no salió { numero, at, texto }
  var SYNC_EN_CURSO = false;  // se está poniendo el número de la página en el backoffice
  var ULTIMO_ERROR_GUARDADO = "";

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
  // AdminOnline guarda +54 y los 10 digitos; NODO guarda el numero de WhatsApp completo, que para un
  // celular argentino lleva el 9 (549...). Asi se copia de uno al otro sin romper el boton del jugador.
  function _numeroParaNodo(num){
    var d = String(num || "").replace(/[^0-9]/g, "");
    if(d.length === 12 && d.indexOf("54") === 0) d = "549" + d.slice(2);
    return d;
  }
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
  function _avisarToast(txt){ _avisar(txt); }
  function _avisar(txt){
    try{ if(window.toast) window.toast(txt); else console.log("[wsp]", txt); }catch(_e){}
  }

  // ── Revisión ────────────────────────────────────────────────────────────────────────────
  // Lee el estado y actúa sola en los dos casos que no necesitan a nadie: rotar la línea que
  // se cayó, y dejar la señal del número que no es de ninguna línea.
  // El watchdog de líneas corre cada 5 minutos. Se vuelve a leer en cada ciclo, y se navega
  // a Personalizar página si la ventana está en otra sección. Si el operador está ocupado,
  // _colaOcupada evita moverle la pantalla.
  // El apuro de 4 minutos es SOLO para AdminOnline, que se lee dentro de su propia aplicacion sin
  // recargar. En Casinodrex y BET300 mover la ventana de Agentes cada 4 minutos le corre la
  // pantalla al operador y arriesga el bloqueo por recargas: ahi sigue siendo cada 6 horas.
  function _backendElegido(){ var st = window._agentBackendState; return String((st && st.backend) || "casinodrex"); }
  function _cadaCuantoNavegar(){ return _backendElegido() === "adminonline" ? 4 * 60 * 1000 : 6 * 60 * 60 * 1000; }
  // El nombre que lee el operador es el del backoffice elegido, sin la aclaracion entre parentesis.
  function _nombreBackoffice(){
    var st = window._agentBackendState;
    var l = String((st && st.label) || "").replace(/ *[(].*$/, "").replace(/[<>&"']/g, "").trim();
    return l || "Casinodrex";
  }
  function _pantallaWhatsapp(){ return _backendElegido() === "adminonline" ? "Personalizar página" : "Funcionalidades y permisos"; }
  var CADA_CUANTO_LEER = 4 * 60 * 1000;
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
  function _pedirEdicionBackoffice(numero){
    var llamar = function(){
      return window.ctrlElectron.drexAutomation("guardarWhatsappOficina", { numero: numero, navegar: true });
    };
    if(typeof window._drexEncolar === "function")
      return window._drexEncolar("guardarWhatsappOficina(wsp)", llamar, { silencioso: false });
    return llamar();
  }

  // forzar = true: además de leer, se le pide a main que lleve la ventana de Agentes a
  // Personalizar página. La pantalla del operador se mueve poco y por algo: cuando no hay
  // número guardado, cuando lo pide él con el botón, o una vez cada seis horas — si no, un
  // número cambiado en el backoffice no se entera nunca (pasó: el panel mostraba uno viejo).
  // En el medio lee gratis: si la ventana ya está en esa pantalla, aprovecha y no navega nada.
  async function _mirarBackoffice(forzar){
    if(!forzar && BACKOFFICE_VERIFICADO && (Date.now() - BACKOFFICE_AT) < CADA_CUANTO_LEER) return BACKOFFICE;
    if(!window.ctrlElectron || !window.ctrlElectron.drexAutomation){
      BACKOFFICE_VERIFICADO = false;
      BACKOFFICE_ERROR = "No está abierta la ventana de " + _nombreBackoffice() + ".";
      return null;
    }
    if(_colaOcupada() && !forzar){
      BACKOFFICE_VERIFICADO = false;
      BACKOFFICE_ERROR = "La lectura espera a que termine la operación en curso.";
      return null;       // hay una operación en curso: este dato espera
    }
    var navegar = !!forzar || (Date.now() - _ultimaNavegada()) > _cadaCuantoNavegar();
    try{
      if(navegar) _anotarNavegada();            // se anota aunque falle: no se reintenta en loop
      var r = await _pedirLectura(navegar);
      // Si la sesión está en Control de agentes u otra pantalla, AdminOnline confirma la ruta
      // incorrecta. Navegamos a la ruta real de Personalizar página y leemos esa pantalla ahora.
      if(r && r.motivo === "OTRA_PANTALLA" && !navegar){
        _anotarNavegada();
        r = await _pedirLectura(true);
      }
      if(r && r.ok === true){
        BACKOFFICE = {
          numero: String(r.numero || "").trim(),
          pais: String(r.pais || ""),
          habilitado: r.habilitado,
          numeroValido: r.numeroValido !== false,
          puedeEditar: r.puedeEditar === true
        };
        BACKOFFICE_AT = Date.now();
        BACKOFFICE_VERIFICADO = true;
        BACKOFFICE_ERROR = "";
      }else{
        BACKOFFICE_VERIFICADO = false;
        BACKOFFICE_AT = 0;
        BACKOFFICE_ERROR = r && r.needsLogin ? "La sesión de " + _nombreBackoffice() + " venció."
          : r && r.ocupado ? "La ventana de " + _nombreBackoffice() + " está ocupada."
          : r && r.motivo === "OTRA_PANTALLA" ? "No pude abrir Personalizar página para leer el número."
          : _nombreBackoffice() + " no devolvió una lectura del número.";
      }
    }catch(_e){
      BACKOFFICE_VERIFICADO = false;
      BACKOFFICE_AT = 0;
      BACKOFFICE_ERROR = "Falló la lectura de " + _nombreBackoffice() + ".";
    }
    return BACKOFFICE_VERIFICADO ? BACKOFFICE : null;
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
        if(bo && bo.numero && bo.numeroValido !== false){
          await _guardarPublicado(_numeroParaNodo(bo.numero), "traído del backoffice");
          ESTADO = await _rpc("panel_oficina_wsp_estado");
          pintarTilde(); pintar();
          return ESTADO;
        }
      }else if(d.numero_pagina){
        var leido = await _mirarBackoffice(false);
        // Con AdminOnline lo que ve el jugador es lo de AdminOnline (Juan, 16/11): si cambio alla, NODO lo
        // sigue solo. Solo con una lectura verificada y un numero valido; nunca con una lectura fallida.
        if(_backendElegido() === "adminonline" && leido && BACKOFFICE_VERIFICADO && leido.numero
           && leido.numeroValido !== false && _clave(leido.numero) && _clave(leido.numero) !== _clave(d.numero_pagina)){
          await _guardarPublicado(_numeroParaNodo(leido.numero), "cambiado en " + _nombreBackoffice());
          ESTADO = await _rpc("panel_oficina_wsp_estado");
          d = ESTADO || d;
        }
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

      // Con Drex y agentesbet.io manda el número de la página (el que ve el jugador, el que NODO rota si
      // la línea se cae): si el backoffice tiene otro, se lo cambia solo, sin preguntar (Juan, 18/11: "si es
      // distinto al marcado cambialo"). Con AdminOnline es al revés y ya se resolvió arriba.
      // Sólo con una lectura verificada del backoffice. Si el guardado falla, no se reintenta el mismo número
      // por 15 minutos: queda el cartel con los botones para hacerlo a mano.
      if(_backendElegido() !== "adminonline" && ESTADO && ESTADO.numero_pagina && BACKOFFICE_VERIFICADO && BACKOFFICE
         && _clave(ESTADO.numero_pagina) && _clave(BACKOFFICE.numero) !== _clave(ESTADO.numero_pagina)){
        var objetivo = _nacional(ESTADO.numero_pagina);
        var reciente = SYNC_FALLO && SYNC_FALLO.numero === objetivo && (Date.now() - SYNC_FALLO.at) < 15 * 60000;
        if(objetivo.length >= 7 && !reciente) await _paginaAlBackoffice(objetivo);
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
    var boNum = (BACKOFFICE_VERIFICADO && BACKOFFICE && BACKOFFICE.numero) ? BACKOFFICE.numero : "";
    var boInvalido = !!(BACKOFFICE_VERIFICADO && BACKOFFICE && boNum && BACKOFFICE.numeroValido === false);
    var claveBo = boNum ? _clave(boNum) : "";
    var clavePublicado = d.numero_pagina ? _clave(d.numero_pagina) : "";
    var coincide = !!(boNum && !boInvalido && claveBo && clavePublicado && claveBo === clavePublicado);
    var desacuerdo = !!(boNum && !boInvalido && d.numero_pagina && !coincide);
    // Con Drex y agentesbet.io lo que ve el jugador es el número de la página, y NODO lo pone solo en el
    // backoffice. Mostrar los dos números con botones de "elegí cuál" era redundante (Juan, 18/11).
    var mandaPagina = _backendElegido() !== "adminonline";

    // 1) Qué pasa, en una línea, y el botón que corresponde a este momento.
    var titulo = "", color = "#94a3b8", acciones = "";
    if(!BACKOFFICE_VERIFICADO){
      color = "#facc15";
      titulo = BACKOFFICE_ERROR || "No pude verificar el número en " + _nombreBackoffice() + ".";
      acciones = '<button class="mini-btn blue" onclick="nodoWspLeerBackoffice()" style="padding:9px">Revisar en ' + _nombreBackoffice() + '</button>'
      // El numero que ve el jugador se puede cambiar SIEMPRE, este o no verificado el backoffice.
      if(d.numero_pagina) acciones += '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>';
      if(pide === "CARGAR_NUMERO"){
        color = "#f87171";
        titulo = "No hay WhatsApp publicado: al jugador no le aparece el botón para escribirte.";
        acciones = '<button class="mini-btn blue" onclick="nodoWspLeerBackoffice()" style="padding:9px">📄 Traerlo del backoffice</button>'
                 + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Escribirlo a mano</button>';
      }
    }else if(mandaPagina && d.numero_pagina && BACKOFFICE && !coincide){
      if(SYNC_EN_CURSO){
        color = "#facc15";
        titulo = "Poniendo este número en " + _nombreBackoffice() + "…";
        acciones = "";
      }else{
        color = "#f87171";
        titulo = "No pude ponerlo en " + _nombreBackoffice() + ". Lo vuelvo a intentar solo en unos minutos.";
        acciones = '<button class="mini-btn blue" onclick="nodoWspPaginaAlBackoffice(this)" style="padding:9px">🔁 Intentar ahora</button>'
                 + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>';
      }
    }else if(boInvalido){
      color = "#f87171";
      titulo = "El número guardado en " + _nombreBackoffice() + " tiene un formato inválido.";
      acciones = '<button class="mini-btn blue" onclick="nodoWspEditarBackoffice(this)" style="padding:9px">✏️ Corregir en ' + _nombreBackoffice() + '</button>';
    }else if(desacuerdo){
      color = "#f87171";
      titulo = "El número de la página no es el que tenés puesto en el backoffice.";
      // Las dos direcciones: traer el del backoffice a la página, o llevar el de la página al backoffice.
      acciones = '<button class="mini-btn blue" onclick="nodoWspUsarBackoffice()" style="padding:9px">⬇️ Poner el del backoffice</button>'
               + '<button class="mini-btn blue" onclick="nodoWspPaginaAlBackoffice(this)" style="padding:9px">⬆️ Poner el de la página en ' + _nombreBackoffice() + '</button>'
               + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Escribir otro</button>';
    }else if(pide === "CARGAR_NUMERO"){
      color = "#f87171";
      titulo = "No hay WhatsApp publicado: al jugador no le aparece el botón para escribirte.";
      acciones = '<button class="mini-btn blue" onclick="nodoWspLeerBackoffice()" style="padding:9px">📄 Traerlo del backoffice</button>'
               + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Escribirlo a mano</button>';
    }else if(pide === "MAPEAR"){
      color = "#facc15";
      titulo = "¿Cuál de tus líneas es el número publicado? Con eso lo puedo cambiar solo cuando se caiga.";
    }else if(BACKOFFICE_VERIFICADO && BACKOFFICE && !boNum){
      color = "#f87171";
      titulo = _nombreBackoffice() + " no tiene un número de WhatsApp cargado.";
      acciones = '<button class="mini-btn blue" onclick="nodoWspEditarBackoffice(this)" style="padding:9px">Cargar número en ' + _nombreBackoffice() + '</button>';
    }else if(coincide && BACKOFFICE.habilitado === true){
      color = pide === "CONFIRMAR" ? "#facc15" : "#22c55e";
      titulo = pide === "CONFIRMAR"
        ? "El número coincide y el contacto está activo en " + _nombreBackoffice() + ". ¿El WhatsApp publicado sigue andando?"
        : "El número coincide y el contacto está activo en " + _nombreBackoffice() + ".";
      acciones = pide === "CONFIRMAR"
        ? '<button class="mini-btn green" onclick="nodoWspConfirmar()" style="padding:9px">✅ Sí, sigue andando</button>'
          + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>'
        : '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>';
    }else if(coincide && BACKOFFICE.habilitado === false){
      color = "#f87171";
      titulo = "El número coincide, pero el contacto está apagado en " + _nombreBackoffice() + ".";
      acciones = '<button class="mini-btn blue" onclick="nodoWspEditarBackoffice(this)" style="padding:9px">Activar en ' + _nombreBackoffice() + '</button>';
    }else if(coincide){
      color = "#facc15";
      titulo = "El número coincide, pero " + _nombreBackoffice() + " no confirmó si el contacto está activo.";
      acciones = '<button class="mini-btn blue" onclick="nodoWspLeerBackoffice()" style="padding:9px">Revisar estado en ' + _nombreBackoffice() + '</button>';
    }else if(pide === "CONFIRMAR"){
      color = "#facc15";
      titulo = "¿El WhatsApp publicado sigue andando? Lo preguntamos una vez por día, en un turno distinto cada día.";
      acciones = '<button class="mini-btn green" onclick="nodoWspConfirmar()" style="padding:9px">✅ Sí, sigue andando</button>'
               + '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>';
    }else{
      color = "#22c55e";
      titulo = publicado ? "No hay una verificación reciente de " + _nombreBackoffice() + "." : "Sin novedades.";
      acciones = '<button class="mini-btn gray" onclick="nodoWspEscribirNumero()" style="padding:9px">✏️ Cambiarlo</button>';
    }

    var html = '<div style="font-size:12px;font-weight:800;color:' + color + ';margin-bottom:6px">' + _esc(titulo) + '</div>';

    if(publicado){
      html += '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0">'
            + '<span style="color:#94a3b8">' + (_backendElegido() === "adminonline" ? "Guardado en NODO" : "Lo que ve el jugador") + '</span>'
            + '<span style="color:' + ((!mandaPagina && (desacuerdo || boInvalido)) ? "#f87171" : "#e2e8f0") + ';font-weight:700">' + _esc(publicado)
            + (d.linea_pagina ? ' <span style="color:#64748b;font-weight:400">· ' + _esc(d.linea_pagina.nombre || "") + '</span>' : '')
            + '</span></div>';
    }
    if(BACKOFFICE_VERIFICADO && boNum && (!mandaPagina || !coincide)){
      html += '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0">'
            + '<span style="color:#94a3b8">' + (_backendElegido() === "adminonline" ? "Lo que ve el jugador" : "En " + _nombreBackoffice()) + '</span>'
            + '<span style="color:' + (boInvalido ? "#f87171" : desacuerdo ? "#facc15" : coincide ? "#22c55e" : "#e2e8f0") + ';font-weight:700">' + _esc(_lindo(boNum))
            + (boInvalido ? ' <span style="font-weight:400">· formato inválido</span>'
              : coincide ? ' <span style="font-weight:400">· coincide</span>'
              : desacuerdo ? ' <span style="font-weight:400">· ' + (mandaPagina ? 'se cambia por el de arriba' : 'distinto') + '</span>' : '') + '</span></div>';
      if(mandaPagina && !SYNC_EN_CURSO && SYNC_FALLO && SYNC_FALLO.texto){
        html += '<div class="small" style="color:#fca5a5;margin:4px 0">' + _esc(SYNC_FALLO.texto) + '</div>';
      }
    }
    if(BACKOFFICE_VERIFICADO && boNum){
      if(BACKOFFICE.habilitado === false){
        html += '<div class="alert-box" style="background:#2a2416;color:#f0d99b;border-left:3px solid #c9a227;margin:8px 0">'
              + 'En el backoffice el contacto por WhatsApp está <b>apagado</b>: por más que el número esté bien, '
              + 'al jugador no le aparece el botón. Tildalo en Personalizar página.</div>';
      }
    }

    if(BACKOFFICE_VERIFICADO && BACKOFFICE && !boNum){
      html += '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0">'
            + '<span style="color:#94a3b8">' + (_backendElegido() === "adminonline" ? "Lo que ve el jugador" : "En " + _nombreBackoffice()) + '</span>'
            + '<span style="color:#facc15;font-weight:700">Sin número cargado</span></div>';
      if(BACKOFFICE.habilitado === false){
        html += '<div class="alert-box" style="background:#2a2416;color:#f0d99b;border-left:3px solid #c9a227;margin:8px 0">'
              + 'En ' + _nombreBackoffice() + ' el contacto por WhatsApp está apagado. Activá el permiso en ' + _pantallaWhatsapp() + '.</div>';
      }
    }
    if(boInvalido && !mandaPagina){
      html += '<div class="alert-box" style="background:#2a1717;color:#fecaca;border-left:3px solid #ef4444;margin:8px 0">'
            + _nombreBackoffice() + ' acepta hasta 10 dígitos en este campo. Corregilo antes de publicarlo.</div>';
    }
    if(!BACKOFFICE_VERIFICADO){
      html += '<div class="alert-box" style="background:#2a2416;color:#f0d99b;border-left:3px solid #c9a227;margin:8px 0">'
            + 'El número todavía no está verificado en ' + _nombreBackoffice() + '. No puedo decir que coincide ni que está activo.</div>';
    }
    // Con Drex y agentesbet.io no hay un número "del backoffice" aparte: se cambia el de la página.
    if(!mandaPagina && BACKOFFICE_VERIFICADO && BACKOFFICE && BACKOFFICE.puedeEditar){
        if(acciones.indexOf("nodoWspEditarBackoffice") < 0) html += '<div style="margin-top:7px"><button class="mini-btn gray" onclick="nodoWspEditarBackoffice(this)" style="padding:7px 9px">'
            + (boNum ? '✏️ Cambiar número en ' + _nombreBackoffice() : '✏️ Cargar número en ' + _nombreBackoffice()) + '</button></div>';
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
    }else if(_backendElegido() !== "adminonline"){
      html += '<div class="small" style="color:#64748b;margin-top:10px;padding-top:8px;border-top:1px solid #1e293b">'
            + 'Si el WhatsApp de la página deja de contestar, cambialo acá.</div>';
    }

    // Con AdminOnline el número se cambia allá y NODO lo copia solo: un "Cambiarlo" acá se pisaría en la
    // próxima revisión. Queda únicamente el botón de cambiarlo en AdminOnline.
    if(_backendElegido() === "adminonline") acciones = acciones.replace(/<button[^>]*nodoWspEscribirNumero[^>]*>[^<]*<[/]button>/g, "");

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

  // Lee el número directamente de Personalizar página en la ventana de Agentes.
  // Lee Personalizar página ahora mismo y cuenta qué encontró.
  window.nodoWspLeerBackoffice = function(){
    return _unaSola(async function(){
      var box = document.getElementById("ajustesWhatsapp");
      if(box) box.innerHTML = _colaOcupada()
        ? '<div class="small" style="color:#facc15">La lectura quedó en cola; espero que termine la operación en curso…</div>'
        : '<div class="small" style="color:#94a3b8">Buscándolo en el backoffice…</div>';
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
      if(bo.numeroValido === false){ _avisar("El número de " + _nombreBackoffice() + " no es válido. Corregilo antes de publicarlo."); return; }
      await _guardarPublicado(_numeroParaNodo(bo.numero), "traído del backoffice");
    });
  };

  window.nodoWspEditarBackoffice = function(boton){
    if(TRABAJANDO) return;
    if(boton) boton.disabled = true;
    var tarea = _unaSola(async function(){
      if(!window.ctrlElectron || !window.ctrlElectron.drexAutomation){
        _avisar("No puedo abrir " + _nombreBackoffice() + " desde esta pantalla."); return;
      }
      var actual = String(BACKOFFICE && BACKOFFICE.numero || "").replace(/[^0-9]/g, "");
      var prefijoPais = String(BACKOFFICE && BACKOFFICE.pais || "").replace(/[^0-9]/g, "");
      if(prefijoPais && actual.slice(0, prefijoPais.length) === prefijoPais) actual = actual.slice(prefijoPais.length);
      if(actual.length > 10) actual = actual.slice(-10);
      var valor = await window.nodoPedirTexto({
        titulo: "WhatsApp de " + _nombreBackoffice(),
        texto: "Escribí entre 7 y 10 dígitos, sin el código de país. Se conserva el país seleccionado (" + String(BACKOFFICE && BACKOFFICE.pais || "+54") + "). Esto cambia el contacto de " + _nombreBackoffice() + "; el número que ve el jugador se configura por separado.",
        valor: actual,
        confirmar: "Guardar en " + _nombreBackoffice(),
        requerido: true,
        faltaTexto: "Escribí el número para guardarlo."
      });
      if(valor == null) return;
      var digitos = String(valor).replace(/[^0-9]/g, "");
      if(digitos.length < 7 || digitos.length > 10){
        _avisar("El número debe tener entre 7 y 10 dígitos, sin el código de país."); return;
      }
      await _guardarEnBackoffice(digitos);
    });
    return tarea.finally(function(){ if(boton) boton.disabled = false; });
  };

  // Escribe el número en el backoffice (navega, espera que se dibuje, escribe y guarda) y deja todo al
  // día. Si la página no dio aviso de éxito, se vuelve a leer la pantalla para estar seguros. true = quedó.
  // Lleva el número de la página al backoffice (Drex y agentesbet.io: manda la página). Mientras tanto la
  // pantalla dice "poniéndolo"; si no sale, dice por qué y queda "Intentar ahora".
  async function _paginaAlBackoffice(digitos){
    SYNC_EN_CURSO = true; ULTIMO_ERROR_GUARDADO = "";
    try{ pintar(); }catch(_e){}
    var quedo = false;
    try{ quedo = await _guardarEnBackoffice(digitos); }
    finally{ SYNC_EN_CURSO = false; }
    SYNC_FALLO = quedo ? null : { numero: digitos, at: Date.now(), texto: ULTIMO_ERROR_GUARDADO };
    try{ pintar(); }catch(_e){}
    return quedo;
  }

  async function _guardarEnBackoffice(digitos){
    var _avisar = function(txt){ ULTIMO_ERROR_GUARDADO = /^Listo|ya estaba/.test(txt) ? "" : txt; _avisarToast(txt); };
    try{
      var r = await _pedirEdicionBackoffice(digitos);
      if(!r || r.ok !== true){
        console.warn("[wsp] No se pudo guardar el WhatsApp de " + _nombreBackoffice(), r && r.motivo);
        if(r && r.needsLogin) _avisar("La sesión de " + _nombreBackoffice() + " venció. Iniciá sesión y probá de nuevo.");
        else if(r && r.motivo === "NUMERO_INVALIDO") _avisar("El número debe tener entre 7 y 10 dígitos.");
        else if(r && r.motivo === "SIN_CONFIRMACION") _avisar("No pude confirmar el guardado. Revisá " + _nombreBackoffice() + " antes de volver a intentarlo.");
        else if(r && r.message && r.motivo === "RECHAZADO") _avisar(_nombreBackoffice() + " no aceptó el número. Revisá esa pantalla.");
        else _avisar("No pude guardar el número en " + _nombreBackoffice() + ". Revisá esa pantalla antes de volver a intentarlo.");
        return false;
      }
      if(r.confirmarLeyendo){
        var leido = null;
        try{ leido = await _pedirLectura(true); }catch(_e){}
        var visto = String((leido && leido.numero) || "").replace(/[^0-9]/g, "").slice(-10);
        if(!(leido && leido.ok) || visto !== String(digitos).slice(-10)){
          _avisar("Escribí el número en " + _nombreBackoffice() + ", pero al volver a mirar no aparece guardado. Revisalo en esa pantalla.");
          return false;
        }
        r.numero = leido.numero;
        if(leido.habilitado != null) r.habilitado = leido.habilitado;
      }
      // Lo que el backoffice dice que quedó tiene que ser lo que se mandó: un "ok" con otro número no es guardado.
      if(!String(r.numero || "").replace(/[^0-9]/g, "").endsWith(String(digitos))){
        _avisar("Escribí el número en " + _nombreBackoffice() + ", pero quedó otro. Revisalo en esa pantalla.");
        return false;
      }
      BACKOFFICE = {
        numero: String(r.numero || "").trim(),
        pais: String(r.pais || (BACKOFFICE && BACKOFFICE.pais) || ""),
        habilitado: r.habilitado,
        numeroValido: r.numeroValido !== false,
        puedeEditar: true
      };
      BACKOFFICE_AT = Date.now();
      BACKOFFICE_VERIFICADO = true;
      BACKOFFICE_ERROR = "";
      try{ pintar(); }catch(_e){}           // si hay una revision de fondo en curso, revisar() no repinta
      _avisar((r.sinCambio ? "Ese número ya estaba guardado en " + _nombreBackoffice() : "Listo: se guardó en " + _nombreBackoffice()) + ": " + _lindo(BACKOFFICE.numero) + ".");
      if(_backendElegido() === "adminonline" && BACKOFFICE.numero){
        try{ await _guardarPublicado(_numeroParaNodo(BACKOFFICE.numero), "cambiado en " + _nombreBackoffice()); }catch(_e){}
      }
      await revisar();
      try{ pintar(); }catch(_e){}
      return true;
    }catch(e){
      console.warn("[wsp] Falló el guardado del WhatsApp de " + _nombreBackoffice(), e && e.name);
      _avisar("No pude guardar el número en " + _nombreBackoffice() + ". Revisá la pantalla antes de volver a intentarlo.");
      return false;
    }
  }
  function _nacional(numero){ return String(numero || "").replace(/[^0-9]/g, "").slice(-10); }

  // El número que ve el jugador va también al backoffice (Juan, 18/11: "NODO no hizo un carajo de cambio
  // de número en Drex"). Lo que ve el jugador y lo que tiene el backoffice tienen que ser el mismo.
  window.nodoWspPaginaAlBackoffice = function(boton){
    if(TRABAJANDO) return;
    if(boton) boton.disabled = true;
    var tarea = _unaSola(async function(){
      if(!window.ctrlElectron || !window.ctrlElectron.drexAutomation){ _avisar("No puedo abrir " + _nombreBackoffice() + " desde esta pantalla."); return; }
      var digitos = _nacional(ESTADO && ESTADO.numero_pagina);
      if(digitos.length < 7){ _avisar("No hay un número publicado para poner en " + _nombreBackoffice() + "."); return; }
      await _paginaAlBackoffice(digitos);
    });
    return tarea.finally(function(){ if(boton) boton.disabled = false; });
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
      // Y el mismo número en el backoffice, si se puede: si no, el jugador y el backoffice quedan distintos.
      var digitos = _nacional(v);
      if(digitos.length >= 7 && window.ctrlElectron && window.ctrlElectron.drexAutomation
         && _nacional(BACKOFFICE && BACKOFFICE.numero) !== digitos){
        await _guardarEnBackoffice(digitos);
      }
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
