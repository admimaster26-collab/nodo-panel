function _updaterForzarVisible(){
  try{
    const box=document.getElementById("updaterBox"), chip=document.getElementById("updaterMiniChip");
    if(box){ box.style.display="flex"; box.style.borderColor="#10b981"; }
    if(chip) chip.style.display="none";
  }catch(_e){}
}
function nodoUpdaterStatus(payload){
  const el=document.getElementById("updaterStatusTxt");
  if(!el || !payload) return;
  const st=payload.state;
  if(st==="available" || st==="downloaded") _updaterForzarVisible();
  if(st==="checking") el.innerHTML="<span style='color:#94a3b8'>Buscando...</span>";
  else if(st==="not-available"){
    el.innerHTML="<span style='color:#10b981;font-weight:600'>✅ Al día</span>";
    setTimeout(function(){ try{ if(el && el.innerHTML.includes("Al día")) el.innerHTML=""; }catch(_e){} }, 3500);
  }
  else if(st==="available") el.innerHTML="<button class=\"mini-btn blue\" onclick=\"nodoDescargarActualizacion()\" style=\"padding:2px 8px;font-size:11px;font-weight:700\">⬇️ v"+escapeHtml(payload.version||"")+" Descargar</button>";
  else if(st==="downloading") el.innerHTML="<span style='color:#60a5fa;font-weight:700'>⬇️ "+(payload.percent||0)+"%</span>";
  else if(st==="downloaded") el.innerHTML="<button class=\"mini-btn green\" onclick=\"nodoInstalarActualizacion()\" style=\"padding:2px 8px;font-size:11px;font-weight:800\">🚀 Reiniciar e instalar</button>";
  else if(st==="error") el.innerHTML='<span style="color:#f87171" title="'+escapeHtml(payload.message||"")+'">⚠️ Error</span>';
}
// Canal único de actualización unificado
function nodoGetCanal(){ return "main"; }
function nodoAplicarIconoCanal(){}
function nodoSetCanal(_c){}
async function nodoInitUpdater(){
  try{
    if(!window.updaterAPI){ const b=document.getElementById("updaterBox"); if(b) b.style.display="none"; return; }
    nodoAplicarIconoCanal();
    const _updHealth = window.NodoSalud?.begin('CONEXION');
    const v = await window.updaterAPI.getVersion();
    _updHealth?.record('ALIVE','OK','UPDATER_VERSION_OK');
    const el=document.getElementById("updaterVersionTxt");
    if(el && v && v.version) el.textContent = "v"+v.version;
    const mv=document.getElementById("updaterMiniVer");
    if(mv && v && v.version) mv.textContent = "v"+v.version;
    const rb=document.getElementById("updaterRollbackBtn"); if(rb) rb.style.display="";
    window.updaterAPI.onStatus(nodoUpdaterStatus);
    try{ if(localStorage.getItem("nodo_updater_min")==="1") nodoUpdaterMinimizar(true); }catch(_e){}
    setTimeout(nodoAutoBuscar, 20000);
    setInterval(nodoAutoBuscar, 3*60*60*1000);
  }catch(_e){}
}
function nodoAutoBuscar(){
  try{
    if(window.updaterAPI && window.updaterAPI.check) window.updaterAPI.check();
  }catch(_e){}
}
// Arriba a la derecha, pero apoyado en el borde izquierdo del panel de chat: ahí está el hueco
// que queda arriba del botón "Rechequear". Se mide del DOM, así sigue bien si el chat se minimiza.
//
// Y se corre más todavía cuando se despliega algo contra el costado derecho que lo taparía —el cajón
// del expediente al apretar "Ver"—: queda al costado, sin pisar el título (Juan, 25/10). Cualquier
// cajón nuevo que se pegue a la derecha sólo tiene que llevar el atributo data-ocupa-derecha; no hace
// falta tocar esto. Sirve igual si el cajón queda por encima o por debajo del cartel: se corre por
// posición, no por capa.
function _updaterBordeOcupado(){
  const ancho=window.innerWidth;
  let borde=null;
  // alturaTodaLaPantalla: el chat es una columna que ocupa todo el costado, y el cartel se apoya en su
  // borde aunque el chat arranque más abajo. Un cajón sí tiene que llegar a la franja del cartel.
  const tomar=function(el, ignorarAltura){
    try{
      if(!el) return;
      const cs=getComputedStyle(el);
      if(cs.display==="none" || cs.visibility==="hidden") return;
      const r=el.getBoundingClientRect();
      if(r.width<20 || r.height<20) return;                   // escondido o sin dibujar
      if(r.right<ancho-60) return;                            // no está pegado a la derecha
      if(!ignorarAltura && r.top>46) return;                  // no llega a la franja del cartel
      if(borde===null || r.left<borde) borde=r.left;
    }catch(_e){}
  };
  // En la pantalla de LOGIN el chat está tapado (el login ocupa toda la pantalla) pero sigue
  // midiendo: el cartel se enganchaba a su borde y quedaba flotando en el MEDIO del login. Sin el chat
  // a la vista, el cartel va a la esquina.
  const login=document.getElementById("loginView");
  let enLogin=false;
  try{ enLogin=!!(login && !login.classList.contains("hidden") && getComputedStyle(login).display!=="none"); }catch(_e){}
  if(!enLogin) tomar(document.getElementById("viewChat"), true);
  Array.prototype.forEach.call(document.querySelectorAll("[data-ocupa-derecha]"), function(el){ tomar(el, false); });
  return borde;
}
function _updaterAnclar(){
  try{
    const ancho=window.innerWidth;
    const borde=_updaterBordeOcupado();
    const right = borde===null ? 12 : Math.round(ancho-borde)+14;
    ["updaterBox","updaterMiniChip"].forEach(function(id){
      const el=document.getElementById(id);
      if(!el) return;
      // Nunca se sale de la pantalla: si el cajón ocupa casi todo el ancho y no queda lugar al costado,
      // se queda lo más a la izquierda que entra.
      const w=el.offsetWidth;
      const r = w>0 ? Math.min(right, Math.max(12, ancho-w-8)) : right;
      el.style.top="10px"; el.style.bottom="auto"; el.style.left="auto"; el.style.right=r+"px";
    });
  }catch(_e){}
}
window._updaterAnclar=_updaterAnclar;
try{
  addEventListener("resize", _updaterAnclar);
  setTimeout(_updaterAnclar, 1200);
  // El panel de chat se minimiza/restaura sin avisar. Mide la pantalla: con la ventana abajo, no.
  setInterval(function(){ if(!document.hidden) _updaterAnclar(); }, 5000);
}catch(_e){}
function nodoUpdaterMinimizar(min){
  try{
    const box=document.getElementById("updaterBox"), chip=document.getElementById("updaterMiniChip");
    if(box) box.style.display = min ? "none" : "flex";
    if(chip) chip.style.display = min ? "inline-flex" : "none";
    localStorage.setItem("nodo_updater_min", min ? "1" : "0");
  }catch(_e){}
}
async function nodoVolverVersionAnterior(){
  if(!window.updaterAPI || !window.updaterAPI.openReleases){ toast&&toast("No disponible en este entorno.","yellow"); return; }
  if(!confirm("¿Volver a una versión anterior?\n\nSe va a abrir la página de descargas en el navegador. Bajá el instalador de la versión que quieras (por ejemplo la anterior a esta) y ejecutalo — reemplaza la actual y conserva tu configuración.")) return;
  try{ await window.updaterAPI.openReleases(); }catch(_e){}
}
async function nodoBuscarActualizacion(){
  const el=document.getElementById("updaterStatusTxt");
  if(!window.updaterAPI){ if(el) el.textContent="No disponible en este entorno."; return; }
  if(el) el.innerHTML="<span style='color:#94a3b8'>Buscando...</span>";
  const r = await window.updaterAPI.check();
  if(!r || !r.ok){
    if(el) el.textContent = (r&&r.reason==="dev-mode") ? "Solo disponible en app instalada." : "No se pudo buscar actualización.";
  }
}
async function nodoDescargarActualizacion(){
  const el=document.getElementById("updaterStatusTxt");
  if(el) el.textContent="⬇️ Descargando...";
  try{ await window.updaterAPI.download(); }catch(_e){ if(el) el.textContent="Error al descargar."; }
}
async function nodoInstalarActualizacion(){
  try{ await window.updaterAPI.install(); }catch(_e){}
}
document.addEventListener("DOMContentLoaded", nodoInitUpdater);
if(document.readyState !== "loading") nodoInitUpdater();
