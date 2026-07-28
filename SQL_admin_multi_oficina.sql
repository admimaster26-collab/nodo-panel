-- ============================================================
-- NODO · ADMI · Encargado multi-oficina (subconjunto de oficinas, no todas)
-- Diseño "oficina activa": el encargado tiene una LISTA de oficinas permitidas;
-- elige cuál ve (oficina activa); panel_validar_admin_session devuelve esa como pc_codigo.
-- Las 43 RPC admin_* quedan INTACTAS. Idempotente: se puede correr varias veces.
-- (v2: DROP antes de recrear las funciones que cambian el RETURNS; pcs_extra se setea
--  con una RPC aparte para NO tocar admin_guardar_operador.)
-- Ejecutar TODO junto en el SQL Editor de Supabase.
-- ============================================================

-- 1) Oficinas EXTRA del operador (el set permitido = pc_codigo + pcs_extra)
alter table public.operadores
  add column if not exists pcs_extra text[] not null default '{}';

-- 2) Oficina ACTIVA por operador
create table if not exists public.admin_active_pc (
  operador_id bigint primary key,
  pc_codigo   text,
  updated_at  timestamptz not null default now()
);

-- 3) Validación de sesión (agrega columna pcs → hay que DROP primero)
drop function if exists public.panel_validar_admin_session(text);
create function public.panel_validar_admin_session(p_session_token text)
 returns table(ok boolean, mensaje text, operador_id bigint, usuario text, nombre text,
               rol text, tipo text, pc_codigo text, scope text, puede_todas boolean,
               expires_at timestamptz, pcs text[])
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_s public.panel_sessions;
  v_rol text; v_tipo text; v_home text;
  v_extra text[]; v_allowed text[]; v_active text;
begin
  v_s := public.panel_get_session(p_session_token);
  v_rol  := upper(trim(coalesce(v_s.rol, '')));
  v_tipo := upper(trim(coalesce(v_s.tipo, '')));
  v_home := upper(trim(coalesce(v_s.pc_codigo, '')));

  -- ADMIN GLOBAL (igual que antes: ve todo)
  if v_rol in ('ADMIN', 'SUPERADMIN') then
    return query select true, 'Sesión admin válida'::text, v_s.operador_id, v_s.usuario, v_s.nombre,
      v_rol, v_tipo, v_home, 'GLOBAL'::text, true, v_s.expires_at, null::text[];
    return;
  end if;

  -- ENCARGADO (una o VARIAS oficinas)
  if v_rol in ('ENCARGADO', 'SUPERVISOR_PC') then
    if v_home = '' or v_home = 'TODAS' then
      raise exception 'Encargado sin PC asignada';
    end if;

    select coalesce(o.pcs_extra, '{}') into v_extra
    from public.operadores o where o.id = v_s.operador_id limit 1;

    -- set permitido = home + extras (normalizado, sin vacíos ni duplicados)
    select array_agg(distinct x) into v_allowed
    from (
      select v_home as x
      union all
      select upper(trim(e)) from unnest(coalesce(v_extra, '{}')) e
    ) q
    where x is not null and x <> '' and x <> 'TODAS';

    -- oficina activa: la guardada si está permitida; si no, la home
    select upper(trim(coalesce(a.pc_codigo, ''))) into v_active
    from public.admin_active_pc a where a.operador_id = v_s.operador_id limit 1;
    if v_active is null or v_active = '' or not (v_active = any(v_allowed)) then
      v_active := v_home;
    end if;

    return query select true, 'Sesión encargado válida'::text, v_s.operador_id, v_s.usuario, v_s.nombre,
      v_rol, v_tipo, v_active,
      case when coalesce(array_length(v_allowed, 1), 0) > 1 then 'MULTI'::text else 'PC'::text end,
      false, v_s.expires_at, v_allowed;
    return;
  end if;

  raise exception 'No tenés permisos para ingresar al panel Admin';
end;
$function$;

-- 4) Cambiar la oficina ACTIVA (valida que esté en la lista del encargado)
create or replace function public.admin_set_active_pc(p_session_token text, p_pc text)
 returns table(ok boolean, mensaje text, pc_codigo text)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_scope record; v_pc text;
begin
  select * into v_scope from public.panel_validar_admin_session(p_session_token) limit 1;
  v_pc := upper(trim(coalesce(p_pc, '')));
  if v_pc = '' then raise exception 'Oficina vacía'; end if;

  if not coalesce(v_scope.puede_todas, false) then
    if not (v_pc = any(coalesce(v_scope.pcs, '{}'))) then
      raise exception 'Esa oficina no está entre tus permisos';
    end if;
  end if;

  insert into public.admin_active_pc (operador_id, pc_codigo, updated_at)
  values (v_scope.operador_id, v_pc, now())
  on conflict (operador_id) do update set pc_codigo = excluded.pc_codigo, updated_at = now();

  return query select true, 'Oficina activa actualizada'::text, v_pc;
end;
$function$;

-- 5) admin_get_scope: devolver también la lista de oficinas (cambia RETURNS → DROP primero)
drop function if exists public.admin_get_scope(text);
create function public.admin_get_scope(p_session_token text)
 returns table(ok boolean, usuario text, nombre text, rol text, tipo text,
               pc_codigo text, scope text, puede_todas boolean, pcs text[])
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_admin record;
begin
  select * into v_admin from public.panel_validar_admin_session(p_session_token) limit 1;
  return query select true, v_admin.usuario, v_admin.nombre, v_admin.rol, v_admin.tipo,
    v_admin.pc_codigo, v_admin.scope, v_admin.puede_todas, v_admin.pcs;
end;
$function$;

-- 6) Asignar las oficinas extra a un encargado (RPC aparte → NO toca admin_guardar_operador).
--    Solo un ADMIN GLOBAL puede setearlas.
create or replace function public.admin_operador_set_pcs(p_session_token text, p_operador_id bigint, p_pcs text[])
 returns table(ok boolean, mensaje text)
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_scope record; v_extra text[];
begin
  select * into v_scope from public.panel_validar_admin_session(p_session_token) limit 1;
  if not coalesce(v_scope.puede_todas, false) then
    raise exception 'Solo un admin global puede asignar oficinas a un encargado';
  end if;

  select coalesce(array_agg(distinct upper(trim(e))), '{}') into v_extra
  from unnest(coalesce(p_pcs, '{}')) e
  where trim(coalesce(e, '')) <> '' and upper(trim(e)) <> 'TODAS';

  update public.operadores set pcs_extra = v_extra, updated_at = now()
  where id = p_operador_id;
  if not found then raise exception 'Operador no encontrado'; end if;

  return query select true, 'Oficinas del encargado actualizadas'::text;
end;
$function$;

-- Permisos (igual que las demás RPC admin). Ajustá el rol si tu proyecto usa otro.
-- grant execute on function public.admin_set_active_pc(text, text) to anon, authenticated;
-- grant execute on function public.admin_operador_set_pcs(text, bigint, text[]) to anon, authenticated;
