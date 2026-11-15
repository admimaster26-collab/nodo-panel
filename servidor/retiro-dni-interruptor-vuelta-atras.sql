-- Saca el interruptor del admin (8/11). Las llaves de cada oficina quedan como estén
-- (retiro_instrumentos_oficinas no se toca); la columna cambiado_por puede quedar.
drop function if exists public.admin_retiro_dni_oficina_cambiar(text, text, boolean);
drop function if exists public.admin_retiro_dni_oficinas(text);
drop table if exists public.retiro_instrumentos_oficinas_historial;
