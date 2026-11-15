-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- VUELTA ATRÁS de servidor/oficina-whatsapp-wtk.sql (13/11)
--
-- Deja whaticket_lineas_registrar exactamente como estaba antes del cambio: la definición de
-- acá es la que devolvió pg_get_functiondef el 13/11 (md5 c9df014806e7990e6ee0b0eeaff77279).
--
-- Las columnas NO se borran. Un drop column mientras la edge function nueva sigue mandando el
-- número hace fallar el barrido entero y la oficina se queda sin monitor de líneas; y una
-- columna de más no molesta a nadie. Si hay que sacarlas de verdad, primero se vuelve atrás la
-- edge function y recién después se corre lo que está comentado al final.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.whaticket_lineas_registrar(p_pc text, p_lineas jsonb)
 RETURNS TABLE(lineas integer, cambios integer, caidas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc,'')));
  r jsonb; v_antes text;
  v_n int := 0; v_c int := 0; v_caidas int := 0;
begin
  if v_pc = '' then raise exception 'PC obligatoria'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_lineas,'[]'::jsonb))
  loop
    v_n := v_n + 1;

    select estado into v_antes from public.whaticket_lineas
    where pc_codigo = v_pc and linea_id = r->>'id';

    if v_antes is distinct from (r->>'status') then
      v_c := v_c + 1;
      if coalesce(r->>'status','') <> 'CONNECTED' then v_caidas := v_caidas + 1; end if;

      insert into public.whaticket_lineas_historial
        (pc_codigo, linea_id, nombre, estado_antes, estado_ahora)
      values (v_pc, r->>'id', r->>'name', v_antes, r->>'status');
    end if;

    insert into public.whaticket_lineas (pc_codigo, linea_id, nombre, estado, visto_at, cambio_at)
    values (v_pc, r->>'id', r->>'name', r->>'status', now(), now())
    on conflict (pc_codigo, linea_id) do update
      set nombre    = excluded.nombre,
          estado    = excluded.estado,
          visto_at  = now(),
          -- cambio_at solo se mueve si el estado cambió
          cambio_at = case when public.whaticket_lineas.estado is distinct from excluded.estado
                           then now() else public.whaticket_lineas.cambio_at end;
  end loop;

  return query select v_n, v_c, v_caidas;
end;
$function$;

-- drop function if exists public.nodo_wsp_e164(text);
-- drop index  if exists public.whaticket_lineas_pc_numero_idx;
-- alter table public.whaticket_lineas drop column if exists numero;
-- alter table public.whaticket_lineas drop column if exists numero_crudo;
