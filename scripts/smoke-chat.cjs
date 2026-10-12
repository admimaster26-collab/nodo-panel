// Portal real en Chromium con servidor falso y red externa bloqueada.
// Guarda capturas con datos ficticios en el directorio temporal informado al finalizar.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main(){
  const root = path.resolve(__dirname, '..');
  const browserPath = process.argv[2] || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].find(file => fs.existsSync(file));
  assert.ok(browserPath, 'Chrome o Edge instalado');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nodo-chat-browser-'));
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'nodo-chat-preview-'));
  const failures = [], blocked = [];
  let browser, socket;
  const stub = `window.__chatRpcCalls=[]; window.supabase={createClient(){
    const query=new Proxy({}, {get(_,k){return k==='then'?Promise.resolve({data:[],error:null}).then.bind(Promise.resolve({data:[],error:null})):()=>query;}});
    return {from(){return query;},async rpc(name,args){
      window.__chatRpcCalls.push({name,args});
      if(name==='landing_chat_abrir_v3') return {data:{ok:true,chat_id:77,chat_token:'ficticio',solicitud_id:900}};
      if(name==='landing_enviar_mensaje_v2') return {data:[{ok:true,mensaje_id:101}]};
      return {data:[],error:null};
    }};
  }};`;
  const html = fs.readFileSync(path.join(root,'Portal'),'utf8')
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, '<script>'+stub+'</script>');
  const server = http.createServer((req,res)=>{
    if(req.url==='/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try {
    browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking',
      '--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    browser.on('error',e=>failures.push(e.message));
    const endpoint=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(endpoint);i++)await pause(100);
    assert.ok(fs.existsSync(endpoint),'Chromium abrió DevTools');
    const port=fs.readFileSync(endpoint,'utf8').split('\n')[0];
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let seq=0;
    const pending=new Map();
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
    });
    socket.addEventListener('message',event=>{
      const msg=JSON.parse(event.data);
      if(msg.id){
        const call=pending.get(msg.id);if(!call)return;
        pending.delete(msg.id);clearTimeout(call.timer);
        if(msg.error)call.reject(Error(msg.error.message));else call.resolve(msg.result);
      }else if(msg.method==='Runtime.exceptionThrown')failures.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
      else if(msg.method==='Fetch.requestPaused'){
        const {requestId,request}=msg.params;
        if(request.url.startsWith(origin+'/'))send('Fetch.continueRequest',{requestId}).catch(e=>failures.push(e.message));
        else{
          blocked.push(new URL(request.url).origin);
          send('Fetch.fulfillRequest',{requestId,responseCode:503,body:''}).catch(e=>failures.push(e.message));
        }
      }
    });
    const evaluate=async expression=>{
      const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      return result.result.value;
    };
    const screenshot=async name=>{
      const image=await send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(image.data,'base64'));
    };
    await send('Runtime.enable');await send('Page.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:origin+'/'});await pause(1500);
    assert.deepEqual(failures,[],'el Portal compila e inicia');
    await evaluate(`state.usuario='cliente_prueba';state.telefono='';state.pcCodigo='P1';state.publicCode='ruta-prueba';state.nivelAcceso='OK';
      toggleWidget(true);goChat();stopChatPoll();stopPortalThreadPoll();stopEstadoPoll();`);
    await pause(350);
    assert.ok(await evaluate(`document.querySelector('.msg.guide')!==null`),'guía inicial visible');
    assert.equal(await evaluate(`document.activeElement?.id==='freeInput'`),false,'no abrir teclado al entrar');
    assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false,'sin desborde horizontal móvil');
    await screenshot('chat-opciones-movil');
    await evaluate(`addMsg('Necesito revisar un envío.','user');
      addMsg('Soy el asistente automático.','bot');
      addMsg('Te ayudo a revisar los datos. ⟦AYUDA:revisar_envio⟧','operator',null,{fecha:'2026-10-11T12:00:00Z'});`);
    assert.equal(await evaluate(`document.querySelectorAll('.chat-help-actions button').length>0`),true,'tarjeta del operador disponible');
    await screenshot('chat-autores-movil');
    await evaluate(`guiaAbrirTarjeta('revisar_envio');guiaElegir('formulario');`);
    await pause(100);
    assert.equal(await evaluate(`document.querySelectorAll('#messages input,#messages textarea').length>0`),true,'formulario dentro del chat');
    assert.equal(await evaluate(`window.__chatRpcCalls.some(c=>/crear_solicitud|enviar_mensaje/.test(c.name))`),false,'navegar no envía ni crea solicitudes');
    await screenshot('chat-formulario-movil');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await pause(100);await screenshot('chat-formulario-escritorio');
    assert.deepEqual(failures,[],'sin excepciones JavaScript');
    console.log(JSON.stringify({ok:true,artifacts,blockedExternalOrigins:[...new Set(blocked)],failures},null,2));
    await send('Browser.close').catch(()=>{});
  }finally{
    socket?.close();browser?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await pause(300);
    assert.equal(path.dirname(profile),path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('nodo-chat-browser-'));
    try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch(_){console.warn('Perfil temporal ocupado:',profile);}
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
