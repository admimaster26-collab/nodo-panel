'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const health=require('../renderer/runtime/integration-health.js');
const requests=require('../renderer/portal/requests.js');
const portalData=require('../renderer/portal/data.js');
const noop=()=>{};
function state(root,integration,stage){return root.NodoSalud.snapshot().rows.find(r=>r.integration===integration&&r.stage===stage);}
function requestsHarness(response){
  const timers=[],calls=[],box={innerHTML:''},V154P={solicitudes:[{ID:99}]};
  const root={pcOperativa:'P1',clearTimeout:noop};root.NodoSalud=health.create(root);
  const deps={window:root,V154P,document:{getElementById:()=>box},getCanal:async()=>'P1',
    rpc:async(fn,args)=>{calls.push({fn,args});return typeof response==='function'?response():response;},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
    mapSolicitudPortal:row=>({ID:row.id}),esc:String,money:String,alert:noop,toast:noop,operador:{},
    _portalAutoRechazar:noop,_v154pAvisoDesfasaje:noop,cargarAlertasRetiro:noop,renderInicio:noop,
    renderSolicitudesPortalCompleto:noop,verificarSolicitudes:noop,
    renderSolicitudesPortalEnInicio:()=>{box.innerHTML='Lista vigente';V154P.solicitudesLastHtml=box.innerHTML;}
  };
  deps.normArr=portalData.create({window:root,V154P,localStorage:{getItem:()=>null}}).normArr;
  return {root,deps,api:requests.create(deps),V154P,calls,timers,box};
}
test('BANDEJA: la lectura real acredita datos y DOM con una sola consulta; no inventa EFFECT',async()=>{
  const c=requestsHarness({data:[{id:1,usuario:'private_player'}]});
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(c.calls.length,1);assert.equal(c.timers.length,0);
  assert.equal(state(c.root,'BANDEJA','CONNECTED').state,'OK');
  assert.equal(state(c.root,'BANDEJA','DATA').state,'OK');
  assert.equal(state(c.root,'BANDEJA','RENDER').state,'OK');
  assert.equal(state(c.root,'BANDEJA','EFFECT'),undefined);
  assert.ok(!JSON.stringify(c.root.NodoSalud.snapshot()).includes('private_player'));
});
test('BANDEJA: HTTP sin contrato válido conserva la lista y deja error de datos visible',async()=>{
  const c=requestsHarness({data:{ok:false,reason:'secret'}});
  const response=await c.api.cargarSolicitudesPortal(true);
  assert.equal(response.error.code,'BANDEJA_INVALID_DATA');
  assert.deepEqual(c.V154P.solicitudes,[{ID:99}]);
  assert.equal(state(c.root,'BANDEJA','CONNECTED').state,'OK');
  assert.equal(state(c.root,'BANDEJA','DATA').state,'ERROR');
  assert.equal(state(c.root,'BANDEJA','RENDER'),undefined);
  assert.equal(c.calls.length,1);
});
test('BANDEJA: lista vacía válida es dato válido; render roto no se disfraza de éxito',async()=>{
  const c=requestsHarness({data:[]});c.deps.renderSolicitudesPortalEnInicio=()=>{throw new Error('DOM broken');};
  await assert.rejects(c.api.cargarSolicitudesPortal(true),/DOM broken/);
  assert.equal(state(c.root,'BANDEJA','DATA').state,'OK');
  assert.equal(state(c.root,'BANDEJA','RENDER').state,'ERROR');
  assert.equal(c.V154P.solicitudesLoading,false);
});
test('BANDEJA: sin confirmación DOM el estado es desconocido, no OK',async()=>{
  const c=requestsHarness({data:[]});c.deps.renderSolicitudesPortalEnInicio=noop;
  await c.api.cargarSolicitudesPortal(true);
  assert.equal(state(c.root,'BANDEJA','RENDER').state,'UNKNOWN');
});
test('BANDEJA: cambio de oficina durante la consulta no aplica ni acredita datos viejos',async()=>{
  let finish;const c=requestsHarness(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=c.api.cargarSolicitudesPortal(true);await Promise.resolve();
  c.root.pcOperativa='P2';finish({data:[{id:1}]});await pending;
  assert.deepEqual(c.V154P.solicitudes,[{ID:99}]);assert.deepEqual(c.root.NodoSalud.snapshot().rows,[]);
});
test('BANDEJA: sin contexto de salud la lectura legacy sigue y no inventa señales de oficina',async()=>{
  const c=requestsHarness({data:[{id:1}]});c.root.pcOperativa='';
  const response=await c.api.cargarSolicitudesPortal(true);
  assert.equal(response.error,undefined);assert.deepEqual(c.V154P.solicitudes,[{ID:1}]);
  assert.equal(c.calls.length,1);assert.equal(c.V154P.solicitudesLoading,false);
  assert.equal(c.box.innerHTML,'Lista vigente');assert.deepEqual(c.root.NodoSalud.snapshot().rows,[]);
});
test('BANDEJA: un contexto que aparece durante la consulta invalida la respuesta sin contexto',async()=>{
  let finish;const c=requestsHarness(()=>new Promise(resolve=>{finish=resolve;}));c.root.pcOperativa='';
  const pending=c.api.cargarSolicitudesPortal(true);await Promise.resolve();
  c.root.pcOperativa='P2';finish({data:[{id:1}]});const response=await pending;
  assert.equal(response.error.code,'STALE_OFFICE');assert.deepEqual(c.V154P.solicitudes,[{ID:99}]);
  assert.deepEqual(c.root.NodoSalud.snapshot().rows,[]);
});
function scriptHarness(relative,response,elements={}){
  const calls=[],root={pcOperativa:'P1',console:{log:noop,warn:noop,error:noop},
    document:{getElementById:id=>elements[id]||null},localStorage:{getItem:()=>null},
    setTimeout:noop,clearTimeout:noop,setInterval:noop,escapeHtml:s=>String(s||''),
    pcAliasesHist:()=>['P1'],solicitudes:[],_historialData:[{id:99}],normalizar:s=>String(s||'')};
  root.window=root;root.NodoSalud=health.create(root);
  root.supabaseClient={rpc:async(fn,args)=>{calls.push({fn,args});return typeof response==='function'?response():response;},
    from:table=>{const q={select(){return q;},in(){return q;},gte(){return q;},order(){return q;},limit(){calls.push({table});return typeof response==='function'?response():response;}};return q;}};
  vm.createContext(root);vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer',relative),'utf8'),root);
  return {root,calls,elements};
}
function historyHarness(response){
  const box={innerHTML:''},c=scriptHarness('core/historial-operaciones.js',response,{historialTable:box});
  c.root.pintarHistorialDesdeCache=noop;c.root.renderHistorialUnificado=noop;
  c.root.cargarOperacionesAgente=noop;c.root.filtrarHistorial=()=>{box.innerHTML='Historial actualizado';};
  return {...c,box};
}
test('HISTORIAL: consulta acotada real entrega señal de datos y render sin una consulta de salud adicional',async()=>{
  const c=historyHarness({data:[{id:1,usuario:'private_history'}],error:null});
  await c.root.cargarHistorial();
  assert.equal(c.calls.length,1);assert.equal(c.calls[0].table,'historial_ops');
  assert.equal(state(c.root,'HISTORIAL','CONNECTED').state,'OK');
  assert.equal(state(c.root,'HISTORIAL','DATA').state,'OK');
  assert.equal(state(c.root,'HISTORIAL','RENDER').state,'OK');
  assert.ok(!JSON.stringify(c.root.NodoSalud.snapshot()).includes('private_history'));
});
test('HISTORIAL: null no equivale a historial vacío y no borra la copia previa',async()=>{
  const c=historyHarness({data:null,error:null});await c.root.cargarHistorial();
  assert.equal(c.root._historialData[0].id,99);
  assert.equal(state(c.root,'HISTORIAL','DATA').code,'HISTORIAL_INVALID_DATA');
  assert.equal(state(c.root,'HISTORIAL','RENDER'),undefined);
});
test('HISTORIAL: fallo de render queda separado de la lectura correcta',async()=>{
  const c=historyHarness({data:[],error:null});c.root.filtrarHistorial=()=>{throw new Error('broken renderer');};
  await assert.rejects(c.root.cargarHistorial(),/broken renderer/);
  assert.equal(state(c.root,'HISTORIAL','DATA').state,'OK');
  assert.equal(state(c.root,'HISTORIAL','RENDER').state,'ERROR');
});
test('IDENTIDAD: lista paginada usa el orden del servidor y acredita sólo la pantalla actual',async()=>{
  const box={innerHTML:''};
  const c=scriptHarness('extensions/jugadores-crm.js',{data:[{usuario:'b_demo',total:2},{usuario:'a_demo',total:2}]},{crmResultados:box});
  c.root._crmBusq.cantidad=25;c.root._crmBusq.pagina=2;await c.root.crmBuscarServidor();
  assert.equal(c.calls.length,1);assert.equal(c.calls[0].args.p_limit,25);assert.equal(c.calls[0].args.p_offset,50);
  assert.ok(box.innerHTML.indexOf('b_demo')<box.innerHTML.indexOf('a_demo'));
  assert.equal(state(c.root,'IDENTIDAD','DATA').state,'OK');assert.equal(state(c.root,'IDENTIDAD','RENDER').state,'OK');
});
test('IDENTIDAD: ausencia de contexto telemetrico no deja una busqueda valida en Buscando',async()=>{
  const box={innerHTML:''};
  const c=scriptHarness('extensions/jugadores-crm.js',{data:[{usuario:'demo_sin_scope',total:1}]},{crmResultados:box});
  c.root.pcOperativa='';await c.root.crmBuscarServidor();
  assert.match(box.innerHTML,/demo_sin_scope/);assert.ok(!box.innerHTML.includes('Buscando'));
  assert.equal(c.root._crmBusq.total,1);assert.deepEqual(c.root.NodoSalud.snapshot().rows,[]);
});
test('IDENTIDAD: rechazo de autorización prueba conexión pero falla la entrega de datos',async()=>{
  const box={innerHTML:''};
  const c=scriptHarness('extensions/jugadores-crm.js',{error:{code:'42501',message:'permission denied for secret'}},{crmResultados:box});
  await c.root.crmBuscarServidor();
  assert.equal(state(c.root,'IDENTIDAD','CONNECTED').state,'OK');
  assert.equal(state(c.root,'IDENTIDAD','DATA').code,'UNAUTHORIZED');
  assert.equal(state(c.root,'IDENTIDAD','RENDER'),undefined);
  assert.ok(!JSON.stringify(c.root.NodoSalud.snapshot()).includes('secret'));
});
test('IDENTIDAD: la respuesta vieja no pisa el total ni la salud de la búsqueda nueva',async()=>{
  let finish,n=0;const box={innerHTML:''};
  const c=scriptHarness('extensions/jugadores-crm.js',()=>++n===1?new Promise(resolve=>{finish=resolve;}):{data:[]},{crmResultados:box});
  const old=c.root.crmBuscarServidor();await c.root.crmBuscarServidor();
  finish({data:[{usuario:'old_demo',total:400}]});await old;
  assert.equal(c.root._crmBusq.total,0);assert.ok(!box.innerHTML.includes('old_demo'));
  assert.equal(state(c.root,'IDENTIDAD','DATA').count,1);
});
test('CRM: búsqueda heredada no usa selects eliminados ni reordena respuesta resuelta',async()=>{
  const box={innerHTML:''};
  const c=scriptHarness('extensions/jugadores-crm.js',{data:{ok:true,jugadores:[{usuario:'b_demo',score:1},{usuario:'a_demo',score:9}]}},{crmTabla:box,crmBuscar:{value:'demo'}});
  await c.root.crmFiltrar();
  assert.equal(c.calls.length,1);assert.equal(c.calls[0].fn,'panel_crm_perfil_v1');
  assert.equal(c.calls[0].args.p_query,'demo');assert.ok(box.innerHTML.indexOf('b_demo')<box.innerHTML.indexOf('a_demo'));
});
