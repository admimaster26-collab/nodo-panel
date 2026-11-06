'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function getPGlite(){
  for(const name of [process.env.NODO_PGLITE_PATH,'@electric-sql/pglite',path.join(os.tmpdir(),'nodo-beta-sql-validation/node_modules/@electric-sql/pglite')].filter(Boolean)){
    try{return require(name).PGlite;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
  }
  return null;
}

const PGlite=getPGlite();
const ROOT=path.resolve(__dirname,'..');
const TOKEN='aa'.repeat(32);
const SQL=fs.readFileSync(path.join(ROOT,'servidor/retiros-instrumentos-v1.sql'),'utf8');
const FIXTURE=String.raw`
create role anon; create role authenticated; create role service_role;
create schema acceso;
create function acceso.autorizar(p_token text,p_pc_codigo text) returns uuid language plpgsql as $$
begin
  if p_token <> '${TOKEN}' or upper(p_pc_codigo) not in ('P4','P5') then
    raise exception using errcode='42501',message='BETA_NOT_AUTHORIZED';
  end if;
  return gen_random_uuid();
end $$;
create table public.landing_rutas_publicas(public_code text,pc_codigo text,activo boolean default true);
insert into public.landing_rutas_publicas values('sanchez','P4',true),('oficina-p5','P5',true);
create table public.landing_solicitudes(
 id bigserial primary key,pc_codigo text,usuario text,tipo text,monto numeric,estado text,
 metadata jsonb default '{}'::jsonb,updated_at timestamptz default now()
);
create function public.landing_portal_v16_pc_from_code(p_code text) returns text language sql as
$$ select pc_codigo from public.landing_rutas_publicas where lower(public_code)=lower(p_code) limit 1 $$;
create function public.landing_resolver_ruta_por_host(p_host text) returns jsonb language sql as
$$ select jsonb_build_object('ok',true,'pc_codigo','P4','public_code','sanchez') $$;
create function public.landing_portal_resolver_vinculo(p_pc text,p_usuario text,p_telefono text) returns jsonb
language sql as $$ select jsonb_build_object('verdict','ACCESO') $$;
create function public.landing_portal_v16_crear_solicitud(
 p_public_code text,p_usuario text,p_tipo text,p_monto numeric,
 p_titular text default null,p_destino text default null,p_mensaje text default null,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$
declare v_pc text; v_id bigint;
begin
 select pc_codigo into v_pc from public.landing_rutas_publicas where lower(public_code)=lower(p_public_code) limit 1;
 insert into public.landing_solicitudes(pc_codigo,usuario,tipo,monto,estado,metadata)
 values(v_pc,p_usuario,p_tipo,p_monto,'PENDIENTE',coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'solicitud_id',v_id,'pc_codigo',v_pc);
end $$;
`;

test('retiro por instrumento: cotejo ciego, rechazo, corrección y hora de servidor en PGlite aislado', {skip:!PGlite}, async()=>{
  const db=new PGlite();
  try{
    await db.exec(FIXTURE);
    await db.exec(SQL);
    const call=async(name,args)=> (await db.query(
      'select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args
    )).rows[0].data;
    const disabled=await call('landing_portal_retiro_contexto_v1',['sanchez','DEMO','5550000001',null]);
    assert.equal(disabled.enabled,false,'oficinas sin activación conservan el canal anterior');
    await db.exec("insert into retiros_privados.config_oficina(pc_codigo,habilitado) values('P4',true),('P5',true)");
    const create=(code,dest,dni,meta={telefono:'5550000001'})=>call('landing_portal_retiro_crear_v1',[
      code,'DEMO','5550000001',null,15000,'JUAN PEREZ',dest,dni,meta
    ]);
    const first=await create('sanchez','alias.demo','38495012',{telefono:'5550000001',dni_note:'38495012'});
    assert.equal(first.enabled,true); assert.equal(first.estado_validacion,'PENDIENTE');
    const sid=first.solicitud_id;
    const row=await db.query('select metadata,estado from public.landing_solicitudes where id=$1',[sid]);
    assert.equal(JSON.stringify(row.rows[0]).includes('38495012'),false,'DNI no aparece en solicitud ni metadata');
    const stored=await db.query('select estado,dni_hash_esperado from retiros_privados.solicitudes where solicitud_id=$1',[sid]);
    assert.equal(stored.rows[0].estado,'PENDIENTE'); assert.match(stored.rows[0].dni_hash_esperado,/^[a-f0-9]{64}$/);
    const duplicate=await create('sanchez','alias.demo','38495012');
    assert.equal(duplicate.error_code,'RETIRO_EN_VALIDACION','no duplica solicitudes pendientes para la misma cuenta');

    const consult=await call('nodo_beta_retiro_validar_v1',[TOKEN,'P4',sid,null,'op-demo']);
    assert.equal(consult.estado,'PENDIENTE'); assert.equal(consult.requiere_dni,true);
    const valid=await call('nodo_beta_retiro_validar_v1',[TOKEN,'P4',sid,'38495012','op-demo']);
    assert.equal(valid.estado,'VALIDADO'); assert.equal(valid.contract,'retiro.instrumentos.v1');
    const sealed=await call('nodo_beta_retiro_pagar_v1',[TOKEN,'P4',sid,'op-demo']);
    assert.match(sealed.hora_exacta,/^\d{2}:\d{2}:\d{2}$/);
    const payment=await db.query("select metadata->>'retiro_aprobado_hora_exacta' as hora from public.landing_solicitudes where id=$1",[sid]);
    assert.equal(payment.rows[0].hora,sealed.hora_exacta);
    const noReplay=await call('nodo_beta_retiro_validar_v1',[TOKEN,'P4',sid,'11111111','op-demo']);
    assert.equal(noReplay.estado,'VALIDADO'); assert.equal(noReplay.reutilizado,true);
    const reusable=await create('sanchez','alias.demo',null);
    assert.equal(reusable.estado_validacion,'VALIDADO','una cuenta validada no vuelve a pedir DNI');

    const second=await create('sanchez','alias.otro','11223344');
    const mismatch=await call('nodo_beta_retiro_validar_v1',[TOKEN,'P4',second.solicitud_id,'99887766','op-demo']);
    assert.equal(mismatch.estado,'RECHAZADO'); assert.equal(mismatch.code,'DNI_MISMATCH');
    const rejected=await db.query('select estado,metadata from public.landing_solicitudes where id=$1',[second.solicitud_id]);
    assert.equal(rejected.rows[0].estado,'RECHAZADA');
    assert.equal(JSON.stringify(rejected.rows[0]).includes('11223344'),false);
    assert.equal(JSON.stringify(rejected.rows[0]).includes('99887766'),false);
    const context=await call('landing_portal_retiro_contexto_v1',['sanchez','DEMO','5550000001',null]);
    assert.equal(context.ultima_solicitud.id,second.solicitud_id);
    assert.equal(context.ultima_solicitud.codigo,'DNI_MISMATCH','el autoayuda puede dar corrección sin leer DNI');
    const blocked=await create('sanchez','alias.tercero','11223344');
    assert.equal(blocked.error_code,'DNI_RECHAZADO_PREVIAMENTE');
    const corrected=await create('sanchez','alias.tercero','22334455');
    assert.equal(corrected.estado_validacion,'PENDIENTE');

    await assert.rejects(()=>call('nodo_beta_retiro_validar_v1',[TOKEN,'P5',corrected.solicitud_id,'22334455','op-demo']),/BETA_RETIRO_NOT_AUTHORIZED/);
    const off=await db.query("select has_schema_privilege('anon','retiros_privados','USAGE') as private_schema");
    assert.equal(off.rows[0].private_schema,false);
  }finally{await db.close();}
});

