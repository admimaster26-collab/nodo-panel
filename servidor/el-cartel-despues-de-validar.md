# El cartel tiene que cambiar cuando se termina de validar  ·  19/10

Juan, con la pantalla a la vista: *"revisa tambien que la proxima version cambie el cartel de
revisar cuando se termine de validar para que aparezca todo joya, por como esta en la version
actual sigue siendo incongruente."*

## Lo que estaba mal

Su captura, tal cual. El cliente escribió por el portal:

```
Hola 👋 Quiero validar mi acceso para operar. Usuario: laugoat66. Tel: 1100000003.
```

Su cuenta real es **lauggoat66** (con dos ges) y ese teléfono ya era suyo. La tarjeta de cotejo
hacía bien su trabajo:

```
⚠️ REVISAR                                          declaró el cliente
USUARIO    laugoat66    ⚠ no figura así
                        Tiene el teléfono que declaró — es casi seguro su cuenta.
                        [ lauggoat66 · 1100000003 ]
TELÉFONO   1100000003   ⚠ es de lauggoat66
                        [ usar lauggoat66 ]
El teléfono es de lauggoat66 — parece que escribió mal el alias.
```

El operador apretaba **Validar y vincular**, salía el modal *"✅ Usuario validado y agendado"*,
le cerraba… y detrás quedaba **el mismo cartel, con los mismos botones**. Como si no hubiera
hecho nada.

## Por qué no se arreglaba solo

Ya existía `_altaCotejoRefrescar()` — se llama después de vincular y repinta la tarjeta con el
padrón recién traído. Funciona. **Y no alcanza**, porque el problema no estaba en los datos.

El cotejo compara **lo que DECLARÓ el cliente** contra el padrón. Lo declarado no cambia nunca:
`laugoat66` no existía antes de validar y no existe después. Y `lauggoat66` ya era el dueño del
teléfono **desde antes** — por eso la tarjeta lo nombraba. Validar no movió un solo dato de los
que la tarjeta mira.

> Ningún refresco iba a cambiar ese cartel. Lo que faltaba no es un dato del padrón: es la
> **memoria de la decisión que acaba de tomar el operador**.

## Lo que quedó

```
✅ VALIDADO
USUARIO    lauggoat66   ✓ validado
                        El cliente había escrito laugoat66
TELÉFONO   1100000003   ✓ validado
Validado y agendado. Si escribió por el portal, ya recibió el botón para ingresar.
```

Resuelta la consulta, la tarjeta deja de ser un cotejo y pasa a ser **un recibo**: con qué cuenta
quedó. Los botones *"usar fulano"* se van, porque ya no hay nada que elegir — cada fila ofrece
sólo lo que se puede hacer sobre esa fila. Y la línea gris de abajo guarda lo que el cliente
había escrito, que es lo que el operador necesita si tiene que explicarle por qué entra con otro
alias.

## Las tres cosas que lo mantienen honesto

Un verde mentiroso es peor que un amarillo de más. Por eso:

**1 · La validación tiene que ser de ESTA consulta.** `ejecutarVincular` se usa también desde el
CRM y desde el chat normal. Sin guardia, validar a cualquier otro jugador pintaba de verde la
consulta que estuviera abierta. Se marca sólo si el teléfono o el usuario validado coinciden con
lo declarado en la consulta abierta.

**2 · El verde se confirma contra el padrón de AHORA.** La marca guardada no se cree sola: antes
de pintar nada se verifica que esa cuenta siga siendo la dueña del teléfono. Si alguien reasignó
el número después, la tarjeta vuelve a avisar. Si el número aparece en varias cuentas, también —
eso es algo nuevo para mirar y manda sobre la marca.

**3 · No se borra cuando no confirma.** Si la consulta al padrón falló por red, borrar la marca
perdería para siempre una validación que sí ocurrió. Vencen solas a la semana.

## Dónde

`renderer/core/cotejo-alta.js` — `_altaMarcarResuelto` (guarda), `_altaResuelto` (confirma),
y el bloque *"YA VALIDADO DESDE ACÁ"* dentro de `_altaCotejoHtml`. Se guarda en el `localStorage`
de la PC, podado por fecha y por cantidad: una PC de oficina no se reinicia nunca y sin techo eso
crece hasta romper el guardado.

## La prueba

`tests/cotejo-cartel-despues-de-validar.test.cjs` corre el archivo de verdad y dibuja la tarjeta,
no mira el código. Cinco casos, y **el padrón que se le pasa es el mismo antes y después de
validar** — que es justamente el punto.

Contra el código anterior fallan dos: *"despues de validar el cartel dice Validado"* y *"se
acuerda aunque se reinicie el panel"*.
