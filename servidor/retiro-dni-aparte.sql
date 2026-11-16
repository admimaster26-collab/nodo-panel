-- El DNI del retiro, con su PROPIO switch por oficina (16/11/2026).
-- Hasta hoy, retiro_instrumentos_oficinas.habilitado prendia todo junto: los caminos nuevos del retiro
-- y el pedido de DNI. El 13/11 Juan decidio que el DNI ya no se le pide al jugador, pero que el switch
-- de la oficina queda. Esto los separa:
--   habilitado = los caminos nuevos del retiro (cuenta destino validada por el cajero, avisos, etc.)
--   pide_dni   = ademas, pedirle el DNI al jugador. Apagado por defecto.
-- Corre despues de retiro-instrumentos-portal.sql y retiro-dni-interruptor.sql.

alter table public.retiro_instrumentos_oficinas add column if not exists pide_dni boolean not null default false;
comment on column public.retiro_instrumentos_oficinas.pide_dni is
  'Switch aparte del DNI en el retiro (16/11/2026). Con habilitado andan los caminos nuevos; con pide_dni, ademas, se pide el DNI.';

create or replace function public.landing_portal_retiro_contexto_v1(p_public_code text, p_usuario text, p_telefono text, p_host text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_pc text; v_u text := lower(trim(coalesce(p_usuario,''))); v_vinc jsonb; v_verdict text;
  v_inst public.retiro_instrumentos; v_last record; v_on boolean; v_dni_on boolean;
begin
  v_pc := public._retiro_inst_pc2(p_public_code, p_host);
  if v_pc is not null then
    select coalesce(o.habilitado, false), coalesce(o.pide_dni, false) into v_on, v_dni_on
      from public.retiro_instrumentos_oficinas o where o.pc_codigo = v_pc;
  end if;
  if v_u = '' or not coalesce(v_on, false) then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', false);
  end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  v_verdict := upper(coalesce(v_vinc->>'verdict',''));
  if v_verdict not in ('ACCESO','NUEVO','PENDIENTE') then raise exception 'VINCULO_NO_VALIDO'; end if;
  if v_verdict = 'ACCESO' then
    select * into v_inst from public.retiro_instrumentos i
     where i.pc_codigo = v_pc and i.usuario = v_u and i.estado = 'VALIDADO' order by i.validado_at desc limit 1;
  end if;
  select s.id, s.estado, s.monto, s.updated_at, s.created_at,
         s.metadata->'retiro_instrumento_v1'->>'estado' as validacion, coalesce(s.metadata->>'motivo_rechazo','') as codigo
    into v_last
    from public.retiro_instrumentos i
    join public.landing_solicitudes s on s.id = i.solicitud_id
   where i.pc_codigo = v_pc and i.usuario = v_u
   order by s.id desc limit 1;
  return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true,
    'pide_dni', coalesce(v_dni_on, false),
    'instrumento', case when v_inst.id is null then null else jsonb_build_object(
      'id', v_inst.id,
      'destino', upper(regexp_replace(btrim(v_inst.destino), '[[:space:]]+', '', 'g')),
      'titular', upper(regexp_replace(btrim(coalesce(v_inst.titular,'')), '[[:space:]]+', ' ', 'g')),
      'validado_at', v_inst.validado_at) end,
    'ultima_solicitud', case when v_last.id is null then null else jsonb_build_object(
      'id', v_last.id, 'estado_validacion', v_last.validacion, 'estado', v_last.estado, 'monto', v_last.monto,
      'actualizada_at', v_last.updated_at, 'creada_at', v_last.created_at, 'codigo', v_last.codigo) end);
end $function$;

create or replace function public.landing_portal_retiro_crear_v1(p_public_code text, p_usuario text, p_telefono text, p_host text, p_monto numeric, p_titular text, p_destino text, p_dni text, p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_pc text; v_u text := lower(trim(coalesce(p_usuario,''))); v_on boolean; v_dni_on boolean; v_vinc jsonb;
  v_dest text := trim(coalesce(p_destino,'')); v_norm text; v_tit text := upper(regexp_replace(btrim(coalesce(p_titular,'')), '[[:space:]]+', ' ', 'g'));
  v_inst public.retiro_instrumentos; v_estado text; v_dni text; v_hash text; v_meta jsonb; v_res jsonb; v_id bigint; v_ctl jsonb;
  v_alerta text; v_edad int; v_edad_previa int; v_alertas text[];
begin
  v_pc := public._retiro_inst_pc2(p_public_code, p_host);
  if v_pc is null then raise exception 'AGENTE_NO_RESUELTO'; end if;
  select coalesce(o.habilitado, false), coalesce(o.pide_dni, false) into v_on, v_dni_on
    from public.retiro_instrumentos_oficinas o where o.pc_codigo = v_pc;
  if not coalesce(v_on, false) then return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', false); end if;
  if v_u = '' or p_monto is null or p_monto <= 0 or v_tit = '' then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DATOS_INVALIDOS');
  end if;
  v_norm := public._retiro_inst_norm_destino(v_dest);
  if length(v_dest) < 6 or v_norm = '' then
    return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DESTINO_INVALIDO');
  end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  if upper(coalesce(v_vinc->>'verdict','')) not in ('ACCESO','NUEVO','PENDIENTE') then raise exception 'VINCULO_NO_VALIDO'; end if;
  perform pg_advisory_xact_lock(hashtextextended('retiro:' || v_pc || ':' || v_u, 0));

  select * into v_inst from public.retiro_instrumentos
   where pc_codigo = v_pc and usuario = v_u and destino_norm = v_norm for update;
  if v_inst.id is not null and v_inst.estado = 'VALIDADO'
     and upper(regexp_replace(btrim(coalesce(v_inst.titular,'')), '[[:space:]]+', ' ', 'g')) = v_tit then
    v_estado := 'VALIDADO';
  else
    -- El DNI se pide SOLO si la oficina prendio pide_dni. Sin eso, la cuenta nueva queda PENDIENTE y el
    -- cajero confirma que este a nombre del jugador, sin DNI de por medio (Juan, 13/11 y 16/11).
    if coalesce(v_dni_on, false) then
      v_dni := public._retiro_inst_norm_dni(p_dni);
      if v_dni is null then
        return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DNI_REQUERIDO');
      end if;
      v_ctl := public._retiro_inst_dni_control(v_dni);
      if not coalesce((v_ctl->>'valido')::boolean, false) then
        return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'DNI_REQUERIDO');
      end if;
      select coalesce(array_agg(x), '{}') into v_alertas from jsonb_array_elements_text(coalesce(v_ctl->'alertas', '[]'::jsonb)) x;
      if coalesce((v_ctl->>'preguntar_edad')::boolean, false) then
        v_edad := nullif(regexp_replace(coalesce(p_metadata->>'edad_declarada', ''), '[^0-9]', '', 'g'), '')::int;
        if v_edad is null then
          return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'EDAD_REQUERIDA');
        end if;
        if v_edad < 10 or v_edad > 110 then
          return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'EDAD_INVALIDA');
        end if;
        if v_edad < 18 then
          insert into public.usuarios_portal_eventos(pc_codigo, usuario, evento, nota, origen)
          values (v_pc, v_u, 'MENOR_DECLARADO', 'Declaró ' || v_edad || ' años al pedir un retiro', 'PORTAL');
          return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'MENOR_DE_EDAD');
        end if;
        v_alertas := v_alertas || case when v_edad > (v_ctl->>'edad_max')::int then 'EDAD_NO_COINCIDE' else 'EDAD_COINCIDE' end;
        select nullif(regexp_replace(e.nota, '[^0-9]', '', 'g'), '')::int into v_edad_previa
          from public.usuarios_portal_eventos e
         where upper(e.pc_codigo) = v_pc and lower(e.usuario) = v_u and e.evento = 'MENOR_DECLARADO'
         order by e.created_at desc limit 1;
        if v_edad_previa is not null then v_alertas := v_alertas || 'EDAD_CAMBIO'::text; end if;
      end if;
      v_hash := public._retiro_inst_hash(v_dni);
      if exists (select 1 from public.retiro_instrumentos r where r.pc_codigo = v_pc and r.usuario = v_u and v_hash = any(r.dni_rechazados)) then
        v_alertas := v_alertas || 'YA_RECHAZADO'::text;
      end if;
    end if;
    v_alerta := nullif(array_to_string(v_alertas, ','), '');
    if v_inst.id is not null and v_inst.estado = 'PENDIENTE' and exists (
         select 1 from public.landing_solicitudes s
          where s.id = v_inst.solicitud_id
            and s.metadata->'retiro_instrumento_v1'->>'estado' = 'PENDIENTE'
            and upper(coalesce(s.estado,'')) in ('PENDIENTE','EN_REVISION','EN_PROCESO')) then
      return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true, 'error_code', 'RETIRO_EN_VALIDACION');
    end if;
    if v_inst.id is null then
      insert into public.retiro_instrumentos(pc_codigo, usuario, destino, destino_norm, titular, dni_hash, dni_fin, dni_alerta, dni_anio_estimado, dni_edad_declarada, dni_edad_previa)
      values (v_pc, v_u, v_dest, v_norm, btrim(p_titular), v_hash, right(v_dni, 3), v_alerta, (v_ctl->>'anio_estimado')::int, v_edad, v_edad_previa)
      returning * into v_inst;
    elsif coalesce(v_dni_on, false) then
      update public.retiro_instrumentos
         set destino = v_dest, titular = btrim(p_titular), dni_hash = v_hash, dni_fin = right(v_dni, 3),
             dni_alerta = v_alerta, dni_anio_estimado = (v_ctl->>'anio_estimado')::int, dni_edad_declarada = v_edad, dni_edad_previa = v_edad_previa,
             estado = 'PENDIENTE', intentos_operador = 0, validado_at = null, validado_por = null, updated_at = now()
       where id = v_inst.id returning * into v_inst;
    else
      -- Sin DNI: cambia la cuenta y vuelve a PENDIENTE; lo que se sabia del DNI queda como estaba.
      update public.retiro_instrumentos
         set destino = v_dest, titular = btrim(p_titular),
             estado = 'PENDIENTE', intentos_operador = 0, validado_at = null, validado_por = null, updated_at = now()
       where id = v_inst.id returning * into v_inst;
    end if;
    v_estado := 'PENDIENTE';
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_meta
    from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) e where e.key !~* '(dni|cuil|cuit|documento)';
  v_meta := v_meta || jsonb_build_object('retiro_instrumento_v1', jsonb_build_object(
    'estado', v_estado, 'instrumento_id', v_inst.id, 'primera_validacion', v_estado = 'PENDIENTE'));
  v_res := public.landing_portal_v16_crear_solicitud(p_public_code, p_usuario, 'RETIRO', p_monto, p_titular, p_destino,
    'Solicitud de RETIRO: $' || p_monto::text || ' · Destino: ' || p_destino || ' · Titular: ' || p_titular, v_meta);
  if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'RETIRO_SOLICITUD_NO_CONFIRMADA'; end if;
  v_id := coalesce((v_res->>'solicitud_id')::bigint, (v_res->>'id')::bigint);
  if v_id is null then raise exception 'RETIRO_SOLICITUD_NO_CONFIRMADA'; end if;
  update public.retiro_instrumentos set solicitud_id = v_id where id = v_inst.id;
  if v_estado = 'PENDIENTE' then
    insert into public.retiro_instrumento_eventos(instrumento_id, solicitud_id, evento) values (v_inst.id, v_id, 'DECLARADO');
  end if;
  return jsonb_build_object('ok', true, 'contract', 'retiro.instrumentos.v1', 'enabled', true,
    'solicitud_id', v_id, 'estado_validacion', v_estado, 'validado_at', v_inst.validado_at);
end $function$;
