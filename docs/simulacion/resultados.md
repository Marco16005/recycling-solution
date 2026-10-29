# Simulación del motor: 1.1.0 (admisión) contra 1.2.0 (con reacomodo)

Datos exclusivamente sintéticos. Semilla: 20261014. Veinte días de operación, de lunes a sábado, del 2026-10-01 al 2026-10-23; los domingos no se opera ni se generan solicitudes. Cien clientes dentro de un radio de 15 km de un patio hipotético en El Marqués, ventanas de 2 a 6 horas, servicio de 66 min, cargas de 300 a 3000 kg y unidades doble rodada de 8000 kg. Cada día se agregan 50 a 60 solicitudes registradas antes del turno; las mismas en las dos versiones. Turno 08:00–16:00, velocidad 30 km/h, circuidad 1.3, descarga de 15 min y tolerancia de 15 min por parada extra.

**1.1.0** es la admisión del Plan 3 sola (FIFO con agrupación k-means). **1.2.0** agrega el reacomodo (búsqueda local por vecindarios), la readmisión de las pospuestas en orden de llegada con la tolerancia y un reacomodo final, sin que ninguna unidad termine más de la tolerancia después en un reacomodo. El tiempo muerto suma, por unidad, traslado, espera y descargas (sin el servicio). Son resultados **simulados** con tiempos estimados, no ahorro observado.

## Resumen

- **Escenario del Documento Integrador (15 unidades):** atendidas 1119 → 1123 (+4); pendientes únicas al cierre 4 → 0; tiempo muerto 44582 → 27723 min (37.82 % menos); km 18525.18 → 10710.60 (42.18 % menos); 3 readmitidas y 0 decisiones de "alarga la jornada".
- **Flota reducida (8 unidades):** atendidas 679 → 743 (+64); pendientes únicas al cierre 444 → 380; tiempo muerto 26236 → 19209 min (26.78 % menos); km 11047.88 → 7725.03 (30.08 % menos); 70 readmitidas y 393 decisiones de "alarga la jornada".

## Escenario del Documento Integrador (15 unidades)

| Fecha | Nuevas | Atendidas 1.1.0 | Atendidas 1.2.0 | Pospuestas 1.1.0 | Pospuestas 1.2.0 | Readmitidas | Alarga la jornada | Tiempo muerto 1.1.0 (min) | Tiempo muerto 1.2.0 (min) | km 1.1.0 | km 1.2.0 | km método actual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | 54 | 54 | 54 | 0 | 0 | 0 | 0 | 2098 | 1306 | 852.63 | 490.77 | 1230.42 |
| 2026-10-02 | 51 | 51 | 51 | 0 | 0 | 0 | 0 | 2065 | 1128 | 844.08 | 436.05 | 1208.28 |
| 2026-10-03 | 52 | 52 | 52 | 0 | 0 | 0 | 0 | 2157 | 1254 | 902.60 | 490.95 | 1328.79 |
| 2026-10-05 | 56 | 56 | 56 | 0 | 0 | 0 | 0 | 2446 | 1405 | 1036.43 | 561.00 | 1580.13 |
| 2026-10-06 | 55 | 55 | 55 | 0 | 0 | 0 | 0 | 2306 | 1366 | 957.43 | 527.59 | 1350.19 |
| 2026-10-07 | 59 | 59 | 59 | 0 | 0 | 0 | 0 | 2278 | 1354 | 979.76 | 528.17 | 1497.53 |
| 2026-10-08 | 51 | 51 | 51 | 0 | 0 | 0 | 0 | 2094 | 1476 | 878.17 | 586.06 | 1308.25 |
| 2026-10-09 | 58 | 58 | 58 | 0 | 0 | 0 | 0 | 2164 | 1346 | 909.56 | 527.14 | 1362.48 |
| 2026-10-10 | 53 | 53 | 53 | 0 | 0 | 0 | 0 | 1991 | 1396 | 805.07 | 519.38 | 1262.81 |
| 2026-10-12 | 59 | 59 | 59 | 0 | 0 | 0 | 0 | 2097 | 1296 | 905.53 | 495.85 | 1452.67 |
| 2026-10-13 | 60 | 60 | 60 | 0 | 0 | 0 | 0 | 2148 | 1314 | 918.50 | 524.71 | 1482.29 |
| 2026-10-14 | 52 | 52 | 52 | 0 | 0 | 0 | 0 | 2152 | 1452 | 868.21 | 557.07 | 1360.73 |
| 2026-10-15 | 56 | 56 | 56 | 0 | 0 | 0 | 0 | 2320 | 1368 | 952.48 | 499.39 | 1389.44 |
| 2026-10-16 | 57 | 57 | 57 | 0 | 0 | 0 | 0 | 2199 | 1438 | 888.74 | 543.66 | 1403.98 |
| 2026-10-17 | 57 | 57 | 57 | 0 | 0 | 0 | 0 | 2205 | 1402 | 934.45 | 551.99 | 1442.56 |
| 2026-10-19 | 57 | 57 | 57 | 0 | 0 | 0 | 0 | 2314 | 1465 | 946.63 | 570.31 | 1440.31 |
| 2026-10-20 | 57 | 57 | 57 | 0 | 0 | 0 | 0 | 2450 | 1448 | 1001.44 | 555.65 | 1568.97 |
| 2026-10-21 | 59 | 58 | 59 | 1 | 0 | 1 | 0 | 2622 | 1496 | 1096.53 | 573.76 | 1652.52 |
| 2026-10-22 | 60 | 59 | 60 | 2 | 0 | 0 | 0 | 2375 | 1621 | 957.16 | 623.71 | 1613.61 |
| 2026-10-23 | 60 | 58 | 60 | 4 | 0 | 2 | 0 | 2101 | 1392 | 889.80 | 547.41 | 1496.21 |
| TOTAL | 1123 | 1119 | 1123 | 7 | 0 | 3 | 0 | 44582 | 27723 | 18525.18 | 10710.60 | 28432.15 |

Conservación en las dos versiones: nuevas = atendidas + bloqueadas + pendientes únicas al cierre (4 con 1.1.0 y 0 con 1.2.0). Las pospuestas del total suman decisiones por día: una solicitud puede aparecer varios días. Cada versión arrastra sus propias pospuestas, así que desde el segundo día las entradas de las dos versiones pueden diferir.

## Flota reducida (8 unidades)

| Fecha | Nuevas | Atendidas 1.1.0 | Atendidas 1.2.0 | Pospuestas 1.1.0 | Pospuestas 1.2.0 | Readmitidas | Alarga la jornada | Tiempo muerto 1.1.0 (min) | Tiempo muerto 1.2.0 (min) | km 1.1.0 | km 1.2.0 | km método actual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | 54 | 35 | 37 | 19 | 17 | 2 | 0 | 1289 | 940 | 522.40 | 357.69 | 831.34 |
| 2026-10-02 | 51 | 33 | 38 | 37 | 30 | 4 | 4 | 1276 | 963 | 527.28 | 381.94 | 843.11 |
| 2026-10-03 | 52 | 34 | 37 | 55 | 45 | 4 | 12 | 1333 | 820 | 554.98 | 331.92 | 889.04 |
| 2026-10-05 | 56 | 33 | 38 | 78 | 63 | 3 | 0 | 1370 | 890 | 591.26 | 372.35 | 992.75 |
| 2026-10-06 | 55 | 35 | 37 | 98 | 81 | 2 | 7 | 1303 | 993 | 574.62 | 421.38 | 1017.67 |
| 2026-10-07 | 59 | 34 | 37 | 123 | 103 | 4 | 3 | 1403 | 969 | 627.52 | 395.05 | 997.81 |
| 2026-10-08 | 51 | 34 | 35 | 140 | 119 | 2 | 5 | 1327 | 1054 | 550.92 | 434.88 | 879.58 |
| 2026-10-09 | 58 | 33 | 37 | 165 | 140 | 4 | 16 | 1291 | 1026 | 552.83 | 434.08 | 991.45 |
| 2026-10-10 | 53 | 32 | 39 | 186 | 154 | 5 | 2 | 1402 | 891 | 569.83 | 351.50 | 894.33 |
| 2026-10-12 | 59 | 34 | 34 | 211 | 179 | 2 | 66 | 1264 | 998 | 530.09 | 383.98 | 832.15 |
| 2026-10-13 | 60 | 32 | 35 | 239 | 204 | 3 | 19 | 1446 | 1007 | 598.02 | 408.91 | 908.57 |
| 2026-10-14 | 52 | 35 | 39 | 256 | 217 | 4 | 0 | 1298 | 872 | 549.27 | 351.46 | 888.73 |
| 2026-10-15 | 56 | 36 | 37 | 276 | 236 | 3 | 9 | 1178 | 917 | 502.23 | 352.03 | 947.85 |
| 2026-10-16 | 57 | 32 | 40 | 301 | 253 | 5 | 39 | 1334 | 880 | 560.31 | 358.13 | 891.68 |
| 2026-10-17 | 57 | 34 | 39 | 324 | 271 | 7 | 32 | 1250 | 873 | 506.12 | 354.72 | 995.34 |
| 2026-10-19 | 57 | 35 | 38 | 346 | 290 | 3 | 43 | 1310 | 982 | 560.43 | 412.10 | 980.70 |
| 2026-10-20 | 57 | 35 | 38 | 368 | 309 | 3 | 17 | 1297 | 1020 | 548.42 | 397.24 | 938.47 |
| 2026-10-21 | 59 | 37 | 38 | 390 | 330 | 6 | 17 | 1181 | 987 | 516.65 | 397.44 | 1019.96 |
| 2026-10-22 | 60 | 33 | 37 | 417 | 353 | 2 | 4 | 1287 | 1113 | 509.11 | 417.38 | 826.52 |
| 2026-10-23 | 60 | 33 | 33 | 444 | 380 | 2 | 98 | 1397 | 1014 | 595.58 | 410.85 | 850.84 |
| TOTAL | 1123 | 679 | 743 | 4473 | 3774 | 70 | 393 | 26236 | 19209 | 11047.88 | 7725.03 | 18417.87 |

Conservación en las dos versiones: nuevas = atendidas + bloqueadas + pendientes únicas al cierre (444 con 1.1.0 y 380 con 1.2.0). Las pospuestas del total suman decisiones por día: una solicitud puede aparecer varios días. Cada versión arrastra sus propias pospuestas, así que desde el segundo día las entradas de las dos versiones pueden diferir.

Reproducir dentro del contenedor del proyecto: `npx --no-install tsx scripts/simular.mts`. CSV: [resultados.csv](./resultados.csv).
