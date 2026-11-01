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
