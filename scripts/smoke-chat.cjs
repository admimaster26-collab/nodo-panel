// Portal real en Chromium con servidor falso y red externa bloqueada: recorre el asistente del chat
// como un jugador, tocando de verdad. Guarda capturas con datos ficticios en el directorio temporal
// que informa al terminar.
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
  const stub = `window.__chatRpcCalls=[];window.__historial=[];window.__chatCerrado=false;window.__activa=null;window.supabase={createClient(){
    const query=new Proxy({}, {get(_,k){return k==='then'?Promise.resolve({data:[],error:null}).then.bind(Promise.resolve({data:[],error:null})):()=>query;}});
    return {from(){return query;},storage:{from(){return {upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:'data:image/gif;base64,R0lGODlhAQABAAAAACw='}})};}},async rpc(name,args){
      window.__chatRpcCalls.push({name,args});
      if(name==='landing_chat_abrir_v3') return {data:{ok:true,chat_id:77,chat_token:'ficticio',solicitud_id:900}};
      if(name==='landing_enviar_mensaje_v2'){
        if(window.__chatCerrado){window.__chatCerrado=false;return {data:null,error:{code:'P0001',message:'Chat no autorizado'}};}
        return {data:[{ok:true,mensaje_id:100+window.__chatRpcCalls.length}]};
      }
      if(name==='landing_portal_resolver_vinculo') return {data:{verdict:'ACCESO',mensaje:'Acceso verificado.'}};
      if(name==='landing_historial_usuario_beta_v1') return {data:{ok:true,contract:'portal.historial.v1',rows:window.__historial,rechazos_turno:{CARGA:null,RETIRO:null},turno_hasta:new Date(Date.now()+36e5).toISOString()}};
      if(name==='landing_solicitud_activa') return {data:window.__activa?[window.__activa]:[]};
      if(name==='landing_obtener_billetera_segura') return {data:[{id:9,alias:'prueba.demo.mp',cbu:'0000003100000000000000',titular:'Titular Demo',nombre_visible:'DEMO'}]};
      if(name==='landing_datos_retiro') return {data:[{destino:'mi.alias.demo',titular:'Cliente Prueba'}]};
      if(name==='landing_titular_bloqueado') return {data:[{bloqueado:false}]};
      if(name==='landing_portal_v16_crear_solicitud'){
        if(args.p_tipo!=='CAMBIO_CLAVE')window.__activa={solicitud_id:378404,tipo:args.p_tipo,monto:args.p_monto,estado:'PENDIENTE',billetera:'',titular:args.p_titular,reabierta:false};
        return {data:{ok:true,solicitud_id:378404,chat_id:78,chat_token:'ficticio-2'}};
      }
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
        if(request.url.startsWith(origin+'/')||request.url.startsWith('data:'))send('Fetch.continueRequest',{requestId}).catch(e=>failures.push(e.message));
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
    // Tocar de verdad: busca el botón por su texto y lo aprieta, como el dedo.
    const tocar=async texto=>{
      const ok=await evaluate(`(()=>{const b=[...document.querySelectorAll('#guiaAccion button')].find(x=>x.textContent.includes(${JSON.stringify(texto)}));if(!b)return false;b.click();return true;})()`);
      assert.ok(ok,'no está el botón: '+texto+' | hay: '+await evaluate(`[...document.querySelectorAll('#guiaAccion button')].map(b=>b.textContent).join(' / ')`));
      await pause(330);
    };
    const escribir=(id,valor)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(valor)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const enviarFicha=async()=>{await evaluate(`document.getElementById('guiaEnviar').click()`);await pause(420);};
    const hay=texto=>evaluate(`document.getElementById('messages').textContent.includes(${JSON.stringify(texto)})`);
    const llamadas=nombre=>evaluate(`window.__chatRpcCalls.filter(c=>c.name===${JSON.stringify(nombre)}).length`);
    const sinDesborde=async nombre=>{
      assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth||document.getElementById('messages').scrollWidth>document.getElementById('messages').clientWidth`),false,'sin desborde horizontal: '+nombre);
    };
    const reiniciar=async(identidad)=>{
      await evaluate(`sessionStorage.clear();localStorage.clear()`);
      await send('Page.navigate',{url:origin+'/'});await pause(1100);
      await evaluate(`stopChatPoll();stopPortalThreadPoll();stopEstadoPoll();Object.assign(state,${JSON.stringify(identidad)},{pcCodigo:'P1',publicCode:'ruta-prueba'});window.__chatRpcCalls=[];
        toggleWidget(true);goChat();stopChatPoll();stopPortalThreadPoll();`);
      await pause(250);
    };
    const JUGADOR={usuario:'cliente_prueba',telefono:'1134567890',nivelAcceso:'OK'};
    await send('Runtime.enable');await send('Page.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await send('Page.navigate',{url:origin+'/'});await pause(1500);
    assert.deepEqual(failures,[],'el Portal compila e inicia');

    // 1. Lo de la captura: sin usuario pide una persona y el pedido llega.
    await reiniciar({usuario:'',telefono:'',nivelAcceso:''});
    assert.ok(await hay('Te atiende el asistente de BET300'),'saludo');
    assert.equal(await evaluate(`document.activeElement?.id==='freeInput'`),false,'no abrir teclado al entrar');
    await sinDesborde('inicio');
    await screenshot('01-saludo-y-opciones');
    await tocar('Hablar con una persona');
    assert.equal(await llamadas('landing_enviar_mensaje_v2'),0,'sin datos todavía no sale nada');
    assert.equal(await evaluate(`document.querySelectorAll('#guiaUsuario,#guiaTelefono').length`),2,'la ficha está en el chat');
    assert.equal(await evaluate(`state.screen`),'chat','no lo saca del chat');
    await sinDesborde('ficha de datos');
    await screenshot('02-sin-usuario-pide-los-datos-aca');
    await escribir('guiaUsuario','cliente_prueba');await escribir('guiaTelefono','1134567890');
    await enviarFicha();await pause(350);
    assert.equal(await llamadas('landing_chat_abrir_v3'),1,'abre la conversación');
    assert.equal(await llamadas('landing_enviar_mensaje_v2'),1,'y el pedido sale al servidor');
    assert.ok(await hay('Te paso con un operador'),'se lo confirma');
    await screenshot('03-pedido-enviado');

    // 2. Con el chat cerrado por el operador el mensaje igual llega.
    await reiniciar({...JUGADOR,chatId:'55',chatToken:'cerrado'});
    await evaluate(`window.__chatCerrado=true`);
    await tocar('Hablar con una persona');await pause(300);
    assert.equal(await llamadas('landing_chat_abrir_v3'),1,'chat cerrado: abre uno nuevo');
    assert.equal(await llamadas('landing_enviar_mensaje_v2'),2,'el rechazado y el que entró');
    assert.ok(await hay('Te paso con un operador'),'y llega');

    // 3. Ficha de carga que se da vuelta.
    await reiniciar(JUGADOR);
    await tocar('Una carga');
    await screenshot('04-rama-carga');
    await tocar('Quiero cargar');await pause(250);
    await sinDesborde('ficha de carga');
    await screenshot('05-ficha-de-carga');
    await evaluate(`document.querySelector('.guia-dato').click()`);await pause(80);
    await escribir('guiaMonto','5000');await escribir('guiaTitular','Cliente Prueba');
    await enviarFicha();await pause(120);
    await screenshot('06-girando');
    await pause(1000);
    assert.equal(await llamadas('landing_portal_v16_crear_solicitud'),1,'una sola carga');
    assert.ok(await hay('#378404'),'el ticket trae el pedido');
    assert.equal(await evaluate(`state.screen`),'chat','se queda en el chat');
    assert.equal(await evaluate(`document.querySelector('.guia-cara:not(.dorso)')===null`),true,'la cara de adelante se va y no queda nada tocable atrás');
    await evaluate(`scrollChat()`);await pause(100);
    await sinDesborde('ticket');
    await screenshot('07-ticket');

    // 4. Datos reales: una carga en la fila, comprobante.
    await reiniciar(JUGADOR);
    await evaluate(`window.__historial=[{tipo:'CARGA',estado:'PENDIENTE',monto:5000,fecha:new Date().toISOString(),solicitud_id:378404}]`);
    await tocar('Una carga');await tocar('Transferí y no me apareció');await pause(200);
    assert.ok(await hay('está en la fila'),'cuenta qué pasa con su carga');
    await screenshot('08-carga-en-la-fila-y-comprobante');

    // 5. Rechazo con su motivo.
    await reiniciar(JUGADOR);
    await evaluate(`window.__historial=[{tipo:'CARGA',estado:'RECHAZADA',monto:3000,fecha:new Date().toISOString(),motivo:'No nos llegó la transferencia',solicitud_id:7}]`);
    await tocar('Una carga');await tocar('Me la rechazaron');await pause(200);
    assert.ok(await hay('No nos llegó la transferencia'),'el motivo real');
    await screenshot('09-rechazo-con-motivo');

    // 6. Ficha de retiro.
    await reiniciar(JUGADOR);
    await tocar('Un retiro');await tocar('Quiero retirar');await pause(250);
    assert.equal(await evaluate(`document.getElementById('guiaDestino').value`),'mi.alias.demo','trae los datos del último');
    await sinDesborde('ficha de retiro');
    await screenshot('10-ficha-de-retiro');

    // 7. El fragmento no llega al operador y el operador corta el menú.
    await reiniciar(JUGADOR);
    await evaluate(`document.getElementById('freeInput').value='3000';sendFreeMessage()`);await pause(120);
    assert.equal(await llamadas('landing_enviar_mensaje_v2'),0,'un número suelto no va al operador');
    assert.ok(await hay('Elegí una opción'),'vuelve a ofrecer el menú');
    await evaluate(`addMsg('Hola, soy el operador. ¿Qué pasó?','operator',null,{id:'500'})`);await pause(80);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('#guiaAccion button')].map(b=>b.textContent)`),['Ver opciones'],'con una persona el menú se repliega');
    await screenshot('11-contesta-una-persona');

    // 8. Tarjeta que manda el operador con la macro del panel.
    await reiniciar(JUGADOR);
    await evaluate(`addMsg('Te ayudo a revisar los datos. ⟦AYUDA:revisar_envio⟧','bot',null,{fecha:'2026-10-11T12:00:00Z'})`);
    assert.equal(await evaluate(`document.querySelectorAll('.chat-help-actions button').length`),1,'tarjeta del operador disponible');

    // 9. Las pantallas de siempre comparten funciones con el chat: tienen que seguir igual.
    await reiniciar({usuario:'',telefono:'',nivelAcceso:''});
    await evaluate(`goHome()`);await pause(150);
    await escribir('usuarioInicial','cliente_prueba');await escribir('telefonoInicial','1134567890');
    await evaluate(`guardarUsuarioInicial()`);await pause(250);
    assert.equal(await evaluate(`state.nivelAcceso`),'OK','Inicio entra');
    assert.equal(await evaluate(`state.usuario`),'cliente_prueba');
    await evaluate(`goCarga()`);await pause(300);
    await escribir('cargaMonto','5000');await escribir('cargaTitular','Cliente Prueba');
    await evaluate(`document.getElementById('btnEnviarCarga').click()`);await pause(600);
    assert.equal(await llamadas('landing_portal_v16_crear_solicitud'),1,'Cargar crea una sola');
    assert.equal(await evaluate(`state.screen`),'estado','Cargar sigue yendo a Estado');
    assert.equal(await evaluate(`state.solicitudId`),'378404','y queda el pendiente');
    await reiniciar(JUGADOR);
    await evaluate(`goRetiro()`);await pause(350);
    assert.equal(await evaluate(`document.getElementById('retiroDestino').value`),'mi.alias.demo','Retirar trae los datos del último');
    await escribir('retiroMonto','20000');
    await evaluate(`document.getElementById('btnEnviarRetiro').click()`);await pause(600);
    assert.equal(await llamadas('landing_portal_v16_crear_solicitud'),1,'Retirar crea uno solo');
    assert.equal(await evaluate(`state.screen`),'estado','Retirar sigue yendo a Estado');
    await reiniciar(JUGADOR);
    await evaluate(`goClave()`);await pause(150);
    await evaluate(`document.getElementById('btnEnviarClave').click()`);await pause(350);
    assert.equal(await llamadas('landing_portal_v16_crear_solicitud'),1,'Clave pide uno solo');
    assert.equal(await evaluate(`window.__chatRpcCalls.find(c=>c.name==='landing_portal_v16_crear_solicitud').args.p_metadata.password_nuevo`),'12345a','con la clave por defecto');
    assert.equal(await evaluate(`state.screen`),'chat','Clave sigue yendo al chat');

    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await reiniciar(JUGADOR);
    await tocar('Una carga');await tocar('Quiero cargar');await pause(250);
    await sinDesborde('escritorio');
    await screenshot('12-escritorio');
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
