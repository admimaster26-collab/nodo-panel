-- ============================================================
-- NODO · ¿Están las RPC del retiro parcial en Supabase?
-- La barra de progreso del parcial en el PORTAL necesita:
--   • landing_retiro_registrar_parcial  (la escribe el PANEL al pagar un parcial)
--   • landing_retiro_progreso           (la lee el PORTAL para pintar la barra)
-- Ejecutar en Supabase SQL Editor. No modifica nada.
-- ============================================================
select p.proname as rpc,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('landing_retiro_registrar_parcial','landing_retiro_progreso')
order by p.proname;

-- Las que NO aparezcan arriba = faltan → hay que crearlas (te paso el SQL).
with esperadas(rpc) as (values ('landing_retiro_registrar_parcial'),('landing_retiro_progreso'))
select e.rpc as rpc_que_falta
from esperadas e
left join pg_proc p on p.proname=e.rpc
left join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
where p.oid is null;
