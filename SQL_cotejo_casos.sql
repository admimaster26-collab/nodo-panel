-- ════════════════════════════════════════════════════════════════════════════
-- COTEJO Y AJUSTE ASISTIDO · cases + allocations + log inmutable
-- Doc de referencia: diferencia = saldo_real_banco − saldo_chunior
--   >0 sobra → DEPO S/RECLAMAR · <0 falta → ERROR/FALTANTE · sin tercer contador.
-- Los casos viven y se cruzan SOLO dentro del turno (22-06 / 06-14 / 14-22);
-- a fin de turno lo no resuelto pasa a ESCALADA (lo ve el superior).
-- El panel llama estos RPC con p_secret = window.PANEL_DATA_SECRET.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tablas ──────────────────────────────────────────────────────────────────
create table if not exists cotejo_casos (
  case_id          bigint generated always as identity primary key,
  pc_codigo        text not null,
  turno_id         text not null,              -- YYYY-MM-DD_22-06 (anclado al día que ARRANCA el turno)
  snapshot_id      text,
  wallet_id        text not null,
  wallet_nombre    text,
  tipo             text not null check (tipo in ('FALTANTE','SOBRANTE')),
  monto_original   numeric not null,
  monto_disponible numeric not null,
  estado           text not null default 'ABIERTA' check (estado in
    ('ABIERTA','SUGERENCIA_ENCONTRADA','PARCIAL_ASIGNADA','AJUSTANDO',
     'APLICACION_PARCIAL','RESUELTA','ESCALADA','ANULADA')),
  operador         text,
  observaciones    text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
create index if not exists cotejo_casos_turno_idx on cotejo_casos (pc_codigo, turno_id);

create table if not exists cotejo_asignaciones (
  allocation_id bigint generated always as identity primary key,
  case_id       bigint not null references cotejo_casos(case_id),
  tipo          text not null,   -- MOVER_RETIRO | ASIGNAR_DEPO | CREAR_DEPO | COMBINACION | MANUAL
  monto         numeric not null,
  referencia    text,            -- chunior_movimiento_id / case_id par / id depo
  detalle       text,
  operador      text,
  created_at    timestamptz not null default now()
);

-- Log INMUTABLE: solo INSERT (auditoría de quién movió cada peso).
create table if not exists cotejo_log (
  log_id        bigint generated always as identity primary key,
  case_id       bigint,
  allocation_id bigint,
  pc_codigo     text,
  accion        text not null,   -- CREAR | ESTADO | ASIGNAR | ESCALAR | ANULAR | APLICAR_CHUNIOR | NOTA
  detalle       jsonb,
  operador      text,
  created_at    timestamptz not null default now()
);
revoke update, delete on cotejo_log from anon, authenticated;

-- RLS deny-all: el acceso es SOLO vía RPC (security definer + secreto).
alter table cotejo_casos        enable row level security;
alter table cotejo_asignaciones enable row level security;
alter table cotejo_log          enable row level security;

-- ── Helper de secreto (mismo valor que window.PANEL_DATA_SECRET del panel) ──
create or replace function _cotejo_check_secret(p_secret text) returns void
language plpgsql security definer as $$
begin
  if p_secret is distinct from 'nodo-panel-data-2026' then   -- ← cambiar si la oficina usa otro secreto
    raise exception 'secret invalido';
  end if;
end $$;

-- ── RPCs ────────────────────────────────────────────────────────────────────
-- Crear casos en LOTE (un solo llamado por declaración; criterio: no llamar de más).
-- p_casos: [{wallet_id, wallet_nombre, tipo, monto, snapshot_id, observaciones}]
create or replace function panel_cotejo_crear_casos(
  p_secret text, p_pc_codigo text, p_turno_id text, p_operador text, p_casos jsonb
) returns jsonb language plpgsql security definer as $$
declare v jsonb; ids bigint[] := '{}'; nid bigint;
begin
  perform _cotejo_check_secret(p_secret);
  for v in select * from jsonb_array_elements(coalesce(p_casos,'[]'::jsonb)) loop
    insert into cotejo_casos (pc_codigo, turno_id, snapshot_id, wallet_id, wallet_nombre, tipo,
                              monto_original, monto_disponible, operador, observaciones)
    values (p_pc_codigo, p_turno_id, v->>'snapshot_id', v->>'wallet_id', v->>'wallet_nombre',
            v->>'tipo', (v->>'monto')::numeric, (v->>'monto')::numeric, p_operador, v->>'observaciones')
    returning case_id into nid;
    ids := ids || nid;
    insert into cotejo_log (case_id, pc_codigo, accion, detalle, operador)
    values (nid, p_pc_codigo, 'CREAR', v, p_operador);
  end loop;
  return jsonb_build_object('ok', true, 'case_ids', to_jsonb(ids));
end $$;

-- Listar casos + asignaciones del turno.
create or replace function panel_cotejo_listar(p_secret text, p_pc_codigo text, p_turno_id text)
returns jsonb language plpgsql security definer as $$
declare casos jsonb; asigs jsonb;
begin
  perform _cotejo_check_secret(p_secret);
  select coalesce(jsonb_agg(to_jsonb(c) order by c.case_id),'[]'::jsonb) into casos
    from cotejo_casos c where c.pc_codigo=p_pc_codigo and c.turno_id=p_turno_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.allocation_id),'[]'::jsonb) into asigs
    from cotejo_asignaciones a join cotejo_casos c on c.case_id=a.case_id
   where c.pc_codigo=p_pc_codigo and c.turno_id=p_turno_id;
  return jsonb_build_object('ok', true, 'casos', casos, 'asignaciones', asigs);
end $$;

-- Cambiar estado (con log automático). p_monto_disponible opcional (null = no tocar).
create or replace function panel_cotejo_actualizar(
  p_secret text, p_case_id bigint, p_estado text, p_monto_disponible numeric,
  p_observaciones text, p_operador text
) returns jsonb language plpgsql security definer as $$
begin
  perform _cotejo_check_secret(p_secret);
  update cotejo_casos set
    estado = coalesce(p_estado, estado),
    monto_disponible = coalesce(p_monto_disponible, monto_disponible),
    observaciones = coalesce(p_observaciones, observaciones),
    resolved_at = case when p_estado in ('RESUELTA','ANULADA') then now() else resolved_at end
  where case_id = p_case_id;
  insert into cotejo_log (case_id, accion, detalle, operador)
  values (p_case_id, 'ESTADO', jsonb_build_object('estado',p_estado,'monto_disponible',p_monto_disponible,'obs',p_observaciones), p_operador);
  return jsonb_build_object('ok', true);
end $$;

-- Asignar (inmutabilidad: el caso NO se edita destructivamente — se descuenta el disponible).
create or replace function panel_cotejo_asignar(
  p_secret text, p_case_id bigint, p_tipo text, p_monto numeric,
  p_referencia text, p_detalle text, p_operador text
) returns jsonb language plpgsql security definer as $$
declare aid bigint; disp numeric;
begin
  perform _cotejo_check_secret(p_secret);
  select monto_disponible into disp from cotejo_casos where case_id=p_case_id for update;
  if disp is null then return jsonb_build_object('ok',false,'error','caso inexistente'); end if;
  if p_monto > disp then return jsonb_build_object('ok',false,'error','monto mayor al disponible'); end if;
  insert into cotejo_asignaciones (case_id, tipo, monto, referencia, detalle, operador)
  values (p_case_id, p_tipo, p_monto, p_referencia, p_detalle, p_operador) returning allocation_id into aid;
  update cotejo_casos set
    monto_disponible = disp - p_monto,
    estado = case when disp - p_monto <= 0 then 'RESUELTA' else 'PARCIAL_ASIGNADA' end,
    resolved_at = case when disp - p_monto <= 0 then now() else resolved_at end
  where case_id = p_case_id;
  insert into cotejo_log (case_id, allocation_id, accion, detalle, operador)
  values (p_case_id, aid, 'ASIGNAR', jsonb_build_object('tipo',p_tipo,'monto',p_monto,'ref',p_referencia,'detalle',p_detalle), p_operador);
  return jsonb_build_object('ok', true, 'allocation_id', aid, 'monto_disponible', disp - p_monto);
end $$;

-- Fin de turno: lo ABIERTO/PARCIAL del turno pasa a ESCALADA (para el superior).
create or replace function panel_cotejo_escalar_turno(p_secret text, p_pc_codigo text, p_turno_id text, p_operador text)
returns jsonb language plpgsql security definer as $$
declare n int;
begin
  perform _cotejo_check_secret(p_secret);
  update cotejo_casos set estado='ESCALADA'
   where pc_codigo=p_pc_codigo and turno_id=p_turno_id
     and estado in ('ABIERTA','SUGERENCIA_ENCONTRADA','PARCIAL_ASIGNADA','AJUSTANDO','APLICACION_PARCIAL');
  get diagnostics n = row_count;
  insert into cotejo_log (pc_codigo, accion, detalle, operador)
  values (p_pc_codigo, 'ESCALAR', jsonb_build_object('turno',p_turno_id,'casos',n), p_operador);
  return jsonb_build_object('ok', true, 'escalados', n);
end $$;
