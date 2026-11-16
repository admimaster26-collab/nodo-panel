# Prueba Portal contra NODO: recorrer el flujo como la persona que lo usa

Leer antes de decir que algo "anda", sea una pantalla, un apartado, un botón o una función que nadie ve.
Juan, 16/11: "sos una IA, tu tarea es recorrer el flujo del usuario como para detectar estos problemas".
La prueba es la misma aunque el jugador no vea el cambio: para el operador de NODO cumple el mismo papel.

Que las pruebas de `npm test` pasen, que el servidor conteste 200 o que la función exista **no es
"anda"**. Anda cuando la persona hace lo que vino a hacer y ve lo que tiene que ver. Ver también
`docs/FLUJOS.md` (qué hace cada uno), `docs/BOTONES.md` y `docs/CANALES.md`.

## 1. Leer la pantalla como alguien de afuera

Antes de cerrar, mirar la captura y preguntarse: *"soy ajeno a la herramienta: ¿qué significa esto,
con lo que veo en la pantalla?"*. Si la respuesta es "no sé", está mal, aunque sea técnicamente cierto.

- **Nada técnico a la vista.** No van "procesos en segundo plano", "tareas de fondo",
  `WORKERS_ENABLED!=1`, códigos (`BETA_CHAT_CLOSED`), inglés ni nombres de funciones. Si falla, ni el
  operador ni Juan ni el modelo van a saber qué quiere decir, y se termina adivinando.
- **Una falla dice qué operación no anda y qué sí.** Si falla retirar fichas y cargar no, se tiene que
  leer "Retirar fichas en Agentes: Agentes tardó demasiado en contestar" y "Cargar fichas en Agentes:
  sin fallas". Así el operador sabe qué puede seguir haciendo y qué hacer a mano.
- **Al jugador se le dice cajero**, nunca oficina, soporte técnico, solicitud ni "una persona".
- **Cada cosa nueva lleva su explicación corta** donde aparece. Un nombre provisorio, una marca o un
  estado que no se explica se lee como otro dato (así "ayuda-1111111111" se cotejaba como usuario).
- **Ninguna opción pisa el trabajo de otro.** Si el jugador está esperando que el operador lo valide,
  no se le ofrece "Validar mi cuenta" ni "Soy nuevo": se le dice que su mensaje llegó, que lo vieron y
  que no tiene que hacer nada. Señal de vida sí; opciones que repiten lo que ya pidió, no.

## 2. Por dónde viaja un mensaje (para saber qué mirar)

```
Jugador (Portal)                     Servidor                                   Operador (NODO beta)
landing_chat_abrir_v3 ─────────────▶ chat_sesiones
landing_enviar_mensaje_v2 ─────────▶ chat_mensajes ──▶ disparadores de la tabla
                                        │               (el bot de palabras vive acá, NO en los canales)
                                        └────────────▶ nodo_beta_chat_lista_v1 / _mensajes_v1  ──▶ lo ve
                                     chat_lecturas  ◀── nodo_beta_chat_leido_v1  ◀─────────────── lo abre
landing_beta_chat_leer_v1 ◀───────── (✓✓ = visto confirmado)
landing_beta_chat_leer_v1 ◀───────── chat_mensajes ◀── nodo_beta_chat_enviar_v1 ◀────────────── contesta
```

- Los canales nuevos (`nodo_beta_chat_*`) los usa NODO beta: hoy sólo P1 (`nodo_beta.beta_clientes`).
- Lo que se dispara **en la tabla** corre para todos los canales, viejos y nuevos. Por eso el bot
  contestaba en P1 aunque NODO ya leyera por los canales nuevos. Desde el 16/11 no contesta en oficinas
  beta (`servidor/bot-apagado-en-beta.sql`).

## 3. Puertos y lugares (no pisar el puesto de Juan)

| Qué | Dónde | Regla |
|---|---|---|
| NODO de Juan | puerto 9222 | Sólo lectura (`Runtime.evaluate` que no cambie nada). Nunca recargar ni apretar botones. |
| Otro NODO de prueba ya abierto | puerto 9333 | Es de otra sesión: no cerrarlo ni usarlo. |
| Navegador del jugador de prueba | 9335 / 9336 | Edge sin ventana, perfil nuevo en la carpeta temporal. |
| Portal de prueba | `http://127.0.0.1:8797/` sirviendo el archivo `Portal` | Entra solo como **P1** y muestra el cartel "PRUEBAS · P1". |
| Operador | `main/panel-rpc.js` con `%LOCALAPPDATA%/NODO/beta/connection.json` | Es el mismo puente que usa NODO; nunca pegar la credencial en el repo. |
| Jugador ficticio | teléfono `1111111111`, usuario vacío o `pruebaxx` | Nunca usuarios reales. El teléfono de `pruebaxx` no va al repo. |

Un NODO de prueba propio (`electron . --dev --remote-debugging-port=9337 --user-data-dir=<temporal>`)
arranca pidiendo **Ingresar** con usuario de operador: el modelo no tiene esa clave, así que la pantalla
de NODO la mira Juan en su NODO (punto 5) y el modelo prueba el lado del operador por el puente.

## 4. El recorrido, paso a paso

`node scripts/prueba-portal-nodo.cjs <carpeta-de-capturas>` hace todo esto y deja capturas y
`resultado.json`. Para otro caso (carga, retiro, registro) copiar el script y cambiar el paso 1.

1. **El jugador hace lo que haría.** Abrir el Portal, tocar el camino (por ejemplo "Tengo usuario pero
   no puedo entrar"), dejar vacío lo que una persona dejaría vacío. Probar también **antes de que termine
   de arrancar** (2,5 s): con conexión lenta pasan cosas distintas.
   - Pasa si: se queda en el chat, se ve su mensaje con ✓ y el asistente sólo dice que llegó.
2. **Mirar la base.** Una fila del jugador en `chat_mensajes`; ninguna respuesta automática en una
   oficina beta; el texto dice lo que el jugador hizo (si no escribió usuario, dice eso, no inventa uno).
3. **NODO lo ve y lo abre** por el canal nuevo (`nodo_beta_chat_mensajes_v1`, `nodo_beta_chat_leido_v1`).
   - Pasa si: en el Portal aparecen ✓✓ y, mientras espera, "👀 Tu cajero ya vio tu mensaje." una vez.
4. **El operador contesta** (`nodo_beta_chat_enviar_v1`).
   - Pasa si: el globo del cajero aparece **una sola vez** en el Portal, en orden, y sigue ahí al recargar.
5. **La pantalla de NODO.** Con la consulta abierta en el NODO de Juan (o el suyo, actualizado):
   la tarjeta de cotejo muestra lo que el jugador escribió, con su explicación, y el botón de enviar anda.
6. **Leer todo como ajeno** (punto 1) en cada captura. Recién ahí se puede decir "anda", y se dice qué
   se probó y qué no.
7. **Dejar limpio.** Las consultas de prueba quedan abiertas en P1 con el usuario `ayuda-1111111111`:
   cerrarlas desde NODO con "Cerrar consulta" (sirve además para probar ese botón).

### Medir demoras

`node scripts/medir-demora-chat.cjs <perfil-del-navegador>` manda tres mensajes como jugador y tres como cajero y dice
cuánto tardó cada uno en verse del otro lado. Para probar código nuevo de NODO sin iniciar sesión: levantar un
NODO propio (`--remote-debugging-port=9337 --user-data-dir=<temporal>`) y, por DevTools, fijar la oficina
(`pcOperativa='P1'; window.pcOperativa='P1'`), llamar `iniciarBroadcastChat()` y `nodoCargarChatsPortal(true)`.
Así corre el chat de verdad contra el servidor sin tocar Chunior ni las solicitudes. Cerrarlo al terminar.

## 5. Lo que encontró esta prueba el 16/11 y cómo quedó

| Problema que vio Juan | Causa | Arreglo |
|---|---|---|
| En NODO el usuario figuraba como "pero" (u otra palabra) | El cotejo tomaba la palabra que seguía a "usuario" en cualquier frase: "Tengo **usuario pero**…" daba "pero"; "usuario nuevo" daba "nuevo". | `renderer/core/cotejo-alta.js`: sólo vale con rótulo ("Usuario: X", "mi usuario es X"), el último. "ayuda-…/nuevo-…" son nombres provisorios y se explican en la tarjeta. Prueba: `tests/cotejo-usuario-declarado.test.cjs`. |
| El Portal mandaba "Usuario: ayuda-1111111111" | Cuando el jugador deja el usuario vacío, el Portal le pone ese nombre provisorio y lo escribía como si fuera suyo. | `Portal` (`enviarAltaSoporte`): dice "No escribí mi usuario". |
| El bot contestaba en NODO 1.6 | El bot es un disparador sobre la tabla `chat_mensajes` (y `landing_solicitudes`): no está en ningún canal, así que contestaba igual con los canales nuevos. No se duplicó: nunca se sacó de abajo. | Servidor: `_soporte_bot_apagado` en los dos disparadores. En oficinas beta (hoy P1) no contesta; las demás, igual que antes. Publicado y ensayado; vuelta atrás en `servidor/bot-apagado-en-beta.vuelta-atras.sql`. |
| "El chat no aparece" | Si el arranque del Portal terminaba después del pedido (conexión lenta), mandaba al jugador a Inicio y el chat quedaba tapado. | `Portal`: el arranque no saca a nadie del chat. Inicio, mientras espera, dice "Tu cajero ya tiene tu pedido" con un botón al chat, sin "Ya me activaron". |
| El chat ofrecía "Validar mi cuenta" / "Soy nuevo" esperando al operador | El asistente se pintaba antes de que saliera el pedido y no se acordaba de él al volver. | `Portal`: mientras sale no habla; después sólo espera ("Tu mensaje le llegó a tu cajero…"), avisa cuando lo vieron y lo recuerda un día en el teléfono. |
| El mensaje del jugador tardaba en aparecer en NODO (hasta 25 s medidos) | El aviso del servidor caía dentro de los 15 s de la lista y se ignoraba; el reloj leía una vuelta de cada dos. | `renderer/chat/chat-canal-nuevo.js` + `renderer/runtime/realtime.js`: el aviso invalida la lista y se lee en el momento (0,8 a 1,0 s medidos). Detalle en `docs/CANALES.md` §12. |
| Estado del sistema: "Tareas de fondo · No respondió bien" | Todas las operaciones en Agentes se anotaban juntas. | `renderer/runtime/integration-health.js`: una fila por operación (cargar, retirar, crear usuarios, cambiar claves, buscar, saldo) con el motivo en castellano. |

## 6. Qué decir al terminar

1. Qué se recorrió y con qué datos (oficina, usuario ficticio, número de chat).
2. Qué se vio en cada paso, con la captura.
3. Qué **no** se pudo probar y por qué (por ejemplo, la pantalla de NODO sin clave de operador), y qué
   tiene que mirar Juan para cerrarlo.
