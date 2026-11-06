-- Vuelve panel_retiro_alertas a como estaba antes del 4/11: cargado y retirado de toda la historia.
-- Cuerpo copiado de producción. Allá tenía fines de línea CRLF (md5 3395ed27bc3299eeffee3dce1707cd21);
-- sin los CR da md5 809268f2c05fcc671607cd23e62accdf, que es lo que deja este archivo.

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
           max(h.created_at) as at
    from public.historial_ops h
    where h.origen = 'PROMO_BONO'
      and upper(coalesce(h.estado,'')) = 'OK'
      and h.created_at > now() - interval '7 days'
      and lower(trim(h.usuario)) in (select u from sol)
    group by 1
  ),
  -- Cargado real (sin contar el bono) y retirado previo
  ops as (
    select lower(trim(h.usuario)) as u,
           sum(h.monto) filter (where upper(h.tipo)='CARGA' and coalesce(h.origen,'') <> 'PROMO_BONO') as cargado,
           sum(h.monto) filter (where upper(h.tipo)='RETIRO')                                          as retirado
    from public.historial_ops h
    where upper(coalesce(h.estado,'')) = 'OK'
      and lower(trim(h.usuario)) in (select u from sol)
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
