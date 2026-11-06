'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../renderer/runtime/integration-health');
function harness(){
  const calls=[];
  const root={pcOperativa:'P1',panelAPI:{getContext:async()=>({beta:{enabled:true,offices:['P1','P2'],build:'demo'}}),
    rpc:async(fn,args)=>{calls.push({fn,args});return {data:{ok:true,contract:'nodo.beta.v1',rows:[]}};}}};
  return {root,api:create(root),calls};
}
test('salud: lista cerrada de dimensiones; sólo códigos y métricas, sin texto privado',()=>{
  const {api}=harness();
  assert.equal(api.record('OTRA','DATA','OK'),false);
  assert.equal(api.record('CHAT','INVENTADA','OK'),false);
  assert.equal(api.record('CHAT','DATA','OK',{code:'nombre privado',message:'no exportar',duration_ms:Infinity}),true);
  const sample=api.snapshot().rows[0];assert.equal(sample.code,null);assert.equal(sample.duration_ms,0);
  assert.equal(JSON.stringify(sample).includes('privado'),false);
});
test('salud: fallos DATA no desaparecen por un latido OK, memoria acotada',()=>{
  const {api}=harness();
  api.record('CHAT','DATA','ERROR',{code:'BETA_OFFLINE'});
  for(let i=0;i<2000;i++)api.record('CHAT','ALIVE','OK');
  assert.equal(api.snapshot().rows.length,2);assert.equal(api.snapshot().rows.find(r=>r.stage==='DATA').state,'ERROR');
});
test('salud: envío agrupado comparte vuelo y no agrega reloj ni consultas por función',async()=>{
  const {api,calls}=harness();api.record('CHAT','DATA','OK');
  await Promise.all([api.flush(),api.flush(),api.flush()]);
  assert.equal(calls.length,1);assert.equal(calls[0].fn,'nodo_beta_salud_v1');
  assert.equal(calls[0].args.p_muestras.length,2);assert.equal(api.snapshot().pending,0);
  await api.flush();assert.equal(calls.length,1);
});
test('salud: error remoto visible, muestras quedan pendientes y no rompe negocio',async()=>{
  const {api,root}=harness();api.record('CHAT','EFFECT','ERROR',{code:'BETA_ACK_INCOMPLETE'});
  root.panelAPI.rpc=async()=>({error:{code:'BETA_TIMEOUT'}});
  assert.equal(await api.flush(),null);assert.equal(api.snapshot().transport,'ERROR');
  assert.equal(api.snapshot().code,'BETA_TIMEOUT');assert.equal(api.snapshot().pending,2);
});
test('salud: cambio de oficina descarta respuesta tardía y datos privados del contexto anterior',async()=>{
  const {api,root}=harness();let finish;
  root.panelAPI.rpc=()=>new Promise(resolve=>{finish=resolve;});
  api.record('CHAT','DATA','OK');const pending=api.flush();
  await Promise.resolve();root.pcOperativa='P2';api.record('PORTAL','DATA','OK');
  finish({data:{ok:true,contract:'nodo.beta.v1',rows:[{pc:'P1'}]}});await pending;
  assert.equal(api.snapshot().pc,'P2');assert.deepEqual(api.snapshot().remote,[]);
  assert.deepEqual(api.snapshot().rows.map(r=>r.integration),['PORTAL']);
});
test('salud: legacy no hace tráfico beta',async()=>{
  const {api,root,calls}=harness();root.panelAPI.getContext=async()=>({beta:{enabled:false}});
  await api.flush();assert.equal(calls.length,0);assert.equal(api.snapshot().transport,'IDLE');
});
test('bundle: beta y salud están en el manifest real, no sólo disponibles para tests unitarios',()=>{
  const manifest=require('../renderer/manifest.json');
  const modules=manifest.blocks.find(b=>b.id==='js:modules').sources;
  assert.ok(modules.includes('chat/beta-chat.js'));assert.ok(modules.includes('runtime/integration-health.js'));
});
test('salud: una consulta vieja no acredita a otra oficina ni pisa una consulta más nueva',()=>{
  const {api,root}=harness();
  const old=api.begin('BANDEJA'),current=api.begin('BANDEJA');
  current.record('DATA','ERROR','BANDEJA_INVALID_DATA');
  assert.equal(old.record('DATA','OK','BANDEJA_LIST_VALID'),false);
  assert.equal(api.snapshot().rows[0].state,'ERROR');
  root.pcOperativa='P2';
  assert.equal(current.current(),false);assert.equal(current.record('DATA','OK'),false);
  assert.deepEqual(api.snapshot().rows,[]);
});
test('salud: falta de oficina telemetrica no cancela una lectura legacy vigente',()=>{
  const {api,root}=harness();root.pcOperativa='';
  const read=api.begin('BANDEJA');
  assert.equal(read.current(),true);
  assert.equal(read.record('DATA','OK'),false);
  assert.deepEqual(api.snapshot().rows,[]);
  const newer=api.begin('BANDEJA');assert.equal(read.current(),false);assert.equal(newer.current(),true);
  root.pcOperativa='P1';assert.equal(newer.current(),false);
  assert.equal(api.begin('BANDEJA').current(),true);
});
test('salud: respuesta del servidor, corte de red y contrato fallido son evidencias distintas',()=>{
  const {api}=harness();const request=api.begin('IDENTIDAD');
  request.reply({code:'42501',message:'permission denied for private_name'});
  request.record('DATA','ERROR',request.errorCode({code:'42501'}));
  assert.equal(api.snapshot().rows.find(r=>r.stage==='CONNECTED').state,'OK');
  assert.equal(api.snapshot().rows.find(r=>r.stage==='DATA').state,'ERROR');
  request.reply(new Error('fetch failed for https://private.example/?token=secret'));
  assert.equal(api.snapshot().rows.find(r=>r.stage==='CONNECTED').state,'ERROR');
  assert.equal(JSON.stringify(api.snapshot()).includes('private'),false);
  assert.equal(api.errorCode({code:'57014',message:'statement timeout'}),'SERVER_TIMEOUT');
});

test('salud: una medición RPC explícita excluye el tiempo de espera humano',t=>{
  const {api}=harness();let now=Date.parse('2026-11-06T12:00:00Z');
  t.mock.method(Date,'now',()=>now);
  const request=api.begin('RETIROS');
  now+=60000;request.reply(null,84);request.record('DATA','DEGRADED','RETIRO_RPC_LENTO',3001);
  const rows=api.snapshot().rows;
  assert.equal(rows.find(row=>row.stage==='CONNECTED').duration_ms,84);
  assert.equal(rows.find(row=>row.stage==='DATA').duration_ms,3001);
  assert.equal(api.resumen().partes.find(part=>part.nombre==='Lectura de fichas').detalle,'El servidor tardó más de 3 segundos');
});

test('salud: ALIVE y CONNECTED solos no acreditan que la rama procesó datos',()=>{
  const {api}=harness();const retiro=api.begin('RETIROS');retiro.reply(null,30);
  assert.equal(api.resumen().partes.find(part=>part.nombre==='Lectura de fichas').estado,'sin_actividad');
  retiro.record('DATA','OK','RETIRO_24H_CLEAR',24);
  assert.equal(api.resumen().partes.find(part=>part.nombre==='Lectura de fichas').estado,'anda');
  const conexion=api.begin('CONEXION');conexion.reply(null,20);
  assert.equal(api.resumen().partes.find(part=>part.nombre==='Conexión').estado,'anda');
});

test('salud: ramas sin observar son visibles sin inventar muestras ni tráfico',()=>{
  const {api,root,calls}=harness();
  const initial=api.snapshot();
  assert.equal(initial.coverage_scope,'DECLARED_BRANCHES_ONLY');
  assert.deepEqual(initial.rows,[]);assert.equal(initial.pending,0);assert.equal(calls.length,0);
  assert.ok(initial.branches_without_samples.includes('WORKERS'));
  assert.ok(initial.coverage.every(branch=>branch.stages.every(stage=>stage.state==='UNKNOWN'&&stage.evidence==='NO_SAMPLE')));
  assert.ok(api.resumen().partes.every(parte=>parte.estado==='sin_actividad'),'sin muestras no se inventa que anda');
  api.record('TELEMETRIA','ALIVE','OK');
  assert.ok(api.snapshot().coverage.find(branch=>branch.integration==='CHAT').stages.every(stage=>stage.state==='UNKNOWN'));
});

test('salud: éxito anterior no acredita datos ni render del intento nuevo que falla',()=>{
  const {api}=harness();
  const first=api.begin('BANDEJA');first.reply();first.record('DATA','OK');first.record('RENDER','OK');
  const count=api.snapshot().rows.find(row=>row.stage==='RENDER').count;
  const second=api.begin('BANDEJA');
  assert.ok(api.snapshot().rows.every(row=>row.state==='UNKNOWN'));
  second.reply({code:'42501'});second.record('DATA','ERROR','UNAUTHORIZED');
  const rows=api.snapshot().rows;
  assert.equal(rows.find(row=>row.stage==='CONNECTED').state,'OK');
  assert.equal(rows.find(row=>row.stage==='DATA').state,'ERROR');
  assert.equal(rows.find(row=>row.stage==='RENDER').state,'UNKNOWN');
  assert.equal(rows.find(row=>row.stage==='RENDER').count,count);
  assert.equal(rows.some(row=>row.stage==='EFFECT'),false);
  api.begin('BANDEJA');
  assert.equal(api.snapshot().rows.find(row=>row.stage==='DATA').state,'ERROR');
});

test('salud: invalidación de éxito llega al servidor en el mismo lote sin inflar métricas',async()=>{
  const {api,calls}=harness();
  const first=api.begin('HISTORIAL');first.record('DATA','OK');first.record('RENDER','OK');
  api.begin('HISTORIAL');await api.flush();
  assert.equal(calls.length,1);
  const data=calls[0].args.p_muestras.filter(row=>row.integration==='HISTORIAL');
  assert.equal(data.length,2);assert.ok(data.every(row=>row.state==='UNKNOWN'&&row.code==='AWAITING_EVIDENCE'&&row.count===1));
  assert.equal(calls[0].args.p_muestras.some(row=>row.integration==='WORKERS'),false);
});

test('salud: muestra remota antigua o sin fecha nunca queda como OK vigente',async(t)=>{
  const {api,root}=harness();const now=Date.parse('2026-11-01T12:00:00Z');
  t.mock.method(Date,'now',()=>now);
  root.panelAPI.rpc=async()=>({data:{ok:true,contract:'nodo.beta.v1',server_time:new Date(now).toISOString(),rows:[
    {integration:'CHAT',stage:'DATA',state:'OK',reported_state:'OK',observed_at:'2000-01-01T00:00:00Z',received_at:'2000-01-01T00:00:00Z'},
    {integration:'HISTORIAL',stage:'DATA',state:'OK'}
  ]}});
  await api.flush();const remote=api.snapshot().remote;
  assert.equal(remote[0].state,'UNKNOWN');assert.equal(remote[0].reported_state,'OK');assert.equal(remote[0].evidence,'STALE');
  assert.equal(remote[1].state,'UNKNOWN');assert.equal(remote[1].evidence,'NO_TIMESTAMP');
});

test('salud: caduca caché remota y transporte sin agregar consultas ni depender del reloj del servidor',async(t)=>{
  const {api,root,calls}=harness();let now=Date.parse('2026-11-01T12:00:00Z');
  const serverTime='2026-11-01T09:00:00Z';t.mock.method(Date,'now',()=>now);
  root.panelAPI.rpc=async(fn,args)=>{calls.push({fn,args});return {data:{ok:true,contract:'nodo.beta.v1',server_time:serverTime,rows:[
    {integration:'CHAT',stage:'DATA',state:'OK',observed_at:serverTime,received_at:serverTime}
  ]}};};
  await api.flush();assert.equal(api.snapshot().remote[0].state,'OK');assert.equal(api.snapshot().transport,'OK');
  now+=300001;
  const stale=api.snapshot();assert.equal(stale.remote[0].state,'UNKNOWN');assert.equal(stale.remote[0].evidence,'STALE');
  assert.equal(stale.transport,'UNKNOWN');assert.equal(stale.reported_transport,'OK');assert.equal(stale.code,'HEALTH_TRANSPORT_STALE');
  assert.equal(calls.length,1);
});

test('salud: un retroceso significativo del reloj no mantiene éxito local vigente',t=>{
  const {api}=harness();let now=Date.parse('2026-11-01T12:00:00Z');t.mock.method(Date,'now',()=>now);
  api.record('CHAT','DATA','OK');now-=120000;
  const row=api.snapshot().rows[0];
  assert.equal(row.state,'UNKNOWN');assert.equal(row.reported_state,'OK');assert.equal(row.evidence,'CLOCK_SKEW');
});

test('salud: una persona lee qué parte se cortó, en castellano y sin códigos',()=>{
  const {api}=harness();
  api.record('CHAT','DATA','OK');
  api.record('RETIROS','DATA','ERROR',{code:'FICHAS_SIN_SESION'});
  const {partes}=api.resumen();
  assert.deepEqual(partes.find(p=>p.nombre==='Chat'),{nombre:'Chat',estado:'anda',detalle:''});
  assert.deepEqual(partes.find(p=>p.nombre==='Lectura de fichas'),{nombre:'Lectura de fichas',estado:'falla',detalle:'Se cayó la sesión de Agentes'});
  const texto=JSON.stringify(partes);
  for(const prohibido of ['UNKNOWN','ALIVE','CONNECTED','EFFECT','FICHAS_','TELEMETRIA','CAPACIDADES'])assert.ok(!texto.includes(prohibido),prohibido);
});
test('salud: un código desconocido nunca llega a la pantalla',()=>{
  const {api}=harness();
  api.record('BANDEJA','DATA','ERROR',{code:'RPC_FAILED'});
  assert.equal(api.resumen().partes.find(p=>p.nombre==='Solicitudes').detalle,'No respondió bien');
});
test('salud: los fallos del instrumento de retiro tienen explicación operativa, sin filtrar códigos',()=>{
  const {api}=harness();
  const esperado={
    RETIRO_RPC_NO_CONFIRMADO:'El servidor no confirmó el estado de la cuenta',
    RETIRO_RESPUESTA_INVALIDA:'El servidor devolvió una respuesta de retiro inválida',
    RETIRO_ESTADO_NO_RECONOCIDO:'El servidor devolvió un estado de retiro desconocido',
    RETIRO_DNI_FORMATO_INVALIDO:'El servidor no aceptó el formato del DNI/CUIL',
    RETIRO_RECHAZO_NO_CONFIRMADO:'El servidor no confirmó el rechazo',
    RETIRO_VALIDACION_MODAL_FALLO:'No se pudo mostrar la validación de titularidad',
    RETIRO_VALIDADOR_NO_CARGADO:'Falta cargar la validación beta del retiro',
    RETIRO_PAGO_RESULTADO_AMBIGUO:'Agentes no confirmó si el retiro se ejecutó',
    RETIRO_SELLO_NO_CONFIRMADO:'El pago se hizo, pero no se guardó su hora en el servidor'
  };
  for(const [code,mensaje] of Object.entries(esperado))assert.equal(api.motivo(code),mensaje,code);
  api.record('RETIROS','DATA','ERROR',{code:'RETIRO_RPC_NO_CONFIRMADO'});
  const parte=api.resumen().partes.find(p=>p.nombre==='Lectura de fichas');
  assert.equal(parte.detalle,esperado.RETIRO_RPC_NO_CONFIRMADO);
  assert.ok(!JSON.stringify(parte).includes('RETIRO_RPC_NO_CONFIRMADO'));
});
test('salud: toda rama del panel la acepta el servidor (si no, se pierde el lote entero)',()=>{
  // El 1/11 el panel sumó PERSISTENCIA sin tocar el servidor: una sola muestra rechazada tiraba las
  // 32 del lote y el semáforo quedó mudo sin que nadie se enterara. Lo que el servidor todavía no
  // acepta se declara SOLO_LOCAL: se ve en la PC y no viaja.
  const fs=require('fs'),path=require('path');
  const panel=fs.readFileSync(path.join(__dirname,'..','renderer','runtime','integration-health.js'),'utf8').match(/integrations=new Set\('([^']+)'/)[1].split(' ');
  const sql=fs.readFileSync(path.join(__dirname,'..','servidor','beta-chat-v1.sql'),'utf8').match(/integration text not null check \(integration in \(([^)]+)\)/)[1];
  const servidor=sql.split(',').map(x=>x.trim().replace(/'/g,''));
  const fuente=fs.readFileSync(path.join(__dirname,'..','renderer','runtime','integration-health.js'),'utf8');
  const soloLocal=fuente.match(/SOLO_LOCAL=new Set\(\[([^\]]*)\]/)[1].split(',').map(x=>x.trim().replace(/'/g,''));
  assert.deepEqual(panel.filter(x=>!soloLocal.includes(x)).sort(),[...servidor].sort());
});
