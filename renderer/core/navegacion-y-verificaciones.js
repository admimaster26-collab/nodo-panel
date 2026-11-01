function abrirMenuMobile(){const menu=document.getElementById("mobileMenu");menu.classList.add("open");menu.innerHTML="";const clone=document.getElementById("sidebar").cloneNode(true);clone.style.display="block";menu.appendChild(clone)}
function cerrarMenuMobile(e){if(!e||e.target.id==="mobileMenu"){const menu=document.getElementById("mobileMenu");menu.classList.remove("open");menu.innerHTML=""}}
function cerrarSesion(){
  detenerRealtime();
  localStorage.removeItem("nodo_operador_lite");
  localStorage.removeItem("nodo_pc_operativa_lite");
  // Cerrar también sesión de Chunior antes de recargar
  try {
    if(window.chunior) window.chunior.navigate(CHUNIOR_BASE + '/accounts/logout/');
  } catch(e){}
  setTimeout(function(){ location.reload(); }, 400);
}

// ── Panel de verificaciones ───────────────────────────────────────────────────
async function cargarVerificaciones(){
  window.NodoSalud?.begin('VALIDACION')?.record('DATA','OK','VERIFICACIONES_LOAD');
  const hoy = inicioDiaArgentina(); // medianoche AR, no del SO local
  const { data } = await supabaseClient
    .from("verificaciones")
    .select("*")
    .eq("pc_codigo", pcOperativa)
    .order("created_at", { ascending: false })
    .limit(60);

  if(!data){ setBox("tablaVerificaciones",'<div class="small" style="color:var(--muted);text-align:center;padding:20px">Error al cargar.</div>'); return; }

  const pendientes  = data.filter(v=>v.estado==="PENDIENTE");
  const okHoy       = data.filter(v=>v.estado==="VERIFICADO" && new Date(v.created_at)>=hoy);
  const failHoy     = data.filter(v=>v.estado==="NO_EXISTE"  && new Date(v.created_at)>=hoy);

  setBox("verifPendCount",  pendientes.length);
  setBox("verifOkCount",    okHoy.length);
  setBox("verifFailCount",  failHoy.length);
  setBox("verifProcStatus", _verifActivo ? '⚙️ Procesando...' : (window.ctrlElectron ? '✅ Activo' : '⚠️ Sin Electron'));

  const badge = document.getElementById("badgeVerif");
  if(pendientes.length){ badge.classList.remove("hidden"); badge.textContent=pendientes.length; }
  else badge.classList.add("hidden");

  if(!data.length){
    setBox("tablaVerificaciones",'<div class="small" style="color:var(--muted);text-align:center;padding:20px">Sin registros.</div>');
    return;
  }

  const colores = { PENDIENTE:'var(--yellow)', VERIFICADO:'var(--green)', NO_EXISTE:'var(--red)', ERROR:'#f97316' };
  const iconos  = { PENDIENTE:'⏳', VERIFICADO:'✅', NO_EXISTE:'❌', ERROR:'⚠️' };

  const rows = data.map(v=>{
    const c = colores[v.estado]||'var(--muted)';
    const i = iconos[v.estado]||'?';
    const hace = (() => {
      const s = Math.floor((Date.now()-new Date(v.created_at))/1000);
      if(s<60) return `${s}s`;
      if(s<3600) return `${Math.floor(s/60)}m`;
      return `${Math.floor(s/3600)}h`;
    })();
    return `<tr>
      <td style="font-weight:700">${escapeHtml(v.usuario)}</td>
      <td style="color:${c};font-weight:700">${i} ${v.estado}</td>
      <td style="color:var(--muted)">${v.nombre_casino||'—'}</td>
      <td style="color:var(--muted);font-size:12px">hace ${hace}</td>
      <td>
        ${v.estado==='PENDIENTE'?`<button class="mini-btn red" onclick="cancelarVerificacionPanel('${v.id}')">✕ Cancelar</button>`:''}
        ${v.estado==='NO_EXISTE'||v.estado==='ERROR'?`<button class="mini-btn blue" onclick="reintentarVerificacion('${v.id}','${escapeHtml(v.usuario)}')">↩ Reintentar</button>`:''}
      </td>
    </tr>`;
  }).join('');

  setBox("tablaVerificaciones",`
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:12px;color:var(--muted)">
        <th style="text-align:left;padding:6px 8px">Usuario</th>
        <th style="text-align:left;padding:6px 8px">Estado</th>
        <th style="text-align:left;padding:6px 8px">Casino alias</th>
        <th style="text-align:left;padding:6px 8px">Tiempo</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`);
}

async function cancelarVerificacionPanel(id){
  await supabaseClient.from("verificaciones").update({ estado:"ERROR", updated_at:new Date().toISOString() }).eq("id",id);
  await cargarVerificaciones();
}

async function reintentarVerificacion(id, usuario){
  await supabaseClient.from("verificaciones").update({ estado:"PENDIENTE", updated_at:new Date().toISOString() }).eq("id",id);
  toast(`Reenviado a cola: ${usuario}`, "blue");
  await cargarVerificaciones();
}

// JSON seguro para usar dentro de un atributo HTML (onclick="..."), reemplaza " por &quot;
function _jsonAttr(v){ return JSON.stringify(v).replace(/"/g, '&quot;'); }

// ── Chunior ───────────────────────────────────────────────────────────────────
// La autenticación ocurre en el login principal de NODO (validarLoginChunior).
// La sección Chunior es sólo un visor de la sesión ya iniciada.
