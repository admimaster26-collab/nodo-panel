/* Portal: data. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","localStorage","window"]);
  function create(deps){
const api = {};
  function esc(v){
    return String(v ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function money(v){
    try{return Number(v||0).toLocaleString("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});}
    catch(e){return "$"+String(v||0);}
  }

  function fecha(v){
    if(!v) return "";
    try{
      return new Date(v).toLocaleString("es-AR",{
        timeZone:"America/Argentina/Buenos_Aires",
        day:"2-digit",
        month:"2-digit",
        hour:"2-digit",
        minute:"2-digit"
      }).replace(","," ·");
    }catch(e){return String(v||"");}
  }

  function normArr(data){
    if(Array.isArray(data)) return data;
    if(Array.isArray(data?.data)) return data.data;
    if(Array.isArray(data?.data?.data)) return data.data.data;
    if(Array.isArray(data?.mensaje)) return data.mensaje;
    if(Array.isArray(data?.mensajes)) return data.mensajes;
    if(Array.isArray(data?.chats)) return data.chats;
    if(Array.isArray(data?.solicitudes)) return data.solicitudes;
    if(Array.isArray(data?.items)) return data.items;
    if(Array.isArray(data?.rows)) return data.rows;
    if(data && typeof data === "object" && Object.keys(data).every(k => /^\d+$/.test(k))) return Object.values(data);
    return [];
  }

  async function getCanal(){
    // MULTI-OFICINA: la oficina la MANDA pcOperativa (resuelto del login de Chunior).
    // El ctx viene del .env y trae default "P1" fijo, así que NO debe pisar a la oficina dinámica.
    try{
      let pc = String(deps.window.pcOperativa || deps.window.landingPcCodigo || "").toUpperCase();
      if(!pc){
        const ctx = await deps.window.panelAPI?.getContext?.();
        pc = String(ctx?.landing_pc || ctx?.LANDING_PC_CODIGO || deps.localStorage.getItem("panel_v154_landing_pc") || "").toUpperCase();
      }
      if(pc){ deps.V154P.pcActual = pc; return pc; }
    }catch(e){}
    const pc = String(deps.window.pcOperativa || deps.window.landingPcCodigo || deps.localStorage.getItem("panel_v154_landing_pc") || "P1").toUpperCase();
    deps.V154P.pcActual = pc;
    return pc;
  }

  async function rpc(fn, params){
    const health = deps.window.NodoSalud?.begin('PORTAL');
    try{
      if(deps.window.panelAPI?.rpc){
        const res = await deps.window.panelAPI.rpc(fn, params || {});
        health?.reply(res?.error);
        if(!res?.error) health?.record('DATA', 'OK', 'PORTAL_RPC_OK');
        return res;
      }
    }catch(e){
      health?.reply(e);
      return {data:null,error:{message:e.message || String(e),code:e.code}};
    }
    health?.reply({message:"panelAPI.rpc no disponible"});
    return {data:null,error:{message:"panelAPI.rpc no disponible"}};
  }

  function estadoCerrado(e){
    e = String(e || "").toUpperCase();
    return ["ACREDITADA","PAGADA","APROBADA","RECHAZADA","CANCELADA","CERRADA","FINALIZADA"].includes(e);
  }

  function mapSolicitudPortal(s){
    const meta = s.metadata || {};
    const id = s.id || s.ID || s.solicitud_id || "";
    const compUrl = meta.comprobante_url || meta.imagen_url || s.comprobante_url || s.imagen_url || s.COMPROBANTE_URL || s.IMAGEN_URL || "";
    return {
      ID: id,
      SOLICITUD_ID: id,
      COMPROBANTE_URL: compUrl,
      IMAGEN_URL: compUrl,
      FECHA_CREACION: s.created_at || s.FECHA_CREACION || s.fecha,
      FECHA: s.created_at || s.FECHA || s.fecha,
      TIPO_SOLICITUD: String(s.tipo || s.TIPO || "").toUpperCase(),
      TIPO: String(s.tipo || s.TIPO || "").toUpperCase(),
      USUARIO: s.usuario || s.USUARIO || "",
      USUARIO_JUGADOR: s.usuario || s.USUARIO || "",
      NOMBRE_COMPLETO: meta.titular || s.titular || s.nombre_completo || "",
      // El portal V16 manda el teléfono DENTRO de p_metadata, no como columna: la columna llega
      // vacía en todas las solicitudes del portal (verificado contra la base). Sin este fallback
      // el panel perdía el teléfono de cada carga/retiro — y con él el cotejo del alta, la ficha
      // del CRM y lo que se le manda a Nexo.
      TELEFONO: s.telefono || meta.telefono || "",
      // IP pública desde la que se mandó la solicitud. NODO no la guarda en ningún lado propio:
      // se lee de la solicitud que ya está en memoria y se reenvía a Nexo, que es la base donde
      // esto se acumula. Acá es de paso, a propósito.
      IP: meta.ip || "",
      PC: s.pc_codigo || s.PC || "",
      MONTO_DECLARADO: Number(s.monto || s.MONTO || 0),   // lo que tecleó el cliente, no se pisa
      // MONTO_REAL = lo que realmente se va a pagar. Si el operador corrigió un cero de más
      // (_retiroAjustarASaldo), ese monto manda: de acá lo toman la tarjeta, el modal y el historial.
      MONTO_REAL: Number(meta.monto_corregido != null ? meta.monto_corregido : (s.monto || s.MONTO || 0)),
      ESTADO: s.estado || s.ESTADO || "",
      BILLETERA_NOMBRE: meta.billetera_nombre || meta.billetera || meta.destino || "",
      ID_BILLETERA: meta.billetera_id || "",
      CHAT_ID: s.chat_id || meta.chat_id || "",
      OPERADOR: s.tomada_por_operador_nombre || s.operador_usuario || s.operador || meta.operador || "",
      // Mismo caso que TELEFONO: el portal manda la clave DENTRO de p_metadata, y
      // landing_solicitudes no tiene columna password_nuevo. Leyendo sólo la columna, la clave
      // que eligió la persona se perdía siempre y el cambio caía al default "12345a".
      PASSWORD_NUEVO: s.password_nuevo || meta.password_nuevo || "",
      ORIGEN: s.origen || "PORTAL_V16",
      TITULAR: meta.titular || "",
      DESTINO: meta.destino || "",
      SALDO_PRE: meta.saldo_pre ?? meta.saldoPre ?? null,
      SALDO_POST: meta.saldo_post ?? meta.saldoPost ?? null,
      HISTORIAL_ID: meta.historial_id || meta.historialId || null,
      MENSAJE_INICIAL: s.mensaje_inicial || "",
      // Datos de la cuenta EXACTA a la que el cliente dice haber transferido. Ya venían en el
      // metadata del portal y nadie los leía: sirven para cotejar el depósito contra el banco
      // y para responder "¿a qué alias mandaste?" sin abrir la solicitud.
      BILLETERA_ALIAS: meta.billetera_alias || "",
      BILLETERA_CBU: meta.billetera_cbu || "",
      BILLETERA_TITULAR: meta.billetera_titular || "",
      NAVEGADOR: meta.navegador || "",      // dispositivo/navegador del cliente (soporte)
      metadata: s.metadata || {},
      METADATA: s.metadata || {}
    };
  }

    return { globals: api, esc, money, fecha, normArr, getCanal, rpc, estadoCerrado, mapSolicitudPortal };
  }
  return Object.freeze({ create, dependencies });
});
