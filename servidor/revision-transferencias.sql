-- Revisión de transferencias (14/11). Lee la lista de movimientos del banco y la engancha a las
-- cargas. Sirve para ver qué transferencia nadie reclamó, y si una rechazada llegó después.
-- Interruptor por oficina, apagado por defecto. Vuelta atrás: revision-transferencias-vuelta-atras.sql

-- Turnos AR 22-06 / 06-14 / 14-22, anclados al día en que ARRANCA el turno (misma regla que
-- NodoDomain.conciliacion.turnoId: a las 03:00 del viernes seguís en el turno del jueves 22-06).
create or replace function public.revision_turno_id(p_at timestamptz default now())
 returns text language sql immutable set search_path to 'public' as $function$
  with l as (select (p_at at time zone 'America/Argentina/Buenos_Aires') as t)
  select case
    when extract(hour from t) < 6  then to_char(t - interval '1 day','YYYY-MM-DD')||'_22-06'
    when extract(hour from t) < 14 then to_char(t,'YYYY-MM-DD')||'_06-14'
    when extract(hour from t) < 22 then to_char(t,'YYYY-MM-DD')||'_14-22'
    else to_char(t,'YYYY-MM-DD')||'_22-06'
  end from l;
$function$;

-- El rango real del turno, para filtrar historial_ops por created_at y usar el indice.
-- Filtrar con revision_turno_id(created_at) seria una funcion sobre la columna: escaneo
-- completo de 515.887 filas (la leccion de docs/CANALES.md seccion 9).
create or replace function public.revision_turno_rango(p_turno text)
 returns tstzrange language sql immutable set search_path to 'public' as $function$
  with p as (select substr(p_turno,1,10)::date as d, substr(p_turno,12) as tr)
  select case tr
    when '06-14' then tstzrange((d + time '06:00') at time zone 'America/Argentina/Buenos_Aires',
                                (d + time '14:00') at time zone 'America/Argentina/Buenos_Aires','[)')
    when '14-22' then tstzrange((d + time '14:00') at time zone 'America/Argentina/Buenos_Aires',
                                (d + time '22:00') at time zone 'America/Argentina/Buenos_Aires','[)')
    else              tstzrange((d + time '22:00') at time zone 'America/Argentina/Buenos_Aires',
                                ((d+1) + time '06:00') at time zone 'America/Argentina/Buenos_Aires','[)')
  end from p;
$function$;

-- ── Interruptor ───────────────────────────────────────────────────────────────────────────
-- OFF corta todo (es el default y el freno remoto). ON corre siempre. LOCAL = lo que diga el
-- archivo de la PC. Una oficina sin fila está en OFF.
create table if not exists public.revision_switch (
  pc_codigo   text primary key,
  modo        text not null default 'OFF' check (modo in ('OFF','ON','LOCAL')),
  cambiado_at timestamptz not null default now(),
  cambiado_por text,
  nota        text
);
alter table public.revision_switch enable row level security;

create or replace function public.panel_revision_modo(p_secret text, p_pc text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_pc text := upper(btrim(coalesce(p_pc,''))); v_modo text;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  select s.modo into v_modo from public.revision_switch s where s.pc_codigo = v_pc;
  return jsonb_build_object('ok',true,'pc',v_pc,'modo',coalesce(v_modo,'OFF'),
                            'turno',public.revision_turno_id());
end $function$;

-- ── Los movimientos leídos del banco ──────────────────────────────────────────────────────
-- centavos como entero: comparar pesos en coma flotante es cómo un cotejo empieza a mentir.
create table if not exists public.revision_movimientos (
  pc_codigo        text not null,
  mov_id           text not null,
  fuente           text,
  nombre           text,
  centavos         bigint,
  cuando           timestamptz,
  hora_texto       text,
  posicion         integer,
  descripcion      text,
  cuenta_cvu       text,
  cuenta_titular   text,
  turno_id         text,
  visto_primera_at timestamptz not null default now(),
  visto_ultima_at  timestamptz not null default now(),
  veces            integer not null default 1,
  -- el enganche
  op_id            bigint,
  op_estado        text,
  vinculo          text not null default 'SIN_RECLAMAR'
                   check (vinculo in ('SIN_RECLAMAR','RECLAMADA','AMBIGUO','PUEDE_VOLVER','IGNORAR')),
  vinculo_como     text,
  vinculo_at       timestamptz,
  vinculo_por      text,
  primary key (pc_codigo, mov_id)
);
alter table public.revision_movimientos enable row level security;

create index if not exists revision_movimientos_turno_idx on public.revision_movimientos (pc_codigo, turno_id);
create index if not exists revision_movimientos_pendientes_idx on public.revision_movimientos (pc_codigo, cuando desc)
  where vinculo in ('SIN_RECLAMAR','AMBIGUO','PUEDE_VOLVER');
create index if not exists revision_movimientos_nombre_idx on public.revision_movimientos (pc_codigo, lower(btrim(nombre)));

-- ── Guardar una lectura ───────────────────────────────────────────────────────────────────
-- Idempotente: el mismo movimiento leído de nuevo suma veces y no se duplica. No borra nada:
-- una lectura que no trajo un movimiento no significa que el movimiento no exista.
create or replace function public.panel_revision_guardar(p_secret text, p_pc text, p_movs jsonb, p_cuenta jsonb default '{}'::jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc,'')));
  v_nuevos int := 0; v_total int := 0; r jsonb; v_cuando timestamptz; v_hubo boolean;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'mensaje','falta pc'); end if;

  for r in select * from jsonb_array_elements(coalesce(p_movs,'[]'::jsonb)) loop
    if coalesce(r->>'id','') = '' then continue; end if;
    v_total := v_total + 1;
    begin v_cuando := (r->>'datetime')::timestamptz; exception when others then v_cuando := null; end;

    select true into v_hubo from public.revision_movimientos
     where pc_codigo = v_pc and mov_id = r->>'id';

    insert into public.revision_movimientos
      (pc_codigo, mov_id, fuente, nombre, centavos, cuando, hora_texto, posicion, descripcion,
       cuenta_cvu, cuenta_titular, turno_id)
    values (v_pc, r->>'id', r->>'fuente', nullif(btrim(coalesce(r->>'nombre','')),''),
            nullif(r->>'centavos','')::bigint, v_cuando, r->>'hora',
            nullif(r->>'posicion','')::int, nullif(btrim(coalesce(r->>'descripcion','')),''),
            nullif(btrim(coalesce(p_cuenta->>'cvu','')),''), nullif(btrim(coalesce(p_cuenta->>'titular','')),''),
            public.revision_turno_id(coalesce(v_cuando, now())))
    on conflict (pc_codigo, mov_id) do update
      set visto_ultima_at = now(),
          veces  = public.revision_movimientos.veces + 1,
          -- una lectura posterior no borra lo que ya se sabía
          nombre = coalesce(excluded.nombre, public.revision_movimientos.nombre),
          cuando = coalesce(excluded.cuando, public.revision_movimientos.cuando),
          centavos = coalesce(excluded.centavos, public.revision_movimientos.centavos),
          posicion = coalesce(excluded.posicion, public.revision_movimientos.posicion);

    if v_hubo is not true then v_nuevos := v_nuevos + 1; end if;
    v_hubo := null;
  end loop;

  return jsonb_build_object('ok',true,'pc',v_pc,'leidos',v_total,'nuevos',v_nuevos,
                            'turno',public.revision_turno_id());
end $function$;

-- ── Enganchar movimientos con cargas ──────────────────────────────────────────────────────
-- Sólo las que ENTRAN. Candidata = carga de la misma oficina por el mismo monto dentro de la
-- ventana, y el desempate es el NOMBRE DEL TITULAR.
--
-- Lo que mostraron los datos reales de P4 el 14/11, y por qué quedó así:
--
-- 1. Monto + ventana no alcanza. P4 hace más de 1.000 cargas por día y los montos redondos se
--    repiten: había 5 cargas de $25.000 en una ventana de 14 h, y 12 de $7.000 en 24 h. Elegir
--    sola entre ésas es exactamente cómo se acredita dos veces.
-- 2. El nombre sí alcanza. 742 de las 1.036 cargas de las últimas 24 h (71,6%) tienen titular
--    cargado en usuarios_portal_vinculos. Y dos transferencias del mismo nombre en el mismo
--    minuto no existen (Juan, 14/11): con una sola candidata por nombre se engancha, aunque
--    haya otras del mismo monto. Probado: acertó la op 515926 entre 12 del mismo monto.
-- 3. La ventana tiene que mirar PARA ATRÁS. El caso de la carga rechazada que vuelve sola pasa
--    al revés de lo intuitivo: el jugador reclama, se lo rechazan por no ver la plata, y la
--    transferencia aparece después. Con 15 min para atrás ese caso no se encontraba nunca.
--    Quedó en 6 h para atrás y 3 h para adelante.
-- 4. Un rechazo con reintento exitoso NO es plata para devolver. Caso real: op 511522 en ERROR
--    a las 19:30:49 y op 511525 en OK a las 19:31:19 — mismo titular, mismo monto, 30 segundos
--    después. La carga falló, el operador la reintentó y salió: la plata está acreditada. Por
--    eso PUEDE_VOLVER es sólo cuando TODOS los intentos de ese nombre fallaron.
-- 5. Dos OK del mismo nombre y monto → AMBIGUO, no se elige: eso es una doble acreditación y la
--    tiene que mirar una persona.
--
-- count(distinct) en todos los conteos: si algún join se multiplica, no inventa ambigüedad.
create or replace function public.panel_revision_enganchar(p_secret text, p_pc text, p_horas integer default 48)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc,'')));
  v_desde timestamptz := now() - make_interval(hours => greatest(1, coalesce(p_horas,48)));
  v_antes interval := interval '6 hours';
  v_desp  interval := interval '3 hours';
  v_reclamadas int := 0; v_ambiguas int := 0; v_vuelven int := 0; v_sin int := 0; v_por_nombre int := 0;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;

  with mov as materialized (
    select m.mov_id, m.centavos, m.cuando, public.nodo_norm_titular(m.nombre) as nom
      from public.revision_movimientos m
     where m.pc_codigo = v_pc
       and m.centavos > 0
       and m.cuando >= v_desde
       and m.vinculo in ('SIN_RECLAMAR','AMBIGUO','PUEDE_VOLVER')
  ), ops as materialized (
    select o.id, o.estado, o.created_at,
           round(coalesce(o.monto_aprobado, o.monto_declarado, o.monto) * 100)::bigint as centavos,
           public.nodo_norm_usuario_v21(o.usuario) as usr
      from public.historial_ops o
     where o.pc_codigo = v_pc
       and o.tipo = 'CARGA'
       and o.created_at >= v_desde - v_antes - interval '1 hour'
  ), tit as materialized (
    select public.nodo_norm_usuario_v21(v.usuario) as usr,
           public.nodo_norm_titular(v.titular)     as nom
      from public.usuarios_portal_vinculos v
     where v.pc_codigo = v_pc and coalesce(v.titular,'') <> ''
  ), par as (
    select m.mov_id, o.id as op_id, o.estado, o.created_at, m.cuando,
           (o.estado = 'OK') as salio,
           (m.nom is not null and t.nom is not null and t.nom = m.nom) as coincide
      from mov m
      join ops o
        on o.centavos = m.centavos
       and o.created_at between m.cuando - v_antes and m.cuando + v_desp
      left join tit t on t.usr = o.usr
  ), res as (
    select p.mov_id,
           count(distinct p.op_id)                                             as total,
           count(distinct p.op_id) filter (where p.salio)                      as total_ok,
           count(distinct p.op_id) filter (where p.coincide)                   as por_nombre,
           count(distinct p.op_id) filter (where p.coincide and p.salio)       as por_nombre_ok,
           count(distinct p.op_id) filter (where p.coincide and not p.salio)   as por_nombre_fallados,
           (array_agg(p.op_id  order by p.coincide desc, p.salio desc,
                      abs(extract(epoch from (p.created_at - p.cuando)))))[1]  as op_id,
           (array_agg(p.estado order by p.coincide desc, p.salio desc,
                      abs(extract(epoch from (p.created_at - p.cuando)))))[1]  as op_estado
      from par p group by p.mov_id
  )
  update public.revision_movimientos m
     set op_id = case
                   when r.por_nombre_ok = 1 then r.op_id
                   when r.por_nombre >= 1 and r.por_nombre_ok = 0 then r.op_id
                   when r.por_nombre = 0 and r.total_ok = 1 then r.op_id
                   when r.por_nombre = 0 and r.total = 1 then r.op_id
                   else null end,
         op_estado = case
                   when r.por_nombre_ok = 1 then 'OK'
                   when r.por_nombre >= 1 and r.por_nombre_ok = 0 then r.op_estado
                   when r.por_nombre = 0 and (r.total_ok = 1 or r.total = 1) then r.op_estado
                   else null end,
         vinculo = case
                   when r.por_nombre_ok = 1 then 'RECLAMADA'
                   when r.por_nombre >= 1 and r.por_nombre_ok = 0 then 'PUEDE_VOLVER'
                   when r.por_nombre = 0 and r.total_ok = 1 then 'RECLAMADA'
                   when r.por_nombre = 0 and r.total = 1 then
                     case when r.op_estado in ('RECHAZADA','ERROR','REVERTIDA') then 'PUEDE_VOLVER' else 'RECLAMADA' end
                   else 'AMBIGUO' end,
         vinculo_como = case
                   when r.por_nombre_ok = 1 and r.por_nombre_fallados > 0 then 'AUTO_NOMBRE_REINTENTO'
                   when r.por_nombre_ok = 1 then 'AUTO_NOMBRE'
                   when r.por_nombre >= 1 and r.por_nombre_ok = 0 then 'AUTO_NOMBRE_SIN_EXITO'
                   when r.por_nombre = 0 and r.total_ok = 1 then 'AUTO_MONTO'
                   when r.por_nombre = 0 and r.total = 1 then 'AUTO_MONTO'
                   else null end,
         vinculo_at = now()
    from res r
   where m.pc_codigo = v_pc and m.mov_id = r.mov_id;

  select count(*) filter (where vinculo='RECLAMADA'),
         count(*) filter (where vinculo='AMBIGUO'),
         count(*) filter (where vinculo='PUEDE_VOLVER'),
         count(*) filter (where vinculo='SIN_RECLAMAR'),
         count(*) filter (where vinculo_como like 'AUTO_NOMBRE%')
    into v_reclamadas, v_ambiguas, v_vuelven, v_sin, v_por_nombre
    from public.revision_movimientos
   where pc_codigo = v_pc and centavos > 0 and cuando >= v_desde;

  return jsonb_build_object('ok',true,'pc',v_pc,'reclamadas',v_reclamadas,
    'ambiguas',v_ambiguas,'pueden_volver',v_vuelven,'sin_reclamar',v_sin,
    'enganchadas_por_nombre',v_por_nombre);
end $function$;

-- Deja el id del movimiento en historial_ops.mp_movimiento_id (la columna estaba hecha para
-- esto y vacía en las 515.887 filas). Separado del enganche a propósito: escribir en un canal
-- que usan todas las oficinas se hace cuando alguien lo pide, no de arrastre.
create or replace function public.panel_revision_sellar(p_secret text, p_pc text, p_horas integer default 48)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_pc text := upper(btrim(coalesce(p_pc,''))); v_n int;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  with x as (
    update public.historial_ops o
       set mp_movimiento_id = m.mov_id
      from public.revision_movimientos m
     where m.pc_codigo = v_pc and m.op_id = o.id and m.vinculo = 'RECLAMADA'
       and o.mp_movimiento_id is null
       and m.cuando >= now() - make_interval(hours => greatest(1, coalesce(p_horas,48)))
    returning 1
  ) select count(*) into v_n from x;
  return jsonb_build_object('ok',true,'pc',v_pc,'sellados',v_n);
end $function$;

-- ── Cierre de turno: las cuatro listas ────────────────────────────────────────────────────
create or replace function public.panel_revision_cierre(p_secret text, p_pc text, p_turno text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc,'')));
  v_t  text := coalesce(nullif(btrim(coalesce(p_turno,'')),''), public.revision_turno_id());
  v_movs jsonb; v_sin_mov jsonb; v_rango tstzrange;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  v_rango := public.revision_turno_rango(v_t);

  select coalesce(jsonb_agg(jsonb_build_object(
           'mov', m.mov_id, 'pos', m.posicion, 'nombre', m.nombre,
           'pesos', round(m.centavos/100.0, 2), 'cuando', m.cuando,
           'vinculo', m.vinculo, 'op', m.op_id, 'op_estado', m.op_estado
         ) order by m.posicion, m.cuando), '[]'::jsonb)
    into v_movs
    from public.revision_movimientos m
   where m.pc_codigo = v_pc and m.turno_id = v_t and m.centavos > 0;

  -- Cargas del turno que ningún movimiento reclamó: pidieron algo que no se vio llegar.
  select coalesce(jsonb_agg(jsonb_build_object(
           'op', o.id, 'usuario', o.usuario, 'pesos', coalesce(o.monto_aprobado,o.monto_declarado,o.monto),
           'estado', o.estado, 'cuando', o.created_at
         ) order by o.created_at), '[]'::jsonb)
    into v_sin_mov
    from public.historial_ops o
   where o.pc_codigo = v_pc and o.tipo = 'CARGA'
     and o.created_at >= lower(v_rango) and o.created_at < upper(v_rango)
     and not exists (select 1 from public.revision_movimientos m
                      where m.pc_codigo = v_pc and m.op_id = o.id);

  return jsonb_build_object('ok',true,'pc',v_pc,'turno',v_t,
    'movimientos', v_movs,
    'sin_reclamar',   (select count(*) from jsonb_array_elements(v_movs) x where x->>'vinculo'='SIN_RECLAMAR'),
    'pueden_volver',  (select count(*) from jsonb_array_elements(v_movs) x where x->>'vinculo'='PUEDE_VOLVER'),
    'ambiguas',       (select count(*) from jsonb_array_elements(v_movs) x where x->>'vinculo'='AMBIGUO'),
    'cargas_sin_movimiento', v_sin_mov);
end $function$;

-- Todas las transferencias de un nombre, para contestar "¿reclamó esa misma u otra?".
create or replace function public.panel_revision_por_nombre(p_secret text, p_pc text, p_nombre text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_pc text := upper(btrim(coalesce(p_pc,''))); v_n text := lower(btrim(coalesce(p_nombre,'')));
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_n = '' then return jsonb_build_object('ok',false,'mensaje','falta el nombre'); end if;
  return jsonb_build_object('ok',true,'pc',v_pc,'nombre',v_n,
    'transferencias', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'mov', m.mov_id, 'pesos', round(m.centavos/100.0,2), 'cuando', m.cuando,
               'turno', m.turno_id, 'vinculo', m.vinculo, 'op', m.op_id, 'op_estado', m.op_estado
             ) order by m.cuando desc), '[]'::jsonb)
        from public.revision_movimientos m
       where m.pc_codigo = v_pc and lower(btrim(m.nombre)) = v_n));
end $function$;

revoke all on function public.panel_revision_modo(text,text) from public;
revoke all on function public.panel_revision_guardar(text,text,jsonb,jsonb) from public;
revoke all on function public.panel_revision_enganchar(text,text,integer) from public;
revoke all on function public.panel_revision_sellar(text,text,integer) from public;
revoke all on function public.panel_revision_cierre(text,text,text) from public;
revoke all on function public.panel_revision_por_nombre(text,text,text) from public;
grant execute on function public.panel_revision_modo(text,text) to anon, authenticated, service_role;
grant execute on function public.panel_revision_guardar(text,text,jsonb,jsonb) to anon, authenticated, service_role;
grant execute on function public.panel_revision_enganchar(text,text,integer) to anon, authenticated, service_role;
grant execute on function public.panel_revision_sellar(text,text,integer) to anon, authenticated, service_role;
grant execute on function public.panel_revision_cierre(text,text,text) to anon, authenticated, service_role;
grant execute on function public.panel_revision_por_nombre(text,text,text) to anon, authenticated, service_role;
