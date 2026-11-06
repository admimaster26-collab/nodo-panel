'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const FILE=path.join(__dirname,'..','renderer','core','automatizaciones.js');
const SOURCE=fs.readFileSync(FILE,'utf8');
function functionSource(name){
  const match=new RegExp('async function '+name+'\\(').exec(SOURCE);
  assert.ok(match,'existe '+name);
  const begin=SOURCE.indexOf('{',match.index);let depth=0;
  for(let i=begin;i<SOURCE.length;i++){
    if(SOURCE[i]==='{')depth++;
    if(SOURCE[i]==='}'&&!--depth)return SOURCE.slice(match.index,i+1);
  }
  throw new Error('funcion incompleta: '+name);
}

const marker={retiro_instrumento_v1:{instrumento_id:'inst-demo',estado:'VALIDADO'}};
function harness({validator,seal,withdrawal}={}){
  const events=[],calls=[],messages=[],updates=[];
  const solicitud={ID:71,USUARIO:'usuario-demo',MONTO:100,DESTINO:'alias.demo',TITULAR:'Titular Demo',METADATA:JSON.stringify(marker)};
  const window={ctrlElectron:{navigateAgent:async()=>events.push('navigate')},
    NodoSalud:{begin:rama=>({record:(stage,state,code)=>events.push({rama,stage,state,code})})},
    nodoHoraExacta:()=> '12:34:56'};
  if(validator!==undefined)window.nodoRetiroCuentaValidada=validator;
  if(seal!==undefined)window.nodoSellarRetiroAprobado=seal;
  const billetera={ID_BILLETERA:'bil-demo',NOMBRE_VISIBLE:'Billetera demo',SALDO:500,CHUNIOR_UID:null};
  const ctx={window,solicitudes:[solicitud],operador:{usuario:'operador-demo'},
    alert(){},confirm:()=>true,toast:(...args)=>messages.push(args),
    verificarRetiro24h:async()=>({bloqueado:false}),confirmarRetiroDuplicado:async()=>true,
    notificarUsuarioEnChat:async(usuario,texto)=>messages.push([usuario,texto]),
    actualizarSolicitudSupabase:async(id,data)=>updates.push({id,data}),refrescarTodo:async()=>{},
    ensureDrexSession:async()=>true,callDrex:async(accion)=>{
      calls.push(accion);
      if(accion==='buscarUsuario')return {exists:true,balance:{value:1000,raw:'1.000'}};
      if(accion==='retirarSaldo')return withdrawal===undefined?{ok:true,previousBalance:{value:1000},newBalance:{value:900}}:withdrawal;
      throw new Error('accion inesperada: '+accion);
    },cargarBilleteras:async()=>{},getBilleraLanding:()=>billetera,
    ajustarSaldoBilletera:async()=>{},registrarRetiroEnChunior:async()=>({ok:true}),
    registrarEnHistorial:async data=>events.push({historial:data}),_watchdogTrigger(){},
    NodoSalud:window.NodoSalud};
  vm.createContext(ctx);vm.runInContext(functionSource('ejecutarAutoRetiro'),ctx);
  return {ctx,window,solicitud,events,calls,messages,updates};
}

test('la automatización beta se detiene si falta el validador de titularidad',async()=>{
  const h=harness();
  await h.ctx.ejecutarAutoRetiro('71');
  assert.deepEqual(h.calls,[],'no consulta Agentes ni descuenta saldo');
  assert.ok(h.messages.some(m=>String(m[0]||'').includes('No se movió saldo')));
  assert.ok(h.events.some(e=>e.rama==='RETIROS'&&e.code==='RETIRO_VALIDADOR_NO_CARGADO'));
});

test('la automatización beta entrega la solicitud marcada y usa la hora confirmada por servidor',async()=>{
  const orden=[];
  const h=harness({
    validator:async(id,info)=>{orden.push('validate');assert.equal(id,'71');assert.deepEqual(info.solicitud,h.solicitud);return {seguir:true};},
    seal:async(id,info)=>{orden.push('seal');assert.equal(id,'71');assert.equal(info.solicitud,h.solicitud);return {ok:true,horaExacta:'14:32:05',aprobadoAt:'2026-11-06T17:32:05.000Z'};}
  });
  const original=h.ctx.callDrex;
  h.ctx.callDrex=async accion=>{if(accion==='retirarSaldo')orden.push('withdraw');return original(accion);};
  await h.ctx.ejecutarAutoRetiro('71');
  assert.deepEqual(orden,['validate','withdraw','seal']);
  assert.ok(h.updates.some(u=>u.data.estado==='PAGADA'));
  assert.ok(h.messages.some(m=>String(m[1]||'').includes('14:32:05')));
});

test('una falla del sello no inventa una hora local ni habilita volver a pagar',async()=>{
  const h=harness({
    validator:async()=>({seguir:true}),
    seal:async()=>({ok:false,error:'RETIRO_SELLO_NO_CONFIRMADO'})
  });
  await h.ctx.ejecutarAutoRetiro('71');
  const aviso=h.messages.find(m=>/no se guardó la hora/i.test(String(m[0]||'')));
  assert.ok(aviso,'se avisa al operador que el movimiento ya ocurrió');
  const chat=h.messages.find(m=>m[0]==='usuario-demo');
  assert.ok(chat);assert.ok(!chat[1].includes('12:34:56'));
  assert.match(chat[1],/no vuelvas a enviar el retiro/);
  assert.ok(h.updates.some(u=>u.data.estado==='PAGADA'),'no se reabre ni repite un retiro ya ejecutado');
});
