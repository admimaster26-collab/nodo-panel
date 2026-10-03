-- SEMAFORO DE OFICINAS -- para seguir el lanzamiento del portal nuevo (3/10/2026)
--
-- Juan: "que miedo que alguna oficina no funcione por dios, como podriamos hacerle seguimiento".
--
-- La idea: cada oficina tiene su propio ritmo. Un solo numero para todas no sirve -- que P4 este
-- 30 minutos sin recibir nada es una alarma; que P10B este una semana sin nada es lo normal.
-- Entonces se compara cada oficina CONSIGO MISMA: cuanto suele pasar entre una solicitud y la
-- siguiente, contra cuanto hace que no llega ninguna.
--
--   BIEN            el silencio es normal para esa oficina
--   MIRAR           hace 4 veces mas de lo habitual que no entra nada
--   *** ALARMA ***  hace 10 veces mas -- algo se rompio
--   SIN MOVIMIENTO  menos de 20 solicitudes en 7 dias: no hay con que medir
--
-- FOTO DE ANTES DEL LANZAMIENTO (3/10 12:06, portal viejo todavia en produccion).
-- Esto es lo que hay que poder volver a ver despues; si no se guardaba ahora, despues no habia
-- con que comparar:
--
--   P4   880/dia     P8    221/dia
--   P2   827/dia     P9B   221/dia
--   P3   539/dia     P5    139/dia
--   P7   514/dia     P11    14/dia
--   P6   406/dia     P10 P10C P1 P10B: entre 1 y 4/dia
--   P9   324/dia
--
-- Nueve oficinas con movimiento real, cinco casi quietas siempre.
--
-- YA EN ESTA FOTO, ANTES DE TOCAR NADA: P10 figura en MIRAR -- callada hace 1.787 minutos cuando
-- lo normal es cada 348. Eso NO lo causo el portal nuevo. Queda anotado para no culpar al
-- lanzamiento de algo que ya venia pasando.

with ritmo as (
  select pc_codigo,
         count(*) as en_7d,
         (7*24*60.0) / nullif(count(*),0) as cada_cuantos_min,
         max(created_at) as ultima
  from landing_solicitudes
  where origen='PORTAL_V16' and created_at > now() - interval '7 days'
  group by pc_codigo)
select pc_codigo as oficina,
       round(extract(epoch from (now()-ultima))/60) as callada_hace_min,
       round(cada_cuantos_min) as normal_cada_min,
       case
         when en_7d < 20 then 'SIN MOVIMIENTO (no se puede medir)'
         when extract(epoch from (now()-ultima))/60 > cada_cuantos_min * 10 then '*** ALARMA ***'
         when extract(epoch from (now()-ultima))/60 > cada_cuantos_min * 4  then 'MIRAR'
         else 'BIEN'
       end as estado
from ritmo
order by case
           when en_7d < 20 then 3
           when extract(epoch from (now()-ultima))/60 > cada_cuantos_min*10 then 0
           when extract(epoch from (now()-ultima))/60 > cada_cuantos_min*4 then 1
           else 2 end,
         pc_codigo;

-- ---------------------------------------------------------------------------
-- SEGUNDA MIRADA: que las consultas esten llegando por el canal nuevo.
-- Si una oficina sigue recibiendo cargas pero dejo de recibir consultas, el problema es del
-- chat, no del portal entero.
--
-- with h as (select pc_codigo,
--              count(*) filter (where tipo='SOPORTE') as consultas,
--              count(*) filter (where tipo in ('CARGA','RETIRO')) as plata
--            from landing_solicitudes
--            where origen='PORTAL_V16' and created_at > now() - interval '2 hours'
--            group by pc_codigo)
-- select * from h order by plata desc;
