function aplicarShellV16Limpio(){
  const layout=document.getElementById("appLayout");
  const main=document.querySelector(".main");
  const chat=document.getElementById("viewChat");
  if(!layout || !main || !chat) return;
  const desktop=window.matchMedia && window.matchMedia("(min-width:1101px)").matches;
  if(desktop && chat.parentElement!==layout){
    layout.appendChild(chat);
  }else if(!desktop && chat.parentElement!==main){
    main.appendChild(chat);
  }
}

window.addEventListener("load",()=>{
  aplicarShellV16Limpio();
  // Siempre mostramos el login para capturar la clave (= clave Chunior).
  // Solo pre-rellenamos el usuario si hay sesión guardada.
  const saved=localStorage.getItem("nodo_operador_lite");
  // No pre-rellenar usuario: cada operador entra con sus credenciales en blanco
  if(saved){
    try{ JSON.parse(saved); }catch(e){
      localStorage.removeItem("nodo_operador_lite");
      localStorage.removeItem("nodo_pc_operativa_lite");
    }
  }

  // Pre-cargar el webview de Chunior en background para que el login sea inmediato
  // y adjuntar listeners (puesto de trabajo, status) desde el inicio
  setTimeout(function(){
    activarChunior();
  }, 300);

  // Consulta en tiempo real de retiros del usuario (form manual sin monto)
  _configurarConsultaRetirosLive();
});

window.addEventListener("resize", aplicarShellV16Limpio);

function money(v){ return NodoDomain.formatos.money(v); }
function normalizar(v){ return NodoDomain.formatos.normalizar(v); }
function setBox(id,html){const el=document.getElementById(id);if(el)el.innerHTML=html}
function val(id){return document.getElementById(id)?.value||""}
// ¿Este pedazo de pantalla se está viendo? Lo preguntan los relojes que reparan el DOM cada pocos
// segundos: corrían igual en el login, con la ventana minimizada o con la sección cerrada. Mirar
// la clase "hidden" no alcanza: en escritorio el chat la tiene y se ve igual (base.css).
function nodoSeVe(el){
  try{
    if(!el || document.hidden) return false;
    if(!document.body.classList.contains("app-lista")) return false;   // todavía en el login
    return typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0;
  }catch(_e){ return true; }   // ante la duda se repara, como antes
}
// Avisos apilados con fade. El tope de 4 evita que una tanda de operaciones tape media pantalla:
// al llegar el quinto, el más viejo se va con su animación en vez de acumularse.
const _TOAST_MAX = 4;
function _toastQuitar(el){
  if(!el || el._saliendo) return;
  el._saliendo = true;
  el.classList.remove("entrando"); el.classList.add("saliendo");
  setTimeout(function(){ try{ el.remove(); }catch(_e){} }, 240);
}
function toast(msg,type="blue"){
  // TODO aviso va también a la consola. Los toasts duran 3s y se van: cuando algo se traba o falla,
  // lo que el operador vio ya no existe y no hay forma de reconstruir la secuencia. En la consola
  // quedan con hora, en orden, y se pueden copiar enteros para diagnosticar.
  try{
    const _h = new Date().toLocaleTimeString('es-AR',{hour12:false});
    const _c = type==='red' ? 'color:#f04438;font-weight:700'
             : type==='green' ? 'color:#12b76a;font-weight:700'
             : type==='yellow' ? 'color:#f5c518;font-weight:700' : 'color:#58a6ff';
    console.log('%c[toast '+_h+'] '+msg, _c);
  }catch(_e){}
  let stack=document.getElementById("toastStack");
  if(!stack){ stack=document.createElement("div"); stack.id="toastStack"; document.body.appendChild(stack); }
  const div=document.createElement("div");
  div.className="toast";
  div.style.background = type==="red" ? "#f04438" : type==="green" ? "#12b76a" : "#3d5afe";
  div.innerText=msg;
  stack.appendChild(div);
  const vivos=[].slice.call(stack.children).filter(function(x){ return !x._saliendo; });
  while(vivos.length>_TOAST_MAX) _toastQuitar(vivos.shift());
  requestAnimationFrame(function(){ div.classList.add("entrando"); });
  setTimeout(function(){ _toastQuitar(div); }, 3500);
  return div;
}
// Fachada: los nombres globales se conservan para los handlers y extensiones existentes.
function formatFecha(fechaRaw){ return NodoDomain.formatos.formatFecha(fechaRaw); }
function formatearHoraChat(fechaRaw){ return NodoDomain.formatos.formatearHoraChat(fechaRaw); }
function inicioDiaArgentina(){ return NodoDomain.formatos.inicioDiaArgentina(); }
function _parseFechaCSV(str){ return NodoDomain.formatos.parseFechaCSV(str); }

