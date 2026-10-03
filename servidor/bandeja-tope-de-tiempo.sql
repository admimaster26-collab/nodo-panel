-- La causa de verdad de "las solicitudes tardan y despues caen todas juntas".  (Juan, 3/10)
--
-- En la consola de P4 el motivo sale escrito:
--   [bandeja] no se pudo refrescar  {pc:'P4', causa:'servidor',
--                                    motivo:'canceling statement due to statement timeout'}
--
-- El panel entra a la base como `anon`, y ese rol tiene statement_timeout = 3s. La bandeja de P4
-- devuelve 387 kB; medida en reposo tarda entre 187 ms y 1,1 s, pero con la base cargada se pasa
-- de los 3 s y el servidor la MATA a mitad de camino. No es que tarde: es que no llega a terminar
-- nunca y hay que empezar de cero.
--
-- Y encima se realimentaba: al cortarse, el panel reintentaba. Tres intentos contra una base que
-- ya estaba ahogada, cada 10 segundos. El tope corto EMPUJABA la carga para arriba.
--
-- Nada de esto lo arreglaba el motor de verificacion. El motor solo decidia cuando volver a
-- pedirla (y hoy se bajo de 60 s a 10 s, que ayudo pero no era la causa).

alter function public.panel_v15_5_listar_solicitudes_portal(text)
  set statement_timeout = '20s';

-- Esto NO la hace mas rapida: la deja TERMINAR. Lo que se gana es que deje de morir y reempezar.
--
-- Lo que falta para que ademas sea rapida: los 387 kB. Son 300 filas enteras, con todas sus
-- columnas, en cada refresco. El metadata ya viene recortado (se le sacan 6 claves, ~25 kB); el
-- resto son las columnas de la fila. La lista del panel no necesita todo eso.
-- Queda pendiente y es el arreglo de fondo.
--
-- Para volver atras:
--   alter function public.panel_v15_5_listar_solicitudes_portal(text) reset statement_timeout;

-- ===========================================================================
-- VUELTA ATRAS, el mismo dia, a los pocos minutos. El cambio de arriba ESTA DESHECHO.
-- ===========================================================================
-- Lo que no calcule: el panel no deja correr dos lecturas de la bandeja a la vez (candado
-- anti-solapamiento en requests.js). Con el tope en 3s, una consulta lenta moria y liberaba.
-- Con el tope en 20s se queda hasta 20 -- y todo lo que el operador pide en el medio queda
-- encolado detras de ella.
--
-- Medido en pg_stat_statements despues del cambio: una llamada llego a 19.781 ms.
-- Juan lo vio como "termino dos cargas y no se van de la lista hasta el proximo refresh".
-- Antes de mi cambio no pasaba.
--
--   alter function public.panel_v15_5_listar_solicitudes_portal(text) reset statement_timeout;
--
-- Queda el sintoma viejo (se corta y reintenta), que es preferible: cortarse deja la lista
-- vieja en pantalla pero NO traba lo que viene atras.
--
-- CONCLUSION: mientras la consulta devuelva 387 kB y 300 filas enteras, cualquier numero que se
-- le ponga al tope elige entre cortarse o trabar. No hay numero bueno. Lo unico que lo arregla
-- es que pese menos.
