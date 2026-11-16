// Prueba Portal-contra-NODO de punta a punta, contra el servidor REAL. Guía: docs/PRUEBA_PORTAL_NODO.md.
// Caso: "Tengo usuario pero no puedo entrar" con el usuario vacío (oficina P1, teléfono ficticio 1111111111).
//  · Jugador: el archivo Portal de este repo servido en 127.0.0.1 (entra solo como P1, cartel PRUEBAS), en un
//    Edge sin ventana con perfil nuevo y puerto 9335 (nunca el 9222 del NODO de Juan).
//  · Operador: el MISMO puente que usa NODO (main/panel-rpc.js) con la credencial beta de esta PC
//    (%LOCALAPPDATA%/NODO/beta/connection.json). Lee, marca visto y contesta por los canales nuevos.
// Deja capturas y resultado.json en la carpeta indicada. No corre en npm test (usa red real).
// Uso: node scripts/prueba-portal-nodo.cjs <carpeta-de-capturas>
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http');
if(!process.argv[2]){console.error('Uso: node scripts/prueba-portal-nodo.cjs <carpeta-de-capturas>');process.exit(2);}
const {spawn}=require('child_process');
const repo=path.resolve(__dirname,'..'), out=process.argv[2];
const {loadBetaConfig}=require(path.join(repo,'main/beta-config'));
const {registerPanelIpc}=require(path.join(repo,'main/panel-rpc'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const TEL='1111111111';
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

(async()=>{
  fs.mkdirSync(out,{recursive:true});
  // ── NODO: el puente real, con la credencial beta de esta PC ──
  const handlers=new Map();
  registerPanelIpc({ipcMain:{handle:(k,v)=>handlers.set(k,v)},betaConfig:loadBetaConfig(),env:process.env});
  const nodo=(fn,args)=>handlers.get('panel:rpc')({},fn,{p_pc_codigo:'P1',...args});
  const cap=await nodo('nodo_beta_capacidades_v1',{p_activate:false});
  log('NODO capacidades:',cap.error?('ERROR '+JSON.stringify(cap.error)):'ok');

  // ── Portal: archivo local servido en 127.0.0.1 ──
  const html=fs.readFileSync(path.join(repo,'Portal'),'utf8');
  const server=http.createServer((q,r)=>{if(q.url==='/'||q.url.startsWith('/?')){r.setHeader('Content-Type','text/html; charset=utf-8');r.end(html);}else{r.writeHead(404);r.end();}});
  await new Promise(r=>server.listen(8797,'127.0.0.1',r));
  const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'e2e-portal-'));
  const browser=spawn(edge,['--headless=new','--remote-debugging-port=9335','--user-data-dir='+profile,'--window-size=420,860','about:blank'],{stdio:'ignore'});
  let ws,id=0;const wait=new Map();
  try{
    let page;for(let i=0;i<40&&!page;i++){await pause(250);try{page=(await (await fetch('http://127.0.0.1:9335/json/list')).json()).find(p=>p.type==='page');}catch(_){}}
    ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id);}};
    const cdp=(method,params={})=>new Promise(r=>{const n=++id;wait.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
    const ev=async expr=>{const m=await cdp('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
      if(m.result.exceptionDetails)throw new Error('página: '+JSON.stringify(m.result.exceptionDetails).slice(0,400));return m.result.result.value;};
    const foto=async nombre=>{const m=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,nombre),Buffer.from(m.result.data,'base64'));};
    const chat=()=>ev(`JSON.stringify({pantalla:state.screen,globos:[...document.querySelectorAll('#messages > *')].map(n=>(n.className.split(' ')[0]||'')+': '+n.innerText.replace(/\\s+/g,' ').trim().slice(0,140)),opciones:[...document.querySelectorAll('#guiaAccion button')].map(b=>b.innerText.trim())})`).then(JSON.parse);
    await cdp('Page.enable');
    await cdp('Page.navigate',{url:'http://127.0.0.1:8797/'});await pause(2500);
    log('oficina del Portal a los 2,5 s (el arranque puede no haber terminado):',await ev('state.pcCodigo'));

    // 1) El jugador: "Tengo usuario pero no puedo entrar", sin usuario, sólo teléfono.
    await ev(`toggleWidget(true)`);await pause(500);
    await ev(`setGateModo('ayuda')`);await pause(300);
    await ev(`document.getElementById('usuarioInicial').value='';document.getElementById('telefonoInicial').value='${TEL}';onGateSubmit()`);
    await pause(4000);log('oficina a los 4 s del pedido:',await ev('state.pcCodigo'));await pause(4000);
    const chatId=await ev(`localStorage.getItem('bet300_chat_id')`);
    log('chat abierto:',chatId);
    const antes=await chat();log('Portal después de pedir ayuda:',JSON.stringify(antes,null,1));
    await foto('1-pedido-de-ayuda.png');

    // 2) NODO lee la conversación por el canal nuevo y la marca como vista (lo que hace al abrirla).
    const msgs=await nodo('nodo_beta_chat_mensajes_v1',{p_chat_id:chatId,p_limit:20});
    const filas=(msgs.data&&msgs.data.messages)||(msgs.data&&msgs.data.rows)||[];
    log('NODO ve:',msgs.error?('ERROR '+JSON.stringify(msgs.error)):JSON.stringify(filas.map(m=>[m.id,m.tipo_emisor,String(m.mensaje).slice(0,80)])));
    const delJugador=filas.filter(m=>String(m.tipo_emisor).toUpperCase()==='USUARIO').map(m=>Number(m.id));
    const leido=await nodo('nodo_beta_chat_leido_v1',{p_chat_id:chatId,p_message_ids:delJugador});
    log('NODO marca visto:',leido.error?('ERROR '+JSON.stringify(leido.error)):'ok');
    await pause(9000);
    const visto=await chat();log('Portal después de que NODO lo vio:',JSON.stringify(visto,null,1));
    await foto('2-visto-por-el-cajero.png');

    // 3) El operador contesta por el canal nuevo.
    const texto='Hola, soy tu cajero (prueba automática). ¿Cuál es tu usuario?';
    const env=await nodo('nodo_beta_chat_enviar_v1',{p_chat_id:chatId,p_mensaje:texto,p_imagen_url:null,p_emisor:'prueba',p_request_id:require('crypto').randomUUID()});
    log('NODO envía:',env.error?('ERROR '+JSON.stringify(env.error)):'ok id '+(env.data&&env.data.message&&env.data.message.id));
    await pause(9000);
    const despues=await chat();log('Portal después de la respuesta:',JSON.stringify(despues,null,1));
    const veces=despues.globos.filter(g=>g.includes('prueba automática')).length;
    log('la respuesta del cajero se ve',veces,'vez/veces');
    await foto('3-respuesta-del-cajero.png');
    await ev(`location.reload()`);await pause(7000);await ev(`toggleWidget(true)`);await ev(`try{goChat()}catch(e){}`);await pause(6000);
    const recargado=await chat();log('Portal al recargar:',JSON.stringify(recargado,null,1));
    await foto('4-al-recargar.png');
    fs.writeFileSync(path.join(out,'resultado.json'),JSON.stringify({chatId,antes,visto,despues,recargado},null,1));
  }finally{try{ws&&ws.close();}catch(_){}browser.kill();server.close();}
})().catch(e=>{console.error('FALLO:',e.message);process.exit(1);});
