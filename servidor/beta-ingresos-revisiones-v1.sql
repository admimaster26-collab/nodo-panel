-- Ingresos al Portal, revisiones y revisión de teléfono, por oficina (beta, 10/11)
--
-- Juan, 9/11: "ni nosotros ni los operadores tienen una vista real de qué usuarios quedan pendientes de
-- validación… no sabemos si ingresó mal el número, volvió para atrás y lo ingresó bien". Y: "la información
-- cruzada no nos sirve de nada… separar todo por pc… el índice debe ser por el puesto que escriba la
-- información".
--
-- Qué agrega. Nada de lo que usan hoy las oficinas cambia:
--  1. identidad.ingresos_portal: cada intento de entrar al Portal, con lo que contestó el servidor. Hasta hoy
--     el servidor contestaba "ese usuario tiene otro teléfono" o "no figura en la base de la oficina" y no
--     anotaba nada. Lo escribe landing_portal_ingreso_v1, que el Portal nuevo llama en lugar del resolvedor
--     (devuelve exactamente lo mismo).
--  2. nodo_beta_ingresos_v1: por oficina, quién pidió entrar, quién corrigió el dato, quién ya tenía otro
--     usuario, quién quedó esperando y quién abandonó. Hacia atrás usa los tickets de soporte que abre el
--     Portal cuando alguien no puede entrar; desde ahora, además, lo anotado en (1).
--  3. nodo_beta_revisiones_v1 / admin_revisiones_v1: los cotejos que hoy se hacen a mano con consultas.
--  4. nodo_beta_prevalidar_v1: revisar un teléfono antes de crear un usuario, SÓLO dentro de la oficina y
--     por índice. El de hoy (panel_prevalidar_usuario) recorre los 259.000 vínculos de todas las oficinas y se
--     cortó 86 veces el 9/11.
--
-- Todo se filtra por las claves de la oficina (acceso.oficinas_autorizadas) y los índices empiezan por la
-- oficina: sumar una oficina nueva no cambia nada.
--
-- Ejecutar después de servidor/dominios/perfil-v1.sql (crea acceso.autorizar y acceso.oficinas_autorizadas).
-- En producción, los índices sobre tablas en uso se crean antes y aparte, con CREATE INDEX CONCURRENTLY
-- (mismas definiciones); acá quedan con "if not exists" y no hacen nada.
-- Vuelta atrás: servidor/beta-ingresos-revisiones-v1-vuelta-atras.sql

create schema if not exists identidad;
create schema if not exists operaciones;
revoke all on schema identidad, operaciones from public, anon, authenticated;

-- ── Índices por oficina ───────────────────────────────────────────────────────────────────────────────
create index if not exists vinculos_pc_tel8 on public.usuarios_portal_vinculos (pc_codigo, right(telefono_canon, 8));
create index if not exists vinculos_pc_usuario_norm on public.usuarios_portal_vinculos (pc_codigo, public.nodo_norm_usuario_v21(usuario));
create index if not exists vinculos_pc_no_vinculados on public.usuarios_portal_vinculos (pc_codigo, estado_vinculo, created_at)
  where estado_vinculo <> 'VINCULADO';

-- ── 1. Cada intento de entrar al Portal ───────────────────────────────────────────────────────────────
create table if not exists identidad.ingresos_portal (
  id         bigserial primary key,
  pc_codigo  text not null,
  usuario    text not null default '',
  telefono   text not null default '',
  veredicto  text not null,
  origen     text not null default 'FORMULARIO',   -- FORMULARIO | REINTENTO | CORREGIDO (lo corrigió un operador)
  created_at timestamptz not null default now()
);
create index if not exists ingresos_portal_pc_fecha    on identidad.ingresos_portal (pc_codigo, created_at desc);
create index if not exists ingresos_portal_pc_usuario  on identidad.ingresos_portal (pc_codigo, usuario, created_at desc);
create index if not exists ingresos_portal_pc_telefono on identidad.ingresos_portal (pc_codigo, telefono, created_at desc);

create or replace function public.landing_portal_ingreso_v1(
  p_pc_codigo text, p_usuario text, p_telefono text, p_origen text default 'FORMULARIO'
) returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare
  v jsonb;
  v_pc text; v_usr text; v_tel text; v_ver text;
  v_origen text := case when upper(coalesce(p_origen,'')) in ('FORMULARIO','REINTENTO','CORREGIDO')
                        then upper(p_origen) else 'FORMULARIO' end;
begin
  v := public.landing_portal_resolver_vinculo(p_pc_codigo, p_usuario, p_telefono);
  begin
    v_pc  := upper(coalesce(nullif(v->>'pc_codigo',''), nullif(btrim(coalesce(p_pc_codigo,'')),''), 'P1'));
    v_usr := left(coalesce(public.nodo_norm_usuario_v21(coalesce(p_usuario,'')), ''), 64);
    v_tel := left(coalesce(public._identidad_tel(p_telefono), ''), 20);
    v_ver := left(coalesce(nullif(v->>'verdict',''), 'SIN_VEREDICTO'), 32);
    -- Un mismo intento repetido en 30 segundos (doble toque) se anota una vez.
    if not exists (select 1 from identidad.ingresos_portal i
                    where i.pc_codigo = v_pc and i.usuario = v_usr and i.telefono = v_tel and i.veredicto = v_ver
                      and i.created_at > now() - interval '30 seconds') then
      insert into identidad.ingresos_portal (pc_codigo, usuario, telefono, veredicto, origen)
      values (v_pc, v_usr, v_tel, v_ver, v_origen);
    end if;
  exception when others then
    null;   -- anotar el intento nunca puede impedir que el jugador entre
  end;
  return v;
end $$;
revoke all on function public.landing_portal_ingreso_v1(text,text,text,text) from public;
grant execute on function public.landing_portal_ingreso_v1(text,text,text,text) to anon, authenticated;

-- ── 2. Ingresos por oficina ───────────────────────────────────────────────────────────────────────────
-- Un "caso" es una persona (usuario dentro de la oficina) que pidió entrar y no pudo, en el período.
-- Resultado, en este orden:
--   CORRIGIO         después entró bien, con el mismo usuario o el mismo teléfono
--   OPERA            ya hizo una carga o un retiro
--   VALIDADO         un operador lo dejó vinculado
--   ES_OTRO_USUARIO  su teléfono ya tiene otro usuario en la oficina (pidió un usuario de más)
--   OTRO_TELEFONO    el usuario existe con otro teléfono
--   BLOQUEADO
--   EN_CURSO         lo intentó hace menos de 2 horas
--   ESPERANDO        menos de 48 horas, sin respuesta
--   ABANDONO         más de 48 horas sin volver
create or replace function identidad.ingresos_v1(p_pcs text[], p_dias integer)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_desde timestamptz := now() - make_interval(days => p_dias); v_res jsonb;
begin
  with
  -- Los vínculos de la oficina se leen UNA vez (por el índice de oficina) y todo lo demás se cruza contra
  -- eso en memoria. Preguntar por cada caso tardaba 5,6 s en P4 (14.111 vínculos, 11/11): se cortaba a los 3.
  vin as materialized (
    select v.id, v.pc_codigo, v.usuario, public.nodo_norm_usuario_v21(v.usuario) as u,
           case when length(coalesce(v.telefono_canon,'')) >= 8 then right(v.telefono_canon, 8) end as tel8,
           v.estado_vinculo, v.created_at, v.updated_at, v.fuente
      from public.usuarios_portal_vinculos v
     where v.pc_codigo = any(p_pcs)
  ),
  intentos as (
    select i.pc_codigo, i.usuario, i.telefono, i.veredicto, i.created_at
      from identidad.ingresos_portal i
     where i.pc_codigo = any(p_pcs) and i.created_at >= v_desde
  ),
  -- Tickets de soporte de alguien que no estaba vinculado cuando escribió: es un pedido de entrada.
  tickets as (
    select upper(s.pc_codigo) as pc_codigo, public.nodo_norm_usuario_v21(s.usuario) as usuario,
           coalesce(public._identidad_tel(s.telefono), '') as telefono, s.created_at
      from public.landing_solicitudes s
     where s.pc_codigo = any(p_pcs) and coalesce(s.origen,'') = 'PORTAL_V16' and s.tipo = 'SOPORTE'
       and s.created_at >= v_desde and coalesce(btrim(s.usuario),'') <> ''
  ),
  pedidos as (
    select t.pc_codigo, t.usuario, t.telefono, t.created_at, 'SOPORTE'::text as fuente, null::text as veredicto
      from tickets t
     where not exists (select 1 from vin v
                        where v.pc_codigo = t.pc_codigo and v.u = t.usuario
                          and v.estado_vinculo = 'VINCULADO' and v.created_at <= t.created_at)
    union all
    select x.pc_codigo, x.usuario, x.telefono, x.created_at, 'PORTAL', x.veredicto
      from intentos x where x.veredicto not in ('ACCESO','NUEVO') and x.usuario <> ''
  ),
  casos as (
    select p.pc_codigo, p.usuario,
           array_agg(distinct p.telefono) filter (where p.telefono <> '') as telefonos,
           array_agg(distinct right(p.telefono, 8)) filter (where length(p.telefono) >= 8) as tel8s,
           array_agg(distinct p.veredicto) filter (where p.veredicto is not null) as veredictos,
           min(p.created_at) as desde, max(p.created_at) as ultima, count(*) as veces,
           array_agg(distinct p.fuente) as fuentes
      from pedidos p group by p.pc_codigo, p.usuario
  ),
  -- El vínculo de cada usuario (el validado primero, si no el último tocado) y, por teléfono, si ese número
  -- ya es de otro usuario validado de la oficina.
  vin_usuario as (
    select distinct on (v.pc_codigo, v.u) v.pc_codigo, v.u, v.estado_vinculo, v.tel8
      from vin v
     order by v.pc_codigo, v.u, (coalesce(v.estado_vinculo,'') = 'VINCULADO') desc, v.updated_at desc nulls last
  ),
  otros as (
    select distinct on (c.pc_codigo, c.usuario) c.pc_codigo, c.usuario, v.u as otro_usuario
      from casos c cross join lateral unnest(coalesce(c.tel8s, '{}')) as t(tel8)
      join vin v on v.pc_codigo = c.pc_codigo and v.tel8 = t.tel8 and v.estado_vinculo = 'VINCULADO' and v.u <> c.usuario
     order by c.pc_codigo, c.usuario, v.created_at
  ),
  evaluados as (
    select c.*,
      (select x.usuario || '|' || x.telefono from intentos x
        where x.veredicto in ('ACCESO','NUEVO') and x.created_at > c.desde
          and (x.usuario = c.usuario or right(x.telefono, 8) = any(coalesce(c.tel8s, '{}')))
        order by x.created_at limit 1) as entro_con,
      exists (select 1 from public.historial_ops h
               where upper(coalesce(h.pc_codigo,'')) = any(p_pcs) and public.nodo_norm_usuario_v21(h.usuario) = c.usuario
                 and coalesce(h.origen,'') <> 'PROMO_BONO'
                 and h.created_at >= c.desde) as opera,
      vu.estado_vinculo as vinculo_estado, vu.tel8 as vinculo_tel8, o.otro_usuario
      from casos c
      left join vin_usuario vu on vu.pc_codigo = c.pc_codigo and vu.u = c.usuario
      left join otros o on o.pc_codigo = c.pc_codigo and o.usuario = c.usuario
  ),
  clasificados as (
    select e.*,
      case
        when e.entro_con is not null then 'CORRIGIO'
        when e.opera then 'OPERA'
        when e.vinculo_estado = 'VINCULADO' and e.vinculo_tel8 = any(coalesce(e.tel8s, '{}')) then 'VALIDADO'
        when e.otro_usuario is not null then 'ES_OTRO_USUARIO'
        when e.vinculo_estado = 'VINCULADO' then 'OTRO_TELEFONO'
        when e.vinculo_estado = 'BLOQUEADO' then 'BLOQUEADO'
        when e.ultima > now() - interval '2 hours' then 'EN_CURSO'
        when e.ultima > now() - interval '48 hours' then 'ESPERANDO'
        else 'ABANDONO'
      end as resultado
      from evaluados e
  ),
  -- Un pendiente cuyo teléfono ya es de otro usuario validado. Sin teléfono no se compara: dos vacíos no son
  -- el mismo número.
  pend_otro as (
    select distinct on (p.id) p.id, b.u as otro_usuario
      from vin p join vin b on b.pc_codigo = p.pc_codigo and b.tel8 = p.tel8 and b.id <> p.id and b.estado_vinculo = 'VINCULADO'
     where p.estado_vinculo = 'PENDIENTE'
     order by p.id, b.created_at
  ),
  pendientes as (
    select v.usuario, v.created_at, v.fuente,
           exists (select 1 from public.historial_ops h
                    where upper(coalesce(h.pc_codigo,'')) = any(p_pcs)
                      and coalesce(h.origen,'') <> 'PROMO_BONO'
                      and public.nodo_norm_usuario_v21(h.usuario) = v.u) as opera,
           po.otro_usuario
      from vin v left join pend_otro po on po.id = v.id
     where v.estado_vinculo = 'PENDIENTE'
  )
  select jsonb_build_object(
    'dias', p_dias, 'desde', v_desde,
    'resumen', jsonb_build_object(
      'pedidos',          (select count(*) from clasificados),
      'corrigieron',      (select count(*) from clasificados where resultado = 'CORRIGIO'),
      'operan',           (select count(*) from clasificados where resultado = 'OPERA'),
      'validados',        (select count(*) from clasificados where resultado = 'VALIDADO'),
      'es_otro_usuario',  (select count(*) from clasificados where resultado = 'ES_OTRO_USUARIO'),
      'otro_telefono',    (select count(*) from clasificados where resultado = 'OTRO_TELEFONO'),
      'bloqueados',       (select count(*) from clasificados where resultado = 'BLOQUEADO'),
      'en_curso',         (select count(*) from clasificados where resultado = 'EN_CURSO'),
      'esperando',        (select count(*) from clasificados where resultado = 'ESPERANDO'),
      'abandonos',        (select count(*) from clasificados where resultado = 'ABANDONO'),
      'intentos_anotados',(select count(*) from intentos),
      'vinculos_pendientes',      (select count(*) from pendientes),
      'vinculos_pendientes_opera',(select count(*) from pendientes where opera)),
    'por_respuesta', coalesce((select jsonb_object_agg(veredicto, n) from
        (select veredicto, count(*) n from intentos group by veredicto) x), '{}'::jsonb),
    'casos', coalesce((select jsonb_agg(jsonb_build_object(
        'usuario', c.usuario,
        'telefonos', coalesce((select jsonb_agg('…' || right(t, 4)) from unnest(c.telefonos) t), '[]'::jsonb),
        'resultado', c.resultado,
        'entro_con', nullif(split_part(coalesce(c.entro_con,''), '|', 1), ''),
        'otro_usuario', c.otro_usuario,
        'opera', c.opera,
        'respuestas', coalesce(to_jsonb(c.veredictos), '[]'::jsonb),
        'veces', c.veces, 'desde', c.desde, 'ultima', c.ultima,
        'por_soporte', 'SOPORTE' = any(c.fuentes))
        order by case c.resultado when 'EN_CURSO' then 1 when 'ESPERANDO' then 2 when 'ES_OTRO_USUARIO' then 3
                                  when 'OTRO_TELEFONO' then 4 when 'ABANDONO' then 5 else 6 end, c.ultima desc)
        from (select * from clasificados order by ultima desc limit 300) c), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object(
        'usuario', p.usuario, 'desde', p.created_at, 'fuente', p.fuente,
        'dias', floor(extract(epoch from now() - p.created_at) / 86400)::int,
        'opera', p.opera, 'otro_usuario', p.otro_usuario)
        order by p.opera desc, p.created_at)
        from (select * from pendientes order by created_at limit 300) p), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- ── 3. Revisiones por oficina ─────────────────────────────────────────────────────────────────────────
-- Cada revisión: clave, título y explicación en castellano, cantidad, nivel y hasta 8 ejemplos.
create or replace function operaciones.revisiones_v1(p_pcs text[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_ing jsonb; v_n integer; v_ej jsonb; v_dni integer;
begin
  v_ing := identidad.ingresos_v1(p_pcs, 7);

  -- Usuarios: pendientes de validación (vínculos a medio hacer + pedidos sin respuesta de la semana)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_ej from (
    select jsonb_build_object('usuario', p->>'usuario', 'dato', (p->>'dias') || ' días'
             || case when (p->>'opera')::boolean then ' · ya opera' else '' end
             || case when p->>'otro_usuario' is not null then ' · su teléfono ya es de ' || (p->>'otro_usuario') else '' end) x
      from jsonb_array_elements(v_ing->'pendientes') p limit 8) t;
  v_n := (v_ing->'resumen'->>'vinculos_pendientes')::int + (v_ing->'resumen'->>'esperando')::int + (v_ing->'resumen'->>'en_curso')::int;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','VALIDACION_PENDIENTE','grupo','Usuarios',
    'titulo','Pendientes de validación', 'explicacion','Pidieron entrar al Portal y todavía no están validados.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'MEDIO' else 'OK' end, 'ejemplos', v_ej));

  -- Usuarios: pidieron un usuario nuevo con un teléfono que ya tiene otro (usuarios de más)
  select coalesce(jsonb_agg(jsonb_build_object('usuario', c->>'usuario', 'dato', 'su teléfono ya es de ' || (c->>'otro_usuario'))), '[]'::jsonb),
         count(*) into v_ej, v_n
    from (select c from jsonb_array_elements(v_ing->'casos') c where c->>'resultado' = 'ES_OTRO_USUARIO' limit 8) t;
  v_n := (v_ing->'resumen'->>'es_otro_usuario')::int;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','USUARIO_DE_MAS','grupo','Usuarios',
    'titulo','Pidieron un usuario nuevo teniendo otro', 'explicacion','El teléfono ya tiene un usuario en esta oficina. Antes de crear otro, ver si es el mismo jugador.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'ALTO' else 'OK' end, 'ejemplos', v_ej));

  -- Usuarios: intentaron entrar y no volvieron
  select coalesce(jsonb_agg(jsonb_build_object('usuario', c->>'usuario', 'dato', 'último intento ' || to_char((c->>'ultima')::timestamptz at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'))), '[]'::jsonb)
    into v_ej from (select c from jsonb_array_elements(v_ing->'casos') c where c->>'resultado' = 'ABANDONO' limit 8) t;
  v_n := (v_ing->'resumen'->>'abandonos')::int;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','INGRESO_ABANDONADO','grupo','Usuarios',
    'titulo','Intentaron entrar y no volvieron', 'explicacion','En los últimos 7 días no pudieron entrar y no se resolvió.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'INFO' else 'OK' end, 'ejemplos', v_ej));

  -- Usuarios: entraron, pidieron cargar y nunca completaron la primera carga. Es el segmento INTENTO de la
  -- pestaña "Quedaron a mitad" del CRM (public.rescate_candidatos, la refresca el cron cada 30 min): acá sólo
  -- se cuenta y se muestran ejemplos, la lista para llamarlos sigue siendo esa pestaña.
  if to_regclass('public.rescate_candidatos') is not null then
    execute $q$
      select count(*), coalesce(jsonb_agg(jsonb_build_object('usuario', usuario,
               'dato', intento_veces || ' intento(s)' || case when fue_rechazada then ' · le rechazaron una' else '' end)
               order by intento_ultimo desc) filter (where rn <= 8), '[]'::jsonb)
        from (select c.usuario, c.intento_veces, c.intento_ultimo, coalesce(c.fue_rechazada, false) as fue_rechazada,
                     row_number() over (order by c.intento_ultimo desc nulls last) as rn
                from public.rescate_candidatos c
               where c.pc_codigo = any($1) and not c.alguna_vez_cargo and c.intento_veces is not null) t
    $q$ into v_n, v_ej using p_pcs;
    v_items := v_items || jsonb_build_array(jsonb_build_object('clave','PRIMERA_CARGA_A_MEDIAS','grupo','Usuarios',
      'titulo','Quedaron a mitad de la primera carga', 'explicacion','Entraron, pidieron cargar y nunca completaron la primera. Para llamarlos: CRM, pestaña "Quedaron a mitad".',
      'cantidad', v_n, 'nivel', case when v_n > 0 then 'INFO' else 'OK' end, 'ejemplos', v_ej));
  end if;

  -- Solicitudes: sin atender (plata parada)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('usuario', usuario, 'dato', tipo || ' · hace ' || horas || ' h')
           order by horas desc) filter (where rn <= 8), '[]'::jsonb)
    into v_n, v_ej
    from (select s.usuario, s.tipo, floor(extract(epoch from now() - s.created_at) / 3600)::int as horas,
                 row_number() over (order by s.created_at) as rn
            from public.landing_solicitudes s
           where s.pc_codigo = any(p_pcs) and s.estado = 'PENDIENTE' and s.tipo in ('CARGA','RETIRO','CAMBIO_CLAVE')
             and s.created_at < now() - interval '30 minutes' and s.created_at > now() - interval '30 days') t;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','SOLICITUD_SIN_ATENDER','grupo','Solicitudes',
    'titulo','Cargas y retiros sin atender', 'explicacion','Pendientes hace más de 30 minutos.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'ALTO' else 'OK' end, 'ejemplos', v_ej));

  -- Solicitudes: tomadas y nunca cerradas
  select count(*), coalesce(jsonb_agg(jsonb_build_object('usuario', usuario, 'dato', coalesce(operador, 'sin operador') || ' · hace ' || horas || ' h')
           order by horas desc) filter (where rn <= 8), '[]'::jsonb)
    into v_n, v_ej
    from (select s.usuario, s.tomada_por_operador_nombre as operador,
                 floor(extract(epoch from now() - coalesce(s.tomada_at, s.created_at)) / 3600)::int as horas,
                 row_number() over (order by coalesce(s.tomada_at, s.created_at)) as rn
            from public.landing_solicitudes s
           where s.pc_codigo = any(p_pcs) and s.estado in ('EN_PROCESO','EN_REVISION','TOMADA','TOMADO','PROCESANDO')
             and coalesce(s.tomada_at, s.created_at) < now() - interval '2 hours' and s.created_at > now() - interval '30 days') t;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','TOMADA_SIN_CERRAR','grupo','Solicitudes',
    'titulo','Tomadas y sin cerrar', 'explicacion','Un operador las tomó hace más de 2 horas y siguen abiertas.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'MEDIO' else 'OK' end, 'ejemplos', v_ej));

  -- Retiros: una misma cuenta de cobro usada por varios usuarios de la oficina (30 días)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('usuario', usuarios, 'dato', cuentas || ' usuarios · ' || destino)
           order by cuentas desc) filter (where rn <= 8), '[]'::jsonb)
    into v_n, v_ej
    from (select d as destino, count(distinct u) as cuentas, string_agg(distinct u, ' · ') as usuarios,
                 row_number() over (order by count(distinct u) desc) as rn
            from (select lower(regexp_replace(btrim(s.metadata->>'destino'), '[^A-Za-z0-9.]', '', 'g')) as d,
                         public.nodo_norm_usuario_v21(s.usuario) as u
                    from public.landing_solicitudes s
                   where upper(coalesce(s.pc_codigo,'')) = any(p_pcs) and s.created_at > now() - interval '30 days'
                     and s.tipo = 'RETIRO' and length(btrim(coalesce(s.metadata->>'destino',''))) > 5
                     and coalesce(btrim(s.usuario),'') <> '') x
           group by d having count(distinct u) > 1) t;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','CUENTA_COMPARTIDA','grupo','Retiros',
    'titulo','Cuenta de cobro compartida', 'explicacion','La misma cuenta cobró retiros de más de un usuario en los últimos 30 días.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'MEDIO' else 'OK' end, 'ejemplos', v_ej));

  -- Retiros: cuentas esperando la validación del DNI
  if to_regclass('public.retiro_instrumentos') is not null then
    execute 'select count(*) from public.retiro_instrumentos where pc_codigo = any($1) and estado = ''PENDIENTE'''
      into v_dni using p_pcs;
    v_items := v_items || jsonb_build_array(jsonb_build_object('clave','DNI_PENDIENTE','grupo','Retiros',
      'titulo','Cuentas esperando el DNI', 'explicacion','Retiros con cuenta nueva que el operador todavía no validó.',
      'cantidad', v_dni, 'nivel', case when v_dni > 0 then 'INFO' else 'OK' end, 'ejemplos', '[]'::jsonb));
  end if;

  -- Usuarios: cambios de teléfono o de usuario de la semana; ida y vuelta entre operadores = alto
  select count(*), coalesce(jsonb_agg(jsonb_build_object('usuario', usuario, 'dato', veces || ' cambios · ' || operadores)
           order by veces desc) filter (where rn <= 8), '[]'::jsonb),
         count(*) filter (where n_ops > 1)
    into v_n, v_ej, v_dni
    from (select e.usuario, count(*) as veces, count(distinct e.operador) as n_ops,
                 string_agg(distinct coalesce(e.operador, 'automático'), ' · ') as operadores,
                 row_number() over (order by count(*) desc) as rn
            from public.usuarios_portal_eventos e
           where e.pc_codigo = any(p_pcs) and e.evento in ('CAMBIO_TELEFONO','USUARIO_REEMPLAZADO')
             and e.created_at > now() - interval '7 days'
           group by e.usuario) t;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','CAMBIO_DE_USUARIO','grupo','Usuarios',
    'titulo','Cambios de teléfono o de usuario', 'explicacion','De la última semana. Si dos operadores lo cambiaron y lo volvieron atrás, hay que mirarlo.',
    'cantidad', v_n, 'nivel', case when v_dni > 0 then 'ALTO' when v_n > 0 then 'INFO' else 'OK' end, 'ejemplos', v_ej));

  -- Usuarios: declararon ser menores (30 días)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('usuario', usuario, 'dato', to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM')))
           filter (where rn <= 8), '[]'::jsonb)
    into v_n, v_ej
    from (select e.usuario, e.created_at, row_number() over (order by e.created_at desc) as rn
            from public.usuarios_portal_eventos e
           where e.pc_codigo = any(p_pcs) and e.evento = 'MENOR_DECLARADO' and e.created_at > now() - interval '30 days') t;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','MENOR_DECLARADO','grupo','Usuarios',
    'titulo','Dijeron ser menores de edad', 'explicacion','Al pedir un retiro, en los últimos 30 días.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'ALTO' else 'OK' end, 'ejemplos', v_ej));

  -- Bonos: bono de primer ingreso a usuarios que comparten teléfono (90 días)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('usuario', usuarios, 'dato', n || ' usuarios con el mismo teléfono'))
           filter (where rn <= 8), '[]'::jsonb)
    into v_n, v_ej
    from (select string_agg(distinct b.u, ' · ') as usuarios, count(distinct b.u) as n,
                 row_number() over (order by count(distinct b.u) desc) as rn
            from (select distinct public.nodo_norm_usuario_v21(h.usuario) as u
                    from public.historial_ops h
                   where h.origen = 'PROMO_BONO' and upper(coalesce(h.pc_codigo,'')) = any(p_pcs)
                     and h.created_at > now() - interval '90 days') b
            join public.usuarios_portal_vinculos v
              on v.pc_codigo = any(p_pcs) and public.nodo_norm_usuario_v21(v.usuario) = b.u
           group by right(v.telefono_canon, 8) having count(distinct b.u) > 1) t;
  v_items := v_items || jsonb_build_array(jsonb_build_object('clave','BONO_REPETIDO','grupo','Bonos',
    'titulo','Bono de primer ingreso repetido', 'explicacion','Más de un usuario con el mismo teléfono cobró el bono en los últimos 90 días.',
    'cantidad', v_n, 'nivel', case when v_n > 0 then 'MEDIO' else 'OK' end, 'ejemplos', v_ej));

  return jsonb_build_object('items', v_items, 'generado', now());
end $$;

-- ── 4. Revisar un teléfono antes de crear usuario, dentro de la oficina ───────────────────────────────
-- Mismo veredicto y mismos textos que panel_prevalidar_usuario, sin "tiene usuarios en otras oficinas":
-- los usuarios no se comparten entre oficinas.
create or replace function identidad.prevalidar_v1(p_pcs text[], p_telefono text, p_usuario text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tel  text := coalesce(public._identidad_tel(p_telefono), '');
  v_tel8 text;
  v_usr  text := coalesce(public.nodo_norm_usuario_v21(coalesce(p_usuario,'')), '');
  v_res jsonb; v_motivos jsonb := '[]'::jsonb; v_ver text := 'LIBRE';
  v_aqui int; v_bonos int; v_cbu int; v_existe boolean := false;
begin
  if v_tel = '' and v_usr = '' then
    return jsonb_build_object('ok', false, 'error', 'FALTA_TELEFONO_O_USUARIO');
  end if;
  v_tel8 := case when length(v_tel) >= 8 then right(v_tel, 8) end;

  with vin as (
    select public.nodo_norm_usuario_v21(v.usuario) as u, v.usuario, v.estado_vinculo, v.created_at, v.titular,
           coalesce(v.app_instalada, false) as app
      from public.usuarios_portal_vinculos v
     where v_tel8 is not null and v.pc_codigo = any(p_pcs) and right(v.telefono_canon, 8) = v_tel8
       and coalesce(v.usuario,'') <> ''
  ),
  actividad as (
    select public.nodo_norm_usuario_v21(h.usuario) as u,
           count(*) filter (where upper(h.tipo) = 'CARGA' and coalesce(h.origen,'') <> 'PROMO_BONO') as cargas,
           count(*) filter (where upper(h.tipo) = 'RETIRO') as retiros,
           count(*) filter (where h.origen = 'PROMO_BONO') as bonos,
           max(h.created_at) as ultima
      from public.historial_ops h
     where upper(coalesce(h.pc_codigo,'')) = any(p_pcs) and public.nodo_norm_usuario_v21(h.usuario) in (select u from vin)
       and upper(coalesce(h.estado,'')) = 'OK'
     group by 1
  ),
  mis_destinos as (
    select distinct lower(regexp_replace(btrim(s.metadata->>'destino'), '[^A-Za-z0-9.]', '', 'g')) as d
      from public.landing_solicitudes s
     where upper(coalesce(s.pc_codigo,'')) = any(p_pcs) and lower(btrim(s.usuario)) in (select lower(btrim(usuario)) from vin)
       and s.tipo = 'RETIRO' and length(btrim(coalesce(s.metadata->>'destino',''))) > 5
  ),
  cbus as (
    select m.d as cbu, count(distinct public.nodo_norm_usuario_v21(s.usuario)) as cuentas,
           string_agg(distinct public.nodo_norm_usuario_v21(s.usuario), ' · ') as usuarios
      from mis_destinos m
      join public.landing_solicitudes s
        on s.tipo = 'RETIRO' and length(btrim(coalesce(s.metadata->>'destino',''))) > 5
       and lower(regexp_replace(btrim(s.metadata->>'destino'), '[^A-Za-z0-9.]', '', 'g')) = m.d
       and upper(coalesce(s.pc_codigo,'')) = any(p_pcs)
     group by m.d having count(distinct public.nodo_norm_usuario_v21(s.usuario)) > 1
  )
  select jsonb_build_object(
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('usuario', v.u, 'estado', v.estado_vinculo, 'titular', v.titular,
        'app', v.app, 'desde', v.created_at, 'cargas', coalesce(a.cargas,0), 'retiros', coalesce(a.retiros,0),
        'bonos', coalesce(a.bonos,0), 'ultima', a.ultima, 'misma_oficina', true) order by a.ultima desc nulls last)
        from vin v left join actividad a on a.u = v.u), '[]'::jsonb),
    'cbus', coalesce((select jsonb_agg(jsonb_build_object('cbu', c.cbu, 'cuentas', c.cuentas, 'usuarios', c.usuarios)) from cbus c), '[]'::jsonb),
    'aqui', (select count(*) from vin),
    'otras', 0,
    'bonos', (select coalesce(sum(a.bonos),0) from actividad a),
    'cbu_max', (select coalesce(max(c.cuentas),0) from cbus c)
  ) into v_res;

  v_aqui  := (v_res->>'aqui')::int;
  v_bonos := (v_res->>'bonos')::int;
  v_cbu   := (v_res->>'cbu_max')::int;

  if v_usr <> '' then
    select exists (select 1 from public.usuarios_portal_vinculos v
                    where v.pc_codigo = any(p_pcs) and public.nodo_norm_usuario_v21(v.usuario) = v_usr)
        or exists (select 1 from public.historial_ops h
                    where upper(coalesce(h.pc_codigo,'')) = any(p_pcs) and public.nodo_norm_usuario_v21(h.usuario) = v_usr)
      into v_existe;
  end if;

  if v_existe then
    v_ver := 'YA_EXISTE';
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','El usuario "' || v_usr || '" ya existe. No lo crees de nuevo: buscalo y validalo.'));
  end if;
  if v_aqui > 0 then
    v_ver := 'YA_EXISTE';
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','Ese teléfono ya tiene ' || v_aqui || ' usuario(s) en esta oficina. Validá el que tiene en vez de crear otro.'));
  end if;
  if v_bonos > 0 then
    if v_ver = 'LIBRE' then v_ver := 'REVISAR'; end if;
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','Ese teléfono ya cobró ' || v_bonos || ' bono(s) de primer ingreso. Un usuario nuevo volvería a cobrarlo.'));
  end if;
  if v_cbu >= 3 then
    if v_ver = 'LIBRE' then v_ver := 'REVISAR'; end if;
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','Su cuenta de cobro aparece en ' || v_cbu || ' usuarios distintos. Con 3 o más no se explica por familia.'));
  elsif v_cbu = 2 then
    if v_ver = 'LIBRE' then v_ver := 'REVISAR'; end if;
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','MEDIO',
      'texto','Su cuenta de cobro la comparte con otro usuario. Puede ser familia: mirá antes de decidir.'));
  end if;
  if v_ver = 'LIBRE' then
    v_motivos := jsonb_build_array(jsonb_build_object('nivel','OK', 'texto','Sin antecedentes en esta oficina. Se puede crear.'));
  end if;

  return v_res || jsonb_build_object('ok', true, 'telefono_fin', case when v_tel8 is not null then right(v_tel8, 4) end,
    'usuario_pedido', nullif(v_usr,''), 'usuario_existe', v_existe, 'veredicto', v_ver, 'motivos', v_motivos);
end $$;

revoke all on function identidad.ingresos_v1(text[],integer), operaciones.revisiones_v1(text[]),
  identidad.prevalidar_v1(text[],text,text) from public, anon, authenticated;

-- ── Entradas públicas: NODO beta (token de la PC) y admin general (sesión) ────────────────────────────
create or replace function public.nodo_beta_ingresos_v1(p_token text, p_pc_codigo text, p_dias integer default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pc text := upper(btrim(coalesce(p_pc_codigo,'')));
begin
  perform acceso.autorizar(p_token, v_pc);
  if p_dias is null or p_dias not between 1 and 30 then
    raise exception using errcode = '22023', message = 'BETA_INVALID_DAYS';
  end if;
  return jsonb_build_object('ok', true, 'contract', 'ingresos.v1', 'pc_codigo', v_pc)
      || identidad.ingresos_v1(acceso.oficinas_autorizadas(v_pc), p_dias);
end $$;

create or replace function public.nodo_beta_revisiones_v1(p_token text, p_pc_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pc text := upper(btrim(coalesce(p_pc_codigo,'')));
begin
  perform acceso.autorizar(p_token, v_pc);
  return jsonb_build_object('ok', true, 'contract', 'revisiones.v1', 'pc_codigo', v_pc)
      || operaciones.revisiones_v1(acceso.oficinas_autorizadas(v_pc));
end $$;

create or replace function public.nodo_beta_prevalidar_v1(p_token text, p_pc_codigo text, p_telefono text default null, p_usuario text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pc text := upper(btrim(coalesce(p_pc_codigo,'')));
begin
  perform acceso.autorizar(p_token, v_pc);
  if length(coalesce(p_telefono,'')) > 40 or length(coalesce(p_usuario,'')) > 80 then
    raise exception using errcode = '22023', message = 'BETA_INVALID_INPUT';
  end if;
  return jsonb_build_object('contract', 'prevalidar.v1', 'pc_codigo', v_pc)
      || identidad.prevalidar_v1(acceso.oficinas_autorizadas(v_pc), p_telefono, p_usuario);
end $$;

-- Admin general: una oficina con todo el detalle, o todas con los números.
create or replace function public.admin_revisiones_v1(p_session_token text, p_pc_codigo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_scope jsonb; v_pc text; v_res jsonb := '[]'::jsonb; r record; v_rev jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);
  if not coalesce((v_scope->>'ok')::boolean, false) then return v_scope; end if;
  v_pc := nullif(v_scope->>'pc_codigo_efectivo', '');
  if v_pc is not null then
    return jsonb_build_object('ok', true, 'pc_codigo', v_pc) || operaciones.revisiones_v1(acceso.oficinas_autorizadas(v_pc));
  end if;
  for r in select distinct upper(btrim(l.pc_codigo)) as pc from public.landing_rutas_publicas l
            where coalesce(btrim(l.pc_codigo),'') <> '' order by 1 loop
    begin
      v_rev := operaciones.revisiones_v1(acceso.oficinas_autorizadas(r.pc));
      v_res := v_res || jsonb_build_array(jsonb_build_object('pc', r.pc, 'items', coalesce((
        select jsonb_agg(jsonb_build_object('clave', i->>'clave', 'titulo', i->>'titulo', 'grupo', i->>'grupo',
                 'cantidad', (i->>'cantidad')::int, 'nivel', i->>'nivel'))
          from jsonb_array_elements(v_rev->'items') i where (i->>'cantidad')::int > 0), '[]'::jsonb)));
    exception when others then
      v_res := v_res || jsonb_build_array(jsonb_build_object('pc', r.pc, 'error', 'NO_SE_PUDO_LEER'));
    end;
  end loop;
  return jsonb_build_object('ok', true, 'oficinas', v_res, 'generado', now());
end $$;

revoke all on function public.nodo_beta_ingresos_v1(text,text,integer), public.nodo_beta_revisiones_v1(text,text),
  public.nodo_beta_prevalidar_v1(text,text,text,text), public.admin_revisiones_v1(text,text) from public;
grant execute on function public.nodo_beta_ingresos_v1(text,text,integer), public.nodo_beta_revisiones_v1(text,text),
  public.nodo_beta_prevalidar_v1(text,text,text,text), public.admin_revisiones_v1(text,text) to anon, authenticated;

-- ── Señales de vida: el canal de salud acepta las partes nuevas ───────────────────────────────────────
-- CRM no estaba: "Estado del sistema" no podía mostrarlo aunque NODO lo midiera.
do $$
begin
  if to_regclass('nodo_beta.salud_actual') is not null then
    alter table nodo_beta.salud_actual drop constraint if exists salud_actual_integration_check;
    alter table nodo_beta.salud_actual add constraint salud_actual_integration_check check (integration in (
      'CHAT','PORTAL','TELEMETRIA','CAPACIDADES','BANDEJA','IDENTIDAD','HISTORIAL','BILLETERAS','RETIROS','VALIDACION',
      'WORKERS','AUTOMATISMOS','CONCILIACION','NEXO','ADMIN','CONEXION','PERSISTENCIA','CRM','INGRESOS','REVISIONES'));
  end if;
end $$;
