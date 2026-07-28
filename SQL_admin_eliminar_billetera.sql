-- ============================================================
-- NODO · ADMI · RPC para ELIMINAR una billetera desde el admi
-- Misma validación de sesión y alcance por PC que admin_cambiar_estado_billetera.
-- Borrado REAL. Si la billetera tiene movimientos/historial (FK), NO la borra:
-- devuelve ok=false con mensaje claro (mejor pausarla que romper la contabilidad).
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_eliminar_billetera(p_session_token text, p_billetera_id bigint)
 RETURNS TABLE(ok boolean, mensaje text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope record;
  v_pc text;
  v_b record;
begin
  -- 1) Validar sesión de admin (idéntico a admin_cambiar_estado_billetera)
  select *
  into v_scope
  from public.panel_validar_admin_session(p_session_token)
  limit 1;

  -- 2) Buscar la billetera
  select *
  into v_b
  from public.billeteras b
  where b.id = p_billetera_id
  limit 1;

  if not found then
    raise exception 'Billetera no encontrada';
  end if;

  -- 3) Control de alcance por PC (idéntico al modelo)
  if not coalesce(v_scope.puede_todas, false) then
    v_pc := upper(trim(coalesce(v_scope.pc_codigo, '')));

    if upper(coalesce(v_b.pc_codigo, '')) <> v_pc then
      raise exception 'No podés eliminar billeteras de otra PC';
    end if;
  end if;

  -- 4) Borrado real, protegido contra claves foráneas.
  --    Si la billetera está referenciada (movimientos, historial, etc.), no se borra:
  --    se avisa para que en su lugar se pause (así no se corta la contabilidad).
  begin
    delete from public.billeteras b where b.id = p_billetera_id;
  exception
    when foreign_key_violation then
      return query select false,
        'La billetera tiene movimientos/historial asociados: no se puede eliminar. Pausala en su lugar.'::text;
      return;
  end;

  return query select true, 'Billetera eliminada'::text;
end;
$function$;

-- Permisos: igual que las demás RPC admin (ajustá el rol si tu proyecto usa otro).
-- GRANT EXECUTE ON FUNCTION public.admin_eliminar_billetera(text, bigint) TO anon, authenticated;
