-- ============================================================
-- NODO · ¿Supabase tiene TODAS las RPC que llama el nodo del colega?
-- Lista las 37 RPC que invoca su panel y muestra si existen + su firma actual.
-- Las que NO aparezcan en el resultado = NO existen → "Supa no responde".
-- ============================================================
select p.proname as rpc,
       pg_get_function_identity_arguments(p.oid) as argumentos_actuales,
       pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('crear_job_sync_desde_operativo','debug_listar_jobs_operativos_pendientes','landing_crear_chat_v2','liberar_jobs_vencidos','marcar_job_error','marcar_job_error_final','marcar_job_ok','marcar_job_ok_parcial','marcar_job_procesando','nodo_seleccionar_billetera_portal','panel_billetera_ajustar_saldo','panel_billetera_insert','panel_billetera_update','panel_core_enviar_chat_json','panel_core_get_chat_mensajes_json','panel_core_get_chat_sesiones_json','panel_crm_agente_resumen','panel_crm_flags','panel_listar_jobs_recientes','panel_nodo_list_billeteras','panel_nodo_send_chat_message','panel_nodo_sync_chunior_wallets','panel_promo_primer_ingreso','panel_registrar_actividad','panel_resolver_puesto','panel_v154_plus_enviar_chat','panel_v154_plus_get_chat_mensajes','panel_v154_plus_listar_chat_sesiones','panel_v15_5_actualizar_solicitud_portal','panel_v15_5_listar_solicitudes_portal','panel_vincular_usuario','panel_vinculo_confirmar','tomar_job_operativo','tomar_job_sync','worker_guardar_saldo_agente','worker_heartbeat','worker_registrar_chunior_sync')
order by p.proname;

-- Contraparte: cuáles de esas 37 FALTAN (no existen en la base).
with esperadas(rpc) as (values ('crear_job_sync_desde_operativo'),('debug_listar_jobs_operativos_pendientes'),('landing_crear_chat_v2'),('liberar_jobs_vencidos'),('marcar_job_error'),('marcar_job_error_final'),('marcar_job_ok'),('marcar_job_ok_parcial'),('marcar_job_procesando'),('nodo_seleccionar_billetera_portal'),('panel_billetera_ajustar_saldo'),('panel_billetera_insert'),('panel_billetera_update'),('panel_core_enviar_chat_json'),('panel_core_get_chat_mensajes_json'),('panel_core_get_chat_sesiones_json'),('panel_crm_agente_resumen'),('panel_crm_flags'),('panel_listar_jobs_recientes'),('panel_nodo_list_billeteras'),('panel_nodo_send_chat_message'),('panel_nodo_sync_chunior_wallets'),('panel_promo_primer_ingreso'),('panel_registrar_actividad'),('panel_resolver_puesto'),('panel_v154_plus_enviar_chat'),('panel_v154_plus_get_chat_mensajes'),('panel_v154_plus_listar_chat_sesiones'),('panel_v15_5_actualizar_solicitud_portal'),('panel_v15_5_listar_solicitudes_portal'),('panel_vincular_usuario'),('panel_vinculo_confirmar'),('tomar_job_operativo'),('tomar_job_sync'),('worker_guardar_saldo_agente'),('worker_heartbeat'),('worker_registrar_chunior_sync'))
select e.rpc as rpc_que_falta
from esperadas e
left join pg_proc p on p.proname=e.rpc
left join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
where p.oid is null
order by e.rpc;
