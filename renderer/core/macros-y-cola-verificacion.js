let macrosList = [];

async function cargarMacros(){
  window.NodoSalud?.begin('WORKERS')?.record('DATA','OK','MACROS_LOAD');
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
