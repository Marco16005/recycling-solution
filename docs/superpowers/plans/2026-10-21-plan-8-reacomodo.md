# Plan 8 — Reacomodo de rutas: plan de implementación

> **Para quien ejecute:** cada tarea tiene responsable. Forma de trabajo de los Planes 4 a 7: contratos que compilan primero, cada quien en sus carpetas (AGENTS.md), revisión cruzada y `scripts/verificar-todo.sh` en verde sobre el mismo commit. Pasos con casillas (`- [ ]`).

**Objetivo:** que el motor atienda más paradas el mismo día y con menos tiempo muerto, reacomodando y readmitiendo sin romper ninguna regla.

**Arquitectura:**
- `generarPlan` pasa a cuatro fases: admisión FIFO de hoy, reacomodo (VND), readmisión FIFO con tolerancia y reacomodo final.
- El plan guarda la evidencia de cada fase, y `validarPlan` la comprueba por fases sin repetir búsquedas.
- La tolerancia viene de la configuración. La pantalla muestra el antes y el después.

**Tecnología:** TypeScript puro en `src/motor`; Vitest y fast-check; Next.js 16, Drizzle y Postgres 17; Playwright; todo en Docker Compose.

**Especificación:** `docs/superpowers/specs/2026-10-21-plan-8-optimizacion-design.md` (revisión 2, aprobada por el usuario el 2026-10-21). Este plan argumenta desde ella; leer ambos.

## Restricciones globales

- **Ejecución:** todo en contenedores, con versiones exactas.
- **Pureza y determinismo:** `src/motor` es puro y determinista. Presupuestos en evaluaciones, nunca en tiempo de reloj ni con cachés que sobrevivan a la corrida.
- **Versiones:**
  - `VERSION_MOTOR = "1.2.0"`;
  - `validarPlan` acepta `"1.0.0"`, `"1.1.0"` y `"1.2.0"`;
  - `reacomodo` y `resumen.tiempoMuertoMin` son obligatorios en `1.2.0` y deben estar ausentes en las anteriores;
  - la fase 1 de `1.2.0` es idéntica a `1.1.0`.
- **Configuración y presupuestos:**
  - `tolerancia_readmision_min` de 0 a 60, 15 por omisión;
  - `PRESUPUESTO_EVALUACIONES` (supuesto: 100 000 por fase de reacomodo);
  - `PRESUPUESTO_READMISION` (supuesto: 20 000 por pospuesta).
- **Motivos:** `MotivoPospuesta` agrega `"alarga_la_jornada"`, solo en la fase 3. Etiqueta: "Cabría, pero alarga la jornada N min".
- **Rendimiento:** `generarPlan` con validación en menos de 2000 ms en los escenarios de la especificación §3.
- **Capas:** las pantallas solo llaman a consultas y acciones. La bitácora guarda nombres de campos. Textos en español. Solo datos sintéticos.

## Enfoque de la revisión

Cinco entradas que la especificación implica y que una persona encontraría primero. Cada una tiene su prueba en la tarea indicada.

1. **Nada que mejorar:** un día con una unidad y una sola solicitud, o sin solicitudes. El plan sale `1.2.0` con `reacomodo` vacío y coherente, la pantalla dice "Sin mejoras" y nada truena. *P8-2 y P8-5.*
2. **Re-ruteo donde todo lo que le queda a una unidad está protegido.** Esa unidad no se mueve y las demás sí se reacomodan. *P8-2.*
3. **Tolerancia 0.** Solo se readmite lo que no agrega tiempo muerto, algo posible con matrices no triangulares. El resto queda `alarga_la_jornada` con su Δ real. *P8-3.*
4. **Un día con muchas pospuestas** (40 solicitudes y 2 unidades chicas). Termina en menos de 2 s, con presupuestos deterministas. *P8-3.*
5. **Un `1.2.0` ajustado a mano.** Se ve, se vuelve a ajustar y se valida en modo manual. El antes y después dice "antes de N ajustes manuales". *P8-3 y P8-4.*

---

## 1. Reparto y orden

| # | Responsable | Tarea | Depende de |
|---|---|---|---|
| P8-0 | Claude (parte de Codex reasignada el 2026-10-21: Codex sin cuota hasta las 17:58; Codex la revisa) | Contratos de §2 que compilan | — |
| P8-1 | Claude | Migración `0009`, configuración (acción, consulta y formulario) | P8-0 |
| P8-2 | Claude (reasignada; Codex la revisa) | Tiempo muerto, VND de las fases 2 y 4, versión `1.2.0`, fixture `1.1.0`, compatibilidad, propiedades y rendimiento | P8-0 |
| P8-3 | Claude (reasignada; Codex la revisa) | Readmisión (directa y "mover una y meter"), `alarga_la_jornada`, validación por fases, manipulación y ajustes manuales | P8-2 |
| P8-4 | Claude | `obtenerPlan` con `reacomodo`; pruebas de integración de re-ruteo con reacomodo | P8-3 |
| P8-5 | Codex | Pantalla del plan (franja, detalle, motivo nuevo) y su e2e | P8-0 (contratos); P8-4 para probar |
| P8-6 | Codex | Simulación con `1.1.0` y `1.2.0`, y `docs/simulacion/resultados.md` | P8-3 |
| P8-7 | Ambos | Guía de auditoría, especificación §8, §14 y §16, hoja de ruta, revisión cruzada, `verificar-todo.sh` y merge | todas |

Ramas: Claude en `.worktrees/claude-plan-4` (rama `claude/plan-8`); Codex en `.worktrees/codex-plan-4` (rama `codex/plan-8`, que se crea desde `claude/plan-8` tras P8-0).

## 2. Contratos (P8-0)

```ts
// src/motor/tipos.ts
// ParametrosMotor agrega:
//   toleranciaReadmisionMin?: number;   // obligatorio de hecho en 1.2.0 (construirEntrada lo pone); ausente en anteriores
// MotivoPospuesta agrega: | "alarga_la_jornada"
// Diagnostico agrega:     deltaMinimoMin?: number;   // solo con alarga_la_jornada
// Plan["resumen"] agrega: tiempoMuertoMin?: number;  // obligatorio en 1.2.0
// Plan agrega:            reacomodo?: Reacomodo;     // obligatorio en 1.2.0

export interface PosicionPlan { unidadId: string; viaje: number; secuencia: number }   // viaje y secuencia desde 1
export type DecisionReadmision =
  | { solicitudId: string; resultado: "admitida"; posicion: PosicionPlan; deltaMin: number;
      movida: null | { solicitudId: string; de: PosicionPlan; a: PosicionPlan }; rutasAntes: RutaPlan[] }
  | { solicitudId: string; resultado: "pospuesta"; motivo: "sin_cupo" | "alarga_la_jornada";
      diagnostico: Diagnostico; rutasAntes: RutaPlan[] };
export interface Reacomodo {
  antes: Plan["resumen"] & { tiempoMuertoMin: number };   // S1
  rutasReacomodadas: RutaPlan[];                          // S2
  readmision: DecisionReadmision[];                       // fase 3, en orden FIFO
  movimientos: { fase2: number; fase4: number };
  evaluaciones: { fase2: number; readmision: number; fase4: number };
}

// src/motor/reacomodo.ts (nuevo)
export const PRESUPUESTO_EVALUACIONES = 100_000;
export const PRESUPUESTO_READMISION = 20_000;
/** Tiempo muerto por §4.2 de la especificación: suma por unidad de fin de descarga − inicio efectivo − servicios. */
export function tiempoMuerto(entrada: EntradaPlan, rutas: RutaPlan[]): number;

// src/dominio/plan/tipos.ts — ConfiguracionPlan agrega: toleranciaReadmisionMin?: number;
// src/consultas/plan.nucleo.ts — VistaPlan agrega:
//   reacomodo: null | {
//     antes: { ruteadas: number; pospuestas: number; tiempoMuertoMin: number; km: number; minutosTraslado: number };
//     despues: { ruteadas: number; pospuestas: number; tiempoMuertoMin: number; km: number; minutosTraslado: number };
//     readmitidas: number; alargaLaJornada: number; movimientos: number;
//     ajustesManualesDespues: number;   // > 0: "antes de N ajustes manuales"; despues es el del motor (S4)
//   };
// VistaPlan.pospuestas[].diagnostico ya expone Diagnostico (con deltaMinimoMin opcional).
```

Al agregar `"alarga_la_jornada"`, los mapas de etiquetas de motivos (`src/components/plan/plan-del-dia.tsx`) necesitan la nueva clave para compilar. P8-0 la agrega con el texto de las restricciones globales; P8-5 le da forma.

## 3. Comandos

```bash
c() { docker compose -p rs-claude-plan-8 -f compose.yaml -f compose.test.yaml "$@"; }
c run --rm unit npx vitest run --project unidad src/motor     # unidad, por carpeta o archivo
c run --rm unit npm run verificar                             # tipos, lint y unidad
c run --rm integration npx vitest run --project integracion src/acciones/plan8
c run --rm --build e2e                                        # punta a punta
scripts/verificar-todo.sh                                     # al cierre, árbol limpio y sin tocar nada mientras corre
```

---

### P8-0: Contratos compilables (Claude; parte de Codex reasignada)

**Archivos:**
- Modificar: `src/motor/tipos.ts`, `src/motor/index.ts`, `src/dominio/plan/tipos.ts`, `src/consultas/plan.nucleo.ts` (la vista con `reacomodo: null` por ahora) y `src/components/plan/plan-del-dia.tsx` (solo la clave del motivo nuevo).
- Crear: `src/motor/reacomodo.ts`, con las firmas de §2. `tiempoMuerto` lanza `"pendiente: P8-2"`.

- [ ] **Paso 1.** Escribir §2 tal cual; todos los campos nuevos opcionales en los tipos.
- [ ] **Paso 2.** Correr `c run --rm unit npm run verificar`. Esperado: verde, con las 684 pruebas de hoy.
- [ ] **Paso 3.** Commit: `Plan 8 P8-0: contratos compilables (reacomodo, readmisión, alarga_la_jornada)`, con la nota de la reasignación.

### P8-1: Tolerancia en la configuración (Claude)

**Archivos:**
- `src/datos/esquema.ts`: `tolerancia_readmision_min smallint NOT NULL DEFAULT 15`, con `CHECK BETWEEN 0 AND 60`.
- `drizzle/0009_reacomodo.sql`, generado con `npx drizzle-kit generate --name reacomodo`.
- `src/datos/configuracion.ts`.
- `src/acciones/configuracion.nucleo.ts` (Zod `z.number().int().min(0).max(60)`, opcional como los del Plan 7, en `CAMPOS`).
- `src/consultas/configuracion.nucleo.ts`.
- `src/components/admin/formulario-configuracion.tsx`.
- Pruebas: `src/datos/plan8.integracion.test.ts` y `src/acciones/configuracion.nucleo.test.ts`.

**Produce:** `ConfiguracionCompleta.toleranciaReadmisionMin: number`.

- [ ] **Paso 1: pruebas que fallan.**
  - `la configuración trae tolerancia 15 y el CHECK rechaza -1 y 61`;
  - `guardarConfiguracion acepta 0 y 60, rechaza 7.5 y 61, y la bitácora nombra toleranciaReadmisionMin sin su valor`.
- [ ] **Paso 2.** Correr las dos. Esperado: FALLA (columna o campo inexistente).
- [ ] **Paso 3.** Esquema, migración y persistencia. El formulario muestra el campo "Tolerancia para una parada extra (min de tiempo muerto)" con la nota "si una parada extra alarga el día más que esto, se queda para otro día".
- [ ] **Paso 4.** Correr las pruebas y `src/datos/migraciones`. Esperado: PASA.
- [ ] **Paso 5.** Commit: `Plan 8 P8-1: tolerancia de readmisión en la configuración (migración 0009)`.

### P8-2: Tiempo muerto y VND (Claude, reasignada; Codex la revisa)

**Archivos:**
- Modificar: `src/motor/reacomodo.ts` (tiempo muerto, objetivo y VND), `src/motor/admision.ts` (las fases 2 y 4 dentro de `generarPlan`; `calcular` se exporta para el reacomodo sin cambiar su comportamiento), `src/motor/validacion.ts` (§4.6, pasos 2, 4 y 5, y versiones) y `src/dominio/plan/entrada.ts` (copia la tolerancia; reasignado).
- Crear: `src/motor/fixtures/plan-1.1.0.json`, generado con el código de `main` **antes** de cambiar el motor, y `src/motor/reacomodo.test.ts`.

**Consume:** `crearTraslados`, `calcular`, `RestriccionesPlan`.

**Produce:**
- `tiempoMuerto(entrada, rutas)`;
- `reacomodar(entrada, rutas, solicitudes, restricciones, presupuesto) → { rutas, movimientos, evaluaciones }`, que no exporta el índice;
- `Plan.reacomodo.antes`, `rutasReacomodadas`, `movimientos` y `evaluaciones` (la readmisión queda vacía hasta P8-3).

- [ ] **Paso 1: pruebas que fallan** (`reacomodo.test.ts`). Usan una matriz explícita: patio P; clientes A y C al este y B y D al oeste. P a cualquier cliente: 30 minutos libres. Entre A y C, o entre B y D: 5. Entre este y oeste: 60. Sin horas pico, una unidad de 1600 kg y cuatro solicitudes de 800 kg en orden A, B, C y D, con ventanas amplias.
  - `la admisión arma A,B | C,D y el reacomodo lo cambia a A,C | B,D: el tiempo muerto baja exactamente 110 min`;
  - `tiempoMuerto usa el inicio efectivo max(instante, libreDesde, turnoInicio); una unidad sin viajes aporta 0; el regreso obligatorio con carga aporta traslado y descarga`;
  - `un movimiento con el mismo tiempo muerto y los mismos km no se acepta ni cuenta en movimientos`;
  - `nada que mejorar (una unidad, una solicitud; y sin solicitudes): reacomodo con movimientos 0 y rutasReacomodadas igual a S1` (enfoque 1);
  - `protegidas: cadenas e inversiones que las cruzan no se aceptan; una unidad con todo protegido no cambia y las demás sí` (enfoque 2);
  - `un candidato que mueve una parada a una unidad de tipo no admitido o deja un viaje vacío nunca se acepta`;
  - `presupuesto agotado a mitad de un vecindario: se aplica la mejor mejora hasta ese punto; dos corridas dan el mismo plan`.
- [ ] **Paso 2.** Correr `c run --rm unit npx vitest run --project unidad src/motor/reacomodo`. Esperado: FALLA ("pendiente: P8-2").
- [ ] **Paso 3.** Implementar.
  - El VND sigue la especificación §4.4 (vecindarios en ese orden, mejor mejora estricta del primero que mejora, se reinicia, presupuesto por rutas recalculadas). La factibilidad sigue §4.4. El objetivo es el par (tiempo muerto, km) de §4.3.
  - `generarPlan` llama a las fases 2 y 4 y llena `reacomodo`. Con readmisión vacía, S3 = S2.
  - `VERSION_MOTOR = "1.2.0"`.
- [ ] **Paso 4.** Validación (§4.6, pasos 2, 4 y 5):
  - reconstrucción independiente de S2 y S4;
  - mismas solicitudes que S1 y S3;
  - protegidas;
  - objetivo que no empeora;
  - versiones: campos obligatorios en `1.2.0`, ausentes en las anteriores.
  
  Pruebas: `validarPlan rechaza un 1.2.0 cuyo S2 saca a una admitida o empeora el objetivo, y un 1.1.0 con reacomodo`.
- [ ] **Paso 5.** Compatibilidad (`compatibilidad.test.ts`):
  - la regresión campo por campo contra la versión anterior pasa a compararse con S1 (`reacomodo.antes` y la traza);
  - las fixtures `1.0.0` y `1.1.0` se leen, se ajustan (con `mover` y `actualizarHora`) y se validan, y conservan su versión.
- [ ] **Paso 6.** Propiedades (generadores de `casos.test-datos.ts`, con matrices dirigidas e híbridas):
  - S1 ⊆ S4;
  - objetivo(S2) ≤ objetivo(S1);
  - determinismo;
  - partición y factibilidad;
  - protegidas intactas.
- [ ] **Paso 7.** Rendimiento: 60 × 15 con matriz y dos franjas, rutas de varios viajes y clientes concentrados, en menos de 2000 ms con validación. Ajustar `PRESUPUESTO_EVALUACIONES` si hace falta y anotar el valor final en la especificación.
- [ ] **Paso 8.** Correr `c run --rm unit npm run verificar`. Esperado: verde. Las pruebas que dependían de horarios de la `1.1.0` se ajustan, explicando cada cambio en el commit.
- [ ] **Paso 9.** Commit: `Plan 8 P8-2: tiempo muerto y reacomodo (VND) en las fases 2 y 4, versión 1.2.0`.

### P8-3: Readmisión, motivo nuevo y validación por fases (Claude, reasignada; Codex la revisa)

**Archivos:**
- Modificar: `src/motor/reacomodo.ts` (`readmitir`), `src/motor/admision.ts` (la fase 3 entre la 2 y la 4), `src/motor/validacion.ts` (§4.6, paso 3, y las pospuestas finales), `src/motor/ajustes.ts` (`reacomodo` se conserva intacto y `resumen.tiempoMuertoMin` se recalcula en `1.2.0`).
- Pruebas: `src/motor/readmision.test.ts`.

**Produce:** `readmitir(entrada, rutas, pospuestasFifo, tolerancia, presupuesto) → { rutas, decisiones: DecisionReadmision[], evaluaciones }`.

- [ ] **Paso 1: pruebas que fallan** (`readmision.test.ts`), sobre matrices explícitas construidas para cada caso, con los Δ calculados en el comentario de la prueba:
  - `una pospuesta sin_cupo en la fase 1 cabe tras el reacomodo y entra con su Δ`;
  - `una que solo cabe moviendo una parada entra con movida registrada (de, a) y Δ conjunto ≤ tolerancia`;
  - `una que cabría con Δ 40 queda alarga_la_jornada con diagnostico.deltaMinimoMin = 40`;
  - `tolerancia 0: solo entra lo de Δ ≤ 0; el resto alarga_la_jornada con su Δ real` (enfoque 3);
  - `orden FIFO: la antigua que no cabe se decide antes que la nueva que sí, y la decisión de la antigua queda primero`;
  - `"mover una y meter" nunca mueve una protegida`;
  - `sin_unidades_disponibles y sin_unidad_compatible no se reintentan`;
  - `40 solicitudes y 2 unidades chicas: menos de 2000 ms con validación, y dos corridas dan el mismo plan` (enfoque 4).
- [ ] **Paso 2.** Correr `c run --rm unit npx vitest run --project unidad src/motor/readmision`. Esperado: FALLA.
- [ ] **Paso 3.** Implementar `readmitir` siguiendo §4.5 de la especificación:
  - primero la inserción directa exhaustiva con Δ mínimo dentro de la tolerancia;
  - después "mover una y meter", con su propio presupuesto;
  - el motivo, según haya o no directas factibles.
  
  `generarPlan` pone las decisiones en `reacomodo.readmision` y las pospuestas finales en `plan.pospuestas`.
- [ ] **Paso 4.** Validación (§4.6, pasos 3 y 6). Pruebas de manipulación:
  - `rechaza readmisión fuera de orden, con Δ excedido, con una decisión de más o de menos, con rutasAntes alterado, con movida protegida, y una pospuesta alarga_la_jornada cuyo Δ mínimo real está dentro de la tolerancia`;
  - `acepta un hueco abierto por la fase 4 después de rechazar una pospuesta`.
- [ ] **Paso 5.** Ajustes manuales: `ajustar un 1.2.0 (mover, posponer, actualizarHora) conserva reacomodo intacto, recalcula resumen.tiempoMuertoMin y valida en modo manual` (enfoque 5).
- [ ] **Paso 6.** Propiedades:
  - cada readmitida con Δ ≤ tolerancia;
  - cada pospuesta final cumple §4.1;
  - S1 ⊆ S4;
  - objetivo(S4) ≤ objetivo(S3).
- [ ] **Paso 7.** Correr `c run --rm unit npm run verificar`. Esperado: verde.
- [ ] **Paso 8.** Commit: `Plan 8 P8-3: readmisión FIFO con tolerancia y "mover una y meter"; validación por fases`.

### P8-4: Consulta y re-ruteo con reacomodo (Claude)

**Archivos:**
- `src/consultas/plan.nucleo.ts`: `reacomodo` de §2 desde `plan.resultado.reacomodo`, `resumen` y `plan.ajustes.length`; `null` si la versión no es `1.2.0`.
- Pruebas: `src/consultas/plan8.integracion.test.ts` y `src/acciones/plan8.integracion.test.ts`.

- [ ] **Paso 1: pruebas que fallan.**
  - `obtenerPlan expone antes y después del reacomodo y null en un plan 1.1.0`;
  - `tras un ajuste manual, ajustesManualesDespues = 1 y despues sigue siendo S4`;
  - acciones con reacomodo activo, OSRM real y matriz sintética:
    - `re-ruteo que libera un viaje completo`;
    - `re-ruteos encadenados`;
    - `avería con viaje en curso`;
    - `frontera_vencida con el reloj avanzando durante la revisión`;
    - en todos, las protegidas intactas y el plan validado.
- [ ] **Paso 2.** Correr `c run --rm integration npx vitest run --project integracion src/consultas/plan8 src/acciones/plan8`. Esperado: FALLA.
- [ ] **Paso 3.** Implementar la consulta. Las acciones no cambian, salvo lo que exijan las pruebas, con su motivo en el commit.
- [ ] **Paso 4.** Correr las pruebas y la integración completa. Esperado: verde.
- [ ] **Paso 5.** Commit: `Plan 8 P8-4: plan con antes y después del reacomodo; re-ruteo probado con reacomodo`.

### P8-5: Pantalla del plan y e2e (Codex)

**Archivos:** `src/components/plan/plan-del-dia.tsx` (y lo que haga falta en `src/components/plan`) y `e2e/plan.spec.ts`.

**Nombres accesibles** (los usa el e2e):
- región "Reacomodo", con el texto "Reacomodo:", seguido de "+N paradas atendidas", "tiempo muerto ±M min" y "±K km" (signo real), o "Sin mejoras";
- "Reacomodo automático (antes de N ajustes manuales)" si `ajustesManualesDespues > 0`;
- en pospuestas, "Cabría, pero alarga la jornada N min".

- [ ] **Paso 1.** La franja y el detalle antes y después: ruteadas, pospuestas, tiempo muerto ("con horas pico, incluye espera y descargas"), km y minutos de traslado.
- [ ] **Paso 2.** e2e: en `plan.spec`, tras generar se ve la región "Reacomodo" (con mejoras o "Sin mejoras"); el motivo nuevo cuando aparezca (ayuda de Claude si hace falta un escenario).
- [ ] **Paso 3.** Claude corre `npm run verificar` y el e2e. Esperado: verde. Commit con "Autor: Codex".

### P8-6: Simulación (Codex)

**Archivos:** `scripts/simular.mts`, `docs/simulacion/resultados.md`, `docs/simulacion/resultados.csv` y `docs/simulacion/README.md`.

- [ ] **Paso 1.** Los 20 días sintéticos con la `1.1.0`, que es la fase 1 sola (exponer la fase 1 sin reacomodo solo para la simulación y las pruebas), y con la `1.2.0`.
  - Por día: atendidas, pospuestas, readmitidas, `alarga_la_jornada`, tiempo muerto y km.
  - Total y porcentaje de mejora.
- [ ] **Paso 2.** Claude lo corre en contenedor (`c run --rm unit npx tsx scripts/simular.mts`) y revisa que sea determinista: dos corridas, el mismo CSV. Commit con "Autor: Codex".

### P8-7: Documentación y cierre (Ambos)

- [ ] **Paso 1** (Claude). Documentación:
  - `docs/guia-de-auditoria.md`, invariantes nuevas:
    - 31: ninguna admitida sale y el objetivo no empeora por fase;
    - 32: cada readmitida agrega a lo sumo la tolerancia;
    - 33: FIFO por turno documentado;
  - especificación del piloto: §8 (algoritmo con fases 2 a 4 y por qué se le llama IA), §14 (decisión de la tolerancia, del usuario) y §16;
  - hoja de ruta y `docs/README.md`.
- [ ] **Paso 2.** Revisión cruzada: Codex revisa P8-0 a P8-4; Claude revisa P8-5 y P8-6. Formato de la guía.
- [ ] **Paso 3.** `scripts/verificar-todo.sh` sobre el mismo commit, con el árbol limpio. Esperado: "Verificación completa: todo en verde.".
- [ ] **Paso 4.** Veredicto de ambos. Merge `--no-ff` a `main` y etiqueta `plan-8-validado`. Sin push.
