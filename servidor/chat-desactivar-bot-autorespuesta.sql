-- Desactivar el bot automático de soporte y chat.
-- Motivo: Los mensajes automáticos del bot ("Hola [usuario], ¿en qué te podemos ayudar?",
-- "Tu carga fue rechazada... escribinos", "Vemos tu carga hace X minutos...") se disparaban
-- por palabras clave en milisegundos, chocaban con la atención humana y generaban falsas
-- expectativas en los jugadores. El flujo oficial ahora se canaliza 100% mediante el
-- Asistente Guiado interactivo del Portal (donde el usuario elige con botones lo que necesita).
--
-- No borra datos históricos ni afecta tablas.
-- Vuelta atrás: servidor/chat-desactivar-bot-autorespuesta-vuelta-atras.sql.
-- Responsable: Juan.

-- 1. Eliminar los disparadores en chat_mensajes y landing_solicitudes
DROP TRIGGER IF EXISTS trg_chat_autorespuesta ON public.chat_mensajes;
DROP TRIGGER IF EXISTS trg_soporte_autorespuesta ON public.landing_solicitudes;

-- 2. Vaciar la función de autorespuesta pura para que nunca emita mensajes
CREATE OR REPLACE FUNCTION public.soporte_auto_mensaje_v1(
  p_pc text,
  p_usuario text,
  p_texto text,
  p_cuando timestamp with time zone DEFAULT now()
)
RETURNS TABLE(caso text, mensaje text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Desactivado por completo: el bot automático fue retirado.
  -- Las consultas se gestionan mediante el asistente guiado del Portal y operadores reales.
  RETURN;
END;
$function$;

-- 3. Funciones trigger en modo passthrough por si algún trigger dependiente aún las llamara
CREATE OR REPLACE FUNCTION public.trg_soporte_autorespuesta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_chat_autorespuesta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

