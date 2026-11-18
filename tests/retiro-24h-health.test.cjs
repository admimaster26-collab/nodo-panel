'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','renderer','core','retiros-y-lealtad.js'),'utf8');

function cargar(resultados){
  const eventos=[];
  const root={
    console:{warn(){},error(){}},
    normalizar:value=>String(value||'').trim().toUpperCase(),
    formatFecha:value=>String(value||''),
    retiros24hCSV:[],
    NodoSalud:{begin:rama=>({record:(stage,state,code)=>eventos.push({rama,stage,state,code})})},
    supabaseClient:{from(tabla){
      const resultado=resultados[tabla];
      const q={select(){return q;},ilike(){return q;},eq(){return q;},in(){return q;},gte(){return q;},order(){return q;},limit(){return Promise.resolve(resultado);}};
      return q;
    }}
  };
  root.window=root;root.globalThis=root;
  vm.createContext(root);new vm.Script(source,{filename:'retiros-y-lealtad.js'}).runInContext(root);
  return {root,eventos};
}

test('un retiro encontrado no tapa que una de las dos fuentes de control falló',async()=>{
  const haceUnaHora=new Date(Date.now()-60*60*1000).toISOString();
  const h=cargar({
    landing_solicitudes:{data:null,error:{code:'NETWORK'}},
    historial_ops:{data:[{id:1,created_at:haceUnaHora,monto:5000,billetera_nombre:'demo',notas:''}],error:null}
  });
  const resultado=await h.root.verificarRetiro24h('demo');
  assert.equal(resultado.bloqueado,true,'el retiro hallado sigue bloqueando con evidencia positiva');
  assert.deepEqual(h.eventos.at(-1),{
    rama:'RETIROS',stage:'DATA',state:'DEGRADED',code:'RETIRO_24H_MATCH_PARCIAL'
  });
});

test('respuestas nulas sin error no se interpretan como consulta vacía confirmada',async()=>{
  const h=cargar({
    landing_solicitudes:{data:null,error:null},
    historial_ops:{data:[],error:null}
  });
  const resultado=await h.root.verificarRetiro24h('demo');
  assert.equal(resultado.bloqueado,false);
  assert.equal(h.eventos.at(-1).state,'DEGRADED');
  assert.equal(h.eventos.at(-1).code,'RETIRO_24H_SIN_COMPROBAR');
});

// Juan, 18/11: "la blacklist era la idea de unificación: si está en la blacklist no debería poder pedir
// retiro, y si el operador lo saca de la blacklist debería blanquearse el usuario". Con NODO beta la regla
// la da el servidor (canal nodo_beta_retiro_blacklist_v1) y seguir = sacarlo de la blacklist.
function conCanal(respuesta){
  const h=cargar({landing_solicitudes:{data:[],error:null},historial_ops:{data:[],error:null}});
  const llamadas=[];
  h.root.pcOperativa='P1';
  h.root.panelAPI={rpc:async(fn,args)=>{llamadas.push({fn,args});return respuesta(fn,args);}};
  return {...h,llamadas};
}
test('con NODO beta la regla es la blacklist del servidor, no las tres fuentes de antes',async()=>{
  const hace2h=new Date(Date.now()-2*3600000).toISOString(),en22h=new Date(Date.now()+22*3600000).toISOString();
  const h=conCanal(fn=>fn==='nodo_beta_retiro_blacklist_v1'?{data:{ok:true,contract:'nodo.beta.v1',bloqueado:true,historial_id:91,retiro_at:hace2h,hasta:en22h,monto:7000}}:{data:null});
  const r=await h.root.verificarRetiro24h('demo');
  assert.equal(r.bloqueado,true);assert.equal(r.origen,'BLACKLIST');assert.equal(r.historial_id,91);
  assert.match(r.mensaje,/está en la blacklist/);
  assert.equal(JSON.stringify(h.llamadas[0]),JSON.stringify({fn:'nodo_beta_retiro_blacklist_v1',args:{p_pc_codigo:'P1',p_usuario:'demo'}}));
  const libre=conCanal(()=>({data:{ok:true,contract:'nodo.beta.v1',bloqueado:false}}));
  assert.equal((await libre.root.verificarRetiro24h('demo')).bloqueado,false);
});
test('sin el canal (versión anterior u oficina sin beta) sigue el chequeo de siempre',async()=>{
  const haceUnaHora=new Date(Date.now()-3600000).toISOString();
  const h=cargar({landing_solicitudes:{data:[],error:null},historial_ops:{data:[{id:1,created_at:haceUnaHora,monto:5000,notas:''}],error:null}});
  h.root.pcOperativa='P1';
  h.root.panelAPI={rpc:async()=>({data:null,error:{message:'RPC_NO_PERMITIDA'}})};
  const r=await h.root.verificarRetiro24h('demo');
  assert.equal(r.bloqueado,true);assert.notEqual(r.origen,'BLACKLIST');
});
