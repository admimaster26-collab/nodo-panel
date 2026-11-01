
/* ============================================================
   NODO · VALIDACION SCOPE STRICT SAFE
   Corrige cruce de oficinas/PCs en Verificaciones.
   Reglas:
   - Cada NODO ve solo su PC/oficina.
   - SANCHEZ se trata como PC4/P4.
   - Si no se puede resolver scope, no se muestran registros cruzados.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}

  const PC_ALIAS = {
    "P1":["P1","PC1","XGENERALENUSO","GENERAL","OFI_1"],
    "PC1":["P1","PC1","XGENERALENUSO","GENERAL","OFI_1"],
    "P2":["P2","PC2","OFI_2"],
    "PC2":["P2","PC2","OFI_2"],
    "P3":["P3","PC3","OFI_3"],
    "PC3":["P3","PC3","OFI_3"],
    "P4":["P4","PC4","SANCHEZ","SÁNCHEZ","OFI_4"],
    "PC4":["P4","PC4","SANCHEZ","SÁNCHEZ","OFI_4"],
    "SANCHEZ":["P4","PC4","SANCHEZ","SÁNCHEZ","OFI_4"],
    "P5":["P5","PC5","OFI_5"],
    "PC5":["P5","PC5","OFI_5"]
  };

  function canonPc(v){
    v=U(v);
    if(!v)return "";
    if(["P1","PC1","XGENERALENUSO","GENERAL"].includes(v))return "P1";
    if(["P2","PC2"].includes(v))return "P2";
    if(["P3","PC3"].includes(v))return "P3";
    if(["P4","PC4","SANCHEZ","SÁNCHEZ"].includes(v))return "P4";
    if(["P5","PC5"].includes(v))return "P5";
    return v;
  }

  function localPcRaw(){
    const candidates = [
      window.pcOperativa,
      window.PC_OPERATIVA,
      window.pcCodigo,
      window.PC_CODIGO,
      window.currentPc,
      window.NODO_PC,
      window.oficinaCodigo,
      window.operador?.pc_codigo,
      window.operador?.pc,
      window.operador?.oficina,
      window.config?.pc_codigo,
      window.config?.pc,
      window.CONFIG?.PC_CODIGO,
      localStorage.getItem("nodo_pc_codigo"),
      localStorage.getItem("pc_codigo"),
      localStorage.getItem("pcOperativa"),
      localStorage.getItem("oficina_codigo")
    ];
    return candidates.find(x=>S(x).trim()) || "";
  }

  function localPcCanon(){
    return canonPc(localPcRaw());
  }

  function aliasesForLocal(){
    const c=localPcCanon();
    if(!c)return [];
    const arr = PC_ALIAS[c] || [c];
    return [...new Set(arr.map(U).filter(Boolean))];
  }

  function rowPcValues(row){
    const raw=row?.raw || row || {};
    return [
      row?.pc_codigo,
      raw.pc_codigo,
      raw.pc,
      raw.codigo_pc,
      raw.oficina,
      raw.oficina_id,
      raw.queue_name,
      raw.worker_tipo
    ].map(U).filter(Boolean);
  }

  function rowBelongsToLocal(row){
    const local=localPcCanon();
    const aliases=aliasesForLocal();

    // Seguridad: si no sé qué PC es este NODO, no muestro nada.
    if(!local || !aliases.length)return false;

    const vals=rowPcValues(row);
    if(!vals.length)return false;

    // Match directo por alias.
    if(vals.some(v=>aliases.includes(v)))return true;

    // Match por canonicalización.
    if(vals.some(v=>canonPc(v)===local))return true;

    return false;
  }

  function scopeLabel(){
    const raw=localPcRaw();
    const c=localPcCanon();
    return raw ? (raw+" → "+c) : "SIN PC DETECTADA";
  }

  // Tomamos la función anterior si existe y la envolvemos con scope estricto.
  const oldCargar = window.cargarVerificaciones;
  if(typeof oldCargar === "function"){
    window.cargarVerificaciones = async function(){
      await oldCargar();

      // Si la función anterior dejó cache global, filtramos y repintamos con la misma render si está accesible.
      try{
        const local=localPcCanon();
        const aliases=aliasesForLocal();

        if(!local){
          const box=document.getElementById("tablaVerificaciones");
          if(box){
            box.innerHTML = `<div class="error-box">
              No puedo mostrar validaciones porque este NODO no tiene PC/oficina detectada.<br>
              Configurá pcOperativa / pc_codigo para evitar cruces entre oficinas.
            </div>`;
          }
          return;
        }

        // Si hay cache interna no accesible, al menos limpiamos filas ya renderizadas que no pertenezcan.
        const table=document.querySelector("#tablaVerificaciones table tbody");
        if(table){
          let removed=0;
          table.querySelectorAll("tr").forEach(tr=>{
            const txt=U(tr.textContent);
            const isOtherKnown =
              (txt.includes("SANCHEZ") && local!=="P4") ||
              (txt.includes("PC4") && local!=="P4") ||
              (txt.includes("P4") && local!=="P4") ||
              (txt.includes("PC1") && local!=="P1") ||
              (txt.includes("P1") && local!=="P1") ||
              (txt.includes("PC2") && local!=="P2") ||
              (txt.includes("P2") && local!=="P2") ||
              (txt.includes("PC3") && local!=="P3") ||
              (txt.includes("P3") && local!=="P3") ||
              (txt.includes("PC5") && local!=="P5") ||
              (txt.includes("P5") && local!=="P5");
            if(isOtherKnown){
              tr.remove();
              removed++;
            }
          });

          if(removed){
            const note=document.createElement("div");
            note.className="val-mini-note";
            note.innerHTML=`<b>Scope estricto activo:</b> se ocultaron ${removed} registro(s) de otra PC/oficina. Este NODO está en <b>${scopeLabel()}</b>.`;
            const cont=document.getElementById("tablaVerificaciones");
            if(cont && !cont.textContent.includes("Scope estricto activo"))cont.prepend(note);
          }
        }

        // Ajuste visual de fuente/contador.
        const cards=document.querySelectorAll("#tablaVerificaciones .val-card");
        if(cards && cards.length){
          const first=cards[0];
          if(first && first.innerHTML.includes("FUENTE")){
            first.innerHTML = `<div class="k">Scope</div><div class="v" style="font-size:15px">${scopeLabel()}</div>`;
          }
        }

      }catch(e){
        console.warn("scope strict postfilter",e);
      }
    };
  }

  // Filtro estricto para crear validación manual: usa PC local por defecto.
  const oldCrear = window.crearValidacionManual;
  window.crearValidacionManual = async function(){
    const usuario=prompt("Usuario a validar:");
    if(!usuario)return;

    const pc=localPcCanon();
    if(!pc){
      alert("No puedo crear validación: este NODO no tiene PC/oficina detectada.");
      return;
    }

    // Si existe función vieja de inserción interna no accesible, replicamos vía tabla real.
    try{
      const row={
        usuario:S(usuario).trim(),
        pc_codigo:pc,
        estado:"PENDIENTE",
        resultado:{origen:"PANEL_MANUAL_SCOPE_STRICT",scope_pc:pc},
        intentos:0,
        created_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      };
      const r=await supabaseClient.from("validaciones_usuario").insert(row);
      window.NodoSalud?.begin('VALIDACION')?.reply(r?.error);
      if(r.error)throw r.error;
      try{if(typeof toast==="function")toast("Validación creada en "+pc+": "+usuario,"green")}catch(_e){}
      if(typeof window.cargarVerificaciones==="function")await window.cargarVerificaciones();
    }catch(e){
      alert("No pude crear validación: "+(e.message||e));
    }
  };

  // Badge/diagnóstico.
  window.nodoValidacionScope=function(){
    const info={
      raw:localPcRaw(),
      canon:localPcCanon(),
      aliases:aliasesForLocal()
    };
    console.table(info);
    return info;
  };

  // Forzar recarga con scope al entrar.
  setTimeout(function(){
    try{
      // El apartado de Verificaciones fue ELIMINADO: sin el elemento, `!undefined` daba true y este
      // código creía que la vista estaba activa (seguía renderizando/polleando al pedo).
      const _elVerif=document.getElementById("viewVerificaciones");
      const active=!!_elVerif && !_elVerif.classList.contains("hidden");
      if(active && typeof window.cargarVerificaciones==="function")window.cargarVerificaciones();
    }catch(_e){}
  },900);

})();
