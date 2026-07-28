-- ============================================================
-- NODO · RPC para que el CRM del panel incluya a TODOS los usuarios registrados,
-- no solo a los que tienen operaciones de agente.
--
-- El CRM del panel (buildCRM) ya cruza: historial del panel + CSV de operaciones de agente.
-- Le faltaba la 3ra fuente: los VÍNCULOS de whaticket (usuario+teléfono) de usuarios_portal_vinculos.
-- El panel NO puede leer esa tabla directo (RLS la bloquea), así que va por esta RPC scopeada por
-- oficina, igual que panel_crm_agente_resumen / panel_crm_flags (SECURITY DEFINER, sin secret).
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.panel_crm_vinculos(p_pc_codigos text[])
 RETURNS TABLE(
   usuario text,
   telefono_canon text,
   titular text,
   estado_vinculo text,
   fuente text,
   updated_at timestamptz
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    lower(trim(v.usuario))                         as usuario,
    max(v.telefono_canon)                          as telefono_canon,
    max(v.titular)                                 as titular,
    max(v.estado_vinculo)                          as estado_vinculo,
    max(v.fuente)                                  as fuente,
    max(v.updated_at)                              as updated_at
  from public.usuarios_portal_vinculos v
  where coalesce(trim(v.usuario),'') <> ''
    and upper(coalesce(v.pc_codigo,'')) = any (select upper(x) from unnest(p_pc_codigos) x)
  group by lower(trim(v.usuario));
$function$;

-- Permisos: mismo nivel que las otras RPC del CRM (las llama el panel con la clave anon).
grant execute on function public.panel_crm_vinculos(text[]) to anon, authenticated;

-- ============================================================
-- VERIFICACIÓN (opcional)
-- ============================================================
-- Debe devolver los usuarios vinculados de esas oficinas (los alias de P1 incluyen GENERAL/XGENERAL…):
-- select count(*) from public.panel_crm_vinculos(array['P1','PC1','XGENERAL','XGENERALENUSO','GENERAL']);
-- select * from public.panel_crm_vinculos(array['P4','SANCHEZPLATA']) limit 20;
