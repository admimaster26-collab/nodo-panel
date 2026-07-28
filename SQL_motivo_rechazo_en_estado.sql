-- ============================================================
-- NODO · Mostrar el MOTIVO del rechazo en el portal (pantalla Estado)
-- El panel ya manda el motivo al rechazar (actualizarSolicitudPortal → p_metadata.motivo).
-- Falta que landing_estado_solicitud_segura lo DEVUELVA para que el portal lo muestre.
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- ── PASO 1 · VERIFICAR dónde queda el motivo ────────────────────────────────
-- Confirmá que landing_solicitudes tiene columna `metadata` (jsonb) y que el motivo
-- del rechazo quedó guardado ahí como {"motivo": "..."}.
select id, estado, tipo, metadata->>'motivo' as motivo_guardado, metadata
from public.landing_solicitudes
where upper(estado) in ('RECHAZADA','CANCELADA')
order by updated_at desc
limit 5;
--
-- ✅ Si en `motivo_guardado` ves el texto que puso el operador → seguí al PASO 2.
-- ⚠️ Si `metadata` NO trae el motivo (o no existe la columna), avisame: hay que ajustar
--    panel_v15_5_actualizar_solicitud_portal para que persista p_metadata.motivo. NO corras el PASO 2.


-- ── PASO 2 · RPC que devuelve el motivo cuando el estado es rechazado ────────
-- Idéntica a la actual, PERO en el circuito Portal (landing_solicitudes) devuelve en `mensaje`
-- el motivo del rechazo (en vez del 'OK' fijo). En cualquier otro estado sigue devolviendo 'OK'.
-- No cambia la firma → es CREATE OR REPLACE (no hace falta DROP).
CREATE OR REPLACE FUNCTION public.landing_estado_solicitud_segura(p_solicitud_id bigint, p_chat_id bigint, p_chat_token text)
 RETURNS TABLE(ok boolean, solicitud_id bigint, estado text, tipo text, mensaje text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sol record; v_estado text; v_tipo text; v_updated timestamptz; v_msg text;
begin
  if p_solicitud_id is null then
    return query select false, null::bigint, null::text, null::text, 'Solicitud inválida'::text, null::timestamptz;
    return;
  end if;

  -- 1) Circuito Portal V16 (landing_solicitudes) PRIMERO.
  select ls.id, ls.estado, ls.tipo, ls.updated_at, ls.created_at, ls.metadata
    into v_sol from public.landing_solicitudes ls where ls.id = p_solicitud_id limit 1;
  if found then
    v_estado := upper(coalesce(v_sol.estado, 'PENDIENTE'));
    v_tipo := upper(coalesce(v_sol.tipo, 'CARGA'));
    v_updated := coalesce(v_sol.updated_at, v_sol.created_at, now());
    -- Motivo del rechazo → el portal lo muestra en la pantalla de Estado.
    v_msg := 'OK';
    if v_estado in ('RECHAZADA','CANCELADA','ERROR','ERROR_OPERATIVO') then
      v_msg := coalesce(
                 nullif(trim(v_sol.metadata->>'motivo'), ''),
                 nullif(trim(v_sol.metadata->>'observacion'), ''),
                 nullif(trim(v_sol.metadata->>'motivo_rechazo'), ''),
                 'OK');
    end if;
    return query select true, p_solicitud_id, v_estado, v_tipo, v_msg, v_updated;
    return;
  end if;

  -- 2) Fallback: circuito viejo (solicitudes).
  select s.id, s.estado, s.tipo, s.updated_at, s.created_at
    into v_sol from public.solicitudes s where s.id = p_solicitud_id limit 1;
  if found then
    v_estado := upper(coalesce(v_sol.estado, 'PENDIENTE'));
    v_tipo := upper(coalesce(v_sol.tipo, 'CARGA'));
    v_updated := coalesce(v_sol.updated_at, v_sol.created_at, now());
    return query select true, p_solicitud_id, v_estado, v_tipo, 'OK'::text, v_updated;
    return;
  end if;

  return query select false, p_solicitud_id, null::text, null::text, 'Solicitud no encontrada'::text, null::timestamptz;
end;
$function$;
