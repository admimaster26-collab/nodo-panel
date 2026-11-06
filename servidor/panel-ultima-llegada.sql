-- panel_ultima_llegada: lo más nuevo que tiene el servidor para una oficina (6/11).
--
-- El semáforo de NODO decía "anda" porque el servidor contestaba, sin mirar si lo que contestaba
-- era lo último. Con esto el panel compara lo más nuevo que tiene en pantalla contra lo más nuevo
-- que hay acá, en las tres partes que importan: si el servidor tiene algo más nuevo y pasado un
-- margen el panel sigue sin tenerlo, el semáforo dice que no está llegando.
--
-- Devuelve, para la oficina:
--   solicitudes = la solicitud del Portal más nueva (id y hora). Es la que encabeza la bandeja:
--                 panel_v15_5_listar_solicitudes_portal trae siempre las 80 más nuevas.
--   chat        = la última actividad de las conversaciones de la oficina. Es la misma cuenta que
--                 hace panel_core_get_chat_sesiones_json para el `updated_at` de cada conversación
--                 (el FECHA_ULTIMO que guarda el panel): el mensaje visible más nuevo de cualquiera,
--                 el último_mensaje de la sesión o su creación. Comparado el 6/11 contra esa función
--                 en P1, P2, P3, P4, P5, P6, P9B y P11: la misma hora en las ocho.
--   historial   = la operación más nueva de historial_ops de los últimos 2 días, con los códigos
--                 de oficina que manda el panel (los de pcAliasesHist(), P4 = P4/PC4/SANCHEZ/...).
--
-- Sólo lee, y es liviana: la solicitud sale del índice idx_landing_sol_pcupper_fecha (una o dos
-- filas), el historial de idx_historial_ops_created_at acotado a 2 días, y el chat recorre
-- chat_sesiones (7 mil filas) y el índice de chat_mensajes por fecha. Medido el 6/11 en P4:
-- 12 ms en total. No toca el metadata de landing_solicitudes.
--
-- El panel la llama como mucho una vez por minuto y sólo con la oficina ya conocida.
-- Función nueva. Vuelta atrás: panel-ultima-llegada-vuelta-atras.sql

create or replace function public.panel_ultima_llegada(
  p_secret    text,
  p_pc_codigo text,
  p_hist_pcs  text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_pc    text := upper(trim(coalesce(p_pc_codigo, '')));
  v_scope jsonb;
  v_pcs   text[];
  v_hist  text[];
  v_sol   jsonb;
  v_chat  timestamptz;
  v_ops   jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok', false, 'motivo', 'SIN_OFICINA'); end if;

  select jsonb_build_object('id', s.id, 'at', s.created_at)
    into v_sol
    from public.landing_solicitudes s
   where upper(coalesce(s.pc_codigo, '')) = v_pc
     and coalesce(s.origen, '') = 'PORTAL_V16'
   order by s.created_at desc, s.id desc
   limit 1;

  -- Mismas oficinas que panel_core_get_chat_sesiones_json.
  v_scope := public.nodo_resolver_oficina_scope(v_pc);
  v_pcs := array_remove(array[
      v_pc,
      upper(trim(coalesce(v_scope->>'pc_codigo_compat', ''))),
      upper(trim(coalesce(v_scope->>'oficina_id', '')))], '');

  -- Los mensajes de una conversación se buscan por chat_id, por conversacion_id o por la solicitud
  -- atada, como en panel_core_get_chat_sesiones_json. Para el máximo no hace falta descontar
  -- repetidos: alcanza con que el mensaje sea de alguna conversación de la oficina.
  with sol_chat as (
    select s.chat_id, max(s.id) as id
      from public.solicitudes s
     where s.chat_id is not null
     group by s.chat_id
  ), ses as materialized (
    select cs.id, cs.chat_id, cs.created_at, cs.ultimo_mensaje, coalesce(s1.id, s2.id) as sol_id
      from public.chat_sesiones cs
      left join public.solicitudes s1 on s1.id = cs.solicitud_id
      left join sol_chat s2 on s2.chat_id = cs.chat_id
     where upper(coalesce(cs.pc_codigo, '')) = any(v_pcs)
  )
  select greatest(
      (select max(ses.created_at) from ses),
      (select max(ses.ultimo_mensaje) from ses),
      (select max(m.created_at)
         from public.chat_mensajes m
        where coalesce(m.visible_operador, true)
          and (m.chat_id in (select ses.chat_id from ses)
               or m.conversacion_id in (select ses.id from ses)
               or m.solicitud_id in (select ses.sol_id from ses where ses.sol_id is not null))))
    into v_chat;

  v_hist := coalesce((p_hist_pcs)[1:12], array[v_pc]);
  select jsonb_build_object('id', h.id, 'at', h.created_at)
    into v_ops
    from public.historial_ops h
   where h.pc_codigo = any(v_hist)
     and h.created_at > now() - interval '2 days'
   order by h.created_at desc, h.id desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'pc', v_pc,
    'solicitudes', v_sol,
    'chat', case when v_chat is null then null else jsonb_build_object('at', v_chat) end,
    'historial', v_ops);
end $function$;

revoke all on function public.panel_ultima_llegada(text, text, text[]) from public;
grant execute on function public.panel_ultima_llegada(text, text, text[]) to anon, authenticated, service_role;
