-- Lecturas operativas resueltas en servidor: Historial filtrado/paginado con totales completos,
-- Bandeja con cola operativa completa sin truncar + resumen, y Exportación paginada para Nexo.
-- Ejecutar después de perfil-v1.sql.

create schema if not exists acceso;
create schema if not exists operaciones;
revoke all on schema acceso,operaciones from public,anon,authenticated;

create or replace function operaciones.historial_v1(
  p_pc_codigo text,
  p_filtros jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_pc text := upper(btrim(p_pc_codigo));
  v_pcs text[];
  v_f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_tipo text;
  v_estado text;
  v_origen text;
  v_bil text;
  v_q text;
  v_periodo text;
  v_turno text;
  v_vista text;
  v_saldo text;
  v_solo_sin_chu boolean;
  v_desde timestamptz;
  v_hasta timestamptz;
  v_min numeric;
  v_max numeric;
  v_cid bigint;
  v_cat timestamptz;
  v_now_ar timestamp;
  v_totals jsonb;
  v_billeteras jsonb;
  v_rows jsonb;
  v_more boolean;
  v_next jsonb;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode='22023', message='BETA_INVALID_LIMIT';
  end if;
  if jsonb_typeof(v_f) <> 'object' then
    raise exception using errcode='22023', message='BETA_INVALID_FILTERS';
  end if;
  v_pcs := acceso.oficinas_autorizadas(v_pc);

  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object' or not (p_cursor ? 'created_at' and p_cursor ? 'id')
       or (p_cursor - 'created_at' - 'id') <> '{}'::jsonb
       or coalesce(p_cursor->>'id','') !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(p_cursor->'id') <> 'string'
       or jsonb_typeof(p_cursor->'created_at') not in ('string','null') then
      raise exception using errcode='22023', message='BETA_INVALID_CURSOR';
    end if;
    begin
      v_cid := (p_cursor->>'id')::bigint;
      v_cat := (p_cursor->>'created_at')::timestamptz;
      if v_cat is not null and not isfinite(v_cat) then raise invalid_datetime_format; end if;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='BETA_INVALID_CURSOR';
    end;
  end if;

  v_tipo := nullif(upper(btrim(coalesce(v_f->>'tipo',''))),'');
  v_estado := nullif(upper(btrim(coalesce(v_f->>'estado',''))),'');
  v_origen := nullif(upper(btrim(coalesce(v_f->>'origen',''))),'');
  v_bil := nullif(btrim(coalesce(v_f->>'billetera','')),'');
  v_q := nullif(lower(btrim(coalesce(v_f->>'usuario', v_f->>'q', ''))),'');
  v_periodo := nullif(upper(btrim(coalesce(v_f->>'periodo',''))),'');
  v_turno := nullif(upper(btrim(coalesce(v_f->>'turno',''))),'');
  v_vista := coalesce(nullif(upper(btrim(coalesce(v_f->>'vista',''))),''), 'SIN_SOPORTE');
  v_saldo := nullif(upper(btrim(coalesce(v_f->>'saldo',''))),'');
  v_solo_sin_chu := coalesce((v_f->>'solo_sin_chunior')::boolean, false);

  v_now_ar := now() at time zone 'America/Argentina/Buenos_Aires';
  if v_periodo = 'TURNO' then
    v_desde := now() - interval '12 hours';
  elsif v_periodo = 'HOY' then
    v_desde := date_trunc('day', v_now_ar) at time zone 'America/Argentina/Buenos_Aires';
  elsif v_periodo = 'AYER' then
    v_desde := (date_trunc('day', v_now_ar) - interval '1 day') at time zone 'America/Argentina/Buenos_Aires';
    v_hasta := (date_trunc('day', v_now_ar) - interval '1 millisecond') at time zone 'America/Argentina/Buenos_Aires';
  elsif v_periodo in ('7D','D7') then
    v_desde := now() - interval '7 days';
  elsif v_periodo in ('30D','D30') then
    v_desde := now() - interval '30 days';
  elsif v_periodo = 'MES' then
    v_desde := date_trunc('month', v_now_ar) at time zone 'America/Argentina/Buenos_Aires';
  end if;

  if coalesce(btrim(v_f->>'desde'),'') <> '' then
    begin
      if (v_f->>'desde') ~ '^\d{4}-\d{2}-\d{2}$' then
        v_desde := ((v_f->>'desde')::date::timestamp) at time zone 'America/Argentina/Buenos_Aires';
      else
        v_desde := (v_f->>'desde')::timestamptz;
      end if;
    exception when others then
      raise exception using errcode='22023', message='BETA_INVALID_FILTERS';
    end;
  end if;

  if coalesce(btrim(v_f->>'hasta'),'') <> '' then
    begin
      if (v_f->>'hasta') ~ '^\d{4}-\d{2}-\d{2}$' then
        v_hasta := (((v_f->>'hasta')::date + interval '1 day' - interval '1 millisecond')::timestamp) at time zone 'America/Argentina/Buenos_Aires';
      else
        v_hasta := (v_f->>'hasta')::timestamptz;
      end if;
    exception when others then
      raise exception using errcode='22023', message='BETA_INVALID_FILTERS';
    end;
  end if;

  if coalesce(btrim(v_f->>'min'),'') <> '' then
    if (v_f->>'min') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception using errcode='22023', message='BETA_INVALID_FILTERS'; end if;
    v_min := (v_f->>'min')::numeric;
  end if;
  if coalesce(btrim(v_f->>'max'),'') <> '' then
    if (v_f->>'max') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception using errcode='22023', message='BETA_INVALID_FILTERS'; end if;
    v_max := (v_f->>'max')::numeric;
  end if;

  with filtered as materialized (
    select
      h.id, h.created_at, h.usuario, h.tipo, h.monto, h.origen, h.estado, h.notas, h.pc_codigo,
      h.worker_job_id, h.billetera_id, h.billetera_nombre, h.solicitud_id, h.mp_movimiento_id,
      h.monto_declarado, h.monto_aprobado, h.validacion_tipo, h.validacion_estado, h.saldo_pre, h.saldo_post,
      h.operador, h.chunior_movimiento_id, h.reversion_de
    from public.historial_ops h
    where upper(btrim(h.pc_codigo)) = any(v_pcs)
      and (v_vista = 'TODO' or upper(btrim(coalesce(h.tipo,''))) not in ('SOPORTE','CHAT'))
      and (v_tipo is null or upper(btrim(coalesce(h.tipo,''))) = v_tipo)
      and (v_estado is null or (
        case
          when v_estado = 'OK' then operaciones.estado_confirmado_v1(h.estado)
          when v_estado = 'ERROR' then upper(btrim(coalesce(h.estado,''))) in ('ERROR','RECHAZADA','CANCELADA','CANCELADO')
          when v_estado = 'PENDIENTE' then upper(btrim(coalesce(h.estado,''))) in ('PENDIENTE','EN_REVISION','APROBADA_MANUAL','APROBADA_MANUAL_OK','')
          else upper(btrim(coalesce(h.estado,''))) = v_estado
        end
      ))
      and (v_origen is null or (
        case
          when v_origen = 'PORTAL' then upper(btrim(coalesce(h.origen,''))) in ('PORTAL','LANDING')
          else upper(btrim(coalesce(h.origen,''))) = v_origen
        end
      ))
      and (v_bil is null or btrim(coalesce(h.billetera_nombre,'')) = v_bil or h.billetera_id::text = v_bil)
      and (v_desde is null or h.created_at >= v_desde)
      and (v_hasta is null or h.created_at <= v_hasta)
      and (v_turno is null or (
        case
          when h.created_at is null then ''
          when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') between 6 and 13 then 'TM'
          when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') between 14 and 21 then 'TT'
          else 'TN'
        end
      ) = v_turno)
      and (v_min is null or abs(coalesce(h.monto,0)) >= v_min)
      and (v_max is null or abs(coalesce(h.monto,0)) <= v_max)
      and (v_saldo is null or (
        case
          when v_saldo = 'CON' then h.saldo_post is not null
          when v_saldo = 'SIN' then h.saldo_post is null
          else true
        end
      ))
      and (not v_solo_sin_chu or (operaciones.estado_confirmado_v1(h.estado) and coalesce(btrim(h.chunior_movimiento_id),'') = ''))
      and (v_q is null or (
        strpos(lower(coalesce(h.usuario,'')), v_q) > 0
        or strpos(lower(coalesce(h.operador,'')), v_q) > 0
        or strpos(lower(coalesce(h.billetera_nombre,'')), v_q) > 0
        or strpos(lower(coalesce(h.notas,'')), v_q) > 0
        or strpos(lower(coalesce(h.chunior_movimiento_id,'')), v_q) > 0
        or h.id::text = v_q
        or coalesce(h.solicitud_id::text,'') = v_q
      ))
  ),
  selected as (
    select f.* from filtered f
    where p_cursor is null
      or (v_cat is null and f.created_at is null and f.id < v_cid)
      or (v_cat is not null and (f.created_at < v_cat or f.created_at is null or (f.created_at = v_cat and f.id < v_cid)))
    order by f.created_at desc nulls last, f.id desc
    limit p_limit + 1
  ),
  page as (
    select * from selected order by created_at desc nulls last, id desc limit p_limit
  )
  select
    jsonb_build_object(
      'total_rows', (select count(*) from filtered),
      'cargas', (select count(*) from filtered where upper(coalesce(tipo,''))='CARGA' and operaciones.estado_confirmado_v1(estado)),
      'retiros', (select count(*) from filtered where upper(coalesce(tipo,''))='RETIRO' and operaciones.estado_confirmado_v1(estado)),
      'monto_cargas', coalesce((select sum(abs(monto)) from filtered where upper(coalesce(tipo,''))='CARGA' and operaciones.estado_confirmado_v1(estado)), 0),
      'monto_retiros', coalesce((select sum(abs(monto)) from filtered where upper(coalesce(tipo,''))='RETIRO' and operaciones.estado_confirmado_v1(estado)), 0),
      'neto', coalesce((select sum(abs(monto)) from filtered where upper(coalesce(tipo,''))='CARGA' and operaciones.estado_confirmado_v1(estado)), 0)
            - coalesce((select sum(abs(monto)) from filtered where upper(coalesce(tipo,''))='RETIRO' and operaciones.estado_confirmado_v1(estado)), 0),
      'errores', (select count(*) from filtered where upper(btrim(coalesce(estado,''))) in ('ERROR','RECHAZADA','CANCELADA','CANCELADO'))
    ),
    coalesce((select jsonb_agg(distinct btrim(billetera_nombre)) filter (where coalesce(btrim(billetera_nombre),'') <> '') from filtered), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'id', p.id::text,
          'worker_job_id', p.worker_job_id::text,
          'billetera_id', p.billetera_id::text,
          'solicitud_id', p.solicitud_id::text,
          'mp_movimiento_id', p.mp_movimiento_id::text,
          'reversion_de', p.reversion_de::text
        )
        order by p.created_at desc nulls last, p.id desc
      ) from page p
    ), '[]'::jsonb),
    (select count(*) > p_limit from selected),
    (select jsonb_build_object('created_at', p.created_at, 'id', p.id::text) from page p order by p.created_at asc nulls first, p.id asc limit 1)
  into v_totals, v_billeteras, v_rows, v_more, v_next;

  return jsonb_build_object(
    'ok', true,
    'contract', 'nodo.beta.v1',
    'scope', jsonb_build_object('pc_codigo', v_pc, 'pc_codigos', v_pcs),
    'totals', v_totals,
    'billeteras', v_billeteras,
    'rows', v_rows,
    'has_more', v_more,
    'next_cursor', case when v_more then v_next else null end
  );
end $$;

create or replace function operaciones.bandeja_v1(
  p_pc_codigo text,
  p_filtros jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_pc text := upper(btrim(p_pc_codigo));
  v_pcs text[];
  v_f jsonb := coalesce(p_filtros, '{}'::jsonb);
  v_estado text;
  v_tipo text;
  v_q text;
  v_cid bigint;
  v_cat timestamptz;
  v_operativas jsonb;
  v_totales jsonb;
  v_rows jsonb;
  v_more boolean;
  v_next jsonb;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode='22023', message='BETA_INVALID_LIMIT';
  end if;
  if jsonb_typeof(v_f) <> 'object' then
    raise exception using errcode='22023', message='BETA_INVALID_FILTERS';
  end if;
  v_pcs := acceso.oficinas_autorizadas(v_pc);

  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object' or not (p_cursor ? 'created_at' and p_cursor ? 'id')
       or (p_cursor - 'created_at' - 'id') <> '{}'::jsonb
       or coalesce(p_cursor->>'id','') !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(p_cursor->'id') <> 'string'
       or jsonb_typeof(p_cursor->'created_at') not in ('string','null') then
      raise exception using errcode='22023', message='BETA_INVALID_CURSOR';
    end if;
    begin
      v_cid := (p_cursor->>'id')::bigint;
      v_cat := (p_cursor->>'created_at')::timestamptz;
      if v_cat is not null and not isfinite(v_cat) then raise invalid_datetime_format; end if;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='BETA_INVALID_CURSOR';
    end;
  end if;

  v_estado := nullif(upper(btrim(coalesce(v_f->>'estado',''))),'');
  v_tipo := nullif(upper(btrim(coalesce(v_f->>'tipo',''))),'');
  v_q := nullif(lower(btrim(coalesce(v_f->>'usuario', v_f->>'q', ''))),'');

  with base as materialized (
    select
      s.id,
      s.created_at,
      s.tipo,
      s.estado,
      s.monto,
      s.pc_codigo,
      s.usuario,
      coalesce(s.metadata, '{}'::jsonb) - array['host','created_by_rpc','public_code','origen_portal','agente_por_host','comprobante_obligatorio'] as metadata,
      upper(btrim(coalesce(s.estado,''))) in ('PENDIENTE','EN_PROCESO','EN_REVISION','APROBADA_REVISION','TOMADA','TOMADO','PROCESANDO','ERROR_OPERATIVO') as es_abierta,
      (
        upper(btrim(coalesce(s.tipo,''))) = 'RETIRO'
        and coalesce( (case when coalesce(s.metadata->'retiro_parcial'->>'pagado','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (s.metadata->'retiro_parcial'->>'pagado')::numeric else 0 end), 0) > 0
        and coalesce((s.metadata->'retiro_parcial'->>'cerrado')::boolean, false) = false
        and (s.metadata->'retiro_parcial'->'cierre') is null
        and (coalesce(s.monto,0) - coalesce((case when coalesce(s.metadata->'retiro_parcial'->>'pagado','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (s.metadata->'retiro_parcial'->>'pagado')::numeric else 0 end), 0)) > 0.5
        and upper(btrim(coalesce(s.estado,''))) not in ('RECHAZADA','CANCELADA','PAGADA','COMPLETADA')
      ) as es_parcial_activo
    from public.landing_solicitudes s
    where upper(btrim(s.pc_codigo)) = any(v_pcs)
  ),
  recientes as (
    select b.* from base b
    order by b.created_at desc nulls last, b.id desc
    limit 80
  ),
  cola_operativa as (
    select * from base where es_abierta or es_parcial_activo
    union
    select * from recientes
  ),
  filtered as (
    select b.* from base b
    where (v_estado is null or upper(btrim(coalesce(b.estado,''))) = v_estado)
      and (v_tipo is null or upper(btrim(coalesce(b.tipo,''))) = v_tipo)
      and (v_q is null or strpos(lower(coalesce(b.usuario,'')), v_q) > 0 or b.id::text = v_q)
  ),
  selected as (
    select f.* from filtered f
    where p_cursor is null
      or (v_cat is null and f.created_at is null and f.id < v_cid)
      or (v_cat is not null and (f.created_at < v_cat or f.created_at is null or (f.created_at = v_cat and f.id < v_cid)))
    order by f.created_at desc nulls last, f.id desc
    limit p_limit + 1
  ),
  page as (
    select * from selected order by created_at desc nulls last, id desc limit p_limit
  )
  select
    coalesce((
      select jsonb_agg(
        (to_jsonb(c) - 'es_abierta' - 'es_parcial_activo') || jsonb_build_object('id', c.id::text)
        order by c.created_at desc nulls last, c.id desc
      ) from cola_operativa c
    ), '[]'::jsonb),
    jsonb_build_object(
      'pendientes_carga', (select count(*) from base where upper(coalesce(tipo,''))='CARGA' and upper(btrim(coalesce(estado,'')))='PENDIENTE'),
      'pendientes_retiro', (select count(*) from base where upper(coalesce(tipo,''))='RETIRO' and upper(btrim(coalesce(estado,'')))='PENDIENTE' and not es_parcial_activo),
      'monto_pendiente_carga', coalesce((select sum(abs(monto)) from base where upper(coalesce(tipo,''))='CARGA' and upper(btrim(coalesce(estado,'')))='PENDIENTE'), 0),
      'monto_pendiente_retiro', coalesce((select sum(abs(monto)) from base where upper(coalesce(tipo,''))='RETIRO' and upper(btrim(coalesce(estado,'')))='PENDIENTE' and not es_parcial_activo), 0),
      'en_proceso', (select count(*) from base where upper(coalesce(tipo,'')) in ('CARGA','RETIRO') and upper(btrim(coalesce(estado,''))) in ('EN_PROCESO','EN_REVISION','APROBADA_REVISION','TOMADA','TOMADO','PROCESANDO','ERROR_OPERATIVO') and not es_parcial_activo),
      'parciales_activos', (select count(*) from base where es_parcial_activo),
      'cambio_clave_pendientes', (select count(*) from base where upper(coalesce(tipo,''))='CAMBIO_CLAVE' and es_abierta),
      'soporte_pendientes', (select count(*) from base where upper(coalesce(tipo,''))='SOPORTE' and es_abierta)
    ),
    coalesce((
      select jsonb_agg(
        (to_jsonb(p) - 'es_abierta' - 'es_parcial_activo') || jsonb_build_object('id', p.id::text)
        order by p.created_at desc nulls last, p.id desc
      ) from page p
    ), '[]'::jsonb),
    (select count(*) > p_limit from selected),
    (select jsonb_build_object('created_at', p.created_at, 'id', p.id::text) from page p order by p.created_at asc nulls first, p.id asc limit 1)
  into v_operativas, v_totales, v_rows, v_more, v_next;

  return jsonb_build_object(
    'ok', true,
    'contract', 'nodo.beta.v1',
    'scope', jsonb_build_object('pc_codigo', v_pc, 'pc_codigos', v_pcs),
    'operativas', v_operativas,
    'totales', v_totales,
    'rows', v_rows,
    'has_more', v_more,
    'next_cursor', case when v_more then v_next else null end
  );
end $$;

create or replace function operaciones.nexo_export_v1(
  p_pc_codigo text,
  p_limit integer default 500,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_pc text := upper(btrim(p_pc_codigo));
  v_pcs text[];
  v_cid bigint;
  v_cat timestamptz;
  v_total bigint;
  v_rows jsonb;
  v_more boolean;
  v_next jsonb;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode='22023', message='BETA_INVALID_LIMIT';
  end if;
  v_pcs := acceso.oficinas_autorizadas(v_pc);

  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object' or not (p_cursor ? 'created_at' and p_cursor ? 'id')
       or (p_cursor - 'created_at' - 'id') <> '{}'::jsonb
       or coalesce(p_cursor->>'id','') !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(p_cursor->'id') <> 'string'
       or jsonb_typeof(p_cursor->'created_at') not in ('string','null') then
      raise exception using errcode='22023', message='BETA_INVALID_CURSOR';
    end if;
    begin
      v_cid := (p_cursor->>'id')::bigint;
      v_cat := (p_cursor->>'created_at')::timestamptz;
      if v_cat is not null and not isfinite(v_cat) then raise invalid_datetime_format; end if;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023', message='BETA_INVALID_CURSOR';
    end;
  end if;

  with valid_ops as materialized (
    select
      h.id, h.usuario, h.tipo, h.monto, h.billetera_nombre, h.origen, h.estado,
      h.notas, h.created_at, h.operador, h.chunior_movimiento_id, h.pc_codigo
    from public.historial_ops h
    where upper(btrim(h.pc_codigo)) = any(v_pcs)
      and upper(btrim(coalesce(h.tipo,''))) in ('CARGA','RETIRO')
      and upper(btrim(coalesce(h.origen,''))) <> 'PROMO_BONO'
      and operaciones.estado_confirmado_v1(h.estado)
      and h.created_at is not null
      and abs(coalesce(h.monto,0)) > 0
  ),
  selected as (
    select v.* from valid_ops v
    where p_cursor is null
      or (v_cat is not null and (v.created_at < v_cat or (v.created_at = v_cat and v.id < v_cid)))
    order by v.created_at desc, v.id desc
    limit p_limit + 1
  ),
  page as (
    select * from selected order by created_at desc, id desc limit p_limit
  )
  select
    (select count(*) from valid_ops),
    coalesce((
      select jsonb_agg(
        to_jsonb(p) || jsonb_build_object('id', p.id::text)
        order by p.created_at desc, p.id desc
      ) from page p
    ), '[]'::jsonb),
    (select count(*) > p_limit from selected),
    (select jsonb_build_object('created_at', p.created_at, 'id', p.id::text) from page p order by p.created_at asc, p.id asc limit 1)
  into v_total, v_rows, v_more, v_next;

  return jsonb_build_object(
    'ok', true,
    'contract', 'nodo.beta.v1',
    'scope', jsonb_build_object('pc_codigo', v_pc, 'pc_codigos', v_pcs),
    'total', v_total,
    'rows', v_rows,
    'has_more', v_more,
    'complete', not v_more,
    'next_cursor', case when v_more then v_next else null end
  );
end $$;

create or replace function public.nodo_beta_historial_v1(
  p_token text,
  p_pc_codigo text,
  p_filtros jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform acceso.autorizar(p_token, p_pc_codigo);
  return operaciones.historial_v1(p_pc_codigo, p_filtros, p_limit, p_cursor);
end $$;

create or replace function public.nodo_beta_bandeja_v1(
  p_token text,
  p_pc_codigo text,
  p_filtros jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform acceso.autorizar(p_token, p_pc_codigo);
  return operaciones.bandeja_v1(p_pc_codigo, p_filtros, p_limit, p_cursor);
end $$;

create or replace function public.nodo_beta_nexo_export_v1(
  p_token text,
  p_pc_codigo text,
  p_limit integer default 500,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform acceso.autorizar(p_token, p_pc_codigo);
  return operaciones.nexo_export_v1(p_pc_codigo, p_limit, p_cursor);
end $$;

revoke all on function
  operaciones.historial_v1(text,jsonb,integer,jsonb),
  operaciones.bandeja_v1(text,jsonb,integer,jsonb),
  operaciones.nexo_export_v1(text,integer,jsonb),
  public.nodo_beta_historial_v1(text,text,jsonb,integer,jsonb),
  public.nodo_beta_bandeja_v1(text,text,jsonb,integer,jsonb),
  public.nodo_beta_nexo_export_v1(text,text,integer,jsonb)
from public,anon,authenticated;

grant execute on function
  public.nodo_beta_historial_v1(text,text,jsonb,integer,jsonb),
  public.nodo_beta_bandeja_v1(text,text,jsonb,integer,jsonb),
  public.nodo_beta_nexo_export_v1(text,text,integer,jsonb)
to anon,authenticated;
