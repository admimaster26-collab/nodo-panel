-- panel_core_get_chat_sesiones_json deja de mandar los chats CERRADOS sin actividad hace más de 30 días (6/11).
--
-- NODO pide esta lista cada 15-20 s (por dos caminos) y la procesa entera cada 4 s. En P4 eran 1.346
-- conversaciones y 750 KB por pedido; 1.058 de ellas cerradas y de hace más de una semana. En la PC
-- espejo de Sánchez NODO no llega a abrir (versión 2.1.5, que se traba al arrancar con mucho dato).
-- Juan: "no es necesario tener lo de hace tres meses", pero "afecta a las otras PCs que trabajan:
-- que el recorte sea reducido hasta que se lance la actualización". Por eso 30 días y sólo cerrados:
-- en P4 salen 185 conversaciones (≈14 %). Todo chat ABIERTO sigue, tenga la edad que tenga, y un
-- jugador que vuelve a escribir reabre o crea su chat y vuelve a aparecer.
-- Mismo cálculo que antes; el corte va al final. Foto previa: md5(pg_get_functiondef)
-- 74cf9e2e34958cb503f2960c5e73544c, proacl {=X/postgres,postgres=X/postgres}.
-- Vuelta atrás: chat-sesiones-sin-cerrados-viejos-vuelta-atras.sql

CREATE OR REPLACE FUNCTION public.panel_core_get_chat_sesiones_json(p_pc_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb;
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_pcs text[];
  v_out jsonb;
begin
  -- 4/10 · `fecha_ultimo` es la hora del último mensaje DEL JUGADOR (lo que el panel usa para
  -- decidir si hay algo sin leer), `updated_at` la última actividad de cualquiera, y `ultimo_de`
  -- dice de quién es el texto de adelanto. Antes devolvía el último mensaje de CUALQUIERA y el
  -- panel lo tomaba por mensaje nuevo del jugador (Juan, 4/10).
  -- 6/10 · Misma salida, sin el costo cuadrático: los mensajes de cada conversación se buscan por
  -- índice (tres ramas en vez de un OR) y en una sola pasada en lugar de tres. Comparado en jsonb
  -- contra la versión anterior en 13 oficinas. Respaldo: SQL_respaldo_chat_sesiones_20261006.sql.
  -- 6/11 · Sin los CERRADOS con más de 30 días sin actividad: NODO los procesaba cada 4 s.
  v_scope := public.nodo_resolver_oficina_scope(coalesce(p_pc_codigo,''));
  v_pcs := array_remove(array[
      v_pc,
      upper(trim(coalesce(v_scope->>'pc_codigo_compat',''))),
      upper(trim(coalesce(v_scope->>'oficina_id','')))], '');

  with ses as (
    select cs.*,
           coalesce(s1.id, s2.id) as sol_id, coalesce(s1.tipo, s2.tipo) as sol_tipo,
           coalesce(s1.monto, s2.monto) as sol_monto, coalesce(s1.estado, s2.estado) as sol_estado
    from public.chat_sesiones cs
    left join public.solicitudes s1 on s1.id = cs.solicitud_id
    left join lateral (
      select s.* from public.solicitudes s where s.chat_id::text = cs.chat_id order by s.id desc limit 1
    ) s2 on true
    where (v_pc = '' or upper(coalesce(cs.pc_codigo,'')) = any(v_pcs))
  ), base as (
    select cs.*, a.ultimo_texto, a.ultimo_msg_at, upper(coalesce(a.ultimo_tipo,'')) as ultimo_tipo,
           a.ultimo_usuario_at, coalesce(a.sin_leer,0) as sin_leer_calc
    from ses cs
    -- Los mensajes de la conversación: tres búsquedas por índice en vez de un OR que recorre todo.
    -- Cada rama excluye lo que ya trajo la anterior, así ningún mensaje se cuenta dos veces.
    left join lateral (
      select
        (array_agg(x.mensaje     order by x.created_at desc, x.id desc))[1] as ultimo_texto,
        (array_agg(x.created_at  order by x.created_at desc, x.id desc))[1] as ultimo_msg_at,
        (array_agg(x.tipo_emisor order by x.created_at desc, x.id desc))[1] as ultimo_tipo,
        (array_agg(x.created_at  order by x.created_at desc, x.id desc) filter (where x.es_usuario))[1] as ultimo_usuario_at,
        (count(*) filter (where x.es_usuario
                            and (coalesce(x.leido,false) = false or x.leido_operador_at is null)))::int as sin_leer
      from (
        select m.id, m.mensaje, m.created_at, m.tipo_emisor, m.leido, m.leido_operador_at,
               upper(coalesce(m.tipo_emisor,'')) = 'USUARIO' as es_usuario
          from public.chat_mensajes m
         where m.chat_id = cs.chat_id and coalesce(m.visible_operador,true)
        union all
        select m.id, m.mensaje, m.created_at, m.tipo_emisor, m.leido, m.leido_operador_at,
               upper(coalesce(m.tipo_emisor,'')) = 'USUARIO'
          from public.chat_mensajes m
         where m.conversacion_id = cs.id and coalesce(m.visible_operador,true)
           and m.chat_id is distinct from cs.chat_id
        union all
        select m.id, m.mensaje, m.created_at, m.tipo_emisor, m.leido, m.leido_operador_at,
               upper(coalesce(m.tipo_emisor,'')) = 'USUARIO'
          from public.chat_mensajes m
         where cs.sol_id is not null and m.solicitud_id = cs.sol_id and coalesce(m.visible_operador,true)
           and m.chat_id is distinct from cs.chat_id and m.conversacion_id is distinct from cs.id
      ) x
    ) a on true
  ), fin as (
    select b.*,
           greatest(coalesce(b.ultimo_msg_at,b.created_at), coalesce(b.ultimo_mensaje,b.created_at), b.created_at) as actividad
    from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.chat_id, 'chat_id', b.chat_id, 'sesion_id', b.id,
      'usuario', b.usuario, 'telefono', b.telefono, 'pc_codigo', b.pc_codigo,
      'estado', b.estado, 'solicitud_id', b.sol_id, 'sol_tipo', b.sol_tipo,
      'sol_monto', b.sol_monto, 'sol_estado', b.sol_estado,
      'sin_leer', b.sin_leer_calc,
      'ultimo_mensaje', coalesce(b.ultimo_texto,''),
      'ultimo_de', case when b.ultimo_tipo = 'USUARIO' then 'USUARIO'
                        when b.ultimo_tipo = '' then null
                        else 'OPERADOR' end,
      'created_at', b.created_at,
      'updated_at', b.actividad,
      'fecha_ultimo', coalesce(b.ultimo_usuario_at, b.created_at))
    order by b.actividad desc
  ), '[]'::jsonb)
  into v_out from fin b
  where not (upper(coalesce(b.estado,'')) = 'CERRADO' and b.actividad < now() - interval '30 days');

  return coalesce(v_out,'[]'::jsonb);
end;
$function$;
