-- Vuelta atrás de chat-espejo-d133.sql. Deja nodo_beta.hilo_legacy con el cuerpo del corte del 1/11
-- (md5 f4011245f4b887f2ca3df5d824e2c2c7).

CREATE OR REPLACE FUNCTION nodo_beta.hilo_legacy(p_sesion_id bigint, p_portal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
   'portal_key','legacy:'||s.id::text||':'||e.ord::text,
   'origen',e.m->>'origen','mensaje',e.m->>'mensaje',
   'imagen_url',coalesce(e.m->>'imagen_url',e.m->>'imagen'),
   'fecha',e.m->>'fecha','solicitud_id',s.id::text,
   'auto',e.m->'auto','auto_caso',e.m->>'auto_caso',
   'visto_confirmado',false)) order by e.ord),'[]'::jsonb)
 from public.chat_sesiones c
 join public.landing_solicitudes s on s.id=c.solicitud_id
   and upper(btrim(coalesce(s.pc_codigo,'')))=upper(btrim(coalesce(c.pc_codigo,'')))
   and lower(btrim(coalesce(s.usuario,s.metadata->>'usuario','')))=lower(btrim(c.usuario))
 cross join lateral jsonb_array_elements(case when jsonb_typeof(s.metadata->'chat_thread')='array'
   then s.metadata->'chat_thread' else '[]'::jsonb end) with ordinality e(m,ord)
 where c.id=p_sesion_id
   and (case when p_portal then e.m->>'visible_usuario' else e.m->>'visible_operador' end) is distinct from 'false'
   -- D-130: texto de relleno guardado como USUARIO. El jugador nunca lo escribió.
   and not (upper(coalesce(e.m->>'origen',''))='USUARIO'
     and coalesce(e.m->>'imagen_url',e.m->>'imagen','')=''
     and btrim(coalesce(e.m->>'mensaje','')) ~* '^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^]]*\])$')
   and not exists(select 1 from nodo_beta.mensajes(c.id) x
     where coalesce(e.m->>'id',e.m->>'mensaje_id')=x.id::text);
$function$;
