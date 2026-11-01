
/* ============================================================
   NODO · JUGADORES CRM V1 SAFE
   CRM interno calculado desde historial/sesión actual.
   No toca portal, historial, billeteras, motor, worker ni Supabase.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}
  function N(v){return S(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim()}
  // Un teléfono se compara por sus ÚLTIMOS 10 dígitos: 549, 54, 0 y 15 son prefijos de marcado,
  // no parte del número. Las dos RPC del servidor ya lo hacían (right(...,10)); este filtro, que
  // corre en el navegador, comparaba texto pelado — así que buscar "5492915129182" no encontraba
  // al que está guardado como "2915129182". Menos de 6 dígitos no es un teléfono: es ruido.
  function _tel10(v){ const d=S(v).replace(/\D/g,""); return d.length>=6 ? d.slice(-10) : ""; }
  function money(v){const n=Number(v||0);return isNaN(n)?0:n}
  function fmtMoney(n){try{return "$ "+Math.round(Number(n||0)).toLocaleString("es-AR")}catch(_e){return "$ "+n}}
  function toDate(v){const d=new Date(v||0);return isNaN(d.getTime())?null:d}
  function diasDesde(v){const d=toDate(v);return d?Math.floor((Date.now()-d.getTime())/86400000):9999}
  function turno(fecha){const d=toDate(fecha);if(!d)return "";const h=d.getHours();if(h>=6&&h<14)return "TM";if(h>=14&&h<22)return "TT";return "TN"}
  function estadoOk(e){e=U(e);return ["OK","ACREDITADA","PAGADA","COMPLETADA","APROBADA"].includes(e)}
  function getHistorialBase(){
    let lista=[];
    try{
      if(typeof construirHistorialUnificado==="function"){
        lista=construirHistorialUnificado().map(it=>({usuario:it.usuario,tipo:it.tipo,monto:it.monto,estado:it.estado,origen:it.fuente==="SOLICITUD"?"PORTAL":(it._raw?.origen||"PANEL"),billetera_nombre:it.billetera_nombre,created_at:it.fecha,saldo_post:it.saldo_post,operador:it.operador||it._raw?.operador||"",_raw:it._raw||it}));
      }else if(Array.isArray(window._historialData)) lista=window._historialData.slice();
    }catch(e){console.warn("CRM historial",e);lista=Array.isArray(window._historialData)?window._historialData.slice():[]}
    return lista.filter(x=>S(x.usuario).trim() && !["SOPORTE","CHAT"].includes(U(x.tipo)));
  }
  function buildCRM(){
    // El CRM abre VACÍO y trabaja por búsqueda. Antes armaba la lista entera al entrar:
    // en P4 son 4 RPC en cadena (4,2 s) y hasta 2000 filas dibujadas de una, que además
    // se redibujaban en cada tecla. Eso era lo que tildaba la app.
    // La lista completa se arma sólo si el operador la pide (📥 Cargar lista).
    if(!window._crmCargado){ window._crmJugadoresData=[]; return []; }
    const hist=getHistorialBase(), map=new Map();
    hist.forEach(h=>{
      const usuario=S(h.usuario).trim(), key=U(usuario); if(!key)return;
      if(!map.has(key))map.set(key,{usuario,totalOps:0,cargas:0,retiros:0,consultas:0,montoCargas:0,montoRetiros:0,neto:0,ultimaOperacion:null,ultimaCarga:null,ultimaRetiro:null,turnos:{TM:0,TT:0,TN:0},billeteras:{},origenes:{},operadores:{},saldoPost:null,errores:0});
      const j=map.get(key), tipo=U(h.tipo), ok=estadoOk(h.estado), montoAbs=Math.abs(money(h.monto)), fecha=h.created_at||h.fecha||h.createdAt;
      j.totalOps++;
      if(fecha&&(!j.ultimaOperacion||toDate(fecha)>toDate(j.ultimaOperacion)))j.ultimaOperacion=fecha;
      const t=turno(fecha);if(t)j.turnos[t]=(j.turnos[t]||0)+1;
      const b=S(h.billetera_nombre||h.billetera||"").trim();if(b)j.billeteras[b]=(j.billeteras[b]||0)+1;
      const o=U(h.origen||"");if(o)j.origenes[o]=(j.origenes[o]||0)+1;
      const op=S(h.operador||"").trim();if(op)j.operadores[op]=(j.operadores[op]||0)+1;
      if(h.saldo_post!==null&&h.saldo_post!==undefined&&h.saldo_post!=="")j.saldoPost=money(h.saldo_post);
      if(!ok&&!["PENDIENTE","EN_REVISION"].includes(U(h.estado)))j.errores++;
      if(tipo==="CARGA"){j.cargas++;if(ok)j.montoCargas+=montoAbs;if(fecha&&(!j.ultimaCarga||toDate(fecha)>toDate(j.ultimaCarga)))j.ultimaCarga=fecha}
      if(tipo==="RETIRO"){j.retiros++;if(ok)j.montoRetiros+=montoAbs;if(fecha&&(!j.ultimaRetiro||toDate(fecha)>toDate(j.ultimaRetiro)))j.ultimaRetiro=fecha}
      if(tipo==="CONSULTA")j.consultas++;
    });
    // Merge de agregados de operaciones de agentes (CSV) por jugador
    (window._agenteResumen||[]).forEach(function(a){
      const usuario=S(a.usuario).trim(), key=U(usuario); if(!key)return;
      if(!map.has(key))map.set(key,{usuario,totalOps:0,cargas:0,retiros:0,consultas:0,montoCargas:0,montoRetiros:0,neto:0,ultimaOperacion:null,ultimaCarga:null,ultimaRetiro:null,turnos:{TM:0,TT:0,TN:0},billeteras:{},origenes:{},operadores:{},saldoPost:null,errores:0});
      const j=map.get(key), c=Number(a.cargas||0), r=Number(a.retiros||0);
      j.cargas+=c; j.retiros+=r; j.totalOps+=c+r;
      j.montoCargas+=Number(a.monto_cargas||0); j.montoRetiros+=Number(a.monto_retiros||0);
      if(a.ultima_carga&&(!j.ultimaCarga||toDate(a.ultima_carga)>toDate(j.ultimaCarga)))j.ultimaCarga=a.ultima_carga;
      if(a.ultima_op&&(!j.ultimaOperacion||toDate(a.ultima_op)>toDate(j.ultimaOperacion)))j.ultimaOperacion=a.ultima_op;
      if(c+r>0)j.origenes["AGENTE"]=(j.origenes["AGENTE"]||0)+c+r;
    });
    // Merge de VÍNCULOS de whaticket (usuario+teléfono): asegura que TODO usuario registrado aparezca
    // en el CRM, aunque no tenga NINGUNA operación. Aporta teléfono/estado del vínculo; ops quedan en 0
    // (caen como NUEVO). Para los que ya tienen ops, solo completa el teléfono/estado si faltaba.
    (window._crmVinculos||[]).forEach(function(v){
      const usuario=S(v.usuario).trim(), key=U(usuario); if(!key)return;
      const _nuevo=!map.has(key);
      if(_nuevo)map.set(key,{usuario,totalOps:0,cargas:0,retiros:0,consultas:0,montoCargas:0,montoRetiros:0,neto:0,ultimaOperacion:null,ultimaCarga:null,ultimaRetiro:null,turnos:{TM:0,TT:0,TN:0},billeteras:{},origenes:{},operadores:{},saldoPost:null,errores:0});
      const j=map.get(key);
      if(!j.telefono && (v.telefono_canon||v.telefono)) j.telefono=S(v.telefono_canon||v.telefono).trim();
      if(v.estado_vinculo) j.estadoVinculo=U(v.estado_vinculo);
      if(v.titular && !j.titular) j.titular=S(v.titular).trim();
      if(_nuevo) j.origenes["WHATICKET"]=(j.origenes["WHATICKET"]||0)+1; // marca de origen solo si es puro vínculo
    });
    const arr=Array.from(map.values()).map(j=>{
      j.neto=j.montoCargas-j.montoRetiros;j.diasUltCarga=diasDesde(j.ultimaCarga||j.ultimaOperacion);
      j.turnoFrecuente=Object.entries(j.turnos).sort((a,b)=>b[1]-a[1])[0]?.[0]||"-";
      j.billeteraHabitual=Object.entries(j.billeteras).sort((a,b)=>b[1]-a[1])[0]?.[0]||"-";
      j.origenHabitual=Object.entries(j.origenes).sort((a,b)=>b[1]-a[1])[0]?.[0]||"-";
      j.operadorHabitual=Object.entries(j.operadores).sort((a,b)=>b[1]-a[1])[0]?.[0]||"-";
      let score=0;score+=Math.min(j.cargas*8,40);score+=Math.min(j.montoCargas/10000,35);score+=j.diasUltCarga<=3?15:j.diasUltCarga<=7?10:j.diasUltCarga<=30?4:0;score+=j.neto>0?8:0;score-=Math.min(j.errores*3,10);j.score=Math.max(0,Math.round(score));
      // VIP / ACTIVO / TIBIO / FRIO y la "acción" que salía de ahí: afuera. Etiquetaban al jugador
      // con una categoría de marketing que nadie usaba para operar (Juan, 27/9).
      const fl=(window._crmFlags||{})[String(j.usuario).toLowerCase()]; j.push=!!(fl&&fl.push); j.app=!!(fl&&fl.app);
      return j;
    });
    arr.sort((a,b)=>b.score-a.score||((toDate(b.ultimaOperacion)||0)-(toDate(a.ultimaOperacion)||0)));window._crmJugadoresData=arr;return arr;
  }

  function installCss(){if(document.getElementById("crmJugadoresCss"))return;const st=document.createElement("style");st.id="crmJugadoresCss";st.textContent=`
    .crm-toolbar{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin-bottom:12px}.crm-toolbar input,.crm-toolbar select{margin:0!important;padding:8px 10px!important;font-size:12px!important}.crm-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px}.crm-stat{background:#1b202c;border:1px solid #2e3444;border-radius:14px;padding:12px}.crm-stat .k{font-size:11px;color:#98a2b3;font-weight:800;text-transform:uppercase}.crm-stat .v{font-size:22px;font-weight:950;margin-top:4px}.crm-table-wrap{max-height:560px;overflow:auto;border:1px solid #2d3342;border-radius:14px}.crm-score{font-weight:950;color:#7dd3fc}.crm-actions{display:flex;gap:6px;flex-wrap:wrap}@media(max-width:1100px){.crm-toolbar{grid-template-columns:repeat(2,minmax(120px,1fr))}}`;document.head.appendChild(st)}
  // Un solo mensaje: los textos por categoría se fueron con el segmento.
  function promoTexto(j){ return j ? `Hola ${j.usuario} 👋 ¿Querés cargar? Te ayudo por acá.` : ""; }
  window.crmCopiarPromo=function(usuario){const j=(window._crmJugadoresData||[]).find(x=>U(x.usuario)===U(usuario));const txt=promoTexto(j);navigator.clipboard?.writeText(txt).then(()=>{try{toast("Promo copiada","green")}catch(_e){alert("Promo copiada")}}).catch(()=>alert(txt))};
  // ── Enlace de acceso al portal ──────────────────────────────────────────────
  // Deja al usuario ADENTRO del portal ya validado y en la pantalla que elige el operador.
  // Pensado para los que piden CBU por WhatsApp: en vez de explicarle cómo entrar, se le manda
  // el enlace y hace la solicitud solo. Desde el CRM NO es para repartir: primero se lo mira acá
  // en el perfil, y recién si está en orden se le manda. (La excepción es el alta recién validada,
  // que sale desde _altaModalResultado: ahí no hay ficha que revisar porque el operador acaba de
  // crear la cuenta y verificar el teléfono en el mismo paso.)
  //
  // Vence a los 30 minutos y al generar uno nuevo el anterior queda anulado. NO es de un solo uso:
  // la RPC nunca marca usado_at, así que la defensa real es la ventana de tiempo, no el consumo.
  window.PORTAL_BASE_URL = localStorage.getItem("nodo_portal_base_url") || "https://portal-bet300-a4xj.vercel.app";
  // Devuelve la URL del enlace validado, sin tocar el portapapeles ni avisar nada. La usa la
  // ficha de datos de ingreso, que necesita el enlace ADENTRO del texto que copia el operador.
  // Enlace LIMPIO sobre el dominio propio de la oficina: https://vip.<dominio>/?t=…
  //  · en WhatsApp se lee como la marca y no como un ".vercel.app" cualquiera
  //  · el dominio ya dice de qué oficina es, así que el ?r= sobra y solo ensucia
  //  · si el token ya fue usado, la persona igual cae en el portal correcto
  // Sin dominio propio cargado se cae al genérico CON ?r=, que ahí sí hace falta para saber la
  // oficina (el portal se muda solo al dominio bueno apenas la resuelve).
  window.crmEnlaceAccesoUrl = async function(usuario, destino){
    const pc = String((typeof pcOperativa!=="undefined" && pcOperativa) || window.pcOperativa || "").trim();
    if(!pc) throw new Error("No sé de qué oficina sos. Reabrí el panel.");
    const op = (typeof operador!=="undefined" && operador && (operador.usuario||operador.nombre)) || "";
    const r = await supabaseClient.rpc("panel_acceso_link_crear",{
      p_secret: window.PANEL_DATA_SECRET, p_pc: pc, p_usuario: usuario,
      p_destino: destino, p_operador: op, p_minutos: 30
    });
    if(r.error){
      // "sin vínculo" y "bloqueado" ya vienen redactados para leer; el resto son técnicos.
      const m = String(r.error.message||"");
      throw new Error(/no-auth/i.test(m) ? "Este panel no tiene permiso para generar enlaces. Avisá a soporte."
                    : m || "No se pudo generar el enlace");
    }
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    if(!row || !row.o_token) return "";
    return row.o_host
      ? ("https://" + row.o_host + "/?t=" + row.o_token)
      : (window.PORTAL_BASE_URL + "/?r=" + encodeURIComponent(row.o_public_code||"") + "&t=" + row.o_token);
  };

  window.crmEnlaceAcceso = async function(usuario, destino){
    const btnTxt = destino==="RETIRAR" ? "retirar" : "cargar";
    let url = "";
    try{ url = await window.crmEnlaceAccesoUrl(usuario, destino); }
    catch(e){ toast((e && e.message) || "No se pudo generar el enlace","red"); return; }
    if(!url){ toast("No se pudo generar el enlace","red"); return; }
    const msg = "Entrá por acá para " + btnTxt + ", ya validado 👇\n" + url + "\n\n(Es personal y vale por 30 minutos.)";
    await window.nodoCopiar(msg, { etiqueta: "Enlace para "+btnTxt+" copiado · pegalo en el WhatsApp" });
  };

  window.crmFiltrar=function(){
    const data=window._crmJugadoresData||buildCRM();
    const qraw=document.getElementById("crmBuscar")?.value||"";
    // Quedó sólo la búsqueda. Los cuatro selects (segmento/turno/origen/orden) se sacaron:
    // filtraban sobre buildCRM(), que devuelve [] si nadie cargó la lista, así que casi
    // siempre filtraban nada. El orden por score se mantiene, que es el útil por defecto.
    const q=N(qraw);
    const qTel=_tel10(qraw);
    let arr=data.slice();
    if(q)arr=arr.filter(j=>N([j.usuario,j.telefono,j.titular,j.billeteraHabitual,j.operadorHabitual].join(" ")).includes(q)
                        || (qTel && _tel10(j.telefono)===qTel));
    arr.sort((a,b)=>b.score-a.score);
    renderCRMTabla(arr);
    // Con texto, manda el servidor: score y segmento calculados sobre TODAS las
    // operaciones del usuario, no sobre las 200 que hay en memoria. El RPC devuelve los
    // mismos nombres de campo que arma buildCRM, así que la tabla no cambia.
    if(qraw.trim().length >= 3) return _crmBuscarServidor(qraw.trim());
  };

  async function _crmBuscarServidor(q){
    const box=document.getElementById("crmTabla");
    if(box && !window._crmCargado) box.innerHTML='<div class="alert-box">Buscando…</div>';
    try{
      const { data, error } = await supabaseClient.rpc('panel_crm_perfil_v1',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_query: q, p_usuario: null, p_limit: 100 });
      // Si el operador siguió escribiendo, este resultado ya no sirve.
      if(String((document.getElementById("crmBuscar")||{}).value||'').trim() !== q) return;
      if(error) throw new Error(error.message||'');
      if(data && data.ok===false){
        if(data.error==='BUSQUEDA_CORTA') return;
        throw new Error(data.error);
      }
      const res=data&&data.jugadores;
      if(!Array.isArray(res))throw new Error('El servidor no devolvió una lista válida de jugadores.');
      // Los guardamos para que el perfil y los botones de la fila los encuentren.
      window._crmBuscados=window._crmBuscados||{};
      res.forEach(function(j){ window._crmBuscados[String(j.usuario).toLowerCase()]=j; });
      // El servidor ya entrega la selección y el orden; conservar su respuesta.
      renderCRMTabla(res);
    }catch(e){
      if(box) box.innerHTML='<div class="err-box" style="padding:10px">No se pudo buscar: '+escapeHtml(e.message||'')+'</div>';
    }
  }
  // POR QUÉ entró este resultado. Antes la lista mezclaba coincidencias de usuario, de teléfono
  // y de titular sin distinguirlas: con un match malo (el like de teléfono traía 124.843 filas)
  // no había forma de saber si lo que veías tenía algo que ver con lo que buscaste.
  function _motivoBadge(m){
    const M = {
      exacto:   ['🎯 exacto',   '#22c55e', 'El usuario es exactamente lo que buscaste'],
      usuario:  ['👤 usuario',  '#7cc4ff', 'El nombre de usuario contiene lo que buscaste'],
      telefono: ['📱 teléfono', '#a78bfa', 'Mismo teléfono (comparado por los últimos 10 dígitos)'],
      titular:  ['🧾 titular',  '#fbbf24', 'El titular de la cuenta contiene lo que buscaste'],
      otro:     ['· coincidencia', '#94a3b8', 'Coincide, pero no por usuario, teléfono ni titular'],
      // Sin búsqueda la pregunta es otra: no "por qué matcheó" sino "por qué lo tengo que
      // mirar a este". Estos motivos dicen qué hacer, no cómo se encontró.
      esperando:  ['🔴 esperando',   '#f87171', 'Tiene una solicitud abierta ahora mismo'],
      sin_operar: ['🔁 nunca operó', '#fbbf24', 'Se registró y todavía no hizo ninguna operación'],
      alta_nueva: ['🆕 alta nueva',  '#7cc4ff', 'Se registró en los últimos 7 días'],
      registrado: ['· registrado',   '#94a3b8', 'Registrado, sin nada pendiente']
    }[String(m||'').toLowerCase()];
    if(!M) return '';
    return '<span title="'+M[2]+'" style="background:'+M[1]+'22;color:'+M[1]+';border:1px solid '+M[1]
      + '55;border-radius:999px;padding:1px 7px;font-size:9.5px;font-weight:900;margin-right:6px">'+M[0]+'</span>';
  }
  function renderCRMTabla(arr){
    const box=document.getElementById("crmTabla"); if(!box) return;
    // La lista completa manda: se apaga la búsqueda del servidor para no apilar dos tablas.
    if(arr && arr.length){ const otro=document.getElementById("crmResultados"); if(otro) otro.innerHTML=""; }if(!arr.length){box.innerHTML=(window._crmCargado?`<div class="alert-box">No hay jugadores para esos filtros.</div>`:`<div class="alert-box" style="padding:16px;line-height:1.7"><b>Escribí en el buscador</b> para encontrar a cualquiera de los registrados — la búsqueda va al servidor, no hace falta cargar nada.<br><span class="small" style="color:#8b949e">Si necesitás la lista entera de la oficina, usá <b>📥 Cargar lista</b> arriba. Tarda unos segundos.</span></div>`);return}
  // De a 50: dibujar 2000 filas juntas, y encima en cada tecla, era lo que trababa la app.
  const _tope=window._crmTope||50, _hay=arr.length; arr=arr.slice(0,_tope);
  let html=`<div class="crm-table-wrap"><table><thead><tr><th>Jugador</th><th>Score</th><th>Cargas</th><th>Retiros</th><th>Neto</th><th>Última</th><th>Turno</th><th>Billetera</th><th>Acciones</th></tr></thead><tbody>`;arr.forEach(j=>{const uEsc=String(j.usuario).replace(/'/g,"\\'");html+=`<tr class="crm-row" style="cursor:pointer" onclick="abrirPerfilJugador('${uEsc}')" title="Abrir perfil completo del jugador"><td><b>${j.usuario}</b> <span title="Push: ${j.push?'sí':'no'}" style="opacity:${j.push?1:.28}">🔔</span><span title="App instalada: ${j.app?'sí':'no'}" style="opacity:${j.app?1:.28}">📱</span><div class="small">${_motivoBadge(j.motivo)}${j.totalOps} ops · ${j.origenHabitual||'sin origen'}${j.telefono?' · 📱 '+j.telefono:''}${j.titular?' · 👤 '+j.titular:''}${j._wtkOnly?' <span style="color:#7dd3fc;font-weight:900">· WTK'+(j.pcCodigo?' '+j.pcCodigo:'')+'</span>':''}</div></td><td><span class="crm-score">${j.score}</span></td><td>${j.cargas}<div class="small">${fmtMoney(j.montoCargas)}</div></td><td>${j.retiros}<div class="small">${fmtMoney(j.montoRetiros)}</div></td><td><b style="color:${j.neto>=0?"#12b76a":"#f04438"}">${fmtMoney(j.neto)}</b></td><td>${j.diasUltCarga>=9999?"—":j.diasUltCarga+" días"}<div class="small">${j.ultimaCarga?new Date(j.ultimaCarga).toLocaleDateString("es-AR"):"sin carga"}</div></td><td>${j.turnoFrecuente}</td><td>${j.billeteraHabitual}</td><td onclick="event.stopPropagation()"><div class="crm-actions"><button class="mini-btn blue" onclick="crmCopiarPromo('${uEsc}')">📋 Promo</button><button class="mini-btn green" id="pushBtn_${j.usuario}" onclick="crmPushIndividual('${uEsc}')">📲 Push</button><button class="mini-btn blue" title="Escribirle por WhatsApp con el mensaje de recuperación" onclick="crmContactar('${uEsc}')">💬</button><button class="mini-btn yellow" title="Prevalidar: ver si ya tiene otra cuenta, si cobró el bono o si su CBU se repite" onclick="crmPrevalidarRapido('${uEsc}')">✅</button><button class="mini-btn gray" title="Perfil completo (CBUs, titulares, timeline)" onclick="abrirPerfilJugador('${uEsc}')">🌳</button></div></td></tr>`});html+=`</tbody></table></div>`;
  if(_hay>arr.length) html+=`<div style="text-align:center;padding:10px">
      <button class="mini-btn gray" onclick="crmVerMas()">Ver 50 más · quedan ${_hay-arr.length}</button></div>`;
  box.innerHTML=html;const total=document.getElementById("crmTotalVisible");
  if(total)total.textContent=(_hay>arr.length? (arr.length+" de "+_hay) : String(_hay))}
window.crmVerMas=function(){ window._crmTope=(window._crmTope||50)+50; crmFiltrar(); };
// Espera a que dejes de escribir: antes filtraba y redibujaba en cada tecla.
window.crmBuscarDebounce=function(){
  window._crmTope=50;                                  // texto nuevo, arranca de arriba
  clearTimeout(window._crmTeclaTimer);
  window._crmTeclaTimer=setTimeout(function(){ try{ crmFiltrar(); }catch(_e){} }, 350);
};
  // ══════════════════════════════════════════════════════════════════════════
  // CRM · RECONEXIÓN Y PREVALIDACIÓN
  //
  // RECONECTAR — cola de los que entraron al portal y nunca completaron una operación.
  // El turno sale de la HORA DEL ÚLTIMO INTENTO del usuario, no de cuándo se trabaja: el que
  // escribió de madrugada está disponible de madrugada, así que lo toma TN. La cola SE TOMA
  // (no se asigna): el que marca uno lo saca de la pila del resto, así no se superponen.
  // Un "no contesta" vuelve a los 3 días para un segundo intento; al segundo, se cierra.
  // "Recuperado" no se marca a mano: se detecta solo cuando al usuario le aparece una
  // operación posterior al contacto.
  //
  // PREVALIDAR — antes de crear un usuario nuevo. Contesta si ese teléfono ya tiene cuenta acá,
  // si el alias existe, si ya cobró el bono de primer ingreso y si su CBU aparece en otras
  // cuentas. Nace del caso de P2: la misma persona pidiendo usuario nuevo para volver a cobrar
  // el bono — se detectaron 7 cuentas con un mismo CBU, las 7 con bono.
  // ══════════════════════════════════════════════════════════════════════════
  const _RX = { turno:'', datos:null, cargando:false };

  function _rxTurnoActual(){
    const h = new Date().getHours();
    return (h>=6&&h<14) ? 'TM' : (h>=14&&h<22) ? 'TT' : 'TN';
  }
  // Recuperación ocupa la pantalla completa del CRM (ya no es un modal): los operadores
  // trabajan la cola y la prevalidación en paralelo, caso por caso, y en un modal chico
  // no entra. _RX.tab decide qué se muestra adentro.
  _RX.tab = 'cola';
  function _rxDestino(){ return document.getElementById('rxCuerpo'); }

  window.crmAbrirReconexion = async function(turno){
    _RX.turno = (turno!==undefined) ? turno : _rxTurnoActual();
    const view = document.getElementById('viewJugadores');
    if(!view) return;
    view.innerHTML =
      `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
         <div>
           <h1 style="font-size:24px">🔁 Recuperación de usuarios</h1>
           <div class="small">Cola del turno, duplicados por tipeo, prevalidación y jugadores enfriados.</div>
         </div>
         <div style="display:flex;gap:8px">
           <button class="mini-btn blue" onclick="crmAbrirReconexion(_rxTurnoAct())">🔄 Actualizar</button>
           <button class="mini-btn gray" onclick="cargarJugadores()">← Volver al CRM</button>
         </div>
       </div>
       <div id="rxTabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>
       <div id="rxCuerpo"><div class="load" style="padding:16px;color:#8b949e">Buscando…</div></div>`;
    _rxTabs();
    await _rxCargar();
  };
  window._rxTurnoAct = function(){ return _RX.turno; };

  function _rxTabs(){
    const c = document.getElementById('rxTabs'); if(!c) return;
    const d = _RX.datos || {}, r = d.resumen || {};
    const t = (k,lbl,n,color) =>
      `<button class="mini-btn ${_RX.tab===k?(color||'green'):'gray'}" onclick="crmRxTab('${k}')">${lbl}${
        n!=null?' <b>'+n+'</b>':''}</button>`;
    c.innerHTML =
      t('cola','📋 Cola del turno', r.en_cola)
    + t('dup','🔀 Duplicados', r.duplicados, 'yellow')
    // Escribieron un usuario al entrar al portal y nadie lo cotejó. Quedaban invisibles:
    // no son duplicados de teléfono, así que no aparecían en ninguna pestaña.
    + (Number(r.vinculo_sin_validar)>0
        ? t('sinval','🟡 Sin validar', r.vinculo_sin_validar, 'yellow') : '')
    + t('pre','✅ Prevalidar', null, 'blue')
    + t('frios','😴 Dormidos', null, 'blue')
    + t('resc','🎯 Rescate', null, 'purple');
  }
  window.crmRxTab = function(k){
    _RX.tab = k; _rxTabs();
    if(k==='pre')   return _rxPintarPrevalidar();
    if(k==='frios') return _rxPintarFrios();
    if(k==='resc')  return _rxPintarRescate();
    _rxPintar();
  };

  // ── Rescate ────────────────────────────────────────────────────────────────
  // La cola de Dormidos sale sólo de historial_ops, que arranca en julio: todo el que dejó
  // de cargar ANTES es invisible ahí. Esta cruza además las operaciones importadas de
  // Agentes (mayo-julio), así aparecen los que se fueron antes de que NODO existiera —
  // que son los que de verdad valen: el primero de P4 depositó $6,3 M en 137 cargas.
  _RX.rescSeg = 'RESCATE';
  window.crmRxRescSeg = function(s){ _RX.rescSeg = s; _RX.rescate = null; _rxPintarRescate(); };

  async function _rxCargarRescate(){
    const b=_rxDestino(); if(b) b.innerHTML='<div class="load" style="padding:16px;color:#8b949e">Buscando…</div>';
    try{
      const { data, error } = await supabaseClient.rpc('panel_rescate_cola',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo: (typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_segmento: _RX.rescSeg, p_dias: 60, p_limit: 200,
        p_operador: (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre)) || ''
      });
      if(error) throw new Error(error.message||'no se pudo consultar');
      if(data && data.ok===false) throw new Error(data.error||'sin datos');
      _RX.rescate = data;
      _rxPintarRescate();
    }catch(e){
      if(b) b.innerHTML='<div class="err-box" style="padding:10px">No se pudo cargar: '+escapeHtml(e.message||'')+'</div>';
    }
  }

  // Toma el contacto y recién ahí abre el WhatsApp. Si otro se lo llevó, no abre nada:
  // el problema a evitar es que dos operadores le escriban a la misma persona.
  window.crmRxRescContactar = async function(usuario, tel, seg){
    try{
      const { data, error } = await supabaseClient.rpc('panel_rescate_tomar',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo: (typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_usuario: usuario,
        p_operador: (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre)) || ''
      });
      if(error) throw new Error(error.message||'');
      if(data && data.ok===false){
        toast(data.error==='YA_LO_TIENE_OTRO'
          ? 'Lo está trabajando '+(data.operador||'otro operador')
          : 'No se pudo tomar el contacto','orange');
        _RX.rescate = null; return _rxPintarRescate();
      }
    }catch(e){ toast('No se pudo tomar el contacto','red'); return; }
    await crmRxWhatsapp(usuario, tel, seg);
    _RX.rescate = null; _rxPintarRescate();
  };

  function _rxPintarRescate(){
    const b=_rxDestino(); if(!b) return;
    if(!_RX.rescate) return _rxCargarRescate();
    const D=_RX.rescate, lista=D.lista||[], seg=_RX.rescSeg;
    const tab=(k,lbl)=>`<button class="mini-btn ${seg===k?'green':'gray'}" onclick="crmRxRescSeg('${k}')">${lbl}</button>`;
    b.innerHTML =
      `<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
         ${tab('RESCATE','🕰 Se fueron')} ${tab('INTENTO','🚪 Quedaron a mitad')}
         <span style="flex:1"></span>
         <span class="small" style="color:#5a6474">Mostrando ${lista.length} de ${D.total||0}${
           D.tomados_por_otros?' · '+D.tomados_por_otros+' los está trabajando otro':''}</span>
       </div>`
    + `<div class="small" style="color:#5a6474;margin-bottom:10px">${seg==='RESCATE'
         ? 'Cargaban seguido y dejaron de venir hace más de 60 días. Ordenados por lo que depositaron: los de arriba son los que más valen. Incluye lo que operaban en Agentes antes de NODO.'
         : 'Pidieron cargar y nunca completaron una carga. Hay una solicitud concreta de qué hablarles — mirá si se la rechazaron.'}</div>`
    + (!lista.length
       ? '<div class="alert-box" style="padding:14px">No queda nadie en este segmento. 👌</div>'
       : `<div style="max-height:58vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="position:sticky;top:0;background:#161b26;z-index:1">
            <th style="padding:7px;text-align:left">Jugador</th>
            <th style="padding:7px">${seg==='RESCATE'?'Depositó':'Pidió'}</th>
            <th style="padding:7px">${seg==='RESCATE'?'Sin cargar':'Intentó'}</th>
            <th style="padding:7px;text-align:right">Acciones</th></tr></thead><tbody>${
          lista.map(j=>{
            const u=String(j.usuario).replace(/'/g,"\\'");
            const tel=String(j.telefono||'').replace(/\D/g,'');
            const ocupado = !!j.reservado_por;
            return `<tr style="border-top:1px solid #21283a${ocupado?';opacity:.45':''}">
              <td style="padding:6px 7px"><b>${escapeHtml(j.usuario)}</b>
                <div class="small" style="color:#5a6474">${j.ops||0} ops${
                  j.telefono?' · 📱 '+escapeHtml(j.telefono):''}${
                  j.titular?' · 👤 '+escapeHtml(j.titular):''}</div>
                ${ocupado?'<div class="small" style="color:#f0b429">🔒 lo está trabajando '+escapeHtml(j.reservado_por)+'</div>':''}</td>
              <td style="padding:6px 7px;text-align:center">${seg==='RESCATE'
                 ? (j.valor_historico?fmtMoney(j.valor_historico):'<span style="color:#5a6474">—</span>')
                 : (j.monto_pedido?fmtMoney(j.monto_pedido):'<span style="color:#5a6474">—</span>')}
                 ${seg==='INTENTO'&&j.fue_rechazada?'<div class="small" style="color:#ff9d9d">rechazada</div>':''}</td>
              <td style="padding:6px 7px;text-align:center;color:#8b949e">${seg==='RESCATE'
                 ? (j.dias_sin_cargar!=null?j.dias_sin_cargar+' d':'—')
                 : (j.intento_veces||1)+(j.intento_veces>1?' veces':' vez')}</td>
              <td style="padding:6px 7px;text-align:right;white-space:nowrap">
                ${tel&&!ocupado?`<button class="mini-btn blue" onclick="crmRxRescContactar('${u}','${tel}','${seg}')" title="Tomar el contacto y abrir WhatsApp">💬</button>`:''}
                <button class="mini-btn gray" onclick="abrirPerfilJugador('${u}')" title="Ficha">🌳</button>
                <button class="mini-btn gray" onclick="crmRxMarcar('${u}','DESCARTADO','WHATSAPP')" title="No corresponde">🗑</button>
              </td></tr>`; }).join('')}</tbody></table></div>
          <div class="small" style="color:#5a6474;margin-top:8px">
            Al apretar 💬 el contacto queda tomado a tu nombre por 30 minutos y se marca como
            contactado solo — no hace falta tildar nada. Si no llegaste a mandarlo, pasalo a
            "no contesta" desde la cola.</div>`);
  }

  async function _rxCargar(){
    if(_RX.cargando) return; _RX.cargando = true;
    try{
      const { data, error } = await supabaseClient.rpc('panel_reconexion_cola',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo: (typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_turno: _RX.turno || null, p_limit: 300 });
      if(error) throw new Error(error.message||'no se pudo consultar');
      if(data && data.ok===false) throw new Error(data.error||'sin datos');
      _RX.datos = data; _rxTabs();
      if(_RX.tab==='pre') _rxPintarPrevalidar();
      else if(_RX.tab==='frios') _rxPintarFrios();
      else _rxPintar();
    }catch(e){
      const b=_rxDestino();
      if(b) b.innerHTML='<div class="err-box" style="padding:10px">No se pudo cargar: '+escapeHtml(e.message||'')+'</div>';
    }finally{ _RX.cargando = false; }
  }
  function _rxPintar(){
    const b=_rxDestino(); if(!b||!_RX.datos) return;
    const d=_RX.datos, r=d.resumen||{};
    // La pestaña Duplicados es la misma cola filtrada: son los que hay que limpiar,
    // no contactar.
    const soloDup = (_RX.tab==='dup');
    const soloSinValidar = (_RX.tab==='sinval');
    const cola=(d.cola||[]).filter(c =>
      soloDup ? c.duplicado_de
    : soloSinValidar ? c.vinculo_estado==='PENDIENTE'
    : true);
    // Barra de limpieza en lote: sólo en Duplicados, y sólo si hay algo seguro que limpiar.
    const barraLimpieza = (soloDup && Number(r.seguros)>0)
      ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;
                     background:rgba(18,183,106,.09);border:1px solid rgba(18,183,106,.3);
                     border-radius:8px;padding:10px 12px">
           <div style="flex:1;min-width:260px">
             <b style="color:#12b76a">${r.seguros} son la misma persona</b>
             <div class="small" style="color:#8b949e">Nombre mal tipeado o escrito a medias, con el
               mismo teléfono que una cuenta que ya opera. Se pueden unificar todos juntos.</div>
             ${Number(r.a_revisar)>0?`<div class="small" style="color:#5a6474;margin-top:3px">
               Los otros ${r.a_revisar} quedan acá para que los mires: pueden ser dos personas
               que comparten el teléfono.</div>`:''}
           </div>
           <button class="mini-btn green" onclick="crmRxLimpiar()">🔗 Unificar los ${r.seguros}</button>
         </div>`
      : '';
    const porT={}; (d.por_turno||[]).forEach(x=>porT[x.turno]=x.en_cola);
    const hechos=(d.trabajado_hoy||[]).reduce((s,x)=>s+Number(x.n||0),0);
    const tab=(k,lbl)=>`<button class="mini-btn ${_RX.turno===k?'green':'gray'}"
        onclick="crmRxTurno('${k}')">${lbl}${porT[k]!=null?' <b>'+porT[k]+'</b>':''}</button>`;
    b.innerHTML =
      `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
         ${tab('TM','TM 06-14')} ${tab('TT','TT 14-22')} ${tab('TN','TN 22-06')}
         <button class="mini-btn ${_RX.turno===''?'green':'gray'}" onclick="crmRxTurno('')">Todos</button>
         <span style="flex:1"></span>
         <span class="small" style="color:#8b949e">
           <b style="color:#e6edf3">${cola.length}</b> en cola ·
           ${r.con_push||0} con push · ${hechos} marcados hoy ·
           <b style="color:#22c55e">${d.recuperados||0}</b> recuperados</span>
       </div>
       <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
         <span class="small" style="color:#8b949e;white-space:nowrap">
           Variantes del mensaje (<b id="rxNVar" style="color:#e6edf3">${_rxVariantes().length}</b>)</span>
         <span style="flex:1"></span>
         <span class="small" id="rxCont" style="color:#8b949e">${_rxContadorHtml()}</span>
         <button class="mini-btn gray" onclick="crmRxEjemplo()" title="Ver cómo salen">👁</button>
         <button class="mini-btn gray" onclick="crmRxResetMsg()" title="Volver a las variantes originales">↺</button>
       </div>
       <textarea id="rxMsg" oninput="crmRxGuardarMsg()" rows="4" spellcheck="false"
                 placeholder="Una variante por línea"
                 style="width:100%;background:#0f141d;border:1px solid #21283a;border-radius:6px;
                        padding:7px 9px;color:#e6edf3;font-size:12px;line-height:1.5;
                        font-family:ui-monospace,monospace;resize:vertical">${escapeHtml(_rxVariantes().join('\n'))}</textarea>
       <div class="small" style="color:#5a6474;margin:5px 0 10px">
         <b>Una variante por línea</b> — cada envío usa una distinta, rotando, para que WhatsApp
         no lo lea como spam. Dentro de cada línea, <b>{rojo|azul|verde}</b> sortea una de esas
         palabras y <b>{usuario}</b> pone el nombre. Con el 👁 ves cómo salen de verdad.
         Se guarda en esta PC.</div>`
    + barraLimpieza
    + (!cola.length
       ? '<div class="alert-box" style="padding:14px">Sin pendientes en este turno. 👌</div>'
       : `<div style="max-height:56vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="position:sticky;top:0;background:#161b26;z-index:1">
            <th style="padding:7px;text-align:left">Usuario</th>
            <th style="padding:7px;text-align:left">Teléfono</th>
            <th style="padding:7px">Canal</th><th style="padding:7px">Hace</th>
            <th style="padding:7px">Intentos</th><th style="padding:7px">Acciones</th></tr></thead><tbody>${
          cola.map(c=>{
            const u=String(c.usuario).replace(/'/g,"\\'");
            const tel=String(c.telefono||'').replace(/\D/g,'');
            return `<tr style="border-top:1px solid #21283a">
             <td style="padding:6px 7px"><b>${escapeHtml(c.usuario)}</b>
               <div class="small" style="color:#5a6474">${escapeHtml(c.tipo||'')}${c.atendio?' · '+escapeHtml(c.atendio):''}</div>
               ${c.duplicado_de?(function(){
                  const cl=String(c.clase||'');
                  const et={TIPEO:['✏ mal tipeado','#f5c518'],
                            INCOMPLETO:['✂ nombre incompleto','#f5c518'],
                            PARECIDO:['≈ se parece','#8b949e'],
                            DISTINTO:['⚠ mismo teléfono','#8b949e']}[cl]||['⚠ mismo teléfono','#8b949e'];
                  return `<div class="small" style="color:${et[1]};margin-top:2px">
                    ${et[0]} · ya opera como <b style="color:#e6edf3">${escapeHtml(c.duplicado_de)}</b>
                    ${cl==='TIPEO'?'<span style="color:#5a6474"> ('+c.distancia+(Number(c.distancia)===1?' letra':' letras')+' de diferencia)</span>':''}
                    ${cl==='DISTINTO'?'<span style="color:#5a6474"> — puede ser otra persona</span>':''}
                  </div>`; })():''}
               ${c.vinculo_estado==='PENDIENTE'
                 ? `<div class="small" style="color:#fbbf24;margin-top:2px" title="Escribió este usuario al entrar al portal y nadie lo cotejó todavía. Si es un nombre mal escrito, unificalo; si es el correcto, validalo.">🟡 vínculo sin validar</div>`
                 : ''}</td>
             <td style="padding:6px 7px;font-family:ui-monospace,monospace">${escapeHtml(c.telefono||'—')}</td>
             <td style="padding:6px 7px;text-align:center">${c.push
                ? '<span style="background:rgba(111,143,208,.18);color:#8fa9e0;border-radius:3px;padding:1px 7px;font-size:10px;font-weight:700">PUSH</span>'
                : '<span style="background:#22303f;color:#8b949e;border-radius:3px;padding:1px 7px;font-size:10px;font-weight:700">WHATSAPP</span>'}</td>
             <td style="padding:6px 7px;text-align:center;color:#8b949e">${c.dias===0?'hoy':c.dias+' d'}</td>
             <td style="padding:6px 7px;text-align:center">${Number(c.intentos)>0
                ? '<span style="background:rgba(245,197,24,.16);color:#f5c518;border-radius:3px;padding:1px 7px;font-size:10px;font-weight:800">2º intento</span>'
                : '<span style="color:#5a6474">1º</span>'}</td>
             <td style="padding:6px 7px;text-align:right;white-space:nowrap">
               ${c.push?`<button class="mini-btn green" onclick="crmRxPush('${u}')" title="Mandarle la notificación con el texto de arriba">📲</button>`:''}
               ${tel?`<button class="mini-btn blue" onclick="crmRxWhatsapp('${u}','${tel}')" title="Abrir WhatsApp en el navegador con el mensaje listo">💬</button>`:''}
               <button class="mini-btn gray" onclick="abrirPerfilJugador('${u}')" title="Ver ficha">🌳</button>
               ${c.duplicado_de
                 ? `<button class="mini-btn green" onclick="crmRxUnificar('${u}','${String(c.duplicado_de).replace(/'/g,"\\'")}')"
                      title="Es el mismo usuario mal escrito: unificarlo con ${escapeHtml(c.duplicado_de)}">🔗 Unificar</button>`
                 : ''}
               <button class="mini-btn gray" onclick="crmRxMarcar('${u}','DESCARTADO','${c.canal}')" title="No corresponde: sacarlo de la lista">🗑</button>
               <button class="mini-btn yellow" onclick="crmRxMarcar('${u}','CONTACTADO','${c.canal}')" title="Ya lo contacté">✓</button>
               <button class="mini-btn red" onclick="crmRxMarcar('${u}','NO_CONTESTA','${c.canal}')" title="No contesta">✕</button>
             </td></tr>`;}).join('')}</tbody></table></div>
          <div class="small" style="color:#5a6474;margin-top:8px">
            <b>✓</b> contactado, sale de la cola · <b>✕</b> no contesta, vuelve en 3 días para un
            segundo intento · <b>🗑</b> no corresponde, sale y no vuelve ·
            <b>🔗</b> es el mismo usuario mal escrito, se unifica con el bueno.
            «Recuperado» se detecta solo cuando el usuario opera.</div>`);
  }
  window.crmRxTurno = function(t){ _RX.turno=t; _rxCargar(); };

  // ── Mensaje de reconexión ────────────────────────────────────────────────
  // Editable por el operador y guardado en ESTA PC (cada oficina escribe distinto).
  // Se usa igual para el push y para el WhatsApp, así el usuario recibe lo mismo
  // por los dos lados.
  // Mandar SIEMPRE el mismo texto a mucha gente es la forma más rápida de que WhatsApp
  // marque la línea como spam y la caiga. Por eso no hay un mensaje: hay una lista de
  // variantes (una por línea) y cada envío usa una distinta, rotando.
  const _RX_MSG_KEY = 'nodo_rx_variantes';
  const _RX_VAR_KEY = 'nodo_rx_ult_variante';
  // Los {a|b|c} se eligen al azar en cada envío: con estas 5 líneas salen miles de
  // combinaciones, así no hay dos mensajes iguales seguidos.
  const _RX_MSG_DEF = [
    '{Hola|Buenas|Hola!} {usuario}, {te escribo|te escribimos} de BET300. {Vimos que|Nos figura que} quedaste a {mitad de camino|medio camino} con tu carga, {¿te doy una mano|¿te ayudo a terminarla|¿lo vemos juntos}?',
    '{Buenas|Hola} {usuario}! {Quedó|Te quedó} una carga sin terminar {por acá|en el sistema}. {¿Seguís interesado|¿La querés retomar|¿Te la destrabo}?',
    '{Hola|Qué tal} {usuario}, {soy|te habla} del equipo de BET300. {Vi que|Me figura que} intentaste operar y no {pudiste|llegaste a completar}. {¿Necesitás ayuda|¿Te ayudo con eso|¿Qué te pasó}?',
    '{Hola|Buenas} {usuario}, {¿todo bien|¿cómo andás}? {Quedaste|Te quedó} una operación {sin completar|a medias}. {Si querés la terminamos ahora|Avisame y la terminamos|Cualquier cosa te guío}.',
    '{Hola|Buenas} {usuario}! {Te escribo|Paso a escribirte} porque {quedó|veo} una carga tuya {sin finalizar|incompleta}. {¿La retomamos|¿Te ayudo a cerrarla}?'
  ].join('\n');

  function _rxVariantes(){
    let raw; try{ raw = localStorage.getItem(_RX_MSG_KEY); }catch(_e){ raw = null; }
    if(raw == null) raw = _RX_MSG_DEF;
    return String(raw).split('\n').map(s=>s.trim()).filter(Boolean);
  }
  // {a|b|c} → elige una. Pide el "|" a propósito, así {usuario} no se toca.
  function _rxSpin(t){
    let s = String(t||''), vueltas = 0;
    while(/\{[^{}]*\|[^{}]*\}/.test(s) && vueltas++ < 20){
      s = s.replace(/\{([^{}]*\|[^{}]*)\}/g, function(_m, g){
        const op = g.split('|'); return op[Math.floor(Math.random()*op.length)];
      });
    }
    return s;
  }
  // Rota: nunca repite la variante anterior mientras haya más de una.
  function _rxProximaVariante(){
    const v = _rxVariantes(); if(!v.length) return '';
    let i = -1; try{ i = Number(localStorage.getItem(_RX_VAR_KEY)); }catch(_e){}
    if(!(i >= 0 && i < v.length)) i = -1;
    const sig = (i + 1) % v.length;
    try{ localStorage.setItem(_RX_VAR_KEY, String(sig)); }catch(_e){}
    return v[sig];
  }
  // Textos para el que HACE RATO NO CARGA. No puede ser el mismo juego que arriba: decirle
  // "quedaste a mitad de camino con tu carga" a alguien que se fue hace tres meses es falso,
  // y se lee como plantilla al toque. Acá no se promete ningún bono: eso lo decide el operador
  // según el caso, y ponerlo en la plantilla le ata las manos.
  const _RX_MSG_KEY_R = 'nodo_rx_variantes_rescate';
  const _RX_VAR_KEY_R = 'nodo_rx_ult_variante_rescate';
  const _RX_MSG_DEF_R = [
    '{Hola|Buenas} {usuario}, {te escribo|te escribimos} de BET300. {Hace un tiempo que no te vemos|Hace rato no pasás por acá}, {¿todo bien|¿cómo venís}?',
    '{Buenas|Hola} {usuario}! {Te tenía pendiente|Me quedaste pendiente}. {Cambiamos algunas cosas|Hay novedades} desde la última vez, {¿te cuento|¿querés que te cuente}?',
    '{Hola|Qué tal} {usuario}, {soy|te habla} del equipo de BET300. {Si querés volver|Cuando quieras volver} {te doy una mano|te acompaño} con lo que necesites.',
    '{Hola|Buenas} {usuario}, {¿cómo andás|¿todo bien}? {Vi que hace rato no cargás|Hace rato no te vemos por acá}. {¿Seguís jugando|¿Pasó algo|¿Te ayudo con algo}?',
    '{Buenas|Hola} {usuario}! {Paso a saludarte|Te escribo} {del equipo de BET300|de BET300}. {Cualquier cosa que necesites, avisame|Si querés retomar, escribime y te guío}.'
  ].join('\n');

  function _rxVariantesR(){
    let raw; try{ raw = localStorage.getItem(_RX_MSG_KEY_R); }catch(_e){ raw = null; }
    if(raw == null) raw = _RX_MSG_DEF_R;
    return String(raw).split('\n').map(s=>s.trim()).filter(Boolean);
  }
  function _rxProximaVarianteR(){
    const v = _rxVariantesR(); if(!v.length) return '';
    let i = -1; try{ i = Number(localStorage.getItem(_RX_VAR_KEY_R)); }catch(_e){}
    if(!(i >= 0 && i < v.length)) i = -1;
    const sig = (i + 1) % v.length;
    try{ localStorage.setItem(_RX_VAR_KEY_R, String(sig)); }catch(_e){}
    return v[sig];
  }
  // segmento 'RESCATE' → el juego de arriba; cualquier otra cosa → el de "quedó a mitad".
  function _rxMsgPara(usuario, segmento){
    const base = String(segmento||'').toUpperCase()==='RESCATE'
      ? _rxProximaVarianteR() : _rxProximaVariante();
    return _rxSpin(base)
             .replace(/\{usuario\}/gi, usuario || '')
             .replace(/\s+/g,' ').trim();
  }

  // ── Control de ritmo y volumen ───────────────────────────────────────────
  // Lo que voltea una línea no es sólo el texto repetido: es el volumen y la
  // velocidad. Contamos por PC y por día, y avisamos. No traba: avisa.
  const _RX_CNT_KEY = 'nodo_rx_contador';
  const _RX_WA_DIA_AVISO = 40;   // a partir de acá conviene aflojar
  const _RX_WA_DIA_FRENO = 60;   // acá ya es zona de riesgo
  const _RX_WA_SEG_MIN   = 25;   // menos de esto entre mensajes es ráfaga
  function _rxHoy(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}); }
  function _rxContador(){
    try{
      const j = JSON.parse(localStorage.getItem(_RX_CNT_KEY)||'{}');
      if(j && j.dia === _rxHoy()) return j;
    }catch(_e){}
    return { dia:_rxHoy(), wa:0, push:0, ultWa:0 };
  }
  function _rxSumar(tipo){
    const c = _rxContador();
    c[tipo] = (Number(c[tipo])||0) + 1;
    if(tipo === 'wa') c.ultWa = Date.now();
    try{ localStorage.setItem(_RX_CNT_KEY, JSON.stringify(c)); }catch(_e){}
    const el = document.getElementById('rxCont');
    if(el) el.innerHTML = _rxContadorHtml();
    return c;
  }
  function _rxContadorHtml(){
    const c = _rxContador();
    const col = c.wa >= _RX_WA_DIA_FRENO ? '#f04438' : (c.wa >= _RX_WA_DIA_AVISO ? '#f5c518' : '#8b949e');
    return 'Hoy en esta PC: <b style="color:'+col+'">'+(c.wa||0)+'</b> por WhatsApp · '
         + '<b style="color:#8fa9e0">'+(c.push||0)+'</b> por push';
  }

  window.crmRxGuardarMsg = function(){
    const el = document.getElementById('rxMsg'); if(!el) return;
    try{ localStorage.setItem(_RX_MSG_KEY, el.value || ''); }catch(_e){}
    const n = document.getElementById('rxNVar');
    if(n) n.textContent = _rxVariantes().length;
  };
  window.crmRxResetMsg = function(){
    try{ localStorage.removeItem(_RX_MSG_KEY); }catch(_e){}
    const el = document.getElementById('rxMsg'); if(el) el.value = _RX_MSG_DEF;
    const n = document.getElementById('rxNVar'); if(n) n.textContent = _rxVariantes().length;
    toast('Variantes vueltas a las originales','green');
  };
  // Deja ver cómo sale de verdad, con el sorteo hecho.
  window.crmRxEjemplo = function(){
    const v = _rxVariantes();
    if(!v.length){ toast('No hay ninguna variante escrita','orange'); return; }
    const m = [];
    for(let i=0;i<3;i++) m.push('• '+_rxMsgPara('juanperez'));
    alert('Tres ejemplos, tal cual salen:\n\n'+m.join('\n\n')
      +'\n\n('+v.length+' variantes escritas · el nombre real reemplaza a juanperez)');
  };

  // NODO guarda los teléfonos con 10 dígitos (área + número, sin país). Así como está
  // wa.me no lo entiende: hay que mandarle el internacional completo.
  function _rxNumeroWa(tel){
    let d = String(tel||'').replace(/\D/g,'');
    if(!d) return '';
    if(d.startsWith('00')) d = d.slice(2);
    if(d.startsWith('54')){                    // ya viene con país
      let r = d.slice(2);
      if(r.startsWith('9')) r = r.slice(1);    // lo sacamos para reponerlo prolijo
      return '549' + r;
    }
    if(d.length === 10) return '549' + d;      // el formato normal de la base
    if(d.length === 11 && d.startsWith('9')) return '54' + d;
    return d;                                  // otro país o formato raro: va tal cual
  }

  // segmento: sólo cambia el texto ('RESCATE' usa el juego de "hace rato no te vemos").
  window.crmRxWhatsapp = async function(usuario, tel, segmento){
    const num = _rxNumeroWa(tel);
    if(!num){ toast('Ese usuario no tiene teléfono cargado','orange'); return; }

    // Avisos de ritmo y volumen. Ninguno traba: el operador decide, pero se entera.
    const c = _rxContador();
    const seg = c.ultWa ? Math.round((Date.now() - c.ultWa)/1000) : 9999;
    if(c.wa >= _RX_WA_DIA_FRENO){
      if(!confirm('Ya mandaste '+c.wa+' WhatsApp desde esta PC hoy.\n\n'
        +'Seguir a este ritmo es lo que hace que WhatsApp marque la línea como spam '
        +'y la caiga para toda la oficina.\n\nMejor seguí mañana, o usá push con los que tienen.\n\n'
        +'¿Mandarlo igual?')) return;
    }else if(c.wa === _RX_WA_DIA_AVISO){
      toast('Van '+c.wa+' WhatsApp hoy. Espaciá los envíos y priorizá los que tienen push.','orange');
    }
    if(seg < _RX_WA_SEG_MIN){
      toast('Muy seguido ('+seg+'s). Esperá unos segundos entre mensajes.','orange');
    }

    // web.whatsapp.com/send en vez de wa.me: wa.me es una pantalla intermedia ("Continuar al
    // chat") que obliga a un clic extra por cada contacto y recién ahí redirige. Este link cae
    // DIRECTO en la conversación, dentro de la sesión de WhatsApp Web que el operador ya tiene
    // abierta. Con muchos rescates seguidos, ese clic de más es la mitad del trabajo.
    const url = 'https://web.whatsapp.com/send?phone=' + num
      + '&text=' + encodeURIComponent(_rxMsgPara(usuario, segmento));
    // Al navegador del operador, NO a una ventana de NODO: ahí ya tiene la sesión de
    // WhatsApp Web abierta y no hay que escanear ningún QR.
    try{
      if(window.panelAPI && window.panelAPI.abrirExterno){
        const r = await window.panelAPI.abrirExterno(url);
        if(r && r.ok === false) throw new Error(r.message||'');
      }else{
        window.open(url,'_blank');             // fuera de Electron (navegador suelto)
      }
      _rxSumar('wa');
      // Queda marcado SOLO por haber abierto el WhatsApp, sin depender de que el operador
      // se acuerde de tildar. Antes el ✓ era manual y el que se olvidaba dejaba a la persona
      // en la cola: al rato otro operador le escribía de nuevo. Abrirlo cuenta como contacto.
      // Contra: si cierra la ventana sin mandar nada, queda contactado igual — por eso la nota
      // dice de dónde salió y el operador puede pasarlo a NO_CONTESTA con un click.
      try{
        await supabaseClient.rpc('panel_reconexion_marcar', {
          p_secret: window.PANEL_DATA_SECRET,
          p_pc_codigo: (typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
          p_usuario: usuario, p_estado: 'CONTACTADO', p_canal: 'WHATSAPP',
          p_nota: 'WhatsApp abierto desde NODO',
          p_operador: (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre)) || ''
        });
      }catch(_e){}
    }catch(e){ toast('No se pudo abrir WhatsApp: '+(e.message||''),'red'); }
  };

  // Push propio de la cola: NO reusa crmPushIndividual porque ese busca al jugador en
  // el CRM y estos usuarios justamente nunca operaron, así que el texto salía vacío.
  window.crmRxPush = async function(usuario){
    try{
      const res = await pushEnviar({
        usuario: String(usuario).trim().toLowerCase(),
        title: 'BET300 · Hola ' + usuario,
        body: _rxMsgPara(usuario),
        url: '/', tag: 'bet300-reconexion'
      });
      if(res && res.sent > 0){
        _rxSumar('push');
        toast('Push enviado a '+usuario,'green');
      }else if(res && res.error){
        toast('Error: '+res.error,'red');
      }else if(res && res.reason === 'sin_suscripciones'){
        toast(usuario+' ya no tiene la notificación activa — escribile por WhatsApp','orange');
      }else{
        toast('No se envió el push a '+usuario,'orange');
      }
    }catch(e){ toast('No se pudo enviar: '+(e.message||''),'red'); }
  };
  window.crmRxMarcar = async function(usuario, estado, canal){
    try{
      // Variante con secreto del panel: el operador no tiene sesión de Admi, así que no puede
      // usar admin_od_reconexion_marcar. Queda registrado quién marcó, leído de Chunior.
      const quien = (typeof operador!=='undefined' && operador)
        ? (operador.usuario || operador.nombre || '') : '';
      const { data, error } = await supabaseClient.rpc('panel_reconexion_marcar',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_usuario: usuario, p_estado: estado, p_canal: canal||null,
        p_nota: null, p_operador: quien||null });
      if(error) throw new Error(error.message||'no se pudo marcar');
      if(data && data.ok===false) throw new Error(data.error||'no se pudo marcar');
      toast(estado==='CONTACTADO' ? ('✓ '+usuario+' contactado')
            : estado==='DESCARTADO' ? ('🗑 '+usuario+' sacado de la lista')
            : (data && data.cerrado) ? ('✕ '+usuario+' · 2º intento, se cierra')
            : ('✕ '+usuario+' · vuelve en 3 días'),
            estado==='CONTACTADO'?'green':(estado==='DESCARTADO'?'gray':'yellow'));
      _rxCargar();
    }catch(e){ toast('No se pudo marcar: '+(e.message||''),'red'); }
  };

  // Unificar: el de la cola es el mismo usuario escrito mal. Pide confirmación porque
  // toca el vínculo, y un teléfono compartido en familia NO es un duplicado.
  window.crmRxUnificar = async function(malo, bueno){
    if(!confirm('¿"'+malo+'" es la misma persona que "'+bueno+'", escrita mal?\n\n'
      +'Se saca de la lista y el vínculo queda marcado como duplicado de "'+bueno+'".\n\n'
      +'Si son dos personas distintas que comparten el teléfono (familia), cancelá y usá 🗑.')) return;
    try{
      const quien = (typeof operador!=='undefined' && operador) ? (operador.usuario||operador.nombre||'') : '';
      const { data, error } = await supabaseClient.rpc('panel_reconexion_unificar',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_usuario: malo, p_canonico: bueno, p_operador: quien||null });
      if(error) throw new Error(error.message||'');
      if(data && data.ok===false){
        toast(data.error==='EL_CANONICO_NO_TIENE_OPERACIONES'
          ? 'Ojo: "'+bueno+'" no tiene operaciones. No se unificó.'
          : ('No se pudo unificar: '+data.error), 'red');
        return;
      }
      toast('✓ '+malo+' unificado con '+bueno,'green');
      _rxCargar();
    }catch(e){ toast('No se pudo unificar: '+(e.message||''),'red'); }
  };

  // ── Prevalidar, acá adentro ──────────────────────────────────────────────
  // Es la misma consulta del botón Prevalidar, pero al lado de la cola: los operadores
  // revisan caso por caso y necesitan las dos cosas juntas.
  function _rxPintarPrevalidar(){
    const b=_rxDestino(); if(!b) return;
    b.innerHTML =
      `<div class="card" style="max-width:760px">
         <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:10px">
           <div style="flex:1;min-width:190px">
             <div class="small" style="color:#8b949e;margin-bottom:3px">Teléfono</div>
             <input id="rxPvTel" placeholder="2216437576" onkeydown="if(event.key==='Enter')crmRxPrevalidar()"
                    style="width:100%;background:#0f141d;border:1px solid #21283a;border-radius:6px;
                           padding:7px 9px;color:#e6edf3;font-family:ui-monospace,monospace"></div>
           <div style="flex:1;min-width:190px">
             <div class="small" style="color:#8b949e;margin-bottom:3px">Usuario (opcional)</div>
             <input id="rxPvUsr" placeholder="mariaaa1010" onkeydown="if(event.key==='Enter')crmRxPrevalidar()"
                    style="width:100%;background:#0f141d;border:1px solid #21283a;border-radius:6px;
                           padding:7px 9px;color:#e6edf3;font-family:ui-monospace,monospace"></div>
           <button class="mini-btn green" onclick="crmRxPrevalidar()">Buscar</button>
         </div>
         <div class="small" style="color:#5a6474">
           Antes de crear un usuario nuevo. Dice si ese teléfono ya tiene cuenta acá, si ya
           cobró el bono de primer ingreso y si su CBU aparece en otras cuentas.</div>
         <div id="rxPvRes" style="margin-top:12px"></div>
       </div>`;
    const i=document.getElementById('rxPvTel'); if(i) i.focus();
  }
  window.crmRxPrevalidar = async function(){
    const tel=(document.getElementById('rxPvTel')||{}).value||'';
    const usr=(document.getElementById('rxPvUsr')||{}).value||'';
    const box=document.getElementById('rxPvRes'); if(!box) return;
    if(!String(tel).trim() && !String(usr).trim()){
      box.innerHTML='<div class="alert-box" style="padding:10px">Poné al menos el teléfono.</div>'; return; }
    box.innerHTML='<div class="load" style="color:#8b949e">Buscando…</div>';
    try{
      const { data, error } = await supabaseClient.rpc('panel_prevalidar_usuario',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_telefono: tel||null, p_usuario: usr||null });
      if(error) throw new Error(error.message||'');
      if(data && data.ok===false) throw new Error(data.error||'sin datos');
      const v=String(data.veredicto||'').toUpperCase();
      const col = v==='LIBRE'?'#12b76a':(v==='YA_EXISTE'?'#f5c518':'#f04438');
      const txt = v==='LIBRE'?'LIBRE · se puede crear'
                : v==='YA_EXISTE'?'YA EXISTE · usá la cuenta que ya tiene'
                : 'REVISAR · mirá los motivos';
      box.innerHTML =
        `<div style="border:1px solid ${col}55;background:${col}14;border-radius:8px;padding:11px 13px;margin-bottom:10px">
           <b style="color:${col};font-size:15px">${escapeHtml(txt)}</b></div>`
      + ((data.motivos||[]).length
          ? '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">'
            + (data.motivos||[]).map(m=>{
                const nivel=String(m.nivel||m.gravedad||'').toUpperCase();
                const c = nivel==='ALTO'?'#f04438':(nivel==='MEDIO'?'#f5c518':'#8b949e');
                return `<div style="border-left:3px solid ${c};padding:2px 0 2px 10px">
                          <b style="color:${c};font-size:11px">${escapeHtml(nivel||'INFO')}</b>
                          <div class="small" style="color:#c9d1d9">${escapeHtml(m.detalle||m.texto||m.motivo||JSON.stringify(m))}</div>
                        </div>`; }).join('')
            + '</div>'
          : '<div class="small" style="color:#5a6474;margin-bottom:10px">Sin observaciones.</div>')
      + ((data.cuentas||[]).length
          ? '<div class="small" style="color:#8b949e">Cuentas con ese teléfono: '
            + (data.cuentas||[]).map(x=>'<b style="color:#e6edf3">'+escapeHtml(x.usuario||x)+'</b>').join(' · ')+'</div>'
          : '');
    }catch(e){
      box.innerHTML='<div class="err-box" style="padding:10px">No se pudo consultar: '+escapeHtml(e.message||'')+'</div>';
    }
  };

  // Los dormidos salen de la base, NO del CRM en memoria: ahí Whaticket entra recortado
  // a 1000 filas de 170k y al que nunca operó lo marca NUEVO. Medido en P5: 398 para
  // recuperar y 315 no aparecían en ninguna lista.
  async function _rxCargarDormidos(estado){
    _RX.dormEstado = estado || _RX.dormEstado || 'DORMIDO';
    const b=_rxDestino();
    if(b) b.innerHTML='<div class="load" style="padding:16px;color:#8b949e">Buscando en la base de la oficina…</div>';
    try{
      const { data, error } = await supabaseClient.rpc('panel_dormidos',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_estado: _RX.dormEstado, p_limit: 300 });
      if(error) throw new Error(error.message||'');
      if(!data || data.ok===false) throw new Error((data&&data.error)||'sin datos');
      _RX.dormidos = data;
    }catch(e){
      _RX.dormidos = null;
      if(b) b.innerHTML='<div class="err-box" style="padding:10px">No se pudo cargar: '+escapeHtml(e.message||'')+'</div>';
      return;
    }
    _rxPintarFrios();
  }
  window.crmRxDorm = function(est){ _rxCargarDormidos(est); };

  // ── Acciones sueltas, para usar desde cualquier fila del CRM ─────────────
  // Resuelve el teléfono: primero el que ya tenga la fila, si no lo pide a la base
  // (el CRM en memoria casi nunca lo trae).
  async function _rxTelefonoDe(usuario){
    const u=String(usuario||'').toLowerCase();
    try{
      const j=(window._crmJugadoresData||[]).find(x=>String(x.usuario).toLowerCase()===u);
      if(j && j.telefono) return String(j.telefono);
    }catch(_e){}
    try{
      const { data, error } = await supabaseClient.rpc('panel_usuarios_contacto',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_usuarios:[u] });
      if(error || !data || data.ok===false) return '';
      const x=(data.usuarios||[])[0];
      return (x && x.telefono) ? String(x.telefono) : '';
    }catch(_e){ return ''; }
  }

  window.crmContactar = async function(usuario){
    const tel = await _rxTelefonoDe(usuario);
    if(!tel){ toast(usuario+' no tiene teléfono cargado','orange'); return; }
    crmRxWhatsapp(usuario, tel);          // usa el mensaje rotativo y suma al contador
  };

  // Prevalidar sin salir del CRM: mismo chequeo del botón grande, en un modal chico.
  window.crmPrevalidarRapido = async function(usuario){
    abrirModal('✅ Prevalidar · '+usuario,
      '<div class="load" style="padding:14px;color:#8b949e">Consultando…</div>', null, 'Cerrar');
    const pinta = h => { const b=document.getElementById('modalBody'); if(b) b.innerHTML=h; };
    try{
      const tel = await _rxTelefonoDe(usuario);
      const { data, error } = await supabaseClient.rpc('panel_prevalidar_usuario',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_telefono: tel||null, p_usuario: usuario });
      if(error) throw new Error(error.message||'');
      if(data && data.ok===false) throw new Error(data.error||'sin datos');
      const v=String(data.veredicto||'').toUpperCase();
      const col = v==='LIBRE'?'#12b76a':(v==='YA_EXISTE'?'#f5c518':'#f04438');
      pinta(
        `<div style="border:1px solid ${col}55;background:${col}14;border-radius:8px;padding:11px 13px;margin-bottom:10px">
           <b style="color:${col};font-size:15px">${escapeHtml(v||'—')}</b>
           ${tel?'<div class="small" style="color:#8b949e;margin-top:3px">Teléfono '+escapeHtml(tel)+'</div>':''}
         </div>`
      + ((data.motivos||[]).length
          ? (data.motivos||[]).map(m=>{
              const n=String(m.nivel||m.gravedad||'').toUpperCase();
              const c=n==='ALTO'?'#f04438':(n==='MEDIO'?'#f5c518':'#8b949e');
              return `<div style="border-left:3px solid ${c};padding:2px 0 2px 10px;margin-bottom:6px">
                        <b style="color:${c};font-size:11px">${escapeHtml(n||'INFO')}</b>
                        <div class="small" style="color:#c9d1d9">${escapeHtml(m.detalle||m.texto||m.motivo||'')}</div>
                      </div>`; }).join('')
          : '<div class="small" style="color:#5a6474">Sin observaciones.</div>')
      + ((data.cuentas||[]).length
          ? '<div class="small" style="color:#8b949e;margin-top:8px">Otras cuentas con ese teléfono: '
            + (data.cuentas||[]).map(x=>'<b style="color:#e6edf3">'+escapeHtml(x.usuario||x)+'</b>').join(' · ')+'</div>'
          : ''));
    }catch(e){
      pinta('<div class="err-box" style="padding:10px">No se pudo consultar: '+escapeHtml(e.message||'')+'</div>');
    }
  };

  function _rxPintarFrios(){
    const b=_rxDestino(); if(!b) return;
    if(!_RX.dormidos){ _rxCargarDormidos(_RX.dormEstado); return; }
    const D=_RX.dormidos, R=D.resumen||{}, lista=D.lista||[];
    const est=_RX.dormEstado||'DORMIDO';
    const tab=(k,lbl,n)=>`<button class="mini-btn ${est===k?'green':'gray'}" onclick="crmRxDorm('${k}')">${lbl}${n!=null?' <b>'+n+'</b>':''}</button>`;
    const sinTel = lista.filter(x=>!x.telefono).length;
    b.innerHTML =
      `<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
         ${tab('DORMIDO','😴 Dormidos +30d', R.dormido)}
         ${tab('ENFRIANDO','🌡 Enfriando 15-30d', R.enfriando)}
         ${tab('NUNCA','👤 Nunca operaron', R.nunca)}
         <span style="flex:1"></span>
         <span class="small" style="color:#5a6474">
           Mostrando ${lista.length} de ${D.total||0}${sinTel?' · '+sinTel+' sin teléfono':''}
           ${R.ya_trabajados?' · '+R.ya_trabajados+' ya trabajados':''}</span>
       </div>`
    + (est==='NUNCA' && Number(R.nunca)>1000
       ? `<div class="alert-box" style="padding:10px;margin-bottom:10px">
            <b>Son ${Number(R.nunca).toLocaleString('es-AR')} personas.</b> Esto no es una cola de
            trabajo: son contactos de WhatsApp que nunca operaron. A 40 mensajes por día tardarías
            años, y mandarles a todos es lo que quema la línea. Usalo para buscar casos puntuales,
            no para barrer.</div>`
       : '')
    + (est==='DORMIDO'
       ? `<div class="small" style="color:#5a6474;margin-bottom:10px">
            Jugaron y dejaron de venir. Ordenados por lo que cargaron: los de arriba son los que
            más valen la pena.</div>` : '')
    + (!lista.length
       ? '<div class="alert-box" style="padding:14px">No hay nadie en este estado. 👌</div>'
       : `<div style="max-height:58vh;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="position:sticky;top:0;background:#161b26;z-index:1">
            <th style="padding:7px;text-align:left">Jugador</th><th style="padding:7px">Cargó</th>
            <th style="padding:7px">Última</th><th style="padding:7px">Canal</th>
            <th style="padding:7px;text-align:right">Acciones</th></tr></thead><tbody>${
          lista.map(j=>{
            const u=String(j.usuario).replace(/'/g,"\\'");
            const tel=String(j.telefono||'').replace(/\D/g,'');
            return `<tr style="border-top:1px solid #21283a">
              <td style="padding:6px 7px"><b>${escapeHtml(j.usuario)}</b>
                <div class="small" style="color:#5a6474">${j.ops||0} ops${
                  j.telefono?' · 📱 '+escapeHtml(j.telefono):''}${
                  j.titular?' · 👤 '+escapeHtml(j.titular):''}</div></td>
              <td style="padding:6px 7px;text-align:center">${j.monto_cargas?fmtMoney(j.monto_cargas):'<span style="color:#5a6474">—</span>'}</td>
              <td style="padding:6px 7px;text-align:center;color:#8b949e">${
                j.dias!=null?j.dias+' d':'<span style="color:#5a6474">nunca operó</span>'}</td>
              <td style="padding:6px 7px;text-align:center">${j.push
                ? '<span style="background:rgba(111,143,208,.18);color:#8fa9e0;border-radius:3px;padding:1px 7px;font-size:10px;font-weight:700">PUSH</span>'
                : '<span style="background:#22303f;color:#8b949e;border-radius:3px;padding:1px 7px;font-size:10px;font-weight:700">WHATSAPP</span>'}</td>
              <td style="padding:6px 7px;text-align:right;white-space:nowrap">
                ${j.push?`<button class="mini-btn green" onclick="crmRxPush('${u}')" title="Notificación">📲</button>`:''}
                ${tel?`<button class="mini-btn blue" onclick="crmRxWhatsapp('${u}','${tel}')" title="WhatsApp">💬</button>`:''}
                <button class="mini-btn gray" onclick="abrirPerfilJugador('${u}')" title="Ficha">🌳</button>
                <button class="mini-btn gray" onclick="crmRxMarcar('${u}','CONTACTADO','${j.push?'PUSH':'WHATSAPP'}')" title="Ya lo contacté">✓</button>
              </td></tr>`; }).join('')}</tbody></table></div>
          <div class="small" style="color:#5a6474;margin-top:8px">
            Usa el mismo mensaje rotativo que la cola y el mismo contador del día: cuidá la línea
            igual que en Reconectar. El ✓ lo saca de acá y queda registrado.</div>`);
  }


  // Limpieza en lote. Primero simula y muestra qué va a hacer: son muchos de una,
  // y conviene que el operador vea la lista antes de aceptar.
  window.crmRxLimpiar = async function(){
    const pc=(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'';
    const quien=(typeof operador!=='undefined' && operador)?(operador.usuario||operador.nombre||''):'';
    try{
      const sim = await supabaseClient.rpc('panel_reconexion_limpiar_seguros',{
        p_secret: window.PANEL_DATA_SECRET, p_pc_codigo: pc,
        p_operador: quien||null, p_simular: true });
      if(sim.error) throw new Error(sim.error.message||'');
      const d = sim.data||{};
      const n = Number(d.cantidad||0);
      if(!n){ toast('No hay nada seguro para unificar','yellow'); return; }
      const pares=(d.pares||[]).slice(0,12)
        .map(p=>'  · '+p.de+'  →  '+p.a+'   ('+(p.clase==='TIPEO'?'mal tipeado':'nombre incompleto')+')')
        .join('\n');
      if(!confirm('Se van a unificar '+n+' usuarios con la cuenta que ya opera.\n\n'+pares
        +(n>12?('\n  … y '+(n-12)+' más'):'')
        +'\n\nCada uno sale de la lista y su vínculo queda marcado como duplicado.\n'
        +'Los que pueden ser otra persona con el mismo teléfono NO se tocan.\n\n¿Confirmás?')) return;

      const res = await supabaseClient.rpc('panel_reconexion_limpiar_seguros',{
        p_secret: window.PANEL_DATA_SECRET, p_pc_codigo: pc,
        p_operador: quien||null, p_simular: false });
      if(res.error) throw new Error(res.error.message||'');
      if(res.data && res.data.ok===false) throw new Error(res.data.error||'');
      toast('✓ '+Number(res.data.cantidad||0)+' usuarios unificados','green');
      _rxCargar();
    }catch(e){ toast('No se pudo limpiar: '+(e.message||''),'red'); }
  };

  // ── Prevalidar antes de crear ─────────────────────────────────────────────
  window.crmAbrirPrevalidar = function(){
    abrirModal('✅ Prevalidar antes de crear un usuario',
      `<div style="display:flex;flex-direction:column;gap:9px">
         <div class="small" style="color:#8b949e">Antes de dar de alta, chequeá si esa persona ya
           tiene cuenta. Con el teléfono alcanza; el usuario que pide es opcional.</div>
         <div style="display:flex;gap:8px;flex-wrap:wrap">
           <input id="pvTel" placeholder="Teléfono" inputmode="numeric"
                  style="flex:1;min-width:170px;height:38px;padding:0 10px">
           <input id="pvUsr" placeholder="Usuario que pide (opcional)"
                  style="flex:1;min-width:170px;height:38px;padding:0 10px">
           <button class="mini-btn green" style="height:38px;padding:0 16px" onclick="crmPrevalidar()">Consultar</button>
         </div>
         <div id="pvOut"></div>
       </div>`, null, 'Cerrar');
    setTimeout(()=>{ const t=document.getElementById('pvTel'); if(t) t.focus(); },80);
    const go=e=>{ if(e.key==='Enter') window.crmPrevalidar(); };
    setTimeout(()=>{ ['pvTel','pvUsr'].forEach(i=>{const el=document.getElementById(i); if(el) el.addEventListener('keydown',go);}); },80);
  };
  window.crmPrevalidar = async function(){
    const out=document.getElementById('pvOut'); if(!out) return;
    const tel=(document.getElementById('pvTel')||{}).value||'';
    const usr=(document.getElementById('pvUsr')||{}).value||'';
    if(!String(tel).replace(/\D/g,'') && !String(usr).trim()){
      out.innerHTML='<div class="alert-box" style="padding:9px">Poné al menos el teléfono o el usuario.</div>'; return; }
    out.innerHTML='<div class="small" style="color:#8b949e;padding:9px">Consultando…</div>';
    try{
      const { data, error } = await supabaseClient.rpc('panel_prevalidar_usuario',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||'',
        p_telefono: tel||null, p_usuario: usr||null });
      if(error) throw new Error(error.message||'falló la consulta');
      if(!data || data.ok===false) throw new Error((data&&data.error)||'sin datos');
      const col = data.veredicto==='LIBRE' ? '#22c55e' : data.veredicto==='YA_EXISTE' ? '#ef4444' : '#f5c518';
      const txt = data.veredicto==='LIBRE' ? 'SE PUEDE CREAR'
                : data.veredicto==='YA_EXISTE' ? 'YA TIENE CUENTA — NO CREAR' : 'REVISAR ANTES DE CREAR';
      out.innerHTML =
        `<div style="border:1.5px solid ${col};background:${col}14;border-radius:10px;padding:11px 13px">
           <div style="font-weight:900;color:${col};font-size:15px">${txt}</div>
           <ul style="margin:7px 0 0;padding-left:19px;font-size:13px">${
             (data.motivos||[]).map(m=>`<li style="margin:3px 0;color:${
               m.nivel==='ALTO'?'#fca5a5':m.nivel==='MEDIO'?'#fde68a':m.nivel==='OK'?'#86efac':'#8b949e'
             }">${escapeHtml(m.texto)}</li>`).join('')}</ul>
         </div>`
      + ((data.cuentas||[]).length
        ? `<div style="margin-top:10px"><div class="small" style="color:#8b949e;margin-bottom:4px">Cuentas de ese teléfono</div>
           <table style="width:100%;border-collapse:collapse;font-size:12.5px">
             <thead><tr><th style="text-align:left;padding:5px">Ofi</th><th style="text-align:left;padding:5px">Usuario</th>
               <th style="padding:5px">Estado</th><th style="padding:5px">Cargas</th><th style="padding:5px">Retiros</th>
               <th style="padding:5px">Bonos</th><th style="padding:5px"></th></tr></thead><tbody>${
             data.cuentas.map(c=>`<tr style="border-top:1px solid #21283a;${c.misma_oficina?'background:rgba(239,68,68,.07)':''}">
               <td style="padding:5px;font-family:ui-monospace,monospace;font-weight:700">${escapeHtml(c.pc)}</td>
               <td style="padding:5px"><b>${escapeHtml(c.usuario)}</b></td>
               <td style="padding:5px;text-align:center;color:#8b949e">${escapeHtml(c.estado||'—')}</td>
               <td style="padding:5px;text-align:center">${c.cargas||0}</td>
               <td style="padding:5px;text-align:center">${c.retiros||0}</td>
               <td style="padding:5px;text-align:center">${Number(c.bonos)?'<b style="color:#f5c518">'+c.bonos+'</b>':'0'}</td>
               <td style="padding:5px;text-align:right"><button class="mini-btn gray"
                   onclick="abrirPerfilJugador('${String(c.usuario).replace(/'/g,"\\'")}')">🌳</button></td>
             </tr>`).join('')}</tbody></table></div>` : '')
      + ((data.cbus||[]).length
        ? `<div style="margin-top:10px"><div class="small" style="color:#8b949e;margin-bottom:4px">CBU compartido con otras cuentas</div>${
           data.cbus.map(c=>`<div style="background:#1a1f2b;border:1px solid #2a3344;border-radius:7px;padding:8px 10px;margin-bottom:5px">
             <div style="font-family:ui-monospace,monospace;font-size:12px">${escapeHtml(c.cbu)}${c.titular?' · <b>'+escapeHtml(c.titular)+'</b>':''}</div>
             <div class="small" style="color:#fca5a5;margin-top:2px">${c.cuentas} cuentas: ${escapeHtml(c.usuarios||'')}</div>
           </div>`).join('')}</div>` : '');
    }catch(e){ out.innerHTML='<div class="err-box" style="padding:9px">'+escapeHtml(e.message||'error')+'</div>'; }
  };

  function renderCRM(){
  // NO repintar encima del operador. renderCRM reescribe el innerHTML de TODA la vista, y hay
  // dos disparos tardíos: uno al segundo de arrancar y otro después de cargarOperacionesAgente,
  // que tarda ~2 s. Si en el medio empezó a escribir en el buscador, le borraban el texto y
  // tenía que esperar a que el campo volviera a existir para tipear de nuevo. Con el foco
  // puesto o con algo escrito, la vista se deja como está.
  try{
    const _b=document.getElementById("crmBuscar");
    if(_b && (document.activeElement===_b || String(_b.value||"").trim()!=="")) return;
  }catch(_e){}
  installCss();const view=document.getElementById("viewJugadores");if(!view)return;const data=buildCRM();// Se sacaron los contadores Total / VIP / Activos / Tibios / Frios: salian SIEMPRE en cero.
  // Se calculaban sobre buildCRM(), que devuelve [] mientras no se pida "Cargar lista" — o sea,
  // casi siempre. Y aun cargando, contaban solo lo que esta PC bajo, no la oficina.
  // La segmentacion real la tiene que dar Nexo, que ve todas las operaciones y no una copia local.
  // Queda "Registrados (WTK)", que es un count(*) del servidor y si es cierto.
  view.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><div><h1 style="font-size:26px">🏅 Jugadores / CRM operativo</h1><div class="small">Segmentación interna calculada desde historial. Luego se conecta al portal para promos.</div></div><div style="display:flex;gap:8px"><button class="mini-btn green" onclick="crmAbrirReconexion()" title="Usuarios que entraron al portal y nunca completaron una operación — cola de tu turno">🔁 Reconectar</button><button class="mini-btn ${window._crmCargado?'gray':'yellow'}" onclick="crmCargarLista()" title="Arma la lista completa de la oficina. Tarda unos segundos: normalmente alcanza con buscar.">📥 ${window._crmCargado?'Recargar lista':'Cargar lista'}</button><button class="mini-btn gray" onclick="mostrarBlacklist24h()" id="btnVerBlacklist" title="Usuarios con retiros en las últimas 24hs">🚫 Blacklist 24hs</button><button class="mini-btn blue" onclick="cargarJugadores()">🔄 Recalcular</button></div></div><div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><h2 class="card-title" style="margin:0">🔎 Buscar jugador</h2><div style="display:flex;align-items:center;gap:8px"><span class="small" style="color:var(--muted)">Mostrar</span><select id="crmBusqCantidad" onchange="crmBusqCantidad(this.value)" class="sol-select" style="max-width:110px"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></div></div><div class="crm-toolbar"><input id="crmBuscar" placeholder="Buscá usuario, titular o teléfono…" oninput="crmBusqTexto(this.value)"><div class="small" style="display:flex;align-items:center;color:var(--muted)">Resultados: <b id="crmTotalVisible" style="margin-left:5px">0</b></div></div><div id="crmResultados"><div class="small" style="padding:14px;color:var(--muted)">Buscando…</div></div><div id="crmTabla"></div></div>`;renderCRMTabla(data);
  // Al abrir se traen los primeros, sin que nadie apriete nada. Es una consulta con LIMIT,
  // no la oficina entera: eso sigue estando detrás de "Cargar lista".
  try{ setTimeout(crmBuscarServidor, 0); }catch(_e){}
}
  // ── Buscador de jugadores ───────────────────────────────────────────────────
  // Un solo apartado. Antes eran dos tarjetas —"Buscar jugador" y "Registrados"— y en el fondo
  // es la misma búsqueda: la de arriba filtraba lo que había en memoria y la de abajo pedía al
  // servidor. Ahora hay un buscador, y cuántos traer se elige en el desplegable.
  // Sin paginado: se trae lo que el operador pide, no páginas que hay que ir pasando.
  // Tampoco se nombra la oficina: el operador ya está adentro de la suya, saber que hay siete
  // atrás no le sirve para nada.
  window._crmBusq = { cantidad: 10, q: "", pedido: 0, total: null, pagina: 0 };

  // Las páginas SÍ hacen falta: sin ellas sólo se ven los primeros 10..100 y siempre los
  // mismos. Una oficina tiene 6.635 registrados (P1) o 13.759 (P4): la lista no sirve para
  // recorrerla si no se puede avanzar.
  window.crmBusqPagina = function(delta){
    const st = window._crmBusq;
    const ultima = st.total != null ? Math.max(0, Math.ceil(st.total / st.cantidad) - 1) : st.pagina + 1;
    const destino = Math.min(Math.max(0, st.pagina + delta), ultima);
    if(destino === st.pagina) return;
    st.pagina = destino;
    crmBuscarServidor();
  };

  window.crmBusqCantidad = function(v){
    window._crmBusq.cantidad = Math.max(1, Math.min(200, Number(v) || 10));
    window._crmBusq.pagina = 0;   // cambia el tamaño: la página vieja ya no significa lo mismo
    crmBuscarServidor();
  };

  window.crmBusqTexto = function(v){
    window._crmBusq.q = String(v || "").trim();
    window._crmBusq.pagina = 0;
    clearTimeout(window._crmBusqT);
    window._crmBusqT = setTimeout(crmBuscarServidor, 300);
  };

  window.crmBuscarServidor = async function(){
    const st = window._crmBusq;
    const caja = document.getElementById("crmResultados");
    if(!caja) return;
    const health=window.NodoSalud?.begin('IDENTIDAD');
    try{

    // Token en vez de candado booleano: renderCRM repinta la vista varias veces, y con un
    // candado la segunda llamada se salteaba y la respuesta de la primera terminaba escrita en
    // una caja que ya no estaba en pantalla — quedaba "Cargando…" para siempre.
    const miPedido = ++st.pedido;
    caja.innerHTML = '<div class="small" style="padding:14px;color:var(--muted)">Buscando…</div>';

    // La oficina sale del login de Chunior, igual que el historial. No se muestra en pantalla:
    // se usa para no traer las otras seis.
    const oficinas = (typeof pcAliasesHist === "function") ? pcAliasesHist() : null;

    let filas = [];
    try{
      const { data, error } = await supabaseClient.rpc("panel_crm_vinculos_listar", {
        p_pc_codigos: oficinas,
        p_q: st.q || null,
        p_limit: st.cantidad,
        p_offset: st.pagina * st.cantidad,
        p_secret: window.PANEL_DATA_SECRET
      });
      health?.reply(error);
      if(miPedido !== st.pedido || (health && !health.current()))return;
      if(error) throw error;
      if(!Array.isArray(data) || data.some(row=>!row || typeof row.usuario!=='string' || !row.usuario.trim()
        || !Number.isFinite(Number(row.total)) || Number(row.total)<0)){
        const invalid=new Error('El servidor no devolvió una lista válida de jugadores.');
        invalid.code='IDENTIDAD_INVALID_DATA';throw invalid;
      }
      filas = data;
      st.total = filas.length ? Number(filas[0].total) : 0;
      health?.record('DATA','OK','IDENTIDAD_LIST_VALID');
    }catch(e){
      if(miPedido !== st.pedido || (health && !health.current())) return; // llegó tarde: ya hay otra búsqueda
      health?.record('DATA','ERROR',e.code==='IDENTIDAD_INVALID_DATA'?'IDENTIDAD_INVALID_DATA':health.errorCode(e));
      const box = document.getElementById("crmResultados");
      const msg = String((e && e.message) || e);
      if(box) box.innerHTML = '<div class="alert-box">No se pudo buscar: ' + escapeHtml(msg)
        + (/NO_AUTORIZADO/.test(msg) ? '<br><span class="small">Esta PC no tiene la clave de la oficina (se configura desde NODO ADMIN).</span>' : '')
        + '</div>';
      return;
    }

    if(miPedido !== st.pedido) return;                // respuesta vieja, la descartamos
    // Se vuelve a buscar la caja: entre el pedido y la respuesta la vista pudo repintarse.
    const box = document.getElementById("crmResultados");
    if(!box){health?.record('RENDER','UNKNOWN','IDENTIDAD_DOM_UNAVAILABLE');return;}

    // Misma regla al revés: si buscás, se apaga la lista completa.
    const tabla = document.getElementById("crmTabla");
    if(tabla) tabla.innerHTML = "";

    const cnt = document.getElementById("crmTotalVisible");
    if(cnt) cnt.textContent = String(filas.length);

    if(!filas.length){
      box.innerHTML = '<div class="small" style="padding:14px;color:var(--muted)">'
        + (st.q ? 'Nadie con «' + escapeHtml(st.q) + '».' : 'Sin jugadores para mostrar.')
        + '</div>';
      health?.record('RENDER','OK','IDENTIDAD_DOM_UPDATED');
      return;
    }

    // Encabezado que dice qué es esta lista. Sin búsqueda no es "todos": son las últimas
    // altas, y conviene decirlo antes de que alguien saque conclusiones de lo que ve.
    const encabezado = st.q
      ? 'Coinciden con «<b>' + escapeHtml(st.q) + '</b>» · primero las coincidencias más fuertes'
      : 'Ordenados por lo que hay que atender: primero los que esperan, después los que nunca operaron';

    const desde = st.pagina * st.cantidad + 1;
    const hasta = st.pagina * st.cantidad + filas.length;
    const hayMas = st.total != null && hasta < st.total;
    const pie =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">'
      +   '<span class="small" style="color:var(--muted)">' + desde + '–' + hasta
      +     (st.total != null ? ' de <b>' + Number(st.total).toLocaleString("es-AR") + '</b>' : '') + '</span>'
      +   '<span style="display:flex;gap:6px">'
      +     '<button class="mini-btn gray" onclick="crmBusqPagina(-1)"' + (st.pagina === 0 ? ' disabled' : '') + '>← Anterior</button>'
      +     '<button class="mini-btn gray" onclick="crmBusqPagina(1)"' + (hayMas ? '' : ' disabled') + '>Siguiente →</button>'
      +   '</span>'
      + '</div>';

    box.innerHTML =
      '<div class="small" style="color:var(--muted);margin-bottom:8px">' + encabezado + '</div>'
      + '<div class="crm-table-wrap"><table><thead><tr>'
      + '<th>Jugador</th><th>Teléfono</th><th>Titular</th><th>Alta</th><th>Acciones</th>'
      + '</tr></thead><tbody>'
      + filas.map(function(f){
          const u = String(f.usuario || "");
          const uEsc = u.replace(/'/g, "\\'");
          const tel = String(f.telefono || "");
          const alta = f.created_at ? new Date(f.created_at).toLocaleDateString("es-AR") : "—";
          const estado = String(f.estado_vinculo || "").toUpperCase();
          return '<tr class="crm-row" style="cursor:pointer" onclick="abrirPerfilJugador(\'' + escapeHtml(uEsc) + '\')" title="Abrir perfil completo">'
            // Por qué entró esta fila. Sin esto, buscar un teléfono y ver un usuario que no
            // se parece en nada obliga a adivinar si matcheó por teléfono, por titular o si
            // es basura.
            + '<td>' + _motivoBadge(f.motivo) + '<b>' + escapeHtml(u) + '</b>'
              + (f.app_instalada ? ' <span title="App instalada">📱</span>' : '')
              + (estado && estado !== "VINCULADO" ? ' <span class="small" style="color:#f59e0b">' + escapeHtml(estado) + '</span>' : '')
            + '</td>'
            + '<td>' + (tel ? escapeHtml(tel) : '<span style="color:var(--muted)">—</span>') + '</td>'
            + '<td>' + (f.titular ? escapeHtml(String(f.titular)) : '<span style="color:var(--muted)">—</span>') + '</td>'
            + '<td class="small">' + escapeHtml(alta) + '</td>'
            + '<td onclick="event.stopPropagation()"><div class="crm-actions">'
              + (tel ? '<button class="mini-btn blue" title="Escribirle por WhatsApp" onclick="crmContactar(\'' + escapeHtml(uEsc) + '\')">💬</button>' : '')
              + '<button class="mini-btn green" title="Notificación al jugador" onclick="crmPushIndividual(\'' + escapeHtml(uEsc) + '\')">📲</button>'
              + '<button class="mini-btn yellow" title="Prevalidar: otra cuenta, bono cobrado o CBU repetido" onclick="crmPrevalidarRapido(\'' + escapeHtml(uEsc) + '\')">✅</button>'
              + '<button class="mini-btn gray" title="Perfil completo" onclick="abrirPerfilJugador(\'' + escapeHtml(uEsc) + '\')">🌳</button>'
            + '</div></td>'
            + '</tr>';
        }).join("")
      + '</tbody></table></div>'
      + pie;
    health?.record('RENDER','OK','IDENTIDAD_DOM_UPDATED');
    }catch(error){
      health?.record('RENDER','ERROR','IDENTIDAD_RENDER_FAILED');
      throw error;
    }
  };

  // ── Push, de a un jugador por vez ─────────────────────────────────────────
  // La "Campaña Push" (mandarle a un segmento entero de una) se sacó a propósito:
  // el segmento salía de buildCRM(), que devuelve [] si nadie cargó la lista, así que
  // el botón no podía decir a quién ni a cuántos les estaba mandando. Un disparo masivo
  // a ciegas no se le entrega a nadie. Queda el push por jugador, que sí sabe a quién va.
  async function pushEnviar(payload){
    try{
      const r=await fetch(window.PUSH_API_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json","x-push-secret":window.PUSH_SECRET},
        body:JSON.stringify(payload)
      });
      return await r.json();
    }catch(e){return{ok:false,error:e.message};}
  }

  window.crmPushIndividual=async function(usuario){
    const j=(window._crmJugadoresData||[]).find(x=>U(x.usuario)===U(usuario));
    const titulo=`BET300 · Hola ${usuario}`;
    const mensaje=promoTexto(j);
    const btn=document.getElementById("pushBtn_"+usuario);
    if(btn){btn.disabled=true;btn.textContent="Enviando...";}
    const res=await pushEnviar({usuario:S(usuario).trim().toLowerCase(),title:titulo,body:mensaje,url:"/",tag:"bet300-promo"});
    console.log("[push promo]",usuario,res);
    const okSent=res.sent>0;
    if(btn){
      btn.textContent=okSent?"✅ Enviado":"⚠ Error";
      setTimeout(()=>{btn.disabled=false;btn.textContent="📲 Push";},3000);
    }
    // Mensaje real: distingue error de auth/servidor vs. sin suscripción
    let msg;
    if(okSent)msg="Push enviado a "+usuario;
    else if(res.error)msg="Error: "+res.error;
    else if(res.reason==="sin_suscripciones")msg="Sin suscripción activa para "+usuario;
    else msg="No se envió ("+(res.failed||0)+" fallidos). Ver consola.";
    try{toast(msg,okSent?"green":"orange");}catch(_e){}
  };

  // Abrir el CRM ya NO dispara ninguna consulta: pinta la pantalla y listo.
  window.cargarJugadores=function(){ renderCRM(); };

  // La lista completa, sólo si la piden. Las 4 consultas van juntas y no en fila india
  // (en P4 eran 2,0 + 0,9 + 0,7 + 0,5 s esperando una a la otra).
  window.crmCargarLista=async function(){
    const box=document.getElementById("crmTabla");
    if(box) box.innerHTML='<div class="alert-box">Armando la lista de la oficina…</div>';
    try{
      if(typeof cargarOperacionesAgente==="function") await cargarOperacionesAgente();
      window._crmCargado=true;
    }catch(e){
      if(box) box.innerHTML='<div class="err-box">No se pudo cargar: '+escapeHtml(e.message||'')+'</div>';
      return;
    }
    renderCRM();
  };
  // ── Abrir el CRM no cuesta nada ───────────────────────────────────────────
  // Antes, entrar a Jugadores disparaba cargarOperacionesAgente(): CUATRO RPC en cadena
  // (agente_resumen → flags → vinculos → vinculos_count), una esperando a la otra. La
  // tercera baja los vínculos de la oficina entera: 64.121 filas en P6, 54.138 en P2.
  //
  // Y todo eso se tiraba: buildCRM() arranca con `if(!window._crmCargado) return []`, así
  // que la vista abre vacía y trabaja por búsqueda contra el servidor. Se pagaban segundos
  // de red y de parseo para descartar el resultado — y al terminar disparaba el renderCRM
  // tardío que le borraba el texto al operador.
  //
  // Ahora esas cuatro RPC corren SOLO si el operador pidió la lista completa (📥 Cargar
  // lista), que es el único caso en que buildCRM las mira.
  const oldMostrarVista=window.mostrarVista;
  if(typeof oldMostrarVista==="function"){
    window.mostrarVista=function(v){
      oldMostrarVista(v);
      if(v!=="jugadores") return;
      if(!window._crmCargado){
        // renderCRM ya dispara crmBuscarServidor(), que trae los primeros de la oficina.
        // Antes acá se pedía además el contador global de las siete oficinas juntas.
        setTimeout(renderCRM,80);
        return;
      }
      (typeof cargarOperacionesAgente==="function"?cargarOperacionesAgente():Promise.resolve())
        .finally(function(){ setTimeout(renderCRM,80); });
    };
  }
  setTimeout(()=>{const v=document.getElementById("viewJugadores");if(v&&!v.classList.contains("hidden"))renderCRM()},1000);
})();
