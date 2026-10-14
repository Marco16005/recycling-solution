# Plan 3 — Motor de ruteo y simulación

- **Fecha:** 2026-10-14.
- **Especificación:** §7 (reglas 3 a 5), §8 (motor) y §14 (decisiones 2 a 5).
- **Responsable:** Codex (`src/motor`, sus pruebas y la simulación). Claude revisa, integra y ejecuta.
- **Paralelo:** se desarrolla junto con el Plan 2. Solo depende de los tipos de este documento; no usa base de datos ni pantallas.

## 1. Objetivo y aceptación

1. `generarPlan(entrada)` arma las rutas del día con la política FIFO global y la inserción factible (especificación §7.4 y §8), con zonas por k-means++ con semilla.
2. `validarPlan(entrada, plan)` comprueba, sin reutilizar el algoritmo, todas las propiedades de §5. `generarPlan` lo llama antes de devolver y lanza un error si falla.
3. `reasignarPendientes(entrada)` rehace solo lo pendiente de una ruta afectada (lo usa el Plan 5).
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
  turnoInicioMin: number;        // 480 = 08:00
  turnoFinMin: number;           // 960 = 16:00; incluye regreso y descarga
  velocidadKmh: number;
  factorCircuidad: number;
  descargaMin: number;           // al volver al patio, por viaje
  capacidadMaximaCatalogoKg: number; // la mayor capacidad entre todas las unidades activas, disponibles o no
  semilla: number;
}

export interface VentanaMin { inicioMin: number; finMin: number } // de la fecha del plan; limita la LLEGADA

export interface SolicitudMotor {
  id: string;
  folio: string;
  registradaEn: string;          // ISO 8601; llave FIFO junto con folio
  clienteId: string;
  ubicacion: Coordenada;
  ventanas: VentanaMin[];        // no vacía (el Plan 4 solo envía solicitudes habilitadas)
  tiempoServicioMin: number;
  cargaKg: number;               // ya resuelta con cargaEfectivaKg
  tiposUnidadAdmitidos: TipoUnidad[];
}

export interface ParadaComprometida { solicitudId: string; finServicioMin: number; ubicacion: Coordenada }

export interface UnidadMotor {
  id: string;                    // id de la jornada (unidad + operador del día)
  tipo: TipoUnidad;
  capacidadKg: number;
  disponibleDesdeMin: number;
  /** Re-ruteo: dónde y cuándo queda libre la unidad, y carga ya recogida en el viaje en curso. Plan del día: patio, disponibleDesde, 0. */
  ubicacionInicial: Coordenada;
  libreDesdeMin: number;
  cargaActualKg: number;
}

export interface EntradaPlan {
  fecha: string;                 // AAAA-MM-DD
  instanteMin: number;           // momento de la planificación; nada empieza antes
  solicitudes: SolicitudMotor[];
  unidades: UnidadMotor[];
  parametros: ParametrosMotor;
}

export interface ParadaPlan {
  solicitudId: string;
  secuencia: number;             // 1, 2, … dentro del viaje
  llegadaMin: number;
  esperaMin: number;             // si llega antes de abrir la ventana
  inicioServicioMin: number;
  finServicioMin: number;
  ventana: VentanaMin;           // la ventana en la que cae la llegada
  kmDesdeAnterior: number;
}

export interface ViajePlan {
  numero: number;                // 1, 2, … por unidad
  salidaMin: number;             // del patio (o de la ubicación inicial en el primer viaje del re-ruteo)
  paradas: ParadaPlan[];
  regresoPatioMin: number;
  finDescargaMin: number;
  cargaKg: number;
  km: number;                    // incluye el regreso al patio
}

export interface RutaPlan { unidadId: string; viajes: ViajePlan[] }

export type MotivoPospuesta =
  | "sin_unidades_disponibles"   // no hay ninguna unidad
  | "sin_unidad_compatible"      // ninguna unidad disponible es de un tipo admitido
  | "sin_capacidad_en_turno";    // no cabe en ninguna posición factible (capacidad, ventana o fin de turno)
export type MotivoBloqueoMotor = "carga_mayor_a_toda_capacidad"; // > capacidadMaximaCatalogoKg

export interface Plan {
  versionMotor: string;          // "1.0.0"
  rutas: RutaPlan[];
  pospuestas: { solicitudId: string; motivo: MotivoPospuesta }[];
  bloqueadas: { solicitudId: string; motivo: MotivoBloqueoMotor }[];
  resumen: {
    ruteadas: number; pospuestas: number; bloqueadas: number;
    km: number; minutosTraslado: number;
    kmMetodoActual: number; minutosTrasladoMetodoActual: number; // un viaje redondo patio-cliente-patio por solicitud ruteada
  };
}

export interface EntradaReruteo extends EntradaPlan {
  /** Rutas vigentes de las demás unidades; no se tocan, pero ocupan su tiempo. */
  rutasFijas: RutaPlan[];
}
```

Funciones (`src/motor/index.ts`):

```ts
export function generarPlan(entrada: EntradaPlan): Plan;
export function reasignarPendientes(entrada: EntradaReruteo): Plan; // solo devuelve rutas de entrada.unidades
export function validarPlan(entrada: EntradaPlan, plan: Plan): string[]; // [] si es válido; cada texto explica una violación
export function distanciaKm(a: Coordenada, b: Coordenada, factorCircuidad: number): number; // haversine × circuidad
export function minutosDeTraslado(km: number, velocidadKmh: number): number;            // redondeo hacia arriba
```

## 4. Algoritmo (versión 1.0.0)

1. **Bloqueadas:** solicitudes con `cargaKg > capacidadMaximaCatalogoKg`.
2. **Sin unidades:** si no hay unidades, todas las demás quedan pospuestas con `sin_unidades_disponibles`.
3. **Orden FIFO:** por `registradaEn` y luego `folio`; los empates se rompen por `id`.
4. **Zonas:** k-means++ con un generador pseudoaleatorio propio sembrado con `semilla` (prohibido `Math.random`).
   - Coordenadas proyectadas a kilómetros alrededor del patio.
   - k = mín(unidades, solicitudes).
   - Máximo 100 iteraciones.
   - Una zona vacía recibe el punto más lejano a su centro.
   - Cada unidad se asocia a una zona por orden de id para que sea determinista.
5. **Admisión:** cada solicitud, en orden FIFO, prueba todas las posiciones de todos los viajes de las unidades compatibles, primero las de su zona. Elige la posición factible de menor costo adicional en minutos; en empate, la unidad de su zona y luego el id menor. Una posición es factible si:
   - se respeta la capacidad del viaje;
   - la llegada cae dentro de alguna ventana (si llega antes, espera a que abra);
   - ninguna parada ya admitida en ese viaje se sale de su ventana;
   - el regreso al patio más la descarga termina antes de `turnoFinMin`;
   - nada empieza antes de `instanteMin` ni de `libreDesdeMin`.
6. **Nuevo viaje:** si no hay posición factible, se abre un viaje nuevo en la unidad compatible que termine antes y en el que quepa.
7. **Pospuesta:** si tampoco cabe, queda pospuesta con `sin_unidad_compatible` o `sin_capacidad_en_turno`. Las ya admitidas nunca se mueven por una más reciente.
8. **Comparación:** para cada solicitud ruteada, el método actual hace un viaje redondo patio–cliente–patio.
9. **Validación final:** `validarPlan`; si devuelve algo, error.

## 5. Propiedades (fast-check, sobre entradas generadas)

1. **Determinismo:** misma entrada y misma semilla dan exactamente el mismo plan (`toEqual`).
2. **Partición:** cada solicitud aparece una sola vez, en `rutas`, `pospuestas` o `bloqueadas`.
3. **Capacidad:** ningún viaje excede la capacidad de su unidad, contando `cargaActualKg` en el primer viaje del re-ruteo.
4. **Ventanas:** toda llegada cae dentro de la ventana declarada en la parada, y esa ventana es una de las de la solicitud.
5. **Turno:** todo `finDescargaMin` ≤ `turnoFinMin`; nada empieza antes de `max(instanteMin, libreDesdeMin, disponibleDesdeMin)`.
6. **Compatibilidad:** cada parada va en una unidad de un tipo admitido por su solicitud.
7. **Coherencia de tiempos:**
   - `llegada = salida anterior + traslado`;
   - `inicio = max(llegada, apertura de ventana)`;
   - `fin = inicio + servicio`;
   - `regreso = fin última + traslado al patio`;
   - `finDescarga = regreso + descarga`.
8. **FIFO global (especificación §8):** si A quedó pospuesta y una B más reciente quedó ruteada, A no tiene ninguna inserción factible en el plan formado solo por las solicitudes admitidas antes que A. `validarPlan` lo comprueba reintentando A sobre ese plan.
9. **Re-ruteo:** `reasignarPendientes` no devuelve rutas de unidades que no están en `entrada.unidades` y respeta `libreDesdeMin`, `ubicacionInicial` y `cargaActualKg`.

## 6. Casos límite (pruebas con valores escritos a mano)

- Sin unidades: todo pospuesto con `sin_unidades_disponibles`.
- Unidades de un tipo que ningún cliente admite: `sin_unidad_compatible`.
- Una carga mayor que la capacidad máxima del catálogo: bloqueada.
- Una sola solicitud y una unidad: un viaje con una parada; los tiempos se calculan a mano en la prueba.
- Todos los clientes en el mismo punto: zonas con puntos idénticos, sin división entre cero.
- Llegada antes de la ventana: espera calculada.
- Ventana que cierra antes de poder llegar: pospuesta `sin_capacidad_en_turno`.
- Contraejemplo de dos zonas con antigüedades cruzadas y el caso de una antigua grande con recientes pequeñas (especificación §8).
- Instante de planificación a media mañana: nada empieza antes.

## 7. Simulación (`scripts/simular.mts`, Codex escribe, Claude ejecuta)

- Datos sintéticos con semilla:
  - 30 clientes alrededor de El Marqués, en un radio de 15 km del patio;
  - ventanas de 2 a 6 horas;
  - cargas de 300 a 3000 kg;
  - 5 unidades doble rodada de 8 toneladas;
  - 40 a 60 solicitudes por día;
  - 20 días.
- Salida en `docs/simulacion/` (Markdown y CSV), por día y total:
  - solicitudes ruteadas, pospuestas y bloqueadas;
  - km y minutos de traslado del motor contra el método actual, y su porcentaje de ahorro;
  - viajes por unidad.
- El texto aclara que es un ahorro **simulado** con tiempos estimados (especificación §11, K4).

## 8. Tareas

| # | Responsable | Tarea |
|---|---|---|
| M0 | Claude (en el T0 del Plan 2) | `src/motor/tipos.ts` del §3 e `index.ts` con firmas; `fast-check` en `package.json` |
| M1 | Codex | Geometría, generador sembrado, k-means++ |
| M2 | Codex | Admisión, viajes, re-ruteo y comparación |
| M3 | Codex | `validarPlan` independiente |
| M4 | Codex | Pruebas de §5 y §6 |
| M5 | Codex | Simulación |
| M6 | Claude | Revisión, ejecución en contenedor, rendimiento (60 × 15 en < 1 s), integración |

## 9. Qué revisar con más cuidado

- Pureza: nada de `Date`, `Math.random`, base de datos ni red en `src/motor`.
- `validarPlan` no reutiliza funciones del algoritmo de admisión. Puede compartir `distanciaKm` y `minutosDeTraslado`, que son fórmulas.
- La propiedad 8, en especial con varias ventanas por cliente.
- Redondeos: los minutos son enteros y se redondean siempre de la misma forma.
