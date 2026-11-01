'use strict';
// Prepara credenciales privadas sin habilitar la aplicación ni imprimir tokens.
// Ejecutar después de verificar snapshot/restore; el SQL generado sólo contiene hashes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadBetaConfig}=require('../main/beta-config');
const dir=process.argv[2];
if(!dir || !path.isAbsolute(dir)) throw Error('Indicar directorio privado absoluto del resguardo');
const target=path.join(dir,'connection.pending.json'),probe=path.join(dir,'probe-config.json');
if(fs.existsSync(target)||fs.existsSync(probe)) throw Error('Ya existe preparación: reutilizarla; no rotar credenciales a ciegas');
const key=JSON.parse(fs.readFileSync(path.join(dir,'public-key.json'),'utf8')).public_key;
const url='https://pjvvyvfcwjoocjqvdror.supabase.co',build='nodo-beta-20261027';
const token=()=>crypto.randomBytes(32).toString('hex');
const production={enabled:true,url,public_key:key,credentials:{P1:token()},build};
const demonstration={enabled:true,url,public_key:key,credentials:{BETA_DEMO_27:token()},build};
for(const config of [production,demonstration]) {
  if(!loadBetaConfig({env:{NODO_BETA_CONFIG:'memory'},readFile:()=>JSON.stringify(config)}).enabled) throw Error('Configuracion invalida');
}
const entries=[production,demonstration].map(config=>{
  const [pc,secret]=Object.entries(config.credentials)[0];
  return {pc,id:crypto.randomUUID(),hash:crypto.createHash('sha256').update(secret,'utf8').digest('hex')};
});
fs.writeFileSync(target,JSON.stringify(production,null,2)+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(probe,JSON.stringify(demonstration,null,2)+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(dir,'enrollment.json'),JSON.stringify(entries,null,2)+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(dir,'enroll.sql'),'begin;\n'+entries.map(x=>
  `insert into acceso.beta_clientes(id,token_hash,pc_codigo,enabled) values ('${x.id}','${x.hash}','${x.pc}',true);`).join('\n')+'\ncommit;\n',{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(dir,'containment.sql'),`begin;\nupdate acceso.beta_clientes set enabled=false,active_contract=null,last_seen=null where id in (${entries.map(x=>`'${x.id}'`).join(',')});\ncommit;\n`,{flag:'wx',mode:0o600});
console.log(JSON.stringify({prepared:true,offices:entries.map(e=>e.pc),application_enabled:false}));
