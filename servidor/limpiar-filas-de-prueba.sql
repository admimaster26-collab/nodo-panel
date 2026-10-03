-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRAR MIS FILAS DE PRUEBA  ·  3/10
--
-- Los permisos no me dejan borrar, así que queda acá para que lo corras vos.
--
-- Son 21 filas que fui dejando hoy probando: la fuga de tokens (ZZ_victima / ZZ_atacante /
-- ZZ_ladron / ZZ_chk), el puente de versiones viejas (ZZ_puente_test), el cierre de chats
-- (ZZ_cierre), el disparador del puente (ZZ_puente_trg2) y el bot (ZZ_bot_prueba).
--
-- MOLESTAN DE VERDAD: ZZ_victima quedó en P4 con el teléfono 1100000001, y como el cotejo de
-- alta mira TODAS las oficinas, al abrir una consulta en P1 la tarjeta avisa
-- "⚠ es de zz_victima · oficina P4". Es correcto lo que dice — el dato es basura mía.
--
-- Mirar antes de borrar:
--   select 'vinculos' t, pc_codigo, usuario, telefono_canon from public.usuarios_portal_vinculos where usuario ilike 'ZZ\_%'
--   union all select 'sesiones', pc_codigo, usuario, id::text from public.chat_sesiones where usuario ilike 'ZZ\_%'
--   union all select 'solicitudes', pc_codigo, usuario, id::text from public.landing_solicitudes where usuario ilike 'ZZ\_%';

begin;

delete from public.chat_mensajes m
 where m.chat_id in (select cs.chat_id from public.chat_sesiones cs where cs.usuario ilike 'ZZ\_%');

delete from public.chat_sesiones where usuario ilike 'ZZ\_%';

delete from public.landing_solicitudes
 where usuario ilike 'ZZ\_%' or usuario ilike 'PRUEBA PUENTE%';

delete from public.usuarios_portal_vinculos where usuario ilike 'ZZ\_%';

-- revisar que no quede nada y recién ahí:
commit;
