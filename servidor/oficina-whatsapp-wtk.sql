-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- EL NÚMERO DE CADA LÍNEA DE WTK · paso 1 de la rotación (13/11)
--
-- Qué hace: guarda el teléfono de cada línea de Whaticket en whaticket_lineas.numero, con un
-- único normalizador (nodo_wsp_e164) que deja todo en el formato que pide wa.me: dígitos,
-- 549 + código de área + número, sin el 0 ni el 15.
--
-- Por qué: hoy whaticket_lineas tiene oficina, id de línea, nombre, estado y cuándo se vio —
-- el número no está en ninguna parte, y la edge function whaticket-lineas lo tira al armar
-- `limpias` (se queda con id, name y status). Sin el número no se puede contestar ninguna de
-- las dos preguntas que hacen falta para rotar la línea del Portal:
--   · el número que tiene la página, ¿es una línea de WTK?
--   · si la línea del Portal se cae, ¿a cuál de las activas la cambio?
--
-- Un solo normalizador: la misma cuenta la hacía panel_oficina_whatsapp_registrar por su lado.
-- Si las dos puntas no normalizan igual, comparar el número del Portal contra las líneas de WTK
-- da falsos avisos. Por eso la regla queda en una función y las dos la llaman.
--
-- Dos columnas a propósito:
--   numero        normalizado, es el que se compara y el que se le pasa al Portal.
--   numero_crudo  los dígitos tal como los dio WTK. Si el normalizador no pudo con ellos
--                 (otro país, línea sin número, algo raro), numero queda nulo y el crudo
--                 permite decir "no se pudo leer" en vez de avisar que no coincide. Un número
--                 que no se pudo leer NO es un número que no coincide.
--
-- Un barrido que no trae el número no borra el que estaba (coalesce en el conflict): si Whaticket
-- deja de mandar el campo, la rotación sigue teniendo con qué trabajar.
--
-- Foto previa (13/11): whaticket_lineas = (pc_codigo, linea_id, nombre, estado, visto_at,
-- cambio_at). whaticket_lineas_registrar(text,jsonb) con md5 c9df014806e7990e6ee0b0eeaff77279
-- y proacl nulo (default). nodo_wsp_e164 no existe. WTK vivo en P2 (9 líneas/5 activas),
-- P3 (16/7), P4 (12/10) y P5 (13/5); último barrido 13/11 13:40.
-- Vuelta atrás: servidor/oficina-whatsapp-wtk-vuelta-atras.sql. Responsable: Juan.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ══ nodo_wsp_e164(p_raw text) → la única regla de formato
-- Acepta cómo lo escribe la gente (+54 9 223 670-0367, 0223 670 0367, 223 670 0367,
-- 542236700367, 5492236700367) y lo lleva siempre a 5492236700367. Un número de otro país sólo
-- entra escrito con + adelante. Devuelve null si no se puede afirmar que es un celular válido:
-- quien la llama decide qué hacer con eso, pero nunca recibe un número a medias.
create or replace function public.nodo_wsp_e164(p_raw text)
 returns text
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare
  v_raw text := btrim(coalesce(p_raw,''));
  v_dig text := coalesce(public.nodo_norm_telefono_v21(p_raw),'');
begin
  if v_raw = '' or v_dig = '' then return null; end if;

  if v_raw like '+%' and left(v_dig,2) <> '54' then
    -- Otro país, escrito completo con +: se guarda en dígitos (wa.me no lleva el +).
    if v_dig ~ '^[1-9][0-9]{7,14}$' then return v_dig; end if;
    return null;
  end if;

  -- Argentina: se sacan 54, 9 y 0 de adelante y quedan los 10 dígitos de área + número.
  -- Todo código de área empieza con 11, 2 o 3; lo demás es un 15 o un número incompleto.
  if left(v_dig,2) = '54' and length(v_dig) in (12,13) then v_dig := substr(v_dig,3); end if;
  if length(v_dig) = 11 and left(v_dig,1) in ('9','0')  then v_dig := substr(v_dig,2); end if;
  if v_dig ~ '^(11[0-9]{8}|[23][0-9]{9})$' then return '549' || v_dig; end if;
  return null;
end;
$function$;

comment on function public.nodo_wsp_e164(text) is
  'Teléfono → 549 + área + número en dígitos (formato wa.me). null si no es un celular válido. Única regla: la usan el monitor de líneas y el registro del WhatsApp de la oficina.';

-- ══ whaticket_lineas: dónde vive el número
alter table public.whaticket_lineas add column if not exists numero       text;
alter table public.whaticket_lineas add column if not exists numero_crudo text;

comment on column public.whaticket_lineas.numero       is 'Normalizado con nodo_wsp_e164: con este se compara y con este se rota.';
comment on column public.whaticket_lineas.numero_crudo is 'Los dígitos tal como los dio Whaticket. Si numero es nulo y este no, el número existe pero no se pudo leer.';

-- Para "¿este número es una línea de esta oficina?" sin recorrer la tabla.
create index if not exists whaticket_lineas_pc_numero_idx
  on public.whaticket_lineas (pc_codigo, numero) where numero is not null;

-- ══ whaticket_lineas_registrar(p_pc text, p_lineas jsonb)
-- Igual que la viva (md5 c9df0148…) salvo las tres líneas del número. Misma firma, mismo
-- retorno: la edge function y el cron no cambian. Si la edge function vieja sigue corriendo un
-- rato, manda las líneas sin 'number' y lo único que pasa es que el número no se actualiza.
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

    insert into public.whaticket_lineas (pc_codigo, linea_id, nombre, estado, numero, numero_crudo, visto_at, cambio_at)
    values (v_pc, r->>'id', r->>'name', r->>'status',
            public.nodo_wsp_e164(r->>'number'),
            nullif(public.nodo_norm_telefono_v21(r->>'number'),''),
            now(), now())
    on conflict (pc_codigo, linea_id) do update
      set nombre    = excluded.nombre,
          estado    = excluded.estado,
          -- Un barrido que no trajo el número no borra el que ya estaba.
          numero       = coalesce(excluded.numero,       public.whaticket_lineas.numero),
          numero_crudo = coalesce(excluded.numero_crudo, public.whaticket_lineas.numero_crudo),
          visto_at  = now(),
          -- cambio_at solo se mueve si el estado cambió
          cambio_at = case when public.whaticket_lineas.estado is distinct from excluded.estado
                           then now() else public.whaticket_lineas.cambio_at end;
  end loop;

  return query select v_n, v_c, v_caidas;
end;
$function$;
