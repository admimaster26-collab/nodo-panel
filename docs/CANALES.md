# Canales: qué le pide cada parte al servidor y cómo pasarlo a canales limpios

Medido el 9/11 sobre producción, no supuesto:
- las estadísticas del servidor desde el 20/8 (81 días);
- dos fotos de los contadores tomadas a las 14:45, con 4,6 minutos de diferencia, para el ritmo de hoy;
- los cortes por demora de las últimas 24 horas;
- el código de NODO, del admin (`nodo-operativo/docs/AdminNodo.html`) y del Portal.

Juan, 9/11: "generar nuevos canales de envío de información LIMPIOS que contengan FILTROS para que cuando
NODO haga una consulta no tenga que traer un millón de cosas y verificarlas en el propio sistema… también deben
dar señales de vida… si en algún momento falla, esto nos tendría que dar una alerta en el momento".

Regla mientras tanto: **no se toca nada del servidor que usen hoy las oficinas** (ninguna actualizó). Lo
nuevo va aparte, por oficina y apagado, como el DNI.

---

## 1. Lo que falla hoy: 227 cortes por demora en 24 h

El servidor corta a los 3 segundos toda consulta del Portal, de NODO y del admin. La pantalla recibe un error.

| Qué | Cortes en 24 h | Por qué |
|---|---:|---|
| `panel_prevalidar_usuario` (NODO, revisar un teléfono antes de crear usuario) | 86 | Para encontrar el teléfono arma los últimos 8 dígitos fila por fila sobre los **259.000 vínculos**, sin índice. |
| `admin_od_pendientes_v1` (admin, pendientes) | 71 | Filtra con `upper(estado)` y eso obliga a recorrer las **457.000 solicitudes**. |
| `admin_od_dashboard_v3` (admin, "No se pudo cargar el dashboard") | 38 | "Jugadores nuevos" busca la historia completa de cada jugador del período. Además compite con el bucle de 12 s del admin (punto 3). |
| `panel_reconexion_cola` (NODO, CRM) | 12 | — |
| `panel_crm_agente_resumen` (NODO, CRM) | 11 | Recorre 1,1 millones de operaciones importadas cuando vence su copia de 10 min. |
| Lectura directa de `historial_ops` (NODO) | 8 | `select *` de hasta 8.000 filas. |

Los trabajos programados del servidor (cron) corrieron todos bien en las 24 h.

## 2. NODO: lo que viaja de más

| # | Qué | Cada cuánto | Qué trae / qué usa | Propuesta |
|---|---|---|---|---|
| 1 | `verificaciones` y `validaciones_usuario` (`core/macros-y-cola-verificacion.js:150-215`, `extensions/validacion-cola.js:61`) | 5 s, 10 s y 15 s | ~500.000 llamadas por día para pintar `badgeVerif`, **un cartel que no existe en la pantalla**. `validaciones_usuario` lee las 120 últimas de **todas** las oficinas. | Sacar esos temporizadores. No hace falta servidor. |
| 2 | Lista de chats `panel_core_get_chat_sesiones_json` (`portal/chat.js:41` y `chat/chat-canal-nuevo.js:63`) | 15 s + aviso | ~140.000 por día al ritmo de hoy, **~640 KB cada una** (P2, P4). La misma función dos veces por vuelta, más el respaldo `panel_v154_plus…` cada vez que vuelve vacía. | Canal de chat por cambios. Ya existe en el servidor (`nodo_beta_chat_lista_v1`, sólo P1). |
| 3 | Bandeja `panel_v15_5_listar_solicitudes_portal` (`portal/requests.js:183`) | 8 caminos distintos (60 s, cada cambio, cada mensaje de chat, después de cada acción…) | ~108.000 por día, 110 a 500 KB cada una, la lista entera. El aviso barato `panel_bandeja_senal` sólo frena 1 de los 8 caminos. | Bandeja por cambios: sólo lo que cambió desde la última vez. |
| 4 | CRM: `panel_crm_agente_resumen`, `_vinculos`, `_flags` (`core/historial-operaciones.js:425,443-481`) | Al final de cada carga del historial, con freno de 5 min | ~700 KB por oficina (P12 2,7 MB). **Se descarta si el operador no abrió "Cargar lista"**. Los otros usos son de a un jugador (`_crmFlags[usuario]`, `_crmVinculos.find`). | Ficha de un jugador al abrirlo, y la lista sólo cuando se pide. |
| 5 | `historial_ops` directo (`core/historial-operaciones.js:177,340`, `core/nexo.js:86`) | Conteos cada 60 s; Nexo cada 90 s | `select *` de hasta 8.000 filas y filtro en la PC. Nexo baja 8 páginas de 1.000 **aunque Nexo no esté instalado**. | Historial con filtros y páginas en el servidor (Codex lo escribió, falta adaptarlo). Nexo sólo si está instalado. |
| 6 | Billeteras `panel_nodo_list_billeteras` (`extensions/billeteras-oficina.js:70`) | 20 s + 2-3 por cada sincronización de Chunior | ~84.000 por día sin mirar si algo cambió. | Por cambios. |
| 7 | Mensajes del chat abierto (`runtime/realtime.js:77`) | 5 s | Posible: sigue pidiendo el último chat aunque se haya cerrado (sin confirmar). | Revisar. |

## 3. Admin general (`nodo-operativo/docs/AdminNodo.html`, fuera de git)

- **Bucle de 12 s** (`reloadAll`, línea 796) mientras la pestaña esté abierta, aunque esté oculta o en otra sección:
  - rutas;
  - alias;
  - la foto general de **hasta 2.000 filas**;
  - el tablero.

  Son unas 8.700 lecturas por día de cada una, al ritmo de hoy.
- Los mismos números (cargas, retiros, neto por oficina) los calculan tres funciones: `v3`, `tablero_v1` y `resumen_v2`.
  Los pendientes salen por 4 o 5 caminos.
- "No se pudo cargar el dashboard" sale sólo si falla `admin_od_dashboard_v3` (línea 3779). Si fallan los pendientes,
  el error pasa callado.
- **"BONOS $0" hoy:** no hay ningún `PROMO_BONO` registrado desde el 8/11 a las 23:36.
  - Lo normal es de 5 a 10 antes de las 14 h, en P3, P4 y P8.
  - P8 tuvo 3 primeras cargas hoy sin bono.
  - Puede ser una decisión del operador; no está probado que algo esté roto. Es justo lo que una alerta tendría que avisar.

## 4. Portal

- **Historial cada 15 s que nunca se detiene** (`Portal:1898-1905`): sigue aunque el jugador salga de Estado.
  - Es lo que más tiempo de servidor usa: ~129.000 por día al ritmo de hoy.
  - La versión liviana (`landing_historial_usuario_beta_v1`) **ya existe en el servidor**, pero el Portal publicado es anterior y no la usa.
- Chat cada 5 s en cualquier pantalla del cajero; estado cada 6 s aun con el cajero cerrado.
- **Escrituras en dos lados:** si crear una carga, un retiro o un cambio de clave da *cualquier* error, prueba otras dos
  funciones de creación (`Portal:3226-3230`, `3483-3499`, `3610-3611`).
  - Si la primera sí guardó y sólo tardó en contestar, quedan solicitudes duplicadas.
  - El retiro con DNI no tiene ese respaldo.

## 5. Cómo es un canal limpio

1. **Filtra en el servidor** (oficina, usuario, estado, fechas) y devuelve sólo lo que la pantalla muestra.
2. **Por cambios:** el cliente manda la última revisión que tiene y el servidor contesta sólo lo nuevo, o "sin cambios".
3. **Nunca llega al corte:** índice y tope de filas, medidos antes de publicar.
4. **Un interruptor por oficina**, como el DNI.
   - El servidor anuncia el canal en `nodo_beta_capacidades_v1`, que ya existe.
   - NODO usa el nuevo o el viejo, **nunca los dos a la vez**.
   - Las oficinas que no actualizaron siguen con el viejo.
5. **Señales de vida:**
   - Cada PC informa cómo le fue por `nodo_beta_salud_v1`. Ya existe, pero hoy sólo lo usa P1.
   - El monitor (punto 7) mide desde el servidor y abre una alerta cuando un canal se pone lento, se acerca al corte o se queda callado.
   - Lo que el servidor no ve, porque una consulta cortada no queda en sus estadísticas, lo ve la PC.

## 6. Revisiones: los cotejos que hoy hace un modelo con consultas a mano

Pasarlos a canales de revisión precalculados, que se lean desde el admin y desde el perfil de NODO:
- cuentas de cobro compartidas entre usuarios;
- retiros a cuentas de otra persona;
- cambios de teléfono o de usuario, incluidos los de ida y vuelta entre operadores;
- estado del DNI;
- bonos repetidos por cuenta o por teléfono.

Hoy, para ver cualquiera de esas cosas, alguien tiene que escribir SQL.

## 7. Orden propuesto

0. **Monitor** (`servidor/canales-monitor.sql`, pruebas en `tests/canales-monitor.test.cjs`).
   - Cada 5 minutos mide desde el servidor cada canal de NODO, del admin y del Portal, sin tocar ninguno, y abre o cierra alertas.
   - Lo lee el admin general con `admin_canales_estado_v1`.
   - **No está publicado:** el 9/11 la publicación quedó rechazada.
1. **Arreglos en NODO que no necesitan servidor**, para la próxima versión:
   - temporizadores de verificaciones y validaciones;
   - CRM sólo cuando se pide;
   - lista de chats una vez por vuelta;
   - Nexo sólo si está instalado.
2. **Índices que frenan los cortes** (prevalidar, pendientes del admin). No cambian ninguna función, pero tocan tablas en uso: lo decide Juan.
3. **Canales nuevos por oficina**, primero en P1: bandeja por cambios, chat (ya existe), historial con filtros y ficha de jugador.
4. **Admin:** un canal de inicio con el resumen por hora precalculado (un solo lugar para cargas, retiros, bonos y pendientes) y los canales de revisión.
5. **Portal:** publicar la versión que usa el historial liviano, con una sola escritura (clave para no duplicar) y consultas sólo en la pantalla que las usa.

## 8. Diferencias entre el repo y el servidor (encontradas el 9/11)

- `servidor/beta-chat-v1.sql` usa los esquemas `acceso` y `observabilidad`. En el servidor está todo en `nodo_beta`.
- `servidor/retiros-instrumentos-v1.sql` (Codex) nunca se publicó y pisaría el retiro con DNI. Tiene un aviso arriba.
- `servidor/dominios/*.sql` (Codex) depende de `acceso.autorizar`, que no existe en el servidor.
- El admin vivo (`nodo-operativo/docs/AdminNodo.html`) no está en git. Las copias `admi-V23-COMPLETO-con-whaticket.html` son
  anteriores.

## 9. Estado al 11/11: qué quedó publicado en el servidor (beta)

Publicado y probado por el puente real con la llave de P1:

| Canal | Qué da | P1 | P4 |
|---|---|---|---|
| `nodo_beta_ingresos_v1` | Quién pidió entrar, quién corrigió el dato, quién espera, quién no volvió y los pendientes de validar | 79 ms | 126 ms |
| `nodo_beta_revisiones_v1` | Los cotejos que antes se hacían a mano, con título, nivel y ejemplos | 87 ms | 168 ms |
| `nodo_beta_prevalidar_v1` | Revisar un teléfono antes de crear usuario, sólo dentro de la oficina | 8 ms | 12 ms |
| `nodo_beta_perfil_v1` / `_detalle_v1` | Perfil del jugador | 348 ms | — |
| `landing_portal_ingreso_v1` | El Portal anota cada intento de ingreso (y devuelve lo mismo que antes) | — | — |

Lo que se aprendió al publicarlo:

- **Preguntar por cada caso contra la tabla entera no escala.** `identidad.ingresos_v1` tardaba 5,6 s en P4 y se
  cortaba a los 3. Ahora lee los usuarios de la oficina una sola vez y cruza todo en memoria: no necesita índices nuevos.
- **Un filtro que no coincide con el índice es un recorrido completo.** El perfil filtraba por
  `upper(btrim(pc_codigo))`, que ningún índice cubre: 853 ms de historial + 1.780 ms sobre 1,1 M de filas importadas.
  Se agregó el filtro por `pc_codigo` tal cual (0 excepciones en las tablas) y bajó a 348 ms. Los otros canales
  de `servidor/dominios` (bandeja, historial, Nexo, observaciones, guardado local) usan el mismo filtro:
  **no se publican sin medirlos antes contra datos reales.**
- **P8, P9 y P10 no pueden usar los canales nuevos todavía**: `acceso.oficinas_autorizadas` los rechaza
  (`BETA_OFFICE_AMBIGUOUS`) porque comparten nombres con P9B, P10B y P10C en `nodo_oficina_aliases`.
- El canal de salud ya acepta CRM, INGRESOS y REVISIONES (`health.v2`).

Sin publicar: el monitor (`servidor/canales-monitor.sql`), los canales de `servidor/dominios` nombrados arriba y los
tres índices de `usuarios_portal_vinculos` (ya no hacen falta para Ingresos).

## 10 · El WhatsApp que ve el jugador (13/11)

El Portal muestra un botón de WhatsApp. Si la línea publicada se cae, el botón sigue ahí y manda
a un número muerto: el jugador escribe y nadie le contesta. Esto es el canal que se encarga de
que el número publicado sea siempre uno que esté andando.

### Lo que WTK puede y lo que no

Verificado contra la API el 13/11 con `servidor/edge-functions/whaticket-sonda-lineas.ts`:

| Ruta | Resultado |
|---|---|
| `GET /whatsapps` | 200 · `id`, `name`, `status`, `channel` — **y nada más** |
| `GET /whatsapps/:id` · `/session` · `/whatsapp/:id` · `/settings` | 404 |
| `GET /tickets` · `/queues` · `/users` | 401 `ERR_INSUFFICIENT_PERMISSION` |
| `GET /contacts` | 200 · tiene `number`, pero son los **jugadores**, no las líneas |

O sea: **el teléfono de cada línea no existe en la API**. Tampoco llega por el webhook
(`whaticket_eventos` está vacía: nunca se configuró). Y los nombres son etiquetas, no números —
en P4 son PRINCIPAL 1, SOPORTE 2, SOPORTE 4…

Por eso el número de cada línea se carga **una vez, a mano**, desde Ajustes, y queda en
`whaticket_lineas.numero` con `numero_origen='OPERADOR'`. Es la única pieza que no se puede
averiguar sola. Con 4 líneas activas que tengan número, la rotación ya se hace sin preguntar nada.

### Qué decide el servidor

`panel_oficina_wsp_estado(p_secret, p_pc)` contesta de una lectura (**6,7 ms en P4**) qué hay que
hacer ahora, en el campo `pide`:

| WTK | Número en la página | `pide` |
|---|---|---|
| contesta · la publicada está arriba | sí | `NADA` |
| contesta · la publicada se cayó y hay otra activa con número | sí | `ROTAR` (sola) |
| contesta · nadie cargó ningún número todavía | sí | `MAPEAR` (un clic) |
| contesta · hay números cargados y el de la página no es ninguno | sí | `NADA` + señal interna |
| no contesta | no | `CARGAR_NUMERO` |
| no contesta · es el turno que toca hoy y nadie confirmó | sí | `CONFIRMAR` |
| no contesta · no es el turno | sí | `NADA` |

«WTK no contesta» = sin líneas registradas, o el último barrido es de hace más de 25 min (el
mismo umbral que ya usa `panel_lineas_estado` para `datos_viejos`; el monitor corre cada 10).

**Un turno por día, rotando.** Sin WTK hace falta una constancia de que el número sigue vivo,
pero preguntar en los tres turnos todos los días es saturar al operador. Se pregunta una vez por
día y el turno al que le toca rota: un día a la mañana, al otro a la tarde, al otro a la noche.
En tres días pasó por los tres equipos. El botón de confirmar **no existe cuando no toca**: que
esté siempre lo convierte en un adorno que se clickea sin mirar.
Turnos: mañana 06–14, tarde 14–22, noche 22–06 (hora de Argentina).

**La señal que queda colgada.** Si la oficina tiene WTK y el número de la página no es ninguna de
sus líneas, eso no lo arregla el operador. Queda un aviso en `nodo_avisos_internos` y nada más:
no frena nada y no se le muestra a nadie. Se mira de un `select * from nodo_avisos_abiertos`.
Un aviso abierto no se duplica: el índice único por (oficina, tipo, huella) hace que la misma
situación sume `veces` en vez de llenar la tabla cada 5 minutos.

### Estado al 13/11

| Oficina | Líneas WTK | Activas | Nº en la página | `pide` |
|---|---|---|---|---|
| P2 | 9 | 5 | sí | `MAPEAR` |
| P3 | 16 | 7 | sí | `MAPEAR` |
| **P4** | 12 | 10 | **no** | `CARGAR_NUMERO` |
| P5 | 13 | 5 | sí | `MAPEAR` |
| P6 · P7 · P10C · P12 | — | — | no | `CARGAR_NUMERO` |
| P1 · P8 · P9 · P9B · P10 · P10B · P11 | — | — | sí | `CONFIRMAR` por turno |

### Dónde vive cada parte

| Qué | Dónde |
|---|---|
| El número de cada línea | `servidor/oficina-whatsapp-wtk.sql` (+ `nodo_wsp_e164`, la única regla de formato) |
| Las decisiones, la rotación y la señal | `servidor/oficina-whatsapp-rotacion.sql` |
| Leer el número del backoffice | `agent-preload.js` › `leerWhatsappOficina` (lee la pantalla; **navega main**: `main/automation.js`) |
| La URL de esa pantalla | `main/agent-backends.js` › `whatsappUrl` (bet300 no la tiene: `null`) |
| El permiso del puente | `app-preload.js` › `ALLOWED_AUTOMATION_METHODS` — sin esto la llamada muere en el panel |
| La pantalla y el tilde de la ruedita | `renderer/extensions/oficina-whatsapp.js` |
| El enganche | `renderer/core/configuracion-y-estado.js` › `_revisarLineas` |

### Lo que falta probar

La **escritura** de la rotación no se ensayó contra producción: el ensayo necesitaba un `update`
sobre `whaticket_lineas` y el clasificador lo frenó, y no se rodeó. Sí quedó verificado que
`panel_oficina_wsp_rotar` compila, autoriza, sale temprano con `NO_HACE_FALTA` en las 5 oficinas
(sin escribir nada) y elige bien el reemplazo contra las líneas reales de P4. Falta el ensayo del
`update` con el OK de Juan, o en una rama de Supabase.

### Corrección del 14/11 · el backoffice se mira primero

La primera versión sólo leía el backoffice si el operador apretaba «Traerlo del backoffice», y
ese botón aparecía **únicamente** cuando no había ningún número publicado. Resultado: en una
oficina con número y sin lectura de WTK, NODO caía en `CONFIRMAR` y le preguntaba al operador
«¿sigue andando?» con la pantalla de Integraciones abierta al lado mostrando **otro** número,
sin haberla mirado nunca.

Ahora `revisar()` consulta Integraciones **antes** de preguntarle nada a nadie:

| Situación | Qué hace |
|---|---|
| `CARGAR_NUMERO` y el backoffice tiene número | lo publica **solo** y no pregunta nada |
| El backoffice dice **otro** número | eso manda sobre cualquier otra pregunta: muestra los dos y ofrece «Poner el del backoffice» |
| Coinciden | lo dice («· coincide») y recién ahí pide la constancia del turno — coincidir no prueba que la línea esté viva |
| El contacto está destildado en el backoffice | lo avisa: el número puede estar bien y el botón no aparecerle igual al jugador |
| La ventana de Agentes está operando o pide login | no concluye nada: no leerlo no es lo mismo que no coincidir |

La descripción anterior del intervalo quedó reemplazada por la corrección del 16/11: el watchdog
de líneas vuelve a consultar cada 5 minutos, y lleva la ventana a Personalizar página cuando está
en otra sección. La cola de operaciones sigue impidiendo moverla mientras el operador trabaja.

**Y un error de lectura:** el código de área argentino tiene 2 dígitos **sólo** en el 11. Se
estaba partiendo siempre de a 2, así que un número de Mar del Plata (`549 223 670 0367`) se
mostraba como «22 3670-0367». Ahora: 11 → 2 dígitos, el resto → 3.

### Corrección del 15/11 · por qué nunca leyó nada, y cómo lee ahora

Juan: «sigue sin detectar el número». Tenía razón, y no era un motivo solo: **la lectura nunca
corrió ni una vez**. Tres cosas encadenadas, las tres medidas contra el backoffice real.

1. **El puente del panel la rechazaba.** `app-preload.js` tiene lista blanca
   (`ALLOWED_AUTOMATION_METHODS`) y el método no estaba. Cada llamada moría con «Método no
   permitido» **dentro del panel**, sin llegar al preload. El módulo lo leía como «no hay dato»
   y mostraba «no lo puedo revisar solo».
2. **El iframe no funciona contra este backoffice.** La primera versión abría `/agents/features`
   en un iframe oculto. Medido: **21 segundos y nunca entrega documento** — no se deja enmarcar.
   Ese camino está borrado.
3. **La guarda se bloqueaba a sí misma.** `if (_opsEnCurso > 0) no leas`: el ipc sube ese
   contador para **todos** los métodos, incluido éste, así que siempre valía 1. El propio
   archivo ya tenía esa trampa escrita en `irABusquedaUsuarios`.

**Cómo lee ahora**, igual que `obtenerSaldoAgente`: el preload lee la pantalla viva y **no
navega** (D-101); a la pantalla la lleva `main/automation.js` antes de llamar, y sólo si se lo
piden con `{navegar:true}`. La llamada va por **la misma cola que usa el watchdog para las
fichas** (`_drexEncolar`, `silencioso:true`), que es la que evita navegar encima de una carga o
un retiro; si la cola está ocupada, se saltea la vuelta.

La regla anterior de seis horas quedó reemplazada por la corrección del 16/11. Verificar desde la
misma ventana real de AdminOnline requiere abrir `/config/socials` si está en otra pantalla; el
watchdog lo hace cada 5 minutos, protegido por la cola del operador. Si la lectura falla, no se
usa un dato viejo para afirmar coincidencia o actividad.

**Verificado en el NODO real (15/11):** con navegación, `{ok:true, habilitado:true}` en **1.538
ms**. Y apareció lo que el módulo tenía que encontrar: P1 publica un número terminado en **1171**
mientras el backoffice tiene uno terminado en **0367**. El jugador está recibiendo un WhatsApp
que no es el que la oficina tiene configurado en Agentes.

**La API que hay detrás.** Buscando de dónde sale el dato se vio que la pantalla es un React que
le pide todo a `wallet.casinoenvivo.club/api/admin/*` — entre otras,
`getWhatsappContactFeaturesAllowed`, `getBasicInfo`, `isValidSession`, `getReport`. **No se probó
ninguna**: el intento quedó frenado por el clasificador y no se rodeó. Queda anotado porque, si
sirven, las *lecturas* del preload (saldo, número, buscar usuario) podrían dejar de depender del
DOM. Las *escrituras* son otra discusión: por la UI pasan por las validaciones del backoffice.

### Corrección del 16/11 · la lectura debe ser actual y no confundir formato inválido

En la captura de NODO, AdminOnline tenía un teléfono de 11 dígitos en un campo cuyo máximo es 10.
El render marcaba «· coincide» porque trataba cualquier estado que no fuera desacuerdo como una
coincidencia; además, el intervalo de seis horas dejaba al watchdog leyendo otra sección o un dato
anterior. Ahora cada revisión del watchdog intenta una lectura actual: si AdminOnline está en otra
ruta, navega a `/config/socials` y lee el formulario; si la cola está ocupada, indica que no pudo
verificar. «Coincide» sólo aparece al comparar dos números válidos, y el estado verde informa que
el contacto está habilitado en AdminOnline. Eso verifica la configuración de la página; la conexión
de la línea de WhatsApp se sigue confirmando aparte con el estado de WTK/operador.

## 11 · El bot de palabras no es un canal (16/11)

El bot (`soporte_auto_mensaje_v1`) no vive en ningún canal: son dos disparadores sobre las **tablas**
`chat_mensajes` y `landing_solicitudes`. Contesta sin importar si NODO lee por los canales viejos o por
`nodo_beta_chat_*`. Por eso en P1 seguía contestando con NODO beta. Desde el 16/11 no contesta en las
oficinas que figuran en `nodo_beta.beta_clientes` (hoy P1): `servidor/bot-apagado-en-beta.sql`, con su
vuelta atrás. Las demás oficinas siguen igual. Cómo comprobarlo: `docs/PRUEBA_PORTAL_NODO.md`.
