-- Vuelta atrás del despliegue de servidor/dominios: perfil, persistencia, identidad, lecturas y capacidades.
-- Saca lo que ese despliegue agregó y deja nodo_beta_capacidades_v1 con el cuerpo del corte del 1/11
-- (md5 6f24ecebcca32d56fb79011893acf0e3). No toca ninguna tabla que existiera antes.
-- Lo único que se pierde es lo que los NODO hayan sincronizado a las tablas locales nuevas.

drop function if exists public.nodo_beta_perfil_v1(text,text,text);
drop function if exists public.nodo_beta_perfil_detalle_v1(text,text,text,integer,jsonb);
drop function if exists public.nodo_beta_perfil_identidad_v1(text,text,text,integer,jsonb);
drop function if exists public.nodo_beta_persistencia_sync_v1(text,text,text,text,jsonb);
drop function if exists public.nodo_beta_persistencia_leer_v1(text,text,text,text,text,integer,jsonb);
drop function if exists public.nodo_beta_historial_v1(text,text,jsonb,integer,jsonb);
drop function if exists public.nodo_beta_bandeja_v1(text,text,jsonb,integer,jsonb);
drop function if exists public.nodo_beta_nexo_export_v1(text,text,integer,jsonb);

CREATE OR REPLACE FUNCTION public.nodo_beta_capacidades_v1(p_token text, p_pc_codigo text, p_build text DEFAULT NULL::text, p_activate boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_c nodo_beta.beta_clientes;
begin
 v_id:=nodo_beta.autorizar(p_token,p_pc_codigo);
 if p_activate then
   if p_build is null or p_build !~ '^[A-Za-z0-9._+/-]{1,128}$' then
     raise exception using errcode='22023',message='BETA_BUILD_REQUIRED';
   end if;
   update nodo_beta.beta_clientes set active_build=p_build,active_contract='nodo.beta.v1',
      activated_at=now(),last_seen=now() where id=v_id;
 end if;
 select * into v_c from nodo_beta.beta_clientes where id=v_id;
 return jsonb_build_object('ok',true,'contract','nodo.beta.v1',
   'capabilities',jsonb_build_array('chat.list.v1','chat.messages.v1','chat.read.v1','chat.send.v1','health.v1','portal.seen.v1'),
   'scope',jsonb_build_object('pc_codigo',v_c.pc_codigo),
   'active',coalesce(v_c.active_contract='nodo.beta.v1' and v_c.last_seen>now()-interval '5 minutes',false),
   'build',v_c.active_build,'lease_seconds',300,
   'limits',jsonb_build_object('list',100,'messages',100,'ack',100,'health',32));
end $function$;

drop schema if exists operaciones cascade;
drop schema if exists identidad cascade;
drop schema if exists acceso cascade;
