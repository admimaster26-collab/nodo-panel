-- Persistencia local sincronizada con identidad, ámbito de oficina y versión.
-- Ejecutar después de perfil-v1.sql e identidad-observaciones-v1.sql.
-- Separa atributos de usuario/identidad, atributos/trazas de movimientos, cotejos de turno/alta
-- y estado observacional de colas pendientes (nunca re-ejecuta pagos ni mensajes en otra PC).

create schema if not exists acceso;
create schema if not exists identidad;
create schema if not exists operaciones;
revoke all on schema acceso,identidad,operaciones from public,anon,authenticated;

create table if not exists identidad.jugadores_locales (
  pc_codigo text not null,
  source_id text not null,
  campo text not null check (campo in ('nombre','telefono','cbu','bono')),
  usuario text not null,
  atributo text not null,
  valor text not null,
  fuente text not null default 'local.jugadores',
  estado text not null default 'OBSERVADO_LOCAL',
  veces integer not null default 1 check (veces >= 1),
  verificado boolean not null default false,
  titular_asociado text,
  primera_fecha timestamptz,
  ultima_fecha timestamptz,
  detalle jsonb not null default '{}'::jsonb,
  client_id uuid not null,
  instalacion text not null,
  version text not null,
  updated_at timestamptz not null default now(),
  primary key (pc_codigo, source_id, campo)
);

create index if not exists jugadores_locales_pc_usuario_idx
  on identidad.jugadores_locales (upper(btrim(pc_codigo)), lower(btrim(usuario)), ultima_fecha desc nulls last);

create table if not exists operaciones.movimientos_locales (
  pc_codigo text not null,
  movimiento_key text not null,
  historial_id bigint,
  solicitud_id bigint,
  chunior_id text,
  usuario text not null,
  tipo text,
  monto numeric,
  estado text,
  titular text,
  destino text,
  cbu text,
  obs text,
  saldo_pre numeric,
  saldo_post numeric,
  billetera_nombre text,
  operador text,
  bono_pct numeric,
  origen text,
  notas text,
  traza jsonb,
  fecha timestamptz,
  client_id uuid not null,
  instalacion text not null,
  version text not null,
  updated_at timestamptz not null default now(),
  primary key (pc_codigo, movimiento_key)
);

create index if not exists movimientos_locales_pc_usuario_idx
  on operaciones.movimientos_locales (upper(btrim(pc_codigo)), lower(btrim(usuario)), fecha desc nulls last);
create index if not exists movimientos_locales_hist_idx
  on operaciones.movimientos_locales (historial_id) where historial_id is not null;
create index if not exists movimientos_locales_sol_idx
  on operaciones.movimientos_locales (solicitud_id) where solicitud_id is not null;

create table if not exists operaciones.cotejos_locales (
  pc_codigo text not null,
  cotejo_key text not null,
  tipo_cotejo text not null check (tipo_cotejo in ('ALTA_TELEFONO','CONCILIACION_TURNO')),
  turno_id text,
  usuario text,
  telefono text,
  usuario_declarado text,
  telefono_declarado text,
  referencia_id text,
  estado text not null default 'RESUELTO',
  detalle jsonb not null default '{}'::jsonb,
  fecha timestamptz,
  client_id uuid not null,
  instalacion text not null,
  version text not null,
  updated_at timestamptz not null default now(),
  primary key (pc_codigo, cotejo_key)
);

create index if not exists cotejos_locales_pc_usuario_idx
  on operaciones.cotejos_locales (upper(btrim(pc_codigo)), lower(btrim(coalesce(usuario,''))), fecha desc nulls last);
create index if not exists cotejos_locales_pc_turno_idx
  on operaciones.cotejos_locales (upper(btrim(pc_codigo)), turno_id) where turno_id is not null;

create table if not exists operaciones.colas_observadas_locales (
  pc_codigo text not null,
  instalacion text not null,
  cola_tipo text not null check (cola_tipo in ('CHUNIOR_PENDIENTE','CHAT_OUTBOX_ESTADO','CHAT_READ_MARK')),
  item_id text not null,
  usuario text,
  referencia_id text,
  estado text not null,
  motivo text,
  fecha timestamptz,
  client_id uuid not null,
  version text not null,
  updated_at timestamptz not null default now(),
  primary key (pc_codigo, instalacion, cola_tipo, item_id)
);

create index if not exists colas_observadas_pc_ref_idx
  on operaciones.colas_observadas_locales (upper(btrim(pc_codigo)), referencia_id);

-- Server revision is independent of operation dates. Receipts keep hashes, never private bodies.
create table if not exists operaciones.persistencia_recibos (
 pc_codigo text not null, instalacion text not null, familia text not null,
 item_key jsonb not null, mutation_id text not null, payload_hash text not null,
 revision bigint not null, accepted_at timestamptz not null default now(),
 primary key(pc_codigo,instalacion,familia,item_key,mutation_id)
);
revoke all on operaciones.persistencia_recibos from public,anon,authenticated;
alter table operaciones.persistencia_recibos enable row level security;
alter table identidad.jugadores_locales add column if not exists revision bigint not null default 1;
alter table identidad.jugadores_locales enable row level security;
alter table operaciones.movimientos_locales add column if not exists revision bigint not null default 1;
alter table operaciones.movimientos_locales enable row level security;
alter table operaciones.cotejos_locales add column if not exists revision bigint not null default 1;
alter table operaciones.cotejos_locales enable row level security;
alter table operaciones.colas_observadas_locales add column if not exists revision bigint not null default 1;
alter table operaciones.colas_observadas_locales enable row level security;

-- Vista canónica consumida automáticamente por identidad.observaciones_v1(p_pc_codigo, p_usuario).
-- Proyecta las observaciones locales con fuente, estado y fecha sin mezclar usuarios ni fabricar historia.
create or replace view identidad.observaciones_locales as
  select
    j.client_id,
    j.source_id,
    j.campo,
    j.valor,
    j.fuente,
    coalesce(j.ultima_fecha, j.primera_fecha, j.updated_at) as fecha,
    j.pc_codigo,
    j.usuario,
    j.estado
  from identidad.jugadores_locales j
  where j.campo in ('nombre','telefono','cbu')
    and j.usuario <> '*'
    and coalesce(btrim(j.valor),'') <> ''
  union all
  select
    m.client_id,
    concat('mov:', m.movimiento_key, ':', f.atributo) as source_id,
    f.campo,
    f.valor,
    'local.movimientos'::text as fuente,
    coalesce(m.fecha, m.updated_at) as fecha,
    m.pc_codigo,
    m.usuario,
    coalesce(nullif(btrim(m.estado),''), 'MOVIMIENTO_LOCAL') as estado
  from operaciones.movimientos_locales m
  cross join lateral (values
    ('titular', 'nombre', m.titular),
    ('cbu', 'cbu', case when upper(coalesce(m.tipo,''))='RETIRO' then coalesce(nullif(btrim(m.cbu),''), nullif(btrim(m.destino),'')) else null end)
  ) f(atributo, campo, valor)
  where coalesce(btrim(f.valor),'') <> ''
  union all
  select
    c.client_id,
    concat('cotejo:', c.cotejo_key) as source_id,
    'telefono'::text as campo,
    c.telefono as valor,
    'local.cotejo_alta'::text as fuente,
    coalesce(c.fecha, c.updated_at) as fecha,
    c.pc_codigo,
    c.usuario,
    concat('COTEJO_', coalesce(nullif(btrim(c.estado),''), 'RESUELTO')) as estado
  from operaciones.cotejos_locales c
  where c.tipo_cotejo = 'ALTA_TELEFONO'
    and coalesce(btrim(c.usuario),'') <> ''
    and coalesce(btrim(c.telefono),'') <> '';

revoke all on table
  identidad.jugadores_locales,
  operaciones.movimientos_locales,
  operaciones.cotejos_locales,
  operaciones.colas_observadas_locales,
  identidad.observaciones_locales
from public,anon,authenticated;

-- Caller holds the per-key lock across decision, row write and receipt in one transaction.
create or replace function operaciones.persistencia_decidir_v1(
 p_pc text,p_inst text,p_familia text,p_key jsonb,p_item jsonb,p_actual bigint
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_meta jsonb:=p_item->'_sync'; v_base bigint; v_id text; v_hash text:=md5((p_item-'_sync')::text);
 v_prev operaciones.persistencia_recibos%rowtype;
begin
 if v_meta is null then
   v_base:=0; v_id:='legacy-'||v_hash;
 elsif jsonb_typeof(v_meta)<>'object' or coalesce(v_meta->>'base_revision','') !~ '^(0|[1-9][0-9]{0,17})$'
    or length(coalesce(v_meta->>'mutation_id','')) not between 1 and 128 then
   raise exception using errcode='22023',message='BETA_INVALID_PERSISTENCE_REVISION';
 else v_base:=(v_meta->>'base_revision')::bigint;v_id:=v_meta->>'mutation_id'; end if;
 select * into v_prev from operaciones.persistencia_recibos where pc_codigo=p_pc and instalacion=p_inst
   and familia=p_familia and item_key=p_key and mutation_id=v_id;
 if found then
   if v_prev.payload_hash<>v_hash then
     return jsonb_build_object('accepted',false,'code','MUTATION_REUSED','revision',coalesce(p_actual,0)::text,'mutation_id',v_id);
   end if;
   return jsonb_build_object('accepted',true,'replay',true,'revision',v_prev.revision::text,'mutation_id',v_id);
 end if;
 if v_base<>coalesce(p_actual,0) then
   return jsonb_build_object('accepted',false,'code','REVISION_CONFLICT','revision',coalesce(p_actual,0)::text,'mutation_id',v_id);
 end if;
 insert into operaciones.persistencia_recibos(pc_codigo,instalacion,familia,item_key,mutation_id,payload_hash,revision)
 values(p_pc,p_inst,p_familia,p_key,v_id,v_hash,coalesce(p_actual,0)+1);
 return jsonb_build_object('accepted',true,'replay',false,'revision',(coalesce(p_actual,0)+1)::text,'mutation_id',v_id);
end $$;
revoke all on function operaciones.persistencia_decidir_v1(text,text,text,jsonb,jsonb,bigint) from public,anon,authenticated;

create or replace function operaciones.persistencia_sync_v1(
  p_client_id uuid,
  p_pc_codigo text,
  p_instalacion text,
  p_version text,
  p_lote jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_pc text := upper(btrim(p_pc_codigo));
  v_inst text := btrim(coalesce(p_instalacion,''));
  v_ver text := coalesce(nullif(btrim(p_version),''), 'sin-version');
  v_jug jsonb;
  v_mov jsonb;
  v_cot jsonb;
  v_col jsonb;
  v_total int := 0;
  v_item jsonb;
  v_ack_jug text[] := '{}'::text[];
  v_ack_mov text[] := '{}'::text[];
  v_ack_cot text[] := '{}'::text[];
  v_ack_col text[] := '{}'::text[];
  v_sid text;
  v_campo text;
  v_usuario text;
  v_valor text;
  v_hist_id bigint;
  v_sol_id bigint;
  v_actual bigint; v_decision jsonb; v_key jsonb;
  v_receipts jsonb:='[]'::jsonb; v_conflicts jsonb:='[]'::jsonb;
begin
  if length(v_inst) not between 1 and 128 or v_inst ~ '[[:space:]]' then
    raise exception using errcode='22023', message='BETA_INVALID_INSTALLATION';
  end if;
  if length(v_ver) > 64 then
    raise exception using errcode='22023', message='BETA_INVALID_VERSION';
  end if;
  if p_lote is null or jsonb_typeof(p_lote) <> 'object'
     or (p_lote - 'jugadores' - 'movimientos' - 'cotejos' - 'colas') <> '{}'::jsonb then
    raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_BATCH';
  end if;

  v_jug := coalesce(p_lote->'jugadores', '[]'::jsonb);
  v_mov := coalesce(p_lote->'movimientos', '[]'::jsonb);
  v_cot := coalesce(p_lote->'cotejos', '[]'::jsonb);
  v_col := coalesce(p_lote->'colas', '[]'::jsonb);

  if jsonb_typeof(v_jug) <> 'array' or jsonb_typeof(v_mov) <> 'array'
     or jsonb_typeof(v_cot) <> 'array' or jsonb_typeof(v_col) <> 'array' then
    raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_BATCH';
  end if;

  v_total := jsonb_array_length(v_jug) + jsonb_array_length(v_mov) + jsonb_array_length(v_cot) + jsonb_array_length(v_col);
  if v_total > 200 then
    raise exception using errcode='22023', message='BETA_PERSISTENCE_BATCH_TOO_LARGE';
  end if;

  -- 1. Jugadores / atributos de identidad / titulares rechazados locales
  for v_item in select value from jsonb_array_elements(v_jug) order by value->>'source_id',value->>'campo' loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;
    v_sid := btrim(coalesce(v_item->>'source_id',''));
    v_campo := lower(btrim(coalesce(v_item->>'campo','')));
    v_usuario := lower(btrim(coalesce(v_item->>'usuario','')));
    v_valor := btrim(coalesce(v_item->>'valor',''));
    if length(v_sid) not between 1 and 256
       or v_campo not in ('nombre','telefono','cbu','bono')
       or length(v_usuario) not between 1 and 128
       or length(v_valor) not between 1 and 512 then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;

    v_key:=jsonb_build_array(v_sid,v_campo);
    perform pg_advisory_xact_lock(hashtextextended(v_pc||':jugadores:'||v_key::text,0));
    select revision into v_actual from identidad.jugadores_locales where pc_codigo=v_pc and source_id=v_sid and campo=v_campo;
    v_decision:=operaciones.persistencia_decidir_v1(v_pc,v_inst,'jugadores',v_key,v_item,v_actual);
    v_decision:=v_decision||jsonb_build_object('family','jugadores','key',v_key,'id',v_sid);
    if not (v_decision->>'accepted')::boolean then
      v_conflicts:=v_conflicts||jsonb_build_array(v_decision);continue;
    end if;
    if not (v_decision->>'replay')::boolean then
    insert into identidad.jugadores_locales (
      pc_codigo, source_id, campo, usuario, atributo, valor, fuente, estado,
      veces, verificado, titular_asociado, primera_fecha, ultima_fecha, detalle,
      client_id, instalacion, version, updated_at
    ) values (
      v_pc,
      v_sid,
      v_campo,
      v_usuario,
      coalesce(nullif(btrim(v_item->>'atributo'),''), v_campo),
      v_valor,
      coalesce(nullif(btrim(v_item->>'fuente'),''), 'local.jugadores'),
      coalesce(nullif(btrim(v_item->>'estado'),''), 'OBSERVADO_LOCAL'),
      greatest(coalesce((v_item->>'veces')::integer, 1), 1),
      coalesce((v_item->>'verificado')::boolean, false),
      nullif(btrim(v_item->>'titular_asociado'),''),
      case when coalesce(btrim(v_item->>'primera_fecha'),'') <> '' then (v_item->>'primera_fecha')::timestamptz else null end,
      case when coalesce(btrim(v_item->>'ultima_fecha'),'') <> '' then (v_item->>'ultima_fecha')::timestamptz else now() end,
      case when jsonb_typeof(v_item->'detalle') = 'object' then v_item->'detalle' else '{}'::jsonb end,
      p_client_id,
      v_inst,
      v_ver,
      now()
    )
    on conflict (pc_codigo, source_id, campo) do update set
      usuario = excluded.usuario,
      atributo = excluded.atributo,
      valor = excluded.valor,
      fuente = excluded.fuente,
      estado = excluded.estado,
      veces = greatest(identidad.jugadores_locales.veces, excluded.veces),
      verificado = (identidad.jugadores_locales.verificado or excluded.verificado),
      titular_asociado = coalesce(excluded.titular_asociado, identidad.jugadores_locales.titular_asociado),
      primera_fecha = coalesce(least(identidad.jugadores_locales.primera_fecha, excluded.primera_fecha), identidad.jugadores_locales.primera_fecha, excluded.primera_fecha),
      ultima_fecha = coalesce(greatest(identidad.jugadores_locales.ultima_fecha, excluded.ultima_fecha), excluded.ultima_fecha, identidad.jugadores_locales.ultima_fecha),
      detalle = identidad.jugadores_locales.detalle || excluded.detalle,
      client_id = excluded.client_id,
      instalacion = excluded.instalacion,
      version = excluded.version,
      updated_at = now(),
      revision = identidad.jugadores_locales.revision + 1;
    end if;
    v_receipts:=v_receipts||jsonb_build_array(v_decision);

    v_ack_jug := array_append(v_ack_jug, v_sid);
  end loop;

  -- 2. Atributos locales de movimientos y trazas paso a paso
  for v_item in select value from jsonb_array_elements(v_mov) order by value->>'movimiento_key' loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;
    v_sid := btrim(coalesce(v_item->>'movimiento_key',''));
    v_usuario := lower(btrim(coalesce(v_item->>'usuario','')));
    if length(v_sid) not between 1 and 128 or length(v_usuario) not between 1 and 128 then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;
    v_hist_id := case when coalesce(v_item->>'historial_id','') ~ '^[1-9][0-9]{0,18}$' then (v_item->>'historial_id')::bigint else null end;
    v_sol_id := case when coalesce(v_item->>'solicitud_id','') ~ '^[1-9][0-9]{0,18}$' then (v_item->>'solicitud_id')::bigint else null end;

    v_key:=jsonb_build_array(v_sid);
    perform pg_advisory_xact_lock(hashtextextended(v_pc||':movimientos:'||v_key::text,0));
    select revision into v_actual from operaciones.movimientos_locales where pc_codigo=v_pc and movimiento_key=v_sid;
    v_decision:=operaciones.persistencia_decidir_v1(v_pc,v_inst,'movimientos',v_key,v_item,v_actual);
    v_decision:=v_decision||jsonb_build_object('family','movimientos','key',v_key,'id',v_sid);
    if not (v_decision->>'accepted')::boolean then
      v_conflicts:=v_conflicts||jsonb_build_array(v_decision);continue;
    end if;
    if not (v_decision->>'replay')::boolean then
    insert into operaciones.movimientos_locales (
      pc_codigo, movimiento_key, historial_id, solicitud_id, chunior_id, usuario,
      tipo, monto, estado, titular, destino, cbu, obs, saldo_pre, saldo_post,
      billetera_nombre, operador, bono_pct, origen, notas, traza, fecha,
      client_id, instalacion, version, updated_at
    ) values (
      v_pc,
      v_sid,
      v_hist_id,
      v_sol_id,
      nullif(btrim(v_item->>'chunior_id'),''),
      v_usuario,
      nullif(upper(btrim(v_item->>'tipo')),''),
      case when coalesce(v_item->>'monto','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v_item->>'monto')::numeric else null end,
      nullif(upper(btrim(v_item->>'estado')),''),
      nullif(btrim(v_item->>'titular'),''),
      nullif(btrim(v_item->>'destino'),''),
      nullif(btrim(v_item->>'cbu'),''),
      nullif(btrim(v_item->>'obs'),''),
      case when coalesce(v_item->>'saldo_pre','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v_item->>'saldo_pre')::numeric else null end,
      case when coalesce(v_item->>'saldo_post','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v_item->>'saldo_post')::numeric else null end,
      nullif(btrim(v_item->>'billetera_nombre'),''),
      nullif(btrim(v_item->>'operador'),''),
      case when coalesce(v_item->>'bono_pct','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v_item->>'bono_pct')::numeric else null end,
      nullif(upper(btrim(v_item->>'origen')),''),
      nullif(btrim(v_item->>'notas'),''),
      case when jsonb_typeof(v_item->'traza') = 'object' then v_item->'traza' else null end,
      case when coalesce(btrim(v_item->>'fecha'),'') <> '' then (v_item->>'fecha')::timestamptz else now() end,
      p_client_id,
      v_inst,
      v_ver,
      now()
    )
    on conflict (pc_codigo, movimiento_key) do update set
      historial_id = coalesce(excluded.historial_id, operaciones.movimientos_locales.historial_id),
      solicitud_id = coalesce(excluded.solicitud_id, operaciones.movimientos_locales.solicitud_id),
      chunior_id = coalesce(excluded.chunior_id, operaciones.movimientos_locales.chunior_id),
      usuario = excluded.usuario,
      tipo = coalesce(excluded.tipo, operaciones.movimientos_locales.tipo),
      monto = coalesce(excluded.monto, operaciones.movimientos_locales.monto),
      estado = coalesce(excluded.estado, operaciones.movimientos_locales.estado),
      titular = coalesce(excluded.titular, operaciones.movimientos_locales.titular),
      destino = coalesce(excluded.destino, operaciones.movimientos_locales.destino),
      cbu = coalesce(excluded.cbu, operaciones.movimientos_locales.cbu),
      obs = coalesce(excluded.obs, operaciones.movimientos_locales.obs),
      saldo_pre = coalesce(excluded.saldo_pre, operaciones.movimientos_locales.saldo_pre),
      saldo_post = coalesce(excluded.saldo_post, operaciones.movimientos_locales.saldo_post),
      billetera_nombre = coalesce(excluded.billetera_nombre, operaciones.movimientos_locales.billetera_nombre),
      operador = coalesce(excluded.operador, operaciones.movimientos_locales.operador),
      bono_pct = coalesce(excluded.bono_pct, operaciones.movimientos_locales.bono_pct),
      origen = coalesce(excluded.origen, operaciones.movimientos_locales.origen),
      notas = coalesce(excluded.notas, operaciones.movimientos_locales.notas),
      traza = coalesce(excluded.traza, operaciones.movimientos_locales.traza),
      fecha = coalesce(excluded.fecha, operaciones.movimientos_locales.fecha),
      client_id = excluded.client_id,
      instalacion = excluded.instalacion,
      version = excluded.version,
      updated_at = now(),
      revision = operaciones.movimientos_locales.revision + 1;
    end if;
    v_receipts:=v_receipts||jsonb_build_array(v_decision);

    v_ack_mov := array_append(v_ack_mov, v_sid);
  end loop;

  -- 3. Cotejos por alta y por turno
  for v_item in select value from jsonb_array_elements(v_cot) order by value->>'cotejo_key' loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;
    v_sid := btrim(coalesce(v_item->>'cotejo_key',''));
    v_campo := upper(btrim(coalesce(v_item->>'tipo_cotejo','')));
    if length(v_sid) not between 1 and 256 or v_campo not in ('ALTA_TELEFONO','CONCILIACION_TURNO') then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;

    v_key:=jsonb_build_array(v_sid);
    perform pg_advisory_xact_lock(hashtextextended(v_pc||':cotejos:'||v_key::text,0));
    select revision into v_actual from operaciones.cotejos_locales where pc_codigo=v_pc and cotejo_key=v_sid;
    v_decision:=operaciones.persistencia_decidir_v1(v_pc,v_inst,'cotejos',v_key,v_item,v_actual);
    v_decision:=v_decision||jsonb_build_object('family','cotejos','key',v_key,'id',v_sid);
    if not (v_decision->>'accepted')::boolean then
      v_conflicts:=v_conflicts||jsonb_build_array(v_decision);continue;
    end if;
    if not (v_decision->>'replay')::boolean then
    insert into operaciones.cotejos_locales (
      pc_codigo, cotejo_key, tipo_cotejo, turno_id, usuario, telefono,
      usuario_declarado, telefono_declarado, referencia_id, estado, detalle, fecha,
      client_id, instalacion, version, updated_at
    ) values (
      v_pc,
      v_sid,
      v_campo,
      nullif(btrim(v_item->>'turno_id'),''),
      nullif(lower(btrim(v_item->>'usuario')),''),
      nullif(btrim(v_item->>'telefono'),''),
      nullif(lower(btrim(v_item->>'usuario_declarado')),''),
      nullif(btrim(v_item->>'telefono_declarado'),''),
      nullif(btrim(v_item->>'referencia_id'),''),
      coalesce(nullif(upper(btrim(v_item->>'estado')),''), 'RESUELTO'),
      case when jsonb_typeof(v_item->'detalle') = 'object' then v_item->'detalle' else '{}'::jsonb end,
      case when coalesce(btrim(v_item->>'fecha'),'') <> '' then (v_item->>'fecha')::timestamptz else now() end,
      p_client_id,
      v_inst,
      v_ver,
      now()
    )
    on conflict (pc_codigo, cotejo_key) do update set
      turno_id = coalesce(excluded.turno_id, operaciones.cotejos_locales.turno_id),
      usuario = coalesce(excluded.usuario, operaciones.cotejos_locales.usuario),
      telefono = coalesce(excluded.telefono, operaciones.cotejos_locales.telefono),
      usuario_declarado = coalesce(excluded.usuario_declarado, operaciones.cotejos_locales.usuario_declarado),
      telefono_declarado = coalesce(excluded.telefono_declarado, operaciones.cotejos_locales.telefono_declarado),
      referencia_id = coalesce(excluded.referencia_id, operaciones.cotejos_locales.referencia_id),
      estado = excluded.estado,
      detalle = operaciones.cotejos_locales.detalle || excluded.detalle,
      fecha = coalesce(excluded.fecha, operaciones.cotejos_locales.fecha),
      client_id = excluded.client_id,
      instalacion = excluded.instalacion,
      version = excluded.version,
      updated_at = now(),
      revision = operaciones.cotejos_locales.revision + 1;
    end if;
    v_receipts:=v_receipts||jsonb_build_array(v_decision);

    v_ack_cot := array_append(v_ack_cot, v_sid);
  end loop;

  -- 4. Colas locales observadas (diagnóstico / recibos de lectura; nunca re-ejecutan efectos)
  for v_item in select value from jsonb_array_elements(v_col) order by value->>'cola_tipo',value->>'item_id' loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;
    v_campo := upper(btrim(coalesce(v_item->>'cola_tipo','')));
    v_sid := btrim(coalesce(v_item->>'item_id',''));
    if v_campo not in ('CHUNIOR_PENDIENTE','CHAT_OUTBOX_ESTADO','CHAT_READ_MARK')
       or length(v_sid) not between 1 and 256 then
      raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_ITEM';
    end if;

    v_key:=jsonb_build_array(v_inst,v_campo,v_sid);
    perform pg_advisory_xact_lock(hashtextextended(v_pc||':colas:'||v_key::text,0));
    select revision into v_actual from operaciones.colas_observadas_locales where pc_codigo=v_pc and instalacion=v_inst and cola_tipo=v_campo and item_id=v_sid;
    v_decision:=operaciones.persistencia_decidir_v1(v_pc,v_inst,'colas',v_key,v_item,v_actual);
    v_decision:=v_decision||jsonb_build_object('family','colas','key',v_key,'id',v_sid);
    if not (v_decision->>'accepted')::boolean then
      v_conflicts:=v_conflicts||jsonb_build_array(v_decision);continue;
    end if;
    if not (v_decision->>'replay')::boolean then
    insert into operaciones.colas_observadas_locales (
      pc_codigo, instalacion, cola_tipo, item_id, usuario, referencia_id,
      estado, motivo, fecha, client_id, version, updated_at
    ) values (
      v_pc,
      v_inst,
      v_campo,
      v_sid,
      nullif(lower(btrim(v_item->>'usuario')),''),
      nullif(btrim(v_item->>'referencia_id'),''),
      coalesce(nullif(upper(btrim(v_item->>'estado')),''), 'PENDIENTE'),
      left(btrim(coalesce(v_item->>'motivo','')), 240),
      case when coalesce(btrim(v_item->>'fecha'),'') <> '' then (v_item->>'fecha')::timestamptz else now() end,
      p_client_id,
      v_ver,
      now()
    )
    on conflict (pc_codigo, instalacion, cola_tipo, item_id) do update set
      usuario = coalesce(excluded.usuario, operaciones.colas_observadas_locales.usuario),
      referencia_id = coalesce(excluded.referencia_id, operaciones.colas_observadas_locales.referencia_id),
      estado = excluded.estado,
      motivo = excluded.motivo,
      fecha = coalesce(excluded.fecha, operaciones.colas_observadas_locales.fecha),
      client_id = excluded.client_id,
      version = excluded.version,
      updated_at = now(),
      revision = operaciones.colas_observadas_locales.revision + 1;
    end if;
    v_receipts:=v_receipts||jsonb_build_array(v_decision);

    v_ack_col := array_append(v_ack_col, v_sid);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'contract', 'nodo.beta.v1',
    'scope', jsonb_build_object('pc_codigo', v_pc, 'instalacion', v_inst, 'version', v_ver),
    'protocol','persistence.cas.v1',
    'receipts',v_receipts,'conflicts',v_conflicts,
    'acknowledged', jsonb_build_object(
      'jugadores', to_jsonb(v_ack_jug),
      'movimientos', to_jsonb(v_ack_mov),
      'cotejos', to_jsonb(v_ack_cot),
      'colas', to_jsonb(v_ack_col)
    ),
    'accepted_total', coalesce(cardinality(v_ack_jug),0) + coalesce(cardinality(v_ack_mov),0) + coalesce(cardinality(v_ack_cot),0) + coalesce(cardinality(v_ack_col),0),
    'synced_at', now()
  );
end $$;

create or replace function operaciones.persistencia_leer_v1(
  p_pc_codigo text,
  p_usuario text default null,
  p_referencia_id text default null,
  p_tipo text default 'TODO',
  p_limit integer default 100,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_pc text := upper(btrim(p_pc_codigo));
  v_pcs text[];
  v_u text := nullif(lower(btrim(coalesce(p_usuario,''))),'');
  v_ref text := nullif(btrim(coalesce(p_referencia_id,'')),'');
  v_tipo text := upper(btrim(coalesce(nullif(btrim(p_tipo),''), 'TODO')));
  v_jug jsonb := '[]'::jsonb;
  v_mov jsonb := '[]'::jsonb;
  v_cot jsonb := '[]'::jsonb;
  v_col jsonb := '[]'::jsonb;
  v_scope jsonb; v_pos jsonb; v_next jsonb; v_more boolean:=false; v_last jsonb; v_family text; v_len int;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode='22023', message='BETA_INVALID_LIMIT';
  end if;
  if v_tipo not in ('TODO','JUGADORES','MOVIMIENTOS','COTEJOS','COLAS') then
    raise exception using errcode='22023', message='BETA_INVALID_PERSISTENCE_TYPE';
  end if;
  v_pcs := acceso.oficinas_autorizadas(v_pc);
  v_scope:=jsonb_build_object('pc_codigo',v_pc,'pc_codigos',v_pcs,'usuario',v_u,'referencia_id',v_ref,'tipo',v_tipo);
  if p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or p_cursor->>'version' is distinct from '1'
    or p_cursor->'scope' is distinct from v_scope or jsonb_typeof(p_cursor->'positions') is distinct from 'object'
    or jsonb_typeof(p_cursor->'done') is distinct from 'object') then
    raise exception using errcode='22023',message='BETA_INVALID_PERSISTENCE_CURSOR';
  end if;
  v_next:=coalesce(p_cursor,jsonb_build_object('version',1,'scope',v_scope,'positions','{}'::jsonb,'done','{}'::jsonb));
  for v_family,v_len in select * from (values ('jugadores',3),('movimientos',2),('cotejos',2),('colas',4)) f(family,n) loop
    v_pos:=p_cursor->'positions'->v_family;
    if v_pos is not null and (jsonb_typeof(v_pos)<>'array') then
      raise exception using errcode='22023',message='BETA_INVALID_PERSISTENCE_CURSOR';
    end if;
    if v_pos is not null and (jsonb_array_length(v_pos)<>v_len
      or exists(select 1 from jsonb_array_elements(v_pos) x where jsonb_typeof(x)<>'string')
      or not ((v_pos->>0)=any(v_pcs))) then
      raise exception using errcode='22023',message='BETA_INVALID_PERSISTENCE_CURSOR';
    end if;
    if p_cursor->'done' ? v_family and jsonb_typeof(p_cursor->'done'->v_family)<>'boolean' then
      raise exception using errcode='22023',message='BETA_INVALID_PERSISTENCE_CURSOR';
    end if;
  end loop;

  if v_tipo in ('TODO','JUGADORES') and not coalesce((v_next->'done'->>'jugadores')::boolean,false) then
    v_pos:=v_next->'positions'->'jugadores';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.pc_codigo, x.source_id, x.campo), '[]'::jsonb)
    into v_jug
    from (
      select j.pc_codigo, j.source_id, j.campo, j.usuario, j.atributo, j.valor, j.fuente, j.estado,
             j.veces, j.verificado, j.titular_asociado, j.primera_fecha, j.ultima_fecha, j.detalle,
             j.instalacion, j.version, j.updated_at, j.revision::text as revision
      from identidad.jugadores_locales j
      where upper(btrim(j.pc_codigo)) = any(v_pcs)
        and (v_u is null or lower(btrim(j.usuario)) = v_u or j.usuario = '*')
        and (v_ref is null or j.source_id = v_ref or j.valor = v_ref)
      and (v_pos is null or (j.pc_codigo, j.source_id, j.campo) > (v_pos->>0, v_pos->>1, v_pos->>2))
      order by j.pc_codigo, j.source_id, j.campo
      limit p_limit+1
    ) x;

    if jsonb_array_length(v_jug)>p_limit then
      select jsonb_agg(value order by ord) into v_jug from jsonb_array_elements(v_jug) with ordinality e(value,ord) where ord<=p_limit;
      v_more:=true;
      v_last:=v_jug->(jsonb_array_length(v_jug)-1);
      v_next:=jsonb_set(v_next,array['positions','jugadores'],jsonb_build_array(v_last->'pc_codigo', v_last->'source_id', v_last->'campo'));
    else
      v_next:=jsonb_set(v_next,array['done','jugadores'],'true'::jsonb);
    end if;
  end if;

  if v_tipo in ('TODO','MOVIMIENTOS') and not coalesce((v_next->'done'->>'movimientos')::boolean,false) then
    v_pos:=v_next->'positions'->'movimientos';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.pc_codigo, x.movimiento_key), '[]'::jsonb)
    into v_mov
    from (
      select m.pc_codigo, m.movimiento_key, m.historial_id::text as historial_id, m.solicitud_id::text as solicitud_id,
             m.chunior_id, m.usuario, m.tipo, m.monto, m.estado, m.titular, m.destino, m.cbu, m.obs,
             m.saldo_pre, m.saldo_post, m.billetera_nombre, m.operador, m.bono_pct, m.origen, m.notas,
             m.traza, m.fecha, m.instalacion, m.version, m.updated_at, m.revision::text as revision
      from operaciones.movimientos_locales m
      where upper(btrim(m.pc_codigo)) = any(v_pcs)
        and (v_u is null or lower(btrim(m.usuario)) = v_u)
        and (v_ref is null or m.movimiento_key = v_ref or m.historial_id::text = v_ref or m.solicitud_id::text = v_ref or m.chunior_id = v_ref)
      and (v_pos is null or (m.pc_codigo, m.movimiento_key) > (v_pos->>0, v_pos->>1))
      order by m.pc_codigo, m.movimiento_key
      limit p_limit+1
    ) x;

    if jsonb_array_length(v_mov)>p_limit then
      select jsonb_agg(value order by ord) into v_mov from jsonb_array_elements(v_mov) with ordinality e(value,ord) where ord<=p_limit;
      v_more:=true;
      v_last:=v_mov->(jsonb_array_length(v_mov)-1);
      v_next:=jsonb_set(v_next,array['positions','movimientos'],jsonb_build_array(v_last->'pc_codigo', v_last->'movimiento_key'));
    else
      v_next:=jsonb_set(v_next,array['done','movimientos'],'true'::jsonb);
    end if;
  end if;

  if v_tipo in ('TODO','COTEJOS') and not coalesce((v_next->'done'->>'cotejos')::boolean,false) then
    v_pos:=v_next->'positions'->'cotejos';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.pc_codigo, x.cotejo_key), '[]'::jsonb)
    into v_cot
    from (
      select c.pc_codigo, c.cotejo_key, c.tipo_cotejo, c.turno_id, c.usuario, c.telefono,
             c.usuario_declarado, c.telefono_declarado, c.referencia_id, c.estado, c.detalle,
             c.fecha, c.instalacion, c.version, c.updated_at, c.revision::text as revision
      from operaciones.cotejos_locales c
      where upper(btrim(c.pc_codigo)) = any(v_pcs)
        and (v_u is null or lower(btrim(coalesce(c.usuario,''))) = v_u or lower(btrim(coalesce(c.usuario_declarado,''))) = v_u)
        and (v_ref is null or c.cotejo_key = v_ref or c.turno_id = v_ref or c.referencia_id = v_ref)
      and (v_pos is null or (c.pc_codigo, c.cotejo_key) > (v_pos->>0, v_pos->>1))
      order by c.pc_codigo, c.cotejo_key
      limit p_limit+1
    ) x;

    if jsonb_array_length(v_cot)>p_limit then
      select jsonb_agg(value order by ord) into v_cot from jsonb_array_elements(v_cot) with ordinality e(value,ord) where ord<=p_limit;
      v_more:=true;
      v_last:=v_cot->(jsonb_array_length(v_cot)-1);
      v_next:=jsonb_set(v_next,array['positions','cotejos'],jsonb_build_array(v_last->'pc_codigo', v_last->'cotejo_key'));
    else
      v_next:=jsonb_set(v_next,array['done','cotejos'],'true'::jsonb);
    end if;
  end if;

  if v_tipo in ('TODO','COLAS') and not coalesce((v_next->'done'->>'colas')::boolean,false) then
    v_pos:=v_next->'positions'->'colas';
    select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('re_ejecutar', false) order by x.pc_codigo, x.instalacion, x.cola_tipo, x.item_id), '[]'::jsonb)
    into v_col
    from (
      select q.pc_codigo, q.instalacion, q.cola_tipo, q.item_id, q.usuario, q.referencia_id,
             q.estado, q.motivo, q.fecha, q.version, q.updated_at, q.revision::text as revision
      from operaciones.colas_observadas_locales q
      where upper(btrim(q.pc_codigo)) = any(v_pcs)
        and (v_u is null or lower(btrim(coalesce(q.usuario,''))) = v_u)
        and (v_ref is null or q.item_id = v_ref or q.referencia_id = v_ref)
      and (v_pos is null or (q.pc_codigo, q.instalacion, q.cola_tipo, q.item_id) > (v_pos->>0, v_pos->>1, v_pos->>2, v_pos->>3))
      order by q.pc_codigo, q.instalacion, q.cola_tipo, q.item_id
      limit p_limit+1
    ) x;

    if jsonb_array_length(v_col)>p_limit then
      select jsonb_agg(value order by ord) into v_col from jsonb_array_elements(v_col) with ordinality e(value,ord) where ord<=p_limit;
      v_more:=true;
      v_last:=v_col->(jsonb_array_length(v_col)-1);
      v_next:=jsonb_set(v_next,array['positions','colas'],jsonb_build_array(v_last->'pc_codigo', v_last->'instalacion', v_last->'cola_tipo', v_last->'item_id'));
    else
      v_next:=jsonb_set(v_next,array['done','colas'],'true'::jsonb);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'contract', 'nodo.beta.v1',
    'scope', v_scope, 'protocol','persistence.cas.v1',
    'has_more',v_more,'next_cursor',case when v_more then v_next else null end,
    'jugadores', v_jug,
    'movimientos', v_mov,
    'cotejos', v_cot,
    'colas_observadas', v_col
  );
end $$;

create or replace function public.nodo_beta_persistencia_sync_v1(
  p_token text,
  p_pc_codigo text,
  p_instalacion text,
  p_version text,
  p_lote jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_client_id uuid;
begin
  v_client_id := acceso.autorizar(p_token, p_pc_codigo);
  return operaciones.persistencia_sync_v1(v_client_id, p_pc_codigo, p_instalacion, p_version, p_lote);
end $$;

create or replace function public.nodo_beta_persistencia_leer_v1(
  p_token text,
  p_pc_codigo text,
  p_usuario text default null,
  p_referencia_id text default null,
  p_tipo text default 'TODO',
  p_limit integer default 100,
  p_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform acceso.autorizar(p_token, p_pc_codigo);
  return operaciones.persistencia_leer_v1(p_pc_codigo, p_usuario, p_referencia_id, p_tipo, p_limit, p_cursor);
end $$;

revoke all on function
  operaciones.persistencia_sync_v1(uuid,text,text,text,jsonb),
  operaciones.persistencia_leer_v1(text,text,text,text,integer,jsonb),
  public.nodo_beta_persistencia_sync_v1(text,text,text,text,jsonb),
  public.nodo_beta_persistencia_leer_v1(text,text,text,text,text,integer,jsonb)
from public,anon,authenticated;

grant execute on function
  public.nodo_beta_persistencia_sync_v1(text,text,text,text,jsonb),
  public.nodo_beta_persistencia_leer_v1(text,text,text,text,text,integer,jsonb)
to anon,authenticated;

