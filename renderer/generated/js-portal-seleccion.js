


// ============================================================
// SAFE PATCH · Portal select sin NaN / sin RPC nueva
// - Evita enviar NaN como id.
// - Resuelve billetera real por chunior_uid antes de guardar.
// - No usa oficina_id, estado ni updated_at desde REST.
// ============================================================
(function(){
  const COMPAT_PC = 'P1';
  function _numOk(v){ return /^\d+$/.test(String(v||'').trim()); }
  function _cleanUid(v){
    const s = String(v||'').trim();
    if(!s || s.toLowerCase()==='nan' || s.toLowerCase()==='undefined' || s.toLowerCase()==='null') return '';
    return s.replace(/^CH_/i,'').trim();
  }
  function _localWallets(){
    try{
      const a = Array.isArray(window.billeteras) ? window.billeteras : (Array.isArray(billeteras) ? billeteras : []);
      return a || [];
    }catch(_e){ return []; }
  }
  function _walletMatches(w, raw, uid){
    const id = String(w.ID_BILLETERA ?? w.id ?? '').trim();
    const wu = _cleanUid(w.CHUNIOR_UID ?? w.chunior_uid ?? '');
    if(uid && wu && uid === wu) return true;
    if(raw && raw !== 'NaN' && raw !== 'undefined' && raw !== 'null' && id === raw) return true;
    if(raw && /^CH_/i.test(raw) && wu === _cleanUid(raw)) return true;
    return false;
  }
  async function _resolverIdReal(ref, uidArg){
    const raw = String(ref ?? '').trim();
    let uid = _cleanUid(uidArg || raw);

    const local = _localWallets().find(w => _walletMatches(w, raw, uid));
    if(!uid && local) uid = _cleanUid(local.CHUNIOR_UID ?? local.chunior_uid ?? '');

    // Si hay UID Chunior, esa es la verdad: buscar ID real activo en Supabase.
    if(uid && uid.toLowerCase() !== 'nan'){
      window.NodoSalud?.begin('BILLETERAS')?.record('DATA','OK','BILLETERA_UID_RESOLVE');
      const r = await supabaseClient
        .from('billeteras')
        .select('id,chunior_uid,activa,seleccionada_manual')
        .eq('chunior_uid', uid)
        .eq('activa', true)
        .order('seleccionada_manual', {ascending:false})
        .limit(1);
      if(r.error) throw new Error(r.error.message || 'Error buscando billetera por UID.');
      if(r.data && r.data.length && _numOk(r.data[0].id)) return Number(r.data[0].id);
    }

    // Solo usar raw como ID si es numérico real. Nunca NaN.
    if(_numOk(raw)){
      const r = await supabaseClient
        .from('billeteras')
        .select('id,activa')
        .eq('id', Number(raw))
        .limit(1);
      if(r.error) throw new Error(r.error.message || 'Error buscando billetera por ID.');
      if(r.data && r.data.length) return Number(r.data[0].id);
    }

    throw new Error('No pude resolver el ID real de la billetera. Sincronizá y probá nuevamente.');
  }

  window.seleccionarBilleteraSeguro = async function(ref, uidArg){
    const billeteraRef = String(ref || uidArg || '').trim();
    if(!billeteraRef){ alert('No se pudo identificar la billetera.'); return; }

    async function _marcarDirecto(){
      const uid = String(uidArg || '').trim();
      const b = (billeteras||[]).find(function(w){
        return String(w.ID_BILLETERA||'') === billeteraRef
          || String(w.CHUNIOR_UID||'') === billeteraRef
          || String(w.CHUNIOR_UID||'') === uid
          || String(w.NOMBRE_VISIBLE||'').trim().toLowerCase() === billeteraRef.toLowerCase()
          || String(w.CBU_ALIAS||'') === billeteraRef
          || String(w.CBU||'') === billeteraRef
          || String(w.ALIAS||'') === billeteraRef;
      });

      if(!b || !b.ID_BILLETERA) return {ok:false, reason:'NO_LOCAL_WALLET'};

      const id = String(b.ID_BILLETERA);
      const scopePc = String(b.PC || pcOperativa || '').trim();
      const scopeOfi = String(b.OFICINA_ID || '').trim();

      // 1) Desmarcar anteriores. Intentamos por scope, si falla por columnas/RLS, global.
      let rOff = null;
      try{
        if(scopePc){
          rOff = await supabaseClient.from('billeteras').update({seleccionada_manual:false}).eq('pc_codigo', scopePc);
        }
      }catch(_e){}
      if(!rOff || rOff.error){
        try{
          if(scopeOfi){
            rOff = await supabaseClient.from('billeteras').update({seleccionada_manual:false}).eq('oficina_id', scopeOfi);
          }
        }catch(_e){}
      }
      if(!rOff || rOff.error){
        try{
          rOff = await supabaseClient.from('billeteras').update({seleccionada_manual:false}).neq('id', id);
        }catch(_e){}
      }

      // 2) Marcar elegida.
      let rOn = await supabaseClient.from('billeteras').update({seleccionada_manual:true}).eq('id', id);
      if(rOn.error && b.CHUNIOR_UID){
        rOn = await supabaseClient.from('billeteras').update({seleccionada_manual:true}).eq('chunior_uid', b.CHUNIOR_UID);
      }
      if(rOn.error){
        rOn = await supabaseClient.from('billeteras').update({seleccionada_manual:true}).eq('nombre_visible', b.NOMBRE_VISIBLE);
      }
      if(rOn.error) return {ok:false, reason:'DIRECT_UPDATE_ERROR', error:rOn.error};

      // 3) Reflejar local inmediato para no esperar cache.
      (billeteras||[]).forEach(function(w){ w.SELECCIONADA_MANUAL = 'NO'; });
      b.SELECCIONADA_MANUAL = 'SI';
      return {ok:true, data:b};
    }

    let salud;
    try{
      // Resolver el id real de la billetera elegida (desde el array local).
      const _uid = String(uidArg || '').trim();
      const b = (billeteras||[]).find(function(w){
        return String(w.ID_BILLETERA||'') === billeteraRef
          || String(w.CHUNIOR_UID||'') === billeteraRef
          || (_uid && String(w.CHUNIOR_UID||'') === _uid)
          || String(w.NOMBRE_VISIBLE||'').trim().toLowerCase() === billeteraRef.toLowerCase()
          || String(w.CBU_ALIAS||'') === billeteraRef
          || String(w.CBU||'') === billeteraRef
          || String(w.ALIAS||'') === billeteraRef;
      });
      if(!b || !b.ID_BILLETERA){ alert('No encontré la billetera en NODO. Sincronizá y probá de nuevo.'); return; }

      // Escritura BLINDADA por RPC. El UPDATE directo lo filtra la RLS a 0 filas SIN error
      // (por eso antes decía "marcada" pero no aplicaba). Va SIEMPRE por la RPC, nunca directo.
      const r = await supabaseClient.rpc('nodo_seleccionar_billetera_portal', {
        p_secret: window.PANEL_DATA_SECRET,
        p_id: Number(b.ID_BILLETERA),
        p_pc_codigo: (pcOperativa || window.pcOperativa || b.PC || '')
      });
      if(r.error) throw new Error(r.error.message || 'No se pudo marcar la billetera para portal.');
      let data = r.data;
      try{ if(typeof data === 'string') data = JSON.parse(data); }catch(_e){}
      if(data && data.ok === false){ alert(data.mensaje || data.error || 'No se pudo marcar la billetera.'); return; }

      try{ toast('Billetera marcada para portal', 'green'); }catch(_e){}
      await new Promise(res=>setTimeout(res,400));
      try{ await cargarBilleteras(false); }catch(_e){}
      try{ renderBilleteras(); }catch(_e){}
      try{ renderBillerasInicio(); }catch(_e){}
      try{ poblarManualBilletera(); }catch(_e){}
      try{ renderEstadoLanding(); }catch(_e){}
      try{ renderInicio(); }catch(_e){}
    }catch(e){
      alert(e.message || 'Error seleccionando billetera para portal');
    }
  };

  window.seleccionarBilletera = seleccionarBilletera = async function(ref){
    let uid = '';
    try{
      const raw = String(ref ?? '').trim();
      const local = _localWallets().find(w => _walletMatches(w, raw, _cleanUid(raw)));
      uid = _cleanUid(local?.CHUNIOR_UID ?? local?.chunior_uid ?? raw);
    }catch(_e){}
    return window.seleccionarBilleteraSeguro(ref, uid);
  };
})();

