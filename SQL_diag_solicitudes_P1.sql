-- ============================================================
-- NODO · ¿Por qué llegan solicitudes ajenas al nodo P1?
-- Solo LECTURA. Ejecutar en Supabase SQL Editor y pegarme los resultados.
-- ============================================================

-- 1) ¿Con qué pc_codigo y por qué ruta se están creando las solicitudes recientes?
--    Si aparecen usuarios de otra oficina con pc_codigo='P1', el problema es la RUTA que usaron.
select pc_codigo,
       metadata->>'public_code' as ruta_public_code,
       count(*) as cant,
       min(created_at) as desde,
       max(created_at) as hasta
from landing_solicitudes
where created_at > now() - interval '7 days'
group by 1,2
order by cant desc;

-- 2) Rutas públicas: ¿cuáles apuntan a P1? (¿hay alguna que debería ser de otra oficina?)
select id, pc_codigo, public_code, nombre_publico, subdominio, host, activo
from landing_rutas_publicas
order by pc_codigo, public_code;

-- 3) Alias de oficina que resuelven a P1 (los genéricos GENERAL/XGENERAL son los sospechosos)
select id, alias_codigo, oficina_id, pc_codigo_compat, activa
from nodo_oficina_aliases
where upper(coalesce(pc_codigo_compat,'')) = 'P1'
   or upper(coalesce(alias_codigo,'')) like '%GENERAL%'
order by alias_codigo;

-- 4) Últimas 30 solicitudes que cayeron en P1, con su ruta y usuario
--    → para ver si son usuarios que NO deberían ser de P1.
select id, created_at, tipo, estado, usuario, pc_codigo,
       metadata->>'public_code' as ruta
from landing_solicitudes
where upper(coalesce(pc_codigo,'')) in ('P1','PC1','XGENERAL','XGENERALENUSO','GENERAL','OFI_1')
order by id desc
limit 30;
