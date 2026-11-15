-- Monitor de canales · fase 0 (9/11)
--
-- Qué hace: cada 5 minutos saca una foto de las estadísticas del propio servidor (pg_stat_statements) y
-- anota, por canal (cada función o tabla que llaman NODO, el admin y el Portal), cuántas llamadas hubo y
-- cuánto tardaron. Con eso abre y cierra alertas: un canal que se pone lento, que se acerca al corte de
-- 3 segundos, o que deja de recibir llamadas mientras el resto del sistema sigue andando.
--
-- Qué NO hace: no toca ninguna función en uso, no agrega nada a lo que hacen las oficinas, no lee datos de
-- jugadores. Sólo lee contadores. Lo que el servidor no ve (una consulta cortada por demora no queda en las
-- estadísticas) lo informa cada PC por nodo_beta_salud_v1, que ya existe; el monitor también lo junta.
--
-- Juan, 9/11: "estos nuevos canales también deben de dar señales de vida… si funciona, si puede mejorarse y
-- si en algún momento falla, esto nos tendría que dar una alerta en el momento".
--
-- Vuelta atrás: servidor/canales-monitor-vuelta-atras.sql

create schema if not exists nodo_monitor;
revoke all on schema nodo_monitor from public, anon, authenticated;

create table if not exists nodo_monitor.catalogo (
  canal               text primary key,              -- nombre de la función, o 'tabla:<nombre>' si se lee la tabla directo
  consumidor          text not null check (consumidor in ('NODO','ADMIN','PORTAL','SERVIDOR')),
  que_hace            text not null,                 -- castellano, corto: lo que ve quien lo usa
  umbral_ms           integer not null default 1000, -- tiempo medio por encima del cual está LENTO
  minimo_por_hora     integer,                       -- menos llamadas que esto con el sistema andando = SIN_SEÑAL (null: no se vigila)
  reemplazo           text,                          -- canal nuevo que lo reemplaza, cuando exista
  nota                text,
  activo              boolean not null default true
);

create table if not exists nodo_monitor.foto_anterior (
  userid    oid    not null,
  queryid   bigint not null,
  canal     text   not null,
  calls     bigint not null,
  total_ms  double precision not null,
  tomada_at timestamptz not null,
  primary key (userid, queryid)
);

create table if not exists nodo_monitor.medicion (
  ventana   timestamptz not null,   -- comienzo de la ventana de 5 minutos
  canal     text not null,
  llamadas  bigint not null,
  ms_total  double precision not null,
  primary key (ventana, canal)
);

create table if not exists nodo_monitor.alertas (
  id          bigserial primary key,
  canal       text not null,
  tipo        text not null check (tipo in ('LENTO','CERCA_DEL_CORTE','SIN_SENAL','FALLA_EN_PC')),
  detalle     text not null,
  abierta_at  timestamptz not null default now(),
  ultima_vez  timestamptz not null default now(),
  cerrada_at  timestamptz,
  veces       integer not null default 1
);
create unique index if not exists nodo_monitor_alerta_abierta on nodo_monitor.alertas (canal, tipo) where cerrada_at is null;

create table if not exists nodo_monitor.corridas (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  canales   integer not null,
  llamadas  bigint not null,
  abiertas  integer not null,
  ms        integer not null
);

-- De qué canal es cada consulta. PostgREST arma todas igual: una RPC aparece como "public"."funcion"( y
-- una lectura de tabla como FROM "public"."tabla".
create or replace function nodo_monitor._canal(q text) returns text
language sql immutable set search_path = '' as $$
  select case
    when q like 'WITH pgrst_source%' then
      coalesce(substring(q from '"public"\."([a-zA-Z0-9_]+)"\('),
               'tabla:' || substring(q from '(?:FROM|INTO|UPDATE) "public"\."([a-zA-Z0-9_]+)"'))
  end
$$;

-- Fuente de las estadísticas. Separada para poder probarla sin pg_stat_statements.
create or replace function nodo_monitor._estadisticas()
returns table(userid oid, queryid bigint, query text, calls bigint, total_ms double precision)
language sql stable security definer set search_path = '' as $$
  select s.userid, s.queryid, s.query, s.calls, s.total_exec_time
    from extensions.pg_stat_statements s
   where s.userid in (select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role'))
     and s.query like 'WITH pgrst_source%'
$$;

create or replace function nodo_monitor.tomar_foto() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ahora   timestamptz := now();
  v_ventana timestamptz := date_trunc('minute', v_ahora) - make_interval(mins => (extract(minute from v_ahora)::int % 5));
  v_primera boolean := not exists (select 1 from nodo_monitor.foto_anterior);
  v_canales integer; v_llamadas bigint;
begin
  create temp table if not exists _nodo_monitor_ahora (userid oid, queryid bigint, canal text, calls bigint, total_ms double precision) on commit drop;
  truncate _nodo_monitor_ahora;
  insert into _nodo_monitor_ahora
  select e.userid, e.queryid, nodo_monitor._canal(e.query), e.calls, e.total_ms
    from nodo_monitor._estadisticas() e
   where e.queryid is not null;
  delete from _nodo_monitor_ahora where canal is null;

  -- Diferencia contra la foto anterior. Si un contador bajó (el servidor reinició las estadísticas o
  -- descartó esa consulta y la volvió a anotar), lo que hay ahora es todo nuevo.
  if not v_primera then
    insert into nodo_monitor.medicion as m (ventana, canal, llamadas, ms_total)
    select v_ventana, a.canal,
           sum(case when p.calls is null or a.calls < p.calls then a.calls else a.calls - p.calls end),
           sum(case when p.calls is null or a.calls < p.calls then a.total_ms else greatest(a.total_ms - p.total_ms, 0) end)
      from _nodo_monitor_ahora a
      left join nodo_monitor.foto_anterior p on p.userid = a.userid and p.queryid = a.queryid
     group by a.canal
    having sum(case when p.calls is null or a.calls < p.calls then a.calls else a.calls - p.calls end) > 0
    on conflict (ventana, canal) do update
      set llamadas = m.llamadas + excluded.llamadas, ms_total = m.ms_total + excluded.ms_total;
  end if;

  delete from nodo_monitor.foto_anterior;
  insert into nodo_monitor.foto_anterior (userid, queryid, canal, calls, total_ms, tomada_at)
  select userid, queryid, canal, calls, total_ms, v_ahora from _nodo_monitor_ahora;

  delete from nodo_monitor.medicion where ventana < v_ahora - interval '35 days';

  select count(distinct canal), coalesce(sum(llamadas), 0) into v_canales, v_llamadas
    from nodo_monitor.medicion where ventana = v_ventana;
  return jsonb_build_object('ok', true, 'primera', v_primera, 'ventana', v_ventana, 'canales', v_canales, 'llamadas', v_llamadas);
end $$;

-- Abre, renueva y cierra alertas. Mira los últimos 15 minutos (lentitud) y la última hora (silencio).
create or replace function nodo_monitor.evaluar() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ahora timestamptz := now();
  v_activo boolean;
  v_vistas text[] := '{}';
  r record;
  v_abiertas integer;
begin
  -- "El sistema anda": hubo latidos de NODO en la última hora. Sin esto, de madrugada todo parecería caído.
  -- Y el silencio sólo se juzga con una hora entera medida: recién publicado, todo parecería en cero.
  select coalesce(sum(llamadas), 0) > 0 into v_activo
    from nodo_monitor.medicion
   where canal = 'panel_registrar_actividad' and ventana >= v_ahora - interval '1 hour';
  v_activo := v_activo and exists (select 1 from nodo_monitor.corridas where at <= v_ahora - interval '65 minutes');

  for r in
    select c.canal, c.que_hace, c.umbral_ms, c.minimo_por_hora,
           coalesce(sum(m.llamadas) filter (where m.ventana >= v_ahora - interval '15 minutes'), 0) as n15,
           coalesce(sum(m.ms_total) filter (where m.ventana >= v_ahora - interval '15 minutes'), 0) as ms15,
           coalesce(sum(m.llamadas), 0) as n60
      from nodo_monitor.catalogo c
      left join nodo_monitor.medicion m on m.canal = c.canal and m.ventana >= v_ahora - interval '1 hour'
     where c.activo
     group by c.canal, c.que_hace, c.umbral_ms, c.minimo_por_hora
  loop
    if r.n15 >= 3 and r.ms15 / r.n15 >= 2000 then
      v_vistas := v_vistas || (r.canal || '|CERCA_DEL_CORTE');
      insert into nodo_monitor.alertas as a (canal, tipo, detalle)
      values (r.canal, 'CERCA_DEL_CORTE', format('%s: tarda %s ms en promedio (el servidor corta a los 3.000)', r.que_hace, round(r.ms15 / r.n15)))
      on conflict (canal, tipo) where cerrada_at is null do update
        set ultima_vez = v_ahora, veces = a.veces + 1, detalle = excluded.detalle;
    elsif r.n15 >= 3 and r.ms15 / r.n15 >= r.umbral_ms then
      v_vistas := v_vistas || (r.canal || '|LENTO');
      insert into nodo_monitor.alertas as a (canal, tipo, detalle)
      values (r.canal, 'LENTO', format('%s: tarda %s ms en promedio (lo normal es menos de %s)', r.que_hace, round(r.ms15 / r.n15), r.umbral_ms))
      on conflict (canal, tipo) where cerrada_at is null do update
        set ultima_vez = v_ahora, veces = a.veces + 1, detalle = excluded.detalle;
    end if;

    if v_activo and r.minimo_por_hora is not null and r.n60 < r.minimo_por_hora then
      v_vistas := v_vistas || (r.canal || '|SIN_SENAL');
      insert into nodo_monitor.alertas as a (canal, tipo, detalle)
      values (r.canal, 'SIN_SENAL', format('%s: %s llamadas en la última hora (lo esperable es más de %s) y el resto del sistema sigue andando', r.que_hace, r.n60, r.minimo_por_hora))
      on conflict (canal, tipo) where cerrada_at is null do update
        set ultima_vez = v_ahora, veces = a.veces + 1, detalle = excluded.detalle;
    end if;
  end loop;

  -- Lo que informan las PCs con el canal de salud beta (lo único que ve una consulta cortada por demora).
  if to_regclass('nodo_beta.salud_actual') is not null then
    for r in execute $q$
      select c.pc_codigo || ' · ' || h.integration as canal,
             format('%s en %s: %s (%s)', h.integration, c.pc_codigo, lower(h.state), coalesce(h.last_error_code, h.code, 'sin código')) as detalle
        from nodo_beta.salud_actual h join nodo_beta.beta_clientes c on c.id = h.client_id
       where c.enabled and h.state in ('ERROR','DEGRADED') and h.received_at >= now() - interval '10 minutes'
    $q$
    loop
      v_vistas := v_vistas || (r.canal || '|FALLA_EN_PC');
      insert into nodo_monitor.alertas as a (canal, tipo, detalle)
      values (r.canal, 'FALLA_EN_PC', r.detalle)
      on conflict (canal, tipo) where cerrada_at is null do update
        set ultima_vez = v_ahora, veces = a.veces + 1, detalle = excluded.detalle;
    end loop;
  end if;

  -- Lo que no se volvió a ver, se cierra.
  update nodo_monitor.alertas set cerrada_at = v_ahora
   where cerrada_at is null and not ((canal || '|' || tipo) = any (v_vistas));

  select count(*) into v_abiertas from nodo_monitor.alertas where cerrada_at is null;
  delete from nodo_monitor.alertas where cerrada_at < v_ahora - interval '90 days';
  return jsonb_build_object('ok', true, 'abiertas', v_abiertas, 'sistema_andando', v_activo);
end $$;

create or replace function nodo_monitor.correr() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t0 timestamptz := clock_timestamp(); v_f jsonb; v_e jsonb;
begin
  v_f := nodo_monitor.tomar_foto();
  v_e := nodo_monitor.evaluar();
  insert into nodo_monitor.corridas (canales, llamadas, abiertas, ms)
  values (coalesce((v_f->>'canales')::int, 0), coalesce((v_f->>'llamadas')::bigint, 0), coalesce((v_e->>'abiertas')::int, 0),
          extract(milliseconds from clock_timestamp() - v_t0)::int);
  delete from nodo_monitor.corridas where at < now() - interval '35 days';
  return v_f || v_e;
end $$;

-- Lectura para el admin general (y después para la pantalla de Estado de NODO): sólo con sesión de admin.
create or replace function public.admin_canales_estado_v1(p_session_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; v_ultima timestamptz;
begin
  select * into s from public.panel_validar_admin_session(p_session_token) limit 1;
  if s.ok is not true then
    return jsonb_build_object('ok', false, 'error', 'SESION_INVALIDA');
  end if;
  if s.puede_todas is not true then
    return jsonb_build_object('ok', false, 'error', 'SOLO_ADMIN_GENERAL');
  end if;
  select max(at) into v_ultima from nodo_monitor.corridas;
  return jsonb_build_object(
    'ok', true,
    'monitor_ultima_corrida', v_ultima,
    'monitor_vivo', coalesce(v_ultima > now() - interval '12 minutes', false),
    'alertas', coalesce((
      select jsonb_agg(jsonb_build_object('canal', a.canal, 'tipo', a.tipo, 'detalle', a.detalle,
               'desde', a.abierta_at, 'ultima_vez', a.ultima_vez, 'veces', a.veces) order by a.abierta_at desc)
        from nodo_monitor.alertas a where a.cerrada_at is null), '[]'::jsonb),
    'canales', coalesce((
      select jsonb_agg(x order by (x->>'llamadas_24h')::bigint desc)
        from (
          select jsonb_build_object(
                   'canal', c.canal, 'consumidor', c.consumidor, 'que_hace', c.que_hace, 'umbral_ms', c.umbral_ms,
                   'reemplazo', c.reemplazo, 'nota', c.nota,
                   'llamadas_1h', coalesce(sum(m.llamadas) filter (where m.ventana >= now() - interval '1 hour'), 0),
                   'media_ms_1h', round((sum(m.ms_total) filter (where m.ventana >= now() - interval '1 hour')
                                         / nullif(sum(m.llamadas) filter (where m.ventana >= now() - interval '1 hour'), 0))::numeric),
                   'llamadas_24h', coalesce(sum(m.llamadas), 0),
                   'media_ms_24h', round((sum(m.ms_total) / nullif(sum(m.llamadas), 0))::numeric),
                   'segundos_servidor_24h', round((coalesce(sum(m.ms_total), 0) / 1000)::numeric)) as x
            from nodo_monitor.catalogo c
            left join nodo_monitor.medicion m on m.canal = c.canal and m.ventana >= now() - interval '24 hours'
           where c.activo
           group by c.canal, c.consumidor, c.que_hace, c.umbral_ms, c.reemplazo, c.nota) t), '[]'::jsonb),
    'sin_catalogar', coalesce((
      select jsonb_agg(jsonb_build_object('canal', canal, 'llamadas_24h', n, 'media_ms', ms) order by n desc)
        from (select m.canal, sum(m.llamadas) n, round((sum(m.ms_total) / nullif(sum(m.llamadas), 0))::numeric) ms
                from nodo_monitor.medicion m
               where m.ventana >= now() - interval '24 hours'
                 and not exists (select 1 from nodo_monitor.catalogo c where c.canal = m.canal)
               group by m.canal order by sum(m.ms_total) desc limit 30) t), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_canales_estado_v1(text) from public;
grant execute on function public.admin_canales_estado_v1(text) to anon, authenticated;

-- Catálogo inicial: los canales que más pesan o que ya fallaron (medido el 9/11 sobre 81 días).
-- Umbral = lo que debería tardar; mínimo por hora ≈ 10 % de lo habitual (sólo los que siempre se usan).
insert into nodo_monitor.catalogo (canal, consumidor, que_hace, umbral_ms, minimo_por_hora, nota) values
  ('panel_registrar_actividad',            'NODO',   'Latido de NODO (la PC está prendida)',                 200,  100, 'si cae, alguna PC dejó de avisar'),
  ('panel_v15_5_listar_solicitudes_portal','NODO',   'Bandeja de solicitudes (lista completa)',              300,  250, '66.600 por día; trae 110 a 500 KB cada vez'),
  ('panel_bandeja_senal',                  'NODO',   'Aviso de solicitudes nuevas',                          100,  200, null),
  ('panel_core_get_chat_sesiones_json',    'NODO',   'Lista de chats',                                       300,  400, '104.000 por día; trae unos 640 KB cada vez'),
  ('panel_v154_plus_listar_chat_sesiones', 'NODO',   'Lista de chats (versión anterior)',                    300,  null, null),
  ('panel_core_get_chat_mensajes_json',    'NODO',   'Mensajes de un chat',                                  300,  null, null),
  ('panel_crm_agente_resumen',             'NODO',   'CRM: resumen de todos los jugadores',                  1500, null, 'trae 3.900 jugadores (700 KB) por oficina; P12 2,7 MB'),
  ('panel_crm_vinculos',                   'NODO',   'CRM: vínculos de todos los jugadores',                 800,  null, null),
  ('panel_crm_flags',                      'NODO',   'CRM: app y notificaciones de todos los jugadores',     800,  null, null),
  ('panel_crm_vinculos_count',             'NODO',   'CRM: cantidad de vínculos',                            500,  null, null),
  ('panel_crm_vinculos_buscar',            'NODO',   'CRM: buscar jugador',                                  800,  null, null),
  ('panel_crm_perfil_v1',                  'NODO',   'Perfil del jugador',                                   800,  null, null),
  ('panel_reconexion_cola',                'NODO',   'CRM: cola de reconexión',                              1500, null, 'se cortó 12 veces el 9/11'),
  ('tabla:historial_ops',                  'NODO',   'Historial de movimientos (lectura directa de la tabla)', 800, null, null),
  ('panel_prevalidar_usuario',             'NODO',   'Revisar un teléfono antes de crear usuario',           800,  null, 'se cortó 86 veces el 9/11: busca el teléfono sin índice'),
  ('panel_promo_primer_ingreso',           'NODO',   '¿Le corresponde el bono de primer ingreso?',           800,  null, null),
  ('panel_vincular_usuario',               'NODO',   'Vincular usuario',                                     800,  null, null),
  ('panel_nodo_list_billeteras',           'NODO',   'Billeteras de la oficina',                             100,  null, null),
  ('panel_retiro_alertas',                 'NODO',   'Alertas de retiro (cuenta compartida, bono)',          300,  null, null),
  ('panel_retiro_instrumento',             'NODO',   'Retiro: ¿la cuenta ya validó el DNI?',                 300,  null, null),
  ('panel_retiro_instrumento_validar',     'NODO',   'Retiro: validar DNI',                                  500,  null, null),
  ('panel_v15_5_actualizar_solicitud_portal','NODO', 'Cambiar el estado de una solicitud',                   200,  null, null),
  ('landing_portal_v16_crear_solicitud',   'PORTAL', 'Portal: crear una carga o un retiro',                  300,  5,    'si cae a cero con NODO andando, el Portal no está creando solicitudes'),
  ('landing_historial_usuario',            'PORTAL', 'Portal: historial del jugador',                        300,  100,  'el que más tiempo de servidor usa (57.000 por día)'),
  ('landing_portal_chat_thread_get',       'PORTAL', 'Portal: chat del jugador',                             100,  100,  null),
  ('landing_estado_solicitud_segura',      'PORTAL', 'Portal: estado de la solicitud',                       100,  null, null),
  ('landing_portal_resolver_vinculo',      'PORTAL', 'Portal: entrar con usuario y teléfono',                500,  null, null),
  ('landing_datos_retiro',                 'PORTAL', 'Portal: datos para retirar',                           800,  null, 'tarda 757 ms en promedio'),
  ('landing_portal_retiro_contexto_v1',    'PORTAL', 'Portal: retiro con DNI (consulta)',                    300,  null, 'P1 y P4'),
  ('landing_portal_retiro_crear_v1',       'PORTAL', 'Portal: retiro con DNI (crear)',                       500,  null, 'P1 y P4'),
  ('admin_od_dashboard_v3',                'ADMIN',  'Admin: tablero de inicio',                             1500, null, 'el 9/11 se cortó 38 veces: "No se pudo cargar el dashboard"'),
  ('admin_od_pendientes_v1',               'ADMIN',  'Admin: pendientes de todas las oficinas',              1000, null, 'el 9/11 se cortó 71 veces'),
  ('admin_od_tablero_v1',                  'ADMIN',  'Admin: tablero',                                       800,  null, null),
  ('admin_v19_snapshot',                   'ADMIN',  'Admin: foto general (hasta 2.000 filas)',              800,  null, null),
  ('admin_od_dashboard_resumen_v2',        'ADMIN',  'Admin: resumen del tablero',                           800,  null, null),
  ('admin_od_crecimiento_resumen_v2',      'ADMIN',  'Admin: crecimiento',                                   1500, null, null),
  ('admin_general_aliases_list',           'ADMIN',  'Admin: alias de las oficinas',                         100,  null, '6.900 por día: mucho para una lista que casi no cambia'),
  ('admin_general_rutas_list',             'ADMIN',  'Admin: rutas del Portal',                              100,  null, '6.900 por día: ídem'),
  ('whaticket_contactos_a_agendar',        'SERVIDOR','WhatsApp: contactos para agendar (cada 30 min)',      3000, null, 'tarda 2 s en promedio, hasta 7,8 s'),
  -- Canales nuevos (beta, por oficina). Al lado del viejo que reemplazan, para comparar.
  ('landing_portal_ingreso_v1',            'PORTAL', 'Portal: entrar (anota cada intento)',                  500,  null, 'reemplaza a landing_portal_resolver_vinculo en el Portal nuevo'),
  ('nodo_beta_ingresos_v1',                'NODO',   'Ingresos al Portal de la oficina (beta)',              500,  null, null),
  ('nodo_beta_revisiones_v1',              'NODO',   'Revisiones de la oficina (beta)',                      800,  null, null),
  ('nodo_beta_prevalidar_v1',              'NODO',   'Revisar un teléfono, dentro de la oficina (beta)',     200,  null, 'reemplaza a panel_prevalidar_usuario'),
  ('admin_revisiones_v1',                  'ADMIN',  'Admin: revisiones por oficina',                        1500, null, null),
  ('nodo_beta_bandeja_v1',                 'NODO',   'Bandeja por oficina (beta)',                           300,  null, 'reemplaza a panel_v15_5_listar_solicitudes_portal'),
  ('nodo_beta_historial_v1',               'NODO',   'Historial con filtros (beta)',                         500,  null, 'reemplaza la lectura directa de historial_ops'),
  ('nodo_beta_perfil_v1',                  'NODO',   'Perfil del jugador (beta)',                            500,  null, 'reemplaza a panel_crm_perfil_v1'),
  ('nodo_beta_chat_lista_v1',              'NODO',   'Lista de chats (beta)',                                300,  null, 'reemplaza a panel_core_get_chat_sesiones_json'),
  ('nodo_beta_salud_v1',                   'NODO',   'Señales de vida de cada PC (beta)',                    200,  null, null)
on conflict (canal) do nothing;
update nodo_monitor.catalogo c set reemplazo = r.nuevo
  from (values ('landing_portal_resolver_vinculo','landing_portal_ingreso_v1'),
               ('panel_prevalidar_usuario','nodo_beta_prevalidar_v1'),
               ('panel_v15_5_listar_solicitudes_portal','nodo_beta_bandeja_v1'),
               ('tabla:historial_ops','nodo_beta_historial_v1'),
               ('panel_crm_perfil_v1','nodo_beta_perfil_v1'),
               ('panel_core_get_chat_sesiones_json','nodo_beta_chat_lista_v1')) as r(viejo, nuevo)
 where c.canal = r.viejo and c.reemplazo is null;

-- Cada 5 minutos. Se borra con: select cron.unschedule('monitor-canales');
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'monitor-canales';
    perform cron.schedule('monitor-canales', '*/5 * * * *', 'select nodo_monitor.correr();');
  end if;
end $$;
