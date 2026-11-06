
/* ============================================================
   NODO · VALIDACION USUARIOS SOFT QUEUE SAFE
   Prioridad: public.validaciones_usuario
   Fallback: public.verificaciones
   No bloquea portal ni motor operativo.
   ============================================================ */
(function(){
  const VALIDACION_SOFT_VERSION="VALIDACION_SOFT_QUEUE_2026_06";

  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}
  function E(v){
    try{return escapeHtml(S(v))}catch(_e){
      return S(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  }
  function nowIso(){return new Date().toISOString()}
  function estadoNorm(e){
    e=U(e);
    if(["VALIDADO","VERIFICADO","EXISTE","OK"].includes(e))return "EXISTE";
    if(["NO_EXISTE","NO EXISTE","RECHAZADO","RECHAZADA"].includes(e))return "NO_EXISTE";
    if(["PROCESANDO","EN_PROCESO"].includes(e))return "PROCESANDO";
    if(["ERROR","FALLA"].includes(e))return "ERROR";
    return "PENDIENTE";
  }
  function estadoHtml(e){
    const st=estadoNorm(e);
    const map={
      PENDIENTE:['⏳','Pendiente','val-pend'],
      PROCESANDO:['⚙️','Procesando','val-proc'],
      EXISTE:['✅','Existe','val-ok'],
      NO_EXISTE:['❌','No existe','val-no'],
      ERROR:['⚠️','Error','val-err']
    };
    const m=map[st]||map.PENDIENTE;
    return `<span class="val-pill ${m[2]}">${m[0]} ${m[1]}</span>`;
  }
  function hace(fecha){
    const d=new Date(fecha||0);
    if(isNaN(d.getTime()))return "—";
    const s=Math.floor((Date.now()-d.getTime())/1000);
    if(s<60)return s+"s";
    if(s<3600)return Math.floor(s/60)+"m";
    if(s<86400)return Math.floor(s/3600)+"h";
    return Math.floor(s/86400)+"d";
  }

  async function tablaDisponible(nombre){
    try{
      const r=await supabaseClient.from(nombre).select("*").limit(1);
      return !r.error;
    }catch(_e){return false}
  }

  async function leerValidaciones(){
    const health = window.NodoSalud?.begin('VALIDACION');
    let source="validaciones_usuario";
    let data=null, error=null;

    const q1=await supabaseClient
      .from("validaciones_usuario")
      .select("*")
      .order("created_at",{ascending:false})
      .limit(120);

    if(!q1.error){
      data=q1.data||[];
      source="validaciones_usuario";
    }else{
      error=q1.error;
      const q2=await supabaseClient
        .from("verificaciones")
        .select("*")
        .order("created_at",{ascending:false})
        .limit(120);
      if(!q2.error){
        data=q2.data||[];
        source="verificaciones";
        error=null;
      }else{
        error=q2.error;
      }
    }

    health?.reply(error);
    if(error){ health?.record('DATA','ERROR','VALIDACION_READ_FAILED'); throw error; }
    // Sin sesión iniciada no hay oficina: leer no prueba nada de la oficina (6/11, PCs en pc_codigo=null).
    let _valOficina="";try{_valOficina=(typeof pcOperativa!=="undefined"&&pcOperativa)||"";}catch(_e){}
    health?.record('DATA',_valOficina?'OK':'UNKNOWN',_valOficina?'VALIDACION_READ_OK':'VALIDACION_SIN_OFICINA');
    return {source,data:data||[]};
  }

  function mapRow(row,source){
    if(source==="validaciones_usuario"){
      const resultado = row.resultado && typeof row.resultado==="object" ? row.resultado : {};
      const estado = estadoNorm(row.estado || resultado.estado || resultado.status);
      return {
        source,
        id: row.id,
        usuario: row.usuario || "",
        telefono: row.telefono || "",
        dni: row.dni_normalizado || row.dni || "",
        pc_codigo: row.pc_codigo || "",
        estado,
        nombre_casino: row.nombre_completo || resultado.nombre || resultado.nombre_casino || "",
        worker_job_id: row.worker_job_id || "",
        worker_id: row.worker_id || "",
        error: row.worker_error || resultado.error || "",
        intentos: row.intentos || 0,
        created_at: row.created_at,
        updated_at: row.updated_at || row.validated_at || row.created_at,
        raw: row
      };
    }
    return {
      source,
      id: row.id,
      usuario: row.usuario || "",
      telefono: row.telefono || "",
      dni: row.dni || "",
      pc_codigo: row.pc_codigo || "",
      estado: estadoNorm(row.estado),
      nombre_casino: row.nombre_casino || "",
      worker_job_id: row.worker_job_id || "",
      worker_id: row.worker_id || "",
      error: row.error || "",
      intentos: row.intentos || 0,
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at,
      raw: row
    };
  }

  async function actualizarVal(row, patch){
    if(row.source==="validaciones_usuario"){
      const p=Object.assign({},patch,{updated_at:nowIso()});
      const r=await supabaseClient.from("validaciones_usuario").update(p).eq("id",row.id);
      if(r.error)throw r.error;
      return;
    }
    const legacyPatch={updated_at:nowIso()};
    if(patch.estado){
      legacyPatch.estado = patch.estado==="EXISTE" ? "VERIFICADO" : patch.estado;
    }
    if(patch.nombre_completo)legacyPatch.nombre_casino=patch.nombre_completo;
    if(patch.worker_error)legacyPatch.error=patch.worker_error;
    const r=await supabaseClient.from("verificaciones").update(legacyPatch).eq("id",row.id);
    if(r.error)throw r.error;
  }

  async function insertarValidacionManual(usuario,pc){
    usuario=S(usuario).trim();
    if(!usuario)throw new Error("Usuario requerido");
    pc=S(pc||window.pcOperativa||"P1").trim().toUpperCase()||"P1";

    const row={
      usuario,
      pc_codigo:pc,
      estado:"PENDIENTE",
      resultado:{origen:"PANEL_MANUAL",created_by:"nodo_verificaciones"},
      intentos:0,
      created_at:nowIso(),
      updated_at:nowIso()
    };

    const r=await supabaseClient.from("validaciones_usuario").insert(row).select("*").single();
    if(r.error)throw r.error;
    return r.data;
  }

  async function verificarUsuarioAhora(row){
    const usuario=S(row.usuario).trim();
    if(!usuario)throw new Error("Usuario vacío");

    await actualizarVal(row,{
      estado:"PROCESANDO",
      worker_error:null,
      resultado:Object.assign({},row.raw?.resultado||{},{
        origen:"PANEL_VERIFICAR_AHORA",
        started_at:nowIso()
      })
    });

    try{
      if(typeof callDrex!=="function")throw new Error("callDrex no disponible");
      const res=await callDrex("buscarUsuario",usuario,{skipBalance:true});
      if(res && (res.needsLogin || res.pageError)) throw new Error(res.needsLogin ? "Sesión de Agentes caída — reintentá" : "Página de error de Agentes — reintentá");
      // "ok" es true también cuando la búsqueda dice "sin resultados": lo que importa es exists.
      const ok=!!(res && res.exists);
      const nombre = res?.nombre || res?.nombre_casino || res?.usuario || usuario;
      const saldo = res?.saldo ?? res?.balance ?? null;

      if(ok){
        await actualizarVal(row,{
          estado:"EXISTE",
          nombre_completo:nombre,
          validated_at:nowIso(),
          worker_error:null,
          resultado:{
            estado:"EXISTE",
            nombre,
            saldo,
            verificado_por:"PANEL",
            pc_codigo:row.pc_codigo || window.pcOperativa || "",
            at:nowIso()
          }
        });
        try{toast("Usuario verificado: "+usuario,"green")}catch(_e){}
      }else{
        await actualizarVal(row,{
          estado:"NO_EXISTE",
          validated_at:nowIso(),
          worker_error:res?.message || "Usuario no encontrado",
          resultado:{
            estado:"NO_EXISTE",
            mensaje:res?.message || "Usuario no encontrado",
            verificado_por:"PANEL",
            at:nowIso()
          }
        });
        try{toast("Usuario no encontrado: "+usuario,"red")}catch(_e){}
      }
    }catch(e){
      await actualizarVal(row,{
        estado:"ERROR",
        worker_error:e.message || String(e),
        resultado:{
          estado:"ERROR",
          mensaje:e.message || String(e),
          verificado_por:"PANEL",
          at:nowIso()
        }
      });
      throw e;
    }
  }

  function filtrarRows(rows){
    const q=S(document.getElementById("valBuscar")?.value||"").toLowerCase().trim();
    const estado=U(document.getElementById("valEstado")?.value||"");
    const pc=U(document.getElementById("valPc")?.value||"");

    return rows.filter(r=>{
      if(estado && r.estado!==estado)return false;
      if(pc && U(r.pc_codigo)!==pc)return false;
      if(q){
        const blob=[r.usuario,r.telefono,r.dni,r.pc_codigo,r.estado,r.nombre_casino,r.error,r.worker_job_id].join(" ").toLowerCase();
        if(!blob.includes(q))return false;
      }
      return true;
    });
  }

  function renderVerificaciones(rows,source){
    const pendientes=rows.filter(r=>r.estado==="PENDIENTE");
    const proc=rows.filter(r=>r.estado==="PROCESANDO");
    const ok=rows.filter(r=>r.estado==="EXISTE");
    const no=rows.filter(r=>r.estado==="NO_EXISTE");
    const err=rows.filter(r=>r.estado==="ERROR");

    setBox("verifPendCount",pendientes.length + proc.length);
    setBox("verifOkCount",ok.length);
    setBox("verifFailCount",no.length);
    setBox("verifProcStatus", window.ctrlElectron ? "✅ Activo · soft queue" : "⚠️ Sin Electron");

    const badge=document.getElementById("badgeVerif");
    const totalPend=pendientes.length+proc.length;
    if(badge){
      if(totalPend){badge.classList.remove("hidden");badge.textContent=String(totalPend)}
      else badge.classList.add("hidden");
    }

    const filtered=filtrarRows(rows);

    const resumen=`<div class="val-card-grid">
      <div class="val-card"><div class="k">Fuente</div><div class="v" style="font-size:17px">${E(source)}</div></div>
      <div class="val-card"><div class="k">Pendientes</div><div class="v" style="color:#fde68a">${pendientes.length}</div></div>
      <div class="val-card"><div class="k">Procesando</div><div class="v" style="color:#bfdbfe">${proc.length}</div></div>
      <div class="val-card"><div class="k">Existe</div><div class="v" style="color:#bbf7d0">${ok.length}</div></div>
      <div class="val-card"><div class="k">No existe</div><div class="v" style="color:#fecaca">${no.length}</div></div>
      <div class="val-card"><div class="k">Error</div><div class="v" style="color:#fed7aa">${err.length}</div></div>
    </div>`;

    const toolbar=`<div class="val-toolbar">
      <input id="valBuscar" placeholder="Buscar usuario, teléfono, DNI..." oninput="cargarVerificaciones()">
      <select id="valEstado" onchange="cargarVerificaciones()">
        <option value="">Todos los estados</option>
        <option value="PENDIENTE">Pendiente</option>
        <option value="PROCESANDO">Procesando</option>
        <option value="EXISTE">Existe</option>
        <option value="NO_EXISTE">No existe</option>
        <option value="ERROR">Error</option>
      </select>
      <select id="valPc" onchange="cargarVerificaciones()">
        <option value="">Todas las PCs</option>
        <option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4">P4</option><option value="P5">P5</option>
        <option value="PC1">PC1</option><option value="PC2">PC2</option><option value="PC3">PC3</option><option value="PC4">PC4</option><option value="PC5">PC5</option>
      </select>
      <button class="mini-btn blue" onclick="crearValidacionManual()">+ Validar usuario</button>
    </div>`;

    const note=`<div class="val-mini-note">
      <b>Modo soft:</b> esta cola ayuda al operador, pero no bloquea cargas/retiros. 
      Si un usuario aparece como <b>NO EXISTE</b> o <b>ERROR</b>, revisalo antes de aprobar una carga portal.
    </div>`;

    if(!filtered.length){
      setBox("tablaVerificaciones",resumen+toolbar+note+'<div class="small" style="color:var(--muted);text-align:center;padding:24px">Sin registros para esos filtros.</div>');
      return;
    }

    const rowsHtml=filtered.map(r=>{
      const warn=(r.estado==="PENDIENTE"||r.estado==="NO_EXISTE"||r.estado==="ERROR")?"val-row-warn":"";
      return `<tr class="${warn}">
        <td><b>${E(r.usuario)}</b><div class="small">${E(r.telefono||"")} ${r.dni?("· DNI "+E(r.dni)):""}</div></td>
        <td>${estadoHtml(r.estado)}</td>
        <td>${E(r.pc_codigo||"—")}</td>
        <td>${E(r.nombre_casino||"—")}<div class="small">${r.worker_job_id?("Job "+E(r.worker_job_id)):""} ${r.worker_id?("· "+E(r.worker_id)):""}</div></td>
        <td><span class="small">${E(hace(r.created_at))}</span><div class="small">${E(r.updated_at?new Date(r.updated_at).toLocaleString("es-AR"):"")}</div></td>
        <td><div class="small" style="max-width:220px;color:#fca5a5">${E(r.error||"")}</div></td>
        <td><div class="val-actions">
          <button class="mini-btn blue" onclick="verificarUsuarioPanelAhora('${E(r.source)}','${E(r.id)}')">🔍 Verificar ahora</button>
          <button class="mini-btn gray" onclick="marcarValidacionExiste('${E(r.source)}','${E(r.id)}')">✓ Marcar existe</button>
          <button class="mini-btn gray" onclick="reintentarVerificacionSoft('${E(r.source)}','${E(r.id)}')">↻ Reintentar</button>
        </div></td>
      </tr>`;
    }).join("");

    setBox("tablaVerificaciones",resumen+toolbar+note+`
      <div style="overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:14px;margin-top:12px">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="font-size:12px;color:var(--muted);background:#1b2434">
            <th style="text-align:left;padding:8px">Usuario</th>
            <th style="text-align:left;padding:8px">Estado</th>
            <th style="text-align:left;padding:8px">PC</th>
            <th style="text-align:left;padding:8px">Resultado</th>
            <th style="text-align:left;padding:8px">Tiempo</th>
            <th style="text-align:left;padding:8px">Error</th>
            <th style="text-align:left;padding:8px">Acciones</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`);
  }

  let _valCache=[];

  window.cargarVerificaciones=async function(){
    try{
      const {source,data}=await leerValidaciones();
      _valCache=data.map(r=>mapRow(r,source));
      renderVerificaciones(_valCache,source);
    }catch(e){
      console.warn("cargarVerificaciones soft",e);
      setBox("tablaVerificaciones",'<div class="error-box">No pude cargar la cola de validaciones: '+E(e.message||e)+'</div>');
      setBox("verifProcStatus","⚠️ Error");
    }
  };

  function findRow(source,id){
    return (_valCache||[]).find(r=>r.source===source && String(r.id)===String(id));
  }

  window.verificarUsuarioPanelAhora=async function(source,id){
    const row=findRow(source,id);
    if(!row){alert("No encontré la validación. Actualizá.");return}
    try{
      await verificarUsuarioAhora(row);
    }catch(e){
      alert("No se pudo verificar ahora: "+(e.message||e));
    }
    await cargarVerificaciones();
  };

  window.marcarValidacionExiste=async function(source,id){
    const row=findRow(source,id);
    if(!row){alert("No encontré la validación. Actualizá.");return}
    if(!confirm("¿Marcar "+row.usuario+" como EXISTE manualmente?"))return;
    await actualizarVal(row,{
      estado:"EXISTE",
      nombre_completo:row.usuario,
      validated_at:nowIso(),
      worker_error:null,
      resultado:{estado:"EXISTE",manual:true,operador:(window.operador?.usuario||window.operador?.nombre||"panel"),at:nowIso()}
    });
    await cargarVerificaciones();
  };

  window.reintentarVerificacionSoft=async function(source,id){
    const row=findRow(source,id);
    if(!row){alert("No encontré la validación. Actualizá.");return}
    await actualizarVal(row,{
      estado:"PENDIENTE",
      worker_error:null,
      resultado:Object.assign({},row.raw?.resultado||{},{estado:"PENDIENTE",retry_at:nowIso()})
    });
    try{toast("Reenviado a cola: "+row.usuario,"blue")}catch(_e){}
    await cargarVerificaciones();
  };

  window.crearValidacionManual=async function(){
    const usuario=prompt("Usuario a validar:");
    if(!usuario)return;
    const pc=prompt("PC / oficina:",window.pcOperativa||"P1") || (window.pcOperativa||"P1");
    try{
      await insertarValidacionManual(usuario,pc);
      try{toast("Validación creada: "+usuario,"green")}catch(_e){}
      await cargarVerificaciones();
    }catch(e){
      alert("No pude crear la validación: "+(e.message||e));
    }
  };

  // Alias legacy para que botones viejos no rompan.
  window.cancelarVerificacionPanel=async function(id){
    const row=(_valCache||[]).find(r=>String(r.id)===String(id));
    if(!row){await cargarVerificaciones();return}
    await actualizarVal(row,{estado:"ERROR",worker_error:"Cancelada desde panel",resultado:{estado:"ERROR",cancelada:true,at:nowIso()}});
    await cargarVerificaciones();
  };

  window.reintentarVerificacion=async function(id,usuario){
    const row=(_valCache||[]).find(r=>String(r.id)===String(id));
    if(row)return window.reintentarVerificacionSoft(row.source,row.id);
    try{
      await insertarValidacionManual(usuario||"",window.pcOperativa||"P1");
      await cargarVerificaciones();
    }catch(e){alert("Error: "+(e.message||e))}
  };

  // Actualización liviana de badge cada tanto si la vista no está abierta.
  setInterval(async function(){
    try{
      // Espera su paso del arranque por etapas: sin oficina leía desde la pantalla de login.
      if(window.nodoArranqueHabilitado && !window.nodoArranqueHabilitado('verificaciones')) return;
      // El apartado de Verificaciones fue ELIMINADO: sin el elemento, `!undefined` daba true y este
      // código creía que la vista estaba activa (seguía renderizando/polleando al pedo).
      const _elVerif=document.getElementById("viewVerificaciones");
      const active=!!_elVerif && !_elVerif.classList.contains("hidden");
      if(active)return;
      const {data}=await leerValidaciones();
      const rows=data.map(r=>mapRow(r,"validaciones_usuario"));
      const pend=rows.filter(r=>["PENDIENTE","PROCESANDO"].includes(r.estado)).length;
      const badge=document.getElementById("badgeVerif");
      if(badge){
        if(pend){badge.classList.remove("hidden");badge.textContent=String(pend)}
        else badge.classList.add("hidden");
      }
    }catch(_e){}
  },15000);

  window.NODO_VALIDACION_SOFT_VERSION=VALIDACION_SOFT_VERSION;
})();
