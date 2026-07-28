-- ============================================================
-- NODO · ¿Qué función levanta "Sesión inválida" / "Sesión inválida o vencida"?
-- Solo LECTURA. Ejecutar en Supabase SQL Editor y pegarme el resultado.
-- ============================================================

-- 1) Todas las funciones que contienen ese mensaje (el que aparece en los logs como P0001)
select p.proname as funcion,
       pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (pg_get_functiondef(p.oid) ilike '%Sesión inválida%'
       or pg_get_functiondef(p.oid) ilike '%Sesion invalida%')
order by p.proname;

-- 2) La definición completa de esas funciones (para ver QUÉ valida y por qué falla).
--    Si el punto 1 devuelve pocas, corré esto para verlas enteras.
select p.proname as funcion, pg_get_functiondef(p.oid) as definicion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (pg_get_functiondef(p.oid) ilike '%Sesión inválida%'
       or pg_get_functiondef(p.oid) ilike '%Sesion invalida%');

-- 3) ¿Hay sesiones de admin vencidas dando vueltas? (si existe la tabla de sesiones)
--    Ajustá el nombre de la tabla si es otro; esto es para ver si hay un token viejo
--    que algún navegador/pestaña sigue usando en loop.
-- select * from admin_sesiones order by created_at desc limit 20;
