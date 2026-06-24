-- ============================================================
-- NODO - Consultas para mapear RPC activas del panel/portal
-- Ejecutar en Supabase SQL Editor y copiar los resultados.
-- No modifica datos.
-- ============================================================

-- 1) Todas las RPC candidatas del panel/portal con firma exacta.
select
  n.nspname as schema,
  p.proname as rpc,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%panel%'
    or p.proname ilike '%portal%'
    or p.proname ilike '%chat%'
    or p.proname ilike '%billetera%'
    or p.proname ilike '%worker%'
    or p.proname ilike '%solicitud%'
  )
order by p.proname;

-- 2) RPC separadas por area para conectar cables del panel nuevo.
select
  p.proname as rpc,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname ~* '(solicitud|landing|portal)'
order by p.proname;

select
  p.proname as rpc,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname ~* '(chat|mensaje)'
order by p.proname;

select
  p.proname as rpc,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname ~* '(billetera|wallet|chunior)'
order by p.proname;

select
  p.proname as rpc,
  pg_get_function_identity_arguments(p.oid) as argumentos,
  pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname ~* '(worker|job|operacion|accion)'
order by p.proname;

-- 3) Tablas reales relacionadas al portal/chat/worker.
select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name ~* '(chat|mensaje|portal|solicitud|worker|job|billetera|oficina)'
order by table_name;

-- 4) Columnas de esas tablas para adaptar payloads sin suponer nombres.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name ~* '(chat|mensaje|portal|solicitud|worker|job|billetera|oficina)'
order by table_name, ordinal_position;
