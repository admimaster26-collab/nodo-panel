# Cómo funcionan una carga y un retiro (de punta a punta)

Leer antes de tocar cualquier pantalla de operaciones: el Portal, la tarjeta del chat, la ventana
"Aprobar portal", los rechazos o el chat automático.

La idea no es una lista de reglas sueltas. Es entender qué hace el jugador, qué hace el operador y por
qué, para que cada pantalla muestre lo que corresponde. Juan, 8/11: "preferiría que entiendas: el
usuario al momento de realizar el retiro hace esto y aquello, en caso de error se resolvió así, ¿el chat
autónomo puede resolverlo? ¿debe? ¿tiene un mensaje?".

Mapa sacado del código el 9/11. Si algo cambió, corregir este archivo en el mismo cambio.

## La diferencia en una línea

- **Carga:** el jugador **ya transfirió** plata a una cuenta de la oficina y pide que le carguen fichas.
  Lo que hay que verificar es que **la plata llegó**: comprobante, monto, titular de la cuenta desde la
  que transfirió, que no sea un comprobante repetido.
- **Retiro:** el jugador pide **cobrar** fichas que ya tiene. No transfirió nada, así que **no hay
  comprobante del jugador**. Pide monto, la cuenta donde cobra (alias o CBU) y el titular de esa cuenta.
  Al usuario ya se lo conoce. Lo que hay que verificar es que **le alcanzan las fichas** y que **la
  cuenta es suya** (DNI una vez por cuenta). Después se le descuentan las fichas y el operador le
  transfiere.

Todo lo que en un retiro hable de "comprobante", "transferencia del jugador" o "la cuenta desde la que
transferís" está mal.

---

## CARGA

**Qué hace el jugador** (`Portal`: goCarga, renderCarga)
- No puede tener otra solicitud abierta, y su usuario tiene que estar validado (vínculo usuario +
  teléfono). Si no está validado, ni siquiera se le muestra la cuenta a la que transferir.
- Ve la cuenta de la oficina (alias/CBU) y transfiere desde su banco o billetera.
- Carga sólo **monto** (mínimo $1.000 o el de la oficina) y **titular de la cuenta desde la que
  transfirió**. Al usuario ya se lo conoce.
- La pantalla no pide comprobante. El comprobante llega, si llega, como foto por el chat.
- El titular se revisa antes de enviar: tiene que tener letras, no puede ser el de nuestra cuenta, ni su
  propio usuario, ni un titular bloqueado.

**Qué ve y decide el operador**
- **Tarjeta en el chat** (`renderer/chat/chat-solicitud-preview.js`). El semáforo mira:
  - mismo monto ya procesado en 12 h;
  - comprobante programado, monto distinto o imagen que no es comprobante (lectura con IA);
  - comprobante viejo;
  - falta de comprobante.
- **Ventana "Aprobar portal"** (`renderer/portal/operation-modal.js`):
  - lo que declaró el jugador;
  - el vínculo;
  - el monto, que se puede editar;
  - la billetera de la oficina donde entró la plata;
  - el **bono de primer ingreso**, sólo en cargas, con tope; si la cuenta ya cobró el bono con otro
    usuario, la casilla viene apagada.

**Aprobar** (`renderer/portal/operation-execution.js`)
1. La solicitud pasa a EN_PROCESO.
2. En Agentes (el casino) se le cargan las fichas, con el bono si corresponde.
3. Se anota en el historial y en la billetera.
4. La solicitud queda ACREDITADA. Se anota en Chunior en segundo plano.

El jugador se entera por la pantalla Estado ("¡Carga acreditada! Ya podés jugar."). No hay mensaje por
chat.

**Rechazar** (`renderer/portal/rejections.js`)
- Motivos rápidos de carga: no llegó la transferencia, el comprobante no coincide, comprobante repetido,
  titular que no coincide.
- Se puede bloquear el titular.
- Al jugador le llega "❌ Tu solicitud fue rechazada. 📝 Motivo: …" y lo ve en el Portal.
- **"✅ Ya se la cargué"** (sólo cargas): si ya tenía las fichas cargadas por otro lado, se cierra como
  ACREDITADA y no como rechazo.

**Errores conocidos y cómo se resolvieron**
- **Sesión de Agentes caída:** la solicitud vuelve a EN_REVISION, no queda en error. NODO muestra una
  barra fija hasta que se vuelve a entrar, y esa barra corre el panel hacia abajo, no lo tapa.
- **Titular copiado de nuestra cuenta, sin letras o su propio usuario:** rechazo automático con
  interruptor.
- **Comprobante repetido:** sólo existe la alerta de "mismo monto en 12 h". El freno de 5 minutos del
  servidor apunta a una tabla que ya no se usa (sigue abierto, ver `DESCONEXIONES.md`).
- **El comprobante enviado por el chat no queda atado a su solicitud:** pendiente.

**El chat automático en una carga** (`Portal`: funciones guia*)
- "Transferí y no me apareció": mira el historial y le pide el comprobante.
- "Me la rechazaron": muestra el motivo y le pide el comprobante.
- "Me equivoqué en el monto": **no cambia el monto**. Le avisa al operador y le dice al jugador que no
  mande otra.
- Deriva a una persona si la pide, o si no hay cuenta para mostrarle.
- No crea una segunda solicitud por otro camino, no ofrece cargar a quien no está validado, no se mete
  cuando contesta una persona y no inventa datos.

---

## RETIRO

**Qué hace el jugador** (`Portal`: goRetiro, renderRetiro, crearSolicitudRetiro)
- No puede tener otra solicitud abierta, tiene que estar validado, y le corresponde **un retiro cada 24
  horas**. Ojo: hoy ese límite vive sólo en el teléfono del jugador (`servidor/retiro-cada-24h.md`).
- Carga **monto** (mínimo $5.000), **la cuenta donde cobra** (alias o CBU, al menos 6 caracteres tal
  como lo escribe) y **el titular de esa cuenta**. Al usuario ya se lo conoce.
- **No hay comprobante.**
- **DNI (beta, por oficina con interruptor):** se pide **una sola vez por cuenta de cobro**, o al cambiar
  de cuenta. Si el número sugiere que puede ser menor, el Portal pregunta la edad ("Tu DNI parece ser el
  de un menor de edad…").
  - El número del DNI **nunca traba**: sólo avisa al operador. La única traba dura es decir que tiene
    menos de 18, y se puede corregir.
  - Detalle: `servidor/retiro-instrumentos-portal.sql` (`_retiro_inst_dni_control`).

**Qué ve y decide el operador**
- **Tarjeta en el chat:** monto, estado, cuenta donde cobra y titular. Nada de comprobante: una foto que
  el jugador mande por el chat no tiene nada que ver con su retiro.
- **Ventana "Aprobar portal":**
  - titular grande y la cuenta de cobro para copiar;
  - las **fichas** del jugador (si alcanzan);
  - alertas de bono sin liberar o de cuenta compartida;
  - botón **Parcial**, para pagarlo en partes;
  - el bono de primer ingreso **no** aparece: es de cargas.
- **Validación del DNI** (sólo retiros con la marca `retiro_instrumento_v1`, antes de pagar):
  `renderer/portal/withdrawal-instrument.js`.
  - El operador copia la cuenta, la mira en Mercado Pago y escribe **el DNI del titular** (7 u 8
    números; no CUIT/CUIL). No ve el DNI que declaró el jugador.
  - Si hay avisos (edad, número raro, ya rechazado antes), tiene que tildar "Lo revisé: es mayor de 18
    años" para poder validar.
  - Si no coincide, le queda un intento más. Si tampoco coincide, se rechaza sin descontar fichas y el
    jugador recibe el aviso.

**Aprobar** (`renderer/portal/operation-execution.js`, `withdrawals-execution.js`)
1. Aviso si ya cobró en las últimas 24 horas. El operador puede seguir igual.
2. Si las fichas no alcanzan, queda ERROR_OPERATIVO.
3. En Agentes se le **descuentan las fichas**, baja la billetera, y la solicitud queda PAGADA con la hora.
4. Al jugador le llega "✅ Tu retiro de $X fue transferido a las HH hs.".

La transferencia bancaria la hace el operador a mano. El código no la hace ni la verifica, y no está
claro en qué momento exacto la hace.

**Parcial:** se paga por partes. Queda EN_PROCESO hasta completar, y al jugador le llega "💸 Te
transferimos $X… restan $Y" o "✅ Completamos tu retiro".

**Rechazar**
- Motivos rápidos de retiro: las fichas no alcanzan, el titular de la cuenta donde cobra no coincide, la
  cuenta de cobro no es válida, problema general.
- **No existe "Ya se la cargué"** en un retiro.
- En el Portal, después de un retiro rechazado el botón es "Nuevo retiro", no "Nueva carga".
- Un retiro rechazado libera el límite de 24 horas.

**Errores conocidos y cómo se resolvieron**
- **La ventana del DNI no encontraba la conexión al servidor** (8/11, primer retiro real) y ofrecía
  "¿Continuar igual?", que deja pagar sin validar. Ya la encuentra. Y desde el 9/11, en un retiro marcado
  para DNI, si el servidor falla **no se paga**: "No se pudo comprobar la cuenta de cobro. No se movió
  saldo. Probá de nuevo en un momento." Ya no existe "¿Continuar igual?".
- **La consulta previa del DNI recorría todas las solicitudes** (457.000 filas, 2,9 s) y el servidor la
  cortaba: "No pudimos comprobar la verificación". Ahora va directo por número (17 ms).
- **El alias ".pobre" pasaba en el Portal y el servidor lo rechazaba** (contaba sin el punto). Ahora los
  dos miden igual.
- **El cierre de un parcial generaba muchas filas por un solo pago:** se agregó un candado.
- **"▶ Auto" marca PAGADA sin pasar por los parciales:** ver `MAPA-MOVIMIENTOS.md`.

**El chat automático en un retiro**
- Ficha de retiro: con la cuenta ya verificada, o pidiendo el DNI.
- Estado del retiro:
  - rechazado por DNI: "No se descontaron fichas. Corregí…";
  - en verificación: "No hace falta que envíes otro";
  - pagado: deriva a una persona;
  - parcial: "ya te pagamos X y faltan Y".
- "Corregir DNI o cuenta" libera el límite de 24 horas.
- "Ese no lo pedí yo" deriva a una persona.
- No existe todavía: "cambié de número" (pendiente).

---

**Cuenta de cobro nueva con el DNI apagado (18/11).** Con `pide_dni` apagado no se le pide DNI al jugador,
pero la cuenta nueva igual se confirma una vez: antes de pagar, NODO abre "Cuenta de cobro nueva · una sola
vez" y el cajero mira en Mercado Pago o el banco a nombre de quién está. "Está a nombre del jugador · seguir"
la deja validada (y el Portal deja de decir "verificando"); "es de otra persona" rechaza sin descontar fichas
y le avisa al jugador. Antes el servidor la daba por "sin declarar", NODO pagaba sin preguntar y el jugador
veía "verificando" para siempre. Servidor: `servidor/retiro-cuenta-nueva-sin-dni.sql`.

**Mensajes delicados (18/11).** Si el jugador escribe algo de angustia o de no poder parar de jugar, el
servidor marca ese mensaje (cualquier mensaje, no sólo el primero) y NODO lo muestra con un recuadro rojo
"Mensaje delicado". El asistente no los contesta: lo atiende una persona. `servidor/mensaje-delicado.sql`.

## Lugares donde NODO trató un retiro como carga

Encontrados el 9/11. Están corregidos salvo los que dicen "abierto".
- Tarjeta del chat: usaba la última foto del chat como "comprobante" del retiro y la analizaba, y decía
  "Sin comprobante adjunto". **Corregido.**
- Rechazo: ofrecía "Ya se la cargué", motivos de transferencia y textos de "la cuenta desde la que
  transferís". **Corregido.**
- Portal: botón "Nueva carga" después de un retiro rechazado. **Corregido.**
- Ventana Aprobar: el bono de primer ingreso salía en retiros. **Corregido.**
- Ventana Aprobar: en retiros dice "Billetera destino" y el ejemplo de Obs habla de "comprobante real".
  **Abierto** (es sólo texto).
- El auto-retiro descuenta de la billetera de depósitos (`renderer/core/automatizaciones.js`, función
  getBilleraLanding). **Abierto: no está claro si es a propósito.** Preguntarle a Juan antes de tocarlo.
- `rejections.js`: cualquier motivo que diga "transferencia" se clasifica como "no llegó la
  transferencia". **Abierto** (menor).

## ACCESO: el que no puede entrar o es nuevo (16/11)

- El jugador toca "Tengo usuario pero no puedo entrar" o "Soy nuevo" y deja su teléfono (el usuario
  puede quedar vacío). El Portal abre un chat y manda un solo mensaje con lo que escribió; si no puso
  usuario, el chat se llama "ayuda-<teléfono>" o "nuevo-<teléfono>" (provisorio) y el mensaje dice
  "No escribí mi usuario".
- Mientras espera: se queda en el chat, ve su mensaje con ✓, el asistente le dice que le llegó a su
  cajero y, cuando NODO lo abre, ✓✓ y "Tu cajero ya vio tu mensaje". No se le ofrece validar ni
  registrarse otra vez. Inicio dice "Tu cajero ya tiene tu pedido".
- En NODO beta no contesta el bot de palabras (servidor). La tarjeta de cotejo coteja el usuario sólo
  si lo escribió con rótulo; si no, lo dice ("no lo escribió") y coteja por teléfono.
- El operador valida con "Validar y vincular"; al jugador le aparece el botón para entrar.
- Cómo probarlo de punta a punta: `docs/PRUEBA_PORTAL_NODO.md`.

## Antes de tocar una pantalla de operaciones

1. ¿Es carga, retiro o las dos? Lo que se muestra tiene que tener sentido para ese tipo (ver "La
   diferencia en una línea").
2. ¿Qué tiene que decidir el operador en esa pantalla? Mostrar eso y nada más
   (memoria: pantallas-para-operadores).
3. ¿Qué le llega al jugador y cuándo? ¿El chat automático lo tiene que saber resolver?
4. Botones: `docs/BOTONES.md`. Y probar mirando la pantalla, no sólo con pruebas.
5. Recorrerlo como el jugador y como el operador, contra el servidor real, y leer cada captura como
   alguien de afuera: `docs/PRUEBA_PORTAL_NODO.md`.

## Carga cerrada como "ya cargada" (18/11)

"Marcar como ya cargada" es para un pedido de carga cuyas fichas se cargaron por otro lado (a mano, por
depósito reclamado, o porque el jugador lo mandó dos veces). Antes cerraba el pedido sin dejar nada en el
historial de NODO: de los últimos 12, 9 no tenían ninguna fila y "desaparecían".

Criterio (Juan): simple — **mismo usuario, mismo monto, mismo horario**. Los movimientos no tienen id: la hora
con segundos es su identidad. Al abrir el cartel NODO busca, desde 2 h antes del pedido:
- **Historial de NODO**: cargas OK de ese usuario por ese monto.
- **AdminOnline, "Movimientos de crédito"** (`/agents/tokens-report`): "Deposito de un jugador" DONE por ese monto
  a ese alias. Una fila de NODO y un movimiento de AdminOnline a menos de 3 minutos son la misma carga.
- **La plata**: si la fila de NODO tiene atado el movimiento de Chunior o de Mercado Pago, se muestra; si no,
  "no se pudo extraer más información" (se coteja con el botón Cotejo).

Qué hace al cerrar:
- Una sola carga libre en NODO → se ata al pedido (y se marca si AdminOnline la confirma a la misma hora).
- Ya atada a otro pedido → **pedido repetido**: no se suma nada.
- Sólo en AdminOnline, y ese movimiento no se usó para cerrar otro pedido → se anota como `YA CARGADA` (suma),
  con la hora de AdminOnline en las notas para no volver a usarla.
- **Ante la duda** (dos cargas iguales, un error, no se pudo leer, sin rastro) **no se ata nada**: se dice "no se
  pudo extraer más información" y, si se cierra, queda "⚠ sin comprobar" (se ve en el historial, no suma).

## Cotejo de cargas: Agentes ↔ NODO ↔ Chunior (18/11)

Las cargas no siempre salen de NODO: alguien puede cargar directo en Agentes, o anotar en Chunior a
mano. NODO lee el "Reporte de carga y descarga" de Agentes cada 10 minutos (y cuando el operador
aprieta 🔄 Recargar en el historial, después de dibujarlo) y compara las últimas 6 horas.

- Criterio: mismo usuario, mismo monto, mismo horario (Agentes ↔ NODO a menos de 3 minutos;
  Chunior hasta 15, porque se anota a mano). Una carga en Agentes es "Deposito de un jugador" con monto
  positivo; con signo menos es un retiro.
- Los movimientos de Agentes no tienen número: la fecha con segundos es su identidad y queda en las
  notas de la fila ("Agentes 18/11/2026 13:33:38").

| Agentes | NODO | Chunior | Qué hace NODO |
|---|---|---|---|
| sí | no | sí | La enlaza y la dibuja en el historial. Sin aviso. |
| sí | no | no | La anota en Chunior en la billetera en uso, la dibuja (con su Deshacer) y avisa: "no se hizo desde NODO ni estaba anotada, avisale a tu superior". El operador marca "Lo vi". |
| sí | sí | no | La sube a Chunior (salvo que NODO ya la tenga en su cola de reintentos). |
| no | sí | sí/no | Avisa: "figura anotada, pero en Agentes no aparece". El operador marca "Lo vi". |

Ante la duda no se toca nada: dos cargas iguales que podrían ser cualquiera, una fila parecida suelta a
menos de una hora (relojes corridos), una lectura incompleta o una operación en curso. Lo que quedó en
duda no se vuelve a mirar en Chunior por una hora. Los avisos salen del historial, así que los ve
cualquier PC de la oficina, y "Lo vi" queda anotado con el nombre del operador.

Dónde se lee: AdminOnline y agentesbet.io por su menú, sin recargar; Drex en /agents/activity, pestaña
"Movimientos de crédito". Código: renderer/core/cotejo-cargas.js y leerMovimientosCredito en cada preload.

### Retiros (18/11)
Van igual que las cargas: en Agentes el retiro es "Deposito de un jugador" con signo menos; en NODO, filas
RETIRO; en Chunior, el monto en negativo. Una carga nunca se ata con un retiro.

## Pasada por los historiales de Chunior (18/11)

"Cada cosa que te deja anotar Chunior debería estar en NODO" (Juan). Chunior guarda siete historiales
(menú Transacciones) y NODO sabe qué es cada uno en su historial:

| Chunior | En el historial de NODO |
|---|---|
| Movimientos de fichas | CARGA (monto positivo) / RETIRO (negativo) |
| Movimientos entre billeteras | MOV_BILLETERA (y CAMBIO_BILLETERA, MOVER_RETIRO, FALTANTE) |
| Propinas | PROPINA |
| Depósitos sin reclamar | DEPOSITO_SR |
| Gastos de oficina | GASTO |
| Recargas administrativas | RECARGA_FICHAS |
| Transferencias a financieras | FINANCIERA (NODO no las hace: sólo se registran) |

Cada 30 minutos y al apretar 🔄 Recargar en el historial, NODO recorre esas listas desde la última pasada
(la primera vez, el último día) y cada movimiento:
- tiene su fila por su N° de Chunior → nada;
- hay una fila de NODO sin N° que es la misma (tipo, monto, menos de 3 minutos; en fichas también el
  usuario) → se le pone el N°;
- no hay nada → se crea la fila (origen CHUNIOR) con quién lo anotó, el N° y las billeteras, para que no
  se pierda nada hecho por fuera de NODO. Si es una carga o un retiro, después el cotejo con Agentes
  avisa si en Agentes no aparece.
Lo anotado hace menos de 5 minutos se deja para la próxima pasada (NODO puede estar escribiendo su fila).
Código: renderer/core/cotejo-chunior.js.
