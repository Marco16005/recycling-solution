# Plan 7 — Calles reales y alertas en vivo (diseño)

- **Fecha:** 2026-10-15. **Revisión:** 1 (borrador para Codex y para el usuario).
- **Base:** `main` en f6e4140, con los Planes 1 a 6 validados.
- **Decisiones del usuario (2026-10-15):**
  - nada de gasto: ni tráfico de pago ni Google Routes, TomTom o HERE;
  - sin modelo de lenguaje (se descartó el agente con Gemini);
  - lo más importante: tiempos y distancias por calle real en lugar de línea recta;
  - alertas en vivo cuando una parada ya no llega a su ventana.
- **Después:** Plan 8 (optimización, la "A"); y, con los datos del piloto, el aprendizaje de tiempos (la "B").

## 1. Objetivo y aceptación

1. **Calles reales.** El motor deja de calcular con `haversine × factor_circuidad`. Usa una matriz de km y minutos por calle, de cada punto a cada punto y en ambos sentidos (las calles de un solo sentido hacen que A→B no sea igual que B→A). La matriz sale de OSRM, que corre en un contenedor propio con el mapa de OpenStreetMap recortado a la zona de operación. No se consulta ningún servicio externo ni se paga nada.
2. **Camión, no auto.** OSRM calcula tiempos de auto. Un `factor_camion` configurable (supuesto inicial: 1.2) los ajusta a la flota. Se calibra en el piloto.
3. **Horas pico.** Franjas configurables, por ejemplo de 07:00 a 09:30 con factor 1.3. El modelo es continuo, así que salir más tarde nunca hace llegar antes (§4.2).
4. **Respaldo.** Si OSRM no responde o no está configurado, el plan se genera con la fórmula anterior. La pantalla avisa "Tiempos aproximados: no se pudo consultar el mapa" y el plan guarda qué fuente usó. Un par de puntos sin ruta (por ejemplo, un pin en medio de un predio) usa la fórmula para ese par, y la pantalla lista los clientes cuya ubicación quedó a más de 300 m de una calle ("revisa el pin").
5. **Proyección en vivo.** Con cada evento del operador, y también con el solo paso del tiempo, el sistema recalcula la hora estimada de todo lo que falta en cada jornada.
6. **Alertas.** En el seguimiento del plan validado, el despachador ve:
   - **ventana en riesgo:** la parada empezaría después del cierre de su ventana (ejemplo: "cierra 13:00, llegaría 13:25");
   - **fuera de turno:** el viaje terminaría de descargar después del fin de turno;
   - **atraso:** la llegada proyectada va al menos `umbral_atraso_min` (supuesto: 15) después de la estimada. Es informativa.
   Arriba aparece un resumen ("3 paradas en riesgo") con acceso al re-ruteo.
7. **Re-ruteo útil ante atrasos.** Del re-ruteo actual se conserva todo. Además:
   - el despachador puede **liberar** paradas de viajes futuros (no del viaje en curso), para que el motor las reubique en otra unidad;
   - el momento en que una unidad queda libre al terminar su viaje en curso sale de la proyección (§4.4), y no del retraso del último hito.
8. **Navegación del operador.** Cada parada ofrece, además de "Abrir mapa" (`geo:`), los botones **Navegar con Waze** y **Navegar con Google Maps**. Son enlaces; la aplicación no consulta nada. El chofer usa el tráfico en vivo de esas aplicaciones sin costo.
9. **Recorrido en el mapa.** El mapa del plan dibuja cada viaje por las calles (geometría de OSRM). Si OSRM falla, se dibuja en línea recta, como hoy.
10. **Sin regresiones.** Con una matriz construida con la fórmula anterior y sin horas pico, el motor da exactamente el mismo plan que la versión 1 (prueba de propiedades). Los planes guardados antes de este plan, sin matriz, se siguen viendo, ajustando y validando con la fórmula anterior.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| 1 | OSRM en contenedor, versión exacta (familia 26.x; se fija en P7-0 una de al menos dos semanas, por ejemplo `v26.9.0`) y algoritmo MLD | Gratuito (BSD-2), sin enviar datos fuera, respuesta en milisegundos. MLD permite actualizar velocidades más adelante sin volver a procesar el mapa (útil para la "B") |
| 2 | Mapa: el extracto de México de Geofabrik **fechado**, con su `.md5` (617 MB, sin extractos por estado), recortado con osmium a una caja configurable alrededor de la zona metropolitana de Querétaro y El Marqués | El recorte pesa poco y se procesa en minutos con poca memoria, así que cabe en el VPS compartido. El archivo fechado hace reproducible el mapa |
| 3 | La matriz va dentro de la `EntradaPlan` guardada (`planes.entrada`) | Se conserva "misma entrada y misma semilla, mismo plan"; ajustar y validar no vuelven a consultar OSRM; queda la evidencia de con qué tiempos se planeó |
| 4 | Una sola función pura `tramo(origen, destino, salidaMin)` para todo el motor: admisión, ajustes, validación y resumen | La validación independiente sigue comparando contra el mismo modelo, y el cambio queda en un solo lugar |
| 5 | Horas pico con el modelo de velocidad por franjas (§4.2), no un factor según la hora de salida | Un factor por hora de salida permite que salir más tarde haga llegar antes, lo que rompe la inserción y la espera |
| 6 | Los minutos "libres" (sin hora pico) de cada tramo se guardan en `paradas` y en `rutas` | La proyección no depende del jsonb del plan; queda el dato estimado contra el real para calibrar en el piloto |
| 7 | Alertas calculadas al consultar, sin guardarse | Son función pura de eventos y estimaciones, así que se pueden reconstruir. Guardarlas no sirve al piloto (fuera de alcance) |
| 8 | Enlaces a Waze y Google Maps, sin API | Tráfico en vivo para el chofer, sin costo y sin contrato |
| 9 | El viaje en curso no se reacomoda | Se conserva la decisión del Plan 5: la unidad ya salió con ese viaje. Para esas paradas, la alerta informa (llamar al cliente, no atendida o incidente) |

## 3. Arquitectura y flujo

```
preparar-mapa (script, contenedores) → volumen mapa_datos → servicio osrm (osrm-routed, solo red interna)
generar / re-rutear (acciones) → src/traslados: matriz(puntos) ──OSRM /table──→ EntradaPlan.traslados
                                   └─ si falla: sin matriz, fuente "aproximado"
motor (puro): tramo() con matriz + horas pico → Plan
rutasParaGuardar: kmContrafactual y minutos libres por tramo con la matriz
seguimiento (consulta): estado de jornadas → proyectarJornada() (pura) → horas proyectadas + alertas
obtenerPlan (consulta): trazos por viaje ──OSRM /route──→ geometría (caché en memoria; si falla, línea recta)
```

- **Puntos de la matriz:** patio, ubicaciones de todas las solicitudes candidatas y ubicación inicial de cada unidad, sin repetir. La clave es la coordenada con 6 decimales. Un plan de 60 solicitudes y 15 unidades da unos 62 puntos y 3,844 pares, alrededor de 60 KB en jsonb.
- **OSRM `/table`:** `annotations=distance,duration`; en km se toma `distance/1000` y en minutos libres `duration/60 × factor_camion`. Se guarda también la distancia de ajuste de cada punto a la calle (`sources[i].distance`) para la advertencia de §1.4. Tiempo máximo: 5 s, sin reintento. `--max-table-size 250`.
- **OSRM `/route`:** solo para dibujar. Una petición por viaje con sus puntos en orden, `overview=simplified`, `geometries=geojson`. Caché en memoria del proceso por secuencia de coordenadas, con un máximo de 500 entradas.

## 4. Reglas

### 4.1 Matriz

- `MatrizTraslados = { puntos: Coordenada[]; km: number[][]; minLibres: number[][]; fuente: "osrm"; mapa: string; aproximados: [number, number][] }`. `mapa` identifica el extracto y el recorte (por ejemplo `geofabrik-mexico-261015 recorte -100.65,20.45,-100.05,20.85`). `aproximados` son los pares que OSRM no resolvió y que se llenaron con la fórmula.
- Las diagonales valen 0. Los valores son finitos y no negativos. Un punto que el motor necesite y no esté en la matriz es `entrada_invalida`: lo arma quien llama.
- `EntradaPlan.traslados` es opcional. Si falta, los km y los minutos libres salen de la fórmula anterior: `haversine × factorCircuidad` y `km × 60 ÷ velocidadKmh`, sin redondear.
- Las horas pico se aplican sobre los minutos libres con o sin matriz. Las entradas guardadas antes de este plan no traen `horasPico`, así que se calculan exactamente como en la versión 1.
- `versionMotor` pasa a `"1.1.0"`. `planes.versiones` guarda `traslados: { fuente: "osrm" | "aproximado"; mapa: string | null }`.

### 4.2 Horas pico (tiempo dependiente)

- `ParametrosMotor.horasPico: { inicioMin; finMin; factor }[]`: franjas sin traslape, `factor` en [1, 3]. Fuera de ellas el factor es 1.
- Un tramo de `m` minutos libres que sale en `s` avanza a una velocidad de `1/factor(t)`. Se recorre franja por franja hasta consumir los `m` minutos libres, y la llegada se redondea hacia arriba al minuto.
- **Propiedad:** si `s1 ≤ s2`, entonces `llegada(s1) ≤ llegada(s2)`. Sin franjas, `llegada = s + ceil(m)`, como hoy.
- Los km no dependen de la hora.

### 4.3 Proyección (`proyectarJornada`, pura)

Recibe el estado de la jornada (Plan 5), las ventanas, los minutos libres de cada tramo, el servicio estimado de cada parada (`finEstimado − inicioEstimado`), la descarga, las horas pico, el fin de turno, el umbral y `ahora`. Recorre cada viaje en orden:

- **Lo cerrado:** completadas y no atendidas usan sus horas reales.
- **Parada en sitio o en servicio:** el inicio es el real o `max(llegada real, apertura de la ventana)`; el fin es `inicio + servicio`.
- **Tramo en camino** (salió del punto anterior y no ha llegado): `llegada = max(salida + tramo, ahora)`. Si ya pasó la hora estimada y no ha llegado, el atraso crece con el reloj.
- **Lo pendiente:** se encadena desde lo anterior con `tramo` y horas pico; `inicio = max(llegada, apertura)`.
- **Viaje que no ha salido:** `salida = max(salida estimada, fin de descarga proyectado del viaje anterior, ahora)`.
- **Regreso y descarga:** se proyectan igual con `regreso_libre_min` y la descarga.
- **Rutas guardadas antes de este plan:** si faltan los minutos libres, el tramo se deduce de las estimaciones (`llegadaEstimada − fin estimado anterior`).
- **Salida:** horas proyectadas por parada y por viaje, más `alertas: { tipo: "ventana_en_riesgo" | "fuera_de_turno" | "atraso"; paradaId | rutaId; minutos }[]`. Las paradas cerradas no generan alertas.

### 4.4 Re-ruteo

- `fronteraDeReruteo` toma el `libreDesdeMin` de la unidad con viaje en curso del fin de descarga **proyectado** de ese viaje, en lugar de sumar el retraso del último hito.
- **`liberadas: solicitudId[]`** (nuevo, opcional): paradas vigentes y pendientes de viajes **futuros** de jornadas disponibles. Salen de sus `admitidas` y entran a `aReubicar`. Liberar una parada del viaje en curso, una cerrada o una en sitio es `invalido`. Lo demás del Plan 5 no cambia: validación, versiones y lo congelado.

### 4.5 Configuración (administración)

- Columnas nuevas en `configuracion`:
  - `factor_camion` (≥ 1, máximo 3; inicial 1.2);
  - `horas_pico` (jsonb; inicial `[{07:00–09:30, 1.3}, {13:30–15:00, 1.15}]`, supuestos marcados así en la pantalla);
  - `umbral_atraso_min` (1 a 120; inicial 15).
- Siguen `velocidad_kmh` y `factor_circuidad`, solo para el respaldo aproximado.
- `OSRM_URL` es una variable de entorno, no configuración: dónde está el servicio es cosa de la instalación.

## 5. Datos (migración `0008`)

| Tabla | Cambio |
|---|---|
| `configuracion` | `factor_camion`, `horas_pico`, `umbral_atraso_min` con sus `CHECK` |
| `paradas` | `traslado_libre_min` (numeric, nulo en las anteriores): minutos libres desde el punto anterior |
| `rutas` | `regreso_libre_min` (numeric, nulo en las anteriores) |

`kmContrafactual` pasa a ser `km(patio→cliente) + km(cliente→patio)` de la matriz (antes, `2 × haversine × factor`). El "método actual" del resumen usa la misma cuenta. Los permisos de las tablas no cambian.

## 6. Infraestructura

- **`compose.yaml`:** servicio `osrm` con la imagen fijada, el volumen `mapa_datos` (solo lectura), `osrm-routed --algorithm mld --max-table-size 250`, sin puertos publicados y una prueba de salud. En producción: `restart: unless-stopped` y `mem_limit` (supuesto: 256m, a medir).
- **`scripts/preparar-mapa.sh`:** todo en contenedores, idempotente. Descarga el extracto fechado (`MAPA_FECHA`, por ejemplo `261015`) y verifica su md5. Recorta con osmium a `MAPA_CAJA`. Corre `osrm-extract -p car.lua`, `osrm-partition` y `osrm-customize`. Escribe el identificador `mapa` y deja todo en `mapa_datos`. Osmium va en una imagen propia (`infra/mapa/Dockerfile`, Debian con versión fija y `osmium-tool` con versión fija).
- **Mapa de prueba:** `infra/mapa/prueba/` genera un `.osm` **sintético** propio (sin datos de OSM, sin licencia de por medio): una cuadrícula de calles en las coordenadas de la semilla e2e, con una calle de un solo sentido y una zona sin calles. Se procesa en segundos en `verificar-todo.sh`.
- **Variables:** `OSRM_URL` (`http://osrm:5000`; vacía = aproximado), `MAPA_FECHA` y `MAPA_CAJA` en `.env.example`. `docs/operacion.md` explica cómo preparar y actualizar el mapa (recomendación: mensual) y la atribución "© colaboradores de OpenStreetMap" (ODbL) en el mapa y en el aviso.

## 7. Pantallas (Codex)

- **Plan del día:**
  - insignia "Tiempos por calle (mapa de AAAA-MM-DD)" o "Tiempos aproximados" con el motivo;
  - lista de pins a más de 300 m de una calle;
  - recorrido dibujado por calle.
- **Seguimiento:**
  - por parada pendiente, la hora proyectada junto a la estimada;
  - insignias de alerta y resumen arriba;
  - en el re-ruteo, casillas "Liberar" en las paradas de viajes futuros.
- **Operador:** botones "Navegar con Waze" (`https://waze.com/ul?ll={lat},{lng}&navigate=yes`) y "Navegar con Google Maps" (`https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&travelmode=driving`), de 48 px como mínimo.
- **Configuración** (Claude, administración): factor camión, franjas de hora pico y umbral de atraso.

## 8. Pruebas

- **Unidad, motor:**
  - la regresión de §1.10 (matriz con la fórmula anterior = versión 1) sobre los generadores de propiedades existentes;
  - la monotonía de §4.2;
  - asimetría: con A→B distinto de B→A, el plan usa cada sentido;
  - `entrada_invalida` por un punto faltante;
  - `validarPlan` detecta un plan armado con otra matriz.
- **Unidad, proyección:**
  - casos calculados a mano: a tiempo; atrasada por el reloj sin eventos; en sitio pasada la ventana; viaje futuro desplazado por el anterior; fuera de turno; ruta antigua sin minutos libres;
  - propiedad: la proyección nunca pone una hora futura antes de `ahora` ni antes de un hito real anterior.
- **Integración (OSRM real con el mapa sintético):**
  - la matriz coincide con las distancias de la cuadrícula (tolerancia 2 %) y respeta el sentido único;
  - un punto en la zona sin calles queda en la lista de "revisa el pin";
  - con OSRM apagado, el plan se genera "aproximado" y la ejecución del motor (K7) se registra igual;
  - liberar en el re-ruteo, incluidos los casos inválidos;
  - `kmContrafactual` con la matriz.
- **e2e (el stack incluye `osrm` con el mapa sintético):**
  - generar un plan muestra "Tiempos por calle";
  - un operador que llega tarde hace aparecer "En riesgo" en el seguimiento del despachador;
  - liberar y re-rutear mueve la parada a otra unidad;
  - el operador ve los enlaces de Waze y Google Maps.

## 9. Privacidad

OSRM corre en la propia máquina: ninguna coordenada sale. Al tocar "Navegar con Waze" o "con Google Maps", el teléfono del operador envía el destino a esa aplicación. Hay que decirlo en el aviso para operadores y en el procedimiento interno, y que lo revise el abogado junto con el resto del aviso.

## 10. Reparto (especificación §15)

| Quién | Qué |
|---|---|
| Claude | `infra/mapa`, servicio `osrm` en Compose, `scripts/preparar-mapa.sh`, `src/traslados` (carpeta nueva: cliente OSRM, matriz, trazos y caché), migración `0008`, acciones (generar, re-rutear con `liberadas`, `rutasParaGuardar`), consultas (seguimiento con proyección, `obtenerPlan` con trazos y advertencias), formulario de configuración, pruebas de integración, ayudas e2e y documentación de operación |
| Codex | Contrato y código del motor (`tramo`, matriz, horas pico, validación y resumen), `proyectarJornada` y `fronteraDeReruteo` con `liberadas` en `src/dominio/operacion`, pantallas de plan, seguimiento y operador, y el e2e |
| Ambos | Contratos compilables primero (P7-0), revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

## 11. Fuera de alcance

- Tráfico en vivo de terceros (decisión del usuario: sin gasto).
- GPS continuo del operador.
- Notificaciones push.
- Guardar el historial de alertas.
- Optimización entre rutas (Plan 8).
- Aprendizaje de tiempos y horas pico con datos reales (después del piloto). El proveedor de matriz queda detrás de `src/traslados`, de modo que se puede cambiar o enriquecer sin tocar el motor.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Velocidades de auto contra camión | `factor_camion` y horas pico configurables; calibración en el piloto con `traslado_libre_min` contra los tiempos reales |
| Pins mal puestos | Lista de "revisa el pin" con la distancia de ajuste de OSRM |
| Memoria del VPS compartido | Recorte del mapa y `mem_limit`. El mapa se puede preparar en otra máquina y copiar el volumen |
| Mapa desactualizado | Extracto fechado y procedimiento mensual en `docs/operacion.md` |
| OSRM caído | Respaldo aproximado con aviso. La operación (eventos y proyección) no depende de OSRM |
