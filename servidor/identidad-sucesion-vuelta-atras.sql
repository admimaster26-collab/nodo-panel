-- Vuelve panel_vincular_usuario y landing_portal_resolver_vinculo a como estaban antes del 6/11 y saca
-- las funciones nuevas. Las columnas reemplazado_* y los eventos quedan: no molestan y guardan la historia.
-- OJO: la versión vieja de panel_vincular_usuario BORRA filas al forzar un teléfono de otro usuario.

drop function if exists public.panel_identidad_cotejo(text, text, text, text);
drop function if exists public.panel_identidad_decision(text, text, text, text, text, text, text);

create or replace function public.panel_vincular_usuario(
  p_secret text, p_pc_codigo text, p_usuario text, p_telefono text,
  p_forzar boolean default false, p_operador text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pc text := upper(trim(coalesce(p_pc_codigo,''))); v_user text := lower(trim(coalesce(p_usuario,''))); v_tel text := regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'); r_tel public.usuarios_portal_vinculos; r_exact public.usuarios_portal_vinculos; v_target bigint; v_new bigint; begin if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if; if v_user='' then return jsonb_build_object('ok',false,'mensaje','Falta el usuario'); end if; if v_pc='' then return jsonb_build_object('ok',false,'mensaje','Falta la oficina'); end if; v_user := public._wtk_usuario_limpio(v_user); if v_user='' then return jsonb_build_object('ok',false,'mensaje','Falta el usuario'); end if; if length(v_tel) > 10 then if left(v_tel,2)='54' then v_tel := substr(v_tel,3); end if; if left(v_tel,1)='9' then v_tel := substr(v_tel,2); end if; if left(v_tel,1)='0' then v_tel := substr(v_tel,2); end if; end if; if length(v_tel) > 10 then v_tel := right(v_tel,10); end if; if length(v_tel) < 6 then return jsonb_build_object('ok',false,'mensaje','Teléfono inválido'); end if; select * into r_tel from public.usuarios_portal_vinculos where pc_codigo=v_pc and telefono_canon=v_tel limit 1; select * into r_exact from public.usuarios_portal_vinculos where pc_codigo=v_pc and public._wtk_usuario_limpio(usuario)=v_user order by (estado_vinculo='VINCULADO') desc, id asc limit 1; if (r_tel.id is not null and r_tel.estado_vinculo='BLOQUEADO') or (r_exact.id is not null and r_exact.estado_vinculo='BLOQUEADO') then return jsonb_build_object('ok',false,'mensaje','Ese usuario/teléfono está BLOQUEADO. Desbloquealo antes de vincular.'); end if; if r_tel.id is not null and public._wtk_usuario_limpio(r_tel.usuario) <> v_user and not p_forzar then return jsonb_build_object('ok',false,'conflicto_tel',true,'usuario_actual',r_tel.usuario, 'mensaje','Ese teléfono ya está vinculado a otro usuario ('||r_tel.usuario||').'); end if; if r_exact.id is not null then v_target := r_exact.id; elsif r_tel.id is not null then v_target := r_tel.id; else insert into public.usuarios_portal_vinculos(pc_codigo,usuario,telefono_canon,telefono_raw,estado_vinculo,fuente,verificado_por) values(v_pc,v_user,v_tel,p_telefono,'VINCULADO','OPERADOR_PANEL',nullif(btrim(coalesce(p_operador,'')),'')) returning id into v_new; return jsonb_build_object('ok',true,'id',v_new,'mensaje','Usuario vinculado'); end if; delete from public.usuarios_portal_vinculos where pc_codigo=v_pc and id <> v_target and estado_vinculo <> 'BLOQUEADO' and (telefono_canon=v_tel or public._wtk_usuario_limpio(usuario)=v_user); update public.usuarios_portal_vinculos set usuario=v_user, telefono_canon=v_tel, telefono_raw=p_telefono, estado_vinculo='VINCULADO', updated_at=now(), verificado_por=coalesce(nullif(btrim(coalesce(p_operador,'')),''), verificado_por) where id=v_target; return jsonb_build_object('ok',true,'id',v_target,'mensaje','Usuario vinculado'); end $$;

drop function if exists public.panel_vincular_usuario_v2(text, text, text, text, boolean, text, text);

create or replace function public.landing_portal_resolver_vinculo(p_pc_codigo text, p_usuario text, p_telefono text)
returns jsonb language plpgsql security definer as $$
declare
  v_pc   text := upper(trim(coalesce(p_pc_codigo,'')));
  v_user text := lower(trim(coalesce(p_usuario,'')));
  v_tel  text := regexp_replace(coalesce(p_telefono,''), '\D', '', 'g');
  r_user public.usuarios_portal_vinculos;
  v_tiene_base boolean := false;
begin
  if v_user = '' then return jsonb_build_object('ok',false,'verdict','SIN_USUARIO','mensaje','Falta el usuario'); end if;
  if v_pc = '' then v_pc := 'P1'; end if;
  v_user := public._wtk_usuario_limpio(v_user);
  if v_user = '' then return jsonb_build_object('ok',false,'verdict','SIN_USUARIO','mensaje','Falta el usuario'); end if;
  if length(v_tel) > 10 then
    if left(v_tel,2)='54' then v_tel := substr(v_tel,3); end if;
    if left(v_tel,1)='9'  then v_tel := substr(v_tel,2); end if;
    if left(v_tel,1)='0'  then v_tel := substr(v_tel,2); end if;
  end if;
  if length(v_tel) > 10 then v_tel := right(v_tel,10); end if;
  if length(v_tel) < 6 then return jsonb_build_object('ok',false,'verdict','TEL_INVALIDO','mensaje','Teléfono inválido'); end if;
  select exists(select 1 from public.usuarios_portal_vinculos where pc_codigo=v_pc and fuente='CSV_WHATICKET') into v_tiene_base;
  select * into r_user from public.usuarios_portal_vinculos
  where pc_codigo=v_pc and telefono_canon=v_tel and public._wtk_usuario_limpio(usuario)=v_user
  order by (estado_vinculo='BLOQUEADO') desc limit 1;
  if r_user.id is not null then
    if r_user.estado_vinculo='BLOQUEADO' then
      return jsonb_build_object('ok',false,'verdict','BLOQUEADO','mensaje','Usuario bloqueado. Contactá a soporte.');
    end if;
    update public.usuarios_portal_vinculos set updated_at=now() where id=r_user.id;
    return jsonb_build_object('ok',true,'verdict','ACCESO','estado',r_user.estado_vinculo,'pc_codigo',v_pc,'mensaje','Acceso verificado.');
  end if;
  if exists(select 1 from public.usuarios_portal_vinculos where pc_codigo=v_pc and public._wtk_usuario_limpio(usuario)=v_user) then
    if exists(select 1 from public.usuarios_portal_vinculos
              where pc_codigo=v_pc and public._wtk_usuario_limpio(usuario)=v_user and estado_vinculo='BLOQUEADO') then
      return jsonb_build_object('ok',false,'verdict','BLOQUEADO','mensaje','Usuario bloqueado. Contactá a soporte.');
    end if;
    return jsonb_build_object('ok',false,'verdict','CONFLICTO_TELEFONO',
      'mensaje','Este usuario ya está vinculado a otro teléfono. Verificá los datos o contactá a soporte.');
  end if;
  if exists(select 1 from public.usuarios_portal_vinculos where pc_codigo=v_pc and telefono_canon=v_tel) then
    return jsonb_build_object('ok',false,'verdict','CONFLICTO_USUARIO',
      'mensaje','Este teléfono ya está vinculado a otro usuario. Verificá los datos o contactá a soporte.');
  end if;
  if v_tiene_base then
    return jsonb_build_object('ok',false,'verdict','NO_REGISTRADO',
      'mensaje','Tu usuario no figura en la base de tu oficina. Escribinos por soporte para registrarte.');
  end if;
  insert into public.usuarios_portal_vinculos(pc_codigo, usuario, telefono_canon, telefono_raw, estado_vinculo, fuente)
  values(v_pc, v_user, v_tel, p_telefono, 'PENDIENTE', 'PORTAL_PRIMER_INGRESO');
  return jsonb_build_object('ok',true,'verdict','NUEVO','estado','PENDIENTE','pc_codigo',v_pc,
    'mensaje','Usuario registrado. Tu primera operación la valida un operador.');
end $$;

drop function if exists public._identidad_vigente(text, text);
drop function if exists public._identidad_tel(text);
