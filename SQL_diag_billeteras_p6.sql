-- ============================================================
-- NODO · ¿Por qué las billeteras de la oficina nueva P6 no aparecen en el admi?
-- Solo LECTURA. Ejecutar en Supabase SQL Editor y pegarme los resultados.
--
-- Hipótesis: el puesto de Chunior de la PC de P6 NO resolvió a 'P6' (falta/no coincide el ALIAS),
-- así que el panel guardó las billeteras bajo OTRO pc_codigo (el string crudo del puesto, o vacío).
-- ============================================================

-- 1) ¿Bajo qué pc_codigo se guardaron las billeteras? (buscá un pc_codigo raro / distinto de P1..P6)
--    Si ves las billeteras nuevas bajo un código que NO es 'P6', ese es el problema.
select coalesce(nullif(trim(pc_codigo),''),'(vacío)') as pc_codigo,
       count(*) as cant,
       string_agg(distinct nombre_visible, ', ') filter (where nombre_visible is not null) as nombres
from public.billeteras
group by 1
order by cant desc;

-- 2) Billeteras creadas en la última hora (las del sync recién hecho) — con su pc_codigo y UID.
select id, pc_codigo, nombre_visible, chunior_uid, saldo, activa, estado, created_at
from public.billeteras
where created_at > now() - interval '3 hours'
order by created_at desc;

-- 3) Aliases de P6: ¿existe el/los nombre(s) de puesto de Chunior de esa PC?
--    Acá tiene que estar el NOMBRE EXACTO del puesto con el que la PC de P6 entra a Chunior.
select id, alias_codigo, oficina_id, pc_codigo_compat, activa
from public.nodo_oficina_aliases
where upper(coalesce(pc_codigo_compat,'')) = 'P6'
   or upper(coalesce(oficina_id,'')) like '%P6%'
order by alias_codigo;

-- 4) La ruta pública de P6 (para confirmar que la oficina quedó creada).
select id, pc_codigo, public_code, nombre_publico, subdominio, host, activo
from public.landing_rutas_publicas
where upper(coalesce(pc_codigo,'')) = 'P6';

-- 5) TODOS los aliases (para ver si el puesto de P6 quedó apuntando a otra oficina por error).
select alias_codigo, oficina_id, pc_codigo_compat, activa
from public.nodo_oficina_aliases
order by pc_codigo_compat, alias_codigo;
