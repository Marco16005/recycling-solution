# Simulación reproducible (Planes 3 y 8)

`scripts/simular.mts` genera `resultados.md` y `resultados.csv` aquí con la semilla fija 20261014. Claude ejecuta el script con `tsx` dentro del contenedor del proyecto Compose `rs-<rama>`; no requiere instalar paquetes adicionales. Dos corridas dan el mismo CSV.

Es el escenario del Documento Integrador. Desde el Plan 8 se corre dos veces con las mismas solicitudes nuevas de cada día: con el motor 1.1.0 (la admisión sola, `admitir`) y con el 1.2.0 (admisión, reacomodo, readmisión con tolerancia de 15 min y reacomodo final, `generarPlan`); cada versión arrastra sus propias pospuestas. Además del escenario de 15 unidades, se corre una flota reducida de 8 unidades, donde sí hay pospuestas y se ve la readmisión.

La corrida incluye 100 clientes sintéticos en un radio de 15 km, ventanas de 2 a 6 h, servicio de 66 min, cargas de 300 a 3000 kg y 15 unidades doble rodada de 8000 kg. Se generan 50–60 solicitudes nuevas por jornada durante 20 días de operación, de lunes a sábado, desde el 1 de octubre de 2026. Los domingos no se opera ni se generan solicitudes. Las solicitudes nuevas se registran entre las 06:00 y las 07:59 de la jornada; las pospuestas pasan al siguiente día de operación sin modificar su registro. Se conserva la igualdad nuevas = atendidas + bloqueadas + pendientes únicas al cierre. El reporte distingue la suma de decisiones de posposición del número de solicitudes únicas pendientes al cierre, y porcentajes sobre totales acumulados. Desde el Plan 8 el reporte compara las dos versiones por día (atendidas, pospuestas, readmitidas, alarga la jornada, tiempo muerto y km) y ya no trae los viajes por unidad.

Los resultados son ahorro **simulado** con distancias y tiempos estimados. El método actual se calcula sobre las mismas solicitudes atendidas, sin afirmar que pudiera atenderlas todas dentro del turno. No se incluyen cifras antes de ejecutar la simulación.

## Decisiones de implementación para revisión

- Costo de inserción: incremento del fin de descarga del último viaje de la unidad; incluye servicio, espera y propagación a viajes posteriores. No se abren viajes nuevos mientras exista una inserción factible en un viaje existente.
- Desempates: costo, pertenencia a la zona, id de unidad, número de viaje y posición. Para viajes nuevos se minimiza la hora final absoluta, con los mismos desempates restantes.
- Zonas: proyección local en kilómetros, inicialización k-means++ con Mulberry32, máximo 100 iteraciones. Los grupos vacíos reciben el punto más alejado de su centro actual entre grupos con más de un punto; los empates usan el orden FIFO de los puntos. Las unidades ordenadas por id se asocian cíclicamente a las zonas cuando hay más unidades que solicitudes.
- Ventanas: se usa el inicio factible más temprano, con desempate por apertura y cierre. Se permite terminar el servicio después del cierre.
- Diagnóstico: cada posición descartada cuenta una causa principal (capacidad, ventana o fin de turno); `afectaAOtra` es un contador adicional cuando el fallo afecta una parada anterior admitida o un viaje posterior. No debe sumarse con los otros tres para contar posiciones.
- FIFO usa el instante ISO con su desfase explícito, después folio e id por orden de código, sin depender de configuración regional. No modifica las entradas.
- Las rutas incluyen todas las unidades en orden de id; una unidad sin trabajo tiene `viajes: []`. Una unidad con carga inicial siempre tiene su viaje de regreso y descarga.
- Si el regreso obligatorio ya es inviable por turno o carga, el motor lanza error. El contrato no tiene un resultado para omitir esa obligación: quien prepara el re-ruteo debe resolver ese estado.
- La comparación en re-ruteo incluye el traslado de regreso de la carga congelada dentro del motor, pero el método actual solo cuenta solicitudes nuevas ruteadas, tal como indica el contrato. La simulación usa unidades descargadas al inicio.
- `validarPlan` reconstruye horarios y estados de la traza de manera independiente y compara el resultado canónico. Solo comparte las dos fórmulas geométricas con la admisión. No pretende validar propuestas editadas manualmente con esperas voluntarias: esas propuestas no son una reproducción de esta traza.

## Verificación pendiente en contenedor

Ejecutar tipos, lint, pruebas de unidad (incluidos `src/motor/*.test.ts`) y la simulación. La prueba de rendimiento mide una llamada completa a `generarPlan`, incluida su validación, para 60 solicitudes y 15 unidades y exige menos de 1000 ms. Las pruebas generativas usan semillas fijas, hasta 25 solicitudes y 5 unidades, ventanas múltiples y unidades con carga inicial; también se prueban alteraciones deliberadas de planes y trazas.
