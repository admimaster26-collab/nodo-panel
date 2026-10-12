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

