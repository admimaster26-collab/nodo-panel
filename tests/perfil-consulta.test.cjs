const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {create}=require('../renderer/domain/perfil-consulta.js');
const health=require('../renderer/runtime/integration-health.js');
const CONTRACT='nodo.beta.v1';
const CAP='nodo_beta_capacidades_v1', SUMMARY='nodo_beta_perfil_v1', DETAIL='nodo_beta_perfil_detalle_v1';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function envelope(args,extra){
  return {data:{ok:true,contract:CONTRACT,scope:{pc_codigo:args.p_pc_codigo,usuario:args.p_usuario,pc_codigos:[args.p_pc_codigo,'PC'+args.p_pc_codigo.slice(1)]},...extra}};
}
function summary(args,extra={}){
  return envelope(args,{resumen:{usuario:args.p_usuario,totalOps:6,cargas:3,retiros:2,errores:1,montoCargas:0,montoRetiros:20,neto:-20,
    requiere_revision:false,cbu_fuente:null,
    turnoFrecuente:'TN',ultimaCarga:null,telefono:'1111111111',titular:'Titular servidor'},
    agente:{totalOps:2,cargas:1,retiros:1,montoCargas:700,montoRetiros:500},detalle_total:6,agente_total:2,...extra});
}
function row(id='9007199254740994',extra={}){
  return {id,created_at:'2026-10-28T10:00:00+00:00',pc_codigo:'P1',usuario:'demo',tipo:'CARGA',monto:999,estado:'ERROR',...extra};
}
function page(args,rows,hasMore=false){
  const last=rows.at(-1);
  return envelope(args,{rows,has_more:hasMore,next_cursor:hasMore?{id:last.id,created_at:last.created_at}:null});
}
function harness(overrides={}){
  const calls=[];
  const root={pcOperativa:'P1',panelAPI:{
    getContext:async()=>({beta:{enabled:true,offices:['P1','P2'],build:'2.1.5-test'}}),
    rpc:async(fn,args)=>{
      calls.push({fn,args});
      if(overrides[fn]) return overrides[fn](args);
      if(fn===CAP)return envelope(args,{capabilities:['perfil.summary.v1','perfil.detail.v1']});
      if(fn===SUMMARY)return summary(args);
      if(fn===DETAIL)return page(args,[row(undefined,{usuario:args.p_usuario,pc_codigo:args.p_pc_codigo})]);
      throw new Error('Unexpected RPC '+fn);
    }
  }};
  root.NodoSalud=health.create(root);
  const api=create(root);
  return {root,api,calls};
}

test('resumen servidor conserva cero y separa CSV; detalle no recalcula montos ni activa chat',async()=>{
  const h=harness(),s=await h.api.load('  DeMo  ');
  assert.equal(s.resumen.montoCargas,0);assert.equal(s.agente.montoCargas,700);
  assert.equal(s.rows[0].monto,999);assert.equal(s.detalleTotal,6);
  assert.equal(s.rows[0].id,'9007199254740994');
  assert.deepEqual(h.calls.map(c=>c.fn),[CAP,SUMMARY,DETAIL]);
  assert.equal(h.calls[0].args.p_activate,false);
  assert.equal(h.calls[2].args.p_limit,50);assert.equal(h.calls[2].args.p_cursor,null);
  assert.ok(h.calls.every(c=>!Object.hasOwn(c.args,'p_token')));
  await h.api.load('demo');assert.equal(h.calls.length,3,'reabrir usa cache del mismo usuario/oficina');
});

test('más páginas usa cursor bigint y fecha nula sin repetir el resumen',async()=>{
  const h=harness({[DETAIL]:args=>args.p_cursor
    ?page(args,[row('9007199254740992',{created_at:null})])
    :page(args,[row('9007199254740994'),row('9007199254740993',{created_at:null})],true)});
  await h.api.load('demo');const s=await h.api.load('demo',{more:true});
  assert.deepEqual(s.rows.map(r=>r.id),['9007199254740994','9007199254740993','9007199254740992']);
  assert.deepEqual(h.calls.at(-1).args.p_cursor,{id:'9007199254740993',created_at:null});
  assert.equal(h.calls.filter(c=>c.fn===SUMMARY).length,1);assert.equal(s.hasMore,false);
  await h.api.load('demo',{more:true});assert.equal(h.calls.length,4);
});

test('consultas simultáneas del mismo usuario comparten vuelo; usuarios distintos quedan aislados',async()=>{
  const gate=deferred(),h=harness({[DETAIL]:async args=>{await gate.promise;return page(args,[row(undefined,{usuario:args.p_usuario})]);}});
  const a=h.api.load('demo'),b=h.api.load('DEMO'),c=h.api.load('otro');
  assert.equal(a,b);gate.resolve();await Promise.all([a,b,c]);
  assert.equal(h.calls.filter(c=>c.fn===CAP).length,1);assert.equal(h.calls.filter(c=>c.fn===DETAIL).length,2);
  assert.equal(h.api.snapshot('demo').rows[0].usuario,'demo');assert.equal(h.api.snapshot('otro').rows[0].usuario,'otro');
});

test('cambio de oficina y vuelta invalida caché y respuestas pendientes anteriores',async()=>{
  const gate=deferred(),h=harness({[DETAIL]:async args=>{if(args.p_pc_codigo==='P1')await gate.promise;return page(args,[row(undefined,{pc_codigo:args.p_pc_codigo})]);}});
  const old=h.api.load('demo');const rejected=assert.rejects(old,/PERFIL_CONTEXT_CHANGED/);await settle();
  h.root.pcOperativa='P2';assert.equal(h.api.snapshot('demo').rows.length,0);
  await h.api.load('demo');assert.equal(h.api.snapshot('demo').rows[0].pc_codigo,'P2');
  h.root.pcOperativa='P1';assert.equal(h.api.snapshot('demo').rows.length,0);
  gate.resolve();await rejected;assert.equal(h.api.snapshot('demo').resumen,null);
  await h.api.load('demo');assert.equal(h.api.snapshot('demo').rows[0].pc_codigo,'P1');
});

test('sólo clientes sin beta o sin capacidades explícitas vuelven a legacy',async()=>{
  const disabled=harness();disabled.root.panelAPI.getContext=async()=>({beta:{enabled:false}});
  assert.equal((await disabled.api.load('demo')).mode,'legacy');assert.equal(disabled.calls.length,0);
  const old=harness();delete old.root.panelAPI.getContext;
  assert.equal((await old.api.load('demo')).mode,'legacy');
  const missing=harness({[CAP]:args=>envelope(args,{capabilities:['chat.list.v1']})});
  const s=await missing.api.load('demo');assert.equal(s.mode,'legacy');assert.equal(s.loading,false);assert.equal(missing.calls.length,1);
  const bad=harness();bad.root.panelAPI.getContext=async()=>null;
  assert.equal((await bad.api.load('demo')).error,'PERFIL_CONTEXT_INVALID');assert.notEqual(bad.api.snapshot('demo').mode,'legacy');
});

test('fallo beta no cae a legacy ni equivale a historial vacío y permite reintento',async()=>{
  let offline=true;
  const h=harness({[DETAIL]:args=>offline?{error:{code:'OFFLINE',message:'private value'}}:page(args,[])});
  const a=await h.api.load('demo');assert.equal(a.mode,'beta');assert.equal(a.loaded,false);assert.ok(a.error);assert.equal(a.resumen.totalOps,6);
  offline=false;const b=await h.api.load('demo',{refresh:true});assert.equal(b.loaded,true);assert.deepEqual(b.rows,[]);assert.equal(b.error,'');
  assert.ok(!JSON.stringify(h.root.NodoSalud.snapshot()).includes('private value'));
  const negotiation=harness({[CAP]:()=>{throw new Error('network');}});
  const failed=await negotiation.api.load('demo');assert.ok(failed.error);assert.notEqual(failed.mode,'legacy');
});

test('error al pedir más conserva las filas anteriores y el cursor para reintentar',async()=>{
  let offline=true;
  const h=harness({[DETAIL]:args=>!args.p_cursor?page(args,[row()],true):offline?{data:null}:page(args,[row('9007199254740993')])});
  await h.api.load('demo');const failed=await h.api.load('demo',{more:true});
  assert.equal(failed.rows.length,1);assert.ok(failed.error);assert.equal(failed.hasMore,true);
  offline=false;const ok=await h.api.load('demo',{more:true});assert.equal(ok.rows.length,2);assert.equal(ok.error,'');
});

test('respuestas de oficina o usuario ajenos y formas incompletas no se aplican',async()=>{
  const corruptions=[
    r=>{r.data.scope.pc_codigo='P2';},r=>{r.data.scope.usuario='otro';},r=>{r.data.rows[0].usuario='otro';},
    r=>{r.data.rows[0].pc_codigo='P9';},r=>{r.data.rows[0].id=9007199254740994;},
    r=>{r.data.rows=null;},r=>{r.data.has_more='false';},r=>{delete r.data.next_cursor;},
    r=>{r.data.rows[0].created_at='invalid';},r=>{r.data.rows.push({...r.data.rows[0]});}
  ];
  for(const corrupt of corruptions){
    const h=harness({[DETAIL]:args=>{const r=page(args,[row()]);corrupt(r);return r;}});
    const s=await h.api.load('demo');assert.ok(s.error);assert.equal(s.loaded,false);assert.equal(s.rows.length,0);
  }
});

test('acepta sólo aliases declarados en el scope servidor y usuario con símbolos exactos',async()=>{
  const h=harness({[DETAIL]:args=>{const r=page(args,[row(undefined,{pc_codigo:'OFI_HISTORICA',usuario:args.p_usuario})]);r.data.scope.pc_codigos.push('OFI_HISTORICA');return r;}});
  const s=await h.api.load(' A_%ñ ');assert.equal(s.error,'');assert.equal(s.rows[0].usuario,'a_%ñ');
  assert.equal(h.calls.find(c=>c.fn===DETAIL).args.p_usuario,'a_%ñ');
});

test('cursor incorrecto y repetición de filas entre páginas no avanzan la consulta',async()=>{
  const broken=harness({[DETAIL]:args=>{const r=page(args,[row()],true);r.data.next_cursor.id='1';return r;}});
  assert.equal((await broken.api.load('demo')).error,'PERFIL_INVALID_CURSOR');
  const repeated=harness({[DETAIL]:args=>page(args,[row()],true)});
  await repeated.api.load('demo');const r=await repeated.api.load('demo',{more:true});
  assert.ok(r.error);assert.equal(r.rows.length,1);assert.equal(r.cursor.id,'9007199254740994');
});

test('cursor respeta microsegundos, desempate bigint y transición a fechas nulas',async()=>{
  const h=harness({[DETAIL]:args=>!args.p_cursor
    ?page(args,[row('8',{created_at:'2026-10-28T10:00:00.000002+00:00'}),row('9',{created_at:'2026-10-28T10:00:00.000001+00:00'})],true)
    :page(args,[row('7',{created_at:'2026-10-28T10:00:00.000001+00:00'}),row('10',{created_at:null})])});
  assert.equal((await h.api.load('demo')).error,'');
  assert.deepEqual((await h.api.load('demo',{more:true})).rows.map(r=>r.id),['8','9','7','10']);
  const forward=harness({[DETAIL]:args=>!args.p_cursor?page(args,[row('1',{created_at:null})],true):page(args,[row('2')])});
  await forward.api.load('demo');assert.equal((await forward.api.load('demo',{more:true})).error,'PERFIL_INVALID_CURSOR');
});

test('resumen malformado no inventa cero y refresh fallido conserva última respuesta',async()=>{
  let bad=false;
  const h=harness({[SUMMARY]:args=>{const r=summary(args);if(bad)r.data.resumen.montoCargas=null;return r;}});
  await h.api.load('demo');bad=true;const s=await h.api.load('demo',{refresh:true});
  assert.equal(s.error,'PERFIL_INVALID_SUMMARY');assert.equal(s.resumen.montoCargas,0);
  const fresh=harness({[SUMMARY]:()=>({data:null})});assert.equal((await fresh.api.load('demo')).resumen,null);
  for(const invalid of [undefined,null,'false',0]){
    const badFlag=harness({[SUMMARY]:args=>{const r=summary(args);r.data.resumen.requiere_revision=invalid;return r;}});
    assert.equal((await badFlag.api.load('demo')).error,'PERFIL_INVALID_SUMMARY');
  }
  const badSource=harness({[SUMMARY]:args=>{const r=summary(args);r.data.resumen.cbu_fuente='PAGADO';return r;}});
  assert.equal((await badSource.api.load('demo')).error,'PERFIL_INVALID_SUMMARY');
});

test('salud acredita render sólo después de render real y sin errores',async()=>{
  const h=harness();await h.api.load('demo');
  assert.equal(h.root.NodoSalud.snapshot().rows.find(r=>r.stage==='RENDER'),undefined);
  h.api.rendered('demo');assert.equal(h.root.NodoSalud.snapshot().rows.find(r=>r.stage==='RENDER').state,'OK');
  h.root.pcOperativa='P2';h.api.rendered('demo');assert.deepEqual(h.root.NodoSalud.snapshot().rows,[]);
});

test('refresco pendiente no acredita su render usando datos de la consulta anterior',async()=>{
  const gate=deferred();let wait=false;
  const h=harness({[DETAIL]:async args=>{if(wait)await gate.promise;return page(args,[row()]);}});
  await h.api.load('demo');h.api.rendered('demo');wait=true;
  const refresh=h.api.load('demo',{refresh:true});h.api.rendered('demo');
  assert.equal(h.root.NodoSalud.snapshot().rows.find(r=>r.stage==='RENDER').count,1);
  gate.resolve();await refresh;h.api.rendered('demo');
  assert.equal(h.root.NodoSalud.snapshot().rows.find(r=>r.stage==='RENDER').count,2);
});

function rendererHarness(overrides={}){
  const h=harness(overrides),elements=new Map(),legacyCalls=[],movements={},players={};
  function node(tag){
    const n={tagName:tag.toUpperCase(),id:'',innerHTML:'',addEventListener(){},remove(){if(elements.get(n.id)===n)elements.delete(n.id);}};
    return n;
  }
  const document={getElementById:id=>elements.get(id)||null,createElement:node,
    head:{appendChild(n){elements.set(n.id,n);}},body:{appendChild(n){elements.set(n.id,n);if(n.id==='perfilJugadorOverlay'){const box=node('div');box.id='pjFichaBox';elements.set(box.id,box);}}}};
  Object.assign(h.root,{document,console:{warn(){},error(){}},localStorage:{getItem(){return null;}},
    _jugStoreAll:()=>players,_movStoreAll:()=>movements,_movParseNotas:()=>({}),_historialData:[],
    pcAliasesHist:()=>[h.root.pcOperativa,h.root.pcOperativa.replace(/^P/,'PC')],
    escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    money:value=>'$'+value,formatFecha:value=>String(value||''),_tel:value=>value,toast(){},
    abrirModal:(title,body)=>{h.modal={title,body};},cerrarModal(){},
    supabaseClient:{rpc:async(fn,args)=>{legacyCalls.push({fn,args});if(overrides.legacyRpc)return overrides.legacyRpc(fn,args);
      if(fn==='panel_usuario_ficha')return {data:{ok:true,vinculo:null,eventos:[],alertas:[]}};
      if(fn==='panel_crm_perfil_v1')return {data:{ok:true,jugadores:[summary({p_usuario:args.p_usuario}).data.resumen]}};
      throw new Error(fn);
    },from(table){const q={select(){return q;},in(){return q;},ilike(column,value){q.pattern=value;return q;},order(){return q;},limit(limit){legacyCalls.push({table,limit,pattern:q.pattern});return overrides.legacyRows?overrides.legacyRows():Promise.resolve({data:[]});}};return q;}}});
  h.root.window=h.root;h.root.NodoPerfilConsulta=h.api;
  vm.createContext(h.root);vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/core/perfil-jugador.js'),'utf8'),h.root);
  return Object.assign(h,{elements,legacyCalls,movements,players,html:()=>elements.get('perfilJugadorOverlay')?.innerHTML||''});
}

test('renderer mantiene acciones y locales; suma servidor cero y paginado visibles',async()=>{
  const h=rendererHarness({[DETAIL]:args=>page(args,[row('20'),row('19')],true)});
  h.players.demo={telefonos:{123:{verificado:true}},titulares:{x:{raw:'Titular local',veces:1}},cbus:{x:{raw:'alias.local',veces:1}},bonos:[{estado:'APLICADO',pct:10}]};
  h.movements.unknown={id:'1',usuario:'demo',tipo:'RETIRO',monto:888,notas:'detalle local'};
  h.movements.scoped={id:'2',usuario:'demo',pc_codigo:'P1',tipo:'CARGA',monto:777};
  h.movements.foreign={id:'3',usuario:'demo',pc_codigo:'P2',tipo:'CARGA',monto:666};
  h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
  const html=h.html();assert.match(html,/2 operaciones cargadas de 6/);assert.match(html,/Ver más operaciones/);
  assert.match(html,/Cargas confirmadas<\/span><span[^>]+>3 · \$0/);assert.match(html,/Importación del agente/);
  assert.match(html,/Registros no confirmados<\/span><span[^>]+>1<\/span>/);assert.match(html,/6 registros en el historial/);
  assert.match(html,/Datos locales sin oficina identificada/);assert.match(html,/Detalles locales de esta oficina/);
  assert.ok(html.includes('$888') && html.includes('$777') && !html.includes('$666'));
  for(const action of ['pjDatosIngreso','nodoChatNuevo','crmCopiarPromo','crmPushIndividual','crmEnlaceAcceso','cerrarPerfilJugador']) assert.ok(html.includes(action));
  assert.match(html,/alias.local/);assert.match(html,/Titular local/);assert.match(html,/10%/);
  assert.deepEqual(Array.from(h.root.arbolUsuario('demo'),r=>r.id),['20','19'],'preserva orden servidor incluso con ids numéricos');
  assert.equal(h.legacyCalls.some(c=>c.table==='historial_ops'),false);assert.equal(h.legacyCalls.some(c=>c.fn==='panel_crm_perfil_v1'),false);
  assert.deepEqual(h.legacyCalls.find(c=>c.fn==='panel_usuario_ficha').args.p_pc_codigos,['P1','PC1']);
});

test('renderer no muestra vacío ante error beta ni dispara consulta legacy',async()=>{
  const h=rendererHarness({[DETAIL]:()=>({error:{code:'OFFLINE'}})});
  h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
  assert.match(h.html(),/No se pudo consultar la actividad/);assert.match(h.html(),/Reintentar/);
  assert.doesNotMatch(h.html(),/Sin operaciones registradas/);assert.equal(h.legacyCalls.some(c=>c.table),false);
});

test('reversiones pendientes degradan datos y ocultan totales en perfil y detalle sin recalcular',async()=>{
  const h=rendererHarness({[SUMMARY]:args=>{const r=summary(args);Object.assign(r.data.resumen,{requiere_revision:true,montoCargas:12345,montoRetiros:2345,neto:10000});return r;}});
  h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
  const s=h.api.snapshot('demo');assert.equal(s.error,'');assert.equal(s.resumen.requiere_revision,true);
  assert.match(h.html(),/Reversiones pendientes de cotejo/);
  assert.doesNotMatch(h.html(),/\$12345|\$2345|\$10000/);assert.match(h.html(),/Importación del agente/);
  const sample=h.root.NodoSalud.snapshot().rows.find(r=>r.integration==='IDENTIDAD'&&r.stage==='DATA');
  assert.equal(sample.state,'DEGRADED');assert.equal(sample.code,'PERFIL_REVISION_PENDING');
  h.root.pjPerfilDetalle('9007199254740994','demo','',false);
  assert.match(h.modal.body,/Reversiones pendientes de cotejo/);assert.doesNotMatch(h.modal.body,/\$12345|\$2345|\$10000/);
  assert.match(h.modal.body,/\$999/,'el registro individual conserva su importe para cotejar');
});

test('CBU declarado y CBU de retiro confirmado muestran su procedencia sin afirmar pago declarado',async()=>{
  for(const source of ['VINCULO_DECLARADO','RETIRO_CONFIRMADO']){
    const h=rendererHarness({[SUMMARY]:args=>{const r=summary(args);Object.assign(r.data.resumen,{cbu:'alias.demo',cbu_fuente:source});return r;}});
    h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
    assert.match(h.html(),/alias.demo/);assert.doesNotMatch(h.html(),/último retiro pagado/);
    if(source==='VINCULO_DECLARADO'){
      assert.match(h.html(),/Destino declarado en el vínculo/);assert.match(h.html(),/no acredita un pago/);
      assert.doesNotMatch(h.html(),/Tomado de un retiro confirmado/);
    }else assert.match(h.html(),/Tomado de un retiro confirmado/);
  }
});

test('cambiar jugador o cerrar impide reabrir y repintar una respuesta tardía',async()=>{
  const gate=deferred(),h=rendererHarness({[DETAIL]:async args=>{if(args.p_usuario==='viejo')await gate.promise;return page(args,[row(undefined,{usuario:args.p_usuario})]);}});
  h.root.abrirPerfilJugador('viejo');await settle();h.root.abrirPerfilJugador('nuevo');await h.root.pjPerfilConsultar(false,false);
  assert.match(h.html(),/nuevo/);gate.resolve();await settle();assert.match(h.html(),/nuevo/);assert.doesNotMatch(h.html(),/>viejo</);
  const late=deferred(),closed=rendererHarness({[DETAIL]:async args=>{await late.promise;return page(args,[row()]);}});
  closed.root.abrirPerfilJugador('demo');await settle();closed.root.cerrarPerfilJugador();late.resolve();await settle();assert.equal(closed.html(),'');
});

test('ficha tardía no escribe sobre el mismo usuario en otra oficina',async()=>{
  const gate=deferred(),h=rendererHarness({legacyRpc:async(fn,args)=>{
    if(fn!=='panel_usuario_ficha')throw new Error(fn);
    if(args.p_pc_codigos[0]==='P1')await gate.promise;
    return {data:{ok:true,vinculo:{telefono_canon:args.p_pc_codigos[0]+' telefono'},eventos:[],alertas:[]}};
  }});
  h.root.abrirPerfilJugador('demo');await settle();h.root.pcOperativa='P2';h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
  assert.match(h.root.__perfilVista.fichaHtml,/P2 telefono/);gate.resolve();await settle();
  assert.match(h.root.__perfilVista.fichaHtml,/P2 telefono/);assert.doesNotMatch(h.root.__perfilVista.fichaHtml,/P1 telefono/);
});

test('detalle paginado abre su movimiento aunque no esté en historial global',async()=>{
  const h=rendererHarness({[DETAIL]:args=>page(args,[row('300',{monto:50,estado:'OK',solicitud_id:'410'})])});
  h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
  h.root.pjPerfilDetalle('300','demo','410',false);
  assert.match(h.modal.body,/\$50/);assert.match(h.modal.body,/6<\/b> registros en el historial/);
  assert.match(h.modal.body,/Detalle cargado de demo · 1 operaciones/);
});

test('legacy mantiene consulta anterior con cache por oficina y error reintentable',async()=>{
  let fail=true;
  const h=rendererHarness({legacyRows:()=>Promise.resolve(fail?{error:{code:'OFFLINE'}}:{data:[row('44',{usuario:'a_%'})]})});
  h.root.panelAPI.getContext=async()=>({beta:{enabled:false}});
  h.root.abrirPerfilJugador('a_%');await h.root.pjPerfilConsultar(false,false);
  const key=JSON.stringify(['P1','a_%']);assert.equal(h.root._arbolFullCache[key].__loaded,undefined);assert.equal(h.root._arbolFullCache[key].__error,true);
  assert.match(h.html(),/No se pudo consultar la actividad/);assert.doesNotMatch(h.html(),/Sin operaciones registradas/);
  assert.equal(h.legacyCalls.find(c=>c.table).pattern,'a\\_\\%');
  fail=false;await h.root.pjPerfilConsultar(false,true);assert.equal(h.root._arbolFullCache[key].__loaded,true);
  h.root.pcOperativa='P2';assert.equal(h.root.arbolUsuario('a_%').length,0);
});

test('respuesta legacy anterior no pisa un refresco posterior del mismo usuario/oficina',async()=>{
  const gate=deferred();let calls=0;
  const h=rendererHarness({legacyRows:()=>++calls===1?gate.promise:Promise.resolve({data:[row('2')]})});
  delete h.root.NodoPerfilConsulta;
  const old=h.root.cargarArbolCompletoUsuario('demo');
  const key=JSON.stringify(['P1','demo']);delete h.root._arbolFullCache[key];
  await h.root.cargarArbolCompletoUsuario('demo');gate.resolve({data:[row('1')]});await old;
  assert.equal(h.root._arbolFullCache[key][0].id,'2');
});

test('observaciones de identidad (perfil.identity.v1), recarga en caliente y persistencia local ACK',async()=>{
  const IDENTITY='nodo_beta_perfil_identidad_v1';
  let configEnabled=false;
  const h=rendererHarness({
    [CAP]:args=>envelope(args,{capabilities:['perfil.summary.v1','perfil.detail.v1','perfil.identity.v1']}),
    [IDENTITY]:args=>envelope(args,{
      total:1,
      locales_disponibles:true,
      rows:[{id:'obs-1',campo:'ip',valor:'181.10.20.30',fuente:'landing_solicitudes',atributo:'ip',estado:'PENDIENTE',fecha_tipo:'EVENTO',fecha:'2026-10-28T10:00:00+00:00',pc_codigo:args.p_pc_codigo,usuario:args.p_usuario}],
      has_more:false,
      next_cursor:null
    })
  });
  h.root.panelAPI.getContext=async()=>({beta:{enabled:configEnabled,offices:['P1'],build:'2.1.5-test'}});
  assert.equal((await h.api.load('demo')).mode,'legacy');
  configEnabled=true;
  const loaded=await h.api.load('demo');
  assert.equal(loaded.mode,'beta');
  assert.equal(loaded.identidadLoaded,true);
  assert.equal(loaded.identidadLocalesDisponibles,true);
  assert.equal(loaded.identidad.length,1);
  assert.equal(loaded.identidad[0].valor,'181.10.20.30');

  h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
  assert.match(h.html(),/Observaciones de identidad/);
  assert.match(h.html(),/181\.10\.20\.30/);

  const persistencia=require('../renderer/domain/persistencia-sync.js');
  const store=new Map([
    ['nodo_jugadores_local_v2',JSON.stringify({demo:{usuario:'demo',pc_codigo:'P1',telefonos:{'1122334455':{raw:'1122334455',veces:1,verificado:true}},cbus:{},titulares:{},bonos:[]}})],
    ['nodo_movimientos_v1',JSON.stringify({'99':{id:'99',pc_codigo:'P1',usuario:'demo',tipo:'RETIRO',monto:500,estado:'OK',cbu:'alias.sync'}})],
    ['nodo.cotejo.resueltos',JSON.stringify({'demo|1122334455':{usuario:'demo',telefono:'1122334455',cuando:1700000000000}})],
    ['nodo_chu_pendientes',JSON.stringify([{id:'501',usuario:'demo',estado:'PENDIENTE',motivo:'OFFLINE'}])]
  ]);
  const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),length:0,key:()=>null};
  const syncCalls=[];
  const pClient=persistencia.create({
    getOffice:()=>'P1',
    instalacion:'pc-p1-unit',
    storage,
    panelAPI:{
      getContext:async()=>({beta:{enabled:true,offices:['P1'],build:'2.1.5-test'}}),
      rpc:async(fn,args)=>{
        syncCalls.push({fn,args});
        if(fn===CAP)return {data:{ok:true,contract:CONTRACT,scope:{pc_codigo:'P1'},capabilities:['persistence.local.v1']}};
        if(fn==='nodo_beta_persistencia_sync_v1'){
          return {data:{
            ok:true,contract:CONTRACT,scope:{pc_codigo:'P1',instalacion:'pc-p1-unit',version:'2.1.5-test'},
            protocol:'persistence.cas.v1',conflicts:[],
            receipts:Object.entries(args.p_lote).flatMap(([family,items])=>items.map(item=>{
              const id=family==='jugadores'?item.source_id:family==='movimientos'?item.movimiento_key:family==='cotejos'?item.cotejo_key:item.item_id;
              return {family,id,key:family==='jugadores'?[id,item.campo]:family==='colas'?['pc-p1-unit',item.cola_tipo,id]:[id],
                accepted:true,revision:'1',mutation_id:item._sync.mutation_id};
            })),
            acknowledged:{
              jugadores:args.p_lote.jugadores.map(x=>x.source_id),
              movimientos:args.p_lote.movimientos.map(x=>x.movimiento_key),
              cotejos:args.p_lote.cotejos.map(x=>x.cotejo_key),
              colas:args.p_lote.colas.map(x=>x.item_id)
            },
            accepted_total:4
          }};
        }
        throw new Error('Unexpected RPC '+fn);
      }
    }
  });
  const res1=await pClient.sync();
  assert.equal(res1.synced,true);
  assert.equal(res1.acceptedTotal,4);
  const res2=await pClient.sync();
  assert.equal(res2.empty,true,'después del ACK del servidor no vuelve a enviar el mismo lote');
});

// milo30kc, 6/11: tres titulares y un retiro a la cuenta de otra persona a la vista, y la ficha
// mostraba un solo titular "·reg" y "Sin destinos registrados". Las tarjetas leían sólo la base
// local de la PC, que no tenía esas operaciones.
test('titulares y destinos salen de las operaciones aunque esta PC no tenga datos locales',async()=>{
  const rows=[
    row('30',{tipo:'CARGA',estado:'OK',notas:'#1 · Titular: Daniel Demo'}),
    row('29',{tipo:'CARGA',estado:'OK',notas:'#2 · Titular: Daniel Demo'}),
    row('28',{tipo:'CARGA',estado:'OK',notas:'#3 · Titular: Abila Demo'}),
    row('27',{tipo:'RETIRO',estado:'OK',notas:'#4 · Titular: Rosa Demo · Alias: rosa.demo.mp'})];
  const h=rendererHarness({[DETAIL]:args=>page(args,rows)});
  h.root._movParseNotas=n=>({titular:((String(n).match(/Titular:\s*([^·|]+)/)||[])[1]||'').trim(),
    destino:((String(n).match(/Alias:\s*([^·|]+)/)||[])[1]||'').trim(),cbu:'',obs:''});
  h.root.abrirPerfilJugador('demo');await h.root.pjPerfilConsultar(false,false);
  const html=h.html();
  assert.match(html,/Daniel Demo <span[^>]*>×2 cargas</);
  assert.match(html,/Abila Demo <span[^>]*>×1 carga</);
  assert.match(html,/Rosa Demo <span[^>]*>×1 retiro</);
  assert.match(html,/rosa\.demo\.mp/);
  assert.match(html,/titular distinto/,'quien sólo cobra y nunca cargó se marca');
  assert.doesNotMatch(html,/Sin destinos registrados/);
});
