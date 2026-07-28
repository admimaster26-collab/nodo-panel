-- ============================================================
-- NODO · DIAGNÓSTICO del retiro parcial que "se cerró con saldo pendiente"
-- Solo LECTURA. Ejecutar en Supabase SQL Editor y pegarme el resultado.
-- ============================================================

-- 1) Definición actual de la RPC (para ver cómo calcula 'completado' y si setea estado=PAGADA)
select pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='landing_retiro_registrar_parcial';

-- 2) Estado + metadata del retiro afectado (cambiá el id si fue otro).
--    Esperado si el fix de la RPC estuviera bien: estado EN_PROCESO y metadata.retiro_parcial.pagado < monto.
select id, usuario, tipo, estado, monto,
       metadata->'retiro_parcial' as retiro_parcial
from landing_solicitudes
where id = 28539;

-- 3) (Opcional) Últimos retiros que quedaron PAGADA/ACREDITADA pero con parcial < total
--    → detecta otros retiros cerrados con saldo pendiente por el mismo bug.
select id, usuario, estado, monto,
       (metadata->'retiro_parcial'->>'pagado')::numeric as pagado,
       (metadata->'retiro_parcial'->>'total')::numeric  as total_meta
from landing_solicitudes
where tipo='RETIRO'
  and metadata ? 'retiro_parcial'
  and coalesce((metadata->'retiro_parcial'->>'pagado')::numeric,0) < coalesce((metadata->'retiro_parcial'->>'total')::numeric, monto)
  and upper(estado) in ('PAGADA','ACREDITADA','COMPLETADA','FINALIZADA','APROBADA')
order by id desc
limit 20;
