-- Saca lo que agregó beta-ingresos-revisiones-v1.sql. No toca ninguna tabla que existiera antes: sólo borra
-- las funciones nuevas, la anotación de ingresos y los índices nuevos, y deja el control de salud como estaba.
-- Se pierde lo anotado en identidad.ingresos_portal.
-- Si el Portal nuevo ya está publicado, vuelve solo al resolvedor de siempre (cae a landing_portal_resolver_vinculo
-- cuando landing_portal_ingreso_v1 no existe).

drop function if exists public.admin_revisiones_v1(text,text);
drop function if exists public.nodo_beta_prevalidar_v1(text,text,text,text);
drop function if exists public.nodo_beta_revisiones_v1(text,text);
drop function if exists public.nodo_beta_ingresos_v1(text,text,integer);
drop function if exists public.landing_portal_ingreso_v1(text,text,text,text);
drop function if exists identidad.prevalidar_v1(text[],text,text);
drop function if exists operaciones.revisiones_v1(text[]);
drop function if exists identidad.ingresos_v1(text[],integer);
drop table if exists identidad.ingresos_portal;

drop index if exists public.vinculos_pc_tel8;
drop index if exists public.vinculos_pc_usuario_norm;
drop index if exists public.vinculos_pc_no_vinculados;

do $$
begin
  if to_regclass('nodo_beta.salud_actual') is not null then
    delete from nodo_beta.salud_actual where integration in ('PERSISTENCIA','CRM','INGRESOS','REVISIONES');
    alter table nodo_beta.salud_actual drop constraint if exists salud_actual_integration_check;
    alter table nodo_beta.salud_actual add constraint salud_actual_integration_check check (integration in (
      'CHAT','PORTAL','TELEMETRIA','CAPACIDADES','BANDEJA','IDENTIDAD','HISTORIAL','BILLETERAS','RETIROS','VALIDACION',
      'WORKERS','AUTOMATISMOS','CONCILIACION','NEXO','ADMIN','CONEXION'));
  end if;
end $$;
