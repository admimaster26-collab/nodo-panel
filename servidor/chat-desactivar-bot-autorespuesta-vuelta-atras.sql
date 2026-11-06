-- Vuelta atrás de chat-desactivar-bot-autorespuesta.sql.
-- Restaura soporte_auto_mensaje_v1 y los triggers trg_soporte_autorespuesta y trg_chat_autorespuesta.

CREATE OR REPLACE FUNCTION public.soporte_auto_mensaje_v1(p_pc text, p_usuario text, p_texto text, p_cuando timestamp with time zone DEFAULT now())
 RETURNS TABLE(caso text, mensaje text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc    text := upper(btrim(coalesce(p_pc,'')));
  v_u     text := nodo_norm_usuario_v21(p_usuario);
  v_texto text := btrim(coalesce(p_texto,''));
  v_norm  text := lower(unaccent(btrim(coalesce(p_texto,''))));
  v_saludo boolean; v_cierre boolean; v_reclamo boolean; v_prefiere text;
  v_comprobante boolean; v_aviso_pago boolean; v_quiere_cargar boolean;
  v_pide_usuario boolean; v_pide_validar boolean;
  o_tipo text; o_estado text; o_monto_r text; o_min int; o_motivo text;
  v_monto text; v_plata boolean; v_apertura text;
  v_derivar boolean; v_problema boolean; v_saldo boolean; v_demora boolean;
  v_limpio text := btrim(regexp_replace(lower(unaccent(btrim(coalesce(p_texto,'')))), '[^a-z0-9]+', ' ', 'g'));
begin
  if v_pc = '' or coalesce(v_u,'') = '' then return; end if;

  v_derivar := v_norm ~ 'adicc|ludopat|no puedo parar|me arruin|soy pobre|no tengo para (comer|comprar)'
              or v_norm ~ 'me quiero (matar|morir)|no doy mas|estoy desesperad|por favor te (lo )?pido';
  if v_derivar then
    caso := 'DERIVAR_HUMANO';
    return next; return;
  end if;

  v_comprobante := v_texto ~ 'Imagen adjunta';
  v_aviso_pago := v_norm ~ 'ya (te |le |se )?(carg|transfer|tranfer|pas|envi|deposit|mand)'
               or v_norm ~ '^(te |le )?(carg|transfer|tranfer|envi|mand|pas)[a-z]* (te |le )?[0-9$]'
               or v_norm ~ '^(enviado|transferido|cargado|listo el pago|pagado)$'
               or v_norm ~ 'no me figura|no se me acredit|hice la transferencia|ise la transferencia'
               or v_norm ~ '^(ya |ahi |recien )?(cargue|carge|transferi|tranferi|pague|deposite|envie|mande)\M'
               or v_norm ~ '(ya |recien )?(ise|hice) (una |la )?(transferencia|tranferencia|carga)'
               or v_norm ~ '^(la|lo) (envie|mande|pase)\M';
  v_quiere_cargar := not v_aviso_pago and (
                       v_norm ~ 'para cargar|quiero cargar|una recarga|quiero recargar'
                    or v_norm ~ 'pasame.*(cbu|alias|numero|num)|mandame.*(cbu|alias)'
                    or v_norm ~ '^(cbu|alias|cargar|carga|recarga)[\s!.?¿]*$'
                    or v_norm ~ 'donde (transfiero|deposito|mando)|a que (cuenta|cbu)' );

  v_pide_usuario := v_norm ~ 'quiero registrarme|apodo\s*:|me haces un usuario|hacerme un usuario';
  v_pide_validar := v_norm ~ 'quiero validar mi acceso|validar mi acceso';

  v_saludo := v_norm ~ '^(hola+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|holis)\M';
  v_cierre := v_limpio ~ '^((ok|oka|okey|okis|listo|lsito|dale|perfecto|barbaro|genial|joya|buenisimo|excelente|gracias|muchas|mil|de|una|bueno|buena|si|sisi|ahi|esta|estamos|ahora|ya|todo|bien|tal|cual|claro|clarito|obvio|listorti)( |$))+$';
  v_reclamo := v_norm ~ 'no me (pag|acredit|carg|lleg|entr|deposit)'
            or v_norm ~ 'demor|tarda|cuanto falta|todavia|aun no|hace rato|falta mucho|sigo esperando'
            or v_norm ~ 'rechaz'
            or v_norm ~ '(pedi|solicite|mande|hice) (un |el |la )?(retir|cobro)|acabo de pedir';
  v_prefiere := case
    when v_norm ~ 'retir|cobr|me pag|pagan|pagaron' then 'RETIRO'
    when v_norm ~ 'carg|acredit|deposit|ficha'      then 'CARGA'
    else null end;

  if v_comprobante or v_aviso_pago then
    v_apertura := case when v_comprobante then 'Recibimos tu comprobante. ' else '' end;
    select o.estado, coalesce(o.metadata->>'monto',''),
           floor(extract(epoch from (now()-o.created_at))/60)::int,
           coalesce(o.metadata->>'motivo', o.metadata->>'motivo_rechazo')
      into o_estado, o_monto_r, o_min, o_motivo
    from public.landing_solicitudes o
    where o.pc_codigo=v_pc and nodo_norm_usuario_v21(o.usuario)=v_u and o.tipo='CARGA'
      and (   (o.estado='PENDIENTE'  and o.created_at >= p_cuando - interval '3 hours')
           or (o.estado='ACREDITADA' and o.created_at >= p_cuando - interval '15 minutes')
           or (o.estado='RECHAZADA'  and o.created_at >= p_cuando - interval '30 minutes') )
    order by (o.estado='PENDIENTE') desc, o.created_at desc limit 1;

    v_monto := case when coalesce(o_monto_r,'') ~ '^[0-9]+(\.[0-9]+)?$'
                    then '$' || replace(to_char(round(o_monto_r::numeric),'FM999,999,999'),',','.') end;

    if o_estado = 'PENDIENTE' then
      caso := case when v_comprobante then 'COMPROBANTE' else 'AVISO_PAGO' end;
      mensaje := v_apertura || 'Vemos tu carga' || coalesce(' de '||v_monto,'')
               || ' registrada hace ' || o_min || ' minutos. Un operador la está verificando.';
    elsif o_estado = 'ACREDITADA' then
      caso := case when v_comprobante then 'COMPROBANTE_YA_ACREDITADA' else 'AVISO_PAGO_ACREDITADA' end;
      mensaje := v_apertura || 'Tu carga' || coalesce(' de '||v_monto,'')
               || ' ya fue acreditada hace ' || o_min || ' minutos. ¡Buena suerte!';
    elsif o_estado = 'RECHAZADA' then
      caso := case when v_comprobante then 'COMPROBANTE_RECHAZADA' else 'AVISO_PAGO_RECHAZADA' end;
      mensaje := v_apertura || _soporte_texto_rechazo('CARGA', v_monto, o_min, o_motivo);
    else
      caso := case when v_comprobante then 'COMPROBANTE_SIN_SOLICITUD' else 'AVISO_PAGO_SIN_SOLICITUD' end;
      mensaje := v_apertura
               || 'No vemos un pedido de carga reciente tuyo, así que todavía no está en la fila. '
               || 'Entrá a Cargar en el menú de abajo y poné el monto que transferiste — con eso ya te lo procesamos.';
    end if;
    return next; return;
  end if;

  if v_pide_usuario then
    caso := 'PIDE_USUARIO';
    mensaje := 'Recibimos tu pedido. Un operador te va a crear el usuario y te escribe por acá.';
    return next; return;
  end if;
  if v_pide_validar then
    caso := 'PIDE_VALIDAR';
    mensaje := 'Recibimos tus datos. Un operador los verifica y te habilita el acceso desde acá.';
    return next; return;
  end if;

  if v_quiere_cargar then
    caso := 'QUIERE_CARGAR';
    mensaje := 'Para cargar, entrá a Cargar en el menú de abajo: ahí te aparecen los datos '
             || 'para transferir y el lugar para avisarnos el monto. Cuando lo hagas, '
             || 'mandá el comprobante por acá.';
    return next; return;
  end if;

  v_plata := v_texto ~ '^[\?\.\!¿ ]+$' or v_reclamo or v_saludo;
  if v_plata then
    select o.tipo, o.estado, coalesce(o.metadata->>'monto',''),
           floor(extract(epoch from (now()-o.created_at))/60)::int,
           coalesce(o.metadata->>'motivo', o.metadata->>'motivo_rechazo')
      into o_tipo, o_estado, o_monto_r, o_min, o_motivo
    from public.landing_solicitudes o
    where o.pc_codigo=v_pc and nodo_norm_usuario_v21(o.usuario)=v_u
      and o.tipo in ('CARGA','RETIRO')
      and o.created_at <= p_cuando and o.created_at >= p_cuando - interval '2 hours'
      and ( ( o.estado='PENDIENTE' and case o.tipo
                when 'CARGA'  then now()-o.created_at between interval '2 minutes' and interval '30 minutes'
                when 'RETIRO' then now()-o.created_at between interval '3 minutes' and interval '60 minutes'
                else false end )
         or ( o.estado='RECHAZADA' and now()-o.created_at <= interval '2 hours' ) )
    order by (o.tipo = v_prefiere) desc nulls last, (o.estado='PENDIENTE') desc, o.created_at desc limit 1;

    if o_tipo is not null and v_prefiere is not null and o_tipo <> v_prefiere then o_tipo := null; end if;

    if o_tipo is not null then
      v_monto := case when coalesce(o_monto_r,'') ~ '^[0-9]+(\.[0-9]+)?$'
                      then '$' || replace(to_char(round(o_monto_r::numeric),'FM999,999,999'),',','.') end;
      if o_estado = 'PENDIENTE' then
        caso := 'ESTADO_' || o_tipo;
        mensaje := case o_tipo when 'CARGA' then 'Vemos tu carga' else 'Vemos tu retiro' end
                 || coalesce(' de '||v_monto,'')
                 || case o_tipo when 'CARGA' then ' registrada hace ' else ' registrado hace ' end
                 || o_min || ' minutos. Sigue en proceso, apenas se acredite te avisamos.';
      else
        caso := 'RECHAZO_' || o_tipo;
        mensaje := _soporte_texto_rechazo(o_tipo, v_monto, o_min, o_motivo);
      end if;
      return next; return;
    end if;
  end if;

  v_problema := (v_limpio ~ 'no me deja|no puedo (entrar|cargar|retirar|acceder|ingresar|jugar)'
              or v_limpio ~ 'no (anda|funciona|abre|carga la|me abre)|se (me )?cerro|se (traba|cuelga)'
              or v_limpio ~ 'no se ve|no aparece nada|me (saca|echa) (de|del) ')
             and v_limpio !~ 'no me (lleg|acredit|pag|carg|deposit|figur|entr)';
  if v_problema then
    caso := 'PROBLEMA_TECNICO';
    mensaje := 'Vemos que estás teniendo un problema con la aplicación. Un operador te escribe por acá '
             || 'para ayudarte. Si podés, mandanos una captura de lo que te aparece.';
    return next; return;
  end if;

  v_saldo := v_norm ~ '(mi|el) saldo|cuanto (tengo|me queda)|ver.*saldo|no me figura el saldo';
  if v_saldo then
    caso := 'VER_SALDO';
    mensaje := 'El saldo lo ves dentro de la plataforma, en tu cuenta. Si no te figura lo que esperabas, '
             || 'contanos el monto y lo revisamos.';
    return next; return;
  end if;

  v_demora := v_norm ~ 'cuanto (tarda|demora|falta)|cuanto tiempo|en cuanto se acredit|tardan mucho';
  if v_demora then
    caso := 'DEMORA';
    mensaje := 'Las cargas se acreditan en pocos minutos y los retiros normalmente dentro de la media hora. '
             || 'Si ya hiciste el pedido y pasó más de eso, avisanos y lo miramos.';
    return next; return;
  end if;

  if v_norm ~ '^(hola+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|holis|hol)[\s!.,¡¿?]*$'
     and not _soporte_ya_dijo(v_pc, v_u, 'SALUDO', interval '5 minutes') then
    caso := 'SALUDO';
    mensaje := 'Hola ' || btrim(coalesce(p_usuario,'')) || ', ¿en qué te podemos ayudar?';
    return next; return;
  end if;

  if v_cierre and not _soporte_ya_dijo(v_pc, v_u, 'CIERRE', interval '10 minutes') then
    caso := 'CIERRE';
    mensaje := '¡Gracias a vos! Cualquier cosa escribinos por acá.';
    return next; return;
  end if;

  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_soporte_autorespuesta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reales  text[] := array['P1','P2','P3','P4','P5','P6','P7'];
  v_pc      text;
  r         record;
  v_thread  jsonb;
  v_ya      boolean;
begin
  begin
    if new.tipo <> 'SOPORTE' then return new; end if;
    if coalesce(btrim(new.usuario),'') = '' then return new; end if;
    if new.metadata ? 'auto_respondido_at' then return new; end if;
    if new.metadata ? 'auto_espejo'        then return new; end if;

    v_pc := upper(coalesce(new.pc_codigo,''));
    if v_pc !~ '^P[0-9]+$' then return new; end if;

    select * into r
    from public.soporte_auto_mensaje_v1(
           new.pc_codigo, new.usuario, new.mensaje_inicial, coalesce(new.created_at, now()));

    if not (v_pc = any (v_reales)) then
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'auto_espejo', jsonb_build_object(
          'caso',        coalesce(r.caso, '(no contestaria)'),
          'mensaje',     r.mensaje,
          'evaluado_at', now()
        ));
      return new;
    end if;

    if r.mensaje is null then
      if r.caso is not null then
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('auto_caso', r.caso);
      end if;
      return new;
    end if;

    if public._soporte_ya_dijo(v_pc, nodo_norm_usuario_v21(new.usuario), r.caso, interval '3 minutes') then
      new.metadata := coalesce(new.metadata,'{}'::jsonb)
        || jsonb_build_object('auto_caso', r.caso, 'auto_omitido', 'repetido');
      return new;
    end if;

    v_thread := coalesce(new.metadata->'chat_thread', '[]'::jsonb);
    select exists(
      select 1 from jsonb_array_elements(v_thread) m
      where (m->>'solicitud_id') = new.id::text
        and upper(coalesce(m->>'origen','')) = 'USUARIO'
    ) into v_ya;

    if not v_ya then
      v_thread := v_thread || jsonb_build_array(jsonb_build_object(
        'origen','USUARIO', 'tipo','USUARIO',
        'usuario', new.usuario,
        'mensaje', coalesce(new.mensaje_inicial,''),
        'fecha',   to_char(coalesce(new.created_at, now()) at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'solicitud_id', new.id));
    end if;

    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object('auto_respondido_at', now(), 'auto_caso', r.caso)
      || jsonb_build_object('chat_thread', v_thread || jsonb_build_array(
           jsonb_build_object(
             'origen','OPERADOR', 'tipo','OPERADOR', 'operador','NODO', 'auto',true,
             'usuario', new.usuario, 'mensaje', r.mensaje,
             'fecha', to_char((coalesce(new.created_at, now()) + interval '1 second') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'solicitud_id', new.id)));

    return new;
  exception when others then
    return new;
  end;
end;
$function$;

CREATE TRIGGER trg_soporte_autorespuesta BEFORE INSERT ON public.landing_solicitudes
  FOR EACH ROW EXECUTE FUNCTION trg_soporte_autorespuesta();

