-- El jugador puede cancelar una solicitud que el operador SOLTÓ (10/11).
-- "Soltar" en NODO (v154pSoltarSolicitud) la devuelve a PENDIENTE con etapa SOLTADA_PANEL, pero
-- panel_v15_5_actualizar_solicitud_portal no borra tomada_por_operador_nombre: quedaba "tomada" para
-- siempre y el Portal decía "un operador ya está trabajando tu solicitud". Se arregla acá y no en la
-- función de NODO, así sirve para todas las versiones (2.1.5 incluida). Vuelta atrás:
-- cancelar-solicitud-soltada-vuelta-atras.sql.
CREATE OR REPLACE FUNCTION public.landing_cancelar_solicitud(p_solicitud_id bigint, p_usuario text, p_public_code text DEFAULT NULL::text, p_chat_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row  public.landing_solicitudes%rowtype;
  v_pc   text;
  v_u    text := lower(btrim(coalesce(p_usuario, '')));
begin
  if p_solicitud_id is null or v_u = '' then
    return jsonb_build_object('ok', false, 'motivo', 'faltan_datos');
  end if;

  select * into v_row from public.landing_solicitudes where id = p_solicitud_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_existe');
  end if;

  if lower(btrim(coalesce(v_row.usuario, ''))) <> v_u then
    return jsonb_build_object('ok', false, 'motivo', 'no_es_tuya');
  end if;

  -- La oficina se comprueba cuando el portal la manda (siempre lo hace en V16).
  if p_public_code is not null and btrim(p_public_code) <> '' then
    select r.pc_codigo into v_pc from public.landing_rutas_publicas r
     where r.public_code = btrim(p_public_code) limit 1;
    if v_pc is not null and upper(coalesce(v_row.pc_codigo,'')) <> upper(v_pc) then
      return jsonb_build_object('ok', false, 'motivo', 'otra_oficina');
    end if;
  end if;

  if upper(coalesce(v_row.estado, '')) not in ('PENDIENTE') then
    return jsonb_build_object('ok', false, 'motivo', 'ya_no_pendiente',
                              'estado', upper(coalesce(v_row.estado, '')));
  end if;

  if v_row.tomada_por_operador_nombre is not null
     and coalesce(v_row.metadata->>'etapa', '') <> 'SOLTADA_PANEL' then
    return jsonb_build_object('ok', false, 'motivo', 'tomada',
                              'operador', v_row.tomada_por_operador_nombre);
  end if;

  update public.landing_solicitudes
     set estado = 'CANCELADA',
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'cancelada_por', 'JUGADOR',
           'cancelada_at', now(),
           'cancelada_desde', 'portal',
           'estado_previo', upper(coalesce(v_row.estado, ''))
         ),
         updated_at = now()
   where id = p_solicitud_id;

  return jsonb_build_object('ok', true, 'solicitud_id', p_solicitud_id);
end
$function$;
