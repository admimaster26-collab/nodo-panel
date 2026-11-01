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

  // ── Solicitudes TOMADAS ─────────────────────────────────────────────────────────────────────
  // Tomar una solicitud (carga o retiro) la saca de la lista de pendientes y la manda al mismo
  // apartado donde están los retiros pagándose por partes: las dos cosas son lo mismo para el
  // operador, trabajo que ya alguien agarró. La lista principal queda sólo con lo que NADIE tocó,
  // que es lo que hace falta ver cuando entran tres o cinco juntas (Juan, 25/10).
  //
  // Tomar → EN_REVISION; los pagos por partes la llevan a EN_PROCESO. Las dos significan "ya la tiene
  // alguien".
  const TOMADA = /^(EN_REVISION|EN_PROCESO)$/;

  // Sólo cargas y retiros: el cambio de clave no se "toma" y el soporte va al chat.
  function tomada(s){
    const t = tipoDe(s);
    if(t !== 'CARGA' && t !== 'RETIRO') return false;
    return TOMADA.test(texto(s && s.ESTADO).toUpperCase());
  }

  // Reparte lo abierto en tres lugares: pagándose por partes, tomadas, y sin tocar.
  //
  // Lo que está en la COLA DE CARGA se queda en la lista principal aunque esté tomada: ahí es donde
  // la tarjeta dice "2º en la cola" / "Cargando…", y si desapareciera de ahí el operador apretaría
  // de nuevo creyendo que el clic se perdió.
  //
  // Ante la duda, la lista principal: un callback que falla NO puede esconder una solicitud.
  function repartirAbiertas(abiertas, opciones){
    const o = opciones || {};
    // Un criterio que no se pasó es "no" (no hay parciales ni cola). Un criterio que se pasó y FALLÓ
    // es "no sé": ahí gana la lista principal, que es donde nada se pierde de vista.
    const preguntar = function(fn, s){
      if(typeof fn !== 'function') return { dudoso: false, si: false };
      try{ return { dudoso: false, si: !!fn(s) }; }catch(_e){ return { dudoso: true, si: false }; }
    };
    const parciales = [], tomadas = [], pendientes = [];
    for(const s of (Array.isArray(abiertas) ? abiertas : [])){
      const p = preguntar(o.esParcial, s);
      if(p.dudoso){ pendientes.push(s); continue; }
      if(p.si){ parciales.push(s); continue; }
      if(tomada(s)){
        const c = preguntar(o.enCola, s);
        if(!c.dudoso && !c.si){ tomadas.push(s); continue; }
      }
      pendientes.push(s);
    }
    return { parciales: parciales, tomadas: tomadas, pendientes: pendientes };
  }

  // La nota que queda registrada y que ve el jugador. Sin nombres de operadores ni billeteras.
  function notaCierre(caso, money){
    const m = typeof money === 'function' ? money : function(n){ return String(n); };
    return 'Cerrado automáticamente: se registró una carga nueva (' + m(caso.cargaMonto) + ') '
         + 'con el retiro a medio pagar. Cobrado ' + m(caso.pagado) + ' de ' + m(caso.total)
         + '; quedaron sin pagar ' + m(caso.restante) + '.';
  }

  return { aCerrarPorCarga, enProceso, tomada, repartirAbiertas, notaCierre, MOTIVO, ETIQUETA };
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
  let scope = '', epoch = 0, mode = 'pending', legacyReason = '', identityCapable = false, negotiation = null;
  const entries = new Map();
  function fail(code){ const error = new Error(code); error.code = code; return error; }
  function sync(){
    if(scope !== pc()){
      scope = pc(); epoch++; mode = 'pending'; legacyReason = ''; identityCapable = false; negotiation = null; entries.clear();
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
    if(mode === 'beta') return true;
    if(mode === 'legacy' && legacyReason !== 'config') return false;
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
  function invalidate(){ epoch++; entries.clear(); negotiation = null; mode = 'pending'; legacyReason = ''; identityCapable = false; }
  return Object.freeze({ready,load,snapshot,rendered,invalidate});
});
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
// GENERADO por scripts/auditar-desconexiones.cjs --embed. No editar a mano.
// Lo consume NodoSalud.show() para que el semáforo muestre también las desconexiones estáticas.
(function(root){ root.NodoDesconexiones = Object.freeze({"contrato":"nodo.desconexiones.v1","fuente_hash":"d0a7baca3c1c4e24","resumen":{"DEFINICION_PISADA":27,"SIN_REFERENCIAS":28,"LLAMADA_SILENCIOSA":1,"PUENTE_SIN_USO":1,"STORAGE_SOLO_LEIDO":8,"STORAGE_SOLO_ESCRITO":2,"SALUD_RAMA_SOLO_LOCAL":1,"SALUD_RAMA_SIN_USO":1,"LECTOR_EN_CODIGO_MUERTO":23,"CIRCUITO_SIN_SALUD":1},"circuitos":{"total":199,"activos":176,"en_codigo_muerto":23,"observados_directo":46,"observados_compuerta":129,"observados":175,"sin_salud":1},"bitacora":{"total":138,"abiertos":90,"detectados":4},"hallazgos":[["DEFINICION_PISADA","MEDIA","cargarJugadores","renderer/core/jugadores-importacion.js",304],["DEFINICION_PISADA","MEDIA","cargarBilleteras","renderer/core/vistas-y-billeteras.js",112],["DEFINICION_PISADA","MEDIA","cargarChats","renderer/core/vistas-y-billeteras.js",294],["DEFINICION_PISADA","MEDIA","cargarChats","renderer/extensions/portal-chat-unificado.js",82],["DEFINICION_PISADA","MEDIA","cargarChats","renderer/chat/chat-local.js",320],["DEFINICION_PISADA","ALTA","verRetirosParciales","renderer/core/archivo-historial.js",210],["DEFINICION_PISADA","MEDIA","filtrarHistorial","renderer/core/historial-operaciones.js",448],["DEFINICION_PISADA","MEDIA","seleccionarBilletera","renderer/core/lotes-y-solicitudes.js",635],["DEFINICION_PISADA","MEDIA","seleccionarBilletera","renderer/extensions/portal-chat-unificado.js",23],["DEFINICION_PISADA","MEDIA","seleccionarBilletera","renderer/extensions/portal-chat-unificado.js",258],["DEFINICION_PISADA","MEDIA","renderChatList","renderer/core/chat.js",29],["DEFINICION_PISADA","MEDIA","cargarChatActual","renderer/core/chat.js",53],["DEFINICION_PISADA","MEDIA","cargarChatActual","renderer/extensions/portal-chat-unificado.js",112],["DEFINICION_PISADA","MEDIA","cargarChatActual","renderer/extensions/portal-chat-unificado.js",294],["DEFINICION_PISADA","MEDIA","cargarChatActual","renderer/chat/chat-local.js",321],["DEFINICION_PISADA","MEDIA","enviarChat","renderer/core/chat.js",121],["DEFINICION_PISADA","MEDIA","enviarChat","renderer/extensions/portal-chat-unificado.js",142],["DEFINICION_PISADA","MEDIA","enviarChat","renderer/extensions/portal-chat-unificado.js",340],["DEFINICION_PISADA","MEDIA","enviarChat","renderer/chat/chat-local.js",322],["DEFINICION_PISADA","MEDIA","enviarChat","renderer/chat/chat-actualizar-solicitud.js",90],["DEFINICION_PISADA","MEDIA","cancelarVerificacionPanel","renderer/core/navegacion-y-verificaciones.js",82],["DEFINICION_PISADA","MEDIA","reintentarVerificacion","renderer/core/navegacion-y-verificaciones.js",87],["DEFINICION_PISADA","MEDIA","v15AbrirChatCompacto","renderer/extensions/portal-bridge.js",153],["DEFINICION_PISADA","ALTA","v15AbrirChatCompacto","renderer/extensions/portal-chat-unificado.js",167],["DEFINICION_PISADA","MEDIA","wq2SetTab","renderer/chat/chat-local.js",43],["DEFINICION_PISADA","MEDIA","cerrarConsultaWq2","renderer/chat/chat-local.js",282],["DEFINICION_PISADA","MEDIA","nodoValidacionScope","renderer/extensions/validacion-scope.js",216],["LLAMADA_SILENCIOSA","ALTA","ejecutarOperacion","renderer/extensions/piloto.js",31],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:nodo_panel_data_secret","renderer/core/configuracion-y-estado.js",21],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:nodo_push_api_url","renderer/core/configuracion-y-estado.js",26],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:nodo_push_secret","renderer/core/configuracion-y-estado.js",27],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:nodo_plataforma_url","renderer/core/perfil-jugador.js",8],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:panel_v154_landing_pc","renderer/portal/data.js",54],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:panel_pc_operativa","renderer/extensions/billeteras-oficina.js",64],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:nodo_gemini_api_key","renderer/chat/chat-solicitud-preview.js",26],["STORAGE_SOLO_LEIDO","MEDIA","localStorage:nodo_portal_base_url","renderer/extensions/jugadores-crm.js",108],["SALUD_RAMA_SOLO_LOCAL","ALTA","PERSISTENCIA","renderer/runtime/integration-health.js",6],["SALUD_RAMA_SIN_USO","MEDIA","PERSISTENCIA","renderer/runtime/integration-health.js",6],["LECTOR_EN_CODIGO_MUERTO","MEDIA","crearUsuarioPanel","renderer/core/jugadores-importacion.js",53],["LECTOR_EN_CODIGO_MUERTO","MEDIA","importarOperacionesCSV","renderer/core/jugadores-importacion.js",129],["LECTOR_EN_CODIGO_MUERTO","MEDIA","importarCSV","renderer/core/jugadores-importacion.js",240],["LECTOR_EN_CODIGO_MUERTO","MEDIA","cargarJugadores","renderer/core/jugadores-importacion.js",313],["LECTOR_EN_CODIGO_MUERTO","MEDIA","apiPostNoCors","renderer/core/api-y-solicitudes.js",89],["LECTOR_EN_CODIGO_MUERTO","MEDIA","cargarBilleteras","renderer/core/vistas-y-billeteras.js",162],["LECTOR_EN_CODIGO_MUERTO","MEDIA","cargarChats","renderer/core/vistas-y-billeteras.js",307],["LECTOR_EN_CODIGO_MUERTO","MEDIA","abrirEditarBilletera","renderer/core/lotes-y-solicitudes.js",316],["LECTOR_EN_CODIGO_MUERTO","MEDIA","abrirNuevaBilletera","renderer/core/lotes-y-solicitudes.js",343],["LECTOR_EN_CODIGO_MUERTO","MEDIA","seleccionarBilletera","renderer/core/lotes-y-solicitudes.js",655],["LECTOR_EN_CODIGO_MUERTO","MEDIA","cargarChatActual","renderer/core/chat.js",56],["LECTOR_EN_CODIGO_MUERTO","MEDIA","enviarChat","renderer/core/chat.js",130],["CIRCUITO_SIN_SALUD","MEDIA","_cnFalla","renderer/core/caja-negra-panel.js",78],["LECTOR_EN_CODIGO_MUERTO","MEDIA","testBuscar","renderer/core/agentes-cola-y-sesion.js",464],["LECTOR_EN_CODIGO_MUERTO","MEDIA","testCargar","renderer/core/agentes-cola-y-sesion.js",482],["LECTOR_EN_CODIGO_MUERTO","MEDIA","testRetirar","renderer/core/agentes-cola-y-sesion.js",509],["LECTOR_EN_CODIGO_MUERTO","MEDIA","cancelarVerificacionPanel","renderer/core/navegacion-y-verificaciones.js",83],["LECTOR_EN_CODIGO_MUERTO","MEDIA","reintentarVerificacion","renderer/core/navegacion-y-verificaciones.js",88],["LECTOR_EN_CODIGO_MUERTO","MEDIA","chuniorCerrarSesion","renderer/core/chunior-sesion-y-billeteras.js",61],["LECTOR_EN_CODIGO_MUERTO","MEDIA","chuniorNav","renderer/core/chunior-recuperacion-y-transferencias.js",674],["LECTOR_EN_CODIGO_MUERTO","MEDIA","seleccionarBilletera","renderer/extensions/portal-chat-unificado.js",28],["LECTOR_EN_CODIGO_MUERTO","MEDIA","cargarChats","renderer/extensions/portal-chat-unificado.js",85],["LECTOR_EN_CODIGO_MUERTO","MEDIA","cargarChatActual","renderer/extensions/portal-chat-unificado.js",115],["LECTOR_EN_CODIGO_MUERTO","MEDIA","enviarChat","renderer/extensions/portal-chat-unificado.js",148]]}); })(globalThis);
(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports={create:factory};
  else root.NodoSalud=factory(root);
})(globalThis,function(root){
  'use strict';
  const integrations=new Set('CHAT PORTAL TELEMETRIA CAPACIDADES BANDEJA IDENTIDAD PERSISTENCIA HISTORIAL BILLETERAS RETIROS VALIDACION WORKERS AUTOMATISMOS CONCILIACION NEXO ADMIN CONEXION'.split(' '));
  const stages=new Set(['ALIVE','CONNECTED','DATA','EFFECT','RENDER']);
  // Ramas que el servidor todavía no acepta: se ven en esta PC pero no viajan. Una sola muestra
  // rechazada tira el lote entero, y el 1/11 eso dejó mudo a todo el semáforo.
  const SOLO_LOCAL=new Set(['PERSISTENCIA']);
  const states=new Set(['OK','DEGRADED','ERROR','IDLE','UNKNOWN']);
  const FRESH_MS=300000;
  const samples=new Map(),dirty=new Map(),attempts=new Map();
  let scope='',epoch=0,flight=null,lastFlush=0,remote=[],remoteReadAt=null,remoteServerAt=null,
    transport='UNKNOWN',transportCode='',transportAt=null;
  const pc=()=>String(root.pcOperativa||root.__pcCodigo||'').trim().toUpperCase();
  function context(){
    if(scope!==pc()){
      scope=pc();epoch++;samples.clear();dirty.clear();attempts.clear();remote=[];flight=null;lastFlush=0;
      transport='UNKNOWN';transportCode='';transportAt=null;remoteReadAt=null;remoteServerAt=null;
    }
    return scope;
  }
  function record(integration,stage,state,details={}){
    if(!context() || !integrations.has(integration) || !stages.has(stage) || !states.has(state))return false;
    const key=integration+'|'+stage,previous=samples.get(key);
    const bounded=(value,max)=>Number.isFinite(value)?Math.max(0,Math.min(max,value)):0;
    // Only codes and aggregate measurements cross the bridge. Never messages, URLs or arguments.
    const code=/^[A-Z0-9_.:-]{1,64}$/.test(details.code||'')?details.code:null;
    const sample={integration,stage,state,count:Math.min(1000000,(previous?.count||0)+1),
      errors:Math.min(1000000,(previous?.errors||0)+(state==='ERROR'||state==='DEGRADED'?1:0)),
      duration_ms:bounded(details.duration_ms,86400000),code,
      observed_at:new Date(Math.max(Date.now(),Date.parse(previous?.observed_at||'')+1||0)).toISOString()};
    samples.set(key,sample);dirty.set(key,sample);return true;
  }
  function errorCode(error){
    // Classify locally; the raw error can contain SQL, URLs, player names or tokens.
    const code=String(error?.code||'').toUpperCase(),message=String(error?.message||error||'').toLowerCase();
    if(code==='57014'||/statement timeout|canceling statement/.test(message))return 'SERVER_TIMEOUT';
    if(code==='42501'||code==='PGRST301'||/no_autorizado|permission denied|invalid.*token|unauthorized/.test(message))return 'UNAUTHORIZED';
    if(code==='PGRST202'||code==='42883')return 'RPC_MISSING';
    if(/panelapi\.rpc no disponible/.test(message))return 'CLIENT_UNAVAILABLE';
    if(/fetch failed|failed to fetch|network|econn|socket|load failed|abort|timeout/.test(message))return 'NETWORK';
    return 'RPC_FAILED';
  }
  function begin(integration){
    const office=context(),version=epoch,started=Date.now(),attempt=(attempts.get(integration)||0)+1;
    if(integrations.has(integration))attempts.set(integration,attempt);
    // Starting another operation invalidates its previous success, including a
    // render that this attempt may never reach. Errors remain unresolved until
    // that stage supplies new evidence. No invented samples for unobserved stages.
    for(const [key,previous] of samples){
      if(previous.integration!==integration || previous.stage==='ALIVE' || previous.state!=='OK')continue;
      const sample={...previous,state:'UNKNOWN',code:'AWAITING_EVIDENCE',
        observed_at:new Date(Math.max(started,Date.parse(previous.observed_at)+1)).toISOString()};
      samples.set(key,sample);dirty.set(key,sample);
    }
    // Freshness and telemetry eligibility are different: an absent office disables
    // record(), but must not cancel a valid legacy read or leave its UI loading.
    // A real context change still invalidates this attempt, including empty -> office.
    const current=()=>{context();return scope===office&&epoch===version&&attempts.get(integration)===attempt;};
    const observe=(stage,state,code)=>current()&&record(integration,stage,state,{code,duration_ms:Date.now()-started});
    // A newer request or another office must not inherit the outcome of this request.
    return Object.freeze({current,record:observe,reply(error){
      if(!error)return observe('CONNECTED','OK');
      const code=errorCode(error);
      return observe('CONNECTED',code==='NETWORK'||code==='CLIENT_UNAVAILABLE'?'ERROR':code==='RPC_FAILED'?'DEGRADED':'OK',code);
    },errorCode});
  }
  function snapshot(){
    context();const now=Date.now();
    const rows=[...samples.values()].map(s=>{
      const observed=Date.parse(s.observed_at),clockSkew=!Number.isFinite(observed)||observed>now+60000;
      const expired=now-observed>FRESH_MS;
      return {...s,reported_state:s.state,state:expired||clockSkew?'UNKNOWN':s.state,
        evidence:clockSkew?'CLOCK_SKEW':expired?'STALE':s.code==='AWAITING_EVIDENCE'?'AWAITING_EVIDENCE':'OBSERVED'};
    });
    const byStage=new Map(rows.map(r=>[r.integration+'|'+r.stage,r]));
    // This is evidence for declared branches, NOT a claim of function/circuit
    // coverage. Missing observations stay visible without producing network data.
    const coverage=[...integrations].map(integration=>({integration,
      has_samples:rows.some(r=>r.integration===integration),
      stages:[...stages].map(stage=>byStage.get(integration+'|'+stage)||
        {integration,stage,state:'UNKNOWN',reported_state:null,evidence:'NO_SAMPLE',code:null})}));
    const transportExpired=transport==='OK' && (transportAt===null || now-transportAt>FRESH_MS || now<transportAt);
    const remoteRows=remote.map(r=>{
      const received=Date.parse(r.received_at),observed=Date.parse(r.observed_at);
      const reference=remoteServerAt??remoteReadAt;
      const elapsed=remoteReadAt===null?Infinity:Math.max(0,now-remoteReadAt);
      const missing=!Number.isFinite(received)||!Number.isFinite(observed)||reference===null;
      const clockSkew=!missing&&(received>reference+60000||observed>reference+60000||now<remoteReadAt);
      const expired=!missing&&(reference-received+elapsed>FRESH_MS||reference-observed+elapsed>FRESH_MS);
      return {...r,state:missing||clockSkew||expired?'UNKNOWN':r.state,
        reported_state:r.reported_state??r.state,
        evidence:missing?'NO_TIMESTAMP':clockSkew?'CLOCK_SKEW':expired?'STALE':'OBSERVED'};
    });
    return {pc:scope,transport:transportExpired?'UNKNOWN':transport,reported_transport:transport,
      code:transportExpired?'HEALTH_TRANSPORT_STALE':transportCode,pending:dirty.size,
      rows,remote:remoteRows,coverage,coverage_scope:'DECLARED_BRANCHES_ONLY',
      branches_without_samples:coverage.filter(branch=>!branch.has_samples).map(branch=>branch.integration)};
  }
  async function flush(){
    if(!context())return null;
    if(flight)return flight;
    if(lastFlush && Date.now()-lastFlush<30000)return null;
    const version=epoch,office=scope;
    lastFlush=Date.now();
    const pending=(async()=>{
      try{
        const config=(await root.panelAPI?.getContext?.())?.beta;
        if(version!==epoch || office!==pc())return null;
        if(!config?.enabled || !config.offices?.includes(office)){transport='IDLE';return null;}
        record('TELEMETRIA','ALIVE','OK');
        const batch=[...dirty.entries()].filter(([,sample])=>!SOLO_LOCAL.has(sample.integration)).slice(0,32);
        const response=await root.panelAPI.rpc('nodo_beta_salud_v1',{p_pc_codigo:office,p_muestras:batch.map(([,s])=>s),p_build:config.build});
        if(version!==epoch || office!==pc())return null;
        let data=response?.data;
        if(typeof data==='string'){try{data=JSON.parse(data);}catch(_){data=null;}}
        if(response?.error || data?.ok!==true || data?.contract!=='nodo.beta.v1' || !Array.isArray(data.rows)){
          const code=response?.error?.code||response?.error?.message;
          throw new Error(/^BETA_[A-Z0-9_]{1,64}$/.test(code||'')?code:'BETA_HEALTH_UNCONFIRMED');
        }
        for(const [key,sample] of batch)if(dirty.get(key)===sample)dirty.delete(key);
        remote=data.rows;remoteReadAt=Date.now();
        remoteServerAt=Number.isFinite(Date.parse(data.server_time))?Date.parse(data.server_time):null;
        transport='OK';transportAt=remoteReadAt;transportCode='';return snapshot();
      }catch(e){
        if(version===epoch && office===pc()){transport='ERROR';transportCode=e.message?.startsWith('BETA_')?e.message:'BETA_HEALTH_FAILED';}
        return null;
      }
    })();
    flight=pending;
    try{return await pending;}finally{if(flight===pending)flight=null;}
  }
  // Lo que se le muestra a una persona: qué parte del sistema, si anda y qué se cortó, en castellano.
  // El snapshot sigue teniendo el detalle técnico para el servidor y las pruebas. Telemetría y
  // capacidades son internas: si fallan se ve como un solo aviso, no como dos filas que nadie entiende.
  const NOMBRES={CHAT:'Chat',PORTAL:'Portal',BANDEJA:'Solicitudes',IDENTIDAD:'Perfil de jugadores',PERSISTENCIA:'Guardado de datos',
    HISTORIAL:'Historial',BILLETERAS:'Billeteras',RETIROS:'Lectura de fichas',VALIDACION:'Validaciones',WORKERS:'Tareas de fondo',
    AUTOMATISMOS:'Automatismos',CONCILIACION:'Control de fichas',NEXO:'Nexo',ADMIN:'Administración',CONEXION:'Conexión'};
  const MOTIVOS={SERVER_TIMEOUT:'El servidor tardó demasiado',UNAUTHORIZED:'Sin permiso',RPC_MISSING:'Falta actualizar el servidor',
    CLIENT_UNAVAILABLE:'La aplicación no está conectada',NETWORK:'Sin conexión',FICHAS_SIN_SESION:'Se cayó la sesión de Agentes',
    FICHAS_ILEGIBLES:'El casino no devolvió el saldo',FICHAS_SIN_RESPUESTA:'El casino no contestó',AGENTE_OCUPADO:'El agente está ocupado',
    BILLETERAS_LOAD_FAILED:'No se pudieron leer las billeteras',BILLETERA_NO_MARCADA:'No se pudo cambiar la billetera',
    BILLETERAS_SIN_SINCRONIZAR:'No se pudo sincronizar con Chunior'};
  const motivo=code=>MOTIVOS[code]||'No respondió bien';
  function resumen(){
    const s=snapshot();
    const partes=s.coverage.filter(branch=>NOMBRES[branch.integration]).map(branch=>{
      const mala=branch.stages.find(stage=>stage.state==='ERROR'||stage.state==='DEGRADED');
      return {nombre:NOMBRES[branch.integration],estado:mala?'falla':branch.stages.some(stage=>stage.state==='OK')?'anda':'sin_actividad',
        detalle:mala?motivo(mala.code):''};
    });
    if(s.transport==='ERROR')partes.unshift({nombre:'Aviso al servidor',estado:'falla',detalle:'No se pudo enviar el estado'});
    return {oficina:s.pc,partes};
  }
  function show(){
    const s=snapshot(),escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const reasons={NO_SAMPLE:'Sin observación',STALE:'Muestra vencida',AWAITING_EVIDENCE:'Nueva operación sin confirmar',
      NO_TIMESTAMP:'Sin fecha verificable',CLOCK_SKEW:'Fechas incompatibles',OBSERVED:'Observado'};
    const cell=r=>'<td title="'+escape((reasons[r.evidence]||'Sin confirmar')+(r.code?' · '+r.code:''))+'">'+escape(r.state)+(r.evidence==='NO_SAMPLE'?' · sin muestra':'')+'</td>';
    const rows=s.coverage.map(branch=>'<tr><td>'+escape(branch.integration)+'</td>'+branch.stages.map(cell).join('')+'</tr>').join('');
    const remoteRows=s.remote.map(r=>'<tr><td>'+escape(r.installation_id)+'</td><td>'+escape(r.integration)+'</td><td>'+escape(r.stage)+'</td>'+cell(r)+'<td>'+escape(r.last_error_code||'')+'</td><td>'+escape(r.received_at||'')+'</td></tr>').join('');
    const d=root.NodoDesconexiones;
    const discHtml=d&&typeof d==='object'?'<h3>Auditoría de desconexiones del script ('+escape(d.fuente_hash||'')+')</h3><p>Circuitos activos: '+escape(d.circuitos?.activos??d.circuitos?.total??0)+' · con salud directa: '+escape(d.circuitos?.observados_directo??d.circuitos?.observados??0)+' · por compuerta: '+escape(d.circuitos?.observados_compuerta??0)+' · en código muerto/pisado: '+escape(d.circuitos?.en_codigo_muerto??0)+'</p>':'';
    root.abrirModal?.('Diagnóstico de integraciones','<p>Oficina '+escape(s.pc)+' · envío remoto: '+s.transport+' '+escape(s.code)+'</p><p>Ramas declaradas: '+s.coverage.length+' · sin ninguna muestra: '+s.branches_without_samples.length+'. Este diagnóstico no certifica todas las funciones de cada rama.</p><p>UNKNOWN significa falta de evidencia vigente. No todas las etapas aplican a cada operación; un latido no acredita datos ni render.</p><button onclick="NodoSalud.refresh()">Consultar servidor</button><h3>Esta PC: evidencia por rama y etapa</h3><table><tr><th>Integración</th>'+[...stages].map(stage=>'<th>'+stage+'</th>').join('')+'</tr>'+rows+'</table><h3>Última respuesta remota de la oficina</h3><table><tr><th>Instalación</th><th>Integración</th><th>Etapa</th><th>Estado</th><th>Último error</th><th>Recibido</th></tr>'+remoteRows+'</table>'+discHtml,null,'');
    return s;
  }
  async function refresh(){
    context();lastFlush=0;await flush();return show();
  }
  return Object.freeze({record,begin,errorCode,flush,snapshot,show,refresh,resumen,motivo});
});
// "Probar ahora" de Estado del sistema: consulta de verdad cada parte y dice cuál se cortó.
//
// Juan, 1/11: "tampoco permite correr pruebas". El semáforo sólo anota lo que el panel ya hizo, y que
// algo se haya usado no prueba que funcione. Cada prueba llama a la función principal de esa parte, la
// misma que usa la pantalla: lo que se prueba es lo que corre, no una copia.
//
// Sólo lee. Ninguna prueba carga, retira, aprueba, escribe mensajes ni marca nada como leído.
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.NodoPruebas = factory(root);
})(globalThis, function(root){
  'use strict';
  const TOPE_MS = 25000, VIGENTE_MS = 300000;
  const resultados = new Map();
  let enCurso = null;
  const salud = () => root.NodoSalud;

  // Lo que dejó anotado la función principal al terminar. Sólo cuenta la conexión y los datos: un
  // cambio que falló antes no dice nada de si ahora se puede leer.
  function veredicto(rama){
    const stages = salud().snapshot().coverage.find(b => b.integration === rama)?.stages
      .filter(s => s.stage === 'CONNECTED' || s.stage === 'DATA') || [];
    const mala = stages.find(s => s.state === 'ERROR' || s.state === 'DEGRADED');
    if(mala) return { ok:false, detalle:salud().motivo(mala.code) };
    return stages.some(s => s.stage === 'DATA' && s.state === 'OK') ? { ok:true } : { ok:false, detalle:'No respondió' };
  }
  async function agentes(){
    if(root._drexGlobalBusy) return { ok:false, detalle:salud().motivo('AGENTE_OCUPADO') };
    const health = salud().begin('RETIROS');
    const estado = await root.callDrex('estadoPagina');
    health.reply(null);
    if(estado?.needsLogin || estado?.pageError){
      health.record('DATA', 'ERROR', 'FICHAS_SIN_SESION');
      return { ok:false, detalle:salud().motivo('FICHAS_SIN_SESION') };
    }
    health.record('DATA', 'OK');
    return { ok:true };
  }
  async function controlDeFichas(){
    const lectura = await root._watchdogLeer();
    if(lectura?.drexNeedsLogin) return { ok:false, detalle:salud().motivo('FICHAS_SIN_SESION') };
    return lectura?.drexFichas != null && lectura?.chuniorFichas != null
      ? { ok:true } : { ok:false, detalle:'No se pudieron leer las fichas de los dos lados' };
  }
  const PRUEBAS = [
    { partes:['Billeteras'], hay:() => typeof root.cargarBilleteras === 'function',
      // Mira las filas que volvieron: una sincronización en paralelo puede invalidar la muestra.
      correr:async () => {
        const filas = await root.cargarBilleteras(false);
        return filas?.length ? { ok:true } : { ok:false, detalle:salud().motivo('BILLETERAS_LOAD_FAILED') };
      } },
    { partes:['Solicitudes'], hay:() => typeof root.cargarSolicitudesPortal === 'function',
      correr:async () => { await root.cargarSolicitudesPortal(true); return veredicto('BANDEJA'); } },
    { partes:['Chat'], hay:() => root.NodoBetaChat?.active?.() === true && !!root._chatCanalNuevo,
      correr:async () => { await root._chatCanalNuevo.cargar(true); return veredicto('CHAT'); } },
    { partes:['Historial'], hay:() => typeof root.cargarHistorial === 'function',
      correr:async () => { await root.cargarHistorial(); return veredicto('HISTORIAL'); } },
    { partes:['Lectura de fichas', 'Automatismos'], hay:() => !!root.ctrlElectron && typeof root.callDrex === 'function', correr:agentes },
    { partes:['Control de fichas'], hay:() => !!root.ctrlElectron && typeof root._watchdogLeer === 'function', correr:controlDeFichas }
  ];

  async function correrUna(prueba, alCambiar){
    alCambiar(prueba.partes[0]);
    let r, tope;
    try{
      r = await Promise.race([prueba.correr(), new Promise((_, no) => { tope = root.setTimeout(() => no(new Error('tope')), TOPE_MS); })]);
    }catch(_e){ r = { ok:false, detalle:'No respondió' }; }
    root.clearTimeout(tope);
    for(const parte of prueba.partes) resultados.set(parte, { ...r, ts:Date.now() });
  }
  function correr(alCambiar = () => {}){
    if(enCurso) return enCurso;
    enCurso = (async () => {
      // De a una: comparten el agente y la conexión, y así se ve cuál se cortó.
      for(const prueba of PRUEBAS) if(prueba.hay()) await correrUna(prueba, alCambiar);
      return resultados;
    })().finally(() => { enCurso = null; alCambiar(null); });
    return enCurso;
  }
  function vigente(parte){
    const r = resultados.get(parte);
    return r && Date.now() - r.ts < VIGENTE_MS ? r : null;
  }
  return Object.freeze({ correr, vigente, ocupado:() => !!enCurso });
});
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.NodoChatMessage = factory();
})(globalThis, function(){
  'use strict';
  const upper = value => String(value ?? '').trim().toUpperCase();
  function sourceType(m){
    const explicit = m.origen || m.tipo_emisor || m.TIPO_EMISOR || m.emisor_tipo;
    if(explicit) return upper(explicit);
    const known = /^(USUARIO|USER|CLIENTE|PORTAL|BOT|ASISTENTE|AUTOMATICO|SISTEMA|SYSTEM|OPERADOR|OPERATOR|PANEL|ADMIN)$/;
    // En mensajes antiguos emisor contiene el rol; tipo puede ser TEXTO o IMAGEN.
    for(const value of [m.tipo,m.emisor,m.EMISOR]) if(known.test(upper(value))) return upper(value);
    return '';
  }
  function metadata(message){
    const raw = message?.metadata ?? message?.METADATA ?? {};
    if(typeof raw === 'string'){ try{ return JSON.parse(raw) || {}; }catch(_){ return {}; } }
    return raw && typeof raw === 'object' ? raw : {};
  }
  function role(message){
    const m = message || {}, meta = metadata(m);
    const type = sourceType(m);
    // El nombre de un jugador nunca convierte su mensaje en uno del asistente.
    if(['USUARIO','USER','CLIENTE','PORTAL'].includes(type)) return 'USUARIO';
    const auto = m.auto ?? m.AUTO ?? meta.auto;
    if(auto === true || auto === 'true' || ['BOT','ASISTENTE','AUTOMATICO'].includes(type)) return 'BOT';
    if(/^(SIST|SYSTEM)/.test(type)) return 'SISTEMA';
    if(upper(m.operador || m.emisor || m.EMISOR || meta.operador) === 'NODO') return 'BOT';
    if(/OPER|PANEL|ADMIN/.test(type)) return 'OPERADOR';
    return 'USUARIO';
  }
  function normalize(message){
    const m = message || {}, meta = metadata(m);
    const out = Object.assign({}, m, {
      origen: sourceType(m) || role(m),
      usuario: String(m.usuario || ''),
      operador: String(m.operador || m.emisor || m.EMISOR || meta.operador || ''),
      mensaje: String(m.mensaje ?? m.MENSAJE ?? ''),
      fecha: m.fecha || m.created_at || m.FECHA || '',
      solicitud_id: m.solicitud_id || m.solicitudId || null
    });
    if(m.auto !== undefined || m.AUTO !== undefined || meta.auto !== undefined) out.auto = m.auto ?? m.AUTO ?? meta.auto;
    if(m.auto_caso || meta.auto_caso) out.auto_caso = m.auto_caso || meta.auto_caso;
    const img = m.imagen_url || m.imagen || m.IMAGEN_URL || meta.imagen_url || meta.comprobante_url || m.comprobante_url || m.COMPROBANTE_URL;
    if(img) out.imagen_url = img;
    return out;
  }
  function author(message, user){
    const type = role(message);
    if(type === 'BOT') return 'Asistente automático';
    if(type === 'SISTEMA') return 'Sistema';
    if(type === 'USUARIO') return String(user || message?.usuario || 'Usuario');
    const name = String(message?.operador || message?.emisor || message?.EMISOR || '').trim();
    return name && !['PANEL','OPERADOR'].includes(upper(name)) ? 'Operador · ' + name : 'Operador';
  }
  function className(message){ return { USUARIO:'user', OPERADOR:'op', BOT:'bot', SISTEMA:'system' }[role(message)]; }
  function key(message){
    const m = normalize(message);
    return [role(m), m.fecha, m.mensaje, m.imagen_url || ''].join('|');
  }
  // Textos que el sistema puso en boca del jugador: una solicitud sin mensaje se rellenaba con esto
  // y quedaba guardado en el hilo con origen USUARIO. El jugador nunca lo escribió (D-130).
  const FILLER = /^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^\]]*\])$/i;
  function isFiller(message){
    const m = normalize(message);
    return role(m) === 'USUARIO' && !m.imagen_url && FILLER.test(m.mensaje.trim());
  }
  function merge(existing, incoming){
    const result = Object.assign({}, existing);
    for(const [name,value] of Object.entries(incoming || {})){
      if(value !== undefined && value !== null && value !== '') result[name] = value;
    }
    if(existing?.metadata || incoming?.metadata) result.metadata = Object.assign({}, metadata(existing), metadata(incoming));
    return result;
  }
  function visibleText(message){
    const text = String(message?.mensaje ?? message?.MENSAJE ?? '');
    if(role(message) === 'USUARIO') return text;
    return text.replace(/⟦AYUDA:inicio⟧/g, '[Botón: Ver opciones de ayuda]')
      .replace(/⟦AYUDA:revisar_envio⟧/g, '[Botón: Revisar una transferencia enviada]');
  }
  return Object.freeze({ role, normalize, author, className, key, isFiller, merge, visibleText });
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
  // Contrato legacy: una respuesta OPERADOR también corta los pendientes locales.
  // No acredita un recibo remoto de visto. La beta puede entregar el total ya resuelto.
  function readCutoff(ticket, marks = {}) {
    let cutoff = date(marks?.[chatKey(ticket)]);
    for(const message of ticket?.thread || []) {
      if(upper(message.origen) === 'OPERADOR') cutoff = Math.max(cutoff, date(message.fecha));
    }
    return cutoff;
  }
  function unreadForTicket(ticket, marks = {}) {
    if(!ticket || ticket.cerrado) return 0;
    // El número que trae el servidor vale también para un chat que todavía nadie aceptó: el total
    // del servidor lo cuenta, así que la fila tiene que mostrarlo o el total queda sin explicar.
    if(Number.isSafeInteger(ticket._unreadServidor) && ticket._unreadServidor >= 0) return ticket._unreadServidor;
    if(!ticket.accepted) return 0;
    const cutoff = readCutoff(ticket, marks);
    return (ticket.thread || []).filter(m => upper(m.origen) === 'USUARIO' && date(m.fecha) > cutoff).length;
  }
  function snapshot(tickets, marks = {}) {
    const byUser = new Map(), unread = new Map(), signatures = [], list = [];
    let total = 0, accepted = 0;
    for(const ticket of tickets) {
      list.push(ticket);
      const name = upper(ticket.usuario);
      if(!byUser.has(name)) byUser.set(name, ticket);
      const count = unreadForTicket(ticket, marks);
      if(ticket.accepted && !ticket.cerrado) accepted++;
      unread.set(ticket, count);
      total += count;
      const thread = ticket.thread || [], last = thread[thread.length - 1] || {};
      signatures.push([ticket.usuario, ticket.accepted ? 'A' : 'E', ticket.masterId || ticket.solicitudId || '',
        thread.length, count, last.fecha || '', last.mensaje || ''].join(':'));
    }
    // `unread` tiene por clave el OBJETO ticket. Quien lo consulte tiene que buscar el ticket en
    // `tickets` (los mismos objetos de esta pasada): pedirlos de nuevo crea objetos distintos y
    // `unread.get()` no encuentra nada, que es lo que dejaba las filas sin su globito.
    return { byUser, unread, tickets: list, total, accepted, signature: signatures.join('||') };
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
  return { create, snapshot, chatKey, readCutoff, unreadForTicket };
});
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
