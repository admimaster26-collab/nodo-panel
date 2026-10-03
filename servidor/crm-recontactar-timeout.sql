-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- CRM · "No se pudo cargar: canceling statement due to statement timeout"      (Juan, 3/10)
--
-- Sintoma: la pestana "Recuperacion de usuarios" no cargaba. En la consola, 500 en
--   panel_reconexion_cola y en panel_crm_vinculos_buscar.
--
-- El tope del rol anon es statement_timeout = 3 s. Las dos consultas lo pasaban.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ══ 1) panel_crm_vinculos_buscar — la que mas pesaba de TODO el sistema ════════════════════
--
--   27.575 llamadas · 1.494 ms de promedio · maximo 2.999 ms (= muerta por el tope)
--   11 HORAS Y MEDIA de base de datos acumuladas.
--
-- Cada llamada leia la tabla usuarios_portal_vinculos ENTERA: 251.586 filas, 118 MB,
-- 218.359 buffers (~1,7 GB) para devolver 40 filas. Y se la llama una vez por consulta de chat
-- que se abre (el cotejo automatico de usuario y telefono), asi que con el portal nuevo
-- adentro esto solo ya ahogaba al resto — incluida la cola de reconexion de arriba.
--
-- POR QUE: el termino de busqueda salia de un CTE (`from usuarios_portal_vinculos v, q`).
-- Un valor que viene de otra tabla el planificador NO lo puede meter en un indice. Encima el
-- `q.t = ''` colgado del mismo OR hacia el filtro entero no-indexable. No habia indice que
-- sirviera, hubiera o no.
--
-- ARREGLO: el termino pasa a ser una variable (constante para el planificador), el caso "sin
-- termino" sale por su propia rama, y tres indices de trigramas para que el like '%texto%'
-- entre por indice.
--
--   create extension if not exists pg_trgm with schema extensions;
--
--   create index concurrently idx_upv_usuario_trgm  on public.usuarios_portal_vinculos
--     using gin (lower(btrim(usuario)) extensions.gin_trgm_ops);                    -- 10 MB
--   create index concurrently idx_upv_titular_trgm  on public.usuarios_portal_vinculos
--     using gin (lower(coalesce(titular,'')) extensions.gin_trgm_ops);              -- 7,8 MB
--   create index concurrently idx_upv_telefono_trgm on public.usuarios_portal_vinculos
--     using gin (coalesce(telefono_canon,'') extensions.gin_trgm_ops);              -- 8,3 MB
--
--   (la nueva _panel_crm_vinculos_buscar_raw esta abajo)
--
-- MEDIDO, el mismo EXPLAIN ANALYZE antes y despues:
--   antes    1.658 ms   218.359 buffers
--   despues      7,6 ms       862 buffers          <- 218 veces menos lectura
--
-- MISMO RESULTADO: comparadas las dos versiones sobre 12 terminos (telefono, usuario, titular,
-- vacio, espacios, 2 letras, con filtro de oficina y sin filtro): 0 diferencias.


-- ══ 2) panel_reconexion_cola ═══════════════════════════════════════════════════════════════
--
--   P4 tardaba 3,2 s contra el tope de 3 s. Tres cosas, todas al pedo:
--
--   a) Traia la fila ENTERA de las 80.414 solicitudes de la oficina (metadata incluido, que es
--      lo pesado) para terminar usando 1.222. Ahora son tres pasos: primero los NOMBRES,
--      despues cuales nunca operaron (~500), y recien ahi el detalle de esos.
--
--   b) Preguntaba solicitud por solicitud si tenia una operacion: 80.414 preguntas por llamada,
--      1,9 GB de lecturas. Abajo ya se pregunta lo mismo POR USUARIO, que son 2.360 y va por
--      indice. Medido sobre las 10 oficinas y 9.595 usuarios: el chequeo por solicitud no saca
--      a NADIE que el chequeo por usuario no saque ya. 0 casos. Se fue.
--
--   c) El paso de los nombres leia 36.000 paginas de la tabla (280 MB) por llamada. Postgres NO
--      puede hacer un "index only scan" cuando la condicion va sobre una CUENTA de la columna
--      (upper(coalesce(pc_codigo,''))) en vez de la columna: se ve obligado a ir a la tabla
--      fila por fila. Con la columna cruda y un indice (pc_codigo, usuario) lee 2.213 paginas
--      del indice y no toca la tabla.
--
--      create index concurrently idx_landing_sol_pc_usuario_plano
--        on public.landing_solicitudes (pc_codigo, usuario);                      -- index only
--      create index concurrently idx_landing_sol_pcupper_usuario_fecha
--        on public.landing_solicitudes (upper(coalesce(pc_codigo,'')), lower(btrim(usuario)), created_at);
--      create index concurrently idx_landing_sol_pcupper_fecha
--        on public.landing_solicitudes (upper(coalesce(pc_codigo,'')), created_at desc);
--
--      El array [v_pc, lower(v_pc), initcap(lower(v_pc))] cubre las tres escrituras posibles del
--      codigo. Verificado el 3/10: las 300.364 solicitudes lo tienen en mayuscula, 0 excepciones.
--      Para volver a chequearlo:
--        select count(*) from landing_solicitudes
--         where pc_codigo is null or pc_codigo <> upper(btrim(pc_codigo));   -- tiene que dar 0
--
-- MEDIDO (por HTTP, como lo llama el panel):
--   antes     P4 3,25 s TIMEOUT · P2 3,25 s TIMEOUT · P7 3,26 s TIMEOUT · P5 3,27 s TIMEOUT
--   despues   P4 0,41-1,37 s · P2 0,47 s · P3 0,48 s · P7 0,52 s · P6 0,33 s · P5 0,33 s
--             P9 0,29 s · P9B 0,29 s · P8 0,29 s · P1 0,30 s · P10 0,31 s      sin un solo 500
--
-- MISMA COLA: comparada la version original contra la nueva usuario por usuario en las 12
-- oficinas (1.196 usuarios en cola): 0 que entren de mas, 0 que falten.


-- ══ 3) PENDIENTE para Juan — borrar los indices que probe y no quedaron ═════════════════════
-- Los permisos no me dejan borrar. Son tres que cree probando y que el planificador NO usa;
-- cada uno le cuesta tiempo a cada alta y a cada cambio de estado de solicitud. Hay que correrlos:
--
--   drop index concurrently if exists public.idx_landing_sol_pcupper_fecha_inc;
--   drop index concurrently if exists public.idx_landing_sol_pcupper_usuario;
--   drop index concurrently if exists public.idx_landing_sol_pcupper_usuario_raw;
--
-- Los que SI hay que dejar: idx_landing_sol_pc_usuario_plano, idx_landing_sol_pcupper_usuario_fecha,
-- idx_landing_sol_pcupper_fecha, y los tres idx_upv_*_trgm.
--
-- Para confirmar que ninguno de los tres se esta usando antes de borrarlos:
--   select relname, idx_scan from pg_stat_user_indexes
--    where relname in ('idx_landing_sol_pcupper_fecha_inc','idx_landing_sol_pcupper_usuario',
--                      'idx_landing_sol_pcupper_usuario_raw');


-- ══ 4) Lo que quedo en la base ═════════════════════════════════════════════════════════════
-- Generado con pg_get_functiondef despues de aplicar, 2026-10-03.
-- (el cuerpo completo de las dos funciones vive en la base; esto es la copia de lectura)

-- ── _panel_crm_vinculos_buscar_raw (la que quedo) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._panel_crm_vinculos_buscar_raw(p_pc_codigos text[], p_query text, p_limit integer default 50)
 RETURNS TABLE(usuario text, telefono_canon text, titular text, estado_vinculo text, fuente text, updated_at timestamptz, pc_codigo text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_t    text := lower(btrim(coalesce(p_query,'')));
  v_tel  text := regexp_replace(coalesce(p_query,''), '\D', '', 'g');
  v_lim  int  := greatest(1, least(coalesce(p_limit,50), 200));
  v_pc   boolean := (p_pc_codigos is null or array_length(p_pc_codigos,1) is null);
begin
  if v_t = '' then
    return query
      select lower(btrim(v.usuario)), max(v.telefono_canon), max(v.titular), max(v.estado_vinculo),
             max(v.fuente), max(v.updated_at), max(upper(coalesce(v.pc_codigo,'')))
      from public.usuarios_portal_vinculos v
      where coalesce(btrim(v.usuario),'') <> ''
        and ( v_pc or upper(coalesce(v.pc_codigo,'')) = any (select upper(x) from unnest(p_pc_codigos) x) )
      group by lower(btrim(v.usuario)) order by lower(btrim(v.usuario)) limit v_lim;
  else
    return query
      select lower(btrim(v.usuario)), max(v.telefono_canon), max(v.titular), max(v.estado_vinculo),
             max(v.fuente), max(v.updated_at), max(upper(coalesce(v.pc_codigo,'')))
      from public.usuarios_portal_vinculos v
      where coalesce(btrim(v.usuario),'') <> ''
        and ( v_pc or upper(coalesce(v.pc_codigo,'')) = any (select upper(x) from unnest(p_pc_codigos) x) )
        and ( lower(btrim(v.usuario))        like '%'||v_t||'%'
           or lower(coalesce(v.titular,''))  like '%'||v_t||'%'
           or (length(v_tel) >= 4 and coalesce(v.telefono_canon,'') like '%'||v_tel||'%') )
      group by lower(btrim(v.usuario)) order by lower(btrim(v.usuario)) limit v_lim;
  end if;
end
$function$;

-- panel_reconexion_cola: el cuerpo nuevo esta en la base (es largo y ya lleva sus comentarios).
--   select pg_get_functiondef('public.panel_reconexion_cola(text,text,text,integer)'::regprocedure);
