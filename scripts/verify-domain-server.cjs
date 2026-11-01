'use strict';
// SQL real en PostgreSQL aislado. Sin conexiones, claves ni datos del servidor.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {resolvePGlite,fixture}=require('./verify-beta-server.cjs');
const ROOT=path.resolve(__dirname,'..'),TOKEN='ab'.repeat(32);
const sources=[
  'servidor/beta-chat-v1.sql',
  'servidor/dominios/perfil-v1.sql',
  'servidor/dominios/identidad-observaciones-v1.sql',
  'servidor/dominios/persistencia-local-v1.sql',
  'servidor/dominios/lecturas-operativas-v1.sql',
  'servidor/dominios/capacidades-v1.sql'
];
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const extension=`
alter table public.historial_ops add column origen text,add column notas text,add column worker_job_id bigint,
 add column billetera_id bigint,add column billetera_nombre text,add column mp_movimiento_id bigint,
 add column monto_declarado numeric,add column monto_aprobado numeric,add column validacion_tipo text,
 add column validacion_estado text,add column saldo_pre numeric,add column saldo_post numeric,
 add column operador text,add column chunior_movimiento_id text,add column reversion_de bigint;
alter table public.usuarios_portal_vinculos add column if not exists id bigserial primary key,add column if not exists titular text,
 add column if not exists cbu_titular text,add column if not exists estado_vinculo text,add column if not exists cbu_retiro text,
 add column if not exists telefono_raw text,add column if not exists created_at timestamptz default now(),
 add column if not exists updated_at timestamptz default now(),add column if not exists validado_at timestamptz,
 add column if not exists ultimo_ingreso_at timestamptz;
alter table public.landing_solicitudes add column if not exists telefono text;
alter table public.chat_sesiones add column if not exists telefono text;
create table if not exists public.usuarios(id bigserial primary key,usuario text,nombre text,nombre_completo text,
 nombre_transferencia text,telefono text,cbu_alias text,pc_codigo text,verificado boolean default false,
 created_at timestamptz default now(),updated_at timestamptz default now());
create table if not exists public.usuarios_cuentas_retiro(id bigserial primary key,usuario text,pc_codigo text,
 titular text,cbu_cvu text,alias text,alias_cbu text,estado text default 'ACTIVA',banco_billetera text,activa boolean default true,
 created_at timestamptz default now(),updated_at timestamptz default now(),last_used_at timestamptz);
create table if not exists public.usuarios_portal_eventos(id bigserial primary key,usuario text,pc_codigo text,
 evento text,telefono_anterior text,telefono_nuevo text,titular text,operador text,nota text,created_at timestamptz default now());
create table public.nodo_oficina_aliases(alias_codigo text,pc_codigo_compat text,oficina_id text,activa boolean);
create table public.agente_operaciones_importadas(id bigserial primary key,pc_codigo text,fecha timestamptz,
 alias text,alias_norm text,tipo text,tipo_normalizado text,cantidad numeric);
insert into public.nodo_oficina_aliases values ('P1','P1','oficina-1',true),('P_1','P1','oficina-1',true),('P2','P2','oficina-2',true);
insert into public.historial_ops(usuario,pc_codigo,tipo,estado,monto,created_at,billetera_nombre,origen)
 select 'perfil_demo','P1','CARGA','OK',10,'2026-10-01T12:00:00Z'::timestamptz - g*interval '1 second','Billetera A','PORTAL' from generate_series(1,6000) g;
insert into public.historial_ops(id,usuario,pc_codigo,tipo,estado,monto,created_at,notas,billetera_nombre,origen) values
 (9000000000000001,'perfil_demo','P_1','RETIRO','OK',20,'2026-10-02T12:00:00Z','Titular: Demo · Destino: 1234567890123456789012','Billetera B','PORTAL'),
 (9000000000000002,'perfil_demo','P1','CARGA','OK',30,'2026-10-02T12:00:00Z',null,'Billetera A','MANUAL'),
 (9000000000000003,'perfil_demo','P1','CARGA','ERROR',40,null,null,'Billetera A','PORTAL'),
 (9000000000000004,'perfil_demo','P2','CARGA','OK',900000,'2026-10-02T12:00:00Z',null,'Billetera P2','PORTAL'),
 (9000000000000005,'perfilXdemo','P1','CARGA','OK',800000,'2026-10-02T12:00:00Z',null,'Billetera A','PORTAL'),
 (9000000000000010,'cursor','P1','CARGA','OK',1,'2026-10-02T12:00:00.000002Z',null,'Billetera A','PORTAL'),
 (9000000000000011,'cursor','P1','CARGA','OK',1,'2026-10-02T12:00:00.000001Z',null,'Billetera A','PORTAL'),
 (9000000000000012,'cursor','P1','CARGA','OK',1,'2026-10-02T12:00:00.000001Z',null,'Billetera A','PORTAL'),
 (9000000000000013,'cursor','P1','CARGA','OK',1,null,null,'Billetera A','PORTAL'),
 (9000000000000014,'cursor','P1','CARGA','OK',1,null,null,'Billetera A','PORTAL');
insert into public.usuarios_portal_vinculos(usuario,pc_codigo,telefono_canon,titular,estado_vinculo) values
 ('perfil_demo','P1','5550000001','Demo P1','VINCULADO'),('perfil_demo','P2','5550000002','Demo P2','VINCULADO');
insert into public.usuarios(usuario,nombre,telefono,pc_codigo,verificado,created_at) values
 ('perfil_demo','Demo Registro','5550000001','P1',true,'2026-09-01T10:00:00Z');
insert into public.usuarios_cuentas_retiro(usuario,pc_codigo,titular,cbu_cvu,alias,alias_cbu,estado,activa,created_at) values
 ('perfil_demo','P1','Demo Cuenta','1234567890123456789012','demo.alias','demo.alias','ACTIVA',true,'2026-09-15T10:00:00Z');
insert into public.usuarios_portal_eventos(usuario,pc_codigo,evento,telefono_anterior,telefono_nuevo,operador,created_at) values
 ('perfil_demo','P1','CAMBIO_TELEFONO','5550000000','5550000001','op_demo','2026-09-20T10:00:00Z');
insert into public.landing_solicitudes(id,pc_codigo,usuario,tipo,estado,monto,created_at,metadata) values
 (5001,'P1','perfil_demo','RETIRO','EN_PROCESO',50000,'2026-08-01T10:00:00Z','{"ip":"181.10.20.30","titular":"Demo Parcial","cbu":"demo.parcial","retiro_parcial":{"total":50000,"pagado":20000,"cerrado":false}}'::jsonb),
 (5002,'P1','perfil_demo','CARGA','PENDIENTE',15000,'2026-08-02T10:00:00Z','{"ip":"181.10.20.31","telefono":"5550000001"}'::jsonb);
insert into public.landing_solicitudes(pc_codigo,usuario,tipo,estado,monto,created_at,metadata)
 select 'P1','cerrada_'||g,'CARGA','ACREDITADA',1000,'2026-10-03T10:00:00Z'::timestamptz - g*interval '1 minute','{}'::jsonb from generate_series(1,100) g;
insert into public.agente_operaciones_importadas(pc_codigo,alias,alias_norm,tipo,tipo_normalizado,cantidad,fecha) values
 ('P1','perfil_demo','perfil_demo','deposito','carga',50,now()),('P_1',null,'perfil_demo','deposito','carga',50,now()),
 ('P1','perfil_demo','perfil_demo','retiro','retiro',25,now()),('P2','perfil_demo','perfil_demo','deposito','carga',999999,now());
`;
async function verify(){
 const PGlite=resolvePGlite(),db=new PGlite(),report={started_at:new Date().toISOString(),tests:[],source_hashes:{},limitations:['Fixture aislada; no acredita publicación, latencia real ni uso de la aplicación dev.']};
 const texts=sources.map(file=>{const text=fs.readFileSync(path.join(ROOT,file),'utf8');report.source_hashes[file]=hash(text);return text;});
 const query=async(sql,params=[])=>(await db.query(sql,params)).rows;
 let seq=0;
 async function rpc(fn,args){
  assert.match(fn,/^[a-z_0-9]+$/);const sp='call_'+ ++seq;
  await db.exec(`savepoint ${sp};set local role anon;`);
  try{const rows=await query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args);await db.exec(`reset role;release savepoint ${sp}`);return rows[0].result;}
  catch(e){await db.exec(`rollback to savepoint ${sp};release savepoint ${sp}`);throw e;}
 }
 const summary=(u='perfil_demo',pc='P1',token=TOKEN)=>rpc('nodo_beta_perfil_v1',[token,pc,u]);
 const detail=(u='perfil_demo',limit=50,cursor=null)=>rpc('nodo_beta_perfil_detalle_v1',[TOKEN,'P1',u,limit,cursor]);
 async function check(name,fn){await db.exec('begin');try{await fn();report.tests.push({name,ok:true});}catch(e){report.tests.push({name,ok:false,error:e.message.slice(0,500),code:e.code});}finally{await db.exec('rollback');}}
 try{
  await db.exec(fixture);await db.exec(extension);await db.exec(texts[0]);
  await query("insert into acceso.beta_clientes(token_hash,pc_codigo,enabled) values (encode(sha256(convert_to($1,'UTF8')),'hex'),'P1',true)",[TOKEN]);
  await check('capacidad no se anuncia antes de instalar el contrato',async()=>{const r=await rpc('nodo_beta_capacidades_v1',[TOKEN,'P1']);assert.equal(r.capabilities.includes('perfil.summary.v1'),false);});
  await db.exec(texts[1]);
  await check('capacidad instalada y permisos privados por dominio',async()=>{
   const r=await rpc('nodo_beta_capacidades_v1',[TOKEN,'P1']);assert.ok(r.capabilities.includes('perfil.summary.v1')&&r.capabilities.includes('perfil.detail.v1'));
   const checks=await query("select n,has_schema_privilege('anon',n,'USAGE') allowed from unnest(array['acceso','identidad','comunicaciones','operaciones','observabilidad']) n");assert.ok(checks.every(x=>!x.allowed));
   assert.equal((await query("select has_function_privilege('anon','identidad.perfil_v1(text,text)','EXECUTE') allowed"))[0].allowed,false);
  });
  await check('resumen completo supera limite anterior, filtra oficina y usuario literal y separa importaciones',async()=>{
   const r=await summary();assert.equal(r.detalle_total,6003);assert.equal(r.resumen.totalOps,6003);assert.equal(r.resumen.cargas,6001);
   assert.equal(r.resumen.montoCargas,60030);assert.equal(r.resumen.montoRetiros,20);assert.equal(r.resumen.neto,60010);
   assert.equal(r.resumen.titular,'Demo P1');assert.equal(r.resumen.telefono,'5550000001');assert.equal(r.resumen.cbu,'1234567890123456789012');
   assert.equal(r.resumen.errores,1);assert.equal(r.agente_total,3);assert.equal(r.agente.montoCargas,100);assert.equal(r.agente.montoRetiros,25);
   assert.deepEqual(r.scope.pc_codigos.sort(),['P1','P_1']);
  });
  await check('página 50 con IDs exactos y resumen no derivado de página',async()=>{const d=await detail();assert.equal(d.rows.length,50);assert.equal(d.has_more,true);assert.equal(d.rows[0].id,'9000000000000002');assert.equal(d.rows[1].id,'9000000000000001');assert.ok(d.rows.every(x=>x.usuario==='perfil_demo'&&['P1','P_1'].includes(x.pc_codigo)));});
  await check('cursor: precisión microsegundos, empates, bigint y fechas nulas, sin perder ni repetir',async()=>{
   const ids=[];let cursor=null;for(let i=0;i<4;i++){const d=await detail('cursor',2,cursor);ids.push(...d.rows.map(x=>x.id));cursor=d.next_cursor;if(!d.has_more)break;}
   assert.deepEqual(ids,['9000000000000010','9000000000000012','9000000000000011','9000000000000014','9000000000000013']);
  });
  await check('vacío válido conserva ceros; lectura no crea filas ni cambia efectos',async()=>{
   const before=await query('select count(*) n,sum(monto) monto from public.historial_ops');const s=await summary('ausente'),d=await detail('ausente');
   assert.equal(s.resumen.neto,0);assert.equal(s.detalle_total,0);assert.deepEqual(d.rows,[]);assert.equal(d.has_more,false);assert.equal(d.next_cursor,null);
   assert.deepEqual(await query('select count(*) n,sum(monto) monto from public.historial_ops'),before);
  });
  await check('autorización token/oficina/cliente deshabilitado',async()=>{
   await assert.rejects(summary('perfil_demo','P2'),/BETA_NOT_AUTHORIZED/);await assert.rejects(summary('perfil_demo','P1','00'.repeat(32)),/BETA_NOT_AUTHORIZED/);
   await db.exec('update acceso.beta_clientes set enabled=false');await assert.rejects(summary(),/BETA_NOT_AUTHORIZED/);
  });
  await check('aliases contradictorios fallan cerrados',async()=>{
   await db.exec("insert into public.nodo_oficina_aliases values ('P_1','P2','oficina-2',true)");await assert.rejects(summary(),/BETA_OFFICE_AMBIGUOUS/);
  });
  await check('validación de usuario, límite y cursor sin efectos',async()=>{
   await assert.rejects(summary(' '),/BETA_INVALID_USER/);for(const limit of [0,101,null])await assert.rejects(detail('cursor',limit),/BETA_INVALID_LIMIT/);
   for(const cursor of [{},[],{id:1,created_at:null},{id:'9223372036854775808',created_at:null},{id:'1',created_at:'infinity'},{id:'1',created_at:'bad'},{id:'1',created_at:null,extra:true}]) await assert.rejects(detail('cursor',2,cursor),/BETA_INVALID_CURSOR/);
  });
  await check('reversión válida cancela pareja; original sin marcar y cadenas exigen cotejo',async()=>{
   await db.exec("insert into public.historial_ops(id,usuario,pc_codigo,tipo,estado,monto,reversion_de) values (70001,'reversa','P1','CARGA','REVERTIDA',100,null),(70002,'reversa','P1','RETIRO','OK',100,70001)");
   let s=await summary('reversa');assert.equal(s.detalle_total,2);assert.equal(s.resumen.neto,0);assert.equal(s.resumen.cargas,0);assert.equal(s.resumen.retiros,0);assert.equal(s.resumen.requiere_revision,false);
   await db.exec("update public.historial_ops set estado='OK' where id=70001");s=await summary('reversa');assert.equal(s.resumen.requiere_revision,true);
   await db.exec("update public.historial_ops set estado='REVERTIDA' where id in (70001,70002);insert into public.historial_ops(id,usuario,pc_codigo,tipo,estado,monto,reversion_de) values (70003,'reversa','P1','CARGA','OK',100,70002)");
   s=await summary('reversa');assert.equal(s.resumen.requiere_revision,true);assert.equal(s.detalle_total,3);
  });
  await check('identidad completa por campo y procedencia del destino, incluido alias; rechazo no acredita pago',async()=>{
   await db.exec("update public.usuarios_portal_vinculos set telefono_canon='' where pc_codigo='P1' and usuario='perfil_demo';insert into public.usuarios_portal_vinculos(usuario,pc_codigo,telefono_canon,estado_vinculo) values ('perfil_demo','P_1','5550000999','VINCULADO')");
   let s=await summary();assert.equal(s.resumen.telefono,'5550000999');assert.equal(s.resumen.titular,'Demo P1');assert.equal(s.resumen.cbu_fuente,'RETIRO_CONFIRMADO');
   await db.exec("insert into public.historial_ops(id,usuario,pc_codigo,tipo,estado,monto,notas) values (70010,'perfil_demo','P1','RETIRO','RECHAZADA',1,'CBU: alias.nuevo')");
   s=await summary();assert.equal(s.resumen.cbu,'1234567890123456789012');
   await db.exec("update public.historial_ops set estado='OK' where id=70010");s=await summary();assert.equal(s.resumen.cbu,'alias.nuevo');assert.equal(s.resumen.cbu_fuente,'RETIRO_CONFIRMADO');
   await db.exec("update public.usuarios_portal_vinculos set cbu_retiro='alias.declarado' where pc_codigo='P1' and usuario='perfil_demo'");s=await summary();assert.equal(s.resumen.cbu,'alias.declarado');assert.equal(s.resumen.cbu_fuente,'VINCULO_DECLARADO');
  });
  await check('prueba de reducción de filas/bytes sin afirmar mejora de tiempo',async()=>{
   const old=await query("select * from public.historial_ops where upper(btrim(pc_codigo)) in ('P1','P_1') and lower(btrim(usuario))='perfil_demo' order by created_at desc limit 3000");
   const s=await summary(),d=await detail();const before=Buffer.byteLength(JSON.stringify(old)),after=Buffer.byteLength(JSON.stringify({s,d}));
   assert.ok(after<before/10);report.payload={before_rows:old.length,after_detail_rows:d.rows.length,summary_total:s.detalle_total,before_bytes:before,after_bytes:after,fixture:true};
  });

  // Instalar identidad-observaciones-v1.sql (antes de persistencia-local-v1.sql)
  await db.exec(texts[2]);
  await check('identidad observaciones v1: funciona sin vista local (locales_disponibles=false) y preserva fuentes/fechas',async()=>{
   const idRes=await rpc('nodo_beta_perfil_identidad_v1',[TOKEN,'P1','perfil_demo',50,null]);
   assert.equal(idRes.ok,true);
   assert.equal(idRes.locales_disponibles,false);
   assert.ok(Array.isArray(idRes.rows)&&idRes.rows.length>=6);
   const fuentes=new Set(idRes.rows.map(r=>r.fuente));
   assert.ok(fuentes.has('usuarios')&&fuentes.has('usuarios_portal_vinculos')&&fuentes.has('usuarios_cuentas_retiro')&&fuentes.has('usuarios_portal_eventos')&&fuentes.has('landing_solicitudes')&&fuentes.has('historial_ops'));
   assert.ok(idRes.rows.some(r=>r.campo==='ip'&&r.valor==='181.10.20.30'&&r.fuente==='landing_solicitudes'));
   assert.ok(idRes.rows.every(r=>r.usuario==='perfil_demo'&&['P1','P_1'].includes(r.pc_codigo)));
  });

  // Instalar persistencia-local-v1.sql, lecturas-operativas-v1.sql y capacidades-v1.sql
  await db.exec(texts[3]);
  await db.exec(texts[4]);
  await db.exec(texts[5]);

  await check('capacidades v1: anuncia todos los contratos de dominio instalados',async()=>{
   const cap=await rpc('nodo_beta_capacidades_v1',[TOKEN,'P1','test-build',false]);
   assert.equal(cap.ok,true);
   for(const expected of ['perfil.summary.v1','perfil.detail.v1','perfil.identity.v1','persistence.local.v1','historial.filters.v1','bandeja.queue.v1','nexo.export.v1']){
    assert.ok(cap.capabilities.includes(expected),'Falta capacidad '+expected);
   }
  });

  await check('persistencia local v1: sincroniza lote con ACK por categoría, alimenta observaciones_locales y lee sin re-ejecutar colas',async()=>{
   const lote={
    jugadores:[
     {source_id:'jug:perfil_demo:tel:5559998888',campo:'telefono',usuario:'perfil_demo',atributo:'telefono',valor:'5559998888',fuente:'local.jugadores',estado:'VERIFICADO_LOCAL',veces:2,verificado:true,ultima_fecha:'2026-10-03T12:00:00Z'},
     {source_id:'rech:*|juan perez',campo:'nombre',usuario:'*',atributo:'titular_rechazado',valor:'Juan Perez',fuente:'local.titulares_rechazados',estado:'BLOQUEADO_GLOBAL',veces:1,verificado:false,ultima_fecha:'2026-10-03T12:00:00Z',detalle:{motivo:'MULTICUENTA',global:true}}
    ],
    movimientos:[
     {movimiento_key:'9000000000000001',historial_id:'9000000000000001',solicitud_id:'5001',chunior_id:'CHU-777',usuario:'perfil_demo',tipo:'RETIRO',monto:'20',estado:'OK',titular:'Demo Local Mov',cbu:'alias.local.mov',obs:'observacion local',fecha:'2026-10-02T12:05:00Z'}
    ],
    cotejos:[
     {cotejo_key:'alta:perfildemo|5559998888',tipo_cotejo:'ALTA_TELEFONO',usuario:'perfil_demo',telefono:'5559998888',usuario_declarado:'perfildemo',telefono_declarado:'5559998888',estado:'RESUELTO',fecha:'2026-10-03T12:10:00Z'}
    ],
    colas:[
     {cola_tipo:'CHUNIOR_PENDIENTE',item_id:'chu:5002',usuario:'perfil_demo',referencia_id:'5002',estado:'PENDIENTE',motivo:'SIN_CONEXION',fecha:'2026-10-03T12:15:00Z'}
    ]
   };
   const syncRes=await rpc('nodo_beta_persistencia_sync_v1',[TOKEN,'P1','pc-p1-test','2.1.5',lote]);
   assert.equal(syncRes.ok,true);
   assert.equal(syncRes.accepted_total,5);
   assert.deepEqual(syncRes.acknowledged.jugadores,['jug:perfil_demo:tel:5559998888','rech:*|juan perez']);
   assert.deepEqual(syncRes.acknowledged.movimientos,['9000000000000001']);
   assert.deepEqual(syncRes.acknowledged.cotejos,['alta:perfildemo|5559998888']);
   assert.deepEqual(syncRes.acknowledged.colas,['chu:5002']);

   const readRes=await rpc('nodo_beta_persistencia_leer_v1',[TOKEN,'P1','perfil_demo',null,'TODO',50,null]);
   assert.equal(readRes.ok,true);
   assert.equal(readRes.jugadores.length,2);
   assert.equal(readRes.movimientos.length,1);
   assert.equal(readRes.movimientos[0].chunior_id,'CHU-777');
   assert.equal(readRes.cotejos.length,1);
   assert.equal(readRes.colas_observadas.length,1);
   assert.equal(readRes.colas_observadas[0].re_ejecutar,false);

   const idRes=await rpc('nodo_beta_perfil_identidad_v1',[TOKEN,'P1','perfil_demo',50,null]);
   assert.equal(idRes.locales_disponibles,true);
   assert.ok(idRes.rows.some(r=>r.fuente==='local.jugadores'&&r.valor==='5559998888'));
   assert.ok(idRes.rows.some(r=>r.fuente==='local.movimientos'&&r.valor==='alias.local.mov'));
   assert.ok(idRes.rows.some(r=>r.fuente==='local.cotejo_alta'&&r.valor==='5559998888'));
  });

  await check('historial v1: filtra en servidor, calcula totales fuera de página y pagina con cursor',async()=>{
   const h1=await rpc('nodo_beta_historial_v1',[TOKEN,'P1',{usuario:'perfil_demo'},50,null]);
   assert.equal(h1.ok,true);
   assert.equal(h1.totals.total_rows,6003);
   assert.equal(h1.totals.cargas,6001);
   assert.equal(h1.totals.retiros,1);
   assert.equal(h1.totals.monto_cargas,60030);
   assert.equal(h1.totals.monto_retiros,20);
   assert.equal(h1.totals.neto,60010);
   assert.equal(h1.rows.length,50);
   assert.equal(h1.has_more,true);
   assert.ok(h1.billeteras.includes('Billetera A')&&h1.billeteras.includes('Billetera B'));
   const h2=await rpc('nodo_beta_historial_v1',[TOKEN,'P1',{usuario:'perfil_demo',tipo:'RETIRO'},50,null]);
   assert.equal(h2.totals.total_rows,1);
   assert.equal(h2.rows.length,1);
   assert.equal(h2.rows[0].id,'9000000000000001');
  });

  await check('bandeja v1: nunca trunca abiertas ni retiros parciales activos aunque haya 100 cerradas más nuevas',async()=>{
   const b=await rpc('nodo_beta_bandeja_v1',[TOKEN,'P1',{},50,null]);
   assert.equal(b.ok,true);
   const opIds=new Set(b.operativas.map(r=>r.id));
   assert.ok(opIds.has('5001'),'Retiro parcial activo antiguo debe seguir en operativas');
   assert.ok(opIds.has('5002'),'Solicitud abierta antigua debe seguir en operativas');
   assert.equal(b.totales.pendientes_carga,1);
   assert.equal(b.totales.parciales_activos,1);
   assert.equal(b.rows.length,50);
   assert.equal(b.has_more,true);
  });

  await check('nexo export v1: exporta cargas y retiros efectivos paginados con total exacto',async()=>{
   const n1=await rpc('nodo_beta_nexo_export_v1',[TOKEN,'P1',1000,null]);
   assert.equal(n1.ok,true);
   assert.equal(n1.total,6008);
   assert.equal(n1.rows.length,1000);
   assert.equal(n1.has_more,true);
   assert.equal(n1.complete,false);
   assert.ok(n1.next_cursor&&n1.next_cursor.id);
  });
 }catch(e){report.setup_error={message:e.message,code:e.code};}
 finally{await db.close();}
 report.source_changed_during_run=sources.some(f=>hash(fs.readFileSync(path.join(ROOT,f),'utf8'))!==report.source_hashes[f]);
 report.passed=report.tests.filter(t=>t.ok).length;report.failed=report.tests.filter(t=>!t.ok).length;report.ok=!report.setup_error&&!report.failed&&!report.source_changed_during_run;
 report.finished_at=new Date().toISOString();
 const i=process.argv.indexOf('--report');if(i>=0)fs.writeFileSync(path.resolve(process.argv[i+1]),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;return report;
}
if(require.main===module)verify().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verify,extension};
