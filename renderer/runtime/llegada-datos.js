// ¿Está llegando lo nuevo? Compara lo más nuevo que tiene el servidor contra lo más nuevo que tiene
// el panel, en las tres partes que importan: Solicitudes, Chat e Historial.
//
// Juan, 6/11: una luz que dice "anda" porque el servidor contestó no comprueba nada. Tiene que
// mirar contra los datos de verdad lo que dice. Ese día se cotejó a mano en P4: la bandeja estaba al
// día (la solicitud más nueva del panel era la del servidor), el chat también aunque el semáforo
// decía "sin actividad", y nada avisaba si una de las dos se quedaba atrás.
//
// Cómo decide, por parte:
//   · el panel tiene lo más nuevo del servidor (o algo más nuevo todavía) → llega.
//   · el servidor tiene algo más nuevo → se anota desde cuándo se lo vio faltar. Las listas se piden
//     solas cada pocos segundos, así que se da un margen (GRACIA_MS). Si pasado el margen sigue
//     faltando → no llega. El Historial no se pide solo (se recarga al operar o al abrirlo): ahí sólo
//     es "no llega" si el panel lo pidió DESPUÉS de que el servidor ya lo tenía y no vino; si nadie
//     lo pidió todavía, no se puede decir nada.
//   · la consulta falla, el servidor no tiene la función, la lista está filtrada o es la del canal
//     nuevo → sin comprobar. Nunca "llega" sin haber comparado.
//
// Una consulta liviana por minuto como mucho (panel_ultima_llegada), sólo con la sesión iniciada y
// sin operaciones de Agentes en curso. Sólo lee.
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = { create: factory };
  else { root.NodoLlegada = factory(root); root.NodoLlegada.arrancar(); }
})(globalThis, function(root, opciones){
  'use strict';
  const CADA_MS = 60000, GRACIA_MS = 90000, VIGENTE_MS = 300000, SIN_FUNCION_MS = 600000;
  const RAMAS = ['BANDEJA', 'CHAT', 'HISTORIAL'];
  // Las que el panel vuelve a pedir solo (bandeja cada 60 s y en vivo, chat cada 15 s).
  const SE_PIDEN_SOLAS = new Set(['BANDEJA', 'CHAT']);
  // Las lecturas completas de cada lista, como las anota NodoSalud.
  const LECTURAS = { BANDEJA:['BANDEJA_LIST_VALID'], CHAT:['CHAT_LIST_VALID', 'CHAT_LIST_FALLBACK'],
    HISTORIAL:['HISTORIAL_LIST_VALID', 'HISTORIAL_REVISION_REQUIRED'] };
  const op = opciones || {};
  const estados = new Map();
  let oficinaVista = '', enCurso = null, noAntesDe = 0, reloj = null;

  // `supabaseClient` y `pcOperativa` son `const`/`let` del script principal: no viven en window.
  function cliente(){
    if(op.cliente) return op.cliente();
    try{ if(typeof supabaseClient !== 'undefined' && supabaseClient) return supabaseClient; }catch(_e){}
    return root.supabaseClient || null;
  }
  // La oficina de la sesión iniciada. window.pcOperativa puede venir de una sesión anterior
  // guardada antes de entrar (validacion-pc.js la repone desde localStorage).
  function oficina(){
    let sesion = '';
    if(op.sesion) sesion = op.sesion();
    else { try{ sesion = typeof pcOperativa !== 'undefined' ? pcOperativa : ''; }catch(_e){} }
    const canal = String(root.pcOperativa || root.landingPcCodigo || '').trim().toUpperCase();
    return sesion && canal ? canal : '';
  }
  function ocupado(){
    if(op.ocupado) return op.ocupado();
    const cola = root._drexCola;
    return !!(root._drexGlobalBusy || (cola && (cola.activo || cola.pendientes > 0)));
  }

  // ── Lo que tiene el panel ────────────────────────────────────────────────────────────────
  const maximo = valores => { let m = null; for(const v of valores) if(Number.isFinite(v) && (m === null || v > m)) m = v; return m; };
  function panelDe(rama){
    if(rama === 'BANDEJA'){
      const lista = root.V154P?.solicitudes;
      if(!Array.isArray(lista)) return null;
      return { clave:maximo(lista.map(s => Number(s?.ID ?? s?.SOLICITUD_ID))) };
    }
    if(rama === 'CHAT'){
      // El canal nuevo arma la lista con otro contrato: no se compara contra éste.
      if(root.NodoBetaChat?.active?.() === true) return null;
      const lista = root.V154P?.chats;
      if(!Array.isArray(lista)) return null;
      return { clave:maximo(lista.map(c => Date.parse(c?.FECHA_ULTIMO || ''))) };
    }
    if(rama === 'HISTORIAL'){
      const lista = root._historialData;
      if(!Array.isArray(lista)) return null;
      let desde = null;
      try{
        // Con un filtro puesto (tipo, usuario, fechas) lo más nuevo puede no estar en pantalla a
        // propósito: no se compara.
        if(typeof root._histFiltrosActivos !== 'function' || typeof root._histVentana !== 'function') return null;
        const filtros = root._histFiltrosActivos(), ventana = root._histVentana();
        if(Object.keys(filtros).some(k => k !== 'periodo' && k !== 'desde') || filtros.desde !== ventana.desde) return null;
        desde = Date.parse(ventana.desde);
      }catch(_e){ return null; }
      return { clave:maximo(lista.map(h => Number(h?.id))), desde:Number.isFinite(desde) ? desde : null };
    }
    return null;
  }
  function servidorDe(rama, datos){
    const fila = rama === 'BANDEJA' ? datos.solicitudes : rama === 'CHAT' ? datos.chat : datos.historial;
    if(!fila || typeof fila !== 'object') return null;
    const at = Date.parse(fila.at || '');
    const clave = rama === 'CHAT' ? at : Number(fila.id);
    return Number.isFinite(clave) ? { clave, at:Number.isFinite(at) ? at : null } : null;
  }

  // ── La decisión (pura: se prueba sin reloj ni red) ───────────────────────────────────────
  function decidir({ rama, servidor, panel, lectura, ahora, previo }){
    const hecho = { comprobado:ahora };
    if(!servidor) return { ...hecho, veredicto:'sin_comprobar', motivo:'SERVIDOR_SIN_DATO' };
    if(!panel) return { ...hecho, veredicto:'sin_comprobar', motivo:'PANEL_NO_COMPARABLE' };
    if(panel.desde != null && servidor.at != null && servidor.at < panel.desde)
      return { ...hecho, veredicto:'sin_comprobar', motivo:'FUERA_DE_LA_VENTANA' };
    const tiene = clave => panel.clave != null && panel.clave >= clave;
    if(tiene(servidor.clave))
      return { ...hecho, veredicto:'llega', motivo:'IGUAL_AL_SERVIDOR', desde:previo?.veredicto === 'llega' ? previo.desde : ahora };
    // El panel está atrás. Se cuenta desde la primera vez que se vio faltar ESO: si mientras tanto
    // llegó lo que faltaba y apareció algo más nuevo, el reloj arranca de nuevo.
    let pendiente = previo?.pendiente || null, llegoLoAnterior = false;
    if(pendiente && tiene(pendiente.clave)){ pendiente = null; llegoLoAnterior = true; }
    if(!pendiente) pendiente = { clave:servidor.clave, visto:ahora };
    const espera = ahora - pendiente.visto;
    const loPidioDespues = lectura?.inicio != null && lectura.inicio > pendiente.visto;
    if(espera >= GRACIA_MS && (SE_PIDEN_SOLAS.has(rama) || loPidioDespues))
      return { ...hecho, veredicto:'no_llega', motivo:loPidioDespues ? 'PEDIDO_Y_NO_VINO' : 'NO_SE_ACTUALIZA', desde:pendiente.visto, pendiente };
    if(espera >= GRACIA_MS) return { ...hecho, veredicto:'sin_comprobar', motivo:'SIN_RECARGAR', pendiente };
    // Dentro del margen normal: sigue valiendo lo último que se comprobó.
    const sigue = llegoLoAnterior ? 'llega' : previo?.veredicto === 'llega' || previo?.veredicto === 'no_llega' ? previo.veredicto : 'sin_comprobar';
    return { ...hecho, veredicto:sigue, motivo:'EN_ESPERA', desde:sigue === 'sin_comprobar' ? undefined : sigue === previo?.veredicto ? previo.desde : ahora, pendiente };
  }

  function anotarTodas(motivo){
    const ahora = Date.now();
    for(const rama of RAMAS){
      const previo = estados.get(rama);
      // Si no se pudo comparar, una falla ya vista no se borra: queda hasta que se compruebe lo contrario.
      if(previo?.veredicto === 'no_llega') continue;
      estados.set(rama, { comprobado:ahora, veredicto:'sin_comprobar', motivo });
    }
  }
  function codigoDeError(error){
    const code = String(error?.code || '').toUpperCase(), texto = String(error?.message || error || '').toLowerCase();
    if(code === 'PGRST202' || code === '42883' || /could not find the function/.test(texto)) return 'RPC_MISSING';
    if(/no-auth/.test(texto)) return 'UNAUTHORIZED';
    return 'RPC_FAILED';
  }

  async function comprobar(){
    if(enCurso) return enCurso;
    enCurso = (async () => {
      const pc = oficina();
      if(pc !== oficinaVista){ estados.clear(); oficinaVista = pc; noAntesDe = 0; }
      if(!pc) return null;
      const db = cliente(), secreto = root.PANEL_DATA_SECRET;
      if(!db?.rpc || !secreto){ anotarTodas('SIN_CLIENTE'); return null; }
      let r;
      try{
        const hist = typeof root.pcAliasesHist === 'function' ? root.pcAliasesHist() : null;
        r = await db.rpc('panel_ultima_llegada', { p_secret:secreto, p_pc_codigo:pc, p_hist_pcs:Array.isArray(hist) && hist.length ? hist : null });
      }catch(e){ r = { error:e }; }
      if(oficina() !== pc) return null;           // cambió la oficina en el medio: no se usa
      let datos = r?.data;
      if(typeof datos === 'string'){ try{ datos = JSON.parse(datos); }catch(_e){ datos = null; } }
      if(r?.error || datos?.ok !== true){
        const motivo = r?.error ? codigoDeError(r.error) : 'RESPUESTA_INVALIDA';
        // Mientras el servidor no tenga la función, no se insiste cada minuto.
        if(motivo === 'RPC_MISSING') noAntesDe = Date.now() + SIN_FUNCION_MS;
        anotarTodas(motivo);
        return null;
      }
      const ahora = Date.now();
      for(const rama of RAMAS){
        let panel = null;
        try{ panel = panelDe(rama); }catch(_e){}
        estados.set(rama, decidir({ rama, servidor:servidorDe(rama, datos), panel, ahora, previo:estados.get(rama),
          lectura:root.NodoSalud?.lectura?.(rama, LECTURAS[rama]) || null }));
      }
      return estados;
    })().finally(() => { enCurso = null; });
    return enCurso;
  }

  async function vuelta(){
    try{
      if(!oficina()) { if(oficinaVista){ estados.clear(); oficinaVista = ''; } return; }
      // Con Agentes trabajando las listas pueden quedar quietas a propósito: se deja pasar la vuelta
      // y los márgenes arrancan de nuevo, para no culpar a la llegada de una pausa del panel.
      if(ocupado()){ for(const e of estados.values()) if(e.veredicto !== 'no_llega') delete e.pendiente; return; }
      if(Date.now() < noAntesDe) return;
      await comprobar();
    }catch(_e){}
  }

  // Lo que lee el semáforo. Un "llega" viejo ya no vale; un "no llega" queda a la vista con su hora.
  function estado(rama){
    const e = estados.get(rama);
    if(!e) return null;
    if(e.veredicto === 'llega' && Date.now() - e.comprobado > VIGENTE_MS)
      return { veredicto:'sin_comprobar', motivo:'SIN_COMPROBAR_RECIENTE', comprobado:e.comprobado };
    return { veredicto:e.veredicto, motivo:e.motivo, desde:e.desde, comprobado:e.comprobado };
  }
  function arrancar(){
    if(reloj || typeof root.setInterval !== 'function') return;
    reloj = root.setInterval(vuelta, CADA_MS);
  }
  return Object.freeze({ comprobar, vuelta, estado, decidir, arrancar, GRACIA_MS });
});
