-- Vuelta atrás de oficina-whatsapp.sql: saca panel_oficina_whatsapp_registrar.
-- Los números que ya escribió quedan como están; landing_resolver_ruta_publica y el Portal los
-- siguen leyendo igual. Si además hay que devolver el número anterior de una oficina, está en
-- panel_operativo_auditoria (revisar la salida ANTES de correr el update):
--
-- select a.created_at, a.pc_codigo, a.entidad_id, a.valor_anterior->>'whatsapp_numero' as anterior,
--        a.valor_nuevo->>'whatsapp_numero' as nuevo
--   from public.panel_operativo_auditoria a
--  where a.accion = 'WHATSAPP_OFICINA' and a.pc_codigo = 'P?'
--  order by a.created_at desc;
--
-- update public.landing_rutas_publicas set whatsapp_numero = '<anterior>', updated_at = now()
--  where id = <entidad_id>;

drop function if exists public.panel_oficina_whatsapp_registrar(text,text,text,text);
