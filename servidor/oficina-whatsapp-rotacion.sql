-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- LA LÍNEA DE WHATSAPP DE LA OFICINA · rotación, confirmación y señal (13/11)
--
-- El Portal muestra un botón de WhatsApp con la línea de la oficina. Si esa línea se cae, el
-- botón sigue ahí y manda a un número muerto: el jugador escribe y nadie le contesta. Esto es
-- lo que decide, en cada momento, qué número va en la página y a quién hay que preguntarle algo.
--
-- ── LO QUE WTK PUEDE Y LO QUE NO ───────────────────────────────────────────────────────────
-- Verificado contra la API el 13/11 con la sonda (servidor/edge-functions/whaticket-sonda-lineas.ts):
--   GET /whatsapps  →  id, name, status, channel   ·  y NADA MÁS
--   GET /whatsapps/:id, /whatsapps/:id/session, /whatsapp/:id, /settings  →  404
--   GET /tickets, /queues, /users  →  401 ERR_INSUFFICIENT_PERMISSION
-- O sea: WTK dice cuántas líneas hay, cómo se llaman y cuál está arriba. El TELÉFONO de cada
-- línea no está en la API. Tampoco llega por el webhook (whaticket_eventos está vacía: nunca
-- se configuró). Y los nombres son etiquetas, no números: en P4 son PRINCIPAL 1, SOPORTE 2…
--
-- Por eso el número de cada línea se carga UNA VEZ, a mano, y queda guardado en
-- whaticket_lineas.numero con numero_origen='OPERADOR'. Es la única pieza que no se puede
-- averiguar sola. De ahí en adelante todo lo demás sale solo: con 4 líneas activas que tengan
-- número cargado, la rotación ya se hace sin preguntarle nada a nadie.
--
-- ── LO QUE DECIDE ──────────────────────────────────────────────────────────────────────────
-- panel_oficina_wsp_estado contesta, de una lectura, qué hay que hacer ahora (campo `pide`):
--
--   WTK contesta · ≥4 activas con número · la de la página está arriba  → NADA
--   WTK contesta · la línea de la página se cayó · hay otra activa      → ROTAR (sola)
--   WTK contesta · el número de la página no es ninguna línea           → NADA para el operador;
--                                                                         señal interna colgada
--   WTK contesta · la página tiene número y nadie dijo de qué línea es  → MAPEAR (un clic)
--   WTK no contesta · no hay número                                     → CARGAR_NUMERO
--   WTK no contesta · hay número · es el turno que toca hoy             → CONFIRMAR
--   WTK no contesta · hay número · no es el turno                       → NADA
--
-- "WTK no contesta" = la oficina no tiene ninguna línea registrada, o el último barrido es de
-- hace más de 25 minutos (el mismo umbral que ya usa panel_lineas_estado para `datos_viejos`;
-- el monitor corre cada 10).
--
-- ── POR QUÉ UN TURNO POR DÍA Y NO UNA VEZ POR TURNO ────────────────────────────────────────
-- Pedido de Juan: sin WTK hace falta una constancia de que el número sigue vivo, pero preguntar
-- en los tres turnos todos los días es saturar al operador. Entonces se pregunta UNA vez por
-- día, y el turno al que le toca rota: un día a la mañana, al otro a la tarde, al otro a la
-- noche. Así en tres días pasó por los tres equipos y nadie recibe la pregunta dos veces seguidas.
-- El botón de confirmar NO existe cuando no toca: que esté siempre lo convierte en un adorno
-- que se clickea sin mirar, y lo que queremos es una constancia real.
-- Turnos: mañana 06–14, tarde 14–22, noche 22–06 (hora de Argentina).
--
-- ── LA SEÑAL QUE QUEDA COLGADA ─────────────────────────────────────────────────────────────
-- Si la oficina tiene WTK y el número de la página no es ninguna de sus líneas, eso no lo
-- arregla el operador: puede ser un número de otra oficina, uno viejo, o una línea que WTK ya
-- no maneja. Queda un aviso en nodo_avisos_internos y nada más: no frena nada, no molesta a
-- nadie, no se le muestra al operador. Lo mira quien quiera (el admi, o cualquier IA que lea
-- nodo_avisos_abiertos) y avisa. Pedido explícito de Juan: por ahora lo dejamos ahí colgado.
-- Un aviso abierto no se duplica: el índice único por (oficina, tipo, huella) hace que la
-- misma situación sume `veces` en vez de llenar la tabla cada 5 minutos.
--
-- Foto previa (13/11): no existe ninguna tabla de avisos/señales/alertas, ni oficina_wsp_*,
-- ni panel_oficina_wsp_*, ni panel_oficina_whatsapp_registrar, ni nodo_turno_actual.
-- whaticket_lineas ya tiene numero/numero_crudo (servidor/oficina-whatsapp-wtk.sql).
-- WTK vivo en P2, P3, P4, P5. 10 de 15 rutas con whatsapp_numero cargado.
-- Vuelta atrás: servidor/oficina-whatsapp-rotacion-vuelta-atras.sql. Responsable: Juan.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ══ De dónde salió el número de cada línea
alter table public.whaticket_lineas add column if not exists numero_origen text;
alter table public.whaticket_lineas add column if not exists numero_por    text;
alter table public.whaticket_lineas add column if not exists numero_at     timestamptz;

comment on column public.whaticket_lineas.numero_origen is 'OPERADOR (lo cargó alguien en NODO) o WTK (vino en la API). Hoy la API no lo da, así que siempre es OPERADOR.';

-- ══ Avisos internos: la bandeja de señales que nadie tiene obligación de atender
create table if not exists public.nodo_avisos_internos (
  id              bigserial primary key,
  pc_codigo       text        not null,
  tipo            text        not null,
  -- Identifica el caso. Mientras no cambie, el mismo aviso no se duplica: suma veces.
  huella          text        not null,
  detalle         jsonb       not null default '{}'::jsonb,
  creado_at       timestamptz not null default now(),
  visto_ultima_at timestamptz not null default now(),
  veces           integer     not null default 1,
  tomado_por      text,
  tomado_at       timestamptz,
  resuelto_at     timestamptz,
  nota            text
);

comment on table public.nodo_avisos_internos is
  'Señales internas que no frenan nada y no se le muestran al operador. Las lee quien quiera (admi o una IA) por nodo_avisos_abiertos. Un aviso abierto no se duplica: suma veces.';

create unique index if not exists nodo_avisos_internos_abierto_idx
  on public.nodo_avisos_internos (pc_codigo, tipo, huella) where resuelto_at is null;
create index if not exists nodo_avisos_internos_tipo_idx
  on public.nodo_avisos_internos (tipo, creado_at desc) where resuelto_at is null;

alter table public.nodo_avisos_internos enable row level security;

create or replace view public.nodo_avisos_abiertos as
  select a.id, a.pc_codigo, a.tipo, a.detalle, a.creado_at, a.visto_ultima_at, a.veces,
         a.tomado_por, a.tomado_at,
         round(extract(epoch from (now() - a.creado_at)) / 3600)::int as horas_abierto
    from public.nodo_avisos_internos a
   where a.resuelto_at is null
   order by a.creado_at;

comment on view public.nodo_avisos_abiertos is
  'Lo que hay sin resolver, para mirar de un select. Si te interesa agarrarlo, poné tomado_por y después resuelto_at.';

-- ══ nodo_aviso_interno(...) → deja la señal sin duplicar
create or replace function public.nodo_aviso_interno(p_pc text, p_tipo text, p_huella text, p_detalle jsonb default '{}'::jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc,'')));
  v_id bigint;
begin
  if v_pc = '' or btrim(coalesce(p_tipo,'')) = '' then return null; end if;

  insert into public.nodo_avisos_internos (pc_codigo, tipo, huella, detalle)
  values (v_pc, btrim(p_tipo), coalesce(btrim(p_huella),''), coalesce(p_detalle,'{}'::jsonb))
  on conflict (pc_codigo, tipo, huella) where resuelto_at is null
  do update set visto_ultima_at = now(),
                veces           = public.nodo_avisos_internos.veces + 1,
                detalle         = coalesce(excluded.detalle, public.nodo_avisos_internos.detalle)
  returning id into v_id;

  return v_id;
end;
$function$;

-- ══ nodo_turno_actual(p_at) → MANANA | TARDE | NOCHE, en hora de Argentina
create or replace function public.nodo_turno_actual(p_at timestamptz default now())
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select case
           when extract(hour from (p_at at time zone 'America/Argentina/Buenos_Aires')) between  6 and 13 then 'MANANA'
           when extract(hour from (p_at at time zone 'America/Argentina/Buenos_Aires')) between 14 and 21 then 'TARDE'
           else 'NOCHE'
         end;
$function$;

-- ══ nodo_turno_del_dia(p_at) → a qué turno le toca la pregunta HOY
-- Rota por día del año: hoy mañana, mañana tarde, pasado noche, y vuelve a empezar.
create or replace function public.nodo_turno_del_dia(p_at timestamptz default now())
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select (array['MANANA','TARDE','NOCHE'])[
    (extract(doy from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int % 3) + 1];
$function$;

-- ══ Constancias: "sí, este número sigue activo"
create table if not exists public.oficina_wsp_confirmaciones (
  pc_codigo     text        not null,
  fecha         date        not null,
  turno         text        not null,
  numero        text        not null,
  operador      text,
  confirmado_at timestamptz not null default now(),
  primary key (pc_codigo, fecha, turno)
);

comment on table public.oficina_wsp_confirmaciones is
  'Una fila por oficina/día/turno: el operador dijo que el número de la página sigue activo. Sirve para no volver a preguntar y para saber hace cuánto que nadie mira.';

alter table public.oficina_wsp_confirmaciones enable row level security;

-- ══ panel_oficina_whatsapp_registrar(...) → el único lugar que escribe el número de la página
-- Guarda la línea de WhatsApp de una oficina en landing_rutas_publicas.whatsapp_numero. El
-- Portal la lee con landing_resolver_ruta_publica, que ya devuelve whatsapp_numero.
-- Vacío no borra: un lector que no encontró el número no puede dejar a la oficina sin botón.
-- Borrarlo sigue siendo cosa de admin_general_guardar_ruta.
-- Queda en panel_operativo_auditoria con el número anterior, el nuevo y quién tenía el panel
-- abierto: quien cambia esta línea decide adónde le escriben los jugadores.
create or replace function public.panel_oficina_whatsapp_registrar(p_secret text, p_pc text, p_numero text, p_operador text default null, p_motivo text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pc        text := upper(btrim(coalesce(p_pc,'')));
  v_raw       text := btrim(coalesce(p_numero,''));
  v_num       text := public.nodo_wsp_e164(p_numero);
  v_rutas     integer;
  v_cambiadas integer;
  v_anterior  text;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then
    return jsonb_build_object('ok',false,'motivo','SIN_OFICINA','mensaje','Falta la oficina.');
  end if;
  if v_raw = '' then
    return jsonb_build_object('ok',false,'motivo','SIN_NUMERO',
      'mensaje','Falta el número de WhatsApp de la oficina.');
  end if;
  if v_num is null then
    return jsonb_build_object('ok',false,'motivo','NUMERO_INVALIDO',
      'mensaje','Ese número no parece un celular. Tiene que tener código de área y número, sin el 0 ni el 15. Ejemplo: 11 2345 6789.');
  end if;

  -- Una escritura a la vez por oficina: si dos paneles llegan juntos, el segundo ve el número
  -- ya guardado y contesta que no hubo cambio.
  perform 1 from public.landing_rutas_publicas r where upper(btrim(r.pc_codigo)) = v_pc for update;
  get diagnostics v_rutas = row_count;
  if v_rutas = 0 then
    return jsonb_build_object('ok',false,'motivo','OFICINA_SIN_PORTAL',
      'mensaje','La oficina '||v_pc||' no tiene portal cargado. Avisá a soporte.');
  end if;

  with antes as (
    select r.id, r.whatsapp_numero as anterior, r.activo
      from public.landing_rutas_publicas r
     where upper(btrim(r.pc_codigo)) = v_pc
       and r.whatsapp_numero is distinct from v_num
  ), cambio as (
    update public.landing_rutas_publicas r
       set whatsapp_numero = v_num, updated_at = now()
      from antes a
     where r.id = a.id
    returning r.id, a.anterior, a.activo
  ), registro as (
    insert into public.panel_operativo_auditoria(pc_codigo, operador, accion, entidad, entidad_id, valor_anterior, valor_nuevo, metadata)
    select v_pc, nullif(btrim(coalesce(p_operador,'')),''), 'WHATSAPP_OFICINA', 'RUTA_PUBLICA', c.id,
           jsonb_build_object('whatsapp_numero', c.anterior),
           jsonb_build_object('whatsapp_numero', v_num),
           jsonb_build_object('origen','panel_oficina_whatsapp_registrar','motivo',nullif(btrim(coalesce(p_motivo,'')),''))
      from cambio c
    returning 1
  )
  select count(*), (array_agg(c.anterior order by c.activo desc nulls last, c.id))[1]
    into v_cambiadas, v_anterior
    from cambio c;

  if v_cambiadas = 0 then
    return jsonb_build_object('ok',true,'cambio',false,'pc',v_pc,'whatsapp_numero',v_num);
  end if;
  return jsonb_build_object('ok',true,'cambio',true,'pc',v_pc,'whatsapp_numero',v_num,
    'anterior',v_anterior,'rutas',v_cambiadas);
end;
$function$;

revoke all on function public.panel_oficina_whatsapp_registrar(text,text,text,text,text) from public;
grant execute on function public.panel_oficina_whatsapp_registrar(text,text,text,text,text) to anon, authenticated, service_role;

-- ══ panel_oficina_wsp_linea_numero(...) → el operador carga el número de una línea
-- Un solo número por línea y un solo dueño por número dentro de la oficina: si el número ya
-- estaba en otra línea, se lo saca de la otra (lo más probable es que lo movieron de equipo).
create or replace function public.panel_oficina_wsp_linea_numero(p_secret text, p_pc text, p_linea_id text, p_numero text, p_operador text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pc    text := upper(btrim(coalesce(p_pc,'')));
  v_id    text := btrim(coalesce(p_linea_id,''));
  v_raw   text := btrim(coalesce(p_numero,''));
  v_num   text := public.nodo_wsp_e164(p_numero);
  v_nom   text;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' or v_id = '' then
    return jsonb_build_object('ok',false,'motivo','FALTAN_DATOS','mensaje','Falta la oficina o la línea.');
  end if;

  select l.nombre into v_nom from public.whaticket_lineas l
   where l.pc_codigo = v_pc and l.linea_id = v_id;
  if v_nom is null then
    return jsonb_build_object('ok',false,'motivo','LINEA_DESCONOCIDA',
      'mensaje','Esa línea no figura en la oficina. Actualizá y probá de nuevo.');
  end if;

  -- Vaciar el número de una línea es válido: es "me equivoqué, no sé cuál es".
  if v_raw = '' then
    update public.whaticket_lineas
       set numero = null, numero_crudo = null, numero_origen = null,
           numero_por = nullif(btrim(coalesce(p_operador,'')),''), numero_at = now()
     where pc_codigo = v_pc and linea_id = v_id;
    return jsonb_build_object('ok',true,'pc',v_pc,'linea',v_nom,'numero',null,'borrado',true);
  end if;

  if v_num is null then
    return jsonb_build_object('ok',false,'motivo','NUMERO_INVALIDO',
      'mensaje','Ese número no parece un celular. Poné código de área y número, sin el 0 ni el 15. Ejemplo: 11 2345 6789.');
  end if;

  update public.whaticket_lineas
     set numero = null, numero_origen = null
   where pc_codigo = v_pc and linea_id <> v_id and numero = v_num;

  update public.whaticket_lineas
     set numero = v_num, numero_crudo = public.nodo_norm_telefono_v21(v_raw),
         numero_origen = 'OPERADOR',
         numero_por = nullif(btrim(coalesce(p_operador,'')),''), numero_at = now()
   where pc_codigo = v_pc and linea_id = v_id;

  return jsonb_build_object('ok',true,'pc',v_pc,'linea',v_nom,'numero',v_num);
end;
$function$;

revoke all on function public.panel_oficina_wsp_linea_numero(text,text,text,text,text) from public;
grant execute on function public.panel_oficina_wsp_linea_numero(text,text,text,text,text) to anon, authenticated, service_role;

-- ══ panel_oficina_wsp_confirmar(...) → "sí, este número sigue activo"
create or replace function public.panel_oficina_wsp_confirmar(p_secret text, p_pc text, p_operador text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pc    text := upper(btrim(coalesce(p_pc,'')));
  v_num   text;
  v_turno text := public.nodo_turno_actual();
  v_fecha date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then
    return jsonb_build_object('ok',false,'motivo','SIN_OFICINA','mensaje','Falta la oficina.');
  end if;

  select r.whatsapp_numero into v_num
    from public.landing_rutas_publicas r
   where upper(btrim(r.pc_codigo)) = v_pc and coalesce(r.whatsapp_numero,'') <> ''
   order by r.activo desc nulls last, r.id
   limit 1;

  if v_num is null then
    return jsonb_build_object('ok',false,'motivo','SIN_NUMERO',
      'mensaje','No hay número cargado para confirmar.');
  end if;

  insert into public.oficina_wsp_confirmaciones (pc_codigo, fecha, turno, numero, operador)
  values (v_pc, v_fecha, v_turno, v_num, nullif(btrim(coalesce(p_operador,'')),''))
  on conflict (pc_codigo, fecha, turno) do update
    set numero = excluded.numero, operador = excluded.operador, confirmado_at = now();

  return jsonb_build_object('ok',true,'pc',v_pc,'turno',v_turno,'fecha',v_fecha,'numero',v_num);
end;
$function$;

revoke all on function public.panel_oficina_wsp_confirmar(text,text,text) from public;
grant execute on function public.panel_oficina_wsp_confirmar(text,text,text) to anon, authenticated, service_role;

-- ══ panel_oficina_wsp_estado(p_secret, p_pc) → todo lo que hay que saber, de una lectura
create or replace function public.panel_oficina_wsp_estado(p_secret text, p_pc text)
 returns jsonb
 language plpgsql
 security definer
 stable
 set search_path to 'public'
as $function$
declare
  v_pc        text := upper(btrim(coalesce(p_pc,'')));
  v_num       text;
  v_visto     timestamptz;
  v_responde  boolean;
  v_viejo     boolean;
  v_lineas    jsonb;
  v_total     int := 0;
  v_activas   int := 0;
  v_pool      int := 0;     -- activas con número cargado: las que sirven para rotar
  v_mapeada   jsonb;        -- la línea que tiene el número de la página
  v_turno     text := public.nodo_turno_actual();
  v_toca      text := public.nodo_turno_del_dia();
  v_conf      timestamptz;
  v_conf_hoy  boolean;
  v_pide      text;
  v_desajuste boolean := false;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'mensaje','falta pc_codigo'); end if;

  select r.whatsapp_numero into v_num
    from public.landing_rutas_publicas r
   where upper(btrim(r.pc_codigo)) = v_pc and coalesce(r.whatsapp_numero,'') <> ''
   order by r.activo desc nulls last, r.id
   limit 1;

  select max(l.visto_at) into v_visto from public.whaticket_lineas l where l.pc_codigo = v_pc;
  v_viejo    := v_visto is null or v_visto < now() - interval '25 minutes';
  v_responde := not v_viejo;

  -- Sólo las líneas que el último barrido trajo: una fila vieja es una línea que ya no existe.
  if v_visto is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',       l.linea_id,
             'nombre',   l.nombre,
             'estado',   l.estado,
             'activa',   upper(coalesce(l.estado,'')) = 'CONNECTED',
             'numero',   l.numero,
             'origen',   l.numero_origen,
             'minutos',  greatest(0, round(extract(epoch from (now() - l.cambio_at)) / 60))
           ) order by l.nombre), '[]'::jsonb)
      into v_lineas
      from public.whaticket_lineas l
     where l.pc_codigo = v_pc
       and l.visto_at >= v_visto - interval '5 minutes';
  else
    v_lineas := '[]'::jsonb;
  end if;

  select count(*),
         count(*) filter (where (x->>'activa')::boolean),
         count(*) filter (where (x->>'activa')::boolean and coalesce(x->>'numero','') <> '')
    into v_total, v_activas, v_pool
    from jsonb_array_elements(v_lineas) as e(x);

  if v_num is not null then
    select e.x into v_mapeada
      from jsonb_array_elements(v_lineas) as e(x)
     where e.x->>'numero' = v_num
     limit 1;
  end if;

  select max(c.confirmado_at) into v_conf
    from public.oficina_wsp_confirmaciones c where c.pc_codigo = v_pc;
  v_conf_hoy := exists (
    select 1 from public.oficina_wsp_confirmaciones c
     where c.pc_codigo = v_pc
       and c.fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date
       and c.turno = v_turno);

  -- ── Qué hay que hacer ahora ───────────────────────────────────────────────────────────
  if not v_responde then
    -- Sin WTK el servidor no puede afirmar nada de la línea: la constancia la da una persona.
    if v_num is null then v_pide := 'CARGAR_NUMERO';
    elsif v_toca = v_turno and not v_conf_hoy then v_pide := 'CONFIRMAR';
    else v_pide := 'NADA';
    end if;
  elsif v_num is null then
    v_pide := 'CARGAR_NUMERO';
  elsif v_mapeada is null then
    -- El número de la página no es ninguna línea conocida. Dos casos distintos:
    if v_total > 0 and v_pool = 0 then
      -- Todavía nadie cargó ningún número: no se puede afirmar que no coincida.
      v_pide := 'MAPEAR';
    else
      -- Hay números cargados y el de la página no es ninguno: eso no lo arregla el operador.
      v_pide := 'NADA';
      v_desajuste := true;
    end if;
  elsif not (v_mapeada->>'activa')::boolean then
    v_pide := case when v_pool >= 1 then 'ROTAR' else 'NADA' end;
  else
    v_pide := 'NADA';
  end if;

  return jsonb_build_object(
    'ok', true, 'pc', v_pc,
    'pide', v_pide,
    'numero_pagina', v_num,
    'wtk', jsonb_build_object(
      'responde', v_responde, 'datos_viejos', v_viejo, 'ultimo_barrido', v_visto,
      'lineas', v_total, 'activas', v_activas, 'activas_con_numero', v_pool,
      'rota_sola', v_pool >= 4),
    'linea_pagina', v_mapeada,
    'desajuste', v_desajuste,
    'lineas', v_lineas,
    'turno', jsonb_build_object('actual', v_turno, 'toca_hoy', v_toca,
      'hay_que_preguntar', (v_toca = v_turno and not v_conf_hoy),
      'ultima_confirmacion', v_conf)
  );
end;
$function$;

revoke all on function public.panel_oficina_wsp_estado(text,text) from public;
grant execute on function public.panel_oficina_wsp_estado(text,text) to anon, authenticated, service_role;

-- ══ panel_oficina_wsp_rotar(...) → cambia la línea de la página por una que esté arriba
-- Idempotente y conservadora: si la línea de la página está activa, no toca nada. La puede
-- llamar cualquiera cada vez que quiera (NODO cuando ve el aviso de líneas caídas, o el cron)
-- sin riesgo de que roten dos veces. Elige entre las ACTIVAS EN ESTE MOMENTO con número
-- cargado, la que hace más tiempo que está estable: si hay que elegir, mejor la más asentada.
create or replace function public.panel_oficina_wsp_rotar(p_secret text, p_pc text, p_operador text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pc     text := upper(btrim(coalesce(p_pc,'')));
  v_est    jsonb;
  v_elegida jsonb;
  v_res    jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;

  v_est := public.panel_oficina_wsp_estado(p_secret, v_pc);
  if coalesce((v_est->>'ok')::boolean, false) is not true then return v_est; end if;

  if (v_est->>'pide') <> 'ROTAR' then
    return jsonb_build_object('ok',true,'cambio',false,'motivo','NO_HACE_FALTA',
      'pide',v_est->>'pide','numero_pagina',v_est->>'numero_pagina');
  end if;

  select e.x into v_elegida
    from jsonb_array_elements(v_est->'lineas') as e(x)
   where (e.x->>'activa')::boolean
     and coalesce(e.x->>'numero','') <> ''
     and e.x->>'numero' is distinct from (v_est->>'numero_pagina')
   order by (e.x->>'minutos')::int desc
   limit 1;

  if v_elegida is null then
    return jsonb_build_object('ok',true,'cambio',false,'motivo','NINGUNA_ACTIVA_CON_NUMERO',
      'mensaje','La línea de la página está caída y no hay otra activa con número cargado.');
  end if;

  v_res := public.panel_oficina_whatsapp_registrar(
    p_secret, v_pc, v_elegida->>'numero', p_operador,
    'rotación automática: ' || coalesce(v_est->'linea_pagina'->>'nombre','la línea de la página')
      || ' estaba ' || coalesce(v_est->'linea_pagina'->>'estado','caída')
      || ' → ' || coalesce(v_elegida->>'nombre',''));

  if coalesce((v_res->>'ok')::boolean,false) is not true then return v_res; end if;

  perform public.nodo_aviso_interno(v_pc, 'WSP_LINEA_ROTADA',
    coalesce(v_elegida->>'id',''),
    jsonb_build_object(
      'de',    v_est->'linea_pagina',
      'a',     v_elegida,
      'cuando', now(),
      'por',   nullif(btrim(coalesce(p_operador,'')),'')));

  return jsonb_build_object('ok',true,'cambio',true,'pc',v_pc,
    'de', v_est->'linea_pagina'->>'nombre', 'a', v_elegida->>'nombre',
    'numero', v_elegida->>'numero');
end;
$function$;

revoke all on function public.panel_oficina_wsp_rotar(text,text,text) from public;
grant execute on function public.panel_oficina_wsp_rotar(text,text,text) to anon, authenticated, service_role;

-- ══ panel_oficina_wsp_desajuste(...) → deja la señal cuando el número no es de ninguna línea
-- Se llama aparte del estado porque el estado es stable (no escribe). La huella es el número:
-- mientras siga siendo el mismo número desajustado, el aviso es uno solo.
create or replace function public.panel_oficina_wsp_desajuste(p_secret text, p_pc text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pc  text := upper(btrim(coalesce(p_pc,'')));
  v_est jsonb;
  v_id  bigint;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;

  v_est := public.panel_oficina_wsp_estado(p_secret, v_pc);
  if coalesce((v_est->>'desajuste')::boolean,false) is not true then
    return jsonb_build_object('ok',true,'aviso',false);
  end if;

  v_id := public.nodo_aviso_interno(v_pc, 'WSP_PAGINA_SIN_LINEA',
    coalesce(v_est->>'numero_pagina',''),
    jsonb_build_object(
      'numero_pagina', v_est->>'numero_pagina',
      'lineas_activas_con_numero', v_est->'wtk'->'activas_con_numero',
      'lineas', v_est->'lineas',
      'que_revisar', 'El WhatsApp que muestra el Portal no es ninguna de las líneas que WTK le reconoce a la oficina. Puede ser una línea que WTK ya no maneja, un número viejo, o el de otra oficina.'));

  return jsonb_build_object('ok',true,'aviso',true,'id',v_id);
end;
$function$;

revoke all on function public.panel_oficina_wsp_desajuste(text,text) from public;
grant execute on function public.panel_oficina_wsp_desajuste(text,text) to anon, authenticated, service_role;
