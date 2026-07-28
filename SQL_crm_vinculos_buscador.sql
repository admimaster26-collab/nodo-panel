-- ============================================================
-- NODO · CRM · Buscador on-demand sobre la base WTK (usuarios_portal_vinculos)
-- v2 (2026-07-26): GLOBAL (todas las oficinas) — p_pc_codigos NULL/vacío = todas.
-- El buscador devuelve pc_codigo para saber de qué oficina es cada usuario.
-- El RPC panel_crm_vinculos (viejo) corta a ~1000 por el cap de PostgREST; por eso
-- muchos usuarios de una oficina grande (P4) no aparecen. Esto lo resuelve.
-- ============================================================

-- 1) Contador de usuarios únicos registrados (WTK). Si p_pc_codigos es NULL/vacío → TODAS las oficinas.
create or replace function public.panel_crm_vinculos_count(p_pc_codigos text[])
 returns bigint
 language sql security definer set search_path to 'public'
as $function$
  select count(distinct lower(trim(v.usuario)))
  from public.usuarios_portal_vinculos v
  where coalesce(trim(v.usuario),'') <> ''
    and ( p_pc_codigos is null
          or array_length(p_pc_codigos,1) is null
          or upper(coalesce(v.pc_codigo,'')) = any (select upper(x) from unnest(p_pc_codigos) x) );
$function$;

-- 2) Buscador on-demand: usuario / titular / teléfono. GLOBAL si p_pc_codigos NULL/vacío. Devuelve pc_codigo.
--    (cambia el tipo de retorno vs v1 → hay que DROP antes de recrear)
drop function if exists public.panel_crm_vinculos_buscar(text[], text, int);
create or replace function public.panel_crm_vinculos_buscar(
  p_pc_codigos text[], p_query text, p_limit int default 50)
 returns table(usuario text, telefono_canon text, titular text, estado_vinculo text, fuente text, updated_at timestamptz, pc_codigo text)
 language sql security definer set search_path to 'public'
as $function$
  with q as (
    select lower(trim(coalesce(p_query,'')))           as t,
           regexp_replace(coalesce(p_query,''),'\D','','g') as tel
  )
  select
    lower(trim(v.usuario))                as usuario,
    max(v.telefono_canon)                 as telefono_canon,
    max(v.titular)                        as titular,
    max(v.estado_vinculo)                 as estado_vinculo,
    max(v.fuente)                         as fuente,
    max(v.updated_at)                     as updated_at,
    max(upper(coalesce(v.pc_codigo,'')))  as pc_codigo
  from public.usuarios_portal_vinculos v, q
  where coalesce(trim(v.usuario),'') <> ''
    and ( p_pc_codigos is null
          or array_length(p_pc_codigos,1) is null
          or upper(coalesce(v.pc_codigo,'')) = any (select upper(x) from unnest(p_pc_codigos) x) )
    and (
      q.t = ''
      or lower(trim(v.usuario))        like '%'||q.t||'%'
      or lower(coalesce(v.titular,'')) like '%'||q.t||'%'
      or (length(q.tel) >= 4 and coalesce(v.telefono_canon,'') like '%'||q.tel||'%')
    )
  group by lower(trim(v.usuario))
  order by lower(trim(v.usuario))
  limit greatest(1, least(coalesce(p_limit,50), 200));
$function$;

-- Índices (recomendados para que vuele con 53k+ filas):
create index if not exists upv_usuario_idx on public.usuarios_portal_vinculos (lower(trim(usuario)));
create index if not exists upv_tel_idx     on public.usuarios_portal_vinculos (telefono_canon);
create index if not exists upv_pc_idx      on public.usuarios_portal_vinculos (upper(pc_codigo));

-- Permisos:
grant execute on function public.panel_crm_vinculos_count(text[]) to anon, authenticated;
grant execute on function public.panel_crm_vinculos_buscar(text[], text, int) to anon, authenticated;
