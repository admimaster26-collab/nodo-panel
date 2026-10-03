-- REVISION DE SALUD: las cosas que pasan y NO se ven.
--
-- Juan, 3/10: "basicamente descubriste despues de 5 dias la razon por la cual te pedi el sistema,
-- por que pueden pasar cosas y no verse".
--
-- Tiene razon. El motor que me pidio mira lo que le pasa al PANEL (la lectura fallo, la causa fue
-- el servidor). Eso esta bien y sirvio: sin esa linea yo seguiria discutiendo si era internet.
-- Pero no mira la MAQUINA. Y el indice roto que nos costo cuatro dias no se ve desde arriba:
-- no tira error, no sale en los logs, figura en la lista de indices como cualquier otro.
--
-- Esto es el escalon que faltaba. Son cinco preguntas, todas baratas. Correrlas cuando algo anda
-- raro, antes de ponerse a adivinar.

-- 1) INDICES ROTOS.  Es lo que nos paso. Un indice invalido se ignora en silencio.
select 'INDICE ROTO' as que, t.relname as donde, c.relname as cual,
       'reindex index concurrently public.'||c.relname||';' as como_se_arregla
from pg_index i
join pg_class c on c.oid=i.indexrelid
join pg_class t on t.oid=i.indrelid
join pg_namespace n on n.oid=c.relnamespace
where (not i.indisvalid or not i.indisready) and n.nspname='public';

-- 2) INDICES QUE NADIE USA. Si uno importante tiene idx_scan = 0, o esta roto, o la consulta
--    cambio y ya no le pega. Las dos cosas valen la pena mirarlas.
select 'INDICE SIN USO' as que, relname as donde, indexrelname as cual,
       pg_size_pretty(pg_relation_size(indexrelid)) as ocupa
from pg_stat_user_indexes
where idx_scan = 0 and pg_relation_size(indexrelid) > 1024*1024
order by pg_relation_size(indexrelid) desc;

-- 3) CONSULTAS QUE MUEREN EN EL TOPE. ms_peor pegado a 3000 = la estan matando, no es que tarde.
select 'MUERE EN EL TOPE' as que,
       substring(query from '"?public"?\."?([a-z0-9_]+)"?\s*\(') as cual,
       calls as llamadas, round(mean_exec_time) as ms_promedio, round(max_exec_time) as ms_peor
from pg_stat_statements
where max_exec_time between 2900 and 3100 and calls > 1000
order by total_exec_time desc limit 10;

-- 4) ESTADISTICAS VIEJAS. Con datos de anoche, la base elige mal el camino.
select 'ESTADISTICAS VIEJAS' as que, relname as donde,
       round(extract(epoch from (now()-greatest(coalesce(last_analyze,'epoch'),
                                                coalesce(last_autoanalyze,'epoch'))))/3600) as hace_horas,
       n_dead_tup as filas_muertas
from pg_stat_user_tables
where n_live_tup > 50000
  and greatest(coalesce(last_analyze,'epoch'), coalesce(last_autoanalyze,'epoch')) < now() - interval '6 hours'
order by n_live_tup desc;

-- 5) LO QUE MAS BASE CONSUME. No es un error, pero es donde conviene mirar primero.
select 'LO QUE MAS PESA' as que,
       substring(query from '"?public"?\."?([a-z0-9_]+)"?\s*\(') as cual,
       calls as llamadas, round(mean_exec_time) as ms_promedio,
       round(total_exec_time/1000/60) as minutos_de_base
from pg_stat_statements
where query ilike '%pgrst_call%'
order by total_exec_time desc limit 8;
