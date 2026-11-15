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
-- Lo que el número deja estimar (8/11): sólo el aviso y el año aproximado, nunca el DNI.
alter table public.retiro_instrumentos add column if not exists dni_alerta text;
alter table public.retiro_instrumentos add column if not exists dni_anio_estimado int;
alter table public.retiro_instrumentos add column if not exists dni_edad_declarada int;
alter table public.retiro_instrumentos add column if not exists dni_edad_previa int;
-- Cuenta nueva a nombre del titular que ya validó (9/11): no se pide DNI; el operador confirma el titular.
alter table public.retiro_instrumentos add column if not exists por_titular boolean not null default false;

-- ¿Es el mismo titular? Juan, 9/11: "si utiliza otro alias u CBU pero está a su nombre, invertido o con un
-- nombre más o menos, no debería pedir nuevamente la validación". Mismas palabras sin tildes ni orden, una
-- lista contenida en la otra, con al menos 2 palabras. "Ismael Flores" = "Flores Ismael" = "Rodrigo Ismael
-- Flores"; "Ismael Flores" ≠ "Rodrigo Flores" (cambia el nombre de pila: puede ser otra persona).
create or replace function public._retiro_inst_palabras(p text) returns text[]
language sql immutable set search_path to 'public' as $$
  select coalesce(array_agg(distinct w order by w), '{}')
    from unnest(regexp_split_to_array(
           regexp_replace(translate(lower(coalesce(p, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'), '[^a-z]+', ' ', 'g'),
           '\s+')) w
   where length(w) >= 2
$$;
create or replace function public._retiro_inst_mismo_titular(a text, b text) returns boolean
language sql immutable set search_path to 'public' as $$
  select cardinality(x.pa) >= 2 and cardinality(x.pb) >= 2 and (x.pa <@ x.pb or x.pb <@ x.pa)
    from (select public._retiro_inst_palabras(a) as pa, public._retiro_inst_palabras(b) as pb) x
$$;

-- Qué dice el número del DNI (8/11). Juan: detectar DNI falso y menores ("sumamente importante"), pero
-- "quiero quedar seguro de que no se puede dar un falso positivo que genere problemas entre usuarios y
-- operadores, tipo alguna traba mal hecha".
--
-- REGLA: el número NUNCA traba a un jugador. Sólo el formato (7 u 8 números) es obligatorio; todo lo
-- demás es un AVISO para el operador. El control de verdad contra un DNI inventado ya existe: el
-- operador lo compara con el CUIT del titular en Mercado Pago, y un DNI falso no coincide.
-- Por qué no se rechaza nada por el número:
--   · Todos iguales o en escalera (33.333.333, 23.456.789) son DNI REALES: la numeración es correlativa.
--   · 60-69,99 M es el CUIL provisorio de extranjeros sin DNI: en Mercado Pago les coincide.
--   · 70 M en adelante se da a bebés desde 2023 (casi seguro mal escrito o inventado, pero no imposible).
--
-- Edad: la numeración del Renaper es correlativa, así que el número da una idea APROXIMADA del año de
-- nacimiento (se asigna al registrar, no al nacer). Tabla (Infonegocios, 16/10/2025): 40-45 M ≈ 2000-2008,
-- 45-50 M ≈ 2008-2013, 50-55 M ≈ 2013-2017, 55-60 M ≈ 2017-2023; 90 M o más, extranjeros (sin edad).
-- Se toma un rango AMPLIO (estimado ± 3 años) y, si incluye menores, se le pregunta la edad al jugador.
-- Nadie es más joven de lo que marca su número, pero sí puede ser más grande (sacó el DNI de grande):
-- por eso una edad que no coincide va al operador con esa explicación, no se rechaza.
create or replace function public._retiro_inst_dni_control(p_dni text) returns jsonb
language plpgsql stable set search_path to 'public' as $$
declare d text := public._retiro_inst_norm_dni(p_dni); n bigint; anio int; edad int; i int; margen int := 3;
  alertas text[] := '{}';
  m numeric[] := array[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  y numeric[] := array[1900, 1940, 1950, 1960, 1970, 1980, 1990, 1995, 2000, 2008, 2013, 2017, 2023];
begin
  if d is null or length(d) < 7 then return jsonb_build_object('valido', false, 'motivo', 'FORMATO'); end if;
  n := d::bigint;
  if d ~ '^(\d)\1+$' then alertas := alertas || 'NUMERO_REPETIDO'::text;
  elsif position(d in '0123456789') > 0 or position(d in '9876543210') > 0 then alertas := alertas || 'NUMERO_ESCALERA'::text;
  end if;
  if n between 60000000 and 69999999 then alertas := alertas || 'NUMERO_RESERVADO'::text;
  elsif n between 70000000 and 89999999 then alertas := alertas || 'NUMERO_BEBE'::text;
  elsif n >= 90000000 then alertas := alertas || 'EXTRANJERO'::text;
  end if;
  if n >= 60000000 then return jsonb_build_object('valido', true, 'alertas', to_jsonb(alertas), 'preguntar_edad', false); end if;
  for i in 1..12 loop
    if n < m[i + 1] * 1000000 then
      anio := round(y[i] + (n - m[i] * 1000000) / ((m[i + 1] - m[i]) * 1000000) * (y[i + 1] - y[i]));
      exit;
    end if;
  end loop;
  edad := extract(year from now())::int - anio;
  return jsonb_build_object('valido', true, 'alertas', to_jsonb(alertas), 'anio_estimado', anio, 'edad_estimada', edad,
    'edad_min', greatest(edad - margen, 0), 'edad_max', edad + margen, 'preguntar_edad', edad - margen < 18);
end $$;

-- CUIT/CUIL con dígito verificador correcto (lo que tipea el operador desde Mercado Pago). Un dígito
-- mal tipeado no tiene que gastarle un intento al jugador.
create or replace function public._retiro_inst_cuit_ok(p text) returns boolean
language sql immutable set search_path to 'public' as $$
  select case when length(d) <> 11 then true else (
    with s as (select sum(substr(d, i, 1)::int * (array[5,4,3,2,7,6,5,4,3,2])[i]) as t from generate_series(1, 10) i)
    select substr(d, 11, 1)::int = case 11 - (t % 11) when 11 then 0 when 10 then 9 else 11 - (t % 11) end from s) end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

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
-- VOLATILE a propósito: landing_resolver_ruta_por_host escribe. El servidor (PostgREST) corre las
-- funciones STABLE en una transacción de sólo lectura y ahí revienta con 405 (8/11).
create or replace function public._retiro_inst_pc2(p_public_code text, p_host text) returns text
language plpgsql volatile security definer set search_path to 'public' as $$
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
    'alertas', to_jsonb(array_remove(string_to_array(coalesce(v_row.dni_alerta, ''), ','), '')),
    'alerta_edad', v_row.dni_alerta, 'anio_estimado', v_row.dni_anio_estimado,
    'edad_declarada', v_row.dni_edad_declarada, 'edad_previa', v_row.dni_edad_previa,
    'edad_estimada', case when v_row.dni_anio_estimado is null then null else extract(year from now())::int - v_row.dni_anio_estimado end,
    'edad_min', case when v_row.dni_anio_estimado is null then null else greatest(extract(year from now())::int - v_row.dni_anio_estimado - 3, 0) end,
    'edad_max', case when v_row.dni_anio_estimado is null then null else extract(year from now())::int - v_row.dni_anio_estimado + 3 end,
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
  if not public._retiro_inst_cuit_ok(p_dni_banco) then return jsonb_build_object('ok', false, 'motivo', 'CUIT_INVALIDO'); end if;
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

-- VOLATILE a propósito, aunque sólo lea: llama a landing_portal_resolver_vinculo, que escribe. Como
-- STABLE, el servidor la corría en sólo lectura y el Portal recibía 405 apenas se prendía una oficina
-- ("No pudimos comprobar si la cuenta está habilitada", Juan, 8/11).
create or replace function public.landing_portal_retiro_contexto_v1(
  p_public_code text, p_usuario text, p_telefono text, p_host text default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
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
  -- La última solicitud con DNI sale de la tabla de cuentas (chica), que guarda el número de la última
  -- solicitud de cada cuenta, y se va directo a esa por su número. Antes se buscaba en TODAS las
  -- solicitudes por la metadata: 457.000 filas, 2,9 s, y el servidor la cortaba por tiempo (Juan, 8/11:
  -- "No pudimos comprobar la verificación de retiro").
  select s.id, s.estado, s.monto, s.updated_at, s.created_at,
         s.metadata->'retiro_instrumento_v1'->>'estado' as validacion, coalesce(s.metadata->>'motivo_rechazo','') as codigo
    into v_last
    from public.retiro_instrumentos i
    join public.landing_solicitudes s on s.id = i.solicitud_id
   where i.pc_codigo = v_pc and i.usuario = v_u
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
  v_inst public.retiro_instrumentos; v_estado text; v_dni text; v_hash text; v_meta jsonb; v_res jsonb; v_id bigint; v_ctl jsonb;
  v_alerta text; v_edad int; v_edad_previa int; v_alertas text[];
begin
  v_pc := public._retiro_inst_pc2(p_public_code, p_host);
  if v_pc is null then raise exception 'AGENTE_NO_RESUELTO'; end if;
  select coalesce(o.habilitado, false) into v_on from public.retiro_instrumentos_oficinas o where o.pc_codigo = v_pc;
  if not coalesce(v_on, false) then return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', false); end if;
  -- Datos mal: un motivo claro para el Portal, no una excepción cruda (salía "No pudimos confirmar con el
  -- servidor" sin decir qué). El alias se mide COMO LO ESCRIBIÓ, igual que el Portal y el retiro de siempre:
  -- ".pobre" son 6 y pasaba en el Portal, pero sin el punto quedaban 5 y el servidor lo rechazaba (Juan, 8/11).
  if v_u = '' or p_monto is null or p_monto <= 0 or v_tit = '' then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DATOS_INVALIDOS');
  end if;
  v_norm := public._retiro_inst_norm_destino(v_dest);
  if length(v_dest) < 6 or v_norm = '' then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DESTINO_INVALIDO');
  end if;
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
    -- Sólo el formato traba (ver _retiro_inst_dni_control): lo demás son avisos para el operador.
    v_ctl := public._retiro_inst_dni_control(v_dni);
    if not coalesce((v_ctl->>'valido')::boolean, false) then
      return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DNI_REQUERIDO');
    end if;
    select coalesce(array_agg(x), '{}') into v_alertas from jsonb_array_elements_text(coalesce(v_ctl->'alertas', '[]'::jsonb)) x;
    -- Edad: si el rango del DNI incluye menores, se le pregunta (viaja en la metadata como edad_declarada).
    -- La única traba dura es decir que tiene menos de 18, y no es para siempre: si se equivocó al tipear,
    -- corrige y vuelve a mandar; el operador ve lo que dijo antes (EDAD_CAMBIO). Un número imposible
    -- (menos de 10 o más de 110) se toma como error de tipeo y se vuelve a pedir, sin anotar nada.
    if coalesce((v_ctl->>'preguntar_edad')::boolean, false) then
      v_edad := nullif(regexp_replace(coalesce(p_metadata->>'edad_declarada', ''), '\D', '', 'g'), '')::int;
      if v_edad is null then
        return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'EDAD_REQUERIDA');
      end if;
      if v_edad < 10 or v_edad > 110 then
        return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'EDAD_INVALIDA');
      end if;
      if v_edad < 18 then
        insert into public.usuarios_portal_eventos(pc_codigo, usuario, evento, nota, origen)
        values (v_pc, v_u, 'MENOR_DECLARADO', 'Declaró ' || v_edad || ' años al pedir un retiro', 'PORTAL');
        return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'MENOR_DE_EDAD');
      end if;
      v_alertas := v_alertas || case when v_edad > (v_ctl->>'edad_max')::int then 'EDAD_NO_COINCIDE' else 'EDAD_COINCIDE' end;
      select nullif(regexp_replace(e.nota, '\D', '', 'g'), '')::int into v_edad_previa
        from public.usuarios_portal_eventos e
       where upper(e.pc_codigo) = v_pc and lower(e.usuario) = v_u and e.evento = 'MENOR_DECLARADO'
       order by e.created_at desc limit 1;
      if v_edad_previa is not null then v_alertas := v_alertas || 'EDAD_CAMBIO'::text; end if;
    end if;
    -- Un DNI que el operador ya rechazó para este jugador NO lo traba para siempre (un operador que tipeó
    -- mal dos veces lo dejaba sin poder usar su propio DNI): pasa, y el operador lo ve.
    v_hash := public._retiro_inst_hash(v_dni);
    if exists (select 1 from public.retiro_instrumentos r where r.pc_codigo = v_pc and r.usuario = v_u and v_hash = any(r.dni_rechazados)) then
      v_alertas := v_alertas || 'YA_RECHAZADO'::text;
    end if;
    v_alerta := nullif(array_to_string(v_alertas, ','), '');
    -- ¿La última solicitud de ESTA cuenta sigue esperando la validación? Se mira esa sola, por su número
    -- (antes recorría todas las solicitudes: lento y se cortaba por tiempo).
    if v_inst.id is not null and v_inst.estado = 'PENDIENTE' and exists (
         select 1 from public.landing_solicitudes s
          where s.id = v_inst.solicitud_id
            and s.metadata->'retiro_instrumento_v1'->>'estado' = 'PENDIENTE'
            and upper(coalesce(s.estado,'')) in ('PENDIENTE','EN_REVISION','EN_PROCESO')) then
      return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'RETIRO_EN_VALIDACION');
    end if;
    if v_inst.id is null then
      insert into public.retiro_instrumentos(pc_codigo, usuario, destino, destino_norm, titular, dni_hash, dni_fin, dni_alerta, dni_anio_estimado, dni_edad_declarada, dni_edad_previa)
      values (v_pc, v_u, v_dest, v_norm, btrim(p_titular), v_hash, right(v_dni, 3), v_alerta, (v_ctl->>'anio_estimado')::int, v_edad, v_edad_previa)
      returning * into v_inst;
    else
      update public.retiro_instrumentos
         set destino = v_dest, titular = btrim(p_titular), dni_hash = v_hash, dni_fin = right(v_dni, 3),
             dni_alerta = v_alerta, dni_anio_estimado = (v_ctl->>'anio_estimado')::int, dni_edad_declarada = v_edad, dni_edad_previa = v_edad_previa,
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
