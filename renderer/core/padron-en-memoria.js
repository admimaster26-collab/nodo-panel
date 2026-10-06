// El padrón que ya está en memoria: el teléfono y el titular de un jugador, SIN pedir nada.
//
// Juan, 6/10: "HAY QUE PRIORIZAR LA EFICACIA, EL RENDIMIENTO DE LA APLICACION AHORA QUE TODO
// FUNCIONA JOYA" — y antes de eso, tres veces: no hacer dos búsquedas distintas del mismo dato.
//
// Esto NO llama a la base. Mira, en orden, lo que el panel ya tiene cargado por otros motivos:
//
//   1) la base LOCAL de jugadores (nodo_jugadores_local_v2), que se llena sola con cada
//      movimiento que pasa por la PC;
//   2) los vínculos del CRM (window._crmVinculos), si la pestaña se abrió alguna vez;
//   3) las solicitudes del portal que están en pantalla (V154P.solicitudes), que SIEMPRE traen
//      el teléfono en el metadata — medido el 6/10: 0 faltantes en 29.360 solicitudes.
//
// Con eso alcanza para que una ficha abierta desde el historial muestre el mismo número que la
// tarjeta del chat. Si ninguna de las tres lo tiene, devuelve vacío y el que llamó decide: NO
// dispara una consulta por su cuenta, que es justamente lo que había que terminar.
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  const S = (v) => String(v == null ? '' : v).trim();
  const K = (v) => S(v).toLowerCase();

  function _delLocal(u){
    try{
      if(typeof _jugStoreAll !== 'function') return null;
      const j = (_jugStoreAll() || {})[u];
      if(!j) return null;
      const tels = Object.keys(j.telefonos || {});
      const tit  = (Object.values(j.titulares || {})[0] || {}).raw || '';
      return { telefono: S(tels[0]), titular: S(tit) };
    }catch(_e){ return null; }
  }

  function _delCrm(u){
    try{
      const v = (window._crmVinculos || []).find(function(x){ return K(x.usuario) === u; });
      if(!v) return null;
      return { telefono: S(v.telefono_canon || v.telefono), titular: S(v.titular),
               estado: S(v.estado_vinculo) };
    }catch(_e){ return null; }
  }

  // La solicitud más NUEVA de ese usuario que esté en pantalla. Más nueva a propósito: si cambió
  // de teléfono, el último es el que sirve para escribirle hoy.
  function _deSolicitudes(u){
    try{
      const sols = (window.V154P && window.V154P.solicitudes) || [];
      let mejor = null, mejorT = -1;
      for(const s of sols){
        if(K(s.USUARIO || s.usuario) !== u) continue;
        const t = new Date(s.FECHA_CREACION || s.FECHA || s.created_at || 0).getTime() || 0;
        if(t >= mejorT){ mejorT = t; mejor = s; }
      }
      if(!mejor) return null;
      const id = window.NodoDomain && window.NodoDomain.identidad;
      if(!id) return null;
      return { telefono: S(id.telefono(mejor)), titular: S(id.titular(mejor)) };
    }catch(_e){ return null; }
  }

  // Un solo recorrido para los dos datos, así el que precisa teléfono y titular no mira dos veces.
  function padron(usuario){
    const u = K(usuario);
    const out = { telefono:'', titular:'', estado:'' };
    if(!u) return out;
    for(const buscar of [_delLocal, _delCrm, _deSolicitudes]){
      const r = buscar(u);
      if(!r) continue;
      if(!out.telefono && r.telefono) out.telefono = r.telefono;
      if(!out.titular  && r.titular)  out.titular  = r.titular;
      if(!out.estado   && r.estado)   out.estado   = r.estado;
      if(out.telefono && out.titular && out.estado) break;
    }
    return out;
  }

  window.nodoPadron          = padron;
  window.padronTelefono      = function(usuario){ return padron(usuario).telefono; };
  window.padronTitular       = function(usuario){ return padron(usuario).titular;  };
  // El veredicto guardado, para no volver a validar a alguien que ya está validado.
  window.padronEstadoVinculo = function(usuario){ return padron(usuario).estado;   };
})();
