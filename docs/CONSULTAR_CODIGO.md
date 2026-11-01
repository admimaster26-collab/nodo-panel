# Consultar una tarea sin cargar el proyecto entero

La entrada es la función o el RPC que interesa. La herramienta entrega su fuente editable, firma, llamadas, referencias entrantes, pruebas relacionadas y hash actual. El grafo se calcula con AST y se guarda como metadatos en el temporal del sistema; no hay que leer ni mantener un listado gigante.

Desde este repositorio, después de `npm ci`:

```powershell
npm run codigo -- symbol cargarSolicitudesPortal --max-chars 6000
npm run codigo -- flow 'renderer/portal/requests.js::cargarSolicitudesPortal' --depth 2 --limit 5
npm run codigo -- impact 'renderer/chat/beta-chat.js::lista' --limit 5
npm run codigo -- symbol 'servidor/beta-chat-v1.sql::public.nodo_beta_chat_lista_v1' --code
npm run codigo -- changes --since HEAD --limit 5
```

`symbol` encuentra la definición. `flow` sigue las salidas. `impact` recorre referencias entrantes. `--code` agrega sólo el bloque exacto solicitado; si excede el límite, da la ubicación y pide afinar. `changes` resume archivos cambiados, no finge un diff semántico por función.

Si hay nombres repetidos, usar `archivo::simbolo`. El resultado distingue RPC literal, resolución única, ambigua y no resuelta. Un mock en tests puede compartir nombre con una función de producción: no elegir por el primer resultado. Las fuentes del manifest se distinguen de `renderer/generated`; editar fuentes y luego compilar.

## Cómo trabajar con el paquete
1. Consultar función y recorrido. Abrir sólo el bloque y los contratos necesarios; ampliar cuando aparezca una dependencia sin resolver.
2. Revisar `entrantes` antes de cambiar firma/efectos. Las pruebas listadas son candidatas por referencia, no pruebas ejecutadas ni garantía de cobertura.
3. Hacer el cambio y correr las pruebas que verifican su comportamiento. Compilar y comprobar el panel si se tocó renderer. Un corte compartido exige coordinación o snapshot fijo.
4. Entregar archivos tocados, hashes, pruebas/exit codes, cambios remotos y siguiente paso. Evitar copiar resultados completos en cada mensaje.

## Frescura y límites
Cada consulta recalcula hashes de fuente y sólo vuelve a parsear archivos que cambiaron. Se invalidan parser/manifest/caché cuando corresponde. La caché guarda nombres, firmas, referencias y ubicaciones; no cuerpos/comentarios/literales libres. `--no-cache` reconstruye para diagnóstico. TypeScript5.9.3 está fijado como dependencia de desarrollo.

No certifica ejecución, publicación ni acceso al servidor. SQL local puede tener varias versiones y el servidor puede haber cambiado. Para código dinámico, callbacks, IPC, `onclick`, alias o inyección de dependencias, una arista no resuelta exige lectura puntual o prueba. No hay promesa de que cualquier modelo pequeño pueda resolver cualquier cambio: sí recibe contexto localizado, verificable y ampliable sin recortar el código real.

Medición27/10: consulta SQL3298bytes frente a archivo28611bytes; recorrido Bandeja5872bytes frente a archivo20147bytes. La salida también trae pruebas y referencias. Son tamaños de contexto, no tokens facturados ni ahorro total por tarea. Evidencia: `../PROYECTO_SERVIDOR_NODO/medicion-contexto-2026-10-27.json`.

Contratos de la beta: [BETA_CONTRATOS.md](BETA_CONTRATOS.md). Continuidad vigente: `../PROYECTO_SERVIDOR_NODO/CONTINUAR.md`.
