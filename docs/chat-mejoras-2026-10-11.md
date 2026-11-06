# Chat y portal: revisión del 11 de octubre de 2026

> **Reemplazado el 1/11/2026.** La guía del Portal que describe este documento no llegó a producción y se reescribió: ver D-132 en `DESCONEXIONES.md`. La migración candidata de este documento nunca se aplicó y su guarda busca un texto que el Portal ya no manda.

El cambio prepara un chat con opciones, contexto y autores distinguibles. Está implementado en el código local. No se publicó el portal ni se modificó el bot de producción durante esta revisión.

## Lo que cambia

- **Portal:** una guía automática al abrir el chat, sin abrir el teclado. Menú inicial por motivo; dos opciones de continuación, Volver, Inicio de ayuda, escribir y pedir una persona.
- **Continuidad:** las opciones quedan como mensajes en la pantalla y se recuerdan en esta pestaña, separadas por oficina, ruta, usuario y conversación. Al pedir atención se envía un resumen del recorrido. La guía no depende de una llamada al servidor por cada clic.
- **Autores:** usuario, asistente automático, operador y sistema tienen etiquetas y estilos propios en el portal y en el panel. Se conservan las marcas `auto`, metadatos y fechas originales; los mensajes del bot no se editan como si fueran del operador.
- **Ayuda desde el operador:** las macros preparan un borrador con una tarjeta para abrir las opciones o revisar una transferencia ya realizada. El operador revisa y envía el mensaje. Las tarjetas recibidas requieren un clic del usuario.
- **Formulario de revisión:** motivo, monto informado, fecha aproximada, aclaración y comprobante opcional. Envía una consulta al mismo chat. Se distingue explícitamente del formulario de carga; no crea una operación ni pide transferir nuevamente.
- **Errores y concurrencia:** no se anuncia recepción sin confirmación del servidor; los datos se conservan ante un fallo. Se recuperaron defensas del portal que tenían pruebas existentes: continuidad de conversación, mínimos de oficina, bloqueo de doble envío y ayuda de titular.

## Evidencia y alcance

El [informe de historial](chat-historial-2026-10-11.md) contiene el corte, oficinas, consultas reproducibles y limitaciones. Se agregaron todos los registros accesibles del corte: 61.250 solicitudes de soporte, 133.197 entradas de hilos anteriores y 4.724 mensajes del canal nuevo. Estas fuentes se solapan: no deben sumarse como conversaciones únicas. Hubo 1.185 clasificaciones históricas del bot de comprobante o aviso de pago sin solicitud reciente.

Esto es un análisis agregado y por patrones, no una lectura semántica individual de cada conversación ni entrenamiento automático sobre conversaciones privadas. No se exportaron mensajes, nombres, teléfonos o cuentas. La tabla disponible de eventos WhatsApp estaba vacía; no se auditó el historial remoto de Whaticket.

El diseño usa opciones cortas, respuestas de continuación y salida al texto libre. Las [guías de diseño conversacional de Google](https://developers.google.com/assistant/conversation-design/chips) describen cómo las opciones seleccionadas pasan a formar parte de la conversación. Aquí se separa el recorrido local del mensaje que se envía a atención, para conservar contexto sin abrir una solicitud por cada elección.

## Bot del servidor, preparado para publicar

La [migración candidata](../supabase/migrations/20261011100217_chat_respuestas_y_ayuda_contextual.sql) conserva la firma de la función actual y sus disparadores. Añade prioridad al pedido de una persona, evita responder nuevamente a un resumen de la guía, incorpora las tarjetas de ayuda y cambia afirmaciones sin evidencia por estados verificables. No promete plazos ni afirma que un operador está trabajando sólo porque una solicitud figure pendiente. El tiempo de una consulta histórica se calcula desde la fecha consultada.

La migración tiene una guarda de versión del cuerpo de la función: si cambió desde esta revisión, se detiene para evitar sobrescribir otro trabajo. El [respaldo leído del servidor](../servidor/revision-chat-2026-10-11/bot-original.sql) permite comparar y preparar una reversión.

Se mantienen las oficinas donde el bot ya estaba habilitado. No se activó automáticamente en las oficinas que funcionaban en modo espejo. Los permisos, RLS, escrituras operativas y reglas de atención humana no se amplían.

## Verificación y publicación

Comandos de verificación:

```powershell
npm.cmd run panel:build
npm.cmd test
npm.cmd run panel:check
npm.cmd run panel:smoke
node scripts/smoke-chat.cjs
# PostgreSQL aislado; dependencia de verificación instalada fuera del proyecto:
node scripts/verify-chat-bot.cjs <ruta-a-@electric-sql/pglite>
```

`smoke-chat.cjs` abre el Portal real en Chromium, bloquea conexiones externas, usa identidades ficticias y guarda capturas de celular/escritorio. `verify-chat-bot.cjs` ejecuta el SQL candidato en PostgreSQL/PGlite y comprueba 16 escenarios. No conecta al servidor. Los helpers externos se simulan: esto no verifica permisos ni despliegue reales.

Para publicar: primero el Portal y el panel con interpretación de las tarjetas, después la migración del bot. El Portal del repositorio es un HTML sin extensión; la publicación real vive en el repositorio externo `portal-bet300`, según la configuración local. Este trabajo no presupone que ese sitio ya esté actualizado.

## Límites y siguiente mejora del sistema

La guía se guarda en `sessionStorage` durante 12 horas; no sincroniza pasos entre dispositivos. Sólo su resumen enviado forma parte del historial compartido. El formulario no persiste datos personales en el almacenamiento de la guía. El bot actual sigue siendo un conjunto de reglas; no se añadió un modelo generativo ni aprendizaje sin revisión.

La siguiente mejora estructural es unificar la identidad de mensajes entre `chat_mensajes` y los hilos de solicitudes para retirar los espejos gradualmente, con medición por oficina. El backend aún crea una solicitud puente por conversación para versiones anteriores del panel. Quitar ese puente exige comprobar que esas versiones ya no dependan de él.

Para evaluar el resultado después de publicar, medir por oficina: pedidos de atención, formularios enviados, errores de entrega, consultas repetidas y resolución con intervención humana. Las respuestas deberían actualizarse a partir de errores revisados, sin asumir que menos mensajes significa mejor atención.
