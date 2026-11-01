// INTEGRACIÓN CON NEXO (opcional, no estricta · portado de NexoBetaChan). Contrato verificado:
// nodo es DUEÑO de %APPDATA%\nexo-desktop\shared\nodo-datos.json (JSON PLANO). Nexo lo lee al abrir
// y fusiona. Join por alias normalizado (Nexo normaliza; nodo manda el usuario tal cual). Schema:
//   { schemaVersion:1, generatedAt, usuarios:[{ alias, telefono, titular, portalActivo, operaciones:[
//       { ts, amount(>0 carga /<0 retiro), tipo, medio, cbu, titular, operador } ] , bonos:[...] }] }
// Nexo dedup por ts+amount → mandamos todo el historial siempre (idempotente). Si Nexo NO está
// instalado (no existe %APPDATA%\nexo-desktop) → el write devuelve installed:false y no hace NADA.
// telefono + titular a NIVEL USUARIO completan el registro (el tel llega con la solicitud y ya
// quedó en el jug store; el titular sale de los retiros conocidos). Depende de la base local de
// JUGADORES (abajo) y de _movParseNotas / pcAliasesHist / historial_ops.
// ══════════════════════════════════════════════════════════════════════════
const _NEXO_OK_ESTADOS = ['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA'];
function _nexoBonoDesc(pct){
  pct = Number(pct||0);
  let extra = '';
  if(pct>=50) extra = ' + notificaciones + app';
  else if(pct>=40) extra = ' + app instalada';
  else if(pct>=30) extra = ' + notificaciones';
  return 'Bono de primer ingreso'+extra+(pct?(' ('+pct+'%)'):'');
}
// Historia COMPLETA desde Supabase (Nexo quiere TODO, no solo lo local de la sesión). Cache 15 min;
// el sync la mezcla con el archivo local (que trae lo de tiempo real).
window._nexoOpsCache = window._nexoOpsCache || null;
window._nexoOpsCacheAt = window._nexoOpsCacheAt || 0;
window._nexoEstado = window._nexoEstado || { mode: 'legacy', completo: false, analizadas: 0, total: null, corteFecha: null };
window._nexoCapCache = window._nexoCapCache || {};
async function _nexoCargarOpsBeta(pc){
  if(!pc || !window.panelAPI || typeof window.panelAPI.rpc !== 'function') return null;
  try{
    if(typeof window.panelAPI.getContext === 'function'){
      const rawCtx = await window.panelAPI.getContext();
      const ctx = (rawCtx && rawCtx.beta) ? rawCtx.beta : rawCtx;
      if(!ctx || ctx.enabled !== true || (Array.isArray(ctx.offices) && !ctx.offices.includes(pc))) return null;
    }
    if(window._nexoCapCache[pc] !== true){
      const capRes = await window.panelAPI.rpc('nodo_beta_capacidades_v1', { p_pc_codigo: pc, p_activate: false });
      const capData = capRes && capRes.data;
      const caps = (capData && Array.isArray(capData.capabilities)) ? capData.capabilities : [];
      if(!capData || capData.ok !== true || capData.enabled !== true || !caps.includes('nexo.export.v1')) return null;
      window._nexoCapCache[pc] = true;
    }
    let todas = [], cursor = null, paginas = 0, total = null, completo = true;
    while(paginas < 16){
      const r = await window.panelAPI.rpc('nodo_beta_nexo_export_v1', { p_pc_codigo: pc, p_limit: 500, p_cursor: cursor });
      if(!r || r.error || !r.data || r.data.ok !== true || !Array.isArray(r.data.rows)) return null;
      todas = todas.concat(r.data.rows);
      total = r.data.total != null ? Number(r.data.total) : total;
      paginas++;
      if(!r.data.has_more || !r.data.next_cursor){ completo = true; break; }
      cursor = r.data.next_cursor;
      completo = false;
    }
    const ult = todas.length ? todas[todas.length - 1] : null;
    window._nexoEstado = { mode: 'beta', completo: completo, analizadas: todas.length, total: total, corteFecha: ult ? ult.created_at : null };
    return todas;
  }catch(_e){ return null; }
}
async function _nexoCargarOpsCompletas(force){
  const FRESH = 15*60*1000;
  const health = window.NodoSalud?.begin('NEXO');
  const pc = String((typeof pcOperativa!=='undefined' && pcOperativa) || window.pcOperativa || '').trim().toUpperCase();
  if(!force && window._nexoOpsCache && (Date.now()-window._nexoOpsCacheAt) < FRESH) return window._nexoOpsCache;
  const betaRows = await _nexoCargarOpsBeta(pc);
  if(Array.isArray(betaRows)){
    window._nexoOpsCache = betaRows;
    window._nexoOpsCacheAt = Date.now();
    health?.reply(null);
    health?.record('DATA', window._nexoEstado.completo ? 'OK' : 'DEGRADED', window._nexoEstado.completo ? 'NEXO_EXPORT_COMPLETE' : 'NEXO_EXPORT_TRUNCATED');
    return betaRows;
  }
  if(!force && window._nexoOpsCache && (Date.now()-window._nexoOpsCacheAt) < FRESH) return window._nexoOpsCache;
  try{
    if(typeof supabaseClient==='undefined' || !supabaseClient) return window._nexoOpsCache||[];
    const pcs = (typeof pcAliasesHist==='function') ? pcAliasesHist() : [];
    let todas = [], desde = 0; const PAG = 1000, MAX = 8000;
    while(desde < MAX){
      const { data, error } = await supabaseClient.from('historial_ops')
        .select('id,usuario,tipo,monto,billetera_nombre,origen,estado,notas,created_at,operador,chunior_movimiento_id')
        .in('pc_codigo', pcs)
        .order('created_at',{ascending:false})
        .range(desde, desde+PAG-1);
      if(error || !data || !data.length) break;
      todas = todas.concat(data);
      if(data.length < PAG) break;
      desde += PAG;
    }
    if(todas.length){
      window._nexoOpsCache = todas;
      window._nexoOpsCacheAt = Date.now();
      const completo = todas.length < MAX;
      const ult = todas[todas.length - 1];
      window._nexoEstado = { mode: 'legacy', completo: completo, analizadas: todas.length, total: completo ? todas.length : null, corteFecha: ult ? ult.created_at : null };
      health?.reply(null);
      health?.record('DATA', completo ? 'OK' : 'DEGRADED', completo ? 'NEXO_LEGACY_OK' : 'NEXO_LEGACY_TRUNCATED_8000');
    }
  }catch(_e){}
  return window._nexoOpsCache || [];
}
// opsExtra = historia completa de Supabase. Se mergea con el archivo local + movStore (dedup por id)
// → el payload lleva TODO el historial, no solo lo de esta sesión.
function _nexoBuildPayload(opsExtra){
  const jug = (typeof _jugStoreAll==='function') ? _jugStoreAll() : {};
  const _byId = {};
  ((typeof _archivoHistorialCargar==='function') ? _archivoHistorialCargar() : []).forEach(function(h){ if(h&&h.id!=null) _byId[String(h.id)]=h; });
  (Array.isArray(opsExtra)?opsExtra:[]).forEach(function(h){ if(h&&h.id!=null && !_byId[String(h.id)]) _byId[String(h.id)]=h; });
  try{ if(typeof _movStoreToHistRows==='function') _movStoreToHistRows().forEach(function(h){ if(h&&h.id!=null && !_byId[String(h.id)]) _byId[String(h.id)]=h; }); }catch(_e){}
  const ops = Object.keys(_byId).map(function(k){ return _byId[k]; });
  const porUsuario = {};
  ops.forEach(function(h){
    const usuario = String(h.usuario||'').trim(); if(!usuario) return;
    const tipoU = String(h.tipo||'').toUpperCase();
    if(tipoU!=='CARGA' && tipoU!=='RETIRO') return;                         // solo cargas/retiros
    if(String(h.origen||'').toUpperCase()==='PROMO_BONO') return;           // los bonos van aparte (campo bonos)
    if(!_NEXO_OK_ESTADOS.includes(String(h.estado||'').toUpperCase())) return; // solo las efectivas
    const ts = h.created_at ? new Date(h.created_at).getTime() : 0; if(!ts) return;
    const monto = Math.abs(Number(h.monto||0)); if(!monto) return;
    const esRet = tipoU==='RETIRO';
    const p = (typeof _movParseNotas==='function') ? _movParseNotas(h.notas) : {titular:'',cbu:'',destino:''};
    const k = usuario.toLowerCase();
    if(!porUsuario[k]) porUsuario[k] = { alias:usuario, telefono:'', titular:'', portalActivo:false, _seen:{}, operaciones:[] };
    const g = porUsuario[k];
    const _origen = String(h.origen||'').toUpperCase();
    const _esPortal = /PORTAL|LANDING/.test(_origen);
    if(_esPortal) g.portalActivo = true;
    const dk = ts+'|'+(esRet?-monto:monto);
    if(g._seen[dk]) return; g._seen[dk]=1;                                   // dedup local por ts+amount
    g.operaciones.push({
      ts: ts,
      amount: esRet ? -monto : monto,                                       // >0 carga · <0 retiro
      tipo: esRet ? 'retiro' : 'carga',
      // CANAL: separa a los que cargan por PORTAL de los que lo hacen por WhatsApp/manual. El tipo de
      // origen ya divide a los usuarios en el panel → se lo pasamos a Nexo para que los segmente igual.
      canal: _esPortal ? 'portal' : 'whatsapp',
      origen: _origen || '',                                                // origen crudo (PORTAL/LANDING/MANUAL/PANEL/CHAT) por si Nexo quiere más granularidad
      medio: String(h.billetera_nombre||'').trim(),                         // etiqueta de billetera nuestra
      cbu: esRet ? String(p.cbu||p.destino||'').trim() : '',               // alias/CBU del usuario (retiros)
      titular: esRet ? String(p.titular||'').trim() : '',                  // titular de esa cuenta (retiros)
      operador: String(h.operador||'').trim()
    });
  });
  // ALTAS / VALIDACIONES SIN OPERACIONES: un usuario recién validado (o creado) todavía no cargó
  // nunca → no aparece en `ops` y antes NO se enviaba a Nexo. Lo sembramos desde la base local de
  // jugadores para que Nexo tenga la ficha (alias + teléfono + titular) desde el momento del alta:
  // Nexo es la base donde después se verifican los datos.
  Object.keys(jug||{}).forEach(function(k){
    if(porUsuario[k]) return;
    const j=jug[k]||{};
    const tieneDatos = (j.telefonos && Object.keys(j.telefonos).length) || (j.titulares && Object.keys(j.titulares).length);
    if(!tieneDatos) return;
    porUsuario[k]={ alias:j.usuario||k, telefono:'', titular:'', portalActivo:false, _seen:{}, operaciones:[], altaSinOperaciones:true };
  });
  Object.keys(porUsuario).forEach(function(k){
    const j = jug[k];
    // TELÉFONO (nivel usuario · completa la base de Nexo): el que llega con la solicitud ya quedó en
    // el jug store. Elegimos el verificado; si no, el más visto.
    if(j && j.telefonos){
      const tels = Object.keys(j.telefonos);
      if(tels.length){
        tels.sort(function(a,b){ const A=j.telefonos[a]||{}, B=j.telefonos[b]||{}; return ((B.verificado?1:0)-(A.verificado?1:0)) || ((B.veces||0)-(A.veces||0)); });
        porUsuario[k].telefono = tels[0];
      }
    }
    // TITULAR (nivel usuario · completa la base de Nexo): el titular más visto del jugador (de sus
    // retiros/CBUs conocidos). Va a nivel usuario, no solo por operación de retiro.
    if(j && j.titulares){
      const tits = Object.values(j.titulares);
      if(tits.length){
        tits.sort(function(a,b){ return (b.veces||0)-(a.veces||0); });
        if(tits[0] && tits[0].raw) porUsuario[k].titular = tits[0].raw;
      }
    }
    // Bonos DESTACADOS con tipo + descripción (de la base local de jugadores).
    if(j && Array.isArray(j.bonos) && j.bonos.length){
      porUsuario[k].bonos = j.bonos.map(function(b){
        return {
          tipo: 'ingreso',
          pct: Number(b.pct||0)||null,
          monto: Number(b.monto||0)||null,
          estado: (String(b.estado||'').toUpperCase()==='APLICADO') ? 'aplicado' : 'pendiente',
          ts: b.fecha ? new Date(b.fecha).getTime() : null,
          descripcion: _nexoBonoDesc(b.pct)
        };
      });
    }
    delete porUsuario[k]._seen;
  });
  // ── IPs desde las que operó ────────────────────────────────────────────────
  // Se saca de las solicitudes del portal que ya están en memoria (metadata.ip) y se manda a
  // Nexo. NODO NO la guarda en ninguna base propia: acá es un dato de paso. La acumulación
  // histórica vive en Nexo, que es donde tiene sentido cruzarla.
  //
  // Para qué: ver cuántas cuentas salen de la MISMA conexión — probabilidad de que sean la
  // misma persona o gente cercana.
  //
  // Cómo NO usarla: con CGNAT y redes móviles muchos vecinos comparten IP pública. Coincidir
  // es una señal para mirar, no una prueba. Y NO se usa para bloquear: un bloqueo automático
  // por IP en manos de siete oficinas distintas deja gente afuera por vivir en el edificio
  // equivocado, y nadie va a poder explicar por qué.
  try{
    const _sols = (window.V154P && window.V154P.solicitudes) || [];
    _sols.forEach(function(s){
      const u = String(s.USUARIO || s.USUARIO_JUGADOR || '').trim().toLowerCase();
      const ip = String(s.IP || '').trim();
      if(!u || !ip || !porUsuario[u]) return;
      const g = porUsuario[u];
      if(!g.ips) g.ips = [];
      const prev = g.ips.find(function(x){ return x.ip === ip; });
      const ts = s.FECHA_CREACION ? new Date(s.FECHA_CREACION).getTime() : 0;
      if(prev){ prev.veces++; if(ts > (prev.ultima||0)) prev.ultima = ts; }
      else if(g.ips.length < 12){ g.ips.push({ ip: ip, veces: 1, ultima: ts }); }
    });
    Object.keys(porUsuario).forEach(function(k){
      const g = porUsuario[k];
      if(g.ips) g.ips.sort(function(a,b){ return (b.veces||0)-(a.veces||0); });
    });
  }catch(_e){}
  // Se envían: los que operaron, los que tienen bonos, y las ALTAS con teléfono/titular (agendados).
  const usuarios = Object.values(porUsuario).filter(function(u){
    return u.operaciones.length || (u.bonos&&u.bonos.length) || u.telefono || u.titular;
  });
  // pc_codigo = la LLAVE de oficina. Nexo no debe tener ninguna oficina configurada a mano: le
  // pregunta a NODO (leyendo este archivo) de qué oficina es esta PC. NODO es el único que lo sabe
  // de verdad — lo detecta de Chunior al loguear, no sale de la ruta de instalación ni de un
  // config. Así el mismo instalador de Nexo sirve en cualquier máquina. Ver NEXO_INTEGRACION.md.
  const _pc = String((typeof pcOperativa!=='undefined' && pcOperativa) || window.pcOperativa || '').trim();
  return {
    schemaVersion:3,
    generatedAt:new Date().toISOString(),
    pc_codigo:_pc || null,                 // null = NODO todavía no sabe la oficina → Nexo NO asume ninguna
    operador:(window.operador && (window.operador.usuario||window.operador.nombre)) || '',
    // A QUÉ SERVIDOR apuntar. Hay más de un Supabase en juego (mirá el bloque de SUPABASE_URL: hay
    // otro comentado) y se cambia editando el código. Si Nexo lo tuviera hardcodeado, al cambiar de
    // servidor quedaría leyendo el viejo —datos de otra base— sin que nadie se entere. Mandándolo
    // desde acá, Nexo siempre habla con el MISMO servidor que NODO, sin configurar nada.
    // La key es la publishable (anon): ya viaja dentro de la app en cada máquina y está protegida
    // por RLS. No es un secreto; el secreto es PANEL_DATA_SECRET, que NO se manda.
    supabase:{ url:SUPABASE_URL, key:SUPABASE_KEY },
    // Acuse de los pedidos que Nexo encoló y NODO aplicó. Con esto Nexo los saca de su cola; los
    // que no aparezcan acá los reintenta (es idempotente, reintentar de más no rompe nada).
    pedidosAplicados: (window._nexoAcuses||[]).slice(),
    usuarios:usuarios
  };
}
// ══════════════════════════════════════════════════════════════════════════════════════════
// PEDIDOS DE NEXO · Nexo encola, NODO aplica
// Nexo no puede escribir identidades: panel_vincular_usuario exige PANEL_DATA_SECRET y ese secreto
// no se comparte. Entonces Nexo deja sus pedidos en nexo-pedidos.json y NODO los aplica con su
// secreto. Nadie comparte nada y NODO decide qué se escribe.
// El acuse ({id, ok, error, ts}) viaja en el próximo nodo-datos.json; con eso Nexo saca el pedido
// de su cola. Sin acuse lo reintenta — es idempotente.
//
// ⚠ CANDADO: mientras panel_vincular_usuario compare el usuario CRUDO (bug documentado, fix en
// SQL_fix_vincular_usuario_limpio.sql), cada pedido puede DUPLICAR al usuario en el servidor. Por
// eso esto arranca APAGADO. Se prende con window.nexoPedidosActivar(true) DESPUÉS de aplicar el
// SQL. Lo pidió el propio lado de Nexo y tiene razón.
// ══════════════════════════════════════════════════════════════════════════════════════════
window.nexoPedidosActivar = function(on){
  try{ localStorage.setItem('nodo_nexo_pedidos', on===true?'1':'0'); }catch(_e){}
  toast(on===true ? '✅ Pedidos de Nexo ACTIVADOS' : '⛔ Pedidos de Nexo apagados', on===true?'green':'yellow');
};
function _nexoPedidosActivo(){ try{ return localStorage.getItem('nodo_nexo_pedidos')==='1'; }catch(_e){ return false; } }

window._nexoAcuses = [];        // {id, ok, error, ts} — se vacía cuando se escriben en el payload
let _nexoPedidosCorriendo = false;

async function _nexoProcesarPedidos(){
  if(!_nexoPedidosActivo()) return;
  if(_nexoPedidosCorriendo) return;
  if(!window.nexoFile || !window.nexoFile.pedidos) return;   // build viejo sin el puente de lectura
  if(!pcOperativa || !window.PANEL_DATA_SECRET) return;
  _nexoPedidosCorriendo = true;
  try{
    const r = await window.nexoFile.pedidos();
    if(!r || !r.ok || !Array.isArray(r.pedidos) || !r.pedidos.length) return;
    // La oficina del archivo tiene que ser LA MÍA. Si no, es de otra PC y no lo tocamos.
    if(r.pc_codigo && String(r.pc_codigo).trim().toUpperCase() !== String(pcOperativa).trim().toUpperCase()){
      console.warn('[nexo] pedidos de otra oficina ('+r.pc_codigo+' ≠ '+pcOperativa+') — ignorados');
      return;
    }
    const yaAcusados = new Set((window._nexoAcuses||[]).map(function(a){ return String(a.id); }));
    for(const p of r.pedidos){
      const id = String((p&&p.id)||''); if(!id || yaAcusados.has(id)) continue;
      const acuse = { id:id, ok:false, error:null, ts:Date.now() };
      try{
        if(String(p.tipo||'') !== 'vincular_telefono'){ acuse.error='tipo no soportado: '+p.tipo; }
        else if(!p.usuario || !p.telefono){ acuse.error='faltan usuario o teléfono'; }
        else{
          // SIN p_forzar: Nexo sólo debe encolar HUECOS (usuario sin teléfono en el servidor). Si
          // hay conflicto, que lo resuelva un operador mirando el cotejo — no un pedido automático.
          const rr = await supabaseClient.rpc('panel_vincular_usuario',{
            p_secret:window.PANEL_DATA_SECRET, p_pc_codigo:pcOperativa,
            p_usuario:String(p.usuario), p_telefono:String(p.telefono)
          });
          const d = (rr && rr.data) || {};
          if(rr.error) acuse.error = rr.error.message || 'error de RPC';
          else if(!d.ok) acuse.error = d.mensaje || (d.conflicto_tel ? ('conflicto: el teléfono es de '+(d.usuario_actual||'otro')) : 'rechazado');
          else acuse.ok = true;
        }
      }catch(e){ acuse.error = e.message || String(e); }
      window._nexoAcuses.push(acuse);
      console.log('[nexo] pedido '+id+' · '+(acuse.ok?'OK':'falló: '+acuse.error));
    }
    if(window._nexoAcuses.length){ try{ nexoSync(false); }catch(_e){} }   // devolver los acuses ya
  }catch(e){ console.warn('[nexo] procesar pedidos falló:', e.message||e); }
  finally{ _nexoPedidosCorriendo = false; }
}
window._nexoProcesarPedidos = _nexoProcesarPedidos;

let _nexoSyncing=false; window._nexoLastOk=0;
async function nexoSync(verbose){
  if(!window.nexoFile || !window.nexoFile.write || _nexoSyncing) return; // sin bridge (no desktop) → nada
  _nexoSyncing=true;
  try{
    const opsFull = await _nexoCargarOpsCompletas();      // historia COMPLETA de Supabase (cacheada 15 min)
    const payload = _nexoBuildPayload(opsFull);
    if(!payload.usuarios.length){ if(verbose) console.log('[nexo] nada para enviar todavía'); return; }
    const wr = await window.nexoFile.write(JSON.stringify(payload));
    if(wr && wr.ok){
      window._nexoLastOk=Date.now();
      // Los acuses ya viajaron en ESTE archivo: se sacan de la cola local. Se descuentan sólo los
      // que se escribieron, no todos — si entró un acuse nuevo mientras se armaba el payload, ese
      // tiene que salir en el próximo, no perderse acá.
      try{
        const idsEnviados = new Set((payload.pedidosAplicados||[]).map(function(a){ return String(a.id); }));
        window._nexoAcuses = (window._nexoAcuses||[]).filter(function(a){ return !idsEnviados.has(String(a.id)); });
      }catch(_e){}
      const nops = payload.usuarios.reduce(function(a,u){return a+u.operaciones.length;},0);
      console.log('[nexo] sync OK · '+payload.usuarios.length+' usuarios · '+nops+' ops · '+(wr.bytes||0)+' bytes');
      if(verbose){ try{toast('🟢 Nexo: '+payload.usuarios.length+' usuarios · '+nops+' ops','green');}catch(_e){} }
    } else if(wr && wr.instalado===false){
      if(verbose){ console.log('[nexo] Nexo NO instalado (no existe %APPDATA%\\nexo-desktop) → no se escribió'); try{toast('Nexo no está instalado en esta PC','yellow');}catch(_e){} }
    } else if(verbose){ console.warn('[nexo] no se pudo escribir:', wr&&wr.error); try{toast('⚠ Nexo: '+((wr&&wr.error)||'error'),'red');}catch(_e){} }
  }catch(_e){ if(verbose) console.warn('[nexo] sync error', _e); }
  finally{ _nexoSyncing=false; }
}
window.nexoSync = nexoSync;
// Trigger EN TIEMPO REAL: cada operación llama a esto; debounce 6s (agrupa ráfagas) → sync a Nexo.
let _nexoTimer=null;
window._nexoTrigger = function(){ try{ clearTimeout(_nexoTimer); _nexoTimer=setTimeout(function(){ nexoSync(false); }, 6000); }catch(_e){} };
// Comando de consola:  nexo() = estado  ·  nexo('sync') = forzar envío ahora.
window.nexo = async function(cmd){
  if(cmd==='sync' || cmd==='forzar'){ return nexoSync(true); }
  try{
    const st = window.nexoFile ? await window.nexoFile.estado() : null;
    if(!st){ console.log('%c[nexo]','color:#22c55e','sin bridge (¿app de escritorio?)'); return; }
    console.log('%c[nexo]','color:#22c55e;font-weight:800',
      (st.instalado?'✅ Nexo instalado':'❌ Nexo NO instalado')+' · archivo: '+st.path+
      (st.existeArchivo?(' · '+st.bytes+' bytes · '+st.mtime):' · aún no escrito')+
      ' · última sync: '+(window._nexoLastOk?new Date(window._nexoLastOk).toLocaleString('es-AR'):'—')+
      '  ·  nexo("sync") para forzar');
    return st;
  }catch(e){ console.warn('[nexo]', e); }
};
// Sync periódico → Nexo redibuja en cada uno (escribe siempre, aunque no cambien datos, así el mtime
// se actualiza y Nexo relee). Configurable con window._nexoIntervaloMs (default 90s).
window._nexoIntervaloMs = window._nexoIntervaloMs || 90000;
try{ setInterval(function(){ nexoSync(false); }, window._nexoIntervaloMs); }catch(_e){}
// Los pedidos de Nexo se revisan en el mismo ciclo. Arranca APAGADO (ver nexoPedidosActivar):
// mientras el fix de panel_vincular_usuario no esté aplicado, aplicar pedidos duplica usuarios.
try{ setInterval(function(){ _nexoProcesarPedidos(); }, window._nexoIntervaloMs); }catch(_e){}
try{ setTimeout(function(){ nexoSync(true); }, 20000); }catch(_e){}   // primer envío (visible en consola/toast)

// ── Base local de JUGADORES (CRM-lite · portado de NexoBetaChan 1.0.85) ──────────
// Modelo PAM (KYC-lite): por jugador guarda teléfonos (verificación), INSTRUMENTOS DE PAGO
// (cbu/alias; verificado = ya cobró ahí de verdad) y TITULARES + estado de bonos. Todo LOCAL
// (localStorage) — NO carga Supabase (los movimientos ya viven en Chunior). Se auto-alimenta
// desde guardarMovimientoLocal (manual + portal) y se siembra una vez desde el store de movimientos.
