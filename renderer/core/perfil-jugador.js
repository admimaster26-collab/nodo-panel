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
