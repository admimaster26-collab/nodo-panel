# Respuestas de soporte, revisión 11/10/2026

`bot-original.sql` es la definición de `soporte_auto_mensaje_v1` leída de NODO durante esta revisión. No contiene conversaciones. Es material de comparación y reversión, no un despliegue automático.

La versión propuesta está en `../../supabase/migrations/20261011100217_chat_respuestas_y_ayuda_contextual.sql`, creada con la CLI de Supabase. La guarda compara el MD5 del cuerpo sin CR con `7f3d0c35ce567bf1525367ba8f12ae6d`. Si otro trabajo cambió la función, hay que comparar antes de actualizar la propuesta.

Validación local realizada con PostgreSQL/PGlite 0.5.8, instalado en una carpeta temporal, mediante `scripts/verify-chat-bot.cjs`: 16 comprobaciones de respuestas, derivación humana, prioridad de intención, fecha de consulta, aislamiento de oficina y guarda de versión. No hubo escrituras en la base remota. Las dependencias de la función se simulan con datos ficticios.

Para una eventual reversión, comprobar primero que la versión desplegada sea la propuesta de esta revisión, comparar permisos vigentes y aplicar el respaldo como una nueva migración. No ejecutar el respaldo sobre cambios posteriores sin revisarlos.
