// Mide la demora del chat en los dos sentidos contra el servidor REAL (P1, jugador ficticio). Guía: docs/PRUEBA_PORTAL_NODO.md.
//  · jugador → NODO: cuánto tarda cada mensaje en aparecer en la lista de chats de dos NODO:
//      puerto 9337 = un NODO propio con el código a probar (sin iniciar sesión; ver la guía),
//      puerto 9222 = el NODO de Juan, SÓLO LECTURA (sirve de comparación con lo que él tiene abierto).
//  · NODO → jugador: cuánto tarda en verse en el Portal una respuesta enviada por el canal nuevo.
// El jugador es el perfil de navegador que dejó scripts/prueba-portal-nodo.cjs (así no abre otro chat).
// No corre en npm test (usa red real). Uso: node scripts/medir-demora-chat.cjs <perfil-del-navegador>
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const {spawn}=require('child_process');
const repo=path.resolve(__dirname,'..'),perfil=process.argv[2];
if(!perfil){console.error('Uso: node scripts/medir-demora-chat.cjs <perfil-del-navegador-del-jugador>');process.exit(2);}
const {loadBetaConfig}=require(path.join(repo,'main/beta-config'));
const {registerPanelIpc}=require(path.join(repo,'main/panel-rpc'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
async function conectar(port,filtro){
  let page;for(let i=0;i<40&&!page;i++){try{page=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&filtro(p));}catch(_){}if(!page)await pause(250);}
  if(!page)throw new Error('sin página en '+port);
  const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const w=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}};
  const cdp=(method,params={})=>new Promise(r=>{const n=++id;w.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
  const ev=async x=>{const m=await cdp('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});if(m.result.exceptionDetails)throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0,300));return m.result.result.value;};
  return {cdp,ev,cerrar:()=>ws.close()};
}
(async()=>{
  const handlers=new Map();registerPanelIpc({ipcMain:{handle:(k,v)=>handlers.set(k,v)},betaConfig:loadBetaConfig(),env:process.env});
  const nodo=(fn,args)=>handlers.get('panel:rpc')({},fn,{p_pc_codigo:'P1',...args});
  const html=fs.readFileSync(path.join(repo,'Portal'),'utf8');
  const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(html);});await new Promise(r=>server.listen(8797,'127.0.0.1',r));
  const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--remote-debugging-port=9335','--user-data-dir='+perfil,'--window-size=420,860','about:blank'],{stdio:'ignore'});
  let portal,nuevo,juan;
  try{
    portal=await conectar(9335,()=>true);
    nuevo=await conectar(9337,p=>/OPERATIVO/.test(p.title));
    juan=await conectar(9222,p=>/OPERATIVO/.test(p.title));
    await portal.cdp('Page.enable');await portal.cdp('Page.navigate',{url:'http://127.0.0.1:8797/'});await pause(9000);
    await portal.ev(`toggleWidget(true);try{goChat()}catch(e){}`);await pause(3000);
    log('jugador:',await portal.ev(`JSON.stringify({u:state.usuario,pc:state.pcCodigo,chat:state.chatId,nivel:state.nivelAcceso})`));
    const nonce=crypto.randomBytes(3).toString('hex');
    const enLista=t=>`(window._chatCanalNuevo.crudas()||[]).some(s=>String(s.ultimo_mensaje||'').includes(${JSON.stringify(t)}))`;
    const filas=[];
    // ── jugador → NODO ──
    for(const [i,espera] of [[1,0],[2,4000],[3,11000]]){
      await pause(espera);
      const texto='Prueba de demora '+i+' · '+nonce;
      const ok=await portal.ev(`enviarMensajeSoporte(${JSON.stringify(texto)}).then(r=>{if(r&&r.ok)mostrarMensajePropio(${JSON.stringify(texto)},null,r);return !!(r&&r.ok)+' '+(r&&r.error||'')})`);
      const t0=Date.now();const visto={nuevo:null,juan:null};
      while(Date.now()-t0<45000&&(visto.nuevo===null||visto.juan===null)){
        if(visto.nuevo===null&&await nuevo.ev(enLista(texto)))visto.nuevo=Date.now()-t0;
        if(visto.juan===null&&await juan.ev(enLista(texto)))visto.juan=Date.now()-t0;
        await pause(200);
      }
      filas.push({sentido:'jugador→NODO',n:i,envio:ok,nodo_nuevo_ms:visto.nuevo,nodo_de_juan_ms:visto.juan});
      log('jugador→NODO',i,'enviado:',ok,'| código nuevo:',visto.nuevo,'ms | NODO de Juan (código anterior):',visto.juan===null?'no apareció en 45 s':visto.juan+' ms');
    }
    // ── NODO → jugador (por el canal nuevo) ──
    const chatId=await portal.ev(`state.chatId`);
    for(const [i,espera] of [[1,1500],[2,3200],[3,2300]]){
      await pause(espera);
      const texto='Respuesta de prueba '+i+' · '+nonce;
      const r=await nodo('nodo_beta_chat_enviar_v1',{p_chat_id:String(chatId),p_mensaje:texto,p_imagen_url:null,p_emisor:'prueba',p_request_id:crypto.randomUUID()});
      const t0=Date.now();let ms=null;
      while(Date.now()-t0<25000&&ms===null){
        if(await portal.ev(`[...document.querySelectorAll('#messages .msg')].some(n=>n.innerText.includes(${JSON.stringify(texto)}))`))ms=Date.now()-t0;
        await pause(150);
      }
      filas.push({sentido:'NODO→jugador',n:i,envio:r.error?JSON.stringify(r.error):'ok',portal_ms:ms});
      log('NODO→jugador',i,r.error?('ERROR '+JSON.stringify(r.error)):'enviado','| se vio en el Portal a los',ms,'ms');
    }
    console.log(JSON.stringify(filas));
  }finally{for(const c of [portal,nuevo,juan])try{c&&c.cerrar();}catch(_){}browser.kill();server.close();}
})().catch(e=>{console.error('FALLO:',e.message);process.exit(1);});
