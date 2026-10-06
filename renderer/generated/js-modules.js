// Funciones sin DOM ni estado del panel. Los Intl se crean una sola vez, al usarlos.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).formatos=factory();
})(globalThis, function(){
  'use strict';
  const ZONA_AR='America/Argentina/Buenos_Aires';
  let moneda, fechaHora, horaChat, diaArgentina, miles;

  function money(v){
    moneda ||= new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0});
    return moneda.format(Number(v||0));
  }
  function normalizar(v){ return String(v||'').trim().toUpperCase(); }
  function formatFecha(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return String(fechaRaw||'');
      fechaHora ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
      });
      return fechaHora.format(fecha).replace(',', ' ·');
    }catch(_e){ return String(fechaRaw||''); }
  }
  function formatearHoraChat(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return '';
      horaChat ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, hour:'2-digit', minute:'2-digit', hour12:false
      });
      return horaChat.format(fecha);
    }catch(_e){ return ''; }
  }
  // `ahora` explícito permite verificar límites sin cambiar el reloj del sistema.
  function inicioDiaArgentina(ahora=Date.now()){
    diaArgentina ||= new Intl.DateTimeFormat('en-CA',{
      timeZone:ZONA_AR, year:'numeric', month:'2-digit', day:'2-digit'
    });
    const partes=diaArgentina.formatToParts(new Date(ahora));
    const get=tipo=>partes.find(p=>p.type===tipo).value;
    return new Date(get('year')+'-'+get('month')+'-'+get('day')+'T00:00:00-03:00');
  }
  // Exportación de agentes: MM/DD/YYYY HH:MM:SS interpretado en Argentina.
  function parseFechaCSV(str){
    if(!str) return null;
    const s=String(str).trim();
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(m){
      const iso=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')+'T'
        +(m[4]||'00').padStart(2,'0')+':'+(m[5]||'00').padStart(2,'0')+':'+(m[6]||'00').padStart(2,'0')+'-03:00';
      const fecha=new Date(iso);
      if(!isNaN(fecha)) return fecha;
    }
    const fecha=new Date(s);
    return isNaN(fecha)?null:fecha;
  }
  function getTurno(fechaISO){
    if(!fechaISO) return 'TN';
    const h=new Date(new Date(fechaISO).getTime()-3*60*60*1000).getUTCHours();
    return h>=6&&h<14?'TM':h>=14&&h<22?'TT':'TN';
  }
  function soloDigitos(v){ return Math.abs(Number(String(v==null?'':v).replace(/[^\d]/g,''))||0); }
  function formatMiles(n){
    miles ||= new Intl.NumberFormat('es-AR');
    return miles.format(n);
  }
  function cotejoFmtMiles(v){ const n=soloDigitos(v); return n?formatMiles(n):''; }
  function fmtMilesConSigno(v){
    const neg=/^\s*-/.test(String(v==null?'':v)), n=soloDigitos(v);
    return n?(neg?'-':'')+formatMiles(n):(neg?'-':'');
  }
  function parseMontoConSigno(v){ return /^\s*-/.test(String(v==null?'':v))?-soloDigitos(v):soloDigitos(v); }

  return Object.freeze({money, normalizar, formatFecha, formatearHoraChat, inicioDiaArgentina,
    parseFechaCSV, getTurno, cotejoFmtMiles, fmtMilesConSigno, parseMontoConSigno});
});
// Importación: convierte texto en datos; el adaptador del panel administra archivos y Supabase.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory(require('./formatos.js'));
  else (root.NodoDomain||(root.NodoDomain={})).csv=factory(root.NodoDomain.formatos);
})(globalThis, function(formatos){
  'use strict';
  function parseCSV(text){
    if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const rows=[];
    let row=[], cur='', inQuotes=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(inQuotes){
        if(c==='"'&&text[i+1]==='"'){ cur+='"'; i++; }
        else if(c==='"') inQuotes=false;
        else cur+=c;
      }else{
        if(c==='"') inQuotes=true;
        else if(c===','){ row.push(cur); cur=''; }
        else if(c==='\n'||c==='\r'){
          row.push(cur); rows.push(row); row=[]; cur='';
          if(c==='\r'&&text[i+1]==='\n') i++;
        }else cur+=c;
      }
    }
    if(cur||row.length||text.endsWith('"')){ row.push(cur); rows.push(row); }
    return rows;
  }
  function cleanPhone(v){ return v?(String(v).replace(/[^\d]/g,'')||null):null; }
  function parseNumCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=Number(String(v).replace(/\./g,'').replace(',','.'));
    return Number.isFinite(n)?n:0;
  }
  function parseIntCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=parseInt(String(v).trim(),10);
    return Number.isFinite(n)?n:0;
  }
  function columnas(headers){
    const indices=new Map(headers.map((h,i)=>[String(h||'').trim().toLowerCase(),i]));
    return (row,name)=>{ const i=indices.get(name); return i===undefined?'':(row[i]??''); };
  }
  function prepararJugadores(rows, pc){
    if(!rows.length) return [];
    const getCol=columnas(rows[0]), registros=[];
    for(let i=1;i<rows.length;i++){
      const r=rows[i];
      if(!r||!r.length) continue;
      const usuario=String(getCol(r,'usuarios')||'').trim();
      if(!usuario||/^\d{4}-\d{2}-\d{2}t/i.test(usuario)||(/^\d+$/.test(usuario)&&usuario.length>=10)) continue;
      const alias=String(getCol(r,'alias')||'').trim();
      const reg={
        usuario:usuario.toLowerCase(), nombre:alias||usuario.toLowerCase(), alias:alias||null,
        estado_revision:String(getCol(r,'estado de revision')||'').trim()||null,
        estado_actual:String(getCol(r,'estado actual')||'').trim()||null,
        cargas_hist:parseIntCsv(getCol(r,'cargas')), descargas_hist:parseIntCsv(getCol(r,'descargas')),
        neto:parseNumCsv(getCol(r,'neto')), score_hist:parseNumCsv(getCol(r,'score')),
        lealtad:parseIntCsv(getCol(r,'lealtad')),
        ultima_actividad:String(getCol(r,'ultima actividad')||'').trim()||null,
        contactado_por:String(getCol(r,'ya contactados')||'').trim()||null,
        recuperado_por:String(getCol(r,'recuperados!')||'').trim()||null, pc_codigo:pc
      };
      const tel=cleanPhone(getCol(r,'telefono'));
      if(tel) reg.telefono=tel;
      registros.push(reg);
    }
    return registros;
  }
  function prepararOperaciones(text, ahora=Date.now()){
    // La declaración opcional de Excel no es un registro CSV.
    text=text.replace(/^\uFEFF/, '').replace(/^\s*sep=,[ \t]*(?:\r\n|\r|\n|$)/i, '');
    const rows=parseCSV(text), aliasSet=new Set(), retiros=[];
    if(!rows.length) return {aliases:[], retiros, totalRows:0};
    const getCol=columnas(rows[0]), desde=new Date(ahora).getTime()-24*60*60*1000;
    let totalRows=0;
    for(let i=1;i<rows.length;i++){
      const row=rows[i], alias=String(getCol(row,'alias')||'').trim().toLowerCase();
      if(!alias||alias==='donplata') continue;
      aliasSet.add(alias); totalRows++;
      const tipo=String(getCol(row,'tipo')||'').trim();
      const cantidad=parseFloat(String(getCol(row,'cantidad')).replace(/,/g,'.')||'0');
      const fecha=getCol(row,'fecha');
      if(tipo==='Deposito de un jugador'&&cantidad<0&&fecha){
        const date=formatos.parseFechaCSV(fecha);
        if(date&&date.getTime()>=desde) retiros.push({alias, fecha:date.toISOString(), monto:Math.abs(cantidad)});
      }
    }
    return {aliases:[...aliasSet], retiros, totalRows};
  }
  return Object.freeze({parseCSV, cleanPhone, parseNumCsv, parseIntCsv, prepararJugadores, prepararOperaciones});
});
// Motor puro: recibe casos/historial; no consulta DOM, red, billeteras ni almacenamiento.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).conciliacion=factory();
})(globalThis, function(){
  'use strict';
  const HORA=60*60*1000, OFFSET_AR=-3*HORA;
  function turno(ts=Date.now()){
    // Trabajar en UTC sobre la hora desplazada evita depender del TZ de Windows.
    const d=new Date(new Date(ts).getTime()+OFFSET_AR), h=d.getUTCHours();
    let franja, inicio;
    if(h>=22){ franja='22-06'; inicio=22; }
    else if(h<6){ franja='22-06'; inicio=22; d.setUTCDate(d.getUTCDate()-1); }
    else if(h<14){ franja='06-14'; inicio=6; }
    else{ franja='14-22'; inicio=14; }
    const id=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')+'_'+franja;
    d.setUTCHours(inicio,0,0,0);
    return {id, inicioMs:d.getTime()-OFFSET_AR};
  }
  function turnoId(ts){ return turno(ts).id; }
  function inicioTurnoMs(ts){ return turno(ts).inicioMs; }
  function agregar(map, key, value){
    const values=map.get(key);
    if(values) values.push(value); else map.set(key,[value]);
  }
  function match(casos, movs){
    casos=Array.isArray(casos)?casos:[]; movs=Array.isArray(movs)?movs:[];
    const falt=[], sobr=[], sobrPorMonto=new Map(), retiros=new Map(), deposPorMonto=new Map();
    for(const c of casos){
      const monto=Number(c.monto_disponible);
      if(!(monto>0)) continue;
      if(c.tipo==='FALTANTE') falt.push(c);
      if(c.tipo==='SOBRANTE'){ sobr.push(c); agregar(sobrPorMonto,monto,c); }
    }
    // Una sola pasada sobre movimientos, en vez de filtrarlos por cada caso.
    for(const mov of movs){
      const tipo=String(mov.tipo||'').toUpperCase(), monto=Math.abs(Number(mov.monto));
      if(tipo==='RETIRO'&&!mov.esTransferenciaInterna){
        const wallet=String(mov.billetera_id);
        if(!retiros.has(wallet)) retiros.set(wallet,new Map());
        agregar(retiros.get(wallet),monto,mov);
      }else if(tipo==='DEPOSITO_SR'&&!(mov.usuario&&String(mov.usuario).trim())) agregar(deposPorMonto,monto,mov);
    }
    const sugerencias=[], combinaciones=[], explicaciones=[], usadosSobr=new Set();
    for(const f of falt){
      const monto=Number(f.monto_disponible);
      const pares=(sobrPorMonto.get(monto)||[]).filter(s=>!usadosSobr.has(s.case_id)&&s.wallet_id!==f.wallet_id);
      if(pares.length){
        const s=pares[0];
        if(pares.length===1) usadosSobr.add(s.case_id);
        const candidatos=(retiros.get(String(s.wallet_id))?.get(monto)||[]).slice();
        sugerencias.push({tipo:'MOVER_RETIRO', confianza:pares.length===1&&candidatos.length===1?'EXACTA':'AMBIGUA',
          caso_faltante:f.case_id, caso_sobrante:s.case_id, pares_posibles:pares.map(p=>p.case_id), candidatos});
        continue;
      }
      // Se mantiene orden y aritmética original: combinaciones sólo sugeridas, nunca aplicadas.
      for(let i=0;i<sobr.length;i++) for(let j=i+1;j<sobr.length;j++){
        if(Number(sobr[i].monto_disponible)+Number(sobr[j].monto_disponible)===monto)
          combinaciones.push({tipo:'COMBINACION',caso:f.case_id,partes:[sobr[i].case_id,sobr[j].case_id]});
      }
    }
    for(const s of sobr){
      if(usadosSobr.has(s.case_id)) continue;
      const candidatos=deposPorMonto.get(Number(s.monto_disponible));
      if(candidatos?.length) explicaciones.push({tipo:'DEPO_EXISTENTE',caso:s.case_id,candidatos:candidatos.slice()});
    }
    return {sugerencias, combinaciones, explicaciones};
  }
  function movimientosTurno(historial, inicioMs, estados=['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA']){
    const permitidos=new Set(estados), movimientos=[];
    for(const h of historial){
      const ts=h.created_at?new Date(h.created_at).getTime():0;
      if(!(ts>=inicioMs)||!permitidos.has(String(h.estado||'').toUpperCase())) continue;
      movimientos.push({id:h.id,tipo:String(h.tipo||'').toUpperCase(),billetera_id:String(h.billetera_id||''),
        billetera_nombre:h.billetera_nombre||'',monto:Math.abs(Number(h.monto||0)),usuario:h.usuario||'',
        esTransferenciaInterna:/transfer/i.test(String(h.origen||'')+' '+String(h.notas||'')),
        chunior_movimiento_id:h.chunior_movimiento_id||null,ts,_fila:h});
    }
    return movimientos;
  }
  function indexarMovimientos(movimientos){
    const porBilletera=new Map();
    for(const mov of movimientos) agregar(porBilletera,String(mov.billetera_id),mov);
    return porBilletera;
  }
  function declaracion(saldo, valor){
    const decl=Math.abs(Number(String(valor).replace(/[^\d]/g,''))||0);
    const chunior=Number(saldo.saldo_chunior||0), dif=Math.round(decl-chunior);
    const resid=+(decl-chunior-dif).toFixed(2);
    return {wallet_id:saldo.wallet_id,nombre:saldo.nombre,chunior,decl,dif,resid};
  }
  return Object.freeze({turnoId, inicioTurnoMs, match, movimientosTurno, indexarMovimientos, declaracion});
});
// Caja negra de las operaciones contra Agentes.
//
// No adivina el error: guarda el CAMINO. No se puede escribir de antemano el cartel de una falla
// que todavía no ocurrió, así que en vez de eso se anota cada paso que se dio. Cuando algo corta,
// lo que sirve es saber hasta dónde llegó y de qué capa salió el corte.
//
// Módulo puro: no toca DOM, ni red, ni localStorage. El adaptador del panel decide qué guardar y
// dónde. Acá no entra NADA sensible: el adaptador nunca pasa argumentos de operación (una clave
// viaja en los argumentos de iniciarSesion), y por si acaso todo texto se recorta.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).cajaNegra=factory();
})(globalThis, function(){
  'use strict';

  const TOPE_PASOS  = 200;   // pasos que se recuerdan
  const TOPE_FALLAS = 20;    // fallas con su rastro, para consultar después
  const RASTRO      = 12;    // cuántos pasos se guardan con cada falla
  const MAX_TEXTO   = 300;

  function texto(v){
    if(v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : (v.message || String(v));
    return s.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO);
  }

  // De quién es la falla. NO es un catálogo de errores previstos: son las firmas de quien EMITE el
  // mensaje, que es un dato del sistema, no un pronóstico. Lo que no se reconoce queda
  // 'desconocida' a propósito — mejor eso que atribuirlo mal.
  function capaDeError(mensaje){
    const m = texto(mensaje);
    if(!m) return 'desconocida';
    if(/^Timeout: la automatizaci/i.test(m))                      return 'main';       // requests.run de main
    if(/se recarg[oó] durante la operaci/i.test(m))               return 'main';       // did-navigate de main
    if(/La ventana de Agentes se cerr/i.test(m))                  return 'main';
    if(/M[eé]todo no permitido/i.test(m))                         return 'contrato';   // panel↔preload desalineados
    if(/no se ejecut[oó]/i.test(m) && /Sesi[oó]n de Agentes/i.test(m)) return 'panel'; // cortacircuitos de la cola
    if(/super[oó] \d+s .*destrab/i.test(m))                       return 'panel';      // tope de tarea de la cola
    if(/Operaci[oó]n frenada por el operador/i.test(m))            return 'operador';
    if(/session is invalid|Se cay[oó] la sesi[oó]n de Agentes/i.test(m)) return 'agentes';
    if(/No se encontr[oó]|no mostraba|no apareci[oó]|tapado|selector/i.test(m)) return 'preload';
    return 'desconocida';
  }

  function crear(opciones){
    const o = opciones || {};
    const ahora = typeof o.ahora === 'function' ? o.ahora : Date.now;
    const topePasos  = o.topePasos  > 0 ? o.topePasos  : TOPE_PASOS;
    const topeFallas = o.topeFallas > 0 ? o.topeFallas : TOPE_FALLAS;
    let contexto = {};
    const pasos = [];
    const fallas = [];

    // El contexto es quién está operando: pc, operador, backend, versión. Va con cada falla para
    // poder mirarlo PC por PC.
    function contextoActual(nuevo){
      if(nuevo && typeof nuevo === 'object'){
        for(const k of Object.keys(nuevo)){
          const v = nuevo[k];
          if(v !== null && v !== undefined && v !== '') contexto[k] = texto(v);
        }
      }
      return Object.assign({}, contexto);
    }

    function anotar(paso){
      const p = paso || {};
      const fila = {
        t: ahora(),
        paso: texto(p.paso) || '(sin nombre)',
        capa: texto(p.capa) || 'panel',
        estado: texto(p.estado) || 'inicio'
      };
      if(p.ms !== null && p.ms !== undefined && isFinite(Number(p.ms))) fila.ms = Math.round(Number(p.ms));
      const d = texto(p.detalle);
      if(d) fila.detalle = d;
      // Lo que devuelve el preload al fallar dice DÓNDE quedó la pantalla: eso es lo que no se
      // puede reconstruir después.
      if(p.pantalla) fila.pantalla = texto(p.pantalla);
      pasos.push(fila);
      if(pasos.length > topePasos) pasos.splice(0, pasos.length - topePasos);
      return fila;
    }

    // Una falla congela el rastro del momento. Sin esto, los pasos que vienen después la tapan y
    // cuando se va a mirar ya no está el camino que importaba.
    function anotarFalla(datos){
      const d = datos || {};
      const mensaje = texto(d.mensaje);
      const falla = {
        t: ahora(),
        paso: texto(d.paso) || '(sin nombre)',
        mensaje,
        capa: texto(d.capa) || capaDeError(mensaje),
        contexto: contextoActual(),
        rastro: pasos.slice(-RASTRO)
      };
      if(d.pantalla) falla.pantalla = texto(d.pantalla);
      fallas.push(falla);
      if(fallas.length > topeFallas) fallas.splice(0, fallas.length - topeFallas);
      return falla;
    }

    function ultimoPaso(){ return pasos.length ? pasos[pasos.length - 1] : null; }

    // Una línea para leer de un vistazo: hasta dónde llegó y de quién fue.
    function resumen(falla){
      const f = falla || (fallas.length ? fallas[fallas.length - 1] : null);
      if(!f) return 'sin fallas registradas';
      const partes = ['cortó en "' + f.paso + '"', 'capa: ' + f.capa];
      const previos = f.rastro.filter(p => p.paso !== f.paso && p.estado === 'ok').slice(-2).map(p => p.paso);
      if(previos.length) partes.push('lo último que sí anduvo: ' + previos.join(' → '));
      if(f.pantalla) partes.push('pantalla: ' + f.pantalla);
      if(f.mensaje) partes.push('dijo: ' + f.mensaje);
      return partes.join(' · ');
    }

    function exportar(){
      return { contexto: contextoActual(), pasos: pasos.slice(), fallas: fallas.slice() };
    }

    function importar(guardado){
      const g = guardado || {};
      if(g.contexto && typeof g.contexto === 'object') contextoActual(g.contexto);
      if(Array.isArray(g.pasos))  pasos.push(...g.pasos.slice(-topePasos));
      if(Array.isArray(g.fallas)) fallas.push(...g.fallas.slice(-topeFallas));
    }

    function limpiar(){ pasos.length = 0; fallas.length = 0; contexto = {}; }

    return { anotar, anotarFalla, ultimoPaso, resumen, exportar, importar, limpiar,
             contexto: contextoActual,
             get pasos(){ return pasos.slice(); },
             get fallas(){ return fallas.slice(); } };
  }

  return { crear, capaDeError };
});
// Cuánto tarda de verdad un mensaje desde que el jugador aprieta el botón.
//
// No se puede saber si el sistema anda bien mirando el código: las velocidades no son siempre las
// mismas y no hay forma de decir si dos minutos son normales o son una falla. Hay que MEDIRLO, y
// tenerlo siempre a mano (Juan, 29/9).
//
// El 29/9 una consulta se veía en el panel como "11:13 a. m." y parecía de hace veinte minutos.
// Era del día ANTERIOR: 24 horas y 20 minutos. Nadie podía notarlo, ni el operador ni yo.
//
// Se miden tres tramos, y cada uno dice de quién es el problema:
//
//   toque ──preparacion──> envio ──subida──> base ──espera──> panel
//
//   preparacion  del dedo hasta que salió el pedido. Lo mide el teléfono contra SU PROPIO reloj,
//                así que es exacto aunque el teléfono esté en hora equivocada.
//   subida       del pedido hasta que quedó escrito en la base. Acá se mezclan la red y el
//                desfasaje del reloj del teléfono, y NO se pueden separar: se dice así, no se
//                inventa una corrección. Un valor absurdo delata un reloj, no una red lenta.
//   espera       lo que estuvo escrito sin que el panel lo mostrara. Las dos horas son de la base
//                y de la PC, no del teléfono: es el tramo confiable, y el que delata al panel.
//   total        la suma, solo cuando el reloj del teléfono es creíble.
//
// (Se intentó mandar el toque ya corregido contra la hora del servidor. No se puede: el navegador
// no deja leer la cabecera Date de otro dominio. Verificado ejecutándolo el 29/9.)
//
// Módulo puro: no toca DOM, ni red, ni relojes propios — el `ahora` siempre entra por parámetro,
// así las pruebas son exactas. Acá no entra el texto de ningún mensaje: solo tiempos e ids.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).latencia=factory();
})(globalThis, function(){
  'use strict';

  const TOPE = 400;
  // Cuánto puede tardar la subida antes de que deje de ser una red lenta y pase a ser un reloj
  // equivocado. Una subida negativa es imposible: el mensaje no puede llegar antes de salir. Y más
  // de cinco minutos no es red desde un teléfono: es un reloj mal puesto. En los dos casos el total
  // queda en null en vez de ensuciar el promedio con un número inventado.
  const SUBIDA_MIN_MS = -2000;        // margen para el redondeo entre relojes
  const SUBIDA_MAX_MS = 5 * 60 * 1000;

  function ms(v){
    if(v === null || v === undefined || v === '') return null;
    const t = (v instanceof Date) ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(t) && t > 0 ? t : null;
  }

  // "3 s", "2 m 10 s", "1 d 4 h". Para leer de un vistazo en la consola.
  function dur(x){
    if(x === null || x === undefined || !Number.isFinite(x)) return '?';
    const neg = x < 0 ? '-' : '';
    let s = Math.round(Math.abs(x) / 1000);
    if(s < 60) return neg + s + ' s';
    const m = Math.floor(s / 60); s = s % 60;
    if(m < 60) return neg + m + ' m' + (s ? ' ' + s + ' s' : '');
    const h = Math.floor(m / 60); const m2 = m % 60;
    if(h < 24) return neg + h + ' h' + (m2 ? ' ' + m2 + ' m' : '');
    const d = Math.floor(h / 24); const h2 = h % 24;
    return neg + d + ' d' + (h2 ? ' ' + h2 + ' h' : '');
  }

  function crear(opciones){
    const o = opciones || {};
    const tope = Number(o.tope) > 0 ? Number(o.tope) : TOPE;
    const vistos = new Set();     // para no contar dos veces: el panel repinta todo el tiempo
    let muestras = [];

    // Devuelve el tramo medido, o null si ya estaba contado o si no hay con qué medir.
    // `clave` identifica al mensaje: mientras sea la misma, se cuenta una sola vez.
    function anotar(m){
      const d = m || {};
      const clave = String(d.clave == null ? '' : d.clave);
      if(!clave || vistos.has(clave)) return null;

      const base  = ms(d.fecha);    // cuándo quedó escrito en la base (lo estampa el servidor)
      const ahora = ms(d.ahora);
      if(base === null || ahora === null) return null;

      vistos.add(clave);

      const toque = ms(d.toque);    // cuándo apretó el dedo, si el portal lo mandó
      const envio = ms(d.envio);    // cuándo salió el pedido del teléfono
      const preparacion = (toque !== null && envio !== null) ? envio - toque : null;
      const subida = envio === null ? null : base - envio;
      const relojRaro = subida !== null && (subida < SUBIDA_MIN_MS || subida > SUBIDA_MAX_MS);

      const tramo = {
        clave,
        tipo:   String(d.tipo || 'mensaje'),
        oficina: String(d.oficina || ''),
        espera: ahora - base,                       // siempre confiable
        preparacion,                                // siempre confiable (reloj contra sí mismo)
        subida: relojRaro ? null : subida,
        total:  (toque === null || relojRaro) ? null : ahora - toque,
        relojRaro,
        base, ahora
      };

      muestras.push(tramo);
      if(muestras.length > tope) muestras = muestras.slice(-tope);
      return tramo;
    }

    // Una línea por mensaje. Es lo que se lee cuando algo llegó tarde.
    function linea(t){
      if(!t) return '';
      const partes = ['[latencia]', t.tipo];
      if(t.oficina) partes.push(t.oficina);
      partes.push('espera ' + dur(t.espera));
      if(t.preparacion !== null) partes.push('preparacion ' + dur(t.preparacion));
      if(t.subida !== null) partes.push('subida ' + dur(t.subida));
      if(t.total !== null) partes.push('TOTAL ' + dur(t.total));
      else if(t.relojRaro) partes.push('(el reloj del telefono esta desfasado: sin total)');
      else partes.push('(sin hora de toque: portal viejo)');
      return partes.join(' · ');
    }

    function nums(campo){
      return muestras.map(x => x[campo]).filter(v => Number.isFinite(v));
    }
    function mediana(a){
      if(!a.length) return null;
      const s = a.slice().sort((x, y) => x - y);
      const i = Math.floor(s.length / 2);
      return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
    }

    function resumen(){
      const e = nums('espera'), t = nums('total');
      const peor = muestras.reduce((a, b) => {
        const va = a && Number.isFinite(a.total) ? a.total : (a ? a.espera : -1);
        const vb = Number.isFinite(b.total) ? b.total : b.espera;
        return vb > va ? b : a;
      }, null);
      return {
        muestras: muestras.length,
        sinToque: muestras.filter(x => x.preparacion === null).length,
        relojesRaros: muestras.filter(x => x.relojRaro).length,
        espera: { medio: mediana(e), peor: e.length ? Math.max.apply(null, e) : null },
        total:  { medio: mediana(t), peor: t.length ? Math.max.apply(null, t) : null },
        peor
      };
    }

    // La suma que va siempre a la consola.
    function texto(){
      const r = resumen();
      if(!r.muestras) return '[latencia] todavia sin mediciones';
      const l = ['[latencia] ' + r.muestras + ' mensajes medidos'];
      l.push('  espera en el panel   medio ' + dur(r.espera.medio) + ' · peor ' + dur(r.espera.peor));
      if(r.total.medio !== null)
        l.push('  total desde el toque medio ' + dur(r.total.medio) + ' · peor ' + dur(r.total.peor));
      if(r.sinToque)     l.push('  ' + r.sinToque + ' sin hora de toque (portal viejo)');
      if(r.relojesRaros) l.push('  ' + r.relojesRaros + ' con el reloj del telefono desfasado');
      if(r.peor)         l.push('  el peor: ' + linea(r.peor));
      return l.join('\n');
    }

    function reset(){ vistos.clear(); muestras = []; }

    return { anotar, linea, resumen, texto, reset,
             get tamano(){ return muestras.length; } };
  }

  return { crear, dur, SUBIDA_MIN_MS, SUBIDA_MAX_MS };
});
// Decisión: ¿qué retiros pagándose por partes hay que cerrar porque el jugador volvió a cargar?
//
// El caso que lo originó (Maria6981x, 26/9): tenía un retiro parcial abierto, se jugó las fichas
// del retiro y volvió a cargar. El parcial siguió vivo pidiendo el resto de una plata que ya no
// correspondía, y el operador lo cerró siete veces.
//
// Decisión de Juan (26/9): al entrar la carga, el parcial se cierra SOLO, sin confirmar. Queda
// pagado lo que se pagó y el resto se da de baja con motivo automático.
//
// Módulo puro: decide, no escribe. El adaptador del panel hace el cierre y el aviso.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).parciales=factory();
})(globalThis, function(){
  'use strict';

  const MOTIVO = 'CARGO_DE_NUEVO';
  const ETIQUETA = 'Volvió a cargar con el retiro a medio pagar';

  function texto(v){ return String(v == null ? '' : v).trim(); }
  function usuarioDe(s){ return texto(s && (s.USUARIO || s.USUARIO_JUGADOR)).toLowerCase(); }
  function tipoDe(s){ return texto(s && (s.TIPO || s.TIPO_SOLICITUD)).toUpperCase(); }
  function idDe(s){ return texto(s && (s.ID || s.SOLICITUD_ID || s.id)); }
  function fechaDe(s){
    const v = s && (s.FECHA_CREACION || s.created_at || s.FECHA);
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // `info` y `cerrado` los pone el panel: son las mismas funciones con las que pinta la caja, así
  // que esto no puede opinar distinto que lo que el operador ve en pantalla.
  function aCerrarPorCarga(opciones){
    const o = opciones || {};
    const solicitudes = Array.isArray(o.solicitudes) ? o.solicitudes : [];
    const info = typeof o.info === 'function' ? o.info : function(){ return null; };
    const cerrado = typeof o.cerrado === 'function' ? o.cerrado : function(){ return false; };
    const yaVistos = o.yaVistos instanceof Set ? o.yaVistos : new Set();

    // Las cargas, agrupadas por jugador y ordenadas: alcanza con la más nueva posterior al retiro.
    const cargasPorUsuario = new Map();
    for(const s of solicitudes){
      if(tipoDe(s) !== 'CARGA') continue;
      const u = usuarioDe(s); if(!u) continue;
      if(!cargasPorUsuario.has(u)) cargasPorUsuario.set(u, []);
      cargasPorUsuario.get(u).push(s);
    }

    const salida = [];
    for(const s of solicitudes){
      if(tipoDe(s) !== 'RETIRO') continue;
      const id = idDe(s); if(!id || yaVistos.has(id)) continue;
      // Un cierre deliberado (a mano o de antes) no se vuelve a tocar: es definitivo.
      if(cerrado(s)) continue;
      const estado = texto(s && s.ESTADO).toUpperCase();
      if(/RECHAZ|CANCEL/.test(estado)) continue;
      const pp = info(s);
      // Sólo los que se están pagando POR PARTES y todavía deben plata. Un retiro común no entra
      // acá, y uno ya saldado tampoco: cerrarlo no cambiaría nada y ensuciaría el historial.
      if(!pp || !pp.hasProg || !(pp.total > 0) || !(pp.restante > 0.5)) continue;

      const desde = fechaDe(s);
      // La carga tiene que ser POSTERIOR al retiro. Sin esto, una carga vieja del mismo jugador
      // cerraría el parcial apenas se abre — que es exactamente al revés de lo que se busca.
      let carga = null;
      for(const c of (cargasPorUsuario.get(usuarioDe(s)) || [])){
        const t = fechaDe(c);
        if(t <= desde) continue;
        if(!carga || t > fechaDe(carga)) carga = c;
      }
      if(!carga) continue;

      salida.push({
        id: id,
        solicitud: s,
        cargaId: idDe(carga),
        cargaMonto: Number(carga.MONTO_REAL || carga.MONTO || carga.MONTO_DECLARADO || 0) || 0,
        cargaFecha: fechaDe(carga),
        pagado: pp.pagado, total: pp.total, restante: pp.restante,
        motivo: MOTIVO, etiqueta: ETIQUETA
      });
    }
    return salida;
  }

  // Estados que el panel considera "cerrada". Copia de data.js: el llamador puede pasar la suya
  // (requests-view lo hace) y esa manda, así no pueden divergir.
  const CERRADOS = ['ACREDITADA','PAGADA','APROBADA','RECHAZADA','CANCELADA','CERRADA','FINALIZADA'];
  function cerradoPorDefecto(e){ return CERRADOS.indexOf(texto(e).toUpperCase()) >= 0; }

  // ¿Este retiro va a la caja de "pagándose por partes"?
  //
  // UN solo criterio, compartido por los dos lugares que lo usan: el render del Inicio (que arma la
  // lista y el contador) y el modal (que la muestra). Estaban escritos aparte y se contradecían.
  //
  // OJO: los que ya cobraron todo pero NADIE cerró siguen entrando a propósito. Es el único lugar
  // desde donde se los puede cerrar; sacarlos de acá los manda a tapar la lista principal, que es
  // el problema que la caja vino a resolver.
  function enProceso(s, opciones){
    const o = opciones || {};
    const info = typeof o.info === 'function' ? o.info : function(){ return null; };
    const cerrado = typeof o.cerrado === 'function' ? o.cerrado : function(){ return false; };
    const estadoCerrado = typeof o.estadoCerrado === 'function' ? o.estadoCerrado : cerradoPorDefecto;
    const sigueAbierto = typeof o.sigueAbierto === 'function' ? o.sigueAbierto : function(){ return false; };
    try{
      if(tipoDe(s) !== 'RETIRO') return false;
      if(/RECHAZ|CANCEL/.test(texto(s && s.ESTADO).toUpperCase())) return false;
      // Cerrado a mano (o solo): es definitivo, no vuelve.
      if(cerrado(s)) return false;
      // La misma regla con la que el Inicio decide si una solicitud sigue abierta. Sin esto, un
      // retiro PAGADA y cobrado entero se quedaba en la caja diciendo "falta $38.907" (D-108).
      if(estadoCerrado(s && s.ESTADO) && !sigueAbierto(s)) return false;
      const pp = info(s);
      return !!(pp && pp.hasProg && pp.total > 0);
    }catch(_e){ return false; }
  }

  // La nota que queda registrada y que ve el jugador. Sin nombres de operadores ni billeteras.
  function notaCierre(caso, money){
    const m = typeof money === 'function' ? money : function(n){ return String(n); };
    return 'Cerrado automáticamente: se registró una carga nueva (' + m(caso.cargaMonto) + ') '
         + 'con el retiro a medio pagar. Cobrado ' + m(caso.pagado) + ' de ' + m(caso.total)
         + '; quedaron sin pagar ' + m(caso.restante) + '.';
  }

  return { aCerrarPorCarga, enProceso, notaCierre, MOTIVO, ETIQUETA };
});
// Qué muestra NODO en Discord. Dos renglones, nada más:
//
//   NODO OPERATIVO            ← el nombre de la app, sale de Discord
//   3 solicitudes pendientes  ← details
//   Última carga hace 3 min   ← state
//
// Los retiros que se están pagando POR PARTES NO cuentan como pendientes: son una solicitud que ya
// se aceptó y se está trabajando, no algo esperando que alguien la agarre (Juan, 26/9).
//
// Módulo puro: decide el texto. El adaptador lo manda; main lo publica.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).presencia=factory();
})(globalThis, function(){
  'use strict';

  function texto(v){ return String(v == null ? '' : v).trim(); }
  function tipoDe(s){ return texto(s && (s.TIPO || s.TIPO_SOLICITUD)).toUpperCase(); }
  function estadoDe(s){ return texto(s && s.ESTADO).toUpperCase(); }
  function fechaDe(s){
    const t = new Date((s && (s.FECHA_CREACION || s.created_at || s.FECHA)) || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // "recién", "hace 3 min", "hace 1 h 5 min", "hace 2 d".
  function hace(ms){
    if(!(ms >= 0)) return '';
    const min = Math.floor(ms / 60000);
    if(min < 1)  return 'recién';
    if(min < 60) return 'hace ' + min + ' min';
    const h = Math.floor(min / 60), resto = min % 60;
    if(h < 24)   return 'hace ' + h + ' h' + (resto ? ' ' + resto + ' min' : '');
    const d = Math.floor(h / 24);
    return 'hace ' + d + ' d';
  }

  function armar(opciones){
    const o = opciones || {};
    const solicitudes = Array.isArray(o.solicitudes) ? o.solicitudes : [];
    const ahora = Number(o.ahora) || Date.now();
    // Mismo criterio que la caja de Parciales: no puede opinar distinto que la pantalla.
    const esParcial = typeof o.esParcial === 'function' ? o.esParcial : function(){ return false; };

    let pendientes = 0;
    let ultimaCarga = 0;
    for(const s of solicitudes){
      const tipo = tipoDe(s);
      if(tipo === 'SOPORTE') continue;                       // el soporte va al chat, no es una operación
      const estado = estadoDe(s);
      if(tipo === 'CARGA' && /ACREDITADA|APROBADA|PAGADA/.test(estado)){
        const t = fechaDe(s);
        if(t > ultimaCarga) ultimaCarga = t;
      }
      if(/RECHAZ|CANCEL|ACREDITADA|APROBADA|PAGADA|CERRAD|FINALIZ/.test(estado)) continue;
      if(esParcial(s)) continue;                             // ya aceptada y en curso: no está esperando
      pendientes++;
    }

    const details = pendientes === 0 ? 'Sin solicitudes pendientes'
      : pendientes === 1 ? '1 solicitud pendiente'
      : pendientes + ' solicitudes pendientes';

    const state = ultimaCarga > 0 ? ('Última carga ' + hace(ahora - ultimaCarga))
                                  : 'Sin cargas todavía';

    const pc = texto(o.pc);
    return {
      details: details,
      state: state,
      // Lo que se ve al pasar el mouse por el ícono.
      largeText: 'NODO' + (o.version ? ' ' + texto(o.version) : '') + (pc ? ' · ' + pc : ''),
      pendientes: pendientes,
      ultimaCarga: ultimaCarga || null
    };
  }

  // ¿Cambió algo que valga la pena publicar? Discord limita a un update cada ~15 s, y mandar lo
  // mismo una y otra vez es puro ruido.
  function distinta(a, b){
    if(!a || !b) return true;
    return a.details !== b.details || a.state !== b.state || a.largeText !== b.largeText;
  }

  return { armar, distinta, hace };
});
// Un solo lugar para los números de teléfono.
//
// Son TODOS argentinos, así que todos tienen que quedar como 549 + 10 dígitos (Juan, 27/9).
// Hasta ahora cada pantalla los dibujaba como venían: el mismo jugador se veía "1123456789" en
// una, "+54 11 2345-6789" en otra y "5491123456789" en la tercera — y buscarlo no cruzaba.
//
// Módulo puro: normaliza y formatea. No toca la base ni decide nada.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).telefono=factory();
})(globalThis, function(){
  'use strict';

  // Devuelve 549XXXXXXXXXX, o '' si no hay con qué. NUNCA inventa: si no llega a 10 dígitos
  // útiles, devuelve vacío en vez de un número a medias que después nadie puede cruzar.
  function normalizar(v){
    let d = String(v == null ? '' : v).replace(/\D/g, '');
    if(!d) return '';

    // 1) Sacar el código de país si vino, con o sin el 9.
    if(d.startsWith('549')) d = d.slice(3);
    else if(d.startsWith('54')) d = d.slice(2);

    // 2) Sacar el 0 de larga distancia (011…).
    d = d.replace(/^0+/, '');

    // 3) Sacar el 15 viejo, que va DESPUÉS del código de área: 11 15 2345-6789.
    //    Sólo si al sacarlo quedan los 10 dígitos que corresponden — si no, se deja como está,
    //    porque un 15 en otra posición puede ser parte del número de verdad.
    if(d.length === 12){
      for(const corte of [2, 3, 4]){          // códigos de área de 2, 3 o 4 dígitos
        if(d.slice(corte, corte + 2) === '15'){
          d = d.slice(0, corte) + d.slice(corte + 2);
          break;
        }
      }
    }

    // 4) Los últimos 10 son área + abonado. Es el mismo criterio con el que la base cruza los
    //    contactos de Whaticket (right(...,10)), así que lo de acá y lo de allá coinciden.
    if(d.length < 10) return '';
    d = d.slice(-10);
    return '549' + d;
  }

  // Para MOSTRAR. Mismo número, legible: +54 9 11 2345-6789.
  //
  // El agrupado es COSMÉTICO: con 10 dígitos pelados no se puede saber si el área es de 2 (11),
  // 3 (351) o 4 (2954) dígitos. Sólo se reconoce el 11, que es la mayoría; el resto se agrupa de
  // a 3. Si el corte cae mal, se ve un espacio corrido de lugar — los dígitos NUNCA cambian, que
  // es lo único que importa para llamar, cruzar o buscar.
  function mostrar(v){
    const n = normalizar(v);
    if(!n) return String(v == null ? '' : v).trim();   // no se pudo normalizar: se muestra lo que hay
    const resto = n.slice(3);                          // los 10 de área + abonado
    const area = resto.startsWith('11') ? resto.slice(0, 2) : resto.slice(0, 3);
    const sigue = resto.slice(area.length);
    return '+54 9 ' + area + ' ' + sigue.slice(0, sigue.length - 4) + '-' + sigue.slice(-4);
  }

  // Para comparar dos teléfonos escritos distinto. '' nunca es igual a '': sin número no hay
  // coincidencia que valga, y decir que sí juntaría jugadores que no tienen nada que ver.
  function mismo(a, b){
    const na = normalizar(a), nb = normalizar(b);
    return !!na && na === nb;
  }

  return { normalizar, mostrar, mismo };
});
// Un solo lugar para contestar QUIÉN ES este jugador.
//
// Juan, 6/10, por tercera vez: "SI HAY ALGO, UNA LLAMADA QUE PIDE UN NUMERO DE TELEFONO DE UN
// USUARIO, BUSCA DONDE SE DIBUJA Y PREGUNTA SI FUNCIONA Y COPIA LA DIRECCION HACIA DONDE LO VAS
// A PRECISAR, NO HAGAS DOS BUSQUEDAS DISTINTAS DEL NUMERO DE TELEFONO".
//
// Tenía razón y los números lo confirman. Medido en la base el 6/10, últimos 7 días, 29.360
// solicitudes:
//
//     la COLUMNA `telefono` está vacía en el 100% de las CARGAS, los RETIROS y los
//     CAMBIO_CLAVE, y en el 80% de las consultas.
//     el teléfono está SIEMPRE en `metadata.telefono`: 0 faltantes.
//
// Y en el padrón (usuarios_portal_vinculos, 251.257 vínculos) el teléfono está en el 100%, venga
// del CSV, del operador o del primer ingreso del portal. O sea: el dato nunca faltó. Lo que
// fallaba es que cada pantalla lo buscaba por su cuenta, con su propia cadena de `||`, y la que
// empezaba por la columna no encontraba nada.
//
// Por eso en la misma pantalla la tarjeta de arriba mostraba 2241460009 y el expediente de abajo
// decía "Teléfono: No informado" — del mismo jugador, al mismo tiempo.
//
// Acá está la cadena, una sola vez. El que precise un teléfono, un titular o saber si el jugador
// está validado, llama acá y no inventa la suya.
//
// Módulo puro: no toca la base, no decide nada, no dibuja. Se puede probar con node.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).identidad=factory();
})(globalThis, function(){
  'use strict';

  const S = (v) => String(v == null ? '' : v).trim();
  const U = (v) => S(v).toUpperCase();

  function _meta(fila){
    if(!fila) return {};
    const m = fila.metadata || fila.METADATA
           || (fila._raw && (fila._raw.metadata || fila._raw.METADATA))
           || {};
    return (m && typeof m === 'object') ? m : {};
  }

  // ── EL TELÉFONO ───────────────────────────────────────────────────────────────────────────
  // El orden sale de la medición, no de la costumbre: primero donde SIEMPRE está, después los
  // nombres que usan las distintas formas de la misma fila, y al final la columna — que existe
  // pero casi nunca tiene nada.
  //
  // `padron` es opcional: una función (usuario) → teléfono, para las filas que no lo traen de
  // ninguna manera (las del historial de operaciones, que nunca tuvieron teléfono). Así una
  // ficha abierta desde el historial muestra el mismo número que la tarjeta del chat, en vez de
  // "No informado".
  function telefono(fila, padron){
    const m = _meta(fila);
    const dela = S(m.telefono) || S(m.TELEFONO)
              || S(fila && fila.TELEFONO) || S(fila && fila.telefono)
              || S(fila && fila.telefono_canon) || S(fila && fila.TELEFONO_CANON);
    if(dela) return dela;
    // De las notas del historial, que es donde quedó en las operaciones viejas.
    const notas = S(fila && (fila.notas || fila.NOTAS));
    if(notas){
      const g = notas.match(/Tel(?:[eé]fono)?\s*[:.]?\s*([\d\s().+-]{6,})/i);
      if(g) return S(g[1]);
    }
    if(typeof padron === 'function'){
      const u = usuario(fila);
      if(u){ try{ return S(padron(u)); }catch(_e){} }
    }
    return '';
  }

  // ── EL TITULAR ────────────────────────────────────────────────────────────────────────────
  // Mismo cuento. Ojo con este: en el padrón el titular SÍ falta, y mucho — de los 1.034
  // vínculos que creó el panel en 30 días, los 1.034 quedaron sin titular. Así que acá la fila
  // manda sobre el padrón, al revés que con el teléfono.
  function titular(fila, padron){
    const m = _meta(fila);
    const dela = S(m.titular) || S(m.TITULAR)
              || S(fila && fila.TITULAR) || S(fila && fila.titular)
              || S(fila && fila.NOMBRE_COMPLETO) || S(fila && fila.nombre_completo);
    if(dela) return dela;
    const notas = S(fila && (fila.notas || fila.NOTAS));
    if(notas){
      const g = notas.match(/Titular\s*[:.]?\s*([^·|\n]+)/i);
      if(g) return S(g[1]);
    }
    if(typeof padron === 'function'){
      const u = usuario(fila);
      if(u){ try{ return S(padron(u)); }catch(_e){} }
    }
    return '';
  }

  function usuario(fila){
    if(!fila) return '';
    return S(fila.USUARIO) || S(fila.usuario) || S(fila.USUARIO_JUGADOR) || S(fila.emisor)
        || S(_meta(fila).usuario);
  }

  // ── DE QUÉ TABLA ES EL NÚMERO DE ESTA FILA ────────────────────────────────────────────────
  // `landing_solicitudes` y `historial_ops` numeran por separado y las dos ya van por el
  // 300.000: cualquier número existe en las dos, apuntando a jugadores distintos. Mezclarlos
  // abría la ficha de otra persona (4/10). Acá quedan separados a propósito.
  function numeros(fila){
    if(!fila) return { solicitudId:'', historialId:'' };
    const esSolicitud = U(fila._fuente) === 'SOLICITUD';
    const sol  = S(fila.solicitud_id) || S(fila.SOLICITUD_ID) || S(fila.solicitudId)
              || (esSolicitud ? S(fila.ID) || S(fila.id) : '');
    const hist = S(fila.historial_id) || S(fila.historialId)
              || (!esSolicitud && !U(fila.ORIGEN).startsWith('PORTAL_V') ? (S(fila.id) || S(fila.ID)) : '');
    return { solicitudId: sol, historialId: hist };
  }

  function _deNotas(fila, re){
    const notas = S(fila && (fila.notas || fila.NOTAS));
    if(!notas) return "";
    const g = notas.match(re);
    return g ? S(g[1]) : "";
  }

  // ── LA CUENTA DE ESTA OPERACIÓN ───────────────────────────────────────────────────────────
  // Juan, 6/10: "podemos copiar facilmente el usuario, de lo cual ya casi no nos sirve para
  // nada pero no podemos copiar facilmente el cbu u el alias".
  //
  // Son DOS cosas distintas y no se mezclan, por eso cada una sale rotulada:
  //
  //   RETIRO → la cuenta DEL JUGADOR. Es lo que el operador pega en el banco para pagarle.
  //   CARGA  → la cuenta NUESTRA. Es a la que el jugador dice haber transferido, y la que hay
  //            que contestarle cuando pregunta "¿a qué alias mandé?".
  //
  // Copiar la que no era sería pagarle a la cuenta equivocada, así que el rótulo no es adorno.
  function destino(fila){
    if(!fila) return null;
    const m = _meta(fila);
    const tipo = U(fila.tipo || fila.TIPO || fila.TIPO_SOLICITUD);
    if(tipo === "RETIRO"){
      const v = S(m.destino) || S(m.cbu)
             || S(fila.DESTINO) || S(fila.destino) || S(fila.CBU) || S(fila.cbu)
             || _deNotas(fila, /CBU\/?\s*C?V?U?\s*[:.]?\s*([^·|\n]+)/i)
             || _deNotas(fila, /Destino\s*[:.]?\s*([^·|\n]+)/i);
      return v ? { valor:v, etiqueta:"CBU", de:"jugador",
                   ayuda:"CBU/alias del jugador — es a donde hay que pagarle" } : null;
    }
    const v = S(m.billetera_alias) || S(m.billetera_cbu)
           || S(fila.BILLETERA_ALIAS) || S(fila.BILLETERA_CBU)
           || _deNotas(fila, /Destino\s*[:.]?\s*([^·|\n]+)/i);
    return v ? { valor:v, etiqueta:"Alias", de:"nuestra",
                 ayuda:"La cuenta nuestra a la que transfirió" } : null;
  }

  // ── ¿ESTÁ VALIDADO? ───────────────────────────────────────────────────────────────────────
  // El veredicto ya existe y está guardado: usuarios_portal_vinculos.estado_vinculo.
  // Al 6/10: 251.257 VINCULADO, 328 DUPLICADO, 121 PENDIENTE.
  //
  // La tarjeta de cotejo del chat lo recibe de panel_crm_vinculos_buscar y lo tiraba a la
  // basura: por eso ofrecía "usar gracieeeela228" y "usar grcieeela228" cuando la base ya tenía
  // esas dos marcadas como DUPLICADO y a gracieeela228 como VINCULADO. El operador veía tres
  // cuentas iguales y tenía que decidir sin información, cuando la decisión ya estaba tomada.
  //
  //   VINCULADO  → validado. Ve el CBU. No hay que volver a validarlo.
  //   DUPLICADO  → ya se resolvió que no es la cuenta buena. No se ofrece.
  //   PENDIENTE  → escribió y nadie lo cotejó todavía. ESTE es el que hay que validar.
  //   (vacío)    → no está en el padrón.
  function veredicto(estadoVinculo){
    const e = U(estadoVinculo);
    if(e === 'VINCULADO') return { estado:'VINCULADO', validado:true,  ofrecer:true,
                                   etiqueta:'validado',      detalle:'ya está validado · ve el CBU',       color:'#22c55e' };
    if(e === 'DUPLICADO') return { estado:'DUPLICADO', validado:false, ofrecer:false,
                                   etiqueta:'duplicado',     detalle:'ya se resolvió que no es esta',      color:'#8b949e' };
    if(e === 'PENDIENTE') return { estado:'PENDIENTE', validado:false, ofrecer:true,
                                   etiqueta:'sin validar',   detalle:'escribió y nadie lo cotejó todavía', color:'#e3b341' };
    return { estado:'', validado:false, ofrecer:true,
             etiqueta:'sin validar', detalle:'no figura en el padrón', color:'#e3b341' };
  }

  // ── ¿HAY QUE VOLVER A VALIDARLO? ──────────────────────────────────────────────────────────
  // Juan, 6/10: "si esta validado hay que guardarlo como validado y si vuelve con esa
  // informacion tiene que prevalecer esa informacion... la unica razon por la cual deberia
  // volver permitir a validar denuevo es si al hacer la validacion en primer lugar con los datos
  // guardados en el servidor si y unicamente si el agente no encuentra el usuario".
  //
  // O sea: lo guardado manda. Revalidar sólo si con esos datos el agente no encuentra la cuenta.
  // Cada revalidación de más es una cuenta nueva en el padrón, y de ahí salen los "lo comparten
  // 3 cuentas" que después hay que desenredar a mano.
  function hayQueValidar(estadoVinculo, agenteEncontro){
    const v = veredicto(estadoVinculo);
    if(!v.validado) return true;                 // PENDIENTE, DUPLICADO o sin padrón
    if(agenteEncontro === false) return true;    // estaba validado pero la cuenta ya no existe
    return false;                                // validado y la cuenta existe: no se toca
  }

  return { telefono, titular, usuario, numeros, destino, veredicto, hayQueValidar };
});
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoRefresh = factory();
})(globalThis, function(){
  'use strict';

  // Sólo lecturas: agrupa ráfagas y garantiza una lectura final si llegó un evento
  // durante una petición. Nunca usar para acciones monetarias ni escrituras.
  function create(tasks, { timers = globalThis, delay = 80, onError = () => {} } = {}) {
    const entries = new Map();
    let disposed = false;
    for(const [name, task] of Object.entries(tasks)) {
      entries.set(name, { task, timer: null, running: false, dirty: false });
    }
    // `request` devuelve una promesa con el RESULTADO de la lectura. Hace falta para saber si la
    // lectura entró de verdad: cargarSolicitudesPortal no tira excepción cuando falla, devuelve
    // {error}. Sin esto, el que avisó no tiene forma de distinguir "ya está" de "no bajó nada", y
    // daba por consumido un aviso que nunca se llegó a leer (Juan, 3/10).
    function request(name) {
      const entry = entries.get(name);
      if(!entry) throw new Error('Lectura desconocida: ' + name);
      if(disposed) return Promise.resolve(undefined);
      entry.dirty = true;
      if(!entry.waiters) entry.waiters = [];
      const esperar = new Promise(resolve => entry.waiters.push(resolve));
      if(entry.running || entry.timer !== null) return esperar;
      entry.timer = timers.setTimeout(() => {
        entry.timer = null;
        if(disposed) return;
        entry.dirty = false;
        entry.running = true;
        // Los que estaban esperando ANTES de arrancar se resuelven con esta vuelta; los que
        // lleguen mientras corre quedan para la siguiente.
        const avisar = entry.waiters;
        entry.waiters = [];
        Promise.resolve().then(() => {
          if(!disposed) return entry.task();
        }).then(valor => {
          avisar.forEach(resolve => { try { resolve(valor); } catch(_) {} });
        }).catch(error => {
          try { onError(error, name); } catch(_) {}
          avisar.forEach(resolve => { try { resolve(undefined); } catch(_) {} });
        }).finally(() => {
          entry.running = false;
          if(entry.dirty && !disposed) request(name);
        });
      }, delay);
      return esperar;
    }
    function dispose() {
      disposed = true;
      for(const entry of entries.values()) {
        if(entry.timer !== null) timers.clearTimeout(entry.timer);
        entry.timer = null;
        entry.dirty = false;
        // Nadie se queda esperando una promesa que ya no va a resolver nunca.
        if(entry.waiters) {
          entry.waiters.forEach(resolve => { try { resolve(undefined); } catch(_) {} });
          entry.waiters = [];
        }
      }
    }
    return { request, dispose };
  }
  return { create };
});
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory(require('./refresh-coordinator.js'));
  else root.NodoRealtime = factory(root.NodoRefresh);
})(globalThis, function(Refresh){
  'use strict';

  function create({ client, getOffice, getAliases, hasOpenChat, refresh, senal,
    notify = () => {}, playSound = () => {}, logger = console, timers = globalThis }) {
    const channels = new Map();
    const intervals = [];
    let stopped = false;
    let ultimaSenal = null;   // la última foto de la bandeja; mientras no cambie, no se baja nada
    const reads = Refresh.create({
      requests: refresh.requests, wallets: refresh.wallets, chats: refresh.chats,
      conversation: () => { if(hasOpenChat()) return refresh.conversation(); }
    }, { timers, onError: (error, name) => logger.warn('[RT] lectura ' + name, error) });

    function isMyOffice(pc) {
      const eventPc = String(pc || '').toUpperCase().trim();
      if(!eventPc) return true;
      let aliases;
      try { aliases = getAliases(); } catch(_) { aliases = [getOffice()]; }
      aliases = (aliases || []).map(x => String(x).toUpperCase().trim()).filter(Boolean);
      return !aliases.length || aliases.includes(eventPc);
    }
    function remove(key) {
      const channel = channels.get(key);
      channels.delete(key);
      if(channel) {
        try { Promise.resolve(client.removeChannel(channel)).catch(error => logger.warn('[RT] cierre', error)); }
        catch(error) { logger.warn('[RT] cierre', error); }
      }
    }
    function subscribe(key, name, type, filter, handler) {
      if(stopped || !client) return;
      remove(key);
      try {
        // Un callback de una suscripción reemplazada no debe disparar nuevas lecturas.
        const channel = client.channel(name);
        channels.set(key, channel);
        channel.on(type, filter, payload => {
          if(!stopped && channels.get(key) === channel) handler(payload);
        }).subscribe();
      } catch(error) { logger.warn('[RT] suscripción ' + name, error); }
    }
    function inserted() { notify('🔔 Nueva solicitud'); playSound('solicitud'); }
    function subscribeRequests() {
      subscribe('requests', 'solicitudes_' + getOffice(), 'postgres_changes', {
        event: '*', schema: 'public', table: 'solicitudes', filter: 'pc_codigo=eq.' + getOffice()
      }, payload => {
        reads.request('requests');
        if(payload.eventType === 'INSERT') inserted();
      });
    }
    function subscribeRequestBroadcast() {
      subscribe('requestBroadcast', 'nodo:solicitudes', 'broadcast', { event: 'cambio' }, msg => {
        const payload = msg && msg.payload;
        if(!isMyOffice(payload && payload.pc)) return;
        reads.request('requests');
        if(payload && String(payload.op) === 'INSERT') inserted();
      });
    }
    function subscribeChatBroadcast() {
      subscribe('chatBroadcast', 'nodo:chat', 'broadcast', { event: 'cambio' }, msg => {
        if(!isMyOffice(msg && msg.payload && msg.payload.pc)) return;
        reads.request('chats');
        if(hasOpenChat()) reads.request('conversation');
      });
    }
    function startPolling() {
      if(stopped || intervals.length) return;
      intervals.push(timers.setInterval(() => reads.request('requests'), 60000));
      intervals.push(timers.setInterval(() => reads.request('wallets'), 20000));
      intervals.push(timers.setInterval(() => {
        if(hasOpenChat()) reads.request('conversation');
      }, 3500));
      // La lista de chats era la única sin reloj propio: se repintaba sólo cuando llegaba un aviso
      // por el canal `nodo:chat`. Si ese aviso no salía, la bandeja de consultas quedaba con el
      // orden y los contadores de hacía rato aunque los datos ya estuvieran en memoria (Juan, 2/10).
      // Repintar es barato: sale de lo que ya se trajo, no pide nada al servidor.
      intervals.push(timers.setInterval(() => reads.request('chats'), 20000));

      // Una solicitud tardaba hasta 60 s en aparecer, y aparecía de golpe. Bajar ese reloj a 10 s
      // costaría ~700 MB por turno en la oficina más cargada —más de lo que acabamos de sacar—
      // porque se traería la bandeja entera cada vez. Así que cada 10 s se pregunta sólo SI CAMBIÓ
      // algo (125 bytes, 24 ms) y la lista se baja únicamente cuando hay novedad de verdad.
      // El reloj de 60 s queda igual, como red de seguridad por si la señal falla (Juan, 2/10).
      if(typeof senal === 'function'){
        intervals.push(timers.setInterval(async () => {
          try{
            const ahora = await senal();
            if(!ahora) return;
            if(ultimaSenal !== null && ahora === ultimaSenal) return;   // nada nuevo: no se baja nada
            if(ultimaSenal === null){ ultimaSenal = ahora; return; }    // primera foto: sólo se guarda
            // La señal se da por consumida SÓLO si la bandeja entró de verdad.
            //
            // Antes se marcaba acá mismo, antes de leer. Si la lectura fallaba —y en P4 la bandeja
            // pesa 382 kB y tarda entre 187 y 1.104 ms, así que falla— esa novedad quedaba
            // consumida: en el tick siguiente la señal ya era igual a la guardada, no se pedía
            // nada, y la solicitud no aparecía hasta que pegara el reintento (8 s, 16 s, 32 s,
            // 60 s) o el reloj de 60 s. Con dos o tres entrando juntas, se acumulaban todas y
            // caían de golpe. Es lo que reportó Juan el 3/10.
            //
            // Ahora, si no entró, la señal queda sin consumir y se vuelve a pedir en el próximo
            // tick: la espera máxima pasa a ser 10 s, pase lo que pase con el reintento.
            // Se retiene SÓLO cuando se sabe que falló. Cualquier otra forma de respuesta se
            // trata como antes: el objetivo es cambiar el caso del error, no inventar reintentos
            // donde no los había. `skipped` es "había otra lectura en curso", no "ya la tengo".
            const r = await reads.request('requests');
            const fallo = !!(r && (r.error || r.skipped));
            if(!fallo) ultimaSenal = ahora;
          }catch(_e){}
        }, 10000));
      }
    }
    function stop() {
      if(stopped) return;
      stopped = true;
      reads.dispose();
      intervals.forEach(id => timers.clearInterval(id));
      intervals.length = 0;
      for(const key of channels.keys()) remove(key);
    }
    return { isMyOffice, subscribeRequests, subscribeRequestBroadcast,
      subscribeChatBroadcast, startPolling, stop };
  }
  return { create };
});
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoChatMetrics = factory();
})(globalThis, function(){
  'use strict';
  const upper = value => String(value ?? '').trim().toUpperCase();
  const date = value => { const d = new Date(value || 0); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); };
  function chatKey(ticket) {
    const id = ticket?.masterId || ticket?.solicitudId || ticket?.usuario || 'chat';
    return upper(ticket?.usuario || 'usuario') + '_' + String(id).replace(/[^A-Z0-9]/gi, '_');
  }
  function snapshot(tickets, marks) {
    const byUser = new Map(), unread = new Map(), signatures = [];
    let total = 0, accepted = 0;
    for(const ticket of tickets) {
      const name = upper(ticket.usuario);
      if(!byUser.has(name)) byUser.set(name, ticket);
      let count = 0;
      if(ticket.accepted) {
        accepted++;
        const readAt = date(marks[chatKey(ticket)]);
        for(const message of ticket.thread || []) {
          if(upper(message.origen) === 'USUARIO' && date(message.fecha) > readAt) count++;
        }
      }
      unread.set(ticket, count);
      total += count;
      const thread = ticket.thread || [], last = thread[thread.length - 1] || {};
      signatures.push([ticket.usuario, ticket.accepted ? 'A' : 'E', ticket.masterId || ticket.solicitudId || '',
        thread.length, count, last.fecha || '', last.mensaje || ''].join(':'));
    }
    return { byUser, unread, total, accepted, signature: signatures.join('||') };
  }
  function create({ getTickets, readMarks, now = Date.now }) {
    let lastTotal = null, lastAt = 0;
    function read() { return snapshot(getTickets() || [], readMarks() || {}); }
    function stableTotal(real) {
      const current = now();
      if(lastTotal > 0 && real === 0 && current - lastAt < 2200) return lastTotal;
      if(real !== lastTotal) { lastTotal = real; lastAt = current; }
      return real;
    }
    return { read, stableTotal };
  }
  return { create, snapshot, chatKey };
});
