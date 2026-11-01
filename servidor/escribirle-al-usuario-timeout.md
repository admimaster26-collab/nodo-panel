# "Escribirle a un usuario" moría por timeout  ·  27/10

Juan, 27/10: *"en la antigua version no le puedo enviar mensaje a los usuarios directamente yo, ya
lo habiamos arreglado, podrias verificarlo?"*

En la pantalla: **«No se pudo enviar: canceling statement due to statement timeout»**.
En la consola: `POST .../rpc/panel_chat_iniciar` → **500**.

## Lo que pasaba

`panel_chat_iniciar` hace tres consultas. La primera, medida contra producción ese día:

```
Index Scan using idx_landing_sol_portal_pc_fecha on landing_solicitudes
  Filter: (lower(TRIM(BOTH FROM usuario)) = 'jugador_demo')
  Rows Removed by Filter: 403554
Execution Time: 42831.820 ms
```

**42,8 segundos**, contra un techo de 3. Nunca iba a terminar: el botón estaba muerto para
cualquier usuario, no sólo para ese.

La condición estaba escrita sobre una **expresión** de la columna —`lower(trim(usuario))`— y no
existe ningún índice con esa forma si no va la oficina adelante. El planificador entraba por
`origen`, y después le aplicaba `lower(trim())` a **403.554 filas** una por una para quedarse con
254.

> Es el mismo error que ya nos costó el recontactar del CRM y la cola de reconexión: **una
> condición sobre una expresión de la columna no puede usar un índice de la columna.**

Las otras dos consultas de la función estaban bien y no se tocaron: el vínculo entra por
`upv_usuario_idx` (1,5 ms) y el hilo de SOPORTE por `idx_landing_solicitudes_soporte_estado`
(1,7 ms).

## Para qué servía esa consulta

Resuelve **cómo se escribe** el usuario. El panel puede mandar `RodyoVii` y el portal lo tiene
guardado `jugador_demo`; la búsqueda del hilo que viene después compara exacto, así que sin esto no
encontraría la conversación y crearía una nueva cada vez.

## Lo que quedó

La misma consulta, acotada a la oficina del operador:

```sql
where upper(coalesce(s.pc_codigo,'')) = v_pc
  and lower(btrim(s.usuario))         = lower(v_u)
  and coalesce(s.origen,'')           = 'PORTAL_V16'
```

Esas dos primeras condiciones están escritas **con la forma exacta del índice**
`idx_landing_sol_pcupper_usuario`, que ya existía. Cambiarle `btrim` por `trim`, o sacarle el
`coalesce`, lo vuelve a dejar sin índice y vuelven los 42 segundos.

```
Execution Time: 3.901 ms          ← 11.000 veces menos
```

**Y además quedó más correcto.** Juan, 21/10: *"los usuarios son unicos por oficina"*. Buscando en
las 14, la grafía podía salir de la fila de otra persona con el mismo alias en otra oficina.

## Cómo se verificó

Ejecutando la función de verdad contra el usuario de la captura, dentro de una transacción
deshecha para que no le llegara ningún mensaje:

```sql
begin;
select public.panel_chat_iniciar(<secreto>,'P4','RodyoVii','prueba interna','ZZ_PRUEBA');
rollback;
```

```
{"ok": true, "creada": false, "usuario": "jugador_demo", "solicitud_id": 332861}
tardó: 00:00:00.087264
```

**87 ms.** Tres cosas de una: contesta, resuelve `RodyoVii` → `jugador_demo` (la grafía sigue
funcionando), y dice `creada:false` — encontró el hilo que ya existía en vez de abrir uno nuevo.
Después se comprobó que la solicitud 332861 seguía con sus 10 mensajes y sin rastro de la prueba.

## Se revisaron las demás

Otras cinco funciones tienen una forma parecida. Se midieron todas y ninguna está en problemas:

| función | ms |
|---|---|
| `landing_portal_chat_thread_get` | 14 |
| `landing_datos_retiro` | 8 |
| `panel_retiro_alertas` | 15 |
| `landing_chat_abrir_v3` | 38 |
| `_reconexion_candidatos` | ya arreglada antes (4.070 → 112 ms) |

## Alcance

Es del lado del servidor, así que **ya funciona en las 14 oficinas y también en la PC de 1.2.0**,
sin publicar nada ni tocar una sola PC.
