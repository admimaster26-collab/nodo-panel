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
// Igual que el servidor (telefono_canon): 10 dígitos, sin 54, 9 ni 0 adelante. Antes sólo sacaba lo
// que no era dígito: "+54 9 1100 00-0002" quedaba 5491100000002, no coincidía con ninguna cuenta
// (todas guardan 1100000002) y la tarjeta decía que el número no figuraba (6/11).
function _altaNormTel(s){
  let v = String(s||'').replace(/\D/g,'');
  if(v.length > 10){
    if(v.indexOf('54') === 0) v = v.slice(2);
    if(v.charAt(0) === '9') v = v.slice(1);
    if(v.charAt(0) === '0') v = v.slice(1);
  }
  return v.length > 10 ? v.slice(-10) : v;
}
// ── LO QUE YA SE RESOLVIÓ EN ESTA CONSULTA ────────────────────────────────────────────────
// Juan, 19/10: "revisa tambien que la proxima version cambie el cartel de revisar cuando se
// termine de validar para que aparezca todo joya, por como esta en la version actual sigue
// siendo incongruente".
//
// Y la tarjeta no tenía con qué saberlo. El cotejo compara lo que DECLARÓ el cliente contra el
// padrón, y lo declarado no cambia nunca: si escribió "laugoat66" y su cuenta es "lauggoat66",
// ese alias va a seguir sin existir para siempre. Así que el operador validaba, salía el
// "Usuario validado y agendado"… y detrás quedaba el mismo REVISAR con los mismos botones
// "usar lauggoat66", como si no hubiera hecho nada.
//
// Lo que faltaba no es un dato del padrón: es la MEMORIA de la decisión que acaba de tomar el
// operador. Se guarda acá con el par declarado de llave —la misma que ya usa la tarjeta para no
// re-cotejar— y nunca se pinta verde sin confirmarla contra el padrón recién traído.
const _ALTA_RES_LS='nodo.cotejo.resueltos', _ALTA_RES_VIDA=7*24*60*60*1000, _ALTA_RES_MAX=300;
function _altaResKey(uDecl,tDecl){ return _altaNormU(uDecl)+'|'+_altaNormTel(tDecl); }
function _altaResLeer(){
  if(window.__altaResueltos) return window.__altaResueltos;
  let m={};
  try{ if(typeof localStorage!=='undefined') m=JSON.parse(localStorage.getItem(_ALTA_RES_LS)||'{}')||{}; }catch(_e){ m={}; }
  if(!m || typeof m!=='object') m={};
  window.__altaResueltos=m; return m;
}
function _altaResGuardar(m){
  // Podar: primero lo vencido, después las más viejas si siguen siendo muchas. Una PC de oficina
  // no se reinicia nunca; sin techo esto crece hasta llenar el localStorage y romper el guardado.
  const ahora=Date.now();
  Object.keys(m).forEach(function(k){ if(!m[k] || (ahora-(m[k].cuando||0))>_ALTA_RES_VIDA) delete m[k]; });
  const ks=Object.keys(m);
  if(ks.length>_ALTA_RES_MAX){
    ks.sort(function(a,b){ return (m[a].cuando||0)-(m[b].cuando||0); })
      .slice(0,ks.length-_ALTA_RES_MAX).forEach(function(k){ delete m[k]; });
  }
  try{ if(typeof localStorage!=='undefined') localStorage.setItem(_ALTA_RES_LS,JSON.stringify(m)); }catch(_e){}
}
// Se llama al TERMINAR de validar. El guardia no es opcional: ejecutarVincular se usa también
// desde el CRM y desde el chat normal, y sin él una validación de OTRO jugador marcaba como
// resuelta la consulta que estuviera abierta. Un verde mentiroso es peor que el amarillo de más.
window._altaMarcarResuelto=function(usuario,telefono){
  try{
    const d=window.__altaCotejoDecl; if(!d || (!d.u && !d.t)) return;
    const tV=_altaNormTel(telefono), uV=_altaNormU(usuario);
    if(!(tV && tV===_altaNormTel(d.t)) && !(uV && uV===_altaNormU(d.u))) return;
    const m=_altaResLeer();
    m[_altaResKey(d.u,d.t)]={ usuario:String(usuario||''), telefono:String(telefono||''), cuando:Date.now() };
    _altaResGuardar(m);
    try{ window.NodoPersistenciaSync?.scheduleSync?.(); }catch(_e){}
  }catch(_e){}
};
// El verde no se cree solo: se confirma contra el cotejo recién traído. Si el vínculo se deshizo
// o el teléfono pasó a otra cuenta, la marca no se usa y la tarjeta vuelve a avisar.
// Ojo: NO se borra cuando no confirma. Si la consulta al padrón falló por red, borrarla perdería
// para siempre una validación que sí ocurrió; vencen solas por fecha.
function _altaResuelto(uDecl,tDecl,r){
  try{
    const m=_altaResLeer(), k=_altaResKey(uDecl,tDecl), g=m[k];
    if(!g) return null;
    if((Date.now()-(g.cuando||0))>_ALTA_RES_VIDA){ delete m[k]; _altaResGuardar(m); return null; }
    // Si el número aparece en varias cuentas hay algo NUEVO que mirar: eso manda sobre la marca.
    if(r && r.telefono && r.telefono.varios) return null;
    const uN=_altaNormU(g.usuario);
    const confirma=(r && r.telefono && r.telefono.exacto && _altaNormU(r.telefono.exacto.usuario)===uN)
                 ||(r && r.usuario  && r.usuario.exacto  && _altaNormU(r.usuario.exacto.usuario)===uN);
    return confirma ? g : null;
  }catch(_e){ return null; }
}
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
  // Buscador WTK por el teléfono Y por el usuario. Antes iba un solo término (el teléfono si vino):
  // con un número nuevo o mal tipeado el usuario nunca se buscaba y la tarjeta decía "no hay cuenta
  // con este usuario" de alguien vinculado hace meses (jugador01, 6/11).
  // La identidad (veredicto del servidor con la historia de los dos) va en paralelo.
  // Su luz en el semáforo (IDENTIDAD): OK sólo si el servidor contestó con un veredicto conocido. Si
  // la consulta se cae, la tarjeta vuelve a lo de antes sin avisar: por eso queda a la vista.
  const _identidad = (async function(){
    const salud=window.NodoSalud?.begin?.('IDENTIDAD');
    try{
      if(typeof supabaseClient==='undefined' || !supabaseClient) return null;
      const pc=String((typeof pcOperativa!=='undefined'&&pcOperativa)||window.pcOperativa||'');
      if(!pc) return null;
      const r=await supabaseClient.rpc('panel_identidad_cotejo',{p_secret:window.PANEL_DATA_SECRET, p_pc_codigo:pc, p_usuario:String(usuarioDecl||''), p_telefono:String(telefonoDecl||'')});
      salud?.reply?.(r && r.error);
      const ok = !r.error && r.data && r.data.ok && typeof r.data.veredicto === 'string';
      if(r.error) salud?.record?.('DATA', (r.error.code==='PGRST202'||r.error.code==='42883') ? 'UNKNOWN' : 'ERROR', (r.error.code==='PGRST202'||r.error.code==='42883') ? 'IDENTIDAD_SIN_SERVIDOR' : 'IDENTIDAD_COTEJO_FALLO');
      else salud?.record?.('DATA', ok ? 'OK' : 'DEGRADED', ok ? 'IDENTIDAD_'+r.data.veredicto : 'IDENTIDAD_RESPUESTA_INVALIDA');
      return ok ? r.data : null;
    }catch(_e){ try{ salud?.record?.('DATA','ERROR','IDENTIDAD_COTEJO_FALLO'); }catch(_x){} return null; }
  })();
  try{
    const _terminos=[tD.length>=6?tD:'', String(usuarioDecl||'').trim()].filter(function(q, i, a){ return q && q.length>=3 && a.indexOf(q)===i; });
    if(_terminos.length && typeof supabaseClient!=='undefined' && supabaseClient){
      const _resps=await Promise.all(_terminos.map(function(q){
        // Promise.resolve: el pedido de supabase sólo tiene then(), no catch(). Encadenado directo
        // tiraba error, se perdía la búsqueda entera y la tarjeta decía "no hay cuenta" (jugador05, 6/11).
        return Promise.resolve(supabaseClient.rpc('panel_crm_vinculos_buscar',{p_pc_codigos:null, p_query:q, p_limit:40, p_secret:window.PANEL_DATA_SECRET})).catch(function(){ return { error:true }; });
      }));
      _resps.forEach(function(r){
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
      });
    }
  }catch(_e){}
  out.identidad = await _identidad;
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
        // operador validaba confiado, y recién ahí saltaba "ese teléfono es de jugador02" — con el
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
// opts.motivo     → queda en la historia del jugador (cambio de número, usuario reemplazado).
// opts.confirmado → el operador ya decidió en la tarjeta de identidad: no se vuelve a preguntar.
async function ejecutarVincular(usuario, telefono, desdeChat, opts){
  opts = opts || {};
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
    // v2: no borra a nadie (el que tenía el número queda como usuario anterior, apuntando a este) y
    // anota el cambio de número con su motivo. Si el servidor todavía no la tiene, la de siempre.
    const _vinc=async(forzar)=>{
      const base={p_secret:window.PANEL_DATA_SECRET,p_pc_codigo:pcCod,p_usuario:usuario,p_telefono:telefono,p_forzar:!!forzar,p_operador:_opVinc};
      const r2=await supabaseClient.rpc('panel_vincular_usuario_v2',Object.assign({p_motivo:opts.motivo||null},base));
      if(!(r2&&r2.error&&(r2.error.code==='PGRST202'||r2.error.code==='42883'))) return r2;
      return forzar ? await supabaseClient.rpc('panel_vincular_usuario',base)
        : await supabaseClient.rpc('panel_vincular_usuario',{p_secret:base.p_secret,p_pc_codigo:pcCod,p_usuario:usuario,p_telefono:telefono,p_operador:_opVinc});
    };
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
        if(!opts.confirmado && !confirm(
          "⚠ CONFLICTO DE TELÉFONO\n\n"+
          "El teléfono "+telefono+" hoy figura de «"+otro+"».\n"+
          "Vos estás validando a «"+usuario+"».\n\n"+
          "Si aceptás:\n"+
          "  · el teléfono pasa a «"+usuario+"»\n"+
          "  · «"+otro+"» queda como usuario anterior de ese número (no se borra)\n"+
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
    // Memoria de ESTA decisión: sin esto el cotejo vuelve a pintar REVISAR por el alias que el
    // cliente tipeó mal, que no deja de estar mal por haberlo validado (Juan, 19/10).
    try{ window._altaMarcarResuelto && window._altaMarcarResuelto(usuario, telefono); }catch(_e){}
    try{ window._altaCotejoRefrescar && window._altaCotejoRefrescar(); }catch(_e){}
    // Aviso al usuario por el chat del portal con su info de ingreso + botón "Ingresar" (background).
    try{
      if(typeof window.nodoEnviarMensajePortal==="function"){
        // La marca lleva usuario|telefono CORREGIDOS: si el operador cambió el tel (o el usuario), el
        // portal revalida con los datos buenos y el botón "Ingresar" funciona sin re-loguear.
        const msg="✅ ¡Listo! Ya validamos tu cuenta.\n\nPara entrar al portal usá:\n👤 Usuario: "+usuario+"\n📱 Teléfono: "+telefono+"\n\nTocá el botón *Ingresar* acá abajo 👇\n⟦INGRESAR:"+usuario+"|"+telefono+"⟧";
        // Con el chat cerrado también tiene que llegarle: está esperando el botón Ingresar.
        (window.nodoIniciarChat||window.nodoEnviarMensajePortal)(usuario,msg,desdeChat).then(rr=>{
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
// ── Identidad: cambio de número o de usuario (6/11) ─────────────────────────────────────────────
// "Redirigir la información al operador, nunca redirigir la identidad del usuario automáticamente"
// (Juan). El servidor (panel_identidad_cotejo) dice qué pasa y con qué historia; acá se muestra y
// decide el operador: es la misma persona (se anota el cambio con su motivo), es otra persona (no
// hereda el usuario viejo), o no hay evidencia (queda pendiente, sin acceso). Nada se aplica solo.
const _ALTA_ID_REVISAR = ['CAMBIO_TELEFONO','TELEFONO_ANTERIOR','TELEFONO_DE_OTRO','USUARIO_REEMPLAZADO'];
function _altaIdentidadBloque(uDecl, tDecl, id){
  if(!id || _ALTA_ID_REVISAR.indexOf(id.veredicto) < 0) return '';
  const esc=escapeHtml, u=id.usuario||{}, t=id.telefono||{}, d=t.dueno||null;
  const fecha=function(x){ const f=new Date(x||''); return isNaN(f)?'':f.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'}); };
  const nombre=function(x){ return '<b>'+esc(String(x||''))+'</b>'; };
  const num=function(x){ return '<b style="font-family:monospace">'+esc(String(x||'—'))+'</b>'; };
  const actividad=function(o){
    if(!o) return '';
    const n=Number(o.operaciones||0);
    return n ? ' · '+n+(n===1?' operación':' operaciones')+(o.ultima_operacion?(', la última el '+fecha(o.ultima_operacion)):'') : ' · sin operaciones';
  };
  const usuario=u.usuario||uDecl, telConsulta=t.telefono||_altaNormTel(tDecl);
  const lineas=[];
  if(id.veredicto==='CAMBIO_TELEFONO'){
    lineas.push(nombre(usuario)+' existe desde el '+fecha(u.desde)+actividad(u)+'.');
    lineas.push('Su número registrado es '+num(u.telefono)+'. Esta consulta viene con '+num(telConsulta)+', que no figura en ninguna cuenta.');
  } else if(id.veredicto==='TELEFONO_ANTERIOR'){
    lineas.push(nombre(usuario)+' pide con '+num(telConsulta)+', un número que antes era suyo. Hoy tiene registrado '+num(u.telefono)+'.');
  } else if(id.veredicto==='TELEFONO_DE_OTRO'){
    lineas.push(nombre(usuario)+' está asociado al teléfono '+num(u.telefono)+actividad(u)+'.');
    lineas.push('El teléfono de esta consulta, '+num(telConsulta)+', hoy figura con '+nombre(d&&d.usuario)+actividad(d)+'.');
  } else {
    lineas.push('Este usuario es antiguo. Anteriormente estaba asociado al teléfono '+num(u.telefono)+'.');
    lineas.push('Actualmente ese teléfono figura con '+nombre(u.vigente)+'. El teléfono de esta consulta es '+num(telConsulta)+'.');
  }
  (id.telefonos_anteriores||[]).slice(0,2).forEach(function(x){
    lineas.push('<span style="color:#8b949e">'+nombre(usuario)+' antes usaba '+num(x.anterior)+' (cambiado el '+fecha(x.cuando)+(x.operador?(' por '+esc(x.operador)):'')+(x.nota?(' · '+esc(x.nota)):'')+').</span>');
  });
  (id.usuarios_anteriores||[]).slice(0,2).forEach(function(x){
    lineas.push('<span style="color:#8b949e">Este número antes lo usaba '+nombre(x.usuario)+' (hasta el '+fecha(x.cuando)+').</span>');
  });
  // Historia o CBU de cobro del usuario de la consulta: alerta fuerte, decide una persona.
  const fuerte = (Number(u.operaciones||0) > 0 || u.tiene_cbu) && (id.veredicto==='TELEFONO_DE_OTRO' || id.veredicto==='USUARIO_REEMPLAZADO');
  if(fuerte) lineas.push('<b style="color:#ff7b72">'+esc(usuario)+' tiene '+Number(u.operaciones||0)+' operaciones'+(u.tiene_cbu?' y cuenta de cobro':'')+': decidí vos antes de validar.</b>');
  if(u.vigente) lineas.push('<span style="color:#8b949e">El último usuario validado con ese número es '+nombre(u.vigente)+'. Es un dato, no se aplica solo.</span>');
  lineas.push('<span style="color:#8b949e">No se redirecciona automáticamente.</span>');
  const col = fuerte ? { c:'#ff7b72', bg:'rgba(248,81,73,.12)', bd:'rgba(248,81,73,.50)', ico:'🚨' }
                     : { c:'#e3b341', bg:'rgba(227,179,65,.11)', bd:'rgba(227,179,65,.42)', ico:'⚠️' };
  const titulo = id.veredicto==='CAMBIO_TELEFONO' ? 'Cambio de número'
               : id.veredicto==='TELEFONO_ANTERIOR' ? 'Número anterior'
               : id.veredicto==='TELEFONO_DE_OTRO' ? 'Número de otro usuario' : 'Usuario antiguo';
  const datos=' data-u="'+esc(usuario)+'" data-t="'+esc(telConsulta)+'" data-v="'+esc(id.veredicto)+'"';
  const boton=function(dec, texto, fondo){
    return '<button type="button" onclick="altaIdentidadDecidir(\x27'+dec+'\x27,this)"'+datos
      +' style="border:0;border-radius:7px;padding:6px 9px;font-size:11.5px;font-weight:800;cursor:pointer;background:'+fondo+';color:#fff;margin:3px 4px 0 0">'+texto+'</button>';
  };
  const misma = id.veredicto==='USUARIO_REEMPLAZADO' ? 'Es '+esc(usuario)+': este número reemplaza al anterior'
              : 'Es '+esc(usuario)+': '+esc(telConsulta)+' pasa a ser su número';
  return '<div style="border:1px solid '+col.bd+';border-radius:10px;background:#0d1117;overflow:hidden">'
    +   '<div style="display:flex;align-items:center;gap:7px;padding:5px 10px;background:'+col.bg+';border-bottom:1px solid '+col.bd+'">'
    +     '<span style="font-size:12px;line-height:1">'+col.ico+'</span>'
    +     '<span style="font-weight:800;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:'+col.c+'">'+titulo+' · revisión humana</span>'
    +   '</div>'
    +   '<div style="padding:7px 10px;font-size:12px;line-height:1.45;color:#c9d1d9">'+lineas.map(function(l){ return '<div style="margin-bottom:3px">'+l+'</div>'; }).join('')
    +     '<div style="margin-top:6px">'
    +       boton('MISMA', misma, '#238636')
    +       boton('OTRA', 'Es otra persona', '#1f6feb')
    +       boton('PENDIENTE', 'Sin evidencia: queda pendiente', '#30363d')
    +     '</div>'
    +   '</div>'
    + '</div>';
}
window.altaIdentidadDecidir = async function(dec, el){
  const usuario=(el&&el.getAttribute('data-u'))||'', tel=(el&&el.getAttribute('data-t'))||'', ver=(el&&el.getAttribute('data-v'))||'';
  if(!usuario) return;
  const _op=(typeof operador!=='undefined' && operador && (operador.usuario||operador.nombre)) || '';
  const pc=String((typeof pcOperativa!=='undefined'&&pcOperativa)||window.pcOperativa||'');
  if(dec==='MISMA'){
    const sugerido = ver==='USUARIO_REEMPLAZADO' ? 'volvió con otro número' : 'perdió el número';
    const motivo = prompt('¿Por qué '+tel+' pasa a ser el número de '+usuario+'? Queda en su historia.', sugerido);
    if(motivo===null) return;
    if(!String(motivo).trim()){ toast('Escribí el motivo: queda registrado.','yellow'); return; }
    return ejecutarVincular(usuario, tel, true, { motivo:String(motivo).trim(), confirmado:true });
  }
  const decision = dec==='OTRA' ? 'OTRA_PERSONA' : 'SIN_EVIDENCIA';
  const motivo = prompt(dec==='OTRA' ? 'Es otra persona: no hereda '+usuario+'. ¿Algo para dejar anotado?' : 'Queda pendiente, sin acceso. ¿Qué falta?',
    dec==='OTRA' ? 'el número es de otra persona' : 'no hay datos suficientes');
  if(motivo===null) return;
  try{
    const r=await supabaseClient.rpc('panel_identidad_decision',{p_secret:window.PANEL_DATA_SECRET,p_pc_codigo:pc,p_usuario:usuario,p_telefono:tel,p_decision:decision,p_motivo:String(motivo||'').trim()||null,p_operador:_op});
    if(r.error || !(r.data&&r.data.ok)) throw new Error((r.error&&r.error.message)||(r.data&&r.data.mensaje)||'error');
  }catch(e){ toast('No se pudo anotar la decisión: '+(e.message||e),'red'); return; }
  if(dec==='OTRA'){
    toast('Anotado: es otra persona. Creá o validá su cuenta; no hereda '+usuario+'.','blue');
    try{ abrirModalVincular('', tel, false, true); }catch(_e){}
  } else {
    toast('Queda pendiente, sin acceso. No se tocó ningún vínculo.','blue');
  }
};
function _altaCotejoHtml(uDecl, tDecl, r, onPick, titulo, resuelto){
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
    // Y sólo caracteres que no rompan nada: el teléfono sale del mensaje con lo que le sigue ("Tel:
    // 1131388204." + el salto de línea del próximo mensaje) y ese salto dentro del onclick lo dejaba
    // con "Invalid or unexpected token": el botón no hacía nada (pepe, 6/11).
    const _q = String.fromCharCode(39);
    const _u = esc(String(uDecl||'').replace(/[^A-Za-z0-9._-]/g,'')), _t = esc(String(tDecl||'').replace(/\D/g,''));
    acciones = '<div style="margin-top:7px"><button type="button" onclick="_altaCrearDesdeCotejo('+_q+_u+_q+','+_q+_t+_q+')"'
      + ' style="cursor:pointer;background:rgba(18,183,106,.12);border:1px solid rgba(18,183,106,.55);color:#3fb950'
      + ';border-radius:8px;padding:5px 11px;font-size:11px;font-weight:800">➕ Crear la cuenta y mandarle los datos</button></div>';
  }
  // ── YA VALIDADO DESDE ACÁ ─────────────────────────────────────────────────────────────────
  // Resuelta la consulta, la tarjeta deja de ser un cotejo y pasa a ser un recibo: qué quedó
  // validado. Los botones "usar fulano" se van porque ya no hay nada que elegir (Juan, cinco
  // veces: cada fila ofrece sólo lo que SE PUEDE hacer sobre esa fila).
  if(resuelto && resuelto.usuario){
    const _rT=_altaNormTel(resuelto.telefono);
    filas = fila('Usuario', esc(resuelto.usuario), '✓ validado', '#3fb950',
              (uDecl && _altaNormU(resuelto.usuario)!==uDeclN)
                ? sub('El cliente había escrito <b style="color:#c9d1d9">'+esc(uDecl)+'</b>') : '')
          + (_rT ? fila('Teléfono', esc(_rT), '✓ validado', '#3fb950',
              (tN.length>=6 && _rT!==tN)
                ? sub('Había declarado <b style="color:#c9d1d9">'+esc(tN)+'</b>') : '') : '');
    pie='Validado y agendado. Si escribió por el portal, ya recibió el botón para ingresar.';
    // El rótulo "declaró el cliente" de la esquina ya no corresponde: las filas de arriba
    // muestran la cuenta REAL con la que quedó validado, no lo que el cliente escribió.
    alerta=false; conflicto=false; acciones=''; titulo='';
  }
  const nivel = (resuelto && resuelto.usuario) ? 'validado'
              : conflicto ? 'conflicto' : alerta ? 'revisar' : (uOk||tOk) ? 'ok' : 'nuevo';
  const T = {
    ok:        { c:'#3fb950', bg:'rgba(63,185,80,.10)',  bd:'rgba(63,185,80,.38)',  ico:'✅' },
    validado:  { c:'#3fb950', bg:'rgba(63,185,80,.14)',  bd:'rgba(63,185,80,.50)',  ico:'✅' },
    nuevo:     { c:'#58a6ff', bg:'rgba(88,166,255,.09)', bd:'rgba(88,166,255,.32)', ico:'🆕' },
    revisar:   { c:'#e3b341', bg:'rgba(227,179,65,.11)', bd:'rgba(227,179,65,.42)', ico:'⚠️' },
    conflicto: { c:'#ff7b72', bg:'rgba(248,81,73,.12)',  bd:'rgba(248,81,73,.50)',  ico:'🚨' }
  }[nivel];
  const etiqueta = nivel==='validado'  ? 'Validado'
                 : nivel==='conflicto' ? 'No coinciden'
                 : (nivel==='revisar' && _typoPropio) ? 'Teléfono mal tipeado'
                 : (nivel==='revisar' && _telCompartido) ? 'Teléfono en dos cuentas'
                 : nivel==='revisar'   ? 'Revisar'
                 : nivel==='nuevo'     ? 'Sin usuario'
                 : (uOk&&tOk)          ? 'Coinciden'
                 : uOk                 ? 'Usuario en sistema' : 'Teléfono en sistema';

  // Si el servidor dice que hay un cambio de número o de usuario, esa tarjeta manda: la de abajo
  // podía decir "coinciden" o "no hay cuenta" sobre el mismo caso. Lo ya validado se ve como siempre.
  const _idBloque = (resuelto && resuelto.usuario) ? '' : _altaIdentidadBloque(uDecl, tDecl, r.identidad);
  if(_idBloque) return { html:_idBloque, alerta:true, nivel:'revisar' };

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
  const out=_altaCotejoHtml(uDecl, t, r, '_altaUsarSugerencia', uInp?'':'declaró el cliente', _altaResuelto(uDecl, t, r));
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
  if(!ticket){ cont.innerHTML=''; window.__altaCotejoDecl=null; return; }
  // 1) Lo DECLARADO por el cliente, parseado del mensaje
  let txt='', ingU='', ingT='';
  try{
    const th=ticket.thread||ticket.mensajes||[];
    // Sólo lo que escribió el JUGADOR. Con todo el hilo, el "Usuario: noex90" del mensaje de
    // validación pasaba por lo declarado, la marca de "ya validado" no coincidía y la tarjeta
    // volvía a pedir revisión (Juan, 2/11).
    const delJugador=function(m){
      const r=window.NodoChatMessage && window.NodoChatMessage.role ? window.NodoChatMessage.role(m) : '';
      if(r) return r==='USUARIO';
      const o=String((m&&(m.origen||m.tipo_emisor||m.TIPO_EMISOR))||'').toUpperCase();
      return !o || o==='USUARIO' || o==='CLIENTE';
    };
    txt=(Array.isArray(th)?th:[]).filter(delJugador).map(function(m){ return String((m&&(m.mensaje||m.texto||m.body||m.MENSAJE))||''); }).join(' \n ');
    // El aviso de validación lleva el usuario y el teléfono validados (⟦INGRESAR:usuario|teléfono⟧).
    // Si ya salió, la consulta está resuelta con ESOS datos, aunque el jugador haya escrito mal el
    // teléfono: la marca local nunca coincidía con lo declarado y la tarjeta quedaba en revisión para
    // siempre (Juan, 2/11). Sale de la conversación, así que vale en cualquier PC.
    (Array.isArray(th)?th:[]).forEach(function(m){
      if(delJugador(m)) return;
      const x=String((m&&(m.mensaje||m.texto||m.MENSAJE))||'').match(/⟦INGRESAR:([^|⟧]*)\|?([^⟧]*)⟧/);
      if(x && x[1].trim()){ ingU=x[1].trim(); ingT=x[2].trim(); }
    });
  }catch(_e){}
  const mU=txt.match(/usuario\s*[:\-]?\s*([A-Za-z0-9._-]{3,})/i);
  const mT=txt.match(/(?:tel|telefono|tel[eé]fono|cel|celular)\s*[:.\-]?\s*([\d\s().\-]{6,})/i);
  let uDecl=mU?String(mU[1]).replace(/[.,;]+$/,''):String(ticket.usuario||'');
  let tDecl=mT?String(mT[1]):String(ticket.telefono||ticket.TELEFONO||'');
  if(ingU){
    uDecl=ingU; tDecl=ingT||tDecl;
    // Igual se confirma contra el padrón antes de pintar verde (_altaResuelto).
    try{ const m=_altaResLeer(), k=_altaResKey(uDecl,tDecl); if(!m[k]){ m[k]={ usuario:ingU, telefono:ingT, cuando:Date.now() }; _altaResGuardar(m); } }catch(_e){}
  }
  if(!uDecl && _altaNormTel(tDecl).length<6){ cont.innerHTML=''; return; }
  // Cache por ticket: no re-cotejar en cada repintado del chat (que ocurre en cada poll)
  const key=_altaNormU(uDecl)+'|'+_altaNormTel(tDecl);
  window.__altaCotejoTicket=ticket;   // para poder re-cotejar tras vincular (ver _altaCotejoRefrescar)
  // Lo DECLARADO, para que _altaMarcarResuelto sepa a qué consulta pertenece la validación.
  window.__altaCotejoDecl={ u:uDecl, t:tDecl };
  if(cont.dataset.key===key) return;
  // Si los mensajes faltan un momento, el teléfono declarado no se olvida: la tarjeta se redibujaba
  // y el botón de crear la cuenta se reemplazaba debajo del clic (Juan, 2/11: "no funciona").
  if(!_altaNormTel(tDecl) && cont.dataset.key && cont.dataset.key.split("|")[0]===_altaNormU(uDecl) && cont.dataset.key.split("|")[1]) return;
  cont.dataset.key=key;
  cont.innerHTML='<div class="small" style="color:#8b949e">🔎 cotejando usuario y teléfono en la base…</div>';
  let r; try{ r=await window.altaCotejarDatos(uDecl,tDecl); }catch(_e){ cont.innerHTML=''; return; }
  if(cont.dataset.key!==key) return;  // llegó otro ticket mientras tanto
  const out=_altaCotejoHtml(uDecl, tDecl, r, '_altaAbrirVincular', 'declaró el cliente', _altaResuelto(uDecl, tDecl, r));
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
