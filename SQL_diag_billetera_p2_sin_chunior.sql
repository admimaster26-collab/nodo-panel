-- ============================================================
-- NODO · Diagnóstico: billetera de P2 que "no vinculó con Chunior" (error al pagar)
-- Solo LECTURA. Ejecutar en Supabase SQL Editor y pegarme los resultados.
-- Hipótesis: la billetera quedó SIN chunior_uid (o mal cargado) → el panel no puede pagar por Chunior.
-- ============================================================

-- 1) TODAS las billeteras de P2 con su estado de vínculo a Chunior.
--    Mirá la columna vinculo_chunior: '❌ SIN UID' es la/las que fallan.
select id,
       nombre_visible,
       chunior_uid,
       case when coalesce(trim(chunior_uid::text),'') = '' then '❌ SIN UID' else '✅ ' || chunior_uid end as vinculo_chunior,
       activa, estado, saldo, cbu_alias, titular, created_at
from public.billeteras
where upper(coalesce(pc_codigo,'')) in ('P2','PC2')
order by (coalesce(trim(chunior_uid::text),'') = '') desc, nombre_visible;

-- 2) ¿Existe esa misma billetera (mismo nombre/CBU) en OTRA oficina CON chunior_uid?
--    Si aparece la misma con UID en otro pc_codigo, es un problema de sync/pc, no de datos faltantes.
--    (Reemplazá el texto del ILIKE por parte del NOMBRE de la billetera que falla.)
-- select id, pc_codigo, nombre_visible, chunior_uid, activa, estado
-- from public.billeteras
-- where nombre_visible ilike '%NOMBRE_DE_LA_BILLETERA%'
-- order by pc_codigo;

-- 3) Contexto: cuántas billeteras de P2 están sin UID vs con UID.
select case when coalesce(trim(chunior_uid::text),'') = '' then 'SIN UID' else 'CON UID' end as estado_uid,
       count(*) as cant
from public.billeteras
where upper(coalesce(pc_codigo,'')) in ('P2','PC2')
group by 1;
