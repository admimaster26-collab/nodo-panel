-- Perfil: resumen completo por oficina/usuario y detalle acotado, sin escrituras.
-- Autoridad: historial_ops; importaciones se muestran separadas por falta de ID común.
-- Entrada pública autentica instalación; implementaciones internas no están expuestas.
create schema if not exists acceso;
create schema if not exists identidad;
create schema if not exists operaciones;
revoke all on schema acceso,identidad,operaciones from public,anon,authenticated;

-- Compatibilidad con beta27: conserva la misma autoridad y las mismas filas.
-- No crea clientes nuevos ni mueve tablas; aborta si falta el contrato instalado.
do $compat$
begin
 if to_regprocedure('acceso.autorizar(text,text)') is null then
   if to_regprocedure('nodo_beta.autorizar(text,text)') is null or
      (select prorettype from pg_proc where oid=to_regprocedure('nodo_beta.autorizar(text,text)'))<>'uuid'::regtype then
     raise exception 'BETA_AUTH_CONTRACT_REQUIRED';
   end if;
   execute 'create function acceso.autorizar(p_token text,p_pc_codigo text) returns uuid language sql stable security invoker set search_path='''' as ''select nodo_beta.autorizar(p_token,p_pc_codigo)''';
 end if;
end $compat$;
revoke all on function acceso.autorizar(text,text) from public,anon,authenticated;

create or replace function operaciones.estado_confirmado_v1(p_estado text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select upper(btrim(coalesce(p_estado,''))) in ('OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA');
$$;

create or replace function acceso.oficinas_autorizadas(p_pc_codigo text)
returns text[] language plpgsql stable security invoker set search_path='' as $$
declare v_pc text:=upper(btrim(p_pc_codigo)); v_roots text[]; v_aliases text[];
begin
 select array_agg(distinct a.oficina_id) into v_roots from public.nodo_oficina_aliases a
 where a.activa and (upper(btrim(a.alias_codigo))=v_pc or upper(btrim(a.pc_codigo_compat))=v_pc);
 if coalesce(cardinality(v_roots),0)>1 then
   raise exception using errcode='42501',message='BETA_OFFICE_AMBIGUOUS';
 end if;
 select array_agg(distinct x.pc) into v_aliases from (
   select v_pc pc union all
   select upper(btrim(a.alias_codigo)) from public.nodo_oficina_aliases a where a.activa and a.oficina_id=any(v_roots)
   union all select upper(btrim(a.pc_codigo_compat)) from public.nodo_oficina_aliases a where a.activa and a.oficina_id=any(v_roots)
 ) x where coalesce(x.pc,'')<>'';
 if exists(select 1 from public.nodo_oficina_aliases a where a.activa
   and (upper(btrim(a.alias_codigo))=any(v_aliases) or upper(btrim(a.pc_codigo_compat))=any(v_aliases))
   and not (a.oficina_id=any(v_roots))) then
   raise exception using errcode='42501',message='BETA_OFFICE_AMBIGUOUS';
 end if;
 return v_aliases;
end $$;

-- Autoridad compartida de vigencia: evaluar la pareja antes de aplicar filtros
-- de pantalla/paginacion. Una reversa no representa una nueva carga o retiro.
-- La misma oficina (incluidos aliases) y el mismo usuario delimitan la pareja.
create or replace function operaciones.historial_evaluado_v1(p_pc_codigos text[],p_usuario text default null)
returns table(fila public.historial_ops,vigente boolean,requiere_revision boolean)
language sql stable security invoker set search_path='' as $$
 with scoped as materialized (
   select h fila,lower(btrim(h.usuario)) usuario_key from public.historial_ops h
   where upper(btrim(h.pc_codigo))=any(p_pc_codigos)
     and (p_usuario is null or lower(btrim(h.usuario))=lower(btrim(p_usuario)))
 ), reversas as (
   select (s.fila).reversion_de id,s.usuario_key,count(*) n from scoped s
   where (s.fila).reversion_de is not null group by (s.fila).reversion_de,s.usuario_key
 )
 select s.fila,
   ((s.fila).reversion_de is null and r.n is null and operaciones.estado_confirmado_v1((s.fila).estado)),
   (((s.fila).reversion_de is not null and not coalesce(
      (b.fila).id is not null and (b.fila).reversion_de is null and upper(btrim((b.fila).estado))='REVERTIDA'
      and operaciones.estado_confirmado_v1((s.fila).estado) and abs((s.fila).monto)=abs((b.fila).monto)
      and ((upper((s.fila).tipo)='CARGA' and upper((b.fila).tipo)='RETIRO')
        or (upper((s.fila).tipo)='RETIRO' and upper((b.fila).tipo)='CARGA')),false))
    or (upper(btrim(coalesce((s.fila).estado,'')))='REVERTIDA' and coalesce(r.n,0)<>1))
 from scoped s
 left join reversas r on r.id=(s.fila).id and r.usuario_key is not distinct from s.usuario_key
 left join scoped b on (b.fila).id=(s.fila).reversion_de and b.usuario_key is not distinct from s.usuario_key;
$$;

create or replace function identidad.perfil_v1(p_pc_codigo text,p_usuario text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_pc text:=upper(btrim(p_pc_codigo)); v_u text:=lower(btrim(p_usuario)); v_pcs text[];
 v_h record; v_a record; v_v record; v_s record; v_n record;
begin
 if coalesce(length(v_u),0) not between 1 and 128 then
   raise exception using errcode='22023',message='BETA_INVALID_USER';
 end if;
 v_pcs:=acceso.oficinas_autorizadas(v_pc);
 with evaluadas as (
   select (e.fila).*,e.vigente,e.requiere_revision from operaciones.historial_evaluado_v1(v_pcs,v_u) e
 )
 select count(*) total_ops,
   count(*) filter(where upper(coalesce(h.tipo,''))='CARGA' and h.vigente) cargas,
   count(*) filter(where upper(coalesce(h.tipo,''))='RETIRO' and h.vigente) retiros,
   coalesce(sum(abs(h.monto)) filter(where upper(coalesce(h.tipo,''))='CARGA' and h.vigente),0) monto_cargas,
   coalesce(sum(abs(h.monto)) filter(where upper(coalesce(h.tipo,''))='RETIRO' and h.vigente),0) monto_retiros,
   count(*) filter(where not operaciones.estado_confirmado_v1(h.estado)) errores,
   coalesce(bool_or(h.requiere_revision),false) requiere_revision,
   count(*) filter(where h.reversion_de is not null) reversiones,
   max(h.created_at) ultima, min(h.created_at) primera,
   max(h.created_at) filter(where upper(coalesce(h.tipo,''))='CARGA' and h.vigente) ultima_carga,
   mode() within group(order by case
     when h.created_at is null then null
     when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') between 6 and 13 then 'TM'
     when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') between 14 and 21 then 'TT'
     else 'TN' end) turno
 into v_h from evaluadas h;
 select count(*) total_ops,
   count(*) filter(where o.tipo ilike '%deposito%' or o.tipo_normalizado ilike '%carga%' or o.tipo_normalizado ilike '%deposito%') cargas,
   count(*) filter(where o.tipo ilike '%retir%' or o.tipo_normalizado ilike '%retir%') retiros,
   coalesce(sum(o.cantidad) filter(where o.tipo ilike '%deposito%' or o.tipo_normalizado ilike '%carga%' or o.tipo_normalizado ilike '%deposito%'),0) monto_cargas,
   coalesce(sum(o.cantidad) filter(where o.tipo ilike '%retir%' or o.tipo_normalizado ilike '%retir%'),0) monto_retiros,
   max(o.fecha) ultima,
   max(o.fecha) filter(where o.tipo ilike '%deposito%' or o.tipo_normalizado ilike '%carga%' or o.tipo_normalizado ilike '%deposito%') ultima_carga
 into v_a from public.agente_operaciones_importadas o
 where upper(btrim(o.pc_codigo))=any(v_pcs)
   and lower(coalesce(nullif(btrim(o.alias),''),btrim(o.alias_norm)))=v_u;
 select
   (array_agg(v.telefono_canon order by (upper(btrim(v.pc_codigo))=v_pc) desc,v.id desc)
     filter(where coalesce(btrim(v.telefono_canon),'')<>''))[1] telefono,
   (array_agg(v.titular order by (upper(btrim(v.pc_codigo))=v_pc) desc,v.id desc)
     filter(where coalesce(btrim(v.titular),'')<>''))[1] titular,
   (array_agg(v.cbu_retiro order by (upper(btrim(v.pc_codigo))=v_pc) desc,v.id desc)
     filter(where coalesce(btrim(v.cbu_retiro),'')<>''))[1] cbu_retiro,
   (array_agg(v.estado_vinculo order by (upper(btrim(v.pc_codigo))=v_pc) desc,v.id desc))[1] estado_vinculo
 into v_v from public.usuarios_portal_vinculos v
 where upper(btrim(v.pc_codigo))=any(v_pcs) and lower(btrim(v.usuario))=v_u
   and coalesce(v.estado_vinculo,'')<>'DUPLICADO';
 select nullif(btrim(s.metadata->>'telefono'),'') telefono,nullif(btrim(s.metadata->>'titular'),'') titular
 into v_s from public.landing_solicitudes s
 where upper(btrim(s.pc_codigo))=any(v_pcs) and lower(btrim(s.usuario))=v_u
   and (coalesce(s.metadata->>'telefono','')<>'' or coalesce(s.metadata->>'titular','')<>'')
 order by s.created_at desc nulls last,s.id desc limit 1;
 select
   (select btrim(substring(h.notas from 'Titular:\s*([^·]+)')) from public.historial_ops h
    where upper(btrim(h.pc_codigo))=any(v_pcs) and lower(btrim(h.usuario))=v_u
      and h.notas ~ 'Titular:\s*[^·]+'
    order by h.created_at desc nulls last,h.id desc limit 1) titular,
   (select btrim((regexp_match(h.notas,'(CBU|Destino):[[:space:]]*([^·\n\r]+)','i'))[2]) from public.historial_ops h
    where upper(btrim(h.pc_codigo))=any(v_pcs) and lower(btrim(h.usuario))=v_u
      and upper(coalesce(h.tipo,''))='RETIRO' and operaciones.estado_confirmado_v1(h.estado)
      and h.reversion_de is null and h.notas ~* '(CBU|Destino):[[:space:]]*[^·\n\r]+'
      and not exists(select 1 from public.historial_ops r where r.reversion_de=h.id
        and upper(btrim(r.pc_codigo))=any(v_pcs) and lower(btrim(r.usuario))=v_u)
    order by h.created_at desc nulls last,h.id desc limit 1) cbu
 into v_n;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1',
   'scope',jsonb_build_object('pc_codigo',v_pc,'usuario',v_u,'pc_codigos',v_pcs),
   'resumen',jsonb_build_object('usuario',v_u,'totalOps',v_h.total_ops,'cargas',v_h.cargas,'retiros',v_h.retiros,
     'montoCargas',v_h.monto_cargas,'montoRetiros',v_h.monto_retiros,'neto',v_h.monto_cargas-v_h.monto_retiros,
     'errores',v_h.errores,'requiere_revision',v_h.requiere_revision,'reversiones',v_h.reversiones,
     'primeraOperacion',v_h.primera,'ultimaOperacion',v_h.ultima,'ultimaCarga',v_h.ultima_carga,
     'turnoFrecuente',coalesce(v_h.turno,'-'),'telefono',coalesce(nullif(v_v.telefono,''),v_s.telefono),
     'titular',coalesce(nullif(v_v.titular,''),v_s.titular,v_n.titular),'estadoVinculo',coalesce(v_v.estado_vinculo,'SIN VINCULO'),
     'cbu',coalesce(nullif(v_v.cbu_retiro,''),v_n.cbu),
     'cbu_fuente',case when nullif(v_v.cbu_retiro,'') is not null then 'VINCULO_DECLARADO'
       when v_n.cbu is not null then 'RETIRO_CONFIRMADO' else null end),
   'agente',jsonb_build_object('totalOps',v_a.total_ops,'cargas',v_a.cargas,'retiros',v_a.retiros,
     'montoCargas',v_a.monto_cargas,'montoRetiros',v_a.monto_retiros,'ultimaOperacion',v_a.ultima,'ultimaCarga',v_a.ultima_carga),
   'detalle_total',v_h.total_ops,'agente_total',v_a.total_ops,'generated_at',statement_timestamp());
end $$;

create or replace function operaciones.perfil_detalle_v1(
 p_pc_codigo text,p_usuario text,p_limit integer default 50,p_cursor jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_pc text:=upper(btrim(p_pc_codigo)); v_u text:=lower(btrim(p_usuario)); v_pcs text[];
 v_id bigint; v_at timestamptz; v_rows jsonb; v_more boolean; v_next jsonb;
begin
 if coalesce(length(v_u),0) not between 1 and 128 then
   raise exception using errcode='22023',message='BETA_INVALID_USER';
 end if;
 if p_limit is null or p_limit not between 1 and 100 then
   raise exception using errcode='22023',message='BETA_INVALID_LIMIT';
 end if;
 v_pcs:=acceso.oficinas_autorizadas(v_pc);
 if p_cursor is not null then
   if jsonb_typeof(p_cursor)<>'object' or not (p_cursor ? 'created_at' and p_cursor ? 'id')
      or (p_cursor - 'created_at' - 'id')<>'{}'::jsonb
      or coalesce(p_cursor->>'id','') !~ '^[1-9][0-9]{0,18}$'
      or jsonb_typeof(p_cursor->'id')<>'string'
      or jsonb_typeof(p_cursor->'created_at') not in ('string','null') then
     raise exception using errcode='22023',message='BETA_INVALID_CURSOR';
   end if;
   begin
     v_id:=(p_cursor->>'id')::bigint; v_at:=(p_cursor->>'created_at')::timestamptz;
     if v_at is not null and not isfinite(v_at) then raise invalid_datetime_format; end if;
   exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
     raise exception using errcode='22023',message='BETA_INVALID_CURSOR';
   end;
 end if;
 with selected as (
   select h.id,h.created_at,h.usuario,h.tipo,h.monto,h.origen,h.estado,h.notas,h.pc_codigo,
     h.worker_job_id,h.billetera_id,h.billetera_nombre,h.solicitud_id,h.mp_movimiento_id,
     h.monto_declarado,h.monto_aprobado,h.validacion_tipo,h.validacion_estado,h.saldo_pre,h.saldo_post,
     h.operador,h.chunior_movimiento_id,h.reversion_de
   from public.historial_ops h
   where upper(btrim(h.pc_codigo))=any(v_pcs) and lower(btrim(h.usuario))=v_u
     and (p_cursor is null or (v_at is null and h.created_at is null and h.id<v_id)
       or (v_at is not null and (h.created_at<v_at or h.created_at is null or (h.created_at=v_at and h.id<v_id))))
   order by h.created_at desc nulls last,h.id desc limit p_limit+1
 ), page as (
   select * from selected order by created_at desc nulls last,id desc limit p_limit
 )
 select coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('id',p.id::text,
     'worker_job_id',p.worker_job_id::text,'billetera_id',p.billetera_id::text,'solicitud_id',p.solicitud_id::text,
     'mp_movimiento_id',p.mp_movimiento_id::text,'reversion_de',p.reversion_de::text)
     order by p.created_at desc nulls last,p.id desc) from page p),'[]'::jsonb),
   (select count(*)>p_limit from selected),
   (select jsonb_build_object('created_at',p.created_at,'id',p.id::text) from page p
    order by p.created_at asc nulls first,p.id asc limit 1)
 into v_rows,v_more,v_next;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1',
   'scope',jsonb_build_object('pc_codigo',v_pc,'usuario',v_u,'pc_codigos',v_pcs),
   'rows',v_rows,'has_more',v_more,'next_cursor',case when v_more then v_next else null end);
end $$;

create or replace function public.nodo_beta_perfil_v1(p_token text,p_pc_codigo text,p_usuario text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform acceso.autorizar(p_token,p_pc_codigo);
 return identidad.perfil_v1(p_pc_codigo,p_usuario);
end $$;
create or replace function public.nodo_beta_perfil_detalle_v1(
 p_token text,p_pc_codigo text,p_usuario text,p_limit integer default 50,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform acceso.autorizar(p_token,p_pc_codigo);
 return operaciones.perfil_detalle_v1(p_pc_codigo,p_usuario,p_limit,p_cursor);
end $$;
revoke all on function operaciones.estado_confirmado_v1(text),operaciones.historial_evaluado_v1(text[],text),acceso.oficinas_autorizadas(text),identidad.perfil_v1(text,text),
 operaciones.perfil_detalle_v1(text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.nodo_beta_perfil_v1(text,text,text),
 public.nodo_beta_perfil_detalle_v1(text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.nodo_beta_perfil_v1(text,text,text),
 public.nodo_beta_perfil_detalle_v1(text,text,text,integer,jsonb) to anon,authenticated;
comment on schema identidad is 'Usuarios, vínculos y perfiles: datos con oficina y procedencia. Implementación privada.';
comment on schema operaciones is 'Historial y movimientos. Resúmenes completos y detalles paginados con autorización externa.';
comment on function identidad.perfil_v1(text,text) is 'Perfil de un usuario en la oficina autorizada y sus aliases verificados. Historial e importaciones separados: no se suman sin identidad común.';
comment on function operaciones.perfil_detalle_v1(text,text,integer,jsonb) is 'Detalle de historial para un usuario/oficina; cursor por fecha e ID, hasta 100 filas. Leer no cambia estados ni saldos.';
