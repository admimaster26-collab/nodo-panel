# Cómo enganchar un botón en NODO

Leer antes de agregar o tocar cualquier botón del panel. Cada regla salió de un botón que el operador
apretó y **no hizo nada**. Juan lo tuvo que marcar ocho veces; no debería haber una novena.

La prueba `tests/botones-reglas.test.cjs` recorre todo `renderer/` y falla si se rompen las reglas 1 y 5.
Las demás dependen de quien escribe el código.

## Las reglas

**1. Nunca `prompt()`.** En Electron no existe: falla callado y el botón queda muerto. En Chrome sí
existe, así que probarlo en el navegador engaña. Para pedir un texto:

```js
const motivo = await window.nodoPedirTexto({
  titulo: 'Es pepe: 1100000002 pasa a ser su número',
  texto: '¿Por qué? Queda anotado en su historia.',
  valor: 'perdió el número',          // sugerido, editable
  confirmar: 'Confirmar',
  requerido: true, faltaTexto: 'Escribí el motivo: queda registrado.'
});
if (motivo === null) return;           // canceló (Cancelar o Esc)
```

`confirm()` y `alert()` sí existen en Electron. Igual, para algo que el operador va a ver seguido,
preferir un cartel dentro del panel.

*Casos:* botones de identidad (8/11), validación manual, enlace de acceso del historial.

**2. Los datos del jugador no van dentro del JavaScript del `onclick`.** Van en atributos `data-*`,
escapados con `escapeHtml`, y el handler los lee de `this`:

```js
'<button type="button" onclick="altaIdentidadDecidir(\x27MISMA\x27,this)"'
  + ' data-u="' + escapeHtml(usuario) + '" data-t="' + escapeHtml(tel) + '">…</button>'
// handler: const usuario = el.getAttribute('data-u');
```

Un salto de línea, una comilla o una barra en un dato rompe el `onclick` entero y el botón no hace
nada, sin error visible. Si no queda otra que meter un dato en el `onclick`, limpiarlo antes:
usuario sólo `[A-Za-z0-9._-]`, teléfono sólo dígitos.

*Caso:* "Crear la cuenta" (6/11): el teléfono sacado de un mensaje traía un salto de línea.

**3. Comillas.** El atributo va entre comillas dobles (`onclick="…"`). Adentro, las comillas simples del
JavaScript se escriben `\x27` en el string que arma el HTML. Nunca comillas dobles crudas adentro.

**4. El handler tiene que ser global: `window.nombre = function…`.** Un `onclick` escrito en el HTML
busca la función en `window`. Una función dentro de un módulo, de una fábrica `create(deps)`
(`renderer/portal/*`) o de una IIFE no se ve desde el botón. Si vive en un módulo, se exporta a
`window` a propósito.

**5. Las consultas a Supabase no llevan `.catch` pegado.** `supabaseClient.rpc(...)` no tiene `.catch`:
encadenarlo revienta antes de consultar. Usar `await` dentro de `try/catch`, o
`Promise.resolve(supabaseClient.rpc(...)).catch(...)`.

*Caso:* la búsqueda del alta dejó de andar en producción (6/11).

**6. Nunca fallar callado.**
- Mientras trabaja, el botón queda deshabilitado (`el.disabled = true`) y se libera en `finally`.
- Si sale mal: `toast('No se pudo anotar la decisión. Probá de nuevo.', 'red')`.
- El detalle técnico va a `console.warn`, nunca a la pantalla.

**7. Lo que lee el operador: castellano, corto, sin nada técnico.** Ni códigos, ni nombres de tablas o
funciones, ni texto que venga de afuera (GitHub, Supabase, el casino) sin filtrar. Si falla, decir
qué falló en palabras del operador ("Fallo al actualizar") y listo.

*Caso:* el cartel de actualización de P10C (8/11) pintó un error de GitHub de miles de caracteres
encima de todo el panel.

**8. Si la tarjeta se repinta sola, lo que el operador escribe no va adentro.** Las tarjetas que se
regeneran con cada consulta borran un campo a medio escribir. Pedir datos en una capa sobre
`document.body` (es lo que hace `nodoPedirTexto`).

**9. Todo elemento que muestra texto variable tiene tope.** `max-width`, `overflow:hidden`,
`text-overflow:ellipsis` y `white-space:nowrap`. Nada flotante (`position:fixed`) puede crecer sin
límite.

**10. Un módulo no encuentra `supabaseClient` ni `operador` en `window`.** En NODO son `const`/`let` del
script principal: se ven por su nombre desde cualquier script, pero `window.supabaseClient` es `undefined`.
Un módulo que los busque sólo en `window` (o en `deps` sin que nadie se los pase) no consulta nunca al
servidor. Buscarlos también por nombre: `typeof supabaseClient !== 'undefined' ? supabaseClient : null`.

*Caso:* la ventana del DNI (8/11): con el primer retiro real salió "No se pudo comprobar la cuenta de cobro…
¿Continuar igual?", que deja pagar sin validar. Las pruebas pasaban porque le daban la conexión a mano.
Prueba que lo agarra: `tests/retiro-cuenta-en-nodo-real.test.cjs`, que carga el módulo como NODO.

## La prueba de un botón

- No simular en la prueba lo que NODO no tiene. Si el contexto de la prueba define `prompt`, la
  prueba pasa y el botón está muerto. Eso pasó.
- Apretar el botón como lo aprieta NODO: sacar el `onclick` y los `data-*` **del HTML que genera el
  código** y correr ese `onclick` con `this` = el botón. Ejemplo: `apretar()` en
  `tests/identidad-tarjeta.test.cjs`.
- Probar también cancelar: no hace nada y no deja el botón trabado.

## Antes de entregar

1. `npm run panel:build`, después las pruebas (`npm test` o la línea de `node --test`).
2. Hacer clic en **NODO de verdad**, no en un navegador.
3. Decirle a Juan qué botón apretar y qué tiene que ver.
