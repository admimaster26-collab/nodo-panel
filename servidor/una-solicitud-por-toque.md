# El mismo jugador mandaba la misma carga 8 veces  ·  7/10

## Cómo sabemos QUÉ pasó, sin haber visto la pantalla

No es deducción. **El portal firma cada solicitud con dos relojes** — se agregaron el 29/9 justo
para esto:

- `t_toque` — cuándo el jugador apretó el botón
- `t_envio` — cuándo salió la solicitud

El del toque se anota al apretar y **se consume**: el primer envío lo usa y lo deja en nulo. Si
una solicitud llega con `t_toque = t_envio`, es porque **no había toque guardado** — o sea, **no
hubo un botonazo nuevo**.

Los 8 de rodrigocuarteto (#318147 a #318154):

| | t_toque | t_envio | |
|---|---|---|---|
| la 1ª | 01:09:04.520 | 01:09:10.824 | **6,3 s esperando** |
| las otras 7 | = t_envio | .826 → .848 | **22 ms entre todas** |

Lo mismo en bautistaenbet: la 1ª con 8,1 s de espera, las otras 4 en 21 ms.

**Ocho envíos, un solo toque.** Y lo reproduje: corriendo el portal viejo con 8 toques simultáneos
salen **8 solicitudes**; con el arreglo, **1**.

**Por qué el botón seguía apretable:** se apagaba DESPUÉS de las consultas al servidor. Entre el
toque y el envío pasan 0,85 s de promedio — pero el peor medido fue de **39 segundos**. El jugador
ve que no pasa nada y vuelve a tocar.

**Cuándo empezó:** el **3/10**, el día del portal nuevo. De 0 por día a 73.

## Dónde va el arreglo: primero en el servidor

El portal es una página que vive en el teléfono del jugador: los teléfonos tardan **días** en
tomar la versión nueva, y este portal además es una PWA que cachea. Arreglar sólo allá deja el
problema vivo mientras tanto. Y si mañana aparece otra forma de mandar dos veces, el arreglo de
allá no la cubre.

**La guarda va en `landing_portal_v16_crear_solicitud`, que es por donde pasan todas.**

**No rechaza nada.** Si en los últimos 20 segundos ya entró una solicitud idéntica del mismo
jugador (misma oficina, mismo tipo, mismo monto) **y sigue abierta**, devuelve ESA. El jugador ve
su solicitud como siempre; el operador ve una sola. Si la anterior ya se resolvió, la nueva es
legítima y se crea.

Queda anotado en la solicitud original: `toques_repetidos` y `ultimo_toque_repetido_at`. Sin eso,
el problema vuelve a ser invisible y habría que deducirlo otra vez.

**Probado contra la base:** 8 llamadas idénticas → **1 fila**, la misma id, `ya_existia: true`,
`toques_repetidos: 7`. Otro monto → crea otra. Con la anterior resuelta → crea otra.

## Y además, en el portal

El botón se apaga **antes** de cualquier consulta, con un cerrojo: si ya hay un envío en vuelo, el
segundo toque no hace nada. Se suelta siempre, así que una validación que corta temprano no deja
el botón trabado. En los tres: carga, retiro y cambio de clave.

`tests/portal-un-envio-a-la-vez.test.cjs` — 6 pruebas, con los dos casos reales. Fallan todas
contra el portal anterior.

## Lo que falta

**El portal hay que publicarlo** — se sube aparte y lo hace Juan. La guarda del servidor ya está
viva, así que el problema está contenido desde ahora aunque el portal tarde.
