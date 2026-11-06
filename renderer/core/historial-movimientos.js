let _historialData = [];
let _historialCargado = false;

// Columnas opcionales que pueden NO existir en la tabla (según versión del schema).
// Si el insert falla por alguna de estas, las quitamos y reintentamos.
const _HISTORIAL_COLS_OPCIONALES = ['saldo_pre', 'saldo_post', 'chunior_movimiento_id', 'reversion_de', 'solicitud_id'];
// Columnas que YA detectamos que no existen → no las mandamos más (evita 400 repetidos).
const _HISTORIAL_COLS_INEXISTENTES = new Set();

// ══════════════════════════════════════════════════════════════════════════
// ÁRBOL DE OPERACIONES DEL USUARIO (portado del NODO del colega · NexoBetaChan 1.0.82)
// Store local de movimientos (localStorage) — guarda titular/CBU/obs que Supabase no siempre
// persiste y sobrevive reinicios — + merge con _historialData + modal detalle/árbol.
// Se abre desde el Historial con 🔍 y se alimenta desde registrarEnHistorial.
// ══════════════════════════════════════════════════════════════════════════
const MOV_STORE_KEY = 'nodo_movimientos_v1';
function _movStoreAll(){
  try{ return JSON.parse(localStorage.getItem(MOV_STORE_KEY)||'{}')||{}; }catch(_e){ return {}; }
}
function _movStoreSave(map){
  try{
    const keys = Object.keys(map);
    if(keys.length > 2000){
      keys.map(function(k){return {k:k,ts:map[k]._ts||0};}).sort(function(a,b){return a.ts-b.ts;})
        .slice(0, keys.length-2000).forEach(function(x){ delete map[x.k]; });
    }
    localStorage.setItem(MOV_STORE_KEY, JSON.stringify(map));
  }catch(_e){}
}
function _movParseNotas(notas){
  const s = String(notas||'');
  const grab = function(re){ const m = s.match(re); return m ? m[1].trim() : ''; };
  return {
    titular: grab(/Titular:\s*([^·|]+)/i),
    // Desde el 10/09 portalNotasBase escribe "Alias:" en vez de "Destino:". Sin leer los dos, el
    // alias existía en la nota pero dejó de verse en el perfil y de llegar a la ficha del jugador.
    destino: grab(/Destino:\s*([^·|]+)/i) || grab(/Alias:\s*([^·|]+)/i),
    cbu:     grab(/CBU\/?\s*C?V?U?:\s*([^·|]+)/i),
    obs:     grab(/Obs:\s*([^·|]+)/i)
  };
}
window.guardarMovimientoLocal = function guardarMovimientoLocal(rec){
  if(!rec || !rec.usuario) return;
  try{
    const map = _movStoreAll();
    const key = String(rec.id!=null ? rec.id : (rec.usuario+'_'+(rec.ts||Date.now())));
    const prev = map[key] || {};
    const parsed = _movParseNotas(rec.notas);
    const pick = function(a,b){ return (a!==undefined && a!==null && a!=='') ? a : b; };
    map[key] = {
      id: pick(rec.id, prev.id!=null?prev.id:null),
      usuario: String(rec.usuario||prev.usuario||''),
      tipo: pick(rec.tipo, prev.tipo||''),
      monto: pick(rec.monto, prev.monto!=null?prev.monto:0),
      titular: pick(rec.titular, pick(parsed.titular, prev.titular||'')),
      destino: pick(rec.destino, pick(parsed.destino, prev.destino||'')),
      cbu: pick(rec.cbu, pick(parsed.cbu, prev.cbu||'')),
      obs: pick(rec.obs, pick(parsed.obs, prev.obs||'')),
      saldoPre: pick(rec.saldoPre, prev.saldoPre!=null?prev.saldoPre:null),
      saldoPost: pick(rec.saldoPost, prev.saldoPost!=null?prev.saldoPost:null),
      billeteraNombre: pick(rec.billeteraNombre, prev.billeteraNombre||''),
      operador: pick(rec.operador, prev.operador||''),
      estado: pick(rec.estado, prev.estado||''),
      chuniorId: pick(rec.chuniorId, prev.chuniorId||null),
      solicitudId: pick(rec.solicitudId, prev.solicitudId||null),
      bonoPct: pick(rec.bonoPct, prev.bonoPct||null),
      origen: pick(rec.origen, prev.origen||''),
      notas: pick(rec.notas, prev.notas||''),
      _ts: rec.ts || prev._ts || Date.now(),
      _fecha: rec.fecha || prev._fecha || new Date().toISOString()
    };
    _movStoreSave(map);
    try{ window.NodoPersistenciaSync?.scheduleSync?.(); }catch(_e){}
    // Auto-alimenta la base local de JUGADORES (CBUs/titulares) desde cada movimiento.
    try{
      const _m = map[key];
      if(window.jugadorRegistrarDato && _m && _m.usuario){
        const _esRet = String(_m.tipo||'').toUpperCase()==='RETIRO';
        if((_esRet && (_m.cbu||_m.destino)) || _m.titular)
          window.jugadorRegistrarDato(_m.usuario, { cbu:_esRet?(_m.cbu||_m.destino):'', titular:_m.titular, fecha:_m._fecha });
      }
    }catch(_e){}
  }catch(_e){}
};
function _capturarMovimientoDesdeHistorial(data, row){
  try{
    const src = data || {}, r = row || {};
    const pick = function(a,b){ return (a!==undefined && a!==null && a!=='') ? a : b; };
    guardarMovimientoLocal({
      id: pick(src.id, r.id!=null?r.id:null),
      usuario: pick(src.usuario, r.usuario),
      tipo: pick(src.tipo, r.tipo),
      monto: pick(src.monto, r.monto),
      saldoPre: pick(src.saldo_pre, r.saldo_pre),
      saldoPost: pick(src.saldo_post, r.saldo_post),
      billeteraNombre: pick(src.billetera_nombre, r.billetera_nombre),
      operador: pick(src.operador, r.operador),
      estado: pick(src.estado, r.estado),
      chuniorId: pick(src.chunior_movimiento_id, r.chunior_movimiento_id),
      solicitudId: pick(src.solicitud_id, r.solicitud_id),
      origen: pick(src.origen, r.origen),
      notas: pick(src.notas, r.notas),
      fecha: src.created_at || new Date().toISOString(),
      ts: Date.now()
    });
    try{
      if(typeof _archivoHistorialMerge === 'function'){
        const fila = {
          id: pick(src.id, r.id!=null ? r.id : ('loc_'+Date.now()+'_'+Math.random().toString(36).slice(2,7))),
          usuario: pick(src.usuario, r.usuario), tipo: pick(src.tipo, r.tipo), monto: pick(src.monto, r.monto),
          saldo_pre: pick(src.saldo_pre, r.saldo_pre), saldo_post: pick(src.saldo_post, r.saldo_post),
          billetera_nombre: pick(src.billetera_nombre, r.billetera_nombre), operador: pick(src.operador, r.operador),
          estado: pick(src.estado, r.estado), chunior_movimiento_id: pick(src.chunior_movimiento_id, r.chunior_movimiento_id),
          solicitud_id: pick(src.solicitud_id, r.solicitud_id), origen: pick(src.origen, r.origen),
          notas: pick(src.notas, r.notas), created_at: src.created_at || new Date().toISOString()
        };
        _archivoHistorialMerge([fila]);
      }
    }catch(_e){}
    // Tiempo real → Nexo: cada movimiento capturado dispara un sync (debounce 6s en _nexoTrigger).
    try{ if(window._nexoTrigger) window._nexoTrigger(); }catch(_e){}
  }catch(_e){}
}

// ══════════════════════════════════════════════════════════════════════════
