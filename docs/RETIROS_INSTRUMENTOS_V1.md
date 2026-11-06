# Retiro con verificación manual de titularidad — v1

Este documento fija el contrato local de la beta, cómo distinguirlo del diseño anterior que quedó en el árbol y qué falta comprobar antes de habilitar una oficina.

## Fuentes canónicas

- Migración: [`servidor/retiros-instrumentos-v1.sql`](../servidor/retiros-instrumentos-v1.sql)
- Reversión operativa: [`servidor/retiros-instrumentos-v1-vuelta-atras.sql`](../servidor/retiros-instrumentos-v1-vuelta-atras.sql)
- Panel NODO: `renderer/portal/withdrawal-instrument.js`, `renderer/portal/operation-execution.js`, `renderer/portal/withdrawals-execution.js`, `renderer/core/automatizaciones.js` y `main/panel-rpc.js`.
- Portal web y autoayuda: archivo raíz `Portal`.
- Pruebas del contrato vigente: `tests/retiro-instrumento-validacion.test.cjs`, `tests/retiro-instrumento-cliente.test.cjs`, `tests/auto-retiro-instrumento.test.cjs`, `tests/integration-health.test.cjs` y `tests/beta-config.test.cjs`.

Hay otro borrador incompatible en `servidor/retiro-instrumentos.sql` con su propia reversión y pruebas. Usa tablas/RPC distintos, persiste el DNI declarado en texto y ofrece dos intentos del operador. **No aplicar ambos diseños ni desplegar ese borrador junto a v1.** Las pruebas `retiro-cuenta-validada.test.cjs` y `retiro-instrumentos-servidor.test.cjs` validan aquel contrato alternativo, no el v1 que consume el Panel.

## Recorrido

1. El Portal consulta `landing_portal_retiro_contexto_v1`. Si el contrato no existe, o la oficina está deshabilitada, conserva la creación legacy. Un error de red o una respuesta mal formada detiene el envío; no cambia silenciosamente de RPC.
2. En beta, `landing_portal_retiro_crear_v1` valida el vínculo y crea la solicitud mediante la función legacy existente, dentro de la misma transacción. El DNI viaja como parámetro separado, se convierte en huella con un secreto del servidor y se elimina de `metadata`. La respuesta sólo incluye estado e identificadores.
3. El servidor marca la solicitud con `retiro_instrumento_v1`. NODO detecta esa marca y consulta/valida el estado antes de `EN_PROCESO`, de abrir Agentes o de retirar fichas. Solicitudes sin la marca y retiros manuales por WhatsApp conservan su ruta anterior.
4. El operador introduce el DNI que ve en el banco o billetera, sin ver el DNI declarado. Un cotejo coincidente valida la cuenta; una discrepancia rechaza esa solicitud, bloquea la huella declarada para ese usuario y oficina y deja disponible la corrección en Portal/chat. La validación sucede antes de descontar fichas.
5. El sello de aprobación guarda la hora de servidor en zona `America/Argentina/Buenos_Aires`, con segundos. Un fallo de sello posterior a una transferencia conserva el estado pagado para evitar repetirla y deja una señal de auditoría incompleta. La automatización de retiros beta también exige confirmación inequívoca de Agentes y usa este sello; si falla, no anuncia una hora local como si fuera hora del servidor.

El contador de intentos de cotejo del contrato v1 es uno por solicitud. El operador puede rechazar directamente si ve que la cuenta pertenece a otra persona. No hay consulta automática al banco.

## Evidencia de salud

Para `RETIROS`, `NodoSalud` distingue `CONNECTED`, `DATA`, `EFFECT` y `RENDER`. El resultado `DNI_MISMATCH` se registra como resultado de negocio separado de un error de conexión. La latencia se mide alrededor del RPC, no durante el tiempo que el operador escribe; una respuesta superior a 3000 ms queda `DEGRADED` con código `RETIRO_RPC_LENTO`. `RENDER` sólo se registra después de insertar el modal en el DOM.

Una muestra demuestra lo observado por esa ejecución. No demuestra que la migración esté desplegada, que otra PC vea la solicitud ni que el casino haya aplicado un movimiento. Las funciones del diagnóstico que no se ejecutaron permanecen `UNKNOWN`.

## Habilitación, comprobación y reversión

La configuración nace deshabilitada; una oficina sin fila en `retiros_privados.config_oficina` también queda en legacy. No se habilitó ninguna oficina en este cambio.

Antes de ejecutar el SQL remoto hay que cotejar en el proyecto actual las definiciones y ACL de las dependencias (`landing_portal_v16_crear_solicitud`, resolución de ruta/vínculo y `acceso.autorizar`), guardar su foto y ensayar restauración. Las capturas locales de octubre no prueban el estado actual. Después de desplegar, comprobar por SQL que la oficina piloto siga con `habilitado=false`, correr las pruebas aisladas y luego activar sólo la oficina autorizada con una operación SQL separada y revisable.

La reversión incluida es un interruptor general: deshabilita nuevas solicitudes beta en todas las oficinas y conserva las solicitudes y su auditoría para que NODO compatible termine los casos abiertos. No borra datos ni elimina funciones. No retirar las funciones hasta vaciar la cola y cotejar de nuevo sus dependencias. Las oficinas legacy siguen usando la RPC anterior.

## Corte local P4 · 06/11/2026

- La ventana activa informó `pc=P4`. En la muestra local observada a `2026-11-06T13:47:30.161Z`, `RETIROS` tenía 38 respuestas `CONNECTED` y 36 `DATA`, sin errores, pero ambas ramas llevaban `code=null`; `EFFECT` y `RENDER` no tenían muestra. Es evidencia de actividad de red/datos en P4, no de que se haya ejecutado esta validación. El transporte remoto figuraba `IDLE` y no había muestras remotas.
- La configuración privada local estaba habilitada sólo para P1. Por eso la actividad P4 no podía sincronizar el semáforo con Supabase. No se leyó ni se copió ninguna credencial.
- Al cotejar la fuente con el contrato SQL se encontró que NODO aún llamaba RPC de otro diseño y permitía forzar el retiro ante errores. `renderer/portal/withdrawal-instrument.js` ya usa el allowlist `nodo_beta_retiro_validar_v1`, `nodo_beta_retiro_rechazar_v1` y `nodo_beta_retiro_pagar_v1` mediante `panelAPI`; errores, respuestas inválidas y oficina sin credencial beta detienen el pago. Solicitudes sin marcador no consultan beta. El sello horario usa la respuesta del servidor.
- La revisión de todos los consumidores encontró dos huecos fuera de la pantalla principal: el botón Portal “Corregir datos de cobro” no tenía una función destino, y `ejecutarAutoRetiro` no pasaba `METADATA` al validador ni sellaba la aprobación. Ambos quedaron conectados; la ruta automática ahora falla cerrada si falta el validador, bloquea un resultado ambiguo de Agentes y sólo anuncia la hora cuando el servidor la confirmó.
- Los códigos de fallo propios del instrumento ahora tienen explicación humana en el resumen de `NodoSalud`; la prueba confirma que no se muestran códigos internos.
- Se regeneró el bundle con `panel:build`; la instancia que ya estaba abierta se inició antes del build y no se recargó para evitar interrumpir trabajo. El próximo ensayo debe hacerse en P4 dev después de recargar en un momento seguro y configurar la credencial beta de P4 fuera del repositorio.
- `panel:build` y `panel:check` pasaron con 34 bloques y 102 fuentes. Las pruebas dirigidas de cliente, salud, corrección Portal y automatización pasan en fixtures; el fixture PGlite cubre el contrato SQL. No se mandaron pagos ni mensajes reales y no se aplicó SQL remoto.

## Límites pendientes antes de abrir la beta

- No se aplicó SQL a Supabase y no hay una comprobación remota posterior a esta migración.
- Falta probar el circuito visual en NODO y Portal con una cuenta fixture de P4/Sánchez; no se enviaron pagos ni mensajes reales.
- El candado `_drexGlobalLock` del Panel es local a esa instancia. La función remota histórica que actualiza `EN_PROCESO` no forma parte del contrato v1 ni condiciona la transición en este SQL. Por eso v1 todavía no demuestra exclusión entre dos instalaciones de NODO que intenten operar la misma solicitud; cotejar y cerrar ese contrato antes de habilitar una oficina con más de una instancia operativa. El sello horario es posterior al movimiento y por sí solo no evita un pago duplicado.
- La suite global y las pruebas de contratos alternativos no se consideran verdes por las pruebas dirigidas de v1. Registrar cada resultado por separado.
