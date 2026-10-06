# Los botones de una fila son lo que se puede hacer CON esa fila  ·  6/10

Juan, por quinta vez: *"no hay billetera registrada si no se realizó la carga... si hay cosas que
involucran a otra cosa relacionada... una solicitud con todo lo que se puede hacer en base a eso,
ver el historial revisar el usuario la clave y ahora que tenemos lo de recuperar solicitudes
eliminadas, ponelo ahí."*

## Lo que estaba mal

Su fila:

```
6/10 · 11:37 · CARGA · gracieeela228 · $10.000 · saldo pre — · saldo post — · GIORDANO · PORTAL · ✖
botones: 🔍   💳 Cambiar billetera   🔑 Clave
```

**La plata nunca se movió**: no hay saldo antes, no hay saldo después, no hay N° de Chunior.
"Cambiar billetera" corrige la billetera donde quedó **anotada una operación** — su propio cartel
lo dice. En una rechazada no hay operación ni billetera anotada: el botón ofrece corregir algo que
no existe.

La condición era `esOperacionDinero && (hay id de historial || es solicitud con número)`. Una
carga rechazada cumple las dos cosas: es de dinero y tiene número. Por eso aparecía — y también
en las **pendientes**, por el mismo motivo.

## Lo que quedó

Se agrega la pregunta que faltaba: **¿esta operación ocurrió?**

```
_huboMovimiento = tiene N° de Chunior  ||  el estado es OK/acreditada/pagada  ||  tiene saldo después
```

| fila | Cambiar billetera | Recuperar | Deshacer |
|---|---|---|---|
| carga hecha, con N° de Chunior | sí | no | sí |
| carga hecha, sin N° pero con saldos | sí | no | sí |
| carga **rechazada** | **no** | **sí** | no |
| carga **pendiente** | **no** | no | no |

**El botón nuevo: ↺ Recuperar.** En una rechazada, lo que sí se puede hacer es volver a ponerla en
revisión y resolverla. Va con el número de la **solicitud** (que no es el del movimiento — ver
`lupa-abria-otro-jugador.md`).

**No borra el motivo del rechazo.** Queda guardado como `motivo_previo`, junto con quién la
recuperó y cuándo. Saber por qué se rechazó era justamente lo que faltaba (4/10): recuperarla no
puede ser la forma de perderlo.

**🔑 Clave sigue en todas**: es una acción sobre el usuario, no sobre la operación.

## Pruebas

`tests/botones-de-la-fila.test.cjs` — 7, una por tipo de fila, con los datos de la foto.
Contra el código anterior **fallan 3**: la rechazada ofrecía cambiar billetera, no ofrecía
recuperar, y la pendiente también ofrecía cambiar billetera.

Suite completa: **452, 0 fallas.**

## Lo que queda de este mismo pedido

Juan nombró otro caso que todavía no está: *"movimientos de billetera con un historial de lo
mismo"* — una fila de MOV_BILLETERA debería poder abrir el historial de esa billetera. Es una
vista que no existe; va aparte para no inventarla a medias.

---

## Copiar la cuenta desde la fila  ·  6/10

Juan: *"podemos copiar fácilmente el usuario, de lo cual ya casi no nos sirve para nada pero no
podemos copiar fácilmente el cbu u el alias"*.

El usuario está para leerlo. Lo que el operador **pega** es la cuenta — y para eso había que abrir
la ficha. Ahora hay un 📋 en la columna Billetera, con el copiado que ya existía
(`portalCopiarCbu`, el que cae a `execCommand` cuando el portapapeles moderno falla en Electron y
sólo canta "copiado" si de verdad copió).

**Va rotulado, y no es adorno:**

| fila | qué copia | rótulo |
|---|---|---|
| RETIRO | la cuenta **del jugador** — a donde hay que pagarle | `📋 CBU` |
| CARGA | la cuenta **nuestra** — a la que transfirió | `📋 Alias` |

Copiar la que no era es pagarle a la cuenta equivocada. Si una fila no tiene cuenta, no aparece
ningún botón.

La cadena vive en `NodoDomain.identidad.destino()`, junto con la del teléfono y la del titular:
una sola, no una por pantalla. Sirve también para las filas viejas del historial, que lo tienen
en las notas (`CBU/CVU: …`).

**Pruebas:** 5 en `identidad-un-solo-lugar.test.cjs` y 3 en `botones-de-la-fila.test.cjs`,
incluida la que importa — que en un RETIRO con los dos datos presentes gane el del jugador.
Suite completa: **460, 0 fallas.**
