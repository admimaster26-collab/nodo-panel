# Plan: motor de bonificaciones

Para: Claude Opus 5.5 y Gemini 3.8 Flash, que trabajan en este mismo árbol. Lo pidió Juan el 2/11.
Escrito por Claude Opus 5.5 el 2/11 con la base de producción, el código de este repo y cómo lo
resuelven herramientas reales (fuentes al final). Todo número de acá salió de una consulta, no de memoria.

## 0. Reglas de trabajo, antes que nada

1. **Hecho = comprobado.** Un bono está "otorgado" sólo si existe su fila en `bono_otorgados`, la carga
   de fichas en `historial_ops` apunta a ella, y el jugador la ve en el Portal publicado en `intento`.
   Guardarlo no es entregarlo (ver D-135).
2. **No editar** `renderer/generated/**` ni `NODO · OPERATIVO LITE.htm`: se editan las fuentes y se corre
   `npm run panel:build`. Antes de terminar: `npm run panel:check`, `npm test` y
   `node --require ./tests/helpers/offline-network.cjs --test tests/portal-*.test.cjs`.
3. **Servidor:** cada cambio va como archivo en `servidor/bonos/` con su vuelta atrás al lado, la foto
   previa (md5 del cuerpo y permisos) en el encabezado y un ensayo aislado. Lo aplica Claude; el control
   automático frena `apply_migration` y sólo se reintenta cuando Juan lo ordena. Nunca `execute_sql` para
   cambiar estructura. Gemini no aplica nada en el servidor.
4. **Datos de jugadores:** el repo es público. Nada de teléfonos, DNI, alias ni nombres en archivos ni
   pruebas. Usuario de prueba: `pruebaxx` en P1.
5. **Antes de editar un archivo:** `git status` y `git diff` de ese archivo. Si otro modelo lo tiene
   tocado, no se pisa: se avisa.
6. **Gemini Flash** toma sólo las tareas marcadas **[Gemini]**, con los archivos exactos que nombra cada
   una. Si algo no está escrito acá, pregunta en vez de suponer.

## 1. Foto de lo que existe (producción, 2/11)

El motor ya se empezó: lo que Juan dejó a medias está en la base, no en un archivo.

**Tablas**
- `bono_campanas` (12). Seis reales, "Primer ingreso", una por oficina: P1, P3, P4, P5 y P8 activas, P2
  pausada. Dan 20 % + 10 % con notificaciones + 20 % con app, con tope de $50.000 por persona,
  `repetir='NUNCA'`. Las otras seis son de prueba (`ZZ …`, P1). Columnas útiles que ya están: `modo`
  (PCT/FIJO), `valor`, `extra_push`, `extra_app`, `permite_sin_app`, `comparte_con` (combinables),
  `tope_persona`, `cupo_personas`, `inversion`, `dias`, `franjas`, `desde`, `hasta`, `condiciones`,
  `mensaje_jugador`, `no_extraible`.
- `bono_otorgados` (4.591): `campana_id, usuario, pc_codigo, monto, historial_op_id, titular,
  no_extraible, liberado_at`. **Ningún NODO escribió nunca acá.** Se llenó una sola vez el 4/10, al
  crear las campañas, copiando los 4.592 `PROMO_BONO` que había en `historial_ops` (4.587 tienen
  exactamente la hora de su carga; los 4 restantes son de prueba). Ni este repo ni el oficial llamaron
  nunca a `bono_anotar` ni a `panel_bono_para`. Desde el 4/10 hay 509 bonos sin fila acá.
- `bono_lista_negra` (4.537, todas con motivo COBRO y por `usuario` nada más; también es esa copia del 4/10),
  `bono_lista_negra_comparte`, `bono_lista_usuarios` (las "tandas": `campana_id, usuario, pc_codigo,
  telefono, agregado_por, contactado_por, contactado_at, cobrado_at`) y `bono_mensajes`.
- `push_subscriptions`: 8.018 activas de 3.491 usuarios, sólo P1 a P5. `created_at` sirve como fecha en
  que activó las notificaciones.
- `usuarios_portal_vinculos.app_instalada`: 1.673 en true. `app_instalada_at` tiene fecha en **uno solo**:
  la función que lo marca no la guarda.

**Funciones**
- En uso (llamadas en 24 h): `landing_promo_activa` (17.401), `panel_promo_primer_ingreso` (3.806),
  `landing_marcar_app_instalada` (2.585). Ninguna otra de bonos.
- `panel_promo_primer_ingreso(secret, pc, usuario)`: calcula el % de bienvenida. Toma como "nuevo" al
  usuario que no tiene ninguna carga `PROMO_BONO` OK en `historial_ops`, **por texto de usuario**.
- `panel_bono_para`, `bono_puede_cobrar`, `bono_anotar`, `panel_bono_anotar` (con secreto): el camino por
  campaña. Está hecho y nadie lo llama: el motor se armó y nunca se conectó a NODO.
- `admin_bonos_*` (13, con sesión): el panel admin de la encargada. `admin_bonos_lista_agregar` ya carga
  usuarios a una campaña.

**Cómo queda un bono hoy:** una fila de `historial_ops` con `tipo='CARGA'`, `origen='PROMO_BONO'` y una
nota "Bono primer ingreso N% sobre $X · solicitud N". Ningún campo dice qué bono fue: bienvenida, app y
notificaciones salen sumados en un solo movimiento (20 = sólo bienvenida, 30 = con notificaciones,
40 = con app, 50 = las dos). En 60 días: 1.155 (P3 212, P4 540, P5 77, P8 326). **Nueve oficinas no
tienen ningún `PROMO_BONO`** (P2, P6, P7, P9, P9B, P10, P10B, P10C, P11): si dan bonos, los cargan como
carga común y no se pueden distinguir.

**App:** sí se puede saber cuándo llegó el primer pedido desde la app: `landing_solicitudes.metadata
->>'navegador'` termina en `· app` (50.647 pedidos de 993 usuarios desde el 3/08). No se sabe cuándo se
instaló.

**Dónde quedó el motor que empezó Juan**
- Pantalla "Promociones" del panel admin, en su entorno de prueba: repo `zhinouno-ui/intento`, archivo
  `admin.html`, sección `section-promociones` (línea 4589) y llamadas `admin_bonos_*` (4989 a 5203).
  Commits del 4 y 5/10. Ojo: el Portal de prueba se publica en el mismo repo; al publicar se tocan sólo
  `index.html` y `sw.js`.
- Respaldo del código de las funciones del servidor al 10/10:
  `%LOCALAPPDATA%\NODO\resguardos-servidor\20261010-funciones-previas\funciones.json`. Inventario en
  `documentacion-servidor-2026-10-10/fuentes/cruce-servidor-clientes.md` (fuera del repo).
- El prototipo `motor-bonos.html` (4/10) sólo quedó dentro de una conversación vieja. Traía seis tipos:
  Primer ingreso, Recarga, Hora loca, Vuelta del dormido, Devolución y Trae un amigo; condiciones que se
  suman, lista negra compartida, días y franjas, inversión, cupo, tope, repetición, bono no extraíble y
  mensajes con llaves. Las columnas de `bono_campanas` ya cubren todo eso: sirve de lista de tipos.

**Código de hoy**
- NODO calcula el bono en `renderer/portal/operation-modal.js` (164-208 y 400-412) con
  `panel_promo_primer_ingreso`, y lo carga en `renderer/portal/operation-execution.js` (346 y 490-576):
  segunda carga en la billetera PROMO, insertada en `historial_ops` por `registrarEnHistorial`
  (`renderer/core/pendientes-y-registro.js` 156-248). La cola de pendientes ya acepta la clase `BONO`
  y nadie la usa.
- Portal: `_infoNavegador` (líneas 1002-1019) agrega `· app` en modo app; `marcarAppInstalada`
  (4248-4256), el evento `appinstalled` (4259-4263) e `instalarAppPromo` (2582-2597) llaman a
  `landing_marcar_app_instalada`; `subscribePush` (4169-4195) guarda la suscripción por
  `/api/save-subscription`, que vive en Vercel y no está en ningún repo nuestro. La tarjeta del bono
  (`bonoBienvenidaEstado`, `renderBonoBienvenidaCard`, 2534-2580) es sólo visual.

**Agujeros de seguridad (con la clave pública del Portal, cualquiera puede):**
- `bono_reiniciar_lista_negra`: vaciar la lista negra de una campaña y dejar a todos habilitados de nuevo.
- `bono_anotar`: anotar bonos falsos.
- `landing_marcar_app_instalada`: marcar "app instalada" a cualquier usuario, en todas las oficinas si
  manda la oficina vacía. Es justo lo que suma el 20 % extra.
- El disparador `push_carga_aprobada` tiene la clave del envío de push escrita en su definición.

Los dos primeros ya tienen arreglo escrito: `servidor/bonos-cerrar-escrituras.sql` y su vuelta atrás.
Nadie los llamó directo en 24 h; los siguen usando, por dentro, `panel_bono_anotar` y
`admin_bonos_reiniciar`. Aplicado el 4/11 con OK de Juan (el control automático lo había frenado el 2/11
y otra vez el 4/11): `anon` y `authenticated` ya no pueden ejecutar las dos funciones; `postgres` y
`service_role` sí, así que las dos que las usan por dentro conservan el permiso. No se probó un reinicio
real desde el panel admin: vaciaría la lista negra.

## 2. Qué pidió Juan y dónde falla hoy

| Pedido | Hoy |
|---|---|
| Varios bonos, combinables, sin explicar nada a mano | Uno solo con extras sumados; las campañas existen pero NODO nunca las usó |
| "Esta tanda de usuarios tiene bono", cargada desde Supabase, y NODO la detecta | `bono_lista_usuarios` existe; NODO no la consulta |
| NODO detecta si el usuario activo tiene bono | Sólo el % de bienvenida |
| El jugador ve desde el Portal si le corresponde y si se le acreditó | No ve nada |
| Constatable y registrable: qué bono, cuándo, por qué solicitud, quién | Una nota de texto; el registro por campaña nunca se conectó |
| Bonos futuros sólo para pedidos que vienen de la app | No hay forma de exigirlo; la marca de app se puede falsificar |
| Borrar al usuario no lo habilita de nuevo para la bienvenida | Lo habilita: se busca por texto de usuario |
| Los bonos no se pierden entre las cargas de 7 oficinas | Son cargas, sin canal propio |
| Lista negra que se pueda elegir | Existe, sólo por usuario y sólo motivo COBRO |
| "Activé notificaciones y la app y no me dieron el bono": poder cotejarlo | No hay cómo |
| En el historial de Inicio de NODO, el bono queda mucho rato con "Reintentar" | Arreglado el 2/11, ver 3.6 |

## 3. Diseño

Se reusa lo que existe (las tablas y el panel admin de la encargada ya las usan) y se completa. Los
patrones vienen de motores reales: separar **validar** de **otorgar**, un registro donde sólo se agrega,
una clave por pedido para no otorgar dos veces y una identidad estable para lo que es "una sola vez".

### 3.1 Un bono = una campaña con nombre

Bienvenida, extra por notificaciones y extra por app pasan a ser **tres campañas por oficina** que se
combinan (`comparte_con`). Así cada otorgamiento dice qué bono fue. Columnas nuevas en `bono_campanas`:
- `tipo` (`BIENVENIDA`, `APP`, `NOTIFICACIONES`, `TANDA`, `PROMO`)
- `requiere_app_en_pedido` (el pedido actual tiene que venir de la app)
- `requiere_notificaciones`
- `grupo` y `tope_grupo` (el tope de $50.000 vale para la suma de los tres)
- `descripcion_jugador` (la explicación que ve el jugador; `mensaje_jugador` sigue para el chat)

La migración arma las tres campañas a partir de cada "Primer ingreso" con los mismos valores. Las `ZZ …`
se archivan.

### 3.2 Identidad estable

`identidad = 'TEL:' || telefono_canon` (está en el 100 % de los vínculos). Todo lo de "una sola vez" se
controla por identidad, no por texto de usuario: borrar o renombrar al usuario no lo habilita de nuevo.
Titular y cuenta de retiro repetidos **mandan a revisión**, no bloquean solos: una familia comparte
teléfono o cuenta.

### 3.3 Registro de otorgamientos: sólo se agrega

Columnas nuevas en `bono_otorgados`:
- `solicitud_id`, `identidad`, `operador`
- `base_monto`, `pct`, `regla` (jsonb: con qué evidencia se otorgó)
- `estado` (`OTORGADO` / `REVERTIDO`), `origen_registro` (`NODO`, `RECUPERADO`)
- `clave` (`solicitud_id:campana_id`, única: el mismo pedido no otorga dos veces)
- `clave_unica` (`campana_id:identidad` para las que son `NUNCA`, única mientras esté `OTORGADO`)

Revertir es una fila nueva que referencia a la otorgada; nunca se borra. La lista negra por COBRO se
escribe en la misma transacción.

### 3.4 Evidencia que se puede cotejar

- **App:** la marca que manda el teléfono queda como pista, no como prueba. Prueba = el pedido actual trae
  `navegador` con `· app` **y** existe un primer pedido desde la app (se guarda `app_primer_pedido_id` y
  `app_primer_pedido_at` en el vínculo, la primera vez). `landing_marcar_app_instalada` pasa a guardar
  `app_instalada_at` sólo la primera vez y deja de aceptar oficina vacía.
- **Notificaciones:** existe una suscripción activa en `push_subscriptions`. Se guarda su `created_at`
  en `regla` al otorgar. Que el teléfono diga "permiso concedido" no alcanza: el permiso y la suscripción
  son cosas distintas.
- **Tabla de evidencia** `bono_evidencias` (la idea de Gemini, que la llamó `dispositivos_pwa`): una
  fila por usuario y dispositivo con `primer_visto_app_at`, `primer_pedido_app_id`,
  `primer_pedido_app_at` y `push_activo_at`. **La escribe el servidor** al recibir un pedido o al
  guardar la suscripción; el Portal no escribe evidencia, porque lo que escribe el Portal lo puede
  escribir cualquiera. No hay forma de saber la hora exacta de instalación: `appinstalled` existe sólo
  en Chrome y Edge y se dispara al aceptar el cartel, y en iPhone no hay ningún aviso.
- Con eso, ante "activé todo y no me dieron el bono", se responde con fechas: cuándo activó, cuándo llegó
  su primer pedido desde la app, qué se le otorgó y por qué pedido. Lo que dice el navegador se puede
  falsificar; por eso se registra junto con la fecha en que el servidor lo vio.

### 3.5 Funciones (contratos)

Todas `SECURITY DEFINER`, `search_path=''`, y sin permiso para `anon` salvo la del Portal, que sólo
devuelve lo propio del jugador autenticado por oficina, usuario y teléfono.

```
bono_elegibilidad_v1(p_secret, p_pc_codigo, p_usuario, p_solicitud_id)  -- NODO. Valida, no consume.
  → {ok, identidad, revisar:[motivos], bonos:[{campana_id, nombre, tipo, pct|monto, monto_estimado,
     motivo, explicacion}], no_aplican:[{campana_id, nombre, por:'YA_COBRO'|'SIN_APP'|'SIN_NOTIF'|
     'LISTA_NEGRA'|'FUERA_DE_HORARIO'|'CUPO'|'TOPE'}]}
bono_otorgar_v1(p_secret, p_pc_codigo, p_solicitud_id, p_campana_ids bigint[], p_operador)
  → {ok, otorgados:[{id, campana_id, nombre, monto}], total}   -- el monto lo calcula el servidor
bono_vincular_carga_v1(p_secret, p_otorgado_ids bigint[], p_historial_op_id)  -- después de cargar fichas
bono_revertir_v1(p_secret, p_otorgado_id, p_motivo, p_operador)
landing_bonos_mios_v1(p_public_code, p_usuario, p_telefono)                    -- Portal
  → {ok, acreditados:[{nombre, monto, fecha, solicitud_id}], disponibles:[{nombre, explicacion,
     como_obtenerlo}]}
```

`panel_promo_primer_ingreso` queda como está hasta que NODO use `bono_elegibilidad_v1` en todas las
oficinas. Después se retira.

### 3.6 NODO

- Al abrir una carga del Portal (y en la ficha del jugador activo), NODO muestra los bonos que aplican,
  con su nombre y su explicación, y los que no aplican, con el motivo.
- Al aprobar: `bono_otorgar_v1` → carga de fichas con `origen='PROMO_BONO'` → `bono_vincular_carga_v1`.
  Si la carga de fichas falla, el otorgamiento queda pendiente de vincular y se ve así; no se pierde.
- Historial: filtro **Bonos** con nombre del bono, y totales del día separados de las cargas.
- Aviso al jugador por el chat ("🎁 Se te acreditó …"). Desde el 2/11 los avisos llegan aunque no tenga
  conversación abierta (D-135).
- Botón de Chunior en el historial de Inicio (**arreglado el 2/11**, `tests/bono-chunior.test.cjs`): el bono
  se anota en Chunior sin esperar, en fila detrás de la carga principal (hasta ~100 s). Cuando llegaba el
  número no se volvía a dibujar el historial, y si fallaba no quedaba en ninguna cola, así que el botón no
  se iba más. Ahora hace lo mismo que la carga del jugador. Falta verlo con un bono real: no se prueban
  cargas de fichas a propósito.

### 3.7 Portal (se puede lanzar antes que NODO)

- Sección "Mis bonos": lo acreditado, con nombre, monto, fecha y pedido, y lo disponible, con "cómo
  obtenerlo" ("Instalá la app y sumás 20 %"). Lee sólo del servidor, así que anda con el NODO actual.
- Mientras NODO no registre por campaña, `landing_bonos_mios_v1` también devuelve los `PROMO_BONO` de
  `historial_ops` sin otorgamiento, como "Bono de primer ingreso N %".
- Que se vea sin gritar: un renglón en el historial del jugador ("Carga $X · 🎁 bono $Y") y la sección
  aparte.
- En la pantalla de carga, antes de enviar, los bonos que le corresponden con el cálculo (idea de Gemini),
  y el desglose en el comprobante.
- Deja de usar `bet300_bono_usado`, que se guarda en el teléfono: borrando datos del navegador el
  jugador vuelve a ver la oferta de bienvenida. Lo dice el servidor.

### 3.8 Tandas: el lugar donde Juan carga "esta tanda tiene bono"

Tabla nueva `bono_tanda_entrada`. Se carga desde el editor de tablas de Supabase con un CSV, con las
columnas `campana_id, pc_codigo, usuario, nota`. Una función la procesa: valida, resuelve la identidad,
pasa cada fila a `bono_lista_usuarios` con su `tanda_id` y deja en `bono_tandas` quién la cargó, cuándo,
cuántos entraron y cuántos se rechazaron y por qué. El panel admin sigue usando `admin_bonos_lista_agregar`.

### 3.9 Lista negra

`bono_lista_negra` suma `identidad`, `alcance` (`CAMPANA` / `TODAS`), `motivo` (`COBRO`, `MANUAL`,
`ABUSO`) y `agregado_por`. La identidad puede ser teléfono, cuenta de cobro o usuario (idea de Gemini).
Se elige desde el panel admin. La regla de COBRO automática sigue.

Dos cosas distintas, que NODO muestra distinto:
- **Está en la lista negra:** el bono no se otorga (rojo).
- **Teléfono, titular o cuenta de cobro compartidos con otra cuenta:** aviso naranja; el operador decide
  y la operación sigue.

## 4. Orden de trabajo

Cada fase termina con su comprobación. No se empieza la siguiente con la anterior a medias.

| Fase | Qué | Quién | Termina cuando |
|---|---|---|---|
| F0 | Cerrar los agujeros de 1 | Claude (necesita OK de Juan para aplicar) | `anon` no puede llamar `bono_anotar` ni `bono_reiniciar_lista_negra`; el panel admin sigue reiniciando |
| F1 | Recuperar los 509 bonos posteriores al 4/10, igual que la copia del 4/10 | Claude | Cada `PROMO_BONO` desde el 4/10 tiene su fila con `origen_registro='RECUPERADO'` y su componente deducido del % |
| F2 | Evidencia de app y notificaciones (3.4) | Claude, servidor; **[Gemini]** pruebas del Portal | El vínculo tiene `app_primer_pedido_at`; marcar app con oficina vacía falla |
| F3 | Campañas separadas, identidad y registro (3.1 a 3.3) | Claude | Ensayo aislado: dos otorgamientos del mismo pedido dan uno; borrar el vínculo no habilita la bienvenida |
| F4 | `landing_bonos_mios_v1` y "Mis bonos" en el Portal | Claude, función; **[Gemini]** pantalla | Publicado en `intento`: `pruebaxx` ve sus bonos con nombre y monto |
| F5 | NODO: elegibilidad, otorgar, vincular, filtro Bonos y aviso | Claude | Carga de prueba en P1: bono otorgado, fichas cargadas, fila vinculada, aviso visto en el Portal |
| F6 | Tandas (3.8) y lista negra (3.9) | Claude, servidor; **[Gemini]** pruebas | Un CSV de 3 usuarios de prueba entra; NODO los detecta |
| F7 | Revinculación: `landing_portal_resolver_vinculo` (Portal), `cotejo-alta.js`, `operation-modal.js` y `jugadores-crm.js` (NODO), `servidor/crm-reconexion.sql` y `servidor/crm-perfil-y-vinculos.sql` | Aparte, con su propio plan | — |

**[Gemini] F4, pantalla "Mis bonos".** Archivo: `Portal`, solamente. Se agrega una sección que llama a
`landing_bonos_mios_v1` con `state.publicCode`, `state.usuario` y `state.telefono`, y dibuja las dos
listas con `esc()` para todo texto que venga del servidor. Prueba nueva en `tests/portal-bonos.test.cjs`
con servidor falso, copiando la forma de `tests/portal-beta-chat.test.cjs`: lista vacía, uno acreditado,
uno disponible, error del servidor (no rompe la pantalla), y un texto con `<script>` que no se ejecuta.
No publica: avisa a Claude.

**[Gemini] F2 y F6, pruebas.** Sólo archivos nuevos en `tests/`, con servidor falso. No toca código.

## 5. Decisiones que necesita Juan

1. ~~**Aplicar F0** (cerrar los dos agujeros).~~ Aplicado el 4/11.
2. **Identidad = teléfono** para "una sola vez". Alternativa: teléfono o titular, que es más estricta y da
   más falsos positivos en familias.
3. **Bono de app** exige que el pedido venga de la app (recomendado) o alcanza con haberla instalado.
4. **Las 9 oficinas sin promo:** se les prende el motor o siguen cargando bonos como carga común.
5. **Permiso para `apply_migration`** en la configuración, o aplicación por fase con su orden.

## 6. Lista de control: nada suelto

- [ ] Ningún bono se escribe sin `solicitud_id` ni operador.
- [ ] Ninguna función de bonos que escriba es llamable con la clave pública.
- [ ] El monto lo calcula el servidor, nunca NODO ni el Portal.
- [ ] Reintentar un otorgamiento no duplica (clave única).
- [ ] Borrar o renombrar un usuario no habilita de nuevo la bienvenida.
- [ ] Toda fila de `historial_ops` con `PROMO_BONO` tiene su otorgamiento.
- [ ] El jugador ve en el Portal cada bono acreditado con nombre y monto.
- [ ] NODO muestra los bonos aparte de las cargas, por oficina y en total.
- [ ] La vuelta atrás de cada cambio de servidor está ensayada.
- [ ] El panel admin de la encargada sigue funcionando: se prueba `admin_bonos_listar` después de cada fase.

## 7. La propuesta de Gemini (2/11): qué se suma y qué no

Gemini 3.8 Flash propuso tres pilares: base de datos, Portal y NODO. Coincide en lo central: un registro
propio de bonos, separado de las cargas; catálogo con %, topes y condiciones; lista negra; tarjeta de
bonos en NODO con el cálculo desglosado; y que el jugador lo vea. Lo que suma y lo que no:

| Propuesta | Se toma | Por qué |
|---|---|---|
| Tablas nuevas `bonos_catalogo`, `bonos_otorgados`, `bonos_blacklist` | **No**: se completan `bono_campanas`, `bono_otorgados` y `bono_lista_negra` | Ya existen, tienen 4.591 otorgamientos y la lista negra cargados, y la pantalla de Promociones del panel admin trabaja sobre ellas. Tablas paralelas = dos verdades |
| `dispositivos_pwa` con fechas de app, push y primer pedido | **Sí**, como `bono_evidencias` (3.4) | Es la pieza que falta para cotejar los reclamos |
| Detectar push con `Notification.permission` y app con `beforeinstallprompt` + standalone | **Sólo como pista** | Lo dice el teléfono y se puede falsificar; es lo que hace hoy la tarjeta del Portal. `beforeinstallprompt` avisa que se *puede* instalar, no que se instaló |
| El Portal registra el evento en `dispositivos_pwa` antes de mandar el pedido | **No** | Es el mismo agujero que `landing_marcar_app_instalada`. La evidencia la escribe el servidor |
| Hora exacta de instalación | **No existe** | Ver 3.4 |
| Lista negra por teléfono, cuenta de cobro o usuario | **Sí** (3.9) | — |
| Bloquear solo por cuenta compartida | **No**: aviso naranja | Las familias comparten teléfono y cuenta; las herramientas de antifraude lo mandan a revisión |
| Registro inmutable con hash de auditoría | **No por ahora** | Sin permiso para modificar ni borrar, y anulando con un registro nuevo, alcanza. Un hash no frena a quien administra la base |
| `nodo_aplicar_bono_v1` en una transacción con bloqueo | **Sí**, dentro de `bono_otorgar_v1` | Además de la clave única, que ya evita otorgar dos veces |
| Anotar bono y carga juntos en Chunior | **No** | El bono va a la billetera PROMO para que Chunior lo audite aparte. El desfase del botón ya se arregló (3.6) |
| Dejar de depender de `bet300_bono_usado` | **Sí** (3.7) | — |
| Bonos disponibles en la pantalla de carga y desglose en el comprobante | **Sí** (3.7) | — |
| Tipo `RECARGA_RANGO` | **Sí**, como tipo `PROMO` con condición de monto | Estaba en el prototipo de Juan como "Recarga" |

**Lo que la propuesta de Gemini no cubre y está en este plan:**
- los dos agujeros de seguridad (F0);
- que el motor existe y lo usa el panel admin;
- recuperar los 509 bonos posteriores al 4/10;
- la carga de tandas, que es "esta tanda de usuarios tiene bono";
- que borrar al usuario no lo habilite de nuevo;
- las nueve oficinas sin promo;
- el orden de trabajo con su comprobación y la vuelta atrás de cada cambio de servidor.

## Fuentes

- Validar y redimir por separado; cada intento queda registrado: https://docs.voucherify.io/optimize/validations-and-redemptions
- Reglas de combinación: https://docs.voucherify.io/orchestrate/using-stacking-rules-and-categories
- Topes por campaña y por cliente: https://docs.talon.one/docs/product/campaigns/settings/manage-campaign-budgets
- Audiencias cargadas por lote: https://docs.talon.one/docs/product/audiences/create-audiences
- Claves para no repetir un pedido: https://docs.stripe.com/idempotency
- Índice único parcial: https://www.postgresql.org/docs/current/indexes-partial.html
- Registro inmutable: https://moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger
- Detectar la app instalada y sus límites: https://web.dev/learn/pwa/detection
- Notificaciones en iOS sólo con la app agregada: https://webkit.org/?p=13878
- Abuso de bonos: señales para revisar, no para bloquear solas: https://track360.io/blog/bonus-abuse-detection-igaming-operator-playbook-2026
