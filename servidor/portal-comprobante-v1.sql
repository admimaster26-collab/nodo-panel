-- Asocia el comprobante enviado desde el chat con la solicitud de CARGA existente.
-- No permite crear solicitudes ni modificar estados: sólo el jugador dueño puede
-- adjuntar una imagen a su propia solicitud pendiente.

create or replace function public.landing_portal_adjuntar_comprobante_v1(
  p_public_code text,
  p_usuario text,
  p_solicitud_id bigint,
  p_comprobante_url text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_pc text;
  v_usuario text := lower(btrim(coalesce(p_usuario, '')));
  v_url text := btrim(coalesce(p_comprobante_url, ''));
  v_id bigint;
begin
  if coalesce(btrim(p_public_code), '') = '' or v_usuario = '' or p_solicitud_id is null then
    raise exception using errcode='22023', message='PORTAL_COMPROBANTE_DATOS_INVALIDOS';
  end if;
  if v_url = '' or length(v_url) > 2048 or v_url !~ '^https://[^[:space:]]+$' then
    raise exception using errcode='22023', message='PORTAL_COMPROBANTE_URL_INVALIDA';
  end if;

  v_pc := public.landing_portal_v16_pc_from_code(p_public_code);
  if coalesce(btrim(v_pc), '') = '' then
    raise exception using errcode='42501', message='PORTAL_OFICINA_NO_AUTORIZADA';
  end if;

  update public.landing_solicitudes
     set comprobante_url = v_url,
         metadata = coalesce(metadata, '{}'::jsonb)
           || jsonb_build_object(
                'comprobante_url', v_url,
                'comprobante_origen', 'PORTAL_CHAT',
                'comprobante_adjuntado_at', now()
              )
   where id = p_solicitud_id
     and lower(btrim(coalesce(usuario, ''))) = v_usuario
     and upper(btrim(coalesce(pc_codigo, ''))) = upper(btrim(v_pc))
     and upper(btrim(coalesce(tipo, ''))) = 'CARGA'
     and upper(btrim(coalesce(estado, 'PENDIENTE'))) in
         ('PENDIENTE','NUEVA','EN_ESPERA','EN_REVISION','EN_PROCESO','ERROR_OPERATIVO');

  if not found then
    raise exception using errcode='P0002', message='PORTAL_COMPROBANTE_SOLICITUD_NO_ENCONTRADA';
  end if;

  select id into v_id
    from public.landing_solicitudes
   where id = p_solicitud_id;

  return jsonb_build_object(
    'ok', true,
    'solicitud_id', v_id,
    'comprobante_url', v_url
  );
end $$;

revoke all on function public.landing_portal_adjuntar_comprobante_v1(text,text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.landing_portal_adjuntar_comprobante_v1(text,text,bigint,text)
  to anon, authenticated;
