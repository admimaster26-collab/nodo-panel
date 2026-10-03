-- Puente del canal de chat hacia la bandeja que TODAS las PCs leen.  (Juan, 3/10/2026)
--
-- El problema: la 2.1.4 -- la version instalada en las 14 oficinas -- arma la lista de chats
-- desde la bandeja de solicitudes, leyendo metadata.chat_thread. No sabe leer chat_sesiones.
-- El portal nuevo manda la consulta al canal de chat y la deja suelta, sin solicitud. Resultado:
-- el mensaje se guarda bien, con el sello de la oficina, y NADIE lo ve. Verificado con los
-- mensajes de pruebasan del 3/10 a las 08:35 ("llega?" / "en efecto no llega").
--
-- Decision de Juan: que los mensajes viajen por el canal que todas las PCs ya toman, con tal de
-- tenerlo mapeado; las cargas y retiros siguen por el suyo, que la 2.1.4 ya recibe.
--
-- El arreglo es chico porque medio puente ya existia: landing_enviar_mensaje_v2 YA copia cada
-- mensaje a metadata.chat_thread de la solicitud... pero solo si la conversacion esta atada a
-- una (if v_sol_id is not null). Yo la abria con p_solicitud_id = null, asi que esa copia nunca
-- corria. Entonces: se abre la conversacion atada a UNA solicitud.
--
-- UNA por conversacion. NO una por mensaje -- ese era el bug viejo, el que dejo 25 solicitudes
-- de un solo reclamo y 3.925 acumuladas en la red.
--
-- Van marcadas con metadata.puente_chat = true para poder encontrarlas y sacarlas cuando todas
-- las PCs esten actualizadas. Para listarlas:
--   select id, pc_codigo, usuario, created_at from landing_solicitudes
--    where metadata->>'puente_chat' = 'true' order by created_at desc;

create or replace function public.landing_chat_abrir_v3(
  p_usuario      text,
  p_telefono     text,
  p_public_code  text,
  p_solicitud_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pc text; v_id bigint; v_token text; v_chat text; v_sol bigint;
begin
  if coalesce(btrim(p_usuario),'') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_requerido');
  end if;

  v_pc := public._landing_resolver_pc_privado(p_public_code);
  if coalesce(btrim(coalesce(v_pc,'')),'') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'agente_no_resuelto');
  end if;

  -- Solo por ESTA consulta: si el portal reintenta, no se abren dos.
  if p_solicitud_id is not null then
    select cs.id, cs.chat_public_token into v_id, v_token
      from public.chat_sesiones cs
     where cs.solicitud_id = p_solicitud_id
     order by cs.id desc limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'chat_id', v_id, 'chat_token', v_token,
                                'nueva', false, 'solicitud_id', p_solicitud_id);
    end if;
  end if;

  v_sol := p_solicitud_id;

  -- El puente: una solicitud por conversacion, para que la vean las versiones viejas.
  if v_sol is null then
    insert into public.landing_solicitudes
      (pc_codigo, origen, usuario, telefono, tipo, monto, estado, prioridad, metadata)
    values
      (upper(v_pc), 'PORTAL_V16', btrim(p_usuario),
       nullif(btrim(coalesce(p_telefono,'')),''),
       'SOPORTE', 0, 'PENDIENTE', 100,
       jsonb_build_object(
         'tipo',           'SOPORTE',
         'usuario',        btrim(p_usuario),
         'telefono',       btrim(coalesce(p_telefono,'')),
         'pc_codigo',      upper(v_pc),
         'public_code',    coalesce(p_public_code,''),
         'origen_portal',  'PORTAL_V16',
         'created_by_rpc', 'landing_chat_abrir_v3',
         'puente_chat',    true,
         'canal',          'CHAT',
         'chat_thread',    '[]'::jsonb))
    returning id into v_sol;
  end if;

  v_token := md5(random()::text || clock_timestamp()::text || coalesce(p_usuario,''));
  v_chat  := 'CHAT_' || md5(random()::text || clock_timestamp()::text || coalesce(p_usuario,''));

  insert into public.chat_sesiones
    (chat_id, usuario, telefono, pc_codigo, solicitud_id, estado, chat_public_token, created_at)
  values
    (v_chat, btrim(p_usuario), btrim(coalesce(p_telefono,'')), upper(v_pc),
     v_sol, 'ABIERTO', v_token, now())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'chat_id', v_id, 'chat_token', v_token,
                            'nueva', true, 'solicitud_id', v_sol);
end
$fn$;

-- ---------------------------------------------------------------------------
-- Probado el 3/10 ejecutandolo, no leyendolo: una conversacion con 3 mensajes
-- dejo 1 solicitud, 1 conversacion y 3 mensajes. El bug viejo dejaba 3 solicitudes.
-- Juan contesto "llego" desde el panel sobre esa misma conversacion, asi que la
-- version vieja la ve Y puede responderla.
--
-- Borrar la fila de prueba (el permiso me freno el delete):
--   delete from chat_mensajes
--    where chat_id in (select chat_id from chat_sesiones where usuario = 'ZZ_puente_test');
--   delete from chat_sesiones      where usuario = 'ZZ_puente_test';
--   delete from landing_solicitudes where usuario = 'ZZ_puente_test';
--
-- CUANDO TODAS LAS PCs ESTEN ACTUALIZADAS, se saca el puente: alcanza con volver a
-- poner `v_sol := p_solicitud_id;` y borrar el bloque del insert. Las que queden:
--   select id, pc_codigo, usuario, created_at from landing_solicitudes
--    where metadata->>'puente_chat' = 'true' order by created_at desc;

-- Prueba del OTRO camino (solicitud de carga), 3/10 12:38 -- ejecutada, no leida:
--   solicitud 299084, CARGA $5.000 de pruebasan en P4.
--   La ve la bandeja de la PC vieja: SI.  Conversaciones de chat que creo: 0.
--   Se creo en 103 ms. Las marcas t_toque / t_envio viajan hasta la bandeja.
--   Borrarla:  delete from landing_solicitudes where id = 299084;


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 3/10 · DOS COSAS QUE ROMPIÓ EL PUENTE, y cómo quedaron
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- El puente es una solicitud de mentira que se crea por conversación para que las PCs que no se
-- actualizaron sigan viendo los chats del portal nuevo. Es un espejo. Pero es una fila REAL en
-- landing_solicitudes, y hay dos sistemas que miran esa tabla y no saben que es un espejo.
--
--
-- ── A) Los chats desaparecían de "Abiertos" ────────────────────────────────────────────────
--
-- El panel agrupa los chats POR USUARIO y da al usuario por cerrado cuando TODAS sus solicitudes
-- están cerradas. El operador cierra la consulta -> se cierra el puente -> el usuario entero sale
-- de "Abiertos"... con la conversación todavía ABIERTA en chat_sesiones.
--
-- En pantalla: "No hay chats abiertos" con el contador de la solapa marcando 2. El contador se
-- calcula sin mirar los cerrados, así que seguía contando a los que la lista ya escondía.
--
-- Eran 69 conversaciones en 10 oficinas. De esas, 4 tenían al jugador escribiendo DESPUÉS del
-- cierre y nadie las veía: "Todabia no se cargo", "Lo arreglan ustedes", "Adodne le mando eso".
--
-- ARREGLO (en la base, así vale para todas las versiones del panel):
--   trigger trg_puente_chat_cerrar  ->  function nodo_puente_chat_cerrar()
--   Cuando el puente pasa a CERRADO, se cierra también la conversación. Espejo y original juntos.
--
-- REPARACIÓN de lo que ya estaba mal:
--   - las 4 con el jugador esperando: puente reabierto (EN_REVISION), vuelven a "Abiertos".
--   - las 65 quietas: conversación cerrada, dejan de contarse.
--
-- Y del lado del panel (2.1.6): si la conversación está abierta, manda ella sobre el espejo.
--   renderer/chat/chat-hilos.js · ticketsAgrupadosFinal
--
--
-- ── B) El bot de respuestas automáticas dejó de contestar ───────────────────────────────────
--
-- No se rompió: se quedó ciego. Vivía en un disparador BEFORE INSERT sobre landing_solicitudes y
-- leía `mensaje_inicial`, que es donde el portal VIEJO dejaba lo que escribía el jugador. El
-- portal nuevo manda el texto a chat_mensajes y el puente sólo lleva el cartel
-- "Consulta desde portal". El bot lo leía, no reconocía ningún caso y anotaba "(no contestaria)".
--
--   3/10, consultas por el canal nuevo: 103 · contestadas por el bot: 0
--   (2/10, por el camino viejo: 141 evaluadas · 66 contestadas)
--
-- ARREGLO:
--   trigger trg_chat_autorespuesta  ->  function trg_chat_autorespuesta()
--   El mismo bot (soporte_auto_mensaje_v1), escuchando donde ahora caen los mensajes.
--   - sólo sobre el mensaje del jugador, con texto
--   - NUNCA por encima de una persona: si en esa conversación ya habló alguien que no es el
--     jugador, se calla. Una respuesta por conversación, igual que antes era una por solicitud.
--   - las oficinas espejo (P8 en adelante) evalúan pero no contestan, igual que en el otro camino
--   - la respuesta se escribe en chat_mensajes Y en el chat_thread del puente, para que la vean
--     también las PCs viejas
--
-- ENSAYO contra los mensajes reales de hoy (92 conversaciones):
--   habría contestado 41. Los 35 "(no contestaria)" son mensajes sin caso (".", "Ahí hice d nuevo").
--   Proporción igual a la de ayer por el camino viejo.
--
-- PROBADO de punta a punta en P1: una consulta nueva recibe la respuesta correcta
-- (AVISO_PAGO_SIN_SOLICITUD), queda espejada en la solicitud, y un segundo mensaje del jugador
-- NO dispara una segunda respuesta.
