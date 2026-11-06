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
  window.NodoSalud?.begin('CONEXION')?.record('ALIVE','OK','PANEL_VERSION_CHECK');
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
  // Espera su paso del arranque por etapas. En el login window.pcOperativa ya trae la oficina de la
  // sesión anterior (la deja validacion-pc.js), y el latido salía a su nombre y sin operador.
  if(window.nodoArranqueHabilitado && !window.nodoArranqueHabilitado('latido')) return;
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
  finally{ try{ void window.NodoSalud?.flush(); }catch(_e){} }
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
  if(window.nodoArranqueHabilitado && !window.nodoArranqueHabilitado('lineas')) return;   // ídem el latido
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

