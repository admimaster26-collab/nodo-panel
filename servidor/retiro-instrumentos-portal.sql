-- Retiro con DNI: la unión de las dos versiones (7/11). Va DESPUÉS de retiro-instrumentos.sql.
--
-- De la versión de Codex (retiros-instrumentos-v1.sql, que no se publica): el DNI es una huella
-- (sha256 con un secreto del servidor) y nunca se guarda en claro; la huella se borra al validar o
-- rechazar; solicitud y cuenta se crean en un solo paso (no se puede saltear); la solicitud lleva la
-- marca metadata.retiro_instrumento_v1, que es la que hace que NODO pida el DNI; llave por oficina,
-- apagada por defecto; un DNI rechazado no lo puede volver a usar ese jugador en esa oficina.
-- De la de Claude: DNI de 7 u 8 dígitos o CUIT/CUIL completo; dos intentos para el operador; las
-- tablas retiro_instrumentos y las funciones panel_retiro_instrumento* con la clave del panel, que
-- es lo que ya llama NODO (withdrawal-instrument.js).
--
-- Canal nuevo: no cambia ninguna función que usen las oficinas con la 2.1.5 ni el Portal publicado.
-- Las landing_portal_retiro_* sólo las llama el Portal nuevo (copia de pruebas) y sólo en una oficina
-- con la llave prendida; sin llave el Portal sigue con el retiro de siempre.
-- Vuelta atrás: retiro-instrumentos-portal-vuelta-atras.sql

create table if not exists public.retiro_instrumentos_secreto (
  singleton boolean primary key default true check (singleton), secreto text not null);
insert into public.retiro_instrumentos_secreto(singleton, secreto)
values (true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (singleton) do nothing;

create table if not exists public.retiro_instrumentos_oficinas (
  pc_codigo text primary key check (pc_codigo = upper(btrim(pc_codigo)) and pc_codigo <> ''),
  habilitado boolean not null default false, updated_at timestamptz not null default now());

alter table public.retiro_instrumentos add column if not exists dni_hash text;
alter table public.retiro_instrumentos add column if not exists dni_fin text;

alter table public.retiro_instrumentos_secreto enable row level security;
alter table public.retiro_instrumentos_oficinas enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.retiro_instrumentos_secreto, public.retiro_instrumentos_oficinas from anon, authenticated, public';
  end if;
end $$;

-- Huella del DNI ya normalizado. Sin el secreto no se puede volver al número.
create or replace function public._retiro_inst_hash(p_dni text) returns text
language sql stable security definer set search_path to 'public' as $$
  select encode(sha256(convert_to(s.secreto || ':' || p_dni, 'UTF8')), 'hex')
  from public.retiro_instrumentos_secreto s where s.singleton
$$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public._retiro_inst_hash(text) from anon, authenticated, public';
  end if;
end $$;

-- La oficina del Portal: por código o, si no vino, por el dominio.
create or replace function public._retiro_inst_pc2(p_public_code text, p_host text) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare v_pc text; v_byhost jsonb;
begin
  v_pc := public._retiro_inst_pc(p_public_code);
  if v_pc is null and nullif(btrim(coalesce(p_host,'')), '') is not null then
    v_byhost := public.landing_resolver_ruta_por_host(btrim(p_host));
    if coalesce((v_byhost->>'ok')::boolean, false) then v_pc := nullif(upper(btrim(coalesce(v_byhost->>'pc_codigo',''))), ''); end if;
  end if;
  return v_pc;
end $$;

-- Marca de la solicitud: NODO la lee para saber si pide DNI; el Portal, para mostrar el estado.
create or replace function public._retiro_inst_marcar(p_solicitud_id bigint, p_estado text, p_extra jsonb default '{}'::jsonb)
returns void language sql volatile security definer set search_path to 'public' as $$
  update public.landing_solicitudes
     set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('retiro_instrumento_v1',
           coalesce(metadata->'retiro_instrumento_v1','{}'::jsonb) || jsonb_build_object('estado', p_estado) || coalesce(p_extra,'{}'::jsonb))
   where id = p_solicitud_id and metadata ? 'retiro_instrumento_v1'
$$;

-- ── Las funciones de NODO, ahora con huella ──────────────────────────────────────────────────

create or replace function public.panel_retiro_instrumento(p_secret text, p_solicitud_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare k record; v_row public.retiro_instrumentos;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  select * into k from public._retiro_inst_de_solicitud(p_solicitud_id);
  if k.pc_codigo is null then return jsonb_build_object('ok', false, 'motivo', 'SOLICITUD_NO_EXISTE'); end if;
  select * into v_row from public.retiro_instrumentos
   where pc_codigo = k.pc_codigo and usuario = k.usuario and destino_norm = k.destino_norm;
  return jsonb_build_object('ok', true,
    'estado', case when v_row.id is null or (v_row.estado = 'PENDIENTE' and v_row.dni_hash is null) then 'SIN_DECLARAR' else v_row.estado end,
    'destino', v_row.destino, 'titular', v_row.titular,
    'validado_at', v_row.validado_at, 'validado_por', v_row.validado_por,
    'rechazado_at', v_row.rechazado_at,
    'intentos_restantes', greatest(0, 2 - coalesce(v_row.intentos_operador, 0)),
    'otras_validadas', coalesce((
      select jsonb_agg(jsonb_build_object('destino', o.destino, 'titular', o.titular,
               'dni_fin', o.dni_fin, 'validado_at', o.validado_at) order by o.validado_at desc)
      from public.retiro_instrumentos o
      where o.pc_codigo = k.pc_codigo and o.usuario = k.usuario and o.estado = 'VALIDADO'
        and o.id is distinct from v_row.id), '[]'::jsonb));
end $$;

create or replace function public.panel_retiro_instrumento_validar(
  p_secret text, p_solicitud_id bigint, p_dni_banco text, p_operador text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare k record; v_row public.retiro_instrumentos; v_dni text; v_op text := nullif(trim(coalesce(p_operador,'')), '');
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  select * into k from public._retiro_inst_de_solicitud(p_solicitud_id);
  if k.pc_codigo is null then return jsonb_build_object('ok', false, 'motivo', 'SOLICITUD_NO_EXISTE'); end if;
  select * into v_row from public.retiro_instrumentos
   where pc_codigo = k.pc_codigo and usuario = k.usuario and destino_norm = k.destino_norm for update;
  if v_row.id is null then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  if v_row.estado = 'VALIDADO' then
    perform public._retiro_inst_marcar(p_solicitud_id, 'VALIDADO', jsonb_build_object('validado_at', v_row.validado_at));
    return jsonb_build_object('ok', true, 'estado', 'VALIDADO', 'validado_at', v_row.validado_at, 'ya_validado', true);
  end if;
  if v_row.estado = 'RECHAZADO' then return jsonb_build_object('ok', false, 'motivo', 'RECHAZADO'); end if;
  if v_row.dni_hash is null then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  v_dni := public._retiro_inst_norm_dni(p_dni_banco);
  if v_dni is null then return jsonb_build_object('ok', false, 'motivo', 'DNI_INVALIDO'); end if;

  if public._retiro_inst_hash(v_dni) = v_row.dni_hash then
    update public.retiro_instrumentos
       set estado = 'VALIDADO', dni_hash = null, validado_por = v_op, validado_at = now(), solicitud_id = p_solicitud_id,
           intentos_operador = 0, updated_at = now()
     where id = v_row.id returning * into v_row;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'VALIDADO', v_op);
    perform public._retiro_inst_marcar(p_solicitud_id, 'VALIDADO', jsonb_build_object('validado_at', v_row.validado_at, 'validado_por', v_op));
    return jsonb_build_object('ok', true, 'estado', 'VALIDADO', 'validado_at', v_row.validado_at);
  end if;

  if v_row.intentos_operador + 1 < 2 then
    update public.retiro_instrumentos set intentos_operador = intentos_operador + 1, updated_at = now() where id = v_row.id;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'NO_COINCIDE', v_op);
    return jsonb_build_object('ok', false, 'motivo', 'NO_COINCIDE', 'intentos_restantes', 1);
  end if;

  update public.retiro_instrumentos
     set estado = 'RECHAZADO', dni_rechazados = array_append(dni_rechazados, dni_hash), dni_hash = null,
         rechazado_por = v_op, rechazado_at = now(), intentos_operador = 0, solicitud_id = p_solicitud_id, updated_at = now()
   where id = v_row.id;
  insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
  values (v_row.id, p_solicitud_id, 'RECHAZADO', v_op);
  perform public._retiro_inst_marcar(p_solicitud_id, 'RECHAZADO', jsonb_build_object('code', 'DNI_NO_COINCIDE'));
  return jsonb_build_object('ok', false, 'motivo', 'RECHAZADO');
end $$;

create or replace function public.panel_retiro_instrumento_rechazar(p_secret text, p_solicitud_id bigint, p_operador text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare k record; v_row public.retiro_instrumentos; v_op text := nullif(trim(coalesce(p_operador,'')), '');
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  select * into k from public._retiro_inst_de_solicitud(p_solicitud_id);
  if k.pc_codigo is null then return jsonb_build_object('ok', false, 'motivo', 'SOLICITUD_NO_EXISTE'); end if;
  select * into v_row from public.retiro_instrumentos
   where pc_codigo = k.pc_codigo and usuario = k.usuario and destino_norm = k.destino_norm for update;
  if v_row.id is null or (v_row.estado = 'PENDIENTE' and v_row.dni_hash is null) then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  if v_row.estado = 'VALIDADO' then return jsonb_build_object('ok', false, 'motivo', 'YA_VALIDADO'); end if;
  if v_row.estado <> 'RECHAZADO' then
    update public.retiro_instrumentos
       set estado = 'RECHAZADO', dni_rechazados = array_append(dni_rechazados, dni_hash), dni_hash = null,
           rechazado_por = v_op, rechazado_at = now(), intentos_operador = 0, solicitud_id = p_solicitud_id, updated_at = now()
     where id = v_row.id;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'RECHAZADO', v_op);
  end if;
  perform public._retiro_inst_marcar(p_solicitud_id, 'RECHAZADO', jsonb_build_object('code', 'TITULARIDAD_NO_CONFIRMADA'));
  return jsonb_build_object('ok', true, 'estado', 'RECHAZADO');
end $$;

-- La declaración suelta (sin crear solicitud) queda con huella también; el Portal nuevo usa crear_v1.
create or replace function public.landing_retiro_instrumento_declarar(
  p_public_code text, p_usuario text, p_telefono text, p_destino text, p_titular text, p_dni text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
begin
  raise exception 'USAR_LANDING_PORTAL_RETIRO_CREAR_V1';
end $$;

create or replace function public.landing_retiro_instrumentos(p_public_code text, p_usuario text, p_telefono text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  raise exception 'USAR_LANDING_PORTAL_RETIRO_CONTEXTO_V1';
end $$;

-- ── Portal ───────────────────────────────────────────────────────────────────────────────────

create or replace function public.landing_portal_retiro_contexto_v1(
  p_public_code text, p_usuario text, p_telefono text, p_host text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pc text; v_u text := lower(trim(coalesce(p_usuario,''))); v_vinc jsonb; v_verdict text;
  v_inst public.retiro_instrumentos; v_last record; v_on boolean;
begin
  -- Primero la llave: con la oficina apagada (o sin oficina/usuario) el Portal sigue con el retiro
  -- de siempre, con los mismos controles y mensajes de hoy. Nada de esta función lo frena.
  v_pc := public._retiro_inst_pc2(p_public_code, p_host);
  if v_pc is not null then
    select coalesce(o.habilitado, false) into v_on from public.retiro_instrumentos_oficinas o where o.pc_codigo = v_pc;
  end if;
  if v_u = '' or not coalesce(v_on, false) then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', false);
  end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  v_verdict := upper(coalesce(v_vinc->>'verdict',''));
  if v_verdict not in ('ACCESO','NUEVO','PENDIENTE') then raise exception 'VINCULO_NO_VALIDO'; end if;
  -- La cuenta validada sólo con vínculo confirmado: el Portal la compara con lo que escribe el jugador.
  if v_verdict = 'ACCESO' then
    select * into v_inst from public.retiro_instrumentos i
     where i.pc_codigo = v_pc and i.usuario = v_u and i.estado = 'VALIDADO' order by i.validado_at desc limit 1;
  end if;
  select s.id, s.estado, s.monto, s.updated_at, s.created_at,
         s.metadata->'retiro_instrumento_v1'->>'estado' as validacion, coalesce(s.metadata->>'motivo_rechazo','') as codigo
    into v_last
    from public.landing_solicitudes s
   where upper(s.pc_codigo) = v_pc and upper(s.tipo) = 'RETIRO' and s.metadata ? 'retiro_instrumento_v1'
     and lower(trim(coalesce(s.metadata->>'usuario', s.usuario, ''))) = v_u
   order by s.id desc limit 1;
  return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true,
    'instrumento', case when v_inst.id is null then null else jsonb_build_object(
      'id', v_inst.id,
      'destino', upper(regexp_replace(btrim(v_inst.destino), '\s+', '', 'g')),
      'titular', upper(regexp_replace(btrim(coalesce(v_inst.titular,'')), '\s+', ' ', 'g')),
      'validado_at', v_inst.validado_at) end,
    'ultima_solicitud', case when v_last.id is null then null else jsonb_build_object(
      'id', v_last.id, 'estado_validacion', v_last.validacion, 'estado', v_last.estado, 'monto', v_last.monto,
      'actualizada_at', v_last.updated_at, 'creada_at', v_last.created_at, 'codigo', v_last.codigo) end);
end $$;

create or replace function public.landing_portal_retiro_crear_v1(
  p_public_code text, p_usuario text, p_telefono text, p_host text, p_monto numeric,
  p_titular text, p_destino text, p_dni text, p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_pc text; v_u text := lower(trim(coalesce(p_usuario,''))); v_on boolean; v_vinc jsonb;
  v_dest text := trim(coalesce(p_destino,'')); v_norm text; v_tit text := upper(regexp_replace(btrim(coalesce(p_titular,'')), '\s+', ' ', 'g'));
  v_inst public.retiro_instrumentos; v_estado text; v_dni text; v_hash text; v_meta jsonb; v_res jsonb; v_id bigint;
begin
  if v_u = '' or p_monto is null or p_monto <= 0 or v_tit = '' then raise exception 'RETIRO_DATOS_INVALIDOS'; end if;
  v_norm := public._retiro_inst_norm_destino(v_dest);
  if length(v_norm) < 6 then raise exception 'RETIRO_DATOS_INVALIDOS'; end if;
  v_pc := public._retiro_inst_pc2(p_public_code, p_host);
  if v_pc is null then raise exception 'AGENTE_NO_RESUELTO'; end if;
  select coalesce(o.habilitado, false) into v_on from public.retiro_instrumentos_oficinas o where o.pc_codigo = v_pc;
  if not coalesce(v_on, false) then return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', false); end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  if upper(coalesce(v_vinc->>'verdict','')) not in ('ACCESO','NUEVO','PENDIENTE') then raise exception 'VINCULO_NO_VALIDO'; end if;
  perform pg_advisory_xact_lock(hashtextextended('retiro:' || v_pc || ':' || v_u, 0));

  select * into v_inst from public.retiro_instrumentos
   where pc_codigo = v_pc and usuario = v_u and destino_norm = v_norm for update;
  if v_inst.id is not null and v_inst.estado = 'VALIDADO'
     and upper(regexp_replace(btrim(coalesce(v_inst.titular,'')), '\s+', ' ', 'g')) = v_tit then
    v_estado := 'VALIDADO';
  else
    v_dni := public._retiro_inst_norm_dni(p_dni);
    if v_dni is null then
      return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DNI_REQUERIDO');
    end if;
    v_hash := public._retiro_inst_hash(v_dni);
    if exists (select 1 from public.retiro_instrumentos r where r.pc_codigo = v_pc and r.usuario = v_u and v_hash = any(r.dni_rechazados)) then
      return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DNI_RECHAZADO_PREVIAMENTE');
    end if;
    if v_inst.id is not null and v_inst.estado = 'PENDIENTE' and exists (
         select 1 from public.landing_solicitudes s
          where upper(s.pc_codigo) = v_pc and upper(s.tipo) = 'RETIRO' and s.metadata ? 'retiro_instrumento_v1'
            and lower(trim(coalesce(s.metadata->>'usuario', s.usuario, ''))) = v_u
            and public._retiro_inst_norm_destino(coalesce(nullif(s.metadata->>'destino',''), s.metadata->>'cbu')) = v_norm
            and s.metadata->'retiro_instrumento_v1'->>'estado' = 'PENDIENTE'
            and upper(coalesce(s.estado,'')) in ('PENDIENTE','EN_REVISION','EN_PROCESO')) then
      return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'RETIRO_EN_VALIDACION');
    end if;
    if v_inst.id is null then
      insert into public.retiro_instrumentos(pc_codigo, usuario, destino, destino_norm, titular, dni_hash, dni_fin)
      values (v_pc, v_u, v_dest, v_norm, btrim(p_titular), v_hash, right(v_dni, 3))
      returning * into v_inst;
    else
      update public.retiro_instrumentos
         set destino = v_dest, titular = btrim(p_titular), dni_hash = v_hash, dni_fin = right(v_dni, 3),
             estado = 'PENDIENTE', intentos_operador = 0, validado_at = null, validado_por = null, updated_at = now()
       where id = v_inst.id returning * into v_inst;
    end if;
    v_estado := 'PENDIENTE';
  end if;

  -- Nada que parezca un documento viaja en la metadata: NODO la recibe entera.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_meta
    from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) e where e.key !~* '(dni|cuil|cuit|documento)';
  v_meta := v_meta || jsonb_build_object('retiro_instrumento_v1', jsonb_build_object(
    'estado', v_estado, 'instrumento_id', v_inst.id, 'primera_validacion', v_estado = 'PENDIENTE'));
  v_res := public.landing_portal_v16_crear_solicitud(p_public_code, p_usuario, 'RETIRO', p_monto, p_titular, p_destino,
    'Solicitud de RETIRO: $' || p_monto::text || ' · Destino: ' || p_destino || ' · Titular: ' || p_titular, v_meta);
  if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'RETIRO_SOLICITUD_NO_CONFIRMADA'; end if;
  v_id := coalesce((v_res->>'solicitud_id')::bigint, (v_res->>'id')::bigint);
  if v_id is null then raise exception 'RETIRO_SOLICITUD_NO_CONFIRMADA'; end if;
  update public.retiro_instrumentos set solicitud_id = v_id where id = v_inst.id;
  if v_estado = 'PENDIENTE' then
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento) values (v_inst.id, v_id, 'DECLARADO');
  end if;
  return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true,
    'solicitud_id', v_id, 'estado_validacion', v_estado, 'validado_at', v_inst.validado_at);
end $$;
