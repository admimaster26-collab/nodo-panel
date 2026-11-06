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

    // El número de la lista de Inicio manda: Discord no puede decir 8 cuando la pantalla dice 0.
    if(Number.isInteger(o.pendientes) && o.pendientes >= 0) pendientes = o.pendientes;

    const details = o.sinDatos ? 'Sin datos: no se pudo consultar'
      : pendientes === 0 ? 'Sin solicitudes pendientes'
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
