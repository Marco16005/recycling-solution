# Plan 8 — Reacomodo de rutas: más paradas atendidas y menos tiempo muerto (diseño)

- **Fecha:** 2026-10-21.
- **Revisión:** 2. Incorpora el chequeo de constructor y los 11 hallazgos de Codex sobre la revisión 1, y la respuesta del usuario a la única pregunta que era suya (§9).
- **Base:** `main` en f89983c, con los Planes 1 a 7 validados.
- **Lo que pidió el usuario (2026-10-21):**
  - Que el reacomodo mejore "el tiempo y la cobertura y paradas". Confirmó las suposiciones de la conversación:
    - más solicitudes atendidas el mismo día;
    - las reglas de hoy se respetan, incluida la fila por orden de llegada;
    - en un re-ruteo no se toca lo que ya va en camino;
    - el plan muestra el antes y el después.
  - Una parada extra entra "mientras quepa en la jornada laboral" y siempre que no la alargue más de "10-15 minutos o así"; si fuera más, no. Pidió colaborar activamente con Codex.
- **Interpretación de Claude (corregible):** "alargar" se mide como tiempo muerto agregado: manejo, espera y descarga, sin contar el servicio de la propia parada, que es trabajo útil. El límite es `tolerancia_readmision_min`, configurable, con 15 por omisión.

## 1. Para qué

Hoy el motor (Plan 3) mete cada solicitud, en orden de llegada, en el mejor hueco disponible en ese momento y no vuelve a mover nada. Eso tiene dos costos:
- **Cobertura:** una solicitud que no cupo se pospone aunque, reacomodando las ya admitidas, sí cabría.
- **Tiempo:** el orden en que llegaron las solicitudes deja rutas con vueltas y esperas que un reacomodo evitaría.

El Plan 8 agrega al motor:
- una búsqueda local determinista que reacomoda las paradas ya admitidas entre posiciones, viajes y unidades;
- una readmisión, en orden de llegada, de las pospuestas sobre el plan reacomodado, incluso moviendo una parada para hacerles lugar, siempre dentro de la tolerancia del usuario;
- un reacomodo final.

Nada se saca del plan para meter a otra.

Para el Documento Integrador, el motor pasa a ser "agrupamiento no supervisado (k-means) + admisión heurística + búsqueda local con readmisión". Cada plan reporta lo que ganó el reacomodo.

## 2. Metas, no metas y antimetas

**Metas** (en orden de prioridad):
1. **Más paradas atendidas el mismo día**, cada una agregando a lo sumo `tolerancia_readmision_min` de tiempo muerto y siempre dentro del turno.
2. **Menos tiempo muerto** con el mismo conjunto de paradas.
3. **Menos km**, como desempate.

**No metas:**
- VRPTW óptimo o solver externo.
- Equilibrar la carga entre operadores.
- Reacomodar lo ajustado a mano.
- Garantizar que ninguna combinación de movimientos haría caber a una pospuesta: la búsqueda tiene presupuesto (§4.6).

**Antimetas:**
- Romper una regla: ventana, capacidad, tipo de unidad, fin de turno, viaje en curso, paradas protegidas del re-ruteo o fila por orden de llegada.
- Que una solicitud que la admisión atendía quede pospuesta.
- Que una parada extra alargue el día más que la tolerancia.
- Resultados que cambien con la misma entrada.
- Un plan que tarde tanto que el despachador espere.
- Un resumen que diga que mejoró cuando no mejoró.

## 3. Restricciones

- **Motor puro y determinista:** el presupuesto de búsqueda se cuenta en evaluaciones, nunca en tiempo de reloj ni con cachés compartidas entre corridas.
- **Rendimiento:** el flujo completo de `generarPlan`, con validación, debe tardar menos de 2 s en:
  - 60 solicitudes × 15 unidades con matriz y horas pico;
  - un día con muchas pospuestas;
  - rutas con varios viajes;
  - clientes concentrados.
  
  El presupuesto se ajusta con esas mediciones, sin recortar la validación exhaustiva.
- **Reglas del Plan 3:** se conserva la búsqueda exhaustiva de inserciones y la validación independiente. No se poda suponiendo que un desvío siempre suma tiempo: la matriz es dirigida y puede ser híbrida.
- **Re-ruteo (Planes 5 y 7):**
  - Las **protegidas** son las solicitudes de `restricciones.admitidas`, ya renumeradas por la frontera tras liberar. Conservan unidad, índice de viaje y orden relativo: ningún movimiento las cambia, incluidas las cadenas y los tramos invertidos que las crucen.
  - Un viaje con protegidas no se elimina, no se renumera y no cambia de posición.
  - Si la unidad lleva carga inicial, se conserva su viaje de regreso obligatorio.
  - Siguen igual: la excepción de jornadas no disponibles (sus pendientes, también las del viaje en curso, se reubican), la frontera proyectada y `frontera_vencida`.
- **Compatibilidad:**
  - Los planes `1.0.0` y `1.1.0` guardados se siguen viendo, ajustando y validando con su forma histórica.
  - Los nuevos son `"1.2.0"` y exigen los campos nuevos (§4.7).
  - La fase 1 de un `1.2.0` es exactamente el `1.1.0` de hoy.

## 4. Lo que se decidió del cómo

### 4.1 Fases de `generarPlan` (versión 1.2.0)

1. **Admisión** FIFO, igual a la `1.1.0`, con su traza. Da el estado S1.
2. **Reacomodo** de lo admitido (§4.4). Da S2 con objetivo(S2) ≤ objetivo(S1).
3. **Readmisión** (§4.5) de las pospuestas `sin_cupo` de la fase 1, de la más antigua a la más nueva. Da S3.
   - Las pospuestas por `sin_unidades_disponibles` o `sin_unidad_compatible` y las bloqueadas no se reintentan.
4. **Reacomodo final** (§4.4). Da S4 con objetivo(S4) ≤ objetivo(S3). S4 es `plan.rutas`.

**Garantías por fase** (y no una global: una parada extra puede subir el tiempo muerto total, hasta la tolerancia):
- Ninguna solicitud de S1 sale del plan.
- Cada readmitida agrega a lo sumo la tolerancia.
- Cada pospuesta final cumple dos cosas:
  - en la fase 1, no tuvo una inserción directa factible en el estado de su turno;
  - en la fase 3, en el estado de su turno, ninguna inserción directa factible cupo dentro de la tolerancia, y la búsqueda de "mover una y meter" (§4.5) no encontró lugar dentro de su presupuesto.
- La fila se respeta: la más antigua tiene su turno antes que cualquier más nueva en cada fase.

### 4.2 Tiempo muerto

- **Por unidad:** `fin de descarga del último viaje − inicio efectivo − servicios de sus paradas`, con `inicio efectivo = max(instanteMin, libreDesdeMin, turnoInicioMin)`, el mismo que usa la admisión. Comprende traslado con horas pico, espera y descargas.
- **Una unidad sin viajes** aporta 0. Un viaje de regreso obligatorio con carga aporta su traslado y su descarga.
- **Total:** la suma de las unidades.
- `resumen.minutosTraslado` sigue en minutos libres (Plan 7). El tiempo muerto se reporta aparte y con su etiqueta: "con horas pico, incluye espera y descargas".

### 4.3 Objetivo de los reacomodos (fases 2 y 4)

- **Orden lexicográfico:** primero el tiempo muerto total, luego los km totales.
- **Aceptación:** un movimiento se acepta solo si **mejora estrictamente** ese par.
- **Desempate:** entre candidatos con la misma mejora gana el primero en el orden canónico de enumeración (unidad, viaje, posición), y ese orden nunca cuenta como mejora.
- **`movimientos`** cuenta solo mejoras estrictas.

### 4.4 Reacomodo (búsqueda local)

- **Descenso por vecindarios (VND):** se recorre una lista fija de vecindarios; del primero que tenga alguna mejora se aplica la **mejor**, y se vuelve a empezar desde el primero. Termina cuando ninguno mejora o se acaba el presupuesto.
- **Vecindarios**, en orden:
  1. mover una parada a otra posición, de su viaje, de otro viaje de su unidad, de otra unidad o a un viaje nuevo al final;
  2. intercambiar dos paradas de viajes distintos;
  3. mover una cadena de 2 o 3 paradas consecutivas;
  4. invertir un tramo dentro de un viaje.
- **Candidato factible.** Solo se acepta si cumple todo lo siguiente:
  - tipo de unidad admitido por cada parada trasladada;
  - sin repetidos;
  - sin viajes vacíos, salvo el de regreso obligatorio;
  - protegidas intactas;
  - capacidad, ventanas y fin de turno según el cálculo de horarios.
  
  El cálculo de horarios de la admisión no revisa por sí solo el tipo de unidad ni los viajes vacíos, así que esas comprobaciones van aparte.
- **Recálculo:** solo de las rutas de las unidades afectadas, con el contexto de traslados de la evaluación.
- **Presupuesto:** `PRESUPUESTO_EVALUACIONES` por fase (supuesto inicial: 100 000 evaluaciones de ruta), fijado en el motor. Cada candidato cuesta tantas evaluaciones como rutas recalcula. Si el presupuesto se agota a mitad de un vecindario, se aplica la mejor mejora estricta encontrada hasta ese candidato, si la hay, y la fase termina. Es determinista porque la enumeración es fija.

### 4.5 Readmisión (fase 3)

Para cada pospuesta `sin_cupo` de la fase 1, en orden FIFO (registro, folio, id), sobre el estado vigente:

1. **Inserción directa:** la misma búsqueda exhaustiva de la admisión. Entre las inserciones factibles cuyo Δ tiempo muerto total ≤ tolerancia, se elige la de menor Δ, con desempate canónico.
2. **Mover una y meter**, si no hubo directa dentro de la tolerancia:
   - se prueba mover **una** parada no protegida a otra posición factible, de cualquier unidad, y después insertar la pospuesta;
   - el Δ que cuenta es el de las dos operaciones juntas, contra el estado de su turno;
   - se elige el de menor Δ dentro de la tolerancia, con presupuesto propio (`PRESUPUESTO_READMISION`, supuesto: 20 000 evaluaciones por pospuesta) y enumeración canónica.
3. **Si no hubo lugar**, la pospuesta queda con su motivo:
   - `sin_cupo` si no hubo ninguna inserción directa factible;
   - `alarga_la_jornada` (nuevo) si hubo directas factibles pero todas pasaban la tolerancia, con el Δ mínimo en su diagnóstico. En pantalla: "Cabría, pero alarga la jornada N min".
   
   El despachador puede meterla a mano con "mover".
4. **Traza de la fase 3:** cada decisión guarda el estado antes, el resultado y, si fue "mover una y meter", la parada movida con su origen y destino, y el Δ.

### 4.6 Validación independiente (`validarPlan`)

La validación no repite las búsquedas: comprueba sus resultados. Para un `1.2.0` automático:

1. **Fase 1.** Se reproduce la traza como hoy; da S1 y las pospuestas de la fase 1. No se reconstruye el pasado filtrando las rutas finales.
2. **S2** (`reacomodo.rutasReacomodadas`):
   - cada ruta se reconstruye de forma independiente y es factible;
   - contiene exactamente las solicitudes de S1;
   - protegidas intactas;
   - objetivo(S2) ≤ objetivo(S1).
3. **Readmisión.** Se reproduce desde S2:
   - exactamente una decisión por cada `sin_cupo` de la fase 1, en orden FIFO, sin omisiones, repetidos ni bloqueos nuevos;
   - cada `rutasAntes` es igual al estado reconstruido;
   - una readmitida directa es una inserción factible con Δ ≤ tolerancia;
   - una de "mover una y meter" aplica primero el movimiento (factible, parada no protegida) y luego la inserción (factible), con Δ conjunto ≤ tolerancia;
   - una que queda `sin_cupo` no tiene ninguna inserción directa factible en su estado;
   - una que queda `alarga_la_jornada` tiene directas factibles, pero todas con Δ > tolerancia, y su diagnóstico trae el Δ mínimo real.
   - Da S3.
4. **S4** (las rutas finales):
   - se reconstruyen y son factibles;
   - tienen exactamente las solicitudes de S3;
   - protegidas intactas;
   - objetivo(S4) ≤ objetivo(S3).
5. **Resto.** `pospuestas`, `bloqueadas`, `resumen` (con `tiempoMuertoMin`) y `reacomodo.antes` coinciden con lo reconstruido.
6. **Pruebas de manipulación:**
   - traza alterada;
   - S2 que saca a una admitida;
   - S2 o S4 que empeoran el objetivo;
   - readmisión fuera de orden o con Δ excedido;
   - un "mover una y meter" que mueve una protegida;
   - un hueco que se abre en la fase 4 después de rechazar a una pospuesta: es válido, porque la garantía es por turno.

### 4.7 Lo que guarda el plan (contrato; Codex lo fija en P8-0)

```ts
// ParametrosMotor agrega (entrada del plan; en 1.2.0):
toleranciaReadmisionMin?: number;      // de configuracion.tolerancia_readmision_min (0 a 60; 15 por omisión)

// MotivoPospuesta agrega: "alarga_la_jornada" (solo en 1.2.0, solo de la fase 3).
// Diagnostico agrega (opcional, solo con alarga_la_jornada): deltaMinimoMin: number.

// Plan agrega (obligatorio en 1.2.0, ausente en versiones anteriores):
reacomodo: {
  antes: Plan["resumen"] & { tiempoMuertoMin: number };   // S1
  rutasReacomodadas: RutaPlan[];                          // S2
  readmision: DecisionReadmision[];                       // fase 3, en orden FIFO
  movimientos: { fase2: number; fase4: number };          // mejoras estrictas aceptadas
  evaluaciones: { fase2: number; readmision: number; fase4: number };
};
// Plan.resumen agrega tiempoMuertoMin (obligatorio en 1.2.0, ausente en versiones anteriores).

type DecisionReadmision =
  | { solicitudId: string; resultado: "admitida"; unidadId: string; viaje: number; secuencia: number; deltaMin: number;
      movida: null | { solicitudId: string; de: { unidadId: string; viaje: number; secuencia: number };
                       a: { unidadId: string; viaje: number; secuencia: number } };
      rutasAntes: RutaPlan[] }
  | { solicitudId: string; resultado: "pospuesta"; motivo: "sin_cupo" | "alarga_la_jornada"; diagnostico: Diagnostico; rutasAntes: RutaPlan[] };
```

`traza` sigue siendo la de la fase 1. `rutas`, `pospuestas` y `resumen` son los finales.

### 4.8 Ajustes manuales

- `ajustarPlan` no reacomoda.
- Un `1.2.0` ajustado conserva `reacomodo` como **evidencia histórica del plan automático**: no se recalcula y el modo manual no lo certifica.
- `resumen` sí refleja el plan ajustado.
- La consulta y la pantalla lo dicen: "Reacomodo automático (antes de N ajustes manuales)". Las diferencias que se muestran son las del motor (S1 contra S4), nunca se atribuyen al optimizador las de un ajuste.
- Pruebas: mover, posponer y actualizar hora sobre un `1.2.0`.

### 4.9 Lo demás del sistema

- **Configuración (Claude):**
  - columna `tolerancia_readmision_min` (0 a 60, 15 por omisión; migración `0009`);
  - campo "Tolerancia para una parada extra (min de tiempo muerto)" con la nota "si una parada extra alarga el día más que esto, se queda para otro día";
  - `construirEntrada` (Codex) la copia a los parámetros.
- **Plan del día (pantalla, Codex):**
  - la franja "Reacomodo: +N paradas atendidas · tiempo muerto ±M min · ±K km", con el signo real;
  - el detalle antes/después: ruteadas, pospuestas, tiempo muerto, km y minutos de traslado;
  - "Sin mejoras" si S4 es igual a S1 en esas métricas;
  - el motivo `alarga_la_jornada` en pospuestas, con su Δ.
- **Consultas y acciones (Claude):**
  - `obtenerPlan` expone `reacomodo` (antes, después, movimientos, ajustado a mano) o `null` en planes anteriores;
  - etiqueta del motivo nuevo en la cola;
  - pruebas de integración de re-ruteo: liberar un viaje completo, re-ruteos encadenados, avería y avance del reloj durante la revisión, todos con el reacomodo activo.
- **Simulación (Codex, `scripts/simular.mts`):** los 20 días sintéticos se corren con la `1.1.0` (fase 1 sola) y con la `1.2.0`. `docs/simulacion/resultados.md` reporta, por día y en total:
  - paradas atendidas y pospuestas;
  - tiempo muerto y km;
  - readmitidas y cuántas quedaron por `alarga_la_jornada`.
  
  Es la evidencia para el Documento Integrador.
- **K4 simulado y K7:** el ahorro simulado contra el método actual sale ya del plan final. K7 mide el motor completo, reacomodo incluido.

## 5. Lo que se deja al constructor

- Estructura interna del VND y de la readmisión, la representación de rutas y las cachés dentro de una corrida.
- Valores finales de los presupuestos, siempre que se cumpla §3.
- Detalles visuales de la franja en pantalla, dentro de §4.9.
- Si `rutasReacomodadas` y `rutasAntes` se guardan completas o como secuencias de ids, siempre que la validación reconstruya el estado de forma independiente.

## 6. Pruebas que deben existir

- **Propiedades,** sobre los generadores de los Planes 3 y 7, con matrices dirigidas e híbridas y horas pico:
  - todas las solicitudes de S1 siguen en S4;
  - objetivo(S2) ≤ objetivo(S1) y objetivo(S4) ≤ objetivo(S3);
  - cada readmitida con Δ ≤ tolerancia;
  - determinismo;
  - partición, capacidad, ventanas, turno y tipo;
  - protegidas intactas;
  - las garantías FIFO por turno de §4.1;
  - la fase 1 es igual a la `1.1.0`.
- **Casos a mano:**
  - dos solicitudes en orden cruzado que el reacomodo intercambia, con la baja de tiempo muerto calculada;
  - una pospuesta que cabe solo tras reacomodar;
  - una que cabe solo con "mover una y meter";
  - una que cabría con +40 min y queda `alarga_la_jornada` con Δ 40;
  - una antigua que no cabe mientras entra una más nueva;
  - un re-ruteo cuyas cadenas e inversiones cruzan protegidas;
  - carga inicial con regreso obligatorio;
  - "Sin mejoras".
- **Compatibilidad:**
  - fixtures `1.0.0` y `1.1.0` (la `1.1.0` se captura antes del cambio) que se leen, ajustan y validan con su forma histórica;
  - `1.0.0` sigue rechazando matriz y horas pico;
  - las manipulaciones de §4.6.
- **Rendimiento:** los escenarios de §3.
- **Integración y e2e:**
  - las pruebas de re-ruteo de §4.9;
  - generar un plan muestra la franja del reacomodo;
  - la configuración guarda la tolerancia;
  - toda la suite existente en verde; sus horarios pueden cambiar y cada responsable corrige su archivo.

## 7. Reparto (AGENTS.md)

| Quién | Qué |
|---|---|
| Codex | Contratos del motor (§4.7), VND, readmisión con "mover una y meter", validación por fases, fixtures, propiedades, rendimiento, `construirEntrada` con la tolerancia, simulación, pantalla del plan y su e2e |
| Claude | Revisión del diseño y del código, migración `0009` y configuración, `obtenerPlan` con `reacomodo`, etiqueta del motivo nuevo, pruebas de integración de re-ruteo, ayudas e2e, guía de auditoría, especificación §8, §14 y §16, hoja de ruta, y la ejecución de todas las pruebas en contenedor |
| Ambos | Contratos compilables primero, revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

Si Codex se queda sin cuota, Claude puede tomar tareas del motor que no sean pantallas, documentando la reasignación en el plan, y Codex las revisa.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| El reacomodo o la readmisión tardan demasiado | Presupuestos por evaluaciones, escenarios de rendimiento de §3 y K7 |
| La validación por fases se vuelve compleja | Valida resultados, no repite búsquedas; pruebas de manipulación de §4.6 |
| "Mover una y meter" no encuentra lugares que una búsqueda más profunda sí | Declarado como no meta; la simulación mide cuánto se gana |
| La tolerancia de 15 min no es la que el usuario imaginó | Configurable, y la pantalla muestra el Δ de cada pospuesta `alarga_la_jornada` |
| Los horarios de pruebas existentes cambian | Cada responsable corrige su archivo; suite completa al cierre |

## 9. Respuestas a la revisión de Codex (2026-10-21)

| # | Hallazgo | Resolución |
|---|---|---|
| A1 | ¿Puede subir el tiempo muerto total al atender más? | **Usuario:** sí, si cabe en el turno y cada parada extra agrega a lo sumo 10 a 15 min. §4.1, §4.5 y `tolerancia_readmision_min` |
| A2 | ¿Cobertura oportunista o búsqueda activa? | **Claude:** activa pero acotada: "mover una y meter" con presupuesto (§4.5); lo que requiera más profundidad queda como no meta |
| B1 | Garantía global de tiempo incompatible con la readmisión | Garantías por fase (§4.1) y signo real en pantalla |
| B2 | El objetivo no busca espacio para readmitir | "Mover una y meter" evalúa juntos el movimiento y la inserción (§4.5) |
| B3 | Evidencia FIFO histórica y completa por fase | §4.1 y §4.6: garantía por turno documentado, reconstrucción independiente, una decisión por pospuesta y pruebas de manipulación |
| B4 | El cálculo de horarios no comprueba tipo ni viajes vacíos | §4.4, factibilidad de candidatos; el validador reconstruye por su cuenta |
| B5 | Protegidas contra admitidas de la corrida | §3, término "protegidas", subsecuencia completa, regreso obligatorio y pruebas de cadenas e inversiones |
| B6 | Base del tiempo muerto | §4.2, inicio efectivo, unidad sin viajes, regreso obligatorio y etiqueta aparte de minutos libres |
| B7 | Ajustes manuales y comparativo | §4.8, evidencia histórica rotulada y pruebas |
| B8 | Esquemas y pruebas por versión | §3, §4.7 y §6: campos obligatorios solo en 1.2.0, fixture 1.1.0 y regresión sobre la fase 1 |
| B9 | El presupuesto no demuestra la duración | §3 y §4.4: escenarios de rendimiento, costo por rutas recalculadas y medición del flujo completo |
| B10 | Desempate contado como mejora | §4.3, mejora estricta, orden canónico solo para elegir y corte determinista |
| B11 | Integración con la frontera | §3 y §4.9: índices tras liberar, excepciones del Plan 7 y pruebas de acciones de Claude |
