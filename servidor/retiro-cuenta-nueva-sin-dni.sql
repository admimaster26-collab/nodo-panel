-- Cuenta de cobro nueva con el DNI apagado: la confirma el cajero, sin DNI.
--
-- Revisión del 18/11 (otra IA, para Noelia y Juan): con pide_dni = false la cuenta nueva queda PENDIENTE,
-- pero panel_retiro_instrumento la devolvía como SIN_DECLARAR: NODO pagaba sin abrir ninguna ventana,
-- nadie la confirmaba nunca y el Portal le decía al jugador "Verificando titularidad" para siempre.
-- El diseño que aprobó Juan (13/11 y 16/11, ver retiro-dni-aparte.sql) es que el cajero confirme que la
-- cuenta está a nombre del jugador, sin DNI de por medio. Faltaba eso:
--   · panel_retiro_instrumento devuelve PENDIENTE_SIN_DNI (NODO abre la ventana para confirmar).
--   · panel_retiro_instrumento_confirmar_titular (nueva): el cajero confirma → VALIDADO, queda anotado quién.
--   · panel_retiro_instrumento_rechazar acepta también la cuenta sin DNI ("no es suya").
-- Oficinas con el camino nuevo al 18/11: P1 y P4 (habilitado, pide_dni apagado). 0 cuentas pendientes.
-- Vuelta atrás: servidor/retiro-cuenta-nueva-sin-dni.vuelta-atras.sql.

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
    -- 18/11: PENDIENTE sin DNI ya no es SIN_DECLARAR: la tiene que confirmar el cajero.
    'estado', case when v_row.id is null then 'SIN_DECLARAR'
                   when v_row.estado = 'PENDIENTE' and v_row.dni_hash is null then 'PENDIENTE_SIN_DNI'
                   else v_row.estado end,
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

CREATE OR REPLACE FUNCTION public.panel_retiro_instrumento_confirmar_titular(p_secret text, p_solicitud_id bigint, p_operador text)
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
  if v_row.id is null then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  if v_row.estado = 'VALIDADO' then
    perform public._retiro_inst_marcar(p_solicitud_id, 'VALIDADO', jsonb_build_object('validado_at', v_row.validado_at));
    return jsonb_build_object('ok', true, 'estado', 'VALIDADO', 'validado_at', v_row.validado_at, 'ya_validado', true);
  end if;
  if v_row.estado = 'RECHAZADO' then return jsonb_build_object('ok', false, 'motivo', 'RECHAZADO'); end if;
  -- Si el jugador sí dejó un DNI, se valida comparándolo (panel_retiro_instrumento_validar), no a ojo.
  if v_row.dni_hash is not null then return jsonb_build_object('ok', false, 'motivo', 'USAR_DNI'); end if;
  update public.retiro_instrumentos
     set estado = 'VALIDADO', validado_por = v_op, validado_at = now(), solicitud_id = p_solicitud_id,
         intentos_operador = 0, updated_at = now()
   where id = v_row.id returning * into v_row;
  insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
  values (v_row.id, p_solicitud_id, 'VALIDADO', v_op);   -- la tabla sólo acepta 4 eventos; "sin DNI" queda en la solicitud
  perform public._retiro_inst_marcar(p_solicitud_id, 'VALIDADO',
    jsonb_build_object('validado_at', v_row.validado_at, 'validado_por', v_op, 'sin_dni', true));
  return jsonb_build_object('ok', true, 'estado', 'VALIDADO', 'validado_at', v_row.validado_at);
end $function$;
comment on function public.panel_retiro_instrumento_confirmar_titular(text,bigint,text) is
  'El cajero confirma que la cuenta de cobro nueva está a nombre del jugador, sin DNI (pide_dni apagado). 18/11.';

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
  -- 18/11: una cuenta PENDIENTE sin DNI también se puede rechazar ("no es suya").
  if v_row.id is null then return jsonb_build_object('ok', false, 'motivo', 'SIN_DECLARAR'); end if;
  if v_row.estado = 'VALIDADO' then return jsonb_build_object('ok', false, 'motivo', 'YA_VALIDADO'); end if;
  if v_row.estado <> 'RECHAZADO' then
    update public.retiro_instrumentos
       set estado = 'RECHAZADO',
           dni_rechazados = case when dni_hash is null then dni_rechazados else array_append(dni_rechazados, dni_hash) end,
           dni_hash = null,
           rechazado_por = v_op, rechazado_at = now(), intentos_operador = 0, solicitud_id = p_solicitud_id, updated_at = now()
     where id = v_row.id;
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento, operador)
    values (v_row.id, p_solicitud_id, 'RECHAZADO', v_op);
  end if;
  perform public._retiro_inst_marcar(p_solicitud_id, 'RECHAZADO', jsonb_build_object('code', 'TITULARIDAD_NO_CONFIRMADA'));
  return jsonb_build_object('ok', true, 'estado', 'RECHAZADO');
end $function$;
