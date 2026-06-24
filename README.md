# NODO PC4 · App Unificada V1

Primera base para fusionar ambos enfoques:

- Una sola app Electron por PC.
- Internamente separada en módulos.
- Worker Operativo y Worker Sync dentro de la misma app.
- Colas separadas en Supabase.

## Estructura

```txt
NODO_PC4_APP_UNIFICADA_V1/
├─ main.js
├─ app-preload.js
├─ agent-preload.js
├─ chunior-bridge.js
├─ panel.html
├─ config.json
├─ config.example.json
├─ services/
│  ├─ supabase.js
│  ├─ jobs.js
│  ├─ agentes.js
│  ├─ chunior.js
│  ├─ verifier.js
│  ├─ worker-operativo.js
│  └─ worker-sync.js
└─ shared/
   ├─ estados.js
   └─ utils.js
```

## Qué hace

### Worker Operativo

Toma jobs desde:

```txt
tomar_job_operativo(PC4, pc4-operativo-01)
```

Ejecuta:

```txt
buscar usuario
crear usuario
cambiar clave
cargar fichas
retirar fichas
```

Después marca:

```txt
OK
ERROR
OK_PARCIAL / ACCION_OK_SYNC_PENDIENTE
```

Cuando carga/retiro sale OK en Agentes, crea un job sync:

```txt
crear_job_sync_desde_operativo(...)
```

### Worker Sync

Toma jobs desde:

```txt
tomar_job_sync(PC4, pc4-sync-01)
```

Procesa:

```txt
REGISTRAR_CHUNIOR
SYNC_SALDO_BILLETERA
CONCILIACION_GENERAL
```

En esta V1, `REGISTRAR_CHUNIOR` usa `chunior-bridge.js`.
Si `chuniorEnabled` está false, lo registra como desactivado y no bloquea.


## .env

Esta V1.1 usa `.env` para datos sensibles.

Crear un archivo `.env` copiando `.env.example`:

```bash
copy .env.example .env
```

Completar:

```txt
SUPABASE_URL=
SUPABASE_ANON_KEY=
PC_CODIGO=PC4
WORKER_OPERATIVO_ID=pc4-operativo-01
WORKER_SYNC_ID=pc4-sync-01
```

`config.json` queda como configuración general/fallback.  
Las variables de `.env` pisan lo que diga `config.json`.

No subir `.env` a GitHub.

## Antes de probar

1. Ejecutar en Supabase el SQL:
   `SQL_PC4_WORKERS_OPERATIVO_SYNC_BASE.sql`

2. Editar `config.json`:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - `pcCodigo`
   - URLs si cambian
   - proxy si corresponde

3. Instalar dependencias:

```bash
npm install
```

4. Ejecutar:

```bash
npm start
```

## Importante

No incluí tus claves reales ni el proxy real.
El `config.json` está sanitizado.

Esta versión es base de estructura.
El siguiente paso es conectarla al Panel Lite real y ajustar tipos de jobs exactos según tus tablas actuales.

Generado: 2026-05-30 04:55:02


## V1.2 DEBUG BUSY FIX

Cambios:
- El botón `Procesar 1 operativo` ya no queda bloqueado sin explicación.
- Se redujo el spam visual de `SIN_JOBS`.
- Se agregó botón `Debug tomar job`.
- `Debug tomar job` llama directo a `tomar_job_operativo` desde Electron.
- Sirve para distinguir si el problema está en Supabase/RPC, Electron o automatización.

Prueba recomendada:
1. Liberar el job 3086 o crear uno nuevo.
2. Abrir app.
3. Loguear Agentes.
4. Tocar `Debug tomar job`.
5. Si devuelve el job, liberarlo en SQL si era prueba debug.
6. Tocar `Procesar 1 operativo`.

Generado: 2026-05-30 14:42:15


## V1.3 ANTI-CUELGUE WORKER

Correcciones:
- Anti-cuelgue en Worker Operativo.
- Si queda ocupado más de 25 segundos, se libera automáticamente.
- Agregado botón `Reset busy`.
- Agregado botón `Estado interno`.
- Timeouts internos en:
  - liberar vencidos
  - heartbeat
  - check sesión Agentes
  - tomar job operativo
  - automatizaciones principales
- Evita que el botón `Procesar 1 operativo` quede inutilizable por un ciclo colgado.

Prueba recomendada:
1. Cerrar app anterior.
2. Copiar `.env` a esta carpeta.
3. npm install
4. npm start
5. Loguear Agentes.
6. Confirmar job 3086 en PENDIENTE.
7. Tocar Estado interno.
8. Tocar Reset busy si figura busy=true.
9. Tocar Procesar 1 operativo.

Generado: 2026-05-30 14:51:21


## V1.4 BLINDAJE DUPLICADOS

OBLIGATORIO: ejecutar primero `SQL_V1_4_BLINDAJE_DUPLICADOS.sql` en Supabase.

Cambios principales:
- `tomar_worker_job` ya NO retoma automáticamente jobs `PROCESANDO` vencidos.
- El botón debug ya NO toma/lockea jobs reales. Solo lista pendientes.
- Si una carga/retiro da timeout o error durante automatización, queda en `ERROR_CONTROL_MANUAL_NO_REINTENTAR_ACCION_MONETARIA`.
- Esto evita duplicar cargas/retiros.
- Si la acción monetaria salió OK, queda `OK_PARCIAL` y se crea job Sync.
- Si queda en error final, se revisa manualmente antes de repetir cualquier acción.

Regla nueva:
Una acción monetaria iniciada en Agentes NO se reintenta automáticamente.

Generado: 2026-05-30 15:24:17


## V1.4.1 DEBUG RLS FIX

OBLIGATORIO: ejecutar `SQL_V1_4_1_DEBUG_RLS_FIX.sql`.

Corrección:
- El botón `Debug ver pendientes` ya no lee la tabla `worker_jobs` directo.
- Ahora usa RPC `debug_listar_jobs_operativos_pendientes`.
- Esto evita el error:
  `permission denied for table worker_jobs`

Orden:
1. Ejecutar SQL V1.4.1 en Supabase.
2. Cerrar app.
3. Copiar `.env` correcto a esta carpeta.
4. `npm install`
5. `npm start`
6. Probar `Debug ver pendientes`.

Generado: 2026-05-30 15:38:29


## V1.4.3 SYNTAX FIX

Corrección:
- Se corrige error de sintaxis en `services/agentes.js`.
- Se reemplazó `agentes.js` completo por una versión limpia.
- Se verificó sintaxis con Node:
  node --check OK

También mantiene:
- Debug vía RPC sin RLS directo.
- Blindaje anti duplicados de V1.4/V1.4.1.
- Check de sesión de Agentes vía `agent-preload`.

Orden recomendado:
1. Cerrar app anterior.
2. Descomprimir V1.4.3.
3. Copiar `.env` correcto.
4. npm install
5. npm start
6. Cerrar o resetear job 3090 si sigue trabado.
7. Crear nuevo VALIDAR_USUARIO.

Generado: 2026-05-30 16:32:00


## V1.4.6 ESTADOS REALES FIX

Problema detectado:
Tu tabla `worker_jobs` acepta:
PENDIENTE, TOMADO, PROCESANDO, COMPLETADO, ERROR, REINTENTAR, CANCELADO, REQUIERE_MANUAL.

La app/funciones anteriores intentaban usar estados no compatibles en algunos cierres.

Corrección:
- `marcar_job_ok` ahora cierra con `COMPLETADO`.
- `marcar_job_error` cierra con `ERROR`.
- `marcar_job_ok_parcial` cierra con `REQUIERE_MANUAL`.
- `marcar_job_error_final` cierra con `REQUIERE_MANUAL`.
- `tomar_worker_job` no retoma `PROCESANDO` automáticamente.
- Operativo queda en modo manual seguro con `AUTO_START_OPERATIVO=0`.

OBLIGATORIO:
Ejecutar `SQL_V1_4_6_ESTADOS_REALES_FIX.sql` en Supabase antes de probar.

En `.env`:
AUTO_START_OPERATIVO=0
AUTO_START_SYNC=1

Validación sintaxis:
main.js: OK
services/agentes.js: OK
services/worker-operativo.js: OK
agent-preload.js: OK
services/jobs.js: OK

Generado: 2026-05-30 17:15:43
