-- D-133 · Cada mensaje del chat viajaba dos veces por el canal nuevo.
--
-- Juan, 1/11: "se duplican los envíos de mensajes". El mensaje se guarda UNA vez. Lo que se repetía
-- era lo que se mostraba: landing_enviar_mensaje_v2 y trg_chat_autorespuesta copian cada mensaje al
-- hilo de la solicitud sin guardarle el número, y nodo_beta.hilo_legacy sacaba las copias comparando
-- justamente ese número. En 7 días: 7.290 entradas de hilo, 0 con número, 3.346 copias en 1.377 chats.
--
-- nodo_beta.hilo_legacy: además del número, es copia lo que tiene el mismo lado (jugador u otro), el
-- mismo texto y el mismo segundo. Se compara como texto para que una fecha vieja mal escrita no pueda
-- tirar abajo la lectura. Lo que existe sólo en el hilo (3.944 entradas) sigue saliendo igual.
--
-- La llama sólo nodo_beta.pagina_mensajes, y hoy sólo P1 usa este contrato. No borra datos.
-- Firma, dueño y permisos quedan como estaban.
-- Vuelta atrás: chat-espejo-d133-vuelta-atras.sql. Su texto da el md5 exacto del corte del 1/11.
-- Responsable: Juan.

do $d133$
declare
  v_def text;
  v_viejo constant text := $f$   and not exists(select 1 from nodo_beta.mensajes(c.id) x
     where coalesce(e.m->>'id',e.m->>'mensaje_id')=x.id::text);$f$;
begin
  v_def := pg_get_functiondef('nodo_beta.hilo_legacy(bigint,boolean)'::regprocedure);
  if md5(v_def) <> 'f4011245f4b887f2ca3df5d824e2c2c7' then
    raise exception 'D133: nodo_beta.hilo_legacy cambió desde el corte del 1/11 (md5 %)', md5(v_def);
  end if;
  if array_length(string_to_array(v_def, v_viejo), 1) <> 2 then
    raise exception 'D133: el cuerpo de nodo_beta.hilo_legacy no es el esperado';
  end if;
  execute replace(v_def, v_viejo, $f$   and not exists(select 1 from nodo_beta.mensajes(c.id) x
     where coalesce(e.m->>'id',e.m->>'mensaje_id')=x.id::text
        -- D-133: las copias del hilo no guardan el número del mensaje. Mismo lado, mismo texto y
        -- mismo segundo: es la copia, y ya viaja en rows.
        or ((upper(coalesce(e.m->>'origen',''))='USUARIO')=(upper(coalesce(x.tipo_emisor,''))='USUARIO')
          and coalesce(x.mensaje,'')=coalesce(e.m->>'mensaje','')
          and to_char(x.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')=left(e.m->>'fecha',19)));$f$);
end $d133$;
