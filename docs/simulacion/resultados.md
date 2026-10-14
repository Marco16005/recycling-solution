# Simulación del motor 1.0.0

Datos exclusivamente sintéticos. Semilla: 20261014. Escenario del Documento Integrador: veinte días de operación, de lunes a sábado, del 2026-10-01 al 2026-10-23; los domingos no se opera ni se generan solicitudes. Cien clientes dentro de un radio de 15 km de un patio hipotético en El Marqués, ventanas de 2 a 6 horas, servicio de 66 min, cargas de 300 a 3000 kg y quince unidades doble rodada de 8000 kg. Cada día de operación se agregan 50 a 60 solicitudes registradas ese mismo día antes del turno; las pospuestas se vuelven a intentar conservando su registro y ventanas. Turno 08:00–16:00, velocidad 30 km/h, circuidad 1.3 y descarga de 15 min.

Es un ahorro **simulado**, con tiempos estimados; no constituye ahorro observado ni evidencia de cumplimiento de K4. Se comparan las mismas solicitudes atendidas: un viaje redondo patio–cliente–patio por cada una en el método actual. La comparación no demuestra que el método actual pudiera atenderlas todas dentro del turno. Los minutos de traslado excluyen servicio, espera y descarga, y se redondean hacia arriba por tramo.

| Fecha | Nuevas | Arrastradas | Ruteadas | Pospuestas | Bloqueadas | km motor | km actual | Ahorro km % | min motor | min actual | Ahorro min % | Viajes unidad-1 | Viajes unidad-2 | Viajes unidad-3 | Viajes unidad-4 | Viajes unidad-5 | Viajes unidad-6 | Viajes unidad-7 | Viajes unidad-8 | Viajes unidad-9 | Viajes unidad-10 | Viajes unidad-11 | Viajes unidad-12 | Viajes unidad-13 | Viajes unidad-14 | Viajes unidad-15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | 54 | 0 | 54 | 0 | 0 | 852.63 | 1230.42 | 30.70 | 1740 | 2514 | 30.79 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-02 | 51 | 0 | 51 | 0 | 0 | 844.08 | 1208.28 | 30.14 | 1726 | 2476 | 30.29 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-03 | 52 | 0 | 52 | 0 | 0 | 902.60 | 1328.79 | 32.07 | 1841 | 2706 | 31.97 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-05 | 56 | 0 | 56 | 0 | 0 | 1036.43 | 1580.13 | 34.41 | 2106 | 3212 | 34.43 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-06 | 55 | 0 | 55 | 0 | 0 | 957.43 | 1350.19 | 29.09 | 1950 | 2750 | 29.09 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-07 | 59 | 0 | 59 | 0 | 0 | 979.76 | 1497.53 | 34.58 | 1991 | 3042 | 34.55 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-08 | 51 | 0 | 51 | 0 | 0 | 878.17 | 1308.25 | 32.87 | 1788 | 2662 | 32.83 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-09 | 58 | 0 | 58 | 0 | 0 | 909.56 | 1362.48 | 33.24 | 1853 | 2778 | 33.30 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-10 | 53 | 0 | 53 | 0 | 0 | 805.07 | 1262.81 | 36.25 | 1644 | 2574 | 36.13 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-12 | 59 | 0 | 59 | 0 | 0 | 905.53 | 1452.67 | 37.66 | 1845 | 2952 | 37.50 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-13 | 60 | 0 | 60 | 0 | 0 | 918.50 | 1482.29 | 38.04 | 1877 | 3026 | 37.97 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-14 | 52 | 0 | 52 | 0 | 0 | 868.21 | 1360.73 | 36.20 | 1772 | 2780 | 36.26 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-15 | 56 | 0 | 56 | 0 | 0 | 952.48 | 1389.44 | 31.45 | 1937 | 2828 | 31.51 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-16 | 57 | 0 | 57 | 0 | 0 | 888.74 | 1403.98 | 36.70 | 1813 | 2866 | 36.74 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-17 | 57 | 0 | 57 | 0 | 0 | 934.45 | 1442.56 | 35.22 | 1902 | 2930 | 35.09 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-19 | 57 | 0 | 57 | 0 | 0 | 946.63 | 1440.31 | 34.28 | 1928 | 2934 | 34.29 | 1 | 1 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-20 | 57 | 0 | 57 | 0 | 0 | 1001.44 | 1568.97 | 36.17 | 2035 | 3188 | 36.17 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-21 | 59 | 0 | 58 | 1 | 0 | 1096.53 | 1624.43 | 32.50 | 2226 | 3296 | 32.46 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-22 | 60 | 1 | 59 | 2 | 0 | 957.16 | 1599.47 | 40.16 | 1948 | 3256 | 40.17 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 2026-10-23 | 60 | 2 | 58 | 4 | 0 | 889.80 | 1420.69 | 37.37 | 1815 | 2896 | 37.33 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| TOTAL | 1123 | 3 | 1119 | 7 | 0 | 18525.18 | 28314.41 | 34.57 | 37737 | 57666 | 34.56 | 20 | 20 | 21 | 20 | 20 | 19 | 19 | 19 | 16 | 20 | 20 | 20 | 20 | 20 | 20 |

Las pospuestas del total (7) cuentan decisiones por jornada: una solicitud puede aparecer varios días. Quedan **4 solicitudes únicas pendientes** al terminar la jornada de operación 20. Conservación: 1123 nuevas = 1119 atendidas + 0 bloqueadas + 4 pendientes. Los porcentajes totales se calculan sobre las sumas, no promediando porcentajes diarios. Se informa el saldo de pendientes sin eliminar solicitudes difíciles ni suponer de antemano que la flota cubrirá toda la demanda.

Reproducir dentro del contenedor del proyecto: `npx --no-install tsx scripts/simular.mts`. CSV: [resultados.csv](./resultados.csv).
