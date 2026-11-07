-- Saca la unión del retiro con DNI (7/11). Primero apagar las oficinas:
--   update public.retiro_instrumentos_oficinas set habilitado = false;
-- Con eso el Portal vuelve solo al retiro de siempre. Para sacar todo:
drop function if exists public.landing_portal_retiro_crear_v1(text, text, text, text, numeric, text, text, text, jsonb);
drop function if exists public.landing_portal_retiro_contexto_v1(text, text, text, text);
drop function if exists public._retiro_inst_marcar(bigint, text, jsonb);
drop function if exists public._retiro_inst_pc2(text, text);
drop function if exists public._retiro_inst_hash(text);
drop table if exists public.retiro_instrumentos_oficinas;
drop table if exists public.retiro_instrumentos_secreto;
-- Y volver a correr las funciones de retiro-instrumentos.sql (panel_retiro_instrumento*, landing_retiro_*),
-- que estas reemplazaron. Las columnas dni_hash y dni_fin pueden quedar.
