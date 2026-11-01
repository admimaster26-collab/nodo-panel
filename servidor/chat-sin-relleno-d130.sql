-- D-130 · El jugador no ve como propio lo que escribió el sistema.
--
-- Juan, 1/11: "[Conversación iniciada por el operador juancarlos]" del lado del jugador.
-- El panel inventaba esa entrada (o "Consulta desde portal") cuando la solicitud no traía mensaje
-- del jugador, y al contestar la guardaba en el hilo con origen USUARIO. Medido el 1/11 sobre
-- 30 días: 5.692 "Consulta desde portal" en 4.736 chats y 26 frases con el nombre del operador.
--
-- El panel ya no las inventa (NodoChatMessage.isFiller), pero las oficinas tardan en actualizar y
-- lo guardado sigue guardado. Este parche corta el resto del lado del servidor, para todas a la vez:
--   1. landing_portal_chat_thread_get: el portal deja de recibirlas.
--   2. nodo_beta.hilo_legacy: lo mismo por el canal beta.
--   3. panel_chat_iniciar: deja de escribir el nombre del operador en mensaje_inicial.
--
-- No borra datos. Las entradas guardadas se dejan de mostrar; el panel nuevo las saca del hilo
-- recién cuando vuelve a escribirlo. Todas las firmas y permisos quedan como estaban.
-- Mismo patrón que NodoChatMessage.isFiller en renderer/chat/message-model.js.
--
-- Cada función se parchea sobre su definición viva y sólo si su md5 es el del corte del 1/11.
-- Vuelta atrás: chat-sin-relleno-d130-vuelta-atras.sql.
--
-- Ensayado contra producción el 1/11 en una transacción revertida, sobre 150 chats reales por canal:
--   portal: 925 entradas -> 756 (169 de relleno, 0 restantes)
--   beta:   976 entradas -> 796 (180 de relleno, 0 restantes)
-- y la vuelta atrás dejó los tres md5 exactos. Responsable: Juan.
--
-- APLICADO el 1/11, migración 20261101100215 d130_chat_sin_relleno. Volver a correrlo corta con un
-- error D130 sin tocar nada, porque los md5 ya no son los del corte.

do $d130$
declare
  c record;
  v_def text;
  v_nuevo text;
begin
  for c in select * from (values
    ('public.landing_portal_chat_thread_get(text,text,text)'::regprocedure,
     '278efe813aa6fd762fcf3f32c5681bc0',
     $f$from jsonb_array_elements(coalesce(v_row.metadata->'chat_thread','[]'::jsonb)) with ordinality t(m, ord);$f$,
     $f$from jsonb_array_elements(coalesce(v_row.metadata->'chat_thread','[]'::jsonb)) with ordinality t(m, ord)
  -- D-130: texto de relleno guardado como USUARIO. El jugador nunca lo escribió: no se le muestra
  -- como propio. Queda en el hilo; sólo no viaja.
  where not (upper(coalesce(m->>'origen','')) = 'USUARIO'
             and coalesce(m->>'imagen_url', m->>'imagen', '') = ''
             and btrim(coalesce(m->>'mensaje','')) ~* '^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^]]*\])$');$f$),

    ('nodo_beta.hilo_legacy(bigint,boolean)'::regprocedure,
     '97b375b59d759d7506ffc1ebfa616a53',
     $f$   and not exists(select 1 from nodo_beta.mensajes(c.id) x$f$,
     $f$   -- D-130: texto de relleno guardado como USUARIO. El jugador nunca lo escribió.
   and not (upper(coalesce(e.m->>'origen',''))='USUARIO'
     and coalesce(e.m->>'imagen_url',e.m->>'imagen','')=''
     and btrim(coalesce(e.m->>'mensaje','')) ~* '^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^]]*\])$')
   and not exists(select 1 from nodo_beta.mensajes(c.id) x$f$),

    ('public.panel_chat_iniciar(text,text,text,text,text)'::regprocedure,
     'fc11f8b9c80b2a910879bde0256a3350',
     $f$'[Conversación iniciada por el operador ' || v_op || ']',$f$,
     $f$'[Conversación iniciada por el operador]',$f$)
  ) t(fn, md5_antes, viejo, nuevo) loop
    v_def := pg_get_functiondef(c.fn);
    if md5(v_def) <> c.md5_antes then
      raise exception 'D130: % cambió desde el corte del 1/11 (md5 %)', c.fn, md5(v_def);
    end if;
    if array_length(string_to_array(v_def, c.viejo), 1) <> 2 then
      raise exception 'D130: el fragmento de % no aparece exactamente una vez', c.fn;
    end if;
    v_nuevo := replace(v_def, c.viejo, c.nuevo);
    execute v_nuevo;
  end loop;
end $d130$;
