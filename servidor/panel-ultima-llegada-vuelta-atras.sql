-- Saca panel_ultima_llegada. El semáforo de NODO vuelve a decir "sin comprobar" en Solicitudes,
-- Chat e Historial (nunca "al día") y el resto del panel sigue funcionando igual.
drop function if exists public.panel_ultima_llegada(text, text, text[]);
