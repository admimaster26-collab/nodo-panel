-- Cierra dos funciones de bonos que cualquiera podía llamar con la clave pública del Portal (2/11).
-- bono_reiniciar_lista_negra borraba la lista negra de una campaña (4.537 personas que ya cobraron)
-- y bono_anotar anotaba bonos. Las siguen usando panel_bono_anotar (con secreto) y
-- admin_bonos_reiniciar (con sesión del panel admin), que corren con permisos de su dueño.
-- Foto previa: proacl NULL (permisos por defecto) en las dos; md5 del cuerpo
-- bono_anotar b3bc050d8d93299587cce443cc50b8d2, bono_reiniciar_lista_negra 6157863c159de624943f0695833f971f.
-- Sin llamadas directas en las 24 h previas (registro de la API). Vuelta atrás: bonos-cerrar-escrituras-vuelta-atras.sql
-- Aplicado el 4/11 (migración bonos_cerrar_escrituras), con los dos md5 todavía iguales a la foto previa.

revoke execute on function public.bono_anotar(bigint,text,numeric,text,bigint,text) from public, anon, authenticated;
revoke execute on function public.bono_reiniciar_lista_negra(bigint,text) from public, anon, authenticated;
grant execute on function public.bono_anotar(bigint,text,numeric,text,bigint,text) to service_role;
grant execute on function public.bono_reiniciar_lista_negra(bigint,text) to service_role;
