-- Cuentas de cobro validadas por DNI, una vez por cuenta (6/11).
--
-- El jugador declara el DNI del titular de la cuenta donde cobra. El operador, en la pantalla de
-- transferencia de Mercado Pago, ve el CUIT/CUIL del titular real y lo escribe en NODO SIN ver lo
-- que declaró el jugador. Si coincide, la cuenta queda validada y los próximos retiros a esa cuenta
-- salen directo. Si no coincide, no se paga.
--
-- Decisiones de Juan:
--   · Todas las cuentas pasan una vez, también las que ya cobraron antes del lanzamiento.
--   · La operación manual (WhatsApp) queda afuera: no pide cuenta.
--   · Si se rechaza, el DNI rechazado no se puede volver a declarar para esa cuenta.
--
-- El DNI declarado NO va en la metadata de la solicitud: NODO recibe esa metadata entera y el
-- control dejaría de ser a ciegas. Vive en esta tabla, cerrada; sólo se llega por estas funciones.
--
-- Al operador se le dan DOS intentos antes de rechazar: un número mal tipeado no puede dejar a un
-- jugador con su DNI marcado como rechazado.
--
-- Vuelta atrás: retiro-instrumentos-vuelta-atras.sql (borra las tablas y lo que tengan).

create table if not exists public.retiro_instrumentos (
  id                bigserial primary key,
  pc_codigo         text not null,
  usuario           text not null,
  destino           text not null,
  destino_norm      text not null,
  titular           text,
  dni_declarado     text,
  dni_rechazados    text[] not null default '{}',
  estado            text not null default 'PENDIENTE' check (estado in ('PENDIENTE','VALIDADO','RECHAZADO')),
  intentos_operador integer not null default 0,
  solicitud_id      bigint,
  validado_por      text,
  validado_at       timestamptz,
  rechazado_por     text,
  rechazado_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (pc_codigo, usuario, destino_norm)
);

-- Qué pasó y quién lo hizo. Sin números de DNI.
create table if not exists public.retiro_instrumento_eventos (
  id             bigserial primary key,
  instrumento_id bigint not null references public.retiro_instrumentos(id) on delete cascade,
  solicitud_id   bigint,
  evento         text not null check (evento in ('DECLARADO','VALIDADO','NO_COINCIDE','RECHAZADO')),
  operador       text,
  created_at     timestamptz not null default now()
);
create index if not exists retiro_instrumento_eventos_inst on public.retiro_instrumento_eventos(instrumento_id);

alter table public.retiro_instrumentos enable row level security;
alter table public.retiro_instrumento_eventos enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.retiro_instrumentos, public.retiro_instrumento_eventos from anon, authenticated, public';
  end if;
end $$;

-- Igual que en panel_retiro_alertas: sin espacios, puntos ni guiones, en minúsculas.
create or replace function public._retiro_inst_norm_destino(p text) returns text
language sql immutable set search_path to 'public' as $$
  select lower(regexp_replace(coalesce(p,''), '[\s.\-]', '', 'g'))
$$;

-- DNI sin ceros adelante. Con 11 dígitos es un CUIT/CUIL (lo que muestra Mercado Pago): el DNI son
-- los 8 del medio. Los DNI viejos tienen 7 dígitos (o menos).
create or replace function public._retiro_inst_norm_dni(p text) returns text
language sql immutable set search_path to 'public' as $$
  select case
    when length(d) = 11 then nullif(ltrim(substr(d, 3, 8), '0'), '')
    when length(d) between 6 and 8 then nullif(ltrim(d, '0'), '')
    else null end
  from (select regexp_replace(coalesce(p,''), '\D', '', 'g') as d) x
$$;

-- La oficina del Portal, igual que landing_portal_v16_crear_solicitud.
create or replace function public._retiro_inst_pc(p_public_code text) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare v_pc text; v_code text := nullif(trim(coalesce(p_public_code,'')), '');
begin
  if v_code is null then return null; end if;
  select r.pc_codigo into v_pc from public.landing_rutas_publicas r
   where lower(coalesce(r.public_code,'')) = lower(v_code) and coalesce(r.activo, true) is true limit 1;
  if coalesce(trim(coalesce(v_pc,'')), '') = '' then v_pc := public.landing_portal_v16_pc_from_code(v_code); end if;
  return nullif(upper(trim(coalesce(v_pc,''))), '');
end $$;

-- La cuenta de la solicitud: oficina, usuario y destino tal como los mandó el Portal.
create or replace function public._retiro_inst_de_solicitud(p_solicitud_id bigint,
  out pc_codigo text, out usuario text, out destino_norm text)
language sql stable security definer set search_path to 'public' as $$
  select upper(trim(s.pc_codigo)),
         lower(trim(coalesce(nullif(trim(s.metadata->>'usuario'), ''), s.usuario, ''))),
         public._retiro_inst_norm_destino(coalesce(nullif(trim(s.metadata->>'destino'), ''), s.metadata->>'cbu'))
  from public.landing_solicitudes s where s.id = p_solicitud_id
$$;

-- ── Portal ───────────────────────────────────────────────────────────────────────────────────

-- El jugador declara (o corrige) el DNI del titular de la cuenta antes de pedir el retiro.
-- Mismo control de vínculo que crear la solicitud.
create or replace function public.landing_retiro_instrumento_declarar(
  p_public_code text, p_usuario text, p_telefono text, p_destino text, p_titular text, p_dni text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_pc text; v_u text := lower(trim(coalesce(p_usuario,''))); v_dest text := trim(coalesce(p_destino,''));
  v_norm text; v_dni text; v_vinc jsonb; v_row public.retiro_instrumentos;
begin
  if v_u = '' then raise exception 'USUARIO_REQUERIDO'; end if;
  v_pc := public._retiro_inst_pc(p_public_code);
  if v_pc is null then raise exception 'AGENTE_NO_RESUELTO'; end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  if upper(coalesce(v_vinc->>'verdict','')) not in ('ACCESO','NUEVO','PENDIENTE') then
    raise exception 'VINCULO_NO_VALIDO';
  end if;
  v_norm := public._retiro_inst_norm_destino(v_dest);
  if length(v_norm) < 6 then raise exception 'DESTINO_INVALIDO'; end if;
  v_dni := public._retiro_inst_norm_dni(p_dni);
  if v_dni is null then raise exception 'DNI_INVALIDO'; end if;

  select * into v_row from public.retiro_instrumentos
   where pc_codigo = v_pc and usuario = v_u and destino_norm = v_norm for update;
  if found then
    if v_row.estado = 'VALIDADO' then return jsonb_build_object('ok', true, 'estado', 'VALIDADO'); end if;
    if v_dni = any(v_row.dni_rechazados) then raise exception 'DNI_YA_RECHAZADO'; end if;
    update public.retiro_instrumentos
       set destino = v_dest, titular = nullif(trim(coalesce(p_titular,'')), ''), dni_declarado = v_dni,
           estado = 'PENDIENTE', intentos_operador = 0, updated_at = now()
     where id = v_row.id;
  else
    insert into public.retiro_instrumentos(pc_codigo, usuario, destino, destino_norm, titular, dni_declarado)
    values (v_pc, v_u, v_dest, v_norm, nullif(trim(coalesce(p_titular,'')), ''), v_dni)
    returning * into v_row;
  end if;
  insert into public.retiro_instrumento_eventos(instrumento_id, evento) values (v_row.id, 'DECLARADO');
  return jsonb_build_object('ok', true, 'estado', 'PENDIENTE');
end $$;

-- Las cuentas del jugador en esta oficina, para que el Portal sepa si pedir DNI o mostrar la
-- cuenta ya confirmada. Sólo con vínculo confirmado (ACCESO); del DNI, los últimos 3 números.
create or replace function public.landing_retiro_instrumentos(p_public_code text, p_usuario text, p_telefono text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_pc text; v_u text := lower(trim(coalesce(p_usuario,''))); v_vinc jsonb;
begin
  v_pc := public._retiro_inst_pc(p_public_code);
  if v_pc is null or v_u = '' then return jsonb_build_object('ok', false, 'motivo', 'SIN_DATOS'); end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  if upper(coalesce(v_vinc->>'verdict','')) <> 'ACCESO' then
    return jsonb_build_object('ok', true, 'instrumentos', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'instrumentos', coalesce((
    select jsonb_agg(jsonb_build_object(
             'destino', i.destino, 'titular', i.titular, 'estado', i.estado,
             'dni_fin', case when i.dni_declarado is not null then right(i.dni_declarado, 3) end,
             'validado_at', i.validado_at, 'rechazado_at', i.rechazado_at, 'actualizado_at', i.updated_at)
           order by i.updated_at desc)
    from public.retiro_instrumentos i where i.pc_codigo = v_pc and i.usuario = v_u), '[]'::jsonb));
end $$;

-- ── NODO ─────────────────────────────────────────────────────────────────────────────────────

-- Estado de la cuenta de una solicitud de retiro. Nunca devuelve el DNI declarado.
-- SIN_DECLARAR = el Portal todavía no pidió DNI para esta cuenta (Portal anterior o solicitud
-- armada por chat): se paga como siempre y la cuenta queda para validar la próxima vez.
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
    'estado', case when v_row.id is null or v_row.dni_declarado is null then 'SIN_DECLARAR' else v_row.estado end,
    'destino', v_row.destino, 'titular', v_row.titular,
    'validado_at', v_row.validado_at, 'validado_por', v_row.validado_por,
    'rechazado_at', v_row.rechazado_at,
    'intentos_restantes', greatest(0, 2 - coalesce(v_row.intentos_operador, 0)),
    'otras_validadas', coalesce((
      select jsonb_agg(jsonb_build_object('destino', o.destino, 'titular', o.titular,
               'dni_fin', right(o.dni_declarado, 3), 'validado_at', o.validado_at) order by o.validado_at desc)
      from public.retiro_instrumentos o
      where o.pc_codigo = k.pc_codigo and o.usuario = k.usuario and o.estado = 'VALIDADO'
        and o.id is distinct from v_row.id), '[]'::jsonb));
end $$;

-- El operador escribe el DNI que ve en Mercado Pago. Se compara con lo declarado sin mostrarlo.
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
  if v_row.id is null or v_row.dni_declarado is null then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  if v_row.estado = 'VALIDADO' then
    return jsonb_build_object('ok', true, 'estado', 'VALIDADO', 'validado_at', v_row.validado_at, 'ya_validado', true);
  end if;
  if v_row.estado = 'RECHAZADO' then return jsonb_build_object('ok', false, 'motivo', 'RECHAZADO'); end if;
  v_dni := public._retiro_inst_norm_dni(p_dni_banco);
  if v_dni is null then return jsonb_build_object('ok', false, 'motivo', 'DNI_INVALIDO'); end if;

  if v_dni = v_row.dni_declarado then
    update public.retiro_instrumentos
       set estado = 'VALIDADO', validado_por = v_op, validado_at = now(), solicitud_id = p_solicitud_id,
           intentos_operador = 0, updated_at = now()
     where id = v_row.id returning * into v_row;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'VALIDADO', v_op);
    return jsonb_build_object('ok', true, 'estado', 'VALIDADO', 'validado_at', v_row.validado_at);
  end if;

  if v_row.intentos_operador + 1 < 2 then
    update public.retiro_instrumentos set intentos_operador = intentos_operador + 1, updated_at = now() where id = v_row.id;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'NO_COINCIDE', v_op);
    return jsonb_build_object('ok', false, 'motivo', 'NO_COINCIDE', 'intentos_restantes', 1);
  end if;

  update public.retiro_instrumentos
     set estado = 'RECHAZADO', dni_rechazados = array_append(dni_rechazados, dni_declarado),
         rechazado_por = v_op, rechazado_at = now(), intentos_operador = 0, solicitud_id = p_solicitud_id, updated_at = now()
   where id = v_row.id;
  insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
  values (v_row.id, p_solicitud_id, 'RECHAZADO', v_op);
  return jsonb_build_object('ok', false, 'motivo', 'RECHAZADO');
end $$;

-- Rechazo directo: en Mercado Pago el titular es claramente otra persona.
create or replace function public.panel_retiro_instrumento_rechazar(p_secret text, p_solicitud_id bigint, p_operador text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare k record; v_row public.retiro_instrumentos; v_op text := nullif(trim(coalesce(p_operador,'')), '');
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  select * into k from public._retiro_inst_de_solicitud(p_solicitud_id);
  if k.pc_codigo is null then return jsonb_build_object('ok', false, 'motivo', 'SOLICITUD_NO_EXISTE'); end if;
  select * into v_row from public.retiro_instrumentos
   where pc_codigo = k.pc_codigo and usuario = k.usuario and destino_norm = k.destino_norm for update;
  if v_row.id is null or v_row.dni_declarado is null then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  if v_row.estado = 'VALIDADO' then return jsonb_build_object('ok', false, 'motivo', 'YA_VALIDADO'); end if;
  if v_row.estado <> 'RECHAZADO' then
    update public.retiro_instrumentos
       set estado = 'RECHAZADO', dni_rechazados = array_append(dni_rechazados, dni_declarado),
           rechazado_por = v_op, rechazado_at = now(), intentos_operador = 0, solicitud_id = p_solicitud_id, updated_at = now()
     where id = v_row.id;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'RECHAZADO', v_op);
  end if;
  return jsonb_build_object('ok', true, 'estado', 'RECHAZADO');
end $$;
