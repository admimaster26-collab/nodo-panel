let todosLosJugadores = [];

function getTurno(fechaISO){ return NodoDomain.formatos.getTurno(fechaISO); }

function calcularTurnos(usuarioNombre){
  const cargas = solicitudes.filter(s=>
    normalizar(s.USUARIO||s.USUARIO_JUGADOR||"")===normalizar(usuarioNombre) &&
    normalizar(s.TIPO_SOLICITUD||s.TIPO||"")==="CARGA" && esRealizada(s)
  );
  const cnt={TM:0,TT:0,TN:0};
  cargas.forEach(s=>cnt[getTurno(s.FECHA_CREACION||s.FECHA)]++);
  const total=cnt.TM+cnt.TT+cnt.TN;
  if(!total) return {TM:0,TT:0,TN:0,total:0,dominante:""};
  const pct={
    TM:Math.round(cnt.TM/total*100),
    TT:Math.round(cnt.TT/total*100),
    TN:Math.round(cnt.TN/total*100),
    total
  };
  pct.dominante=pct.TM>=pct.TT&&pct.TM>=pct.TN?"TM":pct.TT>=pct.TN?"TT":"TN";
  return pct;
}

function turnoBar(pct, turno, color){
  if(!pct.total) return `<span style="color:#667085">—</span>`;
  const v=pct[turno]||0;
  return `<div title="${turno}: ${v}%" style="display:flex;align-items:center;gap:4px;font-size:12px">
    <div style="width:48px;height:6px;background:#2a2f3b;border-radius:3px;overflow:hidden">
      <div style="width:${v}%;height:100%;background:${color};border-radius:3px"></div>
    </div>
    <span style="min-width:28px">${v}%</span>
  </div>`;
}

function toggleCrear(){
  const el=document.getElementById("formCrearUsuario");
  const btn=document.getElementById("btnToggleCrear");
  const oculto=el.classList.contains("hidden");
  el.classList.toggle("hidden",!oculto);
  btn.innerText=oculto?"Ocultar":"Mostrar";
}

async function crearUsuarioPanel(){
  const usuario_nuevo = document.getElementById("jugNuevoUsuario")?.value?.trim().toLowerCase().replace(/\s+/g,"");
  const nombre        = document.getElementById("jugNuevoNombre")?.value?.trim();
  const telefono      = document.getElementById("jugNuevoTelefono")?.value?.replace(/\D/g,"")||"";
  const pc            = document.getElementById("jugNuevoPc")?.value?.trim().toUpperCase()||pcOperativa;
  const clave         = document.getElementById("jugNuevoClave")?.value?.trim()||"12345a";

  if(!usuario_nuevo||!nombre||!telefono){setBox("jugCrearMsg",`<div class="err-box">Completá usuario, nombre y teléfono.</div>`);return}

  // 1. Crear en Supabase
  const {error}=await supabaseClient.from("usuarios").insert({usuario:usuario_nuevo,nombre,telefono,pc_codigo:pc,clave});
  if(error){
    setBox("jugCrearMsg",`<div class="err-box">${error.code==="23505"?"Ese usuario ya existe en el panel.":error.message}</div>`);
    return;
  }

  setBox("jugCrearMsg",`<div class="ok-box">✅ Usuario <b>${usuario_nuevo}</b> guardado. Clave: <b>${clave}</b><br><span class="small">Registrando en el casino...</span></div>`);

  // 2. Crear en el backoffice del casino (si estamos en Electron)
  if(enElectron){
    try{
      await window.ctrlElectron.openAgentWindow();
      const r = await callDrex("crearUsuario", usuario_nuevo, clave);
      if(r && r.ok){
        setBox("jugCrearMsg",`<div class="ok-box">✅ Usuario <b>${usuario_nuevo}</b> creado en el panel y en el casino.<br>Clave: <b>${clave}</b></div>`);
      } else if(r && r.error==="duplicado"){
        setBox("jugCrearMsg",`<div class="alert-box">⚠ Guardado en el panel, pero el alias <b>${usuario_nuevo}</b> ya existía en el casino (puede usarlo igual).<br>Clave: <b>${clave}</b></div>`);
      } else {
        setBox("jugCrearMsg",`<div class="alert-box">⚠ Guardado en el panel, pero no se pudo crear en el casino: ${r?.message||"error desconocido"}.<br>Clave: <b>${clave}</b></div>`);
      }
      await window.ctrlElectron.navigateAgent();
    }catch(e){
      setBox("jugCrearMsg",`<div class="alert-box">⚠ Guardado en el panel, pero falló la creación en el casino: ${e.message}.<br>Clave: <b>${clave}</b></div>`);
    }
  }

  ["jugNuevoUsuario","jugNuevoNombre","jugNuevoTelefono","jugNuevoClave"].forEach(id=>{const el=document.getElementById(id);if(el)el.value=""});
  toast("Usuario creado","green");
  await cargarJugadores();
}

function toggleImportar(){
  const el=document.getElementById("formImportarCSV");
  const btn=document.getElementById("btnToggleImportar");
  const oculto=el.classList.contains("hidden");
  el.classList.toggle("hidden",!oculto);
  btn.innerText=oculto?"Ocultar":"Mostrar";
}
function toggleOpsCsv(){
  const el=document.getElementById("formOpsCsv");
  const btn=document.getElementById("btnToggleOpsCsv");
  el.classList.toggle("hidden");
  btn.textContent=el.classList.contains("hidden")?"Mostrar":"Ocultar";
}

async function importarOperacionesCSV(){
  const fileInput = document.getElementById("opsCsvFile");
  const file = fileInput?.files?.[0];
  const pc = (document.getElementById("opsCsvPc")?.value||pcOperativa||"").trim().toUpperCase();

  if(!file){ setBox("opsCsvMsg",'<div class="err-box">Seleccioná un archivo CSV de operaciones.</div>'); return; }
  if(!pc){ setBox("opsCsvMsg",'<div class="err-box">Indicá la PC destino.</div>'); return; }

  setBox("opsCsvMsg",'<div class="alert-box">Leyendo archivo...</div>');
  document.getElementById("opsCsvProgreso").classList.add("hidden");

  let text;
  try { text = await file.text(); }
  catch(e){ setBox("opsCsvMsg",'<div class="err-box">Error leyendo el archivo.</div>'); return; }

  const preparados = NodoDomain.csv.prepararOperaciones(text);
  const allAliases = preparados.aliases;
  const totalRows = preparados.totalRows;
  retiros24hCSV = preparados.retiros;
  if(!allAliases.length){ setBox("opsCsvMsg",'<div class="err-box">No se encontraron aliases válidos.</div>'); return; }

  setBox("opsCsvMsg",'<div class="alert-box">Importando '+allAliases.length+' usuarios únicos...</div>');
  document.getElementById("opsCsvProgreso").classList.remove("hidden");

  const BATCH = 200;
  let ok=0, err=0;

  for(let i=0; i<allAliases.length; i+=BATCH){
    const batch = allAliases.slice(i,i+BATCH).map(function(a){
      return { usuario:a, nombre:a, verificado:true, pc_codigo:pc };
    });
    const { error } = await supabaseClient.from("usuarios")
      .upsert(batch, { onConflict:"usuario", ignoreDuplicates:false });
    if(error){ err+=batch.length; console.error("ops csv batch error:", error.message); }
    else ok+=batch.length;

    const pct = Math.round((i+batch.length)/allAliases.length*100);
    const bar = document.getElementById("opsCsvProgresoBar");
    const txt = document.getElementById("opsCsvProgresoTxt");
    if(bar) bar.style.width = pct+'%';
    if(txt) txt.textContent = pct+'% — '+ok+' importados';
  }

  // If any retiros in last 24h from the CSV, these users would already be caught
  // by verificarRetiro24h via la tabla. Antes de insertar, deduplicamos contra
  // retiros que YA están en historial_ops por otra vía (PANEL/AUTO/MANUAL/CHAT).
  let retiroMsg = '';
  if(retiros24hCSV.length){
    // Traer retiros recientes en NODO (cualquier origen excepto LANDING) para deduplicar
    const desde = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    let existentes = [];
    try {
      const { data: ex } = await supabaseClient
        .from('historial_ops')
        .select('usuario, monto, created_at')
        .eq('pc_codigo', pc)
        .eq('tipo', 'RETIRO')
        .neq('origen', 'LANDING')
        .gte('created_at', desde);
      existentes = ex || [];
    } catch(_){}
    // También deduplicar contra LANDING ya importados (para no duplicar entre imports sucesivos)
    let landingPrevios = [];
    try {
      const { data: lp } = await supabaseClient
        .from('historial_ops')
        .select('usuario, monto, created_at')
        .eq('pc_codigo', pc)
        .eq('tipo', 'RETIRO')
        .eq('origen', 'LANDING')
        .gte('created_at', desde);
      landingPrevios = lp || [];
    } catch(_){}
    // Set de keys: usuario|monto — sin fecha, porque las fuentes pueden
    // tener el mismo retiro con distinto created_at (Chunior vs CSV).
    // La política es: 1 retiro por usuario en 24hs, así que cualquier combinación
    // usuario+monto en la ventana de tiempo ya es suficiente para deduplicar.
    const keyDe = function(usr, mt){
      return String(usr).toLowerCase()+'|'+Math.round(Number(mt));
    };
    const yaExisten = new Set();
    existentes.concat(landingPrevios).forEach(function(e){
      if(e.usuario && e.monto != null) yaExisten.add(keyDe(e.usuario, e.monto));
    });

    let insertados = 0, duplicados = 0;
    for(const r of retiros24hCSV){
      const key = keyDe(r.alias, r.monto);
      if(yaExisten.has(key)){
        duplicados++;
        continue;
      }
      // Usar la fecha ORIGINAL del CSV como created_at (no la fecha de importación)
      await registrarEnHistorial({usuario:r.alias, tipo:'RETIRO', monto:r.monto, origen:'LANDING', estado:'OK', notas:'Importado de CSV · '+r.fecha, pc_codigo:pc, created_at:r.fecha});
      yaExisten.add(key);
      insertados++;
    }
    retiroMsg = '<br>⚠️ <b>'+insertados+'</b> retiro/s en las últimas 24hs importados al historial (blacklist activa)' +
                (duplicados > 0 ? ' · <b>'+duplicados+'</b> ya existían y se saltearon' : '') + '.';
  }

  setBox("opsCsvMsg",'<div class="ok-box">✅ Importación completada: <b>'+ok+' usuarios</b> marcados como verificados'+(err?(' | <b>'+err+' errores</b>'):'')+'.<br>Total operaciones procesadas: '+totalRows+'.'+retiroMsg+'</div>');
  document.getElementById("opsCsvProgreso").classList.add("hidden");
}

// ── Parser CSV ────────────────────────────────────────────────────────────────
// Compatibilidad de nombres para extensiones y handlers del panel.
function parseCSV(text){ return NodoDomain.csv.parseCSV(text); }
function cleanPhone(v){ return NodoDomain.csv.cleanPhone(v); }
function parseNumCsv(v){ return NodoDomain.csv.parseNumCsv(v); }
function parseIntCsv(v){ return NodoDomain.csv.parseIntCsv(v); }

async function importarCSV(){
  const fileInput=document.getElementById("csvFile");
  const file=fileInput?.files?.[0];
  const pc=(document.getElementById("csvPc")?.value||"SANCHEZ").trim().toUpperCase();

  if(!file){setBox("csvMsg",`<div class="err-box">Seleccioná un archivo CSV.</div>`);return}
  if(!pc){setBox("csvMsg",`<div class="err-box">Indicá la PC destino.</div>`);return}

  setBox("csvMsg",`<div class="alert-box">Leyendo archivo...</div>`);
  document.getElementById("csvProgreso").classList.add("hidden");

  let text;
  try { text = await file.text(); }
  catch(e){ setBox("csvMsg",`<div class="err-box">Error leyendo el archivo.</div>`); return; }

  const rows=parseCSV(text);
  if(rows.length<2){setBox("csvMsg",`<div class="err-box">El CSV está vacío.</div>`);return}

  const registros=NodoDomain.csv.prepararJugadores(rows, pc);

  if(!registros.length){setBox("csvMsg",`<div class="err-box">No se encontraron filas válidas.</div>`);return}

  setBox("csvMsg",`<div class="alert-box">Importando ${registros.length} usuarios para PC <b>${pc}</b>...</div>`);
  document.getElementById("csvProgreso").classList.remove("hidden");

  const BATCH=500;
  let ok=0, err=0;

  for(let i=0;i<registros.length;i+=BATCH){
    const batch=registros.slice(i,i+BATCH);
    const {error}=await supabaseClient.from("usuarios").upsert(batch,{onConflict:"usuario"});
    if(error){
      console.error("Batch error:", error.message || error.details || JSON.stringify(error));
      err+=batch.length;
      if(i===0) setBox("csvMsg",`<div class="err-box">Error: ${error.message||error.details||JSON.stringify(error)}</div>`);
    } else {
      ok+=batch.length;
    }
    const pct=Math.round((i+batch.length)/registros.length*100);
    const bar=document.getElementById("csvProgresoBar");
    const txt=document.getElementById("csvProgresoTxt");
    if(bar) bar.style.width=pct+"%";
    if(txt) txt.textContent=`${i+batch.length} / ${registros.length} (${pct}%)`;
  }

  setBox("csvMsg",`<div class="ok-box">Importación finalizada: <b>${ok}</b> registros procesados${err?`, <b>${err}</b> con error`:""}.</div>`);
  fileInput.value="";
  await cargarJugadores();
}

function abrirEditarUsuario(u){
  abrirModal(`✏ Editar — ${u.usuario}`,`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
      <div><label class="small">Nombre</label><input id="eU_nombre" value="${escapeHtml(u.nombre)}" style="margin-top:4px"></div>
      <div><label class="small">Teléfono</label><input id="eU_telefono" value="${escapeHtml(u.telefono)}" style="margin-top:4px"></div>
      <div><label class="small">DNI</label><input id="eU_dni" value="${escapeHtml(u.dni)}" style="margin-top:4px"></div>
      <div><label class="small">Nombre en transferencia</label><input id="eU_nombre_transf" value="${escapeHtml(u.nombre_transferencia)}" style="margin-top:4px"></div>
      <div><label class="small">CBU / CVU / Alias</label><input id="eU_cbu_alias" value="${escapeHtml(u.cbu_alias)}" autocapitalize="none" style="margin-top:4px"></div>
      <div><label class="small">PC</label><input id="eU_pc" value="${escapeHtml(u.pc_codigo)}" style="margin-top:4px"></div>
      <div><label class="small">Clave</label><input id="eU_clave" value="${escapeHtml(u.clave)}" style="margin-top:4px"></div>
    </div>
  `, async()=>{
    const cambios = {
      nombre:               val("eU_nombre")||null,
      telefono:             val("eU_telefono")||null,
      dni:                  val("eU_dni")||null,
      nombre_transferencia: val("eU_nombre_transf")||null,
      cbu_alias:            val("eU_cbu_alias")||null,
      pc_codigo:            val("eU_pc")||u.pc_codigo,
      clave:                val("eU_clave")||null,
      updated_at:           new Date().toISOString()
    };
    const _idHealth = window.NodoSalud?.begin('IDENTIDAD');
    const {error} = await supabaseClient.from("usuarios").update(cambios).eq("id", u.id);
    _idHealth?.reply(error);
    if(error){ alert(error.message||"Error"); return; }
    cerrarModal();
    toast("Usuario actualizado","green");
    await cargarJugadores();
  },"Guardar cambios");
}

function copiarDatosUsuario(u){
  const txt=`Usuario: ${u.usuario}\nNombre: ${u.nombre}\nTeléfono: ${u.telefono||""}\nPC: ${u.pc_codigo||""}\nClave: ${u.clave||"12345a"}`;
  // Antes: .catch(()=>{}) — si fallaba, el operador no se enteraba de nada.
  window.nodoCopiar(txt, { etiqueta: "Datos copiados" });
}

async function resetearClaveUsuario(id, nombreUsuario){
  if(!confirm(`¿Resetear clave de "${nombreUsuario}" a 12345a?`)) return;
  const {error}=await supabaseClient.from("usuarios").update({clave:"12345a"}).eq("id",id);
  if(!error) toast(`Clave de ${nombreUsuario} reseteada a 12345a`,"green");
}

async function cargarJugadores(){
  setBox("tablaJugadores",`<div class="alert-box">Cargando jugadores de ${escapeHtml(pcOperativa||'?')}...</div>`);

  // Filtramos por la oficina actual (pc_codigo) para que cada operador vea SOLO los suyos.
  // La landing del jugador sigue verificando contra TODAS las oficinas (queda separado).
  const PAGE = 1000;
  let from = 0;
  let dataAll = [];
  while(true){
    const {data, error} = await supabaseClient
      .from("usuarios")
      .select("*")
      .eq("pc_codigo", pcOperativa)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if(error){
      setBox("tablaJugadores",`<div class="err-box">Error cargando jugadores.</div>`);
      return;
    }
    if(!data || !data.length) break;
    dataAll = dataAll.concat(data);
    setBox("tablaJugadores",`<div class="alert-box">Cargando jugadores de ${escapeHtml(pcOperativa)}... (${dataAll.length})</div>`);
    if(data.length < PAGE) break;
    from += PAGE;
  }
  const data = dataAll;

  const lista=(data||[]).map(u=>({
    ...u,
    lealtad_csv: u.lealtad||0,                  // CSV: 0–4 (renombrado para no chocar)
    lealtad:     calcularLealtad(u.usuario),    // calculado en base a solicitudes
    turnos:      calcularTurnos(u.usuario)
  }));
  lista.sort((a,b)=>b.lealtad.score-a.lealtad.score);
  todosLosJugadores=lista;

  // Pobla filtro de PCs
  const pcs=[...new Set(lista.map(u=>u.pc_codigo).filter(Boolean))].sort();
  const sel=document.getElementById("jugFiltroPc");
  if(sel){
    sel.innerHTML=`<option value="">Todas las PCs</option>`+pcs.map(p=>`<option value="${p}">${p}</option>`).join("");
  }

  // Stats
  setBox("jugTotalCount",lista.length);
  // Los contadores por nivel (VIP / Confiable / Nuevo) se fueron: eran etiquetas de marketing y
  // encima sus cajas no existen en la pantalla desde hace rato, así que no contaban para nadie.

  renderTablaJugadores(lista);
}

function filtrarJugadores(){
  const texto      =(document.getElementById("jugFiltroTexto")?.value||"").trim().toLowerCase();
  const nivel      = document.getElementById("jugFiltroNivel")?.value||"";
  const pc         = document.getElementById("jugFiltroPc")?.value||"";
  const turno      = document.getElementById("jugFiltroTurno")?.value||"";
  const estado     = document.getElementById("jugFiltroEstado")?.value||"";
  const lealtadCsv = document.getElementById("jugFiltroLealtadCsv")?.value||"";
  let lista=todosLosJugadores;
  if(texto)      lista=lista.filter(u=>`${u.usuario} ${u.alias||""} ${u.nombre||""} ${u.telefono||""}`.toLowerCase().includes(texto));
  // El filtro por nivel se fue con los niveles.
  if(pc)         lista=lista.filter(u=>u.pc_codigo===pc);
  if(turno)      lista=lista.filter(u=>u.turnos.dominante===turno);
  if(estado)     lista=lista.filter(u=>(u.estado_actual||"").toUpperCase()===estado.toUpperCase());
  if(lealtadCsv!=="")lista=lista.filter(u=>Number(u.lealtad_csv||0)===Number(lealtadCsv));
  renderTablaJugadores(lista);
}

function estadoColor(estado){
  const e=(estado||"").toUpperCase();
  if(e.includes("CONTACTAR"))      return {bg:"#3d2d00",fg:"#d29922"};
  if(e.includes("EN CONTACTO"))    return {bg:"#16235f",fg:"#79b8ff"};
  if(e.includes("REVISADO"))       return {bg:"#11371f",fg:"#3fb950"};
  if(e.includes("NO ESTA"))        return {bg:"#3a1515",fg:"#f85149"};
  if(e.includes("PROMO"))          return {bg:"#2e1a5e",fg:"#bf91ff"};
  return {bg:"#2a2f3b",fg:"#98a2b3"};
}

function lealtadCsvBadge(n){
  const v=Number(n||0);
  const palette=[
    {bg:"#2a2f3b",fg:"#667085"},   // 0
    {bg:"#16235f",fg:"#79b8ff"},   // 1
    {bg:"#11371f",fg:"#3fb950"},   // 2
    {bg:"#2e1a5e",fg:"#bf91ff"},   // 3
    {bg:"#3d2d00",fg:"#fdb022"},   // 4 - max
  ];
  const c=palette[Math.max(0,Math.min(4,v))];
  return `<span title="Lealtad CSV ${v}/4" style="padding:1px 7px;border-radius:999px;font-size:10px;font-weight:800;background:${c.bg};color:${c.fg}">L${v}</span>`;
}

function renderTablaJugadores(lista){
  if(!lista.length){setBox("tablaJugadores",`<div class="alert-box">Sin jugadores para mostrar.</div>`);return}

  const colores={muted:"#667085",blue:"#3d5afe",green:"#12b76a",purple:"#7c3aed",yellow:"#fdb022"};
  const bg={muted:"#2a2f3b",blue:"#16235f",green:"#11371f",purple:"#2e1a5e",yellow:"#3d2d00"};

  let html=`<div class="table-wrap"><table><thead><tr>
    <th>Usuario</th><th>Contacto</th><th>PC</th>
    <th>Estado</th>
    <th>Score / Lealtad</th>
    <th title="Cargas históricas (CSV) + operaciones aprobadas">Cargas</th>
    <th>Neto</th>
    <th title="Última actividad registrada">Última act.</th>
    <th title="TM ☀ / TT 🌆 / TN 🌙">Turnos</th>
    <th>Acciones</th>
  </tr></thead><tbody>`;

  lista.forEach(u=>{
    const l=u.lealtad, t=u.turnos;
    const c=colores[l.color]||colores.muted;
    const bgc=bg[l.color]||bg.muted;
    const id=u.id;
    const ec=estadoColor(u.estado_actual);
    const netoColor = (Number(u.neto)||0) >= 0 ? "var(--green)" : "var(--red)";
    const cargasHist = Number(u.cargas_hist)||0;
    const recup = u.recuperado_por ? `<br><span class="small" title="Recuperado por">↪ ${u.recuperado_por}</span>` : "";

    html+=`<tr>
      <td>
        <b>${u.usuario}</b>${u.alias && u.alias!==u.usuario?`<br><span class="small">alias: ${u.alias}</span>`:""}
        <br><span class="small">${u.clave?"🔑":"🔓"} ${u.clave||"sin clave"}</span>
      </td>
      <td>
        ${u.nombre?`<b>${u.nombre}</b><br>`:""}
        <span class="small">${u.telefono||"sin teléfono"}</span>
        ${u.dni?`<br><span class="small">DNI: ${u.dni}</span>`:""}
        ${recup}
      </td>
      <td><span class="badge badge-muted">${u.pc_codigo||"-"}</span></td>
      <td>${u.estado_actual?`<span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${ec.bg};color:${ec.fg}">${u.estado_actual}</span>`:"-"}</td>
      <td>
        <b style="color:${c}">${l.score}</b> ${lealtadCsvBadge(u.lealtad_csv)}<br>
        <span class="small" style="color:${l.tasa>=80?"var(--green)":l.tasa>=50?"var(--yellow)":"var(--red)"}">${l.tasa}% éxito · ${l.aprobadas}✓${l.rechazadas?` ${l.rechazadas}✗`:""}</span>
      </td>
      <td>
        ${cargasHist?`<b>${cargasHist}</b><span class="small"> hist.</span>`:`<span class="small">-</span>`}
        ${l.aprobadas?`<br><span class="small">${l.aprobadas} ops</span>`:""}
      </td>
      <td><span style="color:${netoColor};font-weight:700">${money(u.neto||0)}</span></td>
      <td><span class="small">${u.ultima_actividad||"-"}</span></td>
      <td style="min-width:160px">
        ${turnoBar(t,"TM","#f6c90e")}
        ${turnoBar(t,"TT","#3d5afe")}
        ${turnoBar(t,"TN","#7c3aed")}
      </td>
      <td>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="mini-btn blue" onclick='copiarDatosUsuario(${JSON.stringify({usuario:u.usuario,nombre:u.nombre,telefono:u.telefono,pc_codigo:u.pc_codigo,clave:u.clave||"12345a"})})'>📋 Copiar</button>
          <button class="mini-btn green" onclick='abrirEditarUsuario(${JSON.stringify({id:u.id,usuario:u.usuario,nombre:u.nombre||"",telefono:u.telefono||"",dni:u.dni||"",nombre_transferencia:u.nombre_transferencia||"",cbu_alias:u.cbu_alias||"",pc_codigo:u.pc_codigo||"",clave:u.clave||""})})'>✏ Editar</button>
          <button class="mini-btn yellow" onclick="resetearClaveUsuario('${id}','${u.usuario}')">🔑 Reset</button>
        </div>
      </td>
    </tr>`;
  });

  html+=`</tbody></table></div>`;
  setBox("tablaJugadores",html);
}

// ── Control de retiros: 1 cada 24hs por usuario ──────────────────────────────
// Helpers de la blacklist de retiros dobles (portados de NexoBetaChan).
// _blEsParcial: un retiro PARCIAL (tramo de un retiro grande) NO cuenta como un retiro separado
// → sin esto, los parciales inflaban el chequeo 24h y la blacklist (falsos dobles).
