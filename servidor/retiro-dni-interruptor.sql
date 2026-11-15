-- Interruptor del pedido de DNI en los retiros, por oficina (8/11).
-- Juan: "si la oficina quiere esa seguridad debe de poder prender un switch en el admin de NODO".
-- El admin todavía no tiene la pantalla; esto deja la puerta abierta en el servidor, con la misma
-- sesión de administrador que usa el resto del admin (panel_validar_admin_session). Cada cambio
-- queda anotado: quién, cuándo y cómo quedó.
-- Corre después de retiro-instrumentos-portal.sql (usa retiro_instrumentos_oficinas).

alter table public.retiro_instrumentos_oficinas add column if not exists cambiado_por text;

create table if not exists public.retiro_instrumentos_oficinas_historial (
  id bigserial primary key,
  pc_codigo text not null,
  habilitado boolean not null,
  cambiado_por text,
  created_at timestamptz not null default now());
alter table public.retiro_instrumentos_oficinas_historial enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.retiro_instrumentos_oficinas_historial from anon, authenticated, public';
  end if;
end $$;

-- Cómo está cada oficina que puede ver esa sesión (las que tienen ruta pública activa).
create or replace function public.admin_retiro_dni_oficinas(p_session_token text)
returns table(pc_codigo text, habilitado boolean, cambiado_por text, actualizado_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare s record;
begin
  select * into s from public.panel_validar_admin_session(p_session_token);
  if s.ok is not true then raise exception 'Sesión inválida'; end if;
  return query
    select r.pc, coalesce(o.habilitado, false), o.cambiado_por, o.updated_at
      from (select distinct upper(btrim(l.pc_codigo)) as pc
              from public.landing_rutas_publicas l
             where coalesce(l.activo, true) and coalesce(btrim(l.pc_codigo), '') <> '') r
      left join public.retiro_instrumentos_oficinas o on o.pc_codigo = r.pc
     where s.puede_todas is true or r.pc = upper(coalesce(s.pc_codigo, '')) or r.pc = any(coalesce(s.pcs, '{}'::text[]))
     order by r.pc;
end $$;

-- Prender o apagar el pedido de DNI de una oficina.
create or replace function public.admin_retiro_dni_oficina_cambiar(p_session_token text, p_pc_codigo text, p_habilitado boolean)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare s record; v_pc text := upper(btrim(coalesce(p_pc_codigo, ''))); v_quien text;
begin
  select * into s from public.panel_validar_admin_session(p_session_token);
  if s.ok is not true then raise exception 'Sesión inválida'; end if;
  if v_pc = '' or p_habilitado is null then raise exception 'DATOS_INVALIDOS'; end if;
  if s.puede_todas is not true and v_pc <> upper(coalesce(s.pc_codigo, '')) and not (v_pc = any(coalesce(s.pcs, '{}'::text[]))) then
    raise exception 'Sin permiso para %', v_pc;
  end if;
  if not exists (select 1 from public.landing_rutas_publicas l where upper(btrim(l.pc_codigo)) = v_pc) then
    raise exception 'OFICINA_DESCONOCIDA';
  end if;
  v_quien := left(coalesce(nullif(btrim(s.usuario), ''), nullif(btrim(s.nombre), ''), 'admin'), 100);
  insert into public.retiro_instrumentos_oficinas(pc_codigo, habilitado, cambiado_por, updated_at)
  values (v_pc, p_habilitado, v_quien, now())
  on conflict (pc_codigo) do update set habilitado = excluded.habilitado, cambiado_por = excluded.cambiado_por, updated_at = now();
  insert into public.retiro_instrumentos_oficinas_historial(pc_codigo, habilitado, cambiado_por)
  values (v_pc, p_habilitado, v_quien);
  return jsonb_build_object('ok', true, 'pc_codigo', v_pc, 'habilitado', p_habilitado, 'cambiado_por', v_quien);
end $$;
