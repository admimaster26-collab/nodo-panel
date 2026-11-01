# Contratos de esta beta

Fuente: `servidor/beta-chat-v1.sql`, `servidor/beta-portal-historial-v1.sql`. Despliegue comprobado27/10/2026 en proyecto `pjvvyvfcwjoocjqvdror`; volver a cotejar hashes antes de modificar. El contrato es `nodo.beta.v1` para chat/salud y `portal.historial.v1` para historial.

| Función | Entrega o efecto | Dueño cliente / evidencia |
|---|---|---|
| nodo_beta_capacidades_v1 | Oferta; activación explícita por instalación/build; lease5min | beta-chat.ready/lista; main inyecta identidad |
| nodo_beta_chat_lista_v1 | Oficina+usuario+estado, cursor, máximo100; totales fuera de página | beta-chat.lista, chat-canal-nuevo; tests/beta-chat-client |
| nodo_beta_chat_mensajes_v1 | Un chat autorizado, página+contadores; no marca leído | beta-chat.mensajes; tests SQL |
| nodo_beta_chat_leido_v1 | Sólo IDs USUARIO visibles autorizados; receipt idempotente | beta-chat.flushVisible; no máximo implícito |
| nodo_beta_chat_enviar_v1 | Un mensaje por instalación/request UUID; protege concurrencia | beta-chat.enviar y outbox; linked legacy conserva escritor anterior |
| landing_beta_chat_leer_v1 | Portal lee página resuelta si oficina tiene contrato activo | Portal.pollPortalConversation; available:false permite legacy |
| landing_chat_vistos_v1 | Recibos explícitos, nunca inferidos de leido legacy | Portal; lectura pura |
| nodo_beta_salud_v1 | Lote<=32, últimas muestras por instalación/integración/etapa | NodoSalud; latido existente45s, sin nuevo poller |
| landing_historial_usuario_beta_v1 |50 registros/7d, rechazo turno8h, alcance identidad/oficina | Portal historial; tests SQL |

Tablas privadas: `beta_clientes` identidad y lease; `chat_lecturas` evidencia de visto; `chat_envios` idempotencia; `salud_actual` última muestra y último error por etapa. RLS activo; sin acceso directo anon/authenticated. Main conserva token por instalación fuera de renderer. Salud tiene dimensiones cerradas y códigos saneados; no guarda textos de chat, teléfonos ni credenciales. No purgar ledger de envíos sin definir vigencia del request_id.

Cobertura de salud implementada: CHAT, BANDEJA, HISTORIAL, IDENTIDAD y TELEMETRIA. El resto de familias del plan siguen pendientes; no inferir OK de su ausencia. CONNECTED, DATA, EFFECT y RENDER se acreditan por separado.

Limitación de transición: el hilo antiguo puede contener mensajes USUARIO sin ID común con el canal canónico. Se conservan y se muestra `LEGACY_MESSAGE_IDENTITY_UNKNOWN`; no se fabrica deduplicación por texto, visto ni contador exacto combinado. Resolver esas identidades es el siguiente trabajo antes de ampliar cohortes.

Pruebas reproducibles: `npm test`, `npm run panel:check`, `npm run beta:verify-sql`. `scripts/rehearse-beta-restore.cjs` requiere snapshot privado; `scripts/beta-remote-check.cjs` y `beta-portal-remote-browser.cjs` requieren fixture explícita y credencial privada. Las pruebas no crean automáticamente usuarios/operaciones de negocio.

Registro de esta entrega, medición y reversión: `../PROYECTO_SERVIDOR_NODO/ENTREGA_BETA_2026-10-27.md`.
