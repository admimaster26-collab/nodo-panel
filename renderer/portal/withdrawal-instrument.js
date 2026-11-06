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

    const operator = function(){
      const o = deps.operador || root.operador || {};
      return String(o.usuario || o.nombre || 'panel').slice(0,100);
    };

    const getSecret = function(){
      return deps.secret || root.PANEL_DATA_SECRET || (root.session && root.session.secret) || '';
    };

    const rpc = async function(name, params){
      const client = deps.supabaseClient || root.supabaseClient || deps.window?.supabaseClient;
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

    function validationOverlay(dest, tit, info){
      return '<h2 id="nodoCuentaTitulo" style="font-size:17px;margin:0 0 6px">Verificación de cuenta · una sola vez</h2>'
        + '<p>En la pantalla de transferencia de Mercado Pago / banco, confirmá el CUIT/CUIL del titular. El DNI declarado por el jugador permanece oculto.</p>'
        + '<div style="background:#161b22;border:1px solid #30363d;border-radius:9px;padding:10px;margin:12px 0">'
        + '<div>Solicitud <b>#' + esc(info.id || '') + '</b> · Jugador <b>' + esc(info.usuario || '') + '</b></div>'
        + '<div>Cuenta: <b style="font-family:monospace">' + esc(dest || 'sin dato') + '</b></div>'
        + '<div>Titular declarado: <b>' + esc(tit || 'sin dato') + '</b></div>'
        + '</div>'
        + '<label for="nodoCuentaDni" style="display:block;margin-bottom:4px">CUIT/CUIL del titular según Mercado Pago</label>'
        + '<input id="nodoCuentaDni" inputmode="numeric" autocomplete="off" placeholder="8 dígitos o CUIT/CUIL del titular" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #3b4654;background:#0b0f14;color:#fff;font-size:15px">'
        + '<div id="nodoCuentaMsg" role="status" aria-live="polite" style="min-height:22px;margin:8px 0;font-size:13px"></div>'
        + '<div style="display:flex;gap:8px;margin-top:8px">'
        + '<button id="nodoCuentaValidar" type="button" style="flex:1;border:0;border-radius:8px;padding:10px;background:#16803c;color:#fff;font-weight:800;cursor:pointer">Validar y seguir</button>'
        + '<button id="nodoCuentaCancelar" type="button" style="border:1px solid #3b4654;border-radius:8px;padding:10px;background:transparent;color:#e6edf3;cursor:pointer">Ahora no</button>'
        + '</div>'
        + '<div style="margin-top:12px;text-align:center">'
        + '<button id="nodoCuentaRechazar" type="button" style="background:transparent;border:0;color:#ffaaaa;font-size:12px;cursor:pointer;text-decoration:underline">Rechazar: el titular en Mercado Pago es otra persona</button>'
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

      if(res && res.error){
        const code = res.error.code;
        if(code === 'PGRST202'){
          // La base todavía no tiene la función (oficina en versión anterior): no frena
          return { seguir: true, estado: 'LEGACY' };
        }
        record(h, 'DATA', 'ERROR', 'CUENTA_COBRO_NO_LEIDA', durationMs);
        const confirmFn = deps.window?.confirm || root.confirm || (() => true);
        const continuar = confirmFn('No se pudo comprobar la cuenta de cobro en el servidor.\n\n¿Continuar con el retiro igual?');
        if(!continuar) return { seguir: false, estado: 'ERROR' };
        return { seguir: true, estado: 'FORZADO' };
      }

      const data = (res && res.data) || {};
      const estado = data.estado || 'SIN_DECLARAR';
      if(estado === 'VALIDADO' || estado === 'SIN_DECLARAR'){
        record(h, 'EFFECT', 'OK', 'RETIRO_ESTADO_' + estado, durationMs);
        return { seguir: true, estado: estado };
      }

      const destino = data.destino || info.destino || '';
      const titular = data.titular || info.titular || '';

      return await new Promise(function(resolve){
        openOverlay(validationOverlay(destino, titular, info));
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

        const btnCancelar = $('nodoCuentaCancelar');
        if(btnCancelar){
          btnCancelar.onclick = function(){
            if(!busy) done({ seguir: false, estado: 'PENDIENTE' });
          };
        }

        const btnValidar = $('nodoCuentaValidar');
        if(btnValidar){
          btnValidar.onclick = async function(){
            if(busy) return;
            const rawDni = String(input ? input.value : '').trim();
            const cleanDni = rawDni.replace(/\D/g, '');
            if(!cleanDni){
              message('Ingresá el DNI o CUIT/CUIL del titular.', '#fbbf24');
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
