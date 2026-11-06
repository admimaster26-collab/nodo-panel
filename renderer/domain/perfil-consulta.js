(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.NodoPerfilConsulta = factory(root);
})(globalThis, function(root){
  'use strict';
  const CONTRACT = 'nodo.beta.v1', LIMIT = 50, TTL = 60000;
  const text = value => String(value == null ? '' : value).trim();
  const user = value => text(value).toLowerCase();
  const office = value => text(value).toUpperCase();
  const pc = () => office(root.pcOperativa || root.__pcCodigo);
  const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
  const validObsId = value => typeof value === 'string' && value.length >= 1 && value.length <= 1024;
  const validDate = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
  const validCursor = value => value && typeof value === 'object' && validId(value.id) && validDate(value.created_at);
  const validObsCursor = value => value && typeof value === 'object' && validObsId(value.id) && validDate(value.fecha);
  const equalCursor = (a,b) => !!a && !!b && a.id === b.id && a.created_at === b.created_at;
  const equalObsCursor = (a,b) => !!a && !!b && a.id === b.id && a.fecha === b.fecha;
  // Postgres retains microseconds; Date alone would collapse distinct rows to a
  // millisecond and incorrectly compare their IDs at that boundary.
  const timestamp = value => BigInt(Date.parse(value))*1000n + BigInt(((value.match(/\.(\d+)/)||[])[1]||'').padEnd(6,'0').slice(3,6)||'0');
  function older(row,cursor){
    if(row.created_at===null) return cursor.created_at!==null || BigInt(row.id)<BigInt(cursor.id);
    if(cursor.created_at===null)return false;
    const a=timestamp(row.created_at),b=timestamp(cursor.created_at);
    return a<b || (a===b && BigInt(row.id)<BigInt(cursor.id));
  }
  function olderObs(row,cursor){
    if(row.fecha===null) return cursor.fecha!==null || row.id < cursor.id;
    if(cursor.fecha===null) return false;
    const a=timestamp(row.fecha),b=timestamp(cursor.fecha);
    return a<b || (a===b && row.id < cursor.id);
  }
  let scope = '', epoch = 0, mode = 'pending', legacyReason = '', identityCapable = false, negotiation = null, capabilitiesAt = null;
  const entries = new Map();
  function fail(code){ const error = new Error(code); error.code = code; return error; }
  function sync(){
    if(scope !== pc()){
      scope = pc(); epoch++; mode = 'pending'; legacyReason = ''; identityCapable = false; negotiation = null; capabilitiesAt = null; entries.clear();
    }
    return scope;
  }
  function current(version, requestedPc){ sync(); return epoch === version && scope === requestedPc; }
  function decode(result){
    let data = result?.data;
    if(typeof data === 'string'){ try{ data = JSON.parse(data); }catch(_){ data = null; } }
    if(result?.error) throw fail(/^[A-Z0-9_]{1,64}$/.test(result.error.code || '') ? result.error.code : 'PERFIL_RPC_FAILED');
    if(data?.ok !== true || data.contract !== CONTRACT) throw fail('PERFIL_CONTRACT_MISMATCH');
    return data;
  }
  async function ready(){
    sync();
    const age=capabilitiesAt===null?Infinity:Date.now()-capabilitiesAt;
    if(age>=0 && age<TTL && (mode==='beta' || legacyReason==='capabilities')) return mode==='beta';
    if(negotiation) return negotiation;
    const version = epoch, requestedPc = scope;
    const pending = (async()=>{
      if(!root.panelAPI?.getContext){ mode = 'legacy'; legacyReason = 'no-bridge'; return false; }
      const context = await root.panelAPI.getContext();
      if(!current(version,requestedPc)) throw fail('PERFIL_CONTEXT_CHANGED');
      if(!context || typeof context !== 'object') throw fail('PERFIL_CONTEXT_INVALID');
      const config = context?.beta;
      if(!config?.enabled || !Array.isArray(config.offices) || !config.offices.map(office).includes(requestedPc)){
        mode = 'legacy'; legacyReason = 'config'; identityCapable = false; return false;
      }
      if(!requestedPc || !root.panelAPI?.rpc) throw fail('PERFIL_CLIENT_UNAVAILABLE');
      const capHealth = root.NodoSalud?.begin('CAPACIDADES');
      const rawCap = await root.panelAPI.rpc('nodo_beta_capacidades_v1', {p_pc_codigo:requestedPc,p_build:config.build,p_activate:false});
      capHealth?.reply(rawCap?.error);
      const result = decode(rawCap);
      if(!current(version,requestedPc)) throw fail('PERFIL_CONTEXT_CHANGED');
      if(office(result.scope?.pc_codigo) !== requestedPc || !Array.isArray(result.capabilities)){
        capHealth?.record('DATA','ERROR','PERFIL_SCOPE_MISMATCH');
        throw fail('PERFIL_SCOPE_MISMATCH');
      }
      capHealth?.record('DATA','OK','CAPACIDADES_PERFIL_OK');
      mode = ['perfil.summary.v1','perfil.detail.v1'].every(c=>result.capabilities.includes(c)) ? 'beta' : 'legacy';
      legacyReason = mode === 'legacy' ? 'capabilities' : '';
      identityCapable = mode === 'beta' && result.capabilities.includes('perfil.identity.v1');
      capabilitiesAt = Date.now();
      return mode === 'beta';
    })();
    negotiation = pending;
    try{ return await pending; }
    finally{ if(negotiation === pending) negotiation = null; }
  }
  function getEntry(usuario){
    sync();
    const key = user(usuario);
    if(!key) throw fail('PERFIL_INVALID_USER');
    if(!entries.has(key)) entries.set(key,{usuario:key,pc:scope,resumen:null,agente:null,detalleTotal:null,agenteTotal:null,
      rows:[],aliases:[],loaded:false,hasMore:false,cursor:null,
      identidad:[],identidadTotal:null,identidadLoaded:false,identidadHasMore:false,identidadCursor:null,localesDisponibles:false,
      loading:false,error:'',updated:0,flight:null,health:null});
    return entries.get(key);
  }
  function snapshot(usuario){
    const entry = getEntry(usuario);
    return {mode,pc:scope,usuario:entry.usuario,resumen:entry.resumen && {...entry.resumen},agente:entry.agente && {...entry.agente},
      detalleTotal:entry.detalleTotal,agenteTotal:entry.agenteTotal,rows:entry.rows.slice(),aliases:entry.aliases.slice(),loaded:entry.loaded,
      hasMore:entry.hasMore,cursor:entry.cursor && {...entry.cursor},
      identidad:entry.identidad.slice(),identidadTotal:entry.identidadTotal,identidadLoaded:entry.identidadLoaded,
      identidadHasMore:entry.identidadHasMore,identidadCursor:entry.identidadCursor && {...entry.identidadCursor},
      localesDisponibles:entry.localesDisponibles,identidadLocalesDisponibles:entry.localesDisponibles,
      loading:entry.loading,error:entry.error};
  }
  function validateScope(data,requestedPc,usuario){
    if(office(data.scope?.pc_codigo) !== requestedPc || user(data.scope?.usuario) !== usuario ||
      !Array.isArray(data.scope.pc_codigos) || !data.scope.pc_codigos.length || !data.scope.pc_codigos.every(p=>typeof p==='string' && text(p))) throw fail('PERFIL_SCOPE_MISMATCH');
  }
  function validateSummary(data,usuario){
    const r = data.resumen, a = data.agente;
    const count = value => Number.isSafeInteger(value) && value >= 0;
    const amount = value => typeof value === 'number' && Number.isFinite(value);
    if(!r || user(r.usuario) !== usuario || !['totalOps','cargas','retiros'].every(k=>count(r[k])) ||
      !['montoCargas','montoRetiros','neto'].every(k=>amount(r[k])) || !count(data.detalle_total) || !count(data.agente_total) ||
      typeof r.requiere_revision !== 'boolean' || ![null,'VINCULO_DECLARADO','RETIRO_CONFIRMADO'].includes(r.cbu_fuente) ||
      !a || !['totalOps','cargas','retiros'].every(k=>count(a[k])) || !['montoCargas','montoRetiros'].every(k=>amount(a[k]))) throw fail('PERFIL_INVALID_SUMMARY');
  }
  function validatePage(data,entry,cursor){
    const rows = data.rows;
    if(!Array.isArray(rows) || rows.length > LIMIT || typeof data.has_more !== 'boolean' ||
      (data.has_more ? !validCursor(data.next_cursor) || !rows.length : data.next_cursor !== null)) throw fail('PERFIL_INVALID_PAGE');
    const ids = new Set(cursor ? entry.rows.map(row=>row.id) : []);
    const aliases = data.scope.pc_codigos.map(office);
    let previous=cursor;
    for(const row of rows){
      if(!row || !validId(row.id) || !validDate(row.created_at) || user(row.usuario) !== entry.usuario ||
        !aliases.includes(office(row.pc_codigo)) || ids.has(row.id)) throw fail('PERFIL_INVALID_PAGE');
      ids.add(row.id);
      if(previous && !older(row,previous))throw fail('PERFIL_INVALID_CURSOR');
      previous=row;
    }
    const last = rows[rows.length-1];
    if(data.has_more && (!equalCursor(data.next_cursor,{id:last.id,created_at:last.created_at}) || equalCursor(data.next_cursor,cursor))) throw fail('PERFIL_INVALID_CURSOR');
  }
  function validateIdentityPage(data,entry,cursor){
    const rows = data.rows;
    const count = value => Number.isSafeInteger(value) && value >= 0;
    if(!Array.isArray(rows) || rows.length > LIMIT || !count(data.total) || typeof data.has_more !== 'boolean' ||
      (data.has_more ? !validObsCursor(data.next_cursor) || !rows.length : data.next_cursor !== null)) throw fail('PERFIL_INVALID_IDENTITY');
    const ids = new Set(cursor ? entry.identidad.map(row=>row.id) : []);
    const aliases = data.scope.pc_codigos.map(office);
    let previous = cursor;
    for(const row of rows){
      if(!row || !validObsId(row.id) || !validDate(row.fecha) || user(row.usuario) !== entry.usuario ||
        !aliases.includes(office(row.pc_codigo)) || !text(row.campo) || !text(row.valor) || !text(row.fuente) || ids.has(row.id)){
        throw fail('PERFIL_INVALID_IDENTITY');
      }
      ids.add(row.id);
      if(previous && !olderObs(row,previous)) throw fail('PERFIL_INVALID_CURSOR');
      previous = row;
    }
    const last = rows[rows.length-1];
    if(data.has_more && (!equalObsCursor(data.next_cursor,{id:last.id,fecha:last.fecha}) || equalObsCursor(data.next_cursor,cursor))){
      throw fail('PERFIL_INVALID_CURSOR');
    }
  }
  function load(usuario,options={}){
    const entry = getEntry(usuario), version = epoch, requestedPc = scope;
    if(entry.flight) return entry.flight;
    if(!options.refresh && !options.more && !options.moreIdentity && entry.loaded && !entry.error && Date.now()-entry.updated < TTL) return Promise.resolve(snapshot(usuario));
    if(options.more && entry.loaded && !entry.hasMore) return Promise.resolve(snapshot(usuario));
    if(options.moreIdentity && entry.identidadLoaded && !entry.identidadHasMore) return Promise.resolve(snapshot(usuario));
    entry.loading = true; entry.error = '';
    const health = root.NodoSalud?.begin('IDENTIDAD'); entry.health = health;
    const pending = (async()=>{
      try{
        if(!await ready()){ entry.loading = false; return snapshot(usuario); }
        if(!current(version,requestedPc)) throw fail('PERFIL_CONTEXT_CHANGED');
        const cursor = options.more && entry.loaded ? entry.cursor : null;
        const obsCursor = options.moreIdentity && entry.identidadLoaded ? entry.identidadCursor : null;
        const requests = [];
        if(options.moreIdentity){
          if(identityCapable) requests.push(['identity','nodo_beta_perfil_identidad_v1',{p_limit:LIMIT,p_cursor:obsCursor}]);
        }else{
          if(!options.more || !entry.resumen) requests.push(['summary','nodo_beta_perfil_v1',{}]);
          requests.push(['detail','nodo_beta_perfil_detalle_v1',{p_limit:LIMIT,p_cursor:cursor}]);
          if(identityCapable && !options.more) requests.push(['identity','nodo_beta_perfil_identidad_v1',{p_limit:LIMIT,p_cursor:null}]);
        }
        const results = await Promise.allSettled(requests.map(async([kind,fn,args])=>{
          const response = await root.panelAPI.rpc(fn,{p_pc_codigo:requestedPc,p_usuario:entry.usuario,...args});
          if(!current(version,requestedPc)) throw fail('PERFIL_CONTEXT_CHANGED');
          health?.reply(response?.error);
          const data = decode(response); validateScope(data,requestedPc,entry.usuario);
          if(kind === 'summary') validateSummary(data,entry.usuario);
          else if(kind === 'detail') validatePage(data,entry,cursor);
          else validateIdentityPage(data,entry,obsCursor);
          return {kind,data};
        }));
        if(!current(version,requestedPc)) throw fail('PERFIL_CONTEXT_CHANGED');
        let error = null;
        for(const result of results){
          if(result.status !== 'fulfilled'){ error ||= result.reason; continue; }
          const {kind,data} = result.value;
          entry.aliases=data.scope.pc_codigos.map(office);
          if(kind === 'summary'){
            entry.resumen = {...data.resumen}; entry.agente = {...data.agente};
            entry.detalleTotal = data.detalle_total; entry.agenteTotal = data.agente_total;
          }else if(kind === 'detail'){
            entry.rows = cursor ? entry.rows.concat(data.rows) : data.rows.slice();
            entry.loaded = true; entry.hasMore = data.has_more; entry.cursor = data.next_cursor;
          }else if(kind === 'identity'){
            entry.identidad = obsCursor ? entry.identidad.concat(data.rows) : data.rows.slice();
            entry.identidadTotal = data.total; entry.identidadLoaded = true;
            entry.identidadHasMore = data.has_more; entry.identidadCursor = data.next_cursor;
            entry.localesDisponibles = data.locales_disponibles === true;
          }
        }
        if(error) throw error;
        entry.updated = Date.now();
        health?.record('DATA',entry.resumen?.requiere_revision?'DEGRADED':'OK',entry.resumen?.requiere_revision?'PERFIL_REVISION_PENDING':'PERFIL_VALID');
      }catch(error){
        if(!current(version,requestedPc)) throw fail('PERFIL_CONTEXT_CHANGED');
        if(error?.code === 'BETA_NOT_CONFIGURED' || error?.code === 'BETA_OFFICE_NOT_CONFIGURED'){
          mode = 'legacy'; legacyReason = 'config'; identityCapable = false;
        }
        entry.error = /^PERFIL_[A-Z_]+$/.test(error.code || '') ? error.code : 'PERFIL_READ_FAILED';
        health?.reply(error); health?.record('DATA','ERROR',entry.error);
      }finally{
        if(current(version,requestedPc)){ entry.loading = false; entry.flight = null; }
      }
      return snapshot(usuario);
    })();
    entry.flight = pending;
    return pending;
  }
  function rendered(usuario){
    const entry = getEntry(usuario);
    if(mode === 'beta' && entry.loaded && entry.resumen && !entry.error && !entry.loading) entry.health?.record('RENDER','OK','PERFIL_VISIBLE');
  }
  function invalidate(){ epoch++; entries.clear(); negotiation = null; mode = 'pending'; legacyReason = ''; identityCapable = false; capabilitiesAt=null; }
  return Object.freeze({ready,load,snapshot,rendered,invalidate});
});
