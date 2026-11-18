-- Vuelta atrás de retiro-cuenta-nueva-sin-dni.sql: las dos funciones como estaban el 18/11 y sin la nueva.

CREATE OR REPLACE FUNCTION public.panel_retiro_instrumento(p_secret text, p_solicitud_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k record; v_row public.retiro_instrumentos;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  select * into k from public._retiro_inst_de_solicitud(p_solicitud_id);
  if k.pc_codigo is null then return jsonb_build_object('ok', false, 'motivo', 'SOLICITUD_NO_EXISTE'); end if;
  select * into v_row from public.retiro_instrumentos
   where pc_codigo = k.pc_codigo and usuario = k.usuario and destino_norm = k.destino_norm;
  return jsonb_build_object('ok', true,
    'estado', case when v_row.id is null or (v_row.estado = 'PENDIENTE' and v_row.dni_hash is null) then 'SIN_DECLARAR' else v_row.estado end,
    'destino', v_row.destino, 'titular', v_row.titular,
    'validado_at', v_row.validado_at, 'validado_por', v_row.validado_por,
    'rechazado_at', v_row.rechazado_at,
    'intentos_restantes', greatest(0, 2 - coalesce(v_row.intentos_operador, 0)),
    'alertas', to_jsonb(array_remove(string_to_array(coalesce(v_row.dni_alerta, ''), ','), '')),
    'alerta_edad', v_row.dni_alerta, 'anio_estimado', v_row.dni_anio_estimado,
    'edad_declarada', v_row.dni_edad_declarada, 'edad_previa', v_row.dni_edad_previa,
    'edad_estimada', case when v_row.dni_anio_estimado is null then null else extract(year from now())::int - v_row.dni_anio_estimado end,
    'edad_min', case when v_row.dni_anio_estimado is null then null else greatest(extract(year from now())::int - v_row.dni_anio_estimado - 3, 0) end,
    'edad_max', case when v_row.dni_anio_estimado is null then null else extract(year from now())::int - v_row.dni_anio_estimado + 3 end,
    'otras_validadas', coalesce((
      select jsonb_agg(jsonb_build_object('destino', o.destino, 'titular', o.titular,
               'dni_fin', o.dni_fin, 'validado_at', o.validado_at) order by o.validado_at desc)
      from public.retiro_instrumentos o
      where o.pc_codigo = k.pc_codigo and o.usuario = k.usuario and o.estado = 'VALIDADO'
        and o.id is distinct from v_row.id), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.panel_retiro_instrumento_rechazar(p_secret text, p_solicitud_id bigint, p_operador text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k record; v_row public.retiro_instrumentos; v_op text := nullif(trim(coalesce(p_operador,'')), '');
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  select * into k from public._retiro_inst_de_solicitud(p_solicitud_id);
  if k.pc_codigo is null then return jsonb_build_object('ok', false, 'motivo', 'SOLICITUD_NO_EXISTE'); end if;
  select * into v_row from public.retiro_instrumentos
   where pc_codigo = k.pc_codigo and usuario = k.usuario and destino_norm = k.destino_norm for update;
  if v_row.id is null or (v_row.estado = 'PENDIENTE' and v_row.dni_hash is null) then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  if v_row.estado = 'VALIDADO' then return jsonb_build_object('ok', false, 'motivo', 'YA_VALIDADO'); end if;
  if v_row.estado <> 'RECHAZADO' then
    update public.retiro_instrumentos
       set estado = 'RECHAZADO', dni_rechazados = array_append(dni_rechazados, dni_hash), dni_hash = null,
           rechazado_por = v_op, rechazado_at = now(), intentos_operador = 0, solicitud_id = p_solicitud_id, updated_at = now()
     where id = v_row.id;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'RECHAZADO', v_op);
  end if;
  perform public._retiro_inst_marcar(p_solicitud_id, 'RECHAZADO', jsonb_build_object('code', 'TITULARIDAD_NO_CONFIRMADA'));
  return jsonb_build_object('ok', true, 'estado', 'RECHAZADO');
end $function$;

drop function if exists public.panel_retiro_instrumento_confirmar_titular(text,bigint,text);
