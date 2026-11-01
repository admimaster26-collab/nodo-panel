# Trabajo y Criterio Operativo de NODO

## 1. Continuidad y Reglas Base (Servidor + Panel + Portal)
- Leer `../PROYECTO_SERVIDOR_NODO/CONTINUAR.md` al retomar. Es el punto de entrada corto; los inventarios antiguos son históricos.
- Empezar toda tarea de código con `npm run codigo -- symbol <funcion>` y `flow`/`impact` según necesidad (desde `NexoBetaChan`). Guía: `docs/CONSULTAR_CODIGO.md`. Leer bloques puntuales y ampliar dependencias no resueltas; no releer el monolito ni archivos enteros por defecto.
- El resultado AST es estático: no prueba despliegue ni funcionamiento. No tratar mocks/definiciones repetidas como implementación activa. Cotejar hash y contrato del servidor para cambios SQL.
- Preservar cambios ajenos. Declarar archivos propios al delegar. Si otro modelo escribe el mismo árbol, validar una copia fija y registrar su hash; no regenerar/publicar todo el árbol como si fuera una sola entrega.
- Editar únicamente las fuentes del manifest, nunca `renderer/generated/**` ni `NODO · OPERATIVO LITE.htm`. `npm run panel:build` genera, `npm run panel:check` comprueba. Mantener legacy para oficinas sin beta, un escritor por efecto y ACK sólo de mensajes realmente visibles.
- Las pruebas `npm test` bloquean fetch externo; ensayos remotos van separados y sólo con fixture explícita. No probar pagos ni mensajes sobre usuarios reales.
- Antes de cambios remotos: foto actual por contrato, definición exacta+ACL, vuelta atrás ensayada y responsable. Credenciales sólo fuera del repo/renderer (`%LOCALAPPDATA%/NODO/`); no incluir cuerpos privados en diagnóstico.
- El usuario autorizó implementar la beta y conservar la versión en uso. No pedir nuevamente permiso para pasos reversibles dentro de ese alcance.

## 2. Criterio Propio, Diseño y Semáforo
- **Prohibido emparchar por falsa concordancia:** Si una pieza visual (como el chat o una tarjeta) está rota o incómoda por acumular parches viejos, cuestioná el problema con criterio propio en vez de sumar otro parche encima.
- **Búsqueda de referencias reales (`search_web`) antes de diseñar UI:** Antes de diseñar o rehacer un componente visual, buscá en la web con palabras clave cortas (ej. `"chat support desktop dark ergonomic"`, `"compact payment request card"`) herramientas reales probadas por humanos para turnos de 8hs y amoldá esa ergonomía al sistema.
- **Evolución sin choque (4 meses en uso):** Limpiá el ruido visual tomando como referencia limpia lo logrado en `renderer/core/archivo-historial.js` líneas 280-360 (tarjetas de parciales/en proceso), pero respetando la memoria muscular del operador para no moverle bruscamente las acciones críticas.
- **Instinto de las 3 puntas + Semáforo único (`NodoSalud`):** Verificá por tu cuenta si un cambio impacta entre Panel ↔ RPC ↔ SQL ↔ Portal/Chunior. Usá siempre la firma estándar de 1 línea `window.NodoSalud?.begin('RAMA')` sin crear cadenas gigantes de `else if`. Una falta de muestra es `UNKNOWN`; un heartbeat no confirma datos ni render.

## 3. Orquestación y Derivación de Subagentes (Mismo Hilo, Cero Copy-Paste)
- **Jamás uses a Juan de cartero entre modelos:** Usá la herramienta nativa de subagentes (`task` en OpenCode / `invoke_subagent` en Antigravity) para delegar dentro del mismo hilo y supervisar vos el resultado hasta terminar.
- **Especialistas disponibles:**
  1. **`@explorador` (Subagente liviano/rápido):** Para mapear rutas con `npm run codigo` o buscar referencias de UX en la web gastando el mínimo de tokens.
  2. **`@codex-motor` (Backend / SQL / AST):** Para `servidor/*.sql`, RPCs, locks de concurrencia y pruebas PGlite (`npm run beta:verify-sql`).
  3. **`@claudio-logica` (Lógica de Negocio):** Para auditar flujos entre solicitudes, retiros parciales, transferencias, Chunior y candados `_drexGlobalLock`.
  4. **`@gemini-panel` (UI / Electron / Contexto Amplio):** Para rediseños ergonómicos de interfaz (`panel.template.html`, `styles/base.css`, `styles/portal.css`, chat y tarjetas) y cruces de rama.
- **Cierre obligatorio:** Al terminar o recibir la entrega de un subagente, verificá compatibilidad (`npm run panel:build` + tests) y cerrá corto indicando: **1) Qué archivos exactos se tocaron**, **2) Qué tiene que mirar/tocar Juan en pantalla para probarlo**, y **3) Estado remoto y siguiente paso**.
