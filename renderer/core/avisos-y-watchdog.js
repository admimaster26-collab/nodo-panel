function verificarSolicitudes(silencioso=false){
  // Excluir SOPORTE: van al badge de Chat, no al de Solicitudes
  const pendientes=solicitudes.filter(s=>esPendiente(s) && String(s.TIPO||s.TIPO_SOLICITUD||"").toUpperCase()!=="SOPORTE");
  const ids=new Set(pendientes.map(s=>String(s.ID||s.SOLICITUD_ID||"")).filter(Boolean));
  const badge=document.getElementById("badgeSolicitudes");
  // El número del menú cuenta lo que nadie tomó, igual que la lista de Inicio. El aviso de "nueva
  // solicitud" de abajo sigue usando todas las pendientes: una tomada que se suelta no es nueva.
  const sinTocar=window.nodoSolicitudesSinTocar?window.nodoSolicitudesSinTocar(pendientes):pendientes;
  if(sinTocar.length){badge.classList.remove("hidden");badge.innerText=sinTocar.length}else badge.classList.add("hidden");
  let nuevas=0;ids.forEach(id=>{if(!lastPendientesIds.has(id))nuevas++});
  if(!silencioso||lastPendientesIds.size===0){lastPendientesIds=ids;return}
  if(nuevas>0){toast(`🔔 ${nuevas} nueva/s solicitud/es`);sonido("solicitud")}
  lastPendientesIds=ids;
}
function verificarChats(silencioso=false){
  const unread=window.nodoChatUnreadSnapshot?.().total || 0;
  window.nodoChatRefreshUnread?.();
  if(silencioso && unread>lastChatUnread){toast("💬 Nuevo mensaje de chat");sonido("chat")}
  lastChatUnread=unread;
}
// ── Sistema de Sonidos y Tonos de Notificación ─────────────────────────────────
const _NODO_TONOS = {
  // Campanilla suave: doble armónico suave y decreciente
  chime: function(ctx, vol, tipo){
    const baseFreq = tipo === "chat" ? 880 : 698.46;
    [baseFreq, baseFreq * 1.5].forEach(function(freq, idx){
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
      gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.08);
      gain.gain.linearRampToValueAtTime(vol * 0.45, ctx.currentTime + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.08);
      osc.stop(ctx.currentTime + idx * 0.08 + 0.4);
    });
  },
  // Ping corporativo: cristalino y seco
  ping: function(ctx, vol, tipo){
    const freq = tipo === "chat" ? 987.77 : 783.99;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol * 0.5, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  },
  // Pálpito acústico: cálido, estilo madera
  acoustic: function(ctx, vol, tipo){
    const freq = tipo === "chat" ? 523.25 : 392.00;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol * 0.6, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  },
  // Pop seco: ultra discreto y minimalista
  pop: function(ctx, vol, tipo){
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = tipo === "chat" ? 480 : 380;
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.07);
    gain.gain.setValueAtTime(vol * 0.55, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
  },
  // Doble tono corporativo: ding-dong oficina
  twotone: function(ctx, vol, tipo){
    const f1 = tipo === "chat" ? 784 : 659.25;
    const f2 = tipo === "chat" ? 659.25 : 523.25;
    [[f1, 0], [f2, 0.12]].forEach(function(pair){
      const freq = pair[0], delay = pair[1];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol * 0.45, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.26);
    });
  },
  // Burbuja moderna: gota sutil ascendente
  bubble: function(ctx, vol, tipo){
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startF = tipo === "chat" ? 440 : 350;
    const endF = tipo === "chat" ? 880 : 700;
    osc.type = "sine";
    osc.frequency.setValueAtTime(startF, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endF, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol * 0.5, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  },
  // NODO clásico: el beep senoidal tradicional
  nodo: function(ctx, vol, tipo){
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = tipo === "chat" ? 660 : 520;
    gain.gain.value = vol * 0.25;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(function(){ try{ osc.stop(); }catch(_e){} }, 220);
  }
};

function sonido(tipo="msg"){
  try{
    const tonoElegido = localStorage.getItem("nodo_notif_tone") || "chime";
    if(tonoElegido === "mute") return;

    const volNum = parseInt(localStorage.getItem("nodo_notif_volume") || "80", 10);
    const vol = Math.max(0, Math.min(100, isNaN(volNum) ? 80 : volNum)) / 100;
    if(vol <= 0) return;

    if(tonoElegido === "custom"){
      const audioData = localStorage.getItem("nodo_custom_audio_data");
      if(audioData){
        const aud = new Audio(audioData);
        aud.volume = vol;
        aud.play().catch(function(){});
        return;
      }
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const synth = _NODO_TONOS[tonoElegido] || _NODO_TONOS.chime;
    synth(ctx, vol, tipo);
    setTimeout(function(){ try{ ctx.close(); }catch(_e){} }, 700);
  }catch(_e){}
}

const _TONO_OPCIONES = [
  { id: 'chime', ico: '🔔', label: 'Campanilla suave', desc: 'Discreto · Doble armónico suave' },
  { id: 'ping', ico: '✨', label: 'Ping corporativo', desc: 'Moderno · Cristalino y seco' },
  { id: 'acoustic', ico: '🪵', label: 'Pálpito acústico', desc: 'Cálido · Tono grave madera' },
  { id: 'pop', ico: '🔘', label: 'Pop seco', desc: 'Minimalista · Micro-pulsación' },
  { id: 'twotone', ico: '🏢', label: 'Doble tono', desc: 'Oficina · Ding-dong ejecutivo' },
  { id: 'bubble', ico: '💧', label: 'Burbuja moderna', desc: 'Gota ascendente agradable' },
  { id: 'nodo', ico: '📻', label: 'NODO clásico', desc: 'Original · Beep senoidal' },
  { id: 'mute', ico: '🔇', label: 'Silencio', desc: 'Sin sonido de notificación' }
];

window.nodoAbrirAjustes = function(){
  try{
    const ov = document.getElementById("modalAjustesOverlay");
    if(ov) ov.classList.remove("hidden");
    nodoSincronizarAjustesTonos();
    try{ window.nodoCargarBackendAgentes && window.nodoCargarBackendAgentes(); }catch(_e){}
    try{ window.verificarEstadoBackoffice && window.verificarEstadoBackoffice(); }catch(_e){}
    try{ nodoPintarEstadoSistema(); }catch(_e){}
  }catch(_e){}
};

// Lo que el semáforo le muestra a una persona: si anda y, si no, qué parte se cortó. Una línea y, para
// el que quiera mirar, el detalle plegado. Nada de ramas, etapas ni códigos (Juan, 1/11). "Funciona"
// sólo lo dice una prueba: que algo se haya usado sin errores es "sin fallas", no una garantía.
function nodoPintarEstadoSistema(probando){
  const box = document.getElementById("ajustesEstadoSistema");
  if(!box || !window.NodoSalud) return;
  const r = window.NodoSalud.resumen();
  const abierto = !!box.querySelector("details")?.open;
  r.partes.forEach(function(p){
    const prueba = window.NodoPruebas?.vigente(p.nombre);
    if(prueba){ p.estado = prueba.ok ? "probada" : "falla"; p.detalle = prueba.detalle || ""; }
  });
  const fallas = r.partes.filter(function(p){ return p.estado === "falla"; });
  const probadas = r.partes.filter(function(p){ return p.estado === "probada"; });
  const andan = r.partes.filter(function(p){ return p.estado === "anda"; });
  const fila = function(p){
    const color = p.estado === "falla" ? "#f87171" : p.estado === "probada" ? "#22c55e" : p.estado === "anda" ? "#94a3b8" : "#64748b";
    const texto = p.estado === "falla" ? p.detalle : p.estado === "probada" ? "Funciona · recién probado" : p.estado === "anda" ? "Sin fallas" : "Sin actividad todavía";
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0">'
      + '<span style="color:#cbd5e1">' + escapeHtml(p.nombre) + '</span>'
      + '<span style="color:' + color + '">' + escapeHtml(texto) + '</span></div>';
  };
  const titulo = fallas.length
    ? '<div style="font-size:12px;font-weight:800;color:#f87171">Hay ' + fallas.length + (fallas.length === 1 ? ' parte con problemas' : ' partes con problemas') + '</div>'
      + fallas.map(fila).join("")
    : '<div style="font-size:12px;font-weight:800;color:' + (probadas.length ? '#22c55e' : '#94a3b8') + '">'
      + (probadas.length ? 'Las pruebas dieron bien' : andan.length ? 'Sin fallas registradas' : 'Todavía no hay actividad para revisar') + '</div>';
  box.innerHTML = titulo
    + '<details style="margin-top:6px"' + (abierto ? ' open' : '') + '><summary class="small" style="cursor:pointer;color:#94a3b8">Ver detalle</summary>'
    + '<div class="small" style="margin-top:6px">' + r.partes.map(fila).join("") + '</div></details>'
    + '<button class="mini-btn blue" style="margin-top:10px;width:100%;padding:9px"' + (probando ? ' disabled' : '') + ' onclick="nodoProbarSistema()">'
    + (probando ? 'Probando ' + escapeHtml(probando.toLowerCase()) + '…' : '▶ Probar ahora') + '</button>';
}

window.nodoProbarSistema = async function(){
  if(!window.NodoPruebas || window.NodoPruebas.ocupado()) return;
  await window.NodoPruebas.correr(function(parte){ try{ nodoPintarEstadoSistema(parte); }catch(_e){} });
};

window.nodoCerrarAjustes = function(){
  try{
    const ov = document.getElementById("modalAjustesOverlay");
    if(ov) ov.classList.add("hidden");
  }catch(_e){}
};

window.nodoSeleccionarTono = function(tonoId){
  try{
    localStorage.setItem("nodo_notif_tone", tonoId);
    nodoSincronizarAjustesTonos();
    sonido("solicitud");
  }catch(_e){}
};

window.nodoPreviewTono = function(tonoId, ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  try{
    if(tonoId === "mute") return;
    const volNum = parseInt(localStorage.getItem("nodo_notif_volume") || "80", 10);
    const vol = Math.max(0, Math.min(100, isNaN(volNum) ? 80 : volNum)) / 100;
    if(vol <= 0) return;

    if(tonoId === "custom"){
      const audioData = localStorage.getItem("nodo_custom_audio_data");
      if(audioData){
        const aud = new Audio(audioData);
        aud.volume = vol;
        aud.play().catch(function(){});
        return;
      }
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const synth = _NODO_TONOS[tonoId] || _NODO_TONOS.chime;
    synth(ctx, vol, "solicitud");
    setTimeout(function(){ try{ ctx.close(); }catch(_e){} }, 700);
  }catch(_e){}
};

window.nodoCambiarVolumen = function(val){
  const v = parseInt(val, 10);
  const txt = document.getElementById("txtVolumenTono");
  if(txt) txt.textContent = v + "%";
  try{ localStorage.setItem("nodo_notif_volume", String(v)); }catch(_e){}
};

// Validación estricta: extensión + MIME + Magic Bytes (evita cualquier archivo arbitrario)
window.nodoCargarAudioArchivo = function(input){
  const file = input && input.files && input.files[0];
  if(!file) return;

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if(!['mp3', 'wav', 'ogg'].includes(ext)){
    alert("Archivo rechazado: solo se permiten audios en formato .mp3, .wav o .ogg.");
    input.value = "";
    return;
  }
  if(file.size > 2 * 1024 * 1024){
    alert("Archivo rechazado: el audio supera el límite de 2 MB.");
    input.value = "";
    return;
  }

  // Verificación de cabecera binaria (magic bytes): evita archivos arbitrarios renombrados a .mp3/.wav
  const slice = file.slice(0, 12);
  const headReader = new FileReader();
  headReader.onload = function(evt){
    try{
      const b = new Uint8Array(evt.target.result);
      const isWav = b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46; // RIFF
      const isMp3 = (b[0]===0x49 && b[1]===0x44 && b[2]===0x33) || (b[0]===0xFF && (b[1]&0xE0)===0xE0); // ID3 o sync frame
      const isOgg = b[0]===0x4F && b[1]===0x67 && b[2]===0x67 && b[3]===0x53; // OggS
      if(!isWav && !isMp3 && !isOgg){
        alert("Archivo rechazado: el contenido no corresponde a un archivo de audio genuino.");
        input.value = "";
        return;
      }

      // Audio genuino confirmado
      const reader = new FileReader();
      reader.onload = function(e){
        try{
          const dataUrl = e.target.result;
          localStorage.setItem("nodo_custom_audio_data", dataUrl);
          localStorage.setItem("nodo_custom_audio_name", file.name);
          localStorage.setItem("nodo_notif_tone", "custom");
          window.nodoSincronizarAjustesTonos && window.nodoSincronizarAjustesTonos();
          sonido("solicitud");
          toast && toast("Tono propio cargado con éxito.","green");
        }catch(_err){
          alert("No se pudo guardar el archivo en memoria local.");
        }
      };
      reader.readAsDataURL(file);
    }catch(_err){
      alert("Error al verificar la integridad del archivo.");
    }
  };
  headReader.readAsArrayBuffer(slice);
};

window.nodoQuitarAudioCustom = function(){
  try{
    localStorage.removeItem("nodo_custom_audio_data");
    localStorage.removeItem("nodo_custom_audio_name");
    localStorage.setItem("nodo_notif_tone", "chime");
    window.nodoSincronizarAjustesTonos && window.nodoSincronizarAjustesTonos();
    toast && toast("Tono restablecido a Campanilla suave.","blue");
  }catch(_e){}
};

window.nodoSincronizarAjustesTonos = function(){
  try{
    const listEl = document.getElementById("tonoPickerList");
    if(listEl){
      const current = localStorage.getItem("nodo_notif_tone") || "chime";
      const customName = localStorage.getItem("nodo_custom_audio_name");
      const customData = localStorage.getItem("nodo_custom_audio_data");

      let items = _TONO_OPCIONES.slice();
      if(customName && customData){
        items.unshift({ id: 'custom', ico: '📁', label: customName, desc: 'Audio propio cargado' });
      }

      listEl.innerHTML = items.map(function(t){
        const isSel = (t.id === current);
        return '<div class="tono-row' + (isSel ? ' selected' : '') + '" onclick="nodoSeleccionarTono(\'' + t.id + '\')">'
          + '<div class="tono-row-left">'
          + '<span class="tono-row-ico">' + t.ico + '</span>'
          + '<div class="tono-row-info">'
          + '<span class="tono-row-title">' + escapeHtml(t.label) + '</span>'
          + '<span class="tono-row-desc">' + escapeHtml(t.desc) + '</span>'
          + '</div>'
          + '</div>'
          + '<div class="tono-row-right">'
          + (t.id !== 'mute' ? '<button class="tono-play-btn" onclick="nodoPreviewTono(\'' + t.id + '\', event)" title="Escuchar">▶ Probar</button>' : '')
          + '<div class="tono-check-badge">' + (isSel ? '✓' : '') + '</div>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    const vol = localStorage.getItem("nodo_notif_volume") || "80";
    const slider = document.getElementById("sliderVolumenTono");
    const txtVol = document.getElementById("txtVolumenTono");
    if(slider) slider.value = vol;
    if(txtVol) txtVol.textContent = vol + "%";

    const customName = localStorage.getItem("nodo_custom_audio_name");
    const txtName = document.getElementById("txtAudioPersonalizado");
    const btnQuitar = document.getElementById("btnQuitarAudioCustom");
    if(customName){
      if(txtName) txtName.textContent = customName;
      if(btnQuitar) btnQuitar.style.display = "inline-flex";
    } else {
      if(txtName) txtName.textContent = "Formatos .mp3, .wav, .ogg (máx 2 MB)";
      if(btnQuitar) btnQuitar.style.display = "none";
    }
  }catch(_e){}
};

document.addEventListener("keydown", function(e){
  if(e.key === "Escape"){
    const ov = document.getElementById("modalAjustesOverlay");
    if(ov && !ov.classList.contains("hidden")){
      nodoCerrarAjustes();
      e.stopPropagation();
    }
  }
});

document.addEventListener("DOMContentLoaded", function(){
  setTimeout(function(){ try{ window.nodoSincronizarAjustesTonos && window.nodoSincronizarAjustesTonos(); }catch(_e){} }, 400);
});
if(document.readyState !== "loading") setTimeout(function(){ try{ window.nodoSincronizarAjustesTonos && window.nodoSincronizarAjustesTonos(); }catch(_e){} }, 400);
