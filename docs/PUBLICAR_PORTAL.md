# Cómo se publica el Portal

El Portal es **un solo archivo**: `Portal`, en la raíz de este repo. Sirve a todas las oficinas; lo que cambia
entre una y otra lo decide el servidor (por ejemplo, el pedido de DNI según el interruptor de cada oficina).

## Dónde va

| Lugar | Repo | Dirección | Quién publica |
|---|---|---|---|
| Prueba | `zhinouno-ui/intento` | https://zhinouno-ui.github.io/intento/ (entra sola como P1) | Juan o el agente |
| Producción | `admimaster26-collab/portal-bet300` | los dominios `*.portal-bet-300.com` | Juan o la encargada (el agente no tiene permiso de escritura) |

## Pasos

1. En este repo: `node --require ./tests/helpers/offline-network.cjs --test tests/portal-*.test.cjs tests/retiro-instrumentos-portal.test.cjs` tiene que dar todo bien.
2. En el archivo `Portal`, subir el sello de versión (`PORTAL_VER`, cerca de la línea 525; hoy dice `v2.1.18 · 02/11`).
3. En el repo de destino se tocan **sólo dos archivos**:
   - `index.html` ← copia exacta del archivo `Portal`.
   - `sw.js` ← subir el número de `CACHE` (si no cambia, los teléfonos siguen mostrando la versión vieja).
4. Commit y push a la rama que publica (GitHub Pages). Primero en **prueba**; mirar que ande; después lo mismo en **producción**.
5. Comprobar en un teléfono: abrir el Portal, cerrar y volver a abrir; abajo tiene que verse el sello nuevo.

## Antes de publicar en producción

- El servidor ya tiene que tener lo que el Portal nuevo llama. Si una función no existe, el Portal vuelve solo
  al camino anterior (`landing_portal_ingreso_v1` → `landing_portal_resolver_vinculo`; el contexto de retiro → modo anterior).
- Probar local sin publicar nada: `node <scratchpad>/serve-portal.cjs Portal` no está en el repo; alcanza con
  cualquier servidor estático que entregue `Portal` como `index.html` en `http://localhost:PUERTO/` (en `localhost` entra sola como P1).
- No probar pagos ni mensajes con usuarios reales: el usuario de prueba vive en P1.

## Cambios del Portal sin publicar (al 13/11)

El archivo `Portal` del repo va **v2.1.19 · 12/11** y producción sigue atrás. Lo que lleva:

- **Pedir una persona manda el resumen de verdad** (13/11). Antes decía "ya le mandé lo que hablamos" y
  al operador le llegaba sólo el tema. Ahora, en el mismo mensaje, viajan: qué eligió el jugador
  (hasta 4 pasos), su última carga y su último retiro con monto, fecha, cómo quedó y el número de
  pedido, y si tiene algo en curso. Sin nada que resumir, no se le promete al jugador.
  Los textos están elegidos para que no los lea el bot del servidor (`soporte_auto_mensaje_v1`);
  `tests/portal-guia-chat.test.cjs` corre más de 3.000 combinaciones contra sus reglas.
- La billetera reintenta sola en vez de decir "sin billetera".
- Un titular bloqueado ya no se propone en Cargar.
- Sin sesión, Cargar y Retirar vuelven al ingreso.
- Cada intento de entrar queda anotado (`landing_portal_ingreso_v1`).
- El DNI en retiros sale según el interruptor de cada oficina.

Pendiente del lado del servidor: `servidor/oficina-whatsapp.sql` (el número de WhatsApp de la oficina)
**no está subido**, y NODO todavía no lo lee de Agentes › Integraciones. Hoy P4, P6, P7, P10C y P12 no
tienen número cargado: en esas oficinas el botón de WhatsApp no aparece y se ofrece una persona.
