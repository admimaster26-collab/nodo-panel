-- Vuelta atrás de retiro-blacklist-unica.sql: saca el freno del servidor y las funciones nuevas.
-- Los retiros marcados [BL_EXCLUIDO] quedan como están (es la misma marca que ya usaba la blacklist).
drop trigger if exists trg_retiro_blacklist_24h on public.landing_solicitudes;
drop function if exists public.trg_retiro_blacklist_24h();
drop function if exists public.landing_retiro_disponible_v1(text,text,text);
drop function if exists public.nodo_beta_retiro_blacklist_v1(text,text,text);
drop function if exists public.nodo_beta_retiro_blacklist_excluir_v1(text,text,bigint,text);
drop function if exists public._oficina_nodo_beta_activa(text);
drop function if exists public.retiro_blacklist_24h(text);
