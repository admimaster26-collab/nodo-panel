-- ⚠ NO PUBLICADO TODAVÍA (18/11): la publicación fue rechazada; espera la orden de Juan. Ensayado en PGlite.
-- La regla de "un retiro cada 24 horas" es UNA sola: la Blacklist 24h de NODO, en el servidor.
--
-- Juan, 18/11: "¿por qué hay 3 herramientas que hacen lo mismo de 3 maneras distintas? La blacklist era la
-- idea de unificación. Si está en la blacklist no debería poder pedir retiro, y si el operador decide
-- sacarlo de la blacklist debería blanquearse el usuario."
--
-- Antes había tres reglas distintas:
--   · el Portal contaba en el TELÉFONO desde que el jugador PEDÍA (aunque se lo rechazaran; se perdía al
--     cambiar de teléfono o borrar datos);
--   · NODO, al pagar, miraba tres fuentes (solicitudes pagadas, historial y un CSV) y sólo avisaba;
--   · la Blacklist 24h miraba el historial y se podía "excluir" un retiro, pero eso no destrababa a nadie.
-- Ahora la regla es la de la blacklist, en un solo lugar (retiro_blacklist_24h):
--   está en la blacklist = cobró un retiro en las últimas 24 h (historial_ops RETIRO OK), sin contar los
--   pagos en partes ni lo que el cajero sacó de la blacklist ([BL_EXCLUIDO]). Por usuario, todas las oficinas
--   (igual que el cuadro de la blacklist: busca reincidencia cruzada).
-- La usan: el servidor al recibir un pedido de retiro (disparador: no se puede pedir), el Portal para avisar
-- antes del formulario, y NODO al pagar. Sacarlo de la blacklist (en el cuadro o al confirmar en NODO) lo
-- destraba para todos a la vez.
-- Vuelta atrás: servidor/retiro-blacklist-unica.vuelta-atras.sql.

create or replace function public.retiro_blacklist_24h(p_usuario text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select jsonb_build_object('bloqueado', true, 'historial_id', h.id, 'retiro_at', h.created_at,
             'hasta', h.created_at + interval '24 hours', 'monto', h.monto,
             'billetera_nombre', h.billetera_nombre, 'pc_codigo', h.pc_codigo)
      from public.historial_ops h
     where lower(btrim(h.usuario)) = lower(btrim(coalesce(p_usuario,'')))
       and h.tipo = 'RETIRO' and h.estado = 'OK'
       and h.created_at > now() - interval '24 hours'
       and coalesce(h.notas,'') !~* 'PARCIAL'
       and coalesce(h.notas,'') !~ '\[BL_EXCLUIDO\]'
     order by h.created_at desc
     limit 1),
    jsonb_build_object('bloqueado', false))
$$;
comment on function public.retiro_blacklist_24h(text) is
  'Blacklist 24h: ¿cobró un retiro en las últimas 24 h (sin parciales ni excluidos)? Única regla del retiro diario. 18/11.';
revoke all on function public.retiro_blacklist_24h(text) from public, anon, authenticated;

-- El servidor no deja crear el pedido. Va en la tabla: lo cubre cualquier Portal y cualquier camino.
create or replace function public.trg_retiro_blacklist_24h()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  v := public.retiro_blacklist_24h(new.usuario);
  if coalesce((v->>'bloqueado')::boolean, false) then
    raise exception 'RETIRO_24H:%',
      to_char(((v->>'hasta')::timestamptz) at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI');
  end if;
  return new;
end $$;

drop trigger if exists trg_retiro_blacklist_24h on public.landing_solicitudes;
create trigger trg_retiro_blacklist_24h
  before insert on public.landing_solicitudes
  for each row when (upper(coalesce(new.tipo,'')) = 'RETIRO')
  execute function public.trg_retiro_blacklist_24h();

-- Para el Portal: avisa antes del formulario. Sólo contesta al dueño de la cuenta (usuario + teléfono
-- vinculados); a cualquier otro le dice que no hay bloqueo, para no contar quién cobró.
create or replace function public.landing_retiro_disponible_v1(p_public_code text, p_usuario text, p_telefono text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_pc text; v_vinc jsonb; v jsonb;
begin
  select r.pc_codigo into v_pc from public.landing_rutas_publicas r
   where lower(coalesce(r.public_code,'')) = lower(btrim(coalesce(p_public_code,''))) and coalesce(r.activo,true) limit 1;
  if v_pc is null then return jsonb_build_object('ok', true, 'bloqueado', false); end if;
  v_vinc := public.landing_portal_resolver_vinculo(v_pc, p_usuario, coalesce(p_telefono,''));
  if upper(coalesce(v_vinc->>'verdict','')) <> 'ACCESO' then return jsonb_build_object('ok', true, 'bloqueado', false); end if;
  v := public.retiro_blacklist_24h(p_usuario);
  return jsonb_build_object('ok', true, 'bloqueado', coalesce((v->>'bloqueado')::boolean,false), 'hasta', v->>'hasta');
end $$;
grant execute on function public.landing_retiro_disponible_v1(text,text,text) to anon, authenticated;

-- Para NODO: la misma regla al pagar, y sacar de la blacklist (destraba al jugador en todos lados).
create or replace function public.panel_retiro_blacklist_v1(p_secret text, p_usuario text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  return jsonb_build_object('ok', true) || public.retiro_blacklist_24h(p_usuario);
end $$;

create or replace function public.panel_retiro_blacklist_excluir(p_secret text, p_historial_id bigint, p_operador text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n int;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  update public.historial_ops
     set notas = btrim(coalesce(notas,'') || ' [BL_EXCLUIDO]'
                 || case when nullif(btrim(coalesce(p_operador,'')),'') is null then '' else ' por ' || btrim(p_operador) end)
   where id = p_historial_id and tipo = 'RETIRO' and coalesce(notas,'') !~ '\[BL_EXCLUIDO\]';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'excluido', v_n = 1);
end $$;
