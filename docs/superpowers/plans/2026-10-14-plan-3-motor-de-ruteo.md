# Plan 3 — Motor de ruteo y simulación

- **Fecha:** 2026-10-14.
- **Especificación:** §7 (reglas 3 a 5), §8 (motor) y §14 (decisiones 2 a 5).
- **Revisión 2 (2026-10-14):** incorpora los bloqueantes 1 a 4 y las propuestas de capacidad por tipo y diagnóstico de la revisión de Codex.
- **Responsable:** Codex (`src/motor`, sus pruebas y la simulación). Claude revisa, integra y ejecuta.
- **Paralelo:** se desarrolla junto con el Plan 2. Solo depende de los tipos de este documento; no usa base de datos ni pantallas.

## 1. Objetivo y aceptación

1. `generarPlan(entrada)` arma las rutas del día con la política FIFO global y la inserción factible (especificación §7.4 y §8), con zonas por k-means++ con semilla, y devuelve la traza de decisiones.
2. `validarPlan(entrada, plan)` comprueba, sin reutilizar el algoritmo, todas las propiedades de §5. `generarPlan` lo llama antes de devolver y lanza un error si falla.
3. El re-ruteo del Plan 5 usa el mismo `generarPlan`, con unidades que ya descuentan lo congelado (§3).
4. Pruebas de propiedades con fast-check (§5) y casos límite (§6).
5. Rendimiento: 60 solicitudes y 15 unidades en menos de 1 s en el contenedor de pruebas.
6. `scripts/simular.mts` produce, con datos sintéticos, el comparativo contra el método actual (un viaje redondo por cliente) para la Sección 8 del Documento Integrador: kilómetros, minutos de traslado, recolecciones atendidas y pospuestas.

## 2. Unidades de medida

- **Tiempo:** minutos desde la medianoche de la fecha del plan, en hora de Ciudad de México (entero). Las conversiones a fecha y hora las hace quien llama al motor (Plan 4).
- **Distancia:** kilómetros (número real).
- **Peso:** kilogramos (entero).

## 3. Contrato (`src/motor/tipos.ts`)

```ts
import type { TipoUnidad } from "@/dominio/clientes/tipos";

export interface Coordenada { lat: number; lng: number }

export interface ParametrosMotor {
  patio: Coordenada;
  turnoInicioMin: number;        // de configuracion.turno_inicio (480 = 08:00 por omisión)
  turnoFinMin: number;           // de configuracion.turno_fin; incluye regreso y descarga
  velocidadKmh: number;
  factorCircuidad: number;
  descargaMin: number;           // al volver al patio, por viaje
  /** Mayor capacidad entre las unidades activas del catálogo de cada tipo, disponibles hoy o no. 0 si no hay de ese tipo. */
  capacidadMaximaPorTipoKg: Record<TipoUnidad, number>;
  semilla: number;
}

/** Limita el INICIO del servicio: se puede llegar antes y esperar a que abra; el servicio puede terminar después del fin. */
export interface VentanaMin { inicioMin: number; finMin: number }

export interface SolicitudMotor {
  id: string;
  folio: string;
  registradaEn: string;          // ISO 8601; llave FIFO junto con folio
  clienteId: string;
  ubicacion: Coordenada;
  ventanas: VentanaMin[];        // no vacía; el Plan 4 solo envía solicitudes habilitadas ese día
  tiempoServicioMin: number;
  cargaKg: number;               // ya resuelta con cargaEfectivaKg
  tiposUnidadAdmitidos: TipoUnidad[];
}

/**
 * Unidad tal como queda libre para el motor. En el plan del día: patio, disponibleDesde y carga 0.
 * En el re-ruteo (Plan 5), quien llama ya descontó todo lo congelado (paradas hechas, en sitio y el tramo en curso):
 * la unidad empieza donde y cuando termina lo congelado, con la carga que lleva.
 */
export interface UnidadMotor {
  id: string;                    // id de la jornada (unidad + operador del día)
  tipo: TipoUnidad;
  capacidadKg: number;
  ubicacionInicial: Coordenada;
  libreDesdeMin: number;
  cargaActualKg: number;         // > 0 solo en re-ruteo; ocupa el primer viaje
}

export interface EntradaPlan {
  fecha: string;                 // AAAA-MM-DD
  instanteMin: number;           // momento de la planificación; nada empieza antes
  solicitudes: SolicitudMotor[]; // sin repetidas; en re-ruteo, sin las congeladas
  unidades: UnidadMotor[];
  parametros: ParametrosMotor;
}

export interface ParadaPlan {
  solicitudId: string;
  secuencia: number;             // 1, 2, … dentro del viaje
  kmDesdeAnterior: number;
  llegadaMin: number;            // física
  esperaMin: number;             // inicioServicio − llegada
  inicioServicioMin: number;     // max(llegada, apertura de la ventana elegida); ≤ fin de esa ventana
  finServicioMin: number;
  ventana: VentanaMin;           // la ventana en la que cae el inicio
}

export interface ViajePlan {
  numero: number;                // 1, 2, … por unidad
  salidaMin: number;             // del patio, o de la ubicación inicial en el primer viaje del re-ruteo
  paradas: ParadaPlan[];         // puede estar vacía solo en el primer viaje del re-ruteo con carga: regreso y descarga
  regresoPatioMin: number;
  finDescargaMin: number;
  cargaKg: number;               // incluye cargaActualKg en el primer viaje
  km: number;                    // incluye el regreso al patio
}

export interface RutaPlan { unidadId: string; viajes: ViajePlan[] }

export type MotivoPospuesta =
  | "sin_unidades_disponibles"   // no hay ninguna unidad
  | "sin_unidad_compatible"      // ninguna unidad disponible es de un tipo admitido
  | "sin_cupo";                  // no cabe en ninguna posición factible
export type MotivoBloqueoMotor = "carga_mayor_a_capacidad_compatible"; // > máximo de capacidadMaximaPorTipoKg entre sus tipos admitidos

/** Por qué se descartaron las posiciones probadas para una pospuesta "sin_cupo" (cuántas por cada razón). */
export interface Diagnostico { capacidad: number; ventana: number; finDeTurno: number; afectaAOtra: number }

/** Una decisión de admisión, en orden FIFO, con el estado de las rutas justo ANTES de tomarla. */
export type DecisionTraza =
  | { solicitudId: string; resultado: "admitida"; unidadId: string; viaje: number; secuencia: number; rutasAntes: RutaPlan[] }
  | { solicitudId: string; resultado: "pospuesta"; motivo: MotivoPospuesta; diagnostico: Diagnostico; rutasAntes: RutaPlan[] }
  | { solicitudId: string; resultado: "bloqueada"; motivo: MotivoBloqueoMotor };

export interface Plan {
  versionMotor: string;          // "1.0.0"
  rutas: RutaPlan[];
  pospuestas: { solicitudId: string; motivo: MotivoPospuesta; diagnostico: Diagnostico | null }[];
  bloqueadas: { solicitudId: string; motivo: MotivoBloqueoMotor }[];
  traza: DecisionTraza[];
  resumen: {
    ruteadas: number; pospuestas: number; bloqueadas: number;
    km: number; minutosTraslado: number;
    /** Un viaje redondo patio–cliente–patio por cada solicitud RUTEADA; compara las mismas solicitudes. */
    kmMetodoActual: number; minutosTrasladoMetodoActual: number;
  };
}
```

Funciones (`src/motor/index.ts`):

```ts
export function generarPlan(entrada: EntradaPlan): Plan;   // también la usa el re-ruteo (Plan 5) con unidades ya descontadas
export function validarPlan(entrada: EntradaPlan, plan: Plan): string[]; // [] si es válido; cada texto explica una violación
export function distanciaKm(a: Coordenada, b: Coordenada, factorCircuidad: number): number; // haversine × circuidad
export function minutosDeTraslado(km: number, velocidadKmh: number): number;            // redondeo hacia arriba
```

`reasignarPendientes` se elimina: el re-ruteo es `generarPlan` con unidades que ya descuentan lo congelado. Quien llama (Plan 5) arma esas unidades y no incluye solicitudes congeladas; `generarPlan` lanza un error si recibe solicitudes repetidas.

## 4. Algoritmo (versión 1.0.0)

1. **Bloqueadas:** solicitudes con `cargaKg` mayor que la mayor `capacidadMaximaPorTipoKg` de sus tipos admitidos.
2. **Sin unidades:** si no hay unidades, todas las demás quedan pospuestas con `sin_unidades_disponibles`.
3. **Orden FIFO:** por `registradaEn` y luego `folio`; los empates se rompen por `id`.
4. **Zonas:** k-means++ con un generador pseudoaleatorio propio sembrado con `semilla` (prohibido `Math.random`).
   - Coordenadas proyectadas a kilómetros alrededor del patio.
   - k = mín(unidades, solicitudes).
   - Máximo 100 iteraciones.
   - Una zona vacía recibe el punto más lejano a su centro.
   - Cada unidad se asocia a una zona por orden de id para que sea determinista.
5. **Admisión:** cada solicitud, en orden FIFO, prueba todas las posiciones de todos los viajes de las unidades compatibles, primero las de su zona. Insertar es recalcular **la ruta completa de esa unidad**: la parada nueva, las posteriores del mismo viaje y **todos los viajes siguientes**, porque cada viaje sale cuando termina la descarga del anterior. Una posición es factible si, en toda la ruta recalculada:
   - ningún viaje excede la capacidad;
   - cada parada inicia su servicio dentro de alguna de sus ventanas (si llega antes, espera);
   - el último `finDescargaMin` no pasa de `turnoFinMin`;
   - `salida[n+1] ≥ finDescarga[n]`;
   - nada empieza antes de `max(instanteMin, libreDesdeMin, turnoInicioMin)`.

   Se elige la posición factible de menor costo adicional en minutos; en empate, la unidad de su zona y luego el id menor.
6. **Nuevo viaje:** si no hay posición factible, se agrega un viaje al final de la unidad compatible que termine antes y en la que quepa.
7. **Pospuesta:** si tampoco cabe, queda pospuesta `sin_unidad_compatible` o `sin_cupo`, con el diagnóstico. "No mover a las admitidas" significa: nunca se expulsan ni cambia su orden relativo dentro de su viaje; sus horas sí pueden recorrerse mientras sigan cumpliendo todo.
8. **Traza:** cada decisión guarda las rutas justo antes de tomarla.
9. **Comparación:** para cada solicitud ruteada, el método actual hace un viaje redondo patio–cliente–patio.
10. **Validación final:** `validarPlan`; si devuelve algo, error.

## 5. Propiedades (fast-check, sobre entradas generadas)

1. **Determinismo:** misma entrada y misma semilla dan exactamente el mismo plan (`toEqual`).
2. **Partición:** cada solicitud aparece una sola vez, en `rutas`, `pospuestas` o `bloqueadas`, y la traza tiene una decisión por solicitud, en orden FIFO.
3. **Capacidad:** ningún viaje excede la capacidad de su unidad, contando `cargaActualKg` en el primer viaje.
4. **Ventanas:** todo `inicioServicioMin` cae dentro de la ventana declarada en la parada, y esa ventana es una de las de la solicitud; `esperaMin = inicio − llegada ≥ 0`.
5. **Turno y encadenamiento:**
   - todo `finDescargaMin` ≤ `turnoFinMin`;
   - el primer viaje sale ≥ `max(instanteMin, libreDesdeMin, turnoInicioMin)`;
   - cada viaje siguiente sale ≥ `finDescargaMin` del anterior.
6. **Compatibilidad:** cada parada va en una unidad de un tipo admitido por su solicitud.
7. **Coherencia de tiempos:**
   - `llegada = fin de la parada anterior (o salida) + traslado`;
   - `fin = inicio + servicio`;
   - `regreso = fin de la última parada (o salida si no hay paradas) + traslado al patio`;
   - `finDescarga = regreso + descarga`.
8. **FIFO global:** para cada decisión `pospuesta` de la traza, `validarPlan` comprueba con su propia verificación de factibilidad, distinta de la del algoritmo, que sobre `rutasAntes` no existe ninguna posición factible, ni en viajes existentes ni en un viaje nuevo. Para cada `admitida`, comprueba que la posición elegida es factible sobre `rutasAntes`. Las `rutasAntes` de cada decisión deben coincidir con el resultado de aplicar las decisiones anteriores.
9. **Re-ruteo:** con unidades que traen `cargaActualKg > 0`, el primer viaje de cada una regresa al patio y descarga aunque no reciba paradas nuevas; nunca se repiten solicitudes.

## 6. Casos límite (pruebas con valores escritos a mano)

- Sin unidades: todo pospuesto con `sin_unidades_disponibles`.
- Unidades de un tipo que ningún cliente admite: `sin_unidad_compatible`.
- Una carga mayor que la capacidad máxima de sus tipos admitidos: bloqueada, aunque otro tipo sí pudiera cargarla.
- Una sola solicitud y una unidad: un viaje con una parada; los tiempos se calculan a mano en la prueba.
- Todos los clientes en el mismo punto: zonas con puntos idénticos, sin división entre cero.
- Llegada antes de la ventana: espera calculada; el inicio coincide con la apertura.
- Ventana que cierra antes de poder llegar: pospuesta `sin_cupo` con `diagnostico.ventana > 0`.
- Insertar en el viaje 1 retrasa el viaje 2 y rompería una ventana del viaje 2: esa posición no es factible.
- Contraejemplo de dos zonas con antigüedades cruzadas y el caso de una antigua grande con recientes pequeñas (especificación §8).
- Instante de planificación a media mañana: nada empieza antes.
- Re-ruteo con una unidad cargada y sin solicitudes: un viaje sin paradas que regresa y descarga.

## 7. Simulación (`scripts/simular.mts`, Codex escribe, Claude ejecuta)

- Datos sintéticos con semilla:
  - 30 clientes alrededor de El Marqués, en un radio de 15 km del patio;
  - ventanas de 2 a 6 horas;
  - cargas de 300 a 3000 kg;
  - 5 unidades doble rodada de 8 toneladas;
  - 40 a 60 solicitudes por día;
  - 20 días.
- Las solicitudes pospuestas un día pasan al siguiente, conservando su hora de registro.
- Salida en `docs/simulacion/` (Markdown y CSV), por día y total:
  - solicitudes ruteadas, pospuestas y bloqueadas;
  - km y minutos de traslado del motor contra el método actual, y su porcentaje de ahorro;
  - viajes por unidad.
- El texto aclara dos cosas:
  - es un ahorro **simulado**, con tiempos estimados (especificación §11, K4);
  - compara las mismas solicitudes atendidas, sin demostrar que el método actual podría atenderlas todas dentro del turno.

## 8. Tareas

| # | Responsable | Tarea |
|---|---|---|
| M0 | Claude (en el T0 del Plan 2) | `src/motor/tipos.ts` del §3 e `index.ts` con firmas; `fast-check` en `package.json` |
| M1 | Codex | Geometría, generador sembrado, k-means++ |
| M2 | Codex | Admisión con recálculo de la ruta completa, viajes, traza, diagnóstico y comparación |
| M3 | Codex | `validarPlan` independiente |
| M4 | Codex | Pruebas de §5 y §6 |
| M5 | Codex | Simulación |
| M6 | Claude | Revisión, ejecución en contenedor, rendimiento (60 × 15 en < 1 s), integración |

## 9. Qué revisar con más cuidado

- Pureza: nada de `Date`, `Math.random`, base de datos ni red en `src/motor`.
- `validarPlan` no reutiliza funciones del algoritmo de admisión. Puede compartir `distanciaKm` y `minutosDeTraslado`, que son fórmulas.
- La propiedad 8, con varias ventanas por cliente y con apertura de viajes nuevos.
- El recálculo de los viajes posteriores al insertar.
- Redondeos: los minutos son enteros y se redondean siempre de la misma forma.
