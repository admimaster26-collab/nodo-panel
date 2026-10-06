// Los teléfonos se dibujan por acá y por ningún otro lado. Son TODOS argentinos: 549 + 10
// dígitos (Juan, 27/9). Antes cada pantalla los pintaba como venían y el mismo jugador se veía
// "1123456789" en una, "+54 11 2345-6789" en otra y "5491123456789" en la tercera.
window._tel = function(v){
  try{ return (window.NodoDomain && window.NodoDomain.telefono) ? window.NodoDomain.telefono.mostrar(v) : String(v==null?"":v); }
  catch(_e){ return String(v==null?"":v); }
};

const API_URL ="https://script.google.com/macros/s/AKfycbwvZGRAOxBLNIQ52mlED6ZlsOkpAd2PicOvmlZFBTKptXR5lnC_n87w-awDvowmktI8/exec";

// Unificado al mismo Supabase que Portal y Admi (pjvvyvfcwjoocjqvdror).
// ROLLBACK si el panel no loguea (RPCs faltantes en el proyecto nuevo):
//   SUPABASE_URL = "https://gxedxuctwlkjllmayxaa.supabase.co"
//   SUPABASE_KEY = "sb_publishable_UlAN1ifdqpTj9pDIwFU0vg_S7AIU5Sg"
const SUPABASE_URL = "https://pjvvyvfcwjoocjqvdror.supabase.co";
const SUPABASE_KEY = "sb_publishable_NYqRoKptTgcL90VAVF2kqA_Gl06mEUF";
// Guarda: si ni el bundle local ni el CDN cargaron, NO tiramos acá. Un throw en el top-level
// de este script deja todos los globals en TDZ y la app queda inutilizable en silencio.
const supabaseClient = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { "x-panel-secret": (localStorage.getItem("nodo_panel_data_secret") || "nodo-panel-data-2026") } }
    })
  : (console.error('[NODO] Supabase NO cargó (ni local ni CDN) — la app sigue viva pero sin base.'), null);

// ── Push API (configurable por oficina via localStorage) ──────────────────
window.PUSH_API_URL = localStorage.getItem("nodo_push_api_url") || "https://portal-bet300-a4xj.vercel.app/api/send-push";
window.PUSH_SECRET  = localStorage.getItem("nodo_push_secret")  || "nodo-bet300-push-2026";
// ── Secreto de datos del panel (Fase 2: RPC con secreto; el portal público NO lo tiene) ──
window.PANEL_DATA_SECRET = localStorage.getItem("nodo_panel_data_secret") || "nodo-panel-data-2026";

// ── Latido de actividad del panel → el admi muestra "Paneles por oficina" (online/offline) ──
// Versión REAL del build (la del package.json, la misma que muestra el updater arriba a la derecha).
// Antes acá viajaba el texto fijo 'V18', así que panel_actividad decía "V18" para las 7 oficinas y
// no había forma de saber qué build tenía cada PC — justo lo que hace falta para decidir si ya se
// puede exigir algo nuevo del lado del servidor. Se pide una sola vez y queda cacheada.
async function _versionDelPanel(){
  if(window._versionApp) return window._versionApp;
  try{
    const v = await window.updaterAPI?.getVersion();
    if(v && v.version) window._versionApp = String(v.version);
  }catch(_e){}
  return window._versionApp || 'sin-empaquetar';
}
// Identidad de la INSTALACIÓN, no del operador. El tablero guardaba una fila por puesto y dos
// paneles de la misma oficina se pisaban cada 45 s, mostrando uno al azar: en MOR (P6) convivían
// una máquina en 1.1.80 y otra en V18, las dos con el usuario "marcosm", así que ni siquiera
// alcanzaba con separar por operador. Se genera una vez y queda en el equipo.
function _instalacionId(){
  try{
    let v = localStorage.getItem('nodo_instalacion_id');
    if(!v){
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2,10);
      localStorage.setItem('nodo_instalacion_id', v);
    }
    return v;
  }catch(_e){ return ''; }   // sin localStorage el servidor cae solo al modo viejo (por operador)
}
async function _latidoPanel(){
  try{
    const pc = (typeof pcOperativa!=='undefined'?pcOperativa:'') || window.pcOperativa || '';
    if(!pc) return; // todavía sin oficina resuelta
    const op = (window.operador && (window.operador.usuario||window.operador.nombre)) ||
               (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre)) || '';
    await supabaseClient.rpc('panel_registrar_actividad',{
      p_secret:window.PANEL_DATA_SECRET, p_pc_codigo:pc,
      p_oficina_id:(window.oficinaId||''), p_operador:op, p_version:await _versionDelPanel(),
      p_instalacion:_instalacionId()
    });
  }catch(_e){}
}
setInterval(_latidoPanel, 45000);
setTimeout(_latidoPanel, 6000);

// ── Aviso de líneas de WhatsApp caídas ────────────────────────────────────────
// Whaticket NO notifica cuando una conexión se cae: si el operador no entra al apartado
// de Conexiones, no se entera. P2 estuvo 42 h con PRINCIPAL 4 esperando el QR mientras el
// monitor lo registraba cada 10 min sin que le llegara a nadie. Las líneas las gestionan
// los operadores, así que el aviso va acá y no en el admi.
const _LINEAS_MIN_AVISO = 30;  // una línea parpadea y vuelve sola: recién avisamos a la media hora
window._lineasEstado = null;

function _pintarAvisoLineas(d){
  const cont = document.getElementById('lineasAviso');
  if(!cont) return;
  // Sin monitor configurado no se puede afirmar nada: mejor callar que dar un falso "todo bien".
  if(!d || !d.ok || d.sin_monitor){ cont.innerHTML=''; return; }

  const caidas = (d.caidas||[]).filter(function(l){ return Number(l.minutos||0) >= _LINEAS_MIN_AVISO; });
  if(!caidas.length && !d.datos_viejos){ cont.innerHTML=''; return; }

  if(!caidas.length){
    cont.innerHTML = '<div class="alert-box" style="background:#2a2416;color:#f0d99b;border-left:3px solid #c9a227">'
      + '⏱️ Sin lectura reciente del estado de las líneas — lo que se ve puede estar desactualizado.</div>';
    return;
  }

  const filas = caidas.map(function(l){
    const m = Number(l.minutos||0);
    const cuanto = m>=120 ? (Math.round(m/60)+' horas') : (m+' minutos');
    return '<li style="margin:2px 0"><b>'+escapeHtml(String(l.nombre||''))+'</b> — '
      + escapeHtml(String(l.motivo||'caída'))+' hace <b>'+cuanto+'</b></li>';
  }).join('');

  cont.innerHTML = '<div class="alert-box" style="background:#3a1a1a;color:#ffd0d0;border-left:3px solid #d94545">'
    + '<div style="font-weight:800;margin-bottom:4px">📵 '+caidas.length+' línea(s) de WhatsApp sin conexión</div>'
    + '<ul style="margin:0 0 6px 18px;padding:0">'+filas+'</ul>'
    + '<div style="font-size:11px;opacity:.85">Whaticket no avisa de esto. Entrá a Conexiones y reconectá; '
    + 'si dice «esperando QR» hay que escanearlo de nuevo.</div>'
    + (d.datos_viejos ? '<div style="font-size:11px;opacity:.7;margin-top:4px">⏱️ La última lectura es vieja: pudo haber cambiado.</div>' : '')
    + '</div>';
}

async function _revisarLineas(){
  try{
    const pc = (typeof pcOperativa!=='undefined'?pcOperativa:'') || window.pcOperativa || '';
    if(!pc) return;  // todavía sin oficina resuelta
    const r = await supabaseClient.rpc('panel_lineas_estado',
      { p_secret:window.PANEL_DATA_SECRET, p_pc_codigo:pc });
    if(r.error) throw r.error;
    let d = r.data; try{ if(typeof d==='string') d=JSON.parse(d); }catch(_e){}
    window._lineasEstado = d;
    _pintarAvisoLineas(d);
  }catch(_e){ /* mudo a propósito: es informativo, no puede trabar la operación */ }
}
setInterval(_revisarLineas, 5*60*1000);
setTimeout(_revisarLineas, 12000);

let operador=null, pcOperativa=null;
let solicitudes=[], billeteras=[], chats=[], chatMensajes=[];
let retiros24hCSV = []; // {alias, fecha, monto} — retiros detectados en últimas 24h desde CSV
let lastPendientesIds=new Set(), lastChatUnread=0;
let chatActualId="", chatImagenBase64="", chatImagenNombre="";

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
    const {error} = await supabaseClient.from("usuarios").update(cambios).eq("id", u.id);
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
function _blEsParcial(r){ return /PARCIAL/i.test(String((r&&r.notas)||'')); }
function _blFmtGap(ms){ if(ms==null) return ''; const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000); return (h>0?h+'h':'')+(m>0?(h>0?' ':'')+m+'min':'')||'0min'; }
function _blIsoDay(offset){ const d=new Date(); d.setDate(d.getDate()-(offset||0)); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// Ventana de 24hs en ms: la usa el fetch (retrovisor del modo día) y el gap pareado.
// var y no const: se referencia desde muy abajo del mismo script; si algo tira arriba,
// var sigue resolviendo por window en vez de quedar muerto en TDZ.
var _BL_H24 = 24*60*60*1000;

async function verificarRetiro24h(usuario) {
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
  const ahora   = Date.now();
  const usuarioNorm = normalizar(usuario);
  const candidatos  = [];
  // ilike sin comodines = match exacto SIN distinguir mayúsculas. Los retiros quedan guardados a
  // veces "Cristina0735" y a veces "cristina0735" (portal vs form manual) — con .eq el bloqueo 24h
  // no los cruzaba y el usuario podía retirar dos veces. Escapamos %/_ del patrón (portado de tu nodo).
  const _uPat = String(usuario).replace(/[\\%_]/g, function(c){ return '\\'+c; });

  // 1. Retiros del PORTAL. Antes esto miraba la tabla `solicitudes`, muerta desde el 30 de mayo:
  //    la fuente 1 del chequeo de 24 h no devolvía nunca nada. La regla igual funcionaba por la
  //    fuente 2 (historial_ops), pero un retiro del portal sin fila en el historial se colaba.
  try {
    const { data: dataSol } = await supabaseClient
      .from("landing_solicitudes")
      .select("id, created_at, monto")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      .in("estado", ["PAGADA", "APROBADA", "ACREDITADA"])
      .gte("created_at", new Date(hace24h).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if(dataSol && dataSol.length)
      candidatos.push({ created_at: dataSol[0].created_at, monto: dataSol[0].monto, billetera_nombre: null, origen: "SOLICITUD" });
  } catch(_){}

  // 2. Buscar en historial_ops (retiros del form manual, chat rápido)
  try {
    const { data: dataH } = await supabaseClient
      .from("historial_ops")
      .select("id, created_at, monto, billetera_nombre, notas")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      .eq("estado", "OK")
      .gte("created_at", new Date(hace24h).toISOString())
      .order("created_at", { ascending: false })
      .limit(8);
    // Excluir PARCIALES (tramos de un retiro grande) y los marcados [BL_EXCLUIDO]: no son un
    // retiro separado → tomamos el retiro REAL más reciente (no parcial, no excluido).
    const dhReal = (dataH||[]).find(function(r){ return !_blEsParcial(r) && !/\[BL_EXCLUIDO\]/.test(String(r.notas||'')); });
    if(dhReal)
      candidatos.push({ created_at: dhReal.created_at, monto: dhReal.monto, billetera_nombre: dhReal.billetera_nombre || null, origen: "HISTORIAL" });
  } catch(_){}

  // 3. Buscar en CSV importado (últimas 24h)
  if(retiros24hCSV && retiros24hCSV.length){
    const retiroCSV = retiros24hCSV.find(r => normalizar(r.alias) === usuarioNorm);
    if(retiroCSV){
      const t = ahora - new Date(retiroCSV.fecha).getTime();
      if(t < 24 * 60 * 60 * 1000)
        candidatos.push({ created_at: retiroCSV.fecha, monto: retiroCSV.monto, billetera_nombre: null, origen: "CSV" });
    }
  }

  if(!candidatos.length) return { bloqueado: false };

  // Tomar el retiro más reciente de cualquier fuente
  candidatos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const retiro = candidatos[0];

  const elapsed       = ahora - new Date(retiro.created_at).getTime();
  const horasElapsed  = Math.floor(elapsed / (60 * 60 * 1000));
  const minsElapsed   = Math.floor((elapsed % (60 * 60 * 1000)) / 60000);
  const horasRestantes= Math.ceil((24 * 60 * 60 * 1000 - elapsed) / (60 * 60 * 1000));
  const proximoRetiro = new Date(new Date(retiro.created_at).getTime() + 24 * 60 * 60 * 1000);

  return {
    bloqueado:        true,
    advertencia:      true,
    usuario,
    horasRestantes,
    monto:            retiro.monto,
    fecha:            retiro.created_at,
    proximoRetiro:    proximoRetiro.toISOString(),
    billetera_nombre: retiro.billetera_nombre || null,
    origen:           retiro.origen,
    mensaje:          `${usuario} ya retiró hace ${horasElapsed}h${minsElapsed > 0 ? ' ' + minsElapsed + 'min' : ''} · puede volver a las ${formatFecha(proximoRetiro.toISOString())}`
  };
}

// Modal de confirmación de retiro duplicado.
// Muestra los detalles del retiro anterior y pregunta si proceder.
// Devuelve Promise<true> si el operador elige proceder, Promise<false> si cancela.
function confirmarRetiroDuplicado(check) {
  return new Promise(function(resolve) {
    const fechaRet  = escapeHtml(formatFecha(check.fecha));
    const horaOk    = escapeHtml(formatFecha(check.proximoRetiro));
    const bilInfo   = check.billetera_nombre
      ? '<br><span class="small" style="color:#e0c070">Billetera: <b>' + escapeHtml(check.billetera_nombre) + '</b></span>'
      : '';

    const body =
      '<div class="alert-box" style="line-height:1.7;margin-bottom:14px">' +
        '<b>⚠️ Retiro en las últimas 24hs</b><br><br>' +
        '<b>' + escapeHtml(check.usuario || '') + '</b> ya realizó un retiro:<br>' +
        '📅 Retiro anterior: <b>' + fechaRet + '</b><br>' +
        '🕐 Habilitado nuevamente: <b>' + horaOk + '</b><br>' +
        '💰 Monto anterior: <b>' + money(check.monto) + '</b>' + bilInfo +
      '</div>' +
      '<p style="color:#c0cad8;font-size:13px">Podés proceder si verificaste el caso del usuario.</p>';

    abrirModal('⚠️ Retiro en 24hs', body, null, 'Proceder igualmente');

    var saveBtn   = document.getElementById('modalSaveBtn');
    var cancelBtn = document.querySelector('#modalOverlay .btn-gray');

    function limpiarHandlers(){
      // Restaurar el modal a estado neutro para que el próximo abrirModal funcione limpio
      if(saveBtn)   saveBtn.onclick   = null;
      if(cancelBtn) cancelBtn.onclick = function(){ cerrarModal(); };
    }

    if(saveBtn) saveBtn.onclick = function(){
      limpiarHandlers();
      cerrarModal();
      resolve(true);
    };
    if(cancelBtn) cancelBtn.onclick = function(){
      limpiarHandlers();
      cerrarModal();
      resolve(false);
    };
  });
}

function esPendiente(s){const e=normalizar(s.ESTADO);return e.includes("PENDIENTE")||e==="NUEVA"||e==="NUEVO"||e==="EN_REVISION"}

// ── Sistema de lealtad ────────────────────────────────────────────────────────
// Lógica: el volumen exitoso pesa más que los rechazos.
// Los rechazos penalizan según su TASA (rechazados/total), no su cantidad absoluta.
// Ejemplo: 500 exitosas + 20 rechazadas → tasa 3.8% → penalización mínima → score alto.
function calcularLealtad(usuarioNombre){
  const todas = solicitudes.filter(s=>normalizar(s.USUARIO||s.USUARIO_JUGADOR||"")===normalizar(usuarioNombre));
  const aprobadas  = todas.filter(esRealizada).length;
  const rechazadas = todas.filter(s=>normalizar(s.ESTADO)==="RECHAZADA").length;
  const totalOps   = aprobadas + rechazadas;
  const totalMonto = todas.filter(esRealizada).reduce((a,s)=>a+Number(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO||0),0);

  if(totalOps===0) return {score:5,nivel:"Nuevo",color:"muted",aprobadas:0,rechazadas:0,tasa:100,totalMonto:0};

  const tasaExito  = aprobadas/totalOps;                        // 0–1

  // Volumen: logarítmico, tope 35 pts. 10 ops → ~17pts, 100 ops → ~35pts, 500 → 35pts
  const volScore   = Math.min(Math.log10(aprobadas+1)*17.5, 35);

  // Tasa de éxito: pesa 45 pts — el factor más importante
  const rateScore  = tasaExito * 45;

  // Monto total operado: logarítmico, tope 20 pts
  const montoScore = Math.min(Math.log10(totalMonto/1000+1)*10, 20);

  const score = Math.round(Math.min(volScore+rateScore+montoScore, 100));

  let nivel,color;
  if(score<15){nivel="Nuevo";color="muted"}
  else if(score<35){nivel="Regular";color="blue"}
  else if(score<55){nivel="Confiable";color="green"}
  else if(score<75){nivel="Preferencial";color="purple"}
  else{nivel="VIP";color="yellow"}

  return {score,nivel,color,aprobadas,rechazadas,tasa:Math.round(tasaExito*100),totalMonto};
}

function scoreBadge(usuarioNombre){
  const l=calcularLealtad(usuarioNombre);
  const colores={muted:"#667085",blue:"#3d5afe",green:"#12b76a",purple:"#7c3aed",yellow:"#fdb022"};
  const bg={muted:"#2a2f3b",blue:"#16235f",green:"#11371f",purple:"#2e1a5e",yellow:"#3d2d00"};
  const color=colores[l.color]||colores.muted;
  const bgc=bg[l.color]||bg.muted;
  return `<span title="${l.aprobadas} aprobadas · ${l.rechazadas} rechazadas · ${l.tasa}% éxito" style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${bgc};color:${color};cursor:help">${l.score}</span>`;
}
function esRealizada(s){const e=normalizar(s.ESTADO);return ["APROBADA_MANUAL","APROBADA_MANUAL_OK","ACREDITADA","PAGADA","APROBADA"].includes(e)}
function estadoBadge(e){const x=normalizar(e);if(esRealizada({ESTADO:e}))return`<span class="badge badge-ok">${e}</span>`;if(["RECHAZADA","ERROR"].includes(x))return`<span class="badge badge-danger">${e}</span>`;return`<span class="badge badge-pending">${e||"-"}</span>`}
function escapeHtml(text){return String(text||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

async function api(data){
  const fd=new FormData();
  Object.keys(data).forEach(k=>fd.append(k,data[k]??""));
  const res=await fetch(API_URL,{method:"POST",body:fd});
  const text=await res.text();
  try{return JSON.parse(text)}catch(e){console.error(text);return{ok:false,error:"Respuesta inválida de API"}}
}



function mapSolicitudSupabase(s){
  return {
    ID: s.id,
    SOLICITUD_ID: s.id,
    FECHA_CREACION: s.created_at,
    FECHA: s.created_at,
    TIPO_SOLICITUD: s.tipo,
    TIPO: s.tipo,
    USUARIO: s.usuario,
    USUARIO_JUGADOR: s.usuario,
    NOMBRE_COMPLETO: s.nombre_completo,
    TELEFONO: s.telefono,
    PC: s.pc_codigo,
    MONTO_DECLARADO: s.monto,
    MONTO_REAL: s.monto,
    ESTADO: s.estado,
    BILLETERA_NOMBRE: s.billetera_nombre || "",
    ID_BILLETERA: s.billetera_id || "",
    CHAT_ID: s.chat_id || "",
    OPERADOR: s.operador_usuario || "",
    PASSWORD_NUEVO: s.password_nuevo || ""
  };
}

async function cargarSolicitudesSupabase(){
  const { data, error } = await supabaseClient
    .from("solicitudes")
    .select("*")
    .eq("pc_codigo", pcOperativa)
    .order("created_at", { ascending:false });

  if(error){
    console.error("Error solicitudes Supabase:", error);
    return { ok:false, error:error.message || "Error cargando solicitudes" };
  }

  return {
    ok:true,
    solicitudes:(data || []).map(mapSolicitudSupabase)
  };
}

// Esta función escribía en la tabla `solicitudes`, que está MUERTA desde el 30 de mayo: 156
// filas, ninguna nueva desde entonces. Las solicitudes del portal viven en
// `landing_solicitudes` (191.608 filas). O sea que los 16 lugares que la llamaban venían
// haciendo un update que no tocaba nada, y el error se iba a console.error sin que nadie lo
// viera. El síntoma: se cambiaba la clave del jugador, funcionaba, y la solicitud quedaba
// PENDIENTE en la bandeja para siempre. Lo mismo con cargas, retiros y rechazos que pasaran
// por acá. Verificado en la #188138: la clave se cambió y `updated_at` seguía siendo la fecha
// de creación.
//
// Se redirige la función entera en vez de tocar los 16 llamadores: la firma no cambia.
async function actualizarSolicitudSupabase(id, cambios){
  const c = Object.assign({}, cambios || {});
  const estado   = c.estado != null ? String(c.estado) : null;
  const operador = c.operador_usuario || c.operador || "";
  const monto    = c.monto != null ? Number(c.monto) : null;
  delete c.estado; delete c.operador_usuario; delete c.operador; delete c.monto;

  const r = await supabaseClient.rpc("panel_v15_5_actualizar_solicitud_portal", {
    p_id: Number(id),
    p_estado: estado,
    p_operador: operador,
    p_monto: monto,
    p_metadata: c            // lo que sobre viaja como metadata, igual que en el resto del panel
  });

  if(r && r.error){
    console.error("Error actualizando solicitud:", r.error);
    return { ok:false, error:(r.error.message || "No se pudo actualizar la solicitud") };
  }
  return { ok:true, solicitud:(r && r.data) || null };
}


async function apiPostNoCors(data){
  await fetch(API_URL, {
    method: "POST",
    mode: "no-cors",
    body: JSON.stringify(data)
  });
  return { ok:true };
}

function comprimirImagenChat(file, cb){
  const img = new Image();
  const reader = new FileReader();

  reader.onload = () => {
    img.onload = () => {
      const max = 560;
      let w = img.width;
      let h = img.height;

      if(w > h && w > max){
        h = Math.round(h * max / w);
        w = max;
      }else if(h >= w && h > max){
        w = Math.round(w * max / h);
        h = max;
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      cb(canvas.toDataURL("image/jpeg", .52));
    };

    img.src = reader.result;
  };

  reader.readAsDataURL(file);
}

// ── Multi-oficina: helpers ────────────────────────────────────────────────────
// "Puesto SANCHEZPLATA" → "SANCHEZPLATA"
// "Puesto Sánchez-Plata 1" → "SANCHEZPLATA1"
function normalizarPcCodigo(textPuesto){
  const base = String(textPuesto||'')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]','g'), '')   // diacríticos
    .replace(/^\s*puesto\s+/i, '')                      // saca "Puesto " del prefijo
    .replace(/[^A-Za-z0-9]/g, '')                       // solo alfanumérico
    .toUpperCase();
  // Canónico: el sistema entero usa P1..P5 (el admi, el snapshot, el proxy, las promos).
  // Si el puesto viene como "PC5", lo dejamos como "P5"; de lo contrario las billeteras y
  // todo lo demás quedan colgados en una oficina fantasma "PC5" que el admi (que filtra por
  // P5) nunca ve. Espeja el normPc del admi.
  return base.replace(/^PC(\d+)$/, 'P$1');
}

// Busca / crea la oficina en Supabase. Devuelve {pc_codigo, nombre, chunior_pt_id, esNueva}.
async function _asegurarOficina(pcCodigo, nombre, chuniorPtId){
  if(!pcCodigo) return { pc_codigo:'', nombre:'', esNueva:false };
  // La tabla 'oficinas' no existe en el Supabase unificado; los datos de oficina
  // viven en nodo_oficina_aliases. Devolvemos sin tocar Supabase (evita 404).
  return { pc_codigo:pcCodigo, nombre, chunior_pt_id:String(chuniorPtId||''), esNueva:false };

}

async function login(){
  const usuario=val("loginUsuario").trim();
  const clave=val("loginClave").trim();
  if(!usuario||!clave){setBox("loginMsg",`<div class="alert-box">Completá usuario y clave.</div>`);return}
  setBox("loginMsg",`<div class="alert-box">Validando en Chunior...</div>`);

  // Validar contra Chunior. No guardamos la clave en ningún lado.
  let okBackoffice = false;
  try {
    okBackoffice = await validarLoginChunior(usuario, clave);
  } catch(e){
    // Chunior en 403/CSRF → no aparece el formulario de login. Reset DURO (limpia cookies + GET a la
    // base) y reintentamos una vez, así el operador no queda trabado en el login.
    const _esCsrf = /formulario de login|403|csrf|forbidden/i.test(String((e&&e.message)||""));
    if(_esCsrf && window.chunior && window.chunior.reset){
      setBox("loginMsg",`<div class="alert-box">Chunior estaba trabado (CSRF) — reiniciándolo y reintentando…</div>`);
      try{ await window.chunior.reset({hard:true}); }catch(_e){}
      await new Promise(function(r){ setTimeout(r,1400); });
      try{ okBackoffice = await validarLoginChunior(usuario, clave); }
      catch(e2){
        setBox("loginMsg",`<div class="err-box">No se pudo conectar con Chunior tras reiniciarlo. ${escapeHtml(e2.message||"")}<br><span class="small">Cerrá la ventana de Chunior y reabrí la app si persiste.</span></div>`);
        return;
      }
    } else {
      setBox("loginMsg",`<div class="err-box">No se pudo conectar con Chunior. ${escapeHtml(e.message||"")}</div>`);
      return;
    }
  }
  if(!okBackoffice){
    setBox("loginMsg",`<div class="err-box">Usuario o clave incorrectos (rechazado por Chunior).</div>`);
    return;
  }

  // Operador "ligero": solo lo que vino del input. La oficina (pc_codigo) se setea
  // recién cuando el operador elija el puesto en el modal de Chunior.
  operador = {
    usuario,
    nombre:        usuario,
    rol:           "OPERADOR",
    tipoOperador:  "OPERADOR",
    pc:            "",
    pcsDisponibles:[],
    requiereSeleccionPc:false
  };
  // Espejar en window: media docena de módulos (el chat, entre otros) leen window.operador
  // porque están dentro de IIFEs y no ven esta variable. Hasta ahora window.operador se
  // llenaba en UN solo lugar y solo cuando Chunior detectaba un cambio de turno, así que en
  // el caso normal quedaba vacío: el chat firmaba "panel" y 1.833 de 2.334 respuestas humanas
  // no se podían atribuir a nadie.
  try{ window.operador = operador; }catch(_e){}

  setBox("loginMsg",`<div class="alert-box">Chunior OK. Esperando selección de puesto...</div>`);
  // Disparar el flujo de Chunior post-login. _chuniorConfirmarPuesto
  // se encarga de setear pcOperativa, asegurar la oficina y finalizar el login.
  _checkPuestoPostLogin();
}

// Inyecta usuario/clave en la VENTANA de Chunior (separada, visible) y verifica si fue aceptado
async function validarLoginChunior(usuario, clave){
  if(!window.chunior || !window.chunior.exec) throw new Error('Ventana de Chunior no disponible (correr en Electron).');

  // 1) ¿Hay sesión activa? Buscar el botón "Cerrar sesión" (presente en TODAS las páginas internas de Chunior).
  //    Si existe → click → esperar a que aparezca el form de login.
  const huboLogout = await window.chunior.exec(
    '(function(){' +
    'var n=document.querySelectorAll("button,a,input[type=\'submit\']");' +
    'for(var i=0;i<n.length;i++){' +
    '  var t=((n[i].textContent||n[i].value||"")+"").trim().toLowerCase();' +
    '  if(t.indexOf("cerrar sesi")>=0||t.indexOf("logout")>=0){' +
    '    n[i].click();' +
    '    return true;' +
    '  }' +
    '}' +
    'return false;' +
    '})()'
  );

  if(huboLogout){
    // Tras logout, Chunior muestra una página intermedia con un link "Identificarse de nuevo".
    // Lo clickeamos para llegar al form de login. Después esperamos a #id_username.
    const t0 = Date.now();
    let yaClickeoIdentificar = false;
    while(Date.now() - t0 < 10000){
      await new Promise(function(r){ setTimeout(r, 300); });
      try {
        const estado = await window.chunior.exec(
          '(function(){' +
          'if(document.getElementById("id_username")) return "login";' +
          // Buscar "Identificarse de nuevo" (link o botón) y clickearlo
          'var n=document.querySelectorAll("a,button,input[type=\'submit\']");' +
          'for(var i=0;i<n.length;i++){' +
          '  var t=((n[i].textContent||n[i].value||"")+"").trim().toLowerCase();' +
          '  if(t.indexOf("identificarse")>=0 || t.indexOf("iniciar sesi")>=0){' +
          '    n[i].click(); return "click";' +
          '  }' +
          '}' +
          'return "wait";' +
          '})()'
        );
        if(estado === 'login') break;
        if(estado === 'click') yaClickeoIdentificar = true;
      } catch(e){}
    }
  } else {
    // No hay sesión activa y tampoco tenemos form de login a la vista → forzar carga del home
    const cur = await window.chunior.getUrl();
    const enLogin = await window.chunior.exec('(function(){return !!document.getElementById("id_username");})()').catch(function(){return false;});
    if(!enLogin && !cur.includes('/login/')) await window.chunior.navigate(CHUNIOR_HOME);
  }

  // 2) Inyectar usuario + clave en la misma pasada y submit
  const inyectado = await window.chunior.exec(
    '(function(){'
    + 'var u=document.getElementById("id_username");'
    + 'var p=document.getElementById("id_password");'
    + 'var b=document.querySelector("input[type=\'submit\'],button[type=\'submit\']");'
    + 'if(!u||!p||!b) return false;'
    + 'u.value='+JSON.stringify(usuario)+';'
    + 'p.value='+JSON.stringify(clave)+';'
    + 'u.dispatchEvent(new Event("input",{bubbles:true}));'
    + 'p.dispatchEvent(new Event("input",{bubbles:true}));'
    + 'b.click();'
    + 'return true;'
    + '})()'
  );
  if(!inyectado) throw new Error('No se encontró el formulario de login en Chunior.');

  // 3) Polling del DOM: el pt selector también está en /login/, por eso miramos el DOM, no la URL
  //    - aparece #id_pt → login OK, hay que elegir puesto
  //    - desaparece #id_username → login OK, sesión completa
  //    - aparece .errornote → clave mala, no esperar más
  //    - sigue #id_username sin error → todavía procesando
  const inicio = Date.now();
  while(Date.now() - inicio < 20000){
    await new Promise(function(r){ setTimeout(r, 400); });
    try {
      const state = await window.chunior.exec(
        '(function(){'
        + 'if(document.getElementById("id_pt")) return "pt";'
        + 'if(document.querySelector("p.errornote, .errornote")) return "error";'
        + 'if(!document.getElementById("id_username")) return "logged";'
        + 'return "login";'
        + '})()'
      );
      if(state === 'pt' || state === 'logged') return true;
      if(state === 'error') return false;
    } catch(e){}
  }
  return false;
}

// finalizarLogin se llama desde _chuniorConfirmarPuesto (ya con pcOperativa seteado).
// Ya no dispara _checkPuestoPostLogin (eso ya pasó antes en el flujo).
function finalizarLogin(guardar=true){
  if(guardar){
    localStorage.setItem("nodo_operador_lite",JSON.stringify(operador));
    localStorage.setItem("nodo_pc_operativa_lite",pcOperativa);
  }
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.body.classList.add("app-lista");
  try{ _updaterAnclar(); }catch(_e){}
  setBox("operadorInfo",`
    <b>${operador.nombre||operador.NOMBRE}</b><br>
    <span class="badge badge-blue">Rol: ${operador.rol||"OPERADOR"}</span>
    <span class="badge badge-ok">Oficina: ${pcOperativa}</span>
  `);
  _nodoListo = true;
  refrescarTodo(false);
  iniciarRealtimeSolicitudes();
  iniciarBroadcastSolicitudes();
  iniciarBroadcastChat();
  _panelRealtime().startPolling();
}

// Adaptador de los handlers existentes. El servicio posee canales, timers y lecturas.
let _realtimeService = null;
function _panelRealtime(){
  if(!_realtimeService) _realtimeService = NodoRealtime.create({
    client: supabaseClient,
    getOffice: () => pcOperativa,
    getAliases: () => typeof pcAliasesHist === 'function' ? pcAliasesHist() : [pcOperativa],
    hasOpenChat: () => !!((window.V154P && window.V154P.chatActual) || window.chatActualId || chatActualId),
    refresh: {
      requests: () => typeof cargarSolicitudesPortal === 'function' ? cargarSolicitudesPortal(true) : cargarSolicitudes(true),
      wallets: () => cargarBilleteras(false),
      chats: () => {
        // Durante el cambio de caminos, el reloj de la lista también trae las conversaciones del
        // canal nuevo. Sin await ni encadenado: si ese lado no contesta, la lista de siempre se
        // dibuja igual (Juan, 2/10).
        try{ if(window._chatCanalNuevo) window._chatCanalNuevo.cargar(); }catch(_e){}
        return typeof cargarChatsPortal === 'function' ? cargarChatsPortal(true) : cargarChats(true);
      },
      conversation: () => typeof cargarChatPortalActual === 'function' ? cargarChatPortalActual(true) : cargarChatActual(true)
    },
    // Devuelve una firma corta de cómo está la bandeja. Mientras no cambie, no se baja la lista.
    // Si la RPC no está (panel viejo contra base vieja) devuelve null y queda sólo el reloj de 60 s.
    senal: async () => {
      try{
        const r = await window.panelAPI.rpc('panel_bandeja_senal', { p_pc_codigo: pcOperativa || '' });
        if(!r || r.error) return null;
        let d = r.data;
        if(typeof d === 'string'){ try{ d = JSON.parse(d); }catch(_e){ return null; } }
        if(Array.isArray(d)) d = d[0];
        if(!d || d.ok !== true) return null;
        return String(d.abiertas) + '|' + String(d.ultima || '') + '|' + String(d.ultima_alta || '');
      }catch(_e){ return null; }
    },
    notify: message => toast(message),
    playSound: type => sonido(type)
  });
  return _realtimeService;
}
function iniciarRealtimeSolicitudes(){ _panelRealtime().subscribeRequests(); }
function iniciarBroadcastSolicitudes(){ _panelRealtime().subscribeRequestBroadcast(); }
function iniciarBroadcastChat(){ _panelRealtime().subscribeChatBroadcast(); }
function _rtEsMiOficina(pc){ return _panelRealtime().isMyOffice(pc); }
function detenerRealtime(){
  if(_realtimeService) _realtimeService.stop();
  _realtimeService = null;
}
window.addEventListener('beforeunload', detenerRealtime);

// Minimizar/restaurar la bandeja de chat (solo desktop). Persiste en localStorage.
// Minimizado: el chat se oculta y el main ocupa todo el ancho (mejor vista del historial).
// Se restaura tocando "Chat" en el menú.
window.nodoChatMin = function(min){
  try{
    if(min){ document.body.classList.add('chat-min'); localStorage.setItem('nodo_chat_min','1'); }
    else { document.body.classList.remove('chat-min'); localStorage.removeItem('nodo_chat_min'); }
  }catch(_e){}
};
try{ if(localStorage.getItem('nodo_chat_min')==='1') document.body.classList.add('chat-min'); }catch(_e){}

// ── Qué es la "dife" y qué hacer con ella ───────────────────────────────────
// El número solo no dice nada: el operador ve "-$ 3.462" y no sabe si tiene que hacer algo,
// si es grave, ni de dónde salió. Este cuadro lo explica en los términos de la operación.
window.explicarDiferenciaFichas = function(){
  const drex = (typeof _watchdog !== "undefined") ? _watchdog.drexFichas : null;
  const chu  = (typeof _watchdog !== "undefined") ? _watchdog.chuniorFichas : null;
  const hay  = (typeof drex === "number" && typeof chu === "number");
  const diff = hay ? (drex - chu) : 0;
  const abs  = Math.abs(diff);
  const hora = (typeof _watchdog !== "undefined" && _watchdog.lastCheck)
    ? new Date(_watchdog.lastCheck).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : null;

  // El signo es lo que dice QUÉ pasó, y es lo que nadie tiene memorizado.
  const _lado = diff > 0
    ? { t:'Sobran fichas en el casino', d:'Se cargaron fichas que en Chunior no están anotadas. Suele ser una carga hecha en el agente que no se llegó a registrar.' }
    : { t:'Faltan fichas en el casino',  d:'Hay movimientos anotados en Chunior que no se reflejan en el casino. Suele ser un retiro anotado dos veces, o una anotación de más.' };

  const filaCmp = function(k, v, color){
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #1e293b">'
      + '<span class="small" style="color:#8b949e">'+k+'</span>'
      + '<b style="'+(color?('color:'+color):'')+'">'+v+'</b></div>';
  };

  const cuerpo = !hay
    ? '<div class="alert-box">Todavía no hay una lectura de los dos saldos. Tocá <b>↻ Rechequear</b> y volvé.</div>'
    : (
        filaCmp('Casino (Drex)', money(drex))
      + filaCmp('Anotado (Chunior)', money(chu))
      + filaCmp('Diferencia', (diff>=0?'+':'−')+money(abs), Math.abs(diff)<=1 ? '#22c55e' : '#f59e0b')
      + (hora ? '<div class="small" style="color:#8b949e;margin-top:6px">Leído a las '+escapeHtml(hora)+'</div>' : '')
      + (Math.abs(diff) <= 1
          ? '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.4);color:#bbf7d0;font-size:12.5px">'
            + '<b>Está cuadrado.</b> Lo que hay en el casino y lo anotado en Chunior coinciden. No hay nada que hacer.</div>'
          : '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.45);color:#fde68a;font-size:12.5px;line-height:1.55">'
            + '<b>'+_lado.t+' por '+money(abs)+'.</b><br>'+_lado.d
            + '<div style="margin-top:8px;color:#e6edf3"><b>Qué hacer, en orden:</b></div>'
            + '<div style="margin-top:4px">1. <b>↻ Rechequear</b>. Si venís de operar recién, la diferencia puede ser de un movimiento que todavía no terminó de impactar.</div>'
            + '<div style="margin-top:3px">2. Si sigue, mirá el historial del turno buscando una operación por <b>'+money(abs)+'</b>: casi siempre la dife es UNA operación sola.</div>'
            + '<div style="margin-top:3px">3. Si aparece, corregila donde falte (<b>Reintentar</b> si no se anotó en Chunior, <b>Editar</b> si el monto quedó mal).</div>'
            + '<div style="margin-top:3px">4. Si no la encontrás, dejala anotada en el cierre de turno antes de irte. Una dife sin explicar que pasa de turno no la resuelve nadie.</div>'
            + '</div>')
      );

  abrirModal('📊 Diferencia de fichas', cuerpo, null, '');
  try{ const b=document.getElementById('modalSaveBtn'); if(b) b.style.display='none'; }catch(_e){}
};

function mostrarVista(vista){
  if(vista==="chat" && window.matchMedia && window.matchMedia("(min-width:1101px)").matches){
    try{ window.nodoChatMin && nodoChatMin(false); }catch(_e){} // tocar Chat restaura el panel si estaba minimizado
    document.querySelectorAll(".nav-btn").forEach(x=>x.classList.remove("active"));
    document.getElementById("navChat")?.classList.add("active");
    cargarChats(true);
    return;
  }
  ["Inicio","Solicitudes","Billeteras","Chat","Jugadores","Auto"].forEach(v=>{
    document.getElementById("view"+v)?.classList.add("hidden");
    document.getElementById("nav"+v)?.classList.remove("active");
  });
  const cap=vista.charAt(0).toUpperCase()+vista.slice(1);
  document.getElementById("view"+cap)?.classList.remove("hidden");
  document.getElementById("nav"+cap)?.classList.add("active");
  // El chat ocupa toda la altura de .main sin scroll externo
  const mainEl = document.querySelector('.main');
  if(mainEl) mainEl.classList.toggle('is-chat', vista === 'chat');
  if(vista==="solicitudes")renderSolicitudes();
  if(vista==="billeteras")cargarBilleteras();
  if(vista==="chat")cargarChats();
  if(vista==="jugadores")cargarJugadores();
  if(vista==="auto"){ verificarEstadoBackoffice(); try{ nodoCargarBackendAgentes(); }catch(_e){} }
  if(vista==="verificaciones")cargarVerificaciones();
  cerrarMenuMobile();
}

async function refrescarTodo(showToast=true){
  await cargarSolicitudes(false);
  await cargarBilleteras(false);
  await cargarChats(false);
  // Recargar historial para que el cross-ref operador/saldo_post esté disponible
  await cargarHistorial();
  renderInicio();
  if(showToast)toast("Panel actualizado","green");
}
async function cargarSolicitudes(silencioso=false){
  // SAFE: si el bridge Portal está disponible, no dejamos que la consulta legacy
  // pinte/limpie el inicio. Delegamos a la fuente real del portal.
  if(window.V154P && window.V154P.portalBridgeReady && typeof window.v154pCargarSolicitudes === "function"){
    return await window.v154pCargarSolicitudes(silencioso);
  }

  const r = await cargarSolicitudesSupabase();

  if(!r.ok){
    toast(r.error || "Error solicitudes Supabase","red");
    return;
  }

  solicitudes = (r.solicitudes || []);

  renderSolicitudes();
  renderInicio();
  verificarSolicitudes(silencioso);
}
async function cargarBilleteras(render=true){
  let rows = [];
  let errorFinal = null;

  function _walletRowsFromRpcData(data){
    try{
      if(typeof data === 'string') data = JSON.parse(data);
    }catch(_e){}
    if(Array.isArray(data)) return data;
    if(data && Array.isArray(data.rows)) return data.rows;
    if(data && data.data && Array.isArray(data.data.rows)) return data.data.rows;
    return [];
  }

  function _normCode(x){
    return String(x||'').trim().toUpperCase().replace(/[\s_\-]+/g,'');
  }

  function _candidateCodes(){
    let out = [];
    const push = v => { v=String(v||'').trim(); if(v && !out.includes(v)) out.push(v); };
    push(pcOperativa);
    push(window.__nodoOficinaDetectada);
    push(window.__nodoPuestoDetectado);
    try{ push(localStorage.getItem('nodo_oficina_id')); }catch(_e){}
    try{ push(localStorage.getItem('nodo_puesto_chunior')); }catch(_e){}

    // Compatibilidad histórica de P1: Chunior muestra XGENERALENUSO / XPLATA y las billeteras
    // viejas quedaron en P1 con oficina_id XPLATA. PERO este fallback SOLO debe aplicar si ESTA
    // oficina ES P1. Antes se agregaba SIEMPRE → una oficina NUEVA (P6) sin billeteras propias
    // cargaba las de P1 (mostraba billeteras ajenas y el sync nunca creaba las suyas → _nuevas vacío).
    if(_esOficinaP1(pcOperativa)){
      push('XGENERALENUSO');
      push('XPLATA');
      push('P1');
    }
    return out;
  }
  // ¿Esta oficina es la histórica P1? (única que debe heredar el fallback XPLATA/XGENERALENUSO/P1)
  function _esOficinaP1(pc){
    const c = String(pc||'').trim().toUpperCase().replace(/[\s_\-]+/g,'');
    return c==='' || ['P1','PC1','XGENERALENUSO','XGENERAL','GENERAL','XPLATA','OFI_1'].includes(c);
  }

  // 1) RPC oficial. Puede devolver {rows:[...]} o string JSON, según cache/API.
  const candidates = _candidateCodes();
  for(const code of candidates){
    if(rows.length) break;
    try{
      const r = await supabaseClient.rpc('panel_nodo_list_billeteras',{
        p_pc_codigo: code,
        p_landing_pc_codigo: code
      });
      if(!r.error){
        rows = _walletRowsFromRpcData(r.data);
      }else{
        errorFinal = r.error;
      }
    }catch(e){ errorFinal = e; }
  }

  // 2) Fallback directo por pc_codigo/oficina_id. No depende de la RPC.
  if(!rows.length){
    try{
      const codes = candidates.map(_normCode).filter(Boolean);
      const orParts = [];
      codes.forEach(c=>{
        if(c === 'XGENERALENUSO' || c === 'XPLATA' || c === 'P1'){
          // abajo agregamos condiciones concretas no normalizadas
        }
      });
      // Mismo criterio que _candidateCodes: el OR con P1/XPLATA/XGENERALENUSO SOLO si esta oficina es P1.
      const _orFiltro = _esOficinaP1(pcOperativa)
        ? 'pc_codigo.eq.'+(pcOperativa||'')+',pc_codigo.eq.P1,oficina_id.eq.XPLATA,oficina_id.eq.XGENERALENUSO'
        : 'pc_codigo.eq.'+(pcOperativa||'');
      const r = await supabaseClient
        .from('billeteras')
        .select('*')
        .or(_orFiltro)
        .order('seleccionada_manual',{ascending:false})
        .order('orden',{ascending:true})
        .order('nombre_visible',{ascending:true});
      if(!r.error) rows = r.data || [];
      else errorFinal = r.error;
    }catch(e){ errorFinal = e; }
  }

  // 3) Fallback por UID detectados en Chunior.
  if(!rows.length){
    let uids = [];
    try{ uids = JSON.parse(localStorage.getItem('nodo_chunior_wallet_uids') || '[]'); }catch(_e){ uids=[]; }
    if(Array.isArray(window.__nodoChuniorWalletUids) && window.__nodoChuniorWalletUids.length){
      uids = window.__nodoChuniorWalletUids;
    }
    uids = Array.from(new Set((uids||[]).map(String).filter(Boolean)));
    if(uids.length){
      // Los UID salen de la ventana de Chunior y la MISMA wallet puede existir en varias
      // oficinas. Sin filtrar por pc_codigo, este fallback traia billeteras ajenas y las
      // mezclaba con las propias: en P4 aparecia AVILA MP, que es de P2.
      let qUid = supabaseClient
        .from('billeteras')
        .select('*')
        .in('chunior_uid', uids);
      if(pcOperativa) qUid = qUid.eq('pc_codigo', pcOperativa);
      const rUid = await qUid
        .order('seleccionada_manual',{ascending:false})
        .order('orden',{ascending:true})
        .order('nombre_visible',{ascending:true});
      if(!rUid.error) rows = rUid.data || [];
      else errorFinal = rUid.error;
    }
  }

  if(!rows.length && errorFinal){ console.error('Error billeteras:', errorFinal); }

  const saldoByUid = window.__nodoChuniorWalletSaldoByUid || {};
  let nombreByUid = window.__nodoChuniorWalletNombreByUid || {};
  try{
    if(!Object.keys(nombreByUid||{}).length){
      nombreByUid = JSON.parse(localStorage.getItem('nodo_chunior_wallet_nombres') || '{}');
    }
  }catch(_e){ nombreByUid = {}; }
  // Red final: venga de donde venga la fila, si es de OTRA oficina no entra. Los tres
  // caminos de carga (RPC, fallback por pc_codigo, fallback por chunior_uid) pueden traer
  // filas ajenas, y una sola alcanza para que getBilleraLanding devuelva la billetera
  // equivocada y se le ajuste el saldo a otra oficina.
  const _pcAhora = String(pcOperativa||'').trim().toUpperCase();
  let _descartadas = 0;
  billeteras=(rows||[])
    .filter(function(b){
      const activa = (b.activa === true || String(b.activa).toLowerCase()==='true' || String(b.activa).toUpperCase()==='SI');
      const estado = normalizar(b.estado||'ACTIVA');
      if(!(activa && estado !== 'FUSIONADA')) return false;
      const pcBil = String(b.pc_codigo||'').trim().toUpperCase();
      if(_pcAhora && pcBil && pcBil !== _pcAhora){ _descartadas++; return false; }
      return true;
    })
    .map(b=>{
      const uid = b.chunior_uid || '';
      const saldo = (uid && Object.prototype.hasOwnProperty.call(saldoByUid, String(uid))) ? Number(saldoByUid[String(uid)]||0) : Number(b.saldo||0);
      return {
        ID_BILLETERA:b.id,
        NOMBRE_VISIBLE:b.nombre_visible,
        NOMBRE_CHUNIOR:(uid && nombreByUid[String(uid)]) ? nombreByUid[String(uid)] : (b.nombre_chunior || b.nombre_visible),
        TIPO:b.tipo || b.banco || (uid ? 'Chunior' : ''),
        BANCO:b.banco || '',
        PC:b.pc_codigo,
        OFICINA_ID:b.oficina_id || '',
        ACTIVA:(b.activa===true || String(b.activa).toLowerCase()==='true')?'SI':'NO',
        SELECCIONADA_MANUAL:(b.seleccionada_manual===true || String(b.seleccionada_manual).toLowerCase()==='true')?'SI':'NO',
        SALDO:saldo,
        CBU_ALIAS:b.cbu_alias || b.alias || b.cbu || '',
        ALIAS:b.alias || '',
        CBU:b.cbu || '',
        TITULAR:b.titular||'',
        CHUNIOR_UID:uid,
        ESTADO:b.estado||''
      };
    });

  if(_descartadas){
    console.warn('[billeteras] se descartaron '+_descartadas+' billeteras de otra oficina (esta es '+_pcAhora+')');
  }

  // Dedup por CHUNIOR_UID: la misma wallet puede venir repetida (multi-oficina / sync).
  // Conserva la primera ocurrencia (la EN PORTAL queda primera por el orden de la query).
  (function(){
    const seen=new Set(); const out=[];
    for(const b of billeteras){
      const k=String(b.CHUNIOR_UID||'').trim();
      if(k){ if(seen.has(k)) continue; seen.add(k); }
      out.push(b);
    }
    billeteras=out;
  })();

  if(render)renderBilleteras();
  renderInicio();
}

async function cargarChats(silencioso=false){
  // ⛔ INERTE. Consultaba la tabla "chats", que NO EXISTE en la base: cada llamada
  // terminaba en un 404 que el `if(error) return` se tragaba en silencio, así que
  // renderChatList/renderInicio de acá abajo nunca corrían.
  //
  // Con el temporizador de 4,5 s eran ~19.200 pedidos fallidos por día en cada PC —
  // unos 134.000 diarios entre las siete— sin que nadie lo notara.
  //
  // El chat de verdad son las solicitudes tipo SOPORTE (metadata.chat_thread), y las
  // trae otro camino. renderInicio() tiene once llamadores más, así que la pantalla
  // se refresca igual. Se deja la función (hay ~12 callers) y se saca el temporizador.
  return;
  /* eslint-disable no-unreachable */
  const {data,error}=await supabaseClient
    .from("chats")
    .select("*")
    .eq("pc_codigo",pcOperativa)
    .order("fecha_ultimo",{ascending:false});

  if(error){return}

  chats=(data||[]).map(c=>({
    ID_CHAT:c.id,
    USUARIO:c.usuario,
    NOMBRE_COMPLETO:c.nombre_completo||"",
    TELEFONO:c.telefono||"",
    SOLICITUD_ID:c.solicitud_id||"",
    SIN_LEER:c.sin_leer||0,
    ULTIMO_MENSAJE:c.ultimo_mensaje||"",
    FECHA_ULTIMO:c.fecha_ultimo||c.created_at,
    FECHA:c.fecha_ultimo||c.created_at
  }));

  renderChatList();
  renderInicio();
  verificarChats(silencioso);
}
function renderInicio(){
  const fuentePortal = (window.V154P && Array.isArray(window.V154P.solicitudes) && window.V154P.solicitudes.length)
    ? window.V154P.solicitudes
    : solicitudes;
  const portalPendientes = fuentePortal.filter(function(s){ return esPendiente(s) && String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='SOPORTE'; });
  const pendientes = portalPendientes;
  const retiros=pendientes.filter(s=>normalizar(s.TIPO_SOLICITUD||s.TIPO)==="RETIRO");
  // "Sin leer": usar la cuenta ACTUAL del chat nuevo (tickets en espera). El viejo chats[].SIN_LEER
  // era del sistema legacy y quedaba desfasado (mostraba un número viejo que no coincidía con la lista).
  const unread=(typeof window.__wq2EnEspera==='number')?window.__wq2EnEspera:chats.reduce((a,c)=>a+Number(c.SIN_LEER||0),0);
  const bil=billeteras.find(b=>normalizar(b.SELECCIONADA_MANUAL)==="SI") || billeteras.find(b=>normalizar(b.ACTIVA)==="SI") || {};
  setBox("statPendientes",pendientes.length);
  setBox("statRetiros","Retiros: "+retiros.length);
  setBox("statChats",unread);
  setBox("statBilletera",bil.NOMBRE_VISIBLE||bil.BILLETERA_NOMBRE||"-");
  setBox("statBilleteraTipo",bil.TIPO?(bil.TIPO+" · "+(bil.PC||pcOperativa)):"-");
  setBox("alertas",
    (pendientes.length?'<div class="alert-box">🔔 Hay '+pendientes.length+' solicitud/es pendiente/s.</div>':"")+
    (unread?'<div class="alert-box">💬 Hay '+unread+' mensaje/s de chat sin leer.</div>':"")
  );
  const inicioLista = pendientes.length ? pendientes.slice(0,8) : fuentePortal.slice(0,8);
  // SAFE: si el bridge Portal V15.4 está activo, la caja de inicio la renderiza
  // una sola función dedicada para evitar parpadeos entre render legacy y portal.
  const portalOwner = !!(window.V154P && window.V154P.portalBridgeReady);
  if(!portalOwner){
    setBox("tablaSolicitudesInicio", inicioLista.length
      ? tablaSolicitudesHTML(inicioLista)
      : '<div class="alert-box">No hay solicitudes Portal para mostrar.</div>');
  }
  renderFichasInicio();
  renderBillerasInicio();
  poblarManualBilletera();
  if(!_historialCargado) cargarHistorial();
}
// ── Estado de fichas en Inicio ────────────────────────────────────────────────
function renderFichasInicio(extraEstado, extraTexto){
  const card = document.getElementById("statFichasCard");
  const drexEl = document.getElementById("statDrexFichas");
  const chuEl = document.getElementById("statChuniorFichas");
  const diffEl = document.getElementById("statDiffFichas");
  const estadoEl = document.getElementById("statFichasEstado");
  if(!card || !drexEl || !chuEl || !diffEl || !estadoEl) return;
  const drex = (typeof _watchdog !== "undefined") ? _watchdog.drexFichas : null;
  const chu  = (typeof _watchdog !== "undefined") ? _watchdog.chuniorFichas : null;
  const fmt = v => (typeof v === "number" && !isNaN(v)) ? money(v) : "—";
  drexEl.textContent = fmt(drex);
  chuEl.textContent = fmt(chu);
  card.classList.remove("ok","alerta");
  diffEl.classList.remove("ok","alerta");
  if(typeof drex === "number" && typeof chu === "number"){
    const diff = drex - chu;
    const ok = Math.abs(diff) <= 1;
    diffEl.textContent = (diff >= 0 ? "+" : "−") + money(Math.abs(diff));
    diffEl.classList.add(ok ? "ok" : "alerta");
    card.classList.add(ok ? "ok" : "alerta");
    // SIEMPRE mostrar de CUÁNDO es la lectura: sin la hora, una comparación vieja parece una
    // diferencia actual y el operador desconfía del chequeo entero (portado de NexoBetaChan).
    const _horaLect = (typeof _watchdog !== "undefined" && _watchdog.lastCheck)
      ? new Date(_watchdog.lastCheck).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}) : null;
    estadoEl.textContent = (extraTexto || (ok ? "Sin diferencia" : "Diferencia detectada"))
      + (_horaLect ? " · leído "+_horaLect : "");
    // El botón de explicación aparece SOLO cuando hay algo que explicar. Un botón que está
    // siempre se vuelve parte del decorado y nadie lo toca el día que hace falta.
    try{
      const _bi = document.getElementById("btnInfoDife");
      if(_bi) _bi.style.display = ok ? "none" : "";
    }catch(_e){}

  }else{
    // Sin lectura de los dos saldos no hay diferencia que explicar.
    try{ const _bi = document.getElementById("btnInfoDife"); if(_bi) _bi.style.display = "none"; }catch(_e){}
    diffEl.textContent = "—";
    estadoEl.textContent = extraTexto || "Esperando lectura de saldos";
  }
  if(extraEstado === "alerta") card.classList.add("alerta");
  if(extraEstado === "ok") card.classList.add("ok");
}

// ── Billeteras en Inicio ──────────────────────────────────────────────────────
function renderBillerasInicio(){
  const el = document.getElementById("billerasInicioGrid");
  if(!el) return;
  const lista = (billeteras||[]).filter(function(b){
    return normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA';
  });
  if(!lista.length){
    el.innerHTML = '<div class="small" style="color:var(--muted);padding:8px">Sin billeteras operativas para esta oficina.</div>';
    renderEstadoLanding();
    return;
  }
  const difsMap={}; try{ (window.__bilDifs||[]).forEach(function(d){ difsMap[String(d.id)]=d; }); }catch(_e){}
  // ── Espejo de Chunior ────────────────────────────────────────────────────────────────────
  // Chunior es la verdad del saldo, así que el Inicio muestra su número y su orden, no lo que
  // quedó guardado en la base (que se atrasa) ni el alfabético del RPC. Los dos mapas los llena
  // la lectura del breadcrumb (sincronizarBilleterasChunior + _leerSaldosChuniorPasivo).
  const _saldosCh = window.__nodoChuniorWalletSaldoByUid || {};
  const _ordenCh  = window.__nodoChuniorOrdenUids || [];
  if(_ordenCh.length){
    const _pos = {}; _ordenCh.forEach(function(u,i){ _pos[String(u)] = i; });
    lista.sort(function(a,b){
      const pa=_pos[String(a.CHUNIOR_UID||'')], pb=_pos[String(b.CHUNIOR_UID||'')];
      if(pa===undefined && pb===undefined) return 0;
      if(pa===undefined) return 1;          // las que Chunior no lista van al final
      if(pb===undefined) return -1;
      return pa-pb;
    });
  }
  el.innerHTML = lista.map(function(b){
    const enLanding = normalizar(b.SELECCIONADA_MANUAL)==="SI";
    const _uid = String(b.CHUNIOR_UID||'');
    const saldo = (_uid && _saldosCh[_uid]!==undefined) ? Number(_saldosCh[_uid]) : Number(b.SALDO||0);
    const neg = saldo < 0;
    const tipo = b.TIPO || b.BANCO || (b.CHUNIOR_UID ? 'Chunior' : '—');
    const subt = (enLanding ? 'EN PORTAL · ' : '') + tipo;
    const nombreMostrar = b.NOMBRE_CHUNIOR || b.NOMBRE_VISIBLE || b.BILLETERA_NOMBRE || '—';
    const dif = difsMap[String(b.ID_BILLETERA)];
    const difHtml = dif ? '<div class="bil-mini-dif">⚠ dif '+(dif.diff>0?'+':'')+money(dif.diff)+'</div>' : '';
    const difTitle = dif ? ' · ⚠ Chunior '+money(dif.actual)+' vs esperado '+money(dif.esperado)+' (dif '+(dif.diff>0?'+':'')+money(dif.diff)+') — ¿faltó anotar una operación?' : '';
    return '<div class="bil-mini-card'+(enLanding?' en-landing':'')+(dif?' bil-mini-dif-on':'')+(neg?' bil-card-neg':'')+'" title="'+escapeHtml(nombreMostrar+' · '+money(saldo)+difTitle)+'">'+
      (enLanding?'<span class="bil-landing-badge">LANDING</span>':'')+
      '<div class="bil-mini-nombre">'+escapeHtml(nombreMostrar)+'</div>'+
      '<div class="bil-mini-tipo">'+escapeHtml(subt)+'</div>'+
      '<div class="bil-mini-saldo'+(neg?' bil-neg':'')+'">'+money(saldo)+'</div>'+
      difHtml+
      '</div>';
  }).join('');
  renderEstadoLanding();
}

function poblarManualBilletera(){
  const sel = document.getElementById("manualBilletera");
  if(!sel) return;
  const cur = sel.value;
  const bil = getBilleraLanding();
  const defaultId = cur || (bil ? bil.ID_BILLETERA : '');
  const lista = (billeteras||[]).filter(function(b){
    return normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA';
  });
  sel.innerHTML = lista.map(function(b){
    const selected = String(b.ID_BILLETERA)===String(defaultId);
    const tipo = b.TIPO ? ' · '+b.TIPO : '';
    const nombreMostrar = b.NOMBRE_CHUNIOR || b.NOMBRE_VISIBLE || '—';
    return '<option value="'+b.ID_BILLETERA+'"'+(selected?' selected':'')+'>'+escapeHtml(nombreMostrar)+' — '+money(b.SALDO||0)+escapeHtml(tipo)+'</option>';
  }).join('') || '<option value="">Sin billeteras</option>';
}

// ── Solo consultar saldo ──────────────────────────────────────────────────────
async function soloConsultarUsuario(){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const usuario = (document.getElementById("manualUsuario")?.value||"").trim();
  if(!usuario){ toast("Ingresá un usuario para consultar.","red"); return; }
  const res = document.getElementById("manualResultado");
  if(res) res.innerHTML = '<div class="alert-box">Consultando...</div>';
  try {
    await window.ctrlElectron.openAgentWindow();
    const busqueda = await callDrex("buscarUsuario", usuario);
    if(!busqueda.exists){
      if(res) res.innerHTML = '<div class="err-box">❌ <b>'+escapeHtml(usuario)+'</b> no existe en el casino.</div>';
      return;
    }
    const saldo = busqueda.balance?.raw || "sin datos";
    if(res) res.innerHTML = '<div class="ok-box">✅ <b>'+escapeHtml(usuario)+'</b> — Saldo: <b>'+escapeHtml(saldo)+'</b></div>';
    toast(usuario+": "+saldo, "green");
    await registrarEnHistorial({usuario, tipo:'CONSULTA', monto:0, origen:'MANUAL', estado:'OK', notas:saldo});
  } catch(e) {
    const _m = (e && (e.message||String(e))) || 'sin detalle';
    const _esTimeout = /timeout|tard[oó] demasiado|timed out/i.test(_m);
    const _esIpc = /invoking remote method/i.test(_m);
    const _txt = _esTimeout ? '⏱️ La consulta tardó demasiado (el casino puede estar lento). Reintentá.'
      : _esIpc ? '⚠️ No se pudo consultar (la ventana de agentes no respondió). Revisá que esté abierta y reintentá.'
      : 'Error: '+escapeHtml(_m);
    if(res) res.innerHTML = '<div class="err-box">'+_txt+'</div>';
    toast(_esTimeout?'Consulta lenta · reintentá':'Error al consultar.','red');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ⛔ FLUJO BLINDADO — NO MODIFICAR ⛔
// Esta función y su cadena (buscarUsuario, applyAmount, registrarCargaEnChunior,
// navigateAgentTo, _leerBalancesEnModalDeposito) son el CORE de carga/retiro que
// funciona 100%. Probado y estable (tag git: estable-flujo-carga).
// Para features nuevas: agregar funciones APARTE y llamarlas desde acá si hace
// falta, pero NO reescribir la lógica de este flujo. Si lo rompés, volvé con:
//   git checkout estable-flujo-carga -- "NODO · OPERATIVO LITE.htm" agent-preload.js main.js
// ══════════════════════════════════════════════════════════════════════════════
// ── Candado GLOBAL de automatización en Agentes ───────────────────────────────
// _operacionManualEnCurso, _portalSolicitudOperacionEnCurso, etc. cada uno solo evita
// re-entrar a SU PROPIA función (anti-doble-click) — pero no se enteran entre sí. Eso
// dejaba pasar una carga MANUAL y una aprobación de PORTAL corriendo a la vez contra la
// MISMA ventana de Agentes → colisión real (una se aplica, la otra falla/rechaza, mismo
// usuario, casi el mismo segundo — visto en producción 2026-07-03). Este candado es
// compartido por todos los flujos que tocan la ventana de Agentes.
window._drexGlobalBusy = false;
window._drexGlobalBusyMotivo = null;
window._drexGlobalBusyDesde = 0;
// Un candado sin vencimiento se queda tomado PARA SIEMPRE si la operación que lo tomó muere sin
// soltarlo (una excepción, la ventana cerrada, un preload colgado). Y el panel queda contestando
// "hay otra operación corriendo" sin que haya ninguna — sin forma de salir. Pasó.
// Ahora el candado se anota CUÁNDO se tomó y se suelta solo si quedó viejo.
const _DREX_LOCK_MAX_MS = 150000;   // 2,5 min · más que la tarea más larga (120s de la cola)
function _drexGlobalLock(motivo){
  if(window._drexGlobalBusy){
    const held = Date.now() - (window._drexGlobalBusyDesde||0);
    if(held > _DREX_LOCK_MAX_MS){
      // Candado vencido: lo tomó algo que nunca lo devolvió. Se libera y se avisa, en vez de
      // dejar el panel trabado esperando a alguien que ya no está.
      console.warn('[lock] candado vencido tras '+Math.round(held/1000)+'s ("'+(window._drexGlobalBusyMotivo||'?')+'") → liberado solo');
      try{ toast('🔓 Se destrabó solo: "'+(window._drexGlobalBusyMotivo||'una operación')+'" quedó colgada hace '+Math.round(held/1000)+'s','yellow'); }catch(_e){}
    } else {
      return false;
    }
  }
  window._drexGlobalBusy = true;
  window._drexGlobalBusyMotivo = motivo || '';
  window._drexGlobalBusyDesde = Date.now();
  return true;
}
function _drexGlobalUnlock(){ window._drexGlobalBusy = false; window._drexGlobalBusyMotivo = null; window._drexGlobalBusyDesde = 0; }
// Qué está pasando, en una línea. Para el badge y para poder preguntarlo desde la consola.
// Badge en vivo: qué está haciendo el agente, hace cuánto, y el botón para soltarlo. Aparece solo
// si está tomado más de 2s (para no parpadear en cada operación corta).
function _agentesBadgePintar(){
  try{
    let el = document.getElementById('agentesBadge');
    if(!el){
      el = document.createElement('div'); el.id='agentesBadge';
      el.innerHTML = '<span>⚙️</span><span class="ab-txt"></span><span class="ab-seg"></span>'
        + '<button type="button" onclick="liberarLockAgentes()" title="Soltar el agente a la fuerza">Destrabar</button>';
      document.body.appendChild(el);
    }
    const b = window._drexGlobalBusy;
    const seg = b ? Math.round((Date.now()-(window._drexGlobalBusyDesde||0))/1000) : 0;
    if(!b || seg < 2){ el.style.display='none'; return; }
    const q = (window._drexCola && window._drexCola.pendientes) || 0;
    const nom = (window._drexCola && window._drexCola.activo && window._drexCola.activo.nombre) || window._drexGlobalBusyMotivo || 'operación';
    el.querySelector('.ab-txt').textContent = nom + (q>1 ? (' · '+(q-1)+' en cola') : '');
    el.querySelector('.ab-seg').textContent = seg+'s';
    el.classList.toggle('viejo', seg > 45);
    el.style.display='flex';
  }catch(_e){}
}
try{ setInterval(_agentesBadgePintar, 1000); }catch(_e){}

window.estadoAgentes = function(){
  const b = window._drexGlobalBusy;
  const seg = b ? Math.round((Date.now()-(window._drexGlobalBusyDesde||0))/1000) : 0;
  const q = (window._drexCola && window._drexCola.pendientes) || 0;
  const info = { ocupado:b, motivo:window._drexGlobalBusyMotivo||null, segundos:seg,
                 enCola:q, tareaActual:(window._drexCola && window._drexCola.activo && window._drexCola.activo.nombre)||null,
                 sinSesion:!!window._drexSinSesion };
  console.log('[agentes]', info);
  return info;
};

// ── Traza de proceso de carga/retiro (visibilidad + cancelar) ──────────────────
// Registra cada paso de una operación con su tiempo, para: (1) mostrarlo EN VIVO en una tira
// visible → si se traba, se ve en qué paso quedó; (2) persistirlo (localStorage) para el botón
// ℹ️ del historial; (3) permitir CANCELAR y liberar el panel. NO toca el motor de carga — solo
// observa y ofrece la salida de emergencia. Todo defensivo (try/catch) para no romper el flujo.
window._traza = { pasos: [], t0: 0, cancelada: false, fin: '', titulo: '' };
function _trazaInit(titulo){
  window._traza = { pasos: [], t0: Date.now(), cancelada: false, fin: '', titulo: titulo||'Proceso' };
  _trazaRender();
}
function _trazaPaso(msg, estado){ // estado: '' en curso | 'ok' | 'err' | 'warn'
  try{
    const seg = window._traza.t0 ? ((Date.now()-window._traza.t0)/1000).toFixed(1) : '0.0';
    window._traza.pasos.push({ t: seg, msg: String(msg||''), estado: estado||'' });
    _trazaRender();
  }catch(_e){}
}
function _trazaFin(estadoFinal, histId){
  try{
    window._traza.fin = estadoFinal||'';
    _trazaRender();
    if(histId){
      const data = { titulo:window._traza.titulo, pasos:window._traza.pasos, fin:estadoFinal||'', ts:Date.now() };
      localStorage.setItem('nodo_traza_hist_'+histId, JSON.stringify(data));
      const idx = JSON.parse(localStorage.getItem('nodo_traza_idx')||'[]');
      idx.push(String(histId));
      while(idx.length>300){ const v=idx.shift(); try{localStorage.removeItem('nodo_traza_hist_'+v);}catch(_e){} }
      localStorage.setItem('nodo_traza_idx', JSON.stringify(idx));
    }
  }catch(_e){}
  setTimeout(_trazaOcultar, estadoFinal==='ok'?3000:12000);
}
function _trazaCancelar(){
  window._traza.cancelada = true;
  _trazaPaso('⛔ Cancelado por el operador · verificá en el casino si la operación llegó a aplicarse', 'warn');
}
function _trazaEl(){
  let el = document.getElementById('trazaStrip');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'trazaStrip';
  // Esquina de abajo a la izquierda, apoyada sobre el badge de Agentes. Antes iba centrada
  // (left:50% + translateX): quedaba flotando en el MEDIO de la pantalla, tapando la tabla y
  // montándose a la barra de desplazamiento. Va a la izquierda a propósito — de ese lado no hay
  // scrollbar ni panel de chat, así que se ve igual con el chat abierto o cerrado.
  el.style.cssText = 'position:fixed;bottom:52px;left:84px;right:auto;transform:none;z-index:9998;'
    + 'width:max-content;max-width:min(460px,calc(100vw - 110px));background:#0e1420;'
    + 'border:1px solid #2a3548;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.5);'
    + 'padding:12px 14px;font-size:12px;color:#c8d2e0;display:none';
  document.body.appendChild(el);
  return el;
}
function _trazaRender(){
  try{
    const el = _trazaEl();
    const pasos = window._traza.pasos||[];
    if(!pasos.length){ el.style.display='none'; return; }
    const ico = e => e==='ok'?'✅':e==='err'?'❌':e==='warn'?'⚠️':'⏳';
    const filas = pasos.map((p,i)=>{
      const ultimo = i===pasos.length-1 && !window._traza.fin;
      return '<div style="display:flex;gap:8px;padding:2px 0;'+(ultimo&&!p.estado?'color:#fde68a;font-weight:700':'')+'">'
        + '<span style="color:#6b7688;min-width:40px">+'+p.t+'s</span>'
        + '<span>'+ico(p.estado)+' '+escapeHtml(p.msg)+'</span></div>';
    }).join('');
    const enCurso = !window._traza.fin && !window._traza.cancelada;
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px">'
      + '<b style="color:#7cc4ff">'+escapeHtml(window._traza.titulo||'Proceso')+'</b>'
      + (enCurso ? '<button onclick="_trazaCancelar()" style="background:#7f1d1d;color:#fca5a5;border:0;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">⛔ Cancelar</button>'
                 : '<button onclick="_trazaOcultar()" style="background:#374151;color:#cbd5e1;border:0;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer">Cerrar</button>')
      + '</div>' + filas;
    el.style.display = 'block';
  }catch(_e){}
}
function _trazaOcultar(){ const el=document.getElementById('trazaStrip'); if(el) el.style.display='none'; }
// Botón ℹ️ del historial: muestra el paso a paso guardado de esa operación.
function verTrazaHistorial(histId){
  let data = null;
  try{ data = JSON.parse(localStorage.getItem('nodo_traza_hist_'+histId)||'null'); }catch(_e){}
  if(!data || !data.pasos || !data.pasos.length){
    if(typeof abrirModal==='function') abrirModal('Detalle del proceso', '<div class="alert-box">No hay traza guardada para esta operación.<br><span class="small">Solo se guarda en la PC donde se ejecutó la carga, y de las últimas ~300 operaciones.</span></div>', null, 'Cerrar');
    return;
  }
  const ico = e => e==='ok'?'✅':e==='err'?'❌':e==='warn'?'⚠️':'•';
  const filas = data.pasos.map(p=>'<div style="display:flex;gap:10px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="color:#6b7688;min-width:48px">+'+p.t+'s</span><span>'+ico(p.estado)+' '+escapeHtml(p.msg)+'</span></div>').join('');
  const cuando = data.ts ? new Date(data.ts).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}) : '';
  if(typeof abrirModal==='function') abrirModal('🔎 '+(data.titulo||'Proceso'), '<div style="font-size:12px;color:#94a3b8;margin-bottom:8px">'+escapeHtml(cuando)+'</div><div style="max-height:60vh;overflow:auto;font-size:13px">'+filas+'</div>', null, 'Cerrar');
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// DETALLE DE ERROR — por qué falló, con todo lo que se sabía en ese momento.
// Antes un error era una fila roja con ❌ y nada más: el motivo vivía en `notas`, y el render
// SÓLO mostraba `notas` para CONSULTA y RESET_CLAVE. Justo en CARGA y RETIRO —las que mueven
// plata— el operador no veía ni una palabra de por qué falló, y para reconstruir el caso había
// que estar sentado en la PC que operó (la traza es local).
// Ahora cada fallo estampa un contexto estructurado DENTRO de `notas`, con etiqueta [ERR]{...}
// (el mismo truco que ya usa [CHUNIOR_OK_SIN_N]). Va ahí y no en una columna nueva a propósito:
// historial_ops es una tabla compartida por las 9 oficinas y no se le agrega una columna para
// esto. Como viaja en la fila, el detalle se ve desde CUALQUIER PC, no sólo desde la que operó.
// ══════════════════════════════════════════════════════════════════════════════════════════
const _ERR_MOTIVOS = {
  USUARIO_NO_ENCONTRADO: {t:'Usuario inexistente',      plata:false, d:'Agentes no encontró ese usuario. No se tocó plata.'},
  SALDO_INSUFICIENTE:    {t:'Saldo insuficiente',       plata:false, d:'El jugador no tenía fichas suficientes para el retiro pedido.'},
  CANCELADO:             {t:'Cancelado por el operador',plata:false, d:'Se frenó antes de aplicar. No se tocó plata.'},
  SESION_CAIDA:          {t:'Sesión caída',             plata:true,  d:'La sesión de Agentes se cayó durante la operación. NO está confirmado si llegó a aplicarse — verificá en el casino antes de reintentar.'},
  ERROR_PAGINA:          {t:'Error de página',          plata:true,  d:'Agentes devolvió un error de página (403/CDN). NO está confirmado si llegó a aplicarse — verificá en el casino antes de reintentar.'},
  RECHAZO_CASINO:        {t:'Rechazado por el casino',  plata:false, d:'Agentes no dijo "Operación correcta". No se anota en Chunior.'},
  NO_APLICO:             {t:'No se pudo aplicar',       plata:true,  d:'Agentes no aplicó la operación. Verificá en el casino.'},
  EXCEPCION:             {t:'Error inesperado',         plata:true,  d:'Excepción de JavaScript en el panel. El detalle técnico está abajo.'}
};

// Arma el contexto del fallo y devuelve el texto para `notas`: humano + etiqueta [ERR].
function _errNotas(motivo, humano, extra){
  const ctx = Object.assign({ m: motivo }, extra || {});
  try{
    if(window._traza && window._traza.t0) ctx.ms = Date.now() - window._traza.t0;
    // Los últimos pasos viajan EN la fila: la traza completa sólo vive en la PC que operó, así
    // que si el error se mira desde otra máquina esto es lo único que queda del proceso.
    if(window._traza && window._traza.pasos && window._traza.pasos.length){
      ctx.pasos = window._traza.pasos.slice(-6).map(function(p){
        return p.t+'s '+(p.estado==='err'?'✗ ':p.estado==='warn'?'! ':'')+String(p.msg||'');
      });
    }
  }catch(_e){}
  try{ if(typeof pcOperativa!=='undefined' && pcOperativa) ctx.pc = String(pcOperativa); }catch(_e){}
  try{ if(typeof operador!=='undefined' && operador) ctx.op = String(operador.usuario||operador.nombre||''); }catch(_e){}
  // Tope de tamaño. Truncar el JSON a lo bruto lo deja inválido y entonces se pierde TODO el
  // contexto — justo en las operaciones largas, que son las más interesantes cuando fallan.
  // Así que se van soltando campos por orden de menor a mayor valor, y el JSON queda siempre
  // parseable. El motivo (m) es lo último que se suelta: nunca.
  const _ser = function(o){ try{ return '[ERR]'+JSON.stringify(o); }catch(_e){ return null; } };
  let tag = _ser(ctx);
  const _aSoltar = ['stack','pasos','msg','saldoRaw','op'];
  for(let i = 0; tag && tag.length > 1800 && i < _aSoltar.length; i++){
    if(_aSoltar[i] === 'pasos' && ctx.pasos && ctx.pasos.length > 2){
      ctx.pasos = ctx.pasos.slice(-2).map(function(p){ return String(p).slice(0,160); });  // los 2 últimos, recortados
    } else {
      delete ctx[_aSoltar[i]];
    }
    ctx.recortado = true;
    tag = _ser(ctx);
  }
  if(!tag || tag.length > 1800) tag = '[ERR]'+JSON.stringify({m:String(motivo), recortado:true});
  return (String(humano||'').trim()+' '+tag).trim();
}

function _errParse(notas){
  const s = String(notas||''); const i = s.indexOf('[ERR]');
  if(i < 0) return null;
  try{ return JSON.parse(s.slice(i+5)); }catch(_e){ return null; }
}
// El texto para humanos, sin la etiqueta técnica.
function _errTextoLimpio(notas){
  const s = String(notas||''); const i = s.indexOf('[ERR]');
  return (i < 0 ? s : s.slice(0, i)).trim();
}
// Etiqueta corta para la celda Estado de la tabla.
function _errEtiqueta(notas){
  const c = _errParse(notas);
  if(c && c.m && _ERR_MOTIVOS[c.m]) return _ERR_MOTIVOS[c.m].t;
  const t = _errTextoLimpio(notas);
  return t ? (t.length > 30 ? t.slice(0,30)+'…' : t) : '';
}

// Índice de filas del historial por id, para que el modal de detalle tenga la fila entera
// sin volver a consultar Supabase. Lo llena renderHistorial en cada pintada.
window._histPorId = window._histPorId || {};

// Modal de detalle del error: TODO lo que se sabe de esa fila, en un solo lugar.
window.verDetalleError = function(histId){
  const h = (window._histPorId||{})[String(histId)];
  if(!h){ if(typeof toast==='function') toast('No tengo la fila en pantalla · recargá el historial','yellow'); return; }
  const ctx  = _errParse(h.notas);
  const info = (ctx && ctx.m && _ERR_MOTIVOS[ctx.m]) || null;
  const esc  = (typeof escapeHtml==='function') ? escapeHtml : function(x){ return String(x==null?'':x); };
  const fmtM = (typeof money==='function') ? money : function(x){ return String(x); };

  const titulo = info ? info.t : (_errEtiqueta(h.notas) || 'Error');
  let html = '';

  // 1) Qué pasó, en castellano, y si quedó plata en duda.
  html += '<div style="border-radius:10px;padding:10px 12px;margin-bottom:10px;background:rgba(240,68,56,.10);border:1px solid rgba(240,68,56,.40)">'
        +   '<div style="font-weight:900;color:#f87171;font-size:14px">❌ '+esc(titulo)+'</div>'
        +   (info ? '<div style="font-size:12.5px;color:#e6edf3;margin-top:4px">'+esc(info.d)+'</div>' : '')
        +   (_errTextoLimpio(h.notas) ? '<div style="font-size:12.5px;color:#c9d1d9;margin-top:5px">'+esc(_errTextoLimpio(h.notas))+'</div>' : '')
        + '</div>';
  if(info && info.plata){
    html += '<div style="border-radius:10px;padding:9px 11px;margin-bottom:10px;background:rgba(245,197,24,.10);border:1px solid rgba(245,197,24,.45);font-size:12.5px;color:#f5c518;font-weight:700">'
          +   '⚠ No hay confirmación de si la plata se movió. Verificá en el casino ANTES de reintentar — reintentar a ciegas es como se duplica una carga.'
          + '</div>';
  }

  // 2) La fila entera. Todo lo que en la tabla no entra.
  const campos = [
    ['Fecha',        (typeof formatFecha==='function' ? formatFecha(h.created_at) : String(h.created_at||'—'))],
    ['Tipo',         h.tipo||'—'],
    ['Usuario',      h.usuario||'—'],
    ['Monto',        (h.monto ? fmtM(h.monto) : '—')],
    ['Saldo pre',    (h.saldo_pre!=null  && h.saldo_pre!==''  ? fmtM(h.saldo_pre)  : '— (no se pudo leer)')],
    ['Saldo post',   (h.saldo_post!=null && h.saldo_post!=='' ? fmtM(h.saldo_post) : '— (no se pudo leer)')],
    ['Billetera',    h.billetera_nombre||'—'],
    ['Origen',       h.origen||'—'],
    ['Estado',       h.estado||'—'],
    ['Operador',     h.operador || (ctx&&ctx.op) || '—'],
    ['PC',           h.pc_codigo || (ctx&&ctx.pc) || '—'],
    ['Solicitud',    h.solicitud_id ? ('#'+h.solicitud_id) : '—'],
    ['Mov. Chunior', h.chunior_movimiento_id ? ('N° '+h.chunior_movimiento_id) : '— (no se anotó)'],
    ['ID historial', h.id||'—']
  ];
  if(ctx && ctx.ms!=null)      campos.push(['Duró', (ctx.ms/1000).toFixed(1)+'s hasta fallar']);
  if(ctx && ctx.intento!=null) campos.push(['Intento', ctx.intento+' de '+(ctx.maxIntentos!=null?ctx.maxIntentos:'?')]);
  if(ctx && ctx.saldoRaw)      campos.push(['Saldo leído en Agentes', String(ctx.saldoRaw)]);
  if(ctx && ctx.pedido!=null)  campos.push(['Monto pedido', fmtM(ctx.pedido)]);
  if(ctx && ctx.needsLogin)    campos.push(['Sesión', 'caída (needsLogin)']);
  if(ctx && ctx.pageError)     campos.push(['Página', 'error de Agentes (pageError)']);

  html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12.5px;padding:10px 12px;background:#12161d;border:1px solid #262d3a;border-radius:10px;margin-bottom:10px">'
        + campos.map(function(c){
            return '<div style="color:#8b949e;white-space:nowrap">'+esc(c[0])+'</div><div style="color:#e6edf3;font-weight:600;word-break:break-word">'+esc(c[1])+'</div>';
          }).join('')
        + '</div>';

  // 3) El proceso paso a paso. Primero la traza completa (sólo existe en la PC que operó);
  //    si no está, los últimos pasos que viajaron dentro de la propia fila.
  let traza = null;
  try{ traza = JSON.parse(localStorage.getItem('nodo_traza_hist_'+h.id)||'null'); }catch(_e){}
  const ico = function(e){ return e==='ok'?'✅':e==='err'?'❌':e==='warn'?'⚠️':'•'; };
  if(traza && traza.pasos && traza.pasos.length){
    html += '<div style="font-weight:800;font-size:12px;color:#c9d1d9;margin-bottom:4px">Proceso completo ('+traza.pasos.length+' pasos)</div>'
          + '<div style="max-height:34vh;overflow:auto;font-size:12.5px;background:#12161d;border:1px solid #262d3a;border-radius:10px;padding:8px 10px">'
          + traza.pasos.map(function(p){
              return '<div style="display:flex;gap:10px;padding:2px 0"><span style="color:#6b7688;min-width:46px">+'+esc(p.t)+'s</span><span>'+ico(p.estado)+' '+esc(p.msg)+'</span></div>';
            }).join('')
          + '</div>';
  } else if(ctx && ctx.pasos && ctx.pasos.length){
    html += '<div style="font-weight:800;font-size:12px;color:#c9d1d9;margin-bottom:4px">Últimos pasos antes de fallar</div>'
          + '<div style="font-size:12.5px;background:#12161d;border:1px solid #262d3a;border-radius:10px;padding:8px 10px">'
          + ctx.pasos.map(function(p){ return '<div style="padding:2px 0;color:#e6edf3">'+esc(p)+'</div>'; }).join('')
          + '<div class="small" style="color:#8b949e;margin-top:6px">El paso a paso completo quedó en la PC que operó'+(ctx.pc?(' ('+esc(ctx.pc)+')'):'')+'.</div>'
          + '</div>';
  } else {
    html += '<div class="small" style="color:#8b949e">Sin paso a paso guardado. La traza completa sólo se guarda en la PC que ejecutó la operación, y de las últimas ~300.</div>';
  }

  // 4) Crudo, para copiar y pasarle a soporte.
  html += '<details style="margin-top:10px"><summary style="cursor:pointer;color:#8b949e;font-size:12px">Detalle técnico (crudo)</summary>'
        + '<pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;color:#9aa7bd;background:#0d1117;border:1px solid #262d3a;border-radius:8px;padding:8px;margin-top:6px">'
        + esc(String(h.notas||'(sin notas)')) + '</pre></details>'
        + '<div style="margin-top:10px"><button class="mini-btn" style="background:#1e3a5f;color:#7cc4ff;border:1px solid rgba(124,196,255,.45)" onclick="copiarDetalleError(&#39;'+esc(String(h.id))+'&#39;)">📋 Copiar todo</button></div>';

  if(typeof abrirModal==='function') abrirModal('🔎 Detalle del error', html, null, 'Cerrar');
};

// Copia el caso entero como texto plano, para pegarlo en un chat o un ticket.
window.copiarDetalleError = function(histId){
  const h = (window._histPorId||{})[String(histId)];
  if(!h) return;
  const ctx = _errParse(h.notas);
  let traza = null;
  try{ traza = JSON.parse(localStorage.getItem('nodo_traza_hist_'+h.id)||'null'); }catch(_e){}
  const L = [];
  L.push('NODO · detalle de error');
  L.push('motivo:    '+((ctx&&ctx.m&&_ERR_MOTIVOS[ctx.m]&&_ERR_MOTIVOS[ctx.m].t) || _errEtiqueta(h.notas) || '?'));
  L.push('mensaje:   '+(_errTextoLimpio(h.notas)||'—'));
  L.push('fecha:     '+(h.created_at||'—'));
  L.push('tipo:      '+(h.tipo||'—')+'   usuario: '+(h.usuario||'—')+'   monto: '+(h.monto||'—'));
  L.push('saldos:    pre='+(h.saldo_pre!=null&&h.saldo_pre!==''?h.saldo_pre:'—')+'  post='+(h.saldo_post!=null&&h.saldo_post!==''?h.saldo_post:'—'));
  L.push('billetera: '+(h.billetera_nombre||'—')+'   chunior: '+(h.chunior_movimiento_id||'—'));
  L.push('origen:    '+(h.origen||'—')+'   estado: '+(h.estado||'—')+'   operador: '+(h.operador||'—'));
  L.push('pc:        '+(h.pc_codigo||(ctx&&ctx.pc)||'—')+'   solicitud: '+(h.solicitud_id||'—')+'   hist_id: '+(h.id||'—'));
  if(ctx && ctx.ms!=null) L.push('duracion:  '+(ctx.ms/1000).toFixed(1)+'s');
  const pasos = (traza && traza.pasos && traza.pasos.length)
    ? traza.pasos.map(function(p){ return '  +'+p.t+'s '+(p.estado==='err'?'X ':p.estado==='warn'?'! ':'')+p.msg; })
    : ((ctx && ctx.pasos) ? ctx.pasos.map(function(p){ return '  '+p; }) : []);
  if(pasos.length){ L.push('proceso:'); L.push(pasos.join('\n')); }
  L.push('notas crudas: '+(h.notas||'—'));
  const txt = L.join('\n');
  const ok = function(){ if(typeof toast==='function') toast('📋 Detalle copiado','green'); };
  try{
    navigator.clipboard.writeText(txt).then(ok, function(){
      const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); ok(); }catch(_e2){ if(typeof toast==='function') toast('No se pudo copiar','red'); }
      ta.remove();
    });
  }catch(_e){
    if(typeof toast==='function') toast('No se pudo copiar','red');
  }
};

// ── Operación manual automatizada ─────────────────────────────────────────────
// ⛔ Cancelar (freno real): pide al agent-preload que corte la operación en curso. El freno solo
// actúa ANTES de "Aplicar" (nunca después — la plata ya se movió). Portado de NexoBetaChan.
function _mostrarBtnAbort(show){ try{ const b=document.getElementById('btnAbortarOp'); if(b) b.style.display = show ? 'inline-block' : 'none'; }catch(_e){} }
async function abortarOperacionActual(){
  try{
    if(window.ctrlElectron && ctrlElectron.drexAutomation){
      await ctrlElectron.drexAutomation('abortarOperacion');
      toast('⛔ Freno solicitado — si la operación no aplicó plata, se corta.','yellow');
    }
  }catch(_e){}
}
let _operacionManualEnCurso = false;
async function ejecutarOperacionManual(){
  // Anti-doble-click: si ya hay una operación corriendo, ignorar
  if(_operacionManualEnCurso){
    toast("Ya hay una operación en curso, esperá que termine.", "yellow");
    return;
  }
  if(!_drexGlobalLock('manual')){
    toast("Hay otra operación corriendo en Agentes ahora mismo (portal u otra). Esperá a que termine.", "yellow");
    return;
  }
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const usuario    = (document.getElementById("manualUsuario")?.value||"").trim();
  const montoRaw   = (document.getElementById("manualMonto")?.value||"").trim();
  const bilId      = document.getElementById("manualBilletera")?.value||"";
  const res        = document.getElementById("manualResultado");
  const btnEjecutar = document.querySelector('button.btn-primary[onclick="ejecutarOperacionManual()"]');

  if(!usuario){ toast("Ingresá un usuario.","red"); return; }

  // Activar el lock + deshabilitar el botón visualmente
  _operacionManualEnCurso = true;
  if(btnEjecutar){ btnEjecutar.disabled = true; btnEjecutar.style.opacity = '0.6'; btnEjecutar.textContent = 'Procesando...'; }
  _mostrarBtnAbort(true);

  let _lockLiberado = false;
  // Timeout de seguridad SOLO para un cuelgue real (un await que nunca resuelve / IPC muerto).
  // DEBE ser mayor que la suma de los timeouts del proceso main de un mismo flujo:
  // buscarUsuario (45s) + cargarSaldo/retirarSaldo (180s) = 225s. Si es menor, salta a mitad
  // de una operación lenta (proxy) y marca "se colgó" aunque en el casino SÍ se completó (error ciego).
  // El timeout del main (línea ~3162) ya maneja el caso lento verificando saldo; este es el último recurso.
  const _safetyTimer = setTimeout(() => {
    if(_lockLiberado) return;
    _lockLiberado = true;
    _operacionManualEnCurso = false;
    _drexGlobalUnlock();
    _wdForceUnlock(); // reset duro: por si quedó el watchdog bloqueado (no importa cuántos _wdLock anidados)
    if(btnEjecutar){ btnEjecutar.disabled = false; btnEjecutar.style.opacity = ''; btnEjecutar.textContent = 'Ejecutar'; }
    _mostrarBtnAbort(false);
    if(res) res.innerHTML = '<div class="err-box">⏱️ La operación no respondió a tiempo.<br>Revisá que la ventana de agentes esté abierta y verificá en el casino antes de reintentar.</div>';
    toast('⏱️ Operación sin respuesta · verificá antes de reintentar', 'red');
  }, 90000);

  // Asegurar que se libere SIEMPRE al final, pase lo que pase
  const _liberarLock = () => {
    if(_lockLiberado) return;
    _lockLiberado = true;
    clearTimeout(_safetyTimer);
    _operacionManualEnCurso = false;
    _drexGlobalUnlock();
    _wdForceUnlock(); // libera el candado del watchdog que se tomó al arrancar (ver más abajo)
    if(btnEjecutar){ btnEjecutar.disabled = false; btnEjecutar.style.opacity = ''; btnEjecutar.textContent = 'Ejecutar'; }
    _mostrarBtnAbort(false);
  };

  if(!montoRaw){
    try { await soloConsultarUsuario(); } finally { _liberarLock(); }
    return;
  }

  const monto = Number(montoRaw);
  if(isNaN(monto)||monto===0){ toast("Monto inválido.","red"); _liberarLock(); return; }

  const tipo    = monto > 0 ? "CARGA" : "RETIRO";
  const montoAbs= Math.abs(monto);
  // Respetar la billetera ELEGIDA en el selector (comparar como String: el value del <select> es
  // string y ID_BILLETERA es número → con === no matcheaba nunca y caía a la del portal). Si no se
  // eligió ninguna, por defecto va la del portal (getBilleraLanding).
  const bil     = (bilId ? billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); }) : null) || getBilleraLanding();

  _trazaInit((tipo==="CARGA"?"Carga":"Retiro")+' manual · '+usuario+' · '+money(montoAbs));
  if(res) res.innerHTML = '<div class="alert-box">Procesando...</div>';

  if(tipo==="RETIRO"){
    const check = await verificarRetiro24h(usuario);
    if(check.bloqueado){
      if(res) res.innerHTML = '<div class="alert-box">⚠️ <b>'+escapeHtml(usuario)+'</b> tiene un retiro reciente.<br><span class="small">'+escapeHtml(check.mensaje)+'</span></div>';
      const proceder = await confirmarRetiroDuplicado(check);
      if(!proceder){ if(res) res.innerHTML = ''; _liberarLock(); return; }
    }
  }

  try {
    // Candado del watchdog para TODA la secuencia (sesión + búsqueda + carga), sin huecos.
    // Antes solo se bloqueaba alrededor de buscarUsuario y, por separado, alrededor de
    // cargarSaldo/retirarSaldo — el hueco intermedio (y sobre todo el tiempo de
    // ensureDrexSession, que puede tardar) quedaba desprotegido. Si el watchdog tenía un
    // chequeo ya programado (_watchdogTrigger de la operación anterior) y caía justo ahí,
    // navegaba/refrescaba la página de Agentes a mitad de camino — cortando la carga en curso
    // (bug real reportado: "pega el usuario y está por cargar, refresca y corta"). _wdLock es
    // un contador (_watchdog.busy++), así que anidar los candados de abajo es seguro.
    _wdLock();
    toast("Abriendo backoffice...","blue");
    _trazaPaso('Abriendo sesión de Agentes...');
    if(!await ensureDrexSession()){ _trazaPaso('Falta sesión de Agentes','err'); _trazaFin('err'); toast("Sesión de backoffice requerida.","red"); return; }
    _trazaPaso('Sesión de Agentes lista','ok');

    // ── BUSCAR + OPERAR con reintento ACOTADO ante error de página (403/CDN) o sesión caída ──
    // Adoptado del NODO hermano (la parte REAL de su bucle — su señal 'needsRetry' es lógica
    // muerta, no la produce nadie). Nosotros SÍ tenemos pageError/needsLogin desde agent-preload.js
    // (status()/openMovementModal las propagan). Dos mejoras juntas:
    //   1) Antes, si buscarUsuario volvía por un 403/CDN o sesión caída, busqueda.exists salía
    //      falsy y el operador veía "el usuario no existe" — mensaje ENGAÑOSO. Ahora se distingue.
    //   2) Ante un error transitorio de página/sesión, se refresca UNA vez y se reintenta (tope 2).
    //      NO se reintenta a ciegas cuando la op pudo haberse aplicado (timeout → timeoutVerificar).
    const MAX_REINTENTOS = 2;
    let busqueda, resultado, intentoOp = 0;

    while(intentoOp < MAX_REINTENTOS){
      intentoOp++;

      // ── BUSCAR ──
      toast(intentoOp>1 ? ("↻ Reintento "+intentoOp+" · "+usuario+"...") : ("Buscando "+usuario+"..."),"blue");
      _trazaPaso(intentoOp>1 ? ('Reintento '+intentoOp+' · buscando '+usuario+'...') : ('Buscando '+usuario+' en Agentes...'));
      _wdLock();
      try {
        // CARGA: skipBalance → NO abrimos el modal acá. applyAmount (cargarSaldo)
        //        abre el modal UNA sola vez y lee pre (input 0) + post (input 1).
        // RETIRO: necesitamos el saldo antes para validar suficiencia → sin skip.
        busqueda = await callDrex("buscarUsuario", usuario, { skipBalance: tipo === "CARGA" });
      } finally {
        _wdUnlock();
      }

      // Página de error del CDN (403/404) en la BÚSQUEDA → refrescar y reintentar
      if(busqueda && busqueda.pageError){
        if(intentoOp < MAX_REINTENTOS){
          if(res) res.innerHTML = '<div class="alert-box">↻ Agentes devolvió un error de página · reintentando ('+intentoOp+'/'+MAX_REINTENTOS+')...</div>';
          try{ await window.ctrlElectron.navigateAgent(); }catch(_e){}
          continue;
        }
        if(res) res.innerHTML = '<div class="err-box">❌ Agentes devolvió una página de error (403/CDN). No se operó · cerrá y reabrí la ventana de Agentes, o reintentá.</div>';
        _trazaPaso('Agentes devolvió error de página (403/CDN) · no se operó','err'); _trazaFin('err');
        toast('Agentes devolvió error de página · reintentá', 'red'); return;
      }

      // Sesión caída en la BÚSQUEDA → login y reintentar
      if(busqueda && busqueda.needsLogin){
        if(res) res.innerHTML = '<div class="alert-box">🔐 Sesión de agentes caída · reingresá credenciales.</div>';
        _trazaPaso('Sesión de Agentes caída · reingresando...','warn');
        const reconectado = await ensureDrexSession();
        if(!reconectado){ _trazaPaso('No se reingresó a Agentes','err'); _trazaFin('err'); toast("Sesión de agentes requerida.","red"); return; }
        continue;
      }

      if(!busqueda.exists){
        const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas('USUARIO_NO_ENCONTRADO','Usuario no encontrado',{paso:'buscar usuario', pedido:montoAbs})});
        if(res) res.innerHTML = '<div class="err-box">❌ <b>'+escapeHtml(usuario)+'</b> no existe en el casino.</div>';
        _trazaPaso(usuario+' NO existe en Agentes','err'); _trazaFin('err', _fh&&_fh.id);
        toast(usuario+" no encontrado","red"); return;
      }

      // RETIRO: chequeo de saldo previo
      // V15.2: si Agentes devuelve sólo "ARS" sin número, NO lo tomamos como saldo 0.
      // Eso era un falso bloqueo. Sólo bloqueamos cuando el saldo leído tiene dígitos reales.
      if(tipo === "RETIRO"){
        const saldoRaw = String(busqueda.balance?.raw || "");
        const saldo = busqueda.balance?.value ?? null;
        const saldoConfiable = /\d/.test(saldoRaw) && typeof saldo === "number" && Number.isFinite(saldo);
        if(saldoConfiable && saldo >= 0 && saldo < montoAbs){
          const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas('SALDO_INSUFICIENTE','Saldo insuficiente',{paso:'chequeo de saldo', pedido:montoAbs, saldoRaw:saldoRaw, saldo:saldo})});
          if(res) res.innerHTML = '<div class="err-box">⚠️ Saldo insuficiente: '+escapeHtml(busqueda.balance?.raw||'')+'</div>';
          _trazaPaso('Saldo insuficiente ('+(busqueda.balance?.raw||'').trim()+')','err'); _trazaFin('err', _fh&&_fh.id);
          toast("Saldo insuficiente","red"); return;
        }
      }

      _trazaPaso(usuario+' encontrado'+(busqueda.balance?.raw?(' · saldo '+busqueda.balance.raw.trim()):''), 'ok');

      // Punto de CANCELACIÓN seguro: si el operador canceló mientras buscábamos, NO aplicamos
      // la carga (todavía no se tocó plata). Libera el panel y avisa.
      if(window._traza && window._traza.cancelada){
        await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas('CANCELADO','Cancelado por el operador antes de aplicar',{paso:'antes de aplicar', pedido:montoAbs})});
        _trazaFin('warn');
        if(res) res.innerHTML = '<div class="alert-box">⛔ '+tipo+' cancelada antes de aplicar. No se tocó nada en el casino.</div>';
        toast(tipo+' cancelada', 'yellow'); return;
      }

      // ── OPERAR ── (esperamos confirmación antes de marcar como completada)
      toast(tipo === "CARGA" ? "Cargando "+money(montoAbs)+"..." : "Retirando "+money(montoAbs)+"...", "blue");
      _trazaPaso((tipo==="CARGA"?"Cargando ":"Retirando ")+money(montoAbs)+' en Agentes...');
      _wdLock(); // bloqueamos watchdog para que no navegue agentes mientras opera
      try {
        resultado = tipo === "CARGA"
          ? await callDrex("cargarSaldo",  montoAbs)
          : await callDrex("retirarSaldo", montoAbs);
      } catch(e){
        const msgTimeout = e && (e.message || String(e)) || 'Error en Drex';
        if(/timeout|tard[oó] demasiado|timed out/i.test(msgTimeout)){
          // El worker puede terminar la carga en Agentes/Chunior pero cortar por timeout al volver.
          // No marcamos error ciego: intentamos leer saldo post; si no se puede, queda OK a verificar.
          resultado = { ok:true, message:'Timeout posterior a la operación · verificar saldo', timeoutVerificar:true };
          try{
            const postRead = await callDrex("buscarUsuario", usuario, { skipBalance:false });
            if(postRead && postRead.exists && typeof postRead.balance?.value === 'number'){
              resultado.newBalance = postRead.balance;
              resultado.message = 'Timeout, pero saldo post leído';
            }
          }catch(_e){}
        }else{
          resultado = { ok:false, message: msgTimeout };
        }
      } finally {
        _wdUnlock();
      }

      // Error de página / sesión caída DURANTE la operación → refrescar/login y reintentar.
      // OJO: el timeout (timeoutVerificar) NO entra acá — puede haberse aplicado en el casino,
      // no reintentamos a ciegas (evita duplicar). Solo reintentamos si el modal ni se abrió.
      if(resultado && !resultado.timeoutVerificar && (resultado.pageError || resultado.needsLogin)){
        if(intentoOp < MAX_REINTENTOS){
          if(resultado.needsLogin){
            if(res) res.innerHTML = '<div class="alert-box">🔐 Sesión caída durante la operación · reingresá credenciales.</div>';
            const recon = await ensureDrexSession();
            if(!recon){ toast('Sesión de agentes requerida.','red'); return; }
          } else {
            if(res) res.innerHTML = '<div class="alert-box">↻ Error de página al operar · refrescando y reintentando ('+intentoOp+'/'+MAX_REINTENTOS+')...</div>';
            try{ await window.ctrlElectron.navigateAgent(); }catch(_e){}
          }
          continue;
        }
        // Sin más reintentos → error claro (no operamos a ciegas)
        const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:'ERROR', notas:_errNotas(resultado.needsLogin?'SESION_CAIDA':'ERROR_PAGINA',(resultado.needsLogin?'Sesión caída':'Error de página')+' al operar · no confirmado',{paso:'aplicar', pedido:montoAbs, intento:intentoOp, maxIntentos:MAX_REINTENTOS, needsLogin:!!resultado.needsLogin, pageError:!!resultado.pageError, msg:(resultado&&resultado.message)||null})});
        if(res) res.innerHTML = '<div class="err-box">❌ '+tipo+' no confirmada: '+(resultado.needsLogin?'sesión caída':'error de página en Agentes')+'. Verificá en el casino antes de reintentar.</div>';
        _trazaPaso((resultado.needsLogin?'Sesión caída':'Error de página')+' al operar · no confirmado','err'); _trazaFin('err', _fh&&_fh.id);
        toast(tipo+' no confirmada · verificá', 'red'); return;
      }

      break; // el script corrió (o timeout que puede haberse aplicado) → salimos del loop
    }

    const ok    = resultado && resultado.ok !== false;

    // Saldo PRE: lo leemos siempre (ya sea del casino o de la búsqueda inicial).
    // Saldo POST: SIEMPRE lo calculamos (pre + monto). Es lo más confiable.
    // La lectura post del casino se usa SOLO para detectar duplicados como bonus.
    const saldoPreCasino = (typeof resultado?.previousBalance?.value === 'number' && !resultado?.previousBalance?.unchanged) ? resultado.previousBalance.value : null;
    const saldoPostCasino = (typeof resultado?.newBalance?.value === 'number' && !resultado?.newBalance?.unchanged) ? resultado.newBalance.value : null;
    let saldoPre  = saldoPreCasino !== null ? saldoPreCasino : ((typeof busqueda.balance?.value === 'number') ? busqueda.balance.value : null);
    let saldoPost = saldoPostCasino !== null ? saldoPostCasino : ((ok && saldoPre !== null) ? saldoPre + (tipo === "CARGA" ? montoAbs : -montoAbs) : null);
    if(ok && saldoPost === null){
      const ultimoSaldo = (typeof ultimoSaldoPostUsuarioHistorial === 'function') ? ultimoSaldoPostUsuarioHistorial(usuario) : null;
      if(ultimoSaldo !== null){
        saldoPre = ultimoSaldo;
        saldoPost = tipo === "CARGA" ? ultimoSaldo + montoAbs : ultimoSaldo - montoAbs;
      }
    }

    // ── CONFIRMACIÓN estilo NODO hermano (simple, SIN re-leer el saldo, SIN estado "sin confirmar") ──
    // El script CORRIÓ (pasó el gate de página/saldo previo → ok!==false) → la operación SE APLICÓ.
    // Confiamos en que el script corrió limpio (igual que el hermano); NO exigimos "Operación correcta"
    // ni delta de saldo para anotar en Chunior. Solo frenamos en dos casos CLAROS: (a) RECHAZO explícito
    // (el modal apareció y dijo que NO, exito===false) y (b) DUPLICADO (el saldo saltó 2-6x el monto).
    // Trade-off aceptado (pedido explícito 2026-07-02): si el casino rechazó pero el modal no llegó a
    // verse (exito===null), se anota igual — prioriza velocidad/simpleza sobre el 100% de certeza.
    const _signo = tipo === "CARGA" ? 1 : -1;
    const _postEnModal = saldoPostCasino; // post REAL del modal (null si no se leyó)
    let _confianza = 'confirmado', _vecesDup = 0;
    if(ok && saldoPreCasino !== null && _postEnModal !== null){
      const _movido = _postEnModal - saldoPreCasino;
      if(Math.sign(_movido) === _signo && Math.abs(_movido) >= montoAbs * 1.5){
        const _veces = Math.round(_movido / (_signo * montoAbs));
        if(_veces >= 2 && _veces <= 6 && Math.abs(_movido - _veces * _signo * montoAbs) < 1){ _confianza = 'duplicado'; _vecesDup = _veces; }
      }
    }
    const _rechazoCasino = ok && resultado && resultado.exito === false; // modal apareció y NO confirmó → rechazo CLARO
    const cargaConfirmada = ok && !_rechazoCasino; // script corrió y no hubo rechazo explícito → se confía
    const aplicadoLimpio = cargaConfirmada && _confianza !== 'duplicado';
    const est2  = !ok ? "ERROR" : (_rechazoCasino ? "ERROR" : "OK");
    const notas = !ok ? _errNotas('NO_APLICO', ((resultado && resultado.message) || "error"), {paso:'aplicar', pedido:montoAbs, saldoRaw:(resultado?.previousBalance?.raw || busqueda.balance?.raw || null), needsLogin:!!(resultado&&resultado.needsLogin), pageError:!!(resultado&&resultado.pageError), timeoutVerificar:!!(resultado&&resultado.timeoutVerificar)})
                : _rechazoCasino ? _errNotas('RECHAZO_CASINO', "El casino NO confirmó 'Operación correcta' (rechazo) · NO anotado en Chunior", {paso:'confirmación', pedido:montoAbs, saldoPre:saldoPre, saldoPost:saldoPost, msg:(resultado&&resultado.message)||null})
                : _confianza === 'duplicado' ? ('🚨 DUPLICADO x'+(_vecesDup||'?')+' · saldo '+money(saldoPre)+'→'+money(saldoPost))
                : (resultado?.previousBalance?.raw || busqueda.balance?.raw || null);
    if(_confianza === 'duplicado'){
      toast('🚨 '+tipo+' DUPLICADA ('+(_vecesDup||'?')+'x) en agentes · saldo '+money(saldoPre)+' → '+money(saldoPost)+'. Revisá y corregí.', 'red');
    }

    // NOTA: el saldo pre YA se resolvió arriba (modal → busqueda.balance → último saldo post
    // conocido del usuario). NO re-derivar pre desde post acá: si post vino de una lectura
    // espuria (0 transitorio del modal en una PC lenta), "pre = post - monto" da NEGATIVO
    // (bug real visto en producción, PC piloto). Mejor dejar pre/post en null (se muestra "—")
    // que mostrar un saldo negativo falso.

    // Registramos en historial AHORA con chunior_movimiento_id=null (se actualiza
    // después cuando Chunior responda en background).
    const filaHist = await registrarEnHistorial({usuario, tipo, monto:montoAbs, billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null, origen:'MANUAL', estado:est2, notas, chunior_movimiento_id:null, saldo_post:saldoPost, saldo_pre:saldoPre});

    // Traza del resultado en Agentes + persistir ligada a la fila del historial (botón ℹ️).
    if(!ok){ _trazaPaso('Agentes: no se pudo aplicar · '+((resultado&&resultado.message)||'error'), 'err'); _trazaFin('err', filaHist&&filaHist.id); }
    else if(_rechazoCasino){ _trazaPaso('Agentes RECHAZÓ (no dijo "Operación correcta") · no se anota en Chunior', 'err'); _trazaFin('err', filaHist&&filaHist.id); }
    else if(_confianza==='duplicado'){ _trazaPaso('🚨 DUPLICADO ('+(_vecesDup||'?')+'x) en Agentes · revisá', 'warn'); _trazaFin('warn', filaHist&&filaHist.id); }
    else { _trazaPaso((tipo==="CARGA"?"Carga":"Retiro")+' aplicado en Agentes'+(saldoPost!=null?(' · saldo '+money(saldoPost)):''), 'ok'); _trazaFin('ok', filaHist&&filaHist.id); }
    // Referencia estable de esta traza para poder anexar el resultado de Chunior (async) sin
    // que una operación posterior lo pise.
    const _trazaPasosRef = (window._traza && window._traza.pasos) || [];
    const _trazaTituloRef = (window._traza && window._traza.titulo) || '';
    const _histIdRef = filaHist && filaHist.id;
    const _guardarTraza = function(fin){ try{ if(_histIdRef) localStorage.setItem('nodo_traza_hist_'+_histIdRef, JSON.stringify({titulo:_trazaTituloRef, pasos:_trazaPasosRef, fin:fin||'', ts:Date.now()})); }catch(_e){} };

    // ── Chunior EN BACKGROUND ── SOLO si la operación quedó APLICADA LIMPIA (script corrió, sin rechazo ni duplicado)
    const debeChunior = aplicadoLimpio && !!(bil && bil.CHUNIOR_UID);
    if(debeChunior){
      _trazaPasosRef.push({ t:((Date.now()-(window._traza.t0||Date.now()))/1000).toFixed(1), msg:'Anotando en Chunior (2° plano)...', estado:'' }); _trazaRender(); _guardarTraza('ok');
      const chuPromise = tipo === "CARGA"
        ? registrarCargaEnChunior (bil.CHUNIOR_UID, montoAbs, usuario)
        : registrarRetiroEnChunior(bil.CHUNIOR_UID, montoAbs, usuario);

      const _chuPaso = function(msg, estado){ try{ _trazaPasosRef.push({ t:((Date.now()-(window._traza.t0||Date.now()))/1000).toFixed(1), msg:msg, estado:estado||'' }); _guardarTraza(estado==='err'?'warn':'ok'); }catch(_e){} };
      chuPromise
        .then(async function(rChu){
          if(rChu && rChu.ok && rChu.movimientoId){
            toast("📋 "+tipo+" Chunior N° "+rChu.movimientoId, 'blue');
            _chuPaso('Chunior anotó · N° '+rChu.movimientoId, 'ok');
            // Actualizar el historial con el chunior_movimiento_id real
            if(filaHist && filaHist.id){
              try {
                await supabaseClient.from('historial_ops')
                  .update({ chunior_movimiento_id: rChu.movimientoId })
                  .eq('id', filaHist.id);
                if(typeof cargarHistorial === 'function') await cargarHistorial();
              } catch(e){ console.warn('update chunior_movimiento_id falló:', e); }
            }
            // Recién acá comparamos fichas: Chunior YA confirmó su movimiento.
            _watchdogTrigger(1500);
          } else if(rChu && rChu.ok && !rChu.movimientoId){
            // Chunior ACEPTÓ el movimiento (sin error) pero no pudimos leer su N° en la
            // respuesta (parseo flaky de esa página). Antes esto no entraba en NINGUNA
            // rama: no se avisaba, no se marcaba nada, y la fila quedaba para siempre
            // como "NO registrado" pese a estar anotada de verdad — false alarm real.
            // Marcamos en notas (sin inventar un chunior_movimiento_id falso, que se usa
            // para "Cambiar billetera" y otras acciones que necesitan un N° real).
            toast("📋 "+tipo+" anotado en Chunior (sin N° confirmado)", 'blue');
            _chuPaso('Chunior anotó (sin N° confirmado)', 'ok');
            if(filaHist && filaHist.id){
              try {
                const notaMarca = (String(notas||'').trim()+' [CHUNIOR_OK_SIN_N]').trim();
                await supabaseClient.from('historial_ops')
                  .update({ notas: notaMarca })
                  .eq('id', filaHist.id);
                if(typeof cargarHistorial === 'function') await cargarHistorial();
              } catch(e){ console.warn('update notas [CHUNIOR_OK_SIN_N] falló:', e); }
            }
            _watchdogTrigger(1500);
          } else if(rChu && rChu.error){
            toast('⚠️ '+tipo+' OK en casino pero falló en Chunior: '+rChu.error, 'red');
            _chuPaso('Chunior FALLÓ: '+rChu.error+' · verificá/reintentá', 'err');
            // Chunior falló → NO chequeamos fichas (sabríamos que hay diferencia,
            // no aporta info nueva).
          }
        })
        .catch(function(e){ _chuPaso('Error anotando en Chunior: '+(e.message||''), 'err'); toast('⚠️ Error registrando en Chunior: '+(e.message||''), 'red'); });
    }
    // Si no hay Chunior involucrado (billetera sin CHUNIOR_UID), NO disparamos
    // el watchdog: sabemos que va a haber diferencia (Drex cambió, Chunior no).

    if(ok){
      if(bil && bil.ID_BILLETERA) await ajustarSaldoBilletera(bil.ID_BILLETERA, tipo==="CARGA" ? montoAbs : -montoAbs);
      if(res){
        if(_rechazoCasino){
          // El modal de resultado apareció pero NO dijo "Operación correcta" → rechazo. NO se anotó en Chunior.
          res.innerHTML = '<div class="err-box">❌ '+tipo+' de '+money(montoAbs)+' → <b>'+escapeHtml(usuario)+'</b>: el casino <b>NO confirmó "Operación correcta"</b> (rechazo).<br><span class="small">NO se anotó en Chunior. Verificá en el casino antes de reintentar.</span></div>';
        } else if(_confianza === 'duplicado'){
          // El saldo saltó un múltiplo del monto → se aplicó de más. NO se anota en Chunior; el operador corrige.
          res.innerHTML = '<div class="alert-box">🚨 '+tipo+' DUPLICADA ('+(_vecesDup||'?')+'x) → <b>'+escapeHtml(usuario)+'</b> · saldo '+money(saldoPre)+'→'+money(saldoPost)+'.<br><span class="small">NO se anotó en Chunior. Revisá/corregí en el casino.</span></div>';
        } else {
          // El N° de Chunior se actualiza después si llega — por ahora mostramos OK directo
          res.innerHTML = '<div class="ok-box">✅ '+tipo+' de '+money(montoAbs)+' → <b>'+escapeHtml(usuario)+'</b> completada</div>';
        }
      }
      toast(_rechazoCasino ? ('❌ '+tipo+' rechazada por el casino · no anotada') : _confianza === 'duplicado' ? ('🚨 '+tipo+' duplicada · revisá') : (tipo+" completada: "+usuario+" · "+money(montoAbs)), (_rechazoCasino||_confianza==='duplicado') ? "red" : "green");
      // Auto-registrar al usuario en NODO si vino de una CARGA y no existe en la base (segundo plano)
      if(tipo === "CARGA" && busqueda?.user){
        _autoregistrarUsuarioSiFalta(busqueda.user);
      }
      // Limpiar campos de entrada después de la operación exitosa
      const manualUsuarioEl = document.getElementById("manualUsuario");
      const manualMontoEl   = document.getElementById("manualMonto");
      if(manualUsuarioEl) manualUsuarioEl.value = "";
      if(manualMontoEl)   manualMontoEl.value   = "";
    } else {
      if(res) res.innerHTML = '<div class="err-box">❌ '+tipo+' falló: '+escapeHtml(resultado?.message||'sin detalle')+'</div>';
      toast("Error: "+(resultado?.message||"falló"),"red");
    }

    await window.ctrlElectron.navigateAgent();
    await cargarHistorial();
    renderBillerasInicio();
    poblarManualBilletera();
  } catch(e) {
    const _fh = await registrarEnHistorial({usuario, tipo, monto:montoAbs, origen:'MANUAL', estado:'ERROR', notas:_errNotas('EXCEPCION', e.message||'excepción', {paso:'excepción', stack:String((e&&e.stack)||'').split('\n').slice(0,3).join(' | ')})});
    if(res) res.innerHTML = '<div class="err-box">Error inesperado: '+escapeHtml(e.message||'sin detalle')+'</div>';
    _trazaPaso('Error inesperado: '+(e.message||'sin detalle'),'err'); _trazaFin('err', _fh&&_fh.id);
    toast("Error: "+(e.message||"sin detalle"),"red");
  } finally {
    // Red de seguridad: si algún camino no finalizó la traza, cerrarla como error.
    try{ if(window._traza && !window._traza.fin && window._traza.pasos && window._traza.pasos.length){ _trazaFin('err'); } }catch(_e){}
    _liberarLock();
  }
}

// ── Blanquear clave: motor compartido ─────────────────────────────────────────
// Devuelve {ok, message}. Si onResultHtml viene, también lo escribe en ese div.
async function _ejecutarBlanqueoClave(usuario, opciones){
  opciones = opciones || {};
  const clave = opciones.clave || "12345a";
  const resEl = opciones.resultEl || null;
  if(!window.ctrlElectron){ alert("Solo disponible en la app de escritorio."); return { ok:false }; }
  if(!usuario){ toast("Usuario inválido.", "red"); return { ok:false }; }

  if(resEl) resEl.innerHTML = '<div class="alert-box">Buscando '+escapeHtml(usuario)+'...</div>';
  try {
    if(!await ensureDrexSession()){ if(resEl) resEl.innerHTML = ''; return { ok:false }; }
    toast("Buscando "+usuario+"...", "blue");
    const b = await callDrex("buscarUsuario", usuario);
    if(!b.exists){
      if(resEl) resEl.innerHTML = '<div class="err-box">❌ <b>'+escapeHtml(usuario)+'</b> no existe en el casino.</div>';
      toast(usuario+" no encontrado", "red");
      return { ok:false };
    }
    toast("Cambiando clave de "+usuario+"...", "blue");
    const r = await callDrex("cambiarClave", clave);
    const ok = r && r.ok !== false;
    await registrarEnHistorial({usuario, tipo:'RESET_CLAVE', monto:0, origen:'MANUAL', estado: ok ? 'OK' : 'ERROR', notas:'clave → '+clave});
    if(ok){
      // Tocarlo copia usuario y clave, listos para pegarle al jugador (pedido de Juan). El handler se
      // asigna por JS y no en un onclick="" armado con el texto: un usuario con comillas lo rompía.
      if(resEl){
        resEl.innerHTML = '<div class="ok-box" role="button" tabindex="0" title="Tocá para copiar usuario y clave" style="cursor:pointer">🔑 Clave de <b>'+escapeHtml(usuario)+'</b> blanqueada → <b>'+escapeHtml(clave)+'</b> <span style="opacity:.65;font-size:11px">· tocá para copiar</span></div>';
        const _caja = resEl.firstElementChild || resEl.firstChild;
        if(_caja) _caja.onclick = function(){ window.nodoCopiar('Usuario: '+usuario+'\nClave: '+clave, { etiqueta:'Usuario y clave copiados' }); };
      }
      toast("Clave de "+usuario+" blanqueada → "+clave, "green");
    } else {
      if(resEl) resEl.innerHTML = '<div class="err-box">❌ Error al cambiar clave: '+escapeHtml(r?.message||'falló')+'</div>';
      toast("Error: "+(r?.message||"falló"), "red");
    }
    await cargarHistorial();
    return { ok };
  } catch(e){
    if(resEl) resEl.innerHTML = '<div class="err-box">Error: '+escapeHtml(e.message||'sin detalle')+'</div>';
    toast("Error: "+(e.message||"sin detalle"), "red");
    return { ok:false };
  }
}

// Botón del form manual (toma el usuario del input)
async function blanquearClaveManual(){
  const usuario = (document.getElementById("manualUsuario")?.value || "").trim();
  const res     = document.getElementById("manualResultado");
  if(!usuario){ toast("Ingresá un usuario para blanquear la clave.", "red"); return; }
  if(!confirm('¿Blanquear la clave de "'+usuario+'" → 12345a?')) return;
  const r = await _ejecutarBlanqueoClave(usuario, { resultEl: res });
  if(r.ok){
    // Limpiar inputs después del éxito
    const mu = document.getElementById("manualUsuario"); if(mu) mu.value = "";
    const mm = document.getElementById("manualMonto");   if(mm) mm.value = "";
  }
}

// Botón de cada fila del historial (toma el usuario directamente)
async function blanquearClaveUsuario(usuario){
  if(!usuario){ toast("Usuario inválido.", "red"); return; }
  if(!confirm('¿Blanquear la clave de "'+usuario+'" → 12345a?')) return;
  await _ejecutarBlanqueoClave(usuario, {});
}

// ── Consulta en tiempo real de retiros del usuario (cuando no hay monto) ─────
let _consultaRetirosDebounce = null;
let _consultaRetirosTokenActual = 0;

async function consultarRetirosUsuarioRealtime(){
  const usuario  = (document.getElementById("manualUsuario")?.value || "").trim();
  const montoRaw = (document.getElementById("manualMonto")?.value || "").trim();
  const res = document.getElementById("manualResultado");
  if(!res) return;

  // Si hay monto o no hay usuario → limpiar solo si lo que estaba era nuestra consulta
  if(!usuario || montoRaw){
    if(res.dataset.modo === 'consultaRetiros'){
      res.innerHTML = '';
      delete res.dataset.modo;
    }
    return;
  }

  // Token para descartar respuestas viejas si el operador sigue tecleando
  const miToken = ++_consultaRetirosTokenActual;
  res.dataset.modo = 'consultaRetiros';
  res.innerHTML = '<div class="alert-box" style="padding:10px"><span class="small">Buscando retiros de <b>'+escapeHtml(usuario)+'</b>...</span></div>';

  try {
    // Ventana de 24hs exactas — la política de retiro es 1 cada 24hs
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Match EXACTO pero sin distinguir mayúsculas (mismo criterio que verificarRetiro24h): los
    // retiros se guardan a veces "Cristina0735" y a veces "cristina0735". Escapamos %/_ del patrón.
    const _uPat = String(usuario||'').replace(/[\\%_]/g, function(c){ return '\\'+c; });
    // No filtramos por pc_codigo: queremos detectar si el usuario retiró desde OTRA oficina
    const { data } = await supabaseClient
      .from("historial_ops")
      .select("created_at, monto, billetera_nombre, estado, origen, chunior_movimiento_id, pc_codigo, notas")
      .ilike("usuario", _uPat)
      .eq("tipo", "RETIRO")
      // Los CIERRES de un retiro parcial se anotan como RETIRO de $0. No son un retiro: son una
      // decisión administrativa. Salían acá como "$ 0 · —" sin decir qué eran y, con el tope de 10
      // filas, TAPABAN retiros de verdad — Maria6981x tenía 6 de 10 filas ocupadas por cierres.
      .gt("monto", 0)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(10);

    if(miToken !== _consultaRetirosTokenActual) return; // se quedó obsoleto
    if(res.dataset.modo !== 'consultaRetiros') return;  // el operador ya escribió monto u operó

    if(!data || !data.length){
      res.innerHTML = '<div class="alert-box" style="padding:10px"><span class="small">📭 <b>'+escapeHtml(usuario)+'</b> no tiene retiros en las últimas 24hs.</span></div>';
      return;
    }

    // ¿Hay alguno de otra oficina?
    const otrasOficinas = data
      .map(r => r.pc_codigo)
      .filter(pc => pc && pc !== pcOperativa);
    const tagCrossOficina = otrasOficinas.length > 0
      ? '<div style="background:#3a2515;color:#ffa066;padding:6px 10px;border-radius:8px;margin-top:6px;font-size:12px">' +
        '🚨 <b>Atención:</b> hay retiros de este usuario en otra oficina ('+escapeHtml([...new Set(otrasOficinas)].join(', '))+'). Verificá antes de proceder.' +
        '</div>'
      : '';

    // Etiqueta de ORIGEN: aclara de dónde viene cada retiro.
    //   LANDING = importado del CSV de operaciones de agentes (retiro real del jugador en la plataforma)
    //   PANEL/AUTO/MANUAL/CHAT = procesado por NODO
    const origenLabel = function(o){
      const map = {
        LANDING: { txt: 'CSV agentes', color: '#9aa4b2' },
        PANEL:   { txt: 'NODO panel',  color: '#7aa2ff' },
        AUTO:    { txt: 'NODO auto',   color: '#7aa2ff' },
        MANUAL:  { txt: 'NODO manual', color: '#7aa2ff' },
        CHAT:    { txt: 'NODO chat',   color: '#7aa2ff' },
        CIERRE:  { txt: 'cierre',      color: '#c084fc' }
      };
      const m = map[o] || { txt: (o||'?'), color: '#9aa4b2' };
      return '<span style="font-size:9px;color:'+m.color+';border:1px solid '+m.color+'55;border-radius:4px;padding:1px 5px;margin-left:4px">'+escapeHtml(m.txt)+'</span>';
    };

    let filas = '';
    data.forEach(function(r){
      const fecha     = formatFecha(r.created_at);
      const billetera = r.billetera_nombre || '—';
      const tagErr    = r.estado === 'ERROR' ? ' <span style="color:var(--red)">❌</span>' : '';
      const esExterna = r.pc_codigo && r.pc_codigo !== pcOperativa;
      const pcBadge   = r.pc_codigo
        ? '<span class="badge '+(esExterna?'badge-danger':'badge-muted')+'" style="font-size:9px;padding:2px 6px;margin-left:4px">'+escapeHtml(r.pc_codigo)+'</span>'
        : '';
      // Un tramo de un retiro grande NO es un retiro aparte: es el mismo criterio con el que la
      // regla de 24hs los descarta (_blEsParcial). Sin decirlo, la lista parece cinco retiros.
      const tagParcial = (typeof _blEsParcial === "function" && _blEsParcial(r))
        ? ' <span style="font-size:9px;color:#c084fc;border:1px solid #c084fc55;border-radius:4px;padding:1px 5px;margin-left:4px">parte de un retiro</span>'
        : '';
      filas += '<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid rgba(255,255,255,.08);font-size:12px">'
        +   '<span style="color:#c0cad8;white-space:nowrap">'+escapeHtml(fecha)+tagErr+pcBadge+origenLabel(r.origen)+tagParcial+'</span>'
        +   '<span style="text-align:right"><b>'+money(r.monto)+'</b> <span class="small">· '+escapeHtml(billetera)+'</span></span>'
        + '</div>';
    });
    res.innerHTML = '<div class="alert-box" style="padding:10px;line-height:1.4">'
      + '<b>⚠️ Retiros de '+escapeHtml(usuario)+' en las últimas 24hs</b>'
      + tagCrossOficina
      + '<div style="margin-top:4px">'+filas+'</div>'
      + '</div>';
  } catch(e){
    if(miToken !== _consultaRetirosTokenActual) return;
    res.innerHTML = '<div class="alert-box" style="padding:10px"><span class="small">Error consultando retiros: '+escapeHtml(e.message||'')+'</span></div>';
  }
}

function _configurarConsultaRetirosLive(){
  const inputUsuario = document.getElementById("manualUsuario");
  const inputMonto   = document.getElementById("manualMonto");
  if(!inputUsuario || !inputMonto) return;
  const onChange = function(){
    clearTimeout(_consultaRetirosDebounce);
    _consultaRetirosDebounce = setTimeout(consultarRetirosUsuarioRealtime, 450);
  };
  inputUsuario.addEventListener("input", onChange);
  inputMonto.addEventListener("input", onChange);
}

// Copia solo el usuario (para pasárselo al cliente junto con su teléfono → login al portal de cargas).
async function _copiarSoloUsuario(usuario){
  try{ await navigator.clipboard.writeText(usuario); toast("Usuario copiado: " + usuario, "green"); }
  catch(_e){ toast("No se pudo copiar", "red"); }
}
// Mensaje prolijo y completo para pegar en el chat del cliente: usuario+clave y la aclaración
// de los DOS logins distintos (portal de cargas con usuario+teléfono vs. plataforma con usuario+clave).
async function _copiarMensajeClienteNuevo(usuario, clave){
  const msg = "¡Listo! Tu usuario ya está creado ✅\n\n" +
    "Usuario: " + usuario + "\n" +
    "Clave: " + clave + "\n\n" +
    "🔹 Para CARGAR o RETIRAR fichas: entrá al portal de cargas con tu usuario + tu teléfono.\n" +
    "🔹 Para JUGAR en la plataforma: entrá con tu usuario + la clave de arriba.";
  try{ await navigator.clipboard.writeText(msg); toast("Mensaje copiado · pegalo en el chat", "green"); }
  catch(_e){ toast("No se pudo copiar", "red"); }
}
// ── Auto-actualización: chequeo/descarga/instalación MANUAL (botón en el sidebar) ──
// Nunca automática: mientras seguimos iterando, cada oficina actualiza cuando el
// operador lo decide, no sola al abrir la app.
// Saca la cajita del modo plegado SIN guardar la preferencia: si hay una versión nueva el
// operador tiene que verla aunque la haya minimizado, pero si la vuelve a plegar se queda
// plegada hasta el próximo chequeo. Avisar sí; hinchar, no.
function _updaterForzarVisible(){
  try{
    const box=document.getElementById("updaterBox"), chip=document.getElementById("updaterMiniChip");
    if(box){ box.style.display="flex"; box.style.borderColor="#3fb950"; }
    if(chip) chip.style.display="none";
  }catch(_e){}
}
function nodoUpdaterStatus(payload){
  const el=document.getElementById("updaterStatusTxt");
  if(!el || !payload) return;
  const st=payload.state;
  if(st==="available" || st==="downloaded") _updaterForzarVisible();
  if(st==="checking") el.innerHTML="Buscando actualización...";
  else if(st==="not-available") el.innerHTML="✅ Ya tenés la última versión";
  else if(st==="available") el.innerHTML="🆕 v"+escapeHtml(payload.version||"")+" disponible — <a href=\"javascript:void 0\" onclick=\"nodoDescargarActualizacion()\" style=\"color:#58a6ff\">Descargar</a>";
  else if(st==="downloading") el.innerHTML="⬇️ Descargando... "+(payload.percent||0)+"%";
  else if(st==="downloaded") el.innerHTML="✅ Lista v"+escapeHtml(payload.version||"")+" — <a href=\"javascript:void 0\" onclick=\"nodoInstalarActualizacion()\" style=\"color:#3fb950;font-weight:700\">Reiniciar e instalar</a>";
  else if(st==="error") el.innerHTML='<span style="color:#f85149">Error: '+escapeHtml(payload.message||"")+"</span>";
}
// Canal de actualización (portado de NexoBetaChan): alpha = repo oficial nuestro · beta = repo del colega (pruebas).
function nodoGetCanal(){ try{ return localStorage.getItem("nodo_update_channel")==="beta" ? "beta" : "alpha"; }catch(_e){ return "alpha"; } }
function nodoAplicarIconoCanal(){
  try{
    const beta = nodoGetCanal()==="beta";
    const box = document.getElementById("updaterBox"); if(box) box.style.borderColor = beta ? "rgba(34,197,94,.6)" : "#272b36"; // verde = beta
    const sel = document.getElementById("updaterCanal"); if(sel) sel.value = nodoGetCanal();
  }catch(_e){}
}
function nodoSetCanal(c){
  const canal = c==="beta" ? "beta" : "alpha";
  try{ localStorage.setItem("nodo_update_channel", canal); }catch(_e){}
  nodoAplicarIconoCanal();
  try{ toast("Canal: "+(canal==="beta"?"β Beta (repo del colega · pruebas)":"α Alpha (oficial · nuestro)")+" · tocá 🔄 para buscar en ese canal", "blue"); }catch(_e){}
}
async function nodoInitUpdater(){
  try{
    if(!window.updaterAPI){ const b=document.getElementById("updaterBox"); if(b) b.style.display="none"; return; }
    nodoAplicarIconoCanal();
    const v = await window.updaterAPI.getVersion();
    const el=document.getElementById("updaterVersionTxt");
    if(el && v && v.version) el.textContent = "v"+v.version;
    const mv=document.getElementById("updaterMiniVer");
    if(mv && v && v.version) mv.textContent = "v"+v.version;   // el plegado también dice la versión
    // Mostrar el botón "Volver" solo si la función existe (app instalada con updater).
    const rb=document.getElementById("updaterRollbackBtn"); if(rb) rb.style.display="";
    window.updaterAPI.onStatus(nodoUpdaterStatus);
    // Restaurar si el operador lo había dejado minimizado.
    try{ if(localStorage.getItem("nodo_updater_min")==="1") nodoUpdaterMinimizar(true); }catch(_e){}
    // Buscar SOLO. Antes esto no existía: la única forma de enterarse de que había una
    // versión nueva era apretar 🔄 por las dudas, así que no se enteraba nadie — la 1.1.81
    // salió y dos días después seguía sin instalarse en ninguna oficina, con máquinas
    // cuatro versiones atrás. Ahora chequea al arrancar y cada 3 horas.
    // Sigue SIN instalar por su cuenta: instalar reinicia la app y en medio del turno eso
    // corta la operación. Avisar es del panel, decidir cuándo cortar es del operador.
    setTimeout(nodoAutoBuscar, 20000);                 // dar tiempo al login
    setInterval(nodoAutoBuscar, 3*60*60*1000);
  }catch(_e){}
}
function nodoAutoBuscar(){
  try{
    if(window.updaterAPI && window.updaterAPI.check) window.updaterAPI.check({ channel: nodoGetCanal() });
  }catch(_e){}
}
// Arriba a la derecha, pero apoyado en el borde izquierdo del panel de chat: ahí está el hueco
// que queda arriba del botón "Rechequear". Se mide del DOM, así sigue bien si el chat se minimiza.
function _updaterAnclar(){
  try{
    const chat=document.getElementById("viewChat");
    let right=12;
    // En la pantalla de LOGIN el chat está tapado (el login ocupa toda la pantalla) pero sigue
    // midiendo: el cartel se enganchaba a su borde y quedaba flotando en el MEDIO del login. Juan
    // lo pidió dos veces; la primera se entendió mal y se movió la tira de proceso en vez de esto.
    // Sin el chat a la vista, el cartel va a la esquina.
    const login=document.getElementById("loginView");
    let enLogin=false;
    try{ enLogin=!!(login && !login.classList.contains("hidden") && getComputedStyle(login).display!=="none"); }catch(_e){}
    if(chat && !enLogin){
      const r=chat.getBoundingClientRect();
      if(r.width>0 && r.right>window.innerWidth-60) right=Math.round(window.innerWidth-r.left)+14;
    }
    ["updaterBox","updaterMiniChip"].forEach(function(id){
      const el=document.getElementById(id);
      if(el){ el.style.top="10px"; el.style.bottom="auto"; el.style.left="auto"; el.style.right=right+"px"; }
    });
  }catch(_e){}
}
window._updaterAnclar=_updaterAnclar;
try{
  addEventListener("resize", _updaterAnclar);
  setTimeout(_updaterAnclar, 1200);
  setInterval(_updaterAnclar, 5000);   // el panel de chat se minimiza/restaura sin avisar
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
  const r = await window.updaterAPI.check({ channel: nodoGetCanal() });
  if(!r || !r.ok){
    if(el) el.textContent = (r&&r.reason==="dev-mode") ? "Solo disponible en la app instalada." : "No se pudo buscar actualización.";
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

// ── Crear nuevo usuario en el casino ─────────────────────────────────────────
// prefUsuario/prefTelefono: para poder crear la cuenta DESDE la consulta del chat, con lo que el
// cliente ya declaró. Antes había que copiar los datos, irse al apartado manual, crear la cuenta
// allá, copiar el mensaje, volver al chat y recién ahí validar.
function abrirModalCrearUsuario(prefUsuario, prefTelefono, desdeChat){
  if(!window.ctrlElectron){ alert("Solo disponible en la app de escritorio."); return; }
  // ¿El alta salió de una consulta del chat? Entonces el aviso con los datos de ingreso tiene que
  // ir a ESE hilo. En un alta el chat está abierto con el apodo que puso el cliente ("lau"), no con
  // el alias que se acaba de crear, así que rutear por usuario no encontraba nada y el mensaje no
  // salía: por eso había que validar, y validar de nuevo, para que le llegara.
  window.__altaDesdeChat = !!desdeChat;
  const _pU = escapeHtml(String(prefUsuario||'').trim());
  const _pT = escapeHtml(String(prefTelefono||'').trim());
  abrirModal(
    '➕ Crear nuevo usuario',
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:12px">Se crea en el casino y queda <b>validado y agendado</b> en el mismo paso.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">USUARIO (alias)</label>' +
    '<input id="nuevoJugUsuario" type="text" placeholder="ej: martin2024" autocomplete="off" value="'+_pU+'" oninput="_altaNuevoCotejar()" style="margin-bottom:8px">' +
    // El teléfono es lo que ata la cuenta a la persona: sin él la cuenta nace suelta y cuando
    // entra al portal el cotejo no cierra — termina en soporte pidiendo que la validen a mano,
    // por algo que ya sabíamos en el momento de crearla.
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">TELÉFONO <span style="font-weight:400;text-transform:none;color:#777">(con código de área, sin 0 ni 15)</span></label>' +
    '<input id="nuevoJugTelefono" type="tel" inputmode="tel" placeholder="ej: 11 2345 6789" autocomplete="off" value="'+_pT+'" oninput="_altaNuevoCotejar()" style="margin-bottom:8px">' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">CLAVE INICIAL <span style="font-weight:400;text-transform:none;color:#777">(mín 6 caracteres)</span></label>' +
    '<input id="nuevoJugClave" type="text" placeholder="12345a" value="12345a" autocomplete="off" style="margin-bottom:4px">' +
    // El veredicto va ARRIBA del botón, no abajo: es lo que decide si hay que crear la cuenta o no.
    '<div id="nuevoJugCotejo" style="margin-top:8px"></div>' +
    '<div id="nuevoJugRes" style="min-height:16px;margin-top:4px"></div>',
    // El handler va ACÁ y no en el setTimeout de abajo: abrirModal deja el botón sin acción
    // (btn.onclick = saveFn || null) y se la asignábamos 30 ms después. En esa ventana el botón
    // estaba a la vista y no hacía nada. abrirModal ya limpia el onclick en cada apertura, así
    // que pasarlo directo no contamina nada.
    _ejecutarCrearUsuario,
    'Crear y copiar'
  );
  // Asignar handlers DESPUÉS de que abrirModal renderizó el overlay (evita contaminación de flujos anteriores)
  setTimeout(function(){
    // (el handler ya quedó puesto al abrir el modal)
    const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
    if(cancelBtn){ cancelBtn.onclick = function(){ cerrarModal(); }; }
    // Con los datos ya puestos, el foco va a lo que falta (la clave) y el cotejo corre solo: el
    // operador ve el veredicto sin tener que tocar nada.
    if(_pU && _pT){
      document.getElementById("nuevoJugClave")?.focus();
      try{ _altaNuevoCotejarYa(); }catch(_e){}
    } else {
      document.getElementById("nuevoJugUsuario")?.focus();
    }
  }, 30);
}

// Cotejo EN VIVO del alta, con la misma tarjeta de veredicto del modal de validar.
// Antes acá no se verificaba nada: el alias duplicado saltaba recién cuando el casino lo
// rechazaba, y el teléfono con dueño no saltaba NUNCA — la cuenta nacía pisando el número de
// otro usuario y el problema aparecía días después, del lado del jugador.
let _altaNuevoTimer = null;
function _altaNuevoCotejar(){
  try{ clearTimeout(_altaNuevoTimer); }catch(_e){}
  _altaNuevoTimer = setTimeout(_altaNuevoCotejarYa, 500);
}
async function _altaNuevoCotejarYa(){
  const box = document.getElementById('nuevoJugCotejo');
  if(!box) return;
  const u = (document.getElementById('nuevoJugUsuario')||{}).value || '';
  const t = (document.getElementById('nuevoJugTelefono')||{}).value || '';
  const uT = String(u).trim(), tT = String(t).trim();
  if(uT.length < 3 && tT.replace(/\D/g,'').length < 6){ box.innerHTML=''; box.__ultimo=''; return; }
  const marca = uT + '|' + tT;
  if(box.__ultimo === marca) return;          // no re-cotejar lo mismo en cada tecla
  box.__ultimo = marca;
  let r;
  try{ r = await window.altaCotejarDatos(uT, tT); }catch(_e){ box.innerHTML=''; return; }
  if(box.__ultimo !== marca) return;          // el operador siguió escribiendo
  const out = _altaCotejoHtml(uT, tT, r, '_altaNuevoUsarSugerencia', 'antes de crear');
  box.innerHTML = out.html;
  // Y que SUENE. Un cartel que aparece debajo del campo no lo ve quien está mirando el teclado:
  // así el choque de teléfono se descubría con la cuenta ya creada.
  if(out.alerta && box.__sono !== marca){
    box.__sono = marca;
    try{ sonido('solicitud'); }catch(_e){}
  }
}
window._altaNuevoCotejar = _altaNuevoCotejar;
// Los chips de la tarjeta ("usar «el alias que ya tiene ese número»") completan los campos.
window._altaNuevoUsarSugerencia = function(usuario, telefono){
  const iu = document.getElementById('nuevoJugUsuario');
  const it = document.getElementById('nuevoJugTelefono');
  if(iu && usuario) iu.value = usuario;
  if(it && telefono) it.value = telefono;
  try{ _altaNuevoCotejar(); }catch(_e){}
};

async function _ejecutarCrearUsuario(){
  const usuario = (document.getElementById("nuevoJugUsuario")?.value || "").trim().toLowerCase().replace(/\s+/g, "");
  const clave   = (document.getElementById("nuevoJugClave")?.value   || "").trim() || "12345a";
  const telefono= (document.getElementById("nuevoJugTelefono")?.value|| "").trim();
  const resEl   = document.getElementById("nuevoJugRes");
  const btn     = document.getElementById("modalSaveBtn");
  if(!usuario){ if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Ingresá un usuario.</span>'; return; }
  if(String(telefono).replace(/\D/g,"").length < 6){ if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Ingresá el teléfono: sin él la cuenta nace sin vincular y no va a poder operar en el portal.</span>'; return; }
  if(clave.length < 6){ if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">La clave debe tener al menos 6 caracteres.</span>'; return; }
  if(btn){ btn.disabled = true; btn.textContent = "Creando..."; }
  if(resEl) resEl.innerHTML = '<span style="color:#c0cad8;font-size:12px">Procesando...</span>';
  try {
    if(!await ensureDrexSession()){ if(btn){btn.disabled=false;btn.textContent='Crear y copiar';} return; }
    const r = await callDrex("crearUsuario", usuario, clave);
    if(r && r.ok !== false){
      const aliasFinal = r.alias || usuario;
      const claveFinal = r.password || clave;
      const texto = "Usuario: " + aliasFinal + "\nClave: " + claveFinal;
      try { await navigator.clipboard.writeText(texto); } catch(_){}
      toast("Usuario " + aliasFinal + " creado · vinculando el teléfono...", "green");
      // Auto-registrar el usuario recién creado en NODO en segundo plano
      _autoregistrarUsuarioSiFalta(aliasFinal);
      // Se sacó la pantalla de resultado propia del alta: repetía —peor— lo que ya hace la de
      // validación. Aquella sólo copiaba texto; ésta además vincula el teléfono, agenda en el
      // CRM, dispara Nexo, avisa por el chat del portal Y ofrece el enlace de WhatsApp que
      // deja a la persona adentro ya validada. Eran dos pantallas para el mismo momento, y la
      // buena quedaba escondida detrás de otro flujo.
      // La clave recién elegida viaja por acá porque ejecutarVincular no la conoce y el modal
      // de resultado, si no, ofrece copiar el mensaje con "12345a" fijo — que sería mentira
      // cuando el operador puso otra.
      try{ window._altaClaveNueva = claveFinal; }catch(_e){}
      // La clave del alta sólo vivía en memoria: cerrabas el panel y se perdía. Queda
      // registrada igual que un cambio de clave, así "Datos de ingreso" la puede mostrar
      // después sin tener que resetearla.
      try{
        await registrarEnHistorial({ usuario: aliasFinal, tipo:'RESET_CLAVE', monto:0,
          origen:'MANUAL', estado:'OK', notas:'clave → '+claveFinal+' · alta' });
      }catch(_e){}
      try{ cerrarModal(); }catch(_e){}
      await ejecutarVincular(aliasFinal, telefono, !!window.__altaDesdeChat);
      return;
    } else if(r?.error === 'duplicado'){
      // Alias duplicado → buscar y proponer alternativas que NO estén usadas
      if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;margin-top:8px">❌ El alias <b>'+escapeHtml(usuario)+'</b> ya existe.<br><span class="small">Buscando alternativas disponibles...</span></div>';
      if(btn){ btn.disabled = false; btn.textContent = 'Crear y copiar'; }
      const libres = await _generarAlternativasAlias(usuario, 6);
      let extra = '';
      if(libres.length){
        extra = '<div style="margin-top:8px;font-size:12px;color:#c0cad8">Alternativas libres en NODO (click para usar):</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' +
                  libres.map(function(a){
                    return '<button class="mini-btn blue" style="font-size:12px" onclick="_usarAlternativaAlias(\''+escapeHtml(a)+'\')">'+escapeHtml(a)+'</button>';
                  }).join('') +
                '</div>';
      } else {
        extra = '<div style="margin-top:8px;font-size:12px;color:var(--muted)">No se generaron alternativas libres. Probá con otra base.</div>';
      }
      if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;margin-top:8px">❌ El alias <b>'+escapeHtml(usuario)+'</b> ya existe en el casino.'+extra+'</div>';
    } else {
      const msg = r?.message || "No se pudo crear el usuario.";
      if(resEl) resEl.innerHTML = '<div class="err-box" style="margin-top:8px">❌ ' + escapeHtml(msg) + '</div>';
      if(btn){ btn.disabled = false; btn.textContent = 'Crear y copiar'; }
    }
  } catch(e){
    if(resEl) resEl.innerHTML = '<div class="err-box" style="margin-top:8px">Error: ' + escapeHtml(e.message||'sin detalle') + '</div>';
    if(btn){ btn.disabled = false; btn.textContent = 'Crear y copiar'; }
  }
}

// Genera N variantes del alias y descarta las que ya están en nuestra base de usuarios.
// Estrategias: número creciente (1..99), sufijos comunes, año actual.
async function _generarAlternativasAlias(base, cantidad){
  const limpio = String(base||'').toLowerCase().replace(/[^a-z0-9]/g, '');
  if(!limpio) return [];
  const ano = new Date().getFullYear();
  const candidatos = [];
  // Números crecientes
  for(let i = 1; i <= 30; i++){
    candidatos.push(limpio + i);
  }
  // Sufijos
  const sufijos = ['ok','ar','mp','bet','777','999','x', String(ano), String(ano).slice(-2)];
  for(const s of sufijos){
    candidatos.push(limpio + s);
  }
  // Filtrar los que YA existen en nuestra base local (cualquier oficina, indistinto)
  const unicos = [...new Set(candidatos)];
  try {
    const { data } = await supabaseClient
      .from('usuarios')
      .select('usuario')
      .in('usuario', unicos);
    const existentes = new Set((data||[]).map(function(u){ return u.usuario; }));
    return unicos.filter(function(c){ return !existentes.has(c); }).slice(0, cantidad);
  } catch(_){
    return unicos.slice(0, cantidad);
  }
}

// Pone una alternativa elegida en el input del modal
function _usarAlternativaAlias(alias){
  const input = document.getElementById("nuevoJugUsuario");
  if(input){ input.value = alias; input.focus(); }
}

async function _resetClaveManual(usuario, clave){
  // Compatibilidad: ahora se usa blanquearClaveManual() desde el botón
  try {
    toast("Cambiando clave de "+usuario+"...","blue");
    const r = await callDrex("cambiarClave", clave);
    await registrarEnHistorial({usuario, tipo:'RESET_CLAVE', monto:0, origen:'MANUAL', estado:(r&&r.ok!==false)?'OK':'ERROR', notas:'clave → '+clave});
    toast("Clave cambiada OK","green");
  } catch(e) { toast("Error al cambiar clave: "+(e.message||""),"red"); }
}

// ── Historial de operaciones ───────────────────────────────────────────────────
let _historialData = [];
let _historialCargado = false;

// Columnas opcionales que pueden NO existir en la tabla (según versión del schema).
// Si el insert falla por alguna de estas, las quitamos y reintentamos.
const _HISTORIAL_COLS_OPCIONALES = ['saldo_pre', 'saldo_post', 'chunior_movimiento_id', 'reversion_de', 'solicitud_id'];
// Columnas que YA detectamos que no existen → no las mandamos más (evita 400 repetidos).
const _HISTORIAL_COLS_INEXISTENTES = new Set();

// ══════════════════════════════════════════════════════════════════════════
// ÁRBOL DE OPERACIONES DEL USUARIO (portado del NODO del colega · NexoBetaChan 1.0.82)
// Store local de movimientos (localStorage) — guarda titular/CBU/obs que Supabase no siempre
// persiste y sobrevive reinicios — + merge con _historialData + modal detalle/árbol.
// Se abre desde el Historial con 🔍 y se alimenta desde registrarEnHistorial.
// ══════════════════════════════════════════════════════════════════════════
const MOV_STORE_KEY = 'nodo_movimientos_v1';
function _movStoreAll(){
  try{ return JSON.parse(localStorage.getItem(MOV_STORE_KEY)||'{}')||{}; }catch(_e){ return {}; }
}
function _movStoreSave(map){
  try{
    const keys = Object.keys(map);
    if(keys.length > 2000){
      keys.map(function(k){return {k:k,ts:map[k]._ts||0};}).sort(function(a,b){return a.ts-b.ts;})
        .slice(0, keys.length-2000).forEach(function(x){ delete map[x.k]; });
    }
    localStorage.setItem(MOV_STORE_KEY, JSON.stringify(map));
  }catch(_e){}
}
function _movParseNotas(notas){
  const s = String(notas||'');
  const grab = function(re){ const m = s.match(re); return m ? m[1].trim() : ''; };
  return {
    titular: grab(/Titular:\s*([^·|]+)/i),
    destino: grab(/Destino:\s*([^·|]+)/i),
    cbu:     grab(/CBU\/?\s*C?V?U?:\s*([^·|]+)/i),
    obs:     grab(/Obs:\s*([^·|]+)/i)
  };
}
window.guardarMovimientoLocal = function guardarMovimientoLocal(rec){
  if(!rec || !rec.usuario) return;
  try{
    const map = _movStoreAll();
    const key = String(rec.id!=null ? rec.id : (rec.usuario+'_'+(rec.ts||Date.now())));
    const prev = map[key] || {};
    const parsed = _movParseNotas(rec.notas);
    const pick = function(a,b){ return (a!==undefined && a!==null && a!=='') ? a : b; };
    map[key] = {
      id: pick(rec.id, prev.id!=null?prev.id:null),
      usuario: String(rec.usuario||prev.usuario||''),
      tipo: pick(rec.tipo, prev.tipo||''),
      monto: pick(rec.monto, prev.monto!=null?prev.monto:0),
      titular: pick(rec.titular, pick(parsed.titular, prev.titular||'')),
      destino: pick(rec.destino, pick(parsed.destino, prev.destino||'')),
      cbu: pick(rec.cbu, pick(parsed.cbu, prev.cbu||'')),
      obs: pick(rec.obs, pick(parsed.obs, prev.obs||'')),
      saldoPre: pick(rec.saldoPre, prev.saldoPre!=null?prev.saldoPre:null),
      saldoPost: pick(rec.saldoPost, prev.saldoPost!=null?prev.saldoPost:null),
      billeteraNombre: pick(rec.billeteraNombre, prev.billeteraNombre||''),
      operador: pick(rec.operador, prev.operador||''),
      estado: pick(rec.estado, prev.estado||''),
      chuniorId: pick(rec.chuniorId, prev.chuniorId||null),
      solicitudId: pick(rec.solicitudId, prev.solicitudId||null),
      bonoPct: pick(rec.bonoPct, prev.bonoPct||null),
      origen: pick(rec.origen, prev.origen||''),
      notas: pick(rec.notas, prev.notas||''),
      _ts: rec.ts || prev._ts || Date.now(),
      _fecha: rec.fecha || prev._fecha || new Date().toISOString()
    };
    _movStoreSave(map);
    // Auto-alimenta la base local de JUGADORES (CBUs/titulares) desde cada movimiento.
    try{
      const _m = map[key];
      if(window.jugadorRegistrarDato && _m && _m.usuario){
        const _esRet = String(_m.tipo||'').toUpperCase()==='RETIRO';
        if((_esRet && (_m.cbu||_m.destino)) || _m.titular)
          window.jugadorRegistrarDato(_m.usuario, { cbu:_esRet?(_m.cbu||_m.destino):'', titular:_m.titular, fecha:_m._fecha });
      }
    }catch(_e){}
  }catch(_e){}
};
function _capturarMovimientoDesdeHistorial(data, row){
  try{
    const src = data || {}, r = row || {};
    const pick = function(a,b){ return (a!==undefined && a!==null && a!=='') ? a : b; };
    guardarMovimientoLocal({
      id: pick(src.id, r.id!=null?r.id:null),
      usuario: pick(src.usuario, r.usuario),
      tipo: pick(src.tipo, r.tipo),
      monto: pick(src.monto, r.monto),
      saldoPre: pick(src.saldo_pre, r.saldo_pre),
      saldoPost: pick(src.saldo_post, r.saldo_post),
      billeteraNombre: pick(src.billetera_nombre, r.billetera_nombre),
      operador: pick(src.operador, r.operador),
      estado: pick(src.estado, r.estado),
      chuniorId: pick(src.chunior_movimiento_id, r.chunior_movimiento_id),
      solicitudId: pick(src.solicitud_id, r.solicitud_id),
      origen: pick(src.origen, r.origen),
      notas: pick(src.notas, r.notas),
      fecha: src.created_at || new Date().toISOString(),
      ts: Date.now()
    });
    try{
      if(typeof _archivoHistorialMerge === 'function'){
        const fila = {
          id: pick(src.id, r.id!=null ? r.id : ('loc_'+Date.now()+'_'+Math.random().toString(36).slice(2,7))),
          usuario: pick(src.usuario, r.usuario), tipo: pick(src.tipo, r.tipo), monto: pick(src.monto, r.monto),
          saldo_pre: pick(src.saldo_pre, r.saldo_pre), saldo_post: pick(src.saldo_post, r.saldo_post),
          billetera_nombre: pick(src.billetera_nombre, r.billetera_nombre), operador: pick(src.operador, r.operador),
          estado: pick(src.estado, r.estado), chunior_movimiento_id: pick(src.chunior_movimiento_id, r.chunior_movimiento_id),
          solicitud_id: pick(src.solicitud_id, r.solicitud_id), origen: pick(src.origen, r.origen),
          notas: pick(src.notas, r.notas), created_at: src.created_at || new Date().toISOString()
        };
        _archivoHistorialMerge([fila]);
      }
    }catch(_e){}
    // Tiempo real → Nexo: cada movimiento capturado dispara un sync (debounce 6s en _nexoTrigger).
    try{ if(window._nexoTrigger) window._nexoTrigger(); }catch(_e){}
  }catch(_e){}
}

// ══════════════════════════════════════════════════════════════════════════
// INTEGRACIÓN CON NEXO (opcional, no estricta · portado de NexoBetaChan). Contrato verificado:
// nodo es DUEÑO de %APPDATA%\nexo-desktop\shared\nodo-datos.json (JSON PLANO). Nexo lo lee al abrir
// y fusiona. Join por alias normalizado (Nexo normaliza; nodo manda el usuario tal cual). Schema:
//   { schemaVersion:1, generatedAt, usuarios:[{ alias, telefono, titular, portalActivo, operaciones:[
//       { ts, amount(>0 carga /<0 retiro), tipo, medio, cbu, titular, operador } ] , bonos:[...] }] }
// Nexo dedup por ts+amount → mandamos todo el historial siempre (idempotente). Si Nexo NO está
// instalado (no existe %APPDATA%\nexo-desktop) → el write devuelve installed:false y no hace NADA.
// telefono + titular a NIVEL USUARIO completan el registro (el tel llega con la solicitud y ya
// quedó en el jug store; el titular sale de los retiros conocidos). Depende de la base local de
// JUGADORES (abajo) y de _movParseNotas / pcAliasesHist / historial_ops.
// ══════════════════════════════════════════════════════════════════════════
const _NEXO_OK_ESTADOS = ['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA'];
function _nexoBonoDesc(pct){
  pct = Number(pct||0);
  let extra = '';
  if(pct>=50) extra = ' + notificaciones + app';
  else if(pct>=40) extra = ' + app instalada';
  else if(pct>=30) extra = ' + notificaciones';
  return 'Bono de primer ingreso'+extra+(pct?(' ('+pct+'%)'):'');
}
// Historia COMPLETA desde Supabase (Nexo quiere TODO, no solo lo local de la sesión). Cache 15 min;
// el sync la mezcla con el archivo local (que trae lo de tiempo real).
window._nexoOpsCache = window._nexoOpsCache || null;
window._nexoOpsCacheAt = window._nexoOpsCacheAt || 0;
async function _nexoCargarOpsCompletas(force){
  const FRESH = 15*60*1000;
  if(!force && window._nexoOpsCache && (Date.now()-window._nexoOpsCacheAt) < FRESH) return window._nexoOpsCache;
  try{
    if(typeof supabaseClient==='undefined' || !supabaseClient) return window._nexoOpsCache||[];
    const pcs = (typeof pcAliasesHist==='function') ? pcAliasesHist() : [];
    let todas = [], desde = 0; const PAG = 1000, MAX = 8000;
    while(desde < MAX){
      const { data, error } = await supabaseClient.from('historial_ops')
        .select('id,usuario,tipo,monto,billetera_nombre,origen,estado,notas,created_at,operador,chunior_movimiento_id')
        .in('pc_codigo', pcs)
        .order('created_at',{ascending:false})
        .range(desde, desde+PAG-1);
      if(error || !data || !data.length) break;
      todas = todas.concat(data);
      if(data.length < PAG) break;
      desde += PAG;
    }
    if(todas.length){ window._nexoOpsCache = todas; window._nexoOpsCacheAt = Date.now(); }
  }catch(_e){}
  return window._nexoOpsCache || [];
}
// opsExtra = historia completa de Supabase. Se mergea con el archivo local + movStore (dedup por id)
// → el payload lleva TODO el historial, no solo lo de esta sesión.
function _nexoBuildPayload(opsExtra){
  const jug = (typeof _jugStoreAll==='function') ? _jugStoreAll() : {};
  const _byId = {};
  ((typeof _archivoHistorialCargar==='function') ? _archivoHistorialCargar() : []).forEach(function(h){ if(h&&h.id!=null) _byId[String(h.id)]=h; });
  (Array.isArray(opsExtra)?opsExtra:[]).forEach(function(h){ if(h&&h.id!=null && !_byId[String(h.id)]) _byId[String(h.id)]=h; });
  try{ if(typeof _movStoreToHistRows==='function') _movStoreToHistRows().forEach(function(h){ if(h&&h.id!=null && !_byId[String(h.id)]) _byId[String(h.id)]=h; }); }catch(_e){}
  const ops = Object.keys(_byId).map(function(k){ return _byId[k]; });
  const porUsuario = {};
  ops.forEach(function(h){
    const usuario = String(h.usuario||'').trim(); if(!usuario) return;
    const tipoU = String(h.tipo||'').toUpperCase();
    if(tipoU!=='CARGA' && tipoU!=='RETIRO') return;                         // solo cargas/retiros
    if(String(h.origen||'').toUpperCase()==='PROMO_BONO') return;           // los bonos van aparte (campo bonos)
    if(!_NEXO_OK_ESTADOS.includes(String(h.estado||'').toUpperCase())) return; // solo las efectivas
    const ts = h.created_at ? new Date(h.created_at).getTime() : 0; if(!ts) return;
    const monto = Math.abs(Number(h.monto||0)); if(!monto) return;
    const esRet = tipoU==='RETIRO';
    const p = (typeof _movParseNotas==='function') ? _movParseNotas(h.notas) : {titular:'',cbu:'',destino:''};
    const k = usuario.toLowerCase();
    if(!porUsuario[k]) porUsuario[k] = { alias:usuario, telefono:'', titular:'', portalActivo:false, _seen:{}, operaciones:[] };
    const g = porUsuario[k];
    const _origen = String(h.origen||'').toUpperCase();
    const _esPortal = /PORTAL|LANDING/.test(_origen);
    if(_esPortal) g.portalActivo = true;
    const dk = ts+'|'+(esRet?-monto:monto);
    if(g._seen[dk]) return; g._seen[dk]=1;                                   // dedup local por ts+amount
    g.operaciones.push({
      ts: ts,
      amount: esRet ? -monto : monto,                                       // >0 carga · <0 retiro
      tipo: esRet ? 'retiro' : 'carga',
      // CANAL: separa a los que cargan por PORTAL de los que lo hacen por WhatsApp/manual. El tipo de
      // origen ya divide a los usuarios en el panel → se lo pasamos a Nexo para que los segmente igual.
      canal: _esPortal ? 'portal' : 'whatsapp',
      origen: _origen || '',                                                // origen crudo (PORTAL/LANDING/MANUAL/PANEL/CHAT) por si Nexo quiere más granularidad
      medio: String(h.billetera_nombre||'').trim(),                         // etiqueta de billetera nuestra
      cbu: esRet ? String(p.cbu||p.destino||'').trim() : '',               // alias/CBU del usuario (retiros)
      titular: esRet ? String(p.titular||'').trim() : '',                  // titular de esa cuenta (retiros)
      operador: String(h.operador||'').trim()
    });
  });
  // ALTAS / VALIDACIONES SIN OPERACIONES: un usuario recién validado (o creado) todavía no cargó
  // nunca → no aparece en `ops` y antes NO se enviaba a Nexo. Lo sembramos desde la base local de
  // jugadores para que Nexo tenga la ficha (alias + teléfono + titular) desde el momento del alta:
  // Nexo es la base donde después se verifican los datos.
  Object.keys(jug||{}).forEach(function(k){
    if(porUsuario[k]) return;
    const j=jug[k]||{};
    const tieneDatos = (j.telefonos && Object.keys(j.telefonos).length) || (j.titulares && Object.keys(j.titulares).length);
    if(!tieneDatos) return;
    porUsuario[k]={ alias:j.usuario||k, telefono:'', titular:'', portalActivo:false, _seen:{}, operaciones:[], altaSinOperaciones:true };
  });
  Object.keys(porUsuario).forEach(function(k){
    const j = jug[k];
    // TELÉFONO (nivel usuario · completa la base de Nexo): el que llega con la solicitud ya quedó en
    // el jug store. Elegimos el verificado; si no, el más visto.
    if(j && j.telefonos){
      const tels = Object.keys(j.telefonos);
      if(tels.length){
        tels.sort(function(a,b){ const A=j.telefonos[a]||{}, B=j.telefonos[b]||{}; return ((B.verificado?1:0)-(A.verificado?1:0)) || ((B.veces||0)-(A.veces||0)); });
        porUsuario[k].telefono = tels[0];
      }
    }
    // TITULAR (nivel usuario · completa la base de Nexo): el titular más visto del jugador (de sus
    // retiros/CBUs conocidos). Va a nivel usuario, no solo por operación de retiro.
    if(j && j.titulares){
      const tits = Object.values(j.titulares);
      if(tits.length){
        tits.sort(function(a,b){ return (b.veces||0)-(a.veces||0); });
        if(tits[0] && tits[0].raw) porUsuario[k].titular = tits[0].raw;
      }
    }
    // Bonos DESTACADOS con tipo + descripción (de la base local de jugadores).
    if(j && Array.isArray(j.bonos) && j.bonos.length){
      porUsuario[k].bonos = j.bonos.map(function(b){
        return {
          tipo: 'ingreso',
          pct: Number(b.pct||0)||null,
          monto: Number(b.monto||0)||null,
          estado: (String(b.estado||'').toUpperCase()==='APLICADO') ? 'aplicado' : 'pendiente',
          ts: b.fecha ? new Date(b.fecha).getTime() : null,
          descripcion: _nexoBonoDesc(b.pct)
        };
      });
    }
    delete porUsuario[k]._seen;
  });
  // ── IPs desde las que operó ────────────────────────────────────────────────
  // Se saca de las solicitudes del portal que ya están en memoria (metadata.ip) y se manda a
  // Nexo. NODO NO la guarda en ninguna base propia: acá es un dato de paso. La acumulación
  // histórica vive en Nexo, que es donde tiene sentido cruzarla.
  //
  // Para qué: ver cuántas cuentas salen de la MISMA conexión — probabilidad de que sean la
  // misma persona o gente cercana.
  //
  // Cómo NO usarla: con CGNAT y redes móviles muchos vecinos comparten IP pública. Coincidir
  // es una señal para mirar, no una prueba. Y NO se usa para bloquear: un bloqueo automático
  // por IP en manos de siete oficinas distintas deja gente afuera por vivir en el edificio
  // equivocado, y nadie va a poder explicar por qué.
  try{
    const _sols = (window.V154P && window.V154P.solicitudes) || [];
    _sols.forEach(function(s){
      const u = String(s.USUARIO || s.USUARIO_JUGADOR || '').trim().toLowerCase();
      const ip = String(s.IP || '').trim();
      if(!u || !ip || !porUsuario[u]) return;
      const g = porUsuario[u];
      if(!g.ips) g.ips = [];
      const prev = g.ips.find(function(x){ return x.ip === ip; });
      const ts = s.FECHA_CREACION ? new Date(s.FECHA_CREACION).getTime() : 0;
      if(prev){ prev.veces++; if(ts > (prev.ultima||0)) prev.ultima = ts; }
      else if(g.ips.length < 12){ g.ips.push({ ip: ip, veces: 1, ultima: ts }); }
    });
    Object.keys(porUsuario).forEach(function(k){
      const g = porUsuario[k];
      if(g.ips) g.ips.sort(function(a,b){ return (b.veces||0)-(a.veces||0); });
    });
  }catch(_e){}
  // Se envían: los que operaron, los que tienen bonos, y las ALTAS con teléfono/titular (agendados).
  const usuarios = Object.values(porUsuario).filter(function(u){
    return u.operaciones.length || (u.bonos&&u.bonos.length) || u.telefono || u.titular;
  });
  // pc_codigo = la LLAVE de oficina. Nexo no debe tener ninguna oficina configurada a mano: le
  // pregunta a NODO (leyendo este archivo) de qué oficina es esta PC. NODO es el único que lo sabe
  // de verdad — lo detecta de Chunior al loguear, no sale de la ruta de instalación ni de un
  // config. Así el mismo instalador de Nexo sirve en cualquier máquina. Ver NEXO_INTEGRACION.md.
  const _pc = String((typeof pcOperativa!=='undefined' && pcOperativa) || window.pcOperativa || '').trim();
  return {
    schemaVersion:3,
    generatedAt:new Date().toISOString(),
    pc_codigo:_pc || null,                 // null = NODO todavía no sabe la oficina → Nexo NO asume ninguna
    operador:(window.operador && (window.operador.usuario||window.operador.nombre)) || '',
    // A QUÉ SERVIDOR apuntar. Hay más de un Supabase en juego (mirá el bloque de SUPABASE_URL: hay
    // otro comentado) y se cambia editando el código. Si Nexo lo tuviera hardcodeado, al cambiar de
    // servidor quedaría leyendo el viejo —datos de otra base— sin que nadie se entere. Mandándolo
    // desde acá, Nexo siempre habla con el MISMO servidor que NODO, sin configurar nada.
    // La key es la publishable (anon): ya viaja dentro de la app en cada máquina y está protegida
    // por RLS. No es un secreto; el secreto es PANEL_DATA_SECRET, que NO se manda.
    supabase:{ url:SUPABASE_URL, key:SUPABASE_KEY },
    // Acuse de los pedidos que Nexo encoló y NODO aplicó. Con esto Nexo los saca de su cola; los
    // que no aparezcan acá los reintenta (es idempotente, reintentar de más no rompe nada).
    pedidosAplicados: (window._nexoAcuses||[]).slice(),
    usuarios:usuarios
  };
}
// ══════════════════════════════════════════════════════════════════════════════════════════
// PEDIDOS DE NEXO · Nexo encola, NODO aplica
// Nexo no puede escribir identidades: panel_vincular_usuario exige PANEL_DATA_SECRET y ese secreto
// no se comparte. Entonces Nexo deja sus pedidos en nexo-pedidos.json y NODO los aplica con su
// secreto. Nadie comparte nada y NODO decide qué se escribe.
// El acuse ({id, ok, error, ts}) viaja en el próximo nodo-datos.json; con eso Nexo saca el pedido
// de su cola. Sin acuse lo reintenta — es idempotente.
//
// ⚠ CANDADO: mientras panel_vincular_usuario compare el usuario CRUDO (bug documentado, fix en
// SQL_fix_vincular_usuario_limpio.sql), cada pedido puede DUPLICAR al usuario en el servidor. Por
// eso esto arranca APAGADO. Se prende con window.nexoPedidosActivar(true) DESPUÉS de aplicar el
// SQL. Lo pidió el propio lado de Nexo y tiene razón.
// ══════════════════════════════════════════════════════════════════════════════════════════
window.nexoPedidosActivar = function(on){
  try{ localStorage.setItem('nodo_nexo_pedidos', on===true?'1':'0'); }catch(_e){}
  toast(on===true ? '✅ Pedidos de Nexo ACTIVADOS' : '⛔ Pedidos de Nexo apagados', on===true?'green':'yellow');
};
function _nexoPedidosActivo(){ try{ return localStorage.getItem('nodo_nexo_pedidos')==='1'; }catch(_e){ return false; } }

window._nexoAcuses = [];        // {id, ok, error, ts} — se vacía cuando se escriben en el payload
let _nexoPedidosCorriendo = false;

async function _nexoProcesarPedidos(){
  if(!_nexoPedidosActivo()) return;
  if(_nexoPedidosCorriendo) return;
  if(!window.nexoFile || !window.nexoFile.pedidos) return;   // build viejo sin el puente de lectura
  if(!pcOperativa || !window.PANEL_DATA_SECRET) return;
  _nexoPedidosCorriendo = true;
  try{
    const r = await window.nexoFile.pedidos();
    if(!r || !r.ok || !Array.isArray(r.pedidos) || !r.pedidos.length) return;
    // La oficina del archivo tiene que ser LA MÍA. Si no, es de otra PC y no lo tocamos.
    if(r.pc_codigo && String(r.pc_codigo).trim().toUpperCase() !== String(pcOperativa).trim().toUpperCase()){
      console.warn('[nexo] pedidos de otra oficina ('+r.pc_codigo+' ≠ '+pcOperativa+') — ignorados');
      return;
    }
    const yaAcusados = new Set((window._nexoAcuses||[]).map(function(a){ return String(a.id); }));
    for(const p of r.pedidos){
      const id = String((p&&p.id)||''); if(!id || yaAcusados.has(id)) continue;
      const acuse = { id:id, ok:false, error:null, ts:Date.now() };
      try{
        if(String(p.tipo||'') !== 'vincular_telefono'){ acuse.error='tipo no soportado: '+p.tipo; }
        else if(!p.usuario || !p.telefono){ acuse.error='faltan usuario o teléfono'; }
        else{
          // SIN p_forzar: Nexo sólo debe encolar HUECOS (usuario sin teléfono en el servidor). Si
          // hay conflicto, que lo resuelva un operador mirando el cotejo — no un pedido automático.
          const rr = await supabaseClient.rpc('panel_vincular_usuario',{
            p_secret:window.PANEL_DATA_SECRET, p_pc_codigo:pcOperativa,
            p_usuario:String(p.usuario), p_telefono:String(p.telefono)
          });
          const d = (rr && rr.data) || {};
          if(rr.error) acuse.error = rr.error.message || 'error de RPC';
          else if(!d.ok) acuse.error = d.mensaje || (d.conflicto_tel ? ('conflicto: el teléfono es de '+(d.usuario_actual||'otro')) : 'rechazado');
          else acuse.ok = true;
        }
      }catch(e){ acuse.error = e.message || String(e); }
      window._nexoAcuses.push(acuse);
      console.log('[nexo] pedido '+id+' · '+(acuse.ok?'OK':'falló: '+acuse.error));
    }
    if(window._nexoAcuses.length){ try{ nexoSync(false); }catch(_e){} }   // devolver los acuses ya
  }catch(e){ console.warn('[nexo] procesar pedidos falló:', e.message||e); }
  finally{ _nexoPedidosCorriendo = false; }
}
window._nexoProcesarPedidos = _nexoProcesarPedidos;

let _nexoSyncing=false; window._nexoLastOk=0;
async function nexoSync(verbose){
  if(!window.nexoFile || !window.nexoFile.write || _nexoSyncing) return; // sin bridge (no desktop) → nada
  _nexoSyncing=true;
  try{
    const opsFull = await _nexoCargarOpsCompletas();      // historia COMPLETA de Supabase (cacheada 15 min)
    const payload = _nexoBuildPayload(opsFull);
    if(!payload.usuarios.length){ if(verbose) console.log('[nexo] nada para enviar todavía'); return; }
    const wr = await window.nexoFile.write(JSON.stringify(payload));
    if(wr && wr.ok){
      window._nexoLastOk=Date.now();
      // Los acuses ya viajaron en ESTE archivo: se sacan de la cola local. Se descuentan sólo los
      // que se escribieron, no todos — si entró un acuse nuevo mientras se armaba el payload, ese
      // tiene que salir en el próximo, no perderse acá.
      try{
        const idsEnviados = new Set((payload.pedidosAplicados||[]).map(function(a){ return String(a.id); }));
        window._nexoAcuses = (window._nexoAcuses||[]).filter(function(a){ return !idsEnviados.has(String(a.id)); });
      }catch(_e){}
      const nops = payload.usuarios.reduce(function(a,u){return a+u.operaciones.length;},0);
      console.log('[nexo] sync OK · '+payload.usuarios.length+' usuarios · '+nops+' ops · '+(wr.bytes||0)+' bytes');
      if(verbose){ try{toast('🟢 Nexo: '+payload.usuarios.length+' usuarios · '+nops+' ops','green');}catch(_e){} }
    } else if(wr && wr.instalado===false){
      if(verbose){ console.log('[nexo] Nexo NO instalado (no existe %APPDATA%\\nexo-desktop) → no se escribió'); try{toast('Nexo no está instalado en esta PC','yellow');}catch(_e){} }
    } else if(verbose){ console.warn('[nexo] no se pudo escribir:', wr&&wr.error); try{toast('⚠ Nexo: '+((wr&&wr.error)||'error'),'red');}catch(_e){} }
  }catch(_e){ if(verbose) console.warn('[nexo] sync error', _e); }
  finally{ _nexoSyncing=false; }
}
window.nexoSync = nexoSync;
// Trigger EN TIEMPO REAL: cada operación llama a esto; debounce 6s (agrupa ráfagas) → sync a Nexo.
let _nexoTimer=null;
window._nexoTrigger = function(){ try{ clearTimeout(_nexoTimer); _nexoTimer=setTimeout(function(){ nexoSync(false); }, 6000); }catch(_e){} };
// Comando de consola:  nexo() = estado  ·  nexo('sync') = forzar envío ahora.
window.nexo = async function(cmd){
  if(cmd==='sync' || cmd==='forzar'){ return nexoSync(true); }
  try{
    const st = window.nexoFile ? await window.nexoFile.estado() : null;
    if(!st){ console.log('%c[nexo]','color:#22c55e','sin bridge (¿app de escritorio?)'); return; }
    console.log('%c[nexo]','color:#22c55e;font-weight:800',
      (st.instalado?'✅ Nexo instalado':'❌ Nexo NO instalado')+' · archivo: '+st.path+
      (st.existeArchivo?(' · '+st.bytes+' bytes · '+st.mtime):' · aún no escrito')+
      ' · última sync: '+(window._nexoLastOk?new Date(window._nexoLastOk).toLocaleString('es-AR'):'—')+
      '  ·  nexo("sync") para forzar');
    return st;
  }catch(e){ console.warn('[nexo]', e); }
};
// Sync periódico → Nexo redibuja en cada uno (escribe siempre, aunque no cambien datos, así el mtime
// se actualiza y Nexo relee). Configurable con window._nexoIntervaloMs (default 90s).
window._nexoIntervaloMs = window._nexoIntervaloMs || 90000;
try{ setInterval(function(){ nexoSync(false); }, window._nexoIntervaloMs); }catch(_e){}
// Los pedidos de Nexo se revisan en el mismo ciclo. Arranca APAGADO (ver nexoPedidosActivar):
// mientras el fix de panel_vincular_usuario no esté aplicado, aplicar pedidos duplica usuarios.
try{ setInterval(function(){ _nexoProcesarPedidos(); }, window._nexoIntervaloMs); }catch(_e){}
try{ setTimeout(function(){ nexoSync(true); }, 20000); }catch(_e){}   // primer envío (visible en consola/toast)

// ── Base local de JUGADORES (CRM-lite · portado de NexoBetaChan 1.0.85) ──────────
// Modelo PAM (KYC-lite): por jugador guarda teléfonos (verificación), INSTRUMENTOS DE PAGO
// (cbu/alias; verificado = ya cobró ahí de verdad) y TITULARES + estado de bonos. Todo LOCAL
// (localStorage) — NO carga Supabase (los movimientos ya viven en Chunior). Se auto-alimenta
// desde guardarMovimientoLocal (manual + portal) y se siembra una vez desde el store de movimientos.
const JUG_STORE_KEY = 'nodo_jugadores_local_v2';
function _jugStoreAll(){
  try{ return JSON.parse(localStorage.getItem(JUG_STORE_KEY)||'{}')||{}; }catch(_e){ return {}; }
}
function _jugStoreSave(map){
  try{ localStorage.setItem(JUG_STORE_KEY, JSON.stringify(map)); }catch(_e){}
}
// Normaliza un CBU/CVU/alias para comparar (case/espacios/puntos no cambian el destino).
function _jugNormCbu(v){ return String(v||'').toLowerCase().replace(/[\s.\-]/g,'').trim(); }

// ══════════════════════════════════════════════════════════════════════════════
// TITULARES BLOQUEADOS (portado de NexoBetaChan · rama unificacion)
// Sale de la auditoría de multicuenta: encontramos 52 redes de titulares que
// cobran a varias cuentas, pero no había forma de ACTUAR sobre ellas. Esto es
// esa acción: marcar un titular para que la próxima solicitud quede señalada.
//
// DIFERENCIA con la versión del colega: la de ellos bloquea por par
// usuario+titular. Para nuestro caso no alcanza — "rodrigo ismael flores" opera
// con 7 usuarios distintos, así que habría que bloquearlo 7 veces y bastaría
// una cuenta nueva para esquivarlo. Se agrega el bloqueo GLOBAL (clave "*"),
// que es el que sirve contra las redes.
//
// Es LOCAL (localStorage) igual que la base de jugadores: no se comparte entre
// PCs. Bloquear en P2 no bloquea en P4.
// ══════════════════════════════════════════════════════════════════════════════
const _RECH_KEY = 'nodo_titulares_rechazados';
function _rechStore(){ try{ return JSON.parse(localStorage.getItem(_RECH_KEY)||'{}')||{}; }catch(_e){ return {}; } }
function _rechSave(m){ try{ localStorage.setItem(_RECH_KEY, JSON.stringify(m)); }catch(_e){} }
function _normNombre(v){
  return String(v||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}
window._normNombre = _normNombre;
function _rechClave(usuario, titular){ return String(usuario||'').toLowerCase().trim()+'|'+_normNombre(titular); }
function _rechClaveGlobal(titular){ return '*|'+_normNombre(titular); }

// Devuelve null, {global:false} o {global:true} — el llamador decide cómo mostrarlo.
window.titularBloqueado = function(usuario, titular){
  if(!titular) return null;
  const m = _rechStore();
  const g = m[_rechClaveGlobal(titular)];
  if(g) return { global:true,  motivo:g.motivo||'', fecha:g.fecha||'' };
  const u = m[_rechClave(usuario, titular)];
  if(u) return { global:false, motivo:u.motivo||'', fecha:u.fecha||'' };
  return null;
};
window.titularYaRechazado = function(usuario, titular){ return !!window.titularBloqueado(usuario, titular); };

// usuario === '*' → bloqueo global (para TODAS las cuentas).
// El bloqueo vivía SOLO en el localStorage de esta PC. El portal no se enteraba nunca —otro
// origen, otra máquina— y le seguía ofreciendo al jugador el titular que acabábamos de
// bloquear; otro operador en otra PC tampoco lo veía; y si se limpiaban los datos del
// navegador, el bloqueo desaparecía. Ahora se guarda en la base y el local queda como caché
// para que la pantalla reaccione al instante sin esperar la red.
window.marcarTitularRechazado = function(usuario, titular, motivo){
  if(!titular) return;
  const m = _rechStore();
  const k = (usuario === '*') ? _rechClaveGlobal(titular) : _rechClave(usuario, titular);
  m[k] = { motivo:motivo||'', fecha:new Date().toISOString(), titular:String(titular||''), usuario:String(usuario||'') };
  const ks = Object.keys(m); if(ks.length > 500) delete m[ks[0]];   // tope del caché local
  _rechSave(m);

  // A la base, que es lo que ve el portal y el resto de las PCs. No se espera: si falla, el
  // bloqueo local igual quedó y se avisa.
  try{
    supabaseClient.rpc('panel_titular_bloquear', {
      p_pc: (typeof pcOperativa !== 'undefined' ? pcOperativa : null),
      p_usuario: (usuario === '*' ? '*' : String(usuario||'')),
      p_titular: String(titular||''),
      p_motivo: motivo || null,
      p_operador: (window.operador && (window.operador.usuario||window.operador.nombre)) || null,
      p_secret: window.PANEL_DATA_SECRET
    }).then(function(r){
      if(r && r.error){
        console.warn('[titular bloqueado] no se guardó en la base:', r.error.message);
        try{ toast('⚠ El bloqueo quedó sólo en esta PC: '+(r.error.message||''), 'orange'); }catch(_e){}
      }
    });
  }catch(e){ console.warn('[titular bloqueado]', e); }
};
window.desmarcarTitularRechazado = function(usuario, titular){
  const m = _rechStore();
  delete m[_rechClave(usuario, titular)];
  delete m[_rechClaveGlobal(titular)];        // desbloquear siempre limpia los dos
  _rechSave(m);
  try{
    supabaseClient.rpc('panel_titular_desbloquear', {
      p_pc: (typeof pcOperativa !== 'undefined' ? pcOperativa : null),
      p_usuario: String(usuario||''),
      p_titular: String(titular||''),
      p_secret: window.PANEL_DATA_SECRET
    }).then(function(r){
      if(r && r.error) console.warn('[titular desbloqueado] no se borró en la base:', r.error.message);
    });
  }catch(e){ console.warn('[titular desbloqueado]', e); }
};
window.titularesBloqueadosTodos = function(){
  const m = _rechStore();
  return Object.keys(m).map(function(k){
    return { clave:k, global:k.indexOf('*|')===0, titular:m[k].titular||'', usuario:m[k].usuario||'',
             motivo:m[k].motivo||'', fecha:m[k].fecha||'' };
  }).sort(function(a,b){ return String(b.fecha).localeCompare(String(a.fecha)); });
};

// ¿El "titular" que declaró es en realidad un dato NUESTRO? El portal le muestra al cliente el
// titular/alias de la billetera para que transfiera, y copiarlo y pegarlo ahí es gratis: quedaba
// guardado en su ficha como si fuera un titular real. No va nada hardcodeado — sale de las
// billeteras vivas, así que si mañana cambia una, esto se entera solo.
window.esDatoPropioBilletera = function(valor){
  const v = _normNombre(valor);
  const vCbu = _jugNormCbu(valor);
  if(v.length < 4 && vCbu.length < 6) return null;    // muy corto para afirmar nada
  let hit = null;
  try{
    (window.billeteras||[]).forEach(function(b){
      if(hit) return;
      [['titular', b.TITULAR],
       ['nombre',  b.NOMBRE_VISIBLE || b.NOMBRE_CHUNIOR || b.BILLETERA_NOMBRE],
       ['alias',   b.CBU_ALIAS || b.CBU_CVU]].forEach(function(par){
        if(hit || !par[1]) return;
        const pN = _normNombre(par[1]), pC = _jugNormCbu(par[1]);
        if((pN.length>=4 && pN===v) || (pC.length>=6 && pC===vCbu)){
          hit = { billetera:String(b.NOMBRE_VISIBLE||b.NOMBRE_CHUNIOR||'—'), campo:par[0], valor:String(par[1]) };
        }
      });
    });
  }catch(_e){}
  return hit;
};

window.pjBloquearTitular = function(usuario, titular){
  if(!usuario || !titular) return;
  const glob = confirm('Bloquear el titular:\n\n  "'+titular+'"\n\n'
    + 'Aceptar  → bloquearlo para TODAS las cuentas (sirve contra redes de multicuenta)\n'
    + 'Cancelar → elegir solo para «'+usuario+'»');
  if(!glob){
    if(!confirm('Bloquear "'+titular+'" solo para el usuario «'+usuario+'»?')) return;
  }
  try{
    window.marcarTitularRechazado(glob ? '*' : usuario, titular, glob ? 'BLOQUEADO_GLOBAL_FICHA' : 'BLOQUEADO_DESDE_FICHA');
    toast('🚫 "'+titular+'" bloqueado'+(glob?' para TODAS las cuentas':' para '+usuario), 'yellow');
    if(typeof abrirPerfilJugador==='function') abrirPerfilJugador(usuario);   // repintar sin cerrar
  }catch(e){ toast('No se pudo bloquear: '+(e.message||''), 'red'); }
};
window.pjDesbloquearTitular = function(usuario, titular){
  if(!usuario || !titular) return;
  if(!confirm('Desbloquear el titular "'+titular+'"?')) return;
  try{
    window.desmarcarTitularRechazado(usuario, titular);
    toast('✅ "'+titular+'" desbloqueado', 'green');
    if(typeof abrirPerfilJugador==='function') abrirPerfilJugador(usuario);
  }catch(e){ toast('No se pudo desbloquear: '+(e.message||''), 'red'); }
};
window.jugadorRegistrarDato = function(usuario, dato){
  const u = String(usuario||'').toLowerCase().trim();
  if(!u || !dato) return;
  try{
    const map = _jugStoreAll();
    const j = map[u] || { usuario:u, telefonos:{}, cbus:{}, titulares:{}, bonos:[], creado:new Date().toISOString() };
    const fecha = dato.fecha || new Date().toISOString();
    if(dato.telefono){
      const t = String(dato.telefono).replace(/\D/g,'');
      if(t){ const p = j.telefonos[t]||{veces:0,primera:fecha}; p.veces++; p.ultima=fecha; if(dato.verificado) p.verificado=true; j.telefonos[t]=p; }
    }
    // No guardamos en la ficha del jugador datos que son NUESTROS (titular/alias de una billetera
    // propia). Antes entraban como un titular más y la identidad quedaba con "Juan Carlos Matrelo
    // ×4" colgando de un cliente cualquiera.
    const _propioTit = dato.titular ? window.esDatoPropioBilletera(dato.titular) : null;
    const _propioCbu = dato.cbu     ? window.esDatoPropioBilletera(dato.cbu)     : null;
    if(_propioTit || _propioCbu){
      const p = _propioTit || _propioCbu;
      try{ console.warn('[jugadores] '+u+' declaró un dato NUESTRO ('+p.campo+' de '+p.billetera+'): "'+p.valor+'" — no se registra en su ficha'); }catch(_e){}
      j.datosPropios = Array.isArray(j.datosPropios) ? j.datosPropios : [];
      j.datosPropios.push({ campo:p.campo, billetera:p.billetera, valor:String(dato.titular||dato.cbu||''), fecha:fecha });
      if(j.datosPropios.length>20) j.datosPropios = j.datosPropios.slice(-20);
      if(_propioTit) dato = Object.assign({}, dato, { titular:'' });
      if(_propioCbu) dato = Object.assign({}, dato, { cbu:'' });
    }
    const cbuN = _jugNormCbu(dato.cbu);
    if(cbuN){
      const c = j.cbus[cbuN] || { raw:String(dato.cbu).trim(), veces:0, primera:fecha };
      c.veces++; c.ultima = fecha;
      if(dato.titular) c.titular = String(dato.titular).trim();
      if(dato.instrumentoVerificado) c.verificado = true; // retiro OK real a ese destino
      j.cbus[cbuN] = c;
    }
    if(dato.bono){
      j.bonos = Array.isArray(j.bonos) ? j.bonos : [];
      j.bonos.push({ estado:String(dato.bono.estado||''), pct:dato.bono.pct||null, monto:dato.bono.monto||null, fecha:fecha });
      if(j.bonos.length>20) j.bonos = j.bonos.slice(-20);
    }
    if(dato.titular){
      const tt = String(dato.titular).trim().toLowerCase();
      if(tt){ const p = j.titulares[tt]||{raw:String(dato.titular).trim(),veces:0,primera:fecha}; p.veces++; p.ultima=fecha; j.titulares[tt]=p; }
    }
    j.ultimaAct = fecha;
    map[u] = j;
    _jugStoreSave(map);
  }catch(_e){}
};
// ¿Este destino es conocido para el usuario? → para resaltar destinos NUEVOS en el retiro.
// También compara el TITULAR: si el usuario siempre retiró a cuentas de un titular y ahora
// llega otro nombre → advertencia (posible cuenta ajena). Cruza MANUAL + PORTAL porque la
// base se alimenta de guardarMovimientoLocal, que captura ambos flujos.
window.jugadorCbuCheck = function(usuario, cbu, titular){
  try{
    const u = String(usuario||'').toLowerCase().trim();
    const j = _jugStoreAll()[u];
    const cbuN = _jugNormCbu(cbu);
    if(!j || !cbuN) return { datos:false };
    const conocidos = Object.values(j.cbus||{});
    const este = (j.cbus||{})[cbuN];
    const titN = String(titular||'').trim().toLowerCase();
    const titsConocidos = Object.keys(j.titulares||{});
    const ultimo = conocidos.slice().sort(function(a,b){ return String(b.ultima||'').localeCompare(String(a.ultima||'')); })[0] || null;
    return {
      datos: conocidos.length>0,
      conocido: !!este,
      veces: este ? este.veces : 0,
      otros: conocidos.filter(function(c){ return _jugNormCbu(c.raw)!==cbuN; }).map(function(c){ return c.raw; }),
      ultimo: ultimo,
      titularNuevo: !!(titN && titsConocidos.length && !titsConocidos.includes(titN)),
      titularesConocidos: titsConocidos.map(function(k){ return (j.titulares[k]||{}).raw || k; })
    };
  }catch(_e){ return { datos:false }; }
};
// Semilla one-shot: si la base está vacía, reconstruirla desde el store de movimientos
// (que ya venía guardando titular/cbu/destino por operación) — así arranca con historia.
try{
  if(!localStorage.getItem(JUG_STORE_KEY)){
    const all = _movStoreAll();
    Object.keys(all).forEach(function(k){
      const m = all[k]||{};
      const esRet = String(m.tipo||'').toUpperCase()==='RETIRO';
      if(m.usuario && ((esRet && (m.cbu||m.destino)) || m.titular))
        jugadorRegistrarDato(m.usuario, { cbu: esRet ? (m.cbu||m.destino) : '', titular:m.titular, fecha:m._fecha });
    });
  }
}catch(_e){}

// ── UI de la base de jugadores + PERFIL (portado de NexoBetaChan 1.0.85) ─────────
// La pantalla "📇 Base local" se sacó: era una herramienta de desarrollo que nunca terminó
// de funcionar (mostraba casi todo en "—"), y esa función la cumple Nexo, que ve todas las
// oficinas en vez de lo que junto esta PC. Para consultas puntuales está el SQL.
//
// El ALMACÉN local (_jugStoreAll / jugadorRegistrarDato) NO se borra: lo leen el perfil del
// jugador (perfil-jugador.js), el cotejo del alta (cotejo-alta.js) y lo que se le manda a
// Nexo (nexo.js). Lo que se fue es la pantalla, no el dato.

// ══════════════════════════════════════════════════════════════════════════

// Traer los bloqueos de la oficina al arrancar. Sin esto, una PC sólo conoce los que bloqueó
// ella misma: el operador del turno siguiente, en otra máquina, no ve nada.
window.sincronizarTitularesBloqueados = async function(){
  try{
    const pc = (typeof pcOperativa !== 'undefined' ? pcOperativa : null);
    if(!pc) return;
    const { data, error } = await supabaseClient.rpc('panel_titulares_bloqueados', {
      p_pc: pc, p_secret: window.PANEL_DATA_SECRET
    });
    if(error || !Array.isArray(data)) return;
    const m = _rechStore();
    data.forEach(function(b){
      const u = String(b.usuario||'');
      const k = (u === '*') ? _rechClaveGlobal(b.titular) : _rechClave(u, b.titular);
      m[k] = { motivo:b.motivo||'', fecha:b.created_at||'', titular:String(b.titular||''), usuario:u };
    });
    _rechSave(m);
  }catch(e){ console.warn('[titulares bloqueados] sync', e); }
};
// El padrón que ya está en memoria: el teléfono y el titular de un jugador, SIN pedir nada.
//
// Juan, 6/10: "HAY QUE PRIORIZAR LA EFICACIA, EL RENDIMIENTO DE LA APLICACION AHORA QUE TODO
// FUNCIONA JOYA" — y antes de eso, tres veces: no hacer dos búsquedas distintas del mismo dato.
//
// Esto NO llama a la base. Mira, en orden, lo que el panel ya tiene cargado por otros motivos:
//
//   1) la base LOCAL de jugadores (nodo_jugadores_local_v2), que se llena sola con cada
//      movimiento que pasa por la PC;
//   2) los vínculos del CRM (window._crmVinculos), si la pestaña se abrió alguna vez;
//   3) las solicitudes del portal que están en pantalla (V154P.solicitudes), que SIEMPRE traen
//      el teléfono en el metadata — medido el 6/10: 0 faltantes en 29.360 solicitudes.
//
// Con eso alcanza para que una ficha abierta desde el historial muestre el mismo número que la
// tarjeta del chat. Si ninguna de las tres lo tiene, devuelve vacío y el que llamó decide: NO
// dispara una consulta por su cuenta, que es justamente lo que había que terminar.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  const S = (v) => String(v == null ? '' : v).trim();
  const K = (v) => S(v).toLowerCase();

  function _delLocal(u){
    try{
      if(typeof _jugStoreAll !== 'function') return null;
      const j = (_jugStoreAll() || {})[u];
      if(!j) return null;
      const tels = Object.keys(j.telefonos || {});
      const tit  = (Object.values(j.titulares || {})[0] || {}).raw || '';
      return { telefono: S(tels[0]), titular: S(tit) };
    }catch(_e){ return null; }
  }

  function _delCrm(u){
    try{
      const v = (window._crmVinculos || []).find(function(x){ return K(x.usuario) === u; });
      if(!v) return null;
      return { telefono: S(v.telefono_canon || v.telefono), titular: S(v.titular),
               estado: S(v.estado_vinculo) };
    }catch(_e){ return null; }
  }

  // La solicitud más NUEVA de ese usuario que esté en pantalla. Más nueva a propósito: si cambió
  // de teléfono, el último es el que sirve para escribirle hoy.
  function _deSolicitudes(u){
    try{
      const sols = (window.V154P && window.V154P.solicitudes) || [];
      let mejor = null, mejorT = -1;
      for(const s of sols){
        if(K(s.USUARIO || s.usuario) !== u) continue;
        const t = new Date(s.FECHA_CREACION || s.FECHA || s.created_at || 0).getTime() || 0;
        if(t >= mejorT){ mejorT = t; mejor = s; }
      }
      if(!mejor) return null;
      const id = window.NodoDomain && window.NodoDomain.identidad;
      if(!id) return null;
      return { telefono: S(id.telefono(mejor)), titular: S(id.titular(mejor)) };
    }catch(_e){ return null; }
  }

  // Un solo recorrido para los dos datos, así el que precisa teléfono y titular no mira dos veces.
  function padron(usuario){
    const u = K(usuario);
    const out = { telefono:'', titular:'', estado:'' };
    if(!u) return out;
    for(const buscar of [_delLocal, _delCrm, _deSolicitudes]){
      const r = buscar(u);
      if(!r) continue;
      if(!out.telefono && r.telefono) out.telefono = r.telefono;
      if(!out.titular  && r.titular)  out.titular  = r.titular;
      if(!out.estado   && r.estado)   out.estado   = r.estado;
      if(out.telefono && out.titular && out.estado) break;
    }
    return out;
  }

  window.nodoPadron          = padron;
  window.padronTelefono      = function(usuario){ return padron(usuario).telefono; };
  window.padronTitular       = function(usuario){ return padron(usuario).titular;  };
  // El veredicto guardado, para no volver a validar a alguien que ya está validado.
  window.padronEstadoVinculo = function(usuario){ return padron(usuario).estado;   };
})();
// ── Datos de ingreso del jugador ────────────────────────────────────────────
// Lo que hay que mandarle para que entre: usuario, clave y un enlace que lo deja adentro YA
// VALIDADO (token propio, 30 minutos, uno solo por usuario). La clave NO se inventa: sale de la
// última que le pusimos —RESET_CLAVE del panel o CAMBIO_CLAVE del portal—. La clave estándar de
// la operación es 12345a: si figura otra, o no sabemos ninguna, se refresca de un toque desde
// acá mismo, que es donde el operador ya está parado. Medido: sólo el 3,9 % de los usuarios
// tenía clave conocida, así que refrescarla es el camino normal, no la excepción.
window.PLATAFORMA_URL = localStorage.getItem("nodo_plataforma_url") || "https://bet-300.pw";
window.CLAVE_ESTANDAR = "12345a";

window.pjDatosIngreso = async function(usuario){
  const u = String(usuario||"").trim();
  if(!u){ toast("Sin usuario.","red"); return; }

  toast("Buscando los datos de "+u+"…","blue");
  let d = null;
  try{
    const oficinas = (typeof pcAliasesHist === "function") ? pcAliasesHist() : null;
    const { data, error } = await supabaseClient.rpc("panel_datos_ingreso", {
      p_usuario: u, p_pc_codigos: oficinas, p_secret: window.PANEL_DATA_SECRET
    });
    if(error) throw error;
    d = Array.isArray(data) ? data[0] : data;
  }catch(e){
    toast("No se pudieron leer los datos: "+(e.message||e),"red");
    return;
  }
  if(!d){ toast(u+" no tiene vínculo en esta oficina.","yellow"); return; }

  const clave = String(d.clave||"").trim();
  const tel   = String(d.telefono||"").trim();
  const cuando = d.clave_fecha ? new Date(d.clave_fecha).toLocaleDateString("es-AR") : "";
  const uEsc = u.replace(/'/g,"\\'");
  const esEstandar = clave === window.CLAVE_ESTANDAR;

  // El enlace con token: entra ya validado, sin tipear usuario ni clave. Es UNO solo —generar
  // otro anula el anterior— y es lo que se manda siempre. Si no se puede generar (sin vínculo,
  // sin oficina resuelta), se cae al dominio pelado, que al menos lo deja en la puerta.
  let enlace = "";
  try{
    if(window.crmEnlaceAccesoUrl) enlace = (await window.crmEnlaceAccesoUrl(u, "INICIO")) || "";
  }catch(_e){}

  // El texto que se copia y se manda. Sin la clave no se arma: mandar "Clave: —" es peor que
  // no mandar nada.
  const texto = "Usuario: " + u + "\n"
              + (clave ? ("Clave: " + clave + "\n") : "")
              + (tel ? ("Teléfono registrado: " + tel + "\n") : "")
              + "Entrá en: " + (enlace || window.PLATAFORMA_URL);
  window._pjTextoIngreso = texto;

  const fila = function(k, v, extra){
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #1e293b">'
      + '<span class="small" style="color:#8b949e">'+k+'</span>'
      + '<span style="text-align:right">'+v+(extra||'')+'</span></div>';
  };

  const cuerpo =
      fila('Usuario', '<b class="mono" style="font-size:15px;color:#fff">'+escapeHtml(u)+'</b>')
    + fila('Clave', clave
        ? '<b class="mono" style="font-size:15px;color:'+(esEstandar?'#22c55e':'#facc15')+'">'+escapeHtml(clave)+'</b>'
          + (esEstandar ? '' : '<div class="small" style="color:#fbbf24">no es la estándar ('+escapeHtml(window.CLAVE_ESTANDAR)+')</div>')
          + (cuando ? '<div class="small" style="color:#8b949e">puesta el '+escapeHtml(cuando)
              + (d.clave_origen==='portal' ? ' · la pidió él' : ' · se la pusimos') + '</div>' : '')
        : '<span style="color:#f87171">No sabemos cuál es</span>'
          + '<div class="small" style="color:#8b949e">refrescala acá y queda en '+escapeHtml(window.CLAVE_ESTANDAR)+'</div>')
    + fila('Teléfono registrado', tel
        ? '<b class="mono" style="font-size:15px">'+escapeHtml(tel)+'</b>'
        : '<span style="color:#f87171">Sin teléfono</span>')
    + fila('Entra en', enlace
        ? '<span class="mono" style="font-size:11px;color:#7dd3fc;word-break:break-all">'+escapeHtml(enlace)+'</span>'
          + '<div class="small" style="color:#22c55e">entra ya validado · vale 30 minutos</div>'
        : '<span class="mono">'+escapeHtml(window.PLATAFORMA_URL)+'</span>'
          + '<div class="small" style="color:#8b949e">sin enlace validado — va a tener que ingresar a mano</div>')
    + (clave ? '' :
        '<div class="alert-box" style="margin-top:12px">La clave no se puede recuperar: no se guarda en ningún lado '
        + 'salvo cuando se la cambiamos nosotros. Refrescala acá y te la paso en el mismo texto.</div>');

  // Un solo toque y sin preguntar cuál: la clave de la operación es SIEMPRE la estándar. Cuando
  // ya la tiene, el botón queda apagado pero disponible (sirve si el jugador dice que no entra).
  const acciones =
      '<button class="mini-btn '+(esEstandar?'gray':'yellow')+'" onclick="pjRefrescarClave(\''+escapeHtml(uEsc)+'\')">🔑 '
    + (esEstandar ? 'Volver a poner ' : 'Refrescar la clave a ') + escapeHtml(window.CLAVE_ESTANDAR) + '</button>';

  // El botón azul del modal es el que copia: antes se le pasaba (null, '') y salía mudo y muerto.
  abrirModal('🔑 Datos de ingreso · '+escapeHtml(u),
    cuerpo + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">'+acciones+'</div>',
    pjCopiarIngreso, '📋 Copiar datos');
};

// Refresca la clave a la estándar sin preguntar nada y vuelve a la ficha, ya con la clave nueva
// y un enlace nuevo. resetClaveRapido la cambia en el agente y la deja anotada en el historial,
// que es de donde panel_datos_ingreso la vuelve a leer.
window.pjRefrescarClave = async function(usuario){
  const u = String(usuario||"").trim(); if(!u) return;
  try{ cerrarModal(); }catch(_e){}
  await resetClaveRapido(u, window.CLAVE_ESTANDAR);
  try{ pjDatosIngreso(u); }catch(_e){}
};

window.pjCopiarIngreso = function(){
  // Va por el camino común: recupera el foco antes de copiar (el panel puede estar operando
  // en la ventana del backoffice) y, si no se puede, muestra el texto para copiarlo a mano.
  return window.nodoCopiar(window._pjTextoIngreso || "", { etiqueta: "Datos copiados" });
};

// PERFIL DE JUGADOR — layout de "record page" copiado de los CRM probados
// (Twenty/Attio/HubSpot): carril IZQUIERDO de identidad/campos + timeline de
// actividad a la DERECHA. Mismos tokens dark (Primer/shadcn) que el resto del
// panel: #0d1117 / #161b22 / #30363d / acento #f5c518.
// ══════════════════════════════════════════════════════════════════════════
function _perfilCss(){
  if(document.getElementById('nodoPerfilCss')) return;
  const st=document.createElement('style'); st.id='nodoPerfilCss';
  st.textContent=`
  #perfilJugadorOverlay{position:fixed;inset:0;z-index:99998;background:rgba(1,4,9,.62);display:flex;align-items:center;justify-content:center;padding:18px}
  .pj-panel{width:min(1080px,97vw);height:min(760px,92vh);background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;color:#e6edf3}
  .pj-head{display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid #21262d;background:#161b22}
  .pj-avatar{width:44px;height:44px;border-radius:12px;background:#1f2937;border:1px solid #30363d;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:17px;color:#f5c518;flex-shrink:0}
  .pj-chip{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;font-size:10.5px;font-weight:900;margin-left:6px}
  .pj-body{flex:1;display:grid;grid-template-columns:310px 1fr;min-height:0}
  .pj-rail{border-right:1px solid #21262d;overflow:auto;padding:13px;background:#0e1420}
  .pj-card{background:#161b22;border:1px solid #262d3a;border-radius:11px;padding:11px 12px;margin-bottom:11px}
  .pj-card h4{font-size:10.5px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#8b949e;margin:0 0 8px}
  .pj-field{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:12.5px}
  .pj-field .k{color:#8b949e}
  .pj-field .v{font-weight:700;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .pj-mono{font-family:ui-monospace,monospace}
  .pj-main{overflow:auto;padding:14px 18px}
  .pj-tl-row{display:flex;gap:11px;align-items:center;padding:8px 10px;border-radius:10px;background:#10151f;border:1px solid #1f2733;margin-bottom:7px;cursor:pointer;transition:border-color .12s}
  .pj-tl-row:hover{border-color:#f5c518}
  .pj-tl-hora{flex-shrink:0;min-width:56px;text-align:center;background:#161b26;border:1px solid #2a3344;border-radius:8px;padding:4px 6px}
  .pj-tl-hora b{display:block;font-size:17px;font-weight:900;color:#f5c518;font-family:ui-monospace,monospace;line-height:1.1}
  .pj-tl-hora span{font-size:10px;color:#8b949e}
  .pj-day{font-size:11px;font-weight:900;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin:13px 0 7px;display:flex;align-items:center;gap:8px}
  .pj-day::after{content:'';flex:1;height:1px;background:#21262d}`;
  document.head.appendChild(st);
}
window.cerrarPerfilJugador = function(){ const o=document.getElementById('perfilJugadorOverlay'); if(o) o.remove(); };

// ── Ficha del usuario desde Supabase (RPC panel_usuario_ficha) ────────────────
// Trae el teléfono VIGENTE (usuarios_portal_vinculos), los teléfonos ANTERIORES y las
// validaciones/cambios (usuarios_portal_eventos), y avisa si alguno de sus teléfonos figura
// HOY con OTRO usuario (antifraude: alguien intentando tomar una cuenta ajena).
// Un usuario tiene UN teléfono vigente; los demás son historia, para verificar antes de validar.
async function _pjCargarFicha(usuario){
  const uLow = String(usuario||'').trim().toLowerCase();
  const box = document.getElementById('pjFichaBox'); if(!box) return;
  let d = null;
  try{
    const r = await supabaseClient.rpc('panel_usuario_ficha', { p_usuario: usuario, p_pc_codigos: null, p_secret: window.PANEL_DATA_SECRET });
    if(r && !r.error) d = (typeof r.data === 'string') ? JSON.parse(r.data) : r.data;
  }catch(_e){}
  // El perfil pudo cerrarse o cambiar de usuario mientras respondía.
  const box2 = document.getElementById('pjFichaBox');
  if(!box2 || window.__perfilJugadorAbierto !== uLow) return;
  if(!d || d.ok !== true){
    box2.innerHTML = '<h4>📱 Teléfonos y validaciones</h4>'
      + '<div class="small" style="color:#8b949e">Sin datos. Si nunca corriste el SQL de <b>panel_usuario_ficha</b>, esta ficha queda vacía.</div>';
    return;
  }
  const E = escapeHtml;
  const v   = d.vinculo || null;
  const evs = Array.isArray(d.eventos)  ? d.eventos  : [];
  const als = Array.isArray(d.alertas)  ? d.alertas  : [];
  const telActual = v && v.telefono_canon ? String(v.telefono_canon) : '';

  // Teléfonos anteriores = los que aparecen en eventos y NO son el vigente.
  const previos = [];
  evs.forEach(function(e){
    [e.telefono_anterior, e.telefono_nuevo].forEach(function(t){
      const s = String(t||'').trim();
      if(s && s !== telActual && previos.indexOf(s) === -1) previos.push(s);
    });
  });

  let h = '<h4>📱 Teléfonos y validaciones</h4>';

  // ⚠ Alerta antifraude primero: uno de sus teléfonos es HOY de otro usuario.
  if(als.length){
    h += '<div style="background:rgba(240,68,56,.10);border:1px solid rgba(240,68,56,.35);border-radius:9px;padding:8px 10px;margin-bottom:9px">'
       + '<div style="font-size:12px;font-weight:900;color:#f04438">⚠️ Teléfono en uso por otro usuario</div>'
       + als.map(function(a){
           return '<div class="small" style="color:#fca5a5;margin-top:3px">'+E(String(a.telefono_canon||''))
                + ' → <b>'+E(String(a.usuario||''))+'</b>'+(a.pc_codigo?' ('+E(String(a.pc_codigo))+')':'')+'</div>';
         }).join('')
       + '</div>';
  }

  h += telActual
    ? '<div class="pj-field"><span class="k">Teléfono vigente</span><span class="v pj-mono">'+E(telActual)
      + (v.pc_codigo?' <span style="color:#8b949e;font-size:10px">'+E(String(v.pc_codigo))+'</span>':'')+'</span></div>'
    : '<div class="pj-field"><span class="k">Teléfono vigente</span><span class="v" style="color:#5a6474">sin vínculo</span></div>';

  if(v && v.titular)        h += '<div class="pj-field"><span class="k">Titular</span><span class="v">'+E(String(v.titular))+'</span></div>';
  if(v && v.estado_vinculo) h += '<div class="pj-field"><span class="k">Vínculo</span><span class="v" style="font-weight:700;color:'
                               + (String(v.estado_vinculo).toUpperCase()==='VINCULADO'?'#22c55e':String(v.estado_vinculo).toUpperCase()==='BLOQUEADO'?'#ef4444':'#f5c518')
                               + '">'+E(String(v.estado_vinculo))+'</span></div>';

  if(previos.length){
    h += '<div class="pj-day" style="margin:11px 0 5px">🕓 Teléfonos anteriores</div>'
       + previos.map(function(t){
           return '<div class="pj-field"><span class="k">Anterior</span><span class="v pj-mono" style="color:#8b949e">'+E(t)+'</span></div>';
         }).join('');
  }

  if(evs.length){
    h += '<div class="pj-day" style="margin:11px 0 5px">📋 Historial de validaciones</div>';
    h += evs.slice(0,12).map(function(e){
      const f = e.created_at ? new Date(e.created_at).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
      const detalle = [e.telefono_anterior, e.telefono_nuevo].filter(Boolean).join(' → ');
      return '<div style="border-left:2px solid #30363d;padding:2px 0 2px 8px;margin-bottom:6px">'
           + '<div style="font-size:11.5px;font-weight:800;color:#c9d1d9">'+E(String(e.evento||''))
           +   '<span style="color:#8b949e;font-weight:600"> · '+E(f)+(e.operador?' · '+E(String(e.operador)):'')+'</span></div>'
           + (detalle ? '<div class="small pj-mono" style="color:#8b949e">'+E(detalle)+'</div>' : '')
           + (e.nota ? '<div class="small" style="color:#8b949e">'+E(String(e.nota))+'</div>' : '')
           + '</div>';
    }).join('');
    if(evs.length > 12) h += '<div class="small" style="color:#5a6474">+'+(evs.length-12)+' evento/s más</div>';
  } else {
    h += '<div class="small" style="color:#5a6474;margin-top:8px">Sin validaciones registradas todavía.</div>';
  }

  box2.innerHTML = h;
}
window._pjCargarFicha = _pjCargarFicha;

window.abrirPerfilJugador = function(usuario){
  const u = String(usuario||'').trim(); if(!u) return;
  _perfilCss();
  const uLow = u.toLowerCase();
  const esc = escapeHtml;
  const local = _jugStoreAll()[uLow] || {};
  // Desde que el CRM abre vacío (v1.1.70) _crmJugadoresData sólo tiene datos si el
  // operador pidió "Cargar lista". El perfil se abre igual desde el buscador, así que
  // hay que mirar también lo que trajo la búsqueda del servidor (_crmBuscados): ahí
  // vienen turno, última carga, score y segmento calculados sobre TODAS las operaciones.
  // Sin esto el perfil mostraba "—" en turno y última carga teniendo el dato a mano.
  const crm = (window._crmJugadoresData||[]).find(function(x){ return String(x.usuario||'').toLowerCase()===uLow; })
           || (window._crmBuscados||{})[uLow]
           || (window._crmWtkBuscados||{})[uLow] || {};
  const fl = (window._crmFlags||{})[uLow] || {};
  const ops = (typeof arbolUsuario==='function') ? arbolUsuario(u) : [];
  const uEsc = u.replace(/'/g,"\\'");

  // ── carril izquierdo (identidad / instrumentos / bonos / resumen) ──
  const tels = Object.keys(local.telefonos||{});
  const cbus = Object.values(local.cbus||{});
  const tits = Object.values(local.titulares||{});
  const bonos = Array.isArray(local.bonos)?local.bonos.slice().reverse():[];
  // Respaldo desde el CRM (vínculo de whaticket): si el usuario nunca operó/validó en ESTA máquina,
  // la base local no tiene su teléfono/titular, pero el CRM sí lo trae del registro (panel_crm_vinculos).
  // Fallback WTK: si el jugador está en _crmJugadoresData (por ops/CSV) pero SIN titular/teléfono,
  // lo completamos con lo que trajo la búsqueda de whaticket (_crmWtkBuscados), que sí lo tiene.
  // Antes el lookup se quedaba con el item de ops (sin titular) → mostraba "sin datos" aunque lo
  // hubieras encontrado JUSTO buscando por ese titular.
  // _crmBuscados lo llena el buscador del CRM (panel_crm_perfil_v1): trae teléfono,
  // titular y el perfil calculado sobre TODAS las operaciones. _crmWtkBuscados es el
  // buscador viejo, queda de respaldo.
  const _crmWtk = (window._crmBuscados||{})[uLow] || (window._crmWtkBuscados||{})[uLow] || {};
  const crmTel = String(crm.telefono || _crmWtk.telefono || '').replace(/\D/g,'');
  const crmTit = String(crm.titular || _crmWtk.titular || '').trim();
  const crmEst = String(crm.estadoVinculo || _crmWtk.estadoVinculo || '').trim().toUpperCase();
  const railIdent =
      '<div class="pj-card"><h4>👤 Identidad</h4>'
    + (tits.length
        ? tits.map(function(t){
            // Bloqueo de titular: la acción que le faltaba a la auditoría de multicuenta.
            const _bl = window.titularBloqueado ? window.titularBloqueado(u, t.raw) : null;
            const _tEsc = String(t.raw).replace(/'/g,"\\'");
            const _btn = _bl
              ? '<button type="button" onclick="pjDesbloquearTitular(\''+esc(uEsc)+'\',\''+esc(_tEsc)+'\')" title="Desbloquear" style="margin-left:6px;border:0;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:800;background:#14532d;color:#86efac;cursor:pointer">desbloquear</button>'
              : '<button type="button" onclick="pjBloquearTitular(\''+esc(uEsc)+'\',\''+esc(_tEsc)+'\')" title="Bloquear este titular" style="margin-left:6px;border:0;border-radius:6px;padding:1px 6px;font-size:10px;font-weight:800;background:#3f1d1d;color:#fca5a5;cursor:pointer">🚫</button>';
            const _badge = _bl
              ? ' <span title="'+esc(_bl.motivo||'')+(_bl.fecha?(' · '+esc(String(_bl.fecha).slice(0,10))):'')+'" style="background:#7f1d1d;color:#fecaca;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:900">'+(_bl.global?'BLOQUEADO · TODAS':'BLOQUEADO')+'</span>'
              : '';
            return '<div class="pj-field"><span class="k">Titular</span><span class="v">'+esc(t.raw)
                 + ' <span style="color:#8b949e;font-weight:600">×'+t.veces+'</span>'+_badge+_btn+'</span></div>';
          }).join('')
        : (crmTit
            ? '<div class="pj-field"><span class="k">Titular</span><span class="v">'+esc(crmTit)+' <span title="Del registro/whaticket" style="color:#8b949e;font-weight:600;font-size:10px">·reg</span></span></div>'
            : '<div class="pj-field"><span class="k">Titular</span><span class="v" style="color:#5a6474">sin datos</span></div>'))
    + (tels.length
        ? tels.map(function(t){ const v=(local.telefonos[t]||{}); return '<div class="pj-field"><span class="k">Teléfono</span><span class="v pj-mono">'+esc(_tel(t))+(v.verificado?' <span title="Verificado al vincular" style="color:#22c55e">✓</span>':'')+'</span></div>'; }).join('')
        : (crmTel
            ? '<div class="pj-field"><span class="k">Teléfono</span><span class="v pj-mono">'+esc(_tel(crmTel))+' <span title="Del registro/whaticket (aún no operó en el panel)" style="color:#8b949e;font-weight:600;font-size:10px">·reg</span></span></div>'
            : '<div class="pj-field"><span class="k">Teléfono</span><span class="v" style="color:#5a6474">—</span></div>'))
    + (crmEst ? '<div class="pj-field"><span class="k">Vínculo</span><span class="v" style="color:'+(crmEst==='VINCULADO'?'#22c55e':crmEst==='BLOQUEADO'?'#ef4444':'#f5c518')+';font-weight:700">'+esc(crmEst)+'</span></div>' : '')
    + '</div>';
  // TODOS los cbu/alias que el usuario usó o ingresó, en un solo lugar (puede tener varias
  // cuentas propias — eso es normal). 🚨 = el titular de ESE instrumento no coincide con los
  // titulares conocidos del usuario (posible cuenta ajena). Tocá uno para copiarlo.
  const titsSet = tits.map(function(t){ return String(t.raw).toLowerCase().trim(); });
  const railInstr =
      '<div class="pj-card"><h4>💳 Instrumentos de retiro (todos)</h4>'
    + (cbus.length?cbus.slice().sort(function(a,b){ return String(b.ultima||'').localeCompare(String(a.ultima||'')); }).map(function(c){
        const ajeno = c.titular && titsSet.length && titsSet.indexOf(String(c.titular).toLowerCase().trim())===-1;
        return '<div style="padding:4px 0;border-bottom:1px dashed #21262d;cursor:pointer" title="Tocá para copiar" data-valor="'+esc(c.raw)+'" onclick="event.stopPropagation();portalCopiarCbu(this)">'
          + '<div class="pj-mono" style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;color:'+(ajeno?'#fca5a5':'#e6edf3')+'">'+esc(c.raw)
          + (c.verificado?' <span title="Ya cobró acá (retiro OK)" style="color:#22c55e">✓</span>':' <span title="Ingresado pero nunca cobró acá" style="color:#f5c518">●</span>')
          + (ajeno?' <span title="Titular DISTINTO a los conocidos del usuario — posible cuenta ajena" style="color:#ef4444">🚨</span>':'')+'</div>'
          + '<div class="small" style="color:'+(ajeno?'#e6a0a0':'#8b949e')+'">'+(c.titular?esc(c.titular)+' · ':'')+'×'+c.veces+(c.ultima?(' · últ. '+esc(formatFecha(c.ultima))):'')+(ajeno?' · 🚨 titular distinto':'')+'</div></div>';
      }).join('')
      // Respaldo: el CBU también viaja en las notas de los RETIROS, y de ahí lo saca el
      // servidor. La base local es POR MÁQUINA: si el retiro lo pagó otro turno u otra PC,
      // acá no hay nada aunque el usuario tenga destino conocido.
      : (_crmWtk.cbu
          ? '<div style="padding:4px 0" title="Tomado del último retiro pagado">'
            + '<div class="pj-mono" style="font-size:12px;font-weight:700;color:#e6edf3">'+esc(_crmWtk.cbu)+'</div>'
            + '<div class="small" style="color:#8b949e">'+(crmTit?esc(crmTit)+' · ':'')+'del último retiro</div></div>'
          : '<div class="small" style="color:#5a6474">Sin destinos registrados aún.</div>'))
    + '</div>';
  const railBonos =
      '<div class="pj-card"><h4>🎁 Bonos</h4>'
    + (bonos.length?bonos.slice(0,5).map(function(b){ const ap=b.estado==='APLICADO'; return '<div class="pj-field"><span class="k">'+esc(formatFecha(b.fecha||''))+'</span><span class="v" style="color:'+(ap?'#22c55e':'#f5c518')+'">'+(ap?'🎁 aplicado':'⏳ pendiente')+(b.pct?(' '+b.pct+'%'):'')+'</span></div>'; }).join(''):'<div class="small" style="color:#5a6474">Sin bonos registrados.</div>')
    + '</div>';
  let totC=0, totR=0; ops.forEach(function(o){ const m=Math.abs(Number(o.monto||0)); const t=String(o.tipo||'').toUpperCase(); if(t==='CARGA')totC+=m; else if(t==='RETIRO')totR+=m; });
  const railResumen =
      '<div class="pj-card"><h4>📊 Resumen</h4>'
    + '<div class="pj-field"><span class="k">Cargas</span><span class="v" style="color:#22c55e">'+(crm.cargas!=null?crm.cargas:'—')+' · '+money(crm.montoCargas||totC)+'</span></div>'
    + '<div class="pj-field"><span class="k">Retiros</span><span class="v" style="color:#fb923c">'+(crm.retiros!=null?crm.retiros:'—')+' · '+money(crm.montoRetiros||totR)+'</span></div>'
    + '<div class="pj-field"><span class="k">Neto</span><span class="v" style="color:'+((crm.neto||totC-totR)>=0?'#22c55e':'#ef4444')+'">'+money(crm.neto!=null?crm.neto:(totC-totR))+'</span></div>'
    + '<div class="pj-field"><span class="k">Turno frecuente</span><span class="v">'+esc(crm.turnoFrecuente||'—')+'</span></div>'
    + '<div class="pj-field"><span class="k">Última carga</span><span class="v">'+(crm.ultimaCarga?esc(new Date(crm.ultimaCarga).toLocaleDateString('es-AR')):'—')+'</span></div>'
    + '</div>';

  // ── timeline (derecha): operaciones agrupadas por día, hora protagonista ──
  let tl='', diaPrev='';
  ops.forEach(function(o){
    const d = new Date(o.fecha);
    const diaK = isNaN(d)?'—':d.toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'2-digit'});
    if(diaK!==diaPrev){ tl += '<div class="pj-day">'+esc(diaK)+'</div>'; diaPrev=diaK; }
    const hora = isNaN(d)?'—':String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    const t = String(o.tipo||'').toUpperCase();
    const eOk = ['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA'].includes(String(o.estado||'').toUpperCase());
    const destTxt = String(o.cbu||o.destino||'').trim();
    tl += '<div class="pj-tl-row" onclick="cerrarPerfilJugador();verDetalleMovimiento(\''+esc(String(o.id||''))+'\',\''+uEsc+'\')">'
      + '<div class="pj-tl-hora"><b>'+hora+'</b><span>'+(isNaN(d)?'':String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'))+'</span></div>'
      + '<div style="min-width:0;flex:1">'
      +   '<div style="display:flex;justify-content:space-between;gap:8px"><span style="font-weight:800">'+(t==='CARGA'?'⬆️':t==='RETIRO'?'⬇️':'•')+' '+esc(t||'—')+' '+(eOk?'<span style="color:#22c55e">✅</span>':String(o.estado||'').toUpperCase()==='ERROR'?'<span style="color:#ef4444">❌</span>':'<span style="color:#8b949e">'+esc(o.estado||'')+'</span>')+'</span>'
      +   '<b style="color:'+(t==='RETIRO'?'#fb923c':'#22c55e')+'">'+money(Math.abs(Number(o.monto||0)))+'</b></div>'
      +   (destTxt?('<div class="pj-mono small" style="color:#c9d1d9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">→ '+esc(destTxt)+'</div>'):'')
      +   '<div class="small" style="color:#8b949e">'+(o.titular?('👤 '+esc(o.titular)+' · '):'')+(o.chuniorId?('Nº '+esc(String(o.chuniorId))+' · '):'')+(o.operador?('op:'+esc(o.operador)):'')+'</div>'
      + '</div></div>';
  });
  if(!tl) tl = '<div class="small" style="color:#8b949e;padding:14px">Sin operaciones registradas para este usuario.</div>';

  // El chip VIP / TIBIO / FRIO se fue: era una etiqueta de marketing, no un dato para operar.
  const html =
      '<div class="pj-panel" onclick="event.stopPropagation()">'
    +   '<div class="pj-head">'
    +     '<div class="pj-avatar">'+esc(u.substring(0,2).toUpperCase())+'</div>'
    +     '<div style="min-width:0;flex:1"><div style="font-size:17px;font-weight:900">'+esc(u)
    +       ' <span title="Push" style="opacity:'+(fl.push?1:.25)+'">🔔</span><span title="App" style="opacity:'+(fl.app?1:.25)+'">📱</span>'+'</div>'
    +       '<div class="small" style="color:#8b949e">'+ops.length+' operación/es'+'</div></div>'
    +     '<button class="mini-btn yellow" title="Usuario, clave y teléfono para que pueda entrar a la plataforma" onclick="pjDatosIngreso(\''+uEsc+'\')">🔑 Ingreso</button>'
    +     '<button class="mini-btn green" title="Escribirle por el chat del portal, aunque nunca haya escrito" onclick="nodoChatNuevo(\''+uEsc+'\')">💬 Mensaje</button>'
    +     '<button class="mini-btn blue" onclick="crmCopiarPromo(\''+uEsc+'\')">📋 Promo</button>'
    +     '<button class="mini-btn green" onclick="crmPushIndividual(\''+uEsc+'\')">📲 Push</button>'
    +     '<button class="mini-btn blue" title="Copia un enlace que lo mete al portal ya validado, en Cargar. Vale 30 min y un solo uso." onclick="crmEnlaceAcceso(\''+uEsc+'\',\'CARGAR\')">🔗 Cargar</button>'
    +     '<button class="mini-btn blue" title="Igual que el anterior pero lo abre en Retirar." onclick="crmEnlaceAcceso(\''+uEsc+'\',\'RETIRAR\')">🔗 Retirar</button>'
    +     '<button class="mini-btn gray" onclick="cerrarPerfilJugador()" style="font-weight:800">✕</button>'
    +   '</div>'
    +   '<div class="pj-body">'
    +     '<div class="pj-rail">'+railIdent
    +       '<div class="pj-card" id="pjFichaBox"><h4>📱 Teléfonos y validaciones</h4>'
    +         '<div class="small" style="color:#8b949e">Cargando ficha…</div></div>'
    +       railInstr+railBonos+railResumen+'</div>'
    +     '<div class="pj-main"><div class="pj-day" style="margin-top:0">🕐 Actividad · '+ops.length+' con detalle</div>'
    +       ((crm.totalOps||0)>ops.length?'<div class="small" style="color:#8b949e;margin:-2px 0 9px">ℹ️ El resumen cuenta '+crm.totalOps+' ops: incluye las importadas del agente (CSV), que llegan como totales SIN fila individual — acá se listan solo las '+ops.length+' operadas/registradas por el panel.</div>':'')
    +       tl+'</div>'
    +   '</div>'
    + '</div>';
  cerrarPerfilJugador();
  const ov = document.createElement('div');
  ov.id='perfilJugadorOverlay'; ov.innerHTML=html;
  ov.onclick = cerrarPerfilJugador;
  document.body.appendChild(ov);
  window.__perfilJugadorAbierto = uLow;
  try{ _pjCargarFicha(u); }catch(_e){}   // teléfonos (actual + históricos), validaciones y alertas
  // Historial COMPLETO (día 1 → hoy): trae async TODAS las ops del usuario (más allá de las 200
  // globales) y re-renderiza el perfil si sigue abierto y en el mismo usuario. Sin loop: el loader
  // se cachea y en el re-render devuelve hayNuevas=false.
  try{
    if(window.cargarArbolCompletoUsuario){
      window.cargarArbolCompletoUsuario(u, function(hayNuevas){
        if(hayNuevas && document.getElementById('perfilJugadorOverlay') && window.__perfilJugadorAbierto===uLow){
          window.abrirPerfilJugador(u);
        }
      });
    }
  }catch(_e){}

  // El perfil se abre desde muchos lados (buscador, cola de reconexión, dormidos, una
  // fila del CRM) y no todos dejan al jugador cacheado. Si no lo tenemos, lo pedimos y
  // se repinta: así el turno, la última carga, el score y el segmento salen siempre,
  // calculados sobre TODAS las operaciones y no sobre lo que hubiera en memoria.
  try{
    if(!crm.turnoFrecuente && !(window._crmBuscados||{})[uLow]){
      window._crmBuscados = window._crmBuscados || {};
      window._crmBuscados[uLow] = null;                 // evita pedirlo dos veces
      supabaseClient.rpc('panel_crm_perfil_v1',{
        p_secret: window.PANEL_DATA_SECRET,
        p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
        p_query: null, p_usuario: u, p_limit: 1
      }).then(function(r){
        const j = (r && r.data && (r.data.jugadores||[])[0]) || null;
        if(!j) return;
        window._crmBuscados[uLow] = j;
        if(document.getElementById('perfilJugadorOverlay') && window.__perfilJugadorAbierto===uLow){
          window.abrirPerfilJugador(u);
        }
      }).catch(function(){});
    }
  }catch(_e){}
};

// Árbol de operaciones de un usuario: merge de Supabase (_historialData) + store local
// + caché de historial COMPLETO por usuario (window._arbolFullCache, cargado on-demand al
// abrir el perfil → trae todas las ops del día 1, más allá de las 200 globales de _historialData).
function arbolUsuario(usuario){
  const u = normalizar(usuario||'');
  if(!u) return [];
  const out = {};
  const _full = (window._arbolFullCache && window._arbolFullCache[u]) ? window._arbolFullCache[u] : [];
  const _base = _full.length ? _full.concat(_historialData||[]) : (_historialData||[]);
  _base.forEach(function(h){
    if(normalizar(h.usuario||'')!==u) return;
    const k = String(h.id);
    out[k] = {
      id:h.id, tipo:String(h.tipo||'').toUpperCase(), monto:Number(h.monto||0),
      estado:h.estado||'', saldoPre:h.saldo_pre, saldoPost:h.saldo_post,
      billeteraNombre:h.billetera_nombre||'', operador:h.operador||'',
      chuniorId:h.chunior_movimiento_id||null, notas:h.notas||'',
      fecha:h.created_at, origen:h.origen||'', _local:false
    };
  });
  const map = _movStoreAll();
  Object.keys(map).forEach(function(k){
    const m = map[k];
    if(normalizar(m.usuario||'')!==u) return;
    const kk = String(m.id!=null?m.id:k);
    const base = out[kk] || {};
    const pick = function(a,b){ return (a!==undefined && a!==null && a!=='') ? a : b; };
    out[kk] = {
      id: pick(m.id, base.id),
      tipo: String(pick(m.tipo, base.tipo)||'').toUpperCase(),
      monto: pick(m.monto, base.monto!=null?base.monto:0),
      estado: pick(m.estado, base.estado||''),
      titular:m.titular||'', destino:m.destino||'', cbu:m.cbu||'', obs:m.obs||'',
      saldoPre: pick(m.saldoPre, base.saldoPre),
      saldoPost: pick(m.saldoPost, base.saldoPost),
      billeteraNombre: pick(m.billeteraNombre, base.billeteraNombre||''),
      operador: pick(m.operador, base.operador||''),
      chuniorId: pick(m.chuniorId, base.chuniorId||null),
      bonoPct: m.bonoPct||null,
      notas: pick(m.notas, base.notas||''),
      fecha: pick(m._fecha, base.fecha), origen: pick(m.origen, base.origen||''),
      _local: !base.id
    };
  });
  return Object.values(out).sort(function(a,b){ return new Date(b.fecha||0)-new Date(a.fecha||0); });
}
// Carga ON-DEMAND el historial COMPLETO de UN usuario (todas sus ops de historial_ops de la
// oficina, día 1 → hoy), más allá de las 200 globales de _historialData. Cachea por usuario.
// onDone(hayNuevas) se llama al terminar (hayNuevas=true si trajo filas nuevas → re-render).
window._arbolFullCache = window._arbolFullCache || {};
window.cargarArbolCompletoUsuario = async function(usuario, onDone){
  const u = normalizar(usuario||''); if(!u){ if(onDone)onDone(false); return; }
  const cache = window._arbolFullCache[u];
  if(cache && cache.__loaded){ if(onDone)onDone(false); return; }   // ya cargado, no repetir
  if(cache && cache.__loading){ if(onDone)onDone(false); return; }
  window._arbolFullCache[u] = Object.assign(cache||[], {__loading:true});
  try{
    const { data, error } = await supabaseClient
      .from("historial_ops").select("*")
      .in("pc_codigo", (typeof pcAliasesHist==='function'?pcAliasesHist():[]))
      .ilike("usuario", String(usuario||'').trim())   // igualdad case-insensitive (sin comodines)
      .order("created_at", { ascending:false })
      .limit(3000);
    if(!error && Array.isArray(data)){
      data.__loaded = true;
      window._arbolFullCache[u] = data;
      if(onDone) onDone(data.length>0);
    } else {
      window._arbolFullCache[u] = Object.assign([], {__loaded:true});   // marca cargado (vacío) para no reintentar en loop
      if(onDone) onDone(false);
    }
  }catch(_e){
    try{ delete window._arbolFullCache[u]; }catch(__e){}   // permite reintentar en el próximo open
    if(onDone) onDone(false);
  }
};
window.verDetalleMovimiento = function(histId, usuarioArg, solicitudIdArg){
  const esc = escapeHtml;
  // Red por si algo lo llama igual: esta ficha es de plata. Para un cambio de clave o una
  // consulta armaba "Carga · $ 0" con el árbol de otras operaciones abajo, que no tiene
  // nada que ver con la fila que se abrió.
  try{
    const _h = (_historialData||[]).find(function(x){ return String(x.id)===String(histId); });
    const _t = String((_h && _h.tipo) || "").toUpperCase();
    if(_t && ["CARGA","RETIRO","MOV_BILLETERA","CAMBIO_BILLETERA","DEPOSITO_SR",
              "PROPINA","RECARGA_FICHAS"].indexOf(_t) === -1){
      toast("Esa operación no mueve plata: no tiene detalle de movimiento.", "yellow");
      return;
    }
  }catch(_e){}

  const map = _movStoreAll();
  let mov = histId ? (map[String(histId)] || null) : null;
  const hRow = histId ? (_historialData||[]).find(function(x){ return String(x.id)===String(histId); }) : null;

  // 4/10 · La fila que tocó el operador manda sobre cualquier cosa guardada.
  //
  // Abajo el usuario salía de `mov.usuario` —el guardado local— ANTES que del nombre de la
  // fila. Con un número equivocado (ver historial-operaciones.js) eso abría la ficha entera
  // de otro jugador: titular, saldos y árbol de operaciones, sin avisar nada.
  // Si lo guardado no es de la misma persona que la fila, no es de esta fila: se descarta.
  const _norm = function(v){ return String(v==null?"":v).trim().toLowerCase(); };
  const _usuarioFila = _norm(usuarioArg || (hRow && hRow.usuario) || "");
  if(mov && _usuarioFila && _norm(mov.usuario) !== _usuarioFila){
    console.warn("[detalle] lo guardado con el id " + histId + " es de " + mov.usuario +
                 " y la fila es de " + usuarioArg + " — se descarta");
    mov = null;
  }
  if(!mov && hRow){
    const p = _movParseNotas(hRow.notas);
    mov = { id:hRow.id, usuario:hRow.usuario, tipo:hRow.tipo, monto:hRow.monto,
      titular:p.titular, destino:p.destino, cbu:p.cbu, obs:p.obs,
      saldoPre:hRow.saldo_pre, saldoPost:hRow.saldo_post, billeteraNombre:hRow.billetera_nombre,
      operador:hRow.operador, estado:hRow.estado, chuniorId:hRow.chunior_movimiento_id,
      notas:hRow.notas, _fecha:hRow.created_at, origen:hRow.origen };
  }
  // La solicitud del portal que corresponde a esta fila. Es OTRA numeración: por eso llega
  // aparte y nunca se mezcla con el número del movimiento.
  const _solId = String(solicitudIdArg || (hRow && hRow.solicitud_id) || (mov && mov.solicitudId) || '').trim();
  let _solFila = null;
  try{
    const _todas = (window.V154P && window.V154P.solicitudes) || [];
    if(_solId) _solFila = _todas.find(function(x){ return String(x.ID||x.SOLICITUD_ID||'')===_solId; }) || null;
  }catch(_e){}

  const usuario = usuarioArg || (hRow&&hRow.usuario) || (mov&&mov.usuario) || (_solFila&&_solFila.USUARIO) || '';
  if(!usuario){ toast('No se encontró el movimiento', 'red'); return; }
  // Una solicitud que todavía no llegó a ser movimiento (pendiente, rechazada) no tiene nada
  // en el historial. Antes eso salía como "Carga · $ 0"; ahora la ficha se arma con lo que
  // la solicitud SÍ tiene.
  if(!mov && _solFila){
    mov = {
      usuario: _solFila.USUARIO || usuario,
      tipo: String(_solFila.TIPO || _solFila.TIPO_SOLICITUD || "").toUpperCase(),
      monto: Number(_solFila.MONTO_REAL != null ? _solFila.MONTO_REAL : _solFila.MONTO_DECLARADO || 0),
      titular: _solFila.TITULAR || _solFila.NOMBRE_COMPLETO || "",
      destino: _solFila.DESTINO || "",
      billeteraNombre: _solFila.BILLETERA_NOMBRE || "",
      operador: _solFila.OPERADOR || "",
      estado: _solFila.ESTADO || "",
      solicitudId: _solId,
      _fecha: _solFila.FECHA_CREACION || _solFila.FECHA || ""
    };
  }
  if(!mov) mov = { usuario:usuario, tipo:'', monto:0 };

  const esRetiro = String(mov.tipo||'').toUpperCase()==='RETIRO';
  const acc = esRetiro ? '#fb923c' : '#22c55e';
  const _estadoOk = ['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA'].includes(String(mov.estado||'').toUpperCase());
  const estadoTxt = mov.estado ? ('<span style="color:'+(_estadoOk?'#22c55e':(String(mov.estado).toUpperCase()==='ERROR'?'#ef4444':'#8b949e'))+';font-weight:800">'+esc(mov.estado)+'</span>') : '—';
  const fila = function(lbl,val){ return val!==undefined && val!==null && val!=='' && val!=='—'
    ? '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0"><span style="color:#8b949e">'+lbl+'</span><span style="color:#e6edf3;font-weight:600;text-align:right">'+val+'</span></div>' : ''; };

  // CBU/alias DECLARADO en la solicitud del retiro: si no vino en las notas del movimiento, lo
  // buscamos en la solicitud del portal (V154P) por usuario + tipo RETIRO → SIEMPRE aparece.
  let cbuVal = String(mov.cbu||mov.destino||'').trim();
  let titularDecl = String(mov.titular||'').trim();
  let cbuDudoso = false;   // true = el CBU no salió del retiro exacto, sino del más reciente
  if (esRetiro && (!cbuVal || !titularDecl)) {
    try {
      const _sols = (window.V154P && window.V154P.solicitudes) || [];
      const _sid = String(mov.solicitud_id||mov.SOLICITUD_ID||mov.solicitudId||mov.ID_SOLICITUD||'').trim();
      let _sol = null;
      // 1) Por ID de solicitud: es el único cruce que no se puede equivocar de retiro.
      if(_sid) _sol = _sols.find(function(s){ return String(s.ID||s.SOLICITUD_ID||'')===_sid; }) || null;
      if(!_sol){
        // 2) Sin ID hay que adivinar. Antes esto era un .find() por usuario+RETIRO a secas: con
        //    DOS retiros del mismo usuario en la lista agarraba el primero del array — el VIEJO —
        //    y mostraba (y copiaba) el CBU de un retiro anterior. O sea, pagarle al CBU equivocado.
        //    Ahora se toma el más NUEVO y, si había más de uno, queda marcado como a verificar.
        const _cands = _sols.filter(function(s){
          return String(s.USUARIO||s.USUARIO_JUGADOR||'').toLowerCase()===String(usuario).toLowerCase()
            && String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='RETIRO';
        }).sort(function(a,b){
          return new Date(b.FECHA_CREACION||b.FECHA||0) - new Date(a.FECHA_CREACION||a.FECHA||0);
        });
        _sol = _cands[0] || null;
        if(_cands.length>1) cbuDudoso = true;
      }
      if (_sol) {
        if (!cbuVal)      cbuVal      = String(_sol.DESTINO||_sol.CBU||_sol.RETIRO_ALIAS_CBU||_sol.ALIAS_CBU||'').trim();
        if (!titularDecl) titularDecl = String(_sol.TITULAR||_sol.RETIRO_TITULAR||'').trim();
      }
    } catch(_e){}
  }
  const cbuHtml = (esRetiro && cbuVal)
    ? '<button type="button" onclick="portalCopiarCbu(this)" data-valor="'+esc(cbuVal)+'" title="Tocá para copiar" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;cursor:pointer;background:#0d1117;border:1px solid rgba('+(cbuDudoso?'245,197,24,.6':'251,146,60,.45')+');border-radius:9px;padding:8px 11px;color:#e6edf3;margin-top:6px"><span style="min-width:0;flex:1"><span style="display:block;font-size:10px;font-weight:800;text-transform:uppercase;color:'+(cbuDudoso?'#f5c518':'#8b949e')+'">'+(cbuDudoso?'⚠ CBU del retiro MÁS RECIENTE · verificalo contra la solicitud':'CBU / Alias destino · tocá para copiar')+'</span><span style="display:block;font-family:ui-monospace,monospace;font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(cbuVal)+'</span></span><span class="pcopy-ico">📋</span></button>'
    : '';
  // Cruce antifraude con la base local de jugadores: ¿destino conocido? ¿titular habitual?
  let cbuWarnHtml = '';
  if(esRetiro && cbuVal && window.jugadorCbuCheck){
    try{
      const _chk = window.jugadorCbuCheck(usuario, cbuVal, titularDecl);
      if(_chk && _chk.datos){
        const _uEsc = String(usuario).replace(/'/g,"\\'");
        if(_chk.titularNuevo)
          cbuWarnHtml = '<div style="margin-top:6px;padding:7px 10px;border-radius:8px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.5);color:#fca5a5;font-size:12px;font-weight:700">🚨 Titular DISTINTO al que suele usar ('+esc((_chk.titularesConocidos||[]).slice(0,2).join(', '))+'). Revisá antes de transferir — posible cuenta ajena.</div>';
        else if(!_chk.conocido)
          cbuWarnHtml = '<div style="margin-top:6px;padding:7px 10px;border-radius:8px;background:rgba(245,197,24,.12);border:1px solid rgba(245,197,24,.5);color:#fde68a;font-size:12px;font-weight:700">⚠️ Destino NUEVO — nunca cobró en esta cuenta. Confirmá con el usuario.</div>';
        else
          cbuWarnHtml = '<div style="margin-top:5px;font-size:11px;color:#22c55e;font-weight:700">✓ Ya cobró en este destino ×'+_chk.veces+'</div>';
        cbuWarnHtml += '<button type="button" class="mini-btn" style="margin-top:6px;font-size:11px;background:#1e293b;color:#93c5fd" onclick="mostrarDestinosUsuario(\''+_uEsc+'\')">📇 Todos los destinos del usuario</button>';
      }
    }catch(_e){}
  }

  const arbol = arbolUsuario(usuario);
  let totC=0, totR=0;
  arbol.forEach(function(o){ const m=Math.abs(Number(o.monto||0)); const t=String(o.tipo||'').toUpperCase(); if(t==='CARGA')totC+=m; else if(t==='RETIRO')totR+=m; });
  const filasArbol = arbol.map(function(o){
    const t = String(o.tipo||'').toUpperCase();
    const ico = t==='CARGA'?'⬆️':t==='RETIRO'?'⬇️':'•';
    const eOk = ['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA'].includes(String(o.estado||'').toUpperCase());
    const eIco = eOk?'<span style="color:#22c55e">✅</span>':String(o.estado||'').toUpperCase()==='ERROR'?'<span style="color:#ef4444">❌</span>':'<span style="color:#8b949e">•</span>';
    const esActual = String(o.id)===String(histId);
    const extras = [];
    if(o.titular) extras.push('👤 '+esc(o.titular));
    if(o.chuniorId) extras.push('Nº '+esc(String(o.chuniorId)));
    if(o.billeteraNombre) extras.push(esc(String(o.billeteraNombre).split('·')[0].trim()));
    if(o.operador) extras.push('op:'+esc(o.operador));
    return '<div style="padding:7px 9px;border-radius:8px;margin-top:6px;background:'+(esActual?'rgba(245,197,24,.08)':'#0d1117')+';border:1px solid '+(esActual?'rgba(245,197,24,.4)':'#21262d')+'">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
      +   '<span style="font-weight:700">'+ico+' '+esc(t||'—')+' '+eIco+(esActual?' <span style="font-size:10px;color:#f5c518">(este)</span>':'')+'</span>'
      +   '<span style="font-weight:800;color:'+(t==='RETIRO'?'#fb923c':'#22c55e')+'">'+money(Math.abs(Number(o.monto||0)))+'</span>'
      + '</div>'
      + '<div style="font-size:11px;color:#8b949e;margin-top:2px">'+formatFecha(o.fecha)
      +   (o.saldoPost!=null?(' · saldo '+money(o.saldoPost)):'')
      +   (extras.length?(' · '+extras.join(' · ')):'')
      + '</div></div>';
  }).join('') || '<div class="small" style="color:#8b949e;padding:8px">Sin otras operaciones registradas para este usuario.</div>';

  // ── Por qué se rechazó ────────────────────────────────────────────────────────────────
  // Juan, 4/10: "no tengo informacion sobre los rechazos... que va a pasar cuando abra el
  // boton de la lupa? nada". Tenía razón: el motivo ya venía en la solicitud, guardado, y
  // esta ficha no lo miraba. Ahora se muestra — y cuando no hay motivo guardado, se dice que
  // no lo hay, que es un dato en sí mismo.
  let rechazoHtml = "";
  try{
    const _mt = (_solFila && (_solFila.metadata || _solFila.METADATA)) || {};
    const _estSol = String((_solFila && _solFila.ESTADO) || (hRow && hRow.estado) || (mov && mov.estado) || "").toUpperCase();
    const _esRechazo = ["RECHAZADA","CANCELADA","ERROR"].indexOf(_estSol) >= 0;
    let _motivo = String(_mt.motivo || _mt.motivo_rechazo || "").trim();
    const _obs = String(_mt.observacion || "").trim();
    const _quien = String(_mt.operador || (_solFila && _solFila.OPERADOR) || (mov && mov.operador) || "").trim();
    // Los controles del panel guardan un código, no una frase. Al operador le sirve la frase.
    const _enCastellano = {
      REINCIDENTE: "Ya había mandado el mismo comprobante antes",
      DATO_PROPIO: "Transfirió desde una cuenta nuestra",
      USUARIO_COMO_TITULAR: "Puso su usuario de juego donde va el titular",
      SOLO_NUMEROS: "El titular eran sólo números"
    };
    if(_enCastellano[_motivo]) _motivo = _enCastellano[_motivo] + " (" + _motivo + ")";
    if(_esRechazo || _motivo){
      const _cuerpo = _motivo
        ? '<div style="font-size:14px;font-weight:700;color:#f0f6fc">'+esc(_motivo)+'</div>'
        : '<div style="font-size:13px;color:#fca5a5;font-weight:700">No quedó guardado por qué se rechazó.</div>';
      const _pie = [];
      if(_quien) _pie.push('lo hizo '+esc(_quien));
      if(!_quien) _pie.push('no quedó registrado quién');
      if(_solId) _pie.push('solicitud N° '+esc(_solId));
      rechazoHtml =
        '<div style="margin-top:10px;border-radius:10px;padding:11px 13px;border:1px solid rgba(248,113,113,.45);background:rgba(248,113,113,.07)">'
        + '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fca5a5;margin-bottom:5px">✖ Por qué se rechazó</div>'
        + _cuerpo
        + (_obs ? '<div style="margin-top:5px;font-size:12.5px;color:#e6edf3">'+esc(_obs)+'</div>' : "")
        + '<div style="margin-top:6px;font-size:11.5px;color:#8b949e">'+esc(_pie.join(" · "))+'</div>'
        + '</div>';
    }
  }catch(_e){}

  const body =
    '<div style="max-height:66vh;overflow:auto">'
    + '<div style="border-radius:10px;padding:11px 13px;border:1px solid '+(esRetiro?'rgba(251,146,60,.35)':'rgba(34,197,94,.3)')+';background:'+(esRetiro?'rgba(251,146,60,.06)':'rgba(34,197,94,.06)')+'">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">'
    +     '<b style="font-size:16px;color:'+acc+'">'+(esRetiro?'⬇️ Retiro':'⬆️ Carga')+' · '+esc(usuario)+'</b>'
    +     '<b style="font-size:18px;color:'+acc+'">'+money(Math.abs(Number(mov.monto||0)))+'</b>'
    +   '</div>'
    +   cbuHtml + cbuWarnHtml
    +   '<div style="margin-top:8px;font-size:13px">'
    +     fila('Titular', esc(titularDecl||mov.titular||''))
    +     fila('Destino', esc(mov.destino||''))
    +     fila('Horario', formatFecha(mov._fecha||mov.fecha))
    +     fila('Saldo antes', mov.saldoPre!=null?money(mov.saldoPre):'')
    +     fila('Saldo después', mov.saldoPost!=null?money(mov.saldoPost):'')
    +     fila('Billetera', esc(String(mov.billeteraNombre||'').split('·')[0].trim()))
    +     fila('Operador', esc(mov.operador||''))
    +     fila('Nº Chunior', esc(String(mov.chuniorId||'')))
    +     fila('Bono', mov.bonoPct?('+'+esc(String(mov.bonoPct))+'%'):'')
    +     fila('Estado', estadoTxt)
    +     fila('Obs', esc(mov.obs||''))
    +   '</div>'
    + '</div>'
    + rechazoHtml
    + ((esRetiro && hRow && hRow.solicitud_id && window.nodoRetiroHistoriaHtml) ? window.nodoRetiroHistoriaHtml(hRow.solicitud_id, hRow.id) : '')
    + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;padding:8px 11px;background:#161b22;border-radius:9px;font-size:12px">'
    +   '<span>📊 <b>'+arbol.length+'</b> operación/es</span>'
    +   '<span style="color:#22c55e">⬆️ '+money(totC)+'</span>'
    +   '<span style="color:#fb923c">⬇️ '+money(totR)+'</span>'
    +   '<span style="color:#e6edf3">neto <b>'+money(totC-totR)+'</b></span>'
    + '</div>'
    + '<div style="font-weight:800;margin:12px 0 2px;color:#c9d1d9">🌳 Árbol de operaciones de '+esc(usuario)+'</div>'
    + filasArbol
    + '</div>';

  abrirModal('🔍 Detalle del movimiento', body, null, '');
  try{ if(window.nodoRetiroHistoriaLlenar) window.nodoRetiroHistoriaLlenar(document.getElementById('modalBody')); }catch(_e){}
  try{ const b=document.getElementById('modalSaveBtn'); if(b) b.style.display='none'; }catch(_e){}
};
const _HIST_FULL_MAX = 5000;
function _histFullKey(){ return "nodo_historial_full_"+(pcOperativa||"sin_pc"); }
function _archivoHistorialCargar(){
  try{ const raw = localStorage.getItem(_histFullKey()); const o = raw?JSON.parse(raw):null; return (o && Array.isArray(o.rows)) ? o.rows : []; }
  catch(_e){ return []; }
}
function _archivoHistorialGuardar(rows){
  try{ localStorage.setItem(_histFullKey(), JSON.stringify({ ts:Date.now(), rows: rows.slice(0, _HIST_FULL_MAX) })); }
  catch(_e){
    try{ localStorage.setItem(_histFullKey(), JSON.stringify({ ts:Date.now(), rows: rows.slice(0, Math.floor(_HIST_FULL_MAX/2)) })); }catch(_e2){}
  }
}
function _movStoreToHistRows(){
  try{
    if(typeof _movStoreAll !== 'function') return [];
    const map = _movStoreAll();
    return Object.keys(map).map(function(k){
      const m = map[k] || {};
      return {
        id: (m.id!=null ? m.id : ('mov_'+k)),
        usuario: m.usuario||'', tipo: m.tipo||'', monto: m.monto!=null?m.monto:0,
        billetera_id: null, billetera_nombre: m.billeteraNombre||null,
        origen: m.origen||'MANUAL', estado: m.estado||'OK',
        notas: m.notas||null, chunior_movimiento_id: m.chuniorId||null,
        saldo_pre: (m.saldoPre!=null?m.saldoPre:null), saldo_post: (m.saldoPost!=null?m.saldoPost:null),
        operador: m.operador||null, solicitud_id: m.solicitudId||null,
        created_at: m._fecha || (m._ts?new Date(m._ts).toISOString():null)
      };
    }).filter(function(r){ return r.usuario || r.monto; });
  }catch(_e){ return []; }
}
function _archivoHistorialMerge(nuevas){
  const map = {};
  _archivoHistorialCargar().forEach(function(r){ if(r && r.id!=null) map[String(r.id)] = r; });
  (nuevas||[]).forEach(function(r){ if(r && r.id!=null) map[String(r.id)] = r; });
  const arr = Object.values(map).sort(function(a,b){ return new Date(b.created_at||0)-new Date(a.created_at||0); });
  _archivoHistorialGuardar(arr);
  return arr;
}
// Resumen compacto del árbol de un usuario (para embeber en el modal de retiro parcial):
// totales + últimas operaciones. Devuelve '' si no hay historial.
function _arbolResumenHtml(usuario){
  try{
    if(typeof arbolUsuario!=='function') return '';
    const arbol = arbolUsuario(usuario);
    if(!arbol.length) return '';
    let totC=0, totR=0;
    arbol.forEach(function(o){ const m=Math.abs(Number(o.monto||0)); const t=String(o.tipo||'').toUpperCase(); if(t==='CARGA')totC+=m; else if(t==='RETIRO')totR+=m; });
    const ult = arbol.slice(0,6).map(function(o){
      const t=String(o.tipo||'').toUpperCase(); const ico=t==='CARGA'?'⬆️':t==='RETIRO'?'⬇️':'•';
      return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#94a3b8"><span>'+ico+' '+escapeHtml(t||'—')+' · '+formatFecha(o.fecha)+'</span><span style="font-weight:700;color:'+(t==='RETIRO'?'#fb923c':'#22c55e')+'">'+money(Math.abs(Number(o.monto||0)))+'</span></div>';
    }).join('');
    return '<div style="margin-top:10px;padding:8px 10px;background:#0d1117;border:1px solid #21262d;border-radius:9px">'
      + '<div style="display:flex;justify-content:space-between;gap:6px;font-size:11px;margin-bottom:4px;flex-wrap:wrap"><b style="color:#c9d1d9">🌳 '+arbol.length+' ops</b><span style="color:#22c55e">⬆️ '+money(totC)+'</span><span style="color:#fb923c">⬇️ '+money(totR)+'</span><span style="color:#e6edf3">neto <b>'+money(totC-totR)+'</b></span></div>'
      + ult + '</div>';
  }catch(_e){ return ''; }
}
// Progreso de un retiro PARCIAL: cuánto se pagó ya (metadata.retiro_parcial.pagado) y cuánto resta.
// Se usa para que la tarjeta y el modal muestren el RESTANTE (no el total original) a medida que se paga.
// ── Cuánto se pagó REALMENTE de un retiro ────────────────────────────────────────────────────
// Se SUMA DEL HISTORIAL, no se lee de un contador. Cada transferencia real escribe su fila con
// solicitud_id, monto y billetera: ese es el libro, y es el único registro que existe porque
// hubo plata moviéndose. metadata.monto_pagado es un acumulado que se le suma a ciegas en cada
// pago — se conto doble una vez y quedaron solicitudes diciendo "pagado 450.000" cuando habian
// salido 250.000, sin forma de corregirlo desde el panel (la RPC solo suma, no fija).
// Derivarlo del historial lo hace AUTOCORREGIBLE: si el numero guardado esta podrido, el proximo
// pago lo pisa con la suma real. Mismo criterio que con Chunior y el saldo de las billeteras:
// la verdad es el registro de los movimientos, no un contador paralelo.
window._retiroPagadoDelHistorial = function(solicitudId){
  const sid = String(solicitudId||''); if(!sid) return null;
  let filas = [];
  // OJO con el "||" y con Array.isArray: una lista VACÍA es "verdadera" en JS, así que ganaba la
  // vacía y el respaldo no se usaba NUNCA. Gana la que tenga filas.
  try{
    const _lex = (typeof _historialData!=='undefined' && Array.isArray(_historialData)) ? _historialData : null;
    const _win = Array.isArray(window._historialData) ? window._historialData : null;
    filas = (_lex && _lex.length) ? _lex : (_win || _lex || []);
  }catch(_e){ return null; }
  if(!filas.length) return null;                       // historial no cargado → no afirmamos nada
  let suma = 0, n = 0, desde = Infinity;
  filas.forEach(function(h){
    // Hasta dónde llega ATRÁS lo que hay cargado. El historial en pantalla es de un período: si
    // el retiro empezó antes, faltan pagos y la suma NO se puede comparar con nada.
    const t = new Date((h && h.created_at) || 0).getTime();
    if(Number.isFinite(t) && t > 0 && t < desde) desde = t;
    if(!h || String(h.solicitud_id||'')!==sid) return;
    if(normalizar(h.tipo)!=='RETIRO') return;
    if(normalizar(h.estado)!=='OK') return;            // sólo las efectivas
    suma += Math.abs(Number(h.monto||0)) || 0; n++;
  });
  // `desde` viaja siempre: sin él no se sabe si la suma está completa.
  return n ? { pagado:suma, filas:n, desde:desde } : null;   // sin filas → todavía no se pagó nada
};

window._retiroParcialInfo = function(s){
  // El total salía SIEMPRE del monto de la solicitud, ignorando el que registró la RPC de
  // parciales. Con un monto mal cargado —hay solicitudes que entraron del portal con un cero
  // de más (D-65)— la caja mostraba cifras delirantes y "cuánto falta" quedaba sin sentido.
  // Manda el total que usó el motor de pagos; el de la solicitud queda de respaldo (D-66).
  let total = 0;
  let pagado = 0, pagadoAlt = 0;
  let _pagosRp = [];   // los pagos del contador, para saber desde cuándo corre este retiro
  try{
    let m = (s&&(s.METADATA!==undefined?s.METADATA:s.metadata))||{};
    if(typeof m==='string'){ try{ m=JSON.parse(m); }catch(_e){ m={}; } }
    const rp = (m&&(m.retiro_parcial||m.retiro_progreso||m.progreso))||{};
    _pagosRp = Array.isArray(rp.pagos) ? rp.pagos : [];
    pagado = Math.abs(Number((rp.pagado!=null?rp.pagado:(rp.acumulado!=null?rp.acumulado:(m.pagado_parcial!=null?m.pagado_parcial:0))))||0);
    // El progreso vive en DOS lugares: retiro_parcial (lo escribe la RPC) y monto_pagado suelto (lo
    // escribe el panel). Si un pago quedó registrado en uno solo, los números no coinciden y el
    // retiro se ve "a medio pagar" aunque esté saldado. Guardamos el otro para poder avisarlo.
    pagadoAlt = Math.abs(Number(m.monto_pagado!=null ? m.monto_pagado : pagado)||0);
    // Si el operador CORRIGIÓ el monto ("pagarle todo lo que tiene"), esa es la deuda. La RPC
    // guardaba el total viejo y la caja decía "falta $45.000 de $50.000" con la solicitud ya
    // corregida a $35.019 (D-86). La corrección manda; la RPC ya se arregló igual.
    const _corr = Number(m.monto_corregido)||0;
    total = _corr > 0 ? _corr : (Number(rp.total)||0);
  }catch(_e){}
  if(!(total>0)) total = Number((s&&(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO))||0);
  if(total>0 && pagado>total) pagado=total;
  const _alt = (total>0 && pagadoAlt>total) ? total : pagadoAlt;
  // TERCERA fuente, y la única que NO es un contador: la suma de las transferencias que realmente
  // salieron (historial_ops). Si un pago no llegó a anotarse en el progreso —le pasó al último pago
  // de un retiro, D-100— el libro igual lo tiene y el retiro deja de figurar colgado para siempre.
  let _hist = 0, _histCompleto = false;
  try{
    const _h = window._retiroPagadoDelHistorial
      ? window._retiroPagadoDelHistorial(s && (s.ID || s.SOLICITUD_ID || s.solicitud_id || s.id)) : null;
    if(_h && _h.pagado > 0) _hist = (total>0 && _h.pagado>total) ? total : _h.pagado;
    // ¿La suma del historial se puede COMPARAR? Sólo si lo cargado llega más atrás que el primer
    // pago: el historial en pantalla es de un período, y si el retiro empezó antes faltan pagos.
    // Sin esto, el panel gritaba «el progreso no coincide» con los dos registros perfectamente
    // iguales — le pasó al #275413 (normaacdc), donde el pago más viejo quedaba fuera del período
    // cargado y la resta daba justo ese pago (Juan, 28/9). Mandar a revisar algo que está bien
    // cuesta el tiempo del operador y le saca valor al aviso cuando el descuadre es de verdad.
    if(_h && Number.isFinite(_h.desde)){
      let _primerPago = Infinity;
      const _pagos = _pagosRp;
      _pagos.forEach(function(pg){
        const t = new Date((pg && pg.fecha) || 0).getTime();
        if(Number.isFinite(t) && t > 0 && t < _primerPago) _primerPago = t;
      });
      if(!Number.isFinite(_primerPago)){
        const t = new Date((s && (s.FECHA_CREACION || s.created_at || s.FECHA)) || 0).getTime();
        if(Number.isFinite(t) && t > 0) _primerPago = t;
      }
      _histCompleto = Number.isFinite(_primerPago) && _h.desde <= _primerPago;
    }
  }catch(_e){}
  // "Esto es un retiro EN PARTES" lo dice SÓLO la máquina de parciales (retiro_parcial). El
  // historial dice CUÁNTO se pagó, que es otra cosa: todo retiro pagado tiene su fila ahí, así que
  // usarlo para decidir "hay progreso" convertía en parcial a TODOS los retiros comunes — salían
  // como "Parcial 100%" con monto $0 (D-103). Y monto_pagado tampoco sirve: el panel lo escribe en
  // cada retiro, parcial o no.
  const hayParcial = pagado > 0.5;
  // Con progreso real, lo cobrado es lo más alto: un pago puede faltar en un contador, pero si salió, salió.
  const _cobrado = hayParcial ? Math.max(pagado, _alt, _hist) : pagado;
  return {
    total:total, pagado:_cobrado, restante:Math.max(0, total - _cobrado),
    hasProg:hayParcial,
    // Las otras fuentes + si discrepan: NO se decide por una, se avisa al operador para que resuelva.
    pagadoRpc:pagado, pagadoAlt:_alt, pagadoHistorial:_hist,
    discrepa: (Math.abs(_alt - pagado) > 1) || (_histCompleto && _hist > 0.5 && Math.abs(_hist - pagado) > 1),
    histCompleto: _histCompleto,
    saldadoPorAlguna: (total>0 && _cobrado >= total-0.5)
  };
};
// Un RETIRO con progreso PARCIAL (se pagó algo pero NO todo) sigue PENDIENTE hasta cobrar el total,
// aunque la RPC lo haya marcado PAGADA/completo. Solo debe desaparecer si se retiró por COMPLETO
// (pagado >= total) o si es un cierre deliberado (RECHAZADA/CANCELADA). Red de seguridad del panel.
// Caja de retiros pagándose por partes. Portado de la línea de la encargada (5405ff9): los
// parciales salían mezclados con las solicitudes nuevas y se perdían de vista — de hecho pasamos
// media sesión peleando con uno que "desaparecía". La lista la arma el render del Inicio en
// window._parcialesEnProceso.
// Recalcula la caja con lo que hay AHORA en memoria. Antes leía window._parcialesEnProceso, que es
// una foto que sólo se rearma cuando el Inicio se repinta: un retiro cobrado entero (o cerrado
// desde otra PC) seguía apareciendo con «falta $X» aunque en la base ya no faltara nada (D-108).
window._parcialesAhora = function(){
  try{
    const dom = window.NodoDomain && window.NodoDomain.parciales;
    const todas = (window.V154P && window.V154P.solicitudes) || [];
    if(!dom || !todas.length) return (window._parcialesEnProceso || []).slice();
    const vivos = todas.filter(function(s){
      return dom.enProceso(s, {
        info: window._retiroParcialInfo, cerrado: window._retiroCerradoAMano,
        sigueAbierto: window._retiroParcialSigueAbierto
      });
    });
    window._parcialesEnProceso = vivos;   // que el contador y la caja digan lo mismo
    try{
      ['btnParcialesCount','btnParcialesCCCount'].forEach(function(id){
        const el = document.getElementById(id); if(el) el.textContent = String(vivos.length);
      });
      ['btnParcialesEnProceso','btnParcialesCC'].forEach(function(id){
        const el = document.getElementById(id); if(el) el.style.display = vivos.length ? '' : 'none';
      });
    }catch(_e){}
    return vivos.slice();
  }catch(_e){ return (window._parcialesEnProceso || []).slice(); }
};
window.verRetirosParciales = function(){
  const arr = window._parcialesAhora();
  if(!arr.length){ try{ toast('No hay retiros pagándose por partes.','blue'); }catch(_e){} return; }
  const filas = arr.map(function(s){
    const id  = Number(s.ID || s.SOLICITUD_ID || 0);
    const pp  = window._retiroParcialInfo ? window._retiroParcialInfo(s) : {total:0,pagado:0,restante:0};
    const pct = pp.total > 0 ? Math.min(100, Math.round(pp.pagado * 100 / pp.total)) : 0;
    const usuario = escapeHtml(String(s.USUARIO || s.USUARIO_JUGADOR || ''));
    const titular = escapeHtml(String(s.TITULAR || s.NOMBRE_COMPLETO || ''));
    const fecha   = s.FECHA_CREACION || s.created_at || s.FECHA || '';
    return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #7c3aed;border-radius:10px;padding:10px 12px;margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
      +   '<div style="min-width:0"><b style="font-size:15px;color:#f0f6fc">'+usuario+'</b>'
      +     (titular ? '<div class="small" style="color:#8b949e">'+titular+'</div>' : '') + '</div>'
      +   '<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:#a78bfa">falta '+money(pp.restante)+'</div>'
      +     '<div class="small" style="color:#8b949e">'+money(pp.pagado)+' de '+money(pp.total)+'</div></div>'
      + '</div>'
      + '<div style="height:6px;background:#0d1117;border-radius:999px;overflow:hidden;margin-top:8px">'
      +   '<div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#7c3aed,#a78bfa)"></div></div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px">'
      +   '<span class="small" style="color:#8b949e">#'+id+(fecha ? ' · '+escapeHtml(String(formatFecha(fecha))) : '')+'</span>'
      +   '<button class="mini-btn" style="background:#7c3aed;color:#fff;border:none;font-size:11px" '
      +     'onclick="cerrarModal();v154pRegistrarParcial('+id+')">💸 Pagar más</button>'
      + '</div></div>';
  }).join('');
  abrirModal('💸 Retiros pagándose por partes · '+arr.length, filas, null, '');
};

// ¿Este retiro cerrado lo cerró el operador A MANO desde la caja de Parciales?
// El cierre a mano es DEFINITIVO: es una decisión del operador y no la revierte nadie.
//
// Vivía en `etapa`, y ese campo lo pisa CADA pago parcial (withdrawals-execution: etapa =
// RETIRO_V2_PARCIAL). O sea que un pago posterior borraba el cierre y el retiro volvía a la caja.
// El #266250 de Maria6981x se cerró SIETE veces por esto (25-26/9). Ahora la marca va en su
// propia llave, que no escribe ningún otro camino.
// Se sigue aceptando la marca vieja en `etapa` para los retiros que ya se cerraron así.
function _retiroCerradoAMano(s){
  try{
    let m = (s&&(s.METADATA!==undefined?s.METADATA:s.metadata))||{};
    if(typeof m==='string'){ try{ m=JSON.parse(m); }catch(_e){ m={}; } }
    if(m && m.cierre_manual) return true;
    return String((m&&m.etapa)||'').toUpperCase()==='RETIRO_CIERRE_MANUAL';
  }catch(_e){ return false; }
}
window._retiroCerradoAMano = _retiroCerradoAMano;
window._retiroParcialSigueAbierto = function(s){
  try{
    if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='RETIRO') return false;
    const est = String(s.ESTADO||'').toUpperCase();
    if(/RECHAZ|CANCEL/.test(est)) return false;   // cierre deliberado del operador → respetar
    // Cerrado a mano ("✔ ya cobró todo"). Sin esto el retiro volvía a la caja en el
    // siguiente refresco: se podía cerrar infinitas veces y el contador nunca bajaba de 1.
    if(_retiroCerradoAMano(s)) return false;
    const pp = window._retiroParcialInfo ? window._retiroParcialInfo(s) : null;
    if(!pp) return false;
    // Si CUALQUIERA de las dos fuentes del progreso dice que ya está pago, no se reabre.
    // Es el MISMO criterio con el que la caja imprime "✔ saldado" — antes esta función usaba
    // otro (sólo retiro_parcial.pagado) y las dos mitades del panel se contradecían: la caja
    // decía "saldado" y este filtro lo devolvía a la lista.
    if(pp.saldadoPorAlguna) return false;
    return !!(pp.hasProg && pp.total>0 && pp.pagado < pp.total - 0.5);
  }catch(_e){ return false; }
};
// Modal de los retiros que se están pagando POR PARTES. Salen de "Solicitudes pendientes" (podían
// quedar abiertos días y tapaban las solicitudes nuevas) y se agrupan acá, con su progreso y el
// botón para seguir pagando. La lista la arma el render del Inicio en window._parcialesEnProceso.
window.verRetirosParciales = function(){
  const arr = (window._parcialesEnProceso || []).slice();
  if(!arr.length){ try{ toast('No hay retiros pagándose por partes.','blue'); }catch(_e){} return; }
  const filas = arr.map(function(s){
    const id  = Number(s.ID || s.SOLICITUD_ID || 0);
    const pp  = window._retiroParcialInfo ? window._retiroParcialInfo(s) : {total:0,pagado:0,restante:0};
    const pct = pp.total > 0 ? Math.min(100, Math.round(pp.pagado * 100 / pp.total)) : 0;
    const usuario = escapeHtml(String(s.USUARIO || s.USUARIO_JUGADOR || ''));
    const titular = escapeHtml(String(s.TITULAR || s.NOMBRE_COMPLETO || ''));
    const fecha   = s.FECHA_CREACION || s.created_at || s.FECHA || '';
    // Ya cobró todo pero la solicitud quedó abierta → se ofrece cerrarla, no pagar más.
    // "saldadoPorAlguna": una de las dos fuentes del progreso dice que ya está pago.
    const saldado = pp.restante <= 0.5 || pp.saldadoPorAlguna;
    const acento  = saldado ? '#22c55e' : '#7c3aed';
    return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid '+acento+';border-radius:10px;padding:10px 12px;margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
      +   '<div style="min-width:0"><b style="font-size:15px;color:#f0f6fc">'+usuario+'</b>'
      +     (titular ? '<div class="small" style="color:#8b949e">'+titular+'</div>' : '') + '</div>'
      +   '<div style="text-align:right"><div style="font-weight:900;font-size:15px;color:'+acento+'">'
      +       (saldado ? '✔ saldado' : 'falta '+money(pp.restante))+'</div>'
      +     '<div class="small" style="color:#8b949e">'+money(pp.pagado)+' de '+money(pp.total)+'</div></div>'
      + '</div>'
      + '<div style="height:6px;background:#0d1117;border-radius:999px;overflow:hidden;margin-top:8px">'
      +   '<div style="height:100%;width:'+pct+'%;background:'+(saldado?'#22c55e':'linear-gradient(90deg,#7c3aed,#a78bfa)')+'"></div></div>'
      // Las dos fuentes del progreso no coinciden → no se decide por una: se muestran las dos y el
      // operador elige (cobró todo → Cerrar · falta → Pagar más).
      + (pp.discrepa
          ? ('<div style="margin-top:8px;padding:6px 9px;border-radius:8px;background:rgba(245,197,24,.10);border:1px solid rgba(245,197,24,.35);font-size:11.5px;color:#fde68a">'
             + '⚠ El progreso no coincide: <b>'+money(pp.pagadoRpc)+'</b> según el contador de parciales'
             + (pp.pagadoAlt>0.5 && Math.abs(pp.pagadoAlt-pp.pagadoRpc)>1 ? ', <b>'+money(pp.pagadoAlt)+'</b> según el retiro normal' : '')
             + (pp.histCompleto && pp.pagadoHistorial>0.5 && Math.abs(pp.pagadoHistorial-pp.pagadoRpc)>1 ? ', <b>'+money(pp.pagadoHistorial)+'</b> sumando el historial' : '')
             + '. '
             + 'Fijate en el historial cuánto cobró y elegí.</div>')
          : '')
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;flex-wrap:wrap">'
      +   '<span class="small" style="color:#8b949e">#'+id+(fecha ? ' · '+escapeHtml(String(formatFecha(fecha))) : '')+'</span>'
      +   '<span style="display:flex;gap:6px">'
      // El "Cerrar" está SIEMPRE disponible: sin esa salida, un retiro con el progreso mal
      // registrado quedaba trabado en la bandeja sin forma de sacarlo.
      +     '<button class="mini-btn" style="background:'+(saldado?'#12b76a':'transparent')+';color:'+(saldado?'#fff':'#8b949e')+';border:'+(saldado?'none':'1px solid #30363d')+';font-size:11px" title="Marcar la solicitud como pagada (no mueve fichas ni plata)" onclick="cerrarRetiroSaldado('+id+')">✔ Cerrar'+(saldado?' · ya cobró todo':'')+'</button>'
      +     (saldado ? '' : '<button class="mini-btn" style="background:#7c3aed;color:#fff;border:none;font-size:11px" onclick="cerrarModal();v154pRegistrarParcial('+id+')">💸 Pagar más</button>')
      +   '</span>'
      + '</div></div>';
  }).join('');
  const _sald = arr.filter(function(s){ const p=window._retiroParcialInfo?window._retiroParcialInfo(s):null; return p && p.restante<=0.5; }).length;
  abrirModal('💸 Retiros pagándose por partes · '+arr.length
    + (_sald ? ' <span style="font-size:12px;color:#22c55e">('+_sald+' ya saldado'+(_sald>1?'s':'')+')</span>' : ''), filas, null, '');
};
// ── La historia de un retiro pagado en partes (D-90) ─────────────────────────────────────────
// Pedido, ajuste con su motivo, cada pago y el cierre. Se pinta en cualquier
// <div class="nodo-retiro-historia" data-sid="…" data-hist="…"> que haya en pantalla.
window._retiroHistoriaCache = window._retiroHistoriaCache || {};
window.nodoRetiroHistoriaHtml = function(sid, histId){
  return '<div class="nodo-retiro-historia" data-sid="'+escapeHtml(String(sid||''))+'" data-hist="'+escapeHtml(String(histId||''))+'" style="margin-top:10px"></div>';
};
window.nodoRetiroHistoriaLlenar = async function(root){
  const els = Array.from(((root || document).querySelectorAll && (root || document).querySelectorAll('.nodo-retiro-historia[data-sid]')) || []);
  for(const el of els){
    const sid = el.getAttribute('data-sid'); if(!sid) continue;
    let prog = window._retiroHistoriaCache[sid];
    if(!prog || Date.now() - prog._ts > 30000){
      try{
        const r = await supabaseClient.rpc('landing_retiro_progreso', { p_solicitud_id: Number(sid) });
        const row = Array.isArray(r.data) ? r.data[0] : r.data;
        if(r.error || !row || row.ok === false) continue;
        prog = Object.assign({ _ts: Date.now() }, row);
        window._retiroHistoriaCache[sid] = prog;
      }catch(_e){ continue; }
    }
    el.innerHTML = window.nodoRetiroHistoriaPintar(prog, sid, el.getAttribute('data-hist'));
  }
};
window.nodoRetiroHistoriaPintar = function(p, sid, histId){
  const j = function(v){ if(typeof v === 'string'){ try{ return JSON.parse(v); }catch(_e){ return null; } } return v; };
  let pagos = j(p.pagos); if(!Array.isArray(pagos)) pagos = [];
  const cierre = j(p.cierre), ajuste = j(p.ajuste);
  const total = Number(p.total)||0, pagado = Number(p.pagado)||0, resta = Math.max(0, total - pagado);
  if(!pagos.length && !cierre && !ajuste) return '';
  const fF = (typeof formatFecha === 'function') ? formatFecha : function(x){ return String(x||''); };
  // Qué pago es ESTA fila del historial: mismo monto y a menos de 3 minutos.
  // OJO con el "||": una lista VACÍA es verdadera en JS, así que ganaba la vacía y nunca se usaba
  // el respaldo. Se mira la cantidad, igual que en _parteRetiro.
  const H = (typeof _historialData !== 'undefined' && _historialData && _historialData.length)
    ? _historialData : (window._historialData || []);
  const hRow = histId ? H.find(function(h){ return String(h.id) === String(histId); }) : null;
  const esEste = function(x){
    if(!hRow) return false;
    return Number(x.monto) === Number(hRow.monto) && Math.abs(new Date(x.fecha) - new Date(hRow.created_at)) < 180000;
  };
  let h = '<div style="border-radius:10px;padding:10px 12px;background:rgba(168,85,247,.07);border:1px solid rgba(192,132,252,.35);font-size:12.5px;color:#e6edf3">'
    + '<div style="font-weight:900;color:#c084fc;margin-bottom:5px">💸 Retiro #'+escapeHtml(String(sid))+(pagos.length > 1 || cierre ? ' · pagado por partes' : '')+'</div>';
  if(ajuste && ajuste.declarado != null){
    h += '<div>Pidió <b>'+money(Number(ajuste.declarado)||0)+'</b> → se paga <b style="color:#f5c518">'+money(Number(ajuste.corregido)||total)+'</b></div>';
    if(ajuste.motivo) h += '<div style="color:#fde68a">📝 '+escapeHtml(ajuste.motivo)+'</div>';
  }
  // El "pagado X de Y · falta Z" sale SÓLO si hay pagos anotados. Sin pagos por partes, ese contador
  // está en cero aunque la plata haya salido entera, y decía "falta $67.208" de un retiro ya pagado.
  if(pagos.length){
    h += '<div style="margin-top:4px;color:#8b949e">Pagado <b style="color:#e6edf3">'+money(pagado)+'</b> de <b style="color:#e6edf3">'+money(total)+'</b>'
      + (resta > 0.5 ? (' · falta <b style="color:#f5c518">'+money(resta)+'</b>') : ' · completo')+'</div>';
  }
  // Cada pago con SU movimiento de Chunior y SUS fichas: un retiro en partes tiene un movimiento
  // por pago y la ficha tenía un solo casillero, así que no entraba ninguno (Juan, 13/09).
  const delaSolicitud = H.filter(function(r){
    return String(r.solicitud_id || '') === String(sid) && String(r.tipo || '').toUpperCase() === 'RETIRO'
      && Number(r.monto || 0) > 0 && String(r.estado || '').toUpperCase() !== 'ERROR';
  }).sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });
  const usadas = {};
  const filaDelPago = function(x, i){
    for(let k = 0; k < delaSolicitud.length; k++){
      if(usadas[k]) continue;
      const r = delaSolicitud[k];
      if(Number(r.monto) === Number(x.monto) && Math.abs(new Date(x.fecha) - new Date(r.created_at)) < 180000){ usadas[k] = true; return r; }
    }
    const porOrden = delaSolicitud[i];
    if(porOrden && !usadas[i] && Number(porOrden.monto) === Number(x.monto)){ usadas[i] = true; return porOrden; }
    return null;
  };
  let acum = 0, faltanMovs = 0;
  pagos.forEach(function(x, i){
    const monto = Number(x.monto) || 0;
    const desdePct = total > 0 ? Math.round(acum * 100 / total) : 0;
    acum += monto;
    const hastaPct = total > 0 ? Math.min(100, Math.round(acum * 100 / total)) : 0;
    const fila = filaDelPago(x, i);
    const este = esEste(x);
    const mov = (fila && fila.chunior_movimiento_id) ? String(fila.chunior_movimiento_id) : '';
    if(!mov) faltanMovs++;
    const fichas = (fila && (fila.saldo_pre != null || fila.saldo_post != null))
      ? ('🎰 ' + (fila.saldo_pre != null ? money(fila.saldo_pre) : '—') + ' → ' + (fila.saldo_post != null ? money(fila.saldo_post) : '—'))
      : '';
    const botonMov = mov
      ? '<b class="mono" style="color:#86efac">N° ' + escapeHtml(mov) + '</b>'
        + ' <button type="button" class="mini-btn" style="font-size:10px;padding:2px 6px" onclick="expedienteCopiarTexto(\'' + escapeHtml(mov) + '\')">Copiar</button>'
      : (fila
          ? '<span style="color:#f59e0b">sin N°</span>'
            + ' <button type="button" class="mini-btn yellow" style="font-size:10px;padding:2px 6px" title="Busca en Chunior el movimiento de ESTE pago y lo guarda"'
            + ' onclick="expedienteBuscarMovChunior(\'' + escapeHtml(String(fila.id)) + '\',\'' + escapeHtml(String(fila.usuario || '')) + '\',\'' + monto + '\',\'' + escapeHtml(String(fila.created_at || x.fecha || '')) + '\')">🔎 Buscar en Chunior</button>'
          : '<span style="color:#8b949e">sin operación registrada</span>');
    h += '<div style="margin-top:4px;padding:5px 8px;border-radius:7px;background:' + (este ? 'rgba(245,197,24,.10)' : '#0d1117') + ';border:1px solid ' + (este ? 'rgba(245,197,24,.4)' : '#21262d') + '">'
      + '<div style="display:flex;justify-content:space-between;gap:8px">'
      +   '<span><b style="color:#c084fc">' + desdePct + '–' + hastaPct + '%</b> · <b style="color:#fb923c">' + money(monto) + '</b>'
      +     (x.desde ? (' · desde ' + escapeHtml(x.desde)) : '') + (x.operador ? (' · ' + escapeHtml(x.operador)) : '')
      +     (este ? ' <span style="color:#f5c518;font-size:10.5px">(este)</span>' : '') + '</span>'
      +   '<span style="color:#8b949e;white-space:nowrap">' + escapeHtml(fF(x.fecha)) + '</span>'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;margin-top:2px">'
      +   '<span>' + botonMov + '</span>'
      +   '<span style="color:#8b949e;white-space:nowrap">' + fichas + '</span>'
      + '</div></div>';
  });
  if(faltanMovs) h += '<div style="margin-top:4px;font-size:11.5px;color:#f59e0b">⚠ ' + faltanMovs + ' pago' + (faltanMovs === 1 ? '' : 's') + ' sin N° de Chunior.</div>';
  if(cierre){
    h += '<div style="margin-top:6px;padding:6px 8px;border-radius:7px;background:rgba(124,58,237,.12);border:1px solid #7c3aed55">'
      + '🔒 <b>Cerrado</b>'+(cierre.etiqueta ? (': '+escapeHtml(cierre.etiqueta)) : '')
      + (Number(cierre.faltante) > 0.5 ? (' · quedó sin pagar <b>'+money(Number(cierre.faltante))+'</b>') : '')
      + (cierre.nota ? ('<div style="font-style:italic;color:#c9d1d9;margin-top:2px">"'+escapeHtml(cierre.nota)+'"</div>') : '')
      + '<div style="color:#8b949e;font-size:11px;margin-top:2px">'+escapeHtml([cierre.operador, cierre.fecha ? fF(cierre.fecha) : ''].filter(Boolean).join(' · '))+'</div>'
      + '</div>';
  }
  return h + '</div>';
};
// Cierra un retiro parcial. Antes era un confirm() y listo: la operación quedaba PAGADA con
// plata sin pagar y NADIE sabía por qué. En el caso que disparó esto: 50% pagado, $25.000 sin
// pagar, estado PAGADA, cero explicación ni acá ni en el portal.
// Ahora la nota es obligatoria y viaja al portal, así el cliente deja de ver "faltan $25.000"
// para siempre. La lista de motivos es un punto de partida: son los que aparecen en la
// operación, y quedan para ajustar.
window._MOTIVOS_CIERRE_PARCIAL = [
  { k:'COBRO_TODO',       t:'Ya cobró el total (el último pago no lo marcó)' },
  { k:'SIN_FICHAS',       t:'No tenía las fichas al reintentar' },
  { k:'SE_LO_JUGO',       t:'Se jugó el saldo antes de terminar de cobrar' },
  { k:'CLIENTE_DESISTIO', t:'El cliente no quiso el resto' },
  { k:'MONTO_MAL',        t:'El monto estaba mal cargado' },
  { k:'OTRO',             t:'Otro (explicar abajo)' }
];

// ── Cierre automático: el jugador volvió a cargar con el retiro a medio pagar ────────────────
// Decisión de Juan (26/9): se cierra SOLO, sin confirmar. El caso: Maria6981x se jugó las fichas
// del retiro, volvió a cargar, y el parcial siguió pidiendo una plata que ya no correspondía.
// Esto NO mueve plata: cierra la solicitud y anota por qué. Lo pagado queda pagado.
// El operador se entera igual — el aviso es a propósito bien visible.
window._parcialesCerradosAuto = window._parcialesCerradosAuto || new Set();
window._cerrandoParcialesAuto = false;
window.cerrarParcialesPorCarga = async function(){
  // Al final recarga, y la recarga vuelve a llamar acá. El Set ya corta el reproceso, pero esto
  // lo deja explícito: una sola pasada por vez.
  if(window._cerrandoParcialesAuto) return 0;
  window._cerrandoParcialesAuto = true;
  try{
    if(!window.NodoDomain || !NodoDomain.parciales) return 0;
    const casos = NodoDomain.parciales.aCerrarPorCarga({
      solicitudes: (window.V154P && window.V154P.solicitudes) || [],
      info: window._retiroParcialInfo,
      cerrado: window._retiroCerradoAMano,
      yaVistos: window._parcialesCerradosAuto
    });
    let hechos = 0;
    for(const caso of casos){
      // Se marca ANTES de escribir: si la escritura falla, no se reintenta en cada refresco.
      window._parcialesCerradosAuto.add(caso.id);
      const nota = NodoDomain.parciales.notaCierre(caso, money);
      let rpPrevio = {};
      try{
        let m = (caso.solicitud && (caso.solicitud.METADATA!==undefined ? caso.solicitud.METADATA : caso.solicitud.metadata)) || {};
        if(typeof m === "string"){ try{ m = JSON.parse(m); }catch(_e){ m = {}; } }
        rpPrevio = (m && m.retiro_parcial) || {};
      }catch(_e){}
      const cierre = {
        motivo: caso.motivo, etiqueta: caso.etiqueta, nota: nota,
        operador: "automático", fecha: new Date().toISOString(),
        pagado: caso.pagado, total: caso.total, faltante: caso.restante,
        carga_id: caso.cargaId, carga_monto: caso.cargaMonto
      };
      try{
        await window.actualizarSolicitudPortal(String(caso.id), "PAGADA", {
          etapa: "RETIRO_CIERRE_AUTO",
          // Misma llave que el cierre a mano: definitivo, no lo pisa un pago posterior.
          cierre_manual: { fecha: cierre.fecha, operador: "automático", motivo: caso.motivo, auto: true },
          cierre_motivo: caso.motivo,
          cierre_nota: nota,
          retiro_parcial: Object.assign({}, rpPrevio, { cierre: cierre })
        });
        hechos++;
        try{
          await registrarEnHistorial({
            usuario: String((caso.solicitud && (caso.solicitud.USUARIO || caso.solicitud.USUARIO_JUGADOR)) || ""),
            tipo: "RETIRO", monto: 0, origen: "CIERRE", estado: "OK", solicitud_id: String(caso.id),
            notas: "Cierre automático de retiro parcial · " + caso.etiqueta + " · " + nota
          });
        }catch(_e){}
        // Que NO pase desapercibido: es una solicitud que se cerró sin que nadie la toque.
        try{ toast("💸 Retiro #"+caso.id+" cerrado solo · "+caso.etiqueta+" · quedaron sin pagar "+money(caso.restante), "yellow"); }catch(_e){}
      }catch(e){
        try{ toast("No se pudo cerrar solo el retiro #"+caso.id+": "+(e.message||e), "red"); }catch(_e){}
      }
    }
    // Se repinta con lo que ya está en memoria: recargar acá volvería a entrar por el mismo camino.
    if(hechos){ try{ if(typeof cargarSolicitudesPortal==="function") await cargarSolicitudesPortal(true); }catch(_e){} }
    return hechos;
  }catch(_e){ return 0; }
  finally{ window._cerrandoParcialesAuto = false; }
};
window.cerrarRetiroSaldado = async function(id){
  const s = (window._parcialesEnProceso||[]).find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
  const pp = (s && window._retiroParcialInfo) ? window._retiroParcialInfo(s) : null;
  const faltante = pp ? Math.max(0, pp.restante) : 0;
  const quedaPlata = faltante > 0.5;

  const opciones = window._MOTIVOS_CIERRE_PARCIAL
    .filter(function(m){ return quedaPlata ? m.k !== 'COBRO_TODO' : true; })
    .map(function(m){ return '<option value="'+m.k+'">'+escapeHtml(m.t)+'</option>'; }).join('');

  abrirModal('✔ Cerrar el retiro #'+id,
    (pp
      ? '<div style="padding:8px 10px;border-radius:8px;margin-bottom:10px;'
        + (quedaPlata
            ? 'background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.4);color:#fde68a">'
              + '⚠ Cobró <b>'+money(pp.pagado)+'</b> de <b>'+money(pp.total)+'</b>. '
              + 'Queda sin pagar <b>'+money(faltante)+'</b>.'
            : 'background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.4);color:#bbf7d0">'
              + 'Cobró el total: <b>'+money(pp.pagado)+'</b>.')
        + '</div>'
      : '')
    + '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Esto <b>no</b> transfiere ni retira nada: cierra la solicitud. '
    + 'Lo que anotes lo ve el jugador en el portal.</div>'
    + '<label>¿Qué pasó?</label>'
    + '<select id="cierreParcialMotivo">'+opciones+'</select>'
    + '<label style="margin-top:8px">Nota <span class="small" style="color:#8b949e;font-weight:400">· obligatoria</span></label>'
    + '<textarea id="cierreParcialNota" rows="3" placeholder="Qué pasó, en una línea. Lo lee el jugador."'
    + ' style="width:100%;border-radius:10px;padding:10px;background:#0e1525;color:#fff;border:1px solid #2d3342;resize:vertical"></textarea>',
    async function(){
      const motivo = String((document.getElementById('cierreParcialMotivo')||{}).value || '').trim();
      const nota   = String((document.getElementById('cierreParcialNota')||{}).value || '').trim();
      // Sin chance de cerrar sin anotar: es el único registro de por qué quedó a medias.
      if(nota.length < 8){ toast('Escribí qué pasó (al menos una línea). Es lo único que queda registrado.','red'); return; }

      const etiqueta = (window._MOTIVOS_CIERRE_PARCIAL.find(function(m){ return m.k===motivo; })||{}).t || motivo;
      const opNombre = (window.operador && (window.operador.usuario||window.operador.nombre)) || 'panel';

      // p_metadata hace merge SHALLOW: si mandamos retiro_parcial suelto pisamos pagos y pagado.
      // Se arma el objeto completo con lo que ya estaba + el cierre.
      let rpPrevio = {};
      try{
        let m = (s && (s.METADATA!==undefined ? s.METADATA : s.metadata)) || {};
        if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ m = {}; } }
        rpPrevio = (m && m.retiro_parcial) || {};
      }catch(_e){}

      const cierre = {
        motivo: motivo, etiqueta: etiqueta, nota: nota,
        operador: opNombre, fecha: new Date().toISOString(),
        pagado: pp ? pp.pagado : null, total: pp ? pp.total : null, faltante: faltante
      };

      try{
        await window.actualizarSolicitudPortal(String(id), 'PAGADA', {
          etapa:'RETIRO_CIERRE_MANUAL',
          // Llave propia: `etapa` la pisa cada pago parcial y el cierre se perdía. Esto no lo
          // escribe ningún otro camino, así que el cierre a mano queda firme.
          cierre_manual: { fecha: new Date().toISOString(), operador: opNombre, motivo: motivo },
          operador: opNombre,
          cierre_motivo: motivo,
          cierre_nota: nota,
          retiro_parcial: Object.assign({}, rpPrevio, { cierre: cierre })
        });
        try{ cerrarModal(); }catch(_e){}
        toast('✔ Retiro #'+id+' cerrado · '+etiqueta,'green');
        // El motivo también queda del lado nuestro, no sólo en la solicitud del portal.
        try{
          await registrarEnHistorial({
            usuario: String((s && (s.USUARIO||s.USUARIO_JUGADOR)) || ''),
            // origen CIERRE: no es un retiro, es una decisión administrativa. Así la lista de
            // retiros de 24hs puede dejarlo afuera sin adivinar por el monto.
            tipo:'RETIRO', monto: 0, origen:'CIERRE', estado:'OK', solicitud_id:String(id),
            notas:'Cierre de retiro parcial · '+etiqueta+' · '+nota
                  + (quedaPlata ? (' · quedó sin pagar '+money(faltante)) : '')
          });
        }catch(_e){}
        try{ await cargarSolicitudesPortal(true); }catch(_e){}
      }catch(e){ toast('No se pudo cerrar: '+(e.message||e),'red'); }
    }, 'Cerrar retiro');
};
// Copiar CBU/alias al portapapeles (usado por el detalle del árbol).
// Copiar el CBU/alias. El bug que tenía: navigator.clipboard.writeText() falla en Electron sobre
// file:// (no es contexto seguro), el .catch() se comía el error EN SILENCIO, y aun así pintaba
// el ✅ y toasteaba "Copiado". El operador pegaba y no había nada — o peor, quedaba lo anterior
// del portapapeles, que puede ser el alias de OTRO retiro. Ahora: si el modo moderno falla, cae
// al textarea + execCommand, y sólo se canta "copiado" cuando de verdad se copió.
function portalCopiarCbu(btn){
  const val = (btn && btn.getAttribute('data-valor')) || '';
  if(!val){ if(typeof toast==='function') toast('No hay alias/CBU para copiar','red'); return; }
  const ok = function(){
    try{
      const ico = btn.querySelector('.pcopy-ico');
      if(ico){ const prev=ico.textContent; ico.textContent='✅'; setTimeout(function(){ ico.textContent=prev; }, 1200); }
    }catch(_e){}
    if(typeof toast==='function') toast('Copiado: '+val,'green');
  };
  const fallo = function(){
    // El alias va en el aviso: si no se pudo copiar, al menos se puede leer y tipear.
    if(typeof toast==='function') toast('No se pudo copiar — copialo a mano: '+val,'red');
  };
  const porTextarea = function(){
    try{
      const ta=document.createElement('textarea');
      ta.value=val;
      // Fuera de pantalla pero SELECCIONABLE: un textarea display:none no se puede copiar.
      ta.setAttribute('readonly','');
      ta.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select(); ta.setSelectionRange(0, val.length);
      let r=false; try{ r=document.execCommand('copy'); }catch(_e){}
      document.body.removeChild(ta);
      r ? ok() : fallo();
    }catch(_e){ fallo(); }
  };
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(val).then(ok).catch(porTextarea);
    } else porTextarea();
  }catch(_e){ porTextarea(); }
}

// Copiar de verdad, aunque el panel esté operando.
// Dos cosas lo rompían. Una: navigator.clipboard.writeText() EXIGE que la ventana tenga el foco,
// y mientras el panel opera abre y enfoca la ventana del backoffice o la de Chunior
// (main/agent-ipc.js hace show()+focus()), así que el portapapeles rechaza la escritura — de ahí
// que "mientras hace algo no te deja copiar el enlace". La otra: el respaldo del enlace de acceso
// era prompt(), que en Electron NO existe (ya está dicho en conciliacion.js:697): fallaba el
// primero, el segundo no hacía nada, y el operador se quedaba sin el enlace y sin aviso.
// Orden: recuperar el foco → portapapeles → textarea+execCommand → mostrarlo para copiar a mano.
// Nunca prompt(), y nunca cantar "copiado" sin haber copiado.
window.nodoCopiar = async function(texto, opciones){
  const txt = String(texto == null ? '' : texto);
  const etiqueta = (opciones && opciones.etiqueta) || 'Copiado';
  if(!txt){ try{ toast('No hay nada para copiar','yellow'); }catch(_e){} return false; }

  // 1) El foco vuelve al panel. Sin esto el portapapeles rechaza mientras opera el backoffice.
  try{
    if(window.ctrlElectron && window.ctrlElectron.refocus) await window.ctrlElectron.refocus();
  }catch(_e){}

  // 2) Camino moderno.
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(txt);
      try{ toast(etiqueta,'green'); }catch(_e){}
      return true;
    }
  }catch(_e){}

  // 3) Respaldo clásico: fuera de pantalla pero SELECCIONABLE (un display:none no se copia).
  try{
    const ta = document.createElement('textarea');
    ta.value = txt; ta.setAttribute('readonly','');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try{ ta.setSelectionRange(0, txt.length); }catch(_e){}
    let copiado = false; try{ copiado = document.execCommand('copy'); }catch(_e){}
    try{ ta.remove(); }catch(_e){}
    if(copiado){ try{ toast(etiqueta,'green'); }catch(_e){} return true; }
  }catch(_e){}

  // 4) Último recurso: mostrarlo. Poder seleccionarlo a mano es mucho mejor que perderlo.
  try{
    abrirModal('📋 Copialo a mano',
      '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">No se pudo copiar solo — pasa '
      + 'cuando el panel está operando en otra ventana. Seleccionalo y copialo:</div>'
      + '<textarea readonly onclick="this.select()" style="width:100%;min-height:120px;border-radius:10px;'
      + 'padding:10px;background:#0e1525;color:#fff;border:1px solid #2d3342;resize:vertical;'
      + 'font-family:ui-monospace,monospace;font-size:12px">' + escapeHtml(txt) + '</textarea>',
      null, '');
  }catch(_e){
    try{ toast('No se pudo copiar — copialo a mano: '+txt,'red'); }catch(_x){}
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════
// COLA DE PENDIENTES (portado de NexoBetaChan 1.0.82) — una carga que quedó incierta
// (timeout/error) NO se pierde en un toast: queda en una tarjeta arriba de las solicitudes,
// sobrevive reinicios (localStorage), con Ver saldo / Descartar / Reintentar.
// ══════════════════════════════════════════════════════════════════════════
(function(){
  const COLA_PEND_KEY = 'nodo_cola_pendientes_v1';
  function colaPendientesAll(){ try{ return JSON.parse(localStorage.getItem(COLA_PEND_KEY)||'[]')||[]; }catch(_e){ return []; } }
  function colaPendientesSave(items){ try{ localStorage.setItem(COLA_PEND_KEY, JSON.stringify((items||[]).slice(0,60))); }catch(_e){} }
  window.colaPendientesAdd = function colaPendientesAdd(item){
    try{
      const items = colaPendientesAll();
      item.qid = 'q'+Date.now()+Math.random().toString(16).slice(2,6);
      item.creado = new Date().toISOString(); item.intentos = 0;
      items.unshift(item); colaPendientesSave(items); renderColaPendientes();
      toast('⏳ Quedó en la cola de pendientes: '+money(item.monto)+' a '+item.usuario, 'yellow');
    }catch(e){ console.warn('[cola]', e); }
  };
  function colaPendientesRemove(qid){ colaPendientesSave(colaPendientesAll().filter(function(x){ return x.qid !== qid; })); renderColaPendientes(); }
  function colaPendientesGet(qid){ return colaPendientesAll().find(function(x){ return x.qid === qid; }) || null; }
  function colaPendientesPatch(qid, patch){ const items=colaPendientesAll(); const it=items.find(function(x){ return x.qid===qid; }); if(it){ Object.assign(it, patch); colaPendientesSave(items); } renderColaPendientes(); }
  function colaEnsureBox(){
    let box = document.getElementById('colaPendientesBox'); if(box) return box;
    const anchor = document.getElementById('tablaSolicitudesInicio'); if(!anchor || !anchor.parentElement) return null;
    box = document.createElement('div'); box.id='colaPendientesBox'; box.style.cssText='margin-bottom:10px';
    anchor.parentElement.insertBefore(box, anchor); return box;
  }
  window.renderColaPendientes = function renderColaPendientes(){
    const box = colaEnsureBox(); if(!box) return;
    const items = colaPendientesAll();
    if(!items.length){ box.innerHTML=''; box.style.display='none'; return; }
    box.style.display='block';
    const filas = items.map(function(it){
      const esBono = it.clase === 'BONO';
      const badge = esBono
        ? '<span style="background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.35);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:900">🎁 BONO '+(it.bonoPct||'')+'%</span>'
        : '<span style="background:rgba(245,197,24,.12);color:#f5c518;border:1px solid rgba(245,197,24,.35);border-radius:999px;padding:2px 9px;font-size:10px;font-weight:900">CARGA</span>';
      const aviso = it.posibleAplicada ? '<div style="margin-top:5px;font-size:11px;font-weight:800;color:#fbbf24">⚠ Pudo haberse aplicado (cortó por timeout) — usá "Ver saldo" antes de reintentar</div>' : '';
      const saldoLeido = (it.saldoLeido!==undefined && it.saldoLeido!==null) ? '<div style="margin-top:4px;font-size:11px;color:#7cc4ff">Saldo actual leído: <b>'+esc(String(it.saldoLeido))+'</b> ('+esc(it.saldoLeidoHora||'')+')</div>' : '';
      return '<div style="background:#161b22;border:1px solid #30363d;border-left:3px solid #f5c518;border-radius:10px;padding:10px 12px;margin-top:8px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'
        +   '<div style="display:flex;align-items:center;gap:8px">'+badge+'<b style="font-size:15px;color:#f0f6fc">'+esc(it.usuario||'—')+'</b><b style="font-size:16px;color:#f5c518">'+money(it.monto||0)+'</b></div>'
        +   '<span style="font-size:11px;color:#8b949e">'+fecha(it.creado)+(it.intentos?(' · '+it.intentos+' reintento/s'):'')+'</span>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;margin-top:6px;font-size:12px;color:#c9d1d9">'
        +   (it.titular ? '<div><span style="color:#8b949e">A nombre de:</span> <b>'+esc(it.titular)+'</b></div>' : '')
        +   (esBono && it.baseMonto ? '<div><span style="color:#8b949e">Sobre carga de:</span> '+money(it.baseMonto)+'</div>'
               : (it.declarado ? '<div><span style="color:#8b949e">Declaró:</span> '+money(it.declarado)+'</div>' : ''))
        +   (it.destino ? '<div style="grid-column:1/-1"><span style="color:#8b949e">Destino:</span> '+esc(it.destino)+'</div>' : '')
        +   (it.cbu ? '<div style="grid-column:1/-1"><span style="color:#8b949e">CBU/CVU:</span> '+esc(it.cbu)+'</div>' : '')
        +   (it.obs ? '<div style="grid-column:1/-1"><span style="color:#8b949e">Obs:</span> '+esc(it.obs)+'</div>' : '')
        +   (it.solicitudId ? '<div><span style="color:#8b949e">Solicitud:</span> #'+esc(String(it.solicitudId))+'</div>' : '')
        +   (it.billeteraNombre ? '<div><span style="color:#8b949e">Billetera:</span> '+esc(it.billeteraNombre)+'</div>' : '')
        + '</div>'
        + '<div style="margin-top:5px;font-size:11px;color:#fca5a5">Falló: '+esc(it.motivo||'sin detalle')+'</div>'
        + aviso + saldoLeido
        + '<div style="display:flex;gap:7px;justify-content:flex-end;margin-top:8px">'
        +   '<button class="mini-btn" style="background:transparent;border:1px solid #30363d;color:#c9d1d9;font-size:11px" onclick="verSaldoPendienteCola(\''+it.qid+'\')">👁 Ver saldo</button>'
        +   '<button class="mini-btn" style="background:transparent;border:1px solid #7f1d1d;color:#fca5a5;font-size:11px" onclick="descartarPendienteCola(\''+it.qid+'\', this)">Descartar</button>'
        +   '<button class="mini-btn" style="background:#b45309;color:#fff;font-weight:800;font-size:11px" onclick="reintentarPendienteCola(\''+it.qid+'\')">↻ Reintentar</button>'
        + '</div></div>';
    }).join('');
    box.innerHTML = '<div style="background:#0d1117;border:1px solid rgba(245,197,24,.35);border-radius:12px;padding:11px 13px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center"><b style="color:#f5c518;font-size:13px">⏳ Cargas pendientes de reintento ('+items.length+')</b><span style="font-size:11px;color:#8b949e">quedan guardadas aunque se reinicie el panel</span></div>'
      + filas + '</div>';
  };
  window.descartarPendienteCola = function(qid, btn){
    if(btn && btn.dataset.armado === '1'){ colaPendientesRemove(qid); toast('Pendiente descartado', 'yellow'); return; }
    if(btn){ btn.dataset.armado='1'; btn.textContent='¿Seguro?'; btn.style.background='#7f1d1d'; btn.style.color='#fff';
      setTimeout(function(){ try{ btn.dataset.armado=''; btn.textContent='Descartar'; btn.style.background='transparent'; btn.style.color='#fca5a5'; }catch(_e){} }, 3000); }
  };
  window.verSaldoPendienteCola = async function(qid){
    const it = colaPendientesGet(qid); if(!it) return;
    if(!_drexGlobalLock('cola-saldo')){ toast('Hay otra operación en curso en Agentes. Esperá.', 'yellow'); return; }
    _wdLock();
    try{
      toast('Leyendo saldo de '+it.usuario+'...', 'blue');
      const b = await callDrex('buscarUsuario', it.usuario, { skipBalance:false });
      if(b && b.exists && b.balance && b.balance.raw){
        colaPendientesPatch(qid, { saldoLeido: b.balance.raw.trim(), saldoLeidoHora: new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}) });
        toast('Saldo de '+it.usuario+': '+b.balance.raw.trim(), 'blue');
      } else { toast('No se pudo leer el saldo'+(b&&b.needsLogin?' (sesión caída)':''), 'red'); }
    }catch(e){ toast('Error leyendo saldo: '+(e.message||''), 'red'); }
    finally{ _wdUnlock(); _drexGlobalUnlock(); }
  };
  // Reintentar SEGURO (nuestro): en vez de re-ejecutar la carga a ciegas, PRECARGA el formulario
  // de "Operación manual" (usuario + monto) y hace scroll → el operador revisa y toca "Ejecutar"
  // (que ya maneja billetera/Chunior/historial). Evita el riesgo de un auto-reintento money-op.
  window.reintentarPendienteCola = function(qid){
    const it = colaPendientesGet(qid); if(!it) return;
    try{
      const u = document.getElementById('manualUsuario'); if(u) u.value = it.usuario||'';
      const m = document.getElementById('manualMonto');   if(m) m.value = String(it.monto||'');
      if(u){ u.scrollIntoView({behavior:'smooth', block:'center'}); u.focus(); }
      toast('↻ Cargué '+it.usuario+' · '+money(it.monto)+' en la operación manual. Revisá y tocá Ejecutar.', 'blue');
    }catch(e){ toast('No pude precargar: '+(e.message||''), 'red'); }
  };
  setTimeout(function(){ try{ renderColaPendientes(); }catch(_e){} }, 3500); // pendientes de una sesión anterior
})();

// ── Ledger de billeteras: saldo ESPERADO por operaciones vs REAL de Chunior ─────────────
// Cada operación (carga +, retiro/parcial -) que pasa por registrarEnHistorial suma/resta al "ops"
// de su billetera. Al sincronizar con Chunior comparamos esperado(base+ops) vs real → si difieren,
// aviso LEVE (ej: una carga que no se anotó en Chunior) + se re-basa al valor real. Todo LOCAL.
const BIL_LEDGER_KEY = 'nodo_bil_ledger_v1';
const _BIL_DIF_UMBRAL = 1; // pesos
function _bilLedgerAll(){ try{ return JSON.parse(localStorage.getItem(BIL_LEDGER_KEY)||'{}')||{}; }catch(_e){ return {}; } }
function _bilLedgerSave(m){ try{ localStorage.setItem(BIL_LEDGER_KEY, JSON.stringify(m)); }catch(_e){} }
function _bilLedgerAdd(bilId, tipo, monto, estado){
  // ⛔ CONTADOR INTERNO DESACTIVADO: este ledger (base+ops del panel) era el "tercer contador".
  // Solo intervienen CHUNIOR (lo anotado) y el SALDO REAL del banco (lo declarado en el Cotejo).
  // El operador tiene la obligación del 1 a 1 entre lo anotado y la billetera → el cotejo es la
  // herramienta para verificarlo, no un acumulador paralelo que se desincronizaba y avisaba al pedo.
  return;
}
window._bilLedgerAdd = _bilLedgerAdd;
// Compara esperado vs real (llamar DESPUÉS de sincronizar Chunior, con billeteras[].SALDO ya real)
// y avisa las diferencias. Re-basa el ledger al valor real actual. Devuelve la lista de diferencias.
window._chequearDiferenciasBilletera = function(){
  // ⛔ DESACTIVADO junto con el ledger: comparaba el acumulado del panel contra Chunior y tiraba
  // "⚠ dif" en la tarjeta + toast, con falsos constantes. La comparación válida es banco vs Chunior
  // y la hace el módulo de COTEJO (declaración ciega). Se limpia el ledger viejo de localStorage.
  try{ localStorage.removeItem(BIL_LEDGER_KEY); }catch(_e){}
  window.__bilDifs = [];
  return [];
};
// ── Atribución por turno (portado del colega, v1.1.39) ───────────────────────
// Toma el operador REALMENTE logueado en Chunior (#user-tools strong) y actualiza operador.usuario
// antes de cada registro + cada 90s → cubre el cambio de turno sin re-login del panel. NO fabrica
// un operador si no hay (respeta el gating de login/multi-oficina) y NO toca pc/rol/scope (eso lo
// define el login del panel, atado a la PC física). Guard de 20s para no golpear Chunior de más.
let _operadorChuniorTs = 0;
async function refrescarOperadorDesdeChunior(force){
  try{
    if(!force && (Date.now() - _operadorChuniorTs) < 20000) return (typeof operador!=='undefined' && operador && operador.usuario) || null;
    if(!window.chunior || !window.chunior.exec) return (typeof operador!=='undefined' && operador && operador.usuario) || null;
    const u = await window.chunior.exec('(function(){var e=document.querySelector("#user-tools strong");return e?(e.textContent||"").trim():"";})()');
    _operadorChuniorTs = Date.now();
    const nombre = String(u||'').trim();
    // Solo actualizamos el NOMBRE si ya hay un operador logueado (no fabricamos uno).
    if(nombre && typeof operador!=='undefined' && operador && String(operador.usuario||'').toLowerCase() !== nombre.toLowerCase()){
      console.log('[operador] cambió de puesto en Chunior:', operador.usuario, '→', nombre);
      operador.usuario = nombre; operador.nombre = nombre;
    }
    // El espejo va AFUERA del if. Estaba adentro, así que window.operador solo se llenaba
    // cuando el nombre de Chunior difería del del panel — o sea, únicamente en un cambio de
    // turno. En el caso normal los nombres coinciden, el if no entra y window.operador quedaba
    // sin definir toda la sesión.
    try{ if(typeof operador!=='undefined' && operador) window.operador = operador; }catch(_e){}
    return (typeof operador!=='undefined' && operador && operador.usuario) || nombre || null;
  }catch(_e){ return (typeof operador!=='undefined' && operador && operador.usuario) || null; }
}
window.refrescarOperadorDesdeChunior = refrescarOperadorDesdeChunior;
// Refresco periódico: cubre el cambio de turno aunque no se opere (Chunior ya se re-logueó).
try{ setInterval(function(){ refrescarOperadorDesdeChunior(true); }, 90000); }catch(_e){}

async function registrarEnHistorial(op){
  // Antes de estampar, aseguramos que el operador sea el que está en Chunior AHORA (cambio de turno).
  try{ await refrescarOperadorDesdeChunior(); }catch(_e){}
  const {
    usuario, tipo, monto=0, billetera_id=null, billetera_nombre=null,
    origen='MANUAL', estado='OK', notas=null, solicitud_id=null,
    reversion_de=null, chunior_movimiento_id=null,
    saldo_post=null, saldo_pre=null, created_at=null, pc_codigo:pc_override=null
  } = op || {};

  const baseRow = {
    usuario, tipo, monto, billetera_id, billetera_nombre,
    operador: operador?.usuario || operador?.nombre || "",
    origen: window._v154pPortalJobActivo ? "PORTAL" : origen,
    estado,
    notas: window._v154pPortalJobActivo ? ((notas?notas+" · ":"") + "Solicitud portal #" + window._v154pPortalJobActivo) : notas,
    solicitud_id: window._v154pPortalJobActivo || solicitud_id,
    reversion_de,
    chunior_movimiento_id,
    saldo_post,
    saldo_pre,
    pc_codigo: pc_override || pcOperativa
  };
  if(created_at) baseRow.created_at = created_at;

  // Quitar undefined para no ensuciar Supabase.
  Object.keys(baseRow).forEach(k => { if(baseRow[k] === undefined) delete baseRow[k]; });

  // Intento 1: completo, quitando columnas ya detectadas como inexistentes.
  let intento = { ...baseRow };
  _HISTORIAL_COLS_INEXISTENTES.forEach(c => delete intento[c]);

  for(let i = 0; i <= _HISTORIAL_COLS_OPCIONALES.length; i++){
    try{
      const { data, error } = await supabaseClient
        .from("historial_ops")
        .insert(intento)
        .select()
        .single();

      if(!error){ try{ _capturarMovimientoDesdeHistorial(baseRow, data); }catch(_e){} try{ _bilLedgerAdd(baseRow.billetera_id, baseRow.tipo, baseRow.monto, baseRow.estado); }catch(_e){} return data; }

      const msg = (error.message || "") + " " + (error.details || "") + " " + (error.hint || "");
      const colMencionada = _HISTORIAL_COLS_OPCIONALES.find(c => msg.includes(c) && (c in intento));

      if(colMencionada){
        console.warn('historial_ops: columna "'+colMencionada+'" no disponible en schema/cache → reintento sin esa columna');
        _HISTORIAL_COLS_INEXISTENTES.add(colMencionada);
        delete intento[colMencionada];
        continue;
      }

      console.warn("historial_ops insert completo falló:", error);
      break;
    }catch(e){
      console.warn("historial_ops write failed:", e);
      break;
    }
  }

  // Fallback FINAL: fila mínima con columnas históricas.
  // Esto evita que una solicitud portal quede ACREDITADA sin historial_id.
  try{
    const minimo = {
      usuario, tipo, monto,
      origen: window._v154pPortalJobActivo ? "PORTAL" : origen,
      estado,
      operador: operador?.usuario || operador?.nombre || "",
      notas: window._v154pPortalJobActivo ? ((notas?notas+" · ":"") + "Solicitud portal #" + window._v154pPortalJobActivo) : notas,
      pc_codigo: pc_override || pcOperativa,
      billetera_id,
      billetera_nombre,
      solicitud_id: window._v154pPortalJobActivo || solicitud_id,
      saldo_post,
      saldo_pre
    };
    if(created_at) minimo.created_at = created_at;

    const { data, error } = await supabaseClient
      .from("historial_ops")
      .insert(minimo)
      .select()
      .single();

    if(!error) return data;
    console.warn("historial_ops insert mínimo falló:", error);
  }catch(e){
    console.warn("historial_ops fallback mínimo falló:", e);
  }

  return null;
}

// El puesto de Chunior puede resolver distinto entre sesiones (XGENERALENUSO / XGENERAL / GENERAL…)
// y las operaciones quedan guardadas con ese string. Para que el historial sea consistente
// SIEMPRE, leemos por TODOS los alias de la oficina, no por el string exacto de esta sesión.
function pcAliasesHist(){
  const v = String((typeof pcOperativa!=='undefined' ? pcOperativa : '') || '').trim().toUpperCase();
  const grupos = {
    "P1":["P1","PC1","XGENERALENUSO","XGENERAL","GENERAL","OFI_1"],
    "P2":["P2","PC2"], "P3":["P3","PC3"],
    "P4":["P4","PC4","SANCHEZ","SANCHEZPLATA"], "P5":["P5","PC5"]
  };
  for(const k in grupos){ if(grupos[k].includes(v)) return grupos[k]; }
  return v ? [v] : ["P1"];
}
// ── Recuperar el N° de movimiento de una operación que quedó sin él ──────────
// Medido: 1.172 CARGAS y 199 RETIROS de 30 días sin chunior_movimiento_id. La operación se
// hizo, lo que falló fue leer el número del mensaje de éxito de Chunior. El motor para
// encontrarlo ya existía —verificarMovimientoEnChunior busca en la lista real por usuario,
// cruza el monto y descarta los N° ya vinculados a otra fila— pero sólo se usaba dentro de
// "Reintentar". Acá se puede pedir desde la ficha, sin reintentar nada ni tocar saldos.
window.expedienteBuscarMovChunior = async function(historialId, usuario, monto, fechaIso){
  historialId = String(historialId||'').trim();
  usuario = String(usuario||'').trim();
  if(!historialId || !/^\d+$/.test(historialId)){
    toast('Esta fila no tiene operación registrada: no hay dónde guardar el N°.', 'yellow'); return;
  }
  if(!usuario){ toast('Sin usuario no se puede buscar el movimiento.', 'yellow'); return; }
  if(typeof verificarMovimientoEnChunior !== 'function'){ toast('Falta el buscador de Chunior.', 'red'); return; }
  if(!window.chunior){ toast('Ventana de Chunior no disponible.', 'red'); return; }

  const tOpMs = fechaIso ? new Date(fechaIso).getTime() : null;
  // El horario desambigua entre varias cargas iguales del mismo usuario. Para una operación
  // del momento ±2 min alcanza; para una vieja se abre a ±10 min porque el desfase entre el
  // created_at nuestro y la hora que registró Chunior pesa más cuanto más atrás se busca.
  const reciente = tOpMs != null && (Date.now() - tOpMs) < 2*60*60*1000;
  const ventana = reciente ? 2*60*1000 : 10*60*1000;

  // No reclamar un N° que ya es de otra operación.
  const otros = ((typeof _historialData !== 'undefined' && _historialData) || [])
    .filter(function(x){ return String(x.id) !== historialId && x.chunior_movimiento_id; })
    .map(function(x){ return String(x.chunior_movimiento_id); });

  toast('Buscando el movimiento de '+usuario+' en Chunior...', 'blue');
  let r;
  try{
    r = await verificarMovimientoEnChunior(usuario, Number(monto||0), tOpMs, ventana, otros);
  }catch(e){
    toast('Error buscando en Chunior: '+(e.message||e), 'red'); return;
  }

  if(r && r.vinculadoAOtro){
    toast('Encontré el N° '+(r.idVinculado||'?')+' pero ya está usado por otra operación. Revisalo a mano.', 'orange');
    return;
  }
  if(!r || !r.existe || !r.movimientoId){
    toast('No apareció. Puede estar más atrás de las 40 filas que lee Chunior, o anotado con otro monto.', 'orange');
    return;
  }

  // .update() sin match NO devuelve error: si el id no existía, esto cantaba "guardado" igual.
  // Con .select() sabemos si de verdad se tocó una fila.
  let guardadas = [];
  try{
    const { data, error } = await supabaseClient.from('historial_ops')
      .update({ chunior_movimiento_id: String(r.movimientoId) })
      .eq('id', Number(historialId))
      .select('id');
    if(error) throw error;
    guardadas = data || [];
  }catch(e){
    toast('Lo encontré (N° '+r.movimientoId+') pero no pude guardarlo: '+(e.message||e), 'red'); return;
  }
  if(!guardadas.length){
    toast('Encontré el N° '+r.movimientoId+' pero la operación #'+historialId+' no existe en el historial. No se guardó nada.', 'red');
    return;
  }

  // Refrescar EN MEMORIA además de recargar. La operación puede ser de hace semanas y quedar
  // fuera de la ventana cargada: entonces cargarHistorial() no la trae y la ficha seguía
  // diciendo "Sin N° anotado" aunque el número ya estuviera guardado en la base.
  _marcarMovEnMemoria(historialId, String(r.movimientoId));

  toast('✓ Movimiento N° '+r.movimientoId+' vinculado a la operación.', 'green');
  try{ await cargarHistorial(); }catch(_e){}
  try{ _marcarMovEnMemoria(historialId, String(r.movimientoId)); }catch(_e){}
  try{ renderHistorialUnificado(); }catch(_e){}
};

// Escribe el N° recién encontrado en TODAS las copias que hay dando vueltas: la fila del
// historial, la solicitud del portal que la originó y el item ya construido de la vista.
// Sin esto el dato queda sólo en la base y la pantalla sigue mostrando lo viejo.
function _marcarMovEnMemoria(historialId, movId){
  const idStr = String(historialId);
  let solicitudId = null;
  try{
    ((typeof _historialData !== "undefined" && _historialData) || []).forEach(function(h){
      if(String(h.id) === idStr){ h.chunior_movimiento_id = movId; if(h.solicitud_id != null) solicitudId = String(h.solicitud_id); }
    });
  }catch(_e){}
  try{
    (window._histUnificadoCache || []).forEach(function(it){
      // Por solicitud, sólo la tarjeta del PORTAL de esa solicitud. Un retiro pagado en partes
      // tiene varias filas de historial con la misma solicitud y cada una tiene SU número: el del
      // último pago se copiaba a todas y las tres tarjetas decían N° 9657437 (Juan, 12/09).
      const coincide = String(it.historial_id) === idStr ||
        (solicitudId && it.fuente === 'SOLICITUD' && String(it.solicitud_id) === solicitudId);
      if(coincide){
        it.chunior_movimiento_id = movId;
        if(it._raw){ it._raw.chunior_movimiento_id = movId; }
      }
    });
  }catch(_e){}
  // La solicitud del portal es la que arma la ficha cuando la operación es vieja.
  try{
    const sols = (window.V154P && window.V154P.solicitudes) || window.solicitudes || [];
    sols.forEach(function(x){
      const xid = String(x.HISTORIAL_ID || x.historial_id || "");
      const xsol = String(x.ID || x.SOLICITUD_ID || x.id || "");
      if(xid === idStr || (solicitudId && xsol === solicitudId)) x.chunior_movimiento_id = movId;
    });
  }catch(_e){}
}

// ── Ventana del historial ────────────────────────────────────────────────────
// Antes esto era .limit(200) fijo. Medido contra la base, 200 filas son:
//   P4 9,1 h · P2 9,3 h · P3 10,0 h · P7 11,8 h · P6 13,5 h · P5 30,9 h
// O sea que en las oficinas grandes NO alcanzaba ni para el turno en curso, y todo lo de
// ayer quedaba fuera del panel: no había con qué cotejar. Ahora la ventana se mide en
// TIEMPO (que es lo que el operador tiene en la cabeza), no en cantidad de filas.
window._HIST_PERIODO = window._HIST_PERIODO || "TURNO";
const _HIST_PERIODOS = {
  TURNO: { horas: 12,  limite: 1500, nombre: "Turno actual" },
  HOY:   { horas: 24,  limite: 2500, nombre: "Últimas 24 h" },
  D7:    { horas: 168, limite: 5000, nombre: "7 días" },
  D30:   { horas: 720, limite: 8000, nombre: "30 días" }
};
function _histVentana(){
  const cfg = _HIST_PERIODOS[String(window._HIST_PERIODO||"TURNO")] || _HIST_PERIODOS.TURNO;
  let horas = cfg.horas;
  // En TURNO la ventana arranca donde arrancó el turno, pero nunca menos de 12 h: si son las
  // 06:10 y el turno recién empezó, el operador igual necesita ver lo que dejó el turno anterior.
  if(window._HIST_PERIODO==="TURNO" || !window._HIST_PERIODO){
    try{
      const ar = new Date(Date.now() - 3*3600*1000);
      const h = ar.getUTCHours();
      const inicio = h>=6 && h<14 ? 6 : (h>=14 && h<22 ? 14 : 22);
      let desdeTurno = (h - inicio + 24) % 24;
      horas = Math.max(12, desdeTurno + 1);
    }catch(_e){}
  }
  return {
    desde: new Date(Date.now() - horas*3600*1000).toISOString(),
    limite: cfg.limite,
    horas: horas,
    nombre: cfg.nombre
  };
}
// Cambiar el período RECONSULTA al servidor: es la única forma de ver lo que quedó fuera.
window.setHistorialPeriodo = async function(clave){
  window._HIST_PERIODO = String(clave||"TURNO").toUpperCase();
  const sel = document.getElementById("filtroPeriodoSelect");
  if(sel && sel.value !== window._HIST_PERIODO) sel.value = window._HIST_PERIODO;
  try{ toast("Trayendo "+((_HIST_PERIODOS[window._HIST_PERIODO]||{}).nombre||"")+"...", "blue"); }catch(_e){}
  await cargarHistorial();
};

// ── Operaciones de hoy desde las 00 (centro de control) ──────────────────────
// Cuenta con head:true (no trae filas) y con el MISMO filtro de oficina que el historial. No sale
// del historial ya cargado porque esa ventana es "el turno" o "12 h", no "desde las 00".
window.solOpsHoyRefrescar = async function(){
  const el = document.getElementById('solOpsHoy'); if(!el) return;
  try{
    // Sin operador logueado no se cuenta: pcAliasesHist() cae a ["P1"] y contaría otra oficina.
    const op = (window.operador && (window.operador.usuario||window.operador.nombre))
            || (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre));
    if(!op) return;
    const pcs = (typeof pcAliasesHist === 'function') ? pcAliasesHist() : [];
    if(!pcs || !pcs.length) return;
    const desde = inicioDiaArgentina().toISOString();
    const contar = function(tipo){
      return supabaseClient.from('historial_ops').select('id', { count:'exact', head:true })
        .in('pc_codigo', pcs).gte('created_at', desde).eq('estado','OK').eq('tipo', tipo);
    };
    const res = await Promise.all([contar('CARGA'), contar('RETIRO')]);
    if((res[0] && res[0].error) || (res[1] && res[1].error)) return;
    const c = Number(res[0] && res[0].count)||0, r = Number(res[1] && res[1].count)||0;
    el.innerHTML = '📊 <b>'+(c+r)+'</b> operaciones desde las 00'
      + ' <span class="c">⬆ '+c+'</span> <span class="r">⬇ '+r+'</span>';
  }catch(_e){}
};
try{ setInterval(function(){ try{ window.solOpsHoyRefrescar(); }catch(_e){} }, 60000); }catch(_e){}

async function cargarHistorial(){
  _historialCargado = true;
  const el = document.getElementById("historialTable");
  if(el) el.innerHTML = '<div class="small" style="text-align:center;padding:20px;color:var(--muted)">Cargando...</div>';
  // Pintar desde caché al instante mientras Supabase responde
  try{ pintarHistorialDesdeCache(); }catch(_e){}

  // Incluimos LANDING/PORTAL para diferenciar claramente operaciones manuales
  // de operaciones que nacen desde solicitudes del portal.
  const _v = _histVentana();
  const { data, error } = await supabaseClient
    .from("historial_ops")
    .select("*")
    .in("pc_codigo", pcAliasesHist())
    .gte("created_at", _v.desde)
    .order("created_at", { ascending: false })
    .limit(_v.limite);

  if(error){
    if(el) el.innerHTML = '<div class="err-box">Error: '+escapeHtml(error.message||'')+'</div>';
    return;
  }
  _historialData = data || [];
  // Mismo caso: el CRM y el expediente leen window._historialData y siempre les daba undefined.
  try{ window._historialData = _historialData; }catch(_e){}
  try{ window.solOpsHoyRefrescar(); }catch(_e){}

  // CRM · Sembrar la base LOCAL de JUGADORES desde historial_ops (FUENTE PRINCIPAL).
  // Muchos usuarios cargaron desde OTRA máquina/turno, o su solicitud del portal ya salió de la
  // ventana actual → sólo viven en historial_ops. Sin esto NO aparecían en "Jugadores" (arbolito)
  // aunque tuvieran operaciones. Regla igual que en guardarMovimientoLocal: CBU/alias SÓLO de
  // RETIROS (en una carga el destino es NUESTRA billetera, no un dato del usuario); el titular
  // sirve en ambos flujos. El teléfono se sigue tomando de vincular/harvest (historial_ops no lo trae).
  try{
    if(window.jugadorRegistrarDato){
      window.__jugHistSeeded = window.__jugHistSeeded || new Set();
      const _okEstadosJug = ['OK','PAGADA','ACREDITADA','COMPLETADA','APROBADA'];
      _historialData.forEach(function(h){
        if(!h || !h.usuario) return;
        const sid = String(h.id!=null ? h.id : (h.usuario+'_'+(h.created_at||'')));
        if(window.__jugHistSeeded.has(sid)) return;   // ya sembrado → no reprocesar en cada refresh
        window.__jugHistSeeded.add(sid);
        const p = _movParseNotas(h.notas);
        const esRet = String(h.tipo||'').toUpperCase()==='RETIRO';
        const opOk  = _okEstadosJug.includes(String(h.estado||'').toUpperCase());
        // Se registra SIEMPRE (aunque no haya titular/CBU) para que el usuario EXISTA en el arbolito.
        window.jugadorRegistrarDato(h.usuario, {
          cbu: esRet ? (p.cbu||p.destino) : '',
          titular: p.titular,
          instrumentoVerificado: esRet && opOk,   // retiro pagado a ese destino = instrumento verificado
          fecha: h.created_at
        });
      });
    }
  }catch(_e){}

  const bilSel = document.getElementById("filtHistBilletera");
  if(bilSel){
    const bils = [...new Set(_historialData.map(function(h){return h.billetera_nombre;}).filter(Boolean))];
    bilSel.innerHTML = '<option value="">Todas las billeteras</option>' +
      bils.map(function(b){ return '<option value="'+escapeHtml(b)+'">'+escapeHtml(b)+'</option>'; }).join('');
  }
  filtrarHistorial();
  // Refrescar la vista unificada de solicitudes si ya tiene datos cargados
  try{ if(solicitudes.length || _historialData.length) renderHistorialUnificado(); }catch(_e){}
  // Cargar operaciones de agente (CSV) en paralelo → alimentan el CRM/segmentación
  try{ cargarOperacionesAgente(); }catch(_e){}
}

// Operaciones de agentes importadas por CSV (admi) → solo alimentan el CRM, no el historial operativo.
// Agregamos del lado del servidor (cargas/montos/última carga por jugador) para no traer
// decenas de miles de filas ni sesgar por las más recientes.
// Esto son CUATRO consultas pesadas que alimentan el CRM, y se disparaban en CADA carga de
// historial, tenga el operador el CRM abierto o no. panel_crm_agente_resumen sola tarda 3,1 s
// (3.877 filas) y se llamó 5.382 veces el 2/10 entre las quince PCs. Cuando la base está ocupada
// se pasa del tope de tiempo y PostgREST devuelve 500 — que es el error que aparecía en la consola
// de Sánchez junto al de la bandeja. Y el panel se lo comía: `error ? (window._agenteResumen||[])`.
//
// Se guarda el resultado unos minutos. Quien de verdad lo necesite fresco —abrir Jugadores, por
// ejemplo— llama con forzar=true y lo vuelve a pedir.
const _CRM_VIVE_MS = 5 * 60 * 1000;
let _crmUltima = 0, _crmEnCurso = null;
async function cargarOperacionesAgente(forzar){
  const ahora = Date.now();
  if(!forzar && window._agenteResumen && (ahora - _crmUltima) < _CRM_VIVE_MS) return window._agenteResumen;
  if(_crmEnCurso) return _crmEnCurso;                      // no apilar cuatro consultas iguales
  _crmEnCurso = _cargarOperacionesAgenteAhora().finally(function(){
    _crmEnCurso = null; _crmUltima = Date.now();
  });
  return _crmEnCurso;
}
async function _cargarOperacionesAgenteAhora(){
  const pcs = (typeof pcAliasesHist==="function" ? pcAliasesHist() : [String(pcOperativa||"")]);
  try{
    const { data, error } = await supabaseClient.rpc("panel_crm_agente_resumen", { p_pc_codigos: pcs, p_secret: window.PANEL_DATA_SECRET });
    // El error iba derecho a la basura. Es una consulta de 3 segundos y cuando se pasa del tope el
    // servidor devuelve 500: el CRM se quedaba sin datos y nadie se enteraba.
    if(error) console.warn('[crm] agente_resumen fallo', error);
    window._agenteResumen = error ? (window._agenteResumen||[]) : (data||[]);
  }catch(e){ console.warn('[crm] agente_resumen fallo', e); window._agenteResumen = window._agenteResumen||[]; }
  // Flags push/app por jugador → para mostrar 🔔/📱 en el CRM
  try{
    const { data, error } = await supabaseClient.rpc("panel_crm_flags", { p_pc_codigos: pcs, p_secret: window.PANEL_DATA_SECRET });
    const m = {};
    if(!error && Array.isArray(data)){ data.forEach(function(f){ m[String(f.usuario||"").toLowerCase()] = {push:!!f.push, app:!!f.app}; }); }
    window._crmFlags = m;
  }catch(_e){ window._crmFlags = window._crmFlags||{}; }
  // Vínculos de whaticket (usuario+teléfono) → para que el CRM incluya a TODOS los registrados,
  // aunque NO tengan operaciones de agente ni del panel. Aporta teléfono/estado; ops quedan en 0.
  // Requiere la RPC panel_crm_vinculos (SQL). Si no existe, el CRM sigue andando sin esta fuente.
  try{
    const { data, error } = await supabaseClient.rpc("panel_crm_vinculos", { p_pc_codigos: pcs, p_secret: window.PANEL_DATA_SECRET });
    window._crmVinculos = (!error && Array.isArray(data)) ? data : (window._crmVinculos||[]);
  }catch(_e){ window._crmVinculos = window._crmVinculos||[]; }
  // Acá iba el contador global de registrados (las siete oficinas juntas). Se sacó junto con
  // la tarjeta que lo mostraba: el CRM ahora lista los registrados DE LA OFICINA, paginados
  // (panel_crm_vinculos_listar). Una consulta menos cada vez que se abre la pestaña.
  return window._agenteResumen;
}

function filtrarHistorial(){
  const tipo    = document.getElementById("filtHistTipo")?.value||"";
  const estado  = document.getElementById("filtHistEstado")?.value||"";
  const origen  = document.getElementById("filtHistOrigen")?.value||"";
  const bil     = document.getElementById("filtHistBilletera")?.value||"";
  const usuario = normalizar(document.getElementById("filtHistUsuario")?.value||"");

  // Unificar historial_ops + solicitudes del portal
  let lista = [];
  if(typeof construirHistorialUnificado === "function"){
    construirHistorialUnificado().forEach(function(it){
      lista.push({
        id: it.id, tipo: (it.tipo||'').toUpperCase(), usuario: it.usuario,
        billetera_nombre: it.billetera_nombre, billetera_id: it.billetera_id, monto: it.monto,
        estado: it.fuente==='SOLICITUD' ? (it.estado||'PENDIENTE') : (it.estado||''),
        origen: it.fuente==='SOLICITUD' ? 'PORTAL' : (it._raw&&it._raw.origen||'PANEL'),
        operador: it.operador || (it._raw&&it._raw.operador) || '',
        notas: it._raw&&it._raw.notas||'',
        created_at: it.fecha,
        saldo_post: it.saldo_post!=null ? it.saldo_post : null,
        saldo_pre: it.saldo_pre!=null ? it.saldo_pre : null,
        chunior_movimiento_id: it.chunior_movimiento_id,
        solicitud_id: it.solicitud_id || (it._raw&&it._raw.solicitud_id) || null,
        historial_id: it.historial_id || (it.fuente !== 'SOLICITUD' ? it.id : null) || null,
        _fuente: it.fuente
      });
    });
  } else {
    lista = _historialData.slice();
  }

  if(tipo)    lista = lista.filter(function(h){return normalizar(h.tipo)===normalizar(tipo);});
  if(estado)  lista = lista.filter(function(h){return (h.estado||'')===estado;});
  if(origen)  lista = lista.filter(function(h){return (h.origen||'')===origen;});
  if(bil)     lista = lista.filter(function(h){return (h.billetera_nombre||'')===bil;});
  if(usuario) lista = lista.filter(function(h){return normalizar(h.usuario||'').includes(usuario)||normalizar(h.operador||'').includes(usuario);});
  renderHistorial(lista);
}

function renderHistorial(lista){
  const el = document.getElementById("historialTable");
  if(!el) return;
  if(!lista.length){
    el.innerHTML = '<div class="small" style="text-align:center;padding:20px;color:var(--muted)">Sin operaciones para mostrar.</div>';
    return;
  }

  function origenPill(o){
    const map = {MANUAL:'op-manual',AUTO:'op-auto',PANEL:'op-panel',LANDING:'op-landing',PORTAL:'op-landing'};
    const label = o==='PORTAL'?'PORTAL':(o==='LANDING'?'PORTAL':o);
    return '<span class="origen-pill '+(map[o]||'')+'">'+escapeHtml(label||'?')+'</span>';
  }
  function estadoIcon(e){
    if(e==='OK'||e==='ACREDITADA'||e==='PAGADA'||e==='COMPLETADA'||e==='APROBADA') return '<span style="color:var(--green)">✅</span>';
    if(e==='ERROR') return '<span style="color:var(--red)">❌</span>';
    if(e==='REVERTIDA') return '<span style="color:var(--muted)">↩</span>';
    if(e==='RECHAZADA'||e==='CANCELADA') return '<span style="color:var(--red)">✖</span>';
    if(e==='PENDIENTE'||e==='EN_REVISION'||!e) return '<span style="color:var(--muted);font-size:11px">⏳</span>';
    return '<span style="font-size:11px;color:var(--muted)">'+escapeHtml(e)+'</span>';
  }
  function tipoIcon(t){
    if(t==='CARGA') return '⬆️';
    if(t==='RETIRO') return '⬇️';
    if(t==='CONSULTA') return '👁';
    if(t==='RESET_CLAVE') return '🔑';
    if(t==='MOV_BILLETERA') return '🔀';
    if(t==='CAMBIO_BILLETERA') return '💳';
    if(t==='DEPOSITO_SR') return '💜';
    if(t==='PROPINA') return '🎁';
    if(t==='RECARGA_FICHAS') return '🎰';
    if(t==='GASTO') return '💸';
    return '➡️';
  }

  // La tabla se arma entera en un innerHTML: con el periodo en 30 dias serian miles de <tr>
  // de un saque y la vista se cuelga. Se pintan las mas nuevas y se avisa cuantas quedaron.
  const _TOPE_FILAS = 500;
  const _recortada = lista.length > _TOPE_FILAS;
  const _visibles = _recortada ? lista.slice(0, _TOPE_FILAS) : lista;

  let html = (_recortada
    ? '<div class="alert-box">Mostrando las <b>' + _TOPE_FILAS + '</b> más nuevas de <b>' + lista.length + '</b>. Afiná los filtros o buscá por usuario / N° de movimiento para llegar al resto.</div>'
    : '') +
    '<div class="table-wrap"><table><thead><tr>'+
    '<th>Fecha</th><th>Tipo</th><th>Usuario</th><th>Monto</th><th>Saldo pre</th><th>Saldo post</th>'+
    '<th>Billetera</th><th>Origen</th><th>Estado</th><th>Op</th><th></th>'+
    '</tr></thead><tbody>';

  _visibles.forEach(function(h){
    try{ window._histPorId[String(h.id)] = h; }catch(_e){}
    const rowClass = h.estado==='REVERTIDA'?'hrow-revertida':h.estado==='ERROR'?'hrow-error':
      h.origen==='MANUAL'?'hrow-manual':h.origen==='AUTO'?'hrow-auto':h.origen==='PANEL'?'hrow-panel':'hrow-landing';
    const estadoOkVisual = (h.estado==='OK'||h.estado==='ACREDITADA'||h.estado==='PAGADA'||h.estado==='COMPLETADA'||h.estado==='APROBADA');
    const esOperacionDinero = (h.tipo==='CARGA'||h.tipo==='RETIRO');
    const histAccionId = String(h.historial_id || (h._fuente!=='SOLICITUD' ? h.id : '') || '');
    const puedeAccionarHistorial = esOperacionDinero && (!!histAccionId || (h._fuente==='SOLICITUD' && !!h.solicitud_id));
    const canUndo = estadoOkVisual && puedeAccionarHistorial;
    const notasTd = (h.estado==='ERROR' && h.notas)
      ? '<br><span class="small" style="color:#f87171">'+escapeHtml(_errTextoLimpio(h.notas)||_errEtiqueta(h.notas)||'sin detalle')+'</span>'
      : ((h.notas && (h.tipo==='CONSULTA'||h.tipo==='RESET_CLAVE'))
          ? '<br><span class="small">'+escapeHtml(h.notas)+'</span>' : '');
    const undoBtn = canUndo
      ? '<button class="mini-btn yellow" onclick="deshacerOperacion(\x27'+escapeHtml(histAccionId)+'\x27,\x27'+escapeHtml(h.usuario||'')+'\x27,\x27'+h.tipo+'\x27,\x27'+h.monto+'\x27,\x27'+(h.billetera_id||'')+'\x27)" style="font-size:11px">&#8629; Deshacer</button>'
      : '';
    const changeLocalArgs = '\x27'+escapeHtml(histAccionId)+'\x27,\x27'+escapeHtml(String(h.billetera_id||''))+'\x27,\x27'+escapeHtml(String(h.solicitud_id||''))+'\x27';
    const chuniorBtn = h.chunior_movimiento_id
      ? '<button class="mini-btn purple" onclick="cambiarBilleteraMovimiento(\x27'+escapeHtml(String(h.chunior_movimiento_id))+'\x27,\x27'+escapeHtml(histAccionId)+'\x27,\x27'+escapeHtml(String(h.billetera_id||''))+'\x27)" style="font-size:11px" title="Cambiar billetera del Mov. N° '+escapeHtml(String(h.chunior_movimiento_id))+'">💳 Cambiar billetera</button>'
      : (puedeAccionarHistorial ? '<button class="mini-btn purple" onclick="cambiarBilleteraHistorialLocal('+changeLocalArgs+')" style="font-size:11px" title="Cambiar billetera en historial/portal">💳 Cambiar billetera</button>' : '');
    const claveBtn = (h.usuario && h.tipo !== 'RESET_CLAVE')
      ? '<button class="mini-btn yellow" onclick="blanquearClaveUsuario(\x27'+escapeHtml(String(h.usuario))+'\x27)" style="font-size:11px" title="Blanquear clave de '+escapeHtml(String(h.usuario))+' a 12345a">🔑 Clave</button>'
      : '';
    // Botón de reintento. Aparece en dos casos:
    //   1) estado ERROR → verifica Drex/Chunior y reintenta lo que falte
    //   2) estado OK pero SIN chunior_movimiento_id y la billetera TIENE chunior_uid
    //      → la carga entró en Drex pero NO se anotó en Chunior (queda diferencia)
    const _bilDeFila = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(h.billetera_id); });
    // [CHUNIOR_OK_SIN_N] = Chunior SÍ aceptó el movimiento, solo no pudimos leer el N° de
    // vuelta (parseo flaky) — no es una falta real, no hay que ofrecer reintentar.
    const chuniorPendiente = (h.estado === 'OK')
      && !h.chunior_movimiento_id
      && !/\[CHUNIOR_OK_SIN_N\]/.test(String(h.notas||''))
      && (h.tipo === 'CARGA' || h.tipo === 'RETIRO')
      && _bilDeFila && _bilDeFila.CHUNIOR_UID;
    const necesitaRetry = (h.estado === 'ERROR' && h.usuario && (h.tipo === 'CARGA' || h.tipo === 'RETIRO')) || chuniorPendiente;
    const retryBtn = necesitaRetry
      ? '<button class="mini-btn red" onclick="reintentarOperacionFallida(\x27'+h.id+'\x27)" style="font-size:11px" title="'+(chuniorPendiente?'Falta anotar en Chunior — reintentar':'Verificar Drex/Chunior y reintentar lo que falte')+'">'+(chuniorPendiente?'⚠️ Falta Chunior':'↻ Reintentar')+'</button>'
      : '';
    // Botón ℹ️ de proceso: solo si hay traza guardada de esa operación en ESTA PC.
    let _hayTraza = false; try{ _hayTraza = !!localStorage.getItem('nodo_traza_hist_'+h.id); }catch(_e){}
    const infoBtn = _hayTraza
      ? '<button class="mini-btn" style="font-size:13px;background:#1e3a5f;color:#7cc4ff;border:1px solid rgba(124,196,255,.45);padding:5px 9px;line-height:1" onclick="verTrazaHistorial(\x27'+h.id+'\x27)" title="Ver el paso a paso del proceso (dónde falló)">ℹ️</button>'
      : '';
    // El detalle arma una ficha de CARGA/RETIRO: monto, saldos, destino, árbol de
    // operaciones. Un CAMBIO_CLAVE o una CONSULTA no tienen nada de eso, y abrirlo mostraba
    // "⬆️ Carga · pruebaxx · $ 0" con el árbol de OTRAS operaciones colgando abajo. No es que
    // falte el dato: no existe el movimiento.
    const _tipoConMovimiento = ["CARGA","RETIRO","MOV_BILLETERA","CAMBIO_BILLETERA",
                                "DEPOSITO_SR","PROPINA","RECARGA_FICHAS","GASTO"];
    // 4/10 · Acá se mezclaban DOS numeraciones distintas y el botón abría otro jugador.
    //
    // Esta lista junta dos cosas: movimientos (historial_ops) y solicitudes del portal
    // (landing_solicitudes). Cada tabla numera por su cuenta y las dos ya van por el 300.000,
    // así que los números se pisan. El botón mandaba h.id a secas; si la fila era una
    // SOLICITUD, el detalle buscaba ese número entre los MOVIMIENTOS y abría el de otra persona.
    //
    // Caso de Juan: solicitud 303566 = juijuh, carga de $2.000. Movimiento 303566 = vero8goat,
    // carga de $4.000. Apretó la lupa de juijuh y se abrió la ficha de vero8goat, con su
    // titular y su árbol de operaciones.
    //
    // La fila ya sabía de dónde venía (_fuente) y ya traía historial_id: nadie los usaba.
    const _histIdSeguro = (h._fuente === 'SOLICITUD') ? '' : String(h.historial_id || h.id || '');
    const _solIdFila    = String(h.solicitud_id || (h._fuente === 'SOLICITUD' ? (h.id||'') : '') || '');
    const detalleBtn = _tipoConMovimiento.indexOf(String(h.tipo||"").toUpperCase()) === -1
      ? ''
      : '<button class="mini-btn" style="font-size:13px;background:#3b2a09;color:#fde68a;border:1px solid rgba(253,230,138,.45);padding:5px 9px;line-height:1" onclick="verDetalleMovimiento(\x27'+escapeHtml(_histIdSeguro)+'\x27,\x27'+escapeHtml(String(h.usuario||''))+'\x27,\x27'+escapeHtml(_solIdFila)+'\x27)" title="Ver el detalle de esta operación">🔍</button>';
    // Anular propina (portado de NexoBetaChan): solo en filas PROPINA con N° de Chunior → pone el monto en 0,10.
    const anularPropBtn = (String(h.tipo||'').toUpperCase()==='PROPINA' && h.chunior_movimiento_id && String(h.estado||'').toUpperCase()!=='ANULADA')
      ? '<button class="mini-btn red" style="font-size:11px" onclick="anularPropinaHistorial(\x27'+escapeHtml(String(h.id))+'\x27)" title="Anular esta propina (pone el monto en 0,10 en Chunior)">🚫 Anular</button>'
      : '';
    const errBtn = (h.estado === 'ERROR')
      ? '<button class="mini-btn" style="font-size:12px;background:#3f1d1d;color:#fca5a5;border:1px solid rgba(248,113,113,.45);padding:5px 9px;line-height:1" onclick="verDetalleError(\x27'+escapeHtml(String(h.id||''))+'\x27)" title="Por qué falló: contexto completo, paso a paso y detalle técnico">🔎 Por qué falló</button>'
      : '';
    const acciones = [errBtn, infoBtn, detalleBtn, retryBtn, chuniorBtn, claveBtn, undoBtn, anularPropBtn].filter(Boolean).join(' ') || '-';
    const saldoPreTd = (h.saldo_pre !== null && h.saldo_pre !== undefined && h.saldo_pre !== '')
      ? '<span style="color:#9aa7bd">'+money(h.saldo_pre)+'</span>'
      : '<span class="small">—</span>';
    const saldoPostTd = (h.saldo_post !== null && h.saldo_post !== undefined && h.saldo_post !== '')
      ? '<span style="font-weight:700;color:#7ee07e">'+money(h.saldo_post)+'</span>'
      : '<span class="small">—</span>';
    // Diferenciación visual retiro/carga (como el nodo hermano): 🟠 naranja retiro · 🟢 verde carga
    const _accH = h.tipo==='RETIRO' ? '#fb923c' : h.tipo==='CARGA' ? '#22c55e' : '';
    html += '<tr class="'+rowClass+'">'+
      '<td style="font-size:12px;white-space:nowrap">'+formatFecha(h.created_at)+'</td>'+
      '<td style="white-space:nowrap'+(_accH?';color:'+_accH+';font-weight:800':'')+'">'+tipoIcon(h.tipo)+' '+escapeHtml(h.tipo||'—')+'</td>'+
      '<td><b>'+escapeHtml(h.usuario||'—')+'</b>'+notasTd+'</td>'+
      '<td style="font-weight:700'+(_accH?';color:'+_accH:'')+'">'+(h.monto?money(h.monto):'—')
        +(function(){ const pr = window._parteRetiro ? window._parteRetiro({ fuente:'OPERACION', tipo:h.tipo, solicitud_id:h.solicitud_id, monto:h.monto, historial_id:h.id, id:h.id, _raw:h }) : null;
            return pr ? '<br><span class="small" style="color:#c084fc;font-weight:800">'+escapeHtml(window._parteRetiroTxt(pr))+'</span>' : ''; })()
        +'</td>'+
      '<td style="font-size:12px;white-space:nowrap">'+saldoPreTd+'</td>'+
      '<td style="font-size:12px;white-space:nowrap">'+saldoPostTd+'</td>'+
      '<td style="font-size:12px">'+escapeHtml(String(h.billetera_nombre||'—').split('·')[0].trim()||String(h.billetera_nombre||'—'))+'</td>'+
      '<td>'+origenPill(h.origen)+'</td>'+
      '<td style="white-space:nowrap">'+estadoIcon(h.estado)+((h.estado==='ERROR' && _errEtiqueta(h.notas)) ? (' <span style="font-size:10.5px;font-weight:800;color:#f87171">'+escapeHtml(_errEtiqueta(h.notas))+'</span>') : '')+'</td>'+
      '<td style="font-size:11px;color:var(--muted)">'+escapeHtml(h.operador||'—')+'</td>'+
      '<td style="white-space:nowrap">'+acciones+'</td>'+
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// Reintento INTERACTIVO de una operación con problemas.
// En vez de adivinar si la op se hizo (no siempre tenemos datos confiables para eso),
// le mostramos al operador el estado REAL de cada sistema y lo dejamos decidir:
//   - Chunior: detectable por chunior_movimiento_id (null = NO registrado)
//   - Drex/Agentes: leemos el saldo ACTUAL del jugador y lo mostramos. El operador
//     ve el número y decide si la carga ya está reflejada o falta.
// Deshacer una carga NO siempre significa que el jugador se quedó sin su plata: también se usa
// para borrar una carga duplicada, y ahí la solicitud sigue bien acreditada por la otra fila.
// Esto responde la única pregunta que decide: sacando la fila revertida, ¿queda otra CARGA OK que
// cubra lo que pidió?
function _solicitudQuedoSinPagar(total, filas, idRevertido){
  const t = Math.abs(Number(total)) || 0;
  const cubierto = (filas || []).reduce(function(a, h){
    if(!h) return a;
    if(String(h.id) === String(idRevertido)) return a;
    if(String(h.estado || '').toUpperCase() !== 'OK') return a;
    if(String(h.tipo || '').toUpperCase() !== 'CARGA') return a;
    return a + (Math.abs(Number(h.monto)) || 0);
  }, 0);
  return { sinPagar: !(t > 0 && cubierto >= t - 0.5), cubierto: cubierto };
}
window._solicitudQuedoSinPagar = _solicitudQuedoSinPagar;

// Suelta la solicitud cuando la carga revertida era la única que la sostenía (H-3). Antes esto
// pasaba sólo con los retiros: se le sacaban las fichas al jugador y su pedido seguía diciendo
// "acreditada", así que ni él ni el próximo operador se enteraban.
async function _reabrirSolicitudSiQuedoSinPagar(solicitudId, historialIdRevertido, monto, usuario){
  const sid = String(solicitudId || ''); if(!sid) return;
  try{
    let total = 0;
    try{
      const q = await supabaseClient.from('landing_solicitudes').select('monto, estado').eq('id', sid).maybeSingle();
      const f = (q && q.data && !Array.isArray(q.data)) ? q.data : null;
      total = Math.abs(Number(f && f.monto)) || 0;
      const est = String((f && f.estado) || '').toUpperCase();
      // Si ya no figuraba acreditada, no hay nada que soltar.
      if(est && est !== 'ACREDITADA' && est !== 'PAGADA') return;
    }catch(_e){}

    let filas = [];
    try{
      const q2 = await supabaseClient.from('historial_ops').select('id, monto, estado, tipo').eq('solicitud_id', sid);
      filas = (q2 && Array.isArray(q2.data)) ? q2.data : [];
    }catch(_e){}

    const v = _solicitudQuedoSinPagar(total, filas, historialIdRevertido);
    if(!v.sinPagar){
      toast('La solicitud #'+sid+' sigue acreditada · la cubre otro movimiento de '+money(v.cubierto),'blue');
      return;
    }

    const apFn = (typeof actualizarSolicitudPortal === 'function') ? actualizarSolicitudPortal
               : (typeof window.actualizarSolicitudPortal === 'function' ? window.actualizarSolicitudPortal : null);
    if(!apFn) throw new Error('falta el puente con el portal');
    await apFn(sid, 'EN_REVISION', {
      etapa: 'CARGA_REVERTIDA_PANEL',
      operador: (window.operador && (window.operador.usuario || window.operador.nombre)) || 'panel',
      historial_id: Number(historialIdRevertido) || null,
      motivo: 'Se deshizo la carga de ' + money(Math.abs(Number(monto)) || 0)
    });
    toast('↩ La solicitud #'+sid+' volvió a quedar pendiente · el jugador ya no la ve acreditada','yellow');
    // El jugador tenía un "✅ acreditada" nuestro y ya no es cierto: se lo decimos.
    try{
      if(usuario && typeof notificarUsuarioEnChat === 'function'){
        await notificarUsuarioEnChat(usuario,
          '⚠️ Tu carga de $'+(Math.abs(Number(monto))||0).toLocaleString('es-AR')+' quedó sin efecto y la estamos revisando. Cualquier duda escribinos por acá.');
      }
    }catch(_e){}
    try{ if(typeof cargarSolicitudesPortal === 'function') await cargarSolicitudesPortal(true); }catch(_e){}
  }catch(e){
    toast('⚠ Las fichas volvieron, pero la solicitud #'+sid+' sigue figurando acreditada · '+(e.message||'')+' · corregila a mano','red');
  }
}

// ¿Este pago ya está anotado en el progreso del retiro? Mismo monto y a menos de 10 minutos del
// movimiento. Sin esto, cerrar la solicitud desde el reintento contaría el pago dos veces.
function _pagoYaAnotado(pagos, montoAbs, tFilaMs){
  if(!Array.isArray(pagos) || !pagos.length) return false;
  return pagos.some(function(p){
    if(!p || p.revertido) return false;
    const mismoMonto = Math.abs((Math.abs(Number(p.monto)) || 0) - montoAbs) < 1;
    if(!mismoMonto) return false;
    if(!p.fecha) return true;                      // sin fecha, el monto manda
    const t = new Date(p.fecha).getTime();
    return !isNaN(t) && Math.abs(t - tFilaMs) < 10*60*1000;
  });
}
window._pagoYaAnotado = _pagoYaAnotado;

// Cierra la solicitud cuando el reintento terminó BIEN. Usa los mismos motores que el botón
// Aprobar: para una carga, el mismo estado y los mismos datos; para un retiro, la máquina de
// parciales, que es la única que sabe si quedó saldo pendiente (D-108).
async function _cerrarSolicitudTrasReintento(row, tipo, monto, bil){
  const sid = String((row && row.solicitud_id) || '');
  if(!sid) return;
  const montoAbs = Math.abs(Number(monto)) || 0;
  const operador = (window.operador && (window.operador.usuario || window.operador.nombre)) || 'panel';

  if(String(tipo || '').toUpperCase() !== 'RETIRO'){
    // Mismo puente que usa el botón Aprobar; lo pone portal-bridge, así que se resuelve al usarlo.
    const apFn = (typeof actualizarSolicitudPortal === 'function') ? actualizarSolicitudPortal
               : (typeof window.actualizarSolicitudPortal === 'function' ? window.actualizarSolicitudPortal : null);
    try{
      if(!apFn) throw new Error('falta el puente con el portal');
      await apFn(sid, 'ACREDITADA', {
        etapa: 'PORTAL_COMPLETADA_REINTENTO',
        monto_aprobado: montoAbs,
        historial_id: row.id || null,
        saldo_pre: (row.saldo_pre != null ? row.saldo_pre : null),
        saldo_post: (row.saldo_post != null ? row.saldo_post : null),
        operador: operador,
        billetera_id: bil ? bil.ID_BILLETERA : null,
        billetera_nombre: bil ? bil.NOMBRE_VISIBLE : null
      });
      toast('✓ Solicitud #'+sid+' acreditada · el jugador ya la ve resuelta','green');
    }catch(e){
      toast('⚠ La carga entró pero la solicitud #'+sid+' sigue abierta · '+(e.message||'')+' · cerrala a mano','red');
    }
    return;
  }

  // RETIRO: acá NO se elige el estado. Un retiro puede estar pagándose en partes, así que se anota
  // el pago con el MISMO motor que usa el portal (negocia la firma de la RPC y no reintenta cuando
  // el resultado quedó incierto) y la base decide si queda PAGADA o sigue EN_PROCESO.
  let meta = {}, totalSol = 0;
  try{
    const q = await supabaseClient.from('landing_solicitudes').select('metadata, monto').eq('id', sid).maybeSingle();
    const f = (q && q.data && !Array.isArray(q.data)) ? q.data : null;
    meta = (f && f.metadata) || {};
    totalSol = Math.abs(Number(f && f.monto)) || 0;
  }catch(_e){}
  const pagos = (meta.retiro_parcial && Array.isArray(meta.retiro_parcial.pagos)) ? meta.retiro_parcial.pagos : [];
  const tFila = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  if(_pagoYaAnotado(pagos, montoAbs, tFila)){
    toast('El pago ya estaba anotado en el retiro #'+sid+' · no se cuenta dos veces','blue');
    return;
  }

  const yaPagado = pagos.reduce(function(a,x){ return a + (x && !x.revertido ? (Math.abs(Number(x.monto))||0) : 0); }, 0);
  const total = totalSol || (yaPagado + montoAbs);
  const acum  = yaPagado + montoAbs;
  const resta = Math.max(0, total - acum);
  const motor = (typeof notificarRetiroParcialPortal === 'function') ? notificarRetiroParcialPortal
              : (typeof window.notificarRetiroParcialPortal === 'function' ? window.notificarRetiroParcialPortal : null);
  if(!motor){
    toast('⚠ El retiro salió pero no tengo cómo anotar el pago en la solicitud #'+sid+' · anotalo a mano','red');
    return;
  }
  try{
    const rp = await motor(sid, montoAbs, acum, resta, total,
      (row.saldo_post != null ? Number(row.saldo_post) : null),
      (bil && String(bil.TITULAR || bil.NOMBRE_VISIBLE || '').trim()) || null);
    if(!(rp && rp.ok)) throw new Error((rp && rp.detail) || 'no se pudo anotar el pago');
    toast(resta > 0.5
      ? ('✓ Pago anotado en el retiro #'+sid+' · falta '+money(resta))
      : ('✓ Retiro #'+sid+' quedó saldado · el jugador ya lo ve pagado'), 'green');
  }catch(e){
    toast('⚠ El retiro salió pero la solicitud #'+sid+' sigue abierta · '+(e.message||'')+' · anotá el pago a mano','red');
  }
}

async function reintentarOperacionFallida(historialId){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const { data: row, error } = await supabaseClient
    .from('historial_ops').select('*').eq('id', historialId).single();
  if(error || !row){ toast('No se encontró la fila del historial.', 'red'); return; }
  const { usuario, tipo, monto, billetera_id, billetera_nombre, chunior_movimiento_id, saldo_pre, saldo_post, notas } = row;

  // Resolver billetera (ID → nombre → landing) para Chunior
  let bil = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(billetera_id); });
  if(!bil && billetera_nombre) bil = billeteras.find(function(b){ return String(b.NOMBRE_VISIBLE) === String(billetera_nombre); });
  if(!bil) bil = getBilleraLanding();
  const necesitaChunior = !!(bil && bil.CHUNIOR_UID);
  // [CHUNIOR_OK_SIN_N]: Chunior ya aceptó el movimiento, solo no tenemos el N° — contar como
  // "ya hecho" acá también para no ofrecer re-anotar (evita un duplicado real en Chunior).
  const _chuniorMarcadoSinN = /\[CHUNIOR_OK_SIN_N\]/.test(String(notas||''));
  let chuniorYaHecho     = !!chunior_movimiento_id || _chuniorMarcadoSinN;
  let movChuVerificado   = chunior_movimiento_id;

  // 1) Leer agentes (saldo) Y verificar Chunior EN PARALELO.
  //    - Agentes: buscarUsuario (saldo actual)
  //    - Chunior: si NO tenemos chunior_movimiento_id pero la billetera usa Chunior,
  //      buscamos el movimiento en la lista real (cubre "se anotó pero no se guardó el N°")
  toast('Verificando estado de '+usuario+' en agentes y Chunior...', 'blue');
  if(!await ensureDrexSession()){ toast("Sesión backoffice requerida", "red"); return; }

  _wdLock();
  let b, chuVerif = { existe:false, movimientoId:null };
  try {
    // N° de movimiento ya vinculados a OTRAS ops del historial → no reclamarlos como propios
    // (evita que dos cargas del mismo usuario/monto se atribuyan el mismo N°).
    const _otrosMovIds = ((typeof _historialData!=='undefined' && _historialData) || [])
      .filter(function(x){ return String(x.id)!==String(historialId) && x.chunior_movimiento_id; })
      .map(function(x){ return String(x.chunior_movimiento_id); });
    // Horario de la operación (± ventana) para DESAMBIGUAR entre varias cargas del mismo
    // usuario/monto. Sin esto (antes iba null,null) dos cargas iguales matcheaban cualquiera
    // → duplicados y verificaciones erróneas. La carga y su anotación en Chunior pasan casi
    // juntas → ventana CORTA (±2min) = match más preciso, menos falsos. Si la fila no trae
    // created_at, _tOpMs=null y la función vuelve al comportamiento sin filtro (no rompe).
    const _tOpMs = row.created_at ? new Date(row.created_at).getTime() : null;
    const verifChuniorPromise = (necesitaChunior && !chuniorYaHecho)
      ? verificarMovimientoEnChunior(usuario, monto, _tOpMs, 2*60*1000, _otrosMovIds)   // usuario + monto + HORARIO (±2min)
      : Promise.resolve({ existe:false, movimientoId:null });
    // Agentes y Chunior usan ventanas distintas → realmente en paralelo
    const [bRes, chuRes] = await Promise.all([
      callDrex("buscarUsuario", usuario),
      verifChuniorPromise
    ]);
    b = bRes;
    chuVerif = chuRes || { existe:false, movimientoId:null };
  } catch(e){
    _wdUnlock(); toast('Error verificando: '+(e.message||''), 'red'); return;
  }
  _wdUnlock();
  if(!b || !b.exists){ toast('Usuario '+usuario+' no encontrado en agentes', 'red'); return; }
  const saldoActual = (typeof b.balance?.value === 'number') ? b.balance.value : null;

  // Si la verificación en vivo encontró el movimiento → Chunior ya está hecho
  if(chuVerif.existe){
    chuniorYaHecho = true;
    if(chuVerif.movimientoId) movChuVerificado = chuVerif.movimientoId;
  }

  // 2) Inferir si Drex ya hizo la op (solo si tenemos referencia confiable)
  //    saldo esperado si la op se hizo = saldo_pre ± monto
  const m = Number(monto);
  const signo = tipo === 'CARGA' ? 1 : -1;
  let drexInferido = 'desconocido'; // 'hecho' | 'pendiente' | 'desconocido'
  if(saldoActual !== null && saldo_pre !== null && saldo_pre !== undefined){
    const esperadoHecho     = Number(saldo_pre) + signo * m;
    const esperadoPendiente = Number(saldo_pre);
    if(Math.abs(saldoActual - esperadoHecho) < 1)        drexInferido = 'hecho';
    else if(Math.abs(saldoActual - esperadoPendiente) < 1) drexInferido = 'pendiente';
  } else if(saldoActual !== null && saldo_post !== null && saldo_post !== undefined){
    if(Math.abs(saldoActual - Number(saldo_post)) < 1) drexInferido = 'hecho';
  }

  // 3) Modal con el estado real + checkboxes para decidir
  const drexBadge = drexInferido === 'hecho'
      ? '<span style="color:#7ee07e">✓ Parece HECHO</span>'
      : drexInferido === 'pendiente'
        ? '<span style="color:var(--red)">✗ Parece PENDIENTE</span>'
        : '<span style="color:#e0c070">? No se pudo inferir</span>';
  const chuniorBadge = chuniorYaHecho
      ? '<span style="color:#7ee07e">✓ Registrado'+(movChuVerificado?' (N° '+escapeHtml(String(movChuVerificado))+')':' (verificado en lista)')+'</span>'
      : (necesitaChunior ? '<span style="color:var(--red)">✗ NO registrado</span>' : '<span style="color:var(--muted)">N/A (billetera sin Chunior)</span>');

  const body =
    '<div style="font-size:13px;line-height:1.6;color:#c0cad8">' +
      '<b>'+escapeHtml(usuario)+'</b> · '+tipo+' de '+money(m)+'<br><br>' +
      '<div style="background:#0e1525;padding:10px;border-radius:10px;margin-bottom:12px">' +
        '💰 Saldo actual en agentes: <b style="color:#fff">'+(saldoActual!==null?money(saldoActual):'—')+'</b><br>' +
        (saldo_pre!=null ? '↳ Saldo antes de la op: '+money(saldo_pre)+'<br>' : '') +
        '↳ Agentes: '+drexBadge+'<br>' +
        '↳ Chunior: '+chuniorBadge +
      '</div>' +
      '<div style="font-weight:700;margin-bottom:6px">¿Qué querés reintentar?</div>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer">' +
        '<input type="checkbox" id="retryDrex" '+(drexInferido==='pendiente'?'checked':'')+' style="width:16px;height:16px"> ' +
        'Cargar/retirar en <b>agentes</b> '+(drexInferido==='hecho'?'<span style="color:var(--red);font-size:11px">(¡cuidado, parece hecho — duplicaría!)</span>':'')+
      '</label>' +
      (necesitaChunior && !chuniorYaHecho ?
      '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
        '<input type="checkbox" id="retryChunior" checked style="width:16px;height:16px"> ' +
        'Anotar en <b>Chunior</b> ('+escapeHtml(bil.NOMBRE_VISIBLE||'')+')' +
      '</label>' : '') +
    '</div>';

  abrirModal('↻ Reintentar '+tipo, body, async function(){
    const hacerDrex    = document.getElementById('retryDrex')?.checked;
    const hacerChunior = document.getElementById('retryChunior')?.checked;
    cerrarModal();

    let drexOk = drexInferido === 'hecho', movChu = movChuVerificado;

    // Drex
    if(hacerDrex){
      toast('Reintentando '+tipo+' en agentes...', 'blue');
      _wdLock();
      try {
        // Re-posicionar la página de agentes en una búsqueda FRESCA del usuario
        // justo antes de cargar. Esto replica el flujo normal (buscar → cargar
        // pegados, sin gap) y evita que cargarSaldo corra sobre un estado sucio
        // que quedó de la lectura de saldo al abrir el modal (por eso antes
        // fallaba la 1ª vez y andaba la 2ª).
        const bb = await callDrex("buscarUsuario", usuario, { skipBalance: true });
        if(!bb || !bb.exists){
          toast('✗ Usuario no encontrado al reintentar en agentes', 'red');
        } else {
          const r = (tipo === 'CARGA')
            ? await callDrex("cargarSaldo", m)
            : await callDrex("retirarSaldo", m);
          if(r && r.ok !== false){ drexOk = true; toast('✓ '+tipo+' OK en agentes', 'green'); }
          else toast('✗ Agentes falló: '+(r?.message||''), 'red');
        }
      } catch(e){ toast('Error en agentes: '+(e.message||''), 'red'); }
      finally { _wdUnlock(); }
    }

    // Chunior
    if(hacerChunior && necesitaChunior){
      toast('Anotando en Chunior...', 'blue');
      try {
        const rChu = (tipo === 'CARGA')
          ? await registrarCargaEnChunior(bil.CHUNIOR_UID, m, usuario)
          : await registrarRetiroEnChunior(bil.CHUNIOR_UID, m, usuario);
        if(rChu && rChu.ok && rChu.movimientoId){ movChu = rChu.movimientoId; toast('✓ Chunior N° '+rChu.movimientoId, 'green'); }
        else toast('✗ Chunior: '+(rChu?.error||'falló'), 'red');
      } catch(e){ toast('Error Chunior: '+(e.message||''), 'red'); }
    }

    // Actualizar fila
    const chuOk = !!movChu || !necesitaChunior;
    const nuevoEstado = (drexOk && chuOk) ? 'OK' : 'ERROR';
    try {
      await supabaseClient.from('historial_ops').update({
        estado: nuevoEstado,
        chunior_movimiento_id: movChu,
        notas: 'Reintento manual ['+new Date().toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit'})+']'
      }).eq('id', historialId);
    } catch(e){ console.warn('update reintento:', e); }

    toast(nuevoEstado==='OK' ? '🎉 Reintento OK' : '⚠️ Reintento parcial', nuevoEstado==='OK'?'green':'yellow');
    // MISMO DESENLACE, MISMAS CONSECUENCIAS: la luz verde cierra la solicitud, venga del botón
    // Aprobar o del reintento. Antes el reintento movía la plata y dejaba la solicitud abierta: el
    // jugador seguía viendo su pedido sin resolver y el operador la volvía a trabajar (D-108).
    if(nuevoEstado === 'OK' && row.solicitud_id){
      await _cerrarSolicitudTrasReintento(row, tipo, monto, bil);
    }
    await cargarHistorial();
    if(movChu) _watchdogTrigger(1500);
  }, 'Ejecutar reintento');
}

async function deshacerOperacion(id, usuario, tipoOriginal, monto, bilId){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  if(!confirm("¿Revertir "+tipoOriginal+" de "+money(Number(monto))+" para "+usuario+"?")) return;

  const tipoReversion = tipoOriginal==='CARGA'?'RETIRO':'CARGA';
  const montoNum = Number(monto);
  const bil = billeteras.find(function(b){return String(b.ID_BILLETERA)===String(bilId);})||getBilleraLanding();

  toast("Procesando reversión...","blue");
  try {
    if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

    await callDrex("buscarUsuario", usuario);
    let r;
    if(tipoReversion==='CARGA') r = await callDrex("cargarSaldo", montoNum);
    else r = await callDrex("retirarSaldo", montoNum);

    const ok = r && r.ok !== false;

    // La reversión también genera su movimiento espejo en Chunior para mantener el ledger.
    let movChu = null;
    const usaChunior = !!(bil && bil.CHUNIOR_UID);
    if(ok && usaChunior){
      toast("Anotando reversión en Chunior...","blue");
      try {
        const rChu = (tipoReversion==='CARGA')
          ? await registrarCargaEnChunior(bil.CHUNIOR_UID, montoNum, usuario)
          : await registrarRetiroEnChunior(bil.CHUNIOR_UID, montoNum, usuario);
        if(rChu && rChu.ok && rChu.movimientoId){ movChu = rChu.movimientoId; toast("✓ Chunior N° "+rChu.movimientoId,"green"); }
        else toast("✗ Chunior: "+(rChu?.error||"no se generó el movimiento"),"red");
      } catch(e){ toast("Error Chunior: "+(e.message||""),"red"); }
    }

    const chuOk = !!movChu || !usaChunior;
    await supabaseClient.from("historial_ops").update({estado:"REVERTIDA"}).eq("id", id);
    await registrarEnHistorial({usuario, tipo:tipoReversion, monto:montoNum,
      billetera_id:bil?bil.ID_BILLETERA:null, billetera_nombre:bil?bil.NOMBRE_VISIBLE:null,
      origen:'MANUAL', estado:(ok&&chuOk)?'OK':'ERROR',
      notas:"Reversión de "+tipoOriginal, reversion_de:id, chunior_movimiento_id:movChu});

    if(ok && bil && bil.ID_BILLETERA) await ajustarSaldoBilletera(bil.ID_BILLETERA, tipoReversion==='CARGA'?montoNum:-montoNum);

    // Es el MISMO movimiento: si se deshace un pago de un retiro por partes, el progreso tiene que
    // retroceder. La reversión devolvía las fichas, el movimiento de Chunior y la plata a la
    // billetera, pero NO tocaba la solicitud: el retiro seguía figurando pagado y la caja mostraba
    // un progreso que ya no existía (D-105). El pago queda marcado como revertido, no se borra.
    let _sidRev = null;
    try{
      const _fila = (window._histPorId||{})[String(id)]
        || ((typeof _historialData!=='undefined' && _historialData) || []).find(function(h){ return String(h.id)===String(id); });
      if(_fila && _fila.solicitud_id) _sidRev = String(_fila.solicitud_id);
    }catch(_e){}
    if(ok && _sidRev && String(tipoOriginal||'').toUpperCase()==='RETIRO'){
      try{
        const rRev = await supabaseClient.rpc('landing_retiro_revertir_parcial', {
          p_id: Number(_sidRev), p_monto: montoNum,
          p_operador: (window.operador&&(window.operador.usuario||window.operador.nombre))||'panel',
          p_historial_id: Number(id)||null
        });
        if(rRev && rRev.error){
          toast('⚠ La plata volvió, pero el retiro #'+_sidRev+' quedó marcado como pagado · '+(rRev.error.message||'')+' · corregilo a mano','red');
        }else{
          const d = Array.isArray(rRev&&rRev.data) ? rRev.data[0] : (rRev&&rRev.data);
          toast('↩ Retiro #'+_sidRev+' volvió a quedar pendiente · falta '+money(Number((d&&d.restante)||0)),'yellow');
          try{ if(typeof cargarSolicitudesPortal==='function') await cargarSolicitudesPortal(true); }catch(_e){}
        }
      }catch(e){
        toast('⚠ La plata volvió, pero no se pudo actualizar el retiro #'+_sidRev+' · '+(e.message||'')+' · corregilo a mano','red');
      }
    }
    // Y la carga, lo mismo: es el MISMO movimiento. Si la revertida era la única que sostenía la
    // solicitud, el pedido del jugador vuelve a quedar abierto (H-3).
    if(ok && _sidRev && String(tipoOriginal||'').toUpperCase()==='CARGA'){
      await _reabrirSolicitudSiQuedoSinPagar(_sidRev, id, montoNum, usuario);
    }
    toast((ok&&chuOk)?'Reversión completada OK':'Reversión con errores — revisar',(ok&&chuOk)?'green':'red');
    await window.ctrlElectron.navigateAgent();
    await cargarHistorial();
    renderBillerasInicio();
    poblarManualBilletera();
  } catch(e) { toast("Error: "+(e.message||"sin detalle"),"red"); }
}
// ════════════════════════════════════════════════════════════════════════════
// HISTORIAL UNIFICADO + SELECCIÓN EN LOTE + BLACKLIST + CACHÉ LOCAL
// ════════════════════════════════════════════════════════════════════════════
let _seleccionLote = new Set();

// Movimientos que se hacen EN Chunior y no nacen de una solicitud del portal. Hasta ahora sólo
// se veían en el Historial de Inicio y con el tipo crudo en mayúsculas ("DEPOSITO_SR").
// Medido en 30 días: 666 movimientos de estos, de los cuales el panel mostraba 21.
// Los movimientos que se anotan EN Chunior. CONSULTA y RESET_CLAVE quedan afuera a proposito:
// no pasan por Chunior (D-38) y las consultas no hace falta ni guardarlas ni filtrarlas —
// siguen viendose en "Todas" y en el historial de Inicio, que es donde sirven.
const TIPOS_CHUNIOR = ["MOV_BILLETERA","CAMBIO_BILLETERA","DEPOSITO_SR","PROPINA","RECARGA_FICHAS"];
const _ETIQUETA_TIPO = {
  MOV_BILLETERA:    "🔀 TRANSFERENCIA",
  CAMBIO_BILLETERA: "💳 CAMBIO BILLETERA",
  DEPOSITO_SR:      "💜 DEPÓSITO S/RECLAMAR",
  PROPINA:          "🎁 PROPINA",
  RECARGA_FICHAS:   "🎰 RECARGA FICHAS",
  RESET_CLAVE:      "🔑 CAMBIO DE CLAVE",
  CONSULTA:         "🔍 CONSULTA",
  COMBINACION:      "🧩 COMBINACIÓN",
  MOVER_RETIRO:     "📦 MOVER RETIRO",
  FALTANTE:         "⚠️ FALTANTE",
  CREAR_DEPO:       "➕ CREAR DEPÓSITO",
  MANUAL:           "✋ MANUAL"
};
function _tipoEtiqueta(t){
  const k = String(t||"").toUpperCase();
  return _ETIQUETA_TIPO[k] || escapeHtml(k || "—");
}
function _esTipoChunior(t){ return TIPOS_CHUNIOR.includes(String(t||"").toUpperCase()); }
// Hay gente que deja el portal abierto, nosotros cambiamos la billetera activa, y la persona
// manda la solicitud SIN refrescar: transfirió a la billetera anterior. La solicitud llega con
// esa billetera vieja adentro, pero el operador sólo ve la activa y no se entera hasta abrir
// el desplegable. Medido: 271 cargas en 7 días (1,39 %) llegan asi.
// Sólo se avisa mientras la solicitud sigue abierta: es el momento en que sirve. En una ya
// cerrada la billetera activa cambió mil veces y el aviso seria ruido.
function _billeteraVieja(it){
  try{
    if(!it) return null;
    // Sirve para las dos formas que andan dando vueltas: el item del historial unificado
    // (claves en minúscula) y la solicitud cruda del portal (MAYÚSCULAS). Antes sólo
    // entendía la primera, así que la tarjeta del Inicio —que es donde el operador decide—
    // nunca mostraba el aviso.
    const crudo = it._raw || it;
    const tipo = String(it.tipo || it.TIPO || it.TIPO_SOLICITUD ||
                        crudo.TIPO || crudo.TIPO_SOLICITUD || "").toUpperCase();
    if(tipo !== "CARGA") return null;              // en un retiro pagamos nosotros: no aplica

    // Abierta: o lo dice el item, o se deduce del estado.
    const estado = String(it.estado || it.ESTADO || crudo.ESTADO || "").toUpperCase();
    const abierta = (it.pendiente === true) ||
      (it.pendiente === undefined && estado !== "" &&
       ["ACREDITADA","PAGADA","APROBADA","RECHAZADA","CANCELADA","CERRADA","CERRADO",
        "FINALIZADA","OK","COMPLETADA","REVERTIDA"].indexOf(estado) === -1);
    if(!abierta) return null;                      // ya cerrada: la activa cambió mil veces

    if(typeof getBilleraLanding !== "function") return null;
    const activa = getBilleraLanding();
    if(!activa) return null;

    const idSol  = String(it.billetera_id || it.ID_BILLETERA || crudo.ID_BILLETERA || "").trim();
    const nomSol = String(it.billetera_nombre || it.BILLETERA_NOMBRE || crudo.BILLETERA_NOMBRE || "").trim();
    const idAct  = String(activa.ID_BILLETERA || "").trim();
    const nomAct = String(activa.NOMBRE_VISIBLE || "").trim();
    if(!nomSol && !idSol) return null;             // sin dato no se inventa un aviso

    const mismo = (idSol && idAct) ? (idSol === idAct)
                                   : (nomSol.toUpperCase() === nomAct.toUpperCase());
    if(mismo) return null;
    return { vieja: nomSol || idSol, actual: nomAct || idAct };
  }catch(_e){ return null; }
}

window._billeteraVieja = _billeteraVieja;

function _esTipoClave(t){
 const k=String(t||"").toUpperCase(); return k==="CAMBIO_CLAVE" || k==="RESET_CLAVE"; }
// La clave nueva viaja en el metadata del portal o, en las manuales, dentro de notas como
// "clave → xxxx". En la lista es EL dato de la operación: sin eso la tarjeta mostraba un "—".
function _claveDeItem(it){
  try{
    const r = (it && it._raw) || {};
    let meta = r.METADATA !== undefined ? r.METADATA : (r.metadata || {});
    if(typeof meta === "string"){ try{ meta = JSON.parse(meta); }catch(_e){ meta = {}; } }
    const directa = String(r.PASSWORD_NUEVO || (meta && meta.password_nuevo) || "").trim();
    if(directa) return directa;
    const m = String(r.notas || r.NOTAS || "").match(/clave\s*(?:→|->|:)\s*(\S+)/i);
    return m ? m[1] : "";
  }catch(_e){ return ""; }
}

// Filas traídas por la búsqueda contra el servidor (fuera de la ventana cargada).
window._histBusquedaServidor = window._histBusquedaServidor || [];
let _histUnificadoCache = [];

function construirHistorialUnificado(){
  const items = [];
  const rawHist = (typeof _historialData !== 'undefined' && _historialData && _historialData.length)
    ? _historialData
    : ((typeof window !== 'undefined' && window._historialData) || []);
  const rawSol = (typeof solicitudes !== 'undefined' && solicitudes && solicitudes.length)
    ? solicitudes
    : ((typeof window !== 'undefined' && (window.solicitudes || (window.V154P && window.V154P.solicitudes))) || []);

  // Mapas desde historial_ops para relacionar solicitud portal ↔ operación real.
  const _saldoPrePorSolicitud = {};
  const _saldoPostPorSolicitud = {};
  const _operadorPorSolicitud = {};
  const _movPorSolicitud = {};
  const _historialIdPorSolicitud = {};
  const _historialIdSet = new Set();

  rawHist.forEach(function(h){
    if(h && h.id!=null) _historialIdSet.add(String(h.id));
    if(h.solicitud_id==null) return;
    const k = String(h.solicitud_id);
    if(h.saldo_pre!=null)  _saldoPrePorSolicitud[k]  = h.saldo_pre;
    if(h.saldo_post!=null) _saldoPostPorSolicitud[k] = h.saldo_post;
    if(h.operador) _operadorPorSolicitud[k] = h.operador;
    if(h.chunior_movimiento_id) _movPorSolicitud[k] = h.chunior_movimiento_id;
    if(h.id!=null) _historialIdPorSolicitud[k] = h.id;
  });

  rawSol.forEach(function(s){
    const tipo = normalizar(s.TIPO_SOLICITUD||s.TIPO);
    if(tipo === 'SOPORTE') return;
    const sid = String(s.ID||s.SOLICITUD_ID||s.ID_SOLICITUD||'');
    const histId = s.HISTORIAL_ID || s.historial_id || null;

    // Si la solicitud portal ya tiene una fila real en historial_ops,
    // NO pintamos la fila de landing_solicitudes porque genera duplicado:
    // una sin saldo y otra con saldo. Nos quedamos con historial_ops.
    const tieneOperacionReal = (sid && _historialIdPorSolicitud[sid]!=null) ||
                               (histId && _historialIdSet.has(String(histId)));
    if(tieneOperacionReal) return;

    items.push({
      fuente:'SOLICITUD', _raw:s,
      id: sid,
      fecha: s.FECHA_CREACION||s.FECHA||s.created_at||null,
      tipo, usuario: s.USUARIO||s.USUARIO_JUGADOR||'',
      nombre: s.NOMBRE_COMPLETO||'',
      billetera_nombre: s.BILLETERA_NOMBRE||s.NOMBRE_BILLETERA||'',
      monto: s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO||0,
      // Si la fila de historial_ops quedó fuera de la ventana cargada, el N° igual puede estar
      // en la solicitud (lo escribe la búsqueda en Chunior). Sin este respaldo se pisaba con
      // null y la ficha volvía a decir "Sin N° anotado" con el número ya guardado en la base.
      estado: s.ESTADO||'', chunior_movimiento_id: _movPorSolicitud[sid] || s.chunior_movimiento_id || null,
      billetera_id: s.ID_BILLETERA||null,
      historial_id: histId || null,
      solicitud_id: sid || null,
      // Estos tres mapas se armaban arriba y NUNCA se leian: la fila del portal salia
      // siempre sin saldos y sin operador aunque la operacion real ya estuviera anotada
      // en historial_ops. Por eso la ficha decia "No se leyeron" en cargas que si los tienen
      // (84.348 de 85.376 cargas de 30 dias tienen saldo_pre en la base).
      saldo_post: s.SALDO_POST!=null ? s.SALDO_POST : (_saldoPostPorSolicitud[sid]!=null ? _saldoPostPorSolicitud[sid] : null),
      saldo_pre: s.SALDO_PRE!=null ? s.SALDO_PRE : (_saldoPrePorSolicitud[sid]!=null ? _saldoPrePorSolicitud[sid] : null),
      operador: (s.OPERADOR && s.OPERADOR !== 'panel' ? s.OPERADOR : (_operadorPorSolicitud[sid] || '')),
      pendiente: esPendiente(s)
    });
  });

  rawHist.forEach(function(h){
    items.push({
      fuente:'OPERACION', _raw:h,
      id: h.id, fecha: h.created_at||null,
      tipo: normalizar(h.tipo), usuario: h.usuario||'', nombre:'',
      billetera_nombre: h.billetera_nombre||'',
      monto: h.monto||0, estado: h.estado||'',
      chunior_movimiento_id: h.chunior_movimiento_id||null,
      billetera_id: h.billetera_id||null, historial_id: h.id,
      solicitud_id: h.solicitud_id || null,
      saldo_post: h.saldo_post!=null ? h.saldo_post : null,
      saldo_pre: h.saldo_pre!=null ? h.saldo_pre : null,
      operador: h.operador || '',
      pendiente: false
    });
  });

  // Filas que trajo la búsqueda contra el servidor: pueden ser de otro día o de otra oficina.
  // Van marcadas para que en pantalla se vea que NO son de la ventana cargada.
  (window._histBusquedaServidor || []).forEach(function(h){
    if(h && h.id!=null && _historialIdSet.has(String(h.id))) return;   // ya está en la ventana
    items.push({
      fuente:"OPERACION", _raw:h, _remoto:true,
      id: h.id, fecha: h.created_at||null,
      tipo: normalizar(h.tipo), usuario: h.usuario||"", nombre:"",
      billetera_nombre: h.billetera_nombre||"",
      monto: h.monto||0, estado: h.estado||"",
      chunior_movimiento_id: h.chunior_movimiento_id||null,
      billetera_id: h.billetera_id||null, historial_id: h.id,
      solicitud_id: h.solicitud_id || null,
      saldo_post: h.saldo_post!=null ? h.saldo_post : null,
      saldo_pre: h.saldo_pre!=null ? h.saldo_pre : null,
      operador: h.operador || "",
      pc_codigo: h.pc_codigo || "",
      pendiente: false
    });
  });

  items.sort(function(a,b){
    // Primero lo que ESPERA una accion.
    if(!!a.pendiente !== !!b.pendiente) return a.pendiente ? -1 : 1;
    const ta = a.fecha?new Date(a.fecha).getTime():0, tb = b.fecha?new Date(b.fecha).getTime():0;
    // Pendientes: la que espera hace MAS tiempo va primero. Es una cola de trabajo, y el cliente
    // que lleva 40 minutos esperando es el urgente, no el que acaba de entrar.
    if(a.pendiente && b.pendiente) return ta - tb;
    // Lo ya cerrado es historial: lo mas nuevo arriba, como siempre.
    return tb - ta;
  });
  return items;
}

function _coincideEstadoFiltro(it, filtro){
  if(!filtro) return true;
  const e = normalizar(it.estado);
  if(filtro==="PENDIENTE")  return it.pendiente;
  if(filtro==="REALIZADAS") return esRealizada({ESTADO:it.estado}) || e==="OK";
  if(filtro==="RECHAZADA")  return e==="RECHAZADA";
  if(filtro==="ERROR")      return e==="ERROR";
  return true;
}

function _obtenerTurnoDeFecha(ts){
  if(!ts) return null;
  const d = new Date(new Date(ts).getTime() - 3 * 3600 * 1000);
  const h = d.getUTCHours();
  if(h >= 6 && h < 14) return 'TM';
  if(h >= 14 && h < 22) return 'TT';
  return 'TN';
}

// _obtenerTurnoDeFecha clasifica SOLO por hora: devuelve "TM" para las 07:30 de hoy, de ayer
// y de la semana pasada. Filtrar por "turno actual" traía entonces todo lo de esa franja de
// cualquier día — de ahí "15 cargas aprobadas en el turno" con una carga por día en la lista.
//
// Un turno es un bloque de UN día concreto. Estas funciones dan sus bordes reales, en hora
// argentina (UTC−3). El caso complicado es TN, que cruza la medianoche: a la 01:00 el turno
// noche en curso empezó AYER a las 22:00.
const _TURNO_INICIO = { TM: 6, TT: 14, TN: 22 };

function _bordesTurno(turno, ahoraMs){
  const ini = _TURNO_INICIO[String(turno||"").toUpperCase()];
  if(ini === undefined) return null;
  const MS_H = 3600 * 1000;
  const ahora = (ahoraMs == null ? Date.now() : ahoraMs);
  // Se trabaja en "hora AR corrida": se resta el huso y se razona en UTC.
  const ar = new Date(ahora - 3 * MS_H);
  const diaAR = Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate());
  let desdeAR = diaAR + ini * MS_H;
  // Si ese turno todavía no arrancó hoy, el que corresponde es el de ayer.
  if(desdeAR > ar.getTime()) desdeAR -= 24 * MS_H;
  const desde = desdeAR + 3 * MS_H;          // de vuelta a UTC real
  return { desde: desde, hasta: desde + 8 * MS_H };
}

// ¿Esta fecha cae dentro del turno indicado (el bloque concreto, no la franja)?
function _enTurno(ts, turno){
  if(!ts) return false;                      // sin fecha no se puede afirmar que sea del turno
  const b = _bordesTurno(turno);
  if(!b) return false;
  const t = new Date(ts).getTime();
  return !isNaN(t) && t >= b.desde && t < b.hasta;
}

function _turnoActual(){
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  const h = d.getUTCHours();
  if(h >= 6 && h < 14) return 'TM';
  if(h >= 14 && h < 22) return 'TT';
  return 'TN';
}

// El turno en curso ES uno de TM/TT/TN: tener ademas una opcion "turno actual" era elegir
// dos veces lo mismo. Ahora arranca en el turno que corre, marcado "· ahora" en la lista.
let _filtroTurno = _turnoActual();
function _pintarOpcionesTurno(){
  const sel = document.getElementById("filtroTurnoSelect");
  if(!sel) return;
  const hoy = _turnoActual();
  Array.prototype.forEach.call(sel.options, function(op){
    const base = op.textContent.replace(/\s*·\s*ahora$/, "");
    op.textContent = (op.value === hoy) ? (base + " · ahora") : base;
  });
  if(sel.value !== _filtroTurno) sel.value = _filtroTurno;
}

window.setSolicitudesTurno = function(turnoKey){
  _filtroTurno = turnoKey || 'ACTUAL';
  const sel = document.getElementById("filtroTurnoSelect");
  if(sel && sel.value !== _filtroTurno) sel.value = _filtroTurno;
  renderHistorialUnificado();
};

window.cycleTurno = function(){
  const order = ['ACTUAL', 'TM', 'TT', 'TN', 'TODOS'];
  const next = order[(order.indexOf(_filtroTurno) + 1) % order.length];
  window.setSolicitudesTurno(next);
};

function renderSolicitudesKpis(listaCompleta){
  const el = document.getElementById("solicitudesKpiStrip");
  const arr = Array.isArray(listaCompleta) ? listaCompleta : [];
  const turnoEfectivo = _filtroTurno === 'ACTUAL' ? _turnoActual() : _filtroTurno;

  // Antes esto comparaba la FRANJA horaria y contaba lo de esa hora de cualquier día. Y las
  // filas sin fecha entraban siempre, sumando al total sin pertenecer a ningún turno.
  const arrTurno = (turnoEfectivo === 'TODOS')
    ? arr
    : arr.filter(function(x){ return _enTurno(x.fecha, turnoEfectivo); });

  const cargas = arrTurno.filter(function(x){ return x.tipo === 'CARGA'; });
  const retiros = arrTurno.filter(function(x){ return x.tipo === 'RETIRO'; });
  const rechazos = arrTurno.filter(function(x){
    const r = (typeof window.clasificarRechazo === 'function') ? window.clasificarRechazo(x) : null;
    return r ? r.esRechazo : /RECHAZ|CANCEL/.test(String(x.estado||'').toUpperCase());
  });

  let parcialesCount = 0;
  retiros.forEach(function(x){
    try{
      const pp = window._retiroParcialInfo ? window._retiroParcialInfo(x._raw || x) : null;
      if(pp && pp.hasProg && pp.restante > 0.5) parcialesCount++;
    }catch(_e){}
  });

  if(!el) return;

  function turnoNombre(t){
    if(t === 'TM') return 'TM · Mañana';
    if(t === 'TT') return 'TT · Tarde';
    if(t === 'TN') return 'TN · Noche';
    if(t === 'TODOS') return '📅 Todo el día';
    return turnoNombre(_turnoActual());
  }
  function turnoHorario(t){
    if(t === 'TM') return '06:00 a 14:00';
    if(t === 'TT') return '14:00 a 22:00';
    if(t === 'TN') return '22:00 a 06:00';
    if(t === 'TODOS') return 'Todas las operaciones';
    return turnoHorario(_turnoActual());
  }

  el.innerHTML = `
    <div class="kpi-card purple" onclick="cycleTurno()" style="cursor:pointer" title="Hacé clic para cambiar de turno">
      <div class="kpi-head">
        <span class="kpi-title">🕒 Turno Operativo</span>
        <span class="kpi-ico">⏱️</span>
      </div>
      <div class="kpi-num" style="color:#c084fc;font-size:22px">${turnoNombre(turnoEfectivo)}</div>
      <div class="kpi-sub">${turnoHorario(turnoEfectivo)} · <i>Tocar para alternar</i></div>
    </div>

    <div class="kpi-card green" onclick="setSolicitudesFiltroRapido('CARGAS')" title="Ver cargas del turno">
      <div class="kpi-head">
        <span class="kpi-title">⬆️ Cargas Aprobadas</span>
        <span class="kpi-ico">📥</span>
      </div>
      <div class="kpi-num" style="color:#34d399">${cargas.length} <span style="font-size:13px;font-weight:600;color:#94a3b8">operaciones</span></div>
      <div class="kpi-sub">En el turno seleccionado</div>
    </div>

    <div class="kpi-card orange" onclick="setSolicitudesFiltroRapido('RETIROS')" title="Ver retiros del turno">
      <div class="kpi-head">
        <span class="kpi-title">⬇️ Retiros Procesados</span>
        <span class="kpi-ico">📤</span>
      </div>
      <div class="kpi-num" style="color:#fb923c">${retiros.length} <span style="font-size:13px;font-weight:600;color:#94a3b8">retiros</span></div>
      <div class="kpi-sub">${parcialesCount ? `<b>${parcialesCount}</b> parciales · ` : ''}En el turno seleccionado</div>
    </div>

    <div class="kpi-card red" onclick="setSolicitudesFiltroRapido('RECHAZADAS')" title="Ver solicitudes rechazadas del turno">
      <div class="kpi-head">
        <span class="kpi-title">⛔ Rechazos</span>
        <span class="kpi-ico">🚫</span>
      </div>
      <div class="kpi-num" style="color:#f87171">${rechazos.length} <span style="font-size:13px;font-weight:600;color:#94a3b8">incidentes</span></div>
      <div class="kpi-sub">Rechazos en este turno</div>
    </div>
  `;
}

window.setSolicitudesFiltroRapido = function(modo){
  const elEstado = document.getElementById("filtroEstado");
  const elTipo = document.getElementById("filtroTipo");
  const elTexto = document.getElementById("filtroTexto");
  if(elTexto) elTexto.value = "";

  const tabMap = {
    'TODAS': 'tabFiltroTodas',
    'CARGAS': 'tabFiltroCargas',
    'RETIROS': 'tabFiltroRetiros',
    'RECHAZADAS': 'tabFiltroRechazadas',
    'CHUNIOR': 'tabFiltroChunior'
  };
  ['tabFiltroTodas', 'tabFiltroCargas', 'tabFiltroRetiros', 'tabFiltroRechazadas', 'tabFiltroChunior'].forEach(function(tid){
    const tabEl = document.getElementById(tid);
    if(tabEl) tabEl.classList.toggle('active', tid === tabMap[modo]);
  });

  if(modo === 'TODAS'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "";
  } else if(modo === 'CARGAS'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "CARGA";
  } else if(modo === 'RETIROS'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "RETIRO";
  } else if(modo === 'RECHAZADAS'){
    if(elEstado) elEstado.value = "RECHAZADA";
    if(elTipo) elTipo.value = "";
  } else if(modo === 'CHUNIOR'){
    if(elEstado) elEstado.value = "";
    if(elTipo) elTipo.value = "__CHUNIOR__";
    // Son ~3 por dia por oficina: filtrarlos ademas por turno los deja casi siempre en cero.
    _filtroTurno = "TODOS";
    const _selT = document.getElementById("filtroTurnoSelect");
    if(_selT) _selT.value = "TODOS";
  }
  renderHistorialUnificado();
};

window.limpiarFiltrosSolicitudes = function(){
  ["filtroEstado","filtroTipo","filtroFuente","filtroMotivoRechazo","filtroTexto"].forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.value = "";
  });
  _filtroTurno = _turnoActual();
  const selTurno = document.getElementById("filtroTurnoSelect");
  if(selTurno) selTurno.value = _filtroTurno;
  window._histBusquedaServidor = [];
  const tabTodas = document.getElementById("tabFiltroTodas");
  if(tabTodas) tabTodas.click();
  else renderHistorialUnificado();
};

let _solicitudActivaId = null;
// Clave de cada tarjeta. Una fila de historial_ops va por SU id ("h" + id): un retiro pagado en
// partes tiene varias filas con la misma solicitud, y con la clave por solicitud eran la misma
// tarjeta — tocabas cualquiera y se abría la última (Juan, 12/09). Las del portal siguen igual.
function _claveStream(it){
  if(it && it.fuente === 'OPERACION') return 'h' + String(it.historial_id || it.id || '');
  return String((it && (it.solicitud_id || it.historial_id || it.id)) || '');
}
window._claveStream = _claveStream;
// Qué parte de un retiro por partes es esta fila ("Parte 2 de 2 · #207577"), o si es el cierre,
// que se registra con $0 y sin eso se leía "RETIRO de $0".
function _parteRetiro(it){
  try{
    if(String((it && it.tipo) || '').toUpperCase() !== 'RETIRO' || !it.solicitud_id) return null;
    const raw = it._raw || {};
    const sid = String(it.solicitud_id);
    const H = (typeof _historialData !== 'undefined' && _historialData && _historialData.length)
      ? _historialData : (window._historialData || []);
    const partes = H.filter(function(h){
      return String(h.solicitud_id || '') === sid && String(h.tipo || '').toUpperCase() === 'RETIRO'
        && Number(h.monto || 0) > 0 && String(h.estado || '').toUpperCase() !== 'ERROR';
    }).sort(function(a, b){ return new Date(a.created_at) - new Date(b.created_at); });
    if(Number(it.monto || 0) === 0 && /^Cierre de retiro parcial/i.test(String(raw.notas || '')))
      return { cierre: true, sid: sid, n: partes.length };
    if(partes.length < 2 && !/PARCIAL/.test(String(raw.notas || ''))) return null;
    const i = partes.findIndex(function(h){ return String(h.id) === String(it.historial_id || it.id); });
    return { cierre: false, sid: sid, i: i + 1, n: partes.length };
  }catch(_e){ return null; }
}
window._parteRetiro = _parteRetiro;
window._parteRetiroTxt = function(pr){
  return pr ? ('💸 ' + (pr.cierre ? 'Cierre del retiro' : ('Parte ' + (pr.i > 0 ? pr.i : '?') + ' de ' + pr.n)) + ' · #' + pr.sid) : '';
};

function renderSolicitudesStream(lista){
  const streamEl = document.getElementById("solicitudesStreamList");
  if(!streamEl) return;
  if(!lista || !lista.length){
    streamEl.innerHTML = `
      <div class="sol-empty-dossier" style="padding:30px 15px">
        <span style="font-size:32px;margin-bottom:8px">🔍</span>
        <h4 style="color:#cbd5e1;font-size:14px;margin:0 0 4px 0">Sin movimientos en la ventana cargada</h4>
        <p style="font-size:11px;color:#64748b">${_textoBuscado()
          ? 'Nada con ese texto en lo que está cargado. Buscalo en todo el historial 👇'
          : 'Probá cambiar los filtros, ampliar el período o consultar otro turno.'}</p>
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px">
          ${_textoBuscado() ? `<button type="button" class="mini-btn green" onclick="buscarHistorialServidor()" style="font-size:11px">🔎 Buscar en todo el historial</button>` : ''}
          <button type="button" class="mini-btn gray" onclick="limpiarFiltrosSolicitudes()" style="font-size:11px">Limpiar filtros</button>
        </div>
      </div>`;
    const dossierPane = document.getElementById("solicitudesDossierPane");
    if(dossierPane){
      dossierPane.innerHTML = `
        <div class="sol-empty-dossier">
          <span class="sol-empty-icon">📂</span>
          <h3>Sin solicitud seleccionada</h3>
          <p>No hay movimientos que coincidan con los filtros seleccionados.</p>
        </div>`;
    }
    return;
  }

  // Auto-seleccionar primer elemento
  const tieneActiva = _solicitudActivaId && lista.some(function(it){
    return _claveStream(it) === String(_solicitudActivaId);
  });
  if(!tieneActiva){
    _solicitudActivaId = _claveStream(lista[0]);
  }

  let html = '';
  lista.forEach(function(it){
    const selId = _claveStream(it);
    const loteId = String(it.historial_id || it.id || '');   // el lote va por fila de historial, igual que en la tabla
    const isActive = String(selId) === String(_solicitudActivaId);
    const checked = _seleccionLote.has(loteId);
    const seleccionable = it.fuente === 'OPERACION' && it.chunior_movimiento_id;

    const u = it.usuario || 'JU';
    const initials = (u.slice(0, 2) || 'JU').toUpperCase();
    const esRetiro = it.tipo === 'RETIRO';
    const esCarga = it.tipo === 'CARGA';
    const tipoClass = esRetiro ? 'retiro' : (esCarga ? 'carga' : 'other');

    const r = (typeof window.clasificarRechazo === 'function') ? window.clasificarRechazo(it) : null;
    const esRech = r ? r.esRechazo : /RECHAZ|CANCEL/.test(String(it.estado||'').toUpperCase());
    let avatarClass = esRech ? 'rechazo' : tipoClass;

    let timeHtml = formatFecha(it.fecha);
    let montoHtml = it.monto ? money(it.monto) : '—';
    if(_esTipoClave(it.tipo)){
      const _cl = _claveDeItem(it);
      montoHtml = _cl
        ? '<span style="font-family:ui-monospace,monospace;color:#facc15;font-size:15px">🔑 ' + escapeHtml(_cl) + '</span>'
        : '<span style="color:#f87171;font-size:13px">sin clave</span>';
    }
    let parcialMini = '';
    if(esRetiro){
      const pp = (typeof window._retiroParcialInfo === 'function') ? window._retiroParcialInfo(it._raw || it) : null;
      if(pp && pp.hasProg){
        const pct = Math.min(100, Math.round((pp.pagado / (pp.total || 1)) * 100));
        montoHtml = money(pp.total);
        parcialMini = `
          <div style="margin-top:5px">
            <div style="display:flex;justify-content:space-between;font-size:9.5px;color:#c084fc;font-weight:700;margin-bottom:2px">
              <span>Parcial ${pct}% (Pagado ${money(pp.pagado)})</span>
              <span>Resta: ${money(pp.restante)}</span>
            </div>
            <div class="sol-mini-prog" style="max-width:100%"><span style="width:${pct}%"></span></div>
          </div>`;
      }
    }

    // Un retiro pagado en partes: qué parte es esta fila, o el cierre.
    const _pr = it.fuente === 'OPERACION' ? _parteRetiro(it) : null;
    if(_pr){
      if(_pr.cierre) montoHtml = '<span style="font-size:13px;color:#c4b5fd">🔒 Cierre</span>';
      parcialMini += `<div style="margin-top:4px;font-size:10px;font-weight:800;color:#c084fc">${escapeHtml(window._parteRetiroTxt(_pr))}</div>`;
    }

    // Va ARRIBA del todo en la tarjeta: es lo que decide a qué billetera mirar.
    let bilPill = '';
    const _bv = _billeteraVieja(it);
    if(_bv){
      bilPill = `
        <div style="margin-top:5px;display:flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:#fbbf24;background:rgba(245,158,11,.12);padding:3px 6px;border-radius:6px;border:1px solid #f59e0b55">
          <span>⚠</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Pagó a ${escapeHtml(_bv.vieja)} · ahora ${escapeHtml(_bv.actual)}</span>
        </div>`;
    }

    let diagPill = '';
    if(esRech){
      const badge = (r && r.badge) ? r.badge : 'Rechazada';
      const col = (r && r.color) ? r.color : '#ef4444';
      const bg = (r && r.bg) ? r.bg : 'rgba(239, 68, 68, 0.12)';
      diagPill = `
        <div style="margin-top:5px;display:flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:${col};background:${bg};padding:3px 6px;border-radius:6px;border:1px solid ${col}44">
          <span>⛔</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(badge)}</span>
        </div>`;
    }

    const chkHtml = seleccionable ? `
      <input type="checkbox"${checked ? ' checked' : ''} onclick="event.stopPropagation();toggleSeleccionLote('${escapeHtml(loteId)}', this.checked)" style="width:15px;height:15px;cursor:pointer;margin-right:6px">
    ` : '';

    const esManual = it.fuente === 'OPERACION';
    const esChu = _esTipoChunior(it.tipo);
    const origenTxt = esManual ? (esChu ? 'Chunior' : 'Manual') : 'Portal';
    // Lo que trajo la busqueda contra el servidor puede ser de otro dia o de otra oficina.
    const remotoTag = it._remoto
      ? `<span class="sol-mov-tag" style="background:rgba(192,132,252,.14);color:#c084fc;border-color:#c084fc44" title="Fuera de la ventana cargada">📅 ${escapeHtml(formatFecha(it.fecha))}${it.pc_codigo ? ' · ' + escapeHtml(it.pc_codigo) : ''}</span>`
      : '';

    html += `
      <div id="solCard-${escapeHtml(selId)}" class="sol-card-item${isActive ? ' is-active' : ''}${checked ? ' is-selected-lote' : ''}" onclick="seleccionarSolicitudStream('${escapeHtml(selId)}')">
        <div class="sol-card-head">
          <div class="sol-card-user-row">
            ${chkHtml}
            <div class="sol-avatar ${avatarClass}">${escapeHtml(initials)}</div>
            <div style="min-width:0">
              <div class="sol-card-username" title="${escapeHtml(it.usuario || '')}">${escapeHtml(it.usuario || 'Sin usuario')}</div>
              <div class="sol-card-time">${timeHtml}</div>
            </div>
          </div>
          <div style="text-align:right">
            <span class="sol-pill-type ${tipoClass}">${esRetiro ? '⬇️ RETIRO' : (esCarga ? '⬆️ CARGA' : _tipoEtiqueta(it.tipo))}</span>
          </div>
        </div>

        <div class="sol-card-amount-row">
          <div class="sol-card-amount ${tipoClass}">${montoHtml}</div>
          <div style="font-size:11px;color:#94a3b8">${escapeHtml(it.billetera_nombre || '')}</div>
        </div>

        ${parcialMini}
        ${bilPill}
        ${diagPill}

        <div class="sol-card-details-box">
          <div class="sol-card-meta-line">
            <span class="sol-origin-badge ${esManual ? 'manual' : 'portal'}">${origenTxt}</span>
            ${it.chunior_movimiento_id ? `<span class="sol-mov-tag">N° ${escapeHtml(it.chunior_movimiento_id)}</span>` : ''}
            ${remotoTag}
          </div>
        </div>
      </div>
    `;
  });

  streamEl.innerHTML = html;
  actualizarDossierActivo(lista);
}

function _textoBuscado(){
  return String((document.getElementById("filtroTexto")||{}).value||"").trim();
}

// Busqueda contra el SERVIDOR, no contra las filas ya cargadas.
// Sin esto el buscador prometia "N° de movimiento" pero solo miraba la ventana en memoria:
// un numero de ayer no aparecia nunca, y eso es justo lo que hace falta para cotejar.
// Un numero de movimiento se busca en TODAS las oficinas a proposito: el numero es de Chunior,
// no de la PC, y cuando se cotea no siempre se sabe en que oficina se cargo.
window.buscarHistorialServidor = async function(){
  const texto = _textoBuscado();
  if(texto.length < 3){ try{ toast("Escribí al menos 3 caracteres para buscar.","yellow"); }catch(_e){} return; }
  const streamEl = document.getElementById("solicitudesStreamList");
  if(streamEl) streamEl.innerHTML = '<div class="sol-empty-dossier" style="padding:30px 15px">Buscando en todo el historial…</div>';
  const soloDigitos = /^[0-9]+$/.test(texto);
  try{
    let q = supabaseClient.from("historial_ops").select("*").order("created_at",{ascending:false}).limit(300);
    if(soloDigitos){
      q = q.or("chunior_movimiento_id.eq." + texto + ",solicitud_id.eq." + texto);
    }else{
      q = q.ilike("usuario", "%" + texto + "%");
    }
    const { data, error } = await q;
    if(error) throw error;
    window._histBusquedaServidor = data || [];
    const n = window._histBusquedaServidor.length;
    try{ toast(n ? (n + " resultado" + (n===1?"":"s") + " en todo el historial") : "No hay nada con \"" + texto + "\" en el historial completo.", n ? "green" : "orange"); }catch(_e){}
  }catch(e){
    window._histBusquedaServidor = [];
    try{ toast("Error buscando: " + (e.message||e), "red"); }catch(_e){}
  }
  renderHistorialUnificado();
};

function actualizarDossierActivo(lista){

  const dossierPane = document.getElementById("solicitudesDossierPane");
  if(!dossierPane) return;
  if(!_solicitudActivaId){
    dossierPane.innerHTML = `
      <div class="sol-empty-dossier">
        <span class="sol-empty-icon">📂</span>
        <h3>Seleccioná una solicitud</h3>
        <p>Hacé clic en cualquier tarjeta de la izquierda para ver el detalle completo de la operación o solicitud.</p>
      </div>`;
    return;
  }
  if(typeof window.mostrarExpedienteEnPane === 'function'){
    window.mostrarExpedienteEnPane(_solicitudActivaId);
  }
}

window.seleccionarSolicitudStream = function(id){
  _solicitudActivaId = String(id);
  const streamEl = document.getElementById("solicitudesStreamList");
  if(streamEl){
    streamEl.querySelectorAll(".sol-card-item").forEach(function(card){
      card.classList.remove("is-active");
    });
    const targetCard = document.getElementById("solCard-" + id);
    if(targetCard) targetCard.classList.add("is-active");
  }
  actualizarDossierActivo(_histUnificadoCache);
};

function renderHistorialUnificado(){
  const estado = val("filtroEstado"), tipo = val("filtroTipo"),
        fuente = val("filtroFuente"), texto = normalizar(val("filtroTexto"));

  let listaCompleta = construirHistorialUnificado();
  renderSolicitudesKpis(listaCompleta);

  const turnoEfectivo = _filtroTurno === 'ACTUAL' ? _turnoActual() : _filtroTurno;
  _pintarOpcionesTurno();
  let lista = listaCompleta.slice();

  // Filtrar por turno. Con una busqueda del servidor activa NO se filtra: el operador pidio
  // expresamente algo de otro dia, esconderlo por turno seria devolverle una lista vacia.
  const _hayBusquedaRemota = (window._histBusquedaServidor || []).length > 0;
  if(turnoEfectivo !== 'TODOS' && !_hayBusquedaRemota){
    lista = lista.filter(function(it){ return _enTurno(it.fecha, turnoEfectivo); });
  }

  if(fuente) lista = lista.filter(function(it){ return it.fuente===fuente; });
  if(tipo === "__CHUNIOR__") lista = lista.filter(function(it){ return _esTipoChunior(it.tipo); });
  else if(tipo) lista = lista.filter(function(it){ return it.tipo===tipo; });
  if(estado) lista = lista.filter(function(it){ return _coincideEstadoFiltro(it, estado); });

  if(texto){
    lista = lista.filter(function(it){
      const u = it.usuario || '';
      const nom = it.nombre || (it._raw && (it._raw.titular || it._raw.NOMBRE_COMPLETO)) || '';
      const bil = it.billetera_nombre || '';
      const mov = String(it.chunior_movimiento_id || (it._raw && (it._raw.chunior_movimiento_id || it._raw.movimiento_id)) || '');
      const sid = String(it.solicitud_id || it.id || '');
      const dest = String((it._raw && (it._raw.destino || it._raw.DESTINO || it._raw.cbu || it._raw.CBU)) || '');
      const tel = String((it._raw && (it._raw.telefono || it._raw.TELEFONO)) || '');
      const blob = normalizar(`${u} ${nom} ${bil} ${mov} ${sid} ${dest} ${tel}`);
      return blob.includes(texto);
    });
  }

  // Decir SIEMPRE que ventana se esta mirando. Lo que no esta cargado no existe para los
  // filtros ni para el buscador, y el operador tiene que saberlo antes de concluir "no esta".
  try{
    const _inf = document.getElementById("histVentanaInfo");
    if(_inf && typeof _histVentana === "function"){
      const _v = _histVentana();
      const _rem = (window._histBusquedaServidor || []).length;
      _inf.textContent = _rem
        ? ("🔎 " + _rem + " del historial completo")
        : ("Cargadas últimas " + _v.horas + " h · " + listaCompleta.length + " movimientos");
      _inf.title = _rem
        ? "Resultados traídos del servidor, fuera de la ventana cargada. Limpiá la búsqueda para volver."
        : "Sólo se filtra sobre lo cargado. Para ver más atrás, ampliá el período o usá la búsqueda en todo el historial.";
    }
  }catch(_e){}

  _histUnificadoCache = lista;
  // El expediente (operation-modal) busca la fila en window._histUnificadoCache. Como esto
  // es un `let` de script clasico, NUNCA estuvo en window: por eso las tarjetas que no son
  // del portal (manuales y las de Chunior) abrian "Solicitud no seleccionada" y quedaban
  // como filas muertas.
  try{ window._histUnificadoCache = lista; }catch(_e){}
  _guardarHistorialLocal();
  renderSolicitudesStream(lista);
  setBox("tablaSolicitudesCompleta", tablaHistorialUnificadoHTML(lista));
  actualizarBarraLote();
}

function tablaHistorialUnificadoHTML(lista){
  if(!lista.length) return `<div class="alert-box">No hay movimientos para mostrar con los filtros seleccionados.</div>`;
  function fuentePill(f){
    return f==='SOLICITUD'
      ? '<span class="origen-pill op-panel">Portal</span>'
      : '<span class="origen-pill op-manual">Operación</span>';
  }
  function tipoIco(t){
    if(t==='CARGA') return '⬆️'; if(t==='RETIRO') return '⬇️';
    if(t==='CAMBIO_CLAVE'||t==='RESET_CLAVE') return '🔑'; if(t==='CONSULTA') return '👁'; return '➡️';
  }
  const haySeleccionables = lista.some(function(it){ return it.fuente==='OPERACION' && it.chunior_movimiento_id; });
  const chkHead = haySeleccionables
    ? `<input type="checkbox" id="histCheckAll" onchange="toggleSeleccionTodos(this.checked)" title="Seleccionar / deseleccionar todos">`
    : '';
  const _nPend = lista.filter(function(it){ return !!it.pendiente; }).length;
  let html = _nPend
    ? `<div style="margin-bottom:7px;padding:7px 11px;border-radius:9px;background:rgba(245,197,24,.10);border:1px solid rgba(245,197,24,.45);font-size:12.5px;font-weight:800;color:#f5c518">⚡ ${_nPend} solicitudes esperando atención · haz clic en cualquier fila para ver el expediente completo</div>`
    : `<div style="margin-bottom:7px;padding:7px 11px;border-radius:9px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.35);font-size:12.5px;font-weight:700;color:#22c55e">✓ Bandeja al día · Haz clic en cualquier fila para inspeccionar el expediente</div>`;
  html += `<div class="small" style="color:var(--muted);margin-bottom:6px">💡 Haz clic en una fila para ver el <b>Expediente Completo</b> con WhatsApp, billeteras / comprobantes y auditoría de rechazo.</div>`;
  html += `<div class="table-wrap"><table><thead><tr>`+
    `<th style="width:30px;text-align:center">${chkHead}</th><th>Fecha</th><th>Origen</th><th>Tipo</th><th>Usuario</th>`+
    `<th>Billetera</th><th>Monto</th><th>N° Mov / Destino</th><th>Estado & Diagnóstico</th><th>Acciones</th></tr></thead><tbody>`;
  let _corteHecho = false;
  lista.forEach(function(it){
    if(_nPend && !it.pendiente && !_corteHecho){
      _corteHecho = true;
      html += `<tr><td colspan="10" style="padding:6px 8px;border-top:0">`
            + `<div style="display:flex;align-items:center;gap:9px;color:#6b7688;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em">`
            +   `<span style="flex:1;height:1px;background:#2c3444"></span>ya procesado<span style="flex:1;height:1px;background:#2c3444"></span>`
            + `</div></td></tr>`;
    }
    const seleccionable = it.fuente==='OPERACION' && it.chunior_movimiento_id;
    const selId = String(it.historial_id||it.id||'');
    const checked = seleccionable && _seleccionLote.has(selId);
    const chk = seleccionable
      ? `<input type="checkbox"${checked?' checked':''} onchange="toggleSeleccionLote('${escapeHtml(selId)}', this.checked)" style="width:16px;height:16px;cursor:pointer">`
      : '';

    // Destino / N° Mov
    let movTd = it.chunior_movimiento_id ? `<span class="exp-code-pill" style="color:#86efac;border-color:#14532d">N° ${escapeHtml(String(it.chunior_movimiento_id))}</span>` : '<span class="small" style="color:var(--muted)">—</span>';
    const cbuDest = (it._raw && (it._raw.destino || it._raw.cbu || it._raw.DESTINO || it._raw.CBU)) || '';
    if(it.tipo === 'RETIRO' && cbuDest){
      movTd = `<div style="display:flex;align-items:center;gap:5px">
        <span style="font-family:ui-monospace,monospace;font-size:11px">${escapeHtml(cbuDest.length > 15 ? cbuDest.slice(0,14)+'…' : cbuDest)}</span>
        <button type="button" class="mini-btn gray" style="padding:1px 5px;font-size:10px" onclick="event.stopPropagation();portalCopiarCbu(this)" data-valor="${escapeHtml(cbuDest)}" title="Copiar CBU/Alias">📋</button>
      </div>`;
    }

    const rowAttrs = ` id="histRow-${escapeHtml(selId)}" class="sol-row${checked?' is-selected':''}" onclick="if(!event.target.closest('button,input,a'))abrirExpedienteSolicitud('${escapeHtml(_claveStream(it))}')"` + (checked ? ` style="background:#1c2740"` : ``);
    const esRetiroOp = it.fuente==='OPERACION' && it.tipo==='RETIRO';
    const yaExcluido = it._raw && /\[BL_EXCLUIDO\]/.test(String(it._raw.notas||''));
    const blBtn = esRetiroOp
      ? (yaExcluido
          ? `<button class="mini-btn gray" onclick="event.stopPropagation();reincluirRetiroBlacklist('${escapeHtml(selId)}')" style="font-size:10px" title="Volver a contar en blacklist">↩ En blacklist</button>`
          : `<button class="mini-btn yellow" onclick="event.stopPropagation();excluirRetiroBlacklist('${escapeHtml(selId)}')" style="font-size:10px" title="No contar en blacklist 24hs">🚫 Quitar BL</button>`)
      : '';
    const _accU = it.tipo==='RETIRO' ? '#fb923c' : it.tipo==='CARGA' ? '#22c55e' : '';

    // Acciones de solicitud
    let solBtns = `<button class="mini-btn" style="background:#1e293b;color:#93c5fd;border:1px solid rgba(147,197,253,.4);font-size:10px;padding:3px 8px" onclick="event.stopPropagation();abrirExpedienteSolicitud('${escapeHtml(_claveStream(it))}')" title="Ver expediente detallado">🔎 Ver</button>`;
    if(it.fuente==='SOLICITUD'){
      const _sid = String(it.solicitud_id || it.id || '');
      const _estS = String(it.estado||'').toUpperCase();
      const _pend = !_estS || ['PENDIENTE','EN_PROCESO','EN_REVISION','TOMADA','ERROR_OPERATIVO'].includes(_estS);
      if(_sid && _pend){
        solBtns = `<button class="mini-btn yellow" onclick="event.stopPropagation();v154pTomarSolicitud('${escapeHtml(_sid)}')" style="font-size:10px">Tomar</button>`
          + `<button class="mini-btn green" onclick="event.stopPropagation();v154pCrearJobSolicitud('${escapeHtml(_sid)}')" style="font-size:10px">Aprobar</button>`
          + (it.tipo==='RETIRO' ? `<button class="mini-btn blue" onclick="event.stopPropagation();v154pRegistrarParcial('${escapeHtml(_sid)}')" style="font-size:10px">💸 Parcial</button>` : '')
          + `<button class="mini-btn" style="background:#1e293b;color:#93c5fd;border:1px solid rgba(147,197,253,.4);font-size:10px;padding:3px 8px" onclick="event.stopPropagation();abrirExpedienteSolicitud('${escapeHtml(_sid)}')" title="Ver expediente detallado">🔎 Ver</button>`
          + `<button class="mini-btn red" onclick="event.stopPropagation();v154pRechazarSolicitud('${escapeHtml(_sid)}')" style="font-size:10px">Rechazar</button>`;
      }
    }

    // Teléfono
    const tel = (it._raw && (it._raw.telefono || it._raw.TELEFONO)) || '';

    // Diagnóstico y Estado
    const r = (typeof window.clasificarRechazo === 'function') ? window.clasificarRechazo(it) : null;
    let estadoColHtml = estadoBadge(it.estado);
    if(r){
      estadoColHtml = `<div style="display:flex;flex-direction:column;gap:3px">
        ${estadoBadge(it.estado)}
        <span class="sol-rej-pill" style="color:${r.color};background:${r.bg};border:1px solid ${r.color}55" title="${escapeHtml(r.titulo)}">
          ${r.icono} ${escapeHtml(r.badge)}
        </span>
      </div>`;
    }

    // Monto con progreso parcial si aplica
    let montoCell = it.monto ? money(it.monto) : '—';
    if(it.tipo === 'RETIRO'){
      const pp = (typeof window._retiroParcialInfo === 'function') ? window._retiroParcialInfo(it._raw || it) : null;
      if(pp && pp.hasProg){
        const pct = Math.min(100, Math.round((pp.pagado / (pp.total || 1)) * 100));
        montoCell = `<div>${money(pp.restante)}<div class="sol-mini-prog" title="Pagado ${money(pp.pagado)} de ${money(pp.total)}"><span style="width:${pct}%"></span></div><div style="font-size:9.5px;color:#c084fc;font-weight:700">Parcial ${pct}%</div></div>`;
      }
    }

    html += `<tr${rowAttrs}>`+
      `<td style="text-align:center">${chk}</td>`+
      `<td style="font-size:12px;white-space:nowrap">${formatFecha(it.fecha)}</td>`+
      `<td>${fuentePill(it.fuente)}</td>`+
      `<td style="white-space:nowrap${_accU?';color:'+_accU+';font-weight:800':''}">${tipoIco(it.tipo)} ${escapeHtml(it.tipo||'—')}${yaExcluido?' <span class="small" style="color:#e6a028">🚫</span>':''}</td>`+
      `<td><b>${escapeHtml(it.usuario||'—')}</b>${it.nombre?'<br><span class="small" style="color:#94a3b8">'+escapeHtml(it.nombre)+'</span>':''}${tel?`<br><span class="small" style="color:#60a5fa">📱 ${escapeHtml(tel)}</span>`:''}</td>`+
      `<td style="font-size:12px">${escapeHtml(it.billetera_nombre||'—')}</td>`+
      `<td style="font-weight:700${_accU?';color:'+_accU:''}">${montoCell}</td>`+
      `<td style="font-size:12px">${movTd}</td>`+
      `<td>${estadoColHtml}</td>`+
      `<td style="white-space:nowrap"><div style="display:flex;gap:4px;flex-wrap:wrap">${solBtns}${blBtn}</div></td>`+
      `</tr>`+
      (function(){
        const _crudo = String((it._raw && it._raw.notas) || it.notas || '').replace(/\[BL_EXCLUIDO\]/g,'').trim();
        const _ctxN = _errParse(_crudo);
        const _n = _ctxN
          ? ((_errEtiqueta(_crudo) ? ('❌ ' + _errEtiqueta(_crudo) + (_errTextoLimpio(_crudo) ? ' · ' : '')) : '') + _errTextoLimpio(_crudo))
          : _crudo;
        if(!_n) return '';
        const _e = String(it.estado||'').toUpperCase();
        const _malo = /RECHAZ|ERROR|CANCEL/.test(_e);
        let _btnErr = '';
        try{
          if(_malo && it._raw && it._raw.id){
            window._histPorId[String(it._raw.id)] = it._raw;
            _btnErr = ' <button type="button" onclick="event.stopPropagation();verDetalleError(&#39;'+escapeHtml(String(it._raw.id))+'&#39;)"'
              + ' title="Por qué falló: contexto completo, paso a paso y detalle técnico"'
              + ' style="background:transparent;border:1px solid #7a5a1d;color:#e3b341;border-radius:6px;font-size:10px;padding:1px 6px;cursor:pointer;margin-left:6px">🔎 detalle técnico</button>';
          }
        }catch(_e2){}
        return `<tr class="hist-nota"><td style="border-top:0"></td>`
          + `<td colspan="9" style="border-top:0;padding:0 8px 7px 8px">`
          + `<div style="font-size:11px;line-height:1.4;color:${_malo?'#e3b341':'#8b949e'};`
          + `border-left:2px solid ${_malo?'#7a5a1d':'#2c3444'};padding-left:8px">`
          + escapeHtml(_n) + _btnErr + `</div></td></tr>`;
      })();
  });
  html += `</tbody></table></div>`;
  return html;
}

function _pintarFilaSeleccion(selId){
  const row = document.getElementById("histRow-"+selId);
  if(!row) return;
  const sel = _seleccionLote.has(String(selId));
  row.style.background = sel ? '#1c2740' : '';
  const cb = row.querySelector('input[type=checkbox]');
  if(cb) cb.checked = sel;
}
function toggleSeleccionLote(historialId, checked){
  const id = String(historialId);
  if(checked===undefined) checked = !_seleccionLote.has(id);
  if(checked) _seleccionLote.add(id); else _seleccionLote.delete(id);
  _pintarFilaSeleccion(id);
  actualizarBarraLote();
}
function toggleSeleccionTodos(checked){
  (_histUnificadoCache||[]).forEach(function(it){
    if(it.fuente!=='OPERACION' || !it.chunior_movimiento_id) return;
    const id = String(it.historial_id||it.id||'');
    if(checked) _seleccionLote.add(id); else _seleccionLote.delete(id);
    _pintarFilaSeleccion(id);
  });
  actualizarBarraLote();
}
function limpiarSeleccionLote(){
  const prev = Array.from(_seleccionLote);
  _seleccionLote.clear();
  prev.forEach(_pintarFilaSeleccion);
  const all = document.getElementById("histCheckAll"); if(all) all.checked = false;
  actualizarBarraLote();
}
function actualizarBarraLote(){
  const barra = document.getElementById("barraLoteBilletera");
  const info  = document.getElementById("loteSeleccionInfo");
  const n = _seleccionLote.size;
  if(barra){ barra.classList.toggle("hidden", n===0); if(n>0) barra.style.display='flex'; else barra.style.display=''; }
  if(info)  info.textContent = n+" seleccionado"+(n!==1?"s":"");
  const all = document.getElementById("histCheckAll");
  if(all){
    const totalSel = (_histUnificadoCache||[]).filter(function(it){ return it.fuente==='OPERACION' && it.chunior_movimiento_id; }).length;
    all.checked = totalSel>0 && n>=totalSel;
  }
}

// ── Blacklist 24h ────────────────────────────────────────────────────────────
async function excluirRetiroBlacklist(historialId){
  const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
  if(!h){ toast("No se encontró el retiro.", "red"); return; }
  if(/\[BL_EXCLUIDO\]/.test(String(h.notas||''))){ toast("Ya estaba excluido.", "blue"); return; }
  const nuevasNotas = (String(h.notas||'').trim() + ' [BL_EXCLUIDO]').trim();
  const { error } = await supabaseClient.from("historial_ops").update({ notas: nuevasNotas }).eq("id", h.id);
  if(error){ toast("Error al excluir: "+(error.message||''), "red"); return; }
  h.notas = nuevasNotas;
  toast("🚫 Retiro excluido de la blacklist.", "green");
  renderHistorialUnificado();
}
async function reincluirRetiroBlacklist(historialId){
  const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
  if(!h){ toast("No se encontró el retiro.", "red"); return; }
  const nuevasNotas = String(h.notas||'').replace(/\s*\[BL_EXCLUIDO\]/g,'').trim();
  const { error } = await supabaseClient.from("historial_ops").update({ notas: nuevasNotas }).eq("id", h.id);
  if(error){ toast("Error: "+(error.message||''), "red"); return; }
  h.notas = nuevasNotas;
  toast("↩ Retiro vuelve a contar en la blacklist.", "blue");
  renderHistorialUnificado();
}

// Modal de la Blacklist 24hs — TODOS los usuarios con retiro en las últimas 24hs (todas las
// oficinas, sin filtrar por pcOperativa: buscamos reincidencia CRUZADA entre oficinas), agrupados
// y ordenados por reincidencia. Adoptado del NODO hermano (2026-07-02).
async function mostrarBlacklist24h(dias, diaISO){
  const modoDia = !!(diaISO && /^\d{4}-\d{2}-\d{2}$/.test(String(diaISO)));
  const _dias = Math.max(1, Number(dias)||1);
  window._blState = { dias:_dias, diaISO: modoDia ? String(diaISO) : '' };
  const _lbl = modoDia ? ('día '+String(diaISO)) : (_dias===1 ? 'últimas 24hs' : ('últimos '+_dias+' días'));
  abrirModal('🚫 Blacklist · retiros dobles · '+_lbl,
    '<div style="padding:8px 0;color:var(--muted)">Cargando retiros ('+_lbl+')...</div>', null, 'Cerrar');
  const _sb = document.getElementById('modalSaveBtn'); if(_sb) _sb.style.display = 'none';
  // Misma fuente de flags 🔔/📱 que el CRM (panel_crm_flags, viene del CSV de whaticket/admi) —
  // así el usuario que aparece acá se lee con el mismo contexto que en Jugadores/CRM.
  if(!window._crmFlags && typeof cargarOperacionesAgente === 'function'){
    try{ await cargarOperacionesAgente(); }catch(_e){}
  }

  // Controles (período rodante + día puntual) — se muestran también en el estado vacío.
  const _hoyISO = _blIsoDay(0), _ayerISO = _blIsoDay(1), _anteISO = _blIsoDay(2);
  const _btnDia = function(iso, label){
    const on = modoDia && String(diaISO)===iso;
    return '<button class="mini-btn '+(on?'yellow':'gray')+'" style="font-size:11px" onclick="mostrarBlacklist24h(0,\''+iso+'\')">'+label+'</button>';
  };
  const _controles =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,.08)">'
    +   '<label style="font-size:12px;color:var(--muted)">📅 Período:</label>'
    +   '<select onchange="mostrarBlacklist24h(this.value,\'\')" style="font-size:12px;padding:4px 8px;background:#161b22;border:1px solid #30363d;color:'+(modoDia?'#6b7688':'#e6edf3')+';border-radius:8px">'
    +     [1,2,3,7,15,30].map(function(d){ return '<option value="'+d+'"'+(!modoDia&&_dias===d?' selected':'')+'>'+(d===1?'Últimas 24hs':(d+' días'))+'</option>'; }).join('')
    +   '</select>'
    +   '<span style="color:#3a4356;margin:0 2px">|</span>'
    +   '<label style="font-size:12px;color:var(--muted)">🎯 Día puntual:</label>'
    +   _btnDia(_hoyISO,'Hoy') + _btnDia(_ayerISO,'Ayer') + _btnDia(_anteISO,'Anteayer')
    +   '<input type="date" value="'+(modoDia?String(diaISO):'')+'" max="'+_hoyISO+'" onchange="if(this.value)mostrarBlacklist24h(0,this.value)" style="font-size:12px;padding:3px 6px;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:8px">'
    + '</div>';

  try {
    // Ventana de fetch. En modo día: [día 00:00 − 24h → día 23:59] (retrovisor para el ancla cruzada).
    let desde, hasta, dayStartMs = 0, dayEndMs = 0;
    if(modoDia){
      const p = String(diaISO).split('-').map(Number);
      const ds = new Date(p[0], p[1]-1, p[2], 0, 0, 0, 0);
      const de = new Date(p[0], p[1]-1, p[2], 23, 59, 59, 999);
      dayStartMs = ds.getTime(); dayEndMs = de.getTime();
      desde = new Date(dayStartMs - _BL_H24).toISOString();
      hasta = new Date(dayEndMs).toISOString();
    } else {
      desde = new Date(Date.now() - _dias * _BL_H24).toISOString();
      hasta = new Date().toISOString();
    }

    let { data, error } = await supabaseClient
      .from('historial_ops')
      .select('id, usuario, monto, billetera_nombre, estado, origen, created_at, pc_codigo, notas, chunior_movimiento_id')
      .eq('tipo', 'RETIRO')
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('created_at', { ascending: false })
      .limit(3000);
    if(error) throw error;
    data = (data || []).filter(function(r){
      if(/\[BL_EXCLUIDO\]/.test(String(r.notas||''))) return false;
      if(String(r.estado||'').toUpperCase() === 'REVERTIDA') return false;
      return true;
    });

    const body = document.getElementById('modalBody') || document.querySelector('#modal .modal-body');
    if(!data || !data.length){
      if(body) body.innerHTML = _controles + '<div class="ok-box" style="padding:12px">✅ No hay retiros registrados en '+_lbl+'.</div>';
      return;
    }

    // Agrupar por usuario — clave en MINÚSCULA: "Cristina0735" y "cristina0735" son la misma
    // persona guardada distinto (portal vs manual); si no, el gap pareado no cruza sus retiros.
    const porUsuario = {};
    data.forEach(function(r){
      const u = String(r.usuario || '?');
      const k = u.toLowerCase();
      if(!porUsuario[k]) porUsuario[k] = { usuario:u, count:0, total:0, ultima:r.created_at, pcs:new Set(), retiros:[] };
      const g = porUsuario[k];
      g.count++;
      g.total += Math.abs(Number(r.monto) || 0);
      if(r.created_at > g.ultima) g.ultima = r.created_at;
      if(r.pc_codigo) g.pcs.add(r.pc_codigo);
      g.retiros.push(r);
    });

    // Detección PAREADA de dobles: por usuario, ordenar asc y marcar gap<24h contra el ancla
    // (último retiro NO parcial). Los parciales no anclan ni cuentan.
    Object.values(porUsuario).forEach(function(g){
      g.retiros.sort(function(a,b){ return new Date(a.created_at) - new Date(b.created_at); });
      let anchor = null;
      g.dobles = 0; g.doblesDia = 0;
      g.retiros.forEach(function(r){
        r._t = new Date(r.created_at).getTime();
        r._parcial = _blEsParcial(r);
        r._doble = false; r._gap = null;
        if(r._parcial) return;                 // parcial: no ancla, no doble
        if(anchor){
          r._gap = r._t - anchor._t;
          if(r._gap < _BL_H24){
            r._doble = true; g.dobles++;
            if(!modoDia || (r._t >= dayStartMs && r._t <= dayEndMs)) g.doblesDia++;
          }
        }
        anchor = r;
      });
      g.doblesShow = modoDia ? g.doblesDia : g.dobles;
    });

    let lista = Object.values(porUsuario).sort(function(a,b){
      if(b.doblesShow !== a.doblesShow) return b.doblesShow - a.doblesShow;
      if(b.count !== a.count) return b.count - a.count;
      return b.total - a.total;
    });
    // En modo día solo mostramos usuarios con al menos un doble que aterriza ese día (auditoría).
    let ocultosSingles = 0;
    if(modoDia){
      const conDoble = lista.filter(function(g){ return g.doblesShow >= 1; });
      ocultosSingles = lista.length - conDoble.length;
      lista = conDoble;
    }
    const reincidentes = lista.filter(function(g){ return g.doblesShow >= 1; }).length;

    let filas = '';
    lista.forEach(function(g){
      const dob = g.doblesShow;
      let bg = 'transparent', borde = 'rgba(255,255,255,.08)';
      if(dob >= 2){ bg = 'rgba(220,40,40,.14)';  borde = 'rgba(220,40,40,.5)'; }
      else if(dob === 1){ bg = 'rgba(230,160,40,.12)'; borde = 'rgba(230,160,40,.45)'; }
      const esCross = [...g.pcs].some(function(pc){ return pc && pc !== pcOperativa; });
      const crossBadge = esCross
        ? '<span class="badge badge-danger" style="font-size:9px;padding:2px 6px;margin-left:6px">🚨 otra PC</span>' : '';
      const pcsTxt = [...g.pcs].join(', ') || '—';
      const countBadge = '<span style="display:inline-block;min-width:22px;text-align:center;font-weight:800;border-radius:6px;padding:2px 7px;'
        + (dob>=2?'background:#dc2828;color:#fff':dob===1?'background:#e6a028;color:#1a1205':'background:#2a3344;color:#c0cad8')
        + '">'+dob+'</span>';
      const uKey = 'bl_'+btoa(unescape(encodeURIComponent(g.usuario))).replace(/[^a-zA-Z0-9]/g,'');
      const _fl = (window._crmFlags||{})[String(g.usuario||'').toLowerCase()];
      const flagsTxt = ' <span title="Push: '+(_fl&&_fl.push?'sí':'no')+'" style="opacity:'+(_fl&&_fl.push?1:.28)+'">🔔</span><span title="App instalada: '+(_fl&&_fl.app?'sí':'no')+'" style="opacity:'+(_fl&&_fl.app?1:.28)+'">📱</span>';
      filas += '<tr style="background:'+bg+';border-top:1px solid '+borde+';cursor:pointer" onclick="(function(e){var d=document.getElementById(\''+uKey+'\');if(d)d.classList.toggle(\'hidden\');})()" title="Ver retiros individuales">'
        + '<td style="padding:7px 8px"><span style="color:#7c8aa0">▸</span> <b>'+escapeHtml(g.usuario)+'</b>'+flagsTxt+crossBadge+'</td>'
        + '<td style="padding:7px 8px;text-align:center">'+countBadge+'<div class="small" style="color:#7c8aa0;font-size:10px">'+g.count+' retiros</div></td>'
        + '<td style="padding:7px 8px;text-align:right;white-space:nowrap"><b>'+money(g.total)+'</b></td>'
        + '<td style="padding:7px 8px;font-size:11px;color:#9aa4b2;white-space:nowrap">'+escapeHtml(formatFecha(g.ultima))+'</td>'
        + '<td style="padding:7px 8px;font-size:11px;color:#9aa4b2">'+escapeHtml(pcsTxt)+'</td>'
        + '</tr>';
      let subRetiros = '';
      g.retiros.forEach(function(r){
        // Color: doble = rojo · parcial = azul · normal/ancla = gris. En modo día atenúo el retrovisor.
        const fueraDia = modoDia && (r._t < dayStartMs || r._t > dayEndMs);
        let col = '#c0cad8', barra = 'transparent', tag = '';
        if(r._parcial){ col = '#7aa7ff'; barra = '#3b82f6'; tag = ' <span style="color:#7aa7ff">· parcial (no cuenta)</span>'; }
        else if(r._doble){ col = '#ff9a9a'; barra = '#dc2828'; tag = ' <span style="color:#ff9a9a;font-weight:700">· DOBLE</span>'; }
        const gapTxt = (r._gap!=null)
          ? ' · <span style="color:'+(r._doble?'#ff9a9a':'#7c8aa0')+'">'+_blFmtGap(r._gap)+' del anterior</span>'
          : ' · <span style="color:#7c8aa0">1º del período</span>';
        const nTxt = r.chunior_movimiento_id
          ? '<span style="color:#8fce9b">N° '+escapeHtml(String(r.chunior_movimiento_id))+'</span>'
          : '<span style="color:#7c8aa0">sin N°</span>';
        subRetiros += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0 5px 8px;border-top:1px solid rgba(255,255,255,.06);border-left:3px solid '+barra+';font-size:12px;opacity:'+(fueraDia?'.55':'1')+'">'
          + '<span style="color:'+col+'">'+escapeHtml(formatFecha(r.created_at))+' · <b>'+money(Math.abs(Number(r.monto)||0))+'</b> · '+escapeHtml(r.billetera_nombre||'—')+' · '+nTxt+tag+gapTxt+(fueraDia?' <span style="color:#7c8aa0">(día previo)</span>':'')+'</span>'
          + '<button class="mini-btn yellow" style="font-size:10px" onclick="event.stopPropagation();excluirRetiroBlacklistModal(\''+escapeHtml(String(r.id))+'\',this)">🚫 Quitar</button>'
          + '</div>';
      });
      filas += '<tr id="'+uKey+'" class="hidden"><td colspan="5" style="padding:6px 14px;background:#10141d">'
        + '<div class="small" style="color:var(--muted);margin-bottom:2px">Retiros'+(modoDia?' (incluye 24h previas para el par cruzado)':'')+' — <span style="color:#ff9a9a">DOBLE</span> = &lt;24h del anterior · <span style="color:#7aa7ff">parcial</span> no cuenta · Quitar = excluir:</div>'
        + subRetiros + '</td></tr>';
    });

    if(modoDia && !lista.length){
      if(body) body.innerHTML = _controles
        + '<div class="ok-box" style="padding:12px">✅ Sin retiros dobles el '+String(diaISO)+'.'
        + (ocultosSingles?'<div class="small" style="margin-top:4px;color:var(--muted)">'+ocultosSingles+' usuario(s) con un solo retiro (sin doble).</div>':'')
        + '</div>';
      return;
    }

    if(body) body.innerHTML = _controles
      + '<div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;align-items:center;font-size:13px">'
      +   '<span>👥 <b>'+lista.length+'</b> '+(modoDia?'con doble':'usuarios')+'</span>'
      +   '<span>↩️ <b>'+data.length+'</b> retiros'+(modoDia?' (con retrovisor)':'')+'</span>'
      +   (reincidentes ? '<span style="color:#ffb86b">🔁 <b>'+reincidentes+'</b> con retiro doble</span>' : '')
      +   (modoDia && ocultosSingles ? '<span style="color:#7c8aa0">· '+ocultosSingles+' con 1 solo retiro (ocultos)</span>' : '')
      + '</div>'
      + '<div style="max-height:52vh;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:10px">'
      +   '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      +     '<thead><tr style="position:sticky;top:0;background:#161b26;z-index:1">'
      +       '<th style="padding:8px;text-align:left">Usuario</th>'
      +       '<th style="padding:8px;text-align:center">Dobles</th>'
      +       '<th style="padding:8px;text-align:right">Total</th>'
      +       '<th style="padding:8px;text-align:left">Último</th>'
      +       '<th style="padding:8px;text-align:left">Oficina</th>'
      +     '</tr></thead>'
      +     '<tbody>'+filas+'</tbody>'
      +   '</table>'
      + '</div>';
  } catch(e){
    const body = document.getElementById('modalBody') || document.querySelector('#modal .modal-body');
    if(body) body.innerHTML = '<div class="err-box" style="padding:12px">Error cargando blacklist: '+escapeHtml(e.message||'')+'</div>';
  }
}

// Excluir un retiro desde el modal de blacklist (marca [BL_EXCLUIDO] y recarga el modal).
async function excluirRetiroBlacklistModal(historialId, btn){
  if(btn){ btn.disabled = true; btn.textContent = '...'; }
  try {
    const { data: row } = await supabaseClient.from('historial_ops').select('notas').eq('id', historialId).single();
    const notas = (String(row?.notas||'').trim() + ' [BL_EXCLUIDO]').trim();
    const { error } = await supabaseClient.from('historial_ops').update({ notas }).eq('id', historialId);
    if(error) throw error;
    const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
    if(h) h.notas = notas;
    toast('🚫 Retiro excluido de la blacklist.', 'green');
    const _st = window._blState || { dias:1, diaISO:'' };
    await mostrarBlacklist24h(_st.dias, _st.diaISO);
  } catch(e){
    toast('Error al excluir: '+(e.message||''), 'red');
  }
}

// ── Caché local (por PC) ─────────────────────────────────────────────────────
function _histLocalKey(){ return "nodo_historial_"+(pcOperativa||"sin_pc"); }
function _guardarHistorialLocal(){
  try {
    const full = construirHistorialUnificado().slice(0, 300);
    localStorage.setItem(_histLocalKey(), JSON.stringify({ ts: Date.now(), items: full }));
  } catch(_){}
}
function _cargarHistorialLocal(){
  try {
    const raw = localStorage.getItem(_histLocalKey());
    if(!raw) return null;
    const obj = JSON.parse(raw);
    return (obj && Array.isArray(obj.items)) ? obj.items : null;
  } catch(_){ return null; }
}
function pintarHistorialDesdeCache(){
  const cache = _cargarHistorialLocal();
  if(cache && cache.length) setBox("tablaSolicitudesCompleta", tablaHistorialUnificadoHTML(cache));
}

// ── Cola de cambio de billetera en lote ──────────────────────────────────────
let _loteEnCurso = false;

function abrirCambioBilleteraLote(){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  if(_loteEnCurso){ toast("Ya hay un lote en proceso.", "red"); return; }
  const ids = Array.from(_seleccionLote);
  if(!ids.length){ toast("No hay movimientos seleccionados.", "red"); return; }
  const filas = ids.map(function(id){
    return (_historialData||[]).find(function(h){ return String(h.id)===String(id); });
  }).filter(function(h){ return h && h.chunior_movimiento_id; });
  if(!filas.length){
    abrirModal('💳 Cambio de billetera en lote',
      '<div class="alert-box">Ninguno de los seleccionados tiene N° de movimiento de Chunior.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }
  const bilsConUid = (billeteras||[]).filter(function(b){ return b.CHUNIOR_UID; });
  if(!bilsConUid.length){
    abrirModal('💳 Cambio de billetera en lote',
      '<div class="alert-box">No hay billeteras con UID de Chunior. Sincronizá billeteras primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }
  const opciones = bilsConUid.map(function(b){
    return '<option value="'+escapeHtml(String(b.ID_BILLETERA))+'">'+
           escapeHtml(b.NOMBRE_VISIBLE||'—')+' · '+money(b.SALDO||0)+'</option>';
  }).join('');
  abrirModal(
    '💳 Cambiar billetera · '+filas.length+' movimiento'+(filas.length!==1?'s':''),
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Se re-asigna la billetera de <b>'+filas.length+'</b> movimiento(s) en Chunior, uno por uno. Espera a que no haya cargas en curso.</div>'+
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA (para todos)</label>'+
    '<select id="loteBilSel" style="margin-top:6px">'+opciones+'</select>',
    function(){
      const sel = document.getElementById("loteBilSel");
      const bilNueva = (billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(sel?.value); });
      if(!bilNueva || !bilNueva.CHUNIOR_UID){ toast("Seleccioná una billetera con UID de Chunior.", "red"); return; }
      cerrarModal();
      procesarColaCambioBilletera(filas, bilNueva);
    },
    'Iniciar cola en 2° plano'
  );
}

function _panelLote(){
  let p = document.getElementById("panelColaLote");
  if(!p){
    p = document.createElement("div");
    p.id = "panelColaLote";
    p.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;width:300px;background:#161b26;"+
      "border:1px solid #2e3a52;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);padding:12px;font-size:13px;color:#c0cad8";
    document.body.appendChild(p);
  }
  return p;
}
function _cerrarPanelLote(){ const p=document.getElementById("panelColaLote"); if(p) p.remove(); }

async function procesarColaCambioBilletera(filas, bilNueva){
  if(_loteEnCurso) return;
  _loteEnCurso = true;
  let ok = 0, fail = 0;
  const total = filas.length;
  const fallidos = [];
  const p = _panelLote();
  function pintar(i, estadoTxt){
    p.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
        '<b style="color:#c1b3ff">💳 Cambio de billetera</b>'+
        '<span class="small" style="color:var(--muted)">2° plano</span>'+
      '</div>'+
      '<div class="small" style="margin-bottom:6px">Procesando '+i+'/'+total+' · ✅ '+ok+' · ❌ '+fail+'</div>'+
      '<div style="height:8px;background:#0e1525;border-radius:6px;overflow:hidden">'+
        '<div style="height:100%;width:'+Math.round((i/total)*100)+'%;background:#7c3aed;transition:width .3s"></div>'+
      '</div>'+
      (estadoTxt?'<div class="small" style="margin-top:6px;color:var(--muted)">'+escapeHtml(estadoTxt)+'</div>':'');
  }
  pintar(0, "Iniciando...");
  toast('💳 Cola de cambio de billetera iniciada en 2° plano ('+total+' movimientos).', 'blue');
  for(let i=0; i<filas.length; i++){
    const h = filas[i];
    const tEspera = Date.now() + 30000;
    while(_watchdog && _watchdog.busy > 0 && Date.now() < tEspera){
      pintar(i, "⏳ Operación en curso, esperando...");
      await new Promise(function(r){ setTimeout(r, 800); });
    }
    _wdLock();
    pintar(i, "Mov. N° "+h.chunior_movimiento_id+" → "+bilNueva.NOMBRE_VISIBLE);
    try {
      const r = await _cambiarBilleteraChunior(h.chunior_movimiento_id, bilNueva.CHUNIOR_UID);
      if(r && r.ok){
        ok++;
        // La billetera anterior se guarda ANTES del update, que la pisa.
        const _bilAntesId     = h.billetera_id;
        const _bilAntesNombre = h.billetera_nombre;
        try {
          await supabaseClient.from("historial_ops")
            .update({ billetera_id: bilNueva.ID_BILLETERA, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
            .eq("id", h.id);
        } catch(eUpd){ console.warn("update historial_ops lote:", eUpd); }
        await _asentarCambioBilletera({
          movId: h.chunior_movimiento_id,
          historialId: h.id,
          solicitudId: h.solicitud_id || null,
          monto: h.monto || 0,
          bilAnteriorId: _bilAntesId,
          bilAnteriorNombre: _bilAntesNombre,
          bilNuevaId: bilNueva.ID_BILLETERA,
          bilNuevaNombre: bilNueva.NOMBRE_VISIBLE,
          origen: 'MANUAL_LOTE'
        });
        // El mismo motor que el cambio de a uno: corrige de DÓNDE salió la plata en la solicitud.
        // Esta cola no lo hacía, así que el lote arrastraba el bug que se arregló de a uno (D-106).
        try{ if(typeof _rehacerDesdeDelPago==='function') await _rehacerDesdeDelPago(h.solicitud_id, h, bilNueva); }catch(_e){}
        h.billetera_id = bilNueva.ID_BILLETERA;
        h.billetera_nombre = bilNueva.NOMBRE_VISIBLE;
      } else {
        fail++; fallidos.push({ mov:h.chunior_movimiento_id, err:(r&&r.error)||'sin detalle' });
      }
    } catch(e){
      fail++; fallidos.push({ mov:h.chunior_movimiento_id, err:e.message||'excepción' });
    } finally { _wdUnlock(); }
    pintar(i+1, null);
    await new Promise(function(r){ setTimeout(r, 500); });
  }
  _loteEnCurso = false;
  _seleccionLote.clear();
  p.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<b style="color:'+(fail===0?'#7ee07e':'#ffb86b')+'">'+(fail===0?'✅ Lote terminado':'⚠️ Lote con errores')+'</b>'+
      '<button class="mini-btn gray" style="font-size:10px" onclick="_cerrarPanelLote()">✕</button>'+
    '</div>'+
    '<div class="small">'+ok+' cambiada(s)'+(fail?', '+fail+' con error':'')+'.</div>'+
    (fallidos.length?'<div class="small" style="margin-top:6px;color:var(--muted);max-height:80px;overflow:auto">Fallaron: '+
      fallidos.map(function(f){ return 'N°'+escapeHtml(String(f.mov))+' ('+escapeHtml(String(f.err))+')'; }).join(', ')+'</div>':'');
  toast(fail===0?('✅ '+ok+' billetera(s) cambiada(s)'):('⚠️ '+ok+' ok · '+fail+' con error'), fail===0?'green':'red');
  actualizarBarraLote();
  await cargarHistorial();
}

function renderSolicitudes(){
  if(window.V154P && Array.isArray(window.V154P.solicitudes) && window.V154P.solicitudes.length && typeof window.v154pRenderSolicitudesPortalCompleto === "function"){
    window.v154pRenderSolicitudesPortalCompleto();
    return;
  }
  renderHistorialUnificado();
}
function tablaSolicitudesHTML(lista){
  if(!lista.length)return`<div class="alert-box">No hay solicitudes para mostrar.</div>`;
  let html=`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Usuario</th><th>Billetera</th><th>Monto</th><th>Estado</th><th>Acción</th></tr></thead><tbody>`;
  lista.forEach(s=>{
    const id=s.ID||s.SOLICITUD_ID||s.ID_SOLICITUD||"";
    const tipo=normalizar(s.TIPO_SOLICITUD||s.TIPO);
    html+=`<tr>
      <td>${formatFecha(s.FECHA_CREACION||s.FECHA)}</td>
      <td>${tipo}</td>
      <td><b>${s.USUARIO||s.USUARIO_JUGADOR||"-"}</b><br><span class="small">${s.NOMBRE_COMPLETO||""}</span><br>${scoreBadge(s.USUARIO||s.USUARIO_JUGADOR||"")}</td>
      <td>${s.BILLETERA_NOMBRE||s.NOMBRE_BILLETERA||s.ID_BILLETERA||"-"}</td>
      <td>${money(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO||0)}</td>
      <td>${estadoBadge(s.ESTADO)}</td>
      <td>
        ${esPendiente(s)?
          tipo==="CAMBIO_CLAVE"
            ? `${window.ctrlElectron?`<button class="mini-btn purple" onclick="ejecutarAutoClave('${id}')">▶ Auto</button>`:""}
               <button class="mini-btn red" onclick="abrirRechazarSolicitud('${id}')">Rechazar</button>`
            : `<button class="mini-btn blue" onclick="tomarSolicitud('${id}')">Tomar</button>
               ${tipo==="RETIRO"
                  ? `${window.ctrlElectron?`<button class="mini-btn purple" onclick="ejecutarAutoRetiro('${id}')">▶ Auto</button>`:""}
                     <button class="mini-btn green" onclick="abrirCerrarRetiro('${id}')">Cerrar retiro</button>`
                  : `${window.ctrlElectron?`<button class="mini-btn purple" onclick="ejecutarAutoCarga('${id}')">▶ Auto</button>`:""}
                     <button class="mini-btn green" onclick="abrirAprobarSolicitud('${id}')">Cargar</button>`}
               <button class="mini-btn red" onclick="abrirRechazarSolicitud('${id}')">Rechazar</button>`
          :normalizar(s.ESTADO)==="APROBADA_MANUAL"&&tipo==="CARGA"&&window.ctrlElectron?`
            <button class="mini-btn purple" onclick="ejecutarAutoCarga('${id}')">▶ Auto</button>
          `:"-"}
      </td>
    </tr>`;
  });
  html+=`</tbody></table></div>`;
  return html;
}

// Devuelve la billetera EN PORTAL de ESTA oficina. El filtro por oficina no estaba, y con
// `billeteras` contaminado con filas de otra PC el .find() agarraba la primera marcada
// SELECCIONADA_MANUAL de cualquier oficina: en P4 devolvia AVILA MP, que es de P2.
// No es cosmetico: esta funcion decide a que billetera se le ajusta el saldo despues de
// una carga (automatizaciones.js, lotes-y-solicitudes.js). Una carga en P4 podia
// descontarle a P2.
function _mismaOficinaBilletera(b){
  const pcAhora = String((typeof pcOperativa !== "undefined" ? pcOperativa : "") || "").trim().toUpperCase();
  if(!pcAhora) return true;                 // sin oficina resuelta no se filtra nada
  const pcBil = String((b && b.PC) || "").trim().toUpperCase();
  if(!pcBil) return true;                   // billetera sin oficina: se deja pasar
  return pcBil === pcAhora;
}
function getBilleraLanding(){
  const lista = (billeteras||[]).filter(function(b){
    return normalizar(b.ACTIVA)==="SI" && normalizar(b.ESTADO||"ACTIVA") !== "FUSIONADA"
        && _mismaOficinaBilletera(b);
  });
  return lista.find(b=>normalizar(b.SELECCIONADA_MANUAL)==="SI") || lista[0];
}

// Verifica la configuración del "EN PORTAL" sin tener que abrir la landing del jugador.
// Devuelve {ok, tipo:'ok'|'warn'|'err', mensaje, billetera}.
function verificarConfigLanding(){
  if(!billeteras || !billeteras.length){
    return { ok:false, tipo:'warn', mensaje:'No hay billeteras configuradas para esta oficina.' };
  }
  const enLanding = billeteras.filter(b => normalizar(b.SELECCIONADA_MANUAL)==='SI');

  if(enLanding.length === 0){
    return { ok:false, tipo:'warn', mensaje:'⚠️ Ninguna billetera marcada como EN PORTAL. El jugador no ve a dónde transferir.' };
  }
  if(enLanding.length > 1){
    const nombres = enLanding.map(b => b.NOMBRE_VISIBLE || '?').join(', ');
    return { ok:false, tipo:'err', mensaje:'❌ Hay '+enLanding.length+' billeteras marcadas como EN PORTAL (debe ser solo 1): '+nombres };
  }

  const b = enLanding[0];

  if(normalizar(b.ACTIVA) !== 'SI'){
    return { ok:false, tipo:'err', mensaje:'❌ La billetera EN PORTAL ('+(b.NOMBRE_VISIBLE||'?')+') está PAUSADA. El jugador no puede usarla.', billetera:b };
  }

  // Campos mínimos que la landing necesita mostrar al jugador
  const faltantes = [];
  if(!b.NOMBRE_VISIBLE) faltantes.push('Nombre');
  if(!b.CBU_ALIAS)      faltantes.push('CBU/Alias');
  if(!b.TITULAR)        faltantes.push('Titular');
  if(!b.TIPO)           faltantes.push('Tipo');
  if(faltantes.length){
    return { ok:false, tipo:'warn', mensaje:'⚠️ La billetera EN PORTAL ('+escapeHtml(b.NOMBRE_VISIBLE||'?')+') no tiene completos: <b>'+faltantes.join(', ')+'</b>. La landing va a mostrar incompleto.', billetera:b };
  }

  return {
    ok: true,
    tipo: 'ok',
    mensaje: '✅ Landing OK · <b>'+escapeHtml(b.NOMBRE_VISIBLE)+'</b> ('+escapeHtml(b.TIPO)+') · Titular: '+escapeHtml(b.TITULAR)+' · CBU/Alias: <code style="background:#0c1018;padding:2px 6px;border-radius:4px">'+escapeHtml(b.CBU_ALIAS)+'</code>',
    billetera: b
  };
}

function renderEstadoLanding(){
  const r = verificarConfigLanding();
  const claseBox = r.tipo === 'ok' ? 'ok-box' : (r.tipo === 'err' ? 'err-box' : 'alert-box');

  // Vista billeteras: cartel completo arriba del grid
  const elFull = document.getElementById("estadoLanding");
  if(elFull){
    elFull.innerHTML = '<div class="'+claseBox+'" style="margin-top:8px;padding:12px;font-size:13px;line-height:1.4">'+r.mensaje+'</div>';
  }

  // Inicio: indicador compacto arriba de las billeteras
  const elMini = document.getElementById("estadoLandingInicio");
  if(elMini){
    // Versión corta para el inicio
    let mensajeCorto = r.mensaje;
    if(r.tipo === 'ok' && r.billetera){
      mensajeCorto = '✅ Landing OK · <b>'+escapeHtml(r.billetera.NOMBRE_VISIBLE)+'</b>';
    }
    elMini.innerHTML = '<div class="'+claseBox+'" style="margin-bottom:10px;padding:8px 12px;font-size:12px;line-height:1.3">'+mensajeCorto+'</div>';
  }
}

async function ajustarSaldoBilletera(id, delta){
  // ── CONTADOR INTERNO DE BILLETERAS DESACTIVADO ──────────────────────────────────────────────
  // Chunior es la FUENTE DE VERDAD del saldo: se refleja al sincronizar billeteras
  // (sincronizarBilleterasChunior). Antes el panel llevaba su propio contador paralelo (RPC
  // panel_billetera_ajustar_saldo + b.SALDO local) que se desincronizaba de Chunior. Se deja
  // INERTE (no-op): los ~15 callers siguen invocando pero ya no ajustan nada.
  return;
}

function renderBilleteras(){
  // Crear/editar billeteras (CBU/alias/titular/tipo) se hace SOLO en el admi (encargados).
  // El operativo solo ve, transfiere, elige "en portal" y pausa.
  let html=``;
  if(!billeteras.length){html+=`<div class="alert-box">No hay billeteras configuradas para esta oficina. Se crean al sincronizar con Chunior; los datos los completa el encargado en el panel administrativo.</div>`;setBox("walletsGrid",html);renderEstadoLanding();return}
  billeteras.forEach(b=>{
    const activa=normalizar(b.ACTIVA)==="SI";
    const seleccionada=normalizar(b.SELECCIONADA_MANUAL)==="SI";
    html+=`<div class="wallet-card ${activa?"ok":"paused"} ${seleccionada?"selected":""}">
      <div class="wallet-name">💳 ${b.NOMBRE_VISIBLE||b.ID_BILLETERA}</div>
      <div class="wallet-type">${b.TIPO||""} · ${b.PC||pcOperativa}</div>
      ${b.CBU_ALIAS?`<div class="small" style="margin-top:4px;color:var(--muted);font-family:monospace">${b.CBU_ALIAS}</div>`:""}
      ${b.TITULAR?`<div class="small" style="color:var(--muted)">${b.TITULAR}</div>`:""}
      <div style="margin-top:10px;font-size:22px;font-weight:900">${money(b.SALDO||0)}</div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        ${activa?'<span class="badge badge-ok">ACTIVA</span>':'<span class="badge badge-danger">PAUSADA</span>'}
        ${seleccionada?'<span class="badge badge-blue">EN PORTAL</span>':''}
      </div>
      <div class="wallet-actions">
        <button class="mini-btn blue" onclick="seleccionarBilleteraSeguro('${b.ID_BILLETERA}','${b.CHUNIOR_UID||''}')">En portal</button>
        ${activa
          ?`<button class="mini-btn red" onclick="cambiarEstadoBilletera('${b.ID_BILLETERA}','NO')">Pausar</button>`
          :`<button class="mini-btn green" onclick="cambiarEstadoBilletera('${b.ID_BILLETERA}','SI')">Activar</button>`}
      </div>
    </div>`;
  });
  setBox("walletsGrid",html);
  renderEstadoLanding();
}

function abrirEditarBilletera(id){
  const b=billeteras.find(x=>String(x.ID_BILLETERA)===String(id));
  if(!b) return;
  abrirModal("Editar billetera",`
    <label>Nombre / Titular</label>
    <input id="ebNombre" value="${escapeHtml(b.NOMBRE_VISIBLE||"")}" placeholder="Ej: Juan García">
    <label>CBU / CVU / Alias</label>
    <input id="ebCbu" value="${escapeHtml(b.CBU_ALIAS||"")}" placeholder="Ej: 0000003100...">
    <label>Tipo (MP, Ualá, NJX, PP, transferencia…)</label>
    <input id="ebTipo" value="${escapeHtml((b.BANCO&&!/chunior|^p\d|general/i.test(b.BANCO))?b.BANCO:(typeof detectarTipoBilletera==='function'?detectarTipoBilletera(b):''))}" placeholder="Ej: MercadoPago">
    <label>Saldo actual (ajuste manual)</label>
    <input id="ebSaldo" type="number" value="${b.SALDO||0}">
  `,async()=>{
    const {error}=await supabaseClient.rpc("panel_billetera_update",{p_secret:window.PANEL_DATA_SECRET,p_id:Number(id),p_patch:{
      nombre_visible:val("ebNombre"),
      cbu_alias:val("ebCbu"),
      titular:val("ebNombre"),
      banco:val("ebTipo"),
      saldo:Number(val("ebSaldo")||0)
    }});
    if(error){alert(error.message);return}
    cerrarModal();
    toast("Billetera actualizada","green");
    await cargarBilleteras();
  },"Guardar");
}

function abrirNuevaBilletera(){
  abrirModal("Nueva billetera",`
    <label>Nombre / Titular</label>
    <input id="nbNombre" placeholder="Ej: Juan García">
    <label>CBU / CVU / Alias</label>
    <input id="nbCbu" placeholder="Ej: 0000003100...">
    <label>Tipo (MP, Ualá, NJX, PP, transferencia…)</label>
    <input id="nbTipo" placeholder="Ej: MercadoPago">
    <label>Saldo inicial</label>
    <input id="nbSaldo" type="number" value="0">
  `,async()=>{
    const nombre=val("nbNombre");
    if(!nombre){alert("El nombre es obligatorio.");return}
    const {error}=await supabaseClient.rpc("panel_billetera_insert",{p_secret:window.PANEL_DATA_SECRET,p_patch:{
      nombre_visible:nombre,
      cbu_alias:val("nbCbu"),
      titular:nombre,
      banco:val("nbTipo"),
      saldo:Number(val("nbSaldo")||0),
      pc_codigo:pcOperativa,
      activa:true,
      seleccionada_manual:false
    }});
    if(error){alert(error.message);return}
    cerrarModal();
    toast("Billetera creada","green");
    await cargarBilleteras();
  },"Crear");
}

async function tomarSolicitud(id){
  const r = await actualizarSolicitudSupabase(id, {
    operador_usuario: operador.usuario || operador.nombre || "",
    estado: "PENDIENTE"
  });

  if(!r.ok){
    alert(r.error || "Error");
    return;
  }

  toast("Solicitud tomada","green");
  await refrescarTodo(false);
}
function abrirAprobarSolicitud(id){
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s) return;

  const tieneElectron = !!window.ctrlElectron;
  abrirModal("Aprobar carga",`
    <div class="ok-box"><b>${escapeHtml(s.USUARIO||"")}</b> · ${money(s.MONTO_DECLARADO||s.MONTO_REAL||0)}</div>
    <label>Monto real confirmado</label>
    <input id="apMonto" type="number" value="${s.MONTO_REAL||s.MONTO_DECLARADO||""}">
    <label>Observaciones (opcional, se envían al usuario)</label>
    <textarea id="apObs" placeholder="Ej: tu transferencia llegó correctamente"></textarea>
    ${tieneElectron?'<div class="alert-box" style="margin-top:8px;font-size:12px">⚡ Se ejecutará automáticamente en el casino al confirmar.</div>':'<div class="alert-box" style="margin-top:8px;font-size:12px">⚠️ Sin automatización disponible: se registrará como aprobada pendiente de ejecución manual.</div>'}
  `,async()=>{
    const montoFinal = Number(val("apMonto") || s.MONTO_DECLARADO || 0);
    const obs = val("apObs");
    const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";

    // 1. Registrar monto real confirmado por el operador
    const rAprobada = await actualizarSolicitudSupabase(id, {
      estado: "APROBADA_MANUAL",
      monto: montoFinal,
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    if(!rAprobada.ok){ alert(rAprobada.error || "Error al aprobar"); return; }

    cerrarModal();

    // 2. Si hay Electron disponible: ejecutar en el casino y marcar ACREDITADA para que el portal lo reciba
    if(tieneElectron && usuario && montoFinal > 0){
      toast("Aprobada · ejecutando carga en backoffice...","blue");
      try{
        if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); await refrescarTodo(false); return; }

        _wdLock();
        let busqueda;
        try{
          busqueda = await callDrex("buscarUsuario", usuario, {skipBalance:true});
        }finally{ _wdUnlock(); }

        // Sesión caída o página de error NO es "el usuario no existe": la solicitud queda como estaba.
        if(busqueda && (busqueda.needsLogin || busqueda.pageError)){
          toast('Se cayó la sesión de Agentes · no se tocó la solicitud. Entrá y reintentá.','red');
          await refrescarTodo(false); return;
        }
        if(!busqueda || !busqueda.exists){
          await actualizarSolicitudPortal(id, "ERROR_OPERATIVO", {etapa:"USUARIO_NO_ENCONTRADO_POST_APROBADA", monto_aprobado:montoFinal});
          await notificarUsuarioEnChat(usuario, `❌ Tu carga de $${montoFinal.toLocaleString("es-AR")} no pudo procesarse: el usuario "${escapeHtml(usuario)}" no se encontró en el casino. Contactanos para resolverlo.`);
          toast(`Usuario "${usuario}" no encontrado · quedó en APROBADA_MANUAL para revisión`,"red");
          await refrescarTodo(false);
          return;
        }

        _wdLock();
        let resultado;
        try{
          resultado = await callDrex("cargarSaldo", montoFinal);
        }catch(e){
          resultado = {ok:false, message: e.message || "Error en Agentes"};
        }finally{ _wdUnlock(); }

        if(!resultado.ok && resultado.ok !== undefined){
          // Error técnico: queda en APROBADA_MANUAL para que operador use ▶ Auto
          await notificarUsuarioEnChat(usuario, `⚠️ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue aprobada pero hubo un error técnico al ejecutarla. Ya lo estamos revisando.${obs?`\n📝 ${obs}`:""}`);
          toast("Error al ejecutar carga · quedó como APROBADA_MANUAL · usar ▶ Auto para reintentar","red");
          await refrescarTodo(false);
          return;
        }

        // ── CONFIRMACIÓN de la carga del PORTAL (mismo criterio simple que la carga manual) ──
        // Confiamos en que el script corrió (sin re-leer saldo: eso demoraba y disparaba 403).
        // Solo frenamos ante un RECHAZO CLARO del casino (modal apareció y dijo que NO).
        const _saldoPreCasinoAp = (typeof resultado?.previousBalance?.value === 'number' && !resultado?.previousBalance?.unchanged) ? resultado.previousBalance.value : null;
        const _saldoPostLeidoAp = (typeof resultado?.newBalance?.value === 'number' && !resultado?.newBalance?.unchanged) ? resultado.newBalance.value : null;
        const _rechazoCasinoAp = resultado && resultado.exito === false; // modal apareció y NO confirmó → rechazo CLARO
        const _confirmadaAp = !_rechazoCasinoAp;
        // saldo_post para el historial: el LEÍDO si lo hay; si no, estimado pre+monto. saldo_pre: el real del modal.
        // NO re-derivar pre desde post (post-monto): un post "0" puede ser una lectura espuria
        // transitoria (PC lenta) y da un pre NEGATIVO falso. Sin dato confiable → null (se ve "—").
        const _saldoPostAp = _saldoPostLeidoAp !== null ? _saldoPostLeidoAp : (_saldoPreCasinoAp !== null ? _saldoPreCasinoAp + montoFinal : null);
        const _saldoPreAp = _saldoPreCasinoAp;
        const _bilLandingAp = getBilleraLanding();
        if(!_confirmadaAp){
          await registrarEnHistorial({
            usuario, tipo:'CARGA', monto:montoFinal, origen:'PANEL', estado:'ERROR',
            notas:(obs?obs+' · ':'')+'El casino NO confirmó "Operación correcta" (rechazo) · NO acreditada', solicitud_id:id,
            billetera_id: s.ID_BILLETERA || (_bilLandingAp ? _bilLandingAp.ID_BILLETERA : null),
            billetera_nombre: s.BILLETERA_NOMBRE || (_bilLandingAp ? _bilLandingAp.NOMBRE_VISIBLE : null),
            saldo_pre: _saldoPreAp, saldo_post: _saldoPostAp
          });
          await notificarUsuarioEnChat(usuario, `⚠️ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue rechazada por el casino. Ya lo estamos revisando.${obs?`\n📝 ${obs}`:""}`);
          toast('❌ Carga del portal RECHAZADA por el casino · queda APROBADA_MANUAL · usá ▶ Auto','red');
          await refrescarTodo(false);
          return;
        }
        await registrarEnHistorial({
          usuario, tipo:'CARGA', monto:montoFinal, origen:'PANEL', estado:'OK',
          notas:obs||null, solicitud_id:id,
          billetera_id: s.ID_BILLETERA || (_bilLandingAp ? _bilLandingAp.ID_BILLETERA : null),
          billetera_nombre: s.BILLETERA_NOMBRE || (_bilLandingAp ? _bilLandingAp.NOMBRE_VISIBLE : null),
          saldo_pre: _saldoPreAp, saldo_post: _saldoPostAp
        });

        // Actualizar estado en solicitudes → el portal detecta ACREDITADA en su próximo poll
        await actualizarSolicitudSupabase(id, { estado: "ACREDITADA" });

        // RPC del portal (enriquece metadata y recarga en panel); no bloquea si falla
        try{
          const apFn = typeof actualizarSolicitudPortal === "function"
            ? actualizarSolicitudPortal
            : (typeof window.actualizarSolicitudPortal === "function" ? window.actualizarSolicitudPortal : null);
          if(apFn) await apFn(id, "ACREDITADA", {etapa:"PANEL_APROBADA_EJECUTADA", monto_aprobado:montoFinal, obs:obs||null});
        }catch(_eAP){ console.warn("actualizarSolicitudPortal:", _eAP); }

        const bilLanding = getBilleraLanding();
        if(bilLanding) await ajustarSaldoBilletera(bilLanding.ID_BILLETERA, montoFinal);

        await notificarUsuarioEnChat(usuario, `✅ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue acreditada. ¡Ya podés jugar!${obs?`\n📝 ${obs}`:""}`);
        toast(`Carga aprobada y acreditada · ${usuario} · ${money(montoFinal)}`, "green");

        try{ await window.ctrlElectron.navigateAgent(); }catch(_e){}
        renderBillerasInicio();
        poblarManualBilletera();

      }catch(e){
        toast("Error inesperado al aprobar: "+(e.message||"")+" · La solicitud quedó en APROBADA_MANUAL", "red");
      }finally{
        await refrescarTodo(false);
      }

    } else {
      // Sin Electron: solo registra la aprobación manual y notifica al usuario
      if(usuario){
        await notificarUsuarioEnChat(usuario,
          `✅ Tu carga de $${montoFinal.toLocaleString("es-AR")} fue aprobada. Estamos procesándola en el sistema de juego.${obs?`\n📝 ${obs}`:""}`);
      }
      toast("Carga aprobada (pendiente de ejecución manual)", "green");
      await registrarEnHistorial({usuario, tipo:'CARGA', monto:montoFinal, origen:'PANEL', estado:'OK', notas:obs||null, solicitud_id:id});
      await refrescarTodo(false);
    }
  },"Cargar");
}
async function abrirCerrarRetiro(id){
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));

  if(!s) return;

  const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
  if(usuario){
    const check = await verificarRetiro24h(usuario);
    if(check.bloqueado){
      const proceder = await confirmarRetiroDuplicado(check);
      if(!proceder) return;
    }
  }

  await cargarBilleteras(false);
  const montoSol = Number(s.MONTO_REAL||s.MONTO_DECLARADO||0);
  const bilOpts = billeteras.map(b=>{
    const saldoOk = Number(b.SALDO||0) >= montoSol;
    const sel = normalizar(b.SELECCIONADA_MANUAL)==="SI" ? " selected" : "";
    return `<option value="${b.ID_BILLETERA}"${sel}>${b.NOMBRE_VISIBLE} — ${money(b.SALDO||0)}${saldoOk?"":" ⚠️"}</option>`;
  }).join("");

  abrirModal("Cerrar retiro",`
    <div class="ok-box"><b>${s.USUARIO||""}</b> · ${money(montoSol)}</div>
    <label>Billetera desde donde se paga</label>
    <select id="retBilletera"${!bilOpts?' disabled':''}>
      ${bilOpts||'<option value="">Sin billeteras</option>'}
    </select>
    <div id="retSaldoInfo" class="small" style="margin-top:-8px;margin-bottom:12px"></div>
    <label>Monto final</label>
    <input id="retMonto" type="number" value="${montoSol||""}">
    <label>Observaciones (opcional, se envían al usuario)</label>
    <textarea id="retObs" placeholder="Ej: transferimos a tu CBU/CVU"></textarea>
  `,async()=>{
    const montoFinal = Number(val("retMonto") || s.MONTO_DECLARADO || 0);
    const obs = val("retObs");
    const bilId = val("retBilletera");

    const r = await actualizarSolicitudSupabase(id, {
      estado:"PAGADA",
      monto: montoFinal,
      operador_usuario:operador.usuario || operador.nombre || "",
      billetera_id: bilId || null
    });

    if(!r.ok){ alert(r.error || "Error"); return; }

    if(bilId) await ajustarSaldoBilletera(bilId, -montoFinal);

    const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
    if(usuario){
      await notificarUsuarioEnChat(usuario,
        `✅ Tu retiro de $${montoFinal.toLocaleString("es-AR")} fue pagado.${obs?`\n📝 ${obs}`:""}`);
    }

    cerrarModal();
    toast("Retiro cerrado","green");
    const bilObjR = billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); }) || {};
    let movChuniorP = null;
    if(bilObjR.CHUNIOR_UID && usuario){
      try {
        const rChu = await registrarRetiroEnChunior(bilObjR.CHUNIOR_UID, montoFinal, usuario);
        if(rChu.ok && rChu.movimientoId) movChuniorP = rChu.movimientoId;
        else if(rChu.error) toast('⚠️ Retiro OK pero falló en Chunior: '+rChu.error, 'red');
      } catch(e){ toast('⚠️ Error en Chunior: '+(e.message||''), 'red'); }
    }
    await registrarEnHistorial({usuario, tipo:'RETIRO', monto:montoFinal, billetera_id:bilId||null, billetera_nombre:bilObjR.NOMBRE_VISIBLE||null, origen:'PANEL', estado:'OK', notas:obs||null, solicitud_id:id, chunior_movimiento_id:movChuniorP});
    // Comparamos fichas solo si Chunior confirmó
    if(movChuniorP) _watchdogTrigger(1500);
    await refrescarTodo(false);
  },"Pagar retiro");

  // actualiza el indicador de saldo al cambiar billetera o monto
  setTimeout(()=>{
    const sel  = document.getElementById("retBilletera");
    const info = document.getElementById("retSaldoInfo");
    const montoInput = document.getElementById("retMonto");
    const update = ()=>{
      if(!sel||!info) return;
      const b = billeteras.find(x=>String(x.ID_BILLETERA)===String(sel.value));
      const saldo  = b ? Number(b.SALDO||0) : 0;
      const monto  = Number(montoInput?.value||montoSol||0);
      const ok     = saldo >= monto;
      info.textContent = b ? `Saldo disponible: ${money(saldo)} ${ok?"✅":"⚠️ insuficiente"}` : "";
      info.style.color = ok ? "var(--green)" : "var(--red)";
    };
    sel?.addEventListener("change", update);
    montoInput?.addEventListener("input", update);
    update();
  }, 80);
}
function abrirRechazarSolicitud(id){
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));

  abrirModal("Rechazar solicitud",`
    <label>Motivo (se le envía al usuario)</label>
    <textarea id="rechObs" placeholder="Ej: no nos llegó tu transferencia / comprobante repetido"></textarea>
  `,async()=>{
    const motivo = val("rechObs") || "Rechazada por el operador";

    const r = await actualizarSolicitudSupabase(id, {
      estado:"RECHAZADA",
      operador_usuario:operador.usuario || operador.nombre || ""
    });

    if(!r.ok){ alert(r.error || "Error"); return; }

    const usuario = s?.USUARIO || s?.USUARIO_JUGADOR || "";
    const tipoEs = s ? normalizar(s.TIPO_SOLICITUD||s.TIPO) : "";
    if(usuario){
      const accion = tipoEs==="RETIRO"?"retiro":tipoEs==="CARGA"?"carga":tipoEs==="CAMBIO_CLAVE"?"cambio de clave":"solicitud";
      await notificarUsuarioEnChat(usuario, `❌ Tu ${accion} fue rechazada.\n📝 Motivo: ${motivo}`);
    }

    cerrarModal();
    toast("Solicitud rechazada","red");
    await refrescarTodo(false);
  },"Rechazar");
}

async function seleccionarBilletera(id){
  // SAFE: el rail puede mostrar billeteras detectadas desde Chunior con id sintético "CH_1170".
  // Para marcarla en PORTAL/LANDING primero resolvemos el id real de Supabase por chunior_uid.
  const rawId = String(id || '').trim();
  const local = (billeteras || []).find(x =>
    String(x.ID_BILLETERA) === rawId ||
    String(x.CHUNIOR_UID || '') === rawId.replace(/^CH_/i,'')
  );

  let realId = rawId;
  let uid = '';
  if(/^CH_/i.test(rawId)) uid = rawId.replace(/^CH_/i,'');
  if(!uid && local && local.CHUNIOR_UID) uid = String(local.CHUNIOR_UID);

  // Si el id no es numérico, buscar billetera real por UID en Supabase.
  if(!/^\d+$/.test(String(realId))){
    if(!uid){
      alert('No pude identificar el UID real de esta billetera. Sincronizá nuevamente.');
      return;
    }
    const {data, error} = await supabaseClient
      .from('billeteras')
      // SAFE: no pedimos oficina_id por REST porque en algunas instalaciones PostgREST
      // todavía no refrescó esa columna y rompe con "column billeteras.oficina_id does not exist".
      .select('id,nombre_visible,chunior_uid,pc_codigo,activa')
      .eq('chunior_uid', uid)
      .eq('activa', true)
      .order('seleccionada_manual',{ascending:false})
      .limit(1);
    if(error){ alert(error.message || 'Error buscando billetera real'); return; }
    if(!data || !data.length){
      alert('Esta billetera viene de Chunior pero todavía no tiene registro real activo en NODO. Revisá la sincronización.');
      return;
    }
    realId = String(data[0].id);
  }

  // Reset seguro sin oficina_id: limpiamos por TODOS los alias de la oficina actual (pcAliasesHist,
  // el mismo mecanismo que ya usa el resto del panel para agrupar nombres viejos/nuevos de una
  // misma oficina, ej. P1 = P1/PC1/XGENERALENUSO/XGENERAL/GENERAL/OFI_1) + por IDs visibles en
  // pantalla. Antes tenía además un reset hardcodeado a pc_codigo='P1' fijo que se ejecutaba
  // SIEMPRE sin importar qué oficina operara — cualquier oficina que pusiera SU billetera en
  // portal le apagaba de paso el "EN PORTAL" de P1. Sacado: debe ser solo la oficina actual (con
  // sus alias), para que valga igual para todas, existentes y futuras.
  if(pcOperativa){
    try{
      const _aliasesReset = (typeof pcAliasesHist === 'function') ? pcAliasesHist() : [pcOperativa];
      await supabaseClient.from('billeteras').update({seleccionada_manual:false}).in('pc_codigo', _aliasesReset);
    }catch(_e){}
  }
  try{
    const idsVisibles = (billeteras||[])
      .map(x=>String(x.ID_BILLETERA||x.id||''))
      .filter(x=>/^\d+$/.test(x));
    if(idsVisibles.length){
      await supabaseClient.from('billeteras').update({seleccionada_manual:false}).in('id', idsVisibles);
    }
  }catch(_e){}

  const {error}=await supabaseClient
    .from('billeteras')
    .update({seleccionada_manual:true, activa:true})
    .eq('id', realId);

  if(error){alert(error.message||'Error');return}
  toast('Billetera puesta en portal','green');
  await cargarBilleteras();
  try{ await refrescarTodo(false); }catch(_e){}
}

async function cambiarEstadoBilletera(id,estado){
  const {error}=await supabaseClient.rpc("panel_billetera_update",{p_secret:window.PANEL_DATA_SECRET,p_id:Number(id),p_patch:{activa:estado==="SI"}});
  if(error){alert(error.message||"Error");return}
  await cargarBilleteras();
}

function abrirChatExpandido(){
  if(window.matchMedia && window.matchMedia("(min-width:1101px)").matches){
    document.body.classList.add("chat-expanded");
    document.getElementById("navChat")?.classList.add("active");
  }
}
function cerrarChatExpandido(){
  document.body.classList.remove("chat-expanded");
}
document.addEventListener("keydown", function(e){
  if(e.key !== "Escape") return;
  // Esc contextual (agilidad en demanda):
  //   1) Conversación abierta → volver a la bandeja.
  //   2) En la bandeja (chat visible, desktop) → minimizar el chat.
  // No dispara si estás tipeando en un campo (para no minimizar por error operando).
  if(document.body.classList.contains("chat-expanded")){
    e.preventDefault();
    cerrarChatExpandido();
    return;
  }
  const ae = document.activeElement;
  const tipeando = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName||"");
  if(!tipeando && window.matchMedia && window.matchMedia("(min-width:1101px)").matches && !document.body.classList.contains("chat-min")){
    e.preventDefault();
    try{ window.nodoChatMin && nodoChatMin(true); }catch(_e){}
  }
});

function renderChatList(){
  if(!chats.length){setBox("chatList",`<div class="alert-box" style="margin:12px">No hay chats activos.</div>`);return}
  let html="";
  chats.forEach(c=>{
    const id=c.ID_CHAT||c.idChat||"";
    const unread=Number(c.SIN_LEER||0);
    html+=`<div class="chat-item ${id===chatActualId?"active":""}" onclick="abrirChat('${id}')">
      <div class="chat-item-title">
        <span>${c.USUARIO||"Usuario landing"}</span>
        ${unread?`<span class="chat-unread">${unread}</span>`:""}
      </div>
      <div class="small">${c.NOMBRE_COMPLETO||""} · ${formatFecha(c.FECHA_ULTIMO||c.FECHA||"")}</div>
      <div class="small">${escapeHtml(c.ULTIMO_MENSAJE||"")}</div>
    </div>`;
  });
  setBox("chatList",html);
}
async function abrirChat(id){
  chatActualId=id;
  abrirChatExpandido();
  renderChatList();
  if(enElectron) document.getElementById("chatAccionesRapidas")?.classList.remove("hidden");
  await cargarChatActual(false);
}
async function cargarChatActual(silencioso=false){
  if(!chatActualId)return;

  const {data,error}=await supabaseClient
    .from("mensajes_chat")
    .select("*")
    .eq("chat_id",chatActualId)
    .order("created_at",{ascending:true});

  if(error)return;

  chatMensajes=(data||[]).map(m=>({
    MENSAJE:m.mensaje||"",
    IMAGEN_URL:m.imagen_url||"",
    TIPO_EMISOR:m.tipo_emisor,
    EMISOR:m.emisor||"",
    FECHA:m.created_at
  }));

  renderChatMensajes();

  await supabaseClient
    .from("mensajes_chat")
    .update({leido:true})
    .eq("chat_id",chatActualId)
    .eq("tipo_emisor","USUARIO")
    .eq("leido",false);

  await supabaseClient
    .from("chats")
    .update({sin_leer:0})
    .eq("id",chatActualId);

  cargarChats(true);
}

function normalizarImagenUrl(url){
  const u = String(url || "");
  if(u.startsWith("data:image")) return u;
  const m1 = u.match(/\/d\/([^/]+)/);
  const m2 = u.match(/[?&]id=([^&]+)/);
  const id = m1 ? m1[1] : (m2 ? m2[1] : "");
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : u;
}

function renderChatMensajes(){
  const chat=chats.find(c=>String(c.ID_CHAT)===String(chatActualId))||{};
  setBox("chatTitulo",chat.USUARIO||"Chat landing");
  setBox("chatSubtitulo",`${chat.NOMBRE_COMPLETO||""} ${chat.TELEFONO? "· "+chat.TELEFONO:""}`);
  setBox("chatEstado",chat.SOLICITUD_ID?`Solicitud: ${chat.SOLICITUD_ID}`:"Sin solicitud");
  if(!chatMensajes.length){setBox("chatBody",`<div class="alert-box">Sin mensajes todavía.</div>`);return}
  let html="";
  chatMensajes.forEach(m=>{
    const tipo=normalizar(m.TIPO_EMISOR);
    const esUser=tipo==="USUARIO";
    const msgHtml = escapeHtml(m.MENSAJE||"").replace(/\n/g,"<br>");
    html+=`<div class="chat-msg ${esUser?"user":"op"}">
      <div class="chat-bubble" style="white-space:pre-wrap">
        ${msgHtml}
        ${m.IMAGEN_URL?`<img src="${normalizarImagenUrl(m.IMAGEN_URL)}" alt="Imagen">`:""}
      </div>
      <div class="chat-meta">${esUser?(chat.USUARIO||"Usuario"):(m.EMISOR||"Operador")} · ${formatFecha(m.FECHA)}</div>
    </div>`;
  });
  const box=document.getElementById("chatBody");
  box.innerHTML=html;
  box.scrollTop=box.scrollHeight;
}
async function enviarChat(){
  if(!chatActualId){
    alert("Seleccioná un chat primero.");
    return;
  }

  const mensaje=val("chatInput").trim();
  if(!mensaje && !chatImagenBase64)return;

  const {error}=await supabaseClient
    .from("mensajes_chat")
    .insert({
      chat_id:chatActualId,
      mensaje:mensaje||"",
      imagen_url:chatImagenBase64||null,
      tipo_emisor:"OPERADOR",
      emisor:operador.nombre,
      pc_codigo:pcOperativa,
      leido:true
    });

  if(error){alert(error.message||"Error al enviar mensaje");return}

  await supabaseClient
    .from("chats")
    .update({
      ultimo_mensaje:mensaje||"[imagen]",
      fecha_ultimo:new Date().toISOString()
    })
    .eq("id",chatActualId);

  document.getElementById("chatInput").value="";
  quitarImagenChat();

  setTimeout(()=>cargarChatActual(false),400);
  setTimeout(()=>cargarChatActual(false),2000);
}

function agregarMensajeLocalPanel(mensaje, imagen){
  const box = document.getElementById("chatBody");
  box.insertAdjacentHTML("beforeend", `
    <div class="chat-msg op">
      <div class="chat-bubble">
        ${escapeHtml(mensaje || "")}
        ${imagen ? `<img src="${imagen}" alt="Imagen">` : ""}
      </div>
      <div class="chat-meta">Operador · enviando...</div>
    </div>
  `);
  box.scrollTop = box.scrollHeight;
}
function marcarUltimoMensajePanelEnviado(){
  const metas = document.querySelectorAll("#chatBody .chat-msg.op .chat-meta");
  const last = metas[metas.length - 1];
  if(last && last.innerText.includes("enviando")) last.innerText = "Operador · enviado";
}
function tomarImagenChatFile(){
  const file=document.getElementById("chatFile").files[0];
  if(file)leerImagenChat(file);
}
async function subirImagenPanelChat(base64DataUrl){
  if(!supabaseClient||!base64DataUrl)return null;
  try{
    const res=await fetch(base64DataUrl);
    const blob=await res.blob();
    const ext=(blob.type.split('/')[1]||'jpg').replace('jpeg','jpg');
    const path=`op/${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
    const{error}=await supabaseClient.storage.from('chat-imagenes').upload(path,blob,{cacheControl:'3600',upsert:true,contentType:blob.type});
    if(error){console.error('[img upload panel]',error.message||error);return null;}
    const{data:ud}=supabaseClient.storage.from('chat-imagenes').getPublicUrl(path);
    return ud?.publicUrl||null;
  }catch(e){console.warn('[img upload panel]',e);return null;}
}
function leerImagenChat(file){
  if(!file.type.startsWith("image/")){
    alert("Pegá o adjuntá una imagen válida.");
    return;
  }

  comprimirImagenChat(file, async base64 => {
    chatImagenBase64 = base64;
    window.chatImagenBase64 = base64;
    window.chatImagenUrl = null;
    chatImagenNombre = (file.name || "captura.jpg").replace(/\.[^.]+$/, ".jpg");
    document.getElementById("chatPreviewImg").src = chatImagenBase64;
    document.getElementById("chatPreview").classList.add("show");
    // Subir al Storage — guardamos la promesa para que enviarChat pueda esperarla
    window._chatImgUploadPromise = subirImagenPanelChat(base64).then(url => {
      if(url){ window.chatImagenUrl = url; console.log('[img panel] URL lista:', url); }
      return url;
    });
  });
}
function quitarImagenChat(){
  chatImagenBase64="";
  chatImagenNombre="";
  window.chatImagenBase64="";
  window.chatImagenUrl=null;
  window._chatImgUploadPromise=null;
  document.getElementById("chatFile").value="";
  document.getElementById("chatPreviewImg").src="";
  document.getElementById("chatPreview").classList.remove("show");
}
document.addEventListener("paste",async e=>{
  const visible=!document.getElementById("viewChat").classList.contains("hidden");
  if(!visible)return;
  // intento 1: clipboardData (funciona en muchos contextos)
  const items=[...(e.clipboardData?.items||[])];
  const imgItem=items.find(it=>it.type?.startsWith("image/"));
  if(imgItem){const file=imgItem.getAsFile();if(file){e.preventDefault();leerImagenChat(file);return;}}
  // intento 2: Clipboard API (más robusto en Electron)
  try{
    const clips=await navigator.clipboard.read();
    for(const clip of clips){
      const t=clip.types.find(x=>x.startsWith("image/"));
      if(t){e.preventDefault();const blob=await clip.getType(t);leerImagenChat(new File([blob],"captura.jpg",{type:t}));return;}
    }
  }catch(_e){}
});
document.getElementById("chatInput")?.addEventListener("keydown",async e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();enviarChat();return;}
  if((e.key==="v"||e.key==="V")&&(e.ctrlKey||e.metaKey)){
    try{
      const clips=await navigator.clipboard.read();
      for(const clip of clips){
        const t=clip.types.find(x=>x.startsWith("image/"));
        if(t){e.preventDefault();const blob=await clip.getType(t);leerImagenChat(new File([blob],"captura.jpg",{type:t}));return;}
      }
    }catch(_e){}
  }
});

function verificarSolicitudes(silencioso=false){
  // Excluir SOPORTE: van al badge de Chat, no al de Solicitudes
  const pendientes=solicitudes.filter(s=>esPendiente(s) && String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()!=="SOPORTE");
  const ids=new Set(pendientes.map(s=>String(s.ID||s.SOLICITUD_ID||"")).filter(Boolean));
  const badge=document.getElementById("badgeSolicitudes");
  if(pendientes.length){badge.classList.remove("hidden");badge.innerText=pendientes.length}else badge.classList.add("hidden");
  let nuevas=0;ids.forEach(id=>{if(!lastPendientesIds.has(id))nuevas++});
  if(!silencioso||lastPendientesIds.size===0){lastPendientesIds=ids;return}
  if(nuevas>0){toast(`🔔 ${nuevas} nueva/s solicitud/es`);sonido("solicitud")}
  lastPendientesIds=ids;
}
function verificarChats(silencioso=false){
  const unread=chats.reduce((a,c)=>a+Number(c.SIN_LEER||0),0);
  const badge=document.getElementById("badgeChat");
  if(unread){badge.classList.remove("hidden");badge.innerText=unread}else badge.classList.add("hidden");
  if(silencioso && unread>lastChatUnread){toast("💬 Nuevo mensaje de chat");sonido("chat")}
  lastChatUnread=unread;
}
function sonido(tipo="msg"){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    osc.type="sine";osc.frequency.value=tipo==="chat"?660:520;gain.gain.value=.08;
    osc.start();setTimeout(()=>{osc.stop();ctx.close()},220);
  }catch(e){}
}

function abrirModal(title,body,saveFn,saveText="Guardar"){
  setBox("modalTitle",title);setBox("modalBody",body);
  const btn=document.getElementById("modalSaveBtn");
  btn.innerText=saveText;
  btn.disabled=false;
  btn.style.opacity='';
  // Sin texto (abrirModal(…, null, '')) el que llama no quiere botón: quedaba uno azul vacío.
  btn.style.display = saveText ? '' : 'none';
  // Siempre limpiar onclick antes de asignar el nuevo — evita contaminación entre modales
  btn.onclick = saveFn || null;
  // Restaurar el botón Cancelar al comportamiento por defecto
  const cancelBtn=document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn) cancelBtn.onclick=function(){ cerrarModal(); };
  document.getElementById("modalOverlay").classList.remove("hidden");
}
function cerrarModal(){document.getElementById("modalOverlay").classList.add("hidden")}

// ── Automatización (solo disponible en Electron) ──────────────────────────────
const enElectron = !!window.ctrlElectron;

if(enElectron){
  document.getElementById("navAuto")?.classList.remove("hidden");
  document.getElementById("agentBalanceCard")?.classList.remove("hidden");
  // navVerificaciones ya no existe (apartado eliminado) — el ?. lo deja sin efecto igual.
}

// ── Saldo del agente (widget del sidebar) ─────────────────────────────────────
async function refrescarSaldoAgente(){
  if(!enElectron) return;
  const el = document.getElementById("agentBalanceVal");
  // Esto es un WIDGET: no puede meterse en el medio de una operación. La cola de Agentes serializa
  // llamada por llamada, pero una carga son dos llamadas (buscar el usuario y después cargarle), y
  // este refresco de cada 60 s se colaba justo en el medio. En BET300 leer las fichas obliga a irse
  // a "tokens-report" y volver, así que la pantalla se movía abajo de la operación: el panel lo veía
  // como "la página se recargó durante la operación", reintentaba, y al minuto volvía a pasar. Ese
  // es el loop corto que siguen reportando las oficinas de BET300 (H-7).
  const _conCandado = typeof _drexGlobalLock === 'function' && typeof _drexGlobalUnlock === 'function';
  if(_conCandado && !_drexGlobalLock('saldo del agente')){
    if(el && !el.textContent.trim()) el.textContent = "—";
    return;                               // hay algo operando: se lee en el próximo minuto
  }
  if(el) el.textContent = "Cargando...";
  try{
    await window.ctrlElectron.openAgentWindow();
    const r = await callDrex("obtenerSaldoAgente");
    if(r && r.balance && r.balance.raw){ if(el) el.textContent = r.balance.raw.trim(); }
    else if(r && r.needsLogin){ if(el) el.textContent = "🔐 Login"; }
    else { if(el) el.textContent = "—"; }
  }catch(e){
    if(el) el.textContent = "⚠ Error";
  }finally{
    if(_conCandado) _drexGlobalUnlock();
  }
}
if(enElectron){
  // Refresca el saldo del agente cada 60 segundos
  setInterval(refrescarSaldoAgente, 60000);
  setTimeout(refrescarSaldoAgente, 4000); // 4s después del load inicial
}

// Rechequeo MANUAL de fichas (portado de NexoBetaChan): relee Drex + Chunior y compara AHORA.
window.rechequearFichas = async function(){
  if(typeof _watchdogPoll !== 'function') return;
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0){ try{ toast('Hay una operación en curso · se compara al terminar', 'yellow'); }catch(_e){} return; }
  try{ toast('Releyendo fichas de Drex y Chunior...', 'blue'); }catch(_e){}
  try{ await _watchdogPoll(); }catch(_e){}
};
// ── Watchdog de fichas: detecta diferencias entre Drex y Chunior ────────────
// Cada 60s lee ambos saldos y los compara. En operaciones normales se mueven en
// direcciones OPUESTAS con el mismo monto (carga: Drex -X, Chunior +X). Si no
// se cumple, hay alguien moviendo plata fuera de NODO o una carga repetida.
const _watchdog = {
  drexFichas: null,      // último Saldo agente leído de Drex (= fichas del agente)
  chuniorFichas: null,   // último "Saldo Fichas" leído de Chunior (mismo concepto)
  lastCheck: null,
  intervalId: null,
  alertaActiva: false,
  // Recovery
  drexLoginInProgress: false,   // evita abrir el modal de login Drex más de una vez
  chuniorFails: 0,              // contador de polls consecutivos sin Chunior
  chuniorRecoveryScheduled: false,
  // Lock: si una operación está usando la ventana de agentes, el watchdog
  // NO debe hacer su poll (porque navega la página y rompe la operación).
  busy: 0                        // contador (soporta operaciones anidadas)
};

// Helpers para que las operaciones se anuncien al watchdog
// ── Relevo watchdog → revisión de fichas de retiros ──────────────────────────────────────────
// Cuando el watchdog termina de leer, avisa acá: "ya terminé, empezá lo tuyo". Es un RELEVO, no
// paralelismo — corre después del ciclo, nunca encimado. Y sólo si el agente está libre: si hay
// otra solicitud en proceso, esto se saltea y espera al próximo ciclo (pasa cada pocos minutos,
// no hay apuro). Objetivo: confirmar que las fichas del retiro salieron de verdad de Agentes.
let _revFichasUltimo = 0;
function _revisarFichasRetirosTrasWatchdog(){
  if(Date.now() - _revFichasUltimo < 60000) return;          // como mucho una vez por minuto
  if(_watchdog.busy > 0) return;                             // el agente sigue tomado
  if(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes > 0)) return;
  if(window._v154pParcialBusy) return;                       // hay un parcial en curso
  if(window._cotejoDeclarando) return;
  if(window._retiroV2) return;                               // hay un modal de retiro abierto
  const sols = (window.V154P && V154P.solicitudes) || [];
  const pend = sols.filter(function(s){
    if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase() !== 'RETIRO') return false;
    return /EN_PROCESO|EN_REVISION|PROCESANDO|TOMAD/.test(String(s.ESTADO||'').toUpperCase());
  });
  if(!pend.length) return;                                   // no hay retiro que revisar
  _revFichasUltimo = Date.now();
  try{ window._revisarFichasRetiros && window._revisarFichasRetiros(pend); }catch(_e){}
}
window._revisarFichasRetirosTrasWatchdog = _revisarFichasRetirosTrasWatchdog;

// Confirma contra Agentes que las fichas del retiro salieron de verdad. Es SOLO LECTURA: lee el
// saldo del jugador y avisa. No aprueba, no anota, no toca plata — si algo no cuadra decide el
// operador. Revisa de a UN retiro por ciclo para no acaparar el agente.
window._revisarFichasRetiros = async function(pendientes){
  if(!Array.isArray(pendientes) || !pendientes.length) return;
  if(!window.ctrlElectron) return;
  const s = pendientes[0];
  const usuario = String(s.USUARIO||'').trim(); if(!usuario) return;
  if(!_drexGlobalLock('rev-fichas-retiro')) return;   // alguien lo tomó entre medio → al próximo ciclo
  _wdLock();
  try{
    const b = await callDrex('buscarUsuario', usuario, { skipBalance:false });
    if(!b || !b.exists || typeof b.balance?.value !== 'number') return;
    const saldo = b.balance.value;
    const pp = window._retiroParcialInfo ? window._retiroParcialInfo(s) : null;
    const falta = pp ? pp.restante : Number(s.MONTO_REAL||s.MONTO_DECLARADO||0);
    // Lo único que importa acá: ¿le quedaron fichas como para cubrir lo que todavía se le debe?
    // Si NO le alcanzan, el retiro no se puede terminar y el operador tiene que saberlo antes de
    // sentarse a transferir.
    if(falta > 0 && saldo + 0.5 < falta){
      try{ toast('⚠ '+usuario+': quedan '+money(falta)+' por pagar pero tiene '+money(saldo)+' en fichas','yellow'); }catch(_e){}
      console.warn('[rev-fichas] '+usuario+' · restan '+falta+' · fichas '+saldo);
    } else {
      console.log('[rev-fichas] '+usuario+' OK · restan '+falta+' · fichas '+saldo);
    }
    s.__fichasRevisadas = { saldo:saldo, ts:Date.now() };
  }catch(e){ console.warn('[rev-fichas] falló:', e.message||e); }
  finally{ _wdUnlock(); _drexGlobalUnlock(); }
};

function _wdLock(){   _watchdog.busy++; }
function _wdUnlock(){ if(_watchdog.busy > 0) _watchdog.busy--; }
// Reset duro a 0 — para los puntos de limpieza GARANTIZADA al final de una operación (o su
// timeout de seguridad), sin depender de contar bien cuántos _wdLock() anidados quedaron
// pendientes. Evita dejar el watchdog trabado para siempre por un desbalance de conteo.
function _wdForceUnlock(){ _watchdog.busy = 0; }

function _wdParseMontoAR(s){
  const m = String(s||'').match(/\$\s*([\d.,]+)/);
  if(!m) return null;
  const n = parseFloat(m[1].replace(/\./g,'').replace(',','.'));
  return isNaN(n) ? null : n;
}

// Lee el saldo de fichas del agente desde los DOS sistemas:
//   - Drex: agentBalance (lo que la página de agentes dice que tiene el agente)
//   - Chunior: "Saldo Fichas: $X" del header (lo que Chunior dice que tiene el agente)
// Estos DOS valores representan LO MISMO desde dos sistemas → deben matchear siempre.
// Las billeteras MP son cash, no fichas — no entran acá.
async function _watchdogLeer(){
  let drexFichas = null, chuniorFichas = null;
  // Si el panel YA sabe que no hay sesión, la cola cancela la lectura de abajo sin tocar Agentes y
  // r queda vacío: el poll caía en «Sin lectura de Drex» en vez de en la rama que abre el login, y
  // como nada más lo detectaba, quedaba encerrado ahí para siempre. Se arranca sabiéndolo.
  let drexNeedsLogin = !!window._drexSinSesion;
  let chuniorReachable = false;
  try {
    // La lectura de fichas es PERIÓDICA: si la cola está ocupada, SALTEA esta vuelta en vez de
    // encolarse (así no se apilan lecturas viejas que después se disparan todas juntas: era el
    // "vuelve a lanzarse"). Y si corre, va POR LA COLA — antes iba directo y se metía en medio de
    // una carga/retiro, navegando la ventana y volándole el modal a la operación en curso.
    const _colaOcupada = !!(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes > 0));
    if(window.ctrlElectron?.drexAutomation && !_colaOcupada){
      const r = await _drexEncolar('obtenerSaldoAgente(watchdog)', function(){
        return window.ctrlElectron.drexAutomation('obtenerSaldoAgente');
      }, { silencioso:true });   // tarea de fondo: no molesta al operador con toasts
      if(r){
        if(r.needsLogin) drexNeedsLogin = true;
        if(r.balance && typeof r.balance.value === 'number') drexFichas = r.balance.value;
      }
    } else if(_colaOcupada){
      console.log('[watchdog] fichas: hay una operación en curso → se saltea esta vuelta');
    }
  } catch(_){}
  try {
    if(window.chunior){
      const data = await window.chunior.exec(
        '(function(){' +
          // Buscar "Saldo Fichas: $X" (con o sin "Fichas"/"Ficha" y con ":" opcional)
          'var bodyText = document.body.textContent || "";' +
          'var fichas = null;' +
          'var sm = bodyText.match(/Saldo\\s*Fichas?\\s*:?\\s*\\$\\s*([\\d.,]+)/i);' +
          'if(sm){ var n = parseFloat(sm[1].replace(/\\./g,"").replace(",",".")); if(!isNaN(n)) fichas = n; }' +
          'var ok = !!(document.querySelector(".breadcrumbs") || document.getElementById("id_username") || document.getElementById("id_pt"));' +
          'return { fichas: fichas, reachable: ok };' +
        '})()'
      );
      if(data){
        chuniorReachable = !!data.reachable;
        if(typeof data.fichas === 'number') chuniorFichas = data.fichas;
      }
    }
  } catch(_){}
  return { drexFichas, chuniorFichas, drexNeedsLogin, chuniorReachable };
}

function _wdActualizarUI(estado, texto){
  const ind = document.getElementById("watchdogIndicator");
  if(ind){
    ind.className = estado || '';
    ind.textContent = texto;
  }
  try{ renderFichasInicio(estado, texto); }catch(_e){}
}

// Banner para diferencia absoluta (Drex saldo agente != Chunior Saldo Fichas)
function _wdMostrarBannerAbs(info){
  _watchdog.alertaActiva = true;
  _watchdog.drexFichas = info.drex;
  _watchdog.chuniorFichas = info.chunior;
  try{ renderFichasInicio('alerta','Diferencia detectada'); }catch(_e){}
  let banner = document.getElementById("watchdogBanner");
  if(!banner){
    banner = document.createElement('div');
    banner.id = "watchdogBanner";
    document.body.appendChild(banner);
  }
  const drexTxt    = money(info.drex);
  const chuniorTxt = money(info.chunior);
  const diffTxt    = (info.diff >= 0 ? '+' : '−') + money(Math.abs(info.diff));
  banner.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:18px">⚠️</span>' +
      '<span><b>DIFERENCIA de fichas detectada</b><br>' +
        '<span style="font-weight:400;font-size:12px">' +
          'Drex: <b>'+drexTxt+'</b> · Chunior: <b>'+chuniorTxt+'</b> · Diferencia: <b>'+diffTxt+'</b> · '+
          formatFecha(new Date().toISOString()) +
        '</span>' +
      '</span>' +
    '</div>' +
    '<button onclick="_wdDismissBanner()">Entendido</button>';
  toast('⚠️ Drex '+drexTxt+' ≠ Chunior '+chuniorTxt+' (Δ '+diffTxt+')', 'red');
}

function _wdDismissBanner(){
  const b = document.getElementById("watchdogBanner");
  if(b) b.remove();
  _watchdog.alertaActiva = false;
}

async function _watchdogPoll(){
  // Si una operación NODO está usando la ventana de agentes, NO pollear
  // (un obtenerSaldoAgente navega la página y rompe la operación en curso).
  if(_watchdog.busy > 0){
    _wdActualizarUI('', '⏸ Operación en curso · próximo check al terminar');
    return;
  }

  const ahora = await _watchdogLeer();

  // ── Recovery Drex: sesión cerrada → modal de login ──────────────────────
  if(ahora.drexNeedsLogin){
    // Todo por el mismo camino: deja el cartel fijo y vuelve a ofrecer el login con espacio entre
    // pedidos. Antes esto abría el modal por su cuenta y, si el operador lo cerraba,
    // drexLoginInProgress quedaba en true y no se lo pedía nunca más.
    try{ if(window._drexMarcarSinSesion) window._drexMarcarSinSesion('watchdog'); }catch(_e){}
    _wdActualizarUI('alerta', '🔐 Login de agentes requerido');
    return;
  }

  // ── Recovery Chunior: 3 fallos consecutivos ─────────────────────────────
  // ANTES: location.reload() del panel ENTERO a los 4s, sin mirar si había una
  // operación en vuelo → podía matar una carga a mitad de camino, y era otra
  // fuente de refresh automático. AHORA: se recarga SOLO la ventana de Chunior
  // (chunior.reload la recrea si está cerrada). El reload total del panel queda
  // como último recurso, únicamente si tras recargar Chunior sigue inalcanzable
  // y NO hay operación en curso.
  if(!ahora.chuniorReachable){
    _watchdog.chuniorFails++;
    _wdActualizarUI('alerta', '⚠ Chunior inalcanzable ('+_watchdog.chuniorFails+'/3)');
    if(_watchdog.chuniorFails >= 3 && !_watchdog.chuniorRecoveryScheduled){
      _watchdog.chuniorRecoveryScheduled = true;
      toast("⚠️ Chunior no responde · recargando la ventana de Chunior...", "red");
      Promise.resolve(window.chunior && window.chunior.reload()).then(function(){
        _watchdog.chuniorFails = 0;            // darle una nueva ronda de 3 chequeos
        _watchdog.chuniorRecoveryScheduled = false;
      }).catch(function(){
        // La ventana no se pudo recuperar → reinicio total, pero NUNCA con una
        // operación en vuelo (esperamos a que el candado se libere).
        (function reintentarReloadTotal(){
          if(_watchdog.busy > 0){ setTimeout(reintentarReloadTotal, 3000); return; }
          toast("⚠️ Chunior irrecuperable · Reiniciando NODO en 4s...", "red");
          setTimeout(function(){ if(_watchdog.busy > 0){ reintentarReloadTotal(); return; } location.reload(); }, 4000);
        })();
      });
    }
    return;
  }
  _watchdog.chuniorFails = 0;
  _watchdog.chuniorRecoveryScheduled = false;

  // Si falta alguna lectura, mostrar estado pero no comparar
  if(ahora.drexFichas === null || ahora.chuniorFichas === null){
    const falta = ahora.drexFichas === null ? 'Drex' : 'Chunior "Saldo Fichas"';
    _wdActualizarUI('', '⏸ Sin lectura de ' + falta);
    return;
  }

  // ── Comparación ABSOLUTA: Drex saldo agente == Chunior Saldo Fichas ──
  const diff = ahora.drexFichas - ahora.chuniorFichas;
  const TOL  = 1; // $1 de tolerancia para redondeos
  const matchOk = Math.abs(diff) <= TOL;

  _watchdog.drexFichas    = ahora.drexFichas;
  _watchdog.chuniorFichas = ahora.chuniorFichas;
  _watchdog.lastCheck     = Date.now();
  // El watchdog terminó su lectura y suelta el agente. Le pasa la posta a la revisión de fichas
  // de los retiros: DESPUÉS de este, nunca encimado. El watchdog sólo lee, así que no hay riesgo
  // de que dos cosas escriban plata — pero igual va en relevo, no en paralelo.
  try{ _revisarFichasRetirosTrasWatchdog(); }catch(_e){}

  const horaCheck = new Date().toLocaleTimeString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', hour:'2-digit', minute:'2-digit' });
  const fmt = function(v){ return money(v).replace('$ ','$'); };

  if(matchOk){
    if(_watchdog.alertaActiva){ _wdDismissBanner(); }
    _wdActualizarUI('ok',
      '✓ Fichas OK · Drex '+fmt(ahora.drexFichas)+' = Chunior '+fmt(ahora.chuniorFichas)+' · '+horaCheck
    );
    _watchdog.pendingReconfirm = false;
    return;
  }

  // ── Diferencia detectada — puede ser TRANSITORIA ──
  // Chunior tarda en propagar el "Saldo Fichas" del breadcrumb. Re-leemos en 4s.
  // Si en la 2da lectura coinciden, era transitoria. Si siguen sin coincidir → alerta REAL.
  if(!_watchdog.pendingReconfirm){
    _watchdog.pendingReconfirm = true;
    console.log('[watchdog] diferencia detectada · Drex='+ahora.drexFichas+' Chunior='+ahora.chuniorFichas+' diff='+diff+' · re-confirmando en 4s...');
    _wdActualizarUI('', '⏳ Verificando fichas (puede ser transitorio)...');
    setTimeout(async function(){
      const recheck = await _watchdogLeer();
      _watchdog.pendingReconfirm = false;
      if(recheck.drexFichas === null || recheck.chuniorFichas === null){
        _wdActualizarUI('', '⏸ Re-check abortado · sin lectura');
        return;
      }
      const diffR    = recheck.drexFichas - recheck.chuniorFichas;
      const horaR    = new Date().toLocaleTimeString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', hour:'2-digit', minute:'2-digit' });
      if(Math.abs(diffR) <= TOL){
        // Era transitorio
        console.log('[watchdog] diferencia transitoria resuelta · diff_final=' + diffR);
        _watchdog.drexFichas    = recheck.drexFichas;
        _watchdog.chuniorFichas = recheck.chuniorFichas;
        _wdActualizarUI('ok',
          '✓ Fichas OK · Drex '+fmt(recheck.drexFichas)+' = Chunior '+fmt(recheck.chuniorFichas)+' · '+horaR+' (re-confirmado)'
        );
      } else {
        // Diferencia CONFIRMADA después del re-check
        console.warn('[watchdog] DIFERENCIA CONFIRMADA tras re-check · diff=' + diffR);
        _watchdog.drexFichas    = recheck.drexFichas;
        _watchdog.chuniorFichas = recheck.chuniorFichas;
        _wdActualizarUI('alerta',
          '⚠ DIFERENCIA · Drex '+fmt(recheck.drexFichas)+' ≠ Chunior '+fmt(recheck.chuniorFichas)+' (Δ '+fmt(Math.abs(diffR))+')'
        );
        _wdMostrarBannerAbs({
          drex: recheck.drexFichas,
          chunior: recheck.chuniorFichas,
          diff: diffR
        });
      }
    }, 4000);
  }
}

function _watchdogIniciar(){
  if(_watchdog.iniciado) return;
  _watchdog.iniciado = true;
  // Lectura inicial para tener baseline en la UI
  setTimeout(_watchdogPoll, 8000);
  // YA NO hay polling periódico — los saldos solo cambian con cargas/retiros,
  // así que disparamos el check después de cada operación (ver _watchdogTrigger).
}

// Trigger debounced: se llama después de cada operación. Espera unos segundos
// para que Chunior alcance a actualizar su "Saldo Fichas" y después compara.
let _watchdogTriggerTimer = null;
function _watchdogTrigger(delayMs){
  if(_watchdog.busy > 0){
    // Si hay otra operación en curso, postergamos
    clearTimeout(_watchdogTriggerTimer);
    _watchdogTriggerTimer = setTimeout(function(){ _watchdogTrigger(1500); }, 2000);
    return;
  }
  clearTimeout(_watchdogTriggerTimer);
  _watchdogTriggerTimer = setTimeout(_watchdogPoll, delayMs || 3000);
}

if(enElectron){
  // Arranca el watchdog 12s después del load (da tiempo a que la ventana de Chunior esté lista)
  setTimeout(_watchdogIniciar, 12000);
}

// ── Scroll snap con histéresis del Inicio ─────────────────────────────────────
// Cuando el operador scrollea hacia abajo y CRUZARÍA la card de "Operación
// manual", lo frena seco en esa altura. Para destrabar (subir y mostrar
// billeteras/KPIs) hay que scrollear hacia ARRIBA dos veces seguidas. Bajar
// más allá del snap requiere también dos scrolls (no se "escapa" con uno).
(function initScrollSnap(){
  const main = document.querySelector('.main');
  if(!main) return;

  const HYST  = 2;     // cantidad de scrolls "consumidos" antes de destrabar
  const RESET = 600;   // ms sin scrollear para resetear contadores

  let snapY      = 0;
  let snapped    = false;
  let upAttempts = 0;
  let dnAttempts = 0;
  let resetTimer = null;

  function recalcSnapY(){
    const target = document.getElementById('cardOperacionManual');
    if(!target) return;
    const targetTop = target.offsetTop;
    const mainPad   = 12;
    snapY = Math.max(0, targetTop - mainPad);
  }

  function resetCounters(){ upAttempts = 0; dnAttempts = 0; }

  recalcSnapY();
  window.addEventListener('resize', recalcSnapY);
  const mo = new MutationObserver(() => { recalcSnapY(); });
  mo.observe(document.body, { childList: true, subtree: true, characterData: false });

  main.addEventListener('wheel', function(e){
    if(snapY <= 0) return;
    const viewInicioVisible = !document.getElementById('viewInicio')?.classList.contains('hidden');
    if(!viewInicioVisible){ snapped = false; return; }

    const y           = main.scrollTop;
    const goingDown   = e.deltaY > 0;
    const futureY     = y + e.deltaY;
    // Detectar CRUCE del snap point en cualquier dirección
    const cruzaAbajo  = goingDown && y < snapY && futureY >= snapY;
    const cruzaArriba = !goingDown && y > snapY && futureY <= snapY;

    clearTimeout(resetTimer);
    resetTimer = setTimeout(resetCounters, RESET);

    if(!snapped){
      // No enganchado todavía: si la rueda nos quiere meter del otro lado
      // del snap point, lo agarramos en seco.
      if(cruzaAbajo){
        e.preventDefault();
        main.scrollTop = snapY; // instantáneo, sin smooth
        snapped = true;
        upAttempts = 0;
        dnAttempts = 0;
      }
      // (cruzaArriba viniendo de abajo sin estar snapped no debería pasar
      //  porque al pasar por snap going down ya nos enganchamos, pero por
      //  las dudas no hacemos nada y dejamos pasar)
    } else {
      // Enganchado: cualquier scroll requiere HYST repeticiones
      if(!goingDown){
        upAttempts++;
        dnAttempts = 0;
        if(upAttempts >= HYST){
          snapped = false;
          upAttempts = 0;
        } else {
          e.preventDefault();
          main.scrollTop = snapY; // re-fijar por si el navegador ya movió algo
        }
      } else {
        dnAttempts++;
        upAttempts = 0;
        if(dnAttempts >= HYST){
          snapped = false;
          dnAttempts = 0;
        } else {
          e.preventDefault();
          main.scrollTop = snapY; // re-fijar
        }
      }
    }
  }, { passive: false });
})();

// ── Acciones rápidas desde el chat ────────────────────────────────────────────
function chatUsuarioActivo(){
  const c = chats.find(x=>String(x.ID_CHAT)===String(chatActualId));
  return c?.USUARIO || "";
}

async function chatAccionCargar(){
  const usuario = chatUsuarioActivo();
  const monto = Number(document.getElementById("chatCargarMonto")?.value||0);
  if(!usuario){ toast("Sin chat activo","red"); return; }
  if(!monto){ toast("Ingresá un monto","red"); return; }
  document.getElementById("chatCargarMonto").value = "";
  await cargarSaldoRapido(usuario, monto);
}

async function chatAccionRetirar(){
  const usuario = chatUsuarioActivo();
  const monto   = Number(document.getElementById("chatCargarMonto")?.value||0);
  if(!usuario){ toast("Sin chat activo","red"); return; }
  if(!monto || monto <= 0){ toast("Ingresá un monto válido","red"); return; }

  const check = await verificarRetiro24h(usuario);
  if(check.bloqueado){
    toast("⚠️ " + check.mensaje, "yellow");
    const proceder = await confirmarRetiroDuplicado(check);
    if(!proceder) return;
  }

  document.getElementById("chatCargarMonto").value = "";
  await retirarSaldoRapido(usuario, monto);
}

async function chatAccionResetClave(){
  const usuario = chatUsuarioActivo();
  if(!usuario){ toast("Sin chat activo","red"); return; }
  if(!confirm(`Resetear clave de "${usuario}" a 12345a?`)) return;
  await resetClaveRapido(usuario, "12345a");
}

// Valida al usuario en Agentes (casino) y lo agrega a la base de la oficina (vínculo usuario↔tel).
// Para onboardear usuarios nuevos legítimos de oficinas con base que el cotejo dejó en SOPORTE.
// NÚCLEO: verifica en Agentes y crea el vínculo. Sin prompt() (Electron no lo soporta) — los datos vienen del modal.
// ══════════════════════════════════════════════════════════════════════════
// COTEJO PREVIO DE ALTA (antes de explicarle nada al cliente)
// El cliente llega diciendo un "usuario" y un teléfono. Los verificamos POR SEPARADO contra la
// base: muchas veces declara "pepe" pero en sistema figura "pepe123xxs", o se come dígitos del
// teléfono. Detectarlo ANTES evita explicar todo el ingreso y descubrir el error al validar.
// Fuentes: base local de jugadores (gratis) + buscador WTK (1 RPC, debounced).
// ══════════════════════════════════════════════════════════════════════════
// Distancia de edición acotada: sirve para "casi igual" (pepe vs pepe123 / 3754532326 vs 3754532236).
function _altaDist(a, b){
  a=String(a||''); b=String(b||'');
  if(a===b) return 0;
  if(Math.abs(a.length-b.length) > 4) return 99;
  const m=a.length, n=b.length; let prev=new Array(n+1), cur=new Array(n+1);
  for(let j=0;j<=n;j++) prev[j]=j;
  for(let i=1;i<=m;i++){
    cur[0]=i;
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
    const t=prev; prev=cur; cur=t;
  }
  return prev[n];
}
function _altaNormU(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,''); }
function _altaNormTel(s){ return String(s||'').replace(/\D/g,''); }
// Un jugador de la base LOCAL cuenta como "en sistema" sólo si hay algo más que su propia palabra:
// un teléfono validado por un operador, un CBU de retiro (operó), un bono cobrado, o una operación
// en el historial. La base local también tenía guardado lo que DECLARABAN los pedidos del portal
// (ver requests.js): un alta nueva quedaba como jugador y el cotejo después decía "COINCIDEN" para
// alguien que no tenía cuenta. Esto limpia lo que ya quedó guardado en cada PC.
function _jugLocalConfiable(k, j){
  try{
    if(Object.values(j.telefonos||{}).some(function(p){ return p && p.verificado; })) return true;
    if(Object.keys(j.cbus||{}).length) return true;
    if(Array.isArray(j.bonos) && j.bonos.length) return true;
    const H = window._historialData || [];
    for(let i = 0; i < H.length; i++){ if(String(H[i].usuario||'').toLowerCase().trim() === k) return true; }
  }catch(_e){}
  return false;
}
// Devuelve { usuario:{exacto, similares[]}, telefono:{exacto, similares[]} }
window.altaCotejarDatos = async function(usuarioDecl, telefonoDecl){
  const uD=_altaNormU(usuarioDecl), tD=_altaNormTel(telefonoDecl);
  const out={ usuario:{exacto:null, similares:[]}, telefono:{exacto:null, similares:[], otros:[]} };
  // Índice de candidatos: base LOCAL de jugadores (gratis, ya en memoria)
  const cand={};  // key usuario → {usuario, telefonos:[], titular, fuente}
  try{
    const jug=(typeof _jugStoreAll==='function')?_jugStoreAll():{};
    Object.keys(jug).forEach(function(k){
      const j=jug[k]||{};
      cand[k]={ usuario:j.usuario||k, telefonos:Object.keys(j.telefonos||{}),
        titular:(Object.values(j.titulares||{})[0]||{}).raw||'', fuente:'local',
        confiable:_jugLocalConfiable(k, j) };
    });
  }catch(_e){}
  // Índice CRM ya cargado (sin llamada extra)
  try{
    (window._crmJugadoresData||[]).forEach(function(x){
      const k=String(x.usuario||'').toLowerCase(); if(!k) return;
      if(!cand[k]) cand[k]={ usuario:x.usuario, telefonos:[], titular:x.titular||'', fuente:'crm' };
      cand[k].confiable = true;   // viene del servidor
      if(x.telefono && cand[k].telefonos.indexOf(String(x.telefono))<0) cand[k].telefonos.push(String(x.telefono));
    });
  }catch(_e){}
  // Buscador WTK: UNA sola RPC con el término más informativo (el teléfono si vino, si no el usuario).
  try{
    const q=(tD.length>=6?tD:String(usuarioDecl||'').trim());
    if(q && q.length>=3 && typeof supabaseClient!=='undefined' && supabaseClient){
      const r=await supabaseClient.rpc('panel_crm_vinculos_buscar',{p_pc_codigos:null, p_query:q, p_limit:40, p_secret:window.PANEL_DATA_SECRET});
      if(!r.error && Array.isArray(r.data)){
        r.data.forEach(function(v){
          const k=String(v.usuario||'').toLowerCase(); if(!k) return;
          // Se guarda de QUÉ OFICINA es la fila. Este buscador va con p_pc_codigos:null, o sea que
          // trae las 9 oficinas — pero panel_vincular_usuario, que es el que decide, filtra por LA
          // TUYA. Sin esto la tarjeta te nombraba al dueño del teléfono en otra oficina y el
          // confirm te nombraba a otro distinto: dos veredictos para el mismo dato.
          if(!cand[k]) cand[k]={ usuario:v.usuario, telefonos:[], titular:v.titular||'', fuente:'wtk', pc:String(v.pc_codigo||'') };
          cand[k].confiable = true;   // viene del servidor
          // 6/10 · Esto ya venía y se tiraba a la basura.
          // panel_crm_vinculos_buscar devuelve estado_vinculo —el veredicto guardado— y la
          // tarjeta no lo miraba: ofrecía "usar grcieeela228" cuando la base ya la tenía
          // marcada como DUPLICADO y a gracieeela228 como VINCULADO. El operador veía tres
          // cuentas iguales y decidía a mano algo que ya estaba decidido.
          if(!cand[k].vinculo && v.estado_vinculo) cand[k].vinculo = String(v.estado_vinculo);
          if(!cand[k].pc && v.pc_codigo) cand[k].pc=String(v.pc_codigo);
          const t=_altaNormTel(v.telefono_canon||v.telefono);
          if(t && cand[k].telefonos.indexOf(t)<0) cand[k].telefonos.push(t);
          if(!cand[k].titular && v.titular) cand[k].titular=v.titular;
        });
      }
    }
  }catch(_e){}
  // Sólo lo que tiene respaldo. Una declaración suelta no es "una cuenta en el sistema".
  const lista=Object.values(cand).filter(function(c){ return c.confiable; });
  // ── USUARIO ──
  if(uD){
    lista.forEach(function(c){
      const cu=_altaNormU(c.usuario);
      if(cu===uD){ out.usuario.exacto=c; return; }
      // "pepe" vs "pepe123xxs": uno contiene al otro (mín 3 chars) o distancia ≤2
      const contiene = uD.length>=3 && (cu.indexOf(uD)===0 || uD.indexOf(cu)===0);
      const d=_altaDist(cu,uD);
      if(contiene || d<=2) out.usuario.similares.push(Object.assign({_d:contiene?0.5:d}, c));
    });
    out.usuario.similares.sort(function(a,b){ return a._d-b._d; });
    out.usuario.similares=out.usuario.similares.slice(0,4);
  }
  // ── TELÉFONO (independiente del usuario) ──
  if(tD && tD.length>=6){
    lista.forEach(function(c){
      (c.telefonos||[]).forEach(function(t){
        const tn=_altaNormTel(t); if(!tn) return;
        // OJO: NO preferir al usuario declarado acá. Lo intenté (para que tras reasignar un
        // teléfono no siguiera nombrando al dueño viejo) y rompí lo importante: si el declarado
        // aparece en el índice con ese teléfono, gana él y el cotejo dice "✓ mismo dueño" aunque
        // en la base el teléfono sea de OTRO. El conflicto quedaba tapado con un verde, el
        // operador validaba confiado, y recién ahí saltaba "ese teléfono es de natta473" — con el
        // aviso al cliente ya enviado con el usuario equivocado.
        // Este campo responde UNA pregunta: de quién es este teléfono. No se negocia con el
        // declarado; para eso está el cruce del pie, que compara los dos y muestra el conflicto.
        if(tn===tD){
          // Gana el de MI oficina. panel_vincular_usuario —el que realmente decide— filtra por
          // pc_codigo, así que si el teléfono figura en dos oficinas y acá mostrábamos el de la
          // otra, la tarjeta nombraba a un usuario y el confirm de vincular a otro distinto.
          const _mio = _altaNormU(c.pc||'')===_altaNormU(pcOperativa||'');
          const _yaMio = out.telefono.exacto && _altaNormU(out.telefono.exacto.pc||'')===_altaNormU(pcOperativa||'');
          // Todos los dueños de este número, con nombre y oficina. Antes sólo quedaba la bandera
          // "varios": la tarjeta podía avisar que el teléfono estaba repetido pero no tenía con qué
          // decir CON QUIÉN, que es lo único que el operador puede hacer algo al respecto.
          if(!out.telefono.otros.some(function(o){ return _altaNormU(o.usuario)===_altaNormU(c.usuario); })){
            out.telefono.otros.push({ usuario:c.usuario, pc:c.pc||'', _tel:tn, vinculo:c.vinculo||'' });
          }
          if(!out.telefono.exacto || (_mio && !_yaMio)) out.telefono.exacto=Object.assign({_tel:tn}, c);
          else if(_altaNormU(out.telefono.exacto.usuario)!==_altaNormU(c.usuario) && _mio===_yaMio) out.telefono.varios=true;
          return;
        }
        // mismos últimos 8 dígitos (prefijo/0/15 distinto) o ≤2 dígitos cambiados
        const cola = tn.length>=8 && tD.length>=8 && tn.slice(-8)===tD.slice(-8);
        const d=_altaDist(tn,tD);
        if(cola || d<=2) out.telefono.similares.push(Object.assign({_tel:tn,_d:cola?0.5:d}, c));
      });
    });
    out.telefono.similares.sort(function(a,b){ return a._d-b._d; });
    out.telefono.similares=out.telefono.similares.slice(0,4);
  }
  return out;
};
async function ejecutarVincular(usuario, telefono, desdeChat){
  usuario=String(usuario||"").trim(); telefono=String(telefono||"").trim();
  if(!usuario){ toast("Falta el usuario a vincular","red"); return; }
  if(!telefono){ toast("Falta el teléfono para vincular","red"); return; }
  // 1) Verificar que exista de verdad en Agentes (no vincular usuarios falsos)
  toast("Verificando "+usuario+" en Agentes...","blue");
  if(!await ensureDrexSession()){ toast("Abrí la sesión de Agentes para validar","red"); return; }
  let b=null;
  try{ if(typeof _wdLock==='function')_wdLock(); }catch(_e){}
  try{ b = await callDrex('buscarUsuario', usuario, {skipBalance:true}); }
  catch(e){ b=null; }
  finally{ try{ if(typeof _wdUnlock==='function')_wdUnlock(); }catch(_e){} }
  if(!b || !b.exists){ toast("⚠️ '"+usuario+"' no existe en Agentes. Creá la cuenta con ese usuario y reintentá.","red"); return; }
  // 2) Agregar a la base (crea el vínculo VINCULADO)
  try{
    const pcCod=(pcOperativa||window.pcOperativa||'');
    // La llamada normal NO manda p_forzar (así anda igual en el esquema viejo de 4 args y en el
    // nuevo de 5). Solo el reintento manda p_forzar:true (requiere el SQL nuevo aplicado).
    // Queda registrado QUIÉN validó. Antes el vínculo no guardaba el operador (la RPC ni siquiera
    // lo recibía), así que ante una cuenta dudosa no había forma de saber de dónde había salido.
    const _opVinc = (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre)) || '';
    const _vinc=async(forzar)=> forzar
      ? await supabaseClient.rpc('panel_vincular_usuario',{p_secret:window.PANEL_DATA_SECRET,p_pc_codigo:pcCod,p_usuario:usuario,p_telefono:telefono,p_forzar:true,p_operador:_opVinc})
      : await supabaseClient.rpc('panel_vincular_usuario',{p_secret:window.PANEL_DATA_SECRET,p_pc_codigo:pcCod,p_usuario:usuario,p_telefono:telefono,p_operador:_opVinc});
    let r=await _vinc(false);
    let d=(r&&r.data)||{};
    let _notaEvento=null;   // se completa si hubo que reasignar el teléfono desde otro usuario
    if(r.error || !d.ok){
      // Caso MUY común: el teléfono ya figura vinculado a "otro" usuario, pero en realidad es la
      // MISMA persona con el nombre viejo/sucio de Whaticket (ej: "martincordoba(pr5)" con la oficina
      // pegada, que el limpiador parsea mal). Ofrecemos reasignar el teléfono al usuario correcto:
      // eso además deja el nombre limpio y arregla el cotejo del portal para ese usuario.
      if(d.conflicto_tel){
        const otro=d.usuario_actual||"otro usuario";
        // El confirm dice EXPLÍCITO qué cuenta va a quedar y qué mensaje le llega al cliente. Sin
        // eso el operador aceptaba pensando "sí, es la misma persona" y terminaba mandándole al
        // cliente el usuario del OTRO — o sea, acceso a una cuenta ajena.
        if(!confirm(
          "⚠ CONFLICTO DE TELÉFONO\n\n"+
          "El teléfono "+telefono+" hoy figura de «"+otro+"».\n"+
          "Vos estás validando a «"+usuario+"».\n\n"+
          "Si aceptás:\n"+
          "  · el teléfono pasa a «"+usuario+"»\n"+
          "  · «"+otro+"» queda SIN ese teléfono\n"+
          "  · al cliente se le avisa que entre como «"+usuario+"»\n\n"+
          "¿Son la misma persona?")) return;
        r=await _vinc(true); d=(r&&r.data)||{};
        if(r.error || !d.ok){ toast("No se pudo reasignar: "+((r.error&&r.error.message)||d.mensaje||"error"),"red"); return; }
        _notaEvento = 'Teléfono reasignado desde «'+otro+'»';
      } else {
        toast("No se pudo vincular: "+((r.error&&r.error.message)||d.mensaje||"error"),"red"); return;
      }
    }
    // 3) Toast YA (no esperamos el envío del aviso → sensación instantánea).
    toast("✅ "+usuario+" vinculado. Avisándole por el chat con el botón para ingresar…","green");
    // Base local de jugadores: la vinculación nos da usuario+teléfono CONFIRMADOS (KYC-lite).
    try{ if(window.jugadorRegistrarDato) window.jugadorRegistrarDato(usuario, { telefono:telefono, verificado:true }); }catch(_e){}
    // Historial del CRM: queda registrada la validación (quién, cuándo, con qué teléfono). Si el
    // teléfono cambió, el anterior sigue visible en la ficha para poder verificar antes de validar.
    try{
      supabaseClient.rpc('panel_usuario_evento', {
        p_pc_codigo: pcCod, p_usuario: usuario, p_evento: 'VALIDACION',
        p_telefono_nuevo: telefono, p_nota: _notaEvento,
        p_operador: (typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre)) || '',
        p_secret: window.PANEL_DATA_SECRET
      });
    }catch(_e){}
    // AGENDADO → Nexo: el alta ya queda en la base local; disparamos el sync para que Nexo reciba
    // la ficha (alias+teléfono) aunque el usuario todavía no haya cargado nunca.
    try{ if(window._nexoTrigger) window._nexoTrigger(); }catch(_e){}
    // Modal de RESULTADO (antes solo había feedback cuando fallaba): simple, para ver y agendar.
    try{ _altaModalResultado(usuario, telefono); }catch(_e){}
    // Repintar el cotejo con el vínculo YA guardado (si no, se queda en "NO COINCIDEN" por caché).
    try{ window._altaCotejoRefrescar && window._altaCotejoRefrescar(); }catch(_e){}
    // Aviso al usuario por el chat del portal con su info de ingreso + botón "Ingresar" (background).
    try{
      if(typeof window.nodoEnviarMensajePortal==="function"){
        // La marca lleva usuario|telefono CORREGIDOS: si el operador cambió el tel (o el usuario), el
        // portal revalida con los datos buenos y el botón "Ingresar" funciona sin re-loguear.
        const msg="✅ ¡Listo! Ya validamos tu cuenta.\n\nPara entrar al portal usá:\n👤 Usuario: "+usuario+"\n📱 Teléfono: "+telefono+"\n\nTocá el botón *Ingresar* acá abajo 👇\n⟦INGRESAR:"+usuario+"|"+telefono+"⟧";
        window.nodoEnviarMensajePortal(usuario,msg,desdeChat).then(rr=>{
          if(rr&&rr.ok) return;
          const _e=(rr&&rr.error)||"?";
          console.warn("aviso 'Ingresar' no ruteado ("+_e+") — el portal lo detecta igual por auto-chequeo");
          // Esto se comía el fallo en la consola: el operador creía que el cliente ya tenía sus
          // datos, el cliente no recibía nada, y terminaba validando dos veces para que saliera.
          try{
            toast(_e==="sin-ticket"
              ? "⚠ "+usuario+" quedó validado, pero no tiene chat abierto donde mandarle los datos · copiáselos y mandáselos vos"
              : "⚠ "+usuario+" quedó validado, pero el aviso por chat no salió ("+_e+") · mandáselo a mano",
              "yellow");
          }catch(_t){}
        }).catch(_e=>{});
      }
    }catch(_e){}
  }catch(e){ toast("Error al vincular: "+(e.message||e),"red"); }
}
// MODAL de vinculación (inputs HTML reales → anda en Electron). Permite ajustar el usuario si en el casino quedó con otro nombre.
// prefill=true → pre-carga el usuario (caso usuario EXISTENTE que cayó en soporte).
// prefill=false → usuario VACÍO (caso NUEVO: el operador crea la cuenta; el apodo va solo de referencia).
// El teléfono SIEMPRE se pre-carga (es el que ingresó en el portal → así el vínculo queda tel↔usuario REAL).
function abrirModalVincular(usuarioSugerido, telefono, prefill, desdeChat){
  usuarioSugerido=String(usuarioSugerido||"").replace(/^alta-/i,"").trim(); telefono=String(telefono||"").trim();
  // Guardamos lo que DECLARÓ el cliente: si el operador todavía no escribió el usuario real, el
  // cotejo igual verifica ese alias por su cuenta (antes, con el campo vacío, no se cotejaba nada).
  window.__altaUsuarioDeclarado = usuarioSugerido;
  // Escape propio: la función E() vive dentro de closures y no está en este scope top-level (antes rompía el botón).
  const escV=(v)=>String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  if(typeof abrirModal!=="function"){ return ejecutarVincular(prefill?usuarioSugerido:"", telefono, desdeChat); }
  const valUsuario = prefill ? escV(usuarioSugerido) : "";
  const hint = usuarioSugerido ? `<div style="font-size:12px;margin-bottom:8px;color:#c6d0de">Pidió alta como <b style="color:#fde68a">"${escV(usuarioSugerido)}"</b>${prefill?"":" (apodo — el usuario real lo creás vos)"}.</div>` : "";
  abrirModal("🔗 Validar y vincular usuario",
    hint +
    `<div style="font-size:12px;line-height:1.6;margin-bottom:8px"><b>1)</b> Creá la cuenta en Agentes. <b>2)</b> Escribí abajo el <b>usuario REAL que creaste</b>. <b>3)</b> Confirmá: se verifica en Agentes y se vincula al teléfono. Después pasale ese usuario al cliente para que ingrese.</div>
     <label>Usuario en Agentes (el que creaste)</label>
     <input id="vincUsuarioInp" type="text" value="${valUsuario}" placeholder="usuario que creaste en el casino" autocomplete="off" oninput="_altaCotejoTrigger()">
     <label style="margin-top:6px">Teléfono (el que ingresó en el portal)</label>
     <input id="vincTelInp" type="text" value="${escV(telefono)}" placeholder="con código de área" autocomplete="off" oninput="_altaCotejoTrigger()">
     <div id="altaCotejoBox" style="margin-top:8px"></div>
     <div id="altaTelBox" style="margin-top:8px"></div>
     <div id="altaPrevalBox" style="margin-top:8px"></div>`,
    async function(){
      const u=String((document.getElementById("vincUsuarioInp")||{}).value||"").trim();
      const tel=String((document.getElementById("vincTelInp")||{}).value||"").trim();
      if(!u){ toast("Completá el usuario que creaste","red"); return; }
      if(!tel){ toast("Completá el teléfono","red"); return; }
      cerrarModal();
      await ejecutarVincular(u, tel, desdeChat);
    }, "Verificar y vincular");
  setTimeout(_altaCotejoTrigger, 150);   // cotejo inicial con lo que ya vino pre-cargado
}
// Construye la TARJETA del cotejo. Verifica el USUARIO por su cuenta, el TELÉFONO por su cuenta,
// y además CRUZA ambos.
// Diseño: la tarjeta ARRANCA con el veredicto (semáforo). Antes el veredicto quedaba abajo de todo,
// después de 6 líneas de datos crudos, y el alias se repetía 4 veces → el operador tenía que leer
// todo para saber si podía seguir. Ahora: estado de un vistazo, y el detalle solo si aporta.
// onPick = función global que recibe (usuario, telefono). titulo = contexto (esquina derecha).
function _altaCotejoHtml(uDecl, tDecl, r, onPick, titulo){
  const esc=escapeHtml, tN=_altaNormTel(tDecl);
  const telsDe=function(c){ return ((c&&c.telefonos)||[]).map(_altaNormTel).filter(Boolean); };
  const uOk=r.usuario.exacto, tOk=r.telefono.exacto;
  const duenoTel = tOk?_altaNormU(tOk.usuario):null;
  const uReal    = uOk?_altaNormU(uOk.usuario):null;
  const uDeclN   = _altaNormU(uDecl);
  // ¿El teléfono declarado es el PROPIO del usuario con un error de tipeo? Es el "REVISAR" más
  // común, y hay que decirlo en claro: es él, tecleó mal, el bueno es tal. Mismos criterios de
  // parecido que el cotejo (últimos 8 dígitos iguales, o 2 dígitos de diferencia como mucho).
  const _telsPropios = uOk ? telsDe(uOk) : [];
  const _typoPropio = (uOk && !tOk && tN.length >= 6 && _telsPropios.indexOf(tN) < 0)
    ? (_telsPropios.find(function(t){
        return (t.length >= 8 && tN.length >= 8 && t.slice(-8) === tN.slice(-8)) || _altaDist(t, tN) <= 2;
      }) || null)
    : null;
  const _dif = _typoPropio ? (tN.length - _typoPropio.length) : 0;
  const _queTiene = !_typoPropio ? ''
    : _dif === -1 ? 'le falta un dígito'
    : _dif < -1   ? 'le faltan ' + (-_dif) + ' dígitos'
    : _dif === 1  ? 'le sobra un dígito'
    : _dif > 1    ? 'le sobran ' + _dif + ' dígitos'
    : 'tiene un dígito cambiado';

  // Un chip solo tiene sentido si CAMBIA algo: si sugiere lo mismo que ya declaró el cliente era
  // ruido puro (el caso más común mostraba "✔ usar aylinssf" justo debajo de "aylinssf").
  // forzar=true para los chips del pie, donde elegir entre las dos personas SÍ es la decisión.
  const chip=function(u,t,label,tono,forzar){
    if(!forzar && _altaNormU(u)===uDeclN && (!t || _altaNormTel(t)===tN)) return '';
    const c = tono==='rojo' ? '#ff7b72' : tono==='ambar' ? '#e3b341' : '#58a6ff';
    return '<button type="button" onclick="'+onPick+'(\''+esc(String(u).replace(/'/g,"\\'"))+'\',\''+esc(String(t||''))+'\')"'
      + ' style="cursor:pointer;background:rgba(255,255,255,.04);border:1px solid '+c+'66;color:'+c
      + ';border-radius:999px;padding:3px 9px;font-size:10.5px;font-weight:700;margin:4px 4px 0 0">'+label+'</button>';
  };
  // Fila de dato: rótulo fijo a la izquierda para que usuario y teléfono queden alineados.
  const fila=function(rot, valor, badge, badgeCol, extra){
    return '<div style="display:grid;grid-template-columns:60px 1fr;gap:9px;align-items:baseline;padding:3px 0">'
      +   '<span style="font-size:9px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#6e7681">'+rot+'</span>'
      +   '<div style="min-width:0">'
      +     '<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:700;color:#f0f6fc;word-break:break-all">'+valor+'</span>'
      +     (badge?'<span style="font-size:10.5px;color:'+badgeCol+';margin-left:7px">'+badge+'</span>':'')
      +     (extra||'')
      +   '</div>'
      + '</div>';
  };
  const sub=function(t){ return '<div style="font-size:10.5px;color:#8b949e;margin-top:1px">'+t+'</div>'; };

  let filas='', alerta=false, _telCompartido=false;
  // ── 1) USUARIO declarado (INDEPENDIENTE del teléfono) ──
  if(uDecl){
    if(uOk){
      const tl=telsDe(uOk);
      // El teléfono del usuario solo se muestra si NO es el declarado; si no, se repite en la fila de abajo.
      const otroTel = tl.filter(function(x){ return x!==tN; })[0];
      // 6/10 · Juan: "la idea es que eso de ahi arriba te distinga un usuario que no esta
      // validado = no ve el cbu". El veredicto ya estaba guardado en el padrón; acá se usa.
      const _ver = (window.NodoDomain && window.NodoDomain.identidad)
        ? window.NodoDomain.identidad.veredicto(uOk.vinculo)
        : { validado:false, etiqueta:'', detalle:'', color:'#8b949e' };
      const _sello = _ver.etiqueta
        ? ' <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding:1px 6px;border-radius:999px;color:'+_ver.color+';background:rgba(255,255,255,.06)">'+esc(_ver.etiqueta)+'</span>'
        : '';
      const _avisoVal = _ver.validado
        ? ''
        : sub('<b style="color:#e3b341">No ve el CBU hasta que lo valides.</b> '+esc(_ver.detalle));
      filas+=fila('Usuario', esc(uDecl), '✓ en sistema'+_sello, _ver.validado?'#3fb950':'#e3b341',
        _avisoVal
        + ((otroTel && !_typoPropio) ? sub('registrado con 📱 '+esc(otroTel))
                : (tl.length ? '' : sub('sin teléfono registrado'))));
    } else if(r.usuario.similares.length){
      alerta=true;
      // Un alias corto ("lau") es el principio de media base: sugerir cuatro cuentas que sólo
      // empiezan igual no ayuda, confunde — el operador no tiene con qué elegir. Vale la
      // sugerencia cuando además coincide el TELÉFONO declarado; si no, se muestran dos a lo
      // sumo y se dice que son sólo parecidos.
      const _conTel = r.usuario.similares.filter(function(c){
        return telsDe(c).some(function(t){
          return t===tN || (t.length>=8 && tN.length>=8 && t.slice(-8)===tN.slice(-8));
        });
      });
      // SÓLO se sugiere con evidencia dura: que la cuenta tenga el MISMO teléfono que declaró.
      // Un alias parecido no prueba nada — «martin2024» y «martin2025» pueden ser dos personas
      // distintas. Sugerirlas mandaba al operador a revisar cuentas ajenas y a preguntarle cosas
      // al cliente por una corazonada (Juan, 27/9).
      const _mostrar = _conTel.length ? _conTel.slice(0,3) : [];
      const _nota = _conTel.length
        ? 'Tiene el teléfono que declaró — es casi seguro su cuenta.'
        : 'Ninguna cuenta tiene el teléfono que declaró. Si dice tener cuenta, pedile el usuario completo.';
      filas+=fila('Usuario', esc(uDecl), '⚠ no figura así', '#e3b341',
        sub(_nota)
        + (_mostrar.length ? '<div>'+_mostrar.map(function(c){ const tl=telsDe(c);
            return chip(c.usuario, tl[0]||tN, esc(c.usuario)+(tl.length?(' · '+esc(tl[0])):''), 'ambar'); }).join('')+'</div>' : ''));
    } else {
      filas+=fila('Usuario', esc(uDecl), '✗ no hay cuenta con este usuario', '#8b949e', '');
    }
  }
  // ── 2) TELÉFONO declarado (INDEPENDIENTE del usuario) ──
  if(tN.length>=6){
    if(tOk){
      // Si el teléfono figura en MÁS DE UN usuario, no hay "mismo dueño" posible: es ambiguo y
      // tiene que decidirlo el operador. Nunca en verde.
      const mismoDueno = !r.telefono.varios && (duenoTel===uReal || duenoTel===uDeclN);
      // Las otras cuentas con este MISMO número (sin repetir al que ya se muestra como dueño).
      const _otrosDuenosTodos = (r.telefono.otros||[]).filter(function(o){
        return _altaNormU(o.usuario)!==_altaNormU(tOk.usuario);
      });
      // 6/10 · Una cuenta marcada DUPLICADO ya se resolvió: no es una opción, es ruido. La
      // tarjeta las ofrecía igual, con su botón "usar ...", y cada vez que alguien apretaba
      // uno nacía otra cuenta en el padrón — de ahí salen los "lo comparten 3 cuentas".
      const _esDup = function(o){
        return (window.NodoDomain && window.NodoDomain.identidad)
          ? !window.NodoDomain.identidad.veredicto(o.vinculo).ofrecer : false;
      };
      const _otrosDuenos   = _otrosDuenosTodos.filter(function(o){ return !_esDup(o); });
      const _duplicadosYa  = _otrosDuenosTodos.filter(_esDup);
      const _tambienElDecl = (r.telefono.otros||[]).some(function(o){
        const n=_altaNormU(o.usuario); return n===uReal || n===uDeclN;
      });
      if(mismoDueno){
        filas+=fila('Teléfono', esc(tN), '✓ mismo dueño', '#3fb950', '');
      } else if(r.telefono.varios && _tambienElDecl && !_otrosDuenos.length && _duplicadosYa.length){
        // El número figura en varias cuentas PERO las otras ya están resueltas: son duplicados
        // conocidos. No hay nada que preguntarle al cliente. Antes esto salía igual que un
        // conflicto abierto y mandaba al operador a decidir algo ya decidido.
        filas+=fila('Teléfono', esc(tN), '✓ es suyo', '#3fb950',
          sub('Las otras '+_duplicadosYa.length+' cuentas con este número ya están marcadas como duplicadas: '
              + _duplicadosYa.map(function(o){ return esc(o.usuario); }).join(', ')
              + '. No hay que preguntar nada.'));
      } else if(r.telefono.varios && _tambienElDecl && _otrosDuenos.length){
        // El teléfono SÍ es del jugador, pero no es sólo suyo. Antes acá salía "⚠ es de veronica59x"
        // con veronica59x declarada: parecía un error del panel, no decía con qué otra cuenta lo
        // comparte —lo único accionable— y el cartel de arriba decía REVISAR sin motivo a la vista.
        alerta=true; _telCompartido=true;
        const _nom=function(o){
          return '<b style="color:#f0f6fc">'+esc(o.usuario)+'</b>'
            + (o.pc && _altaNormU(o.pc)!==_altaNormU(pcOperativa||'') ? ' <span style="color:#8b949e">(oficina '+esc(o.pc)+')</span>' : '');
        };
        filas+=fila('Teléfono', esc(tN), '⚠ lo comparten '+(_otrosDuenos.length+1)+' cuentas', '#e3b341',
          sub('Es de <b style="color:#f0f6fc">'+esc(uDecl||tOk.usuario)+'</b>, y el mismo número está también en '
              + _otrosDuenos.map(_nom).join(', ')
              + '. Si es la misma persona con dos cuentas, seguí; si no, preguntale cuál usa.'
              + (_duplicadosYa.length ? (' ('+_duplicadosYa.length+' más ya están marcadas como duplicadas y no se cuentan acá.)') : ''))
          + '<div>'+_otrosDuenos.map(function(o){
              return chip(o.usuario, tN, 'usar '+esc(o.usuario), 'ambar', true); }).join('')+'</div>');
      } else {
        const grave = !!uDecl;                       // sin usuario declarado es dato, no contradicción
        if(grave) alerta=true;
        // ¿El conflicto es en MI oficina o en otra? No es lo mismo: si el teléfono está tomado en
        // otra oficina, vincular acá no lo va a liberar allá — y el confirm de vincular sólo mira
        // la mía, así que ahí ni siquiera va a aparecer el conflicto.
        const _pcOtro = String(tOk.pc||'');
        const _esOtraOfi = _pcOtro && _altaNormU(_pcOtro)!==_altaNormU(pcOperativa||'');
        filas+=fila('Teléfono', esc(tN),
          (grave?'⚠ es de ':'📱 es de ')+'<b>'+esc(tOk.usuario)+'</b>'+(_esOtraOfi?(' <span style="font-size:9.5px;color:#8b949e">· oficina '+esc(_pcOtro)+'</span>'):''),
          grave?'#e3b341':'#58a6ff',
          (_esOtraOfi ? sub('Está tomado en OTRA oficina — vincular acá no lo libera allá') : '')
          + '<div>'+chip(tOk.usuario, tN, 'usar '+esc(tOk.usuario), grave?'ambar':'azul')+'</div>');
      }
    } else if(_typoPropio){
      alerta=true;
      filas+=fila('Teléfono', esc(tN), '⚠ '+_queTiene, '#e3b341',
        sub('El de <b style="color:#f0f6fc">'+esc(uOk.usuario)+'</b> es <b style="color:#f0f6fc">'+esc(_typoPropio)+'</b>'
          + (tN.length !== 10 ? ' · un número argentino tiene 10 dígitos y este tiene '+tN.length : ''))
        + '<div>'+chip(uOk.usuario, _typoPropio, 'usar '+esc(_typoPropio), 'ambar', true)+'</div>');
    } else if(r.telefono.similares.length){
      alerta=true;
      filas+=fila('Teléfono', esc(tN), '⚠ no figura', '#e3b341',
        sub('¿un dígito de más o de menos?')
        + '<div>'+r.telefono.similares.map(function(c){
            return chip(c.usuario, c._tel, esc(c.usuario)+' · '+esc(c._tel), 'ambar'); }).join('')+'</div>');
    } else {
      filas+=fila('Teléfono', esc(tN), '✗ no figura en ninguna cuenta', '#8b949e', '');
    }
  }
  // ── 3) CRUCE: ¿el usuario y el teléfono son de la MISMA persona? ──
  // Solo se escribe el pie cuando hay algo que DECIDIR. Si coinciden, ya lo dice el semáforo.
  let pie='', conflicto=false;
  if(uDecl && tN.length>=6){
    if(uReal && duenoTel && duenoTel!==uReal){
      conflicto=true;
      pie='<b>'+esc(uOk.usuario)+'</b> y el teléfono de <b>'+esc(tOk.usuario)+'</b> son personas distintas.'
        + '<div>'+chip(uOk.usuario, telsDe(uOk)[0]||'', 'seguir con '+esc(uOk.usuario), 'rojo', true)
        +        chip(tOk.usuario, tN, 'seguir con '+esc(tOk.usuario), 'rojo', true)+'</div>';
    } else if(!uReal && duenoTel && duenoTel!==uDeclN){
      // Si el dueño del teléfono es uno de los ALIAS PARECIDOS, no es un choque de personas: es el
      // typo que el cotejo está para agarrar. Marcarlo rojo era una alarma falsa, y el rojo que
      // suena de más se termina ignorando justo cuando el choque es real.
      const esTypo = (r.usuario.similares||[]).some(function(c){ return _altaNormU(c.usuario)===duenoTel; });
      if(esTypo){
        alerta=true;
        pie='El teléfono es de <b>'+esc(tOk.usuario)+'</b> — parece que escribió mal el alias.';
      } else {
        conflicto=true;
        pie='<b>'+esc(uDecl)+'</b> no existe, y ese teléfono ya es de <b>'+esc(tOk.usuario)+'</b>.';
      }
    } else if(uReal && !duenoTel && telsDe(uOk).length && telsDe(uOk).indexOf(tN)<0){
      alerta=true;
      pie = _typoPropio
        ? 'Es el mismo jugador — sólo tecleó mal el teléfono. Validá con el registrado.'
        : '<b>'+esc(uOk.usuario)+'</b> tiene registrado otro teléfono, que no se parece al declarado. '
          + 'Preguntale cuál usa ahora antes de validar.';
    }
  }

  // Ni el usuario ni el teléfono están en ninguna cuenta: decirlo con todas las letras. Juan (12/09):
  // "el chabón declaró eso y no había usuario, el desplegable de coinciden debe decir 'sin usuario'".
  const _sinNada = !uOk && !tOk && !(r.usuario.similares||[]).length && !(r.telefono.similares||[]).length
                   && (uDecl || tN.length >= 6);
  if(!pie && _sinNada){
    pie = 'No hay ninguna cuenta con ' + (uDecl ? 'este usuario' : '') + (uDecl && tN.length >= 6 ? ' ni con ' : '')
        + (tN.length >= 6 ? 'este teléfono' : '') + '. Es un alta nueva: creala acá mismo con el botón de arriba.';
  }
  // ── 4) No hay cuenta ni por usuario ni por teléfono: se crea desde acá ──
  // Antes había que copiar los datos, ir al apartado manual, crear la cuenta allá, copiar el
  // mensaje de ingreso, volver al chat, pegarlo, validar y volver a validar. Todo eso ya lo hace
  // el modal de alta (crea, vincula el teléfono, agenda y le manda los datos por el chat): lo
  // único que faltaba era llegar hasta él con lo que el cliente ya declaró.
  const _esAltaNueva = !uOk && !tOk && (uDecl || tN.length>=6);
  let acciones = '';
  if(_esAltaNueva){
    // La comilla se arma aparte: el valor viaja DENTRO de un onclick, y una comilla suelta en el
    // alias rompía el atributo entero (el botón quedaba muerto sin decir nada).
    const _q = String.fromCharCode(39);
    const _u = esc(String(uDecl||'').split(_q).join('')), _t = esc(String(tDecl||'').split(_q).join(''));
    acciones = '<div style="margin-top:7px"><button type="button" onclick="_altaCrearDesdeCotejo('+_q+_u+_q+','+_q+_t+_q+')"'
      + ' style="cursor:pointer;background:rgba(18,183,106,.12);border:1px solid rgba(18,183,106,.55);color:#3fb950'
      + ';border-radius:8px;padding:5px 11px;font-size:11px;font-weight:800">➕ Crear la cuenta y mandarle los datos</button></div>';
  }
  const nivel = conflicto ? 'conflicto' : alerta ? 'revisar' : (uOk||tOk) ? 'ok' : 'nuevo';
  const T = {
    ok:        { c:'#3fb950', bg:'rgba(63,185,80,.10)',  bd:'rgba(63,185,80,.38)',  ico:'✅' },
    nuevo:     { c:'#58a6ff', bg:'rgba(88,166,255,.09)', bd:'rgba(88,166,255,.32)', ico:'🆕' },
    revisar:   { c:'#e3b341', bg:'rgba(227,179,65,.11)', bd:'rgba(227,179,65,.42)', ico:'⚠️' },
    conflicto: { c:'#ff7b72', bg:'rgba(248,81,73,.12)',  bd:'rgba(248,81,73,.50)',  ico:'🚨' }
  }[nivel];
  const etiqueta = nivel==='conflicto' ? 'No coinciden'
                 : (nivel==='revisar' && _typoPropio) ? 'Teléfono mal tipeado'
                 : (nivel==='revisar' && _telCompartido) ? 'Teléfono en dos cuentas'
                 : nivel==='revisar'   ? 'Revisar'
                 : nivel==='nuevo'     ? 'Sin usuario'
                 : (uOk&&tOk)          ? 'Coinciden'
                 : uOk                 ? 'Usuario en sistema' : 'Teléfono en sistema';

  const html =
      '<div style="border:1px solid '+T.bd+';border-radius:10px;background:#0d1117;overflow:hidden">'
    +   '<div style="display:flex;align-items:center;gap:7px;padding:5px 10px;background:'+T.bg+';border-bottom:1px solid '+T.bd+'">'
    +     '<span style="font-size:12px;line-height:1">'+T.ico+'</span>'
    +     '<span style="font-weight:800;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:'+T.c+'">'+etiqueta+'</span>'
    +     (titulo?'<span style="margin-left:auto;font-size:8.5px;letter-spacing:.6px;text-transform:uppercase;color:#6e7681;white-space:nowrap">'+esc(titulo)+'</span>':'')
    +   '</div>'
    +   '<div style="padding:5px 10px 7px">'+filas+acciones+'</div>'
    +   (pie?'<div style="padding:6px 10px;border-top:1px solid '+T.bd+';background:'+T.bg+';font-size:11.5px;line-height:1.35;color:'+T.c+'">'+pie+'</div>':'')
    + '</div>';
  return { html:html, alerta:(nivel==='conflicto'||nivel==='revisar'), nivel:nivel };
}
// Cotejo en VIVO dentro del modal (debounce 500ms): usuario y teléfono se verifican por SEPARADO.
let _altaCotejoTimer=null;
window._altaCotejoTrigger=function(){
  try{ clearTimeout(_altaCotejoTimer); }catch(_e){}
  _altaCotejoTimer=setTimeout(_altaCotejoRender, 500);
  // La prevalidación va acá adentro: antes de validar hay que saber si ese teléfono ya
  // tiene cuenta, si ya cobró el bono o si su CBU aparece en otras. Antes vivía en el
  // CRM, en otra pantalla, y en la práctica nadie la abría antes de dar de alta.
  try{ clearTimeout(window._altaPrevalTimer); }catch(_e){}
  window._altaPrevalTimer=setTimeout(_altaPrevalRender, 650);
  try{ clearTimeout(window._altaTelTimer); }catch(_e){}
  window._altaTelTimer=setTimeout(_altaTelRender, 700);
};

// Qué teléfono se está por escribir. Vincular PISA el teléfono guardado con el que se
// valida, así que si el operador valida con el número de la solicitud que tiene abierta
// —y el cliente lo tipeó mal esa vez— queda guardado el malo y el portal lo rechaza para
// siempre. Caso real: un jugador usó el número bueno 199 veces y el mal tipeado 13 — y el que
// quedó guardado fue el malo.
async function _altaTelRender(){
  const box=document.getElementById('altaTelBox'); if(!box) return;
  const usr=String((document.getElementById('vincUsuarioInp')||{}).value||'').trim()
         || String(window.__altaUsuarioDeclarado||'').trim();
  const tel=String((document.getElementById('vincTelInp')||{}).value||'').replace(/\D/g,'');
  if(!usr){ box.innerHTML=''; return; }
  const marca=usr+'|'+tel;
  if(box.__ultima===marca) return;
  box.__ultima=marca;
  try{
    const { data, error } = await supabaseClient.rpc('panel_telefonos_de_usuario',{
      p_secret: window.PANEL_DATA_SECRET,
      p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
      p_usuario: usr });
    if(box.__ultima!==marca) return;
    if(error || !data || data.ok===false){ box.innerHTML=''; return; }
    const usados=(data.usados||[]).filter(function(x){ return x.telefono !== tel; });
    const malo = tel && tel.length !== 10;
    // El más usado, sólo si es válido y no es el que ya está escrito.
    const mejor = (data.usados||[]).filter(function(x){ return x.valido && x.telefono !== tel; })[0];
    if(!malo && !mejor){ box.innerHTML=''; return; }
    box.innerHTML =
      '<div style="border:1px solid ' + (malo?'#f0883e55':'#6f8fd055') + ';background:'
        + (malo?'rgba(240,136,62,.10)':'rgba(111,143,208,.10)') + ';border-radius:7px;padding:9px 11px">'
      + (malo
          ? '<b style="color:#f0883e;font-size:12.5px">⚠ ESE TELÉFONO TIENE '+tel.length+' DÍGITOS</b>'
            + '<div class="small" style="color:#c9d1d9;margin-top:3px">Un número argentino tiene 10 '
            + '(área + número). Si lo validás así, el usuario no va a poder entrar al portal.</div>'
          : '<b style="color:#8fa9e0;font-size:12.5px">📱 ESTE USUARIO OPERÓ CON OTRO NÚMERO</b>')
      + (mejor
          ? '<div class="small" style="color:#c9d1d9;margin-top:5px">En esta oficina operó con <b style="color:#e6edf3">'
            + escapeHtml(mejor.telefono)+'</b> en <b>'+mejor.veces+'</b> carga'+(mejor.veces===1?'':'s')+' o retiro'+(mejor.veces===1?'':'s')+' ya acreditado'+(mejor.veces===1?'':'s')+'. '
            + '<button class="mini-btn green" style="margin-left:6px" onclick="crmUsarTel(\''
            + escapeHtml(mejor.telefono)+'\')">usar este</button></div>'
          : '')
      + (usados.length>1
          ? '<div class="small" style="color:#5a6474;margin-top:4px">Otros: '
            + usados.slice(0,4).map(function(x){
                return escapeHtml(x.telefono)+' ('+x.veces+(x.valido?'':' · inválido')+')'; }).join(' · ')+'</div>'
          : '')
      + '</div>';
  }catch(_e){ box.innerHTML=''; }
}
window.crmUsarTel = function(t){
  const i=document.getElementById('vincTelInp');
  if(!i) return;
  i.value = t;
  try{ _altaCotejoTrigger(); }catch(_e){}
  try{ toast('Teléfono cambiado a '+t,'green'); }catch(_e){}
};

async function _altaPrevalRender(){
  const box=document.getElementById('altaPrevalBox'); if(!box) return;
  const tel=String((document.getElementById('vincTelInp')||{}).value||'').trim();
  const usr=String((document.getElementById('vincUsuarioInp')||{}).value||'').trim();
  if(tel.replace(/\D/g,'').length < 8){ box.innerHTML=''; return; }
  const marca=tel+'|'+usr;
  if(box.__ultima===marca) return;            // no repreguntar por lo mismo
  box.__ultima=marca;
  box.innerHTML='<div class="small" style="color:#8b949e">Chequeando antecedentes…</div>';
  try{
    const { data, error } = await supabaseClient.rpc('panel_prevalidar_usuario',{
      p_secret: window.PANEL_DATA_SECRET,
      p_pc_codigo:(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'',
      p_telefono: tel, p_usuario: usr||null });
    if(box.__ultima!==marca) return;           // el operador siguió escribiendo
    if(error) throw new Error(error.message||'');
    if(data && data.ok===false) throw new Error(data.error||'');
    const v=String(data.veredicto||'').toUpperCase();
    if(v==='LIBRE'){
      box.innerHTML='<div style="border-left:3px solid #12b76a;padding:3px 0 3px 10px">'
        +'<b style="color:#12b76a;font-size:12px">SIN ANTECEDENTES</b>'
        +'<div class="small" style="color:#8b949e">Ese teléfono no figura. Podés validar tranquilo.</div></div>';
      return;
    }
    const col = v==='YA_EXISTE' ? '#f5c518' : '#f04438';
    const tit = v==='YA_EXISTE' ? 'ESE TELÉFONO YA TIENE CUENTA' : 'REVISAR ANTES DE VALIDAR';
    box.innerHTML =
      `<div style="border:1px solid ${col}55;background:${col}12;border-radius:7px;padding:9px 11px">
         <b style="color:${col};font-size:12.5px">⚠ ${tit}</b>`
      + (data.motivos||[]).map(m=>{
          const n=String(m.nivel||m.gravedad||'').toUpperCase();
          const c=n==='ALTO'?'#f04438':(n==='MEDIO'?'#f5c518':'#8b949e');
          return `<div class="small" style="color:#c9d1d9;margin-top:4px">
                    <b style="color:${c}">${escapeHtml(n||'INFO')}</b> · ${escapeHtml(m.detalle||m.texto||m.motivo||'')}</div>`;
        }).join('')
      + ((data.cuentas||[]).length
          ? '<div class="small" style="color:#8b949e;margin-top:5px">Cuentas: '
            + (data.cuentas||[]).map(x=>'<b style="color:#e6edf3">'+escapeHtml(x.usuario||x)+'</b>').join(' · ')+'</div>'
          : '')
      + '<div class="small" style="color:#5a6474;margin-top:5px">Esto informa, no traba: si igual corresponde, validá.</div></div>';
  }catch(e){
    box.innerHTML='<div class="small" style="color:#8b949e">No se pudo chequear antecedentes ('+escapeHtml(e.message||'')+')</div>';
  }
}
async function _altaCotejoRender(){
  const box=document.getElementById('altaCotejoBox'); if(!box) return;
  const uInp=String((document.getElementById('vincUsuarioInp')||{}).value||'').trim();
  const t=String((document.getElementById('vincTelInp')||{}).value||'').trim();
  // Si el operador TODAVÍA no escribió el usuario real (alta nueva), cotejamos igual el alias que
  // DECLARÓ el cliente — antes, con el campo vacío, el usuario no se verificaba en absoluto.
  const uDecl = uInp || String(window.__altaUsuarioDeclarado||'').trim();
  if(uDecl.length<3 && _altaNormTel(t).length<6){ box.innerHTML=''; return; }
  box.innerHTML='<div class="small" style="color:#8b949e">🔎 cotejando en la base…</div>';
  let r; try{ r=await window.altaCotejarDatos(uDecl,t); }catch(_e){ box.innerHTML=''; return; }
  // El rótulo de la esquina avisa que todavía se está cotejando lo del cliente y no el usuario real.
  const out=_altaCotejoHtml(uDecl, t, r, '_altaUsarSugerencia', uInp?'':'declaró el cliente');
  box.innerHTML=out.html;
}
// Modal de RESULTADO del alta/validación: simple (no el modal de error de antes), para VER lo que
// quedó agendado y tener a mano el mensaje de ingreso. La ficha ya está en la base local y se
// sincroniza a Nexo (alias + teléfono), aunque el usuario todavía no haya cargado nunca.
function _altaModalResultado(usuario, telefono){
  const esc=escapeHtml;
  const uEsc=String(usuario).replace(/'/g,"\\'");
  // Si venimos del alta, la clave real llega por acá. Sin esto el botón de copiar los datos
  // ofrecía "12345a" fijo — mentira cuando el operador puso otra clave al crear la cuenta.
  let _clave='12345a';
  try{ if(window._altaClaveNueva){ _clave=String(window._altaClaveNueva); window._altaClaveNueva=null; } }catch(_e){}
  const cEsc=String(_clave).replace(/'/g,"\\'");
  abrirModal('✅ Usuario validado y agendado',
    '<div style="background:#0d1320;border:1px solid rgba(34,197,94,.35);border-radius:11px;padding:11px 13px">'
    + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><span class="small" style="color:#8b949e;font-weight:800;text-transform:uppercase">Usuario</span><b style="font-size:17px;color:#f0f6fc">'+esc(usuario)+'</b></div>'
    + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-top:4px"><span class="small" style="color:#8b949e;font-weight:800;text-transform:uppercase">Teléfono</span><b style="font-family:ui-monospace,monospace;color:#e6edf3">'+esc(_tel(telefono))+'</b></div>'
    + '</div>'
    + '<div class="small" style="color:#8b949e;margin-top:8px">📇 Quedó agendado en la base de jugadores y se envía a Nexo (ficha con alias + teléfono). Si escribió por el portal, <b>ya se le avisó por el chat</b> con el botón para ingresar.</div>'
    // El enlace es para los que llegan por publicidad y están en WhatsApp: esos NO tienen chat en
    // el portal, así que el aviso de arriba no les llega y había que mandarlos al CRM a buscar un
    // usuario que se acababa de crear. Se genera al apretar, no solo: si saliera en cada validación
    // dejaría una puerta abierta de 30 min en cuentas que nadie pidió.
    + '<div class="small" style="color:#8b949e;margin-top:2px">📲 Si llegó por WhatsApp, mandale el enlace — entra ya validado y sin explicarle nada.</div>'
    + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">'
    +   '<button class="mini-btn" style="font-size:11px;background:#12b76a;color:#fff;border:none" onclick="crmEnlaceAcceso(\''+uEsc+'\',\'CARGAR\')" title="Copia el enlace listo para pegar en WhatsApp. Vale 30 minutos.">📲 Enlace para WhatsApp</button>'
    +   '<button class="mini-btn blue" style="font-size:11px" onclick="_copiarMensajeClienteNuevo(\''+uEsc+'\',\''+cEsc+'\')">📋 Copiar datos de ingreso</button>'
    +   '<button class="mini-btn gray" style="font-size:11px" onclick="cerrarModal();abrirPerfilJugador(\''+uEsc+'\')">👤 Ver ficha</button>'
    + '</div>',
    function(){ cerrarModal(); }, 'Listo');
}
// COTEJO AUTOMÁTICO EN LA CONSULTA DEL CHAT — "ni bien llega".
// El cliente escribe "Usuario: eveok75. Tel: 1127140015". Separamos AMBOS datos y los verificamos
// por separado ANTES de que el operador apriete "Validar y vincular" y le explique todo el ingreso
// (que era el problema: terminabas la explicación con "pepe" y en sistema era "pepe123xxs").
window._altaCotejoConsulta = async function(ticket){
  const cont=document.getElementById('altaCotejoConsulta');
  if(!cont) return;
  if(!ticket){ cont.innerHTML=''; return; }
  // 1) Lo DECLARADO por el cliente, parseado del mensaje
  let txt='';
  try{
    const th=ticket.thread||ticket.mensajes||[];
    txt=(Array.isArray(th)?th:[]).map(function(m){ return String((m&&(m.mensaje||m.texto||m.body||m.MENSAJE))||''); }).join(' \n ');
  }catch(_e){}
  const mU=txt.match(/usuario\s*[:\-]?\s*([A-Za-z0-9._-]{3,})/i);
  const mT=txt.match(/(?:tel|telefono|tel[eé]fono|cel|celular)\s*[:.\-]?\s*([\d\s().\-]{6,})/i);
  const uDecl=mU?String(mU[1]).replace(/[.,;]+$/,''):String(ticket.usuario||'');
  const tDecl=mT?String(mT[1]):String(ticket.telefono||ticket.TELEFONO||'');
  if(!uDecl && _altaNormTel(tDecl).length<6){ cont.innerHTML=''; return; }
  // Cache por ticket: no re-cotejar en cada repintado del chat (que ocurre en cada poll)
  const key=_altaNormU(uDecl)+'|'+_altaNormTel(tDecl);
  window.__altaCotejoTicket=ticket;   // para poder re-cotejar tras vincular (ver _altaCotejoRefrescar)
  if(cont.dataset.key===key) return;
  cont.dataset.key=key;
  cont.innerHTML='<div class="small" style="color:#8b949e">🔎 cotejando usuario y teléfono en la base…</div>';
  let r; try{ r=await window.altaCotejarDatos(uDecl,tDecl); }catch(_e){ cont.innerHTML=''; return; }
  if(cont.dataset.key!==key) return;  // llegó otro ticket mientras tanto
  const out=_altaCotejoHtml(uDecl, tDecl, r, '_altaAbrirVincular', 'declaró el cliente');
  cont.innerHTML='<div style="margin-top:6px">'+out.html+'</div>';
};
// Re-cotejar DESPUÉS de vincular. El cotejo se cachea por usuario|teléfono declarados, y esos dos
// datos NO cambian al vincular: sin invalidar la caché la tarjeta se quedaba clavada en
// "🚨 NO COINCIDEN" para siempre, aunque el vínculo ya estuviera guardado y el cliente ya hubiera
// recibido el "Ya validamos tu cuenta". Parecía que no se guardaba nada; se guardaba, no se repintaba.
window._altaCotejoRefrescar=function(){
  try{
    const cont=document.getElementById('altaCotejoConsulta');
    if(cont) cont.dataset.key='';
    const t=window.__altaCotejoTicket;
    if(t && window._altaCotejoConsulta) window._altaCotejoConsulta(t);
  }catch(_e){}
};
// Chip del cotejo de la consulta → abre "Validar y vincular" ya cargado con esos datos.
window._altaAbrirVincular=function(usuario, telefono){ try{ abrirModalVincular(usuario, telefono, true, true); }catch(_e){} };
window._altaUsarSugerencia=function(usuario, telefono){
  const iu=document.getElementById('vincUsuarioInp'); const it=document.getElementById('vincTelInp');
  if(iu && usuario) iu.value=usuario;
  if(it && telefono) it.value=telefono;
  _altaCotejoTrigger();
};
// Botón Vincular del chat normal (chatAccionesRapidas): usuario EXISTENTE → pre-carga.
async function chatAccionVincular(usuarioArg, telefonoArg){
  const c = (chats||[]).find(x=>String(x.ID_CHAT)===String(chatActualId));
  const usuario = String((usuarioArg!==undefined ? usuarioArg : (c&&c.USUARIO))||"").trim();
  const telefono = String((telefonoArg!==undefined ? telefonoArg : (c&&c.TELEFONO))||"").trim();
  abrirModalVincular(usuario, telefono, true, true);
}
// Botón Vincular de la vista de CONSULTA/bandeja: es alta de NUEVO → usuario VACÍO (el operador lo crea),
// el apodo va de referencia y el teléfono se pre-carga (el que ingresó en el portal).
window.vincularDesdeConsulta=function(){
  const t=window.__nodoChatCurrentTicket||{};
  abrirModalVincular(String(t.usuario||"").trim(), String(t.telefono||t.TELEFONO||"").trim(), false, true);
};

// Normaliza un alias para mandarlo al casino (sin acentos, sin puntos, espacios, signos).
// El casino registra a los usuarios sin acentos ni separadores, así que normalizamos
// del lado de NODO para que coincidan incluso si el operador o el jugador los tipea con tildes/punto.
// Crear la cuenta desde la tarjeta de cotejo, con lo que el cliente ya declaró. El modal de alta
// se encarga del resto: la crea en Agentes, vincula el teléfono, la agenda y le manda los datos
// de ingreso por el chat del portal.
window._altaCrearDesdeCotejo = function(usuario, telefono){
  if(typeof abrirModalCrearUsuario !== 'function'){
    try{ toast('No encontré el alta de usuarios en esta pantalla','red'); }catch(_e){}
    return;
  }
  abrirModalCrearUsuario(usuario, telefono, true);   // el aviso va al hilo que está abierto
};
// ── Caja negra del panel ──────────────────────────────────────────────────────
// Adaptador de NodoDomain.cajaNegra. Anota el camino de cada llamada a Agentes para que, cuando
// algo corte, se vea hasta dónde llegó y de qué capa salió — en vez del "no anda" de siempre.
//
// Regla de oro: esto NO puede cambiar el comportamiento ni romper una operación. Todo va envuelto
// en try/catch y se traga cualquier error propio. Si el registro falla, la operación sigue.
//
// Qué NO se guarda: los argumentos de las llamadas. Una clave viaja en los de iniciarSesion.
// Se anota el nombre del método y lo que devuelve la pantalla, nada más.
(function(){
  'use strict';
  const CLAVE = 'nodo_caja_negra';
  const caja = NodoDomain.cajaNegra.crear({ topePasos: 120, topeFallas: 15 });

  // Lo de antes del reinicio sigue sirviendo: la falla puede ser de ayer y el panel se reabrió.
  try{
    const guardado = localStorage.getItem(CLAVE);
    if(guardado) caja.importar(JSON.parse(guardado));
  }catch(_e){}

  let timerGuardar = null;
  function guardar(){
    // Agrupado: una operación anota varios pasos seguidos y no hace falta escribir en cada uno.
    if(timerGuardar) return;
    timerGuardar = setTimeout(function(){
      timerGuardar = null;
      try{ localStorage.setItem(CLAVE, JSON.stringify(caja.exportar())); }catch(_e){}
    }, 1500);
  }

  function contextoDelPanel(){
    try{
      const pc = (typeof pcOperativa !== 'undefined' ? pcOperativa : '') || window.pcOperativa || '';
      const op = (window.operador && (window.operador.usuario || window.operador.nombre)) || '';
      const backend = (window._agentBackendState && window._agentBackendState.backend) || '';
      return { pc: pc, oficina: window.oficinaId || '', operador: op,
               version: window._versionApp || '', backend: backend };
    }catch(_e){ return {}; }
  }

  // Dónde quedó la pantalla de Agentes, según lo que devolvió el preload. Es el dato que no se
  // puede reconstruir después: para cuando alguien mira, la ventana ya cambió.
  function pantallaDe(r){
    try{
      if(!r || typeof r !== 'object') return '';
      const p = [];
      if(r.url) p.push(String(r.url).replace(/^https?:\/\/[^/]+/, ''));
      if(r.flujo) p.push('flujo: ' + r.flujo);
      if(r.needsLogin) p.push('pide login');
      if(r.pageError) p.push('página bloqueada');
      if(Array.isArray(r.carteles) && r.carteles.length) p.push('carteles: ' + r.carteles.slice(0, 3).join(' | '));
      return p.join(' · ');
    }catch(_e){ return ''; }
  }

  window._cnPaso = function(paso, estado, datos){
    try{
      const d = datos || {};
      caja.contexto(contextoDelPanel());
      caja.anotar({ paso: paso, capa: d.capa || 'preload', estado: estado, ms: d.ms,
                    detalle: d.detalle, pantalla: d.pantalla });
      guardar();
    }catch(_e){}
  };

  window._cnFalla = function(paso, mensaje, datos){
    try{
      const d = datos || {};
      caja.contexto(contextoDelPanel());
      const falla = caja.anotarFalla({ paso: paso, mensaje: mensaje, capa: d.capa, pantalla: d.pantalla });
      guardar();
      // La consola de la ventana de Agentes, con lo que pasó del otro lado. Es justo lo que no se
      // podía ver: vive en esa ventana y no salía nunca de la PC — ahí estaba la prueba del loop
      // del /logout. Se pide aparte porque cruza al proceso principal, y se engancha a la falla
      // cuando llega.
      try{
        if(falla && window.ctrlElectron && window.ctrlElectron.leerConsolaAgentes){
          window.ctrlElectron.leerConsolaAgentes().then(function(c){
            try{
              if(!c) return;
              falla.agentes = { url: String(c.url||''), consola: (c.consola||[]).slice(-25) };
              guardar();
            }catch(_e){}
          }).catch(function(){});
        }
      }catch(_e){}
      // Al toque en la consola de la PC: si el operador abre el devtools, lo primero que ve es
      // hasta dónde llegó, no un stack.
      try{ console.warn('%c[caja negra] ' + caja.resumen(falla), 'color:#f97316'); }catch(_e){}
      return falla;
    }catch(_e){ return null; }
  };

  // Para consultar sentado en la PC, o para que el operador lo copie y lo mande.
  window.cajaNegra = {
    fallas: function(){ return caja.fallas; },
    pasos: function(){ return caja.pasos; },
    resumen: function(){ return caja.resumen(); },
    exportar: function(){ return caja.exportar(); },
    texto: function(){
      const e = caja.exportar();
      const ctx = e.contexto;
      const cab = 'CAJA NEGRA · pc ' + (ctx.pc || '?') + ' · operador ' + (ctx.operador || '?')
                + ' · backend ' + (ctx.backend || '?') + ' · versión ' + (ctx.version || '?');
      const fallas = e.fallas.slice().reverse().map(function(f){
        const ag = (f.agentes && f.agentes.consola && f.agentes.consola.length)
          ? '\n   consola de Agentes' + (f.agentes.url ? ' (' + f.agentes.url + ')' : '') + ':\n'
            + f.agentes.consola.map(function(c){
                return '     [' + c.nivel + '] ' + c.msg + (c.fuente ? '  · ' + c.fuente : '');
              }).join('\n')
          : '';
        return '\n[' + new Date(f.t).toLocaleString() + '] ' + caja.resumen(f)
             + '\n   camino: ' + f.rastro.map(function(p){
                 return p.paso + '(' + p.estado + (p.ms ? ' ' + p.ms + 'ms' : '') + ')';
               }).join(' → ') + ag;
      }).join('\n');
      return cab + '\n' + (fallas || '\n(sin fallas registradas)');
    },
    limpiar: function(){ caja.limpiar(); try{ localStorage.removeItem(CLAVE); }catch(_e){} return 'caja negra vacía'; }
  };
  // Atajo para leerlo de un vistazo en la consola de la PC.
  window.verCajaNegra = function(){ const t = window.cajaNegra.texto(); console.log(t); return t; };
  window._cnPantallaDe = pantallaDe;
})();
// Adaptador de NodoDomain.latencia. Mide cuánto tarda cada mensaje del jugador en llegar al panel
// y lo deja SIEMPRE en la consola de la PC. El operador no lo ve: no se dibuja nada en pantalla.
//
// Por qué: no hay forma de saber si el sistema anda bien mirando el código. Las velocidades no son
// siempre las mismas y nadie puede decir si dos minutos son normales o son una falla. Hay que
// medirlo y tenerlo a mano en cada oficina, para cuando haya que mirarlo (Juan, 29/9).
//
// El día que se armó, una consulta de P4 se veía en el panel como "11:13 a. m." — parecía de hacía
// veinte minutos y era del día anterior. Con esto en la consola habría dicho "espera 1 d".
//
// Se mide en el momento en que los datos ENTRAN al panel, no cuando el operador los mira: lo que
// se quiere saber es cuánto tardó el sistema, no cuánto tardó la persona en abrir la conversación.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;
  if(!window.NodoDomain || !NodoDomain.latencia) return;

  const medidor = NodoDomain.latencia.crear({ tope: 300 });

  // Cada cuánto se escupe la suma a la consola. No es un aviso: es para que si alguien abre la
  // consola de una PC a cualquier hora, el número ya esté ahí sin tener que pedirlo.
  const CADA_MS = 10 * 60 * 1000;
  // Un mensaje que tardó más que esto se avisa en el momento, no solo en la suma.
  const GRITA_MS = 3 * 60 * 1000;

  function oficina(){
    try{ return String(window.pcOperativa || '') ; }catch(_e){ return ''; }
  }

  // Del hilo de una solicitud saca los mensajes del JUGADOR. Los del operador no se miden: el
  // tiempo que tarda una persona en contestar no es una falla del sistema.
  function mensajesDelJugador(sol){
    let m = (sol && (sol.METADATA !== undefined ? sol.METADATA : sol.metadata)) || {};
    if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ return []; } }
    const hilo = m && m.chat_thread;
    if(!Array.isArray(hilo)) return [];
    return hilo.filter(x => x && String(x.origen || '').toUpperCase() === 'USUARIO');
  }

  // El portal manda en el metadata de la solicitud la hora del dedo (t_toque) y la de cuando salió
  // el pedido (t_envio). Los mensajes que entraron antes de que el portal las mandara no las
  // tienen: ahí se mide solo el tramo base→panel, que igual es el que delata al panel.
  function horasDelPortal(sol, msg){
    if(msg && (msg.t_toque || msg.t_envio)) return { toque: msg.t_toque, envio: msg.t_envio };
    let m = (sol && (sol.METADATA !== undefined ? sol.METADATA : sol.metadata)) || {};
    if(typeof m === 'string'){ try{ m = JSON.parse(m); }catch(_e){ return {}; } }
    return { toque: (m && m.t_toque) || null, envio: (m && m.t_envio) || null };
  }

  // Se llama con la tanda de solicitudes recién traída del servidor.
  function medirTanda(solicitudes){
    if(!Array.isArray(solicitudes) || !solicitudes.length) return;
    const ahora = new Date().toISOString();
    const pc = oficina();
    for(const sol of solicitudes){
      const id = String((sol && (sol.ID || sol.id || sol.SOLICITUD_ID)) || '');
      if(!id) continue;
      const tipo = String((sol && (sol.TIPO || sol.tipo)) || 'mensaje').toLowerCase();
      for(const msg of mensajesDelJugador(sol)){
        const h = horasDelPortal(sol, msg);
        const t = medidor.anotar({
          clave:  id + '#' + String(msg.fecha || ''),
          tipo:   tipo,
          oficina: pc,
          fecha:  msg.fecha,
          toque:  h.toque,
          envio:  h.envio,
          ahora:  ahora
        });
        if(!t) continue;
        const linea = medidor.linea(t);
        // warn y no log para los lentos: en la consola quedan resaltados y filtrables por nivel.
        const salida = (t.espera >= GRITA_MS || (t.total !== null && t.total >= GRITA_MS))
          ? console.warn : console.log;
        salida(linea + ' · solicitud ' + id);
      }
    }
  }

  let _reloj = null;
  function arrancar(){
    if(_reloj) return;
    _reloj = setInterval(function(){
      try{
        if(medidor.tamano) console.log(medidor.texto());
      }catch(_e){}
    }, CADA_MS);
  }

  window.nodoLatencia = {
    medirTanda,
    resumen: () => medidor.resumen(),
    texto:   () => medidor.texto(),
    reset:   () => medidor.reset()
  };
  // Para escribir en la consola de cualquier PC y ver el número al instante.
  window.verLatencia = function(){ const t = medidor.texto(); console.log(t); return t; };

  arrancar();
})();
// Los dos caminos del chat, lado a lado, para mirarlos antes de apagar el viejo.
//
// Hoy una consulta de soporte se guarda como SOLICITUD. Por eso la bandeja de solicitudes viene
// llena de chats (256 de 300 filas en P4), una conversación son 25 solicitudes, y se juntaron
// 3.925 abiertas. El camino que corresponde existe entero y está permitido —`chat_sesiones` /
// `chat_mensajes`, con `panel_core_get_chat_sesiones_json` de este lado— pero nadie lo usa.
//
// El plan es el de Juan (2/10): primero que las cosas lleguen a los DOS lados, mirar que el nuevo
// reciba igual que el viejo, y recién cuando no haya dudas apagar el viejo. Esto es el instrumento
// para mirar: no cambia ningún comportamiento, sólo compara y cuenta.
//
//   verCaminos()        resumen de los dos y en qué se diferencian
//   verCaminos(true)    además lista usuario por usuario
//
// Va a la consola. El operador no ve nada.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

  // CAMINO NUEVO: las sesiones de chat de verdad.
  async function sesionesDelCaminoNuevo(){
    const pc = String(window.pcOperativa || '');
    if(!pc) return { error: 'todavía no hay oficina resuelta' };
    try{
      const r = await window.panelAPI.rpc('panel_core_get_chat_sesiones_json', { p_pc_codigo: pc });
      if(r && r.error) return { error: (r.error.message || JSON.stringify(r.error)) };
      let filas = r && r.data;
      if(typeof filas === 'string'){ try{ filas = JSON.parse(filas); }catch(_e){} }
      if(filas && !Array.isArray(filas) && Array.isArray(filas.rows)) filas = filas.rows;
      return { filas: Array.isArray(filas) ? filas : [] };
    }catch(e){ return { error: e.message || String(e) }; }
  }

  // CAMINO VIEJO: la lista de chats que el panel arma desde las solicitudes.
  function ticketsDelCaminoViejo(){
    try{
      if(typeof window.ticketsAgrupados === 'function') return window.ticketsAgrupados() || [];
    }catch(_e){}
    return [];
  }

  function usuarioDe(x){
    return U(x && (x.usuario || x.USUARIO || x.nombre_usuario || ''));
  }

  async function verCaminos(detalle){
    const nuevo = await sesionesDelCaminoNuevo();
    const viejo = ticketsDelCaminoViejo();

    if(nuevo.error){
      console.warn('[caminos] el camino nuevo no contestó:', nuevo.error);
      console.log('[caminos] camino viejo (solicitudes): ' + viejo.length + ' conversaciones');
      return { error: nuevo.error, viejo: viejo.length };
    }

    const enNuevo = new Set(nuevo.filas.map(usuarioDe).filter(Boolean));
    const enViejo = new Set(viejo.map(usuarioDe).filter(Boolean));
    const soloViejo = [...enViejo].filter(u => !enNuevo.has(u));
    const soloNuevo = [...enNuevo].filter(u => !enViejo.has(u));
    const enLosDos  = [...enViejo].filter(u => enNuevo.has(u));

    const resumen = {
      oficina: String(window.pcOperativa || ''),
      porSolicitudes: enViejo.size,
      porSesionesDeChat: enNuevo.size,
      enLosDos: enLosDos.length,
      soloPorSolicitudes: soloViejo.length,
      soloPorSesionesDeChat: soloNuevo.length
    };
    console.log('[caminos] ' + JSON.stringify(resumen, null, 1));

    // Lo que importa para decidir: si alguien aparece SOLO por el camino viejo, apagarlo todavía
    // lo dejaría sin atender. Mientras ese número no sea cero, el viejo no se toca.
    if(soloViejo.length){
      console.warn('[caminos] estos sólo llegan por el camino viejo — si se apaga, se pierden: '
        + soloViejo.slice(0, 20).join(', ') + (soloViejo.length > 20 ? ' …' : ''));
    }else if(enViejo.size){
      console.log('[caminos] todos los que están por solicitudes están también por sesiones de chat.');
    }

    if(detalle){
      console.table([...new Set([...enViejo, ...enNuevo])].map(u => ({
        usuario: u,
        porSolicitudes: enViejo.has(u),
        porSesionesDeChat: enNuevo.has(u)
      })));
    }
    return resumen;
  }

  window.verCaminos = verCaminos;
})();
// ── NODO en Discord ──────────────────────────────────────────────────────────
// Arma los dos renglones y se los pasa a main, que los publica. Decidir QUÉ mostrar es del panel:
// main sólo sabe hablar el protocolo.
//
//   NODO OPERATIVO            ← el nombre de la app, sale de Discord
//   3 solicitudes pendientes
//   Última carga hace 3 min
//
// Esto no puede romper ni frenar nada: todo envuelto, y si algo falla se calla.
(function(){
  'use strict';
  let ultima = null;

  function armar(){
    try{
      const dom = window.NodoDomain && window.NodoDomain.presencia;
      if(!dom) return null;
      return dom.armar({
        solicitudes: (window.V154P && window.V154P.solicitudes) || [],
        version: window._versionApp || '',
        pc: (typeof pcOperativa !== 'undefined' ? pcOperativa : '') || window.pcOperativa || '',
        // El MISMO criterio con el que la pantalla decide qué es un parcial. Un retiro pagándose
        // por partes ya se aceptó: no está esperando que alguien lo agarre.
        esParcial: function(s){
          try{
            const par = window.NodoDomain && window.NodoDomain.parciales;
            if(!par) return false;
            return par.enProceso(s, {
              info: window._retiroParcialInfo,
              cerrado: window._retiroCerradoAMano,
              sigueAbierto: window._retiroParcialSigueAbierto
            });
          }catch(_e){ return false; }
        }
      });
    }catch(_e){ return null; }
  }

  window.actualizarPresenciaDiscord = function(forzar){
    try{
      if(!window.ctrlElectron || !window.ctrlElectron.discordPresencia) return;
      const p = armar();
      if(!p) return;
      const dom = window.NodoDomain && window.NodoDomain.presencia;
      // Mandar lo mismo una y otra vez es ruido: Discord lo descarta igual.
      if(!forzar && dom && !dom.distinta(p, ultima)) return;
      ultima = p;
      window.ctrlElectron.discordPresencia(p).catch(function(){});
    }catch(_e){}
  };

  // Cada minuto, aunque no haya cambiado nada: el "hace 3 min" tiene que envejecer solo.
  try{ setInterval(function(){ window.actualizarPresenciaDiscord(); }, 60000); }catch(_e){}
})();
const _RE_DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
const _RE_SEPARADORES = new RegExp('[\\s.,;:¿?¡!\\-_/\\\\]', 'g');
function normalizarUsuarioCasino(u){
  if(u === null || u === undefined) return u;
  return String(u)
    .normalize('NFD')              // descompone caracteres acentuados (á → a + ́)
    .replace(_RE_DIACRITICOS, '')  // quita marcas diacríticas (tildes, diéresis)
    .replace(_RE_SEPARADORES, '')  // quita espacios, puntos, comas, guiones, slashes
    .toLowerCase();
}

// Decide qué alias mandar al casino:
//   - Si el alias NO tiene caracteres "raros" (acentos/puntos/etc) → lo manda tal cual (cero overhead).
//   - Si tiene caracteres raros → chequea en NUESTRA base de "usuarios":
//       · Si existe exactamente con esos caracteres → el casino también lo tiene así → mandar EXACTO.
//       · Si NO existe exactamente → asumimos que se subió normalizado al casino → mandar NORMALIZADO.
//
// El happy-path normal (alias sin chars especiales) NO hace ninguna query extra → no afecta la carga.
async function _resolverAliasParaCasino(usuario){
  if(!usuario) return usuario;
  const norm = normalizarUsuarioCasino(usuario);
  if(norm === usuario) return usuario; // sin caracteres raros, nada que decidir
  try {
    const { data, error } = await supabaseClient
      .from('usuarios')
      .select('usuario')
      .eq('usuario', usuario)
      .limit(1);
    // Si NO pudimos verificar en NODO (ej. 401 del blindaje: la tabla usuarios no se lee directo),
    // NO adivinamos normalizando: mandamos el alias TAL CUAL lo tipeó el operador. Normalizar a ciegas
    // mandaba un alias equivocado al casino → la búsqueda se trababa (cuelgue).
    if(error){ return usuario; }
    if(data && data.length){
      // Match exacto en NODO con esos caracteres → el casino también lo tiene así
      return usuario;
    }
    // No hay match exacto (y SÍ pudimos consultar) → probablemente el casino lo tiene normalizado
    console.log('[alias normalizado] "'+usuario+'" no está exacto en NODO · casino recibe "'+norm+'"');
    return norm;
  } catch(e){
    return usuario; // ante cualquier error, original
  }
}

// ══════════════════════════════════════════════════════════════════════════
// COLA SERIAL DE AGENTES — una sola ventana, un solo script a la vez.
// Antes cada flujo disparaba su automatización cuando se le cantaba y se pisaban: el watchdog de
// fichas (obtenerSaldoAgente) navegaba la ventana en medio de un retiro y le volaba el modal
// → "No se encontró el botón Enviar", y la operación quedaba a medias sin retomar.
// Ahora TODO pasa por acá y se ejecuta de a uno, en orden de llegada.
//   · Un fallo NO rompe la cadena (la siguiente tarea arranca igual).
//   · Tope por tarea: si una se cuelga, se destraba la cola en vez de bloquear el panel para siempre.
//   · ⛔ Cancelar NO se encola: es el freno de emergencia, tiene que pasar por encima.
// Estado visible en consola: window._drexCola  → {activo, pendientes}
// ══════════════════════════════════════════════════════════════════════════
window._drexCola = { activo:null, pendientes:0 };
let _drexColaP = Promise.resolve();
const _DREX_TAREA_MAX_MS = 120000;
// El puente del portal (V15.4) vive en OTRO bloque <script>: se expone para que pueda encolar.
setTimeout(function(){ try{ window._drexEncolar = _drexEncolar; }catch(_e){} },0);
// Nombres lindos para el operador (los métodos internos no le dicen nada).
const _DREX_NOMBRE = { buscarUsuario:'buscar usuario', cargarSaldo:'carga', retirarSaldo:'retiro',
  crearUsuario:'crear usuario', cambiarClave:'cambiar clave', obtenerSaldoAgente:'leer fichas',
  iniciarSesion:'iniciar sesión', verifyUser:'verificar usuario' };
// ── Cortacircuitos por sesión caída ─────────────────────────────────────────────────────────
// Si la sesión de Agentes se cae con la cola llena, cada tarea igual se ejecuta y se queda
// esperando su timeout de 120s. Con 10 encoladas son 20 minutos de panel trabado, y al final
// ninguna hizo nada. Peor: el operador ve "10 esperando" y no sabe que ya está todo perdido.
// Cuando una tarea detecta que no hay sesión, se levanta esta bandera y las que siguen se
// rechazan AL INSTANTE, sin tocar el agente. Se baja sola al reponer la sesión.
window._drexSinSesion = false;
window._drexCanceladas = [];      // qué quedó sin ejecutar, para poder decirlo al reponer
window._drexMarcarSinSesion = function(motivo){
  // NO se sale de entrada si ya estaba marcado. Antes sí, y eso dejaba al panel encerrado: si el
  // operador cerraba el modal, la bandera quedaba en true, nadie se lo volvía a pedir, y encima la
  // cola cancelaba la lectura del watchdog sin tocar Agentes — asi que tampoco se volvía a
  // detectar. El panel se quedaba con la sesión cerrada mostrando «Sin lectura de Drex» en un
  // widget chico y nada más (Juan, 26/9).
  const _yaEstaba = window._drexSinSesion;
  window._drexSinSesion = true;
  if(!_yaEstaba){
    const q = (window._drexCola && window._drexCola.pendientes) || 0;
    window._drexCanceladas = [];
    try{ toast('🔒 Sesión de Agentes caída'+(q>1?(' · se cancelan '+(q-1)+' en cola'):'')+' — abriendo el login…','red'); }catch(_e){}
    console.warn('[cola] sesión caída → se cancela lo encolado ('+q+')');
  }
  window._drexAvisarSinSesion();
  window._drexPedirLogin();
};

// Cartel FIJO mientras la sesión esté caída. El modal se puede cerrar; esto no se va hasta que se
// entra de verdad. Es el «cartel de sesión cerrada como mínimo» que faltaba.
window._drexAvisarSinSesion = function(){
  try{
    let b = document.getElementById('drexSinSesionBanner');
    if(!window._drexSinSesion){ if(b) b.remove(); return; }
    if(!b){
      b = document.createElement('div');
      b.id = 'drexSinSesionBanner';
      b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#7f1d1d;'
        + 'color:#fff;padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;'
        + 'font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.45)';
      document.body.appendChild(b);
    }
    b.innerHTML = '<span style="font-size:18px">🔒</span>'
      + '<b>La sesión de Agentes está cerrada</b>'
      + '<span style="font-weight:400;opacity:.9">No se puede cargar ni retirar hasta entrar.</span>'
      + '<button onclick="_mostrarModalLoginDrex()" style="margin-left:auto;background:#fff;'
      + 'color:#7f1d1d;border:0;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer">'
      + 'Entrar a Agentes</button>';
  }catch(_e){}
};

// Vuelve a ofrecer el login, con espacio entre pedidos: se insiste, pero no se acosa.
window._drexPedirLogin = function(){
  setTimeout(function(){
    try{
      if(!window._drexSinSesion) return;                              // se repuso en el interín
      if(document.getElementById('drexLUser')) return;                 // ya está abierto
      if(Date.now() - (window._drexLoginPedidoEn||0) < 45000) return;  // recién se lo pedimos
      window._drexLoginPedidoEn = Date.now();
      if(typeof _mostrarModalLoginDrex==='function') _mostrarModalLoginDrex();
    }catch(_e){}
  }, 600);
};
window._drexSesionRepuesta = function(){
  if(!window._drexSinSesion) return;
  window._drexSinSesion = false;
  window._drexLoginPedidoEn = 0;
  try{ window._drexAvisarSinSesion(); }catch(_e){}      // saca el cartel
  // Al reponer, se dice QUÉ quedó sin hacer. "Ya podés reintentar" a secas obliga al operador a
  // acordarse de memoria qué estaba haciendo cuando se cayó.
  const c = (window._drexCanceladas||[]).slice(0,4);
  window._drexCanceladas = [];
  try{
    toast('🔓 Sesión repuesta'+(c.length?(' · quedó sin hacer: '+c.join(', ')+' — reintentalo'):' · ya podés seguir'), c.length?'yellow':'green');
  }catch(_e){}
};
function _drexEncolar(nombre, fn, opts){
  const st = window._drexCola;
  const silencioso = !!(opts && opts.silencioso);
  // FEEDBACK: si entra detrás de otra cosa, avisamos que está EN COLA (no trabado). Sin esto el
  // operador aprieta, no pasa nada visible y parece que la app se colgó.
  if(!silencioso && st.activo){
    const enCurso = _DREX_NOMBRE[st.activo.nombre] || st.activo.nombre;
    const mio = _DREX_NOMBRE[nombre] || nombre;
    try{ toast('⏳ "'+mio+'" queda en cola · terminando "'+enCurso+'"'+(st.pendientes>1?(' · '+st.pendientes+' esperando'):''), 'blue'); }catch(_e){}
  }
  st.pendientes++;
  const correr = function(){
    // Si la sesión se cayó mientras esta tarea esperaba, se descarta sin tocar el agente. Antes se
    // ejecutaba igual y se comía sus 120s de timeout, una atrás de otra.
    // Los chequeos de sesión y el login NUNCA se cancelan: son justamente los que la reponen. Si se
    // cancelaran, el cortacircuitos no se podría apagar nunca — quedaba trabado para siempre.
    if(window._drexSinSesion && nombre!=='estadoPagina' && nombre!=='iniciarSesion'){
      if(st.pendientes > 0) st.pendientes--;
      try{ (window._drexCanceladas||[]).push(_DREX_NOMBRE[nombre] || nombre); }catch(_e){}
      try{ if(window._cnFalla) window._cnFalla(nombre, 'no se ejecutó: la sesión ya estaba caída', { capa:'panel' }); }catch(_e){}
      return Promise.reject(new Error('Sesión de Agentes caída — "'+(_DREX_NOMBRE[nombre]||nombre)+'" no se ejecutó. Se abrió el login: entrá y reintentá.'));
    }
    st.activo = { nombre:nombre, desde:Date.now() };
    const t0 = Date.now();
    let _to = null;
    return Promise.race([
      Promise.resolve().then(fn),
      new Promise(function(_res, rej){
        _to = setTimeout(function(){
          rej(new Error('La tarea "'+nombre+'" superó '+Math.round(_DREX_TAREA_MAX_MS/1000)+'s · se destrabó la cola'));
        }, _DREX_TAREA_MAX_MS);
      })
    ]).finally(function(){
      if(_to) clearTimeout(_to);
      const ms = Date.now()-t0;
      if(ms > 8000) console.warn('[cola] '+nombre+' tardó '+ms+'ms · pendientes: '+(st.pendientes-1));
      st.activo = null;
      if(st.pendientes > 0) st.pendientes--;
      // Avisar que la cola sigue con lo que quedó (así el operador ve que retoma solo).
      if(!silencioso && st.pendientes > 0){
        try{ toast('▶ Sigo con lo que quedó · '+st.pendientes+' en cola', 'blue'); }catch(_e){}
      }
    });
  };
  const p = _drexColaP.then(correr, correr);   // corre igual si la anterior falló
  _drexColaP = p.then(function(){}, function(){});  // la cadena nunca se corta
  return p;
}
async function callDrex(method, ...args){
  // El freno de emergencia NO espera en la cola (si no, no frenaría nada).
  if(method === 'abortarOperacion') return window.ctrlElectron.drexAutomation(method, ...args);
  return _drexEncolar(method, async function(){
    // Caja negra: por acá pasan TODAS las llamadas al preload, así que es el lugar donde anotar
    // el camino sin tocar cada operación. No se anotan los argumentos (en iniciarSesion viaja la
    // clave): sólo el método y dónde quedó la pantalla.
    const _cnT0 = Date.now();
    try{ if(window._cnPaso) window._cnPaso(method, 'inicio'); }catch(_e){}
    // Solo buscarUsuario resuelve el alias inteligentemente.
    // crearUsuario / cambiarClave NO se tocan.
    let _r;
    try{
    if(method === 'buscarUsuario' && args.length > 0 && typeof args[0] === 'string'){
      const aliasFinal = await _resolverAliasParaCasino(args[0]);
      // Reenviamos los args extra (ej: options { skipBalance: true })
      _r = await window.ctrlElectron.drexAutomation('buscarUsuario', aliasFinal, ...args.slice(1));
    } else {
      _r = await window.ctrlElectron.drexAutomation(method, ...args);
    }
    }catch(_cnE){
      // El corte puede venir de main (timeout, recarga, ventana cerrada) o del preload. De quién
      // fue lo deduce la caja negra por la firma del mensaje: lo que no reconoce queda
      // 'desconocida' en vez de colgárselo a alguien.
      try{ if(window._cnFalla) window._cnFalla(method, _cnE && (_cnE.message || String(_cnE)), { ms: Date.now()-_cnT0 }); }catch(_e){}
      throw _cnE;
    }
    try{
      const _cnMs = Date.now()-_cnT0;
      const _cnPant = (window._cnPantallaDe && window._cnPantallaDe(_r)) || '';
      // estadoPagina e iniciarSesion devuelven needsLogin como parte NORMAL de su trabajo: eso no
      // es una falla (mismo criterio que _esChequeo, unas líneas más abajo).
      const _cnChequeo = (method==='estadoPagina' || method==='iniciarSesion');
      if(_r && _r.ok === false && !_cnChequeo){
        if(window._cnFalla) window._cnFalla(method, _r.message || 'devolvió ok:false', { ms:_cnMs, pantalla:_cnPant, capa:'preload' });
      } else if(window._cnPaso){
        window._cnPaso(method, (_r && _r.needsLogin) ? 'pide-login' : 'ok', { ms:_cnMs, pantalla:_cnPant });
      }
    }catch(_e){}
    // Punto único donde se ve el estado de la sesión: TODO pasa por acá. Si la página pide login,
    // se levanta la bandera y lo que quedó en cola se cancela solo en vez de morir de a 120s.
    // El login exitoso la baja — así se retoma sin tener que reiniciar nada.
    try{
      // OJO con qué se considera "sesión caída". estadoPagina e iniciarSesion devuelven needsLogin
      // como parte NORMAL de su trabajo: ensureDrexSession justamente los usa para decidir si hay
      // que mostrar el login. Tomarlos como caída hacía que el cortacircuitos se disparara en pleno
      // arranque de una carga y cancelara todo lo que venía atrás — con la sesión perfectamente
      // viva. Solicitudes que quedaron en ERROR_OPERATIVO por eso.
      // Sólo cuenta si el que se encontró sin sesión fue una operación REAL, que ya daba por hecho
      // que había sesión.
      const _esChequeo = (method==='estadoPagina' || method==='iniciarSesion');
      // Reloj de la sonda: cualquier operación real que NO pidió login prueba que la sesión
      // está viva. Mientras se opere, no hace falta sondear nada.
      if(!_esChequeo && _r && !_r.needsLogin){ try{ window._drexUltimaOpOk = Date.now(); }catch(_e){} }
      if(_r && _r.needsLogin && !_esChequeo) window._drexMarcarSinSesion(method);
      else if(_r && _r.needsLogin === false) window._drexSesionRepuesta();
      else if(_r && _r.ok === true && method === 'iniciarSesion') window._drexSesionRepuesta();
    }catch(_e){}
    return _r;
  });
}

// Auto-registra o reconoce un usuario después de una operación exitosa.
// Estrategia:
//   1) Buscar el alias en TODA la tabla usuarios (sin filtrar por pc_codigo)
//   2) Si existe en CUALQUIER pc → NO duplicar. Si la pc es distinta a la actual,
//      avisar al operador con un toast informativo (cross-oficina detectado).
//   3) Si NO existe en ninguna → crear en la pc actual con origen 'AUTO_CARGA'.
// Corre en SEGUNDO PLANO: nunca usar await desde el flujo de carga.
// ══════════════════════════════════════════════════════════════════════════════
// AUTO-REGISTRO — DESACTIVADO (2026-08-15). No borrar sin leer esto.
//
// Escribía directo en la tabla `usuarios` con supabaseClient.from().insert(), y eso
// va contra el modelo de seguridad del portal: el anon NO escribe directo, las
// escrituras van por RPC. Verificado en la base: `usuarios` tiene RLS activo y CERO
// políticas, así que para el panel está todo denegado — el INSERT y también el SELECT.
//
// Consecuencia: la función no hacía NINGUNA de sus dos cosas.
//   · El alta nunca insertó: 0 filas con origen='AUTO_CARGA' en toda la base.
//   · El aviso "está registrado en oficina P3" nunca se mostró, porque el SELECT
//     vuelve vacío (RLS no da error al leer, solo devuelve nada) y el código
//     concluía "no existe en ninguna oficina".
// Y el error se tragaba en silencio: solo logueaba si NO había error.
//
// El costo era real: ~5.400 errores 42501 por día en Postgres, cada uno escrito al
// log. Con la base en una instancia chica, eso consume E/S que hace falta para operar.
//
// Se deja como no-op en vez de borrar las 5 llamadas: no cambia nada en los puntos
// que la invocan y queda un solo lugar donde revivirla.
//
// PARA REACTIVARLA hace falta una RPC SECURITY DEFINER con el guard de siempre
// (_panel_data_auth(p_secret)), igual que el resto de las escrituras del panel.
// Antes de escribirla conviene preguntarse si sirve: `usuarios` tiene 149 filas en
// total y la base real de jugadores es usuarios_portal_vinculos (172.000). Todo lo
// que el panel lee de `usuarios` también viene vacío por lo mismo.
// ══════════════════════════════════════════════════════════════════════════════
async function _autoregistrarUsuarioSiFalta(aliasCasino){
  return;   // ver el bloque de arriba
}

// ── Login modal de Casinodrex ─────────────────────────────────────────────────
// Abre el modal si hay que loguearse. Devuelve true si la sesión quedó lista,
// false si el operador canceló o las credenciales fallaron.
// NO guarda credenciales en disco ni en memoria persistente.
let _drexLoginResolve = null;

function _mostrarModalLoginDrex() {
  return new Promise(async function(resolve) {
    _drexLoginResolve = resolve;
    // Auto-login BLINDADO primero: si la oficina tiene credenciales guardadas, la clave se
    // resuelve en el proceso main (nunca en el renderer) y logueamos sin pedirle nada al operador.
    let _autoReason='';
    try{
      if(window.ctrlElectron && window.ctrlElectron.drexAutoLogin){
        try{ toast('Conectando al backoffice…','blue'); }catch(_t){}
        const _pc=(typeof pcOperativa!=='undefined'?pcOperativa:'')||window.pcOperativa||'';
        const _r=await window.ctrlElectron.drexAutoLogin(_pc);
        if(_r && _r.ok){ _drexLoginResolve=null; try{ toast('Backoffice conectado','green'); }catch(_t){} return resolve(true); }
        _autoReason=(_r && _r.reason) ? String(_r.reason) : 'desconocido';
      } else { _autoReason='sin-puente'; }
    }catch(_e){ _autoReason='excepcion'; console.warn('[drex] auto-login falló, pido credenciales manual:', _e); }
    // Diagnóstico visible: por qué no entró solo (credenciales en admi vs. login fallido vs. falta secret).
    const _autoMsg = _autoReason==='no-creds' ? '⚠️ Auto-login: no hay credenciales de agente cargadas en el admi para esta oficina (cargalas en Oficinas → Guardar agente).'
      : _autoReason==='login-fail' ? '⚠️ Auto-login: las credenciales del admi no pudieron loguear (revisá usuario/clave en el admi).'
      : _autoReason==='missing-secret' ? '⚠️ Auto-login: esta PC no tiene la clave de la oficina (se configura desde NODO ADMIN).'
      : _autoReason==='config' ? '⚠️ Auto-login: config incompleta (oficina/URL).'
      : (_autoReason && _autoReason!=='sin-puente' && _autoReason!=='desconocido') ? ('⚠️ Auto-login no disponible ('+_autoReason+').') : '';
    abrirModal(
      '🔐 Login — Casinodrex Agentes',
      (_autoMsg?('<div style="margin-bottom:8px;color:#fbbf24;font-size:12px;background:rgba(120,90,10,.22);border:1px solid rgba(251,191,36,.4);border-radius:8px;padding:7px 9px">'+_autoMsg+'</div>'):'') +
      '<div style="margin-bottom:10px;color:#c0cad8;font-size:13px">La sesión del backoffice expiró o no está abierta.<br>Ingresá tus credenciales de agente para continuar.</div>' +
      '<label style="color:#c0cad8;font-size:12px;font-weight:700">USUARIO</label>' +
      '<input id="drexLUser" type="text" autocomplete="off" placeholder="(tu usuario de agente)" style="margin-bottom:12px" value="">' +
      '<label style="color:#c0cad8;font-size:12px;font-weight:700">CONTRASEÑA</label>' +
      '<input id="drexLPass" type="password" autocomplete="off" placeholder="(tu clave)" value="">' +
      '<div id="drexLErr" style="color:var(--red);font-size:12px;margin-top:8px;min-height:16px"></div>',
      null,
      'Conectar'
    );
    // Sobrescribir el botón Guardar con lógica propia
    var btn = document.getElementById("modalSaveBtn");
    if(btn) btn.onclick = _ejecutarLoginDrex;
    // Cancelar → resolver false
    var cancelBtn = document.querySelector('#modalOverlay .btn-gray');
    if(cancelBtn) cancelBtn.onclick = function(){ cerrarModal(); if(_drexLoginResolve){ _drexLoginResolve(false); _drexLoginResolve=null; } };
    // Auto-focus + Enter handlers
    setTimeout(function(){
      var u = document.getElementById("drexLUser");
      var p = document.getElementById("drexLPass");
      if(u){
        u.value = ''; u.focus(); u.select();
        u.addEventListener("keydown", function(e){
          if(e.key==="Enter"){ e.preventDefault(); document.getElementById("drexLPass")?.focus(); }
        });
      }
      if(p){
        p.value = '';
        p.addEventListener("keydown", function(e){
          if(e.key==="Enter"){ e.preventDefault(); _ejecutarLoginDrex(); }
        });
      }
    }, 120);
  });
}

async function _ejecutarLoginDrex() {
  var user = (document.getElementById("drexLUser")?.value || "").trim();
  var pass = (document.getElementById("drexLPass")?.value || "").trim();
  var errEl = document.getElementById("drexLErr");
  if(!user || !pass){
    if(errEl) errEl.textContent = "Completá usuario y contraseña.";
    return;
  }
  var btn = document.getElementById("modalSaveBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Conectando..."; }
  if(errEl) errEl.textContent = "";
  try {
    var r = await callDrex("iniciarSesion", user, pass);
    if(r && r.ok){
      // Limpiar handlers ANTES de cerrar para que el próximo modal arranque limpio
      const saveB = document.getElementById('modalSaveBtn');
      if(saveB){ saveB.onclick = null; saveB.disabled = false; saveB.textContent = 'Guardar'; }
      cerrarModal();
      if(_drexLoginResolve){ _drexLoginResolve(true); _drexLoginResolve=null; }
    } else {
      if(errEl) errEl.textContent = r?.message || "Credenciales incorrectas. Verificá y volvé a intentar.";
      if(btn){ btn.disabled = false; btn.textContent = "Conectar"; }
      // No resolver — el modal queda abierto para reintentar
    }
  } catch(e){
    if(errEl) errEl.textContent = "Error: " + (e.message || "sin detalle");
    if(btn){ btn.disabled = false; btn.textContent = "Conectar"; }
  }
}

// Helper usado en TODAS las operaciones automáticas.
// Abre la ventana, verifica sesión, y si falta → modal de login.
// Devuelve true si la sesión está lista para operar.
async function ensureDrexSession() {
  await window.ctrlElectron.openAgentWindow();
  var estado = await callDrex("estadoPagina");
  if(!estado.needsLogin) return true;
  toast("Se requiere iniciar sesión en el backoffice.", "yellow");
  return await _mostrarModalLoginDrex();
}

function autoResBox(id, ok, texto){
  const el = document.getElementById(id);
  if(!el) return;
  el.innerHTML = `<div class="${ok?"ok-box":"err-box"}" style="margin-top:8px">${texto}</div>`;
}

async function abrirBackoffice(){
  if(!enElectron) return;
  // Esta es la ÚNICA función que muestra la ventana de agentes (botón manual del operador)
  await window.ctrlElectron.showAgentWindow();
  await verificarEstadoBackoffice();
}

async function verificarEstadoBackoffice(){
  if(!enElectron) return;
  try{
    const e = await callDrex("estadoPagina");
    const ok = !e.needsLogin;
    document.getElementById("autoEstadoVal").textContent = ok ? "✅ Listo" : "🔐 Requiere login";
    document.getElementById("autoEstadoVal").style.color  = ok ? "var(--green)" : "var(--yellow)";
    document.getElementById("autoEstadoMsg").textContent  = e.message || e.url || "";
  }catch(err){
    document.getElementById("autoEstadoVal").textContent = "⚠ Sin conexión";
    document.getElementById("autoEstadoMsg").textContent = "Abrí el backoffice primero";
  }
}

// ── Switch de backend de Agentes (Casinodrex ⇄ BET300) ───────────────────────
// El proxy de la oficina NO cambia: vive en la sesión persist:nodo-agentes (misma partición
// para ambos backends). Cambiar de backend solo relanza la ventana de agentes con el preload/URL
// del casino elegido; la salida de red (proxy) queda igual. Se PERSISTE en userData (sobrevive updates).
window._agentBackendState = null;
async function nodoCargarBackendAgentes(){
  if(!enElectron || !window.ctrlElectron || !window.ctrlElectron.getAgentBackend) return;
  try{
    const st = await window.ctrlElectron.getAgentBackend();
    window._agentBackendState = st;
    const btn = document.getElementById('agentBackendBtn');
    if(btn && st && st.ok){ btn.textContent = '🎰 Backoffice: '+st.label; btn.dataset.backend = st.backend; }
  }catch(_e){}
}
async function nodoCambiarBackendAgentes(){
  if(!enElectron || !window.ctrlElectron || !window.ctrlElectron.setAgentBackend){ toast('Solo en la app de escritorio','yellow'); return; }
  const st = window._agentBackendState;
  const ops = (st && st.opciones) || [{id:'casinodrex',label:'Casinodrex'},{id:'bet300',label:'BET300 (agentesbet.io)'}];
  const actual = (st && st.backend) || 'casinodrex';
  const otro = ops.find(function(o){ return o.id!==actual; }) || ops[0];
  if(!confirm('¿Cambiar el backoffice de Agentes a "'+otro.label+'"?\n\nSe RELANZA la ventana de agentes (el proxy de la oficina NO cambia). Si no tenés la sesión guardada de ese backoffice, vas a tener que iniciar sesión de nuevo.')) return;
  const btn=document.getElementById('agentBackendBtn'); if(btn){ btn.disabled=true; btn.textContent='🎰 Relanzando…'; }
  try{
    const r = await window.ctrlElectron.setAgentBackend(otro.id);
    if(r && r.ok){
      toast('🎰 Backoffice: '+(r.label||otro.label)+' · ventana relanzada','green');
      await nodoCargarBackendAgentes();
      try{ setTimeout(verificarEstadoBackoffice, 1800); }catch(_e){}
    } else { toast('No se pudo cambiar: '+((r&&r.error)||'error'),'red'); await nodoCargarBackendAgentes(); }
  }catch(e){ toast('Error: '+(e.message||e),'red'); await nodoCargarBackendAgentes(); }
  finally{ if(btn) btn.disabled=false; }
}
window.nodoCargarBackendAgentes = nodoCargarBackendAgentes;
window.nodoCambiarBackendAgentes = nodoCambiarBackendAgentes;

async function testBuscar(){
  if(!enElectron) return;
  const usuario = document.getElementById("autoUsuario").value.trim();
  if(!usuario){ autoResBox("autoBuscarRes", false, "Ingresá un usuario."); return; }
  autoResBox("autoBuscarRes", true, "Buscando...");
  try{
    await window.ctrlElectron.openAgentWindow();
    const r = await callDrex("buscarUsuario", usuario);
    if(r.exists){
      const bal = r.balance ? ` · Saldo: ${r.balance.raw}` : "";
      autoResBox("autoBuscarRes", true, `✅ Encontrado: <b>${r.user}</b>${bal}`);
    } else {
      autoResBox("autoBuscarRes", false, `❌ Usuario "${usuario}" no encontrado.`);
    }
  }catch(err){ autoResBox("autoBuscarRes", false, "Error: " + err.message); }
}

async function testCargar(){
  if(!enElectron) return;
  const usuario = document.getElementById("autoCargarUsuario").value.trim();
  const monto   = Number(document.getElementById("autoCargarMonto").value);
  if(!usuario || !monto){ autoResBox("autoCargarRes", false, "Completá usuario y monto."); return; }
  autoResBox("autoCargarRes", true, "Buscando usuario...");
  try{
    await window.ctrlElectron.openAgentWindow();
    const b = await callDrex("buscarUsuario", usuario); // navega y busca en página limpia
    if(!b.exists){ autoResBox("autoCargarRes", false, `❌ Usuario "${usuario}" no encontrado.`); return; }
    autoResBox("autoCargarRes", true, "Cargando saldo...");
    const r = await callDrex("cargarSaldo", monto);
    document.getElementById("autoResultVal").textContent = `CARGA · ${usuario} · $${monto.toLocaleString("es-AR")}`;
    autoResBox("autoCargarRes", true, `✅ ${r.message || "Carga realizada."}`);
    await window.ctrlElectron.navigateAgent(); // refresca después de cargar
  }catch(err){ autoResBox("autoCargarRes", false, "Error: " + err.message); }
}

async function testRetirar(){
  if(!enElectron) return;
  const usuario = document.getElementById("autoRetirarUsuario").value.trim();
  const monto   = Number(document.getElementById("autoRetirarMonto").value);
  if(!usuario || !monto){ autoResBox("autoRetirarRes", false, "Completá usuario y monto."); return; }

  autoResBox("autoRetirarRes", true, "Verificando política 24hs...");
  const check = await verificarRetiro24h(usuario);
  if(check.bloqueado){
    autoResBox("autoRetirarRes", false, `⚠️ ${check.mensaje}`);
    const proceder = await confirmarRetiroDuplicado(check);
    if(!proceder) return;
  }

  autoResBox("autoRetirarRes", true, "Buscando usuario...");
  try{
    await window.ctrlElectron.openAgentWindow();
    const b = await callDrex("buscarUsuario", usuario);
    if(!b.exists){ autoResBox("autoRetirarRes", false, `❌ Usuario "${usuario}" no encontrado.`); return; }
    const saldo = b.balance?.value ?? -1;
    if(saldo >= 0 && saldo < monto){
      autoResBox("autoRetirarRes", false, `⛔ Saldo insuficiente: ${b.balance.raw.trim()} disponible, se solicitaron $${monto.toLocaleString("es-AR")}.`);
      await window.ctrlElectron.navigateAgent();
      return;
    }
    autoResBox("autoRetirarRes", true, `Encontrado · Saldo: ${b.balance?.raw?.trim() || "—"} · Retirando...`);
    const r = await callDrex("retirarSaldo", monto);
    document.getElementById("autoResultVal").textContent = `RETIRO · ${usuario} · $${monto.toLocaleString("es-AR")}`;
    autoResBox("autoRetirarRes", true, `✅ ${r.message || "Retiro realizado."}`);
    
    // Iba a la tabla `solicitudes`, muerta desde mayo: el retiro no quedaba en el historial ni
    // lo veía la regla de 24 h. Se registra donde se mira de verdad.
    try{
      await registrarEnHistorial({ usuario, tipo:'RETIRO', monto, billetera_id:null,
        billetera_nombre:null, origen:'MANUAL', estado:'OK', notas:'Retiro desde el panel de agentes' });
    }catch(_e){}
    await supabaseClient.from("solicitudes").insert({
      tipo: "RETIRO",
      usuario: usuario,
      monto: monto,
      estado: "PAGADA",
      pc_codigo: pcOperativa,
      origen: "MANUAL",
      operador_usuario: operador?.usuario || operador?.nombre || "Sistema"
    }).catch(err => console.error("Error registrando retiro en Supabase:", err));
    
    await window.ctrlElectron.navigateAgent();
  }catch(err){ autoResBox("autoRetirarRes", false, "Error: " + err.message); }
}

// ── Notificación al usuario por chat ──────────────────────────────────────────
// Le manda un mensaje al chat del usuario (en el portal) para que sepa el resultado de su solicitud.
// Prioriza la búsqueda en el caché local (poblado por el portal RPC) para respetar el pc_codigo
// del portal y evitar duplicados. Usa panel_core_enviar_chat_json cuando el chat ya existe.

// ── Sonda de sesión: enterarse ANTES de que lo descubra una carga ────────────
// En algunas oficinas la sesión de Agentes se cae sola y NODO se entera recién cuando va a
// cargar: justo con un cliente esperando y la plata ya transferida. La sonda hace lo mismo que
// haría una carga —una operación REAL contra el agente— cada tanto, cuando no hay nada en curso.
// Si la sesión está muerta, salta el mismo cortacircuitos de siempre y aparece el login, pero
// con el mostrador vacío en vez de en medio de una operación.
//
// Por qué NO se cambia la clave de un usuario de prueba, que fue la idea original: para detectar
// la caída alcanza con una operación real, y buscarUsuario ES la primera que hace toda carga —
// si la sesión murió, falla igual. Cambiar una clave cada 6 minutos escribe en el sistema de
// juego sin necesidad, y si ese usuario alguna vez resulta ser de alguien real, lo deja afuera.
// El diagnóstico es idéntico y no toca nada.
const SONDA_MINUTOS = 6;
const SONDA_CADA_MS = 60 * 1000;          // se fija cada minuto; sondea sólo si corresponde
window._drexUltimaOpOk = window._drexUltimaOpOk || Date.now();
let _sondaCorriendo = false;

function _sondaAgenteOcupado(){
  try{
    return !!(window._drexGlobalBusy
      || (typeof _watchdog !== 'undefined' && _watchdog && _watchdog.busy > 0)
      || window._v154pParcialBusy
      || window._operacionManualEnCurso
      || window._portalSolicitudOperacionEnCurso
      || (window._drexCola && (window._drexCola.activo || window._drexCola.pendientes > 0)));
  }catch(_e){ return true; }        // ante la duda, NO sondear
}

async function _sondaSesionTick(){
  if(_sondaCorriendo) return;
  if(!window.ctrlElectron) return;                    // sólo en la app de escritorio
  if(window._drexSinSesion) return;                   // ya está el login en pantalla
  if(_sondaAgenteOcupado()) return;                   // hay algo operando: eso ya prueba la sesión

  const inactivo = Date.now() - (window._drexUltimaOpOk || 0);
  if(inactivo < SONDA_MINUTOS * 60 * 1000) return;

  _sondaCorriendo = true;
  try{
    // Usuario de prueba de la oficina. Sin uno configurado se cae a ensureDrexSession, que
    // navega y muestra el login si hace falta: detecta menos casos, pero no queda a ciegas.
    const prueba = String(localStorage.getItem('nodo_sonda_usuario') || '').trim();
    if(prueba){
      // Operación REAL: pasa por el mismo camino que la primera parte de una carga, así que
      // si la sesión se cayó, callDrex levanta la bandera y salta el login solo.
      await callDrex('buscarUsuario', prueba);
    }else{
      await ensureDrexSession();
    }
    if(!window._drexSinSesion){
      window._drexUltimaOpOk = Date.now();
      // Refrescar el panel, como pediste: si estuvo quieto seis minutos, lo que muestra ya
      // envejeció. Silencioso: nadie quiere un toast cada seis minutos.
      try{ await refrescarTodo(false); }catch(_e){}
    }
  }catch(e){
    // Si falló por sesión, _drexMarcarSinSesion ya hizo su trabajo desde callDrex.
    console.warn('[sonda sesión]', e && e.message);
  }finally{
    _sondaCorriendo = false;
  }
}

// Configurar el usuario de prueba desde el panel.
window.sondaSesionUsuario = function(u){
  const v = String(u == null ? '' : u).trim();
  try{
    if(v) localStorage.setItem('nodo_sonda_usuario', v);
    else localStorage.removeItem('nodo_sonda_usuario');
  }catch(_e){}
  try{ toast(v ? ('Sonda de sesión: se va a chequear con "' + v + '"') : 'Sonda de sesión sin usuario de prueba', 'blue'); }catch(_e){}
  return v;
};

try{ setInterval(_sondaSesionTick, SONDA_CADA_MS); }catch(_e){}
// El resultado de un CAMBIO DE CLAVE va al chat que el jugador tiene abierto: el portal le dice
// "te avisamos por este mismo chat". notificarUsuarioEnChat (abajo) escribe en chat_sesiones /
// chat_mensajes, la generación de chat que el portal ya no lee — la clave se cambiaba y el jugador
// nunca se enteraba (Juan, 12/09). nodoIniciarChat usa su hilo si lo tiene y, si no, lo abre.
// Sólo para la clave: pasar TODOS los avisos por acá marcaría como respondidos chats que esperan a
// un operador, cada vez que se acredita una carga. Eso queda anotado en D-92, sin tocar.
// El aviso va a la conversación que el jugador ve en el portal. notificarUsuarioEnChat (abajo)
// escribe en chat_sesiones / chat_mensajes, la generación de chat que el portal ya no lee.
//   crearSiNoHay:true  → si no tiene conversación abierta, se le abre una. Para lo que PIDIÓ por el
//                        chat (la clave): el portal le promete "te avisamos por este mismo chat".
//   crearSiNoHay:false → sólo si ya tiene conversación. Para los avisos que salen solos (un pago de
//                        retiro), así no se llena la bandeja con un hilo nuevo por cada pago; para
//                        ese caso el jugador igual recibe la notificación del celular.
async function avisarJugadorEnChat(usuario, texto, opts){
  const crear = !!(opts && opts.crearSiNoHay);
  try{
    if(crear && typeof window.nodoIniciarChat === 'function'){
      const r = await window.nodoIniciarChat(usuario, texto);
      if(r && r.ok) return r;
      console.warn('[aviso] no se pudo abrir el chat del portal:', r && r.error);
    } else if(typeof window.nodoEnviarMensajePortal === 'function'){
      const r = await window.nodoEnviarMensajePortal(usuario, texto, false);
      if(r && r.ok) return r;
      // OJO: acá NO salió ningún push. nodoEnviarMensajePortal devuelve 'sin-ticket' ANTES de
      // mandarlo, así que con crearSiNoHay:false y sin conversación abierta el jugador no recibe
      // nada por este camino — se entera por la pantalla de Estado del portal, o no se entera.
      // El comentario anterior decía lo contrario y por eso nadie miraba este caso.
      if(r && r.error === 'sin-ticket') return { ok:false, error:'sin-ticket' };
      console.warn('[aviso] el chat del portal falló:', r && r.error);
    }
  }catch(e){ console.warn('[aviso] chat vivo falló:', e); }
  // El portal ya se intentó arriba: acá se va derecho al camino viejo, sin repetirlo.
  try{ return await notificarUsuarioEnChat(usuario, texto, true); }catch(_e){ return null; }
}
window.avisarJugadorEnChat = avisarJugadorEnChat;
async function _avisarClaveAlJugador(usuario, texto){
  return avisarJugadorEnChat(usuario, texto, { crearSiNoHay:true });
}
window._avisarClaveAlJugador = _avisarClaveAlJugador;

// Diecinueve lugares del panel le avisan algo al jugador llamando acá, y TODOS escribían
// directamente en chat_sesiones / chat_mensajes — la generación de chat que el portal ya no lee.
// El mensaje quedaba guardado en una tabla que nadie mira: ni le llegaba ni se veía el error.
// Se encontró con "marcar como ya cargada" (Juan, 30/9), pero le pasaba a los diecinueve.
//
// En vez de cambiar diecinueve llamadas, el ruteo vive acá: primero se intenta el hilo que el
// portal SÍ lee (y que además dispara el push), y recién si eso no se puede se escribe donde se
// escribía antes. No se abre conversación nueva: eso llenaría la bandeja con un hilo por cada
// aviso automático, que es lo que D-92 vino evitando. Para los avisos que el operador manda a
// propósito está avisarJugadorEnChat(..., {crearSiNoHay:true}).
//
// _sinPortal lo usa avisarJugadorEnChat, que ya probó el portal antes de caer acá: sin esto se
// intentaría dos veces.
async function notificarUsuarioEnChat(usuarioNombre, mensaje, _sinPortal){
  if(!usuarioNombre || !mensaje) return;

  if(!_sinPortal && typeof window.nodoEnviarMensajePortal === 'function'){
    try{
      const r = await window.nodoEnviarMensajePortal(usuarioNombre, mensaje, false);
      if(r && r.ok) return r;
      if(!(r && r.error === 'sin-ticket')) console.warn('[aviso] el hilo del portal fallo:', r && r.error);
    }catch(e){ console.warn('[aviso] el hilo del portal fallo:', e); }
  }

  // 1° busca en el caché local de chats (poblado por cargarChats vía RPC del portal)
  let chatId = null;
  const chatLocal = (window.chats || chats || []).find(c=>normalizar(c.USUARIO)===normalizar(usuarioNombre));
  if(chatLocal) chatId = chatLocal.ID_CHAT;

  // 2° si no está en caché, consulta la RPC del portal para encontrar el chat real
  if(!chatId){
    try{
      const r = await supabaseClient.rpc('panel_core_get_chat_sesiones_json', {
        p_pc_codigo: (pcOperativa || window.pcOperativa || '')
      });
      if(!r.error){
        let rows = r.data;
        try{ if(typeof rows === 'string') rows = JSON.parse(rows); }catch(_){}
        if(Array.isArray(rows)){
          const found = rows.find(c=>normalizar(c.usuario||c.USUARIO||'')===normalizar(usuarioNombre));
          if(found) chatId = String(found.chat_id||found.id||found.ID_CHAT||'');
        } else if(rows && Array.isArray(rows.rows)){
          const found = rows.rows.find(c=>normalizar(c.usuario||c.USUARIO||'')===normalizar(usuarioNombre));
          if(found) chatId = String(found.chat_id||found.id||found.ID_CHAT||'');
        }
      }
    }catch(_e){}
  }

  // 3° fallback: busca en la tabla directo (cualquier pc_codigo para este usuario)
  if(!chatId){
    const {data} = await supabaseClient.from("chats")
      .select("id")
      .eq("usuario", usuarioNombre)
      .order("updated_at",{ascending:false})
      .limit(1);
    if(data && data.length) chatId = data[0].id;
  }

  // 4° si aún no hay chat, crea uno (en el scope del portal)
  if(!chatId){
    const {data: usrData} = await supabaseClient.from("usuarios")
      .select("nombre, telefono")
      .eq("usuario", usuarioNombre).maybeSingle();

    const {data: nuevo} = await supabaseClient.from("chats").insert({
      usuario: usuarioNombre,
      nombre_completo: usrData?.nombre || "",
      telefono: usrData?.telefono || "",
      pc_codigo: pcOperativa || window.pcOperativa || '',
      sin_leer: 0
    }).select().single();
    chatId = nuevo?.id;
  }

  if(!chatId) return;

  // 5° envía via RPC (prueba las dos variantes que los patches usan)
  let enviado = false;
  const rpc1 = await supabaseClient.rpc('panel_nodo_send_chat_message', {
    p_chat_id: String(chatId),
    p_mensaje: mensaje,
    p_imagen_url: '',
    p_emisor: 'Sistema',
    p_pc_codigo: (pcOperativa || window.pcOperativa || '')
  });
  if(!rpc1.error){ enviado = true; }

  if(!enviado){
    const rpc2 = await supabaseClient.rpc('panel_core_enviar_chat_json', {
      p_chat_id: String(chatId),
      p_mensaje: mensaje,
      p_emisor: 'Sistema'
    });
    if(!rpc2.error){ enviado = true; }
  }

  if(!enviado){
    // fallback directo si ambos RPCs fallan
    await supabaseClient.from("mensajes_chat").insert({
      chat_id: chatId,
      mensaje,
      tipo_emisor: "OPERADOR",
      emisor: "Sistema",
      pc_codigo: pcOperativa || window.pcOperativa || '',
      leido: false
    });
    await supabaseClient.from("chats").update({
      ultimo_mensaje: mensaje,
      fecha_ultimo: new Date().toISOString()
    }).eq("id", chatId);
  }
}

async function ejecutarAutoClave(id){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }
  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s){ alert("Solicitud no encontrada."); return; }

  const usuario     = s.USUARIO || s.USUARIO_JUGADOR || "";
  const claveNueva  = s.PASSWORD_NUEVO || "12345a";

  if(!usuario){ alert("La solicitud no tiene usuario."); return; }

  toast("Abriendo backoffice...","blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  toast(`Buscando ${usuario}...`,"blue");
  const b = await callDrex("buscarUsuario", usuario);
  // Sesión caída o página de error NO es "el usuario no existe": la solicitud queda como estaba.
  if(b && (b.needsLogin || b.pageError)){
    toast('Se cayó la sesión de Agentes · no se tocó la solicitud. Entrá y reintentá.','red');
    throw new Error('sesión de Agentes caída');
  }

  if(!b.exists){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await _avisarClaveAlJugador(usuario,
      `❌ Tu solicitud de cambio de clave fue rechazada: el alias "${usuario}" no se encontró en el sistema de juego. ` +
      `Verificá que sea correcto o contactanos por acá.`);
    toast(`Usuario "${usuario}" no encontrado · rechazada`,"red");
    await refrescarTodo(false);
    return;
  }

  toast(`Cambiando clave a "${claveNueva}"...`,"blue");
  const r = await callDrex("cambiarClave", claveNueva);

  if(r && r.ok === false){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await _avisarClaveAlJugador(usuario,
      `❌ No pudimos cambiar tu clave: ${r.message || "error al ejecutar"}. Contactanos para revisarlo.`);
    toast("Error: "+(r.message||"falló el cambio"),"red");
    await refrescarTodo(false);
    return;
  }

  await actualizarSolicitudSupabase(id, {
    estado: "APROBADA",
    operador_usuario: operador.usuario || operador.nombre || ""
  });

  await _avisarClaveAlJugador(usuario,
    `✅ Tu clave fue actualizada correctamente.\n🔑 Nueva clave: *${claveNueva}*\nIngresá al casino con tu usuario y esta clave.`);

  toast(`Clave cambiada · ${usuario} → ${claveNueva}`, "green");
  await window.ctrlElectron.navigateAgent();
  await refrescarTodo(false);
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMBIO DE CLAVE AUTOMÁTICO
// Un reseteo de clave no necesita criterio del operador: no mueve plata, no hay
// monto que verificar ni comprobante que mirar. Pedir confirmación es hacerlo
// esperar por algo que va a aprobar siempre.
//
// Pero tampoco se dispara a ciegas: entre que la persona pide la clave y que se
// ejecuta puede llegar otra cosa (un retiro del mismo usuario, una carga a medio
// hacer), y el agente es UNO solo. Por eso hay una ventana de gracia con un aviso
// visible y un botón para BLOQUEAR.
//
// Bloqueada, o si la automática falla, la solicitud NO desaparece: queda en la
// bandeja de pendientes con un botón "Realizar" y la clave a la vista. El operador
// la hace cuando puede.
// ══════════════════════════════════════════════════════════════════════════════
const CLAVE_AUTO_SEGUNDOS = 25;   // ventana para bloquear. Si es poco/mucho, se cambia acá.
window._clavesBloqueadas = window._clavesBloqueadas || {};   // id → true (no reintentar sola)
window._clavesEnCuenta   = window._clavesEnCuenta   || {};   // id → timestamp de vencimiento

// El operador frena esta clave. NO la rechaza ni la cancela: la deja para hacerla a mano.
// Se llama "pausar" porque es lo que hace. "Bloquear" no le decía nada a nadie: sonaba a
// bloquear al usuario o a cancelarle el pedido, que es justo lo que no pasa.
window.pausarClaveAuto = function(id){
  window._clavesBloqueadas[String(id)] = true;
  delete window._clavesEnCuenta[String(id)];
  _claveAvisoQuitar(id);
  try{ toast('⏸ En pausa · la clave queda abajo con el botón Realizar','yellow'); }catch(_e){}
  try{ if(typeof renderSolicitudesPortalEnInicio==='function') renderSolicitudesPortalEnInicio(); }catch(_e){}
};
window.bloquearClaveAuto = window.pausarClaveAuto;   // nombre viejo, por si quedó alguna llamada

function _claveAvisoQuitar(id){
  try{ const el=document.getElementById('claveAviso'+id); if(el) el.remove(); }catch(_e){}
}
// El aviso vive arriba de la bandeja, fuera de la tabla: la tabla se repinta sola
// con cada poll y se lo llevaría puesto en el medio de la cuenta regresiva.
function _claveAvisoPintar(id, usuario, clave, restan){
  const cont = document.getElementById('tablaSolicitudesInicio');
  if(!cont || !cont.parentNode) return;
  let el = document.getElementById('claveAviso'+id);
  if(!el){
    el = document.createElement('div');
    el.id = 'claveAviso'+id;
    el.style.cssText = 'background:rgba(124,58,237,.12);border:1px solid #7c3aed66;border-radius:10px;'
      + 'padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    cont.parentNode.insertBefore(el, cont);
  }
  // Lo primero que se lee es QUÉ va a pasar y CUÁNDO, no el detalle. El detalle va abajo.
  // Antes el orden estaba al revés y el botón decía "Bloquear", así que el operador leía
  // los datos, no entendía qué se le pedía, y para cuando ataba cabos ya se había ejecutado.
  el.innerHTML = '<span style="font-size:20px">🔑</span>'
    + '<span style="flex:1;min-width:200px;font-size:13px;color:#c4b5fd">'
    +   '<b style="color:#fff;font-size:14px">Cambiando la clave en '+restan+'s</b>'
    +   '<span style="font-size:11.5px;color:#8b949e"> · se hace solo</span>'
    +   '<br><span style="font-size:12px;color:#c0cad8">'+escapeHtml(usuario)+' → '
    +   '<b style="font-family:ui-monospace,monospace;color:#a78bfa">'+escapeHtml(clave)+'</b></span>'
    + '</span>'
    + '<button class="mini-btn" style="background:#a16207;color:#fff;border:none;font-weight:800;font-size:13px;padding:8px 14px" '
    +   'onclick="pausarClaveAuto('+id+')">⏸ Pausar</button>';
}

// Corre cada segundo: pinta la cuenta regresiva y dispara cuando vence.
let _claveAutoCorriendo = false;
// `estadoCerrado` vive DENTRO del módulo del portal y no existe en el ámbito del panel:
// `typeof estadoCerrado` da 'undefined' acá. Verificado corriendo el bundle entero. Como los
// dos usos estaban escritos como `typeof estadoCerrado==='function' && estadoCerrado(...)`,
// la condición era SIEMPRE falsa y el filtro de "ya cerrada" nunca corría: una solicitud de
// cambio de clave ya aprobada seguía en la lista y el ciclo la volvía a ejecutar cada 25 s.
// Media hora cambiándole la clave al mismo jugador una y otra vez.
const _ESTADOS_CERRADOS = ["ACREDITADA","PAGADA","APROBADA","APROBADA_MANUAL","RECHAZADA",
                           "CANCELADA","CERRADA","CERRADO","FINALIZADA","OK","COMPLETADA","REVERTIDA"];
function _estadoYaCerrado(e){
  return _ESTADOS_CERRADOS.indexOf(String(e||"").trim().toUpperCase()) !== -1;
}
window._estadoYaCerrado = _estadoYaCerrado;

// Segunda red: una solicitud ejecutada NO se vuelve a ejecutar en esta sesión, pase lo que
// pase con el estado. Si el update a la base falla (como pasaba con la tabla muerta), el
// peor caso es que quede en la bandeja — no que se le cambie la clave setenta veces.
window._clavesHechas = window._clavesHechas || {};

async function _claveAutoTick(){
  if(_claveAutoCorriendo) return;
  if(!window.ctrlElectron) return;                       // sólo en la app de escritorio
  let lista = [];
  try{
    lista = ((window.V154P && window.V154P.solicitudes) || []).filter(function(s){
      if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()!=='CAMBIO_CLAVE') return false;
      if(_estadoYaCerrado(s.ESTADO)) return false;
      const id=String(s.ID||s.SOLICITUD_ID||'');
      if(window._clavesHechas[id]) return false;      // ya se ejecutó en esta sesión
      return id && !window._clavesBloqueadas[id];
    });
  }catch(_e){ return; }

  // Limpiar avisos de las que ya no están (se ejecutaron, se rechazaron, se fueron).
  try{
    const vivos = {}; lista.forEach(function(s){ vivos[String(s.ID||s.SOLICITUD_ID)]=1; });
    Object.keys(window._clavesEnCuenta).forEach(function(id){
      if(!vivos[id]){ delete window._clavesEnCuenta[id]; _claveAvisoQuitar(id); }
    });
  }catch(_e){}

  if(!lista.length) return;

  const ahora = Date.now();
  for(const s of lista){
    const id = String(s.ID || s.SOLICITUD_ID || '');
    const usuario = s.USUARIO || s.USUARIO_JUGADOR || '';
    const clave = s.PASSWORD_NUEVO || '12345a';
    if(!usuario) continue;

    if(!window._clavesEnCuenta[id]){
      window._clavesEnCuenta[id] = ahora + CLAVE_AUTO_SEGUNDOS*1000;
      try{ sonido && sonido('nueva'); }catch(_e){}
    }
    const restan = Math.ceil((window._clavesEnCuenta[id]-ahora)/1000);
    if(restan > 0){ _claveAvisoPintar(id, usuario, clave, restan); continue; }

    // Venció la ventana. Si el agente está ocupado NO se fuerza: se deja la cuenta
    // corriendo un poco más. Meterse en el medio de una carga es peor que demorar
    // un reseteo de clave.
    const ocupado = !!(window._drexGlobalBusy
      || (typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0)
      || window._v154pParcialBusy
      || (window._drexCola && (window._drexCola.activo || window._drexCola.pendientes>0)));
    if(ocupado){
      _claveAvisoPintar(id, usuario, clave, 0);
      window._clavesEnCuenta[id] = ahora + 8000;   // reintenta en 8s
      continue;
    }

    _claveAvisoQuitar(id);
    delete window._clavesEnCuenta[id];
    // Se marca ANTES de ejecutar, no después: si el cambio tarda y el tick vuelve a correr,
    // no puede agarrarla de nuevo. Y si falla, tampoco se reintenta sola — el operador tiene
    // el botón "Realizar". Reintentar solo un cambio de clave que quizás ya se hizo es peor.
    window._clavesHechas[id] = Date.now();
    _claveAutoCorriendo = true;
    try{
      await ejecutarAutoClave(id);
    }catch(e){
      // Falló sola → NO se pierde: se marca como bloqueada para que no entre en bucle
      // y quede en la bandeja con el botón "Realizar".
      window._clavesBloqueadas[id] = true;
      try{ toast('No se pudo cambiar la clave sola: '+((e&&e.message)||'')+' · quedó en pendientes','red'); }catch(_e){}
      try{ if(typeof renderSolicitudesPortalEnInicio==='function') renderSolicitudesPortalEnInicio(); }catch(_e){}
    }finally{ _claveAutoCorriendo = false; }
    break;   // de a una por vuelta: el agente es uno solo
  }
}
try{ setInterval(_claveAutoTick, 1000); }catch(_e){}

async function resetClaveRapido(usuario, claveNueva="12345a"){
  if(!window.ctrlElectron){ alert("Solo en la app de escritorio."); return; }
  if(!usuario){ alert("Sin usuario."); return; }

  toast(`Reseteando clave de ${usuario}...`,"blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  const b = await callDrex("buscarUsuario", usuario);
  if(!b.exists){ toast(`Usuario "${usuario}" no encontrado.`,"red"); return; }

  const r = await callDrex("cambiarClave", claveNueva);
  if(r && r.ok === false){ toast("Error: "+(r.message||"falló"),"red"); return; }

  // Sin esto la clave no quedaba en ningún lado: _resetClaveManual sí la registraba, este
  // camino no. Y es el que usan el chat y el perfil, así que después no se le podía decir
  // al jugador cuál es su clave (medido: sólo el 3,9 % de los usuarios la tenía recuperable).
  try{
    await registrarEnHistorial({ usuario, tipo:'RESET_CLAVE', monto:0, origen:'MANUAL',
      estado:'OK', notas:'clave → '+claveNueva });
  }catch(_e){}

  toast(`Clave reseteada a "${claveNueva}"`, "green");
  await window.ctrlElectron.navigateAgent();
}

// Cambiar la clave desde la ficha del jugador, preguntando cuál poner. Va por
// resetClaveRapido porque ese busca al usuario en el agente antes de cambiarla.
window.cambiarClaveJugador = function(usuario){
  const u = String(usuario||"").trim();
  if(!u){ toast("Sin usuario.","red"); return; }
  abrirModal('🔑 Cambiar la clave de '+escapeHtml(u),
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Se la cambiamos en el agente y queda anotada, '
    + 'así después se la podés pasar desde «Datos de ingreso».</div>'
    + '<label>Clave nueva</label>'
    + '<input id="claveNuevaJug" type="text" autocomplete="off" value="12345a">',
    async function(){
      const c = String((document.getElementById("claveNuevaJug")||{}).value||"").trim();
      if(c.length < 6){ toast("La clave tiene que tener al menos 6 caracteres.","red"); return; }
      cerrarModal();
      await resetClaveRapido(u, c);
      try{ pjDatosIngreso(u); }catch(_e){}   // volver a la ficha, ya con la clave
    }, 'Cambiar clave');
};

async function retirarSaldoRapido(usuario, monto){
  if(!window.ctrlElectron){ alert("Solo en la app de escritorio."); return; }
  monto = Number(monto);
  if(!usuario || !monto || monto <= 0){ alert("Usuario y monto requeridos."); return; }

  toast(`Retirando $${monto.toLocaleString("es-AR")} de ${usuario}...`, "blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  const b = await callDrex("buscarUsuario", usuario);
  if(!b.exists){ toast(`Usuario "${usuario}" no encontrado.`,"red"); return; }

  const saldoRawRapido = String(b.balance?.raw || "");
  const saldo = b.balance?.value ?? null;
  const saldoConfiableRapido = /\d/.test(saldoRawRapido) && typeof saldo === "number" && Number.isFinite(saldo);
  if(saldoConfiableRapido && saldo >= 0 && saldo < monto){
    toast(`Saldo insuficiente: ${b.balance.raw.trim()}`, "red");
    await window.ctrlElectron.navigateAgent();
    return;
  }

  const r = await callDrex("retirarSaldo", monto);
  if(r && r.ok === false){ toast("Error: " + (r.message||"falló"), "red"); return; }

  // Esto insertaba en la tabla `solicitudes`, muerta desde el 30 de mayo: el retiro salía y no
  // quedaba registrado en ningún lado vivo. Y como la regla de 24 h mira historial_ops, este
  // retiro era invisible para ella: la persona podía sacar por acá y volver a sacar por el
  // portal el mismo día. Ahora va al historial de verdad.
  try{
    await registrarEnHistorial({ usuario, tipo:'RETIRO', monto, billetera_id:null,
      billetera_nombre:null, origen:'CHAT', estado:'OK', notas:'Retiro rápido desde el chat' });
  }catch(_e){}
  await supabaseClient.from("solicitudes").insert({
    tipo: "RETIRO",
    usuario: usuario,
    monto: monto,
    estado: "PAGADA",
    pc_codigo: pcOperativa,
    origen: "CHAT",
    operador_usuario: operador?.usuario || operador?.nombre || "Sistema"
  }).catch(err => console.error("Error registrando retiro en solicitudes:", err));

  // Saldo pre / post leídos por el casino (en el mismo modal del retiro)
  const saldoPreCasinoR  = (typeof r?.previousBalance?.value === 'number') ? r.previousBalance.value : null;
  const saldoPostCasinoR = (typeof r?.newBalance?.value === 'number')      ? r.newBalance.value      : null;
  const saldoPreR  = saldoPreCasinoR  !== null ? saldoPreCasinoR  : (b.balance?.value ?? null);
  const saldoPostR = saldoPostCasinoR !== null ? saldoPostCasinoR : (saldoPreR !== null ? saldoPreR - monto : null);

  // Registrar en historial de operaciones para que aparezca en el panel
  const bilR = getBilleraLanding();
  let movChuniorR = null;
  if(bilR && bilR.CHUNIOR_UID){
    try {
      const rChu = await registrarRetiroEnChunior(bilR.CHUNIOR_UID, monto, usuario);
      if(rChu.ok && rChu.movimientoId) movChuniorR = rChu.movimientoId;
      else if(rChu.error) toast('⚠️ Retiro OK en casino pero falló en Chunior: '+rChu.error, 'red');
    } catch(e){ toast('⚠️ Error en Chunior: '+(e.message||''), 'red'); }
  }
  await registrarEnHistorial({
    usuario,
    tipo: 'RETIRO',
    monto,
    billetera_id:        bilR ? bilR.ID_BILLETERA   : null,
    billetera_nombre:    bilR ? bilR.NOMBRE_VISIBLE : null,
    origen: 'CHAT',
    estado: 'OK',
    chunior_movimiento_id: movChuniorR,
    saldo_post: saldoPostR
  });
  // Recién comparamos fichas si Chunior confirmó el movimiento
  if(movChuniorR) _watchdogTrigger(1500);

  toast(`Retiro completado · ${usuario} · $${monto.toLocaleString("es-AR")}`, "green");
  await window.ctrlElectron.navigateAgent();
}

async function cargarSaldoRapido(usuario, monto){
  if(!window.ctrlElectron){ alert("Solo en la app de escritorio."); return; }
  monto = Number(monto);
  if(!usuario || !monto || monto<=0){ alert("Usuario y monto requeridos."); return; }

  toast(`Cargando $${monto} a ${usuario}...`,"blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  // CARGA: no necesitamos balance → skipBalance evita abrir/cerrar modal extra
  const b = await callDrex("buscarUsuario", usuario, { skipBalance: true });
  if(!b.exists){ toast(`Usuario "${usuario}" no encontrado.`,"red"); return; }

  const r = await callDrex("cargarSaldo", monto);
  if(r && r.ok === false){ toast("Error: "+(r.message||"falló"),"red"); return; }

  // Saldo PRE leído del casino o de la búsqueda. POST siempre calculado.
  const saldoPreCasinoC = (typeof r?.previousBalance?.value === 'number') ? r.previousBalance.value : null;
  const saldoPreC  = saldoPreCasinoC !== null ? saldoPreCasinoC : (b.balance?.value ?? null);
  const saldoPostC = (saldoPreC !== null) ? saldoPreC + monto : null;

  // Detección de duplicado SOLO con lectura post confiable
  const saldoPostLeidoC = (typeof r?.newBalance?.value === 'number') ? r.newBalance.value : null;
  const postConfiableC  = saldoPostLeidoC !== null && !r?.newBalance?.unchanged;
  if(saldoPreCasinoC !== null && postConfiableC){
    const movido = saldoPostLeidoC - saldoPreCasinoC;
    const veces  = Math.round(movido / monto);
    if(veces >= 2 && veces <= 4 && Math.abs(movido - veces * monto) < 1){
      toast('🚨 POSIBLE CARGA DUPLICADA ('+veces+'x) · saldo subió de '+money(saldoPreCasinoC)+' a '+money(saldoPostLeidoC), 'red');
    }
  }

  // Auto-registrar al usuario en NODO si no existe (segundo plano)
  if(b?.user) _autoregistrarUsuarioSiFalta(b.user);

  // Registrar en historial de operaciones
  const bilC = getBilleraLanding();
  await registrarEnHistorial({
    usuario,
    tipo: 'CARGA',
    monto,
    billetera_id:     bilC ? bilC.ID_BILLETERA   : null,
    billetera_nombre: bilC ? bilC.NOMBRE_VISIBLE : null,
    origen: 'CHAT',
    estado: 'OK',
    saldo_post: saldoPostC
  });
  // Sin registro en Chunior → no comparamos fichas (daría diferencia segura)

  toast(`Carga completada · ${usuario} · $${monto.toLocaleString("es-AR")}`,"green");
  await window.ctrlElectron.navigateAgent();
}

async function ejecutarAutoRetiro(id){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }

  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s){ alert("Solicitud no encontrada."); return; }

  const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
  const monto   = Number(s.MONTO_REAL || s.MONTO_DECLARADO || s.MONTO || 0);

  if(!usuario){ alert("La solicitud no tiene usuario asociado."); return; }
  if(!monto)  { alert("La solicitud no tiene monto válido."); return; }

  // Política de 24hs — advertencia, el operador decide
  const check = await verificarRetiro24h(usuario);
  if(check.bloqueado){
    const proceder = await confirmarRetiroDuplicado(check);
    if(!proceder){
      await notificarUsuarioEnChat(usuario, `⛔ Tu solicitud de retiro fue rechazada: ${check.mensaje}`);
      await actualizarSolicitudSupabase(id, {
        estado: "RECHAZADA",
        operador_usuario: operador.usuario || operador.nombre || ""
      });
      toast(check.mensaje, "red");
      await refrescarTodo(false);
      return;
    }
    // El operador decidió proceder igualmente
  }

  toast("Abriendo backoffice...","blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  toast(`Buscando ${usuario}...`,"blue");
  const b = await callDrex("buscarUsuario", usuario);
  // Sesión caída o página de error NO es "el usuario no existe": la solicitud queda como estaba.
  if(b && (b.needsLogin || b.pageError)){
    toast('Se cayó la sesión de Agentes · no se tocó la solicitud. Entrá y reintentá.','red');
    await refrescarTodo(false); return;
  }
  if(!b.exists){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Tu retiro fue rechazado: el alias "${usuario}" no se encontró en el sistema de juego.`);
    toast(`Usuario "${usuario}" no encontrado · rechazada`,"red");
    await refrescarTodo(false);
    return;
  }

  const saldo = b.balance?.value ?? -1;
  if(saldo >= 0 && saldo < monto){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Tu retiro de $${monto.toLocaleString("es-AR")} fue rechazado: saldo insuficiente (${b.balance.raw.trim()} disponible).`);
    toast(`Saldo insuficiente: ${b.balance.raw.trim()}`,"red");
    await window.ctrlElectron.navigateAgent();
    await refrescarTodo(false);
    return;
  }

  // Confirmación mostrando billetera y saldo antes de ejecutar
  await cargarBilleteras(false);
  const bilConf = getBilleraLanding();
  if(bilConf){
    const saldoBil = Number(bilConf.SALDO||0);
    const confirmMsg = `Retiro automático: $${monto.toLocaleString("es-AR")} para ${usuario}\n\nBilletera: ${bilConf.NOMBRE_VISIBLE}\nSaldo disponible: $${saldoBil.toLocaleString("es-AR")}${saldoBil<monto?" ⚠️ (insuficiente)":""}\n\n¿Confirmar?`;
    if(!confirm(confirmMsg)) return;
  }

  toast(`Retirando $${monto.toLocaleString("es-AR")}...`,"blue");
  const r = await callDrex("retirarSaldo", monto);

  if(r && r.ok === false){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ No pudimos procesar tu retiro: ${r.message||"falló"}. Contactanos.`);
    toast("Error: "+(r.message||"falló"),"red");
    await refrescarTodo(false);
    return;
  }

  await actualizarSolicitudSupabase(id, {
    estado: "PAGADA",
    operador_usuario: operador.usuario || operador.nombre || ""
  });

  const bilRetiro = getBilleraLanding();
  if(bilRetiro) await ajustarSaldoBilletera(bilRetiro.ID_BILLETERA, -monto);

  await notificarUsuarioEnChat(usuario,
    `✅ Tu retiro de $${monto.toLocaleString("es-AR")} fue procesado. Lo transferimos a tu CBU/CVU.`);

  toast(`Retiro automático completado · ${usuario} · ${monto.toLocaleString("es-AR")}`, "green");
  {
    const bilR = getBilleraLanding();
    let movChuniorAR = null;
    if(bilR && bilR.CHUNIOR_UID){
      try {
        const rChu = await registrarRetiroEnChunior(bilR.CHUNIOR_UID, monto, usuario);
        if(rChu.ok && rChu.movimientoId) movChuniorAR = rChu.movimientoId;
        else if(rChu.error) toast('⚠️ Retiro OK pero falló en Chunior: '+rChu.error, 'red');
      } catch(e){ toast('⚠️ Error en Chunior: '+(e.message||''), 'red'); }
    }
    const saldoPreCasinoAR  = (typeof r?.previousBalance?.value === 'number') ? r.previousBalance.value : null;
    const saldoPostCasinoAR = (typeof r?.newBalance?.value === 'number')      ? r.newBalance.value      : null;
    const saldoPreAR  = saldoPreCasinoAR  !== null ? saldoPreCasinoAR  : (b.balance?.value ?? null);
    const saldoPostAR = saldoPostCasinoAR !== null ? saldoPostCasinoAR : (saldoPreAR !== null ? saldoPreAR - monto : null);
    await registrarEnHistorial({usuario, tipo:'RETIRO', monto, billetera_id:bilR?bilR.ID_BILLETERA:null, billetera_nombre:bilR?bilR.NOMBRE_VISIBLE:null, origen:'AUTO', estado:'OK', solicitud_id:id, chunior_movimiento_id:movChuniorAR, saldo_post:saldoPostAR});
    if(movChuniorAR) _watchdogTrigger(1500);
  }
  await window.ctrlElectron.navigateAgent();
  await refrescarTodo(false);
}

async function ejecutarAutoCarga(id){
  if(!window.ctrlElectron){ alert("La automatización solo funciona en la app de escritorio."); return; }

  const s = solicitudes.find(x=>String(x.ID||x.SOLICITUD_ID)===String(id));
  if(!s){ alert("Solicitud no encontrada."); return; }

  const usuario = s.USUARIO || s.USUARIO_JUGADOR || "";
  const monto   = Number(s.MONTO_REAL || s.MONTO_DECLARADO || s.MONTO || 0);

  if(!usuario){ alert("La solicitud no tiene usuario asociado."); return; }
  if(!monto)  { alert("La solicitud no tiene monto válido."); return; }

  toast("Abriendo backoffice...","blue");
  if(!await ensureDrexSession()){ toast("Sesión de backoffice requerida.","red"); return; }

  toast(`Buscando usuario ${usuario}...`,"blue");
  // CARGA auto: no necesitamos balance del jugador → evitamos el abrir/cerrar modal
  const busqueda = await callDrex("buscarUsuario", usuario, { skipBalance: true });
  // Sesión caída o página de error NO es "el usuario no existe": la solicitud queda como estaba.
  if(busqueda && (busqueda.needsLogin || busqueda.pageError)){
    toast('Se cayó la sesión de Agentes · no se tocó la solicitud. Entrá y reintentá.','red');
    await refrescarTodo(false); return;
  }
  if(!busqueda.exists){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Tu carga de $${monto.toLocaleString("es-AR")} fue rechazada: el alias "${usuario}" no se encontró en el sistema de juego. Verificá tu usuario o contactanos.`);
    toast(`Usuario "${usuario}" no encontrado · rechazada`,"red");
    await refrescarTodo(false);
    return;
  }

  toast(`Cargando $${monto.toLocaleString("es-AR")}...`,"blue");
  const resultado = await callDrex("cargarSaldo", monto);

  if(!resultado.ok && resultado.ok !== undefined){
    await actualizarSolicitudSupabase(id, {
      estado: "RECHAZADA",
      operador_usuario: operador.usuario || operador.nombre || ""
    });
    await notificarUsuarioEnChat(usuario,
      `❌ Error al cargar tus $${monto.toLocaleString("es-AR")}: ${resultado.message || "sin detalle"}. Contactanos para revisarlo.`);
    toast("Error al cargar saldo: " + (resultado.message || "sin detalle"), "red");
    await refrescarTodo(false);
    return;
  }

  await actualizarSolicitudSupabase(id, {
    estado: "ACREDITADA",
    operador_usuario: operador.usuario || operador.nombre || ""
  });

  const bilLanding = getBilleraLanding();
  if(bilLanding) await ajustarSaldoBilletera(bilLanding.ID_BILLETERA, monto);

  await notificarUsuarioEnChat(usuario,
    `✅ Tu carga fue acreditada: $${monto.toLocaleString("es-AR")}. ¡Ya podés jugar!`);

  toast(`Carga automática completada · ${usuario} · ${monto.toLocaleString("es-AR")}`, "green");

  // Registrar el movimiento en Chunior (solo si la billetera tiene chunior_uid configurado)
  let movimientoChunior = null;
  const bilL = getBilleraLanding();
  if(bilL && bilL.CHUNIOR_UID){
    try {
      const rChu = await registrarCargaEnChunior(bilL.CHUNIOR_UID, monto, usuario);
      if(rChu.ok && rChu.movimientoId){
        movimientoChunior = rChu.movimientoId;
        toast(`📋 Movimiento Chunior N° ${rChu.movimientoId}`, 'blue');
      } else if(rChu.error){
        // Las fichas YA salieron. Si Chunior no la tomó, la anotación NO se pierde: queda guardada
        // y se reintenta sola cuando Chunior vuelve. Antes acá terminaba todo con un toast rojo y
        // el descuadre aparecía recién al cotejar, horas después.
        toast('⚠️ Carga OK en casino pero falló en Chunior: '+rChu.error, 'red');
        // Las fichas ya salieron: la anotación queda pendiente y se reintenta sola.
        try{ window.chuniorPendienteAdd({ tipo:'CARGA', uid:bilL.CHUNIOR_UID, monto:monto, usuario:usuario, motivo:rChu.error }); }catch(_e){}
      }
    } catch(e){
      toast('⚠️ Error registrando en Chunior: '+(e.message||''), 'red');
      try{ window.chuniorPendienteAdd({ tipo:'CARGA', uid:bilL.CHUNIOR_UID, monto:monto, usuario:usuario, motivo:e.message||'excepción' }); }catch(_e){}
    }
  }

  // Saldo PRE leído del casino o busqueda. POST siempre calculado.
  const saldoPreCasinoAC = (typeof resultado?.previousBalance?.value === 'number' && !resultado?.previousBalance?.unchanged) ? resultado.previousBalance.value : null;
  const saldoPreAC  = saldoPreCasinoAC !== null ? saldoPreCasinoAC : (busqueda.balance?.value ?? null);
  const saldoPostAC = (saldoPreAC !== null) ? saldoPreAC + monto : null;

  // Duplicado: solo si post fue confiable
  const saldoPostLeidoAC = (typeof resultado?.newBalance?.value === 'number') ? resultado.newBalance.value : null;
  const postConfiableAC  = saldoPostLeidoAC !== null && !resultado?.newBalance?.unchanged;
  if(saldoPreCasinoAC !== null && postConfiableAC){
    const movidoAC = saldoPostLeidoAC - saldoPreCasinoAC;
    const vecesAC  = Math.round(movidoAC / monto);
    if(vecesAC >= 2 && vecesAC <= 4 && Math.abs(movidoAC - vecesAC * monto) < 1){
      toast('🚨 POSIBLE CARGA DUPLICADA ('+vecesAC+'x) · saldo subió de '+money(saldoPreCasinoAC)+' a '+money(saldoPostLeidoAC), 'red');
    }
  }
  // Auto-registrar al usuario en NODO si no existe (segundo plano)
  if(busqueda?.user) _autoregistrarUsuarioSiFalta(busqueda.user);
  await registrarEnHistorial({usuario, tipo:'CARGA', monto, billetera_id:bilL?bilL.ID_BILLETERA:null, billetera_nombre:bilL?bilL.NOMBRE_VISIBLE:null, origen:'AUTO', estado:'OK', solicitud_id:id, chunior_movimiento_id:movimientoChunior, saldo_post:saldoPostAC});
  if(movimientoChunior) _watchdogTrigger(1500);
  await window.ctrlElectron.navigateAgent();
  await refrescarTodo(false);
}

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
const CHUNIOR_BASE = 'https://bo.chunior.com';
const CHUNIOR_HOME = CHUNIOR_BASE + '/transacciones/';
let _chuniorInited = false;
let _nodoListo    = false;  // true después de finalizarLogin, gatea el modal de puesto

function activarChunior(){
  if(!window.chunior) return;
  if(!_chuniorInited){
    _chuniorInited = true;
    // Polling de status cada 3s: la lógica de Chunior corre en una ventana separada (visible).
    setInterval(async function(){
      try {
        const url = await window.chunior.getUrl();
        if(!url || url.includes('about:blank')) return;
        _setChuniorStatus(!url.includes('/login/'), url);
        if(!_nodoListo) return; // todavía en el login inicial de NODO

        // Inspeccionar el DOM de Chunior: ¿selector de puesto? ¿form de login?
        const estado = await window.chunior.exec(
          '(function(){' +
            'var s=document.getElementById("id_pt");' +
            'if(s){var o=Array.from(s.options).filter(function(x){return x.value!=="";}).map(function(x){return{value:x.value,text:x.text.trim()};});return{tipo:"pt", opts:o};}' +
            // Form de login: #id_username presente (sesión cerrada del todo)
            'if(document.getElementById("id_username")) return {tipo:"login"};' +
            'return {tipo:"ok"};' +
          '})()'
        );

        if(estado && estado.tipo === 'pt' && estado.opts.length > 0 && !window._chuniorPtModalOpen){
          window._chuniorPtModalOpen = true;
          _chuniorElegirPuesto(estado.opts);
        } else if(estado && estado.tipo === 'login'){
          // Sesión de Chunior cerrada del todo → pedir re-login (sin reiniciar NODO)
          _mostrarModalReloginChunior();
        }
      } catch(e){}
    }, 3000);
  }
}

// Después del login, chequear si Chunior está esperando selección de puesto y arrancar el flujo
async function _checkPuestoPostLogin(){
  if(!window.chunior) return;
  await new Promise(function(r){setTimeout(r,500);});
  try {
    const ptData = await window.chunior.exec(
      '(function(){var s=document.getElementById("id_pt");if(!s)return null;var o=Array.from(s.options).filter(function(x){return x.value!=="";}).map(function(x){return{value:x.value,text:x.text.trim()};});return{isPt:true,opts:o};})()'
    );
    if(ptData && ptData.isPt && ptData.opts.length > 0){
      _chuniorElegirPuesto(ptData.opts);
    } else {
      // Ya está en una página normal: sincronizar billeteras directamente
      setTimeout(function(){ sincronizarBilleterasChunior(true).catch(function(){}); }, 800);
    }
  } catch(e){}
}

function chuniorCerrarSesion(){
  if(!confirm('¿Cerrar sesión de Chunior?\n\nEsto también te va a deslogear de NODO.')) return;
  if(window.chunior) window.chunior.navigate(CHUNIOR_BASE + '/accounts/logout/');
  // Cerrar NODO también
  localStorage.removeItem('nodo_operador_lite');
  localStorage.removeItem('nodo_pc_operativa_lite');
  setTimeout(function(){ location.reload(); }, 600);
}

function _setChuniorStatus(loggedIn, url){
  const dot = document.getElementById('chuniorStatus');
  const bar = document.getElementById('chuniorStatusBar');
  if(dot) dot.textContent = loggedIn ? '🟢' : '🔴';
  if(bar) bar.textContent = loggedIn ? 'Sesión activa' : 'Sin sesión';
}

// ── Re-login de Chunior cuando la sesión se cae a mitad de la jornada ──────────
// No guardamos la clave de Chunior (regla de seguridad), así que cuando la sesión
// se cierra le pedimos al operador que la reingrese. Reusa validarLoginChunior.
let _chuniorReloginAbierto = false;
function _mostrarModalReloginChunior(){
  if(_chuniorReloginAbierto) return;           // ya está abierto
  if(window._chuniorPtModalOpen) return;       // el modal de puesto tiene prioridad
  _chuniorReloginAbierto = true;

  abrirModal(
    '🔐 Sesión de Chunior cerrada',
    '<div style="margin-bottom:10px;color:#c0cad8;font-size:13px">La sesión del backoffice de Chunior se cerró.<br>Reingresá tus credenciales para seguir registrando movimientos.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">USUARIO CHUNIOR</label>' +
    '<input id="chuReUser" type="text" autocomplete="off" placeholder="(tu usuario de Chunior)" style="margin-bottom:12px" value="">' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">CONTRASEÑA</label>' +
    '<input id="chuRePass" type="password" autocomplete="off" placeholder="(tu clave)" value="">' +
    '<div id="chuReErr" style="color:var(--red);font-size:12px;margin-top:8px;min-height:16px"></div>',
    null,
    'Reconectar'
  );

  const btn = document.getElementById('modalSaveBtn');
  if(btn) btn.onclick = _ejecutarReloginChunior;
  const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn) cancelBtn.onclick = function(){
    cerrarModal();
    _chuniorReloginAbierto = false;
    toast('Chunior sigue sin sesión · los movimientos no se registrarán', 'red');
  };
  setTimeout(function(){
    const u = document.getElementById('chuReUser');
    const p = document.getElementById('chuRePass');
    if(u){ u.focus(); u.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); p?.focus(); } }); }
    if(p){ p.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); _ejecutarReloginChunior(); } }); }
  }, 80);
}

async function _ejecutarReloginChunior(){
  const user = (document.getElementById('chuReUser')?.value || '').trim();
  const pass = (document.getElementById('chuRePass')?.value || '').trim();
  const errEl = document.getElementById('chuReErr');
  const btn = document.getElementById('modalSaveBtn');
  if(!user || !pass){ if(errEl) errEl.textContent = 'Completá usuario y contraseña.'; return; }
  if(btn){ btn.disabled = true; btn.textContent = 'Reconectando...'; }
  if(errEl) errEl.textContent = '';
  try {
    const ok = await validarLoginChunior(user, pass);
    if(ok){
      const sb = document.getElementById('modalSaveBtn');
      if(sb){ sb.onclick = null; sb.disabled = false; sb.textContent = 'Guardar'; }
      cerrarModal();
      _chuniorReloginAbierto = false;
      toast('✅ Sesión de Chunior reconectada', 'green');
      // Chequear si quedó esperando selección de puesto
      setTimeout(function(){ _checkPuestoPostLogin(); }, 800);
    } else {
      if(errEl) errEl.textContent = 'Usuario o clave incorrectos (rechazado por Chunior).';
      if(btn){ btn.disabled = false; btn.textContent = 'Reconectar'; }
    }
  } catch(e){
    if(errEl) errEl.textContent = 'Error: ' + (e.message || 'sin detalle');
    if(btn){ btn.disabled = false; btn.textContent = 'Reconectar'; }
  }
}

function _chuniorElegirPuesto(opts){
  const optsHtml = opts.map(function(o){
    return '<button class="btn btn-primary" style="margin-bottom:8px" onclick="_chuniorConfirmarPuesto('+_jsonAttr(o.value)+','+_jsonAttr(o.text)+')">'+escapeHtml(o.text)+'</button>';
  }).join('');
  abrirModal('📋 Chunior — Seleccioná tu puesto',
    '<div class="small" style="margin-bottom:14px;color:var(--muted)">Elegí el puesto de trabajo para esta sesión. Si cancelás, NODO se reinicia.</div>'+
    '<div style="display:flex;flex-direction:column;gap:4px">'+optsHtml+'</div>',
    null, null
  );
  // Sobrescribir el botón Cancelar para que recargue la app
  const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn){
    cancelBtn._origOnclick = cancelBtn.onclick;
    cancelBtn.onclick = function(){
      cerrarModal();
      toast('Reiniciando NODO...', 'blue');
      setTimeout(function(){ location.reload(); }, 600);
    };
  }
  // Ocultar el botón Guardar
  const saveBtn = document.getElementById('modalSaveBtn');
  if(saveBtn) saveBtn.style.display = 'none';
}

function _restaurarBotonesModal(){
  const cancelBtn = document.querySelector('#modalOverlay .btn-gray');
  if(cancelBtn && cancelBtn._origOnclick){
    cancelBtn.onclick = cancelBtn._origOnclick;
    delete cancelBtn._origOnclick;
  }
  const saveBtn = document.getElementById('modalSaveBtn');
  if(saveBtn) saveBtn.style.display = '';
}

async function _chuniorConfirmarPuesto(value, text){
  _restaurarBotonesModal();
  cerrarModal();
  window._chuniorPtModalOpen = false;
  if(!window.chunior) return;
  try {
    // 1. Submit del puesto en Chunior
    await window.chunior.exec(
      '(function(){var s=document.getElementById("id_pt");var b=document.querySelector("input[type=\'submit\'],button[type=\'submit\'],.btn");if(s&&b){s.value='+JSON.stringify(value)+';b.click();}})()'
    );
    toast('Chunior: puesto '+text+' seleccionado', 'green');

    // 2. Resolver el puesto → pc_codigo + oficina_id vía nodo_oficina_aliases (sin hardcode)
    let pcCodigoNuevo = normalizarPcCodigo(text);
    let oficinaIdNueva = pcCodigoNuevo;
    try{
      const rr = await supabaseClient.rpc('panel_resolver_puesto', { p_nombre: text, p_secret: window.PANEL_DATA_SECRET });
      const row = rr && rr.data && rr.data[0];
      // Canonicalizar PCx→Px también acá: si el alias en el server devuelve "PC5", igual lo
      // dejamos como "P5" para no volver a stampear billeteras en la oficina fantasma.
      if(row && row.pc_codigo){ pcCodigoNuevo = String(row.pc_codigo).toUpperCase().replace(/^PC(\d+)$/, 'P$1'); oficinaIdNueva = row.oficina_id || pcCodigoNuevo; }
    }catch(_e){ console.warn('resolver puesto falló, uso normalizado:', _e); }
    window.oficinaId = oficinaIdNueva;
    try{ localStorage.setItem('nodo_oficina_id', oficinaIdNueva); }catch(_e){}
    if(!pcCodigoNuevo){
      toast('No pude derivar pc_codigo del puesto "'+text+'"', 'red');
      return;
    }

    // 3. Si NODO ya estaba logueado en OTRA oficina, mejor recargar
    if(_nodoListo && pcOperativa && pcOperativa !== pcCodigoNuevo){
      toast('Cambio de oficina detectado · Reiniciando NODO...', 'blue');
      localStorage.setItem('nodo_pc_operativa_lite', pcCodigoNuevo);
      setTimeout(function(){ location.reload(); }, 800);
      return;
    }

    // 4. Asegurar la oficina en Supabase (crear si es nueva)
    const oficina = await _asegurarOficina(pcCodigoNuevo, text, value);
    pcOperativa = pcCodigoNuevo;
    window.pcOperativa = pcCodigoNuevo;          // espejo para los overrides que leen window
    window.oficinaId   = oficinaIdNueva;

    // Aplicar el proxy de esta oficina (la config/clave se resuelve en el main, blindada).
    // Mostramos el resultado para diagnóstico (antes se ignoraba → no se sabía si aplicó).
    try{
      if(window.ctrlElectron && ctrlElectron.proxyApply){
        Promise.resolve(ctrlElectron.proxyApply(pcCodigoNuevo)).then(function(r){
          if(r && r.ok && r.enabled) toast("🌐 Proxy de oficina aplicado (Agentes saldrá por proxy)","green");
          else if(r && r.reason==="missing-secret") toast("⚠️ Esta PC no tiene la clave de la oficina → proxy NO aplicado. Agentes puede fallar.","red");
          else if(r && r.enabled===false) toast("🌐 Esta oficina no tiene proxy en el admi → salida directa.","blue");
        }).catch(function(){});
      }
    }catch(_e){}

    // El historial pudo haberse cargado antes de resolver el puesto (pcOperativa vacío) →
    // recargarlo ahora que la oficina está resuelta, así aparecen las operaciones manuales.
    try{ if(typeof cargarHistorial==="function") setTimeout(function(){ cargarHistorial(); }, 500); }catch(_e){}

    // Los titulares bloqueados los pudo haber marcado OTRA PC: hasta ahora cada máquina sólo
    // conocía los suyos. Se traen de la base ahora que la oficina está resuelta.
    try{ if(typeof sincronizarTitularesBloqueados==="function") setTimeout(function(){ sincronizarTitularesBloqueados(); }, 800); }catch(_e){}

    // 5. Si NODO todavía no se finalizó (primer login), hacerlo ahora
    if(!_nodoListo){
      finalizarLogin(true);
    }

    // 6. Sincronizar billeteras
    //    - Oficina nueva → sync silencioso pero completo (sube todas las que falten)
    //    - Oficina existente → sync silencioso normal (avisa si hay nuevas en Chunior)
    if(oficina.esNueva){
      toast('🏢 Oficina nueva detectada: '+text+' · Sincronizando billeteras...', 'blue');
      setTimeout(function(){
        sincronizarBilleterasChunior(false).catch(function(e){
          console.warn('sync inicial oficina nueva:', e);
        });
      }, 2500);
    } else {
      setTimeout(function(){
        sincronizarBilleterasChunior(true).catch(function(){});
      }, 2500);
    }
  } catch(e){
    toast('Error al seleccionar puesto: '+(e.message||''), 'red');
  }
}

// ── Sincronización de billeteras con Chunior ──────────────────────────────────
// Lee /transacciones/movimientoficha/add/ y extrae:
//   • opciones del select id_cuenta_destino (uid + nombre)
//   • saldos reales del breadcrumb (.billetera spans)
// Resultado: actualiza saldos en NODO y agrega billeteras nuevas si las encuentra.
async function sincronizarBilleterasChunior(silencioso){
  if(!window.chunior){ if(!silencioso) toast('Ventana de Chunior no disponible.','red'); return; }
  if(!pcOperativa){
    if(!silencioso) toast('Sincronización pospuesta: NODO todavía no terminó de loguear.','red');
    return;
  }

  if(!silencioso) toast('Sincronizando billeteras con Chunior...','blue');

  const addUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/add/';
  const cur = await window.chunior.getUrl();
  if(!cur.includes('/movimientoficha/add')){
    await window.chunior.navigate(addUrl);
    await new Promise(function(r){setTimeout(r,700);});
  }

  let data = null;
  try {
    data = await window.chunior.exec(
      '(function(){' +
      'var sel=document.getElementById("id_cuenta_destino");' +
      'if(!sel)return null;' +
      'var opts=Array.from(sel.options).filter(function(o){return o.value;}).map(function(o){' +
      '  var t=(o.textContent||o.text||"").trim();' +
      '  var m=t.match(/^(\\d+)\\s*-\\s*(.+)$/);' +
      '  return {uid:String(o.value), nombre:(m?m[2].trim():t)};' +
      '});' +
      'var balances={};var orden=[];' +
      'document.querySelectorAll(".breadcrumbs .billetera").forEach(function(sp){' +
      '  var uid=String(sp.id||"");' +
      '  var txt=(sp.textContent||"").trim();' +
      // El signo puede venir ANTES o DESPUÉS del $ ("-$1.500" / "$-1.500"), o entre paréntesis.
      // El regex viejo era ([\d.,]+): se comía el menos y una billetera en rojo se mostraba en verde.
      '  var mm=txt.match(/^(.+?):\\s*(\\()?\\s*(-)?\\s*\\$?\\s*(-)?\\s*([\\d.,]+)/);' +
      '  if(mm){' +
      '    var neg=!!(mm[2]||mm[3]||mm[4]);' +
      '    balances[uid]={nombre:mm[1].trim(), saldo:(neg?-1:1)*parseFloat(mm[5].replace(/\\./g,"").replace(",","."))};' +
      '    orden.push(uid);' +
      '  }' +
      '});' +
      'var body=(document.body&&document.body.innerText)||"";' +
      // orden = el mismo que ve el operador en Chunior. Un objeto no sirve: las claves numéricas
      // ("905","921") se reordenan solas de menor a mayor y perdíamos el orden real.
      'return {opts:opts, balances:balances, orden:orden, body:body.slice(0,500)};' +
      '})()'
    );
  } catch(e){
    if(!silencioso) toast('Error leyendo Chunior: '+(e.message||''), 'red');
    return;
  }

  if(!data || !data.opts || !data.opts.length){
    if(!silencioso) toast('No se pudieron leer billeteras de Chunior. ¿Estás en la página correcta?', 'red');
    return;
  }

  const walletsChunior = data.opts.map(function(o){
    const b = data.balances[String(o.uid)] || {};
    return {
      chunior_uid: String(o.uid),
      uid: String(o.uid),
      nombre_visible: (b.nombre || o.nombre || 'Billetera Chunior'),
      nombre: (b.nombre || o.nombre || 'Billetera Chunior'),
      saldo: Number(b.saldo || 0),
      estado: 'ACTIVA',
      activa: true
    };
  });

  const uidsDetectados = walletsChunior.map(function(w){ return String(w.chunior_uid || w.uid || ''); }).filter(Boolean);
  const saldoMap = {};
  const nombreMap = {};
  walletsChunior.forEach(function(w){
    const uidKey = String(w.chunior_uid||w.uid);
    saldoMap[uidKey] = Number(w.saldo||0);
    nombreMap[uidKey] = String(w.nombre || w.nombre_visible || ('Chunior '+uidKey)).trim();
  });
  window.__nodoChuniorWalletUids = uidsDetectados;
  window.__nodoChuniorWalletSaldoByUid = saldoMap;
  if(Array.isArray(data.orden) && data.orden.length) window.__nodoChuniorOrdenUids = data.orden.map(String);
  window.__nodoChuniorWalletNombreByUid = nombreMap;
  window.__nodoOficinaDetectada = (window.oficinaId || '');
  window.__nodoPuestoDetectado  = (window.pcOperativa || pcOperativa || '');
  try{ localStorage.setItem('nodo_chunior_wallet_uids', JSON.stringify(uidsDetectados)); }catch(_e){}
  try{ localStorage.setItem('nodo_chunior_wallet_nombres', JSON.stringify(nombreMap)); }catch(_e){}
  try{ localStorage.setItem('nodo_oficina_id', (window.oficinaId || '')); }catch(_e){}
  try{ localStorage.setItem('nodo_puesto_chunior', (window.pcOperativa || pcOperativa || '')); }catch(_e){}

  // Persistir en Supabase via RPC (panel_nodo_sync_chunior_wallets hace upsert correcto con RLS).
  // Fallback: si la RPC falla, intentamos update directo por uid para no perder los saldos.
  try{
    const { error: rpcErr } = await supabaseClient.rpc('panel_nodo_sync_chunior_wallets', {
      p_pc_codigo: (pcOperativa || window.pcOperativa || ''),
      p_wallets: walletsChunior
    });
    if(rpcErr) throw rpcErr;
  }catch(e){
    console.warn('panel_nodo_sync_chunior_wallets falló, usando fallback directo:', e);
    try{
      for(const w of walletsChunior){
        const uid = String(w.chunior_uid || w.uid || '').trim();
        if(!uid) continue;
        await supabaseClient
          .from('billeteras')
          .update({ saldo: Number(w.saldo || 0), updated_at: new Date().toISOString() })
          .eq('chunior_uid', uid)
          .neq('estado','FUSIONADA');
      }
    }catch(e2){ console.warn('fallback sync saldo también falló:', e2); }
  }

  await cargarBilleteras(false);

  // Crear en Supabase las billeteras de Chunior que todavía no existen (por UID).
  // Sin esto, una oficina nueva solo mostraría las billeteras ya cargadas.
  try{
    const _existUids = new Set((billeteras||[]).map(function(b){ return String(b.CHUNIOR_UID||''); }).filter(Boolean));
    const _nuevas = walletsChunior.filter(function(w){
      const uid = String(w.chunior_uid||w.uid||'').trim();
      return uid && !_existUids.has(uid);
    });
    if(_nuevas.length){
      await _crearBilleterasNuevasChunior(_nuevas);
      await cargarBilleteras(false);
    }
  }catch(e){ console.warn('crear billeteras nuevas de Chunior falló:', e); }

  renderInicio();
  try{ renderBilleteras(); }catch(_e){}

  if(!silencioso){
    toast('Sincronización OK · billeteras detectadas: '+uidsDetectados.length, 'green');
  }
}

// ── Sync de saldos POST-ANOTACIÓN (debounced) ────────────────────────────────
// Chunior es la VERDAD ABSOLUTA del saldo (el contador interno está muerto). Tras CADA anotación
// (carga/retiro/propina/depo s/r) refrescamos los saldos reales para que NODO dibuje la verdad.
// Es casi gratis: la ventana de Chunior ya queda en /movimientoficha/add/ tras anotar, que es la
// misma página de donde sincronizarBilleterasChunior lee los breadcrumbs (sin navegación extra).
// Debounce 2.5s (una ráfaga de anotaciones = un solo sync) y si hay una operación en curso se
// reprograma (no navegar Chunior en el medio de otra anotación).
let _syncBilTimer = null;
// ── Lectura PASIVA de los saldos de Chunior ───────────────────────────────────────────────
// NO navega, NO recarga, NO pega a ninguna API: sólo lee el breadcrumb de la ventana de Chunior
// tal como está. Cuando el operador anota algo a MANO en Chunior, esa página se recarga sola y
// el panel se entera en la vuelta siguiente. Antes los saldos sólo se movían tras anotaciones
// hechas desde el panel, así que un movimiento manual dejaba el Inicio mintiendo hasta el
// próximo sync completo.
let _bilPasivoFirma = '';
async function _leerSaldosChuniorPasivo(){
  if(!window.chunior || !window.chunior.exec) return;
  if(!_nodoListo) return;
  if(window._cotejoDeclarando) return;                                              // declaración ciega en curso
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return;        // no pisar una operación
  if(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes>0)) return;
  let filas=null;
  try{
    filas = await window.chunior.exec(
      '(function(){var o=[];document.querySelectorAll(".breadcrumbs .billetera").forEach(function(sp){'
      + 'var t=(sp.textContent||"").trim();'
      + 'var m=t.match(/^(.+?):\\s*(\\()?\\s*(-)?\\s*\\$?\\s*(-)?\\s*([\\d.,]+)/);'
      + 'if(m)o.push({uid:String(sp.id||""),nombre:m[1].trim(),'
      + '  saldo:((m[2]||m[3]||m[4])?-1:1)*parseFloat(m[5].replace(/\\./g,"").replace(",","."))});'
      + '});return o;})()'
    );
  }catch(_e){ return; }                       // Chunior en otra página o sin breadcrumb: no pasa nada
  if(!Array.isArray(filas) || !filas.length) return;
  const firma = filas.map(function(f){ return f.uid+':'+f.saldo; }).join('|');
  if(firma === _bilPasivoFirma) return;       // nada cambió → no repintamos al pedo
  _bilPasivoFirma = firma;
  const mapa = window.__nodoChuniorWalletSaldoByUid || (window.__nodoChuniorWalletSaldoByUid = {});
  filas.forEach(function(f){ mapa[String(f.uid)] = Number(f.saldo); });
  window.__nodoChuniorOrdenUids = filas.map(function(f){ return String(f.uid); });
  try{ renderBillerasInicio(); }catch(_e){}
}
try{ setInterval(function(){ _leerSaldosChuniorPasivo().catch(function(){}); }, 12000); }catch(_e){}

window._syncBilleterasTrasAnotacion = function(){
  try{ clearTimeout(_syncBilTimer); }catch(_e){}
  _syncBilTimer = setTimeout(function tick(){
    try{
      if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0){ _syncBilTimer = setTimeout(tick, 3000); return; }
      sincronizarBilleterasChunior(true).catch(function(){});
    }catch(_e){}
  }, 2500);
};

// ══════════════════════════════════════════════════════════════════════════
// COTEJO Y AJUSTE ASISTIDO · F1 (núcleo sin UI) — doc de referencia del equipo
// Regla contable única: diferencia = saldo_real_banco − saldo_chunior.
//   >0 sobra → DEPO S/RECLAMAR · <0 falta → ERROR/FALTANTE. Sin tercer contador.
// ══════════════════════════════════════════════════════════════════════════
// Turnos AR fijos: 22-06 / 06-14 / 14-22. El id se ancla al día en que ARRANCA el
// turno (a las 03:00 del viernes seguís en el turno del JUEVES 22-06).
function _cotejoTurnoId(ts){ return NodoDomain.conciliacion.turnoId(ts); }
function _cotejoInicioTurnoMs(ts){ return NodoDomain.conciliacion.inicioTurnoMs(ts); }
// SNAPSHOT: los dos números en el mismo instante lógico. No arranca con operaciones en
// vuelo, sincroniza la verdad desde Chunior y devuelve los saldos congelados + turno.
// Scraper genérico de listas admin de Chunior (#result_list): id, fecha, monto, cuenta, texto.
async function _cotejoScrapeLista(url){
  try{
    await window.chunior.navigate(url);
    const t0=Date.now(); let listo=false;
    while(Date.now()-t0<9000){ listo=await window.chunior.exec('(function(){return !!(document.getElementById("result_list")||document.querySelector(".paginator,#changelist"));})()').catch(function(){return false;}); if(listo)break; await new Promise(function(r){setTimeout(r,300);}); }
    if(!listo) return [];
    // Lee TODAS las celdas con su clase y su texto, y después elige por clase O por patrón de texto
    // (mismo criterio que verDepositosSinReclamar, que sí funciona). Antes se exigía la clase
    // `field-creation` exacta: si esa página la nombraba distinto, la fecha salía null y el filtro
    // por turno descartaba TODAS las filas → el cotejo leía 0 depos y 0 errores.
    const filas = await window.chunior.exec(
      '(function(){var out=[];var trs=document.querySelectorAll("#result_list tbody tr");'+
      'for(var i=0;i<trs.length&&i<80;i++){var tr=trs[i];'+
      ' var a=tr.querySelector("th a[href],td a[href]");var id=null;if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/);if(mh)id=mh[1];}'+
      ' var tds=tr.querySelectorAll("th,td");var cells=[];'+
      ' for(var j=0;j<tds.length;j++){cells.push({c:(tds[j].className||""),t:(tds[j].textContent||"").replace(/\\s+/g," ").trim()});}'+
      ' function pick(clsRe,txtRe){var x=cells.filter(function(y){return clsRe.test(y.c)&&y.t;})[0];'+
      '   if(x)return x.t; if(txtRe){x=cells.filter(function(y){return txtRe.test(y.t);})[0]; if(x)return x.t;} return "";}'+
      ' out.push({id:id,'+
      '   creacion:pick(/creation|fecha|creado|date/i,/\\d{2}[-\\/]\\d{2}[-\\/]\\d{4}/),'+
      '   monto:pick(/monto|money|importe/i,/\\$/),'+
      '   cuenta:pick(/cuenta|destino|billetera|wallet/i,null),'+
      '   texto:(tr.textContent||"").replace(/\\s+/g," ").trim().substring(0,300)});'+
      '}return out;})()'
    ).catch(function(){return [];});
    return Array.isArray(filas)?filas:[];
  }catch(_e){ return []; }
}
window.cotejoSnapshot = async function(){
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0) return { ok:false, error:'operacion-en-curso' };
  try{ await sincronizarBilleterasChunior(true); }catch(_e){ return { ok:false, error:'sync-fallo' }; }
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy > 0) return { ok:false, error:'operacion-en-curso' }; // arrancó algo durante el sync
  const ts = Date.now();
  const iniMs = _cotejoInicioTurnoMs(ts);
  // Billetera ERROR: billetera REAL de Chunior donde se DECLARAN las faltas ("enviar a error" =
  // transferencia contable hacia ella). No tiene banco → NO se declara en la ciega.
  const bilError=(billeteras||[]).find(function(b){ return b.CHUNIOR_UID && /error/i.test(String(b.NOMBRE_VISIBLE||'')); })||null;
  const saldos = (billeteras||[]).filter(function(b){
    return b.CHUNIOR_UID && (!bilError || String(b.ID_BILLETERA)!==String(bilError.ID_BILLETERA));
  }).map(function(b){
    return { wallet_id:String(b.ID_BILLETERA), nombre:String(b.NOMBRE_VISIBLE||''), chunior_uid:String(b.CHUNIOR_UID), saldo_chunior:Number(b.SALDO||0) };
  });
  // Fuentes REALES de Chunior para las guías del cotejo (no solo el historial del panel):
  // depos s/reclamar del TURNO + transferencias a la billetera ERROR del TURNO. Best-effort:
  // si el scraping falla, el cotejo sigue sin guías (no se rompe).
  // Filtra al turno vigente, PERO si ninguna fila trajo fecha parseable no descarta todo en
  // silencio (eso dejaba el cotejo sin guías y parecía que "no revisa nada"): en ese caso las deja
  // pasar y avisa por consola, para que el operador vea las coincidencias igual.
  const _filtrarTurno = function(arr, etiqueta){
    const conFecha = arr.filter(function(x){ return x.ts !== null; });
    if(!arr.length) return [];
    if(!conFecha.length){
      console.warn('[cotejo] '+etiqueta+': '+arr.length+' fila(s) SIN fecha parseable → no se filtra por turno (revisá el formato de la lista en Chunior)');
      return arr.filter(function(x){ return x.monto>0; });
    }
    return conFecha.filter(function(x){ return x.monto>0 && x.ts>=iniMs; });
  };
  let depos=[], errores=[];
  try{
    depos = _filtrarTurno((await _cotejoScrapeLista(CHUNIOR_BASE+'/transacciones/depositossinreclamar/')).map(function(f){
      const t=_chuParsearFechaCreacion(f.creacion);
      return { id:f.id, ts:t, monto:Math.round(_adminChuParseMonto(f.monto||f.texto)||0), cuenta:f.cuenta||'', texto:f.texto };
    }), 'depos s/reclamar');
  }catch(_e){}
  try{
    if(bilError){
      const nomErr=String(bilError.NOMBRE_VISIBLE||'').toLowerCase();
      errores = _filtrarTurno((await _cotejoScrapeLista(CHUNIOR_BASE+'/transacciones/movimientointerno/')).map(function(f){
        const t=_chuParsearFechaCreacion(f.creacion);
        return { id:f.id, ts:t, monto:Math.round(_adminChuParseMonto(f.monto||f.texto)||0), texto:f.texto };
      }), 'movimientos a ERROR').filter(function(m){ return m.texto.toLowerCase().indexOf(nomErr)>=0; });
    }
  }catch(_e){}
  return { ok:true, snapshot_id:'snap_'+ts+'_'+Math.random().toString(36).slice(2,7), turno_id:_cotejoTurnoId(ts), inicio_turno_ms:iniMs, ts:ts, saldos:saldos,
           extra:{ depos:depos, errores:errores, errorWallet: bilError?{ wallet_id:String(bilError.ID_BILLETERA), uid:String(bilError.CHUNIOR_UID), nombre:String(bilError.NOMBRE_VISIBLE||'ERROR'), saldo:Number(bilError.SALDO||0) }:null } };
};
// MOTOR DE COINCIDENCIAS (función PURA, testeable):
//   casos: [{case_id, wallet_id, tipo:'FALTANTE'|'SOBRANTE', monto_disponible}]
//   movs:  [{id, tipo:'RETIRO'|'DEPOSITO_SR'|..., billetera_id, monto, usuario, esTransferenciaInterna, ts}]
// Reglas: candidatos = SOLO retiros del turno (decisión de equipo); transferencias internas
// EXCLUIDAS (ya resuelven su propia diferencia); depo s/r CON usuario pegado NO se ofrece.
// Exacto 1:1 = un clic (mover retiro). Combinaciones: se sugieren, NUNCA se auto-eligen.
// Ambiguo (2+ candidatos): se muestran todos y decide el operador.
function _cotejoMatch(casos, movs){ return NodoDomain.conciliacion.match(casos, movs); }
window._cotejoMatch = _cotejoMatch; window._cotejoTurnoId = _cotejoTurnoId;

// ── COTEJO · F2: persistencia (Supabase con fallback local) + UI ─────────────
// Los casos van a Supabase (SQL_cotejo_casos.sql: cases/allocations/log inmutable). Si el SQL
// todavía no está aplicado, la UI funciona igual con localStorage por turno (flag _local:true)
// y avisa en consola — no se bloquea el cotejo por infraestructura.
// Formateador de miles GLOBAL. OJO: _rv2FmtMiles vive dentro del IIFE del bridge V15.4 (no es
// global) → usarlo desde este script o desde un oninline handler tira ReferenceError y el campo
// "no deja escribir". Este helper es global y self-contained.
window._cotejoFmtMiles = function(n){ return NodoDomain.formatos.cotejoFmtMiles(n); };
window._fmtMilesConSigno = function(v){ return NodoDomain.formatos.fmtMilesConSigno(v); };
window._parseMontoConSigno = function(v){ return NodoDomain.formatos.parseMontoConSigno(v); };
function _cotejoLsKey(turno){ return 'nodo_cotejo_'+turno; }
function _cotejoLsLoad(turno){ try{ return JSON.parse(localStorage.getItem(_cotejoLsKey(turno))||'{"casos":[],"seq":0}'); }catch(_e){ return {casos:[],seq:0}; } }
function _cotejoLsSave(turno, st){ try{ localStorage.setItem(_cotejoLsKey(turno), JSON.stringify(st)); }catch(_e){} }
function _cotejoOp(){ return (window.operador&&(window.operador.usuario||window.operador.nombre))||'panel'; }
async function _cotejoRpc(fn, params){
  try{
    const r = await supabaseClient.rpc(fn, Object.assign({p_secret:window.PANEL_DATA_SECRET}, params||{}));
    if(r.error) throw r.error;
    let d=r.data; try{ if(typeof d==='string') d=JSON.parse(d); }catch(_e){}
    return d;
  }catch(e){ console.warn('[cotejo] RPC '+fn+' falló (¿SQL_cotejo_casos.sql aplicado?):', e&&e.message); return null; }
}
// Editar el MONTO de un movimiento admin de Chunior (reduce un depo s/reclamar al asignar una parte
// — opción A confirmada) + agrega la nota del caso. Misma mecánica que _anularMovimientoChunior.
window._reducirDepoChunior = async function(movId, nuevoMonto, notaExtra){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const url = CHUNIOR_BASE + '/transacciones/depositossinreclamar/' + encodeURIComponent(movId) + '/change/';
  try{ await window.chunior.navigate(url); }catch(e){ return { ok:false, error:'No se pudo navegar' }; }
  const t0=Date.now(); let ready=false;
  while(Date.now()-t0<10000){ ready = await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;}); if(ready) break; await new Promise(function(r){setTimeout(r,300);}); }
  if(!ready) return { ok:false, error:'Formulario no apareció' };
  const inj = await window.chunior.exec(
    '(function(){var m=document.getElementById("id_monto");'+
    'var n=document.getElementById("id_notas")||document.getElementById("id_nota")||document.querySelector("textarea");'+
    'var b=document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");'+
    'if(!m||!b)return {ok:false};'+
    'm.value='+JSON.stringify(String(nuevoMonto))+'; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));'+
    'if(n){ n.value=(n.value?n.value+" · ":"")+'+JSON.stringify(String(notaExtra||''))+'; n.dispatchEvent(new Event("input",{bubbles:true})); }'+
    'b.click(); return {ok:true};})()'
  ).catch(function(){ return {ok:false}; });
  if(!inj||!inj.ok) return { ok:false, error:'Inyección falló' };
  await new Promise(function(r){setTimeout(r,2200);});
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  return { ok:true };
};
// Movimientos del turno (para el motor): desde _historialData.
function _cotejoMovsTurno(inicioMs){
  const estados=typeof _NEXO_OK_ESTADOS!=='undefined'?_NEXO_OK_ESTADOS:undefined;
  const historial=(typeof _historialData!=='undefined'&&_historialData)||[];
  return NodoDomain.conciliacion.movimientosTurno(historial, inicioMs, estados);
}
function _cotejoUiModal(){
  let el=document.getElementById('cotejoModal');
  if(el) return el;
  el=document.createElement('div'); el.id='cotejoModal';
  el.style.cssText='display:none;position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:99999;width:min(600px,calc(100vw - 24px))';
  document.body.appendChild(el); return el;
}
window.cerrarCotejo=function(){ const el=document.getElementById('cotejoModal'); if(el) el.style.display='none'; window._cotejoDeclarando=false; };
function _cotejoWrap(inner){
  return '<div style="max-height:84vh;overflow:auto;background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.55);padding:16px;color:#e6edf3">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">'
    +   '<div style="font-size:16px;font-weight:900;color:#7dd3fc">⚖️ Cotejo de billeteras <span class="small" style="color:#8b949e;font-weight:400">· '+escapeHtml(window._cotejoState&&window._cotejoState.turno_id||'')+'</span></div>'
    +   '<button class="mini-btn" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9" onclick="cerrarCotejo()">Cerrar</button>'
    + '</div>' + inner + '</div>';
}
window._cotejoState=null;
window.abrirCotejo=async function(){
  const el=_cotejoUiModal();
  el.innerHTML=_cotejoWrap('<div class="small" style="color:#8b949e;padding:18px;text-align:center">⏳ Congelando saldos (snapshot desde Chunior)...</div>');
  el.style.display='block';
  const snap=await window.cotejoSnapshot();
  if(!snap||!snap.ok){
    el.innerHTML=_cotejoWrap('<div class="alert-box">'+(snap&&snap.error==='operacion-en-curso'?'Hay una operación en curso — esperá a que termine y reintentá.':'No se pudieron leer los saldos de Chunior.')+'</div>');
    return;
  }
  const _lsIni=_cotejoLsLoad(snap.turno_id);
  window._cotejoState={ snap:snap, turno_id:snap.turno_id, casos:_lsIni.casos, resumen:_lsIni.resumen||null, match:null };
  if(window._cotejoState.casos.length){ _cotejoRenderCasos(); return; }  // ya hay casos del turno → directo a la pantalla
  _cotejoRenderDeclarar();
};
function _cotejoRenderDeclarar(){
  const st=window._cotejoState, el=_cotejoUiModal();
  window._cotejoDeclarando=true;   // congela anotaciones nuevas hasta confirmar/cerrar (esperan, no fallan)
  const filas=st.snap.saldos.map(function(s,i){
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:#12161d;border:1px solid #262d3a;margin-top:4px">'
      + '<div style="flex:1;font-weight:700;font-size:13px">'+escapeHtml(s.nombre||('#'+s.wallet_id))+'</div>'
      + '<input type="text" inputmode="numeric" id="cotejoDecl_'+i+'" placeholder="lo que VES en el banco" autocomplete="off" oninput="this.value=window._cotejoFmtMiles(this.value)" style="width:170px;text-align:right;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:5px 7px;font-weight:700;font-size:13px">'
      + '</div>';
  }).join('');
  el.innerHTML=_cotejoWrap(
    '<div class="small" style="background:rgba(125,211,252,.07);border:1px solid rgba(125,211,252,.3);border-radius:9px;padding:8px 11px;margin-bottom:8px;color:#c9d1d9">'
    + '🙈 <b>Declaración ciega</b>: ingresá el saldo que VES en cada billetera (banco/MP). No se muestra lo esperado — las diferencias aparecen recién al confirmar. Dejá vacía la que no quieras cotejar.</div>'
    + filas
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">'
    +   '<button class="mini-btn" style="background:transparent;border:1px solid #30363d;color:#c9d1d9" onclick="cerrarCotejo()">Cancelar</button>'
    +   '<button class="mini-btn blue" style="font-weight:800" onclick="_cotejoConfirmarDecl()">Confirmar declaración</button>'
    + '</div>');
  // El snapshot navega la ventana de CHUNIOR → se lleva el foco del teclado y el panel queda "sin
  // poder escribir" (bug conocido de Electron). Recuperamos el foco y enfocamos el primer campo.
  try{ if(window.ctrlElectron && window.ctrlElectron.refocus) window.ctrlElectron.refocus(); }catch(_e){}
  setTimeout(function(){ try{ window.focus(); const p=document.getElementById('cotejoDecl_0'); if(p) p.focus(); }catch(_e){} }, 120);
}
window._cotejoConfirmarDecl=async function(){
  const st=window._cotejoState; if(!st) return;
  window._cotejoDeclarando=false;   // liberar las anotaciones que quedaron esperando
  const nuevos=[]; const resumen=[];
  st.snap.saldos.forEach(function(s,i){
    const inp=document.getElementById('cotejoDecl_'+i); if(!inp||!String(inp.value).trim()) return;
    const fila=NodoDomain.conciliacion.declaracion(s, inp.value);
    const {decl, dif, resid}=fila;
    // Regla única: real − chunior. REDONDEADO a pesos: los centavos de Chunior (anotamos redondo,
    // las transferencias traen centavos) son residuo, NO caso — antes creaban "Falta $0".
    // Residuo de centavos (doc §9): la parte fraccional NO genera caso; se guarda por billetera
    // para que el supervisor la limpie cuando quiera.
    resumen.push(fila);  // TODAS (tabla estilo cage-report)
    if(resid){ try{ const rr=JSON.parse(localStorage.getItem('nodo_cotejo_residuos')||'{}'); rr[s.wallet_id]={nombre:s.nombre,resid:resid,ts:Date.now()}; localStorage.setItem('nodo_cotejo_residuos',JSON.stringify(rr)); }catch(_e){} }
    if(dif===0) return;
    nuevos.push({ wallet_id:s.wallet_id, wallet_nombre:s.nombre, tipo:(dif<0?'FALTANTE':'SOBRANTE'),
      monto:Math.abs(dif), snapshot_id:st.snap.snapshot_id, observaciones:'declarado '+decl+' · chunior '+s.saldo_chunior });
  });
  // Una nueva declaración REEMPLAZA la foto anterior: los casos aún ABIERTOS de las billeteras
  // re-declaradas se anulan (con log) — sin esto se duplicaban en cada declaración (L2 y L6 iguales).
  const _wids=new Set(resumen.map(function(r){ return String(r.wallet_id); }));
  for(const c of (st.casos||[])){
    if(!['RESUELTA','ANULADA','ESCALADA'].includes(c.estado) && _wids.has(String(c.wallet_id))){
      await _cotejoSetEstado(c.case_id,'ANULADA','reemplazado por nueva declaración');
    }
  }
  if(!nuevos.length){
    const lsOk=_cotejoLsLoad(st.turno_id); lsOk.resumen={ts:Date.now(), filas:resumen}; _cotejoLsSave(st.turno_id, lsOk);
    st.resumen=lsOk.resumen; toast('✓ Sin diferencias en lo declarado','green'); _cotejoRenderCasos(); return;
  }
  // Persistir: Supabase (batch, 1 llamado) con fallback local
  let ids=null;
  const r=await _cotejoRpc('panel_cotejo_crear_casos',{ p_pc_codigo:(pcOperativa||''), p_turno_id:st.turno_id, p_operador:_cotejoOp(), p_casos:nuevos });
  if(r&&r.ok&&r.case_ids) ids=r.case_ids;
  const ls=_cotejoLsLoad(st.turno_id);
  nuevos.forEach(function(c,i){
    ls.seq++; c.case_id = ids?ids[i]:('L'+ls.seq); c._local=!ids; c.estado='ABIERTA';
    c.monto_original=c.monto; c.monto_disponible=c.monto; c.created_at=new Date().toISOString(); c.operador=_cotejoOp();
    ls.casos.push(c);
  });
  ls.resumen={ts:Date.now(), filas:resumen};
  _cotejoLsSave(st.turno_id, ls); st.casos=ls.casos; st.resumen=ls.resumen;
  _cotejoRenderCasos();
};
// El badge mostraba el enum crudo de la base (SUGERENCIA_ENCONTRADA, APLICACION_PARCIAL, ESCALADA…).
// El operador no tiene por qué saber qué significan — "no sé qué es escalada" fue textual.
const _COTEJO_ESTADOS={
  ABIERTA:               {t:'Sin resolver',        c:'#f5c518'},
  SUGERENCIA_ENCONTRADA: {t:'Con pista',           c:'#7dd3fc'},
  PARCIAL_ASIGNADA:      {t:'Compensada en parte', c:'#c1b3ff'},
  AJUSTANDO:             {t:'Ajustando',           c:'#7dd3fc'},
  APLICACION_PARCIAL:    {t:'Aplicada a medias',   c:'#fb923c'},
  RESUELTA:              {t:'Resuelta',            c:'#22c55e'},
  ESCALADA:              {t:'Pasada al superior',  c:'#a78bfa'},
  ANULADA:               {t:'Anulada',             c:'#6b7688'}
};
function _cotejoEstadoBadge(e){
  const m=_COTEJO_ESTADOS[e]||{t:String(e||''),c:'#8b949e'};
  return '<span title="'+escapeHtml(String(e||''))+'" style="font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.06);color:'+m.c+'">'+escapeHtml(m.t)+'</span>';
}
// Tonos de las tiras de pista, por tipo de acción.
const _COTEJO_TONO={
  verde:  {bg:'#122015', bd:'rgba(34,197,94,.32)'},
  violeta:{bg:'#1b1430', bd:'rgba(167,139,250,.30)'},
  rojo:   {bg:'#2a1215', bd:'rgba(248,113,113,.35)'},
  neutro: {bg:'#151a22', bd:'#262d3a'}
};
function _cotejoRenderCasos(){
  const st=window._cotejoState, el=_cotejoUiModal();
  const abiertos=st.casos.filter(function(c){ return !['RESUELTA','ANULADA','ESCALADA'].includes(c.estado); });
  const movimientos=_cotejoMovsTurno(st.snap.inicio_turno_ms);
  const movimientosPorBilletera=NodoDomain.conciliacion.indexarMovimientos(movimientos);
  st.match=_cotejoMatch(abiertos.map(function(c){ return {case_id:c.case_id,wallet_id:c.wallet_id,tipo:c.tipo,monto_disponible:c.monto_disponible}; }), movimientos);
  const sugPorCaso={};
  (st.match.sugerencias||[]).forEach(function(s){ sugPorCaso[s.caso_faltante]=s; });
  (st.match.explicaciones||[]).forEach(function(s){ sugPorCaso[s.caso]=s; });
  const comboPorCaso={};
  (st.match.combinaciones||[]).forEach(function(k){ if(!comboPorCaso[k.caso]) comboPorCaso[k.caso]=k; });
  // Anti-ruido visual: SOLO los casos abiertos llevan tarjeta completa (guías + acciones).
  // Los finalizados (RESUELTA/ANULADA/ESCALADA) van compactos y colapsados abajo.
  const _FIN=['RESUELTA','ANULADA','ESCALADA'];
  const _activos=st.casos.filter(function(c){ return !_FIN.includes(c.estado); });
  const _cerrados=st.casos.filter(function(c){ return _FIN.includes(c.estado); });
  // Qué sobrantes ya están ofrecidos como solución de algún faltante (las sugerencias siempre
  // cuelgan del faltante, así que sin este mapa el sobrante queda "huérfano" en pantalla).
  const contraparte={};
  _activos.forEach(function(c){
    if(c.tipo!=='FALTANTE') return;
    const s=sugPorCaso[c.case_id], k=comboPorCaso[c.case_id];
    if(s && s.caso_sobrante){ contraparte[String(s.caso_sobrante)]=c.wallet_nombre||''; return; }
    if(k){ (k.partes||[]).forEach(function(p){ contraparte[String(p)]=c.wallet_nombre||''; }); return; }
    _activos.forEach(function(s2){                       // los que ofrece la compensación parcial
      if(s2.tipo==='SOBRANTE' && String(s2.wallet_id)!==String(c.wallet_id) && Number(s2.monto_disponible)>0)
        contraparte[String(s2.case_id)]=c.wallet_nombre||'';
    });
  });
  const filas=_activos.map(function(c){
    const col=c.tipo==='FALTANTE'?'#f87171':'#f5c518';
    const cid=escapeHtml(String(c.case_id));
    const _m=Math.round(Number(c.monto_disponible));
    const _ex=(st.snap&&st.snap.extra)||{};
    // ── Las pistas son OPCIONES con peso, no tiras apiladas ────────────────────────────────
    // Antes se dibujaban hasta 8 tiras del mismo tamaño, todas con botón verde, y el operador no
    // tenía cómo saber cuál era LA correcta. Ahora se ordenan por qué tan segura es la explicación
    // y solo la mejor queda a la vista; el resto se despliega si la primera no convence.
    const ops=[];
    const op=function(peso, tono, texto, boton, rot){ ops.push({peso:peso, tono:tono, texto:texto, boton:boton||'', rot:rot||''}); };

    const sug=sugPorCaso[c.case_id];
    if(sug){
      if(sug.tipo==='MOVER_RETIRO' && sug.candidatos.length){
        // Un retiro concreto que explica el descuadre: la explicación más fuerte que hay.
        const exacta=sug.confianza==='EXACTA';
        const lista=sug.candidatos.map(function(cd){
          return '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">'
            + '<span style="flex:1">⬇ Retiro de <b>'+escapeHtml(cd.usuario)+'</b> · '+money(cd.monto)+' anotado en '+escapeHtml(cd.billetera_nombre||'')+(cd.chunior_movimiento_id?' · N° '+escapeHtml(String(cd.chunior_movimiento_id)):'')+'</span>'
            + '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoAplicarMoverRetiro(\''+cid+'\',\''+escapeHtml(String(sug.caso_sobrante))+'\',\''+escapeHtml(String(cd.id))+'\')">Mover acá</button></div>';
        }).join('');
        op(exacta?10:40, 'verde',
          (exacta ? 'Este retiro quedó anotado en la billetera equivocada.'
                  : 'Hay '+sug.candidatos.length+' retiros que podrían explicarlo — elegí cuál.') + lista);
      } else if(sug.tipo==='MOVER_RETIRO' && !sug.candidatos.length){
        // Par 1:1 detectado pero SIN retiro que lo explique → autoajuste genérico: transferencia
        // CONTABLE en Chunior (movimientointerno) de la billetera faltante → sobrante. No mueve
        // plata real: alinea lo anotado con lo que hay (falta en A = chunior alto; sobra en B = bajo).
        const sc=_cotejoCaso(sug.caso_sobrante)||{};
        op(50, 'verde', 'Sobra exactamente lo mismo en <b>'+escapeHtml(sc.wallet_nombre||'')+'</b>, sin ningún retiro que lo explique.',
          '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoCompensar(\''+cid+'\',\''+escapeHtml(String(sug.caso_sobrante))+'\')">⇄ Compensar (transferencia en Chunior)</button>');
      } else if(sug.tipo==='DEPO_EXISTENTE'){
        op(35, 'violeta', 'Concuerda con un depo s/reclamar SIN usuario que <b>ya está anotado</b> — revisalo antes de crear otro.');
      }
    }
    // GUÍAS desde las fuentes REALES de Chunior (leídas en el snapshot): depos s/reclamar del
    // turno y envíos a la billetera ERROR del turno.
    (_ex.depos||[]).filter(function(d){ return d.monto===_m; }).slice(0,2).forEach(function(d){
      op(30, 'violeta',
        'Hay un depo s/reclamar de <b>'+money(d.monto)+'</b> de este turno'+(d.id?' (N° '+escapeHtml(d.id)+')':'')+(d.cuenta?' en '+escapeHtml(d.cuenta):'')
        + (c.tipo==='FALTANTE'?' por el mismo monto — ¿es esa carga?':' por el mismo monto.'),
        d.id?('<button class="mini-btn green" style="font-size:11px" onclick="reclamarDepo(\''+escapeHtml(d.id)+'\',\''+escapeHtml(String(d.monto))+'\',\''+escapeHtml(d.cuenta||'')+'\')">✅ Reclamarlo</button>'):'');
    });
    (_ex.errores||[]).filter(function(e){ return e.monto===_m; }).slice(0,2).forEach(function(e){
      if(c.tipo==='FALTANTE'){
        op(20, 'rojo', 'Mandaste <b>'+money(e.monto)+'</b> a ERROR este turno'+(e.id?' (N° '+escapeHtml(e.id)+')':'')+'. Si esta falta ES ese error, <b>no la reclames</b>: ya está declarada.',
          '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoCerrarPorError(\''+cid+'\',\''+escapeHtml(String(e.id||''))+'\')">Cerrar: error ya declarado</button>');
      } else {
        op(20, 'verde', 'Mandaste <b>'+money(e.monto)+'</b> a ERROR este turno'+(e.id?' (N° '+escapeHtml(e.id)+')':'')+' y ahora sobra acá — la plata reapareció.',
          '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoRecuperarDeError(\''+cid+'\',\''+escapeHtml(String(e.id||''))+'\')">⇄ Recuperar de ERROR</button>');
      }
    });
    // SOBRANTE sin movimiento a ERROR que matchee EXACTO (ej: mandaste 40k juntos y sobran 20k,
    // o el scraping no leyó la lista): si la billetera ERROR tiene saldo suficiente, ofrecemos
    // recuperar IGUAL por el monto del caso — no depende del matching fino.
    const _errW=_ex.errorWallet;
    if(_errW && Number(_errW.saldo||0)>=_m && !(_ex.errores||[]).some(function(e){ return e.monto===_m; })){
      if(c.tipo==='SOBRANTE'){
        op(80, 'verde', '<b>'+escapeHtml(_errW.nombre)+'</b> tiene '+money(_errW.saldo)+' declarados. Si esto es plata que reapareció de un error, recuperá '+money(_m)+' de ahí.',
          '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoRecuperarDeError(\''+cid+'\',\'\')">⇄ Recuperar de ERROR</button>');
      } else {
        op(80, 'rojo', '<b>'+escapeHtml(_errW.nombre)+'</b> ya tiene '+money(_errW.saldo)+' declarados. Si esta falta ya está incluida ahí, cerrala; si es nueva, usá "Enviar a ERROR".',
          '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoCerrarPorError(\''+cid+'\',\'\')">Cerrar: ya declarado</button>');
      }
    }
    // COMPENSACIÓN PARCIAL (montos DISTINTOS): falta 70.800 acá y sobran 90.800 allá → se
    // transfiere el MÍNIMO común y el resto queda como caso vivo (PARCIAL_ASIGNADA). Es el caso
    // que el 1:1 exacto no cubría. Se sugiere, el operador confirma.
    if(c.tipo==='FALTANTE' && !sug && !comboPorCaso[c.case_id]){
      _activos.filter(function(s2){ return s2.tipo==='SOBRANTE' && String(s2.wallet_id)!==String(c.wallet_id) && Number(s2.monto_disponible)>0; })
        .slice(0,3).forEach(function(s2){
          const mm=Math.min(Number(c.monto_disponible), Number(s2.monto_disponible));
          if(!(mm>0)) return;
          const restoF=Number(c.monto_disponible)-mm, restoS=Number(s2.monto_disponible)-mm;
          op(70, 'neutro',
            'Sobran <b>'+money(s2.monto_disponible)+'</b> en <b>'+escapeHtml(s2.wallet_nombre||'')+'</b> — se puede compensar '+money(mm)+'.'
            + (restoS>0?(' Quedarían '+money(restoS)+' sobrando allá.'):'')
            + (restoF>0?(' Quedarían '+money(restoF)+' faltando acá.'):''),
            '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoCompensarParcial(\''+cid+'\',\''+escapeHtml(String(s2.case_id))+'\')">⇄ Compensar '+money(mm)+'</button>');
        });
    }
    // COMBINACIÓN (10+5=15): el motor la sugiere pero NUNCA la auto-elige — el operador confirma.
    const combo=(!sug)?comboPorCaso[c.case_id]:null;
    if(combo){
      const partesTxt=combo.partes.map(function(pid){ const p=_cotejoCaso(pid)||{}; return escapeHtml(p.wallet_nombre||'')+' ('+money(p.monto_disponible||0)+')'; }).join(' + ');
      op(60, 'neutro', 'Se cubre juntando varias: '+partesTxt+'.',
        '<button class="mini-btn green" style="font-size:11px" onclick="_cotejoCompensarCombo(\''+cid+'\',\''+combo.partes.map(String).join(',')+'\')">⇄ Compensar combinación</button>');
    }

    // La tarjeta del SOBRANTE decía "sin pistas" aunque el faltante de al lado ya ofreciera
    // compensarlo con él: las sugerencias cuelgan siempre del faltante. Lo decimos explícito para
    // que el operador no lo lea como "acá no hay nada que hacer".
    if(c.tipo==='SOBRANTE' && !ops.length && contraparte[String(c.case_id)]){
      op(90, 'neutro', 'Es la contraparte de lo que falta en <b>'+escapeHtml(contraparte[String(c.case_id)])+'</b> — se resuelve desde esa tarjeta.', '', 'Dónde se resuelve');
    }

    // ── Render: la mejor pista arriba, el resto plegado ────────────────────────────────────
    ops.sort(function(a,b){ return a.peso-b.peso; });
    const tira=function(o, destacada){
      const t=_COTEJO_TONO[o.tono]||_COTEJO_TONO.neutro;
      return '<div class="small" style="margin-top:'+(destacada?'6':'4')+'px;border:1px solid '+t.bd+';background:'+t.bg+';border-radius:8px;padding:'+(destacada?'7px 9px':'6px 9px')+';color:#c9d1d9;line-height:1.35">'
        + (destacada?'<div style="font-size:9px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#8b949e;margin-bottom:3px">'+(o.rot||'Lo más probable')+'</div>':'')
        + o.texto + (o.boton?('<div style="margin-top:5px">'+o.boton+'</div>'):'')
        + '</div>';
    };
    let pistas='';
    if(!ops.length){
      pistas='<div class="small" style="margin-top:6px;color:#6b7688">Sin pistas automáticas — mirá los movimientos del turno para ubicar el descuadre.</div>';
    } else {
      pistas=tira(ops[0], true);
      if(ops.length>1){
        pistas+='<div class="small" style="margin-top:4px"><a href="javascript:void 0" style="color:#8b949e" onclick="var d=document.getElementById(\'cotejoOps_'+cid+'\');if(d)d.style.display=d.style.display===\'none\'?\'block\':\'none\'">▸ otras '+(ops.length-1)+' posibilidad'+(ops.length>2?'es':'')+'</a></div>'
          + '<div id="cotejoOps_'+cid+'" style="display:none">'+ops.slice(1).map(function(o){ return tira(o,false); }).join('')+'</div>';
      }
    }

    // Acciones manuales: son la salida cuando ninguna pista sirve, así que van al final y en chico.
    let acciones='<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">';
    const _usrPre=(window.__nodoChatCurrentTicket&&window.__nodoChatCurrentTicket.usuario)||'';   // consulta del portal abierta
    if(c.tipo==='SOBRANTE') acciones+='<input type="text" id="cotejoDepoUsr_'+cid+'" value="'+escapeHtml(_usrPre)+'" placeholder="usuario (opcional)" style="width:125px;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:6px;padding:4px 7px;font-size:11px;margin:0">'
      + '<button class="mini-btn purple" style="font-size:11px" onclick="_cotejoCrearDepo(\''+cid+'\')">＋ Anotar depo s/reclamar</button>';
    if(c.tipo==='FALTANTE' && _ex.errorWallet)
      acciones+='<button class="mini-btn red" style="font-size:11px" onclick="_cotejoEnviarAError(\''+cid+'\')" title="Declara la falta: transferencia contable de esta billetera a la billetera ERROR de Chunior (como lo hacés a mano)">🚫 Enviar a ERROR</button>';
    acciones+='<span style="margin-left:auto;display:flex;gap:6px">'
      + '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoIgnorar(\''+cid+'\')">Ignorar</button>'
      + '<button class="mini-btn" style="font-size:11px;background:#3b2a63;color:#d6c9ff" onclick="_cotejoEscalarCaso(\''+cid+'\')" title="Queda marcado para que lo revise el superior del turno siguiente">⏫ Pasar al superior</button>'
      + '</span></div>';

    return '<div style="border:1px solid #262d3a;border-left:3px solid '+col+';border-radius:9px;padding:9px 11px;margin-top:7px;background:#10141b">'
      + '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">'
      +   '<b style="color:'+col+';font-size:14px">'+(c.tipo==='FALTANTE'?'▼ Falta':'▲ Sobra')+' '+money(c.monto_disponible)+'</b>'
      +   '<span class="small" style="color:#8b949e">en <b style="color:#c9d1d9">'+escapeHtml(c.wallet_nombre||c.wallet_id)+'</b></span>'
      +   (c.estado!=='ABIERTA'?_cotejoEstadoBadge(c.estado):'')
      +   '<span class="small" style="margin-left:auto;color:#4d5766;font-size:10px">#'+cid+(c._local?' <span title="Aún no está el SQL en Supabase — caso local">📌</span>':'')+'</span>'
      + '</div>'
      + (c.observaciones?'<div class="small" style="color:#6b7688;margin-top:2px">'+escapeHtml(String(c.observaciones))+'</div>':'')
      + pistas
      + '<div class="small" style="margin-top:5px"><a href="javascript:void 0" style="color:#7dd3fc" onclick="_cotejoToggleMovs(\''+cid+'\')">🔎 Ver movimientos del turno de esta billetera</a></div>'
      + '<div id="cotejoMovs_'+cid+'" style="display:none;margin-top:4px;max-height:170px;overflow:auto;background:#0b0f15;border:1px solid #1e2530;border-radius:7px;padding:6px">'+_cotejoMovsHtml(c.wallet_id, movimientosPorBilletera)+'</div>'
      + acciones
      + '</div>';
  }).join('');
  // Tabla resumen estilo "cage report" (conciliación de caja de casino): fila por billetera,
  // Anotado (Chunior) | Declarado (banco) | Diferencia, con totales. Muestra TODO, incluso las OK.
  let resumenHtml='';
  if(st.resumen && st.resumen.filas && st.resumen.filas.length){
    let tC=0,tD=0,tDif=0;
    const trs=st.resumen.filas.map(function(r){
      tC+=r.chunior; tD+=r.decl; tDif+=r.dif;
      const col=r.dif===0?'#22c55e':(r.dif<0?'#f87171':'#f5c518');
      const difTxt=(r.dif===0?'✓':((r.dif>0?'+':'−')+money(Math.abs(r.dif))))
        + (r.resid?' <span title="residuo de centavos — no genera caso, lo limpia el supervisor" style="color:#6b7688;font-size:10px;font-weight:400">±'+String(Math.abs(r.resid)).replace('.',',')+'</span>':'');
      return '<tr style="border-top:1px solid rgba(255,255,255,.05)"><td style="padding:3px 6px;font-weight:700">'+escapeHtml(r.nombre)+'</td>'
        +'<td style="padding:3px 6px;text-align:right;color:#8b949e">'+money(r.chunior)+'</td>'
        +'<td style="padding:3px 6px;text-align:right">'+money(r.decl)+'</td>'
        +'<td style="padding:3px 6px;text-align:right;font-weight:800;color:'+col+'">'+difTxt+'</td></tr>';
    }).join('');
    resumenHtml='<div class="small" style="color:#8b949e;margin-bottom:3px">Última declaración · '+new Date(st.resumen.ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})+'</div>'
      +'<div style="overflow-x:auto;border:1px solid #262d3a;border-radius:9px"><table style="width:100%;font-size:12px;border-collapse:collapse">'
      +'<thead><tr style="color:#8b949e;background:#10141b"><th style="text-align:left;padding:4px 6px">Billetera</th><th style="text-align:right;padding:4px 6px">Anotado (Chunior)</th><th style="text-align:right;padding:4px 6px">Declarado (banco)</th><th style="text-align:right;padding:4px 6px">Dif</th></tr></thead><tbody>'
      +trs
      +'<tr style="border-top:1px solid rgba(255,255,255,.18);font-weight:800;background:#10141b"><td style="padding:4px 6px;color:#8b949e">TOTAL</td>'
      +'<td style="padding:4px 6px;text-align:right;color:#8b949e">'+money(tC)+'</td><td style="padding:4px 6px;text-align:right">'+money(tD)+'</td>'
      +'<td style="padding:4px 6px;text-align:right;color:'+(tDif===0?'#22c55e':'#f5c518')+'">'+(tDif===0?'✓':((tDif>0?'+':'−')+money(Math.abs(tDif))))+'</td></tr>'
      +'</tbody></table></div><div style="border-top:1px solid #262d3a;margin:10px 0 4px"></div>';
  }
  const cerradosHtml = _cerrados.length ? (
    '<div class="small" style="margin-top:10px"><a href="javascript:void 0" style="color:#8b949e" onclick="var d=document.getElementById(\'cotejoCerrados\');if(d)d.style.display=d.style.display===\'none\'?\'block\':\'none\';">▸ Finalizados del turno ('+_cerrados.length+') — ver/ocultar</a></div>'
    + '<div id="cotejoCerrados" style="display:none">'
    + _cerrados.map(function(c){
        const col=c.tipo==='FALTANTE'?'#f87171':'#f5c518';
        return '<div class="small" style="display:flex;gap:8px;align-items:center;padding:4px 8px;margin-top:4px;border-radius:7px;background:#0e1218;border:1px solid #1c2330;opacity:.65">'
          + '<span style="color:'+col+';font-weight:700">'+(c.tipo==='FALTANTE'?'▼':'▲')+' '+money(c.monto_original||c.monto_disponible)+'</span>'
          + '<span style="flex:1;color:#8b949e">'+escapeHtml(c.wallet_nombre||'')+' · #'+escapeHtml(String(c.case_id))+'</span>'
          + _cotejoEstadoBadge(c.estado)
          + (c.observaciones?'<span style="color:#6b7688" title="'+escapeHtml(String(c.observaciones))+'">📝</span>':'')
          + '</div>';
      }).join('')
    + '</div>') : '';
  // Cabecera de estado: lo primero que tiene que saber el operador es si el turno cierra o no.
  // Antes había que sumar las tarjetas a ojo para saber cuánto quedaba sin explicar.
  const _tFalta=_activos.filter(function(x){ return x.tipo==='FALTANTE'; }).reduce(function(a,b){ return a+Number(b.monto_disponible||0); },0);
  const _tSobra=_activos.filter(function(x){ return x.tipo==='SOBRANTE'; }).reduce(function(a,b){ return a+Number(b.monto_disponible||0); },0);
  const cabecera = _activos.length
    ? '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:7px 11px;border-radius:9px;background:rgba(245,197,24,.09);border:1px solid rgba(245,197,24,.35);margin-bottom:9px">'
      + '<span style="font-size:13px;line-height:1">⚠️</span>'
      + '<b style="font-size:11.5px;letter-spacing:.5px;text-transform:uppercase;color:#f5c518">'+_activos.length+' sin resolver</b>'
      + '<span class="small" style="color:#8b949e">'
      +   (_tFalta?('falta <b style="color:#f87171">'+money(_tFalta)+'</b>'):'')
      +   ((_tFalta&&_tSobra)?' · ':'')
      +   (_tSobra?('sobra <b style="color:#f5c518">'+money(_tSobra)+'</b>'):'')
      + '</span></div>'
    : '<div style="display:flex;align-items:center;gap:9px;padding:7px 11px;border-radius:9px;background:rgba(63,185,80,.10);border:1px solid rgba(63,185,80,.38);margin-bottom:9px">'
      + '<span style="font-size:13px;line-height:1">✅</span>'
      + '<b style="font-size:11.5px;letter-spacing:.5px;text-transform:uppercase;color:#3fb950">Turno cuadrado</b>'
      + '<span class="small" style="color:#8b949e">no queda nada abierto</span></div>';
  el.innerHTML=_cotejoWrap(
    cabecera
    + resumenHtml
    + filas
    + cerradosHtml
    + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap">'
    +   '<span style="display:flex;gap:8px"><button class="mini-btn green" style="font-size:11px;font-weight:800" onclick="_cotejoAutoCompensar()" title="Cruza todos los faltantes con todos los sobrantes y hace las transferencias solo. Lo que quede es lo que realmente falta/sobra en el cierre.">⚡ Auto-cotejar todo</button>'
    +   '<button class="mini-btn blue" style="font-size:11px" onclick="_cotejoRenderDeclarar()">🙈 Nueva declaración</button>'
    +   '<button class="mini-btn gray" style="font-size:11px" onclick="_cotejoVerEscalados()">📚 Escalados anteriores</button></span>'
    +   '<button class="mini-btn" style="font-size:11px;background:#3b2a63;color:#d6c9ff" onclick="_cotejoEscalarTurno()" title="Se puede usar en cualquier momento — todo lo no resuelto queda para revisión del superior">⏫ Pasar TODO lo abierto al superior</button>'
    + '</div>');
}
// Mini-guía por caso: movimientos del turno de esa billetera (del historial ya cargado, 0 llamados).
function _cotejoMovsHtml(walletId, movimientosPorBilletera){
  const st=window._cotejoState; if(!st) return '';
  const indice=movimientosPorBilletera||NodoDomain.conciliacion.indexarMovimientos(_cotejoMovsTurno(st.snap.inicio_turno_ms));
  const movs=indice.get(String(walletId))||[];
  if(!movs.length) return '<div class="small" style="color:#6b7688">Sin movimientos de esta billetera en el turno.</div>';
  return movs.map(function(m){
    const hh=m.ts?new Date(m.ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):'—';
    const col=m.tipo==='RETIRO'?'#fb923c':(m.tipo==='CARGA'?'#22c55e':'#8b949e');
    return '<div class="small" style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
      + '<span style="color:#8b949e">'+hh+'</span><span style="color:'+col+';font-weight:700">'+escapeHtml(m.tipo)+'</span>'
      + '<span style="flex:1">'+escapeHtml(m.usuario||'')+'</span><b>'+money(m.monto)+'</b>'
      + (m.chunior_movimiento_id?'<span style="color:#8b949e">N° '+escapeHtml(String(m.chunior_movimiento_id))+'</span>':'')+'</div>';
  }).join('');
}
window._cotejoToggleMovs=function(id){ const d=document.getElementById('cotejoMovs_'+id); if(d) d.style.display = d.style.display==='none'?'block':'none'; };
function _cotejoCaso(id){ return (window._cotejoState.casos||[]).find(function(c){ return String(c.case_id)===String(id); }); }
async function _cotejoSetEstado(id, estado, obs){
  const st=window._cotejoState; const c=_cotejoCaso(id); if(!c) return;
  c.estado=estado; if(obs) c.observaciones=(c.observaciones?c.observaciones+' · ':'')+obs;
  const ls=_cotejoLsLoad(st.turno_id); ls.casos=st.casos; _cotejoLsSave(st.turno_id, ls);
  if(!c._local) _cotejoRpc('panel_cotejo_actualizar',{ p_case_id:Number(c.case_id), p_estado:estado, p_monto_disponible:null, p_observaciones:obs||null, p_operador:_cotejoOp() });
}
window._cotejoAplicarMoverRetiro=async function(casoFalt, casoSobr, movId){
  const st=window._cotejoState; const f=_cotejoCaso(casoFalt);
  const fila=((typeof _historialData!=='undefined'&&_historialData)||[]).find(function(h){ return String(h.id)===String(movId); });
  const bilDestino=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f&&f.wallet_id); });
  if(!fila||!bilDestino||!bilDestino.CHUNIOR_UID){ toast('No encuentro el movimiento o la billetera destino (con UID Chunior).','red'); return; }
  if(!confirm('Mover la anotación del retiro de '+(fila.usuario||'')+' ('+money(fila.monto)+') a la billetera '+(bilDestino.NOMBRE_VISIBLE||'')+' en Chunior?')) return;
  if(typeof procesarColaCambioBilletera==='function'){ procesarColaCambioBilletera([fila], bilDestino); }
  else { toast('Cambio de billetera no disponible — hacelo desde el historial.','yellow'); return; }
  await _cotejoSetEstado(casoFalt,'AJUSTANDO','mover retiro #'+movId+' → '+(bilDestino.NOMBRE_VISIBLE||''));
  await _cotejoSetEstado(casoSobr,'AJUSTANDO','par de #'+casoFalt);
  if(!(_cotejoCaso(casoFalt)||{})._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(casoFalt), p_tipo:'MOVER_RETIRO', p_monto:Number(f.monto_disponible), p_referencia:String(fila.chunior_movimiento_id||movId), p_detalle:'cola cambio billetera → '+(bilDestino.NOMBRE_VISIBLE||''), p_operador:_cotejoOp() });
  toast('🚚 Cola de cambio de billetera lanzada · cuando termine, marcá el caso resuelto','blue');
  _cotejoRenderCasos();
};
window._cotejoCrearDepo=async function(id){
  const c=_cotejoCaso(id); if(!c) return;
  const bil=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(c.wallet_id); });
  if(!bil||!bil.CHUNIOR_UID){ toast('La billetera no tiene UID de Chunior.','red'); return; }
  // Pre-relleno: monto + billetera fijos; usuario opcional desde el input inline del caso
  // (prompt() NO existe en Electron — nunca usarlo).
  const _usrInp=document.getElementById('cotejoDepoUsr_'+c.case_id);
  const usr=String((_usrInp&&_usrInp.value)||'').trim();
  const nota='[COTEJO '+window._cotejoState.turno_id+' · caso #'+c.case_id+' · '+_cotejoOp()+']'+(usr?(' '+usr):'');
  if(!confirm('Anotar depo s/reclamar de '+money(c.monto_disponible)+' en '+(bil.NOMBRE_VISIBLE||'')+' con nota:\n'+nota)) return;
  const r=await registrarDepoSinReclamarEnChunior(bil.CHUNIOR_UID, Number(c.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(id,'RESUELTA','depo s/r anotado'+(r.movimientoId?(' N° '+r.movimientoId):''));
    if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'CREAR_DEPO', p_monto:Number(c.monto_disponible), p_referencia:String(r.movimientoId||''), p_detalle:nota, p_operador:_cotejoOp() });
    toast('✓ Depo anotado y caso resuelto','green');
  } else toast('No se pudo anotar: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// ENVIAR A ERROR (faltante): transferencia contable billetera→ERROR — declara la falta en Chunior
// exactamente como el operador lo hacía a mano. El caso queda RESUELTO (la falta está declarada).
window._cotejoEnviarAError=async function(id){
  const c=_cotejoCaso(id); const ex=(window._cotejoState.snap&&window._cotejoState.snap.extra)||{}; const ew=ex.errorWallet;
  if(!c||!ew){ toast('No hay billetera ERROR detectada en Chunior.','red'); return; }
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(c.wallet_id); });
  if(!bf||!bf.CHUNIOR_UID){ toast('La billetera no tiene UID de Chunior.','red'); return; }
  const nota='[COTEJO '+window._cotejoState.turno_id+' · caso #'+c.case_id+' · '+_cotejoOp()+'] faltante declarado';
  if(!confirm('Declarar el faltante de '+money(c.monto_disponible)+':\n'+(bf.NOMBRE_VISIBLE||'')+' → '+(ew.nombre||'ERROR')+' (transferencia contable en Chunior)\n\nLa falta queda declarada y visible en ERROR. Si después la plata reaparece, el cotejo te va a ofrecer recuperarla.')) return;
  toast('Anotando en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, ew.uid, Number(c.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(id,'RESUELTA','faltante enviado a ERROR');
    if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'MANUAL', p_monto:Number(c.monto_disponible), p_referencia:'ERROR', p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('🚫 Faltante declarado en ERROR · caso resuelto','green');
  } else toast('No se pudo anotar: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// RECUPERAR DE ERROR (sobrante): la plata declarada perdida reapareció → transferencia contable
// ERROR→billetera (sube el chunior bajo, baja ERROR) y ambos quedan 1:1 con el banco.
window._cotejoRecuperarDeError=async function(id, refMov){
  const c=_cotejoCaso(id); const ex=(window._cotejoState.snap&&window._cotejoState.snap.extra)||{}; const ew=ex.errorWallet;
  if(!c||!ew){ toast('No hay billetera ERROR detectada.','red'); return; }
  const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(c.wallet_id); });
  if(!bs||!bs.CHUNIOR_UID){ toast('La billetera no tiene UID de Chunior.','red'); return; }
  const nota='[COTEJO '+window._cotejoState.turno_id+' · caso #'+c.case_id+' · '+_cotejoOp()+'] recuperado de ERROR'+(refMov?(' (mov '+refMov+')'):'');
  if(!confirm('Recuperar '+money(c.monto_disponible)+' de ERROR → '+(bs.NOMBRE_VISIBLE||'')+' (transferencia contable en Chunior)?\n\nLa plata reapareció: el error declarado se revierte.')) return;
  toast('Anotando en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(ew.uid, bs.CHUNIOR_UID, Number(c.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(id,'RESUELTA','recuperado de ERROR'+(refMov?(' · mov '+refMov):''));
    if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'MANUAL', p_monto:Number(c.monto_disponible), p_referencia:'ERROR:'+(refMov||''), p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('⇄ Recuperado de ERROR · caso resuelto','green');
  } else toast('No se pudo anotar: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// CERRAR COMO ERROR YA DECLARADO (faltante que concuerda con un envío a ERROR previo del turno):
// error genuino → NO se reclama; el caso se cierra explicado, sin doble contabilización.
window._cotejoCerrarPorError=async function(id, refMov){
  const c=_cotejoCaso(id); if(!c) return;
  if(!confirm('¿Cerrar este faltante como ERROR YA DECLARADO'+(refMov?(' (mov '+refMov+')'):'')+'?\n\nError genuino: la falta ya está declarada en ERROR, no se reclama ni se vuelve a anotar.')) return;
  await _cotejoSetEstado(id,'RESUELTA','explicado por envío a ERROR previo'+(refMov?(' · mov '+refMov):'')+' (error genuino, sin reclamo)');
  if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'MANUAL', p_monto:Number(c.monto_disponible), p_referencia:'ERROR:'+(refMov||''), p_detalle:'error genuino ya declarado', p_operador:_cotejoOp() });
  toast('Caso cerrado: error ya declarado','green'); _cotejoRenderCasos();
};
// COMPENSACIÓN PARCIAL: transfiere el MÍNIMO entre faltante y sobrante (billetera faltante →
// sobrante, contable) y descuenta el disponible de AMBOS casos (inmutabilidad: asignación, no
// edición). El que llega a 0 → RESUELTA; el que queda con resto → PARCIAL_ASIGNADA y sigue vivo
// para el próximo cruce (depo, ERROR, otra compensación).
window._cotejoCompensarParcial=async function(casoFalt, casoSobr){
  const st=window._cotejoState; const f=_cotejoCaso(casoFalt), s=_cotejoCaso(casoSobr); if(!f||!s) return;
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f.wallet_id); });
  const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(s.wallet_id); });
  if(!bf||!bs||!bf.CHUNIOR_UID||!bs.CHUNIOR_UID){ toast('Falta el UID de Chunior de alguna billetera.','red'); return; }
  const mm=Math.min(Number(f.monto_disponible), Number(s.monto_disponible));
  if(!(mm>0)) return;
  const restoF=Number(f.monto_disponible)-mm, restoS=Number(s.monto_disponible)-mm;
  const nota='[COTEJO '+st.turno_id+' · #'+f.case_id+'/#'+s.case_id+' · '+_cotejoOp()+'] compensación parcial '+(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'');
  if(!confirm('Compensar '+money(mm)+' con una transferencia CONTABLE en Chunior:\n'
    +(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'')+'\n\nDespués queda:\n'
    +'· '+(bf.NOMBRE_VISIBLE||'')+': '+(restoF>0?('faltante de '+money(restoF)):'cuadrada ✓')+'\n'
    +'· '+(bs.NOMBRE_VISIBLE||'')+': '+(restoS>0?('sobrante de '+money(restoS)):'cuadrada ✓'))) return;
  toast('Anotando transferencia en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, mm, nota);
  if(r&&r.ok){
    const _apl=function(c, resto, obs){
      c.monto_disponible=resto;
      c.estado=(resto<=0)?'RESUELTA':'PARCIAL_ASIGNADA';
      c.observaciones=(c.observaciones?c.observaciones+' · ':'')+obs;
    };
    _apl(f, restoF, 'compensado '+money(mm)+' con #'+s.case_id);
    _apl(s, restoS, 'compensado '+money(mm)+' con #'+f.case_id);
    const ls=_cotejoLsLoad(st.turno_id); ls.casos=st.casos; _cotejoLsSave(st.turno_id, ls);
    // El RPC de asignación descuenta y resuelve estado server-side (misma lógica).
    if(!f._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(f.case_id), p_tipo:'COMBINACION', p_monto:mm, p_referencia:String(s.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    if(!s._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(s.case_id), p_tipo:'COMBINACION', p_monto:mm, p_referencia:String(f.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('⇄ Compensados '+money(mm)+(restoF>0||restoS>0?' · el resto quedó como caso vivo':' · ambos cuadrados'),'green');
  } else toast('No se pudo anotar la transferencia: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// AUTO-COTEJO: hace TODA la repartija sola. Cruza faltantes contra sobrantes (greedy, mayor contra
// mayor), transfiere el mínimo de cada par y sigue hasta que no queden cruces posibles. Lo que
// sobra/falta al final es lo que REALMENTE sobra o falta en el cierre de caja.
// No es absoluto: muestra el plan y el residuo antes de ejecutar, y frena si una transferencia falla.
window._cotejoAutoCompensar=async function(){
  const st=window._cotejoState; if(!st) return;
  const FIN=['RESUELTA','ANULADA','ESCALADA'];
  const vivos=st.casos.filter(function(c){ return !FIN.includes(c.estado) && Number(c.monto_disponible)>0; });
  const F=vivos.filter(function(c){ return c.tipo==='FALTANTE'; }).map(function(c){ return {c:c, rem:Number(c.monto_disponible)}; }).sort(function(a,b){ return b.rem-a.rem; });
  const S=vivos.filter(function(c){ return c.tipo==='SOBRANTE'; }).map(function(c){ return {c:c, rem:Number(c.monto_disponible)}; }).sort(function(a,b){ return b.rem-a.rem; });
  if(!F.length || !S.length){ toast('No hay faltantes y sobrantes para cruzar entre sí.','yellow'); return; }
  // PLAN greedy (sin tocar nada todavía)
  const plan=[];
  F.forEach(function(f){
    S.forEach(function(s){
      if(f.rem<=0 || s.rem<=0) return;
      if(String(f.c.wallet_id)===String(s.c.wallet_id)) return;
      const mm=Math.min(f.rem,s.rem);
      plan.push({ f:f.c, s:s.c, monto:mm });
      f.rem-=mm; s.rem-=mm;
    });
  });
  if(!plan.length){ toast('No hay cruces posibles.','yellow'); return; }
  const resid=[].concat(F,S).filter(function(x){ return x.rem>0; })
    .map(function(x){ return '· '+(x.c.tipo==='FALTANTE'?'falta':'sobra')+' '+money(x.rem)+' en '+(x.c.wallet_nombre||''); });
  const txtPlan=plan.map(function(p){ return '· '+money(p.monto)+'  '+(p.f.wallet_nombre||'')+' → '+(p.s.wallet_nombre||''); }).join('\n');
  if(!confirm('AUTO-COTEJO · '+plan.length+' transferencia(s) contable(s) en Chunior:\n\n'+txtPlan
    +'\n\nDespués de la repartija queda:\n'+(resid.length?resid.join('\n'):'· todo cuadrado ✓')
    +'\n\n(eso es lo que realmente sobra/falta en el cierre)')) return;
  let hechas=0;
  for(const p of plan){
    const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(p.f.wallet_id); });
    const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(p.s.wallet_id); });
    if(!bf||!bs||!bf.CHUNIOR_UID||!bs.CHUNIOR_UID){ toast('Falta UID de Chunior en '+((!bf||!bf.CHUNIOR_UID)?(p.f.wallet_nombre||''):(p.s.wallet_nombre||'')),'red'); break; }
    toast('Auto-cotejo '+(hechas+1)+'/'+plan.length+' · '+money(p.monto)+'…','blue');
    const nota='[COTEJO '+st.turno_id+' · #'+p.f.case_id+'/#'+p.s.case_id+' · '+_cotejoOp()+'] auto-cotejo';
    const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, p.monto, nota);
    if(!(r&&r.ok)){ toast('Se cortó en la transferencia '+(hechas+1)+': '+((r&&r.error)||''),'red'); break; }
    [[p.f,p.s],[p.s,p.f]].forEach(function(par){
      const c=par[0], otro=par[1];
      c.monto_disponible=Math.max(0, Number(c.monto_disponible)-p.monto);
      c.estado=(c.monto_disponible<=0)?'RESUELTA':'PARCIAL_ASIGNADA';
      c.observaciones=(c.observaciones?c.observaciones+' · ':'')+'auto-cotejo '+money(p.monto)+' con #'+otro.case_id;
      if(!c._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(c.case_id), p_tipo:'COMBINACION', p_monto:p.monto, p_referencia:String(otro.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    });
    hechas++;
  }
  const ls=_cotejoLsLoad(st.turno_id); ls.casos=st.casos; _cotejoLsSave(st.turno_id, ls);
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  toast(hechas===plan.length ? ('✅ Auto-cotejo completo · '+hechas+' transferencia(s)') : ('⚠ Auto-cotejo parcial · '+hechas+'/'+plan.length),
        hechas===plan.length?'green':'yellow');
  _cotejoRenderCasos();
};
// ⚠ Electron NO soporta prompt() (tira excepción y el botón "no hace nada") → acciones directas
// con confirm() + toast SIEMPRE como feedback. El motivo/nota queda en el log con operador+fecha.
// Compensación 1:1 SIN retiro candidato: transferencia CONTABLE en Chunior (movimientointerno)
// billetera FALTANTE → SOBRANTE. Baja el chunior alto (A) y sube el bajo (B) → ambos quedan 1:1
// con el banco. Queda anotada en Chunior con la nota del caso (auditable).
window._cotejoCompensar=async function(casoFalt, casoSobr){
  const f=_cotejoCaso(casoFalt), s=_cotejoCaso(casoSobr); if(!f||!s) return;
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f.wallet_id); });
  const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(s.wallet_id); });
  if(!bf||!bs||!bf.CHUNIOR_UID||!bs.CHUNIOR_UID){ toast('Falta el UID de Chunior de alguna de las billeteras.','red'); return; }
  const nota='[COTEJO '+window._cotejoState.turno_id+' · #'+f.case_id+'/#'+s.case_id+' · '+_cotejoOp()+'] compensación '+(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'');
  if(!confirm('Compensar '+money(f.monto_disponible)+' con una transferencia CONTABLE en Chunior:\n'
    +(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'')+'\n\nNo mueve plata real: alinea lo anotado con lo que hay en el banco. Queda en Chunior con la nota del caso.')) return;
  toast('Anotando transferencia en Chunior...','blue');
  const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, Number(f.monto_disponible), nota);
  if(r&&r.ok){
    await _cotejoSetEstado(casoFalt,'RESUELTA','compensado por transferencia → '+(bs.NOMBRE_VISIBLE||''));
    await _cotejoSetEstado(casoSobr,'RESUELTA','compensado por transferencia ← '+(bf.NOMBRE_VISIBLE||''));
    if(!f._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(f.case_id), p_tipo:'COMBINACION', p_monto:Number(f.monto_disponible), p_referencia:String(s.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
    toast('⇄ Compensado · ambos casos resueltos','green');
  } else toast('No se pudo anotar la transferencia: '+((r&&r.error)||''),'red');
  _cotejoRenderCasos();
};
// Compensar una COMBINACIÓN (faltante = suma de 2 sobrantes): una transferencia contable por parte.
// Si alguna falla a mitad → APLICACION_PARCIAL (doc §8) y se reintenta después.
window._cotejoCompensarCombo=async function(casoFalt, partesCsv){
  const f=_cotejoCaso(casoFalt); if(!f) return;
  const partes=String(partesCsv||'').split(',').map(function(x){ return _cotejoCaso(x); }).filter(Boolean);
  const bf=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(f.wallet_id); });
  if(!bf||!bf.CHUNIOR_UID||!partes.length){ toast('Faltan datos de billeteras para compensar.','red'); return; }
  const detalle=partes.map(function(p){ return (p.wallet_nombre||'')+' '+money(p.monto_disponible); }).join(' + ');
  if(!confirm('Compensar '+money(f.monto_disponible)+' de '+(bf.NOMBRE_VISIBLE||'')+' con '+partes.length+' transferencias contables en Chunior:\n'+detalle+'\n\nNo mueve plata real: alinea lo anotado con el banco.')) return;
  let hechas=0;
  for(const p of partes){
    const bs=(billeteras||[]).find(function(b){ return String(b.ID_BILLETERA)===String(p.wallet_id); });
    if(!bs||!bs.CHUNIOR_UID){ break; }
    const nota='[COTEJO '+window._cotejoState.turno_id+' · #'+f.case_id+'/#'+p.case_id+' · '+_cotejoOp()+'] combinación '+(bf.NOMBRE_VISIBLE||'')+' → '+(bs.NOMBRE_VISIBLE||'');
    toast('Transferencia '+(hechas+1)+'/'+partes.length+'...','blue');
    const r=await _transferirEntreBilleterasChunior(bf.CHUNIOR_UID, bs.CHUNIOR_UID, Number(p.monto_disponible), nota);
    if(!(r&&r.ok)) break;
    await _cotejoSetEstado(p.case_id,'RESUELTA','combinación con #'+f.case_id);
    if(!f._local) _cotejoRpc('panel_cotejo_asignar',{ p_case_id:Number(f.case_id), p_tipo:'COMBINACION', p_monto:Number(p.monto_disponible), p_referencia:String(p.case_id), p_detalle:nota, p_operador:_cotejoOp() });
    hechas++;
  }
  if(hechas===partes.length){ await _cotejoSetEstado(casoFalt,'RESUELTA','combinación completa: '+detalle); toast('⇄ Combinación compensada · '+(partes.length+1)+' casos resueltos','green'); }
  else { await _cotejoSetEstado(casoFalt,'APLICACION_PARCIAL','falló la parte '+(hechas+1)+' de '+partes.length+' — reintentá'); toast('⚠ Se aplicaron '+hechas+'/'+partes.length+' — el caso quedó en APLICACIÓN PARCIAL, reintentá','yellow'); }
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  _cotejoRenderCasos();
};
// Casos pasados al superior en turnos ANTERIORES de esta PC (solo lectura — la UI central del
// superior vive en el admi cuando el SQL esté aplicado).
window._cotejoVerEscalados=function(){
  const el=_cotejoUiModal(); const cur=window._cotejoState?window._cotejoState.turno_id:'';
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i)||'';
    if(!/^nodo_cotejo_\d{4}/.test(k) || k===_cotejoLsKey(cur)) continue;
    try{ const s=JSON.parse(localStorage.getItem(k)||'{}'); (s.casos||[]).forEach(function(c){ if(c.estado==='ESCALADA') out.push(Object.assign({_turno:k.replace('nodo_cotejo_','')},c)); }); }catch(_e){}
  }
  const rows=out.map(function(c){
    const col=c.tipo==='FALTANTE'?'#f87171':'#f5c518';
    return '<div class="small" style="display:flex;gap:10px;padding:6px 8px;border-radius:8px;background:#10141b;border:1px solid #262d3a;border-left:3px solid '+col+';margin-top:5px;align-items:center">'
      + '<span style="color:#8b949e">'+escapeHtml(c._turno)+'</span>'
      + '<b style="color:'+col+'">'+(c.tipo==='FALTANTE'?'▼':'▲')+' '+money(c.monto_disponible)+'</b>'
      + '<span style="flex:1">'+escapeHtml(c.wallet_nombre||'')+'</span>'
      + '<span style="color:#8b949e">'+escapeHtml(c.operador||'')+'</span>'
      + (c.observaciones?'<span style="color:#6b7688" title="'+escapeHtml(c.observaciones)+'">📝</span>':'')+'</div>';
  }).join('');
  el.innerHTML=_cotejoWrap('<div style="font-weight:800;margin-bottom:4px">📚 Pasados al superior · turnos anteriores (esta PC)</div>'
    + (rows||'<div class="alert-box">No hay casos escalados de turnos anteriores en esta PC.</div>')
    + '<div style="margin-top:10px"><button class="mini-btn blue" style="font-size:11px" onclick="_cotejoRenderCasos()">← Volver a los casos</button></div>');
};
window._cotejoIgnorar=async function(id){
  if(!confirm('¿Ignorar este caso? Queda ANULADO en el registro (no se borra, el superior lo puede ver).')) return;
  await _cotejoSetEstado(id,'ANULADA','ignorado por operador');
  toast('Caso ignorado (queda en el registro)','yellow'); _cotejoRenderCasos();
};
window._cotejoEscalarCaso=async function(id){
  if(!confirm('¿Pasar este caso al SUPERIOR? Queda marcado para que lo revise él (vos ya no lo tocás).')) return;
  await _cotejoSetEstado(id,'ESCALADA','pasado al superior por el operador');
  toast('Caso pasado al superior','blue'); _cotejoRenderCasos();
};
window._cotejoEscalarTurno=async function(){
  if(!confirm('¿Pasar TODO lo no resuelto al SUPERIOR? Se puede usar en cualquier momento (no solo a fin de turno).')) return;
  const st=window._cotejoState; let n=0;
  for(const c of st.casos){ if(!['RESUELTA','ANULADA','ESCALADA'].includes(c.estado)){ await _cotejoSetEstado(c.case_id,'ESCALADA','pasado al superior (lote)'); n++; } }
  _cotejoRpc('panel_cotejo_escalar_turno',{ p_pc_codigo:(pcOperativa||''), p_turno_id:st.turno_id, p_operador:_cotejoOp() });
  toast(n+' caso(s) pasados al superior','blue'); _cotejoRenderCasos();
};

// Verifica DIRECTAMENTE en la lista de movimientos de Chunior si ya existe un
// movimiento que coincida con usuario (notas) + monto, en las últimas horas.
// Esto cubre el caso "se anotó en Chunior pero NODO no guardó el N° de movimiento".
// Usa el buscador del admin (?q=usuario) y lee la tabla #result_list.
// Devuelve { existe:boolean, movimientoId:string|null }.
// "07-07-2026 08:21:49" (DD-MM-YYYY HH:MM:SS, hora local de Chunior) → ms epoch.
function _chuParsearFechaCreacion(s){
  const m = String(s||'').trim().match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if(!m) return null;
  const d = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6]);
  return isNaN(d.getTime()) ? null : d.getTime();
}
// Chunior pinta el monto como 3000 / 3.000 / 3000,00 / 3.000,00 → generamos las variantes de texto.
function _chuVariantesMonto(monto){
  const abs = Math.abs(Number(monto)||0);
  const entero = String(Math.trunc(abs));
  const miles  = Math.trunc(abs).toLocaleString('es-AR'); // 3.000
  const out = [entero, miles, entero+',00', miles+',00', entero+'.00'];
  return out.filter(function(v,i){ return out.indexOf(v)===i; });
}
// Verifica un movimiento en la LISTA de Chunior por usuario (notas) + monto. Portado/afinado del colega:
//   - tCargaMs presente → ADEMÁS filtra por ventana horaria (desambigua varias del mismo monto por
//     cercanía a la hora de la operación). Ausente → NO filtra por tiempo (reintento de op VIEJA:
//     solo interesa si EXISTE un movimiento que coincida).
//   - excluirIds → N° ya vinculados a OTRA op del historial: no reclamarlos (evita doble atribución
//     del mismo movimiento a dos operaciones distintas).
//   - monto por VARIANTES de formato (+ respaldo numérico); usuario EXACTO en notas (+ respaldo por
//     texto de fila si la fila no trae notas).
// Devuelve { existe, movimientoId, creacion?, vinculadoAOtro? } (existe/movimientoId = compat con el caller).
async function verificarMovimientoEnChunior(usuario, monto, tCargaMs, ventanaMs, excluirIds){
  // "No pude verificar" NO es lo mismo que "no está": si el que llama no puede distinguirlo,
  // vuelve a anotar un movimiento que ya existe y duplica la plata (D-107). Por eso va `ok`.
  if(!window.chunior || !usuario) return { ok:false, existe:false, encontrado:false, movimientoId:null, motivo:'sin ventana de Chunior' };
  const filtraTiempo = (tCargaMs !== undefined && tCargaMs !== null);
  const tRef    = tCargaMs || Date.now();
  const ventana = ventanaMs || 10*60*1000; // ±10 min (cubre demoras y desfase de reloj)
  const excluir = new Set((excluirIds||[]).map(function(x){ return String(x); }));
  const normU     = String(usuario).trim().toLowerCase();
  const variantes = _chuVariantesMonto(monto);
  const montoAbs  = Math.abs(Number(monto));
  try {
    const listUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/?q=' + encodeURIComponent(usuario);
    await window.chunior.navigate(listUrl);
    // Esperar a que cargue la tabla de resultados (o el "0 resultados")
    const t0 = Date.now();
    let listo = false;
    while(Date.now() - t0 < 8000){
      listo = await window.chunior.exec('(function(){return !!(document.getElementById("result_list")||document.querySelector(".paginator, #changelist"));})()').catch(function(){return false;});
      if(listo) break;
      await new Promise(function(r){ setTimeout(r,250); });
    }
    if(!listo) return { ok:false, existe:false, encontrado:false, movimientoId:null, motivo:'la lista de Chunior no cargó' };

    // Leer hasta 40 filas: id, monto (varias clases posibles), notas, fecha de creación y texto de respaldo.
    const res = await window.chunior.exec(
      '(function(){' +
        'var rows = document.querySelectorAll("#result_list tbody tr");' +
        'var out = [];' +
        'for(var i=0;i<rows.length && i<40;i++){' +
          'var r = rows[i];' +
          'var a = r.querySelector(".field-id a, th a, td a[href]");' +
          'var idm = null; if(a){ var mm=(a.href||"").match(/movimientoficha\\/(\\d+)/); if(mm) idm=mm[1]; else { var t=(a.textContent||"").trim(); if(/^\\d{3,}$/.test(t)) idm=t; } }' +
          'var montoTxt = ((r.querySelector(".field-as_money, .field-monto, td.field-monto")||{}).textContent || "").trim();' +
          'var notas = ((r.querySelector(".field-notas")||{}).textContent || "").trim();' +
          'var cre = ((r.querySelector(".field-creation, td.field-creation")||{}).textContent || "").trim();' +
          'var texto = (r.textContent||"").replace(/\\s+/g," ").trim().substring(0,300);' +
          'out.push({ id:idm, montoTxt:montoTxt, notas:notas, creacion:cre, texto:texto });' +
        '}' +
        'return out;' +
      '})()'
    ).catch(function(){ return []; });

    // La lista cargó y no trajo ninguna fila: eso SÍ es "no está".
    if(!res || !res.length) return { ok:true, existe:false, encontrado:false, movimientoId:null };

    // Candidatos que coinciden en usuario + monto (+ horario si aplica).
    const candidatos = [];
    for(const r of res){
      const notasNorm = String(r.notas||'').trim().toLowerCase();
      const txtLower  = String(r.texto||'').toLowerCase();
      // usuario: EXACTO en notas (lo que escribimos nosotros); si la fila no trae notas, respaldo por texto.
      const usuarioOk = notasNorm ? (notasNorm === normU) : (!!normU && txtLower.indexOf(normU) !== -1);
      if(!usuarioOk) continue;
      // monto: por variantes de formato contra el campo monto/texto; respaldo por parseo numérico (AR).
      const campoMonto = r.montoTxt || r.texto || '';
      let montoOk = variantes.some(function(v){ return campoMonto.indexOf(v) !== -1; });
      if(!montoOk){
        const mTxt = String(r.montoTxt||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.');
        const mNum = Math.abs(parseFloat(mTxt));
        montoOk = !isNaN(mNum) && Math.abs(mNum - montoAbs) < 1;
      }
      if(!montoOk) continue;
      const tFila = _chuParsearFechaCreacion(r.creacion);
      if(filtraTiempo){ if(tFila === null || Math.abs(tFila - tRef) > ventana) continue; } // horario NO coincide
      candidatos.push({ id: r.id||null, creacion: r.creacion, dt: (tFila!==null ? Math.abs(tFila - tRef) : Infinity) });
    }
    if(!candidatos.length) return { ok:true, existe:false, encontrado:false, movimientoId:null };
    candidatos.sort(function(a,b){ return a.dt - b.dt; }); // el más cercano en horario primero
    // Descartar los que YA están vinculados a otra operación.
    const libres = candidatos.filter(function(c){ return !(c.id && excluir.has(String(c.id))); });
    if(libres.length){
      const best = libres[0];
      return { ok:true, existe:true, encontrado:true, movimientoId: best.id || null, creacion: best.creacion };
    }
    // Hubo match(es) pero TODOS ya pertenecen a otra op → no lo reclamamos como propio.
    return { ok:true, existe:false, encontrado:false, vinculadoAOtro:true, idVinculado: candidatos[0].id, creacion: candidatos[0].creacion };
  } catch(e){
    return { ok:false, existe:false, encontrado:false, movimientoId:null, motivo:(e&&e.message)||'error leyendo la lista de Chunior' };
  }
}

// Registra una carga en Chunior (movimiento de fichas) y devuelve el número de movimiento.
// chunior_uid: ID de la billetera en Chunior (string, ej "918")
// monto: positivo (acreditación al jugador)
// usuario: nombre del usuario para escribir en notas
// Retorna: { ok:boolean, movimientoId:string|null, error:string|null }
// ══════════════════════════════════════════════════════════════════════════════
// ANOTACIONES DE CHUNIOR PENDIENTES (portado de NexoBetaChan · rama unificacion)
// Caso real: la carga se hace en Agentes y, al ir a anotarla en Chunior, la sesión
// está caída. Las fichas SALIERON pero en Chunior no quedó nada, y nadie se acuerda
// de terminar el trabajo — el operador se entera al cotejar, horas después.
// Ahora lo que no se pudo anotar queda guardado con todo lo necesario y se reintenta
// solo cuando Chunior vuelve. Sobrevive a que se cierre el panel (localStorage).
// ══════════════════════════════════════════════════════════════════════════════
const _CHU_PEND_KEY = 'nodo_chunior_pendientes';
function _chuPendAll(){ try{ return JSON.parse(localStorage.getItem(_CHU_PEND_KEY)||'[]')||[]; }catch(_e){ return []; } }
function _chuPendSave(a){ try{ localStorage.setItem(_CHU_PEND_KEY, JSON.stringify((a||[]).slice(-40))); }catch(_e){} }
window.chuniorPendientes = _chuPendAll;
window.chuniorPendienteAdd = function(item){
  if(!item || !item.uid || !item.monto) return;
  const a = _chuPendAll();
  a.push(Object.assign({ id:'cp'+Date.now()+Math.random().toString(36).slice(2,6), ts:Date.now(), intentos:0 }, item));
  _chuPendSave(a);
  try{ toast('📌 Anotación de Chunior pendiente: '+(item.tipo||'MOV')+' '+item.usuario+' · '+money(item.monto)+' — se reintenta sola','yellow'); }catch(_e){}
  console.warn('[chunior-pend] guardado para reintentar:', item);
};
window.chuniorPendienteQuitar = function(id){ _chuPendSave(_chuPendAll().filter(function(x){ return x.id!==id; })); };
let _chuPendCorriendo = false;
window.chuniorPendientesReintentar = async function(manual){
  if(_chuPendCorriendo) return;
  const lista = _chuPendAll();
  if(!lista.length){ if(manual) toast('No hay anotaciones de Chunior pendientes','blue'); return; }
  if(!window.chunior){ if(manual) toast('Ventana de Chunior no disponible','red'); return; }
  // Esto es de fondo: no pisa una operación en curso, puede esperar al próximo intento.
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return;
  if(window._drexGlobalBusy) return;
  if(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes>0)) return;
  _chuPendCorriendo = true;
  try{
    for(const p of lista.slice()){
      if(p.intentos >= 8) continue;                      // no insistir para siempre en silencio
      // PRIMERO: ¿ya entró? Si Chunior se cayó JUSTO DESPUÉS de guardar, el movimiento existe y
      // volver a anotarlo duplica la carga — pasó el 17/09 en el cambio de turno. La verificación de
      // adentro del registro no cubre este caso (sólo mira cuando no hubo ni éxito ni error, y acá
      // hubo error). Se pregunta por el horario del movimiento ORIGINAL, no por el de ahora (D-107).
      let ya = null;
      try{ ya = await verificarMovimientoEnChunior(p.usuario, p.monto, p.ts || Date.now(), 15*60*1000); }
      catch(_e){ ya = null; }
      if(ya && ya.ok && ya.encontrado){
        window.chuniorPendienteQuitar(p.id);
        try{
          if(p.histId && typeof supabaseClient!=='undefined' && ya.movimientoId){
            await supabaseClient.from('historial_ops').update({ chunior_movimiento_id:String(ya.movimientoId) }).eq('id', p.histId);
          }
        }catch(_e){}
        try{ toast('✓ '+(p.tipo||'MOV')+' de '+p.usuario+' · '+money(p.monto)+' YA estaba anotado en Chunior'+(ya.movimientoId?(' · N° '+ya.movimientoId):'')+' — no se duplicó','green'); }catch(_e){}
        try{ if(typeof cargarHistorial==='function') cargarHistorial(); }catch(_e){}
        continue;
      }
      // No se pudo confirmar (la lista no cargó, Chunior sigue caído): NO se anota a ciegas.
      // Queda pendiente y se vuelve a intentar; es preferible a duplicar plata.
      if(!(ya && ya.ok)){
        if(manual) toast('No pude confirmar en Chunior si ya estaba anotado'+((ya&&ya.motivo)?(' ('+ya.motivo+')'):'')+' · no anoto para no duplicar','yellow');
        break;
      }
      let r = null;
      try{
        r = (String(p.tipo).toUpperCase()==='RETIRO')
          ? await registrarRetiroEnChunior(p.uid, p.monto, p.usuario)
          : await registrarCargaEnChunior(p.uid, p.monto, p.usuario);
      }catch(e){ r = { ok:false, error:e.message||String(e) }; }
      if(r && r.ok){
        window.chuniorPendienteQuitar(p.id);
        // Completar la fila del historial que había quedado sin número de Chunior.
        try{
          if(p.histId && typeof supabaseClient!=='undefined' && r.movimientoId){
            await supabaseClient.from('historial_ops').update({ chunior_movimiento_id:String(r.movimientoId) }).eq('id', p.histId);
          }
        }catch(_e){}
        try{ toast('✅ Anotado en Chunior: '+(p.tipo||'MOV')+' '+p.usuario+' · '+money(p.monto)+(r.movimientoId?(' · N° '+r.movimientoId):''),'green'); }catch(_e){}
        try{ if(typeof cargarHistorial==='function') cargarHistorial(); }catch(_e){}
      } else {
        p.intentos = (p.intentos||0)+1;
        const a = _chuPendAll(); const it = a.find(function(x){ return x.id===p.id; });
        if(it){ it.intentos = p.intentos; it.ultimoError = (r&&r.error)||'sin detalle'; _chuPendSave(a); }
        if(manual) toast('No se pudo anotar todavía: '+((r&&r.error)||''),'yellow');
        break;   // si falló uno, Chunior no está listo — no quemamos el resto
      }
    }
  } finally { _chuPendCorriendo = false; }
};
try{ setInterval(function(){ window.chuniorPendientesReintentar(false); }, 45000); }catch(_e){}

// ══════════════════════════════════════════════════════════════════════════════
// CANDADO DE CHUNIOR — las anotaciones van DE A UNA.
// Chunior es UNA sola ventana y anotar hace navigate() sobre ella. Dos anotaciones
// a la vez se pisan el formulario: la segunda navega mientras la primera está
// llenando, y queda registrada UNA sola.
// Caso real que lo destapó: al meter el bono en la misma carga (1.1.54) se fue la
// pausa que había entre las dos anotaciones (antes el bono hacía una operación
// entera en Agentes en el medio). Las dos salían casi juntas y Chunior terminaba
// con SOLO el bono anotado y la carga real no → descuadre contra el casino.
// Esto serializa TODAS las anotaciones, no solo las del bono.
// ══════════════════════════════════════════════════════════════════════════════
let _chuCola = Promise.resolve();
function _chuSerializar(fn){
  const corrida = _chuCola.then(fn, fn);          // sigue la fila aunque la anterior falle
  _chuCola = corrida.then(function(){}, function(){});
  return corrida;
}

async function registrarCargaEnChunior(chunior_uid, monto, usuario){
  return _chuSerializar(function(){ return _registrarCargaEnChuniorImpl(chunior_uid, monto, usuario); });
}
async function _registrarCargaEnChuniorImpl(chunior_uid, monto, usuario){
  // Bloqueo del cotejo: mientras hay una DECLARACIÓN abierta no se anota (snapshot consistente).
  // Espera hasta 90s a que el operador confirme/cierre — la anotación NO se pierde, queda esperando.
  for(let _w=0; window._cotejoDeclarando && _w<90; _w++){ await new Promise(function(r){setTimeout(r,1000);}); }
  if(!window.chunior) return { ok:false, movimientoId:null, error:'Ventana de Chunior no disponible' };
  if(!chunior_uid) return { ok:false, movimientoId:null, error:'La billetera no tiene chunior_uid configurado' };

  const addUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/add/';
  await window.chunior.navigate(addUrl);

  // Esperar a que aparezcan los 3 campos del formulario (DOM ready ≠ form ready en Chunior)
  const t0 = Date.now();
  let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec(
      '(function(){return !!(document.getElementById("id_cuenta_destino")&&document.getElementById("id_monto")&&document.getElementById("id_notas")&&document.querySelector("input[name=\'_addanother\']"));})()'
    ).catch(function(){return false;});
    if(ready) break;
    await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready) return { ok:false, movimientoId:null, error:'Formulario de Chunior no apareció en 10s' };

  let injectRes;
  try {
    injectRes = await window.chunior.exec(
      '(function(){' +
      'var s=document.getElementById("id_cuenta_destino");' +
      'var m=document.getElementById("id_monto");' +
      'var n=document.getElementById("id_notas");' +
      'var b=document.querySelector("input[name=\'_addanother\']");' +
      'if(!s||!m||!n||!b) return {ok:false,err:"campos faltantes",hasS:!!s,hasM:!!m,hasN:!!n,hasB:!!b};' +
      's.value='+JSON.stringify(String(chunior_uid))+'; s.dispatchEvent(new Event("change",{bubbles:true}));' +
      'm.value='+JSON.stringify(String(monto))+'; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
      'n.value='+JSON.stringify(String(usuario||""))+'; n.dispatchEvent(new Event("input",{bubbles:true})); n.dispatchEvent(new Event("change",{bubbles:true}));' +
      // Devolvemos los valores PRE-click para verificar que entraron antes del submit
      'var snap={ok:true, valS:s.value, valM:m.value, valN:n.value};' +
      'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click();' +
      'return snap;' +
      '})()'
    );
  } catch(e){
    return { ok:false, movimientoId:null, error:e.message||'Error inyectando datos' };
  }
  if(!injectRes || !injectRes.ok){
    return { ok:false, movimientoId:null, error:'Inyección falló: '+JSON.stringify(injectRes) };
  }

  // Esperar y leer la respuesta de Chunior. Antes era una espera fija de 2.5s + parser
  // estricto; si Chunior tardaba o cambiaba el formato del mensaje, el N° quedaba null
  // (carga anotada pero "Falta Chunior"). Luego: poll hasta 8s (más robusto, pero cola
  // larga en el peor caso — comparado con el NODO hermano, que usa un fijo de 2.5s).
  // Ajuste (2026-07-02): baja la espera inicial y el techo del poll para acercarnos a la
  // velocidad del hermano en el caso típico, sin volver a perder el N° en el caso lento.
  await new Promise(function(r){setTimeout(r,500);});

  let movimientoId = null;
  let errorMsg = null;
  let dbgTxt = null;
  const _tParse = Date.now();
  while(Date.now() - _tParse < 4500){
    let res = null;
    try {
      res = await window.chunior.exec(
        '(function(){' +
        'var ok=document.querySelector("li.success")||document.querySelector(".messagelist .success")||document.querySelector(".success");' +
        'if(!ok){var ml=document.querySelector("ul.messagelist li"); if(ml&&/[eé]xito/i.test(ml.textContent||"")) ok=ml;}' +
        'if(ok){' +
        '  var txt=ok.textContent||"";' +
        '  var a=ok.querySelector("a[href]");' +
        '  if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) return {ok:true, id:mh[1]};}' +
        '  var mt=txt.match(/fichas[^0-9]{0,14}(\\d{3,})/i) || txt.match(/n[\\sº°o\\.]{0,4}(\\d{4,})/i) || txt.match(/(\\d{5,})/);' +
        '  if(mt) return {ok:true, id:mt[1]};' +
        '  return {ok:true, id:null, dbg:txt.trim().substring(0,180)};' +
        '}' +
        'var err=document.querySelector("ul.errorlist") || document.querySelector(".errornote");' +
        'if(err) return {ok:false, error:(err.textContent||"Error en formulario").trim().substring(0,200)};' +
        'return {pending:true};' +
        '})()'
      );
    } catch(e){
      errorMsg = e.message||'Error leyendo respuesta'; break;
    }
    if(res && res.ok){ movimientoId = res.id; dbgTxt = res.dbg||null; break; }
    if(res && res.error){ errorMsg = res.error; break; }
    // pending → la página todavía no mostró el resultado; esperar y reintentar
    await new Promise(function(r){ setTimeout(r,250); });
  }
  if(!movimientoId && dbgTxt){
    console.warn('[chunior] Anotó con éxito pero no pude leer el N° de movimiento. Texto del mensaje:', dbgTxt);
  }

  // Verificación contra la LISTA (horario field-creation + monto + usuario) SOLO en el caso
  // verdaderamente DESCONOCIDO: ni mensaje de éxito ni error visibles. Si Chunior YA mostró el
  // éxito (dbgTxt: solo faltó parsear el N°), NO navegamos a la lista — esa navegación extra en
  // cada carga era lo que hacía lento el paso de Chunior. Así cada movimiento queda ENLAZADO a su
  // N° de Chunior aunque no se haya podido parsear en el momento (portado de tu nodo).
  let verificadoPorLista = false;
  if(!movimientoId && !errorMsg && !dbgTxt){
    try{
      const v = await verificarMovimientoEnChunior(usuario, monto, Date.now(), 2*60*1000);
      if(v && v.ok && v.encontrado){
        movimientoId = v.movimientoId || null;
        verificadoPorLista = true;
        console.log('[chunior] Movimiento confirmado por lista · creación', v.creacion, '· N°', movimientoId || '(sin link)');
      } else if(v && v.ok && !v.encontrado){
        errorMsg = 'El movimiento NO aparece en la lista de Chunior (horario+monto+usuario) · anotarlo a mano';
      }
      // v.ok===false (lista no cargó) → no afirmamos nada: queda como antes (ok sin N°)
    }catch(_e){}
  }

  // Anotación OK → refrescar el saldo REAL de las billeteras desde Chunior (la ventana ya quedó en
  // /movimientoficha/add/ → leer los breadcrumbs no navega de más) para que NODO dibuje la verdad.
  if(!!movimientoId || !errorMsg){ try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){} }
  return { ok: !!movimientoId || !errorMsg, movimientoId: movimientoId, error: errorMsg, verificadoPorLista: verificadoPorLista };
}

// Retiro en Chunior: igual que carga pero monto negativo
async function registrarRetiroEnChunior(chunior_uid, monto, usuario){
  return registrarCargaEnChunior(chunior_uid, -Math.abs(Number(monto)), usuario);
}

// ── Auto-recuperación de Chunior (portado del colega, v1.1.36) ────────────────
// Idea: NO depender de que el operador apriete "Reiniciar Chunior". Si Chunior se traba varias
// veces SEGUIDAS (formulario que no aparece, exec que falla, registro con ok:false), se recupera
// SOLO recargándose desde la base. Contamos trabas CONSECUTIVAS de los registros de carga/retiro;
// a las 5, disparamos reiniciarChunior(false) (soft: navega a la base, re-loguea si perdió sesión).
// Un éxito resetea el contador → solo dispara si está REALMENTE pegado.
window._chuniorTrabaCount = 0;
let _chuniorReiniciando = false;
const _CHUNIOR_TRABA_MAX = 5;
async function _chuniorAutoRecuperar(){
  if(_chuniorReiniciando) return;
  if(!window.chunior || !window.chunior.reset) return;   // solo en la app de escritorio
  _chuniorReiniciando = true;
  try{ toast('🔄 Chunior se trabó '+window._chuniorTrabaCount+' veces seguidas · recuperándolo solo…','yellow'); }catch(_e){}
  try{ await window.reiniciarChunior(false); }catch(_e){}
  window._chuniorTrabaCount = 0;
  setTimeout(function(){ _chuniorReiniciando = false; }, 8000); // margen para que termine de recargar
}
function _chuniorTraba(ok, contexto){
  if(_chuniorReiniciando) return;                        // no contar mientras se recupera
  if(ok){ window._chuniorTrabaCount = 0; return; }       // un éxito limpia la racha
  window._chuniorTrabaCount = (window._chuniorTrabaCount||0) + 1;
  try{ console.warn('[chunior] traba '+window._chuniorTrabaCount+'/'+_CHUNIOR_TRABA_MAX+(contexto?(' · '+contexto):'')); }catch(_e){}
  if(window._chuniorTrabaCount >= _CHUNIOR_TRABA_MAX) _chuniorAutoRecuperar();
}
// Envolvemos SOLO registrarCargaEnChunior: el retiro delega en ella, así que cubre carga Y retiro
// sin doble conteo. No tocamos los múltiples returns de la función original.
(function(){
  const _oc = registrarCargaEnChunior;
  registrarCargaEnChunior = async function(chunior_uid, monto, usuario){
    const esRetiro = Number(monto) < 0;
    let r;
    try{ r = await _oc.apply(this, arguments); }
    catch(e){ _chuniorTraba(false, (esRetiro?'retiro:':'carga:')+(e.message||'')); throw e; }
    _chuniorTraba(r && r.ok!==false, esRetiro?'retiro':'carga');
    return r;
  };
  try{ window.registrarCargaEnChunior = registrarCargaEnChunior; }catch(_e){}
})();

// Cambia la billetera destino del movimiento N° {movId} en Chunior, sin que el operador lo vea.
// Devuelve {ok, error?, movimientoId?}.
async function _cambiarBilleteraChunior(movId, nuevoChuniorUid){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const changeUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/' + encodeURIComponent(movId) + '/change/';
  try {
    await window.chunior.navigate(changeUrl);
  } catch(e){
    return { ok:false, error:'No se pudo navegar a Chunior: ' + (e.message||'') };
  }

  // Esperar a que aparezcan el select y el botón "Guardar y agregar otro"
  const t0 = Date.now();
  let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec(
      '(function(){return !!(document.getElementById("id_cuenta_destino") && document.querySelector("input[name=\'_addanother\']"));})()'
    ).catch(function(){ return false; });
    if(ready) break;
    await new Promise(function(r){ setTimeout(r, 300); });
  }
  if(!ready) return { ok:false, error:'Formulario de Chunior no apareció en 10s' };

  // Verificar que el chunior_uid pedido exista como option válida
  const opcionExiste = await window.chunior.exec(
    '(function(){var s=document.getElementById("id_cuenta_destino"); if(!s) return false;' +
    'for(var i=0;i<s.options.length;i++){ if(String(s.options[i].value)===' + JSON.stringify(String(nuevoChuniorUid)) + ') return true; } return false; })()'
  ).catch(function(){ return false; });
  if(!opcionExiste) return { ok:false, error:'La billetera elegida no figura en el select de Chunior' };

  // Inyectar el cambio y disparar el submit (igual que en la carga: _addanother → vuelve a /add/)
  let injectRes;
  try {
    injectRes = await window.chunior.exec(
      '(function(){' +
        'var s=document.getElementById("id_cuenta_destino");' +
        'var b=document.querySelector("input[name=\'_addanother\']");' +
        'if(!s||!b) return {ok:false,err:"campos faltantes"};' +
        's.value=' + JSON.stringify(String(nuevoChuniorUid)) + ';' +
        's.dispatchEvent(new Event("change",{bubbles:true}));' +
        'var snap={ok:true, valS:s.value};' +
        'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click();' +
        'return snap;' +
      '})()'
    );
  } catch(e){
    return { ok:false, error:'Inyección falló: ' + (e.message||'') };
  }
  if(!injectRes || !injectRes.ok) return { ok:false, error:'Inyección falló: ' + JSON.stringify(injectRes) };

  // Esperar la confirmación (Chunior redirige a /add/ con li.success "Se modificó con éxito ...")
  await new Promise(function(r){ setTimeout(r, 2500); });

  try {
    const conf = await window.chunior.exec(
      '(function(){' +
        'var li = document.querySelector("li.success");' +
        'if(li){' +
          'var t = (li.textContent||"").trim();' +
          'if(/se\\s+modific[oó]\\s+con\\s+[eé]xito/i.test(t)){' +
            'var a = li.querySelector("a[href*=\\"/movimientoficha/\\"]");' +
            'var idM = null;' +
            'if(a){ var mm = a.href.match(/movimientoficha\\/(\\d+)/); if(mm) idM = mm[1]; }' +
            'if(!idM){ var m2 = t.match(/N°\\s*(\\d+)/); if(m2) idM = m2[1]; }' +
            'return { ok:true, mensaje:t, movId:idM };' +
          '}' +
        '}' +
        'var err = document.querySelector(".errorlist,.errornote");' +
        'if(err) return { ok:false, error:(err.textContent||"").trim() };' +
        'var u = window.location.href || "";' +
        'if(u.indexOf("/change/") < 0) return { ok:true, mensaje:"Redirección a /add/" };' +
        'return { ok:false, error:"Sin mensaje de confirmación visible" };' +
      '})()'
    );
    if(!conf || !conf.ok){
      return { ok:false, error: conf?.error || 'Chunior no confirmó el cambio' };
    }
    return { ok:true, movId: conf.movId || null, mensaje: conf.mensaje || '' };
  } catch(e){
    return { ok:false, error:'No se pudo leer la confirmación: ' + (e.message||'') };
  }
}

// Transferir fichas de una billetera a otra en Chunior (form /movimientointerno/add/).
// Devuelve {ok, error?}.
async function _transferirEntreBilleterasChunior(origenUid, destinoUid, monto, notas){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const url = CHUNIOR_BASE + '/transacciones/movimientointerno/add/';
  try {
    await window.chunior.navigate(url);
  } catch(e){
    return { ok:false, error:'No se pudo navegar a Chunior: ' + (e.message||'') };
  }

  // Esperar el formulario
  const t0 = Date.now();
  let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec(
      '(function(){return !!(document.getElementById("id_cuenta_origen")&&document.getElementById("id_cuenta_destino")&&document.getElementById("id_monto")&&document.querySelector("input[name=\'_addanother\']"));})()'
    ).catch(function(){ return false; });
    if(ready) break;
    await new Promise(function(r){ setTimeout(r, 300); });
  }
  if(!ready) return { ok:false, error:'Formulario de transferencia no apareció en 10s' };

  // Verificar que ambas billeteras existan como options
  const verif = await window.chunior.exec(
    '(function(){' +
      'function tiene(id,v){var s=document.getElementById(id); if(!s) return false;' +
      'for(var i=0;i<s.options.length;i++){ if(String(s.options[i].value)===String(v)) return true; } return false; }' +
      'return { origen: tiene("id_cuenta_origen", ' + JSON.stringify(String(origenUid)) + '),' +
              ' destino: tiene("id_cuenta_destino", ' + JSON.stringify(String(destinoUid)) + ') };' +
    '})()'
  ).catch(function(){ return { origen:false, destino:false }; });
  if(!verif.origen)  return { ok:false, error:'La billetera origen no figura en Chunior (UID '+origenUid+')' };
  if(!verif.destino) return { ok:false, error:'La billetera destino no figura en Chunior (UID '+destinoUid+')' };

  // Inyectar y submit
  let injectRes;
  try {
    injectRes = await window.chunior.exec(
      '(function(){' +
        'var o=document.getElementById("id_cuenta_origen");' +
        'var d=document.getElementById("id_cuenta_destino");' +
        'var m=document.getElementById("id_monto");' +
        'var n=document.getElementById("id_notas");' +
        'var b=document.querySelector("input[name=\'_addanother\']");' +
        'if(!o||!d||!m||!b) return {ok:false,err:"campos faltantes"};' +
        'o.value=' + JSON.stringify(String(origenUid))  + '; o.dispatchEvent(new Event("change",{bubbles:true}));' +
        'd.value=' + JSON.stringify(String(destinoUid)) + '; d.dispatchEvent(new Event("change",{bubbles:true}));' +
        'm.value=' + JSON.stringify(String(monto))      + '; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
        'if(n){ n.value=' + JSON.stringify(String(notas||"")) + '; n.dispatchEvent(new Event("input",{bubbles:true})); }' +
        'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click();' +
        'return {ok:true};' +
      '})()'
    );
  } catch(e){
    return { ok:false, error:'Inyección falló: ' + (e.message||'') };
  }
  if(!injectRes || !injectRes.ok) return { ok:false, error:'Inyección falló: ' + JSON.stringify(injectRes) };

  // Esperar confirmación Y LEER EL N° DE MOVIMIENTO.
  // Antes solo devolvía {ok:true}: la plata se movía en Chunior y de este lado no quedaba
  // ni el número, así que después no había forma de atar la transferencia a nada. Se usa
  // el mismo lector que el depósito sin reclamar, que viene funcionando.
  await new Promise(function(r){ setTimeout(r, 2500); });
  let movimientoId = null;
  try {
    const ok = await window.chunior.exec(
      '(function(){' +
        'if(document.querySelector("li.success")) return true;' +
        'var u=window.location.href||""; if(u.indexOf("/movimientointerno/add/") >= 0 && !document.querySelector(".errorlist,.errornote")) return true;' +
        'return false;' +
      '})()'
    );
    if(!ok){
      const errMsg = await window.chunior.exec(
        '(function(){var e=document.querySelector(".errorlist,.errornote"); return e ? (e.textContent||"").trim() : null;})()'
      ).catch(function(){ return null; });
      return { ok:false, error: errMsg || 'Chunior no confirmó la transferencia' };
    }
    // El N° es "si está, mejor": si no aparece, la transferencia igual se hizo y se
    // registra sin número. Nunca se falla una transferencia buena por no poder leerlo.
    movimientoId = await window.chunior.exec(
      '(function(){' +
        'var ok=document.querySelector("li.success")||document.querySelector(".messagelist .success")||document.querySelector(".success");' +
        'if(!ok) return null;' +
        'var a=ok.querySelector("a[href]");' +
        'if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) return mh[1];}' +
        'var txt=ok.textContent||"";' +
        'var mt=txt.match(/n[\\sº°o\\.]{0,4}(\\d{4,})/i) || txt.match(/(\\d{5,})/);' +
        'return mt ? mt[1] : null;' +
      '})()'
    ).catch(function(){ return null; });
  } catch(_){}

  return { ok:true, movimientoId: movimientoId || null };
}

// Modal NODO para transferir entre billeteras.
// ══════════════════════════════════════════════════════════════════════════
// MOVIMIENTOS CHUNIOR (portado de NexoBetaChan): propina / depósito sin reclamar / anular.
// Operator-triggered (NO autónomo). Usa la ventana de Chunior (window.chunior).
// ══════════════════════════════════════════════════════════════════════════
function _adminChuParseMonto(v){
  let s=String(v||'').replace(/[^\d,.-]/g,'');
  if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',', '.');
  else if(s.includes(',')) s=s.replace(',', '.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
  const n=Number(s); return Number.isFinite(n)?Math.abs(n):0;
}
// Busca el desplegable de billetera: por los identificadores conocidos o, si la pantalla usa otro,
// por el ÚNICO que tenga esa billetera entre sus opciones.
const _BIL_SEL_JS = '(function(uid){' +
  'var s=document.getElementById("id_cuenta_destino")||document.getElementById("id_cuenta_origen")' +
  '||document.getElementById("id_billetera")||document.getElementById("id_cuenta");' +
  'if(s) return s;' +
  'var ss=document.querySelectorAll("select");' +
  'for(var i=0;i<ss.length;i++){ if(ss[i].querySelector(\'option[value="\'+uid+\'"]\')) return ss[i]; }' +
  'return null;})';
// El chequeo de "¿está el formulario?" se arma DERECHO, sin reemplazos de texto: antes era un
// .replace() al final de una concatenación, que en JS se aplica sólo al último pedazo. El reemplazo
// no ocurría, la página recibía una función sin definir y no se podía anotar nada (D-100).
function _readyChuniorJs(uid){
  return '(function(){return !!(' + _BIL_SEL_JS + '(' + JSON.stringify(String(uid)) + ')'
    + '&&document.getElementById("id_monto")&&document.getElementById("id_notas"));})()';
}
async function _registrarAdminChunior(addUrl, chunior_uid, monto, notas, opts){
  // Bloqueo del cotejo (igual que en registrarCargaEnChunior): esperar la declaración abierta.
  for(let _w=0; window._cotejoDeclarando && _w<90; _w++){ await new Promise(function(r){setTimeout(r,1000);}); }
  if(!window.chunior) return { ok:false, movimientoId:null, error:'Ventana de Chunior no disponible' };
  if(!chunior_uid) return { ok:false, movimientoId:null, error:'La billetera no tiene chunior_uid configurado' };
  await window.chunior.navigate(addUrl);
  const t0 = Date.now(); let ready = false;
  while(Date.now() - t0 < 10000){
    // El desplegable de billetera no se llama igual en todas las pantallas (gastos locales tiene el
    // suyo): se busca por sus nombres conocidos y, si no, por el que tenga esta billetera adentro.
    ready = await window.chunior.exec(_readyChuniorJs(chunior_uid)).catch(function(){return false;});
    if(ready) break; await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready){
    // Sin esto, "no te deja agregar" es todo lo que se sabe. Ahora el error dice qué había en la
    // pantalla, que es lo único que permite arreglarlo sin estar sentado al lado (D-100).
    let _diag = '';
    try{
      const d = await window.chunior.exec('(function(){var ids=[];document.querySelectorAll("select,input,textarea").forEach(function(e){ if(e.id) ids.push(e.id); });return {url:location.href, campos:ids.slice(0,12), titulo:(document.title||"").slice(0,60)};})()');
      if(d) _diag = ' · pantalla: '+String(d.url||'').split('/').slice(3).join('/')+' · campos: '+((d.campos||[]).join(', ')||'ninguno');
    }catch(_e){}
    return { ok:false, movimientoId:null, error:'El formulario de Chunior no apareció en 10s'+_diag };
  }
  let injectRes;
  try{
    injectRes = await window.chunior.exec(
      '(function(){' +
      'var s=' + _BIL_SEL_JS + '(' + JSON.stringify(String(chunior_uid)) + ');' +
      'var m=document.getElementById("id_monto");' +
      'var n=document.getElementById("id_notas");' +
      'var b=document.querySelector("input[name=\'_addanother\']")||document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");' +
      'if(!s||!m||!n||!b) return {ok:false,err:"campos faltantes",hasS:!!s,hasM:!!m,hasN:!!n,hasB:!!b};' +
      's.value='+JSON.stringify(String(chunior_uid))+'; s.dispatchEvent(new Event("change",{bubbles:true}));' +
      'm.value='+JSON.stringify(String(monto))+'; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
      'n.value='+JSON.stringify(String(notas||""))+'; n.dispatchEvent(new Event("input",{bubbles:true})); n.dispatchEvent(new Event("change",{bubbles:true}));' +
      // El comprobante se adjunta ANTES de guardar: se arma el archivo desde la imagen pegada y se
      // deja en el campo, igual que si lo hubieran elegido a mano.
      'var comp=' + JSON.stringify((opts && opts.comprobante) || '') + ';' +
      'if(comp){ var fi=document.getElementById("id_comprobantes")||document.querySelector(\'input[type="file"]\');' +
      '  if(fi){ try{' +
      '    var pp=comp.split(","), mime=((pp[0]||"").match(/:(.*?);/)||[])[1]||"image/png";' +
      '    var bin=atob(pp[1]||""), arr=new Uint8Array(bin.length);' +
      '    for(var ci=0;ci<bin.length;ci++) arr[ci]=bin.charCodeAt(ci);' +
      '    var dt=new DataTransfer(); dt.items.add(new File([arr], ' + JSON.stringify((opts && opts.nombre) || 'comprobante.png') + ', {type:mime}));' +
      '    fi.files=dt.files; fi.dispatchEvent(new Event("change",{bubbles:true}));' +
      '  }catch(_cx){ return {ok:false, err:"no se pudo adjuntar el comprobante: "+(_cx.message||_cx)}; } } }' +
      'var snap={ok:true, valS:s.value, valM:m.value, valN:n.value, comp:!!comp}; try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return snap;' +
      '})()'
    );
  }catch(e){ return { ok:false, movimientoId:null, error:e.message||'Error inyectando datos' }; }
  if(!injectRes || !injectRes.ok) return { ok:false, movimientoId:null, error:'Inyección falló: '+JSON.stringify(injectRes) };
  await new Promise(function(r){ setTimeout(r,500); });
  let movimientoId=null, errorMsg=null, dbgTxt=null;
  const _tParse = Date.now();
  while(Date.now() - _tParse < 4500){
    let res=null;
    try{
      res = await window.chunior.exec(
        '(function(){' +
        'var ok=document.querySelector("li.success")||document.querySelector(".messagelist .success")||document.querySelector(".success");' +
        'if(!ok){var ml=document.querySelector("ul.messagelist li"); if(ml&&/[eé]xito/i.test(ml.textContent||"")) ok=ml;}' +
        'if(ok){ var txt=ok.textContent||""; var a=ok.querySelector("a[href]");' +
        '  if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) return {ok:true, id:mh[1]};}' +
        '  var mt=txt.match(/n[\\sº°o\\.]{0,4}(\\d{4,})/i) || txt.match(/(\\d{5,})/); if(mt) return {ok:true, id:mt[1]};' +
        '  return {ok:true, id:null, dbg:txt.trim().substring(0,180)}; }' +
        'var err=document.querySelector("ul.errorlist")||document.querySelector(".errornote");' +
        'if(err) return {ok:false, error:(err.textContent||"Error en formulario").trim().substring(0,200)};' +
        'return {pending:true};' +
        '})()'
      );
    }catch(e){ errorMsg=e.message||'Error leyendo respuesta'; break; }
    if(res && res.ok){ movimientoId=res.id; dbgTxt=res.dbg||null; break; }
    if(res && res.error){ errorMsg=res.error; break; }
    await new Promise(function(r){ setTimeout(r,250); });
  }
  const _okAdm = !!movimientoId || (!errorMsg && !!dbgTxt);
  // Anotación admin OK (propina / depo s/r) → refrescar los saldos reales desde Chunior.
  if(_okAdm){ try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){} }
  return { ok: _okAdm, movimientoId:movimientoId, error:errorMsg, dbg:dbgTxt };
}
// Gasto de oficina: suma el monto a la billetera y descuenta fichas. Acepta comprobante.
async function registrarGastoOficinaEnChunior(chunior_uid, monto, notas, comprobante){
  return _registrarAdminChunior(CHUNIOR_BASE + '/transacciones/gastoslocal/add/', chunior_uid, monto, notas,
    { comprobante: comprobante || '', nombre: 'comprobante-gasto.png' });
}
async function registrarPropinaEnChunior(chunior_uid, monto, notas){
  return _registrarAdminChunior(CHUNIOR_BASE + '/transacciones/propina/add/', chunior_uid, monto, notas);
}
async function registrarDepoSinReclamarEnChunior(chunior_uid, monto, notas){
  return _registrarAdminChunior(CHUNIOR_BASE + '/transacciones/depositossinreclamar/add/', chunior_uid, monto, notas);
}
// ── RECARGA ADMINISTRATIVA DE FICHAS ────────────────────────────────────────
// /transacciones/recargafichas/add/ · select de PUESTO (una sola opción real, el puesto actual)
// + #id_monto + submit input[name="_addanother"]. Suma fichas al agente (no toca billeteras).
async function registrarRecargaFichasChunior(monto){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const url = CHUNIOR_BASE + '/transacciones/recargafichas/add/';
  try{ await window.chunior.navigate(url); }catch(e){ return { ok:false, error:'No se pudo navegar a Chunior' }; }
  const t0=Date.now(); let ready=false;
  while(Date.now()-t0<10000){ ready=await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;}); if(ready)break; await new Promise(function(r){setTimeout(r,300);}); }
  if(!ready) return { ok:false, error:'El formulario de recarga no cargó' };
  const inj = await window.chunior.exec(
    '(function(){'
    + 'var m=document.getElementById("id_monto");'
    + 'var b=document.querySelector("input[name=\'_addanother\']")||document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\']");'
    + 'if(!m||!b) return {ok:false,err:"campos faltantes"};'
    // Puesto: hay UNA sola opción real (el puesto actual) → la elegimos sola.
    + 'var sel=null,ss=document.querySelectorAll("select");'
    + 'for(var i=0;i<ss.length;i++){ var o=Array.prototype.filter.call(ss[i].options,function(x){return x.value;}); if(o.length){ sel=ss[i]; break; } }'
    + 'var puesto="";'
    + 'if(sel){ var op=Array.prototype.filter.call(sel.options,function(x){return x.value;})[0];'
    + '  if(op){ sel.value=op.value; puesto=(op.textContent||"").trim(); sel.dispatchEvent(new Event("change",{bubbles:true})); } }'
    // Monto CON SIGNO: negativo descuenta fichas del puesto (no se usa Math.abs a propósito).
    + 'm.value=' + JSON.stringify(String(Number(monto)||0)) + ';'
    + 'm.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));'
    + 'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return {ok:true, puesto:puesto};'
    + '})()'
  ).catch(function(e){ return {ok:false, err:(e&&e.message)||'exec falló'}; });
  if(!inj || !inj.ok) return { ok:false, error:'No se pudo completar el formulario ('+((inj&&inj.err)||'')+')' };
  await new Promise(function(r){ setTimeout(r,2500); });
  const conf = await window.chunior.exec(
    '(function(){var li=document.querySelector("li.success"); if(li) return {ok:true, mensaje:(li.textContent||"").trim().substring(0,160)};'
    + 'var err=document.querySelector(".errorlist,.errornote"); if(err) return {ok:false, error:(err.textContent||"").trim().substring(0,200)};'
    + 'return {ok:true, mensaje:"enviado"};})()'
  ).catch(function(){ return { ok:true, mensaje:'sin confirmación visible' }; });
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  return Object.assign({ puesto: inj.puesto||'' }, conf||{ok:true});
}
window.abrirModalRecargaFichas = function(){
  abrirModal('🎰 Recarga administrativa de fichas',
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Ajusta las fichas del <b>puesto actual</b> en Chunior (el puesto se selecciona solo: es el único de la lista). No toca billeteras ni saldos de jugadores.<br><b style="color:#fdba74">Monto negativo (con "−") DESCUENTA fichas.</b></div>'
    + '<label>Monto <span class="small" style="color:#8b949e;font-weight:400">· ej: 500000 suma · -500000 descuenta</span></label>'
    + '<input id="recFichasMonto" type="text" inputmode="text" autocomplete="off" placeholder="Ej: 500000 o -500000" oninput="this.value=window._fmtMilesConSigno(this.value)" style="width:100%;text-align:right;font-weight:800;font-size:17px">',
    async function(){
      const monto=window._parseMontoConSigno((document.getElementById('recFichasMonto')||{}).value||'');
      if(!monto){ toast('Ingresá el monto.','red'); return; }
      cerrarModal();
      const _esNeg = monto<0;
      if(!confirm((_esNeg?'¿DESCONTAR ':'¿Recargar ')+money(Math.abs(monto))+' de fichas '+(_esNeg?'del':'al')+' puesto actual en Chunior?')) return;
      toast((_esNeg?'🎰 Descontando ':'🎰 Recargando ')+money(Math.abs(monto))+' fichas...','blue');
      _wdLock();
      let r; try{ r=await registrarRecargaFichasChunior(monto); }catch(e){ r={ok:false,error:e.message||'error'}; }
      finally{ _wdUnlock(); }
      if(r && r.ok){
        toast('🎰 '+(_esNeg?'Descuento':'Recarga')+' de '+money(Math.abs(monto))+' enviado'+(r.puesto?(' · '+r.puesto):''),'green');
        try{ await registrarEnHistorial({ usuario:'RECARGA FICHAS', tipo:'RECARGA_FICHAS', monto:monto,
          billetera_id:null, billetera_nombre:null, origen:'ADMIN', estado:'OK',
          notas:(_esNeg?'DESCUENTO administrativo de fichas':'Recarga administrativa de fichas')+(r.puesto?(' · '+r.puesto):'')+(r.mensaje?(' · '+r.mensaje):'') }); }catch(_e){}
        try{ await cargarHistorial(); }catch(_e){}
        _watchdogTrigger(1500);
      } else toast('⚠️ No se pudo recargar: '+((r&&r.error)||'sin detalle'),'red');
    }, 'Recargar fichas');
};
// ── GASTO DE OFICINA ────────────────────────────────────────────────────────────────────────
// La imagen se pega con Ctrl+V (igual que en el chat) y se adjunta sola en Chunior. El que escucha
// el pegado se protege solo: si el modal no está abierto, no hace nada (así no hay que sacarlo).
window._gastoComprobante = null;
function _gastoLeerImagen(file){
  if(!file) return;
  if(file.size > 3.5*1024*1024){ toast('La imagen pesa más de 3,5 MB: achicala o elegí otra.','red'); return; }
  const fr = new FileReader();
  fr.onload = function(){
    window._gastoComprobante = String(fr.result||'');
    const img = document.getElementById('gastoCompPrev');
    const zona = document.getElementById('gastoCompZona');
    if(img){ img.src = window._gastoComprobante; img.style.display='block'; }
    if(zona){ zona.textContent = '✓ Comprobante listo ('+Math.round(file.size/1024)+' KB) · pegá otra vez para reemplazarlo'; zona.style.color='#22c55e'; }
  };
  fr.readAsDataURL(file);
}
document.addEventListener('paste', async function(e){
  if(!document.getElementById('gastoCompZona')) return;   // el modal no está abierto
  const items = [...((e.clipboardData && e.clipboardData.items) || [])];
  const img = items.find(function(it){ return it.type && it.type.indexOf('image/')===0; });
  if(img){ const f = img.getAsFile(); if(f){ e.preventDefault(); _gastoLeerImagen(f); return; } }
  try{
    const clips = await navigator.clipboard.read();
    for(const clip of clips){
      const t = clip.types.find(function(x){ return x.indexOf('image/')===0; });
      if(t){ e.preventDefault(); const blob = await clip.getType(t); _gastoLeerImagen(new File([blob],'comprobante.png',{type:t})); return; }
    }
  }catch(_e){}
});
window.abrirModalGastoOficina = function(){
  const titulo = '💸 Gasto de oficina';
  const bilsConUid = (billeteras||[]).filter(function(b){ return b.CHUNIOR_UID; });
  if(!bilsConUid.length){ abrirModal(titulo, '<div class="err-box">No hay billeteras con UID de Chunior. Sincronizá billeteras primero.</div>', function(){ cerrarModal(); }, 'Entendido'); return; }
  window._gastoComprobante = null;
  const opts = bilsConUid.map(function(b){ return '<option value="'+escapeHtml(String(b.ID_BILLETERA))+'">'+escapeHtml(b.NOMBRE_VISIBLE||'—')+' · '+money(b.SALDO||0)+'</option>'; }).join('');
  const body =
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Se <b>suma</b> el monto a la billetera y se <b>descuentan</b> fichas. Queda anotado en Chunior con su comprobante.</div>'
    + '<label>Billetera</label><select id="gastoBil" style="width:100%">'+opts+'</select>'
    + '<label style="margin-top:8px;display:block">Monto</label><input id="gastoMonto" type="text" inputmode="decimal" placeholder="Ej: 15000" style="width:100%">'
    + '<label style="margin-top:8px;display:block">Notas <span class="small" style="color:#8b949e;font-weight:400">· obligatorias, es el único registro de en qué se gastó</span></label>'
    + '<input id="gastoNotas" type="text" placeholder="Ej: garrafa / limpieza / librería" style="width:100%">'
    + '<label style="margin-top:8px;display:block">Comprobante <span class="small" style="color:#8b949e;font-weight:400">· pegalo con Ctrl+V o elegí el archivo</span></label>'
    + '<div id="gastoCompZona" style="border:1px dashed #2d3342;border-radius:8px;padding:10px;text-align:center;font-size:12px;color:#8b949e">Pegá la imagen acá con Ctrl+V</div>'
    + '<input id="gastoCompFile" type="file" accept="image/*" style="margin-top:6px;width:100%" onchange="_gastoLeerImagenInput(this)">'
    + '<img id="gastoCompPrev" style="display:none;max-width:100%;border-radius:8px;margin-top:6px">';
  abrirModal(titulo, body, async function(){
    const bilId = (document.getElementById('gastoBil')||{}).value || '';
    const bil = billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); });
    const monto = _adminChuParseMonto((document.getElementById('gastoMonto')||{}).value || '');
    const notas = String((document.getElementById('gastoNotas')||{}).value || '').trim();
    const comp = window._gastoComprobante;
    if(!bil || !bil.CHUNIOR_UID){ toast('Elegí una billetera con Chunior.','red'); return; }
    if(!(monto>0)){ toast('Monto inválido.','red'); return; }
    if(notas.length < 3){ toast('Escribí en qué se gastó: es lo único que queda registrado.','red'); return; }
    cerrarModal();
    toast('💸 Anotando gasto de '+money(monto)+(comp?' con comprobante':'')+'...','blue');
    _wdLock();
    let r;
    try{ r = await registrarGastoOficinaEnChunior(bil.CHUNIOR_UID, monto, notas, comp); }
    catch(e){ r = { ok:false, error:e.message||'error' }; }
    finally{ _wdUnlock(); }
    if(r && r.ok){
      toast('💸 Gasto anotado en '+bil.NOMBRE_VISIBLE+(r.movimientoId?(' · N° '+r.movimientoId):''),'green');
      try{
        await registrarEnHistorial({
          usuario: notas || 'GASTO OFICINA', tipo:'GASTO', monto: monto,
          billetera_id: bil.ID_BILLETERA, billetera_nombre: bil.NOMBRE_VISIBLE,
          origen:'ADMIN', estado:'OK',
          notas: 'Gasto de oficina · '+notas+(comp?' · con comprobante':'')+(r.movimientoId?(' · Chunior N° '+r.movimientoId):' [CHUNIOR_OK_SIN_N]'),
          chunior_movimiento_id: r.movimientoId || null
        });
      }catch(_e){}
      window._gastoComprobante = null;
      try{ await cargarHistorial(); }catch(_e){}
      try{ await sincronizarBilleterasChunior(true); }catch(_e){}
      try{ renderBillerasInicio(); }catch(_e){}
      _watchdogTrigger(1500);
    } else {
      toast('⚠️ No se pudo anotar el gasto: '+((r&&r.error)||'sin detalle'),'red');
    }
  }, 'Anotar gasto');
};
window._gastoLeerImagenInput = function(inp){ if(inp && inp.files && inp.files[0]) _gastoLeerImagen(inp.files[0]); };
window.abrirModalAdminChunior = function(tipo){
  const esPropina = tipo==='propina';
  const titulo = esPropina ? '🎁 Anotar propina' : '💜 Depósito sin reclamar';
  const bilsConUid = (billeteras||[]).filter(function(b){ return b.CHUNIOR_UID; });
  if(!bilsConUid.length){ abrirModal(titulo, '<div class="err-box">No hay billeteras con UID de Chunior. Sincronizá billeteras primero.</div>', function(){ cerrarModal(); }, 'Entendido'); return; }
  const opts = bilsConUid.map(function(b){ return '<option value="'+escapeHtml(String(b.ID_BILLETERA))+'">'+escapeHtml(b.NOMBRE_VISIBLE||'—')+' · '+money(b.SALDO||0)+'</option>'; }).join('');
  const ayuda = esPropina
    ? 'Suma el monto a la billetera como propina (no descuenta fichas).'
    : 'Anota una transferencia que llegó sin usuario. Suma el monto a la billetera; después se puede reclamar convirtiéndola en fichas desde el propio movimiento en Chunior. Es una "carga en pausa".';
  const body =
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">'+ayuda+'</div>'
    + '<label>Billetera</label><select id="adminChuBil" style="width:100%">'+opts+'</select>'
    + '<label style="margin-top:8px;display:block">Monto'+(esPropina?'':' <span class="small" style="color:#8b949e;font-weight:400">· varios con + (ej: 10000+5000 → un depo POR transferencia, reclamables por separado)</span>')+'</label><input id="adminChuMonto" type="text" inputmode="decimal" placeholder="'+(esPropina?'Ej: 1500':'Ej: 10000+5000')+'" style="width:100%">'
    + '<label style="margin-top:8px;display:block">Notas</label><input id="adminChuNotas" type="text" placeholder="'+(esPropina?'Ej: propina turno tarde':'Ej: titular / referencia de la transferencia')+'" style="width:100%">';
  abrirModal(titulo, body, async function(){
    const bilId = document.getElementById('adminChuBil') ? document.getElementById('adminChuBil').value : '';
    const bil = billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); });
    const rawMonto = document.getElementById('adminChuMonto') ? document.getElementById('adminChuMonto').value : '';
    const notas = (document.getElementById('adminChuNotas') ? document.getElementById('adminChuNotas').value : '').trim();
    // MULTI-RENGLÓN (solo depos): "10000+5000" crea UN depo POR transferencia → cada uno se
    // reclama por separado (mata el rejunte en origen). Propina sigue siendo monto único.
    const montos = (esPropina ? [rawMonto] : String(rawMonto).split('+')).map(function(x){ return _adminChuParseMonto(x); }).filter(function(m){ return m>0; });
    if(!bil || !bil.CHUNIOR_UID){ toast('Elegí una billetera con Chunior.', 'red'); return; }
    if(!montos.length){ toast('Monto inválido.', 'red'); return; }
    cerrarModal();
    toast((esPropina?'🎁 Anotando propina':'💜 Anotando '+montos.length+' depósito(s)')+'...', 'blue');
    _wdLock();
    let okN=0, ultimoErr='';
    try{
      for(let mi=0; mi<montos.length; mi++){
        const monto = montos[mi];
        const notaI = notas + (montos.length>1?(' ('+(mi+1)+'/'+montos.length+')'):'');
        let r;
        try{
          r = esPropina ? await registrarPropinaEnChunior(bil.CHUNIOR_UID, monto, notaI)
                        : await registrarDepoSinReclamarEnChunior(bil.CHUNIOR_UID, monto, notaI);
        }catch(e){ r = { ok:false, error:e.message||'error' }; }
        if(r && r.ok){
          okN++;
          try{
            await registrarEnHistorial({
              usuario: notaI || (esPropina?'PROPINA':'DEPO S/RECLAMAR'),
              tipo: esPropina ? 'PROPINA' : 'DEPOSITO_SR',
              monto: monto, billetera_id: bil.ID_BILLETERA, billetera_nombre: bil.NOMBRE_VISIBLE,
              origen: 'ADMIN', estado:'OK',
              notas: (esPropina?'Propina':'Depósito sin reclamar')+(notaI?(' · '+notaI):'')+(r.movimientoId?(' · Chunior N° '+r.movimientoId):' [CHUNIOR_OK_SIN_N]'),
              chunior_movimiento_id: r.movimientoId || null
            });
          }catch(_e){}
        } else { ultimoErr=(r&&r.error)||'sin detalle'; break; }
      }
    } finally{ _wdUnlock(); }
    if(okN===montos.length){
      toast((esPropina?'🎁 Propina anotada':'💜 '+okN+' depósito(s) anotado(s)')+' en '+bil.NOMBRE_VISIBLE, 'green');
    } else {
      toast('⚠️ Se anotaron '+okN+'/'+montos.length+' · error: '+ultimoErr, 'red');
    }
    try{ await cargarHistorial(); }catch(_e){}
    try{ await sincronizarBilleterasChunior(true); }catch(_e){}
    try{ renderBillerasInicio(); }catch(_e){}
    _watchdogTrigger(1500);
  }, esPropina?'Anotar propina':'Anotar depósito');
};
// ── Editar un movimiento ya anotado ─────────────────────────────────────────
// Hasta acá un movimiento sólo se podía ANULAR (dejándole monto 0,10). Corregir un monto mal
// tipeado o una nota obligaba a hacerlo a mano en Chunior, y no quedaba rastro de que ese
// número había sido tocado. Dos reglas, las dos del lado del servidor (panel_mov_editar):
//   · sólo lo edita el MISMO operador que lo hizo;
//   · todo cambio queda con valor anterior, valor nuevo, quién y cuándo.
// El cambio se aplica PRIMERO en Chunior y recién después se guarda acá: si Chunior lo
// rechaza, NODO no queda diciendo un monto que allá nunca cambió.
window._CHUNIOR_URL_POR_TIPO = {
  CARGA:            'movimientoficha',
  RETIRO:           'movimientoficha',
  MOV_BILLETERA:    'movimientointerno',
  CAMBIO_BILLETERA: 'movimientointerno',
  PROPINA:          'propina',
  DEPOSITO_SR:      'depositossinreclamar',
  RECARGA_FICHAS:   'recargafichas'
};

async function _editarMovimientoChunior(tipoUrl, movId, cambios){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  if(!movId) return { ok:false, error:'Falta el N° de movimiento' };
  const changeUrl = CHUNIOR_BASE + '/transacciones/' + tipoUrl + '/' + encodeURIComponent(movId) + '/change/';
  try{ await window.chunior.navigate(changeUrl); }
  catch(e){ return { ok:false, error:'No se pudo abrir el movimiento en Chunior: '+(e.message||'') }; }

  const t0 = Date.now(); let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;});
    if(ready) break;
    await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready) return { ok:false, error:'El movimiento N° '+movId+' no abrió en Chunior (¿existe?)' };

  const setMonto = (cambios && cambios.monto != null)
    ? 'var m=document.getElementById("id_monto"); if(!m) return {ok:false,err:"sin campo monto"};'
      + 'm.value=' + JSON.stringify(String(cambios.monto)) + '; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));'
    : '';
  const setNotas = (cambios && cambios.notas != null)
    ? 'var n=document.getElementById("id_notas"); if(n){ n.value=' + JSON.stringify(String(cambios.notas)) + '; n.dispatchEvent(new Event("input",{bubbles:true})); n.dispatchEvent(new Event("change",{bubbles:true})); }'
    : '';

  let inj;
  try{
    inj = await window.chunior.exec(
      '(function(){' + setMonto + setNotas +
      'var b=document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");' +
      'if(!b) return {ok:false,err:"sin botón guardar"};' +
      'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return {ok:true};' +
      '})()'
    );
  }catch(e){ return { ok:false, error:e.message||'Error escribiendo en Chunior' }; }
  if(!inj || !inj.ok) return { ok:false, error:'No se pudo escribir: '+JSON.stringify(inj) };

  await new Promise(function(r){ setTimeout(r,2500); });
  const conf = await window.chunior.exec(
    '(function(){var li=document.querySelector("li.success"); if(li&&/modific/i.test(li.textContent||"")) return {ok:true, mensaje:(li.textContent||"").trim()};' +
    'var err=document.querySelector(".errorlist,.errornote"); if(err) return {ok:false, error:(err.textContent||"").trim().substring(0,200)};' +
    'if((location.href||"").indexOf("/change/")<0) return {ok:true, mensaje:"guardado"}; return {ok:false, error:"Chunior no confirmó el cambio"};})()'
  ).catch(function(){ return { ok:false, error:'No se pudo leer la confirmación de Chunior' }; });
  return conf || { ok:false, error:'Sin respuesta de Chunior' };
}

// Historial de cambios de ese mismo movimiento, para saber si ya fue tocado antes.
window.expedienteVerEdiciones = async function(historialId){
  const caja = document.getElementById('expEdiciones');
  if(caja) caja.innerHTML = '<div class="small" style="color:var(--muted)">Buscando cambios anteriores…</div>';
  let filas = [];
  try{
    const { data, error } = await supabaseClient.rpc('panel_mov_ediciones', { p_historial_id: Number(historialId) });
    if(error) throw error;
    filas = data || [];
  }catch(e){
    if(caja) caja.innerHTML = '<div class="small" style="color:#f87171">No se pudo leer el historial de cambios: '+escapeHtml(e.message||String(e))+'</div>';
    return;
  }
  if(!caja) return;
  if(!filas.length){
    caja.innerHTML = '<div class="small" style="color:var(--muted)">Este movimiento nunca se editó.</div>';
    return;
  }
  caja.innerHTML = filas.map(function(f){
    const cuando = f.created_at ? new Date(f.created_at).toLocaleString('es-AR') : '';
    const val = function(v){ return v == null || v === '' ? '—' : escapeHtml(String(v)); };
    return '<div style="border-left:2px solid #f59e0b;padding:4px 0 4px 8px;margin-bottom:6px;font-size:11px">'
      + '<b style="color:#fbbf24">' + escapeHtml(f.campo) + '</b> · ' + escapeHtml(f.operador||'') + ' · ' + escapeHtml(cuando)
      + (f.aplicado_en_chunior ? '' : ' <span style="color:#f87171">· NO se aplicó en Chunior</span>')
      + '<div style="color:#94a3b8">' + val(f.valor_anterior) + ' → <b style="color:#f1f5f9">' + val(f.valor_nuevo) + '</b></div>'
      + (f.error ? '<div style="color:#f87171">' + escapeHtml(f.error) + '</div>' : '')
      + '</div>';
  }).join('');
};

window.expedienteEditarMovimiento = async function(historialId){
  historialId = String(historialId||'').trim();
  if(!/^\d+$/.test(historialId)){ toast('Esta fila no tiene operación registrada.','yellow'); return; }

  const fila = ((typeof _historialData !== 'undefined' && _historialData) || [])
    .find(function(x){ return String(x.id) === historialId; });
  if(!fila){ toast('No tengo la operación cargada. Ampliá el período y probá de nuevo.','yellow'); return; }

  const opFila = String(fila.operador||'').trim();
  // Quién opera AHORA: el usuario logueado en Chunior en este momento, leído en vivo — igual que
  // hacen las billeteras. Antes esto era String(operador), y operador es un OBJETO: daba
  // "[object Object]", no coincidía con nadie, y bloqueaba la edición a todos, incluido el que
  // hizo el movimiento. Y como el mismo valor viajaba al servidor, allá también rebotaba.
  let opActual = '';
  try{
    if(typeof refrescarOperadorDesdeChunior === 'function')
      opActual = String((await refrescarOperadorDesdeChunior(true)) || '').trim();
  }catch(_e){}
  if(!opActual){
    try{ opActual = String((typeof operador !== 'undefined' && operador && (operador.usuario || operador.nombre)) || '').trim(); }catch(_e){}
  }
  // Aviso temprano y claro. La regla la aplica igual el servidor (panel_mov_editar).
  if(opFila && opActual && opFila.toLowerCase() !== opActual.toLowerCase()){
    toast('Este movimiento lo hizo '+opFila+'. Sólo esa cuenta puede editarlo.','orange');
    return;
  }

  const seg = window._CHUNIOR_URL_POR_TIPO[String(fila.tipo||'').toUpperCase()];
  const movId = fila.chunior_movimiento_id || '';

  abrirModal('✏️ Editar movimiento' + (movId ? ' N° '+movId : ''),
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">'
    + escapeHtml(String(fila.tipo||'')) + ' de <b>' + escapeHtml(String(fila.usuario||'')) + '</b>'
    + (movId ? '' : '<br><span style="color:#f59e0b">Sin N° de Chunior: se corrige sólo acá, allá no hay qué tocar.</span>')
    + (movId && !seg ? '<br><span style="color:#f59e0b">Este tipo no se edita en Chunior desde el panel: se corrige sólo acá.</span>' : '')
    + '</div>'
    + '<label>Monto</label>'
    + '<input id="edMovMonto" type="text" inputmode="decimal" autocomplete="off" value="' + escapeHtml(String(fila.monto != null ? fila.monto : '')) + '">'
    + '<label style="margin-top:8px">Nota</label>'
    + '<textarea id="edMovNotas" rows="3" style="width:100%;border-radius:10px;padding:10px;background:#0e1525;color:#fff;border:1px solid #2d3342;resize:vertical">'
    + escapeHtml(String(fila.notas||'')) + '</textarea>'
    + '<div style="margin-top:12px;border-top:1px solid #1e293b;padding-top:8px">'
    + '<div class="small" style="font-weight:700;color:#cbd5e1;margin-bottom:6px">Cambios anteriores</div>'
    + '<div id="expEdiciones"></div></div>',
    async function(){
      const montoTxt = String((document.getElementById('edMovMonto')||{}).value || '').trim().replace(/\./g,'').replace(',','.');
      const notas = String((document.getElementById('edMovNotas')||{}).value || '').trim();
      const montoNum = montoTxt === '' ? null : Number(montoTxt);
      if(montoNum !== null && !Number.isFinite(montoNum)){ toast('El monto no es un número.','red'); return; }

      const cambiaMonto = montoNum !== null && Number(montoNum) !== Number(fila.monto||0);
      const cambiaNotas = notas !== String(fila.notas||'');
      if(!cambiaMonto && !cambiaNotas){ toast('No cambiaste nada.','yellow'); return; }

      cerrarModal();

      // 1) Chunior primero. Si allá falla, no tocamos nada acá.
      let aplicado = false, errChu = null;
      if(movId && seg){
        toast('Aplicando el cambio en Chunior…','blue');
        _wdLock();
        let r;
        try{ r = await _editarMovimientoChunior(seg, movId, { monto: cambiaMonto ? montoNum : null, notas: cambiaNotas ? notas : null }); }
        catch(e){ r = { ok:false, error:e.message||'error' }; }
        finally{ _wdUnlock(); }
        aplicado = !!(r && r.ok);
        errChu = aplicado ? null : ((r && r.error) || 'sin detalle');
        if(!aplicado){
          toast('Chunior no aceptó el cambio: '+errChu+'. No se modificó nada.','red');
          return;
        }
      }

      // 2) Recién ahora se guarda de este lado, con el log.
      let res;
      try{
        const { data, error } = await supabaseClient.rpc('panel_mov_editar', {
          p_historial_id: Number(historialId),
          p_operador: opActual || opFila,
          p_monto: cambiaMonto ? montoNum : null,
          p_notas: cambiaNotas ? notas : null,
          p_pc: (typeof pcOperativa !== 'undefined' ? pcOperativa : null),
          p_aplicado_chunior: aplicado,
          p_error: errChu
        });
        if(error) throw error;
        res = data;
      }catch(e){
        toast('El cambio se aplicó en Chunior pero no se pudo guardar acá: '+(e.message||e),'red');
        return;
      }

      if(!res || res.ok !== true){
        const motivo = res && res.motivo;
        if(motivo === 'otro_operador'){
          toast('Lo hizo '+(res.operador_original||'otro operador')+'. Sólo esa cuenta puede editarlo.','orange');
        } else {
          toast('No se pudo guardar el cambio ('+(motivo||'sin detalle')+').','red');
        }
        return;
      }

      toast('✓ Movimiento actualizado'+(aplicado ? ' acá y en Chunior' : ' (sólo acá)')+'.','green');
      try{ await cargarHistorial(); }catch(_e){}
      try{ renderHistorialUnificado(); }catch(_e){}
    }, 'Guardar cambio');

  // Cargar el historial de cambios cuando el modal ya existe en pantalla.
  setTimeout(function(){ window.expedienteVerEdiciones(historialId); }, 60);
};

async function _anularMovimientoChunior(tipoUrl, movId){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  if(!movId) return { ok:false, error:'Falta el N° de movimiento de Chunior' };
  const changeUrl = CHUNIOR_BASE + '/transacciones/' + tipoUrl + '/' + encodeURIComponent(movId) + '/change/';
  try{ await window.chunior.navigate(changeUrl); }catch(e){ return { ok:false, error:'No se pudo navegar a Chunior: '+(e.message||'') }; }
  const t0 = Date.now(); let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;});
    if(ready) break; await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready) return { ok:false, error:'Formulario de Chunior no apareció (¿el movimiento existe?)' };
  let inj;
  try{
    inj = await window.chunior.exec(
      '(function(){' +
        'var m=document.getElementById("id_monto");' +
        'var b=document.querySelector("input[name=\'_save\']")||document.querySelector("input[name=\'_addanother\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");' +
        'if(!m||!b) return {ok:false,err:"campos faltantes",hasM:!!m,hasB:!!b};' +
        'm.value="0.1"; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
        'var snap={ok:true,val:m.value}; try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return snap;' +
      '})()'
    );
  }catch(e){ return { ok:false, error:e.message||'Error inyectando' }; }
  if(!inj || !inj.ok) return { ok:false, error:'Inyección falló: '+JSON.stringify(inj) };
  await new Promise(function(r){ setTimeout(r,2500); });
  const conf = await window.chunior.exec(
    '(function(){var li=document.querySelector("li.success"); if(li&&/modific/i.test(li.textContent||"")) return {ok:true, mensaje:(li.textContent||"").trim()};' +
    'var err=document.querySelector(".errorlist,.errornote"); if(err) return {ok:false, error:(err.textContent||"").trim().substring(0,200)};' +
    'if((location.href||"").indexOf("/change/")<0) return {ok:true, mensaje:"redirigió"}; return {ok:false, error:"Sin confirmación visible"};})()'
  ).catch(function(){ return { ok:false, error:'No se pudo leer confirmación' }; });
  return conf || { ok:false, error:'Sin respuesta' };
}
async function anularPropinaChunior(movId){ return _anularMovimientoChunior('propina', movId); }
// Deshacer = abrir el movimiento por su N° y dejarlo en 0,1. No se anota una contrapartida:
// Chunior deja EDITAR el movimiento, así que el original queda neutralizado y no aparece una
// segunda fila fantasma. El segmento de URL es el mismo que usa el /add/ de cada tipo.
async function anularTransferenciaChunior(movId){ return _anularMovimientoChunior('movimientointerno', movId); }
async function anularDepoSinReclamarChunior(movId){ return _anularMovimientoChunior('depositossinreclamar', movId); }
window.anularTransferenciaChunior = anularTransferenciaChunior;
window.anularDepoSinReclamarChunior = anularDepoSinReclamarChunior;
// Un solo punto de entrada para el botón Deshacer del historial.
window._CHUNIOR_ANULABLE = { MOV_BILLETERA:'movimientointerno', PROPINA:'propina', DEPO_SR:'depositossinreclamar' };
window.deshacerMovimientoChunior = async function(tipo, movId){
  const seg = window._CHUNIOR_ANULABLE[String(tipo||'').toUpperCase()];
  if(!seg) return { ok:false, error:'Ese tipo de movimiento no se puede deshacer desde acá' };
  return _anularMovimientoChunior(seg, movId);
};
// Deshacer sólo dentro del turno en curso: un turno no toca la plata de otro (regla del negocio).
// Pasado el cierre, el movimiento queda como está y se escala al superior.
window._movimientoEsDelTurno = function(fechaIso){
  try{
    if(!fechaIso) return false;
    const t = new Date(fechaIso).getTime();
    if(isNaN(t)) return false;
    return t >= _cotejoInicioTurnoMs();
  }catch(_e){ return false; }
};

// ── Depósitos sin reclamar + reclamo + anular propina (portado de NexoBetaChan 1.0.85) ──
// Todo por el BRIDGE de Chunior (window.chunior), sin escrituras nuevas a la DB salvo el
// update de historial_ops (que nuestro nodo ya hace directo — RLS permisiva en esa tabla).
// poder verlos y reclamarlos. Reclamar = convertir en fichas en Chunior + acreditar al
// usuario en Agentes (SIN anotar una carga nueva en Chunior: el depo ya es el registro).
window.verDepositosSinReclamar = async function(){
  if(!window.chunior){ toast('Ventana de Chunior no disponible','red'); return; }
  abrirModal('💜 Depósitos sin reclamar', '<div class="small" style="padding:14px;color:var(--muted)">Leyendo de Chunior…</div>', null, '');
  try{ const b=document.getElementById('modalSaveBtn'); if(b) b.style.display='none'; }catch(_e){}
  const body = document.getElementById('modalBody');
  try{
    await window.chunior.navigate(CHUNIOR_BASE + '/transacciones/depositossinreclamar/');
    const t0=Date.now(); let listo=false;
    while(Date.now()-t0<10000){ listo=await window.chunior.exec('(function(){return !!(document.getElementById("result_list")||document.querySelector(".paginator,#changelist"));})()').catch(function(){return false;}); if(listo)break; await new Promise(function(r){ setTimeout(r,300); }); }
    if(!listo){ if(body) body.innerHTML='<div class="err-box" style="padding:12px">La lista de Chunior no cargó. Reintentá.</div>'; return; }
    // Leemos CADA celda con su clase y texto (no el textContent junto, que quedaba amontonado).
    const filas = await window.chunior.exec(
      '(function(){var out=[];var trs=document.querySelectorAll("#result_list tbody tr");' +
      'for(var i=0;i<trs.length&&i<120;i++){var tr=trs[i];' +
      ' var a=tr.querySelector("th a[href],td a[href]"); var id=null; if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) id=mh[1];}' +
      ' var tds=tr.querySelectorAll("th,td"); var cells=[];' +
      ' for(var j=0;j<tds.length;j++){ cells.push({c:(tds[j].className||""), t:(tds[j].textContent||"").replace(/\\s+/g," ").trim()}); }' +
      ' out.push({id:id, cells:cells});' +
      '}return out;})()'
    ).catch(function(){ return []; });
    if(!Array.isArray(filas) || !filas.length){ if(body) body.innerHTML='<div class="alert-box" style="padding:12px">No hay depósitos sin reclamar.</div>'; return; }

    // Extrae un campo: primero por clase de la celda, si no por patrón del texto.
    function pick(cells, clsRe, txtRe){
      let c = cells.find(function(x){ return clsRe.test(x.c); });
      if(c && c.t) return c.t;
      if(txtRe){ c = cells.find(function(x){ return txtRe.test(x.t); }); if(c) return c.t; }
      return '';
    }
    const rows = filas.map(function(f){
      const cells = f.cells||[];
      const creacion = pick(cells, /creation|fecha|creado|date/i, /\d{2}[-/]\d{2}[-/]\d{4}/);
      const monto    = pick(cells, /monto|money|importe/i, /\$/);
      const billetera= pick(cells, /cuenta|billetera|destino|wallet/i, /^\s*\d+\s*[-·]/);
      const notas    = pick(cells, /nota/i, null);
      const operador = pick(cells, /operador|user|usuario|creado_por/i, null);
      // Separar día y hora de "10-07-2026 10:39:29"
      const mFecha = String(creacion||'').match(/(\d{2}[-/]\d{2}[-/]\d{4})\s*(\d{2}:\d{2}(?::\d{2})?)?/);
      const dia  = mFecha ? mFecha[1] : creacion;
      const hora = mFecha && mFecha[2] ? mFecha[2] : '';
      const detalle = [notas, operador].filter(function(v){ return v && !/^\s*\d/.test(v); }).join(' · ');
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 13px;border-radius:11px;background:#161b22;border:1px solid #30363d;border-left:3px solid #a78bfa;margin-top:9px">'
        + '<div style="min-width:0;flex:1">'
        +   '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">'
        +     '<span style="font-size:17px;font-weight:900;color:#c4b5fd">'+escapeHtml(monto||'—')+'</span>'
        +     (billetera?'<span style="font-size:12px;font-weight:700;color:#e6edf3">'+escapeHtml(billetera)+'</span>':'')
        +   '</div>'
        +   '<div style="margin-top:4px;font-size:12px;color:#8b949e;display:flex;gap:12px;flex-wrap:wrap">'
        +     (dia?'<span>📅 <b style="color:#c9d1d9">'+escapeHtml(dia)+'</b></span>':'')
        +     (hora?'<span>🕐 <b style="color:#c9d1d9">'+escapeHtml(hora)+'</b></span>':'')
        +   '</div>'
        +   (detalle?'<div style="margin-top:3px;font-size:12px;color:#c9d1d9">📝 '+escapeHtml(detalle)+'</div>':'')
        + '</div>'
        + (f.id?('<button class="mini-btn green" style="font-size:12px;white-space:nowrap;padding:8px 12px" onclick="reclamarDepo(\''+escapeHtml(f.id)+'\',\''+escapeHtml(String(monto||''))+'\',\''+escapeHtml(String(billetera||''))+'\')">✅ Reclamar</button>'):'')
        + '</div>';
    }).join('');
    if(body) body.innerHTML = '<div style="max-height:62vh;overflow:auto;padding-right:4px">'
      + '<div class="small" style="color:#8b949e;margin-bottom:2px">'+filas.length+' depósito(s) sin reclamar en Chunior · el monto se suma a la billetera, se reclama convirtiéndolo en fichas.</div>'
      + rows + '</div>';
  }catch(e){ if(body) body.innerHTML='<div class="err-box" style="padding:12px">Error: '+escapeHtml(e.message||String(e))+'</div>'; }
};

// Reclamar un depo — TOTAL o PARCIAL.
// TOTAL: convierte en fichas en Chunior y acredita en Agentes (flujo original, sin carga nueva).
// PARCIAL (ej. depo de $15 rejuntado, el usuario reclama $10): REDUCE el depo en Chunior al resto
// (con nota automática) + ANOTA la carga del jugador en Chunior por lo reclamado (así el saldo de
// la billetera queda neto 0 y la carga tiene su N° propio) + acredita en Agentes. El resto queda
// reclamable por separado (se acabó el "no se puede reclamar porque vino junto").
window.reclamarDepo = function(movId, montoTxt, billeteraTxt){
  const monto = _adminChuParseMonto(montoTxt);
  const uidBil = (String(billeteraTxt||'').match(/^\s*(\d+)/)||[])[1] || '';
  abrirModal('✅ Reclamar depósito N° '+escapeHtml(String(movId)),
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Depósito de <b>'+money(monto)+'</b>. Si reclamás MENOS, el depo se reduce al resto (queda reclamable) y lo reclamado se anota como carga del usuario.</div>'
    + '<label>Usuario que reclama</label><input id="reclamoUsuario" placeholder="Ej: juan777" style="width:100%">'
    + '<label style="margin-top:6px">Monto a reclamar</label><input id="reclamoMonto" type="text" inputmode="numeric" autocomplete="off" value="'+window._cotejoFmtMiles(monto)+'" oninput="this.value=window._cotejoFmtMiles(this.value)" style="width:100%;text-align:right;font-weight:800">',
    async function(){
      const usuario = (document.getElementById('reclamoUsuario')?.value||'').trim();
      const reclamo = Math.abs(Number(String(document.getElementById('reclamoMonto')?.value||'').replace(/[^\d]/g,''))||0);
      if(!usuario || usuario.length<3){ toast('Ingresá el usuario.','red'); return; }
      if(!monto || monto<=0){ toast('El depósito no tiene monto válido.','red'); return; }
      if(!reclamo || reclamo>monto){ toast('El monto a reclamar debe ser mayor a 0 y hasta '+money(monto)+'.','red'); return; }
      const esParcial = reclamo < monto;
      if(esParcial && !uidBil){ toast('No pude leer la billetera del depo (necesaria para el parcial). Reclamalo completo o hacelo a mano.','red'); return; }
      cerrarModal();
      if(!_drexGlobalLock('reclamar-depo')){ toast('Hay otra operación en curso. Esperá.','yellow'); return; }
      _wdLock();
      _trazaInit('Reclamar depo N° '+movId+' · '+usuario+' · '+money(reclamo)+(esParcial?(' de '+money(monto)+' (PARCIAL)'):''));
      let _movChuNuevo = null;
      try{
        if(esParcial){
          // 1a) PARCIAL: reducir el depo al resto (con nota del reclamo) — el resto queda reclamable
          const resto = monto - reclamo;
          _trazaPaso('Reduciendo depo a '+money(resto)+' (parcial)…');
          const notaRed = 'reclamado '+money(reclamo)+' por '+usuario+' · quedan '+money(resto)+' · nodo '+new Date().toLocaleString('es-AR');
          const rr = await window._reducirDepoChunior(movId, resto, notaRed);
          if(!rr || !rr.ok){ _trazaPaso('No se pudo reducir el depo: '+((rr&&rr.error)||''),'err'); _trazaFin('err'); toast('No se pudo reducir el depo en Chunior.','red'); return; }
          _trazaPaso('Depo reducido · quedan '+money(resto),'ok');
          // 1b) Anotar la CARGA del jugador en Chunior por lo reclamado (así la billetera queda
          //     neta 0: −reclamo del depo, +reclamo de la carga) y la carga tiene su N° propio.
          _trazaPaso('Anotando carga de '+money(reclamo)+' en Chunior…');
          const rChu = await registrarCargaEnChunior(uidBil, reclamo, usuario);
          if(rChu && rChu.ok){ _movChuNuevo = rChu.movimientoId || null; _trazaPaso('Carga anotada'+(_movChuNuevo?(' · N° '+_movChuNuevo):''),'ok'); }
          else { _trazaPaso('⚠ Carga NO anotada en Chunior ('+((rChu&&rChu.error)||'')+') — anotala a mano','err'); }
        } else {
          // 1) TOTAL: convertir en fichas en Chunior (botón _convertir_fichas del movimiento)
          _trazaPaso('Convirtiendo en fichas en Chunior…');
          await window.chunior.navigate(CHUNIOR_BASE + '/transacciones/depositossinreclamar/' + encodeURIComponent(movId) + '/change/');
          const t0=Date.now(); let ready=false;
          while(Date.now()-t0<10000){ ready=await window.chunior.exec('(function(){return !!document.querySelector("input[name=\'_convertir_fichas\']");})()').catch(function(){return false;}); if(ready)break; await new Promise(function(r){ setTimeout(r,300); }); }
          if(!ready){ _trazaPaso('No apareció el botón "Convertir en fichas"','err'); _trazaFin('err'); toast('No se encontró "Convertir en fichas" en Chunior.','red'); return; }
          const conv = await window.chunior.exec('(function(){var b=document.querySelector("input[name=\'_convertir_fichas\']"); if(!b) return {ok:false}; try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return {ok:true};})()').catch(function(){return {ok:false};});
          if(!conv || !conv.ok){ _trazaPaso('No se pudo clickear convertir','err'); _trazaFin('err'); toast('No se pudo convertir en fichas.','red'); return; }
          await new Promise(function(r){ setTimeout(r,2000); });
          _trazaPaso('Convertido en fichas en Chunior','ok');
        }
        // 2) Acreditar al usuario en Agentes
        _trazaPaso('Acreditando '+money(reclamo)+' a '+usuario+' en Agentes…');
        if(!await ensureDrexSession()){ _trazaPaso('Falta sesión de Agentes','err'); _trazaFin('err'); toast('Sesión de Agentes requerida.','red'); return; }
        const bb = await callDrex('buscarUsuario', usuario, { skipBalance:true });
        if(!bb || !bb.exists){ _trazaPaso(usuario+' no existe en Agentes','err'); _trazaFin('err'); toast('Usuario no encontrado en Agentes.','red'); return; }
        const rc = await callDrex('cargarSaldo', reclamo);
        const okC = rc && rc.ok !== false;
        await registrarEnHistorial({
          usuario, tipo:'CARGA', monto:reclamo,
          billetera_id:null, billetera_nombre:null, origen:'DEPO_RECLAMADO',
          estado: okC?'OK':'ERROR',
          notas: esParcial
            ? ('Reclamo PARCIAL de depo N° '+movId+' · reclamado '+money(reclamo)+' de '+money(monto)+' · quedan '+money(monto-reclamo))
            : ('Reclamo de depósito sin reclamar N° '+movId+' (convertido en fichas) · '+money(reclamo)),
          chunior_movimiento_id: String(_movChuNuevo || movId),
          saldo_post:(typeof rc?.newBalance?.value==='number'?rc.newBalance.value:null)
        });
        if(okC){ _trazaPaso('Acreditado a '+usuario,'ok'); _trazaFin('ok'); toast('✅ Depósito reclamado y acreditado a '+usuario,'green'); }
        else{ _trazaPaso('No se pudo acreditar en Agentes','err'); _trazaFin('err'); toast('⚠️ Convertido en Chunior pero falló la carga en Agentes — cargalo a mano.','red'); }
        try{ await cargarHistorial(); }catch(_e){}
        try{ await sincronizarBilleterasChunior(true); }catch(_e){}
      }catch(e){ _trazaPaso('Error: '+(e.message||''),'err'); _trazaFin('err'); toast('Error al reclamar: '+(e.message||''),'red'); }
      finally{ _wdUnlock(); _drexGlobalUnlock(); }
    }, 'Reclamar y acreditar');
};

window.anularPropinaHistorial = async function(historialId){
  const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
  if(!h){ toast('No se encontró el movimiento.', 'red'); return; }
  if(String(h.tipo).toUpperCase()!=='PROPINA'){ toast('Solo se pueden anular propinas por ahora.', 'yellow'); return; }
  if(!h.chunior_movimiento_id){ toast('Esta propina no tiene N° de Chunior — anulala a mano.', 'yellow'); return; }
  if(!confirm('¿Anular la propina de '+money(h.monto||0)+' (Mov. N° '+h.chunior_movimiento_id+')?\n\nSe le pone el monto en 0,10 en Chunior (así se anulan los movimientos). No se puede deshacer automáticamente.')) return;
  if(!_drexGlobalLock('anular-propina')){ toast('Hay otra operación en curso. Esperá.', 'yellow'); return; }
  _wdLock();
  toast('Anulando propina N° '+h.chunior_movimiento_id+'...', 'blue');
  try{
    const r = await anularPropinaChunior(h.chunior_movimiento_id);
    if(r && r.ok){
      try{ await ajustarSaldoBilletera(h.billetera_id, -Math.abs(Number(h.monto||0))); }catch(_e){} // revierte el monto sumado
      try{
        await supabaseClient.from('historial_ops').update({
          estado:'ANULADA',
          notas: (String(h.notas||'').trim()+' [ANULADA monto→0,10]').trim()
        }).eq('id', h.id);
      }catch(_e){}
      toast('✅ Propina anulada (monto→0,10).', 'green');
      try{ await cargarHistorial(); }catch(_e){}
      try{ renderBillerasInicio(); }catch(_e){}
    }else{
      toast('⚠️ No se pudo anular: '+((r&&r.error)||'sin detalle'), 'red');
    }
  }catch(e){ toast('Error al anular: '+(e.message||''), 'red'); }
  finally{ _wdUnlock(); _drexGlobalUnlock(); }
};


// ── Verificar saldo de un retiro pendiente en OCIO (portado de NexoBetaChan · versión SEGURA) ──
// Cuando NO hay ninguna operación en curso, lee el saldo del usuario de UN retiro pendiente y lo
// muestra (badge en la solicitud + toast). NO auto-rechaza (esa decisión de plata la toma el
// operador). Re-chequea cada usuario máx. cada 5 min. Se desactiva con localStorage 'nodo_saldo_ocioso_off'.
window._retiroSaldoCheck = window._retiroSaldoCheck || {};
// Destrabar agente (portado de NexoBetaChan): salida de emergencia si un flujo dejó el candado
// tomado (ej. buscarUsuario colgado). Libera el lock global + watchdog + flags de parcial/scanner.
// DESTRABAR DE VERDAD. Antes soltaba cuatro cosas y dejaba tomadas otras cuatro — entre ellas el
// guard del portal, que es el que contesta "hay una operación en curso". Por eso se apretaba
// Destrabar, decía "destrabado", y el panel seguía sin dejar operar. Ahora se sueltan TODOS los
// candados: si el operador pide destrabar, es porque ya no hay nada corriendo.
window.liberarLockAgentes = function(){
  const m = window._drexGlobalBusyMotivo || (window._drexCola && window._drexCola.activo && window._drexCola.activo.nombre);
  try{ if(typeof _drexGlobalUnlock==='function') _drexGlobalUnlock(); }catch(_e){}
  try{ if(typeof _wdForceUnlock==='function') _wdForceUnlock(); }catch(_e){}
  try{ window._v154pParcialBusy = false; }catch(_e){}
  try{ window._retiroSaldoLastRun = 0; }catch(_e){}
  // Los que faltaban:
  try{ window._portalSolicitudOperacionEnCurso = false; }catch(_e){}   // el que decía "operación portal en curso"
  try{ window._operacionManualEnCurso = false; }catch(_e){}
  try{ window._cotejoDeclarando = false; }catch(_e){}
  try{ window._drexSinSesion = false; }catch(_e){}                     // el cortacircuitos de sesión
  try{ if(window._drexCola){ window._drexCola.activo = null; window._drexCola.pendientes = 0; } }catch(_e){}
  try{ document.body.classList.remove('op-portal-en-curso'); delete document.body.dataset.opSolicitud; }catch(_e){}
  try{ if(typeof _wdUnlock==='function'){ let g=0; while(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0 && g++<20) _wdUnlock(); } }catch(_e){}
  try{ _agentesBadgePintar(); }catch(_e){}
  try{ toast('🔓 Agente destrabado'+(m?(' · lo tenía: '+m):'')+'. Ya podés reintentar.', 'green'); }catch(_e){}
  console.log('[lock] destrabado a mano · todos los candados liberados');
};
// Reiniciar Chunior cuando muestra 403/CSRF. Recargar NO sirve (re-envía el POST fallido → mismo
// 403); esto NAVEGA a la base (GET) → token CSRF fresco. hard=true limpia las cookies de Chunior
// (NO Supabase) y fuerza un login nuevo.
window.reiniciarChunior = async function(hard){
  if(!window.chunior || !window.chunior.reset){ try{ toast('Solo disponible en la app de escritorio.','yellow'); }catch(_e){} return; }
  try{ toast(hard?'🧹 Reiniciando Chunior con login limpio…':'🔄 Recuperando Chunior…','blue'); }catch(_e){}
  try{
    await window.chunior.reset(hard?{hard:true}:undefined);
    try{ if(window.chunior.focus) window.chunior.focus(); }catch(_e){}
    try{ toast('✅ Chunior recargado desde la base. Si pide login, ingresá de nuevo.','green'); }catch(_e){}
  }catch(e){ try{ toast('No se pudo reiniciar Chunior: '+(e.message||e),'red'); }catch(_e){} }
};
async function verificarSaldoRetiroOcioso(){
  try{
    try{ if(localStorage.getItem('nodo_saldo_ocioso_off')==='1') return; }catch(_e){}
    if(window._drexGlobalBusy) return; // candado maestro: cualquier operación lo toma
    if(typeof _loteEnCurso!=='undefined' && _loteEnCurso) return;
    if(typeof _operacionManualEnCurso!=='undefined' && _operacionManualEnCurso) return;
    if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return;
    if(window._v154pParcialBusy) return;
    if(typeof colaPendientesAll==='function' && colaPendientesAll().length>0) return;
    if(!window.ctrlElectron) return;
    // Cooldown global: como mucho UNA verificación cada 4 min. Sin esto, con varios retiros abiertos el
    // scanner entraba a Agentes una y otra vez (bucle) y dejaba el agente ocupado → el panel no operaba.
    if(window._retiroSaldoLastRun && (Date.now()-window._retiroSaldoLastRun) < 4*60*1000) return;
    const _MAX_EDAD_MS = 2*60*60*1000; // solo auto-escaneamos retiros RECIENTES (últimas 2 h); los viejos los maneja el operador
    window._retiroSaldoDone = window._retiroSaldoDone || {};
    const pend = ((window.V154P&&window.V154P.solicitudes)||[]).filter(function(s){
      const tipo = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase();
      if(tipo!=='RETIRO') return false;
      if(window._estadoYaCerrado && window._estadoYaCerrado(s.ESTADO)) return false;
      // Retiro YA en curso / parcial en progreso → lo maneja el operador; NO re-escanear
      // (si no, mientras un parcial queda EN_PROCESO el scanner re-entraba al agente y lo trababa).
      if(/EN_PROCESO|EN_REVISION|PROCESANDO|TOMAD/.test(String(s.ESTADO||'').toUpperCase())) return false;
      // Con CUALQUIER pago parcial hecho, el retiro NO se auto-rechaza: la plata ya salió y el
      // usuario está esperando el resto. Se miran TODAS las claves donde puede quedar el progreso
      // (retiro_parcial / retiro_progreso / progreso / monto_pagado suelto): mirando solo una,
      // un retiro con 250k ya pagados terminó AUTO_RECHAZADO.
      try{
        const m=(typeof s.METADATA==='object'?s.METADATA:JSON.parse(s.METADATA||'{}'))||{};
        const _rp = m.retiro_parcial || m.retiro_progreso || m.progreso || {};
        const _pag = Number(_rp.pagado!=null ? _rp.pagado
                          : (_rp.acumulado!=null ? _rp.acumulado
                          : (m.monto_pagado!=null ? m.monto_pagado
                          : (m.pagado_parcial!=null ? m.pagado_parcial : 0)))) || 0;
        if(_pag > 0) return false;
      }catch(_e){}
      return true;
    });
    const objetivo = pend.find(function(s){
      const sid = String(s.ID||s.SOLICITUD_ID||s.ID_SOLICITUD||'');
      const u = String(s.USUARIO||'').toLowerCase();
      if(!u || !sid) return false;
      const fc = Date.parse(s.FECHA_CREACION||s.created_at||s.FECHA||'') || 0;
      if(fc && (Date.now()-fc) > _MAX_EDAD_MS) return false;        // retiro VIEJO → no auto-escanear (corta el bucle)
      const d = window._retiroSaldoDone[sid];
      if(d && d.confiable) return false;                           // ya verificado BIEN → una sola vez, nunca más
      if(d && d.intentos>=3) return false;                         // 3 lecturas fallidas → basta, lo ve el operador
      if(d && (Date.now()-d.ts) < 5*60*1000) return false;         // espaciar reintentos de lecturas fallidas
      return true;
    });
    if(!objetivo) return;
    const usuario = String(objetivo.USUARIO||'');
    const sid = String(objetivo.ID||objetivo.SOLICITUD_ID||objetivo.ID_SOLICITUD||'');
    const monto = Math.abs(Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0));
    if(!_drexGlobalLock('retiro-saldo-check')) return;
    window._retiroSaldoLastRun = Date.now();
    // Registrar el intento YA (aunque la lectura falle) para no reintentar en bucle.
    { const _p = window._retiroSaldoDone[sid] || {intentos:0}; window._retiroSaldoDone[sid] = {confiable:false, intentos:_p.intentos+1, ts:Date.now()}; }
    _wdLock();
    try{
      const b = await callDrex('buscarUsuario', usuario, { skipBalance:false });
      if(b && b.exists && typeof b.balance?.value === 'number'){
        const saldo = b.balance.value;
        const saldoConfiable = /\d/.test(String(b.balance.raw||'')) && Number.isFinite(saldo); // se leyó DE VERDAD (no un 0 por lectura fallida/lenta)
        const suficiente = saldo + 0.5 >= monto;
        window._retiroSaldoCheck[usuario.toLowerCase()] = { saldo:saldo, monto:monto, suficiente:suficiente, confiable:saldoConfiable, ts:Date.now(), raw:(b.balance.raw||'').trim() };
        try{ if(window._retiroSaldoDone && window._retiroSaldoDone[sid]) window._retiroSaldoDone[sid].confiable = saldoConfiable; }catch(_e){} // lectura confiable → no re-escanear este retiro
        try{ if(typeof window.v154pRenderSolicitudesPortalEnInicio==='function') window.v154pRenderSolicitudesPortalEnInicio(); }catch(_e){}
        // Auto-rechazo ANTI-FRAUDE — SOLO el caso INEQUÍVOCO: el usuario NO tiene fichas (saldo ~0).
        // ⚠ Antes rechazábamos con "saldo < $5.000 y < monto": eso rechazaba a un usuario que SÍ tenía
        // fichas (ej. 4.000 fichas pidiendo 50.000) tratándolo como falso. MAL: si tiene ALGUNAS fichas,
        // corresponde un retiro PARCIAL, no un rechazo. Ahora solo se rechaza si está prácticamente
        // vacío (< _PISO_SIN_FICHAS) y ADEMÁS lo confirmamos con una 2ª lectura independiente (descarta
        // el 0 transitorio por proxy lento). Con fichas reales ⇒ NUNCA se auto-rechaza.
        const _PISO_SIN_FICHAS = 500; // por debajo de esto no hay fichas reales ni para un parcial
        if(saldoConfiable && saldo < _PISO_SIN_FICHAS && saldo < monto){
          // 2ª lectura de confirmación: re-entra a Agentes y vuelve a leer. Solo rechazamos si TAMBIÉN
          // la ve casi vacía. Si la 2ª no confirma (o no se pudo leer), NO se rechaza.
          let confirmado = false, saldo2 = saldo, raw2 = (b.balance.raw||'').trim();
          try{
            const b2 = await callDrex('buscarUsuario', usuario, { skipBalance:false });
            if(b2 && b2.exists && typeof b2.balance?.value === 'number' && /\d/.test(String(b2.balance.raw||''))){
              saldo2 = b2.balance.value; raw2 = (b2.balance.raw||'').trim();
              confirmado = Number.isFinite(saldo2) && saldo2 < _PISO_SIN_FICHAS;
            }
          }catch(_e){ confirmado = false; }
          if(confirmado){
            const sid = objetivo.ID || objetivo.SOLICITUD_ID || objetivo.ID_SOLICITUD;
            const _saldoTxt = (raw2||money(saldo2)).trim();
            try{
              await window.actualizarSolicitudPortal(sid, 'RECHAZADA', {
                etapa: 'AUTO_RECHAZO_SIN_SALDO',
                motivo: 'Sin fichas para retirar (saldo '+_saldoTxt+', confirmado x2)'
              });
              // Al historial. Antes esto sólo salía como toast: se veía tres segundos y se perdía,
              // y después no había forma de saber por qué se le habia rechazado el retiro a alguien.
              try{ await registrarEnHistorial({
                usuario: usuario, tipo:'RETIRO', monto: Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0),
                origen:'AUTO', estado:'RECHAZADA', solicitud_id: sid,
                // Con TODO el detalle: qué pidió, qué tenía, cómo se leyó, y qué se le dijo. Un
                // "rechazado" a secas obliga a reconstruir el caso de memoria cuando el cliente
                // reclama tres días después.
                notas:'AUTO-RECHAZO · SIN FICHAS'
                  + ' · pidió '+money(Number(objetivo.MONTO_REAL||objetivo.MONTO_DECLARADO||0))
                  + ' · saldo leído '+_saldoTxt+' (2 lecturas: "'+((b.balance&&b.balance.raw)||'').trim()+'" y "'+raw2+'")'
                  + ' · piso '+money(_PISO_SIN_FICHAS)
                  + (objetivo.TITULAR?(' · titular declarado: '+objetivo.TITULAR):'')
                  + ' · se le avisó por el chat'
              }); }catch(_e){}
              try{ await notificarUsuarioEnChat(usuario, '❌ No pudimos procesar tu retiro: no figurás con fichas disponibles para retirar. Si creés que es un error, escribinos por acá.'); }catch(_e){}
              toast('❌ Retiro de '+usuario+' rechazado · SIN fichas (saldo '+_saldoTxt+', confirmado x2)', 'red');
            }catch(_e){}
          } else {
            toast('⚠ '+usuario+': 1ª lectura casi vacía ('+ (b.balance.raw||'').trim() +') NO confirmada en 2ª ('+raw2+') · NO auto-rechazo', 'yellow');
          }
        } else if(!saldoConfiable){
          toast('⚠ No pude leer bien el saldo de '+usuario+' — NO auto-rechazo. Revisalo a mano.', 'yellow');
        } else {
          toast((suficiente?'✓':'⚠')+' Retiro '+usuario+': saldo '+(b.balance.raw||money(saldo)).trim()+(suficiente?' (alcanza)':' · tiene fichas pero menos que lo pedido → retiro PARCIAL'), suficiente?'blue':'red');
        }
      }
    }catch(_e){}
    finally{ _wdUnlock(); _drexGlobalUnlock(); }
  }catch(_e){}
}
window.verificarSaldoRetiroOcioso = verificarSaldoRetiroOcioso;
// Trigger conservador cada 90s (gated por TODOS los guards + 5 min por usuario).
try{ setInterval(function(){ try{ verificarSaldoRetiroOcioso(); }catch(_e){} }, 90000); }catch(_e){}

function abrirModalTransferirBilleteras(){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  const bilsConUid = billeteras.filter(function(b){ return b.CHUNIOR_UID && normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA'; });
  if(!bilsConUid.length){
    abrirModal('🔀 Transferir entre billeteras',
      '<div class="err-box">No hay billeteras con UID de Chunior. Sincronizá primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  function buildOpts(){
    return bilsConUid.map(function(b){
      return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '">' +
             escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
             '</option>';
    }).join('');
  }

  abrirModal(
    '🔀 Transferir entre billeteras',
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Mover fichas de una billetera a otra (útil para corregir cargas que quedaron en la billetera ERROR).</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">BILLETERA ORIGEN (sale plata)</label>' +
    '<select id="transferOrigen"><option value="">— Elegí origen —</option>' + buildOpts() + '</select>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">BILLETERA DESTINO (entra plata)</label>' +
    '<select id="transferDestino"><option value="">— Elegí destino —</option>' + buildOpts() + '</select>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">MONTO</label>' +
    '<input id="transferMonto" type="number" placeholder="ej: 5000" style="margin-bottom:6px">' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NOTAS (opcional)</label>' +
    '<textarea id="transferNotas" rows="2" placeholder="Ej: corrección de carga al usuario juan777"></textarea>' +
    '<div id="transferRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const origenId  = document.getElementById("transferOrigen")?.value;
      const destinoId = document.getElementById("transferDestino")?.value;
      const monto     = Number(document.getElementById("transferMonto")?.value || 0);
      const notas     = (document.getElementById("transferNotas")?.value || "").trim();
      const resEl     = document.getElementById("transferRes");
      const btn       = document.getElementById("modalSaveBtn");

      if(!origenId || !destinoId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Elegí origen y destino.</span>'; return;
      }
      if(origenId === destinoId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Origen y destino no pueden ser la misma billetera.</span>'; return;
      }
      if(!monto || monto <= 0){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Monto inválido.</span>'; return;
      }

      const bilOrigen  = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(origenId); });
      const bilDestino = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(destinoId); });
      if(!bilOrigen?.CHUNIOR_UID || !bilDestino?.CHUNIOR_UID){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Alguna billetera no tiene UID de Chunior.</span>'; return;
      }

      if(btn){ btn.disabled = true; btn.textContent = "Transfiriendo..."; }
      if(resEl) resEl.innerHTML = '<span class="small">Aplicando en Chunior...</span>';

      try {
        const r = await _transferirEntreBilleterasChunior(bilOrigen.CHUNIOR_UID, bilDestino.CHUNIOR_UID, monto, notas);
        if(r.ok){
          // Los saldos NO se tocan a mano: Chunior es la fuente de verdad y los repinta al
          // sincronizar. (Antes había acá dos llamadas a ajustarSaldoBilletera que no hacían
          // nada — la función está inerte desde que se sacó el contador paralelo.)

          // ASIENTO. Esto faltaba: la plata se movía en Chunior y de este lado no quedaba
          // rastro de quién la movió, entre qué billeteras ni por qué. Mismo formato que
          // tenían los MOV_BILLETERA del 8/8 ("ORIGEN → DESTINO"), más el N° de Chunior.
          // Va en try: si falla el registro, la transferencia ya se hizo y no se toca.
          try{
            await registrarEnHistorial({
              usuario: 'MOV BILLETERA',
              tipo: 'MOV_BILLETERA',
              monto: monto,
              billetera_id: bilOrigen.ID_BILLETERA || null,       // de dónde salió
              billetera_nombre: (bilOrigen.NOMBRE_VISIBLE||'?') + ' → ' + (bilDestino.NOMBRE_VISIBLE||'?'),
              origen: 'MANUAL',
              estado: 'OK',
              notas: 'Transferencia entre billeteras'
                     + (notas ? (' · ' + notas) : '')
                     + (bilDestino.ID_BILLETERA ? (' · destino_id=' + bilDestino.ID_BILLETERA) : '')
                     + (r.movimientoId ? (' · Chunior N° ' + r.movimientoId) : ' [SIN_N_CHUNIOR]'),
              chunior_movimiento_id: r.movimientoId || null
            });
          }catch(eHist){ console.warn('registrar MOV_BILLETERA:', eHist); }

          toast("✅ Transferencia OK · " + money(monto) + " · " + bilOrigen.NOMBRE_VISIBLE + " → " + bilDestino.NOMBRE_VISIBLE, "green");
          cerrarModal();
          renderBillerasInicio();
        } else {
          if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(r.error || 'Error') + '</div>';
          if(btn){ btn.disabled = false; btn.textContent = "Transferir"; }
        }
      } catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'sin detalle') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Transferir"; }
      }
    },
    'Transferir'
  );
}

// Modal NODO para cambiar la billetera de un movimiento ya registrado.
// El operador NUNCA ve Chunior — toda la maniobra se hace en background.

// ── Asiento del cambio de billetera ──────────────────────────────────────────
// Cambiar billetera SOBRESCRIBE: en Chunior pisa la cuenta destino del mismo N° de
// movimiento, y acá hace un update sobre historial_ops. La billetera anterior se perdía
// para siempre — no quedaba desde cuál se cambió, ni quién, ni cuándo.
//
// Esta función NO cambia nada de eso: solo deja el asiento aparte, antes de pisar.
// El update sigue igual. Va en try porque un fallo del registro nunca debe frenar una
// corrección que el operador necesita hacer.
// Corrige, en la solicitud, de DÓNDE salió la plata de ese pago.
// Cada pago de un retiro guarda el titular de la billetera que pagó: es el "te transfirió X" que ve
// el jugador en el portal y el dato con el que se cotea la cuenta. Al cambiar la billetera de un
// movimiento eso quedaba con la billetera vieja, así que la solicitud decía dos cosas distintas
// (arriba la nueva, en el pago la vieja) y el jugador buscaba una transferencia que no existía.
// Caso real: se intenta pagar de una cuenta, la transferencia no entra, se paga de otra (D-106).
async function _rehacerDesdeDelPago(solicitudId, filaAntes, bilNueva){
  if(!solicitudId || !bilNueva) return;
  try{
    const r = await supabaseClient.rpc('landing_retiro_cambiar_billetera_pago', {
      p_id: Number(solicitudId),
      p_monto: Math.abs(Number((filaAntes && filaAntes.monto) || 0)) || null,
      // El jugador ve el TITULAR de la cuenta, no el nombre interno de la billetera.
      p_desde: String(bilNueva.TITULAR || bilNueva.NOMBRE_VISIBLE || '').trim(),
      p_billetera: {
        billetera_id: String(bilNueva.ID_BILLETERA || ''),
        billetera_nombre: bilNueva.NOMBRE_VISIBLE || '',
        billetera_alias: bilNueva.CBU_ALIAS || bilNueva.ALIAS || '',
        billetera_cbu: bilNueva.CBU || '',
        billetera_titular: bilNueva.TITULAR || ''
      },
      p_fecha: (filaAntes && filaAntes.created_at) || null,
      p_operador: (window.operador && (window.operador.usuario || window.operador.nombre)) || 'panel'
    });
    if(r && r.error){
      toast('⚠ La billetera se cambió, pero el jugador sigue viendo la cuenta anterior · '+(r.error.message||'')+' · avisale','red');
      return;
    }
    const d = Array.isArray(r && r.data) ? r.data[0] : (r && r.data);
    if(d && d.pago_actualizado){
      toast('✓ El pago ahora figura desde '+(d.desde_nuevo||bilNueva.NOMBRE_VISIBLE)+' · el jugador ve la cuenta correcta','green');
    }
  }catch(e){
    toast('⚠ La billetera se cambió, pero no se pudo corregir de dónde salió el pago · '+(e.message||''),'red');
  }
}

async function _asentarCambioBilletera(datos){
  try{
    const desde = datos.bilAnteriorNombre || (datos.bilAnteriorId ? ('id ' + datos.bilAnteriorId) : '—');
    const hacia = datos.bilNuevaNombre || (datos.bilNuevaId ? ('id ' + datos.bilNuevaId) : '—');
    await registrarEnHistorial({
      usuario: 'CAMBIO BILLETERA',
      tipo: 'CAMBIO_BILLETERA',
      monto: Number(datos.monto || 0),
      billetera_id: datos.bilAnteriorId || null,     // la que estaba mal anotada
      billetera_nombre: desde + ' → ' + hacia,
      origen: datos.origen || 'MANUAL',
      estado: 'OK',
      notas: 'Cambio de billetera'
             + (datos.movId ? (' · Chunior N° ' + datos.movId) : ' · sin N° de Chunior')
             + (datos.bilNuevaId ? (' · destino_id=' + datos.bilNuevaId) : '')
             + (datos.historialId ? (' · historial_id=' + datos.historialId) : '')
             + (datos.solicitudId ? (' · solicitud=' + datos.solicitudId) : ''),
      chunior_movimiento_id: datos.movId || null
    });
  }catch(e){ console.warn('asentar CAMBIO_BILLETERA:', e); }
}

function cambiarBilleteraHistorialLocal(historialId, currentBilId, solicitudId){
  const bils = billeteras.filter(function(b){
    return normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA';
  });
  const opciones = bils.map(function(b){
    const sel = String(b.ID_BILLETERA) === String(currentBilId) ? ' selected' : '';
    return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '"' + sel + '>' +
           escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
           '</option>';
  }).join('');

  if(!historialId && !solicitudId){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No se pudo identificar la operación.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }
  if(!bils.length){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No hay billeteras activas disponibles.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  abrirModal(
    '💳 Cambiar billetera · Historial',
    '<div class="alert-box" style="padding:10px;font-size:12px">Esta operación no tiene N° de movimiento Chunior. Se corrige la billetera en NODO / historial / portal. Si también hubo movimiento en Chunior, corregilo desde Chunior o usá la fila con N°.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA</label>' +
    '<select id="cambioBilLocalSel">' + opciones + '</select>' +
    '<div id="cambioBilLocalRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const sel   = document.getElementById("cambioBilLocalSel");
      const resEl = document.getElementById("cambioBilLocalRes");
      const btn   = document.getElementById("modalSaveBtn");
      const nuevoBilId = sel?.value;
      const bilNueva = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(nuevoBilId); });
      if(!bilNueva){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Seleccioná una billetera.</span>';
        return;
      }
      if(btn){ btn.disabled = true; btn.textContent = "Guardando..."; }
      // UUID validation: historial_ops.id is uuid — reject numeric/non-uuid strings
      const historialIdUUID = (historialId && /^[0-9a-f-]{32,}$/i.test(historialId) && historialId.includes('-')) ? historialId : '';
      try{
        let _antesLocal = null;
        if(historialIdUUID){
          // Leer antes de pisar, igual que en el camino con N° de Chunior.
          try{
            const q = await supabaseClient.from("historial_ops")
              .select("monto,billetera_id,billetera_nombre,created_at")
              .eq("id", historialIdUUID).maybeSingle();
            _antesLocal = (q && q.data) ? q.data : null;
          }catch(_e){}
          const upd = await supabaseClient.from("historial_ops")
            .update({ billetera_id: nuevoBilId, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
            .eq("id", historialIdUUID);
          if(upd.error) throw new Error(upd.error.message || 'No se pudo actualizar historial_ops');
        }
        await _asentarCambioBilletera({
          movId: null,                                  // este camino es el que NO tiene N°
          historialId: historialIdUUID || null,
          solicitudId: solicitudId || null,
          monto: _antesLocal ? _antesLocal.monto : 0,
          bilAnteriorId: _antesLocal ? _antesLocal.billetera_id : (currentBilId || null),
          bilAnteriorNombre: _antesLocal ? _antesLocal.billetera_nombre : null,
          bilNuevaId: nuevoBilId,
          bilNuevaNombre: bilNueva.NOMBRE_VISIBLE,
          origen: 'MANUAL_LOCAL'
        });

        if(solicitudId){
          try{
            const metaPatch = {
              billetera_id: nuevoBilId,
              billetera_nombre: bilNueva.NOMBRE_VISIBLE,
              billetera_alias: bilNueva.CBU_ALIAS || bilNueva.ALIAS || '',
              billetera_cbu: bilNueva.CBU || '',
              billetera_banco: bilNueva.TIPO || '',
              billetera_cambiada_panel: true
            };
            const solRow = await supabaseClient.from("landing_solicitudes").select("metadata").eq("id", solicitudId).maybeSingle();
            const metaActual = (solRow && solRow.data && solRow.data.metadata) ? solRow.data.metadata : {};
            await supabaseClient.from("landing_solicitudes")
              .update({ metadata: {...metaActual, ...metaPatch} })
              .eq("id", solicitudId);
          }catch(eMeta){ console.warn("update landing_solicitudes metadata local:", eMeta); }
          // Y de DÓNDE salió la plata de ese pago: el dato que ve el jugador y con el que se cotea (D-106).
          await _rehacerDesdeDelPago(solicitudId, _antesLocal, bilNueva);
        }

        toast("✅ Billetera actualizada en historial", "green");
        cerrarModal();
        await cargarHistorial();
      }catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'Error') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Guardar"; }
      }
    },
    'Guardar'
  );
}


function cambiarBilleteraMovimiento(movId, historialId, currentBilId){
  if(!window.chunior){ toast("Chunior no disponible", "red"); return; }
  if(!movId){ toast("Esta operación no tiene movimiento de Chunior", "red"); return; }

  // Construir opciones del select: solo billeteras con CHUNIOR_UID configurado
  const bilsConUid = billeteras.filter(function(b){ return b.CHUNIOR_UID && normalizar(b.ACTIVA)==='SI' && normalizar(b.ESTADO||'ACTIVA') !== 'FUSIONADA'; });
  const opciones = bilsConUid.map(function(b){
    const sel = String(b.ID_BILLETERA) === String(currentBilId) ? ' selected' : '';
    return '<option value="' + escapeHtml(String(b.ID_BILLETERA)) + '"' + sel + '>' +
           escapeHtml(b.NOMBRE_VISIBLE || '—') + ' · ' + money(b.SALDO || 0) +
           '</option>';
  }).join('');

  if(!bilsConUid.length){
    abrirModal('💳 Cambiar billetera',
      '<div class="err-box">No hay billeteras configuradas con UID de Chunior. Sincronizá billeteras primero.</div>',
      function(){ cerrarModal(); }, 'Entendido');
    return;
  }

  abrirModal(
    '💳 Cambiar billetera · Mov. N° ' + escapeHtml(String(movId)),
    '<div style="color:#c0cad8;font-size:13px;margin-bottom:10px">Elegí la nueva billetera destino. Se actualiza en Chunior y en el historial automáticamente.</div>' +
    '<label style="color:#c0cad8;font-size:12px;font-weight:700">NUEVA BILLETERA</label>' +
    '<select id="cambioBilSel">' + opciones + '</select>' +
    '<div id="cambioBilRes" style="min-height:16px;margin-top:6px"></div>',
    async function(){
      const sel   = document.getElementById("cambioBilSel");
      const resEl = document.getElementById("cambioBilRes");
      const btn   = document.getElementById("modalSaveBtn");
      const nuevoBilId = sel?.value;
      if(!nuevoBilId){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">Seleccioná una billetera.</span>';
        return;
      }
      const bilNueva = billeteras.find(function(b){ return String(b.ID_BILLETERA) === String(nuevoBilId); });
      if(!bilNueva || !bilNueva.CHUNIOR_UID){
        if(resEl) resEl.innerHTML = '<span style="color:var(--red);font-size:12px">La billetera no tiene UID de Chunior.</span>';
        return;
      }
      if(btn){ btn.disabled = true; btn.textContent = "Cambiando..."; }
      if(resEl) resEl.innerHTML = '<span class="small">Aplicando cambio en Chunior...</span>';
      try {
        const r = await _cambiarBilleteraChunior(movId, bilNueva.CHUNIOR_UID);
        if(r.ok){
          // Leer la fila ANTES de pisarla: el update borra la billetera anterior y el
          // monto, que son justo los datos que hacen falta para auditar el cambio.
          let _antes = null;
          if(historialId){
            try{
              const q = await supabaseClient.from("historial_ops")
                .select("monto,billetera_id,billetera_nombre,solicitud_id,created_at")
                .eq("id", historialId).maybeSingle();
              _antes = (q && q.data) ? q.data : null;
            }catch(_e){}
          }
          // Actualizar la fila en historial_ops
          if(historialId){
            try {
              await supabaseClient.from("historial_ops")
                .update({ billetera_id: nuevoBilId, billetera_nombre: bilNueva.NOMBRE_VISIBLE })
                .eq("id", historialId);
            } catch(eUpd){ console.warn("update historial_ops:", eUpd); }
          }
          await _asentarCambioBilletera({
            movId: movId,
            historialId: historialId,
            solicitudId: _antes ? _antes.solicitud_id : null,
            monto: _antes ? _antes.monto : 0,
            bilAnteriorId: _antes ? _antes.billetera_id : (currentBilId || null),
            bilAnteriorNombre: _antes ? _antes.billetera_nombre : null,
            bilNuevaId: nuevoBilId,
            bilNuevaNombre: bilNueva.NOMBRE_VISIBLE
          });
          // De DÓNDE salió la plata, en la solicitud: es lo que ve el jugador ("te transfirió X") y
          // con lo que se cotea la cuenta. Este camino no tocaba la solicitud, así que quedaba
          // nombrando la billetera vieja y el jugador buscaba una transferencia inexistente (D-106).
          await _rehacerDesdeDelPago(_antes ? _antes.solicitud_id : null, _antes, bilNueva);
          const tagMov = r.movId ? ' (N° ' + r.movId + ')' : '';
          toast("✅ Billetera cambiada · " + bilNueva.NOMBRE_VISIBLE + tagMov, "green");
          cerrarModal();
          await cargarHistorial();
        } else {
          if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(r.error || 'Error') + '</div>';
          if(btn){ btn.disabled = false; btn.textContent = "Cambiar billetera"; }
        }
      } catch(e){
        if(resEl) resEl.innerHTML = '<div class="err-box" style="padding:10px;font-size:12px;margin-top:6px">❌ ' + escapeHtml(e.message || 'sin detalle') + '</div>';
        if(btn){ btn.disabled = false; btn.textContent = "Cambiar billetera"; }
      }
    },
    'Cambiar billetera'
  );
}

async function _crearBilleterasNuevasChunior(nuevas){
  let _err=null;
  for(const w of nuevas){
    const { error } = await supabaseClient.rpc('panel_billetera_insert',{p_secret:window.PANEL_DATA_SECRET,p_patch:{
      nombre_visible: w.nombre,
      chunior_uid: String(w.uid),
      saldo: w.saldo,
      pc_codigo: pcOperativa,
      activa: true,
      cbu_alias: '',
      titular: '',
      tipo: ''
    }});
    if(error) _err=error;
  }
  if(_err){
    toast('Error al crear billeteras: '+_err.message, 'red');
    return;
  }
  toast('🆕 '+nuevas.length+' billetera(s) agregada(s). Completá CBU, titular y alias en Administrar billeteras.', 'blue');
  // Mostrar también una notificación más visible
  const alertas = document.getElementById('alertas');
  if(alertas){
    const lista = nuevas.map(function(w){ return escapeHtml(w.nombre); }).join(', ');
    alertas.innerHTML += '<div class="alert-box" style="background:#1a3a5a;color:#cde0ff">⚠️ Nuevas billeteras de Chunior: <b>'+lista+'</b>. Falta cargar CBU, titular y alias en Administrar billeteras.</div>';
  }
}

function chuniorNav(path){
  if(window.chunior) window.chunior.navigate(CHUNIOR_BASE + path);
}

// ── Macros del chat ───────────────────────────────────────────────────────────
let macrosList = [];

async function cargarMacros(){
  try {
    const { data } = await supabaseClient.from('macros')
      .select('*')
      .or('pc_codigo.is.null,pc_codigo.eq.' + (pcOperativa || ''))
      .order('orden', { ascending: true });
    macrosList = data || [];
  } catch(e){ macrosList = []; }
}

function toggleMacrosPanel(ev){
  if(ev) ev.stopPropagation();
  const p = document.getElementById('macrosPanel');
  if(!p) return;
  if(p.classList.contains('hidden')){
    p.classList.remove('hidden');
    if(!macrosList.length) cargarMacros().then(()=>renderMacrosPanel());
    else renderMacrosPanel();
  } else {
    p.classList.add('hidden');
  }
}

function renderMacrosPanel(){
  const p = document.getElementById('macrosPanel');
  if(!p) return;
  // Billetera siempre primera (dinámica, no en Supabase)
  let html = '<button class="macro-btn bil" onclick="aplicarMacroBilletera()">💳 Billetera</button>';
  macrosList.forEach(function(m){
    html += '<button class="macro-btn" onclick="aplicarMacro('+_jsonAttr(m.id)+')">'+escapeHtml(m.titulo)+'</button>';
  });
  html += '<div class="macro-edit-row"><button class="mini-btn gray" style="font-size:11px;padding:3px 10px" onclick="abrirEditorMacros()">⚙️ Editar</button></div>';
  p.innerHTML = html;
}

// El texto de la tarjeta vive acá solo, porque lo usan dos chats distintos (el grande y
// el compacto de Inicio) y si se duplica el formato, uno de los dos se queda viejo.
function textoTarjetaBilletera(){
  const b = getBilleraLanding();
  if(!b) return '';
  const nombre    = b.NOMBRE_VISIBLE || '';
  const cbuAlias  = (b.CBU_ALIAS || b.CBU_CVU || '').trim();
  const esCBU     = /^\d{15,}$/.test(cbuAlias);
  let texto = '💳 ' + nombre.toUpperCase() + '\n';
  texto += esCBU ? 'CBU/CVU: ' + cbuAlias + '\n' : 'Alias: ' + cbuAlias + '\n';
  texto += 'Titular: ' + nombre + '\nBanco: ' + (b.TIPO || b.BANCO || 'MP') + '\n\nTransferí y luego enviá el comprobante por este chat.';
  return texto;
}
window.textoTarjetaBilletera = textoTarjetaBilletera;

function aplicarMacroBilletera(){
  const p = document.getElementById('macrosPanel');
  if(p) p.classList.add('hidden');
  const texto = textoTarjetaBilletera();
  if(!texto){ toast('No hay billetera activa configurada', 'red'); return; }
  const inp = document.getElementById('chatInput');
  if(inp){ inp.value = texto; inp.focus(); }
}

function aplicarMacro(id){
  const p = document.getElementById('macrosPanel');
  if(p) p.classList.add('hidden');
  const m = macrosList.find(function(x){ return x.id === id; });
  if(!m) return;
  const inp = document.getElementById('chatInput');
  if(inp){ inp.value = m.texto; inp.focus(); }
}

function renderEditorMacrosHTML(){
  let rows = macrosList.map(function(m){
    return '<div style="display:flex;align-items:start;gap:8px;padding:10px;background:#1b202c;border-radius:10px;margin-bottom:8px">'
      + '<div style="flex:1">'
      + '<div style="font-weight:700;font-size:13px;margin-bottom:3px">'+escapeHtml(m.titulo)+'</div>'
      + '<div style="font-size:11px;color:var(--muted);word-break:break-word">'+escapeHtml(m.texto.substring(0,80))+(m.texto.length>80?'…':'')+'</div>'
      + '</div>'
      + '<button class="mini-btn gray" style="font-size:11px;padding:3px 8px;flex-shrink:0" onclick="editarMacroModal('+_jsonAttr(m.id)+')">✏️</button>'
      + '<button class="mini-btn red"  style="font-size:11px;padding:3px 8px;flex-shrink:0" onclick="borrarMacro('+_jsonAttr(m.id)+')">🗑️</button>'
      + '</div>';
  }).join('');
  rows += '<hr style="border-color:#2e3444;margin:14px 0">'
    + '<div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">NUEVA MACRO</div>'
    + '<input id="nuevoMacroTitulo" placeholder="Título (ej: ✅ Aprobada)" style="margin-bottom:8px">'
    + '<textarea id="nuevoMacroTexto" rows="3" placeholder="Texto del mensaje..." style="width:100%;background:#0e1525;border:1px solid #2e3444;border-radius:10px;color:#fff;padding:10px;font-size:13px;resize:vertical"></textarea>'
    + '<button class="btn btn-primary" style="margin-top:10px;width:100%" onclick="crearMacro()">Guardar macro</button>';
  return rows;
}

function abrirEditorMacros(){
  const p = document.getElementById('macrosPanel');
  if(p) p.classList.add('hidden');
  if(!macrosList.length){
    cargarMacros().then(function(){ abrirModal('⚙️ Macros del chat', renderEditorMacrosHTML(), null, null); });
    return;
  }
  abrirModal('⚙️ Macros del chat', renderEditorMacrosHTML(), null, null);
}

function editarMacroModal(id){
  const m = macrosList.find(function(x){ return x.id===id; });
  if(!m) return;
  const body = '<input id="editMacroTitulo" value="'+escapeHtml(m.titulo)+'" style="margin-bottom:8px">'
    + '<textarea id="editMacroTexto" rows="4" style="width:100%;background:#0e1525;border:1px solid #2e3444;border-radius:10px;color:#fff;padding:10px;font-size:13px;resize:vertical">'+escapeHtml(m.texto)+'</textarea>';
  abrirModal('✏️ Editar macro', body, async function(){
    const titulo = (document.getElementById('editMacroTitulo')?.value||'').trim();
    const texto  = (document.getElementById('editMacroTexto')?.value||'').trim();
    if(!titulo||!texto){ toast('Completá título y texto','red'); return; }
    const { error } = await supabaseClient.from('macros').update({titulo,texto}).eq('id',id);
    if(error){ toast('Error al guardar: '+error.message,'red'); return; }
    cerrarModal();
    await cargarMacros();
    toast('Macro actualizada','green');
  }, 'Guardar');
}

async function crearMacro(){
  const titulo = (document.getElementById('nuevoMacroTitulo')?.value||'').trim();
  const texto  = (document.getElementById('nuevoMacroTexto')?.value||'').trim();
  if(!titulo||!texto){ toast('Completá título y texto','red'); return; }
  const maxOrden = macrosList.reduce(function(acc,m){ return Math.max(acc,m.orden||0); }, 0);
  const { error } = await supabaseClient.from('macros').insert({titulo, texto, orden: maxOrden+1});
  if(error){ toast('Error al crear: '+error.message,'red'); return; }
  cerrarModal();
  await cargarMacros();
  toast('Macro creada','green');
}

async function borrarMacro(id){
  if(!confirm('¿Borrar esta macro?')) return;
  const { error } = await supabaseClient.from('macros').delete().eq('id',id);
  if(error){ toast('Error: '+error.message,'red'); return; }
  cerrarModal();
  await cargarMacros();
  toast('Macro eliminada','green');
}

// Cierre automático del panel de macros al click afuera
document.addEventListener('click', function(e){
  const p = document.getElementById('macrosPanel');
  if(!p || p.classList.contains('hidden')) return;
  const btn = document.querySelector('[onclick*="toggleMacrosPanel"]');
  if(p.contains(e.target)) return;
  if(btn && btn.contains(e.target)) return;
  p.classList.add('hidden');
}, true);

// ── Cola de verificación de login ─────────────────────────────────────────────
let _verifActivo = false;

async function procesarColaVerificacion(){
  if(!window.ctrlElectron || _verifActivo) return;
  const {data} = await supabaseClient
    .from("verificaciones")
    .select("*")
    .eq("pc_codigo", pcOperativa)
    .eq("estado", "PENDIENTE")
    .order("created_at", {ascending:true})
    .limit(1);
  if(!data || !data.length) return;

  const v = data[0];
  _verifActivo = true;
  try {
    // Resuelve el alias mirando NUESTRA base (igual que buscarUsuario): si está exacto, lo manda exacto;
    // si no está exacto y tiene chars especiales, manda el normalizado. Una sola llamada al casino.
    const aliasParaCasino = await _resolverAliasParaCasino(v.usuario);
    const result = await window.ctrlElectron.verifyUser(aliasParaCasino);
    const nuevoEstado = result.exists ? "VERIFICADO" : "NO_EXISTE";
    await supabaseClient.from("verificaciones").update({
      estado: nuevoEstado,
      nombre_casino: result.user || null,
      updated_at: new Date().toISOString()
    }).eq("id", v.id);
    if(result.exists){
      // NO escribimos directo en "usuarios": el blindaje (RLS) bloquea las escrituras directas del
      // panel a esa tabla → esto tiraba 42501 "new row violates row-level security policy" en cada
      // verificación (el loop corre cada 5s → spam constante en los logs de Supabase). El estado real
      // de la verificación ya queda guardado arriba en la tabla "verificaciones".
      // Si se quiere volver a marcar usuarios.verificado, tiene que ser vía RPC SECURITY DEFINER.
      toast(`✅ Verificado: ${v.usuario}`, "green");
    } else {
      toast(`❌ No existe: ${v.usuario}`, "red");
    }
  } catch(e) {
    await supabaseClient.from("verificaciones").update({
      estado: "ERROR",
      updated_at: new Date().toISOString()
    }).eq("id", v.id);
    console.error("Error verificando:", v.usuario, e);
  } finally {
    _verifActivo = false;
    // Refresca el panel si está abierto
    const secVerif = document.getElementById("viewVerificaciones");
    if(secVerif && !secVerif.classList.contains("hidden")) cargarVerificaciones();
  }
}

// Arranca el procesador automático cuando hay Electron
if(window.ctrlElectron){
  setInterval(procesarColaVerificacion, 5000);
  // Actualiza badge de pendientes cada 10s
  setInterval(async ()=>{
    const { count } = await supabaseClient.from("verificaciones")
      .select("id", { count:"exact", head:true })
      .eq("pc_codigo", pcOperativa).eq("estado","PENDIENTE");
    const badge = document.getElementById("badgeVerif");
    if(!badge) return;
    if(count){ badge.classList.remove("hidden"); badge.textContent=count; }
    else badge.classList.add("hidden");
  }, 10000);
}
