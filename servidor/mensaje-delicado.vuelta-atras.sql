-- Vuelta atrás de mensaje-delicado.sql: los dos disparadores como quedaron el 16/11 (bot-apagado-en-beta.sql).

CREATE OR REPLACE FUNCTION public.trg_chat_autorespuesta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reales text[] := array['P1','P2','P3','P4','P5','P6','P7'];
  v_ses record; v_pc text; r record; v_ahora timestamptz;
begin
  begin
    -- El mismo bot de siempre (soporte_auto_mensaje_v1), escuchando donde ahora caen los mensajes
    -- del portal nuevo. Antes vivía sobre landing_solicitudes y leía `mensaje_inicial`, que es
    -- donde dejaba el texto el portal viejo; con el nuevo sólo veía "Consulta desde portal".
    if upper(coalesce(new.tipo_emisor,'')) <> 'USUARIO' then return new; end if;
    if coalesce(btrim(new.mensaje),'') = '' then return new; end if;

    select cs.id, cs.usuario, cs.pc_codigo, cs.solicitud_id, cs.estado
      into v_ses from public.chat_sesiones cs where cs.chat_id = new.chat_id;
    if v_ses.id is null then return new; end if;
    if upper(coalesce(v_ses.estado,'')) = 'CERRADO' then return new; end if;

    -- Nunca por encima de una persona: si en esta conversación ya habló alguien que no es el
    -- jugador, el bot se calla. Una respuesta por conversación.
    if exists (select 1 from public.chat_mensajes m
                where m.chat_id = new.chat_id
                  and upper(coalesce(m.tipo_emisor,'')) <> 'USUARIO') then return new; end if;

    v_pc := upper(coalesce(v_ses.pc_codigo,''));
    if v_pc !~ '^P[0-9]+$' then return new; end if;
    -- 16/11: en una oficina con NODO beta contesta el chat autoasistido del Portal, nunca el bot.
    if public._soporte_bot_apagado(v_pc) then return new; end if;

    select * into r from public.soporte_auto_mensaje_v1(
      v_ses.pc_codigo, v_ses.usuario, new.mensaje, coalesce(new.created_at, now()));
    if r.mensaje is null then return new; end if;
    if not (v_pc = any (v_reales)) then return new; end if;
    if public._soporte_ya_dijo(v_pc, nodo_norm_usuario_v21(v_ses.usuario), r.caso, interval '3 minutes')
      then return new; end if;

    -- clock_timestamp() y NO now(): now() devuelve la hora de ARRANQUE de la transacción, y como
    -- este disparador corre dentro de la misma transacción que el mensaje del jugador, la
    -- respuesta quedaba con la hora EXACTA del mensaje al que contesta — al microsegundo. Eso
    -- deja el orden de la conversación en empate y hace imposible saber quién habló último por
    -- la hora. (Visto el 4/10 en noemiacdc: los dos mensajes a las 04:05:12.978902.)
    v_ahora := clock_timestamp();

    insert into public.chat_mensajes(chat_id, tipo_emisor, emisor, mensaje, operador_nombre, tipo, metadata, created_at)
    values (new.chat_id, 'OPERADOR', 'NODO', r.mensaje, 'NODO', 'TEXTO',
            jsonb_build_object('auto', true, 'caso', r.caso), v_ahora);

    update public.chat_sesiones set ultimo_mensaje = v_ahora where id = v_ses.id;

    if v_ses.solicitud_id is not null then
      update public.landing_solicitudes s
         set metadata = coalesce(s.metadata,'{}'::jsonb)
             || jsonb_build_object('auto_caso', r.caso, 'auto_respondido_at', v_ahora)
             || jsonb_build_object('chat_thread',
                  coalesce(s.metadata->'chat_thread','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                    'origen','OPERADOR', 'tipo','OPERADOR', 'operador','NODO', 'auto', true,
                    'usuario', v_ses.usuario, 'mensaje', r.mensaje,
                    'fecha', to_char(v_ahora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
       where s.id = v_ses.solicitud_id;
    end if;

    return new;
  exception when others then
    return new;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.trg_soporte_autorespuesta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reales  text[] := array['P1','P2','P3','P4','P5','P6','P7'];   -- acá contesta de verdad
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
    -- 16/11: en una oficina con NODO beta contesta el chat autoasistido del Portal, nunca el bot.
    if public._soporte_bot_apagado(v_pc) then return new; end if;

    select * into r
    from public.soporte_auto_mensaje_v1(
           new.pc_codigo, new.usuario, new.mensaje_inicial, coalesce(new.created_at, now()));

    -- ── ESPEJO: anota y no contesta ──────────────────────────────────────────
    if not (v_pc = any (v_reales)) then
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'auto_espejo', jsonb_build_object(
          'caso',        coalesce(r.caso, '(no contestaria)'),
          'mensaje',     r.mensaje,
          'evaluado_at', now()
        ));
      return new;
    end if;

    -- ── REAL ─────────────────────────────────────────────────────────────────
    -- Sin mensaje no se contesta, pero si hay un caso queda anotado. Asi DERIVAR_HUMANO
    -- (angustia / adiccion) deja rastro para que una persona lo tome, sin respuesta automatica.
    if r.mensaje is null then
      if r.caso is not null then
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('auto_caso', r.caso);
      end if;
      return new;
    end if;

    -- NO_REPETIR: el freno anti-repeticion existia solo para SALUDO y CIERRE. Sin el, alguien
    -- que manda dos mensajes seguidos recibe la MISMA respuesta dos veces (se vio el 26/08:
    -- "No vemos un pedido de carga" a los 24 segundos, el rechazo a los 48). Ahora aplica a
    -- todos los casos: si ya se dijo ESE caso a ESA persona hace menos de 3 minutos, no se
    -- repite. Se anota igual el caso para no perder la traza.
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
    return new;   -- nunca voltear el insert por un problema nuestro
  end;
end;
$function$;

drop function if exists public._soporte_mensaje_delicado(text);
