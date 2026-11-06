-- Cambio de número y cambio de usuario como transición registrada, nunca como borrado (6/11).
--
-- Caso que lo destapó: edga300x (P4) perdió su número y pidió con uno nuevo. La tarjeta de NODO
-- buscaba sólo por teléfono y dijo "no hay cuenta con este usuario"; la versión anterior decía
-- "coinciden" mirando otra solicitud. Ninguna decía la verdad: es el mismo usuario con otro número.
--
-- Cómo estaba:
--   · panel_vincular_usuario, con un número nuevo para un usuario existente, pisaba el teléfono sin
--     dejar rastro: el último CAMBIO_TELEFONO en usuarios_portal_eventos es del 6/8.
--   · Al vincular un teléfono que tenía OTRO usuario, BORRABA esa fila (o la renombraba): el alias
--     viejo y su historia desaparecían.
-- Cómo queda:
--   · Número nuevo para el mismo usuario: se anota CAMBIO_TELEFONO (antes, ahora, quién, motivo).
--   · Teléfono de otro usuario (forzado por el operador): esa fila queda DUPLICADO apuntando al
--     usuario nuevo (duplicado_de + reemplazado_por, fecha, operador y motivo) y se anota
--     USUARIO_REEMPLAZADO. No se borra nada. Se usa DUPLICADO y no un estado nuevo porque siete
--     funciones (perfil del CRM, dormidos, rescate, backfill...) ya excluyen DUPLICADO: con un estado
--     que no conocen, el alias viejo aparecia como jugador activo en todas.
--   · Mismo usuario escrito distinto: DUPLICADO de la fila que queda, en vez de borrado.
--   · panel_identidad_cotejo: una sola consulta por usuario Y teléfono con un veredicto y la
--     historia de los dos, para que NODO diga lo que pasa ("antes usaba este número, hoy este
--     número lo usa tal usuario"). Decide el operador.
--   · El Portal: con el alias reemplazado por este circuito sale REVISION, sin acceso y sin nombrar
--     al usuario de ahora; con otro número sigue CONFLICTO_TELEFONO. La redirección es INFORMATIVA y
--     sólo para el operador: nunca se redirige la identidad del jugador. Los DUPLICADO de antes (sin
--     reemplazado_por) entran como entraban.
--   · "Vigente" en la tarjeta es una sugerencia para el operador: no habilita el Portal ni mueve saldo.
-- panel_vincular_usuario conserva su firma (la usa la 2.1.5) y llama a la v2, que suma el motivo.
-- Foto previa (md5 de pg_get_functiondef): panel_vincular_usuario 8c65ec1fec41b4e4193339cf9afa8f14,
-- landing_portal_resolver_vinculo a497fb194c37516f7aa18cf67e9bff43. Permisos: se conservan.
-- Vuelta atrás: identidad-sucesion-vuelta-atras.sql

alter table public.usuarios_portal_vinculos
  add column if not exists reemplazado_por      text,
  add column if not exists reemplazado_at       timestamptz,
  add column if not exists reemplazado_operador text,
  add column if not exists reemplazado_motivo   text;

-- Mismo criterio de teléfono que el resto de las funciones de vínculo: 10 dígitos sin 54/9/0.
create or replace function public._identidad_tel(p text) returns text
language plpgsql immutable set search_path to 'public' as $$
declare v text := regexp_replace(coalesce(p,''), '\D', '', 'g');
begin
  if length(v) > 10 then
    if left(v,2) = '54' then v := substr(v,3); end if;
    if left(v,1) = '9'  then v := substr(v,2); end if;
    if left(v,1) = '0'  then v := substr(v,2); end if;
  end if;
  if length(v) > 10 then v := right(v,10); end if;
  return v;
end $$;

-- El usuario vigente: sigue los "reemplazado por" (como mucho 3 saltos, sin vueltas).
create or replace function public._identidad_vigente(p_pc text, p_usuario text) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare v text := public._wtk_usuario_limpio(p_usuario); v_sig text; i int := 0;
begin
  loop
    select public._wtk_usuario_limpio(coalesce(nullif(x.reemplazado_por,''), x.duplicado_de)) into v_sig
      from public.usuarios_portal_vinculos x
     where x.pc_codigo = upper(trim(p_pc)) and public._wtk_usuario_limpio(x.usuario) = v
       and x.estado_vinculo = 'DUPLICADO' and coalesce(nullif(x.reemplazado_por,''), x.duplicado_de, '') <> ''
     order by x.reemplazado_at desc nulls last, x.id desc limit 1;
    exit when v_sig is null or v_sig = '' or v_sig = v or i >= 3;
    v := v_sig; v_sig := null; i := i + 1;
  end loop;
  return v;
end $$;

create or replace function public.panel_vincular_usuario_v2(
  p_secret text, p_pc_codigo text, p_usuario text, p_telefono text,
  p_forzar boolean default false, p_operador text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_user text := lower(trim(coalesce(p_usuario,'')));
  v_tel text;
  v_op text := nullif(btrim(coalesce(p_operador,'')), '');
  v_motivo text := nullif(btrim(coalesce(p_motivo,'')), '');
  r_tel public.usuarios_portal_vinculos;
  r_exact public.usuarios_portal_vinculos;
  r record;
  v_target bigint;
  v_cambio jsonb;
  v_reemp text[] := '{}';
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_user = '' then return jsonb_build_object('ok',false,'mensaje','Falta el usuario'); end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'mensaje','Falta la oficina'); end if;
  v_user := public._wtk_usuario_limpio(v_user);
  if v_user = '' then return jsonb_build_object('ok',false,'mensaje','Falta el usuario'); end if;
  v_tel := public._identidad_tel(p_telefono);
  if length(v_tel) < 6 then return jsonb_build_object('ok',false,'mensaje','Teléfono inválido'); end if;

  -- El dueño ACTUAL del teléfono: una fila reemplazada ya no es dueña.
  select * into r_tel from public.usuarios_portal_vinculos
   where pc_codigo = v_pc and telefono_canon = v_tel and coalesce(reemplazado_por,'') = ''
   order by (estado_vinculo = 'VINCULADO') desc, id desc limit 1;
  -- La fila del usuario: primero la que ya se llama exactamente así (índice único pc+usuario).
  select * into r_exact from public.usuarios_portal_vinculos
   where pc_codigo = v_pc and public._wtk_usuario_limpio(usuario) = v_user
   order by (usuario = v_user) desc, (estado_vinculo = 'VINCULADO') desc, id asc limit 1;

  if (r_tel.id is not null and r_tel.estado_vinculo = 'BLOQUEADO') or (r_exact.id is not null and r_exact.estado_vinculo = 'BLOQUEADO') then
    return jsonb_build_object('ok',false,'mensaje','Ese usuario/teléfono está BLOQUEADO. Desbloquealo antes de vincular.');
  end if;
  if r_tel.id is not null and public._wtk_usuario_limpio(r_tel.usuario) <> v_user and not coalesce(p_forzar,false) then
    return jsonb_build_object('ok',false,'conflicto_tel',true,'usuario_actual',r_tel.usuario,
      'mensaje','Ese teléfono ya está vinculado a otro usuario ('||r_tel.usuario||').');
  end if;

  if r_exact.id is not null then
    v_target := r_exact.id;
    if coalesce(r_exact.telefono_canon,'') <> v_tel then
      insert into public.usuarios_portal_eventos(pc_codigo, usuario, evento, telefono_anterior, telefono_nuevo, titular, nota, operador, origen, created_at)
      values (v_pc, v_user, 'CAMBIO_TELEFONO', nullif(r_exact.telefono_canon,''), v_tel, r_exact.titular, v_motivo, v_op, 'OPERADOR_PANEL', now());
      v_cambio := jsonb_build_object('anterior', nullif(r_exact.telefono_canon,''), 'nuevo', v_tel);
    end if;
  end if;

  -- Los que tenían este teléfono quedan como DUPLICADO apuntando a este usuario. Antes se borraban.
  for r in select * from public.usuarios_portal_vinculos
            where pc_codigo = v_pc and telefono_canon = v_tel
              and coalesce(estado_vinculo,'') <> 'BLOQUEADO' and coalesce(reemplazado_por,'') = ''
              and public._wtk_usuario_limpio(usuario) <> v_user
  loop
    update public.usuarios_portal_vinculos
       set estado_vinculo = 'DUPLICADO', duplicado_de = v_user, reemplazado_por = v_user, reemplazado_at = now(),
           reemplazado_operador = v_op, reemplazado_motivo = coalesce(v_motivo, 'NUMERO_VINCULADO_A_OTRO_USUARIO'),
           updated_at = now()
     where id = r.id;
    insert into public.usuarios_portal_eventos(pc_codigo, usuario, evento, telefono_anterior, telefono_nuevo, titular, nota, operador, origen, created_at)
    values (v_pc, r.usuario, 'USUARIO_REEMPLAZADO', v_tel, null, r.titular, 'ahora es '||v_user||coalesce(' · '||v_motivo,''), v_op, 'OPERADOR_PANEL', now());
    v_reemp := array_append(v_reemp, r.usuario);
  end loop;

  if v_target is null then
    insert into public.usuarios_portal_vinculos(pc_codigo, usuario, telefono_canon, telefono_raw, estado_vinculo, fuente, verificado_por)
    values (v_pc, v_user, v_tel, p_telefono, 'VINCULADO', 'OPERADOR_PANEL', v_op)
    returning id into v_target;
  else
    -- El mismo usuario escrito de otra forma: queda como DUPLICADO de la fila que sigue. Antes se borraba.
    update public.usuarios_portal_vinculos
       set estado_vinculo = 'DUPLICADO', duplicado_de = v_user, updated_at = now()
     where pc_codigo = v_pc and id <> v_target and public._wtk_usuario_limpio(usuario) = v_user
       and coalesce(estado_vinculo,'') not in ('BLOQUEADO','DUPLICADO');
    update public.usuarios_portal_vinculos
       set usuario = v_user, telefono_canon = v_tel, telefono_raw = p_telefono, estado_vinculo = 'VINCULADO',
           duplicado_de = null, reemplazado_por = null, reemplazado_at = null, reemplazado_operador = null, reemplazado_motivo = null,
           updated_at = now(), verificado_por = coalesce(v_op, verificado_por)
     where id = v_target;
  end if;
  return jsonb_build_object('ok',true,'id',v_target,'mensaje','Usuario vinculado',
    'cambio_telefono', v_cambio, 'reemplazados', to_jsonb(v_reemp));
end $$;

-- Misma firma de siempre (la llama la 2.1.5): ahora sin borrar nada.
create or replace function public.panel_vincular_usuario(
  p_secret text, p_pc_codigo text, p_usuario text, p_telefono text,
  p_forzar boolean default false, p_operador text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  return public.panel_vincular_usuario_v2(p_secret, p_pc_codigo, p_usuario, p_telefono, p_forzar, p_operador, null);
end $$;

-- Una sola consulta para la tarjeta de NODO: por usuario Y por teléfono, con veredicto e historia.
--   COINCIDE              el usuario tiene ese número
--   CAMBIO_TELEFONO       el usuario existe y pide con un número que no es de nadie
--   TELEFONO_ANTERIOR     pide con un número que antes era suyo
--   TELEFONO_DE_OTRO      el número lo usa hoy otro usuario
--   USUARIO_REEMPLAZADO   el usuario es viejo: hoy es otro (vigente)
--   NUEVO                 ni el usuario ni el número están
--   SOLO_TELEFONO         no vino usuario y el número es de alguien
--   BLOQUEADO
create or replace function public.panel_identidad_cotejo(p_secret text, p_pc_codigo text, p_usuario text, p_telefono text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_user text := public._wtk_usuario_limpio(lower(trim(coalesce(p_usuario,''))));
  v_tel text := public._identidad_tel(p_telefono);
  r_u public.usuarios_portal_vinculos;
  r_t public.usuarios_portal_vinculos;
  v_ver text; v_vig text; v_tel_era_suyo boolean := false;
  ult_u timestamptz; ult_t timestamptz; ops_u int := 0; ops_t int := 0;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'motivo','SIN_OFICINA'); end if;
  if v_user <> '' then
    select * into r_u from public.usuarios_portal_vinculos
     where pc_codigo = v_pc and public._wtk_usuario_limpio(usuario) = v_user
     order by (estado_vinculo = 'VINCULADO') desc, (estado_vinculo = 'DUPLICADO') asc, id asc limit 1;
  end if;
  if length(v_tel) >= 6 then
    select * into r_t from public.usuarios_portal_vinculos
     where pc_codigo = v_pc and telefono_canon = v_tel
       and not (estado_vinculo = 'DUPLICADO' and coalesce(nullif(reemplazado_por,''), duplicado_de, '') <> '')
     order by (estado_vinculo = 'VINCULADO') desc, id desc limit 1;
    if v_user <> '' then
      select exists(select 1 from public.usuarios_portal_eventos e
                     where e.pc_codigo = v_pc and public._wtk_usuario_limpio(e.usuario) = v_user
                       and e.evento = 'CAMBIO_TELEFONO' and public._identidad_tel(e.telefono_anterior) = v_tel)
        into v_tel_era_suyo;
    end if;
  end if;
  -- Reemplazado = DUPLICADO con puntero (los de este circuito y los unificados antes por el panel).
  if r_u.estado_vinculo = 'DUPLICADO' and coalesce(nullif(r_u.reemplazado_por,''), r_u.duplicado_de, '') <> '' then
    v_vig := public._identidad_vigente(v_pc, v_user);
  end if;

  v_ver := case
    when r_u.estado_vinculo = 'BLOQUEADO' or r_t.estado_vinculo = 'BLOQUEADO' then 'BLOQUEADO'
    when v_vig is not null and v_vig <> v_user then 'USUARIO_REEMPLAZADO'
    when r_u.id is not null and length(v_tel) >= 6 and r_u.telefono_canon = v_tel then 'COINCIDE'
    when r_t.id is not null and public._wtk_usuario_limpio(r_t.usuario) <> v_user and v_user <> '' then 'TELEFONO_DE_OTRO'
    when r_t.id is not null and v_user = '' then 'SOLO_TELEFONO'
    when r_u.id is not null and v_tel_era_suyo then 'TELEFONO_ANTERIOR'
    when r_u.id is not null and length(v_tel) >= 6 then 'CAMBIO_TELEFONO'
    when r_u.id is not null then 'SOLO_USUARIO'
    when r_u.id is null and r_t.id is null then 'NUEVO'
    else 'REVISAR' end;

  -- Historia de cada uno: con operaciones o CBU de cobro, la alerta es fuerte y decide una persona.
  if r_u.id is not null then
    select max(h.created_at), count(*) into ult_u, ops_u from public.historial_ops h
     where lower(btrim(h.usuario)) = lower(btrim(r_u.usuario)) and upper(coalesce(h.estado,'')) = 'OK'
       and upper(coalesce(h.tipo,'')) in ('CARGA','RETIRO');
  end if;
  if r_t.id is not null then
    select max(h.created_at), count(*) into ult_t, ops_t from public.historial_ops h
     where lower(btrim(h.usuario)) = lower(btrim(r_t.usuario)) and upper(coalesce(h.estado,'')) = 'OK'
       and upper(coalesce(h.tipo,'')) in ('CARGA','RETIRO');
  end if;

  return jsonb_build_object('ok', true, 'veredicto', v_ver, 'pc_codigo', v_pc,
    'usuario', case when r_u.id is null then null else jsonb_build_object(
      'usuario', r_u.usuario, 'estado', r_u.estado_vinculo, 'telefono', r_u.telefono_canon, 'titular', r_u.titular,
      'desde', r_u.created_at, 'verificado_por', r_u.verificado_por, 'duplicado_de', r_u.duplicado_de,
      'reemplazado_por', r_u.reemplazado_por, 'reemplazado_at', r_u.reemplazado_at,
      'reemplazado_operador', r_u.reemplazado_operador, 'reemplazado_motivo', r_u.reemplazado_motivo,
      'vigente', v_vig, 'ultima_operacion', ult_u, 'operaciones', ops_u,
      'tiene_cbu', coalesce(r_u.cbu_retiro,'') <> '') end,
    'telefono', case when length(v_tel) < 6 then null else jsonb_build_object(
      'telefono', v_tel,
      'dueno', case when r_t.id is null then null else jsonb_build_object(
        'usuario', r_t.usuario, 'estado', r_t.estado_vinculo, 'titular', r_t.titular, 'desde', r_t.created_at,
        'ultima_operacion', ult_t, 'operaciones', ops_t, 'tiene_cbu', coalesce(r_t.cbu_retiro,'') <> '') end) end,
    -- Los números que tuvo este usuario (lo último primero).
    'telefonos_anteriores', coalesce((select jsonb_agg(x order by x.cuando desc) from (
        select e.telefono_anterior as anterior, e.telefono_nuevo as nuevo, e.created_at as cuando, e.operador, e.nota
          from public.usuarios_portal_eventos e
         where v_user <> '' and e.pc_codigo = v_pc and public._wtk_usuario_limpio(e.usuario) = v_user and e.evento = 'CAMBIO_TELEFONO'
         order by e.created_at desc limit 5) x), '[]'::jsonb),
    -- Quién usaba antes este número.
    'usuarios_anteriores', coalesce((select jsonb_agg(x order by x.cuando desc) from (
        select v.usuario, 'REEMPLAZADO'::text as como, coalesce(nullif(v.reemplazado_por,''), v.duplicado_de) as ahora,
               coalesce(v.reemplazado_at, v.updated_at) as cuando, v.reemplazado_operador as operador
          from public.usuarios_portal_vinculos v
         where length(v_tel) >= 6 and v.pc_codigo = v_pc and v.telefono_canon = v_tel and v.estado_vinculo = 'DUPLICADO'
           and coalesce(nullif(v.reemplazado_por,''), v.duplicado_de, '') <> ''
        union all
        select e.usuario, 'CAMBIO_DE_NUMERO', e.telefono_nuevo, e.created_at, e.operador
          from public.usuarios_portal_eventos e
         where length(v_tel) >= 6 and e.pc_codigo = v_pc and e.evento = 'CAMBIO_TELEFONO'
           and public._identidad_tel(e.telefono_anterior) = v_tel
         order by 4 desc limit 5) x), '[]'::jsonb));
end $$;

-- Portal: igual que antes, más el caso del alias reemplazado.
create or replace function public.landing_portal_resolver_vinculo(p_pc_codigo text, p_usuario text, p_telefono text)
returns jsonb language plpgsql security definer as $$
declare
  v_pc   text := upper(trim(coalesce(p_pc_codigo,'')));
  v_user text := lower(trim(coalesce(p_usuario,'')));
  v_tel  text;
  r_user public.usuarios_portal_vinculos;
  v_tiene_base boolean := false;
  v_vig text;
begin
  if v_user = '' then return jsonb_build_object('ok',false,'verdict','SIN_USUARIO','mensaje','Falta el usuario'); end if;
  if v_pc = '' then v_pc := 'P1'; end if;
  v_user := public._wtk_usuario_limpio(v_user);
  if v_user = '' then return jsonb_build_object('ok',false,'verdict','SIN_USUARIO','mensaje','Falta el usuario'); end if;
  v_tel := public._identidad_tel(p_telefono);
  if length(v_tel) < 6 then return jsonb_build_object('ok',false,'verdict','TEL_INVALIDO','mensaje','Teléfono inválido'); end if;

  select exists(select 1 from public.usuarios_portal_vinculos where pc_codigo=v_pc and fuente='CSV_WHATICKET') into v_tiene_base;

  select * into r_user from public.usuarios_portal_vinculos
   where pc_codigo=v_pc and telefono_canon=v_tel and public._wtk_usuario_limpio(usuario)=v_user
   order by (estado_vinculo='BLOQUEADO') desc, (coalesce(reemplazado_por,'') <> '') asc
   limit 1;
  if r_user.id is not null then
    if r_user.estado_vinculo='BLOQUEADO' then
      return jsonb_build_object('ok',false,'verdict','BLOQUEADO','mensaje','Usuario bloqueado. Contactá a soporte.');
    end if;
    -- Alias reemplazado: queda pendiente, sin acceso y sin decir nada del usuario de ahora.
    -- "Redirigir la información al operador, nunca redirigir la identidad del usuario" (Juan, 6/11):
    -- con el alias viejo no se opera, y el Portal no revela ni sugiere el alias nuevo.
    if r_user.estado_vinculo='DUPLICADO' and coalesce(r_user.reemplazado_por,'') <> '' then
      return jsonb_build_object('ok',false,'verdict','REVISION','pc_codigo',v_pc,
        'mensaje','Necesitamos revisar tu cuenta antes de que puedas operar. Escribinos por soporte.');
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

-- La decisión del operador sobre una identidad dudosa, con su motivo, en la historia del jugador.
--   OTRA_PERSONA     el número de la consulta es de otra persona: no hereda el usuario viejo
--   SIN_EVIDENCIA    queda pendiente, sin acceso; no se toca ningún vínculo
-- (La de "es la misma persona" la registra panel_vincular_usuario_v2 al vincular.)
-- No usa panel_usuario_evento: su control de acceso rechaza en silencio el secreto del panel y por
-- eso no hay un solo evento VALIDACION guardado aunque NODO lo manda en cada validación.
create or replace function public.panel_identidad_decision(
  p_secret text, p_pc_codigo text, p_usuario text, p_telefono text, p_decision text, p_motivo text, p_operador text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_dec text := upper(trim(coalesce(p_decision,'')));
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_dec not in ('OTRA_PERSONA','SIN_EVIDENCIA') then return jsonb_build_object('ok',false,'mensaje','Decisión inválida'); end if;
  if coalesce(trim(p_usuario),'') = '' then return jsonb_build_object('ok',false,'mensaje','Falta el usuario'); end if;
  insert into public.usuarios_portal_eventos(pc_codigo, usuario, evento, telefono_nuevo, nota, operador, origen, created_at)
  values (upper(trim(coalesce(p_pc_codigo,''))), public._wtk_usuario_limpio(lower(trim(p_usuario))),
          'IDENTIDAD_'||v_dec, nullif(public._identidad_tel(p_telefono),''),
          nullif(trim(coalesce(p_motivo,'')),''), nullif(trim(coalesce(p_operador,'')),''), 'OPERADOR_PANEL', now());
  return jsonb_build_object('ok', true);
end $$;
