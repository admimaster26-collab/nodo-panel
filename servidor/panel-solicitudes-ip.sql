-- panel_solicitudes_ip: la IP desde la que el jugador mandó cada solicitud del Portal (6/11).
-- El historial del perfil la muestra entre el titular y el número de operación. La IP vive en
-- landing_solicitudes.metadata->>'ip' (más o menos la mitad de las solicitudes de los últimos 60
-- días la tienen), y esa tabla no se puede leer con la clave pública: por eso va con el secreto
-- del panel, como el resto de las lecturas. Sólo lectura, hasta 500 solicitudes por llamada.
-- Función nueva. Vuelta atrás: panel-solicitudes-ip-vuelta-atras.sql

create or replace function public.panel_solicitudes_ip(p_secret text, p_ids bigint[])
returns table(solicitud_id bigint, ip text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  return query
  select s.id, nullif(trim(s.metadata->>'ip'), '')
  from public.landing_solicitudes s
  where s.id = any((p_ids)[1:500])
    and nullif(trim(s.metadata->>'ip'), '') is not null;
end $function$;
