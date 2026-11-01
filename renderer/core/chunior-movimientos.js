// MOVIMIENTOS CHUNIOR (portado de NexoBetaChan): propina / depósito sin reclamar / anular.
// Operator-triggered (NO autónomo). Usa la ventana de Chunior (window.chunior).
// ══════════════════════════════════════════════════════════════════════════
function _adminChuParseMonto(v){
  let s=String(v||'').replace(/[^\d,.-]/g,'');
  if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',', '.');
  else if(s.includes(',')) s=s.replace(',', '.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
  const n=Number(s); return Number.isFinite(n)?Math.abs(n):0;
}
// Busca el desplegable de billetera: por los identificadores conocidos o, si la pantalla usa otro,
// por el ÚNICO que tenga esa billetera entre sus opciones.
const _BIL_SEL_JS = '(function(uid){' +
  'var s=document.getElementById("id_cuenta_destino")||document.getElementById("id_cuenta_origen")' +
  '||document.getElementById("id_billetera")||document.getElementById("id_cuenta");' +
  'if(s) return s;' +
  'var ss=document.querySelectorAll("select");' +
  'for(var i=0;i<ss.length;i++){ if(ss[i].querySelector(\'option[value="\'+uid+\'"]\')) return ss[i]; }' +
  'return null;})';
// El chequeo de "¿está el formulario?" se arma DERECHO, sin reemplazos de texto: antes era un
// .replace() al final de una concatenación, que en JS se aplica sólo al último pedazo. El reemplazo
// no ocurría, la página recibía una función sin definir y no se podía anotar nada (D-100).
function _readyChuniorJs(uid){
  return '(function(){return !!(' + _BIL_SEL_JS + '(' + JSON.stringify(String(uid)) + ')'
    + '&&document.getElementById("id_monto")&&document.getElementById("id_notas"));})()';
}
async function _registrarAdminChunior(addUrl, chunior_uid, monto, notas, opts){
  const _admHealth = window.NodoSalud?.begin('ADMIN');
  // Bloqueo del cotejo (igual que en registrarCargaEnChunior): esperar la declaración abierta.
  for(let _w=0; window._cotejoDeclarando && _w<90; _w++){ await new Promise(function(r){setTimeout(r,1000);}); }
  if(!window.chunior) return { ok:false, movimientoId:null, error:'Ventana de Chunior no disponible' };
  if(!chunior_uid) return { ok:false, movimientoId:null, error:'La billetera no tiene chunior_uid configurado' };
  await window.chunior.navigate(addUrl);
  _admHealth?.record('CONNECTED', 'OK', 'CHUNIOR_NAV_OK');
  const t0 = Date.now(); let ready = false;
  while(Date.now() - t0 < 10000){
    // El desplegable de billetera no se llama igual en todas las pantallas (gastos locales tiene el
    // suyo): se busca por sus nombres conocidos y, si no, por el que tenga esta billetera adentro.
    ready = await window.chunior.exec(_readyChuniorJs(chunior_uid)).catch(function(){return false;});
    if(ready) break; await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready){
    // Sin esto, "no te deja agregar" es todo lo que se sabe. Ahora el error dice qué había en la
    // pantalla, que es lo único que permite arreglarlo sin estar sentado al lado (D-100).
    let _diag = '';
    try{
      const d = await window.chunior.exec('(function(){var ids=[];document.querySelectorAll("select,input,textarea").forEach(function(e){ if(e.id) ids.push(e.id); });return {url:location.href, campos:ids.slice(0,12), titulo:(document.title||"").slice(0,60)};})()');
      if(d) _diag = ' · pantalla: '+String(d.url||'').split('/').slice(3).join('/')+' · campos: '+((d.campos||[]).join(', ')||'ninguno');
    }catch(_e){}
    return { ok:false, movimientoId:null, error:'El formulario de Chunior no apareció en 10s'+_diag };
  }
  let injectRes;
  try{
    injectRes = await window.chunior.exec(
      '(function(){' +
      'var s=' + _BIL_SEL_JS + '(' + JSON.stringify(String(chunior_uid)) + ');' +
      'var m=document.getElementById("id_monto");' +
      'var n=document.getElementById("id_notas");' +
      'var b=document.querySelector("input[name=\'_addanother\']")||document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");' +
      'if(!s||!m||!n||!b) return {ok:false,err:"campos faltantes",hasS:!!s,hasM:!!m,hasN:!!n,hasB:!!b};' +
      's.value='+JSON.stringify(String(chunior_uid))+'; s.dispatchEvent(new Event("change",{bubbles:true}));' +
      'm.value='+JSON.stringify(String(monto))+'; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
      'n.value='+JSON.stringify(String(notas||""))+'; n.dispatchEvent(new Event("input",{bubbles:true})); n.dispatchEvent(new Event("change",{bubbles:true}));' +
      // El comprobante se adjunta ANTES de guardar: se arma el archivo desde la imagen pegada y se
      // deja en el campo, igual que si lo hubieran elegido a mano.
      'var comp=' + JSON.stringify((opts && opts.comprobante) || '') + ';' +
      'if(comp){ var fi=document.getElementById("id_comprobantes")||document.querySelector(\'input[type="file"]\');' +
      '  if(fi){ try{' +
      '    var pp=comp.split(","), mime=((pp[0]||"").match(/:(.*?);/)||[])[1]||"image/png";' +
      '    var bin=atob(pp[1]||""), arr=new Uint8Array(bin.length);' +
      '    for(var ci=0;ci<bin.length;ci++) arr[ci]=bin.charCodeAt(ci);' +
      '    var dt=new DataTransfer(); dt.items.add(new File([arr], ' + JSON.stringify((opts && opts.nombre) || 'comprobante.png') + ', {type:mime}));' +
      '    fi.files=dt.files; fi.dispatchEvent(new Event("change",{bubbles:true}));' +
      '  }catch(_cx){ return {ok:false, err:"no se pudo adjuntar el comprobante: "+(_cx.message||_cx)}; } } }' +
      'var snap={ok:true, valS:s.value, valM:m.value, valN:n.value, comp:!!comp}; try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return snap;' +
      '})()'
    );
  }catch(e){ return { ok:false, movimientoId:null, error:e.message||'Error inyectando datos' }; }
  if(!injectRes || !injectRes.ok) return { ok:false, movimientoId:null, error:'Inyección falló: '+JSON.stringify(injectRes) };
  await new Promise(function(r){ setTimeout(r,500); });
  let movimientoId=null, errorMsg=null, dbgTxt=null;
  const _tParse = Date.now();
  while(Date.now() - _tParse < 4500){
    let res=null;
    try{
      res = await window.chunior.exec(
        '(function(){' +
        'var ok=document.querySelector("li.success")||document.querySelector(".messagelist .success")||document.querySelector(".success");' +
        'if(!ok){var ml=document.querySelector("ul.messagelist li"); if(ml&&/[eé]xito/i.test(ml.textContent||"")) ok=ml;}' +
        'if(ok){ var txt=ok.textContent||""; var a=ok.querySelector("a[href]");' +
        '  if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) return {ok:true, id:mh[1]};}' +
        '  var mt=txt.match(/n[\\sº°o\\.]{0,4}(\\d{4,})/i) || txt.match(/(\\d{5,})/); if(mt) return {ok:true, id:mt[1]};' +
        '  return {ok:true, id:null, dbg:txt.trim().substring(0,180)}; }' +
        'var err=document.querySelector("ul.errorlist")||document.querySelector(".errornote");' +
        'if(err) return {ok:false, error:(err.textContent||"Error en formulario").trim().substring(0,200)};' +
        'return {pending:true};' +
        '})()'
      );
    }catch(e){ errorMsg=e.message||'Error leyendo respuesta'; break; }
    if(res && res.ok){ movimientoId=res.id; dbgTxt=res.dbg||null; break; }
    if(res && res.error){ errorMsg=res.error; break; }
    await new Promise(function(r){ setTimeout(r,250); });
  }
  const _okAdm = !!movimientoId || (!errorMsg && !!dbgTxt);
  // Anotación admin OK (propina / depo s/r) → refrescar los saldos reales desde Chunior.
  if(_okAdm){ try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){} }
  return { ok: _okAdm, movimientoId:movimientoId, error:errorMsg, dbg:dbgTxt };
}
// Gasto de oficina: suma el monto a la billetera y descuenta fichas. Acepta comprobante.
async function registrarGastoOficinaEnChunior(chunior_uid, monto, notas, comprobante){
  return _registrarAdminChunior(CHUNIOR_BASE + '/transacciones/gastoslocal/add/', chunior_uid, monto, notas,
    { comprobante: comprobante || '', nombre: 'comprobante-gasto.png' });
}
async function registrarPropinaEnChunior(chunior_uid, monto, notas){
  return _registrarAdminChunior(CHUNIOR_BASE + '/transacciones/propina/add/', chunior_uid, monto, notas);
}
async function registrarDepoSinReclamarEnChunior(chunior_uid, monto, notas){
  return _registrarAdminChunior(CHUNIOR_BASE + '/transacciones/depositossinreclamar/add/', chunior_uid, monto, notas);
}
// ── RECARGA ADMINISTRATIVA DE FICHAS ────────────────────────────────────────
// /transacciones/recargafichas/add/ · select de PUESTO (una sola opción real, el puesto actual)
// + #id_monto + submit input[name="_addanother"]. Suma fichas al agente (no toca billeteras).
async function registrarRecargaFichasChunior(monto){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const url = CHUNIOR_BASE + '/transacciones/recargafichas/add/';
  try{ await window.chunior.navigate(url); }catch(e){ return { ok:false, error:'No se pudo navegar a Chunior' }; }
  const t0=Date.now(); let ready=false;
  while(Date.now()-t0<10000){ ready=await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;}); if(ready)break; await new Promise(function(r){setTimeout(r,300);}); }
  if(!ready) return { ok:false, error:'El formulario de recarga no cargó' };
  const inj = await window.chunior.exec(
    '(function(){'
    + 'var m=document.getElementById("id_monto");'
    + 'var b=document.querySelector("input[name=\'_addanother\']")||document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\']");'
    + 'if(!m||!b) return {ok:false,err:"campos faltantes"};'
    // Puesto: hay UNA sola opción real (el puesto actual) → la elegimos sola.
    + 'var sel=null,ss=document.querySelectorAll("select");'
    + 'for(var i=0;i<ss.length;i++){ var o=Array.prototype.filter.call(ss[i].options,function(x){return x.value;}); if(o.length){ sel=ss[i]; break; } }'
    + 'var puesto="";'
    + 'if(sel){ var op=Array.prototype.filter.call(sel.options,function(x){return x.value;})[0];'
    + '  if(op){ sel.value=op.value; puesto=(op.textContent||"").trim(); sel.dispatchEvent(new Event("change",{bubbles:true})); } }'
    // Monto CON SIGNO: negativo descuenta fichas del puesto (no se usa Math.abs a propósito).
    + 'm.value=' + JSON.stringify(String(Number(monto)||0)) + ';'
    + 'm.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));'
    + 'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return {ok:true, puesto:puesto};'
    + '})()'
  ).catch(function(e){ return {ok:false, err:(e&&e.message)||'exec falló'}; });
  if(!inj || !inj.ok) return { ok:false, error:'No se pudo completar el formulario ('+((inj&&inj.err)||'')+')' };
  await new Promise(function(r){ setTimeout(r,2500); });
  const conf = await window.chunior.exec(
    '(function(){var li=document.querySelector("li.success"); if(li) return {ok:true, mensaje:(li.textContent||"").trim().substring(0,160)};'
    + 'var err=document.querySelector(".errorlist,.errornote"); if(err) return {ok:false, error:(err.textContent||"").trim().substring(0,200)};'
    + 'return {ok:true, mensaje:"enviado"};})()'
  ).catch(function(){ return { ok:true, mensaje:'sin confirmación visible' }; });
  try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){}
  return Object.assign({ puesto: inj.puesto||'' }, conf||{ok:true});
}
window.abrirModalRecargaFichas = function(){
  abrirModal('🎰 Recarga administrativa de fichas',
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Ajusta las fichas del <b>puesto actual</b> en Chunior (el puesto se selecciona solo: es el único de la lista). No toca billeteras ni saldos de jugadores.<br><b style="color:#fdba74">Monto negativo (con "−") DESCUENTA fichas.</b></div>'
    + '<label>Monto <span class="small" style="color:#8b949e;font-weight:400">· ej: 500000 suma · -500000 descuenta</span></label>'
    + '<input id="recFichasMonto" type="text" inputmode="text" autocomplete="off" placeholder="Ej: 500000 o -500000" oninput="this.value=window._fmtMilesConSigno(this.value)" style="width:100%;text-align:right;font-weight:800;font-size:17px">',
    async function(){
      const monto=window._parseMontoConSigno((document.getElementById('recFichasMonto')||{}).value||'');
      if(!monto){ toast('Ingresá el monto.','red'); return; }
      cerrarModal();
      const _esNeg = monto<0;
      if(!confirm((_esNeg?'¿DESCONTAR ':'¿Recargar ')+money(Math.abs(monto))+' de fichas '+(_esNeg?'del':'al')+' puesto actual en Chunior?')) return;
      toast((_esNeg?'🎰 Descontando ':'🎰 Recargando ')+money(Math.abs(monto))+' fichas...','blue');
      _wdLock();
      let r; try{ r=await registrarRecargaFichasChunior(monto); }catch(e){ r={ok:false,error:e.message||'error'}; }
      finally{ _wdUnlock(); }
      if(r && r.ok){
        toast('🎰 '+(_esNeg?'Descuento':'Recarga')+' de '+money(Math.abs(monto))+' enviado'+(r.puesto?(' · '+r.puesto):''),'green');
        try{ await registrarEnHistorial({ usuario:'RECARGA FICHAS', tipo:'RECARGA_FICHAS', monto:monto,
          billetera_id:null, billetera_nombre:null, origen:'ADMIN', estado:'OK',
          notas:(_esNeg?'DESCUENTO administrativo de fichas':'Recarga administrativa de fichas')+(r.puesto?(' · '+r.puesto):'')+(r.mensaje?(' · '+r.mensaje):'') }); }catch(_e){}
        try{ await cargarHistorial(); }catch(_e){}
        _watchdogTrigger(1500);
      } else toast('⚠️ No se pudo recargar: '+((r&&r.error)||'sin detalle'),'red');
    }, 'Recargar fichas');
};
// ── GASTO DE OFICINA ────────────────────────────────────────────────────────────────────────
// La imagen se pega con Ctrl+V (igual que en el chat) y se adjunta sola en Chunior. El que escucha
// el pegado se protege solo: si el modal no está abierto, no hace nada (así no hay que sacarlo).
window._gastoComprobante = null;
function _gastoLeerImagen(file){
  if(!file) return;
  if(file.size > 3.5*1024*1024){ toast('La imagen pesa más de 3,5 MB: achicala o elegí otra.','red'); return; }
  const fr = new FileReader();
  fr.onload = function(){
    window._gastoComprobante = String(fr.result||'');
    const img = document.getElementById('gastoCompPrev');
    const zona = document.getElementById('gastoCompZona');
    if(img){ img.src = window._gastoComprobante; img.style.display='block'; }
    if(zona){ zona.textContent = '✓ Comprobante listo ('+Math.round(file.size/1024)+' KB) · pegá otra vez para reemplazarlo'; zona.style.color='#22c55e'; }
  };
  fr.readAsDataURL(file);
}
document.addEventListener('paste', async function(e){
  if(!document.getElementById('gastoCompZona')) return;   // el modal no está abierto
  const items = [...((e.clipboardData && e.clipboardData.items) || [])];
  const img = items.find(function(it){ return it.type && it.type.indexOf('image/')===0; });
  if(img){ const f = img.getAsFile(); if(f){ e.preventDefault(); _gastoLeerImagen(f); return; } }
  try{
    const clips = await navigator.clipboard.read();
    for(const clip of clips){
      const t = clip.types.find(function(x){ return x.indexOf('image/')===0; });
      if(t){ e.preventDefault(); const blob = await clip.getType(t); _gastoLeerImagen(new File([blob],'comprobante.png',{type:t})); return; }
    }
  }catch(_e){}
});
window.abrirModalGastoOficina = function(){
  const titulo = '💸 Gasto de oficina';
  const bilsConUid = (billeteras||[]).filter(function(b){ return b.CHUNIOR_UID; });
  if(!bilsConUid.length){ abrirModal(titulo, '<div class="err-box">No hay billeteras con UID de Chunior. Sincronizá billeteras primero.</div>', function(){ cerrarModal(); }, 'Entendido'); return; }
  window._gastoComprobante = null;
  const opts = bilsConUid.map(function(b){ return '<option value="'+escapeHtml(String(b.ID_BILLETERA))+'">'+escapeHtml(b.NOMBRE_VISIBLE||'—')+' · '+money(b.SALDO||0)+'</option>'; }).join('');
  const body =
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Se <b>suma</b> el monto a la billetera y se <b>descuentan</b> fichas. Queda anotado en Chunior con su comprobante.</div>'
    + '<label>Billetera</label><select id="gastoBil" style="width:100%">'+opts+'</select>'
    + '<label style="margin-top:8px;display:block">Monto</label><input id="gastoMonto" type="text" inputmode="decimal" placeholder="Ej: 15000" style="width:100%">'
    + '<label style="margin-top:8px;display:block">Notas <span class="small" style="color:#8b949e;font-weight:400">· obligatorias, es el único registro de en qué se gastó</span></label>'
    + '<input id="gastoNotas" type="text" placeholder="Ej: garrafa / limpieza / librería" style="width:100%">'
    + '<label style="margin-top:8px;display:block">Comprobante <span class="small" style="color:#8b949e;font-weight:400">· pegalo con Ctrl+V o elegí el archivo</span></label>'
    + '<div id="gastoCompZona" style="border:1px dashed #2d3342;border-radius:8px;padding:10px;text-align:center;font-size:12px;color:#8b949e">Pegá la imagen acá con Ctrl+V</div>'
    + '<input id="gastoCompFile" type="file" accept="image/*" style="margin-top:6px;width:100%" onchange="_gastoLeerImagenInput(this)">'
    + '<img id="gastoCompPrev" style="display:none;max-width:100%;border-radius:8px;margin-top:6px">';
  abrirModal(titulo, body, async function(){
    const bilId = (document.getElementById('gastoBil')||{}).value || '';
    const bil = billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); });
    const monto = _adminChuParseMonto((document.getElementById('gastoMonto')||{}).value || '');
    const notas = String((document.getElementById('gastoNotas')||{}).value || '').trim();
    const comp = window._gastoComprobante;
    if(!bil || !bil.CHUNIOR_UID){ toast('Elegí una billetera con Chunior.','red'); return; }
    if(!(monto>0)){ toast('Monto inválido.','red'); return; }
    if(notas.length < 3){ toast('Escribí en qué se gastó: es lo único que queda registrado.','red'); return; }
    cerrarModal();
    toast('💸 Anotando gasto de '+money(monto)+(comp?' con comprobante':'')+'...','blue');
    _wdLock();
    let r;
    try{ r = await registrarGastoOficinaEnChunior(bil.CHUNIOR_UID, monto, notas, comp); }
    catch(e){ r = { ok:false, error:e.message||'error' }; }
    finally{ _wdUnlock(); }
    if(r && r.ok){
      toast('💸 Gasto anotado en '+bil.NOMBRE_VISIBLE+(r.movimientoId?(' · N° '+r.movimientoId):''),'green');
      try{
        await registrarEnHistorial({
          usuario: notas || 'GASTO OFICINA', tipo:'GASTO', monto: monto,
          billetera_id: bil.ID_BILLETERA, billetera_nombre: bil.NOMBRE_VISIBLE,
          origen:'ADMIN', estado:'OK',
          notas: 'Gasto de oficina · '+notas+(comp?' · con comprobante':'')+(r.movimientoId?(' · Chunior N° '+r.movimientoId):' [CHUNIOR_OK_SIN_N]'),
          chunior_movimiento_id: r.movimientoId || null
        });
      }catch(_e){}
      window._gastoComprobante = null;
      try{ await cargarHistorial(); }catch(_e){}
      try{ await sincronizarBilleterasChunior(true); }catch(_e){}
      try{ renderBillerasInicio(); }catch(_e){}
      _watchdogTrigger(1500);
    } else {
      toast('⚠️ No se pudo anotar el gasto: '+((r&&r.error)||'sin detalle'),'red');
    }
  }, 'Anotar gasto');
};
window._gastoLeerImagenInput = function(inp){ if(inp && inp.files && inp.files[0]) _gastoLeerImagen(inp.files[0]); };
window.abrirModalAdminChunior = function(tipo){
  const esPropina = tipo==='propina';
  const titulo = esPropina ? '🎁 Anotar propina' : '💜 Depósito sin reclamar';
  const bilsConUid = (billeteras||[]).filter(function(b){ return b.CHUNIOR_UID; });
  if(!bilsConUid.length){ abrirModal(titulo, '<div class="err-box">No hay billeteras con UID de Chunior. Sincronizá billeteras primero.</div>', function(){ cerrarModal(); }, 'Entendido'); return; }
  const opts = bilsConUid.map(function(b){ return '<option value="'+escapeHtml(String(b.ID_BILLETERA))+'">'+escapeHtml(b.NOMBRE_VISIBLE||'—')+' · '+money(b.SALDO||0)+'</option>'; }).join('');
  const ayuda = esPropina
    ? 'Suma el monto a la billetera como propina (no descuenta fichas).'
    : 'Anota una transferencia que llegó sin usuario. Suma el monto a la billetera; después se puede reclamar convirtiéndola en fichas desde el propio movimiento en Chunior. Es una "carga en pausa".';
  const body =
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">'+ayuda+'</div>'
    + '<label>Billetera</label><select id="adminChuBil" style="width:100%">'+opts+'</select>'
    + '<label style="margin-top:8px;display:block">Monto'+(esPropina?'':' <span class="small" style="color:#8b949e;font-weight:400">· varios con + (ej: 10000+5000 → un depo POR transferencia, reclamables por separado)</span>')+'</label><input id="adminChuMonto" type="text" inputmode="decimal" placeholder="'+(esPropina?'Ej: 1500':'Ej: 10000+5000')+'" style="width:100%">'
    + '<label style="margin-top:8px;display:block">Notas</label><input id="adminChuNotas" type="text" placeholder="'+(esPropina?'Ej: propina turno tarde':'Ej: titular / referencia de la transferencia')+'" style="width:100%">';
  abrirModal(titulo, body, async function(){
    const bilId = document.getElementById('adminChuBil') ? document.getElementById('adminChuBil').value : '';
    const bil = billeteras.find(function(b){ return String(b.ID_BILLETERA)===String(bilId); });
    const rawMonto = document.getElementById('adminChuMonto') ? document.getElementById('adminChuMonto').value : '';
    const notas = (document.getElementById('adminChuNotas') ? document.getElementById('adminChuNotas').value : '').trim();
    // MULTI-RENGLÓN (solo depos): "10000+5000" crea UN depo POR transferencia → cada uno se
    // reclama por separado (mata el rejunte en origen). Propina sigue siendo monto único.
    const montos = (esPropina ? [rawMonto] : String(rawMonto).split('+')).map(function(x){ return _adminChuParseMonto(x); }).filter(function(m){ return m>0; });
    if(!bil || !bil.CHUNIOR_UID){ toast('Elegí una billetera con Chunior.', 'red'); return; }
    if(!montos.length){ toast('Monto inválido.', 'red'); return; }
    cerrarModal();
    toast((esPropina?'🎁 Anotando propina':'💜 Anotando '+montos.length+' depósito(s)')+'...', 'blue');
    _wdLock();
    let okN=0, ultimoErr='';
    try{
      for(let mi=0; mi<montos.length; mi++){
        const monto = montos[mi];
        const notaI = notas + (montos.length>1?(' ('+(mi+1)+'/'+montos.length+')'):'');
        let r;
        try{
          r = esPropina ? await registrarPropinaEnChunior(bil.CHUNIOR_UID, monto, notaI)
                        : await registrarDepoSinReclamarEnChunior(bil.CHUNIOR_UID, monto, notaI);
        }catch(e){ r = { ok:false, error:e.message||'error' }; }
        if(r && r.ok){
          okN++;
          try{
            await registrarEnHistorial({
              usuario: notaI || (esPropina?'PROPINA':'DEPO S/RECLAMAR'),
              tipo: esPropina ? 'PROPINA' : 'DEPOSITO_SR',
              monto: monto, billetera_id: bil.ID_BILLETERA, billetera_nombre: bil.NOMBRE_VISIBLE,
              origen: 'ADMIN', estado:'OK',
              notas: (esPropina?'Propina':'Depósito sin reclamar')+(notaI?(' · '+notaI):'')+(r.movimientoId?(' · Chunior N° '+r.movimientoId):' [CHUNIOR_OK_SIN_N]'),
              chunior_movimiento_id: r.movimientoId || null
            });
          }catch(_e){}
        } else { ultimoErr=(r&&r.error)||'sin detalle'; break; }
      }
    } finally{ _wdUnlock(); }
    if(okN===montos.length){
      toast((esPropina?'🎁 Propina anotada':'💜 '+okN+' depósito(s) anotado(s)')+' en '+bil.NOMBRE_VISIBLE, 'green');
    } else {
      toast('⚠️ Se anotaron '+okN+'/'+montos.length+' · error: '+ultimoErr, 'red');
    }
    try{ await cargarHistorial(); }catch(_e){}
    try{ await sincronizarBilleterasChunior(true); }catch(_e){}
    try{ renderBillerasInicio(); }catch(_e){}
    _watchdogTrigger(1500);
  }, esPropina?'Anotar propina':'Anotar depósito');
};
// ── Editar un movimiento ya anotado ─────────────────────────────────────────
// Hasta acá un movimiento sólo se podía ANULAR (dejándole monto 0,10). Corregir un monto mal
// tipeado o una nota obligaba a hacerlo a mano en Chunior, y no quedaba rastro de que ese
// número había sido tocado. Dos reglas, las dos del lado del servidor (panel_mov_editar):
//   · sólo lo edita el MISMO operador que lo hizo;
//   · todo cambio queda con valor anterior, valor nuevo, quién y cuándo.
// El cambio se aplica PRIMERO en Chunior y recién después se guarda acá: si Chunior lo
// rechaza, NODO no queda diciendo un monto que allá nunca cambió.
window._CHUNIOR_URL_POR_TIPO = {
  CARGA:            'movimientoficha',
  RETIRO:           'movimientoficha',
  MOV_BILLETERA:    'movimientointerno',
  CAMBIO_BILLETERA: 'movimientointerno',
  PROPINA:          'propina',
  DEPOSITO_SR:      'depositossinreclamar',
  RECARGA_FICHAS:   'recargafichas'
};

async function _editarMovimientoChunior(tipoUrl, movId, cambios){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  if(!movId) return { ok:false, error:'Falta el N° de movimiento' };
  const changeUrl = CHUNIOR_BASE + '/transacciones/' + tipoUrl + '/' + encodeURIComponent(movId) + '/change/';
  try{ await window.chunior.navigate(changeUrl); }
  catch(e){ return { ok:false, error:'No se pudo abrir el movimiento en Chunior: '+(e.message||'') }; }

  const t0 = Date.now(); let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;});
    if(ready) break;
    await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready) return { ok:false, error:'El movimiento N° '+movId+' no abrió en Chunior (¿existe?)' };

  const setMonto = (cambios && cambios.monto != null)
    ? 'var m=document.getElementById("id_monto"); if(!m) return {ok:false,err:"sin campo monto"};'
      + 'm.value=' + JSON.stringify(String(cambios.monto)) + '; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));'
    : '';
  const setNotas = (cambios && cambios.notas != null)
    ? 'var n=document.getElementById("id_notas"); if(n){ n.value=' + JSON.stringify(String(cambios.notas)) + '; n.dispatchEvent(new Event("input",{bubbles:true})); n.dispatchEvent(new Event("change",{bubbles:true})); }'
    : '';

  let inj;
  try{
    inj = await window.chunior.exec(
      '(function(){' + setMonto + setNotas +
      'var b=document.querySelector("input[name=\'_save\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");' +
      'if(!b) return {ok:false,err:"sin botón guardar"};' +
      'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return {ok:true};' +
      '})()'
    );
  }catch(e){ return { ok:false, error:e.message||'Error escribiendo en Chunior' }; }
  if(!inj || !inj.ok) return { ok:false, error:'No se pudo escribir: '+JSON.stringify(inj) };

  await new Promise(function(r){ setTimeout(r,2500); });
  const conf = await window.chunior.exec(
    '(function(){var li=document.querySelector("li.success"); if(li&&/modific/i.test(li.textContent||"")) return {ok:true, mensaje:(li.textContent||"").trim()};' +
    'var err=document.querySelector(".errorlist,.errornote"); if(err) return {ok:false, error:(err.textContent||"").trim().substring(0,200)};' +
    'if((location.href||"").indexOf("/change/")<0) return {ok:true, mensaje:"guardado"}; return {ok:false, error:"Chunior no confirmó el cambio"};})()'
  ).catch(function(){ return { ok:false, error:'No se pudo leer la confirmación de Chunior' }; });
  return conf || { ok:false, error:'Sin respuesta de Chunior' };
}

// Historial de cambios de ese mismo movimiento, para saber si ya fue tocado antes.
window.expedienteVerEdiciones = async function(historialId){
  const caja = document.getElementById('expEdiciones');
  if(caja) caja.innerHTML = '<div class="small" style="color:var(--muted)">Buscando cambios anteriores…</div>';
  let filas = [];
  try{
    const { data, error } = await supabaseClient.rpc('panel_mov_ediciones', { p_historial_id: Number(historialId) });
    if(error) throw error;
    filas = data || [];
  }catch(e){
    if(caja) caja.innerHTML = '<div class="small" style="color:#f87171">No se pudo leer el historial de cambios: '+escapeHtml(e.message||String(e))+'</div>';
    return;
  }
  if(!caja) return;
  if(!filas.length){
    caja.innerHTML = '<div class="small" style="color:var(--muted)">Este movimiento nunca se editó.</div>';
    return;
  }
  caja.innerHTML = filas.map(function(f){
    const cuando = f.created_at ? new Date(f.created_at).toLocaleString('es-AR') : '';
    const val = function(v){ return v == null || v === '' ? '—' : escapeHtml(String(v)); };
    return '<div style="border-left:2px solid #f59e0b;padding:4px 0 4px 8px;margin-bottom:6px;font-size:11px">'
      + '<b style="color:#fbbf24">' + escapeHtml(f.campo) + '</b> · ' + escapeHtml(f.operador||'') + ' · ' + escapeHtml(cuando)
      + (f.aplicado_en_chunior ? '' : ' <span style="color:#f87171">· NO se aplicó en Chunior</span>')
      + '<div style="color:#94a3b8">' + val(f.valor_anterior) + ' → <b style="color:#f1f5f9">' + val(f.valor_nuevo) + '</b></div>'
      + (f.error ? '<div style="color:#f87171">' + escapeHtml(f.error) + '</div>' : '')
      + '</div>';
  }).join('');
};

window.expedienteEditarMovimiento = async function(historialId){
  historialId = String(historialId||'').trim();
  if(!/^\d+$/.test(historialId)){ toast('Esta fila no tiene operación registrada.','yellow'); return; }

  const fila = ((typeof _historialData !== 'undefined' && _historialData) || [])
    .find(function(x){ return String(x.id) === historialId; });
  if(!fila){ toast('No tengo la operación cargada. Ampliá el período y probá de nuevo.','yellow'); return; }

  const opFila = String(fila.operador||'').trim();
  // Quién opera AHORA: el usuario logueado en Chunior en este momento, leído en vivo — igual que
  // hacen las billeteras. Antes esto era String(operador), y operador es un OBJETO: daba
  // "[object Object]", no coincidía con nadie, y bloqueaba la edición a todos, incluido el que
  // hizo el movimiento. Y como el mismo valor viajaba al servidor, allá también rebotaba.
  let opActual = '';
  try{
    if(typeof refrescarOperadorDesdeChunior === 'function')
      opActual = String((await refrescarOperadorDesdeChunior(true)) || '').trim();
  }catch(_e){}
  if(!opActual){
    try{ opActual = String((typeof operador !== 'undefined' && operador && (operador.usuario || operador.nombre)) || '').trim(); }catch(_e){}
  }
  // Aviso temprano y claro. La regla la aplica igual el servidor (panel_mov_editar).
  if(opFila && opActual && opFila.toLowerCase() !== opActual.toLowerCase()){
    toast('Este movimiento lo hizo '+opFila+'. Sólo esa cuenta puede editarlo.','orange');
    return;
  }

  const seg = window._CHUNIOR_URL_POR_TIPO[String(fila.tipo||'').toUpperCase()];
  const movId = fila.chunior_movimiento_id || '';

  abrirModal('✏️ Editar movimiento' + (movId ? ' N° '+movId : ''),
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">'
    + escapeHtml(String(fila.tipo||'')) + ' de <b>' + escapeHtml(String(fila.usuario||'')) + '</b>'
    + (movId ? '' : '<br><span style="color:#f59e0b">Sin N° de Chunior: se corrige sólo acá, allá no hay qué tocar.</span>')
    + (movId && !seg ? '<br><span style="color:#f59e0b">Este tipo no se edita en Chunior desde el panel: se corrige sólo acá.</span>' : '')
    + '</div>'
    + '<label>Monto</label>'
    + '<input id="edMovMonto" type="text" inputmode="decimal" autocomplete="off" value="' + escapeHtml(String(fila.monto != null ? fila.monto : '')) + '">'
    + '<label style="margin-top:8px">Nota</label>'
    + '<textarea id="edMovNotas" rows="3" style="width:100%;border-radius:10px;padding:10px;background:#0e1525;color:#fff;border:1px solid #2d3342;resize:vertical">'
    + escapeHtml(String(fila.notas||'')) + '</textarea>'
    + '<div style="margin-top:12px;border-top:1px solid #1e293b;padding-top:8px">'
    + '<div class="small" style="font-weight:700;color:#cbd5e1;margin-bottom:6px">Cambios anteriores</div>'
    + '<div id="expEdiciones"></div></div>',
    async function(){
      const montoTxt = String((document.getElementById('edMovMonto')||{}).value || '').trim().replace(/\./g,'').replace(',','.');
      const notas = String((document.getElementById('edMovNotas')||{}).value || '').trim();
      const montoNum = montoTxt === '' ? null : Number(montoTxt);
      if(montoNum !== null && !Number.isFinite(montoNum)){ toast('El monto no es un número.','red'); return; }

      const cambiaMonto = montoNum !== null && Number(montoNum) !== Number(fila.monto||0);
      const cambiaNotas = notas !== String(fila.notas||'');
      if(!cambiaMonto && !cambiaNotas){ toast('No cambiaste nada.','yellow'); return; }

      cerrarModal();

      // 1) Chunior primero. Si allá falla, no tocamos nada acá.
      let aplicado = false, errChu = null;
      if(movId && seg){
        toast('Aplicando el cambio en Chunior…','blue');
        _wdLock();
        let r;
        try{ r = await _editarMovimientoChunior(seg, movId, { monto: cambiaMonto ? montoNum : null, notas: cambiaNotas ? notas : null }); }
        catch(e){ r = { ok:false, error:e.message||'error' }; }
        finally{ _wdUnlock(); }
        aplicado = !!(r && r.ok);
        errChu = aplicado ? null : ((r && r.error) || 'sin detalle');
        if(!aplicado){
          toast('Chunior no aceptó el cambio: '+errChu+'. No se modificó nada.','red');
          return;
        }
      }

      // 2) Recién ahora se guarda de este lado, con el log.
      let res;
      try{
        const { data, error } = await supabaseClient.rpc('panel_mov_editar', {
          p_historial_id: Number(historialId),
          p_operador: opActual || opFila,
          p_monto: cambiaMonto ? montoNum : null,
          p_notas: cambiaNotas ? notas : null,
          p_pc: (typeof pcOperativa !== 'undefined' ? pcOperativa : null),
          p_aplicado_chunior: aplicado,
          p_error: errChu
        });
        if(error) throw error;
        res = data;
      }catch(e){
        toast('El cambio se aplicó en Chunior pero no se pudo guardar acá: '+(e.message||e),'red');
        return;
      }

      if(!res || res.ok !== true){
        const motivo = res && res.motivo;
        if(motivo === 'otro_operador'){
          toast('Lo hizo '+(res.operador_original||'otro operador')+'. Sólo esa cuenta puede editarlo.','orange');
        } else {
          toast('No se pudo guardar el cambio ('+(motivo||'sin detalle')+').','red');
        }
        return;
      }

      toast('✓ Movimiento actualizado'+(aplicado ? ' acá y en Chunior' : ' (sólo acá)')+'.','green');
      try{ await cargarHistorial(); }catch(_e){}
      try{ renderHistorialUnificado(); }catch(_e){}
    }, 'Guardar cambio');

  // Cargar el historial de cambios cuando el modal ya existe en pantalla.
  setTimeout(function(){ window.expedienteVerEdiciones(historialId); }, 60);
};

async function _anularMovimientoChunior(tipoUrl, movId){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  if(!movId) return { ok:false, error:'Falta el N° de movimiento de Chunior' };
  const changeUrl = CHUNIOR_BASE + '/transacciones/' + tipoUrl + '/' + encodeURIComponent(movId) + '/change/';
  try{ await window.chunior.navigate(changeUrl); }catch(e){ return { ok:false, error:'No se pudo navegar a Chunior: '+(e.message||'') }; }
  const t0 = Date.now(); let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec('(function(){return !!document.getElementById("id_monto");})()').catch(function(){return false;});
    if(ready) break; await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready) return { ok:false, error:'Formulario de Chunior no apareció (¿el movimiento existe?)' };
  let inj;
  try{
    inj = await window.chunior.exec(
      '(function(){' +
        'var m=document.getElementById("id_monto");' +
        'var b=document.querySelector("input[name=\'_save\']")||document.querySelector("input[name=\'_addanother\']")||document.querySelector("input[type=\'submit\'],button[type=\'submit\']");' +
        'if(!m||!b) return {ok:false,err:"campos faltantes",hasM:!!m,hasB:!!b};' +
        'm.value="0.1"; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
        'var snap={ok:true,val:m.value}; try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return snap;' +
      '})()'
    );
  }catch(e){ return { ok:false, error:e.message||'Error inyectando' }; }
  if(!inj || !inj.ok) return { ok:false, error:'Inyección falló: '+JSON.stringify(inj) };
  await new Promise(function(r){ setTimeout(r,2500); });
  const conf = await window.chunior.exec(
    '(function(){var li=document.querySelector("li.success"); if(li&&/modific/i.test(li.textContent||"")) return {ok:true, mensaje:(li.textContent||"").trim()};' +
    'var err=document.querySelector(".errorlist,.errornote"); if(err) return {ok:false, error:(err.textContent||"").trim().substring(0,200)};' +
    'if((location.href||"").indexOf("/change/")<0) return {ok:true, mensaje:"redirigió"}; return {ok:false, error:"Sin confirmación visible"};})()'
  ).catch(function(){ return { ok:false, error:'No se pudo leer confirmación' }; });
  return conf || { ok:false, error:'Sin respuesta' };
}
async function anularPropinaChunior(movId){ return _anularMovimientoChunior('propina', movId); }
// Deshacer = abrir el movimiento por su N° y dejarlo en 0,1. No se anota una contrapartida:
// Chunior deja EDITAR el movimiento, así que el original queda neutralizado y no aparece una
// segunda fila fantasma. El segmento de URL es el mismo que usa el /add/ de cada tipo.
async function anularTransferenciaChunior(movId){ return _anularMovimientoChunior('movimientointerno', movId); }
async function anularDepoSinReclamarChunior(movId){ return _anularMovimientoChunior('depositossinreclamar', movId); }
window.anularTransferenciaChunior = anularTransferenciaChunior;
window.anularDepoSinReclamarChunior = anularDepoSinReclamarChunior;
// Un solo punto de entrada para el botón Deshacer del historial.
window._CHUNIOR_ANULABLE = { MOV_BILLETERA:'movimientointerno', PROPINA:'propina', DEPO_SR:'depositossinreclamar' };
window.deshacerMovimientoChunior = async function(tipo, movId){
  const seg = window._CHUNIOR_ANULABLE[String(tipo||'').toUpperCase()];
  if(!seg) return { ok:false, error:'Ese tipo de movimiento no se puede deshacer desde acá' };
  return _anularMovimientoChunior(seg, movId);
};
// Deshacer sólo dentro del turno en curso: un turno no toca la plata de otro (regla del negocio).
// Pasado el cierre, el movimiento queda como está y se escala al superior.
window._movimientoEsDelTurno = function(fechaIso){
  try{
    if(!fechaIso) return false;
    const t = new Date(fechaIso).getTime();
    if(isNaN(t)) return false;
    return t >= _cotejoInicioTurnoMs();
  }catch(_e){ return false; }
};

// ── Depósitos sin reclamar + reclamo + anular propina (portado de NexoBetaChan 1.0.85) ──
// Todo por el BRIDGE de Chunior (window.chunior), sin escrituras nuevas a la DB salvo el
// update de historial_ops (que nuestro nodo ya hace directo — RLS permisiva en esa tabla).
// poder verlos y reclamarlos. Reclamar = convertir en fichas en Chunior + acreditar al
// usuario en Agentes (SIN anotar una carga nueva en Chunior: el depo ya es el registro).
window.verDepositosSinReclamar = async function(){
  if(!window.chunior){ toast('Ventana de Chunior no disponible','red'); return; }
  abrirModal('💜 Depósitos sin reclamar', '<div class="small" style="padding:14px;color:var(--muted)">Leyendo de Chunior…</div>', null, '');
  try{ const b=document.getElementById('modalSaveBtn'); if(b) b.style.display='none'; }catch(_e){}
  const body = document.getElementById('modalBody');
  try{
    await window.chunior.navigate(CHUNIOR_BASE + '/transacciones/depositossinreclamar/');
    const t0=Date.now(); let listo=false;
    while(Date.now()-t0<10000){ listo=await window.chunior.exec('(function(){return !!(document.getElementById("result_list")||document.querySelector(".paginator,#changelist"));})()').catch(function(){return false;}); if(listo)break; await new Promise(function(r){ setTimeout(r,300); }); }
    if(!listo){ if(body) body.innerHTML='<div class="err-box" style="padding:12px">La lista de Chunior no cargó. Reintentá.</div>'; return; }
    // Leemos CADA celda con su clase y texto (no el textContent junto, que quedaba amontonado).
    const filas = await window.chunior.exec(
      '(function(){var out=[];var trs=document.querySelectorAll("#result_list tbody tr");' +
      'for(var i=0;i<trs.length&&i<120;i++){var tr=trs[i];' +
      ' var a=tr.querySelector("th a[href],td a[href]"); var id=null; if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) id=mh[1];}' +
      ' var tds=tr.querySelectorAll("th,td"); var cells=[];' +
      ' for(var j=0;j<tds.length;j++){ cells.push({c:(tds[j].className||""), t:(tds[j].textContent||"").replace(/\\s+/g," ").trim()}); }' +
      ' out.push({id:id, cells:cells});' +
      '}return out;})()'
    ).catch(function(){ return []; });
    if(!Array.isArray(filas) || !filas.length){ if(body) body.innerHTML='<div class="alert-box" style="padding:12px">No hay depósitos sin reclamar.</div>'; return; }

    // Extrae un campo: primero por clase de la celda, si no por patrón del texto.
    function pick(cells, clsRe, txtRe){
      let c = cells.find(function(x){ return clsRe.test(x.c); });
      if(c && c.t) return c.t;
      if(txtRe){ c = cells.find(function(x){ return txtRe.test(x.t); }); if(c) return c.t; }
      return '';
    }
    const rows = filas.map(function(f){
      const cells = f.cells||[];
      const creacion = pick(cells, /creation|fecha|creado|date/i, /\d{2}[-/]\d{2}[-/]\d{4}/);
      const monto    = pick(cells, /monto|money|importe/i, /\$/);
      const billetera= pick(cells, /cuenta|billetera|destino|wallet/i, /^\s*\d+\s*[-·]/);
      const notas    = pick(cells, /nota/i, null);
      const operador = pick(cells, /operador|user|usuario|creado_por/i, null);
      // Separar día y hora de "10-07-2026 10:39:29"
      const mFecha = String(creacion||'').match(/(\d{2}[-/]\d{2}[-/]\d{4})\s*(\d{2}:\d{2}(?::\d{2})?)?/);
      const dia  = mFecha ? mFecha[1] : creacion;
      const hora = mFecha && mFecha[2] ? mFecha[2] : '';
      const detalle = [notas, operador].filter(function(v){ return v && !/^\s*\d/.test(v); }).join(' · ');
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 13px;border-radius:11px;background:#161b22;border:1px solid #30363d;border-left:3px solid #a78bfa;margin-top:9px">'
        + '<div style="min-width:0;flex:1">'
        +   '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">'
        +     '<span style="font-size:17px;font-weight:900;color:#c4b5fd">'+escapeHtml(monto||'—')+'</span>'
        +     (billetera?'<span style="font-size:12px;font-weight:700;color:#e6edf3">'+escapeHtml(billetera)+'</span>':'')
        +   '</div>'
        +   '<div style="margin-top:4px;font-size:12px;color:#8b949e;display:flex;gap:12px;flex-wrap:wrap">'
        +     (dia?'<span>📅 <b style="color:#c9d1d9">'+escapeHtml(dia)+'</b></span>':'')
        +     (hora?'<span>🕐 <b style="color:#c9d1d9">'+escapeHtml(hora)+'</b></span>':'')
        +   '</div>'
        +   (detalle?'<div style="margin-top:3px;font-size:12px;color:#c9d1d9">📝 '+escapeHtml(detalle)+'</div>':'')
        + '</div>'
        + (f.id?('<button class="mini-btn green" style="font-size:12px;white-space:nowrap;padding:8px 12px" onclick="reclamarDepo(\''+escapeHtml(f.id)+'\',\''+escapeHtml(String(monto||''))+'\',\''+escapeHtml(String(billetera||''))+'\')">✅ Reclamar</button>'):'')
        + '</div>';
    }).join('');
    if(body) body.innerHTML = '<div style="max-height:62vh;overflow:auto;padding-right:4px">'
      + '<div class="small" style="color:#8b949e;margin-bottom:2px">'+filas.length+' depósito(s) sin reclamar en Chunior · el monto se suma a la billetera, se reclama convirtiéndolo en fichas.</div>'
      + rows + '</div>';
  }catch(e){ if(body) body.innerHTML='<div class="err-box" style="padding:12px">Error: '+escapeHtml(e.message||String(e))+'</div>'; }
};

// Reclamar un depo — TOTAL o PARCIAL.
// TOTAL: convierte en fichas en Chunior y acredita en Agentes (flujo original, sin carga nueva).
// PARCIAL (ej. depo de $15 rejuntado, el usuario reclama $10): REDUCE el depo en Chunior al resto
// (con nota automática) + ANOTA la carga del jugador en Chunior por lo reclamado (así el saldo de
// la billetera queda neto 0 y la carga tiene su N° propio) + acredita en Agentes. El resto queda
// reclamable por separado (se acabó el "no se puede reclamar porque vino junto").
window.reclamarDepo = function(movId, montoTxt, billeteraTxt){
  const monto = _adminChuParseMonto(montoTxt);
  const uidBil = (String(billeteraTxt||'').match(/^\s*(\d+)/)||[])[1] || '';
  abrirModal('✅ Reclamar depósito N° '+escapeHtml(String(movId)),
    '<div style="color:#c0cad8;font-size:12px;margin-bottom:10px">Depósito de <b>'+money(monto)+'</b>. Si reclamás MENOS, el depo se reduce al resto (queda reclamable) y lo reclamado se anota como carga del usuario.</div>'
    + '<label>Usuario que reclama</label><input id="reclamoUsuario" placeholder="Ej: juan777" style="width:100%">'
    + '<label style="margin-top:6px">Monto a reclamar</label><input id="reclamoMonto" type="text" inputmode="numeric" autocomplete="off" value="'+window._cotejoFmtMiles(monto)+'" oninput="this.value=window._cotejoFmtMiles(this.value)" style="width:100%;text-align:right;font-weight:800">',
    async function(){
      const usuario = (document.getElementById('reclamoUsuario')?.value||'').trim();
      const reclamo = Math.abs(Number(String(document.getElementById('reclamoMonto')?.value||'').replace(/[^\d]/g,''))||0);
      if(!usuario || usuario.length<3){ toast('Ingresá el usuario.','red'); return; }
      if(!monto || monto<=0){ toast('El depósito no tiene monto válido.','red'); return; }
      if(!reclamo || reclamo>monto){ toast('El monto a reclamar debe ser mayor a 0 y hasta '+money(monto)+'.','red'); return; }
      const esParcial = reclamo < monto;
      if(esParcial && !uidBil){ toast('No pude leer la billetera del depo (necesaria para el parcial). Reclamalo completo o hacelo a mano.','red'); return; }
      cerrarModal();
      if(!_drexGlobalLock('reclamar-depo')){ toast('Hay otra operación en curso. Esperá.','yellow'); return; }
      _wdLock();
      _trazaInit('Reclamar depo N° '+movId+' · '+usuario+' · '+money(reclamo)+(esParcial?(' de '+money(monto)+' (PARCIAL)'):''));
      let _movChuNuevo = null;
      try{
        if(esParcial){
          // 1a) PARCIAL: reducir el depo al resto (con nota del reclamo) — el resto queda reclamable
          const resto = monto - reclamo;
          _trazaPaso('Reduciendo depo a '+money(resto)+' (parcial)…');
          const notaRed = 'reclamado '+money(reclamo)+' por '+usuario+' · quedan '+money(resto)+' · nodo '+new Date().toLocaleString('es-AR');
          const rr = await window._reducirDepoChunior(movId, resto, notaRed);
          if(!rr || !rr.ok){ _trazaPaso('No se pudo reducir el depo: '+((rr&&rr.error)||''),'err'); _trazaFin('err'); toast('No se pudo reducir el depo en Chunior.','red'); return; }
          _trazaPaso('Depo reducido · quedan '+money(resto),'ok');
          // 1b) Anotar la CARGA del jugador en Chunior por lo reclamado (así la billetera queda
          //     neta 0: −reclamo del depo, +reclamo de la carga) y la carga tiene su N° propio.
          _trazaPaso('Anotando carga de '+money(reclamo)+' en Chunior…');
          const rChu = await registrarCargaEnChunior(uidBil, reclamo, usuario);
          if(rChu && rChu.ok){ _movChuNuevo = rChu.movimientoId || null; _trazaPaso('Carga anotada'+(_movChuNuevo?(' · N° '+_movChuNuevo):''),'ok'); }
          else { _trazaPaso('⚠ Carga NO anotada en Chunior ('+((rChu&&rChu.error)||'')+') — anotala a mano','err'); }
        } else {
          // 1) TOTAL: convertir en fichas en Chunior (botón _convertir_fichas del movimiento)
          _trazaPaso('Convirtiendo en fichas en Chunior…');
          await window.chunior.navigate(CHUNIOR_BASE + '/transacciones/depositossinreclamar/' + encodeURIComponent(movId) + '/change/');
          const t0=Date.now(); let ready=false;
          while(Date.now()-t0<10000){ ready=await window.chunior.exec('(function(){return !!document.querySelector("input[name=\'_convertir_fichas\']");})()').catch(function(){return false;}); if(ready)break; await new Promise(function(r){ setTimeout(r,300); }); }
          if(!ready){ _trazaPaso('No apareció el botón "Convertir en fichas"','err'); _trazaFin('err'); toast('No se encontró "Convertir en fichas" en Chunior.','red'); return; }
          const conv = await window.chunior.exec('(function(){var b=document.querySelector("input[name=\'_convertir_fichas\']"); if(!b) return {ok:false}; try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click(); return {ok:true};})()').catch(function(){return {ok:false};});
          if(!conv || !conv.ok){ _trazaPaso('No se pudo clickear convertir','err'); _trazaFin('err'); toast('No se pudo convertir en fichas.','red'); return; }
          await new Promise(function(r){ setTimeout(r,2000); });
          _trazaPaso('Convertido en fichas en Chunior','ok');
        }
        // 2) Acreditar al usuario en Agentes
        _trazaPaso('Acreditando '+money(reclamo)+' a '+usuario+' en Agentes…');
        if(!await ensureDrexSession()){ _trazaPaso('Falta sesión de Agentes','err'); _trazaFin('err'); toast('Sesión de Agentes requerida.','red'); return; }
        const bb = await callDrex('buscarUsuario', usuario, { skipBalance:true });
        if(!bb || !bb.exists){ _trazaPaso(usuario+' no existe en Agentes','err'); _trazaFin('err'); toast('Usuario no encontrado en Agentes.','red'); return; }
        const rc = await callDrex('cargarSaldo', reclamo);
        const okC = rc && rc.ok !== false;
        await registrarEnHistorial({
          usuario, tipo:'CARGA', monto:reclamo,
          billetera_id:null, billetera_nombre:null, origen:'DEPO_RECLAMADO',
          estado: okC?'OK':'ERROR',
          notas: esParcial
            ? ('Reclamo PARCIAL de depo N° '+movId+' · reclamado '+money(reclamo)+' de '+money(monto)+' · quedan '+money(monto-reclamo))
            : ('Reclamo de depósito sin reclamar N° '+movId+' (convertido en fichas) · '+money(reclamo)),
          chunior_movimiento_id: String(_movChuNuevo || movId),
          saldo_post:(typeof rc?.newBalance?.value==='number'?rc.newBalance.value:null)
        });
        if(okC){ _trazaPaso('Acreditado a '+usuario,'ok'); _trazaFin('ok'); toast('✅ Depósito reclamado y acreditado a '+usuario,'green'); }
        else{ _trazaPaso('No se pudo acreditar en Agentes','err'); _trazaFin('err'); toast('⚠️ Convertido en Chunior pero falló la carga en Agentes — cargalo a mano.','red'); }
        try{ await cargarHistorial(); }catch(_e){}
        try{ await sincronizarBilleterasChunior(true); }catch(_e){}
      }catch(e){ _trazaPaso('Error: '+(e.message||''),'err'); _trazaFin('err'); toast('Error al reclamar: '+(e.message||''),'red'); }
      finally{ _wdUnlock(); _drexGlobalUnlock(); }
    }, 'Reclamar y acreditar');
};

window.anularPropinaHistorial = async function(historialId){
  const h = (_historialData||[]).find(function(x){ return String(x.id)===String(historialId); });
  if(!h){ toast('No se encontró el movimiento.', 'red'); return; }
  if(String(h.tipo).toUpperCase()!=='PROPINA'){ toast('Solo se pueden anular propinas por ahora.', 'yellow'); return; }
  if(!h.chunior_movimiento_id){ toast('Esta propina no tiene N° de Chunior — anulala a mano.', 'yellow'); return; }
  if(!confirm('¿Anular la propina de '+money(h.monto||0)+' (Mov. N° '+h.chunior_movimiento_id+')?\n\nSe le pone el monto en 0,10 en Chunior (así se anulan los movimientos). No se puede deshacer automáticamente.')) return;
  if(!_drexGlobalLock('anular-propina')){ toast('Hay otra operación en curso. Esperá.', 'yellow'); return; }
  _wdLock();
  toast('Anulando propina N° '+h.chunior_movimiento_id+'...', 'blue');
  try{
    const r = await anularPropinaChunior(h.chunior_movimiento_id);
    if(r && r.ok){
      try{ await ajustarSaldoBilletera(h.billetera_id, -Math.abs(Number(h.monto||0))); }catch(_e){} // revierte el monto sumado
      try{
        await supabaseClient.from('historial_ops').update({
          estado:'ANULADA',
          notas: (String(h.notas||'').trim()+' [ANULADA monto→0,10]').trim()
        }).eq('id', h.id);
      }catch(_e){}
      toast('✅ Propina anulada (monto→0,10).', 'green');
      try{ await cargarHistorial(); }catch(_e){}
      try{ renderBillerasInicio(); }catch(_e){}
    }else{
      toast('⚠️ No se pudo anular: '+((r&&r.error)||'sin detalle'), 'red');
    }
  }catch(e){ toast('Error al anular: '+(e.message||''), 'red'); }
  finally{ _wdUnlock(); _drexGlobalUnlock(); }
};


// ── Verificar saldo de un retiro pendiente en OCIO (portado de NexoBetaChan · versión SEGURA) ──
// Cuando NO hay ninguna operación en curso, lee el saldo del usuario de UN retiro pendiente y lo
// muestra (badge en la solicitud + toast). NO auto-rechaza (esa decisión de plata la toma el
// operador). Re-chequea cada usuario máx. cada 5 min. Se desactiva con localStorage 'nodo_saldo_ocioso_off'.
window._retiroSaldoCheck = window._retiroSaldoCheck || {};
// Destrabar agente (portado de NexoBetaChan): salida de emergencia si un flujo dejó el candado
// tomado (ej. buscarUsuario colgado). Libera el lock global + watchdog + flags de parcial/scanner.
