-- Saca el monitor de canales (fase 0). No toca nada de lo que usan las oficinas.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'monitor-canales';
  end if;
end $$;
drop function if exists public.admin_canales_estado_v1(text);
drop schema if exists nodo_monitor cascade;
