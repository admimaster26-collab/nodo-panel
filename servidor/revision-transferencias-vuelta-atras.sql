-- Vuelta atrás de servidor/revision-transferencias.sql (14/11).
--
-- Nada de esto existía antes: no hay definición previa que restaurar. La vuelta atrás es sacarlo.
-- Foto previa verificada el 14/11: no existían revision_switch, revision_movimientos,
-- revision_turno_id, revision_turno_rango ni ninguna panel_revision_*. historial_ops ya tenía la
-- columna mp_movimiento_id y su índice, vacía en las 515.887 filas.
--
-- ORDEN QUE IMPORTA: primero apagar, después borrar. Si se borran las funciones mientras una PC
-- sigue corriendo el comando, el comando falla contra el servidor cada vez.
--
--   update public.revision_switch set modo='OFF';     -- esto solo ya la deja sin correr
--
-- Lo de abajo borra de verdad y se pierde lo leído. No hace falta para apagarla.

-- 1. Apagar (reversible, es lo único que normalmente hace falta)
-- update public.revision_switch set modo='OFF', cambiado_at=now(), cambiado_por='vuelta atras';

-- 2. Soltar el sello de historial_ops, si se llegó a usar panel_revision_sellar.
--    Devuelve la columna al estado en que estaba (nula en todas las filas).
-- update public.historial_ops o set mp_movimiento_id = null
--  where o.mp_movimiento_id is not null
--    and exists (select 1 from public.revision_movimientos m where m.mov_id = o.mp_movimiento_id);

-- 3. Borrar las funciones
-- drop function if exists public.panel_revision_por_nombre(text,text,text);
-- drop function if exists public.panel_revision_cierre(text,text,text);
-- drop function if exists public.panel_revision_sellar(text,text,integer);
-- drop function if exists public.panel_revision_enganchar(text,text,integer);
-- drop function if exists public.panel_revision_guardar(text,text,jsonb,jsonb);
-- drop function if exists public.panel_revision_modo(text,text);
-- drop function if exists public.revision_turno_rango(text);
-- drop function if exists public.revision_turno_id(timestamptz);

-- 4. Borrar las tablas (acá se pierde lo leído del banco)
-- drop table if exists public.revision_movimientos;
-- drop table if exists public.revision_switch;

-- Pendiente de limpieza (14/11): quedaron 6 filas de prueba en revision_movimientos de P4 con
-- mov_id como 'TEST-%', marcadas vinculo='IGNORAR' y vinculo_como='FILA_DE_PRUEBA' para que no
-- entren en ningún conteo. El delete lo frenó el clasificador; se borran con la orden de Juan:
-- delete from public.revision_movimientos where pc_codigo='P4' and mov_id like 'TEST-%';
