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
