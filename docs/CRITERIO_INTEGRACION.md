# Criterio para trabajar sobre NODO

Contexto: Electron + Supabase + Portal/Chunior; turnos intensivos de ocho horas y meses de uso real. Conviven versiones. Un cambio se entiende siguiendo sus datos y efectos entre componentes, incluso cuando la tarea se inicia en una sola pantalla.

## Lo que falló en nuestra forma de trabajar

Confundimos infraestructura disponible con integración terminada, inventario con cobertura comprobada y mejoras parciales con avance suficiente del alcance completo. La documentación y la exploración crecieron más rápido que los circuitos cerrados. La falta de observación podía quedar invisible, lo que favorecía conclusiones demasiado optimistas.

## Anclas para razonar y comprobar

- **Alcance y evidencia son cosas distintas.** Ejecutar por partes no reduce el compromiso global. Cada conclusión debe indicar qué circuito y qué versión se observaron; lo restante sigue abierto y localizable.
- **Seguir la información hasta su uso.** Entender quién produce, quién autoriza, dónde persiste, quién consume y qué efecto visible resulta. Una función existente, una conexión válida o una respuesta HTTP no demuestran por sí solas un resultado correcto.
- **El silencio no es salud.** Sin muestra vigente hay incertidumbre. Conexión, datos, efecto y representación tienen pruebas distintas; un éxito previo no confirma un intento nuevo. La observación por rama no certifica todas sus funciones.
- **Un mecanismo reconocible.** `window.NodoSalud?.begin('RAMA')` es la firma común. El motor interpreta evidencia; no sustituye la instrumentación ni necesita acumular reglas especiales por cada función. Una lectura no debe inventar un efecto de escritura para verse completa.
- **Corregir la causa donde vive.** Examinar contratos y responsabilidades antes de sumar excepciones o rutas paralelas. Conservar compatibilidad no obliga a duplicar datos ni escritores. Preguntar al usuario sólo por decisiones de negocio que la evidencia disponible no resuelva.
- **Diseño con referencias reales.** Antes de diseñar o rehacer UI, buscar en la web ejemplos reales con palabras clave cortas, evaluar su ergonomía y adaptarlos al uso prolongado. Respetar la memoria muscular de acciones críticas sin perpetuar diseños rotos por falsa concordancia.
- **Contexto suficiente y reutilizable.** Empezar por continuidad y símbolos; ampliar ante una dependencia concreta. Delegar preguntas y archivos delimitados. Guardar evidencia consultable, evitando repetir el mismo contexto completo o mantener manualmente otro índice enorme.
- **Cerrar con límites explícitos.** Separar fuente local, pruebas aisladas, conexión remota, despliegue y funcionamiento observado. Los fallos del corte completo deben informarse aunque estén fuera del cambio propio. Una corrección parcial se identifica como parcial.

## Coste observado y cómo razonar con menos contexto

1. **Explorar sin una pregunta comprobable** hizo crecer las lecturas antes que los resultados. Un recorrido útil termina en una hipótesis, una prueba y un consumidor concreto.
2. **Dar por buenos resúmenes anteriores** obligó a reabrir trabajo supuestamente terminado. La continuidad conserva evidencia y dudas; no reemplaza el contrato ni la ejecución.
3. **Delegar contexto completo repetidamente** duplicó comprensión y dejó entregas a medias al agotarse la cuota. Cada encargo necesita límites, dependencias y una prueba de salida; el coordinador conserva la visión global.
4. **Validar copias incompletas o de momentos diferentes** produjo fallos artificiales y repeticiones. El corte debe incluir sus dependencias y hashes antes de atribuir un fallo al producto.
5. **Volcar salidas largas y usar comandos frágiles** gastó contexto en ruido y reparaciones. Consultas acotadas, artefactos legibles y resultados breves preservan capacidad para analizar causas.

Estas son causas observadas del trabajo, no una medición del coste facturado. Este documento no declara terminada la integración completa.
