-- panel_retiro_alertas: lo cargado y lo retirado se cuentan desde la carga que recibió el bono (4/11).
-- El aviso de bono de NODO sale sólo si el retiro se lleva la carga más el bono sin ganar nada
-- encima. Con toda la historia del jugador sumada, 11 de 90 jugadores con bono en la semana tenían
-- cargas anteriores que tapaban o inventaban la diferencia. Sin bono nada cambia: esos dos números
-- sólo los usa el aviso de bono.
-- La carga del bono queda unos segundos antes que la fila PROMO_BONO (4 s en las muestras del 4/11).
-- Misma firma y mismas columnas: create or replace conserva dueño y permisos.
-- Foto previa: dueño postgres, security definer, proacl NULL, md5(prosrc) 3395ed27bc3299eeffee3dce1707cd21.
-- Vuelta atrás: bonos-retiro-alerta-desde-la-carga-vuelta-atras.sql
-- Aplicado el 4/11 (migración bonos_retiro_alerta_desde_la_carga): md5(prosrc) b0213027d94e73405ffa3cca28cf14d3,
-- dueño y permisos sin cambios, 65 ms con los últimos 60 retiros.

CREATE OR REPLACE FUNCTION public.panel_retiro_alertas(p_secret text, p_pc_codigo text, p_solicitud_ids bigint[])
 RETURNS TABLE(solicitud_id bigint, usuario text, bono_monto numeric, bono_at timestamp with time zone, bono_horas numeric, cargado_real numeric, retirado_previo numeric, cbu text, cbu_titular text, cbu_cuentas integer, cbu_usuarios text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;

  return query
  with sol as (
    select s.id,
           lower(trim(coalesce(s.metadata->>'usuario',''))) as u,
           lower(regexp_replace(coalesce(nullif(s.metadata->>'cbu',''), s.metadata->>'destino', ''),
                                '[\s.\-]', '', 'g')) as cbu
    from public.landing_solicitudes s
    where s.id = any(p_solicitud_ids)
  ),
  -- BONO de los últimos 7 días (después de una semana el aviso es ruido)
  bono as (
    select lower(trim(h.usuario)) as u,
           sum(h.monto)      as monto,
           min(h.created_at) as primero,
           max(h.created_at) as at
    from public.historial_ops h
    where h.origen = 'PROMO_BONO'
      and upper(coalesce(h.estado,'')) = 'OK'
      and h.created_at > now() - interval '7 days'
      and lower(trim(h.usuario)) in (select u from sol)
    group by 1
  ),
  -- Con bono, se cuenta desde la carga que lo recibió: la última carga real hasta el primer bono
  desde as (
    select b.u,
           coalesce((select max(h.created_at)
                       from public.historial_ops h
                      where lower(trim(h.usuario)) = b.u
                        and upper(h.tipo) = 'CARGA'
                        and coalesce(h.origen,'') <> 'PROMO_BONO'
                        and upper(coalesce(h.estado,'')) = 'OK'
                        and h.created_at <= b.primero), b.primero) as at
    from bono b
  ),
  -- Cargado real (sin contar el bono) y retirado previo
  ops as (
    select lower(trim(h.usuario)) as u,
           sum(h.monto) filter (where upper(h.tipo)='CARGA' and coalesce(h.origen,'') <> 'PROMO_BONO') as cargado,
           sum(h.monto) filter (where upper(h.tipo)='RETIRO')                                          as retirado
    from public.historial_ops h
    left join desde d on d.u = lower(trim(h.usuario))
    where upper(coalesce(h.estado,'')) = 'OK'
      and lower(trim(h.usuario)) in (select u from sol)
      and (d.at is null or h.created_at >= d.at)
    group by 1
  ),
  -- CBU repetido: una sola pasada sobre landing_solicitudes
  cbu_hits as (
    select lower(regexp_replace(coalesce(nullif(m.metadata->>'cbu',''), m.metadata->>'destino', ''),
                                '[\s.\-]', '', 'g')) as cbu,
           lower(trim(coalesce(m.metadata->>'usuario',''))) as u,
           max(coalesce(m.metadata->>'titular','')) as titular
    from public.landing_solicitudes m
    where upper(coalesce(m.metadata->>'tipo','')) = 'RETIRO'
      and lower(regexp_replace(coalesce(nullif(m.metadata->>'cbu',''), m.metadata->>'destino', ''),
                               '[\s.\-]', '', 'g')) in (select s.cbu from sol s where length(s.cbu) >= 6)
    group by 1,2
  ),
  cbu_agg as (
    select c.cbu,
           max(c.titular)                                as titular,
           count(distinct c.u)                           as cuentas,
           string_agg(distinct c.u, ' · ' order by c.u)  as usuarios
    from cbu_hits c
    where c.u <> ''
    group by c.cbu
  )
  select s.id,
         s.u,
         b.monto,
         b.at,
         case when b.at is null then null
              else round(extract(epoch from (now() - b.at))/3600.0, 1) end,
         coalesce(o.cargado, 0),
         coalesce(o.retirado, 0),
         nullif(s.cbu,''),
         nullif(ca.titular,''),
         coalesce(ca.cuentas, 0)::int,
         ca.usuarios
  from sol s
  left join bono    b  on b.u  = s.u
  left join ops     o  on o.u  = s.u
  left join cbu_agg ca on ca.cbu = s.cbu;
end $function$;
