function _chuParsearFechaCreacion(s){
  const m = String(s||'').trim().match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if(!m) return null;
  const d = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6]);
  return isNaN(d.getTime()) ? null : d.getTime();
}
// Chunior pinta el monto como 3000 / 3.000 / 3000,00 / 3.000,00 → generamos las variantes de texto.
function _chuVariantesMonto(monto){
  const abs = Math.abs(Number(monto)||0);
  const entero = String(Math.trunc(abs));
  const miles  = Math.trunc(abs).toLocaleString('es-AR'); // 3.000
  const out = [entero, miles, entero+',00', miles+',00', entero+'.00'];
  return out.filter(function(v,i){ return out.indexOf(v)===i; });
}
// Verifica un movimiento en la LISTA de Chunior por usuario (notas) + monto. Portado/afinado del colega:
//   - tCargaMs presente → ADEMÁS filtra por ventana horaria (desambigua varias del mismo monto por
//     cercanía a la hora de la operación). Ausente → NO filtra por tiempo (reintento de op VIEJA:
//     solo interesa si EXISTE un movimiento que coincida).
//   - excluirIds → N° ya vinculados a OTRA op del historial: no reclamarlos (evita doble atribución
//     del mismo movimiento a dos operaciones distintas).
//   - monto por VARIANTES de formato (+ respaldo numérico); usuario EXACTO en notas (+ respaldo por
//     texto de fila si la fila no trae notas).
// Devuelve { existe, movimientoId, creacion?, vinculadoAOtro? } (existe/movimientoId = compat con el caller).
async function verificarMovimientoEnChunior(usuario, monto, tCargaMs, ventanaMs, excluirIds){
  window.NodoSalud?.begin('AUTOMATISMOS')?.record('DATA','OK','CHUNIOR_VERIFY_MOV');
  // "No pude verificar" NO es lo mismo que "no está": si el que llama no puede distinguirlo,
  // vuelve a anotar un movimiento que ya existe y duplica la plata (D-107). Por eso va `ok`.
  if(!window.chunior || !usuario) return { ok:false, existe:false, encontrado:false, movimientoId:null, motivo:'sin ventana de Chunior' };
  const filtraTiempo = (tCargaMs !== undefined && tCargaMs !== null);
  const tRef    = tCargaMs || Date.now();
  const ventana = ventanaMs || 10*60*1000; // ±10 min (cubre demoras y desfase de reloj)
  const excluir = new Set((excluirIds||[]).map(function(x){ return String(x); }));
  const normU     = String(usuario).trim().toLowerCase();
  const variantes = _chuVariantesMonto(monto);
  const montoAbs  = Math.abs(Number(monto));
  try {
    const listUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/?q=' + encodeURIComponent(usuario);
    await window.chunior.navigate(listUrl);
    // Esperar a que cargue la tabla de resultados (o el "0 resultados")
    const t0 = Date.now();
    let listo = false;
    while(Date.now() - t0 < 8000){
      listo = await window.chunior.exec('(function(){return !!(document.getElementById("result_list")||document.querySelector(".paginator, #changelist"));})()').catch(function(){return false;});
      if(listo) break;
      await new Promise(function(r){ setTimeout(r,250); });
    }
    if(!listo) return { ok:false, existe:false, encontrado:false, movimientoId:null, motivo:'la lista de Chunior no cargó' };

    // Leer hasta 40 filas: id, monto (varias clases posibles), notas, fecha de creación y texto de respaldo.
    const res = await window.chunior.exec(
      '(function(){' +
        'var rows = document.querySelectorAll("#result_list tbody tr");' +
        'var out = [];' +
        'for(var i=0;i<rows.length && i<40;i++){' +
          'var r = rows[i];' +
          'var a = r.querySelector(".field-id a, th a, td a[href]");' +
          'var idm = null; if(a){ var mm=(a.href||"").match(/movimientoficha\\/(\\d+)/); if(mm) idm=mm[1]; else { var t=(a.textContent||"").trim(); if(/^\\d{3,}$/.test(t)) idm=t; } }' +
          'var montoTxt = ((r.querySelector(".field-as_money, .field-monto, td.field-monto")||{}).textContent || "").trim();' +
          'var notas = ((r.querySelector(".field-notas")||{}).textContent || "").trim();' +
          'var cre = ((r.querySelector(".field-creation, td.field-creation")||{}).textContent || "").trim();' +
          'var texto = (r.textContent||"").replace(/\\s+/g," ").trim().substring(0,300);' +
          'out.push({ id:idm, montoTxt:montoTxt, notas:notas, creacion:cre, texto:texto });' +
        '}' +
        'return out;' +
      '})()'
    ).catch(function(){ return []; });

    // La lista cargó y no trajo ninguna fila: eso SÍ es "no está".
    if(!res || !res.length) return { ok:true, existe:false, encontrado:false, movimientoId:null };

    // Candidatos que coinciden en usuario + monto (+ horario si aplica).
    const candidatos = [];
    for(const r of res){
      const notasNorm = String(r.notas||'').trim().toLowerCase();
      const txtLower  = String(r.texto||'').toLowerCase();
      // usuario: EXACTO en notas (lo que escribimos nosotros); si la fila no trae notas, respaldo por texto.
      const usuarioOk = notasNorm ? (notasNorm === normU) : (!!normU && txtLower.indexOf(normU) !== -1);
      if(!usuarioOk) continue;
      // monto: por variantes de formato contra el campo monto/texto; respaldo por parseo numérico (AR).
      const campoMonto = r.montoTxt || r.texto || '';
      let montoOk = variantes.some(function(v){ return campoMonto.indexOf(v) !== -1; });
      if(!montoOk){
        const mTxt = String(r.montoTxt||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.');
        const mNum = Math.abs(parseFloat(mTxt));
        montoOk = !isNaN(mNum) && Math.abs(mNum - montoAbs) < 1;
      }
      if(!montoOk) continue;
      const tFila = _chuParsearFechaCreacion(r.creacion);
      if(filtraTiempo){ if(tFila === null || Math.abs(tFila - tRef) > ventana) continue; } // horario NO coincide
      candidatos.push({ id: r.id||null, creacion: r.creacion, dt: (tFila!==null ? Math.abs(tFila - tRef) : Infinity) });
    }
    if(!candidatos.length) return { ok:true, existe:false, encontrado:false, movimientoId:null };
    candidatos.sort(function(a,b){ return a.dt - b.dt; }); // el más cercano en horario primero
    // Descartar los que YA están vinculados a otra operación.
    const libres = candidatos.filter(function(c){ return !(c.id && excluir.has(String(c.id))); });
    if(libres.length){
      const best = libres[0];
      return { ok:true, existe:true, encontrado:true, movimientoId: best.id || null, creacion: best.creacion };
    }
    // Hubo match(es) pero TODOS ya pertenecen a otra op → no lo reclamamos como propio.
    return { ok:true, existe:false, encontrado:false, vinculadoAOtro:true, idVinculado: candidatos[0].id, creacion: candidatos[0].creacion };
  } catch(e){
    return { ok:false, existe:false, encontrado:false, movimientoId:null, motivo:(e&&e.message)||'error leyendo la lista de Chunior' };
  }
}

// Registra una carga en Chunior (movimiento de fichas) y devuelve el número de movimiento.
// chunior_uid: ID de la billetera en Chunior (string, ej "918")
// monto: positivo (acreditación al jugador)
// usuario: nombre del usuario para escribir en notas
// Retorna: { ok:boolean, movimientoId:string|null, error:string|null }
// ══════════════════════════════════════════════════════════════════════════════
// ANOTACIONES DE CHUNIOR PENDIENTES (portado de NexoBetaChan · rama unificacion)
// Caso real: la carga se hace en Agentes y, al ir a anotarla en Chunior, la sesión
// está caída. Las fichas SALIERON pero en Chunior no quedó nada, y nadie se acuerda
// de terminar el trabajo — el operador se entera al cotejar, horas después.
// Ahora lo que no se pudo anotar queda guardado con todo lo necesario y se reintenta
// solo cuando Chunior vuelve. Sobrevive a que se cierre el panel (localStorage).
// ══════════════════════════════════════════════════════════════════════════════
const _CHU_PEND_KEY = 'nodo_chunior_pendientes';
function _chuPendAll(){ try{ return JSON.parse(localStorage.getItem(_CHU_PEND_KEY)||'[]')||[]; }catch(_e){ return []; } }
function _chuPendSave(a){ try{ localStorage.setItem(_CHU_PEND_KEY, JSON.stringify((a||[]).slice(-40))); }catch(_e){} }
window.chuniorPendientes = _chuPendAll;
window.chuniorPendienteAdd = function(item){
  if(!item || !item.uid || !item.monto) return;
  const a = _chuPendAll();
  a.push(Object.assign({ id:'cp'+Date.now()+Math.random().toString(36).slice(2,6), ts:Date.now(), intentos:0 }, item));
  _chuPendSave(a);
  try{ toast('📌 Anotación de Chunior pendiente: '+(item.tipo||'MOV')+' '+item.usuario+' · '+money(item.monto)+' — se reintenta sola','yellow'); }catch(_e){}
  console.warn('[chunior-pend] guardado para reintentar:', item);
};
window.chuniorPendienteQuitar = function(id){ _chuPendSave(_chuPendAll().filter(function(x){ return x.id!==id; })); };
let _chuPendCorriendo = false;
window.chuniorPendientesReintentar = async function(manual){
  if(_chuPendCorriendo) return;
  const lista = _chuPendAll();
  if(!lista.length){ if(manual) toast('No hay anotaciones de Chunior pendientes','blue'); return; }
  if(!window.chunior){ if(manual) toast('Ventana de Chunior no disponible','red'); return; }
  // Esto es de fondo: no pisa una operación en curso, puede esperar al próximo intento.
  if(typeof _watchdog!=='undefined' && _watchdog && _watchdog.busy>0) return;
  if(window._drexGlobalBusy) return;
  if(window._drexCola && (window._drexCola.activo || window._drexCola.pendientes>0)) return;
  _chuPendCorriendo = true;
  try{
    for(const p of lista.slice()){
      if(p.intentos >= 8) continue;                      // no insistir para siempre en silencio
      // PRIMERO: ¿ya entró? Si Chunior se cayó JUSTO DESPUÉS de guardar, el movimiento existe y
      // volver a anotarlo duplica la carga — pasó el 17/09 en el cambio de turno. La verificación de
      // adentro del registro no cubre este caso (sólo mira cuando no hubo ni éxito ni error, y acá
      // hubo error). Se pregunta por el horario del movimiento ORIGINAL, no por el de ahora (D-107).
      let ya = null;
      try{ ya = await verificarMovimientoEnChunior(p.usuario, p.monto, p.ts || Date.now(), 15*60*1000); }
      catch(_e){ ya = null; }
      if(ya && ya.ok && ya.encontrado){
        window.chuniorPendienteQuitar(p.id);
        try{
          if(p.histId && typeof supabaseClient!=='undefined' && ya.movimientoId){
            await supabaseClient.from('historial_ops').update({ chunior_movimiento_id:String(ya.movimientoId) }).eq('id', p.histId);
          }
        }catch(_e){}
        try{ toast('✓ '+(p.tipo||'MOV')+' de '+p.usuario+' · '+money(p.monto)+' YA estaba anotado en Chunior'+(ya.movimientoId?(' · N° '+ya.movimientoId):'')+' — no se duplicó','green'); }catch(_e){}
        try{ if(typeof cargarHistorial==='function') cargarHistorial(); }catch(_e){}
        continue;
      }
      // No se pudo confirmar (la lista no cargó, Chunior sigue caído): NO se anota a ciegas.
      // Queda pendiente y se vuelve a intentar; es preferible a duplicar plata.
      if(!(ya && ya.ok)){
        if(manual) toast('No pude confirmar en Chunior si ya estaba anotado'+((ya&&ya.motivo)?(' ('+ya.motivo+')'):'')+' · no anoto para no duplicar','yellow');
        break;
      }
      let r = null;
      try{
        r = (String(p.tipo).toUpperCase()==='RETIRO')
          ? await registrarRetiroEnChunior(p.uid, p.monto, p.usuario)
          : await registrarCargaEnChunior(p.uid, p.monto, p.usuario);
      }catch(e){ r = { ok:false, error:e.message||String(e) }; }
      if(r && r.ok){
        window.chuniorPendienteQuitar(p.id);
        // Completar la fila del historial que había quedado sin número de Chunior.
        try{
          if(p.histId && typeof supabaseClient!=='undefined' && r.movimientoId){
            await supabaseClient.from('historial_ops').update({ chunior_movimiento_id:String(r.movimientoId) }).eq('id', p.histId);
          }
        }catch(_e){}
        try{ toast('✅ Anotado en Chunior: '+(p.tipo||'MOV')+' '+p.usuario+' · '+money(p.monto)+(r.movimientoId?(' · N° '+r.movimientoId):''),'green'); }catch(_e){}
        try{ if(typeof cargarHistorial==='function') cargarHistorial(); }catch(_e){}
      } else {
        p.intentos = (p.intentos||0)+1;
        const a = _chuPendAll(); const it = a.find(function(x){ return x.id===p.id; });
        if(it){ it.intentos = p.intentos; it.ultimoError = (r&&r.error)||'sin detalle'; _chuPendSave(a); }
        if(manual) toast('No se pudo anotar todavía: '+((r&&r.error)||''),'yellow');
        break;   // si falló uno, Chunior no está listo — no quemamos el resto
      }
    }
  } finally { _chuPendCorriendo = false; }
};
try{ setInterval(function(){ window.chuniorPendientesReintentar(false); }, 45000); }catch(_e){}

// ══════════════════════════════════════════════════════════════════════════════
// CANDADO DE CHUNIOR — las anotaciones van DE A UNA.
// Chunior es UNA sola ventana y anotar hace navigate() sobre ella. Dos anotaciones
// a la vez se pisan el formulario: la segunda navega mientras la primera está
// llenando, y queda registrada UNA sola.
// Caso real que lo destapó: al meter el bono en la misma carga (1.1.54) se fue la
// pausa que había entre las dos anotaciones (antes el bono hacía una operación
// entera en Agentes en el medio). Las dos salían casi juntas y Chunior terminaba
// con SOLO el bono anotado y la carga real no → descuadre contra el casino.
// Esto serializa TODAS las anotaciones, no solo las del bono.
// ══════════════════════════════════════════════════════════════════════════════
let _chuCola = Promise.resolve();
function _chuSerializar(fn){
  const corrida = _chuCola.then(fn, fn);          // sigue la fila aunque la anterior falle
  _chuCola = corrida.then(function(){}, function(){});
  return corrida;
}

async function registrarCargaEnChunior(chunior_uid, monto, usuario){
  return _chuSerializar(function(){ return _registrarCargaEnChuniorImpl(chunior_uid, monto, usuario); });
}
async function _registrarCargaEnChuniorImpl(chunior_uid, monto, usuario){
  // Bloqueo del cotejo: mientras hay una DECLARACIÓN abierta no se anota (snapshot consistente).
  // Espera hasta 90s a que el operador confirme/cierre — la anotación NO se pierde, queda esperando.
  for(let _w=0; window._cotejoDeclarando && _w<90; _w++){ await new Promise(function(r){setTimeout(r,1000);}); }
  if(!window.chunior) return { ok:false, movimientoId:null, error:'Ventana de Chunior no disponible' };
  if(!chunior_uid) return { ok:false, movimientoId:null, error:'La billetera no tiene chunior_uid configurado' };

  const addUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/add/';
  await window.chunior.navigate(addUrl);

  // Esperar a que aparezcan los 3 campos del formulario (DOM ready ≠ form ready en Chunior)
  const t0 = Date.now();
  let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec(
      '(function(){return !!(document.getElementById("id_cuenta_destino")&&document.getElementById("id_monto")&&document.getElementById("id_notas")&&document.querySelector("input[name=\'_addanother\']"));})()'
    ).catch(function(){return false;});
    if(ready) break;
    await new Promise(function(r){ setTimeout(r,300); });
  }
  if(!ready) return { ok:false, movimientoId:null, error:'Formulario de Chunior no apareció en 10s' };

  let injectRes;
  try {
    injectRes = await window.chunior.exec(
      '(function(){' +
      'var s=document.getElementById("id_cuenta_destino");' +
      'var m=document.getElementById("id_monto");' +
      'var n=document.getElementById("id_notas");' +
      'var b=document.querySelector("input[name=\'_addanother\']");' +
      'if(!s||!m||!n||!b) return {ok:false,err:"campos faltantes",hasS:!!s,hasM:!!m,hasN:!!n,hasB:!!b};' +
      's.value='+JSON.stringify(String(chunior_uid))+'; s.dispatchEvent(new Event("change",{bubbles:true}));' +
      'm.value='+JSON.stringify(String(monto))+'; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
      'n.value='+JSON.stringify(String(usuario||""))+'; n.dispatchEvent(new Event("input",{bubbles:true})); n.dispatchEvent(new Event("change",{bubbles:true}));' +
      // Devolvemos los valores PRE-click para verificar que entraron antes del submit
      'var snap={ok:true, valS:s.value, valM:m.value, valN:n.value};' +
      'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click();' +
      'return snap;' +
      '})()'
    );
  } catch(e){
    return { ok:false, movimientoId:null, error:e.message||'Error inyectando datos' };
  }
  if(!injectRes || !injectRes.ok){
    return { ok:false, movimientoId:null, error:'Inyección falló: '+JSON.stringify(injectRes) };
  }

  // Esperar y leer la respuesta de Chunior. Antes era una espera fija de 2.5s + parser
  // estricto; si Chunior tardaba o cambiaba el formato del mensaje, el N° quedaba null
  // (carga anotada pero "Falta Chunior"). Luego: poll hasta 8s (más robusto, pero cola
  // larga en el peor caso — comparado con el NODO hermano, que usa un fijo de 2.5s).
  // Ajuste (2026-07-02): baja la espera inicial y el techo del poll para acercarnos a la
  // velocidad del hermano en el caso típico, sin volver a perder el N° en el caso lento.
  await new Promise(function(r){setTimeout(r,500);});

  let movimientoId = null;
  let errorMsg = null;
  let dbgTxt = null;
  const _tParse = Date.now();
  while(Date.now() - _tParse < 4500){
    let res = null;
    try {
      res = await window.chunior.exec(
        '(function(){' +
        'var ok=document.querySelector("li.success")||document.querySelector(".messagelist .success")||document.querySelector(".success");' +
        'if(!ok){var ml=document.querySelector("ul.messagelist li"); if(ml&&/[eé]xito/i.test(ml.textContent||"")) ok=ml;}' +
        'if(ok){' +
        '  var txt=ok.textContent||"";' +
        '  var a=ok.querySelector("a[href]");' +
        '  if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) return {ok:true, id:mh[1]};}' +
        '  var mt=txt.match(/fichas[^0-9]{0,14}(\\d{3,})/i) || txt.match(/n[\\sº°o\\.]{0,4}(\\d{4,})/i) || txt.match(/(\\d{5,})/);' +
        '  if(mt) return {ok:true, id:mt[1]};' +
        '  return {ok:true, id:null, dbg:txt.trim().substring(0,180)};' +
        '}' +
        'var err=document.querySelector("ul.errorlist") || document.querySelector(".errornote");' +
        'if(err) return {ok:false, error:(err.textContent||"Error en formulario").trim().substring(0,200)};' +
        'return {pending:true};' +
        '})()'
      );
    } catch(e){
      errorMsg = e.message||'Error leyendo respuesta'; break;
    }
    if(res && res.ok){ movimientoId = res.id; dbgTxt = res.dbg||null; break; }
    if(res && res.error){ errorMsg = res.error; break; }
    // pending → la página todavía no mostró el resultado; esperar y reintentar
    await new Promise(function(r){ setTimeout(r,250); });
  }
  if(!movimientoId && dbgTxt){
    console.warn('[chunior] Anotó con éxito pero no pude leer el N° de movimiento. Texto del mensaje:', dbgTxt);
  }

  // Verificación contra la LISTA (horario field-creation + monto + usuario) SOLO en el caso
  // verdaderamente DESCONOCIDO: ni mensaje de éxito ni error visibles. Si Chunior YA mostró el
  // éxito (dbgTxt: solo faltó parsear el N°), NO navegamos a la lista — esa navegación extra en
  // cada carga era lo que hacía lento el paso de Chunior. Así cada movimiento queda ENLAZADO a su
  // N° de Chunior aunque no se haya podido parsear en el momento (portado de tu nodo).
  let verificadoPorLista = false;
  if(!movimientoId && !errorMsg && !dbgTxt){
    try{
      const v = await verificarMovimientoEnChunior(usuario, monto, Date.now(), 2*60*1000);
      if(v && v.ok && v.encontrado){
        movimientoId = v.movimientoId || null;
        verificadoPorLista = true;
        console.log('[chunior] Movimiento confirmado por lista · creación', v.creacion, '· N°', movimientoId || '(sin link)');
      } else if(v && v.ok && !v.encontrado){
        errorMsg = 'El movimiento NO aparece en la lista de Chunior (horario+monto+usuario) · anotarlo a mano';
      }
      // v.ok===false (lista no cargó) → no afirmamos nada: queda como antes (ok sin N°)
    }catch(_e){}
  }

  // Anotación OK → refrescar el saldo REAL de las billeteras desde Chunior (la ventana ya quedó en
  // /movimientoficha/add/ → leer los breadcrumbs no navega de más) para que NODO dibuje la verdad.
  if(!!movimientoId || !errorMsg){ try{ window._syncBilleterasTrasAnotacion && window._syncBilleterasTrasAnotacion(); }catch(_e){} }
  return { ok: !!movimientoId || !errorMsg, movimientoId: movimientoId, error: errorMsg, verificadoPorLista: verificadoPorLista };
}

// Retiro en Chunior: igual que carga pero monto negativo
async function registrarRetiroEnChunior(chunior_uid, monto, usuario){
  return registrarCargaEnChunior(chunior_uid, -Math.abs(Number(monto)), usuario);
}

// ── Auto-recuperación de Chunior (portado del colega, v1.1.36) ────────────────
// Idea: NO depender de que el operador apriete "Reiniciar Chunior". Si Chunior se traba varias
// veces SEGUIDAS (formulario que no aparece, exec que falla, registro con ok:false), se recupera
// SOLO recargándose desde la base. Contamos trabas CONSECUTIVAS de los registros de carga/retiro;
// a las 5, disparamos reiniciarChunior(false) (soft: navega a la base, re-loguea si perdió sesión).
// Un éxito resetea el contador → solo dispara si está REALMENTE pegado.
window._chuniorTrabaCount = 0;
let _chuniorReiniciando = false;
const _CHUNIOR_TRABA_MAX = 5;
async function _chuniorAutoRecuperar(){
  if(_chuniorReiniciando) return;
  if(!window.chunior || !window.chunior.reset) return;   // solo en la app de escritorio
  _chuniorReiniciando = true;
  try{ toast('🔄 Chunior se trabó '+window._chuniorTrabaCount+' veces seguidas · recuperándolo solo…','yellow'); }catch(_e){}
  try{ await window.reiniciarChunior(false); }catch(_e){}
  window._chuniorTrabaCount = 0;
  setTimeout(function(){ _chuniorReiniciando = false; }, 8000); // margen para que termine de recargar
}
function _chuniorTraba(ok, contexto){
  if(_chuniorReiniciando) return;                        // no contar mientras se recupera
  if(ok){ window._chuniorTrabaCount = 0; return; }       // un éxito limpia la racha
  window._chuniorTrabaCount = (window._chuniorTrabaCount||0) + 1;
  try{ console.warn('[chunior] traba '+window._chuniorTrabaCount+'/'+_CHUNIOR_TRABA_MAX+(contexto?(' · '+contexto):'')); }catch(_e){}
  if(window._chuniorTrabaCount >= _CHUNIOR_TRABA_MAX) _chuniorAutoRecuperar();
}
// Envolvemos SOLO registrarCargaEnChunior: el retiro delega en ella, así que cubre carga Y retiro
// sin doble conteo. No tocamos los múltiples returns de la función original.
(function(){
  const _oc = registrarCargaEnChunior;
  registrarCargaEnChunior = async function(chunior_uid, monto, usuario){
    const esRetiro = Number(monto) < 0;
    let r;
    try{ r = await _oc.apply(this, arguments); }
    catch(e){ _chuniorTraba(false, (esRetiro?'retiro:':'carga:')+(e.message||'')); throw e; }
    _chuniorTraba(r && r.ok!==false, esRetiro?'retiro':'carga');
    return r;
  };
  try{ window.registrarCargaEnChunior = registrarCargaEnChunior; }catch(_e){}
})();

// Cambia la billetera destino del movimiento N° {movId} en Chunior, sin que el operador lo vea.
// Devuelve {ok, error?, movimientoId?}.
async function _cambiarBilleteraChunior(movId, nuevoChuniorUid){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const changeUrl = CHUNIOR_BASE + '/transacciones/movimientoficha/' + encodeURIComponent(movId) + '/change/';
  try {
    await window.chunior.navigate(changeUrl);
  } catch(e){
    return { ok:false, error:'No se pudo navegar a Chunior: ' + (e.message||'') };
  }

  // Esperar a que aparezcan el select y el botón "Guardar y agregar otro"
  const t0 = Date.now();
  let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec(
      '(function(){return !!(document.getElementById("id_cuenta_destino") && document.querySelector("input[name=\'_addanother\']"));})()'
    ).catch(function(){ return false; });
    if(ready) break;
    await new Promise(function(r){ setTimeout(r, 300); });
  }
  if(!ready) return { ok:false, error:'Formulario de Chunior no apareció en 10s' };

  // Verificar que el chunior_uid pedido exista como option válida
  const opcionExiste = await window.chunior.exec(
    '(function(){var s=document.getElementById("id_cuenta_destino"); if(!s) return false;' +
    'for(var i=0;i<s.options.length;i++){ if(String(s.options[i].value)===' + JSON.stringify(String(nuevoChuniorUid)) + ') return true; } return false; })()'
  ).catch(function(){ return false; });
  if(!opcionExiste) return { ok:false, error:'La billetera elegida no figura en el select de Chunior' };

  // Inyectar el cambio y disparar el submit (igual que en la carga: _addanother → vuelve a /add/)
  let injectRes;
  try {
    injectRes = await window.chunior.exec(
      '(function(){' +
        'var s=document.getElementById("id_cuenta_destino");' +
        'var b=document.querySelector("input[name=\'_addanother\']");' +
        'if(!s||!b) return {ok:false,err:"campos faltantes"};' +
        's.value=' + JSON.stringify(String(nuevoChuniorUid)) + ';' +
        's.dispatchEvent(new Event("change",{bubbles:true}));' +
        'var snap={ok:true, valS:s.value};' +
        'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click();' +
        'return snap;' +
      '})()'
    );
  } catch(e){
    return { ok:false, error:'Inyección falló: ' + (e.message||'') };
  }
  if(!injectRes || !injectRes.ok) return { ok:false, error:'Inyección falló: ' + JSON.stringify(injectRes) };

  // Esperar la confirmación (Chunior redirige a /add/ con li.success "Se modificó con éxito ...")
  await new Promise(function(r){ setTimeout(r, 2500); });

  try {
    const conf = await window.chunior.exec(
      '(function(){' +
        'var li = document.querySelector("li.success");' +
        'if(li){' +
          'var t = (li.textContent||"").trim();' +
          'if(/se\\s+modific[oó]\\s+con\\s+[eé]xito/i.test(t)){' +
            'var a = li.querySelector("a[href*=\\"/movimientoficha/\\"]");' +
            'var idM = null;' +
            'if(a){ var mm = a.href.match(/movimientoficha\\/(\\d+)/); if(mm) idM = mm[1]; }' +
            'if(!idM){ var m2 = t.match(/N°\\s*(\\d+)/); if(m2) idM = m2[1]; }' +
            'return { ok:true, mensaje:t, movId:idM };' +
          '}' +
        '}' +
        'var err = document.querySelector(".errorlist,.errornote");' +
        'if(err) return { ok:false, error:(err.textContent||"").trim() };' +
        'var u = window.location.href || "";' +
        'if(u.indexOf("/change/") < 0) return { ok:true, mensaje:"Redirección a /add/" };' +
        'return { ok:false, error:"Sin mensaje de confirmación visible" };' +
      '})()'
    );
    if(!conf || !conf.ok){
      return { ok:false, error: conf?.error || 'Chunior no confirmó el cambio' };
    }
    return { ok:true, movId: conf.movId || null, mensaje: conf.mensaje || '' };
  } catch(e){
    return { ok:false, error:'No se pudo leer la confirmación: ' + (e.message||'') };
  }
}

// Transferir fichas de una billetera a otra en Chunior (form /movimientointerno/add/).
// Devuelve {ok, error?}.
async function _transferirEntreBilleterasChunior(origenUid, destinoUid, monto, notas){
  if(!window.chunior) return { ok:false, error:'Ventana de Chunior no disponible' };
  const url = CHUNIOR_BASE + '/transacciones/movimientointerno/add/';
  try {
    await window.chunior.navigate(url);
  } catch(e){
    return { ok:false, error:'No se pudo navegar a Chunior: ' + (e.message||'') };
  }

  // Esperar el formulario
  const t0 = Date.now();
  let ready = false;
  while(Date.now() - t0 < 10000){
    ready = await window.chunior.exec(
      '(function(){return !!(document.getElementById("id_cuenta_origen")&&document.getElementById("id_cuenta_destino")&&document.getElementById("id_monto")&&document.querySelector("input[name=\'_addanother\']"));})()'
    ).catch(function(){ return false; });
    if(ready) break;
    await new Promise(function(r){ setTimeout(r, 300); });
  }
  if(!ready) return { ok:false, error:'Formulario de transferencia no apareció en 10s' };

  // Verificar que ambas billeteras existan como options
  const verif = await window.chunior.exec(
    '(function(){' +
      'function tiene(id,v){var s=document.getElementById(id); if(!s) return false;' +
      'for(var i=0;i<s.options.length;i++){ if(String(s.options[i].value)===String(v)) return true; } return false; }' +
      'return { origen: tiene("id_cuenta_origen", ' + JSON.stringify(String(origenUid)) + '),' +
              ' destino: tiene("id_cuenta_destino", ' + JSON.stringify(String(destinoUid)) + ') };' +
    '})()'
  ).catch(function(){ return { origen:false, destino:false }; });
  if(!verif.origen)  return { ok:false, error:'La billetera origen no figura en Chunior (UID '+origenUid+')' };
  if(!verif.destino) return { ok:false, error:'La billetera destino no figura en Chunior (UID '+destinoUid+')' };

  // Inyectar y submit
  let injectRes;
  try {
    injectRes = await window.chunior.exec(
      '(function(){' +
        'var o=document.getElementById("id_cuenta_origen");' +
        'var d=document.getElementById("id_cuenta_destino");' +
        'var m=document.getElementById("id_monto");' +
        'var n=document.getElementById("id_notas");' +
        'var b=document.querySelector("input[name=\'_addanother\']");' +
        'if(!o||!d||!m||!b) return {ok:false,err:"campos faltantes"};' +
        'o.value=' + JSON.stringify(String(origenUid))  + '; o.dispatchEvent(new Event("change",{bubbles:true}));' +
        'd.value=' + JSON.stringify(String(destinoUid)) + '; d.dispatchEvent(new Event("change",{bubbles:true}));' +
        'm.value=' + JSON.stringify(String(monto))      + '; m.dispatchEvent(new Event("input",{bubbles:true})); m.dispatchEvent(new Event("change",{bubbles:true}));' +
        'if(n){ n.value=' + JSON.stringify(String(notas||"")) + '; n.dispatchEvent(new Event("input",{bubbles:true})); }' +
        'try{document.querySelectorAll("ul.messagelist, li.success, .messagelist .success, .success").forEach(function(n){ try{ n.remove(); }catch(_x){} });}catch(_x){} b.click();' +
        'return {ok:true};' +
      '})()'
    );
  } catch(e){
    return { ok:false, error:'Inyección falló: ' + (e.message||'') };
  }
  if(!injectRes || !injectRes.ok) return { ok:false, error:'Inyección falló: ' + JSON.stringify(injectRes) };

  // Esperar confirmación Y LEER EL N° DE MOVIMIENTO.
  // Antes solo devolvía {ok:true}: la plata se movía en Chunior y de este lado no quedaba
  // ni el número, así que después no había forma de atar la transferencia a nada. Se usa
  // el mismo lector que el depósito sin reclamar, que viene funcionando.
  await new Promise(function(r){ setTimeout(r, 2500); });
  let movimientoId = null;
  try {
    const ok = await window.chunior.exec(
      '(function(){' +
        'if(document.querySelector("li.success")) return true;' +
        'var u=window.location.href||""; if(u.indexOf("/movimientointerno/add/") >= 0 && !document.querySelector(".errorlist,.errornote")) return true;' +
        'return false;' +
      '})()'
    );
    if(!ok){
      const errMsg = await window.chunior.exec(
        '(function(){var e=document.querySelector(".errorlist,.errornote"); return e ? (e.textContent||"").trim() : null;})()'
      ).catch(function(){ return null; });
      return { ok:false, error: errMsg || 'Chunior no confirmó la transferencia' };
    }
    // El N° es "si está, mejor": si no aparece, la transferencia igual se hizo y se
    // registra sin número. Nunca se falla una transferencia buena por no poder leerlo.
    movimientoId = await window.chunior.exec(
      '(function(){' +
        'var ok=document.querySelector("li.success")||document.querySelector(".messagelist .success")||document.querySelector(".success");' +
        'if(!ok) return null;' +
        'var a=ok.querySelector("a[href]");' +
        'if(a){var mh=(a.getAttribute("href")||"").match(/(\\d{3,})/); if(mh) return mh[1];}' +
        'var txt=ok.textContent||"";' +
        'var mt=txt.match(/n[\\sº°o\\.]{0,4}(\\d{4,})/i) || txt.match(/(\\d{5,})/);' +
        'return mt ? mt[1] : null;' +
      '})()'
    ).catch(function(){ return null; });
  } catch(_){}

  return { ok:true, movimientoId: movimientoId || null };
}

// Modal NODO para transferir entre billeteras.
// ══════════════════════════════════════════════════════════════════════════
