# Quién es este jugador: un solo lugar  ·  6/10

Juan, por tercera vez: *"SI HAY ALGO, UNA LLAMADA QUE PIDE UN NUMERO DE TELEFONO DE UN USUARIO,
BUSCA DONDE SE DIBUJA Y PREGUNTA SI FUNCIONA Y COPIA LA DIRECCION... NO HAGAS DOS BUSQUEDAS
DISTINTAS DEL NUMERO DE TELEFONO."*

## El mapa, medido

**El teléfono.** 27 archivos del panel lo tocan. Cada pantalla arma su propia cadena de `||`.
Medido en la base el 6/10, últimos 7 días, **29.360 solicitudes**:

| | columna `telefono` | `metadata.telefono` |
|---|---|---|
| CARGA (24.598) | **vacía en el 100%** | está en el 100% |
| RETIRO (1.562) | **vacía en el 100%** | está en el 100% |
| CAMBIO_CLAVE (51) | **vacía en el 100%** | está en el 100% |
| SOPORTE (3.149) | vacía en el 80% | falta en 5 |

Y en el padrón (`usuarios_portal_vinculos`, 251.257 vínculos): **teléfono en el 100%**, venga del
CSV, del operador o del primer ingreso.

**El dato nunca faltó.** La pantalla que empezaba la cadena por la columna no encontraba nada. Por
eso, en la misma pantalla, la tarjeta de arriba mostraba `2241460009` y el expediente de abajo
decía *"Teléfono: No informado"* — del mismo jugador, al mismo tiempo.

**El titular SÍ falta**, y es distinto: de los 1.034 vínculos que creó el panel en 30 días, los
1.034 quedaron **sin titular**. Igual los 319 del primer ingreso del portal.

**El veredicto de validación ya existe**: `usuarios_portal_vinculos.estado_vinculo`.
Al 6/10: **251.257 VINCULADO · 328 DUPLICADO · 121 PENDIENTE**.
`panel_crm_vinculos_buscar` lo devuelve, y la tarjeta de cotejo lo tiraba a la basura.

El caso de la pantalla de Juan:

```
gracieeela228    2241460009   VINCULADO
gracieeeela228   2241460009   DUPLICADO
grcieeela228     2241460009   DUPLICADO
```

La tarjeta decía *"lo comparten 3 cuentas"* y ofrecía botones para usar **las dos que la base ya
había resuelto**. El operador decidía a mano algo ya decidido — y cada vez que alguien apretaba
uno, nacía otra cuenta en el padrón. De ahí salen los "lo comparten 3 cuentas".

## Lo que se hizo

**`renderer/domain/identidad.js`** — módulo puro, probable con node. Una sola cadena para el
teléfono, una para el titular, y el veredicto del padrón. El orden sale de la medición, no de la
costumbre: primero donde *siempre* está.

**`renderer/core/padron-en-memoria.js`** — el teléfono/titular/estado de un jugador **sin pedir
nada a la base**: mira la base local de jugadores, los vínculos del CRM si están cargados, y las
solicitudes que ya están en pantalla. Si ninguna lo tiene, devuelve vacío; **no dispara una
consulta por su cuenta**, que es lo que había que terminar.

**El expediente** pasa por ahí: deja de decir "No informado" con el número a la vista.

**La tarjeta de cotejo**:
- la fila del usuario muestra **validado / sin validar**, y cuando no está validado dice
  *"No ve el CBU hasta que lo valides"* — que es lo que Juan pidió en el punto 1;
- las cuentas marcadas `DUPLICADO` **ya no se ofrecen**;
- si las otras ya están resueltas, la tarjeta dice *"✓ es suyo · las otras N ya están marcadas
  como duplicadas. No hay que preguntar nada."* en vez de un conflicto abierto.

**`hayQueValidar(estado, agenteEncontro)`** deja escrita la regla que pidió: lo guardado manda, y
sólo se revalida si el agente no encuentra la cuenta. *(La regla está lista y probada; falta
engancharla en el botón de validar — ver abajo.)*

## Pruebas

- `tests/identidad-un-solo-lugar.test.cjs` — 12, con las cuatro formas reales de la misma fila.
- `tests/cotejo-usa-el-veredicto.test.cjs` — 4, con las tres cuentas reales de gracieeela228.

Suite completa: **441 → 445, 0 fallas.**

## Lo que falta (y por qué no lo hice todavía)

1. **Enganchar `hayQueValidar` en el botón "Validar y vincular".** Toca el camino de validación,
   que es el que crea cuentas. Quiero que Juan lo pruebe con la tarjeta ya arreglada antes de
   cambiar lo que ese botón hace.
2. **Guardar el titular al validar.** Hoy el panel crea el vínculo sin titular, siempre.
3. **Las 39 lecturas directas de `historial_ops` desde el panel.** Mismo problema que el teléfono,
   un orden de magnitud más grande. Va aparte.
