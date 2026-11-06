(function(root,factory){
  if(typeof module==='object' && module.exports) module.exports={create:factory};
  else root.NodoSalud=factory(root);
})(globalThis,function(root){
  'use strict';
  const integrations=new Set('CHAT PORTAL TELEMETRIA CAPACIDADES BANDEJA IDENTIDAD PERSISTENCIA HISTORIAL BILLETERAS RETIROS VALIDACION WORKERS AUTOMATISMOS CONCILIACION NEXO ADMIN CONEXION'.split(' '));
  const stages=new Set(['ALIVE','CONNECTED','DATA','EFFECT','RENDER']);
  // Ramas que el servidor todavía no acepta: se ven en esta PC pero no viajan. Una sola muestra
  // rechazada tira el lote entero, y el 1/11 eso dejó mudo a todo el semáforo.
  const SOLO_LOCAL=new Set(['PERSISTENCIA']);
  const states=new Set(['OK','DEGRADED','ERROR','IDLE','UNKNOWN']);
  const FRESH_MS=300000;
  const samples=new Map(),dirty=new Map(),attempts=new Map();
  // Cuándo empezó y terminó la última lectura completa de cada rama, por código. La usa la
  // comprobación de llegada (llegada-datos.js) para saber si el panel pidió la lista DESPUÉS de que
  // el servidor ya tenía lo nuevo. No viaja al servidor.
  const lecturas=new Map();
  let scope='',epoch=0,flight=null,lastFlush=0,remote=[],remoteReadAt=null,remoteServerAt=null,
    transport='UNKNOWN',transportCode='',transportAt=null;
  const pc=()=>String(root.pcOperativa||root.__pcCodigo||'').trim().toUpperCase();
  function context(){
    if(scope!==pc()){
      scope=pc();epoch++;samples.clear();dirty.clear();attempts.clear();lecturas.clear();remote=[];flight=null;lastFlush=0;
      transport='UNKNOWN';transportCode='';transportAt=null;remoteReadAt=null;remoteServerAt=null;
    }
    return scope;
  }
  function record(integration,stage,state,details={}){
    if(!context() || !integrations.has(integration) || !stages.has(stage) || !states.has(state))return false;
    const key=integration+'|'+stage,previous=samples.get(key);
    const bounded=(value,max)=>Number.isFinite(value)?Math.max(0,Math.min(max,value)):0;
    // Only codes and aggregate measurements cross the bridge. Never messages, URLs or arguments.
    const code=/^[A-Z0-9_.:-]{1,64}$/.test(details.code||'')?details.code:null;
    const sample={integration,stage,state,count:Math.min(1000000,(previous?.count||0)+1),
      errors:Math.min(1000000,(previous?.errors||0)+(state==='ERROR'||state==='DEGRADED'?1:0)),
      duration_ms:bounded(details.duration_ms,86400000),code,
      observed_at:new Date(Math.max(Date.now(),Date.parse(previous?.observed_at||'')+1||0)).toISOString()};
    samples.set(key,sample);dirty.set(key,sample);
    if(stage==='DATA'&&code&&(state==='OK'||state==='DEGRADED')){
      const fin=Date.now();lecturas.set(integration+'|'+code,{inicio:fin-sample.duration_ms,fin});
    }
    return true;
  }
  function lectura(integration,codigos){
    context();let ultima=null;
    for(const codigo of codigos||[]){const l=lecturas.get(integration+'|'+codigo);if(l&&(!ultima||l.inicio>ultima.inicio))ultima=l;}
    return ultima?{...ultima}:null;
  }
  function errorCode(error){
    // Classify locally; the raw error can contain SQL, URLs, player names or tokens.
    const code=String(error?.code||'').toUpperCase(),message=String(error?.message||error||'').toLowerCase();
    if(code==='57014'||/statement timeout|canceling statement/.test(message))return 'SERVER_TIMEOUT';
    if(code==='42501'||code==='PGRST301'||/no_autorizado|permission denied|invalid.*token|unauthorized/.test(message))return 'UNAUTHORIZED';
    if(code==='PGRST202'||code==='42883')return 'RPC_MISSING';
    if(/panelapi\.rpc no disponible/.test(message))return 'CLIENT_UNAVAILABLE';
    if(/fetch failed|failed to fetch|network|econn|socket|load failed|abort|timeout/.test(message))return 'NETWORK';
    return 'RPC_FAILED';
  }
  function begin(integration){
    const office=context(),version=epoch,started=Date.now(),attempt=(attempts.get(integration)||0)+1;
    if(integrations.has(integration))attempts.set(integration,attempt);
    // Starting another operation invalidates its previous success, including a
    // render that this attempt may never reach. Errors remain unresolved until
    // that stage supplies new evidence. No invented samples for unobserved stages.
    for(const [key,previous] of samples){
      if(previous.integration!==integration || previous.stage==='ALIVE' || previous.state!=='OK')continue;
      const sample={...previous,state:'UNKNOWN',code:'AWAITING_EVIDENCE',
        observed_at:new Date(Math.max(started,Date.parse(previous.observed_at)+1)).toISOString()};
      samples.set(key,sample);dirty.set(key,sample);
    }
    // Freshness and telemetry eligibility are different: an absent office disables
    // record(), but must not cancel a valid legacy read or leave its UI loading.
    // A real context change still invalidates this attempt, including empty -> office.
    const current=()=>{context();return scope===office&&epoch===version&&attempts.get(integration)===attempt;};
    const observe=(stage,state,code,durationMs)=>current()&&record(integration,stage,state,{code,
      duration_ms:Number.isFinite(durationMs)?durationMs:Date.now()-started});
    // A newer request or another office must not inherit the outcome of this request.
    return Object.freeze({current,record:observe,reply(error,durationMs){
      if(!error)return observe('CONNECTED','OK',null,durationMs);
      const code=errorCode(error);
      return observe('CONNECTED',code==='NETWORK'||code==='CLIENT_UNAVAILABLE'?'ERROR':code==='RPC_FAILED'?'DEGRADED':'OK',code,durationMs);
    },errorCode});
  }
  function snapshot(){
    context();const now=Date.now();
    const rows=[...samples.values()].map(s=>{
      const observed=Date.parse(s.observed_at),clockSkew=!Number.isFinite(observed)||observed>now+60000;
      const expired=now-observed>FRESH_MS;
      return {...s,reported_state:s.state,state:expired||clockSkew?'UNKNOWN':s.state,
        evidence:clockSkew?'CLOCK_SKEW':expired?'STALE':s.code==='AWAITING_EVIDENCE'?'AWAITING_EVIDENCE':'OBSERVED'};
    });
    const byStage=new Map(rows.map(r=>[r.integration+'|'+r.stage,r]));
    // This is evidence for declared branches, NOT a claim of function/circuit
    // coverage. Missing observations stay visible without producing network data.
    const coverage=[...integrations].map(integration=>({integration,
      has_samples:rows.some(r=>r.integration===integration),
      stages:[...stages].map(stage=>byStage.get(integration+'|'+stage)||
        {integration,stage,state:'UNKNOWN',reported_state:null,evidence:'NO_SAMPLE',code:null})}));
    const transportExpired=transport==='OK' && (transportAt===null || now-transportAt>FRESH_MS || now<transportAt);
    const remoteRows=remote.map(r=>{
      const received=Date.parse(r.received_at),observed=Date.parse(r.observed_at);
      const reference=remoteServerAt??remoteReadAt;
      const elapsed=remoteReadAt===null?Infinity:Math.max(0,now-remoteReadAt);
      const missing=!Number.isFinite(received)||!Number.isFinite(observed)||reference===null;
      const clockSkew=!missing&&(received>reference+60000||observed>reference+60000||now<remoteReadAt);
      const expired=!missing&&(reference-received+elapsed>FRESH_MS||reference-observed+elapsed>FRESH_MS);
      return {...r,state:missing||clockSkew||expired?'UNKNOWN':r.state,
        reported_state:r.reported_state??r.state,
        evidence:missing?'NO_TIMESTAMP':clockSkew?'CLOCK_SKEW':expired?'STALE':'OBSERVED'};
    });
    return {pc:scope,transport:transportExpired?'UNKNOWN':transport,reported_transport:transport,
      code:transportExpired?'HEALTH_TRANSPORT_STALE':transportCode,pending:dirty.size,
      rows,remote:remoteRows,coverage,coverage_scope:'DECLARED_BRANCHES_ONLY',
      branches_without_samples:coverage.filter(branch=>!branch.has_samples).map(branch=>branch.integration)};
  }
  async function flush(){
    if(!context())return null;
    if(flight)return flight;
    if(lastFlush && Date.now()-lastFlush<30000)return null;
    const version=epoch,office=scope;
    lastFlush=Date.now();
    const pending=(async()=>{
      try{
        const config=(await root.panelAPI?.getContext?.())?.beta;
        if(version!==epoch || office!==pc())return null;
        if(!config?.enabled || !config.offices?.includes(office)){transport='IDLE';return null;}
        record('TELEMETRIA','ALIVE','OK');
        const batch=[...dirty.entries()].filter(([,sample])=>!SOLO_LOCAL.has(sample.integration)).slice(0,32);
        const response=await root.panelAPI.rpc('nodo_beta_salud_v1',{p_pc_codigo:office,p_muestras:batch.map(([,s])=>s),p_build:config.build});
        if(version!==epoch || office!==pc())return null;
        let data=response?.data;
        if(typeof data==='string'){try{data=JSON.parse(data);}catch(_){data=null;}}
        if(response?.error || data?.ok!==true || data?.contract!=='nodo.beta.v1' || !Array.isArray(data.rows)){
          const code=response?.error?.code||response?.error?.message;
          throw new Error(/^BETA_[A-Z0-9_]{1,64}$/.test(code||'')?code:'BETA_HEALTH_UNCONFIRMED');
        }
        for(const [key,sample] of batch)if(dirty.get(key)===sample)dirty.delete(key);
        remote=data.rows;remoteReadAt=Date.now();
        remoteServerAt=Number.isFinite(Date.parse(data.server_time))?Date.parse(data.server_time):null;
        transport='OK';transportAt=remoteReadAt;transportCode='';return snapshot();
      }catch(e){
        if(version===epoch && office===pc()){transport='ERROR';transportCode=e.message?.startsWith('BETA_')?e.message:'BETA_HEALTH_FAILED';}
        return null;
      }
    })();
    flight=pending;
    try{return await pending;}finally{if(flight===pending)flight=null;}
  }
  // Lo que se le muestra a una persona: qué parte del sistema, si anda y qué se cortó, en castellano.
  // El snapshot sigue teniendo el detalle técnico para el servidor y las pruebas. Telemetría y
  // capacidades son internas: si fallan se ve como un solo aviso, no como dos filas que nadie entiende.
  const NOMBRES={CHAT:'Chat',PORTAL:'Portal',BANDEJA:'Solicitudes',IDENTIDAD:'Perfil de jugadores',PERSISTENCIA:'Guardado de datos',
    HISTORIAL:'Historial',BILLETERAS:'Billeteras',RETIROS:'Lectura de fichas',VALIDACION:'Validaciones',WORKERS:'Tareas de fondo',
    AUTOMATISMOS:'Automatismos',CONCILIACION:'Control de fichas',NEXO:'Nexo',ADMIN:'Administración',CONEXION:'Conexión'};
  const MOTIVOS={SERVER_TIMEOUT:'El servidor tardó demasiado',UNAUTHORIZED:'Sin permiso',RPC_MISSING:'Falta actualizar el servidor',
    CLIENT_UNAVAILABLE:'La aplicación no está conectada',NETWORK:'Sin conexión',FICHAS_SIN_SESION:'Se cayó la sesión de Agentes',
    FICHAS_ILEGIBLES:'El casino no devolvió el saldo',FICHAS_SIN_RESPUESTA:'El casino no contestó',AGENTE_OCUPADO:'El agente está ocupado',
    BILLETERAS_LOAD_FAILED:'No se pudieron leer las billeteras',BILLETERA_NO_MARCADA:'No se pudo cambiar la billetera',
    BILLETERAS_SIN_SINCRONIZAR:'No se pudo sincronizar con Chunior',RETIRO_RPC_LENTO:'El servidor tardó más de 3 segundos',
    RETIRO_RPC_NO_CONFIRMADO:'El servidor no confirmó el estado de la cuenta',
    RETIRO_RESPUESTA_INVALIDA:'El servidor devolvió una respuesta de retiro inválida',
    RETIRO_ESTADO_NO_RECONOCIDO:'El servidor devolvió un estado de retiro desconocido',
    RETIRO_DNI_FORMATO_INVALIDO:'El servidor no aceptó el formato del DNI/CUIL',
    RETIRO_RECHAZO_NO_CONFIRMADO:'El servidor no confirmó el rechazo',
    RETIRO_VALIDACION_MODAL_FALLO:'No se pudo mostrar la validación de titularidad',
    RETIRO_VALIDADOR_NO_CARGADO:'Falta cargar la validación beta del retiro',
    RETIRO_PAGO_RESULTADO_AMBIGUO:'Agentes no confirmó si el retiro se ejecutó',
    RETIRO_SELLO_NO_CONFIRMADO:'El pago se hizo, pero no se guardó su hora en el servidor',
    RETIRO_24H_MATCH_PARCIAL:'Se encontró un retiro, pero otra fuente no respondió',
    RETIRO_24H_SIN_COMPROBAR:'No se pudo comprobar el límite de retiros',
    RETIRO_PARCIAL_RESPUESTA_INVALIDA:'El servidor no confirmó el progreso del retiro',
    NEXO_EXPORT_TRUNCATED:'Quedó incompleto',NEXO_LEGACY_TRUNCATED_8000:'Quedó incompleto'};
  const motivo=code=>MOTIVOS[code]||'No respondió bien';
  // Lo que se le dice cuando el servidor tiene algo más nuevo que el panel y no termina de llegar.
  const NO_LLEGA={BANDEJA:'No están llegando las solicitudes nuevas',CHAT:'No están llegando los mensajes nuevos',
    HISTORIAL:'No aparecen las operaciones nuevas'};
  const ETAPAS_POSITIVAS={CONEXION:['CONNECTED','DATA']};
  const hace=ms=>{const min=Math.max(1,Math.floor(ms/60000));return min<120?'hace '+min+' min':'hace '+Math.floor(min/60)+' h';};
  // 6/11: una muestra vieja no es "sin actividad". El snapshot la marca vencida (para el servidor y
  // para "Probar ahora" no prueba nada), pero a una persona se le dice lo último que se vio y cuándo:
  // lo que anduvo hace diez minutos es "anduvo hace 10 min", y una falla no se esconde por vieja —
  // queda a la vista, con su hora, hasta que esa misma etapa vuelva a dar bien. Nexo anotaba
  // DEGRADED 7 de cada 8 veces y a los 5 minutos se veía como "sin actividad".
  // Si la comprobación de llegada (NodoLlegada) ya miró esa parte contra el servidor, manda ella:
  // "al día" es lo único que se gana comparando datos de verdad, y un faltante es una falla.
  function resumen(){
    const s=snapshot(),ahora=Date.now();
    const edad=stage=>Math.max(0,ahora-Date.parse(stage.observed_at));
    const partes=s.coverage.filter(branch=>NOMBRES[branch.integration]).map(branch=>{
      const vistas=branch.stages.filter(stage=>stage.evidence!=='NO_SAMPLE'&&stage.evidence!=='CLOCK_SKEW'&&Number.isFinite(Date.parse(stage.observed_at)));
      const malas=vistas.filter(stage=>stage.reported_state==='ERROR'||stage.reported_state==='DEGRADED');
      const mala=malas.find(stage=>edad(stage)<=FRESH_MS)||malas.sort((a,b)=>edad(a)-edad(b))[0];
      const nombre=NOMBRES[branch.integration];let parte;
      if(mala){
        parte={nombre,estado:'falla',detalle:motivo(mala.code)};
        if(edad(mala)>FRESH_MS){parte.hace=hace(edad(mala));parte.detalle+=' · '+parte.hace;}
      }else{
        // Un OK que la operación siguiente todavía no confirmó (AWAITING_EVIDENCE) cuenta como lo
        // último que anduvo: si no, cada consulta en vuelo se vería un instante como "sin actividad".
        const permitidas=ETAPAS_POSITIVAS[branch.integration]||['DATA','EFFECT','RENDER'];
        const buenas=vistas.filter(stage=>permitidas.includes(stage.stage)
          &&(stage.reported_state==='OK'||stage.code==='AWAITING_EVIDENCE'));
        const ultima=buenas.length?Math.min(...buenas.map(edad)):null;
        parte=ultima===null?{nombre,estado:'sin_actividad',detalle:''}:ultima<=FRESH_MS?{nombre,estado:'anda',detalle:''}
          :{nombre,estado:'anduvo',detalle:'',hace:hace(ultima)};
      }
      const llegada=typeof root.NodoLlegada?.estado==='function'?root.NodoLlegada.estado(branch.integration):null;
      if(llegada){
        parte.llegada=llegada.veredicto;
        if(llegada.veredicto==='no_llega'){
          parte.estado='falla';parte.detalle=NO_LLEGA[branch.integration]||motivo(null);
          if(Number.isFinite(llegada.desde)){parte.hace=hace(ahora-llegada.desde);parte.detalle+=' · desde '+parte.hace;}
        }else if(llegada.veredicto==='llega'&&parte.estado!=='falla'){parte.estado='al_dia';delete parte.hace;}
      }
      return parte;
    });
    if(s.transport==='ERROR')partes.unshift({nombre:'Aviso al servidor',estado:'falla',detalle:'No se pudo enviar el estado'});
    return {oficina:s.pc,partes};
  }
  function show(){
    const s=snapshot(),escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const reasons={NO_SAMPLE:'Sin observación',STALE:'Muestra vencida',AWAITING_EVIDENCE:'Nueva operación sin confirmar',
      NO_TIMESTAMP:'Sin fecha verificable',CLOCK_SKEW:'Fechas incompatibles',OBSERVED:'Observado'};
    const cell=r=>'<td title="'+escape((reasons[r.evidence]||'Sin confirmar')+(r.code?' · '+r.code:''))+'">'+escape(r.state)+(r.evidence==='NO_SAMPLE'?' · sin muestra':'')+'</td>';
    const rows=s.coverage.map(branch=>'<tr><td>'+escape(branch.integration)+'</td>'+branch.stages.map(cell).join('')+'</tr>').join('');
    const remoteRows=s.remote.map(r=>'<tr><td>'+escape(r.installation_id)+'</td><td>'+escape(r.integration)+'</td><td>'+escape(r.stage)+'</td>'+cell(r)+'<td>'+escape(r.last_error_code||'')+'</td><td>'+escape(r.received_at||'')+'</td></tr>').join('');
    const d=root.NodoDesconexiones;
    const discHtml=d&&typeof d==='object'?'<h3>Auditoría de desconexiones del script ('+escape(d.fuente_hash||'')+')</h3><p>Circuitos activos: '+escape(d.circuitos?.activos??d.circuitos?.total??0)+' · con salud directa: '+escape(d.circuitos?.observados_directo??d.circuitos?.observados??0)+' · por compuerta: '+escape(d.circuitos?.observados_compuerta??0)+' · en código muerto/pisado: '+escape(d.circuitos?.en_codigo_muerto??0)+'</p>':'';
    root.abrirModal?.('Diagnóstico de integraciones','<p>Oficina '+escape(s.pc)+' · envío remoto: '+s.transport+' '+escape(s.code)+'</p><p>Ramas declaradas: '+s.coverage.length+' · sin ninguna muestra: '+s.branches_without_samples.length+'. Este diagnóstico no certifica todas las funciones de cada rama.</p><p>UNKNOWN significa falta de evidencia vigente. No todas las etapas aplican a cada operación; un latido no acredita datos ni render.</p><button onclick="NodoSalud.refresh()">Consultar servidor</button><h3>Esta PC: evidencia por rama y etapa</h3><table><tr><th>Integración</th>'+[...stages].map(stage=>'<th>'+stage+'</th>').join('')+'</tr>'+rows+'</table><h3>Última respuesta remota de la oficina</h3><table><tr><th>Instalación</th><th>Integración</th><th>Etapa</th><th>Estado</th><th>Último error</th><th>Recibido</th></tr>'+remoteRows+'</table>'+discHtml,null,'');
    return s;
  }
  async function refresh(){
    context();lastFlush=0;await flush();return show();
  }
  return Object.freeze({record,begin,errorCode,flush,snapshot,show,refresh,resumen,motivo,lectura});
});
