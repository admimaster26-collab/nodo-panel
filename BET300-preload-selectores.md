# BET300 (agentesbet.net) — Mapa de selectores para el preload paralelo

Plataforma: **Vue + Vuetify + Material Design Icons (`mdi-*`)**. URL: `https://www.agentesbet.net/`
Los `id` (`input-NNN`) son autogenerados → NO usar; ir por placeholder / icono / texto / orden DOM.
Jugadores salen en rojo (`text-error`). "Cargar"=depósito · "Descargar"=retiro.

## Login (`/login`)
- Alias: `input[placeholder="Alias"]`
- Contraseña: `input[type="password"]` (placeholder "Contraseña")
- OTP (NO lo usan): `input[placeholder*="OTP"]`
- Botón: `v-btn` con texto **"Iniciar sesión"** (form postea a `/login`)
- Detección login: URL incluye `/login` ó existe `input[placeholder="Alias"]` + botón "Iniciar sesión"

## Buscar (Control de agentes)
- Input: `input[placeholder="Buscar usuario"]`
- Lupa: botón que contiene `i.mdi-magnify`
- Limpiar (X): botón con `i.mdi-window-close`
- Filtro "solo jugadores" (SIEMPRE): botón con `i.mdi-account` (arriba-derecha) — íconos vecinos: `mdi-account-group` (todos), `mdi-account-tie` (agentes), `mdi-eye-off`. También existe dropdown tras la lupa con opción "Todos los jugadores".
- Fila: `.v-row` → `.v-col-5` (alias, `text-error`=jugador) · `.v-col-4` (cantidad = saldo jugador) · `.v-col-3` (acciones)
- Alias: texto del span en `.v-col-5` (después del `span.mdi-account`)

## Acciones por fila (dentro de `.v-col-3`)
- 🟢 Cargar (depósito): botón con `i.mdi-cash-plus`
- 🔴 Descargar (retiro): botón con `i.mdi-cash-minus`
- 🔑 Cambiar clave: botón con `i.mdi-key`
- … más: `i.mdi-dots-horizontal`

## Modal CARGAR — 4 inputs `.v-field__input` (orden DOM)
1. Balance de agente (readonly)
2. Balance de jugador (readonly)
3. **Cantidad** (editable) ← monto
4. **Bono** (editable) ← **poner 0**
- Botones (por texto, dentro del dialog): **"Enviar"** (verde) · "Cerrar"
- Quick: "5.000"/"10.000"/"20.000" (ignorar)
- Título dialog: "Cargar: <usuario>"

## Modal DESCARGAR (retiro) — 3 inputs (SIN Bono)
1. Balance de agente · 2. Balance de jugador · 3. **Cantidad**
- Botón extra "Descargar Todo (N)" (retiro total, opcional)
- Botones: "Enviar" · "Cerrar". Título: "Descargar: <usuario>"

## Modal CREAR JUGADOR — 3 inputs
- Alias: `input[placeholder="Alias"]`
- Contraseña: `input[placeholder="password_placeholder"]` (autogenerada, type text) → **limpiar y poner 12345a** (hay ícono refresh para regenerar)
- Moneda: `input[placeholder="ARS"]` (dejar "ARS")
- Botón "Guardar". (Botón "Crear jugador" arriba abre este modal)

## Modal CAMBIAR CONTRASEÑA — 1 input
- Nueva contraseña: el input del dialog (autogenerada) → **limpiar y poner 12345a**
- Botón "Guardar"

## Saldos / formato
- Leer por label ("Balance de agente"/"Balance de jugador") o por orden DOM en el dialog.
- Formato AR: `10.425.821` (punto miles). Saldo jugador también en `.v-col-4` de la fila.

## Confirmación (CAPTURADO — selectores exactos)
- Toast Vuetify abajo: contenedor `.v-snackbar__wrapper` (dentro de `.v-snackbar`), texto en `.v-snackbar__content`.
- **ÉXITO:** `.v-snackbar__wrapper.bg-success` · texto `balance_updated_successfully`
- **FALLO:** `.v-snackbar__wrapper.bg-error` · texto tipo `General Error -13` (saldo insuficiente)
- Detección definitiva por CLASE `bg-success` / `bg-error` (no depende del texto/idioma).
- Reemplaza todo el bloque del modal "Resultado de la operación" del preload actual.
- Saldo POST ya no viene en modal → estimar (pre ± monto) o releer `.v-col-4` de la fila.
- Detectar: observar aparición de `.v-snackbar__wrapper` tras "Enviar"; `bg-success`→ok, `bg-error`→fallo (leer `.v-snackbar__content` para el motivo).

## Notas de implementación
- Inyección de valores: es Vue/Vuetify → probar native-setter + evento `input` (como el actual); verificar que v-model lo tome.
- Carga/Descarga se disparan desde el ícono de la FILA (no del perfil): `buscarUsuario` ubica la fila, `applyAmount` clickea `mdi-cash-plus`/`mdi-cash-minus` de ESA fila.
- `cambiarClave`: 1 solo campo (más simple que casinodrex). `crearUsuario`: modal, no `/new_user`.
