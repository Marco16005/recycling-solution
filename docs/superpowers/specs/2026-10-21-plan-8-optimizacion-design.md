# Plan 8 — Reacomodo de rutas: más paradas atendidas y menos tiempo muerto (diseño)

- **Fecha:** 2026-10-21.
- **Revisión:** 1 (borrador para la revisión de Codex y del usuario).
- **Base:** `main` en f89983c, con los Planes 1 a 7 validados.
- **Lo que pidió el usuario (2026-10-21):** que el reacomodo mejore "el tiempo y la cobertura y paradas". Confirmó todas las suposiciones de la conversación:
  - más solicitudes atendidas el mismo día;
  - las reglas de hoy se respetan, incluida la fila por orden de llegada;
  - en un re-ruteo no se toca lo que ya va en camino;
  - el plan muestra el antes y el después.
  - Pidió colaborar activamente con Codex.
- **Decisión de Claude:** "tiempo" son los tiempos muertos de la tesis: minutos de traslado y de espera, más la descarga, que cambia si se juntan o separan viajes.

## 1. Para qué

Hoy el motor (Plan 3) mete cada solicitud, en orden de llegada, en el mejor hueco disponible en ese momento y no vuelve a mover nada. Eso tiene dos costos:
- **Cobertura:** una solicitud que no cupo se pospone aunque, reacomodando las ya admitidas, sí cabría.
- **Tiempo:** el orden en que llegaron las solicitudes deja rutas con vueltas y esperas que un reacomodo evitaría.

El Plan 8 agrega al motor una búsqueda local determinista que reacomoda las paradas ya admitidas entre posiciones, viajes y unidades. Después vuelve a intentar, en orden de llegada, las pospuestas en el plan reacomodado y reacomoda otra vez. Nada se saca del plan para meter a otra: solo se gana espacio.

Para el Documento Integrador, el motor pasa a ser "agrupamiento no supervisado (k-means) + admisión heurística + búsqueda local". Cada plan reporta lo que ganó el reacomodo.

## 2. Metas, no metas y antimetas

**Metas** (en orden de prioridad, que es también el orden de la función objetivo, §4.3):
1. **Más paradas atendidas el mismo día:** el reacomodo libera espacio y las pospuestas se reintentan en orden de llegada.
2. **Menos tiempo muerto:** minutos de traslado y de espera, y descargas.
3. **Menos km**, como desempate.

**No metas:**
- VRPTW óptimo o solver externo (OR-Tools, VROOM): el contrato del motor lo permite más adelante, pero no es este plan.
- Equilibrar la carga entre operadores.
- Optimizar los ajustes manuales: lo que el despachador mueve a mano se respeta tal cual.

**Antimetas** (fracasos aunque el código "funcione"):
- Romper una regla de hoy: ventana, capacidad, tipo de unidad, fin de turno, viaje en curso, admitidas del re-ruteo o la fila por orden de llegada.
- Que una solicitud que el plan sin reacomodo atendía quede pospuesta.
- Resultados que cambian de una corrida a otra con la misma entrada.
- Un plan que tarda tanto que el despachador espera; o un resumen que diga que mejoró cuando no mejoró.

## 3. Restricciones

- **Motor puro y determinista:** misma entrada y semilla, mismo plan. El presupuesto de búsqueda se mide en evaluaciones, nunca en tiempo de reloj.
- **Rendimiento:** 60 solicitudes y 15 unidades con matriz y horas pico en menos de 2 s en total, incluida la validación (hoy: menos de 1 s sin reacomodo). El límite de K7 sigue en 30 s.
- **Reglas del Plan 3:** se conserva la búsqueda exhaustiva de inserciones y la validación independiente. No se poda suponiendo que un desvío siempre suma tiempo: la matriz es dirigida y puede ser híbrida.
- **Re-ruteo (Plan 5):**
  - las admitidas conservan unidad, número de viaje y orden relativo, como hoy valida `validarPlan`;
  - el reacomodo solo mueve paradas no admitidas;
  - un viaje con admitidas no se elimina, no se renumera y no cambia de posición;
  - lo congelado no entra al motor.
- **Compatibilidad:** los planes `1.0.0` y `1.1.0` guardados se siguen viendo, ajustando y validando igual. Los nuevos son `"1.2.0"`.

## 4. Lo que se decidió del cómo

### 4.1 Fases de `generarPlan` (versión 1.2.0)

1. **Admisión** FIFO, como hoy, con su traza.
2. **Reacomodo** de lo admitido (§4.2).
3. **Readmisión:** las pospuestas `sin_cupo` de la fase 1 se intentan otra vez, de la más antigua a la más nueva, con la misma inserción de la fase 1 sobre el plan reacomodado. Queda una segunda traza con el estado antes de cada decisión. Las pospuestas por `sin_unidades_disponibles` o `sin_unidad_compatible` y las bloqueadas no se reintentan.
4. **Reacomodo final** de todo lo admitido.

**Por qué se respeta la fila.** Una pospuesta final A nunca tuvo un hueco factible:
- ni en el plan con lo admitido antes que ella (fase 1, como hoy);
- ni en el plan reacomodado cuando le tocó su turno de readmisión, que contiene todo eso y más.

Ninguna admitida sale nunca del plan.

### 4.2 Reacomodo (búsqueda local)

- Es descenso por vecindarios (VND): se recorre una lista fija de vecindarios y se aplica la **mejor** mejora del primero que tenga alguna. Se vuelve al primero tras cada mejora y se termina cuando ninguno mejora o se acaba el presupuesto.
- **Vecindarios**, en este orden:
  1. **mover una parada** a otra posición, de su viaje, de otro viaje de su unidad, de otra unidad o a un viaje nuevo al final;
  2. **intercambiar dos paradas** de viajes distintos;
  3. **mover una cadena** de 2 o 3 paradas consecutivas;
  4. **invertir un tramo** dentro de un viaje.
- Cada candidato se recalcula completo con la misma función de horarios de la admisión (`calcular`, con matriz y horas pico) y solo se acepta si es factible.
- **Desempates:** fijos (unidad, viaje y posición en orden canónico) para que el resultado sea determinista.
- **Presupuesto:** `PRESUPUESTO_EVALUACIONES` (supuesto inicial: 200 000 evaluaciones de ruta por fase), fijado en el motor. Se ajusta con la prueba de rendimiento.

### 4.3 Función objetivo (lexicográfica, sobre las paradas ya admitidas)

1. **Tiempo muerto total:** la suma, por unidad, de `fin de descarga del último viaje − inicio de su jornada − servicios`. Es traslado (con horas pico) + espera + descargas. Juntar dos viajes ahorra una descarga y un regreso; separar los cuesta.
2. **Km totales.**
3. **Desempate canónico**, para que el resultado sea determinista.

Un movimiento solo se acepta si mejora el objetivo. Así el reacomodo nunca empeora ni el tiempo muerto ni, a igual tiempo, los km.

### 4.4 Lo que guarda el plan

```ts
// Plan agrega (solo en 1.2.0):
reacomodo: {
  /** Resumen del plan tal como quedó tras la admisión (fase 1), para el antes y después. */
  antes: Plan["resumen"] & { tiempoMuertoMin: number };
  /** Rutas al terminar la fase 2: punto de partida de la readmisión. */
  rutasReacomodadas: RutaPlan[];
  /** Decisiones de la fase 3, en orden FIFO, con el estado antes de cada una (como traza). */
  readmision: DecisionTraza[];
  /** Movimientos aceptados y evaluaciones usadas en las fases 2 y 4 (diagnóstico). */
  movimientos: number; evaluaciones: number;
};
// Plan.resumen agrega tiempoMuertoMin (en 1.2.0) para mostrar el después.
```

- `traza` sigue siendo la de la fase 1. Así `pospuestas` y `rutas` del plan son las finales.
- `resumen` es el final.

### 4.5 Validación independiente (`validarPlan`)

Para un `1.2.0` automático:
1. La traza de la fase 1 se reproduce como hoy: da el estado S1 y las pospuestas de la fase 1.
2. `rutasReacomodadas`:
   - cada ruta se reconstruye y es factible (como en el modo manual);
   - contiene exactamente las admitidas de S1;
   - respeta las admitidas del re-ruteo;
   - su tiempo muerto no supera el de S1 y, si es igual, sus km tampoco.
3. La readmisión se reproduce desde `rutasReacomodadas`:
   - recorre en orden FIFO las pospuestas `sin_cupo` de la fase 1;
   - una readmitida es una inserción factible;
   - una que sigue pospuesta no tiene ninguna inserción factible en el estado de su turno.
   - Da el estado S3.
4. Las rutas finales:
   - se reconstruyen y son factibles;
   - tienen exactamente las admitidas de S3;
   - respetan las admitidas del re-ruteo;
   - no empeoran el objetivo de S3.
5. `pospuestas`, `bloqueadas`, `resumen` y `reacomodo.antes` coinciden con lo reconstruido.

La validación no repite la búsqueda: comprueba sus resultados.

### 4.6 Lo demás del sistema

- **Ajustes manuales** (`ajustarPlan`): no reacomodan. Un plan `1.2.0` ajustado se valida en modo manual, como hoy, y conserva su versión.
- **Re-ruteo:** pasa por las cuatro fases con sus restricciones.
- **Plan del día (pantalla, Codex):**
  - una franja "Reacomodo: +N paradas atendidas, −M min de tiempo muerto, −K km";
  - el detalle antes/después: ruteadas, pospuestas, tiempo muerto, km y minutos de traslado;
  - "Sin mejoras" si no hubo movimientos.
- **Consultas (Claude):** `obtenerPlan` expone `reacomodo` (antes, después, movimientos) o `null` en planes anteriores.
- **Simulación (Codex, `scripts/simular.mts`):** los 20 días sintéticos se corren con y sin reacomodo, y `docs/simulacion/resultados.md` reporta, por día y en total:
  - paradas atendidas y pospuestas;
  - tiempo muerto;
  - km.
  
  Es la evidencia para el Documento Integrador.
- **K4 simulado y K7:** el ahorro simulado contra el método actual sale ya del plan final. K7 mide el motor completo, reacomodo incluido.

## 5. Lo que se deja al constructor

- Estructura interna del VND, caché de evaluaciones y representación de rutas.
- Valor final de `PRESUPUESTO_EVALUACIONES`, siempre que se cumpla el rendimiento de §3.
- Detalles de la franja en pantalla, dentro de §4.6.
- Si `rutasReacomodadas` se guarda completa o solo como secuencias de ids. La validación necesita poder reconstruir el estado, y el estado se reconstruye desde las secuencias.

## 6. Pruebas que deben existir

- **Propiedades** sobre los generadores del Plan 3 y del Plan 7 (matrices dirigidas e híbridas, horas pico):
  - el plan final atiende al menos todas las que atendía la fase 1;
  - el tiempo muerto final ≤ el de la fase 1;
  - determinismo;
  - partición, capacidad, ventanas, turno y tipo;
  - admitidas intactas;
  - FIFO de las pospuestas finales según §4.1.
- **Casos a mano:**
  - dos solicitudes en orden "cruzado" que el reacomodo intercambia y baja el tiempo muerto en una cantidad calculada;
  - una pospuesta que cabe solo tras reacomodar, y entra;
  - una antigua que sigue sin caber mientras una más nueva entra en la readmisión, en orden correcto;
  - un re-ruteo con admitidas donde el reacomodo mueve solo las no admitidas;
  - un plan donde no hay nada que mejorar ("Sin mejoras").
- **Compatibilidad:** las fixtures `1.0.0` y `1.1.0` siguen validando y ajustando; `validarPlan` rechaza un `1.2.0` con un reacomodo que empeora el objetivo o que saca a una admitida.
- **Rendimiento:** 60 × 15 con matriz y horas pico en menos de 2 s, validación incluida.
- **Integración y e2e:**
  - generar un plan muestra la franja del reacomodo;
  - toda la suite existente sigue en verde (sus horarios pueden cambiar: se corrigen en su archivo, por su responsable).

## 7. Reparto (AGENTS.md)

| Quién | Qué |
|---|---|
| Codex | Contratos del motor (`Plan.reacomodo`, `resumen.tiempoMuertoMin`, versión 1.2.0), VND, readmisión, validación, fixtures, propiedades, rendimiento, simulación, pantalla del plan y su e2e |
| Claude | Revisión del diseño y del código, `obtenerPlan` con `reacomodo`, ajustes de persistencia si hicieran falta (es jsonb, sin migración prevista), ayudas e2e, guía de auditoría (invariantes), especificación §8 y §16, hoja de ruta, y la ejecución de todas las pruebas en contenedor |
| Ambos | Contratos compilables primero, revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

Si Codex se queda sin cuota, Claude puede tomar tareas del motor que no sean pantallas, documentando la reasignación en el plan, y Codex las revisa (como en los Planes 6 y 7).

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| El reacomodo tarda demasiado en días grandes | Presupuesto por evaluaciones, prueba de rendimiento y K7 |
| La validación se vuelve compleja | Valida resultados por fases, no repite la búsqueda; las pruebas incluyen planes alterados a propósito |
| Los horarios de pruebas existentes cambian | Cada responsable corrige su archivo; la suite completa corre en P8-final |
| El tiempo muerto mezcla traslado, espera y descarga | El resumen muestra también km y minutos de traslado por separado |
