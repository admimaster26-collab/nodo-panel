/* ══════════════════════════════════════════════════════════════════════════════════════════
   PASADA POR CHUNIOR (Juan, 18/11): "cada cosa que te deja anotar Chunior debería estar en NODO".
   Chunior guarda siete historiales (Transacciones): Movimientos de fichas, Movimientos entre
   billeteras, Propinas, Depósitos sin reclamar, Gastos de oficina, Recargas administrativas y
   Transferencias a financieras. NODO los recorre, y cada movimiento tiene que tener su fila en el
   historial de NODO:
     · si ya la tiene (por su N° de Chunior) → nada;
     · si hay una fila de NODO sin N° que es la misma (mismo tipo, monto y horario; en fichas también
       el usuario) → se le pone el N° (se enlaza);
     · si no hay nada → se crea la fila, con quién lo anotó en Chunior, para que no se pierda nada que
       se haya hecho por fuera de NODO.
   Ante la duda no se toca nada: dos filas posibles, una fecha que no se puede leer, Chunior ocupado.
   Las fichas creadas así pasan después por el cotejo con Agentes (cotejo-cargas.js): si la carga no
   está en Agentes, ese cotejo avisa.
   ══════════════════════════════════════════════════════════════════════════════════════════ */
(function(){
  "use strict";

  var TABLAS = [
    { ruta: "movimientoficha",      nombre: "Movimientos de fichas",        grupo: ["CARGA", "RETIRO"], fichas: true },
    { ruta: "movimientointerno",    nombre: "Movimientos entre billeteras", grupo: ["MOV_BILLETERA", "CAMBIO_BILLETERA", "MOVER_RETIRO", "FALTANTE"], tipo: "MOV_BILLETERA" },
    { ruta: "propina",              nombre: "Propinas",                     grupo: ["PROPINA"], tipo: "PROPINA" },
    { ruta: "depositossinreclamar", nombre: "Depósitos sin reclamar",       grupo: ["DEPOSITO_SR", "CREAR_DEPO", "DEPO_SR"], tipo: "DEPOSITO_SR" },
    { ruta: "gastoslocal",          nombre: "Gastos de oficina",            grupo: ["GASTO"], tipo: "GASTO" },
    { ruta: "recargafichas",        nombre: "Recargas administrativas",     grupo: ["RECARGA_FICHAS"], tipo: "RECARGA_FICHAS" },
    { ruta: "movimientofinanciera", nombre: "Transferencias a financieras", grupo: ["FINANCIERA"], tipo: "FINANCIERA" }
  ];
  var VENTANA_MS   = 3 * 60000;          // la misma anotación hecha por NODO: a menos de 3 minutos
  var MAX_PAGINAS  = 10;
  var FRESCO_MS    = 5 * 60000;
  var CADA_CUANTO  = 30 * 60000;
  var PRIMERA_VEZ  = 24 * 3600000;       // la primera pasada mira el último día
  var CLAVE_ULTIMA = "nodoPasadaChuniorHasta";

  function _norm(t){ return String(t || "").trim().toLowerCase(); }
  // Chunior escribe "18-11-2026 17:41:50" (o con "/").
  function fechaChunior(t){
    var m = String(t || "").match(/(\d{2})[-\/](\d{2})[-\/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if(!m) return NaN;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
  }
  // "$ 1.500,00" · "$ -15,00" · "-$ 15,00" → número con signo.
  function montoChunior(t){
    var s = String(t || "");
    var neg = /-\s*\$?\s*\d|\$\s*-/.test(s);
    var x = s.replace(/[^\d.,]/g, "");
    if(!x) return NaN;
    if(x.indexOf(",") >= 0) x = x.replace(/\./g, "").replace(",", ".");
    else if(/\.\d{3}$/.test(x) || (x.match(/\./g) || []).length > 1) x = x.replace(/\./g, "");
    var n = parseFloat(x);
    return Number.isFinite(n) ? (neg ? -n : n) : NaN;
  }
  // Una fila leída de la lista → { id, ms, monto, creadoPor, cuenta, origen, notas }.
  function interpretarFila(f){
    var celdas = (f && f.cells) || [];
    var pick = function(re, reTexto){
      var c = celdas.filter(function(x){ return re.test(x.c) && x.t; })[0];
      if(c) return c.t;
      if(reTexto){ c = celdas.filter(function(x){ return reTexto.test(x.t); })[0]; if(c) return c.t; }
      return "";
    };
    var creacion = pick(/creation|fecha|creado_el|date/i, /\d{2}[-\/]\d{2}[-\/]\d{4}\s+\d{2}:\d{2}/);
    return {
      id: f && f.id ? String(f.id) : "",
      ms: fechaChunior(creacion),
      monto: montoChunior(pick(/as_money|monto|importe|amount/i, /\$\s*-?\s*[\d.]/)),
      creadoPor: pick(/created_by|creado_por|usuario_creador/i),
      cuenta: pick(/cuenta_destino|billetera_destino|destino/i) || pick(/cuenta|billetera|wallet/i),
      origen: pick(/cuenta_origen|billetera_origen|origen/i),
      notas: pick(/notas|nota|detalle|descripcion|concepto/i)
    };
  }
  function _uidDeCuenta(cuenta){ var m = String(cuenta || "").match(/^\s*(\d+)\s*-/); return m ? m[1] : ""; }

  // ── Decide qué hacer con cada movimiento de una tabla (sin red) ──────────────────────────
  // movs: interpretados · porId: { id → fila de NODO } · sueltas: filas de NODO del grupo sin N° de Chunior.
  // → [{ mov, accion: "ya"|"enlazar"|"crear"|"duda", fila?, tipo }]
  function decidir(tabla, movs, porId, sueltas, ahora){
    var usadas = {};
    ahora = Number(ahora) || Date.now();
    return (movs || []).map(function(m){
      var tipo = tabla.fichas ? (m.monto < 0 ? "RETIRO" : "CARGA") : tabla.tipo;
      if(!m.id || !Number.isFinite(m.ms) || !Number.isFinite(m.monto)) return { mov: m, accion: "duda", tipo: tipo };
      if(porId[m.id]) return { mov: m, accion: "ya", fila: porId[m.id], tipo: tipo };
      // Recién anotado: NODO puede estar escribiendo su fila en este momento. Se mira en la próxima pasada.
      if(ahora - m.ms < FRESCO_MS) return { mov: m, accion: "espera", tipo: tipo };
      var cand = (sueltas || []).filter(function(h){
        if(usadas[h.id]) return false;
        if(String(h.tipo || "").toUpperCase() !== tipo && !(tabla.fichas ? false : tabla.grupo.indexOf(String(h.tipo || "").toUpperCase()) >= 0)) return false;
        if(Math.round(Math.abs(Number(h.monto) || 0)) !== Math.round(Math.abs(m.monto))) return false;
        if(Math.abs(Date.parse(h.created_at) - m.ms) > VENTANA_MS) return false;
        if(tabla.fichas && _norm(h.usuario) !== _norm(m.notas)) return false;
        return true;
      });
      if(cand.length > 1) return { mov: m, accion: "duda", tipo: tipo };
      if(cand.length === 1){ usadas[cand[0].id] = true; return { mov: m, accion: "enlazar", fila: cand[0], tipo: tipo }; }
      return { mov: m, accion: "crear", tipo: tipo };
    });
  }

  // ── Lectura de Chunior (la ventana de Chunior de NODO) ───────────────────────────────────
  function _leerPaginaEnChunior(){
    var trs = document.querySelectorAll("#result_list tbody tr");
    var filas = [];
    for(var i = 0; i < trs.length; i++){
      var tr = trs[i];
      var a = tr.querySelector("th a[href], td a[href]");
      var id = null;
      if(a){ var mh = (a.getAttribute("href") || "").match(/\/(\d+)\/change/); if(mh) id = mh[1]; else { var tx = (a.textContent || "").trim(); if(/^\d+$/.test(tx)) id = tx; } }
      var celdas = [];
      var tds = tr.querySelectorAll("th, td");
      for(var j = 0; j < tds.length; j++) celdas.push({ c: tds[j].className || "", t: (tds[j].textContent || "").replace(/\s+/g, " ").trim() });
      filas.push({ id: id, cells: celdas });
    }
    var actual = document.querySelector(".paginator .this-page");
    var links = Array.prototype.slice.call(document.querySelectorAll(".paginator a")).map(function(x){ return { t: (x.textContent || "").trim(), h: x.getAttribute("href") }; });
    return { filas: filas, pagina: actual ? (actual.textContent || "").trim() : "1", links: links, lista: !!document.getElementById("result_list") || !!document.querySelector("#changelist") };
  }
  async function _abrirYLeer(url){
    await window.chunior.navigate(url);
    var t0 = Date.now(), r = null;
    while(Date.now() - t0 < 9000){
      r = await window.chunior.exec("(" + _leerPaginaEnChunior.toString() + ")()").catch(function(){ return null; });
      if(r && r.lista) return r;
      await new Promise(function(ok){ setTimeout(ok, 300); });
    }
    return r && r.lista ? r : null;
  }
  // Las filas de una tabla desde `desdeMs`, página por página (la lista viene de la más nueva a la más vieja).
  async function leerTabla(tabla, desdeMs){
    var base = CHUNIOR_BASE + "/transacciones/" + tabla.ruta + "/";
    var url = base, todas = [], paginas = 0, completo = false;
    while(url && paginas < MAX_PAGINAS){
      var p = await _abrirYLeer(url);
      if(!p) return { ok: false, motivo: "la lista de " + tabla.nombre + " no cargó" };
      paginas++;
      var movs = p.filas.map(interpretarFila);
      if(movs.length && movs.every(function(m){ return !Number.isFinite(m.ms); })) return { ok: false, motivo: "no pude leer las fechas de " + tabla.nombre };
      movs.forEach(function(m){ if(m.ms >= desdeMs) todas.push(m); });
      if(!movs.length || movs[movs.length - 1].ms < desdeMs){ completo = true; break; }
      var sig = p.links.filter(function(l){ return l.t === String((parseInt(p.pagina, 10) || 1) + 1); })[0];
      if(!sig){ completo = true; break; }
      url = base + sig.h;
    }
    return { ok: true, movs: todas, completo: completo, paginas: paginas };
  }

  // ── NODO ─────────────────────────────────────────────────────────────────────────────────
  async function _filasPorId(tabla, ids){
    var porId = {};
    for(var i = 0; i < ids.length; i += 100){
      var r = await supabaseClient.from("historial_ops").select("id,tipo,chunior_movimiento_id")
        .in("chunior_movimiento_id", ids.slice(i, i + 100)).in("tipo", tabla.grupo);
      if(r.error) throw r.error;
      (r.data || []).forEach(function(h){ porId[String(h.chunior_movimiento_id)] = h; });
    }
    return porId;
  }
  async function _sueltas(tabla, desdeMs){
    var r = await supabaseClient.from("historial_ops").select("id,created_at,usuario,monto,tipo,chunior_movimiento_id")
      .in("tipo", tabla.grupo).is("chunior_movimiento_id", null).eq("pc_codigo", _pc())
      .gte("created_at", new Date(desdeMs - VENTANA_MS).toISOString()).limit(500);
    if(r.error) throw r.error;
    return r.data || [];
  }
  function _pc(){ try{ return (typeof pcOperativa !== "undefined" ? pcOperativa : "") || window.pcOperativa || ""; }catch(_e){ return ""; } }
  async function _crear(tabla, d){
    var m = d.mov, uid = _uidDeCuenta(m.cuenta);
    var bil = uid && typeof billeteras !== "undefined" ? (billeteras || []).find(function(b){ return String(b.CHUNIOR_UID) === uid; }) : null;
    var fila = {
      usuario: tabla.fichas ? (m.notas || "(sin usuario)") : (m.notas || tabla.nombre.toUpperCase()),
      tipo: d.tipo, monto: Math.abs(m.monto),
      billetera_id: bil ? bil.ID_BILLETERA : null, billetera_nombre: bil ? bil.NOMBRE_VISIBLE : (m.cuenta || null),
      operador: m.creadoPor || "", origen: "CHUNIOR", estado: "OK",
      notas: "Anotado directo en Chunior" + (m.creadoPor ? " por " + m.creadoPor : "") + ", no estaba en NODO · "
        + tabla.nombre + " N° " + m.id + (m.origen ? " · desde " + m.origen : "") + (m.cuenta ? " · a " + m.cuenta : ""),
      chunior_movimiento_id: m.id, pc_codigo: _pc(), created_at: new Date(m.ms).toISOString()
    };
    var r = await supabaseClient.from("historial_ops").insert(fila).select("id");
    if(r.error) throw r.error;
  }

  // ── Una pasada ───────────────────────────────────────────────────────────────────────────
  var CORRIENDO = false;
  function _ocupado(){
    var c = window._drexCola;
    if(c && (c.activo || c.pendientes > 0)) return true;
    if(window._v154pPortalJobActivo) return true;
    try{ if(typeof _watchdog !== "undefined" && _watchdog && _watchdog.busy > 0) return true; }catch(_e){}
    return false;
  }
  function _toast(t, c){ try{ if(window.toast) window.toast(t, c); }catch(_e){} }
  function _desde(opts){
    if(opts && opts.dias) return Date.now() - opts.dias * 86400000;
    var ult = 0; try{ ult = Number(localStorage.getItem(CLAVE_ULTIMA)) || 0; }catch(_e){}
    return ult ? ult - 10 * 60000 : Date.now() - PRIMERA_VEZ;
  }
  async function pasada(opts){
    opts = opts || {};
    if(CORRIENDO) return { ok: false, motivo: "ya está corriendo" };
    if(!window.chunior || typeof supabaseClient === "undefined" || !_pc()) return { ok: false, motivo: "sin Chunior" };
    if(window.nodoArranqueHabilitado && !window.nodoArranqueHabilitado("historial")) return { ok: false, motivo: "NODO todavía está arrancando" };
    if(_ocupado()) return { ok: false, motivo: "hay una operación en curso" };
    CORRIENDO = true;
    var empezo = Date.now(), desde = _desde(opts), resumen = { tablas: {}, creadas: 0, enlazadas: 0, dudas: 0, fallas: [] }, todoOk = true;
    try{
      for(var i = 0; i < TABLAS.length; i++){
        var tabla = TABLAS[i];
        if(_ocupado()){ todoOk = false; break; }
        var lectura;
        try{ lectura = await _chuSerializar(function(){ return leerTabla(tabla, desde); }); }
        catch(e){ lectura = { ok: false, motivo: (e && e.message) || "error" }; }
        if(!lectura || !lectura.ok){ todoOk = false; resumen.fallas.push(tabla.nombre + ": " + ((lectura && lectura.motivo) || "no se pudo leer")); continue; }
        var ids = lectura.movs.map(function(m){ return m.id; }).filter(Boolean);
        var porId = await _filasPorId(tabla, ids);
        var sueltas = await _sueltas(tabla, desde);
        var dec = decidir(tabla, lectura.movs, porId, sueltas);
        var t = { leidas: lectura.movs.length, enNodo: 0, enlazadas: 0, creadas: 0, dudas: 0 };
        for(var j = 0; j < dec.length; j++){
          var d = dec[j];
          try{
            if(d.accion === "ya") t.enNodo++;
            else if(d.accion === "espera") { /* la próxima pasada */ }
            else if(d.accion === "duda") t.dudas++;
            else if(d.accion === "enlazar"){
              var u = await supabaseClient.from("historial_ops").update({ chunior_movimiento_id: d.mov.id }).eq("id", d.fila.id);
              if(u.error) throw u.error;
              t.enlazadas++;
            }else if(d.accion === "crear" && opts.escribir !== false){ await _crear(tabla, d); t.creadas++; }
            else if(d.accion === "crear") t.creadas++;
          }catch(e){ t.dudas++; console.warn("[pasada-chunior]", tabla.ruta, d.accion, e && e.message); }
        }
        if(!lectura.completo) todoOk = false;
        resumen.tablas[tabla.nombre] = t;
        resumen.creadas += t.creadas; resumen.enlazadas += t.enlazadas; resumen.dudas += t.dudas;
      }
      // Sólo se avanza el "hasta acá" si se leyó todo; si no, la próxima vuelve a mirar desde el mismo lugar.
      if(todoOk && !opts.dias && opts.escribir !== false){ try{ localStorage.setItem(CLAVE_ULTIMA, String(empezo - FRESCO_MS)); }catch(_e){} }
      if(resumen.creadas && opts.escribir !== false){
        _toast("Chunior: " + resumen.creadas + " movimiento(s) anotados directo en Chunior no estaban en NODO. Ya quedaron en el historial.", "yellow");
        try{ if(typeof cargarHistorial === "function") await cargarHistorial(true); }catch(_e){}
      }
      return { ok: true, resumen: resumen, desde: desde };
    }finally{ CORRIENDO = false; }
  }

  window.NodoPasadaChunior = { pasada: pasada, decidir: decidir, interpretarFila: interpretarFila,
    fechaChunior: fechaChunior, montoChunior: montoChunior, TABLAS: TABLAS };

  try{
    if(typeof document !== "undefined" && window.ctrlElectron){
      setTimeout(function(){ pasada().catch(function(){}); }, 5 * 60000);
      setInterval(function(){ pasada().catch(function(){}); }, CADA_CUANTO);
    }
  }catch(_e){}
})();
