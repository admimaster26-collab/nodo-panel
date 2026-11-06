-- Saca panel_solicitudes_ip. El perfil deja de mostrar la IP y sigue funcionando igual.
drop function if exists public.panel_solicitudes_ip(text, bigint[]);
