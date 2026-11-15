-- ===========================================================================================
-- VUELTA ATRAS de la migracion textos_al_jugador_cajero_v1 (13/11)
--
-- Devuelve los textos que lee el jugador a como estaban: "oficina", "operador" y "Agentes".
-- Misma tecnica que la ida: lee la definicion viva y reemplaza SOLO la cadena, asi no se
-- pisa ningun cambio de logica que haya entrado despues. Si una cadena no esta, se cae y no
-- cambia nada.
--
-- Esto es para volver atras, NO para correr de vuelta: los textos nuevos son lo que Juan pidio.
-- ===========================================================================================
do $$
declare
  cambios text[][] := array[
    ['soporte_auto_mensaje_v1(text,text,text,timestamp with time zone)',
     ' minutos. Tu cajero la está revisando.',
     ' minutos. Un operador la está verificando.'],
    ['soporte_auto_mensaje_v1(text,text,text,timestamp with time zone)',
     'Recibimos tu pedido. Tu cajero te crea el usuario y te escribe por acá.',
     'Recibimos tu pedido. Un operador te va a crear el usuario y te escribe por acá.'],
    ['soporte_auto_mensaje_v1(text,text,text,timestamp with time zone)',
     'Recibimos tus datos. Tu cajero los revisa y te habilita el acceso desde acá.',
     'Recibimos tus datos. Un operador los verifica y te habilita el acceso desde acá.'],
    ['soporte_auto_mensaje_v1(text,text,text,timestamp with time zone)',
     'Vemos que estás teniendo un problema con la aplicación. Tu cajero te escribe por acá ',
     'Vemos que estás teniendo un problema con la aplicación. Un operador te escribe por acá '],
    ['soporte_autorespuesta_v1(text,interval,boolean)',
     'Recibimos tu comprobante. Tu cajero lo está revisando.',
     'Recibimos tu comprobante. Un operador lo está verificando.'],
    ['landing_portal_resolver_vinculo(text,text,text)',
     'Tu usuario no figura entre los de tu cajero. Escribinos por acá y te registramos.',
     'Tu usuario no figura en la base de tu oficina. Escribinos por soporte para registrarte.'],
    ['landing_portal_resolver_vinculo(text,text,text)',
     'Usuario registrado. Tu primera operación la valida tu cajero.',
     'Usuario registrado. Tu primera operación la valida un operador.'],
    ['landing_obtener_cuenta_retiro(text,text,text)',
     'Todavía no revisamos esta cuenta para cobrar. Se usa esta hasta que tu cajero la mire.',
     'Cuenta de retiro pendiente de verificación. Se usará esta cuenta hasta que el operador la revise.'],
    ['landing_confirmar_datos_usuario(bigint,text,text,text,text,text)',
     'Tu usuario todavía no está validado',
     'El usuario todavía no fue validado en Agentes'],
    ['landing_crear_solicitud_v2(text,text,text,text,bigint,text,text,numeric,text,text,text,text,text,text,bigint)',
     'Tu usuario todavía no está validado. Validalo antes de enviar el pedido.',
     'Usuario no validado en Agentes. Volvé a validar antes de enviar la solicitud.'],
    ['landing_crear_solicitud_v2(text,text,text,text,text,text,numeric,bigint,text,text,text,text,text,text)',
     'Tu usuario todavía no está validado',
     'Usuario no validado en Agentes']
  ];
  i int;
  v_fn text; v_de text; v_a text; v_def text;
begin
  for i in 1 .. array_length(cambios, 1) loop
    v_fn := cambios[i][1]; v_de := cambios[i][2]; v_a := cambios[i][3];
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if position(v_de in v_def) = 0 then
      raise exception 'No encontre el texto en %: "%"', v_fn, left(v_de, 60);
    end if;
    execute replace(v_def, v_de, v_a);
  end loop;
end $$;
