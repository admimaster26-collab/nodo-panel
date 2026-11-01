-- Vuelta atrás de chat-contador-d131.sql. Deja nodo_beta.contadores con el cuerpo del corte del 1/11
-- (md5 fdf0fa2db25d74e2d471e6c3e2d1b493).

CREATE OR REPLACE FUNCTION nodo_beta.contadores(p_sesion_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
   'unread',count(*) filter(where coalesce(m.leido,false)=false or m.leido_operador_at is null),
   'seen_remaining',count(*) filter(where r.message_id is null))
 from nodo_beta.mensajes(p_sesion_id) m
 left join nodo_beta.chat_lecturas r on r.message_id=m.id and r.sesion_id=p_sesion_id
 where upper(m.tipo_emisor)='USUARIO' and coalesce(m.visible_operador,true);
$function$;
