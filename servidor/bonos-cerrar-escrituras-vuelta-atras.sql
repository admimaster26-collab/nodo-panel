-- Vuelve a dejar las dos funciones como estaban antes del 2/11: ejecutables por cualquiera.
grant execute on function public.bono_anotar(bigint,text,numeric,text,bigint,text) to public, anon, authenticated;
grant execute on function public.bono_reiniciar_lista_negra(bigint,text) to public, anon, authenticated;
