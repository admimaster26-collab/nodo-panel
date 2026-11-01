(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.NodoBetaChat = factory(root);
})(globalThis, function(root){
  'use strict';
  const CONTRACT = 'nodo.beta.v1';
  const REQUIRED = ['chat.list.v1','chat.messages.v1','chat.read.v1'];
  const upper = value => String(value || '').trim().toUpperCase();
  const identity = ticket => String(ticket?._chatId || ticket?.chatId || '');
  const validId = id => /^[1-9]\d{0,18}$/.test(String(id)) && BigInt(id) <= 9223372036854775807n;
  const now = () => Date.now();
  const pc = () => upper(root.pcOperativa || root.__pcCodigo || '');
  let scope = '', generation = 0, config = null, enabled = false, negotiated = false;
  let negotiation = null, lastTry = 0, leaseAt = 0, error = '', stage = 'IDLE';
  let overview = null, ackFlight = null, retryTimer = null;
  const counters = new Map(), pages = new Map(), confirmed = new Set(), retries = new Map(), failures = new Map(), openChats = new Set();
  const legacyCoverage = new Map();
  let ackRevision=0;
  const countRevisions=new Map();
  let rendered = null;
  function publish(next, code = '', operation = 'READ'){
    if(code) root.NodoSalud?.record('CHAT',operation.startsWith('ACK')||operation==='SEND'?'EFFECT':operation==='CONNECTION'?'CONNECTED':'DATA','ERROR',
      {code:/^[A-Z0-9_.:-]{1,64}$/.test(code)?code:'BETA_OPERATION_FAILED'});
    if(code) failures.set(operation,code); else failures.delete(operation);
    error = failures.values().next().value || '';
    stage = error ? 'ERROR' : legacyCoverage.size ? 'DEGRADED' : next;
    if(!code && [...failures.keys()].some(k=>k.startsWith('ACK:')))root.NodoSalud?.record('CHAT','EFFECT','DEGRADED',{code:'CHAT_ACK_PENDING'});
    if(legacyCoverage.size) root.NodoSalud?.record('CHAT','DATA','DEGRADED',{code:'LEGACY_MESSAGE_IDENTITY_UNKNOWN'});
    root.nodoChatRefreshUnread?.();
    try { root.dispatchEvent?.(new root.CustomEvent('nodo:beta-chat', { detail: status() })); } catch(_) {}
    const node = root.document?.getElementById('nodoBetaChatEstado');
    // Al operador: nada cuando anda, y con un problema una sola línea sin códigos (el código ya va al semáforo).
    if(node) node.textContent = error ? 'Sin conexión con el chat. Reintentando…' : '';
  }
  function reset(nextPc){
    generation++; scope = nextPc; config = null; enabled = false; negotiated = false;
    negotiation = null; lastTry = 0; leaseAt = 0; overview = null; rendered = null;
    counters.clear(); pages.clear(); confirmed.clear(); retries.clear(); failures.clear(); openChats.clear(); legacyCoverage.clear(); ackFlight=null;
    ackRevision=0;countRevisions.clear();
    if(retryTimer) root.clearTimeout(retryTimer);
    retryTimer = null; publish('IDLE');
  }
  function checkScope(){ if(scope !== pc()) reset(pc()); return scope; }
  function status(){ return { contract: CONTRACT, active: negotiated && scope === pc(), enabled, pc: scope, stage, code: error, build: config?.build || '', overview: overview && {...overview},
    coverage:{unread_scope:'canonical',legacy_conversations_unknown:legacyCoverage.size},
    pending_ack_chats:[...failures.keys()].filter(k=>k.startsWith('ACK:')).map(k=>k.slice(4)) }; }
  function current(version,requestedPc){return version===generation && requestedPc===pc();}
  function observeLegacy(chatId,rows){
    const unresolved=(rows||[]).filter(m=>['USUARIO','USER','CLIENTE','PORTAL'].includes(upper(m.origen||m.tipo_emisor)) && !validId(m.id)).length;
    if(unresolved)legacyCoverage.set(String(chatId),{code:'LEGACY_MESSAGE_IDENTITY_UNKNOWN',user_messages:unresolved,unread_scope:'canonical'});
    else legacyCoverage.delete(String(chatId));
    // This is a local diagnostic of inspected conversations, never a global
    // inventory or a count to add to canonical unread messages.
    while(legacyCoverage.size>256)legacyCoverage.delete(legacyCoverage.keys().next().value);
  }
  async function call(fn, params, expected = generation){
    const requestedPc = scope;
    const started=now();
    const stage=fn==='nodo_beta_capacidades_v1'?'CONNECTED':(/leido|enviar/.test(fn)?'EFFECT':'DATA');
    try{
    const result = await root.panelAPI.rpc(fn, {...params, p_pc_codigo: requestedPc});
    if(expected !== generation || requestedPc !== pc()) throw new Error('BETA_CONTEXT_CHANGED');
    let data = result?.data;
    if(typeof data === 'string'){ try { data = JSON.parse(data); } catch(_) { data = null; } }
    if(result?.error || data?.ok !== true || data?.contract !== CONTRACT){
      throw new Error(result?.error?.code || result?.error?.message || data?.code || 'BETA_RPC_FAILED');
    }
    root.NodoSalud?.record('CHAT',stage==='EFFECT'?'CONNECTED':stage,'OK',{duration_ms:now()-started});
    return data;
    }catch(e){
      if(expected===generation && requestedPc===pc()) root.NodoSalud?.record('CHAT',stage,'ERROR',{code:/^BETA_[A-Z0-9_]+$/.test(e.message)?e.message:'BETA_RPC_FAILED',duration_ms:now()-started});
      throw e;
    }
  }
  async function ready(){
    if(!checkScope()) return false;
    if(negotiated) return true;
    if(negotiation) return negotiation;
    if(lastTry && now()-lastTry < 30000){
      if(failures.has('CONNECTION')) throw new Error(failures.get('CONNECTION'));
      return false;
    }
    const version = generation; lastTry = now();
    negotiation = (async()=>{
      try {
        const context = await root.panelAPI?.getContext?.();
        if(version !== generation || scope !== pc()) throw new Error('BETA_CONTEXT_CHANGED');
        config = context?.beta;
        enabled = config?.enabled === true && Array.isArray(config.offices) && config.offices.map(upper).includes(scope);
        if(!enabled){ publish('LEGACY','','CONNECTION'); return false; }
        publish('CONNECTING','','CONNECTION');
        const offer = await call('nodo_beta_capacidades_v1', {p_build: config.build, p_activate: false}, version);
        if(upper(offer.scope?.pc_codigo) !== scope || !REQUIRED.every(c => offer.capabilities?.includes(c))) throw new Error('BETA_CONTRACT_MISMATCH');
        negotiated = true;
        return true;
      } catch(e) {
        if(version === generation && scope === pc()) publish('ERROR', e.message,'CONNECTION');
        // Only an explicitly disabled installation selects legacy. An unavailable
        // beta contract must not fall through to getters that also mark as read.
        throw e;
      }
      finally { if(version === generation) negotiation = null; }
    })();
    return negotiation;
  }
  async function activate(){
    if(leaseAt && now()-leaseAt < 120000) return;
    const activated = await call('nodo_beta_capacidades_v1', {p_build: config.build, p_activate: true});
    if(activated.active !== true || activated.build !== config.build) throw new Error('BETA_ACTIVATION_FAILED');
    leaseAt = now();
    publish('READY','','CONNECTION');
  }
  function setCount(chatId, value){
    if(!Number.isSafeInteger(value) || value < 0) return;
    const old = counters.get(String(chatId));
    counters.set(String(chatId),value);
    if(overview && old !== undefined && openChats.has(String(chatId))) overview.unread_total = Math.max(0,overview.unread_total + value-old);
  }
  async function lista(options = {}){
    if(!await ready()) return null;
    const version=generation,requestedPc=scope,countVersion=ackRevision;
    try {
      const result = await call('nodo_beta_chat_lista_v1', {
        p_usuario: options.usuario || null, p_estado: options.estado || null,
        p_limit: 50, p_before_id: options.beforeId || null
      });
      if(!current(version,requestedPc))throw new Error('BETA_CONTEXT_CHANGED');
      if(!Array.isArray(result.rows) || !Number.isSafeInteger(result.unread_total) || result.unread_total < 0 ||
        result.rows.some(row=>!row.chat_id || !Number.isSafeInteger(row.sin_leer) || row.sin_leer < 0)) throw new Error('BETA_INVALID_LIST');
      for(const row of result.rows){
        const id=String(row.chat_id);
        if((countRevisions.get(id)||0)<=countVersion)counters.set(id,Number(row.sin_leer));
        if(['CERRADO','RESUELTA'].includes(upper(row.estado)))openChats.delete(id);else openChats.add(id);
      }
      if(!options.usuario && !options.estado && countVersion===ackRevision) overview = { total: result.total, unread_total: result.unread_total };
      await activate(); // The lease starts after an actual successful read, not only the offer.
      publish('READY');
      return result;
    } catch(e) { if(current(version,requestedPc))publish('ERROR',e.message); throw e; }
  }
  async function mensajes(chatId, options = {}){
    if(!await ready()) return null;
    const version=generation,requestedPc=scope,countVersion=ackRevision;
    const key = scope+'|'+chatId+'|'+(options.beforeId || '');
    if(pages.has(key)) return pages.get(key);
    const pending = (async()=>{
      try {
        const result = await call('nodo_beta_chat_mensajes_v1', {p_chat_id: String(chatId),p_limit: 50,p_before_id: options.beforeId || null});
        if(!current(version,requestedPc))throw new Error('BETA_CONTEXT_CHANGED');
        if(String(result.chat_id) !== String(chatId) || !Array.isArray(result.rows) ||
          result.rows.some(row=>!validId(row.id)) || !Number.isSafeInteger(result.counts?.unread) || result.counts.unread < 0) throw new Error('BETA_INVALID_MESSAGES');
        if((countRevisions.get(String(chatId))||0)<=countVersion)setCount(chatId,Number(result.counts?.unread));
        if(!options.beforeId)observeLegacy(chatId,result.legacy_thread);
        publish('READY'); return result;
      } catch(e) { if(current(version,requestedPc))publish('ERROR',e.message); throw e; }
      finally { if(pages.get(key)===pending)pages.delete(key); }
    })();
    pages.set(key,pending); return pending;
  }
  function visibleIds(view){
    const doc = root.document;
    if(!view || scope !== pc() || !negotiated || doc?.hidden || doc?.visibilityState !== 'visible' || doc.hasFocus?.() === false || !doc.body?.classList.contains('nodo-chat-open')) return [];
    const current = root.__nodoChatCurrentTicket;
    if(!current?._beta || identity(current) !== view.chatId || current._betaPc !== scope) return [];
    const ids = new Set();
    for(const body of view.bodies){
      if(body.isConnected === false || body.dataset?.betaChatId !== view.chatId || body.dataset?.betaPc !== scope) continue;
      const clip = body.getBoundingClientRect?.();
      if(!clip || clip.width <= 0 || clip.height <= 0) continue;
      const style = root.getComputedStyle?.(body);
      if(style && (style.visibility === 'hidden' || style.display === 'none')) continue;
      const top = Math.max(0,clip.top), bottom = Math.min(root.innerHeight || Infinity,clip.bottom);
      const left = Math.max(0,clip.left), right = Math.min(root.innerWidth || Infinity,clip.right);
      if(bottom<=top || right<=left) continue;
      for(const node of body.querySelectorAll('[data-beta-message-id]')){
        const id = node.dataset.betaMessageId;
        if(!validId(id) || !view.ids.has(id) || node.dataset.betaRole !== 'USUARIO') continue;
        const rect = node.getBoundingClientRect();
        if(rect.height > 0 && rect.width > 0 && rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right) ids.add(id);
      }
    }
    if(ids.size) root.NodoSalud?.record('CHAT','RENDER','OK');
    return [...ids];
  }
  function receiptKey(chatId,id){ return scope+'|'+chatId+'|'+id; }
  async function flushVisible(){
    checkScope();
    if(ackFlight) return;
    const view = rendered;
    const ids = visibleIds(view).filter(id => !confirmed.has(receiptKey(view.chatId,id)) && (retries.get(receiptKey(view.chatId,id)) || 0)<3).slice(0,100);
    if(!ids.length) return;
    const version = generation,requestedPc=scope,flight={version,requestedPc};
    ackFlight=flight;
    let completed=false;
    try {
      const result = await call('nodo_beta_chat_leido_v1', {p_chat_id: view.chatId,p_message_ids: ids},version);
      if(!current(version,requestedPc))throw new Error('BETA_CONTEXT_CHANGED');
      const acknowledged = result.acknowledged_ids;
      if(String(result.chat_id)!==view.chatId || !Array.isArray(acknowledged) ||
        acknowledged.length!==ids.length || ids.some(id => !acknowledged.map(String).includes(id)) ||
        !Number.isSafeInteger(result.unread) || result.unread < 0) throw new Error('BETA_ACK_INCOMPLETE');
      for(const id of ids){ const key=receiptKey(view.chatId,id); confirmed.add(key); retries.delete(key); }
      while(confirmed.size > 2000) confirmed.delete(confirmed.values().next().value);
      countRevisions.set(String(view.chatId),++ackRevision);
      setCount(view.chatId,Number(result.unread));
      root.NodoSalud?.record('CHAT','EFFECT','OK');
      publish('READY','','ACK:'+view.chatId);
      completed=true;
    } catch(e){
      if(current(version,requestedPc)){
        for(const id of ids){ const key=receiptKey(view.chatId,id); retries.set(key,(retries.get(key)||0)+1); }
        publish('ERROR',e.message,'ACK:'+view.chatId);
        if(!retryTimer) retryTimer = root.setTimeout(()=>{ retryTimer=null; void flushVisible(); },3000);
      }
    } finally {
      if(ackFlight===flight){
        ackFlight=null;
        // A conversation opened while the previous ACK was in flight must not
        // wait for another poll or scroll before acknowledging its visible IDs.
        if(rendered!==view || completed && ids.length===100)scheduleVisible();
      }
    }
  }
  function observeRendered(ticket,bodies,messages){
    if(!ticket?._beta || ticket._betaPc !== checkScope()) return;
    const chatId = identity(ticket);
    const ids = new Set((messages || []).filter(m => upper(m.origen || m.tipo_emisor)==='USUARIO' && validId(m.id)).map(m=>String(m.id)));
    rendered = {chatId,bodies,ids};
    for(const body of bodies){
      body.dataset.betaChatId=chatId; body.dataset.betaPc=scope;
      if(!body.__nodoBetaScroll){ body.addEventListener('scroll',scheduleVisible,{passive:true}); body.__nodoBetaScroll=true; }
    }
    scheduleVisible();
  }
  function scheduleVisible(){ root.requestAnimationFrame?.(()=>{ void flushVisible(); }); }
  async function enviar(chatId,message){
    if(!await ready()) throw new Error('BETA_NOT_CONNECTED');
    const version=generation,requestedPc=scope;
    if(!message.request_id) message.request_id = root.crypto.randomUUID();
    try {
      const result=await call('nodo_beta_chat_enviar_v1', {
        p_chat_id:String(chatId),p_mensaje:String(message.mensaje||''),p_imagen_url:message.imagen_url||null,
        p_emisor:String(message.operador||'panel'),p_request_id:message.request_id
      });
      if(!current(version,requestedPc))throw new Error('BETA_CONTEXT_CHANGED');
      if(!result.message || !validId(result.message.id)) throw new Error('BETA_SEND_UNCONFIRMED');
      root.NodoSalud?.record('CHAT','EFFECT','OK');
      publish('READY','','SEND'); return result.message;
    } catch(e){if(current(version,requestedPc))publish('ERROR',e.message,'SEND');throw e;}
  }
  root.document?.addEventListener?.('visibilitychange',scheduleVisible);
  root.addEventListener?.('focus',scheduleVisible);
  return Object.freeze({ready,active:()=>{checkScope();return negotiated;},lista,mensajes,enviar,observeRendered,flushVisible,status,
    count: chatId=>counters.get(String(chatId)), total:()=>scope===pc()?overview?.unread_total:undefined,
    legacyDiagnostic:chatId=>{checkScope();const value=legacyCoverage.get(String(chatId));return value?{...value}:null;},
    retry:()=>{retries.clear();lastTry=0;void flushVisible();}, identity});
});
