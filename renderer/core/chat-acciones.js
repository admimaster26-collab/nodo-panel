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
  if(!confirm(`Resetear clave de "${usuario}" a 1a2b3c4d?`)) return;
  await resetClaveRapido(usuario, "1a2b3c4d");
}

// Valida al usuario en Agentes (casino) y lo agrega a la base de la oficina (vínculo usuario↔tel).
// Para onboardear usuarios nuevos legítimos de oficinas con base que el cotejo dejó en SOPORTE.
// NÚCLEO: verifica en Agentes y crea el vínculo. Sin prompt() (Electron no lo soporta) — los datos vienen del modal.
// ══════════════════════════════════════════════════════════════════════════
