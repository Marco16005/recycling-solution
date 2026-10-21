# Plan 7 — Calles reales y alertas en vivo (diseño)

- **Fecha:** 2026-10-15.
- **Revisión:** 2.1. Incorpora los 15 hallazgos de Codex sobre la revisión 1 y el primero de su revisión de la 2 (§13).
- **Base:** `main` en f6e4140, con los Planes 1 a 6 validados.
- **Decisiones del usuario (2026-10-15):**
  - nada de gasto: ni tráfico de pago ni Google Routes, TomTom o HERE;
  - sin modelo de lenguaje (se descartó el agente con Gemini);
  - lo más importante: tiempos y distancias por calle real en lugar de línea recta;
  - alertas en vivo cuando una parada ya no llega a su ventana.
- **Después:** Plan 8 (optimización, la "A"); y, con los datos del piloto, el aprendizaje de tiempos (la "B").

## 1. Objetivo y aceptación

1. **Calles reales.** El motor deja de calcular con `haversine × factor_circuidad`. Usa una matriz **dirigida** de km y minutos por calle, de cada punto a cada punto: con calles de un solo sentido, A→B no es igual que B→A. La matriz sale de OSRM, que corre en un contenedor propio con el mapa de OpenStreetMap recortado a la zona de operación. No se consulta ningún servicio externo ni se paga nada.
2. **Camión, no auto.** OSRM calcula tiempos de auto. Un `factor_camion` configurable (supuesto inicial: 1.2) los ajusta a la flota. Se calibra en el piloto.
3. **Horas pico.** Franjas configurables, por ejemplo de 07:00 a 09:30 con factor 1.3. El modelo es continuo, así que salir más tarde nunca hace llegar antes (§4.2).
4. **Respaldo con motivo.**
   - Si OSRM no está configurado, no responde, responde mal o la petición tiene demasiados puntos, el plan se genera con la fórmula anterior. Guarda la fuente y el motivo, y la pantalla avisa "Tiempos aproximados: <motivo>".
   - Los pares que OSRM no resuelve (por ejemplo, una red de calles desconectada) usan la fórmula para ese par. La pantalla muestra la mezcla: "Tiempos por calle; 3 pares aproximados".
   - Los clientes cuyo pin quedó a más de 300 m de una calle salen en una lista "revisa el pin".
5. **Proyección en vivo.** Con cada evento del operador, y también con el solo paso del tiempo, el sistema recalcula la hora estimada de todo lo que falta en cada jornada. Usa el modelo de tiempos con que se planeó cada ruta, guardado con ella (§4.3).
6. **Alertas.** En el seguimiento del plan validado, el despachador ve:
   - **ventana en riesgo:** la parada empezaría después del cierre de su ventana (ejemplo: "cierra 13:00, llegaría 13:25");
   - **fuera de turno:** el viaje terminaría de descargar después del fin de turno;
   - **atraso:** la llegada proyectada va al menos `umbral_atraso_min` (supuesto: 15) después de la estimada. Es informativa.
   Arriba aparece un resumen ("3 paradas en riesgo") con acceso al re-ruteo. Cada alerta dice si la parada está en el viaje en curso o en uno futuro:
   - **viaje futuro:** se puede liberar;
   - **viaje en curso:** no se reacomoda mientras la unidad siga disponible (avisar al cliente o marcarla no atendida). Si la unidad ya no puede seguir (avería), se registra el incidente y se re-rutea con la jornada como no disponible: sus pendientes, también las del viaje en curso, se reubican, como en el Plan 5.
7. **Liberar en el re-ruteo.** El despachador puede liberar paradas pendientes de viajes **futuros**. Liberar retira el compromiso de unidad, viaje y orden: el motor reubica la parada en orden FIFO donde quepa, sea en la misma unidad, en otra o como pospuesta. El despachador revisa la propuesta y puede ajustarla con "mover", como hoy. Lo congelado del Plan 5 no cambia.
8. **Frontera viva.**
   - La unidad con viaje en curso queda libre al fin de descarga **proyectado** de ese viaje.
   - Al validar un re-ruteo se recalcula esa frontera con la hora de ese momento. Si la propuesta hace salir a una unidad antes de que termine su viaje en curso, se rechaza (`frontera_vencida`) y pide regenerar.
9. **Navegación del operador.** Cada parada ofrece, además de "Abrir mapa" (`geo:`), los botones **Navegar con Waze** y **Navegar con Google Maps**. Son enlaces; la aplicación no consulta nada. El chofer usa el tráfico en vivo de esas aplicaciones sin costo.
10. **Recorrido en el mapa.**
    - El mapa del plan dibuja cada viaje por las calles, con la geometría de OSRM, y dice con qué mapa se dibujó.
    - Si ese mapa ya no es el que se usó para planear, lo indica.
    - Si OSRM falla o tarda, se dibuja en línea recta, como hoy, sin bloquear la pantalla.
11. **Sin regresiones.**
    - Con una matriz construida con la fórmula anterior (identidad exacta de coordenadas) y sin horas pico, el motor da el mismo plan que la versión 1, campo por campo, salvo `versionMotor`.
    - Los planes `1.0.0` ya guardados se siguen viendo, ajustando y validando con la fórmula anterior y conservan su versión.

## 2. Decisiones

| # | Decisión | Por qué |
|---|---|---|
| 1 | OSRM en contenedor, imagen `ghcr.io/project-osrm/osrm-backend:v26.9.0-debian` (multiarquitectura, del 1 de septiembre de 2026; comprobada en el registro) y algoritmo MLD | Gratuito (BSD-2), sin enviar datos fuera, respuesta en milisegundos. MLD permite actualizar velocidades más adelante sin volver a procesar el mapa (útil para la "B") |
| 2 | Mapa: el extracto de México de Geofabrik **fechado**, con su `.md5` (617 MB, sin extractos por estado), recortado con osmium a una caja configurable alrededor de la zona metropolitana de Querétaro y El Marqués. El identificador del mapa se graba con `--data_version` | El recorte pesa poco y se procesa en minutos con poca memoria, así que cabe en el VPS compartido. El archivo fechado hace reproducible el mapa, y OSRM devuelve su identificador en cada respuesta |
| 3 | La matriz va dentro de la `EntradaPlan` guardada (`planes.entrada`) | Se conserva "misma entrada y misma semilla, mismo plan"; ajustar y validar no vuelven a consultar OSRM; queda la evidencia de con qué tiempos se planeó |
| 4 | Una sola implementación pura de `tramo(origen, destino, salidaMin)` y de la llegada con horas pico, exportada por `src/motor` y usada también por la proyección | El cambio queda en un solo lugar. La validación sigue reconstruyendo cada ruta por su cuenta, y las pruebas a mano de `tramo` cubren el error común que la validación no vería |
| 5 | Horas pico con el modelo de velocidad por franjas (§4.2), no un factor según la hora de salida | Un factor por hora de salida permite que salir más tarde haga llegar antes, lo que rompe la inserción y la espera |
| 6 | Cada ruta guarda su **modelo de tiempos** (`rutas.tiempos`): sus puntos, la submatriz de minutos libres entre ellos, las horas pico, el fin de turno y la descarga con que se planeó | Proyecta de forma reproducible aunque cambie la configuración, también en jornadas con rutas de varios planes. Resuelve los tramos nuevos cuando se omite una parada. Deja el dato estimado contra el real para calibrar en el piloto |
| 7 | Alertas calculadas al consultar, sin guardarse. El umbral de atraso es el vigente | Son función pura de eventos y modelos guardados, así que se pueden reconstruir. El umbral es preferencia de pantalla, no parte del modelo |
| 8 | Enlaces a Waze y Google Maps, sin API | Tráfico en vivo para el chofer, sin costo y sin contrato |
| 9 | El viaje en curso de una jornada **disponible** no se reacomoda ni se libera. Una jornada no disponible conserva la regla del Plan 5: sus pendientes, también las del viaje en curso, pasan a `aReubicar` | Así lo hace el código actual (`fronteraDeReruteo`): una unidad que sigue en ruta ya salió con ese viaje, y una averiada ya no lo puede terminar |
| 10 | Coordenadas con identidad exacta: misma latitud y longitud, sin redondear | Dos coordenadas distintas nunca comparten fila, y la regresión contra la versión 1 queda exacta |

## 3. Arquitectura y flujo

```
preparar-mapa (script, contenedores) → volumen mapa_datos → servicio osrm (osrm-routed, solo red interna)
generar / re-rutear (acciones) → src/traslados.matriz(puntos) ──OSRM /table──→ EntradaPlan.traslados
                                   └─ si falla: sin matriz; versiones.traslados con fuente "aproximado" y motivo
motor (puro): tramo() con matriz + horas pico → Plan
rutasParaGuardar: kmContrafactual (matriz) y rutas.tiempos (submatriz + modelo)
seguimiento (consulta): estado de jornadas + rutas.tiempos → proyectarJornada() (pura) → horas proyectadas + alertas
obtenerPlan (consulta): trazos por viaje ──OSRM /route──→ geometría con su mapa (caché, plazo y concurrencia acotados)
```

- **Puntos de la matriz:** patio, ubicaciones de todas las solicitudes candidatas y ubicación inicial de cada unidad (hoy, siempre el patio). Se agrupan por identidad exacta. Un plan de 60 solicitudes y 15 unidades da unos 62 puntos y 3,844 pares, alrededor de 60 KB en jsonb. El motor arma una sola vez por evaluación un índice de coordenada a fila.
- **OSRM `/table`:**
  - pide `annotations=distance,duration`;
  - km = `distance/1000`; minutos libres = `duration/60 × factor_camion`;
  - guarda la distancia de ajuste a la calle de cada punto (`sources[i].distance`);
  - tiempo máximo de 5 s, sin reintento, con `--max-table-size 400`;
  - con más de 400 puntos, respaldo con motivo `demasiados_puntos`;
  - las celdas `null` se llenan con la fórmula y quedan en `aproximados`;
  - un error de la petición completa (por ejemplo `NoSegment`), una respuesta que no es JSON o una forma inesperada llevan al respaldo total con su motivo.
- **OSRM `/route`** (solo para dibujar):
  - una petición por viaje con sus puntos en orden, `overview=simplified` y `geometries=geojson`;
  - plazo de 2 s por petición, como máximo 4 a la vez y 3 s en total por consulta;
  - caché en memoria del proceso con llave `data_version` + perfil + secuencia de coordenadas, y un máximo de 500 entradas;
  - la respuesta lleva el `mapa` con que se dibujó.
- **K7:** `ejecuciones_motor` agrega `consulta_mapa_ms` (nula si no hubo consulta). La duración del motor (`duracion_ms`) se sigue midiendo solo alrededor del motor, sin cambiar su significado.

## 4. Reglas

### 4.1 Matriz y versiones

- `MatrizTraslados = { puntos: Coordenada[]; km: number[][]; minLibres: number[][]; ajusteM: number[]; aproximados: [number, number][]; mapa: string }`. `mapa` es el `data_version` de OSRM (por ejemplo `geofabrik-mexico-261015 recorte -100.65,20.45,-100.05,20.85`).
- Las diagonales valen 0. Los valores son finitos y no negativos. Un punto que el motor necesite y no esté en la matriz es `entrada_invalida`: lo arma quien llama.
- `EntradaPlan.traslados` es opcional. Si falta, los km y los minutos libres salen de la fórmula anterior: `haversine × factorCircuidad` y `km × 60 ÷ velocidadKmh`, sin redondear.
- `ParametrosMotor.horasPico` es opcional. Si falta o está vacío, no hay franjas.
- **Versiones del motor:**
  - `generarPlan` produce `"1.1.0"`.
  - `validarPlan` acepta `"1.0.0"` (exige entrada sin `traslados` ni `horasPico`) y `"1.1.0"`.
  - `ajustarPlan` conserva la versión del plan de origen.
  - Hay fixtures guardados de un plan `1.0.0`, generados con el código actual antes del cambio, para leer, ajustar y validar.
- `planes.versiones.traslados = { fuente: "osrm" | "aproximado"; motivo: null | "sin_configurar" | "sin_respuesta" | "respuesta_invalida" | "error_osrm" | "demasiados_puntos"; mapa: string | null; paresAproximados: number }`.
- **Resumen y contrafactual:**
  - `kmContrafactual` de una parada = `km(patio→cliente) + km(cliente→patio)`.
  - `kmMetodoActual` suma esos viajes redondos de las ruteadas.
  - `minutosTraslado` y `minutosTrasladoMetodoActual` se calculan los dos en **minutos libres** (sin horas pico), con `ceil` por tramo como hoy, para comparar parejo.
  - Admisión, ajustes y validación usan la misma cuenta. Con la matriz de la fórmula, todo coincide con la versión 1.

### 4.2 Horas pico (tiempo dependiente)

- `horasPico: { inicioMin; finMin; factor }[]`: franjas sin traslape, `factor` en [1, 3]. Fuera de ellas el factor es 1.
- Un tramo de `m` minutos libres que sale en `s` avanza a una velocidad de `1/factor(t)`. Se recorre franja por franja hasta consumir los `m` minutos libres, y la llegada se redondea hacia arriba al minuto.
- **Propiedad:** si `s1 ≤ s2`, entonces `llegada(s1) ≤ llegada(s2)`.
- Sin franjas, `llegada = s + ceil(m)`, que es exactamente la regla de hoy para `s` entero.
- Los km no dependen de la hora.
- **La matriz no cumple por fuerza la desigualdad triangular** (es dirigida y puede mezclar fuentes). Por eso la inserción y la validación no podan posiciones suponiendo que un desvío siempre suma tiempo: se conserva la búsqueda exhaustiva de inserciones y la reconstrucción independiente del Plan 3.

### 4.3 Proyección (`proyectarJornada`, pura)

**Entradas:**
- el estado de la jornada (Plan 5);
- por ruta, su `tiempos`;
- el servicio estimado de cada parada (`finEstimado − inicioEstimado`);
- las ventanas, el umbral vigente y `ahora`.

**Ubicación conocida.** Es el último lugar con evidencia real:
- el patio, si no ha salido o si ya regresó;
- una parada con llegada real.

Una `no_atendida` cerrada sin llegada no prueba que la unidad estuvo ahí: se supone que sigue en la ubicación anterior, y la pantalla lo marca así. Las `omitida` y `reasignada` no se visitan.

**Reglas, por viaje y en orden.** Ninguna hora proyectada de algo que no ha ocurrido queda antes de `ahora`.
- Completadas y no atendidas: horas reales.
- `en_sitio` (llegó y no ha empezado): `inicio = max(ahora, llegada real, apertura)`; `fin = inicio + servicio`.
- `en_servicio`: se conserva el inicio real; `fin = max(inicio real + servicio, ahora)`.
- **Tramo en camino** (salió de la ubicación conocida y no ha llegado a la siguiente vigente): `llegada = max(salida real + tramo(ubicación conocida → parada), ahora)`. Si pasa la hora sin evento, el atraso crece con el reloj.
- Lo pendiente se encadena desde la ubicación conocida con `tramo` y las horas pico de esa ruta, saltando las no visitadas. `inicio = max(llegada, apertura)`.
- **Viaje que no ha salido:** `salida = max(salida estimada, fin de descarga proyectado del viaje anterior, ahora)`.
- **Regreso:** `tramo(ubicación conocida → patio)`.
- **Descarga en curso** (regresó y no ha terminado): `fin = max(regreso real + descarga, ahora)`.
- Los hitos reales se conservan aunque estén en el pasado.

**Rutas sin `tiempos`** (anteriores a este plan; antes del piloto solo hay datos de prueba): se desplazan las estimaciones por el retraso observado, como hace hoy `fronteraDeReruteo`, y la pantalla lo marca "proyección aproximada".

**Salida:**
- horas proyectadas por parada y por viaje;
- `alertas: { tipo: "ventana_en_riesgo" | "fuera_de_turno" | "atraso"; paradaId | rutaId; minutos; enViajeEnCurso: boolean }[]`;
- las paradas cerradas no generan alertas.

### 4.4 Re-ruteo

- **Frontera.** `fronteraDeReruteo` toma el `libreDesdeMin` de una unidad con viaje en curso del fin de descarga proyectado de ese viaje (§4.3).
- **Liberar.** `liberadas: solicitudId[]` (opcional) admite solo paradas vigentes y pendientes de viajes futuros de jornadas disponibles. Cualquier otra es `invalido`: del viaje en curso, cerrada, en sitio o de una jornada no disponible (esas ya se reubican todas).
  - Las liberadas salen de sus `admitidas` y pasan a `aReubicar`. La acción junta `aReubicar` de **todas** las jornadas, disponibles o no.
  - Un viaje futuro que queda vacío desaparece y los siguientes se renumeran. Las admitidas son viajes futuros que aún no salen, así que su número no tiene identidad física. Lo que se protege es la unidad y el orden relativo: `[[A], [B]]` con A liberada queda `[[B]]`.
  - `planes.restricciones` guarda `{ admitidas, liberadas }`. Validar compara contra lo guardado.
  - La invariante 24 se actualiza: las admitidas conservan unidad y orden, salvo las liberadas.
- **Validación con frontera viva.** Bajo los bloqueos actuales (Plan 5), `validarReruteo` recalcula la frontera con `ctx.reloj()`. Si alguna unidad sale en la propuesta antes de su nuevo `libreDesdeMin`, devuelve el conflicto `frontera_vencida`: "La unidad X terminará su viaje más tarde de lo previsto; vuelve a generar el re-ruteo". Es un `CodigoConflicto` nuevo.

### 4.5 Configuración (administración)

- Columnas nuevas en `configuracion`:
  - `factor_camion` (1 a 3; inicial 1.2);
  - `horas_pico` (jsonb; inicial `[{07:00–09:30, 1.3}, {13:30–15:00, 1.15}]`, supuestos marcados así en la pantalla);
  - `umbral_atraso_min` (1 a 120; inicial 15).
- Siguen `velocidad_kmh` y `factor_circuidad`, solo para el respaldo aproximado.
- Cambiar la configuración afecta a los planes que se generen después. Los planes y rutas guardados conservan su modelo.
- `OSRM_URL` es una variable de entorno, no configuración: dónde está el servicio es cosa de la instalación.

## 5. Datos (migración `0008`)

| Tabla | Cambio |
|---|---|
| `configuracion` | `factor_camion`, `horas_pico`, `umbral_atraso_min` con sus `CHECK` |
| `rutas` | `tiempos` jsonb, nula en las anteriores: `{ puntos: ("patio" \| solicitudId)[]; minLibres: number[][]; horasPico; turnoFinMin; descargaMin }`, la submatriz dirigida entre el patio y las paradas de la ruta |
| `ejecuciones_motor` | `consulta_mapa_ms` (double, nula, ≥ 0) |
| `planes` | Sin columnas nuevas. `restricciones` admite `liberadas`; `versiones` admite `traslados` |

Los permisos no cambian: `rutas` sigue sin DELETE y `ejecuciones_motor` sin UPDATE ni DELETE.

## 6. Infraestructura

- **`compose.yaml`:** servicio `osrm` con la imagen fijada, el volumen `mapa_datos` (solo lectura), `osrm-routed --algorithm mld --max-table-size 400`, sin puertos publicados y una prueba de salud. En producción: `restart: unless-stopped` y `mem_limit` (supuesto: 256m, a medir con el recorte real).
- **`scripts/preparar-mapa.sh`:** todo en contenedores, idempotente.
  - Descarga el extracto fechado (`MAPA_FECHA`, por ejemplo `261015`) y verifica su md5.
  - Recorta con osmium a `MAPA_CAJA`.
  - Corre `osrm-extract -p car.lua --data_version "<id>"`, `osrm-partition` y `osrm-customize`.
  - Deja todo en `mapa_datos`.
  - Osmium va en una imagen propia (`infra/mapa/Dockerfile`, Debian con versión fija y `osmium-tool` con versión fija).
- **Mapa de prueba:** `infra/mapa/prueba/` genera un `.osm` **sintético** propio, sin datos de OSM y sin licencia de por medio. Está en las coordenadas de la semilla e2e y contiene:
  - una cuadrícula de calles;
  - una calle de un solo sentido;
  - una isla de calles desconectada (celdas `null`);
  - una zona sin calles (pin lejano).
  Se procesa en segundos dentro de `verificar-todo.sh`.
- **Variables:** `OSRM_URL` (`http://osrm:5000`; vacía = aproximado con motivo `sin_configurar`), `MAPA_FECHA` y `MAPA_CAJA` en `.env.example`.
- **`docs/operacion.md`:** cómo preparar y actualizar el mapa (recomendación: mensual), cómo prepararlo en otra máquina y copiar el volumen, y la atribución "© colaboradores de OpenStreetMap" (ODbL) en el mapa y en el aviso.

## 7. Pantallas (Codex)

- **Plan del día:**
  - insignia "Tiempos por calle (mapa …)", "Tiempos por calle; N pares aproximados" o "Tiempos aproximados: <motivo>";
  - lista "revisa el pin" con la distancia;
  - recorrido dibujado por calle, con aviso si se dibujó con otro mapa.
- **Seguimiento:**
  - por parada pendiente, la hora proyectada junto a la estimada;
  - insignias de alerta, con la etiqueta "viaje en curso" o "viaje futuro";
  - resumen arriba;
  - "ubicación supuesta" tras una no atendida sin llegada;
  - "proyección aproximada" en rutas antiguas;
  - en el re-ruteo, casillas "Liberar" en las paradas de viajes futuros.
- **Operador:** botones "Navegar con Waze" (`https://waze.com/ul?ll={lat},{lng}&navigate=yes`) y "Navegar con Google Maps" (`https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&travelmode=driving`), de 48 px como mínimo.
- **Configuración** (Claude, administración): factor camión, franjas de hora pico y umbral de atraso.

## 8. Pruebas

- **Unidad, motor:**
  - regresión de §1.11 sobre los generadores de propiedades existentes, incluidas coordenadas distintas que coinciden hasta el sexto decimal;
  - fixtures `1.0.0` leídos, ajustados y validados;
  - `tramo` y la llegada con horas pico con resultados calculados a mano, incluidos los límites exactos de las franjas, una salida dentro de una franja que termina a medio tramo y varias franjas seguidas;
  - monotonía de §4.2;
  - matrices dirigidas e híbridas sin desigualdad triangular, con varias ventanas, viajes posteriores y admitidas;
  - la propiedad FIFO de pospuestas del Plan 3 con matriz y franjas;
  - `entrada_invalida` por un punto faltante;
  - `validarPlan` rechaza un plan armado con otra matriz;
  - rendimiento: 60 solicitudes y 15 unidades con matriz y franjas, en menos de un segundo.
- **Unidad, proyección:**
  - casos calculados a mano: a tiempo; atrasada por el reloj sin eventos (dos valores de `ahora`); en sitio pasada la ventana; en servicio vencido (el fin no queda en el pasado); descarga vencida; omitida en medio (tramo A→C); no atendida sin llegada (ubicación anterior); viaje futuro desplazado por el anterior; fuera de turno; ruta sin `tiempos`;
  - propiedad: nada proyectado queda antes de `ahora` ni antes de un hito real anterior, y los hitos reales no cambian.
- **Unidad, re-ruteo:** liberar parcial, liberar un viaje completo (renumeración), re-ruteos encadenados con liberadas, casos inválidos, y `aReubicar` de jornadas disponibles.
- **Integración** (OSRM real con el mapa sintético; servidor falso para las fallas globales):
  - la matriz coincide con las distancias de la cuadrícula (tolerancia 2 %) y respeta el sentido único;
  - la isla da pares aproximados y la mezcla queda guardada;
  - el pin lejano sale en "revisa el pin";
  - respaldo total por cada motivo (`sin_configurar`, `sin_respuesta` con OSRM apagado, `respuesta_invalida`, `error_osrm` con `NoSegment`, `demasiados_puntos`), con K7 registrada igual y `consulta_mapa_ms`;
  - `kmContrafactual` y `rutas.tiempos` guardados;
  - seguimiento con reloj controlado: la alerta aparece al avanzar `ctx.reloj` sin eventos;
  - `frontera_vencida` al validar un re-ruteo cuya frontera se movió;
  - trazos con plazo vencido: la consulta del plan responde en línea recta.
- **e2e:**
  - toda la suite existente corre con `osrm` y el mapa sintético; el respaldo se cubre en integración;
  - generar un plan muestra "Tiempos por calle";
  - un operador que llega tarde hace aparecer "En riesgo";
  - un escenario armado para que la otra unidad sea la única factible: liberar y re-rutear la mueve ahí, respetando el orden FIFO por registro;
  - el operador ve los enlaces de Waze y Google Maps.

## 9. Privacidad

OSRM corre en la propia máquina: ninguna coordenada sale. Al tocar "Navegar con Waze" o "con Google Maps", el teléfono del operador envía el destino a esa aplicación. Hay que decirlo en el aviso para operadores y en el procedimiento interno (`docs/legal`, Claude), y que lo revise el abogado junto con el resto del aviso.

## 10. Reparto (especificación §15)

| Quién | Qué |
|---|---|
| Claude | `infra/mapa`, servicio `osrm` en Compose, `scripts/preparar-mapa.sh`, `src/traslados` (carpeta nueva: cliente OSRM, matriz, trazos y caché; se agrega a AGENTS.md), migración `0008`, `src/datos` (persistencia de `tiempos`, `restricciones`, K7 y el adaptador `src/datos/operacion.ts`), acciones (generar, re-rutear con `liberadas` y frontera viva, `rutasParaGuardar`), consultas (seguimiento con proyección, `obtenerPlan` con trazos y advertencias), código de conflicto `frontera_vencida`, formulario de configuración, `docs/legal`, `docs/operacion.md`, guía de auditoría, pruebas de integración y ayudas e2e |
| Codex | Contrato y código del motor (`tramo`, matriz, horas pico, versiones, validación y resumen, fixtures `1.0.0`), `src/dominio/plan` (`entrada.ts` y tipos: matriz y horas pico en la entrada), `src/dominio/operacion` (`proyectarJornada` y `fronteraDeReruteo` con `liberadas` y frontera proyectada), pantallas de plan, seguimiento y operador, y el e2e |
| Ambos | Contratos compilables primero (P7-0, con el acuerdo que exige AGENTS.md para cambiar contratos), revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

## 11. Fuera de alcance

- Tráfico en vivo de terceros (decisión del usuario: sin gasto).
- GPS continuo del operador.
- Notificaciones push.
- Guardar el historial de alertas.
- Excluir la unidad original al liberar.
- Optimización entre rutas (Plan 8).
- Aprendizaje de tiempos y horas pico con datos reales (después del piloto). El proveedor de matriz queda detrás de `src/traslados`, de modo que se puede cambiar o enriquecer sin tocar el motor.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Velocidades de auto contra camión | `factor_camion` y horas pico configurables; calibración en el piloto con `rutas.tiempos` contra los tiempos reales |
| Pins mal puestos | Lista de "revisa el pin" con la distancia de ajuste de OSRM |
| Memoria del VPS compartido | Recorte del mapa y `mem_limit`. El mapa se puede preparar en otra máquina y copiar el volumen |
| Mapa desactualizado | Extracto fechado, identificador en cada plan y trazo, y procedimiento mensual en `docs/operacion.md` |
| OSRM caído | Respaldo aproximado con motivo. La operación (eventos y proyección) no depende de OSRM; los trazos caen a línea recta |

## 13. Respuesta a la revisión de Codex (2026-10-15)

| # | Hallazgo | Cambio |
|---|---|---|
| 1 | La proyección terminaba trabajo pendiente en el pasado | §4.3: `en_sitio` y `en_servicio` separados, fin acotado por `ahora`, descarga en curso y propiedad de hitos reales |
| 2 | La frontera envejece sin eventos | §1.8 y §4.4: frontera recalculada al validar con `ctx.reloj()` y conflicto `frontera_vencida` |
| 3 | Faltaban datos para proyectar de forma reproducible | §2.6 y §5: `rutas.tiempos` con submatriz, horas pico, fin de turno y descarga; umbral vigente por decisión (§2.7) |
| 4 | Omitidas y no atendidas sin llegada | §4.3: ubicación conocida por evidencia real; la submatriz permite el tramo A→C |
| 5 | `validarPlan` solo acepta `"1.0.0"` | §4.1: versiones, despacho, ajustes que conservan versión y fixtures `1.0.0`; regresión salvo `versionMotor` |
| 6 | Deduplicar a seis decimales rompe la regresión | §2.10: identidad exacta y prueba de colisión en el sexto decimal |
| 7 | Liberar un viaje completo | §4.4: los viajes vacíos se eliminan y se renumera; `restricciones.liberadas`; invariante 24 actualizada; pruebas parcial, completa y encadenada |
| 8 | Liberar no garantiza otra unidad | §1.7: liberar retira el compromiso; `aReubicar` de todas las jornadas; e2e con escenario forzado |
| 9 | FIFO temporal contra FIFO de admisión | §4.2: sin podas basadas en la desigualdad triangular; §8: pruebas a mano, matrices híbridas y FIFO de pospuestas |
| 10 | Advertencias y degradación parcial | §3 y §4.1: `ajusteM`, `aproximados`, motivos guardados y cada tipo de falla con su trato |
| 11 | Trazo de otro mapa | §3: llave de caché con `data_version`; respuesta con `mapa`; plazo y concurrencia; aviso en pantalla |
| 12 | Comparativo de minutos | §4.1: minutos libres en ambos lados, común a admisión, ajustes y validación |
| 13 | Rendimiento y límite de puntos | §3: índice por evaluación, prueba de menos de un segundo, límite de 400 con motivo y `consulta_mapa_ms` aparte de K7 |
| 14 | Pruebas que distingan fallas | §6 y §8: isla, pin lejano, servidor falso para fallas globales, reloj controlado y suite completa con OSRM |
| 15 | Reparto incompleto | §10: `src/dominio/plan`, `src/datos/operacion.ts`, `docs/legal` y `src/traslados` en AGENTS.md |
| Plan | La revisión del plan de implementación (2026-10-16) precisa liberadas por parada vigente, rutas sin `tiempos` acotadas por `ahora`, segundos en los hitos, invalidación de la caché de trazos, `liberable` con los criterios de la acción y la tolerancia del techo | Plan 7, §4 |
| R2-1 | (Revisión de la revisión 2, interrumpida por la cuota de Codex.) El diseño decía que el viaje en curso nunca se mueve, pero el código reubica sus pendientes si la jornada deja de estar disponible | §1.6, §2.9 y §4.4: la regla aplica solo a jornadas disponibles; las no disponibles conservan la regla del Plan 5 |
