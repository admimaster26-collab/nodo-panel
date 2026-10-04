# La lupa del historial abría la ficha de otro jugador  ·  4/10

Juan: *"apreté el botón de ese usuario y apareció otro nada que ver... es un error, se repitió."*

## Qué pasaba

El historial muestra **dos cosas mezcladas**:

- **movimientos** — tabla `historial_ops`
- **solicitudes del portal** — tabla `landing_solicitudes`

Cada tabla numera por su cuenta, y **las dos ya van por el 300.000**. Los números se pisan.
Verificado contra la base ese mismo día:

| | número | jugador | operación |
|---|---|---|---|
| solicitud | **303566** | juijuh | CARGA $ 2.000 |
| movimiento | **303566** | vero8goat | CARGA $ 4.000 |

El botón 🔍 mandaba el número de la fila a secas. Si la fila era una **solicitud**, el detalle
buscaba ese número entre los **movimientos** y encontraba el de otra persona. Por eso Juan apretó
la lupa de juijuh y se abrió la ficha de vero8goat: titular Verónica Cecilia Moyano, sus saldos y
su árbol de operaciones completo.

No era aleatorio ni un parpadeo. Pasa **siempre** que los dos números coinciden, y con 300.000 filas
de cada lado coinciden mucho.

## Lo grave

Un operador podía ver, y actuar sobre, la ficha de otro jugador creyendo que era la del que tenía
delante: titular, CBU de retiro, saldos y todo el historial.

## Qué se arregló

**1 · Los dos números dejan de mezclarse.**
La fila ya sabía de dónde venía (`_fuente`) y ya traía `historial_id` — nadie los usaba.
Ahora el número del movimiento viaja por un lado y el de la solicitud por el otro.
`renderer/core/historial-operaciones.js`

**2 · La fila que tocó el operador manda.**
El nombre salía del guardado local *antes* que del de la fila. Si lo guardado bajo ese número es
de otra persona, se descarta y queda avisado en la consola.
`renderer/core/perfil-jugador.js`

**3 · Una solicitud sin movimiento ya no sale como "$ 0".**
Pendiente o rechazada, la ficha se arma con lo que la solicitud sí tiene.

**4 · Y se muestra POR QUÉ se rechazó** — que era el pedido original de Juan.
El motivo ya venía guardado en la solicitud y esta ficha no lo miraba. Ahora aparece, con quién
lo hizo y el número de solicitud. Si no hay motivo guardado, **lo dice**: eso también es un dato.
Los códigos internos se traducen:

| código | lo que ve el operador |
|---|---|
| `REINCIDENTE` | Ya había mandado el mismo comprobante antes |
| `DATO_PROPIO` | Transfirió desde una cuenta nuestra |
| `USUARIO_COMO_TITULAR` | Puso su usuario de juego donde va el titular |
| `SOLO_NUMEROS` | El titular eran sólo números |

## Pruebas

`tests/lupa-no-abre-otro-jugador.test.cjs` — 6 pruebas con los números reales del caso
(303566 de los dos lados). **Las 6 fallan contra el código anterior.** Suite completa: 429, 0 fallas.

## Lo que queda

Esto es código del panel: **necesita la 2.1.6**. Hasta que se publique, el error sigue en las
oficinas.
