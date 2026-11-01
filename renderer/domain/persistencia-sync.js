(function(root, factory){
  const api = factory(root);
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.NodoPersistenciaSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root){
  'use strict';

  const CAP_FN = 'nodo_beta_capacidades_v1';
  const SYNC_FN = 'nodo_beta_persistencia_sync_v1';
  const READ_FN = 'nodo_beta_persistencia_leer_v1';
  const REQUIRED_CAP = 'persistence.local.v1';
  const ACK_PREFIX = 'nodo_persistencia_ack_v1_';
  const INST_KEY = 'nodo_persistencia_instalacion_v1';

  function normText(value, max){
    const text = String(value == null ? '' : value).trim();
    return max ? text.slice(0, max) : text;
  }

  function normOffice(value){
    return normText(value, 24).toUpperCase();
  }

  function normUser(value){
    return normText(value, 120).toLowerCase();
  }

  function safeJsonParse(raw, fallback){
    try{
      const parsed = JSON.parse(raw || '');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    }catch(_e){
      return fallback;
    }
  }

  function unwrapRpc(response){
    if(!response || typeof response !== 'object') return { data: null, error: { code: 'EMPTY_RESPONSE', message: 'Sin respuesta del servidor.' } };
    if(response.error) return { data: null, error: response.error };
    const data = Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
    if(Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === 'object') return { data: data[0], error: null };
    return { data, error: null };
  }

  function create(deps){
    const cfg = deps || {};
    const getWindow = function(){ return cfg.window || root || {}; };
    const getStorage = function(){
      const w = getWindow();
      return cfg.storage || w.localStorage || null;
    };
    const getPanelApi = function(){
      const w = getWindow();
      return cfg.panelAPI || w.panelAPI || null;
    };
    const getOffice = function(override){
      if(override) return normOffice(override);
      if(typeof cfg.getOffice === 'function') return normOffice(cfg.getOffice());
      const w = getWindow();
      return normOffice(w.pcOperativa);
    };
    const getInstallation = function(pc){
      if(cfg.instalacion) return normText(cfg.instalacion, 120).replace(/\s+/g, '-');
      const storage = getStorage();
      if(storage){
        try{
          const saved = normText(storage.getItem(INST_KEY), 120).replace(/\s+/g, '-');
          if(saved) return saved;
          const gen = 'pc-' + (normOffice(pc) || 'NODO').toLowerCase() + '-' + Math.random().toString(36).slice(2, 10);
          storage.setItem(INST_KEY, gen);
          return gen;
        }catch(_e){}
      }
      return 'pc-' + (normOffice(pc) || 'nodo').toLowerCase();
    };
    const getHealth = function(){
      const w = getWindow();
      return cfg.health || w.NodoSalud || null;
    };

    const capabilityByOffice = new Map();

    function readAckStore(pc){
      const storage = getStorage();
      const office = normOffice(pc);
      if(!storage || !office) return { jugadores: {}, movimientos: {}, cotejos: {}, colas: {} };
      const parsed = safeJsonParse(storage.getItem(ACK_PREFIX + office), null);
      return {
        jugadores: (parsed && parsed.jugadores && typeof parsed.jugadores === 'object') ? parsed.jugadores : {},
        movimientos: (parsed && parsed.movimientos && typeof parsed.movimientos === 'object') ? parsed.movimientos : {},
        cotejos: (parsed && parsed.cotejos && typeof parsed.cotejos === 'object') ? parsed.cotejos : {},
        colas: (parsed && parsed.colas && typeof parsed.colas === 'object') ? parsed.colas : {}
      };
    }

    function writeAckStore(pc, ackStore){
      const storage = getStorage();
      const office = normOffice(pc);
      if(!storage || !office || !ackStore) return;
      try{
        storage.setItem(ACK_PREFIX + office, JSON.stringify(ackStore));
      }catch(_e){}
    }

    function signatureOf(item){
      try{ return JSON.stringify(item); }catch(_e){ return String(Date.now()); }
    }

    function collectPending(pcOverride){
      const pc = getOffice(pcOverride);
      const storage = getStorage();
      if(!storage || !pc){
        return { pc, payload: { jugadores: [], movimientos: [], cotejos: [], colas: [] }, signatures: { jugadores: {}, movimientos: {}, cotejos: {}, colas: {} }, total: 0 };
      }
      const ack = readAckStore(pc);
      const signatures = { jugadores: {}, movimientos: {}, cotejos: {}, colas: {} };
      const jugadores = [];

      function pushJugadorItem(item){
        if(jugadores.length >= 60) return;
        const sig = signatureOf(item);
        if(ack.jugadores[item.source_id] === sig) return;
        signatures.jugadores[item.source_id] = sig;
        jugadores.push(item);
      }

      const jugRaw = safeJsonParse(storage.getItem('nodo_jugadores_local_v2'), {});
      Object.keys(jugRaw).forEach(function(k){
        const j = jugRaw[k];
        if(!j || typeof j !== 'object') return;
        const usuario = normUser(j.usuario || k);
        if(!usuario) return;
        const jPc = normOffice(j.pc_codigo || j.pc || '');
        if(jPc && jPc !== pc) return;

        Object.keys(j.telefonos || {}).forEach(function(telKey){
          const tObj = j.telefonos[telKey] || {};
          const valor = normText(tObj.raw || telKey, 120);
          if(!valor) return;
          const sid = 'jug:' + usuario + ':tel:' + valor;
          pushJugadorItem({
            source_id: sid,
            campo: 'telefono',
            usuario,
            atributo: 'telefono',
            valor,
            fuente: 'local.jugadores',
            estado: tObj.verificado ? 'VERIFICADO_LOCAL' : 'OBSERVADO_LOCAL',
            veces: Math.max(Number(tObj.veces) || 1, 1),
            verificado: !!tObj.verificado,
            primera_fecha: normText(tObj.primera || j.creado || '', 40) || null,
            ultima_fecha: normText(tObj.ultima || j.creado || '', 40) || null
          });
        });

        Object.keys(j.cbus || {}).forEach(function(cbuKey){
          const cObj = j.cbus[cbuKey] || {};
          const valor = normText(cObj.raw || cbuKey, 200);
          if(!valor) return;
          const sid = 'jug:' + usuario + ':cbu:' + cbuKey;
          pushJugadorItem({
            source_id: sid,
            campo: 'cbu',
            usuario,
            atributo: 'cbu',
            valor,
            fuente: 'local.jugadores',
            estado: cObj.verificado ? 'RETIRO_VERIFICADO_LOCAL' : 'DECLARADO_LOCAL',
            veces: Math.max(Number(cObj.veces) || 1, 1),
            verificado: !!cObj.verificado,
            titular_asociado: normText(cObj.titular || '', 160) || null,
            primera_fecha: normText(cObj.primera || j.creado || '', 40) || null,
            ultima_fecha: normText(cObj.ultima || j.creado || '', 40) || null
          });
        });

        Object.keys(j.titulares || {}).forEach(function(titKey){
          const tiObj = j.titulares[titKey] || {};
          const valor = normText(tiObj.raw || titKey, 200);
          if(!valor) return;
          const sid = 'jug:' + usuario + ':tit:' + titKey;
          pushJugadorItem({
            source_id: sid,
            campo: 'nombre',
            usuario,
            atributo: 'titular',
            valor,
            fuente: 'local.jugadores',
            estado: 'OBSERVADO_LOCAL',
            veces: Math.max(Number(tiObj.veces) || 1, 1),
            verificado: false,
            primera_fecha: normText(tiObj.primera || j.creado || '', 40) || null,
            ultima_fecha: normText(tiObj.ultima || j.creado || '', 40) || null
          });
        });

        if(Array.isArray(j.bonos)){
          j.bonos.slice(0, 10).forEach(function(b, idx){
            if(!b || typeof b !== 'object') return;
            const fecha = normText(b.fecha || j.creado || '', 40) || null;
            const pct = Number(b.pct) || 0;
            const sid = 'jug:' + usuario + ':bono:' + (fecha || idx);
            pushJugadorItem({
              source_id: sid,
              campo: 'bono',
              usuario,
              atributo: 'bono',
              valor: String(pct || b.estado || 'BONO'),
              fuente: 'local.bonos',
              estado: normText(b.estado || 'PENDIENTE', 40).toUpperCase(),
              veces: 1,
              verificado: String(b.estado || '').toUpperCase() === 'APLICADO',
              ultima_fecha: fecha,
              detalle: { pct: pct || null, monto: Number(b.monto) || null }
            });
          });
        }
      });

      const rechRaw = safeJsonParse(storage.getItem('nodo_titulares_rechazados'), {});
      Object.keys(rechRaw).forEach(function(k){
        const entry = rechRaw[k];
        if(!entry || typeof entry !== 'object') return;
        const rawUser = normText(entry.usuario || (k.split('|')[0] || ''), 120);
        const usuario = rawUser === '*' ? '*' : normUser(rawUser);
        const valor = normText(entry.titular || (k.split('|')[1] || ''), 200);
        if(!usuario || !valor) return;
        const sid = 'rech:' + normText(k, 200);
        pushJugadorItem({
          source_id: sid,
          campo: 'nombre',
          usuario,
          atributo: 'titular_rechazado',
          valor,
          fuente: 'local.titulares_rechazados',
          estado: usuario === '*' ? 'BLOQUEADO_GLOBAL' : 'BLOQUEADO_USUARIO',
          veces: 1,
          verificado: false,
          ultima_fecha: normText(entry.fecha || '', 40) || null,
          detalle: { motivo: normText(entry.motivo || '', 160), global: usuario === '*' }
        });
      });

      const movRaw = safeJsonParse(storage.getItem('nodo_movimientos_v1'), {});
      const movimientos = [];
      Object.keys(movRaw).forEach(function(k){
        if(movimientos.length >= 50) return;
        const m = movRaw[k];
        if(!m || typeof m !== 'object') return;
        const movKey = normText(m.id != null ? m.id : k, 120);
        const usuario = normUser(m.usuario);
        if(!movKey || !usuario) return;
        const mPc = normOffice(m.pc_codigo || m.pc || '');
        if(mPc && mPc !== pc) return;
        let traza = null;
        try{
          const trRaw = storage.getItem('nodo_traza_hist_' + movKey);
          if(trRaw) traza = safeJsonParse(trRaw, null);
        }catch(_e){}
        const item = {
          movimiento_key: movKey,
          historial_id: /^\d+$/.test(movKey) ? movKey : null,
          solicitud_id: m.solicitudId != null && /^\d+$/.test(String(m.solicitudId)) ? String(m.solicitudId) : null,
          chunior_id: m.chuniorId != null ? normText(m.chuniorId, 80) : null,
          usuario,
          tipo: normText(m.tipo, 40).toUpperCase(),
          monto: m.monto != null && Number.isFinite(Number(m.monto)) ? String(Number(m.monto)) : null,
          estado: normText(m.estado, 40).toUpperCase(),
          titular: normText(m.titular, 160),
          destino: normText(m.destino, 160),
          cbu: normText(m.cbu, 160),
          obs: normText(m.obs, 240),
          saldo_pre: m.saldoPre != null && Number.isFinite(Number(m.saldoPre)) ? String(Number(m.saldoPre)) : null,
          saldo_post: m.saldoPost != null && Number.isFinite(Number(m.saldoPost)) ? String(Number(m.saldoPost)) : null,
          billetera_nombre: normText(m.billeteraNombre, 120),
          operador: normText(m.operador, 80),
          bono_pct: m.bonoPct != null && Number.isFinite(Number(m.bonoPct)) ? String(Number(m.bonoPct)) : null,
          origen: normText(m.origen, 40).toUpperCase(),
          notas: normText(m.notas, 500),
          traza,
          fecha: normText(m._fecha || m.fecha || '', 40) || null
        };
        const sig = signatureOf(item);
        if(ack.movimientos[movKey] === sig) return;
        signatures.movimientos[movKey] = sig;
        movimientos.push(item);
      });

      const cotejos = [];
      const altaRes = safeJsonParse(storage.getItem('nodo.cotejo.resueltos'), {});
      Object.keys(altaRes).forEach(function(clave){
        if(cotejos.length >= 40) return;
        const r = altaRes[clave];
        if(!r || typeof r !== 'object') return;
        const cotKey = 'alta:' + normText(clave, 180);
        const parts = String(clave || '').split('|');
        const item = {
          cotejo_key: cotKey,
          tipo_cotejo: 'ALTA_TELEFONO',
          usuario: normUser(r.usuario),
          telefono: normText(r.telefono, 40).replace(/\D/g, ''),
          usuario_declarado: normUser(parts[0] || ''),
          telefono_declarado: normText(parts[1] || '', 40).replace(/\D/g, ''),
          estado: 'RESUELTO',
          fecha: r.cuando ? new Date(Number(r.cuando)).toISOString() : null,
          detalle: { cuando: r.cuando || null }
        };
        const sig = signatureOf(item);
        if(ack.cotejos[cotKey] === sig) return;
        signatures.cotejos[cotKey] = sig;
        cotejos.push(item);
      });

      try{
        const totalKeys = typeof storage.length === 'number' ? storage.length : 0;
        for(let i = 0; i < totalKeys && cotejos.length < 40; i++){
          const key = storage.key(i);
          if(!key || key.indexOf('nodo_cotejo_v1_') !== 0) continue;
          const rawCot = safeJsonParse(storage.getItem(key), null);
          if(!rawCot || typeof rawCot !== 'object') continue;
          const turnoId = normText(key.slice('nodo_cotejo_v1_'.length), 120);
          const cotKey = 'turno:' + turnoId;
          const item = {
            cotejo_key: cotKey,
            tipo_cotejo: 'CONCILIACION_TURNO',
            turno_id: turnoId,
            usuario: normUser(rawCot.usuario || ''),
            estado: normText(rawCot.estado || 'OBSERVADO', 40).toUpperCase(),
            fecha: normText(rawCot.fecha || '', 40) || null,
            detalle: rawCot
          };
          const sig = signatureOf(item);
          if(ack.cotejos[cotKey] === sig) continue;
          signatures.cotejos[cotKey] = sig;
          cotejos.push(item);
        }
      }catch(_e){}

      const colas = [];
      const chuPend = safeJsonParse(storage.getItem('nodo_chu_pendientes'), []);
      if(Array.isArray(chuPend)){
        chuPend.slice(0, 25).forEach(function(entry, idx){
          const itemId = 'chu:' + normText(entry && (entry.id || entry.solicitudId || entry.historialId || (entry.usuario + '_' + (entry.ts || idx))), 120);
          const item = {
            cola_tipo: 'CHUNIOR_PENDIENTE',
            item_id: itemId,
            usuario: normUser(entry && entry.usuario),
            referencia_id: normText(entry && (entry.solicitudId || entry.historialId || entry.id || ''), 80),
            estado: normText((entry && entry.estado) || 'PENDIENTE', 40).toUpperCase(),
            motivo: normText(entry && (entry.motivo || entry.error || ''), 200),
            fecha: normText((entry && (entry.fecha || (entry.ts ? new Date(Number(entry.ts)).toISOString() : ''))) || '', 40) || null
          };
          const sig = signatureOf(item);
          if(ack.colas[itemId] === sig) return;
          signatures.colas[itemId] = sig;
          colas.push(item);
        });
      }

      const outboxRaw = safeJsonParse(storage.getItem('nodo_chat_outbox_v1'), []);
      const outboxList = Array.isArray(outboxRaw) ? outboxRaw : Object.values(outboxRaw || {});
      outboxList.slice(0, 25).forEach(function(entry, idx){
        if(!entry || typeof entry !== 'object') return;
        const itemId = 'outbox:' + normText(entry.clientMsgId || entry.id || idx, 120);
        const item = {
          cola_tipo: 'CHAT_OUTBOX_ESTADO',
          item_id: itemId,
          usuario: normUser(entry.usuario || ''),
          referencia_id: normText(entry.conversationId || entry.solicitudId || '', 80),
          estado: normText(entry.status || entry.estado || 'PENDING', 40).toUpperCase(),
          motivo: normText(entry.lastError || entry.error || '', 200),
          fecha: normText(entry.createdAt || entry.fecha || '', 40) || null
        };
        const sig = signatureOf(item);
        if(ack.colas[itemId] === sig) return;
        signatures.colas[itemId] = sig;
        colas.push(item);
      });

      const total = jugadores.length + movimientos.length + cotejos.length + colas.length;
      return {
        pc,
        payload: { jugadores, movimientos, cotejos, colas },
        signatures,
        total
      };
    }

    async function ensureCapability(pc){
      const office = getOffice(pc);
      const panelAPI = getPanelApi();
      if(!office || !panelAPI || typeof panelAPI.rpc !== 'function'){
        return { mode: 'legacy', reason: 'no_transport' };
      }
      const cached = capabilityByOffice.get(office);
      if(cached && cached.mode === 'beta') return cached;

      let build = 'renderer';
      if(typeof panelAPI.getContext === 'function'){
        try{
          const rawCtx = await panelAPI.getContext();
          const ctx = (rawCtx && rawCtx.beta) ? rawCtx.beta : rawCtx;
          if(!ctx || ctx.enabled !== true || (Array.isArray(ctx.offices) && !ctx.offices.includes(office))){
            return { mode: 'legacy', reason: 'config' };
          }
          if(ctx.build) build = normText(ctx.build, 64);
        }catch(_e){
          return { mode: 'legacy', reason: 'context_error' };
        }
      }

      const capHealth = getHealth()?.begin?.('CAPACIDADES');
      const raw = await panelAPI.rpc(CAP_FN, {
        p_pc_codigo: office,
        p_activate: false
      });
      const { data, error } = unwrapRpc(raw);
      capHealth?.reply?.(error);
      if(error || !data || data.ok !== true || data.enabled !== true){
        capHealth?.record?.('DATA', error ? 'ERROR' : 'UNKNOWN', error ? (error.code || 'CAPACIDADES_ERROR') : 'CAPACIDADES_DISABLED');
        return { mode: 'legacy', reason: error ? (error.code || 'rpc_error') : 'disabled', error };
      }
      const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
      capHealth?.record?.('DATA', 'OK', 'CAPACIDADES_PERSISTENCIA_OK');
      if(!caps.includes(REQUIRED_CAP)){
        return { mode: 'legacy', reason: 'capability_missing', capabilities: caps };
      }
      const state = { mode: 'beta', capabilities: caps, office, build };
      capabilityByOffice.set(office, state);
      return state;
    }

    async function sync(options){
      const opts = options || {};
      const pc = getOffice(opts.pc);
      const health = getHealth()?.begin?.('CONCILIACION');
      if(!pc){
        health?.record?.('DATA', 'UNKNOWN', 'PERSISTENCIA_NO_OFFICE');
        return { mode: 'legacy', synced: false, reason: 'no_office' };
      }
      const cap = await ensureCapability(pc);
      if(cap.mode !== 'beta'){
        health?.record?.('CONNECTED', cap.reason === 'rpc_error' ? 'ERROR' : 'UNKNOWN', 'PERSISTENCIA_LEGACY_' + String(cap.reason || 'MODE').toUpperCase());
        return { mode: 'legacy', synced: false, reason: cap.reason };
      }
      const batch = collectPending(pc);
      if(batch.total === 0 && !opts.forceEmpty){
        health?.record?.('DATA', 'OK', 'PERSISTENCIA_UP_TO_DATE');
        return { mode: 'beta', synced: true, empty: true, acceptedTotal: 0 };
      }

      const panelAPI = getPanelApi();
      const raw = await panelAPI.rpc(SYNC_FN, {
        p_pc_codigo: pc,
        p_instalacion: getInstallation(pc),
        p_version: normText(cfg.version || cap.build || 'beta-persistencia-v1', 64),
        p_lote: batch.payload
      });
      const { data, error } = unwrapRpc(raw);
      health?.reply?.(error);
      if(error || !data || data.ok !== true || normOffice(data.scope && data.scope.pc_codigo) !== pc){
        health?.record?.('EFFECT', 'ERROR', error ? (error.code || 'PERSISTENCIA_SYNC_FAILED') : 'PERSISTENCIA_INVALID_ACK');
        return { mode: 'beta', synced: false, error: error || { code: 'PERSISTENCIA_INVALID_ACK', message: 'El servidor no confirmó la recepción.' } };
      }

      const acked = (data.acknowledged && typeof data.acknowledged === 'object') ? data.acknowledged : {};
      const store = readAckStore(pc);
      ['jugadores', 'movimientos', 'cotejos', 'colas'].forEach(function(cat){
        const ids = Array.isArray(acked[cat]) ? acked[cat] : [];
        ids.forEach(function(id){
          const key = normText(id, 256);
          if(key && batch.signatures[cat] && batch.signatures[cat][key]){
            store[cat][key] = batch.signatures[cat][key];
          }
        });
      });
      writeAckStore(pc, store);
      health?.record?.('DATA', 'OK', 'PERSISTENCIA_PAYLOAD_VALID');
      health?.record?.('EFFECT', 'OK', 'PERSISTENCIA_SYNC_ACK');
      return {
        mode: 'beta',
        synced: true,
        acceptedTotal: Number(data.accepted_total) || 0,
        acknowledged: acked
      };
    }

    async function hydrate(options){
      const opts = options || {};
      const pc = getOffice(opts.pc);
      const health = getHealth()?.begin?.('CONCILIACION');
      if(!pc) return { mode: 'legacy', hydrated: false, reason: 'no_office' };
      const cap = await ensureCapability(pc);
      if(cap.mode !== 'beta') return { mode: 'legacy', hydrated: false, reason: cap.reason };

      const panelAPI = getPanelApi();
      const raw = await panelAPI.rpc(READ_FN, {
        p_pc_codigo: pc,
        p_usuario: opts.usuario ? normUser(opts.usuario) : null,
        p_referencia_id: opts.referenciaId ? normText(opts.referenciaId, 120) : null,
        p_tipo: normText(opts.tipo || 'TODO', 32).toUpperCase(),
        p_limit: Number(opts.limit) > 0 ? Math.min(Number(opts.limit), 200) : 100
      });
      const { data, error } = unwrapRpc(raw);
      health?.reply?.(error);
      if(error || !data || data.ok !== true || normOffice(data.scope && data.scope.pc_codigo) !== pc){
        health?.record?.('DATA', 'ERROR', error ? (error.code || 'PERSISTENCIA_READ_FAILED') : 'PERSISTENCIA_INVALID_READ');
        return { mode: 'beta', hydrated: false, error: error || { code: 'PERSISTENCIA_INVALID_READ' } };
      }

      const storage = getStorage();
      let mergedJugadores = 0;
      let mergedMovimientos = 0;
      let mergedCotejos = 0;

      if(storage){
        if(Array.isArray(data.jugadores) && data.jugadores.length){
          const jugMap = safeJsonParse(storage.getItem('nodo_jugadores_local_v2'), {});
          const rechMap = safeJsonParse(storage.getItem('nodo_titulares_rechazados'), {});
          data.jugadores.forEach(function(row){
            if(!row || !row.usuario || !row.valor) return;
            if(row.atributo === 'titular_rechazado' || row.fuente === 'local.titulares_rechazados'){
              const k = (row.usuario === '*' ? '*' : normUser(row.usuario)) + '|' + String(row.valor).toLowerCase().trim();
              if(!rechMap[k]){
                rechMap[k] = {
                  usuario: row.usuario,
                  titular: row.valor,
                  motivo: (row.detalle && row.detalle.motivo) || row.estado || '',
                  fecha: row.ultima_fecha || row.updated_at || new Date().toISOString()
                };
                mergedJugadores++;
              }
              return;
            }
            const u = normUser(row.usuario);
            if(!u || u === '*') return;
            const cur = jugMap[u] || { usuario: u, pc_codigo: pc, telefonos: {}, cbus: {}, titulares: {}, bonos: [], creado: row.primera_fecha || row.ultima_fecha || new Date().toISOString() };
            cur.pc_codigo = cur.pc_codigo || pc;
            if(row.campo === 'telefono'){
              const tKey = String(row.valor).replace(/\D/g, '');
              if(tKey && !cur.telefonos[tKey]){
                cur.telefonos[tKey] = { raw: tKey, veces: Number(row.veces) || 1, verificado: !!row.verificado, primera: row.primera_fecha, ultima: row.ultima_fecha };
                mergedJugadores++;
              }
            }else if(row.campo === 'cbu'){
              const cKey = String(row.valor).toLowerCase().replace(/[\s.\-]/g, '').trim();
              if(cKey && !cur.cbus[cKey]){
                cur.cbus[cKey] = { raw: row.valor, titular: row.titular_asociado || '', veces: Number(row.veces) || 1, verificado: !!row.verificado, primera: row.primera_fecha, ultima: row.ultima_fecha };
                mergedJugadores++;
              }
            }else if(row.campo === 'nombre'){
              const nKey = String(row.valor).toLowerCase().trim();
              if(nKey && !cur.titulares[nKey]){
                cur.titulares[nKey] = { raw: row.valor, veces: Number(row.veces) || 1, primera: row.primera_fecha, ultima: row.ultima_fecha };
                mergedJugadores++;
              }
            }
            jugMap[u] = cur;
          });
          try{
            storage.setItem('nodo_jugadores_local_v2', JSON.stringify(jugMap));
            storage.setItem('nodo_titulares_rechazados', JSON.stringify(rechMap));
          }catch(_e){}
        }

        if(Array.isArray(data.movimientos) && data.movimientos.length){
          const movMap = safeJsonParse(storage.getItem('nodo_movimientos_v1'), {});
          data.movimientos.forEach(function(row){
            if(!row || !row.movimiento_key || !row.usuario) return;
            const k = String(row.movimiento_key);
            if(movMap[k]) return;
            movMap[k] = {
              id: row.historial_id != null ? row.historial_id : row.movimiento_key,
              pc_codigo: pc,
              usuario: row.usuario,
              tipo: row.tipo || '',
              monto: row.monto != null ? Number(row.monto) : 0,
              estado: row.estado || '',
              titular: row.titular || '',
              destino: row.destino || '',
              cbu: row.cbu || '',
              obs: row.obs || '',
              saldoPre: row.saldo_pre != null ? Number(row.saldo_pre) : null,
              saldoPost: row.saldo_post != null ? Number(row.saldo_post) : null,
              billeteraNombre: row.billetera_nombre || '',
              operador: row.operador || '',
              chuniorId: row.chunior_id || null,
              solicitudId: row.solicitud_id || null,
              bonoPct: row.bono_pct != null ? Number(row.bono_pct) : null,
              origen: row.origen || '',
              notas: row.notas || '',
              _fecha: row.fecha || row.updated_at || new Date().toISOString(),
              _ts: Date.now()
            };
            mergedMovimientos++;
          });
          try{ storage.setItem('nodo_movimientos_v1', JSON.stringify(movMap)); }catch(_e){}
        }

        if(Array.isArray(data.cotejos) && data.cotejos.length){
          const altaRes = safeJsonParse(storage.getItem('nodo.cotejo.resueltos'), {});
          data.cotejos.forEach(function(row){
            if(!row || row.tipo_cotejo !== 'ALTA_TELEFONO') return;
            const clave = (row.usuario_declarado || row.usuario || '') + '|' + (row.telefono_declarado || row.telefono || '');
            if(!clave || clave === '|' || altaRes[clave]) return;
            altaRes[clave] = {
              usuario: row.usuario || '',
              telefono: row.telefono || '',
              cuando: row.fecha ? new Date(row.fecha).getTime() : Date.now()
            };
            mergedCotejos++;
          });
          try{ storage.setItem('nodo.cotejo.resueltos', JSON.stringify(altaRes)); }catch(_e){}
        }
      }

      health?.record?.('DATA', 'OK', 'PERSISTENCIA_READ_OK');
      return {
        mode: 'beta',
        hydrated: true,
        merged: { jugadores: mergedJugadores, movimientos: mergedMovimientos, cotejos: mergedCotejos },
        colasObservadas: Array.isArray(data.colas_observadas) ? data.colas_observadas : []
      };
    }

    let syncTimer = null;
    function scheduleSync(delayMs){
      const w = getWindow();
      const setTimer = w.setTimeout || setTimeout;
      const clearTimer = w.clearTimeout || clearTimeout;
      if(syncTimer){ try{ clearTimer(syncTimer); }catch(_e){} }
      syncTimer = setTimer(function(){
        syncTimer = null;
        try{ void sync(); }catch(_e){}
      }, Number(delayMs) > 0 ? Number(delayMs) : 4000);
    }

    return {
      collectPending,
      ensureCapability,
      sync,
      scheduleSync,
      hydrate,
      readAckStore
    };
  }

  const defaultInstance = create({ window: root });
  defaultInstance.create = create;
  return defaultInstance;
});
