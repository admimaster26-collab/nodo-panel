-- Vuelta atrás de chat-sin-relleno-d130.sql. Deja las tres funciones con el md5 del corte del 1/11.
-- Si alguna cambió después del parche no toca nada: hay que mirarla a mano.

do $d130$
declare
  c record;
  v_def text;
begin
  for c in select * from (values
    ('public.landing_portal_chat_thread_get(text,text,text)'::regprocedure,
     'ffe45ac3ad691e3dc855dcf80d3be36f', '278efe813aa6fd762fcf3f32c5681bc0',
     $f$from jsonb_array_elements(coalesce(v_row.metadata->'chat_thread','[]'::jsonb)) with ordinality t(m, ord)
  -- D-130: texto de relleno guardado como USUARIO. El jugador nunca lo escribió: no se le muestra
  -- como propio. Queda en el hilo; sólo no viaja.
  where not (upper(coalesce(m->>'origen','')) = 'USUARIO'
             and coalesce(m->>'imagen_url', m->>'imagen', '') = ''
             and btrim(coalesce(m->>'mensaje','')) ~* '^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^]]*\])$');$f$,
     $f$from jsonb_array_elements(coalesce(v_row.metadata->'chat_thread','[]'::jsonb)) with ordinality t(m, ord);$f$),

    ('nodo_beta.hilo_legacy(bigint,boolean)'::regprocedure,
     'f4011245f4b887f2ca3df5d824e2c2c7', '97b375b59d759d7506ffc1ebfa616a53',
     $f$   -- D-130: texto de relleno guardado como USUARIO. El jugador nunca lo escribió.
   and not (upper(coalesce(e.m->>'origen',''))='USUARIO'
     and coalesce(e.m->>'imagen_url',e.m->>'imagen','')=''
     and btrim(coalesce(e.m->>'mensaje','')) ~* '^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^]]*\])$')
   and not exists(select 1 from nodo_beta.mensajes(c.id) x$f$,
     $f$   and not exists(select 1 from nodo_beta.mensajes(c.id) x$f$),

    ('public.panel_chat_iniciar(text,text,text,text,text)'::regprocedure,
     '7e7a67ecf594c82987540853435a88b3', 'fc11f8b9c80b2a910879bde0256a3350',
     $f$'[Conversación iniciada por el operador]',$f$,
     $f$'[Conversación iniciada por el operador ' || v_op || ']',$f$)
  ) t(fn, md5_parche, md5_original, nuevo, viejo) loop
    v_def := pg_get_functiondef(c.fn);
    if md5(v_def) <> c.md5_parche then
      raise exception 'D130: % cambió después del parche (md5 %)', c.fn, md5(v_def);
    end if;
    execute replace(v_def, c.nuevo, c.viejo);
    if md5(pg_get_functiondef(c.fn)) <> c.md5_original then
      raise exception 'D130: % no volvió al md5 original', c.fn;
    end if;
  end loop;
end $d130$;
