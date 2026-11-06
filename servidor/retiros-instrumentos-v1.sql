-- Retiros Portal: validacion humana y ciega de titularidad. No almacena DNI en claro.
-- Desplegar tras cotejar definiciones/ACL remotas. Todo queda desactivado por oficina.
create schema if not exists retiros_privados;
revoke all on schema retiros_privados from public,anon,authenticated;

create table if not exists retiros_privados.config_oficina(
  pc_codigo text primary key check(pc_codigo=upper(btrim(pc_codigo)) and pc_codigo<>''),
  habilitado boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists retiros_privados.secreto_dni(
  singleton boolean primary key default true check(singleton), secreto text not null
);
insert into retiros_privados.secreto_dni(singleton,secreto)
values(true,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''))
on conflict(singleton) do nothing;

create table if not exists retiros_privados.instrumentos(
  id uuid primary key default gen_random_uuid(),
  pc_codigo text not null, usuario_norm text not null, destino_norm text not null, titular_norm text not null,
  estado text not null check(estado in ('PENDIENTE','VALIDADO','RECHAZADO')), dni_hash text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  validado_at timestamptz, validado_por text,
  unique(pc_codigo,usuario_norm,destino_norm),
  check((estado='VALIDADO')=(validado_at is not null)),
  check(estado<>'VALIDADO' or dni_hash is null)
);
create table if not exists retiros_privados.solicitudes(
  solicitud_id bigint primary key, pc_codigo text not null, usuario_norm text not null,
  instrumento_id uuid not null references retiros_privados.instrumentos(id),
  estado text not null check(estado in ('PENDIENTE','VALIDADO','RECHAZADO')),
  dni_hash_esperado text, intentos_validacion integer not null default 0 check(intentos_validacion between 0 and 1),
  validado_at timestamptz, validado_por text, aprobado_at timestamptz, aprobado_por text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(estado<>'VALIDADO' or (validado_at is not null and dni_hash_esperado is null))
);
create unique index if not exists retiros_privados_una_validacion_pendiente
  on retiros_privados.solicitudes(instrumento_id) where estado='PENDIENTE';
create table if not exists retiros_privados.dni_rechazados(
  pc_codigo text not null, usuario_norm text not null, dni_hash text not null,
  rechazado_at timestamptz not null default now(), primary key(pc_codigo,usuario_norm,dni_hash)
);
create table if not exists retiros_privados.auditoria(
  id bigint generated always as identity primary key, solicitud_id bigint not null, pc_codigo text not null,
  evento text not null check(evento in ('SOLICITADO','VALIDADO','DNI_MISMATCH','RECHAZADO','PAGO_CONFIRMADO')),
  operador text, ocurrido_at timestamptz not null default now()
);
revoke all on all tables in schema retiros_privados from public,anon,authenticated;
revoke all on all sequences in schema retiros_privados from public,anon,authenticated;

create or replace function retiros_privados.dni_fingerprint(p_dni text)
returns text language sql security definer set search_path=''
as $fn$
  select encode(sha256(convert_to(s.secreto||':'||p_dni,'UTF8')),'hex')
  from retiros_privados.secreto_dni s where s.singleton
$fn$;
revoke all on function retiros_privados.dni_fingerprint(text) from public,anon,authenticated;

create or replace function retiros_privados.resolver_pc(p_public_code text,p_host text)
returns text language plpgsql security definer set search_path=''
as $fn$
declare v_pc text; v_code text; v_host text; v_byhost jsonb;
begin
  v_code:=nullif(btrim(coalesce(p_public_code,'')),'');
  if v_code is not null then
    select r.pc_codigo into v_pc from public.landing_rutas_publicas r
     where lower(coalesce(r.public_code,''))=lower(v_code) and coalesce(r.activo,true) is true limit 1;
    if coalesce(btrim(v_pc),'')='' then v_pc:=public.landing_portal_v16_pc_from_code(v_code); end if;
  else
    v_host:=nullif(btrim(coalesce(p_host,'')),'');
    if v_host is not null then
      v_byhost:=public.landing_resolver_ruta_por_host(v_host);
      if coalesce((v_byhost->>'ok')::boolean,false) then v_pc:=v_byhost->>'pc_codigo'; end if;
    end if;
  end if;
  if coalesce(btrim(v_pc),'')='' then raise exception using errcode='22023',message='AGENTE_NO_RESUELTO'; end if;
  return upper(btrim(v_pc));
end
$fn$;
revoke all on function retiros_privados.resolver_pc(text,text) from public,anon,authenticated;

create or replace function retiros_privados.validar_vinculo(p_pc text,p_usuario text,p_telefono text)
returns void language plpgsql security definer set search_path=''
as $fn$
declare v_vinc jsonb; v_verdict text;
begin
  v_vinc:=public.landing_portal_resolver_vinculo(p_pc,p_usuario,coalesce(p_telefono,''));
  v_verdict:=upper(coalesce(v_vinc->>'verdict',''));
  if v_verdict not in ('ACCESO','NUEVO','PENDIENTE') then
    raise exception using errcode='42501',message='VINCULO_NO_VALIDO';
  end if;
end
$fn$;
revoke all on function retiros_privados.validar_vinculo(text,text,text) from public,anon,authenticated;

create or replace function public.landing_portal_retiro_contexto_v1(
  p_public_code text,p_usuario text,p_telefono text,p_host text default null)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_pc text; v_enabled boolean; v_inst record; v_last record;
begin
  if coalesce(btrim(p_usuario),'')='' then raise exception using errcode='22023',message='USUARIO_REQUERIDO'; end if;
  v_pc:=retiros_privados.resolver_pc(p_public_code,p_host);
  perform retiros_privados.validar_vinculo(v_pc,p_usuario,p_telefono);
  select coalesce(c.habilitado,false) into v_enabled from retiros_privados.config_oficina c where c.pc_codigo=v_pc;
  v_enabled:=coalesce(v_enabled,false);
  if not v_enabled then return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','enabled',false); end if;
  select i.id,i.destino_norm,i.titular_norm,i.validado_at into v_inst
    from retiros_privados.instrumentos i
   where i.pc_codigo=v_pc and i.usuario_norm=lower(btrim(p_usuario)) and i.estado='VALIDADO'
   order by i.updated_at desc limit 1;
  select s.solicitud_id,s.estado as validacion_estado,l.estado as solicitud_estado,l.monto,
         l.updated_at,s.created_at,coalesce(l.metadata->>'motivo_rechazo','') as codigo
    into v_last
    from retiros_privados.solicitudes s
    join public.landing_solicitudes l on l.id=s.solicitud_id and upper(l.pc_codigo)=v_pc
   where s.pc_codigo=v_pc and s.usuario_norm=lower(btrim(p_usuario))
   order by s.created_at desc limit 1;
  return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','enabled',true,
    'instrumento',case when v_inst.id is null then null else jsonb_build_object(
      'id',v_inst.id,'destino',v_inst.destino_norm,'titular',v_inst.titular_norm,'validado_at',v_inst.validado_at) end,
    'ultima_solicitud',case when v_last.solicitud_id is null then null else jsonb_build_object(
      'id',v_last.solicitud_id,'estado_validacion',v_last.validacion_estado,
      'estado',v_last.solicitud_estado,'monto',v_last.monto,'actualizada_at',v_last.updated_at,
      'creada_at',v_last.created_at,'codigo',v_last.codigo) end);
end
$fn$;
revoke all on function public.landing_portal_retiro_contexto_v1(text,text,text,text) from public,anon,authenticated;
grant execute on function public.landing_portal_retiro_contexto_v1(text,text,text,text) to anon,authenticated;

create or replace function public.landing_portal_retiro_crear_v1(
  p_public_code text,p_usuario text,p_telefono text,p_host text,p_monto numeric,
  p_titular text,p_destino text,p_dni text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
  v_pc text; v_enabled boolean; v_user text; v_destino text; v_titular text;
  v_hash text; v_inst retiros_privados.instrumentos%rowtype; v_id bigint; v_result jsonb;
  v_state text; v_meta jsonb; v_has_inst boolean; v_now timestamptz:=clock_timestamp();
begin
  if coalesce(btrim(p_usuario),'')='' or p_monto is null or p_monto<=0
    or coalesce(length(btrim(p_destino)),0)<6 or coalesce(btrim(p_titular),'')='' then
    raise exception using errcode='22023',message='RETIRO_DATOS_INVALIDOS';
  end if;
  v_pc:=retiros_privados.resolver_pc(p_public_code,p_host);
  perform retiros_privados.validar_vinculo(v_pc,p_usuario,p_telefono);
  select coalesce(c.habilitado,false) into v_enabled from retiros_privados.config_oficina c where c.pc_codigo=v_pc;
  if not coalesce(v_enabled,false) then return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','enabled',false); end if;
  v_user:=lower(btrim(p_usuario));
  v_destino:=upper(regexp_replace(btrim(p_destino),'\s+','','g'));
  v_titular:=upper(regexp_replace(btrim(p_titular),'\s+',' ','g'));
  perform pg_advisory_xact_lock(hashtextextended(v_pc||':'||v_user,0));

  select i.* into v_inst from retiros_privados.instrumentos i
   where i.pc_codigo=v_pc and i.usuario_norm=v_user and i.destino_norm=v_destino for update;
  v_has_inst:=found;
  if v_has_inst and v_inst.estado='VALIDADO' and v_inst.titular_norm=v_titular then
    v_state:='VALIDADO';
  else
    if coalesce(p_dni,'') !~ '^\d{8}$' then
      return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','enabled',true,'error_code','DNI_REQUERIDO');
    end if;
    v_hash:=retiros_privados.dni_fingerprint(p_dni);
    if exists(select 1 from retiros_privados.dni_rechazados r
       where r.pc_codigo=v_pc and r.usuario_norm=v_user and r.dni_hash=v_hash) then
      return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','enabled',true,'error_code','DNI_RECHAZADO_PREVIAMENTE');
    end if;
    if not v_has_inst then
      insert into retiros_privados.instrumentos(pc_codigo,usuario_norm,destino_norm,titular_norm,estado,dni_hash,created_at,updated_at)
      values(v_pc,v_user,v_destino,v_titular,'PENDIENTE',v_hash,v_now,v_now) returning * into v_inst;
    else
      if v_inst.estado='PENDIENTE'
         and exists(select 1 from retiros_privados.solicitudes s where s.instrumento_id=v_inst.id and s.estado='PENDIENTE') then
        return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','enabled',true,'error_code','RETIRO_EN_VALIDACION');
      end if;
      update retiros_privados.instrumentos set titular_norm=v_titular,estado='PENDIENTE',dni_hash=v_hash,
        validado_at=null,validado_por=null,updated_at=v_now where id=v_inst.id returning * into v_inst;
    end if;
    v_state:='PENDIENTE';
  end if;

  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into v_meta
    from jsonb_each(coalesce(p_metadata,'{}'::jsonb)) e
   where e.key !~* '(dni|cuil|cuit|documento)';
  v_meta:=v_meta||jsonb_build_object('retiro_instrumento_v1',jsonb_build_object(
    'estado',v_state,'instrumento_id',v_inst.id,'primera_validacion',(v_state='PENDIENTE')));
  v_result:=public.landing_portal_v16_crear_solicitud(
    p_public_code,p_usuario,'RETIRO',p_monto,p_titular,p_destino,
    'Solicitud de RETIRO: $'||p_monto::text||' · Destino: '||p_destino||' · Titular: '||p_titular,v_meta);
  if not coalesce((v_result->>'ok')::boolean,false) then
    raise exception using errcode='40001',message='RETIRO_SOLICITUD_NO_CONFIRMADA';
  end if;
  v_id:=coalesce((v_result->>'solicitud_id')::bigint,(v_result->>'id')::bigint);
  if v_id is null then raise exception using errcode='40001',message='RETIRO_SOLICITUD_NO_CONFIRMADA'; end if;
  insert into retiros_privados.solicitudes(solicitud_id,pc_codigo,usuario_norm,instrumento_id,estado,dni_hash_esperado,
    validado_at,validado_por,created_at,updated_at)
  values(v_id,v_pc,v_user,v_inst.id,v_state,case when v_state='PENDIENTE' then v_hash else null end,
    case when v_state='VALIDADO' then v_inst.validado_at else null end,
    case when v_state='VALIDADO' then v_inst.validado_por else null end,v_now,v_now);
  insert into retiros_privados.auditoria(solicitud_id,pc_codigo,evento,ocurrido_at) values(v_id,v_pc,'SOLICITADO',v_now);
  return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','enabled',true,
    'solicitud_id',v_id,'estado_validacion',v_state,'validado_at',v_inst.validado_at);
end
$fn$;
revoke all on function public.landing_portal_retiro_crear_v1(text,text,text,text,numeric,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.landing_portal_retiro_crear_v1(text,text,text,text,numeric,text,text,text,jsonb) to anon,authenticated;

create or replace function public.nodo_beta_retiro_validar_v1(
  p_token text,p_pc_codigo text,p_solicitud_id bigint,p_dni_banco text default null,p_operador text default null)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_req retiros_privados.solicitudes%rowtype; v_inst retiros_privados.instrumentos%rowtype;
  v_hash text; v_now timestamptz:=clock_timestamp();
begin
  perform acceso.autorizar(p_token,p_pc_codigo);
  select * into v_req from retiros_privados.solicitudes
   where solicitud_id=p_solicitud_id and pc_codigo=upper(btrim(p_pc_codigo)) for update;
  if not found then raise exception using errcode='42501',message='BETA_RETIRO_NOT_AUTHORIZED'; end if;
  select * into v_inst from retiros_privados.instrumentos where id=v_req.instrumento_id for update;
  if v_req.estado='VALIDADO' and v_inst.estado='VALIDADO' then
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado','VALIDADO',
      'validado_at',v_req.validado_at,'reutilizado',true);
  end if;
  if v_req.estado<>'PENDIENTE' then
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado',v_req.estado,'code','RETIRO_NO_PENDIENTE');
  end if;
  if p_dni_banco is null then
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado','PENDIENTE','requiere_dni',true);
  end if;
  if p_dni_banco !~ '^\d{8}$' then
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado','PENDIENTE','code','DNI_FORMATO_INVALIDO');
  end if;
  if v_req.intentos_validacion>=1 then
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado','RECHAZADO','code','RETIRO_YA_VALIDADO_O_RECHAZADO');
  end if;
  update retiros_privados.solicitudes set intentos_validacion=1,updated_at=v_now where solicitud_id=p_solicitud_id;
  v_hash:=retiros_privados.dni_fingerprint(p_dni_banco);
  if v_hash=v_req.dni_hash_esperado then
    update retiros_privados.instrumentos set estado='VALIDADO',dni_hash=null,validado_at=v_now,
      validado_por=nullif(btrim(p_operador),''),updated_at=v_now where id=v_inst.id returning * into v_inst;
    update retiros_privados.solicitudes set estado='VALIDADO',dni_hash_esperado=null,validado_at=v_now,
      validado_por=nullif(btrim(p_operador),''),updated_at=v_now where solicitud_id=p_solicitud_id returning * into v_req;
    update public.landing_solicitudes set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'retiro_instrumento_v1',jsonb_build_object('estado','VALIDADO','instrumento_id',v_inst.id,
        'validado_at',v_now,'validado_por',nullif(btrim(p_operador),'')))
      where id=p_solicitud_id and upper(tipo)='RETIRO' and upper(pc_codigo)=upper(btrim(p_pc_codigo));
    insert into retiros_privados.auditoria(solicitud_id,pc_codigo,evento,operador,ocurrido_at)
      values(p_solicitud_id,upper(btrim(p_pc_codigo)),'VALIDADO',nullif(btrim(p_operador),''),v_now);
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado','VALIDADO','validado_at',v_now,'reutilizado',false);
  end if;

  insert into retiros_privados.dni_rechazados(pc_codigo,usuario_norm,dni_hash,rechazado_at)
    values(v_req.pc_codigo,v_req.usuario_norm,v_req.dni_hash_esperado,v_now) on conflict do nothing;
  update retiros_privados.instrumentos set estado='RECHAZADO',dni_hash=null,updated_at=v_now where id=v_inst.id;
  update retiros_privados.solicitudes set estado='RECHAZADO',dni_hash_esperado=null,updated_at=v_now where solicitud_id=p_solicitud_id;
  update public.landing_solicitudes set estado='RECHAZADA',updated_at=v_now,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('motivo','El DNI no coincide con el titular de la cuenta bancaria.',
      'motivo_rechazo','DNI_MISMATCH','etapa','RETIRO_DNI_MISMATCH',
      'retiro_instrumento_v1',jsonb_build_object('estado','RECHAZADO','code','DNI_MISMATCH','rechazado_at',v_now))
    where id=p_solicitud_id and upper(tipo)='RETIRO' and upper(pc_codigo)=upper(btrim(p_pc_codigo));
  insert into retiros_privados.auditoria(solicitud_id,pc_codigo,evento,operador,ocurrido_at)
    values(p_solicitud_id,upper(btrim(p_pc_codigo)),'DNI_MISMATCH',nullif(btrim(p_operador),''),v_now);
  return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado','RECHAZADO','code','DNI_MISMATCH');
end
$fn$;
revoke all on function public.nodo_beta_retiro_validar_v1(text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.nodo_beta_retiro_validar_v1(text,text,bigint,text,text) to anon,authenticated;

create or replace function public.nodo_beta_retiro_rechazar_v1(
  p_token text,p_pc_codigo text,p_solicitud_id bigint,p_operador text default null)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_req retiros_privados.solicitudes%rowtype; v_now timestamptz:=clock_timestamp();
begin
  perform acceso.autorizar(p_token,p_pc_codigo);
  select * into v_req from retiros_privados.solicitudes
   where solicitud_id=p_solicitud_id and pc_codigo=upper(btrim(p_pc_codigo)) for update;
  if not found then raise exception using errcode='42501',message='BETA_RETIRO_NOT_AUTHORIZED'; end if;
  if v_req.estado<>'PENDIENTE' then
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado',v_req.estado,'code','RETIRO_NO_PENDIENTE');
  end if;
  if v_req.dni_hash_esperado is not null then
    insert into retiros_privados.dni_rechazados(pc_codigo,usuario_norm,dni_hash,rechazado_at)
      values(v_req.pc_codigo,v_req.usuario_norm,v_req.dni_hash_esperado,v_now) on conflict do nothing;
  end if;
  update retiros_privados.instrumentos set estado='RECHAZADO',dni_hash=null,updated_at=v_now where id=v_req.instrumento_id;
  update retiros_privados.solicitudes set estado='RECHAZADO',dni_hash_esperado=null,updated_at=v_now where solicitud_id=p_solicitud_id;
  update public.landing_solicitudes set estado='RECHAZADA',updated_at=v_now,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('motivo','No se pudo confirmar la titularidad de la cuenta.',
      'motivo_rechazo','TITULARIDAD_NO_CONFIRMADA','etapa','RETIRO_TITULARIDAD_RECHAZADA',
      'retiro_instrumento_v1',jsonb_build_object('estado','RECHAZADO','code','TITULARIDAD_NO_CONFIRMADA','rechazado_at',v_now))
    where id=p_solicitud_id and upper(tipo)='RETIRO' and upper(pc_codigo)=upper(btrim(p_pc_codigo));
  insert into retiros_privados.auditoria(solicitud_id,pc_codigo,evento,operador,ocurrido_at)
    values(p_solicitud_id,upper(btrim(p_pc_codigo)),'RECHAZADO',nullif(btrim(p_operador),''),v_now);
  return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','estado','RECHAZADO');
end
$fn$;
revoke all on function public.nodo_beta_retiro_rechazar_v1(text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.nodo_beta_retiro_rechazar_v1(text,text,bigint,text) to anon,authenticated;

create or replace function public.nodo_beta_retiro_pagar_v1(
  p_token text,p_pc_codigo text,p_solicitud_id bigint,p_operador text default null)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_req retiros_privados.solicitudes%rowtype; v_now timestamptz:=clock_timestamp(); v_local text;
begin
  perform acceso.autorizar(p_token,p_pc_codigo);
  select * into v_req from retiros_privados.solicitudes
   where solicitud_id=p_solicitud_id and pc_codigo=upper(btrim(p_pc_codigo)) for update;
  if not found or v_req.estado<>'VALIDADO' then
    raise exception using errcode='42501',message='BETA_RETIRO_NO_VALIDADO';
  end if;
  if v_req.aprobado_at is not null then
    return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','aprobado_at',v_req.aprobado_at,
      'hora_exacta',to_char(v_req.aprobado_at at time zone 'America/Argentina/Buenos_Aires','HH24:MI:SS'),'reutilizado',true);
  end if;
  v_local:=to_char(v_now at time zone 'America/Argentina/Buenos_Aires','HH24:MI:SS');
  update retiros_privados.solicitudes set aprobado_at=v_now,aprobado_por=nullif(btrim(p_operador),''),updated_at=v_now where solicitud_id=p_solicitud_id;
  update public.landing_solicitudes set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'retiro_aprobado_at',v_now,'retiro_aprobado_hora_exacta',v_local,
    'retiro_aprobado_por',nullif(btrim(p_operador),'')) where id=p_solicitud_id and upper(pc_codigo)=upper(btrim(p_pc_codigo));
  insert into retiros_privados.auditoria(solicitud_id,pc_codigo,evento,operador,ocurrido_at)
    values(p_solicitud_id,upper(btrim(p_pc_codigo)),'PAGO_CONFIRMADO',nullif(btrim(p_operador),''),v_now);
  return jsonb_build_object('ok',true,'contract','retiro.instrumentos.v1','aprobado_at',v_now,'hora_exacta',v_local,'reutilizado',false);
end
$fn$;
revoke all on function public.nodo_beta_retiro_pagar_v1(text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.nodo_beta_retiro_pagar_v1(text,text,bigint,text) to anon,authenticated;

comment on schema retiros_privados is 'Datos restringidos de validacion manual de instrumentos de retiro';
comment on table retiros_privados.instrumentos is 'El DNI nunca se guarda en claro y su fingerprint se elimina al validar o rechazar.';
comment on function public.nodo_beta_retiro_validar_v1(text,text,bigint,text,text) is 'Cotejo ciego de DNI; requiere beta token de la oficina y no devuelve el DNI.';
