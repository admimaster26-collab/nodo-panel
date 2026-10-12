# Auditoría del historial de chat — 11 de octubre de 2026

La prioridad es ayudar a completar una gestión ya iniciada y mostrar quién responde. El historial respalda tres rutas visibles: seguimiento de una operación, comprobante o transferencia ya realizada, y ayuda para acceder. Un formulario asistido tiene sentido si continúa la misma solicitud y distingue con claridad enviar datos, registrar el pedido y acreditar una operación.

## Alcance y método

Consulta de solo lectura en el proyecto Supabase NODO. Corte de creación de registros: **11/10/2026, 06:59 de Buenos Aires** (09:59 UTC). Se agregaron todos los registros accesibles anteriores al corte, sin restringir oficinas ni tomar únicamente una muestra reciente.

Se revisaron estructura, roles, marcas del bot, términos de demanda, repeticiones y secuencias de mensajes mediante SQL. **No se leyó ni evaluó semánticamente cada conversación**. Las recomendaciones combinan estas mediciones con la revisión del código del bot. No se descargaron mensajes crudos, contraseñas, teléfonos, cuentas, nombres de usuario ni comprobantes.

El corte fija qué filas entran, pero no congela sus campos mutables: `metadata.chat_thread`, estado y marcas de respuesta pueden modificarse después. Las consultas se ejecutaron por separado sobre la base en funcionamiento; son reproducibles como método, no constituyen una copia histórica inmutable.

## Fuentes y cobertura

| Fuente | Registros incluidos | Interpretación |
|---|---:|---|
| `landing_solicitudes` | 334.603 | Solicitudes de todos los tipos; no son todas conversaciones |
| Subconjunto `tipo='SOPORTE'` | 61.250 | Mensajes iniciales usados para comparar demanda entre oficinas |
| `metadata.chat_thread` | 133.197 entradas | Contenido en 30.105 filas con array; 30.101 arrays no vacíos |
| `chat_mensajes` | 4.724 mensajes | Canal nuevo y registros antiguos de prueba/compatibilidad |
| `chat_sesiones` | 1.822 sesiones | 1.724 identificadores de chat tienen mensajes al corte |
| `whaticket_eventos` | **0** | Sin historial accesible en esta tabla |

Hay **14 códigos de oficina** con historial, incluido P10B, que solo aparece en la fuente anterior. Se conservan los códigos tal como están almacenados; no se asume que todos sean oficinas actualmente activas ni que los alias sean independientes.

El historial de `chat_mensajes` va del 16/05/2026 al 11/10/2026. Las solicitudes van del 01/06/2026 al 11/10/2026; el soporte empieza el 20/06/2026. En varias oficinas el canal nuevo comienza recién el 03/10/2026: usar solo ese canal perdería gran parte de la historia.

| Código | Todas las solicitudes | Soporte | Entradas legacy | Mensajes canal nuevo | Período de solicitudes, Buenos Aires |
|---|---:|---:|---:|---:|---|
| P1 | 406 | 205 | 952 | 214 | 01/06–10/10 |
| P2 | 71.282 | 11.827 | 23.704 | 761 | 07/07–11/10 |
| P3 | 59.352 | 9.446 | 19.533 | 576 | 01/07–11/10 |
| P4 | 89.326 | 13.851 | 30.423 | 978 | 24/06–11/10 |
| P5 | 21.243 | 8.100 | 17.405 | 360 | 08/07–11/10 |
| P6 | 31.987 | 5.509 | 11.827 | 350 | 21/07–11/10 |
| P7 | 37.038 | 7.095 | 16.695 | 503 | 24/07–11/10 |
| P8 | 5.968 | 1.926 | 5.990 | 503 | 10/09–11/10 |
| P9 | 10.337 | 1.808 | 3.567 | 203 | 11/09–11/10 |
| P9B | 7.184 | 1.289 | 2.633 | 217 | 11/09–11/10 |
| P10 | 84 | 71 | 170 | 14 | 14/09–11/10 |
| P10B | 16 | 15 | 28 | 0 | 14/09–26/09 |
| P10C | 37 | 21 | 55 | 10 | 14/09–11/10 |
| P11 | 343 | 87 | 215 | 35 | 16/09–11/10 |

**No sumar las fuentes como mensajes o personas únicas.** El mensaje inicial puede estar incluido en un hilo y el canal nuevo puede tener un espejo legacy. Dentro del legacy hay 7.349 entradas con la misma firma de oficina, fecha, texto, origen y marca automática en distintos arrays; quedan 125.848 firmas. No se exportaron estas firmas ni los campos que las forman. La coincidencia no equivale a un identificador único confiable.

No se accedió a WhatsApp remoto, otras bases, mensajes eliminados ni adjuntos mediante OCR. El vacío de `whaticket_eventos` no demuestra que no existan conversaciones en WhatsApp.

## Separar correctamente bot, operador y usuario

| Fuente | Usuario | Operador sin marca automática | Bot | Sistema |
|---|---:|---:|---:|---:|
| Legacy, entradas sin deduplicar | 68.543 | 60.527 | 4.127 | 0 |
| Legacy, firmas exactas | 61.648 | 60.073 | 4.127 | 0 |
| Canal nuevo | 3.567 | 524 | 632 | 1 |

En ambas fuentes el bot está guardado como **OPERADOR con `auto=true`**. Buscar solamente `tipo_emisor='BOT'` devuelve cero y confunde mensajes automáticos con personas. En el canal nuevo también hay 43 mensajes con `tipo_emisor='usuario'` en minúsculas: normalizar el caso.

Para visualizar:

- Resolver el autor con el rol normalizado y la marca automática, preservando la compatibilidad legacy.
- Mostrar una etiqueta textual permanente: “Asistente automático”, “Operador” o “Vos/Usuario”, además de color, icono y ubicación.
- No deducir que un mensaje es humano por el nombre visible; el bot histórico utiliza un nombre de operador.
- Guardar las opciones como acciones tipadas y asociadas al mensaje y a su paso. Evitar que una frase que casualmente coincide con una opción active un formulario.
- Diferenciar notas internas de mensajes visibles al usuario y respetar las banderas de visibilidad existentes.

## Demanda observada

Las reglas buscan palabras o frases normalizadas. Las categorías se superponen; “comprobante” incluye “imagen adjunta” y puede describir un adjunto, mientras “acceso” incluye plantillas de validación. No son diagnósticos de intención ni porcentajes de usuarios. Se mantienen separadas las fuentes.

| Coincidencia léxica | Inicios de soporte | Entradas usuario legacy | Mensajes usuario canal nuevo |
|---|---:|---:|---:|
| Comprobante, captura o imagen adjunta | 7.030 | 7.977 | 55 |
| Acceso, clave o validación | 6.629 | 7.134 | 364 |
| Transferencia ya realizada | 5.652 | 6.464 | 348 |
| Retiro o consulta de pago | 2.675 | 2.868 | 135 |
| Saludo aislado | 2.553 | 3.203 | 206 |
| Cierre o agradecimiento aislado | 2.407 | 3.149 | 169 |
| Ayuda para una operación | 1.873 | 1.985 | 76 |
| Estado de carga | 1.670 | 1.853 | 97 |
| Demora | 1.670 | 1.849 | 75 |
| Problema técnico | 719 | 908 | 46 |
| Rechazo | 422 | 513 | 27 |
| Atención humana explícita | 100 | 109 | 9 |

Una segunda comprobación, deduplicando el texto normalizado legacy por oficina y fecha, conserva el orden general: 6.808 coincidencias de acceso, 6.730 de comprobante, 5.769 de transferencia realizada y 2.666 de retiro. Esta deduplicación léxica no usa exactamente la misma firma que el conteo de roles; no debe tomarse como un identificador canónico.

Comparación de las cuatro demandas principales en **inicios de soporte**, sin mezclar fuentes:

| Código | Acceso | Comprobante | Transferencia realizada | Ayuda operativa |
|---|---:|---:|---:|---:|
| P1 | 16 | 19 | 1 | 1 |
| P2 | 1.321 | 1.463 | 1.014 | 501 |
| P3 | 665 | 1.127 | 985 | 238 |
| P4 | 1.150 | 1.601 | 1.401 | 376 |
| P5 | 1.063 | 1.276 | 818 | 201 |
| P6 | 533 | 580 | 420 | 186 |
| P7 | 1.082 | 583 | 612 | 112 |
| P8 | 315 | 115 | 122 | 57 |
| P9 | 243 | 154 | 165 | 100 |
| P9B | 211 | 98 | 107 | 93 |
| P10 | 9 | 9 | 1 | 2 |
| P10B | 1 | 0 | 0 | 1 |
| P10C | 6 | 2 | 2 | 1 |
| P11 | 14 | 3 | 4 | 4 |

Estas diferencias sugieren conservar una misma estructura de ayuda, pero medir resultados por oficina. Los volúmenes pequeños de P10/P10B/P10C/P11 no permiten sacar conclusiones sólidas sobre calidad.

## Qué registra el bot histórico

Hay 9.245 solicitudes con `auto_caso`: 8.699 con marca de respuesta, 543 omitidas y 3 derivadas sin respuesta automática. Estas marcas no equivalen a mensajes actualmente recuperables; los arrays y los registros nuevos conservan otra cobertura.

| Caso | Marcas | Con respuesta marcada | Omitidas |
|---|---:|---:|---:|
| CIERRE | 1.548 | 1.548 | 0 |
| PIDE_VALIDAR | 1.270 | 1.211 | 59 |
| COMPROBANTE_SIN_SOLICITUD | 735 | 648 | 87 |
| COMPROBANTE | 725 | 696 | 29 |
| ESTADO_CARGA | 587 | 537 | 50 |
| AVISO_PAGO | 547 | 530 | 17 |
| PROBLEMA_TECNICO | 519 | 460 | 59 |
| SALUDO | 508 | 508 | 0 |
| RECHAZO_CARGA | 475 | 428 | 47 |
| AVISO_PAGO_SIN_SOLICITUD | 450 | 407 | 43 |
| COMPROBANTE_RECHAZADA | 395 | 334 | 61 |
| QUIERE_CARGAR | 293 | 280 | 13 |
| ESTADO_RETIRO | 293 | 264 | 29 |
| AVISO_PAGO_RECHAZADA | 242 | 225 | 17 |
| COMPROBANTE_YA_ACREDITADA | 228 | 205 | 23 |
| PIDE_USUARIO | 180 | 180 | 0 |
| AVISO_PAGO_ACREDITADA | 121 | 118 | 3 |
| RECHAZO_RETIRO | 54 | 48 | 6 |
| DEMORA | 37 | 37 | 0 |
| VER_SALDO | 35 | 35 | 0 |
| DERIVAR_HUMANO | 3 | 0 | 0 |

Las **1.185 marcas de comprobante o aviso de pago sin solicitud** son evidencia concreta para ayudar a registrar una transferencia ya hecha. Son decisiones del clasificador existente; no se confirmó manualmente que cada una fuera correcta.

La cobertura de automatización tampoco es uniforme:

| Oficina | Respuestas marcadas | Marcas de espejo | Omisiones |
|---|---:|---:|---:|
| P1 | 21 | 0 | 0 |
| P2 | 1.788 | 28 | 136 |
| P3 | 1.162 | 22 | 73 |
| P4 | 2.000 | 0 | 131 |
| P5 | 831 | 24 | 49 |
| P6 | 1.128 | 40 | 57 |
| P7 | 1.769 | 47 | 97 |
| P8 | 0 | 1.926 | 0 |
| P9 | 0 | 1.808 | 0 |
| P9B | 0 | 0 | 0 |
| P10 | 0 | 71 | 0 |
| P10B | 0 | 0 | 0 |
| P10C | 0 | 0 | 0 |
| P11 | 0 | 87 | 0 |

Hay 4.053 marcas `auto_espejo`. **Un espejo no es una respuesta enviada** y no debe sumarse a la efectividad del bot. Estas cifras describen el historial observado; no garantizan que la configuración siga igual al desplegar cambios.

## Repetición y continuidad

En los 61.250 inicios de soporte, agrupando por oficina y usuario internamente:

- 1.791 filas repiten exactamente el texto normalizado de una fila anterior dentro de tres minutos.
- 2.950 lo repiten dentro de diez minutos; este conteo ya incluye las anteriores.
- Son aproximadamente 2,9% y 4,8% de las filas. No identifican personas únicas ni prueban por sí solos un problema de comprensión: pueden ser reintentos, saludos, plantillas o solicitudes distintas.

Dentro de cada array legacy no se encontraron respuestas idénticas consecutivas del bot, repeticiones automáticas idénticas sin usuario intermedio, ni bot inmediatamente después de operador humano sin usuario intermedio. Tampoco hubo entradas exactas duplicadas dentro del mismo array. Sí hay copias entre arrays, como se explicó en cobertura.

Estos resultados **no certifican ausencia de interrupciones**: no reconstruyen la cronología completa entre filas y canales ni evalúan si una respuesta automática fue apropiada después de un nuevo mensaje del usuario. Se debe mantener el freno de repetición y agregar control explícito de toma humana.

## Cambios recomendados y respuestas concretas

1. **Abrir con rutas cortas.** “¿Con qué necesitás ayuda?” con “Ver una solicitud”, “Ya transferí / enviar comprobante”, “No puedo acceder” y “Hablar con una persona”. El texto libre y adjuntar deben continuar disponibles.
2. **Una decisión por paso.** Mostrar dos opciones relacionadas debajo de la respuesta cuando alcance; mantener volver y atención humana siempre accesibles. Conservar el camino elegido y lo ya enviado para no volver a pedirlo.
3. **Mismo trámite y misma fuente de datos.** El formulario desde el chat debe abrir o completar la misma solicitud que el apartado del portal. Mostrar usuario, oficina y operación vinculada dentro del contexto autorizado; no crear un trámite paralelo sin avisar.
4. **Nombre inequívoco del formulario.** Para el caso frecuente, “Informar una transferencia ya realizada”. Aclaración: “Este formulario envía los datos para revisión. No realiza una transferencia ni confirma una acreditación”.
5. **Confirmación antes de enviar.** Resumen de monto informado, comprobante y solicitud, con “Corregir” y “Enviar para revisión”. Confirmar éxito solamente después de guardar; deshabilitar el doble envío y conservar datos ante error.
6. **Contexto para el operador.** Mostrar ruta y paso alcanzado, última opción, solicitud vinculada, campos pendientes y una acción para enviar el formulario correspondiente. El operador no debería tener que reconstruir todo a partir del texto.
7. **Pausa real del bot.** “Hablar con una persona”, toma humana o solicitud de ayuda sensible deben pausar la automatización de la conversación. No prometer que hay alguien revisando sin una toma registrada. Si se reanuda, hacerlo explícitamente.
8. **Estados verificables.** Consultar el estado vigente y mostrar cuándo se obtuvo. Ante fallo: “No pude consultar el estado en este momento”. No sustituir el fallo por “pendiente”, “aprobada” o “en revisión”.
9. **No entrenar con conversaciones crudas.** Usar categorías revisadas, ejemplos inventados y agregados. Los datos identificatorios deben permanecer en el flujo operativo autorizado.

Ejemplos de redacción para adaptar a los estados reales:

| Situación comprobada | Respuesta | Opciones sugeridas |
|---|---|---|
| Transferencia mencionada, sin solicitud vinculada | “Para que puedan revisar lo que ya transferiste, necesitamos vincular los datos a una solicitud.” | “Completar datos” / “Hablar con una persona” |
| Comprobante guardado | “El comprobante se guardó en tu solicitud. Esto todavía no confirma la acreditación.” | “Ver solicitud” / “Agregar información” |
| Solicitud realmente pendiente | “Tu solicitud figura como pendiente. Te muestro la información registrada.” | “Ver detalle” / “Necesito ayuda” |
| No entiende un paso | “Te ayudo con este paso. Elegí dónde te trabaste.” | Dos opciones del paso actual; permitir volver |
| Problema de acceso | “Elegí qué te pasa al entrar. No envíes tu contraseña por el chat.” | “Olvidé mi clave” / “Aparece un error” |
| Persona solicitada y derivación guardada | “Tu pedido de atención quedó registrado en este chat.” | “Agregar información” / “Ver mi solicitud” |

El texto histórico “Un operador la está verificando” aparece en `soporte_auto_mensaje_v1` desplegada, y en el archivo local se construye a partir de una carga pendiente, sin comprobar una toma humana en esa rama. Conviene cambiarlo por una descripción factual del estado. También deben eliminarse cierres promocionales y promesas de acreditación o plazos que la consulta no respalda.

Se verificó por catálogo la función desplegada: MD5 de `soporte_auto_mensaje_v1` = `5874a8bed5ed231f521800e7917e61ff`; MD5 de `trg_soporte_autorespuesta` = `cf224fdeeb15cbd181863f4d09a63fb7`. Son referencias de esta lectura; no prueban equivalencia íntegra con el archivo local.

## Validación posterior sugerida

Medir por oficina y versión del flujo: paso alcanzado, porcentaje de formularios completados, errores al guardar, duplicados por reintento, solicitudes sin comprobante/datos requeridos y pedidos de atención humana. Medir repetición por solicitud, no solo por usuario. Registrar bot/operador/usuario como autor estructurado.

Comparar ventanas equivalentes de uso y revisar una muestra anonimizada de los casos en que el usuario vuelve atrás o pide una persona. El éxito es menos gestiones inconclusas y menos repetición, no más respuestas automáticas ni más operaciones.

## Fuentes técnicas y límites de esta entrega

- Base NODO, tablas y funciones detalladas arriba, consultadas mediante Supabase MCP con SELECT exclusivamente.
- Código local: [bot-soporte.sql](../servidor/bot-soporte.sql), copia de referencia del bot.
- [Supabase: consultas JSON](https://supabase.com/docs/guides/database/json), para interpretar las estructuras JSONB.
- [PostgreSQL: funciones JSON](https://www.postgresql.org/docs/current/functions-json.html), operadores y expansión de arrays.
- [Changelog de Supabase](https://supabase.com/changelog), consultado el 11/10/2026; las novedades recientes no requirieron alterar este análisis de solo lectura.

Este informe no modifica la base ni aplica una migración en producción. No presenta una evaluación manual completa del bot, una importación completa de WhatsApp ni una auditoría de seguridad integral. Las propuestas de interfaz y backend deben verificarse con pruebas de continuidad, permisos, fallos de red y derivación humana antes de publicarse.

## Consultas reproducibles sin datos personales en la salida

Ejecutar cada bloque por separado. Los identificadores y textos necesarios para agrupar permanecen dentro de SQL; la salida contiene únicamente códigos de oficina, roles, fechas y cantidades. Las reglas léxicas son deliberadamente orientativas.

### 1. Cobertura por fuente y oficina

```sql
WITH l AS (
  SELECT * FROM public.landing_solicitudes
  WHERE created_at < timestamptz '2026-10-11 09:59:00+00'
), m AS (
  SELECT coalesce(s.pc_codigo,l.pc_codigo,'SIN_OFICINA') oficina, m.*
  FROM public.chat_mensajes m
  LEFT JOIN public.chat_sesiones s ON s.chat_id=m.chat_id
  LEFT JOIN public.landing_solicitudes l ON l.id=m.solicitud_id
  WHERE m.created_at < timestamptz '2026-10-11 09:59:00+00'
)
SELECT 'solicitudes' fuente, pc_codigo oficina, count(*) registros,
  count(*) FILTER (WHERE tipo='SOPORTE') soporte,
  min(created_at) inicio, max(created_at) fin
FROM l GROUP BY pc_codigo
UNION ALL
SELECT 'chat_mensajes',oficina,count(*),NULL,min(created_at),max(created_at)
FROM m GROUP BY oficina
UNION ALL
SELECT 'whaticket_eventos',pc_codigo,count(*),NULL,min(recibido_at),max(recibido_at)
FROM public.whaticket_eventos
WHERE recibido_at < timestamptz '2026-10-11 09:59:00+00'
GROUP BY pc_codigo ORDER BY fuente,oficina;
```

La tabla vacía de Whaticket no genera grupos; confirmar con:

```sql
SELECT count(*) AS eventos
FROM public.whaticket_eventos
WHERE recibido_at < timestamptz '2026-10-11 09:59:00+00';

SELECT count(*) AS filas_con_array,
       sum(jsonb_array_length(metadata->'chat_thread')) AS entradas
FROM public.landing_solicitudes
WHERE created_at < timestamptz '2026-10-11 09:59:00+00'
  AND jsonb_typeof(metadata->'chat_thread')='array';
```

### 2. Contenido legacy y deduplicación de firmas

```sql
WITH h AS (
SELECT l.id,l.pc_codigo,l.created_at,e.el FROM public.landing_solicitudes l
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.metadata->'chat_thread')='array' THEN l.metadata->'chat_thread' ELSE '[]'::jsonb END) e(el)
WHERE l.created_at<'2026-10-11 09:59:00+00')
SELECT pc_codigo oficina,count(DISTINCT id) filas_con_hilo,count(*) entradas,
count(*) FILTER (WHERE el->>'auto'='true') automaticas,
count(*) FILTER (WHERE upper(el->>'origen')='USUARIO') usuario,
count(*) FILTER (WHERE upper(el->>'origen')='OPERADOR' AND coalesce(el->>'auto','false') <> 'true') operador,
count(*) FILTER (WHERE coalesce(el->>'imagen_url','')<>'') imagenes,
min(created_at)::date desde_fila,max(created_at)::date hasta_fila
FROM h GROUP BY pc_codigo ORDER BY pc_codigo;
```

```sql
WITH h AS (
SELECT DISTINCT l.pc_codigo oficina,e.el->>'fecha' fecha,upper(e.el->>'origen') origen,e.el->>'mensaje' texto,e.el->>'auto' automatico
FROM public.landing_solicitudes l CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.metadata->'chat_thread')='array' THEN l.metadata->'chat_thread' ELSE '[]'::jsonb END) e(el)
WHERE l.created_at<'2026-10-11 09:59:00+00'
)
SELECT coalesce(origen,'SIN_ROL') rol,coalesce(automatico,'false') automatico,count(*) firmas
FROM h GROUP BY 1,2 ORDER BY firmas DESC;
```

### 3. Roles del canal nuevo

```sql
SELECT upper(tipo_emisor) rol,
       coalesce(metadata->>'auto','false') automatico,
       count(*) mensajes
FROM public.chat_mensajes
WHERE created_at < timestamptz '2026-10-11 09:59:00+00'
GROUP BY 1,2 ORDER BY mensajes DESC;
```

### 4. Casos y cobertura de automatización

```sql
SELECT coalesce(metadata->>'auto_caso','SIN_CASO') caso,count(*) registros,
  count(*) FILTER (WHERE metadata ? 'auto_respondido_at') respondido,
  count(*) FILTER (WHERE metadata ? 'auto_omitido') omitido
FROM public.landing_solicitudes
WHERE created_at < timestamptz '2026-10-11 09:59:00+00'
  AND metadata ? 'auto_caso'
GROUP BY 1 ORDER BY registros DESC;
```

```sql
SELECT pc_codigo oficina,count(*) total,count(*) FILTER (WHERE tipo='SOPORTE') soporte,
count(*) FILTER (WHERE metadata ? 'auto_caso') marca_caso,
count(*) FILTER (WHERE metadata ? 'auto_respondido_at') respondido,
count(*) FILTER (WHERE metadata ? 'auto_espejo') espejo,
count(*) FILTER (WHERE metadata ? 'auto_omitido') omitido
FROM public.landing_solicitudes WHERE created_at<'2026-10-11 09:59:00+00' GROUP BY pc_codigo ORDER BY pc_codigo;
```

### 5. Demanda léxica por fuente

```sql
WITH mensajes AS (
 SELECT 'inicial_soporte' fuente,l.pc_codigo oficina,l.id::text hilo,lower(public.unaccent(coalesce(l.mensaje_inicial,''))) texto
 FROM public.landing_solicitudes l WHERE l.tipo='SOPORTE' AND l.created_at<'2026-10-11 09:59:00+00'
 UNION ALL
 SELECT 'hilo_legacy',l.pc_codigo,l.id::text,lower(public.unaccent(coalesce(e.el->>'mensaje','')))
 FROM public.landing_solicitudes l
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.metadata->'chat_thread')='array' THEN l.metadata->'chat_thread' ELSE '[]'::jsonb END) e(el)
 WHERE l.created_at<'2026-10-11 09:59:00+00' AND upper(e.el->>'origen')='USUARIO'
 UNION ALL
 SELECT 'chat_mensajes',coalesce(s.pc_codigo,l.pc_codigo,'SIN_OFICINA'),m.chat_id,lower(public.unaccent(coalesce(m.mensaje,'')))
 FROM public.chat_mensajes m LEFT JOIN public.chat_sesiones s ON s.chat_id=m.chat_id
 LEFT JOIN public.landing_solicitudes l ON l.id=m.solicitud_id
 WHERE m.created_at<'2026-10-11 09:59:00+00' AND upper(m.tipo_emisor)='USUARIO'
), reglas(categoria,patron) AS (VALUES
('comprobante','comprobante|imagen adjunta|captura'),
('transferencia_realizada','ya (te |le |se )?(carg|transfer|tranfer|pas|envi|deposit|mand)|transferi|tranferi|hice (la |una )?(transferencia|carga)|cargue|carge|deposite'),
('estado_carga','no me (acredit|carg|lleg|figur)|no se (me )?acredit|carga.*(demor|tard|pendient)|demor.*carga'),
('retiro','retir|cobrar|no me pag|cuando.*pag'),
('acceso','no puedo (entrar|ingresar|acceder)|no me deja (entrar|ingresar)|clave|contrasena|validar.*acceso|validar.*cuenta'),
('asistencia_operacion','como (hago|carg|transf|retir)|no (se|entiendo) (como|cargar|que)|ayud'),
('problema_tecnico','no (anda|funciona|abre)|no me deja|error|se (traba|cuelga)|pantalla'),
('rechazo','rechaz'),
('demora','demor|tard|cuanto falta|todavia|hace rato|esperando'),
('atencion_humana','operador|persona|humano|alguien.*atiend'),
('saludo_solo','^[[:space:]]*(hola+|buenas|buen dia|buenos dias|buenas tardes|buenas noches)[[:space:]!.?]*$'),
('cierre_solo','^[[:space:]]*(gracias|muchas gracias|ok|dale|listo|perfecto)[[:space:]!.?]*$')
) SELECT fuente,categoria,count(*) mensajes,count(DISTINCT oficina||':'||hilo) hilos FROM mensajes m JOIN reglas r ON m.texto ~ r.patron GROUP BY fuente,categoria ORDER BY fuente,mensajes DESC;
```

Para la comparación de oficinas, sustituir solo el SELECT final por:

```sql
SELECT oficina,categoria,count(*) mensajes
FROM mensajes m JOIN reglas r ON m.texto ~ r.patron
WHERE fuente='inicial_soporte'
  AND categoria IN (
    'acceso','comprobante','transferencia_realizada',
    'estado_carga','asistencia_operacion','retiro'
  )
GROUP BY oficina,categoria ORDER BY oficina,categoria;
```

### 6. Repetición de solicitudes sin exponer identidades

```sql
WITH s AS (
SELECT pc_codigo oficina,created_at,lower(btrim(coalesce(mensaje_inicial,''))) texto,
lag(created_at) OVER (PARTITION BY pc_codigo,lower(btrim(usuario)),lower(btrim(coalesce(mensaje_inicial,''))) ORDER BY created_at,id) previo_igual
FROM public.landing_solicitudes WHERE tipo='SOPORTE' AND created_at<'2026-10-11 09:59:00+00' AND coalesce(btrim(usuario),'')<>'')
SELECT oficina,count(*) soporte_con_usuario,
count(*) FILTER (WHERE texto<>'' AND created_at-previo_igual<=interval '3 minutes') repetidos_3_min,
count(*) FILTER (WHERE texto<>'' AND created_at-previo_igual<=interval '10 minutes') repetidos_10_min
FROM s GROUP BY oficina ORDER BY oficina;
```

### 7. Secuencias dentro de cada hilo

```sql
WITH h AS (
SELECT l.id hilo,l.pc_codigo oficina,e.ord,upper(e.el->>'origen') origen,coalesce(e.el->>'auto','false')='true' automatico,
lower(btrim(coalesce(e.el->>'mensaje',''))) texto,e.el->>'fecha' fecha
FROM public.landing_solicitudes l CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.metadata->'chat_thread')='array' THEN l.metadata->'chat_thread' ELSE '[]'::jsonb END) WITH ORDINALITY e(el,ord)
WHERE l.created_at<'2026-10-11 09:59:00+00'
), secuencia AS (
SELECT *,lag(automatico) OVER w anterior_auto,lag(origen) OVER w anterior_origen,lag(texto) OVER w anterior_texto,
count(*) FILTER (WHERE origen='USUARIO') OVER (PARTITION BY hilo ORDER BY ord ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) turno
FROM h WINDOW w AS (PARTITION BY hilo ORDER BY ord)
), bloques AS (
SELECT oficina,hilo,turno,texto,count(*) n FROM secuencia WHERE automatico GROUP BY oficina,hilo,turno,texto HAVING count(*)>1
), duplicados AS (
SELECT oficina,hilo,origen,automatico,texto,fecha,count(*) n FROM h WHERE texto<>'' GROUP BY oficina,hilo,origen,automatico,texto,fecha HAVING count(*)>1
)
SELECT 'bot_inmediatamente_despues_humano' metrica,count(*) n,count(DISTINCT hilo) hilos FROM secuencia WHERE automatico AND anterior_origen='OPERADOR' AND anterior_auto=false
UNION ALL SELECT 'bot_igual_inmediatamente_despues_bot',count(*),count(DISTINCT hilo) FROM secuencia WHERE automatico AND anterior_auto AND anterior_texto=texto
UNION ALL SELECT 'respuestas_bot_repetidas_sin_usuario_intermedio',coalesce(sum(n-1),0),count(DISTINCT hilo) FROM bloques
UNION ALL SELECT 'entradas_duplicadas_mismo_hilo_fecha_texto_rol',coalesce(sum(n-1),0),count(DISTINCT hilo) FROM duplicados;
```

