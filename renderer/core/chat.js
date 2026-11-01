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
    ...m,
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
    const msgHtml = escapeHtml(NodoChatMessage.visibleText(m)).replace(/\n/g,"<br>");
    html+=`<div class="chat-msg ${NodoChatMessage.className(m)}">
      <div class="chat-bubble" style="white-space:pre-wrap">
        <div class="wq2-author">${escapeHtml(NodoChatMessage.author(m,chat.USUARIO))}</div>
        ${msgHtml}
        ${m.IMAGEN_URL?`<img src="${normalizarImagenUrl(m.IMAGEN_URL)}" alt="Imagen">`:""}
      </div>
      <div class="chat-meta">${formatFecha(m.FECHA)}</div>
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
function dataUrlToBlob(dataUrl){
  const parts = String(dataUrl||"").split(",");
  if(parts.length < 2) return null;
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
  const binary = atob(parts[1]);
  const array = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}

async function subirImagenPanelChat(base64DataUrl){
  window.NodoSalud?.begin('CHAT')?.record('EFFECT','OK','CHAT_UPLOAD_IMAGE');
  if(!supabaseClient||!base64DataUrl)return null;
  try{
    let blob = null;
    try{ blob = dataUrlToBlob(base64DataUrl); }catch(_e){}
    if(!blob){
      const res = await fetch(base64DataUrl);
      blob = await res.blob();
    }
    const contentType = blob.type || 'image/jpeg';
    const ext = (contentType.split('/')[1]||'jpg').replace('jpeg','jpg');
    const path = `op/${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;

    // 1. Intento en chat-imagenes
    try{
      const up = await supabaseClient.storage.from('chat-imagenes').upload(path, blob, { cacheControl:'3600', upsert:true, contentType });
      if(!up.error){
        const { data: ud } = supabaseClient.storage.from('chat-imagenes').getPublicUrl(path);
        if(ud?.publicUrl) return ud.publicUrl;
      }
    }catch(_e){}

    // 2. Fallback en comprobantes
    try{
      const up2 = await supabaseClient.storage.from('comprobantes').upload(path, blob, { cacheControl:'3600', upsert:true, contentType });
      if(!up2.error){
        const { data: ud2 } = supabaseClient.storage.from('comprobantes').getPublicUrl(path);
        if(ud2?.publicUrl) return ud2.publicUrl;
      }
    }catch(_e){}

    return null;
  }catch(e){console.warn('[img upload panel]',e);return null;}
}

// ── Visor de imágenes modal (Lightbox seguro para Electron) ────────────────
// El visor de verdad es una VENTANA APARTE (ver main/image-window.js).
//
// Juan, 25/10: "cualquier cosa que se despliegue asi de esa manera estorba en aceptar otras
// cargas... es mas logico que se despliegue en otra ventana... deberias de dejar un maximo de 1,
// que la anterior muera antes de redesplegarse otra."
//
// El cartel de abajo tapaba el panel entero (position:fixed;inset:0;z-index:999999): mirar un
// comprobante dejaba al operador sin poder tomar una carga ni contestar un chat. El tope de una
// sola ventana lo hace cumplir main, no esta función.
window.nodoVerImagenCompleta = function(src, titulo){
  if(!src) return;
  try{
    if(window.panelAPI && typeof window.panelAPI.verImagen === 'function'){
      window.panelAPI.verImagen(String(src), String(titulo||''))
        .then(function(r){
          // Si main no la pudo abrir, que el operador vea algo igual en vez de un clic muerto.
          if(!r || r.ok !== true) window._nodoVerImagenEnCartel(src);
        })
        .catch(function(){ window._nodoVerImagenEnCartel(src); });
      return;
    }
  }catch(_e){}
  window._nodoVerImagenEnCartel(src);
};

// Respaldo: el cartel viejo, adentro del panel. Queda sólo para cuando no hay puente con main
// (desarrollo, o un proceso principal más viejo que el panel). Es el que estorba — por eso no es
// el primero, pero sacarlo del todo dejaría la imagen sin forma de verse.
window._nodoVerImagenEnCartel = function(src){
  if(!src) return;
  let modal = document.getElementById('nodoImgModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'nodoImgModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(8,11,17,0.88);backdrop-filter:blur(4px);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
      <div style="position:relative;max-width:94vw;max-height:92vh;display:flex;flex-direction:column;align-items:center;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:12px;box-shadow:0 20px 45px rgba(0,0,0,0.85)">
        <div style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #1e293b">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:14px">🖼️</span>
            <span style="color:#f1f5f9;font-size:12px;font-weight:700">Visualizador de Comprobante / Imagen</span>
          </div>
          <div style="display:flex;gap:8px">
            <button id="nodoImgModalCopy" type="button" style="background:#1e293b;color:#93c5fd;border:1px solid #3b82f6;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer">📋 Copiar enlace</button>
            <button id="nodoImgModalClose" type="button" style="background:#ef4444;color:#fff;border:0;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:bold;cursor:pointer">✕ Cerrar</button>
          </div>
        </div>
        <div style="overflow:auto;max-width:92vw;max-height:82vh;display:flex;justify-content:center;align-items:center">
          <img id="nodoImgModalSrc" src="" style="max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain;cursor:zoom-in" onclick="this.style.maxHeight=this.style.maxHeight==='none'?'80vh':'none';this.style.cursor=this.style.maxHeight==='none'?'zoom-out':'zoom-in'">
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target === modal) modal.style.display = 'none'; });
    modal.querySelector('#nodoImgModalClose').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.querySelector('#nodoImgModalCopy').addEventListener('click', () => {
      const s = modal.querySelector('#nodoImgModalSrc').src;
      if(navigator.clipboard && s){
        navigator.clipboard.writeText(s).then(() => { if(typeof toast === 'function') toast('Enlace copiado al portapapeles','green'); });
      }
    });
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && modal.style.display !== 'none') modal.style.display = 'none'; });
  }
  const imgEl = modal.querySelector('#nodoImgModalSrc');
  if(imgEl){
    imgEl.src = src;
    imgEl.style.maxHeight = '80vh';
    imgEl.style.cursor = 'zoom-in';
  }
  modal.style.display = 'flex';
};
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
  const chatView = document.getElementById("viewChat");
  const inicioView = document.getElementById("viewInicio");
  const visible = (chatView && !chatView.classList.contains("hidden")) || (inicioView && !inicioView.classList.contains("hidden") && document.body.classList.contains("nodo-chat-open")) || document.activeElement?.id === "chatInput" || document.activeElement?.id === "v15ChatInput";
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

