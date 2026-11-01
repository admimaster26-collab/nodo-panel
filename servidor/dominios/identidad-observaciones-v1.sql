-- Ejecutar después de perfil-v1.sql. Lectura de fuentes existentes; no copia ni
-- deduce identidades por teléfono, nombre, cuenta o IP compartida.
create or replace function identidad.observaciones_v1(p_pc_codigo text,p_usuario text)
returns table(id text,campo text,valor text,fuente text,fuente_id text,atributo text,
 fecha timestamptz,fecha_tipo text,pc_codigo text,usuario text,estado text)
language plpgsql stable security invoker set search_path='' as $$
declare v_pc text:=upper(btrim(p_pc_codigo));v_u text:=lower(btrim(p_usuario));v_pcs text[];
begin
 if coalesce(length(v_u),0) not between 1 and 128 then
   raise exception using errcode='22023',message='BETA_INVALID_USER';
 end if;
 v_pcs:=acceso.oficinas_autorizadas(v_pc);
 return query
 with datos as (
   select 'usuarios'::text fuente,u.id::text fuente_id,f.atributo,f.campo,f.valor,
     coalesce(u.updated_at,u.created_at) fecha,'ACTUALIZACION_REGISTRO'::text fecha_tipo,
     u.pc_codigo,u.usuario,'REGISTRO_ACTUAL'::text estado
   from public.usuarios u cross join lateral (values
     ('nombre_completo','nombre',u.nombre_completo),('nombre','nombre',u.nombre),
     ('nombre_transferencia','nombre',u.nombre_transferencia),('telefono','telefono',u.telefono),
     ('cbu_alias','cbu',u.cbu_alias)) f(atributo,campo,valor)
   where upper(btrim(u.pc_codigo))=any(v_pcs) and lower(btrim(u.usuario))=v_u
   union all
   select 'usuarios_portal_vinculos',v.id::text,f.atributo,f.campo,f.valor,
     coalesce(v.updated_at,v.created_at),'ACTUALIZACION_REGISTRO',v.pc_codigo,v.usuario,
     coalesce(v.estado_vinculo,'SIN_ESTADO')
   from public.usuarios_portal_vinculos v cross join lateral (values
     ('titular','nombre',v.titular),('cbu_titular','nombre',v.cbu_titular),
     ('telefono_canon','telefono',v.telefono_canon),('telefono_raw','telefono',v.telefono_raw),
     ('cbu_retiro','cbu',v.cbu_retiro)) f(atributo,campo,valor)
   where upper(btrim(v.pc_codigo))=any(v_pcs) and lower(btrim(v.usuario))=v_u
   union all
   select 'usuarios_cuentas_retiro',c.id::text,f.atributo,f.campo,f.valor,
     coalesce(c.updated_at,c.created_at),'ACTUALIZACION_REGISTRO',c.pc_codigo,c.usuario,
     coalesce(c.estado,'SIN_ESTADO')
   from public.usuarios_cuentas_retiro c cross join lateral (values
     ('titular','nombre',c.titular),('alias_cbu','cbu',c.alias_cbu)) f(atributo,campo,valor)
   where upper(btrim(c.pc_codigo))=any(v_pcs) and lower(btrim(c.usuario))=v_u
   union all
   select 'usuarios_portal_eventos',e.id::text,f.atributo,f.campo,f.valor,
     e.created_at,'EVENTO',e.pc_codigo,e.usuario,concat(e.evento,':',f.etapa)
   from public.usuarios_portal_eventos e cross join lateral (values
     ('telefono_anterior','telefono',e.telefono_anterior,'ANTERIOR'),
     ('telefono_nuevo','telefono',e.telefono_nuevo,'NUEVO'),
     ('titular','nombre',e.titular,'OBSERVADO')) f(atributo,campo,valor,etapa)
   where upper(btrim(e.pc_codigo))=any(v_pcs) and lower(btrim(e.usuario))=v_u
   union all
   select 'landing_solicitudes',s.id::text,f.atributo,f.campo,f.valor,
     s.created_at,'SOLICITUD',s.pc_codigo,s.usuario,coalesce(s.estado,'SIN_ESTADO')
   from public.landing_solicitudes s cross join lateral (values
     ('telefono','telefono',s.telefono),('metadata.telefono','telefono',s.metadata->>'telefono'),
     ('metadata.titular','nombre',s.metadata->>'titular'),('metadata.nombre_completo','nombre',s.metadata->>'nombre_completo'),
     ('metadata.ip','ip',s.metadata->>'ip'),('metadata.cbu','cbu',s.metadata->>'cbu'),
     ('metadata.cbu_alias','cbu',s.metadata->>'cbu_alias'),('metadata.alias_cbu','cbu',s.metadata->>'alias_cbu'),
     ('metadata.retiro_alias_cbu','cbu',s.metadata->>'retiro_alias_cbu'),('metadata.destino','cbu',s.metadata->>'destino')) f(atributo,campo,valor)
   where upper(btrim(s.pc_codigo))=any(v_pcs) and lower(btrim(s.usuario))=v_u
   union all
   select 'chat_sesiones',c.id::text,'telefono','telefono',c.telefono,
     c.created_at,'SESION',c.pc_codigo,c.usuario,coalesce(c.estado,'SIN_ESTADO')
   from public.chat_sesiones c
   where upper(btrim(c.pc_codigo))=any(v_pcs) and lower(btrim(c.usuario))=v_u
   union all
   select 'historial_ops',h.id::text,f.atributo,f.campo,f.valor,
     h.created_at,'OPERACION',h.pc_codigo,h.usuario,coalesce(h.estado,'SIN_ESTADO')
   from public.historial_ops h cross join lateral (values
     ('notas.Titular','nombre',btrim(substring(h.notas from 'Titular:\s*([^·]+)'))),
     ('notas.Destino','cbu',btrim((regexp_match(h.notas,'(CBU|Destino):[[:space:]]*([^·\n\r]+)','i'))[2]))) f(atributo,campo,valor)
   where upper(btrim(h.pc_codigo))=any(v_pcs) and lower(btrim(h.usuario))=v_u
 )
 select concat(d.fuente,'/',d.fuente_id,'/',d.atributo),d.campo,d.valor,d.fuente,d.fuente_id,d.atributo,
   d.fecha,d.fecha_tipo,d.pc_codigo,lower(btrim(d.usuario)),d.estado
 from datos d where coalesce(btrim(d.valor),'')<>'';
 -- Sólo observaciones locales con oficina atribuida. La vista se instala con la
 -- persistencia local; su ausencia significa que esa integración aún no existe.
 if to_regclass('identidad.observaciones_locales') is not null then
   return query execute $local$
     select concat('local/',o.client_id::text,'/',o.source_id,'/',o.campo),o.campo,o.valor,o.fuente,
       o.source_id,o.campo,o.fecha,'OBSERVACION_LOCAL'::text,o.pc_codigo,lower(btrim(o.usuario)),o.estado
     from identidad.observaciones_locales o
     where upper(btrim(o.pc_codigo))=any($1) and lower(btrim(o.usuario))=$2 and coalesce(btrim(o.valor),'')<>''
   $local$ using v_pcs,v_u;
 end if;
end $$;

create or replace function identidad.perfil_identidad_v1(
 p_pc_codigo text,p_usuario text,p_limit integer default 50,p_cursor jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_pc text:=upper(btrim(p_pc_codigo));v_u text:=lower(btrim(p_usuario));v_pcs text[];
 v_id text;v_at timestamptz;v_rows jsonb;v_more boolean;v_next jsonb;v_total bigint;
begin
 if coalesce(length(v_u),0) not between 1 and 128 then raise exception using errcode='22023',message='BETA_INVALID_USER';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='BETA_INVALID_LIMIT';end if;
 v_pcs:=acceso.oficinas_autorizadas(v_pc);
 if p_cursor is not null then
   if jsonb_typeof(p_cursor)<>'object' or not (p_cursor ? 'fecha' and p_cursor ? 'id')
      or (p_cursor-'fecha'-'id')<>'{}'::jsonb or jsonb_typeof(p_cursor->'id')<>'string'
      or coalesce(length(p_cursor->>'id'),0) not between 1 and 1024
      or jsonb_typeof(p_cursor->'fecha') not in ('string','null') then
     raise exception using errcode='22023',message='BETA_INVALID_CURSOR';
   end if;
   begin
     v_id:=p_cursor->>'id';v_at:=(p_cursor->>'fecha')::timestamptz;
     if v_at is not null and not isfinite(v_at) then raise invalid_datetime_format;end if;
   exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
     raise exception using errcode='22023',message='BETA_INVALID_CURSOR';
   end;
 end if;
 with all_rows as materialized(select * from identidad.observaciones_v1(v_pc,v_u)),
 selected as (
   select o.* from all_rows o where p_cursor is null
     or (v_at is null and o.fecha is null and o.id collate "C"<v_id collate "C")
     or (v_at is not null and (o.fecha<v_at or o.fecha is null or (o.fecha=v_at and o.id collate "C"<v_id collate "C")))
   order by o.fecha desc nulls last,o.id collate "C" desc limit p_limit+1
 ), page as (select * from selected order by fecha desc nulls last,id collate "C" desc limit p_limit)
 select (select count(*) from all_rows),
   coalesce((select jsonb_agg(to_jsonb(p) order by p.fecha desc nulls last,p.id collate "C" desc) from page p),'[]'::jsonb),
   (select count(*)>p_limit from selected),
   (select jsonb_build_object('fecha',p.fecha,'id',p.id) from page p order by p.fecha asc nulls first,p.id collate "C" asc limit 1)
 into v_total,v_rows,v_more,v_next;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1',
   'scope',jsonb_build_object('pc_codigo',v_pc,'usuario',v_u,'pc_codigos',v_pcs),
   'total',v_total,'rows',v_rows,'has_more',v_more,'next_cursor',case when v_more then v_next else null end,
   'locales_disponibles',to_regclass('identidad.observaciones_locales') is not null);
end $$;
create or replace function public.nodo_beta_perfil_identidad_v1(
 p_token text,p_pc_codigo text,p_usuario text,p_limit integer default 50,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform acceso.autorizar(p_token,p_pc_codigo);
 return identidad.perfil_identidad_v1(p_pc_codigo,p_usuario,p_limit,p_cursor);
end $$;
revoke all on function identidad.observaciones_v1(text,text),identidad.perfil_identidad_v1(text,text,integer,jsonb),
 public.nodo_beta_perfil_identidad_v1(text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.nodo_beta_perfil_identidad_v1(text,text,text,integer,jsonb) to anon,authenticated;
comment on function identidad.observaciones_v1(text,text) is 'Valores observados de un usuario/oficina con fuente y fecha. Actualización de fila no prueba fecha de cambio de un campo. Una IP compartida no vincula usuarios. No expone claves.';
