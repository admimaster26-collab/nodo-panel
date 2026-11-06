
/* ============================================================
   NODO · VALIDACION PC DETECT FIX FINAL SAFE
   Corrige detección de PC/oficina:
   - lee pcOperativa aunque sea let global
   - lee localStorage nodo_pc_operativa_lite
   - sincroniza window.pcOperativa para patches de scope
   - no relaja el scope; solo detecta mejor la PC real
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}

  function canonPc(v){
    v=U(v);
    if(!v)return "";
    if(["P1","PC1","XGENERALENUSO","GENERAL","OFI_1"].includes(v))return "P1";
    if(["P2","PC2","OFI_2"].includes(v))return "P2";
    if(["P3","PC3","OFI_3"].includes(v))return "P3";
    if(["P4","PC4","SANCHEZ","SÁNCHEZ","OFI_4"].includes(v))return "P4";
    if(["P5","PC5","OFI_5"].includes(v))return "P5";
    return v;
  }

  function readLexicalPcOperativa(){
    try{
      if(typeof pcOperativa !== "undefined" && S(pcOperativa).trim()){
        return S(pcOperativa).trim();
      }
    }catch(_e){}
    return "";
  }

  function detectPcReal(){
    const values = [];
    values.push(readLexicalPcOperativa());

    try{values.push(window.pcOperativa)}catch(_e){}
    try{values.push(window.PC_OPERATIVA)}catch(_e){}
    try{values.push(window.pcCodigo)}catch(_e){}
    try{values.push(window.PC_CODIGO)}catch(_e){}
    try{values.push(window.operador && window.operador.pc)}catch(_e){}
    try{values.push(window.operador && window.operador.pc_codigo)}catch(_e){}
    try{values.push(window.operador && window.operador.oficina)}catch(_e){}

    [
      "nodo_pc_operativa_lite",
      "nodo_pc_codigo",
      "pc_codigo",
      "pcOperativa",
      "oficina_codigo",
      "NODO_PC"
    ].forEach(function(k){
      try{values.push(localStorage.getItem(k))}catch(_e){}
    });

    const raw = values.find(function(v){return S(v).trim()});
    return {raw:S(raw||"").trim(), canon:canonPc(raw||"")};
  }

  function syncPcWindow(){
    const d=detectPcReal();
    if(d.canon){
      try{window.pcOperativa=d.canon}catch(_e){}
      try{window.pcCodigo=d.canon}catch(_e){}
      try{localStorage.setItem("nodo_pc_operativa_lite",d.canon)}catch(_e){}
    }
    return d;
  }

  syncPcWindow();

  window.nodoValidacionScope = function(){
    const d=syncPcWindow();
    const aliases={
      P1:["P1","PC1","XGENERALENUSO","GENERAL","OFI_1"],
      P2:["P2","PC2","OFI_2"],
      P3:["P3","PC3","OFI_3"],
      P4:["P4","PC4","SANCHEZ","SÁNCHEZ","OFI_4"],
      P5:["P5","PC5","OFI_5"]
    }[d.canon] || [];
    const info={raw:d.raw, canon:d.canon, aliases:aliases};
    console.table(info);
    return info;
  };

  const oldCargar = window.cargarVerificaciones;
  if(typeof oldCargar === "function"){
    window.cargarVerificaciones = async function(){
      syncPcWindow();
      return await oldCargar.apply(this,arguments);
    };
  }

  setTimeout(function(){
    const d=syncPcWindow();
    const txt=(document.getElementById("tablaVerificaciones") && document.getElementById("tablaVerificaciones").textContent) || "";
    if(d.canon && txt.includes("no tiene PC/oficina detectada") && typeof window.cargarVerificaciones==="function"){
      window.cargarVerificaciones();
    }
  },800);

  setInterval(function(){
    if(document.hidden) return;   // con la ventana abajo no hace falta; al volver se pone al día
    syncPcWindow();
  },3000);
})();
