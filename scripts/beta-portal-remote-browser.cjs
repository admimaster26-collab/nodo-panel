'use strict';
// Portal real en Chromium, único RPC permitido: lectura beta de la fixture privada.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {loadBetaConfig}=require('../main/beta-config');
const {registerPanelIpc}=require('../main/panel-rpc');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const dir=process.argv[2];assert.ok(path.isAbsolute(dir||''));
 const seed=JSON.parse(fs.readFileSync(path.join(dir,'probe-seed.json'),'utf8'));
 const config=loadBetaConfig({env:{NODO_BETA_CONFIG:path.join(dir,'probe-config.json')}});
 assert.equal(seed.pc_codigo,'BETA_DEMO_27');assert.deepEqual(config.offices,['BETA_DEMO_27']);
 const handlers=new Map();registerPanelIpc({ipcMain:{handle:(k,v)=>handlers.set(k,v)},betaConfig:config,env:{}});
 const lease=await handlers.get('panel:rpc')({},'nodo_beta_capacidades_v1',{p_pc_codigo:seed.pc_codigo,p_activate:true});assert.equal(lease.error,null);
 const browserPath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);assert.ok(browserPath);
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'nodo-beta-browser-'));
 const failures=[],calls=[];let browser,socket;
 const stub=`window.supabase={createClient(){const q=new Proxy({}, {get:(_,k)=>k==='then'?Promise.resolve({data:[],error:null}).then.bind(Promise.resolve({data:[],error:null})):()=>q});return {from:()=>q,rpc:async(name,args)=>{if(name!=='landing_beta_chat_leer_v1')return {data:null,error:{code:'TEST_RPC_BLOCKED'}};return fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})}).then(r=>r.json())}}}};`;
 const html=fs.readFileSync(path.join(__dirname,'../Portal'),'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/,'<script>'+stub+'</script>');
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url==='/'&&req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
   if(req.url!=='/rpc'||req.method!=='POST'){res.writeHead(404);res.end();return;}
   let body='';for await(const part of req){body+=part;if(body.length>4096)throw Error('body limit');}
   const {name,args}=JSON.parse(body);assert.equal(name,'landing_beta_chat_leer_v1');
   assert.equal(String(args.p_chat_id),String(seed.sesion_id));assert.equal(args.p_chat_token,seed.portal_token);
   calls.push(name);
   const remote=await fetch(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.publicKey,Authorization:'Bearer '+config.publicKey,'Content-Type':'application/json'},body:JSON.stringify(args)});
   assert.equal(remote.status,200);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:await remote.json(),error:null}));
  }catch(_){res.writeHead(400);res.end(JSON.stringify({error:{code:'PROBE_REJECTED'}}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const endpoint=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(endpoint);i++)await pause(100);assert.ok(fs.existsSync(endpoint));
  const port=fs.readFileSync(endpoint,'utf8').split('\n')[0],pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout'));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')failures.push(m.params.exceptionDetails.text);else if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;send(request.url.startsWith(origin+'/')?'Fetch.continueRequest':'Fetch.fulfillRequest',request.url.startsWith(origin+'/')?{requestId}:{requestId,responseCode:503,body:''}).catch(()=>{});}});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await send('Page.navigate',{url:origin+'/'});await pause(800);
  await evaluate(`state.usuario='BETA_TEST_ONLY';state.telefono='0000000000';state.pcCodigo='BETA_DEMO_27';state.publicCode='';state.chatId=${JSON.stringify(seed.sesion_id)};state.chatToken=${JSON.stringify(seed.portal_token)};state.nivelAcceso='OK';toggleWidget(true);goChat();stopChatPoll();stopPortalThreadPoll();stopEstadoPoll();`);
  await pause(1000);
  const state=await evaluate(`({health:portalChatEstado(),messages:document.querySelectorAll('#messages .msg').length,users:document.querySelectorAll('#messages .msg.user').length,operators:document.querySelectorAll('#messages .msg.operator').length,seen:document.querySelectorAll('#messages .msg-seen').length})`);
  assert.equal(state.health.ruta,'beta');assert.equal(state.users,2);assert.equal(state.operators,3);assert.deepEqual(failures,[]);assert.ok(calls.length>=1);
  const receipts=await evaluate(`Array.from(document.querySelectorAll('#messages .msg.user')).map(n=>n.querySelector('.visto')?.getAttribute('aria-label')==='visto')`);
  assert.equal(receipts.filter(Boolean).length,1);
  const picture=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(dir,'portal-beta-browser.png'),Buffer.from(picture.data,'base64'));
  const report={ok:true,office:'BETA_DEMO_27',users:state.users,operators:state.operators,seen:1,rpc_reads:calls.length,route:state.health.ruta,errors:failures.length,completed_at:new Date().toISOString(),limitations:['Portal local Chromium y fixture aislada; no publica hosting ni certifica Electron autenticado']};
  fs.writeFileSync(path.join(dir,'portal-browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await send('Browser.close').catch(()=>{});
 }finally{socket?.close();browser?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
run().catch(e=>{console.error('Portal beta:',String(e.message).slice(0,220));process.exitCode=1});
