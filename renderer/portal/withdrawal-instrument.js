/* Validación ciega de cuenta de retiro para solicitudes marcadas por el servidor. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports){ module.exports = api; return; }
  const deps = {
    get document(){ return root.document; },
    get window(){ return root; }
  };
  try{ Object.assign(root, api.create(deps).globals); }catch(_e){}
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const OVERLAY_ID = 'nodoCuentaCobroOverlay';
  const RPC_SLOW_MS = 3000;

  function parsed(value){
    if(typeof value === 'string'){ try{ return JSON.parse(value); }catch(_e){ return {}; } }
    return value && typeof value === 'object' ? value : {};
  }
  function localTime(value){
    const date = value instanceof Date ? value : new Date(value || Date.now());
    try{
      return date.toLocaleTimeString('es-AR', {
        timeZone:'America/Argentina/Buenos_Aires',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
      });
    }catch(_e){
      return [date.getHours(),date.getMinutes(),date.getSeconds()]
        .map(function(n){ return String(n).padStart(2,'0'); }).join(':');
    }
  }
  function centralDni(value){
    const digits = String(value || '').replace(/\D/g,'');
    if(digits.length === 8) return digits;
    if(digits.length === 11) return digits.slice(2,10);
    return digits;
  }

  function create(deps){
    const globals = {};
    const root = deps.window || globalThis;
    const now = typeof deps.now === 'function' ? deps.now : function(){ return Date.now(); };
    const esc = function(value){
      return String(value == null ? '' : value).replace(/[&<>"']/g,function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    };
    const health = function(){ try{ return root.NodoSalud?.begin('RETIROS'); }catch(_e){ return null; } };
    const record = function(h,stage,state,code,durationMs){ try{ h?.record(stage,state,code,durationMs); }catch(_e){} };

    // En NODO, `supabaseClient` y `operador` son `const`/`let` del script principal: se ven por su nombre
    // desde cualquier script, pero NO son window.supabaseClient ni window.operador. Este módulo sólo los
    // buscaba en window, no los encontraba, no consultaba nunca al servidor y mostraba "No se pudo comprobar
    // la cuenta de cobro… ¿Continuar igual?", que deja pagar sin validar (Juan, 8/11, primer retiro real).
    // Las pruebas pasaban porque le daban la conexión a mano.
    const globalPorNombre = function(nombre){
      try{
        if(nombre === 'supabaseClient' && typeof supabaseClient !== 'undefined') return supabaseClient; // eslint-disable-line no-undef
        if(nombre === 'operador' && typeof operador !== 'undefined') return operador; // eslint-disable-line no-undef
      }catch(_e){}
      return null;
    };

    const operator = function(){
      const o = deps.operador || root.operador || globalPorNombre('operador') || {};
      return String(o.usuario || o.nombre || 'panel').slice(0,100);
    };

    const getSecret = function(){
      return deps.secret || root.PANEL_DATA_SECRET || (root.session && root.session.secret) || '';
    };

    const rpc = async function(name, params){
      const client = deps.supabaseClient || root.supabaseClient || deps.window?.supabaseClient || globalPorNombre('supabaseClient');
      if(client && typeof client.rpc === 'function'){
        try{ return await client.rpc(name, params); }
        catch(err){ return { error: { code: err?.code || 'NETWORK', message: String(err?.message || err) } }; }
      }
      if(root.panelAPI && typeof root.panelAPI.rpc === 'function'){
        try{ return await root.panelAPI.rpc(name, params); }
        catch(err){ return { error: { code: err?.code || 'NETWORK', message: String(err?.message || err) } }; }
      }
      return { error: { code: 'CLIENT_UNAVAILABLE', message: 'No RPC client available' } };
    };

    const toast = function(message, type){
      try{
        if(typeof deps.toast === 'function') deps.toast(message, type || 'red');
        else if(typeof root.toast === 'function') root.toast(message, type || 'red');
      }catch(_e){}
    };

    function closeOverlay(){
      try{
        const overlay = deps.document?.getElementById(OVERLAY_ID);
        if(overlay) overlay.remove();
      }catch(_e){}
    }

    function openOverlay(html){
      closeOverlay();
      const overlay = deps.document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(5,8,12,.78);display:flex;align-items:center;justify-content:center;padding:18px';
      overlay.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="nodoCuentaTitulo" style="width:min(500px,100%);box-sizing:border-box;background:#111821;border:1px solid #2b3442;border-radius:14px;padding:18px;color:#e6edf3;box-shadow:0 20px 60px rgba(0,0,0,.5);font:14px/1.5 system-ui">' + html + '</section>';
      deps.document.body.appendChild(overlay);
      return overlay;
    }

    // Avisos sobre el DNI y la edad (los arma el servidor). NADA de esto traba al jugador: es información
    // para que el operador revise antes de validar. Los textos no acusan: un DNI raro o una edad que no
    // coincide pueden ser de alguien legítimo (Juan, 8/11: "que no se pueda dar un falso positivo que
    // genere problemas entre usuarios y operadores"). El control de identidad de verdad es el CUIT de abajo.
    const DNI_AVISOS = {
      NUMERO_REPETIDO:  { rojo:true,  t:function(){ return 'El DNI tiene todos los números iguales. Existe, pero es raro: confirmá con el CUIT.'; } },
      NUMERO_ESCALERA:  { rojo:true,  t:function(){ return 'El DNI es una escalera de números (1234…). Existe, pero es raro: confirmá con el CUIT.'; } },
      NUMERO_RESERVADO: { rojo:false, t:function(){ return 'Ese número no es de un DNI argentino: es el que se les da a extranjeros sin DNI. Por el número no se sabe la edad.'; } },
      NUMERO_BEBE:      { rojo:true,  t:function(){ return 'Ese número es de los que se les dan a bebés desde 2023: puede estar mal escrito.'; } },
      EXTRANJERO:       { rojo:false, t:function(){ return 'DNI de extranjero: por el número no se sabe la edad.'; } },
      EDAD_COINCIDE:    { rojo:false, t:function(d){ return 'Dijo que tiene ' + d.declarada + ' años; por el número del DNI tendría entre ' + d.min + ' y ' + d.max + '.'; } },
      EDAD_NO_COINCIDE: { rojo:true,  t:function(d){ return 'Dijo que tiene ' + d.declarada + ' años, y un DNI con ese número suele ser de alguien de entre ' + d.min + ' y ' + d.max + '. Puede pasar si sacó el DNI de grande.'; } },
      EDAD_CAMBIO:      { rojo:true,  t:function(d){ return 'Antes dijo que tenía ' + d.previa + ' años (y no lo dejamos retirar). Ahora dice ' + d.declarada + '.'; } },
      YA_RECHAZADO:     { rojo:true,  t:function(){ return 'Este DNI ya se rechazó antes para este jugador porque no coincidía con el titular.'; } }
    };
    function dniAvisos(data){
      const lista = Array.isArray(data && data.alertas) ? data.alertas
        : String((data && data.alerta_edad) || '').split(',').filter(Boolean);
      const codigos = lista.filter(function(c){ return DNI_AVISOS[c]; });
      if(!codigos.length) return '';
      const d = { declarada: Number(data.edad_declarada) || 0, previa: Number(data.edad_previa) || 0,
                  min: Number(data.edad_min) || 0, max: Number(data.edad_max) || 0 };
      const rojo = codigos.some(function(c){ return DNI_AVISOS[c].rojo; });
      const t = rojo ? { c:'#ff7b72', bg:'rgba(248,81,73,.12)', titulo:'🚨 Revisá antes de validar' }
                     : { c:'#e3b341', bg:'rgba(227,179,65,.11)', titulo:'⚠️ Revisá la edad' };
      return '<div style="border:1px solid ' + t.c + ';background:' + t.bg + ';border-radius:9px;padding:10px;margin:0 0 12px">'
        + '<div style="font-weight:800;color:' + t.c + ';margin-bottom:4px">' + t.titulo + '</div>'
        + codigos.map(function(c){ return '<div style="margin-bottom:3px">• ' + esc(DNI_AVISOS[c].t(d)) + '</div>'; }).join('')
        + '<div style="margin-top:4px">Si hace falta, pedile una foto del DNI por el chat.</div>'
        + '<label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-weight:700;cursor:pointer">'
        + '<input id="nodoCuentaEdadOk" type="checkbox" style="width:16px;height:16px"> Lo revisé: es mayor de 18 años</label>'
        + '</div>';
    }

    function validationOverlay(dest, tit, info, data){
      return '<h2 id="nodoCuentaTitulo" style="font-size:17px;margin:0 0 6px">Verificación de cuenta · una sola vez</h2>'
        + dniAvisos(data)
        + '<p>En la pantalla de transferencia de Mercado Pago / banco, fijate el DNI del titular de la cuenta y escribilo abajo. El DNI que declaró el jugador no se muestra.</p>'
        + '<div style="background:#161b22;border:1px solid #30363d;border-radius:9px;padding:10px;margin:12px 0">'
        + '<div>Solicitud <b>#' + esc(info.id || '') + '</b> · Jugador <b>' + esc(info.usuario || '') + '</b></div>'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">Cuenta: <b style="font-family:monospace;user-select:all">' + esc(dest || 'sin dato') + '</b>'
        + (dest ? '<button id="nodoCuentaCopiar" type="button" title="Copiar la cuenta para pegarla en Mercado Pago" style="border:1px solid #3b4654;border-radius:6px;padding:2px 8px;background:#0d1117;color:#7cc4ff;font-size:12px;font-weight:700;cursor:pointer">📋 Copiar</button>' : '')
        + '</div>'
        + '<div>Titular declarado: <b>' + esc(tit || 'sin dato') + '</b></div>'
        + '</div>'
        // Juan, 8/11: "poné DNI, no usamos el CUIT ni el CUIL".
        + '<label for="nodoCuentaDni" style="display:block;margin-bottom:4px">DNI del titular según Mercado Pago</label>'
        + '<input id="nodoCuentaDni" inputmode="numeric" autocomplete="off" placeholder="DNI del titular, sin puntos" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #3b4654;background:#0b0f14;color:#fff;font-size:15px">'
        + '<div id="nodoCuentaMsg" role="status" aria-live="polite" style="min-height:22px;margin:8px 0;font-size:13px"></div>'
        + '<div style="display:flex;gap:8px;margin-top:8px">'
        + '<button id="nodoCuentaValidar" type="button" style="flex:1;border:0;border-radius:8px;padding:10px;background:#16803c;color:#fff;font-weight:800;cursor:pointer">Validar y seguir</button>'
        + '<button id="nodoCuentaCancelar" type="button" style="border:1px solid #3b4654;border-radius:8px;padding:10px;background:transparent;color:#e6edf3;cursor:pointer">Ahora no</button>'
        + '</div>'
        + '<div style="margin-top:12px;text-align:center">'
        + '<button id="nodoCuentaRechazar" type="button" style="background:transparent;border:0;color:#ffaaaa;font-size:12px;cursor:pointer;text-decoration:underline">Rechazar: el titular en Mercado Pago es otra persona</button>'
        + '</div>';
    }

    // Cuenta nueva con el DNI apagado (18/11): no hay DNI que comparar. El cajero abre la cuenta en Mercado
    // Pago o el banco, mira a nombre de quién está y confirma. Antes el servidor la daba por "sin declarar",
    // NODO pagaba sin preguntar y el Portal le decía al jugador "verificando" para siempre.
    function overlaySinDni(dest, tit, info){
      return '<h2 id="nodoCuentaTitulo" style="font-size:17px;margin:0 0 6px">Cuenta de cobro nueva · una sola vez</h2>'
        + '<p>Es la primera vez que este jugador cobra en esta cuenta. Buscala en Mercado Pago o en el banco (como para transferirle) '
        + 'y fijate <b>a nombre de quién está</b>. Si es del jugador, confirmalo y el retiro sigue. No hace falta pedirle el DNI.</p>'
        + '<div style="background:#161b22;border:1px solid #30363d;border-radius:9px;padding:10px;margin:12px 0">'
        + '<div>Solicitud <b>#' + esc(info.id || '') + '</b> · Jugador <b>' + esc(info.usuario || '') + '</b></div>'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">Cuenta: <b style="font-family:monospace;user-select:all">' + esc(dest || 'sin dato') + '</b>'
        + (dest ? '<button id="nodoCuentaCopiar" type="button" title="Copiar la cuenta para pegarla en Mercado Pago" style="border:1px solid #3b4654;border-radius:6px;padding:2px 8px;background:#0d1117;color:#7cc4ff;font-size:12px;font-weight:700;cursor:pointer">Copiar</button>' : '')
        + '</div>'
        + '<div>A nombre de (lo que escribió el jugador): <b>' + esc(tit || 'sin dato') + '</b></div>'
        + '</div>'
        + '<div id="nodoCuentaMsg" role="status" aria-live="polite" style="min-height:22px;margin:8px 0;font-size:13px"></div>'
        + '<div style="display:flex;gap:8px;margin-top:8px">'
        + '<button id="nodoCuentaValidar" type="button" style="flex:1;border:0;border-radius:8px;padding:10px;background:#16803c;color:#fff;font-weight:800;cursor:pointer">Está a nombre del jugador · seguir</button>'
        + '<button id="nodoCuentaCancelar" type="button" style="border:1px solid #3b4654;border-radius:8px;padding:10px;background:transparent;color:#e6edf3;cursor:pointer">Ahora no</button>'
        + '</div>'
        + '<div style="margin-top:12px;text-align:center">'
        + '<button id="nodoCuentaRechazar" type="button" style="background:transparent;border:0;color:#ffaaaa;font-size:12px;cursor:pointer;text-decoration:underline">Rechazar: la cuenta es de otra persona</button>'
        + '</div>';
    }

    async function ejecutarRechazo(solicitudId, usuario, motivo, etapa, mensajeChat){
      const actualizar = deps.actualizarSolicitudPortal || deps.window?.actualizarSolicitudPortal || root.actualizarSolicitudPortal;
      if(typeof actualizar === 'function'){
        try{
          await actualizar(solicitudId, 'RECHAZADA', { motivo_rechazo: motivo, etapa: etapa });
        }catch(_e){}
      }
      const avisar = deps.avisarJugadorEnChat || deps.window?.avisarJugadorEnChat || root.avisarJugadorEnChat;
      if(typeof avisar === 'function' && usuario){
        try{
          await avisar(usuario, mensajeChat);
        }catch(_e){}
      }
    }

    globals.nodoRetiroCuentaValidada = async function(solicitudId, info){
      info = Object.assign({}, info || {}, { id: solicitudId });
      if(!solicitudId) return { seguir: true, estado: 'SIN_DECLARAR' };

      const h = health();
      const started = now();
      const secret = getSecret();
      const res = await rpc('panel_retiro_instrumento', { p_secret: secret, p_solicitud_id: Number(solicitudId) });
      const durationMs = Math.max(0, now() - started);

      // Acá sólo llegan retiros que el Portal marcó para validar el DNI (los tres llamadores lo miran antes).
      // Si no se puede comprobar la cuenta, no se paga. Antes un error ofrecía "¿Continuar igual?" y la falta
      // de la función dejaba seguir: las dos cosas permitían pagar sin validar (9/11).
      const data = (res && res.data) || {};
      if((res && res.error) || data.ok === false){
        record(h, 'DATA', 'ERROR', 'CUENTA_COBRO_NO_LEIDA', durationMs);
        toast('No se pudo comprobar la cuenta de cobro. No se movió saldo. Probá de nuevo en un momento.', 'red');
        return { seguir: false, estado: 'ERROR' };
      }
      const estado = data.estado || 'SIN_DECLARAR';
      if(estado === 'VALIDADO' || estado === 'SIN_DECLARAR'){
        record(h, 'EFFECT', 'OK', 'RETIRO_ESTADO_' + estado, durationMs);
        return { seguir: true, estado: estado };
      }

      const destino = data.destino || info.destino || '';
      const titular = data.titular || info.titular || '';
      const sinDni = estado === 'PENDIENTE_SIN_DNI';

      return await new Promise(function(resolve){
        openOverlay(sinDni ? overlaySinDni(destino, titular, info) : validationOverlay(destino, titular, info, data));
        record(h, 'RENDER', 'OK', 'RETIRO_VALIDACION_MODAL_VISIBLE', 0);

        const $ = function(id){ return deps.document.getElementById(id); };
        let busy = false, finished = false;

        const done = function(result){
          if(finished) return;
          finished = true;
          closeOverlay();
          resolve(result);
        };

        const message = function(text, color){
          const el = $('nodoCuentaMsg');
          if(el){ el.textContent = text; el.style.color = color || '#e6edf3'; }
        };

        const input = $('nodoCuentaDni');
        try{ input?.focus(); }catch(_e){}
        // Sólo el DNI: hasta 8 números. Si pegan un CUIT/CUIL completo (11 números), queda el DNI del medio;
        // cortarlo a los primeros 8 daba un número equivocado y le gastaba un intento al jugador.
        const soloDni = function(v){
          const d = String(v == null ? '' : v).replace(/\D/g, '');
          return d.length === 11 ? d.slice(2, 10) : d.slice(0, 8);
        };
        if(input) input.oninput = function(){ const v = soloDni(input.value); if(v !== input.value) input.value = v; };

        const btnCancelar = $('nodoCuentaCancelar');
        if(btnCancelar){
          btnCancelar.onclick = function(){
            if(!busy) done({ seguir: false, estado: 'PENDIENTE' });
          };
        }

        const btnValidar = $('nodoCuentaValidar');
        // Con aviso de edad, no se valida sin tildar que se confirmó que es mayor. El botón se ve atenuado
        // pero NO se deshabilita: un botón deshabilitado no recibe el clic, así que el aviso de "tildá la
        // casilla" nunca aparecía y el operador apretaba sin que pasara nada (Juan, 8/11: "no permite").
        const edadOk = $('nodoCuentaEdadOk');
        const pintarValidar = function(){
          if(!btnValidar || !btnValidar.style) return;
          const falta = !!(edadOk && !edadOk.checked);
          btnValidar.style.opacity = falta ? '.45' : '';
        };
        if(edadOk && btnValidar){
          pintarValidar();
          edadOk.onchange = function(){ pintarValidar(); message('', ''); };
        }
        // Copiar la cuenta para pegarla en Mercado Pago y ver el CUIT del titular. La ventana tapa todo y
        // no se podía volver a la tarjeta a copiarla (Juan, 8/11).
        const btnCopiar = $('nodoCuentaCopiar');
        if(btnCopiar){
          btnCopiar.onclick = async function(){
            let ok = false;
            try{
              if(typeof root.nodoCopiar === 'function') ok = await root.nodoCopiar(destino, { etiqueta: 'Cuenta copiada' });
              else if(root.navigator && root.navigator.clipboard){ await root.navigator.clipboard.writeText(String(destino || '')); ok = true; }
            }catch(_e){ ok = false; }
            message(ok ? 'Cuenta copiada: pegala en Mercado Pago para ver el CUIT del titular.' : 'No se pudo copiar. Seleccioná la cuenta con el mouse y copiala.', ok ? '#7ee787' : '#fbbf24');
          };
        }
        if(btnValidar){
          btnValidar.onclick = async function(){
            if(busy) return;
            if(sinDni){
              busy = true;
              this.disabled = true;
              message('Guardando la confirmación…', '#aab4c0');
              const cRes = await rpc('panel_retiro_instrumento_confirmar_titular', {
                p_secret: secret, p_solicitud_id: Number(solicitudId), p_operador: operator()
              });
              busy = false;
              this.disabled = false;
              const cData = (cRes && cRes.data) || {};
              if(!(cRes && cRes.error) && cData.ok === true && cData.estado === 'VALIDADO'){
                toast('Cuenta de cobro confirmada. El retiro puede continuar.', 'green');
                done({ seguir: true, estado: 'VALIDADO' });
                return;
              }
              message(cData.motivo === 'RECHAZADO'
                ? 'Esta cuenta ya estaba rechazada. No se movió saldo.'
                : 'No se pudo guardar la confirmación en el servidor. No se movió saldo: probá de nuevo.', '#ff8b8b');
              return;
            }
            if(edadOk && !edadOk.checked){
              message('Primero tildá "Lo revisé: es mayor de 18 años" (arriba, en el recuadro).', '#fbbf24');
              try{ edadOk.focus(); }catch(_e){}
              return;
            }
            const cleanDni = soloDni(input ? input.value : '');
            if(cleanDni.length < 7){
              message('Escribí el DNI del titular (7 u 8 números, sin puntos).', '#fbbf24');
              return;
            }
            busy = true;
            this.disabled = true;
            message('Comprobando con el servidor…', '#aab4c0');

            const vRes = await rpc('panel_retiro_instrumento_validar', {
              p_secret: secret,
              p_solicitud_id: Number(solicitudId),
              p_dni_banco: cleanDni,
              p_operador: operator()
            });

            busy = false;
            this.disabled = false;

            if(vRes && vRes.error){
              message('Error al validar con el servidor. Podés reintentar.', '#ff8b8b');
              return;
            }

            const vData = (vRes && vRes.data) || {};
            if(vData.ok === true && vData.estado === 'VALIDADO'){
              toast('Cuenta de cobro validada. El retiro puede continuar.', 'green');
              done({ seguir: true, estado: 'VALIDADO' });
              return;
            }

            if(vData.motivo === 'CUIT_INVALIDO'){
              // Salida siempre disponible: con los 8 números del DNI no hay dígito verificador que pueda trabar.
              message('Ese número no es válido. Revisá el DNI del titular. No se gastó ningún intento.', '#fbbf24');
              try{ input?.select(); }catch(_e){}
              return;
            }

            if(vData.motivo === 'NO_COINCIDE'){
              message('No coincide con el titular (' + (vData.intentos_restantes || 1) + ' intento restante).', '#ff8b8b');
              try{ input?.select(); }catch(_e){}
              return;
            }

            if(vData.motivo === 'RECHAZADO'){
              toast('DNI no coincide. Solicitud rechazada sin descontar fichas.', 'yellow');
              await ejecutarRechazo(
                solicitudId,
                info.usuario,
                'DNI_NO_COINCIDE',
                'RETIRO_DNI_NO_COINCIDE',
                'Tu retiro fue rechazado porque el DNI no coincide con el titular de la cuenta. No se descontó nada de tu saldo. Corregí tus datos de cobro desde el Portal.'
              );
              done({ seguir: false, estado: 'RECHAZADO', cerrar: true });
              return;
            }

            message('Respuesta no reconocida del servidor.', '#ff8b8b');
          };
        }

        const btnRechazar = $('nodoCuentaRechazar');
        if(btnRechazar){
          btnRechazar.onclick = async function(){
            if(busy) return;
            busy = true;
            this.disabled = true;

            const rRes = await rpc('panel_retiro_instrumento_rechazar', {
              p_secret: secret,
              p_solicitud_id: Number(solicitudId),
              p_operador: operator()
            });

            busy = false;
            this.disabled = false;

            await ejecutarRechazo(
              solicitudId,
              info.usuario,
              'TITULAR_DISTINTO',
              'RETIRO_DNI_NO_COINCIDE',
              'Tu retiro fue rechazado porque el titular de la cuenta en el banco no coincide. No se descontó nada de tu saldo.'
            );
            toast('Solicitud rechazada. No se descontaron fichas.', 'yellow');
            done({ seguir: false, estado: 'RECHAZADO', cerrar: true });
          };
        }
      });
    };

    globals.nodoHoraExacta = localTime;
    return { globals: globals, centralDni: centralDni, horaExacta: localTime };
  }

  return Object.freeze({ create: create, localTime: localTime, horaExacta: localTime, centralDni: centralDni });
});
