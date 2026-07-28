-- ============================================================
-- NODO · FIX: las solicitudes SIN public_code ya no caen por default en P1.
--
-- PROBLEMA: landing_portal_v16_pc_from_code('') devuelve 'P1', así que todo ticket de
-- SOPORTE creado sin ruta resuelta terminaba en P1 (tickets de usuarios de otros agentes).
-- Además el blindaje de vínculo solo corría para CARGA/RETIRO: SOPORTE no validaba nada.
--
-- SOLUCIÓN: resolver el agente en 3 pasos y NUNCA inventar P1:
--   1) por public_code (camino normal, sin cambios)
--   2) si no vino public_code → por el HOST/subdominio que el portal manda en metadata.host
--      → el ticket cae en el agente del subdominio que el usuario está usando, y el operador
--        de ESA PC lo puede editar/validar.
--   3) si no se puede resolver → AGENTE_NO_RESUELTO (el portal muestra el mensaje claro)
--
-- La firma NO cambia (el host viaja en p_metadata) → no se rompe ninguna llamada existente
-- ni se crea una sobrecarga ambigua en PostgREST.
-- ============================================================

CREATE OR REPLACE FUNCTION public.landing_portal_v16_crear_solicitud(
  p_public_code text,
  p_usuario text,
  p_tipo text,
  p_monto numeric,
  p_titular text DEFAULT NULL::text,
  p_destino text DEFAULT NULL::text,
  p_mensaje text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text; v_tipo text; v_id bigint; v_meta jsonb; v_msg text; v_tel text;
  v_vinc jsonb; v_verdict text;
  v_code text; v_host text; v_byhost jsonb;
begin
  v_tipo := upper(trim(coalesce(p_tipo,'')));
  if coalesce(trim(p_usuario),'') = '' then raise exception 'USUARIO_REQUERIDO'; end if;
  if v_tipo not in ('CARGA','RETIRO','SOPORTE') then raise exception 'TIPO_INVALIDO'; end if;
  if v_tipo in ('CARGA','RETIRO') and (p_monto is null or p_monto <= 0) then raise exception 'MONTO_INVALIDO'; end if;

  -- ── Resolución del AGENTE ───────────────────────────────────────────────
  v_code := nullif(trim(coalesce(p_public_code,'')),'');

  -- 1) Por public_code: primero contra la tabla de rutas (fuente de verdad, sin default),
  --    y si no aparece ahí se cae al resolver histórico (compatibilidad con códigos legacy).
  if v_code is not null then
    select r.pc_codigo into v_pc
      from public.landing_rutas_publicas r
     where lower(coalesce(r.public_code,'')) = lower(v_code)
       and coalesce(r.activo,true) is true
     limit 1;
    if coalesce(trim(coalesce(v_pc,'')),'') = '' then
      v_pc := public.landing_portal_v16_pc_from_code(v_code);
    end if;
  else
    -- 2) SIN public_code → resolver por el host/subdominio que manda el portal en metadata.host.
    --    Acá estaba la fuga: antes pc_from_code('') devolvía P1 y el ticket caía en P1.
    v_host := nullif(trim(coalesce(p_metadata->>'host','')),'');
    if v_host is not null then
      v_byhost := public.landing_resolver_ruta_por_host(v_host);
      if coalesce((v_byhost->>'ok')::boolean, false) then
        v_pc   := v_byhost->>'pc_codigo';
        v_code := v_byhost->>'public_code';   -- queda registrado en la metadata
      end if;
    end if;
  end if;

  -- 3) Sin agente resoluble → NO inventamos P1.
  if coalesce(trim(coalesce(v_pc,'')),'') = '' then
    raise exception 'AGENTE_NO_RESUELTO';
  end if;

  -- BLINDAJE: CARGA/RETIRO exige vínculo válido (server-side, no solo el front).
  -- SOPORTE queda libre a propósito: es el canal para que el operador valide/corrija al usuario.
  if v_tipo in ('CARGA','RETIRO') then
    v_tel := coalesce(p_metadata->>'telefono','');
    v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, v_tel);
    v_verdict := upper(coalesce(v_vinc->>'verdict',''));
    if v_verdict not in ('ACCESO','NUEVO','PENDIENTE') then
      raise exception 'VINCULO_NO_VALIDO: %', coalesce(v_vinc->>'mensaje','No autorizado para operar');
    end if;
  end if;

  v_msg := coalesce(nullif(trim(p_mensaje),''),
           case when v_tipo='CARGA'  then 'Solicitud de CARGA: $'||coalesce(p_monto::text,'')||' · Titular: '||coalesce(p_titular,'')
                when v_tipo='RETIRO' then 'Solicitud de RETIRO: $'||coalesce(p_monto::text,'')||' · Destino: '||coalesce(p_destino,'')||' · Titular: '||coalesce(p_titular,'')
                else 'Consulta desde portal V16' end);

  v_meta := coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object(
              'public_code', v_code,
              'pc_codigo',   v_pc,
              'titular',     p_titular,
              'destino',     p_destino,
              'origen_portal','PORTAL_V16',
              'comprobante_obligatorio', false,
              'agente_por_host', (nullif(trim(coalesce(p_public_code,'')),'') is null),  -- trazabilidad
              'created_by_rpc','landing_portal_v16_crear_solicitud');

  insert into public.landing_solicitudes (pc_codigo, origen, usuario, tipo, monto, mensaje_inicial, estado, metadata, created_at, updated_at)
  values (v_pc, 'PORTAL_V16', trim(p_usuario), v_tipo, p_monto, v_msg, 'PENDIENTE', v_meta, now(), now())
  returning id into v_id;

  return jsonb_build_object('ok',true,'id',v_id,'solicitud_id',v_id,'pc_codigo',v_pc,
    'usuario',trim(p_usuario),'tipo',v_tipo,'monto',p_monto,'estado','PENDIENTE','metadata',v_meta);
end; $function$;


-- ============================================================
-- VERIFICACIÓN (opcional, correr después)
-- ============================================================
-- a) Debe fallar con AGENTE_NO_RESUELTO (antes creaba el ticket en P1):
-- select public.landing_portal_v16_crear_solicitud('', 'test_sin_ruta', 'SOPORTE', 0, null, null, 'prueba', '{}'::jsonb);

-- b) Debe crear el ticket en P2 resolviendo por el subdominio 'club':
-- select public.landing_portal_v16_crear_solicitud('', 'test_por_host', 'SOPORTE', 0, null, null, 'prueba',
--        jsonb_build_object('host','club.tu-dominio.com'));
