-- D-131 · El contador de chat contaba mensajes ya leídos.
--
-- Juan, 1/11: "chat detecta mensajes que no exiten". P1 mostraba 25 sin leer y sólo 6 lo eran:
-- 17 ya estaban leídos con el sistema anterior (leido=true sin leido_operador_at, una fecha que antes
-- no existía) y 2 ya los había contestado el operador.
--
-- nodo_beta.contadores: sin leer = leido=false y posterior a la última respuesta de una persona.
-- El "visto" del jugador (seen_remaining, chat_lecturas) no cambia.
--
-- Sólo P1 usa este contrato hoy. No borra datos. Firma, dueño y permisos quedan como estaban.
-- Vuelta atrás: chat-contador-d131-vuelta-atras.sql. Su texto da el md5 exacto del corte del 1/11.
-- Responsable: Juan.

do $d131$
declare
  v_def text;
  v_nuevo text;
  v_viejo constant text := $f$ select jsonb_build_object(
   'unread',count(*) filter(where coalesce(m.leido,false)=false or m.leido_operador_at is null),
   'seen_remaining',count(*) filter(where r.message_id is null))
 from nodo_beta.mensajes(p_sesion_id) m
 left join nodo_beta.chat_lecturas r on r.message_id=m.id and r.sesion_id=p_sesion_id
 where upper(m.tipo_emisor)='USUARIO' and coalesce(m.visible_operador,true);$f$;
begin
  v_def := pg_get_functiondef('nodo_beta.contadores(bigint)'::regprocedure);
  if md5(v_def) <> 'fdf0fa2db25d74e2d471e6c3e2d1b493' then
    raise exception 'D131: nodo_beta.contadores cambió desde el corte del 1/11 (md5 %)', md5(v_def);
  end if;
  if array_length(string_to_array(v_def, v_viejo), 1) <> 2 then
    raise exception 'D131: el cuerpo de nodo_beta.contadores no es el esperado';
  end if;
  v_nuevo := replace(v_def, v_viejo, $f$ -- Sin leer: lo que nadie marcó como leído y el operador todavía no contestó. Una respuesta automática
 -- no cuenta como contestar. El "visto" que recibe el jugador sale aparte, de chat_lecturas.
 select jsonb_build_object(
   'unread',count(*) filter(where coalesce(t.leido,false)=false and t.id>coalesce(t.corte,0)),
   'seen_remaining',count(*) filter(where r.message_id is null))
 from (select m.*,max(m.id) filter(where upper(coalesce(m.tipo_emisor,''))='OPERADOR'
         and coalesce(m.visible_operador,true) and coalesce(m.metadata->>'auto','')<>'true'
         and upper(coalesce(m.emisor,''))<>'NODO') over() as corte
       from nodo_beta.mensajes(p_sesion_id) m) t
 left join nodo_beta.chat_lecturas r on r.message_id=t.id and r.sesion_id=p_sesion_id
 where upper(t.tipo_emisor)='USUARIO' and coalesce(t.visible_operador,true);$f$);
  execute v_nuevo;
end $d131$;
