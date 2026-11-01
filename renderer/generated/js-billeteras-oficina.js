
// ============================================================
// SAFE FIX FINAL · Billeteras por oficina real XPLATA
// Motivo: la sync detecta UIDs desde Chunior, pero el render queda vacío.
// Este override fuerza lectura Supabase por oficina_id/compat y, si falla,
// muestra las billeteras detectadas desde Chunior para no dejar el panel sin operar.
// No toca motor de carga/retiro/worker.
// ============================================================
(function(){
  function _n(v){ return String(v||'').trim().toUpperCase(); }
  function _isFusionada(b){ return _n(b.estado || b.ESTADO) === 'FUSIONADA'; }
  function _isActiva(b){
    const v = b.activa ?? b.ACTIVA;
    return v === true || _n(v) === 'TRUE' || _n(v) === 'SI' || _n(v) === 'ACTIVA' || v === 1;
  }
  function _moneyLocal(v){
    try{ return money(Number(v||0)); }catch(_){ return '$ '+Number(v||0).toLocaleString('es-AR'); }
  }
  function _mapWallet(b){
    const uid = String(b.chunior_uid || b.uid || b.CHUNIOR_UID || '').trim();
    const saldoMap = window.__nodoChuniorWalletSaldoByUid || {};
    let nombreMap = window.__nodoChuniorWalletNombreByUid || {};
    try{
      if(!Object.keys(nombreMap||{}).length){
        nombreMap = JSON.parse(localStorage.getItem('nodo_chunior_wallet_nombres') || '{}');
      }
    }catch(_e){ nombreMap = {}; }
    const saldo = (uid && Object.prototype.hasOwnProperty.call(saldoMap, uid)) ? Number(saldoMap[uid]||0) : Number(b.saldo ?? b.SALDO ?? 0);
    const nombreChunior = uid && nombreMap[String(uid)] ? String(nombreMap[String(uid)]) : '';
    return {
      ID_BILLETERA: b.id ?? b.ID_BILLETERA ?? uid,
      NOMBRE_VISIBLE: b.nombre_visible || b.nombre || b.NOMBRE_VISIBLE || nombreChunior || 'Billetera Chunior',
      NOMBRE_CHUNIOR: nombreChunior || b.nombre_chunior || b.nombre || b.NOMBRE_CHUNIOR || b.nombre_visible || b.NOMBRE_VISIBLE || '',
      TIPO: b.tipo || b.banco || b.TIPO || b.BANCO || (uid ? 'Chunior' : ''),
      BANCO: b.banco || b.BANCO || '',
      PC: b.pc_codigo || b.PC || window.pcOperativa || '',
      OFICINA_ID: b.oficina_id || b.OFICINA_ID || window.oficinaId || '',
      ACTIVA: 'SI',
      SELECCIONADA_MANUAL: (b.seleccionada_manual === true || _n(b.seleccionada_manual || b.SELECCIONADA_MANUAL) === 'SI' || _n(b.seleccionada_manual || b.SELECCIONADA_MANUAL) === 'TRUE') ? 'SI' : 'NO',
      SALDO: saldo,
      CBU_ALIAS: b.cbu_alias || b.alias || b.cbu || b.CBU_ALIAS || b.ALIAS || b.CBU || '',
      ALIAS: b.alias || b.ALIAS || '',
      CBU: b.cbu || b.CBU || '',
      TITULAR: b.titular || b.TITULAR || '',
      CHUNIOR_UID: uid,
      ESTADO: b.estado || b.ESTADO || 'ACTIVA'
    };
  }
  function _extractRows(data){
    try{ if(typeof data === 'string') data = JSON.parse(data); }catch(_e){}
    if(Array.isArray(data)) return data;
    if(data && Array.isArray(data.rows)) return data.rows;
    if(data && data.data && Array.isArray(data.data.rows)) return data.data.rows;
    return [];
  }
  async function _readWalletsForced(){
    let rows = [];
    // PC estricta: solo billeteras de esta oficina/PC
    const _pc = String(
      window.pcOperativa ||
      (typeof pcOperativa !== 'undefined' ? pcOperativa : '') ||
      window.landingPcCodigo ||
      localStorage.getItem('nodo_pc_operativa_lite') ||
      localStorage.getItem('panel_pc_operativa') ||
      ''
    ).trim().toUpperCase();

    // 1) RPC con PC correcto
    try{
      const r = await supabaseClient.rpc('panel_nodo_list_billeteras', {
        p_pc_codigo: _pc,
        p_landing_pc_codigo: _pc
      });
      if(!r.error) rows = _extractRows(r.data);
      else console.warn('wallet rpc error', r.error);
    }catch(e){ console.warn('wallet rpc exception', e); }

    // 2) Directo filtrado ESTRICTAMENTE por pc_codigo de esta oficina
    if(!rows.length){
      try{
        const r = await supabaseClient
          .from('billeteras')
          .select('*')
          .eq('activa', true)
          .eq('pc_codigo', _pc)
          .order('seleccionada_manual',{ascending:false})
          .order('nombre_visible',{ascending:true});
        if(!r.error) rows = r.data || [];
        else console.warn('wallet direct error', r.error);
      }catch(e){ console.warn('wallet direct exception', e); }
    }

    // 3) Directo por UID detectados desde Chunior (ya son de esta PC)
    if(!rows.length){
      let uids = [];
      try{ uids = JSON.parse(localStorage.getItem('nodo_chunior_wallet_uids') || '[]'); }catch(_e){}
      if(Array.isArray(window.__nodoChuniorWalletUids) && window.__nodoChuniorWalletUids.length) uids = window.__nodoChuniorWalletUids;
      uids = Array.from(new Set((uids||[]).map(String).filter(Boolean)));
      if(uids.length){
        try{
          const r = await supabaseClient
            .from('billeteras')
            .select('*')
            .in('chunior_uid', uids)
            .eq('pc_codigo', _pc)
            .order('seleccionada_manual',{ascending:false})
            .order('nombre_visible',{ascending:true});
          if(!r.error) rows = r.data || [];
          else console.warn('wallet uid error', r.error);
        }catch(e){ console.warn('wallet uid exception', e); }
      }
    }

    // 4) Último recurso: mostrar lo leído desde Chunior, para no dejar el panel sin select.
    if(!rows.length && window.__nodoChuniorWalletSaldoByUid){
      const saldoMap = window.__nodoChuniorWalletSaldoByUid || {};
      let nombreMap = window.__nodoChuniorWalletNombreByUid || {};
      try{
        if(!Object.keys(nombreMap||{}).length){
          nombreMap = JSON.parse(localStorage.getItem('nodo_chunior_wallet_nombres') || '{}');
        }
      }catch(_e){ nombreMap = {}; }
      rows = Object.keys(saldoMap).map(uid => ({
        id: 'CH_'+uid,
        chunior_uid: uid,
        nombre_visible: nombreMap[String(uid)] || ('Chunior '+uid),
        nombre_chunior: nombreMap[String(uid)] || ('Chunior '+uid),
        saldo: saldoMap[uid],
        activa: true,
        estado: 'ACTIVA',
        seleccionada_manual: false,
        oficina_id: (window.oficinaId || _pc || ''),
        pc_codigo: (_pc || ''),
        banco: 'Chunior'
      }));
    }

    return rows.filter(b => _isActiva(b) && !_isFusionada(b)).map(_mapWallet);
  }

  // Ésta es la carga de billeteras que corre: la de core/vistas-y-billeteras.js queda pisada acá. Por
  // eso el semáforo se engancha en ésta (Juan, 1/11: anotarlo en la otra dejaba Billeteras sin datos).
  window.cargarBilleteras = cargarBilleteras = async function(render=true){
    const health = window.NodoSalud?.begin('BILLETERAS');
    const mapped = await _readWalletsForced();
    if((mapped||[]).length) health?.record('DATA','OK');
    else health?.record('DATA','ERROR','BILLETERAS_LOAD_FAILED');
    // Dedup por CHUNIOR_UID: la misma wallet puede venir repetida (filas duplicadas en billeteras).
    // Conserva la primera (la EN PORTAL queda primera por el orden seleccionada_manual desc).
    const _seen=new Set(); const _ded=[];
    for(const _b of (mapped||[])){ const _k=String(_b.CHUNIOR_UID||'').trim(); if(_k){ if(_seen.has(_k)) continue; _seen.add(_k); } _ded.push(_b); }
    billeteras = _ded;
    try{ window.billeteras = billeteras; }catch(_e){}
    if(render){ try{ renderBilleteras(); }catch(e){ console.warn('renderBilleteras',e); } }
    try{ renderBillerasInicio(); }catch(e){ console.warn('renderBillerasInicio',e); }
    try{ poblarManualBilletera(); }catch(e){ console.warn('poblarManualBilletera',e); }
    try{ renderEstadoLanding(); }catch(e){ console.warn('renderEstadoLanding',e); }
    try{
      const bil = billeteras.find(b=>_n(b.SELECCIONADA_MANUAL)==='SI') || billeteras[0] || null;
      if(bil){
        setBox('statBilletera', bil.NOMBRE_VISIBLE || '-');
        setBox('statBilleteraTipo', (bil.TIPO||'') + (bil.PC ? ' · '+bil.PC : ''));
      }
    }catch(_e){}
    return billeteras;
  };

  const _oldSync = window.sincronizarBilleterasChunior || sincronizarBilleterasChunior;
  window.sincronizarBilleterasChunior = sincronizarBilleterasChunior = async function(silencioso){
    let res;
    try{ res = await _oldSync(silencioso); }catch(e){ console.warn('sync original error no bloqueante', e); }
    await cargarBilleteras(false);
    // Comparar esperado (por operaciones) vs real de Chunior → aviso leve de diferencias + re-basar.
    try{ if(window._chequearDiferenciasBilletera) window._chequearDiferenciasBilletera(); }catch(e){ console.warn('chequeo dif billetera', e); }
    try{ renderInicio(); }catch(e){ console.warn('renderInicio after force wallet',e); }
    if(!silencioso){
      if(billeteras && billeteras.length) toast('Billeteras cargadas: '+billeteras.length, 'green');
      else toast('Sincronizó Chunior, pero no se pudieron leer billeteras NODO.', 'red');
    }
    return res;
  };

  // Carga forzada al iniciar, después del login/render inicial.
  setTimeout(function(){ try{ cargarBilleteras(false).then(function(){ try{ renderInicio(); }catch(_e){} }); }catch(_e){} }, 1800);
})();
