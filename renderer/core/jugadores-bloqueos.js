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
  try{ window.NodoPersistenciaSync?.scheduleSync?.(); }catch(_e){}

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
  try{ window.NodoPersistenciaSync?.scheduleSync?.(); }catch(_e){}
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
// Suma un dato a la ficha de un jugador dentro de `map`, sin leer ni escribir el almacén.
function _jugAplicarDato(map, usuario, dato){
  const u = String(usuario||'').toLowerCase().trim();
  if(!u || !dato) return;
  {
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
  }
}
window.jugadorRegistrarDato = function(usuario, dato){
  if(!usuario || !dato) return;
  try{
    const map = _jugStoreAll();
    _jugAplicarDato(map, usuario, dato);
    _jugStoreSave(map);
  }catch(_e){}
};
// Una tanda entera con una sola lectura y una sola escritura del almacén. Uno por uno, cada dato
// leía y reescribía el almacén completo: al arrancar se siembran cientos de filas y en la PC de
// Sánchez la pantalla quedaba trabada 36 s después de entrar a Chunior, hasta que Electron la
// recargaba y vuelta a empezar (6/11). `lista` es [[usuario, dato], ...].
window.jugadorRegistrarDatos = function(lista){
  if(!Array.isArray(lista) || !lista.length) return;
  try{
    const map = _jugStoreAll();
    lista.forEach(function(par){ try{ _jugAplicarDato(map, par && par[0], par && par[1]); }catch(_e){} });
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
    const tanda = [];
    Object.keys(all).forEach(function(k){
      const m = all[k]||{};
      const esRet = String(m.tipo||'').toUpperCase()==='RETIRO';
      if(m.usuario && ((esRet && (m.cbu||m.destino)) || m.titular))
        tanda.push([m.usuario, { cbu: esRet ? (m.cbu||m.destino) : '', titular:m.titular, fecha:m._fecha }]);
    });
    jugadorRegistrarDatos(tanda);
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
  try{ window.NodoPersistenciaSync?.scheduleSync?.(); }catch(_e){}
  }catch(e){ console.warn('[titulares bloqueados] sync', e); }
};
