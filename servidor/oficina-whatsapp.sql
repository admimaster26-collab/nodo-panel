-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHATSAPP DE LA OFICINA · un solo lugar que lo escribe (2/11)
--
-- Qué hace: panel_oficina_whatsapp_registrar(p_secret, p_pc, p_numero) guarda la línea de WhatsApp
-- de una oficina en landing_rutas_publicas.whatsapp_numero. NODO la llama con el número que la
-- oficina tiene cargado en Agentes › Integraciones (el del wa.me de la página de juego).
--
-- Por qué: "No me acuerdo el usuario" deja de contestarse en el chat del Portal (ahí cualquiera que
-- sepa tu teléfono sacaba tu usuario). El Portal ahora abre WhatsApp a la línea de la oficina con el
-- pedido ya escrito, y el operador le contesta al número que escribió. El Portal lee esa línea con
-- landing_resolver_ruta_publica, que ya devuelve whatsapp_numero; hoy la tienen 10 de 14 oficinas y
-- el último cambio es del 9/10. Plan: C:\Users\juan\.claude\plans\vast-jingling-pony.md
--
-- Formato que guarda: sólo dígitos, 549 + código de área + número, sin el 0 ni el 15
-- (5491123456789). Es el que ya tienen todas las filas cargadas y el que pide wa.me para un celular
-- argentino. Acepta cómo lo escribe la gente (+54 9 11 2345-6789, 011 2345 6789, 11 2345 6789,
-- 541123456789) y lo lleva a ese formato. Un número de otro país sólo entra escrito con + adelante
-- y se guarda en dígitos. Vacío no borra: un lector que no encontró el número no puede dejar a la
-- oficina sin botón. Borrarlo sigue siendo cosa de admin_general_guardar_ruta.
--
-- Secreto, search_path y "no-auth": igual que panel_lineas_estado y panel_acceso_link_crear
-- (public._panel_data_auth). El cambio queda en panel_operativo_auditoria con el número anterior,
-- el nuevo y el operador que tenía el panel abierto, una fila por ruta tocada. Si el número no
-- cambió no escribe nada. Quien cambia esta línea decide adónde le escriben los jugadores: por eso
-- queda quién fue.
--
-- Foto previa (2/11): la función no existe (to_regprocedure nulo; ninguna función con "whatsapp").
-- landing_rutas_publicas sin triggers, RLS activo sin políticas, dueño postgres.
-- Vuelta atrás: servidor/oficina-whatsapp-vuelta-atras.sql. Responsable: Juan.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.panel_oficina_whatsapp_registrar(p_secret text, p_pc text, p_numero text, p_operador text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pc        text := upper(btrim(coalesce(p_pc,'')));
  v_raw       text := btrim(coalesce(p_numero,''));
  v_dig       text := coalesce(public.nodo_norm_telefono_v21(p_numero),'');
  v_num       text;
  v_rutas     integer;
  v_cambiadas integer;
  v_anterior  text;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then
    return jsonb_build_object('ok',false,'motivo','SIN_OFICINA','mensaje','Falta la oficina.');
  end if;
  if v_raw = '' then
    return jsonb_build_object('ok',false,'motivo','SIN_NUMERO',
      'mensaje','Falta el número de WhatsApp de la oficina.');
  end if;

  if v_raw like '+%' and left(v_dig,2) <> '54' then
    -- Otro país, escrito completo con +: se guarda en dígitos (wa.me no lleva el +).
    if v_dig ~ '^[1-9][0-9]{7,14}$' then v_num := v_dig; end if;
  else
    -- Argentina: se sacan 54, 9 y 0 de adelante y quedan los 10 dígitos de área + número.
    -- Todo código de área empieza con 11, 2 o 3; lo demás es un 15 o un número incompleto.
    if left(v_dig,2) = '54' and length(v_dig) in (12,13) then v_dig := substr(v_dig,3); end if;
    if length(v_dig) = 11 and left(v_dig,1) in ('9','0') then v_dig := substr(v_dig,2); end if;
    if v_dig ~ '^(11[0-9]{8}|[23][0-9]{9})$' then v_num := '549' || v_dig; end if;
  end if;

  if v_num is null then
    return jsonb_build_object('ok',false,'motivo','NUMERO_INVALIDO',
      'mensaje','El número de WhatsApp de la oficina no es válido. Tiene que tener código de área y número, sin el 0 ni el 15. Ejemplo: 11 2345 6789.');
  end if;

  -- Una escritura a la vez por oficina: si dos paneles llegan juntos, el segundo ve el número ya
  -- guardado y contesta que no hubo cambio.
  perform 1 from public.landing_rutas_publicas r where upper(btrim(r.pc_codigo)) = v_pc for update;
  get diagnostics v_rutas = row_count;
  if v_rutas = 0 then
    return jsonb_build_object('ok',false,'motivo','OFICINA_SIN_PORTAL',
      'mensaje','La oficina '||v_pc||' no tiene portal cargado. Avisá a soporte.');
  end if;

  with antes as (
    select r.id, r.whatsapp_numero as anterior, r.activo
      from public.landing_rutas_publicas r
     where upper(btrim(r.pc_codigo)) = v_pc
       and r.whatsapp_numero is distinct from v_num
  ), cambio as (
    update public.landing_rutas_publicas r
       set whatsapp_numero = v_num, updated_at = now()
      from antes a
     where r.id = a.id
    returning r.id, a.anterior, a.activo
  ), registro as (
    insert into public.panel_operativo_auditoria(pc_codigo, operador, accion, entidad, entidad_id, valor_anterior, valor_nuevo, metadata)
    select v_pc, nullif(btrim(coalesce(p_operador,'')),''), 'WHATSAPP_OFICINA', 'RUTA_PUBLICA', c.id,
           jsonb_build_object('whatsapp_numero', c.anterior),
           jsonb_build_object('whatsapp_numero', v_num),
           jsonb_build_object('origen', 'panel_oficina_whatsapp_registrar')
      from cambio c
    returning 1
  )
  select count(*), (array_agg(c.anterior order by c.activo desc nulls last, c.id))[1]
    into v_cambiadas, v_anterior
    from cambio c;

  if v_cambiadas = 0 then
    return jsonb_build_object('ok',true,'cambio',false,'pc',v_pc,'whatsapp_numero',v_num);
  end if;
  return jsonb_build_object('ok',true,'cambio',true,'pc',v_pc,'whatsapp_numero',v_num,
    'anterior',v_anterior,'rutas',v_cambiadas);
end;
$function$;

-- El panel llama con la clave publicable (rol anon) y el secreto; nadie más.
revoke all on function public.panel_oficina_whatsapp_registrar(text,text,text,text) from public;
grant execute on function public.panel_oficina_whatsapp_registrar(text,text,text,text) to anon, authenticated, service_role;
