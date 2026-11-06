-- Vuelta atrás operativa: detiene nuevas solicitudes beta sin borrar auditoría ni DNI fingerprints.
-- No revocar funciones mientras haya solicitudes VALIDADO/PENDIENTE: deben cerrarse desde un NODO
-- compatible. El responsable del corte decide cuándo se puede retirar el código después de vaciar la cola.
update retiros_privados.config_oficina set habilitado=false,updated_at=now();

-- Conservamos los RPC con beta-token para terminar casos ya creados y consultar evidencia.
-- No se ejecuta DROP SCHEMA: destruiría el registro de validaciones de retiros ya procesados.
