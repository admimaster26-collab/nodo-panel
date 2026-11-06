// ── NODO en Discord ──────────────────────────────────────────────────────────
// Arma los dos renglones y se los pasa a main, que los publica. Decidir QUÉ mostrar es del panel:
// main sólo sabe hablar el protocolo.
//
//   NODO OPERATIVO            ← el nombre de la app, sale de Discord
//   3 solicitudes pendientes
//   Última carga hace 3 min
//
// Esto no puede romper ni frenar nada: todo envuelto, y si algo falla se calla.
(function(){
  'use strict';
  let ultima = null;

  function armar(){
    try{
      const dom = window.NodoDomain && window.NodoDomain.presencia;
      if(!dom) return null;
      const V = window.V154P || {};
      const pantalla = window._nodoPendientesPantalla;
      return dom.armar({
        solicitudes: V.solicitudes || [],
        // Lo que muestra la lista de Inicio, tal cual. Si todavía no se dibujó, o la lista cambió
        // después, se cuenta abajo con el mismo criterio.
        pendientes: (pantalla && pantalla.lista === V.solicitudes && pantalla.largo === (V.solicitudes || []).length) ? pantalla.n : undefined,
        // Si el último refresco falló, no se publica un número que puede ser viejo.
        sinDatos: !!V.solicitudesErrorAt,
        version: window._versionApp || '',
        pc: (typeof pcOperativa !== 'undefined' ? pcOperativa : '') || window.pcOperativa || '',
        // El MISMO criterio con el que la pantalla decide qué queda en la lista de pendientes. Un
        // retiro pagándose por partes ya se aceptó, y una solicitud TOMADA también: ninguna está
        // esperando que alguien la agarre. Se pregunta por el mismo reparto que usa la lista, así no
        // puede decir "5 pendientes" cuando la pantalla muestra 2.
        esParcial: function(s){
          try{
            const par = window.NodoDomain && window.NodoDomain.parciales;
            if(!par) return false;
            const r = par.repartirAbiertas([s], {
              esParcial: function(x){
                return par.enProceso(x, {
                  info: window._retiroParcialInfo,
                  cerrado: window._retiroCerradoAMano,
                  sigueAbierto: window._retiroParcialSigueAbierto
                });
              },
              enCola: function(x){ return !!(window._colaCargaEstado || {})[String(x.ID || x.SOLICITUD_ID || '')]; }
            });
            return r.pendientes.length === 0;
          }catch(_e){ return false; }
        }
      });
    }catch(_e){ return null; }
  }

  window.actualizarPresenciaDiscord = function(forzar){
    try{
      if(!window.ctrlElectron || !window.ctrlElectron.discordPresencia) return;
      const p = armar();
      if(!p) return;
      const dom = window.NodoDomain && window.NodoDomain.presencia;
      // Mandar lo mismo una y otra vez es ruido: Discord lo descarta igual.
      if(!forzar && dom && !dom.distinta(p, ultima)) return;
      ultima = p;
      window.NodoSalud?.begin('ADMIN')?.record('ALIVE','OK','DISCORD_PRESENCIA');
      window.ctrlElectron.discordPresencia(p).catch(function(){});
    }catch(_e){}
  };

  // Cada minuto, aunque no haya cambiado nada: el "hace 3 min" tiene que envejecer solo, y main
  // tiene que saber que el panel sigue vivo. Si deja de oírlo 5 minutos, borra la presencia en vez
  // de dejar un número viejo a la vista.
  try{ setInterval(function(){ window.actualizarPresenciaDiscord(true); }, 60000); }catch(_e){}
})();
