'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function functions(file,names){
 const text=fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const found=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));assert.equal(found.length,names.length);return found.map(n=>n.getText(ast)).join('\n');
}
function harness(kind,override={}){
 let now=1700000000000;const calls=[];
 const cap=kind==='hist'?'historial.filters.v1':'nexo.export.v1';
 const response=extra=>({data:{ok:true,contract:'nodo.beta.v1',scope:{pc_codigo:'P1'},...extra}});
 const root={pcOperativa:'P1',_histBetaCapCache:{},_nexoCapCache:{},_histFiltrosActivos:()=>({}),Date:{now:()=>now},
  panelAPI:{getContext:async()=>({beta:{enabled:true,offices:['P1']}}),rpc:async(fn,args)=>{calls.push({fn,args});if(override.rpc)return override.rpc(fn,args,response);return fn==='nodo_beta_capacidades_v1'?response({capabilities:[cap]}):response({rows:[],totals:{total_rows:0},total:0,has_more:false,next_cursor:null});}}};
 root.window=root;vm.createContext(root);
 vm.runInContext(kind==='hist'?functions('renderer/core/historial-operaciones.js',['_histBetaConsultar']):functions('renderer/core/nexo.js',['_nexoCargarOpsBeta']),root);
 return {root,calls,run:()=>kind==='hist'?root._histBetaConsultar(null):root._nexoCargarOpsBeta('P1'),advance:()=>now+=60001};
}
for(const kind of ['hist','nexo']){
 test(kind+': real capability shape without enabled reaches filtered RPC',async()=>{const h=harness(kind);const r=await h.run();assert.equal(h.calls.length,2);assert.equal(h.calls[1].args.p_pc_codigo,'P1');assert.equal(kind==='hist'?r.mode:Array.isArray(r),kind==='hist'?'beta':true);});
 test(kind+': expired capability renegotiates and explicit absence keeps legacy',async()=>{let enabled=true;const h=harness(kind,{rpc:(fn,args,res)=>fn==='nodo_beta_capacidades_v1'?res({capabilities:enabled?[kind==='hist'?'historial.filters.v1':'nexo.export.v1']:[]}):res({rows:[],has_more:false,next_cursor:null})});await h.run();enabled=false;h.advance();const r=await h.run();assert.equal(kind==='hist'?r.mode:r,kind==='hist'?'legacy':null);assert.equal(h.calls.length,3);});
 test(kind+': wrong office or transport failure is visible, never a legacy fallback',async()=>{const h=harness(kind,{rpc:(fn,args,res)=>fn==='nodo_beta_capacidades_v1'?{data:{ok:true,contract:'nodo.beta.v1',scope:{pc_codigo:'P2'},capabilities:['historial.filters.v1','nexo.export.v1']}}:res({rows:[]})});const r=await h.run();assert.ok(r.error);assert.equal(h.calls.length,1);});
}
test('Nexo continues beyond old 16-page ceiling and rejects repeated cursor',async()=>{
 let page=0;const h=harness('nexo',{rpc:(fn,args,res)=>fn==='nodo_beta_capacidades_v1'?res({capabilities:['nexo.export.v1']}):res({rows:[{id:String(++page)}],has_more:page<17,next_cursor:page<17?{id:String(page)}:null,total:17})});assert.equal((await h.run()).length,17);assert.equal(h.root._nexoEstado.completo,true);
 const broken=harness('nexo',{rpc:(fn,args,res)=>fn==='nodo_beta_capacidades_v1'?res({capabilities:['nexo.export.v1']}):res({rows:[{id:'1'}],has_more:true,next_cursor:{id:'1'}})});assert.equal((await broken.run()).error.code,'NEXO_INVALID_CURSOR');
});
test('Nexo stops export requiring reconciliation; does not silently export subset',async()=>{const h=harness('nexo',{rpc:(fn,args,res)=>fn==='nodo_beta_capacidades_v1'?res({capabilities:['nexo.export.v1']}):res({rows:[],has_more:false,next_cursor:null,requiere_revision:true})});assert.equal((await h.run()).error.code,'NEXO_REVISION_REQUIRED');});

test('Historial draws resolved rows directly; filter change requests SQL, no filtering of old page',()=>{
 const rows=[{id:'1',usuario:'usuario_del_servidor'}];let filtros={q:'uno'},drawn=null,scheduled=null,requests=0;
 const elements={histFilterTotal:{},histFilterSummary:{}};
 const root={pcOperativa:'P1',_histBetaActive:true,_histBetaTotals:{total_rows:700},_historialData:rows,
  _histFiltrosActivos:()=>filtros,document:{getElementById:id=>elements[id]},renderHistorial:r=>drawn=r,
  cargarHistorial:()=>requests++,clearTimeout:()=>{},setTimeout:fn=>{scheduled=fn;return 1;}};
 root.window=root;root._histBetaFiltersKey=JSON.stringify(['P1',filtros]);vm.createContext(root);vm.runInContext(functions('renderer/core/historial-operaciones.js',['_histMostrarPaginaBeta']),root);
 assert.equal(root._histMostrarPaginaBeta(),true);assert.equal(drawn,rows);assert.match(elements.histFilterTotal.textContent,/700/);
 filtros={q:'fuera_de_esta_pagina'};drawn=null;root._histMostrarPaginaBeta();assert.equal(drawn,null);scheduled();assert.equal(requests,1);
 root._histBetaActive=false;assert.equal(root._histMostrarPaginaBeta(),false);
});
test('Historial discards slow response after filter changed',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const h=harness('hist',{rpc:async(fn,args,res)=>{if(fn==='nodo_beta_capacidades_v1')return res({capabilities:['historial.filters.v1']});await gate;return res({rows:[]});}});
 const pending=h.run();h.root._histFiltrosActivos=()=>({q:'nuevo'});release();assert.equal((await pending).error.code,'HISTORIAL_CONTEXT_CHANGED');
});
test('Nexo never serves another office cached export',async()=>{
 const h=harness('nexo');h.root._nexoOpsCache=[{id:'foreign'}];h.root._nexoOpsCachePc='P2';h.root._nexoOpsCacheAt=1700000000000;
 vm.runInContext(functions('renderer/core/nexo.js',['_nexoCargarOpsCompletas']),h.root);
 const r=await h.root._nexoCargarOpsCompletas(false);assert.equal(r.length,0);assert.equal(h.root._nexoOpsCachePc,'P1');
});
