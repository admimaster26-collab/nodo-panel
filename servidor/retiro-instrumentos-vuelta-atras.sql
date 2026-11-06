-- Saca la validación de cuentas de cobro por DNI. BORRA las cuentas declaradas y validadas.
-- NODO y el Portal siguen funcionando: sin estas funciones, los retiros se pagan como antes.
drop function if exists public.panel_retiro_instrumento_rechazar(text, bigint, text);
drop function if exists public.panel_retiro_instrumento_validar(text, bigint, text, text);
drop function if exists public.panel_retiro_instrumento(text, bigint);
drop function if exists public.landing_retiro_instrumentos(text, text, text);
drop function if exists public.landing_retiro_instrumento_declarar(text, text, text, text, text, text);
drop function if exists public._retiro_inst_de_solicitud(bigint);
drop function if exists public._retiro_inst_pc(text);
drop function if exists public._retiro_inst_norm_dni(text);
drop function if exists public._retiro_inst_norm_destino(text);
drop table if exists public.retiro_instrumento_eventos;
drop table if exists public.retiro_instrumentos;
