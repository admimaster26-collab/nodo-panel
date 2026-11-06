-- Negociación dinámica de capacidades beta (compatible con acceso.beta_clientes y nodo_beta.beta_clientes).
-- Anuncia únicamente las capacidades cuyos contratos públicos ya están instalados en el servidor.

create or replace function public.nodo_beta_capacidades_v1(
  p_token text,
  p_pc_codigo text,
  p_build text default null,
  p_activate boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_pc text;
  v_active_contract text;
  v_active_build text;
  v_last_seen timestamptz;
  v_caps jsonb;
begin
  v_id := acceso.autorizar(p_token, p_pc_codigo);

  if p_activate then
    if p_build is null or p_build !~ '^[A-Za-z0-9._+/-]{1,128}$' then
      raise exception using errcode='22023', message='BETA_BUILD_REQUIRED';
    end if;
    if to_regclass('acceso.beta_clientes') is not null then
      execute 'update acceso.beta_clientes set active_build=$1, active_contract=''nodo.beta.v1'', activated_at=now(), last_seen=now() where id=$2'
        using p_build, v_id;
    elsif to_regclass('nodo_beta.beta_clientes') is not null then
      execute 'update nodo_beta.beta_clientes set active_build=$1, active_contract=''nodo.beta.v1'', activated_at=now(), last_seen=now() where id=$2'
        using p_build, v_id;
    end if;
  end if;

  if to_regclass('acceso.beta_clientes') is not null then
    execute 'select pc_codigo, active_contract, active_build, last_seen from acceso.beta_clientes where id=$1'
      into v_pc, v_active_contract, v_active_build, v_last_seen using v_id;
  elsif to_regclass('nodo_beta.beta_clientes') is not null then
    execute 'select pc_codigo, active_contract, active_build, last_seen from nodo_beta.beta_clientes where id=$1'
      into v_pc, v_active_contract, v_active_build, v_last_seen using v_id;
  else
    raise exception using errcode='42P01', message='BETA_CLIENTS_TABLE_MISSING';
  end if;

  -- La existencia del contrato habilita negociación; no certifica datos ni UI.
  v_caps := '[]'::jsonb
    || case when to_regprocedure('public.nodo_beta_chat_lista_v1(text,text,text,text,integer,bigint)') is not null
            then jsonb_build_array('chat.list.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_chat_mensajes_v1(text,text,text,integer,bigint)') is not null
            then jsonb_build_array('chat.messages.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_chat_leido_v1(text,text,text,bigint[])') is not null
            then jsonb_build_array('chat.read.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_chat_enviar_v1(text,text,text,text,text,text,uuid)') is not null
            then jsonb_build_array('chat.send.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_salud_v1(text,text,jsonb,text)') is not null
            then jsonb_build_array('health.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.landing_beta_chat_leer_v1(bigint,text,integer,bigint)') is not null
            then jsonb_build_array('portal.seen.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_perfil_v1(text,text,text)') is not null
             and to_regprocedure('public.nodo_beta_perfil_detalle_v1(text,text,text,integer,jsonb)') is not null
            then jsonb_build_array('perfil.summary.v1','perfil.detail.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_perfil_identidad_v1(text,text,text,integer,jsonb)') is not null
            then jsonb_build_array('perfil.identity.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_persistencia_sync_v1(text,text,text,text,jsonb)') is not null
             and to_regprocedure('public.nodo_beta_persistencia_leer_v1(text,text,text,text,text,integer,jsonb)') is not null
            then jsonb_build_array('persistence.local.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_historial_v1(text,text,jsonb,integer,jsonb)') is not null
            then jsonb_build_array('historial.filters.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_bandeja_v1(text,text,jsonb,integer,jsonb)') is not null
            then jsonb_build_array('bandeja.queue.v1') else '[]'::jsonb end
    || case when to_regprocedure('public.nodo_beta_nexo_export_v1(text,text,integer,jsonb)') is not null
            then jsonb_build_array('nexo.export.v1') else '[]'::jsonb end;

  return jsonb_build_object(
    'ok', true,
    'contract', 'nodo.beta.v1',
    'capabilities', v_caps,
    'scope', jsonb_build_object('pc_codigo', v_pc),
    'active', coalesce(v_active_contract = 'nodo.beta.v1' and v_last_seen > now() - interval '5 minutes', false),
    'build', v_active_build,
    'lease_seconds', 300,
    'limits', jsonb_build_object('list', 100, 'messages', 100, 'ack', 100, 'health', 32, 'historial', 200, 'bandeja', 200, 'persistence', 200)
  );
end $$;

revoke all on function public.nodo_beta_capacidades_v1(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.nodo_beta_capacidades_v1(text,text,text,boolean) to anon,authenticated;

