# Integracion panel operativo + portal

## Estado actual

Esta carpeta quedo basada en `NODO_V15_7_2_FIX_PANEL_JS_INIT`, que ya tenia el puente funcional para que el panel reciba datos del portal.

Entrada real de la app:

- `main.js` carga `panel.html`.
- `app-preload.js` expone `window.panelAPI.rpc(...)` y `window.nodo`.
- `panel.html` muestra solicitudes, billeteras, jobs/workers y chat lateral.

## Solicitudes del portal

La vista intenta leer solicitudes con estos RPCs, en este orden:

1. `panel_v13_get_solicitudes_json`
2. `panel_v15_5_listar_solicitudes_portal`

Acciones disponibles:

- Tomar solicitud.
- Crear job desde solicitud.
- Ver detalle.
- Rechazar.
- Abrir chat asociado si la fila trae `chat_id`, `id_chat`, `chatId` o `chat`.

Al crear job desde una solicitud, el panel ahora envia tambien:

- `p_solicitud_id`
- `p_payload_extra.solicitud_id`

Si el RPC actual ignora esos campos, no rompe; si los soporta, el worker queda vinculado a la solicitud.

## Chat del portal

La vista intenta leer chats con:

1. `panel_v13_get_chat_sesiones_json`
2. `panel_v13_get_chat_mensajes_json`
3. `panel_v13_enviar_chat_json`

Mejoras aplicadas:

- Seleccion visible de conversacion.
- Titulo con usuario activo.
- Botones rapidos de respuesta.
- Envio con Enter.
- Render de imagen/adjunto si el mensaje trae `imagen_url`, `image_url` o `imagen`.
- Boton `Chat` directo desde solicitudes con chat asociado.

## Si no aparecen datos

Revisar primero:

1. `.env`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PC_CODIGO`, `LANDING_PC_CODIGO`, `PANEL_SESSION_ID`.
2. Supabase: que existan los RPCs `panel_v13_*` / `panel_v15_*`.
3. Que el portal inserte solicitudes/chats en las tablas que esos RPCs leen.

## Validaciones hechas

- `panel.html` JS syntax OK.
- `node --check main.js`.
- `node --check app-preload.js`.
- `node --check agent-preload.js`.
- `node --check services/*.js`.
- `npm.cmd install` completo con dependencias V15.7.2.

Nota: npm sigue reportando 10 vulnerabilidades high heredadas del stack Electron/build. No se ejecuto `npm audit fix` para no romper compatibilidad.
