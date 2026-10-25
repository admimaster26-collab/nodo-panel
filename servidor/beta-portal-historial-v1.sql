-- Beta opt-in por nombre: no cambia landing_historial_usuario ni tablas/índices.
-- Fuente contrastada en vivo 2026-10-21: legacy definition_md5 334b33a1370e94b2f9a4ebcd05dbe57b.
-- Conserva identidad, alcance, 7 días, 50 registros y los 15 campos legacy.
-- Rechazo previo se resuelve sobre ese mismo conjunto de 50, como el Portal anterior.
-- Cada rama selecciona sus 50 filas antes de convertir metadata; unión final estable de 50.
-- Reversión: retirar sólo esta función y volver al Portal anterior. No hay datos migrados.
begin;
-- 25/10 · Medido en producción: esta función tardaba 57,79 ms contra 2,49 ms de la vieja, y el
-- Portal la llama PRIMERO. No era la consulta — eran 1,4 ms. Los otros 56,37 ms se los llevaba
-- enteros el chequeo de zona horaria: `pg_timezone_names` enumera las 1.196 zonas del sistema
-- leyendo los archivos de la base horaria, en cada llamada.
--
-- Con este reemplazo quedó en 1,41 ms: más rápida que la vieja, que es como tiene que ser para
-- que las oficinas al día anden mejor que las desfasadas.
-- Verificado: 30 usuarios reales, 0 diferencias contra landing_historial_usuario.
create or replace function public._zona_valida(p_zona text) returns boolean
language plpgsql immutable security definer set search_path = '' as $zona$
declare v timestamp;
begin
  v := now() at time zone p_zona;
  return true;
exception when others then
  return false;
end $zona$;

create or replace function public.landing_historial_usuario_beta_v1(
  p_usuario text,
  p_telefono text,
  p_public_code text,
  p_zona_horaria text default 'America/Argentina/Buenos_Aires'
) returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $beta_historial$
declare
  v_local timestamp;
  v_turno_local timestamp;
  v_turno_desde timestamptz;
  v_turno_hasta timestamptz;
  v_out jsonb;
begin
  if nullif(btrim(coalesce(p_usuario,'')),'') is null
     or nullif(regexp_replace(coalesce(p_telefono,''),'\D','','g'),'') is null then
    return jsonb_build_object('ok', false, 'code', 'IDENTIDAD_REQUERIDA', 'contract', 'portal.historial.v1');
  end if;
  if not public._zona_valida(p_zona_horaria) then
    return jsonb_build_object('ok', false, 'code', 'ZONA_HORARIA_INVALIDA', 'contract', 'portal.historial.v1');
  end if;
  -- Mismos bloques locales de 8 h (00-08 / 08-16 / 16-24), reloj del servidor.
  v_local := statement_timestamp() at time zone p_zona_horaria;
  v_turno_local := date_trunc('day', v_local) + floor(extract(hour from v_local) / 8) * interval '8 hours';
  v_turno_desde := v_turno_local at time zone p_zona_horaria;
  v_turno_hasta := (v_turno_local + interval '8 hours') at time zone p_zona_horaria;
  with pc as (
    select r.pc_codigo from public.landing_rutas_publicas r
    where coalesce(p_public_code,'') <> '' and r.public_code = p_public_code
    limit 1
  ), autorizado as (
    select v.usuario
    from public.usuarios_portal_vinculos v
    where lower(trim(v.usuario)) = lower(trim(coalesce(p_usuario,'')))
      and right(regexp_replace(coalesce(v.telefono_canon, v.telefono_raw, ''),'\D','','g'), 10)
          = right(regexp_replace(coalesce(p_telefono,''),'\D','','g'), 10)
      and ( not exists (select 1 from pc)
            or upper(coalesce(v.pc_codigo,'')) = upper((select pc_codigo from pc)) )
    limit 1
  ), portal_filtrado as materialized (
    select s.*
    from public.landing_solicitudes s
    where s.created_at >= now() - interval '7 days'
      and upper(coalesce(s.tipo, s.metadata->>'tipo','')) in ('CARGA','RETIRO')
      and lower(trim(s.metadata->>'usuario')) = lower(trim(coalesce(p_usuario,'')))
      and regexp_replace(coalesce(s.metadata->>'telefono',''),'\D','','g')
          = regexp_replace(coalesce(p_telefono,''),'\D','','g')
      and (coalesce(p_public_code,'') = '' or coalesce(s.metadata->>'public_code','') = coalesce(p_public_code,''))

    order by s.created_at desc, s.id desc
    limit 50
  ), del_portal as (
    select upper(coalesce(s.tipo, s.metadata->>'tipo', 'CARGA'))                  as tipo,
           coalesce(nullif(s.metadata->>'monto','')::numeric, s.monto, 0)         as monto,
           upper(coalesce(s.estado,'PENDIENTE'))                                  as estado,
           case when upper(coalesce(s.estado,'')) in ('RECHAZADA','CANCELADA','ERROR','ERROR_OPERATIVO')
                then coalesce(nullif(trim(s.metadata->>'motivo'),''),'') else '' end as motivo,
           s.created_at                                                           as fecha,
           coalesce(nullif(trim(s.metadata->>'billetera_titular'),''),
                    nullif(trim(s.metadata->>'billetera_alias'),''),
                    nullif(trim(s.metadata->>'destino'),''),
                    nullif(trim(s.metadata->>'billetera_nombre'),''), '')         as billetera,
           coalesce(nullif(trim(s.metadata->>'titular'),''), '')                  as titular,
           coalesce(nullif(trim(s.metadata->>'cancelada_por'),''), '')            as cancelada_por,
           'PORTAL'::text                                                         as origen,
           s.id                                                                   as solicitud_id,
           coalesce(nullif(s.metadata->>'monto_corregido','')::numeric,
                    nullif(s.metadata->>'monto','')::numeric, s.monto, 0)         as monto_a_pagar,
           coalesce(nullif(s.metadata->'retiro_parcial'->>'pagado','')::numeric, 0) as pagado,
           case when nullif(s.metadata->>'monto_corregido','') is not null then
             coalesce(nullif(trim(coalesce(s.metadata->>'motivo_ajuste','')),''),
               case s.metadata->>'motivo_correccion'
                 when 'ceros' then 'Al monto le sobraba un cero.'
                 when 'todo'  then 'Es todo lo que tenías en fichas.'
                 else null end)
           end                                                                    as motivo_ajuste,
           coalesce(s.metadata->'retiro_parcial'->'pagos','[]'::jsonb)            as pagos,
           s.metadata->'retiro_parcial'->'cierre'                                 as cierre,
           s.id as _orden_id
    from portal_filtrado s  ), manuales_filtrados as materialized (
    select h.*
    from public.historial_ops h
    where exists (select 1 from autorizado)
      and h.created_at >= now() - interval '7 days'
      and upper(coalesce(h.tipo,'')) in ('CARGA','RETIRO')
      and lower(btrim(h.usuario)) = lower(btrim(coalesce(p_usuario,'')))
      and h.solicitud_id is null
      and upper(coalesce(h.estado,'')) in ('OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA')
      and ( not exists (select 1 from pc)
            or upper(coalesce(h.pc_codigo,'')) = upper((select pc_codigo from pc)) )
    order by h.created_at desc, h.id desc
    limit 50
  ), manuales as (
    select upper(h.tipo)                                                          as tipo,
           abs(coalesce(h.monto,0))                                               as monto,
           'ACREDITADA'::text                                                     as estado,
           ''::text                                                               as motivo,
           h.created_at                                                           as fecha,
           ''::text                                                               as billetera,
           ''::text                                                               as titular,
           ''::text                                                               as cancelada_por,
           'MOSTRADOR'::text                                                      as origen,
           null::bigint                                                           as solicitud_id,
           abs(coalesce(h.monto,0))                                               as monto_a_pagar,
           0::numeric                                                             as pagado,
           null::text                                                             as motivo_ajuste,
           '[]'::jsonb                                                            as pagos,
           null::jsonb                                                            as cierre,
           h.id as _orden_id
    from manuales_filtrados h
  ), pagina as materialized (
    select * from (select * from del_portal union all select * from manuales) t
    order by t.fecha desc, t.origen, t._orden_id desc
    limit 50
  )
  select jsonb_build_object(
    'ok', true,
    'contract', 'portal.historial.v1',
    'observed_at', statement_timestamp(),
    'turno_desde', v_turno_desde,
    'turno_hasta', v_turno_hasta,
    'rows', coalesce((select jsonb_agg(to_jsonb(p) - '_orden_id' order by p.fecha desc, p.origen, p._orden_id desc) from pagina p), '[]'::jsonb),
    'rechazos_turno', jsonb_build_object(
      'CARGA', (select to_jsonb(p) - '_orden_id' from pagina p where p.tipo = 'CARGA' and p.estado in ('RECHAZADA','CANCELADA','ERROR','ERROR_OPERATIVO') and nullif(btrim(p.motivo),'') is not null and p.fecha >= v_turno_desde and p.fecha < v_turno_hasta order by p.fecha desc, p.origen, p._orden_id desc limit 1),
      'RETIRO', (select to_jsonb(p) - '_orden_id' from pagina p where p.tipo = 'RETIRO' and p.estado in ('RECHAZADA','CANCELADA','ERROR','ERROR_OPERATIVO') and nullif(btrim(p.motivo),'') is not null and p.fecha >= v_turno_desde and p.fecha < v_turno_hasta order by p.fecha desc, p.origen, p._orden_id desc limit 1)
    )
  ) into v_out;
  return v_out;
end;
$beta_historial$;
revoke all on function public.landing_historial_usuario_beta_v1(text,text,text,text) from public;
grant execute on function public.landing_historial_usuario_beta_v1(text,text,text,text) to anon, authenticated, service_role;
comment on function public.landing_historial_usuario_beta_v1(text,text,text,text)
  is 'portal.historial.v1: 50 operaciones de 7 días y rechazo del turno resuelto. Lectura pura; identidad/alcance legacy, sin ACK ni escrituras.';
commit;

