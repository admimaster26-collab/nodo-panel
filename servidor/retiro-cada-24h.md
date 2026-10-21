# Un retiro cada 24 horas — plan de integración  ·  21/10

Juan, 21/10: *"en primer lugar no tenian que llegar las solicitudes de retiro si tiene un retiro
anterior a 24hrs contabilizando el primer retiro parcial en caso se haya realizado parcial, pero,
aun asi, en caso aparezca estaria bueno que si falta poco por lo menos aparezca un contador como
'faltan tantos minutos para que pueda' y que el portal le realice el aviso de que todavia no pero
ya esta en proceso para cuando cumpla el horario."*

Y después, la pregunta que decide todo: *"vas a tener que ver que es mejor, dejar el error como
caracteristica para los vivos que quieren retirar antes cambiando de link celular o algo o
directamente no permitirlos."*

---

## 1 · Lo que hay hoy: tres respuestas distintas a la misma pregunta

Hoy "¿este jugador ya retiró en las últimas 24 horas?" se contesta en **tres lugares que no se
hablan entre sí**, y los tres contestan distinto.

| | dónde vive | qué mira | problema |
|---|---|---|---|
| **Portal** | `localStorage` del celular | una fecha guardada en el teléfono | se borra cambiando de navegador, de celular, o limpiando datos |
| **NODO** | `verificarRetiro24h()` | 3 consultas desde la PC: solicitudes + historial + CSV | **descarta los parciales**; cada pantalla la llama por su cuenta (6 lugares) |
| **Servidor** | `landing_puede_solicitar_retiro` | 3 tablas enteras convertidas a JSON | **3.599 ms** — el servidor corta a los 3.000; y **cuenta cada parcial como un retiro aparte** |

### El freno del portal es el único que frena, y es de mentira

`Portal:2255` guarda la fecha del último retiro en el `localStorage` del teléfono. Eso frena al
jugador honesto que vuelve a entrar por el mismo lado. **No frena a nadie más.**

### El del servidor no se puede usar

Medido el 21/10 contra la base de producción:

```
explain analyze select * from landing_puede_solicitar_retiro('soledadsoo','','P4');
  Execution Time: 3599.922 ms
```

Recorre las 394.494 filas de `historial_ops` convirtiendo **cada fila entera a JSON** para poder
leerle un campo. Son 3,6 segundos contra un techo de 3. O sea: desde el portal **se cae siempre**.

Peor: `panel_controlar_retiro_24h_v21`, que es la que llamaría el panel, la envuelve así:

```sql
exception when others then
  return query select false, false, ('Control 24h no disponible: ' || sqlerrm)::text, 0, null;
```

**Se traga el error y contesta "no bloquear".** Si tarda de más, el control dice que todo bien.

### Y el de NODO hace justo lo contrario de lo que pedís

`verificarRetiro24h` descarta los parciales a propósito (`_blEsParcial`) y se queda con el último
retiro **no** parcial. Vos querés contar **desde el primer parcial**.

---

## 2 · Lo que cuesta hoy, en números

Medido sobre los últimos 14 días (3.777 retiros):

| | cuántos | plata |
|---|---|---|
| Retiros pedidos dentro de las 24 h del anterior | **34** (0,9 %) | |
| → que el operador **rechazó** | 22 | $ 4.099.800 |
| → que se **pagaron** | **12** | **$ 5.204.200** |

Y el dato que contesta tu pregunta: **la función para registrar que el operador apretó "Proceder
igualmente" existe desde hace rato y tiene CERO filas.** Nunca se llamó. Así que de esos 12 pagos
**no sabemos cuáles fueron una decisión del operador y cuáles se le pasaron.**

> 22 rechazos en 14 días son 22 veces que un operador trabajó para terminar diciendo que no, por
> una regla que el sistema podía haber aplicado solo.

---

## 3 · El debate: ¿se cierra o se deja pasar?

Esta es la decisión. Las dos posturas, honestas:

### Dejarlo como está ("que pase el que insiste")

A favor: nunca traba un caso legítimo, y el operador decide siempre.

En contra: hoy la regla es **"un retiro cada 24 horas, salvo que sepas cambiar de navegador"**.
El jugador honesto queda frenado y el que busca la vuelta pasa. Es lo peor de los dos mundos: no
protege, y además castiga al que no la busca.

### Cerrarlo en el servidor

Lo que destraba la decisión es una asimetría que hoy no se ve:

> **Cerrar el portal NO cierra al operador.**

El operador no crea los retiros por `landing_portal_v16_crear_solicitud`. Los crea desde el panel,
por otro camino. Si el bloqueo va en la RPC del portal:

- el **jugador** deja de poder saltar la regla cambiando de celular — porque la fecha ya no vive en
  su teléfono, vive en el servidor
- el **operador** conserva exactamente el mismo poder que hoy, incluido el "Proceder igualmente"

Y hay una razón de fondo: **el jugador que esquiva el freno siempre lo hace a propósito; el
operador que lo saltea siempre está tomando una decisión.** Sacar lo primero y conservar —y
registrar— lo segundo es quedarse con la parte buena de las dos.

**Recomendación: cerrar en el servidor, dejar el override del operador, y empezar a registrarlo.**
Si después los números muestran que hay muchos casos legítimos, el override queda escrito y se
puede aflojar con datos en vez de a ojo.

---

## 4 · Por dónde pregunta cada uno

Tu otra opción era *"hacer que hagan consultas directas a nodo o a servidor"*.

**Al servidor, y uno solo.** NODO no puede ser el que contesta: son 25 PCs detrás de la red de cada
oficina, el portal no tiene cómo llegarles, y si la PC está apagada el jugador se queda sin
respuesta. Además hay 24 PCs en 2.1.5 y una en 1.2.0 — si el freno depende de la versión del panel,
la oficina vieja queda sin freno.

Es la misma lección de las solicitudes duplicadas: **lo que se arregla en el servidor funciona en
todas las versiones instaladas, sin publicar nada.**

```
                   ┌─────────────────────────────┐
   Portal  ───────▶│  landing_retiro_habilitado  │◀─────── NODO (las 6 pantallas)
                   │        1,6 ms               │
   crear_solicitud ▶└─────────────────────────────┘
```

Un solo lugar contesta. El portal lo usa para la pantalla, la RPC de creación lo usa para frenar, y
NODO reemplaza con esto sus 3 consultas propias.

**Que se puede hacer rápido ya está probado**, con los índices que ya existen:

```
Execution Time: 1.577 ms        (contra 3.599 ms de la función actual)
  Index Scan using idx_landing_sol_pcupper_usuario_fecha
  Index Scan Backward using idx_historial_ops_usuario_fecha
```

---

## 5 · Cuándo arranca el reloj

Esta es la parte fina de tu pedido.

- **Retiro común** → cuando entró la solicitud.
  Medido en 30 días (6.683 retiros pagados): entre que el jugador pide y se le paga, la **mediana
  es de 3 minutos**, el 90 % está dentro de los 42. O sea que "desde que pidió" y "desde que cobró"
  son prácticamente lo mismo, y "desde que pidió" es lo que el operador ya ve en pantalla.

- **Retiro pagado por partes** → **el primer pago parcial**, como pediste.
  El dato ya está guardado y no hay que inventar nada:
  `metadata.retiro_parcial.pagos[0].fecha`.

  Ejemplo: retiro pedido 10:00, primer parcial 10:33, segundo 14:00, cerrado 18:00.
  → habilitado al otro día **10:33**, no a las 18:00. Es a propósito más generoso: el jugador no
  paga el precio de que nosotros le hayamos pagado en tandas.

**Por oficina.** Juan, 21/10: *"nos chupan un huevo las demas oficinas, los usuarios son unicos por
oficina."* Y la base dice lo mismo: en 30 días hubo **28 casos y los 28 son dentro de la misma
oficina**, cero entre oficinas. Así que el control filtra por `pc_codigo` y no se pregunta nada
más — que es además lo más barato, porque la oficina ya es la primera columna del índice que se
usa.

---

## 6 · El plan, en tres patas

### 🗄️ SERVIDOR — es lo único imprescindible

**6.1 · `landing_retiro_habilitado(p_pc, p_usuario)` — nueva, rápida, una sola verdad**

Devuelve:

```json
{ "puede": false, "puede_desde": "2026-10-21T10:33:00Z", "faltan_min": 197,
  "anterior": { "fecha": "...", "monto": 350000, "billetera": "GIORDANO",
                "por_partes": true, "origen": "SOLICITUD" } }
```

Mira dos fuentes con índice: `landing_solicitudes` (retiros no rechazados, tomando
`pagos[0].fecha` si hubo parciales) e `historial_ops` (los manuales). La tabla `solicitudes` vieja
—156 filas, muerta desde mayo— **no se mira más**.

**6.2 · El freno dentro de `landing_portal_v16_crear_solicitud`**

Para `RETIRO`, después del control de vínculo y **antes** del anti-duplicado. Si no puede, no
inserta: devuelve el motivo y la hora de habilitación. El bloqueo real está acá — lo demás es
pantalla.

**6.3 · Registrar el override**

`panel_registrar_override_retiro_24h_v21` ya existe y nunca se llamó. Que NODO la llame cuando el
operador aprieta "Proceder igualmente", con el motivo. Es la única forma de saber después cuántos
de esos pagos fueron decisión y cuántos se pasaron.

**6.4 · El aviso se manda solo — nadie tiene que pedirlo**

Juan, 21/10: *"la notificacion push debe de ser en caso un usuario pida un retiro en un horario que
no es? podriamos enviarla igual diciendo 'ya pasaron 24hrs desde tu retiro anterior, tu usuario
vuelve a estar habilitado para retirar fichas'."*

Exacto, y así se ahorra el botón: **el que intentó retirar ya pidió que le avisen.** Intentarlo ES
la suscripción. Cuando el freno rebota a un jugador, queda anotado:

```sql
create table landing_retiro_avisos (
  pc_codigo text, usuario text,      -- (pc, usuario) es la clave: uno solo por jugador
  puede_desde timestamptz,           -- la hora que ya calculó landing_retiro_habilitado
  intentos int default 1,            -- cuántas veces lo intentó mientras esperaba
  avisado_at timestamptz             -- null = todavía no se le avisó
);
```

Si vuelve a intentar, se suma un intento y no se duplica el aviso.

**El aviso lo manda el servidor, no NODO.** Hoy los push salen de NODO llamando a
`https://portal-bet300-a4xj.vercel.app/api/send-push` con `x-push-secret`. Eso sirve para avisar
cosas del momento, pero acá el aviso tiene que salir a una hora en la que **puede no haber ninguna
PC prendida** — a las 3 de la mañana, por ejemplo.

Con lo que ya está instalado (`pg_cron 1.6.4` y `pg_net 0.20.0`) el servidor lo manda solo:

```
pg_cron, cada 5 minutos
  → los avisos con puede_desde <= now() y avisado_at is null
  → que tengan suscripción activa en push_subscriptions
  → pg_net POST al endpoint de push con el secreto leído del Vault
  → se marca avisado_at
```

Texto del aviso, el tuyo:

> **BET300** · Ya pasaron 24 hs desde tu retiro anterior.
> Tu usuario vuelve a estar habilitado para retirar fichas.

El secreto va en el **Vault de Supabase**, no escrito en el código. Hoy `PUSH_SECRET` está en
`renderer/core/configuracion-y-estado.js` en texto plano, en un repo público — eso ya está anotado
como **D-63** y esta es una buena excusa para sacarlo de ahí.

### 📱 PORTAL

**6.5 · El contador, con la hora del servidor**

Hoy `goRetiro()` tira un `toast` y listo. Pasa a mostrar una pantalla con el tiempo que falta,
**calculado desde `puede_desde` que manda el servidor** — no desde el `localStorage`, porque si el
reloj lo pone el teléfono se saltea cambiando la hora del celular.

El `localStorage` se deja igual, pero sólo como primer filtro para no ir al servidor al pedo. El
que manda es el servidor.

**6.6 · La puerta al chat**

Decidido el 21/10: el freno es duro, **pero con salida**. Abajo del contador va
*"Creo que es un error"* → lo manda al chat, donde un operador lo ve y decide. El chat es
`SOPORTE` y nunca estuvo frenado por nada, así que no hay que tocar ese camino.

Sin esa puerta, el jugador con un caso legítimo se queda sin a dónde ir y termina abriendo otra
cuenta — que es peor que el problema que estamos arreglando.

### 🖥️ NODO

**6.7 · Que las 6 pantallas pregunten en un solo lugar**

`verificarRetiro24h` se reescribe para llamar a `landing_retiro_habilitado` en vez de hacer sus 3
consultas. **Las 6 llamadas se tocan, no una:**

```
renderer/core/agentes-cola-y-sesion.js:497
renderer/core/automatizaciones.js:554
renderer/core/chat-acciones.js:21
renderer/core/lotes-y-solicitudes.js:522
renderer/core/operaciones-manuales.js:483
renderer/portal/operation-execution.js:264
```

**6.8 · El contador en el modal y en la fila**

Hoy dice *"Habilitado nuevamente: 21/10 - 10:33"*. Pasa a decir **"faltan 3 h 17 min"**, en vivo, y
también en la fila de la bandeja — no sólo adentro del modal, para que se vea antes de abrirlo.

Si fue por partes, que lo diga: *"contando desde el primer pago parcial de las 10:33"*.

---

## 7 · En qué orden, y qué se gana en cada paso

| | qué | dónde | llega a los jugadores | hay que publicar algo |
|---|---|---|---|---|
| **1** | `landing_retiro_habilitado` + el freno dentro de la RPC de creación | servidor | **sí, el mismo día** | **no** |
| **2** | Tabla de avisos + `pg_cron` que manda el push | servidor | **sí, el mismo día** | **no** |
| **3** | Contador en pantalla + puerta al chat | portal | cuando publiques el portal | sí, el portal |
| **4** | Una sola consulta, contador en la fila, registrar el override | NODO | — | sí, 2.1.6 |

**Los pasos 1 y 2 solos ya resuelven todo lo que pediste**: dejan de llegar las solicitudes de
retiro adelantadas, y al jugador le llega el aviso cuando se le cumple la hora. En las 14 oficinas
y también en la PC de 1.2.0, **sin tocar una sola PC ni publicar nada**.

Los pasos 3 y 4 son la parte linda: que el jugador vea cuánto falta en vez de un cartel seco, y que
el operador vea el contador en la fila sin abrir el modal.

---

## 8 · Lo que quedó decidido (21/10)

1. **Freno duro, con puerta al chat.** La solicitud no se crea. El jugador ve el contador y un
   botón para reclamar que lo lleva al chat. **El operador no pierde nada**: sigue pudiendo
   crearlo desde el panel, y sigue teniendo el "Proceder igualmente" — ahora registrado.

2. **El aviso se manda solo, sin botón.** El intento de retirar es la suscripción. Lo dispara
   `pg_cron` desde el servidor, así que sale a la hora que corresponda aunque no haya ninguna PC
   prendida.

   **No** se crea una solicitud programada. Una solicitud en un estado nuevo la verían las 24 PCs
   en 2.1.5 y la de 1.2.0 sin saber qué es: una pendiente que nadie puede resolver. Cuando 2.1.6
   esté en todas las oficinas se puede volver sobre esto.

3. **Por oficina**, porque los usuarios son únicos por oficina.

4. **El reloj arranca en el primer pago parcial** cuando el retiro se pagó por partes.

5. **El rechazo del operador libera el reloj.** Hoy el portal ya lo hace (`Portal:1688`) y está
   bien: si no se pagó, no hubo retiro. Queda igual, pero decidido en el servidor y no en el
   teléfono del jugador.

---

## 9 · Cómo se prueba

Las tres patas tienen que tener una prueba que **falle contra el código de hoy**:

- **servidor**: ejecutar `landing_retiro_habilitado` contra casos reales de la base — un retiro
  común, uno pagado por partes (que tiene que contar desde `pagos[0]`), uno rechazado (que no
  cuenta), y uno de hace 25 horas (que tiene que dar libre). Y que tarde menos de 10 ms.
- **portal**: que el contador salga de `puede_desde` del servidor y no del `localStorage` —
  adelantando el reloj del navegador, el freno tiene que seguir.
- **aviso**: que un jugador frenado quede anotado una sola vez aunque insista cinco veces, que el
  cron no le mande el push antes de la hora, que se lo mande una sola vez, y que a uno sin
  suscripción activa no se le intente mandar nada.
- **NODO**: que las 6 pantallas den la misma respuesta, y que un retiro por partes cuente desde el
  primer pago y no desde el último.

Y una prueba que no es de código: **antes de prender el freno**, correr `landing_retiro_habilitado`
contra los 34 casos de los últimos 14 días y mirar uno por uno si el freno los habría agarrado
bien. Si alguno de los 12 que se pagaron era legítimo, aparece ahí y no en producción.
