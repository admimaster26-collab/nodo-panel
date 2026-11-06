# Pendientes al 6/11 (corte por límite de uso)

## Retiro con DNI — falta unir las dos versiones
- **Servidor publicado (Claude):** `servidor/retiro-instrumentos.sql` — tablas `retiro_instrumentos` y
  `retiro_instrumento_eventos` (vacías), funciones `panel_retiro_instrumento`, `_validar`, `_rechazar`
  (clave del panel), `landing_retiro_instrumentos`, `landing_retiro_instrumento_declarar`.
- **NODO** (`renderer/portal/withdrawal-instrument.js`) ya llama a esas funciones `panel_*`. La compuerta
  en `withdrawals-execution.js`, `operation-execution.js` y `automatizaciones.js` corre sólo si la
  solicitud trae `metadata.retiro_instrumento_v1` (marca de la versión de Codex).
- **Portal** llama `landing_portal_retiro_contexto_v1` y `landing_portal_retiro_crear_v1` (diseño de
  Codex, `servidor/retiros-instrumentos-v1.sql`, NO publicado; usa `acceso.autorizar`, que no existe en
  producción: el que existe es `nodo_beta.autorizar`). Sin esas funciones el Portal hace el retiro viejo.
- **Lo que falta:** crear esas dos funciones sobre las tablas de Claude, con lo bueno de Codex: DNI como
  huella (sha256 con secreto del servidor, nunca en claro), la marca `retiro_instrumento_v1` en la
  metadata, solicitud y cuenta en un solo paso, llave por oficina (apagada por defecto). DNI de 7-8
  dígitos y CUIT. Ojo: el Portal usa `instrumento.destino` y `titular` de `contexto_v1` para comparar con
  lo que escribe el jugador (líneas ~3342, 3424, 3506, 4559): enmascararlos rompe la comparación;
  hay que mover la comparación al servidor si no se quiere entregar el dato. Prender sólo P4 o P1 para
  probar (el Portal de producción no llama a estas funciones). Después sacar las `landing_retiro_*` que
  sobren.

## Otros pendientes
1. Semáforo que compara de verdad: el subagente quedó a medias (`renderer/runtime/llegada-datos.js`,
   `servidor/panel-ultima-llegada.sql` sin publicar).
2. Comprobante: el Portal abrió una conversación nueva (#446442) en vez de seguir la abierta, y el
   comprobante de un pedido no se adjunta a ese pedido (quedó sólo como mensaje con imagen).
3. Asistente del chat: agregar la rama "cambié de número" (manda usuario + número nuevo a una persona)
   y qué ve el jugador con el veredicto `REVISION` (alias reemplazado).
4. Bot de soporte (`soporte_vincular_automatico_v1`): vincula solo como PENDIENTE y con eso el Portal
   ya deja operar sin que un operador valide. Decidir si se quiere así.
5. `panel_usuario_evento` rechaza en silencio el secreto del panel: no se guarda ningún VALIDACION.
6. Mensajes de soporte sin `t_toque` (no se mide la demora).
7. Nada commiteado hoy. Oficinas en 2.1.5. Instalador 2.1.6 (sólo arreglo de Sánchez) en el escritorio.
8. Procesos `node.exe` de pruebas colgados en la PC.
9. Recorte de chats cerrados de más de 30 días: temporal hasta la actualización.
