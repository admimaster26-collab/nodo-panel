
/* ============================================================
   NODO · HISTORIAL FILTROS AVANZADOS SAFE
   Mejora filtros del historial sin tocar render, motor ni acciones.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}
  function N(v){try{return normalizar(S(v))}catch(_e){return S(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}}
  function toDate(v){
    const d=new Date(v||0);
    return isNaN(d.getTime()) ? null : d;
  }
  function startDay(d){const x=new Date(d);x.setHours(0,0,0,0);return x}
  function endDay(d){const x=new Date(d);x.setHours(23,59,59,999);return x}
  function moneyNum(v){
    if(v===null||v===undefined||v==="")return null;
    const n=Number(S(v).replace(/\./g,"").replace(",",".").replace(/[^\d.-]/g,""));
    return isNaN(n)?null:n;
  }
  function estadoGrupo(e){
    e=U(e);
    if(["OK","ACREDITADA","PAGADA","COMPLETADA","APROBADA"].includes(e))return "OK";
    if(["ERROR","RECHAZADA","CANCELADA","CANCELADO"].includes(e))return "ERROR";
    if(["PENDIENTE","EN_REVISION","APROBADA_MANUAL","APROBADA_MANUAL_OK"].includes(e))return "PENDIENTE";
    if(e==="REVERTIDA")return "REVERTIDA";
    return e||"PENDIENTE";
  }
  function turnoDeFecha(fecha){
    const d=toDate(fecha); if(!d)return "";
    const h=d.getHours();
    if(h>=6 && h<14)return "TM";
    if(h>=14 && h<22)return "TT";
    return "TN";
  }
  function fechaEnPeriodo(fecha, periodo, desde, hasta){
    const d=toDate(fecha); if(!d)return false;
    const now=new Date();
    let min=null,max=null;
    if(periodo==="HOY"){min=startDay(now);max=endDay(now);}
    if(periodo==="AYER"){const y=new Date(now);y.setDate(y.getDate()-1);min=startDay(y);max=endDay(y);}
    if(periodo==="7D"){min=new Date(now);min.setDate(min.getDate()-7);min.setHours(0,0,0,0);max=endDay(now);}
    if(periodo==="MES"){min=new Date(now.getFullYear(),now.getMonth(),1);max=endDay(now);}
    if(desde){min=startDay(new Date(desde+"T00:00:00"));}
    if(hasta){max=endDay(new Date(hasta+"T00:00:00"));}
    if(min && d<min)return false;
    if(max && d>max)return false;
    return true;
  }

  function installHistCss(){
    if(document.getElementById("histAdvancedFiltersCss"))return;
    const st=document.createElement("style");
    st.id="histAdvancedFiltersCss";
    st.textContent=`
      .hist-filters.advanced{
        display:grid!important;
        grid-template-columns:repeat(5,minmax(120px,1fr))!important;
        gap:8px!important;
        align-items:end!important;
      }
      .hist-filter-mini{
        display:flex;
        flex-direction:column;
        gap:3px;
      }
      .hist-filter-mini label{
        color:#98a2b3;
        font-size:10px;
        font-weight:900;
        letter-spacing:.35px;
        text-transform:uppercase;
      }
      .hist-filter-mini input,.hist-filter-mini select{
        margin:0!important;
        padding:7px 9px!important;
        font-size:12px!important;
        min-height:31px!important;
      }
      .hist-filter-actions{
        display:flex;
        gap:6px;
        align-items:center;
      }
      .hist-filter-summary{
        grid-column:1/-1;
        display:flex;
        justify-content:space-between;
        gap:8px;
        align-items:center;
        color:#98a2b3;
        font-size:11px;
        padding:4px 2px 0;
      }
      .hist-filter-chip{
        background:#202635;
        border:1px solid #2c3140;
        border-radius:999px;
        padding:4px 8px;
        color:#d0d5dd;
        font-size:10px;
        font-weight:800;
      }
      @media(max-width:1100px){
        .hist-filters.advanced{grid-template-columns:repeat(2,minmax(120px,1fr))!important}
      }
    `;
    document.head.appendChild(st);
  }

  function optionIfMissing(sel,value,label){
    if(!sel)return;
    if(!Array.from(sel.options).some(o=>o.value===value)){
      const op=document.createElement("option");
      op.value=value;op.textContent=label;
      sel.appendChild(op);
    }
  }

  function installHistFilters(){
    installHistCss();
    // FILTROS SIMPLES (como la versión vieja): solo Tipo · Estado · Origen · Billetera ·
    // Usuario (ya están en el HTML). Se quitó la capa avanzada (Periodo/Desde/Hasta/Turno/
    // Monto/Saldo/Vista + colapsable) porque confundía. Mejoras mínimas que se conservan:
    // opción "Portal" en Origen y buscar por operador/billetera además del usuario.
    const box=document.querySelector(".hist-filters");
    if(!box || box.dataset.simple==="1")return;
    box.dataset.simple="1";
    optionIfMissing(document.getElementById("filtHistOrigen"),"PORTAL","Portal");
    const inputUser=document.getElementById("filtHistUsuario");
    if(inputUser)inputUser.placeholder="Usuario, operador o billetera...";
    return; // ← sin inyección de filtros avanzados
  }

  window.toggleHistFilters=function(){
    const box=document.querySelector(".hist-filters");
    if(!box)return;
    const collapsed=box.classList.toggle("collapsed");
    try{localStorage.setItem("nodo_hist_filters_collapsed", collapsed?"1":"0");}catch(_e){}
    const a=document.getElementById("histFilterToggleArrow");
    if(a)a.textContent=collapsed?"▸":"▾";
  };

  function construirListaHistorialSafe(){
    let lista=[];
    if(typeof construirHistorialUnificado==="function"){
      try{
        construirHistorialUnificado().forEach(function(it){
          lista.push({
            id: it.id,
            tipo: U(it.tipo||""),
            usuario: it.usuario,
            billetera_nombre: it.billetera_nombre,
            billetera_id: it.billetera_id,
            monto: it.monto,
            estado: it.fuente==="SOLICITUD" ? (it.estado||"PENDIENTE") : (it.estado||""),
            origen: it.fuente==="SOLICITUD" ? "PORTAL" : ((it._raw&&it._raw.origen)||"PANEL"),
            operador: it.operador || (it._raw&&it._raw.operador) || "",
            notas: (it._raw&&it._raw.notas)||"",
            created_at: it.fecha,
            saldo_post: it.saldo_post!=null ? it.saldo_post : null,
            saldo_pre: it.saldo_pre!=null ? it.saldo_pre : null,
            chunior_movimiento_id: it.chunior_movimiento_id,
            solicitud_id: it.solicitud_id || (it._raw&&it._raw.solicitud_id) || null,
            historial_id: it.historial_id || it.id || null,
            _fuente: it.fuente,
            _raw: it._raw || null
          });
        });
      }catch(e){
        console.warn("construirHistorialUnificado falló, uso _historialData",e);
        lista = Array.isArray(window._historialData)?window._historialData.slice():[];
      }
    }else{
      lista = Array.isArray(window._historialData)?window._historialData.slice():[];
    }
    return lista;
  }

  window.limpiarFiltrosHistorialAvanzado=function(){
    ["filtHistTipo","filtHistEstado","filtHistOrigen","filtHistBilletera","filtHistUsuario","filtHistPeriodo","filtHistDesde","filtHistHasta","filtHistTurno","filtHistMontoMin","filtHistMontoMax","filtHistSaldo"].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.value="";
    });
    const vista=document.getElementById("filtHistVista");
    if(vista)vista.value="SIN_SOPORTE";
    filtrarHistorial();
  };

  window.filtrarHistorial=function(){
    installHistFilters();

    const tipo    = document.getElementById("filtHistTipo")?.value||"";
    const estado  = document.getElementById("filtHistEstado")?.value||"";
    const origen  = document.getElementById("filtHistOrigen")?.value||"";
    const bil     = document.getElementById("filtHistBilletera")?.value||"";
    const usuario = N(document.getElementById("filtHistUsuario")?.value||"");
    const periodo = document.getElementById("filtHistPeriodo")?.value||"";
    const desde   = document.getElementById("filtHistDesde")?.value||"";
    const hasta   = document.getElementById("filtHistHasta")?.value||"";
    const turno   = document.getElementById("filtHistTurno")?.value||"";
    const min     = moneyNum(document.getElementById("filtHistMontoMin")?.value||"");
    const max     = moneyNum(document.getElementById("filtHistMontoMax")?.value||"");
    const saldo   = document.getElementById("filtHistSaldo")?.value||"";
    const vista   = document.getElementById("filtHistVista")?.value||"SIN_SOPORTE";

    let lista = construirListaHistorialSafe();

    // Por defecto: historial operativo, sin soporte/chat técnico.
    if(vista!=="TODO"){
      lista = lista.filter(h=>U(h.tipo)!=="SOPORTE" && U(h.tipo)!=="CHAT");
    }

    if(tipo)    lista = lista.filter(h=>U(h.tipo)===U(tipo));
    if(estado)  lista = lista.filter(h=>estadoGrupo(h.estado)===estado);
    if(origen){
      lista = lista.filter(h=>{
        const o=U(h.origen);
        if(origen==="PORTAL")return o==="PORTAL"||o==="LANDING";
        return o===U(origen);
      });
    }
    if(bil) lista = lista.filter(h=>S(h.billetera_nombre)===bil);

    if(usuario){
      lista = lista.filter(h=>{
        const blob = [h.usuario,h.operador,h.billetera_nombre,h.notas,h.tipo,h.origen,h.estado,h.solicitud_id,h.historial_id,h.chunior_movimiento_id].map(N).join(" ");
        return blob.includes(usuario);
      });
    }

    if(periodo||desde||hasta) lista = lista.filter(h=>fechaEnPeriodo(h.created_at,periodo,desde,hasta));
    if(turno) lista = lista.filter(h=>turnoDeFecha(h.created_at)===turno);

    if(min!==null) lista = lista.filter(h=>Math.abs(Number(h.monto||0))>=min);
    if(max!==null) lista = lista.filter(h=>Math.abs(Number(h.monto||0))<=max);

    if(saldo==="CON") lista = lista.filter(h=>h.saldo_post!==null && h.saldo_post!==undefined && h.saldo_post!=="");
    if(saldo==="SIN") lista = lista.filter(h=>h.saldo_post===null || h.saldo_post===undefined || h.saldo_post==="");

    lista.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));

    try{ renderHistorial(lista); }catch(e){ console.error("renderHistorial filtros avanzados",e); }

    const total=document.getElementById("histFilterTotal");
    if(total){
      const srvTotal = window._histBetaTotals && window._histBetaTotals.total_rows != null ? Number(window._histBetaTotals.total_rows) : null;
      total.textContent = lista.length+" resultado"+(lista.length===1?"":"s") + (srvTotal !== null && srvTotal !== lista.length ? " (de "+srvTotal+" en servidor)" : "");
    }

    const sum=document.getElementById("histFilterSummary");
    if(sum){
      const partes=[];
      if(periodo)partes.push(document.getElementById("filtHistPeriodo")?.selectedOptions?.[0]?.textContent||periodo);
      if(desde)partes.push("desde "+desde);
      if(hasta)partes.push("hasta "+hasta);
      if(turno)partes.push(turno);
      if(tipo)partes.push(tipo);
      if(estado)partes.push(estado);
      if(origen)partes.push(origen);
      if(bil)partes.push(bil);
      if(usuario)partes.push("búsqueda");
      if(saldo)partes.push(saldo==="CON"?"con saldo":"sin saldo");
      sum.textContent = partes.length ? "Aplicado: "+partes.join(" · ") : "Sin filtros adicionales.";
    }
  };

  // Reforzar instalación luego de que el panel cargue.
  setTimeout(()=>{installHistFilters(); try{filtrarHistorial()}catch(_e){}},900);
  setInterval(()=>{try{installHistFilters()}catch(_e){}},3000);
})();
