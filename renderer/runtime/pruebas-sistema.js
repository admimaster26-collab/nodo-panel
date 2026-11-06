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
  // 6/11: ver la página de Agentes abierta no prueba que se lean fichas. Antes daba OK con sólo
  // mirar la página; ahora OK es haber leído el saldo del agente, con número.
  async function agentes(){
    if(root._drexGlobalBusy) return { ok:false, detalle:salud().motivo('AGENTE_OCUPADO') };
    const health = salud().begin('RETIROS');
    const falla = (estado, codigo) => { health.record('DATA', estado, codigo); return { ok:false, detalle:salud().motivo(codigo) }; };
    const estado = await root.callDrex('estadoPagina');
    health.reply(null);
    if(estado?.needsLogin || estado?.pageError) return falla('ERROR', 'FICHAS_SIN_SESION');
    // Leer el saldo navega la ventana en algunos casinos: con el mismo candado que el widget de saldo,
    // para no meterse en el medio de una carga o un retiro.
    const candado = typeof root._drexGlobalLock === 'function' && typeof root._drexGlobalUnlock === 'function';
    if(candado && !root._drexGlobalLock('prueba de lectura de fichas')) return { ok:false, detalle:salud().motivo('AGENTE_OCUPADO') };
    let lectura;
    try{ lectura = await root.callDrex('obtenerSaldoAgente'); }
    catch(_e){ return falla('ERROR', 'FICHAS_SIN_RESPUESTA'); }
    finally{ if(candado) root._drexGlobalUnlock(); }
    if(!lectura) return falla('ERROR', 'FICHAS_SIN_RESPUESTA');
    if(lectura.needsLogin || lectura.pageError) return falla('ERROR', 'FICHAS_SIN_SESION');
    const raw = String(lectura.balance?.raw || '').trim();
    if(typeof lectura.balance?.value !== 'number' || !Number.isFinite(lectura.balance.value) || !/\d/.test(raw))
      return falla('DEGRADED', 'FICHAS_ILEGIBLES');
    health.record('DATA', 'OK', 'FICHAS_SALDO_LEIDO');
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
      // Con las listas recién leídas, se vuelve a mirar si lo nuevo del servidor está en el panel.
      try{ await root.NodoLlegada?.comprobar?.(); }catch(_e){}
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
