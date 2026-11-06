-- NODO beta v1. Additive API: NEVER replace a legacy function or copy messages.
-- Provision tokens outside this file (32 random bytes -> 64 hex characters).
-- Store only SHA256(token UTF8), bind each installation to exactly one pc_codigo.
-- Existing nodo_beta storage must first be relocated by the guarded domain migration.
-- Apply atomically after capturing schema/ACL state; this file performs no enrollment.
begin;
create schema if not exists acceso;
create schema if not exists comunicaciones;
create schema if not exists observabilidad;
revoke all on schema acceso,comunicaciones,observabilidad from public, anon, authenticated;

create table if not exists acceso.beta_clientes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  pc_codigo text not null check (pc_codigo <> '' and pc_codigo = upper(btrim(pc_codigo))),
  enabled boolean not null default false,
  active_build text,
  active_contract text,
  activated_at timestamptz,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists beta_clientes_office on acceso.beta_clientes(pc_codigo) where enabled;
create table if not exists comunicaciones.chat_lecturas (
  message_id bigint primary key references public.chat_mensajes(id) on delete cascade,
  sesion_id bigint not null references public.chat_sesiones(id) on delete cascade,
  client_id uuid not null references acceso.beta_clientes(id),
  seen_at timestamptz not null default now()
);
create index if not exists chat_lecturas_session on comunicaciones.chat_lecturas(sesion_id, message_id);
create table if not exists comunicaciones.chat_envios (
  client_id uuid not null references acceso.beta_clientes(id),
  request_id uuid not null,
  payload_hash text not null,
  message_id bigint references public.chat_mensajes(id),
  created_at timestamptz not null default now(),
  primary key(client_id,request_id)
);
create table if not exists observabilidad.salud_actual (
  client_id uuid not null references acceso.beta_clientes(id) on delete cascade,
  integration text not null check (integration in ('CHAT','PORTAL','TELEMETRIA','CAPACIDADES','BANDEJA','IDENTIDAD','HISTORIAL','BILLETERAS','RETIROS','VALIDACION','WORKERS','AUTOMATISMOS','CONCILIACION','NEXO','ADMIN','CONEXION')),
  stage text not null check (stage in ('ALIVE','CONNECTED','DATA','EFFECT','RENDER')),
  state text not null check (state in ('OK','DEGRADED','ERROR','IDLE','UNKNOWN')),
  sample_count integer not null check (sample_count between 0 and 1000000),
  error_count integer not null check (error_count between 0 and 1000000),
  duration_ms numeric not null check (duration_ms between 0 and 86400000),
  code text check (code is null or code ~ '^[A-Z0-9_.:-]{1,64}$'),
  build text,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  primary key(client_id,integration,stage)
);
alter table acceso.beta_clientes enable row level security;
alter table comunicaciones.chat_lecturas enable row level security;
alter table comunicaciones.chat_envios enable row level security;
alter table observabilidad.salud_actual enable row level security;
revoke all on all tables in schema acceso,comunicaciones,observabilidad from public, anon, authenticated;

create or replace function acceso.autorizar(p_token text,p_pc_codigo text)
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare v_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or coalesce(btrim(p_pc_codigo),'')='' then
    raise exception using errcode='42501',message='BETA_NOT_AUTHORIZED';
  end if;
  select c.id into v_id from acceso.beta_clientes c
   where c.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
     and c.pc_codigo=upper(btrim(p_pc_codigo)) and c.enabled;
  if v_id is null then raise exception using errcode='42501',message='BETA_NOT_AUTHORIZED'; end if;
  return v_id;
end $$;

-- Prefer the canonical textual ID; only interpret as numeric if no canonical match exists.
-- This avoids the old OR/order-by-id ambiguity between chat_id='42' and session.id=42.
create or replace function comunicaciones.resolver_chat(p_chat_id text,p_pc_codigo text)
returns public.chat_sesiones language plpgsql stable security invoker set search_path='' as $$
declare v_s public.chat_sesiones;
begin
  if coalesce(length(p_chat_id),0) not between 1 and 128 then
    raise exception using errcode='42501',message='BETA_CHAT_NOT_AUTHORIZED';
  end if;
  select c.* into v_s from public.chat_sesiones c where c.chat_id=btrim(p_chat_id);
  if v_s.id is null then
    select c.* into v_s from public.chat_sesiones c where c.id::text=btrim(p_chat_id);
  end if;
  if v_s.id is null or upper(btrim(coalesce(v_s.pc_codigo,'')))<>upper(btrim(p_pc_codigo)) then
    raise exception using errcode='42501',message='BETA_CHAT_NOT_AUTHORIZED';
  end if;
  return v_s;
end $$;

-- Three disjoint indexed branches. Never infer message ownership from a solicitud number:
-- solicitudes and landing_solicitudes have independent ID spaces and old episode bridges.
create or replace function comunicaciones.mensajes(p_sesion_id bigint)
returns setof public.chat_mensajes language sql stable security invoker set search_path='' as $$
  select m.* from public.chat_sesiones c join public.chat_mensajes m on m.chat_id=c.chat_id
   where c.id=p_sesion_id and (m.conversacion_id is null or m.conversacion_id=c.id)
  union all
  select m.* from public.chat_sesiones c join public.chat_mensajes m on m.conversacion_id=c.id
   where c.id=p_sesion_id and m.chat_id is distinct from c.chat_id
     and not exists(select 1 from public.chat_sesiones other where other.chat_id=m.chat_id and other.id<>c.id)
  union all
  select m.* from public.chat_sesiones c join public.chat_mensajes m on m.chat_id=c.id::text
   where c.id=p_sesion_id and m.conversacion_id is null and m.chat_id is distinct from c.chat_id
     and not exists(select 1 from public.chat_sesiones other where other.chat_id=m.chat_id);
$$;

create or replace function comunicaciones.contadores(p_sesion_id bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 -- Sin leer: lo que nadie marcó como leído y el operador todavía no contestó. Una respuesta automática
 -- no cuenta como contestar. El "visto" que recibe el jugador sale aparte, de chat_lecturas.
 select jsonb_build_object(
   'unread',count(*) filter(where coalesce(t.leido,false)=false and t.id>coalesce(t.corte,0)),
   'seen_remaining',count(*) filter(where r.message_id is null))
 from (select m.*,max(m.id) filter(where upper(coalesce(m.tipo_emisor,''))='OPERADOR'
         and coalesce(m.visible_operador,true) and coalesce(m.metadata->>'auto','')<>'true'
         and upper(coalesce(m.emisor,''))<>'NODO') over() as corte
       from comunicaciones.mensajes(p_sesion_id) m) t
 left join comunicaciones.chat_lecturas r on r.message_id=t.id and r.sesion_id=p_sesion_id
 where upper(t.tipo_emisor)='USUARIO' and coalesce(t.visible_operador,true);
$$;

create or replace function public.nodo_beta_capacidades_v1(
 p_token text,p_pc_codigo text,p_build text default null,p_activate boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_c acceso.beta_clientes;
begin
 v_id:=acceso.autorizar(p_token,p_pc_codigo);
 if p_activate then
   if p_build is null or p_build !~ '^[A-Za-z0-9._+/-]{1,128}$' then
     raise exception using errcode='22023',message='BETA_BUILD_REQUIRED';
   end if;
   update acceso.beta_clientes set active_build=p_build,active_contract='nodo.beta.v1',
      activated_at=now(),last_seen=now() where id=v_id;
 end if;
 select * into v_c from acceso.beta_clientes where id=v_id;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1',
   'capabilities',jsonb_build_array('chat.list.v1','chat.messages.v1','chat.read.v1','chat.send.v1','health.v1','portal.seen.v1')
     || case when to_regprocedure('public.nodo_beta_perfil_v1(text,text,text)') is not null
          and to_regprocedure('public.nodo_beta_perfil_detalle_v1(text,text,text,integer,jsonb)') is not null
        then jsonb_build_array('perfil.summary.v1','perfil.detail.v1') else '[]'::jsonb end,
   'scope',jsonb_build_object('pc_codigo',v_c.pc_codigo),
   'active',coalesce(v_c.active_contract='nodo.beta.v1' and v_c.last_seen>now()-interval '5 minutes',false),
   'build',v_c.active_build,'lease_seconds',300,
   'limits',jsonb_build_object('list',100,'messages',100,'ack',100,'health',32));
end $$;

create or replace function public.nodo_beta_chat_lista_v1(
 p_token text,p_pc_codigo text,p_usuario text default null,p_estado text default null,
 p_limit integer default 50,p_before_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_out jsonb;
begin
 perform acceso.autorizar(p_token,p_pc_codigo);
 if p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_usuario,''))>200
   or length(coalesce(p_estado,''))>40 or p_before_id<=0 then
   raise exception using errcode='22023',message='BETA_INVALID_PAGE';
 end if;
 with scope as materialized (
   select c.*,comunicaciones.contadores(c.id) as counts from public.chat_sesiones c
    where upper(btrim(coalesce(c.pc_codigo,'')))=upper(btrim(p_pc_codigo))
      and (nullif(btrim(p_usuario),'') is null or lower(btrim(c.usuario))=lower(btrim(p_usuario)))
      and (nullif(btrim(p_estado),'') is null or upper(coalesce(c.estado,'ABIERTO'))=upper(btrim(p_estado)))
 ), page as materialized (
   select s.* from scope s where p_before_id is null or s.id<p_before_id order by s.id desc limit p_limit+1
 ), shown as materialized (select * from page order by id desc limit p_limit),
 rendered as (
   select s.id,jsonb_build_object('id',s.chat_id,'chat_id',s.chat_id,'sesion_id',s.id::text,
     'usuario',s.usuario,'telefono',s.telefono,'pc_codigo',s.pc_codigo,'estado',s.estado,
     'solicitud_id',s.solicitud_id::text,'sin_leer',s.counts->'unread',
     'sin_ver_confirmado',s.counts->'seen_remaining','created_at',s.created_at,
     'updated_at',coalesce(last_msg.created_at,s.ultimo_mensaje,s.created_at),
     'fecha_ultimo',coalesce(last_user.created_at,s.created_at),
     'ultimo_mensaje',coalesce(last_msg.mensaje,''),'ultimo_de',last_msg.tipo_emisor,
     'ultimo_auto',coalesce(last_msg.metadata->>'auto','')='true' or upper(coalesce(last_msg.emisor,''))='NODO',
     'ultimo_operador',last_msg.emisor,
     'ultimo_id',last_msg.id::text) as row
   from shown s
   left join lateral(select m.id,m.created_at,m.mensaje,m.tipo_emisor,m.emisor,m.metadata from comunicaciones.mensajes(s.id) m
      where coalesce(m.visible_operador,true) order by m.id desc limit 1) last_msg on true
   left join lateral(select m.created_at from comunicaciones.mensajes(s.id) m
      where coalesce(m.visible_operador,true) and upper(m.tipo_emisor)='USUARIO' order by m.id desc limit 1) last_user on true
 )
 select jsonb_build_object('ok',true,'contract','nodo.beta.v1',
   'rows',coalesce((select jsonb_agg(row order by id desc) from rendered),'[]'::jsonb),
   'total', (select count(*) from scope),
   'unread_total',coalesce((select sum((counts->>'unread')::bigint) from scope where upper(coalesce(estado,'')) not in ('CERRADO','RESUELTA')),0),
   'seen_remaining_total',coalesce((select sum((counts->>'seen_remaining')::bigint) from scope where upper(coalesce(estado,'')) not in ('CERRADO','RESUELTA')),0),
   'has_more',(select count(*) from page)>p_limit,
   'next_before_id',case when (select count(*) from page)>p_limit then (select min(id)::text from shown) end)
 into v_out;
 return v_out;
end $$;

-- The legacy getter selects by username without scope. Do not reuse it here.
-- Only the explicitly linked request in the same office/identity can contribute history.
-- Keep provenance; never merge equal texts from different real messages.
create or replace function comunicaciones.hilo_legacy(p_sesion_id bigint,p_portal boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
   'portal_key','legacy:'||s.id::text||':'||e.ord::text,
   'origen',e.m->>'origen','mensaje',e.m->>'mensaje',
   'imagen_url',coalesce(e.m->>'imagen_url',e.m->>'imagen'),
   'fecha',e.m->>'fecha','solicitud_id',s.id::text,
   'auto',e.m->'auto','auto_caso',e.m->>'auto_caso',
   'visto_confirmado',false)) order by e.ord),'[]'::jsonb)
 from public.chat_sesiones c
 join public.landing_solicitudes s on s.id=c.solicitud_id
   and upper(btrim(coalesce(s.pc_codigo,'')))=upper(btrim(coalesce(c.pc_codigo,'')))
   and lower(btrim(coalesce(s.usuario,s.metadata->>'usuario','')))=lower(btrim(c.usuario))
 cross join lateral jsonb_array_elements(case when jsonb_typeof(s.metadata->'chat_thread')='array'
   then s.metadata->'chat_thread' else '[]'::jsonb end) with ordinality e(m,ord)
 where c.id=p_sesion_id
   and (case when p_portal then e.m->>'visible_usuario' else e.m->>'visible_operador' end) is distinct from 'false'
   -- D-130: texto de relleno guardado como USUARIO. El jugador nunca lo escribió.
   and not (upper(coalesce(e.m->>'origen',''))='USUARIO'
     and coalesce(e.m->>'imagen_url',e.m->>'imagen','')=''
     and btrim(coalesce(e.m->>'mensaje','')) ~* '^(consulta desde portal( v16)?|\[conversaci[oó]n iniciada por el operador[^]]*\])$')
   and not exists(select 1 from comunicaciones.mensajes(c.id) x
     where coalesce(e.m->>'id',e.m->>'mensaje_id')=x.id::text
        -- D-133: las copias del hilo no guardan el número del mensaje. Mismo lado, mismo texto y
        -- mismo segundo: es la copia, y ya viaja en rows.
        or ((upper(coalesce(e.m->>'origen',''))='USUARIO')=(upper(coalesce(x.tipo_emisor,''))='USUARIO')
          and coalesce(x.mensaje,'')=coalesce(e.m->>'mensaje','')
          and to_char(x.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')=left(e.m->>'fecha',19)));
$$;

create or replace function comunicaciones.pagina_mensajes(p_sesion_id bigint,p_limit integer,p_before_id bigint,p_portal boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
 with page as materialized (
   select m.*,r.seen_at from comunicaciones.mensajes(p_sesion_id) m
    left join comunicaciones.chat_lecturas r on r.message_id=m.id and r.sesion_id=p_sesion_id
    where (case when p_portal then coalesce(m.visible_usuario,true) else coalesce(m.visible_operador,true) end)
      and (p_before_id is null or m.id<p_before_id)
    order by m.id desc limit p_limit+1
 ), shown as materialized (select * from page order by id desc limit p_limit)
 select jsonb_build_object('ok',true,'contract','nodo.beta.v1','sesion_id',p_sesion_id::text,
   'rows',coalesce((select jsonb_agg(jsonb_build_object(
     'id',s.id::text,'chat_id',s.chat_id,'conversacion_id',p_sesion_id::text,
     'solicitud_id',s.solicitud_id::text,'tipo_emisor',s.tipo_emisor,
     'auto',coalesce(s.metadata->>'auto','')='true' or (upper(coalesce(s.emisor,''))='NODO' and upper(s.tipo_emisor)<>'USUARIO'),
     'auto_caso',coalesce(s.metadata->>'auto_caso',s.metadata->>'caso'),
     'emisor',case when p_portal and upper(s.tipo_emisor)<>'USUARIO' then 'OPERADOR' else s.emisor end,
     'mensaje',s.mensaje,'imagen_url',s.imagen_url,'leido',coalesce(s.leido,false),
     'created_at',s.created_at,'visible_usuario',s.visible_usuario,'visible_operador',s.visible_operador,
     'visto_confirmado',s.seen_at is not null,'seen_at',s.seen_at) order by s.id asc) from shown s),'[]'::jsonb),
   'legacy_thread',case when p_before_id is null then comunicaciones.hilo_legacy(p_sesion_id,p_portal) else '[]'::jsonb end,
   'has_more',(select count(*) from page)>p_limit,
   'next_before_id',case when (select count(*) from page)>p_limit then (select min(id)::text from shown) end);
$$;

create or replace function public.nodo_beta_chat_mensajes_v1(
 p_token text,p_pc_codigo text,p_chat_id text,p_limit integer default 50,p_before_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_s public.chat_sesiones;
begin
 perform acceso.autorizar(p_token,p_pc_codigo);
 if p_limit is null or p_limit not between 1 and 100 or p_before_id<=0 then
   raise exception using errcode='22023',message='BETA_INVALID_PAGE';
 end if;
 v_s:=comunicaciones.resolver_chat(p_chat_id,p_pc_codigo);
 return comunicaciones.pagina_mensajes(v_s.id,p_limit,p_before_id,false)
   || jsonb_build_object('chat_id',v_s.chat_id,'counts',comunicaciones.contadores(v_s.id));
end $$;

create or replace function public.nodo_beta_chat_leido_v1(
 p_token text,p_pc_codigo text,p_chat_id text,p_message_ids bigint[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid; v_s public.chat_sesiones; v_ids bigint[]; v_valid bigint[]; v_inserted integer;
begin
 v_client:=acceso.autorizar(p_token,p_pc_codigo);
 if p_message_ids is null or cardinality(p_message_ids) not between 1 and 100
   or array_position(p_message_ids,null) is not null then
   raise exception using errcode='22023',message='BETA_INVALID_ACK';
 end if;
 v_s:=comunicaciones.resolver_chat(p_chat_id,p_pc_codigo);
 -- Hold scope and message identity while validating and writing the exact set.
 select c.* into v_s from public.chat_sesiones c where c.id=v_s.id for share;
 if v_s.id is null or upper(btrim(coalesce(v_s.pc_codigo,'')))<>upper(btrim(p_pc_codigo)) then
   raise exception using errcode='42501',message='BETA_CHAT_NOT_AUTHORIZED';
 end if;
 select array_agg(distinct id order by id) into v_ids from unnest(p_message_ids) as q(id);
 perform 1 from public.chat_mensajes m where m.id=any(v_ids) order by m.id for update;
 select array_agg(m.id order by m.id) into v_valid from comunicaciones.mensajes(v_s.id) m
   where m.id=any(v_ids) and upper(m.tipo_emisor)='USUARIO' and coalesce(m.visible_operador,true);
 if v_valid is distinct from v_ids then
   raise exception using errcode='42501',message='BETA_ACK_OUT_OF_SCOPE';
 end if;
 insert into comunicaciones.chat_lecturas(message_id,sesion_id,client_id)
   select id,v_s.id,v_client from unnest(v_ids) as q(id) on conflict(message_id) do nothing;
 get diagnostics v_inserted=row_count;
 -- Compatibility write only for explicitly acknowledged IDs. Never mark the whole chat.
 update public.chat_mensajes m set leido=true,leido_operador_at=coalesce(m.leido_operador_at,now())
   where m.id=any(v_ids) and (not coalesce(m.leido,false) or m.leido_operador_at is null);
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1','chat_id',v_s.chat_id,
   'acknowledged_ids',to_jsonb(v_ids::text[]),'inserted',v_inserted)
   || comunicaciones.contadores(v_s.id);
end $$;

create or replace function public.nodo_beta_chat_enviar_v1(
 p_token text,p_pc_codigo text,p_chat_id text,p_mensaje text,p_imagen_url text,
 p_emisor text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid; v_s public.chat_sesiones; v_hash text; v_prev comunicaciones.chat_envios;
 v_id bigint; v_message jsonb; v_new integer;
begin
 v_client:=acceso.autorizar(p_token,p_pc_codigo);
 v_s:=comunicaciones.resolver_chat(p_chat_id,p_pc_codigo);
 if p_request_id is null or length(coalesce(p_mensaje,''))>8000
   or length(coalesce(p_imagen_url,''))>2048 or length(coalesce(p_emisor,''))>120
   or (btrim(coalesce(p_mensaje,''))='' and btrim(coalesce(p_imagen_url,''))='')
   or (nullif(btrim(p_imagen_url),'') is not null and p_imagen_url !~ '^https://') then
   raise exception using errcode='22023',message='BETA_INVALID_MESSAGE';
 end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_array(v_s.id,btrim(coalesce(p_mensaje,'')),
   nullif(btrim(p_imagen_url),''),coalesce(p_emisor,'panel'))::text,'UTF8')),'hex');
 insert into comunicaciones.chat_envios(client_id,request_id,payload_hash)
   values(v_client,p_request_id,v_hash) on conflict do nothing;
 get diagnostics v_new=row_count;
 select * into v_prev from comunicaciones.chat_envios where client_id=v_client and request_id=p_request_id for update;
 if v_prev.payload_hash<>v_hash then
   raise exception using errcode='22023',message='BETA_IDEMPOTENCY_CONFLICT';
 end if;
   -- Lock for the later UPDATE directly: two SHARE holders upgrading can deadlock.
   -- Re-read ownership and state after waiting; the pre-lock resolver may be stale.
   select c.* into v_s from public.chat_sesiones c where c.id=v_s.id for update;
   if v_s.id is null or upper(btrim(coalesce(v_s.pc_codigo,'')))<>upper(btrim(p_pc_codigo)) then
     raise exception using errcode='42501',message='BETA_CHAT_NOT_AUTHORIZED';
   end if;
 if v_new=1 then
   if upper(coalesce(v_s.estado,'')) in ('CERRADO','RESUELTA') then
     update public.chat_sesiones set estado='ABIERTO' where id=v_s.id;
   end if;
   insert into public.chat_mensajes(chat_id,conversacion_id,tipo_emisor,emisor,mensaje,imagen_url,
     leido,created_at,visible_usuario,visible_operador)
   values(v_s.chat_id,v_s.id,'OPERADOR',coalesce(nullif(btrim(p_emisor),''),'panel'),
     btrim(coalesce(p_mensaje,'')),nullif(btrim(p_imagen_url),''),false,clock_timestamp(),true,true)
   returning id into v_id;
   update comunicaciones.chat_envios set message_id=v_id where client_id=v_client and request_id=p_request_id;
   update public.chat_sesiones set ultimo_mensaje=clock_timestamp() where id=v_s.id;
 else v_id:=v_prev.message_id;
 end if;
 select jsonb_build_object('id',id::text,'chat_id',chat_id,'tipo_emisor',tipo_emisor,
   'emisor',emisor,'mensaje',mensaje,'imagen_url',imagen_url,'created_at',created_at)
 into v_message from public.chat_mensajes where id=v_id;
 if v_message is null then raise exception using errcode='40001',message='BETA_SEND_RESULT_UNAVAILABLE'; end if;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1','chat_id',v_s.chat_id,
   'message',v_message,'duplicate',v_new=0);
end $$;

create or replace function comunicaciones.portal_autorizar(p_chat_id bigint,p_chat_token text)
returns public.chat_sesiones language plpgsql stable security invoker set search_path='' as $$
declare v_s public.chat_sesiones;
begin
 if coalesce(length(p_chat_token),0) not between 16 and 256 then
   raise exception using errcode='42501',message='BETA_CHAT_NOT_AUTHORIZED';
 end if;
 select c.* into v_s from public.chat_sesiones c
  where c.id=p_chat_id and c.chat_public_token=p_chat_token and coalesce(c.estado,'ABIERTO')<>'CERRADO';
 if v_s.id is null then raise exception using errcode='42501',message='BETA_CHAT_NOT_AUTHORIZED'; end if;
 return v_s;
end $$;

create or replace function public.landing_chat_vistos_v1(
 p_chat_id bigint,p_chat_token text,p_message_ids bigint[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_s public.chat_sesiones; v_out jsonb;
begin
 v_s:=comunicaciones.portal_autorizar(p_chat_id,p_chat_token);
 if p_message_ids is not null and (cardinality(p_message_ids)>100 or array_position(p_message_ids,null) is not null) then
   raise exception using errcode='22023',message='BETA_INVALID_PAGE';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('message_id',q.message_id::text,'seen_at',q.seen_at) order by q.message_id),'[]'::jsonb)
 into v_out from (
   select r.message_id,r.seen_at from comunicaciones.chat_lecturas r
    join comunicaciones.mensajes(v_s.id) m on m.id=r.message_id
    where r.sesion_id=v_s.id and upper(m.tipo_emisor)='USUARIO' and coalesce(m.visible_usuario,true)
      and (p_message_ids is null or r.message_id=any(p_message_ids))
    order by r.message_id desc limit 100
 ) q;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1','chat_id',p_chat_id::text,'seen',v_out);
end $$;

create or replace function public.landing_beta_chat_leer_v1(
 p_chat_id bigint,p_chat_token text,p_limit integer default 50,p_before_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_s public.chat_sesiones; v_available boolean;
begin
 v_s:=comunicaciones.portal_autorizar(p_chat_id,p_chat_token);
 if p_limit is null or p_limit not between 1 and 100 or p_before_id<=0 then
   raise exception using errcode='22023',message='BETA_INVALID_PAGE';
 end if;
 select exists(select 1 from acceso.beta_clientes c
   where c.pc_codigo=upper(btrim(v_s.pc_codigo)) and c.enabled
     and c.active_contract='nodo.beta.v1' and c.active_build is not null
     and c.last_seen>now()-interval '5 minutes') into v_available;
 if not v_available then
   return jsonb_build_object('ok',true,'available',false,'contract','legacy','reason','NO_ACTIVE_NODE');
 end if;
 return comunicaciones.pagina_mensajes(v_s.id,p_limit,p_before_id,true)
   || jsonb_build_object('available',true,'chat_id',p_chat_id::text,
       'capabilities',jsonb_build_array('chat.messages.v1','portal.seen.v1','portal.thread.v1'));
end $$;

-- Latest bounded window per installation/integration/stage, NOT an unbounded event log.
-- Distinct stages preserve DATA/RENDER failures when an unrelated heartbeat is healthy.
create or replace function public.nodo_beta_salud_v1(
 p_token text,p_pc_codigo text,p_muestras jsonb default null,p_build text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_client uuid; v_sample jsonb; v_observed timestamptz; v_rows jsonb; v_updated integer:=0; v_n integer;
begin
 v_client:=acceso.autorizar(p_token,p_pc_codigo);
 if p_muestras is not null then
   if jsonb_typeof(p_muestras)<>'array' or jsonb_array_length(p_muestras)>32 or octet_length(p_muestras::text)>32768 then
     raise exception using errcode='22023',message='BETA_INVALID_HEALTH_BATCH';
   end if;
   for v_sample in select value from jsonb_array_elements(p_muestras) loop
     if jsonb_typeof(v_sample)<>'object' or exists(select 1 from jsonb_object_keys(v_sample) k
       where k not in ('integration','stage','state','count','errors','duration_ms','code','observed_at')) then
       raise exception using errcode='22023',message='BETA_INVALID_HEALTH_SAMPLE';
     end if;
     v_observed:=(v_sample->>'observed_at')::timestamptz;
     if v_observed is null or v_observed>now()+interval '5 minutes' or v_observed<now()-interval '48 hours'
       or length(coalesce(p_build,''))>128 then
       raise exception using errcode='22023',message='BETA_INVALID_HEALTH_TIME';
     end if;
     insert into observabilidad.salud_actual as old(client_id,integration,stage,state,sample_count,error_count,duration_ms,code,build,observed_at,last_ok_at,last_error_at,last_error_code)
     values(v_client,v_sample->>'integration',v_sample->>'stage',v_sample->>'state',
       coalesce((v_sample->>'count')::integer,0),coalesce((v_sample->>'errors')::integer,0),
       coalesce((v_sample->>'duration_ms')::numeric,0),v_sample->>'code',p_build,v_observed,
       case when v_sample->>'state'='OK' then now() end,
       case when v_sample->>'state' in ('ERROR','DEGRADED') then now() end,
       case when v_sample->>'state' in ('ERROR','DEGRADED') then v_sample->>'code' end)
     on conflict(client_id,integration,stage) do update set
       state=excluded.state,sample_count=excluded.sample_count,error_count=excluded.error_count,
       duration_ms=excluded.duration_ms,code=excluded.code,build=excluded.build,
       observed_at=excluded.observed_at,received_at=now(),
       last_ok_at=coalesce(excluded.last_ok_at,old.last_ok_at),
       last_error_at=coalesce(excluded.last_error_at,old.last_error_at),
       last_error_code=case when excluded.last_error_at is not null then excluded.last_error_code else old.last_error_code end
     where excluded.observed_at>old.observed_at;
     get diagnostics v_n=row_count;
     v_updated:=v_updated+v_n;
   end loop;
   -- Renewal only by the exact build that acknowledged the contract; an old client cannot renew it.
   update acceso.beta_clientes set last_seen=now()
     where id=v_client and active_contract='nodo.beta.v1' and active_build=p_build;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('installation_id',c.id,'integration',h.integration,
   'stage',h.stage,'state',case when h.received_at<now()-interval '5 minutes' then 'UNKNOWN' else h.state end,
   'reported_state',h.state,'count',h.sample_count,'errors',h.error_count,'duration_ms',h.duration_ms,
   'code',h.code,'build',h.build,'observed_at',h.observed_at,'received_at',h.received_at,
   'last_ok_at',h.last_ok_at,'last_error_at',h.last_error_at,'last_error_code',h.last_error_code)
   order by c.id,h.integration,h.stage),'[]'::jsonb)
 into v_rows from observabilidad.salud_actual h join acceso.beta_clientes c on c.id=h.client_id
 where c.pc_codigo=upper(btrim(p_pc_codigo)) and c.enabled;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1','accepted',v_updated,'rows',v_rows,'server_time',now());
end $$;

revoke all on all functions in schema acceso,comunicaciones,observabilidad from public,anon,authenticated;
revoke all on function public.nodo_beta_capacidades_v1(text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.nodo_beta_chat_lista_v1(text,text,text,text,integer,bigint) from public,anon,authenticated;
revoke all on function public.nodo_beta_chat_mensajes_v1(text,text,text,integer,bigint) from public,anon,authenticated;
revoke all on function public.nodo_beta_chat_leido_v1(text,text,text,bigint[]) from public,anon,authenticated;
revoke all on function public.nodo_beta_chat_enviar_v1(text,text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.nodo_beta_salud_v1(text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.landing_chat_vistos_v1(bigint,text,bigint[]) from public,anon,authenticated;
revoke all on function public.landing_beta_chat_leer_v1(bigint,text,integer,bigint) from public,anon,authenticated;
grant execute on function public.nodo_beta_capacidades_v1(text,text,text,boolean),
 public.nodo_beta_chat_lista_v1(text,text,text,text,integer,bigint),
 public.nodo_beta_chat_mensajes_v1(text,text,text,integer,bigint),
 public.nodo_beta_chat_leido_v1(text,text,text,bigint[]),
 public.nodo_beta_chat_enviar_v1(text,text,text,text,text,text,uuid),
 public.nodo_beta_salud_v1(text,text,jsonb,text),
 public.landing_chat_vistos_v1(bigint,text,bigint[]),
 public.landing_beta_chat_leer_v1(bigint,text,integer,bigint)
 to anon,authenticated;
notify pgrst,'reload schema';
commit;
