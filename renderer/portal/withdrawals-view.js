/* Portal: withdrawals-view. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalWithdrawalsView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","_rv2LeerSaldo","_rv2RenderConfirmar","abrirModalRetiroV2","billeteras","confirm","document","escapeHtml","money","recomendarRepartoRetiro","setTimeout","toast","window"]);
  function create(deps){
const api = {};
  // ── Sugerencia + selección de billetera de pago (fusión con el parcial del colega 1.0.85) ──
  // Base = NUESTRO flujo (un monto + progreso portal + push). Le sumamos el asistente del colega:
  // sugiere con qué billetera(s) pagar (greedy por saldo, redondeado) y deja editar el reparto.
  // Sin checkbox: la billetera "cuenta" si su monto > 0 (edición directa, sin re-render frágil).
  function _montoRedondo(v){ v=Math.abs(Number(v)||0); if(v>=100000)return Math.floor(v/100000)*100000; if(v>=10000)return Math.floor(v/10000)*10000; if(v>=1000)return Math.floor(v/1000)*1000; return Math.floor(v/100)*100; }
  api._montoRedondo = deps.window._montoRedondo || _montoRedondo;
  api.recomendarRepartoRetiro = function(monto, maxBils){
    maxBils = maxBils || 3;
    const objetivo = Math.abs(Number(monto)||0);
    const conSaldo = (deps.billeteras||[])
      .filter(function(b){ return Number(b.SALDO||0) >= 200000 && !/promo|referid/i.test(String(b.NOMBRE_VISIBLE||'')); })
      .map(function(b){ return { id:b.ID_BILLETERA, nombre:b.NOMBRE_VISIBLE||'—', saldo:Number(b.SALDO||0), chunior:b.CHUNIOR_UID }; })
      .sort(function(a,b){ return b.saldo - a.saldo; });
    if(!objetivo || !conSaldo.length) return { reparto:[], pagable:0, objetivo:objetivo };
    const reparto = []; let acum = 0;
    for(const b of conSaldo){
      if(acum >= objetivo - 0.5 || reparto.length >= maxBils) break;
      // Sin redondear: el reparto tiene que sumar el objetivo EXACTO. Redondeando hacia abajo
      // quedaba siempre un resto y el retiro salía parcial sin que nadie lo pidiera.
      let usar = Math.min(b.saldo, objetivo - acum);
      if(usar <= 0) continue;
      reparto.push({ id:b.id, nombre:b.nombre, saldo:b.saldo, usar:usar, chunior:b.chunior });
      acum += usar;
    }
    const pagable = reparto.reduce(function(s,x){ return s+x.usar; }, 0);
    return { reparto:reparto, pagable:pagable, objetivo:objetivo, cubre:pagable>=objetivo-0.5 };
  };
  // Pinta la caja de sugerencia/edición de billeteras según el monto del modal parcial.
  api.v154pReparto = function(){
    const box = deps.document.getElementById('v154pRepartoBox'); if(!box) return;
    const monto = Math.abs(Number((deps.document.getElementById('v154pParcialMonto')||{}).value||0));
    if(!monto){ box.innerHTML='<div class="small" style="color:#8b949e;margin-top:6px">Ingresá el monto para ver la sugerencia de billeteras.</div>'; return; }
    const rep = deps.window.recomendarRepartoRetiro(monto);
    const sug = {}; (rep.reparto||[]).forEach(function(x){ sug[String(x.id)]=x.usar; });
    const usables = (deps.billeteras||[]).filter(function(b){ return Number(b.SALDO||0)>=200000 && !/promo|referid/i.test(String(b.NOMBRE_VISIBLE||'')); }).sort(function(a,b){ return Number(b.SALDO||0)-Number(a.SALDO||0); });
    let html = '<div style="margin-top:10px;font-weight:800;color:#c9d1d9;font-size:13px">¿Con qué billetera(s) pagás? <span class="small" style="color:#8b949e;font-weight:400">· sugerido por saldo · editá o dejá en 0</span></div>';
    if(!usables.length){ box.innerHTML = html + '<div class="small" style="color:#fca5a5;margin-top:5px">⚠ Sin billeteras con saldo (≥$200k, sin promo/referido). Se usará la billetera por defecto.</div>'; return; }
    html += usables.slice(0,8).map(function(b){
      const bid=String(b.ID_BILLETERA); const m=Number(sug[bid]||0);
      return '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">'
        + '<span style="flex:1;min-width:0;font-size:12px"><b>'+deps.escapeHtml(b.NOMBRE_VISIBLE||'—')+'</b> <span style="color:#8b949e">· '+deps.money(b.SALDO||0)+'</span></span>'
        + '<input type="number" inputmode="numeric" class="v154pRepInp" data-bil="'+bid+'" value="'+(m||'')+'" oninput="v154pRepartoTotal()" placeholder="0" style="width:120px;text-align:right;font-weight:700">'
        + '</div>';
    }).join('');
    html += '<div id="v154pRepartoTotal" style="margin-top:8px;font-size:12px"></div>';
    box.innerHTML = html;
    deps.window.v154pRepartoTotal();
  };
  api.v154pRepartoTotal = function(){
    const monto = Math.abs(Number((deps.document.getElementById('v154pParcialMonto')||{}).value||0));
    let tot=0; deps.document.querySelectorAll('.v154pRepInp').forEach(function(inp){ tot += Math.abs(Number(inp.value)||0); });
    const el=deps.document.getElementById('v154pRepartoTotal'); if(!el) return;
    const dif = monto - tot;
    el.innerHTML = 'Repartido: <b style="color:'+(Math.abs(dif)<=0.5?'#22c55e':'#f5c518')+'">'+deps.money(tot)+'</b> / '+deps.money(monto)
      + (Math.abs(dif)<=0.5 ? ' ✓' : (dif>0 ? ' · faltan '+deps.money(dif) : ' · te pasaste '+deps.money(-dif)));
  };
  api.v154pLeerRepartoSel = function(){
    const out=[]; deps.document.querySelectorAll('.v154pRepInp').forEach(function(inp){
      const m=Math.abs(Number(inp.value)||0);
      if(m>0){ const bid=inp.getAttribute('data-bil'); const b=(deps.billeteras||[]).find(function(x){return String(x.ID_BILLETERA)===bid;}); if(b) out.push({id:b.ID_BILLETERA, chunior:b.CHUNIOR_UID, nombre:b.NOMBRE_VISIBLE, monto:m}); }
    });
    return out;
  };

  // Retiros parciales (punto 3, opción 2 · "se retiran las fichas"): "Parcial" EJECUTA el retiro
  // real por el monto parcial (descuenta las fichas en casinodrex, mismos primitivos blindados que
  // retirarSaldoRapido) y SOLO si salió bien registra el progreso (landing_retiro_registrar_parcial)
  // y avisa al usuario por PUSH (el chat no siempre llega).

// ══════════════════════════════════════════════════════════════════════════
// RETIRO PARCIAL V2 (_rv2*) — portado de NexoBetaChan. Modal SEPARADO del retiro común.
// v154pRegistrarParcial delega acá (abrirModalRetiroV2). Ejecución propia:
// _rv2Aprobar→_rv2Confirmar→_rv2Finalizar (registra historial + actualiza solicitud + PUSH).
// Comparte recomendarRepartoRetiro/_montoRedondo con el madre. Incluye notificarRetiroParcialPortal.
// ══════════════════════════════════════════════════════════════════════════
deps.withdrawalState.current = null;
function _rv2Modal(){
  let el = deps.document.getElementById('retiroV2Modal');
  if(el) return el;
  el = deps.document.createElement('div');
  el.id = 'retiroV2Modal';
  el.style.cssText = 'display:none;position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:99999;width:min(460px,calc(100vw - 24px))';
  deps.document.body.appendChild(el);
  return el;
}
api.cerrarRetiroV2 = function(){ const el=deps.document.getElementById('retiroV2Modal'); if(el) el.style.display='none'; deps.withdrawalState.current=null; };

// opts.modoParcial: se abrió por el botón "💸 Parcial" → el operador YA declaró que va a pagar de
// menos, así que no se le vuelve a pedir que tilde "Confirmo retiro PARCIAL". En el retiro completo
// el tilde se mantiene, porque ahí sí es un freno útil (evita pagar de menos sin darse cuenta).
api.abrirModalRetiroV2 = function(id, opts){
  const S = (deps.window.V154P && Array.isArray(deps.V154P.solicitudes)) ? deps.V154P.solicitudes : [];
  const s = S.find(function(x){ return String(x.ID||x.SOLICITUD_ID||x.ID_SOLICITUD)===String(id); });
  if(!s){ deps.toast('Solicitud no encontrada','red'); return; }
  let meta={}; try{ meta=(typeof s.METADATA==='object'?s.METADATA:JSON.parse(s.METADATA||'{}'))||{}; }catch(_e){}
  const declarado = Math.abs(Number(String(s.MONTO_REAL||s.MONTO_DECLARADO||0).toString().replace(/[^\d.-]/g,''))||0);
  const restante = (meta.monto_restante!=null) ? Number(meta.monto_restante) : declarado;
  // SIN redondear: el objetivo es la deuda real. _montoRedondo redondea hacia abajo (1.430.000 →
  // 1.400.000), así que aplicado acá se "perdían" pesos del total. El redondeo es solo para SUGERIR.
  // OJO con el 0: si monto_restante existe y vale 0, el retiro está SALDADO. El `restante>0?:`
  // lo tomaba como "sin dato" y volvía a mostrar la deuda entera → el retiro quedaba en proceso
  // pidiendo de nuevo lo que ya se pagó.
  const objetivo = (meta.monto_restante!=null) ? Math.max(0, Number(meta.monto_restante)||0) : declarado;
  deps.withdrawalState.current = {
    id:id, usuario:String(s.USUARIO||''), titular:String(s.TITULAR||s.NOMBRE_COMPLETO||''),
    cbu:String(s.CBU||s.CVU||s.CBU_ALIAS||s.DESTINO||'').trim(),
    declarado:declarado, objetivo:objetivo, yaPagado:Number(meta.monto_pagado||0)||0,
    _metaTotal:(meta.monto_total!=null?Number(meta.monto_total):null), // total real de un parcial previo
    // Total de la DEUDA, editable (si la solicitud entró con un monto mal cargado hay que poder
    // corregirlo). "Falta pagar" = totalReal - yaPagado, y se recalcula al editarlo.
    totalReal:(meta.monto_total!=null?Number(meta.monto_total):declarado),
    fase:'setup', saldoReal:null, sel:{}, montos:{}, hechas:{},
    // Modo parcial explícito: por el botón "Parcial" o porque ya hay un parcial en curso.
    modoParcial: !!((opts&&opts.modoParcial) || Number(meta.monto_pagado||0) > 0),
    // Lo que el jugador PIDIÓ, sin corregir: MONTO_REAL ya viene con la corrección aplicada. Con esto
    // se sabe si el monto quedó ajustado y hay que decirle por qué (D-88).
    declaradoOriginal: Number(meta.monto_declarado_original) || Number(s.MONTO_DECLARADO) || declarado,
    motivoAjuste: (meta.motivo_ajuste != null && String(meta.motivo_ajuste).trim()) ? String(meta.motivo_ajuste) : null,
    _motivoEditado: !!(meta.motivo_ajuste != null && String(meta.motivo_ajuste).trim()),
    _motivoAvisado: String(meta.motivo_ajuste || '')
  };
  // SIN pre-selección: los montos arrancan en 0 y los pone el operador. Pre-seleccionar el reparto
  // sugerido hacía que se pagara de más sin querer — un retiro de 1M salió por 821.778 porque el
  // modal ya venía con una segunda billetera tildada en 321.778 que nadie eligió.
  _rv2Render();
  deps._rv2LeerSaldo();
};

// Billeteras utilizables para pagar: excluye error/promos/REFERIDOS, y oculta las que
// NO aportan al total (saldo < 5% del objetivo) — no tiene sentido mostrar $38k para un
// retiro de $5M. Siempre deja al menos las 4 más grandes por si hace falta.
const RV2_MIN_RETIRABLE = 5000;   // con 5.000 fichas o más, el retiro es viable (criterio operativo)
// Qué monto ofrecer cuando el usuario declaró MÁS de lo que tiene.
// Criterio del operador: se respeta lo que el usuario QUISO teclear, no se le da todo el saldo.
//   pidió 200.000 y tiene 203.015 → quiso 20.000... no: 200.000/10 = 20.000 entra → SÍ, 20.000.
//   Dicho de otra forma: si hubiera querido TODO habría tecleado 250 (con el cero de más);
//   como tecleó 200, quiere 20 — le sacamos el cero al DECLARADO, no lo capamos al saldo.
// Si sacando ceros nunca entra, recién ahí se ofrece todo lo que tiene.
// Lo MÁXIMO que se le puede sacar: sus fichas enteras (sin centavos, que Agentes no retira), y
// sólo si llegan al mínimo operativo. Es lo que ofrece el botón de la tarjeta de pendientes.
api._retiroMaxRetirable = function(saldo){
  const s = Math.floor(Math.abs(Number(saldo) || 0) + 1e-9);
  return s >= RV2_MIN_RETIRABLE ? s : 0;
};
api._retiroMontoSugerido = function(declarado, saldo){
  declarado = Math.abs(Number(declarado)||0); saldo = Math.abs(Number(saldo)||0);
  if(!(declarado>0) || !(saldo>0)) return null;
  if(declarado <= saldo + 0.5) return null;                 // alcanza → no hay nada que ajustar
  // El "cero de más" solo es creíble si lo declarado es MUY superior al saldo (≥3x). Si declaró
  // 60.000 y tiene 55.000 no se comió un cero: quiso ~todo, y ofrecerle 6.000 sería 10x menos.
  const unCero = declarado/10;
  if(declarado >= saldo*3 && unCero <= saldo + 0.5 && unCero >= RV2_MIN_RETIRABLE && Number.isInteger(unCero))
    return { monto:unCero, motivo:'ceros', ceros:1 };
  if(saldo >= RV2_MIN_RETIRABLE) return { monto:Math.floor(saldo), motivo:'todo' };
  return null;                                              // ni con todo el saldo llega al mínimo
};
const _RV2_EXCL = /error|promo|referid/i;
const _RV2_MIN_SALDO = 200000; // billeteras con menos de $200k no se usan para retiros
// TODAS las billeteras operables, ordenadas por saldo. Solo se excluyen las que no son de pago
// (error/promo/referidos). Antes se escondían las de saldo bajo y las que no "aportaban al total":
// eso rompía el parcial, porque muchas veces se quiere pagar justo desde una chica. La elección
// es del operador; el panel solo SUGIERE (ver _rv2BilsSugeridas).
function _rv2BilsUsables(objetivo){
  return (deps.billeteras||[])
    .filter(function(b){ return !_RV2_EXCL.test(String(b.NOMBRE_VISIBLE||'')); })
    .sort(function(a,b){ return Number(b.SALDO||0)-Number(a.SALDO||0); });
}
// Las que el panel recomienda para cubrir el objetivo. NO filtra la lista: devuelve un Set de IDs
// que el render marca con el chip "sugerida".
function _rv2BilsSugeridas(objetivo){
  let conSaldo = (deps.billeteras||[]).filter(function(b){
    return !_RV2_EXCL.test(String(b.NOMBRE_VISIBLE||'')) && Number(b.SALDO||0) >= _RV2_MIN_SALDO;
  }).sort(function(a,b){ return Number(b.SALDO||0)-Number(a.SALDO||0); });
  const obj = Math.abs(Number(objetivo)||0);
  if(obj > 0 && conSaldo.length > 4){
    const umbral = obj * 0.05;
    const relevantes = conSaldo.filter(function(b){ return Number(b.SALDO||0) >= umbral; });
    conSaldo = relevantes.length >= 2 ? relevantes : conSaldo.slice(0, 4);
  }
  return new Set(conSaldo.map(function(b){ return String(b.ID_BILLETERA); }));
}
function _rv2TotalSel(){
  const st = deps.withdrawalState.current; if(!st) return 0;
  return Object.keys(st.sel).reduce(function(acc,bid){ return acc + (st.sel[bid] ? (Number(st.montos[bid])||0) : 0); }, 0);
}
// Pre-relleno al tildar una billetera: SIEMPRE el RESTANTE que falta para llegar al objetivo,
// nunca el saldo completo de la billetera. Antes `falta||saldo` caía al saldo completo cuando
// `falta` daba 0 (JS trata 0 como falsy) → tildabas una billetera de más y te "pasabas" solo.
// Al tildar se completa con el monto EXACTO que cubre esa billetera: min(saldo, lo que falta).
// Antes pasaba por _montoRedondo, que redondea hacia ABAJO al múltiplo de 10k → tildabas para
// pagar 25.000 y te ponía 20.000. El redondeo sirve para SUGERIR, no para el auto-relleno.
api._rv2Toggle = function(bid){ const st=deps.withdrawalState.current; if(!st) return; bid=String(bid); st.sel[bid]=!st.sel[bid]; if(st.sel[bid] && !st.montos[bid]){ const b=(deps.billeteras||[]).find(function(x){return String(x.ID_BILLETERA)===bid;}); const falta=Math.max(0, st.objetivo - _rv2TotalSel()); st.montos[bid]= Math.min(Number(b&&b.SALDO||0), falta); } else if(!st.sel[bid]){ delete st.montos[bid]; } _rv2Render(); };
// Agregar una billetera desde el DESPLEGABLE. Le pone lo que cubre: min(saldo, lo que falta).
// Si el objetivo ya está cubierto entra en 0 (el operador reparte a mano) — así agregar una de
// más no infla el total sin querer. Siempre recalcula: sacarla y volver a elegirla no arrastra
// el monto viejo.
api._rv2AgregarBil = function(bid){
  const st = deps.withdrawalState.current; if(!st || !bid) return;
  bid = String(bid);
  const b = (deps.billeteras||[]).find(function(x){ return String(x.ID_BILLETERA)===bid; });
  if(!b) return;
  st.sel[bid] = true;
  st.montos[bid] = 0;   // el monto lo pone el operador — auto-llenar hacía pagar de más sin querer
  _rv2Render();
  // Foco en el campo de esa billetera para tipear el monto de una.
  try{ deps.setTimeout(function(){ const i=deps.document.querySelector('[data-rv2monto="'+bid+'"]'); if(i){ i.focus(); i.select(); } }, 40); }catch(_e){}
};
api._rv2SetMonto = function(bid, val){ const st=deps.withdrawalState.current; if(!st) return; st.montos[String(bid)] = Math.abs(Number(String(val).replace(/[^\d.-]/g,''))||0); _rv2ActualizarTotal(); };
api._rv2SetParcialOk = function(v){ if(deps.withdrawalState.current) deps.withdrawalState.current.parcialAceptado = !!v; };
// Fija el retiro al SALDO REAL del usuario (declaró de más). Al mover el objetivo, `montoTotal`
// del cierre pasa a ser ese monto → el retiro cierra COMPLETO, sin dejar un parcial fantasma por
// la diferencia mal declarada. Re-sugiere las billeteras para el monto nuevo.
// Atajo desde la card de pendientes: abre el modal de retiro YA ajustado al saldo real del usuario.
api._retiroAjustarASaldo = async function(id){
  const S=(deps.window.V154P&&deps.V154P.solicitudes)||[];
  const s=S.find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(id); });
  if(!s){ deps.toast('No encuentro la solicitud #'+id+' en pantalla.','red'); return; }
  const u=String(s.USUARIO||'').toLowerCase();
  const saldo=Number(((deps.window._retiroSaldoCheck||{})[u]||{}).saldo||0);
  const declarado=Number(s.MONTO_REAL||s.MONTO_DECLARADO||0);
  // Lo que se le deja pedido es TODO lo que tiene para retirar. Antes se ofrecía el monto "sin el
  // cero de más", que le dejaba fichas adentro (Juan, 14/09).
  const monto = deps.window._retiroMaxRetirable ? deps.window._retiroMaxRetirable(saldo) : 0;
  if(!saldo){ deps.toast('Todavía no se leyó el saldo de '+(s.USUARIO||'ese usuario')+'. Abrí el retiro y se lee.','yellow'); return; }
  if(!monto){ deps.toast(s.USUARIO+' tiene '+deps.money(saldo)+': menos del mínimo retirable ('+deps.money(RV2_MIN_RETIRABLE)+').','yellow'); return; }
  // SIN preguntar: el botón dice el monto y lo hace. El confirm que había acá frenaba todo — si no
  // se aceptaba (o no llegaba a aparecer) el botón parecía muerto.
  s.MONTO_REAL = monto;                               // en memoria, para que repinte ya
  if(s.metadata) s.metadata.monto_corregido = monto;
  // El monto corregido se escribe EN LA SOLICITUD, que es el único lugar donde tiene que cambiar:
  // de ahí sale MONTO_REAL y con eso quedan bien la tarjeta, el modal, el historial y lo que ve el
  // cliente. El error ya no se descarta en silencio: si no se guardó, hay que saberlo.
  try{
    await deps.window.actualizarSolicitudPortal(String(id), String(s.ESTADO||'PENDIENTE'), {
      monto_corregido: monto,
      monto_declarado_original: declarado,
      motivo_correccion: (declarado >= saldo*3 ? 'ceros' : 'todo'),
      motivo_ajuste: 'Tenías '+deps.money(saldo)+' en fichas y pediste '+deps.money(declarado)+': te pagamos todo lo que tenías.',
      operador: (deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel'
    });
    deps.toast('Retiro #'+id+' ajustado a '+deps.money(monto)+' (todo lo que tiene).','green');
  }catch(e){
    deps.toast('No se pudo guardar el monto: '+((e&&e.message)||e)+' · reintentá.','red');
    return;
  }
  if(typeof deps.abrirModalRetiroV2!=='function'){ deps.toast('Modal de retiro no disponible.','red'); return; }
  deps.abrirModalRetiroV2(id);
  const sug={ monto:monto };
  // Cuando el modal terminó de montar, fijamos el objetivo al monto sugerido.
  let _intentos = 0;
  (function _ajustar(){
    const st = deps.withdrawalState.current;
    if(st && String(st.id) === String(id)){
      try{ st.saldoReal = saldo; deps.window._rv2AjustarASaldo(sug.monto); }catch(_e){}
      return;
    }
    if(++_intentos < 30) deps.setTimeout(_ajustar, 100);
  })();
};
api._rv2AjustarASaldo = function(montoFijo){
  const st=deps.withdrawalState.current; if(!st) return;
  let nuevo = Math.abs(Number(montoFijo)||0);
  if(!nuevo){                                    // sin monto explícito → lo calculamos
    const s = deps.window._retiroMontoSugerido(st.objetivo, st.saldoReal||0);
    nuevo = s ? s.monto : 0;
  }
  if(!(nuevo>0)) return;
  st.objetivo = nuevo;
  // Esto cambia la DEUDA, no sólo lo que se paga ahora. El total quedaba en lo declarado
  // ($50.000): el cierre calculaba contra eso y dejaba un parcial fantasma por la diferencia que el
  // jugador no tiene. Se corrige el total y se escribe en la solicitud, igual que el atajo de la
  // tarjeta — que era el único que lo hacía.
  st.totalReal = (Number(st.yaPagado)||0) + nuevo;
  st._metaTotal = st.totalReal;
  st._motivoEditado = false;      // el motivo sugerido se recalcula con el total nuevo
  try{
    const S=(deps.window.V154P&&deps.V154P.solicitudes)||[];
    const s=S.find(function(x){ return String(x.ID||x.SOLICITUD_ID||0)===String(st.id); });
    if(s) s.MONTO_REAL = st.totalReal;
    const _p = deps.window.actualizarSolicitudPortal(String(st.id), String((s&&s.ESTADO)||'PENDIENTE'), {
      monto_corregido: st.totalReal, monto_declarado_original: (st.declaradoOriginal||st.declarado), motivo_correccion: 'todo',
      motivo_ajuste: _rv2MotivoSugerido(st),
      operador: (deps.window.operador&&(deps.window.operador.usuario||deps.window.operador.nombre))||'panel'
    });
    if(_p && typeof _p.catch === 'function') _p.catch(function(){});
  }catch(_e){}
  st.sel={}; st.montos={};
  try{
    const rep = deps.recomendarRepartoRetiro(nuevo);
    (rep.reparto||[]).forEach(function(x){ st.sel[String(x.id)]=true; st.montos[String(x.id)]=x.usar; });
  }catch(_e){}
  if(!Object.keys(st.sel).length){
    let falta = nuevo, usadas = 0;
    _rv2BilsUsables(nuevo).forEach(function(b){
      if(falta <= 0.5 || usadas >= 3) return;
      const usar = Math.min(Math.max(0, Number(b.SALDO||0)), falta);
      if(usar <= 0) return;
      st.sel[String(b.ID_BILLETERA)] = true; st.montos[String(b.ID_BILLETERA)] = usar;
      falta -= usar; usadas++;
    });
  }
  _rv2Render();
  try{ deps.toast('Retiro ajustado a '+deps.money(nuevo)+' (lo que el usuario tiene)','blue'); }catch(_e){}
  deps._rv2LeerSaldo();
};
// Línea derivada del total: ya pagado / falta pagar. No se edita, se calcula.
function _rv2DeudaTxt(){
  const st=deps.withdrawalState.current; if(!st) return '';
  const ya=Number(st.yaPagado||0), tot=Number(st.totalReal||0);
  const falta=Math.max(0, tot-ya);
  if(ya<=0.5) return 'Sin pagos todavía · falta pagar <b style="color:#e6edf3">'+deps.money(falta)+'</b>';
  return 'Ya pagado <b style="color:#22c55e">'+deps.money(ya)+'</b> · falta pagar <b style="color:#f5c518">'+deps.money(falta)+'</b>';
}
// Editar el TOTAL cambia la deuda: se recalcula lo que falta y, con eso, lo que se paga ahora.
api._rv2InputTotal = function(el){
  const st=deps.withdrawalState.current; if(!st) return;
  const raw=Math.abs(Number(String(el.value).replace(/[^\d]/g,''))||0);
  st.totalReal=raw;
  el.value=_rv2FmtMiles(raw);
  const falta=Math.max(0, raw-Number(st.yaPagado||0));
  st.objetivo=falta;                                   // lo que se paga ahora sigue a la deuda
  try{ const d=deps.document.getElementById('rv2Deuda'); if(d) d.innerHTML=_rv2DeudaTxt(); }catch(_e){}
  _rv2PintarMotivo();
  _rv2ActualizarTotal();
};
api._rv2SetObjetivo = function(val){ const st=deps.withdrawalState.current; if(!st) return; st.objetivo = Math.abs(Number(String(val).replace(/[^\d.-]/g,''))||0); _rv2ActualizarTotal(); };
// Formato de miles en vivo (5.000.000) para que no marean los ceros. Parsea solo dígitos.
// OJO con los centavos: si llega un NÚMERO (538395.01) no se puede limpiar con replace(/[^\d]/),
// porque se come el punto decimal y pega los centavos → 53.839.501. Los números se redondean;
// el strip de no-dígitos es solo para lo que TIPEA el operador (donde el punto es de miles).
function _rv2FmtMiles(n){
  const v = (typeof n === 'number')
    ? Math.abs(Math.round(n))
    : Math.abs(Number(String(n).replace(/[^\d]/g,''))||0);
  return v ? v.toLocaleString('es-AR') : '';
}
api._rv2InputObjetivo = function(el){ const st=deps.withdrawalState.current; if(!st) return; const raw=Math.abs(Number(String(el.value).replace(/[^\d]/g,''))||0); st.objetivo=raw; el.value=_rv2FmtMiles(raw); _rv2ActualizarTotal(); };
api._rv2InputMonto = function(el, bid){ const st=deps.withdrawalState.current; if(!st) return; const raw=Math.abs(Number(String(el.value).replace(/[^\d]/g,''))||0); st.montos[String(bid)]=raw; el.value=_rv2FmtMiles(String(raw)); _rv2ActualizarTotal(); };
// (Acá había una SEGUNDA definición de _rv2InputTotal que pisaba a la de arriba y llamaba a
// _rv2Render(): redibujaba el modal entero en cada tecla y el campo perdía el foco — había que
// hacer clic de nuevo para escribir cada dígito. Se sacó; queda la de arriba, que actualiza sólo
// lo que cambia.)
function _rv2ActualizarTotal(){
  const st=deps.withdrawalState.current; if(!st) return;
  const tot=_rv2TotalSel(); const el=deps.document.getElementById('rv2Total');
  if(!el) return;
  // Se mide contra LO QUE FALTA de la deuda (totalReal − yaPagado), no contra st.objetivo, que se
  // lee al abrir y puede venir del metadata podrido. Si no, esta línea decía "/ $200.000" mientras
  // el campo de arriba mostraba que faltaban $250.000.
  const falta = Math.max(0, Number(st.totalReal||0) - Number(st.yaPagado||0));
  const parcial = tot < falta-0.5;
  const paso    = tot > falta+0.5;
  const ok = tot>0 && !paso;
  let html = 'Seleccionado: <b style="color:'+(ok?'#22c55e':'#f87171')+'">'+deps.money(tot)+'</b> / '+deps.money(st.objetivo)
    + (parcial?' · <span style="color:#f5c518">parcial</span>':(paso?' · <span style="color:#f87171">¡te pasaste!</span>':' ✓'));
  // Aviso VISIBLE (no solo el confirm al aprobar): entraste por "Parcial" pero el monto cubre todo.
  if(st.modoParcial && !parcial && !paso && tot > 0){
    // En la SEGUNDA cuota pagar el resto es lo normal (es la única forma de cerrar un parcial):
    // ahí no es una advertencia. En la primera sí, porque suele ser la billetera que se autocompletó.
    html += (Number(st.yaPagado||0) > 0)
      ? '<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.40);font-size:12px;font-weight:800;color:#22c55e">'
          + '✓ Con este pago se completa el retiro y se cierra.</div>'
      : '<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(240,68,56,.10);border:1px solid rgba(240,68,56,.40);font-size:12px;font-weight:800;color:#f87171">'
          + '⚠ Con este monto el retiro queda COMPLETO, no parcial — bajá el monto de la billetera si querías abonar solo una parte.</div>';
  }
  // Pagar de más no se frena, pero se ve (Juan, 12/09: "mientras dé un aviso de 'te pasaste' y sea visible").
  if(paso){
    html += '<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(240,68,56,.10);border:1px solid rgba(240,68,56,.40);font-size:12px;font-weight:800;color:#f87171">'
          + '⚠ Te pasaste: vas a pagar '+deps.money(tot)+' y faltan '+deps.money(falta)+' — son '+deps.money(tot-falta)+' de más. Si el total está mal, corregilo arriba.</div>';
  }
  // Retiro PARCIAL → tilde de aceptación (sin él, no deja aprobar). El tilde no pregunta "¿es
  // parcial?" (obvio, ya lo estás armando así) — confirma que quedan $X SIN pagar y la solicitud
  // sigue abierta para el resto (no se cierra como terminada).
  if(parcial){
    html += st.modoParcial
      // Modo parcial explícito: NO se pide tilde (ya se eligió pagar de a partes). Solo se informa
      // cuánto queda pendiente, para que el operador lo vea antes de confirmar.
      ? ('<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(245,197,24,.25);font-size:12px;color:#f5c518;font-weight:700">'
         + '💸 Quedan '+deps.money(st.objetivo-tot)+' pendientes · la solicitud sigue abierta para pagarlos después</div>')
      : ('<label style="display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(245,197,24,.25);font-size:12px;color:#f5c518;font-weight:700;cursor:pointer">'
         + '<input type="checkbox" '+(st.parcialAceptado?'checked':'')+' onchange="_rv2SetParcialOk(this.checked)" style="width:16px;height:16px">'
         + 'Sí, transfiero solo esto ahora — quedan '+deps.money(st.objetivo-tot)+' PENDIENTES (la solicitud sigue abierta para pagarlos después)</label>');
  }
  el.innerHTML = html;
  _rv2ActualizarBotonAprobar();
  try{
    const nSel=Object.keys(st.sel||{}).filter(function(k){ return st.sel[k] && Number(st.montos[k])>0; }).length;
    const modo=deps.document.getElementById('rv2ModoCada');
    if(modo) modo.style.display = nSel>1 ? 'block' : 'none';
    // El veredicto y el resumen de arriba tienen que seguir a lo que se toca abajo.
    _rv2PintarVeredicto();
    const r=deps.document.getElementById('rv2Resumen');  if(r) r.innerHTML=_rv2ResumenPago();
  }catch(_e){}
}
// El botón dice exactamente lo que va a hacer. Antes decía siempre "Aprobar" y la diferencia
// entre pagar todo y pagar una parte quedaba escondida en un tilde.
function _rv2ActualizarBotonAprobar(){
  const st=deps.withdrawalState.current; if(!st) return;
  const btn=deps.document.getElementById('rv2BtnAprobar'); if(!btn) return;
  if(st._pagando){ btn.disabled=true; btn.style.opacity=.7; return; }   // buscando en Agentes
  const tot=_rv2TotalSel();
  // Lo único que TRABA es no haber elegido de dónde pagar. Antes se bloqueaba cuando el monto
  // superaba "lo que falta", y eso dejaba el botón muerto en "Te pasaste de $0" —sin salida—
  // cuando el progreso guardado venía mal o el operador todavía no había corregido la deuda.
  // Pagar de más SÍ importa, pero es un aviso: el que sabe cuánto se debe es el operador.
  if(tot<=0){ btn.textContent='Elegí de qué billetera pagar'; btn.disabled=true; btn.style.opacity=.55; return; }
  btn.disabled=false; btn.style.opacity=1;
  const falta = Math.max(0, Number(st.totalReal||0) - Number(st.yaPagado||0));
  const deMas = tot - falta;
  if(deMas > 0.5){
    btn.textContent = 'Pagar '+deps.money(tot)+' · ' + (falta<=0.5
      ? 'el retiro ya figura saldado — corregí el total arriba'
      : deps.money(deMas)+' MÁS de lo que falta');
    btn.style.background = '#b45309';
    return;
  }
  btn.style.background = '#ea580c';
  btn.textContent = (falta - tot > 0.5)
    ? ('Pagar '+deps.money(tot)+' ahora · quedan '+deps.money(falta-tot))
    : ('Pagar y cerrar el retiro · '+deps.money(tot));
}

// ── Veredicto: lo PRIMERO que se lee, antes de cualquier planilla ──────────────────────────
// El modal mostraba nueve bloques del mismo peso y el dato que decide todo — si el usuario tiene
// las fichas — era un subtítulo gris que además cargaba tarde. Acá se resuelve en una línea.
function _rv2Veredicto(){
  const st=deps.withdrawalState.current; if(!st) return null;
  const tot=_rv2TotalSel(), falta=Math.max(0, st.objetivo-tot);
  if(st.saldoReal==null && st.saldoFallo==='no_existe')
    return {n:'mal', c:'#f87171', ico:'🚫', tit:'ESTE USUARIO NO ESTÁ EN AGENTES', reintentar:true,
      det:'Buscamos a '+deps.escapeHtml(st.usuario)+' y no aparece. Revisá el nombre antes de pagar.'};
  if(st.saldoReal==null && st.saldoFallo)
    return {n:'espera', c:'#f59e0b', ico:'❓', tit:'NO PUDIMOS LEER SUS FICHAS', reintentar:true,
      det: st.saldoFallo==='ocupado' ? 'Hay otra operación en curso. Esperá un momento y reintentá.'
         : st.saldoFallo==='sesion'  ? 'Se cayó la sesión de Agentes. Tocá Reintentar: se abre el login y sigo desde acá.'
                                     : 'El casino no devolvió el saldo. Reintentá antes de pagar.'};
  if(st.saldoReal==null)
    return {n:'espera', c:'#8b949e', ico:'⏳', tit:'LEYENDO LAS FICHAS DEL USUARIO', det:'Un segundo…'};
  if(st.saldoReal<=0.5)
    return {n:'mal', c:'#f87171', ico:'🚫', tit:'NO TIENE FICHAS', det:'El saldo en Agentes es '+deps.money(0)+'. No hay nada para retirar.'};
  if(st.saldoReal < st.objetivo-0.5){
    const sug = deps.window._retiroMontoSugerido ? deps.window._retiroMontoSugerido(st.objetivo, st.saldoReal) : null;
    return {n:'mal', c:'#f87171', ico:'🚫', tit:'NO TIENE LAS FICHAS',
      det:'Pidió '+deps.money(st.objetivo)+' y tiene '+deps.money(st.saldoReal)+'.', sug:sug};
  }
  if(falta<=0.5)
    return {n:'ok', c:'#22c55e', ico:'✅',
      tit: st.yaPagado>0 ? 'SE PUEDE CERRAR EL RETIRO' : 'SE PUEDE PAGAR COMPLETO',
      det: st.yaPagado>0 ? ('Pagando '+deps.money(tot)+' queda saldado. Tiene '+deps.money(st.saldoReal)+' en fichas.')
                         : ('Tiene '+deps.money(st.saldoReal)+' en fichas.')};
  if(tot <= 0.5){
    const disp = _rv2BilsUsables(st.objetivo)
      .reduce(function(a,b){ return a + Math.max(0, Number(b.SALDO||0)); }, 0);
    return (disp >= falta - 0.5)
      ? {n:'medio', c:'#58a6ff', ico:'👇', tit:'ELEGÍ DE QUÉ BILLETERA PAGAR',
         det:'Hay '+deps.money(disp)+' en billeteras. Elegí abajo de cuál sale.'}
      : {n:'medio', c:'#f5c518', ico:'⚠️', tit:'LAS BILLETERAS NO ALCANZAN',
         det:'Entre todas hay '+deps.money(disp)+' y faltan '+deps.money(falta)+'. Se puede pagar una parte.'};
  }
  return {n:'medio', c:'#f5c518', ico:'⚠️', tit:'LO ELEGIDO NO CUBRE EL TOTAL',
    det:'Se paga '+deps.money(tot)+' ahora · quedan '+deps.money(falta)+' para después.'};
}
// Conviven dos modales de retiro segun de donde se abra el retiro: uno tiene #rv2Veredicto y el
// otro #rv2SaldoReal. Hay que pintar en el que exista — buscando solo el primero, en el modal que
// quedo tras el merge el saldo se leia (consulta real a Agentes, con reintentos) y no se mostraba
// en ningun lado: el if(v) lo hacia fallar en silencio, justo en la pantalla que mueve plata.
function _rv2PintarVeredicto(){
  try{
    const v = deps.document.getElementById('rv2Veredicto') || deps.document.getElementById('rv2SaldoReal');
    if(v) v.innerHTML = _rv2VeredictoHtml();
  }catch(_e){}
}
function _rv2VeredictoHtml(){
  const v=_rv2Veredicto(); if(!v) return '';
  const st=deps.withdrawalState.current;
  return '<div style="border-radius:12px;padding:12px 14px;border:1.5px solid '+v.c+'55;background:'+v.c+'12">'
    + '<div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#8b949e;margin-bottom:3px">Cotejo de fichas</div>'
    + '<div style="font-size:14px;font-weight:900;color:'+v.c+';letter-spacing:.02em">'+v.ico+' '+v.tit+'</div>'
    + '<div style="font-size:13px;color:#e6edf3;margin-top:3px">'+v.det+'</div>'
    + (v.reintentar ? '<button class="mini-btn" style="margin-top:8px;background:#21262d;border:1px solid #30363d;color:#e6edf3;font-weight:800;font-size:12px" onclick="_rv2ReleerFichas()">🔄 Reintentar</button>' : '')
    + (v.sug ? '<button class="mini-btn" style="margin-top:8px;background:#ea580c;color:#fff;font-weight:800;font-size:12px" onclick="_rv2AjustarASaldo('+v.sug.monto+')">'
        + (v.sug.motivo==='ceros' ? ('✔ Le sobró un cero — pagar '+deps.money(v.sug.monto)) : ('✔ Pagarle todo lo que tiene · '+deps.money(v.sug.monto)))
        + '</button>' : '')
    + (st.yaPagado>0 ? '<div style="margin-top:8px;padding-top:7px;border-top:1px solid '+v.c+'33;font-size:12px;color:#f5c518;font-weight:700">'
        + '🔄 Segunda cuota · ya le transferiste '+deps.money(st.yaPagado)+(st._metaTotal!=null?(' de '+deps.money(st._metaTotal)):'')
        + ' — abajo va lo que FALTA, no el total</div>' : '')
    + '</div>';
}
// Resumen de UNA línea de con qué se paga. El detalle (elegir/editar) va plegado.
function _rv2ResumenPago(){
  const st=deps.withdrawalState.current; if(!st) return '';
  const sel=_rv2BilsUsables().filter(function(b){ return st.sel[String(b.ID_BILLETERA)] && Number(st.montos[String(b.ID_BILLETERA)])>0; });
  if(!sel.length) return '<div class="small" style="color:#f87171;margin-top:2px">Ninguna billetera elegida — abrí "cambiar" acá abajo.</div>';
  return sel.map(function(b){
    return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0">'
      + '<span style="color:#c9d1d9">💳 '+deps.escapeHtml(b.NOMBRE_VISIBLE||'—')+'</span>'
      + '<b style="color:#e6edf3">'+deps.money(Number(st.montos[String(b.ID_BILLETERA)])||0)+'</b></div>';
  }).join('');
}
api._rv2ToggleDetalle=function(){
  const d=deps.document.getElementById('rv2Detalle'), t=deps.document.getElementById('rv2DetalleTog');
  if(!d) return;
  const abierto = d.style.display!=='none';
  d.style.display = abierto ? 'none' : 'block';
  if(t) t.textContent = abierto ? '▸ Cambiar billeteras, monto o pagar sólo una parte' : '▾ Ocultar el detalle';
};
// ── Motivo del ajuste del monto (D-88) ─────────────────────────────────────────────────────
// Cuando el total queda distinto de lo que pidió el jugador, el operador escribe (o acepta) el
// motivo. Se guarda en la solicitud, el portal lo muestra debajo del progreso y va UNA vez por chat.
function _rv2MotivoSugerido(st){
  const dec = Number(st.declaradoOriginal||0), tot = Number(st.totalReal||0);
  if(!(dec>0) || !(tot>0)) return '';
  if(dec > tot && Math.abs(dec - tot*10) <= 0.5)
    return 'Al monto le sobraba un cero: pediste '+deps.money(dec)+' y es '+deps.money(tot)+'.';
  const fichas = (st.saldoReal!=null) ? Number(st.saldoReal) + Number(st.yaPagado||0) : null;
  if(fichas!=null && tot < dec && Math.abs(fichas - tot) <= 0.5)
    return 'Tenías '+deps.money(fichas)+' en fichas y pediste '+deps.money(dec)+': te pagamos todo lo que tenías.';
  return 'Pediste '+deps.money(dec)+' y el retiro quedó en '+deps.money(tot)+'.';
}
function _rv2AjusteVisible(st){
  const dec = Number(st.declaradoOriginal||0), tot = Number(st.totalReal||0);
  return dec > 0 && tot > 0 && Math.abs(tot - dec) > 0.5;
}
function _rv2MotivoAjusteHtml(){
  const st = deps.withdrawalState.current; if(!st || !_rv2AjusteVisible(st)) return '';
  if(!st._motivoEditado) st.motivoAjuste = _rv2MotivoSugerido(st);
  return '<div style="margin-top:8px"><label style="font-weight:800">MOTIVO DEL AJUSTE '
    + '<span class="small" style="color:#8b949e;font-weight:600">(lo ve el jugador · había pedido '+deps.money(st.declaradoOriginal)+')</span></label>'
    + '<input id="rv2MotivoAjuste" type="text" maxlength="200" value="'+deps.escapeHtml(st.motivoAjuste||'')+'" oninput="_rv2SetMotivoAjuste(this.value)" '
    + 'placeholder="Por qué cambia el monto" style="width:100%;height:40px;background:#161b22;border:1.5px solid rgba(245,197,24,.45);color:#f0f6fc;border-radius:9px;font-size:13px;padding:0 11px;margin-top:4px"></div>';
}
// Sólo repinta la caja del motivo, y nunca mientras el operador está escribiendo en ella.
function _rv2PintarMotivo(){
  try{
    const mb = deps.document.getElementById('rv2MotivoBox'); if(!mb) return;
    const ae = deps.document.activeElement;
    if(ae && ae.id === 'rv2MotivoAjuste') return;
    mb.innerHTML = _rv2MotivoAjusteHtml();
  }catch(_e){}
}
api._rv2SetMotivoAjuste = function(v){
  const st = deps.withdrawalState.current; if(!st) return;
  st.motivoAjuste = String(v||'').slice(0,200);
  st._motivoEditado = true;
};

function _rv2Render(){
  const st = deps.withdrawalState.current; if(!st) return;
  const el = _rv2Modal();
  if(st.fase==='confirmar'){ deps._rv2RenderConfirmar(); return; }
  const bils = _rv2BilsUsables(st.objetivo);
  const _sug = _rv2BilsSugeridas(st.objetivo);   // solo marca visual, no filtra la lista
  // ── Selector de billeteras: DESPLEGABLE (como la operación manual) ──────────────────────────
  // Antes era una lista de 10+ checkboxes que había que recorrer con la vista. Ahora se elige del
  // desplegable (ordenado de MAYOR a MENOR saldo) y la billetera pasa abajo con su monto. Se
  // pueden agregar varias: para un retiro grande se reparte, para un parcial se usa una sola.
  const _elegidas = bils.filter(function(b){ return !!st.sel[String(b.ID_BILLETERA)]; });
  const _libres   = bils.filter(function(b){ return  !st.sel[String(b.ID_BILLETERA)]; });
  const _faltaAun = Math.max(0, st.objetivo - _rv2TotalSel());

  const selectBil = '<select onchange="_rv2AgregarBil(this.value); this.selectedIndex=0;" '
    + 'style="width:100%;height:40px;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:9px;font-size:13px;font-weight:600;padding:0 10px;margin-top:5px;cursor:pointer">'
    + '<option value="">'+(_libres.length ? '+ Elegí una billetera…' : '— no quedan billeteras —')+'</option>'
    + _libres.map(function(b){
        return '<option value="'+deps.escapeHtml(String(b.ID_BILLETERA))+'">'
          + deps.escapeHtml(b.NOMBRE_VISIBLE||'—') + ' — ' + deps.money(b.SALDO||0)
          + (_sug.has(String(b.ID_BILLETERA)) ? '  ★ sugerida' : '')
          + '</option>';
      }).join('')
    + '</select>';

  const filasBil = selectBil + (_elegidas.length
    ? _elegidas.map(function(b){
        const bid=String(b.ID_BILLETERA); const monto=Number(st.montos[bid]||0);
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:#12261a;border:1px solid rgba(34,197,94,.4);margin-top:6px">'
          + '<div style="flex:1;min-width:0;line-height:1.2"><span style="font-weight:700;color:#e6edf3;font-size:13px">'+deps.escapeHtml(b.NOMBRE_VISIBLE||'—')+'</span>'
          +   '<div style="color:#8b949e;font-size:11px">saldo '+deps.money(b.SALDO||0)+'</div></div>'
          // El monto se completa solo con min(saldo, lo que falta); se puede tocar para cambiarlo.
          + '<input type="text" inputmode="numeric" data-rv2monto="'+bid+'" value="'+_rv2FmtMiles(monto)+'" oninput="_rv2InputMonto(this,\''+bid+'\')" placeholder="0" title="Escribí cuánto pagás desde esta billetera" style="width:110px;text-align:right;background:transparent;border:none;border-bottom:1px dashed '+(monto>0?'rgba(34,197,94,.45)':'rgba(248,113,113,.55)')+';border-radius:0;color:'+(monto>0?'#22c55e':'#f87171')+';padding:4px;font-weight:800;font-size:15px">'
          + '<button type="button" onclick="_rv2Toggle(\''+bid+'\')" title="Sacar" style="background:transparent;border:none;color:#f87171;cursor:pointer;font-size:15px;padding:0 2px;flex-shrink:0">✕</button>'
          + '</div>';
      }).join('')
    : '<div class="small" style="color:#5a6474;margin-top:6px;text-align:center;padding:8px;border:1px dashed #262d3a;border-radius:8px">Todavía no elegiste con qué pagar</div>')
    + (_elegidas.length && _faltaAun > 0.5
        ? '<div class="small" style="color:#8b949e;margin-top:5px">Podés agregar otra billetera para cubrir los '+deps.money(_faltaAun)+' que faltan.</div>'
        : '');
  const cbuHtml = st.cbu ? ('<button type="button" onclick="portalCopiarCbu(this)" data-valor="'+deps.escapeHtml(st.cbu)+'" title="Tocá para copiar" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;cursor:pointer;background:#161b22;border:1px solid rgba(251,146,60,.45);border-radius:9px;padding:8px 11px;color:#e6edf3;margin-top:8px"><span style="min-width:0;flex:1"><span style="display:block;font-size:10px;font-weight:800;text-transform:uppercase;color:#8b949e">CBU / Alias destino · tocá para copiar</span><span style="display:block;font-family:ui-monospace,monospace;font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+deps.escapeHtml(st.cbu)+'</span></span><span class="pcopy-ico" style="font-size:15px">📋</span></button>') : '';
  el.innerHTML =
    '<div style="max-height:82vh;overflow:auto;background:#0d1117;border:1px solid #30363d;border-radius:16px;box-shadow:0 18px 55px rgba(0,0,0,.55);padding:16px;color:#e6edf3">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">'
    +   '<div><div style="font-size:17px;font-weight:900;color:#fb923c">⬆ Aprobar retiro</div>'
    +     '<div class="small" style="color:#8b949e">#'+deps.escapeHtml(String(st.id))+' · '+deps.escapeHtml(st.usuario)+'</div></div>'
    +   '<button class="mini-btn" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:7px 10px" onclick="cerrarRetiroV2()">Cerrar</button>'
    + '</div>'
    // Banner GRANDE si ya se pagó una parte antes: antes era un subtítulo chico y gris que
    // pasaba desapercibido ("no se entiende, no cambia el monto") — ahora no se puede no ver.
    + (st.yaPagado>0
      ? '<div style="border-radius:11px;padding:10px 12px;margin-bottom:10px;background:rgba(245,197,24,.1);border:1.5px solid rgba(245,197,24,.5);text-align:center">'
        +   '<div style="font-size:12px;font-weight:900;color:#f5c518;text-transform:uppercase;letter-spacing:.03em">🔄 Retiro parcial en curso</div>'
        +   '<div style="font-size:13px;color:#e6edf3;margin-top:3px">Ya le transferiste <b style="color:#22c55e">'+deps.money(st.yaPagado)+'</b>'+(st._metaTotal!=null?(' de '+deps.money(st._metaTotal)):'')+' · el monto de abajo es lo que <b>FALTA</b>, no el total original</div>'
        + '</div>'
      : '')
    // Avisos de bono sin liberar / CBU compartido, arriba de todo y antes de la plata.
    // SOLO INFORMAN: no deshabilitan nada, la decisión sigue siendo del operador.
    + ((deps.window._alertaRetiroHtml ? deps.window._alertaRetiroHtml(st.id, {monto: st.objetivo, expandido:true}) : '') || '')
    + '<div style="border-radius:11px;padding:11px;text-align:center;border:1px solid rgba(251,146,60,.35);background:rgba(251,146,60,.06)">'
    +   '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#8b949e">Transferir a</div>'
    +   '<div style="font-size:19px;font-weight:900;color:#f0f6fc;line-height:1.2">'+deps.escapeHtml(st.titular||st.usuario)+'</div>'
    +   '<div id="rv2SaldoReal" class="small" style="color:#8b949e;margin-top:3px">💰 leyendo saldo real…</div>'
    +   cbuHtml
    +   '<div style="margin-top:9px;padding-top:8px;border-top:1px solid #262d3a">'
    +     '<div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#8b949e;margin-bottom:2px">Sale de</div>'
    +     '<div id="rv2Resumen">'+_rv2ResumenPago()+'</div>'
    +   '</div>'
    + '</div>'
    // En modo PARCIAL este campo es lo que FALTA pagar y va bloqueado. Editable, se prestaba a un
    // error grave: el operador ponía acá "lo que pago ahora" (ej. 25.000 de un retiro de 50.000) y
    // el cierre tomaba ese número como TOTAL del retiro → lo daba por PAGADO con la mitad. Lo que
    // se paga ahora lo define la billetera, no este campo. En el retiro completo sigue editable,
    // porque ahí sí sirve para corregir un monto mal declarado.
    + (st.modoParcial
        // El TOTAL de la deuda es editable (si la solicitud entró con un monto mal cargado hay que
        // poder corregirlo). "Falta pagar" se deriva: total − ya pagado. Lo que se paga AHORA lo
        // define la billetera, no este campo.
        ? ('<div style="margin-top:12px"><label style="font-weight:800">TOTAL DEL RETIRO <span class="small" style="color:#8b949e;font-weight:600">(corregilo si vino mal)</span></label>'
           + '<input id="rv2TotalReal" type="text" inputmode="numeric" value="'+_rv2FmtMiles(st.totalReal)+'" oninput="_rv2InputTotal(this)" style="width:100%;height:44px;background:#161b22;border:1.5px solid #30363d;color:#f0f6fc;border-radius:9px;font-weight:900;font-size:20px;padding:0 12px;margin-top:4px">'
           + '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:12.5px">'
           +   '<span style="color:#8b949e">Ya pagado <b style="color:#a78bfa">'+deps.money(st.yaPagado||0)+'</b></span>'
           +   '<span style="color:#8b949e">FALTA PAGAR <b style="color:#f5c518">'+deps.money(st.objetivo)+'</b></span>'
           + '</div>'
           + '<div class="small" style="color:#8b949e;margin-top:3px">Elegí abajo con qué billetera pagás y escribí cuánto — el resto queda pendiente.</div></div>')
        : ('<div style="margin-top:12px"><label style="font-weight:800">MONTO REAL A RETIRAR</label>'
           + '<input id="rv2Objetivo" type="text" inputmode="numeric" value="'+_rv2FmtMiles(st.objetivo)+'" oninput="_rv2InputObjetivo(this)" style="width:100%;height:44px;background:#161b22;border:1.5px solid #fb923c;color:#f0f6fc;border-radius:9px;font-weight:900;font-size:20px;padding:0 12px;margin-top:4px"></div>'))
    + '<div style="margin-top:12px;font-weight:800;color:#c9d1d9">¿Con qué billetera pagás? <span class="small" style="color:#8b949e;font-weight:400">(elegí la que quieras · <span style="color:#f5c518">sugerida</span> = la que recomienda el panel)</span></div>'
    + filasBil
    + '<div id="rv2MotivoBox">'+_rv2MotivoAjusteHtml()+'</div>'
    + '<div id="rv2Total" style="margin-top:10px;padding:8px 10px;background:#161b22;border-radius:9px;font-size:13px"></div>'
    + '<div style="margin-top:10px"><label>💬 Mensaje al usuario <span class="small" style="color:#8b949e">(opcional · se le envía al pagar)</span></label>'
    +   '<textarea id="rv2Obs" rows="2" style="width:100%;background:#161b22;border:1px solid #30363d;color:#e6edf3;border-radius:9px;margin-top:3px" placeholder="Ej: te transferimos 400.000, el resto en cuanto se libere otra billetera"></textarea></div>'
    // ("Confirmar una por una" se sacó a pedido de Juan: no aportaba y era un segundo camino de
    //  código para lo mismo — un arreglo cubría uno y el otro seguía roto.)
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">'
    +   '<button class="mini-btn" style="background:transparent;border:1px solid #30363d;color:#c9d1d9" onclick="cerrarRetiroV2()">Cancelar</button>'
    +   '<button id="rv2BtnAprobar" class="mini-btn" style="background:#ea580c;color:#fff;font-weight:800" onclick="_rv2Aprobar()">Aprobar y transferir</button>'
    + '</div></div>';
  el.style.display='block';
  _rv2ActualizarTotal();
}

// Sólo LEE el saldo y refresca el veredicto. Antes armaba acá adentro su propio cartel con su
// propio botón de ajuste, en paralelo al de la tarjeta del pendiente: dos lugares distintos
// diciendo lo mismo con textos distintos. Ahora hay un solo veredicto y él decide qué mostrar.

    return { globals: api, _rv2TotalSel, _rv2BilsUsables, _rv2PintarVeredicto, _rv2ActualizarBotonAprobar, _rv2Modal, _rv2FmtMiles, _rv2Veredicto, _rv2Render };
  }
  return Object.freeze({ create, dependencies });
});
