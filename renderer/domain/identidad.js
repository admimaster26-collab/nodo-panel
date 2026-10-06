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

  return { telefono, titular, usuario, numeros, veredicto, hayQueValidar };
});
