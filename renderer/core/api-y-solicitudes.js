async function api(data){
  const _apiHealth=window.NodoSalud?.begin('PORTAL');
  const fd=new FormData();
  Object.keys(data).forEach(k=>fd.append(k,data[k]??""));
  const res=await fetch(API_URL,{method:"POST",body:fd});
  const text=await res.text();
  _apiHealth?.record('CONNECTED','OK','API_POST_OK');
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
